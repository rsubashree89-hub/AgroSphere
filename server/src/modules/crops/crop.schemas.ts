import { z } from 'zod'

export const cropIdSchema = z.string().uuid()

export const cropInputSchema = z
  .object({
    fieldId: z.string().uuid(),
    cropName: z.string().trim().min(2).max(100),
    variety: z.string().trim().max(100).nullable().optional(),
    plantingDate: z.iso.date().nullable().optional(),
    expectedHarvestDate: z.iso.date().nullable().optional(),
    growthStage: z.enum([
      'planned',
      'seedling',
      'vegetative',
      'flowering',
      'fruiting',
      'maturing',
      'harvested',
    ]).default('planned'),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (crop) =>
      !crop.plantingDate ||
      !crop.expectedHarvestDate ||
      crop.expectedHarvestDate >= crop.plantingDate,
    { path: ['expectedHarvestDate'], message: 'Harvest date must be on or after planting date.' },
  )
  .transform((crop) => ({
    ...crop,
    variety: crop.variety || null,
    plantingDate: crop.plantingDate || null,
    expectedHarvestDate: crop.expectedHarvestDate || null,
    notes: crop.notes || null,
  }))
