import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getUserProfileTool } from "../src/modules/ai/tools/get-user-profile.tool.js";
import {
  createApi,
  createTestUser,
  deleteTestUsers,
  errorFields,
  prisma,
  startTestServer,
  type Api,
  type ApiResult,
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

const VALID_PROFILE = {
  dateOfBirth: "1990-05-15",
  heightCm: 178,
  targetWeightKg: 76.5,
  goal: "LOSE_FAT",
  activityLevel: "MODERATE",
  dietPreference: "VEGETARIAN",
  medicalNotes: "Old knee injury.",
};

/** A YYYY-MM-DD date relative to today (UTC). */
function utcDate({ years = 0, days = 0 }: { years?: number; days?: number }) {
  const now = new Date();
  const date = new Date(
    Date.UTC(now.getUTCFullYear() + years, now.getUTCMonth(), now.getUTCDate() + days)
  );
  return date.toISOString().slice(0, 10);
}

function createProfile(user: TestUser, body: unknown) {
  return api("POST", "/api/profile", { token: user.token, body });
}

function patchProfile(user: TestUser, body: unknown) {
  return api("PATCH", "/api/profile/me", { token: user.token, body });
}

async function userWithProfile(body: Record<string, unknown> = VALID_PROFILE) {
  const user = await createTestUser(api, createdUserIds);
  const created = await createProfile(user, body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return user;
}

async function expectRejected(
  request: (user: TestUser, body: unknown) => Promise<ApiResult>,
  user: TestUser,
  body: unknown,
  field: string
) {
  const response = await request(user, body);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(response.body.message, "Validation failed.");
  assert.deepEqual(errorFields(response.body), [field], JSON.stringify(response.body));
}

describe("fitness profile authentication", () => {
  it("requires a token on every profile route", async () => {
    assert.equal((await api("GET", "/api/profile/me")).status, 401);
    assert.equal((await api("POST", "/api/profile", { body: VALID_PROFILE })).status, 401);
    assert.equal((await api("PATCH", "/api/profile/me", { body: { heightCm: 180 } })).status, 401);
  });
});

describe("POST /api/profile", () => {
  it("creates a profile from valid data", async () => {
    const user = await createTestUser(api, createdUserIds);

    const response = await createProfile(user, VALID_PROFILE);

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.userId, user.id);
    assert.equal(response.body.dateOfBirth, "1990-05-15T00:00:00.000Z");
    assert.equal(response.body.heightCm, 178);
    assert.equal(response.body.targetWeightKg, 76.5);
    assert.equal(response.body.goal, "LOSE_FAT");
    assert.equal(response.body.activityLevel, "MODERATE");
    assert.equal(response.body.dietPreference, "VEGETARIAN");
    assert.equal(response.body.medicalNotes, "Old knee injury.");

    const read = await api("GET", "/api/profile/me", { token: user.token });
    assert.equal(read.status, 200);
    assert.equal(read.body.id, user.id);
    assert.equal(read.body.profile.heightCm, 178);
  });

  it("keeps accepting a profile with no fields", async () => {
    const user = await createTestUser(api, createdUserIds);

    const response = await createProfile(user, {});

    assert.equal(response.status, 201);
    assert.equal(response.body.heightCm, null);
  });

  it("returns 409 when the profile already exists", async () => {
    const user = await userWithProfile();

    const response = await createProfile(user, { heightCm: 190 });

    assert.equal(response.status, 409);
    assert.equal(response.body.message, "Fitness profile already exists.");
    const stored = await prisma.fitnessProfile.findUnique({ where: { userId: user.id } });
    assert.equal(stored?.heightCm, 178);
  });

  it("validates fields on creation too", async () => {
    const user = await createTestUser(api, createdUserIds);

    await expectRejected(createProfile, user, { heightCm: 300 }, "heightCm");
    await expectRejected(createProfile, user, { goal: "BULK" }, "goal");
    await expectRejected(createProfile, user, { dateOfBirth: utcDate({ days: 1 }) }, "dateOfBirth");
    await expectRejected(createProfile, user, { userId: 1, heightCm: 180 }, "body");
    assert.equal(await prisma.fitnessProfile.count({ where: { userId: user.id } }), 0);
  });
});

describe("PATCH /api/profile/me", () => {
  it("keeps returning 404 before a profile exists", async () => {
    const user = await createTestUser(api, createdUserIds);

    const response = await patchProfile(user, { heightCm: 180 });

    assert.equal(response.status, 404);
    assert.equal(response.body.message, "Fitness profile not found.");
  });

  it("applies partial updates and leaves other fields untouched", async () => {
    const user = await userWithProfile();

    const response = await patchProfile(user, { heightCm: 180.5, goal: "MAINTAIN" });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.heightCm, 180.5);
    assert.equal(response.body.goal, "MAINTAIN");
    assert.equal(response.body.targetWeightKg, 76.5);
    assert.equal(response.body.dateOfBirth, "1990-05-15T00:00:00.000Z");
    assert.equal(response.body.medicalNotes, "Old knee injury.");
  });

  it("clears nullable fields with null", async () => {
    const user = await userWithProfile();

    const response = await patchProfile(user, {
      dateOfBirth: null,
      heightCm: null,
      targetWeightKg: null,
      goal: null,
      activityLevel: null,
      dietPreference: null,
      medicalNotes: null,
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    for (const field of Object.keys(VALID_PROFILE)) {
      assert.equal(response.body[field], null, field);
    }
  });

  it("rejects invalid enum values", async () => {
    const user = await userWithProfile();

    await expectRejected(patchProfile, user, { goal: "lose_fat" }, "goal");
    await expectRejected(patchProfile, user, { activityLevel: "EXTREME" }, "activityLevel");
    await expectRejected(patchProfile, user, { dietPreference: "KETO" }, "dietPreference");
  });

  it("enforces height boundaries", async () => {
    const user = await userWithProfile();

    for (const heightCm of [50, 275]) {
      const response = await patchProfile(user, { heightCm });
      assert.equal(response.status, 200);
      assert.equal(response.body.heightCm, heightCm);
    }

    for (const heightCm of [49.9, 275.1, -1, "180"]) {
      await expectRejected(patchProfile, user, { heightCm }, "heightCm");
    }
  });

  it("enforces target-weight boundaries", async () => {
    const user = await userWithProfile();

    for (const targetWeightKg of [20, 400]) {
      const response = await patchProfile(user, { targetWeightKg });
      assert.equal(response.status, 200);
      assert.equal(response.body.targetWeightKg, targetWeightKg);
    }

    for (const targetWeightKg of [19.99, 400.01, 0, "75"]) {
      await expectRejected(patchProfile, user, { targetWeightKg }, "targetWeightKg");
    }
  });

  it("validates the date of birth", async () => {
    const user = await userWithProfile();

    for (const dateOfBirth of [
      "not-a-date",
      "2001-02-30",
      "1990-13-01",
      "1990-05-15T00:00:00Z",
      "15/05/1990",
      utcDate({}),
      utcDate({ days: 1 }),
      utcDate({ years: -121 }),
      19900515,
    ]) {
      await expectRejected(patchProfile, user, { dateOfBirth }, "dateOfBirth");
    }

    const leapDay = await patchProfile(user, { dateOfBirth: "2000-02-29" });
    assert.equal(leapDay.status, 200);
    assert.equal(leapDay.body.dateOfBirth, "2000-02-29T00:00:00.000Z");
  });

  it("requires the user to be at least 13 years old", async () => {
    const user = await userWithProfile();

    const underage = await patchProfile(user, { dateOfBirth: utcDate({ years: -13, days: 1 }) });
    assert.equal(underage.status, 400);
    assert.equal(underage.body.errors[0].message, "You must be at least 13 years old.");

    const thirteenToday = utcDate({ years: -13 });
    const accepted = await patchProfile(user, { dateOfBirth: thirteenToday });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.dateOfBirth, `${thirteenToday}T00:00:00.000Z`);
  });

  it("limits medical notes and turns blank notes into null", async () => {
    const user = await userWithProfile();

    const longest = await patchProfile(user, { medicalNotes: "m".repeat(2000) });
    assert.equal(longest.status, 200);
    assert.equal(longest.body.medicalNotes.length, 2000);

    await expectRejected(patchProfile, user, { medicalNotes: "m".repeat(2001) }, "medicalNotes");

    const blank = await patchProfile(user, { medicalNotes: "   " });
    assert.equal(blank.status, 200);
    assert.equal(blank.body.medicalNotes, null);
  });

  it("rejects unknown fields and empty updates", async () => {
    const userA = await userWithProfile();
    const userB = await userWithProfile();

    await expectRejected(patchProfile, userA, { userId: userB.id, heightCm: 150 }, "body");
    await expectRejected(patchProfile, userA, { heightCm: 150, weightKg: 80 }, "body");
    await expectRejected(patchProfile, userA, {}, "body");

    const storedB = await prisma.fitnessProfile.findUnique({ where: { userId: userB.id } });
    assert.equal(storedB?.heightCm, 178);
  });

  it("returns structured validation errors instead of server errors", async () => {
    const user = await userWithProfile();

    const response = await patchProfile(user, {
      dateOfBirth: "yesterday",
      heightCm: 9999,
      goal: 7,
    });

    assert.equal(response.status, 400);
    assert.deepEqual(errorFields(response.body).sort(), ["dateOfBirth", "goal", "heightCm"]);
  });
});

describe("AI profile tool", () => {
  const context = (userId: number, bodyWeightUnit: "KG" | "LB" = "KG", heightUnit: "CM" | "FT_IN" = "CM") => ({
    userId,
    today: "2026-06-15",
    timeZone: "UTC",
    units: { bodyWeightUnit, heightUnit },
  });

  it("returns profile facts with display units and never exposes medical notes", async () => {
    const user = await userWithProfile();

    const result = await getUserProfileTool.execute({}, context(user.id));

    assert.equal(result.found, true);
    assert.ok(result.found);
    assert.deepEqual(Object.keys(result.profile).sort(), [
      "activityLevel",
      "age",
      "dietPreference",
      "displayHeight",
      "displayTargetWeight",
      "goal",
      "heightCm",
      "isUnder18",
      "targetWeightKg",
    ]);
    assert.equal(result.profile.heightCm, 178);
    assert.equal(result.profile.displayHeight, "178 cm");
    assert.equal(result.profile.isUnder18, false);
    assert.ok(!JSON.stringify(result).includes("knee"));
  });

  it("uses the preferred display units and flags users under 18 on their own calendar", async () => {
    // 18th birthday on 2026-06-16: still 17 on the user's 2026-06-15.
    const user = await userWithProfile({ ...VALID_PROFILE, dateOfBirth: "2008-06-16", heightCm: 180, targetWeightKg: 80 });

    const result = await getUserProfileTool.execute({}, context(user.id, "LB", "FT_IN"));
    const birthday = await getUserProfileTool.execute({}, { ...context(user.id), today: "2026-06-16" });

    assert.ok(result.found && birthday.found);
    assert.equal(result.profile.age, 17);
    assert.equal(result.profile.isUnder18, true);
    assert.equal(birthday.profile.age, 18);
    assert.equal(birthday.profile.isUnder18, false);
    assert.equal(result.profile.heightCm, 180);
    assert.equal(result.profile.displayHeight, "5 ft 11 in");
    assert.equal(result.profile.targetWeightKg, 80);
    assert.equal(result.profile.displayTargetWeight, "176.4 lb");
  });
});
