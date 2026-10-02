import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBodyWeight,
  formatBodyWeightChange,
  formatHeight,
  KG_PER_LB,
} from "../src/lib/units/displayUnits.js";

// The frontend's Phase 4 formatter, loaded at runtime (a path variable keeps
// the backend typecheck from pulling frontend sources into its program).
const FRONTEND_UNIT_FORMAT = new URL("../../frontend/src/features/units/unitFormat.ts", import.meta.url).href;

describe("AI display units", () => {
  it("uses the exact Phase 4 constants and rounding", () => {
    assert.equal(KG_PER_LB, 0.45359237);
    assert.equal(formatBodyWeight(80, "KG"), "80 kg");
    assert.equal(formatBodyWeight(80, "LB"), "176.4 lb");
    assert.equal(formatBodyWeight(80.25, "KG"), "80.3 kg");
    assert.equal(formatHeight(180, "CM"), "180 cm");
    assert.equal(formatHeight(180.34, "CM"), "180.3 cm");
    assert.equal(formatHeight(180, "FT_IN"), "5 ft 11 in");
    assert.equal(formatHeight(182.6, "FT_IN"), "6 ft 0 in");
  });

  it("formats signed changes", () => {
    assert.equal(formatBodyWeightChange(0.2, "LB"), "+0.4 lb");
    assert.equal(formatBodyWeightChange(-1.25, "KG"), "-1.3 kg");
    assert.equal(formatBodyWeightChange(0, "KG"), "0 kg");
    assert.equal(formatBodyWeightChange(-0.01, "KG"), "0 kg");
  });

  it("matches the frontend formatter for every 0.1 kg from 20 to 500 and every 0.1 cm from 50 to 275", async () => {
    const frontend = await import(FRONTEND_UNIT_FORMAT);

    for (let tenths = 200; tenths <= 5000; tenths += 1) {
      const kg = tenths / 10;
      for (const unit of ["KG", "LB"] as const) {
        assert.equal(formatBodyWeight(kg, unit), frontend.formatBodyWeight(kg, unit), `${kg} kg as ${unit}`);
      }
    }

    for (let tenths = 500; tenths <= 2750; tenths += 1) {
      const cm = tenths / 10;
      for (const unit of ["CM", "FT_IN"] as const) {
        assert.equal(formatHeight(cm, unit), frontend.formatHeight(cm, unit), `${cm} cm as ${unit}`);
      }
    }
  });
});
