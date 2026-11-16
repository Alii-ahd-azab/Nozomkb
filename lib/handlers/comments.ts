// Route logic for /api/posts/[id]/comments and /api/pages/[id]/comments.
import "server-only";

import { canCreateComment, canEditComment } from "@/lib/authz";
import { createComment, listComments, type CommentRecord } from "@/lib/comments";
import { syncSemanticIndex } from "@/lib/queue/semantic-indexing-queue";
import { readJsonObject, readText, jsonError } from "@/lib/api";
import {
  COMMENT_MAX_LENGTH,
  type CommentItem,
  type CurrentUser,
  type ParentKind,
} from "@/lib/definitions";
import type { LoadedParent } from "@/lib/content-parent";
import { AR } from "@/lib/messages";
import {
  arForbidden,
  arServerError,
  resolveReadableParent,
  type RouteContext,
} from "@/lib/handlers/parent";

export function toCommentItem(
  user: CurrentUser,
  parent: LoadedParent,
  comment: CommentRecord
): CommentItem {
  return {
    id: comment.id,
    content: comment.content,
    authorId: comment.authorId,
    authorName: comment.authorName,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    canEdit: canEditComment(user, comment, parent),
  };
}

export function validateCommentContent(
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  const content = readText(value);

  if (!content) {
    return { ok: false, error: AR.commentRequired };
  }

  if (content.length > COMMENT_MAX_LENGTH) {
    return { ok: false, error: AR.commentTooLong };
  }

  return { ok: true, value: content };
}

export function commentRoutes(kind: ParentKind) {
  async function GET(_request: Request, context: RouteContext) {
    try {
      const resolved = await resolveReadableParent(kind, (await context.params).id);

      if ("response" in resolved) {
        return resolved.response;
      }

      const { user, parent } = resolved;
      const comments = await listComments(kind, parent.id);

      return Response.json(
        comments.map((comment) => toCommentItem(user, parent, comment))
      );
    } catch (error) {
      return arServerError(error);
    }
  }

  async function POST(request: Request, context: RouteContext) {
    try {
      const resolved = await resolveReadableParent(kind, (await context.params).id);

      if ("response" in resolved) {
        return resolved.response;
      }

      const { user, parent } = resolved;

      if (!canCreateComment(user, parent)) {
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

      // Author = signed-in user. Any userId in the body is ignored.
      const comment = await createComment(kind, parent.id, user.id, content.value);

      if (!comment) {
        return jsonError(AR.commentFailed, 500);
      }

      // Week 8: a Comment on a published parent is queued for Semantic Search.
      await syncSemanticIndex({ kind: "comment", id: comment.id });

      return Response.json(toCommentItem(user, parent, comment), { status: 201 });
    } catch (error) {
      return arServerError(error, AR.commentFailed);
    }
  }

  return { GET, POST };
}
