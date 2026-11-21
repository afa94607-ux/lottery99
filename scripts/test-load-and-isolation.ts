const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:8787';

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
  // 1. Owner login
  const ownerLogin = await api<{ token: string }>('/api/auth/owner/login', {
    method: 'POST',
    body: { username: '__test_owner__', password: 'TestOwner#2026' },
  });
  const ownerToken = ownerLogin.data.token;
  record('Owner Login', ownerLogin.status === 200 && Boolean(ownerToken), `status=${ownerLogin.status}`);

  // 2. Create 2 isolated players
  const ts = Date.now();
  const p1User = `__p1_${ts}__`;
  const p2User = `__p2_${ts}__`;
  await api('/api/admin/players', {
    method: 'POST',
    token: ownerToken,
    body: { username: p1User, name: 'Player One', password: 'Pass1#2026', balance: 20000 },
  });
  await api('/api/admin/players', {
    method: 'POST',
    token: ownerToken,
    body: { username: p2User, name: 'Player Two', password: 'Pass2#2026', balance: 30000 },
  });

  const [l1, l2] = await Promise.all([
    api<{ token: string; account: { id: string } }>('/api/auth/player/login', {
      method: 'POST',
      body: { username: p1User, password: 'Pass1#2026' },
    }),
    api<{ token: string; account: { id: string } }>('/api/auth/player/login', {
      method: 'POST',
      body: { username: p2User, password: 'Pass2#2026' },
    }),
  ]);
  const t1 = l1.data.token;
  const t2 = l2.data.token;
  const id1 = l1.data.account?.id;
  const id2 = l2.data.account?.id;

  // 3. Player 1 places a bet; verify Player 2 cannot see Player 1's ticket or balance
  await api('/api/player/bets', {
    method: 'POST',
    token: t1,
    body: { channels: ['A'], numbers: ['09'], stakePerUnit: 1000, clientRequestId: `ISO-${ts}` },
  });

  const [s1Live, s2Live] = await Promise.all([
    api<{ mode: string; account: { balance: number }; tickets: Array<{ userId: string }> }>(
      '/api/player/state?mode=live',
      { token: t1 }
    ),
    api<{ mode: string; account: { balance: number }; tickets: Array<{ userId: string }> }>(
      '/api/player/state?mode=live',
      { token: t2 }
    ),
  ]);

  record(
    'Multi-Player Data Isolation & Live Mode',
    s1Live.data.mode === 'live' &&
      s1Live.data.account?.balance === 19000 &&
      s1Live.data.tickets?.every((t) => t.userId === id1) &&
      s2Live.data.account?.balance === 30000 &&
      s2Live.data.tickets?.every((t) => t.userId === id2),
    `p1Bal=${s1Live.data.account?.balance}, p2Bal=${s2Live.data.account?.balance}, p1Tickets=${s1Live.data.tickets?.length}, p2Tickets=${s2Live.data.tickets?.length}`
  );

  // 4. Admin live vs full mode
  const [admLive, admFull] = await Promise.all([
    api<{ mode: string; reports?: unknown; transactions?: unknown; auditLogs?: unknown }>(
      '/api/admin/state?mode=live',
      { token: ownerToken }
    ),
    api<{ mode: string; reports?: unknown; transactions?: unknown; auditLogs?: unknown }>(
      '/api/admin/state',
      { token: ownerToken }
    ),
  ]);

  record(
    'Admin Live Mode Skips Heavy Reports/Audit Scan',
    admLive.status === 200 &&
      admLive.data.mode === 'live' &&
      admLive.data.reports === undefined &&
      admLive.data.transactions === undefined &&
      admLive.data.auditLogs === undefined &&
      admFull.status === 200 &&
      admFull.data.mode === 'full' &&
      Boolean(admFull.data.reports),
    `liveHasReports=${Boolean(admLive.data.reports)}, fullHasReports=${Boolean(admFull.data.reports)}`
  );

  // 5. Concurrent load burst (10 parallel live polls + 5 public polls)
  const burst = await Promise.all([
    ...Array.from({ length: 5 }, () => api('/api/player/state?mode=live', { token: t1 })),
    ...Array.from({ length: 5 }, () => api('/api/player/state?mode=live', { token: t2 })),
    ...Array.from({ length: 5 }, () => api('/api/lottery/public')),
    api('/api/admin/state?mode=live', { token: ownerToken }),
  ]);
  const allOk = burst.every((r) => r.status === 200);
  record('Concurrent Multi-Player + Admin Burst (16 reqs)', allOk, `all200=${allOk}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} load & isolation tests PASSED.`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
