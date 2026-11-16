// Week 8 — semantic indexing of ONE source version (run by the Worker).
//
//   load source -> missing? newer version? not eligible? -> exit safely
//   -> status "indexing" -> embed text(s) with the provider (batched,
//      OUTSIDE any transaction: it can take a while / talk to the network)
//   -> ONE transaction: lock source (+ parent), re-check version, eligibility
//      and text, delete the source's old vectors, insert the new ones,
//      status "ready" -> COMMIT
//
// Idempotent: retries and duplicate Jobs always end with exactly one row per
// (source, version) — the old rows are replaced under a row lock, and
// UNIQUE (source_type, source_id, source_version) is the last line of
// defence. A failure anywhere rolls back: never half an index.
import type { Pool, PoolClient } from "pg";
import { AR } from "@/lib/messages";
import type { SemanticJobData, SemanticSourceKind } from "@/lib/semantic/config";
import { reconcileSemanticIndex } from "@/lib/semantic/lifecycle";
import {
  PermanentEmbeddingError,
  toVectorLiteral,
  type EmbeddingProvider,
} from "@/lib/semantic/provider";

export type IndexOutcome =
  | { outcome: "indexed"; documents: number }
  // nothing to do; the Job finishes without writing vectors
  | { outcome: "missing" | "stale" | "ineligible" };

// The source changed while we were embedding it: retry with fresh data.
export class SourceChangedError extends Error {
  constructor() {
    super("Source changed while it was being indexed.");
    this.name = "SourceChangedError";
  }
}

type Unit = {
  sourceType: "page" | "post" | "comment" | "file_chunk";
  pageId: number | null;
  postId: number | null;
  commentId: number | null;
  fileId: number | null;
  fileChunkId: number | null;
  pageNumber: number | null;
  chunkIndex: number | null;
  text: string;
};

type LoadedSource = { version: number; eligible: boolean; units: Unit[] };

type Queryable = Pool | PoolClient;

const base = {
  pageId: null,
  postId: null,
  commentId: null,
  fileId: null,
  fileChunkId: null,
  pageNumber: null,
  chunkIndex: null,
};

// Locks: the source row FOR UPDATE (serializes duplicate Jobs and edits) and
// the parent FOR SHARE (an archive cannot slip in before we commit).
async function loadSource(
  db: Queryable,
  kind: SemanticSourceKind,
  id: number,
  lock: boolean
): Promise<LoadedSource | null> {
  const forUpdate = lock ? "FOR UPDATE" : "";
  const forShare = lock ? "FOR SHARE" : "";

  if (kind === "page" || kind === "post") {
    const table = kind === "page" ? "pages" : "posts";
    const row = (
      await db.query<{ title: string; content: string; status: string; content_version: number }>(
        `SELECT title, content, status, content_version FROM ${table} WHERE id = $1 ${forUpdate}`,
        [id]
      )
    ).rows[0];

    if (!row) return null;

    return {
      version: row.content_version,
      eligible: row.status === "published",
      units: [
        {
          ...base,
          sourceType: kind,
          pageId: kind === "page" ? id : null,
          postId: kind === "post" ? id : null,
          text: `${row.title}\n\n${row.content}`,
        },
      ],
    };
  }

  if (kind === "comment") {
    const row = (
      await db.query<{ content: string; content_version: number; post_id: string | null; page_id: string | null }>(
        `SELECT content, content_version, post_id, page_id FROM comments WHERE id = $1 ${forUpdate}`,
        [id]
      )
    ).rows[0];

    if (!row) return null;

    const parentStatus = row.post_id
      ? (await db.query<{ status: string }>(`SELECT status FROM posts WHERE id = $1 ${forShare}`, [row.post_id])).rows[0]
      : (await db.query<{ status: string }>(`SELECT status FROM pages WHERE id = $1 ${forShare}`, [row.page_id])).rows[0];

    return {
      version: row.content_version,
      eligible: parentStatus?.status === "published",
      units: [
        {
          ...base,
          sourceType: "comment",
          commentId: id,
          postId: row.post_id === null ? null : Number(row.post_id),
          pageId: row.page_id === null ? null : Number(row.page_id),
          text: row.content,
        },
      ],
    };
  }

  // file: every Chunk of the CURRENT version
  const file = (
    await db.query<{ version: number; is_active: boolean; processing_status: string; post_id: string | null; page_id: string | null }>(
      `SELECT version, is_active, processing_status, post_id, page_id FROM files WHERE id = $1 ${forUpdate}`,
      [id]
    )
  ).rows[0];

  if (!file) return null;

  const parentStatus = file.post_id
    ? (await db.query<{ status: string }>(`SELECT status FROM posts WHERE id = $1 ${forShare}`, [file.post_id])).rows[0]
    : (await db.query<{ status: string }>(`SELECT status FROM pages WHERE id = $1 ${forShare}`, [file.page_id])).rows[0];

  const chunks = await db.query<{ id: string; page_number: number; chunk_index: number; text: string }>(
    `SELECT id, page_number, chunk_index, text FROM file_chunks
     WHERE file_id = $1 AND version = $2 ORDER BY chunk_index`,
    [id, file.version]
  );

  return {
    version: file.version,
    eligible:
      file.is_active &&
      file.processing_status === "ready" &&
      parentStatus?.status === "published" &&
      chunks.rows.length > 0,
    units: chunks.rows.map((chunk) => ({
      ...base,
      sourceType: "file_chunk" as const,
      fileId: id,
      fileChunkId: Number(chunk.id),
      postId: file.post_id === null ? null : Number(file.post_id),
      pageId: file.page_id === null ? null : Number(file.page_id),
      pageNumber: chunk.page_number,
      chunkIndex: chunk.chunk_index,
      text: chunk.text,
    })),
  };
}

function sameUnits(a: Unit[], b: Unit[]) {
  return (
    a.length === b.length &&
    a.every((unit, i) => unit.text === b[i].text && unit.fileChunkId === b[i].fileChunkId)
  );
}

const DELETE_SOURCE_DOCS: Record<SemanticSourceKind, string> = {
  page: "DELETE FROM semantic_documents WHERE source_type = 'page' AND page_id = $1",
  post: "DELETE FROM semantic_documents WHERE source_type = 'post' AND post_id = $1",
  comment: "DELETE FROM semantic_documents WHERE comment_id = $1",
  file: "DELETE FROM semantic_documents WHERE file_id = $1",
};

const STATUS_COLUMN: Record<SemanticSourceKind, string> = {
  page: "page_id",
  post: "post_id",
  comment: "comment_id",
  file: "file_id",
};

export async function indexSource(
  pool: Pool,
  provider: EmbeddingProvider,
  job: SemanticJobData
): Promise<IndexOutcome> {
  const source = await loadSource(pool, job.sourceType, job.sourceId, false);

  if (!source) return { outcome: "missing" };
  if (source.version !== job.sourceVersion) return { outcome: "stale" };

  if (!source.eligible) {
    // e.g. archived after the Job was queued: make sure nothing is left.
    await reconcileSemanticIndex(pool, { kind: job.sourceType, id: job.sourceId }, null);
    return { outcome: "ineligible" };
  }

  await pool.query(
    `UPDATE semantic_index_status
     SET status = 'indexing', updated_at = CURRENT_TIMESTAMP
     WHERE source_kind = $1 AND source_id = $2 AND source_version = $3
       AND status IN ('pending', 'failed')`,
    [job.sourceType, job.sourceId, job.sourceVersion]
  );

  // External I/O / CPU work: outside the transaction, no locks held.
  const vectors = await provider.embedDocuments(source.units.map((unit) => unit.text));

  if (vectors.length !== source.units.length) {
    throw new PermanentEmbeddingError("Embedding provider returned an invalid response.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const current = await loadSource(client, job.sourceType, job.sourceId, true);

    if (!current) {
      await client.query("ROLLBACK");
      return { outcome: "missing" };
    }

    if (current.version !== job.sourceVersion) {
      await client.query("ROLLBACK");
      return { outcome: "stale" };
    }

    if (!current.eligible) {
      await client.query("ROLLBACK");
      await reconcileSemanticIndex(pool, { kind: job.sourceType, id: job.sourceId }, null);
      return { outcome: "ineligible" };
    }

    if (!sameUnits(source.units, current.units)) {
      // e.g. the File's Chunks were re-generated meanwhile: embed again.
      await client.query("ROLLBACK");
      throw new SourceChangedError();
    }

    // Replace: every older version / other model of this source goes.
    await client.query(DELETE_SOURCE_DOCS[job.sourceType], [job.sourceId]);

    const units = current.units;

    await client.query(
      `
        INSERT INTO semantic_documents
          (source_type, page_id, post_id, comment_id, file_id, file_chunk_id,
           source_version, page_number, chunk_index, text, embedding, embedding_model)
        SELECT u.source_type, u.page_id, u.post_id, u.comment_id, u.file_id, u.file_chunk_id,
               $1, u.page_number, u.chunk_index, u.text, u.embedding::vector, $2
        FROM unnest(
          $3::text[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[],
          $9::int[], $10::int[], $11::text[], $12::text[]
        ) AS u(source_type, page_id, post_id, comment_id, file_id, file_chunk_id,
               page_number, chunk_index, text, embedding)
      `,
      [
        job.sourceVersion,
        provider.modelId,
        units.map((u) => u.sourceType),
        units.map((u) => u.pageId),
        units.map((u) => u.postId),
        units.map((u) => u.commentId),
        units.map((u) => u.fileId),
        units.map((u) => u.fileChunkId),
        units.map((u) => u.pageNumber),
        units.map((u) => u.chunkIndex),
        units.map((u) => u.text),
        vectors.map(toVectorLiteral),
      ]
    );

    await client.query(
      `
        INSERT INTO semantic_index_status
          (source_kind, ${STATUS_COLUMN[job.sourceType]}, source_version, status,
           embedding_model, document_count, indexed_at, updated_at)
        VALUES ($1, $2, $3, 'ready', $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (source_kind, source_id) DO UPDATE
          SET source_version = EXCLUDED.source_version,
              status = 'ready',
              error = NULL,
              embedding_model = EXCLUDED.embedding_model,
              document_count = EXCLUDED.document_count,
              indexed_at = EXCLUDED.indexed_at,
              updated_at = EXCLUDED.updated_at
      `,
      [job.sourceType, job.sourceId, job.sourceVersion, provider.modelId, units.length]
    );

    await client.query("COMMIT");
    return { outcome: "indexed", documents: units.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Safe message only (never provider internals / keys), for the current
// version only, and never downgrading a source another Job finished.
export async function recordIndexingFailure(
  pool: Pool,
  job: SemanticJobData,
  finalAttempt: boolean
) {
  await pool.query(
    `
      UPDATE semantic_index_status
      SET status = $4, error = $5, updated_at = CURRENT_TIMESTAMP
      WHERE source_kind = $1 AND source_id = $2 AND source_version = $3
        AND status IN ('pending', 'indexing')
    `,
    [
      job.sourceType,
      job.sourceId,
      job.sourceVersion,
      finalAttempt ? "failed" : "pending",
      finalAttempt ? AR.semanticIndexFailed : AR.semanticIndexRetrying,
    ]
  );
}
