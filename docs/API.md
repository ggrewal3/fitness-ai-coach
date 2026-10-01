# FitAI HTTP API

Last reviewed: 2026-10-01

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

- **Email:** trimmed, lower-cased, and must be a valid email address.
- **Register password:** at least 8 characters and at most **72 UTF-8 bytes** (bcrypt limit; multibyte characters count more than once).
- **Errors:** registering a duplicate email, including case variants, returns `409 {"message":"Email already registered."}`. A bad login returns `401 {"message":"Invalid email or password."}`, whichever part was wrong.
- **Token:** JWT with `userId`, expiring after 1 hour.
- **Strictness:** these bodies are not strict; unknown keys are stripped. Registering does not return a token.
- **Not implemented:** logout (client-side only), refresh, password change or reset, email verification, account deletion.

## Account and settings (`modules/account`)

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/api/account` | none | `{ id, firstName, lastName, email, phone, countryCode, bio, createdAt, preferences: { bodyWeightUnit, workoutLoadUnit, heightUnit } }` |
| PATCH | `/api/account/profile` | strict, partial: `firstName`, `lastName`, `phone`, `countryCode`, `bio` | `200` same shape as GET |
| PATCH | `/api/account/preferences` | strict, partial: `bodyWeightUnit` (`KG`/`LB`), `workoutLoadUnit` (`KG`/`LB`), `heightUnit` (`CM`/`FT_IN`) | `200 { bodyWeightUnit, workoutLoadUnit, heightUnit }` |

- **GET** returns the defaults `KG` / `LB` / `CM` if no preference row exists, and does not create one. **PATCH preferences** upserts the row.
- **Field rules:**
  - Names: trimmed, 1–50 characters, not nullable.
  - `phone`: string or `null`, at most 40 characters of input. Spaces, `-`, `.` and parentheses are stripped. The result must match `^\+[1-9]\d{7,14}$`. Blank becomes `null`. No uniqueness check, no SMS verification.
  - `countryCode`: string or `null`, trimmed and upper-cased. Must be one of the 249 officially assigned ISO 3166-1 alpha-2 codes (`countryCodes.ts`). Blank becomes `null`.
  - `bio`: string or `null`. `\r\n`/`\r` become `\n`, then the value is trimmed; at most 500 characters; blank becomes `null`. Tab and line feed are allowed; other C0/C1 control characters are rejected. Stored verbatim as plain text.
- **Email is read-only:** an `email` key is rejected (`400`, field `body`).
- **Errors:** if the token's user no longer exists, all three routes return `404 {"message":"User not found."}`.
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

## AI (`modules/ai`)

Both endpoints are authenticated, read/compute only, and **never persist data**. See [AI-SYSTEM.md](AI-SYSTEM.md).

| Method | Path | Request | Success |
|---|---|---|---|
| POST | `/api/ai/coach` | `message` (trimmed, 1–2000; not strict) | `200 { answer, actionItems: string[≤5], followUpQuestion: string \| null }` |
| POST | `/api/ai/nutrition/estimate` | strict: `foodName` (1–200), `quantity` (> 0), `unit` (1–20) | `200 { foodName, quantity, unit, calories, proteinGrams, carbsGrams, fatGrams, note }` |

- **Coach:** single-turn, with no conversation history. The coach may call read-only tools over the caller's own data.
- **Estimate:** `foodName`, `quantity` and `unit` are echoed from the request, never from the model. The result is a proposal; saving it is a separate `POST /api/nutrition` (typically with `source: "AI_TEXT"`).
- **Errors:**
  - Provider unavailable or unconfigured, or the tool loop is exhausted → `503` ("AI Coach is temporarily unavailable." / "Nutrition estimation is temporarily unavailable.").
  - Model output fails schema validation → `502`.
- The frontend uses the estimate endpoint (Nutrition modal) but not the coach endpoint yet.
