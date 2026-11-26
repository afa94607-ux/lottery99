import React from 'react';
import { ChannelLetter, RoundResult } from '../types/lottery';
import { formatKHR, formatNumberOnly, CHANNEL_COLORS, LOTTERY_PAYOUT_RATE } from '../utils/formatters';
import { sound } from '../utils/audio';

interface BettingPanelProps {
  stakePerUnit: number;
  setStakePerUnit: (amt: number) => void;
  selectedChannels: ChannelLetter[];
  selectedNumbers: string[];
  pastRounds: RoundResult[];
  onSubmitBet: () => void;
  onPrintSlip: () => void;
  onClearAll: () => void;
  onRepeatLastBet: () => void;
  canRepeat: boolean;
  userBalance: number;
  payoutRate?: number;
  isSubmitting?: boolean;
  betError?: string | null;
  isDrawing?: boolean;
  bettingClosed?: boolean;
  currentDrawingRound?: {
    roundId: string;
    drawTime: string;
    numbers: Record<ChannelLetter, string>;
    revealed: Record<ChannelLetter, boolean>;
  } | null;
}

export const BettingPanel: React.FC<BettingPanelProps> = ({
  stakePerUnit,
  setStakePerUnit,
  selectedChannels,
  selectedNumbers,
  pastRounds,
  onSubmitBet,
  onPrintSlip,
  onClearAll,
  onRepeatLastBet,
  canRepeat,
  userBalance,
  payoutRate = LOTTERY_PAYOUT_RATE,
  isSubmitting = false,
  betError = null,
  isDrawing = false,
  bettingClosed = false,
  currentDrawingRound = null,
}) => {
  const presetAmounts = [
    { label: '1រយ', value: 100 },
    { label: '5រយ', value: 500 },
    { label: '1ពាន់', value: 1000 },
    { label: '2ពាន់', value: 2000 },
    { label: '5ពាន់', value: 5000 },
    { label: '1ម៉ឺន', value: 10000 },
    { label: '2ម៉ឺន', value: 20000 },
    { label: '5ម៉ឺន', value: 50000 },
  ];

  const controlsDisabled = bettingClosed || isDrawing;
  const totalBetsCount = selectedChannels.length * selectedNumbers.length;
  const totalCost = totalBetsCount * stakePerUnit;
  const potentialWinPerHit = stakePerUnit * payoutRate;

  const handlePresetClick = (val: number) => {
    if (controlsDisabled) return;
    sound.playSelect();
    // If 0, set to val, else add val
    setStakePerUnit(stakePerUnit === 0 ? val : stakePerUnit + val);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    const num = parseInt(raw, 10);
    setStakePerUnit(isNaN(num) ? 0 : num);
  };

  return (
    <div className="w-full bg-white rounded-2xl shadow-sm border border-slate-200/80 p-3.5 sm:p-4 flex flex-col gap-3 lg:absolute lg:inset-0 min-h-0">
      {/* Top Input: ទឹកប្រាក់ [ 0៛ ] [លុប] */}
      <div className="flex items-center gap-2.5 shrink-0">
        <label className="text-sm sm:text-base font-bold text-slate-700 whitespace-nowrap shrink-0">
          ទឹកប្រាក់
        </label>
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            inputMode="numeric"
            value={stakePerUnit > 0 ? formatNumberOnly(stakePerUnit) : ''}
            onChange={handleAmountChange}
            disabled={controlsDisabled}
            placeholder="0"
            className="w-full h-10 text-right font-mono tabular-nums font-bold text-base sm:text-lg pr-8 pl-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono font-bold text-sm pointer-events-none">
            ៛
          </span>
        </div>
        <button
          disabled={controlsDisabled}
          onClick={() => {
            sound.playClick();
            setStakePerUnit(0);
          }}
          className="h-10 px-4 flex items-center justify-center text-sm font-semibold bg-slate-600 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          លុប
        </button>
      </div>

      {/* 8 Preset Amount Buttons */}
      <div className="grid grid-cols-4 gap-2 shrink-0">
        {presetAmounts.map((p) => (
          <button
            key={p.label}
            disabled={controlsDisabled}
            onClick={() => handlePresetClick(p.value)}
            className="h-8 sm:h-9 px-2 flex items-center justify-center text-center bg-white hover:bg-blue-50 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 hover:text-blue-700 border border-slate-300 hover:border-blue-400 rounded-full font-semibold text-xs sm:text-sm tabular-nums whitespace-nowrap transition-all shadow-2xs cursor-pointer"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Bet Summary Breakdown */}
      <div className="px-3 py-2.5 bg-slate-50/90 rounded-xl border border-slate-200/80 text-xs sm:text-sm flex flex-col gap-1.5 shrink-0">
        <div className="flex justify-between items-baseline gap-2 text-slate-600">
          <span className="whitespace-nowrap">ប៉ុស្តិ៍ × លេខ:</span>
          <span className="font-mono tabular-nums font-semibold text-slate-900 text-right">
            {selectedChannels.length} ប៉ុស្តិ៍ × {selectedNumbers.length} លេខ = {totalBetsCount} ភ្នាល់
          </span>
        </div>
        <div className="border-t border-slate-200/70" />
        <div className="flex justify-between items-baseline gap-2 text-slate-700">
          <span className="font-bold whitespace-nowrap">សរុបទឹកប្រាក់:</span>
          <span className={`font-mono tabular-nums font-extrabold text-base sm:text-lg text-right ${totalCost > userBalance ? 'text-rose-600' : 'text-blue-700'}`}>
            {formatKHR(totalCost)}
          </span>
        </div>
        <div className="flex justify-between items-baseline gap-2 text-slate-500">
          <span className="whitespace-nowrap">ឈ្នះក្នុង 1 ប៉ុស្តិ៍ (1:{payoutRate}):</span>
          <span className="font-mono tabular-nums text-emerald-600 font-bold text-right">
            {formatKHR(potentialWinPerHit)}
          </span>
        </div>
        {totalCost > userBalance && (
          <span className="text-rose-500 text-xs text-right font-medium">
            សមតុល្យមិនគ្រប់គ្រាន់! សូមទាក់ទង Admin ដើម្បីបញ្ចូលប្រាក់
          </span>
        )}
        {controlsDisabled && (
          <span className="text-rose-700 text-xs sm:text-sm font-bold bg-rose-50 border border-rose-300 rounded-lg px-2.5 py-1.5 text-center">
            បិទការភ្នាល់ — Betting Closed — Wait for Next Round
          </span>
        )}
        {betError && (
          <span className="text-rose-600 text-xs sm:text-sm font-semibold bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
            {betError}
          </span>
        )}
      </div>

      {/* 4 Action Buttons: [បញ្ជូន] [បោះពុម្ព] [លុប] [រួចរាល់] */}
      <div className="grid grid-cols-4 gap-2 shrink-0">
        {/* Submit */}
        <button
          onClick={onSubmitBet}
          disabled={
            totalBetsCount === 0 ||
            stakePerUnit <= 0 ||
            totalCost > userBalance ||
            isSubmitting ||
            controlsDisabled
          }
          className="h-10 px-2 flex items-center justify-center text-center bg-[#3b82f6] hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm sm:text-base shadow-sm transition-transform active:scale-95 whitespace-nowrap cursor-pointer"
        >
          {isSubmitting ? '...' : controlsDisabled ? 'បិទ' : 'បញ្ជូន'}
        </button>

        {/* Print Slip */}
        <button
          onClick={onPrintSlip}
          disabled={totalBetsCount === 0 || stakePerUnit <= 0}
          className="h-10 px-2 flex items-center justify-center text-center bg-[#22c55e] hover:bg-emerald-600 disabled:opacity-50 text-white rounded-xl font-bold text-sm sm:text-base shadow-sm transition-transform active:scale-95 whitespace-nowrap cursor-pointer"
        >
          បោះពុម្ព
        </button>

        {/* Clear */}
        <button
          onClick={onClearAll}
          disabled={controlsDisabled}
          className="h-10 px-2 flex items-center justify-center text-center bg-[#94a3b8] hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm sm:text-base shadow-sm transition-transform active:scale-95 whitespace-nowrap cursor-pointer"
        >
          លុប
        </button>

        {/* Repeat Last Bet */}
        <button
          onClick={onRepeatLastBet}
          disabled={!canRepeat || controlsDisabled}
          title="Repeat Previous Bet"
          className="h-10 px-2 flex items-center justify-center text-center bg-[#10b981] hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm sm:text-base shadow-sm transition-transform active:scale-95 whitespace-nowrap cursor-pointer"
        >
          រួចរាល់
        </button>
      </div>

      {/* Section Divider */}
      <div className="border-t border-slate-200/80 shrink-0" />

      {/* Recent Results Header */}
      <div className="flex items-center justify-between shrink-0">
        <h3 className="font-extrabold text-lg sm:text-xl text-slate-800">
          លទ្ធផលថ្មីៗ <span className="text-sm text-slate-500 font-normal">(Recent Draws)</span>
        </h3>
        <span className="text-sm text-blue-600 font-semibold">វេនចុងក្រោយ</span>
      </div>

      {/* List of Past Rounds */}
      <div className="w-full flex-1 min-h-[280px] lg:min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pr-1 max-h-[580px] lg:max-h-none">
        {/* Live Drawing Round: Updates & reveals one by one from A to E */}
        {isDrawing && currentDrawingRound && (
          <>
            <div className="p-3.5 sm:p-4 rounded-xl border-2 border-amber-400 bg-amber-50/80 shadow-md">
              {/* Header: roundId & status */}
              <div className="flex items-center justify-between text-base sm:text-lg font-mono text-slate-800 pb-2 border-b border-amber-200">
                <span className="font-bold text-blue-700">{currentDrawingRound.roundId}</span>
                <span className="text-xs bg-amber-400 text-slate-900 font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping" />
                  កំពុងចេញលទ្ធផល A-E...
                </span>
              </div>

              {/* Channels & Drawn numbers one by one */}
              <div className="flex items-center justify-between pt-2.5">
                <span className="text-sm font-semibold text-slate-600 mr-2">ប៉ុស្តិ៍</span>
                <div className="flex items-center gap-2 flex-1 justify-around">
                  {(['A', 'B', 'C', 'D', 'E'] as ChannelLetter[]).map((ch) => {
                    const isRev = currentDrawingRound.revealed[ch];
                    const num = isRev ? currentDrawingRound.numbers[ch] : '??';
                    const col = CHANNEL_COLORS[ch];
                    return (
                      <div key={ch} className="flex flex-col items-center">
                        <span className="text-sm font-bold text-slate-700 mb-1">{ch}</span>
                        <div
                          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-mono font-extrabold text-base sm:text-lg shadow-2xs transition-all duration-300 ${
                            isRev
                              ? `${col.badgeBg} scale-110 ring-2 ring-amber-400 shadow-md animate-bounce`
                              : 'bg-white text-slate-400 border border-dashed border-slate-300 animate-pulse'
                          }`}
                        >
                          {num}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {pastRounds.length > 0 && (
              <div
                data-testid="result-history-divider"
                className="h-1.5 w-full bg-red-600 rounded-full my-2.5 shrink-0"
              />
            )}
          </>
        )}

        {pastRounds.map((rnd, idx) => (
          <React.Fragment key={rnd.roundId}>
            <div className="p-3.5 sm:p-4 rounded-xl border border-slate-100 hover:border-slate-300 bg-slate-50/70 hover:bg-slate-50 transition-colors">
              {/* Header: roundId & time */}
              <div className="flex items-center justify-between text-base sm:text-lg font-mono text-slate-700 pb-2 border-b border-slate-200/60">
                <span className="font-bold text-slate-900">{rnd.roundId}</span>
                <span className="text-sm font-semibold text-slate-600">{rnd.drawTime}</span>
              </div>

              {/* Channels & Drawn numbers */}
              <div className="flex items-center justify-between pt-2.5">
                <span className="text-sm font-semibold text-slate-500 mr-2">ប៉ុស្តិ៍</span>
                <div className="flex items-center gap-2 flex-1 justify-around">
                  {(['A', 'B', 'C', 'D', 'E'] as ChannelLetter[]).map((ch) => {
                    const num = rnd.numbers[ch] || '--';
                    const col = CHANNEL_COLORS[ch];
                    return (
                      <div key={ch} className="flex flex-col items-center">
                        <span className="text-sm font-bold text-slate-700 mb-1">{ch}</span>
                        <div
                          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-mono font-extrabold text-base sm:text-lg ${col.badgeBg} shadow-xs`}
                        >
                          {num}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {idx < pastRounds.length - 1 && (
              <div
                data-testid="result-history-divider"
                className="h-1.5 w-full bg-red-600 rounded-full my-2.5 shrink-0"
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
