import { canEditComment, canDeleteComment } from "@/lib/authz";
import { deleteComment, getCommentById, updateComment } from "@/lib/comments";
import { jsonError, parseId, readJsonObject } from "@/lib/api";
import { AR } from "@/lib/messages";
import { toCommentItem, validateCommentContent } from "@/lib/handlers/comments";
import {
  arForbidden,
  arNotFound,
  arServerError,
  arUnauthorized,
  resolveReadableParent,
  type RouteContext,
} from "@/lib/handlers/parent";
import { getCurrentUser } from "@/lib/current-user";

// Comment -> parent -> parent access. A Comment on a parent the user cannot
// read is reported as 404, even if the ID was guessed correctly.
async function loadReadableComment(context: RouteContext) {
  if (!(await getCurrentUser())) {
    return { response: arUnauthorized() } as const;
  }

  const id = parseId((await context.params).id);
  const comment = id === null ? null : await getCommentById(id);

  if (!comment) {
    return { response: arNotFound() } as const;
  }

  const resolved = await resolveReadableParent(comment.parentKind, comment.parentId);

  if ("response" in resolved) {
    return { response: resolved.response } as const;
  }

  return { ...resolved, comment } as const;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const loaded = await loadReadableComment(context);

    if ("response" in loaded) {
      return loaded.response;
    }

    return Response.json(toCommentItem(loaded.user, loaded.parent, loaded.comment));
  } catch (error) {
    return arServerError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const loaded = await loadReadableComment(context);

    if ("response" in loaded) {
      return loaded.response;
    }

    const { user, parent, comment } = loaded;

    if (!canEditComment(user, comment, parent)) {
      return arForbidden();
    }

    const body = await readJsonObject(request);

    if (!body) {
      return jsonError(AR.invalidRequest, 400);
    }

    const content = validateCommentContent(body.content);

    if (!content.ok) {
      return jsonError(content.error, 400);
    }

    const updated = await updateComment(comment.id, content.value);

    if (!updated) {
      return arNotFound();
    }

    return Response.json(toCommentItem(user, parent, updated));
  } catch (error) {
    return arServerError(error, AR.commentFailed);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const loaded = await loadReadableComment(context);

    if ("response" in loaded) {
      return loaded.response;
    }

    if (!canDeleteComment(loaded.user, loaded.comment, loaded.parent)) {
      return arForbidden();
    }

    if (!(await deleteComment(loaded.comment.id))) {
      return arNotFound();
    }

    return Response.json({ message: "تم حذف التعليق." });
  } catch (error) {
    return arServerError(error, AR.commentDeleteFailed);
  }
}
