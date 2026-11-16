import { getCurrentUser } from "@/lib/current-user";
import {
  canManageOfficialPage,
  canReadOfficialPage,
  canTargetDepartment,
} from "@/lib/authz";
import { getPageById, updatePage } from "@/lib/pages";
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
import { resolvePageDepartment } from "@/lib/page-department";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// Unreadable pages (wrong department, draft, archived) are reported as 404.
async function loadReadablePage(context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return { response: unauthorized() } as const;
  }

  const id = parseId((await context.params).id);
  const page = id === null ? null : await getPageById(id);

  if (!page || !canReadOfficialPage(user, page)) {
    return { response: notFound("Page") } as const;
  }

  return { user, page } as const;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const loaded = await loadReadablePage(context);

    if ("response" in loaded) {
      return loaded.response;
    }

    return Response.json(loaded.page);
  } catch (error) {
    return serverError(error);
  }
}

// PATCH /api/pages/[id] -> edit / publish / archive (Editor in scope, or Admin).
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const loaded = await loadReadablePage(context);

    if ("response" in loaded) {
      return loaded.response;
    }

    const { user, page } = loaded;

    // Members (and Editors outside their department) are rejected here,
    // whatever the request body says.
    if (!canManageOfficialPage(user, page)) {
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

    const scope = validateScope(body.scope, page.scope);
    if (!scope.ok) {
      return jsonError(scope.error, 400);
    }

    const status = validateStatus(body.status, page.status, [
      "draft",
      "published",
      "archived",
    ]);
    if (!status.ok) {
      return jsonError(status.error, 400);
    }

    const department = resolvePageDepartment(
      user,
      scope.value,
      body.departmentId,
      page.departmentId
    );
    if (!department.ok) {
      return jsonError(department.error, department.status);
    }

    const target = {
      scope: scope.value,
      departmentId: department.value,
      status: status.value,
    };

    // The NEW state must also be manageable (e.g. an Editor cannot move a
    // page into another department).
    if (
      (target.departmentId !== null &&
        !canTargetDepartment(user, target.departmentId)) ||
      !canManageOfficialPage(user, target)
    ) {
      return forbidden();
    }

    const updated = await updatePage(page.id, {
      ...fields.value,
      ...target,
    });

    if (!updated) {
      return notFound("Page");
    }

    // Week 8: same lifecycle rules as Posts (edit / publish / archive).
    await syncSemanticIndex({ kind: "page", id: updated.id });

    return Response.json(updated);
  } catch (error) {
    if (isBadInputDatabaseError(error)) {
      return jsonError("Invalid page data.", 400);
    }

    return serverError(error);
  }
}
