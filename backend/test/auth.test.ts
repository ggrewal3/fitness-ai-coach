import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import {
  createApi,
  deleteTestUsers,
  errorFields,
  prisma,
  startTestServer,
  type Api,
  type TestServer,
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

function uniqueLocalPart(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

async function register(email: string, password = "TestPassword123!") {
  const response = await api("POST", "/api/auth/register", {
    body: { firstName: "Test", lastName: "User", email, password },
  });

  if (response.status === 201) {
    createdUserIds.push(response.body.id);
  }

  return response;
}

function login(email: string, password: string) {
  return api("POST", "/api/auth/login", { body: { email, password } });
}

describe("email normalization", () => {
  it("stores registered emails trimmed and lower-cased", async () => {
    const local = uniqueLocalPart("MixedCase");
    const response = await register(`  ${local}@Example.COM  `);

    assert.equal(response.status, 201, JSON.stringify(response.body));
    const expected = `${local.toLowerCase()}@example.com`;
    assert.equal(response.body.email, expected);

    const stored = await prisma.user.findUnique({ where: { id: response.body.id } });
    assert.equal(stored?.email, expected);
  });

  it("logs in regardless of the email's letter case", async () => {
    const local = uniqueLocalPart("mixedcase");
    const password = "CaseInsensitive1!";
    assert.equal((await register(`${local}@Example.COM`, password)).status, 201);

    const loggedIn = await login(`  ${local.toUpperCase()}@example.com `, password);

    assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn.body));
    assert.equal(loggedIn.body.user.email, `${local}@example.com`);
    assert.equal(typeof loggedIn.body.token, "string");
  });

  it("rejects case variations of an existing email as duplicates", async () => {
    const local = uniqueLocalPart("dup");
    assert.equal((await register(`${local}@example.com`)).status, 201);

    for (const variant of [
      `${local.toUpperCase()}@EXAMPLE.COM`,
      `${local}@Example.Com`,
      ` ${local}@example.com `,
    ]) {
      const response = await register(variant);
      assert.equal(response.status, 409, variant);
      assert.equal(response.body.message, "Email already registered.");
    }

    const matches = await prisma.user.count({
      where: { email: { equals: `${local}@example.com`, mode: "insensitive" } },
    });
    assert.equal(matches, 1);
  });

  it("holds the migration's assumptions: every stored email is lower-case and unique ignoring case", async () => {
    const [{ nonLowercase, duplicateGroups }] = await prisma.$queryRaw<
      { nonLowercase: number; duplicateGroups: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM "User" WHERE "email" <> lower("email")) AS "nonLowercase",
        (SELECT count(*)::int FROM (
          SELECT 1 FROM "User" GROUP BY lower("email") HAVING count(*) > 1
        ) AS duplicates) AS "duplicateGroups"
    `;

    assert.equal(nonLowercase, 0);
    assert.equal(duplicateGroups, 0);
  });

  it("rejects malformed emails", async () => {
    const response = await register("not-an-email");

    assert.equal(response.status, 400);
    assert.deepEqual(errorFields(response.body), ["email"]);
  });
});

describe("registration password limits", () => {
  async function expectAccepted(password: string) {
    const email = `${uniqueLocalPart("pw")}@example.com`;
    const response = await register(email, password);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal((await login(email, password)).status, 200);
  }

  async function expectRejected(password: string) {
    const response = await register(`${uniqueLocalPart("pw")}@example.com`, password);
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.deepEqual(errorFields(response.body), ["password"]);
  }

  it("keeps the 8-character minimum", async () => {
    await expectAccepted("abcdefgh");
    await expectRejected("abcdefg");
  });

  it("accepts a normal password", async () => {
    await expectAccepted("Correct-Horse-Battery-9");
  });

  it("accepts exactly 72 UTF-8 bytes and rejects 73", async () => {
    const seventyTwo = "a".repeat(72);
    const seventyThree = "a".repeat(73);
    assert.equal(Buffer.byteLength(seventyTwo, "utf8"), 72);
    assert.equal(Buffer.byteLength(seventyThree, "utf8"), 73);

    await expectAccepted(seventyTwo);
    await expectRejected(seventyThree);
  });

  it("measures the maximum in bytes, not characters", async () => {
    // "é" is 2 bytes: 36 of them are 72 bytes, 37 are 74 bytes (only 37 characters).
    await expectAccepted("é".repeat(36));
    await expectRejected("é".repeat(37));

    // Emoji are 4 bytes (2 UTF-16 units): 19 are 76 bytes but only 38 string units.
    const emoji = "😀".repeat(19);
    assert.equal(emoji.length, 38);
    assert.equal(Buffer.byteLength(emoji, "utf8"), 76);
    await expectRejected(emoji);
    await expectAccepted("😀".repeat(18));
  });
});
