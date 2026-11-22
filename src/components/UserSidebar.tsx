import React, { useMemo } from 'react';
import { RotateCw, CheckSquare, Square, Ticket, Eye } from 'lucide-react';
import { BetTicket, ChannelLetter, RoundResult } from '../types/lottery';
import { formatKHR, CHANNEL_COLORS } from '../utils/formatters';
import { sound } from '../utils/audio';

interface UserSidebarProps {
  currentDate: string;
  userId?: string;
  balance: number;
  inPlayBet: number;
  recentTickets: BetTicket[];
  pastRounds?: RoundResult[];
  activeDrawRoundId?: string | null;
  onRefresh: () => void;
  onViewTicket: (ticket: BetTicket) => void;
  onOpenWalletInfo?: () => void;
}

export const UserSidebar: React.FC<UserSidebarProps> = ({
  currentDate,
  userId,
  balance,
  inPlayBet,
  recentTickets,
  pastRounds = [],
  activeDrawRoundId = null,
  onRefresh,
  onViewTicket,
  onOpenWalletInfo,
}) => {
  const [autoRefresh, setAutoRefresh] = React.useState(true);

  const roundsById = useMemo(() => {
    const map = new Map<string, RoundResult>();
    for (const rnd of pastRounds) {
      map.set(rnd.roundId, rnd);
    }
    return map;
  }, [pastRounds]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-3.5 sm:p-4 flex flex-col gap-3 lg:absolute lg:inset-0 min-h-0">
      {/* Date & Account ID */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100 shrink-0">
        <div className="min-w-0 flex flex-col gap-0.5">
          <div className="text-xs font-mono tabular-nums font-semibold text-slate-600 leading-tight">
            {currentDate}
          </div>
          <div className="text-xs font-semibold text-slate-400 leading-tight truncate">
            គណនី: <span className="font-mono text-slate-500">{userId || 'AADPDPP001'}</span>
          </div>
        </div>
        <button
          onClick={() => {
            sound.playClick();
            onRefresh();
          }}
          title="Refresh Account"
          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Balance & In-Play Wager */}
      <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl px-3 py-2.5 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs sm:text-sm font-semibold text-slate-600 whitespace-nowrap">
              សមតុល្យទឹកប្រាក់
            </span>
            <span
              className="text-[10px] font-semibold bg-white text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 leading-none"
              title="ដាក់/ដកប្រាក់ដោយ Admin"
            >
              Admin
            </span>
          </div>
          <button
            onClick={onOpenWalletInfo}
            className="font-mono tabular-nums font-black text-base sm:text-lg text-emerald-600 tracking-tight hover:underline cursor-pointer text-right whitespace-nowrap"
            title="មើលព័ត៌មានដាក់/ដកប្រាក់"
          >
            {formatKHR(balance)}
          </button>
        </div>
        <div className="border-t border-slate-200/70" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs sm:text-sm font-medium text-slate-600 whitespace-nowrap">
            លុយកំពុងភ្នាល់
          </span>
          <span className="font-mono tabular-nums font-bold text-sm sm:text-base text-slate-800 text-right whitespace-nowrap">
            {formatKHR(inPlayBet)}
          </span>
        </div>
      </div>

      {/* Recent Bets Header */}
      <div className="pt-2.5 border-t border-slate-200/80 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 text-sm font-extrabold text-slate-800">
          <span>ទើបភ្នាល់</span>
          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 font-mono text-xs font-bold leading-none">
            3
          </span>
          <span>វេនចុងក្រោយ</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="h-7 px-2 rounded-lg flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
          >
            {autoRefresh ? (
              <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
            ) : (
              <Square className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>ទំព័រថ្មី</span>
          </button>
          <button
            onClick={() => {
              sound.playClick();
              onRefresh();
            }}
            title="Refresh History"
            className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content Area: Either Illustration when empty or Recent Bet Slips */}
      <div className="w-full flex-1 flex flex-col justify-start items-center min-h-[280px] lg:min-h-0 overflow-hidden">
        {recentTickets.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-2 text-center">
            <div className="w-full max-w-[220px] rounded-xl overflow-hidden shadow-2xs border border-slate-100 mb-2">
              <img
                src="/src/assets/images/lottery_empty_illustration_1792387005619.jpg"
                alt="Empty state"
                referrerPolicy="no-referrer"
                className="w-full h-auto object-contain"
              />
            </div>
            <p className="text-xs text-slate-400 font-medium">មិនទាន់មានការភ្នាល់ថ្ងៃនេះទេ (No bets today.)</p>
            <p className="text-[11px] text-slate-400">សូមជ្រើសរើសប៉ុស្តិ៍ និងលេខដើម្បីចាក់</p>
          </div>
        ) : (
          <div className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain space-y-2.5 pr-1 max-h-[560px] lg:max-h-none">
            {recentTickets.map((ticket) => {
              const roundResult = roundsById.get(ticket.roundId);
              const isRoundCurrentlyDrawing = activeDrawRoundId === ticket.roundId;

              return (
              <div
                key={ticket.ticketId}
                className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/70 hover:bg-slate-50 transition-colors flex flex-col gap-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-sm sm:text-base text-blue-700">
                    {ticket.roundId}
                  </span>
                  <span
                    className={`font-bold px-2.5 py-0.5 rounded text-xs ${
                      ticket.status === 'PENDING'
                        ? 'bg-amber-100 text-amber-800'
                        : ticket.status === 'WON'
                        ? 'bg-emerald-100 text-emerald-800 animate-pulse'
                        : ticket.status === 'VOID'
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {ticket.status === 'PENDING'
                      ? 'រង់ចាំ'
                      : ticket.status === 'WON'
                      ? `ឈ្នះ ${formatKHR(ticket.wonAmount)}`
                      : ticket.status === 'VOID'
                      ? 'លុបចោល'
                      : 'មិនត្រូវ'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-700 text-xs sm:text-sm font-medium">
                  <span>ប៉ុស្តិ៍: {ticket.channels.join(', ')}</span>
                  <span>
                    {ticket.numbers.length} លេខ ({ticket.numbers.slice(0, 3).join(', ')}
                    {ticket.numbers.length > 3 ? '...' : ''})
                  </span>
                </div>

                {/* Official A-E Result Circles for this ticket's round */}
                <div
                  className="flex items-center justify-between gap-1 pt-1.5 border-t border-slate-200/60"
                  data-testid={`ticket-results-${ticket.roundId}`}
                >
                  {(['A', 'B', 'C', 'D', 'E'] as ChannelLetter[]).map((ch) => {
                    const rawNum = roundResult?.numbers?.[ch];
                    const hasResult = Boolean(rawNum) && !isRoundCurrentlyDrawing;
                    const displayNum = hasResult ? String(rawNum).padStart(2, '0') : '?';
                    const circleClass = hasResult
                      ? CHANNEL_COLORS[ch].badgeBg
                      : 'bg-orange-500 text-white';
                    return (
                      <div key={ch} className="flex flex-col items-center gap-0.5 flex-1">
                        <span className="text-[10px] font-bold text-slate-500 leading-none">
                          {ch}
                        </span>
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center font-mono font-extrabold text-xs shadow-2xs ${circleClass}`}
                        >
                          {displayNum}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60">
                  <span className="font-mono text-slate-500 text-xs">{ticket.ticketId}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-extrabold text-sm sm:text-base text-slate-900">
                      {formatKHR(ticket.totalCost)}
                    </span>
                    <button
                      onClick={() => onViewTicket(ticket)}
                      title="View Slip"
                      className="p-1 text-blue-600 hover:text-blue-800"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
