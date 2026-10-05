import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "../../context/useAuth"
import { useTheme } from "../../context/useTheme"
import {
  appleButtonWidth,
  appleNameMemory,
  appleSignInError,
  appleSignInRequest,
  appleTokenSubject,
  createAppleAttemptSlot,
  createAppleState,
  isAppleCancellation,
  loadAppleJs,
  nameFromAppleResponse,
  type AppleJs,
  type AppleSignInConfig,
  type AppleSignInResponse,
} from "../../features/auth/appleSignIn"
import { APPLE_CONFIG } from "../../features/auth/socialConfig"
import type { SocialSignInError } from "../../features/auth/socialShared"
import { requestSignInNonce } from "../../services/api"

type AppleSignInProps = {
  /** Button wording only: Apple sign-in creates or opens an account either way. */
  mode: "signin" | "signup"
  onBusyChange: (busy: boolean) => void
  onError: (error: SocialSignInError | null) => void
  onSuccess: (result: { isNewUser: boolean }) => void
  /** False while another sign-in (e.g. Google) is being verified. */
  canStart?: () => boolean
}

type Status = "loading" | "ready" | "verifying" | "failed"

const NONCE_REFRESH_MARGIN_MS = 60_000
const NONCE_REFRESH_MAX_MS = 9 * 60_000

/**
 * Apple's official Sign in with Apple button (rendered by Apple JS into
 * #appleid-signin), popup mode. Renders nothing unless VITE_APPLE_CLIENT_ID
 * and an HTTPS VITE_APPLE_REDIRECT_URI are set.
 *
 * Attempt lifecycle: Apple JS takes the nonce and state in init(), before its
 * button is clicked. So each attempt gets a fresh server nonce and a random
 * state when the button is prepared, again after every attempt (success,
 * failure or cancellation) and shortly before the nonce expires. When Apple
 * answers, the returned state is checked BEFORE anything is sent to FitAI;
 * the attempt is spent either way. Nonce, state, ID token and name live only
 * in memory. Apple's authorization code is ignored.
 */
export default function AppleSignIn(props: AppleSignInProps) {
  if (!APPLE_CONFIG) return null
  return <AppleSignInButton config={APPLE_CONFIG} {...props} />
}

function AppleSignInButton({ config, mode, onBusyChange, onError, onSuccess, canStart = () => true }: AppleSignInProps & { config: AppleSignInConfig }) {
  const { loginWithApple } = useAuth()
  const { resolvedTheme } = useTheme()
  const [status, setStatus] = useState<Status>("loading")
  const [failure, setFailure] = useState<SocialSignInError | null>(null)
  const [attempt] = useState(createAppleAttemptSlot)

  const containerRef = useRef<HTMLDivElement>(null)
  const appleRef = useRef<AppleJs | null>(null)
  const generationRef = useRef(0)
  const refreshTimerRef = useRef<number | undefined>(undefined)
  const themeRef = useRef(resolvedTheme)
  const callbacksRef = useRef({ onBusyChange, onError, onSuccess, canStart })
  const prepareRef = useRef<(generation: number) => Promise<void>>(async () => undefined)

  useEffect(() => {
    callbacksRef.current = { onBusyChange, onError, onSuccess, canStart }
    themeRef.current = resolvedTheme
  })

  /** Sets the official button's appearance (Apple JS reads these data attributes). */
  const applyButtonOptions = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    // Apple: a white button on dark backgrounds, a black one on light.
    container.dataset.color = themeRef.current === "dark" ? "white" : "black"
    container.dataset.border = "false"
    container.dataset.type = mode === "signup" ? "sign-up" : "continue"
    container.dataset.mode = "center-align"
    container.dataset.borderRadius = "8"
    container.dataset.height = "44"
    container.dataset.width = String(appleButtonWidth(container.clientWidth))
  }, [mode])

  /** Loads Apple JS, fetches a fresh nonce, makes a new state and (re)initializes Apple with them. */
  const prepare = useCallback(async (generation: number) => {
    window.clearTimeout(refreshTimerRef.current)

    try {
      const apple = await loadAppleJs()
      const { nonce, expiresAt } = await requestSignInNonce("APPLE")
      const state = createAppleState()
      if (generation !== generationRef.current || !attempt.offer(nonce, state)) return

      appleRef.current = apple
      applyButtonOptions()
      apple.auth.init({ clientId: config.clientId, scope: "name email", redirectURI: config.redirectUri, state, nonce, usePopup: true })
      apple.auth.renderButton?.()
      setFailure(null)
      setStatus("ready")

      const lifetimeMs = Date.parse(expiresAt) - Date.now() - NONCE_REFRESH_MARGIN_MS
      const refreshInMs = Number.isFinite(lifetimeMs) ? Math.min(Math.max(lifetimeMs, 30_000), NONCE_REFRESH_MAX_MS) : NONCE_REFRESH_MAX_MS
      refreshTimerRef.current = window.setTimeout(() => {
        if (generation === generationRef.current && !attempt.busy) void prepareRef.current(generation)
      }, refreshInMs)
    } catch (error) {
      if (generation !== generationRef.current) return
      attempt.clear()
      setFailure(appleSignInError(error))
      setStatus("failed")
    }
  }, [applyButtonOptions, attempt, config])

  useEffect(() => {
    prepareRef.current = prepare
  }, [prepare])

  useEffect(() => {
    const restart = () => {
      if (!attempt.busy) void prepareRef.current(generationRef.current)
    }

    const handleSuccess = async (event: Event) => {
      const response = (event as CustomEvent<AppleSignInResponse>).detail ?? {}
      if (!callbacksRef.current.canStart()) return

      // State first: nothing reaches FitAI unless Apple returned this attempt's state.
      const claim = attempt.claim(response.authorization?.state)
      if (!claim.ok) {
        if (claim.reason === "state_mismatch") {
          callbacksRef.current.onError(appleSignInError(null))
          restart()
        }
        return
      }

      const idToken = response.authorization?.id_token
      const name = appleNameMemory.forAttempt(nameFromAppleResponse(response), appleTokenSubject(idToken))
      const body = appleSignInRequest(response, claim.nonce, name)
      if (!body) {
        attempt.release()
        callbacksRef.current.onError(appleSignInError(null))
        restart()
        return
      }

      const generation = generationRef.current
      window.clearTimeout(refreshTimerRef.current)
      setStatus("verifying")
      callbacksRef.current.onError(null)
      callbacksRef.current.onBusyChange(true)

      try {
        const result = await loginWithApple(body)
        appleNameMemory.forget()
        // Stays busy: the page navigates away, and nothing may start a second request meanwhile.
        if (generation === generationRef.current) callbacksRef.current.onSuccess(result)
      } catch (error) {
        if (generation !== generationRef.current) return
        attempt.release()
        callbacksRef.current.onBusyChange(false)
        callbacksRef.current.onError(appleSignInError(error))
        setStatus("loading")
        void prepareRef.current(generation)
      }
    }

    const handleFailure = (event: Event) => {
      if (attempt.busy) return
      // The popup ended without credentials: this attempt is over either way.
      attempt.clear()
      if (!isAppleCancellation((event as CustomEvent<unknown>).detail)) {
        callbacksRef.current.onError(appleSignInError(null))
      }
      restart()
    }

    const onSuccessEvent = (event: Event) => void handleSuccess(event)
    document.addEventListener("AppleIDSignInOnSuccess", onSuccessEvent)
    document.addEventListener("AppleIDSignInOnFailure", handleFailure)
    return () => {
      document.removeEventListener("AppleIDSignInOnSuccess", onSuccessEvent)
      document.removeEventListener("AppleIDSignInOnFailure", handleFailure)
    }
  }, [attempt, loginWithApple])

  useEffect(() => {
    const generation = ++generationRef.current
    void prepare(generation)

    return () => {
      generationRef.current += 1
      window.clearTimeout(refreshTimerRef.current)
      attempt.clear()
    }
  }, [attempt, prepare])

  // Apple's button has its own light/dark styles: on a theme change, start a
  // fresh attempt so Apple renders the button with the new appearance.
  useEffect(() => {
    const wanted = resolvedTheme === "dark" ? "white" : "black"
    if (status === "ready" && appleRef.current && containerRef.current?.dataset.color !== wanted) {
      void prepareRef.current(generationRef.current)
    }
  }, [resolvedTheme, status])

  const retry = () => {
    setFailure(null)
    setStatus("loading")
    void prepare(generationRef.current)
  }

  return (
    <div className="social-signin">
      <div
        id="appleid-signin"
        ref={containerRef}
        className="social-signin-button social-signin-apple"
        aria-busy={status !== "ready"}
        hidden={status === "failed"}
      />
      {status === "verifying" && (
        <p className="social-signin-status" role="status">
          Signing in with Apple…
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
