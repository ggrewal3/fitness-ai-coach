import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "../../context/useAuth"
import { useTheme } from "../../context/useTheme"
import {
  createNonceSlot,
  googleButtonWidth,
  loadGoogleIdentityServices,
  socialSignInError,
  type GoogleCredentialResponse,
  type GoogleIdentityServices,
  type SocialSignInError,
} from "../../features/auth/googleIdentity"
import { GOOGLE_CLIENT_ID } from "../../features/auth/socialConfig"
import { requestSignInNonce } from "../../services/api"

type GoogleSignInProps = {
  /** Button wording only: Google sign-in creates or opens an account either way. */
  mode: "signin" | "signup"
  /** True while FitAI verifies a Google credential. */
  onBusyChange: (busy: boolean) => void
  /** A sign-in attempt failed (null clears a previous failure). */
  onError: (error: SocialSignInError | null) => void
  onSuccess: (result: { isNewUser: boolean }) => void
  /** False while another sign-in (e.g. Apple) is being verified. */
  canStart?: () => boolean
}

type Status = "loading" | "ready" | "verifying" | "failed"

/** Refresh the nonce a minute before the server's 10-minute expiry. */
const NONCE_REFRESH_MARGIN_MS = 60_000
const NONCE_REFRESH_MAX_MS = 9 * 60_000

/**
 * Google's official button. Renders nothing when VITE_GOOGLE_CLIENT_ID is
 * unset (the surrounding SocialSignIn section owns the "or" divider).
 *
 * Nonce lifecycle: GIS takes the nonce in initialize(), before its button is
 * rendered, and offers no hook just before a click. So a fresh single-use
 * nonce is fetched when the button is prepared, again after every attempt
 * (success or failure), and shortly before it expires; each fetch
 * re-initializes GIS. A nonce is spent the moment a credential arrives and is
 * never reused. A closed popup sends no callback, so its unspent nonce stays
 * valid for the next click. Credential and nonce live only in memory.
 */
export default function GoogleSignIn(props: GoogleSignInProps) {
  if (!GOOGLE_CLIENT_ID) return null
  return <GoogleSignInButton clientId={GOOGLE_CLIENT_ID} {...props} />
}

function GoogleSignInButton({ clientId, mode, onBusyChange, onError, onSuccess, canStart = () => true }: GoogleSignInProps & { clientId: string }) {
  const { loginWithGoogle } = useAuth()
  const { resolvedTheme } = useTheme()
  const [status, setStatus] = useState<Status>("loading")
  const [failure, setFailure] = useState<SocialSignInError | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const googleRef = useRef<GoogleIdentityServices | null>(null)
  // The current single-use nonce and the in-flight guard (see createNonceSlot).
  const [nonceSlot] = useState(createNonceSlot)
  const generationRef = useRef(0)
  const refreshTimerRef = useRef<number | undefined>(undefined)
  const themeRef = useRef(resolvedTheme)
  const handleCredentialRef = useRef<(response: GoogleCredentialResponse) => void>(() => undefined)
  // The refresh timer re-runs the latest prepare() through this ref.
  const prepareRef = useRef<(generation: number) => Promise<void>>(async () => undefined)
  const callbacksRef = useRef({ onBusyChange, onError, onSuccess, canStart })

  useEffect(() => {
    callbacksRef.current = { onBusyChange, onError, onSuccess, canStart }
    themeRef.current = resolvedTheme
  })

  const renderButton = useCallback(() => {
    const google = googleRef.current
    const container = containerRef.current
    if (!google || !container) return

    container.replaceChildren()
    google.accounts.id.renderButton(container, {
      type: "standard",
      theme: themeRef.current === "dark" ? "filled_black" : "outline",
      size: "large",
      text: mode === "signup" ? "signup_with" : "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: googleButtonWidth(container.clientWidth),
    })
  }, [mode])

  /** Loads GIS, fetches a fresh nonce and (re)initializes Google's button with it. */
  const prepare = useCallback(async (generation: number) => {
    window.clearTimeout(refreshTimerRef.current)

    try {
      const google = await loadGoogleIdentityServices()
      const { nonce, expiresAt } = await requestSignInNonce("GOOGLE")
      if (generation !== generationRef.current || !nonceSlot.offer(nonce)) return

      googleRef.current = google
      google.accounts.id.initialize({
        client_id: clientId,
        nonce,
        callback: (response) => handleCredentialRef.current(response),
        ux_mode: "popup",
        auto_select: false,
        context: mode === "signup" ? "signup" : "signin",
        itp_support: true,
      })
      renderButton()
      setFailure(null)
      setStatus("ready")

      const lifetimeMs = Date.parse(expiresAt) - Date.now() - NONCE_REFRESH_MARGIN_MS
      const refreshInMs = Number.isFinite(lifetimeMs) ? Math.min(Math.max(lifetimeMs, 30_000), NONCE_REFRESH_MAX_MS) : NONCE_REFRESH_MAX_MS
      refreshTimerRef.current = window.setTimeout(() => {
        if (generation === generationRef.current && !nonceSlot.busy) void prepareRef.current(generation)
      }, refreshInMs)
    } catch (error) {
      if (generation !== generationRef.current) return
      nonceSlot.clear()
      setFailure(socialSignInError(error))
      setStatus("failed")
    }
  }, [clientId, mode, nonceSlot, renderButton])

  useEffect(() => {
    prepareRef.current = prepare
  }, [prepare])

  useEffect(() => {
    handleCredentialRef.current = async (response: GoogleCredentialResponse) => {
      if (!response.credential || !callbacksRef.current.canStart()) return
      // One verification at a time, and each nonce at most once.
      const nonce = nonceSlot.claim()
      if (!nonce) return

      const generation = generationRef.current
      window.clearTimeout(refreshTimerRef.current)
      setStatus("verifying")
      callbacksRef.current.onError(null)
      callbacksRef.current.onBusyChange(true)

      try {
        const result = await loginWithGoogle(response.credential, nonce)
        // Stays busy: the page navigates away, and nothing may start a second request meanwhile.
        if (generation === generationRef.current) callbacksRef.current.onSuccess(result)
      } catch (error) {
        if (generation !== generationRef.current) return
        nonceSlot.release()
        callbacksRef.current.onBusyChange(false)
        callbacksRef.current.onError(socialSignInError(error))
        setStatus("loading")
        void prepare(generation)
      }
    }
  }, [loginWithGoogle, nonceSlot, prepare])

  useEffect(() => {
    const generation = ++generationRef.current
    void prepare(generation)

    return () => {
      generationRef.current += 1
      window.clearTimeout(refreshTimerRef.current)
      nonceSlot.clear()
    }
  }, [nonceSlot, prepare])

  // Google's button has its own light/dark styles: re-render it when the theme changes.
  useEffect(() => {
    if (status === "ready") renderButton()
  }, [resolvedTheme, renderButton, status])

  const retry = () => {
    setFailure(null)
    setStatus("loading")
    void prepare(generationRef.current)
  }

  return (
    <div className="social-signin">
      <div ref={containerRef} className="social-signin-button" aria-busy={status !== "ready"} hidden={status === "failed"} />
      {status === "verifying" && (
        <p className="social-signin-status" role="status">
          Signing in with Google…
        </p>
      )}
      {status === "failed" && failure && (
        <div className="social-signin-failure">
          <p className="form-error" role="alert">
            {failure.message}
          </p>
          <button type="button" className="social-signin-retry" onClick={retry}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
