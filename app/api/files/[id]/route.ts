import { canManageFiles } from "@/lib/authz";
import { deleteFileMetadata, getFileById } from "@/lib/files";
import { removeStoredFiles } from "@/lib/storage";
import { parseId } from "@/lib/api";
import { AR } from "@/lib/messages";
import { getCurrentUser } from "@/lib/current-user";
import {
  arForbidden,
  arNotFound,
  arServerError,
  arUnauthorized,
  resolveReadableParent,
  type RouteContext,
} from "@/lib/handlers/parent";

// DELETE /api/files/[id] -> same management permission as the parent.
export async function DELETE(_request: Request, context: RouteContext) {
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

    if (!canManageFiles(resolved.user, resolved.parent)) {
      return arForbidden();
    }

    const storageKey = await deleteFileMetadata(file.id);

    if (storageKey) {
      await removeStoredFiles([storageKey]);
    }

    return Response.json({ message: "تم حذف الملف." });
  } catch (error) {
    return arServerError(error, AR.fileDeleteFailed);
  }
}
