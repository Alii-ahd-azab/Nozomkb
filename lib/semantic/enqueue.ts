// Adds (or re-adds) the semantic indexing Job for one source version.
// Shared by the Next.js app, the Worker and the reindex command.
import type { Queue } from "bullmq";
import {
  INDEX_SOURCE_JOB,
  SEMANTIC_JOB_OPTIONS,
  semanticJobId,
  type SemanticJobData,
} from "@/lib/semantic/config";

export async function enqueueSemanticJob(
  queue: Queue<SemanticJobData>,
  data: SemanticJobData
) {
  const jobId = semanticJobId(data);
  const existing = await queue.getJob(jobId);

  if (existing) {
    const state = await existing.getState();

    // Already waiting / delayed / running for this exact version.
    if (state !== "completed" && state !== "failed" && state !== "unknown") {
      return { jobId, added: false };
    }

    // Finished earlier (e.g. before a model change or after a failure):
    // remove it so the same version can be indexed again.
    await existing.remove();
  }

  await queue.add(INDEX_SOURCE_JOB, data, { ...SEMANTIC_JOB_OPTIONS, jobId });

  return { jobId, added: true };
}
