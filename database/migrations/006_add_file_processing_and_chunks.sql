-- Week 7: background File processing (BullMQ / Redis Worker) + text Chunks.
--
-- PostgreSQL keeps the permanent state (File status, version, Chunks).
-- Redis only holds the short-lived Job/Queue state.
--
--   upload -> pending -> (Worker) processing -> ready
--                                            \-> failed (after retries / not indexable)
--
-- A File's "document id" is files.id. Every Chunk points to the File, the
-- File version it was extracted from, its page and its position.

BEGIN;

-- ---------------------------------------------------------------
-- Files: processing state, version and enable/disable.
-- Existing rows start as 'pending' (version 1, active); the Worker
-- picks them up when it starts (it re-queues pending Files).
-- ---------------------------------------------------------------
ALTER TABLE files
  ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN processing_error TEXT,
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN processed_at TIMESTAMP,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT files_processing_status_check
    CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  ADD CONSTRAINT files_version_check
    CHECK (version >= 1),
  -- short, user-safe message only (never a stack trace)
  ADD CONSTRAINT files_processing_error_length_check
    CHECK (processing_error IS NULL OR char_length(processing_error) <= 500),
  ADD CONSTRAINT files_ready_processed_at_check
    CHECK (processing_status <> 'ready' OR processed_at IS NOT NULL);

-- Worker start-up looks for unfinished active Files.
CREATE INDEX files_unfinished_idx
  ON files (processing_status)
  WHERE processing_status IN ('pending', 'processing');

-- ---------------------------------------------------------------
-- File Chunks: extracted text split into small pieces.
-- TXT files are one logical page: page_number = 1.
-- ---------------------------------------------------------------
CREATE TABLE file_chunks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Idempotency guarantee: one Chunk per position per File version,
  -- however many times a Job runs.
  CONSTRAINT file_chunks_file_version_index_unique
    UNIQUE (file_id, version, chunk_index),
  CONSTRAINT file_chunks_version_check CHECK (version >= 1),
  CONSTRAINT file_chunks_page_number_check CHECK (page_number >= 1),
  CONSTRAINT file_chunks_chunk_index_check CHECK (chunk_index >= 0),
  CONSTRAINT file_chunks_text_length_check
    CHECK (char_length(text) BETWEEN 1 AND 4000)
);

-- The unique constraint above also serves (file_id, version) lookups;
-- this one keeps page-ordered reads cheap.
CREATE INDEX file_chunks_file_version_page_idx
  ON file_chunks (file_id, version, page_number);

COMMIT;
