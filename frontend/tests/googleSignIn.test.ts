// Google sign-in in the frontend (Phase 5A-3, ADR-028): configuration, the
// GIS script loader, the single-use nonce slot, the auth API calls, 401
// handling and error mapping. No request leaves the test: fetch is stubbed
// and the GIS script is never actually loaded.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, test } from "node:test"

// Vite configuration for the modules under test (see tests/support/resolve-ts.mjs).
const env = { VITE_API_BASE_URL: "http://api.test", VITE_GOOGLE_CLIENT_ID: " client-123.apps.googleusercontent.com " }
;(globalThis as { __VITE_ENV__?: unknown }).__VITE_ENV__ = env

const api = await import("../src/services/api")
const gis = await import("../src/features/auth/googleIdentity")
const config = await import("../src/features/auth/socialConfig")
const session = await import("../src/features/auth/userSession")

type Call = { url: string; method: string; headers: Headers; body: unknown }
const calls: Call[] = []
const realFetch = globalThis.fetch

function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })
  }) as typeof fetch
}

beforeEach(() => {
  calls.length = 0
  sessionStorage.clear()
  api.setUnauthorizedHandler(null)
})

afterEach(() => {
  globalThis.fetch = realFetch
  api.setUnauthorizedHandler(null)
})

describe("configuration", () => {
  test("Google sign-in is off without a client ID and on with one (trimmed)", () => {
    for (const value of [undefined, null, "", "   ", 42]) assert.equal(gis.googleClientIdFrom(value), null, String(value))
    assert.equal(gis.googleClientIdFrom(" id.apps.googleusercontent.com "), "id.apps.googleusercontent.com")
    assert.equal(config.GOOGLE_CLIENT_ID, "client-123.apps.googleusercontent.com", "read from VITE_GOOGLE_CLIENT_ID")
  })

  test("button width stays within Google's 200–400 px range", () => {
    assert.equal(gis.googleButtonWidth(206), 206)
    assert.equal(gis.googleButtonWidth(150), 200)
    assert.equal(gis.googleButtonWidth(900), 400)
    assert.equal(gis.googleButtonWidth(0), 200)
  })
})

// ---------------------------------------------------------------------------
// Script loader with a fake document

type FakeScript = {
  src: string
  async: boolean
  defer: boolean
  isConnected: boolean
  listeners: Record<string, () => void>
  addEventListener(type: string, listener: () => void): void
  remove(): void
}

function fakeHost() {
  const scope: { google?: unknown } = {}
  const scripts: FakeScript[] = []
  const host = {
    scope,
    scripts,
    findScript: (src: string) => (scripts.find((script) => script.src === src && script.isConnected) ?? null) as unknown as HTMLScriptElement | null,
    createScript: () => {
      const script: FakeScript = {
        src: "",
        async: false,
        defer: false,
        isConnected: false,
        listeners: {},
        addEventListener(type, listener) {
          this.listeners[type] = listener
        },
        remove() {
          this.isConnected = false
        },
      }
      return script as unknown as HTMLScriptElement
    },
    append: (script: HTMLScriptElement) => {
      const fake = script as unknown as FakeScript
      fake.isConnected = true
      scripts.push(fake)
    },
    /** Simulates the browser finishing the script. */
    finish(outcome: "load" | "error", installGoogle = outcome === "load") {
      if (installGoogle) scope.google = { accounts: { id: { initialize() {}, renderButton() {}, disableAutoSelect() {} } } }
      for (const script of scripts) script.listeners[outcome]?.()
    },
  }
  return host
}

describe("GIS script loader", () => {
  test("adds one async GIS script and shares the pending load between callers", async () => {
    const host = fakeHost()
    const load = gis.createGisLoader(host)

    const first = load()
    const second = load()
    assert.equal(first, second, "concurrent callers share one promise")
    assert.equal(host.scripts.length, 1)
    assert.equal(host.scripts[0].src, "https://accounts.google.com/gsi/client")
    assert.equal(host.scripts[0].async, true)

    host.finish("load")
    const [a, b] = await Promise.all([first, second])
    assert.equal(a, b)
    await load()
    assert.equal(host.scripts.length, 1, "later calls never add another script")
  })

  test("resolves at once when GIS is already loaded, adding nothing", async () => {
    const host = fakeHost()
    host.scope.google = { accounts: { id: { initialize() {}, renderButton() {}, disableAutoSelect() {} } } }

    await gis.createGisLoader(host)()
    assert.equal(host.scripts.length, 0)
  })

  test("rejects safely on failure, removes the failed script, and a retry loads again", async () => {
    const host = fakeHost()
    const load = gis.createGisLoader(host)

    const failed = load()
    host.finish("error")
    await assert.rejects(failed, gis.GisLoadError)
    assert.equal(host.scripts[0].isConnected, false, "failed script removed")

    const retry = load()
    assert.notEqual(retry, failed, "the rejection isn't cached")
    assert.equal(host.scripts.length, 2)
    host.finish("load")
    await retry
  })

  test("a script that loads without defining GIS counts as a failure", async () => {
    const host = fakeHost()
    const pending = gis.createGisLoader(host)()
    host.finish("load", false)
    await assert.rejects(pending, gis.GisLoadError)
  })
})

describe("single-use nonce slot", () => {
  test("hands a nonce out once; duplicates get nothing while one is in flight", () => {
    const slot = gis.createNonceSlot()
    assert.equal(slot.claim(), null, "no nonce yet")

    assert.equal(slot.offer("n-1"), true)
    assert.equal(slot.claim(), "n-1")
    assert.equal(slot.claim(), null, "duplicate callback ignored")
    assert.equal(slot.busy, true)
    assert.equal(slot.offer("n-2"), false, "no new nonce while verifying")

    slot.release()
    assert.equal(slot.claim(), null, "the spent nonce is never reused")
    assert.equal(slot.offer("n-3"), true)
    assert.equal(slot.claim(), "n-3")
  })

  test("clear drops an unclaimed nonce", () => {
    const slot = gis.createNonceSlot()
    slot.offer("n-1")
    slot.clear()
    assert.equal(slot.claim(), null)
  })
})

describe("auth API calls", () => {
  test("requests a Google nonce with the documented body", async () => {
    stubFetch(201, { provider: "GOOGLE", nonce: "nonce-abc", expiresAt: "2026-10-04T12:10:00.000Z" })

    const response = await api.requestSignInNonce("GOOGLE")

    assert.equal(response.nonce, "nonce-abc")
    assert.deepEqual({ url: calls[0].url, method: calls[0].method, body: calls[0].body }, {
      url: "http://api.test/api/auth/nonce",
      method: "POST",
      body: { provider: "GOOGLE" },
    })
    assert.equal(calls[0].headers.get("Content-Type"), "application/json")
  })

  test("sends only the credential and nonce to /api/auth/google, never in the URL, and stores nothing itself", async () => {
    stubFetch(200, { token: "fitai.jwt.token", user: { id: 1, firstName: "A", lastName: "B", email: "a@b.c" }, isNewUser: true })

    const response = await api.signInWithGoogleCredential("google.id.token", "nonce-abc")

    assert.equal(response.token, "fitai.jwt.token")
    assert.equal(calls[0].url, "http://api.test/api/auth/google")
    assert.deepEqual(calls[0].body, { credential: "google.id.token", nonce: "nonce-abc" })
    assert.equal(sessionStorage.length, 0, "the API call itself persists nothing")
  })

  test("accepting the session stores only FitAI's token, never the Google credential or nonce", async () => {
    stubFetch(200, { token: "fitai.jwt.token", user: { id: 1, firstName: "A", lastName: "B", email: "a@b.c" }, isNewUser: false })

    // What AuthContext.loginWithGoogle does: verify, then accept the FitAI session.
    const response = await api.signInWithGoogleCredential("google.id.token", "nonce-abc")
    api.storeAuthToken(response.token)

    assert.deepEqual(Object.keys(sessionStorage), [api.AUTH_TOKEN_STORAGE_KEY])
    assert.equal(sessionStorage.getItem(api.AUTH_TOKEN_STORAGE_KEY), "fitai.jwt.token")
    const everything = JSON.stringify({ ...sessionStorage })
    assert.ok(!everything.includes("google.id.token") && !everything.includes("nonce-abc"))
  })
})

describe("401 handling", () => {
  function trackUnauthorized() {
    let calledTimes = 0
    api.setUnauthorizedHandler(() => {
      calledTimes += 1
    })
    return () => calledTimes
  }

  test("a 401 from Google sign-in doesn't end an existing FitAI session", async () => {
    api.storeAuthToken("existing.session")
    const unauthorized = trackUnauthorized()
    stubFetch(401, { message: "We couldn't verify your Google account. Please try again." })

    await assert.rejects(api.signInWithGoogleCredential("bad", "nonce"), (error: unknown) => error instanceof api.ApiRequestError && error.status === 401)

    assert.equal(unauthorized(), 0)
    assert.equal(api.getStoredAuthToken(), "existing.session")
  })

  test("a 401 from an authenticated API still ends the session exactly as before", async () => {
    api.storeAuthToken("expired.session")
    sessionStorage.setItem("fitai.user.coach.conversation.v1", "{}")
    const unauthorized = trackUnauthorized()
    stubFetch(401, { message: "Invalid or expired token." })

    await assert.rejects(api.getWeightCheckIns())

    assert.equal(calls[0].headers.get("Authorization"), "Bearer expired.session")
    assert.equal(unauthorized(), 1)
    assert.equal(api.getStoredAuthToken(), null)
  })

  test("password login and registration keep their contract; their 401s aren't session expiry", async () => {
    const unauthorized = trackUnauthorized()
    stubFetch(401, { message: "Invalid email or password." })

    await assert.rejects(api.loginUser({ email: "a@b.c", password: "wrong" }), (error: unknown) => error instanceof api.ApiRequestError && error.message === "Invalid email or password.")
    assert.deepEqual({ url: calls[0].url, body: calls[0].body }, { url: "http://api.test/api/auth/login", body: { email: "a@b.c", password: "wrong" } })
    assert.equal(unauthorized(), 0)

    stubFetch(201, { id: 5, firstName: "A", lastName: "B", email: "a@b.c" })
    const created = await api.registerUser({ firstName: "A", lastName: "B", email: "a@b.c", password: "Password123!" })
    assert.equal(created.id, 5)
    assert.equal(calls[1].url, "http://api.test/api/auth/register")

    stubFetch(200, { token: "pw.session", user: { id: 5, firstName: "A", lastName: "B", email: "a@b.c" } })
    const loggedIn = await api.loginUser({ email: "a@b.c", password: "Password123!" })
    assert.equal(loggedIn.token, "pw.session")
  })

  test("sign-out still clears the token and every user-scoped key", () => {
    api.storeAuthToken("session")
    sessionStorage.setItem("fitai.user.coach.conversation.v1", "{}")
    sessionStorage.setItem("fitai.theme.other", "keep")

    api.clearUserSessionData()

    assert.equal(api.getStoredAuthToken(), null)
    assert.equal(sessionStorage.getItem("fitai.user.coach.conversation.v1"), null)
    assert.equal(sessionStorage.getItem("fitai.theme.other"), "keep")
    assert.equal(session.USER_SCOPED_STORAGE_PREFIX, "fitai.user.")
  })
})

describe("error messages", () => {
  const error = (status: number, code: string | null = null, message = "backend detail") => new api.ApiRequestError(message, status, [], null, code)

  test("maps each failure to a short, safe message", () => {
    assert.deepEqual(gis.socialSignInError(error(409, "EMAIL_IN_USE")), {
      kind: "email_in_use",
      message: "An account with this email already exists. Sign in using your existing method.",
    })
    assert.equal(gis.socialSignInError(error(401)).message, "Couldn't verify your Google account. Try again.")
    assert.equal(gis.socialSignInError(error(429)).message, "Too many sign-in attempts. Please wait and try again.")
    assert.equal(gis.socialSignInError(error(503)).message, "Google sign-in is temporarily unavailable.")
    assert.equal(gis.socialSignInError(new gis.GisLoadError()).message, "Google sign-in didn't complete. Try again.")
    for (const failure of [error(500), error(409, "SOMETHING_ELSE"), new TypeError("Failed to fetch"), "weird"]) {
      assert.deepEqual(gis.socialSignInError(failure), { kind: "failed", message: "Google sign-in didn't complete. Try again." })
    }
  })

  test("never shows the backend's or provider's own wording", () => {
    for (const status of [400, 401, 409, 429, 500, 503]) {
      assert.ok(!gis.socialSignInError(error(status, null, "jose JWTClaimValidationFailed aud")).message.includes("jose"))
    }
  })

  test("the API error carries the machine-readable code", async () => {
    stubFetch(409, { code: "EMAIL_IN_USE", message: "An account with this email already exists." })
    await assert.rejects(api.signInWithGoogleCredential("c", "n"), (failure: unknown) => failure instanceof api.ApiRequestError && failure.code === "EMAIL_IN_USE")
  })
})
