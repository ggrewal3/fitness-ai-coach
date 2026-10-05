import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import AuthBrand from '../components/auth/AuthBrand'
import SocialSignIn from '../components/auth/SocialSignIn'
import type { SocialSignInError } from '../features/auth/socialShared'
import { ApiRequestError } from '../services/api'
import { useAuth } from '../context/useAuth'

type LoginLocationState = {
  message?: string
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error.message
  }

  return 'Unable to log in. Please try again.'
}

function LoginPage() {
  const { isAuthenticated, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as LoginLocationState | null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSocialBusy, setIsSocialBusy] = useState(false)
  const emailInputRef = useRef<HTMLInputElement>(null)

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      await login({ email, password })
      navigate('/', { replace: true })
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleSocialError(error: SocialSignInError | null) {
    setErrorMessage(error?.message ?? null)

    // The account already exists: point the user at the password form.
    if (error?.kind === 'email_in_use') {
      emailInputRef.current?.focus()
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <AuthBrand />
        <h1>Welcome back</h1>

        {locationState?.message && (
          <p className="form-success" role="status">
            {locationState.message}
          </p>
        )}

        {errorMessage && (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        )}

        <SocialSignIn
          mode="signin"
          onBusyChange={setIsSocialBusy}
          onError={handleSocialError}
          onSuccess={() => navigate('/', { replace: true })}
        />

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              ref={emailInputRef}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <button type="submit" disabled={isSubmitting || isSocialBusy}>
            {isSubmitting ? 'Logging in...' : 'Log in'}
          </button>
        </form>

        <p>
          Need an account? <Link to="/signup">Sign up</Link>
        </p>
      </section>
    </main>
  )
}

export default LoginPage
