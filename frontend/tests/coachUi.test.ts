// Coach sources, client context, starter prompts and conversation transitions.
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { getCoachClientContext, isUsableTimeZone, localDateString } from "../src/features/coach/coachClientContext"
import { coachErrorFor, coachReducer, EMPTY_COACH_STATE, timezoneError, type CoachState } from "../src/features/coach/coachConversation"
import { STARTER_PROMPTS } from "../src/features/coach/coachPrompts"
import { describeSource, formatSourcePeriod, sourceLabel } from "../src/features/coach/coachSources"
import type { CoachAssistantMessage } from "../src/features/coach/coachTypes"

// Intl separates ranges with thin spaces; compare with ordinary spaces.
const plain = (text: string | null) => text?.replace(/\s/g, " ") ?? null

describe("sources", () => {
  test("public labels only", () => {
    assert.deepEqual(
      (["profile", "weight", "nutrition", "activity", "workouts"] as const).map(sourceLabel),
      ["Profile", "Weight", "Nutrition", "Activity", "Workouts"],
    )
  })

  test("periods format in UTC, so dates never shift", () => {
    assert.equal(plain(formatSourcePeriod({ type: "weight", startDate: "2026-09-19", endDate: "2026-10-02" }, "en-US")), "Sep 19 – Oct 2")
    assert.equal(plain(formatSourcePeriod({ type: "nutrition", startDate: "2026-10-02", endDate: "2026-10-02" }, "en-US")), "Oct 2")
    assert.equal(formatSourcePeriod({ type: "profile", startDate: null, endDate: null }, "en-US"), null)
  })

  test("ranges crossing a year include the years", () => {
    assert.equal(
      plain(formatSourcePeriod({ type: "workouts", startDate: "2026-12-20", endDate: "2027-01-02" }, "en-US")),
      "Dec 20, 2026 – Jan 2, 2027",
    )
  })

  test("accessible descriptions", () => {
    assert.equal(plain(describeSource({ type: "weight", startDate: "2026-09-19", endDate: "2026-10-02" }, "en-US")), "Weight, Sep 19 – Oct 2")
    assert.equal(describeSource({ type: "profile", startDate: null, endDate: null }, "en-US"), "Profile")
  })
})

describe("client context", () => {
  test("uses the local calendar date, not the UTC date", () => {
    const lateEvening = new Date(2026, 9, 2, 23, 30) // 23:30 local on Oct 2
    assert.equal(localDateString(lateEvening), "2026-10-02")
    assert.equal(localDateString(new Date(2026, 0, 1, 0, 5)), "2026-01-01")
  })

  test("returns the browser's IANA timezone and is computed per call", () => {
    const first = getCoachClientContext(new Date(2026, 9, 2, 23, 59), () => "Europe/London")
    const second = getCoachClientContext(new Date(2026, 9, 3, 0, 1), () => "Europe/London")
    assert.deepEqual(first, { ok: true, context: { today: "2026-10-02", timeZone: "Europe/London" } })
    assert.deepEqual(second, { ok: true, context: { today: "2026-10-03", timeZone: "Europe/London" } })
  })

  test("never substitutes a timezone when none is usable", () => {
    for (const zone of [undefined, "", "+05:00", "UTC+5", "Mars/Phobos", "a".repeat(80)]) {
      assert.deepEqual(getCoachClientContext(new Date(), () => zone), { ok: false, reason: "timezone" }, String(zone))
    }
    assert.deepEqual(getCoachClientContext(new Date(), () => { throw new Error("no Intl") }), { ok: false, reason: "timezone" })
  })

  test("accepts real IANA names", () => {
    for (const zone of ["UTC", "America/New_York", "Asia/Kolkata", "America/Argentina/Buenos_Aires"]) {
      assert.ok(isUsableTimeZone(zone), zone)
    }
  })
})

describe("starter prompts", () => {
  test("four prompts within the message limit", () => {
    assert.equal(STARTER_PROMPTS.length, 4)
    for (const prompt of STARTER_PROMPTS) assert.ok(prompt.length > 0 && prompt.length <= 2000)
  })
})

const reply = (id: string): CoachAssistantMessage => ({
  id,
  role: "assistant",
  createdAt: "t",
  answer: "Answer",
  actionItems: [],
  followUpQuestion: null,
  sources: [],
})

describe("conversation transitions", () => {
  const started = coachReducer(EMPTY_COACH_STATE, { type: "sendStarted", id: "q1", content: "Hi", createdAt: "t" })

  test("one request at a time", () => {
    assert.equal(started.pendingId, "q1")
    assert.equal(coachReducer(started, { type: "sendStarted", id: "q2", content: "Again", createdAt: "t" }), started)
  })

  test("a reply completes the question and appends the answer after it", () => {
    const done = coachReducer(started, { type: "replyReceived", questionId: "q1", reply: reply("a1") })
    assert.equal(done.pendingId, null)
    assert.deepEqual(done.messages.map((message) => (message.role === "user" ? `${message.id}:${message.status}` : message.id)), ["q1:complete", "a1"])
  })

  test("late replies or failures for another question are ignored", () => {
    assert.equal(coachReducer(started, { type: "replyReceived", questionId: "old", reply: reply("a1") }), started)
    assert.equal(coachReducer(started, { type: "requestFailed", questionId: "old", error: coachErrorFor(503) }), started)
    assert.equal(coachReducer(EMPTY_COACH_STATE, { type: "replyReceived", questionId: "q1", reply: reply("a1") }), EMPTY_COACH_STATE)
  })

  test("failure keeps the question visible and retry reuses it without duplicates", () => {
    const failed = coachReducer(started, { type: "requestFailed", questionId: "q1", error: coachErrorFor(null) })
    assert.equal(failed.pendingId, null)
    assert.equal(failed.messages.length, 1)

    const retrying = coachReducer(failed, { type: "retryStarted", id: "q1" })
    assert.equal(retrying.pendingId, "q1")
    assert.equal(retrying.messages.length, 1)
    assert.equal(retrying.messages[0].role === "user" && retrying.messages[0].status, "sending")

    const done = coachReducer(retrying, { type: "replyReceived", questionId: "q1", reply: reply("a1") })
    assert.deepEqual(done.messages.map((message) => message.id), ["q1", "a1"])
  })

  test("retry is ignored for a message that has not failed", () => {
    assert.equal(coachReducer(started, { type: "retryStarted", id: "q1" }), started)
  })

  test("sending a new question drops a lingering failed one; edit removes it", () => {
    const failed = coachReducer(started, { type: "requestFailed", questionId: "q1", error: coachErrorFor(504) })
    const next = coachReducer(failed, { type: "sendStarted", id: "q2", content: "New", createdAt: "t" })
    assert.deepEqual(next.messages.map((message) => message.id), ["q2"])
    assert.deepEqual(coachReducer(failed, { type: "failedRemoved", id: "q1" }).messages, [])
  })

  test("a missing timezone fails before any request and stays retryable", () => {
    const state: CoachState = coachReducer(EMPTY_COACH_STATE, { type: "sendFailedBeforeRequest", id: "q1", content: "Hi", createdAt: "t", error: timezoneError() })
    assert.equal(state.pendingId, null)
    assert.equal(state.messages[0].role === "user" && state.messages[0].error?.kind, "timezone")
  })

  test("reset clears everything", () => {
    assert.deepEqual(coachReducer(started, { type: "reset" }), EMPTY_COACH_STATE)
  })
})

describe("error mapping", () => {
  test("maps statuses to kinds and safe copy", () => {
    const kinds = [null, 0, 400, 429, 502, 503, 504, 500, 418].map((status) => coachErrorFor(status).kind)
    assert.deepEqual(kinds, ["network", "network", "rejected", "rateLimited", "invalid", "unavailable", "timeout", "unknown", "unknown"])
    assert.match(timezoneError().message, /couldn’t determine your timezone/)
  })

  test("Retry-After becomes an absolute retry time for 429 only", () => {
    assert.equal(coachErrorFor(429, 30, 1_000).retryAvailableAt, 31_000)
    assert.equal(coachErrorFor(429, null, 1_000).retryAvailableAt, null)
    assert.equal(coachErrorFor(503, 30, 1_000).retryAvailableAt, null)
  })
})
