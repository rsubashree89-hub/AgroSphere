import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Pool } from 'pg'
import { createApp } from './app.js'
import type { AppConfig } from './config/env.js'

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
  JWT_SECRET: 'test-secret-with-more-than-32-characters',
  AI_SERVICE_URL: undefined,
}

describe('API app', () => {
  it('reports liveness without requiring a database connection', async () => {
    const query = vi.fn()
    const app = createApp({ query } as unknown as Pool, config)

    await request(app)
      .get('/api/health/live')
      .expect(200, { status: 'ok' })

    expect(query).not.toHaveBeenCalled()
  })

  it('rejects invalid registration input before accessing the database', async () => {
    const query = vi.fn()
    const app = createApp({ query } as unknown as Pool, config)

    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'not-an-email', password: 'short' })
      .expect(400)

    expect(response.body.error).toBe('Please check the information you entered.')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns a client error for malformed JSON', async () => {
    const app = createApp({ query: vi.fn() } as unknown as Pool, config)

    await request(app)
      .post('/api/auth/register')
      .type('json')
      .send('{"name":')
      .expect(400, { error: 'Request body must be valid JSON.' })
  })

  it('rejects browser mutations from an untrusted origin', async () => {
    const query = vi.fn()
    const app = createApp({ query } as unknown as Pool, config)

    await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'https://other.example')
      .expect(403, { error: 'Request origin is not allowed.' })

    expect(query).not.toHaveBeenCalled()
  })
})
