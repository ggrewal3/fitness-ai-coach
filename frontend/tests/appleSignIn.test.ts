// Sign in with Apple in the frontend (Phase 5A-5, ADR-028): configuration,
// the Apple JS loader, per-attempt state and nonce, the first-authorization
// name, the API call and error mapping. Offline: fetch is stubbed and Apple's
// script is never loaded.
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, test } from "node:test"

const env = {
  VITE_API_BASE_URL: "http://api.test",
  VITE_GOOGLE_CLIENT_ID: "client-123.apps.googleusercontent.com",
  VITE_APPLE_CLIENT_ID: " com.fitai.web ",
  VITE_APPLE_REDIRECT_URI: "https://fitai.example.com/auth/apple",
}
;(globalThis as { __VITE_ENV__?: unknown }).__VITE_ENV__ = env

const api = await import("../src/services/api")
const apple = await import("../src/features/auth/appleSignIn")
const config = await import("../src/features/auth/socialConfig")
const shared = await import("../src/features/auth/socialShared")

type Call = { url: string; method: string; body: Record<string, unknown> | undefined }
const calls: Call[] = []
const realFetch = globalThis.fetch

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
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

/** A JWT-shaped string with the given payload (unsigned; only the browser's subject hint reads it). */
const fakeIdToken = (payload: object) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`

describe("configuration", () => {
  test("Apple needs both a Services ID and an absolute HTTPS return URL", () => {
    assert.deepEqual(apple.appleConfigFrom(" com.fitai.web ", " https://fitai.example.com/auth/apple "), {
      clientId: "com.fitai.web",
      redirectUri: "https://fitai.example.com/auth/apple",
    })
    for (const [id, redirect] of [
      [undefined, "https://fitai.example.com"],
      ["com.fitai.web", undefined],
      ["", "https://fitai.example.com"],
      ["com.fitai.web", "   "],
      ["com.fitai.web", "http://localhost:5173/auth"],
      ["com.fitai.web", "not a url"],
      ["com.fitai.web", "/relative"],
    ]) {
      assert.equal(apple.appleConfigFrom(id, redirect), null, `${id} ${redirect}`)
    }
  })

  test("each provider is enabled independently; neither hides the social section", () => {
    const both = config.socialSignInConfigFrom(env)
    assert.equal(both.google, "client-123.apps.googleusercontent.com")
    assert.equal(both.apple?.clientId, "com.fitai.web")
    assert.equal(both.any, true)

    const appleOnly = config.socialSignInConfigFrom({ ...env, VITE_GOOGLE_CLIENT_ID: "" })
    assert.deepEqual([appleOnly.google, appleOnly.apple !== null, appleOnly.any], [null, true, true])

    const googleOnly = config.socialSignInConfigFrom({ ...env, VITE_APPLE_REDIRECT_URI: undefined })
    assert.deepEqual([googleOnly.google !== null, googleOnly.apple, googleOnly.any], [true, null, true])

    const neither = config.socialSignInConfigFrom({ VITE_API_BASE_URL: "x" })
    assert.deepEqual([neither.google, neither.apple, neither.any], [null, null, false])

    assert.equal(config.HAS_SOCIAL_SIGN_IN, true)
    assert.equal(config.APPLE_CONFIG?.redirectUri, "https://fitai.example.com/auth/apple")
  })

  test("Apple's button width stays within Apple's 130–375 px range", () => {
    assert.equal(apple.appleButtonWidth(354), 354)
    assert.equal(apple.appleButtonWidth(100), 130)
    assert.equal(apple.appleButtonWidth(900), 375)
  })
})

// ---------------------------------------------------------------------------

type FakeScript = { src: string; isConnected: boolean; listeners: Record<string, () => void>; addEventListener(type: string, listener: () => void): void; remove(): void; async?: boolean; defer?: boolean }

function fakeHost() {
  const scope: { AppleID?: unknown } = {}
  const scripts: FakeScript[] = []
  return {
    scope,
    scripts,
    findScript: (src: string) => (scripts.find((script) => script.src === src && script.isConnected) ?? null) as unknown as HTMLScriptElement | null,
    createScript: () =>
      ({
        src: "",
        isConnected: false,
        listeners: {},
        addEventListener(this: FakeScript, type: string, listener: () => void) {
          this.listeners[type] = listener
        },
        remove(this: FakeScript) {
          this.isConnected = false
        },
      }) as unknown as HTMLScriptElement,
    append: (script: HTMLScriptElement) => {
      const fake = script as unknown as FakeScript
      fake.isConnected = true
      scripts.push(fake)
    },
    finish(outcome: "load" | "error", defineApple = outcome === "load") {
      if (defineApple) scope.AppleID = { auth: { init() {}, signIn: async () => ({}) } }
      for (const script of scripts) script.listeners[outcome]?.()
    },
  }
}

describe("Apple JS loader", () => {
  test("adds one Apple script; concurrent callers share the load; later calls add nothing", async () => {
    const host = fakeHost()
    const load = apple.createAppleLoader(host)

    const first = load()
    assert.equal(load(), first)
    assert.equal(host.scripts.length, 1)
    assert.equal(host.scripts[0].src, "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js")

    host.finish("load")
    await first
    await load()
    assert.equal(host.scripts.length, 1)
  })

  test("resolves immediately when Apple JS is already present", async () => {
    const host = fakeHost()
    host.scope.AppleID = { auth: { init() {}, signIn: async () => ({}) } }
    await apple.createAppleLoader(host)()
    assert.equal(host.scripts.length, 0)
  })

  test("a failed load is removed and can be retried; a load without AppleID fails safely", async () => {
    const host = fakeHost()
    const load = apple.createAppleLoader(host)

    const failed = load()
    host.finish("error")
    await assert.rejects(failed, apple.AppleScriptError)
    assert.equal(host.scripts[0].isConnected, false)

    const empty = load()
    host.finish("load", false)
    await assert.rejects(empty, apple.AppleScriptError)

    const retry = load()
    host.finish("load")
    await retry
    assert.equal(host.scripts.length, 3)
  })
})

describe("state and nonce per attempt", () => {
  test("state is 32 cryptographically random bytes, base64url", () => {
    const first = apple.createAppleState()
    const second = apple.createAppleState()
    assert.match(first, /^[A-Za-z0-9_-]{43}$/)
    assert.notEqual(first, second)

    let asked = 0
    const counting = { getRandomValues: (array: Uint8Array<ArrayBuffer>) => { asked += 1; return crypto.getRandomValues(array) } }
    apple.createAppleState(counting)
    assert.equal(asked, 1, "drawn from the injected crypto source")
  })

  test("the right state releases the nonce once; a mismatch sends nothing and spends the attempt", () => {
    const slot = apple.createAppleAttemptSlot()
    assert.deepEqual(slot.claim("s-1"), { ok: false, reason: "no_attempt" })

    slot.offer("n-1", "s-1")
    assert.deepEqual(slot.claim("s-1"), { ok: true, nonce: "n-1" })
    assert.deepEqual(slot.claim("s-1"), { ok: false, reason: "busy" }, "duplicate callback ignored")
    slot.release()
    assert.deepEqual(slot.claim("s-1"), { ok: false, reason: "no_attempt" }, "a state can't be reused")

    slot.offer("n-2", "s-2")
    assert.deepEqual(slot.claim("s-wrong"), { ok: false, reason: "state_mismatch" })
    assert.deepEqual(slot.claim("s-2"), { ok: false, reason: "no_attempt" }, "the mismatched attempt is gone")

    slot.offer("n-3", "s-3")
    assert.deepEqual(slot.claim(undefined), { ok: false, reason: "state_mismatch" }, "a missing state is a mismatch")
  })

  test("no new attempt is accepted while one is being verified", () => {
    const slot = apple.createAppleAttemptSlot()
    slot.offer("n-1", "s-1")
    slot.claim("s-1")
    assert.equal(slot.offer("n-2", "s-2"), false)
    slot.release()
    assert.equal(slot.offer("n-2", "s-2"), true)
  })

  test("requests an APPLE nonce with the documented body", async () => {
    stubFetch(201, { provider: "APPLE", nonce: "apple-nonce", expiresAt: "2026-10-04T12:10:00.000Z" })
    const response = await api.requestSignInNonce("APPLE")
    assert.equal(response.nonce, "apple-nonce")
    assert.deepEqual(calls[0], { url: "http://api.test/api/auth/nonce", method: "POST", body: { provider: "APPLE" } })
    assert.equal(sessionStorage.length, 0)
  })
})

describe("first-authorization name", () => {
  test("reads only the name, trimmed and bounded; anything else in Apple's user object is ignored", () => {
    assert.deepEqual(apple.nameFromAppleResponse({ user: { name: { firstName: "  Ada ", lastName: " Lovelace " }, email: "ignored@x.y" } }), { firstName: "Ada", lastName: "Lovelace" })
    assert.deepEqual(apple.nameFromAppleResponse({ user: { name: { firstName: "Ada" } } }), { firstName: "Ada" })
    assert.equal(apple.nameFromAppleResponse({ user: { name: { firstName: "  ", lastName: 5 } } }), null)
    assert.equal(apple.nameFromAppleResponse({}), null)
    assert.equal(apple.nameFromAppleResponse({ user: { name: { firstName: "x".repeat(500) } } })?.firstName?.length, 200)
  })

  test("is remembered in memory for a retry by the same Apple account only, and forgotten after success", () => {
    const memory = apple.createAppleNameMemory()
    const name = { firstName: "Ada", lastName: "Lovelace" }

    assert.deepEqual(memory.forAttempt(name, "sub-A"), name, "first authorization")
    assert.deepEqual(memory.forAttempt(null, "sub-A"), name, "retry after a failed FitAI request")
    assert.equal(memory.forAttempt(null, "sub-B"), null, "never given to another Apple account")
    assert.equal(memory.forAttempt(null, null), null)
    memory.forget()
    assert.equal(memory.forAttempt(null, "sub-A"), null, "returning sign-in works without a name")
  })

  test("the subject hint is read from the ID token without trusting it for anything else", () => {
    assert.equal(apple.appleTokenSubject(fakeIdToken({ sub: "001.abc.002" })), "001.abc.002")
    for (const token of [undefined, "", "garbage", fakeIdToken({}), fakeIdToken({ sub: 5 }), "a.!!!.c"]) {
      assert.equal(apple.appleTokenSubject(token), null)
    }
  })
})

describe("Apple API call and session", () => {
  test("sends exactly idToken, nonce and the optional name; never the code, email, subject or relay flag", () => {
    const response = {
      authorization: { id_token: "apple.id.token", state: "s", code: "AUTH-CODE" },
      user: { name: { firstName: "Ada" }, email: "real@x.y" },
    }
    assert.deepEqual(apple.appleSignInRequest(response, "n-1", { firstName: "Ada" }), { idToken: "apple.id.token", nonce: "n-1", firstName: "Ada" })
    assert.deepEqual(apple.appleSignInRequest(response, "n-1", null), { idToken: "apple.id.token", nonce: "n-1" })
    assert.equal(apple.appleSignInRequest({ authorization: { state: "s" } }, "n-1", null), null, "no ID token, nothing to send")
  })

  test("POST /api/auth/apple has the documented body, and a 401 is not session expiry", async () => {
    api.storeAuthToken("existing.session")
    let unauthorized = 0
    api.setUnauthorizedHandler(() => {
      unauthorized += 1
    })
    stubFetch(401, { message: "We couldn't verify your Apple account. Please try again." })

    await assert.rejects(api.signInWithAppleIdToken({ idToken: "apple.id.token", nonce: "n-1", firstName: "Ada", lastName: "L" }))

    assert.deepEqual(calls[0], { url: "http://api.test/api/auth/apple", method: "POST", body: { idToken: "apple.id.token", nonce: "n-1", firstName: "Ada", lastName: "L" } })
    assert.deepEqual(Object.keys(calls[0].body ?? {}).sort(), ["firstName", "idToken", "lastName", "nonce"])
    assert.equal(unauthorized, 0)
    assert.equal(api.getStoredAuthToken(), "existing.session")
  })

  test("a successful sign-in stores only FitAI's token (as acceptSession does)", async () => {
    stubFetch(200, { token: "fitai.jwt", user: { id: 1, firstName: "Ada", lastName: "L", email: "a@privaterelay.appleid.com" }, isNewUser: true })

    const response = await api.signInWithAppleIdToken({ idToken: "apple.id.token", nonce: "n-1", firstName: "Ada" })
    api.storeAuthToken(response.token)

    assert.deepEqual(Object.keys(sessionStorage), [api.AUTH_TOKEN_STORAGE_KEY])
    const stored = JSON.stringify({ ...sessionStorage, ...localStorage })
    for (const secret of ["apple.id.token", "n-1", "Ada"]) assert.ok(!stored.includes(secret), secret)
  })
})

describe("Apple error messages", () => {
  const error = (status: number, code: string | null = null) => new api.ApiRequestError("backend detail jose sub=001", status, [], null, code)

  test("maps each failure to a short, safe Apple message", () => {
    const message = (failure: unknown) => apple.appleSignInError(failure).message
    assert.equal(message(error(401)), "Couldn't verify your Apple account. Try again.")
    assert.equal(message(error(401, "MISSING_EMAIL")), "Apple didn't share the email address FitAI needs to create your account. You may need to remove FitAI from Sign in with Apple in your Apple ID settings and try again.")
    assert.equal(apple.appleSignInError(error(409, "EMAIL_IN_USE")).kind, "email_in_use")
    assert.equal(message(error(409, "EMAIL_IN_USE")), "An account with this email already exists. Sign in using your existing method.")
    assert.equal(message(error(429)), "Too many sign-in attempts. Please wait and try again.")
    assert.equal(message(error(503)), "Apple sign-in is temporarily unavailable.")
    assert.equal(message(new apple.AppleScriptError()), "Apple sign-in didn't complete. Try again.")
    for (const failure of [error(500), new TypeError("Failed to fetch"), null, { error: "invalid_client" }]) {
      assert.equal(message(failure), "Apple sign-in didn't complete. Try again.")
    }
    for (const status of [400, 401, 409, 429, 500, 503]) assert.ok(!/jose|sub=|backend/.test(message(error(status))))
  })

  test("popup closing or declining is a silent cancellation; other failures are not", () => {
    assert.equal(apple.isAppleCancellation({ error: "popup_closed_by_user" }), true)
    assert.equal(apple.isAppleCancellation({ error: "user_cancelled_authorize" }), true)
    assert.equal(apple.isAppleCancellation("popup_closed_by_user"), true)
    assert.equal(apple.isAppleCancellation({ error: "invalid_request" }), false)
    assert.equal(apple.isAppleCancellation(undefined), false)
  })

  test("Google keeps its own wording through the shared mapper", () => {
    assert.equal(shared.mapSocialSignInError("GOOGLE", error(503)).message, "Google sign-in is temporarily unavailable.")
    assert.equal(shared.mapSocialSignInError("GOOGLE", error(401, "MISSING_EMAIL")).message, "Couldn't verify your Google account. Try again.")
  })
})
