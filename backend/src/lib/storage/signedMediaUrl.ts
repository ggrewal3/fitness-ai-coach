import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, expiring read URLs for privately stored media (ADR-024).
//
// signature = HMAC-SHA256(mediaKey, "fitai-media-v1:" + storageKey + ":" + expires)
// mediaKey  = HMAC-SHA256(JWT_SECRET, "fitai-media-signing-key-v1")
//
// The JWT secret is reused only as input keying material. The derived media
// key and the "fitai-media-v1:" prefix keep media signatures domain-separated
// from JWTs: neither can be used as the other. No JWT is created here.

export const MEDIA_URL_TTL_SECONDS = 60 * 60;
// Expiry is rounded up to this step so a URL stays identical for a few minutes,
// letting browsers reuse cached images (effective lifetime 60–70 minutes).
const EXPIRY_STEP_SECONDS = 10 * 60;

const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/; // base64url of 32 bytes
const EXPIRES_PATTERN = /^\d{1,12}$/;

function mediaSigningKey(): Buffer {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is required to sign media URLs.");
  }

  return createHmac("sha256", secret).update("fitai-media-signing-key-v1").digest();
}

function computeSignature(storageKey: string, expires: number): Buffer {
  return createHmac("sha256", mediaSigningKey())
    .update(`fitai-media-v1:${storageKey}:${expires}`)
    .digest();
}

export function signMediaKey(
  storageKey: string,
  nowMs: number = Date.now()
): { expires: number; signature: string } {
  const nowSeconds = Math.floor(nowMs / 1000);
  const expires = Math.ceil((nowSeconds + MEDIA_URL_TTL_SECONDS) / EXPIRY_STEP_SECONDS) * EXPIRY_STEP_SECONDS;

  return { expires, signature: computeSignature(storageKey, expires).toString("base64url") };
}

/** Signs an explicit expiry (tests use this to create already-expired URLs). */
export function signMediaKeyWithExpiry(storageKey: string, expires: number): string {
  return computeSignature(storageKey, expires).toString("base64url");
}

/**
 * True only for an untampered signature over exactly this key and expiry that
 * has not yet expired. Comparison is constant-time.
 */
export function verifyMediaSignature(
  storageKey: string,
  expiresRaw: unknown,
  signatureRaw: unknown,
  nowMs: number = Date.now()
): boolean {
  if (
    typeof expiresRaw !== "string" ||
    typeof signatureRaw !== "string" ||
    !EXPIRES_PATTERN.test(expiresRaw) ||
    !SIGNATURE_PATTERN.test(signatureRaw)
  ) {
    return false;
  }

  const expires = Number(expiresRaw);
  const expected = computeSignature(storageKey, expires);
  const provided = Buffer.from(signatureRaw, "base64url");

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return false;
  }

  return expires > Math.floor(nowMs / 1000);
}
