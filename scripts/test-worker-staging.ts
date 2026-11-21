const BASE_URL =
  process.env.STAGING_API_URL || 'https://lottery888-api-staging.afa94607.workers.dev';

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
  console.log(`[STAGING TEST] Target: ${BASE_URL}`);

  // 1. Health & Public state
  const health = await api<{ status: string; ownerConfigured: boolean; round: string }>('/api/health');
  record(
    'HTTPS Health Check',
    health.status === 200 && health.data.status === 'ok' && health.data.ownerConfigured === true,
    `status=${health.status}, ownerConfigured=${health.data.ownerConfigured}, round=${health.data.round}`
  );

  let pub = await api<{
    currentRoundId: string;
    pastRounds: unknown[];
    countdownSeconds: number;
    isDrawing: boolean;
  }>('/api/lottery/public');
  if (pub.data.isDrawing) {
    await new Promise((r) => setTimeout(r, 7200));
    pub = await api('/api/lottery/public');
  }
  record(
    'HTTPS Public State & Countdown',
    pub.status === 200 &&
      Boolean(pub.data.currentRoundId) &&
      Array.isArray(pub.data.pastRounds) &&
      pub.data.countdownSeconds > 0,
    `status=${pub.status}, round=${pub.data.currentRoundId}, countdown=${pub.data.countdownSeconds}s, pastRounds=${pub.data.pastRounds?.length}`
  );

  // 2. Auth guards
  const unauthAdmin = await api('/api/admin/state');
  const unauthPlayer = await api('/api/player/state');
  const badOwner = await api('/api/auth/owner/login', {
    method: 'POST',
    body: { username: 'staging_owner', password: 'wrong_password' },
  });
  record(
    'Auth Guards & Invalid Credentials',
    unauthAdmin.status === 401 && unauthPlayer.status === 401 && badOwner.status === 401,
    `unauthAdmin=${unauthAdmin.status}, unauthPlayer=${unauthPlayer.status}, badOwner=${badOwner.status}`
  );

  // 3. Owner Login (synthetic staging_owner)
  const ownerLogin = await api<{ success: boolean; token: string; account: { role: string } }>(
    '/api/auth/owner/login',
    { method: 'POST', body: { username: 'staging_owner', password: 'StagingOwner#2026' } }
  );
  const ownerToken = ownerLogin.data.token;
  record(
    'Owner Login (Staging)',
    ownerLogin.status === 200 && ownerLogin.data.success === true && ownerLogin.data.account?.role === 'OWNER',
    `status=${ownerLogin.status}, role=${ownerLogin.data.account?.role}`
  );

  const ownerMe = await api<{ account: { role: string } }>('/api/auth/me', { token: ownerToken });
  const ownerOnPlayer = await api('/api/player/state', { token: ownerToken });
  record(
    'Owner Session & Role Isolation',
    ownerMe.status === 200 && ownerMe.data.account?.role === 'OWNER' && ownerOnPlayer.status === 403,
    `me=${ownerMe.status}, playerEndpointAsOwner=${ownerOnPlayer.status}`
  );

  // 4. Player Login (synthetic staging_player1)
  const playerLogin = await api<{
    success: boolean;
    token: string;
    account: { role: string; balance: number };
  }>('/api/auth/player/login', {
    method: 'POST',
    body: { username: 'staging_player1', password: 'StagingPlayer#2026' },
  });
  const playerToken = playerLogin.data.token;
  const playerOnAdmin = await api('/api/admin/state', { token: playerToken });
  record(
    'Player Login & Admin Endpoint Isolation',
    playerLogin.status === 200 &&
      playerLogin.data.account?.role === 'PLAYER' &&
      playerOnAdmin.status === 403,
    `status=${playerLogin.status}, adminEndpointAsPlayer=${playerOnAdmin.status}`
  );

  // 5. Real-time Sync Parity between Admin & Player state
  const [adminBefore, playerBefore] = await Promise.all([
    api<{ currentRoundId: string; players: Array<{ username: string }> }>('/api/admin/state', {
      token: ownerToken,
    }),
    api<{ currentRoundId: string; account: { balance: number } }>('/api/player/state', {
      token: playerToken,
    }),
  ]);
  const initialBal = playerBefore.data.account?.balance ?? 0;
  record(
    'Admin <-> Player Round Synchronization',
    adminBefore.status === 200 &&
      playerBefore.status === 200 &&
      adminBefore.data.currentRoundId === playerBefore.data.currentRoundId &&
      adminBefore.data.players?.some((p) => p.username === 'staging_player1'),
    `round=${playerBefore.data.currentRoundId}, playerBalance=${initialBal}`
  );

  // 6. Player Bet Placement & Idempotency
  const reqId = `STG-REQ-${Date.now()}`;
  const betRes = await api<{
    success: boolean;
    ticket: { ticketId: string; totalCost: number };
    newBalance: number;
    duplicate: boolean;
  }>('/api/player/bets', {
    method: 'POST',
    token: playerToken,
    body: {
      channels: ['A', 'B'],
      numbers: ['07', '77'],
      stakePerUnit: 1000,
      clientRequestId: reqId,
    },
  });
  const dupBetRes = await api<{ duplicate: boolean; newBalance: number }>('/api/player/bets', {
    method: 'POST',
    token: playerToken,
    body: {
      channels: ['A', 'B'],
      numbers: ['07', '77'],
      stakePerUnit: 1000,
      clientRequestId: reqId,
    },
  });
  record(
    'Player Bet Placement & Idempotency',
    betRes.status === 200 &&
      betRes.data.ticket?.totalCost === 4000 &&
      betRes.data.newBalance === initialBal - 4000 &&
      dupBetRes.status === 200 &&
      dupBetRes.data.duplicate === true &&
      dupBetRes.data.newBalance === initialBal - 4000,
    `cost=${betRes.data.ticket?.totalCost}, newBalance=${betRes.data.newBalance}, dup=${dupBetRes.data.duplicate}`
  );

  // 7. Forced Numbers + Manual Draw + Authoritative Settlement
  const forcedRes = await api('/api/admin/forced-numbers', {
    method: 'POST',
    token: ownerToken,
    body: { numbers: { A: '07', B: '15', C: '32', D: '64', E: '91' } },
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

  await new Promise((r) => setTimeout(r, 7500));

  const playerAfter = await api<{
    isDrawing: boolean;
    currentRoundNumber: number;
    account: { balance: number };
    tickets: Array<{ ticketId: string; status: string; wonAmount: number }>;
  }>('/api/player/state', { token: playerToken });
  const settledTicket = playerAfter.data.tickets?.find(
    (t) => t.ticketId === betRes.data.ticket?.ticketId
  );
  record(
    'Authoritative Draw Settlement & Wallet Payout',
    playerAfter.status === 200 &&
      playerAfter.data.isDrawing === false &&
      settledTicket?.status === 'WON' &&
      settledTicket?.wonAmount === 90000 &&
      playerAfter.data.account?.balance === initialBal - 4000 + 90000,
    `isDrawing=${playerAfter.data.isDrawing}, ticketStatus=${settledTicket?.status}, won=${settledTicket?.wonAmount}, balance=${playerAfter.data.account?.balance}`
  );

  // 8. Financial Reports
  const adminAfter = await api<{
    reports: { totalPlayers: number; settledBetsCount: number; totalWinningPayouts: number };
  }>('/api/admin/state', { token: ownerToken });
  record(
    'Financial Reports & Admin State',
    adminAfter.status === 200 &&
      adminAfter.data.reports?.totalPlayers >= 1 &&
      adminAfter.data.reports?.settledBetsCount >= 1 &&
      adminAfter.data.reports?.totalWinningPayouts >= 90000,
    `totalPlayers=${adminAfter.data.reports?.totalPlayers}, settledBets=${adminAfter.data.reports?.settledBetsCount}, payouts=${adminAfter.data.reports?.totalWinningPayouts}`
  );

  // 9. Logout & Revocation
  const logoutPlayer = await api('/api/auth/logout', { method: 'POST', token: playerToken });
  const logoutOwner = await api('/api/auth/logout', { method: 'POST', token: ownerToken });
  const postLogout = await api('/api/player/state', { token: playerToken });
  record(
    'Session Logout & Revocation',
    logoutPlayer.status === 200 && logoutOwner.status === 200 && postLogout.status === 401,
    `logoutPlayer=${logoutPlayer.status}, logoutOwner=${logoutOwner.status}, postLogoutState=${postLogout.status}`
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} staging HTTPS tests PASSED.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[STAGING TEST ERROR]', err);
  process.exit(1);
});
