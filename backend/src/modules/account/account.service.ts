import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import type {
  AccountResponse,
  UpdateAccountProfileInput,
  UpdatePreferencesInput,
  UserPreferences,
} from "./account.types.js";

// Returned when the user has no UserPreference row yet. Reading never creates
// a row; the first preferences PATCH does.
export const DEFAULT_PREFERENCES: UserPreferences = {
  bodyWeightUnit: "KG",
  workoutLoadUnit: "LB",
  heightUnit: "CM",
};

const preferenceSelect = {
  bodyWeightUnit: true,
  workoutLoadUnit: true,
  heightUnit: true,
} as const;

const accountSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  countryCode: true,
  bio: true,
  createdAt: true,
  preference: { select: preferenceSelect },
} as const;

type AccountRow = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

function toAccountResponse({ preference, ...user }: AccountRow): AccountResponse {
  return {
    ...user,
    preferences: preference ?? { ...DEFAULT_PREFERENCES },
  };
}

// P2025: the record to update was not found. P2003: a foreign key (userId)
// no longer exists. Both mean the token's user has been deleted.
function isMissingUserError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2025" || error.code === "P2003")
  );
}

export async function getAccount(userId: number): Promise<AccountResponse | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: accountSelect,
  });

  return user ? toAccountResponse(user) : null;
}

export async function updateAccountProfile(
  userId: number,
  input: UpdateAccountProfileInput
): Promise<AccountResponse | null> {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        countryCode: input.countryCode,
        bio: input.bio,
      },
      select: accountSelect,
    });

    return toAccountResponse(user);
  } catch (error) {
    if (isMissingUserError(error)) {
      return null;
    }

    throw error;
  }
}

// Display/input preferences only: stored measurements (weightKg, heightCm,
// WorkoutSet.load/loadUnit, walkingDistanceKm, ...) are never converted.
export async function updatePreferences(
  userId: number,
  input: UpdatePreferencesInput
): Promise<UserPreferences | null> {
  try {
    return await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
      select: preferenceSelect,
    });
  } catch (error) {
    if (isMissingUserError(error)) {
      return null;
    }

    throw error;
  }
}
