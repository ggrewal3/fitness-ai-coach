import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILT_IN_EXERCISES } from "../src/modules/exercises/exercise.catalog.js";
import {
  toBuiltInKey,
  toDisplayName,
  toNormalizedName,
} from "../src/modules/exercises/exercise.normalize.js";

describe("exercise name normalization", () => {
  it("trims and collapses whitespace for display, keeping casing", () => {
    assert.equal(toDisplayName(" Bench   Press "), "Bench Press");
    assert.equal(toDisplayName("Farmer’s\tCarry"), "Farmer’s Carry");
    assert.equal(toDisplayName("bench press"), "bench press");
  });

  it("normalizes case and whitespace to the same key", () => {
    assert.equal(toNormalizedName(" Bench   Press "), "bench press");
    assert.equal(toNormalizedName("bench press"), "bench press");
    assert.equal(toNormalizedName("BENCH PRESS"), "bench press");
  });

  it("treats hyphens/underscores as spaces and drops apostrophes", () => {
    assert.equal(toNormalizedName("Push-Up"), "push up");
    assert.equal(toNormalizedName("push up"), "push up");
    assert.equal(toNormalizedName("push_up"), "push up");
    assert.equal(toNormalizedName("T-Bar Row"), "t bar row");
    assert.equal(toNormalizedName("Farmer’s Carry"), "farmers carry");
    assert.equal(toNormalizedName("Farmer's Carry"), "farmers carry");
  });

  it("keeps spelling variants distinct (no fuzzy matching in V1)", () => {
    assert.equal(toNormalizedName("Pushup"), "pushup");
    assert.notEqual(toNormalizedName("Pushup"), toNormalizedName("Push-Up"));
  });

  it("applies Unicode NFKC normalization", () => {
    // Full-width letters and a non-breaking space normalize to plain ASCII.
    assert.equal(toNormalizedName("ＢＥＮＣＨ Press"), "bench press");
  });

  it("returns an empty key for blank input", () => {
    assert.equal(toNormalizedName("   "), "");
  });

  it("derives kebab-case built-in keys", () => {
    assert.equal(toBuiltInKey("Farmer’s Carry"), "farmers-carry");
    assert.equal(toBuiltInKey("EZ-Bar Curl"), "ez-bar-curl");
  });

  it("uses catalogue keys consistent with their names", () => {
    for (const entry of BUILT_IN_EXERCISES) {
      assert.equal(entry.key, toBuiltInKey(entry.name), entry.name);
    }
  });
});
