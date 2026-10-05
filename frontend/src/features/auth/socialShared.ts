// Shared, provider-neutral pieces of social sign-in (ADR-028): the lazy
// script loader, the single-use nonce slot and the mapping from failures to
// short, safe messages. Pure modules, no React.
import { ApiRequestError } from "../../services/api"

export type SocialProviderName = "GOOGLE" | "APPLE"

// ---------------------------------------------------------------------------
// Script loader

/** The DOM surface a loader needs (injectable for tests). */
export type ScriptHost = {
  scope: unknown
  findScript(src: string): HTMLScriptElement | null
  createScript(): HTMLScriptElement
  append(script: HTMLScriptElement): void
}

/** A provider's script failed to load, or loaded without defining its API. */
export class ProviderScriptError extends Error {
  constructor(message = "A sign-in provider script failed to load.") {
    super(message)
    this.name = "ProviderScriptError"
  }
}

/**
 * Loads a provider script at most once at a time. Concurrent callers share
 * the pending load; an already-available API resolves immediately. A failed
 * load removes its script element and forgets the attempt, so a later call
 * retries. A loaded script is shared and never removed.
 */
export function createScriptLoader<Api>(
  host: ScriptHost,
  options: { src: string; ready(scope: unknown): Api | null; error(): ProviderScriptError },
) {
  let pending: Promise<Api> | null = null

  return function load(): Promise<Api> {
    const ready = options.ready(host.scope)
    if (ready) return Promise.resolve(ready)
    if (pending) return pending

    pending = new Promise<Api>((resolve, reject) => {
      const script = host.findScript(options.src) ?? host.createScript()
      const fail = () => {
        script.remove()
        reject(options.error())
      }

      script.addEventListener("load", () => {
        const api = options.ready(host.scope)
        if (api) resolve(api)
        else fail()
      }, { once: true })
      script.addEventListener("error", fail, { once: true })

      if (!script.isConnected) {
        script.src = options.src
        script.async = true
        script.defer = true
        host.append(script)
      }
    }).finally(() => {
      pending = null
    })

    return pending
  }
}

/** The real document, for the app's loaders. */
export const browserScriptHost: ScriptHost = {
  get scope() {
    return typeof window === "undefined" ? undefined : window
  },
  findScript: (src) => document.querySelector<HTMLScriptElement>(`script[src="${src}"]`),
  createScript: () => document.createElement("script"),
  append: (script) => document.head.appendChild(script),
}

// ---------------------------------------------------------------------------
// Nonce slot

/**
 * Holds the current sign-in nonce and the one in-flight verification. claim()
 * hands the nonce out exactly once and marks the slot busy, so a duplicate
 * provider callback (or a second click) can neither reuse the nonce nor start
 * a second FitAI request. A new nonce is only accepted while not busy.
 */
export function createNonceSlot() {
  let nonce: string | null = null
  let busy = false

  return {
    /** Stores a fresh nonce (ignored while a verification is in flight). */
    offer(next: string): boolean {
      if (busy) return false
      nonce = next
      return true
    },
    /** The nonce for this credential, or null if none is ready or one is already being verified. */
    claim(): string | null {
      if (busy || !nonce) return null
      const claimed = nonce
      nonce = null
      busy = true
      return claimed
    },
    /** The verification finished without signing in; a fresh nonce can be offered. */
    release(): void {
      busy = false
    },
    clear(): void {
      nonce = null
    },
    get busy(): boolean {
      return busy
    },
  }
}

// ---------------------------------------------------------------------------
// User-facing outcomes

export type SocialSignInErrorKind =
  | "provider"
  | "not_verified"
  | "missing_email"
  | "email_in_use"
  | "rate_limited"
  | "unavailable"
  | "failed"

export type SocialSignInError = {
  kind: SocialSignInErrorKind
  message: string
}

const SHARED_MESSAGES = {
  email_in_use: "An account with this email already exists. Sign in using your existing method.",
  rate_limited: "Too many sign-in attempts. Please wait and try again.",
} as const

export const SOCIAL_SIGN_IN_MESSAGES: Record<SocialProviderName, Record<SocialSignInErrorKind, string>> = {
  GOOGLE: {
    ...SHARED_MESSAGES,
    provider: "Google sign-in didn't complete. Try again.",
    not_verified: "Couldn't verify your Google account. Try again.",
    // Google always shares an email for these scopes; treated like any verification failure.
    missing_email: "Couldn't verify your Google account. Try again.",
    unavailable: "Google sign-in is temporarily unavailable.",
    failed: "Google sign-in didn't complete. Try again.",
  },
  APPLE: {
    ...SHARED_MESSAGES,
    provider: "Apple sign-in didn't complete. Try again.",
    not_verified: "Couldn't verify your Apple account. Try again.",
    missing_email:
      "Apple didn't share the email address FitAI needs to create your account. You may need to remove FitAI from Sign in with Apple in your Apple ID settings and try again.",
    unavailable: "Apple sign-in is temporarily unavailable.",
    failed: "Apple sign-in didn't complete. Try again.",
  },
}

/** Maps any social sign-in failure to a short, safe message (never backend or provider detail). */
export function mapSocialSignInError(provider: SocialProviderName, error: unknown): SocialSignInError {
  const kind: SocialSignInErrorKind = (() => {
    if (error instanceof ProviderScriptError) return "provider"
    if (!(error instanceof ApiRequestError)) return "failed"
    if (error.status === 409 && error.code === "EMAIL_IN_USE") return "email_in_use"
    if (error.status === 401 && error.code === "MISSING_EMAIL") return "missing_email"
    if (error.status === 401) return "not_verified"
    if (error.status === 429) return "rate_limited"
    if (error.status === 503) return "unavailable"
    return "failed"
  })()

  return { kind, message: SOCIAL_SIGN_IN_MESSAGES[provider][kind] }
}
