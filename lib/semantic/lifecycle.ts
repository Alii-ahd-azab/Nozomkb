// Week 8 — semantic index lifecycle ("reconcile").
//
// Compares the semantic index with the LIVE content in PostgreSQL for a
// scope (one Post/Page with its Comments + Files, one Comment, one File, or
// everything) and:
//
//   1. deletes semantic rows that are no longer current + eligible
//      (old content_version / File version, archived or draft parent,
//      disabled / not-Ready File ...)
//   2. deletes indexing-status rows of sources that are no longer eligible
//   3. marks every eligible source whose index is missing / old / failed /
//      from another model as "pending" and returns it, so the caller can
//      enqueue an indexing Job for it.
//
// It only touches PostgreSQL (no embedding provider, no Redis), so the
// invalidation part works even when the Worker or Redis is down. Search
// additionally re-checks every condition at query time, so a stale row is
// never returned even in the short moment before this cleanup runs.
//
// Shared by the Next.js app, the Worker and `npm run semantic:reindex`.
import type { Pool, PoolClient } from "pg";
import type { SemanticJobData, SemanticSourceKind } from "@/lib/semantic/config";

export type SemanticScope =
  | { kind: "all" }
  | { kind: "post" | "page"; id: number } // the item + its Comments + Files
  | { kind: "comment"; id: number }
  | { kind: "file"; id: number };

export type ReconcileResult = {
  removedDocuments: number;
  removedStatuses: number;
  targets: SemanticJobData[];
};

// Eligible sources = what Semantic Search may ever contain:
//   published Pages / Posts, Comments on a published parent, and
//   active + Ready Files on a published parent (current version).
// (Department/scope permissions are NOT applied here: they are applied per
// reader at query time, so a permission change needs no re-indexing.)
const ELIGIBLE_CTE = `
  eligible AS (
    SELECT * FROM (
      SELECT 'page'::text AS kind, pg.id, pg.content_version AS version,
             pg.id AS page_id, NULL::bigint AS post_id
      FROM pages pg
      WHERE pg.status = 'published'

      UNION ALL
      SELECT 'post', p.id, p.content_version, NULL, p.id
      FROM posts p
      WHERE p.status = 'published'

      UNION ALL
      SELECT 'comment', c.id, c.content_version, c.page_id, c.post_id
      FROM comments c
      LEFT JOIN posts p ON p.id = c.post_id
      LEFT JOIN pages pg ON pg.id = c.page_id
      WHERE COALESCE(p.status, pg.status) = 'published'

      UNION ALL
      SELECT 'file', f.id, f.version, f.page_id, f.post_id
      FROM files f
      LEFT JOIN posts p ON p.id = f.post_id
      LEFT JOIN pages pg ON pg.id = f.page_id
      WHERE f.is_active
        AND f.processing_status = 'ready'
        AND COALESCE(p.status, pg.status) = 'published'
    ) AS e
    WHERE $1::text = 'all'
       OR ($1::text = 'post' AND e.post_id = $2::bigint)
       OR ($1::text = 'page' AND e.page_id = $2::bigint)
       OR ($1::text = e.kind AND $1::text IN ('comment', 'file') AND e.id = $2::bigint)
  )
`;

// semantic_documents row -> (kind, key) of the SOURCE it belongs to
const DOC_KIND = `CASE sd.source_type WHEN 'file_chunk' THEN 'file' ELSE sd.source_type END`;
const DOC_KEY = `CASE sd.source_type WHEN 'file_chunk' THEN sd.file_id ELSE sd.source_id END`;

const DOC_IN_SCOPE = `(
  $1::text = 'all'
  OR ($1::text = 'post' AND sd.post_id = $2::bigint)
  OR ($1::text = 'page' AND sd.page_id = $2::bigint)
  OR ($1::text = 'comment' AND sd.comment_id = $2::bigint)
  OR ($1::text = 'file' AND sd.file_id = $2::bigint)
)`;

const STATUS_IN_SCOPE = `(
  $1::text = 'all'
  OR ($1::text = 'post' AND (
    st.post_id = $2::bigint
    OR st.comment_id IN (SELECT id FROM comments WHERE post_id = $2::bigint)
    OR st.file_id IN (SELECT id FROM files WHERE post_id = $2::bigint)
  ))
  OR ($1::text = 'page' AND (
    st.page_id = $2::bigint
    OR st.comment_id IN (SELECT id FROM comments WHERE page_id = $2::bigint)
    OR st.file_id IN (SELECT id FROM files WHERE page_id = $2::bigint)
  ))
  OR ($1::text = 'comment' AND st.comment_id = $2::bigint)
  OR ($1::text = 'file' AND st.file_id = $2::bigint)
)`;

type Queryable = Pool | PoolClient;

export async function reconcileSemanticIndex(
  db: Queryable,
  scope: SemanticScope,
  // active embedding model id; null = only clean up (no provider configured)
  modelId: string | null
): Promise<ReconcileResult> {
  const scopeParams = [scope.kind, scope.kind === "all" ? null : scope.id];

  // 1. Stale / ineligible vectors are removed.
  const removedDocs = await db.query(
    `
      WITH ${ELIGIBLE_CTE}
      DELETE FROM semantic_documents sd
      WHERE ${DOC_IN_SCOPE}
        AND NOT EXISTS (
          SELECT 1 FROM eligible e
          WHERE e.kind = ${DOC_KIND}
            AND e.id = ${DOC_KEY}
            AND e.version = sd.source_version
        )
    `,
    scopeParams
  );

  // 2. Status rows of sources that left the index.
  const removedStatuses = await db.query(
    `
      WITH ${ELIGIBLE_CTE}
      DELETE FROM semantic_index_status st
      WHERE ${STATUS_IN_SCOPE}
        AND NOT EXISTS (
          SELECT 1 FROM eligible e
          WHERE e.kind = st.source_kind AND e.id = st.source_id
        )
    `,
    scopeParams
  );

  if (modelId === null) {
    return {
      removedDocuments: removedDocs.rowCount ?? 0,
      removedStatuses: removedStatuses.rowCount ?? 0,
      targets: [],
    };
  }

  // 3. Eligible sources that are not (correctly) indexed yet -> pending.
  const needed = await db.query<{ kind: SemanticSourceKind; id: string; version: number }>(
    `
      WITH ${ELIGIBLE_CTE},
      upserted AS (
        INSERT INTO semantic_index_status
          (source_kind, page_id, post_id, comment_id, file_id,
           source_version, status, error, embedding_model, updated_at)
        SELECT e.kind,
               CASE WHEN e.kind = 'page' THEN e.id END,
               CASE WHEN e.kind = 'post' THEN e.id END,
               CASE WHEN e.kind = 'comment' THEN e.id END,
               CASE WHEN e.kind = 'file' THEN e.id END,
               e.version, 'pending', NULL, $3::text, CURRENT_TIMESTAMP
        FROM eligible e
        LEFT JOIN semantic_index_status st
          ON st.source_kind = e.kind AND st.source_id = e.id
        WHERE NOT COALESCE(
          st.status = 'ready'
          AND st.source_version = e.version
          AND st.embedding_model = $3::text
          AND EXISTS (
            SELECT 1 FROM semantic_documents sd
            WHERE ${DOC_KIND} = e.kind AND ${DOC_KEY} = e.id
              AND sd.source_version = e.version
              AND sd.embedding_model = $3::text
          ),
          false
        )
        ON CONFLICT (source_kind, source_id) DO UPDATE
          SET source_version = EXCLUDED.source_version,
              status = 'pending',
              error = NULL,
              embedding_model = EXCLUDED.embedding_model,
              updated_at = CURRENT_TIMESTAMP
          -- already queued/running for this exact version + model: keep it
          WHERE NOT (
            semantic_index_status.status IN ('pending', 'indexing')
            AND semantic_index_status.source_version = EXCLUDED.source_version
            AND semantic_index_status.embedding_model = EXCLUDED.embedding_model
          )
        RETURNING source_kind
      )
      SELECT e.kind, e.id, e.version
      FROM eligible e
      LEFT JOIN semantic_index_status st
        ON st.source_kind = e.kind AND st.source_id = e.id
      WHERE NOT COALESCE(
        st.status = 'ready'
        AND st.source_version = e.version
        AND st.embedding_model = $3::text
        AND EXISTS (
          SELECT 1 FROM semantic_documents sd
          WHERE ${DOC_KIND} = e.kind AND ${DOC_KEY} = e.id
            AND sd.source_version = e.version
            AND sd.embedding_model = $3::text
        ),
        false
      )
      ORDER BY e.kind, e.id
    `,
    [...scopeParams, modelId]
  );

  return {
    removedDocuments: removedDocs.rowCount ?? 0,
    removedStatuses: removedStatuses.rowCount ?? 0,
    targets: needed.rows.map((row) => ({
      sourceType: row.kind,
      sourceId: Number(row.id),
      sourceVersion: row.version,
    })),
  };
}
