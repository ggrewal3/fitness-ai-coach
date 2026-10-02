// The real OpenAI adapter against a local fake Responses API (no key, no
// network): request shape, tool-call pairing, parsing, refusals and retries.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import { generateCoachResponse, setModelProvider } from "../src/modules/ai/coach.service.js";
import { ModelOutputValidationError, ModelProviderError } from "../src/modules/ai/model.provider.js";
import { estimateNutrition } from "../src/modules/ai/nutrition-estimate.service.js";
import { OpenAIProvider } from "../src/modules/ai/openai.provider.js";
import {
  createApi,
  createTestUser,
  deleteTestUsers,
  startTestServer,
  type TestServer,
  type TestUser,
} from "./helpers.js";

type Reply = { status?: number; body: unknown };

let fake: Server;
let replies: Reply[] = [];
const received: any[] = [];
const savedEnv = { ...process.env };

let app: TestServer;
let user: TestUser;
const createdUserIds: number[] = [];

const ANSWER = { answer: "Steady progress.", actionItems: ["Keep logging."], followUpQuestion: null };
const response = (output: unknown[], usage?: unknown) => ({
  id: `resp_${received.length}`,
  object: "response",
  model: "test-model",
  status: "completed",
  output,
  ...(usage ? { usage } : {}),
});
const message = (content: unknown[]) => ({ type: "message", id: "msg_1", role: "assistant", status: "completed", content });
const text = (value: unknown) => message([{ type: "output_text", text: JSON.stringify(value), annotations: [] }]);
const functionCall = (callId: string, name: string, args: string) => ({
  type: "function_call",
  id: `fc_${callId}`,
  call_id: callId,
  name,
  arguments: args,
  status: "completed",
});
const request = { message: "How is my weight?", clientContext: { today: "2026-06-15", timeZone: "UTC" } };

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ path: req.url, body: JSON.parse(body) });
      const reply = replies.shift() ?? { status: 500, body: { error: { message: "no scripted reply" } } };
      res.writeHead(reply.status ?? 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const { port } = fake.address() as AddressInfo;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.OPENAI_API_KEY = "test-key-not-real";
  process.env.OPENAI_MODEL = "test-model";

  app = await startTestServer();
  user = await createTestUser(createApi(app.baseUrl), createdUserIds);
});

afterEach(() => {
  replies = [];
  received.length = 0;
  setModelProvider(undefined);
});

after(async () => {
  process.env = savedEnv;
  await deleteTestUsers(createdUserIds);
  await app.close();
  await new Promise<void>((resolve) => fake.close(() => resolve()));
});

describe("OpenAI adapter", () => {
  it("sends strict tools and format, pairs tool results by call_id and parses the final JSON", async () => {
    setModelProvider(new OpenAIProvider());
    replies = [
      // No usage on the first response: must be tolerated.
      { body: response([functionCall("call_a", "getWeightHistory", '{"days":7}'), functionCall("call_b", "getWeightHistory", "{not json")]) },
      { body: response([text(ANSWER)], { input_tokens: 10, output_tokens: 5, total_tokens: 15 }) },
    ];

    const result = await generateCoachResponse(user.id, request);

    assert.deepEqual(result.response, ANSWER);
    assert.equal(received.length, 2);
    const first = received[0].body;
    assert.equal(received[0].path, "/v1/responses");
    assert.equal(first.model, "test-model");
    assert.equal(first.store, false);
    assert.match(first.instructions, /Today is 2026-06-15/);
    assert.equal(first.text.format.type, "json_schema");
    assert.equal(first.text.format.strict, true);
    const weightTool = first.tools.find((tool: any) => tool.name === "getWeightHistory");
    assert.equal(weightTool.type, "function");
    assert.equal(weightTool.strict, true);
    assert.equal(weightTool.parameters.additionalProperties, false);
    assert.ok(!("$brand" in weightTool) && !("$parseRaw" in weightTool));

    const outputs = received[1].body.input.filter((item: any) => item.type === "function_call_output");
    assert.deepEqual(outputs.map((item: any) => item.call_id), ["call_a", "call_b"]);
    assert.ok("comparison" in JSON.parse(outputs[0].output));
    assert.deepEqual(JSON.parse(outputs[1].output), { error: "Invalid tool arguments." });
  });

  it("treats refusals and unparseable output as invalid output", async () => {
    setModelProvider(new OpenAIProvider());
    replies = [{ body: response([message([{ type: "refusal", refusal: "I can't help with that." }])]) }];
    await assert.rejects(generateCoachResponse(user.id, request), ModelOutputValidationError);

    replies = [{ body: response([message([{ type: "output_text", text: "not json", annotations: [] }])]) }];
    await assert.rejects(generateCoachResponse(user.id, request), ModelOutputValidationError);
  });

  it("retries a failed call once, then fails as a provider error", async () => {
    setModelProvider(new OpenAIProvider());
    replies = [
      { status: 500, body: { error: { message: "internal provider detail" } } },
      { status: 500, body: { error: { message: "internal provider detail" } } },
      { body: response([text(ANSWER)]) },
    ];

    await assert.rejects(generateCoachResponse(user.id, request), (error: unknown) => error instanceof ModelProviderError && error.category === "provider_error");
    assert.equal(received.length, 2, "one attempt plus one retry");
  });

  it("still serves nutrition estimates through the shared adapter", async () => {
    replies = [{ body: response([text({ calories: 210, proteinGrams: 7, carbsGrams: 27, fatGrams: 8, note: "Estimate." })]) }];

    const result = await estimateNutrition(user.id, { foodName: "Granola", quantity: 50, unit: "g" });

    assert.deepEqual(result, { foodName: "Granola", quantity: 50, unit: "g", calories: 210, proteinGrams: 7, carbsGrams: 27, fatGrams: 8, note: "Estimate." });
    assert.deepEqual(received[0].body.tools, []);
    assert.equal(received[0].body.text.format.name, "nutrition_estimate");
  });
});
