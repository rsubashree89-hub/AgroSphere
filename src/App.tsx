import { useEffect, useState, type FormEvent } from 'react'
import BrandMark from './components/BrandMark'
import Workspace from './app/Workspace'
import { ApiError, request } from './lib/api'
import './App.css'

type User = {
  id: string
  name: string
  email: string
  role?: 'farmer' | 'admin'
}

type AuthMode = 'login' | 'register'

function App() {
  const [mode, setMode] = useState<AuthMode>('register')
  const [user, setUser] = useState<User | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    request<{ user: User }>('/auth/me')
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch((cause: unknown) => {
        if (!(cause instanceof ApiError) || cause.status !== 401) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to verify your session. Please try again.',
          )
        }
      })
      .finally(() => setIsCheckingSession(false))
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const body =
        mode === 'register'
          ? { name, email, password }
          : { email, password }
      const { user: authenticatedUser } = await request<{ user: User }>(
        `/auth/${mode}`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      )
      setUser(authenticatedUser)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to complete your request. Please try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleLogout() {
    setError('')
    setIsSubmitting(true)
    try {
      await request<{ message: string }>('/auth/logout', { method: 'POST' })
      setUser(null)
      setPassword('')
      setMode('login')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign out.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isCheckingSession) {
    return (
      <main className="screen-state" aria-live="polite">
        <BrandMark />
        <p>Preparing your workspace…</p>
      </main>
    )
  }

  if (user) {
    return (
      <Workspace
        user={user}
        isSigningOut={isSubmitting}
        signOutError={error}
        onSignOut={() => void handleLogout()}
      />
    )
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-heading">
        <a className="brand" href="/" aria-label="AgroSphere home">
          <BrandMark />
          <span>AgroSphere</span>
        </a>

        <div className="auth-content">
          <span className="eyebrow">
            {mode === 'register' ? 'GET STARTED' : 'WELCOME BACK'}
          </span>
          <h1 id="auth-heading">
            {mode === 'register' ? 'A better season starts here.' : 'Good to see you again.'}
          </h1>
          <p className="auth-description">
            {mode === 'register'
              ? 'Create your account and take the first step toward a more connected farm.'
              : 'Sign in to continue to your AgroSphere workspace.'}
          </p>

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === 'register' && (
              <label className="field">
                <span>Your name</span>
                <input
                  autoComplete="name"
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Alex Green"
                  required
                  minLength={2}
                  maxLength={80}
                />
              </label>
            )}
            <label className="field">
              <span>Email address</span>
              <input
                autoComplete="email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                maxLength={254}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'register' ? 'At least 12 characters' : 'Enter your password'}
                required
                minLength={mode === 'register' ? 12 : 1}
                maxLength={72}
              />
              {mode === 'register' && (
                <span className="field-hint">Use at least 12 characters.</span>
              )}
            </label>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? 'Please wait…'
                : mode === 'register'
                  ? 'Create account'
                  : 'Sign in'}
              {!isSubmitting && (
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M4 10h12m-5-5 5 5-5 5" />
                </svg>
              )}
            </button>
          </form>

          <p className="mode-switch">
            {mode === 'register' ? 'Already have an account?' : 'New to AgroSphere?'}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'register' ? 'login' : 'register')
                setError('')
              }}
            >
              {mode === 'register' ? 'Sign in' : 'Create an account'}
            </button>
          </p>

          <p className="security-note">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 2.5 16 5v4.7c0 3.7-2.5 6.4-6 7.8-3.5-1.4-6-4.1-6-7.8V5l6-2.5Z" />
              <path d="m7.5 9.8 1.7 1.7 3.4-3.6" />
            </svg>
            Passwords are stored as salted, one-way hashes.
          </p>
        </div>

        <footer className="auth-footer">
          <span>© {new Date().getFullYear()} AgroSphere</span>
          <span>Built for the people who grow.</span>
        </footer>
      </section>

      <aside className="story-panel" aria-label="About AgroSphere">
        <div className="story-orbit story-orbit-one" />
        <div className="story-orbit story-orbit-two" />
        <div className="story-copy">
          <span className="story-label">
            <span className="status-dot" />
            A clearer view of your farm
          </span>
          <h2>Grow with confidence.<br />Plan with purpose.</h2>
          <p>
            Bring the work of running your farm into one thoughtful,
            easy-to-use workspace.
          </p>
        </div>
        <div className="field-art" aria-hidden="true">
          <div className="sun" />
          <div className="hill hill-back" />
          <div className="hill hill-front" />
          <svg className="crop-lines" viewBox="0 0 520 320" fill="none">
            <path d="M-20 305C115 247 277 248 550 307" />
            <path d="M-20 270C122 218 278 221 550 274" />
            <path d="M-20 237C126 189 283 193 550 242" />
            <path d="M-20 206C133 163 291 166 550 211" />
            <path d="M-20 177C142 137 301 138 550 181" />
          </svg>
          <div className="field-caption">
            <BrandMark />
            <span>Built around your land, your way.</span>
          </div>
        </div>
        <div className="story-footer">
          <span>YOUR FARM. YOUR FUTURE.</span>
          <span>01 — 03</span>
        </div>
      </aside>
    </main>
  )
}

export default App
