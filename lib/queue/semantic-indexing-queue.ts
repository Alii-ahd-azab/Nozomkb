// Week 8 — the Next.js side of semantic indexing.
//
// Called right after content is created / edited / published / archived,
// a Comment is written, or a File is replaced / disabled / enabled:
//
//   1. NOW, inside the request: reconcile the index for that item in
//      PostgreSQL -> stale or no-longer-eligible vectors are deleted and the
//      item is marked "pending" (no embedding provider, no Redis needed).
//   2. AFTER the response: add small Jobs ({ sourceType, sourceId,
//      sourceVersion }) to the Queue; the Worker embeds the text later.
//
// A failure here never fails the user's request: Search re-checks
// version + eligibility + permissions at query time anyway, and pending items
// are re-queued by the Worker on start-up and by `npm run semantic:reindex`.
import "server-only";

import { after } from "next/server";
import { Queue } from "bullmq";
import pool from "@/lib/db";
import {
  embeddingModelId,
  getEmbeddingConfig,
  semanticQueueName,
  type SemanticJobData,
} from "@/lib/semantic/config";
import { enqueueSemanticJob } from "@/lib/semantic/enqueue";
import { reconcileSemanticIndex, type SemanticScope } from "@/lib/semantic/lifecycle";
import { QUEUE_PREFIX } from "@/lib/processing/config";
import { createRedisConnection } from "@/lib/processing/redis";

const globalForQueue = globalThis as unknown as {
  nozomSemanticQueues?: Map<string, Queue<SemanticJobData>>;
};

function getSemanticQueue(name: string) {
  globalForQueue.nozomSemanticQueues ??= new Map();
  let queue = globalForQueue.nozomSemanticQueues.get(name);

  if (!queue) {
    queue = new Queue<SemanticJobData>(name, {
      connection: createRedisConnection("queue"),
      prefix: QUEUE_PREFIX,
    });
    queue.on("error", (error) => console.error("[semantic-queue]", error.message));
    globalForQueue.nozomSemanticQueues.set(name, queue);
  }

  return queue;
}

const ENQUEUE_TIMEOUT_MS = 5000;

async function enqueueAll(queueName: string, targets: SemanticJobData[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      (async () => {
        const queue = getSemanticQueue(queueName);
        for (const target of targets) await enqueueSemanticJob(queue, target);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out while adding semantic indexing jobs.")),
          ENQUEUE_TIMEOUT_MS
        );
      }),
    ]);
  } catch (error) {
    // Items stay "pending" in PostgreSQL and are picked up later.
    console.error(
      `[semantic-queue] could not enqueue ${targets.length} job(s):`,
      error instanceof Error ? error.message : error
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function syncSemanticIndex(scope: SemanticScope) {
  let modelId: string | null = null;
  let queueName: string | null = null;

  try {
    const config = getEmbeddingConfig();
    modelId = embeddingModelId(config);
    queueName = semanticQueueName(config);
  } catch (error) {
    // Misconfigured provider: still invalidate stale vectors, just do not queue.
    console.error("[semantic] embedding configuration:", error instanceof Error ? error.message : error);
  }

  try {
    const { targets } = await reconcileSemanticIndex(pool, scope, modelId);

    if (queueName && targets.length > 0) {
      const name = queueName;
      after(() => enqueueAll(name, targets));
    }
  } catch (error) {
    console.error("[semantic] reconcile failed:", error instanceof Error ? error.message : error);
  }
}
