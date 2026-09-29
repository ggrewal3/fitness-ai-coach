import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
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

const DEFAULT_PREFERENCES = {
  bodyWeightUnit: "KG",
  workoutLoadUnit: "LB",
  heightUnit: "CM",
};

before(async () => {
  server = await startTestServer();
  api = createApi(server.baseUrl);
});

after(async () => {
  await deleteTestUsers(createdUserIds);
  await server.close();
  await prisma.$disconnect();
});

function patchProfile(user: TestUser, body: unknown) {
  return api("PATCH", "/api/account/profile", { token: user.token, body });
}

function patchPreferences(user: TestUser, body: unknown) {
  return api("PATCH", "/api/account/preferences", { token: user.token, body });
}

async function expectProfileRejected(user: TestUser, body: unknown, field: string) {
  const response = await patchProfile(user, body);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(response.body.message, "Validation failed.");
  assert.deepEqual(errorFields(response.body), [field], JSON.stringify(response.body));
}

describe("account authentication", () => {
  it("requires a valid token on every account route", async () => {
    for (const [method, path] of [
      ["GET", "/api/account"],
      ["PATCH", "/api/account/profile"],
      ["PATCH", "/api/account/preferences"],
    ]) {
      const body = method === "PATCH" ? { firstName: "X", bodyWeightUnit: "LB" } : undefined;
      assert.equal((await api(method, path, { body })).status, 401, `${method} ${path}`);
      assert.equal(
        (await api(method, path, { body, token: "not-a-real-token" })).status,
        401,
        `${method} ${path} with a bad token`
      );
    }
  });

  it("returns 404 when the token's user no longer exists", async () => {
    const user = await createTestUser(api, createdUserIds);
    await prisma.user.delete({ where: { id: user.id } });

    assert.equal((await api("GET", "/api/account", { token: user.token })).status, 404);
    assert.equal((await patchProfile(user, { firstName: "Ghost" })).status, 404);
    assert.equal((await patchPreferences(user, { heightUnit: "FT_IN" })).status, 404);
    assert.equal(await prisma.userPreference.count({ where: { userId: user.id } }), 0);
  });
});

describe("GET /api/account", () => {
  it("returns identity and contact fields with default preferences, without creating a preference row", async () => {
    const user = await createTestUser(api, createdUserIds);

    const response = await api("GET", "/api/account", { token: user.token });

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body).sort(), [
      "bio",
      "countryCode",
      "createdAt",
      "email",
      "firstName",
      "id",
      "lastName",
      "phone",
      "preferences",
    ]);
    assert.equal(response.body.id, user.id);
    assert.equal(response.body.email, user.email);
    assert.equal(response.body.firstName, "Test");
    assert.equal(response.body.lastName, "User");
    assert.equal(response.body.phone, null);
    assert.equal(response.body.countryCode, null);
    assert.equal(response.body.bio, null);
    assert.ok(!Number.isNaN(Date.parse(response.body.createdAt)));
    assert.deepEqual(response.body.preferences, DEFAULT_PREFERENCES);

    assert.equal(await prisma.userPreference.count({ where: { userId: user.id } }), 0);
  });

  it("returns stored preferences when they exist", async () => {
    const user = await createTestUser(api, createdUserIds);
    await prisma.userPreference.create({
      data: { userId: user.id, bodyWeightUnit: "LB", workoutLoadUnit: "KG", heightUnit: "FT_IN" },
    });

    const response = await api("GET", "/api/account", { token: user.token });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.preferences, {
      bodyWeightUnit: "LB",
      workoutLoadUnit: "KG",
      heightUnit: "FT_IN",
    });
  });

  it("only ever returns the token's own account", async () => {
    const userA = await createTestUser(api, createdUserIds);
    const userB = await createTestUser(api, createdUserIds);

    const response = await api("GET", `/api/account?userId=${userB.id}`, { token: userA.token });

    assert.equal(response.status, 200);
    assert.equal(response.body.id, userA.id);
    assert.equal(response.body.email, userA.email);
  });
});

describe("PATCH /api/account/profile", () => {
  it("trims names and returns the full account shape", async () => {
    const user = await createTestUser(api, createdUserIds);

    const response = await patchProfile(user, { firstName: "  Ada  ", lastName: "\tLovelace " });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.firstName, "Ada");
    assert.equal(response.body.lastName, "Lovelace");
    assert.equal(response.body.email, user.email);
    assert.deepEqual(response.body.preferences, DEFAULT_PREFERENCES);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(stored?.firstName, "Ada");
    assert.equal(stored?.lastName, "Lovelace");
  });

  it("validates name length and presence", async () => {
    const user = await createTestUser(api, createdUserIds);

    assert.equal((await patchProfile(user, { firstName: "a".repeat(50) })).status, 200);
    await expectProfileRejected(user, { firstName: "a".repeat(51) }, "firstName");
    await expectProfileRejected(user, { lastName: "   " }, "lastName");
    await expectProfileRejected(user, { firstName: null }, "firstName");
    await expectProfileRejected(user, { lastName: 42 }, "lastName");
  });

  it("normalizes phone numbers to E.164 form", async () => {
    const user = await createTestUser(api, createdUserIds);

    for (const [input, expected] of [
      ["+1 (415) 555-0100", "+14155550100"],
      ["+44 20.7946.0958", "+442079460958"],
      ["  +91-98765-43210  ", "+919876543210"],
      ["+12345678", "+12345678"],
      ["+123456789012345", "+123456789012345"],
    ]) {
      const response = await patchProfile(user, { phone: input });
      assert.equal(response.status, 200, input);
      assert.equal(response.body.phone, expected, input);
    }

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(stored?.phone, "+123456789012345");
  });

  it("rejects invalid phone numbers", async () => {
    const user = await createTestUser(api, createdUserIds);

    for (const phone of [
      "4155550100",
      "+0123456789",
      "+1234567",
      "+1234567890123456",
      "+1 415 CALL NOW",
      "++14155550100",
      "+1_415_555_0100",
      "+".padEnd(41, "1"),
      14155550100,
    ]) {
      await expectProfileRejected(user, { phone }, "phone");
    }
  });

  it("stores country codes upper-cased and validates them against ISO 3166-1", async () => {
    const user = await createTestUser(api, createdUserIds);

    for (const [input, expected] of [
      ["gb", "GB"],
      [" us ", "US"],
      ["In", "IN"],
    ]) {
      const response = await patchProfile(user, { countryCode: input });
      assert.equal(response.status, 200, input);
      assert.equal(response.body.countryCode, expected);
    }

    for (const countryCode of ["XX", "UK", "EU", "XK", "USA", "U", "1A"]) {
      await expectProfileRejected(user, { countryCode }, "countryCode");
    }
  });

  it("enforces the bio length limit", async () => {
    const user = await createTestUser(api, createdUserIds);

    const maxBio = "b".repeat(500);
    const accepted = await patchProfile(user, { bio: `  ${maxBio}  ` });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.bio, maxBio);

    await expectProfileRejected(user, { bio: "b".repeat(501) }, "bio");
  });

  it("keeps line breaks and tabs in the bio but rejects other control characters", async () => {
    const user = await createTestUser(api, createdUserIds);

    const multiline = await patchProfile(user, { bio: "Line one\r\nLine two\rLine three\n\tIndented" });
    assert.equal(multiline.status, 200);
    assert.equal(multiline.body.bio, "Line one\nLine two\nLine three\n\tIndented");

    // Stored and returned verbatim as plain text, never interpreted as HTML.
    const markup = await patchProfile(user, { bio: "<b>Lifter</b> & runner" });
    assert.equal(markup.body.bio, "<b>Lifter</b> & runner");

    for (const bio of ["null\u0000byte", "escape\u001b[31m", "bell\u0007", "del\u007f", "c1\u0085"]) {
      await expectProfileRejected(user, { bio }, "bio");
    }

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(stored?.bio, "<b>Lifter</b> & runner");
  });

  it("turns blank phone, country and bio into null, and clears them with null", async () => {
    const user = await createTestUser(api, createdUserIds);
    const filled = { phone: "+14155550100", countryCode: "CA", bio: "Hello" };

    assert.equal((await patchProfile(user, filled)).status, 200);
    const blanked = await patchProfile(user, { phone: "  ", countryCode: "", bio: " \n " });
    assert.equal(blanked.status, 200);
    assert.deepEqual([blanked.body.phone, blanked.body.countryCode, blanked.body.bio], [null, null, null]);

    assert.equal((await patchProfile(user, filled)).status, 200);
    const cleared = await patchProfile(user, { phone: null, countryCode: null, bio: null });
    assert.equal(cleared.status, 200);
    assert.deepEqual([cleared.body.phone, cleared.body.countryCode, cleared.body.bio], [null, null, null]);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.deepEqual([stored?.phone, stored?.countryCode, stored?.bio], [null, null, null]);
  });

  it("leaves omitted fields untouched", async () => {
    const user = await createTestUser(api, createdUserIds);

    await patchProfile(user, { phone: "+14155550100", countryCode: "US", bio: "Keep me" });
    const response = await patchProfile(user, { firstName: "Only" });

    assert.equal(response.body.firstName, "Only");
    assert.equal(response.body.lastName, "User");
    assert.equal(response.body.phone, "+14155550100");
    assert.equal(response.body.countryCode, "US");
    assert.equal(response.body.bio, "Keep me");
  });

  it("does not allow changing the email", async () => {
    const user = await createTestUser(api, createdUserIds);

    const response = await patchProfile(user, { email: "hijack@example.com" });
    assert.equal(response.status, 400);
    assert.deepEqual(errorFields(response.body), ["body"]);
    assert.match(response.body.errors[0].message, /email/);

    const mixed = await patchProfile(user, { firstName: "Valid", email: "hijack@example.com" });
    assert.equal(mixed.status, 400);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(stored?.email, user.email);
    assert.equal(stored?.firstName, "Test");
  });

  it("rejects userId and other unknown fields", async () => {
    const userA = await createTestUser(api, createdUserIds);
    const userB = await createTestUser(api, createdUserIds);

    for (const body of [
      { userId: userB.id, firstName: "Mallory" },
      { id: userB.id, firstName: "Mallory" },
      { passwordHash: "x" },
      { firstName: "Valid", nickname: "Nope" },
    ]) {
      const response = await patchProfile(userA, body);
      assert.equal(response.status, 400, JSON.stringify(body));
    }

    const [storedA, storedB] = await Promise.all([
      prisma.user.findUnique({ where: { id: userA.id } }),
      prisma.user.findUnique({ where: { id: userB.id } }),
    ]);
    assert.equal(storedA?.firstName, "Test");
    assert.equal(storedB?.firstName, "Test");
  });

  it("rejects an empty update", async () => {
    const user = await createTestUser(api, createdUserIds);

    for (const body of [{}, { firstName: undefined }]) {
      const response = await patchProfile(user, body);
      assert.equal(response.status, 400);
      assert.equal(response.body.message, "Validation failed.");
    }

    assert.equal((await patchProfile(user, [])).status, 400);
  });

  it("updates only the token's own account", async () => {
    const userA = await createTestUser(api, createdUserIds);
    const userB = await createTestUser(api, createdUserIds);

    assert.equal((await patchProfile(userA, { bio: "A's bio", countryCode: "NZ" })).status, 200);

    const accountB = await api("GET", "/api/account", { token: userB.token });
    assert.equal(accountB.body.bio, null);
    assert.equal(accountB.body.countryCode, null);
  });
});

describe("PATCH /api/account/preferences", () => {
  it("creates the preference row on the first update and updates it afterwards", async () => {
    const user = await createTestUser(api, createdUserIds);

    const first = await patchPreferences(user, { bodyWeightUnit: "LB" });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body, { ...DEFAULT_PREFERENCES, bodyWeightUnit: "LB" });
    assert.equal(await prisma.userPreference.count({ where: { userId: user.id } }), 1);

    const second = await patchPreferences(user, { workoutLoadUnit: "KG", heightUnit: "FT_IN" });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { bodyWeightUnit: "LB", workoutLoadUnit: "KG", heightUnit: "FT_IN" });
    assert.equal(await prisma.userPreference.count({ where: { userId: user.id } }), 1);

    const account = await api("GET", "/api/account", { token: user.token });
    assert.deepEqual(account.body.preferences, second.body);
  });

  it("preserves untouched preferences on partial updates", async () => {
    const user = await createTestUser(api, createdUserIds);

    await patchPreferences(user, { bodyWeightUnit: "LB", workoutLoadUnit: "KG", heightUnit: "FT_IN" });
    const response = await patchPreferences(user, { heightUnit: "CM" });

    assert.deepEqual(response.body, { bodyWeightUnit: "LB", workoutLoadUnit: "KG", heightUnit: "CM" });
  });

  it("rejects invalid units, unknown fields and empty updates", async () => {
    const user = await createTestUser(api, createdUserIds);

    for (const [body, field] of [
      [{ bodyWeightUnit: "kg" }, "bodyWeightUnit"],
      [{ bodyWeightUnit: "STONE" }, "bodyWeightUnit"],
      [{ workoutLoadUnit: null }, "workoutLoadUnit"],
      [{ heightUnit: "IN" }, "heightUnit"],
      [{ heightUnit: "KG" }, "heightUnit"],
      [{ theme: "dark" }, "body"],
      [{ userId: 1, heightUnit: "CM" }, "body"],
      [{}, "body"],
    ] as const) {
      const response = await patchPreferences(user, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.deepEqual(errorFields(response.body), [field], JSON.stringify(response.body));
    }

    assert.equal(await prisma.userPreference.count({ where: { userId: user.id } }), 0);
  });

  it("belongs only to the logged-in user", async () => {
    const userA = await createTestUser(api, createdUserIds);
    const userB = await createTestUser(api, createdUserIds);

    await patchPreferences(userA, { bodyWeightUnit: "LB", workoutLoadUnit: "KG", heightUnit: "FT_IN" });

    const accountB = await api("GET", "/api/account", { token: userB.token });
    assert.deepEqual(accountB.body.preferences, DEFAULT_PREFERENCES);
    assert.equal(await prisma.userPreference.count({ where: { userId: userB.id } }), 0);
  });

  it("never converts stored fitness or workout data", async () => {
    const user = await createTestUser(api, createdUserIds);
    const benchId = await builtInExerciseId("barbell-bench-press");

    const setup = await Promise.all([
      api("POST", "/api/checkins", {
        token: user.token,
        body: { weightKg: 81.7, recordedAt: "2026-09-27T08:15:00Z" },
      }),
      api("POST", "/api/profile", {
        token: user.token,
        body: { heightCm: 180.3, targetWeightKg: 75.5 },
      }),
      api("POST", "/api/activity", {
        token: user.token,
        body: { steps: 8500, walkingDistanceKm: 6.4, recordedAt: "2026-09-28T20:00:00Z" },
      }),
      api("POST", "/api/workouts", {
        token: user.token,
        body: {
          title: "Bench",
          workoutDate: "2026-09-28",
          trainingType: "STRENGTH",
          durationMinutes: 40,
          recordedAt: "2026-09-28T18:00:00Z",
          exercises: [
            {
              exerciseId: benchId,
              sets: [
                { reps: 5, load: 225, loadUnit: "LB" },
                { reps: 5, load: 102.5, loadUnit: "KG" },
                { reps: 10 },
              ],
            },
          ],
        },
      }),
    ]);
    for (const response of setup) {
      assert.equal(response.status, 201, JSON.stringify(response.body));
    }

    async function snapshot() {
      const [checkIns, profile, activity, sets] = await Promise.all([
        prisma.weightCheckIn.findMany({ where: { userId: user.id }, select: { weightKg: true } }),
        prisma.fitnessProfile.findUnique({
          where: { userId: user.id },
          select: { heightCm: true, targetWeightKg: true },
        }),
        prisma.dailyActivity.findMany({ where: { userId: user.id }, select: { walkingDistanceKm: true } }),
        prisma.workoutSet.findMany({
          where: { workoutExercise: { workoutSession: { userId: user.id } } },
          orderBy: { position: "asc" },
          select: { load: true, loadUnit: true },
        }),
      ]);

      return {
        checkIns,
        profile,
        activity,
        sets: sets.map((set) => [set.load?.toString() ?? null, set.loadUnit]),
      };
    }

    const before = await snapshot();
    assert.deepEqual(before.sets, [["225", "LB"], ["102.5", "KG"], [null, null]]);
    assert.deepEqual(before.checkIns, [{ weightKg: 81.7 }]);
    assert.deepEqual(before.profile, { heightCm: 180.3, targetWeightKg: 75.5 });
    assert.deepEqual(before.activity, [{ walkingDistanceKm: 6.4 }]);

    await patchPreferences(user, { bodyWeightUnit: "LB", workoutLoadUnit: "KG", heightUnit: "FT_IN" });
    assert.deepEqual(await snapshot(), before);

    await patchPreferences(user, { bodyWeightUnit: "KG", workoutLoadUnit: "LB", heightUnit: "CM" });
    assert.deepEqual(await snapshot(), before);
  });
});

describe("account cascade", () => {
  it("removes the preference row when the user is deleted", async () => {
    const user = await createTestUser(api, createdUserIds);
    await patchPreferences(user, { heightUnit: "FT_IN" });
    assert.equal(await prisma.userPreference.count({ where: { userId: user.id } }), 1);

    await prisma.user.delete({ where: { id: user.id } });

    assert.equal(await prisma.userPreference.count({ where: { userId: user.id } }), 0);
  });
});
