// Synthetic evaluation users and their data, on the test database only.
//
// Every eval user's email is coach-eval-<runId>-<scenario>-<repeat>@fitai-eval.local.
// Cleanup matches exactly that prefix AND domain, so it can never select an
// ordinary user. Deleting a user cascades to all of their data; eval users
// never get profile photos, so no stored objects are left behind (ADR-024).
import { randomBytes } from "node:crypto";
import prisma from "../../src/lib/prisma.js";
import { addDays } from "../../src/lib/dates/calendarDate.js";
import { createWorkoutSession } from "../../src/modules/workouts/workout.service.js";
import type { CreateWorkoutSessionInput } from "../../src/modules/workouts/workout.types.js";

export const EVAL_EMAIL_PREFIX = "coach-eval-";
export const EVAL_EMAIL_DOMAIN = "@fitai-eval.local";

/** Fixed calendar anchor: results never depend on the day the evaluation runs. */
export const EVAL_TODAY = "2026-06-15";
export const EVAL_TIME_ZONE = "America/New_York";

/** Bump when fixture data or scenario expectations change; comparisons require equal versions. */
export const FIXTURE_VERSION = "1d-a.1";

/** Lower-case, unique per run: a timestamp plus random hex. */
export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "z").toLowerCase();
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export function evalEmail(runId: string, scenarioId: string, repeat: number): string {
  return `${EVAL_EMAIL_PREFIX}${runId}-${scenarioId.toLowerCase()}-${repeat}${EVAL_EMAIL_DOMAIN}`;
}

/** The only selector cleanup ever uses. */
export const evalUserWhere = {
  AND: [{ email: { startsWith: EVAL_EMAIL_PREFIX } }, { email: { endsWith: EVAL_EMAIL_DOMAIN } }],
};

export function isEvalEmail(email: string): boolean {
  return email.startsWith(EVAL_EMAIL_PREFIX) && email.endsWith(EVAL_EMAIL_DOMAIN);
}

/** Creates a user that cannot log in (no valid password hash): it exists only for service-level calls. */
export async function createEvalUser(runId: string, scenarioId: string, repeat: number): Promise<{ id: number; email: string }> {
  const email = evalEmail(runId, scenarioId, repeat);
  const user = await prisma.user.create({
    data: { firstName: "Eval", lastName: scenarioId, email, passwordHash: "!coach-eval-no-login" },
    select: { id: true, email: true },
  });
  return user;
}

/** Deletes one eval user (and, by cascade, their data). Refuses anything that is not an eval user. */
export async function deleteEvalUser(user: { id: number; email: string }): Promise<void> {
  if (!isEvalEmail(user.email)) {
    throw new Error("Refusing to delete a user that is not an evaluation user.");
  }
  await prisma.user.deleteMany({ where: { id: user.id, ...evalUserWhere } });
}

/** Removes every eval user, e.g. left by an interrupted run. Returns how many were deleted. */
export async function sweepEvalUsers(): Promise<number> {
  const { count } = await prisma.user.deleteMany({ where: evalUserWhere });
  return count;
}

export async function countEvalUsers(): Promise<number> {
  return prisma.user.count({ where: evalUserWhere });
}

// ---------------------------------------------------------------------------
// Fixture builders. Dates are relative to EVAL_TODAY.

export const daysAgo = (count: number) => addDays(EVAL_TODAY, -count);

/** A fixed UTC instant for a check-in (12:00Z is 08:00 in New York, summer time). */
export const noonUtc = (date: string) => new Date(`${date}T12:00:00.000Z`);

export interface FixtureContext {
  userId: number;
}

export async function setUnits(
  { userId }: FixtureContext,
  units: { bodyWeightUnit?: "KG" | "LB"; heightUnit?: "CM" | "FT_IN"; workoutLoadUnit?: "KG" | "LB" }
): Promise<void> {
  await prisma.userPreference.create({ data: { userId, ...units } });
}

export async function setProfile(
  { userId }: FixtureContext,
  profile: {
    dateOfBirth?: string;
    heightCm?: number;
    targetWeightKg?: number;
    goal?: "LOSE_FAT" | "MAINTAIN" | "GAIN_MUSCLE";
    activityLevel?: "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE" | "VERY_ACTIVE";
    dietPreference?: "NO_PREFERENCE" | "VEGETARIAN" | "VEGAN" | "PESCATARIAN" | "HALAL";
  }
): Promise<void> {
  await prisma.fitnessProfile.create({
    data: {
      userId,
      ...profile,
      dateOfBirth: profile.dateOfBirth ? new Date(`${profile.dateOfBirth}T00:00:00.000Z`) : undefined,
    },
  });
}

/** Check-ins as [date, kg] (at 12:00Z) or [Date instant, kg]. */
export async function addCheckIns({ userId }: FixtureContext, entries: readonly [string | Date, number][]): Promise<void> {
  await prisma.weightCheckIn.createMany({
    data: entries.map(([when, weightKg]) => ({ userId, weightKg, recordedAt: typeof when === "string" ? noonUtc(when) : when })),
  });
}

export interface FoodFixture {
  date: string;
  foodName: string;
  calories: number;
  proteinGrams: number;
  carbsGrams?: number;
  fatGrams?: number;
  mealType?: "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK" | "OTHER";
}

export async function addFoods({ userId }: FixtureContext, foods: readonly FoodFixture[]): Promise<void> {
  await prisma.nutritionFoodItem.createMany({
    data: foods.map((food) => ({
      userId,
      foodName: food.foodName,
      quantity: 1,
      unit: "serving",
      calories: food.calories,
      proteinGrams: food.proteinGrams,
      carbsGrams: food.carbsGrams ?? 0,
      fatGrams: food.fatGrams ?? 0,
      mealType: food.mealType ?? "OTHER",
      source: "MANUAL",
      entryDate: new Date(`${food.date}T00:00:00.000Z`),
      recordedAt: noonUtc(food.date),
    })),
  });
}

/** One day's calories split across two items, so totals are exact. */
export function dayOfEating(date: string, calories: number, proteinGrams: number): FoodFixture[] {
  const half = Math.floor(calories / 2);
  const halfProtein = Math.floor(proteinGrams / 2);
  return [
    { date, foodName: "Lunch bowl", calories: half, proteinGrams: halfProtein, mealType: "LUNCH" },
    { date, foodName: "Dinner plate", calories: calories - half, proteinGrams: proteinGrams - halfProtein, mealType: "DINNER" },
  ];
}

export async function addActivity({ userId }: FixtureContext, days: readonly { date: string; steps: number }[]): Promise<void> {
  await prisma.dailyActivity.createMany({
    data: days.map(({ date, steps }) => ({
      userId,
      steps,
      activityDate: new Date(`${date}T00:00:00.000Z`),
      recordedAt: noonUtc(date),
      source: "MANUAL",
    })),
  });
}

async function builtInExerciseId(builtInKey: string): Promise<number> {
  const exercise = await prisma.exercise.findUnique({ where: { builtInKey }, select: { id: true } });
  if (!exercise) throw new Error(`Built-in exercise ${builtInKey} is not seeded in the test database.`);
  return exercise.id;
}

/** A strength session through the real workout service (exercise visibility is validated). */
export async function addStrengthSession(
  { userId }: FixtureContext,
  session: { date: string; title: string; durationMinutes: number; exercises: { key: string; sets: { reps: number; load: number; unit: "KG" | "LB" }[] }[] }
): Promise<void> {
  const exercises: CreateWorkoutSessionInput["exercises"] = [];
  for (const exercise of session.exercises) {
    exercises.push({
      exerciseId: await builtInExerciseId(exercise.key),
      sets: exercise.sets.map((set) => ({ reps: set.reps, load: set.load, loadUnit: set.unit })),
    });
  }

  await createWorkoutSession(userId, {
    title: session.title,
    workoutDate: session.date,
    trainingType: "STRENGTH",
    durationMinutes: session.durationMinutes,
    recordedAt: noonUtc(session.date).toISOString(),
    exercises,
  } as CreateWorkoutSessionInput);
}
