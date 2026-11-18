import cookieParser from 'cookie-parser'
import express, { type ErrorRequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { ZodError } from 'zod'
import type { Pool } from 'pg'
import type { AppConfig } from './config/env.js'
import { createAuthRouter } from './modules/auth/auth.routes.js'
import { createFarmsRouter } from './modules/farms/farms.routes.js'
import { createFieldsRouter } from './modules/fields/fields.routes.js'
import { createCropsRouter } from './modules/crops/crops.routes.js'
import { createOperationsRouter } from './modules/operations/operations.routes.js'
import { createHealthRouter } from './modules/health/health.routes.js'
import multer from 'multer'

export function createApp(pool: Pool, config: AppConfig) {
  const app = express()

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(express.json({ limit: '10kb' }))
  app.use(cookieParser())

  app.get('/api/health/live', (_req, res) => {
    res.status(200).json({ status: 'ok' })
  })

  app.get('/api/health/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1')
      return res.status(200).json({ status: 'ready' })
    } catch (error) {
      console.error('Database readiness check failed:', error)
      return res.status(503).json({ status: 'not_ready' })
    }
  })

  app.use(
    '/api/auth',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    createAuthRouter(pool, config),
  )
  app.use('/api/farms', createFarmsRouter(pool, config))
  app.use('/api/fields', createFieldsRouter(pool, config))
  app.use('/api/crops', createCropsRouter(pool, config))
  const operations = createOperationsRouter(pool, config)
  app.use('/api', operations)
  app.use('/api/crop-health', createHealthRouter(pool, config))

  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found.' })
  })

  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      return next(error)
    }
    if (
      error instanceof SyntaxError &&
      'status' in error &&
      error.status === 400
    ) {
      return res.status(400).json({ error: 'Request body must be valid JSON.' })
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 413
    ) {
      return res.status(413).json({ error: 'Request body is too large.' })
    }
    if (error instanceof multer.MulterError) {
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: error.code === 'LIMIT_FILE_SIZE'
          ? 'Image must be no larger than 5 MB.'
          : 'Unable to process uploaded image.',
      })
    }
    if (error instanceof Error && error.message === 'Upload a JPEG, PNG, or WebP crop image.') {
      return res.status(415).json({ error: error.message })
    }
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid request data.' })
    }
    console.error('Unhandled API error:', error)
    return res.status(500).json({ error: 'An unexpected server error occurred.' })
  }
  app.use(errorHandler)

  return app
}
