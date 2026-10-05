# FitAI Development Guide

Last reviewed: 2026-10-04

How to run, change and verify FitAI locally. Architecture is in [ARCHITECTURE.md](ARCHITECTURE.md); the data workflow in [DATABASE.md](DATABASE.md#migrations).

## Prerequisites

- **Node.js and npm.** No version is pinned (no `engines` field, no `.nvmrc`). Development currently uses Node 25 and npm 11; Prisma 7, Vite 8 and TypeScript 6 need a current Node release.
- **Docker** with Docker Compose, for the local PostgreSQL.
- The backend depends on **`sharp`** (image processing), which installs prebuilt native libvips binaries for macOS and Linux (x64 and arm64) during `npm install`.
- Google Chrome is optional. It is only needed for ad-hoc headless-browser checks, which are not part of the repo.

## Repository layout

```text
backend/            Express API (own package.json)
  prisma/           schema.prisma, migrations/, seed.ts
  prisma.config.ts  Prisma config (schema path, migrations, seed command, datasource URL)
  scripts/          run-tests.mjs (guarded test runner), sweep-orphan-avatars.ts (storage maintenance),
                    coach-eval/ (opt-in live AI Coach evaluation; results/ is git-ignored)
  src/              app.ts, server.ts, lib/ (prisma, storage, images), middleware/, modules/<domain>/, types/
  src/generated/    generated Prisma client (git-ignored)
  storage/          private local object storage (profile photos); git-ignored, created on demand
  test/             node:test suites + helpers.ts
frontend/           React SPA (own package.json); index.html holds the pre-paint theme script
docs/               this documentation set
docker-compose.yml  local PostgreSQL 17 only
nginx/, database/   empty placeholders (nothing deployed)
```

## Environment variables

Never commit `.env` files (they are git-ignored) and never paste real values into docs, logs or issues. The root `.env.example` is currently empty.

| Package | Variable | Purpose |
|---|---|---|
| backend | `DATABASE_URL` | PostgreSQL connection string for the development database. Used by the app and the Prisma CLI |
| backend | `JWT_SECRET` | Secret used to sign and verify JWTs |
| backend | `OPENAI_API_KEY` | OpenAI key for the AI endpoints. Optional: AI routes return 503 without it |
| backend | `OPENAI_MODEL` | Model name for the AI endpoints. Optional, as above |
| backend | `APPLE_CLIENT_ID` | Sign in with Apple **Services ID** (e.g. `com.example.fitai.web`), checked as the Apple ID token audience. Public, not a secret. Optional: without it, Apple sign-in returns 503 and other sign-in methods work normally. No Apple private key, key ID, team ID or client secret is needed (the backend only verifies the ID token) |
| backend | `GOOGLE_CLIENT_ID` | Google OAuth **web client ID** (public, not a secret), checked as the ID token audience. Optional: without it, Google sign-in returns 503 and password auth works normally. No Google client secret is needed |
| backend | `PORT` | API port, default `5001` |
| frontend | `VITE_GOOGLE_CLIENT_ID` | Google OAuth **web client ID** for the sign-in button: the same client as the backend's `GOOGLE_CLIENT_ID`. Public, like every `VITE_*` value. Optional: unset hides the Google button. For local development, add `http://localhost:5173` (and any other dev origin) to the client's **Authorized JavaScript origins** in Google Cloud. No redirect URI or client secret is needed |
| frontend | `VITE_APPLE_CLIENT_ID` | Sign in with Apple **Services ID** for the Apple button: the same value as the backend's `APPLE_CLIENT_ID`. Public. Apple sign-in is shown only when this **and** `VITE_APPLE_REDIRECT_URI` are set and valid |
| frontend | `VITE_APPLE_REDIRECT_URI` | The return URL registered on that Services ID. Public. Must be an absolute **`https://`** URL, otherwise the Apple button is hidden. Apple JS uses it in popup mode, but nothing is served there. Apple does not accept `localhost` or plain-HTTP domains, so a real Apple sign-in needs an HTTPS domain (a tunnel or staging) registered under the Services ID's **Domains and Subdomains** and **Return URLs**. No private key, key ID, team ID or client secret is used |
| frontend | `VITE_API_BASE_URL` | API origin used by the browser (e.g. the backend on port 5001). Any `VITE_*` value is **public**: it is compiled into the bundle |
| test only | `TEST_DATABASE_URL` | Connection string for the separate test database. Supply it in the shell only, **never in `.env` or committed files** |
| evaluation only | `COACH_EVAL_LIVE` | Must be `1`, set in the shell (never `.env`), for a live AI Coach evaluation run |
| evaluation only | `COACH_EVAL_JUDGE_MODEL` | Optional model for `--judge`; defaults to `OPENAI_MODEL` |

The local Docker database exposes PostgreSQL on host port **5433**. Its credentials are the local-only values in `docker-compose.yml`; don't reuse them anywhere real.

## First-time setup

```bash
docker compose up -d                 # start PostgreSQL (container: fitness-ai-postgres)

cd backend
npm install
# create backend/.env with the variables above
npx prisma migrate deploy            # apply migrations
npx prisma generate                  # generate the client into src/generated/prisma
npm run db:seed                      # built-in exercise catalogue (idempotent)

cd ../frontend
npm install
# create frontend/.env with VITE_API_BASE_URL
```

## Running

```bash
cd backend  && npm run dev   # tsx watch src/server.ts  → http://localhost:5001
cd frontend && npm run dev   # Vite dev server          → http://localhost:5173
```

`backend: npm run build` compiles to `dist/`, and `npm start` runs it. `frontend: npm run build` type-checks and bundles to `dist/`, and `npm run preview` serves the build.

## Database workflow

- Change `backend/prisma/schema.prisma`, then follow the migration workflow in [DATABASE.md](DATABASE.md#migrations): validate → diff to SQL → new migration folder → rehearse in `BEGIN … ROLLBACK` → `migrate deploy` → `migrate status` and an empty diff → `generate`.
- Before any data-changing migration, check the assumptions it relies on against real data (counts, duplicates, nulls).
- **Never** run `prisma migrate reset` or `prisma db push` against the development database, and never edit an applied migration.
- `npm run db:seed` is safe to re-run.

## Local object storage

- **Where:** profile photos are stored as private files under `backend/storage/avatars/`. The directory is git-ignored, created on first upload, and never served statically. Browsers read photos only through signed URLs (`GET /api/media/...`). Never commit anything from it.
- **Signing:** signed URLs use `JWT_SECRET` as keying material (domain-separated), so no extra environment variable is needed. Rotating `JWT_SECRET` invalidates outstanding media URLs as well as tokens.
- **Orphans:** a failed best-effort delete can leave an unreferenced photo. To find and remove them, run from `backend/`:

  ```bash
  npm run storage:sweep-avatars                      # dry run: lists eligible orphans, deletes nothing
  npm run storage:sweep-avatars -- --delete          # delete unreferenced photos older than 24 h
  npm run storage:sweep-avatars -- --min-age-hours=48
  ```

  It reads referenced keys from the database in `DATABASE_URL`, and never deletes a referenced photo or one newer than the age threshold.
- **Tests:** tests use a temporary storage directory and never touch `backend/storage/`.

## Tests

### Backend

The tests need a **separate** PostgreSQL database on the same server (for example one named `fitness_ai_test`). Create it once (e.g. with `createdb` or `CREATE DATABASE`), then:

```bash
cd backend
TEST_DATABASE_URL="postgresql://<user>:<password>@localhost:5433/fitness_ai_test" npm test
TEST_DATABASE_URL="…" npm test -- test/workouts.test.ts     # a single file
```

`scripts/run-tests.mjs`:

1. refuses to run if `TEST_DATABASE_URL` is missing or points at the same host, port and database as `DATABASE_URL`;
2. runs `prisma migrate deploy` and `prisma db seed` against the test database;
3. runs `test/**/*.test.ts` serially with `node --test` + `tsx`.

Tests start the real app on an ephemeral port, create uniquely named users through the API, and delete them afterwards; cascades remove their data. New endpoints need tests for:

- validation errors (including unknown keys);
- 401 without a token;
- cross-user access returning 404, or never leaking;
- the happy path.

**Social sign-in tests never contact Google or Apple.** `auth-apple.test.ts` works like the Google suite, with `setAppleKeyResolver` and an outbound-request guard. In the frontend, `tests/googleSignIn.test.ts` and `tests/appleSignIn.test.ts` stub `fetch` and the script host, so neither provider script is ever loaded.

**Google sign-in tests never contact Google.** `auth-google.test.ts` signs ID tokens with locally generated RSA keys, points the verifier at them (`setGoogleKeyResolver`) and blocks every non-local `fetch`. Every test request comes from the same loopback IP, so `createApi` in `test/helpers.ts` resets the per-IP auth rate limits before each `/api/auth/*` request; rate-limit tests pass `{ enforceAuthRateLimits: true }`.

**AI Coach tests need no OpenAI key.** `coach-observer.test.ts` checks the evaluation observer's boundaries, and `coach-eval-harness.test.ts` tests the evaluation harness offline (it blocks every non-local network request). `coach-loop.test.ts` replaces the provider with a scripted fake through `setModelProvider()` (reset it in `afterEach`) to test loop limits, error mapping, the rate limit and log privacy. The grounding tools (`ai-grounding.test.ts`) run against the test database with a fixed `today`, so their periods do not depend on the real date. `display-units.test.ts` loads the frontend's `unitFormat.ts` at runtime to check the backend display strings match it. `openai-adapter.test.ts` points the real OpenAI adapter at a local fake Responses API (`OPENAI_BASE_URL`, a dummy key) to check request shape, tool-call pairing, parsing, refusals, retries and the nutrition estimate.

### Live AI Coach evaluation (opt-in)

`npm run eval:coach` measures the real coach with the configured OpenAI model ([ADR-027](DECISIONS.md#adr-027-live-ai-coach-evaluation-is-opt-in-isolated-and-deterministic-first), [AI-SYSTEM.md](AI-SYSTEM.md#evaluation-phase-1d)). It costs money and is **never** part of `npm test`, builds or any automated check. Run it from `backend/`:

```bash
TEST_DATABASE_URL="…/fitness_ai_test" npm run eval:coach -- --dry-run --scenarios=S1,S15     # plan only
COACH_EVAL_LIVE=1 TEST_DATABASE_URL="…/fitness_ai_test" npm run eval:coach -- --scenarios=S1,S15 --confirm-live
COACH_EVAL_LIVE=1 TEST_DATABASE_URL="…/fitness_ai_test" npm run eval:coach -- --confirm-live     # all of S1–S19
npm run eval:coach:compare -- scripts/coach-eval/results/<baseline>.json scripts/coach-eval/results/<candidate>.json
```

- **Required for a live run:** `COACH_EVAL_LIVE=1` in the shell, `--confirm-live`, `OPENAI_API_KEY` and `OPENAI_MODEL` (shell or `backend/.env`), and `TEST_DATABASE_URL` naming a database that ends in `_test` and is not the development database. Anything missing stops the run before any provider request. It applies migrations and the seed to the test database first, like `npm test`.
- **Options:** `--scenarios=S1,S15` (a subset; start with a small smoke run), `--repeat=N` (default 1, max 5), `--judge` (model-judged quality scores, off by default), `--max-provider-calls=N` / `--max-tokens=N` (can only lower the 150-call / 1,000,000-token ceilings), `--dry-run` (print the plan and the maximum possible provider calls; connects to nothing).
- **Data:** each scenario creates a synthetic `coach-eval-…@fitai-eval.local` user on the test database and deletes it afterwards. Users left by an interrupted run are removed at the next start; Ctrl+C also cleans up. The development database is never touched.
- **Reports:** `scripts/coach-eval/results/<runId>.json` and `.md` (git-ignored). Read the Markdown report: **FAIL** is a required deterministic check, **REVIEW** a heuristic text check worth a human look, **ERROR** a harness or fixture problem. Model-judged scores are advisory; a human decides on safety failures.
- **Comparisons** require the same model, fixtures, scenarios and repeat count; `--allow-model-change` marks an intentional model-change experiment.
- **Recording results:** per-run reports stay git-ignored. When an evaluation leads to an accepted change, commit a short human-written summary under `docs/evals/` with the run IDs (for example [AI-COACH-PHASE-1D.md](evals/AI-COACH-PHASE-1D.md)). The current baseline for future comparisons is the coach-v5 run `20261004t174313z-c47f3f` (`gpt-5.6-terra`, fixtures `1d-a.1`), but its report exists only on the machine that ran it, so a new baseline may need to be recorded first.
- **Changing scenarios or fixtures** (`scenarios.ts`, `fixtures.ts`) means bumping `FIXTURE_VERSION` and keeping every scenario passing on its known-good scripted transcript in `test/coach-eval-harness.test.ts`.

### Frontend

`npm test` (in `frontend/`) runs `node --test` on `tests/**/*.test.ts`. It needs no database and no extra dependency: Node strips TypeScript types, and `tests/support/resolve-ts.mjs` resolves the app's extensionless imports. Tests import only pure modules (no React), such as `features/units/`, `features/coach/`, `features/auth/` and the Settings and Workout drafts. The same hook maps `import.meta.env` in app sources to `globalThis.__VITE_ENV__`, so a test can set Vite configuration before importing a module such as `services/api.ts`. Google sign-in tests stub `fetch` and a fake GIS script host; nothing contacts Google.

There are no component or browser tests. Verification is tests + build + lint, plus manual or ad-hoc browser checks. For UI work, check the documented breakpoints (1440, 1024, 768, 767, 640, 390, 320) and both themes.

## Verification commands

```bash
# backend
cd backend
npx prisma validate
npx prisma migrate status
npm run typecheck          # src + test + seed
npm run build
TEST_DATABASE_URL="…" npm test

# frontend
cd frontend
npm test                   # node --test, pure modules
npm run build              # tsc -b + vite build
npm run lint

# repository
git diff --check
git status --short
```

## Before committing

1. **Scope:** the diff contains only the intended change. No `.env`, secrets, generated client, `dist/` or scratch files.
2. **Backend:** typecheck, build and the full test suite pass. If the schema changed, the migration was rehearsed, applied, `migrate status` is clean and the diff is empty.
3. **Frontend:** tests, build and lint pass. UI changes were checked at the relevant widths and in Light and Dark.
4. `git diff --check` is clean.
5. **Docs:** if the change affects architecture, data ownership, API contracts, auth or security, external integrations, AI behavior, an invariant or an accepted decision, update the relevant `docs/*.md` (and add or supersede an ADR) in the same change. See [AGENTS.md](../AGENTS.md).
6. Don't commit or push on behalf of someone else without being asked.
