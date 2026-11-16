// Adds (or re-adds) the processing Job for one File version.
// Shared by the Next.js app and the Worker's start-up reconciliation.
import type { Queue } from "bullmq";
import {
  FILE_JOB_OPTIONS,
  PROCESS_FILE_JOB,
  fileJobId,
  type FileJobData,
} from "@/lib/processing/config";

export type EnqueueResult = { jobId: string; added: boolean };

export async function enqueueFileJob(
  queue: Queue<FileJobData>,
  fileId: number,
  version: number
): Promise<EnqueueResult> {
  const jobId = fileJobId(fileId, version);
  const existing = await queue.getJob(jobId);

  if (existing) {
    const state = await existing.getState();

    // Already waiting / delayed / running for this exact version.
    if (state !== "completed" && state !== "failed" && state !== "unknown") {
      return { jobId, added: false };
    }

    // A finished Job keeps its id for a while; remove it so a manual retry
    // (or re-enable) of the same version can run again.
    await existing.remove();
  }

  await queue.add(PROCESS_FILE_JOB, { fileId, version }, { ...FILE_JOB_OPTIONS, jobId });

  return { jobId, added: true };
}
