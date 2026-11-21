import React, { useMemo, useState } from 'react';
import { AppUser, BetTicket } from '../types/lottery';
import {
  formatKHR,
  formatSignedKHR,
  formatCambodiaDateYmd,
  formatCambodiaTimeHms,
  shiftYmdDate,
  getDaysInMonth,
} from '../utils/formatters';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Ticket,
  Eye,
  ShieldCheck,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { sound } from '../utils/audio';

interface WinLossViewProps {
  tickets: BetTicket[];
  currentUser?: AppUser | null;
  onViewTicket: (ticket: BetTicket) => void;
}

function getTicketTimestampMs(t: BetTicket): number {
  if ((t.status === 'WON' || t.status === 'LOST') && t.settledAt && t.settledAt > 0) {
    return t.settledAt;
  }
  return t.timestamp;
}

function getTicketReportDateYmd(t: BetTicket): string {
  if (t.status === 'PENDING' || t.status === 'VOID') {
    return formatCambodiaDateYmd(t.timestamp);
  }
  return t.dateYmd || formatCambodiaDateYmd(getTicketTimestampMs(t));
}

export const WinLossView: React.FC<WinLossViewProps> = ({
  tickets,
  currentUser,
  onViewTicket,
}) => {
  const todayYmd = formatCambodiaDateYmd(Date.now());
  const [selectedDate, setSelectedDate] = useState<string>(todayYmd);
  const [filter, setFilter] = useState<'ALL' | 'WON' | 'LOST' | 'PENDING'>('ALL');

  const [selYear, selMonth, selDay] = useMemo(() => {
    const parts = selectedDate.split('-').map((n) => parseInt(n, 10));
    return [parts[0] || 2026, parts[1] || 1, parts[2] || 1];
  }, [selectedDate]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>([selYear, parseInt(todayYmd.slice(0, 4), 10)]);
    for (const t of tickets) {
      const y = parseInt(getTicketReportDateYmd(t).slice(0, 4), 10);
      if (y) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [tickets, selYear, todayYmd]);

  const daysInSelectedMonth = getDaysInMonth(selYear, selMonth);

  const updateYmdParts = (y: number, m: number, d: number) => {
    const maxD = getDaysInMonth(y, m);
    const clampedD = Math.min(d, maxD);
    setSelectedDate(
      `${y}-${String(m).padStart(2, '0')}-${String(clampedD).padStart(2, '0')}`
    );
  };

  // Isolate strictly to the logged-in player's own records & selected Cambodia calendar date
  const playerOwnTickets = useMemo(() => {
    if (!currentUser) return tickets;
    return tickets.filter((t) => t.userId === currentUser.id);
  }, [tickets, currentUser]);

  const dayTickets = useMemo(() => {
    return playerOwnTickets.filter((t) => getTicketReportDateYmd(t) === selectedDate);
  }, [playerOwnTickets, selectedDate]);

  // Strict accounting: only settled bets (WON / LOST) for the selected day count toward realized Win/Loss
  const settledTickets = dayTickets.filter((t) => t.status === 'WON' || t.status === 'LOST');
  const pendingTickets = dayTickets.filter((t) => t.status === 'PENDING');

  const settledStake = settledTickets.reduce((acc, t) => acc + t.totalCost, 0);
  const settledPayout = settledTickets.reduce((acc, t) => acc + t.wonAmount, 0);
  const playerNetWinLoss = settledPayout - settledStake;
  const ownerNetWinLoss = settledStake - settledPayout;
  const pendingStake = pendingTickets.reduce((acc, t) => acc + t.totalCost, 0);

  const filteredTickets = dayTickets.filter((t) => {
    if (filter === 'ALL') return true;
    return t.status === filter;
  });

  const renderSignedClass = (val: number) =>
    val > 0 ? 'text-emerald-600' : val < 0 ? 'text-rose-600' : 'text-slate-600';

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 space-y-6">
      {/* Title & Selected Date Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900">
            របាយការណ៍ឈ្នះចាញ់ប្រចាំថ្ងៃ (Daily Win/Loss Statement)
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            កាលបរិច្ឆេទរបាយការណ៍:{' '}
            <span className="font-mono font-bold text-slate-900 bg-amber-100 px-2 py-0.5 rounded">
              {selectedDate}
            </span>{' '}
            (Asia/Phnom_Penh UTC+7)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Selector (Year / Month / Day) + Prev / Next Day */}
          <div className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-xs text-xs">
            <button
              type="button"
              onClick={() => {
                sound.playClick();
                setSelectedDate(shiftYmdDate(selectedDate, -1));
              }}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-700 flex items-center gap-0.5 font-semibold"
              title="Previous Day"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">ថ្ងៃមុន</span>
            </button>

            <Calendar className="w-3.5 h-3.5 text-amber-600 ml-1" />
            <select
              aria-label="Year"
              value={selYear}
              onChange={(e) => updateYmdParts(parseInt(e.target.value, 10), selMonth, selDay)}
              className="bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 font-mono font-bold text-slate-800"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              aria-label="Month"
              value={selMonth}
              onChange={(e) => updateYmdParts(selYear, parseInt(e.target.value, 10), selDay)}
              className="bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 font-mono font-bold text-slate-800"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, '0')}
                </option>
              ))}
            </select>
            <select
              aria-label="Day"
              value={selDay}
              onChange={(e) => updateYmdParts(selYear, selMonth, parseInt(e.target.value, 10))}
              className="bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 font-mono font-bold text-slate-800"
            >
              {Array.from({ length: daysInSelectedMonth }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {String(d).padStart(2, '0')}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                sound.playClick();
                setSelectedDate(shiftYmdDate(selectedDate, 1));
              }}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-700 flex items-center gap-0.5 font-semibold"
              title="Next Day"
            >
              <span className="hidden sm:inline">ថ្ងៃបន្ទាប់</span>
              <ChevronRight className="w-4 h-4" />
            </button>

            {selectedDate !== todayYmd && (
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setSelectedDate(todayYmd);
                }}
                className="ml-1 px-2 py-1 rounded-lg bg-amber-500 text-slate-950 font-bold hover:bg-amber-400"
              >
                ថ្ងៃនេះ
              </button>
            )}
          </div>

          {currentUser && (
            <div className="text-xs font-mono bg-slate-100 border border-slate-200 px-3 py-2 rounded-xl text-slate-700">
              គណនីអ្នកលេង: <span className="font-bold text-slate-900">{currentUser.username}</span>{' '}
              <span className="text-slate-400">({currentUser.id})</span>
            </div>
          )}
        </div>
      </div>

      {/* KPI Summary Cards (Strictly Settled Bets Only) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {/* Settled Stake */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-500">
            ប្រាក់ភ្នាល់បានទូទាត់ (Settled Stake)
          </span>
          <div className="flex items-center gap-1.5 font-mono text-lg sm:text-xl font-bold text-slate-900">
            <DollarSign className="w-5 h-5 text-blue-600 shrink-0" />
            <span>{formatKHR(settledStake)}</span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            ទូទាត់រួច: {settledTickets.length} | រង់ចាំ: {pendingTickets.length} ({formatKHR(pendingStake)})
          </span>
        </div>

        {/* Actual Payout */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-500">
            ប្រាក់រង្វាន់ជាក់ស្ដែង (Actual Payout)
          </span>
          <div className="flex items-center gap-1.5 font-mono text-lg sm:text-xl font-bold text-emerald-600">
            <TrendingUp className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{formatKHR(settledPayout)}</span>
          </div>
          <span className="text-[11px] text-slate-400">
            សរុបរង្វាន់ដែលបានសងជាក់ស្ដែង
          </span>
        </div>

        {/* Player Net Win/Loss */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-500">
            ឈ្នះ/ចាញ់ អ្នកលេង (Player Net W/L)
          </span>
          <div
            className={`flex items-center gap-1.5 font-mono text-lg sm:text-xl font-black ${renderSignedClass(
              playerNetWinLoss
            )}`}
          >
            {playerNetWinLoss >= 0 ? (
              <TrendingUp className="w-5 h-5 shrink-0" />
            ) : (
              <TrendingDown className="w-5 h-5 shrink-0" />
            )}
            <span>{formatSignedKHR(playerNetWinLoss)}</span>
          </div>
          <span className="text-[11px] text-slate-400">
            Payout − Accepted Stake
          </span>
        </div>

        {/* Game Owner Net Win/Loss (for this player's settled bets only) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-500">
            ឈ្នះ/ចាញ់ ម្ចាស់ហ្គេម (Owner Net W/L)
          </span>
          <div
            className={`flex items-center gap-1.5 font-mono text-lg sm:text-xl font-black ${renderSignedClass(
              ownerNetWinLoss
            )}`}
          >
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <span>{formatSignedKHR(ownerNetWinLoss)}</span>
          </div>
          <span className="text-[11px] text-slate-400">
            Accepted Stake − Payout
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 p-1 bg-slate-200/70 rounded-xl w-fit">
          {(['ALL', 'WON', 'LOST', 'PENDING'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                sound.playClick();
                setFilter(tab);
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                filter === tab
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab === 'ALL' && `ទាំងអស់ (${dayTickets.length})`}
              {tab === 'WON' && 'បានឈ្នះ (Won)'}
              {tab === 'LOST' && 'មិនត្រូវ (Lost)'}
              {tab === 'PENDING' && 'រង់ចាំ (Pending)'}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-500">
          * សំបុត្រកំពុងរង់ចាំ (Pending) និងសំបុត្រលុបចោល (Void) មិនត្រូវបានរាប់បញ្ចូលក្នុងផលចំណេញ/ខាតជាក់ស្ដែងទេ
        </div>
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {filteredTickets.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Ticket className="w-12 h-12 mx-auto stroke-1 text-slate-300 mb-2" />
            <p className="text-sm font-medium">
              គ្មានទិន្នន័យសម្រាប់កាលបរិច្ឆេទ {selectedDate} ទេ (No records for this date)
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                  <th className="py-3 px-3">កាលបរិច្ឆេទ & ម៉ោង (Date / Time)</th>
                  <th className="py-3 px-3">វេន (Round ID)</th>
                  <th className="py-3 px-3">អ្នកលេង (Player)</th>
                  <th className="py-3 px-3">ប៉ុស្តិ៍ / លេខ</th>
                  <th className="py-3 px-3 text-right">ទឹកប្រាក់ចាក់ (Stake)</th>
                  <th className="py-3 px-3 text-right">រង្វាន់ជាក់ស្ដែង (Payout)</th>
                  <th className="py-3 px-3 text-right">Player Win/Loss</th>
                  <th className="py-3 px-3 text-right">Owner Win/Loss</th>
                  <th className="py-3 px-3 text-center">វិក្កយបត្រ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredTickets.map((t) => {
                  const rowTs = getTicketTimestampMs(t);
                  const dateYmd = getTicketReportDateYmd(t);
                  const timeHms = formatCambodiaTimeHms(rowTs);
                  const isSettled = t.status === 'WON' || t.status === 'LOST';
                  const playerNet = t.wonAmount - t.totalCost;
                  const ownerNet = t.totalCost - t.wonAmount;
                  const playerLabel = t.username || currentUser?.username || t.userId;

                  return (
                    <tr key={t.ticketId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3 font-semibold text-slate-800 whitespace-nowrap">
                        <div>{dateYmd}</div>
                        <div className="text-[11px] text-slate-600">{timeHms}</div>
                        <div className="text-[10px] text-slate-400">{t.ticketId}</div>
                      </td>
                      <td className="py-3 px-3 text-blue-700 font-bold whitespace-nowrap">
                        {t.roundId}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{playerLabel}</div>
                        {playerLabel !== t.userId && (
                          <div className="text-[10px] text-slate-400">{t.userId}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 font-sans text-slate-800">
                        <div className="text-[11px] font-semibold text-slate-600 mb-0.5">
                          {t.channels.join(', ')}
                        </div>
                        <div className="flex flex-wrap gap-1 max-w-[160px]">
                          {t.numbers.map((n) => (
                            <span
                              key={n}
                              className="px-1.5 py-0.2 bg-slate-100 rounded text-[10px] font-mono font-bold"
                            >
                              {n}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-800 whitespace-nowrap">
                        {formatKHR(t.totalCost)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold whitespace-nowrap">
                        {t.status === 'PENDING' ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-sans font-bold bg-amber-100 text-amber-800">
                            Pending
                          </span>
                        ) : t.status === 'VOID' ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-sans font-bold bg-slate-200 text-slate-600">
                            Void
                          </span>
                        ) : (
                          <span className={t.wonAmount > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                            {formatKHR(t.wonAmount)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-black whitespace-nowrap">
                        {isSettled ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md ${
                              playerNet > 0
                                ? 'bg-emerald-50 text-emerald-700'
                                : playerNet < 0
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {formatSignedKHR(playerNet)}
                          </span>
                        ) : t.status === 'PENDING' ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-sans font-bold bg-amber-100 text-amber-800">
                            Pending
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-sans font-bold bg-slate-200 text-slate-600">
                            Void
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-black whitespace-nowrap">
                        {isSettled ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md ${
                              ownerNet > 0
                                ? 'bg-emerald-50 text-emerald-700'
                                : ownerNet < 0
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {formatSignedKHR(ownerNet)}
                          </span>
                        ) : t.status === 'PENDING' ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-sans font-bold bg-amber-100 text-amber-800">
                            Pending
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-sans font-bold bg-slate-200 text-slate-600">
                            Void
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => onViewTicket(t)}
                          className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                          title="View Receipt"
                        >
                          <Eye className="w-4 h-4 mx-auto" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
