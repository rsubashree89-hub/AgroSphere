import { describe, expect, it } from 'vitest'
import { loadConfig } from './env.js'

const baseEnvironment = {
  JWT_SECRET: 'production-test-secret-with-at-least-32-characters',
  PGHOST: 'db.example.test',
  PGDATABASE: 'agrosphere',
  PGUSER: 'agrosphere',
  APP_ORIGIN: 'https://agrosphere.example.test',
}

describe('environment configuration', () => {
  it('requires verified PostgreSQL TLS in production', () => {
    expect(() => loadConfig({
      ...baseEnvironment,
      NODE_ENV: 'production',
      PGSSLMODE: 'disable',
    })).toThrow('PGSSLMODE=verify-full')

    expect(loadConfig({
      ...baseEnvironment,
      NODE_ENV: 'production',
      PGSSLMODE: 'verify-full',
    }).PGSSLMODE).toBe('verify-full')
  })

  it('rejects insecure production origins and the example JWT secret', () => {
    expect(() => loadConfig({
      ...baseEnvironment,
      NODE_ENV: 'production',
      APP_ORIGIN: 'http://localhost:5173',
      PGSSLMODE: 'verify-full',
    })).toThrow('HTTPS APP_ORIGIN')

    expect(() => loadConfig({
      ...baseEnvironment,
      NODE_ENV: 'production',
      JWT_SECRET: 'replace-this-with-a-random-secret-at-least-32-characters',
      PGSSLMODE: 'verify-full',
    })).toThrow('Replace the example JWT_SECRET')
  })
})
