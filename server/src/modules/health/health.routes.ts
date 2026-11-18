import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { Router } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { requireAuth } from '../../middleware/require-auth.js'

const imageDirectory = fileURLToPath(new URL('../../../storage/crop-health/', import.meta.url))
const cropIdSchema = z.string().uuid()
const analysisSchema = z.object({
  status: z.enum(['analyzed', 'uncertain']),
  provider: z.string().min(1).max(80),
  disease_name: z.string().max(160).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  is_healthy: z.boolean().nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  treatment: z.string().max(4000).nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
}).strict()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('Upload a JPEG, PNG, or WebP crop image.'))
      return
    }
    callback(null, true)
  },
})

function isImageSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === 'image/jpeg') {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  }
  if (mimeType === 'image/webp') {
    return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  }
  return false
}

export function createHealthRouter(pool: Pool, config: AppConfig): Router {
  const router = Router()
  router.use(requireAuth(pool, config))

  router.get('/:cropId', async (req, res, next) => {
    const cropId = cropIdSchema.safeParse(req.params.cropId)
    if (!cropId.success) return res.status(400).json({ error: 'Crop ID must be a valid UUID.' })
    try {
      const result = await pool.query(
        `SELECT crop_health_analyses.id, crop_health_analyses.status,
                crop_health_analyses.disease_name, crop_health_analyses.confidence,
                crop_health_analyses.result, crop_health_analyses.provider,
                crop_health_analyses.created_at
         FROM crop_health_analyses
         JOIN crops ON crops.id = crop_health_analyses.crop_id
         JOIN fields ON fields.id = crops.field_id
         JOIN farms ON farms.id = fields.farm_id
         WHERE crops.id = $1 AND farms.user_id = $2
         ORDER BY crop_health_analyses.created_at DESC LIMIT 50`,
        [cropId.data, req.user!.id],
      )
      return res.status(200).json({ analyses: result.rows })
    } catch (error) {
      return next(error)
    }
  })

  router.post(
    '/:cropId',
    (req, res, next) => {
      const cropId = cropIdSchema.safeParse(req.params.cropId)
      if (!cropId.success) return res.status(400).json({ error: 'Crop ID must be a valid UUID.' })
      req.params.cropId = cropId.data
      return next()
    },
    upload.single('image'),
    async (req, res, next) => {
      const file = req.file
      if (!file || !isImageSignature(file.buffer, file.mimetype)) {
        return res.status(400).json({ error: 'The uploaded file is not a supported image.' })
      }

      let storedPath: string | undefined
      try {
        const ownedCrop = await pool.query(
          `SELECT crops.id FROM crops
           JOIN fields ON fields.id = crops.field_id
           JOIN farms ON farms.id = fields.farm_id
           WHERE crops.id = $1 AND farms.user_id = $2`,
          [req.params.cropId, req.user!.id],
        )
        if (!ownedCrop.rowCount) return res.status(404).json({ error: 'Crop not found.' })
        if (!config.AI_SERVICE_URL) {
          return res.status(503).json({
            status: 'unavailable',
            error: 'Crop image analysis is not configured. Configure AI_SERVICE_URL and PLANT_ID_API_KEY for the FastAPI service.',
          })
        }

        const formData = new FormData()
        const extension = file.mimetype === 'image/jpeg' ? 'jpg' : file.mimetype === 'image/png' ? 'png' : 'webp'
        formData.append('image', new Blob([file.buffer], { type: file.mimetype }), `crop-image.${extension}`)
        let upstream: Response
        try {
          upstream = await fetch(
            `${config.AI_SERVICE_URL.replace(/\/$/, '')}/api/v1/health-assessment`,
            { method: 'POST', body: formData, signal: AbortSignal.timeout(60000) },
          )
        } catch (error) {
          if (error instanceof Error && error.name === 'TimeoutError') {
            return res.status(504).json({ status: 'unavailable', error: 'Crop health analysis timed out.' })
          }
          return res.status(502).json({ status: 'unavailable', error: 'Unable to reach the configured crop health service.' })
        }
        let analysis: unknown = null
        try {
          analysis = await upstream.json()
        } catch {
          analysis = null
        }
        if (!upstream.ok) {
          const errorMessage =
            typeof analysis === 'object' &&
            analysis !== null &&
            'detail' in analysis &&
            typeof analysis.detail === 'string'
              ? analysis.detail
              : 'Crop health analysis provider is unavailable.'
          return res.status(upstream.status === 503 ? 503 : 502).json({
            status: 'unavailable',
            error: errorMessage,
          })
        }
        const parsedAnalysis = analysisSchema.safeParse(analysis)
        if (!parsedAnalysis.success) {
          return res.status(502).json({ status: 'unavailable', error: 'AI service returned an invalid response.' })
        }

        await mkdir(imageDirectory, { recursive: true })
        const fileName = `${randomUUID()}.${extension}`
        storedPath = join(imageDirectory, fileName)
        await writeFile(storedPath, file.buffer, { flag: 'wx', mode: 0o600 })
        const payload = parsedAnalysis.data
        const result = await pool.query(
          `INSERT INTO crop_health_analyses
           (crop_id, image_path, provider, status, disease_name, confidence, result)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, status, disease_name, confidence, result, created_at`,
          [
            req.params.cropId,
            `crop-health/${fileName}`,
            payload.provider,
            payload.status,
            payload.disease_name ?? null,
            typeof payload.confidence === 'number' ? payload.confidence : null,
            JSON.stringify(payload),
          ],
        )
        return res.status(201).json({ analysis: result.rows[0] })
      } catch (error) {
        if (storedPath) {
          try {
            await unlink(storedPath)
          } catch (cleanupError) {
            if (
              typeof cleanupError === 'object' &&
              cleanupError !== null &&
              'code' in cleanupError &&
              cleanupError.code !== 'ENOENT'
            ) {
              console.error('Failed to remove an unrecorded crop image:', cleanupError)
            }
          }
        }
        return next(error)
      }
    },
  )

  return router
}
