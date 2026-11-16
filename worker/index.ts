// NozomKB — standalone TypeScript Worker (separate from `next dev`).
//
//   npm run worker        (or npm run worker:dev to restart on code changes)
//
// Week 7: "process-file" Jobs (Queue nozom-file-processing): read the private
//         File -> extract text -> Chunks -> PostgreSQL.
// Week 8: "index-source" Jobs (Queue nozom-semantic-indexing): load a Page /
//         Post / Comment / File version from PostgreSQL -> embeddings ->
//         pgvector rows. A File that becomes Ready is queued for semantic
//         indexing automatically.
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
  const {
    EmbeddingConfigError,
    embeddingModelId,
    getEmbeddingConfig,
    parseSemanticJobData,
    semanticQueueName,
  } = await import("@/lib/semantic/config");
  const { createEmbeddingProvider, PermanentEmbeddingError } = await import(
    "@/lib/semantic/provider"
  );
  const { enqueueSemanticJob } = await import("@/lib/semantic/enqueue");
  const { reconcileSemanticIndex } = await import("@/lib/semantic/lifecycle");
  const { indexSource, recordIndexingFailure } = await import(
    "@/lib/semantic/index-source"
  );
  type SemanticJobData = import("@/lib/semantic/config").SemanticJobData;
  type EmbeddingProvider = import("@/lib/semantic/provider").EmbeddingProvider;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 2);
  const semanticConcurrency = Math.max(1, Number(process.env.SEMANTIC_WORKER_CONCURRENCY) || 1);

  // ---------------------------------------------------------------
  // Week 8: embedding configuration (validated once, at start-up)
  // ---------------------------------------------------------------
  const embeddingConfig = getEmbeddingConfig();
  const modelId = embeddingModelId(embeddingConfig);
  const semanticQueue = new Queue<SemanticJobData>(semanticQueueName(embeddingConfig), {
    connection: createRedisConnection("queue"),
    prefix: QUEUE_PREFIX,
  });

  if (embeddingConfig.testOnly) {
    console.log("[worker] *** TEST ONLY embedding provider: deterministic fake vectors (automated tests) ***");
  }

  // The provider (e.g. the local model) is created on the first Job.
  let providerPromise: Promise<EmbeddingProvider> | null = null;
  function getProvider() {
    if (!providerPromise) {
      providerPromise = createEmbeddingProvider(embeddingConfig);
      providerPromise.catch(() => {
        providerPromise = null;
      });
    }
    return providerPromise;
  }

  // Reconcile one scope and queue whatever needs (re-)indexing.
  async function syncSemantic(scope: Parameters<typeof reconcileSemanticIndex>[1]) {
    const { targets } = await reconcileSemanticIndex(pool, scope, modelId);
    for (const target of targets) await enqueueSemanticJob(semanticQueue, target);
    return targets.length;
  }

  // ---------------------------------------------------------------
  // Week 7: File processing Worker
  // ---------------------------------------------------------------
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

        // Week 8: Ready + active + current version -> semantic indexing of
        // its Chunks (only now: never before extraction/Chunking finished).
        if (result.outcome === "ready") {
          try {
            const queued = await syncSemantic({ kind: "file", id: data.fileId });
            if (queued > 0) console.log(`[worker] file ${data.fileId}: queued for semantic indexing`);
          } catch (error) {
            // The File stays Ready; semantic indexing is retried by
            // `npm run semantic:reindex` or the next start-up check.
            console.error(
              `[worker] file ${data.fileId}: could not queue semantic indexing:`,
              error instanceof Error ? error.message : error
            );
          }
        }

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

  // ---------------------------------------------------------------
  // Week 8: semantic indexing Worker
  // ---------------------------------------------------------------
  const semanticWorker = new Worker<SemanticJobData>(
    semanticQueue.name,
    async (job) => {
      const data = parseSemanticJobData(job.data);
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 1;
      const label = `${data.sourceType} ${data.sourceId} v${data.sourceVersion}`;

      try {
        const provider = await getProvider();
        const result = await indexSource(pool, provider, data);
        console.log(
          `[semantic] job ${job.id} ${label}: ${result.outcome}` +
            (result.outcome === "indexed" ? ` (${result.documents} vector(s))` : "")
        );
        return result;
      } catch (error) {
        // Wrong dimensions / invalid response / bad configuration: retrying
        // the same request cannot help.
        const permanent =
          error instanceof PermanentEmbeddingError || error instanceof EmbeddingConfigError;
        const finalAttempt = permanent || attempt >= maxAttempts;

        await recordIndexingFailure(pool, data, finalAttempt);

        // Provider details stay in this log (never keys); users see a safe message.
        console.error(
          `[semantic] job ${job.id} ${label} attempt ${attempt}/${maxAttempts} failed` +
            (finalAttempt ? " (final)" : " (will retry)"),
          error instanceof Error ? error.message : error
        );

        if (permanent) {
          throw new UnrecoverableError((error as Error).message);
        }

        throw error;
      }
    },
    {
      connection: createRedisConnection("worker"),
      prefix: QUEUE_PREFIX,
      concurrency: semanticConcurrency,
      name: `nozomkb-semantic-worker-${process.pid}`,
    }
  );

  semanticWorker.on("error", (error) => console.error("[semantic] error:", error.message));

  await worker.waitUntilReady();
  await semanticWorker.waitUntilReady();
  console.log(
    `[worker] listening on "${QUEUE_PREFIX}:${FILE_QUEUE_NAME}" (concurrency ${concurrency}, pid ${process.pid})`
  );
  console.log(
    `[semantic] listening on "${QUEUE_PREFIX}:${semanticQueue.name}" with ${modelId} (concurrency ${semanticConcurrency})`
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

  // Week 8 recovery: sources marked pending/indexing for THIS model (e.g. the
  // app could not reach Redis, or a Worker stopped mid-Job) are queued again.
  // A full rebuild is `npm run semantic:reindex`.
  try {
    const pending = await pool.query<{ source_kind: SemanticJobData["sourceType"]; source_id: string; source_version: number }>(
      `SELECT source_kind, source_id, source_version FROM semantic_index_status
       WHERE status IN ('pending', 'indexing') AND embedding_model = $1
       ORDER BY id`,
      [modelId]
    );

    let added = 0;

    for (const row of pending.rows) {
      const result = await enqueueSemanticJob(semanticQueue, {
        sourceType: row.source_kind,
        sourceId: Number(row.source_id),
        sourceVersion: row.source_version,
      });
      if (result.added) added += 1;
    }

    if (pending.rows.length > 0) {
      console.log(
        `[semantic] start-up check: ${pending.rows.length} unfinished source(s), ${added} job(s) queued`
      );
    }
  } catch (error) {
    console.error(
      "[semantic] start-up check failed:",
      error instanceof Error ? error.message : error
    );
  }

  let stopping = false;

  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received, finishing current jobs...`);

    // Lets running Jobs finish; Jobs not started stay in Redis for next time.
    await Promise.all([worker.close(), semanticWorker.close()]);
    await queue.close();
    await semanticQueue.close();
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
