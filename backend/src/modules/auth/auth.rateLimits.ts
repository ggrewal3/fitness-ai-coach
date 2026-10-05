import { createIpRateLimiter } from "../../middleware/userRateLimit.middleware.js";

// Per-IP limits for the unauthenticated auth endpoints, one bucket per
// endpoint so a burst on one (e.g. nonce requests) never blocks another.
// Process-local (see createRateLimiter): a multi-instance deployment needs a
// shared store, and a reverse proxy needs Express's "trust proxy" setting.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MESSAGE = "Too many attempts. Please wait a moment and try again.";

export const AUTH_RATE_LIMITS = {
  login: [
    { windowMs: MINUTE, max: 10 },
    { windowMs: HOUR, max: 100 },
  ],
  register: [
    { windowMs: MINUTE, max: 5 },
    { windowMs: HOUR, max: 30 },
  ],
  nonce: [
    { windowMs: MINUTE, max: 20 },
    { windowMs: HOUR, max: 200 },
  ],
  social: [
    { windowMs: MINUTE, max: 10 },
    { windowMs: HOUR, max: 100 },
  ],
} as const;

export const loginRateLimiter = createIpRateLimiter({ windows: [...AUTH_RATE_LIMITS.login], message: MESSAGE });
export const registerRateLimiter = createIpRateLimiter({ windows: [...AUTH_RATE_LIMITS.register], message: MESSAGE });
export const nonceRateLimiter = createIpRateLimiter({ windows: [...AUTH_RATE_LIMITS.nonce], message: MESSAGE });
// Each social provider endpoint gets its own bucket with the same limits.
export const googleRateLimiter = createIpRateLimiter({ windows: [...AUTH_RATE_LIMITS.social], message: MESSAGE });
export const appleRateLimiter = createIpRateLimiter({ windows: [...AUTH_RATE_LIMITS.social], message: MESSAGE });

/** Test-only: clears every auth limiter (all test traffic shares one loopback IP). */
export function resetAuthRateLimits(): void {
  for (const limiter of [loginRateLimiter, registerRateLimiter, nonceRateLimiter, googleRateLimiter, appleRateLimiter]) limiter.reset();
}
