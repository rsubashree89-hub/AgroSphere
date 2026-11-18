import { jwtVerify } from 'jose'
import type { NextFunction, Request, Response } from 'express'
import type { Pool } from 'pg'
import type { AppConfig } from '../config/env.js'

export type AuthenticatedUser = {
  id: string
  name: string
  email: string
  role: 'farmer' | 'admin'
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser
  }
}

const cookieName = 'agrosphere_session'

function clearSessionCookie(res: Response, config: AppConfig) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
}

export function requireAuth(pool: Pool, config: AppConfig) {
  const key = new TextEncoder().encode(config.JWT_SECRET)

  return async (req: Request, res: Response, next: NextFunction) => {
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
      const result = await pool.query<AuthenticatedUser>(
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
      req.user = user
      return next()
    } catch (error) {
      return next(error)
    }
  }
}
