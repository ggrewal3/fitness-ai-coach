import { timingSafeEqual } from "node:crypto";
import { errors, jwtVerify, type JWTVerifyGetKey } from "jose";

// Shared verification core for provider ID tokens (Google, Apple; ADR-028).
// Errors carry only a category: jose errors include the token's claims, so
// they must never be logged or returned.

/** Allowed clock difference between a provider and this server. */
export const CLOCK_TOLERANCE_SECONDS = 60;

export type SocialTokenFailure = "invalid_token" | "wrong_audience" | "expired" | "nonce_mismatch" | "provider_unavailable";

export class SocialTokenError extends Error {
  constructor(readonly category: SocialTokenFailure) {
    super(`Social ID token rejected: ${category}`);
    this.name = "SocialTokenError";
  }
}

function categorize(error: unknown): SocialTokenFailure {
  if (error instanceof errors.JWTExpired) return "expired";
  if (error instanceof errors.JWTClaimValidationFailed && error.claim === "aud") return "wrong_audience";
  // The provider's key endpoint timed out, was unreachable or answered badly
  // (jose reports a non-200 answer as a plain JOSEError).
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return "provider_unavailable";
  if (error instanceof errors.JOSEError && error.constructor === errors.JOSEError) return "provider_unavailable";
  if (error instanceof errors.JOSEError) return "invalid_token";
  // Network failures fetching the keys surface as plain errors.
  if (error instanceof TypeError) return "provider_unavailable";
  return "invalid_token";
}

/**
 * Verifies an RS256 ID token's signature, issuer, audience, exp, nbf and iat
 * (60 s tolerance; a future iat is refused), requiring exp, iat and sub.
 * Returns the raw payload for the caller's own claim schema.
 */
export async function verifyProviderToken(
  token: string,
  keys: JWTVerifyGetKey,
  options: { issuer: string | string[]; audience: string }
): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown>;

  try {
    ({ payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"],
      issuer: options.issuer,
      audience: options.audience,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["exp", "iat", "sub"],
    }));
  } catch (error) {
    throw new SocialTokenError(categorize(error));
  }

  // jose checks exp and nbf; also refuse tokens issued in the future.
  const issuedAt = payload.iat;
  if (typeof issuedAt !== "number" || issuedAt > Date.now() / 1000 + CLOCK_TOLERANCE_SECONDS) {
    throw new SocialTokenError("invalid_token");
  }

  return payload;
}

/** Constant-time comparison of the token's nonce with the one FitAI issued. */
export function sameNonce(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The provider subject column's bound (shared by every provider). */
export const PROVIDER_SUBJECT_MAX_LENGTH = 255;
