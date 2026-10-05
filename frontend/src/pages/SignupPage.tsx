import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthBrand from '../components/auth/AuthBrand'
import SocialSignIn from '../components/auth/SocialSignIn'
import { useAuth } from '../context/useAuth'
import type { SocialSignInError } from '../features/auth/socialShared'
import { ApiRequestError } from '../services/api'

function getErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error.message
  }

  return 'Unable to create your account. Please try again.'
}

function SignupPage() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSocialBusy, setIsSocialBusy] = useState(false)
  const [socialError, setSocialError] = useState<SocialSignInError | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setSocialError(null)
    setIsSubmitting(true)

    try {
      await signup({ firstName, lastName, email, password })
      navigate('/login', {
        replace: true,
        state: { message: 'Account created. Please log in.' },
      })
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <AuthBrand />
        <h1>Create your account</h1>

        {errorMessage && (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        )}

        {socialError && (
          <p className="form-error" role="alert">
            {socialError.message}
            {socialError.kind === 'email_in_use' && (
              <>
                {' '}
                <Link to="/login">Go to Log in</Link>
              </>
            )}
          </p>
        )}

        <SocialSignIn
          mode="signup"
          onBusyChange={setIsSocialBusy}
          onError={(error) => {
            setErrorMessage(null)
            setSocialError(error)
          }}
          // Google signs the user in directly (new or existing account), unlike password sign-up.
          onSuccess={() => navigate('/', { replace: true })}
        />

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            First name
            <input
              type="text"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              autoComplete="given-name"
              required
            />
          </label>

          <label>
            Last name
            <input
              type="text"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              autoComplete="family-name"
              required
            />
          </label>

          <label>
            Email
            <input
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
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          <button type="submit" disabled={isSubmitting || isSocialBusy}>
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </section>
    </main>
  )
}

export default SignupPage
