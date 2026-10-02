// Finds (and optionally deletes) unreferenced avatar objects in local storage.
//
//   npm run storage:sweep-avatars              # dry run: report only
//   npm run storage:sweep-avatars -- --delete  # delete eligible orphans
//   npm run storage:sweep-avatars -- --min-age-hours=48
//
// Uses DATABASE_URL (backend/.env) to read which keys are referenced, and the
// default local storage directory (backend/storage). Prints opaque keys only.
import prisma from "../src/lib/prisma.js";
import { DEFAULT_LOCAL_STORAGE_ROOT } from "../src/lib/storage/index.js";
import { LocalObjectStorage } from "../src/lib/storage/localObjectStorage.js";
import { DEFAULT_ORPHAN_MIN_AGE_MS, sweepOrphanAvatars } from "../src/lib/storage/orphanSweep.js";

function parseArgs(argv: string[]) {
  const shouldDelete = argv.includes("--delete");
  const ageArg = argv.find((arg) => arg.startsWith("--min-age-hours="));
  const hours = ageArg ? Number(ageArg.split("=")[1]) : DEFAULT_ORPHAN_MIN_AGE_MS / 3_600_000;

  if (!Number.isFinite(hours) || hours < 1) {
    throw new Error("--min-age-hours must be a number of at least 1.");
  }

  return { dryRun: !shouldDelete, minAgeMs: hours * 3_600_000 };
}

async function main() {
  const { dryRun, minAgeMs } = parseArgs(process.argv.slice(2));
  const users = await prisma.user.findMany({ where: { avatarKey: { not: null } }, select: { avatarKey: true } });
  const referencedKeys = new Set(users.map((user) => user.avatarKey as string));

  const result = await sweepOrphanAvatars({
    storage: new LocalObjectStorage(DEFAULT_LOCAL_STORAGE_ROOT),
    referencedKeys,
    minAgeMs,
    dryRun,
  });

  console.log(`Mode: ${dryRun ? "dry run (nothing deleted; pass --delete to remove)" : "delete"}`);
  console.log(
    `Scanned ${result.scanned} avatar objects: ${result.referenced} referenced, ` +
      `${result.youngOrphans.length} unreferenced but younger than ${minAgeMs / 3_600_000}h (kept), ` +
      `${result.eligible.length} eligible orphans.`
  );

  for (const key of result.eligible) {
    console.log(`  ${dryRun ? "would delete" : "deleted"} ${key}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("Avatar sweep failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
