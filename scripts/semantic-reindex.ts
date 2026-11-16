// Week 8 — `npm run semantic:reindex`
//
// Bootstrap / repair of the semantic index. Safe to run any number of times:
//
//   1. removes vectors that are stale or no longer eligible
//      (old versions, drafts, archived, disabled / not-Ready Files, ...)
//   2. finds every eligible source that is missing, outdated, failed or was
//      embedded with another model
//        - published Official Pages and Community Posts
//        - Comments whose parent is published
//        - active, Ready Files (current version Chunks)
//   3. queues one indexing Job per source for the Worker (default), or
//      embeds them right here with --inline (no Worker needed).
//
// Options:
//   --inline   index in this process instead of queueing Jobs
//   --status   only print the current index status
//
// Never prints DATABASE_URL / REDIS_URL / API keys.
import { loadWorkerEnv } from "../worker/env";

loadWorkerEnv();

async function main() {
  const args = new Set(process.argv.slice(2));
  const { Pool } = await import("pg");
  const { Queue } = await import("bullmq");
  const { QUEUE_PREFIX } = await import("@/lib/processing/config");
  const { createRedisConnection } = await import("@/lib/processing/redis");
  const { embeddingModelId, getEmbeddingConfig, semanticQueueName } = await import(
    "@/lib/semantic/config"
  );
  const { reconcileSemanticIndex } = await import("@/lib/semantic/lifecycle");
  const { enqueueSemanticJob } = await import("@/lib/semantic/enqueue");
  const { createEmbeddingProvider } = await import("@/lib/semantic/provider");
  const { indexSource, recordIndexingFailure } = await import("@/lib/semantic/index-source");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const config = getEmbeddingConfig();
  const modelId = embeddingModelId(config);

  async function printStatus() {
    const status = await pool.query<{ source_kind: string; status: string; count: string }>(
      `SELECT source_kind, status, COUNT(*) AS count FROM semantic_index_status
       GROUP BY source_kind, status ORDER BY source_kind, status`
    );
    const docs = await pool.query<{ source_type: string; embedding_model: string; count: string }>(
      `SELECT source_type, embedding_model, COUNT(*) AS count FROM semantic_documents
       GROUP BY source_type, embedding_model ORDER BY source_type, embedding_model`
    );
    console.log("indexing status:", status.rows.map((r) => `${r.source_kind}/${r.status}=${r.count}`).join(", ") || "(none)");
    console.log("vectors:", docs.rows.map((r) => `${r.source_type} [${r.embedding_model}]=${r.count}`).join(", ") || "(none)");
  }

  console.log(`[reindex] embedding model: ${modelId}${config.testOnly ? "  (TEST ONLY)" : ""}`);

  if (args.has("--status")) {
    await printStatus();
    await pool.end();
    return;
  }

  const result = await reconcileSemanticIndex(pool, { kind: "all" }, modelId);
  console.log(
    `[reindex] removed ${result.removedDocuments} stale vector(s), ${result.removedStatuses} stale status row(s); ` +
      `${result.targets.length} source(s) need indexing`
  );

  if (args.has("--inline")) {
    const provider = await createEmbeddingProvider(config);
    const outcomes: Record<string, number> = {};

    for (const target of result.targets) {
      try {
        const outcome = await indexSource(pool, provider, target);
        outcomes[outcome.outcome] = (outcomes[outcome.outcome] ?? 0) + 1;
      } catch (error) {
        outcomes.failed = (outcomes.failed ?? 0) + 1;
        await recordIndexingFailure(pool, target, true);
        console.error(
          `[reindex] ${target.sourceType} ${target.sourceId} v${target.sourceVersion} failed:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    console.log("[reindex] inline outcomes:", JSON.stringify(outcomes));
  } else if (result.targets.length > 0) {
    const queue = new Queue(semanticQueueName(config), {
      connection: createRedisConnection("queue"),
      prefix: QUEUE_PREFIX,
    });
    let added = 0;

    for (const target of result.targets) {
      if ((await enqueueSemanticJob(queue, target)).added) added += 1;
    }

    await queue.close();
    console.log(`[reindex] queued ${added} job(s) on "${QUEUE_PREFIX}:${queue.name}" (run \`npm run worker\` to process them)`);
  }

  await printStatus();
  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[reindex] failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
