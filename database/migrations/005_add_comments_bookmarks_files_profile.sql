-- Week 6: Comments, Bookmarks, private File metadata and employee specialty.
--
-- Comments, Bookmarks and Files have NO scope / department / status of their
-- own: access is always inherited from the parent Post or Official Page.

BEGIN;

-- ---------------------------------------------------------------
-- Profile: employees may edit only their specialty.
-- (role and department stay admin-controlled; they drive authorization.)
-- ---------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN specialty TEXT,
  ADD CONSTRAINT users_specialty_length_check
    CHECK (specialty IS NULL OR char_length(specialty) <= 100);

-- ---------------------------------------------------------------
-- Comments on a Post OR an Official Page (exactly one parent).
-- ---------------------------------------------------------------
CREATE TABLE comments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  page_id BIGINT REFERENCES pages(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT comments_one_parent_check
    CHECK (num_nonnulls(post_id, page_id) = 1),
  CONSTRAINT comments_content_length_check
    CHECK (char_length(content) BETWEEN 1 AND 2000)
);

CREATE INDEX comments_post_id_idx ON comments (post_id);
CREATE INDEX comments_page_id_idx ON comments (page_id);

-- ---------------------------------------------------------------
-- Bookmarks: private per user, one target (Post OR Page), no duplicates.
-- ---------------------------------------------------------------
CREATE TABLE bookmarks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  page_id BIGINT REFERENCES pages(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT bookmarks_one_target_check
    CHECK (num_nonnulls(post_id, page_id) = 1)
);

CREATE UNIQUE INDEX bookmarks_user_post_unique
  ON bookmarks (user_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX bookmarks_user_page_unique
  ON bookmarks (user_id, page_id) WHERE page_id IS NOT NULL;

-- ---------------------------------------------------------------
-- Files: metadata only. The bytes live in private local storage
-- (storage/private/), never in PostgreSQL and never under public/.
-- ---------------------------------------------------------------
CREATE TABLE files (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  uploaded_by BIGINT NOT NULL REFERENCES users(id),
  post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  page_id BIGINT REFERENCES pages(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT files_one_parent_check
    CHECK (num_nonnulls(post_id, page_id) = 1),
  CONSTRAINT files_mime_type_check
    CHECK (mime_type IN ('application/pdf', 'text/plain')),
  -- 10 MB = 10 * 1024 * 1024 bytes
  CONSTRAINT files_size_check
    CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  -- generated key only: "<uuid>.pdf" / "<uuid>.txt" (no paths, no "..")
  CONSTRAINT files_storage_key_check
    CHECK (storage_key ~ '^[0-9a-f-]{36}\.(pdf|txt)$'),
  CONSTRAINT files_original_name_length_check
    CHECK (char_length(original_name) BETWEEN 1 AND 255)
);

CREATE INDEX files_post_id_idx ON files (post_id);
CREATE INDEX files_page_id_idx ON files (page_id);

COMMIT;
