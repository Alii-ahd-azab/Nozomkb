import { getCurrentUser } from "@/lib/current-user";
import {
  canCreateOfficialPage,
  canManageOfficialPage,
  canTargetDepartment,
} from "@/lib/authz";
import { createPage, getReadablePages } from "@/lib/pages";
import { syncSemanticIndex } from "@/lib/queue/semantic-indexing-queue";
import {
  forbidden,
  isBadInputDatabaseError,
  jsonError,
  readJsonObject,
  serverError,
  unauthorized,
  validateScope,
  validateStatus,
  validateTitleAndContent,
} from "@/lib/api";
import { resolvePageDepartment } from "@/lib/page-department";

// GET /api/pages -> Official Pages this user may read.
export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return unauthorized();
    }

    return Response.json(await getReadablePages(user));
  } catch (error) {
    return serverError(error);
  }
}

// POST /api/pages -> create an Official Page (Editor/Admin only).
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return unauthorized();
    }

    // Role check happens before anything else: Members are rejected here.
    if (!canCreateOfficialPage(user)) {
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

    const status = validateStatus(body.status, "draft", [
      "draft",
      "published",
    ]);
    if (!status.ok) {
      return jsonError(status.error, 400);
    }

    const department = resolvePageDepartment(
      user,
      scope.value,
      body.departmentId,
      null
    );
    if (!department.ok) {
      return jsonError(department.error, department.status);
    }

    const target = {
      scope: scope.value,
      departmentId: department.value,
      status: status.value,
    };

    if (
      (target.departmentId !== null &&
        !canTargetDepartment(user, target.departmentId)) ||
      !canManageOfficialPage(user, target)
    ) {
      return forbidden();
    }

    const page = await createPage({
      ...fields.value,
      ...target,
      authorId: user.id,
    });

    // Week 8: a published Official Page becomes eligible for Semantic Search.
    if (page) {
      await syncSemanticIndex({ kind: "page", id: page.id });
    }

    return Response.json(page, { status: 201 });
  } catch (error) {
    if (isBadInputDatabaseError(error)) {
      return jsonError("Invalid page data.", 400);
    }

    return serverError(error);
  }
}
