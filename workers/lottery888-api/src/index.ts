import { LotteryD1Database } from './db';
import { formatCambodiaDateYmd } from './security';
import { AppUser, ChannelLetter, Env, PersistedRoundMeta, ScheduledController } from './types';

function buildCorsHeaders(request: Request, env: Env): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control',
    'Cache-Control': 'no-store',
  };
  const allowedRaw = env.ALLOWED_ORIGINS?.trim();
  if (!allowedRaw) {
    return { ...base, 'Access-Control-Allow-Origin': '*' };
  }
  const allowed = allowedRaw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const origin = (request.headers.get('Origin') || '').trim().replace(/\/+$/, '');
  if (origin && allowed.includes(origin)) {
    return { ...base, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }
  return { ...base, Vary: 'Origin' };
}

function jsonResponse(
  data: unknown,
  status = 200,
  corsHeaders: Record<string, string> = { 'Cache-Control': 'no-store' }
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
    },
  });
}

function extractBearerToken(request: Request): string {
  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return '';
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function getDrawDurationMs(env: Env): number {
  const parsed = parseInt(env.LOTTERY_DRAW_DURATION_MS || '6800', 10);
  return Math.max(1000, Number.isFinite(parsed) ? parsed : 6800);
}

async function buildSharedRoundSnapshot(db: LotteryD1Database, meta: PersistedRoundMeta) {
  const now = Date.now();
  const currentRoundId = `26292#${meta.currentRoundNumber}`;
  const maxDuration = Math.max(1, meta.systemConfig.drawIntervalSeconds || 300);
  const remaining = meta.isDrawing
    ? 0
    : Math.min(maxDuration, Math.max(0, Math.ceil((meta.roundEndTime - now) / 1000)));
  const bettingClosed =
    meta.isDrawing || !meta.systemConfig.isSystemOpen || now >= meta.roundEndTime || remaining <= 0;

  return {
    serverTimestamp: now,
    serverDateYmd: formatCambodiaDateYmd(now),
    currentRoundId,
    currentRoundNumber: meta.currentRoundNumber,
    countdownSeconds: remaining,
    roundStartTime: meta.roundStartTime,
    roundEndTime: meta.roundEndTime,
    roundDurationSeconds: meta.systemConfig.drawIntervalSeconds,
    bettingClosed,
    isDrawing: meta.isDrawing,
    activeDraw: meta.activeDraw,
    pastRounds: await db.getPastRounds(50),
    systemConfig: meta.systemConfig,
  };
}

async function requireRole(
  request: Request,
  db: LotteryD1Database,
  role: 'OWNER' | 'PLAYER'
): Promise<{ account: AppUser; token: string } | Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse({ error: 'Authentication required.' }, 401);
  }
  const account = await db.verifySession(token);
  if (!account) {
    return jsonResponse({ error: 'Invalid, expired, or disabled session.' }, 401);
  }
  if (account.role !== role) {
    return jsonResponse({ error: 'Forbidden: insufficient permissions.' }, 403);
  }
  return { account, token };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = buildCorsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const res = await handleFetch(request, env);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders)) {
      out.headers.set(k, v);
    }
    return out;
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const db = new LotteryD1Database(env.DB);
    await db.tickAuthoritativeRound(getDrawDurationMs(env));
  },
};

async function handleFetch(request: Request, env: Env): Promise<Response> {

    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();
    const db = new LotteryD1Database(env.DB);
    const drawDurationMs = getDrawDurationMs(env);

    try {
      // =====================================================================
      // HEALTH CHECK
      // =====================================================================
      if (method === 'GET' && pathname === '/api/health') {
        const meta = await db.tickAuthoritativeRound(drawDurationMs);
        return jsonResponse({
          status: 'ok',
          round: `26292#${meta.currentRoundNumber}`,
          isDrawing: meta.isDrawing,
          ownerConfigured: await db.hasOwnerAccount(),
        });
      }

      // =====================================================================
      // AUTHENTICATION ENDPOINTS (OWNER & PLAYER)
      // =====================================================================
      if (method === 'POST' && pathname === '/api/auth/owner/login') {
        const body = await readJsonBody(request);
        if (typeof body.username !== 'string' || typeof body.password !== 'string') {
          return jsonResponse({ error: 'Username and password are required.' }, 400);
        }
        const result = await db.authenticateOwner(body.username, body.password);
        if (!result) {
          return jsonResponse({ error: 'Invalid owner credentials.' }, 401);
        }
        return jsonResponse({ success: true, token: result.token, account: result.account });
      }

      if (method === 'POST' && pathname === '/api/auth/player/login') {
        const body = await readJsonBody(request);
        if (typeof body.username !== 'string' || typeof body.password !== 'string') {
          return jsonResponse({ error: 'Username and password are required.' }, 400);
        }
        const result = await db.authenticatePlayer(body.username, body.password);
        if (!result.ok) {
          if (result.code === 'SUSPENDED') {
            return jsonResponse(
              { code: 'SUSPENDED', error: 'Account has been disabled by the platform owner.' },
              403
            );
          }
          return jsonResponse({ code: 'INVALID', error: 'Invalid username or password.' }, 401);
        }
        return jsonResponse({ success: true, token: result.token, account: result.account });
      }

      if (method === 'GET' && pathname === '/api/auth/me') {
        const token = extractBearerToken(request);
        const account = await db.verifySession(token);
        if (!account) {
          return jsonResponse({ error: 'Not authenticated.' }, 401);
        }
        return jsonResponse({ account });
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        const token = extractBearerToken(request);
        if (token) {
          await db.revokeSession(token);
        }
        return jsonResponse({ success: true });
      }

      // =====================================================================
      // SHARED PUBLIC LOTTERY DATA
      // =====================================================================
      if (method === 'GET' && pathname === '/api/lottery/public') {
        const meta = await db.tickAuthoritativeRound(drawDurationMs);
        return jsonResponse(await buildSharedRoundSnapshot(db, meta));
      }

      // =====================================================================
      // PLAYER-PROTECTED ENDPOINTS
      // =====================================================================
      if (method === 'GET' && pathname === '/api/player/state') {
        const auth = await requireRole(request, db, 'PLAYER');
        if (auth instanceof Response) return auth;

        const meta = await db.tickAuthoritativeRound(drawDurationMs);
        const player = await db.getAccountById(auth.account.id);
        if (!player || player.status !== 'ACTIVE') {
          return jsonResponse({ error: 'Player account is disabled.' }, 403);
        }
        const [snapshot, tickets, transactions] = await Promise.all([
          buildSharedRoundSnapshot(db, meta),
          db.getPlayerTickets(player.id),
          db.getPlayerTransactions(player.id),
        ]);
        return jsonResponse({
          ...snapshot,
          account: player,
          tickets,
          transactions,
        });
      }

      if (method === 'POST' && pathname === '/api/player/bets') {
        const auth = await requireRole(request, db, 'PLAYER');
        if (auth instanceof Response) return auth;

        try {
          await db.tickAuthoritativeRound(drawDurationMs);
          const body = await readJsonBody(request);
          const result = await db.placePlayerBet(auth.account, {
            channels: (body.channels as ChannelLetter[]) || [],
            numbers: (body.numbers as string[]) || [],
            stakePerUnit: Number(body.stakePerUnit),
            clientRequestId: typeof body.clientRequestId === 'string' ? body.clientRequestId : undefined,
          });
          return jsonResponse({
            success: true,
            ticket: result.ticket,
            newBalance: result.newBalance,
            duplicate: result.duplicate,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Bet rejected.';
          return jsonResponse({ error: msg }, 400);
        }
      }

      // =====================================================================
      // OWNER-PROTECTED ADMIN ENDPOINTS
      // =====================================================================
      if (method === 'GET' && pathname === '/api/admin/state') {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;

        const meta = await db.tickAuthoritativeRound(drawDurationMs);
        const [snapshot, players, tickets, transactions, reports, auditLogs] = await Promise.all([
          buildSharedRoundSnapshot(db, meta),
          db.listPlayers(),
          db.getAllTickets(),
          db.getAllTransactions(),
          db.computeFinancialReports(),
          db.getAuditLogs(150),
        ]);
        return jsonResponse({
          ...snapshot,
          owner: auth.account,
          forcedNextNumbers: meta.forcedNextNumbers,
          players,
          tickets,
          transactions,
          reports,
          auditLogs,
        });
      }

      if (method === 'POST' && pathname === '/api/admin/change-password') {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          const body = await readJsonBody(request);
          await db.changeOwnerPassword(
            auth.account,
            String(body.currentPassword || ''),
            String(body.newPassword || '')
          );
          return jsonResponse({ success: true });
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to change password.' }, 400);
        }
      }

      if (method === 'POST' && pathname === '/api/admin/players') {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          const body = await readJsonBody(request);
          const player = await db.createPlayer(auth.account, body as unknown as Parameters<LotteryD1Database['createPlayer']>[1]);
          return jsonResponse({ success: true, player }, 201);
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to create player.' }, 400);
        }
      }

      const playerPasswordMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/password$/);
      if (method === 'POST' && playerPasswordMatch) {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          const body = await readJsonBody(request);
          await db.resetPlayerPassword(
            auth.account,
            decodeURIComponent(playerPasswordMatch[1]),
            String(body.newPassword || '')
          );
          return jsonResponse({ success: true });
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to reset player password.' }, 400);
        }
      }

      const playerStatusMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/status$/);
      if (method === 'POST' && playerStatusMatch) {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          const body = await readJsonBody(request);
          const explicit =
            body.status === 'ACTIVE' || body.status === 'SUSPENDED' ? body.status : undefined;
          const player = await db.togglePlayerStatus(
            auth.account,
            decodeURIComponent(playerStatusMatch[1]),
            explicit
          );
          return jsonResponse({ success: true, player });
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to update player status.' }, 400);
        }
      }

      const playerDeleteMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)$/);
      if (method === 'DELETE' && playerDeleteMatch) {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          await db.deletePlayer(auth.account, decodeURIComponent(playerDeleteMatch[1]));
          return jsonResponse({ success: true });
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to delete player.' }, 400);
        }
      }

      if (method === 'POST' && pathname === '/api/admin/transactions') {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          const body = await readJsonBody(request);
          const type = String(body.type || '');
          if (!body.userId || !['DEPOSIT', 'WITHDRAWAL', 'SET'].includes(type)) {
            return jsonResponse({ error: 'Invalid transaction payload.' }, 400);
          }
          const result = await db.processCashierTransaction(auth.account, {
            userId: String(body.userId),
            type: type as 'DEPOSIT' | 'WITHDRAWAL' | 'SET',
            amount: Number(body.amount),
            paymentMethod: String(body.paymentMethod || 'ABA Bank'),
            note: body.note ? String(body.note) : undefined,
          });
          return jsonResponse({ success: true, ...result });
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Transaction failed.' }, 400);
        }
      }

      if (method === 'POST' && pathname === '/api/admin/forced-numbers') {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          const body = await readJsonBody(request);
          const numbers = (body.numbers ?? null) as Record<ChannelLetter, string> | null;
          const saved = await db.setForcedNextNumbers(auth.account, numbers);
          return jsonResponse({ success: true, forcedNextNumbers: saved });
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to save forced numbers.' }, 400);
        }
      }

      if (method === 'POST' && pathname === '/api/admin/trigger-draw') {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        const draw = await db.startServerDraw(auth.account);
        return jsonResponse({
          success: true,
          isDrawing: draw !== null,
          activeDraw: draw,
        });
      }

      if (method === 'POST' && pathname === '/api/admin/system-config') {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          const body = await readJsonBody(request);
          const updated = await db.updateSystemConfig(
            auth.account,
            (body.config as Record<string, unknown>) || {}
          );
          return jsonResponse({ success: true, systemConfig: updated.systemConfig });
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to update system configuration.' }, 400);
        }
      }

      const voidTicketMatch = pathname.match(/^\/api\/admin\/tickets\/([^/]+)\/void$/);
      if (method === 'POST' && voidTicketMatch) {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          const result = await db.voidPendingTicket(
            auth.account,
            decodeURIComponent(voidTicketMatch[1])
          );
          return jsonResponse({ success: true, ...result });
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to void ticket.' }, 400);
        }
      }

      const deleteRoundMatch = pathname.match(/^\/api\/admin\/rounds\/([^/]+)$/);
      if (method === 'DELETE' && deleteRoundMatch) {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          await db.deleteRound(auth.account, decodeURIComponent(deleteRoundMatch[1]));
          return jsonResponse({ success: true });
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to delete round.' }, 400);
        }
      }

      if (method === 'POST' && pathname === '/api/admin/reset-history') {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        try {
          await db.resetRoundHistory(auth.account);
          return jsonResponse({ success: true, pastRounds: await db.getPastRounds(50) });
        } catch (err) {
          return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to reset history.' }, 400);
        }
      }

      if (method === 'GET' && pathname === '/api/admin/audit-logs') {
        const auth = await requireRole(request, db, 'OWNER');
        if (auth instanceof Response) return auth;
        return jsonResponse({ auditLogs: await db.getAuditLogs(200) });
      }

      if (pathname.startsWith('/api/')) {
        return jsonResponse({ error: 'API endpoint not found.' }, 404);
      }

    return jsonResponse({ error: 'Not found.' }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error.';
    return jsonResponse({ error: msg }, 500);
  }
}
