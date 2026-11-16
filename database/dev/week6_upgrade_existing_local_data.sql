-- ONE-TIME helper for an EXISTING local database created before Week 6.
-- (A clean database does not need this: migrations + seed.sql include it.)
-- Run after migration 005. Safe to run more than once.

BEGIN;

INSERT INTO tags (name) VALUES ('Projects') ON CONFLICT (name) DO NOTHING;

UPDATE users SET specialty = 'Network support'
WHERE email = 'ali@nozom.local' AND specialty IS NULL;
UPDATE users SET specialty = 'Payroll'
WHERE email = 'ahmed@nozom.local' AND specialty IS NULL;
UPDATE users SET specialty = 'Financial reporting'
WHERE email = 'mona@nozom.local' AND specialty IS NULL;
UPDATE users SET specialty = 'Platform administration'
WHERE email = 'admin@nozom.local' AND specialty IS NULL;

INSERT INTO comments (content, user_id, post_id)
SELECT 'Remember to add the request in the HR system as well.',
  (SELECT id FROM users WHERE email = 'ahmed@nozom.local'), p.id
FROM posts p
WHERE p.title = 'Annual Leave Policy'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id
                  AND c.content = 'Remember to add the request in the HR system as well.');

INSERT INTO comments (content, user_id, post_id)
SELECT 'Payroll cut-off for December moves to the 18th.',
  (SELECT id FROM users WHERE email = 'ahmed@nozom.local'), p.id
FROM posts p
WHERE p.title = 'HR Payroll Calendar Notes'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id
                  AND c.content = 'Payroll cut-off for December moves to the 18th.');

INSERT INTO comments (content, user_id, post_id)
SELECT 'Draft note: add screenshots of the VPN client.',
  (SELECT id FROM users WHERE email = 'ali@nozom.local'), p.id
FROM posts p
WHERE p.title = 'VPN Setup Notes'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id
                  AND c.content = 'Draft note: add screenshots of the VPN client.');

INSERT INTO comments (content, user_id, page_id)
SELECT 'Onboarding checklist was reviewed this quarter.',
  (SELECT id FROM users WHERE email = 'mona@nozom.local'), pg.id
FROM pages pg
WHERE pg.title = 'Employee Onboarding'
  AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.page_id = pg.id
                  AND c.content = 'Onboarding checklist was reviewed this quarter.');

INSERT INTO bookmarks (user_id, page_id)
SELECT u.id, pg.id
FROM users u, pages pg
WHERE u.email = 'ali@nozom.local' AND pg.title = 'Employee Onboarding'
ON CONFLICT DO NOTHING;

COMMIT;
