// Private local file storage (Week 6).
//
// Files are stored OUTSIDE public/, so Next.js never serves them directly.
// The only way to get a file is the authorized download route.
// Disk names are generated keys ("<uuid>.pdf|txt"), never the uploaded name.
//
// Path rules live in lib/processing/storage-path.ts so the Week 7 Worker
// reads exactly the same location with exactly the same safety checks.
import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import {
  getStorageRoot,
  readStoredFile,
  resolveStoragePath,
} from "@/lib/processing/storage-path";

export { getStorageRoot, readStoredFile, resolveStoragePath };

export function generateStorageKey(extension: "pdf" | "txt") {
  return `${randomUUID()}.${extension}`;
}

export async function saveFile(storageKey: string, bytes: Uint8Array) {
  await mkdir(getStorageRoot(), { recursive: true });
  // "wx": never overwrite an existing file.
  await writeFile(resolveStoragePath(storageKey), bytes, { flag: "wx" });
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
