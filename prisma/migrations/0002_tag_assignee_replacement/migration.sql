CREATE TABLE IF NOT EXISTS tag_assignee_map (
  id BIGSERIAL PRIMARY KEY,
  tag_name TEXT NOT NULL UNIQUE,
  clickup_user_id TEXT NOT NULL,
  clickup_user_name TEXT,
  clickup_email TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS time_entry_replacements (
  id BIGSERIAL PRIMARY KEY,
  original_entry_id TEXT NOT NULL UNIQUE,
  replacement_entry_id TEXT,
  task_id TEXT,
  original_user_id TEXT,
  replaced_user_id TEXT,
  tag_name TEXT,
  status TEXT NOT NULL DEFAULT 'replaced',
  error_message TEXT,
  replaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ter_task_id ON time_entry_replacements(task_id);
CREATE INDEX IF NOT EXISTS idx_ter_original_user_id ON time_entry_replacements(original_user_id);

-- Seed known tag→user mappings (agency user = 3584055 / Ahmad)
INSERT INTO tag_assignee_map (tag_name, clickup_user_id, clickup_user_name, clickup_email, active)
VALUES
  ('ahmad',    '3584055',   'Ahmad',                  'ahmad@niftybookkeepers.com',  true),
  ('chisty',   '242630708', 'Shoabur Rahman Chishty', 'chishty@niftyitsolution.com', true),
  ('fahim',    '49377103',  'Zahidul Hoque Fahim',    'fahim@niftyitsolution.com',   true),
  ('rashedul', '242494656', 'Rashedul Hasan',         'rashedul@niftyitsolution.com',true),
  ('rejaur',   '89424869',  'Md Rejaur Rahman',       'rejaur@niftyitsolution.com',  true),
  ('sayem',    '101497582', 'Sayem Billah',            'sayem@niftyitsolution.com',   true)
ON CONFLICT (tag_name) DO NOTHING;
