import { timingSafeEqual } from 'node:crypto'
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config/env.js'
import { createDatabasePool } from '../db/create-pool.js'

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

function secretsMatch(expected: string | undefined, provided: string | undefined) {
  if (!expected || !provided) return false
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer)
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Provide the existing account email as the command argument.')
  }
  if (!secretsMatch(process.env.ADMIN_BOOTSTRAP_SECRET, bootstrapToken)) {
    throw new Error('Admin bootstrap authorization failed. Configure a one-time secret and supply its token securely.')
  }

  const config = loadConfig()
  const pool = createDatabasePool(config)

  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1)', [734921086])
      const admin = await client.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")
      if (admin.rowCount) {
        throw new Error('An administrator is already configured; bootstrap can only run once.')
      }

      const target = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1 AND is_active = TRUE FOR UPDATE',
        [email],
      )
      if (!target.rows[0]) {
        throw new Error('No active account exists for the supplied email. Register the account before bootstrapping.')
      }

      await client.query("UPDATE users SET role = 'admin' WHERE id = $1", [target.rows[0].id])
      await client.query(
        `INSERT INTO admin_audit_events (target_user_id, action, details)
         VALUES ($1, 'admin.bootstrap', '{"method":"one-time-cli"}'::jsonb)`,
        [target.rows[0].id],
      )
      await client.query('COMMIT')
      console.info('Administrator access was granted to the existing account.')
    } catch (error) {
      await client.query('ROLLBACK').catch((rollbackError: unknown) => {
        console.error('Failed to roll back admin bootstrap:', rollbackError)
      })
      throw error
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown admin bootstrap error.'
  console.error(`Admin bootstrap failed: ${message}`)
  process.exitCode = 1
})
