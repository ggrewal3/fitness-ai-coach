# FitAI HTTP API

Last reviewed: 2026-10-04

An engineering reference for the API as implemented. The Zod schemas in `backend/src/modules/*/*.schemas.ts` are the executable source of truth for exact limits; this document records the contracts and behavior that matter.

## Conventions

- **Base path:** `/api`. JSON in and out. The dev server listens on `PORT` (default 5001).
- **Authentication:** every endpoint except `/api/health`, `/api/auth/register` and `/api/auth/login` requires `Authorization: Bearer <jwt>`.
  - Missing header → `401 {"message":"Authentication required."}`.
  - Malformed header → `401 {"message":"Invalid authorization format."}`.
  - Bad or expired token → `401 {"message":"Invalid or expired token."}`.
- **Identity:** the user is always taken from the token. **No endpoint accepts `userId`**; strict schemas reject it as an unknown key.
- **Ownership:** a resource owned by another user returns the same `404` as a missing one.
- **Validation errors:** `400 {"message":"Validation failed.","errors":[{"field":"…","message":"…"}]}`.
  - `field` is a dotted path, such as `exercises.0.sets.1.load`.
  - `field` is `"body"` for object-level errors (unknown keys, empty update) and `"query"` for query-string errors.
  - Invalid numeric `:id` params return `400` with a specific message, e.g. "Invalid workout session ID."
- **"Strict"** means unknown keys are rejected. **"Partial"** means any subset of fields, with at least one required.
- **Timestamps** (`recordedAt`) are ISO-8601 with an offset. **Logical dates** (`entryDate`, `workoutDate`) are `YYYY-MM-DD`.
- **Malformed JSON:** a body that isn't valid JSON returns `400 {"message":"Request body must be valid JSON."}`; the body is never logged.
- **Unexpected errors:** `500 {"message":"Internal Server Error"}`.

## Health and diagnostics

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | No | `{ status: "success", message }` |
| GET | `/api/protected-test` | Yes | Diagnostic: confirms the token is valid. Not used by the frontend |

## Auth (`modules/auth`)

| Method | Path | Auth | Request | Success |
|---|---|---|---|---|
| POST | `/api/auth/register` | No | `firstName`, `lastName` (non-empty), `email`, `password` | `201` user: `{ id, firstName, lastName, email, createdAt, updatedAt }` |
| POST | `/api/auth/login` | No | `email`, `password` | `200 { token, user: { id, firstName, lastName, email } }` |
| POST | `/api/auth/nonce` | No | strict: `provider` (`GOOGLE` or `APPLE`) | `201 { provider, nonce, expiresAt }` |
| POST | `/api/auth/google` | No | strict: `credential` (Google ID token, ≤ 8,192 chars), `nonce` (≤ 128) | `200 { token, user: { id, firstName, lastName, email }, isNewUser }` |
| POST | `/api/auth/apple` | No | strict: `idToken` (Apple ID token, ≤ 8,192 chars), `nonce` (≤ 128), optional `firstName`, `lastName` (≤ 200 each) | `200 { token, user: { id, firstName, lastName, email }, isNewUser }` |

- **Email:** trimmed, lower-cased, and must be a valid email address.
- **Register password:** at least 8 characters and at most **72 UTF-8 bytes** (bcrypt limit; multibyte characters count more than once).
- **Errors:** registering a duplicate email, including case variants, returns `409 {"message":"Email already registered."}`. A bad login returns `401 {"message":"Invalid email or password."}`, whichever part was wrong, including for accounts that have no password (future Google/Apple-only accounts, ADR-028).
- **Token:** JWT `{ userId }` signed HS256, expiring after 1 hour. Protected routes accept only HS256-signed tokens.
- **Strictness:** these bodies are not strict; unknown keys are stripped. Registering does not return a token.
- **Rate limits (per client IP, in process memory):** each endpoint has its own bucket, checked before validation, so invalid requests count too. Over the limit: `429 {"message":"Too many attempts. Please wait a moment and try again."}` with `Retry-After` (seconds).

  | Endpoint | Per minute | Per hour |
  |---|---|---|
  | `register` | 5 | 30 |
  | `login` | 10 | 100 |
  | `nonce` | 20 | 200 |
  | `google` | 10 | 100 |
  | `apple` | 10 | 100 |

- **Google sign-in ([ADR-028](DECISIONS.md#adr-028-social-sign-in-proves-identity-fitai-owns-the-account-and-session)):** used by the Login and Signup pages. The frontend treats a 401 from these sign-in endpoints as a failed sign-in, not an expired session.
  1. `POST /api/auth/nonce` with `{ "provider": "GOOGLE" }` returns a random nonce, valid for 10 minutes and usable **once**. The client passes it to Google Identity Services.
  2. `POST /api/auth/google` sends Google's ID token (`credential`) and that nonce. The nonce is consumed first, whatever happens next. The token must be RS256-signed by Google, from issuer `https://accounts.google.com` or `accounts.google.com`, for audience `GOOGLE_CLIENT_ID`, unexpired (60 s clock tolerance), not issued in the future, with a `sub` and the same `nonce`.
  3. A known Google identity (provider + `sub`) logs in, even if its Google email changed or is missing. The account's email is never changed.
  4. An unknown identity creates a new account with no password. This needs a Google-verified email (`email_verified: true`), normalized like registration. The name comes from `given_name` / `family_name`, else the placeholder "FitAI Member". Then `isNewUser: true`.
  - **Errors:**
    - `400` validation;
    - `401 {"message":"We couldn't verify your Google account. Please try again."}` for any token or nonce failure;
    - `401` with an explanation when a new account's Google email isn't verified (with `"code":"MISSING_EMAIL"` if the token has no email at all);
    - `409 {"code":"EMAIL_IN_USE","message":"An account with this email already exists. Sign in the way you usually do, for example with your password."}`: nothing is created or linked, and accounts are never linked by email;
    - `503 {"message":"Google sign-in is unavailable right now."}` when `GOOGLE_CLIENT_ID` is unset or Google's keys can't be fetched (the nonce endpoint also returns 503 when it is unset);
    - `429` rate limit.
  - **Success** returns the same session token as password login.
- **Sign in with Apple ([ADR-028](DECISIONS.md#adr-028-social-sign-in-proves-identity-fitai-owns-the-account-and-session)):** used by the Login and Signup pages (Apple JS, popup mode). As for Google, a 401 here is a failed sign-in, not an expired session.
  1. Get a nonce with `{ "provider": "APPLE" }`.
  2. Send Apple's ID token (`idToken`) and that nonce to `POST /api/auth/apple`, plus the name Apple gives the browser on the first authorization, if any. The nonce is consumed first.
  3. The token is checked server-side:
     - RS256 against Apple's published keys;
     - issuer `https://appleid.apple.com`, audience `APPLE_CLIENT_ID` (the Services ID);
     - `exp` and `iat` required and not in the future, `nbf` if present, 60 s tolerance;
     - a non-empty `sub` of at most 255 characters;
     - the same `nonce`.
  4. `email_verified` and `is_private_email` count only as `true` or `"true"`.
  - **Identity:** the person is recognised **only** by provider + `sub`. A returning identity needs neither email nor name, and its account's email and names never change. Its stored provider email (and relay flag) refreshes only from a verified email in the token.
  - **New account:** needs a verified email from the token. Apple private-relay addresses (`…@privaterelay.appleid.com`) are accepted normally and stored with `isPrivateEmail: true`.
  - **Names:** `firstName` / `lastName` are unsigned profile data, used only to name a new account (cleaned and cut to 50; a missing part becomes "FitAI" / "Member"). They are never used to find or link an account.
  - **Errors:**
    - `400` validation;
    - `401 {"message":"We couldn't verify your Apple account. Please try again."}` for any token or nonce failure;
    - `401 {"code":"MISSING_EMAIL","message":"Apple didn't share the email address FitAI needs to create your account."}` when an unknown identity has no usable email. FitAI never invents one. Removing FitAI under Apple ID → Sign in with Apple and authorizing again *may* make Apple share it;
    - `401` when a new account's email isn't verified;
    - `409 EMAIL_IN_USE` as for Google, including when the email belongs to a Google-created account; nothing is linked;
    - `503 {"message":"Apple sign-in is unavailable right now."}` when `APPLE_CLIENT_ID` is unset or Apple's keys can't be fetched (the APPLE nonce is also 503 then);
    - `429` rate limit.
  - **Success:** `200 { token, user, isNewUser }`, the same FitAI session as every other sign-in.
  - **Not done:** no authorization code is accepted or exchanged, and there is no Apple client secret, refresh token or revocation.
- **Not implemented:** account linking, logout (client-side only), refresh, password change or reset, email verification, account deletion.

## Account and settings (`modules/account`)

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/api/account` | none | `{ id, firstName, lastName, email, phone, countryCode, bio, avatarUrl, createdAt, preferences: { bodyWeightUnit, workoutLoadUnit, heightUnit } }` |
| PATCH | `/api/account/profile` | strict, partial: `firstName`, `lastName`, `phone`, `countryCode`, `bio` | `200` same shape as GET |
| PATCH | `/api/account/preferences` | strict, partial: `bodyWeightUnit` (`KG`/`LB`), `workoutLoadUnit` (`KG`/`LB`), `heightUnit` (`CM`/`FT_IN`) | `200 { bodyWeightUnit, workoutLoadUnit, heightUnit }` |
| PUT | `/api/account/avatar` | **raw image body** (not JSON) with `Content-Type: image/jpeg`, `image/png` or `image/webp`; max 5 MB | `200` account (same shape as GET) with the new `avatarUrl` |
| DELETE | `/api/account/avatar` | none | `200` account with `avatarUrl: null` (idempotent) |

- **GET** returns the defaults `KG` / `LB` / `CM` if no preference row exists, and does not create one. **PATCH preferences** upserts the row.
- **Field rules:**
  - Names: trimmed, 1–50 characters, not nullable.
  - `phone`: string or `null`, at most 40 characters of input. Spaces, `-`, `.` and parentheses are stripped. The result must match `^\+[1-9]\d{7,14}$`. Blank becomes `null`. No uniqueness check, no SMS verification.
  - `countryCode`: string or `null`, trimmed and upper-cased. Must be one of the 249 officially assigned ISO 3166-1 alpha-2 codes (`countryCodes.ts`). Blank becomes `null`.
  - `bio`: string or `null`. `\r\n`/`\r` become `\n`, then the value is trimmed; at most 500 characters; blank becomes `null`. Tab and line feed are allowed; other C0/C1 control characters are rejected. Stored verbatim as plain text.
- **Email is read-only:** an `email` key is rejected (`400`, field `body`).
- **Errors:** if the token's user no longer exists, every account route returns `404 {"message":"User not found."}`.
- **`avatarUrl`** (all account responses): `null`, or a signed read URL valid for about 1 hour (ADR-024).
  - With local storage it is root-relative, for example `/api/media/avatars/<uuid>.webp?expires=…&signature=…`; resolve it against the API origin (`new URL(avatarUrl, apiBaseUrl)`).
  - Treat it as opaque and refresh it by re-fetching the account rather than caching it long-term. The storage key itself is never returned.
- **Profile photo upload** (`PUT /api/account/avatar`):
  - Authentication is checked before the body is read. There is no target user in the path, query or body; it always changes the token's user.
  - The bytes must decode as the declared format. The server stores a re-encoded 512×512 WebP: EXIF orientation applied, centre-cropped, all metadata removed. The original is not kept.
  - Replacing a photo deletes the previous one only after the new one is active.
  - Errors:
    - `415` missing or unsupported `Content-Type`.
    - `413 {"message":"Profile photos must be 5 MB or smaller."}`.
    - `400 {"message":…}` for empty, corrupt, truncated or disguised files, or images over 8000 px per side or 40 MP.
    - `503` when storing fails; the previous photo is kept.
    - `401`, and `404` if the user no longer exists.
  - A body sent as `application/json` that isn't valid JSON is rejected with `400` by the app-wide JSON parser, as on every route (see Conventions).
- **Profile photo removal** (`DELETE /api/account/avatar`): clears the photo first, then deletes the stored object (best effort). Calling it with no photo also returns `200`.
- Changing preferences **never converts stored data** (see [DATABASE.md](DATABASE.md#canonical-units)).

## Fitness profile (`modules/profile`)

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/api/profile/me` | none | `{ id, firstName, lastName, email, createdAt, profile: {…} \| null }` |
| POST | `/api/profile` | strict; any subset of the profile fields, including none | `201` profile row |
| PATCH | `/api/profile/me` | strict, partial | `200` profile row |

- **Profile fields** (all nullable; `null` clears a field on PATCH):
  - `dateOfBirth`: `YYYY-MM-DD`, in the past, age 13–120.
  - `heightCm`: 50–275.
  - `targetWeightKg`: 20–400.
  - `goal`: `LOSE_FAT` | `MAINTAIN` | `GAIN_MUSCLE`.
  - `activityLevel`: `SEDENTARY` | `LIGHT` | `MODERATE` | `ACTIVE` | `VERY_ACTIVE`.
  - `dietPreference`: `NO_PREFERENCE` | `VEGETARIAN` | `VEGAN` | `PESCATARIAN` | `HALAL`.
  - `medicalNotes`: trimmed, at most 2000 characters; blank becomes `null`.
- **Errors:**
  - A second `POST` → `409 {"message":"Fitness profile already exists."}` (nothing changes).
  - `PATCH` before a profile exists → `404 {"message":"Fitness profile not found."}`.
  - `GET` for a deleted user → `404`.
- `medicalNotes` is returned by these endpoints but never given to the AI.

## Weight check-ins (`modules/checkins`)

| Method | Path | Request | Success |
|---|---|---|---|
| POST | `/api/checkins` | `weightKg` (> 0, ≤ 500), `recordedAt` | `201` check-in row |
| GET | `/api/checkins` | none | `200` all of the user's check-ins, newest `recordedAt` first |
| DELETE | `/api/checkins/:id` | none | `204`, or `404 {"message":"Check-in not found."}` |

- Weight is always kg.
- The body is not strict (unknown keys are stripped).
- There is no update endpoint.
- Rows include `userId`, `createdAt` and `updatedAt`, because the raw Prisma row is returned.

## Nutrition (`modules/nutrition`)

| Method | Path | Request | Success |
|---|---|---|---|
| POST | `/api/nutrition` | strict food item (below) | `201` item |
| GET | `/api/nutrition` | none | `200` all of the user's items, ordered by `entryDate` desc, then `recordedAt` desc |
| GET | `/api/nutrition/summary/:date` | `:date` = `YYYY-MM-DD` | `200 { entryDate, found, totalCalories, totalProteinGrams, totalCarbsGrams, totalFatGrams, numberOfFoodItems }` |
| PATCH | `/api/nutrition/:id` | strict, partial | `200` item |
| DELETE | `/api/nutrition/:id` | none | `204` |

- **Food item fields:**
  - `foodName` (1–200), `quantity` (> 0), `unit` (1–20 characters, free text).
  - `calories`: integer, > 0, ≤ 15000.
  - `proteinGrams`, `carbsGrams`, `fatGrams`: ≥ 0.
  - `mealType`: `BREAKFAST` | `LUNCH` | `DINNER` | `SNACK` | `OTHER`.
  - `source`: `MANUAL` (default) | `AI_TEXT` | `AI_PHOTO`.
  - `entryDate`: `YYYY-MM-DD`. `recordedAt`: timestamp.
  - Items are returned with `id`, `createdAt` and `updatedAt`; `entryDate` is serialized as a UTC-midnight timestamp.
- **Errors:** not owned or missing → `404 {"message":"Nutrition food item not found."}`. An invalid summary date → `400 {"message":"Invalid date. Use YYYY-MM-DD."}`.
- **Unused today:** no endpoint produces `AI_PHOTO` estimates; the value is only accepted.

## Activity (`modules/activity`)

| Method | Path | Request | Success |
|---|---|---|---|
| POST | `/api/activity` | strict: `steps` (int, 0–200000), `walkingDistanceKm?` (0–500), `activeCalories?` (int, 0–20000), `recordedAt` | `201` activity |
| GET | `/api/activity` | none | `200` all of the user's entries, newest day first |
| PATCH | `/api/activity/:id` | strict, partial | `200` activity |
| DELETE | `/api/activity/:id` | none | `204` |

- **One entry per user per calendar day.** The day is the `YYYY-MM-DD` prefix of `recordedAt` exactly as sent, in the client's offset. A second entry on the same day, including one created by changing `recordedAt` in a PATCH, returns `409` with a conflict message.
- `source` cannot be set and is always `MANUAL`.
- Responses are `{ id, steps, walkingDistanceKm, activeCalories, source, recordedAt, createdAt, updatedAt }`. The derived `activityDate` is **not** returned.
- Not owned or missing → `404 {"message":"Activity entry not found."}`.
- No frontend uses these endpoints yet.

## Exercises (`modules/exercises`)

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/api/exercises?search=&limit=` | `search` ≤ 60 characters (optional); `limit` 1–50, default 20 | `200 [{ id, name, isCustom }]` |
| POST | `/api/exercises` | strict: `name` | `201 { exercise, created: true }` or `200 { exercise, created: false }` |

- **Visibility:** built-in exercises plus the caller's own custom exercises; never another user's.
- **Search:** normalized query, ranked exact → prefix → word-prefix → substring, with alphabetical tie-breaks. An empty search returns one alphabetical list.
- **`name`:** normalized for display, 2–60 characters. Allowed characters are letters, digits, spaces and `- ' ’ ( ) / & . , +`, and the name must contain a letter or digit.
- **Find-or-create:** returns a matching built-in first, then the caller's existing custom exercise; otherwise creates a private custom exercise.
- **Limit:** more than 500 custom exercises → `400` with field `name`.
- Built-in exercises cannot be created, edited or deleted. There are no update or delete endpoints.

## Workouts (`modules/workouts`)

| Method | Path | Request | Success |
|---|---|---|---|
| POST | `/api/workouts` | strict workout (below); `exercises` defaults to `[]` | `201` workout detail |
| GET | `/api/workouts?from=&to=&limit=` | `from`/`to`: `YYYY-MM-DD`, with `from` ≤ `to`; `limit` 1–100, default 20 | `200` summaries |
| GET | `/api/workouts/date/:date` | `YYYY-MM-DD` | `200` workout details for that `workoutDate`, oldest `recordedAt` first |
| GET | `/api/workouts/:id` | none | `200` workout detail |
| PATCH | `/api/workouts/:id` | strict, partial | `200` workout detail |
| DELETE | `/api/workouts/:id` | none | `204` (cascades to exercises and sets) |

- **Workout fields:**
  - `title` (trimmed, 1–100), `workoutDate`, `trainingType` (`STRENGTH` | `CARDIO` | `MOBILITY` | `SPORT` | `OTHER`).
  - `durationMinutes`: integer, 1–1440.
  - `notes?`: ≤ 2000 characters; blank becomes `null`; PATCH accepts `null`.
  - `recordedAt`.
  - `exercises`: at most 30 items, each `{ exerciseId, sets: [1–20 × { reps, load?, loadUnit? }] }`.
- **Set fields:**
  - `reps`: integer, 1–1000.
  - `load`: > 0, ≤ 2000, at most 2 decimal places, or `null`/omitted for bodyweight.
  - `loadUnit` (`KG` | `LB`) is required exactly when `load` is present.
- **Positions:** clients never send them; array order becomes `position`.
- **Exercise references:** every `exerciseId` must be a built-in or the caller's own custom exercise. Missing and foreign IDs both return `400 {"message":"Validation failed.","errors":[{"field":"exercises.N.exerciseId","message":"Exercise not found."}]}`.
- **PATCH semantics:** if `exercises` is present it **replaces every nested exercise and set** (`[]` clears them), in one transaction with the session row locked. If it is absent, nested data is untouched. Nested exercise and set IDs change on replacement.
- **Response shapes:**
  - Detail: `{ id, title, workoutDate, trainingType, durationMinutes, notes, recordedAt, exercises: [{ id, position, exercise: { id, name, isCustom }, sets: [{ id, position, reps, load, loadUnit }] }] }`.
  - Summary: the session fields plus `exerciseCount` and `setCount`, ordered by `workoutDate` desc, then `recordedAt` desc, then `id` desc.
- **Errors:** not owned or missing → `404 {"message":"Workout session not found."}`.

## Media (`modules/media`)

| Method | Path | Auth | Success |
|---|---|---|---|
| GET | `/api/media/avatars/:file?expires=&signature=` | **No JWT**; the signed URL is the authorization | `200` image bytes |

- **How URLs are obtained:** only from `avatarUrl` in account responses. Clients never build them.
- **Validation:**
  - `:file` must be `<uuid>.webp`; anything else, including traversal attempts, returns `404`.
  - The signature must match exactly this key and `expires`, and must not have expired. Otherwise `403 {"message":"This media link is invalid or has expired."}`, the same response for every failure.
  - A valid link to a missing object returns `404 {"message":"Not found."}`.
- **Response headers:** `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline`, and `Cache-Control: private, max-age=<seconds until expiry>`.
- **Scope:** this endpoint exists for local storage. A future S3 adapter would return presigned storage URLs instead.

## AI (`modules/ai`)

Both endpoints are authenticated, read/compute only, and **never persist data**. See [AI-SYSTEM.md](AI-SYSTEM.md).

| Method | Path | Request | Success |
|---|---|---|---|
| POST | `/api/ai/coach` | strict: `message` (trimmed, 1–2000), `clientContext: { today, timeZone }`, optional `history: [{ role, content }]` | `200 { answer, actionItems: string[≤5], followUpQuestion: string \| null, sources: [{ type, startDate, endDate }] }` |
| POST | `/api/ai/nutrition/estimate` | strict: `foodName` (1–200), `quantity` (> 0), `unit` (1–20) | `200 { foodName, quantity, unit, calories, proteinGrams, carbsGrams, fatGrams, note }` |

- **Coach:** the coach may call read-only tools over the caller's own data. Nothing is stored between requests.
  - `history` (optional, default `[]`): earlier turns, oldest first, **without** the current `message`. Each turn is strict `{ role: "user" | "assistant", content }`; content is trimmed and non-empty. At most 10 turns, user turns ≤ 2,000 characters, assistant turns ≤ 4,000, total ≤ 12,000. Roles need not alternate. Invalid or oversized history returns 400 (paths such as `history`, `history.3.content`, `history.0.role`); the server never trims it. History is untrusted conversational context, never evidence ([ADR-026](DECISIONS.md#adr-026-ai-coach-conversation-context-is-client-held-bounded-and-untrusted)).
  - `sources`: what the coach reviewed, derived by the server from successful tool runs. `type` is `profile`, `weight`, `nutrition`, `activity` or `workouts`; `startDate`/`endDate` (`YYYY-MM-DD`, the user's calendar) give the reviewed window and are null for `profile`. One entry per type, in order of first use; `[]` when no data was reviewed.
  - `clientContext.today` is the user's local date (`YYYY-MM-DD`) and `clientContext.timeZone` an IANA name (e.g. `Europe/London`; raw offsets are rejected). `today` must be within ±1 day of the server's current date in that timezone. Field errors use paths such as `clientContext.today`; unknown top-level keys are rejected (field `body`).
  - Rate limited per user: 10 requests per minute and 150 per day. Every authenticated request counts, including invalid ones and ones that fail upstream; refused (429) requests do not.
- **Estimate:** `foodName`, `quantity` and `unit` are echoed from the request, never from the model. The result is a proposal; saving it is a separate `POST /api/nutrition` (typically with `source: "AI_TEXT"`).
- **Errors:**
  - Provider unavailable, unconfigured or timed out → `503` ("AI Coach is temporarily unavailable." / "Nutrition estimation is temporarily unavailable.").
  - Model output fails schema validation, or the model refuses → `502` ("AI Coach returned an invalid response.").
  - Coach only: the model still asks for tools on its last permitted turn → `502` ("AI Coach couldn't complete a response. Try asking a more specific question.").
  - Coach only: the 45-second request deadline passes → `504` ("AI Coach took too long to respond. Please try again.").
  - Coach only: rate limit → `429` with `Retry-After` (seconds) and a message.
- The frontend uses the estimate endpoint (Nutrition modal) and the coach endpoint (`/ai-coach`).
- `Retry-After` (seconds) is listed in `Access-Control-Expose-Headers`, so cross-origin browsers can read it.
