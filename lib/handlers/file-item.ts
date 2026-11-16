// Shared first step for routes acting on ONE File (/api/files/[id]/...):
// signed in -> File exists -> parent readable -> (optionally) may manage it.
// Unreadable parents and hidden (disabled) Files answer 404, like Week 6.
import "server-only";

import { canManageFiles, canSeeFile } from "@/lib/authz";
import { getFileById, type FileRecord } from "@/lib/files";
import type { LoadedParent } from "@/lib/content-parent";
import type { CurrentUser } from "@/lib/definitions";
import { getCurrentUser } from "@/lib/current-user";
import { parseId } from "@/lib/api";
import {
  arForbidden,
  arNotFound,
  arUnauthorized,
  resolveReadableParent,
} from "@/lib/handlers/parent";

type Resolved =
  | { response: Response }
  | { user: CurrentUser; parent: LoadedParent; file: FileRecord };

export async function resolveFile(
  rawId: string,
  need: "see" | "manage"
): Promise<Resolved> {
  if (!(await getCurrentUser())) {
    return { response: arUnauthorized() };
  }

  const id = parseId(rawId);
  const file = id === null ? null : await getFileById(id);

  if (!file) {
    return { response: arNotFound() };
  }

  const resolved = await resolveReadableParent(file.parentKind, file.parentId);

  if ("response" in resolved) {
    return resolved;
  }

  const { user, parent } = resolved;

  if (!canSeeFile(user, parent, file)) {
    return { response: arNotFound() };
  }

  if (need === "manage" && !canManageFiles(user, parent)) {
    return { response: arForbidden() };
  }

  return { user, parent, file };
}
