// Week 7 — processing of ONE File version. Called by the BullMQ Worker
// (worker/index.ts); kept separate so the logic is testable on its own.
//
//   load File -> missing? stale version? disabled? -> exit safely
//   -> status processing -> read private bytes -> extract -> chunk
//   -> ONE transaction: lock File row, re-check version,
//      replace this version's Chunks, status ready -> COMMIT
//
// Idempotency: the transaction deletes this File's Chunks and inserts the
// freshly computed (deterministic) set, under a row lock, with
// UNIQUE (file_id, version, chunk_index) as a last line of defence.
// Running the same Job twice (retry, duplicate delivery) therefore always
// ends with the same N Chunks — never 2N — and a failure midway rolls back
// to the previous state instead of leaving half a Chunk set.
import type { Pool } from "pg";
import { AR } from "@/lib/messages";
import { chunkPages } from "@/lib/processing/chunk";
import { extractPages, NotIndexableError } from "@/lib/processing/extract";
import { readStoredFile } from "@/lib/processing/storage-path";
import type { FileJobData } from "@/lib/processing/config";

export type ProcessOutcome =
  | { outcome: "ready"; pages: number; chunks: number }
  // nothing to do; the Job finishes without touching data
  | { outcome: "missing" | "stale" | "inactive" };

// A temporary problem (file not readable yet, DB hiccup...): BullMQ retries.
export class TransientProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientProcessingError";
  }
}

type FileState = { version: number; is_active: boolean };

async function classifySkip(
  pool: Pool,
  job: FileJobData
): Promise<ProcessOutcome | null> {
  const result = await pool.query<FileState>(
    "SELECT version, is_active FROM files WHERE id = $1",
    [job.fileId]
  );
  const file = result.rows[0];

  if (!file) return { outcome: "missing" };
  if (file.version !== job.version) return { outcome: "stale" };
  if (!file.is_active) return { outcome: "inactive" };

  return null;
}

export async function processFile(
  pool: Pool,
  job: FileJobData
): Promise<ProcessOutcome> {
  const skip = await classifySkip(pool, job);

  if (skip) {
    return skip;
  }

  // Mark as processing (a Ready File being re-run stays Ready: its current
  // Chunks remain valid and searchable until the new set replaces them).
  const started = await pool.query<{ storage_key: string; mime_type: string }>(
    `
      UPDATE files
      SET processing_status = CASE
            WHEN processing_status = 'ready' THEN 'ready'
            ELSE 'processing'
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND version = $2 AND is_active
      RETURNING storage_key, mime_type
    `,
    [job.fileId, job.version]
  );

  const file = started.rows[0];

  if (!file) {
    // changed between the two statements (deleted / replaced / disabled)
    return (await classifySkip(pool, job)) ?? { outcome: "stale" };
  }

  const bytes = await readStoredFile(file.storage_key);

  if (!bytes) {
    // Replaced or deleted meanwhile -> stale/missing, otherwise a real
    // (possibly temporary) storage problem worth retrying.
    const changed = await classifySkip(pool, job);

    if (changed) {
      return changed;
    }

    throw new TransientProcessingError("Stored file is not readable.");
  }

  const pages = await extractPages(new Uint8Array(bytes), file.mime_type);
  const chunks = chunkPages(pages);

  if (chunks.length === 0) {
    throw new NotIndexableError(AR.processingEmptyText);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serializes concurrent Jobs for the same File and blocks a concurrent
    // replace/disable/delete until we are done (or vice versa).
    const locked = await client.query<FileState>(
      "SELECT version, is_active FROM files WHERE id = $1 FOR UPDATE",
      [job.fileId]
    );
    const current = locked.rows[0];

    if (!current || current.version !== job.version) {
      await client.query("ROLLBACK");
      return { outcome: current ? "stale" : "missing" };
    }

    if (!current.is_active) {
      // Disabled while we worked: do not index it; it is queued again
      // when it is re-enabled.
      await client.query(
        `UPDATE files SET processing_status = 'pending', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND version = $2 AND processing_status = 'processing'`,
        [job.fileId, job.version]
      );
      await client.query("COMMIT");
      return { outcome: "inactive" };
    }

    // Replace this version's Chunks (and drop any older version's leftovers).
    await client.query(
      "DELETE FROM file_chunks WHERE file_id = $1 AND version <= $2",
      [job.fileId, job.version]
    );

    await client.query(
      `
        INSERT INTO file_chunks (file_id, version, page_number, chunk_index, text)
        SELECT $1, $2, chunk.page_number, chunk.chunk_index, chunk.text
        FROM unnest($3::int[], $4::int[], $5::text[])
          AS chunk(page_number, chunk_index, text)
      `,
      [
        job.fileId,
        job.version,
        chunks.map((chunk) => chunk.pageNumber),
        chunks.map((chunk) => chunk.chunkIndex),
        chunks.map((chunk) => chunk.text),
      ]
    );

    await client.query(
      `
        UPDATE files
        SET processing_status = 'ready',
            processing_error = NULL,
            processed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND version = $2
      `,
      [job.fileId, job.version]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return { outcome: "ready", pages: pages.length, chunks: chunks.length };
}

// Stores a SAFE message (never a stack trace) for the current version only,
// and never downgrades a File another Job already finished (Ready).
export async function recordProcessingFailure(
  pool: Pool,
  job: FileJobData,
  error: unknown,
  finalAttempt: boolean
) {
  const permanent = error instanceof NotIndexableError;
  const message = permanent
    ? error.message
    : finalAttempt
      ? AR.processingFailed
      : AR.processingRetrying;

  await pool.query(
    `
      UPDATE files
      SET processing_status = $3,
          processing_error = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND version = $2
        AND processing_status IN ('pending', 'processing')
    `,
    [job.fileId, job.version, finalAttempt ? "failed" : "pending", message]
  );

  return { permanent, message };
}
