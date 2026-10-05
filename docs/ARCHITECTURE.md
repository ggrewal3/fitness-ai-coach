# FitAI Architecture

Last reviewed: 2026-10-04

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

Mounted modules (`app.ts`): `auth`, `account`, `profile`, `checkins`, `ai`, `nutrition`, `activity`, `workouts`, `exercises`, `media`. There are also `/api/health` and `/api/protected-test` (a diagnostic route that only checks the JWT).

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

The app sets `cors({ exposedHeaders: ["Retry-After"] })`, with no origin restriction and only `Retry-After` exposed to browser JavaScript (for the AI Coach's 429 countdown), and `express.json()` with the default body-size limit (only `PUT /api/account/avatar` adds a route-scoped raw image parser). Rate limits are in process memory (`middleware/userRateLimit.middleware.ts`; a multi-instance deployment would need a shared store): per user on `POST /api/ai/coach`, and per client IP on the `/api/auth/*` endpoints (a reverse proxy would need Express's "trust proxy" setting so `req.ip` is the client). There is no other rate limiting (including avatar-upload throttling), no security-header middleware, no session or token revocation, no refresh tokens, and no structured logger: logging is `console.*`, with AI and social sign-in events logged as objects. A request body that isn't valid JSON gets a JSON 400 from an app-level handler, which never logs the body (the default handler would print a fragment of it).

## 3. Authentication

- `POST /api/auth/register` validates input, then stores a bcrypt hash (cost 10).
  - Emails are trimmed and lower-cased at both register and login, so lookups are effectively case-insensitive.
  - Passwords must be at least 8 characters and **at most 72 UTF-8 bytes**, because bcrypt ignores bytes beyond 72. Login does not apply the maximum.
  - Registration does not log the user in.
- `POST /api/auth/login` returns `{ token, user }`. The token is a JWT `{ userId }` signed with `JWT_SECRET` (HS256), expiring after **1 hour**; `modules/auth/session.ts` (`issueSessionToken`, `verifySessionToken`) is the only place tokens are issued and verified, and verification accepts HS256 only.
  - Every failure (unknown email, wrong password, or an account without a password) returns the same 401 message after one bcrypt comparison; when there is no real hash, a fixed dummy hash is compared, so failures don't differ noticeably in timing either.
- **Social sign-in (ADR-028):** Google and Apple sign-in work end to end: the backend endpoints (`POST /api/auth/nonce`, `POST /api/auth/google`, `POST /api/auth/apple`; see API.md) and the provider buttons on the Login and Signup pages (Frontend below). Account linking is not built.
  - **Nonce:** `modules/auth/social/nonceStore.ts` issues random, provider-bound, 10-minute nonces and keeps only their SHA-256 digests (at most 10,000; expired entries are swept every minute, the oldest evicted beyond the cap). A nonce is consumed by a synchronous get-and-delete, so it works once even under concurrent requests. **The store is process-local**: a multi-instance deployment needs a shared atomic store (e.g. Redis or a database row).
  - **Verification:** `social/providerToken.ts` holds the shared core (RS256 only, issuer, audience, `exp`/`nbf`/`iat` with 60 s tolerance, required `sub`, constant-time nonce comparison). `social/googleIdToken.ts` and `social/appleIdToken.ts` add each provider's keys, issuer and claims. Apple's `email_verified` / `is_private_email` count only as `true` or `"true"`. Apple's name isn't in the token; it arrives as unsigned request data and is used only to name a new account. The Google verifier checks the ID token with `jose` against Google's published keys (RS256 only; issuer, audience, expiry, issued-at, `sub`, nonce). Errors carry only a category: jose errors contain the token's claims and are never logged or returned. Tests swap only the key source (`setGoogleKeyResolver`) to locally generated keys.
  - **Resolution:** `social/socialSignIn.service.ts` finds the person by provider + `sub` only. An unknown identity becomes a new password-less account, in one write together with its `AuthIdentity`, if its verified email is free; otherwise `409 EMAIL_IN_USE`, never a link. Losing a first-sign-in race (P2002) re-reads the identity and logs in.
  - **Controller:** one sign-in flow for every provider (`socialSignIn` in `auth.controller.ts`); each provider only supplies its client ID, verifier and wording.
  - **Session:** success issues the same session token as password login (`issueSessionToken`). An unset `GOOGLE_CLIENT_ID` or `APPLE_CLIENT_ID` makes that provider return 503; the others are unaffected.
  - **No email, no account:** a new identity without a usable email gets `missing_email` (401, `code: "MISSING_EMAIL"`); no placeholder email is ever created.
  - **Apple:** Apple private-relay emails are ordinary account emails, flagged on the identity. Sending mail to them later will require configuring Apple's private email relay. No Apple authorization code, client secret or token is used or stored.
  - **Logs:** `{ event: "auth.social", provider, outcome, latencyMs, userId? }`, with `userId` only on success; outcomes include `missing_email`. Never the token, nonce, `sub`, email (including relay addresses) or names.
- **Frontend:**
  - The token is kept in `sessionStorage` under `fitai.auth.token` (see `frontend/src/services/api.ts`), so it is per-tab and cleared when the tab closes.
  - `AuthProvider` (`context/AuthContext.tsx`) exposes `useAuth()`.
  - Every request goes through `request()` in `services/api.ts`, which attaches the token. On a 401 from an authenticated call it clears the token and calls the registered handler, which logs the user out. The sign-in endpoints (login, register, nonce, Google, Apple) opt out (`endsSessionOn401: false`): a 401 there means the credentials or Google account couldn't be verified, not that a session expired.
  - **Auth pages:** Login and Signup show the FitAI mark and name (`components/auth/AuthBrand.tsx`, reusing `brand/FitAIMark`; decorative, so screen readers hear the page heading), then the social section (`components/auth/SocialSignIn.tsx`: Apple, then Google, then an "or" divider), then the password form. A provider that isn't configured is left out; with neither, there is no social section or divider. Only one social sign-in can be verified at a time (a shared busy flag).
    - Shared pieces live in `features/auth/socialShared.ts`: the lazy script loader, the nonce slot and the mapping from failures to short, provider-specific messages. Provider configuration is read once in `features/auth/socialConfig.ts`.
  - **Google sign-in** (`components/auth/GoogleSignIn.tsx`, `features/auth/googleIdentity.ts`): shown only when `VITE_GOOGLE_CLIENT_ID` is set.
    - Google Identity Services (`accounts.google.com/gsi/client`) is loaded lazily, once (a failed load can be retried). It uses Google's own button in popup mode, with no One Tap or automatic sign-in, in Google's light or dark style to match the theme.
    - **Nonce:** GIS takes the nonce in `initialize()`, before the button can be clicked. So a fresh single-use nonce is fetched when the button is prepared, again after every attempt and about a minute before it expires, re-initializing GIS each time. A nonce is spent as soon as Google returns a credential; duplicate callbacks are ignored (`createNonceSlot`).
    - **Session:** the credential and nonce live only in memory for that one request. Success goes through `acceptSession`, the same path as password login, which stores only FitAI's JWT.
    - **Errors:** short messages for verification failure, `EMAIL_IN_USE` (focuses the email field on Login, links to Log in on Signup), 429, 503 and script or network failure. A closed popup shows nothing.
    - Signing in with Google requests only basic profile (`openid email profile`), never health or fitness data.
  - **Apple sign-in** (`components/auth/AppleSignIn.tsx`, `features/auth/appleSignIn.ts`): shown only when `VITE_APPLE_CLIENT_ID` and an `https://` `VITE_APPLE_REDIRECT_URI` are set; otherwise Apple JS is never loaded.
    - Apple JS (`appleid.cdn-apple.com/.../appleid.auth.js`) is loaded lazily, once (a failed load can be retried). It renders Apple's official button into `#appleid-signin` (black on light, white on dark, re-rendered when the theme changes) and runs in popup mode with scope `name email`. FitAI listens for Apple's `AppleIDSignInOnSuccess` / `AppleIDSignInOnFailure` events.
    - **State and nonce:** like GIS, Apple JS takes them in `init()`, before the click. Each attempt gets a fresh server nonce (`APPLE`) and a 32-byte random `state`, prepared again after every attempt and shortly before the nonce expires. When Apple answers, the returned `state` is compared (constant time) **before** anything is sent to FitAI; a mismatch sends nothing and shows a generic error. The attempt is spent on any answer, so a state or nonce is never reused and duplicate events are ignored (`createAppleAttemptSlot`). Both live only in memory.
    - **Request:** only Apple's `id_token`, the nonce and the first-authorization name go to `POST /api/auth/apple`. The authorization code, and the email, `sub` and relay flag Apple shows the browser, are ignored; the backend reads identity only from the verified token. Success goes through `acceptSession`.
    - **First-authorization name:** Apple sends it only once. If the FitAI request then fails, the name is kept in module memory (never storage) and re-sent on a retry in the same tab, but only for the same Apple account (matched by the token's `sub`, read unverified for this purpose alone). It is forgotten after a successful sign-in and lost on reload. A returning sign-in needs no name.
    - **Errors:** short messages for verification failure, missing email (explains removing FitAI under Apple ID settings), `EMAIL_IN_USE` (as for Google), 429, 503, state mismatch and script or popup failure. A closed or declined popup shows nothing.
    - **Real-provider validation is deferred** (Apple Developer enrollment pending; ADR-028). Not verifiable offline: real Apple JS behavior on repeated `init()` and button re-rendering. A real-Apple test needs an HTTPS domain registered on the Services ID.
  - **Signing out** (explicit logout or a 401) calls `clearUserSessionData()`: it removes the token and every `sessionStorage` key starting with `fitai.user.` (`features/auth/userSession.ts`). Features keep per-tab, per-user data under that prefix (today: the AI Coach conversation) without the auth layer knowing about them.
  - `ApiRequestError` carries the HTTP status, field errors, `retryAfterSeconds` (from a readable `Retry-After` header) and the body's `code`, if any.
  - `ProtectedRoute` redirects unauthenticated users to `/login`.
- There is no email verification, password change or reset, account deletion, session revocation or account linking. Email cannot be changed.

## 4. User, account and preferences

User data is deliberately split across these models (see [ADR-005](DECISIONS.md#adr-005-separate-user-fitnessprofile-and-userpreference)):

| Model | Holds | API |
|---|---|---|
| `User` | Identity and credentials (`email`; `passwordHash`, null for accounts without a password) plus contact/profile details (`firstName`, `lastName`, `phone`, `countryCode`, `bio`) and the private profile-photo storage key (`avatarKey`) | `/api/auth/*`, `/api/account` |
| `FitnessProfile` (optional 1:1) | Coaching context: date of birth, height, target weight, goal, activity level, diet preference, medical notes | `/api/profile` |
| `UserPreference` (optional 1:1) | Display/input units: `bodyWeightUnit`, `workoutLoadUnit`, `heightUnit` | `/api/account/preferences` |
| `AuthIdentity` (0..1 per provider) | External sign-in identities: `provider` (GOOGLE, APPLE) + `providerSubject`, last-seen provider email, private-relay flag ([ADR-028](DECISIONS.md#adr-028-social-sign-in-proves-identity-fitai-owns-the-account-and-session)). Never provider tokens | None yet (sign-in endpoints planned) |

- **Account** (`modules/account`):
  - `GET /api/account` returns identity, contact details and preferences. If the user has no `UserPreference` row it returns the defaults (KG / LB / CM) and does **not** create one.
  - `PATCH /api/account/preferences` upserts the row.
  - `PATCH /api/account/profile` updates names, phone (normalized to E.164 style), country (validated ISO 3166-1 alpha-2) and bio (plain text). Email is read-only.
  - `PUT` / `DELETE /api/account/avatar` set and remove the profile photo. Account responses include `avatarUrl` (signed, expiring) but never `avatarKey`. See "Profile photos and private media" below.
- **Unit preferences are presentation only.** Stored measurements are never converted when they change; see Measurement units below.
- **Frontend:** the Settings page (`/settings`, see section 6) reads and edits the account, unit preferences, profile photo and fitness profile through these endpoints. Other pages read the preferences through `UnitPreferencesProvider` (see "Unit preferences" in section 6).

### Profile photos and private media

See [ADR-024](DECISIONS.md#adr-024-private-profile-photo-object-storage).

- **Storage:** `lib/storage/` defines `ObjectStorage` (`put`, `delete`, `getReadUrl`). Today the only implementation is `LocalObjectStorage`: private files under `backend/storage/` (git-ignored, never served statically), with keys `avatars/<uuid>.webp`. `getObjectStorage()` returns the active instance; tests swap in a temporary directory with `setObjectStorage()`.
- **Upload pipeline** (`lib/images/avatarImage.ts`, `modules/account/avatar.service.ts`):
  1. The route accepts the raw image body (JPEG, PNG or WebP, max 5 MB) after authentication.
  2. sharp reads the header. The format must match the declared type, and the image must be at most 8000 px per side and 40 MP.
  3. sharp decodes, applies EXIF orientation, centre-crops to 512×512 and encodes WebP quality 82. No input metadata survives.
  4. The object is stored first. Then `avatarKey` is swapped inside a transaction holding a row lock. Then the replaced object is deleted, best effort.
- **Removal:** clear `avatarKey` first, then delete the object, best effort. Idempotent.
- **Failures:**
  - A storage failure leaves the old avatar untouched (503).
  - A database failure removes the new object again.
  - A failed delete leaves an orphan, logged as `{ event, key }` only.
- **Reads:** `avatarUrl` is a signed URL (HMAC over key and expiry, about 1 hour, domain-separated from JWTs) served by `GET /api/media/avatars/:file`.
  - That endpoint requires no JWT; the signature is the authorization.
  - It accepts only `<uuid>.webp` names, so traversal fails before storage is touched.
  - It returns 403 for any bad, tampered or expired link, and 404 for a missing object.
  - Responses carry `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and private caching.
- **Orphan sweep:** `npm run storage:sweep-avatars` (see [DEVELOPMENT.md](DEVELOPMENT.md#local-object-storage)) lists unreferenced avatar objects older than 24 hours and deletes them only with `--delete`.
- **Frontend:** `avatarUrl` is root-relative; the client resolves it against `VITE_API_BASE_URL` (`services/apiUrl.ts`, absolute URLs pass through). The Settings photo flow is described in section 6.
- **Not implemented:** S3 or any production object storage, CDN delivery, and avatar-upload throttling.

## 5. Fitness domains

### Measurement units (system-wide invariant)

| Data | Stored as |
|---|---|
| Body weight (`WeightCheckIn.weightKg`), target weight | kg |
| Height (`FitnessProfile.heightCm`) | cm |
| Walking distance (`DailyActivity.walkingDistanceKm`) | km |
| Workout set load (`WorkoutSet.load` + `loadUnit`) | **exactly as entered**, with its own unit (KG or LB); never converted |

Display/input conversion is a presentation concern driven by `UserPreference`. Changing a preference never rewrites history. See [ADR-006](DECISIONS.md#adr-006-canonical-metric-storage-units-are-display-preferences-only) and [ADR-007](DECISIONS.md#adr-007-workout-sets-keep-the-unit-they-were-entered-in).

The frontend converts only at the display and input edge (`features/units/`), and only values the user actually edits are converted back: lb → kg rounded to 0.01 kg, feet and inches → cm rounded to 0.1 cm. A value converted just for display is never sent, so storage cannot drift.

### Calendar dates vs timestamps

Several domains separate the **logical day** from the **moment of recording**:

- `NutritionFoodItem.entryDate` and `WorkoutSession.workoutDate` are client-supplied `YYYY-MM-DD` values in Postgres `DATE` columns. They are converted by string concatenation to UTC midnight (`${date}T00:00:00.000Z`), never by parsing a local time, so the day cannot shift with timezones. They are returned as `YYYY-MM-DD`.
- `DailyActivity.activityDate` is derived from the **calendar-date prefix of the client's `recordedAt` string**, in the client's own offset.
- `recordedAt` is always an ISO-8601 timestamp with an offset.
- AI tools use logical dates (`entryDate`, `workoutDate`, `activityDate`) anchored to the client's validated `today`; weight check-ins are placed on the user's local date with the client's IANA timezone ([ADR-025](DECISIONS.md#adr-025-the-ai-coach-is-anchored-to-the-clients-local-date-and-timezone)). Shared helpers: `lib/dates/calendarDate.ts`.

### Fitness profile (`modules/profile`)

- Create once with `POST`; a second `POST` returns 409. Update with `PATCH /me`; `null` clears a field.
- Validation:
  - Date of birth: `YYYY-MM-DD`, in the past, age 13–120.
  - Height: 50–275 cm. Target weight: 20–400 kg.
  - The enums must match.
  - `medicalNotes`: at most 2000 characters.
- `medicalNotes` is never exposed to the AI.

### Weight check-ins (`modules/checkins`)

Create, list (newest first) and delete. Records are append-only; there is no update. `getWeightTrend` provides deterministic metrics for the AI tool: current vs previous rolling 7-day averages (days averaged first), compared only when each period has check-ins on at least 3 different days. The frontend Progress page and the Dashboard use the check-ins.

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
- The AI workout tool (`getWorkoutGrounding`) reads sessions by `workoutDate` with their exercises and sets, exactly as logged; top loads are summarized per unit and never combined.

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
  context/                  AuthContext + useAuth, ThemeContext + useTheme, UnitPreferencesContext +
                            useUnitPreferences, CoachConversationContext + useCoachConversation
                            (context/hook split for react-refresh)
  services/api.ts           the only HTTP client: request(), types, error class
  services/*.ts             per-domain wrappers and pure helpers (checkins, nutrition, exercises, workouts,
                            account, fitnessProfile)
  features/workout/         WorkoutDraft model + reducer, DOM id helpers, exercise-name helpers
  features/settings/        Settings drafts/diffs/validation, sections, scroll-spy, country list mirror,
                            profile-photo checks and useAvatarImage
  features/navigation/      useUnsavedChangesGuard (shared by the Workout editor and Settings)
  features/theme/theme.ts   theme preference and resolution logic
  features/units/           pure unit conversion, parsing, ranges and formatting (no React)
  features/auth/            user-scoped session storage cleanup, JWT userId claim (storage scoping only)
  features/coach/           Coach message types, history building, storage, sources, client context,
                            conversation reducer and error copy (pure; no React)
  components/ui/            shared primitives: Modal, ConfirmDialog, ChoiceGroup, SegmentedControl,
                            Avatar, Skeleton, icons
  components/               layout (AppLayout, Header, Sidebar), auth, brand, nutrition, workout, settings,
                            coach
  pages/                    one component per route
  index.css                 single global stylesheet, semantic colour tokens
```

- **Routes:**
  - Public: `/login`, `/signup`.
  - Behind `ProtectedRoute` + `AppLayout`: `/` (Dashboard), `/progress`, `/nutrition`, `/workout`, `/workout/new`, `/workout/:id/edit`, `/ai-coach`, `/settings`.
- **State:** React state and context only, with no global state library. Pages load data inside `useEffect` with an `isCurrent` guard against stale responses.
- **Layout:** desktop sidebar; at ≤767px the sidebar becomes an off-canvas drawer (`MOBILE_NAV_QUERY` in `AppLayout.tsx` must match the CSS media query). Other breakpoints: 1100, 900 and 640px.
- **API errors:** `ApiRequestError` carries `status`, the backend's `errors[]` (so forms can map field errors), `retryAfterSeconds` and a machine-readable `code` (e.g. `EMAIL_IN_USE`).
- **Workout editor:**
  - It is a page (`/workout/new?date=`, `/workout/:id/edit`), not a modal ([ADR-014](DECISIONS.md#adr-014-the-workout-editor-is-a-page-not-a-modal)).
  - It edits a single `WorkoutDraft` through `workoutDraftReducer` ([ADR-015](DECISIONS.md#adr-015-a-single-shared-workoutdraft-model-for-workout-entry)). Saving converts the draft into the API payload; editing sends the full exercise list, which the server uses for its replace semantics.
  - Unsaved changes are protected by the shared `useUnsavedChangesGuard` (see below).
  - Frontend limits mirror the backend schemas (`WORKOUT_LIMITS`); the backend remains authoritative.
  - Load units ([ADR-007](DECISIONS.md#adr-007-workout-sets-keep-the-unit-they-were-entered-in)): the draft captures `workoutLoadUnit` when it is created (the page waits for preferences first) and uses it for the first set of each new exercise. "Add set" copies the previous set. Stored sets keep their unit, the unit selector changes only the label, and history shows sets as logged.
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
  - Fitness creates the profile (`POST`) on first save and updates it (`PATCH`) afterwards. Cleared fields are sent as `null`.
  - Fitness height and target weight use the preferred units (height in cm, or whole feet and inches in a labelled group). The draft records the units it was built in and which measurements were edited. A measurement is sent only if it was edited and differs from the saved value shown in the same units, so converted display values never become dirty. A clean card follows a unit change at once; a dirty card keeps its units, with a short note, until Save or Cancel.
  - Units save immediately, optimistically, and roll back on failure. Appearance calls `setTheme()`.
  - Client validation mirrors the backend schemas; server field errors are shown on their fields; drafts survive failures.
  - One page-level unsaved-changes guard covers all three editable cards.
- **Country:** a searchable combobox shows `Intl.DisplayNames` names and stores ISO codes. `features/settings/countries.ts` mirrors the backend's 249 supported codes; the backend stays authoritative.
- **Content rules:** Connections is informational only ([ADR-016](DECISIONS.md#adr-016-health-platform-integrations-are-not-implemented)). `medicalNotes` is not shown. The bio and "What FitAI Coach sees" copy must stay true to the AI profile tool.
- **Profile photo** (`components/settings/ProfilePhoto.tsx`, `PhotoPreviewDialog.tsx`, `features/settings/profilePhoto.ts`):
  - The hero avatar shows the photo, or initials when there is none. "Add/Change photo" and "Remove photo" are real buttons; the avatar itself is a pointer shortcut and the only drag-and-drop target.
  - Selection checks type (JPEG, PNG, WebP), size (5 MB) and decoded dimensions (8000 px per side, 40 MP) before anything is sent. These checks are UX only; the backend validates again and stays authoritative.
  - A preview dialog (`components/ui/Modal.tsx`) shows the photo in the same circle with `object-fit: cover` centred, which matches the server's EXIF-oriented centre crop, plus file name, type, size and dimensions. Nothing is uploaded until Save. Upload sends the raw file (`PUT /api/account/avatar`, no progress percentage).
  - A failed upload keeps the dialog and the selected file, shows a friendly message for 400/413/415/503/network errors, and offers "Try again" without reselecting. A 401 follows the normal sign-out handling.
  - Removal goes through `ConfirmDialog`; on failure the photo stays.
  - Object URLs for previews are created in event handlers and revoked when replaced, cancelled, saved or on unmount, but kept after a failed upload so Retry still has the image.
  - SettingsPage stays the owner of the account. Successful uploads and removals replace it with the server response. A selected but unsaved photo is not part of the unsaved-changes guard.
  - **Expired or failed images** (`useAvatarImage`): the avatar hides the image and shows initials, refetches the account once (merging only `avatarUrl`), and retries once per photo. If that also fails it stays on initials, with no loop. An unloaded image is transparent, so a broken-image icon never appears.
- **Not implemented:** interactive cropping, camera capture, an avatar in the app header, password change, account deletion, email change.

### Unit preferences

See [ADR-006](DECISIONS.md#adr-006-canonical-metric-storage-units-are-display-preferences-only) and [ADR-007](DECISIONS.md#adr-007-workout-sets-keep-the-unit-they-were-entered-in).

- `UnitPreferencesProvider` (`context/UnitPreferencesContext.tsx`) is mounted by `AppLayout`, so only signed-in pages load preferences. It fetches `GET /api/account` once and exposes `{ preferences, isLoading, setPreferences }` through `useUnitPreferences()`.
- If the request fails, the backend defaults (KG / LB / CM) are used; preferences only affect display, so this cannot corrupt data.
- Settings keeps its own account fetch and pushes loaded or saved preferences into the provider, so the rest of the tab updates immediately. Once Settings has supplied preferences, a slower initial response cannot overwrite them.
- Pages that render units (Progress, Dashboard, the Workout editor) wait for `isLoading` to finish, so no input starts in the wrong unit.
- There is no cross-tab sync: other tabs pick up changes on their next load.
- Applied to: body weight on Progress (current, history, add check-in, including the 500 kg / 1102.3 lb maximum), the Dashboard latest weight, and Settings target weight; height in Settings; the default unit for new workout exercises. Display uses at most one decimal (kg, lb, cm) or whole inches.
- AI tools stay canonical (`weightKg`, `heightCm`) and add deterministic display values in the preferred units; the preferences are sent to the model as display metadata ([AI-SYSTEM.md](AI-SYSTEM.md)).

### AI Coach

See [ADR-026](DECISIONS.md#adr-026-ai-coach-conversation-context-is-client-held-bounded-and-untrusted) and [AI-SYSTEM.md](AI-SYSTEM.md).

- `pages/AICoachPage.tsx` with components in `components/coach/` and pure logic in `features/coach/`.
- **State:** `CoachConversationProvider` is mounted by `AppLayout`, so the conversation survives route changes and is discarded when sign-out unmounts the layout. It owns the single in-flight request: one request at a time, not abandoned by leaving the page, aborted on sign-out or New conversation. A generation counter and an owner check stop late responses from changing state or storage.
- **Storage:** `sessionStorage["fitai.user.coach.conversation.v1"]` holds `{ version, userId, messages }` with completed messages only (newest 60). `userId` comes from the stored token's claim and must match on load; anything malformed, another user's or another version is discarded. Storage failures fall back to memory.
- **Requests:** `clientContext` (local today and the browser's IANA timezone) is computed at send time; if no valid timezone is available the question is kept with a retryable error and no request is made (no fallback timezone). History is built from completed messages only (`buildCoachHistory`), newest turns within the backend limits; assistant turns are flattened as answer + action items + follow-up question and truncated with "…".
- **Failures:** the question stays visible with Retry (same question, same history) and Edit; a 429 with a readable `Retry-After` shows a countdown.
- **Rendering:** React text only (no HTML or Markdown). Sources show public categories and local dates, never tool names.
- **Layout:** the page scrolls as a whole with a sticky composer; replies scroll to their start when the reader is at the bottom, otherwise "Jump to latest" appears.

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

- `POST /api/ai/coach`: a message, the client's local date and timezone, and optional bounded client-held history (untrusted text turns, never stored; [ADR-026](DECISIONS.md#adr-026-ai-coach-conversation-context-is-client-held-bounded-and-untrusted)) in; a structured `{ answer, actionItems, followUpQuestion }` plus server-derived `sources` out. It is driven by a tool-calling loop over 5 **read-only** tools (profile, weight, nutrition, activity, workout history) that wrap domain services.
- **Grounding:** tools work on the user's logical dates and rolling 7-day periods, return deterministic metrics (averages, sufficiency verdicts, protein per kg) plus display values in the user's preferred units, and bound every list they return.
- **Hardening:** at most 5 provider calls, 5 tool calls per turn (one per tool) and 8 per request, a 45-second deadline, a 25-second provider timeout with one retry, and a per-user rate limit. Logs carry metadata only.
- `POST /api/ai/nutrition/estimate` is a tool-less structured estimate that never persists anything.
- The model never touches the database, never chooses `userId`, and its output is Zod-validated before it is returned.
- **Frontend:** the Coach page described in section 6.
- **Evaluation:** an opt-in live-model evaluation harness with an optional in-process observer on the coach service (no effect when absent); see [AI-SYSTEM.md](AI-SYSTEM.md#evaluation-phase-1d). Phase 1D evaluated the coach-v3 baseline, hardened it (coach-v4, then coach-v5 with a per-turn cap of 5) and accepted coach-v5 after a full live comparison; see [docs/evals/AI-COACH-PHASE-1D.md](evals/AI-COACH-PHASE-1D.md).
- **Not implemented:** persisted conversations and long-term memory, any AI write actions, streaming, and RAG.

## 8. Database access

- Prisma 7 with the `prisma-client` generator, output in `backend/src/generated/prisma` (generated, git-ignored).
- The client uses the `@prisma/adapter-pg` driver adapter (`src/lib/prisma.ts`). Configuration is in `backend/prisma.config.ts`.
- Multi-step writes use `prisma.$transaction(async tx => …)`.
- Unique-constraint races (P2002) are translated into domain results: 409 for duplicate activity days, "existing" for exercises, "already registered" for email.

See [DATABASE.md](DATABASE.md).

## 9. Testing

- **Backend:**
  - Node's built-in test runner with `tsx` (`backend/test/*.test.ts`: auth, account, avatar, profile, exercises, workouts, route smoke checks, and the AI Coach's dates, client context, display units, rate limiter, grounding tools and loop) runs against the real Express app and a **separate PostgreSQL database**.
  - The coach loop is tested with a scripted fake `ModelProvider` (`setModelProvider()`), and the OpenAI adapter against a local fake Responses API, so no OpenAI key is needed.
  - **Live AI evaluation is separate** ([ADR-027](DECISIONS.md#adr-027-live-ai-coach-evaluation-is-opt-in-isolated-and-deterministic-first)): `npm run eval:coach` (`backend/scripts/coach-eval/`) runs fixed scenarios against the real model and the test database only, with synthetic users, explicit opt-in and spending ceilings. It is never part of `npm test`; its own logic is tested offline by `coach-eval-harness.test.ts`.
  - `scripts/run-tests.mjs` requires `TEST_DATABASE_URL`, refuses to run against the development database, applies migrations, seeds the catalogue, and runs the files serially.
  - Tests create uniquely named users through the real API and delete them afterwards; cascades clean up their data.
- **Frontend:** `npm test` runs dependency-free `node --test` suites in `frontend/tests/` against pure modules (unit conversion, the Fitness draft's no-drift rules, workout load-unit defaults). Node strips TypeScript types; a small resolve hook (`tests/support/resolve-ts.mjs`) handles extensionless imports. There are no component or browser tests: verification is also `npm run build` (`tsc -b` + Vite) and `npm run lint`, and UI changes are checked with ad-hoc headless-browser runs that are not part of the repository.

## 10. Infrastructure

- `docker-compose.yml` runs a local `postgres:17` container on host port 5433 with a named volume. Its credentials are local-development-only values.
- Uploaded media (profile photos) is stored on the backend host's filesystem under `backend/storage/` (git-ignored). There is no shared or production object storage yet.
- Backend and frontend run on the host (`npm run dev`).
- **Not implemented:** production hosting, Nginx reverse proxy, HTTPS, secrets management, CI/CD, and backups. The README roadmap lists AWS deployment as planned.

## 11. Invariants checklist

Before merging, check that a change doesn't break any of these:

1. The identity is the JWT `userId`. It is never taken from the client or from model output.
2. Every user-owned query is scoped by `userId`; resources owned by someone else return 404, the same as missing ones.
3. The backend is authoritative for validation; frontend limits only mirror it.
4. Stored measurements are canonical (kg, cm, km). Workout set loads keep their entered unit. Preferences never rewrite data, and a value converted only for display is never sent back.
5. Logical dates (`entryDate`, `workoutDate`) are `YYYY-MM-DD`, stored at UTC midnight by concatenation.
6. Workout exercise/set positions are server-assigned; `exercises` on PATCH means full replacement, inside one transaction.
7. Built-in exercises are immutable via the API and identified by a permanent `builtInKey`; custom exercises are private.
8. AI output is untrusted until validated. AI never persists data directly: AI proposes, the user confirms, the normal API persists. Tool output is data, never instructions, and every tool result is bounded.
9. `medicalNotes` and `bio` are never sent to the model.
10. Theme preference is browser-local; `data-theme` holds only a resolved theme; colours come only from tokens.
11. Media objects are private. The database stores only opaque keys (never URLs or image data), clients see only signed, expiring URLs, and an object is deleted only after the database stopped referencing it.
12. Deleting a `User` row does **not** delete their stored objects. Any account-deletion feature must explicitly delete the user's avatar object (ADR-024).
13. A sign-in identity is recognised only by provider + subject, never by email, and is never linked to an account by matching emails. Provider tokens are never stored. Every sign-in method ends in the same FitAI JWT, and an account without a password can never use password login (ADR-028).
