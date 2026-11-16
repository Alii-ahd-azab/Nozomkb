-- Week 8: Embeddings + pgvector + Semantic Search (retrieval only).
--
-- One normalized index table (semantic_documents) holds one embedding per
-- searchable unit:
--   page        -> title + content of an Official Page
--   post        -> title + content of a Community Post
--   comment     -> text of one Comment
--   file_chunk  -> one Week 7 File Chunk (current File version only)
--
-- Every row points back to its source with real foreign keys, so deleting a
-- Page / Post / Comment / File / Chunk deletes its semantic rows in the same
-- statement (ON DELETE CASCADE).
--
-- Rows are only a CACHE of "text -> vector". Whether a row may be RETURNED is
-- decided at query time against the live source rows (published? current
-- version? File active + Ready? reader's department?), so an edit, archive,
-- disable or permission change takes effect immediately, even before any
-- re-embedding has happened.
--
-- Requires the pgvector extension files to be installed in PostgreSQL
-- (pgvector 0.8.7 was built and installed for PostgreSQL 18 on this machine).

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------
-- Source versions for Pages / Posts / Comments.
-- Bumped whenever the EMBEDDED text changes (title/content), so an old
-- embedding is recognisably stale the moment the edit commits.
-- (Files already have files.version from Week 7.)
-- ---------------------------------------------------------------
ALTER TABLE pages
  ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1
    CONSTRAINT pages_content_version_check CHECK (content_version >= 1);

ALTER TABLE posts
  ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1
    CONSTRAINT posts_content_version_check CHECK (content_version >= 1);

ALTER TABLE comments
  ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1
    CONSTRAINT comments_content_version_check CHECK (content_version >= 1);

-- ---------------------------------------------------------------
-- semantic_documents: the vector index.
-- ---------------------------------------------------------------
CREATE TABLE semantic_documents (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,

  -- Parent Post OR Page (for a page/post row: the row itself).
  page_id BIGINT REFERENCES pages(id) ON DELETE CASCADE,
  post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
  file_id BIGINT REFERENCES files(id) ON DELETE CASCADE,
  file_chunk_id BIGINT REFERENCES file_chunks(id) ON DELETE CASCADE,

  -- Derived identity (never stored twice, so it can never disagree).
  source_id BIGINT GENERATED ALWAYS AS
    (COALESCE(file_chunk_id, comment_id, post_id, page_id)) STORED,
  parent_kind TEXT GENERATED ALWAYS AS
    (CASE WHEN post_id IS NOT NULL THEN 'post' ELSE 'page' END) STORED,
  parent_id BIGINT GENERATED ALWAYS AS (COALESCE(post_id, page_id)) STORED,

  -- content_version of the Page/Post/Comment, or the File version.
  source_version INTEGER NOT NULL,
  file_version INTEGER GENERATED ALWAYS AS
    (CASE WHEN source_type = 'file_chunk' THEN source_version END) STORED,
  page_number INTEGER,
  chunk_index INTEGER,

  -- Exactly the text that was embedded (also used for result snippets).
  text TEXT NOT NULL,
  -- Fixed dimension for the whole index (EMBEDDING_DIMENSIONS = 384).
  embedding vector(384) NOT NULL,
  -- Provider/model that produced the vector. Search only compares vectors
  -- of the active model, so two models can never be mixed in one ranking.
  embedding_model TEXT NOT NULL,
  indexed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT semantic_documents_source_type_check
    CHECK (source_type IN ('page', 'post', 'comment', 'file_chunk')),
  CONSTRAINT semantic_documents_one_parent_check
    CHECK (num_nonnulls(page_id, post_id) = 1),
  -- Only well-formed source combinations are possible.
  CONSTRAINT semantic_documents_shape_check CHECK (
    (
      source_type IN ('page', 'post')
      AND (source_type = 'page') = (page_id IS NOT NULL)
      AND comment_id IS NULL AND file_id IS NULL AND file_chunk_id IS NULL
      AND page_number IS NULL AND chunk_index IS NULL
    )
    OR (
      source_type = 'comment'
      AND comment_id IS NOT NULL
      AND file_id IS NULL AND file_chunk_id IS NULL
      AND page_number IS NULL AND chunk_index IS NULL
    )
    OR (
      source_type = 'file_chunk'
      AND file_id IS NOT NULL AND file_chunk_id IS NOT NULL
      AND comment_id IS NULL
      AND page_number IS NOT NULL AND chunk_index IS NOT NULL
      AND page_number >= 1 AND chunk_index >= 0
    )
  ),
  CONSTRAINT semantic_documents_source_version_check
    CHECK (source_version >= 1),
  CONSTRAINT semantic_documents_text_length_check
    CHECK (char_length(text) BETWEEN 1 AND 25000),
  CONSTRAINT semantic_documents_model_length_check
    CHECK (char_length(embedding_model) BETWEEN 1 AND 200),

  -- Idempotency: one row per source per version (retries cannot duplicate).
  CONSTRAINT semantic_documents_source_unique
    UNIQUE (source_type, source_id, source_version)
);

-- File Chunks are also unique by their File identity.
CREATE UNIQUE INDEX semantic_documents_file_chunk_unique
  ON semantic_documents (file_id, source_version, chunk_index)
  WHERE source_type = 'file_chunk';

-- Lookups by parent / source (cascades, invalidation, joins).
CREATE INDEX semantic_documents_post_idx ON semantic_documents (post_id);
CREATE INDEX semantic_documents_page_idx ON semantic_documents (page_id);
CREATE INDEX semantic_documents_comment_idx ON semantic_documents (comment_id);
CREATE INDEX semantic_documents_file_idx ON semantic_documents (file_id);
CREATE INDEX semantic_documents_file_chunk_idx ON semantic_documents (file_chunk_id);

-- No HNSW / IVFFlat index on purpose: at pilot scale an exact scan with
-- cosine distance (<=>) is fast and exact, and it applies the permission /
-- lifecycle WHERE clause BEFORE ranking. An approximate index could return
-- fewer than LIMIT rows once restricted rows are filtered out. Add HNSW
-- (vector_cosine_ops) only when the table is large enough to need it.

-- ---------------------------------------------------------------
-- semantic_index_status: indexing state per SOURCE (Page, Post, Comment or
-- whole File version). Separate from files.processing_status (Week 7).
-- ---------------------------------------------------------------
CREATE TABLE semantic_index_status (
  id BIGSERIAL PRIMARY KEY,
  source_kind TEXT NOT NULL,
  page_id BIGINT REFERENCES pages(id) ON DELETE CASCADE,
  post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
  file_id BIGINT REFERENCES files(id) ON DELETE CASCADE,
  source_id BIGINT GENERATED ALWAYS AS
    (COALESCE(page_id, post_id, comment_id, file_id)) STORED,
  source_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Safe, user-facing message only (never provider internals / keys).
  error TEXT,
  embedding_model TEXT,
  document_count INTEGER,
  indexed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT semantic_index_status_kind_check
    CHECK (source_kind IN ('page', 'post', 'comment', 'file')),
  CONSTRAINT semantic_index_status_one_source_check CHECK (
    num_nonnulls(page_id, post_id, comment_id, file_id) = 1
    AND (source_kind = 'page') = (page_id IS NOT NULL)
    AND (source_kind = 'post') = (post_id IS NOT NULL)
    AND (source_kind = 'comment') = (comment_id IS NOT NULL)
    AND (source_kind = 'file') = (file_id IS NOT NULL)
  ),
  CONSTRAINT semantic_index_status_status_check
    CHECK (status IN ('pending', 'indexing', 'ready', 'failed')),
  CONSTRAINT semantic_index_status_version_check
    CHECK (source_version >= 1),
  CONSTRAINT semantic_index_status_error_length_check
    CHECK (error IS NULL OR char_length(error) <= 500),
  CONSTRAINT semantic_index_status_ready_check
    CHECK (status <> 'ready' OR (indexed_at IS NOT NULL AND embedding_model IS NOT NULL)),
  CONSTRAINT semantic_index_status_source_unique
    UNIQUE (source_kind, source_id)
);

-- Cascading deletes look rows up by these columns.
CREATE INDEX semantic_index_status_page_idx ON semantic_index_status (page_id);
CREATE INDEX semantic_index_status_post_idx ON semantic_index_status (post_id);
CREATE INDEX semantic_index_status_comment_idx ON semantic_index_status (comment_id);
CREATE INDEX semantic_index_status_file_idx ON semantic_index_status (file_id);

CREATE INDEX semantic_index_status_unfinished_idx
  ON semantic_index_status (status)
  WHERE status IN ('pending', 'indexing');

COMMIT;
