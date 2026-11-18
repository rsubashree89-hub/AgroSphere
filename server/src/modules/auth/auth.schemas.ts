import { Buffer } from 'node:buffer'
import { z } from 'zod'

const emailSchema = z
  .email('Enter a valid email address')
  .max(254)
  .transform((email) => email.toLowerCase())

const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .refine(
    (password) => Buffer.byteLength(password, 'utf8') <= 72,
    'Password must be no more than 72 bytes',
  )

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict()

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(1, 'Password is required')
      .refine(
        (password) => Buffer.byteLength(password, 'utf8') <= 72,
        'Password must be no more than 72 bytes',
      ),
  })
  .strict()

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
