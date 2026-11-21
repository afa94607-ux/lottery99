import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

interface AggregateSnapshot {
  accountsCount: number;
  accountsBalanceSum: number;
  sessionsCount: number;
  roundsCount: number;
  ticketsCount: number;
  ticketsCostSum: number;
  ticketsWonSum: number;
  transactionsCount: number;
  transactionsAmountSum: number;
  systemConfigCount: number;
  payoutRate: number;
  drawIntervalSeconds: number;
  currentRoundNumber: number;
  auditLogsCount: number;
}

function queryD1Json(
  dbName: string,
  wranglerConfig: string,
  mode: 'local' | 'remote',
  sql: string
): Record<string, unknown>[] {
  const args = [
    'wrangler',
    'd1',
    'execute',
    dbName,
    mode === 'local' ? '--local' : '--remote',
    '--config',
    wranglerConfig,
    '--json',
    '--command',
    sql,
  ];
  const raw = execFileSync('cmd.exe', ['/c', 'npx', ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(raw);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results || [];
}

async function main() {
  const sqlitePath = path.resolve(
    ROOT_DIR,
    parseArg('--sqlite') || 'data/lottery888.sqlite'
  );
  const dbName = parseArg('--db') || 'lottery888-db-staging';
  const mode = parseArg('--remote') ? 'remote' : 'local';
  const wranglerConfig = path.resolve(
    ROOT_DIR,
    parseArg('--config') || 'workers/lottery888-api/wrangler.toml'
  );

  const SQL = await initSqlJs({
    useOldExtensionFunctions: false,
    locateFile: (file: string) => {
      const localWasm = path.resolve(ROOT_DIR, 'node_modules/sql.js/dist', file);
      if (fs.existsSync(localWasm)) return localWasm;
      return file;
    },
  });
  const sdb = new SQL.Database(fs.readFileSync(sqlitePath));

  const sVal = (sql: string): Record<string, number> => {
    const res = sdb.exec(sql);
    if (!res || !res[0] || !res[0].values[0]) return {};
    const obj: Record<string, number> = {};
    res[0].columns.forEach((c, i) => {
      obj[c] = Number(res[0].values[0][i] || 0);
    });
    return obj;
  };

  const sAcc = sVal('SELECT COUNT(*) AS cnt, COALESCE(SUM(balance), 0) AS bal FROM accounts');
  const sSes = sVal('SELECT COUNT(*) AS cnt FROM sessions');
  const sRnd = sVal('SELECT COUNT(*) AS cnt FROM rounds');
  const sTik = sVal(
    'SELECT COUNT(*) AS cnt, COALESCE(SUM(total_cost), 0) AS cost, COALESCE(SUM(won_amount), 0) AS won FROM bet_tickets'
  );
  const sTx = sVal('SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS amt FROM transactions');
  const sCfg = sVal(
    'SELECT COUNT(*) AS cnt, payout_rate, draw_interval_seconds, current_round_number FROM system_config WHERE id = 1'
  );
  const sAud = sVal('SELECT COUNT(*) AS cnt FROM audit_logs');

  if (process.argv.includes('--audit-sqlite')) {
    const intCheck = sdb.exec('PRAGMA integrity_check;')[0]?.values?.[0]?.[0];
    const accRows = sdb.exec(
      "SELECT role, status, balance, CASE WHEN password_hash LIKE 'scrypt$%' THEN 1 ELSE 0 END AS scrypt_ok FROM accounts"
    )[0]?.values || [];
    const txByType = sdb.exec(
      'SELECT type, COUNT(*), COALESCE(SUM(amount), 0) FROM transactions GROUP BY type'
    )[0]?.values || [];
    const latestTx = sdb.exec(
      'SELECT t.type, t.new_balance FROM transactions t INNER JOIN (SELECT user_id, MAX(timestamp) AS mt FROM transactions GROUP BY user_id) m ON t.user_id=m.user_id AND t.timestamp=m.mt'
    )[0]?.values || [];
    console.log('[AUDIT] integrity_check:', intCheck);
    console.log('[AUDIT] accounts (role, status, balance, scrypt_ok):', JSON.stringify(accRows));
    console.log('[AUDIT] transactions by type:', JSON.stringify(txByType));
    console.log('[AUDIT] latest transaction new_balance per user:', JSON.stringify(latestTx));
    console.log('[AUDIT] counts:', JSON.stringify({
      accounts: sAcc.cnt,
      sessions: sSes.cnt,
      rounds: sRnd.cnt,
      bet_tickets: sTik.cnt,
      transactions: sTx.cnt,
      system_config: sCfg.cnt,
      audit_logs: sAud.cnt,
    }));
    sdb.close();
    return;
  }

  sdb.close();

  const excludeSessions = process.argv.includes('--exclude-sessions');
  const source: AggregateSnapshot = {
    accountsCount: sAcc.cnt,
    accountsBalanceSum: sAcc.bal,
    sessionsCount: excludeSessions ? 0 : sSes.cnt,
    roundsCount: sRnd.cnt,
    ticketsCount: sTik.cnt,
    ticketsCostSum: sTik.cost,
    ticketsWonSum: sTik.won,
    transactionsCount: sTx.cnt,
    transactionsAmountSum: sTx.amt,
    systemConfigCount: sCfg.cnt,
    payoutRate: sCfg.payout_rate,
    drawIntervalSeconds: sCfg.draw_interval_seconds,
    currentRoundNumber: sCfg.current_round_number,
    auditLogsCount: sAud.cnt,
  };

  const dAcc = queryD1Json(
    dbName,
    wranglerConfig,
    mode,
    'SELECT COUNT(*) AS cnt, COALESCE(SUM(balance), 0) AS bal FROM accounts'
  )[0] || {};
  const dSes = queryD1Json(dbName, wranglerConfig, mode, 'SELECT COUNT(*) AS cnt FROM sessions')[0] || {};
  const dRnd = queryD1Json(dbName, wranglerConfig, mode, 'SELECT COUNT(*) AS cnt FROM rounds')[0] || {};
  const dTik =
    queryD1Json(
      dbName,
      wranglerConfig,
      mode,
      'SELECT COUNT(*) AS cnt, COALESCE(SUM(total_cost), 0) AS cost, COALESCE(SUM(won_amount), 0) AS won FROM bet_tickets'
    )[0] || {};
  const dTx =
    queryD1Json(
      dbName,
      wranglerConfig,
      mode,
      'SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS amt FROM transactions'
    )[0] || {};
  const dCfg =
    queryD1Json(
      dbName,
      wranglerConfig,
      mode,
      'SELECT COUNT(*) AS cnt, payout_rate, draw_interval_seconds, current_round_number FROM system_config WHERE id = 1'
    )[0] || {};
  const dAud =
    queryD1Json(dbName, wranglerConfig, mode, 'SELECT COUNT(*) AS cnt FROM audit_logs')[0] || {};

  const target: AggregateSnapshot = {
    accountsCount: Number(dAcc.cnt || 0),
    accountsBalanceSum: Number(dAcc.bal || 0),
    sessionsCount: Number(dSes.cnt || 0),
    roundsCount: Number(dRnd.cnt || 0),
    ticketsCount: Number(dTik.cnt || 0),
    ticketsCostSum: Number(dTik.cost || 0),
    ticketsWonSum: Number(dTik.won || 0),
    transactionsCount: Number(dTx.cnt || 0),
    transactionsAmountSum: Number(dTx.amt || 0),
    systemConfigCount: Number(dCfg.cnt || 0),
    payoutRate: Number(dCfg.payout_rate || 0),
    drawIntervalSeconds: Number(dCfg.draw_interval_seconds || 0),
    currentRoundNumber: Number(dCfg.current_round_number || 0),
    auditLogsCount: Number(dAud.cnt || 0),
  };

  let allMatch = true;
  console.log(`[VERIFY] Comparing SQLite vs D1 (${dbName}, mode=${mode}):`);
  for (const key of Object.keys(source) as Array<keyof AggregateSnapshot>) {
    const ok = source[key] === target[key];
    if (!ok) allMatch = false;
    console.log(`  - ${key}: sqlite=${source[key]} d1=${target[key]} => ${ok ? 'PASS' : 'FAIL'}`);
  }

  if (!allMatch) {
    process.exit(1);
  }
  console.log('[VERIFY] ALL MIGRATION INTEGRITY CHECKS PASSED.');
}

main().catch((err) => {
  console.error('[VERIFY ERROR]', err instanceof Error ? err.message : err);
  process.exit(1);
});
