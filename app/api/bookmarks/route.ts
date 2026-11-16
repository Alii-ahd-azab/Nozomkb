import { canBookmark } from "@/lib/authz";
import { addBookmark, listReadableBookmarks, removeBookmark } from "@/lib/bookmarks";
import { getCurrentUser } from "@/lib/current-user";
import { jsonError, parseId, readJsonObject } from "@/lib/api";
import { isParentKind, type ParentKind } from "@/lib/definitions";
import { AR } from "@/lib/messages";
import {
  arForbidden,
  arServerError,
  arUnauthorized,
  resolveReadableParent,
} from "@/lib/handlers/parent";

// Body: { "kind": "post" | "page", "id": 123 }
async function readTarget(request: Request) {
  const body = await readJsonObject(request);
  const id = parseId(String(body?.id ?? ""));

  if (!body || !isParentKind(body.kind) || id === null) {
    return null;
  }

  return { kind: body.kind as ParentKind, id };
}

// GET /api/bookmarks -> only MY bookmarks, re-checked against current access.
export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return arUnauthorized();
    }

    return Response.json(await listReadableBookmarks(user));
  } catch (error) {
    return arServerError(error);
  }
}

// POST /api/bookmarks -> bookmark content the user can READ.
export async function POST(request: Request) {
  try {
    const target = await readTarget(request);

    if (!target) {
      return (await getCurrentUser())
        ? jsonError(AR.invalidRequest, 400)
        : arUnauthorized();
    }

    // Inaccessible / missing content -> 404 (nothing is revealed).
    const resolved = await resolveReadableParent(target.kind, target.id);

    if ("response" in resolved) {
      return resolved.response;
    }

    if (!canBookmark(resolved.user, resolved.parent)) {
      return arForbidden();
    }

    const created = await addBookmark(resolved.user.id, target.kind, target.id);

    if (!created) {
      return jsonError(AR.bookmarkDuplicate, 409);
    }

    return Response.json({ bookmarked: true }, { status: 201 });
  } catch (error) {
    return arServerError(error, AR.bookmarkFailed);
  }
}

// DELETE /api/bookmarks -> remove one of MY bookmarks.
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return arUnauthorized();
    }

    const target = await readTarget(request);

    if (!target) {
      return jsonError(AR.invalidRequest, 400);
    }

    const removed = await removeBookmark(user.id, target.kind, target.id);

    if (!removed) {
      return jsonError(AR.bookmarkMissing, 404);
    }

    return Response.json({ bookmarked: false });
  } catch (error) {
    return arServerError(error, AR.bookmarkFailed);
  }
}
