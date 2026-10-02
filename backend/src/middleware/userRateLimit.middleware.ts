import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../types/auth.types.js";

export interface RateLimitWindow {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per user in one window. */
  max: number;
}

export interface UserRateLimiterOptions {
  windows: RateLimitWindow[];
  /** Response message when a limit is hit. */
  message: string;
  /** Upper bound on tracked users; the oldest entries are dropped beyond it. */
  maxTrackedUsers?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

interface WindowState {
  startedAt: number;
  count: number;
}

const DEFAULT_MAX_TRACKED_USERS = 10_000;

/**
 * Fixed-window, per-user rate limiter kept in process memory. It has no
 * dependency and suits the current single-instance deployment; a
 * multi-instance deployment needs a shared store (e.g. Redis) instead.
 *
 * Memory stays bounded: expired entries are swept at most once per shortest
 * window, and the map never holds more than `maxTrackedUsers` users.
 * Mount it after authMiddleware, so requests are keyed by the JWT's userId.
 */
export function createUserRateLimiter(options: UserRateLimiterOptions) {
  const now = options.now ?? Date.now;
  const maxTrackedUsers = options.maxTrackedUsers ?? DEFAULT_MAX_TRACKED_USERS;
  const sweepEveryMs = Math.min(...options.windows.map((window) => window.windowMs));
  const longestWindowMs = Math.max(...options.windows.map((window) => window.windowMs));
  const users = new Map<number, WindowState[]>();
  let lastSweep = now();

  function sweep(time: number) {
    if (time - lastSweep < sweepEveryMs) return;
    lastSweep = time;

    for (const [userId, states] of users) {
      if (states.every((state) => time - state.startedAt >= longestWindowMs)) {
        users.delete(userId);
      }
    }
  }

  /** Records one request; returns whether it is allowed and, if not, when to retry. */
  function hit(userId: number): { allowed: boolean; retryAfterSeconds: number } {
    const time = now();
    sweep(time);

    const states =
      users.get(userId) ?? options.windows.map(() => ({ startedAt: time, count: 0 }));

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
    users.delete(userId);
    users.set(userId, states);
    while (users.size > maxTrackedUsers) {
      users.delete(users.keys().next().value as number);
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

  function middleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const result = hit(req.userId);

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      return res.status(429).json({ message: options.message });
    }

    next();
  }

  return {
    middleware,
    hit,
    /** Number of users currently tracked (for tests). */
    trackedUsers: () => users.size,
  };
}
