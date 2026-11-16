// Week 7 — the Next.js side of the File processing Queue (producer only).
// The HTTP request only ADDS a small Job ({ fileId, version }) to Redis;
// extraction and Chunking happen later in the separate Worker process.
import "server-only";

import { Queue } from "bullmq";
import { FILE_QUEUE_NAME, QUEUE_PREFIX, type FileJobData } from "@/lib/processing/config";
import { enqueueFileJob } from "@/lib/processing/enqueue";
import { createRedisConnection } from "@/lib/processing/redis";

// One Queue per server process (survives dev hot reloads).
const globalForQueue = globalThis as unknown as {
  nozomFileQueue?: Queue<FileJobData>;
};

function getFileQueue() {
  if (!globalForQueue.nozomFileQueue) {
    const queue = new Queue<FileJobData>(FILE_QUEUE_NAME, {
      connection: createRedisConnection("queue"),
      prefix: QUEUE_PREFIX,
    });

    queue.on("error", (error) => {
      console.error("[file-queue]", error.message);
    });

    globalForQueue.nozomFileQueue = queue;
  }

  return globalForQueue.nozomFileQueue;
}

const ENQUEUE_TIMEOUT_MS = 5000;

// true = queued (or already queued). false = Redis/Queue unavailable: the
// caller keeps the File and records a retryable state instead.
export async function enqueueFileProcessing(fileId: number, version: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      enqueueFileJob(getFileQueue(), fileId, version),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out while adding the processing job.")),
          ENQUEUE_TIMEOUT_MS
        );
      }),
    ]);

    return true;
  } catch (error) {
    console.error(
      `[file-queue] could not enqueue file ${fileId} v${version}:`,
      error instanceof Error ? error.message : error
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}
