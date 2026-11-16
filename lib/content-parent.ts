// Loads the parent Post / Official Page that Comments, Files and Bookmarks
// belong to, in the shape lib/authz.ts expects (ContentParent).
import "server-only";

import type { ContentParent } from "@/lib/authz";
import type { ParentKind } from "@/lib/definitions";
import { getPostById } from "@/lib/posts";
import { getPageById } from "@/lib/pages";

export type LoadedParent = ContentParent & {
  id: number;
  title: string;
};

export async function loadParent(
  kind: ParentKind,
  id: number
): Promise<LoadedParent | null> {
  const record = kind === "post" ? await getPostById(id) : await getPageById(id);

  if (!record) {
    return null;
  }

  return {
    kind,
    id: record.id,
    title: record.title,
    authorId: record.authorId,
    scope: record.scope,
    departmentId: record.departmentId,
    status: record.status,
  };
}

// SQL column for a parent kind (fixed strings, never user input).
export function parentColumn(kind: ParentKind) {
  return kind === "post" ? "post_id" : "page_id";
}
