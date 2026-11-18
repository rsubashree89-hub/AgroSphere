import dotenv from 'dotenv'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config/env.js'
import { createDatabasePool } from './create-pool.js'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const migrationDirectory = fileURLToPath(
  new URL('../../migrations/', import.meta.url),
)

async function main() {
  const config = loadConfig()
  const pool = createDatabasePool(config)

  try {
    const client = await pool.connect()
    try {
      await client.query('SELECT pg_advisory_lock($1)', [734921084])
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)

      const migrationNames = (await readdir(migrationDirectory))
        .filter((name) => /^\d+_.+\.sql$/.test(name))
        .sort()

      for (const name of migrationNames) {
        const alreadyApplied = await client.query(
          'SELECT 1 FROM schema_migrations WHERE name = $1',
          [name],
        )
        if (alreadyApplied.rowCount) {
          console.info(`Already applied: ${name}`)
          continue
        }

        const sql = await readFile(join(migrationDirectory, name), 'utf8')
        await client.query('BEGIN')
        try {
          await client.query(sql)
          await client.query(
            'INSERT INTO schema_migrations (name) VALUES ($1)',
            [name],
          )
          await client.query('COMMIT')
          console.info(`Applied: ${name}`)
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      }

      if (migrationNames.length === 0) {
        console.info('No SQL migrations found.')
      }
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [734921084])
      } finally {
        client.release()
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration error'
  console.error(`Database migration failed: ${message}`)
  process.exitCode = 1
})
