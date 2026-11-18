import { Router, type Request, type Response } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { requireAuth } from '../../middleware/require-auth.js'
import { buildReportCsv, buildReportPdf, reportDateRangeSchema, type FarmReportRow } from './report-utils.js'

const uuidSchema = z.string().uuid()

function rejectForeignOrigin(req: Request, res: Response, config: AppConfig) {
  const origin = req.get('origin')
  if (origin && origin !== config.APP_ORIGIN) {
    res.status(403).json({ error: 'Request origin is not allowed.' })
    return true
  }
  return false
}

function ownedFarmQuery() {
  return `SELECT farms.id, farms.farm_name, farms.location
          FROM farms WHERE farms.id = $1 AND farms.user_id = $2`
}

export function createOperationsRouter(pool: Pool, config: AppConfig): Router {
  const router = Router()
  router.use(requireAuth(pool, config))

  router.get('/dashboard', async (req, res, next) => {
    try {
      const farms = await pool.query(
        `SELECT COUNT(*)::int AS farm_count,
                COALESCE(SUM(total_area), 0)::float8 AS total_area
         FROM farms WHERE user_id = $1`,
        [req.user!.id],
      )
      const fieldCrop = await pool.query(
        `SELECT COUNT(DISTINCT fields.id)::int AS field_count,
                COUNT(crops.id)::int AS crop_count
         FROM farms LEFT JOIN fields ON fields.farm_id = farms.id
         LEFT JOIN crops ON crops.field_id = fields.id
         WHERE farms.user_id = $1`,
        [req.user!.id],
      )
      const stages = await pool.query(
        `SELECT crops.growth_stage AS name, COUNT(*)::int AS value
         FROM crops JOIN fields ON fields.id = crops.field_id
         JOIN farms ON farms.id = fields.farm_id
         WHERE farms.user_id = $1 GROUP BY crops.growth_stage ORDER BY crops.growth_stage`,
        [req.user!.id],
      )
      const activity = await pool.query(
        `SELECT 'crop' AS kind, crops.crop_name AS title, crops.updated_at AS happened_at,
                farms.farm_name AS context
         FROM crops JOIN fields ON fields.id = crops.field_id
         JOIN farms ON farms.id = fields.farm_id
         WHERE farms.user_id = $1
         UNION ALL
         SELECT 'irrigation', 'Irrigation recorded', irrigation_records.recorded_at, fields.field_name
         FROM irrigation_records JOIN fields ON fields.id = irrigation_records.field_id
         JOIN farms ON farms.id = fields.farm_id
         WHERE farms.user_id = $1
         ORDER BY happened_at DESC LIMIT 6`,
        [req.user!.id],
      )
      const notifications = await pool.query(
        `SELECT id, notification_type, title, message, read_at, created_at
         FROM notifications WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [req.user!.id],
      )
      return res.status(200).json({
        summary: { ...farms.rows[0], ...fieldCrop.rows[0] },
        cropsByStage: stages.rows,
        activity: activity.rows,
        notifications: notifications.rows,
      })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/weather/:farmId', async (req, res, next) => {
    const farmId = uuidSchema.safeParse(req.params.farmId)
    if (!farmId.success) return res.status(400).json({ error: 'Farm ID must be a valid UUID.' })
    try {
      const owned = await pool.query<{ id: string; farm_name: string; location: string }>(
        ownedFarmQuery(),
        [farmId.data, req.user!.id],
      )
      const farm = owned.rows[0]
      if (!farm) return res.status(404).json({ error: 'Farm not found.' })

      const geocodeUrl = new URL('https://geocoding-api.open-meteo.com/v1/search')
      geocodeUrl.search = new URLSearchParams({ name: farm.location, count: '1', language: 'en', format: 'json' }).toString()
      const geocodeResponse = await fetch(geocodeUrl, { signal: AbortSignal.timeout(8000) })
      if (!geocodeResponse.ok) return res.status(502).json({ error: 'Weather location lookup is unavailable.' })
      const geocode = await geocodeResponse.json() as { results?: Array<{ latitude: number; longitude: number; name: string; country?: string }> }
      const place = geocode.results?.[0]
      if (!place) return res.status(422).json({ error: 'Could not locate this farm location for weather lookup. Update the farm location to a town or city.' })

      const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast')
      forecastUrl.search = new URLSearchParams({
        latitude: String(place.latitude),
        longitude: String(place.longitude),
        current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
        timezone: 'auto',
        forecast_days: '5',
      }).toString()
      const forecastResponse = await fetch(forecastUrl, { signal: AbortSignal.timeout(8000) })
      if (!forecastResponse.ok) return res.status(502).json({ error: 'Weather provider did not return a forecast.' })
      const data = await forecastResponse.json() as {
        current?: { time: string; temperature_2m: number; relative_humidity_2m: number; precipitation: number; weather_code: number }
        daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[]; precipitation_probability_max: number[] }
      }
      if (!data.current || !data.daily) {
        return res.status(502).json({ error: 'Weather provider returned an incomplete forecast.' })
      }
      const weatherCode = data.current.weather_code
      const condition = weatherCode === 0 ? 'Clear'
        : [1, 2, 3].includes(weatherCode) ? 'Partly cloudy'
          : [45, 48].includes(weatherCode) ? 'Fog'
            : [51, 53, 55, 56, 57].includes(weatherCode) ? 'Drizzle'
              : [61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode) ? 'Rain'
                : [71, 73, 75, 77, 85, 86].includes(weatherCode) ? 'Snow'
                  : [95, 96, 99].includes(weatherCode) ? 'Thunderstorm' : 'Unknown'
      const current = {
        observedAt: data.current.time,
        temperatureC: data.current.temperature_2m,
        humidityPercent: data.current.relative_humidity_2m,
        rainfallMm: data.current.precipitation,
        condition,
      }
      const forecast = data.daily.time.map((date, index) => ({
        date,
        highC: data.daily!.temperature_2m_max[index],
        lowC: data.daily!.temperature_2m_min[index],
        rainfallMm: data.daily!.precipitation_sum[index],
        rainProbabilityPercent: data.daily!.precipitation_probability_max[index],
      }))
      const suggestion = current.rainfallMm > 0
        ? 'Rainfall is being recorded now; check field conditions before irrigating.'
        : current.humidityPercent < 35
          ? 'Low relative humidity: check soil moisture and plant stress before irrigation.'
          : 'Review field-level soil moisture before scheduling irrigation.'
      await pool.query(
        `INSERT INTO weather_records
         (farm_id, provider, observed_at, temperature_c, humidity_percent, rainfall_mm, raw_data)
         VALUES ($1, 'open-meteo', $2, $3, $4, $5, $6)
         ON CONFLICT (farm_id, provider, observed_at) DO NOTHING`,
        [farm.id, current.observedAt, current.temperatureC, current.humidityPercent, current.rainfallMm, JSON.stringify({ condition, forecast })],
      )
      return res.status(200).json({
        farm: { id: farm.id, name: farm.farm_name },
        location: { name: place.name, country: place.country ?? null, latitude: place.latitude, longitude: place.longitude },
        provider: 'Open-Meteo',
        attribution: 'Weather data by Open-Meteo (open-meteo.com)',
        current,
        forecast,
        suggestion,
      })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/irrigation', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT irrigation_records.id, irrigation_records.field_id, fields.field_name,
                farms.id AS farm_id, farms.farm_name, irrigation_records.moisture_percent,
                irrigation_records.moisture_source, irrigation_records.water_liters,
                irrigation_records.recommendation, irrigation_records.notes,
                irrigation_records.recorded_at
         FROM irrigation_records JOIN fields ON fields.id = irrigation_records.field_id
         JOIN farms ON farms.id = fields.farm_id
         WHERE farms.user_id = $1 ORDER BY irrigation_records.recorded_at DESC LIMIT 100`,
        [req.user!.id],
      )
      return res.status(200).json({ records: result.rows })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/irrigation', async (req, res, next) => {
    if (rejectForeignOrigin(req, res, config)) return
    const schema = z.object({
      fieldId: uuidSchema,
      moisturePercent: z.number().min(0).max(100).optional(),
      waterLiters: z.number().min(0).max(999999999).default(0),
      notes: z.string().trim().max(1000).nullable().optional(),
      simulateMoisture: z.boolean().default(false),
    }).strict()
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid irrigation record.', details: parsed.error.issues })
    const input = parsed.data
    if (input.moisturePercent === undefined && !input.simulateMoisture) {
      return res.status(400).json({ error: 'Provide a moisture reading or explicitly enable the labeled simulator.' })
    }
    try {
      const owned = await pool.query(
        `SELECT fields.id FROM fields JOIN farms ON farms.id = fields.farm_id
         WHERE fields.id = $1 AND farms.user_id = $2`,
        [input.fieldId, req.user!.id],
      )
      if (!owned.rowCount) return res.status(404).json({ error: 'Field not found.' })
      const moisture = input.moisturePercent ?? Math.round((25 + Math.random() * 45) * 10) / 10
      const source = input.simulateMoisture && input.moisturePercent === undefined ? 'simulator' : 'manual'
      const recommendation = moisture < 30
        ? 'Moisture reading is low. Consider inspecting this field and scheduling irrigation.'
        : moisture > 75
          ? 'Moisture reading is high. Defer irrigation and recheck field conditions.'
          : 'Moisture reading is within the configured observation range. Recheck regularly.'
      const result = await pool.query(
        `INSERT INTO irrigation_records (field_id, moisture_percent, moisture_source, water_liters, recommendation, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, field_id, moisture_percent, moisture_source, water_liters, recommendation, notes, recorded_at`,
        [input.fieldId, moisture, source, input.waterLiters, recommendation, input.notes ?? null],
      )
      return res.status(201).json({ record: result.rows[0], simulatorNotice: source === 'simulator' ? 'Moisture is simulated for demonstration; no sensor is connected.' : null })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/market-prices', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT market_prices.id, market_prices.crop_id, crops.crop_name,
                market_prices.market_name, market_prices.price, market_prices.currency,
                market_prices.unit, market_prices.source, market_prices.observed_at
         FROM market_prices JOIN crops ON crops.id = market_prices.crop_id
         JOIN fields ON fields.id = crops.field_id JOIN farms ON farms.id = fields.farm_id
         WHERE farms.user_id = $1 ORDER BY market_prices.observed_at DESC LIMIT 200`,
        [req.user!.id],
      )
      return res.status(200).json({ prices: result.rows })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/market-prices', async (req, res, next) => {
    if (rejectForeignOrigin(req, res, config)) return
    const schema = z.object({
      cropId: uuidSchema,
      marketName: z.string().trim().min(2).max(120),
      price: z.number().min(0).max(9999999999),
      currency: z.string().regex(/^[A-Z]{3}$/),
      unit: z.string().trim().min(1).max(32),
      observedAt: z.iso.datetime().optional(),
    }).strict()
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid market price.', details: parsed.error.issues })
    try {
      const owned = await pool.query(
        `SELECT crops.id FROM crops JOIN fields ON fields.id = crops.field_id
         JOIN farms ON farms.id = fields.farm_id
         WHERE crops.id = $1 AND farms.user_id = $2`,
        [parsed.data.cropId, req.user!.id],
      )
      if (!owned.rowCount) return res.status(404).json({ error: 'Crop not found.' })
      const { cropId, marketName, price, currency, unit, observedAt } = parsed.data
      const result = await pool.query(
        `INSERT INTO market_prices (crop_id, market_name, price, currency, unit, source, observed_at)
         VALUES ($1, $2, $3, $4, $5, 'user_reported', COALESCE($6::timestamptz, NOW()))
         RETURNING id, crop_id, market_name, price, currency, unit, source, observed_at`,
        [cropId, marketName, price, currency, unit, observedAt ?? null],
      )
      return res.status(201).json({ price: result.rows[0], dataNotice: 'User-reported price; not a live market feed.' })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/notifications', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT id, notification_type, title, message, read_at, created_at
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [req.user!.id],
      )
      return res.status(200).json({ notifications: result.rows })
    } catch (error) {
      return next(error)
    }
  })

  router.patch('/notifications/:notificationId/read', async (req, res, next) => {
    if (rejectForeignOrigin(req, res, config)) return
    const id = uuidSchema.safeParse(req.params.notificationId)
    if (!id.success) return res.status(400).json({ error: 'Notification ID must be a valid UUID.' })
    try {
      const result = await pool.query(
        `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
         WHERE id = $1 AND user_id = $2
         RETURNING id, notification_type, title, message, read_at, created_at`,
        [id.data, req.user!.id],
      )
      if (!result.rows[0]) return res.status(404).json({ error: 'Notification not found.' })
      return res.status(200).json({ notification: result.rows[0] })
    } catch (error) {
      return next(error)
    }
  })

  async function reportRows(userId: string, from?: string, to?: string) {
    const result = await pool.query<FarmReportRow>(
      `WITH farm_counts AS (
         SELECT farms.id AS farm_id, farms.farm_name, farms.total_area::float8 AS total_area,
                farms.area_unit,
                COUNT(DISTINCT fields.id) FILTER (
                  WHERE ($2::date IS NULL OR fields.created_at >= $2::date)
                    AND ($3::date IS NULL OR fields.created_at < $3::date + INTERVAL '1 day')
                )::int AS field_count,
                COUNT(DISTINCT crops.id) FILTER (
                  WHERE ($2::date IS NULL OR crops.created_at >= $2::date)
                    AND ($3::date IS NULL OR crops.created_at < $3::date + INTERVAL '1 day')
                )::int AS crop_count,
                COUNT(DISTINCT crops.id) FILTER (
                  WHERE crops.growth_stage = 'harvested'
                    AND ($2::date IS NULL OR crops.updated_at >= $2::date)
                    AND ($3::date IS NULL OR crops.updated_at < $3::date + INTERVAL '1 day')
                )::int AS harvested_crop_count
         FROM farms LEFT JOIN fields ON fields.farm_id = farms.id
         LEFT JOIN crops ON crops.field_id = fields.id
         WHERE farms.user_id = $1
         GROUP BY farms.id
       ), water_totals AS (
         SELECT farms.id AS farm_id,
                COALESCE(SUM(irrigation_records.water_liters) FILTER (
                  WHERE ($2::date IS NULL OR irrigation_records.recorded_at >= $2::date)
                    AND ($3::date IS NULL OR irrigation_records.recorded_at < $3::date + INTERVAL '1 day')
                ), 0)::float8 AS recorded_water_liters
         FROM farms LEFT JOIN fields ON fields.farm_id = farms.id
         LEFT JOIN irrigation_records ON irrigation_records.field_id = fields.id
         WHERE farms.user_id = $1
         GROUP BY farms.id
       )
       SELECT farm_counts.*, water_totals.recorded_water_liters
       FROM farm_counts JOIN water_totals USING (farm_id)
       ORDER BY farm_counts.farm_name`,
      [userId, from ?? null, to ?? null],
    )
    return result.rows
  }

  function parseReportRange(req: Request, res: Response) {
    const parsed = reportDateRangeSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({
        error: 'Provide valid ISO dates; the end date must not precede the start date.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
      return null
    }
    return parsed.data
  }

  router.get('/reports/summary', async (req, res, next) => {
    const range = parseReportRange(req, res)
    if (!range) return
    try {
      const farms = await reportRows(req.user!.id, range.from, range.to)
      return res.status(200).json({
        farms,
        period: { from: range.from ?? null, to: range.to ?? null },
        generatedAt: new Date().toISOString(),
      })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/reports/export/:format', async (req, res, next) => {
    const range = parseReportRange(req, res)
    if (!range) return
    const format = z.enum(['csv', 'pdf']).safeParse(req.params.format)
    if (!format.success) return res.status(400).json({ error: 'Report format must be csv or pdf.' })
    try {
      const farms = await reportRows(req.user!.id, range.from, range.to)
      const filename = `agrosphere-report-${range.from ?? 'all'}-${range.to ?? 'all'}.${format.data}`
      if (format.data === 'csv') {
        return res
          .status(200)
          .type('text/csv')
          .attachment(filename)
          .send(buildReportCsv(farms, range.from, range.to))
      }
      return res
        .status(200)
        .type('application/pdf')
        .attachment(filename)
        .send(buildReportPdf(farms, range.from, range.to))
    } catch (error) {
      return next(error)
    }
  })

  router.get('/admin/overview', async (req, res, next) => {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access is required.' })
    }
    try {
      const result = await pool.query(
        `SELECT (SELECT COUNT(*)::int FROM users) AS user_count,
                (SELECT COUNT(*)::int FROM users WHERE is_active) AS active_user_count,
                (SELECT COUNT(*)::int FROM users WHERE NOT is_active) AS disabled_user_count,
                (SELECT COUNT(*)::int FROM farms) AS farm_count,
                (SELECT COUNT(*)::int FROM fields) AS field_count,
                (SELECT COUNT(*)::int FROM crops) AS crop_count,
                (SELECT COUNT(*)::int FROM notifications WHERE read_at IS NULL) AS unread_notification_count`,
      )
      return res.status(200).json({ overview: result.rows[0] })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/admin/users', async (req, res, next) => {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access is required.' })
    }
    try {
      const result = await pool.query(
        `SELECT users.id, users.name, users.email, users.role, users.is_active, users.created_at,
                COUNT(DISTINCT farms.id)::int AS farm_count
         FROM users LEFT JOIN farms ON farms.user_id = users.id
         GROUP BY users.id ORDER BY users.created_at DESC LIMIT 200`,
      )
      return res.status(200).json({ users: result.rows })
    } catch (error) {
      return next(error)
    }
  })

  router.patch('/admin/users/:userId/active', async (req, res, next) => {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access is required.' })
    }
    if (rejectForeignOrigin(req, res, config)) return
    const id = uuidSchema.safeParse(req.params.userId)
    const input = z.object({ active: z.boolean() }).strict().safeParse(req.body)
    if (!id.success) return res.status(400).json({ error: 'User ID must be a valid UUID.' })
    if (!input.success) return res.status(400).json({ error: 'Provide an active boolean value.' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1)', [734921085])
      const target = await client.query<{ role: string; is_active: boolean }>(
        'SELECT role, is_active FROM users WHERE id = $1 FOR UPDATE',
        [id.data],
      )
      if (!target.rows[0]) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'User not found.' })
      }
      if (!input.data.active && target.rows[0].role === 'admin' && target.rows[0].is_active) {
        const admins = await client.query<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active",
        )
        if (admins.rows[0].count <= 1) {
          await client.query('ROLLBACK')
          return res.status(409).json({ error: 'The last active administrator cannot be disabled.' })
        }
      }
      const updated = await client.query(
        'UPDATE users SET is_active = $2 WHERE id = $1 RETURNING id, name, email, role, is_active, created_at',
        [id.data, input.data.active],
      )
      if (!input.data.active) {
        await client.query(
          'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1 AND revoked_at IS NULL',
          [id.data],
        )
      }
      await client.query(
        `INSERT INTO admin_audit_events (actor_user_id, target_user_id, action, details)
         VALUES ($1, $2, $3, $4)`,
        [req.user!.id, id.data, input.data.active ? 'user.enabled' : 'user.disabled', JSON.stringify({ active: input.data.active })],
      )
      await client.query('COMMIT')
      return res.status(200).json({ user: updated.rows[0] })
    } catch (error) {
      await client.query('ROLLBACK').catch((rollbackError: unknown) => {
        console.error('Failed to roll back admin user update:', rollbackError)
      })
      return next(error)
    } finally {
      client.release()
    }
  })

  router.get('/admin/activity', async (req, res, next) => {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access is required.' })
    }
    try {
      const result = await pool.query(
        `SELECT admin_audit_events.id, admin_audit_events.action, admin_audit_events.details,
                admin_audit_events.created_at, actor.email AS actor_email,
                target.email AS target_email
         FROM admin_audit_events
         LEFT JOIN users AS actor ON actor.id = admin_audit_events.actor_user_id
         LEFT JOIN users AS target ON target.id = admin_audit_events.target_user_id
         ORDER BY admin_audit_events.created_at DESC LIMIT 100`,
      )
      return res.status(200).json({ events: result.rows })
    } catch (error) {
      return next(error)
    }
  })

  return router
}
