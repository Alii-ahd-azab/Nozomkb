-- ONE-TIME helper for an EXISTING local database that was seeded before Week 5.
-- (A clean database does not need this: migrations + seed.sql already include it.)
--
-- Run after migration 004. Safe to run more than once.
-- TRAINING-ONLY: sets the shared local test password (bcrypt hash only) for the
-- seeded users, assigns test roles, and adds Week 5 demo content.

BEGIN;

-- Test roles and password hashes for the existing seeded users.
UPDATE users SET role = 'Member',
  password_hash = '$2b$10$AvQrOfeGoembEKyhzk.x3ubEUSQ3TGMX.KHgUGOFaziHcaIaOOqvu'
WHERE email = 'ali@nozom.local';

UPDATE users SET role = 'Member',
  password_hash = '$2b$10$8aYTgKpMKM29UMisaBcd3ejGZfj8mvlAlaoIdLZ08si0f51q/Z.ze'
WHERE email = 'ahmed@nozom.local';

UPDATE users SET role = 'Editor',
  password_hash = '$2b$10$iM91Xzo4dFHFcNFG7oL/iufiAAHlfxNd5H2yerTwJ/MJ7DWhCfYmC'
WHERE email = 'mona@nozom.local';

-- Admin account (created by an administrator/seed, never by self-registration).
INSERT INTO users (name, email, department_id, role, password_hash)
SELECT 'Nozom Admin', 'admin@nozom.local', d.id, 'Admin',
  '$2b$10$WjinKgn7KFbdVWvGWn4kXeCbWbNhHo8nXk8zb1J3i9wMFGIhB1Spy'
FROM departments d
WHERE d.name = 'IT'
ON CONFLICT (email) DO NOTHING;

-- Demo Official Pages.
INSERT INTO pages (title, content, user_id, scope, department_id, status)
SELECT 'HR Leave Request Procedure',
  'HR staff process leave requests in the HR system within two working days.',
  (SELECT id FROM users WHERE email = 'admin@nozom.local'),
  'department', (SELECT id FROM departments WHERE name = 'HR'), 'published'
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE title = 'HR Leave Request Procedure');

INSERT INTO pages (title, content, user_id, scope, department_id, status)
SELECT 'Notice Period Policy',
  'Draft update: the notice period changes from 3 weeks to 2 weeks.',
  (SELECT id FROM users WHERE email = 'mona@nozom.local'),
  'company', NULL, 'draft'
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE title = 'Notice Period Policy');

INSERT INTO pages (title, content, user_id, scope, department_id, status)
SELECT 'Old Expense Policy',
  'Replaced by the new expense policy.',
  (SELECT id FROM users WHERE email = 'mona@nozom.local'),
  'company', NULL, 'archived'
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE title = 'Old Expense Policy');

-- Demo Community Posts.
INSERT INTO posts (title, content, user_id, scope, department_id, status)
SELECT 'HR Payroll Calendar Notes',
  'Internal HR notes: payroll inputs close on the 20th of each month.',
  (SELECT id FROM users WHERE email = 'ahmed@nozom.local'),
  'department', (SELECT id FROM departments WHERE name = 'HR'), 'published'
WHERE NOT EXISTS (SELECT 1 FROM posts WHERE title = 'HR Payroll Calendar Notes');

INSERT INTO posts (title, content, user_id, scope, department_id, status)
SELECT 'VPN Setup Notes',
  'Work in progress: steps for configuring the VPN client.',
  (SELECT id FROM users WHERE email = 'ali@nozom.local'),
  'company', NULL, 'draft'
WHERE NOT EXISTS (SELECT 1 FROM posts WHERE title = 'VPN Setup Notes');

INSERT INTO posts (title, content, user_id, scope, department_id, status)
SELECT 'Old Printer Driver Guide',
  'Outdated driver installation steps.',
  (SELECT id FROM users WHERE email = 'ali@nozom.local'),
  'company', NULL, 'archived'
WHERE NOT EXISTS (SELECT 1 FROM posts WHERE title = 'Old Printer Driver Guide');

INSERT INTO post_tags (post_id, tag_id)
SELECT p.id, t.id
FROM posts p
JOIN tags t ON
  (p.title = 'HR Payroll Calendar Notes' AND t.name = 'HR')
  OR (p.title IN ('VPN Setup Notes', 'Old Printer Driver Guide') AND t.name = 'IT')
ON CONFLICT DO NOTHING;

COMMIT;
