// Keyword Search (Week 6) — plain PostgreSQL ILIKE, NOT semantic/AI search.
//
// Query -> authentication -> permission + lifecycle filter -> keyword match
//       -> filters (type / department / tag) -> pagination (LIMIT/OFFSET)
//
// Every user value is a bind parameter ($1, $2, ...), so text such as
// "'; DROP TABLE posts; --" is only ever searched for, never executed.
import "server-only";

import pool from "@/lib/db";
import { isAdmin, searchableContentSql } from "@/lib/authz";
import {
  SEARCH_TYPES,
  type ContentScope,
  type CurrentUser,
  type ParentKind,
  type SearchResult,
  type SearchType,
} from "@/lib/definitions";
import { AR } from "@/lib/messages";

export const SEARCH_PAGE_SIZE = 20;
const MAX_QUERY_LENGTH = 100;
const MAX_PAGE = 1000;

export type SearchParams = {
  q: string;
  type: SearchType;
  // "all" | "company" | "<department id>"
  department: string;
  // tag name, or null for all tags
  tag: string | null;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseSearchParams(
  raw: RawParams
): { ok: true; value: SearchParams } | { ok: false; error: string } {
  const q = (first(raw.q) ?? "").trim();
  const type = first(raw.type) ?? "all";
  const department = first(raw.department) ?? "all";
  const tag = (first(raw.tag) ?? "all").trim();
  const pageText = first(raw.page) ?? "1";

  if (!q) {
    return { ok: false, error: AR.searchQueryRequired };
  }

  if (q.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: AR.searchQueryTooLong };
  }

  const page = Number(pageText);

  if (
    !SEARCH_TYPES.includes(type as SearchType) ||
    !(department === "all" || department === "company" || /^\d{1,18}$/.test(department)) ||
    tag.length > 50 ||
    !/^\d+$/.test(pageText) ||
    page < 1 ||
    page > MAX_PAGE
  ) {
    return { ok: false, error: AR.searchInvalidFilter };
  }

  return {
    ok: true,
    value: {
      q,
      type: type as SearchType,
      department,
      tag: tag === "all" || tag === "" ? null : tag,
      page,
    },
  };
}

// Escape LIKE wildcards so "%" or "_" typed by the user are literal.
function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

// Parameters used below:
// $1 pattern, $2 is admin, $3 user department, $4 type,
// $5 department filter, $6 tag filter
const PAGE_ACCESS = searchableContentSql("pg", "$2", "$3");
const POST_ACCESS = searchableContentSql("p", "$2", "$3");

// Department filter only NARROWS already-authorized rows.
function departmentFilter(alias: string) {
  return `(
    $5::text = 'all'
    OR ($5::text = 'company' AND ${alias}.scope = 'company')
    OR ${alias}.department_id::text = $5::text
  )`;
}

const POST_HAS_TAG = `EXISTS (
  SELECT 1
  FROM post_tags pt
  JOIN tags t ON t.id = pt.tag_id
  WHERE pt.post_id = p.id AND t.name = $6::text
)`;

const RESULTS_CTE = `
  WITH results AS (
    SELECT
      'page'::text AS type, pg.id, pg.title, pg.content AS body,
      'page'::text AS parent_kind, pg.id AS parent_id, pg.title AS parent_title,
      pg.scope, d.name AS department_name, pg.updated_at
    FROM pages pg
    LEFT JOIN departments d ON d.id = pg.department_id
    WHERE $4::text IN ('all', 'page')
      AND $6::text IS NULL            -- Official Pages have no tags
      AND ${PAGE_ACCESS}
      AND ${departmentFilter("pg")}
      AND (pg.title ILIKE $1 ESCAPE '\\' OR pg.content ILIKE $1 ESCAPE '\\')

    UNION ALL

    SELECT
      'post', p.id, p.title, p.content,
      'post', p.id, p.title,
      p.scope, d.name, p.updated_at
    FROM posts p
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE $4::text IN ('all', 'post')
      AND ${POST_ACCESS}
      AND ${departmentFilter("p")}
      AND ($6::text IS NULL OR ${POST_HAS_TAG})
      AND (p.title ILIKE $1 ESCAPE '\\' OR p.content ILIKE $1 ESCAPE '\\')

    UNION ALL

    -- A Comment is searchable only if its PARENT is published + readable.
    SELECT
      'comment', c.id, NULL, c.content,
      CASE WHEN c.post_id IS NOT NULL THEN 'post' ELSE 'page' END,
      COALESCE(c.post_id, c.page_id),
      COALESCE(p.title, pg.title),
      COALESCE(p.scope, pg.scope),
      d.name,
      c.updated_at
    FROM comments c
    LEFT JOIN posts p ON p.id = c.post_id
    LEFT JOIN pages pg ON pg.id = c.page_id
    LEFT JOIN departments d ON d.id = COALESCE(p.department_id, pg.department_id)
    WHERE $4::text IN ('all', 'comment')
      AND (
        (p.id IS NOT NULL AND ${POST_ACCESS} AND ${departmentFilter("p")})
        OR (pg.id IS NOT NULL AND ${PAGE_ACCESS} AND ${departmentFilter("pg")})
      )
      AND ($6::text IS NULL OR (p.id IS NOT NULL AND ${POST_HAS_TAG}))
      AND c.content ILIKE $1 ESCAPE '\\'
  )
`;

type ResultRow = {
  type: SearchResult["type"];
  id: string;
  title: string | null;
  body: string;
  parent_kind: ParentKind;
  parent_id: string;
  parent_title: string;
  scope: ContentScope;
  department_name: string | null;
  updated_at: Date;
};

// Short excerpt around the first match.
function makeSnippet(body: string, q: string) {
  const index = body.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, index - 60);
  const text = body.slice(start, start + 200).replace(/\s+/g, " ").trim();

  return `${start > 0 ? "…" : ""}${text}${start + 200 < body.length ? "…" : ""}`;
}

export async function searchContent(user: CurrentUser, params: SearchParams) {
  const bind = [
    likePattern(params.q),
    isAdmin(user),
    user.departmentId,
    params.type,
    params.department,
    params.tag,
  ];

  const offset = (params.page - 1) * SEARCH_PAGE_SIZE;

  const [countResult, pageResult] = await Promise.all([
    pool.query<{ total: string }>(
      `${RESULTS_CTE} SELECT COUNT(*) AS total FROM results`,
      bind
    ),
    pool.query<ResultRow>(
      `
        ${RESULTS_CTE}
        SELECT * FROM results
        ORDER BY updated_at DESC, type, id DESC
        LIMIT $7 OFFSET $8
      `,
      [...bind, SEARCH_PAGE_SIZE, offset]
    ),
  ]);

  const total = Number(countResult.rows[0]?.total ?? 0);

  const results: SearchResult[] = pageResult.rows.map((row) => ({
    type: row.type,
    id: Number(row.id),
    title: row.title ?? row.parent_title,
    snippet: makeSnippet(row.body, params.q),
    parentKind: row.parent_kind,
    parentId: Number(row.parent_id),
    parentTitle: row.parent_title,
    scope: row.scope,
    departmentName: row.department_name,
    updatedAt: row.updated_at.toISOString(),
  }));

  return {
    results,
    total,
    page: params.page,
    pageSize: SEARCH_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)),
  };
}
