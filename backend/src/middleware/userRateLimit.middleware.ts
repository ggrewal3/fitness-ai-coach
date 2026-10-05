import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../types/auth.types.js";

export interface RateLimitWindow {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per key (user or IP) in one window. */
  max: number;
}

export interface RateLimiterOptions {
  windows: RateLimitWindow[];
  /** Response message when a limit is hit. */
  message: string;
  /** Upper bound on tracked keys; the least recently seen are dropped beyond it. */
  maxTrackedKeys?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface UserRateLimiterOptions extends Omit<RateLimiterOptions, "maxTrackedKeys"> {
  /** Upper bound on tracked users; the oldest entries are dropped beyond it. */
  maxTrackedUsers?: number;
}

interface WindowState {
  startedAt: number;
  count: number;
}

const DEFAULT_MAX_TRACKED_KEYS = 10_000;

/**
 * Fixed-window rate limiting kept in process memory, keyed by a user ID or
 * an IP address. It has no dependency and suits the current single-instance
 * deployment; a multi-instance deployment needs a shared store (e.g. Redis).
 *
 * Memory stays bounded: expired entries are swept at most once per shortest
 * window, and the map never holds more than `maxTrackedKeys` keys.
 */
export function createRateLimiter<Key extends string | number>(options: RateLimiterOptions) {
  const now = options.now ?? Date.now;
  const maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS;
  const sweepEveryMs = Math.min(...options.windows.map((window) => window.windowMs));
  const longestWindowMs = Math.max(...options.windows.map((window) => window.windowMs));
  const entries = new Map<Key, WindowState[]>();
  let lastSweep = now();

  function sweep(time: number) {
    if (time - lastSweep < sweepEveryMs) return;
    lastSweep = time;

    for (const [key, states] of entries) {
      if (states.every((state) => time - state.startedAt >= longestWindowMs)) {
        entries.delete(key);
      }
    }
  }

  /** Records one request; returns whether it is allowed and, if not, when to retry. */
  function hit(key: Key): { allowed: boolean; retryAfterSeconds: number } {
    const time = now();
    sweep(time);

    const states =
      entries.get(key) ?? options.windows.map(() => ({ startedAt: time, count: 0 }));

    states.forEach((state, index) => {
      if (time - state.startedAt >= options.windows[index].windowMs) {
        state.startedAt = time;
        state.count = 0;
      }
    });

    const blocked = options.windows
      .map((window, index) => ({ window, state: states[index] }))
      .filter(({ window, state }) => state.count >= window.max);

    // Re-insert so the map's order is least-recently-used first.
    entries.delete(key);
    entries.set(key, states);
    while (entries.size > maxTrackedKeys) {
      entries.delete(entries.keys().next().value as Key);
    }

    if (blocked.length > 0) {
      const retryAfterMs = Math.max(...blocked.map(({ window, state }) => state.startedAt + window.windowMs - time));
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    states.forEach((state) => {
      state.count += 1;
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Sends the 429 (with Retry-After) and returns true when the key is over its limit. */
  function reject(res: Response, key: Key): boolean {
    const result = hit(key);

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json({ message: options.message });
      return true;
    }

    return false;
  }

  return {
    hit,
    reject,
    /** Number of keys currently tracked (for tests). */
    trackedKeys: () => entries.size,
    /** Forgets every key (test-only reset; never called by request handling). */
    reset: () => entries.clear(),
  };
}

/**
 * Per-user limiter. Mount it after authMiddleware, so requests are keyed by
 * the JWT's userId.
 */
export function createUserRateLimiter(options: UserRateLimiterOptions) {
  const limiter = createRateLimiter<number>({ ...options, maxTrackedKeys: options.maxTrackedUsers });

  function middleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    if (limiter.reject(res, req.userId)) return;
    next();
  }

  return {
    middleware,
    hit: limiter.hit,
    /** Number of users currently tracked (for tests). */
    trackedUsers: limiter.trackedKeys,
  };
}

/**
 * Per-client-IP limiter for routes used before sign-in. The key is only the
 * connection's IP as Express reports it (`req.ip`), never an email or account.
 * Behind a reverse proxy, configure Express's "trust proxy" setting first, or
 * every client would share the proxy's address.
 */
export function createIpRateLimiter(options: RateLimiterOptions) {
  const limiter = createRateLimiter<string>(options);

  function middleware(req: Request, res: Response, next: NextFunction) {
    if (limiter.reject(res, req.ip ?? "unknown")) return;
    next();
  }

  return { middleware, hit: limiter.hit, trackedKeys: limiter.trackedKeys, reset: limiter.reset };
}
