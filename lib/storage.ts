// Private local file storage (Week 6).
//
// Files are stored OUTSIDE public/, so Next.js never serves them directly.
// The only way to get a file is the authorized download route.
// Disk names are generated keys ("<uuid>.pdf|txt"), never the uploaded name.
import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const STORAGE_KEY_PATTERN = /^[0-9a-f-]{36}\.(pdf|txt)$/;

// Default: <project>/storage/private (git-ignored). Override with
// FILE_STORAGE_DIR for another private directory on the server.
export function getStorageRoot() {
  return path.resolve(
    process.env.FILE_STORAGE_DIR ??
      path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "private")
  );
}

export function generateStorageKey(extension: "pdf" | "txt") {
  return `${randomUUID()}.${extension}`;
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

export async function saveFile(storageKey: string, bytes: Uint8Array) {
  await mkdir(getStorageRoot(), { recursive: true });
  // "wx": never overwrite an existing file.
  await writeFile(resolveStoragePath(storageKey), bytes, { flag: "wx" });
}

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

// Missing files are fine (already gone); other errors are logged only.
export async function removeStoredFiles(storageKeys: string[]) {
  for (const key of storageKeys) {
    try {
      await unlink(resolveStoragePath(key));
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        console.error("Could not remove stored file", key, error);
      }
    }
  }
}
