import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import { BUILT_IN_EXERCISES } from "./exercise.catalog.js";
import { toDisplayName, toNormalizedName } from "./exercise.normalize.js";
import type {
  ExerciseResponse,
  FindOrCreateExerciseResult,
  SeedBuiltInExercisesResult,
} from "./exercise.types.js";

export const MAX_CUSTOM_EXERCISES_PER_USER = 500;

// The visible set (built-in catalogue + at most MAX_CUSTOM_EXERCISES_PER_USER
// custom exercises) is small and bounded, so ranking happens in memory over
// every candidate. This bound is only a safety net.
const SEARCH_CANDIDATE_LIMIT = 1000;

const exerciseSelect = {
  id: true,
  name: true,
  normalizedName: true,
  userId: true,
} as const;

type ExerciseRow = {
  id: number;
  name: string;
  normalizedName: string;
  userId: number | null;
};

export class CustomExerciseLimitError extends Error {
  constructor() {
    super("Custom exercise limit reached.");
    this.name = "CustomExerciseLimitError";
  }
}

/** Built-in exercises plus the given user's own custom exercises - never anyone else's. */
export function visibleExerciseWhere(userId: number): Prisma.ExerciseWhereInput {
  return {
    OR: [{ userId: null }, { userId }],
  };
}

function toExerciseResponse(row: ExerciseRow): ExerciseResponse {
  return {
    id: row.id,
    name: row.name,
    isCustom: row.userId !== null,
  };
}

// Plain code-point comparison keeps "alphabetical" identical everywhere,
// independent of the database collation.
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareAlphabetically(a: ExerciseRow, b: ExerciseRow): number {
  return compareStrings(a.normalizedName, b.normalizedName) || a.id - b.id;
}

/**
 * 0 exact match, 1 whole-query prefix, 2 every token starts a word,
 * 3 every token appears somewhere, null no match.
 */
function rankMatch(
  normalizedName: string,
  query: string,
  tokens: string[]
): number | null {
  if (!tokens.every((token) => normalizedName.includes(token))) {
    return null;
  }

  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;

  const words = normalizedName.split(" ");

  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) {
    return 2;
  }

  return 3;
}

export async function searchExercises(
  userId: number,
  search: string | undefined,
  limit: number
): Promise<ExerciseResponse[]> {
  const query = toNormalizedName(search ?? "");
  const tokens = query.split(" ").filter(Boolean);

  const candidates = await prisma.exercise.findMany({
    where: {
      AND: [
        visibleExerciseWhere(userId),
        ...tokens.map((token) => ({ normalizedName: { contains: token } })),
      ],
    },
    select: exerciseSelect,
    orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
    take: SEARCH_CANDIDATE_LIMIT,
  });

  if (tokens.length === 0) {
    return [...candidates]
      .sort(compareAlphabetically)
      .slice(0, limit)
      .map(toExerciseResponse);
  }

  return candidates
    .map((row) => ({ row, rank: rankMatch(row.normalizedName, query, tokens) }))
    .filter(
      (entry): entry is { row: ExerciseRow; rank: number } => entry.rank !== null
    )
    .sort((a, b) => a.rank - b.rank || compareAlphabetically(a.row, b.row))
    .slice(0, limit)
    .map((entry) => toExerciseResponse(entry.row));
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function findExistingExercise(
  userId: number,
  normalizedName: string
): Promise<ExerciseRow | null> {
  // A matching built-in always wins over creating a redundant custom copy.
  const builtIn = await prisma.exercise.findFirst({
    where: { userId: null, normalizedName },
    select: exerciseSelect,
    orderBy: { id: "asc" },
  });

  if (builtIn) {
    return builtIn;
  }

  return prisma.exercise.findUnique({
    where: { userId_normalizedName: { userId, normalizedName } },
    select: exerciseSelect,
  });
}

/**
 * Returns the built-in or the user's own custom exercise with the same
 * normalized name if one exists; otherwise creates a private custom exercise.
 */
export async function findOrCreateCustomExercise(
  userId: number,
  name: string
): Promise<FindOrCreateExerciseResult> {
  const displayName = toDisplayName(name);
  const normalizedName = toNormalizedName(displayName);

  const existing = await findExistingExercise(userId, normalizedName);

  if (existing) {
    return { exercise: toExerciseResponse(existing), created: false };
  }

  const customCount = await prisma.exercise.count({ where: { userId } });

  if (customCount >= MAX_CUSTOM_EXERCISES_PER_USER) {
    throw new CustomExerciseLimitError();
  }

  try {
    const created = await prisma.exercise.create({
      data: { userId, name: displayName, normalizedName },
      select: exerciseSelect,
    });

    return { exercise: toExerciseResponse(created), created: true };
  } catch (error) {
    // A concurrent request created the same custom exercise first.
    if (isUniqueConstraintError(error)) {
      const raced = await findExistingExercise(userId, normalizedName);

      if (raced) {
        return { exercise: toExerciseResponse(raced), created: false };
      }
    }

    throw error;
  }
}

function assertCatalogueIsConsistent(): void {
  const keys = new Set<string>();
  const normalizedNames = new Set<string>();

  for (const entry of BUILT_IN_EXERCISES) {
    const normalizedName = toNormalizedName(entry.name);

    if (keys.has(entry.key)) {
      throw new Error(`Duplicate built-in exercise key: ${entry.key}`);
    }

    if (normalizedNames.has(normalizedName)) {
      throw new Error(`Duplicate built-in exercise name: ${entry.name}`);
    }

    keys.add(entry.key);
    normalizedNames.add(normalizedName);
  }
}

/**
 * Idempotently upserts the built-in catalogue by builtInKey. Missing entries
 * are created, renamed entries are updated in place (keeping their id), and
 * nothing is ever deleted because workouts may reference seeded rows.
 */
export async function seedBuiltInExercises(
  client: PrismaClient = prisma
): Promise<SeedBuiltInExercisesResult> {
  assertCatalogueIsConsistent();

  return client.$transaction(async (tx) => {
    const existing = await tx.exercise.findMany({
      where: { builtInKey: { not: null } },
      select: { builtInKey: true, name: true, normalizedName: true },
    });
    const existingByKey = new Map(
      existing.map((row) => [row.builtInKey as string, row] as const)
    );

    const result: SeedBuiltInExercisesResult = {
      total: BUILT_IN_EXERCISES.length,
      created: 0,
      updated: 0,
      unchanged: 0,
    };

    for (const entry of BUILT_IN_EXERCISES) {
      const name = toDisplayName(entry.name);
      const normalizedName = toNormalizedName(name);
      const current = existingByKey.get(entry.key);

      if (!current) {
        await tx.exercise.create({
          data: { builtInKey: entry.key, name, normalizedName, userId: null },
        });
        result.created += 1;
      } else if (
        current.name !== name ||
        current.normalizedName !== normalizedName
      ) {
        await tx.exercise.update({
          where: { builtInKey: entry.key },
          data: { name, normalizedName },
        });
        result.updated += 1;
      } else {
        result.unchanged += 1;
      }
    }

    return result;
  });
}
