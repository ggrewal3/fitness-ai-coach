// Social sign-in foundation (Phase 5A-1, ADR-028): optional passwords, the
// shared FitAI session token, HS256-only verification and the AuthIdentity
// constraints. No provider is contacted.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, it, mock } from "node:test";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Prisma } from "../src/generated/prisma/client.js";
import { issueSessionToken, verifySessionToken } from "../src/modules/auth/session.js";
import { createApi, deleteTestUsers, prisma, startTestServer, TEST_PASSWORD, type Api, type TestServer } from "./helpers.js";

let server: TestServer;
let api: Api;
const createdUserIds: number[] = [];

before(async () => {
  server = await startTestServer();
  api = createApi(server.baseUrl);
});

afterEach(() => mock.restoreAll());

after(async () => {
  await deleteTestUsers(createdUserIds);
  await server.close();
});

const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID()}@fitai-test.local`;

async function registerPasswordUser() {
  const email = uniqueEmail("password");
  const response = await api("POST", "/api/auth/register", {
    body: { firstName: "Pass", lastName: "Word", email, password: TEST_PASSWORD },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  createdUserIds.push(response.body.id);
  return { id: response.body.id as number, email };
}

/** An account that signs in only with Google/Apple: no password credential. */
async function createSocialOnlyUser() {
  const email = uniqueEmail("social");
  const user = await prisma.user.create({
    data: { firstName: "Social", lastName: "Only", email, passwordHash: null },
    select: { id: true, email: true },
  });
  createdUserIds.push(user.id);
  return user;
}

const login = (email: string, password: string) => api("POST", "/api/auth/login", { body: { email, password } });

const GENERIC_FAILURE = { status: 401, body: { message: "Invalid email or password." } };

/** Records bcrypt.compare calls while still running the real comparison. */
function spyOnBcryptCompare() {
  const original = bcrypt.compare.bind(bcrypt);
  return mock.method(bcrypt, "compare", (data: string, hash: string) => original(data, hash));
}

const BCRYPT_COST_10 = /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/;

describe("password login with optional password credentials", () => {
  it("logs an existing password account in with the correct password", async () => {
    const user = await registerPasswordUser();

    const response = await login(user.email, TEST_PASSWORD);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.user, { id: user.id, firstName: "Pass", lastName: "Word", email: user.email });
    assert.equal(typeof response.body.token, "string");
  });

  it("returns one generic 401 for a wrong password, an unknown email and an account without a password", async () => {
    const passwordUser = await registerPasswordUser();
    const socialUser = await createSocialOnlyUser();

    const wrongPassword = await login(passwordUser.email, "WrongPassword123!");
    const unknownEmail = await login(uniqueEmail("nobody"), TEST_PASSWORD);
    const socialOnly = await login(socialUser.email, TEST_PASSWORD);

    for (const response of [wrongPassword, unknownEmail, socialOnly]) {
      assert.deepEqual({ status: response.status, body: response.body }, GENERIC_FAILURE);
    }
  });

  it("runs one bcrypt comparison against the dummy hash for an unknown email", async () => {
    const compare = spyOnBcryptCompare();

    const response = await login(uniqueEmail("nobody"), TEST_PASSWORD);

    assert.equal(response.status, 401);
    assert.equal(compare.mock.callCount(), 1);
    const [data, hash] = compare.mock.calls[0].arguments;
    assert.equal(data, TEST_PASSWORD);
    assert.match(hash, BCRYPT_COST_10, "a real bcrypt hash at the normal cost, so the work is comparable");
  });

  it("runs one bcrypt comparison for a social-only account and never passes null", async () => {
    const socialUser = await createSocialOnlyUser();
    const compare = spyOnBcryptCompare();

    const response = await login(socialUser.email, TEST_PASSWORD);

    assert.deepEqual({ status: response.status, body: response.body }, GENERIC_FAILURE);
    assert.equal(compare.mock.callCount(), 1);
    assert.match(compare.mock.calls[0].arguments[1], BCRYPT_COST_10);
  });

  it("never passes null to bcrypt.compare on any login path", async () => {
    const passwordUser = await registerPasswordUser();
    const socialUser = await createSocialOnlyUser();
    const compare = spyOnBcryptCompare();

    await login(passwordUser.email, TEST_PASSWORD);
    await login(passwordUser.email, "WrongPassword123!");
    await login(uniqueEmail("nobody"), TEST_PASSWORD);
    await login(socialUser.email, TEST_PASSWORD);

    assert.equal(compare.mock.callCount(), 4, "exactly one comparison per attempt");
    for (const call of compare.mock.calls) {
      assert.equal(typeof call.arguments[1], "string");
      assert.match(call.arguments[1], BCRYPT_COST_10);
    }
  });

  it("the dummy hash is shared, not generated per request", async () => {
    const compare = spyOnBcryptCompare();

    await login(uniqueEmail("nobody-1"), TEST_PASSWORD);
    await login(uniqueEmail("nobody-2"), TEST_PASSWORD);

    assert.equal(compare.mock.calls[0].arguments[1], compare.mock.calls[1].arguments[1]);
  });
});

describe("registration is unchanged", () => {
  it("creates a password-backed user", async () => {
    const user = await registerPasswordUser();

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    assert.match(stored.passwordHash ?? "", BCRYPT_COST_10);
    assert.notEqual(stored.passwordHash, TEST_PASSWORD);
  });

  it("still rejects a duplicate email with 409", async () => {
    const user = await registerPasswordUser();

    const duplicate = await api("POST", "/api/auth/register", {
      body: { firstName: "Again", lastName: "User", email: user.email, password: TEST_PASSWORD },
    });

    assert.equal(duplicate.status, 409);
    assert.deepEqual(duplicate.body, { message: "Email already registered." });
  });

  it("also rejects registering the email of a social-only account", async () => {
    const socialUser = await createSocialOnlyUser();

    const response = await api("POST", "/api/auth/register", {
      body: { firstName: "Taken", lastName: "Email", email: socialUser.email, password: TEST_PASSWORD },
    });

    assert.equal(response.status, 409);
  });
});

describe("FitAI session token", () => {
  it("keeps the payload { userId } with a one-hour expiry, signed HS256", async () => {
    const user = await registerPasswordUser();
    const { body } = await login(user.email, TEST_PASSWORD);

    const decoded = jwt.decode(body.token, { complete: true }) as jwt.Jwt & { payload: jwt.JwtPayload };
    assert.equal(decoded.header.alg, "HS256");
    assert.deepEqual(Object.keys(decoded.payload).sort(), ["exp", "iat", "userId"]);
    assert.equal(decoded.payload.userId, user.id);
    assert.equal(decoded.payload.exp! - decoded.payload.iat!, 3600);
  });

  it("issueSessionToken and verifySessionToken round-trip the same contract", () => {
    const token = issueSessionToken(42);

    assert.equal(verifySessionToken(token).userId, 42);
    const payload = jwt.decode(token) as jwt.JwtPayload;
    assert.equal(payload.exp! - payload.iat!, 3600);
  });

  it("protected routes accept a normal HS256 session token", async () => {
    const user = await registerPasswordUser();
    const { body } = await login(user.email, TEST_PASSWORD);

    const response = await api("GET", "/api/protected-test", { token: body.token });
    assert.equal(response.status, 200);

    const account = await api("GET", "/api/account", { token: body.token });
    assert.equal(account.status, 200);
    assert.equal(account.body.id, user.id, "the token still scopes requests to its own user");
  });

  it("rejects tokens signed with any other algorithm, even with the right secret", async () => {
    const user = await registerPasswordUser();
    const otherAlgorithm = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { algorithm: "HS512", expiresIn: "1h" });
    const unsigned = jwt.sign({ userId: user.id }, "", { algorithm: "none" } as jwt.SignOptions);

    for (const token of [otherAlgorithm, unsigned]) {
      const response = await api("GET", "/api/protected-test", { token });
      assert.equal(response.status, 401);
      assert.throws(() => verifySessionToken(token));
    }
  });

  it("rejects expired tokens", async () => {
    const expired = jwt.sign({ userId: 1, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET!, { algorithm: "HS256" });

    assert.equal((await api("GET", "/api/protected-test", { token: expired })).status, 401);
  });
});

describe("AuthIdentity constraints", () => {
  const subject = () => `sub-${randomUUID()}`;
  const isUniqueViolation = (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

  it("lets one user have both a Google and an Apple identity", async () => {
    const user = await createSocialOnlyUser();

    await prisma.authIdentity.create({ data: { userId: user.id, provider: "GOOGLE", providerSubject: subject(), email: user.email } });
    await prisma.authIdentity.create({
      data: { userId: user.id, provider: "APPLE", providerSubject: subject(), email: "abc123@privaterelay.appleid.com", isPrivateEmail: true },
    });

    const identities = await prisma.authIdentity.findMany({ where: { userId: user.id }, orderBy: { provider: "asc" } });
    assert.deepEqual(identities.map((identity) => identity.provider), ["GOOGLE", "APPLE"]);
    assert.equal(identities[1].isPrivateEmail, true);
    assert.equal(identities[0].isPrivateEmail, false, "defaults to false");
  });

  it("allows only one identity per provider for a user", async () => {
    const user = await createSocialOnlyUser();
    await prisma.authIdentity.create({ data: { userId: user.id, provider: "GOOGLE", providerSubject: subject() } });

    await assert.rejects(
      prisma.authIdentity.create({ data: { userId: user.id, provider: "GOOGLE", providerSubject: subject() } }),
      isUniqueViolation
    );
  });

  it("never lets one provider subject belong to two users", async () => {
    const first = await createSocialOnlyUser();
    const second = await createSocialOnlyUser();
    const shared = subject();
    await prisma.authIdentity.create({ data: { userId: first.id, provider: "APPLE", providerSubject: shared } });

    await assert.rejects(
      prisma.authIdentity.create({ data: { userId: second.id, provider: "APPLE", providerSubject: shared } }),
      isUniqueViolation
    );
    // The same subject string under a different provider is a different identity.
    await prisma.authIdentity.create({ data: { userId: second.id, provider: "GOOGLE", providerSubject: shared } });
  });

  it("deletes a user's identities with the user", async () => {
    const user = await createSocialOnlyUser();
    await prisma.authIdentity.create({ data: { userId: user.id, provider: "GOOGLE", providerSubject: subject() } });
    await prisma.authIdentity.create({ data: { userId: user.id, provider: "APPLE", providerSubject: subject() } });

    await prisma.user.delete({ where: { id: user.id } });

    assert.equal(await prisma.authIdentity.count({ where: { userId: user.id } }), 0);
  });
});
