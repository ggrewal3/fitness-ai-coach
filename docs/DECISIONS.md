# FitAI Engineering Decisions

Last reviewed: 2026-10-01

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
  - Applying preferences in the UI is not implemented yet.
  - Tests assert that preference changes leave stored data untouched.

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
  - The editor default unit (`DEFAULT_LOAD_UNIT = "LB"`) is a frontend constant.

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
