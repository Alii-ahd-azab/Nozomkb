-- Seed data for a CLEAN database.
-- Run after all migrations (001 -> 004).
--
-- TRAINING-ONLY test accounts. Passwords are stored as bcrypt hashes only.
-- The shared local test password is documented in README.md (Week 5 section).
-- Never reuse these accounts or this password outside local development.

INSERT INTO departments (name)
VALUES
  ('IT'),
  ('HR'),
  ('Accounting');

INSERT INTO users (name, email, department_id, role, password_hash)
VALUES
  ('Ali', 'ali@nozom.local', 1, 'Member',
   '$2b$10$AvQrOfeGoembEKyhzk.x3ubEUSQ3TGMX.KHgUGOFaziHcaIaOOqvu'),
  ('Ahmed', 'ahmed@nozom.local', 2, 'Member',
   '$2b$10$8aYTgKpMKM29UMisaBcd3ejGZfj8mvlAlaoIdLZ08si0f51q/Z.ze'),
  ('Mona', 'mona@nozom.local', 3, 'Editor',
   '$2b$10$iM91Xzo4dFHFcNFG7oL/iufiAAHlfxNd5H2yerTwJ/MJ7DWhCfYmC'),
  ('Nozom Admin', 'admin@nozom.local', 1, 'Admin',
   '$2b$10$WjinKgn7KFbdVWvGWn4kXeCbWbNhHo8nXk8zb1J3i9wMFGIhB1Spy');

-- Official content (Pages)
INSERT INTO pages (title, content, user_id, scope, department_id, status)
VALUES
  (
    'Employee Onboarding',
    'Basic onboarding information for new employees.',
    3, 'company', NULL, 'published'
  ),
  (
    'HR Leave Request Procedure',
    'HR staff process leave requests in the HR system within two working days.',
    4, 'department', 2, 'published'
  ),
  (
    'Notice Period Policy',
    'Draft update: the notice period changes from 3 weeks to 2 weeks.',
    3, 'company', NULL, 'draft'
  ),
  (
    'Old Expense Policy',
    'Replaced by the new expense policy.',
    3, 'company', NULL, 'archived'
  );

-- Community content (Posts)
INSERT INTO posts (title, content, user_id, scope, department_id, status)
VALUES
  (
    'Printer Troubleshooting',
    'Restart the printer and check the network connection.',
    1, 'company', NULL, 'published'
  ),
  (
    'Annual Leave Policy',
    'Employees should submit leave requests before the planned leave date.',
    2, 'company', NULL, 'published'
  ),
  (
    'Monthly Report Checklist',
    'Review totals before submitting the monthly report.',
    3, 'company', NULL, 'published'
  ),
  (
    'HR Payroll Calendar Notes',
    'Internal HR notes: payroll inputs close on the 20th of each month.',
    2, 'department', 2, 'published'
  ),
  (
    'VPN Setup Notes',
    'Work in progress: steps for configuring the VPN client.',
    1, 'company', NULL, 'draft'
  ),
  (
    'Old Printer Driver Guide',
    'Outdated driver installation steps.',
    1, 'company', NULL, 'archived'
  );

INSERT INTO tags (name)
VALUES
  ('IT'),
  ('HR'),
  ('Accounting'),
  ('Work Process');

INSERT INTO post_tags (post_id, tag_id)
VALUES
  (1, 1),
  (1, 4),
  (2, 2),
  (3, 3),
  (3, 4),
  (4, 2),
  (5, 1),
  (6, 1);

-- ---------------------------------------------------------------
-- Week 6 demo data (run after migration 005)
-- ---------------------------------------------------------------

-- "Projects" was offered by the Feed form but never existed as a tag.
INSERT INTO tags (name) VALUES ('Projects');

UPDATE users SET specialty = 'Network support' WHERE email = 'ali@nozom.local';
UPDATE users SET specialty = 'Payroll' WHERE email = 'ahmed@nozom.local';
UPDATE users SET specialty = 'Financial reporting' WHERE email = 'mona@nozom.local';
UPDATE users SET specialty = 'Platform administration' WHERE email = 'admin@nozom.local';

INSERT INTO comments (content, user_id, post_id, page_id)
VALUES
  -- on a company-wide published Post
  ('Remember to add the request in the HR system as well.', 2, 2, NULL),
  -- on an HR-only Post (hidden from other departments, also in Search)
  ('Payroll cut-off for December moves to the 18th.', 2, 4, NULL),
  -- on a Draft Post (never appears in Search)
  ('Draft note: add screenshots of the VPN client.', 1, 5, NULL),
  -- on a published Official Page
  ('Onboarding checklist was reviewed this quarter.', 3, NULL, 1);

INSERT INTO bookmarks (user_id, page_id) VALUES (1, 1);
