import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { loadConfig } from './config/env.js'
import { createDatabasePool } from './db/create-pool.js'
import { startNotificationScheduler } from './modules/operations/notification-scheduler.js'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const config = loadConfig()
const pool = createDatabasePool(config)
const app = createApp(pool, config)
const server = app.listen(config.API_PORT, () => {
  console.info(`AgroSphere API listening on port ${config.API_PORT}`)
})
const stopNotificationScheduler = startNotificationScheduler(pool)

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error)
})

function shutdown(signal: string) {
  console.info(`${signal} received; closing API server`)
  stopNotificationScheduler()
  server.close((error) => {
    if (error) {
      console.error('Error closing API server:', error)
      process.exitCode = 1
    }
    void pool.end().catch((poolError: unknown) => {
      console.error('Error closing PostgreSQL pool:', poolError)
      process.exitCode = 1
    })
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
