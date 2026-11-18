import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { Router, type Request, type Response } from 'express'
import type { Pool, PoolClient } from 'pg'
import type { AppConfig } from '../../config/env.js'
import { loginSchema, registerSchema } from './auth.schemas.js'

const cookieName = 'agrosphere_session'
const sessionDurationSeconds = 60 * 60 * 24 * 7
const passwordRounds = 12

type UserRow = {
  id: string
  name: string
  email: string
  role: 'farmer' | 'admin'
}

function sessionCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: sessionDurationSeconds * 1000,
  }
}

function clearSessionCookie(res: Response, config: AppConfig) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
}

async function createSessionToken(
  user: UserRow,
  sessionId: string,
  config: AppConfig,
) {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setJti(sessionId)
    .setIssuer('agrosphere-api')
    .setAudience('agrosphere-web')
    .setIssuedAt()
    .setExpirationTime(`${sessionDurationSeconds}s`)
    .sign(new TextEncoder().encode(config.JWT_SECRET))
}

async function storeSession(
  queryable: Pool | PoolClient,
  user: UserRow,
  config: AppConfig,
) {
  const sessionId = randomUUID()
  const token = await createSessionToken(user, sessionId, config)
  const expiresAt = Math.floor(Date.now() / 1000) + sessionDurationSeconds
  await queryable.query(
    `INSERT INTO auth_sessions (id, user_id, expires_at)
     VALUES ($1, $2, to_timestamp($3))`,
    [sessionId, user.id, expiresAt],
  )
  return token
}

function setSessionCookie(res: Response, token: string, config: AppConfig) {
  res.cookie(cookieName, token, sessionCookieOptions(config))
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  )
}

function rejectForeignOrigin(req: Request, res: Response, config: AppConfig): boolean {
  const origin = req.get('origin')
  if (origin && origin !== config.APP_ORIGIN) {
    res.status(403).json({ error: 'Request origin is not allowed.' })
    return true
  }
  return false
}

export function createAuthRouter(pool: Pool, config: AppConfig): Router {
  const router = Router()
  const key = new TextEncoder().encode(config.JWT_SECRET)

  router.post('/register', async (req, res, next) => {
    if (rejectForeignOrigin(req, res, config)) return

    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Please check the information you entered.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
    }

    const { name, email, password } = parsed.data
    let client: PoolClient | undefined
    try {
      const passwordHash = await bcrypt.hash(password, passwordRounds)
      client = await pool.connect()
      await client.query('BEGIN')
      const result = await client.query<UserRow>(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, role`,
        [name, email, passwordHash],
      )
      const user = result.rows[0]
      if (!user) {
        throw new Error('User insert did not return the created record.')
      }
      const token = await storeSession(client, user, config)
      await client.query('COMMIT')
      setSessionCookie(res, token, config)
      return res.status(201).json({ user })
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK')
        } catch (rollbackError) {
          console.error('Failed to roll back account registration:', rollbackError)
        }
      }
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: 'An account with this email already exists.' })
      }
      return next(error)
    } finally {
      client?.release()
    }
  })

  router.post('/login', async (req, res, next) => {
    if (rejectForeignOrigin(req, res, config)) return

    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Please enter a valid email address and password.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
    }

    const { email, password } = parsed.data
    try {
      const result = await pool.query<UserRow & { password_hash: string; is_active: boolean }>(
        'SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = $1',
        [email],
      )
      const user = result.rows[0]
      if (user && !user.is_active) {
        return res.status(403).json({ error: 'This account is disabled. Contact an administrator.' })
      }
      const passwordMatches =
        user !== undefined && (await bcrypt.compare(password, user.password_hash))
      if (!user || !passwordMatches) {
        return res.status(401).json({ error: 'Email or password is incorrect.' })
      }

      const safeUser: UserRow = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      }
      const token = await storeSession(pool, safeUser, config)
      setSessionCookie(res, token, config)
      return res.status(200).json({ user: safeUser })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/me', async (req, res, next) => {
    const token = req.cookies?.[cookieName]
    if (typeof token !== 'string') {
      return res.status(401).json({ error: 'Authentication required.' })
    }

    let subject: string
    let sessionId: string
    try {
      const { payload } = await jwtVerify(token, key, {
        issuer: 'agrosphere-api',
        audience: 'agrosphere-web',
        algorithms: ['HS256'],
      })
      if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
        clearSessionCookie(res, config)
        return res.status(401).json({ error: 'Session is invalid or expired.' })
      }
      subject = payload.sub
      sessionId = payload.jti
    } catch {
      clearSessionCookie(res, config)
      return res.status(401).json({ error: 'Session is invalid or expired.' })
    }

    try {
      const result = await pool.query<UserRow>(
        `SELECT users.id, users.name, users.email, users.role
         FROM users
         JOIN auth_sessions ON auth_sessions.user_id = users.id
         WHERE users.id = $1
           AND auth_sessions.id = $2
           AND auth_sessions.revoked_at IS NULL
           AND auth_sessions.expires_at > NOW()
           AND users.is_active = TRUE`,
        [subject, sessionId],
      )
      const user = result.rows[0]
      if (!user) {
        clearSessionCookie(res, config)
        return res.status(401).json({ error: 'Session is invalid or expired.' })
      }
      return res.status(200).json({ user })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/logout', async (req, res) => {
    if (rejectForeignOrigin(req, res, config)) return

    const token = req.cookies?.[cookieName]
    if (typeof token === 'string') {
      let sessionId: string | undefined
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: 'agrosphere-api',
          audience: 'agrosphere-web',
          algorithms: ['HS256'],
        })
        if (typeof payload.jti === 'string') {
          sessionId = payload.jti
        }
      } catch {
        clearSessionCookie(res, config)
        return res.status(200).json({ message: 'Signed out successfully.' })
      }

      if (sessionId) {
        await pool.query(
          `UPDATE auth_sessions
           SET revoked_at = NOW()
           WHERE id = $1 AND revoked_at IS NULL`,
          [sessionId],
        )
      }
    }

    clearSessionCookie(res, config)
    return res.status(200).json({ message: 'Signed out successfully.' })
  })

  return router
}
