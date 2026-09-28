import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createApi,
  createTestUser,
  deleteTestUsers,
  prisma,
  startTestServer,
  type Api,
  type TestServer,
} from "./helpers.js";

// Smoke checks that the app/server split kept every existing route mounted
// and working.
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

describe("existing routes", () => {
  it("serves the health check", async () => {
    const response = await api("GET", "/api/health");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "success", message: "Fitness AI backend running" });
  });

  it("authenticates and guards protected routes", async () => {
    const user = await createTestUser(api, createdUserIds);

    assert.equal((await api("GET", "/api/protected-test")).status, 401);
    assert.equal((await api("GET", "/api/protected-test", { token: user.token })).status, 200);
    assert.equal(
      (await api("POST", "/api/auth/login", { body: { email: user.email, password: "wrong-password" } })).status,
      401
    );
  });

  it("creates, lists and deletes weight check-ins", async () => {
    const user = await createTestUser(api, createdUserIds);

    const created = await api("POST", "/api/checkins", {
      token: user.token,
      body: { weightKg: 81.7, recordedAt: "2026-09-27T08:15:00Z" },
    });
    assert.equal(created.status, 201);

    const list = await api("GET", "/api/checkins", { token: user.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].weightKg, 81.7);

    assert.equal((await api("DELETE", `/api/checkins/${created.body.id}`, { token: user.token })).status, 204);
  });

  it("creates nutrition items and summarizes a day", async () => {
    const user = await createTestUser(api, createdUserIds);

    const created = await api("POST", "/api/nutrition", {
      token: user.token,
      body: {
        foodName: "Greek yogurt",
        quantity: 200,
        unit: "g",
        calories: 146,
        proteinGrams: 20,
        carbsGrams: 8,
        fatGrams: 4,
        mealType: "BREAKFAST",
        entryDate: "2026-09-28",
        recordedAt: "2026-09-28T08:00:00Z",
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const summary = await api("GET", "/api/nutrition/summary/2026-09-28", { token: user.token });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.found, true);
    assert.equal(summary.body.totalCalories, 146);

    const list = await api("GET", "/api/nutrition", { token: user.token });
    assert.equal(list.body.length, 1);
  });

  it("creates and lists daily activity", async () => {
    const user = await createTestUser(api, createdUserIds);

    const created = await api("POST", "/api/activity", {
      token: user.token,
      body: { steps: 8500, recordedAt: "2026-09-28T20:00:00Z" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const list = await api("GET", "/api/activity", { token: user.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
  });

  it("keeps the profile routes mounted", async () => {
    const user = await createTestUser(api, createdUserIds);
    const response = await api("GET", "/api/profile/me", { token: user.token });

    assert.ok([200, 404].includes(response.status), `unexpected ${response.status}`);
    assert.equal((await api("GET", "/api/profile/me")).status, 401);
  });
});
