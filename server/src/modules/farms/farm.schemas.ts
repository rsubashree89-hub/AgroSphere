import { z } from 'zod'

export const farmIdSchema = z.string().uuid()

export const farmInputSchema = z
  .object({
    farmName: z.string().trim().min(2, 'Farm name must be at least 2 characters').max(100),
    location: z.string().trim().min(2, 'Location is required').max(160),
    totalArea: z.number().finite().positive().max(9999999999.99),
    areaUnit: z.enum(['hectares', 'acres', 'square_meters']),
    soilType: z.string().trim().max(80).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .transform((farm) => ({
    ...farm,
    soilType: farm.soilType || null,
    description: farm.description || null,
  }))

export type FarmInput = z.infer<typeof farmInputSchema>
