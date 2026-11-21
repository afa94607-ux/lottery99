export type ChannelLetter = 'A' | 'B' | 'C' | 'D' | 'E';

export interface RoundResult {
  roundId: string; // e.g. "26292#143"
  drawTime: string; // e.g. "12:08"
  date: string; // e.g. "19-10-2026"
  numbers: Record<ChannelLetter, string>; // e.g. { A: "42", B: "38", C: "82", D: "31", E: "49" }
  timestamp: number;
}

export interface SingleBet {
  channel: ChannelLetter;
  number: string; // "01" - "99"
  amount: number; // in KHR, e.g. 1000
}

export interface BetTicket {
  ticketId: string; // e.g. "TK-94812"
  userId: string; // e.g. "AADPDPP001"
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
  id: string; // Unique Account ID, e.g. "AADPDPP001", "USR_1042"
  username: string; // Login username
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

export interface AccountState {
  userId: string;
  currency: string;
  balance: number;
  inPlayBet: number;
}

export type SelectionMode = 'NUMBER' | 'RANGE';

export interface RangeFilter {
  label: string;
  numbers: string[];
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
  transactionId: string; // e.g. "TX-89102"
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
  date: string; // YYYY-MM-DD in Asia/Phnom_Penh (UTC+7)
  roundsCount: number;
  playersCount: number;
  settledBetsCount: number;
  totalValidStakes: number;
  totalActualPayouts: number;
  playerNetWinLoss: number;
  ownerNetWinLoss: number;
}

export interface RoundFinancialReport {
  date: string; // YYYY-MM-DD in Asia/Phnom_Penh (UTC+7)
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
  dateYmd: string; // YYYY-MM-DD in Asia/Phnom_Penh (UTC+7)
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
