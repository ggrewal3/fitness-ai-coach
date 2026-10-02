// Private object storage (ADR-024). Domain code depends only on this
// interface; LocalObjectStorage implements it for development, and an
// S3-compatible adapter can implement it later without changing callers.
//
// Keys are opaque, server-generated paths such as "avatars/<uuid>.webp".
// They are never derived from user input and never sent to clients.

export interface ObjectStorage {
  /** Stores bytes under `key`, replacing any existing object with that key. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Deletes the object. Deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
  /** A short-lived URL a browser can use to read the object. */
  getReadUrl(key: string): Promise<string>;
}

/** Raised when the storage backend itself fails (I/O, permissions, network). */
export class ObjectStorageError extends Error {
  constructor(message = "Object storage operation failed.") {
    super(message);
    this.name = "ObjectStorageError";
  }
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The only key shape the application writes for profile photos. */
export const AVATAR_KEY_PATTERN = new RegExp(`^avatars/${UUID}\\.webp$`);
export const AVATAR_FILE_PATTERN = new RegExp(`^${UUID}\\.webp$`);
