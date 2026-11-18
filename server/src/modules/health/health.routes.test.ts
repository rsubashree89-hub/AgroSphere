import { unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SignJWT } from 'jose'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { AppConfig } from '../../config/env.js'
import { createApp } from '../../app.js'

const userId = 'c0cbf812-c979-487c-a486-2a619a36fb91'
const cropId = '1843e25c-2818-4a63-9f2d-e1abedb92656'
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
  JWT_SECRET: 'health-test-secret-with-at-least-32-characters',
  AI_SERVICE_URL: 'http://ai-service.example.test',
}

const createdImagePaths: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(createdImagePaths.splice(0).map((path) =>
    unlink(resolve('server/storage', path.replaceAll('/', '\\'))).catch(() => undefined),
  ))
})

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

function authenticatedAsFarmer(query: ReturnType<typeof vi.fn>, ownsCrop: boolean) {
  query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('JOIN auth_sessions')) {
      return {
        rows: [{ id: userId, name: 'Farmer', email: 'farmer@example.test', role: 'farmer' }],
        rowCount: 1,
      }
    }
    if (sql.includes('SELECT crops.id FROM crops')) {
      return { rows: ownsCrop ? [{ id: cropId }] : [], rowCount: ownsCrop ? 1 : 0 }
    }
    if (sql.includes('INSERT INTO crop_health_analyses')) {
      createdImagePaths.push(String(values[1]))
      return {
        rows: [{
          id: '293a2b04-7513-4f3d-b165-6e86dc718047',
          status: values[3],
          disease_name: values[4],
          confidence: values[5],
          result: JSON.parse(String(values[6])),
          created_at: new Date(),
        }],
        rowCount: 1,
      }
    }
    throw new Error(`Unexpected database query: ${sql}`)
  })
}

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const analysis = {
  status: 'uncertain',
  provider: 'Plant.id',
  disease_name: 'Possible leaf issue',
  confidence: 0.41,
  is_healthy: false,
  description: 'Provider description.',
  treatment: 'Provider guidance.',
  message: 'Verify with an agronomist.',
}

describe('crop-health routes', () => {
  it('stores the validated provider result using its snake_case fields', async () => {
    const query = vi.fn()
    authenticatedAsFarmer(query, true)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(analysis), { status: 200 })))

    const response = await request(testApp(query))
      .post(`/api/crop-health/${cropId}`)
      .set('Cookie', await cookie())
      .attach('image', png, { filename: 'leaf.png', contentType: 'image/png' })
      .expect(201)

    expect(response.body.analysis.disease_name).toBe('Possible leaf issue')
    expect(response.body.analysis.confidence).toBe(0.41)
    expect(query.mock.calls.at(-1)?.[0]).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7)")
  })

  it('does not send an unowned crop image to the analysis service', async () => {
    const query = vi.fn()
    authenticatedAsFarmer(query, false)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await request(testApp(query))
      .post(`/api/crop-health/${cropId}`)
      .set('Cookie', await cookie())
      .attach('image', png, { filename: 'leaf.png', contentType: 'image/png' })
      .expect(404, { error: 'Crop not found.' })

    expect(fetch).not.toHaveBeenCalled()
  })
})
