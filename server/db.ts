import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs, { Database, SqlValue } from 'sql.js';
import {
  AppUser,
  AuditLogEntry,
  BalanceTransaction,
  BetTicket,
  ChannelLetter,
  DailyFinancialReport,
  DetailedBetReportRow,
  FinancialReportsSummary,
  PlayerFinancialReport,
  RoundFinancialReport,
  RoundResult,
  SystemConfig,
  TransactionType,
} from '../src/types/lottery';
import { DEFAULT_SYSTEM_CONFIG, INITIAL_PAST_ROUNDS } from '../src/utils/formatters';
import {
  formatCambodiaDateYmd,
  formatDateTimeNow,
  generateSessionToken,
  generateUniqueCode,
  hashPassword,
  verifyPassword,
} from './security';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DATA_DIR = process.env.LOTTERY_DATA_DIR
  ? path.resolve(process.env.LOTTERY_DATA_DIR)
  : path.resolve(ROOT_DIR, 'data');
const DB_FILE = path.resolve(DATA_DIR, 'lottery888.sqlite');
const LEGACY_STATE_FILE = path.resolve(DATA_DIR, 'lottery-state.json');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface PersistedRoundMeta {
  currentRoundNumber: number;
  roundStartTime: number;
  roundEndTime: number;
  forcedNextNumbers: Record<ChannelLetter, string> | null;
  systemConfig: SystemConfig;
}

export class LotteryDatabase {
  private db!: Database;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const SQL = await initSqlJs({
      useOldExtensionFunctions: false,
      locateFile: (file: string) => {
        const localWasm = path.resolve(ROOT_DIR, 'node_modules/sql.js/dist', file);
        if (fs.existsSync(localWasm)) return localWasm;
        return file;
      },
    });

    const dbExists = fs.existsSync(DB_FILE);
    if (dbExists) {
      const fileBuffer = fs.readFileSync(DB_FILE);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    this.createSchema();

    if (!dbExists) {
      this.seedOrMigrateInitialData();
      this.persist();
    } else {
      this.ensureSystemConfigRow();
      // Remove any legacy non-OWNER/non-PLAYER roles safely if upgrading
      this.persist();
    }

    // One-time environment-based owner bootstrap ONLY if no OWNER exists yet
    const initOwnerUser = process.env.OWNER_INIT_USERNAME?.trim();
    const initOwnerPass = process.env.OWNER_INIT_PASSWORD?.trim();
    if (initOwnerUser && initOwnerPass && !this.hasOwnerAccount()) {
      this.createOrUpdateOwnerAccount(initOwnerUser, initOwnerPass, 'Platform Owner');
      console.log(`[DB] Initialized OWNER account "${initOwnerUser}" via one-time env setup.`);
    }

    this.initialized = true;
  }

  private createSchema(): void {
    this.db.run(`
      PRAGMA foreign_keys = ON;

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
        round_end_time INTEGER NOT NULL
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
      CREATE INDEX IF NOT EXISTS idx_tickets_round_status ON bet_tickets(round_id, status);
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
      CREATE INDEX IF NOT EXISTS idx_rounds_timestamp ON rounds(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
    `);
  }

  private persist(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, buffer);
    fs.renameSync(tmpFile, DB_FILE);
  }

  private runInTransaction<T>(fn: () => T): T {
    this.db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = fn();
      this.db.run('COMMIT');
      this.persist();
      return result;
    } catch (err) {
      try {
        this.db.run('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    }
  }

  private queryAll<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
  }

  private queryOne<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T | null {
    const rows = this.queryAll<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  private parseNextRoundNumber(rounds: RoundResult[]): number {
    if (!rounds || rounds.length === 0) return 149;
    let maxNum = 148;
    for (const r of rounds) {
      const m = r.roundId.match(/#(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    return maxNum + 1;
  }

  private ensureSystemConfigRow(): void {
    const row = this.queryOne<{
      id: number;
      draw_interval_seconds: number;
      round_start_time: number;
      round_end_time: number;
    }>('SELECT id, draw_interval_seconds, round_start_time, round_end_time FROM system_config WHERE id = 1');
    const now = Date.now();
    if (!row) {
      const duration = DEFAULT_SYSTEM_CONFIG.drawIntervalSeconds;
      this.db.run(
        `INSERT INTO system_config (
          id, payout_rate, draw_interval_seconds, min_bet_amount, max_bet_amount,
          is_system_open, auto_draw_enabled, forced_numbers_json,
          current_round_number, round_start_time, round_end_time
        ) VALUES (1, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          DEFAULT_SYSTEM_CONFIG.payoutRate,
          duration,
          DEFAULT_SYSTEM_CONFIG.minBetAmount,
          DEFAULT_SYSTEM_CONFIG.maxBetAmount,
          DEFAULT_SYSTEM_CONFIG.isSystemOpen ? 1 : 0,
          DEFAULT_SYSTEM_CONFIG.autoDrawEnabled ? 1 : 0,
          149,
          now,
          now + duration * 1000,
        ]
      );
      return;
    }

    // Minimal one-time upgrade from the previous default 180s (3m) to the requested 300s (05:00) betting period
    if (Number(row.draw_interval_seconds) === 180) {
      const duration = 300;
      const existingStart = Number(row.round_start_time) || now;
      const extendedEnd = existingStart + duration * 1000;
      const nextStart = extendedEnd > now ? existingStart : now;
      const nextEnd = extendedEnd > now ? extendedEnd : now + duration * 1000;
      this.db.run(
        `UPDATE system_config
         SET draw_interval_seconds = ?, round_start_time = ?, round_end_time = ?
         WHERE id = 1`,
        [duration, nextStart, nextEnd]
      );
    }
  }

  private seedOrMigrateInitialData(): void {
    const now = Date.now();
    const { dateYmd, dateTimeYmdHm } = formatDateTimeNow(new Date(now));

    let legacyRounds: RoundResult[] = INITIAL_PAST_ROUNDS;
    let legacyConfig: SystemConfig = { ...DEFAULT_SYSTEM_CONFIG };
    let legacyForced: Record<ChannelLetter, string> | null = null;
    let legacyUsers: Array<Record<string, unknown>> = [];
    let legacyTickets: BetTicket[] = [];
    let legacyTransactions: BalanceTransaction[] = [];

    if (fs.existsSync(LEGACY_STATE_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(LEGACY_STATE_FILE, 'utf-8'));
        if (Array.isArray(parsed.pastRounds) && parsed.pastRounds.length > 0) {
          legacyRounds = parsed.pastRounds;
        }
        if (parsed.systemConfig) {
          legacyConfig = { ...DEFAULT_SYSTEM_CONFIG, ...parsed.systemConfig };
        }
        if (parsed.forcedNextNumbers) {
          legacyForced = parsed.forcedNextNumbers;
        }
        if (Array.isArray(parsed.users)) {
          legacyUsers = parsed.users;
        }
        if (Array.isArray(parsed.userTickets)) {
          legacyTickets = parsed.userTickets;
        }
        if (Array.isArray(parsed.transactions)) {
          legacyTransactions = parsed.transactions;
        }
      } catch (err) {
        console.error('[DB] Failed to read legacy lottery-state.json during migration:', err);
      }
    }

    // 1. Migrate past rounds
    for (const r of legacyRounds) {
      this.db.run(
        `INSERT OR IGNORE INTO rounds (round_id, draw_time, date, num_a, num_b, num_c, num_d, num_e, timestamp, settled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          r.roundId,
          r.drawTime || '12:00',
          r.date || '19-10-2026',
          r.numbers?.A || '01',
          r.numbers?.B || '02',
          r.numbers?.C || '03',
          r.numbers?.D || '04',
          r.numbers?.E || '05',
          r.timestamp || now,
        ]
      );
    }

    // 2. Migrate existing non-admin/non-master players as PLAYER accounts with hashed passwords
    // Preserves player balances and records while cleanly removing MASTER and old demo ADMIN accounts.
    for (const u of legacyUsers) {
      const legacyRole = String(u.role || '').toUpperCase();
      if (legacyRole === 'ADMIN' || legacyRole === 'MASTER') {
        // Master & legacy hardcoded admin are removed per OWNER -> PLAYERS architecture
        continue;
      }
      const id = String(u.id || '').trim();
      if (!id) continue;
      const username = id;
      const rawPass = String(u.password || generateUniqueCode('PW'));
      const balance = Math.max(0, Math.round(Number(u.balance) || 0));
      const creditLimit = Math.max(0, Math.round(Number(u.creditLimit) || 2000000));
      const status = String(u.status || 'ACTIVE').toUpperCase() === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';

      this.db.run(
        `INSERT OR IGNORE INTO accounts (
          id, username, username_lower, name, role, password_hash, balance, credit_limit,
          phone, status, commission_rate, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'PLAYER', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          username,
          username.toLowerCase(),
          String(u.name || id),
          hashPassword(rawPass),
          balance,
          creditLimit,
          u.phone ? String(u.phone) : null,
          status,
          Number(u.commissionRate) || 0,
          u.notes ? String(u.notes) : null,
          String(u.createdAt || dateYmd),
          now,
        ]
      );
    }

    // 3. Preserve existing bet tickets
    for (const t of legacyTickets) {
      if (!t.ticketId) continue;
      const status =
        t.status === 'WON' || t.status === 'LOST' || t.status === 'VOID' ? t.status : 'PENDING';
      this.db.run(
        `INSERT OR IGNORE INTO bet_tickets (
          ticket_id, user_id, round_id, created_at, timestamp,
          channels_json, numbers_json, stake_per_unit, total_bets_count,
          total_cost, status, won_amount, winning_hits_json, settled_at, payout_credited
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.ticketId,
          t.userId || 'UNKNOWN',
          t.roundId,
          t.createdAt || dateTimeYmdHm,
          t.timestamp || now,
          JSON.stringify(t.channels || []),
          JSON.stringify(t.numbers || []),
          Math.max(1, Math.round(Number(t.stakePerUnit) || 100)),
          Math.max(1, Math.round(Number(t.totalBetsCount) || 1)),
          Math.max(1, Math.round(Number(t.totalCost) || 100)),
          status,
          Math.max(0, Math.round(Number(t.wonAmount) || 0)),
          JSON.stringify(t.winningHits || []),
          status === 'PENDING' ? null : now,
          status === 'PENDING' ? 0 : 1,
        ]
      );
    }

    // 4. Preserve existing financial transactions
    for (const tx of legacyTransactions) {
      if (!tx.transactionId) continue;
      this.db.run(
        `INSERT OR IGNORE INTO transactions (
          transaction_id, user_id, user_name, user_role, type, amount,
          previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
        ) VALUES (?, ?, ?, 'PLAYER', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tx.transactionId,
          tx.userId,
          tx.userName || tx.userId,
          tx.type || 'DEPOSIT',
          Math.max(0, Math.round(Number(tx.amount) || 0)),
          Math.max(0, Math.round(Number(tx.previousBalance) || 0)),
          Math.max(0, Math.round(Number(tx.newBalance) || 0)),
          tx.paymentMethod || 'ABA Bank',
          tx.note || null,
          'OWNER',
          tx.timestamp || now,
          tx.createdAt || dateTimeYmdHm,
        ]
      );
    }

    // 5. System config
    const nextRoundNum = this.parseNextRoundNumber(legacyRounds);
    const duration = Math.max(10, Math.round(Number(legacyConfig.drawIntervalSeconds) || 300));
    this.db.run(
      `INSERT OR REPLACE INTO system_config (
        id, payout_rate, draw_interval_seconds, min_bet_amount, max_bet_amount,
        is_system_open, auto_draw_enabled, forced_numbers_json,
        current_round_number, round_start_time, round_end_time
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Math.max(1, Math.round(Number(legacyConfig.payoutRate) || 91)),
        duration,
        Math.max(1, Math.round(Number(legacyConfig.minBetAmount) || 100)),
        Math.max(100, Math.round(Number(legacyConfig.maxBetAmount) || 5000000)),
        legacyConfig.isSystemOpen === false ? 0 : 1,
        legacyConfig.autoDrawEnabled === false ? 0 : 1,
        legacyForced ? JSON.stringify(legacyForced) : null,
        nextRoundNum,
        now,
        now + duration * 1000,
      ]
    );

    this.recordAuditLogInternal(
      'SYSTEM',
      'SYSTEM',
      'DATABASE_MIGRATED',
      undefined,
      'Migrated platform to SQLite OWNER -> PLAYERS architecture (Master role removed; existing player, round, and financial records preserved).'
    );
  }

  private mapAccountRow(row: Record<string, SqlValue>): AppUser {
    return {
      id: String(row.id),
      username: String(row.username),
      name: String(row.name),
      role: String(row.role) === 'OWNER' ? 'OWNER' : 'PLAYER',
      balance: Number(row.balance) || 0,
      creditLimit: Number(row.credit_limit) || 0,
      phone: row.phone ? String(row.phone) : undefined,
      status: String(row.status) === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      commissionRate: Number(row.commission_rate) || 0,
      createdAt: String(row.created_at),
      notes: row.notes ? String(row.notes) : undefined,
    };
  }

  private mapTicketRow(row: Record<string, SqlValue>): BetTicket {
    const timestamp = Number(row.timestamp) || 0;
    const settledAt =
      row.settled_at !== null && row.settled_at !== undefined ? Number(row.settled_at) : null;
    const dateSourceMs = settledAt && settledAt > 0 ? settledAt : timestamp || Date.now();

    return {
      ticketId: String(row.ticket_id),
      userId: String(row.user_id),
      username: row.username ? String(row.username) : undefined,
      roundId: String(row.round_id),
      createdAt: String(row.created_at),
      dateYmd: formatCambodiaDateYmd(dateSourceMs),
      timestamp,
      settledAt,
      channels: JSON.parse(String(row.channels_json || '[]')),
      numbers: JSON.parse(String(row.numbers_json || '[]')),
      stakePerUnit: Number(row.stake_per_unit) || 0,
      totalBetsCount: Number(row.total_bets_count) || 0,
      totalCost: Number(row.total_cost) || 0,
      status: String(row.status) as BetTicket['status'],
      wonAmount: Number(row.won_amount) || 0,
      winningHits: JSON.parse(String(row.winning_hits_json || '[]')),
    };
  }

  private mapTransactionRow(row: Record<string, SqlValue>): BalanceTransaction {
    return {
      transactionId: String(row.transaction_id),
      userId: String(row.user_id),
      userName: String(row.user_name),
      userRole: String(row.user_role) === 'OWNER' ? 'OWNER' : 'PLAYER',
      type: String(row.type) as TransactionType,
      amount: Number(row.amount) || 0,
      previousBalance: Number(row.previous_balance) || 0,
      newBalance: Number(row.new_balance) || 0,
      paymentMethod: String(row.payment_method),
      note: row.note ? String(row.note) : undefined,
      adminId: String(row.admin_id),
      timestamp: Number(row.timestamp) || 0,
      createdAt: String(row.created_at),
    };
  }

  private recordAuditLogInternal(
    actorId: string,
    actorUsername: string,
    action: string,
    targetId: string | undefined,
    details: string
  ): void {
    const now = Date.now();
    const { dateTimeYmdHm } = formatDateTimeNow(new Date(now));
    this.db.run(
      `INSERT INTO audit_logs (actor_id, actor_username, action, target_id, details, timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [actorId, actorUsername, action, targetId || null, details, now, dateTimeYmdHm]
    );
  }

  recordAuditLog(
    actor: Pick<AppUser, 'id' | 'username'>,
    action: string,
    targetId: string | undefined,
    details: string
  ): void {
    this.runInTransaction(() => {
      this.recordAuditLogInternal(actor.id, actor.username, action, targetId, details);
    });
  }

  // =========================================================================
  // OWNER & AUTHENTICATION
  // =========================================================================

  hasOwnerAccount(): boolean {
    const row = this.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM accounts WHERE role = 'OWNER'`
    );
    return Number(row?.cnt || 0) > 0;
  }

  createOrUpdateOwnerAccount(username: string, password: string, name = 'Platform Owner'): AppUser {
    const cleanUsername = username.trim();
    if (!cleanUsername || !password || password.length < 6) {
      throw new Error('Owner username and password (min 6 characters) are required.');
    }
    const lower = cleanUsername.toLowerCase();
    const now = Date.now();
    const { dateYmd } = formatDateTimeNow(new Date(now));
    const pwHash = hashPassword(password);

    return this.runInTransaction(() => {
      const existing = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM accounts WHERE role = 'OWNER' LIMIT 1`
      );
      if (existing) {
        const ownerId = String(existing.id);
        this.db.run(
          `UPDATE accounts
           SET username = ?, username_lower = ?, name = ?, password_hash = ?, status = 'ACTIVE', updated_at = ?
           WHERE id = ?`,
          [cleanUsername, lower, name, pwHash, now, ownerId]
        );
        this.db.run(`UPDATE sessions SET revoked = 1 WHERE account_id = ?`, [ownerId]);
        this.recordAuditLogInternal(
          ownerId,
          cleanUsername,
          'OWNER_INITIALIZED',
          ownerId,
          `Owner account credentials updated via secure CLI initialization.`
        );
        const updated = this.queryOne<Record<string, SqlValue>>(
          `SELECT * FROM accounts WHERE id = ?`,
          [ownerId]
        )!;
        return this.mapAccountRow(updated);
      }

      const ownerId = `OWNER_${cleanUsername.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'ROOT'}`;
      this.db.run(
        `INSERT INTO accounts (
          id, username, username_lower, name, role, password_hash, balance, credit_limit,
          phone, status, commission_rate, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'OWNER', ?, 0, 0, NULL, 'ACTIVE', 0, 'Platform Owner', ?, ?)`,
        [ownerId, cleanUsername, lower, name, pwHash, dateYmd, now]
      );
      this.recordAuditLogInternal(
        ownerId,
        cleanUsername,
        'OWNER_INITIALIZED',
        ownerId,
        `Initial OWNER account created securely.`
      );
      const created = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM accounts WHERE id = ?`,
        [ownerId]
      )!;
      return this.mapAccountRow(created);
    });
  }

  authenticateOwner(username: string, password: string): { token: string; account: AppUser } | null {
    const clean = username.trim().toLowerCase();
    if (!clean || !password) return null;

    const row = this.queryOne<Record<string, SqlValue>>(
      `SELECT * FROM accounts WHERE (username_lower = ? OR LOWER(id) = ?) AND role = 'OWNER' LIMIT 1`,
      [clean, clean]
    );
    if (!row) return null;
    if (String(row.status) !== 'ACTIVE') return null;
    if (!verifyPassword(password, String(row.password_hash))) return null;

    const account = this.mapAccountRow(row);
    const token = this.runInTransaction(() => {
      const tok = generateSessionToken();
      const now = Date.now();
      this.db.run(
        `INSERT INTO sessions (token, account_id, role, created_at, expires_at, revoked)
         VALUES (?, ?, 'OWNER', ?, ?, 0)`,
        [tok, account.id, now, now + SESSION_TTL_MS]
      );
      this.recordAuditLogInternal(
        account.id,
        account.username,
        'OWNER_LOGIN',
        account.id,
        'Owner signed in to Admin Panel.'
      );
      return tok;
    });

    return { token, account };
  }

  authenticatePlayer(
    identifier: string,
    password: string
  ): { ok: true; token: string; account: AppUser } | { ok: false; code: 'INVALID' | 'SUSPENDED' } {
    const clean = identifier.trim().toLowerCase();
    if (!clean || !password) return { ok: false, code: 'INVALID' };

    const normalizedPhone = identifier.replace(/\s+/g, '');
    const row = this.queryOne<Record<string, SqlValue>>(
      `SELECT * FROM accounts
       WHERE role = 'PLAYER'
         AND (username_lower = ? OR LOWER(id) = ? OR REPLACE(COALESCE(phone, ''), ' ', '') = ?)
       LIMIT 1`,
      [clean, clean, normalizedPhone]
    );
    if (!row) return { ok: false, code: 'INVALID' };

    if (!verifyPassword(password, String(row.password_hash))) {
      return { ok: false, code: 'INVALID' };
    }

    if (String(row.status) !== 'ACTIVE') {
      return { ok: false, code: 'SUSPENDED' };
    }

    const account = this.mapAccountRow(row);
    const token = this.runInTransaction(() => {
      const tok = generateSessionToken();
      const now = Date.now();
      this.db.run(
        `INSERT INTO sessions (token, account_id, role, created_at, expires_at, revoked)
         VALUES (?, ?, 'PLAYER', ?, ?, 0)`,
        [tok, account.id, now, now + SESSION_TTL_MS]
      );
      return tok;
    });

    return { ok: true, token, account };
  }

  verifySession(token: string, requiredRole?: 'OWNER' | 'PLAYER'): AppUser | null {
    if (!token) return null;
    const now = Date.now();
    const row = this.queryOne<Record<string, SqlValue>>(
      `SELECT a.*
       FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.token = ? AND s.revoked = 0 AND s.expires_at > ?
       LIMIT 1`,
      [token, now]
    );
    if (!row) return null;
    const account = this.mapAccountRow(row);
    if (account.status !== 'ACTIVE') return null;
    if (requiredRole && account.role !== requiredRole) return null;
    return account;
  }

  revokeSession(token: string): void {
    if (!token) return;
    this.runInTransaction(() => {
      this.db.run(`UPDATE sessions SET revoked = 1 WHERE token = ?`, [token]);
    });
  }

  changeOwnerPassword(owner: AppUser, currentPassword: string, newPassword: string): void {
    if (!newPassword || newPassword.trim().length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    const row = this.queryOne<Record<string, SqlValue>>(
      `SELECT password_hash FROM accounts WHERE id = ? AND role = 'OWNER'`,
      [owner.id]
    );
    if (!row || !verifyPassword(currentPassword, String(row.password_hash))) {
      throw new Error('Current password is incorrect.');
    }

    const newHash = hashPassword(newPassword.trim());
    this.runInTransaction(() => {
      this.db.run(`UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?`, [
        newHash,
        Date.now(),
        owner.id,
      ]);
      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        'CHANGE_OWNER_PASSWORD',
        owner.id,
        'Owner changed their administrative password.'
      );
    });
  }

  // =========================================================================
  // PLAYER MANAGEMENT (OWNER ONLY)
  // =========================================================================

  listPlayers(): AppUser[] {
    const rows = this.queryAll<Record<string, SqlValue>>(
      `SELECT * FROM accounts WHERE role = 'PLAYER' ORDER BY updated_at DESC, created_at DESC`
    );
    return rows.map((r) => this.mapAccountRow(r));
  }

  getAccountById(id: string): AppUser | null {
    const row = this.queryOne<Record<string, SqlValue>>(
      `SELECT * FROM accounts WHERE id = ? LIMIT 1`,
      [id]
    );
    return row ? this.mapAccountRow(row) : null;
  }

  createPlayer(
    owner: AppUser,
    input: {
      id?: string;
      username?: string;
      name: string;
      password: string;
      balance?: number;
      creditLimit?: number;
      phone?: string;
      notes?: string;
    }
  ): AppUser {
    const cleanUsername = (input.username || input.id || '').trim();
    const cleanId = (input.id || cleanUsername || generateUniqueCode('USR_')).trim().toUpperCase();
    const cleanName = (input.name || cleanUsername || cleanId).trim();
    const cleanPassword = (input.password || '').trim();

    if (!cleanUsername || cleanUsername.length < 3) {
      throw new Error('Username must be at least 3 characters.');
    }
    if (!cleanPassword || cleanPassword.length < 4) {
      throw new Error('Password must be at least 4 characters.');
    }

    const initialBalance = Math.max(0, Math.round(Number(input.balance) || 0));
    const creditLimit = Math.max(0, Math.round(Number(input.creditLimit) || 2000000));
    const now = Date.now();
    const { dateYmd, dateTimeYmdHm } = formatDateTimeNow(new Date(now));

    return this.runInTransaction(() => {
      const dup = this.queryOne<{ id: string }>(
        `SELECT id FROM accounts WHERE id = ? OR username_lower = ? LIMIT 1`,
        [cleanId, cleanUsername.toLowerCase()]
      );
      if (dup) {
        throw new Error('Account ID or Username already exists.');
      }

      const pwHash = hashPassword(cleanPassword);
      this.db.run(
        `INSERT INTO accounts (
          id, username, username_lower, name, role, password_hash, balance, credit_limit,
          phone, status, commission_rate, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'PLAYER', ?, ?, ?, ?, 'ACTIVE', 0, ?, ?, ?)`,
        [
          cleanId,
          cleanUsername,
          cleanUsername.toLowerCase(),
          cleanName,
          pwHash,
          initialBalance,
          creditLimit,
          input.phone?.trim() || null,
          input.notes?.trim() || null,
          dateYmd,
          now,
        ]
      );

      if (initialBalance > 0) {
        this.db.run(
          `INSERT INTO transactions (
            transaction_id, user_id, user_name, user_role, type, amount,
            previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
          ) VALUES (?, ?, ?, 'PLAYER', 'DEPOSIT', ?, 0, ?, 'Initial Deposit', 'Initial balance on account creation', ?, ?, ?)`,
          [
            generateUniqueCode('TX-'),
            cleanId,
            cleanName,
            initialBalance,
            initialBalance,
            owner.username,
            now,
            dateTimeYmdHm,
          ]
        );
      }

      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        'CREATE_PLAYER',
        cleanId,
        `Created player ${cleanUsername} (${cleanName}) with initial balance ${initialBalance} KHR.`
      );

      const created = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM accounts WHERE id = ?`,
        [cleanId]
      )!;
      return this.mapAccountRow(created);
    });
  }

  resetPlayerPassword(owner: AppUser, playerId: string, newPassword: string): void {
    const clean = newPassword.trim();
    if (!clean || clean.length < 4) {
      throw new Error('Password must be at least 4 characters.');
    }

    this.runInTransaction(() => {
      const target = this.queryOne<Record<string, SqlValue>>(
        `SELECT id, username FROM accounts WHERE id = ? AND role = 'PLAYER'`,
        [playerId]
      );
      if (!target) {
        throw new Error('Player account not found.');
      }

      this.db.run(`UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?`, [
        hashPassword(clean),
        Date.now(),
        playerId,
      ]);
      // Revoke active player sessions so old sessions cannot continue
      this.db.run(`UPDATE sessions SET revoked = 1 WHERE account_id = ?`, [playerId]);

      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        'RESET_PLAYER_PASSWORD',
        playerId,
        `Reset password for player ${String(target.username)} (${playerId}).`
      );
    });
  }

  togglePlayerStatus(owner: AppUser, playerId: string, explicitStatus?: 'ACTIVE' | 'SUSPENDED'): AppUser {
    return this.runInTransaction(() => {
      const target = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM accounts WHERE id = ? AND role = 'PLAYER'`,
        [playerId]
      );
      if (!target) {
        throw new Error('Player account not found.');
      }

      const nextStatus: 'ACTIVE' | 'SUSPENDED' =
        explicitStatus || (String(target.status) === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');

      this.db.run(`UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?`, [
        nextStatus,
        Date.now(),
        playerId,
      ]);

      if (nextStatus === 'SUSPENDED') {
        this.db.run(`UPDATE sessions SET revoked = 1 WHERE account_id = ?`, [playerId]);
      }

      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        nextStatus === 'SUSPENDED' ? 'DISABLE_PLAYER' : 'ACTIVATE_PLAYER',
        playerId,
        `Changed status of player ${String(target.username)} (${playerId}) to ${nextStatus}.`
      );

      const updated = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM accounts WHERE id = ?`,
        [playerId]
      )!;
      return this.mapAccountRow(updated);
    });
  }

  deletePlayer(owner: AppUser, playerId: string): void {
    this.runInTransaction(() => {
      const target = this.queryOne<Record<string, SqlValue>>(
        `SELECT id, username, name FROM accounts WHERE id = ? AND role = 'PLAYER'`,
        [playerId]
      );
      if (!target) {
        throw new Error('Player account not found.');
      }

      const pendingRow = this.queryOne<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM bet_tickets WHERE user_id = ? AND status = 'PENDING'`,
        [playerId]
      );
      if (Number(pendingRow?.cnt || 0) > 0) {
        throw new Error('Cannot delete player while they have pending bets in the current round.');
      }

      this.db.run(`UPDATE sessions SET revoked = 1 WHERE account_id = ?`, [playerId]);
      this.db.run(`DELETE FROM accounts WHERE id = ? AND role = 'PLAYER'`, [playerId]);

      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        'DELETE_PLAYER',
        playerId,
        `Deleted player account ${String(target.username)} (${String(target.name)}).`
      );
    });
  }

  // =========================================================================
  // CASHIER TRANSACTIONS (ATOMIC WALLET DEPOSIT / WITHDRAWAL / SET)
  // =========================================================================

  processCashierTransaction(
    owner: AppUser,
    input: {
      userId: string;
      type: 'DEPOSIT' | 'WITHDRAWAL' | 'SET';
      amount: number;
      paymentMethod: string;
      note?: string;
    }
  ): { transaction: BalanceTransaction; account: AppUser } {
    const amount = Math.round(Number(input.amount));
    if (!Number.isFinite(amount) || (input.type === 'SET' ? amount < 0 : amount <= 0)) {
      throw new Error('Invalid transaction amount.');
    }

    const now = Date.now();
    const { dateTimeYmdHm } = formatDateTimeNow(new Date(now));

    return this.runInTransaction(() => {
      const targetRow = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM accounts WHERE id = ? AND role = 'PLAYER'`,
        [input.userId]
      );
      if (!targetRow) {
        throw new Error('Selected player account not found.');
      }

      const previousBalance = Number(targetRow.balance) || 0;
      let newBalance = previousBalance;

      if (input.type === 'DEPOSIT') {
        newBalance = previousBalance + amount;
      } else if (input.type === 'WITHDRAWAL') {
        if (amount > previousBalance) {
          throw new Error(
            `Insufficient balance for withdrawal (available: ${previousBalance} KHR, requested: ${amount} KHR).`
          );
        }
        newBalance = previousBalance - amount;
      } else {
        newBalance = amount;
      }

      this.db.run(`UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`, [
        newBalance,
        now,
        input.userId,
      ]);

      const txId = generateUniqueCode('TX-');
      const paymentMethod = (input.paymentMethod || 'ABA Bank').trim();
      const note = input.note?.trim() || null;

      this.db.run(
        `INSERT INTO transactions (
          transaction_id, user_id, user_name, user_role, type, amount,
          previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
        ) VALUES (?, ?, ?, 'PLAYER', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          txId,
          input.userId,
          String(targetRow.name),
          input.type,
          amount,
          previousBalance,
          newBalance,
          paymentMethod,
          note,
          owner.username,
          now,
          dateTimeYmdHm,
        ]
      );

      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        `CASHIER_${input.type}`,
        input.userId,
        `${input.type} ${amount} KHR via ${paymentMethod} for ${String(targetRow.username)} (${previousBalance} -> ${newBalance}).`
      );

      const updatedAccount = this.mapAccountRow(
        this.queryOne<Record<string, SqlValue>>(`SELECT * FROM accounts WHERE id = ?`, [
          input.userId,
        ])!
      );
      const txRow = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM transactions WHERE transaction_id = ?`,
        [txId]
      )!;
      return {
        transaction: this.mapTransactionRow(txRow),
        account: updatedAccount,
      };
    });
  }

  // =========================================================================
  // BETTING (ATOMIC SERVER-VALIDATED WAGERS)
  // =========================================================================

  placePlayerBet(
    player: AppUser,
    input: {
      channels: ChannelLetter[];
      numbers: string[];
      stakePerUnit: number;
      clientRequestId?: string;
    },
    currentRoundId: string,
    isDrawing: boolean
  ): { ticket: BetTicket; newBalance: number; duplicate: boolean } {
    const meta = this.getPersistedMeta();
    const config = meta.systemConfig;
    if (!config.isSystemOpen) {
      throw new Error('Lottery betting is currently paused by the Owner.');
    }
    if (isDrawing) {
      throw new Error('Draw is currently in progress. Please wait for the next round.');
    }
    const nowCheck = Date.now();
    const remainingSeconds = Math.ceil((meta.roundEndTime - nowCheck) / 1000);
    if (nowCheck >= meta.roundEndTime || remainingSeconds <= 10) {
      throw new Error('BETTING_CLOSED: Betting Closed — Wait for Next Round.');
    }

    const validChannels: ChannelLetter[] = ['A', 'B', 'C', 'D', 'E'];
    const channels = Array.from(new Set(input.channels || [])).filter((c): c is ChannelLetter =>
      validChannels.includes(c)
    );
    if (channels.length === 0) {
      throw new Error('At least one valid channel (A-E) must be selected.');
    }

    const numbers = Array.from(
      new Set(
        (input.numbers || []).map((n) => String(n).trim().padStart(2, '0'))
      )
    ).filter((n) => /^(0[1-9]|[1-9][0-9])$/.test(n));
    if (numbers.length === 0) {
      throw new Error('At least one valid number (01-99) must be selected.');
    }

    const stakePerUnit = Math.round(Number(input.stakePerUnit));
    if (!Number.isFinite(stakePerUnit) || stakePerUnit <= 0) {
      throw new Error('Stake per unit must be a positive amount.');
    }
    if (stakePerUnit < config.minBetAmount) {
      throw new Error(`Minimum stake per unit is ${config.minBetAmount} KHR.`);
    }
    if (stakePerUnit > config.maxBetAmount) {
      throw new Error(`Maximum stake per unit is ${config.maxBetAmount} KHR.`);
    }

    const totalBetsCount = channels.length * numbers.length;
    const totalCost = totalBetsCount * stakePerUnit;
    if (!Number.isFinite(totalCost) || totalCost <= 0) {
      throw new Error('Invalid total bet cost.');
    }

    const now = Date.now();
    const { dateTimeYmdHm } = formatDateTimeNow(new Date(now));
    const clientReqId = input.clientRequestId?.trim() || null;

    return this.runInTransaction(() => {
      // Re-verify authoritative betting deadline inside the atomic transaction
      const latestMeta = this.getPersistedMeta();
      const latestRoundId = `26292#${latestMeta.currentRoundNumber}`;
      if (!latestMeta.systemConfig.isSystemOpen) {
        throw new Error('Lottery betting is currently paused by the Owner.');
      }
      if (latestRoundId !== currentRoundId || Date.now() >= latestMeta.roundEndTime) {
        throw new Error('Betting is closed for this round. Please wait for the next round.');
      }

      // Idempotency check to prevent accidental duplicate bets
      if (clientReqId) {
        const existingTicket = this.queryOne<Record<string, SqlValue>>(
          `SELECT * FROM bet_tickets WHERE client_request_id = ? LIMIT 1`,
          [clientReqId]
        );
        if (existingTicket) {
          const freshAccount = this.queryOne<Record<string, SqlValue>>(
            `SELECT balance FROM accounts WHERE id = ?`,
            [player.id]
          );
          return {
            ticket: this.mapTicketRow(existingTicket),
            newBalance: Number(freshAccount?.balance || 0),
            duplicate: true,
          };
        }
      }

      const accRow = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM accounts WHERE id = ? AND role = 'PLAYER'`,
        [player.id]
      );
      if (!accRow) {
        throw new Error('Player account not found.');
      }
      if (String(accRow.status) !== 'ACTIVE') {
        throw new Error('Account is disabled and cannot place bets.');
      }

      const currentBalance = Number(accRow.balance) || 0;
      if (currentBalance < totalCost) {
        throw new Error(
          `Insufficient wallet balance (available: ${currentBalance} KHR, required: ${totalCost} KHR).`
        );
      }

      const newBalance = currentBalance - totalCost;
      this.db.run(
        `UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ? AND balance >= ?`,
        [newBalance, now, player.id, totalCost]
      );

      const ticketId = generateUniqueCode('TK-');
      this.db.run(
        `INSERT INTO bet_tickets (
          ticket_id, client_request_id, user_id, round_id, created_at, timestamp,
          channels_json, numbers_json, stake_per_unit, total_bets_count,
          total_cost, status, won_amount, winning_hits_json, settled_at, payout_credited
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, '[]', NULL, 0)`,
        [
          ticketId,
          clientReqId,
          player.id,
          currentRoundId,
          dateTimeYmdHm,
          now,
          JSON.stringify(channels),
          JSON.stringify(numbers),
          stakePerUnit,
          totalBetsCount,
          totalCost,
        ]
      );

      this.db.run(
        `INSERT INTO transactions (
          transaction_id, user_id, user_name, user_role, type, amount,
          previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
        ) VALUES (?, ?, ?, 'PLAYER', 'BET', ?, ?, ?, 'Lottery Wager', ?, 'SYSTEM', ?, ?)`,
        [
          generateUniqueCode('TX-'),
          player.id,
          String(accRow.name),
          totalCost,
          currentBalance,
          newBalance,
          `Bet ${ticketId} on round ${currentRoundId} (${channels.join(',')} x ${numbers.length} nums)`,
          now,
          dateTimeYmdHm,
        ]
      );

      const ticketRow = this.queryOne<Record<string, SqlValue>>(
        `SELECT t.*, a.username
         FROM bet_tickets t
         LEFT JOIN accounts a ON a.id = t.user_id
         WHERE t.ticket_id = ?`,
        [ticketId]
      )!;
      return {
        ticket: this.mapTicketRow(ticketRow),
        newBalance,
        duplicate: false,
      };
    });
  }

  voidPendingTicket(owner: AppUser, ticketId: string): { ticket: BetTicket; refundedAmount: number } {
    const now = Date.now();
    const { dateTimeYmdHm } = formatDateTimeNow(new Date(now));

    return this.runInTransaction(() => {
      const ticketRow = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM bet_tickets WHERE ticket_id = ? AND status = 'PENDING'`,
        [ticketId]
      );
      if (!ticketRow) {
        throw new Error('Ticket not found or already settled/voided.');
      }

      const userId = String(ticketRow.user_id);
      const refund = Number(ticketRow.total_cost) || 0;

      this.db.run(
        `UPDATE bet_tickets SET status = 'VOID', won_amount = 0, settled_at = ?, payout_credited = 1
         WHERE ticket_id = ? AND status = 'PENDING'`,
        [now, ticketId]
      );

      const accRow = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM accounts WHERE id = ?`,
        [userId]
      );
      if (accRow) {
        const prevBal = Number(accRow.balance) || 0;
        const nextBal = prevBal + refund;
        this.db.run(`UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`, [
          nextBal,
          now,
          userId,
        ]);
        this.db.run(
          `INSERT INTO transactions (
            transaction_id, user_id, user_name, user_role, type, amount,
            previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
          ) VALUES (?, ?, ?, 'PLAYER', 'REFUND', ?, ?, ?, 'Ticket Void', ?, ?, ?, ?)`,
          [
            generateUniqueCode('TX-'),
            userId,
            String(accRow.name),
            refund,
            prevBal,
            nextBal,
            `Refund voided ticket ${ticketId}`,
            owner.username,
            now,
            dateTimeYmdHm,
          ]
        );
      }

      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        'VOID_TICKET',
        ticketId,
        `Voided ticket ${ticketId} for player ${userId} and refunded ${refund} KHR.`
      );

      const updated = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM bet_tickets WHERE ticket_id = ?`,
        [ticketId]
      )!;
      return { ticket: this.mapTicketRow(updated), refundedAmount: refund };
    });
  }

  getPlayerTickets(userId: string): BetTicket[] {
    const rows = this.queryAll<Record<string, SqlValue>>(
      `SELECT t.*, a.username
       FROM bet_tickets t
       LEFT JOIN accounts a ON a.id = t.user_id
       WHERE t.user_id = ?
       ORDER BY t.timestamp DESC
       LIMIT 10000`,
      [userId]
    );
    return rows.map((r) => this.mapTicketRow(r));
  }

  getAllTickets(): BetTicket[] {
    const rows = this.queryAll<Record<string, SqlValue>>(
      `SELECT t.*, a.username
       FROM bet_tickets t
       LEFT JOIN accounts a ON a.id = t.user_id
       ORDER BY t.timestamp DESC
       LIMIT 500`
    );
    return rows.map((r) => this.mapTicketRow(r));
  }

  getPlayerTransactions(userId: string): BalanceTransaction[] {
    const rows = this.queryAll<Record<string, SqlValue>>(
      `SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 200`,
      [userId]
    );
    return rows.map((r) => this.mapTransactionRow(r));
  }

  getAllTransactions(): BalanceTransaction[] {
    const rows = this.queryAll<Record<string, SqlValue>>(
      `SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 500`
    );
    return rows.map((r) => this.mapTransactionRow(r));
  }

  // =========================================================================
  // ROUNDS, SETTLEMENT (EXACTLY ONCE), & SYSTEM CONFIG
  // =========================================================================

  getPersistedMeta(): PersistedRoundMeta {
    const row = this.queryOne<Record<string, SqlValue>>(
      `SELECT * FROM system_config WHERE id = 1`
    )!;
    return {
      currentRoundNumber: Number(row.current_round_number) || 149,
      roundStartTime: Number(row.round_start_time) || Date.now(),
      roundEndTime: Number(row.round_end_time) || Date.now() + 300000,
      forcedNextNumbers: row.forced_numbers_json
        ? JSON.parse(String(row.forced_numbers_json))
        : null,
      systemConfig: {
        payoutRate: Number(row.payout_rate) || 91,
        drawIntervalSeconds: Number(row.draw_interval_seconds) || 300,
        minBetAmount: Number(row.min_bet_amount) || 100,
        maxBetAmount: Number(row.max_bet_amount) || 5000000,
        isSystemOpen: Number(row.is_system_open) === 1,
        autoDrawEnabled: Number(row.auto_draw_enabled) === 1,
      },
    };
  }

  getPastRounds(limit = 50): RoundResult[] {
    const rows = this.queryAll<Record<string, SqlValue>>(
      `SELECT * FROM rounds ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
    return rows.map((r) => ({
      roundId: String(r.round_id),
      drawTime: String(r.draw_time),
      date: String(r.date),
      numbers: {
        A: String(r.num_a),
        B: String(r.num_b),
        C: String(r.num_c),
        D: String(r.num_d),
        E: String(r.num_e),
      },
      timestamp: Number(r.timestamp) || 0,
    }));
  }

  settleRoundAtomic(
    roundId: string,
    numbers: Record<ChannelLetter, string>
  ): {
    alreadySettled: boolean;
    round: RoundResult;
    settledCount: number;
    totalPayout: number;
    nextRoundNumber: number;
    roundStartTime: number;
    roundEndTime: number;
  } {
    const now = Date.now();
    const { dateDmy, timeHm, dateTimeYmdHm } = formatDateTimeNow(new Date(now));

    return this.runInTransaction(() => {
      const meta = this.getPersistedMeta();
      const existingRound = this.queryOne<Record<string, SqlValue>>(
        `SELECT * FROM rounds WHERE round_id = ? LIMIT 1`,
        [roundId]
      );
      if (existingRound) {
        return {
          alreadySettled: true,
          round: {
            roundId: String(existingRound.round_id),
            drawTime: String(existingRound.draw_time),
            date: String(existingRound.date),
            numbers: {
              A: String(existingRound.num_a),
              B: String(existingRound.num_b),
              C: String(existingRound.num_c),
              D: String(existingRound.num_d),
              E: String(existingRound.num_e),
            },
            timestamp: Number(existingRound.timestamp),
          },
          settledCount: 0,
          totalPayout: 0,
          nextRoundNumber: meta.currentRoundNumber,
          roundStartTime: meta.roundStartTime,
          roundEndTime: meta.roundEndTime,
        };
      }

      // 1. Save official round result
      this.db.run(
        `INSERT INTO rounds (round_id, draw_time, date, num_a, num_b, num_c, num_d, num_e, timestamp, settled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [roundId, timeHm, dateDmy, numbers.A, numbers.B, numbers.C, numbers.D, numbers.E, now]
      );

      // 2. Settle all PENDING, uncredited bets for this round EXACTLY ONCE
      const pendingRows = this.queryAll<Record<string, SqlValue>>(
        `SELECT * FROM bet_tickets WHERE round_id = ? AND status = 'PENDING' AND payout_credited = 0`,
        [roundId]
      );

      let settledCount = 0;
      let totalPayout = 0;
      const payoutRate = meta.systemConfig.payoutRate;

      for (const row of pendingRows) {
        const ticket = this.mapTicketRow(row);
        const hits: Array<{ channel: ChannelLetter; number: string; winAmount: number }> = [];

        for (const ch of ticket.channels) {
          const outcome = numbers[ch];
          if (ticket.numbers.includes(outcome)) {
            const winAmt = ticket.stakePerUnit * payoutRate;
            hits.push({ channel: ch, number: outcome, winAmount: winAmt });
          }
        }

        const totalWon = hits.reduce((sum, h) => sum + h.winAmount, 0);
        const finalStatus = totalWon > 0 ? 'WON' : 'LOST';

        this.db.run(
          `UPDATE bet_tickets
           SET status = ?, won_amount = ?, winning_hits_json = ?, settled_at = ?, payout_credited = 1
           WHERE ticket_id = ? AND status = 'PENDING' AND payout_credited = 0`,
          [finalStatus, totalWon, JSON.stringify(hits), now, ticket.ticketId]
        );

        settledCount += 1;

        if (totalWon > 0) {
          totalPayout += totalWon;
          const accRow = this.queryOne<Record<string, SqlValue>>(
            `SELECT * FROM accounts WHERE id = ?`,
            [ticket.userId]
          );
          if (accRow) {
            const prevBal = Number(accRow.balance) || 0;
            const nextBal = prevBal + totalWon;
            this.db.run(`UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`, [
              nextBal,
              now,
              ticket.userId,
            ]);
            this.db.run(
              `INSERT INTO transactions (
                transaction_id, user_id, user_name, user_role, type, amount,
                previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
              ) VALUES (?, ?, ?, 'PLAYER', 'PAYOUT', ?, ?, ?, 'Lottery Payout', ?, 'SYSTEM', ?, ?)`,
              [
                generateUniqueCode('TX-'),
                ticket.userId,
                String(accRow.name),
                totalWon,
                prevBal,
                nextBal,
                `Win payout for ticket ${ticket.ticketId} (${roundId})`,
                now,
                dateTimeYmdHm,
              ]
            );
          }
        }
      }

      // 3. Advance to next round and clear one-time forced numbers
      const nextRoundNumber = meta.currentRoundNumber + 1;
      const durationMs = meta.systemConfig.drawIntervalSeconds * 1000;
      const nextStart = now;
      const nextEnd = now + durationMs;

      this.db.run(
        `UPDATE system_config
         SET forced_numbers_json = NULL,
             current_round_number = ?,
             round_start_time = ?,
             round_end_time = ?
         WHERE id = 1`,
        [nextRoundNumber, nextStart, nextEnd]
      );

      this.recordAuditLogInternal(
        'SYSTEM',
        'SYSTEM',
        'ROUND_SETTLED',
        roundId,
        `Round ${roundId} settled (${numbers.A}-${numbers.B}-${numbers.C}-${numbers.D}-${numbers.E}). Settled ${settledCount} ticket(s), total payouts: ${totalPayout} KHR.`
      );

      return {
        alreadySettled: false,
        round: {
          roundId,
          drawTime: timeHm,
          date: dateDmy,
          numbers,
          timestamp: now,
        },
        settledCount,
        totalPayout,
        nextRoundNumber,
        roundStartTime: nextStart,
        roundEndTime: nextEnd,
      };
    });
  }

  setForcedNextNumbers(
    owner: AppUser,
    numbers: Record<ChannelLetter, string> | null
  ): Record<ChannelLetter, string> | null {
    let cleaned: Record<ChannelLetter, string> | null = null;
    if (numbers !== null) {
      const channels: ChannelLetter[] = ['A', 'B', 'C', 'D', 'E'];
      const result: Partial<Record<ChannelLetter, string>> = {};
      for (const ch of channels) {
        const raw = parseInt(String(numbers[ch]), 10);
        if (isNaN(raw) || raw < 1 || raw > 99) {
          throw new Error(`Invalid number for channel ${ch}. Must be between 01 and 99.`);
        }
        result[ch] = String(raw).padStart(2, '0');
      }
      cleaned = result as Record<ChannelLetter, string>;
    }

    return this.runInTransaction(() => {
      this.db.run(`UPDATE system_config SET forced_numbers_json = ? WHERE id = 1`, [
        cleaned ? JSON.stringify(cleaned) : null,
      ]);
      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        cleaned ? 'SET_FORCED_NUMBERS' : 'CLEAR_FORCED_NUMBERS',
        undefined,
        cleaned
          ? `Set preset draw numbers: A=${cleaned.A}, B=${cleaned.B}, C=${cleaned.C}, D=${cleaned.D}, E=${cleaned.E}.`
          : 'Cleared preset draw numbers (returned to random auto draw).'
      );
      return cleaned;
    });
  }

  updateSystemConfig(owner: AppUser, patch: Partial<SystemConfig>): PersistedRoundMeta {
    return this.runInTransaction(() => {
      const current = this.getPersistedMeta();
      const cfg = current.systemConfig;

      const payoutRate =
        patch.payoutRate !== undefined
          ? Math.max(1, Math.min(99, Math.round(Number(patch.payoutRate))))
          : cfg.payoutRate;
      const drawIntervalSeconds =
        patch.drawIntervalSeconds !== undefined
          ? Math.max(10, Math.min(3600, Math.round(Number(patch.drawIntervalSeconds))))
          : cfg.drawIntervalSeconds;
      const minBetAmount =
        patch.minBetAmount !== undefined
          ? Math.max(10, Math.round(Number(patch.minBetAmount)))
          : cfg.minBetAmount;
      const maxBetAmount =
        patch.maxBetAmount !== undefined
          ? Math.max(minBetAmount, Math.round(Number(patch.maxBetAmount)))
          : Math.max(minBetAmount, cfg.maxBetAmount);
      const isSystemOpen =
        patch.isSystemOpen !== undefined ? Boolean(patch.isSystemOpen) : cfg.isSystemOpen;
      const autoDrawEnabled =
        patch.autoDrawEnabled !== undefined ? Boolean(patch.autoDrawEnabled) : cfg.autoDrawEnabled;

      let roundStartTime = current.roundStartTime;
      let roundEndTime = current.roundEndTime;
      if (patch.drawIntervalSeconds !== undefined && drawIntervalSeconds !== cfg.drawIntervalSeconds) {
        roundStartTime = Date.now();
        roundEndTime = roundStartTime + drawIntervalSeconds * 1000;
      }

      this.db.run(
        `UPDATE system_config
         SET payout_rate = ?,
             draw_interval_seconds = ?,
             min_bet_amount = ?,
             max_bet_amount = ?,
             is_system_open = ?,
             auto_draw_enabled = ?,
             round_start_time = ?,
             round_end_time = ?
         WHERE id = 1`,
        [
          payoutRate,
          drawIntervalSeconds,
          minBetAmount,
          maxBetAmount,
          isSystemOpen ? 1 : 0,
          autoDrawEnabled ? 1 : 0,
          roundStartTime,
          roundEndTime,
        ]
      );

      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        'UPDATE_SYSTEM_CONFIG',
        'system_config',
        `Updated config: payout=1:${payoutRate}, interval=${drawIntervalSeconds}s, minBet=${minBetAmount}, maxBet=${maxBetAmount}, open=${isSystemOpen}, autoDraw=${autoDrawEnabled}.`
      );

      return this.getPersistedMeta();
    });
  }

  deleteRound(owner: AppUser, roundId: string): void {
    this.runInTransaction(() => {
      this.db.run(`DELETE FROM rounds WHERE round_id = ?`, [roundId]);
      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        'DELETE_ROUND',
        roundId,
        `Deleted round record ${roundId} from history.`
      );
    });
  }

  resetRoundHistory(owner: AppUser): void {
    const now = Date.now();
    this.runInTransaction(() => {
      this.db.run(`DELETE FROM rounds`);
      for (const r of INITIAL_PAST_ROUNDS) {
        this.db.run(
          `INSERT INTO rounds (round_id, draw_time, date, num_a, num_b, num_c, num_d, num_e, timestamp, settled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            r.roundId,
            r.drawTime,
            r.date,
            r.numbers.A,
            r.numbers.B,
            r.numbers.C,
            r.numbers.D,
            r.numbers.E,
            r.timestamp || now,
          ]
        );
      }
      const meta = this.getPersistedMeta();
      const nextNum = this.parseNextRoundNumber(INITIAL_PAST_ROUNDS);
      this.db.run(
        `UPDATE system_config
         SET current_round_number = ?, forced_numbers_json = NULL, round_start_time = ?, round_end_time = ?
         WHERE id = 1`,
        [nextNum, now, now + meta.systemConfig.drawIntervalSeconds * 1000]
      );
      this.recordAuditLogInternal(
        owner.id,
        owner.username,
        'RESET_ROUND_HISTORY',
        undefined,
        'Reset round history to initial baseline.'
      );
    });
  }

  // =========================================================================
  // FINANCIAL REPORTS & AUDIT LOGS (A8 & A1)
  // =========================================================================

  computeFinancialReports(): FinancialReportsSummary {
    const players = this.listPlayers();
    // Query ALL tickets and transactions without artificial limits so historical reports always match DB 100%
    const allTicketRows = this.queryAll<Record<string, SqlValue>>(
      `SELECT t.*, a.username, a.name AS account_name
       FROM bet_tickets t
       LEFT JOIN accounts a ON a.id = t.user_id
       ORDER BY COALESCE(t.settled_at, t.timestamp) DESC, t.timestamp DESC`
    );
    const allTransactions = this.queryAll<Record<string, SqlValue>>(
      `SELECT * FROM transactions ORDER BY timestamp DESC`
    ).map((r) => this.mapTransactionRow(r));

    let activePlayers = 0;
    let disabledPlayers = 0;
    let totalPlayerBalances = 0;

    const perPlayerMap = new Map<string, PlayerFinancialReport>();
    for (const p of players) {
      if (p.status === 'ACTIVE') activePlayers += 1;
      else disabledPlayers += 1;
      totalPlayerBalances += p.balance;
      perPlayerMap.set(p.id, {
        userId: p.id,
        username: p.username,
        name: p.name,
        status: p.status,
        balance: p.balance,
        totalBetsCount: 0,
        pendingBetsCount: 0,
        settledBetsCount: 0,
        totalStaked: 0,
        settledStaked: 0,
        totalWon: 0,
        playerNetProfitLoss: 0,
        ownerProfitLoss: 0,
        totalDeposited: 0,
        totalWithdrawn: 0,
      });
    }

    let pendingBetsCount = 0;
    let pendingBetsVolume = 0;
    let settledBetsCount = 0;
    let voidBetsCount = 0;
    let totalValidStakes = 0;
    let settledValidStakes = 0;
    let totalWinningPayouts = 0;

    interface DailyAcc {
      date: string;
      roundIds: Set<string>;
      playerIds: Set<string>;
      settledBetsCount: number;
      totalValidStakes: number;
      totalActualPayouts: number;
    }

    interface RoundAcc {
      date: string;
      roundId: string;
      playerIds: Set<string>;
      settledBetsCount: number;
      totalValidStakes: number;
      totalActualPayouts: number;
    }

    const dailyMap = new Map<string, DailyAcc>();
    const roundMap = new Map<string, RoundAcc>();
    const detailedBets: DetailedBetReportRow[] = [];

    for (const row of allTicketRows) {
      const t = this.mapTicketRow(row);
      const dateYmd = t.dateYmd || formatCambodiaDateYmd(t.settledAt ?? t.timestamp);
      const username = t.username || t.userId;
      const playerName = row.account_name ? String(row.account_name) : username;

      if (t.status === 'VOID') {
        voidBetsCount += 1;
        detailedBets.push({
          ticketId: t.ticketId,
          dateYmd,
          roundId: t.roundId,
          userId: t.userId,
          username,
          playerName,
          status: t.status,
          stake: t.totalCost,
          payout: 0,
          playerNetWinLoss: null,
          ownerNetWinLoss: null,
          channels: t.channels,
          numbers: t.numbers,
          createdAt: t.createdAt,
          timestamp: t.timestamp,
          settledAt: t.settledAt ?? null,
        });
        continue;
      }

      if (t.status === 'PENDING') {
        totalValidStakes += t.totalCost;
        pendingBetsCount += 1;
        pendingBetsVolume += t.totalCost;

        const pr = perPlayerMap.get(t.userId);
        if (pr) {
          pr.totalBetsCount += 1;
          pr.totalStaked += t.totalCost;
          pr.pendingBetsCount += 1;
        }

        detailedBets.push({
          ticketId: t.ticketId,
          dateYmd,
          roundId: t.roundId,
          userId: t.userId,
          username,
          playerName,
          status: t.status,
          stake: t.totalCost,
          payout: 0,
          playerNetWinLoss: null,
          ownerNetWinLoss: null,
          channels: t.channels,
          numbers: t.numbers,
          createdAt: t.createdAt,
          timestamp: t.timestamp,
          settledAt: null,
        });
        continue;
      }

      // Settled bets ONLY (status === 'WON' || status === 'LOST')
      const stake = t.totalCost;
      const payout = t.wonAmount;
      const playerNet = payout - stake;
      const ownerNet = stake - payout;

      totalValidStakes += stake;
      settledBetsCount += 1;
      settledValidStakes += stake;
      totalWinningPayouts += payout;

      const pr = perPlayerMap.get(t.userId);
      if (pr) {
        pr.totalBetsCount += 1;
        pr.totalStaked += stake;
        pr.settledBetsCount += 1;
        pr.settledStaked += stake;
        pr.totalWon += payout;
      }

      // Group by Asia/Phnom_Penh calendar date (YYYY-MM-DD)
      let dayAcc = dailyMap.get(dateYmd);
      if (!dayAcc) {
        dayAcc = {
          date: dateYmd,
          roundIds: new Set<string>(),
          playerIds: new Set<string>(),
          settledBetsCount: 0,
          totalValidStakes: 0,
          totalActualPayouts: 0,
        };
        dailyMap.set(dateYmd, dayAcc);
      }
      dayAcc.roundIds.add(t.roundId);
      dayAcc.playerIds.add(t.userId);
      dayAcc.settledBetsCount += 1;
      dayAcc.totalValidStakes += stake;
      dayAcc.totalActualPayouts += payout;

      // Group by Date (YYYY-MM-DD) + Round ID
      const roundKey = `${dateYmd}|${t.roundId}`;
      let rndAcc = roundMap.get(roundKey);
      if (!rndAcc) {
        rndAcc = {
          date: dateYmd,
          roundId: t.roundId,
          playerIds: new Set<string>(),
          settledBetsCount: 0,
          totalValidStakes: 0,
          totalActualPayouts: 0,
        };
        roundMap.set(roundKey, rndAcc);
      }
      rndAcc.playerIds.add(t.userId);
      rndAcc.settledBetsCount += 1;
      rndAcc.totalValidStakes += stake;
      rndAcc.totalActualPayouts += payout;

      detailedBets.push({
        ticketId: t.ticketId,
        dateYmd,
        roundId: t.roundId,
        userId: t.userId,
        username,
        playerName,
        status: t.status,
        stake,
        payout,
        playerNetWinLoss: playerNet,
        ownerNetWinLoss: ownerNet,
        channels: t.channels,
        numbers: t.numbers,
        createdAt: t.createdAt,
        timestamp: t.timestamp,
        settledAt: t.settledAt ?? null,
      });
    }

    // Wallet transfers (Deposits & Withdrawals) are tracked separately from betting Win/Loss
    let totalDeposits = 0;
    let totalWithdrawals = 0;

    for (const tx of allTransactions) {
      if (tx.type === 'DEPOSIT') {
        totalDeposits += tx.amount;
        const pr = perPlayerMap.get(tx.userId);
        if (pr) pr.totalDeposited += tx.amount;
      } else if (tx.type === 'WITHDRAWAL') {
        totalWithdrawals += tx.amount;
        const pr = perPlayerMap.get(tx.userId);
        if (pr) pr.totalWithdrawn += tx.amount;
      }
    }

    const playerReports: PlayerFinancialReport[] = Array.from(perPlayerMap.values()).map((pr) => {
      const playerNetProfitLoss = pr.totalWon - pr.settledStaked;
      const ownerProfitLoss = pr.settledStaked - pr.totalWon;
      return {
        ...pr,
        playerNetProfitLoss,
        ownerProfitLoss,
      };
    });

    const dailyReports: DailyFinancialReport[] = Array.from(dailyMap.values())
      .map((d) => ({
        date: d.date,
        roundsCount: d.roundIds.size,
        playersCount: d.playerIds.size,
        settledBetsCount: d.settledBetsCount,
        totalValidStakes: d.totalValidStakes,
        totalActualPayouts: d.totalActualPayouts,
        playerNetWinLoss: d.totalActualPayouts - d.totalValidStakes,
        ownerNetWinLoss: d.totalValidStakes - d.totalActualPayouts,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const extractRoundNum = (roundId: string): number => {
      const m = roundId.match(/#(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };

    const roundReports: RoundFinancialReport[] = Array.from(roundMap.values())
      .map((r) => ({
        date: r.date,
        roundId: r.roundId,
        playersCount: r.playerIds.size,
        settledBetsCount: r.settledBetsCount,
        totalValidStakes: r.totalValidStakes,
        totalActualPayouts: r.totalActualPayouts,
        playerNetWinLoss: r.totalActualPayouts - r.totalValidStakes,
        ownerNetWinLoss: r.totalValidStakes - r.totalActualPayouts,
      }))
      .sort((a, b) => {
        const dateCmp = b.date.localeCompare(a.date);
        if (dateCmp !== 0) return dateCmp;
        return extractRoundNum(b.roundId) - extractRoundNum(a.roundId);
      });

    return {
      totalPlayers: players.length,
      activePlayers,
      disabledPlayers,
      totalPlayerBalances,
      pendingBetsCount,
      pendingBetsVolume,
      settledBetsCount,
      voidBetsCount,
      totalValidStakes,
      settledValidStakes,
      totalWinningPayouts,
      ownerProfitLoss: settledValidStakes - totalWinningPayouts,
      ownerRealizedProfitLoss: settledValidStakes - totalWinningPayouts,
      totalDeposits,
      totalWithdrawals,
      netCashflow: totalDeposits - totalWithdrawals,
      playerReports,
      dailyReports,
      roundReports,
      detailedBets,
    };
  }

  getAuditLogs(limit = 150): AuditLogEntry[] {
    const rows = this.queryAll<Record<string, SqlValue>>(
      `SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?`,
      [limit]
    );
    return rows.map((r) => ({
      id: Number(r.id),
      actorId: String(r.actor_id),
      actorUsername: String(r.actor_username),
      action: String(r.action),
      targetId: r.target_id ? String(r.target_id) : undefined,
      details: String(r.details),
      timestamp: Number(r.timestamp) || 0,
      createdAt: String(r.created_at),
    }));
  }
}

export const db = new LotteryDatabase();
