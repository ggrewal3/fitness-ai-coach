// The no-drift rule for converted measurements (ADR-006): values converted
// only for display are never sent back; only real edits are converted.
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  fitnessChanges,
  fitnessDraftFromProfile,
  heightHint,
  targetWeightHint,
  updateFitnessDraft,
  validateFitness,
  type FitnessUnits,
} from "../src/features/settings/fitnessDraft"
import type { FitnessProfile } from "../src/services/fitnessProfile"

const profile: FitnessProfile = {
  id: 1,
  dateOfBirth: "1990-05-01T00:00:00.000Z",
  heightCm: 180,
  targetWeightKg: 80,
  goal: "MAINTAIN",
  activityLevel: "MODERATE",
  dietPreference: "NO_PREFERENCE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

const METRIC: FitnessUnits = { bodyWeightUnit: "KG", heightUnit: "CM" }
const IMPERIAL: FitnessUnits = { bodyWeightUnit: "LB", heightUnit: "FT_IN" }

describe("converted values are shown but never re-sent", () => {
  test("80 kg shown as 176.4 lb and 180 cm as 5 ft 11 in", () => {
    const draft = fitnessDraftFromProfile(profile, IMPERIAL)
    assert.equal(draft.targetWeight, "176.4")
    assert.equal(draft.heightFeet, "5")
    assert.equal(draft.heightInches, "11")
    assert.deepEqual(fitnessChanges(draft, profile), {})
  })

  test("saving only Goal sends only goal (no targetWeightKg, no heightCm)", () => {
    const draft = updateFitnessDraft(fitnessDraftFromProfile(profile, IMPERIAL), "goal", "LOSE_FAT")
    assert.deepEqual(fitnessChanges(draft, profile), { goal: "LOSE_FAT" })
  })

  test("saving only Goal in metric units also sends only goal", () => {
    const draft = updateFitnessDraft(fitnessDraftFromProfile(profile, METRIC), "goal", "GAIN_MUSCLE")
    assert.deepEqual(fitnessChanges(draft, profile), { goal: "GAIN_MUSCLE" })
  })

  test("a draft rebuilt for a different preference is still clean", () => {
    for (const units of [METRIC, IMPERIAL, { bodyWeightUnit: "LB", heightUnit: "CM" } as const]) {
      assert.deepEqual(fitnessChanges(fitnessDraftFromProfile(profile, units), profile), {})
    }
  })

  test("values that do not round-trip exactly stay clean when untouched", () => {
    const awkward = { ...profile, heightCm: 172.72, targetWeightKg: 63.37 }
    assert.deepEqual(fitnessChanges(fitnessDraftFromProfile(awkward, IMPERIAL), awkward), {})
    assert.deepEqual(fitnessChanges(fitnessDraftFromProfile(awkward, METRIC), awkward), {})
  })

  test("untouched converted measurements are not validated", () => {
    const edge = { ...profile, heightCm: 50, targetWeightKg: 20 }
    assert.deepEqual(validateFitness(fitnessDraftFromProfile(edge, IMPERIAL)), {})
  })
})

describe("real edits are converted to canonical units", () => {
  test("editing target weight in lb sends kg rounded to 0.01", () => {
    const draft = updateFitnessDraft(fitnessDraftFromProfile(profile, IMPERIAL), "targetWeight", "170")
    assert.deepEqual(fitnessChanges(draft, profile), { targetWeightKg: 77.11 })
  })

  test("editing target weight in kg sends the typed value", () => {
    const draft = updateFitnessDraft(fitnessDraftFromProfile(profile, METRIC), "targetWeight", "78.5")
    assert.deepEqual(fitnessChanges(draft, profile), { targetWeightKg: 78.5 })
  })

  test("editing height to 6 ft 0 in sends cm rounded to 0.1", () => {
    let draft = fitnessDraftFromProfile(profile, IMPERIAL)
    draft = updateFitnessDraft(draft, "heightFeet", "6")
    draft = updateFitnessDraft(draft, "heightInches", "0")
    assert.deepEqual(fitnessChanges(draft, profile), { heightCm: 182.9 })
  })

  test("entering 5 ft 11 in for a new profile stores 180.3 cm", () => {
    let draft = fitnessDraftFromProfile(null, IMPERIAL)
    draft = updateFitnessDraft(draft, "heightFeet", "5")
    draft = updateFitnessDraft(draft, "heightInches", "11")
    assert.deepEqual(fitnessChanges(draft, null), { heightCm: 180.3 })
  })

  test("empty inches mean 0", () => {
    const draft = updateFitnessDraft(
      updateFitnessDraft(fitnessDraftFromProfile(profile, IMPERIAL), "heightFeet", "6"),
      "heightInches",
      "",
    )
    assert.deepEqual(fitnessChanges(draft, profile), { heightCm: 182.9 })
    assert.deepEqual(validateFitness(draft), {})
  })

  test("editing height in cm sends the typed value", () => {
    const draft = updateFitnessDraft(fitnessDraftFromProfile(profile, METRIC), "heightCm", "181.5")
    assert.deepEqual(fitnessChanges(draft, profile), { heightCm: 181.5 })
  })

  test("clearing measurements sends null (both feet and inches empty)", () => {
    let draft = fitnessDraftFromProfile(profile, IMPERIAL)
    draft = updateFitnessDraft(draft, "heightFeet", "")
    draft = updateFitnessDraft(draft, "heightInches", "")
    draft = updateFitnessDraft(draft, "targetWeight", "")
    assert.deepEqual(fitnessChanges(draft, profile), { heightCm: null, targetWeightKg: null })
  })
})

describe("reverting an edit makes the field clean again", () => {
  test("target weight edited then restored to 176.4", () => {
    let draft = updateFitnessDraft(fitnessDraftFromProfile(profile, IMPERIAL), "targetWeight", "175")
    assert.ok("targetWeightKg" in fitnessChanges(draft, profile))
    draft = updateFitnessDraft(draft, "targetWeight", "176.4")
    assert.deepEqual(fitnessChanges(draft, profile), {})
    draft = updateFitnessDraft(draft, "targetWeight", "176.40")
    assert.deepEqual(fitnessChanges(draft, profile), {})
  })

  test("height edited then restored to 5 ft 11 in", () => {
    let draft = updateFitnessDraft(fitnessDraftFromProfile(profile, IMPERIAL), "heightInches", "10")
    assert.ok("heightCm" in fitnessChanges(draft, profile))
    draft = updateFitnessDraft(draft, "heightInches", "11")
    assert.deepEqual(fitnessChanges(draft, profile), {})
  })
})

describe("validation in the shown unit", () => {
  test("hints", () => {
    assert.equal(targetWeightHint("KG"), "20–400 kg")
    assert.equal(targetWeightHint("LB"), "44.1–881.8 lb")
    assert.equal(heightHint("CM"), "50–275 cm")
    assert.equal(heightHint("FT_IN"), "1 ft 8 in–9 ft 0 in")
  })

  test("target weight bounds use the canonical value that would be sent", () => {
    const base = fitnessDraftFromProfile(profile, IMPERIAL)
    assert.deepEqual(validateFitness(updateFitnessDraft(base, "targetWeight", "44.1")), {})
    assert.deepEqual(validateFitness(updateFitnessDraft(base, "targetWeight", "881.8")), {})
    assert.equal(validateFitness(updateFitnessDraft(base, "targetWeight", "44")).targetWeightKg, "Must be 44.1–881.8 lb.")
    assert.equal(validateFitness(updateFitnessDraft(base, "targetWeight", "881.9")).targetWeightKg, "Must be 44.1–881.8 lb.")
    assert.equal(validateFitness(updateFitnessDraft(base, "targetWeight", "abc")).targetWeightKg, "Enter target weight in lb.")
  })

  test("feet and inches", () => {
    const base = fitnessDraftFromProfile(profile, IMPERIAL)
    const withHeight = (feet: string, inches: string) =>
      validateFitness(updateFitnessDraft(updateFitnessDraft(base, "heightFeet", feet), "heightInches", inches)).heightCm

    assert.equal(withHeight("1", "8"), undefined)
    assert.equal(withHeight("9", "0"), undefined)
    assert.equal(withHeight("1", "7"), "Must be 1 ft 8 in–9 ft 0 in.")
    assert.equal(withHeight("9", "1"), "Must be 1 ft 8 in–9 ft 0 in.")
    assert.equal(withHeight("5", "12"), "Inches must be 0–11.")
    assert.equal(withHeight("5.5", "0"), "Use whole feet and inches.")
    assert.equal(withHeight("5", "1.5"), "Use whole feet and inches.")
    assert.equal(withHeight("", "6"), "Enter feet as well as inches.")
    assert.equal(withHeight("", ""), undefined)
  })

  test("cm and kg keep the existing messages", () => {
    const base = fitnessDraftFromProfile(profile, METRIC)
    assert.equal(validateFitness(updateFitnessDraft(base, "heightCm", "49")).heightCm, "Must be 50–275 cm.")
    assert.equal(validateFitness(updateFitnessDraft(base, "targetWeight", "401")).targetWeightKg, "Must be 20–400 kg.")
    assert.equal(validateFitness(updateFitnessDraft(base, "targetWeight", "abc")).targetWeightKg, "Enter target weight in kg.")
    assert.equal(validateFitness(updateFitnessDraft(base, "heightCm", "1.2.3")).heightCm, "Enter height in cm.")
  })
})
