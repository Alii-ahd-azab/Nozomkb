// Route logic for /api/posts/[id]/files and /api/pages/[id]/files.
//
// Upload: auth -> parent readable -> may MANAGE parent -> validate
//         (extension, MIME, real size, signature) -> private disk -> metadata
import "server-only";

import { canManageFiles } from "@/lib/authz";
import { insertFileMetadata, listFiles, toFileItem, validateUpload } from "@/lib/files";
import { generateStorageKey, removeStoredFiles, saveFile } from "@/lib/storage";
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

export function fileRoutes(kind: ParentKind) {
  async function GET(_request: Request, context: RouteContext) {
    try {
      const resolved = await resolveReadableParent(kind, (await context.params).id);

      if ("response" in resolved) {
        return resolved.response;
      }

      const files = await listFiles(kind, resolved.parent.id);

      return Response.json(files.map(toFileItem));
    } catch (error) {
      return arServerError(error);
    }
  }

  async function POST(request: Request, context: RouteContext) {
    let storedKey: string | null = null;

    try {
      const resolved = await resolveReadableParent(kind, (await context.params).id);

      if ("response" in resolved) {
        return resolved.response;
      }

      const { user, parent } = resolved;

      if (!canManageFiles(user, parent)) {
        return arForbidden();
      }

      // Reject obviously oversized requests before reading the body.
      const declaredLength = Number(request.headers.get("content-length") ?? 0);

      if (declaredLength > MAX_REQUEST_BYTES) {
        return jsonError(AR.fileTooLarge, 413);
      }

      let formData: FormData;

      try {
        formData = await request.formData();
      } catch {
        return jsonError(AR.fileMissing, 400);
      }

      const file = formData.get("file");

      if (!(file instanceof File)) {
        return jsonError(AR.fileMissing, 400);
      }

      const upload = await validateUpload(file);

      if (!upload.ok) {
        return jsonError(upload.error, upload.status);
      }

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

      return Response.json(toFileItem(saved), { status: 201 });
    } catch (error) {
      // Never leave an orphaned file on disk if the database step failed.
      if (storedKey) {
        await removeStoredFiles([storedKey]);
      }

      return arServerError(error, AR.uploadFailed);
    }
  }

  return { GET, POST };
}
