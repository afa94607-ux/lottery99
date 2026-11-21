import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashPassword } from '../server/security';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DB_NAME = 'lottery888-db-staging';
const WRANGLER_CONFIG = path.resolve(ROOT_DIR, 'workers/lottery888-api/wrangler.toml');
const TMP_SEED_SQL = path.resolve(ROOT_DIR, 'workers/lottery888-api/.tmp-staging-seed.sql');

async function main() {
  const now = Date.now();
  const ownerHash = hashPassword('StagingOwner#2026');
  const playerHash = hashPassword('StagingPlayer#2026');

  const lines = [
    '-- Synthetic staging seed ONLY (no real accounts, hashes, or player data)',
    `INSERT OR REPLACE INTO accounts (id, username, username_lower, name, role, password_hash, balance, credit_limit, status, commission_rate, notes, created_at, updated_at) VALUES ('STG_OWNER_01', 'staging_owner', 'staging_owner', 'Staging Owner', 'OWNER', '${ownerHash}', 0, 0, 'ACTIVE', 0, 'Synthetic staging owner', '2026-11-21', ${now});`,
    `INSERT OR REPLACE INTO accounts (id, username, username_lower, name, role, password_hash, balance, credit_limit, status, commission_rate, notes, created_at, updated_at) VALUES ('STG_PLAYER_01', 'staging_player1', 'staging_player1', 'Staging Player 1', 'PLAYER', '${playerHash}', 100000, 2000000, 'ACTIVE', 0, 'Synthetic staging player', '2026-11-21', ${now});`,
    `INSERT OR REPLACE INTO system_config (id, payout_rate, draw_interval_seconds, min_bet_amount, max_bet_amount, is_system_open, auto_draw_enabled, forced_numbers_json, current_round_number, round_start_time, round_end_time, is_drawing, active_draw_json) VALUES (1, 90, 300, 100, 5000000, 1, 1, NULL, 149, ${now}, ${now + 300000}, 0, NULL);`,
    `INSERT OR IGNORE INTO rounds (round_id, draw_time, date, num_a, num_b, num_c, num_d, num_e, timestamp, settled) VALUES ('26292#148', '12:58', '21-11-2026', '48', '92', '83', '17', '28', ${now - 300000}, 1);`,
    `INSERT OR IGNORE INTO rounds (round_id, draw_time, date, num_a, num_b, num_c, num_d, num_e, timestamp, settled) VALUES ('26292#147', '12:53', '21-11-2026', '89', '85', '94', '80', '97', ${now - 600000}, 1);`,
  ];

  fs.writeFileSync(TMP_SEED_SQL, lines.join('\n'), 'utf8');
  try {
    execFileSync(
      'cmd.exe',
      [
        '/c',
        'npx',
        'wrangler',
        'd1',
        'execute',
        DB_NAME,
        '--remote',
        '--config',
        WRANGLER_CONFIG,
        '--file',
        TMP_SEED_SQL,
      ],
      { cwd: ROOT_DIR, stdio: 'inherit' }
    );
    console.log('[STAGING SEED] Synthetic staging data applied to lottery888-db-staging.');
  } finally {
    if (fs.existsSync(TMP_SEED_SQL)) {
      fs.unlinkSync(TMP_SEED_SQL);
    }
  }
}

main().catch((err) => {
  console.error('[STAGING SEED ERROR]', err instanceof Error ? err.message : err);
  process.exit(1);
});
