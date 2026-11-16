import { readStoredFile } from "@/lib/storage";
import { jsonError } from "@/lib/api";
import { AR } from "@/lib/messages";
import { arServerError, type RouteContext } from "@/lib/handlers/parent";
import { resolveFile } from "@/lib/handlers/file-item";

// GET /api/files/[id]/download
// auth -> file metadata -> parent -> parent READ access -> private disk -> bytes
// Guessing an ID of a file on an unreadable parent gives 404.
// Week 7: a disabled (withdrawn) File is only downloadable by its managers.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const resolved = await resolveFile((await context.params).id, "see");

    if ("response" in resolved) {
      return resolved.response;
    }

    const { file } = resolved;
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
