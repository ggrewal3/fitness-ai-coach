import type { LocalObjectStorage } from "./localObjectStorage.js";
import { AVATAR_KEY_PATTERN } from "./objectStorage.js";

// Manual maintenance for local avatar storage (ADR-024). An orphan is an
// avatar object no User.avatarKey references, left behind when a best-effort
// delete failed. Only orphans older than the age threshold are eligible: a
// newer object may be an upload whose database update has not committed yet.

export const DEFAULT_ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export type OrphanSweepOptions = {
  storage: LocalObjectStorage;
  /** Every key currently referenced by a User row. */
  referencedKeys: ReadonlySet<string>;
  now?: Date;
  minAgeMs?: number;
  /** Default true: report only. Pass false to delete eligible orphans. */
  dryRun?: boolean;
};

export type OrphanSweepResult = {
  scanned: number;
  referenced: number;
  /** Unreferenced but newer than the threshold; always kept. */
  youngOrphans: string[];
  /** Unreferenced and older than the threshold. */
  eligible: string[];
  /** Actually removed (empty in dry-run mode). */
  deleted: string[];
};

export async function sweepOrphanAvatars({
  storage,
  referencedKeys,
  now = new Date(),
  minAgeMs = DEFAULT_ORPHAN_MIN_AGE_MS,
  dryRun = true,
}: OrphanSweepOptions): Promise<OrphanSweepResult> {
  const objects = (await storage.list("avatars")).filter((object) => AVATAR_KEY_PATTERN.test(object.key));
  const result: OrphanSweepResult = { scanned: objects.length, referenced: 0, youngOrphans: [], eligible: [], deleted: [] };

  for (const object of objects) {
    if (referencedKeys.has(object.key)) {
      result.referenced += 1;
    } else if (now.getTime() - object.modifiedAt.getTime() < minAgeMs) {
      result.youngOrphans.push(object.key);
    } else {
      result.eligible.push(object.key);
    }
  }

  if (!dryRun) {
    for (const key of result.eligible) {
      await storage.delete(key);
      result.deleted.push(key);
    }
  }

  return result;
}
