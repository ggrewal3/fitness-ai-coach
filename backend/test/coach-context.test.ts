import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays, calendarDateInTimeZone } from "../src/lib/dates/calendarDate.js";
import { clientContextSchema } from "../src/modules/ai/coach.context.js";

const todayIn = (timeZone: string) => calendarDateInTimeZone(new Date(), timeZone);

describe("coach client context", () => {
  it("accepts today in the user's timezone and keeps the timezone name as given", () => {
    for (const timeZone of ["America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      const result = clientContextSchema.safeParse({ today: todayIn(timeZone), timeZone });
      assert.ok(result.success, timeZone);
      assert.deepEqual(result.data, { today: todayIn(timeZone), timeZone });
    }
  });

  it("allows ±1 day of clock skew but rejects manipulated dates", () => {
    const timeZone = "America/New_York";
    const today = todayIn(timeZone);

    for (const offset of [-1, 1]) {
      assert.ok(clientContextSchema.safeParse({ today: addDays(today, offset), timeZone }).success, `offset ${offset}`);
    }
    for (const offset of [-2, 2, -30, 365]) {
      const result = clientContextSchema.safeParse({ today: addDays(today, offset), timeZone });
      assert.ok(!result.success, `offset ${offset}`);
      assert.deepEqual(result.error.issues.map((issue) => issue.path.join(".")), ["today"]);
    }
  });

  it("judges today against the given timezone, not the server's", () => {
    // Kiritimati (UTC+14) is 25 hours ahead of Pago Pago (UTC−11), so its
    // dates run 1–2 days ahead: Kiritimati's tomorrow is never a valid
    // "today" for Pago Pago, whatever the server's own timezone.
    const kiritimatiTomorrow = addDays(todayIn("Pacific/Kiritimati"), 1);
    assert.ok(!clientContextSchema.safeParse({ today: kiritimatiTomorrow, timeZone: "Pacific/Pago_Pago" }).success);
  });

  it("rejects invalid dates and timezones", () => {
    const cases: [unknown, string][] = [
      [{ today: "2026-02-30", timeZone: "UTC" }, "today"],
      [{ today: "02/10/2026", timeZone: "UTC" }, "today"],
      [{ today: todayIn("UTC"), timeZone: "Mars/Phobos" }, "timeZone"],
      [{ today: todayIn("UTC"), timeZone: "+05:00" }, "timeZone"],
      [{ today: todayIn("UTC") }, "timeZone"],
      [{ today: todayIn("UTC"), timeZone: "UTC", now: "2026-01-01T00:00:00Z" }, ""],
    ];

    for (const [input, field] of cases) {
      const result = clientContextSchema.safeParse(input);
      assert.ok(!result.success, JSON.stringify(input));
      assert.ok(result.error.issues.some((issue) => issue.path.join(".") === field), JSON.stringify(result.error.issues));
    }
  });
});
