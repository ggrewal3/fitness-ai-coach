# AI Fitness Coach

AI Fitness Coach is a full-stack fitness tracking and AI coaching application built as a production-oriented software and LLM engineering project.

Instead of acting as a generic chatbot, the AI Coach can reason over structured user fitness data through controlled backend tools. The application combines traditional full-stack engineering, deterministic analytics, and LLM tool calling to provide personalized, evidence-aware fitness coaching.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system works today, including system-wide invariants |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decision records: why things are built this way |
| [docs/API.md](docs/API.md) | HTTP API reference |
| [docs/DATABASE.md](docs/DATABASE.md) | Data model, ownership, units, migrations |
| [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) | AI Coach, tools, data exposure, planned AI work |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, commands, tests, pre-commit checklist |
| [AGENTS.md](AGENTS.md) | Instructions for coding agents working in this repository |

## Current Capabilities

Backend API:

- User registration and login with JWT authentication and bcrypt password hashing; emails are normalized to lowercase
- Account settings: contact details, bio, private profile photos (signed URLs), and body-weight/workout-load/height unit preferences
- Fitness profile management with validated fields
- Weight check-ins, per-food-item nutrition logging, daily activity, and workout sessions
- Structured workouts: ordered exercises with sets, reps, and optional load (kg or lb, stored exactly as entered)
- Exercise catalogue with built-in FitAI exercises, private custom exercises, and deterministic search
- AI Coach with structured responses and read-only tool calling across profile, weight, nutrition, activity, and workouts
- AI nutrition estimates that the user confirms before anything is saved
- Runtime validation with Zod across API and AI boundaries

Frontend:

- Login and signup, a protected application shell with a responsive sidebar and mobile drawer
- Dashboard, Progress (weight check-ins), Nutrition (with AI-assisted entry), and Workout logging with an exercise picker
- Settings: profile photo (preview before saving, change, remove), profile and contact details, bio, fitness profile, unit preferences, appearance, connection status, and sign-out
- Light, Dark, and System themes

Not yet in the frontend: the AI Coach chat and activity. These exist only as backend APIs or stub pages. Unit preferences are saved but not yet applied to other screens.

## Architecture

The backend follows a layered architecture:

```text
Client → Express Routes → Controllers → Services → Prisma ORM → PostgreSQL
```

The AI subsystem sits on top of the existing application services rather than accessing the database directly:

```text
AI Coach API → Orchestrator → Model Provider ⇄ Tool Registry → Domain Services → Prisma → PostgreSQL
```

This keeps authentication, authorization, business rules, and deterministic calculations under backend control while the language model interprets safe application data. The model never receives database access and never chooses whose data it reads: the authenticated `userId` comes from the JWT, not from the model.

Key invariants:

- Identity comes only from the JWT.
- Every query is scoped to the authenticated user.
- Stored measurements use canonical metric units, and workout loads are stored exactly as entered.
- The backend is authoritative for validation.
- AI proposes, the user confirms, and the normal API persists.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture and [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) for the AI design.

## Evidence-Aware AI Behavior

The AI Coach is designed to distinguish available evidence from unsupported conclusions. For example, "6 logged strength sessions" supports "You logged 6 strength sessions" but not "Your strength is improving", which would require exercise, set, rep, and load evidence. Missing activity is not treated as zero, missing workouts are not treated as rest days, sparse history is acknowledged, and user-entered notes are treated as context rather than verified measurements. All averages, totals, and changes are calculated by backend services before the model sees them.

## Technology Stack

| Area | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router |
| Backend | Node.js, Express 5, TypeScript, Zod, JWT, bcrypt |
| Database | PostgreSQL 17, Prisma 7, Docker (local) |
| AI | OpenAI Node SDK, Responses API, structured outputs, tool calling, model-provider abstraction |
| Infrastructure | Docker Compose (local database). Nginx and AWS deployment are planned, not implemented |

## Repository Structure

```text
fitness-ai-coach/
├── AGENTS.md / CLAUDE.md     coding-agent instructions
├── docs/                     architecture, decisions, API, database, AI, development
├── frontend/                 React + TypeScript application
├── backend/
│   ├── prisma/               schema.prisma, migrations/, seed.ts
│   ├── scripts/run-tests.mjs guarded test runner
│   ├── test/                 backend test suites
│   └── src/
│       ├── middleware/
│       ├── modules/          auth, account, profile, checkins, nutrition,
│       │                     activity, workouts, exercises, ai
│       ├── app.ts
│       └── server.ts
├── nginx/, database/         placeholders (empty)
└── docker-compose.yml        local PostgreSQL
```

## Quick Start

```bash
docker compose up -d                      # local PostgreSQL on port 5433

cd backend
npm install                               # then create backend/.env (see docs/DEVELOPMENT.md)
npx prisma migrate deploy && npx prisma generate
npm run db:seed                           # built-in exercise catalogue (idempotent)
npm run dev                               # API on http://localhost:5001

cd ../frontend
npm install                               # then create frontend/.env with VITE_API_BASE_URL
npm run dev                               # app on http://localhost:5173
```

Backend tests run against a separate PostgreSQL database supplied through `TEST_DATABASE_URL` (never `.env`):

```bash
cd backend
TEST_DATABASE_URL="postgresql://…/fitness_ai_test" npm test
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for environment variables, the migration workflow, and the pre-commit checklist.

## Roadmap

### Near-Term

- Apply unit preferences across Progress, Dashboard, and Workout
- Frontend AI Coach experience
- Remaining user-facing fitness tracking workflows (activity)
- Progress and photo workflows
- Expand automated test coverage, including the frontend
- Improve production security and error handling (rate limiting, token revocation)
- Add AI evaluation and observability
- Add a small vetted fitness-knowledge retrieval layer (RAG)
- Deploy the application

### Future Enhancements

- Apple HealthKit and Android Health Connect integration (requires a native layer; see [ADR-016](docs/DECISIONS.md#adr-016-health-platform-integrations-are-not-implemented))
- AI-assisted workout quick-log into the existing workout editor
- Timed and distance sets
- Progressive-overload analytics
- More advanced AI memory and personalization

Roadmap items are intentions, not commitments. Anything not described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) as implemented does not exist yet.

## Project Goal

The goal of AI Fitness Coach is not to build a thin chatbot wrapper. The project explores how a production application can combine:

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
