// Week 8 — Semantic Search (RETRIEVAL ONLY: ranked results with sources, no
// generated answers).
//
//   query text -> query embedding (same provider/model as the index)
//   -> ONE SQL query: cosine distance (pgvector <=>)
//        + permission filter (same rule as Keyword Search)
//        + lifecycle filter (published / current version / File active+Ready)
//        + optional type / department / tag filters
//   -> ranked results (most similar first) with source links
//
// The permission and lifecycle conditions are part of the SAME query that
// ranks by similarity: restricted rows are never fetched, counted or passed
// to JavaScript. Vectors never leave PostgreSQL (only a similarity number).
import "server-only";

import pool from "@/lib/db";
import { isAdmin, searchableContentSql } from "@/lib/authz";
import {
  parentHref,
  type ContentScope,
  type CurrentUser,
  type EmbeddingInfo,
  type ParentKind,
  type SearchType,
  type SemanticSearchResult,
} from "@/lib/definitions";
import { getEmbeddingConfig } from "@/lib/semantic/config";
import {
  createEmbeddingProvider,
  toVectorLiteral,
  type EmbeddingProvider,
} from "@/lib/semantic/provider";

export const SEMANTIC_TOP_K = 10;

export class SemanticSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticSearchUnavailableError";
  }
}

// One provider per server process (the local model loads once).
const globalForProvider = globalThis as unknown as {
  nozomQueryEmbedder?: Promise<EmbeddingProvider>;
};

function getQueryProvider() {
  if (!globalForProvider.nozomQueryEmbedder) {
    const loading = createEmbeddingProvider(getEmbeddingConfig());
    loading.catch(() => {
      globalForProvider.nozomQueryEmbedder = undefined;
    });
    globalForProvider.nozomQueryEmbedder = loading;
  }

  return globalForProvider.nozomQueryEmbedder;
}

// Safe to show/return: names only, never keys.
export function getEmbeddingInfo(): EmbeddingInfo | null {
  try {
    const config = getEmbeddingConfig();
    return {
      provider: config.provider,
      model: config.model,
      dimensions: config.dimensions,
      testOnly: config.testOnly,
    };
  } catch {
    return null;
  }
}

export type SemanticSearchParams = {
  q: string;
  type: SearchType;
  department: string;
  tag: string | null;
};

// Parameters:
// $1 query vector, $2 embedding model id, $3 is admin, $4 user department,
// $5 type filter, $6 department filter, $7 tag filter, $8 limit
const PAGE_ACCESS = searchableContentSql("pg", "$3", "$4");
const POST_ACCESS = searchableContentSql("p", "$3", "$4");

function departmentFilter(alias: string) {
  return `(
    $6::text = 'all'
    OR ($6::text = 'company' AND ${alias}.scope = 'company')
    OR ${alias}.department_id::text = $6::text
  )`;
}

const POST_HAS_TAG = `EXISTS (
  SELECT 1
  FROM post_tags pt
  JOIN tags t ON t.id = pt.tag_id
  WHERE pt.post_id = p.id AND t.name = $7::text
)`;

const SEMANTIC_SQL = `
  WITH candidates AS (
    SELECT
      sd.id AS doc_id,
      sd.source_type,
      sd.source_id,
      sd.parent_kind,
      sd.parent_id,
      sd.file_id,
      sd.file_version,
      sd.page_number,
      sd.text,
      COALESCE(p.title, pg.title) AS parent_title,
      COALESCE(p.scope, pg.scope) AS scope,
      d.name AS department_name,
      COALESCE(c.updated_at, f.updated_at, p.updated_at, pg.updated_at) AS updated_at,
      f.original_name AS file_name,
      f.mime_type,
      sd.embedding <=> $1::vector AS distance,
      -- one result per File page (overlapping Chunks), one per other source
      CASE WHEN sd.source_type = 'file_chunk'
        THEN 'file:' || sd.file_id || ':' || sd.page_number
        ELSE sd.source_type || ':' || sd.source_id
      END AS group_key
    FROM semantic_documents sd
    LEFT JOIN posts p ON p.id = sd.post_id
    LEFT JOIN pages pg ON pg.id = sd.page_id
    LEFT JOIN comments c ON c.id = sd.comment_id
    LEFT JOIN files f ON f.id = sd.file_id
    LEFT JOIN departments d ON d.id = COALESCE(p.department_id, pg.department_id)
    WHERE
      -- never compare vectors of different models
      sd.embedding_model = $2::text

      -- type filter
      AND ($5::text = 'all'
           OR $5::text = CASE sd.source_type WHEN 'file_chunk' THEN 'file' ELSE sd.source_type END)

      -- PERMISSIONS: the parent Post/Page must be published AND readable by
      -- this user (company-wide, own department, or Admin). Comments and
      -- Files inherit it. Same rule as Keyword Search.
      AND (
        (p.id IS NOT NULL AND ${POST_ACCESS} AND ${departmentFilter("p")})
        OR (pg.id IS NOT NULL AND ${PAGE_ACCESS} AND ${departmentFilter("pg")})
      )
      AND ($7::text IS NULL OR (p.id IS NOT NULL AND ${POST_HAS_TAG}))

      -- LIFECYCLE: the vector must describe the CURRENT version of a source
      -- that still exists (edits are excluded the moment they commit).
      AND CASE sd.source_type
        WHEN 'page' THEN sd.source_version = pg.content_version
        WHEN 'post' THEN sd.source_version = p.content_version
        WHEN 'comment' THEN c.id IS NOT NULL AND sd.source_version = c.content_version
        WHEN 'file_chunk' THEN
          f.id IS NOT NULL
          AND f.is_active
          AND f.processing_status = 'ready'
          AND sd.source_version = f.version
        ELSE false
      END
  )
  SELECT * FROM (
    SELECT DISTINCT ON (group_key) *
    FROM candidates
    ORDER BY group_key, distance, doc_id
  ) AS best
  ORDER BY distance, doc_id
  LIMIT $8
`;

type SemanticRow = {
  doc_id: string;
  source_type: "page" | "post" | "comment" | "file_chunk";
  source_id: string;
  parent_kind: ParentKind;
  parent_id: string;
  file_id: string | null;
  file_version: number | null;
  page_number: number | null;
  text: string;
  parent_title: string;
  scope: ContentScope;
  department_name: string | null;
  updated_at: Date;
  file_name: string | null;
  mime_type: string | null;
  distance: number;
};

function snippet(row: SemanticRow) {
  // Page/Post rows embed "title\n\ncontent": show the content part.
  const split = row.text.indexOf("\n\n");
  const body =
    (row.source_type === "page" || row.source_type === "post") && split >= 0
      ? row.text.slice(split + 2)
      : row.text;
  const text = body.replace(/\s+/g, " ").trim();

  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}

export async function semanticSearch(user: CurrentUser, params: SemanticSearchParams) {
  let provider: EmbeddingProvider;
  let vector: number[];

  try {
    provider = await getQueryProvider();
    vector = await provider.embedQuery(params.q);
  } catch (error) {
    // Details stay in the server log; the user gets a safe message.
    console.error("[semantic-search]", error instanceof Error ? error.message : error);
    throw new SemanticSearchUnavailableError("Query embedding failed.");
  }

  const result = await pool.query<SemanticRow>(SEMANTIC_SQL, [
    toVectorLiteral(vector),
    provider.modelId,
    isAdmin(user),
    user.departmentId,
    params.type,
    params.department,
    params.tag,
    SEMANTIC_TOP_K,
  ]);

  const results: SemanticSearchResult[] = result.rows.map((row) => {
    const isFile = row.source_type === "file_chunk" && row.file_id !== null;
    const parentId = Number(row.parent_id);

    return {
      type: row.source_type === "file_chunk" ? "file" : row.source_type,
      id: Number(row.source_id),
      title: isFile ? (row.file_name ?? row.parent_title) : row.parent_title,
      snippet: snippet(row),
      parentKind: row.parent_kind,
      parentId,
      parentTitle: row.parent_title,
      scope: row.scope,
      departmentName: row.department_name,
      updatedAt: row.updated_at.toISOString(),
      similarity: Math.round((1 - Number(row.distance)) * 1000) / 1000,
      url: parentHref(row.parent_kind, parentId),
      downloadUrl: isFile ? `/api/files/${row.file_id}/download` : null,
      file: isFile
        ? {
            id: Number(row.file_id),
            name: row.file_name ?? "",
            version: row.file_version ?? 1,
            // TXT is one logical page: no page number shown
            pageNumber: row.mime_type === "application/pdf" ? row.page_number : null,
          }
        : null,
    };
  });

  return {
    mode: "semantic" as const,
    results,
    total: results.length,
    topK: SEMANTIC_TOP_K,
    embedding: getEmbeddingInfo(),
  };
}
