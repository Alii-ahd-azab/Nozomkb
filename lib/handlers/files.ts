// Route logic for /api/posts/[id]/files and /api/pages/[id]/files.
//
// Upload: auth -> parent readable -> may MANAGE parent -> validate
//         (extension, MIME, real size, signature) -> private disk -> metadata
//         (status Pending) -> enqueue a Job -> respond.
// Week 7: the request NEVER extracts or chunks text; the Worker does that.
import "server-only";

import { canManageFiles, canSeeFile } from "@/lib/authz";
import {
  getFileById,
  insertFileMetadata,
  listFiles,
  markQueueUnavailable,
  toFileItem,
  validateUpload,
} from "@/lib/files";
import { generateStorageKey, removeStoredFiles, saveFile } from "@/lib/storage";
import { enqueueFileProcessing } from "@/lib/queue/file-processing-queue";
import { jsonError } from "@/lib/api";
import { MAX_FILE_SIZE_BYTES, type ParentKind } from "@/lib/definitions";
import { AR } from "@/lib/messages";
import {
  arForbidden,
  arServerError,
  resolveReadableParent,
  type RouteContext,
} from "@/lib/handlers/parent";

// Room for the multipart boundaries/headers around a 10 MB file.
const MAX_REQUEST_BYTES = MAX_FILE_SIZE_BYTES + 64 * 1024;

type ParsedUpload =
  | { response: Response }
  | {
      upload: Extract<Awaited<ReturnType<typeof validateUpload>>, { ok: true }>;
    };

// Shared by upload (POST .../files) and replace (POST /api/files/[id]/replace):
// exactly the same Week 6 validation rules.
export async function readValidatedUpload(request: Request): Promise<ParsedUpload> {
  // Reject obviously oversized requests before reading the body.
  const declaredLength = Number(request.headers.get("content-length") ?? 0);

  if (declaredLength > MAX_REQUEST_BYTES) {
    return { response: jsonError(AR.fileTooLarge, 413) };
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return { response: jsonError(AR.fileMissing, 400) };
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { response: jsonError(AR.fileMissing, 400) };
  }

  const upload = await validateUpload(file);

  if (!upload.ok) {
    return { response: jsonError(upload.error, upload.status) };
  }

  return { upload };
}

// Queue the Job; if Redis is unavailable keep the File and show a retryable
// Failed state instead of losing the upload.
export async function queueProcessingOrMark(fileId: number, version: number) {
  if (!(await enqueueFileProcessing(fileId, version))) {
    await markQueueUnavailable(fileId, version, AR.processingQueueUnavailable);
  }

  return getFileById(fileId);
}

export function fileRoutes(kind: ParentKind) {
  async function GET(_request: Request, context: RouteContext) {
    try {
      const resolved = await resolveReadableParent(kind, (await context.params).id);

      if ("response" in resolved) {
        return resolved.response;
      }

      const { user, parent } = resolved;
      const files = await listFiles(kind, parent.id);

      // Disabled Files are only listed for people who manage the parent.
      return Response.json(
        files.filter((file) => canSeeFile(user, parent, file)).map(toFileItem)
      );
    } catch (error) {
      return arServerError(error);
    }
  }

  async function POST(request: Request, context: RouteContext) {
    let storedKey: string | null = null;
    let savedId: number | null = null;

    try {
      const resolved = await resolveReadableParent(kind, (await context.params).id);

      if ("response" in resolved) {
        return resolved.response;
      }

      const { user, parent } = resolved;

      if (!canManageFiles(user, parent)) {
        return arForbidden();
      }

      const parsed = await readValidatedUpload(request);

      if ("response" in parsed) {
        return parsed.response;
      }

      const { upload } = parsed;

      // Disk name is generated; the uploaded name is only display metadata.
      storedKey = generateStorageKey(upload.extension);
      await saveFile(storedKey, upload.bytes);

      const saved = await insertFileMetadata({
        kind,
        parentId: parent.id,
        originalName: upload.originalName,
        storageKey: storedKey,
        mimeType: upload.mimeType,
        sizeBytes: upload.bytes.byteLength,
        uploadedBy: user.id,
      });

      if (!saved) {
        throw new Error("File metadata was not saved.");
      }

      savedId = saved.id;

      // status = pending (column default) -> hand over to the Worker.
      const queued = await queueProcessingOrMark(saved.id, saved.version);

      return Response.json(toFileItem(queued ?? saved), { status: 201 });
    } catch (error) {
      // Never leave an orphaned file on disk if the database step failed.
      // (Once metadata exists the File is kept; a queue problem is retryable.)
      if (storedKey && savedId === null) {
        await removeStoredFiles([storedKey]);
      }

      return arServerError(error, AR.uploadFailed);
    }
  }

  return { GET, POST };
}
