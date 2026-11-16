// Bookmarks are private per user. Every listing re-checks read access, so a
// bookmark never reveals content that later became draft/archived/restricted.
import "server-only";

import pool from "@/lib/db";
import { canReadParent } from "@/lib/authz";
import { parentColumn } from "@/lib/content-parent";
import type {
  BookmarkItem,
  ContentScope,
  ContentStatus,
  CurrentUser,
  ParentKind,
} from "@/lib/definitions";

// Returns false when the bookmark already exists (unique index).
export async function addBookmark(
  userId: number,
  kind: ParentKind,
  targetId: number
) {
  try {
    await pool.query(
      `INSERT INTO bookmarks (user_id, ${parentColumn(kind)}) VALUES ($1, $2)`,
      [userId, targetId]
    );
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return false;
    }
    throw error;
  }
}

export async function removeBookmark(
  userId: number,
  kind: ParentKind,
  targetId: number
) {
  const result = await pool.query(
    `
      DELETE FROM bookmarks
      WHERE user_id = $1 AND ${parentColumn(kind)} = $2
      RETURNING id
    `,
    [userId, targetId]
  );

  return result.rowCount !== null && result.rowCount > 0;
}

export async function isBookmarked(
  userId: number,
  kind: ParentKind,
  targetId: number
) {
  const result = await pool.query(
    `SELECT 1 FROM bookmarks WHERE user_id = $1 AND ${parentColumn(kind)} = $2`,
    [userId, targetId]
  );

  return result.rows.length > 0;
}

type BookmarkRow = {
  post_id: string | null;
  page_id: string | null;
  created_at: Date;
  title: string;
  author_id: string | null;
  scope: ContentScope;
  department_id: string | null;
  department_name: string | null;
  status: ContentStatus;
};

// Only the signed-in user's bookmarks, and only targets they can STILL read.
export async function listReadableBookmarks(
  user: CurrentUser
): Promise<BookmarkItem[]> {
  const result = await pool.query<BookmarkRow>(
    `
      SELECT
        b.post_id,
        b.page_id,
        b.created_at,
        COALESCE(p.title, pg.title) AS title,
        COALESCE(p.user_id, pg.user_id) AS author_id,
        COALESCE(p.scope, pg.scope) AS scope,
        COALESCE(p.department_id, pg.department_id) AS department_id,
        d.name AS department_name,
        COALESCE(p.status, pg.status) AS status
      FROM bookmarks b
      LEFT JOIN posts p ON p.id = b.post_id
      LEFT JOIN pages pg ON pg.id = b.page_id
      LEFT JOIN departments d
        ON d.id = COALESCE(p.department_id, pg.department_id)
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC, b.id DESC
    `,
    [user.id]
  );

  return result.rows
    .map((row) => ({
      row,
      parent: {
        kind: (row.post_id !== null ? "post" : "page") as ParentKind,
        authorId: row.author_id === null ? null : Number(row.author_id),
        scope: row.scope,
        departmentId:
          row.department_id === null ? null : Number(row.department_id),
        status: row.status,
      },
    }))
    .filter(({ parent }) => canReadParent(user, parent))
    .map(({ row, parent }) => ({
      kind: parent.kind,
      id: Number(row.post_id ?? row.page_id),
      title: row.title,
      scope: row.scope,
      departmentName: row.department_name,
      createdAt: row.created_at.toISOString(),
    }));
}
