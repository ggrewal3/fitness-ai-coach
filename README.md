# AI Fitness Coach

AI Fitness Coach is a full-stack fitness tracking and AI coaching application built as a production-oriented software and LLM engineering project.

Instead of acting as a generic chatbot, the AI Coach can reason over structured user fitness data through controlled backend tools. The application combines traditional full-stack engineering, deterministic analytics, and LLM tool calling to provide personalized, evidence-aware fitness coaching.

## Current Capabilities

- User registration and login with JWT authentication and bcrypt password hashing
- Protected fitness profile management with validated fields
- Account settings: contact details, bio, and body-weight/workout-load/height unit preferences
- Weight check-ins with deterministic weight-history analytics
- Daily nutrition tracking for calories and macronutrients
- Daily activity tracking for steps, walking distance, and active calories
- Workout session tracking for strength, cardio, mobility, sport, and other training
- Structured workout logging: ordered exercises with sets, reps, and optional load (kg or lb)
- Exercise catalogue with built-in FitAI exercises, private custom exercises, and deterministic search
- Structured AI Coach responses
- Read-only AI tool calling over authenticated user data
- Multi-domain AI reasoning across profile, weight, nutrition, activity, and workouts
- Runtime validation with Zod across API and AI boundaries

## Architecture

The backend follows a layered architecture:

```text
Client
  ↓
Express Routes
  ↓
Controllers
  ↓
Services
  ↓
Prisma ORM
  ↓
PostgreSQL
```

The AI subsystem sits on top of the existing application services rather than accessing the database directly:

```text
User Request
    ↓
AI Coach API
    ↓
AI Orchestrator
    ↓
Model Provider
    ↓
Tool Calls
    ↓
Tool Registry
    ↓
Domain Services
    ↓
Prisma ORM
    ↓
PostgreSQL
```

This keeps authentication, authorization, business rules, and deterministic calculations under backend control while allowing the language model to interpret safe application data.

## AI Coach

The AI Coach uses:

- Model-provider abstraction
- Structured model outputs
- Controlled tool calling
- Zod-validated tool arguments
- Authenticated execution context
- Multi-tool orchestration

The current provider implementation uses the OpenAI Responses API while keeping provider-specific behavior isolated from the rest of the application.

The model never receives direct database access.

### Current Read-Only AI Tools

- `getUserProfile`
- `getWeightHistory`
- `getNutritionHistory`
- `getActivityHistory`
- `getWorkoutHistory`

The AI can select and combine these tools depending on the user's question.

For example, an overall progress question can combine:

```text
Fitness Goal
     ↓
Weight History
     ↓
Nutrition
     ↓
Daily Activity
     ↓
Workout History
     ↓
AI Interpretation
```

This allows the coach to reason across multiple fitness domains while keeping factual data retrieval and calculations inside trusted backend services.

## AI Trust Boundary

The model does not control user identity.

```text
Model
  ↓
Chooses an allowed tool
  ↓
Zod validates tool arguments
  ↓
Backend injects authenticated userId
  ↓
Domain Service
  ↓
Authorized user data
  ↓
Model interprets safe result
```

The model may choose arguments such as:

```text
days = 30
```

but it cannot choose:

```text
userId
```

The authenticated identity comes from the backend JWT context.

Deterministic calculations such as averages, totals, and weight changes are also performed by backend services rather than delegated to the language model.

## Fitness Data Model

### Fitness Profile

Stores the user's current fitness context and goals. `POST /api/profile` and `PATCH /api/profile/me` validate every field with strict Zod schemas (unknown fields, including `userId`, are rejected with a structured `400`):

| Field | Rule |
| --- | --- |
| `dateOfBirth` | Calendar date `YYYY-MM-DD`, in the past, user at least 13 (and at most 120) years old |
| `heightCm` | Number, 50–275 |
| `targetWeightKg` | Number, 20–400 |
| `goal` | `LOSE_FAT`, `MAINTAIN`, `GAIN_MUSCLE` |
| `activityLevel` | `SEDENTARY`, `LIGHT`, `MODERATE`, `ACTIVE`, `VERY_ACTIVE` |
| `dietPreference` | `NO_PREFERENCE`, `VEGETARIAN`, `VEGAN`, `PESCATARIAN`, `HALAL` |
| `medicalNotes` | Trimmed, at most 2000 characters, blank becomes `null` |

`POST` accepts any subset (including none) and returns `409` if a profile already exists. `PATCH` accepts any subset but requires at least one field; `null` clears a field. `medicalNotes` is never passed to the AI Coach.

### Account and Preferences

The account belongs to the authenticated user only; every route requires a JWT and identifies the user from the token.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/account` | Identity, contact details, bio, `createdAt`, and unit preferences |
| `PATCH` | `/api/account/profile` | Update `firstName`, `lastName`, `phone`, `countryCode`, `bio` |
| `PATCH` | `/api/account/preferences` | Update `bodyWeightUnit`, `workoutLoadUnit`, `heightUnit` |

Both `PATCH` routes accept any subset of their fields, require at least one, and reject unknown fields. Email is read-only: it cannot be changed through `PATCH /api/account/profile`.

Account field rules:

- `firstName` / `lastName`: trimmed, 1–50 characters.
- `phone`: optional contact detail (no SMS verification, not unique). Spaces, hyphens, periods, and parentheses are removed, and the result must be E.164-style (`^\+[1-9]\d{7,14}$`), e.g. `+1 (415) 555-0100` is stored as `+14155550100`. Blank becomes `null`.
- `countryCode`: ISO 3166-1 alpha-2 code, upper-cased before storage and validated against the officially assigned codes in `countryCodes.ts`. Blank becomes `null`. The country never changes unit preferences.
- `bio`: plain text, trimmed, at most 500 characters; blank becomes `null`. Line breaks (normalized to `\n`) and tabs are kept; other control characters are rejected. It is never interpreted as HTML and is not sent to the AI Coach.

Unit preferences are stored in an optional one-to-one `UserPreference` row. A user without a row gets the defaults, and reading the account never creates one; the first preferences `PATCH` does (upsert).

| Preference | Values | Default |
| --- | --- | --- |
| `bodyWeightUnit` | `KG`, `LB` | `KG` |
| `workoutLoadUnit` | `KG`, `LB` | `LB` |
| `heightUnit` | `CM`, `FT_IN` | `CM` |

Unit preferences are display and input preferences only. **Changing them never converts stored values:** `WeightCheckIn.weightKg`, `FitnessProfile.heightCm`, `FitnessProfile.targetWeightKg`, and `DailyActivity.walkingDistanceKm` stay in their canonical metric units, and each `WorkoutSet` keeps the `load` and `loadUnit` it was logged with. Theme is not stored on the backend.

### Weight Check-ins

Historical weight records used for weight-history calculations and trend analysis.

### Nutrition Entries

Daily nutrition aggregates containing:

- Calories
- Protein
- Carbohydrates
- Fat

### Daily Activity

Daily movement records containing:

- Steps
- Walking distance
- Active calories
- Activity source
- Recorded timestamp

The activity model is designed to support manual tracking now and future Apple Health / Health Connect synchronization.

### Workout Sessions

Workouts are modeled as events rather than daily aggregates.

This allows multiple workouts to exist on the same day.

Each workout session stores:

- Title (for example "Push Day")
- Workout date (`workoutDate`, the logical training day, like Nutrition's `entryDate`)
- Training type
- Duration
- Optional notes
- Recorded timestamp
- Ordered exercises, each with ordered sets

Supported training types include:

- Strength
- Cardio
- Mobility
- Sport
- Other

Each set stores reps and an optional load with its unit (`KG` or `LB`). The load is stored exactly as entered and never converted; an empty load represents a bodyweight set. Exercises and sets are ordered by server-assigned positions, and editing a workout's exercises replaces them transactionally.

A session may have no exercises, which covers cardio or other session-only workouts.

### Exercise Catalogue

Workouts reference exercises by a stable Exercise ID rather than free text:

- **Built-in exercises** (`userId = null`) are provided by FitAI, visible to everyone, and seeded idempotently by a stable `builtInKey`. They cannot be created, modified, or deleted through the API.
- **Custom exercises** (`userId = <owner>`) are private to the user who created them.

Names are normalized for matching (case, whitespace, hyphens/underscores, and apostrophes are ignored), so `" Bench   Press "` and `"bench press"` are the same exercise. Creating a custom exercise that matches a built-in or an existing custom exercise returns that exercise instead of a duplicate.

Search is conventional and deterministic: exact matches rank first, then whole-query prefixes, word prefixes, and substring matches, with alphabetical tie-breaking. An empty query returns one alphabetical list.

Timed or distance sets, RPE, muscle groups, equipment metadata, personal records, and progressive-overload analytics are not implemented yet. The AI workout tool still reads session-level workout data only.

### Workout and Exercise API

All endpoints require a JWT and only ever act on the authenticated user's data.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/exercises?search=&limit=` | Search built-in and your own custom exercises |
| `POST` | `/api/exercises` | Find or create a private custom exercise (`201` created, `200` existing) |
| `POST` | `/api/workouts` | Create a workout with nested exercises and sets |
| `GET` | `/api/workouts?from=&to=&limit=` | List workout summaries, newest first |
| `GET` | `/api/workouts/:id` | Get one workout with exercises and sets |
| `GET` | `/api/workouts/date/:date` | Get workouts for a `YYYY-MM-DD` workout date |
| `PATCH` | `/api/workouts/:id` | Update fields; `exercises` (if present) replaces all exercises and sets |
| `DELETE` | `/api/workouts/:id` | Delete a workout with its exercises and sets |

`POST /api/workouts` requires `title` and `workoutDate`.

## Deterministic Analytics

Fitness calculations are performed by backend services before data reaches the LLM.

Examples include:

### Weight

- Starting weight
- Latest weight
- Total weight change
- Average weekly change
- Number of check-ins

### Nutrition

- Average calories
- Average protein
- Average carbohydrates
- Average fat
- Logged days
- Latest nutrition values

### Activity

- Average steps
- Total steps
- Average walking distance
- Average active calories
- Logged activity days
- Latest step count

### Workouts

- Total sessions
- Total training minutes
- Average workout duration
- Sessions by training type
- Latest workout type
- Latest workout duration
- Latest workout timestamp

The LLM interprets these facts instead of performing the underlying calculations itself.

## Validation and Security

TypeScript provides compile-time type safety, while Zod validates untrusted data crossing runtime boundaries.

```text
Untrusted Request
      ↓
JWT Authentication
      ↓
Runtime Validation
      ↓
Business / Ownership Rules
      ↓
Prisma ORM
      ↓
PostgreSQL Constraints
```

Important security principles include:

- Password hashes are not returned in normal API responses
- Emails are trimmed and lower-cased at registration and login, so case variations cannot create duplicate accounts
- Registration passwords must be at least 8 characters and at most 72 bytes of UTF-8 (bcrypt's input limit); longer passwords are rejected rather than silently truncated
- Authenticated identity is not accepted from request bodies
- AI tools cannot supply their own `userId`
- Cross-user resource access is blocked through ownership-aware operations
- AI tools use an explicit allow-list registry
- AI tool arguments are validated with Zod
- Structured model output is validated before being returned to the client
- Sensitive API keys and JWTs are not exposed to the model

## Evidence-Aware AI Behavior

The AI Coach is designed to distinguish between available evidence and unsupported conclusions.

For example:

```text
6 logged strength sessions
```

supports:

```text
"You logged 6 strength sessions."
```

but does not automatically support:

```text
"Your strength is improving."
```

Objective strength progression would require additional information such as exercises, sets, reps, and loads.

Similarly:

- Missing activity data is not treated as zero activity
- Missing workouts are not automatically treated as rest days
- Sparse history is acknowledged instead of converted into long-term trends
- User-entered workout notes are treated as contextual information rather than independently verified measurements

## Frontend Theme

The frontend supports Light, Dark, and System themes.

- The preference (`system`, `light`, or `dark`; default `system`) is stored only in the browser's `localStorage` under `fitai.theme`. It is not sent to the backend. Missing, invalid, or inaccessible storage falls back to `system`.
- `<html data-theme>` always holds the resolved theme (`light` or `dark`), and `color-scheme` is set to match so native controls follow it. `system` tracks the OS setting live via `prefers-color-scheme`, and other open tabs follow preference changes.
- Colours are semantic CSS variables in `frontend/src/index.css`: Light values on `:root`, Dark overrides on `:root[data-theme="dark"]`.
- A small inline script in `frontend/index.html` applies the theme before the first paint. `ThemeProvider` (`frontend/src/context/ThemeContext.tsx`) keeps it in sync afterwards; components read and change it with `useTheme()`. Shared logic lives in `frontend/src/features/theme/theme.ts`, which the inline script mirrors.

## Technology Stack

### Frontend

- React 19
- TypeScript
- Vite
- React Router

### Backend

- Node.js
- Express 5
- TypeScript
- Zod
- JWT
- bcrypt

### Database

- PostgreSQL
- Prisma ORM
- Docker

### AI

- OpenAI Node SDK
- Responses API
- Structured outputs
- Model-provider abstraction
- Tool calling
- Zod-validated tool arguments
- Multi-tool orchestration

### Infrastructure

- Docker
- Docker Compose
- Nginx planned
- AWS deployment planned

## Repository Structure

```text
fitness-ai-coach/
│
├── frontend/
│   └── React + TypeScript application
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.ts
│   │   └── migrations/
│   │
│   ├── scripts/
│   │   └── run-tests.mjs
│   │
│   ├── test/
│   │
│   └── src/
│       ├── middleware/
│       ├── modules/
│       │   ├── auth/
│       │   ├── account/
│       │   ├── profile/
│       │   ├── checkins/
│       │   ├── nutrition/
│       │   ├── activity/
│       │   ├── workouts/
│       │   ├── exercises/
│       │   └── ai/
│       ├── types/
│       ├── app.ts
│       └── server.ts
│
├── nginx/
├── database/
├── docs/
└── docker-compose.yml
```

## Backend Development

Seed the built-in exercise catalogue after applying migrations (safe to run repeatedly):

```bash
cd backend
npx prisma migrate deploy
npm run db:seed
```

### Automated Tests

Backend tests use Node's built-in test runner and must run against a separate PostgreSQL database. Provide its connection string through the `TEST_DATABASE_URL` environment variable; do not commit it or add it to `.env`.

```bash
cd backend
TEST_DATABASE_URL="postgresql://..." npm test
```

The runner refuses to start if `TEST_DATABASE_URL` is missing or points at the development database. It applies migrations and seeds the catalogue before running `test/**/*.test.ts`. `npm run typecheck` type-checks the source and tests.

## Development Principles

The project separates three major responsibilities:

### 1. Application Backend

Responsible for:

- Authentication
- Authorization
- Data integrity
- Business logic
- Ownership rules
- Deterministic calculations

### 2. AI Tools

Responsible for exposing narrowly scoped, validated capabilities over existing application services.

AI tools do not bypass the normal application architecture.

### 3. Language Model

Responsible for interpreting available evidence and producing user-facing coaching responses.

This architecture makes AI a controlled component of the product rather than giving the model unrestricted access to application state.

## Current Project Status

Completed backend verticals:

- Authentication
- Account Settings (contact details and unit preferences)
- Fitness Profile
- Weight Tracking
- Weight Analytics
- Weight AI Tool
- Nutrition Tracking
- Nutrition Analytics
- Nutrition AI Tool
- Activity Tracking
- Activity Analytics
- Activity AI Tool
- Workout Tracking
- Workout Analytics
- Workout AI Tool
- Structured Workout Data (exercise catalogue, exercises, sets)
- Automated Backend Tests (auth, account, fitness profile, exercises, and workouts)
- Structured AI Coach Responses
- Multi-Tool AI Orchestration

The AI Coach can currently reason across five application domains:

```text
Profile
Weight
Nutrition
Activity
Workout
```

The frontend contains the main application routes and shared layout, while deeper frontend/backend integration is still in progress.

## Roadmap

### Near-Term

- Connect the frontend to authenticated backend APIs
- Build user-facing fitness tracking workflows
- Build the frontend AI Coach experience
- Add progress and photo workflows
- Expand automated test coverage
- Improve production security and error handling
- Add AI evaluation and observability
- Add a small vetted fitness-knowledge retrieval layer (RAG)
- Deploy the application

### Future Enhancements

- Apple HealthKit integration
- Android Health Connect integration
- Workout frontend with exercise autocomplete
- Timed and distance sets
- Progressive-overload analytics
- More advanced AI memory and personalization

## Project Goal

The goal of AI Fitness Coach is not to build a thin chatbot wrapper.

The project explores how a production application can combine:

```text
Structured Product Data
        +
Secure Backend Services
        +
Deterministic Analytics
        +
Controlled LLM Tool Calling
        +
AI Reasoning
```

to create a fitness coach that can reason over real user data while keeping important application logic, security boundaries, and factual calculations under backend control.
