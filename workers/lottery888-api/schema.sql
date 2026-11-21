-- Lottery888 (1/99) D1 Schema (matches data/lottery888.sqlite + persisted draw state)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  username_lower TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('OWNER', 'PLAYER')),
  password_hash TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  credit_limit INTEGER NOT NULL DEFAULT 2000000,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED')),
  commission_rate REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('OWNER', 'PLAYER')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rounds (
  round_id TEXT PRIMARY KEY,
  draw_time TEXT NOT NULL,
  date TEXT NOT NULL,
  num_a TEXT NOT NULL,
  num_b TEXT NOT NULL,
  num_c TEXT NOT NULL,
  num_d TEXT NOT NULL,
  num_e TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  settled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bet_tickets (
  ticket_id TEXT PRIMARY KEY,
  client_request_id TEXT UNIQUE,
  user_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  channels_json TEXT NOT NULL,
  numbers_json TEXT NOT NULL,
  stake_per_unit INTEGER NOT NULL CHECK(stake_per_unit > 0),
  total_bets_count INTEGER NOT NULL CHECK(total_bets_count > 0),
  total_cost INTEGER NOT NULL CHECK(total_cost > 0),
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'WON', 'LOST', 'VOID')),
  won_amount INTEGER NOT NULL DEFAULT 0 CHECK(won_amount >= 0),
  winning_hits_json TEXT NOT NULL DEFAULT '[]',
  settled_at INTEGER,
  payout_credited INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount >= 0),
  previous_balance INTEGER NOT NULL CHECK(previous_balance >= 0),
  new_balance INTEGER NOT NULL CHECK(new_balance >= 0),
  payment_method TEXT NOT NULL,
  note TEXT,
  admin_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  payout_rate INTEGER NOT NULL DEFAULT 91,
  draw_interval_seconds INTEGER NOT NULL DEFAULT 300,
  min_bet_amount INTEGER NOT NULL DEFAULT 100,
  max_bet_amount INTEGER NOT NULL DEFAULT 5000000,
  is_system_open INTEGER NOT NULL DEFAULT 1,
  auto_draw_enabled INTEGER NOT NULL DEFAULT 1,
  forced_numbers_json TEXT,
  current_round_number INTEGER NOT NULL DEFAULT 149,
  round_start_time INTEGER NOT NULL,
  round_end_time INTEGER NOT NULL,
  is_drawing INTEGER NOT NULL DEFAULT 0,
  active_draw_json TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  details TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON bet_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user_timestamp ON bet_tickets(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_timestamp ON bet_tickets(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_round_status ON bet_tickets(round_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_timestamp ON transactions(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_active ON sessions(token, revoked, expires_at);
CREATE INDEX IF NOT EXISTS idx_rounds_timestamp ON rounds(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
