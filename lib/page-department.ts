import "server-only";

import { isAdmin } from "@/lib/authz";
import type { ContentScope, CurrentUser } from "@/lib/definitions";

type DepartmentResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string; status: 400 | 403 };

// Decide which department an Official Page belongs to.
// - company scope: no department.
// - Editor: always their own department (cannot pick another one).
// - Admin: may choose any department (cross-department access).
export function resolvePageDepartment(
  user: CurrentUser,
  scope: ContentScope,
  requestedDepartmentId: unknown,
  currentDepartmentId: number | null
): DepartmentResult {
  if (scope === "company") {
    return { ok: true, value: null };
  }

  if (requestedDepartmentId !== undefined && requestedDepartmentId !== null) {
    const requested = Number(requestedDepartmentId);

    if (!Number.isSafeInteger(requested) || requested <= 0) {
      return { ok: false, error: "Invalid department.", status: 400 };
    }

    if (!isAdmin(user) && requested !== user.departmentId) {
      return {
        ok: false,
        error: "You can only manage pages for your own department.",
        status: 403,
      };
    }

    return { ok: true, value: requested };
  }

  const fallback = currentDepartmentId ?? user.departmentId;

  if (fallback === null) {
    return {
      ok: false,
      error: "A department is required for department-scoped pages.",
      status: 400,
    };
  }

  return { ok: true, value: fallback };
}
