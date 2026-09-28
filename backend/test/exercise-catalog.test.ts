import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { BUILT_IN_EXERCISES } from "../src/modules/exercises/exercise.catalog.js";
import { toNormalizedName } from "../src/modules/exercises/exercise.normalize.js";
import { seedBuiltInExercises } from "../src/modules/exercises/exercise.service.js";
import { prisma } from "./helpers.js";

after(async () => {
  await prisma.$disconnect();
});

describe("built-in exercise catalogue", () => {
  it("contains the approved starter set without timed holds", () => {
    assert.equal(BUILT_IN_EXERCISES.length, 82);

    const names = BUILT_IN_EXERCISES.map((entry) => toNormalizedName(entry.name));
    assert.ok(!names.some((name) => name.includes("plank")));
    assert.equal(new Set(names).size, names.length, "normalized names are unique");
    assert.equal(
      new Set(BUILT_IN_EXERCISES.map((entry) => entry.key)).size,
      BUILT_IN_EXERCISES.length,
      "keys are unique"
    );
  });

  it("seeds idempotently", async () => {
    await seedBuiltInExercises(prisma);
    const second = await seedBuiltInExercises(prisma);

    assert.equal(second.created, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.unchanged, BUILT_IN_EXERCISES.length);

    const builtIns = await prisma.exercise.findMany({
      where: { userId: null },
      select: { builtInKey: true, normalizedName: true },
    });

    assert.equal(builtIns.length, BUILT_IN_EXERCISES.length);
    assert.equal(new Set(builtIns.map((row) => row.builtInKey)).size, builtIns.length);
    assert.equal(new Set(builtIns.map((row) => row.normalizedName)).size, builtIns.length);
  });

  it("keeps a built-in's id stable when its name is corrected", async () => {
    const before = await prisma.exercise.findUniqueOrThrow({
      where: { builtInKey: "dip" },
    });

    // Simulate an older/incorrect name; the seed restores the catalogue name
    // in place rather than creating a new row.
    await prisma.exercise.update({
      where: { builtInKey: "dip" },
      data: { name: "Old Dip Name", normalizedName: "old dip name" },
    });

    const result = await seedBuiltInExercises(prisma);
    const afterSeed = await prisma.exercise.findUniqueOrThrow({
      where: { builtInKey: "dip" },
    });

    assert.equal(result.created, 0);
    assert.equal(result.updated, 1);
    assert.equal(afterSeed.id, before.id);
    assert.equal(afterSeed.name, "Dip");
    assert.equal(afterSeed.normalizedName, "dip");
    assert.equal(
      await prisma.exercise.count({ where: { userId: null } }),
      BUILT_IN_EXERCISES.length
    );
  });
});
