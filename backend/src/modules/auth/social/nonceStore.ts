import { createHash, randomBytes } from "node:crypto";
import type { AuthProvider } from "../../../generated/prisma/client.js";

// Single-use sign-in nonces (ADR-028). The server issues a random nonce for
// one provider; the browser hands it to the provider, which signs it into the
// ID token; the sign-in request presents it again and it is consumed. A
// captured ID token therefore can't be replayed: its nonce is already gone.
//
// THIS STORE IS PROCESS-LOCAL. Every backend instance has its own memory, so a
// multi-instance deployment needs a shared atomic store (e.g. Redis with
// GETDEL, or a database row deleted in one statement) instead.
//
// Only a SHA-256 digest of each nonce is kept, so the store never holds a
// value that could be presented. Consumption is a synchronous get-and-delete
// on one Map: Node runs it to completion before any other request's code, so
// two simultaneous attempts with the same nonce can't both succeed.

export type NonceProvider = AuthProvider;

export interface NonceStoreOptions {
  /** How long an issued nonce stays usable. */
  ttlMs: number;
  /** Hard cap on outstanding nonces; the oldest are evicted beyond it. */
  maxEntries: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export type NonceConsumeResult = { ok: true } | { ok: false; reason: "unknown" | "expired" | "wrong_provider" };

export const NONCE_TTL_MS = 10 * 60_000;
export const NONCE_MAX_ENTRIES = 10_000;

const digest = (nonce: string) => createHash("sha256").update(nonce, "utf8").digest("base64url");

export function createNonceStore(options: NonceStoreOptions) {
  const now = options.now ?? Date.now;
  // Insertion order is issue order, so the first keys are the oldest.
  const entries = new Map<string, { provider: NonceProvider; expiresAt: number }>();

  function removeExpired(time: number) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= time) entries.delete(key);
    }
  }

  function issue(provider: NonceProvider): { nonce: string; expiresAt: Date } {
    const time = now();

    if (entries.size >= options.maxEntries) {
      removeExpired(time);
      // Still full: evict the oldest outstanding nonces. Memory stays bounded;
      // a user whose nonce was evicted simply starts sign-in again.
      while (entries.size >= options.maxEntries) {
        entries.delete(entries.keys().next().value as string);
      }
    }

    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = time + options.ttlMs;
    entries.set(digest(nonce), { provider, expiresAt });
    return { nonce, expiresAt: new Date(expiresAt) };
  }

  /** Removes the nonce whatever the outcome: a presented nonce is never usable again. */
  function consume(nonce: string, provider: NonceProvider): NonceConsumeResult {
    const key = digest(nonce);
    const entry = entries.get(key);
    entries.delete(key);

    if (!entry) return { ok: false, reason: "unknown" };
    if (entry.expiresAt <= now()) return { ok: false, reason: "expired" };
    if (entry.provider !== provider) return { ok: false, reason: "wrong_provider" };
    return { ok: true };
  }

  return {
    issue,
    consume,
    /** Drops expired entries now (also happens lazily when the store is full). */
    sweep: () => removeExpired(now()),
    size: () => entries.size,
    /** Test-only reset. */
    clear: () => entries.clear(),
  };
}

/** The app's nonce store, swept every minute (the timer never keeps the process alive). */
export const signInNonces = createNonceStore({ ttlMs: NONCE_TTL_MS, maxEntries: NONCE_MAX_ENTRIES });
setInterval(() => signInNonces.sweep(), 60_000).unref();
