import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { PROVIDER_SUBJECT_MAX_LENGTH, sameNonce, SocialTokenError, verifyProviderToken } from "./providerToken.js";

// Verifies a Sign in with Apple ID token (ADR-028), identity token only: no
// authorization-code exchange, no client secret, no Apple tokens kept.
// Subject, email and the private-relay flag come only from the signed token.
// The user's name is NOT in the token (Apple sends it to the browser on the
// first authorization only), so it is handled elsewhere as unsigned input.

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

/** The claims FitAI uses, after signature and claim validation. */
export interface VerifiedAppleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  isPrivateEmail: boolean;
}

// Apple sends these flags as a boolean or as the string "true"/"false"; a
// missing flag (or any other value) counts as false.
const appleFlag = z.unknown().optional().transform((value) => value === true || value === "true");

const appleClaimsSchema = z.object({
  sub: z.string().trim().min(1).max(PROVIDER_SUBJECT_MAX_LENGTH),
  nonce: z.string().min(1),
  email: z.string().optional().catch(undefined),
  email_verified: appleFlag,
  is_private_email: appleFlag,
});

// Production keys: Apple's published signing keys, fetched and cached by jose
// (refetched on an unknown key ID). Created only when first needed.
let remoteAppleKeys: JWTVerifyGetKey | undefined;
let keyResolverOverride: JWTVerifyGetKey | undefined;

function appleKeys(): JWTVerifyGetKey {
  if (keyResolverOverride) return keyResolverOverride;
  remoteAppleKeys ??= createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  return remoteAppleKeys;
}

/**
 * Test seam: replaces only WHERE verification keys come from (tests sign
 * tokens with locally generated keys). Every signature and claim check still
 * runs. Code-level only; no request or configuration can reach it.
 * `undefined` restores Apple's published keys.
 */
export function setAppleKeyResolver(resolver: JWTVerifyGetKey | undefined): void {
  keyResolverOverride = resolver;
}

export async function verifyAppleIdToken(
  idToken: string,
  options: { clientId: string; expectedNonce: string }
): Promise<VerifiedAppleIdentity> {
  const payload = await verifyProviderToken(idToken, appleKeys(), { issuer: APPLE_ISSUER, audience: options.clientId });

  const claims = appleClaimsSchema.safeParse(payload);
  if (!claims.success) throw new SocialTokenError("invalid_token");

  if (!sameNonce(claims.data.nonce, options.expectedNonce)) throw new SocialTokenError("nonce_mismatch");

  return {
    subject: claims.data.sub,
    email: claims.data.email ?? null,
    emailVerified: claims.data.email_verified,
    isPrivateEmail: claims.data.is_private_email,
  };
}
