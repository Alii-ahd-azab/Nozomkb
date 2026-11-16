import { getFileById, markQueueUnavailable, resetFailedFile, toFileItem } from "@/lib/files";
import { enqueueFileProcessing } from "@/lib/queue/file-processing-queue";
import { jsonError } from "@/lib/api";
import { AR } from "@/lib/messages";
import { arServerError, type RouteContext } from "@/lib/handlers/parent";
import { resolveFile } from "@/lib/handlers/file-item";

// POST /api/files/[id]/retry — manual retry of a Failed File.
// signed in -> may manage the parent -> File active + Failed
// -> Pending -> queue the CURRENT version again.
// Safe to repeat: the Worker replaces this version's Chunks, never adds more.
export async function POST(_request: Request, context: RouteContext) {
  try {
    const resolved = await resolveFile((await context.params).id, "manage");

    if ("response" in resolved) {
      return resolved.response;
    }

    const { file } = resolved;

    if (!file.isActive || file.status !== "failed") {
      return jsonError(AR.fileRetryNotAllowed, 409);
    }

    if (!(await resetFailedFile(file.id, file.version))) {
      // changed meanwhile (replaced, disabled, already retried)
      return jsonError(AR.fileRetryNotAllowed, 409);
    }

    if (!(await enqueueFileProcessing(file.id, file.version))) {
      await markQueueUnavailable(file.id, file.version, AR.processingQueueUnavailable);
      return jsonError(AR.fileRetryFailed, 503);
    }

    const updated = await getFileById(file.id);

    return Response.json(updated ? toFileItem(updated) : null, { status: 202 });
  } catch (error) {
    return arServerError(error, AR.fileRetryFailed);
  }
}
