// Public sign-in provider configuration (compiled into the bundle; none of it
// is secret). The Google client ID is the same OAuth web client as the
// backend's GOOGLE_CLIENT_ID; the Apple client ID is the Services ID, the same
// value as the backend's APPLE_CLIENT_ID. A provider whose configuration is
// missing (or, for Apple, has no HTTPS return URL) isn't shown at all.
import { appleConfigFrom } from "./appleSignIn"
import { googleClientIdFrom } from "./googleIdentity"

/** Which providers a given Vite environment enables. */
export function socialSignInConfigFrom(env: Record<string, unknown>) {
  const google = googleClientIdFrom(env.VITE_GOOGLE_CLIENT_ID)
  const apple = appleConfigFrom(env.VITE_APPLE_CLIENT_ID, env.VITE_APPLE_REDIRECT_URI)
  return { google, apple, any: google !== null || apple !== null }
}

const config = socialSignInConfigFrom(import.meta.env as unknown as Record<string, unknown>)

export const GOOGLE_CLIENT_ID = config.google
export const APPLE_CONFIG = config.apple
/** Whether any social sign-in is offered (the section and its divider are hidden otherwise). */
export const HAS_SOCIAL_SIGN_IN = config.any
