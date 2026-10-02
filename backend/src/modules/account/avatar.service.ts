import { randomUUID } from "node:crypto";
import { type AvatarInputType, processAvatarImage } from "../../lib/images/avatarImage.js";
import prisma from "../../lib/prisma.js";
import { getObjectStorage } from "../../lib/storage/index.js";
import { getAccount } from "./account.service.js";
import type { AccountResponse } from "./account.types.js";

// Profile photo lifecycle (ADR-024).
//
// The database is the authority on which object is the user's avatar. An
// object is deleted only after the database stopped referencing it, so a
// failure at any step can at worst leave an unreferenced object (an orphan,
// removed later by the orphan sweep) and never a broken or lost avatar.

/** Storing the new photo failed; nothing was changed. */
export class AvatarStorageError extends Error {
  constructor() {
    super("Profile photo storage failed.");
    this.name = "AvatarStorageError";
  }
}

const AVATAR_CONTENT_TYPE = "image/webp";

/** Best-effort delete. Failures are logged with the opaque key only. */
async function deleteObjectQuietly(key: string, event: string): Promise<void> {
  try {
    await getObjectStorage().delete(key);
  } catch {
    console.warn({ event, key });
  }
}

/**
 * Locks the user's row, swaps avatarKey, and returns the key it replaced
 * (null if none). Returns undefined when the user no longer exists.
 *
 * The row lock serializes concurrent replace/remove requests for one user:
 * each transaction reads the key that is current at the moment it writes, so
 * the key it later deletes is always one it personally replaced, never the
 * active avatar. (Same SELECT … FOR UPDATE pattern as workout updates.)
 */
async function swapAvatarKey(userId: number, nextKey: string | null): Promise<string | null | undefined> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ avatarKey: string | null }[]>`
      SELECT "avatarKey" FROM "User" WHERE "id" = ${userId} FOR UPDATE
    `;

    if (rows.length === 0) {
      return undefined;
    }

    const previousKey = rows[0].avatarKey;

    if (previousKey !== nextKey) {
      await tx.user.update({ where: { id: userId }, data: { avatarKey: nextKey } });
    }

    return previousKey;
  });
}

/**
 * Validates and processes the upload, stores it, then makes it the active
 * avatar. Returns null if the user no longer exists.
 *
 * Order matters:
 * 1. process (InvalidImageError → nothing stored, nothing changed)
 * 2. put the new object (failure → AvatarStorageError, old avatar untouched)
 * 3. swap the key in the database (failure → new object deleted best-effort,
 *    old avatar still active)
 * 4. delete the replaced object best-effort (failure → orphan, logged)
 */
export async function replaceAvatar(
  userId: number,
  upload: Buffer,
  declaredType: AvatarInputType
): Promise<AccountResponse | null> {
  const processed = await processAvatarImage(upload, declaredType);
  const newKey = `avatars/${randomUUID()}.webp`;

  try {
    await getObjectStorage().put(newKey, processed, AVATAR_CONTENT_TYPE);
  } catch {
    console.error({ event: "avatar.store.failed" });
    throw new AvatarStorageError();
  }

  let previousKey: string | null | undefined;

  try {
    previousKey = await swapAvatarKey(userId, newKey);
  } catch (error) {
    await deleteObjectQuietly(newKey, "avatar.cleanup.failed");
    throw error;
  }

  if (previousKey === undefined) {
    await deleteObjectQuietly(newKey, "avatar.cleanup.failed");
    return null;
  }

  if (previousKey) {
    await deleteObjectQuietly(previousKey, "avatar.orphaned");
  }

  return getAccount(userId);
}

/**
 * Clears the avatar (database first, then the object, best-effort).
 * Idempotent. Returns null if the user no longer exists.
 */
export async function removeAvatar(userId: number): Promise<AccountResponse | null> {
  const previousKey = await swapAvatarKey(userId, null);

  if (previousKey === undefined) {
    return null;
  }

  if (previousKey) {
    await deleteObjectQuietly(previousKey, "avatar.orphaned");
  }

  return getAccount(userId);
}
