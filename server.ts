import 'dotenv/config';
import http from 'http';
import express, { NextFunction, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppUser, ChannelLetter } from './src/types/lottery';
import { db } from './server/db';
import { formatCambodiaDateYmd, getCryptoRandomLotteryNumber } from './server/security';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AuthenticatedRequest extends Request {
  account?: AppUser;
  authToken?: string;
}

interface ActiveDrawState {
  roundId: string;
  numbers: Record<ChannelLetter, string>;
  startTime: number;
}

let isDrawing = false;
let activeDraw: ActiveDrawState | null = null;

const DRAW_DURATION_MS = Math.max(
  1000,
  parseInt(process.env.LOTTERY_DRAW_DURATION_MS || '6800', 10) || 6800
);

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return '';
}

function requireRole(role: 'OWNER' | 'PLAYER') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const account = db.verifySession(token);
    if (!account) {
      return res.status(401).json({ error: 'Invalid, expired, or disabled session.' });
    }
    if (account.role !== role) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions.' });
    }
    req.account = account;
    req.authToken = token;
    next();
  };
}

function getSharedRoundSnapshot() {
  const meta = db.getPersistedMeta();
  const now = Date.now();
  const currentRoundId = `26292#${meta.currentRoundNumber}`;
  const maxDuration = Math.max(1, meta.systemConfig.drawIntervalSeconds || 300);
  const remaining = isDrawing
    ? 0
    : Math.min(maxDuration, Math.max(0, Math.ceil((meta.roundEndTime - now) / 1000)));
  const bettingClosed =
    isDrawing || !meta.systemConfig.isSystemOpen || now >= meta.roundEndTime || remaining <= 0;

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
    isDrawing,
    activeDraw,
    pastRounds: db.getPastRounds(50),
    systemConfig: meta.systemConfig,
  };
}

function startServerDraw(triggeredBy?: AppUser): ActiveDrawState | null {
  if (isDrawing) return activeDraw;

  const meta = db.getPersistedMeta();
  const currentRoundId = `26292#${meta.currentRoundNumber}`;

  const winningNumbers: Record<ChannelLetter, string> = meta.forcedNextNumbers || {
    A: getCryptoRandomLotteryNumber(),
    B: getCryptoRandomLotteryNumber(),
    C: getCryptoRandomLotteryNumber(),
    D: getCryptoRandomLotteryNumber(),
    E: getCryptoRandomLotteryNumber(),
  };

  isDrawing = true;
  activeDraw = {
    roundId: currentRoundId,
    numbers: winningNumbers,
    startTime: Date.now(),
  };

  if (triggeredBy) {
    db.recordAuditLog(
      triggeredBy,
      'TRIGGER_MANUAL_DRAW',
      currentRoundId,
      `Owner triggered manual draw for round ${currentRoundId}.`
    );
  }

  console.log(`[LOTTERY SERVER] Draw started for ${currentRoundId}:`, winningNumbers);
  return activeDraw;
}

function finalizeServerDraw(): void {
  if (!isDrawing || !activeDraw) return;

  const drawToSettle = activeDraw;
  try {
    const result = db.settleRoundAtomic(drawToSettle.roundId, drawToSettle.numbers);
    console.log(
      `[LOTTERY SERVER] Round ${drawToSettle.roundId} finalized (settled=${result.settledCount}, payouts=${result.totalPayout} KHR, next=26292#${result.nextRoundNumber})`
    );
  } catch (err) {
    console.error('[LOTTERY SERVER] Failed to settle draw:', err);
  } finally {
    isDrawing = false;
    activeDraw = null;
  }
}

async function startServer() {
  await db.init();

  // Authoritative 1-second server draw heartbeat loop
  setInterval(() => {
    const meta = db.getPersistedMeta();

    if (isDrawing && activeDraw) {
      const elapsed = Date.now() - activeDraw.startTime;
      if (elapsed >= DRAW_DURATION_MS) {
        finalizeServerDraw();
      }
      return;
    }

    if (!meta.systemConfig.isSystemOpen) return;

    if (meta.systemConfig.autoDrawEnabled) {
      const remaining = Math.max(0, Math.ceil((meta.roundEndTime - Date.now()) / 1000));
      if (remaining <= 0) {
        startServerDraw();
      }
    }
  }, 1000);

  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const HOST = process.env.HOST || '0.0.0.0';

  app.use(express.json({ limit: '1mb' }));

  // CORS for separate Game Page (127.0.0.1:3000) & Admin Panel (127.0.0.1:3001) or dual-domain deployments
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // =========================================================================
  // HEALTH CHECK
  // =========================================================================
  app.get('/api/health', (_req, res) => {
    const meta = db.getPersistedMeta();
    res.json({
      status: 'ok',
      round: `26292#${meta.currentRoundNumber}`,
      isDrawing,
      ownerConfigured: db.hasOwnerAccount(),
    });
  });

  // =========================================================================
  // AUTHENTICATION ENDPOINTS (OWNER & PLAYER — NO PUBLIC REGISTRATION)
  // =========================================================================
  app.post('/api/auth/owner/login', (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const result = db.authenticateOwner(username, password);
    if (!result) {
      return res.status(401).json({ error: 'Invalid owner credentials.' });
    }
    res.json({ success: true, token: result.token, account: result.account });
  });

  app.post('/api/auth/player/login', (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const result = db.authenticatePlayer(username, password);
    if (!result.ok) {
      if (result.code === 'SUSPENDED') {
        return res.status(403).json({
          code: 'SUSPENDED',
          error: 'Account has been disabled by the platform owner.',
        });
      }
      return res.status(401).json({ code: 'INVALID', error: 'Invalid username or password.' });
    }
    res.json({ success: true, token: result.token, account: result.account });
  });

  app.get('/api/auth/me', (req: AuthenticatedRequest, res) => {
    const token = extractBearerToken(req);
    const account = db.verifySession(token);
    if (!account) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    res.json({ account });
  });

  app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
    const token = extractBearerToken(req);
    if (token) {
      db.revokeSession(token);
    }
    res.json({ success: true });
  });

  // =========================================================================
  // SHARED PUBLIC LOTTERY DATA (NON-SENSITIVE RESULTS & COUNTDOWN ONLY)
  // =========================================================================
  app.get('/api/lottery/public', (_req, res) => {
    res.json(getSharedRoundSnapshot());
  });

  // =========================================================================
  // PLAYER-PROTECTED ENDPOINTS (STRICT ISOLATION PER PLAYER ACCOUNT)
  // =========================================================================
  app.get('/api/player/state', requireRole('PLAYER'), (req: AuthenticatedRequest, res) => {
    const player = db.getAccountById(req.account!.id);
    if (!player || player.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Player account is disabled.' });
    }
    res.json({
      ...getSharedRoundSnapshot(),
      account: player,
      tickets: db.getPlayerTickets(player.id),
      transactions: db.getPlayerTransactions(player.id),
    });
  });

  app.post('/api/player/bets', requireRole('PLAYER'), (req: AuthenticatedRequest, res) => {
    try {
      const { channels, numbers, stakePerUnit, clientRequestId } = req.body || {};
      const meta = db.getPersistedMeta();
      const currentRoundId = `26292#${meta.currentRoundNumber}`;

      const result = db.placePlayerBet(
        req.account!,
        { channels, numbers, stakePerUnit, clientRequestId },
        currentRoundId,
        isDrawing
      );

      res.json({
        success: true,
        ticket: result.ticket,
        newBalance: result.newBalance,
        duplicate: result.duplicate,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bet rejected.';
      res.status(400).json({ error: msg });
    }
  });

  // =========================================================================
  // OWNER-PROTECTED ADMIN ENDPOINTS (EVERY ENDPOINT REQUIRES OWNER AUTH)
  // =========================================================================
  app.get('/api/admin/state', requireRole('OWNER'), (req: AuthenticatedRequest, res) => {
    const meta = db.getPersistedMeta();
    res.json({
      ...getSharedRoundSnapshot(),
      owner: req.account,
      forcedNextNumbers: meta.forcedNextNumbers,
      players: db.listPlayers(),
      tickets: db.getAllTickets(),
      transactions: db.getAllTransactions(),
      reports: db.computeFinancialReports(),
      auditLogs: db.getAuditLogs(150),
    });
  });

  app.post('/api/admin/change-password', requireRole('OWNER'), (req: AuthenticatedRequest, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      db.changeOwnerPassword(req.account!, String(currentPassword || ''), String(newPassword || ''));
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to change password.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/admin/players', requireRole('OWNER'), (req: AuthenticatedRequest, res) => {
    try {
      const player = db.createPlayer(req.account!, req.body || {});
      res.status(201).json({ success: true, player });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create player.';
      res.status(400).json({ error: msg });
    }
  });

  app.post(
    '/api/admin/players/:id/password',
    requireRole('OWNER'),
    (req: AuthenticatedRequest, res) => {
      try {
        const { newPassword } = req.body || {};
        db.resetPlayerPassword(req.account!, req.params.id, String(newPassword || ''));
        res.json({ success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to reset player password.';
        res.status(400).json({ error: msg });
      }
    }
  );

  app.post(
    '/api/admin/players/:id/status',
    requireRole('OWNER'),
    (req: AuthenticatedRequest, res) => {
      try {
        const explicit =
          req.body?.status === 'ACTIVE' || req.body?.status === 'SUSPENDED'
            ? req.body.status
            : undefined;
        const player = db.togglePlayerStatus(req.account!, req.params.id, explicit);
        res.json({ success: true, player });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to update player status.';
        res.status(400).json({ error: msg });
      }
    }
  );

  app.delete('/api/admin/players/:id', requireRole('OWNER'), (req: AuthenticatedRequest, res) => {
    try {
      db.deletePlayer(req.account!, req.params.id);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete player.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/admin/transactions', requireRole('OWNER'), (req: AuthenticatedRequest, res) => {
    try {
      const { userId, type, amount, paymentMethod, note } = req.body || {};
      if (!userId || !['DEPOSIT', 'WITHDRAWAL', 'SET'].includes(type)) {
        return res.status(400).json({ error: 'Invalid transaction payload.' });
      }
      const result = db.processCashierTransaction(req.account!, {
        userId: String(userId),
        type,
        amount: Number(amount),
        paymentMethod: String(paymentMethod || 'ABA Bank'),
        note: note ? String(note) : undefined,
      });
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/admin/forced-numbers', requireRole('OWNER'), (req: AuthenticatedRequest, res) => {
    try {
      const { numbers } = req.body || {};
      const saved = db.setForcedNextNumbers(req.account!, numbers ?? null);
      res.json({ success: true, forcedNextNumbers: saved });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save forced numbers.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/admin/trigger-draw', requireRole('OWNER'), (req: AuthenticatedRequest, res) => {
    const draw = startServerDraw(req.account!);
    res.json({
      success: true,
      isDrawing,
      activeDraw: draw,
    });
  });

  app.post('/api/admin/system-config', requireRole('OWNER'), (req: AuthenticatedRequest, res) => {
    try {
      const { config } = req.body || {};
      const updated = db.updateSystemConfig(req.account!, config || {});
      res.json({ success: true, systemConfig: updated.systemConfig });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update system configuration.';
      res.status(400).json({ error: msg });
    }
  });

  app.post(
    '/api/admin/tickets/:ticketId/void',
    requireRole('OWNER'),
    (req: AuthenticatedRequest, res) => {
      try {
        const result = db.voidPendingTicket(req.account!, req.params.ticketId);
        res.json({ success: true, ...result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to void ticket.';
        res.status(400).json({ error: msg });
      }
    }
  );

  app.delete(
    '/api/admin/rounds/:roundId',
    requireRole('OWNER'),
    (req: AuthenticatedRequest, res) => {
      try {
        db.deleteRound(req.account!, decodeURIComponent(req.params.roundId));
        res.json({ success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to delete round.';
        res.status(400).json({ error: msg });
      }
    }
  );

  app.post('/api/admin/reset-history', requireRole('OWNER'), (req: AuthenticatedRequest, res) => {
    try {
      db.resetRoundHistory(req.account!);
      res.json({ success: true, pastRounds: db.getPastRounds(50) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reset history.';
      res.status(400).json({ error: msg });
    }
  });

  app.get('/api/admin/audit-logs', requireRole('OWNER'), (_req, res) => {
    res.json({ auditLogs: db.getAuditLogs(200) });
  });

  // Catch-all for unknown /api/* routes (always JSON 404, never HTML)
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Create HTTP server so Vite HMR attaches directly to it (prevents WebSocket port 24678 conflicts!)
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`[LOTTERY SERVER] Authoritative Backend + Game Page running on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[LOTTERY SERVER] Failed to start:', err);
  process.exit(1);
});
