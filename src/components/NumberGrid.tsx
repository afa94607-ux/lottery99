import React from 'react';
import { ChannelLetter, SelectionMode } from '../types/lottery';
import { padNumber } from '../utils/formatters';
import { sound } from '../utils/audio';

interface NumberGridProps {
  selectionMode: SelectionMode;
  setSelectionMode: (mode: SelectionMode) => void;
  selectedChannels: ChannelLetter[];
  toggleChannel: (channel: ChannelLetter) => void;
  selectAllChannels: () => void;
  selectedNumbers: string[];
  toggleNumber: (num: string) => void;
  selectMultipleNumbers: (nums: string[]) => void;
  clearNumbers: () => void;
  disabled?: boolean;
}

export const NumberGrid: React.FC<NumberGridProps> = ({
  selectionMode,
  setSelectionMode,
  selectedChannels,
  toggleChannel,
  selectAllChannels,
  selectedNumbers,
  toggleNumber,
  selectMultipleNumbers,
  clearNumbers,
  disabled = false,
}) => {
  const channels: ChannelLetter[] = ['A', 'B', 'C', 'D', 'E'];
  const allNumbers = Array.from({ length: 99 }, (_, i) => padNumber(i + 1));
  const [rangeStart, setRangeStart] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (selectedNumbers.length === 0) {
      setRangeStart(null);
    }
  }, [selectedNumbers.length]);

  // Quick preset handlers
  const handleSelectOdd = () => {
    sound.playSelect();
    const odds = allNumbers.filter((_, idx) => (idx + 1) % 2 !== 0);
    selectMultipleNumbers(odds);
  };

  const handleSelectEven = () => {
    sound.playSelect();
    const evens = allNumbers.filter((_, idx) => (idx + 1) % 2 === 0);
    selectMultipleNumbers(evens);
  };

  const handleSelectSmall = () => {
    sound.playSelect();
    const smalls = allNumbers.filter((_, idx) => idx + 1 <= 49);
    selectMultipleNumbers(smalls);
  };

  const handleSelectBig = () => {
    sound.playSelect();
    const bigs = allNumbers.filter((_, idx) => idx + 1 >= 50);
    selectMultipleNumbers(bigs);
  };

  const handleSelectTwins = () => {
    sound.playSelect();
    const twins = ['11', '22', '33', '44', '55', '66', '77', '88', '99'];
    selectMultipleNumbers(twins);
  };

  const handleSelectDecade = (start: number, end: number) => {
    sound.playSelect();
    setRangeStart(null);
    const range = allNumbers.slice(start - 1, end);
    selectMultipleNumbers(range);
  };

  const handleNumberClick = (num: string) => {
    sound.playSelect();
    if (selectionMode !== 'RANGE') {
      toggleNumber(num);
      return;
    }
    const clicked = parseInt(num, 10);
    if (rangeStart === null) {
      setRangeStart(clicked);
      selectMultipleNumbers([num]);
      return;
    }
    const lo = Math.min(rangeStart, clicked);
    const hi = Math.max(rangeStart, clicked);
    const range = allNumbers.slice(lo - 1, hi);
    setRangeStart(null);
    selectMultipleNumbers(range);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-3.5 sm:p-4 flex flex-col gap-3 lg:flex-1 lg:min-h-0">
      {/* Selection Mode Radios & Channels Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-slate-100 shrink-0">
        {/* Mode Selector: (o) លេខ  ( ) ចន្លោះ */}
        <div className="flex items-center gap-4 sm:gap-5">
          <label className={`flex items-center gap-2 font-semibold text-slate-800 text-sm sm:text-base ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
              type="radio"
              name="selectionMode"
              disabled={disabled}
              checked={selectionMode === 'NUMBER'}
              onChange={() => {
                sound.playClick();
                setRangeStart(null);
                setSelectionMode('NUMBER');
              }}
              className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
            />
            <span className={selectionMode === 'NUMBER' ? 'font-bold text-blue-700' : ''}>លេខ (Number)</span>
          </label>

          <label className={`flex items-center gap-2 font-semibold text-slate-800 text-sm sm:text-base ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
              type="radio"
              name="selectionMode"
              disabled={disabled}
              checked={selectionMode === 'RANGE'}
              onChange={() => {
                sound.playClick();
                setRangeStart(null);
                setSelectionMode('RANGE');
              }}
              className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
            />
            <span className={selectionMode === 'RANGE' ? 'font-bold text-blue-700' : ''}>ចន្លោះ (Range)</span>
          </label>
        </div>

        {/* Channel Pills: A, B, C, D, E */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="text-xs sm:text-sm font-bold text-slate-600 mr-0.5">ប៉ុស្តិ៍:</span>
          {channels.map((ch) => {
            const isSelected = selectedChannels.includes(ch);
            return (
              <button
                key={ch}
                disabled={disabled}
                onClick={() => {
                  sound.playClick();
                  toggleChannel(ch);
                }}
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full font-black text-sm sm:text-base transition-all flex items-center justify-center border-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? 'bg-blue-600 border-blue-600 text-white shadow-md scale-105'
                    : 'bg-slate-50 border-blue-300 text-blue-600 hover:bg-blue-50'
                }`}
              >
                {ch}
              </button>
            );
          })}
          <button
            disabled={disabled}
            onClick={() => {
              sound.playClick();
              selectAllChannels();
            }}
            className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-semibold ml-1 transition-colors"
          >
            {selectedChannels.length === 5 ? 'ដោះទាំងអស់' : 'គ្រប់ប៉ុស្តិ៍'}
          </button>
        </div>
      </div>

      {/* Quick Pick Toolbar for Range / Groups */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm shrink-0">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="text-slate-600 font-semibold mr-0.5">ជ្រើសរើសរហ័ស:</span>
          <button
            disabled={disabled}
            onClick={handleSelectSmall}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-semibold transition-colors"
          >
            តូច (01-49)
          </button>
          <button
            disabled={disabled}
            onClick={handleSelectBig}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-semibold transition-colors"
          >
            ធំ (50-99)
          </button>
          <button
            disabled={disabled}
            onClick={handleSelectOdd}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-semibold transition-colors"
          >
            សេស (Odd)
          </button>
          <button
            disabled={disabled}
            onClick={handleSelectEven}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-semibold transition-colors"
          >
            គូ (Even)
          </button>
          <button
            disabled={disabled}
            onClick={handleSelectTwins}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-semibold transition-colors"
          >
            ភ្លោះ (11-99)
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-slate-700 font-semibold">
            ជ្រើសរើស: <strong className="text-blue-600 font-mono text-sm sm:text-base">{selectedNumbers.length}</strong> លេខ
          </span>
          {selectedNumbers.length > 0 && (
            <button
              disabled={disabled}
              onClick={() => {
                sound.playClick();
                setRangeStart(null);
                clearNumbers();
              }}
              className="text-xs sm:text-sm text-rose-600 hover:text-rose-700 disabled:opacity-50 disabled:cursor-not-allowed underline font-semibold"
            >
              សម្អាត
            </button>
          )}
        </div>
      </div>

      {/* Range Quick Decade Buttons (if Range mode is active) */}
      {selectionMode === 'RANGE' && (
        <div className="p-2.5 bg-blue-50/60 rounded-xl border border-blue-200/60 flex flex-wrap gap-1.5 items-center shrink-0">
          <span className="text-xs sm:text-sm font-semibold text-blue-900 mr-1">ចន្លោះលេខទូទៅ:</span>
          {[
            { label: '01-10', s: 1, e: 10 },
            { label: '10-19', s: 10, e: 19 },
            { label: '20-29', s: 20, e: 29 },
            { label: '30-39', s: 30, e: 39 },
            { label: '40-49', s: 40, e: 49 },
            { label: '50-59', s: 50, e: 59 },
            { label: '60-69', s: 60, e: 69 },
            { label: '70-79', s: 70, e: 79 },
            { label: '80-89', s: 80, e: 89 },
            { label: '90-99', s: 90, e: 99 },
          ].map((r) => (
            <button
              key={r.label}
              disabled={disabled}
              onClick={() => handleSelectDecade(r.s, r.e)}
              className="px-2.5 py-1 bg-white hover:bg-blue-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 rounded-md font-mono text-xs sm:text-sm font-semibold border border-blue-200 shadow-2xs transition-colors"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* 01 to 99 Interactive Grid (Circular, evenly spaced, centered) */}
      <div className="w-full lg:flex-1 lg:min-h-0 overflow-y-auto flex items-start justify-center">
        <div
          className={
            selectionMode === 'NUMBER'
              ? 'grid grid-cols-10 md:grid-cols-15 gap-x-1.5 gap-y-1 justify-items-center mx-auto'
              : 'grid grid-cols-10 md:grid-cols-15 gap-2 justify-items-center mx-auto'
          }
        >
          {allNumbers.map((num) => {
            const isSelected = selectedNumbers.includes(num);
            return (
              <button
                key={num}
                disabled={disabled}
                onClick={() => handleNumberClick(num)}
                className={`${
                  selectionMode === 'NUMBER'
                    ? 'w-8 h-8 sm:w-[38px] sm:h-[38px] xl:w-[42px] xl:h-[42px] text-sm sm:text-base font-semibold'
                    : 'w-8 h-8 sm:w-9 sm:h-9 xl:w-10 xl:h-10 text-sm sm:text-base font-semibold'
                } rounded-full font-mono transition-all flex items-center justify-center border disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? 'bg-blue-600 border-blue-700 text-white font-bold shadow-md scale-105 z-10 ring-2 ring-blue-300'
                    : 'bg-white border-slate-200 text-slate-800 hover:border-blue-400 hover:bg-blue-50/50'
                }`}
              >
                {num}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
