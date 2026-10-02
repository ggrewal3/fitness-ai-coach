import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUserRateLimiter } from "../src/middleware/userRateLimit.middleware.js";

function limiter(time: { now: number }, maxTrackedUsers?: number) {
  return createUserRateLimiter({
    windows: [
      { windowMs: 60_000, max: 3 },
      { windowMs: 3_600_000, max: 5 },
    ],
    message: "Slow down.",
    maxTrackedUsers,
    now: () => time.now,
  });
}

describe("per-user rate limiter", () => {
  it("allows requests up to the limit, then blocks with a retry time", () => {
    const time = { now: 0 };
    const rate = limiter(time);

    for (let request = 0; request < 3; request += 1) assert.equal(rate.hit(1).allowed, true);
    time.now = 20_000;
    assert.deepEqual(rate.hit(1), { allowed: false, retryAfterSeconds: 40 });
  });

  it("keeps users separate", () => {
    const time = { now: 0 };
    const rate = limiter(time);

    for (let request = 0; request < 3; request += 1) rate.hit(1);
    assert.equal(rate.hit(1).allowed, false);
    assert.equal(rate.hit(2).allowed, true);
  });

  it("resets after the window, and the longer window still applies", () => {
    const time = { now: 0 };
    const rate = limiter(time);

    for (let request = 0; request < 3; request += 1) rate.hit(1);
    time.now = 60_000;
    assert.equal(rate.hit(1).allowed, true);
    assert.equal(rate.hit(1).allowed, true);
    // 5 per hour reached: blocked even though the minute window has room.
    const blocked = rate.hit(1);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 3540);
    time.now = 3_600_000;
    assert.equal(rate.hit(1).allowed, true);
  });

  it("blocked requests do not consume quota", () => {
    const time = { now: 0 };
    const rate = limiter(time);

    for (let request = 0; request < 3; request += 1) rate.hit(1);
    for (let request = 0; request < 10; request += 1) assert.equal(rate.hit(1).allowed, false);
    time.now = 60_000;
    assert.equal(rate.hit(1).allowed, true);
  });

  it("sweeps expired users and never tracks more than the cap", () => {
    const time = { now: 0 };
    const rate = limiter(time, 50);

    for (let userId = 1; userId <= 120; userId += 1) rate.hit(userId);
    assert.equal(rate.trackedUsers(), 50);

    time.now = 3_600_000;
    rate.hit(999);
    assert.equal(rate.trackedUsers(), 1);
  });
});
