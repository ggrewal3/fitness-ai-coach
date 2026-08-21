import prisma from "../../lib/prisma.js";
import {
  CreateFitnessProfileInput,
  UpdateFitnessProfileInput,
} from "./profile.types.js";

export async function getMyProfile(userId: number) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      createdAt: true,

      profile: {
        select: {
          id: true,
          dateOfBirth: true,
          heightCm: true,
          targetWeightKg: true,
          goal: true,
          activityLevel: true,
          dietPreference: true,
          medicalNotes: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  return user;
}

export async function createMyFitnessProfile(
  userId: number,
  profileData: CreateFitnessProfileInput
) {
  const existingProfile = await prisma.fitnessProfile.findUnique({
    where: {
      userId,
    },
  });

  if (existingProfile) {
    return {
      success: false as const,
      message: "Fitness profile already exists.",
    };
  }

  const profile = await prisma.fitnessProfile.create({
    data: {
      userId,

      dateOfBirth: profileData.dateOfBirth
        ? new Date(profileData.dateOfBirth)
        : undefined,

      heightCm: profileData.heightCm,
      targetWeightKg: profileData.targetWeightKg,
      goal: profileData.goal,
      activityLevel: profileData.activityLevel,
      dietPreference: profileData.dietPreference,
      medicalNotes: profileData.medicalNotes,
    },
  });

  return {
    success: true as const,
    profile,
  };
}

export async function updateMyFitnessProfile(
  userId: number,
  profileData: UpdateFitnessProfileInput
) {
  const existingProfile = await prisma.fitnessProfile.findUnique({
    where: {
      userId,
    },
  });

  if (!existingProfile) {
    return {
      success: false as const,
      message: "Fitness profile not found.",
    };
  }

  const profile = await prisma.fitnessProfile.update({
    where: {
      userId,
    },

    data: {
      dateOfBirth: profileData.dateOfBirth
        ? new Date(profileData.dateOfBirth)
        : undefined,

      heightCm: profileData.heightCm,
      targetWeightKg: profileData.targetWeightKg,
      goal: profileData.goal,
      activityLevel: profileData.activityLevel,
      dietPreference: profileData.dietPreference,
      medicalNotes: profileData.medicalNotes,
    },
  });

  return {
    success: true as const,
    profile,
  };
}