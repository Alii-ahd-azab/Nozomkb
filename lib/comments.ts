// Comments data access. Callers authorize via lib/authz.ts (parent access).
import "server-only";

import pool from "@/lib/db";
import { parentColumn } from "@/lib/content-parent";
import type { ParentKind } from "@/lib/definitions";

export type CommentRecord = {
  id: number;
  content: string;
  authorId: number;
  authorName: string;
  parentKind: ParentKind;
  parentId: number;
  createdAt: string;
  updatedAt: string;
};

type CommentRow = {
  id: string;
  content: string;
  user_id: string;
  author_name: string;
  post_id: string | null;
  page_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const COMMENT_SELECT = `
  SELECT
    comments.id,
    comments.content,
    comments.user_id,
    users.name AS author_name,
    comments.post_id,
    comments.page_id,
    comments.created_at,
    comments.updated_at
  FROM comments
  JOIN users ON users.id = comments.user_id
`;

function toComment(row: CommentRow): CommentRecord {
  return {
    id: Number(row.id),
    content: row.content,
    authorId: Number(row.user_id),
    authorName: row.author_name,
    parentKind: row.post_id !== null ? "post" : "page",
    parentId: Number(row.post_id ?? row.page_id),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listComments(kind: ParentKind, parentId: number) {
  const result = await pool.query<CommentRow>(
    `
      ${COMMENT_SELECT}
      WHERE comments.${parentColumn(kind)} = $1
      ORDER BY comments.created_at ASC, comments.id ASC
    `,
    [parentId]
  );

  return result.rows.map(toComment);
}

// Raw lookup — the caller MUST check the parent's access afterwards.
export async function getCommentById(id: number) {
  const result = await pool.query<CommentRow>(
    `${COMMENT_SELECT} WHERE comments.id = $1`,
    [id]
  );

  return result.rows[0] ? toComment(result.rows[0]) : null;
}

export async function createComment(
  kind: ParentKind,
  parentId: number,
  authorId: number,
  content: string
) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO comments (content, user_id, ${parentColumn(kind)})
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [content, authorId, parentId]
  );

  return getCommentById(Number(result.rows[0].id));
}

export async function updateComment(id: number, content: string) {
  const result = await pool.query(
    `
      UPDATE comments
      SET
        -- Week 8: a text change makes the old embedding stale at once
        content_version = CASE
          WHEN content IS DISTINCT FROM $1 THEN content_version + 1
          ELSE content_version
        END,
        content = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id
    `,
    [content, id]
  );

  return result.rows[0] ? getCommentById(id) : null;
}

export async function deleteComment(id: number) {
  const result = await pool.query(
    `DELETE FROM comments WHERE id = $1 RETURNING id`,
    [id]
  );

  return result.rows[0] ?? null;
}
