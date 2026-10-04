// The optional evaluation observer (ADR-027): what it receives, and that it
// can never change a request, its logs or its response. Scripted provider only.
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import type { CoachObserverEvent } from "../src/modules/ai/coach.observer.js";
import { generateCoachResponse, setModelProvider } from "../src/modules/ai/coach.service.js";
import {
  ModelProviderError,
  type ModelProvider,
  type ModelProviderSession,
  type ModelSessionRequest,
  type ModelToolResult,
  type ModelTurn,
} from "../src/modules/ai/model.provider.js";
import { createApi, createTestUser, deleteTestUsers, prisma, startTestServer, type TestServer, type TestUser } from "./helpers.js";

type Step = (results?: readonly ModelToolResult[]) => ModelTurn;

class ScriptedProvider implements ModelProvider {
  readonly name = "fake";
  readonly model = "fake-model";
  readonly submitted: (readonly ModelToolResult[])[] = [];
  readonly requests: ModelSessionRequest<unknown>[] = [];
  private calls = 0;

  constructor(private readonly script: Step[]) {}

  createSession<T>(request: ModelSessionRequest<T>): ModelProviderSession<T> {
    this.requests.push(request as ModelSessionRequest<unknown>);
    const run = async (results?: readonly ModelToolResult[]) => {
      const step = this.script[this.calls++];
      assert.ok(step, "unexpected provider call");
      if (results) this.submitted.push(JSON.parse(JSON.stringify(results)));
      return step(results);
    };
    return { next: () => run(), submitToolResults: (results) => run(results) };
  }
}

const ANSWER = { answer: "Steady.", actionItems: ["Keep logging."], followUpQuestion: null };
const meta = { model: "fake-model", providerRequestId: "p", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
const final: Step = () => ({ type: "final", output: ANSWER, ...meta });
const tools = (...calls: [string, unknown][]): Step => () => ({
  type: "tool_calls",
  toolCalls: calls.map(([name, args], index) => ({ id: `c${index}`, name, arguments: args })),
  ...meta,
});
const TODAY = "2026-06-15";
const request = { message: "How is my weight?", clientContext: { today: TODAY, timeZone: "America/New_York" } };

let server: TestServer;
let user: TestUser;
const createdUserIds: number[] = [];

before(async () => {
  server = await startTestServer();
  user = await createTestUser(createApi(server.baseUrl), createdUserIds);
  await prisma.weightCheckIn.create({ data: { userId: user.id, weightKg: 83.21, recordedAt: new Date("2026-06-14T12:00:00Z") } });
});

afterEach(() => setModelProvider(undefined));

after(async () => {
  await deleteTestUsers(createdUserIds);
  await server.close();
});

const script = () => [
  tools(["getWeightHistory", { days: 7 }], ["getWeightHistory", { days: 7 }], ["getEveryUsersData", {}], ["getWeightHistory", { days: 365 }]),
  final,
];

async function observe(observer?: (event: CoachObserverEvent) => void, steps = script()) {
  const provider = new ScriptedProvider(steps);
  setModelProvider(provider);
  const result = await generateCoachResponse(user.id, request, observer ? { observer } : {});
  return { provider, result };
}

describe("coach observer", () => {
  it("reports provider turns, validated tool calls with outcomes and outputs, and completion", async () => {
    const events: CoachObserverEvent[] = [];
    const { provider } = await observe((event) => events.push(event));

    assert.deepEqual(events.map((event) => event.type), ["provider_turn", "tool_call", "tool_call", "tool_call", "tool_call", "provider_turn", "request_completed"]);
    const requestIds = new Set(events.map((event) => event.requestId));
    assert.equal(requestIds.size, 1, "one request id");

    const [firstTurn] = events.filter((event) => event.type === "provider_turn");
    assert.deepEqual({ ...firstTurn, latencyMs: 0, requestId: "" }, {
      type: "provider_turn", requestId: "", turn: 1, kind: "tool_calls", requestedToolCalls: 4, model: "fake-model", usage: meta.usage, latencyMs: 0,
    });

    const calls = events.filter((event) => event.type === "tool_call");
    assert.deepEqual(
      calls.map(({ toolName, validatedArguments, outcome, turn }) => ({ toolName, validatedArguments, outcome, turn })),
      [
        { toolName: "getWeightHistory", validatedArguments: { days: 7 }, outcome: "ok", turn: 1 },
        { toolName: "getWeightHistory", validatedArguments: { days: 7 }, outcome: "cached", turn: 1 },
        { toolName: "unknown", validatedArguments: null, outcome: "unknown_tool", turn: 1 },
        { toolName: "getWeightHistory", validatedArguments: null, outcome: "invalid_arguments", turn: 1 },
      ]
    );
    // Successful outputs are exactly what the model received; failed calls carry none.
    assert.deepEqual(calls[0].output, provider.submitted[0][0].output);
    assert.deepEqual(calls[1].output, provider.submitted[0][1].output);
    assert.ok(!("output" in calls[2]) && !("output" in calls[3]));

    const completed = events.at(-1)!;
    assert.equal(completed.type, "request_completed");
    if (completed.type === "request_completed") {
      assert.equal(completed.success, true);
      assert.equal(completed.failureCategory, null);
      assert.equal(completed.modelTurns, 2);
      assert.equal(completed.toolCallCount, 4);
      assert.equal(completed.promptVersion, "coach-v5");
      assert.deepEqual(completed.usage, { inputTokens: 200, outputTokens: 40, totalTokens: 240 });
    }
  });

  it("exposes only metadata keys: no messages, history, prompts or answers", async () => {
    const events: CoachObserverEvent[] = [];
    await observe((event) => events.push(event));

    const keys = new Set(events.flatMap((event) => Object.keys(event)));
    for (const forbidden of ["message", "history", "systemPrompt", "answer", "response", "reasoning", "userId"]) {
      assert.ok(!keys.has(forbidden), `observer events expose ${forbidden}`);
    }
    assert.ok(!JSON.stringify(events).includes("How is my weight?"));
  });

  it("without an observer, the request, the model's input and the response are unchanged", async () => {
    const withoutObserver = await observe();
    const withObserver = await observe(() => undefined);

    assert.deepEqual(withObserver.result, withoutObserver.result);
    assert.deepEqual(withObserver.provider.submitted, withoutObserver.provider.submitted);
    assert.deepEqual(withObserver.provider.requests[0].tools.map((tool) => tool.name), withoutObserver.provider.requests[0].tools.map((tool) => tool.name));
    assert.equal(withObserver.provider.requests[0].systemPrompt, withoutObserver.provider.requests[0].systemPrompt);
  });

  it("cannot alter tool results: it receives copies", async () => {
    const { provider, result } = await observe((event) => {
      if (event.type === "tool_call" && event.output && typeof event.output === "object") {
        const output = event.output as Record<string, unknown>;
        output.today = "1999-01-01";
        delete output.latestCheckIn;
      }
    });

    const sent = provider.submitted[0][0].output as Record<string, unknown>;
    assert.equal(sent.today, TODAY);
    assert.equal((sent.latestCheckIn as { weightKg: number }).weightKg, 83.21);
    assert.deepEqual((provider.submitted[0][1].output as Record<string, unknown>).today, TODAY, "the cached copy is intact too");
    assert.deepEqual(result.response, ANSWER);
  });

  it("an observer that throws or rejects cannot fail the request", async () => {
    const throwing = await observe(() => {
      throw new Error("observer bug");
    });
    assert.deepEqual(throwing.result.response, ANSWER);

    const rejecting = await observe((async () => {
      throw new Error("async observer bug");
    }) as unknown as (event: CoachObserverEvent) => void);
    assert.deepEqual(rejecting.result.response, ANSWER);
  });

  it("reports failures with their category", async () => {
    const events: CoachObserverEvent[] = [];
    setModelProvider(new ScriptedProvider([() => { throw new ModelProviderError("down", "timeout"); }]));

    await assert.rejects(generateCoachResponse(user.id, request, { observer: (event) => events.push(event) }));

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "request_completed");
    if (events[0].type === "request_completed") {
      assert.equal(events[0].success, false);
      assert.equal(events[0].failureCategory, "timeout");
    }
  });

  it("never adds tool output or messages to the logs", async () => {
    const logs: unknown[] = [];
    const original = { info: console.info, error: console.error };
    console.info = (...args: unknown[]) => logs.push(args);
    console.error = (...args: unknown[]) => logs.push(args);
    try {
      await observe(() => undefined);
    } finally {
      console.info = original.info;
      console.error = original.error;
    }

    const text = JSON.stringify(logs);
    for (const secret of ["83.21", "weightKg", "latestCheckIn", "How is my weight?", "Steady."]) {
      assert.ok(!text.includes(secret), `logs contain ${secret}`);
    }
    assert.equal((logs.flat() as { event?: string }[]).filter((entry) => entry.event === "ai.tool.completed").length, 4);
  });
});
