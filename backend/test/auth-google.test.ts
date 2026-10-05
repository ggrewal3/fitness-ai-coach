// Google sign-in backend (Phase 5A-2, ADR-028), fully offline: tokens are
// signed with locally generated keys and the verifier is pointed at them, so
// no test ever contacts Google. Every signature and claim check still runs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import jwt from "jsonwebtoken";
import { createIpRateLimiter } from "../src/middleware/userRateLimit.middleware.js";
import { AUTH_RATE_LIMITS, resetAuthRateLimits } from "../src/modules/auth/auth.rateLimits.js";
import { verifySessionToken } from "../src/modules/auth/session.js";
import { setGoogleKeyResolver, SocialTokenError, verifyGoogleIdToken } from "../src/modules/auth/social/googleIdToken.js";
import { createNonceStore, signInNonces } from "../src/modules/auth/social/nonceStore.js";
import { FALLBACK_NAME, usableName } from "../src/modules/auth/social/socialSignIn.service.js";
import { createApi, deleteTestUsers, prisma, startTestServer, TEST_PASSWORD, type Api, type TestServer } from "./helpers.js";

const CLIENT_ID = "fitai-test-client.apps.googleusercontent.com";
const GOOGLE_ISSUER = "https://accounts.google.com";
const RUN = randomUUID().slice(0, 8);

let server: TestServer;
let api: Api;
let signingKey: CryptoKey;
let otherKey: CryptoKey;
let publicJwk: JWK;
const createdUserIds: number[] = [];
const savedClientId = process.env.GOOGLE_CLIENT_ID;

// Any request leaving for a non-local host fails the suite.
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

  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  otherKey = (await generateKeyPair("RS256")).privateKey;
  setGoogleKeyResolver(createLocalJWKSet({ keys: [publicJwk] }));

  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  server = await startTestServer();
  api = createApi(server.baseUrl);
});

after(async () => {
  setGoogleKeyResolver(undefined);
  globalThis.fetch = realFetch;
  if (savedClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = savedClientId;
  await prisma.user.deleteMany({ where: { email: { contains: `-${RUN}-` } } });
  await deleteTestUsers(createdUserIds);
  await server.close();
  assert.deepEqual(outboundHosts, [], "no test contacted Google or any other host");
});

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
});

// ---------------------------------------------------------------------------
// Token and request helpers

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
const email = (label: string) => `google-${RUN}-${label}-${randomUUID().slice(0, 6)}@gmail-test.local`;
const subject = () => `google-sub-${randomUUID()}`;

function googleToken(claims: Claims, options: TokenOptions = {}): Promise<string> {
  const issuedAt = options.issuedAt ?? nowSeconds();
  return new SignJWT({ email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "test-key" })
    .setIssuer(options.issuer ?? GOOGLE_ISSUER)
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuedAt(issuedAt)
    .setExpirationTime(options.expiresAt ?? issuedAt + 3600)
    .sign(options.key ?? signingKey);
}

async function issueNonce(provider = "GOOGLE") {
  const response = await api("POST", "/api/auth/nonce", { body: { provider } });
  return response;
}

async function freshNonce(): Promise<string> {
  const response = await issueNonce();
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.nonce as string;
}

function signIn(credential: string, nonce: string) {
  return api("POST", "/api/auth/google", { body: { credential, nonce } });
}

/** Signs in a Google identity end to end with a fresh nonce. */
async function googleSignIn(claims: Claims, options: TokenOptions = {}) {
  const nonce = await freshNonce();
  const response = await signIn(await googleToken({ nonce, ...claims }, options), nonce);
  if (response.status === 200) createdUserIds.push(response.body.user.id);
  return response;
}

const NOT_VERIFIED = { message: "We couldn't verify your Google account. Please try again." };

async function captureLogs<T>(work: () => Promise<T>): Promise<{ result: T; text: string; entries: Record<string, unknown>[] }> {
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

describe("sign-in nonce store", () => {
  const store = (time: { now: number }, maxEntries = 100) => createNonceStore({ ttlMs: 600_000, maxEntries, now: () => time.now });

  it("issues random, provider-bound nonces that are consumed exactly once", () => {
    const time = { now: 0 };
    const nonces = store(time);
    const first = nonces.issue("GOOGLE");
    const second = nonces.issue("GOOGLE");

    assert.notEqual(first.nonce, second.nonce);
    assert.ok(first.nonce.length >= 43, "32 random bytes, base64url");
    assert.equal(first.expiresAt.getTime(), 600_000);
    assert.deepEqual(nonces.consume(first.nonce, "GOOGLE"), { ok: true });
    assert.deepEqual(nonces.consume(first.nonce, "GOOGLE"), { ok: false, reason: "unknown" }, "replay rejected");
  });

  it("rejects unknown and expired nonces", () => {
    const time = { now: 0 };
    const nonces = store(time);
    const { nonce } = nonces.issue("GOOGLE");

    assert.deepEqual(nonces.consume("never-issued", "GOOGLE"), { ok: false, reason: "unknown" });
    time.now = 600_000;
    assert.deepEqual(nonces.consume(nonce, "GOOGLE"), { ok: false, reason: "expired" });
  });

  it("rejects a nonce issued for another provider, and it can't be retried", () => {
    const nonces = store({ now: 0 });
    const { nonce } = nonces.issue("APPLE");

    assert.deepEqual(nonces.consume(nonce, "GOOGLE"), { ok: false, reason: "wrong_provider" });
    assert.deepEqual(nonces.consume(nonce, "APPLE"), { ok: false, reason: "unknown" });
  });

  it("lets only one of several simultaneous consumers succeed", async () => {
    const nonces = store({ now: 0 });
    const { nonce } = nonces.issue("GOOGLE");

    const results = await Promise.all(Array.from({ length: 5 }, async () => nonces.consume(nonce, "GOOGLE")));
    assert.equal(results.filter((result) => result.ok).length, 1);
  });

  it("stays bounded: expired entries are dropped first, then the oldest are evicted", () => {
    const time = { now: 0 };
    const nonces = store(time, 3);
    const oldest = nonces.issue("GOOGLE");
    nonces.issue("GOOGLE");
    nonces.issue("GOOGLE");
    const newest = nonces.issue("GOOGLE");

    assert.equal(nonces.size(), 3);
    assert.equal(nonces.consume(oldest.nonce, "GOOGLE").ok, false, "evicted");
    assert.equal(nonces.consume(newest.nonce, "GOOGLE").ok, true);
  });

  it("cleans up expired entries", () => {
    const time = { now: 0 };
    const nonces = store(time);
    nonces.issue("GOOGLE");
    nonces.issue("GOOGLE");
    time.now = 600_001;
    nonces.sweep();

    assert.equal(nonces.size(), 0);
  });
});

describe("POST /api/auth/nonce", () => {
  it("issues a Google nonce", async () => {
    const response = await issueNonce();

    assert.equal(response.status, 201);
    assert.equal(response.body.provider, "GOOGLE");
    assert.equal(typeof response.body.nonce, "string");
    const ttl = new Date(response.body.expiresAt).getTime() - Date.now();
    assert.ok(ttl > 9 * 60_000 && ttl <= 10 * 60_000, `${ttl}`);
  });

  it("validates the provider", async () => {
    // APPLE is a valid provider since Phase 5A-4 (covered in auth-apple.test.ts).
    for (const body of [{}, { provider: "FACEBOOK" }, { provider: "google" }, { provider: "GOOGLE", extra: 1 }]) {
      assert.equal((await api("POST", "/api/auth/nonce", { body })).status, 400, JSON.stringify(body));
    }
  });

  it("is unavailable when Google isn't configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    assert.deepEqual((await issueNonce()).status, 503);
  });
});

describe("Google ID token verification", () => {
  const verify = (credential: string, expectedNonce = "n-1") => verifyGoogleIdToken(credential, { clientId: CLIENT_ID, expectedNonce });
  const rejectsWith = async (credential: Promise<string> | string, category: string, expectedNonce?: string) => {
    await assert.rejects(verify(await credential, expectedNonce), (error: unknown) => error instanceof SocialTokenError && error.category === category);
  };

  it("accepts a valid RS256 token from either Google issuer and returns signed claims only", async () => {
    for (const issuer of ["https://accounts.google.com", "accounts.google.com"]) {
      const identity = await verify(await googleToken({ sub: "abc", nonce: "n-1", email: "A@Example.com", given_name: "Ada", family_name: "Lovelace" }, { issuer }));
      assert.deepEqual(identity, { subject: "abc", email: "A@Example.com", emailVerified: true, givenName: "Ada", familyName: "Lovelace" });
    }
  });

  it("rejects a wrong signature, audience, issuer or expired token", async () => {
    await rejectsWith(googleToken({ sub: "abc", nonce: "n-1" }, { key: otherKey }), "invalid_token");
    await rejectsWith(googleToken({ sub: "abc", nonce: "n-1" }, { audience: "someone-else.apps.googleusercontent.com" }), "wrong_audience");
    await rejectsWith(googleToken({ sub: "abc", nonce: "n-1" }, { issuer: "https://evil.example.com" }), "invalid_token");
    await rejectsWith(googleToken({ sub: "abc", nonce: "n-1" }, { issuedAt: nowSeconds() - 7200, expiresAt: nowSeconds() - 120 }), "expired");
  });

  it("rejects tokens issued in the future or not yet valid", async () => {
    await rejectsWith(googleToken({ sub: "abc", nonce: "n-1" }, { issuedAt: nowSeconds() + 600 }), "invalid_token");
    await rejectsWith(googleToken({ sub: "abc", nonce: "n-1", nbf: nowSeconds() + 600 }), "invalid_token");
  });

  it("rejects unsigned and HS256 tokens", async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const claims = { iss: GOOGLE_ISSUER, aud: CLIENT_ID, sub: "abc", nonce: "n-1", iat: nowSeconds(), exp: nowSeconds() + 3600 };
    const unsigned = `${encode({ alg: "none", kid: "test-key" })}.${encode(claims)}.`;
    // HS256 "signed" with the public key's modulus: the classic algorithm-confusion attempt.
    const hs256 = jwt.sign(claims, String(publicJwk.n), { algorithm: "HS256", keyid: "test-key" });

    await rejectsWith(unsigned, "invalid_token");
    await rejectsWith(hs256, "invalid_token");
  });

  it("rejects a nonce mismatch, a missing subject and malformed claims", async () => {
    await rejectsWith(googleToken({ sub: "abc", nonce: "n-1" }), "nonce_mismatch", "n-2");
    await rejectsWith(googleToken({ nonce: "n-1" }), "invalid_token");
    await rejectsWith(googleToken({ sub: "", nonce: "n-1" }), "invalid_token");
    await rejectsWith(googleToken({ sub: "abc" }), "invalid_token");
    await rejectsWith(googleToken({ sub: { nested: true }, nonce: "n-1" }), "invalid_token");
    await rejectsWith("not.a.jwt", "invalid_token");
  });

  it("treats anything but a boolean true email_verified as unverified", async () => {
    for (const value of ["true", 1, null, false]) {
      const identity = await verify(await googleToken({ sub: "abc", nonce: "n-1", email: "a@example.com", email_verified: value }));
      assert.equal(identity.emailVerified, false, String(value));
    }
  });
});

describe("POST /api/auth/google", () => {
  it("creates one password-less account and identity on first sign-in and returns a normal FitAI session", async () => {
    const address = email("first");
    const sub = subject();

    const response = await googleSignIn({ sub, email: address.toUpperCase(), given_name: "Grace", family_name: "Hopper" });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.isNewUser, true);
    assert.deepEqual(Object.keys(response.body).sort(), ["isNewUser", "token", "user"]);
    assert.deepEqual(response.body.user, { id: response.body.user.id, firstName: "Grace", lastName: "Hopper", email: address });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: response.body.user.id }, include: { authIdentities: true } });
    assert.equal(user.passwordHash, null);
    assert.equal(user.email, address, "normalized like registration");
    assert.equal(user.authIdentities.length, 1);
    assert.deepEqual(
      { provider: user.authIdentities[0].provider, providerSubject: user.authIdentities[0].providerSubject, email: user.authIdentities[0].email, isPrivateEmail: user.authIdentities[0].isPrivateEmail },
      { provider: "GOOGLE", providerSubject: sub, email: address, isPrivateEmail: false }
    );

    // The same session as password login: HS256 { userId }, 1 hour, accepted by protected routes.
    const decoded = jwt.decode(response.body.token, { complete: true }) as jwt.Jwt & { payload: jwt.JwtPayload };
    assert.equal(decoded.header.alg, "HS256");
    assert.deepEqual(Object.keys(decoded.payload).sort(), ["exp", "iat", "userId"]);
    assert.equal(decoded.payload.exp! - decoded.payload.iat!, 3600);
    assert.equal(verifySessionToken(response.body.token).userId, user.id);
    const account = await api("GET", "/api/account", { token: response.body.token });
    assert.equal(account.status, 200);
    assert.equal(account.body.id, user.id);
  });

  it("recognises a returning user by provider + subject, even when the Google email changed or is absent", async () => {
    const sub = subject();
    const original = email("orig");
    const first = await googleSignIn({ sub, email: original, given_name: "Ada", family_name: "L" });
    const before = await prisma.authIdentity.findFirstOrThrow({ where: { providerSubject: sub } });

    const changed = email("changed");
    const second = await googleSignIn({ sub, email: changed });
    const third = await googleSignIn({ sub });

    for (const response of [second, third]) {
      assert.equal(response.status, 200);
      assert.equal(response.body.isNewUser, false);
      assert.equal(response.body.user.id, first.body.user.id);
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: first.body.user.id }, include: { authIdentities: true } });
    assert.equal(user.email, original, "User.email is never changed by the provider");
    assert.equal(user.authIdentities.length, 1);
    assert.equal(user.authIdentities[0].email, changed, "the identity keeps the last verified provider email");
    assert.ok(user.authIdentities[0].lastUsedAt > before.lastUsedAt, "lastUsedAt updated");
  });

  it("logs a returning user in even when the current token's email is unverified (identity is by subject)", async () => {
    const sub = subject();
    const address = email("known");
    const first = await googleSignIn({ sub, email: address });

    const again = await googleSignIn({ sub, email: email("unverified"), email_verified: false });

    assert.equal(again.status, 200);
    assert.equal(again.body.user.id, first.body.user.id);
    const identity = await prisma.authIdentity.findFirstOrThrow({ where: { providerSubject: sub } });
    assert.equal(identity.email, address, "an unverified email is never stored");
  });

  it("refuses to create an account from an unverified or missing email", async () => {
    for (const claims of [{ email: email("unverified"), email_verified: false }, { email: email("noflag"), email_verified: undefined }, {}]) {
      const sub = subject();
      const response = await googleSignIn({ sub, ...claims });

      assert.equal(response.status, 401, JSON.stringify(claims));
      assert.match(response.body.message, /isn't verified/);
      assert.equal(await prisma.authIdentity.count({ where: { providerSubject: sub } }), 0);
    }
  });

  it("returns 409 EMAIL_IN_USE for an existing account's email, creating and linking nothing", async () => {
    const address = email("taken");
    const registered = await api("POST", "/api/auth/register", { body: { firstName: "Pat", lastName: "Word", email: address, password: TEST_PASSWORD } });
    assert.equal(registered.status, 201);
    createdUserIds.push(registered.body.id);
    const sub = subject();

    const response = await googleSignIn({ sub, email: address.toUpperCase() });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      code: "EMAIL_IN_USE",
      message: "An account with this email already exists. Sign in the way you usually do, for example with your password.",
    });
    assert.equal(await prisma.authIdentity.count({ where: { providerSubject: sub } }), 0, "no identity");
    assert.equal(await prisma.authIdentity.count({ where: { userId: registered.body.id } }), 0, "nothing linked to the existing account");
    assert.equal(await prisma.user.count({ where: { email: address } }), 1, "no duplicate user");
    const passwordLogin = await api("POST", "/api/auth/login", { body: { email: address, password: TEST_PASSWORD } });
    assert.equal(passwordLogin.status, 200, "the existing account is untouched");
  });

  it("creates exactly one account when the first sign-in arrives twice at once", async () => {
    const sub = subject();
    const address = email("race");
    const [nonceA, nonceB] = [await freshNonce(), await freshNonce()];
    const [tokenA, tokenB] = [await googleToken({ sub, email: address, nonce: nonceA }), await googleToken({ sub, email: address, nonce: nonceB })];

    const responses = await Promise.all([signIn(tokenA, nonceA), signIn(tokenB, nonceB)]);

    for (const response of responses) {
      assert.equal(response.status, 200, JSON.stringify(response.body));
      createdUserIds.push(response.body.user.id);
    }
    assert.equal(responses[0].body.user.id, responses[1].body.user.id);
    assert.equal(responses.filter((response) => response.body.isNewUser).length, 1);
    assert.equal(await prisma.authIdentity.count({ where: { providerSubject: sub } }), 1);
    assert.equal(await prisma.user.count({ where: { email: address } }), 1);
  });

  it("never moves an identity: provider + subject stays bound to its first account", async () => {
    const sub = subject();
    const first = await googleSignIn({ sub, email: email("owner") });
    const attempt = await googleSignIn({ sub, email: email("other") });

    assert.equal(attempt.body.user.id, first.body.user.id);
    assert.equal(await prisma.authIdentity.count({ where: { providerSubject: sub } }), 1);
  });

  it("uses Google's names when usable and the documented fallback otherwise", async () => {
    const blank = await googleSignIn({ sub: subject(), email: email("noname"), given_name: "   ", family_name: "\u0000\u0007" });
    assert.deepEqual([blank.body.user.firstName, blank.body.user.lastName], [FALLBACK_NAME.firstName, FALLBACK_NAME.lastName]);

    const long = await googleSignIn({ sub: subject(), email: email("longname"), given_name: "A".repeat(80), family_name: " Mary\tJane " });
    assert.equal(long.body.user.firstName, "A".repeat(50));
    assert.equal(long.body.user.lastName, "Mary Jane");

    assert.equal(usableName("😀".repeat(60))?.length, 100, "50 emoji: code points, never a split pair");
  });

  it("rejects replayed, unknown, cross-provider and mismatched nonces", async () => {
    const nonce = await freshNonce();
    const token = await googleToken({ sub: subject(), email: email("replay"), nonce });
    const ok = await signIn(token, nonce);
    assert.equal(ok.status, 200);
    createdUserIds.push(ok.body.user.id);

    assert.deepEqual((await signIn(token, nonce)).body, NOT_VERIFIED, "replay");
    assert.equal((await signIn(token, "never-issued")).status, 401, "unknown");

    const apple = signInNonces.issue("APPLE").nonce;
    assert.equal((await signIn(await googleToken({ sub: subject(), email: email("x"), nonce: apple }), apple)).status, 401, "issued for Apple");

    const issued = await freshNonce();
    assert.equal((await signIn(await googleToken({ sub: subject(), email: email("y"), nonce: "other" }), issued)).status, 401, "token carries another nonce");
  });

  it("consumes a nonce once even under simultaneous requests", async () => {
    const nonce = await freshNonce();
    const token = await googleToken({ sub: subject(), email: email("dup"), nonce });

    const responses = await Promise.all([signIn(token, nonce), signIn(token, nonce), signIn(token, nonce)]);

    const ok = responses.filter((response) => response.status === 200);
    assert.equal(ok.length, 1);
    createdUserIds.push(ok[0].body.user.id);
  });

  it("returns the same generic 401 for every token failure, without provider details", async () => {
    const failures = [
      await googleToken({ sub: subject(), email: email("a") }, { key: otherKey }),
      await googleToken({ sub: subject(), email: email("b") }, { audience: "wrong" }),
      await googleToken({ sub: subject(), email: email("c") }, { issuer: "https://evil.example.com" }),
      await googleToken({ sub: subject(), email: email("d") }, { issuedAt: nowSeconds() - 7200, expiresAt: nowSeconds() - 120 }),
      "garbage",
    ];

    for (const credential of failures) {
      const nonce = await freshNonce();
      const response = await signIn(credential, nonce);
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, NOT_VERIFIED);
      assert.ok(!/jose|jwt|claim|aud|signature|JWK/i.test(JSON.stringify(response.body)));
    }
  });

  it("validates the request body strictly", async () => {
    for (const body of [{}, { credential: "x" }, { nonce: "x" }, { credential: "x", nonce: "y", email: "a@b.c" }, { credential: "x".repeat(9000), nonce: "y" }]) {
      assert.equal((await api("POST", "/api/auth/google", { body })).status, 400);
    }
  });

  it("is unavailable (503) without GOOGLE_CLIENT_ID, while password login keeps working", async () => {
    const nonce = await freshNonce();
    delete process.env.GOOGLE_CLIENT_ID;

    const response = await signIn(await googleToken({ sub: subject(), nonce }), nonce);
    assert.deepEqual({ status: response.status, body: response.body }, { status: 503, body: { message: "Google sign-in is unavailable right now." } });

    const address = email("pw");
    const registered = await api("POST", "/api/auth/register", { body: { firstName: "P", lastName: "W", email: address, password: TEST_PASSWORD } });
    createdUserIds.push(registered.body.id);
    assert.equal((await api("POST", "/api/auth/login", { body: { email: address, password: TEST_PASSWORD } })).status, 200);
  });

  it("answers malformed JSON with a plain 400 and logs nothing from the body", async () => {
    const { result, text } = await captureLogs(() =>
      fetch(`${server.baseUrl}/api/auth/google`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "SECRET-CREDENTIAL-FRAGMENT" })
    );

    assert.equal(result.status, 400);
    assert.deepEqual(await result.json(), { message: "Request body must be valid JSON." });
    assert.ok(!text.includes("SECRET"));
  });
});

describe("social sign-in logging", () => {
  it("logs outcome categories only: never the token, nonce, subject, email or names", async () => {
    const sub = subject();
    const address = email("logs");
    const taken = email("logs-taken");
    const registered = await api("POST", "/api/auth/register", { body: { firstName: "T", lastName: "K", email: taken, password: TEST_PASSWORD } });
    createdUserIds.push(registered.body.id);
    const secrets: string[] = [sub, address, taken, "Zelda", "Hyrule"];

    const { text, entries } = await captureLogs(async () => {
      const created = await googleSignIn({ sub, email: address, given_name: "Zelda", family_name: "Hyrule" });
      await googleSignIn({ sub, email: address });
      await googleSignIn({ sub: subject(), email: taken });
      await googleSignIn({ sub: subject(), email: email("u"), email_verified: false });
      const nonce = await freshNonce();
      const badToken = await googleToken({ sub: subject(), nonce }, { audience: "wrong" });
      secrets.push(nonce, badToken);
      await signIn(badToken, nonce);
      await signIn(badToken, nonce);
      return created;
    });

    for (const secret of secrets) assert.ok(!text.includes(secret), `log contains ${secret.slice(0, 12)}…`);
    assert.ok(!/eyJ/.test(text), "no JWT-looking strings");
    const social = entries.filter((entry) => entry.event === "auth.social");
    assert.deepEqual(social.map((entry) => entry.outcome), ["created", "login", "email_conflict", "unverified_email", "wrong_audience", "nonce_invalid"]);
    for (const entry of social) {
      assert.deepEqual(Object.keys(entry).filter((key) => !["event", "provider", "outcome", "latencyMs", "userId"].includes(key)), []);
      assert.equal(entry.provider, "GOOGLE");
      assert.equal("userId" in entry, entry.outcome === "created" || entry.outcome === "login");
    }
  });
});

describe("auth rate limiting (per IP)", () => {
  let limitedApi: Api;

  beforeEach(() => {
    resetAuthRateLimits();
    limitedApi = createApi(server.baseUrl, { enforceAuthRateLimits: true });
  });

  afterEach(() => resetAuthRateLimits());

  async function exhaust(path: string, body: unknown, perMinute: number) {
    for (let request = 0; request < perMinute; request += 1) {
      const response = await limitedApi("POST", path, { body });
      assert.notEqual(response.status, 429, `request ${request + 1} of ${perMinute} was limited`);
    }
    const limited = await fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.deepEqual(await limited.json(), { message: "Too many attempts. Please wait a moment and try again." });
  }

  it("limits password login, then leaves unrelated endpoints alone", async () => {
    await exhaust("/api/auth/login", { email: email("rl"), password: "wrong-password" }, AUTH_RATE_LIMITS.login[0].max);

    assert.equal((await limitedApi("GET", "/api/health")).status, 200);
    assert.equal((await limitedApi("POST", "/api/auth/nonce", { body: { provider: "GOOGLE" } })).status, 201, "a separate bucket per endpoint");
  });

  it("limits registration", async () => {
    // Invalid bodies count too: the limit runs before validation.
    await exhaust("/api/auth/register", { email: "not-an-email" }, AUTH_RATE_LIMITS.register[0].max);
  });

  it("limits nonce issuance", async () => {
    await exhaust("/api/auth/nonce", { provider: "GOOGLE" }, AUTH_RATE_LIMITS.nonce[0].max);
  });

  it("limits Google sign-in", async () => {
    await exhaust("/api/auth/google", { credential: "x", nonce: "y" }, AUTH_RATE_LIMITS.social[0].max);
  });

  it("keeps separate IPs in separate buckets and resets after the window", () => {
    const time = { now: 0 };
    const limiter = createIpRateLimiter({ windows: [{ windowMs: 60_000, max: 2 }], message: "Too many.", now: () => time.now });
    const responses: number[] = [];
    const call = (ip: string) => {
      const res = {
        setHeader: () => res,
        status: (code: number) => {
          responses.push(code);
          return { json: () => undefined };
        },
      } as unknown as ExpressResponse;
      let passed = false;
      limiter.middleware({ ip } as ExpressRequest, res, () => {
        passed = true;
      });
      return passed;
    };

    assert.deepEqual([call("203.0.113.1"), call("203.0.113.1"), call("203.0.113.1")], [true, true, false]);
    assert.equal(call("198.51.100.7"), true, "another IP has its own bucket");
    time.now = 60_000;
    assert.equal(call("203.0.113.1"), true, "reset after the window");
    assert.deepEqual(responses, [429]);
  });
});
