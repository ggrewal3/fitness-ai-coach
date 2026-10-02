import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { buildCoachHistory, flattenAssistantMessage, truncateForHistory } from "../src/features/coach/coachHistory"
import { COACH_LIMITS, type CoachAssistantMessage, type CoachMessage, type CoachUserMessage } from "../src/features/coach/coachTypes"

let counter = 0
const user = (content: string, status: CoachUserMessage["status"] = "complete"): CoachUserMessage => ({
  id: `u${++counter}`,
  role: "user",
  content,
  createdAt: "2026-10-02T10:00:00.000Z",
  status,
  error: null,
})
const assistant = (answer: string, extra: Partial<CoachAssistantMessage> = {}): CoachAssistantMessage => ({
  id: `a${++counter}`,
  role: "assistant",
  createdAt: "2026-10-02T10:00:05.000Z",
  answer,
  actionItems: [],
  followUpQuestion: null,
  sources: [],
  ...extra,
})

describe("flattening assistant replies", () => {
  test("answer only", () => {
    assert.equal(flattenAssistantMessage(assistant("  You trained 3 times.  ")), "You trained 3 times.")
  })

  test("answer, action items and follow-up question in the documented format", () => {
    assert.equal(
      flattenAssistantMessage(assistant("You trained 3 times.", { actionItems: ["Add a rest day", " Sleep 8 hours "], followUpQuestion: "Want to compare with last week?" })),
      "You trained 3 times.\n\nAction items:\n- Add a rest day\n- Sleep 8 hours\n\nFollow-up question: Want to compare with last week?",
    )
  })

  test("blank follow-up questions are left out", () => {
    assert.equal(flattenAssistantMessage(assistant("Done.", { followUpQuestion: "   " })), "Done.")
  })
})

describe("truncation", () => {
  test("short text is only trimmed", () => {
    assert.equal(truncateForHistory("  hello  ", 10), "hello")
  })

  test("long text keeps its start, ends with an ellipsis and fits the limit exactly", () => {
    const result = truncateForHistory("a".repeat(5000), 4000)
    assert.equal(result.length, 4000)
    assert.ok(result.endsWith("…"))
  })

  test("never splits a surrogate pair", () => {
    // 3998 "a" + an emoji (2 units) straddles the cut at 3999 units.
    const result = truncateForHistory(`${"a".repeat(3998)}😀😀😀`, 4000)
    assert.ok(result.length <= 4000)
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(result), "no lone high surrogate")
    assert.ok(result.endsWith("…"))
  })

  test("does not leave whitespace before the ellipsis", () => {
    const result = truncateForHistory(`${"a".repeat(3990)}          ${"b".repeat(100)}`, 4000)
    assert.ok(!result.includes(" …"))
  })
})

describe("building history", () => {
  test("only completed messages; the question being sent and failed questions are excluded", () => {
    const messages: CoachMessage[] = [
      user("How was my week?"),
      assistant("Three sessions.", { followUpQuestion: "Compare with last week?" }),
      user("Retry me", "failed"),
      user("What about last week?", "sending"),
    ]

    assert.deepEqual(buildCoachHistory(messages), [
      { role: "user", content: "How was my week?" },
      { role: "assistant", content: "Three sessions.\n\nFollow-up question: Compare with last week?" },
    ])
  })

  test("keeps the newest 10 turns, oldest first", () => {
    const messages: CoachMessage[] = []
    for (let index = 0; index < 8; index += 1) {
      messages.push(user(`question ${index}`), assistant(`answer ${index}`))
    }

    const history = buildCoachHistory(messages)
    assert.equal(history.length, COACH_LIMITS.historyMaxMessages)
    assert.equal(history[0].content, "question 3")
    assert.equal(history.at(-1)?.content, "answer 7")
  })

  test("respects the 12,000 total at exactly the limit, keeping a contiguous newest slice", () => {
    // The newest three turns total exactly 12,000; the older question no longer fits.
    const exact: CoachMessage[] = [user("older question"), assistant("x".repeat(4000)), assistant("y".repeat(4000)), assistant("z".repeat(4000))]
    const history = buildCoachHistory(exact)
    assert.equal(history.reduce((sum, turn) => sum + turn.content.length, 0), COACH_LIMITS.historyMaxTotalChars)
    assert.deepEqual(history.map((turn) => turn.content[0]), ["x", "y", "z"])

    // One character over: the oldest of those turns drops out, and nothing older is skipped back in.
    const over: CoachMessage[] = [user("q"), assistant("x".repeat(4000)), user("w"), assistant("y".repeat(4000)), assistant("z".repeat(4000))]
    assert.deepEqual(buildCoachHistory(over).map((turn) => turn.content[0]), ["w", "y", "z"])
  })

  test("long assistant replies are truncated to the per-turn limit", () => {
    const history = buildCoachHistory([user("hi"), assistant("w".repeat(9000))])
    assert.equal(history[1].content.length, COACH_LIMITS.historyMaxAssistantChars)
  })

  test("every turn stays within the backend limits", () => {
    const messages: CoachMessage[] = []
    for (let index = 0; index < 30; index += 1) {
      messages.push(user("u".repeat(2000)), assistant("a".repeat(6000), { actionItems: ["x".repeat(500)], followUpQuestion: "f".repeat(300) }))
    }
    const history = buildCoachHistory(messages)
    const total = history.reduce((sum, turn) => sum + turn.content.length, 0)

    assert.ok(history.length <= 10 && total <= 12_000)
    for (const turn of history) {
      assert.ok(turn.content.length > 0)
      assert.ok(turn.content.length <= (turn.role === "user" ? 2000 : 4000))
      assert.equal(turn.content, turn.content.trim())
    }
  })

  test("empty conversation gives empty history", () => {
    assert.deepEqual(buildCoachHistory([]), [])
  })
})
