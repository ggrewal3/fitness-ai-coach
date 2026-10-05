// Sign in with Apple backend (Phase 5A-4, ADR-028), fully offline: ID tokens
// are signed with locally generated keys and the verifier is pointed at them,
// so no test contacts Apple (or Google). Every signature and claim check runs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import jwt from "jsonwebtoken";
import { AUTH_RATE_LIMITS, resetAuthRateLimits } from "../src/modules/auth/auth.rateLimits.js";
import { verifySessionToken } from "../src/modules/auth/session.js";
import { setAppleKeyResolver, verifyAppleIdToken } from "../src/modules/auth/social/appleIdToken.js";
import { setGoogleKeyResolver } from "../src/modules/auth/social/googleIdToken.js";
import { signInNonces } from "../src/modules/auth/social/nonceStore.js";
import { SocialTokenError } from "../src/modules/auth/social/providerToken.js";
import { createApi, deleteTestUsers, prisma, startTestServer, TEST_PASSWORD, type Api, type TestServer } from "./helpers.js";

const APPLE_CLIENT_ID = "com.fitai.test.signin";
const GOOGLE_CLIENT_ID = "fitai-test-client.apps.googleusercontent.com";
const APPLE_ISSUER = "https://appleid.apple.com";
const RUN = randomUUID().slice(0, 8);

let server: TestServer;
let api: Api;
let appleKey: CryptoKey;
let googleKey: CryptoKey;
let otherKey: CryptoKey;
let applePublicJwk: JWK;
const createdUserIds: number[] = [];
const saved = { apple: process.env.APPLE_CLIENT_ID, google: process.env.GOOGLE_CLIENT_ID };

const realFetch = globalThis.fetch;
const outboundHosts: string[] = [];

before(async () => {
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      outboundHosts.push(host);
      return Promise.reject(new Error(`Blocked outbound request to ${host}`));
    }
    return realFetch(input, init);
  };

  const apple = await generateKeyPair("RS256");
  appleKey = apple.privateKey;
  applePublicJwk = { ...(await exportJWK(apple.publicKey)), kid: "apple-test", alg: "RS256", use: "sig" };
  setAppleKeyResolver(createLocalJWKSet({ keys: [applePublicJwk] }));

  const google = await generateKeyPair("RS256");
  googleKey = google.privateKey;
  setGoogleKeyResolver(createLocalJWKSet({ keys: [{ ...(await exportJWK(google.publicKey)), kid: "google-test", alg: "RS256" }] }));
  otherKey = (await generateKeyPair("RS256")).privateKey;

  server = await startTestServer();
  api = createApi(server.baseUrl);
});

beforeEach(() => {
  process.env.APPLE_CLIENT_ID = APPLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
});

after(async () => {
  setAppleKeyResolver(undefined);
  setGoogleKeyResolver(undefined);
  globalThis.fetch = realFetch;
  for (const [key, value] of [["APPLE_CLIENT_ID", saved.apple], ["GOOGLE_CLIENT_ID", saved.google]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await prisma.user.deleteMany({ where: { email: { contains: `-${RUN}-` } } });
  await deleteTestUsers(createdUserIds);
  await server.close();
  assert.deepEqual(outboundHosts, [], "no test contacted Apple, Google or any other host");
});

// ---------------------------------------------------------------------------
// Helpers

type Claims = Record<string, unknown>;
interface TokenOptions {
  key?: CryptoKey;
  kid?: string;
  issuer?: string;
  audience?: string;
  issuedAt?: number;
  expiresAt?: number;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const realEmail = (label: string) => `apple-${RUN}-${label}-${randomUUID().slice(0, 6)}@icloud-test.local`;
const relayEmail = (label: string) => `relay-${RUN}-${label}-${randomUUID().slice(0, 6)}@privaterelay.appleid.com`;
const subject = () => `001234.${randomUUID().replaceAll("-", "")}.0102`;

/** An Apple ID token; email_verified defaults to the string "true", as Apple often sends it. */
function appleToken(claims: Claims, options: TokenOptions = {}): Promise<string> {
  const issuedAt = options.issuedAt ?? nowSeconds();
  return new SignJWT({ email_verified: "true", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "apple-test" })
    .setIssuer(options.issuer ?? APPLE_ISSUER)
    .setAudience(options.audience ?? APPLE_CLIENT_ID)
    .setIssuedAt(issuedAt)
    .setExpirationTime(options.expiresAt ?? issuedAt + 600)
    .sign(options.key ?? appleKey);
}

async function nonceFor(provider: "APPLE" | "GOOGLE"): Promise<string> {
  const response = await api("POST", "/api/auth/nonce", { body: { provider } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.nonce as string;
}

function appleRequest(body: Record<string, unknown>) {
  return api("POST", "/api/auth/apple", { body });
}

/** Signs in an Apple identity end to end with a fresh Apple nonce. */
async function appleSignIn(claims: Claims, names: { firstName?: string; lastName?: string } = {}, options: TokenOptions = {}) {
  const nonce = await nonceFor("APPLE");
  const response = await appleRequest({ idToken: await appleToken({ nonce, ...claims }, options), nonce, ...names });
  if (response.status === 200) createdUserIds.push(response.body.user.id);
  return response;
}

const NOT_VERIFIED = { message: "We couldn't verify your Apple account. Please try again." };
const MISSING_EMAIL = { code: "MISSING_EMAIL", message: "Apple didn't share the email address FitAI needs to create your account." };

async function captureLogs<T>(work: () => Promise<T>) {
  const lines: unknown[][] = [];
  const original = { info: console.info, error: console.error, warn: console.warn, log: console.log };
  for (const level of ["info", "error", "warn", "log"] as const) console[level] = (...args: unknown[]) => lines.push(args);
  try {
    const result = await work();
    return { result, text: JSON.stringify(lines), entries: lines.flat().filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null) };
  } finally {
    Object.assign(console, original);
  }
}

// ---------------------------------------------------------------------------

describe("Apple nonces", () => {
  it("issues an APPLE nonce when configured, and keeps GOOGLE nonces working", async () => {
    const apple = await api("POST", "/api/auth/nonce", { body: { provider: "APPLE" } });
    assert.equal(apple.status, 201);
    assert.equal(apple.body.provider, "APPLE");
    assert.ok(apple.body.nonce.length >= 43);

    const google = await api("POST", "/api/auth/nonce", { body: { provider: "GOOGLE" } });
    assert.equal(google.status, 201);
    assert.equal(google.body.provider, "GOOGLE");
  });

  it("returns 503 for an APPLE nonce when Apple isn't configured (Google unaffected)", async () => {
    delete process.env.APPLE_CLIENT_ID;
    assert.deepEqual((await api("POST", "/api/auth/nonce", { body: { provider: "APPLE" } })).body, { message: "Apple sign-in is unavailable right now." });
    assert.equal((await api("POST", "/api/auth/nonce", { body: { provider: "GOOGLE" } })).status, 201);
  });

  it("never lets a nonce cross providers", async () => {
    const appleNonce = await nonceFor("APPLE");
    const google = await api("POST", "/api/auth/google", {
      body: {
        credential: await new SignJWT({ nonce: appleNonce, email: realEmail("x"), email_verified: true })
          .setProtectedHeader({ alg: "RS256", kid: "google-test" }).setIssuer("https://accounts.google.com").setAudience(GOOGLE_CLIENT_ID)
          .setSubject("g-sub").setIssuedAt().setExpirationTime("10m").sign(googleKey),
        nonce: appleNonce,
      },
    });
    assert.equal(google.status, 401, "an APPLE nonce can't be used for Google");

    const googleNonce = await nonceFor("GOOGLE");
    const apple = await appleRequest({ idToken: await appleToken({ sub: subject(), nonce: googleNonce, email: realEmail("y") }), nonce: googleNonce });
    assert.deepEqual(apple.body, NOT_VERIFIED, "a GOOGLE nonce can't be used for Apple");
  });

  it("is single-use, including under simultaneous requests", async () => {
    const nonce = await nonceFor("APPLE");
    const token = await appleToken({ sub: subject(), nonce, email: realEmail("once") });

    const responses = await Promise.all([1, 2, 3].map(() => appleRequest({ idToken: token, nonce })));
    const ok = responses.filter((response) => response.status === 200);
    assert.equal(ok.length, 1);
    createdUserIds.push(ok[0].body.user.id);
    assert.deepEqual((await appleRequest({ idToken: token, nonce })).body, NOT_VERIFIED, "replay rejected");
  });
});

describe("Apple ID token verification", () => {
  const verify = (token: string, expectedNonce = "n-1") => verifyAppleIdToken(token, { clientId: APPLE_CLIENT_ID, expectedNonce });
  const rejectsWith = async (token: Promise<string> | string, category: string, expectedNonce?: string) => {
    await assert.rejects(verify(await token, expectedNonce), (error: unknown) => error instanceof SocialTokenError && error.category === category);
  };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

  it("accepts a valid RS256 token and returns signed claims only", async () => {
    const identity = await verify(await appleToken({ sub: "000123.abc.0456", nonce: "n-1", email: "Me@iCloud.com", is_private_email: "false" }));
    assert.deepEqual(identity, { subject: "000123.abc.0456", email: "Me@iCloud.com", emailVerified: true, isPrivateEmail: false });
  });

  it("rejects a wrong signature, issuer, audience, expired or future-dated token", async () => {
    await rejectsWith(appleToken({ sub: "s", nonce: "n-1" }, { key: otherKey }), "invalid_token");
    await rejectsWith(appleToken({ sub: "s", nonce: "n-1" }, { issuer: "https://appleid.apple.com.evil.example" }), "invalid_token");
    await rejectsWith(appleToken({ sub: "s", nonce: "n-1" }, { issuer: "https://accounts.google.com" }), "invalid_token");
    await rejectsWith(appleToken({ sub: "s", nonce: "n-1" }, { audience: "com.someone.else" }), "wrong_audience");
    await rejectsWith(appleToken({ sub: "s", nonce: "n-1" }, { issuedAt: nowSeconds() - 7200, expiresAt: nowSeconds() - 120 }), "expired");
    await rejectsWith(appleToken({ sub: "s", nonce: "n-1" }, { issuedAt: nowSeconds() + 600 }), "invalid_token");
    await rejectsWith(appleToken({ sub: "s", nonce: "n-1", nbf: nowSeconds() + 600 }), "invalid_token");
  });

  it("requires RS256: rejects alg none and HS256 (algorithm confusion)", async () => {
    const claims = { iss: APPLE_ISSUER, aud: APPLE_CLIENT_ID, sub: "s", nonce: "n-1", iat: nowSeconds(), exp: nowSeconds() + 600 };
    await rejectsWith(`${encode({ alg: "none", kid: "apple-test" })}.${encode(claims)}.`, "invalid_token");
    await rejectsWith(jwt.sign(claims, String(applePublicJwk.n), { algorithm: "HS256", keyid: "apple-test" }), "invalid_token");
    // Any other RSA algorithm is refused too.
    const rs384 = (await generateKeyPair("RS384")).privateKey;
    await rejectsWith(new SignJWT(claims).setProtectedHeader({ alg: "RS384", kid: "apple-test" }).sign(rs384), "invalid_token");
  });

  it("rejects a missing, empty or non-string subject, malformed tokens, and a missing or mismatched nonce", async () => {
    await rejectsWith(appleToken({ nonce: "n-1" }), "invalid_token");
    await rejectsWith(appleToken({ sub: "", nonce: "n-1" }), "invalid_token");
    await rejectsWith(appleToken({ sub: "   ", nonce: "n-1" }), "invalid_token");
    await rejectsWith(appleToken({ sub: 12345, nonce: "n-1" }), "invalid_token");
    await rejectsWith(appleToken({ sub: "x".repeat(256), nonce: "n-1" }), "invalid_token");
    await rejectsWith("not.a.token", "invalid_token");
    await rejectsWith("", "invalid_token");
    await rejectsWith(appleToken({ sub: "s" }), "invalid_token");
    await rejectsWith(appleToken({ sub: "s", nonce: "n-1" }), "nonce_mismatch", "n-2");
  });

  it("normalizes email_verified and is_private_email: only boolean true or the string \"true\" count", async () => {
    for (const [value, expected] of [[true, true], ["true", true], [false, false], ["false", false], [undefined, false], [1, false], ["TRUE", false], [null, false]] as const) {
      const identity = await verify(await appleToken({ sub: "s", nonce: "n-1", email: "a@b.co", email_verified: value, is_private_email: value }));
      assert.equal(identity.emailVerified, expected, `email_verified ${String(value)}`);
      assert.equal(identity.isPrivateEmail, expected, `is_private_email ${String(value)}`);
    }
  });
});

describe("POST /api/auth/apple: new accounts", () => {
  it("creates a password-less account and APPLE identity, returning a normal FitAI session", async () => {
    const email = realEmail("new");
    const sub = subject();

    const response = await appleSignIn({ sub, email: email.toUpperCase() }, { firstName: "Tim", lastName: "Apple" });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(Object.keys(response.body).sort(), ["isNewUser", "token", "user"]);
    assert.equal(response.body.isNewUser, true);
    assert.deepEqual(response.body.user, { id: response.body.user.id, firstName: "Tim", lastName: "Apple", email });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: response.body.user.id }, include: { authIdentities: true } });
    assert.equal(user.passwordHash, null);
    assert.equal(user.email, email);
    assert.deepEqual(user.authIdentities.map(({ provider, providerSubject, email: identityEmail, isPrivateEmail }) => ({ provider, providerSubject, identityEmail, isPrivateEmail })), [
      { provider: "APPLE", providerSubject: sub, identityEmail: email, isPrivateEmail: false },
    ]);

    const decoded = jwt.decode(response.body.token, { complete: true }) as jwt.Jwt & { payload: jwt.JwtPayload };
    assert.equal(decoded.header.alg, "HS256");
    assert.deepEqual(Object.keys(decoded.payload).sort(), ["exp", "iat", "userId"]);
    assert.equal(decoded.payload.exp! - decoded.payload.iat!, 3600);
    assert.equal(verifySessionToken(response.body.token).userId, user.id);
    assert.equal((await api("GET", "/api/account", { token: response.body.token })).body.id, user.id);
  });

  it("stores a private-relay email as the account email, flagged as private", async () => {
    const email = relayEmail("relay");
    const response = await appleSignIn({ sub: subject(), email, is_private_email: true });

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, email);
    const identity = await prisma.authIdentity.findFirstOrThrow({ where: { userId: response.body.user.id } });
    assert.deepEqual({ email: identity.email, isPrivateEmail: identity.isPrivateEmail }, { email, isPrivateEmail: true });

    const stringFlag = await appleSignIn({ sub: subject(), email: relayEmail("relay2"), is_private_email: "true" });
    assert.equal((await prisma.authIdentity.findFirstOrThrow({ where: { userId: stringFlag.body.user.id } })).isPrivateEmail, true);
  });

  it("cleans names and falls back per part to FitAI / Member", async () => {
    const cases: [{ firstName?: string; lastName?: string }, [string, string]][] = [
      [{ firstName: "  Ana\u0000\u0007  María  ", lastName: "\tLópez\n" }, ["Ana María", "López"]],
      [{ lastName: "Only" }, ["FitAI", "Only"]],
      [{ firstName: "Only" }, ["Only", "Member"]],
      [{}, ["FitAI", "Member"]],
      [{ firstName: "   ", lastName: "\u0000" }, ["FitAI", "Member"]],
      [{ firstName: "B".repeat(120) }, ["B".repeat(50), "Member"]],
    ];

    for (const [names, expected] of cases) {
      const response = await appleSignIn({ sub: subject(), email: realEmail("name") }, names);
      assert.equal(response.status, 200, JSON.stringify(names));
      assert.deepEqual([response.body.user.firstName, response.body.user.lastName], expected, JSON.stringify(names));
    }
  });

  it("refuses an unknown identity without a usable email, inventing nothing", async () => {
    for (const claims of [{}, { email: "" }, { email: "not-an-email" }]) {
      const sub = subject();
      const response = await appleSignIn({ sub, ...claims }, { firstName: "No", lastName: "Email" });

      assert.equal(response.status, 401, JSON.stringify(claims));
      assert.deepEqual(response.body, MISSING_EMAIL);
      assert.ok(!JSON.stringify(response.body).includes(sub));
      assert.equal(await prisma.authIdentity.count({ where: { providerSubject: sub } }), 0);
    }
  });

  it("refuses an unknown identity whose email isn't verified", async () => {
    for (const flag of [false, "false", undefined]) {
      const sub = subject();
      const response = await appleSignIn({ sub, email: realEmail("unverified"), email_verified: flag });
      assert.equal(response.status, 401, String(flag));
      assert.deepEqual(response.body, { message: "Your Apple account's email isn't verified, so it can't be used to create a FitAI account." });
      assert.equal(await prisma.authIdentity.count({ where: { providerSubject: sub } }), 0);
    }
  });
});

describe("POST /api/auth/apple: returning accounts", () => {
  it("logs in by provider + subject without names or email; never renames or re-emails the account", async () => {
    const sub = subject();
    const original = realEmail("orig");
    const first = await appleSignIn({ sub, email: original }, { firstName: "First", lastName: "Seen" });
    const before = await prisma.authIdentity.findFirstOrThrow({ where: { providerSubject: sub } });

    const noEmailNoName = await appleSignIn({ sub });
    const newNames = await appleSignIn({ sub, email: original }, { firstName: "Changed", lastName: "Name" });

    for (const response of [noEmailNoName, newNames]) {
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.isNewUser, false);
      assert.equal(response.body.user.id, first.body.user.id);
      assert.deepEqual([response.body.user.firstName, response.body.user.lastName], ["First", "Seen"], "names never overwritten");
    }
    const after = await prisma.authIdentity.findFirstOrThrow({ where: { providerSubject: sub } });
    assert.ok(after.lastUsedAt > before.lastUsedAt);
    assert.equal(after.email, original, "no email in the token leaves the identity email as it was");
  });

  it("a changed verified email refreshes only the identity (and its relay flag), never User.email", async () => {
    const sub = subject();
    const original = realEmail("first");
    const first = await appleSignIn({ sub, email: original });
    const relay = relayEmail("later");

    const again = await appleSignIn({ sub, email: relay, is_private_email: "true" });
    assert.equal(again.body.user.email, original);
    const identity = await prisma.authIdentity.findFirstOrThrow({ where: { providerSubject: sub } });
    assert.deepEqual({ email: identity.email, isPrivateEmail: identity.isPrivateEmail }, { email: relay, isPrivateEmail: true });

    const unverified = await appleSignIn({ sub, email: realEmail("unverified-later"), email_verified: "false", is_private_email: false });
    assert.equal(unverified.status, 200, "an unverified email doesn't block a known identity");
    const unchanged = await prisma.authIdentity.findFirstOrThrow({ where: { providerSubject: sub } });
    assert.deepEqual({ email: unchanged.email, isPrivateEmail: unchanged.isPrivateEmail }, { email: relay, isPrivateEmail: true }, "unverified data is never stored");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: first.body.user.id } })).email, original);
  });

  it("never moves an identity to another account", async () => {
    const sub = subject();
    const first = await appleSignIn({ sub, email: realEmail("owner") });
    const attempt = await appleSignIn({ sub, email: realEmail("someone-else") });

    assert.equal(attempt.body.user.id, first.body.user.id);
    assert.equal(await prisma.authIdentity.count({ where: { providerSubject: sub } }), 1);
  });
});

describe("POST /api/auth/apple: conflicts and races", () => {
  it("returns EMAIL_IN_USE for a password account's email, creating and linking nothing", async () => {
    const email = realEmail("taken");
    const registered = await api("POST", "/api/auth/register", { body: { firstName: "Pat", lastName: "Word", email, password: TEST_PASSWORD } });
    createdUserIds.push(registered.body.id);
    const sub = subject();

    const response = await appleSignIn({ sub, email }, { firstName: "Mallory" });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      code: "EMAIL_IN_USE",
      message: "An account with this email already exists. Sign in the way you usually do, for example with your password.",
    });
    assert.equal(await prisma.authIdentity.count({ where: { providerSubject: sub } }), 0);
    assert.equal(await prisma.authIdentity.count({ where: { userId: registered.body.id } }), 0, "nothing linked");
    assert.equal(await prisma.user.count({ where: { email } }), 1, "no duplicate user");
    const passwordLogin = await api("POST", "/api/auth/login", { body: { email, password: TEST_PASSWORD } });
    assert.equal(passwordLogin.status, 200);
    assert.equal(passwordLogin.body.user.firstName, "Pat", "the existing account is untouched");
  });

  it("never auto-links to an account created with Google", async () => {
    const email = realEmail("google-owner");
    const googleNonce = await nonceFor("GOOGLE");
    const googleCredential = await new SignJWT({ nonce: googleNonce, email, email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "google-test" }).setIssuer("https://accounts.google.com").setAudience(GOOGLE_CLIENT_ID)
      .setSubject(`g-${RUN}`).setIssuedAt().setExpirationTime("10m").sign(googleKey);
    const google = await api("POST", "/api/auth/google", { body: { credential: googleCredential, nonce: googleNonce } });
    assert.equal(google.status, 200);
    createdUserIds.push(google.body.user.id);

    const apple = await appleSignIn({ sub: subject(), email });

    assert.equal(apple.status, 409);
    assert.equal(apple.body.code, "EMAIL_IN_USE");
    const identities = await prisma.authIdentity.findMany({ where: { userId: google.body.user.id } });
    assert.deepEqual(identities.map((identity) => identity.provider), ["GOOGLE"], "no APPLE identity attached");
  });

  it("creates exactly one account when the first Apple sign-in arrives twice at once", async () => {
    const sub = subject();
    const email = realEmail("race");
    const [nonceA, nonceB] = [await nonceFor("APPLE"), await nonceFor("APPLE")];
    const [tokenA, tokenB] = [await appleToken({ sub, email, nonce: nonceA }), await appleToken({ sub, email, nonce: nonceB })];

    const responses = await Promise.all([appleRequest({ idToken: tokenA, nonce: nonceA }), appleRequest({ idToken: tokenB, nonce: nonceB })]);

    for (const response of responses) {
      assert.equal(response.status, 200, JSON.stringify(response.body));
      createdUserIds.push(response.body.user.id);
    }
    assert.equal(responses[0].body.user.id, responses[1].body.user.id);
    assert.equal(responses.filter((response) => response.body.isNewUser).length, 1);
    assert.equal(await prisma.authIdentity.count({ where: { providerSubject: sub } }), 1);
    assert.equal(await prisma.user.count({ where: { email } }), 1);
  });

  it("keeps provider + subject unique at the database level", async () => {
    const sub = subject();
    await appleSignIn({ sub, email: realEmail("unique") });
    const other = await prisma.user.create({ data: { firstName: "O", lastName: "T", email: realEmail("other"), passwordHash: null } });
    createdUserIds.push(other.id);

    await assert.rejects(prisma.authIdentity.create({ data: { userId: other.id, provider: "APPLE", providerSubject: sub } }));
  });
});

describe("POST /api/auth/apple: request and configuration", () => {
  it("validates the body strictly and never accepts identity fields from the client", async () => {
    const nonce = "x";
    for (const body of [
      {},
      { idToken: "t" },
      { nonce },
      { idToken: "t", nonce, email: "a@b.co" },
      { idToken: "t", nonce, sub: "s" },
      { idToken: "t", nonce, isPrivateEmail: true },
      { idToken: "t", nonce, code: "authorization-code" },
      { idToken: "t", nonce, firstName: "N".repeat(201) },
      { idToken: "t", nonce, firstName: 5 },
      { idToken: "t".repeat(9000), nonce },
    ]) {
      assert.equal((await appleRequest(body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
  });

  it("returns the same generic 401 for every token failure, with no provider details", async () => {
    const tokens = [
      await appleToken({ sub: subject(), email: realEmail("a") }, { key: otherKey }),
      await appleToken({ sub: subject(), email: realEmail("b") }, { audience: "wrong" }),
      await appleToken({ sub: subject(), email: realEmail("c") }, { issuedAt: nowSeconds() - 7200, expiresAt: nowSeconds() - 120 }),
      "garbage",
    ];
    for (const idToken of tokens) {
      const response = await appleRequest({ idToken, nonce: await nonceFor("APPLE") });
      assert.deepEqual({ status: response.status, body: response.body }, { status: 401, body: NOT_VERIFIED });
    }
  });

  it("is unavailable without APPLE_CLIENT_ID, while password and Google sign-in keep working", async () => {
    const appleNonce = signInNonces.issue("APPLE").nonce;
    delete process.env.APPLE_CLIENT_ID;

    const response = await appleRequest({ idToken: await appleToken({ sub: subject(), nonce: appleNonce }), nonce: appleNonce });
    assert.deepEqual({ status: response.status, body: response.body }, { status: 503, body: { message: "Apple sign-in is unavailable right now." } });

    const email = realEmail("pw");
    const registered = await api("POST", "/api/auth/register", { body: { firstName: "P", lastName: "W", email, password: TEST_PASSWORD } });
    createdUserIds.push(registered.body.id);
    assert.equal((await api("POST", "/api/auth/login", { body: { email, password: TEST_PASSWORD } })).status, 200);

    const googleNonce = await nonceFor("GOOGLE");
    const googleCredential = await new SignJWT({ nonce: googleNonce, email: realEmail("g"), email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "google-test" }).setIssuer("https://accounts.google.com").setAudience(GOOGLE_CLIENT_ID)
      .setSubject(`g2-${RUN}`).setIssuedAt().setExpirationTime("10m").sign(googleKey);
    const google = await api("POST", "/api/auth/google", { body: { credential: googleCredential, nonce: googleNonce } });
    assert.equal(google.status, 200);
    createdUserIds.push(google.body.user.id);
  });
});

describe("Apple sign-in logging", () => {
  it("logs outcome categories only, never the token, nonce, subject, emails or names", async () => {
    const sub = subject();
    const email = relayEmail("logs");
    const taken = realEmail("logs-taken");
    const registered = await api("POST", "/api/auth/register", { body: { firstName: "T", lastName: "K", email: taken, password: TEST_PASSWORD } });
    createdUserIds.push(registered.body.id);
    const secrets: string[] = [sub, email, taken, "Zelda", "Hyrule"];

    const { text, entries } = await captureLogs(async () => {
      await appleSignIn({ sub, email, is_private_email: true }, { firstName: "Zelda", lastName: "Hyrule" });
      await appleSignIn({ sub });
      await appleSignIn({ sub: subject(), email: taken });
      await appleSignIn({ sub: subject() });
      await appleSignIn({ sub: subject(), email: realEmail("u"), email_verified: "false" });
      const nonce = await nonceFor("APPLE");
      const bad = await appleToken({ sub: subject(), nonce }, { audience: "wrong" });
      secrets.push(nonce, bad);
      await appleRequest({ idToken: bad, nonce });
      await appleRequest({ idToken: bad, nonce });
    });

    for (const secret of secrets) assert.ok(!text.includes(secret), `log contains ${secret.slice(0, 12)}…`);
    assert.ok(!/eyJ|privaterelay/.test(text), "no JWT-looking strings or relay addresses");
    const social = entries.filter((entry) => entry.event === "auth.social");
    assert.deepEqual(social.map((entry) => entry.outcome), ["created", "login", "email_conflict", "missing_email", "unverified_email", "wrong_audience", "nonce_invalid"]);
    for (const entry of social) {
      assert.deepEqual(Object.keys(entry).filter((key) => !["event", "provider", "outcome", "latencyMs", "userId"].includes(key)), []);
      assert.equal(entry.provider, "APPLE");
      assert.equal("userId" in entry, entry.outcome === "created" || entry.outcome === "login");
    }
  });
});

describe("Apple rate limiting", () => {
  afterEach(() => resetAuthRateLimits());

  it("limits Apple sign-in per IP in its own bucket, leaving other endpoints alone", async () => {
    resetAuthRateLimits();
    const limited = createApi(server.baseUrl, { enforceAuthRateLimits: true });

    for (let request = 0; request < AUTH_RATE_LIMITS.social[0].max; request += 1) {
      assert.notEqual((await limited("POST", "/api/auth/apple", { body: { idToken: "x", nonce: "y" } })).status, 429);
    }
    const blocked = await fetch(`${server.baseUrl}/api/auth/apple`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: "x", nonce: "y" }) });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);

    assert.equal((await limited("GET", "/api/health")).status, 200);
    assert.notEqual((await limited("POST", "/api/auth/google", { body: { credential: "x", nonce: "y" } })).status, 429, "Google has its own bucket");
    assert.equal((await limited("POST", "/api/auth/nonce", { body: { provider: "APPLE" } })).status, 201);
  });
});
