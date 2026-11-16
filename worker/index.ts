// NozomKB Week 7 — standalone TypeScript Worker (separate from `next dev`).
//
//   npm run worker        (or npm run worker:dev to restart on code changes)
//
// Takes "process-file" Jobs from the BullMQ Queue in Redis and runs
// processFile(): read the private File -> extract text -> Chunks -> PostgreSQL.
import { loadWorkerEnv } from "./env";

loadWorkerEnv();

async function main() {
  // Imported after the environment is loaded.
  const { Pool } = await import("pg");
  const { Queue, UnrecoverableError, Worker } = await import("bullmq");
  const {
    FILE_QUEUE_NAME,
    QUEUE_PREFIX,
    parseFileJobData,
  } = await import("@/lib/processing/config");
  const { createRedisConnection } = await import("@/lib/processing/redis");
  const { enqueueFileJob } = await import("@/lib/processing/enqueue");
  const { NotIndexableError } = await import("@/lib/processing/extract");
  const { processFile, recordProcessingFailure } = await import(
    "@/lib/processing/process-file"
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 2);

  const worker = new Worker(
    FILE_QUEUE_NAME,
    async (job) => {
      const data = parseFileJobData(job.data);
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 1;

      try {
        const result = await processFile(pool, data);
        console.log(
          `[worker] job ${job.id} file ${data.fileId} v${data.version}: ${result.outcome}` +
            (result.outcome === "ready" ? ` (${result.pages} page(s), ${result.chunks} chunk(s))` : "")
        );
        return result;
      } catch (error) {
        const permanent = error instanceof NotIndexableError;
        // BullMQ retries while attemptsMade + 1 < attempts (and the error is
        // not Unrecoverable) — the same rule decides "final" here.
        const finalAttempt = permanent || attempt >= maxAttempts;

        await recordProcessingFailure(pool, data, error, finalAttempt);

        // Full details stay in the Worker log; users only see a safe message.
        console.error(
          `[worker] job ${job.id} file ${data.fileId} v${data.version} attempt ${attempt}/${maxAttempts} failed` +
            (finalAttempt ? " (final)" : " (will retry)"),
          error instanceof Error ? error.message : error
        );

        // Not indexable (empty / scanned / unreadable): retrying cannot help.
        if (permanent) {
          throw new UnrecoverableError((error as Error).message);
        }

        throw error;
      }
    },
    {
      connection: createRedisConnection("worker"),
      prefix: QUEUE_PREFIX,
      concurrency,
      // Client name lets tests/tools see which processes are NozomKB Workers.
      name: `nozomkb-worker-${process.pid}`,
    }
  );

  worker.on("error", (error) => console.error("[worker] error:", error.message));

  await worker.waitUntilReady();
  console.log(
    `[worker] listening on "${QUEUE_PREFIX}:${FILE_QUEUE_NAME}" (concurrency ${concurrency}, pid ${process.pid})`
  );

  // Recovery after a restart / Redis outage: re-queue active Files that never
  // finished. Duplicates are harmless (same jobId is skipped, and processing
  // is idempotent in PostgreSQL anyway).
  const queue = new Queue(FILE_QUEUE_NAME, {
    connection: createRedisConnection("queue"),
    prefix: QUEUE_PREFIX,
  });

  try {
    const unfinished = await pool.query<{ id: string; version: number }>(
      `SELECT id, version FROM files
       WHERE is_active AND processing_status IN ('pending', 'processing')
       ORDER BY id`
    );

    let added = 0;

    for (const row of unfinished.rows) {
      const result = await enqueueFileJob(queue, Number(row.id), row.version);
      if (result.added) added += 1;
    }

    if (unfinished.rows.length > 0) {
      console.log(
        `[worker] start-up check: ${unfinished.rows.length} unfinished file(s), ${added} job(s) queued`
      );
    }
  } catch (error) {
    console.error(
      "[worker] start-up check failed:",
      error instanceof Error ? error.message : error
    );
  }

  let stopping = false;

  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received, finishing current jobs...`);

    // Lets running Jobs finish; Jobs not started stay in Redis for next time.
    await worker.close();
    await queue.close();
    await pool.end();
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[worker] failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
