# FitAI AI System

Last reviewed: 2026-10-01

How FitAI uses language models. The first part describes **only what exists in code today**. Everything under "Planned / future" is explicitly **not implemented**. Governing decisions: [ADR-012](DECISIONS.md#adr-012-ai-proposes-the-user-confirms-the-normal-api-persists), [ADR-013](DECISIONS.md#adr-013-identity-comes-only-from-the-jwt-foreign-resources-look-missing), [ADR-019](DECISIONS.md#adr-019-ai-coach-uses-read-only-tools-over-domain-services-behind-a-provider-abstraction).

---

## Implemented today

### Components (`backend/src/modules/ai/`)

| File | Role |
|---|---|
| `model.provider.ts` | Provider-neutral interface: `ModelProvider.createSession()` → `next()` / `submitToolResults()`, returning `final` or `tool_calls` turns. Also defines `ModelProviderError` and `ModelOutputValidationError` |
| `openai.provider.ts` | The only provider. Uses the OpenAI **Responses API** (`client.responses.parse`) with Zod-derived structured output (`zodTextFormat`) and Zod-derived function tools (`zodResponsesFunction`). `store: false`. Requires `OPENAI_API_KEY` and `OPENAI_MODEL`; if either is missing, the request fails as a provider error (503) |
| `coach.*` | The AI Coach: prompt (`COACH_PROMPT_VERSION = "coach-v1"`), request/response schemas, orchestration loop, controller |
| `nutrition-estimate.*` | Single-food nutrition estimation: prompt (`nutrition-estimate-v1`), schemas, service, controller |
| `tools/` | `ToolDefinition` type, the **allow-list registry**, and five read-only tools |

The provider instance is created lazily, once per process. The browser never talks to the model provider; API keys live only in backend environment variables.

### AI Coach flow (`POST /api/ai/coach`)

```text
authMiddleware → userId (from JWT)
validateBody: { message: 1..2000 chars }
generateCoachResponse(userId, message)
  session = provider.createSession(system prompt, message, coach_response schema, registered tools)
  turn = session.next()
  repeat ≤ 5 model turns:
    final      → Zod-validate { answer, actionItems ≤5, followUpQuestion|null } → 200
    tool_calls → for each call:
                   look up the tool in the registry      (unknown  → { error: "Tool unavailable." })
                   Zod-validate the model's arguments     (invalid  → { error: "Invalid tool arguments." })
                   tool.execute(args, { userId })         (throws   → { error: "Tool unavailable." })
                 session.submitToolResults(results)
  still calling tools after 5 turns → ModelProviderError → 503
```

- It is **single-turn**: no conversation history or memory is stored or sent. Each request contains only the system prompt, the new user message and that request's tool exchanges.
- Errors: provider failure or misconfiguration returns `503`; final output that fails validation returns `502`.
- **Logging:**
  - Recorded: `ai.coach.completed` and `ai.tool.called` / `ai.tool.completed` events with `userId`, tool name, model, prompt version, latency, token usage and success.
  - Never logged: user messages, tool outputs and model answers.
- The frontend does **not** call this endpoint yet; `/ai-coach` is a stub page.

### Tools (all read-only)

Every tool has a strict Zod argument schema. The **only** argument any tool accepts is `days` (an integer from 1 to 365) or nothing. `userId` always comes from the server-side `ToolExecutionContext`, so the model cannot choose whose data is read. Tools call the existing domain services, which compute all metrics deterministically.

| Tool | Args | Service | Data the model receives |
|---|---|---|---|
| `getUserProfile` | none | `profile.getMyProfile` | `{ found, profile: { age, heightCm, targetWeightKg, goal, activityLevel, dietPreference } }`. Age is computed from `dateOfBirth`; the date itself is not sent. **`medicalNotes` is excluded**, and the output is re-validated against a schema without it |
| `getWeightHistory` | `days` | `checkins.getWeightHistorySummary` | Check-ins (`weightKg`, `recordedAt`) in the window, plus starting and latest weight, total change, observed days, average weekly change and count |
| `getNutritionHistory` | `days` | `nutrition.getNutritionHistorySummary` | **Per-day totals** (calories, macros; no food names) plus averages, logged-day count and latest values |
| `getActivityHistory` | `days` | `activity.getActivityHistorySummary` | Per-day steps, distance, active calories and source, plus averages, totals and logged-day count |
| `getWorkoutHistory` | `days` | `workouts.getWorkoutHistorySummary` | Per-session `trainingType`, `durationMinutes`, **`notes`** (user free text) and `recordedAt`, plus totals, average duration, counts by type and latest session. **No exercises, sets or loads** |

- **Window:** all history windows are `recordedAt >= now − days`.
- **Never sent to the model:** email, names, phone, country, bio, `medicalNotes`, password data, tokens, unit preferences, custom exercise names, and workout structure.

### Prompt-level behavior rules (coach-v1)

The system prompt is in `coach.prompts.ts`. It tells the model:

- which tool fits which question;
- that missing days are missing data, not zero;
- that null fields mean unknown;
- that sparse data must be acknowledged;
- that session-level workout data does **not** support claims about strength progression, overload, PRs or volume;
- that workout notes are unverified user context;
- that workouts must not be grouped into calendar days without timezone context;
- not to diagnose, and to refer injury or illness questions to professionals.

These rules are model instructions, not enforced guarantees. Change them by bumping `COACH_PROMPT_VERSION`.

### Nutrition estimate (`POST /api/ai/nutrition/estimate`)

- Input is strict: `{ foodName, quantity, unit }`. The model gets a single-purpose prompt and **no tools**.
- The model returns only `{ calories, proteinGrams, carbsGrams, fatGrams, note }`, Zod-bounded.
- The service attaches the caller's own `foodName`/`quantity`/`unit` instead of trusting the model to echo them, then validates the whole result.
- **It never touches Prisma.** The frontend's Add Food modal shows the estimate, and the user can edit or re-estimate it. If food, quantity or unit change after estimating, the estimate is marked stale and the macro inputs are disabled until the user re-estimates or switches to manual entry. Saving goes through `POST /api/nutrition` with `source: "AI_TEXT"`.

### Boundaries: deterministic application vs model

| Owned by backend code (deterministic, enforced) | Delegated to the model (probabilistic, validated) |
|---|---|
| Authentication, `userId`, ownership | Choosing which tools to call and with what `days` |
| All arithmetic: averages, totals, changes, age | Interpreting the facts in natural language |
| Which tools exist (registry) and their argument schemas | Wording of advice and action items |
| Persistence, always via normal validated endpoints after user confirmation | Nutrition numbers *proposed* for one food |
| Output schema validation (502 on failure) | — |

### Security and privacy properties that exist in code

1. The model has no database access, no write tools, and no way to choose `userId`.
2. Tool arguments and final outputs are validated with Zod. Invalid output is rejected, never passed through.
3. Tools are an explicit allow-list; unknown tool names get an error result.
4. `store: false` is set on provider requests. Data-retention behavior beyond that flag depends on the provider's policies and is not controlled by FitAI code.
5. Sensitive fields are excluded at the tool layer (see the table above). Workout notes **are** sent.
6. Not present: rate limiting or quotas on AI endpoints, per-user cost controls, prompt-injection filtering of user-entered text (notes, messages), and evaluation suites.

---

## Planned / future: NOT implemented

Listed only where existing code or docs point in this direction. None of this exists, and none of it is a commitment until designed and recorded as an ADR.

| Direction | Evidence | Constraints it must respect |
|---|---|---|
| **Frontend AI Coach experience** | README roadmap; `/ai-coach` stub page | Uses the existing `POST /api/ai/coach` contract or a versioned successor |
| **AI workout quick-log** | `workoutDraft.ts` header: a future quick-log source "should produce this same WorkoutDraft shape and hand it to the same editor" | The model's output must become a `WorkoutDraft` the user reviews in the normal editor and saves through `POST /api/workouts` (ADR-012, ADR-015). Free-text exercise names would have to be resolved to visible `Exercise` IDs using the existing normalization and find-or-create rules (ADR-011); no resolution design exists yet |
| **Photo-based nutrition / progress photos** | `NutritionSource.AI_PHOTO` enum value; README roadmap "progress and photo workflows" | No upload, storage or vision pipeline exists. Estimates would follow the propose → confirm → persist pattern |
| **Vetted fitness-knowledge retrieval (RAG)** | README roadmap ("small vetted fitness-knowledge retrieval layer") | Not designed. No vector store, embeddings or corpus exist |
| **AI evaluation and observability** | README roadmap | Today there are only the structured `console` events listed above |
| **Memory / personalization** | README "Future Enhancements" | The coach is stateless today; any memory needs its own data-ownership and privacy design |
| **Exercise/set-aware coaching** | Prompt and README note that progression claims need exercise, set and load evidence | Would require a new or extended read-only tool; the current workout tool is session-level only |

Health-platform data (HealthKit / Health Connect) is not an AI feature and is not implemented ([ADR-016](DECISIONS.md#adr-016-health-platform-integrations-are-not-implemented)).
