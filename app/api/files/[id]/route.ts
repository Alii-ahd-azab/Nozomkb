import { deleteFileMetadata, getFileById, setFileActive, toFileItem } from "@/lib/files";
import { removeStoredFiles } from "@/lib/storage";
import { jsonError } from "@/lib/api";
import { AR } from "@/lib/messages";
import { arServerError, type RouteContext } from "@/lib/handlers/parent";
import { resolveFile } from "@/lib/handlers/file-item";
import { queueProcessingOrMark } from "@/lib/handlers/files";
import { syncSemanticIndex } from "@/lib/queue/semantic-indexing-queue";

// DELETE /api/files/[id] -> same management permission as the parent.
// Chunks and semantic rows disappear with the row (ON DELETE CASCADE). A Job still waiting in
// the Queue later finds no File and exits without writing anything.
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const resolved = await resolveFile((await context.params).id, "manage");

    if ("response" in resolved) {
      return resolved.response;
    }

    const storageKey = await deleteFileMetadata(resolved.file.id);

    if (storageKey) {
      await removeStoredFiles([storageKey]);
    }

    return Response.json({ message: "تم حذف الملف." });
  } catch (error) {
    return arServerError(error, AR.fileDeleteFailed);
  }
}

// PATCH /api/files/[id]  body: { "isActive": true | false }
// Disable = withdraw: hidden from readers and from Search immediately
// (the File and its Chunks stay stored). Enable = visible again; a File that
// never finished processing is queued again.
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const resolved = await resolveFile((await context.params).id, "manage");

    if ("response" in resolved) {
      return resolved.response;
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError(AR.invalidRequest, 400);
    }

    const keys = body && typeof body === "object" ? Object.keys(body) : [];
    const isActive = (body as { isActive?: unknown } | null)?.isActive;

    if (keys.length !== 1 || keys[0] !== "isActive" || typeof isActive !== "boolean") {
      return jsonError(AR.invalidRequest, 400);
    }

    await setFileActive(resolved.file.id, isActive);

    // Week 8: disable -> its semantic rows are removed now;
    // enable (Ready) -> queued for semantic indexing again.
    await syncSemanticIndex({ kind: "file", id: resolved.file.id });

    let updated = await getFileById(resolved.file.id);

    if (
      updated &&
      isActive &&
      (updated.status === "pending" || updated.status === "processing")
    ) {
      updated = await queueProcessingOrMark(updated.id, updated.version);
    }

    if (!updated) {
      return jsonError(AR.notFound, 404);
    }

    return Response.json(toFileItem(updated));
  } catch (error) {
    return arServerError(error, AR.fileUpdateFailed);
  }
}
