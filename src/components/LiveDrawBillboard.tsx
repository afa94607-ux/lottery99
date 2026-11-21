import React, { useRef } from 'react';
import { Maximize2, Minimize2, Play } from 'lucide-react';
import { ChannelLetter, RoundResult } from '../types/lottery';
import { formatTimer, CHANNEL_COLORS } from '../utils/formatters';

interface LiveDrawBillboardProps {
  currentRoundId: string;
  previousRound: RoundResult;
  countdownSeconds: number;
  bettingClosed?: boolean;
  isDrawing: boolean;
  rollingNumbers: Record<ChannelLetter, string>;
  revealedChannels: Record<ChannelLetter, boolean>;
  onTriggerDraw?: () => void;
  winNotification?: string | null;
  liveAnnouncement?: string | null;
}

export const LiveDrawBillboard: React.FC<LiveDrawBillboardProps> = ({
  currentRoundId,
  previousRound,
  countdownSeconds,
  bettingClosed = false,
  isDrawing,
  rollingNumbers,
  revealedChannels,
  onTriggerDraw,
  winNotification,
  liveAnnouncement,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const channels: ChannelLetter[] = ['A', 'B', 'C', 'D', 'E'];

  return (
    <div
      ref={containerRef}
      className="relative w-full shrink-0 rounded-2xl overflow-hidden shadow-2xl bg-gradient-to-r from-[#2a0845] via-[#642b73] to-[#2a0845] text-white border-2 border-amber-400/40"
    >
      {/* Background Stage Image with overlay */}
      <div className="absolute inset-0 opacity-40 mix-blend-screen pointer-events-none overflow-hidden">
        <img
          src="/src/assets/images/lottery_stage_backdrop_1792387005975.jpg"
          alt="Stage"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Volumetric Spotlights & Beams effect */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-400/20 via-purple-900/40 to-transparent pointer-events-none" />

      {/* Top Bar of the Billboard */}
      <div className="relative z-10 px-3 sm:px-5 pt-2.5 sm:pt-3 flex items-center justify-between gap-2">
        {/* Left: Golden Ingot Bowl + Brand & Previous Round */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="relative w-10 h-10 sm:w-12 sm:h-12 xl:w-14 xl:h-14 rounded-full overflow-hidden border-2 border-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.8)] bg-gradient-to-b from-amber-300 to-amber-600 p-0.5 shrink-0">
            <img
              src="/src/assets/images/lottery_gold_ingot_pot_1792387005191.jpg"
              alt="Golden Pot"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover rounded-full"
            />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl xl:text-2xl font-extrabold tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
              ឆ្នោតសំណាង 1/99
            </h1>
            <div className="text-xs sm:text-sm font-mono text-purple-200/90 tracking-wide mt-0.5 flex items-center">
              <span>{isDrawing ? 'វេនបច្ចុប្បន្ន' : previousRound.date}</span>
              <span className="mx-1.5 text-amber-300 font-bold">
                {isDrawing ? currentRoundId : previousRound.roundId}
              </span>
              {isDrawing && (
                <span className="bg-amber-400 text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse font-sans shadow-xs">
                  កំពុងចាប់ A-E
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Countdown Timer Box + Fullscreen */}
        <div className="flex items-center gap-2">
          {/* Countdown Clock Box */}
          <div
            className={`bg-white/95 rounded-xl px-3 sm:px-4 py-1 sm:py-1.5 text-slate-900 shadow-xl border-2 text-center transition-colors ${
              bettingClosed || isDrawing || countdownSeconds === 0
                ? 'border-rose-500 ring-2 ring-rose-400/50'
                : 'border-amber-400/60'
            }`}
          >
            <div
              className={`font-mono text-xl sm:text-2xl xl:text-3xl font-black tracking-tight ${
                bettingClosed || isDrawing || countdownSeconds === 0 ? 'text-rose-600' : 'text-slate-900'
              }`}
            >
              {formatTimer(isDrawing ? 0 : countdownSeconds)}
            </div>
            <div className="text-[10px] sm:text-xs font-mono font-medium text-slate-600 tracking-tight flex items-center justify-center gap-1.5">
              {bettingClosed || isDrawing || countdownSeconds === 0 ? (
                <span className="font-sans font-bold text-rose-600 uppercase">Betting Closed</span>
              ) : (
                <>
                  <span>{previousRound.date}</span>
                  <span className="font-bold text-blue-700">{currentRoundId}</span>
                </>
              )}
            </div>
          </div>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            className="p-2 sm:p-2.5 rounded-lg bg-black/30 hover:bg-black/50 text-amber-300 transition-colors border border-white/10"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4 sm:w-5 sm:h-5" /> : <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>
        </div>
      </div>

      {/* Main Golden Slot Billboard Frame */}
      <div className="relative z-10 px-3 sm:px-5 pb-2.5 sm:pb-3.5 pt-2 flex flex-col items-center">
        {/* Golden Machine Border Box */}
        <div className="w-full max-w-4xl p-2 sm:p-2.5 rounded-2xl bg-gradient-to-b from-[#f9d423] via-[#e65c00] to-[#f9d423] shadow-[0_10px_30px_rgba(0,0,0,0.6),inset_0_2px_4px_rgba(255,255,255,0.8)] border-2 border-yellow-200">
          <div className="p-1.5 sm:p-2 rounded-xl bg-gradient-to-b from-[#240b36] to-[#000000] border border-amber-500/40 shadow-inner">
            <div className="grid grid-cols-5 gap-1.5 sm:gap-2.5">
              {channels.map((ch) => {
                const isRev = revealedChannels[ch];
                const displayNum = isDrawing
                  ? rollingNumbers[ch]
                  : previousRound.numbers[ch] || '--';
                const colStyle = CHANNEL_COLORS[ch];

                return (
                  <div
                    key={ch}
                    className={`flex flex-col items-stretch overflow-hidden rounded-lg sm:rounded-xl shadow-lg border transition-all duration-300 ${
                      isDrawing && isRev
                        ? 'border-amber-300 ring-2 ring-amber-300 scale-102 shadow-[0_0_15px_rgba(251,191,36,0.6)]'
                        : 'border-amber-300/30'
                    }`}
                  >
                    {/* Arched Red Post Header */}
                    <div className="bg-gradient-to-b from-[#e52d27] via-[#d31027] to-[#b31217] py-0.5 sm:py-1 text-center text-white font-black text-sm sm:text-lg xl:text-xl tracking-wider shadow-md border-b-2 border-amber-400 flex items-center justify-center gap-1">
                      <span>{ch}</span>
                      {isDrawing && isRev && (
                        <span className="text-[9px] bg-amber-300 text-slate-900 px-1 py-0.2 rounded font-sans font-black shadow-xs">
                          ចេញរួច
                        </span>
                      )}
                    </div>

                    {/* Slot Digit Container */}
                    <div className="bg-gradient-to-b from-white via-slate-50 to-slate-200 h-14 sm:h-20 xl:h-24 flex items-center justify-center relative overflow-hidden">
                      {/* Subtle horizontal glass line reflection */}
                      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/70 to-transparent pointer-events-none" />

                      {/* Number Text with authentic colors from screenshot */}
                      <span
                        className={`font-mono font-black text-3xl sm:text-4xl xl:text-5xl tracking-tight transition-transform duration-200 ${colStyle.text} ${
                          isDrawing && !isRev
                            ? 'animate-slot-shake blur-[0.4px]'
                            : isDrawing && isRev
                            ? 'scale-110 drop-shadow-md'
                            : 'scale-100'
                        }`}
                        style={{
                          textShadow: '0 2px 4px rgba(0, 0, 0, 0.25)',
                        }}
                      >
                        {displayNum}
                      </span>

                      {/* Shutter highlight if drawing and not yet revealed */}
                      {isDrawing && !isRev && (
                        <div className="absolute inset-0 bg-yellow-400/10 animate-pulse pointer-events-none" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Live Status Kicker / Instant Draw Button */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
          {isDrawing ? (
            <div className="flex items-center gap-2 bg-amber-500/20 text-amber-300 border border-amber-400/40 px-3 py-1 rounded-full text-xs sm:text-sm font-semibold animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>កំពុងចាប់ឆ្នោត A-E... (Betting Closed)</span>
            </div>
          ) : bettingClosed || countdownSeconds === 0 ? (
            <div className="flex items-center gap-2 bg-rose-600/90 text-white border border-rose-300/60 px-3.5 py-1 rounded-full text-xs sm:text-sm font-bold shadow-md">
              <span className="w-2 h-2 rounded-full bg-white" />
              <span>Betting Closed — Wait for Next Round ({currentRoundId})</span>
            </div>
          ) : onTriggerDraw ? (
            <button
              onClick={onTriggerDraw}
              className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-900 font-bold px-3 sm:px-4 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm shadow-lg transition-transform active:scale-95 border border-amber-200"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>ចាប់រង្វាន់ភ្លាមៗ (Draw Now)</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-black/30 text-amber-200 border border-amber-300/30 px-3 py-1 rounded-full text-xs sm:text-sm font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>កំពុងបើកទទួលការភ្នាល់ — ជុំ {currentRoundId}</span>
            </div>
          )}

          {/* Khmer Voice Announcement Banner */}
          {liveAnnouncement && (
            <div className="flex items-center gap-1.5 bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-300 text-slate-900 font-black px-3.5 py-1 rounded-full text-xs sm:text-sm shadow-lg border border-white/80 animate-bounce">
              <span className="text-sm">📢</span>
              <span className="font-sans font-bold">{liveAnnouncement}</span>
            </div>
          )}

          {winNotification && (
            <div className="bg-emerald-500 text-white font-bold px-3 py-1 rounded-full text-xs sm:text-sm shadow-lg animate-bounce">
              {winNotification}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
