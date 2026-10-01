# FitAI Database

Last reviewed: 2026-10-01

PostgreSQL 17 accessed through Prisma 7. **`backend/prisma/schema.prisma` is the executable source of truth**; this document explains its design and invariants. The reasons behind it are in [DECISIONS.md](DECISIONS.md).

## Relationship overview

```text
User ─┬─ 0..1 FitnessProfile
      ├─ 0..1 UserPreference
      ├─ 0..* WeightCheckIn
      ├─ 0..* NutritionFoodItem
      ├─ 0..* DailyActivity          (≤ 1 per activityDate)
      ├─ 0..* Exercise (custom)      (built-ins have userId = null)
      └─ 0..* WorkoutSession
                └─ 0..* WorkoutExercise ──► Exercise (built-in or the session owner's custom)
                          └─ 1..* WorkoutSet        (≥ 1 set is enforced by the API, not the DB)
```

## Entities

| Model | Responsibility | Key constraints and indexes |
|---|---|---|
| `User` | Identity and credentials (`email`, bcrypt `passwordHash`), names, optional contact details (`phone`, `countryCode`, `bio`) | `email` unique, always stored trimmed and lower-case |
| `FitnessProfile` | Optional coaching context: `dateOfBirth`, `heightCm`, `targetWeightKg`, `goal`, `activityLevel`, `dietPreference`, `medicalNotes` | `userId` unique (1:1) |
| `UserPreference` | Optional display/input units: `bodyWeightUnit` (default KG), `workoutLoadUnit` (default LB), `heightUnit` (default CM) | `userId` unique (1:1). No row means the defaults; created on the first preferences update |
| `WeightCheckIn` | One body-weight measurement (`weightKg`, `recordedAt`) | index `(userId, recordedAt)` |
| `NutritionFoodItem` | One logged food: name, quantity + free-text unit, calories (int), macros (g), `mealType`, `source`, `entryDate` (DATE), `recordedAt` | indexes `(userId, entryDate)`, `(userId, recordedAt)` |
| `DailyActivity` | One day's movement: `steps`, optional `walkingDistanceKm`/`activeCalories`, `source`, `activityDate` (DATE), `recordedAt` | **unique `(userId, activityDate)`**; index `(userId, recordedAt)` |
| `WorkoutSession` | One workout event: `title`, `workoutDate` (DATE), `trainingType`, `durationMinutes`, `notes`, `recordedAt` | indexes `(userId, recordedAt)`, `(userId, workoutDate)` |
| `Exercise` | A built-in (`userId` null, `builtInKey` set) or a private custom exercise (`userId` = owner) | `builtInKey` unique; unique `(userId, normalizedName)`; index `normalizedName` |
| `WorkoutExercise` | An exercise's place in a session (`position`, 0-based) | unique `(workoutSessionId, position)`; index `exerciseId` |
| `WorkoutSet` | One set: `position` (0-based), `reps`, `load` `Decimal(6,2)` or null, `loadUnit` or null | unique `(workoutExerciseId, position)` |

**Enums:**

| Enum | Values |
|---|---|
| `FitnessGoal` | `LOSE_FAT`, `MAINTAIN`, `GAIN_MUSCLE` |
| `ActivityLevel` | `SEDENTARY`, `LIGHT`, `MODERATE`, `ACTIVE`, `VERY_ACTIVE` |
| `DietPreference` | `NO_PREFERENCE`, `VEGETARIAN`, `VEGAN`, `PESCATARIAN`, `HALAL` |
| `MealType` | `BREAKFAST`, `LUNCH`, `DINNER`, `SNACK`, `OTHER` |
| `NutritionSource` | `MANUAL`, `AI_TEXT`, `AI_PHOTO` (unused) |
| `ActivitySource` | `MANUAL`, `APPLE_HEALTH` (unused), `HEALTH_CONNECT` (unused) |
| `TrainingType` | `STRENGTH`, `CARDIO`, `MOBILITY`, `SPORT`, `OTHER` |
| `LoadUnit` | `KG`, `LB` (for workout sets) |
| `WeightUnit` | `KG`, `LB` (for preferences) |
| `HeightUnit` | `CM`, `FT_IN` (for preferences) |

`LoadUnit` and `WeightUnit` have the same values but are separate on purpose: one describes stored data, the other a display preference.

Country codes are validated in application code (`account/countryCodes.ts`), not by a database enum.

## Ownership and delete behavior

- Every user-owned table has `userId` with `ON DELETE CASCADE`. **Deleting a `User` deletes all of their data:** profile, preference, check-ins, food items, activity, custom exercises, and workouts with their exercises and sets. No account-deletion endpoint exists yet; the cascade is exercised in tests.
- `WorkoutExercise → WorkoutSession` and `WorkoutSet → WorkoutExercise` cascade.
- `WorkoutExercise → Exercise` is `ON DELETE NO ACTION`, checked at the end of the statement. An exercise still used by a workout cannot be deleted on its own, but deleting a user removes their workouts and custom exercises in the same statement without conflict.
- A workout may only reference built-ins or **its owner's** custom exercises. The service layer enforces this (`assertExercisesVisible`); the database does not.

## Canonical units

| Column | Unit |
|---|---|
| `WeightCheckIn.weightKg`, `FitnessProfile.targetWeightKg` | kg (Float) |
| `FitnessProfile.heightCm` | cm (Float) |
| `DailyActivity.walkingDistanceKm` | km (Float) |
| `NutritionFoodItem.*Grams` | g; `calories` is an integer kcal |
| `WorkoutSet.load` + `loadUnit` | as entered (KG or LB), exact to 2 decimals; **never converted** |

`UserPreference` never changes stored values ([ADR-006](DECISIONS.md#adr-006-canonical-metric-storage-units-are-display-preferences-only), [ADR-007](DECISIONS.md#adr-007-workout-sets-keep-the-unit-they-were-entered-in)).

## Dates

- `entryDate`, `workoutDate` and `activityDate` are `@db.Date`. The application writes them as `YYYY-MM-DDT00:00:00.000Z`, built by string concatenation, never by parsing local time.
- `recordedAt` is a timestamp of the actual moment of recording.
- `createdAt`/`updatedAt` are Prisma-managed.

## Invariants not expressed in the schema

The API enforces these. Keep them if you add writers (seeds, scripts, future AI flows):

1. `email` is trimmed and lower-case.
2. `WorkoutSet.load` and `loadUnit` are both null (bodyweight) or both set. `load` is > 0, ≤ 2000 and has at most 2 decimals.
3. Positions are contiguous from 0, in submission order, and server-assigned.
4. Every `WorkoutExercise` has 1–20 sets; a session has at most 30 exercises.
5. A custom exercise name must not normalize to the same key as a built-in. Find-or-create returns the built-in instead.
6. Built-in `builtInKey`s are permanent and never reused or deleted. Built-in uniqueness relies on `builtInKey` and seed checks, because Postgres treats NULL `userId`s as distinct in the `(userId, normalizedName)` index.
7. `DailyActivity.source` is always `MANUAL`; the API cannot set it. No implemented frontend flow produces `NutritionFoodItem.source = AI_PHOTO`, although the API accepts the value from clients.
8. Unit preferences and `UserPreference` rows never trigger data rewrites.

## Migrations

- Migrations live in `backend/prisma/migrations/<timestamp>_<snake_case_name>/migration.sql` and are applied with `prisma migrate deploy`. Configuration is in `backend/prisma.config.ts`, which also defines the seed command.
- **Authoring workflow** (non-interactive):
  1. Edit `schema.prisma`, then run `npx prisma validate`.
  2. Generate SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.
  3. Save the SQL into a new migration folder and hand-edit it if data must be backfilled or guarded.
  4. Rehearse it against the development database inside `BEGIN … ROLLBACK`.
  5. Apply with `npx prisma migrate deploy`. Check `migrate status`, then confirm the diff is empty.
  6. Run `npx prisma generate`.
- **Data-changing migrations must be safe on existing data:**
  - Add nullable columns, then backfill, then add NOT NULL (as in `add_structured_workouts`).
  - Abort explicitly when an assumption fails (`add_account_settings` raises if lower-casing emails would collide).
- **Never** run `prisma migrate reset` or `db push` against a database with real data, and never edit a migration that has already been applied.
- History note: `20260925125036_replace_nutrition_entry_with_food_items` dropped the original per-day `NutritionEntry` table without migrating rows ([ADR-023](DECISIONS.md#adr-023-nutrition-is-stored-per-food-item-not-per-day)).

## Seeding

`npm run db:seed` (`prisma/seed.ts`) idempotently upserts the 82 built-in exercises by `builtInKey`: it creates missing ones, renames in place and never deletes. The test runner seeds the test database automatically.
