import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema } from './auth.schemas.js'

describe('registration input', () => {
  it('trims the name and normalizes the email address', () => {
    const result = registerSchema.parse({
      name: '  Alex Green  ',
      email: 'ALEX@example.com',
      password: 'a-secure-password',
    })

    expect(result).toEqual({
      name: 'Alex Green',
      email: 'alex@example.com',
      password: 'a-secure-password',
    })
  })

  it('rejects short passwords, oversized bcrypt inputs, and extra fields', () => {
    expect(
      registerSchema.safeParse({
        name: 'Alex',
        email: 'alex@example.com',
        password: 'too-short',
      }).success,
    ).toBe(false)
    expect(
      registerSchema.safeParse({
        name: 'Alex',
        email: 'alex@example.com',
        password: '🌱'.repeat(19),
      }).success,
    ).toBe(false)
    expect(
      registerSchema.safeParse({
        name: 'Alex',
        email: 'alex@example.com',
        password: 'a-secure-password',
        role: 'admin',
      }).success,
    ).toBe(false)
  })
})

describe('login input', () => {
  it('normalizes email without applying the registration password policy', () => {
    const result = loginSchema.parse({
      email: 'ALEX@example.com',
      password: 'existing-password',
    })

    expect(result.email).toBe('alex@example.com')
  })
})
