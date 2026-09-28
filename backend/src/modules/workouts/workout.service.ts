import { Prisma, type LoadUnit } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import { visibleExerciseWhere } from "../exercises/exercise.service.js";
import type {
  CreateWorkoutSessionInput,
  UpdateWorkoutSessionInput,
  WorkoutDetailResponse,
  WorkoutExerciseInput,
  WorkoutHistorySummaryResult,
  WorkoutListQuery,
  WorkoutSummaryResponse,
  WorkoutTypeCounts,
} from "./workout.types.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const workoutDetailSelect = {
  id: true,
  title: true,
  workoutDate: true,
  trainingType: true,
  durationMinutes: true,
  notes: true,
  recordedAt: true,
  exercises: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      exercise: {
        select: { id: true, name: true, userId: true },
      },
      sets: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          reps: true,
          load: true,
          loadUnit: true,
        },
      },
    },
  },
} as const satisfies Prisma.WorkoutSessionSelect;

const workoutSummarySelect = {
  id: true,
  title: true,
  workoutDate: true,
  trainingType: true,
  durationMinutes: true,
  notes: true,
  recordedAt: true,
  exercises: {
    select: { _count: { select: { sets: true } } },
  },
} as const satisfies Prisma.WorkoutSessionSelect;

type WorkoutDetailRow = Prisma.WorkoutSessionGetPayload<{
  select: typeof workoutDetailSelect;
}>;

type WorkoutSummaryRow = Prisma.WorkoutSessionGetPayload<{
  select: typeof workoutSummarySelect;
}>;

/** One or more referenced exercises are missing or not visible to the user. */
export class InvalidExerciseReferenceError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super("Exercise not found.");
    this.name = "InvalidExerciseReferenceError";
    this.fields = fields;
  }
}

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

// Same convention as Nutrition's entryDate: the "YYYY-MM-DD" string maps to
// UTC midnight for the @db.Date column by concatenation, never by parsing a
// local date, so the calendar day cannot shift with server/client timezones.
function toWorkoutDateValue(workoutDate: string): Date {
  return new Date(`${workoutDate}T00:00:00.000Z`);
}

function toWorkoutDateString(workoutDate: Date): string {
  return workoutDate.toISOString().slice(0, 10);
}

function toDetailResponse(row: WorkoutDetailRow): WorkoutDetailResponse {
  return {
    id: row.id,
    title: row.title,
    workoutDate: toWorkoutDateString(row.workoutDate),
    trainingType: row.trainingType,
    durationMinutes: row.durationMinutes,
    notes: row.notes,
    recordedAt: row.recordedAt,
    exercises: row.exercises.map((workoutExercise) => ({
      id: workoutExercise.id,
      position: workoutExercise.position,
      exercise: {
        id: workoutExercise.exercise.id,
        name: workoutExercise.exercise.name,
        isCustom: workoutExercise.exercise.userId !== null,
      },
      sets: workoutExercise.sets.map((set) => ({
        id: set.id,
        position: set.position,
        reps: set.reps,
        load: set.load === null ? null : set.load.toNumber(),
        loadUnit: set.loadUnit,
      })),
    })),
  };
}

function toSummaryResponse(row: WorkoutSummaryRow): WorkoutSummaryResponse {
  return {
    id: row.id,
    title: row.title,
    workoutDate: toWorkoutDateString(row.workoutDate),
    trainingType: row.trainingType,
    durationMinutes: row.durationMinutes,
    notes: row.notes,
    recordedAt: row.recordedAt,
    exerciseCount: row.exercises.length,
    setCount: row.exercises.reduce(
      (sum, workoutExercise) => sum + workoutExercise._count.sets,
      0
    ),
  };
}

/**
 * Every referenced exercise must be a built-in or one of this user's own
 * custom exercises. Missing and foreign IDs are reported identically so
 * another user's private exercises cannot be probed.
 */
async function assertExercisesVisible(
  tx: Prisma.TransactionClient,
  userId: number,
  exercises: WorkoutExerciseInput[]
): Promise<void> {
  if (exercises.length === 0) {
    return;
  }

  const requestedIds = [...new Set(exercises.map((entry) => entry.exerciseId))];
  const visible = await tx.exercise.findMany({
    where: {
      AND: [{ id: { in: requestedIds } }, visibleExerciseWhere(userId)],
    },
    select: { id: true },
  });
  const visibleIds = new Set(visible.map((exercise) => exercise.id));

  const invalidFields = exercises.flatMap((entry, index) =>
    visibleIds.has(entry.exerciseId) ? [] : [`exercises.${index}.exerciseId`]
  );

  if (invalidFields.length > 0) {
    throw new InvalidExerciseReferenceError(invalidFields);
  }
}

// Positions are assigned from array order; clients never send them.
function toNestedExerciseCreates(
  exercises: WorkoutExerciseInput[]
): Prisma.WorkoutExerciseCreateWithoutWorkoutSessionInput[] {
  return exercises.map((entry, exerciseIndex) => ({
    position: exerciseIndex,
    exercise: { connect: { id: entry.exerciseId } },
    sets: {
      create: entry.sets.map((set, setIndex) => {
        const hasLoad = set.load !== undefined && set.load !== null;

        return {
          position: setIndex,
          reps: set.reps,
          load: hasLoad ? new Prisma.Decimal((set.load as number).toFixed(2)) : null,
          loadUnit: hasLoad ? (set.loadUnit as LoadUnit) : null,
        };
      }),
    },
  }));
}

export async function createWorkoutSession(
  userId: number,
  input: CreateWorkoutSessionInput
): Promise<WorkoutDetailResponse> {
  return prisma.$transaction(async (tx) => {
    await assertExercisesVisible(tx, userId, input.exercises);

    const created = await tx.workoutSession.create({
      data: {
        userId,
        title: input.title,
        workoutDate: toWorkoutDateValue(input.workoutDate),
        trainingType: input.trainingType,
        durationMinutes: input.durationMinutes,
        notes: normalizeNotes(input.notes),
        recordedAt: new Date(input.recordedAt),
        exercises: {
          create: toNestedExerciseCreates(input.exercises),
        },
      },
      select: workoutDetailSelect,
    });

    return toDetailResponse(created);
  });
}

export async function listWorkoutSessions(
  userId: number,
  query: WorkoutListQuery
): Promise<WorkoutSummaryResponse[]> {
  const workoutDateFilter: Prisma.DateTimeFilter = {};

  if (query.from) {
    workoutDateFilter.gte = toWorkoutDateValue(query.from);
  }

  if (query.to) {
    workoutDateFilter.lte = toWorkoutDateValue(query.to);
  }

  const rows = await prisma.workoutSession.findMany({
    where: {
      userId,
      ...(query.from || query.to ? { workoutDate: workoutDateFilter } : {}),
    },
    orderBy: [{ workoutDate: "desc" }, { recordedAt: "desc" }, { id: "desc" }],
    take: query.limit,
    select: workoutSummarySelect,
  });

  return rows.map(toSummaryResponse);
}

export async function getWorkoutSession(
  userId: number,
  workoutSessionId: number
): Promise<WorkoutDetailResponse | null> {
  const row = await prisma.workoutSession.findFirst({
    where: { id: workoutSessionId, userId },
    select: workoutDetailSelect,
  });

  return row ? toDetailResponse(row) : null;
}

export async function getWorkoutSessionsForDate(
  userId: number,
  workoutDate: string
): Promise<WorkoutDetailResponse[]> {
  const rows = await prisma.workoutSession.findMany({
    where: { userId, workoutDate: toWorkoutDateValue(workoutDate) },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: workoutDetailSelect,
  });

  return rows.map(toDetailResponse);
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

/**
 * Updates session fields; when `exercises` is provided, replaces every nested
 * exercise and set. Everything happens in one transaction, so any failure
 * leaves the previous workout fully intact.
 */
export async function updateWorkoutSession(
  userId: number,
  workoutSessionId: number,
  input: UpdateWorkoutSessionInput
): Promise<WorkoutDetailResponse | null> {
  return prisma.$transaction(async (tx) => {
    // Lock the owned row so concurrent edits of the same workout serialize.
    const owned = await tx.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "WorkoutSession"
      WHERE "id" = ${workoutSessionId} AND "userId" = ${userId}
      FOR UPDATE
    `;

    if (owned.length === 0) {
      return null;
    }

    if (input.exercises) {
      await assertExercisesVisible(tx, userId, input.exercises);
      await tx.workoutExercise.deleteMany({
        where: { workoutSessionId },
      });
    }

    const updated = await tx.workoutSession.update({
      where: { id: workoutSessionId },
      data: {
        title: input.title,
        workoutDate: input.workoutDate
          ? toWorkoutDateValue(input.workoutDate)
          : undefined,
        trainingType: input.trainingType,
        durationMinutes: input.durationMinutes,
        notes: normalizeNotes(input.notes),
        recordedAt: input.recordedAt ? new Date(input.recordedAt) : undefined,
        ...(input.exercises
          ? { exercises: { create: toNestedExerciseCreates(input.exercises) } }
          : {}),
      },
      select: workoutDetailSelect,
    });

    return toDetailResponse(updated);
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
