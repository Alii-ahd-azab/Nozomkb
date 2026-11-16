import { getCurrentUser } from "@/lib/current-user";
import { canDeletePost, canEditPost, canReadPost } from "@/lib/authz";
import {
  deletePost,
  getPostById,
  getUserDepartmentId,
  updatePost,
} from "@/lib/posts";
import { getStorageKeysForParent } from "@/lib/files";
import { removeStoredFiles } from "@/lib/storage";
import { syncSemanticIndex } from "@/lib/queue/semantic-indexing-queue";
import {
  forbidden,
  isBadInputDatabaseError,
  jsonError,
  notFound,
  parseId,
  readJsonObject,
  serverError,
  unauthorized,
  validateScope,
  validateStatus,
  validateTitleAndContent,
} from "@/lib/api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// Shared first steps: who is asking, and may they even see this Post?
// A Post the user cannot read is reported as 404 so its existence is not revealed.
async function loadReadablePost(context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return { response: unauthorized() } as const;
  }

  const id = parseId((await context.params).id);
  const post = id === null ? null : await getPostById(id);

  if (!post || !canReadPost(user, post)) {
    return { response: notFound("Post") } as const;
  }

  return { user, post } as const;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const loaded = await loadReadablePost(context);

    if ("response" in loaded) {
      return loaded.response;
    }

    return Response.json(loaded.post);
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const loaded = await loadReadablePost(context);

    if ("response" in loaded) {
      return loaded.response;
    }

    const { user, post } = loaded;

    // Ownership (or Admin) is checked on the server, against the database.
    if (!canEditPost(user, post)) {
      return forbidden();
    }

    const body = await readJsonObject(request);

    if (!body) {
      return jsonError("Request body must be a JSON object.", 400);
    }

    const fields = validateTitleAndContent(body);
    if (!fields.ok) {
      return jsonError(fields.error, 400);
    }

    const scope = validateScope(body.scope, post.scope);
    if (!scope.ok) {
      return jsonError(scope.error, 400);
    }

    const status = validateStatus(body.status, post.status, [
      "draft",
      "published",
      "archived",
    ]);
    if (!status.ok) {
      return jsonError(status.error, 400);
    }

    let departmentId: number | null = null;

    if (scope.value === "department") {
      departmentId =
        post.authorId === null
          ? null
          : await getUserDepartmentId(post.authorId);

      if (departmentId === null) {
        return jsonError(
          "The author is not assigned to a department, so this post can only be company-wide.",
          400
        );
      }
    }

    const updatedPost = await updatePost(post.id, {
      title: fields.value.title,
      content: fields.value.content,
      scope: scope.value,
      departmentId,
      status: status.value,
    });

    if (!updatedPost) {
      return notFound("Post");
    }

    // Week 8: edit -> old embedding removed now, re-index queued;
    // archive/draft -> the Post, its Comments and Files leave the index;
    // publish -> they are queued for indexing. (Scope/department changes
    // need no re-index: permissions are checked at query time.)
    await syncSemanticIndex({ kind: "post", id: updatedPost.id });

    return Response.json(updatedPost);
  } catch (error) {
    if (isBadInputDatabaseError(error)) {
      return jsonError("Invalid post data.", 400);
    }

    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const loaded = await loadReadablePost(context);

    if ("response" in loaded) {
      return loaded.response;
    }

    if (!canDeletePost(loaded.user, loaded.post)) {
      return forbidden();
    }

    // Comments, bookmarks, tags, file rows and semantic index rows cascade
    // in PostgreSQL; the private files on disk are removed here.
    const storageKeys = await getStorageKeysForParent("post", loaded.post.id);
    const deleted = await deletePost(loaded.post.id);

    if (!deleted) {
      return notFound("Post");
    }

    await removeStoredFiles(storageKeys);

    return Response.json({
      message: "Post deleted successfully.",
    });
  } catch (error) {
    return serverError(error);
  }
}
