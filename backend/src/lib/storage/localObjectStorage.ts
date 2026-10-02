import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectStorageError, type ObjectStorage } from "./objectStorage.js";
import { signMediaKey } from "./signedMediaUrl.js";

// Keys are "<prefix>/<name>.<ext>" made only of safe characters; anything else
// (absolute paths, "..", backslashes, nested directories) is rejected before
// touching the filesystem.
const SAFE_KEY_PATTERN = /^[a-z]+\/[A-Za-z0-9-]+\.[a-z0-9]+$/;

export type StoredObject = { key: string; modifiedAt: Date };

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * Development storage: private files under a directory that is never served
 * statically. Browsers read objects only through the signed media endpoint
 * (GET /api/media/...), which calls `read`.
 */
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = path.resolve(rootDirectory);
  }

  /** Absolute path for a validated key, guaranteed to stay inside the root. */
  private resolve(key: string): string {
    if (!SAFE_KEY_PATTERN.test(key)) {
      throw new ObjectStorageError("Invalid object key.");
    }

    const resolved = path.resolve(this.root, key);

    if (!resolved.startsWith(this.root + path.sep)) {
      throw new ObjectStorageError("Invalid object key.");
    }

    return resolved;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const target = this.resolve(key);
    // Write to a temporary file and rename, so a partially written object is
    // never visible under its real key.
    const temporary = `${target}.${randomUUID()}.tmp`;

    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temporary, body, { flag: "wx" });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw new ObjectStorageError(error instanceof Error ? error.message : undefined);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (error) {
      if (isMissingFile(error)) {
        return;
      }

      throw error instanceof ObjectStorageError ? error : new ObjectStorageError();
    }
  }

  async getReadUrl(key: string): Promise<string> {
    this.resolve(key);
    const { expires, signature } = signMediaKey(key);
    // Root-relative: clients resolve it against the API origin.
    return `/api/media/${key}?expires=${expires}&signature=${signature}`;
  }

  /** Object bytes, or null when the object does not exist. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }

      throw error instanceof ObjectStorageError ? error : new ObjectStorageError();
    }
  }

  /** Objects directly under a prefix (used by the orphan sweep). */
  async list(prefix: string): Promise<StoredObject[]> {
    const directory = path.join(this.root, prefix);
    let names: string[];

    try {
      names = await readdir(directory);
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }

      throw error;
    }

    const objects: StoredObject[] = [];

    for (const name of names) {
      const key = `${prefix}/${name}`;

      if (!SAFE_KEY_PATTERN.test(key)) {
        continue; // e.g. temporary ".tmp" files from an interrupted write
      }

      const info = await stat(path.join(directory, name));

      if (info.isFile()) {
        objects.push({ key, modifiedAt: info.mtime });
      }
    }

    return objects;
  }
}
