import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { PROVIDER_SUBJECT_MAX_LENGTH, sameNonce, SocialTokenError, verifyProviderToken } from "./providerToken.js";

// Verifies a Google ID token from Google Identity Services (ADR-028).
// Everything used afterwards comes from the signed token, never from other
// request fields. Errors carry only a category (providerToken.ts).

export { CLOCK_TOLERANCE_SECONDS, SocialTokenError, type SocialTokenFailure } from "./providerToken.js";

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/** The claims FitAI uses, after signature and claim validation. */
export interface VerifiedGoogleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  givenName: string | null;
  familyName: string | null;
}

const optionalString = z.string().optional().catch(undefined);

const googleClaimsSchema = z.object({
  sub: z.string().trim().min(1).max(PROVIDER_SUBJECT_MAX_LENGTH),
  nonce: z.string().min(1),
  email: optionalString,
  // Google sends a boolean; anything else counts as unverified.
  email_verified: z.boolean().optional().catch(undefined),
  given_name: optionalString,
  family_name: optionalString,
});

// Production keys: Google's published signing keys, fetched and cached by jose
// (refetched on an unknown key ID). Created only when first needed.
let remoteGoogleKeys: JWTVerifyGetKey | undefined;
let keyResolverOverride: JWTVerifyGetKey | undefined;

function googleKeys(): JWTVerifyGetKey {
  if (keyResolverOverride) return keyResolverOverride;
  remoteGoogleKeys ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return remoteGoogleKeys;
}

/**
 * Test seam: replaces only WHERE verification keys come from (tests sign
 * tokens with locally generated keys). Every signature and claim check still
 * runs. Code-level only; no request or configuration can reach it.
 * `undefined` restores Google's published keys.
 */
export function setGoogleKeyResolver(resolver: JWTVerifyGetKey | undefined): void {
  keyResolverOverride = resolver;
}

export async function verifyGoogleIdToken(
  credential: string,
  options: { clientId: string; expectedNonce: string }
): Promise<VerifiedGoogleIdentity> {
  const payload = await verifyProviderToken(credential, googleKeys(), { issuer: GOOGLE_ISSUERS, audience: options.clientId });

  const claims = googleClaimsSchema.safeParse(payload);
  if (!claims.success) throw new SocialTokenError("invalid_token");

  if (!sameNonce(claims.data.nonce, options.expectedNonce)) throw new SocialTokenError("nonce_mismatch");

  return {
    subject: claims.data.sub,
    email: claims.data.email ?? null,
    emailVerified: claims.data.email_verified === true,
    givenName: claims.data.given_name ?? null,
    familyName: claims.data.family_name ?? null,
  };
}
