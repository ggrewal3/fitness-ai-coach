import { z } from "zod";
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
      heightCm: z.number().nullable(),
      targetWeightKg: z.number().nullable(),
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

function calculateAge(dateOfBirth: Date | null): number | null {
  if (!dateOfBirth) {
    return null;
  }

  const today = new Date();
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
    "Get the authenticated user's fitness profile facts for personalized coaching.",
  inputSchema: getUserProfileArgsSchema,
  async execute(_validatedArgs, { userId }) {
    const user = await getMyProfile(userId);

    if (!user?.profile) {
      return { found: false };
    }

    return userProfileResultSchema.parse({
      found: true,
      profile: {
        age: calculateAge(user.profile.dateOfBirth),
        heightCm: user.profile.heightCm,
        targetWeightKg: user.profile.targetWeightKg,
        goal: user.profile.goal,
        activityLevel: user.profile.activityLevel,
        dietPreference: user.profile.dietPreference,
      },
    });
  },
};
