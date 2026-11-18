import { SignJWT } from 'jose'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { AppConfig } from '../../config/env.js'
import { createApp } from '../../app.js'

const userId = 'c0cbf812-c979-487c-a486-2a619a36fb91'
const farmId = '0493c7db-8088-46fa-a047-93d6c710c7d8'
const sessionId = '933a5c78-9725-45b0-a531-9c4bec6b8dc3'
const config: AppConfig = {
  NODE_ENV: 'test',
  API_PORT: 4000,
  APP_ORIGIN: 'http://localhost:5173',
  PGHOST: 'localhost',
  PGPORT: 5432,
  PGDATABASE: 'agrosphere_db',
  PGUSER: 'postgres',
  PGPASSWORD: undefined,
  PGSSLMODE: 'disable',
  JWT_SECRET: 'farms-test-secret-with-at-least-32-characters',
  AI_SERVICE_URL: undefined,
}

const farmRow = {
  id: farmId,
  user_id: userId,
  farm_name: 'Green Valley',
  location: 'North District',
  total_area: 42.5,
  area_unit: 'hectares',
  soil_type: 'Loam',
  description: 'Family farm',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
}

async function sessionCookie() {
  const token = await new SignJWT({ email: 'farmer@example.test' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuer('agrosphere-api')
    .setAudience('agrosphere-web')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(config.JWT_SECRET))
  return `agrosphere_session=${token}`
}

function testApp(query: ReturnType<typeof vi.fn>) {
  return createApp({ query } as unknown as Pool, config)
}

function authenticatedUserQuery(query: ReturnType<typeof vi.fn>) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('JOIN auth_sessions')) {
      return {
        rows: [{ id: userId, name: 'Farmer', email: 'farmer@example.test' }],
        rowCount: 1,
      }
    }
    return { rows: [], rowCount: 0 }
  })
}

describe('farm routes', () => {
  it('requires an authenticated session', async () => {
    const query = vi.fn()
    await request(testApp(query)).get('/api/farms').expect(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('lists only records for the authenticated user', async () => {
    const query = vi.fn()
    authenticatedUserQuery(query)
    query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('JOIN auth_sessions')) {
        return {
          rows: [{ id: userId, name: 'Farmer', email: 'farmer@example.test' }],
          rowCount: 1,
        }
      }
      expect(sql).toContain('WHERE user_id = $1')
      expect(values).toEqual([userId])
      return { rows: [farmRow], rowCount: 1 }
    })

    const response = await request(testApp(query))
      .get('/api/farms')
      .set('Cookie', await sessionCookie())
      .expect(200)
    expect(response.body.farms).toHaveLength(1)
    expect(response.body.farms[0].farmName).toBe('Green Valley')
  })

  it('creates a farm owned by the authenticated user', async () => {
    const query = vi.fn()
    authenticatedUserQuery(query)
    query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('JOIN auth_sessions')) {
        return {
          rows: [{ id: userId, name: 'Farmer', email: 'farmer@example.test' }],
          rowCount: 1,
        }
      }
      expect(sql).toContain('INSERT INTO farms (user_id')
      expect(values[0]).toBe(userId)
      return { rows: [farmRow], rowCount: 1 }
    })

    await request(testApp(query))
      .post('/api/farms')
      .set('Cookie', await sessionCookie())
      .send({
        farmName: 'Green Valley',
        location: 'North District',
        totalArea: 42.5,
        areaUnit: 'hectares',
        soilType: 'Loam',
      })
      .expect(201)
  })

  it('validates farm input before writing', async () => {
    const query = vi.fn()
    authenticatedUserQuery(query)
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('JOIN auth_sessions')) {
        return {
          rows: [{ id: userId, name: 'Farmer', email: 'farmer@example.test' }],
          rowCount: 1,
        }
      }
      throw new Error('Invalid farm input reached the database.')
    })

    await request(testApp(query))
      .post('/api/farms')
      .set('Cookie', await sessionCookie())
      .send({
        farmName: 'x',
        location: 'North',
        totalArea: -1,
        areaUnit: 'unknown',
      })
      .expect(400)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('does not expose another user’s farm details', async () => {
    const query = vi.fn()
    authenticatedUserQuery(query)
    query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('JOIN auth_sessions')) {
        return {
          rows: [{ id: userId, name: 'Farmer', email: 'farmer@example.test' }],
          rowCount: 1,
        }
      }
      expect(sql).toContain('WHERE id = $1 AND user_id = $2')
      expect(values).toEqual([farmId, userId])
      return { rows: [], rowCount: 0 }
    })

    await request(testApp(query))
      .get(`/api/farms/${farmId}`)
      .set('Cookie', await sessionCookie())
      .expect(404, { error: 'Farm not found.' })
  })

  it('scopes updates and deletes to the authenticated user', async () => {
    for (const [method, expectedSql] of [
      ['put', 'WHERE id = $1 AND user_id = $2'],
      ['delete', 'DELETE FROM farms WHERE id = $1 AND user_id = $2'],
    ] as const) {
      const query = vi.fn()
      authenticatedUserQuery(query)
      query.mockImplementation(async (sql: string, values: unknown[]) => {
        if (sql.includes('JOIN auth_sessions')) {
          return {
            rows: [{ id: userId, name: 'Farmer', email: 'farmer@example.test' }],
            rowCount: 1,
          }
        }
        expect(sql).toContain(expectedSql)
        expect(values.slice(0, 2)).toEqual([farmId, userId])
        return { rows: [], rowCount: 0 }
      })

      const call = request(testApp(query))[method](`/api/farms/${farmId}`)
        .set('Cookie', await sessionCookie())
      if (method === 'put') {
        await call
          .send({
            farmName: 'Updated Farm',
            location: 'North District',
            totalArea: 40,
            areaUnit: 'acres',
          })
          .expect(404)
      } else {
        await call.expect(404)
      }
    }
  })
})
