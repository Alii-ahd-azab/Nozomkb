import { canDownloadFile } from "@/lib/authz";
import { getFileById } from "@/lib/files";
import { readStoredFile } from "@/lib/storage";
import { jsonError, parseId } from "@/lib/api";
import { AR } from "@/lib/messages";
import { getCurrentUser } from "@/lib/current-user";
import {
  arNotFound,
  arServerError,
  arUnauthorized,
  resolveReadableParent,
  type RouteContext,
} from "@/lib/handlers/parent";

// GET /api/files/[id]/download
// auth -> file metadata -> parent -> parent READ access -> private disk -> bytes
// Guessing an ID of a file on an unreadable parent gives 404.
export async function GET(_request: Request, context: RouteContext) {
  try {
    if (!(await getCurrentUser())) {
      return arUnauthorized();
    }

    const id = parseId((await context.params).id);
    const file = id === null ? null : await getFileById(id);

    if (!file) {
      return arNotFound();
    }

    const resolved = await resolveReadableParent(file.parentKind, file.parentId);

    if ("response" in resolved) {
      return resolved.response;
    }

    if (!canDownloadFile(resolved.user, resolved.parent)) {
      return arNotFound();
    }

    const bytes = await readStoredFile(file.storageKey);

    if (!bytes) {
      console.error("Stored file is missing on disk", file.id);
      return jsonError(AR.fileUnavailable, 404);
    }

    const asciiName = file.originalName.replace(/[^\x20-\x7e]|["\\]/g, "_");

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type":
          file.mimeType === "text/plain" ? "text/plain; charset=utf-8" : file.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return arServerError(error);
  }
}
