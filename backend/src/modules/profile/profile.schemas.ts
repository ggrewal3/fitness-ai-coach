import { z } from "zod";

export const HEIGHT_CM_MIN = 50;
export const HEIGHT_CM_MAX = 275;
export const TARGET_WEIGHT_KG_MIN = 20;
export const TARGET_WEIGHT_KG_MAX = 400;
export const MINIMUM_AGE_YEARS = 13;
export const MAXIMUM_AGE_YEARS = 120;
export const MEDICAL_NOTES_MAX_LENGTH = 2000;

// Mirrors the Prisma enums FitnessGoal, ActivityLevel and DietPreference.
const goalSchema = z.enum(["LOSE_FAT", "MAINTAIN", "GAIN_MUSCLE"]);
const activityLevelSchema = z.enum([
  "SEDENTARY",
  "LIGHT",
  "MODERATE",
  "ACTIVE",
  "VERY_ACTIVE",
]);
const dietPreferenceSchema = z.enum([
  "NO_PREFERENCE",
  "VEGETARIAN",
  "VEGAN",
  "PESCATARIAN",
  "HALAL",
]);

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function yearsBefore(date: Date, years: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear() - years, date.getUTCMonth(), date.getUTCDate())
  );
}

// A calendar date (YYYY-MM-DD), compared in UTC like the rest of the app's
// date-only fields.
const dateOfBirthSchema = z
  .iso.date("Date of birth must be a valid date (YYYY-MM-DD).")
  .transform((value, context) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    const today = todayUtc();

    if (date >= today) {
      context.addIssue({ code: "custom", message: "Date of birth must be in the past." });
      return z.NEVER;
    }

    if (date > yearsBefore(today, MINIMUM_AGE_YEARS)) {
      context.addIssue({
        code: "custom",
        message: `You must be at least ${MINIMUM_AGE_YEARS} years old.`,
      });
      return z.NEVER;
    }

    if (date < yearsBefore(today, MAXIMUM_AGE_YEARS)) {
      context.addIssue({ code: "custom", message: "Enter a realistic date of birth." });
      return z.NEVER;
    }

    return date;
  });

const heightCmSchema = z
  .number()
  .finite()
  .min(HEIGHT_CM_MIN, `Height must be at least ${HEIGHT_CM_MIN} cm.`)
  .max(HEIGHT_CM_MAX, `Height must be at most ${HEIGHT_CM_MAX} cm.`);

const targetWeightKgSchema = z
  .number()
  .finite()
  .min(TARGET_WEIGHT_KG_MIN, `Target weight must be at least ${TARGET_WEIGHT_KG_MIN} kg.`)
  .max(TARGET_WEIGHT_KG_MAX, `Target weight must be at most ${TARGET_WEIGHT_KG_MAX} kg.`);

const medicalNotesSchema = z
  .string()
  .trim()
  .max(
    MEDICAL_NOTES_MAX_LENGTH,
    `Medical notes must be at most ${MEDICAL_NOTES_MAX_LENGTH} characters.`
  )
  .transform((value) => (value === "" ? null : value));

// Every field is optional and nullable; null clears a stored value.
const fitnessProfileFieldsSchema = z
  .object({
    dateOfBirth: dateOfBirthSchema.nullable().optional(),
    heightCm: heightCmSchema.nullable().optional(),
    targetWeightKg: targetWeightKgSchema.nullable().optional(),
    goal: goalSchema.nullable().optional(),
    activityLevel: activityLevelSchema.nullable().optional(),
    dietPreference: dietPreferenceSchema.nullable().optional(),
    medicalNotes: medicalNotesSchema.nullable().optional(),
  })
  .strict();

// Creation keeps its existing behavior of accepting any subset, including none.
export const createFitnessProfileSchema = fitnessProfileFieldsSchema;

export const updateFitnessProfileSchema = fitnessProfileFieldsSchema.refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  {
    message: "Provide at least one field to update.",
    // Only when nothing else is wrong, so unknown keys get a single clear error.
    when: ({ issues }) => issues.length === 0,
  }
);
