import { replaceFileContent, toFileItem } from "@/lib/files";
import { generateStorageKey, removeStoredFiles, saveFile } from "@/lib/storage";
import { AR } from "@/lib/messages";
import { arNotFound, arServerError, type RouteContext } from "@/lib/handlers/parent";
import { resolveFile } from "@/lib/handlers/file-item";
import { queueProcessingOrMark, readValidatedUpload } from "@/lib/handlers/files";
import { syncSemanticIndex } from "@/lib/queue/semantic-indexing-queue";

// POST /api/files/[id]/replace  (multipart, field "file")
// Same validation as a normal upload -> new private disk file
// -> version + 1, status Pending, old Chunks removed (one transaction)
// -> old disk file removed -> Job for the NEW version.
// Search only ever reads chunks of the current version, so the old text
// stops being searchable the moment the transaction commits.
export async function POST(request: Request, context: RouteContext) {
  let newKey: string | null = null;
  let committed = false;

  try {
    const resolved = await resolveFile((await context.params).id, "manage");

    if ("response" in resolved) {
      return resolved.response;
    }

    const { user, file } = resolved;
    const parsed = await readValidatedUpload(request);

    if ("response" in parsed) {
      return parsed.response;
    }

    const { upload } = parsed;

    newKey = generateStorageKey(upload.extension);
    await saveFile(newKey, upload.bytes);

    const replaced = await replaceFileContent({
      id: file.id,
      originalName: upload.originalName,
      storageKey: newKey,
      mimeType: upload.mimeType,
      sizeBytes: upload.bytes.byteLength,
      uploadedBy: user.id,
    });

    if (!replaced) {
      // deleted meanwhile
      await removeStoredFiles([newKey]);
      return arNotFound();
    }

    committed = true;
    await removeStoredFiles([replaced.oldStorageKey]);

    // Week 8: the old version's semantic rows went with its Chunks (cascade);
    // this clears its indexing status. The Worker indexes the new version
    // once its processing is Ready.
    await syncSemanticIndex({ kind: "file", id: file.id });

    const queued = await queueProcessingOrMark(file.id, replaced.newVersion);

    return Response.json(queued ? toFileItem(queued) : null);
  } catch (error) {
    if (newKey && !committed) {
      await removeStoredFiles([newKey]);
    }

    return arServerError(error, AR.fileUpdateFailed);
  }
}
