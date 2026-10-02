import { z } from "zod";
import { formatBodyWeight, formatHeight } from "../../../lib/units/displayUnits.js";
import { getMyProfile } from "../../profile/profile.service.js";
import type { ToolDefinition } from "./tool.types.js";

const getUserProfileArgsSchema = z.object({}).strict();

const userProfileResultSchema = z.union([
  z.object({
    found: z.literal(false),
  }),
  z.object({
    found: z.literal(true),
    profile: z.object({
      age: z.number().int().nonnegative().nullable(),
      /** Deterministic safety flag; null when age is unknown. */
      isUnder18: z.boolean().nullable(),
      heightCm: z.number().nullable(),
      displayHeight: z.string().nullable(),
      targetWeightKg: z.number().nullable(),
      displayTargetWeight: z.string().nullable(),
      goal: z
        .enum(["LOSE_FAT", "MAINTAIN", "GAIN_MUSCLE"])
        .nullable(),
      activityLevel: z
        .enum(["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE", "VERY_ACTIVE"])
        .nullable(),
      dietPreference: z
        .enum([
          "NO_PREFERENCE",
          "VEGETARIAN",
          "VEGAN",
          "PESCATARIAN",
          "HALAL",
        ])
        .nullable(),
    }),
  }),
]);

type GetUserProfileArgs = z.infer<typeof getUserProfileArgsSchema>;
type UserProfileToolResult = z.infer<typeof userProfileResultSchema>;

/** Whole years on the user's own `today` (not the server's date), so isUnder18 flips on their birthday. */
function calculateAge(dateOfBirth: Date | null, todayDate: string): number | null {
  if (!dateOfBirth) {
    return null;
  }

  const today = new Date(`${todayDate}T00:00:00.000Z`);
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDifference = today.getUTCMonth() - dateOfBirth.getUTCMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 &&
      today.getUTCDate() < dateOfBirth.getUTCDate())
  ) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

export const getUserProfileTool: ToolDefinition<
  GetUserProfileArgs,
  UserProfileToolResult
> = {
  name: "getUserProfile",
  description:
    "Get the user's fitness profile: age (and whether they are under 18), height, target weight, goal, activity level and diet preference, with display values in the user's preferred units.",
  inputSchema: getUserProfileArgsSchema,
  async execute(_validatedArgs, { userId, today, units }) {
    const user = await getMyProfile(userId);

    if (!user?.profile) {
      return { found: false };
    }

    const age = calculateAge(user.profile.dateOfBirth, today);
    const { heightCm, targetWeightKg } = user.profile;

    return userProfileResultSchema.parse({
      found: true,
      profile: {
        age,
        isUnder18: age === null ? null : age < 18,
        heightCm,
        displayHeight: heightCm === null ? null : formatHeight(heightCm, units.heightUnit),
        targetWeightKg,
        displayTargetWeight: targetWeightKg === null ? null : formatBodyWeight(targetWeightKg, units.bodyWeightUnit),
        goal: user.profile.goal,
        activityLevel: user.profile.activityLevel,
        dietPreference: user.profile.dietPreference,
      },
    });
  },
};
