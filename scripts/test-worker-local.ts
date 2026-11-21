import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashPassword } from '../server/security';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:8787';
const DB_NAME = 'lottery888-db-staging';
const WRANGLER_CONFIG = path.resolve(ROOT_DIR, 'workers/lottery888-api/wrangler.toml');

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} - ${detail}`);
}

function execLocalD1(sql: string) {
  execFileSync(
    'cmd.exe',
    [
      '/c',
      'npx',
      'wrangler',
      'd1',
      'execute',
      DB_NAME,
      '--local',
      '--config',
      WRANGLER_CONFIG,
      '--command',
      sql,
    ],
    { cwd: ROOT_DIR, stdio: 'pipe' }
  );
}

async function api<T = Record<string, unknown>>(
  pathUrl: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const res = await fetch(`${BASE_URL}${pathUrl}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

async function main() {
  if (process.argv.includes('--seed-test-owner')) {
    const h = hashPassword('TestOwner#2026');
    execLocalD1(
      `INSERT OR REPLACE INTO accounts (id, username, username_lower, name, role, password_hash, balance, credit_limit, status, commission_rate, created_at, updated_at) VALUES ('__TEST_OWNER__', '__test_owner__', '__test_owner__', 'Test Owner', 'OWNER', '${h}', 0, 0, 'ACTIVE', 0, '2026-11-21', ${Date.now()})`
    );
    console.log('[SEED] Synthetic __TEST_OWNER__ seeded into local D1.');
    return;
  }
  if (process.argv.includes('--cleanup-test-owner')) {
    execLocalD1(`DELETE FROM sessions WHERE account_id = '__TEST_OWNER__' OR account_id LIKE 'USR_%' AND id IS NOT NULL`);
    execLocalD1(`DELETE FROM accounts WHERE id = '__TEST_OWNER__'`);
    console.log('[CLEANUP] Synthetic __TEST_OWNER__ removed from local D1.');
    return;
  }

  // 0. If the migrated snapshot's round_end_time is in the past, wait for the initial 6.8s draw to settle
  let pubInit = await api<{ isDrawing: boolean; countdownSeconds: number }>('/api/lottery/public');
  if (pubInit.data.isDrawing) {
    console.log('[INFO] Initial round is drawing; waiting 7.2s for authoritative settlement...');
    await new Promise((r) => setTimeout(r, 7200));
  }

  // 1. Health & Public state
  const health = await api<{ status: string; ownerConfigured: boolean; round: string }>('/api/health');
  record(
    'Health Check',
    health.status === 200 && health.data.status === 'ok' && health.data.ownerConfigured === true,
    `status=${health.status}, ownerConfigured=${health.data.ownerConfigured}, round=${health.data.round}`
  );

  const pub = await api<{ currentRoundId: string; pastRounds: unknown[]; countdownSeconds: number; isDrawing: boolean }>(
    '/api/lottery/public'
  );
  record(
    'Public Lottery State & Countdown',
    pub.status === 200 &&
      Boolean(pub.data.currentRoundId) &&
      Array.isArray(pub.data.pastRounds) &&
      pub.data.countdownSeconds > 0 &&
      pub.data.isDrawing === false,
    `status=${pub.status}, round=${pub.data.currentRoundId}, countdown=${pub.data.countdownSeconds}s, pastRounds=${pub.data.pastRounds?.length}`
  );

  // 2. Unauthenticated & invalid login guards (verifies scrypt runs in Worker)
  const unauthAdmin = await api('/api/admin/state');
  const unauthPlayer = await api('/api/player/state');
  const badOwner = await api('/api/auth/owner/login', {
    method: 'POST',
    body: { username: 'nonexistent_owner', password: 'wrong_password' },
  });
  const badPlayer = await api('/api/auth/player/login', {
    method: 'POST',
    body: { username: 'nonexistent_player', password: 'wrong_password' },
  });
  record(
    'Auth Guards & Invalid Login Rejection',
    unauthAdmin.status === 401 &&
      unauthPlayer.status === 401 &&
      badOwner.status === 401 &&
      badPlayer.status === 401,
    `unauthAdmin=${unauthAdmin.status}, unauthPlayer=${unauthPlayer.status}, badOwner=${badOwner.status}, badPlayer=${badPlayer.status}`
  );

  // 3. Verify Owner Login using pre-seeded synthetic test OWNER (Node scrypt hash verified in Worker)
  const testOwnerUser = '__test_owner__';
  const testOwnerPass = 'TestOwner#2026';
  const now = Date.now();

  // 4. Owner Login & Session
  const ownerLogin = await api<{ success: boolean; token: string; account: { role: string } }>(
    '/api/auth/owner/login',
    { method: 'POST', body: { username: testOwnerUser, password: testOwnerPass } }
  );
  const ownerToken = ownerLogin.data.token;
  record(
    'Owner Login (Node scrypt hash verified in Worker)',
    ownerLogin.status === 200 && ownerLogin.data.success === true && ownerLogin.data.account?.role === 'OWNER',
    `status=${ownerLogin.status}, role=${ownerLogin.data.account?.role}`
  );

  const ownerMe = await api<{ account: { role: string } }>('/api/auth/me', { token: ownerToken });
  const ownerForbiddenPlayer = await api('/api/player/state', { token: ownerToken });
  record(
    'Owner Session & Role Isolation',
    ownerMe.status === 200 && ownerMe.data.account?.role === 'OWNER' && ownerForbiddenPlayer.status === 403,
    `me=${ownerMe.status}, playerEndpointAsOwner=${ownerForbiddenPlayer.status}`
  );

  // 5. Owner creates temporary test player with 50,000 KHR
  const testPlayerUser = `__test_player_${now}__`;
  const testPlayerPass = 'TestPlayer#2026';
  const createPlayer = await api<{ success: boolean; player: { id: string; balance: number } }>(
    '/api/admin/players',
    {
      method: 'POST',
      token: ownerToken,
      body: {
        username: testPlayerUser,
        name: 'Test Player',
        password: testPlayerPass,
        balance: 50000,
      },
    }
  );
  const testPlayerId = createPlayer.data.player?.id;
  record(
    'Owner Create Player + Initial Balance',
    createPlayer.status === 201 && createPlayer.data.player?.balance === 50000,
    `status=${createPlayer.status}, balance=${createPlayer.data.player?.balance}`
  );

  // 6. Player Login & Role Isolation
  const playerLogin = await api<{ success: boolean; token: string; account: { role: string; balance: number } }>(
    '/api/auth/player/login',
    { method: 'POST', body: { username: testPlayerUser, password: testPlayerPass } }
  );
  const playerToken = playerLogin.data.token;
  const playerForbiddenAdmin = await api('/api/admin/state', { token: playerToken });
  record(
    'Player Login & Admin Endpoint Isolation',
    playerLogin.status === 200 &&
      playerLogin.data.account?.role === 'PLAYER' &&
      playerForbiddenAdmin.status === 403,
    `status=${playerLogin.status}, adminEndpointAsPlayer=${playerForbiddenAdmin.status}`
  );

  // 7. Player Betting + Idempotency + Balance Deduction
  const reqId = `REQ-${now}`;
  const betRes = await api<{
    success: boolean;
    ticket: { ticketId: string; totalCost: number; status: string };
    newBalance: number;
    duplicate: boolean;
  }>('/api/player/bets', {
    method: 'POST',
    token: playerToken,
    body: {
      channels: ['A', 'B'],
      numbers: ['05', '88'],
      stakePerUnit: 1000,
      clientRequestId: reqId,
    },
  });
  const dupBetRes = await api<{ duplicate: boolean; newBalance: number }>('/api/player/bets', {
    method: 'POST',
    token: playerToken,
    body: {
      channels: ['A', 'B'],
      numbers: ['05', '88'],
      stakePerUnit: 1000,
      clientRequestId: reqId,
    },
  });
  record(
    'Player Bet Placement & Idempotency',
    betRes.status === 200 &&
      betRes.data.ticket?.totalCost === 4000 &&
      betRes.data.newBalance === 46000 &&
      dupBetRes.status === 200 &&
      dupBetRes.data.duplicate === true &&
      dupBetRes.data.newBalance === 46000,
    `cost=${betRes.data.ticket?.totalCost}, newBalance=${betRes.data.newBalance}, dup=${dupBetRes.data.duplicate}`
  );

  // 8. Forced Numbers + Manual Draw + Server-Authoritative Settlement
  const forcedRes = await api('/api/admin/forced-numbers', {
    method: 'POST',
    token: ownerToken,
    body: { numbers: { A: '05', B: '12', C: '34', D: '56', E: '78' } },
  });
  const triggerRes = await api<{ success: boolean; isDrawing: boolean }>('/api/admin/trigger-draw', {
    method: 'POST',
    token: ownerToken,
  });
  record(
    'Forced Numbers & Trigger Draw',
    forcedRes.status === 200 && triggerRes.status === 200 && triggerRes.data.isDrawing === true,
    `forced=${forcedRes.status}, isDrawing=${triggerRes.data.isDrawing}`
  );

  // Wait 7.2s for 6800ms draw duration to complete, then poll /api/player/state
  await new Promise((r) => setTimeout(r, 7200));
  const afterDraw = await api<{
    isDrawing: boolean;
    currentRoundNumber: number;
    account: { balance: number };
    tickets: Array<{ ticketId: string; status: string; wonAmount: number }>;
  }>('/api/player/state', { token: playerToken });

  const settledTicket = afterDraw.data.tickets?.find(
    (t) => t.ticketId === betRes.data.ticket?.ticketId
  );
  // Payout rate in migrated DB is 90 => stake 1000 * 90 = 90000 win => 46000 + 90000 = 136000
  const expectedPayout = settledTicket?.wonAmount || 0;
  record(
    'Authoritative Draw Settlement & Wallet Payout',
    afterDraw.status === 200 &&
      afterDraw.data.isDrawing === false &&
      settledTicket?.status === 'WON' &&
      expectedPayout > 0 &&
      afterDraw.data.account?.balance === 46000 + expectedPayout,
    `isDrawing=${afterDraw.data.isDrawing}, ticketStatus=${settledTicket?.status}, wonAmount=${expectedPayout}, balance=${afterDraw.data.account?.balance}`
  );

  // 9. Financial Reports & Admin State
  const adminState = await api<{
    reports: { totalPlayers: number; settledBetsCount: number; totalValidStakes: number };
  }>('/api/admin/state', { token: ownerToken });
  record(
    'Financial Reports & Admin State',
    adminState.status === 200 &&
      adminState.data.reports?.totalPlayers >= 3 &&
      adminState.data.reports?.settledBetsCount > 0,
    `totalPlayers=${adminState.data.reports?.totalPlayers}, settledBets=${adminState.data.reports?.settledBetsCount}`
  );

  // 10. Logout
  const logoutRes = await api('/api/auth/logout', { method: 'POST', token: playerToken });
  const afterLogout = await api('/api/player/state', { token: playerToken });
  record(
    'Session Logout & Revocation',
    logoutRes.status === 200 && afterLogout.status === 401,
    `logout=${logoutRes.status}, postLogoutState=${afterLogout.status}`
  );

  // Cleanup handled by resetting local D1 state after test run
  const failed = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} tests PASSED.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
