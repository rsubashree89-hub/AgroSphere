import { Router } from 'express'
import type { Pool } from 'pg'
import type { AppConfig } from '../../config/env.js'
import { requireAuth } from '../../middleware/require-auth.js'
import { cropIdSchema, cropInputSchema } from './crop.schemas.js'

type CropRow = {
  id: string
  field_id: string
  field_name: string
  farm_id: string
  farm_name: string
  crop_name: string
  variety: string | null
  planting_date: string | null
  expected_harvest_date: string | null
  growth_stage: string
  notes: string | null
  created_at: Date
  updated_at: Date
}

function toCrop(row: CropRow) {
  return {
    id: row.id,
    fieldId: row.field_id,
    fieldName: row.field_name,
    farmId: row.farm_id,
    farmName: row.farm_name,
    cropName: row.crop_name,
    variety: row.variety,
    plantingDate: row.planting_date,
    expectedHarvestDate: row.expected_harvest_date,
    growthStage: row.growth_stage,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseId(value: string, res: Parameters<Parameters<Router['get']>[1]>[1]) {
  const parsed = cropIdSchema.safeParse(value)
  if (!parsed.success) {
    res.status(400).json({ error: 'Crop ID must be a valid UUID.' })
    return null
  }
  return parsed.data
}

const cropSelect = `SELECT crops.id, crops.field_id, fields.field_name, farms.id AS farm_id,
       farms.farm_name, crops.crop_name, crops.variety,
       crops.planting_date::text AS planting_date,
       crops.expected_harvest_date::text AS expected_harvest_date,
       crops.growth_stage, crops.notes, crops.created_at, crops.updated_at
FROM crops
JOIN fields ON fields.id = crops.field_id
JOIN farms ON farms.id = fields.farm_id`

export function createCropsRouter(pool: Pool, config: AppConfig): Router {
  const router = Router()
  router.use(requireAuth(pool, config))

  router.get('/', async (req, res, next) => {
    try {
      const values: string[] = [req.user!.id]
      const fieldId = typeof req.query.fieldId === 'string' ? req.query.fieldId : null
      if (fieldId) {
        const validId = cropIdSchema.safeParse(fieldId)
        if (!validId.success) return res.status(400).json({ error: 'Field ID must be a valid UUID.' })
        values.push(validId.data)
      }
      const result = await pool.query<CropRow>(
        `${cropSelect}
         WHERE farms.user_id = $1 ${fieldId ? 'AND fields.id = $2' : ''}
         ORDER BY crops.created_at DESC, crops.id`,
        values,
      )
      return res.status(200).json({ crops: result.rows.map(toCrop) })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/', async (req, res, next) => {
    const parsed = cropInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Please check the crop information you entered.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
    }
    const crop = parsed.data
    try {
      const field = await pool.query('SELECT id FROM fields WHERE id = $1 AND EXISTS (SELECT 1 FROM farms WHERE farms.id = fields.farm_id AND farms.user_id = $2)', [crop.fieldId, req.user!.id])
      if (!field.rowCount) return res.status(404).json({ error: 'Field not found.' })
      const created = await pool.query(
        `INSERT INTO crops (field_id, crop_name, variety, planting_date, expected_harvest_date, growth_stage, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [crop.fieldId, crop.cropName, crop.variety, crop.plantingDate, crop.expectedHarvestDate, crop.growthStage, crop.notes],
      )
      const cropId = created.rows[0].id as string
      await pool.query(
        `INSERT INTO crop_records (crop_id, record_type, details)
         VALUES ($1, 'created', $2)`,
        [cropId, `Crop record created at ${crop.growthStage} stage.`],
      )
      const result = await pool.query<CropRow>(`${cropSelect} WHERE crops.id = $1 AND farms.user_id = $2`, [cropId, req.user!.id])
      return res.status(201).json({ crop: toCrop(result.rows[0]) })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/:cropId/records', async (req, res, next) => {
    const id = parseId(req.params.cropId, res)
    if (!id) return
    try {
      const result = await pool.query(
        `SELECT crop_records.id, crop_records.record_type, crop_records.details, crop_records.recorded_at
         FROM crop_records JOIN crops ON crops.id = crop_records.crop_id
         JOIN fields ON fields.id = crops.field_id JOIN farms ON farms.id = fields.farm_id
         WHERE crops.id = $1 AND farms.user_id = $2
         ORDER BY crop_records.recorded_at DESC`,
        [id, req.user!.id],
      )
      return res.status(200).json({ records: result.rows })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/:cropId', async (req, res, next) => {
    const id = parseId(req.params.cropId, res)
    if (!id) return
    try {
      const result = await pool.query<CropRow>(`${cropSelect} WHERE crops.id = $1 AND farms.user_id = $2`, [id, req.user!.id])
      if (!result.rows[0]) return res.status(404).json({ error: 'Crop not found.' })
      return res.status(200).json({ crop: toCrop(result.rows[0]) })
    } catch (error) {
      return next(error)
    }
  })

  router.put('/:cropId', async (req, res, next) => {
    const id = parseId(req.params.cropId, res)
    if (!id) return
    const parsed = cropInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Please check the crop information you entered.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
    }
    const crop = parsed.data
    try {
      const result = await pool.query(
        `UPDATE crops
         SET field_id = $3, crop_name = $4, variety = $5, planting_date = $6,
             expected_harvest_date = $7, growth_stage = $8, notes = $9, updated_at = NOW()
         WHERE crops.id = $1 AND EXISTS (
           SELECT 1 FROM fields JOIN farms ON farms.id = fields.farm_id
           WHERE fields.id = crops.field_id AND farms.user_id = $2
         ) AND EXISTS (
           SELECT 1 FROM fields JOIN farms ON farms.id = fields.farm_id
           WHERE fields.id = $3 AND farms.user_id = $2
         )
         RETURNING crops.id`,
        [id, req.user!.id, crop.fieldId, crop.cropName, crop.variety, crop.plantingDate, crop.expectedHarvestDate, crop.growthStage, crop.notes],
      )
      if (!result.rows[0]) return res.status(404).json({ error: 'Crop or field not found.' })
      await pool.query(
        `INSERT INTO crop_records (crop_id, record_type, details)
         VALUES ($1, 'stage_change', $2)`,
        [id, `Crop details updated; current stage: ${crop.growthStage}.`],
      )
      const updated = await pool.query<CropRow>(`${cropSelect} WHERE crops.id = $1 AND farms.user_id = $2`, [id, req.user!.id])
      return res.status(200).json({ crop: toCrop(updated.rows[0]) })
    } catch (error) {
      return next(error)
    }
  })

  router.delete('/:cropId', async (req, res, next) => {
    const id = parseId(req.params.cropId, res)
    if (!id) return
    try {
      const result = await pool.query(
        `DELETE FROM crops
         WHERE crops.id = $1 AND EXISTS (
           SELECT 1 FROM fields JOIN farms ON farms.id = fields.farm_id
           WHERE fields.id = crops.field_id AND farms.user_id = $2
         ) RETURNING id`,
        [id, req.user!.id],
      )
      if (!result.rows[0]) return res.status(404).json({ error: 'Crop not found.' })
      return res.status(200).json({ message: 'Crop deleted successfully.' })
    } catch (error) {
      return next(error)
    }
  })

  return router
}
