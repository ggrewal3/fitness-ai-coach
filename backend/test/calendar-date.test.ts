import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays,
  calendarDateInTimeZone,
  datesInRange,
  daysBetween,
  instantRangeCovering,
  isCalendarDate,
  isValidTimeZone,
  rollingWeekPeriods,
  trailingRange,
} from "../src/lib/dates/calendarDate.js";

describe("calendar dates", () => {
  it("accepts only real YYYY-MM-DD dates", () => {
    for (const valid of ["2026-10-02", "2024-02-29", "2026-12-31"]) assert.ok(isCalendarDate(valid), valid);
    for (const invalid of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-1-2", "2026-10-02T00:00:00Z", "", "today"]) {
      assert.ok(!isCalendarDate(invalid), invalid);
    }
  });

  it("does day arithmetic on the calendar, across months, years and DST", () => {
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2024-03-01", -1), "2024-02-29");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    // US DST starts 2026-03-08 and ends 2026-11-01: still exactly one day each.
    assert.equal(addDays("2026-03-07", 1), "2026-03-08");
    assert.equal(addDays("2026-03-08", 1), "2026-03-09");
    assert.equal(addDays("2026-11-01", 1), "2026-11-02");
    assert.equal(daysBetween("2026-03-01", "2026-03-15"), 14);
    assert.equal(daysBetween("2026-03-15", "2026-03-01"), -14);
  });

  it("builds rolling periods: the 7 days ending today and the 7 before", () => {
    assert.deepEqual(trailingRange("2026-10-02", 1), { startDate: "2026-10-02", endDate: "2026-10-02" });
    assert.deepEqual(rollingWeekPeriods("2026-10-02"), {
      current: { startDate: "2026-09-26", endDate: "2026-10-02" },
      previous: { startDate: "2026-09-19", endDate: "2026-09-25" },
    });
    assert.equal(datesInRange(rollingWeekPeriods("2026-03-10").current).length, 7);
  });
});

describe("timezones", () => {
  it("accepts IANA names, including current names ICU treats as aliases", () => {
    for (const valid of ["America/New_York", "Asia/Kolkata", "Asia/Calcutta", "Europe/Kyiv", "UTC", "Etc/GMT+5"]) {
      assert.ok(isValidTimeZone(valid), valid);
    }
  });

  it("rejects unknown names, raw offsets and junk", () => {
    for (const invalid of ["Mars/Phobos", "+05:00", "-0800", "GMT+5:30", "America/New York", "", "a".repeat(80), "../etc/passwd"]) {
      assert.equal(isValidTimeZone(invalid), false, invalid);
    }
  });

  it("places instants on the local calendar date, DST-aware", () => {
    // 2026-03-08 06:59Z is 01:59 EST (still the 8th); 2026-03-09 03:30Z is 23:30 EDT on the 8th.
    assert.equal(calendarDateInTimeZone(new Date("2026-03-08T06:59:00Z"), "America/New_York"), "2026-03-08");
    assert.equal(calendarDateInTimeZone(new Date("2026-03-09T03:30:00Z"), "America/New_York"), "2026-03-08");
    // Fall back: 2026-11-02 04:30Z is 23:30 EST on Nov 1.
    assert.equal(calendarDateInTimeZone(new Date("2026-11-02T04:30:00Z"), "America/New_York"), "2026-11-01");
    // The same instant is a different date on either side of the date line.
    const instant = new Date("2026-06-15T11:30:00Z");
    assert.equal(calendarDateInTimeZone(instant, "Pacific/Kiritimati"), "2026-06-16");
    assert.equal(calendarDateInTimeZone(instant, "Pacific/Pago_Pago"), "2026-06-15");
    assert.equal(calendarDateInTimeZone(new Date("2026-06-15T23:30:00Z"), "Asia/Kolkata"), "2026-06-16");
  });

  it("covers every instant of a local date range in any timezone", () => {
    const range = { startDate: "2026-06-10", endDate: "2026-06-15" };
    const { from, before } = instantRangeCovering(range);
    // Earliest: 00:00 on the 10th at UTC+14; latest: 23:59 on the 15th at UTC−12.
    assert.ok(from <= new Date("2026-06-09T10:00:00Z"));
    assert.ok(before > new Date("2026-06-16T11:59:00Z"));
  });
});
