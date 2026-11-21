import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function findLocalD1Sqlite(): string {
  const d1Dir = path.resolve(
    ROOT_DIR,
    'workers/lottery888-api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
  );
  if (!fs.existsSync(d1Dir)) {
    throw new Error(`Local D1 directory not found: ${d1Dir}`);
  }
  const files = fs.readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite'));
  if (files.length === 0) {
    throw new Error(`No .sqlite file found in ${d1Dir}`);
  }
  // Pick largest/most recent sqlite file
  return files
    .map((f) => ({ path: path.join(d1Dir, f), size: fs.statSync(path.join(d1Dir, f)).size }))
    .sort((a, b) => b.size - a.size)[0].path;
}

async function main() {
  const dbPath = findLocalD1Sqlite();
  const SQL = await initSqlJs({
    useOldExtensionFunctions: false,
    locateFile: (file: string) => path.resolve(ROOT_DIR, 'node_modules/sql.js/dist', file),
  });
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const counts: Record<string, number> = {};
  for (const t of [
    'accounts',
    'sessions',
    'rounds',
    'bet_tickets',
    'transactions',
    'system_config',
    'audit_logs',
  ]) {
    counts[t] = Number(db.exec(`SELECT COUNT(*) FROM ${t}`)[0]?.values?.[0]?.[0] || 0);
  }
  console.log('[D1 TABLE COUNTS]', JSON.stringify(counts));

  const queries = [
    {
      name: 'getAllTickets (LIMIT 500)',
      sql: 'SELECT t.*, a.username FROM bet_tickets t LEFT JOIN accounts a ON a.id = t.user_id ORDER BY t.timestamp DESC LIMIT 500',
    },
    {
      name: 'getAllTransactions (LIMIT 500)',
      sql: 'SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 500',
    },
    {
      name: 'getPlayerTickets (LIMIT 10000)',
      sql: "SELECT t.*, a.username FROM bet_tickets t LEFT JOIN accounts a ON a.id = t.user_id WHERE t.user_id = 'USR_1' ORDER BY t.timestamp DESC LIMIT 10000",
    },
    {
      name: 'getPlayerTransactions (LIMIT 200)',
      sql: "SELECT * FROM transactions WHERE user_id = 'USR_1' ORDER BY timestamp DESC LIMIT 200",
    },
    {
      name: 'getRoundTickets (live admin)',
      sql: "SELECT t.*, a.username FROM bet_tickets t LEFT JOIN accounts a ON a.id = t.user_id WHERE t.round_id = '26292#250' ORDER BY t.timestamp DESC LIMIT 100",
    },
    {
      name: 'verifySession',
      sql: "SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = 'tok' AND s.revoked = 0 AND s.expires_at > 0 LIMIT 1",
    },
  ];

  console.log('\n=== EXPLAIN QUERY PLAN (WITHOUT NEW INDEXES) ===');
  for (const q of queries) {
    const plan = db.exec(`EXPLAIN QUERY PLAN ${q.sql}`)[0]?.values || [];
    console.log(`- ${q.name}: ${plan.map((r) => r[3]).join(' | ')}`);
  }

  // Apply the 5 new indexes in memory only to compare EXPLAIN QUERY PLAN
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_tickets_user_timestamp ON bet_tickets(user_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_timestamp ON bet_tickets(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_timestamp ON transactions(user_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_active ON sessions(token, revoked, expires_at);
  `);

  console.log('\n=== EXPLAIN QUERY PLAN (WITH NEW INDEXES) ===');
  for (const q of queries) {
    const plan = db.exec(`EXPLAIN QUERY PLAN ${q.sql}`)[0]?.values || [];
    console.log(`- ${q.name}: ${plan.map((r) => r[3]).join(' | ')}`);
  }

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
