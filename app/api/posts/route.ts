import { getCurrentUser } from "@/lib/current-user";
import { canCreatePost } from "@/lib/authz";
import { createPost, getReadablePosts } from "@/lib/posts";
import {
  forbidden,
  isBadInputDatabaseError,
  jsonError,
  readJsonObject,
  readText,
  serverError,
  unauthorized,
  validateScope,
  validateStatus,
  validateTitleAndContent,
} from "@/lib/api";

// GET /api/posts -> only Posts this user is allowed to read.
export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return unauthorized();
    }

    return Response.json(await getReadablePosts(user));
  } catch (error) {
    return serverError(error);
  }
}

// POST /api/posts -> create a Community Post.
// The author is ALWAYS the signed-in user. Any userId in the body is ignored.
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return unauthorized();
    }

    if (!canCreatePost(user)) {
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

    const scope = validateScope(body.scope, "company");
    if (!scope.ok) {
      return jsonError(scope.error, 400);
    }

    // New Posts can start as a draft or be published directly.
    const status = validateStatus(body.status, "published", [
      "draft",
      "published",
    ]);
    if (!status.ok) {
      return jsonError(status.error, 400);
    }

    // Department Posts belong to the author's department (from the database,
    // never from the browser).
    const departmentId =
      scope.value === "department" ? user.departmentId : null;

    if (scope.value === "department" && departmentId === null) {
      return jsonError(
        "You are not assigned to a department, so you can only post company-wide.",
        400
      );
    }

    const newPost = await createPost({
      title: fields.value.title,
      content: fields.value.content,
      tag: readText(body.tag),
      authorId: user.id,
      scope: scope.value,
      departmentId,
      status: status.value,
    });

    return Response.json(newPost, { status: 201 });
  } catch (error) {
    if (isBadInputDatabaseError(error)) {
      return jsonError("Invalid post data.", 400);
    }

    return serverError(error);
  }
}
