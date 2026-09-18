import prisma from "../../lib/prisma.js";
import type {
  CreateWorkoutSessionInput,
  WorkoutHistorySummaryResult,
  WorkoutTypeCounts,
  UpdateWorkoutSessionInput,
  WorkoutSessionResponse,
} from "./workout.types.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const workoutSessionSelect = {
  id: true,
  trainingType: true,
  durationMinutes: true,
  notes: true,
  recordedAt: true,
} as const;

function normalizeNotes(notes: string | null | undefined): string | null | undefined {
  if (notes === undefined || notes === null) {
    return notes;
  }

  const trimmedNotes = notes.trim();

  return trimmedNotes === "" ? null : trimmedNotes;
}

function roundMetric(value: number): number {
  const rounded = Number(value.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

export async function createWorkoutSession(
  userId: number,
  input: CreateWorkoutSessionInput
): Promise<WorkoutSessionResponse> {
  return prisma.workoutSession.create({
    data: {
      userId,
      trainingType: input.trainingType,
      durationMinutes: input.durationMinutes,
      notes: normalizeNotes(input.notes),
      recordedAt: new Date(input.recordedAt),
    },
    select: workoutSessionSelect,
  });
}

export async function getWorkoutSessions(
  userId: number
): Promise<WorkoutSessionResponse[]> {
  return prisma.workoutSession.findMany({
    where: {
      userId,
    },
    orderBy: {
      recordedAt: "desc",
    },
    select: workoutSessionSelect,
  });
}

export async function getWorkoutHistorySummary(
  userId: number,
  days: number
): Promise<WorkoutHistorySummaryResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * MILLISECONDS_PER_DAY);

  const entries = await prisma.workoutSession.findMany({
    where: {
      userId,
      recordedAt: {
        gte: cutoff,
      },
    },
    select: {
      trainingType: true,
      durationMinutes: true,
      notes: true,
      recordedAt: true,
    },
    orderBy: {
      recordedAt: "asc",
    },
  });

  if (entries.length === 0) {
    return {
      found: false,
      requestedDays: days,
      summary: null,
      entries: [],
    };
  }

  const totalSessions = entries.length;
  const totalTrainingMinutes = entries.reduce(
    (sum, entry) => sum + entry.durationMinutes,
    0
  );
  const latestEntry = entries[entries.length - 1];
  const sessionsByType: WorkoutTypeCounts = {
    STRENGTH: 0,
    CARDIO: 0,
    MOBILITY: 0,
    SPORT: 0,
    OTHER: 0,
  };

  for (const entry of entries) {
    sessionsByType[entry.trainingType] += 1;
  }

  return {
    found: true,
    requestedDays: days,
    summary: {
      totalSessions,
      totalTrainingMinutes,
      averageDurationMinutes: roundMetric(
        totalTrainingMinutes / totalSessions
      ),
      sessionsByType,
      latestTrainingType: latestEntry.trainingType,
      latestDurationMinutes: latestEntry.durationMinutes,
      latestRecordedAt: latestEntry.recordedAt,
    },
    entries,
  };
}

export async function updateWorkoutSession(
  userId: number,
  workoutSessionId: number,
  input: UpdateWorkoutSessionInput
): Promise<WorkoutSessionResponse | null> {
  return prisma.$transaction(async (transaction) => {
    const existingSession = await transaction.workoutSession.findFirst({
      where: {
        id: workoutSessionId,
        userId,
      },
      select: {
        trainingType: true,
        durationMinutes: true,
        notes: true,
        recordedAt: true,
      },
    });

    if (!existingSession) {
      return null;
    }

    const updateResult = await transaction.workoutSession.updateMany({
      where: {
        id: workoutSessionId,
        userId,
      },
      data: {
        trainingType: input.trainingType ?? existingSession.trainingType,
        durationMinutes:
          input.durationMinutes ?? existingSession.durationMinutes,
        notes:
          input.notes !== undefined
            ? normalizeNotes(input.notes)
            : existingSession.notes,
        recordedAt: input.recordedAt
          ? new Date(input.recordedAt)
          : existingSession.recordedAt,
      },
    });

    if (updateResult.count === 0) {
      return null;
    }

    return transaction.workoutSession.findUnique({
      where: {
        id: workoutSessionId,
      },
      select: workoutSessionSelect,
    });
  });
}

export async function deleteWorkoutSession(
  userId: number,
  workoutSessionId: number
): Promise<boolean> {
  const result = await prisma.workoutSession.deleteMany({
    where: {
      id: workoutSessionId,
      userId,
    },
  });

  return result.count > 0;
}
