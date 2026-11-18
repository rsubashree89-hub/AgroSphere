import { Router } from 'express'
import type { Pool } from 'pg'
import type { AppConfig } from '../../config/env.js'
import { requireAuth } from '../../middleware/require-auth.js'
import { fieldIdSchema, fieldInputSchema } from './field.schemas.js'

type FieldRow = {
  id: string
  farm_id: string
  farm_name: string
  field_name: string
  area: number
  area_unit: 'hectares' | 'acres' | 'square_meters'
  soil_type: string | null
  status: 'active' | 'fallow' | 'planning' | 'harvested'
  created_at: Date
  updated_at: Date
}

function toField(row: FieldRow) {
  return {
    id: row.id,
    farmId: row.farm_id,
    farmName: row.farm_name,
    fieldName: row.field_name,
    area: Number(row.area),
    areaUnit: row.area_unit,
    soilType: row.soil_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseId(value: string, res: Parameters<Parameters<Router['get']>[1]>[1]) {
  const parsed = fieldIdSchema.safeParse(value)
  if (!parsed.success) {
    res.status(400).json({ error: 'Field ID must be a valid UUID.' })
    return null
  }
  return parsed.data
}

export function createFieldsRouter(pool: Pool, config: AppConfig): Router {
  const router = Router()
  router.use(requireAuth(pool, config))

  router.get('/', async (req, res, next) => {
    try {
      const values: string[] = [req.user!.id]
      const farmFilter = typeof req.query.farmId === 'string' ? req.query.farmId : null
      if (farmFilter) {
        const validFarmId = fieldIdSchema.safeParse(farmFilter)
        if (!validFarmId.success) {
          return res.status(400).json({ error: 'Farm ID must be a valid UUID.' })
        }
        values.push(validFarmId.data)
      }
      const result = await pool.query<FieldRow>(
        `SELECT fields.id, fields.farm_id, farms.farm_name, fields.field_name,
                fields.area::float8 AS area, fields.area_unit, fields.soil_type,
                fields.status, fields.created_at, fields.updated_at
         FROM fields
         JOIN farms ON farms.id = fields.farm_id
         WHERE farms.user_id = $1 ${farmFilter ? 'AND farms.id = $2' : ''}
         ORDER BY fields.created_at DESC, fields.id`,
        values,
      )
      return res.status(200).json({ fields: result.rows.map(toField) })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/', async (req, res, next) => {
    const parsed = fieldInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Please check the field information you entered.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
    }
    const field = parsed.data

    try {
      const farm = await pool.query(
        'SELECT id FROM farms WHERE id = $1 AND user_id = $2',
        [field.farmId, req.user!.id],
      )
      if (!farm.rowCount) {
        return res.status(404).json({ error: 'Farm not found.' })
      }
      const result = await pool.query<FieldRow>(
        `INSERT INTO fields (farm_id, field_name, area, area_unit, soil_type, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, farm_id, ''::text AS farm_name, field_name,
                   area::float8 AS area, area_unit, soil_type, status, created_at, updated_at`,
        [field.farmId, field.fieldName, field.area, field.areaUnit, field.soilType, field.status],
      )
      const created = result.rows[0]
      const farmName = await pool.query<{ farm_name: string }>(
        'SELECT farm_name FROM farms WHERE id = $1 AND user_id = $2',
        [field.farmId, req.user!.id],
      )
      return res.status(201).json({
        field: toField({ ...created, farm_name: farmName.rows[0].farm_name }),
      })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/:fieldId', async (req, res, next) => {
    const id = parseId(req.params.fieldId, res)
    if (!id) return
    try {
      const result = await pool.query<FieldRow>(
        `SELECT fields.id, fields.farm_id, farms.farm_name, fields.field_name,
                fields.area::float8 AS area, fields.area_unit, fields.soil_type,
                fields.status, fields.created_at, fields.updated_at
         FROM fields JOIN farms ON farms.id = fields.farm_id
         WHERE fields.id = $1 AND farms.user_id = $2`,
        [id, req.user!.id],
      )
      if (!result.rows[0]) return res.status(404).json({ error: 'Field not found.' })
      return res.status(200).json({ field: toField(result.rows[0]) })
    } catch (error) {
      return next(error)
    }
  })

  router.put('/:fieldId', async (req, res, next) => {
    const id = parseId(req.params.fieldId, res)
    if (!id) return
    const parsed = fieldInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Please check the field information you entered.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
    }
    const field = parsed.data

    try {
      const result = await pool.query<FieldRow>(
        `UPDATE fields
         SET farm_id = $3, field_name = $4, area = $5, area_unit = $6,
             soil_type = $7, status = $8, updated_at = NOW()
         WHERE fields.id = $1 AND EXISTS (
           SELECT 1 FROM farms WHERE farms.id = fields.farm_id AND farms.user_id = $2
         )
         AND EXISTS (SELECT 1 FROM farms WHERE farms.id = $3 AND farms.user_id = $2)
         RETURNING fields.id, fields.farm_id, ''::text AS farm_name, fields.field_name,
                   fields.area::float8 AS area, fields.area_unit, fields.soil_type,
                   fields.status, fields.created_at, fields.updated_at`,
        [id, req.user!.id, field.farmId, field.fieldName, field.area, field.areaUnit, field.soilType, field.status],
      )
      if (!result.rows[0]) return res.status(404).json({ error: 'Field or farm not found.' })
      const farmName = await pool.query<{ farm_name: string }>(
        'SELECT farm_name FROM farms WHERE id = $1 AND user_id = $2',
        [field.farmId, req.user!.id],
      )
      return res.status(200).json({
        field: toField({ ...result.rows[0], farm_name: farmName.rows[0].farm_name }),
      })
    } catch (error) {
      return next(error)
    }
  })

  router.delete('/:fieldId', async (req, res, next) => {
    const id = parseId(req.params.fieldId, res)
    if (!id) return
    try {
      const result = await pool.query(
        `DELETE FROM fields
         WHERE id = $1 AND EXISTS (
           SELECT 1 FROM farms WHERE farms.id = fields.farm_id AND farms.user_id = $2
         )
         RETURNING id`,
        [id, req.user!.id],
      )
      if (!result.rows[0]) return res.status(404).json({ error: 'Field not found.' })
      return res.status(200).json({ message: 'Field deleted successfully.' })
    } catch (error) {
      return next(error)
    }
  })

  return router
}
