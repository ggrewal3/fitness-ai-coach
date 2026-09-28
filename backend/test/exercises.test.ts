import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { toNormalizedName } from "../src/modules/exercises/exercise.normalize.js";
import {
  builtInExerciseId,
  createApi,
  createTestUser,
  deleteTestUsers,
  errorFields,
  prisma,
  startTestServer,
  type Api,
  type TestServer,
  type TestUser,
} from "./helpers.js";

let server: TestServer;
let api: Api;
const createdUserIds: number[] = [];

before(async () => {
  server = await startTestServer();
  api = createApi(server.baseUrl);
});

after(async () => {
  await deleteTestUsers(createdUserIds);
  await server.close();
  await prisma.$disconnect();
});

async function search(user: TestUser, query: string) {
  const response = await api("GET", `/api/exercises${query}`, { token: user.token });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body as { id: number; name: string; isCustom: boolean }[];
}

async function createCustom(user: TestUser, name: string) {
  return api("POST", "/api/exercises", { token: user.token, body: { name } });
}

describe("GET /api/exercises", () => {
  it("requires authentication", async () => {
    const response = await api("GET", "/api/exercises?search=bench");
    assert.equal(response.status, 401);
  });

  it("ranks 'bench' matches: whole-query prefix, then word prefixes alphabetically", async () => {
    const user = await createTestUser(api, createdUserIds);
    const results = await search(user, "?search=bench");

    assert.deepEqual(
      results.map((exercise) => exercise.name),
      [
        "Bench Dip", // "bench dip" starts with the whole query
        "Barbell Bench Press",
        "Close-Grip Bench Press",
        "Decline Barbell Bench Press",
        "Dumbbell Bench Press",
        "Incline Barbell Bench Press",
        "Incline Dumbbell Bench Press",
      ]
    );
    assert.ok(results.every((exercise) => exercise.isCustom === false));
  });

  it("orders exact > prefix > word prefix > substring, then alphabetically", async () => {
    const user = await createTestUser(api, createdUserIds);
    await createCustom(user, "Row");
    await createCustom(user, "Rowing Machine Sprint");
    await createCustom(user, "Throwdown Drill"); // contains "row" mid-word only

    const results = await search(user, "?search=row&limit=50");

    assert.deepEqual(
      results.map((exercise) => exercise.name),
      [
        "Row", // exact
        "Rowing Machine Sprint", // whole-query prefix
        "Barbell Row", // word prefixes, alphabetical by normalized name
        "Chest-Supported Row",
        "Dumbbell Row",
        "Inverted Row",
        "Seated Cable Row",
        "T-Bar Row",
        "Upright Row",
        "Throwdown Drill", // substring only
      ]
    );
  });

  it("puts an exact built-in match first", async () => {
    const user = await createTestUser(api, createdUserIds);
    const results = await search(user, "?search=dip");

    assert.deepEqual(
      results.map((exercise) => exercise.name),
      ["Dip", "Bench Dip"]
    );
  });

  it("is case-, whitespace- and hyphen-insensitive", async () => {
    const user = await createTestUser(api, createdUserIds);

    assert.deepEqual(
      await search(user, `?search=${encodeURIComponent("  BENCH   press ")}`),
      await search(user, "?search=bench%20press")
    );
    assert.equal((await search(user, "?search=push%20up"))[0].name, "Push-Up");
    assert.equal((await search(user, "?search=PUSH-UP"))[0].name, "Push-Up");
  });

  it("requires every query word to match", async () => {
    const user = await createTestUser(api, createdUserIds);

    assert.deepEqual(
      (await search(user, "?search=bench%20incline")).map((exercise) => exercise.name),
      ["Incline Barbell Bench Press", "Incline Dumbbell Bench Press"]
    );
    assert.deepEqual(await search(user, "?search=incline%20db"), []);
  });

  it("returns one alphabetical list for an empty query without prioritizing custom exercises", async () => {
    const user = await createTestUser(api, createdUserIds);
    await createCustom(user, "Aardvark Crawl");
    await createCustom(user, "Zercher Squat");

    const results = await search(user, "?limit=50");

    const visible = await prisma.exercise.findMany({
      where: { OR: [{ userId: null }, { userId: user.id }] },
      select: { id: true, normalizedName: true },
    });
    const expected = visible
      .sort((a, b) =>
        a.normalizedName < b.normalizedName
          ? -1
          : a.normalizedName > b.normalizedName
            ? 1
            : a.id - b.id
      )
      .slice(0, 50)
      .map((row) => row.id);

    assert.equal(results.length, 50);
    assert.deepEqual(results.map((exercise) => exercise.id), expected);
    assert.equal(results[0].name, "Aardvark Crawl");
    assert.ok(!results.some((exercise) => exercise.name === "Zercher Squat"));
  });

  it("applies the default and requested limits", async () => {
    const user = await createTestUser(api, createdUserIds);

    assert.equal((await search(user, "")).length, 20);
    assert.equal((await search(user, "?limit=5")).length, 5);
  });

  it("rejects invalid query parameters", async () => {
    const user = await createTestUser(api, createdUserIds);

    for (const query of [
      "?limit=0",
      "?limit=51",
      "?limit=abc",
      `?search=${"a".repeat(61)}`,
      "?search=a&search=b",
    ]) {
      const response = await api("GET", `/api/exercises${query}`, { token: user.token });
      assert.equal(response.status, 400, query);
    }
  });

  it("never exposes another user's custom exercises", async () => {
    const owner = await createTestUser(api, createdUserIds);
    const other = await createTestUser(api, createdUserIds);
    const created = await createCustom(owner, "Secret Sled Push");
    assert.equal(created.status, 201);

    assert.deepEqual(await search(other, "?search=secret"), []);
    assert.deepEqual(await search(other, "?search=secret%20sled%20push"), []);

    const otherEmpty = await search(other, "?limit=50");
    assert.ok(!otherEmpty.some((exercise) => exercise.id === created.body.exercise.id));

    const ownerResults = await search(owner, "?search=secret");
    assert.deepEqual(ownerResults, [
      { id: created.body.exercise.id, name: "Secret Sled Push", isCustom: true },
    ]);
  });

  it("returns only id, name and isCustom", async () => {
    const user = await createTestUser(api, createdUserIds);
    const [first] = await search(user, "?search=bench");

    assert.deepEqual(Object.keys(first).sort(), ["id", "isCustom", "name"]);
  });
});

describe("POST /api/exercises", () => {
  it("requires authentication", async () => {
    const response = await api("POST", "/api/exercises", { body: { name: "Landmine Press" } });
    assert.equal(response.status, 401);
  });

  it("creates a private custom exercise and reuses it for normalized duplicates", async () => {
    const user = await createTestUser(api, createdUserIds);

    const created = await createCustom(user, "Landmine Press");
    assert.equal(created.status, 201);
    assert.equal(created.body.created, true);
    assert.equal(created.body.exercise.name, "Landmine Press");
    assert.equal(created.body.exercise.isCustom, true);

    for (const variant of [" landmine   PRESS ", "Landmine-Press", "LANDMINE-press"]) {
      const reused = await createCustom(user, variant);
      assert.equal(reused.status, 200, variant);
      assert.equal(reused.body.created, false);
      assert.deepEqual(reused.body.exercise, created.body.exercise);
    }

    assert.equal(await prisma.exercise.count({ where: { userId: user.id } }), 1);

    const found = await search(user, "?search=landmine");
    assert.deepEqual(found, [created.body.exercise]);
  });

  it("stores the cleaned display name", async () => {
    const user = await createTestUser(api, createdUserIds);
    const created = await createCustom(user, "  Zottman   Curl ");

    assert.equal(created.status, 201);
    assert.equal(created.body.exercise.name, "Zottman Curl");
  });

  it("returns the built-in exercise instead of creating a custom copy", async () => {
    const user = await createTestUser(api, createdUserIds);
    const benchId = await builtInExerciseId("barbell-bench-press");

    const response = await createCustom(user, "  barbell BENCH press");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      exercise: { id: benchId, name: "Barbell Bench Press", isCustom: false },
      created: false,
    });
    assert.equal(await prisma.exercise.count({ where: { userId: user.id } }), 0);

    const hyphenated = await createCustom(user, "push up");
    assert.equal(hyphenated.body.exercise.id, await builtInExerciseId("push-up"));
  });

  it("lets different users create identically named custom exercises", async () => {
    const first = await createTestUser(api, createdUserIds);
    const second = await createTestUser(api, createdUserIds);

    const a = await createCustom(first, "Viking Press");
    const b = await createCustom(second, "Viking Press");

    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.body.exercise.id, b.body.exercise.id);
  });

  it("rejects ownership or built-in fields in the request", async () => {
    const user = await createTestUser(api, createdUserIds);

    for (const body of [
      { name: "Sneaky Press", userId: null },
      { name: "Sneaky Press", builtInKey: "sneaky-press" },
      { name: "Sneaky Press", isCustom: false },
    ]) {
      const response = await api("POST", "/api/exercises", { token: user.token, body });
      assert.equal(response.status, 400, JSON.stringify(body));
    }

    assert.equal(
      await prisma.exercise.count({ where: { normalizedName: "sneaky press" } }),
      0
    );
  });

  it("validates exercise names", async () => {
    const user = await createTestUser(api, createdUserIds);

    // "_" is outside the approved character set even though search
    // normalization treats it as a space.
    for (const name of ["a", "x".repeat(61), "!!!", "---", "Press <script>", "Bench\u0000Press", "landmine_press"]) {
      const response = await createCustom(user, name);
      assert.equal(response.status, 400, name);
      const fields = errorFields(response.body);
      assert.ok(fields.length > 0 && fields.every((field) => field === "name"), `${name}: ${JSON.stringify(fields)}`);
    }

    for (const body of [{}, { name: 123 }, { name: null }]) {
      const response = await api("POST", "/api/exercises", { token: user.token, body });
      assert.equal(response.status, 400, JSON.stringify(body));
    }

    // Allowed punctuation.
    const allowed = await createCustom(user, "90/90 Hip Switch (Band) & Reach, Alt. +1");
    assert.equal(allowed.status, 201);
  });

  it("enforces the custom exercise limit but still reuses existing names", async () => {
    const user = await createTestUser(api, createdUserIds);

    await prisma.exercise.createMany({
      data: Array.from({ length: 500 }, (_, index) => ({
        userId: user.id,
        name: `Limit Exercise ${index}`,
        normalizedName: toNormalizedName(`Limit Exercise ${index}`),
      })),
    });

    const blocked = await createCustom(user, "One Too Many");
    assert.equal(blocked.status, 400);
    assert.deepEqual(errorFields(blocked.body), ["name"]);

    const reused = await createCustom(user, "limit exercise 7");
    assert.equal(reused.status, 200);
    assert.equal(reused.body.created, false);

    const builtIn = await createCustom(user, "Dip");
    assert.equal(builtIn.status, 200);
    assert.equal(builtIn.body.exercise.isCustom, false);
  });

  it("exposes no way to modify or delete exercises", async () => {
    const user = await createTestUser(api, createdUserIds);
    const dipId = await builtInExerciseId("dip");

    const patched = await api("PATCH", `/api/exercises/${dipId}`, {
      token: user.token,
      body: { name: "Hacked" },
    });
    const deleted = await api("DELETE", `/api/exercises/${dipId}`, { token: user.token });

    assert.equal(patched.status, 404);
    assert.equal(deleted.status, 404);

    const dip = await prisma.exercise.findUniqueOrThrow({ where: { id: dipId } });
    assert.equal(dip.name, "Dip");
    assert.equal(dip.userId, null);
  });
});
