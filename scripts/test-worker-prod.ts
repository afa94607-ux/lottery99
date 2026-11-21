const BASE_URL = process.env.PROD_API_URL || 'https://lottery888-api.afa94607.workers.dev';

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
  opts: { method?: string; token?: string; body?: unknown; origin?: string } = {}
): Promise<{ status: number; headers: Headers; data: T }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.origin) headers['Origin'] = opts.origin;

  const res = await fetch(`${BASE_URL}${pathUrl}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, headers: res.headers, data };
}

async function main() {
  console.log(`[PROD TEST] Target: ${BASE_URL}`);

  // 1. Health & D1 Connectivity
  const health = await api<{ status: string; ownerConfigured: boolean; round: string }>('/api/health');
  record(
    'Production Health & D1 Connectivity',
    health.status === 200 && health.data.status === 'ok' && health.data.ownerConfigured === true,
    `status=${health.status}, ownerConfigured=${health.data.ownerConfigured}, round=${health.data.round}`
  );

  // 2. Public Round State & Synchronization
  let pub1 = await api<{
    currentRoundId: string;
    roundEndTime: number;
    countdownSeconds: number;
    isDrawing: boolean;
    pastRounds: unknown[];
    systemConfig: { payoutRate: number };
  }>('/api/lottery/public');
  if (pub1.data.isDrawing) {
    await new Promise((r) => setTimeout(r, 7500));
    pub1 = await api('/api/lottery/public');
  }
  const pub2 = await api<{ currentRoundId: string; roundEndTime: number }>('/api/lottery/public');
  record(
    'Public Round State & Synchronization',
    pub1.status === 200 &&
      pub2.status === 200 &&
      pub1.data.currentRoundId === pub2.data.currentRoundId &&
      pub1.data.roundEndTime === pub2.data.roundEndTime &&
      pub1.data.pastRounds?.length === 50 &&
      pub1.data.systemConfig?.payoutRate === 90,
    `round=${pub1.data.currentRoundId}, countdown=${pub1.data.countdownSeconds}s, pastRounds=${pub1.data.pastRounds?.length}, payoutRate=${pub1.data.systemConfig?.payoutRate}`
  );

  // 3. Authentication & Permission Protections
  const unauthAdmin = await api('/api/admin/state');
  const unauthPlayer = await api('/api/player/state');
  const unauthBet = await api('/api/player/bets', { method: 'POST', body: {} });
  const unauthDraw = await api('/api/admin/trigger-draw', { method: 'POST' });
  const badOwner = await api('/api/auth/owner/login', {
    method: 'POST',
    body: { username: '__invalid_owner__', password: 'wrong_password' },
  });
  const badPlayer = await api('/api/auth/player/login', {
    method: 'POST',
    body: { username: '__invalid_player__', password: 'wrong_password' },
  });
  record(
    'Authentication & Endpoint Protections',
    unauthAdmin.status === 401 &&
      unauthPlayer.status === 401 &&
      unauthBet.status === 401 &&
      unauthDraw.status === 401 &&
      badOwner.status === 401 &&
      badPlayer.status === 401,
    `admin=${unauthAdmin.status}, player=${unauthPlayer.status}, bet=${unauthBet.status}, draw=${unauthDraw.status}, badOwner=${badOwner.status}, badPlayer=${badPlayer.status}`
  );

  // 4. Restricted CORS Verification
  const allowedOrigin = 'https://adminlottery99.afa94607.workers.dev';
  const blockedOrigin = 'https://unauthorized-site.example.com';
  const corsAllowed = await api('/api/health', { method: 'OPTIONS', origin: allowedOrigin });
  const corsBlocked = await api('/api/health', { method: 'OPTIONS', origin: blockedOrigin });
  const allowHdr = corsAllowed.headers.get('access-control-allow-origin');
  const blockHdr = corsBlocked.headers.get('access-control-allow-origin');
  record(
    'Restricted Production CORS',
    corsAllowed.status === 204 && allowHdr === allowedOrigin && blockHdr === null,
    `allowedOriginHeader=${allowHdr}, unauthorizedOriginHeader=${String(blockHdr)}`
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} production HTTPS tests PASSED.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[PROD TEST ERROR]', err);
  process.exit(1);
});
