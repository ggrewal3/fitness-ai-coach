import { fileURLToPath } from "node:url";
import { LocalObjectStorage } from "./localObjectStorage.js";
import type { ObjectStorage } from "./objectStorage.js";

// backend/storage/ — private, git-ignored, never served statically. The path is
// relative to this module so it is the same from src/ (tsx) and dist/ (node).
export const DEFAULT_LOCAL_STORAGE_ROOT = fileURLToPath(new URL("../../../storage", import.meta.url));

let activeStorage: ObjectStorage | undefined;

/** The application's object storage. Only local storage exists today. */
export function getObjectStorage(): ObjectStorage {
  if (!activeStorage) {
    activeStorage = new LocalObjectStorage(DEFAULT_LOCAL_STORAGE_ROOT);
  }

  return activeStorage;
}

/** Replaces the storage implementation (tests use an isolated temp directory). */
export function setObjectStorage(storage: ObjectStorage): void {
  activeStorage = storage;
}
