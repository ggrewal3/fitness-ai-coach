# FitAI Engineering Decisions

Last reviewed: 2026-10-04

Architecture decision records (ADRs) explaining **why** FitAI is built the way it is. The current system is described in [ARCHITECTURE.md](ARCHITECTURE.md).

## Rules

- IDs are permanent: never renumber or reuse them. New decisions get the next number.
- Never rewrite an Accepted ADR to mean something else. To change a decision: get approval, add a new ADR, set the old one to `Superseded by ADR-NNN`, and set the new one to `Supersedes ADR-NNN`.
- Status values: `Proposed`, `Accepted`, `Superseded`, `Deprecated`.
- **Sources.** These ADRs were recovered on 2026-10-01 from code, code comments, schema comments, the README, and the design reviews approved for Settings Phases 1–2 (2026-09-29). Where none of those records *why* a choice was made, the ADR says **Rationale not recorded** instead of guessing.

## Index

| ID | Title | Status |
|---|---|---|
| ADR-001 | PostgreSQL is the primary database | Accepted |
| ADR-002 | Prisma is the data-access layer and migration tool | Accepted |
| ADR-003 | React + TypeScript SPA and Express + TypeScript API | Accepted |
| ADR-004 | Stateless JWT bearer authentication | Accepted |
| ADR-005 | Separate User, FitnessProfile and UserPreference | Accepted |
| ADR-006 | Canonical metric storage; units are display preferences only | Accepted |
| ADR-007 | Workout sets keep the unit they were entered in | Accepted |
| ADR-008 | Structured workouts: WorkoutSession → WorkoutExercise → WorkoutSet | Accepted |
| ADR-009 | Workout edits replace nested exercises and sets transactionally | Accepted |
| ADR-010 | Shared built-in exercises and private custom exercises | Accepted |
| ADR-011 | Exercise names are normalized and creation is find-or-create | Accepted |
| ADR-012 | AI proposes, the user confirms, the normal API persists | Accepted |
| ADR-013 | Identity comes only from the JWT; foreign resources look missing | Accepted |
| ADR-014 | The workout editor is a page, not a modal | Accepted |
| ADR-015 | A single shared WorkoutDraft model for workout entry | Accepted |
| ADR-016 | Health-platform integrations are not implemented | Accepted |
| ADR-017 | Theme preference is browser-local and resolved before first paint | Accepted |
| ADR-018 | Semantic CSS colour tokens with an exact Light baseline | Accepted |
| ADR-019 | AI Coach uses read-only tools over domain services behind a provider abstraction | Accepted |
| ADR-020 | Emails are normalized to lowercase and read-only after registration | Accepted |
| ADR-021 | Logical calendar dates are separate from recorded timestamps | Accepted |
| ADR-022 | Backend tests run against a separate real PostgreSQL database | Accepted |
| ADR-023 | Nutrition is stored per food item, not per day | Accepted |
| ADR-024 | Private profile-photo object storage | Accepted |
| ADR-025 | The AI Coach is anchored to the client's local date and timezone | Accepted |
| ADR-026 | AI Coach conversation context is client-held, bounded and untrusted | Accepted |
| ADR-027 | Live AI Coach evaluation is opt-in, isolated and deterministic-first | Accepted |
| ADR-028 | Social sign-in proves identity; FitAI owns the account and session | Accepted |

---

## ADR-001: PostgreSQL is the primary database

**Status:** Accepted

- **Context:** FitAI stores relational, user-owned data (users, profiles, logs, workouts with nested exercises and sets) that needs referential integrity and transactions.
- **Decision:** PostgreSQL (17, run locally with Docker Compose) is the only datastore.
- **Rationale:** Not recorded beyond the README's technology stack. The implementation relies on PostgreSQL features: foreign keys with cascades, `DATE` columns, `Decimal(6,2)`, unique constraints used for race detection, and `SELECT … FOR UPDATE` row locks.
- **Consequences:** There is no cache or secondary store. Postgres-specific SQL (the row lock, migration backfills) ties the code to PostgreSQL.

## ADR-002: Prisma is the data-access layer and migration tool

**Status:** Accepted

- **Decision:**
  - All database access goes through Prisma Client (Prisma 7, `prisma-client` generator, `@prisma/adapter-pg`).
  - Schema changes are Prisma migrations committed under `backend/prisma/migrations/`.
  - Raw SQL is used only where Prisma cannot express something; the one runtime case is the `FOR UPDATE` lock in workout updates.
- **Rationale:** Not recorded.
- **Consequences:**
  - `schema.prisma` is the executable source of truth for the model.
  - Migrations are additive and reviewed. Data-changing migrations include guards and backfills: for example, the email-lowercasing migration aborts on case-insensitive duplicates, and the structured-workout migration backfills `title`/`workoutDate`.
  - Never reset a shared database (see [DEVELOPMENT.md](DEVELOPMENT.md)).

## ADR-003: React + TypeScript SPA and Express + TypeScript API

**Status:** Accepted

- **Decision:**
  - The frontend is a React 19 + TypeScript SPA (Vite, react-router-dom). It uses React state and context only, with no global state library.
  - The backend is an Express 5 + TypeScript REST API with Zod validation.
  - Both are separate npm packages.
- **Rationale:** Not recorded. The "no global state library" rule is a standing project constraint.
- **Consequences:**
  - Types are not shared between packages. Frontend request/response types in `services/api.ts` are hand-maintained mirrors, and so are frontend validation limits (e.g. `WORKOUT_LIMITS`).
  - **The backend is authoritative for validation.**

## ADR-004: Stateless JWT bearer authentication

**Status:** Accepted

- **Decision:**
  - Login issues a JWT `{ userId }` signed with `JWT_SECRET`, valid for 1 hour.
  - The API reads it from `Authorization: Bearer`.
  - The frontend stores it in `sessionStorage` and clears it on any 401.
  - There are no refresh tokens and no server-side sessions.
- **Rationale:** Not recorded for the original choice. Session invalidation (for example a `passwordChangedAt` check) was explicitly deferred in the Settings Phase 1 review.
- **Consequences:**
  - A token stays valid until it expires, even after a password change or account deletion; no endpoint for either exists yet.
  - The middleware does not check that the user still exists, so services must handle a deleted user (the account routes return 404).
  - Each browser tab is a separate session.
- **Amendment (2026-10-04, Phase 5A-1):** implementation detail only; the decision is unchanged.
  - Token issuing and verification live in `modules/auth/session.ts` (`issueSessionToken`, `verifySessionToken`). The contract is unchanged: payload `{ userId }`, HS256, `JWT_SECRET`, valid for 1 hour.
  - Verification is now pinned to HS256: tokens signed with any other algorithm, or unsigned, are rejected (401).
  - Planned Google and Apple sign-in will issue this same token ([ADR-028](#adr-028-social-sign-in-proves-identity-fitai-owns-the-account-and-session)).

## ADR-005: Separate User, FitnessProfile and UserPreference

**Status:** Accepted

- **Context:** Identity, coaching context and display preferences change for different reasons and have different privacy rules.
- **Decision:**
  - `User` holds identity, credentials and contact details: names, email, phone, country, bio.
  - `FitnessProfile` (optional 1:1) holds coaching inputs, including sensitive `medicalNotes`.
  - `UserPreference` (optional 1:1) holds unit preferences.
  - Missing rows have defined meanings: no profile means unknown coaching facts; no preference row means the defaults KG / LB / CM. Reading never creates rows.
- **Rationale:**
  - The separate `UserPreference` model and the "no row until first change" behavior come from the Settings Phase 1 review. Existing users need no data migration, and preferences can be upserted independently.
  - The same review kept `medicalNotes` out of Settings V1 and reaffirmed its existing exclusion from the AI profile tool.
  - Why `FitnessProfile` was split from `User` originally is not recorded.
- **Consequences:**
  - Readers must apply defaults for missing preference rows.
  - All three cascade-delete with the user.
  - Future third-party connections (for example health platforms) should get their own model, not columns on `User`.
- **Amendment (2026-10-04, Phase 5A-1):** extends the split; the decision is unchanged.
  - External sign-in identities (Google, Apple) live in their own model, `AuthIdentity`, not as columns on `User` ([ADR-028](#adr-028-social-sign-in-proves-identity-fitai-owns-the-account-and-session)).
  - The password credential stays on `User` but is now optional (`passwordHash` nullable).
  - Sign-in identities and future health-platform connections are separate concerns and will be separate models.

## ADR-006: Canonical metric storage; units are display preferences only

**Status:** Accepted

- **Decision:**
  - Body weight and target weight are stored in kg, height in cm, walking distance in km.
  - `bodyWeightUnit`, `workoutLoadUnit` and `heightUnit` are display/input preferences.
  - Changing them must never modify stored values: check-ins, profile height and target weight, activity distance, workout sets, or any history.
  - Country never changes unit preferences.
- **Rationale (Settings Phase 1 review):** One canonical unit keeps backend analytics and AI summaries unit-free (for example `averageChangePerWeekKg`), and avoids lossy repeated conversion of historical data.
- **Consequences:**
  - Conversion happens only at the presentation and input edges. The exact factor is 1 lb = 0.45359237 kg.
  - Applying preferences in the UI was not implemented when this was accepted; see the amendment below.
  - Tests assert that preference changes leave stored data untouched.
- **Amendment (2026-10-02, Settings Phase 4):** implementation status only; the decision is unchanged.
  - The frontend now shows and accepts body weight (Progress, Dashboard, Settings target weight) and height (Settings) in the preferred units. Storage and the API stay canonical kg and cm.
  - A value is converted to canonical units only when the user actually edits it: lb → kg rounded to 0.01 kg, feet and inches → cm rounded to 0.1 cm. Values typed in kg or cm are sent as typed.
  - Values converted only for display are never written back. Measurement fields track whether the user edited them and are compared in the units they are shown in, so 80 kg shown as 176.4 lb, or 180 cm shown as 5 ft 11 in, is never re-sent as 80.01 kg or 180.3 cm.
  - Changing a preference still never rewrites stored or historical data.
- **Amendment (2026-10-02, AI Coach Phase 1A):** extends where display units apply; the decision is unchanged.
  - AI tool results stay canonical (`weightKg`, `heightCm`, `averageChangeKg`, …). Alongside them, tools add deterministic display strings in the user's preferred units (`displayWeight`, `displayHeight`, …), and the system prompt names the preferred units. The model quotes those strings instead of converting.
  - The backend's display helper (`lib/units/displayUnits.ts`) follows the same policy as the frontend, checked by a test. Signed changes round the magnitude, then apply the sign.
  - This replaces the earlier AI-SYSTEM.md rule that unit preferences are never sent to the model; they are non-sensitive display metadata.

## ADR-007: Workout sets keep the unit they were entered in

**Status:** Accepted

- **Decision:**
  - `WorkoutSet.load` (`Decimal(6,2)`) is stored exactly as entered, together with its own `loadUnit` (KG or LB).
  - A null load means bodyweight, and its unit must also be null.
  - Loads are never converted.
  - This is an intentional exception to ADR-006's canonical-kg rule.
- **Rationale:** Partly recorded. The schema comment states "stored exactly as entered", and the Settings review reaffirmed "never convert historical sets". The original motivation is not recorded. The observable effect is that what the user logged round-trips exactly, for example 225 lb stays 225 lb.
- **Consequences:**
  - Any cross-set analytics (volume, PRs) must normalize units at read time.
  - `workoutLoadUnit` only pre-selects the unit for new sets.
  - The editor default unit (`DEFAULT_LOAD_UNIT = "LB"`) was a frontend constant until Phase 4; see the amendment below.
- **Amendment (2026-10-02, Settings Phase 4):** implementation status only; the decision is unchanged.
  - `workoutLoadUnit` now sets the unit of the first set of a newly added exercise. The editor captures it when the workout draft is created, so a later preference change never alters an open editor.
  - "Add set" still copies the previous set's load and unit.
  - Existing sets keep their stored unit whatever the preference (100 kg × 8 stays 100 kg × 8 under an lb preference).
  - Changing a set's unit selector changes only the label: 100 kg becomes 100 lb, never 220.46 lb.
  - Workout history shows sets exactly as logged, with no conversion.

## ADR-008: Structured workouts: WorkoutSession → WorkoutExercise → WorkoutSet

**Status:** Accepted

- **Decision:**
  - A workout is an **event** (`WorkoutSession`), not a daily aggregate, so a day can hold several workouts.
  - It contains ordered `WorkoutExercise` rows, each referencing an `Exercise` by ID, each with ordered `WorkoutSet` rows.
  - Sessions may have zero exercises, which covers cardio and other session-only workouts.
- **Rationale (README):**
  - "Workouts are modeled as events rather than daily aggregates. This allows multiple workouts to exist on the same day."
  - The README's evidence-aware AI section notes that objective strength progression "would require additional information such as exercises, sets, reps, and loads".
  - The README states that exercises are referenced by stable ID rather than free text, but not why.
- **Consequences:**
  - Order is a server-assigned `position`, unique per parent.
  - `WorkoutExercise → Exercise` uses `ON DELETE NO ACTION` (checked at end of statement), so deleting a user can cascade through both their workouts and their custom exercises in one statement.
  - Timed and distance sets are not supported yet.

## ADR-009: Workout edits replace nested exercises and sets transactionally

**Status:** Accepted

- **Decision:**
  - `PATCH /api/workouts/:id` with `exercises` deletes and recreates every nested exercise and set. Without `exercises`, nested data is untouched.
  - The whole update runs in one transaction that first locks the owned session row with `SELECT … FOR UPDATE`.
- **Rationale:** Partly recorded in code comments: any failure leaves the previous workout fully intact, and concurrent edits of the same workout serialize. Why full replacement was preferred over per-row diffing is not recorded.
- **Consequences:**
  - `WorkoutExercise` and `WorkoutSet` IDs change on every full edit; they are not stable identifiers.
  - Clients must send the complete list. The frontend editor always does.

## ADR-010: Shared built-in exercises and private custom exercises

**Status:** Accepted

- **Decision:**
  - One `Exercise` table holds both kinds.
  - Built-ins have `userId = null` and a permanent `builtInKey`. They come from `exercise.catalog.ts` and are upserted idempotently by the seed. The API cannot create, change or delete them.
  - Custom exercises have `userId = owner` and are visible only to that owner.
  - A user's visible set is built-ins plus their own custom exercises (`visibleExerciseWhere`).
- **Rationale (catalogue and service comments):**
  - Workouts reference seeded rows, so a `builtInKey` must never change or be reused, and the seed never deletes entries.
  - Unknown and foreign exercise IDs are reported identically, so private exercises can't be probed.
- **Consequences:**
  - Renaming a built-in updates its row in place, keeping its ID.
  - Custom exercises are capped at 500 per user.
  - Postgres treats NULL `userId`s as distinct in the `(userId, normalizedName)` unique index, so built-in uniqueness is enforced by `builtInKey` and the seed's duplicate checks, not by that index.

## ADR-011: Exercise names are normalized and creation is find-or-create

**Status:** Accepted

- **Decision:**
  - Names get a display form (NFKC, trimmed, whitespace collapsed, case kept) and a `normalizedName` key (lower-cased, apostrophes removed, hyphens/underscores treated as spaces).
  - `POST /api/exercises` returns an existing matching built-in first, then the user's matching custom exercise, and only otherwise creates one (201 vs 200). Concurrent creates are resolved via the unique constraint.
  - Search ranking is deterministic.
- **Rationale (code comments):** Trivial variations should resolve to one exercise, and a matching built-in always wins over creating a redundant custom copy. Spelling variants, aliases and fuzzy matching were deliberately left out of V1.
- **Consequences:** "Pushup" and "Push-Up" are different keys. Future AI name resolution should reuse this normalization (see [AI-SYSTEM.md](AI-SYSTEM.md)).

## ADR-012: AI proposes, the user confirms, the normal API persists

**Status:** Accepted

- **Decision:**
  - AI output is never written to the database by the AI path.
  - AI endpoints are read/compute only. `POST /api/ai/nutrition/estimate` never touches Prisma, and the coach tools are read-only.
  - The user reviews and confirms the result; the frontend then saves it through the ordinary authenticated endpoint, which re-validates everything regardless of origin.
- **Rationale (nutrition-estimate service comment; standing project rule):** AI output is an estimate that may be wrong, so persisting it needs explicit user confirmation and the same validation as manual entry.
- **Consequences:**
  - Provenance is recorded with `NutritionFoodItem.source` (`AI_TEXT`).
  - Future AI features that create data (for example workout quick-log) must follow the same pattern.

## ADR-013: Identity comes only from the JWT; foreign resources look missing

**Status:** Accepted

- **Decision:**
  - The acting user is always `req.userId` from the verified token. No endpoint accepts `userId` from the client, and AI tools receive it from the request context, never from model arguments.
  - Every owned query is scoped by `userId`. Another user's resource returns 404, the same as a missing one.
- **Rationale (README security principles; code comments):** This prevents horizontal privilege escalation and resource probing.
- **Consequences:**
  - Strict schemas reject `userId` keys.
  - Mutations use `{ id, userId }` filters or ownership checks inside transactions.
  - Tests cover cross-user access for every domain that has tests.

## ADR-014: The workout editor is a page, not a modal

**Status:** Accepted

- **Decision:**
  - Creating and editing workouts uses dedicated routes, `/workout/new?date=YYYY-MM-DD` and `/workout/:id/edit`, rendering one shared `WorkoutEditor`.
  - The editor has a sticky Save bar and protects unsaved changes with `useBlocker` (in-app navigation, confirm dialog) and `beforeunload`.
  - By contrast, nutrition add/edit uses a modal (`AddFoodModal`).
- **Rationale:** Not recorded in the repository. The workout form is much larger than the food form (nested exercises and sets, an exercise picker, per-field errors); that explains the difference, but no rationale is recorded.
- **Consequences:** Workouts are deep-linkable and reload-safe. Unsaved-change protection must cover both router navigation and browser unload.

## ADR-015: A single shared WorkoutDraft model for workout entry

**Status:** Accepted

- **Decision:**
  - `features/workout/workoutDraft.ts` defines `WorkoutDraft`, the single editable representation of a workout in the frontend.
  - Manual entry changes it only through `workoutDraftReducer`.
  - Drafts are converted to API payloads only when saving.
- **Rationale (module header comment):** Any future source of a workout, such as a quick-log feature, should produce the same `WorkoutDraft` and hand it to the same editor; there is no source-specific editor state.
- **Consequences:**
  - New workout entry paths must build a `WorkoutDraft` rather than a parallel model.
  - Inputs stay raw strings until save, so validation messages map to draft fields.

## ADR-016: Health-platform integrations are not implemented

**Status:** Accepted

- **Context:** The README lists Apple HealthKit and Android Health Connect as future enhancements. `ActivitySource` already contains `APPLE_HEALTH` and `HEALTH_CONNECT`.
- **Decision:**
  - No health integration exists, and none may be faked: no placeholder connections, tokens or "connected" states.
  - Activity is entered manually (`source = MANUAL`).
  - Any future provider credentials belong in a dedicated connection model, not on `User`.
- **Rationale (Settings Phase 1 review):** HealthKit and Health Connect are on-device platform APIs that a web app cannot call directly, so a native component would be required. Google Fit's APIs are deprecated.
- **Consequences:** Settings may only describe health integrations as unavailable. Implementing one needs a new ADR covering the native layer and data ownership.

## ADR-017: Theme preference is browser-local and resolved before first paint

**Status:** Accepted

- **Decision:**
  - The preference (`system` | `light` | `dark`, default `system`) lives only in `localStorage["fitai.theme"]`, never in the database or API.
  - `<html data-theme>` always holds the resolved `light` | `dark`, never `system`, and `color-scheme` matches.
  - An inline script in `index.html` applies it before CSS and React load.
  - `ThemeProvider` keeps it in sync: it follows the OS live via `matchMedia` + `useSyncExternalStore`, and other tabs via the `storage` event.
- **Rationale (Settings Phase 2 review):**
  - Theme is a per-device presentation concern.
  - It must apply before authentication or any API call completes; otherwise the wrong theme would flash.
  - A React effect runs too late for the first paint.
  - CSS only needs the visual theme, so `system` is resolved in JavaScript.
- **Consequences:**
  - The inline script duplicates a few constants from `features/theme/theme.ts`; the two must be kept in sync.
  - The preference does not roam between devices.
  - Invalid or inaccessible storage falls back to `system`.

## ADR-018: Semantic CSS colour tokens with an exact Light baseline

**Status:** Accepted

- **Decision:**
  - All colours in `index.css` come from semantic custom properties: 61 tokens defined on `:root` (Light), with overrides on `:root[data-theme="dark"]`.
  - Component rules never contain colour literals and never define colours inside theme blocks.
  - Distinct historical literals keep separate tokens even when near-identical, and one literal used for different purposes gets different tokens.
  - The Dark palette is designed, not inverted.
- **Rationale (Settings Phase 2 review):**
  - The token migration had to be provably non-visual: Light was verified pixel-identical to the pre-token UI.
  - Semantic names let Dark diverge per purpose.
- **Consequences:**
  - New UI must use existing tokens or add a token to both theme blocks.
  - Merging near-duplicate tokens is a deliberate visual change that needs approval.
  - Known Light contrast shortfalls were preserved, and are tracked separately.
- **Amendment (2026-10-01, Settings Phase 3A):** this extends the decision without changing it.
  - Two tokens were added for new UI: `--color-focus-ring` and `--color-success-soft`, giving 63.
  - The two token blocks also match `[data-theme-preview]`, so a single element can render one theme's palette (Settings theme previews) without duplicating values.
  - Light rendering of every pre-existing screen was re-verified pixel-identical.

## ADR-019: AI Coach uses read-only tools over domain services behind a provider abstraction

**Status:** Accepted

- **Decision:**
  - The coach runs a bounded loop (at most 5 model turns). The model may call allow-listed tools (`tools/tool.registry.ts`).
  - Each tool validates its arguments with a strict Zod schema, receives `userId` from the server context, and calls the existing domain service.
  - Metrics are computed deterministically in services.
  - Final output must match a Zod schema.
  - Provider-specific code (OpenAI Responses API, `store: false`) sits behind `ModelProvider`.
- **Rationale (README):**
  - Authentication, authorization, business rules and calculations stay under backend control; the model only interprets safe data.
  - Provider behavior is isolated from the rest of the app.
- **Consequences:**
  - The model never has database access.
  - Tool failures return error objects to the model rather than throwing.
  - Adding a capability means adding a reviewed tool, not widening model access.
- **Amendment (2026-10-02, AI Coach Phase 1A):** corrects and hardens the loop; the decision is unchanged.
  - The loop actually made up to 6 provider calls and discarded the 6th response even when it was a valid answer. It now makes at most **5 provider calls**: a final answer on the 5th is accepted, and a further tool request on the 5th fails the request (502).
  - New caps: at most 4 tool calls per model turn and 8 per request (extra calls get an error result), `days` at most 90, and one tool result at most 32,000 serialized characters. Identical calls in one request reuse the first result.
  - Malformed tool arguments now become an error result instead of failing the whole request: the adapter uses `responses.create` with plain JSON tool definitions and FitAI parses the arguments.
  - The provider has an explicit 25-second timeout and one retry, and the whole request has a 45-second deadline (504). The coach route has a per-user rate limit (429).
  - Logs gain a request ID, turn and tool-call counts, tool names, `days`, outcomes and failure categories; still no message text or tool output.
- **Amendment (2026-10-04, AI Coach Phase 1D-B):** raises the per-turn tool-call cap from 4 to 5; the decision is unchanged.
  - **Before:** the 1A amendment set 4 tool calls per model turn, 8 per request and 5 provider calls.
  - **coach-v3 evidence** (live evaluation, ADR-027; `gpt-5.6-terra`, fixtures `1d-a.1`; baseline `20261003t145739z-482b49`, repeats `20261003t150501z-a3dbc0`): for the broad questions S11 and S14, the model asked for all five tools in one turn in 6 of 6 samples. The cap refused the fifth each time. Recovering cost an extra provider turn, and one S14 answer came back without workout data.
  - **coach-v4 tried prompt-level splitting** ("at most 4 tool calls in one turn"; the refusal invited a retry next turn). In Stage 1 (`20261003t153357z-2939c4`), five-tool requests fell to 2 of 6. However, neither refusal was recovered (0 of 2), and required data was missing in 3 of 6 S11/S14 samples: workouts skipped after a refusal twice, and nutrition silently skipped once to stay within 4.
  - **Decision:** there are exactly five coach tools, so up to 5 tool calls are honored per model turn. The limits of 8 tool calls per request and 5 provider calls are unchanged, as is everything else in the loop (extra calls still get an error result). The prompt drops the splitting instruction (coach-v5).
  - **Purpose:** a question that needs every kind of data can be answered completely in one tool round. One extra call per turn barely relaxes the overall guard: each result stays at most 32,000 characters, and the 8-per-request and 5-provider-call caps still bound the whole request.

## ADR-020: Emails are normalized to lowercase and read-only after registration

**Status:** Accepted

- **Decision:**
  - Registration and login trim and lower-case emails.
  - Migration `20260929100000_add_account_settings` lower-cased existing rows, aborting if there were case-insensitive duplicates.
  - Email cannot be changed through the account API, and there is no email verification.
- **Rationale (Settings Phase 1 review):**
  - Case variants must not create duplicate accounts.
  - Changing email safely needs verification and re-authentication, which the current architecture does not have (see ADR-004).
- **Consequences:**
  - The `User.email` unique index is effectively case-insensitive, given normalization.
  - An email-change feature needs its own design and ADR.

## ADR-021: Logical calendar dates are separate from recorded timestamps

**Status:** Accepted

- **Decision:**
  - Nutrition `entryDate` and workout `workoutDate` are client-chosen `YYYY-MM-DD` days, stored in `DATE` columns at UTC midnight by string concatenation.
  - These are independent of the `recordedAt` timestamp.
  - Activity derives `activityDate` from the date prefix of the client's `recordedAt`.
- **Rationale (code comments):** The logical day and the moment of recording are different domain concepts. Constructing the date by concatenation means it cannot shift with server or client timezones.
- **Consequences:**
  - The server never decides a user's "today"; the client does.
  - AI history windows use `recordedAt`, and the coach prompt forbids grouping workouts into calendar days without timezone context.
- **Amendment (2026-10-02, AI Coach Phase 1A):** the last consequence changed; the decision is unchanged.
  - AI tools now use logical dates: nutrition by `entryDate`, workouts by `workoutDate`, activity by `activityDate`, anchored to the client's validated `today` ([ADR-025](#adr-025-the-ai-coach-is-anchored-to-the-clients-local-date-and-timezone)). The earlier nutrition summary selected rows by `recordedAt` but grouped them by `entryDate`, which could misplace backfilled items.
  - Weight check-ins have only `recordedAt`; they are placed on the user's calendar with the client's IANA timezone.
  - The server still never decides the user's "today".

## ADR-022: Backend tests run against a separate real PostgreSQL database

**Status:** Accepted

- **Decision:**
  - Backend tests use Node's test runner against the real Express app and a dedicated PostgreSQL database given by `TEST_DATABASE_URL`, never the development database.
  - The runner refuses to start without it, or if it points at the development database.
  - The runner applies migrations and seeds before running files serially.
- **Rationale (runner comments):** Tests must exercise real constraints, transactions and cascades without risking development data. The connection string must never be committed or put in `.env`.
- **Consequences:**
  - Tests need a running Postgres.
  - Test data is created through the API and removed by deleting test users.
  - There are no frontend automated tests.

## ADR-023: Nutrition is stored per food item, not per day

**Status:** Accepted

- **Decision:**
  - Nutrition is stored as one `NutritionFoodItem` per logged food: quantity, unit, calories and macros, `mealType`, `source`, `entryDate`.
  - Daily totals are computed on read.
  - Migration `20260925125036_replace_nutrition_entry_with_food_items` replaced the earlier per-day `NutritionEntry` table. It dropped the table, so any existing rows were not carried over.
- **Rationale:** Not recorded. Observed effect, not a recorded reason: the per-item model is what the current per-item AI estimates (with `source` provenance) and the meal-grouped Nutrition UI are built on.
- **Consequences:** The daily summary and the AI nutrition tool aggregate items by `entryDate`. "Logged days" means days with at least one item.

## ADR-024: Private profile-photo object storage

**Status:** Accepted (2026-10-01, Settings Phase 3B)

- **Context:** Users need one profile photo that they can add, replace and remove. FitAI is a health app, so photos are personal data. There was no file storage of any kind, and production object storage (AWS) is planned but not configured.
- **Decision:**
  - **Database stores a key, not the image:** `User.avatarKey` holds an opaque, server-generated storage key (`avatars/<uuid>.webp`). Never image bytes, base64, the original filename or a permanent URL. The key is never sent to clients.
  - **Storage abstraction:** account code depends only on `ObjectStorage` (`put`, `delete`, `getReadUrl`) in `backend/src/lib/storage/`. `LocalObjectStorage` implements it today, as private files under `backend/storage/` (git-ignored and never served statically). An S3-compatible adapter can implement the same interface later.
  - **Only a processed image is stored:** uploads (JPEG, PNG or WebP, max 5 MB) are decoded by `sharp` and re-encoded.
    - The decoded format must match the declared `Content-Type`.
    - Images are limited to 8000 px per side and 40 MP, checked from the header before decoding.
    - EXIF orientation is applied, then the image is **centre-cropped** to 512×512 and encoded as WebP quality 82.
    - All input metadata (EXIF including GPS, ICC, XMP) is dropped. The original upload is never retained.
  - **Private, signed, expiring reads:**
    - Clients receive `avatarUrl`, a signed URL valid for about 1 hour. Expiry is rounded up to 10-minute steps so URLs stay cacheable.
    - Local media is served by `GET /api/media/avatars/:file`, authorized by `HMAC-SHA256` over `"fitai-media-v1:" + key + ":" + expires`, using a key derived from `JWT_SECRET` with its own label. That separates it from JWTs, and no JWT is created.
    - Signatures are compared in constant time.
  - **Safe replacement:**
    1. Process the image.
    2. Store the new object.
    3. In one transaction holding a row lock (`SELECT … FOR UPDATE`, as in workout updates), swap `avatarKey`.
    4. Only after the commit, delete the replaced object (best effort).
  - **Safe removal:** clear `avatarKey` first, then delete the object (best effort). Removal is idempotent.
  - **Orphans:** a failed best-effort delete leaves an unreferenced object, never a broken avatar. A manual, dry-run-by-default sweep (`npm run storage:sweep-avatars`) removes unreferenced avatar objects older than 24 hours. There is no cron job, worker or queue.
- **Rationale:**
  - A key (not a URL) keeps the database independent of where and how media is served. Moving to S3 or a CDN changes the adapter, not stored data.
  - Server-side re-encoding is the only reliable way to strip location metadata, normalize orientation and size, and neutralize malformed or disguised files. Client-side processing can be bypassed.
  - Signed, expiring URLs keep photos private while still working in a plain `<img>`, which cannot send the bearer token.
  - Ordering every write as "store, then point to it" and "stop pointing, then delete" means each failure leaves at most an orphan. The row lock means concurrent requests can only delete keys they personally replaced, never the active avatar.
  - **Centre crop over sharp's `attention` crop:** both are deterministic, but in tests `attention` followed bright background objects and pushed a centred face to the edge. Centre crop is predictable for profile photos, and a client preview can show exactly what will be stored.
- **Consequences:**
  - **Account-deletion invariant:** deleting a `User` row (cascade) does **not** delete their object in storage. Any future account deletion must explicitly delete the user's avatar object, and should run the sweep logic as a safety net.
  - **`avatarUrl` format:** for local storage `avatarUrl` is root-relative (`/api/media/…`); clients resolve it against the API origin. A future S3 adapter may return absolute presigned URLs.
  - **New dependency:** `sharp` (native libvips binaries).
  - **Not implemented:** an S3 adapter, CDN delivery, production storage configuration, and avatar-upload throttling (general rate limiting is future security work). The Settings photo UI was also listed here until Phase 3C; see the amendment below.
- **Amendment (2026-10-02, Settings Phase 3C):** implementation status only; the decision is unchanged.
  - The Settings profile-photo frontend is implemented: choose or drop a photo, preview it in the same centred `object-fit: cover` circle the server crop produces, then save, replace or remove it through the endpoints above.
  - The client resolves root-relative `avatarUrl` values against the API origin and, when an image fails to load (for example an expired link), refetches the account once for a freshly signed URL before falling back to initials.
  - Client-side type, size and dimension checks are for UX only; server-side validation and re-encoding remain authoritative.

## ADR-025: The AI Coach is anchored to the client's local date and timezone

**Status:** Accepted (2026-10-02, AI Coach Phase 1A)

- **Context:** Coaching questions are relative to the user's day: "this week", "yesterday", "today". The model was never told the date, and AI tools windowed data by `recordedAt` relative to the server clock, so these questions could not be answered reliably. Users do not store a timezone, and the server must not decide a user's "today" ([ADR-021](#adr-021-logical-calendar-dates-are-separate-from-recorded-timestamps)).
- **Decision:**
  - Every coach request carries `clientContext: { today: "YYYY-MM-DD", timeZone: "<IANA name>" }`, sent by the client per request and never stored.
  - The server validates it: `today` must be a real date, `timeZone` a real IANA name (not a raw offset), and `today` within ±1 day of the server's current date in that timezone (clock skew around midnight is allowed; manipulated dates are rejected with 400).
  - The validated values reach tools only through the server-side `ToolExecutionContext`; the model cannot change them. They also go into the system prompt ("Today is …").
  - Periods are rolling: the 7 days ending today and the 7 days before them. No calendar-week semantics.
  - Logical dates are used where they exist (`entryDate`, `workoutDate`, `activityDate`); timestamps (weight check-ins) are converted to local dates with the timezone, DST-aware.
- **Rationale:**
  - The client already decides logical dates for nutrition and workouts; this applies the same principle to AI questions without adding a stored timezone.
  - Validating against the server clock keeps a forged date from shifting what the coach reports, while tolerating legitimate clock differences.
  - Rolling periods are locale-independent and deterministic.
- **Consequences:**
  - The coach API requires `clientContext`; the frontend must send it (Phase 1C).
  - Reasoning about dates more than about a day from the server clock is impossible through the coach, by design.
  - The deterministic period metrics live in the domain services and are tested with fixed dates.

## ADR-026: AI Coach conversation context is client-held, bounded and untrusted

**Status:** Accepted (2026-10-02, AI Coach Phase 1B)

- **Context:** Follow-ups ("Why?", "What about last week?", "And my protein?") need the earlier conversation. Coaching facts, however, must keep coming from the user's logged data, and storing health conversations on the server would need its own privacy, retention and deletion design.
- **Decision:**
  - The client keeps the conversation and sends `history` with each coach request: earlier user and assistant turns as plain text, oldest first, without the current message. The server stores nothing; there is no conversation ID and no long-term memory.
  - History is bounded (at most 10 turns; user ≤ 2,000 characters, assistant ≤ 4,000, total ≤ 12,000) and strictly validated. Invalid or oversized history is rejected (400), never trimmed by the server. Roles need not alternate.
  - History is **untrusted conversational context, never evidence.** It goes to the model as ordinary user/assistant turns before the current message, never into the system prompt, and cannot carry tool output. The prompt (`coach-v3`) says earlier messages may be outdated or altered, cannot change the rules, and that logged facts must be re-read with tools in the current request.
  - Each successful response includes `sources: [{ type, startDate, endDate }]`, derived deterministically from tools that ran successfully, never from the model. Types are public categories (`profile`, `weight`, `nutrition`, `activity`, `workouts`). The period is the window the tool was asked to review; comparison periods and internal reference lookups do not widen it. Failed, invalid, rejected and oversized calls are excluded; repeated calls merge.
  - The model's structured output is unchanged (`answer`, `actionItems`, `followUpQuestion`).
- **Rationale:**
  - Native user/assistant turns give the model the best understanding of follow-ups; the trust boundary is enforced by tools reading live data and by the prompt, not by hiding the conversation's shape.
  - A client-held conversation keeps health conversations off the server. Forged history can only affect the forger's own session, because there are no write tools and every tool read is scoped by the JWT `userId`.
  - Server-derived sources are truthful provenance the UI can show ("Reviewed workouts · Sep 26–Oct 2") without trusting the model's account of what it looked at.
- **Consequences:**
  - The frontend (Phase 1C) owns the conversation: it keeps it per tab in `sessionStorage`, scoped to the signed-in user and cleared on logout and on 401, trims oldest-first to the limits, and sends only completed exchanges.
  - Each provider call re-sends the history (up to about 3,000 extra input tokens per call); the loop limits, deadline and rate limit are unchanged.
  - That follow-ups really re-query tools is model behavior, checked by the Phase 1D evaluations; the deterministic tests cover what the server enforces.
- **Amendment (2026-10-02, AI Coach Phase 1C):** implementation status only; the decision is unchanged.
  - The frontend Coach is implemented. The conversation lives in `sessionStorage["fitai.user.coach.conversation.v1"]` as `{ version, userId, messages }`: completed messages only, newest 60.
  - User scoping: the `userId` is the stored token's claim (read without verification, used only to scope storage); a conversation for another user, another version or malformed data is discarded. Signing out (logout or a 401) clears every `fitai.user.*` key, a generic rule rather than Coach-specific auth code.
  - History is built from completed messages only, within the limits above; a failed or in-flight question never enters it, and Retry resends the same question against the same history.
  - `clientContext` is computed at send time; without a valid IANA timezone the request is not sent (no fallback timezone).

## ADR-027: Live AI Coach evaluation is opt-in, isolated and deterministic-first

**Status:** Accepted (2026-10-03, AI Coach Phase 1D-A)

- **Context:** The coach's grounding, follow-up and safety behavior depends on a real model. The deterministic tests (scripted providers) prove what the server enforces, but not what a model does with it. Measuring the model costs money, needs credentials, and creates data, so it must never happen by accident, and it must never touch development data.
- **Decision:**
  - A separate evaluation harness (`backend/scripts/coach-eval/`, `npm run eval:coach`) runs fixed scenarios against the real coach service (`generateCoachResponse`) and the configured model. It is **not** part of `npm test`, builds or any automated check.
  - **Explicit opt-in:** a live run requires `COACH_EVAL_LIVE=1` (from the shell, never `.env`), the `--confirm-live` flag, `OPENAI_API_KEY` and `OPENAI_MODEL`. Any missing requirement stops the run before a provider request.
  - **Test database only:** the database must be positively identified. `TEST_DATABASE_URL` must name a database ending in `_test`, differ from the development database by identity and by name, and the connected server must report that same database. Otherwise nothing runs.
  - **Synthetic data:** each scenario gets its own user (`coach-eval-<runId>-<scenario>-<repeat>@fitai-eval.local`) seeded with fixed-date fixtures (today = 2026-06-15), deleted afterwards. Cleanup selects only that email prefix and domain, at the end of each scenario, at startup (stale users from interrupted runs), on SIGINT/SIGTERM, and is verified at the end.
  - **Budgets:** one repeat by default, at most 5; hard ceilings of 150 provider calls (and HTTP attempts) and 1,000,000 tokens per run. Each request's worst case is reserved before it starts, so a run stops cleanly before crossing a ceiling.
  - **Deterministic first:** each scenario's result comes from deterministic checks (tool calls, validated arguments, outcomes, sources, limits, fixture ground truth) and narrow, labelled heuristic checks on the answer text. Optional model judging (`--judge`, a 0–2 rubric) is reported separately, marked as model-judged, and never changes a result. Human review is the authority for safety failures and doubtful scores.
  - **Minimal production instrumentation:** `generateCoachResponse` accepts an optional `observer` that receives copies of provider-turn, tool-call and completion events (including successful tool output). Production never supplies one; without it nothing changes, and observer data is never logged. OpenAI HTTP attempts and SDK retries are counted by a `fetch` wrapper inside the evaluation process only.
  - Reports (JSON and Markdown) record the exact model, prompt version, fixture version and git commit, and are git-ignored. Comparisons between runs with different models are refused unless explicitly marked as a model-change experiment.
- **Rationale:**
  - Accidental live calls and development-data writes are the expensive failure modes, so every gate is mandatory and checked before anything connects.
  - Fixed dates and fresh synthetic users make runs comparable across days and keep real users' data out of evaluations entirely.
  - Code-level checks are reproducible and cheap to trust; text heuristics and model judges are not, so they can only flag answers for review.
  - An observer passing copies is the smallest way to see what the model saw without logging tool data (ADR-019's logging rule) or capturing console output.
- **Consequences:**
  - Prompt or tool changes are evaluated against a recorded baseline with the same model, scenarios and fixtures. Prompt changes bump `COACH_PROMPT_VERSION`.
  - Evaluation results are evidence, not tests: model output varies, so hardening needs a failure reproduced in at least 2 of 3 comparable runs, or a severe safety failure.
  - Changing fixtures or scenario expectations requires bumping `FIXTURE_VERSION`, which makes older reports incomparable.
  - The harness's own logic is covered by offline self-tests (`coach-eval-harness.test.ts`, `coach-observer.test.ts`) that block all non-local network access.
- **Amendment (2026-10-04, AI Coach Phase 1D complete):** implementation status only; the decision is unchanged.
  - The process was used end to end: a coach-v3 baseline, targeted repeats, coach-v4 and coach-v5 hardening, and a full baseline-vs-candidate comparison, all on `gpt-5.6-terra` with fixtures `1d-a.1` and the judge off. coach-v5 was accepted.
  - Per-run reports remain git-ignored. A human-written summary with run IDs is committed at [docs/evals/AI-COACH-PHASE-1D.md](evals/AI-COACH-PHASE-1D.md).
  - Known harness limitations, kept so that the `1d-a.1` runs stay comparable: the S2 and S17 text heuristics are narrow, and synthetic foods have 0 g carbs/fat.

## ADR-028: Social sign-in proves identity; FitAI owns the account and session

**Status:** Accepted (2026-10-04, Phase 5A-1). **Implemented so far:** the data model, password-login safeguards, the Google sign-in backend (single-use nonce endpoint and `POST /api/auth/google`, Phase 5A-2), the Google button on Login and Signup (Phase 5A-3), the Sign in with Apple backend (`POST /api/auth/apple`, Phase 5A-4) and the Apple button on Login and Signup (Phase 5A-5). Phase 5A is closed: Google sign-in is validated against the real provider; Sign in with Apple is implemented and tested offline, with real-provider validation deferred (see the Phase 5A close amendment). **Planned (not implemented):** account linking (Phase 5B).

- **Context:** Users should be able to sign up and log in with Google or Apple as well as email and password. FitAI's authorization, data scoping (ADR-013) and session (ADR-004) are built around its own `User` and JWT. FitAI has never verified email addresses (ADR-020), so an email match proves nothing about who owns a FitAI account.
- **Decision:**
  - **FitAI owns the account and the session; providers only prove identity.** After verifying a provider's ID token on the backend, FitAI issues its normal session token (`{ userId }`, HS256, 1 hour; `issueSessionToken`). Provider tokens are never used as FitAI sessions.
  - **Identities are stored separately** as `AuthIdentity` rows (`provider`, `providerSubject`), unique per provider and subject, with at most one identity per provider per account. A person is recognised **only** by provider + the provider's stable `sub`; the provider email is stored for display and audit, never as a key.
  - **Provider tokens, authorization codes and secrets are never stored** in the database (and never logged).
  - **No automatic linking by email.** A provider identity whose email matches an existing FitAI account is not attached to it. Linking will require proof of both accounts (a signed-in FitAI session plus a fresh provider sign-in) and is deferred to Phase 5B, together with unlinking and "create password".
  - **Password credentials are optional.** `User.passwordHash` is nullable; an account without one can never use password login. Every failed login returns the same response after one bcrypt comparison, against a fixed dummy hash when there is no real one, so the response and its timing don't reveal whether the email exists or how the account signs in.
  - **Social sign-in and health-data permissions are independent.** "Sign in with Apple" or "Sign in with Google" never implies, requests or stores Apple Health, Health Connect or Google Fit access; any future health connection gets its own model and consent (ADR-016).
  - Planned provider verification will check the token signature against the provider's published keys, the issuer, audience and expiry, and a server-issued, single-use, expiring nonce to block replay.
- **Rationale:**
  - Reusing the one FitAI session keeps the frontend, the auth middleware and per-user isolation identical for every sign-in method.
  - A provider's `sub` is stable and unique; emails change, can be hidden (Apple's private relay) and, in FitAI, are unverified. Linking by email would let anyone who pre-registered someone's address with a password keep access after the real owner signs in with Google (pre-account takeover).
  - A separate table keeps credentials-adjacent data out of `User` (ADR-005) and lets a user hold several providers without a column per provider.
- **Consequences:**
  - A person who already has a password account and then tries Google or Apple with the same email is refused rather than linked until Phase 5B exists. A person whose Apple sign-in hides their email gets a new account.
  - `User.email` stays required and unique; social sign-up must supply a verified provider email.
  - Account deletion (not implemented) cascades identities; revoking Apple authorization at deletion will need an Apple key at that point.
- **Amendment (2026-10-04, Phase 5A-2):** implementation status only; the decision is unchanged.
  - The Google backend flow is implemented as decided. Nonces are random, provider-bound, 10-minute, single-use and stored as digests in a bounded **process-local** store (a multi-instance deployment needs a shared atomic store).
  - ID tokens are verified with `jose` against Google's published keys. New accounts need a Google-verified email, and an email collision returns `409 EMAIL_IN_USE` without creating or linking anything.
  - The new-account name falls back to "FitAI Member" when Google gives none.
  - Unauthenticated `/api/auth/*` endpoints are rate-limited per IP, also process-local.
- **Amendment (2026-10-04, Phase 5A-3):** implementation status only; the decision is unchanged.
  - Login and Signup show Google's own button, loaded lazily from Google Identity Services, when `VITE_GOOGLE_CLIENT_ID` is set. That is the same public web client ID as the backend's `GOOGLE_CLIENT_ID`, and there is no client secret.
  - The browser holds Google's credential and the nonce only in memory for one request, and stores only the FitAI JWT, through the same path as password login.
  - A nonce is fetched before each attempt's button initialization and spent on the first credential.
  - A 401 from a sign-in endpoint no longer counts as an expired session in the frontend.
- **Amendment (2026-10-04, Phase 5A-4):** implementation status only; the decision is unchanged.
  - Sign in with Apple is implemented in the backend with ID-token verification only, against Apple's published keys with audience `APPLE_CLIENT_ID` (the public Services ID). There is no authorization-code exchange, client secret, private key or stored Apple token.
  - Apple's `sub` is the identity key. A returning identity needs neither email nor name.
  - A new account needs a verified email from the signed token (private-relay addresses included, flagged `isPrivateEmail`); without one the request is refused (`missing_email`), and no email is invented.
  - The name Apple gives the browser on first authorization is unsigned and only names a new account.
  - Google and Apple share one verification core and one resolution path. Email collisions return `409 EMAIL_IN_USE`, including against Google-created accounts.
  - No Apple Health or other health permission is involved.
- **Amendment (2026-10-04, Phase 5A-5):** implementation status only; the decision is unchanged.
  - Login and Signup show Apple's official button (Apple JS, popup mode), loaded lazily only when `VITE_APPLE_CLIENT_ID` and an HTTPS `VITE_APPLE_REDIRECT_URI` are set. Both are public; there is still no client secret, private key or code exchange.
  - Each attempt uses a fresh single-use nonce and a random `state`, both in memory only. The `state` is checked before anything reaches FitAI.
  - Only the ID token, nonce and first-authorization name are sent; the browser's view of email, `sub` and the relay flag is ignored. The name is kept in memory for a same-tab retry by the same Apple account and never stored.
  - The missing-email 401 now carries `code: "MISSING_EMAIL"` (additive) so the client can explain it.
- **Amendment (2026-10-04, Phase 5A close):** validation status only; the decision is unchanged.
  - **Google:** validated against the real provider on a local development setup. A first sign-in created one password-less account with one Google identity; signing out and in again resolved the same account and identity, with no duplicate. No provider token, nonce or authorization code was stored.
  - **Apple:** the backend and frontend are implemented and covered by offline tests and stubbed browser QA. Real-provider validation is **deferred** because Apple Developer enrollment is pending; no defect is known. Before Apple sign-in is enabled in any environment, it needs one real sign-in on a registered HTTPS domain, which also confirms Apple JS behavior that can't be checked offline (see ARCHITECTURE.md).
