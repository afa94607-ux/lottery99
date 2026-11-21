import {
  ActiveDrawState,
  AppUser,
  AuditLogEntry,
  BalanceTransaction,
  BetTicket,
  ChannelLetter,
  D1Database,
  D1PreparedStatement,
  DailyFinancialReport,
  DetailedBetReportRow,
  FinancialReportsSummary,
  PersistedRoundMeta,
  PlayerFinancialReport,
  RoundFinancialReport,
  RoundResult,
  SystemConfig,
  TransactionType,
} from './types';
import {
  formatCambodiaDateYmd,
  formatDateTimeNow,
  generateSessionToken,
  generateUniqueCode,
  getCryptoRandomLotteryNumber,
  hashPassword,
  verifyPassword,
} from './security';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  payoutRate: 91,
  drawIntervalSeconds: 300,
  minBetAmount: 100,
  maxBetAmount: 5000000,
  isSystemOpen: true,
  autoDrawEnabled: true,
};

const INITIAL_PAST_ROUNDS: RoundResult[] = [
  {
    roundId: '26292#148',
    drawTime: '12:58',
    date: '19-10-2026',
    numbers: { A: '48', B: '92', C: '83', D: '17', E: '28' },
    timestamp: Date.now() - 30000,
  },
  {
    roundId: '26292#147',
    drawTime: '12:58',
    date: '19-10-2026',
    numbers: { A: '89', B: '85', C: '94', D: '80', E: '97' },
    timestamp: Date.now() - 90000,
  },
  {
    roundId: '26292#146',
    drawTime: '12:58',
    date: '19-10-2026',
    numbers: { A: '20', B: '75', C: '07', D: '20', E: '57' },
    timestamp: Date.now() - 150000,
  },
  {
    roundId: '26292#145',
    drawTime: '12:57',
    date: '19-10-2026',
    numbers: { A: '10', B: '44', C: '33', D: '82', E: '61' },
    timestamp: Date.now() - 210000,
  },
  {
    roundId: '26292#144',
    drawTime: '12:52',
    date: '19-10-2026',
    numbers: { A: '42', B: '38', C: '82', D: '31', E: '49' },
    timestamp: Date.now() - 510000,
  },
  {
    roundId: '26292#143',
    drawTime: '12:47',
    date: '19-10-2026',
    numbers: { A: '10', B: '21', C: '17', D: '01', E: '58' },
    timestamp: Date.now() - 810000,
  },
  {
    roundId: '26292#142',
    drawTime: '12:42',
    date: '19-10-2026',
    numbers: { A: '02', B: '61', C: '34', D: '85', E: '47' },
    timestamp: Date.now() - 1110000,
  },
];

type DbRow = Record<string, unknown>;

export class LotteryD1Database {
  constructor(private readonly db: D1Database) {}

  private mapAccountRow(row: DbRow): AppUser {
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

  private mapTicketRow(row: DbRow): BetTicket {
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

  private mapTransactionRow(row: DbRow): BalanceTransaction {
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

  private auditLogStmt(
    actorId: string,
    actorUsername: string,
    action: string,
    targetId: string | undefined,
    details: string,
    now = Date.now()
  ): D1PreparedStatement {
    const { dateTimeYmdHm } = formatDateTimeNow(new Date(now));
    return this.db
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_username, action, target_id, details, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(actorId, actorUsername, action, targetId || null, details, now, dateTimeYmdHm);
  }

  async ensureSystemConfigRow(): Promise<void> {
    const row = await this.db
      .prepare(`SELECT id FROM system_config WHERE id = 1`)
      .first<DbRow>();
    if (!row) {
      const now = Date.now();
      const duration = DEFAULT_SYSTEM_CONFIG.drawIntervalSeconds;
      await this.db
        .prepare(
          `INSERT INTO system_config (
            id, payout_rate, draw_interval_seconds, min_bet_amount, max_bet_amount,
            is_system_open, auto_draw_enabled, forced_numbers_json,
            current_round_number, round_start_time, round_end_time, is_drawing, active_draw_json
          ) VALUES (1, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, NULL)`
        )
        .bind(
          DEFAULT_SYSTEM_CONFIG.payoutRate,
          duration,
          DEFAULT_SYSTEM_CONFIG.minBetAmount,
          DEFAULT_SYSTEM_CONFIG.maxBetAmount,
          DEFAULT_SYSTEM_CONFIG.isSystemOpen ? 1 : 0,
          DEFAULT_SYSTEM_CONFIG.autoDrawEnabled ? 1 : 0,
          149,
          now,
          now + duration * 1000
        )
        .run();
    }
  }

  // =========================================================================
  // OWNER & AUTHENTICATION
  // =========================================================================

  async hasOwnerAccount(): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM accounts WHERE role = 'OWNER'`)
      .first<{ cnt: number }>();
    return Number(row?.cnt || 0) > 0;
  }

  async authenticateOwner(
    username: string,
    password: string
  ): Promise<{ token: string; account: AppUser } | null> {
    const clean = username.trim().toLowerCase();
    if (!clean || !password) return null;

    const row = await this.db
      .prepare(
        `SELECT * FROM accounts WHERE (username_lower = ? OR LOWER(id) = ?) AND role = 'OWNER' LIMIT 1`
      )
      .bind(clean, clean)
      .first<DbRow>();

    if (!row) return null;
    if (String(row.status) !== 'ACTIVE') return null;
    if (!verifyPassword(password, String(row.password_hash))) return null;

    const account = this.mapAccountRow(row);
    const token = generateSessionToken();
    const now = Date.now();

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO sessions (token, account_id, role, created_at, expires_at, revoked)
           VALUES (?, ?, 'OWNER', ?, ?, 0)`
        )
        .bind(token, account.id, now, now + SESSION_TTL_MS),
      this.auditLogStmt(
        account.id,
        account.username,
        'OWNER_LOGIN',
        account.id,
        'Owner signed in to Admin Panel.',
        now
      ),
    ]);

    return { token, account };
  }

  async authenticatePlayer(
    identifier: string,
    password: string
  ): Promise<
    { ok: true; token: string; account: AppUser } | { ok: false; code: 'INVALID' | 'SUSPENDED' }
  > {
    const clean = identifier.trim().toLowerCase();
    if (!clean || !password) return { ok: false, code: 'INVALID' };

    const normalizedPhone = identifier.replace(/\s+/g, '');
    const row = await this.db
      .prepare(
        `SELECT * FROM accounts
         WHERE role = 'PLAYER'
           AND (username_lower = ? OR LOWER(id) = ? OR REPLACE(COALESCE(phone, ''), ' ', '') = ?)
         LIMIT 1`
      )
      .bind(clean, clean, normalizedPhone)
      .first<DbRow>();

    if (!row) return { ok: false, code: 'INVALID' };
    if (!verifyPassword(password, String(row.password_hash))) {
      return { ok: false, code: 'INVALID' };
    }
    if (String(row.status) !== 'ACTIVE') {
      return { ok: false, code: 'SUSPENDED' };
    }

    const account = this.mapAccountRow(row);
    const token = generateSessionToken();
    const now = Date.now();

    await this.db
      .prepare(
        `INSERT INTO sessions (token, account_id, role, created_at, expires_at, revoked)
         VALUES (?, ?, 'PLAYER', ?, ?, 0)`
      )
      .bind(token, account.id, now, now + SESSION_TTL_MS)
      .run();

    return { ok: true, token, account };
  }

  async verifySession(token: string, requiredRole?: 'OWNER' | 'PLAYER'): Promise<AppUser | null> {
    if (!token) return null;
    const now = Date.now();
    const row = await this.db
      .prepare(
        `SELECT a.*
         FROM sessions s
         JOIN accounts a ON a.id = s.account_id
         WHERE s.token = ? AND s.revoked = 0 AND s.expires_at > ?
         LIMIT 1`
      )
      .bind(token, now)
      .first<DbRow>();

    if (!row) return null;
    const account = this.mapAccountRow(row);
    if (account.status !== 'ACTIVE') return null;
    if (requiredRole && account.role !== requiredRole) return null;
    return account;
  }

  async revokeSession(token: string): Promise<void> {
    if (!token) return;
    await this.db
      .prepare(`UPDATE sessions SET revoked = 1 WHERE token = ?`)
      .bind(token)
      .run();
  }

  async changeOwnerPassword(
    owner: AppUser,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    if (!newPassword || newPassword.trim().length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    const row = await this.db
      .prepare(`SELECT password_hash FROM accounts WHERE id = ? AND role = 'OWNER'`)
      .bind(owner.id)
      .first<DbRow>();

    if (!row || !verifyPassword(currentPassword, String(row.password_hash))) {
      throw new Error('Current password is incorrect.');
    }

    const newHash = hashPassword(newPassword.trim());
    const now = Date.now();
    await this.db.batch([
      this.db
        .prepare(`UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?`)
        .bind(newHash, now, owner.id),
      this.auditLogStmt(
        owner.id,
        owner.username,
        'CHANGE_OWNER_PASSWORD',
        owner.id,
        'Owner changed their administrative password.',
        now
      ),
    ]);
  }

  // =========================================================================
  // PLAYER MANAGEMENT (OWNER ONLY)
  // =========================================================================

  async listPlayers(): Promise<AppUser[]> {
    const res = await this.db
      .prepare(`SELECT * FROM accounts WHERE role = 'PLAYER' ORDER BY updated_at DESC, created_at DESC`)
      .all<DbRow>();
    return (res.results || []).map((r) => this.mapAccountRow(r));
  }

  async getAccountById(id: string): Promise<AppUser | null> {
    const row = await this.db
      .prepare(`SELECT * FROM accounts WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<DbRow>();
    return row ? this.mapAccountRow(row) : null;
  }

  async createPlayer(
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
  ): Promise<AppUser> {
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

    const dup = await this.db
      .prepare(`SELECT id FROM accounts WHERE id = ? OR username_lower = ? LIMIT 1`)
      .bind(cleanId, cleanUsername.toLowerCase())
      .first<{ id: string }>();
    if (dup) {
      throw new Error('Account ID or Username already exists.');
    }

    const initialBalance = Math.max(0, Math.round(Number(input.balance) || 0));
    const creditLimit = Math.max(0, Math.round(Number(input.creditLimit) || 2000000));
    const now = Date.now();
    const { dateYmd, dateTimeYmdHm } = formatDateTimeNow(new Date(now));
    const pwHash = hashPassword(cleanPassword);

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO accounts (
            id, username, username_lower, name, role, password_hash, balance, credit_limit,
            phone, status, commission_rate, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'PLAYER', ?, ?, ?, ?, 'ACTIVE', 0, ?, ?, ?)`
        )
        .bind(
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
          now
        ),
    ];

    if (initialBalance > 0) {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO transactions (
              transaction_id, user_id, user_name, user_role, type, amount,
              previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
            ) VALUES (?, ?, ?, 'PLAYER', 'DEPOSIT', ?, 0, ?, 'Initial Deposit', 'Initial balance on account creation', ?, ?, ?)`
          )
          .bind(
            generateUniqueCode('TX-'),
            cleanId,
            cleanName,
            initialBalance,
            initialBalance,
            owner.username,
            now,
            dateTimeYmdHm
          )
      );
    }

    stmts.push(
      this.auditLogStmt(
        owner.id,
        owner.username,
        'CREATE_PLAYER',
        cleanId,
        `Created player ${cleanUsername} (${cleanName}) with initial balance ${initialBalance} KHR.`,
        now
      )
    );

    await this.db.batch(stmts);
    const created = await this.getAccountById(cleanId);
    if (!created) throw new Error('Failed to create player.');
    return created;
  }

  async resetPlayerPassword(owner: AppUser, playerId: string, newPassword: string): Promise<void> {
    const clean = newPassword.trim();
    if (!clean || clean.length < 4) {
      throw new Error('Password must be at least 4 characters.');
    }

    const target = await this.db
      .prepare(`SELECT id, username FROM accounts WHERE id = ? AND role = 'PLAYER'`)
      .bind(playerId)
      .first<DbRow>();
    if (!target) {
      throw new Error('Player account not found.');
    }

    const now = Date.now();
    await this.db.batch([
      this.db
        .prepare(`UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?`)
        .bind(hashPassword(clean), now, playerId),
      this.db.prepare(`UPDATE sessions SET revoked = 1 WHERE account_id = ?`).bind(playerId),
      this.auditLogStmt(
        owner.id,
        owner.username,
        'RESET_PLAYER_PASSWORD',
        playerId,
        `Reset password for player ${String(target.username)} (${playerId}).`,
        now
      ),
    ]);
  }

  async togglePlayerStatus(
    owner: AppUser,
    playerId: string,
    explicitStatus?: 'ACTIVE' | 'SUSPENDED'
  ): Promise<AppUser> {
    const target = await this.db
      .prepare(`SELECT * FROM accounts WHERE id = ? AND role = 'PLAYER'`)
      .bind(playerId)
      .first<DbRow>();
    if (!target) {
      throw new Error('Player account not found.');
    }

    const nextStatus: 'ACTIVE' | 'SUSPENDED' =
      explicitStatus || (String(target.status) === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
    const now = Date.now();

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(`UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?`)
        .bind(nextStatus, now, playerId),
    ];

    if (nextStatus === 'SUSPENDED') {
      stmts.push(this.db.prepare(`UPDATE sessions SET revoked = 1 WHERE account_id = ?`).bind(playerId));
    }

    stmts.push(
      this.auditLogStmt(
        owner.id,
        owner.username,
        nextStatus === 'SUSPENDED' ? 'DISABLE_PLAYER' : 'ACTIVATE_PLAYER',
        playerId,
        `Changed status of player ${String(target.username)} (${playerId}) to ${nextStatus}.`,
        now
      )
    );

    await this.db.batch(stmts);
    const updated = await this.getAccountById(playerId);
    if (!updated) throw new Error('Player account not found.');
    return updated;
  }

  async deletePlayer(owner: AppUser, playerId: string): Promise<void> {
    const target = await this.db
      .prepare(`SELECT id, username, name FROM accounts WHERE id = ? AND role = 'PLAYER'`)
      .bind(playerId)
      .first<DbRow>();
    if (!target) {
      throw new Error('Player account not found.');
    }

    const pendingRow = await this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM bet_tickets WHERE user_id = ? AND status = 'PENDING'`)
      .bind(playerId)
      .first<{ cnt: number }>();
    if (Number(pendingRow?.cnt || 0) > 0) {
      throw new Error('Cannot delete player while they have pending bets in the current round.');
    }

    await this.db.batch([
      this.db.prepare(`UPDATE sessions SET revoked = 1 WHERE account_id = ?`).bind(playerId),
      this.db.prepare(`DELETE FROM accounts WHERE id = ? AND role = 'PLAYER'`).bind(playerId),
      this.auditLogStmt(
        owner.id,
        owner.username,
        'DELETE_PLAYER',
        playerId,
        `Deleted player account ${String(target.username)} (${String(target.name)}).`
      ),
    ]);
  }

  // =========================================================================
  // CASHIER TRANSACTIONS (ATOMIC WALLET DEPOSIT / WITHDRAWAL / SET)
  // =========================================================================

  async processCashierTransaction(
    owner: AppUser,
    input: {
      userId: string;
      type: 'DEPOSIT' | 'WITHDRAWAL' | 'SET';
      amount: number;
      paymentMethod: string;
      note?: string;
    }
  ): Promise<{ transaction: BalanceTransaction; account: AppUser }> {
    const amount = Math.round(Number(input.amount));
    if (!Number.isFinite(amount) || (input.type === 'SET' ? amount < 0 : amount <= 0)) {
      throw new Error('Invalid transaction amount.');
    }

    const targetRow = await this.db
      .prepare(`SELECT * FROM accounts WHERE id = ? AND role = 'PLAYER'`)
      .bind(input.userId)
      .first<DbRow>();
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

    const now = Date.now();
    const { dateTimeYmdHm } = formatDateTimeNow(new Date(now));
    const txId = generateUniqueCode('TX-');
    const paymentMethod = (input.paymentMethod || 'ABA Bank').trim();
    const note = input.note?.trim() || null;

    const updateStmt =
      input.type === 'WITHDRAWAL'
        ? this.db
            .prepare(`UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`)
            .bind(amount, now, input.userId)
        : input.type === 'DEPOSIT'
          ? this.db
              .prepare(`UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`)
              .bind(amount, now, input.userId)
          : this.db
              .prepare(`UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`)
              .bind(newBalance, now, input.userId);

    await this.db.batch([
      updateStmt,
      this.db
        .prepare(
          `INSERT INTO transactions (
            transaction_id, user_id, user_name, user_role, type, amount,
            previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
          ) VALUES (?, ?, ?, 'PLAYER', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
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
          dateTimeYmdHm
        ),
      this.auditLogStmt(
        owner.id,
        owner.username,
        `CASHIER_${input.type}`,
        input.userId,
        `${input.type} ${amount} KHR via ${paymentMethod} for ${String(targetRow.username)} (${previousBalance} -> ${newBalance}).`,
        now
      ),
    ]);

    const updatedAccount = await this.getAccountById(input.userId);
    const txRow = await this.db
      .prepare(`SELECT * FROM transactions WHERE transaction_id = ?`)
      .bind(txId)
      .first<DbRow>();
    if (!updatedAccount || !txRow) {
      throw new Error('Transaction failed.');
    }

    return {
      transaction: this.mapTransactionRow(txRow),
      account: updatedAccount,
    };
  }

  // =========================================================================
  // BETTING (ATOMIC SERVER-VALIDATED WAGERS)
  // =========================================================================

  async placePlayerBet(
    player: AppUser,
    input: {
      channels: ChannelLetter[];
      numbers: string[];
      stakePerUnit: number;
      clientRequestId?: string;
    }
  ): Promise<{ ticket: BetTicket; newBalance: number; duplicate: boolean }> {
    const meta = await this.getPersistedMeta();
    const config = meta.systemConfig;
    const currentRoundId = `26292#${meta.currentRoundNumber}`;

    if (!config.isSystemOpen) {
      throw new Error('Lottery betting is currently paused by the Owner.');
    }
    if (meta.isDrawing) {
      throw new Error('Draw is currently in progress. Please wait for the next round.');
    }
    if (Date.now() >= meta.roundEndTime) {
      throw new Error('Betting is closed for this round. Please wait for the next round.');
    }

    const validChannels: ChannelLetter[] = ['A', 'B', 'C', 'D', 'E'];
    const channels = Array.from(new Set(input.channels || [])).filter((c): c is ChannelLetter =>
      validChannels.includes(c)
    );
    if (channels.length === 0) {
      throw new Error('At least one valid channel (A-E) must be selected.');
    }

    const numbers = Array.from(
      new Set((input.numbers || []).map((n) => String(n).trim().padStart(2, '0')))
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

    const clientReqId = input.clientRequestId?.trim() || null;

    if (clientReqId) {
      const existingTicket = await this.db
        .prepare(
          `SELECT t.*, a.username
           FROM bet_tickets t
           LEFT JOIN accounts a ON a.id = t.user_id
           WHERE t.client_request_id = ? LIMIT 1`
        )
        .bind(clientReqId)
        .first<DbRow>();
      if (existingTicket) {
        const freshAccount = await this.db
          .prepare(`SELECT balance FROM accounts WHERE id = ?`)
          .bind(player.id)
          .first<{ balance: number }>();
        return {
          ticket: this.mapTicketRow(existingTicket),
          newBalance: Number(freshAccount?.balance || 0),
          duplicate: true,
        };
      }
    }

    const accRow = await this.db
      .prepare(`SELECT * FROM accounts WHERE id = ? AND role = 'PLAYER'`)
      .bind(player.id)
      .first<DbRow>();
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

    const now = Date.now();
    const { dateTimeYmdHm } = formatDateTimeNow(new Date(now));
    const newBalance = currentBalance - totalCost;
    const ticketId = generateUniqueCode('TK-');

    try {
      // Uses SQLite CHECK(balance >= 0) + UNIQUE(client_request_id) inside D1 batch() for atomic rollback
      await this.db.batch([
        this.db
          .prepare(`UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`)
          .bind(totalCost, now, player.id),
        this.db
          .prepare(
            `INSERT INTO bet_tickets (
              ticket_id, client_request_id, user_id, round_id, created_at, timestamp,
              channels_json, numbers_json, stake_per_unit, total_bets_count,
              total_cost, status, won_amount, winning_hits_json, settled_at, payout_credited
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, '[]', NULL, 0)`
          )
          .bind(
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
            totalCost
          ),
        this.db
          .prepare(
            `INSERT INTO transactions (
              transaction_id, user_id, user_name, user_role, type, amount,
              previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
            ) VALUES (?, ?, ?, 'PLAYER', 'BET', ?, ?, ?, 'Lottery Wager', ?, 'SYSTEM', ?, ?)`
          )
          .bind(
            generateUniqueCode('TX-'),
            player.id,
            String(accRow.name),
            totalCost,
            currentBalance,
            newBalance,
            `Bet ${ticketId} on round ${currentRoundId} (${channels.join(',')} x ${numbers.length} nums)`,
            now,
            dateTimeYmdHm
          ),
      ]);
    } catch (err) {
      if (clientReqId) {
        const dupTicket = await this.db
          .prepare(
            `SELECT t.*, a.username
             FROM bet_tickets t
             LEFT JOIN accounts a ON a.id = t.user_id
             WHERE t.client_request_id = ? LIMIT 1`
          )
          .bind(clientReqId)
          .first<DbRow>();
        if (dupTicket) {
          const freshAccount = await this.db
            .prepare(`SELECT balance FROM accounts WHERE id = ?`)
            .bind(player.id)
            .first<{ balance: number }>();
          return {
            ticket: this.mapTicketRow(dupTicket),
            newBalance: Number(freshAccount?.balance || 0),
            duplicate: true,
          };
        }
      }
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('CHECK') || msg.includes('balance')) {
        throw new Error('Insufficient wallet balance for this bet.');
      }
      throw err;
    }

    const ticketRow = await this.db
      .prepare(
        `SELECT t.*, a.username
         FROM bet_tickets t
         LEFT JOIN accounts a ON a.id = t.user_id
         WHERE t.ticket_id = ?`
      )
      .bind(ticketId)
      .first<DbRow>();
    const freshAccount = await this.db
      .prepare(`SELECT balance FROM accounts WHERE id = ?`)
      .bind(player.id)
      .first<{ balance: number }>();

    if (!ticketRow) throw new Error('Failed to create bet ticket.');

    return {
      ticket: this.mapTicketRow(ticketRow),
      newBalance: Number(freshAccount?.balance ?? newBalance),
      duplicate: false,
    };
  }

  async voidPendingTicket(
    owner: AppUser,
    ticketId: string
  ): Promise<{ ticket: BetTicket; refundedAmount: number }> {
    const now = Date.now();
    const { dateTimeYmdHm } = formatDateTimeNow(new Date(now));

    const ticketRow = await this.db
      .prepare(`SELECT * FROM bet_tickets WHERE ticket_id = ? AND status = 'PENDING'`)
      .bind(ticketId)
      .first<DbRow>();
    if (!ticketRow) {
      throw new Error('Ticket not found or already settled/voided.');
    }

    const userId = String(ticketRow.user_id);
    const refund = Number(ticketRow.total_cost) || 0;
    const accRow = await this.db
      .prepare(`SELECT * FROM accounts WHERE id = ?`)
      .bind(userId)
      .first<DbRow>();

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE bet_tickets SET status = 'VOID', won_amount = 0, settled_at = ?, payout_credited = 1
           WHERE ticket_id = ? AND status = 'PENDING'`
        )
        .bind(now, ticketId),
    ];

    if (accRow) {
      const prevBal = Number(accRow.balance) || 0;
      const nextBal = prevBal + refund;
      stmts.push(
        this.db
          .prepare(`UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`)
          .bind(refund, now, userId),
        this.db
          .prepare(
            `INSERT INTO transactions (
              transaction_id, user_id, user_name, user_role, type, amount,
              previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
            ) VALUES (?, ?, ?, 'PLAYER', 'REFUND', ?, ?, ?, 'Ticket Void', ?, ?, ?, ?)`
          )
          .bind(
            generateUniqueCode('TX-'),
            userId,
            String(accRow.name),
            refund,
            prevBal,
            nextBal,
            `Refund voided ticket ${ticketId}`,
            owner.username,
            now,
            dateTimeYmdHm
          )
      );
    }

    stmts.push(
      this.auditLogStmt(
        owner.id,
        owner.username,
        'VOID_TICKET',
        ticketId,
        `Voided ticket ${ticketId} for player ${userId} and refunded ${refund} KHR.`,
        now
      )
    );

    await this.db.batch(stmts);

    const updated = await this.db
      .prepare(`SELECT * FROM bet_tickets WHERE ticket_id = ?`)
      .bind(ticketId)
      .first<DbRow>();
    if (!updated) throw new Error('Ticket not found after void.');
    return { ticket: this.mapTicketRow(updated), refundedAmount: refund };
  }

  async getPlayerTickets(userId: string, limit = 10000): Promise<BetTicket[]> {
    const res = await this.db
      .prepare(
        `SELECT t.*, a.username
         FROM bet_tickets t
         LEFT JOIN accounts a ON a.id = t.user_id
         WHERE t.user_id = ?
         ORDER BY t.timestamp DESC
         LIMIT ?`
      )
      .bind(userId, limit)
      .all<DbRow>();
    return (res.results || []).map((r) => this.mapTicketRow(r));
  }

  async getRoundTickets(roundId: string, limit = 100): Promise<BetTicket[]> {
    const res = await this.db
      .prepare(
        `SELECT t.*, a.username
         FROM bet_tickets t
         LEFT JOIN accounts a ON a.id = t.user_id
         WHERE t.round_id = ?
         ORDER BY t.timestamp DESC
         LIMIT ?`
      )
      .bind(roundId, limit)
      .all<DbRow>();
    return (res.results || []).map((r) => this.mapTicketRow(r));
  }

  async getAllTickets(): Promise<BetTicket[]> {
    const res = await this.db
      .prepare(
        `SELECT t.*, a.username
         FROM bet_tickets t
         LEFT JOIN accounts a ON a.id = t.user_id
         ORDER BY t.timestamp DESC
         LIMIT 500`
      )
      .all<DbRow>();
    return (res.results || []).map((r) => this.mapTicketRow(r));
  }

  async getPlayerTransactions(userId: string, limit = 200): Promise<BalanceTransaction[]> {
    const res = await this.db
      .prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?`)
      .bind(userId, limit)
      .all<DbRow>();
    return (res.results || []).map((r) => this.mapTransactionRow(r));
  }

  async getAllTransactions(): Promise<BalanceTransaction[]> {
    const res = await this.db
      .prepare(`SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 500`)
      .all<DbRow>();
    return (res.results || []).map((r) => this.mapTransactionRow(r));
  }

  // =========================================================================
  // ROUNDS, AUTHORITATIVE TIMING, SETTLEMENT, & SYSTEM CONFIG
  // =========================================================================

  async getPersistedMeta(): Promise<PersistedRoundMeta> {
    let row = await this.db
      .prepare(`SELECT * FROM system_config WHERE id = 1`)
      .first<DbRow>();
    if (!row) {
      await this.ensureSystemConfigRow();
      row = (await this.db
        .prepare(`SELECT * FROM system_config WHERE id = 1`)
        .first<DbRow>())!;
    }

    let activeDraw: ActiveDrawState | null = null;
    if (row.active_draw_json) {
      try {
        activeDraw = JSON.parse(String(row.active_draw_json));
      } catch {
        activeDraw = null;
      }
    }

    return {
      currentRoundNumber: Number(row.current_round_number) || 149,
      roundStartTime: Number(row.round_start_time) || Date.now(),
      roundEndTime: Number(row.round_end_time) || Date.now() + 300000,
      forcedNextNumbers: row.forced_numbers_json
        ? JSON.parse(String(row.forced_numbers_json))
        : null,
      isDrawing: Number(row.is_drawing) === 1 && activeDraw !== null,
      activeDraw,
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

  async getPastRounds(limit = 50): Promise<RoundResult[]> {
    const res = await this.db
      .prepare(`SELECT * FROM rounds ORDER BY timestamp DESC LIMIT ?`)
      .bind(limit)
      .all<DbRow>();
    return (res.results || []).map((r) => ({
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

  async startServerDraw(triggeredBy?: AppUser): Promise<ActiveDrawState | null> {
    const meta = await this.getPersistedMeta();
    if (meta.isDrawing && meta.activeDraw) {
      return meta.activeDraw;
    }

    const currentRoundId = `26292#${meta.currentRoundNumber}`;
    const winningNumbers: Record<ChannelLetter, string> = meta.forcedNextNumbers || {
      A: getCryptoRandomLotteryNumber(),
      B: getCryptoRandomLotteryNumber(),
      C: getCryptoRandomLotteryNumber(),
      D: getCryptoRandomLotteryNumber(),
      E: getCryptoRandomLotteryNumber(),
    };

    const now = Date.now();
    const activeDraw: ActiveDrawState = {
      roundId: currentRoundId,
      numbers: winningNumbers,
      startTime: now,
    };

    const updateRes = await this.db
      .prepare(
        `UPDATE system_config
         SET is_drawing = 1, active_draw_json = ?
         WHERE id = 1 AND (is_drawing IS NULL OR is_drawing = 0)`
      )
      .bind(JSON.stringify(activeDraw))
      .run();

    if ((updateRes.meta?.changes || 0) === 0) {
      const latest = await this.getPersistedMeta();
      return latest.activeDraw;
    }

    if (triggeredBy) {
      await this.auditLogStmt(
        triggeredBy.id,
        triggeredBy.username,
        'TRIGGER_MANUAL_DRAW',
        currentRoundId,
        `Owner triggered manual draw for round ${currentRoundId}.`,
        now
      ).run();
    }

    return activeDraw;
  }

  async settleRoundAtomic(
    roundId: string,
    numbers: Record<ChannelLetter, string>
  ): Promise<{
    alreadySettled: boolean;
    round: RoundResult;
    settledCount: number;
    totalPayout: number;
    nextRoundNumber: number;
    roundStartTime: number;
    roundEndTime: number;
  }> {
    const now = Date.now();
    const { dateDmy, timeHm, dateTimeYmdHm } = formatDateTimeNow(new Date(now));
    const meta = await this.getPersistedMeta();

    const existingRound = await this.db
      .prepare(`SELECT * FROM rounds WHERE round_id = ? LIMIT 1`)
      .bind(roundId)
      .first<DbRow>();

    if (existingRound) {
      if (meta.isDrawing) {
        const nextRoundNumber = meta.currentRoundNumber + 1;
        const durationMs = meta.systemConfig.drawIntervalSeconds * 1000;
        await this.db
          .prepare(
            `UPDATE system_config
             SET forced_numbers_json = NULL,
                 is_drawing = 0,
                 active_draw_json = NULL,
                 current_round_number = ?,
                 round_start_time = ?,
                 round_end_time = ?
             WHERE id = 1 AND is_drawing = 1`
          )
          .bind(nextRoundNumber, now, now + durationMs)
          .run();
      }
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

    const pendingRes = await this.db
      .prepare(`SELECT * FROM bet_tickets WHERE round_id = ? AND status = 'PENDING' AND payout_credited = 0`)
      .bind(roundId)
      .all<DbRow>();
    const pendingRows = pendingRes.results || [];

    let settledCount = 0;
    let totalPayout = 0;
    const payoutRate = meta.systemConfig.payoutRate;

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO rounds (round_id, draw_time, date, num_a, num_b, num_c, num_d, num_e, timestamp, settled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .bind(roundId, timeHm, dateDmy, numbers.A, numbers.B, numbers.C, numbers.D, numbers.E, now),
    ];

    const accountBalanceCache = new Map<string, { name: string; balance: number }>();

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

      stmts.push(
        this.db
          .prepare(
            `UPDATE bet_tickets
             SET status = ?, won_amount = ?, winning_hits_json = ?, settled_at = ?, payout_credited = 1
             WHERE ticket_id = ? AND status = 'PENDING' AND payout_credited = 0`
          )
          .bind(finalStatus, totalWon, JSON.stringify(hits), now, ticket.ticketId)
      );

      settledCount += 1;

      if (totalWon > 0) {
        totalPayout += totalWon;
        let acc = accountBalanceCache.get(ticket.userId);
        if (!acc) {
          const accRow = await this.db
            .prepare(`SELECT name, balance FROM accounts WHERE id = ?`)
            .bind(ticket.userId)
            .first<DbRow>();
          if (accRow) {
            acc = { name: String(accRow.name), balance: Number(accRow.balance) || 0 };
            accountBalanceCache.set(ticket.userId, acc);
          }
        }
        if (acc) {
          const prevBal = acc.balance;
          const nextBal = prevBal + totalWon;
          acc.balance = nextBal;

          stmts.push(
            this.db
              .prepare(`UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`)
              .bind(totalWon, now, ticket.userId),
            this.db
              .prepare(
                `INSERT INTO transactions (
                  transaction_id, user_id, user_name, user_role, type, amount,
                  previous_balance, new_balance, payment_method, note, admin_id, timestamp, created_at
                ) VALUES (?, ?, ?, 'PLAYER', 'PAYOUT', ?, ?, ?, 'Lottery Payout', ?, 'SYSTEM', ?, ?)`
              )
              .bind(
                generateUniqueCode('TX-'),
                ticket.userId,
                acc.name,
                totalWon,
                prevBal,
                nextBal,
                `Win payout for ticket ${ticket.ticketId} (${roundId})`,
                now,
                dateTimeYmdHm
              )
          );
        }
      }
    }

    const nextRoundNumber = meta.currentRoundNumber + 1;
    const durationMs = meta.systemConfig.drawIntervalSeconds * 1000;
    const nextStart = now;
    const nextEnd = now + durationMs;

    stmts.push(
      this.db
        .prepare(
          `UPDATE system_config
           SET forced_numbers_json = NULL,
               is_drawing = 0,
               active_draw_json = NULL,
               current_round_number = ?,
               round_start_time = ?,
               round_end_time = ?
           WHERE id = 1`
        )
        .bind(nextRoundNumber, nextStart, nextEnd),
      this.auditLogStmt(
        'SYSTEM',
        'SYSTEM',
        'ROUND_SETTLED',
        roundId,
        `Round ${roundId} settled (${numbers.A}-${numbers.B}-${numbers.C}-${numbers.D}-${numbers.E}). Settled ${settledCount} ticket(s), total payouts: ${totalPayout} KHR.`,
        now
      )
    );

    try {
      await this.db.batch(stmts);
    } catch (err) {
      // If a concurrent request already inserted rounds.round_id, return idempotently
      const settledByPeer = await this.db
        .prepare(`SELECT * FROM rounds WHERE round_id = ? LIMIT 1`)
        .bind(roundId)
        .first<DbRow>();
      if (settledByPeer) {
        const latestMeta = await this.getPersistedMeta();
        return {
          alreadySettled: true,
          round: {
            roundId: String(settledByPeer.round_id),
            drawTime: String(settledByPeer.draw_time),
            date: String(settledByPeer.date),
            numbers: {
              A: String(settledByPeer.num_a),
              B: String(settledByPeer.num_b),
              C: String(settledByPeer.num_c),
              D: String(settledByPeer.num_d),
              E: String(settledByPeer.num_e),
            },
            timestamp: Number(settledByPeer.timestamp),
          },
          settledCount: 0,
          totalPayout: 0,
          nextRoundNumber: latestMeta.currentRoundNumber,
          roundStartTime: latestMeta.roundStartTime,
          roundEndTime: latestMeta.roundEndTime,
        };
      }
      throw err;
    }

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
  }

  /**
   * Authoritative server-time clock tick for stateless Cloudflare Workers.
   * Ensures countdown expiry -> draw -> settlement runs reliably on server time.
   */
  async tickAuthoritativeRound(drawDurationMs: number): Promise<PersistedRoundMeta> {
    let meta = await this.getPersistedMeta();
    const now = Date.now();

    if (meta.isDrawing && meta.activeDraw) {
      if (now - meta.activeDraw.startTime >= drawDurationMs) {
        await this.settleRoundAtomic(meta.activeDraw.roundId, meta.activeDraw.numbers);
        meta = await this.getPersistedMeta();
      }
      return meta;
    }

    if (meta.systemConfig.isSystemOpen && meta.systemConfig.autoDrawEnabled && now >= meta.roundEndTime) {
      await this.startServerDraw();
      meta = await this.getPersistedMeta();
    }

    return meta;
  }

  async setForcedNextNumbers(
    owner: AppUser,
    numbers: Record<ChannelLetter, string> | null
  ): Promise<Record<ChannelLetter, string> | null> {
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

    await this.db.batch([
      this.db
        .prepare(`UPDATE system_config SET forced_numbers_json = ? WHERE id = 1`)
        .bind(cleaned ? JSON.stringify(cleaned) : null),
      this.auditLogStmt(
        owner.id,
        owner.username,
        cleaned ? 'SET_FORCED_NUMBERS' : 'CLEAR_FORCED_NUMBERS',
        undefined,
        cleaned
          ? `Set preset draw numbers: A=${cleaned.A}, B=${cleaned.B}, C=${cleaned.C}, D=${cleaned.D}, E=${cleaned.E}.`
          : 'Cleared preset draw numbers (returned to random auto draw).'
      ),
    ]);

    return cleaned;
  }

  async updateSystemConfig(
    owner: AppUser,
    patch: Partial<SystemConfig>
  ): Promise<PersistedRoundMeta> {
    const current = await this.getPersistedMeta();
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

    await this.db.batch([
      this.db
        .prepare(
          `UPDATE system_config
           SET payout_rate = ?,
               draw_interval_seconds = ?,
               min_bet_amount = ?,
               max_bet_amount = ?,
               is_system_open = ?,
               auto_draw_enabled = ?,
               round_start_time = ?,
               round_end_time = ?
           WHERE id = 1`
        )
        .bind(
          payoutRate,
          drawIntervalSeconds,
          minBetAmount,
          maxBetAmount,
          isSystemOpen ? 1 : 0,
          autoDrawEnabled ? 1 : 0,
          roundStartTime,
          roundEndTime
        ),
      this.auditLogStmt(
        owner.id,
        owner.username,
        'UPDATE_SYSTEM_CONFIG',
        'system_config',
        `Updated config: payout=1:${payoutRate}, interval=${drawIntervalSeconds}s, minBet=${minBetAmount}, maxBet=${maxBetAmount}, open=${isSystemOpen}, autoDraw=${autoDrawEnabled}.`
      ),
    ]);

    return this.getPersistedMeta();
  }

  async deleteRound(owner: AppUser, roundId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(`DELETE FROM rounds WHERE round_id = ?`).bind(roundId),
      this.auditLogStmt(
        owner.id,
        owner.username,
        'DELETE_ROUND',
        roundId,
        `Deleted round record ${roundId} from history.`
      ),
    ]);
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

  async resetRoundHistory(owner: AppUser): Promise<void> {
    const now = Date.now();
    const meta = await this.getPersistedMeta();
    const nextNum = this.parseNextRoundNumber(INITIAL_PAST_ROUNDS);

    const stmts: D1PreparedStatement[] = [this.db.prepare(`DELETE FROM rounds`)];
    for (const r of INITIAL_PAST_ROUNDS) {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO rounds (round_id, draw_time, date, num_a, num_b, num_c, num_d, num_e, timestamp, settled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          )
          .bind(
            r.roundId,
            r.drawTime,
            r.date,
            r.numbers.A,
            r.numbers.B,
            r.numbers.C,
            r.numbers.D,
            r.numbers.E,
            r.timestamp || now
          )
      );
    }

    stmts.push(
      this.db
        .prepare(
          `UPDATE system_config
           SET current_round_number = ?, forced_numbers_json = NULL, is_drawing = 0, active_draw_json = NULL, round_start_time = ?, round_end_time = ?
           WHERE id = 1`
        )
        .bind(nextNum, now, now + meta.systemConfig.drawIntervalSeconds * 1000),
      this.auditLogStmt(
        owner.id,
        owner.username,
        'RESET_ROUND_HISTORY',
        undefined,
        'Reset round history to initial baseline.',
        now
      )
    );

    await this.db.batch(stmts);
  }

  // =========================================================================
  // FINANCIAL REPORTS & AUDIT LOGS
  // =========================================================================

  async computeFinancialReports(): Promise<FinancialReportsSummary> {
    const [players, ticketsRes, txRes] = await Promise.all([
      this.listPlayers(),
      this.db
        .prepare(
          `SELECT t.*, a.username, a.name AS account_name
           FROM bet_tickets t
           LEFT JOIN accounts a ON a.id = t.user_id
           ORDER BY COALESCE(t.settled_at, t.timestamp) DESC, t.timestamp DESC`
        )
        .all<DbRow>(),
      this.db.prepare(`SELECT * FROM transactions ORDER BY timestamp DESC`).all<DbRow>(),
    ]);

    const allTicketRows = ticketsRes.results || [];
    const allTransactions = (txRes.results || []).map((r) => this.mapTransactionRow(r));

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

    const playerReports: PlayerFinancialReport[] = Array.from(perPlayerMap.values()).map((pr) => ({
      ...pr,
      playerNetProfitLoss: pr.totalWon - pr.settledStaked,
      ownerProfitLoss: pr.settledStaked - pr.totalWon,
    }));

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

  async getAuditLogs(limit = 150): Promise<AuditLogEntry[]> {
    const res = await this.db
      .prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?`)
      .bind(limit)
      .all<DbRow>();
    return (res.results || []).map((r) => ({
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
