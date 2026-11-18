import { z } from 'zod'

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  PGHOST: z.string().min(1).default('localhost'),
  PGPORT: z.coerce.number().int().min(1).max(65535).default(5432),
  PGDATABASE: z.string().min(1).default('agrosphere_db'),
  PGUSER: z.string().min(1).default('postgres'),
  PGPASSWORD: z.string().optional(),
  PGSSLMODE: z.enum(['disable', 'verify-full']).default('disable'),
  PGSSLROOTCERT: z.string().optional(),
  AI_SERVICE_URL: z.url().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
}).superRefine((config, context) => {
  if (config.NODE_ENV === 'production' && config.PGSSLMODE !== 'verify-full') {
    context.addIssue({
      code: 'custom',
      path: ['PGSSLMODE'],
      message: 'Production deployments must use PGSSLMODE=verify-full.',
    })
  }
  if (config.NODE_ENV === 'production' && !config.APP_ORIGIN.startsWith('https://')) {
    context.addIssue({
      code: 'custom',
      path: ['APP_ORIGIN'],
      message: 'Production deployments must use an HTTPS APP_ORIGIN.',
    })
  }
  if (config.NODE_ENV === 'production' && config.JWT_SECRET.startsWith('replace-this')) {
    context.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'Replace the example JWT_SECRET before production deployment.',
    })
  }
})

export type AppConfig = z.infer<typeof environmentSchema>

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(source)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid server configuration: ${details}`)
  }
  return parsed.data
}
