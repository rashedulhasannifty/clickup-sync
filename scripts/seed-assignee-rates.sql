-- Idempotent import of assignee rates supplied 2026-06-01.
-- Conflict key: (assignee_id, valid_from). Re-runnable.
-- valid_to is INCLUSIVE (closed-closed interval). NULL = open-ended.
-- Currency stored as given (USD).
-- Note: Emran (89181001) was supplied twice (identical) -> listed once below.

INSERT INTO assignee_rates
  (assignee_id, assignee_name, assignee_email, currency, hourly_rate_cents, valid_from, valid_to)
VALUES
  ('242630708', 'Shoabur Rahman Chishty', 'chishty@niftyitsolution.com', 'USD',  138, '2025-10-01', '2026-01-01'),
  ('3584055',   'Ahmad',                  'ahmad@niftybookkeepers.com',  'USD', 1500, '2025-10-01', '2025-12-31'),
  ('101497582', 'Sayem Billah',           'sayem@niftyitsolution.com',   'USD',  163, '2025-09-29', '2026-01-01'),
  ('242494656', 'Rashedul Hasan',         'rashedul@niftyitsolution.com','USD',  215, '2025-09-29', '2025-10-31'),
  ('89424869',  'Md Rejaur Rahman',       'rejaur@niftyitsolution.com',  'USD',  337, '2025-09-01', NULL),
  ('49377103',  'Zahidul Hoque Fahim',    'fahim@niftyitsolution.com',   'USD', 1200, '2025-09-01', '2025-12-31'),
  ('89684220',  'Md Ontor',               'ontor@niftyitsolution.com',   'USD',  800, '2025-09-01', NULL),
  ('89181001',  'Md. Al - Emran',         'emran@niftyitsolution.com',   'USD',  732, '2025-09-01', NULL),
  ('62407386',  'Al Amin Khan',           'alaminkhan@niftyitsolution.com','USD', 407, '2025-09-01', '2025-11-30'),
  ('89550579',  'Hello Ahmad',            'hello@ahmadsyed.net',         'USD',  100, '2025-02-01', NULL),
  ('101442787', 'Hamid',                  'hamid.blinto@gmail.com',      'USD',  400, '2025-09-01', NULL),
  ('101485026', 'Mohammad Jahid Hasan',   'jahid@niftyitsolution.com',   'USD',  385, '2025-09-01', NULL),
  ('101425826', 'Nuruddin Kawsar',        'kawsar@niftyitsolution.com',  'USD',  440, '2025-09-01', NULL),
  ('95582076',  'Rafsan',                 'rafsan.blinto@gmail.com',     'USD',  400, '2025-09-01', NULL),
  ('95624160',  'Juhaer Al Mahbub',       'mahbub@niftyitsolution.com',  'USD',  130, '2025-09-01', NULL),
  ('95653981',  'Sultan Mahmud',          'sultan@niftyitsolution.com',  'USD',  324, '2025-09-01', NULL),
  ('95482729',  'Lutfor Rahman',          'lutfor@niftyitsolution.com',  'USD',  385, '2025-09-01', NULL),
  ('95455530',  'Dewan Ashfaqur Rahman',  'ashfaqur@niftyitsolution.com','USD',  320, '2025-09-01', '2026-03-31'),
  ('55285216',  'Toufiqul Islam',         'toufiqul@niftyitsolution.com','USD',  390, '2025-09-01', NULL),
  ('89628378',  'Mehrab Tanvir',          'tanvir@niftyitsolution.com',  'USD',  289, '2025-09-01', '2026-03-31'),
  ('89502136',  'Rabeya Sultana Rumi',    'rumi@niftyitsolution.com',    'USD',  284, '2025-09-01', NULL),
  ('89423834',  'Md Saiful Islam',        'saiful.jsm@gmail.com',        'USD', 2000, '2025-09-01', NULL),
  ('67358321',  'Zamema Khan',            'zamema@niftyitsolution.com',  'USD',  295, '2025-09-01', NULL),
  ('54569564',  'Shaon Saha',             'shaon@niftyitsolution.com',   'USD',  342, '2025-09-01', NULL),
  ('55219835',  'Sk. Nayem',              'niftyitsolutionltd.sk@gmail.com','USD', 252, '2025-09-01', NULL),
  ('49376247',  'Mahmuda Sultana',        'mahmuda@techenrage.com',      'USD',  433, '2025-09-01', NULL),
  ('3584157',   'Fuad Al Nahhean',        'fuad@niftybookkeepers.com',   'USD', 1400, '2025-09-01', NULL),
  ('89613428',  'Md. Zahidul Islam Rabin','zahidul@niftyitsolution.com', 'USD',  330, '2025-09-01', '2025-12-31'),
  ('242494656', 'Rashedul Hasan',         'rashedul@niftyitsolution.com','USD',  163, '2025-11-01', '2026-01-01'),
  ('49377103',  'Zahidul Hoque Fahim',    'fahim@niftyitsolution.com',   'USD', 1830, '2026-01-01', NULL),
  ('62407386',  'Al Amin Khan',           'alaminkhan@niftyitsolution.com','USD', 500, '2025-12-01', NULL),
  ('242630708', 'Shoabur Rahman Chishty', 'chishty@niftyitsolution.com', 'USD',  282, '2026-02-01', NULL),
  ('101497582', 'Sayem Billah',           'sayem@niftyitsolution.com',   'USD',  282, '2026-02-01', NULL),
  ('242494656', 'Rashedul Hasan',         'rashedul@niftyitsolution.com','USD',  295, '2026-02-01', NULL),
  ('62407388',  'Azizul Haque Jany',      'jany@niftyitsolution.com',    'USD',  410, '2026-01-01', NULL),
  ('89613428',  'Md. Zahidul Islam Rabin','zahidul@niftyitsolution.com', 'USD',  370, '2026-01-01', NULL),
  ('3584055',   'Ahmad',                  'ahmad@niftybookkeepers.com',  'USD', 2000, '2026-01-01', NULL),
  ('107690612', 'Md Mamun',               'engrmymoonbd@gmail.com',      'USD', 3000, '2026-01-01', NULL),
  ('89628378',  'Mehrab Tanvir',          'tanvir@niftyitsolution.com',  'USD',  329, '2026-04-01', NULL),
  ('95455530',  'Dewan Ashfaqur Rahman',  'ashfaqur@niftyitsolution.com','USD',  326, '2026-04-01', NULL)
ON CONFLICT (assignee_id, valid_from) DO UPDATE SET
  assignee_name     = EXCLUDED.assignee_name,
  assignee_email    = EXCLUDED.assignee_email,
  currency          = EXCLUDED.currency,
  hourly_rate_cents = EXCLUDED.hourly_rate_cents,
  valid_to          = EXCLUDED.valid_to,
  updated_at        = now();
