// Google Identity Services (GIS) for Google sign-in (ADR-028). Pure helpers,
// no React: configuration, the shared lazy script loader, the minimal GIS
// types FitAI uses, and the mapping from failures to user-facing messages.
//
// The browser only ever holds Google's ID token (and the FitAI nonce it was
// issued for) in memory for one sign-in; FitAI's own session token is the
// only thing stored.
import {
  browserScriptHost,
  createScriptLoader,
  mapSocialSignInError,
  ProviderScriptError,
  type ScriptHost,
  type SocialSignInError,
} from "./socialShared"

export const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client"

/** The public Google OAuth web client ID, or null when Google sign-in is off. */
export function googleClientIdFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

// ---------------------------------------------------------------------------
// Minimal GIS types (https://developers.google.com/identity/gsi/web/reference/js-reference)

export type GoogleCredentialResponse = {
  /** Google's ID token (a JWT). Sent once to FitAI, never stored. */
  credential: string
  select_by?: string
}

export type GoogleIdConfiguration = {
  client_id: string
  callback: (response: GoogleCredentialResponse) => void
  nonce: string
  ux_mode: "popup"
  auto_select: false
  context?: "signin" | "signup" | "use"
  itp_support?: boolean
}

export type GoogleButtonConfiguration = {
  type: "standard"
  theme: "outline" | "filled_black"
  size: "large"
  text: "continue_with" | "signup_with" | "signin_with"
  shape: "rectangular" | "pill"
  logo_alignment: "left"
  width: number
}

export type GoogleIdentityServices = {
  accounts: {
    id: {
      initialize(config: GoogleIdConfiguration): void
      renderButton(parent: HTMLElement, options: GoogleButtonConfiguration): void
      disableAutoSelect(): void
    }
  }
}

type GoogleWindow = { google?: GoogleIdentityServices }

export function availableGis(scope: unknown): GoogleIdentityServices | null {
  const google = (scope as GoogleWindow | undefined)?.google
  return google?.accounts?.id ? google : null
}

// ---------------------------------------------------------------------------
// Script loader (shared implementation in socialShared.ts)

export type { ScriptHost } from "./socialShared"
export type { SocialSignInError, SocialSignInErrorKind } from "./socialShared"
export { createNonceSlot } from "./socialShared"

export class GisLoadError extends ProviderScriptError {
  constructor() {
    super("Google Identity Services failed to load.")
    this.name = "GisLoadError"
  }
}

/** Loads GIS lazily, once at a time (see createScriptLoader). */
export function createGisLoader(host: ScriptHost) {
  return createScriptLoader(host, { src: GIS_SCRIPT_SRC, ready: availableGis, error: () => new GisLoadError() })
}

/** The app's loader, bound to the real document. */
export const loadGoogleIdentityServices = createGisLoader(browserScriptHost)

/** Maps any Google sign-in failure to a short, safe message (never backend or provider detail). */
export function socialSignInError(error: unknown): SocialSignInError {
  return mapSocialSignInError("GOOGLE", error)
}

/** Google's button width: the container's width within GIS's 200–400 px range. */
export function googleButtonWidth(containerWidth: number): number {
  return Math.round(Math.min(400, Math.max(200, containerWidth || 0)))
}
