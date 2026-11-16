-- Week 5: roles, content scope, lifecycle status and updated_at.
--
-- Official content  = rows in "pages"
-- Community content = rows in "posts"
-- (The resource type already tells us which is which, so no extra column is needed.)

BEGIN;

-- ---------------------------------------------------------------
-- Users: only the three supported roles are allowed.
-- ---------------------------------------------------------------
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('Admin', 'Editor', 'Member'));

-- ---------------------------------------------------------------
-- Posts (Community content)
-- ---------------------------------------------------------------
ALTER TABLE posts
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'company',
  ADD COLUMN department_id BIGINT REFERENCES departments(id),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Keep the existing Week 3 lifecycle information: is_published -> status.
UPDATE posts
SET status = CASE WHEN is_published THEN 'published' ELSE 'draft' END;

-- Existing rows get updated_at = created_at instead of "now".
UPDATE posts
SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP);

-- status replaces is_published; keeping both would create two sources of truth.
ALTER TABLE posts DROP COLUMN is_published;

ALTER TABLE posts
  ADD CONSTRAINT posts_scope_check
    CHECK (scope IN ('company', 'department')),
  ADD CONSTRAINT posts_status_check
    CHECK (status IN ('draft', 'published', 'archived')),
  -- department scope requires a department; company scope must not have one.
  ADD CONSTRAINT posts_scope_department_check
    CHECK (
      (scope = 'company' AND department_id IS NULL)
      OR (scope = 'department' AND department_id IS NOT NULL)
    );

-- ---------------------------------------------------------------
-- Pages (Official content)
-- ---------------------------------------------------------------
-- Existing pages were already visible, so they are backfilled as 'published'.
ALTER TABLE pages
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'company',
  ADD COLUMN department_id BIGINT REFERENCES departments(id),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE pages
SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP);

-- New Official Pages start as drafts until an Editor/Admin publishes them.
ALTER TABLE pages ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE pages
  ADD CONSTRAINT pages_scope_check
    CHECK (scope IN ('company', 'department')),
  ADD CONSTRAINT pages_status_check
    CHECK (status IN ('draft', 'published', 'archived')),
  ADD CONSTRAINT pages_scope_department_check
    CHECK (
      (scope = 'company' AND department_id IS NULL)
      OR (scope = 'department' AND department_id IS NOT NULL)
    );

-- Indexes for the permission filters used by every list query.
CREATE INDEX posts_status_scope_idx ON posts (status, scope, department_id);
CREATE INDEX posts_user_id_idx ON posts (user_id);
CREATE INDEX pages_status_scope_idx ON pages (status, scope, department_id);

COMMIT;
