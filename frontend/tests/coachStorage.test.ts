import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { clearUserScopedStorage, readJwtUserId, USER_SCOPED_STORAGE_PREFIX } from "../src/features/auth/userSession"
import {
  COACH_STORAGE_KEY,
  loadConversation,
  parseStoredConversation,
  saveConversation,
  serializeConversation,
} from "../src/features/coach/coachStorage"
import type { CoachMessage } from "../src/features/coach/coachTypes"

class MemoryStorage {
  private readonly items = new Map<string, string>()
  failWrites = false
  failReads = false
  get length() {
    return this.items.size
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  getItem(key: string) {
    if (this.failReads) throw new Error("SecurityError")
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError")
    this.items.set(key, value)
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
}

const conversation: CoachMessage[] = [
  { id: "u1", role: "user", content: "How was my week?", createdAt: "2026-10-02T10:00:00.000Z", status: "complete", error: null },
  {
    id: "a1",
    role: "assistant",
    createdAt: "2026-10-02T10:00:05.000Z",
    answer: "Three sessions.",
    actionItems: ["Rest tomorrow"],
    followUpQuestion: "Compare with last week?",
    sources: [{ type: "workouts", startDate: "2026-09-26", endDate: "2026-10-02" }],
  },
  { id: "u2", role: "user", content: "Pending", createdAt: "2026-10-02T10:01:00.000Z", status: "sending", error: null },
  {
    id: "u3",
    role: "user",
    content: "Failed",
    createdAt: "2026-10-02T10:02:00.000Z",
    status: "failed",
    error: { kind: "network", message: "x", retryAvailableAt: null },
  },
]

const jwt = (payload: unknown) => `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`

describe("coach storage", () => {
  test("uses a user-scoped, versioned key", () => {
    assert.equal(COACH_STORAGE_KEY, "fitai.user.coach.conversation.v1")
    assert.ok(COACH_STORAGE_KEY.startsWith(USER_SCOPED_STORAGE_PREFIX))
  })

  test("persists completed messages only, and restores them as completed", () => {
    const storage = new MemoryStorage()
    assert.equal(saveConversation(storage, 7, conversation), true)

    const stored = JSON.parse(storage.getItem(COACH_STORAGE_KEY)!)
    assert.deepEqual(Object.keys(stored).sort(), ["messages", "userId", "version"])
    assert.deepEqual(stored.messages.map((message: { id: string }) => message.id), ["u1", "a1"])
    assert.ok(!JSON.stringify(stored).includes("status"), "no transient state stored")

    const restored = loadConversation(storage, 7)
    assert.deepEqual(restored, conversation.slice(0, 2))
  })

  test("discards another user's conversation and removes it", () => {
    const storage = new MemoryStorage()
    saveConversation(storage, 7, conversation)

    assert.deepEqual(loadConversation(storage, 8), [])
    assert.equal(storage.getItem(COACH_STORAGE_KEY), null)
  })

  test("discards malformed, wrong-version and invalid data", () => {
    const valid = JSON.parse(serializeConversation(7, conversation))
    const cases = [
      "{not json",
      "null",
      "[]",
      JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify({ ...valid, userId: "7" }),
      JSON.stringify({ ...valid, messages: "nope" }),
      JSON.stringify({ ...valid, messages: [{ ...valid.messages[0], role: "system" }] }),
      JSON.stringify({ ...valid, messages: [{ ...valid.messages[1], sources: [{ type: "getWeightHistory", startDate: null, endDate: null }] }] }),
      JSON.stringify({ ...valid, messages: [{ ...valid.messages[1], sources: [{ type: "weight", startDate: "yesterday", endDate: null }] }] }),
      JSON.stringify({ ...valid, messages: [{ ...valid.messages[0], content: "x".repeat(2001) }] }),
      JSON.stringify({ ...valid, messages: Array.from({ length: 61 }, () => valid.messages[0]) }),
    ]

    for (const raw of cases) {
      assert.equal(parseStoredConversation(raw, 7), null, raw.slice(0, 60))
      const storage = new MemoryStorage()
      storage.setItem(COACH_STORAGE_KEY, raw)
      assert.deepEqual(loadConversation(storage, 7), [])
      assert.equal(storage.getItem(COACH_STORAGE_KEY), null)
    }
  })

  test("keeps only the newest 60 messages", () => {
    const many: CoachMessage[] = Array.from({ length: 70 }, (_, index) => ({
      id: `u${index}`,
      role: "user" as const,
      content: `q${index}`,
      createdAt: "2026-10-02T10:00:00.000Z",
      status: "complete" as const,
      error: null,
    }))
    const stored = JSON.parse(serializeConversation(1, many))
    assert.equal(stored.messages.length, 60)
    assert.equal(stored.messages[0].id, "u10")
  })

  test("fails soft when storage is unavailable or full", () => {
    const storage = new MemoryStorage()
    storage.failWrites = true
    assert.equal(saveConversation(storage, 7, conversation), false)

    storage.failReads = true
    assert.deepEqual(loadConversation(storage, 7), [])
  })

  test("an empty conversation removes the stored copy", () => {
    const storage = new MemoryStorage()
    saveConversation(storage, 7, conversation)
    saveConversation(storage, 7, [])
    assert.equal(storage.getItem(COACH_STORAGE_KEY), null)
  })
})

describe("user session helpers", () => {
  test("sign-out clears every user-scoped key and nothing else", () => {
    const storage = new MemoryStorage()
    storage.setItem("fitai.user.coach.conversation.v1", "x")
    storage.setItem("fitai.user.other", "y")
    storage.setItem("fitai.auth.token", "t")
    storage.setItem("unrelated", "z")

    clearUserScopedStorage(storage)

    assert.equal(storage.getItem("fitai.user.coach.conversation.v1"), null)
    assert.equal(storage.getItem("fitai.user.other"), null)
    assert.equal(storage.getItem("fitai.auth.token"), "t")
    assert.equal(storage.getItem("unrelated"), "z")
  })

  test("clearing unavailable storage does not throw", () => {
    clearUserScopedStorage({
      get length(): number {
        throw new Error("SecurityError")
      },
      key: () => null,
      removeItem: () => undefined,
    })
  })

  test("reads the userId claim without trusting malformed tokens", () => {
    assert.equal(readJwtUserId(jwt({ userId: 42, iat: 1 })), 42)
    for (const token of [null, "", "abc", "a.b.c", jwt({ userId: "42" }), jwt({ userId: 0 }), jwt({ userId: 1.5 }), jwt({ sub: 42 }), jwt(null)]) {
      assert.equal(readJwtUserId(token), null, String(token))
    }
  })
})
