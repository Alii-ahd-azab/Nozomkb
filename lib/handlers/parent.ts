// Shared first step for every Week 6 child-content route:
// who is asking, and may they READ the parent Post / Official Page?
// Unreadable parents are reported as 404 (existence is not revealed).
import "server-only";

import { canReadParent } from "@/lib/authz";
import { loadParent, type LoadedParent } from "@/lib/content-parent";
import { getCurrentUser } from "@/lib/current-user";
import type { CurrentUser, ParentKind } from "@/lib/definitions";
import { jsonError, parseId } from "@/lib/api";
import { AR } from "@/lib/messages";

export type RouteContext = {
  params: Promise<{ id: string }>;
};

export const arUnauthorized = () => jsonError(AR.notSignedIn, 401);
export const arForbidden = () => jsonError(AR.forbidden, 403);
export const arNotFound = () => jsonError(AR.notFound, 404);

export function arServerError(error: unknown, message: string = AR.serverError) {
  console.error(error);
  return jsonError(message, 500);
}

type Resolved =
  | { response: Response }
  | { user: CurrentUser; parent: LoadedParent };

export async function resolveReadableParent(
  kind: ParentKind,
  rawId: string | number
): Promise<Resolved> {
  const user = await getCurrentUser();

  if (!user) {
    return { response: arUnauthorized() };
  }

  const id = typeof rawId === "number" ? rawId : parseId(rawId);
  const parent = id === null ? null : await loadParent(kind, id);

  if (!parent || !canReadParent(user, parent)) {
    return { response: arNotFound() };
  }

  return { user, parent };
}
