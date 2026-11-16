// Shared, client-safe definitions (no database or secret access here).
// Internal values are stored exactly like this in PostgreSQL.

export const ROLES = ["Admin", "Editor", "Member"] as const;
export type Role = (typeof ROLES)[number];

export const CONTENT_STATUSES = ["draft", "published", "archived"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_SCOPES = ["company", "department"] as const;
export type ContentScope = (typeof CONTENT_SCOPES)[number];

export const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}

export function isContentStatus(value: unknown): value is ContentStatus {
  return CONTENT_STATUSES.includes(value as ContentStatus);
}

export function isContentScope(value: unknown): value is ContentScope {
  return CONTENT_SCOPES.includes(value as ContentScope);
}

// The authenticated user as loaded from PostgreSQL on the server.
export type CurrentUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  departmentId: number | null;
  departmentName: string | null;
};

// Safe subset passed to Client Components for display only.
export type DisplayUser = Pick<CurrentUser, "name" | "role" | "departmentName">;

export type Department = {
  id: number;
  name: string;
};

// Community content (employee contribution).
export type Post = {
  id: number;
  title: string;
  content: string;
  tag: string;
  authorId: number | null;
  authorName: string | null;
  scope: ContentScope;
  departmentId: number | null;
  departmentName: string | null;
  status: ContentStatus;
  createdAt: string;
  updatedAt: string;
};

// Official content (approved company knowledge).
export type OfficialPage = {
  id: number;
  title: string;
  content: string;
  authorId: number | null;
  authorName: string | null;
  scope: ContentScope;
  departmentId: number | null;
  departmentName: string | null;
  status: ContentStatus;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------
// Week 6
// ---------------------------------------------------------------

// Parent content that Comments, Files and Bookmarks attach to.
export const PARENT_KINDS = ["post", "page"] as const;
export type ParentKind = (typeof PARENT_KINDS)[number];

export function isParentKind(value: unknown): value is ParentKind {
  return PARENT_KINDS.includes(value as ParentKind);
}

export function parentHref(kind: ParentKind, id: number) {
  return kind === "post" ? `/posts/${id}` : `/official/${id}`;
}

export const COMMENT_MAX_LENGTH = 2000;
export const SPECIALTY_MAX_LENGTH = 100;

// 10 MB = 10 * 1024 * 1024 bytes (enforced again on the server).
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_FILE_EXTENSIONS = [".pdf", ".txt"] as const;

export type CommentItem = {
  id: number;
  content: string;
  authorId: number;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  // computed on the server for this viewer (UX only; the API re-checks)
  canEdit: boolean;
};

export type FileItem = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploaderName: string | null;
  createdAt: string;
};

export type BookmarkItem = {
  kind: ParentKind;
  id: number;
  title: string;
  scope: ContentScope;
  departmentName: string | null;
  createdAt: string;
};

export type Profile = {
  name: string;
  email: string;
  role: Role;
  departmentName: string | null;
  specialty: string | null;
};

export const SEARCH_TYPES = ["all", "page", "post", "comment"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export type SearchResult = {
  type: "page" | "post" | "comment";
  id: number;
  title: string;
  snippet: string;
  parentKind: ParentKind;
  parentId: number;
  parentTitle: string;
  scope: ContentScope;
  departmentName: string | null;
  updatedAt: string;
};
