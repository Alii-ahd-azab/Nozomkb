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

// Week 7: background processing of uploaded Files (BullMQ Worker).
export const FILE_PROCESSING_STATUSES = [
  "pending",
  "processing",
  "ready",
  "failed",
] as const;
export type FileProcessingStatus = (typeof FILE_PROCESSING_STATUSES)[number];

export const FILE_STATUS_LABELS: Record<FileProcessingStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export type FileItem = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploaderName: string | null;
  createdAt: string;
  // Week 7 (never includes the storage key)
  version: number;
  status: FileProcessingStatus;
  // short user-safe message for Failed / retrying Files
  error: string | null;
  isActive: boolean;
  processedAt: string | null;
  // Week 8: semantic indexing of the current version (null = not indexed /
  // not eligible). Separate from the processing status above.
  semanticStatus: SemanticIndexStatus | null;
  semanticError: string | null;
};

export const SEMANTIC_INDEX_STATUSES = ["pending", "indexing", "ready", "failed"] as const;
export type SemanticIndexStatus = (typeof SEMANTIC_INDEX_STATUSES)[number];

export const SEMANTIC_STATUS_LABELS: Record<SemanticIndexStatus, string> = {
  pending: "Semantic: queued",
  indexing: "Semantic: indexing",
  ready: "Semantic: indexed",
  failed: "Semantic: failed",
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

export const SEARCH_TYPES = ["all", "page", "post", "comment", "file"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

// Week 8: Keyword (ILIKE, Week 6/7) vs Semantic (embeddings + pgvector).
export const SEARCH_MODES = ["keyword", "semantic"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export type SearchResult = {
  type: "page" | "post" | "comment" | "file";
  id: number;
  title: string;
  snippet: string;
  parentKind: ParentKind;
  parentId: number;
  parentTitle: string;
  scope: ContentScope;
  departmentName: string | null;
  updatedAt: string;
  // Only for type "file": the source of a matching File Chunk.
  file: {
    id: number;
    name: string;
    // null for TXT (one logical page); 1-based for PDF
    pageNumber: number | null;
  } | null;
};

// Week 8: a Semantic Search hit. Same source information as a keyword hit,
// plus where to open it and how close it is (never the vector itself).
export type SemanticSearchResult = Omit<SearchResult, "file"> & {
  // cosine similarity (1 - cosine distance), for display / evaluation
  similarity: number;
  // page that shows the source (the Post / Official Page)
  url: string;
  // authorized download route, File results only
  downloadUrl: string | null;
  file: {
    id: number;
    name: string;
    version: number;
    pageNumber: number | null;
  } | null;
};

export type EmbeddingInfo = {
  provider: string;
  model: string;
  dimensions: number;
  // true = TEST ONLY deterministic vectors (not real semantic quality)
  testOnly: boolean;
};
