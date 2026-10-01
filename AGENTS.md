# Agent Instructions: FitAI

This is the canonical instruction file for coding agents (Claude Code, Codex and others) working in this repository. `CLAUDE.md` only imports this file. Do not create parallel instruction files.

FitAI is a fitness-tracking app with an AI coach:

- `frontend/`: React 19 + TypeScript + Vite.
- `backend/`: Express 5 + TypeScript, Prisma 7, PostgreSQL 17, Zod, JWT.
- The AI calls the OpenAI Responses API behind a provider abstraction.

## Documentation map

| File | Purpose |
|---|---|
| [README.md](README.md) | Project introduction and quick start |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system works **now**, including system-wide invariants |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why: ADR-numbered engineering decisions |
| [docs/API.md](docs/API.md) | HTTP contracts |
| [docs/DATABASE.md](docs/DATABASE.md) | Data model, ownership, units, migration rules |
| [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) | AI architecture, tools, data exposure, implemented vs planned |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, commands, tests, pre-commit checklist |

## Architecture and decision documentation

- Before making architectural changes, read `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.
- Before modifying a domain, also read its documentation (API, database, AI system, as relevant).
- Project documentation is part of implementation, not an optional cleanup task.
- After implementing a feature, decide whether it changed any of these:
  - system architecture
  - database or data ownership
  - API contracts
  - authentication or security
  - external integrations
  - AI/LLM architecture
  - important invariants
  - an accepted engineering decision

  If it did, update the relevant documentation in the same change.
- Keep `docs/ARCHITECTURE.md` focused on the current system, not on chronological history.
- Add ADRs only for meaningful decisions future engineers need to understand. Do not document trivial details that are obvious from the code.
- Never silently contradict an Accepted ADR. If an implementation requires changing an Accepted decision, identify the conflict **before** implementing. After approval, add a new ADR and mark the old one `Superseded`; do not rewrite history.
- Never renumber existing ADRs.
- Clearly distinguish implemented behavior from proposed or future work.
- Code, schema and tests remain the executable sources of truth. When documentation and implementation disagree, investigate the discrepancy rather than blindly changing either side.

## Project working rules

These rules were established by the project owner and apply to every task unless the owner says otherwise for that task.

- Do not commit or push unless explicitly asked.
- Do not modify `.env` files. Never put secrets, tokens, API keys or connection strings in code, logs, UI or docs.
- Keep diffs focused; do not change unrelated files. Do not add dependencies without approval.
- Stop and report blockers or architecture conflicts instead of improvising a major change.
- The backend is authoritative for validation.
- Never accept `userId` from the client or from model output.
- AI proposes, the user confirms, the normal API persists. AI never writes data directly.
- No global state libraries in the frontend.
- Do not fake integrations (health platforms, providers): no placeholder tokens or "connected" states.
- Test database credentials go only in the shell's `TEST_DATABASE_URL`, never in `.env` or committed files.
- Never reset or wipe the development database. Rehearse data-changing migrations first (see `docs/DATABASE.md`).
