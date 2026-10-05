// Sign in with Apple in the browser (ADR-028): configuration, the lazy Apple
// JS loader, minimal Apple JS types, the per-attempt state + nonce, and the
// first-authorization name. Pure helpers, no React.
//
// Only Apple's ID token, the FitAI nonce and (on first authorization) the
// name go to FitAI, in memory for one request. The authorization code is
// ignored; email, subject and the private-relay flag come only from the
// signed token on the backend. Nothing here is ever stored.
import { browserScriptHost, createScriptLoader, mapSocialSignInError, ProviderScriptError, type ScriptHost, type SocialSignInError } from "./socialShared"

export const APPLE_SCRIPT_SRC = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"

// ---------------------------------------------------------------------------
// Configuration

export type AppleSignInConfig = {
  /** Apple Services ID (public). */
  clientId: string
  /** Return URL registered on the Services ID (public; HTTPS). */
  redirectUri: string
}

/** Both values are required; the redirect must be an absolute HTTPS URL. Otherwise Apple sign-in is off. */
export function appleConfigFrom(clientId: unknown, redirectUri: unknown): AppleSignInConfig | null {
  const id = typeof clientId === "string" ? clientId.trim() : ""
  const redirect = typeof redirectUri === "string" ? redirectUri.trim() : ""
  if (!id || !redirect) return null

  try {
    return new URL(redirect).protocol === "https:" ? { clientId: id, redirectUri: redirect } : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Minimal Apple JS types (https://developer.apple.com/documentation/signinwithapplejs)

export type AppleAuthInitConfig = {
  clientId: string
  scope: "name email"
  redirectURI: string
  state: string
  nonce: string
  usePopup: true
}

/** What FitAI reads from a successful popup response. The authorization code is deliberately ignored. */
export type AppleSignInResponse = {
  authorization?: { id_token?: unknown; state?: unknown; code?: unknown }
  user?: { name?: { firstName?: unknown; lastName?: unknown }; email?: unknown }
}

export type AppleJs = {
  auth: {
    init(config: AppleAuthInitConfig): void
    signIn(): Promise<AppleSignInResponse>
    /** Re-renders the official button from its data attributes (when available). */
    renderButton?(): void
  }
}

type AppleWindow = { AppleID?: AppleJs }

export function availableAppleJs(scope: unknown): AppleJs | null {
  const apple = (scope as AppleWindow | undefined)?.AppleID
  return apple?.auth && typeof apple.auth.init === "function" ? apple : null
}

export class AppleScriptError extends ProviderScriptError {
  constructor() {
    super("Sign in with Apple JS failed to load.")
    this.name = "AppleScriptError"
  }
}

export function createAppleLoader(host: ScriptHost) {
  return createScriptLoader(host, { src: APPLE_SCRIPT_SRC, ready: availableAppleJs, error: () => new AppleScriptError() })
}

export const loadAppleJs = createAppleLoader(browserScriptHost)

/** Popup outcomes Apple reports when the user closes or declines; these stay silent. */
export function isAppleCancellation(error: unknown): boolean {
  const code = (error as { error?: unknown } | null)?.error ?? error
  return code === "popup_closed_by_user" || code === "user_cancelled_authorize"
}

/** Apple's button width: the container's width within Apple's 130–375 px range. */
export function appleButtonWidth(containerWidth: number): number {
  return Math.round(Math.min(375, Math.max(130, containerWidth || 0)))
}

// ---------------------------------------------------------------------------
// Attempt state

type RandomSource = { getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> }

/** A cryptographically random `state` (32 bytes, base64url), kept only in memory. */
export function createAppleState(random: RandomSource = crypto): string {
  const bytes = random.getRandomValues(new Uint8Array(32))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return difference === 0
}

export type AppleClaim =
  | { ok: true; nonce: string }
  | { ok: false; reason: "no_attempt" | "busy" | "state_mismatch" }

/**
 * One Apple attempt at a time: its nonce and state, used exactly once.
 * claim() checks the state Apple returned BEFORE anything is sent to FitAI;
 * whatever the result, the attempt is spent. A duplicate callback finds no
 * attempt (or a busy slot) and is ignored.
 */
export function createAppleAttemptSlot() {
  let attempt: { nonce: string; state: string } | null = null
  let busy = false

  return {
    offer(nonce: string, state: string): boolean {
      if (busy) return false
      attempt = { nonce, state }
      return true
    },
    claim(returnedState: unknown): AppleClaim {
      if (busy) return { ok: false, reason: "busy" }
      const current = attempt
      attempt = null
      if (!current) return { ok: false, reason: "no_attempt" }
      if (typeof returnedState !== "string" || !sameString(returnedState, current.state)) {
        return { ok: false, reason: "state_mismatch" }
      }
      busy = true
      return { ok: true, nonce: current.nonce }
    },
    release(): void {
      busy = false
    },
    clear(): void {
      attempt = null
    },
    get busy(): boolean {
      return busy
    },
  }
}

// ---------------------------------------------------------------------------
// First-authorization name

export type AppleName = { firstName?: string; lastName?: string }

const NAME_MAX = 200

function namePart(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, NAME_MAX) : undefined
}

/** The name Apple sent (first authorization only), bounded; never identity evidence. */
export function nameFromAppleResponse(response: AppleSignInResponse): AppleName | null {
  const firstName = namePart(response.user?.name?.firstName)
  const lastName = namePart(response.user?.name?.lastName)
  return firstName || lastName ? { ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) } : null
}

/**
 * The `sub` claim of Apple's ID token, read WITHOUT verifying it. Used only
 * to make sure a remembered name is reused for the same Apple account; the
 * backend verifies the token and remains the only authority on identity.
 */
export function appleTokenSubject(idToken: unknown): string | null {
  const payload = typeof idToken === "string" ? idToken.split(".")[1] : undefined
  if (!payload) return null

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")
    const sub = (JSON.parse(atob(base64)) as { sub?: unknown } | null)?.sub
    return typeof sub === "string" && sub ? sub : null
  } catch {
    return null
  }
}

/**
 * Apple sends the name only once. If the FitAI request then fails, the name
 * is kept in this tab's memory (never storage) for a retry by the SAME Apple
 * account, and forgotten after a successful sign-in.
 */
export function createAppleNameMemory() {
  let remembered: { name: AppleName; subject: string } | null = null

  return {
    /** The name to send: Apple's new one (remembered for this account), else one remembered for this same account. */
    forAttempt(fromApple: AppleName | null, subject: string | null): AppleName | null {
      if (fromApple) {
        remembered = subject ? { name: fromApple, subject } : null
        return fromApple
      }
      return remembered && subject && remembered.subject === subject ? remembered.name : null
    },
    forget(): void {
      remembered = null
    },
  }
}

/** The tab's remembered first-authorization name (module memory; survives navigation, not reloads). */
export const appleNameMemory = createAppleNameMemory()

/** Maps any Apple sign-in failure to a short, safe message. */
export function appleSignInError(error: unknown): SocialSignInError {
  return mapSocialSignInError("APPLE", error)
}

/** The only fields sent to FitAI (no code, email, subject or relay flag). */
export function appleSignInRequest(response: AppleSignInResponse, nonce: string, name: AppleName | null) {
  const idToken = response.authorization?.id_token
  if (typeof idToken !== "string" || !idToken) return null
  return { idToken, nonce, ...(name ?? {}) }
}
