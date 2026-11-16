// Community content (Posts) data access.
// Functions here only talk to PostgreSQL. Callers must authorize first using
// lib/authz.ts — except getReadablePosts, which applies the read filter itself.
import "server-only";

import pool from "@/lib/db";
import { readablePostsFilter } from "@/lib/authz";
import type {
  ContentScope,
  ContentStatus,
  CurrentUser,
  Post,
} from "@/lib/definitions";

const POST_SELECT = `
  SELECT
    posts.id,
    posts.title,
    posts.content,
    posts.user_id,
    users.name AS author_name,
    posts.scope,
    posts.department_id,
    departments.name AS department_name,
    posts.status,
    posts.created_at,
    posts.updated_at,
    COALESCE(MIN(tags.name), '') AS tag
  FROM posts
  LEFT JOIN users
    ON users.id = posts.user_id
  LEFT JOIN departments
    ON departments.id = posts.department_id
  LEFT JOIN post_tags
    ON posts.id = post_tags.post_id
  LEFT JOIN tags
    ON post_tags.tag_id = tags.id
`;

const POST_GROUP_BY = `
  GROUP BY posts.id, users.name, departments.name
`;

type PostRow = {
  id: string;
  title: string;
  content: string;
  user_id: string | null;
  author_name: string | null;
  scope: ContentScope;
  department_id: string | null;
  department_name: string | null;
  status: ContentStatus;
  created_at: Date | null;
  updated_at: Date;
  tag: string;
};

function toPost(row: PostRow): Post {
  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
    tag: row.tag,
    authorId: row.user_id === null ? null : Number(row.user_id),
    authorName: row.author_name,
    scope: row.scope,
    departmentId:
      row.department_id === null ? null : Number(row.department_id),
    departmentName: row.department_name,
    status: row.status,
    createdAt: (row.created_at ?? row.updated_at).toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// Only the Posts this user may read (scope + lifecycle + ownership).
export async function getReadablePosts(user: CurrentUser) {
  const filter = readablePostsFilter(user);

  const result = await pool.query<PostRow>(
    `
      ${POST_SELECT}
      WHERE ${filter.sql}
      ${POST_GROUP_BY}
      ORDER BY posts.created_at DESC
    `,
    [...filter.params]
  );

  return result.rows.map(toPost);
}

// Raw lookup — the caller MUST check canReadPost / canEditPost afterwards.
export async function getPostById(id: number) {
  const result = await pool.query<PostRow>(
    `
      ${POST_SELECT}
      WHERE posts.id = $1
      ${POST_GROUP_BY}
    `,
    [id]
  );

  return result.rows[0] ? toPost(result.rows[0]) : null;
}

// A department-scoped Post belongs to its author's department.
export async function getUserDepartmentId(userId: number) {
  const result = await pool.query<{ department_id: string | null }>(
    `SELECT department_id FROM users WHERE id = $1`,
    [userId]
  );

  const departmentId = result.rows[0]?.department_id ?? null;

  return departmentId === null ? null : Number(departmentId);
}

type NewPost = {
  title: string;
  content: string;
  tag: string;
  authorId: number;
  scope: ContentScope;
  departmentId: number | null;
  status: ContentStatus;
};

export async function createPost(input: NewPost) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<{ id: string }>(
      `
        INSERT INTO posts (
          title,
          content,
          user_id,
          scope,
          department_id,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [
        input.title,
        input.content,
        input.authorId,
        input.scope,
        input.departmentId,
        input.status,
      ]
    );

    const postId = result.rows[0].id;

    if (input.tag) {
      await client.query(
        `
          INSERT INTO post_tags (post_id, tag_id)
          SELECT $1, tags.id
          FROM tags
          WHERE tags.name = $2
        `,
        [postId, input.tag]
      );
    }

    await client.query("COMMIT");

    return getPostById(Number(postId));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type PostChanges = {
  title: string;
  content: string;
  scope: ContentScope;
  departmentId: number | null;
  status: ContentStatus;
};

export async function updatePost(id: number, changes: PostChanges) {
  const result = await pool.query(
    `
      UPDATE posts
      SET
        title = $1,
        content = $2,
        scope = $3,
        department_id = $4,
        status = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING id
    `,
    [
      changes.title,
      changes.content,
      changes.scope,
      changes.departmentId,
      changes.status,
      id,
    ]
  );

  return result.rows[0] ? getPostById(id) : null;
}

// post_tags rows are removed automatically (ON DELETE CASCADE).
export async function deletePost(id: number) {
  const result = await pool.query(
    `
      DELETE FROM posts
      WHERE id = $1
      RETURNING id
    `,
    [id]
  );

  return result.rows[0] ?? null;
}
