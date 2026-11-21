import { SystemConfig } from '../types/lottery';

export const LOTTERY_PAYOUT_RATE = 91;

export const formatKHR = (amount: number): string => {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${new Intl.NumberFormat('en-US').format(Math.abs(rounded))}៛`;
};

export const formatSignedKHR = (amount: number): string => {
  const rounded = Math.round(amount);
  if (rounded === 0) return '0៛';
  const sign = rounded > 0 ? '+' : '-';
  return `${sign}${new Intl.NumberFormat('en-US').format(Math.abs(rounded))}៛`;
};

const CAMBODIA_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

export const formatCambodiaDateYmd = (timestampMs: number): string => {
  const safeMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const kh = new Date(safeMs + CAMBODIA_UTC_OFFSET_MS);
  const y = kh.getUTCFullYear();
  const m = String(kh.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kh.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const formatCambodiaTimeHms = (timestampMs: number): string => {
  const safeMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const kh = new Date(safeMs + CAMBODIA_UTC_OFFSET_MS);
  const hh = String(kh.getUTCHours()).padStart(2, '0');
  const mm = String(kh.getUTCMinutes()).padStart(2, '0');
  const ss = String(kh.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

export const shiftYmdDate = (ymd: string, deltaDays: number): string => {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return formatCambodiaDateYmd(Date.now());
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};

export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

export const formatNumberOnly = (amount: number): string => {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(amount)));
};

export const formatTimer = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const padNumber = (num: number): string => {
  return String(num).padStart(2, '0');
};

export const getRandomLotteryNumber = (): string => {
  const n = Math.floor(Math.random() * 99) + 1; // 1 to 99
  return padNumber(n);
};

export const CHANNEL_COLORS = {
  A: {
    text: 'text-[#00e5ff]',
    bg: 'bg-cyan-500',
    border: 'border-cyan-400',
    glow: 'shadow-[0_0_12px_rgba(6,182,212,0.6)]',
    slotBg: 'bg-gradient-to-b from-white to-slate-100',
    headerBg: 'bg-gradient-to-b from-[#e52d27] to-[#b31217]',
    badgeBg: 'bg-cyan-500 text-white',
  },
  B: {
    text: 'text-[#ff1744]',
    bg: 'bg-rose-500',
    border: 'border-rose-400',
    glow: 'shadow-[0_0_12px_rgba(244,63,94,0.6)]',
    slotBg: 'bg-gradient-to-b from-white to-slate-100',
    headerBg: 'bg-gradient-to-b from-[#e52d27] to-[#b31217]',
    badgeBg: 'bg-rose-500 text-white',
  },
  C: {
    text: 'text-[#2979ff]',
    bg: 'bg-blue-600',
    border: 'border-blue-400',
    glow: 'shadow-[0_0_12px_rgba(37,99,235,0.6)]',
    slotBg: 'bg-gradient-to-b from-white to-slate-100',
    headerBg: 'bg-gradient-to-b from-[#e52d27] to-[#b31217]',
    badgeBg: 'bg-blue-600 text-white',
  },
  D: {
    text: 'text-[#ff9100]',
    bg: 'bg-amber-500',
    border: 'border-amber-400',
    glow: 'shadow-[0_0_12px_rgba(245,158,11,0.6)]',
    slotBg: 'bg-gradient-to-b from-white to-slate-100',
    headerBg: 'bg-gradient-to-b from-[#e52d27] to-[#b31217]',
    badgeBg: 'bg-amber-500 text-white',
  },
  E: {
    text: 'text-[#00e676]',
    bg: 'bg-emerald-500',
    border: 'border-emerald-400',
    glow: 'shadow-[0_0_12px_rgba(16,185,129,0.6)]',
    slotBg: 'bg-gradient-to-b from-white to-slate-100',
    headerBg: 'bg-gradient-to-b from-[#e52d27] to-[#b31217]',
    badgeBg: 'bg-emerald-500 text-white',
  },
} as const;

export const INITIAL_PAST_ROUNDS = [
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

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  payoutRate: 91,
  drawIntervalSeconds: 300,
  minBetAmount: 100,
  maxBetAmount: 5000000,
  isSystemOpen: true,
  autoDrawEnabled: true,
};
