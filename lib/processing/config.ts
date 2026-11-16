// Week 7 — shared Queue/Job settings for the Next.js app AND the standalone
// Worker. Plain Node module (no "server-only", no Next.js APIs) so the Worker
// can import it; it holds no secrets (REDIS_URL is read at call time).
import type { DefaultJobOptions } from "bullmq";

// Stable, explicit names that belong to NozomKB only. Every Redis key BullMQ
// creates starts with "nozomkb:nozom-file-processing:", so NozomKB never
// touches unrelated Redis data (and never needs FLUSHALL / FLUSHDB).
export const FILE_QUEUE_NAME = "nozom-file-processing";
export const QUEUE_PREFIX = "nozomkb";
export const PROCESS_FILE_JOB = "process-file";

export const FILE_JOB_ATTEMPTS = 3;

export const FILE_JOB_OPTIONS: DefaultJobOptions = {
  // 1 try + 2 automatic retries, waiting 3 s then 6 s.
  attempts: FILE_JOB_ATTEMPTS,
  backoff: { type: "exponential", delay: 3000 },
  // Keep finished Jobs for a while for inspection, then let Redis forget them.
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
};

// Only identifiers travel through Redis — never the File bytes.
export type FileJobData = {
  fileId: number;
  version: number;
};

// One Job id per File version: BullMQ ignores a second add while the first is
// still waiting/active. (PostgreSQL enforces idempotency independently.)
export function fileJobId(fileId: number, version: number) {
  return `file-${fileId}-v${version}`;
}

export function parseFileJobData(data: unknown): FileJobData {
  const { fileId, version } = (data ?? {}) as Record<string, unknown>;

  if (
    !Number.isSafeInteger(fileId) ||
    !Number.isSafeInteger(version) ||
    (fileId as number) < 1 ||
    (version as number) < 1
  ) {
    throw new Error("Invalid file processing job data.");
  }

  return { fileId: fileId as number, version: version as number };
}

// Server-side only. Never exposed through NEXT_PUBLIC_.
export function getRedisUrl() {
  return process.env.REDIS_URL || "redis://127.0.0.1:6379";
}
