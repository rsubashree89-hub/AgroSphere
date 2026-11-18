import { z } from 'zod'

export const fieldIdSchema = z.string().uuid()

export const fieldInputSchema = z
  .object({
    farmId: z.string().uuid(),
    fieldName: z.string().trim().min(2).max(100),
    area: z.number().finite().positive().max(9999999999.99),
    areaUnit: z.enum(['hectares', 'acres', 'square_meters']),
    soilType: z.string().trim().max(80).nullable().optional(),
    status: z.enum(['active', 'fallow', 'planning', 'harvested']).default('active'),
  })
  .strict()
  .transform((field) => ({ ...field, soilType: field.soilType || null }))
