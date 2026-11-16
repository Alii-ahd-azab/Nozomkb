// Private storage location + safe key -> path resolution.
// Shared by the Next.js app (lib/storage.ts) and the standalone Worker.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const STORAGE_KEY_PATTERN = /^[0-9a-f-]{36}\.(pdf|txt)$/;

// Default: <project>/storage/private (git-ignored). Override with
// FILE_STORAGE_DIR for another private directory on the server.
// The Worker must run from the project root (npm scripts do that).
export function getStorageRoot() {
  return path.resolve(
    process.env.FILE_STORAGE_DIR ??
      path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "private")
  );
}

// Resolves a storage key to an absolute path and refuses anything that could
// leave the storage root (even if a bad key were somehow in the database).
export function resolveStoragePath(storageKey: string) {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new Error("Invalid storage key.");
  }

  const root = getStorageRoot();
  const fullPath = path.resolve(root, storageKey);

  if (path.dirname(fullPath) !== root) {
    throw new Error("Storage path escapes the storage root.");
  }

  return fullPath;
}

// null = the file is not on disk (missing); other errors are thrown.
export async function readStoredFile(storageKey: string) {
  try {
    return await readFile(resolveStoragePath(storageKey));
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
