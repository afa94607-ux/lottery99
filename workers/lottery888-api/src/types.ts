export type ChannelLetter = 'A' | 'B' | 'C' | 'D' | 'E';

export interface RoundResult {
  roundId: string;
  drawTime: string;
  date: string;
  numbers: Record<ChannelLetter, string>;
  timestamp: number;
}

export interface BetTicket {
  ticketId: string;
  userId: string;
  username?: string;
  roundId: string;
  createdAt: string;
  dateYmd?: string;
  timestamp: number;
  settledAt?: number | null;
  channels: ChannelLetter[];
  numbers: string[];
  stakePerUnit: number;
  totalBetsCount: number;
  totalCost: number;
  status: 'PENDING' | 'WON' | 'LOST' | 'VOID';
  wonAmount: number;
  winningHits: Array<{ channel: ChannelLetter; number: string; winAmount: number }>;
}

export type UserRole = 'OWNER' | 'PLAYER';

export interface AppUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  balance: number;
  creditLimit: number;
  phone?: string;
  status: 'ACTIVE' | 'SUSPENDED';
  commissionRate: number;
  createdAt: string;
  notes?: string;
}

export interface SystemConfig {
  payoutRate: number;
  drawIntervalSeconds: number;
  minBetAmount: number;
  maxBetAmount: number;
  isSystemOpen: boolean;
  autoDrawEnabled: boolean;
}

export type TransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'ADJUSTMENT'
  | 'SET'
  | 'BET'
  | 'PAYOUT'
  | 'REFUND';

export interface BalanceTransaction {
  transactionId: string;
  userId: string;
  userName: string;
  userRole?: UserRole;
  type: TransactionType;
  amount: number;
  previousBalance: number;
  newBalance: number;
  paymentMethod: string;
  note?: string;
  adminId: string;
  timestamp: number;
  createdAt: string;
}

export interface AuditLogEntry {
  id: number;
  actorId: string;
  actorUsername: string;
  action: string;
  targetId?: string;
  details: string;
  timestamp: number;
  createdAt: string;
}

export interface PlayerFinancialReport {
  userId: string;
  username: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  balance: number;
  totalBetsCount: number;
  pendingBetsCount: number;
  settledBetsCount: number;
  totalStaked: number;
  settledStaked: number;
  totalWon: number;
  playerNetProfitLoss: number;
  ownerProfitLoss: number;
  totalDeposited: number;
  totalWithdrawn: number;
}

export interface DailyFinancialReport {
  date: string;
  roundsCount: number;
  playersCount: number;
  settledBetsCount: number;
  totalValidStakes: number;
  totalActualPayouts: number;
  playerNetWinLoss: number;
  ownerNetWinLoss: number;
}

export interface RoundFinancialReport {
  date: string;
  roundId: string;
  playersCount: number;
  settledBetsCount: number;
  totalValidStakes: number;
  totalActualPayouts: number;
  playerNetWinLoss: number;
  ownerNetWinLoss: number;
}

export interface DetailedBetReportRow {
  ticketId: string;
  dateYmd: string;
  roundId: string;
  userId: string;
  username: string;
  playerName: string;
  status: BetTicket['status'];
  stake: number;
  payout: number;
  playerNetWinLoss: number | null;
  ownerNetWinLoss: number | null;
  channels: ChannelLetter[];
  numbers: string[];
  createdAt: string;
  timestamp: number;
  settledAt: number | null;
}

export interface FinancialReportsSummary {
  totalPlayers: number;
  activePlayers: number;
  disabledPlayers: number;
  totalPlayerBalances: number;
  pendingBetsCount: number;
  pendingBetsVolume: number;
  settledBetsCount: number;
  voidBetsCount: number;
  totalValidStakes: number;
  settledValidStakes: number;
  totalWinningPayouts: number;
  ownerProfitLoss: number;
  ownerRealizedProfitLoss: number;
  totalDeposits: number;
  totalWithdrawals: number;
  netCashflow: number;
  playerReports: PlayerFinancialReport[];
  dailyReports: DailyFinancialReport[];
  roundReports: RoundFinancialReport[];
  detailedBets: DetailedBetReportRow[];
}

export interface ActiveDrawState {
  roundId: string;
  numbers: Record<ChannelLetter, string>;
  startTime: number;
}

export interface PersistedRoundMeta {
  currentRoundNumber: number;
  roundStartTime: number;
  roundEndTime: number;
  forcedNextNumbers: Record<ChannelLetter, string> | null;
  isDrawing: boolean;
  activeDraw: ActiveDrawState | null;
  systemConfig: SystemConfig;
}

export interface D1Meta {
  changes?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

export interface Env {
  DB: D1Database;
  LOTTERY_DRAW_DURATION_MS?: string;
  ALLOWED_ORIGINS?: string;
}
