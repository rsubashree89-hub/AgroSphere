import { Router, type Request, type Response } from 'express'
import type { Pool } from 'pg'
import type { AppConfig } from '../../config/env.js'
import { requireAuth } from '../../middleware/require-auth.js'
import { farmIdSchema, farmInputSchema } from './farm.schemas.js'

type FarmRow = {
  id: string
  user_id: string
  farm_name: string
  location: string
  total_area: number
  area_unit: 'hectares' | 'acres' | 'square_meters'
  soil_type: string | null
  description: string | null
  created_at: Date
  updated_at: Date
}

function toFarm(row: FarmRow) {
  return {
    id: row.id,
    farmName: row.farm_name,
    location: row.location,
    totalArea: Number(row.total_area),
    areaUnit: row.area_unit,
    soilType: row.soil_type,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rejectForeignOrigin(req: Request, res: Response, config: AppConfig): boolean {
  const origin = req.get('origin')
  if (origin && origin !== config.APP_ORIGIN) {
    res.status(403).json({ error: 'Request origin is not allowed.' })
    return true
  }
  return false
}

function validateFarmId(value: string, res: Response): string | null {
  const parsed = farmIdSchema.safeParse(value)
  if (!parsed.success) {
    res.status(400).json({ error: 'Farm ID must be a valid UUID.' })
    return null
  }
  return parsed.data
}

function parseFarmInput(body: unknown, res: Response) {
  const parsed = farmInputSchema.safeParse(body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Please check the farm information you entered.',
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    })
    return null
  }
  return parsed.data
}

export function createFarmsRouter(pool: Pool, config: AppConfig): Router {
  const router = Router()
  router.use(requireAuth(pool, config))

  router.get('/summary', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM farms WHERE user_id = $1) AS farm_count,
           (SELECT COALESCE(SUM(total_area), 0)::float8 FROM farms WHERE user_id = $1) AS total_area,
           (SELECT COUNT(*)::int FROM fields
            JOIN farms ON farms.id = fields.farm_id WHERE farms.user_id = $1) AS field_count,
           (SELECT COUNT(*)::int FROM crops
            JOIN fields ON fields.id = crops.field_id
            JOIN farms ON farms.id = fields.farm_id WHERE farms.user_id = $1) AS crop_count`,
        [req.user!.id],
      )
      const cropsByStage = await pool.query(
        `SELECT crops.growth_stage, COUNT(*)::int AS count
         FROM crops
         JOIN fields ON fields.id = crops.field_id
         JOIN farms ON farms.id = fields.farm_id
         WHERE farms.user_id = $1
         GROUP BY crops.growth_stage ORDER BY crops.growth_stage`,
        [req.user!.id],
      )
      return res.status(200).json({ summary: result.rows[0], cropsByStage: cropsByStage.rows })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/', async (req, res, next) => {
    try {
      const result = await pool.query<FarmRow>(
        `SELECT id, user_id, farm_name, location, total_area::float8 AS total_area,
                area_unit, soil_type, description, created_at, updated_at
         FROM farms
         WHERE user_id = $1
         ORDER BY created_at DESC, id`,
        [req.user!.id],
      )
      return res.status(200).json({ farms: result.rows.map(toFarm) })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/', async (req, res, next) => {
    if (rejectForeignOrigin(req, res, config)) return
    const farm = parseFarmInput(req.body, res)
    if (!farm) return

    try {
      const result = await pool.query<FarmRow>(
        `INSERT INTO farms (user_id, farm_name, location, total_area, area_unit, soil_type, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, user_id, farm_name, location, total_area::float8 AS total_area,
                   area_unit, soil_type, description, created_at, updated_at`,
        [
          req.user!.id,
          farm.farmName,
          farm.location,
          farm.totalArea,
          farm.areaUnit,
          farm.soilType,
          farm.description,
        ],
      )
      return res.status(201).json({ farm: toFarm(result.rows[0]) })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/:farmId', async (req, res, next) => {
    const farmId = validateFarmId(req.params.farmId, res)
    if (!farmId) return

    try {
      const result = await pool.query<FarmRow>(
        `SELECT id, user_id, farm_name, location, total_area::float8 AS total_area,
                area_unit, soil_type, description, created_at, updated_at
         FROM farms
         WHERE id = $1 AND user_id = $2`,
        [farmId, req.user!.id],
      )
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Farm not found.' })
      }
      return res.status(200).json({ farm: toFarm(result.rows[0]) })
    } catch (error) {
      return next(error)
    }
  })

  router.put('/:farmId', async (req, res, next) => {
    if (rejectForeignOrigin(req, res, config)) return
    const farmId = validateFarmId(req.params.farmId, res)
    if (!farmId) return
    const farm = parseFarmInput(req.body, res)
    if (!farm) return

    try {
      const result = await pool.query<FarmRow>(
        `UPDATE farms
         SET farm_name = $3, location = $4, total_area = $5, area_unit = $6,
             soil_type = $7, description = $8, updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id, user_id, farm_name, location, total_area::float8 AS total_area,
                   area_unit, soil_type, description, created_at, updated_at`,
        [
          farmId,
          req.user!.id,
          farm.farmName,
          farm.location,
          farm.totalArea,
          farm.areaUnit,
          farm.soilType,
          farm.description,
        ],
      )
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Farm not found.' })
      }
      return res.status(200).json({ farm: toFarm(result.rows[0]) })
    } catch (error) {
      return next(error)
    }
  })

  router.delete('/:farmId', async (req, res, next) => {
    if (rejectForeignOrigin(req, res, config)) return
    const farmId = validateFarmId(req.params.farmId, res)
    if (!farmId) return

    try {
      const result = await pool.query(
        'DELETE FROM farms WHERE id = $1 AND user_id = $2 RETURNING id',
        [farmId, req.user!.id],
      )
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Farm not found.' })
      }
      return res.status(200).json({ message: 'Farm deleted successfully.' })
    } catch (error) {
      return next(error)
    }
  })

  return router
}
