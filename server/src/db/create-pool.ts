import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import type { AppConfig } from '../config/env.js'

export function createDatabasePool(config: AppConfig) {
  const ssl = config.PGSSLMODE === 'verify-full'
    ? {
        rejectUnauthorized: true,
        ...(config.PGSSLROOTCERT
          ? { ca: readFileSync(config.PGSSLROOTCERT, 'utf8') }
          : {}),
      }
    : undefined

  return new Pool({
    host: config.PGHOST,
    port: config.PGPORT,
    database: config.PGDATABASE,
    user: config.PGUSER,
    ...(config.PGPASSWORD ? { password: config.PGPASSWORD } : {}),
    ...(ssl ? { ssl } : {}),
  })
}
