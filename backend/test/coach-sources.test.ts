import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveSources } from "../src/modules/ai/coach.sources.js";

const TODAY = "2026-10-02";

describe("coach sources", () => {
  it("maps tools to public categories with the requested period", () => {
    assert.deepEqual(
      deriveSources(
        [
          { name: "getUserProfile", days: null },
          { name: "getWeightHistory", days: 14 },
          { name: "getNutritionHistory", days: 7 },
          { name: "getActivityHistory", days: 1 },
          { name: "getWorkoutHistory", days: 90 },
        ],
        TODAY
      ),
      [
        { type: "profile", startDate: null, endDate: null },
        { type: "weight", startDate: "2026-09-19", endDate: TODAY },
        { type: "nutrition", startDate: "2026-09-26", endDate: TODAY },
        { type: "activity", startDate: TODAY, endDate: TODAY },
        { type: "workouts", startDate: "2026-07-05", endDate: TODAY },
      ]
    );
  });

  it("merges repeated types into one source covering the widest window, in order of first use", () => {
    assert.deepEqual(
      deriveSources(
        [
          { name: "getWorkoutHistory", days: 7 },
          { name: "getUserProfile", days: null },
          { name: "getWorkoutHistory", days: 30 },
          { name: "getWorkoutHistory", days: 14 },
          { name: "getUserProfile", days: null },
        ],
        TODAY
      ),
      [
        { type: "workouts", startDate: "2026-09-03", endDate: TODAY },
        { type: "profile", startDate: null, endDate: null },
      ]
    );
  });

  it("returns no sources when no data tool succeeded, and ignores unknown names", () => {
    assert.deepEqual(deriveSources([], TODAY), []);
    assert.deepEqual(deriveSources([{ name: "getEveryUsersData", days: 7 }], TODAY), []);
  });

  it("never exposes internal tool names", () => {
    const sources = deriveSources([{ name: "getWeightHistory", days: 7 }], TODAY);
    assert.ok(!JSON.stringify(sources).includes("get"));
  });
});
