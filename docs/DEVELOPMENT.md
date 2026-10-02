# FitAI Development Guide

Last reviewed: 2026-10-01

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
  scripts/          run-tests.mjs (guarded test runner), sweep-orphan-avatars.ts (storage maintenance)
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
| backend | `PORT` | API port, default `5001` |
| frontend | `VITE_API_BASE_URL` | API origin used by the browser (e.g. the backend on port 5001). Any `VITE_*` value is **public**: it is compiled into the bundle |
| test only | `TEST_DATABASE_URL` | Connection string for the separate test database. Supply it in the shell only, **never in `.env` or committed files** |

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

**AI Coach tests need no OpenAI key.** `coach-loop.test.ts` replaces the provider with a scripted fake through `setModelProvider()` (reset it in `afterEach`) to test loop limits, error mapping, the rate limit and log privacy. The grounding tools (`ai-grounding.test.ts`) run against the test database with a fixed `today`, so their periods do not depend on the real date. `display-units.test.ts` loads the frontend's `unitFormat.ts` at runtime to check the backend display strings match it. `openai-adapter.test.ts` points the real OpenAI adapter at a local fake Responses API (`OPENAI_BASE_URL`, a dummy key) to check request shape, tool-call pairing, parsing, refusals, retries and the nutrition estimate.

### Frontend

`npm test` (in `frontend/`) runs `node --test` on `tests/**/*.test.ts`. It needs no database and no extra dependency: Node strips TypeScript types, and `tests/support/resolve-ts.mjs` resolves the app's extensionless imports. Tests import only pure modules (no React, no `import.meta.env`), such as `features/units/`, `features/coach/`, `features/auth/` and the Settings and Workout drafts.

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
