// Central authorization rules for NozomKB (Week 5).
//
// Every server entry point (Server Components and Route Handlers) asks THESE
// functions before reading or changing content. Hiding a button in the UI is
// only UX; these checks are the actual security.
//
// Rule order:  authenticated user -> role -> ownership -> department scope -> lifecycle
//
// Future Week 6 Comments/Files must NOT invent their own rules: they inherit
// access from their parent by calling canReadPost / canReadOfficialPage on the
// parent Post/Page (see canAccessChildOf below).

import type {
  ContentScope,
  ContentStatus,
  CurrentUser,
} from "@/lib/definitions";

export type ScopedContent = {
  scope: ContentScope;
  departmentId: number | null;
  status: ContentStatus;
};

export type OwnedContent = ScopedContent & {
  authorId: number | null;
};

// ---------------------------------------------------------------
// Roles
// ---------------------------------------------------------------

export function isAdmin(user: CurrentUser) {
  return user.role === "Admin";
}

export function isEditor(user: CurrentUser) {
  return user.role === "Editor";
}

// ---------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------

// Company content: every employee. Department content: same department only.
// Admin has cross-department access. Editors do NOT get other departments.
export function hasDepartmentAccess(
  user: CurrentUser,
  content: Pick<ScopedContent, "scope" | "departmentId">
) {
  if (content.scope === "company") {
    return true;
  }

  if (isAdmin(user)) {
    return true;
  }

  return (
    content.departmentId !== null &&
    content.departmentId === user.departmentId
  );
}

export function isOwner(user: CurrentUser, content: OwnedContent) {
  return content.authorId !== null && content.authorId === user.id;
}

// Can the user place content into this department?
export function canTargetDepartment(
  user: CurrentUser,
  departmentId: number
) {
  return isAdmin(user) || user.departmentId === departmentId;
}

// Shared read rule:
// - people who can manage an item can always read it (any status);
// - everyone else only reads PUBLISHED content inside their scope.
// Draft and Archived content is therefore never returned to normal readers.
export function canReadContent(
  user: CurrentUser,
  content: ScopedContent,
  canManage: boolean
) {
  if (canManage) {
    return true;
  }

  return (
    content.status === "published" &&
    hasDepartmentAccess(user, content)
  );
}

// ---------------------------------------------------------------
// Posts = Community content
// ---------------------------------------------------------------

// Owner manages their own Post; Admin manages any Post.
// Editors get no extra power over other people's Posts.
export function canManagePost(user: CurrentUser, post: OwnedContent) {
  return isAdmin(user) || isOwner(user, post);
}

export function canEditPost(user: CurrentUser, post: OwnedContent) {
  return canManagePost(user, post);
}

export function canDeletePost(user: CurrentUser, post: OwnedContent) {
  return canManagePost(user, post);
}

export function canReadPost(user: CurrentUser, post: OwnedContent) {
  return canReadContent(user, post, canManagePost(user, post));
}

// Any authenticated employee may contribute Community Posts.
export function canCreatePost(user: CurrentUser) {
  return Boolean(user);
}

// ---------------------------------------------------------------
// Pages = Official content
// ---------------------------------------------------------------

export function canCreateOfficialPage(user: CurrentUser) {
  return isAdmin(user) || isEditor(user);
}

// Admin: every Official Page.
// Editor: company-wide pages + pages of their OWN department.
// Member: never (cannot create, edit, publish or archive Official Pages).
export function canManageOfficialPage(
  user: CurrentUser,
  page: ScopedContent
) {
  if (isAdmin(user)) {
    return true;
  }

  if (!isEditor(user)) {
    return false;
  }

  return hasDepartmentAccess(user, page);
}

export function canReadOfficialPage(
  user: CurrentUser,
  page: ScopedContent
) {
  return canReadContent(user, page, canManageOfficialPage(user, page));
}

// ---------------------------------------------------------------
// Future child content (Week 6 Comments / Files)
// ---------------------------------------------------------------

// A child item is readable exactly when its parent is readable.
// Example (Week 6): canAccessChildOf(canReadPost(user, parentPost))
export function canAccessChildOf(parentIsReadable: boolean) {
  return parentIsReadable;
}

// ---------------------------------------------------------------
// SQL twins of the read rules (for list queries).
// They MUST stay equivalent to canReadPost / canReadOfficialPage above.
// ---------------------------------------------------------------

// $1 = user id, $2 = is admin, $3 = user department id
export function readablePostsFilter(user: CurrentUser) {
  return {
    sql: `(
      $2::boolean
      OR posts.user_id = $1
      OR (
        posts.status = 'published'
        AND (posts.scope = 'company' OR posts.department_id = $3)
      )
    )`,
    params: [user.id, isAdmin(user), user.departmentId] as const,
  };
}

// $1 = is admin, $2 = is editor, $3 = user department id
export function readablePagesFilter(user: CurrentUser) {
  return {
    sql: `(
      $1::boolean
      OR (
        $2::boolean
        AND (pages.scope = 'company' OR pages.department_id = $3)
      )
      OR (
        pages.status = 'published'
        AND (pages.scope = 'company' OR pages.department_id = $3)
      )
    )`,
    params: [isAdmin(user), isEditor(user), user.departmentId] as const,
  };
}
