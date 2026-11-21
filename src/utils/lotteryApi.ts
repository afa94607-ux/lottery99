import {
  AppUser,
  AuditLogEntry,
  BalanceTransaction,
  BetTicket,
  ChannelLetter,
  FinancialReportsSummary,
  RoundResult,
  SystemConfig,
} from '../types/lottery';

export interface ActiveDrawInfo {
  roundId: string;
  numbers: Record<ChannelLetter, string>;
  startTime: number;
}

export interface PublicLotteryState {
  serverTimestamp: number;
  currentRoundId: string;
  currentRoundNumber: number;
  countdownSeconds: number;
  roundStartTime: number;
  roundEndTime: number;
  roundDurationSeconds: number;
  bettingClosed?: boolean;
  serverDateYmd?: string;
  isDrawing: boolean;
  activeDraw: ActiveDrawInfo | null;
  pastRounds: RoundResult[];
  systemConfig: SystemConfig;
}

export interface PlayerStateResponse extends PublicLotteryState {
  account: AppUser;
  tickets: BetTicket[];
  transactions: BalanceTransaction[];
}

export interface AdminStateResponse extends PublicLotteryState {
  owner: AppUser;
  forcedNextNumbers: Record<ChannelLetter, string> | null;
  players: AppUser[];
  tickets: BetTicket[];
  transactions: BalanceTransaction[];
  reports: FinancialReportsSummary;
  auditLogs: AuditLogEntry[];
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  code?: string;
}

const getApiBase = (): string => {
  const envApi = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL;
  if (envApi) return envApi.replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    const customApi = (window as unknown as { VITE_API_URL?: string }).VITE_API_URL;
    if (customApi) return customApi.replace(/\/+$/, '');
  }
  return '';
};

async function requestJson<T>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-cache',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: options.method || 'GET',
      cache: 'no-store',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error || `Request failed (${res.status})`,
        code: json?.code,
      };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch {
    return {
      ok: false,
      status: 0,
      error: 'Cannot connect to Lottery888 backend server. Please verify the server is running.',
    };
  }
}

export const lotteryApi = {
  // Auth
  ownerLogin(username: string, password: string) {
    return requestJson<{ success: boolean; token: string; account: AppUser }>(
      '/api/auth/owner/login',
      { method: 'POST', body: { username, password } }
    );
  },

  playerLogin(username: string, password: string) {
    return requestJson<{ success: boolean; token: string; account: AppUser }>(
      '/api/auth/player/login',
      { method: 'POST', body: { username, password } }
    );
  },

  verifySession(token: string) {
    return requestJson<{ account: AppUser }>('/api/auth/me', { token });
  },

  logout(token: string) {
    return requestJson<{ success: boolean }>('/api/auth/logout', { method: 'POST', token });
  },

  // Public shared state
  getPublicState() {
    return requestJson<PublicLotteryState>('/api/lottery/public');
  },

  // Player endpoints
  getPlayerState(token: string) {
    return requestJson<PlayerStateResponse>('/api/player/state', { token });
  },

  placePlayerBet(
    token: string,
    payload: {
      channels: ChannelLetter[];
      numbers: string[];
      stakePerUnit: number;
      clientRequestId: string;
    }
  ) {
    return requestJson<{
      success: boolean;
      ticket: BetTicket;
      newBalance: number;
      duplicate?: boolean;
    }>('/api/player/bets', { method: 'POST', token, body: payload });
  },

  // Owner Admin endpoints
  getAdminState(token: string) {
    return requestJson<AdminStateResponse>('/api/admin/state', { token });
  },

  changeOwnerPassword(token: string, currentPassword: string, newPassword: string) {
    return requestJson<{ success: boolean }>('/api/admin/change-password', {
      method: 'POST',
      token,
      body: { currentPassword, newPassword },
    });
  },

  createPlayer(
    token: string,
    payload: {
      id?: string;
      username: string;
      name: string;
      password: string;
      balance?: number;
      creditLimit?: number;
      phone?: string;
      notes?: string;
    }
  ) {
    return requestJson<{ success: boolean; player: AppUser }>('/api/admin/players', {
      method: 'POST',
      token,
      body: payload,
    });
  },

  resetPlayerPassword(token: string, playerId: string, newPassword: string) {
    return requestJson<{ success: boolean }>(
      `/api/admin/players/${encodeURIComponent(playerId)}/password`,
      { method: 'POST', token, body: { newPassword } }
    );
  },

  togglePlayerStatus(token: string, playerId: string, status?: 'ACTIVE' | 'SUSPENDED') {
    return requestJson<{ success: boolean; player: AppUser }>(
      `/api/admin/players/${encodeURIComponent(playerId)}/status`,
      { method: 'POST', token, body: status ? { status } : {} }
    );
  },

  deletePlayer(token: string, playerId: string) {
    return requestJson<{ success: boolean }>(
      `/api/admin/players/${encodeURIComponent(playerId)}`,
      { method: 'DELETE', token }
    );
  },

  processTransaction(
    token: string,
    payload: {
      userId: string;
      type: 'DEPOSIT' | 'WITHDRAWAL' | 'SET';
      amount: number;
      paymentMethod: string;
      note?: string;
    }
  ) {
    return requestJson<{
      success: boolean;
      transaction: BalanceTransaction;
      account: AppUser;
    }>('/api/admin/transactions', { method: 'POST', token, body: payload });
  },

  setForcedNumbers(token: string, numbers: Record<ChannelLetter, string> | null) {
    return requestJson<{
      success: boolean;
      forcedNextNumbers: Record<ChannelLetter, string> | null;
    }>('/api/admin/forced-numbers', { method: 'POST', token, body: { numbers } });
  },

  triggerDraw(token: string) {
    return requestJson<{
      success: boolean;
      isDrawing: boolean;
      activeDraw: ActiveDrawInfo | null;
    }>('/api/admin/trigger-draw', { method: 'POST', token });
  },

  updateSystemConfig(token: string, config: Partial<SystemConfig>) {
    return requestJson<{ success: boolean; systemConfig: SystemConfig }>(
      '/api/admin/system-config',
      { method: 'POST', token, body: { config } }
    );
  },

  voidTicket(token: string, ticketId: string) {
    return requestJson<{ success: boolean; ticket: BetTicket; refundedAmount: number }>(
      `/api/admin/tickets/${encodeURIComponent(ticketId)}/void`,
      { method: 'POST', token }
    );
  },

  deleteRound(token: string, roundId: string) {
    return requestJson<{ success: boolean }>(
      `/api/admin/rounds/${encodeURIComponent(roundId)}`,
      { method: 'DELETE', token }
    );
  },

  resetHistory(token: string) {
    return requestJson<{ success: boolean; pastRounds: RoundResult[] }>(
      '/api/admin/reset-history',
      { method: 'POST', token }
    );
  },
};
