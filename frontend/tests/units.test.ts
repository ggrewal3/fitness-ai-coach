import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { CHECK_IN_WEIGHT_KG_MAX, checkInWeightMax, checkInWeightToKg } from "../src/features/units/bodyWeightInput"
import {
  formatBodyWeight,
  formatBodyWeightValue,
  formatDecimal,
  formatHeight,
  formatTotalInches,
} from "../src/features/units/unitFormat"
import {
  CM_PER_INCH,
  INCHES_PER_FOOT,
  KG_PER_LB,
  bodyWeightFromKg,
  bodyWeightRange,
  bodyWeightToKg,
  cmToFeetInches,
  feetInchesToCanonicalCm,
  feetInchesToCm,
  heightInchesRange,
  kgToLb,
  lbToKg,
  parseDecimalInput,
  parseWholeNumberInput,
  roundTo,
} from "../src/features/units/units"

describe("constants", () => {
  test("uses the exact international pound and inch", () => {
    assert.equal(KG_PER_LB, 0.45359237)
    assert.equal(CM_PER_INCH, 2.54)
    assert.equal(INCHES_PER_FOOT, 12)
  })
})

describe("kg ↔ lb", () => {
  test("converts both ways", () => {
    assert.equal(lbToKg(1), 0.45359237)
    assert.equal(roundTo(kgToLb(80), 4), 176.3698)
    assert.equal(roundTo(kgToLb(lbToKg(225)), 9), 225)
  })

  test("canonical kg from lb is rounded to 0.01 kg; kg input is kept as typed", () => {
    assert.equal(bodyWeightToKg(176.4, "LB"), 80.01)
    assert.equal(bodyWeightToKg(225, "LB"), 102.06)
    assert.equal(bodyWeightToKg(80.123, "KG"), 80.123)
  })

  test("display values have at most one decimal", () => {
    assert.equal(bodyWeightFromKg(80, "LB"), 176.4)
    assert.equal(bodyWeightFromKg(80, "KG"), 80)
    assert.equal(bodyWeightFromKg(72.46, "KG"), 72.5)
  })

  test("every 0.1 lb from 0.1 to 1102.3 survives lb → kg (0.01) → lb display", () => {
    for (let tenths = 1; tenths <= 11023; tenths += 1) {
      const lb = tenths / 10
      assert.equal(bodyWeightFromKg(bodyWeightToKg(lb, "LB"), "LB"), lb, `${lb} lb`)
    }
  })

  test("kg shown in lb and entered back drifts at most 0.02 kg (so it is never re-sent untouched)", () => {
    for (let tenths = 1; tenths <= 5000; tenths += 1) {
      const kg = tenths / 10
      const back = bodyWeightToKg(bodyWeightFromKg(kg, "LB"), "LB")
      assert.ok(Math.abs(back - kg) <= 0.02 + 1e-9, `${kg} kg → ${back} kg`)
    }
    assert.notEqual(bodyWeightToKg(bodyWeightFromKg(80, "LB"), "LB"), 80)
  })
})

describe("cm ↔ feet and inches", () => {
  test("180 cm displays as 5 ft 11 in", () => {
    assert.deepEqual(cmToFeetInches(180), { feet: 5, inches: 11 })
    assert.equal(formatHeight(180, "FT_IN"), "5 ft 11 in")
  })

  test("5 ft 11 in is stored as 180.3 cm (0.1 cm)", () => {
    assert.equal(roundTo(feetInchesToCm(5, 11), 4), 180.34)
    assert.equal(feetInchesToCanonicalCm({ feet: 5, inches: 11 }), 180.3)
  })

  test("rounding to the nearest inch rolls over into the next foot", () => {
    assert.deepEqual(cmToFeetInches(182.6), { feet: 6, inches: 0 })
    assert.deepEqual(cmToFeetInches(181.3), { feet: 5, inches: 11 })
    assert.deepEqual(cmToFeetInches(152.4), { feet: 5, inches: 0 })
  })

  test("every whole inch from 20 to 108 round-trips through cm (0.1)", () => {
    for (let inches = 20; inches <= 108; inches += 1) {
      const cm = feetInchesToCanonicalCm({ feet: Math.floor(inches / 12), inches: inches % 12 })
      const back = cmToFeetInches(cm)
      assert.equal(back.feet * 12 + back.inches, inches, `${inches} in`)
    }
  })
})

describe("ranges", () => {
  test("target weight 20–400 kg is 44.1–881.8 lb, rounded inwards", () => {
    assert.deepEqual(bodyWeightRange({ min: 20, max: 400 }, "LB"), { min: 44.1, max: 881.8 })
    assert.deepEqual(bodyWeightRange({ min: 20, max: 400 }, "KG"), { min: 20, max: 400 })
    assert.ok(bodyWeightToKg(44.1, "LB") >= 20)
    assert.ok(bodyWeightToKg(44.0, "LB") < 20)
    assert.ok(bodyWeightToKg(881.8, "LB") <= 400)
    assert.ok(bodyWeightToKg(881.9, "LB") > 400)
  })

  test("height 50–275 cm is 20–108 whole inches (1 ft 8 in – 9 ft 0 in)", () => {
    assert.deepEqual(heightInchesRange({ min: 50, max: 275 }), { min: 20, max: 108 })
    assert.equal(formatTotalInches(20), "1 ft 8 in")
    assert.equal(formatTotalInches(108), "9 ft 0 in")
    assert.ok(feetInchesToCanonicalCm({ feet: 1, inches: 7 }) < 50)
    assert.ok(feetInchesToCanonicalCm({ feet: 9, inches: 1 }) > 275)
  })
})

describe("check-in weight", () => {
  test("maximum is 500 kg / 1102.3 lb", () => {
    assert.equal(CHECK_IN_WEIGHT_KG_MAX, 500)
    assert.equal(checkInWeightMax("KG"), 500)
    assert.equal(checkInWeightMax("LB"), 1102.3)
    assert.deepEqual(checkInWeightToKg("1102.3", "LB"), { ok: true, kg: 499.99 })
    assert.deepEqual(checkInWeightToKg("1102.4", "LB"), { ok: false, message: "Enter a weight up to 1102.3 lb." })
    assert.deepEqual(checkInWeightToKg("500", "KG"), { ok: true, kg: 500 })
    assert.deepEqual(checkInWeightToKg("500.1", "KG"), { ok: false, message: "Enter a weight up to 500 kg." })
  })

  test("converts lb to canonical kg and keeps kg as typed", () => {
    assert.deepEqual(checkInWeightToKg("176.4", "LB"), { ok: true, kg: 80.01 })
    assert.deepEqual(checkInWeightToKg("80.25", "KG"), { ok: true, kg: 80.25 })
  })

  test("rejects empty, zero, negative and non-numeric input in the shown unit", () => {
    for (const text of ["", "0", "-5", "abc", "1e3", "0.001"]) {
      const result = checkInWeightToKg(text, "LB")
      assert.equal(result.ok, false, text)
      assert.equal(!result.ok && result.message, "Enter a valid weight in lb.")
    }
  })
})

describe("parsing", () => {
  test("decimals accept . or , and reject anything else", () => {
    assert.equal(parseDecimalInput("176.4"), 176.4)
    assert.equal(parseDecimalInput(" 176,4 "), 176.4)
    assert.equal(parseDecimalInput(".5"), 0.5)
    assert.equal(parseDecimalInput("80."), 80)
    for (const text of ["", "  ", "abc", "-1", "1e2", "1.2.3", "Infinity", "NaN", "12 lb"]) {
      assert.equal(parseDecimalInput(text), null, JSON.stringify(text))
    }
  })

  test("whole numbers reject decimals and signs", () => {
    assert.equal(parseWholeNumberInput("5"), 5)
    assert.equal(parseWholeNumberInput(" 11 "), 11)
    for (const text of ["", "5.5", "-1", "five", "1e1"]) {
      assert.equal(parseWholeNumberInput(text), null, JSON.stringify(text))
    }
  })
})

describe("formatting", () => {
  test("at most one decimal with trailing zeros trimmed", () => {
    assert.equal(formatDecimal(80), "80")
    assert.equal(formatDecimal(80.0), "80")
    assert.equal(formatDecimal(176.40), "176.4")
    assert.equal(formatDecimal(180.25), "180.3")
    assert.equal(formatDecimal(0.04), "0")
  })

  test("body weight and height strings", () => {
    assert.equal(formatBodyWeight(80, "KG"), "80 kg")
    assert.equal(formatBodyWeight(80, "LB"), "176.4 lb")
    assert.equal(formatBodyWeightValue(102.06, "LB"), "225")
    assert.equal(formatHeight(180, "CM"), "180 cm")
    assert.equal(formatHeight(180.34, "CM"), "180.3 cm")
  })
})
