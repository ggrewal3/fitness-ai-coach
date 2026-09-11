import prisma from "../../lib/prisma.js";
import type {
  CreateCheckInInput,
  WeightHistorySummaryResult,
} from "./checkin.types.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function roundMetric(value: number): number {
  const rounded = Number(value.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

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

export async function getWeightHistorySummary(
  userId: number,
  days: number
): Promise<WeightHistorySummaryResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * MILLISECONDS_PER_DAY);

  const checkIns = await prisma.weightCheckIn.findMany({
    where: {
      userId,
      recordedAt: {
        gte: cutoff,
      },
    },
    select: {
      weightKg: true,
      recordedAt: true,
    },
    orderBy: {
      recordedAt: "asc",
    },
  });

  if (checkIns.length === 0) {
    return {
      found: false,
      requestedDays: days,
      summary: null,
      checkIns: [],
    };
  }

  const firstCheckIn = checkIns[0];
  const lastCheckIn = checkIns[checkIns.length - 1];
  const numberOfCheckIns = checkIns.length;

  if (numberOfCheckIns === 1) {
    return {
      found: true,
      requestedDays: days,
      summary: {
        startingWeightKg: firstCheckIn.weightKg,
        latestWeightKg: firstCheckIn.weightKg,
        totalChangeKg: 0,
        observedDays: 0,
        averageChangePerWeekKg: null,
        numberOfCheckIns,
      },
      checkIns,
    };
  }

  const observedDays =
    (lastCheckIn.recordedAt.getTime() - firstCheckIn.recordedAt.getTime()) /
    MILLISECONDS_PER_DAY;
  const totalChangeKg = lastCheckIn.weightKg - firstCheckIn.weightKg;

  return {
    found: true,
    requestedDays: days,
    summary: {
      startingWeightKg: firstCheckIn.weightKg,
      latestWeightKg: lastCheckIn.weightKg,
      totalChangeKg: roundMetric(totalChangeKg),
      observedDays: roundMetric(observedDays),
      averageChangePerWeekKg:
        observedDays > 0
          ? roundMetric((totalChangeKg / observedDays) * 7)
          : null,
      numberOfCheckIns,
    },
    checkIns,
  };
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
