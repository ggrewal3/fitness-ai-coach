import prisma from "../../lib/prisma.js";
import { CreateCheckInInput } from "./checkin.types.js";

export async function createWeightCheckIn(
  userId: number,
  checkInData: CreateCheckInInput
) {
  return prisma.weightCheckIn.create({
    data: {
      userId,
      weightKg: checkInData.weightKg,
      recordedAt: new Date(checkInData.recordedAt),
    },
  });
}

export async function getMyWeightCheckIns(userId: number) {
  return prisma.weightCheckIn.findMany({
    where: {
      userId,
    },
    orderBy: {
      recordedAt: "desc",
    },
  });
}

export async function deleteMyWeightCheckIn(
  userId: number,
  checkInId: number
) {
  const result = await prisma.weightCheckIn.deleteMany({
    where: {
      id: checkInId,
      userId,
    },
  });

  return result.count > 0;
}
