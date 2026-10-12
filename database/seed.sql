INSERT INTO departments (name)
VALUES
  ('IT'),
  ('HR'),
  ('Accounting');

INSERT INTO users (name, email, department_id)
VALUES
  ('Ali', 'ali@nozom.local', 1),
  ('Ahmed', 'ahmed@nozom.local', 2),
  ('Mona', 'mona@nozom.local', 3);

INSERT INTO pages (title, content, user_id)
VALUES
  (
    'Employee Onboarding',
    'Basic onboarding information for new employees.',
    2
  );

INSERT INTO posts (title, content, user_id)
VALUES
  (
    'Printer Troubleshooting',
    'Restart the printer and check the network connection.',
    1
  ),
  (
    'Annual Leave Policy',
    'Employees should submit leave requests before the planned leave date.',
    2
  ),
  (
    'Monthly Report Checklist',
    'Review totals before submitting the monthly report.',
    3
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
  (3, 4);