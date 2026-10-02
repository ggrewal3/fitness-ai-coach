import { Prisma, type LoadUnit } from "../../generated/prisma/client.js";
import {
  fromDateColumn,
  isWithinRange,
  rollingWeekPeriods,
  spanningRange,
  trailingRange,
  type CalendarDate,
  type DateRange,
} from "../../lib/dates/calendarDate.js";
import prisma from "../../lib/prisma.js";
import { visibleExerciseWhere } from "../exercises/exercise.service.js";
import type {
  CreateWorkoutSessionInput,
  UpdateWorkoutSessionInput,
  WorkoutDetailResponse,
  WorkoutExerciseInput,
  WorkoutExerciseSummary,
  WorkoutGroundingPeriod,
  WorkoutGroundingResult,
  WorkoutGroundingSession,
  WorkoutListQuery,
  WorkoutSummaryResponse,
  WorkoutTypeCounts,
} from "./workout.types.js";

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

function emptyTypeCounts(): WorkoutTypeCounts {
  return { STRENGTH: 0, CARDIO: 0, MOBILITY: 0, SPORT: 0, OTHER: 0 };
}

function summarizeWorkoutPeriod(
  sessions: WorkoutGroundingSession[],
  range: DateRange
): WorkoutGroundingPeriod {
  const inRange = sessions.filter((session) => isWithinRange(session.date, range));
  const sessionsByType = emptyTypeCounts();

  for (const session of inRange) {
    sessionsByType[session.trainingType] += 1;
  }

  return {
    ...range,
    sessions: inRange.length,
    totalMinutes: inRange.reduce((sum, session) => sum + session.durationMinutes, 0),
    sessionsByType,
  };
}

/**
 * Workouts for the AI coach on logical training days (workoutDate, ADR-021),
 * anchored to the client's today.
 *
 * Sets keep their stored load and unit (ADR-007). Exercise summaries report
 * the top load separately per unit; kg and lb are never combined, and no
 * cross-unit volume or tonnage is computed. Callers cap the detailed lists.
 */
export async function getWorkoutGrounding(
  userId: number,
  { today, days }: { today: CalendarDate; days: number }
): Promise<WorkoutGroundingResult> {
  const window = trailingRange(today, days);
  const periods = rollingWeekPeriods(today);
  const queryRange = spanningRange(window, periods.previous);

  const rows = await prisma.workoutSession.findMany({
    where: {
      userId,
      workoutDate: { gte: toWorkoutDateValue(queryRange.startDate), lte: toWorkoutDateValue(queryRange.endDate) },
    },
    select: {
      title: true,
      workoutDate: true,
      trainingType: true,
      durationMinutes: true,
      notes: true,
      exercises: {
        orderBy: { position: "asc" },
        select: {
          exercise: { select: { id: true, name: true, userId: true } },
          sets: { orderBy: { position: "asc" }, select: { reps: true, load: true, loadUnit: true } },
        },
      },
    },
    orderBy: [{ workoutDate: "desc" }, { recordedAt: "desc" }, { id: "desc" }],
  });

  const sessions: WorkoutGroundingSession[] = rows.map((row) => ({
    date: fromDateColumn(row.workoutDate),
    title: row.title,
    trainingType: row.trainingType,
    durationMinutes: row.durationMinutes,
    notes: row.notes,
    exercises: row.exercises.map((entry) => ({
      exerciseId: entry.exercise.id,
      name: entry.exercise.name,
      isCustom: entry.exercise.userId !== null,
      sets: entry.sets.map((set) => ({
        reps: set.reps,
        load: set.load === null ? null : set.load.toNumber(),
        loadUnit: set.loadUnit,
      })),
    })),
  }));
  const windowSessions = sessions.filter((session) => isWithinRange(session.date, window));

  const summaries = new Map<number, WorkoutExerciseSummary>();
  for (const session of windowSessions) {
    for (const entry of session.exercises) {
      const summary = summaries.get(entry.exerciseId) ?? {
        name: entry.name,
        isCustom: entry.isCustom,
        sessions: 0,
        totalSets: 0,
        totalReps: 0,
        topLoadKg: null,
        topLoadLb: null,
        lastPerformed: session.date,
      };

      summary.sessions += 1;
      summary.totalSets += entry.sets.length;
      for (const set of entry.sets) {
        summary.totalReps += set.reps;
        if (set.load !== null && set.loadUnit === "KG") summary.topLoadKg = Math.max(summary.topLoadKg ?? 0, set.load);
        if (set.load !== null && set.loadUnit === "LB") summary.topLoadLb = Math.max(summary.topLoadLb ?? 0, set.load);
      }
      if (session.date > summary.lastPerformed) summary.lastPerformed = session.date;
      summaries.set(entry.exerciseId, summary);
    }
  }

  return {
    today,
    requestedDays: days,
    window: { ...window, sessions: windowSessions },
    currentPeriod: summarizeWorkoutPeriod(sessions, periods.current),
    previousPeriod: summarizeWorkoutPeriod(sessions, periods.previous),
    // Most frequent first, then most recent, then name: deterministic.
    exerciseSummaries: [...summaries.values()].sort(
      (a, b) =>
        b.sessions - a.sessions ||
        b.totalSets - a.totalSets ||
        (a.lastPerformed < b.lastPerformed ? 1 : a.lastPerformed > b.lastPerformed ? -1 : 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    ),
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
