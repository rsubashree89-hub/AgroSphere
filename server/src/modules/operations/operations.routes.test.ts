import { SignJWT } from 'jose'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { AppConfig } from '../../config/env.js'
import { createApp } from '../../app.js'

const userId = 'c0cbf812-c979-487c-a486-2a619a36fb91'
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
  JWT_SECRET: 'operations-test-secret-with-at-least-32-characters',
  AI_SERVICE_URL: undefined,
}

async function cookie() {
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

function authenticatedAsFarmer(query: ReturnType<typeof vi.fn>) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('JOIN auth_sessions')) {
      return {
        rows: [{ id: userId, name: 'Farmer', email: 'farmer@example.test', role: 'farmer' }],
        rowCount: 1,
      }
    }
    return { rows: [], rowCount: 0 }
  })
}

describe('operations routes', () => {
  it('rejects farmers on every admin management route', async () => {
    for (const [method, path] of [
      ['get', '/api/admin/activity'],
      ['get', '/api/admin/users'],
      ['patch', `/api/admin/users/${userId}/active`],
    ] as const) {
      const query = vi.fn()
      authenticatedAsFarmer(query)
      const call = request(testApp(query))[method](path).set('Cookie', await cookie())
      if (method === 'patch') {
        await call.send({ active: false }).expect(403, { error: 'Administrator access is required.' })
      } else {
        await call.expect(403, { error: 'Administrator access is required.' })
      }
      expect(query).toHaveBeenCalledTimes(1)
    }
  })

  it('validates date-filter input before querying report data', async () => {
    const query = vi.fn()
    authenticatedAsFarmer(query)
    await request(testApp(query))
      .get('/api/reports/summary?from=2026-02-01&to=2026-01-01')
      .set('Cookie', await cookie())
      .expect(400)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('uses the supplied inclusive date range for report metrics', async () => {
    const query = vi.fn()
    authenticatedAsFarmer(query)
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('JOIN auth_sessions')) {
        return {
          rows: [{ id: userId, name: 'Farmer', email: 'farmer@example.test', role: 'farmer' }],
          rowCount: 1,
        }
      }
      expect(sql).toContain('irrigation_records.recorded_at < $3::date + INTERVAL')
      return { rows: [], rowCount: 0 }
    })
    const response = await request(testApp(query))
      .get('/api/reports/summary?from=2026-01-01&to=2026-01-31')
      .set('Cookie', await cookie())
      .expect(200)
    expect(response.body.period).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(query.mock.calls[1][1]).toEqual([userId, '2026-01-01', '2026-01-31'])
  })
})
