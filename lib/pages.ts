// Official content (Pages) data access.
// Callers must authorize first using lib/authz.ts — except getReadablePages,
// which applies the read filter itself.
import "server-only";

import pool from "@/lib/db";
import { readablePagesFilter } from "@/lib/authz";
import type {
  ContentScope,
  ContentStatus,
  CurrentUser,
  OfficialPage,
} from "@/lib/definitions";

const PAGE_SELECT = `
  SELECT
    pages.id,
    pages.title,
    pages.content,
    pages.user_id,
    users.name AS author_name,
    pages.scope,
    pages.department_id,
    departments.name AS department_name,
    pages.status,
    pages.created_at,
    pages.updated_at
  FROM pages
  LEFT JOIN users
    ON users.id = pages.user_id
  LEFT JOIN departments
    ON departments.id = pages.department_id
`;

type PageRow = {
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
};

function toPage(row: PageRow): OfficialPage {
  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
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

export async function getReadablePages(user: CurrentUser) {
  const filter = readablePagesFilter(user);

  const result = await pool.query<PageRow>(
    `
      ${PAGE_SELECT}
      WHERE ${filter.sql}
      ORDER BY pages.updated_at DESC
    `,
    [...filter.params]
  );

  return result.rows.map(toPage);
}

// Raw lookup — the caller MUST check canReadOfficialPage afterwards.
export async function getPageById(id: number) {
  const result = await pool.query<PageRow>(
    `
      ${PAGE_SELECT}
      WHERE pages.id = $1
    `,
    [id]
  );

  return result.rows[0] ? toPage(result.rows[0]) : null;
}

type PageInput = {
  title: string;
  content: string;
  scope: ContentScope;
  departmentId: number | null;
  status: ContentStatus;
};

export async function createPage(input: PageInput & { authorId: number }) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO pages (
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

  return getPageById(Number(result.rows[0].id));
}

export async function updatePage(id: number, changes: PageInput) {
  const result = await pool.query(
    `
      UPDATE pages
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

  return result.rows[0] ? getPageById(id) : null;
}
