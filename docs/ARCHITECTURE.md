# FitAI Architecture

Last reviewed: 2026-10-01

This is the canonical description of how FitAI works **today**. It is not a changelog. Reasons behind important choices live in [DECISIONS.md](DECISIONS.md); HTTP contracts in [API.md](API.md); the data model in [DATABASE.md](DATABASE.md); AI specifics in [AI-SYSTEM.md](AI-SYSTEM.md); workflow in [DEVELOPMENT.md](DEVELOPMENT.md).

Anything under a **Not implemented** heading is planned or possible future work, not current behavior.

## 1. System overview

```text
Browser (React SPA, Vite)
   │  fetch + JWT Bearer token
   ▼
Express 5 API (/api/*)  ── auth middleware ── Zod validation ── controllers ── services
   │                                                                  │
   │                                                    Prisma Client (pg driver adapter)
   ▼                                                                  ▼
OpenAI Responses API  ◄── AI module (provider abstraction)        PostgreSQL 17
```

- **frontend/**: React 19 + TypeScript SPA built with Vite, routed with react-router-dom 7.
- **backend/**: Express 5 + TypeScript API, Prisma 7 ORM, Zod 4 validation, JWT auth, bcrypt password hashing.
- **Database**: PostgreSQL 17. For local development it runs in Docker via `docker-compose.yml`; this is the only containerized service.
- **AI**: the OpenAI Responses API behind a small provider interface. The backend calls it; the browser never does.

Not implemented: production deployment, Nginx (the `nginx/` and `database/` directories are empty), CI, and containerized frontend or backend.

## 2. Backend

### Layering

`src/app.ts` builds the Express app without listening, so tests can mount it on an ephemeral port. `src/server.ts` owns the real listener (`PORT`, default 5001). Each domain lives in `src/modules/<domain>/` with the same shape:

```text
<domain>.routes.ts       route table: authMiddleware → validateBody(schema) → controller
<domain>.controller.ts   HTTP concerns: read req.userId, parse params/query, map results/errors to status codes
<domain>.service.ts      business rules + Prisma access; every query is scoped by userId
<domain>.schemas.ts      Zod schemas (request validation); types derived where practical
<domain>.types.ts        TypeScript types
```

Mounted modules (`app.ts`): `auth`, `account`, `profile`, `checkins`, `ai`, `nutrition`, `activity`, `workouts`, `exercises`. There are also `/api/health` and `/api/protected-test` (a diagnostic route that only checks the JWT).

`src/modules/users/user.service.ts` is an unused development stub. It is not routed.

### Request pipeline and error contract

1. `authMiddleware` (`src/middleware/auth.middleware.ts`) requires `Authorization: Bearer <jwt>`, verifies it with `JWT_SECRET`, and sets `req.userId` from the token's `userId` claim. It does **not** check that the user still exists. Services handle a deleted user by returning 404 (account routes) or by finding no rows.
2. `validateBody(schema)` (`src/middleware/validate.middleware.ts`) runs `schema.safeParse(req.body)`. On failure it returns:
   ```json
   { "message": "Validation failed.", "errors": [{ "field": "path.to.field", "message": "..." }] }
   ```
   `field` is `"body"` for object-level problems, such as unknown keys or "provide at least one field". On success it replaces `req.body` with the parsed, transformed data.
3. Express 5 makes `req.query` read-only, so query strings and route params are validated with `safeParse` inside controllers, using the same error shape (`field` falls back to `"query"`).
4. Controllers catch errors. Unexpected failures return `500 { "message": "Internal Server Error" }`. Domain errors map to specific codes: 404 not found or not owned, 409 conflicts, 503/502 for AI provider and output failures.

Most request schemas are `.strict()`, so unknown keys are rejected. Exceptions: `POST /api/checkins`, the register/login bodies and the AI coach body are not strict; unknown keys there are stripped, not rejected.

### Ownership and identity invariants (system-wide)

- The acting user is **always** `req.userId` from the verified JWT. No endpoint accepts a `userId` from the body, query or path. Strict schemas reject `userId` where present.
- Every read or write of user-owned data filters by `userId`. Mutations use `deleteMany`/`updateMany` with `{ id, userId }`, or an ownership check inside a transaction. A resource owned by someone else is indistinguishable from a missing one (404).
- AI tools receive `userId` from the authenticated request context, never from model output. See [AI-SYSTEM.md](AI-SYSTEM.md).

### Cross-cutting gaps (implemented today = absent)

The app sets `cors()` with no origin restriction and `express.json()` with the default body-size limit. There is no rate limiting, no security-header middleware, no session or token revocation, no refresh tokens, and no structured logger: logging is `console.*`, with AI events logged as objects.

## 3. Authentication

- `POST /api/auth/register` validates input, then stores a bcrypt hash (cost 10).
  - Emails are trimmed and lower-cased at both register and login, so lookups are effectively case-insensitive.
  - Passwords must be at least 8 characters and **at most 72 UTF-8 bytes**, because bcrypt ignores bytes beyond 72. Login does not apply the maximum.
  - Registration does not log the user in.
- `POST /api/auth/login` returns `{ token, user }`. The token is a JWT `{ userId }` signed with `JWT_SECRET`, expiring after **1 hour**. Failed logins return the same 401 message whether the email or the password was wrong.
- **Frontend:**
  - The token is kept in `sessionStorage` under `fitai.auth.token` (see `frontend/src/services/api.ts`), so it is per-tab and cleared when the tab closes.
  - `AuthProvider` (`context/AuthContext.tsx`) exposes `useAuth()`.
  - Every request goes through `request()` in `services/api.ts`, which attaches the token. On any 401 it clears the token and calls the registered handler, which logs the user out.
  - `ProtectedRoute` redirects unauthenticated users to `/login`.
- There is no email verification, password change or reset, account deletion, session revocation, OAuth or rate limiting. Email cannot be changed.

## 4. User, account and preferences

User data is deliberately split across three models (see [ADR-005](DECISIONS.md#adr-005-separate-user-fitnessprofile-and-userpreference)):

| Model | Holds | API |
|---|---|---|
| `User` | Identity and credentials (`email`, `passwordHash`) plus contact/profile details (`firstName`, `lastName`, `phone`, `countryCode`, `bio`) | `/api/auth/*`, `/api/account` |
| `FitnessProfile` (optional 1:1) | Coaching context: date of birth, height, target weight, goal, activity level, diet preference, medical notes | `/api/profile` |
| `UserPreference` (optional 1:1) | Display/input units: `bodyWeightUnit`, `workoutLoadUnit`, `heightUnit` | `/api/account/preferences` |

- **Account** (`modules/account`):
  - `GET /api/account` returns identity, contact details and preferences. If the user has no `UserPreference` row it returns the defaults (KG / LB / CM) and does **not** create one.
  - `PATCH /api/account/preferences` upserts the row.
  - `PATCH /api/account/profile` updates names, phone (normalized to E.164 style), country (validated ISO 3166-1 alpha-2) and bio (plain text). Email is read-only.
- **Unit preferences are presentation only.** Stored measurements are never converted when they change; see Measurement units below.
- **Frontend:** the Settings page (`/settings`, see section 6) reads and edits the account, unit preferences and fitness profile through these endpoints.
- **Not implemented:**
  - Unit preferences are saved but not yet applied to other screens (Progress, Dashboard, Workout still show their current units). That is Phase 4.
  - Profile photos: the Settings avatar shows initials only; there is no upload, storage or photo field yet.

## 5. Fitness domains

### Measurement units (system-wide invariant)

| Data | Stored as |
|---|---|
| Body weight (`WeightCheckIn.weightKg`), target weight | kg |
| Height (`FitnessProfile.heightCm`) | cm |
| Walking distance (`DailyActivity.walkingDistanceKm`) | km |
| Workout set load (`WorkoutSet.load` + `loadUnit`) | **exactly as entered**, with its own unit (KG or LB); never converted |

Display/input conversion is a presentation concern driven by `UserPreference`. Changing a preference never rewrites history. See [ADR-006](DECISIONS.md#adr-006-canonical-metric-storage-units-are-display-preferences-only) and [ADR-007](DECISIONS.md#adr-007-workout-sets-keep-the-unit-they-were-entered-in).

### Calendar dates vs timestamps

Several domains separate the **logical day** from the **moment of recording**:

- `NutritionFoodItem.entryDate` and `WorkoutSession.workoutDate` are client-supplied `YYYY-MM-DD` values in Postgres `DATE` columns. They are converted by string concatenation to UTC midnight (`${date}T00:00:00.000Z`), never by parsing a local time, so the day cannot shift with timezones. They are returned as `YYYY-MM-DD`.
- `DailyActivity.activityDate` is derived from the **calendar-date prefix of the client's `recordedAt` string**, in the client's own offset.
- `recordedAt` is always an ISO-8601 timestamp with an offset.
- AI history summaries window by `recordedAt >= now - days`, not by logical date.

### Fitness profile (`modules/profile`)

- Create once with `POST`; a second `POST` returns 409. Update with `PATCH /me`; `null` clears a field.
- Validation:
  - Date of birth: `YYYY-MM-DD`, in the past, age 13–120.
  - Height: 50–275 cm. Target weight: 20–400 kg.
  - The enums must match.
  - `medicalNotes`: at most 2000 characters.
- `medicalNotes` is never exposed to the AI.

### Weight check-ins (`modules/checkins`)

Create, list (newest first) and delete. Records are append-only; there is no update. `getWeightHistorySummary` provides deterministic trend metrics for the AI tool. The frontend Progress page and the Dashboard use the check-ins.

### Nutrition (`modules/nutrition`)

- One row per **food item**, not per day. The earlier per-day `NutritionEntry` model was replaced by migration `20260925125036_replace_nutrition_entry_with_food_items`.
- Each item has `mealType`, `entryDate`, `recordedAt` and a `source`: `MANUAL`, `AI_TEXT`, or `AI_PHOTO` (`AI_PHOTO` is accepted but no photo pipeline exists).
- `GET /summary/:date` totals one `entryDate`.
- **AI-assisted entry:** the frontend calls `POST /api/ai/nutrition/estimate`, shows the estimate, and the user confirms or edits it. Only then is it saved through the normal `POST /api/nutrition`, which re-validates everything. The estimate endpoint never writes to the database (see [ADR-012](DECISIONS.md#adr-012-ai-proposes-the-user-confirms-the-normal-api-persists)).
- The frontend loads all food items and groups them by `entryDate` on the client.

### Daily activity (`modules/activity`)

- At most one row per user per `activityDate`, enforced by a unique constraint; a conflict returns 409.
- Fields: steps, optional walking distance (km), optional active calories, and `source`.
- `source` is always `MANUAL` today: `APPLE_HEALTH` and `HEALTH_CONNECT` exist in the enum but nothing writes them (see [ADR-016](DECISIONS.md#adr-016-health-platform-integrations-are-not-implemented)).
- No frontend page uses activity yet; the data is consumed by the AI activity tool.

### Workouts (`modules/workouts`)

- **Structure:** `WorkoutSession` (title, `workoutDate`, `trainingType`, `durationMinutes`, notes, `recordedAt`) → ordered `WorkoutExercise` (references an `Exercise`) → ordered `WorkoutSet` (reps, optional load + unit; null load means bodyweight). A session may have zero exercises.
- **Positions** are assigned by the server from array order; clients never send them.
- **Every exercise reference must be visible** to the user, meaning a built-in or one of their own custom exercises. Missing and foreign IDs produce the same 400 error on `exercises.N.exerciseId`, so other users' exercises cannot be probed.
- **Updates** run in one transaction that first locks the owned row (`SELECT … FOR UPDATE`). When `exercises` is present it **replaces all nested exercises and sets**; when it is absent they are untouched (see [ADR-009](DECISIONS.md#adr-009-workout-edits-replace-nested-exercises-and-sets-transactionally)).
- Reads: list summaries (with `exerciseCount`/`setCount`), one workout, or all workouts on a date.
- The AI workout tool reads **session-level fields only** (type, duration, notes, timestamps), not exercises or sets.

### Exercise catalogue (`modules/exercises`)

- **Built-in** exercises have `userId = null` and a permanent `builtInKey`. There are 82, defined in `exercise.catalog.ts` and upserted idempotently by `prisma/seed.ts`. They cannot be created or changed through the API.
- **Custom** exercises (`userId = owner`) are private to their owner, capped at 500 per user.
- Names are normalized (`exercise.normalize.ts`: NFKC, trim, collapse whitespace, lower-case, drop apostrophes, treat hyphens and underscores as spaces) into `normalizedName`.
- `POST /api/exercises` is **find-or-create**: a matching built-in wins; otherwise the user's existing custom exercise is returned; otherwise one is created (201 vs 200). Races are absorbed via the unique constraint (see [ADR-011](DECISIONS.md#adr-011-exercise-names-are-normalized-and-creation-is-find-or-create)).
- Search is deterministic and done in memory over the visible set: exact match, then prefix, word-prefix and substring matches, with code-point alphabetical tie-breaks.

**Not implemented:** timed or distance sets, RPE, muscle groups and equipment, personal records, progression analytics, exercise aliases, and fuzzy matching.

## 6. Frontend

```text
frontend/src/
  main.tsx                  mounts <App/>, imports index.css
  App.tsx                   ThemeProvider > AuthProvider > RouterProvider
  app/router.tsx            routes (createBrowserRouter)
  context/                  AuthContext + useAuth, ThemeContext + useTheme (context/hook split for react-refresh)
  services/api.ts           the only HTTP client: request(), types, error class
  services/*.ts             per-domain wrappers and pure helpers (checkins, nutrition, exercises, workouts,
                            account, fitnessProfile)
  features/workout/         WorkoutDraft model + reducer, DOM id helpers, exercise-name helpers
  features/settings/        Settings drafts/diffs/validation, sections, scroll-spy, country list mirror
  features/navigation/      useUnsavedChangesGuard (shared by the Workout editor and Settings)
  features/theme/theme.ts   theme preference and resolution logic
  components/ui/            shared primitives: ConfirmDialog, ChoiceGroup, SegmentedControl, Avatar,
                            Skeleton, icons
  components/               layout (AppLayout, Header, Sidebar), auth, brand, nutrition, workout, settings
  pages/                    one component per route
  index.css                 single global stylesheet, semantic colour tokens
```

- **Routes:**
  - Public: `/login`, `/signup`.
  - Behind `ProtectedRoute` + `AppLayout`: `/` (Dashboard), `/progress`, `/nutrition`, `/workout`, `/workout/new`, `/workout/:id/edit`, `/ai-coach` (stub), `/settings`.
- **State:** React state and context only, with no global state library. Pages load data inside `useEffect` with an `isCurrent` guard against stale responses.
- **Layout:** desktop sidebar; at ≤767px the sidebar becomes an off-canvas drawer (`MOBILE_NAV_QUERY` in `AppLayout.tsx` must match the CSS media query). Other breakpoints: 1100, 900 and 640px.
- **API errors:** `ApiRequestError` carries `status` and the backend's `errors[]` so forms can map field errors.
- **Workout editor:**
  - It is a page (`/workout/new?date=`, `/workout/:id/edit`), not a modal ([ADR-014](DECISIONS.md#adr-014-the-workout-editor-is-a-page-not-a-modal)).
  - It edits a single `WorkoutDraft` through `workoutDraftReducer` ([ADR-015](DECISIONS.md#adr-015-a-single-shared-workoutdraft-model-for-workout-entry)). Saving converts the draft into the API payload; editing sends the full exercise list, which the server uses for its replace semantics.
  - Unsaved changes are protected by the shared `useUnsavedChangesGuard` (see below).
  - Frontend limits mirror the backend schemas (`WORKOUT_LIMITS`); the backend remains authoritative.
- **Unsaved changes** (`features/navigation/useUnsavedChangesGuard.ts`):
  - Blocks in-app navigation that changes the path or query (links, sidebar/drawer, browser Back) and shows `ConfirmDialog`; reload or close gets the browser's `beforeunload` prompt. Hash-only changes are never blocked.
  - React Router allows one active blocker, so each page calls it **once** with its combined dirty state.
  - It never blocks once the user is no longer authenticated (logout, expired token) and releases any navigation it was holding, so a logged-out page is never stuck behind the dialog.

### Settings

`pages/SettingsPage.tsx` with cards in `components/settings/`.

- **Data:** loads `GET /api/account` and `GET /api/profile/me` in parallel. If the account fails, the page shows a Retry state. If only the fitness profile fails, only the Fitness card shows an error and Retry.
- **Sections:** Profile (hero, Personal information, About you), Fitness, Units, Appearance, Connections, Account. Section navigation is a sticky side list above 1100px and a sticky, horizontally scrollable chip row below. It uses plain links with `aria-current` (not tabs), follows scrolling, and supports deep links such as `/settings#units`. Card internals adapt with container queries.
- **Save model:**
  - Personal information, About you (bio) and Fitness are **separate save boundaries**, each with its own Save/Cancel bar that appears only when that card is dirty. Each sends **only changed fields**, and the server response becomes the new baseline.
  - Fitness creates the profile (`POST`) on first save and updates it (`PATCH`) afterwards. Cleared fields are sent as `null`. Height is entered in cm and target weight in kg until Phase 4.
  - Units save immediately, optimistically, and roll back on failure. Appearance calls `setTheme()`.
  - Client validation mirrors the backend schemas; server field errors are shown on their fields; drafts survive failures.
  - One page-level unsaved-changes guard covers all three editable cards.
- **Country:** a searchable combobox shows `Intl.DisplayNames` names and stores ISO codes. `features/settings/countries.ts` mirrors the backend's 249 supported codes; the backend stays authoritative.
- **Content rules:** Connections is informational only ([ADR-016](DECISIONS.md#adr-016-health-platform-integrations-are-not-implemented)). `medicalNotes` is not shown. The bio and "What FitAI Coach sees" copy must stay true to the AI profile tool.
- **Not implemented:** profile photos (initials avatar only), password change, account deletion, email change.

### Theme system

See [ADR-017](DECISIONS.md#adr-017-theme-preference-is-browser-local-and-resolved-before-first-paint) and [ADR-018](DECISIONS.md#adr-018-semantic-css-colour-tokens-with-an-exact-light-baseline).

- The preference (`system` | `light` | `dark`, default `system`) is stored **only** in `localStorage["fitai.theme"]`. It is never sent to the backend.
- `<html data-theme>` always holds the **resolved** theme (`light` | `dark`, never `system`), and `html.style.colorScheme` matches so native controls follow it.
- An inline classic script in `frontend/index.html` resolves and applies the theme **before CSS and React load**, so there is no wrong-theme flash. It mirrors the key, values, media query and DOM writes in `features/theme/theme.ts`; keep the two in sync.
- `ThemeProvider` (`context/ThemeContext.tsx`):
  - tracks `prefers-color-scheme` with `useSyncExternalStore`;
  - applies changes in a layout effect;
  - follows other tabs via the `storage` event.
- `useTheme()` returns `{ preference, resolvedTheme, setTheme }`.
- Invalid, missing or inaccessible storage falls back to `system`.
- **CSS:** `index.css` defines 63 semantic tokens on `:root` (Light) with overrides on `:root[data-theme="dark"]`. Component rules use tokens only; colours are never defined inside a theme block.
- **Scoped previews:** the same two token blocks also match `[data-theme-preview="light"]` and `[data-theme-preview="dark"]`. Any element with that attribute renders one theme's palette regardless of the page theme; the Settings theme cards use this. It does not change `<html data-theme>`, which always holds the resolved page theme.
- **Settings:** the Appearance card (System / Light / Dark cards with live previews) is the user-facing control; it calls `setTheme()`.

## 7. AI Coach

Summary only; details in [AI-SYSTEM.md](AI-SYSTEM.md).

- `POST /api/ai/coach` is single-turn: a message in, a structured `{ answer, actionItems, followUpQuestion }` out. It is driven by a tool-calling loop over 5 **read-only** tools (profile, weight, nutrition, activity, workout history) that wrap domain services. It runs at most 5 model turns.
- `POST /api/ai/nutrition/estimate` is a tool-less structured estimate that never persists anything.
- The model never touches the database, never chooses `userId`, and its output is Zod-validated before it is returned.
- **Not implemented:** the frontend AI Coach page (it is a stub), conversation history and memory, any AI write actions, and RAG.

## 8. Database access

- Prisma 7 with the `prisma-client` generator, output in `backend/src/generated/prisma` (generated, git-ignored).
- The client uses the `@prisma/adapter-pg` driver adapter (`src/lib/prisma.ts`). Configuration is in `backend/prisma.config.ts`.
- Multi-step writes use `prisma.$transaction(async tx => …)`.
- Unique-constraint races (P2002) are translated into domain results: 409 for duplicate activity days, "existing" for exercises, "already registered" for email.

See [DATABASE.md](DATABASE.md).

## 9. Testing

- **Backend:**
  - Node's built-in test runner with `tsx` (`backend/test/*.test.ts`, 8 files covering auth, account, profile, exercises, workouts and route smoke checks) runs against the real Express app and a **separate PostgreSQL database**.
  - `scripts/run-tests.mjs` requires `TEST_DATABASE_URL`, refuses to run against the development database, applies migrations, seeds the catalogue, and runs the files serially.
  - Tests create uniquely named users through the real API and delete them afterwards; cascades clean up their data.
- **Frontend:** no automated tests. Verification is `npm run build` (`tsc -b` + Vite) and `npm run lint`. UI changes are checked with ad-hoc headless-browser runs that are not part of the repository.

## 10. Infrastructure

- `docker-compose.yml` runs a local `postgres:17` container on host port 5433 with a named volume. Its credentials are local-development-only values.
- Backend and frontend run on the host (`npm run dev`).
- **Not implemented:** production hosting, Nginx reverse proxy, HTTPS, secrets management, CI/CD, and backups. The README roadmap lists AWS deployment as planned.

## 11. Invariants checklist

Before merging, check that a change doesn't break any of these:

1. The identity is the JWT `userId`. It is never taken from the client or from model output.
2. Every user-owned query is scoped by `userId`; resources owned by someone else return 404, the same as missing ones.
3. The backend is authoritative for validation; frontend limits only mirror it.
4. Stored measurements are canonical (kg, cm, km). Workout set loads keep their entered unit. Preferences never rewrite data.
5. Logical dates (`entryDate`, `workoutDate`) are `YYYY-MM-DD`, stored at UTC midnight by concatenation.
6. Workout exercise/set positions are server-assigned; `exercises` on PATCH means full replacement, inside one transaction.
7. Built-in exercises are immutable via the API and identified by a permanent `builtInKey`; custom exercises are private.
8. AI output is untrusted until validated. AI never persists data directly: AI proposes, the user confirms, the normal API persists.
9. `medicalNotes` and `bio` are never sent to the model.
10. Theme preference is browser-local; `data-theme` holds only a resolved theme; colours come only from tokens.
