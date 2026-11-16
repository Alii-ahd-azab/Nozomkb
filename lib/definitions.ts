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
