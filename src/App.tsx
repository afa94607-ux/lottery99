/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { Header } from './components/Header';
import { LiveDrawBillboard } from './components/LiveDrawBillboard';
import { NumberGrid } from './components/NumberGrid';
import { BettingPanel } from './components/BettingPanel';
import { UserSidebar } from './components/UserSidebar';
import { PrintReceiptModal } from './components/PrintReceiptModal';
import { WinLossView } from './components/WinLossView';
import { ResultsArchiveView } from './components/ResultsArchiveView';
import { DepositModal } from './components/DepositModal';
import { PlayerLogin } from './components/PlayerLogin';
import {
  ChannelLetter,
  RoundResult,
  BetTicket,
  SelectionMode,
  AppUser,
  SystemConfig,
  BalanceTransaction,
} from './types/lottery';
import {
  INITIAL_PAST_ROUNDS,
  DEFAULT_SYSTEM_CONFIG,
  padNumber,
  formatCambodiaDateYmd,
} from './utils/formatters';
import { sound } from './utils/audio';
import { announceKhmerDraw } from './utils/khmerVoice';
import { lotteryApi } from './utils/lotteryApi';

const TOKEN_KEY_PLAYER = 'lottery888_player_token_v1';

const getTodayDateStr = (): string => formatCambodiaDateYmd(Date.now());

export default function App() {
  const [playerToken, setPlayerToken] = useState<string | null>(() =>
    typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY_PLAYER) : null
  );
  const [playerSession, setPlayerSession] = useState<AppUser | null>(null);
  const [isVerifyingAuth, setIsVerifyingAuth] = useState<boolean>(true);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const verify = async () => {
      try {
        if (playerToken) {
          const res = await lotteryApi.verifySession(playerToken);
          if (mounted) {
            if (res.ok && res.data?.account?.role === 'PLAYER' && res.data.account.status === 'ACTIVE') {
              setPlayerSession(res.data.account);
            } else {
              localStorage.removeItem(TOKEN_KEY_PLAYER);
              setPlayerToken(null);
              setPlayerSession(null);
            }
          }
        }
      } finally {
        if (mounted) setIsVerifyingAuth(false);
      }
    };
    verify();
    return () => {
      mounted = false;
    };
  }, []);

  const [currentTab, setCurrentTab] = useState<'home' | 'winloss' | 'results'>('home');
  const [isMuted, setIsMuted] = useState(false);

  const [currentRoundId, setCurrentRoundId] = useState<string>('26292#149');
  const [countdownSeconds, setCountdownSeconds] = useState<number>(
    DEFAULT_SYSTEM_CONFIG.drawIntervalSeconds
  );
  const [bettingClosed, setBettingClosed] = useState<boolean>(false);
  const [pastRounds, setPastRounds] = useState<RoundResult[]>(INITIAL_PAST_ROUNDS);
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(DEFAULT_SYSTEM_CONFIG);
  const [playerTickets, setPlayerTickets] = useState<BetTicket[]>([]);
  const [playerTransactions, setPlayerTransactions] = useState<BalanceTransaction[]>([]);

  const [isDrawing, setIsDrawing] = useState(false);
  const [rollingNumbers, setRollingNumbers] = useState<Record<ChannelLetter, string>>(
    INITIAL_PAST_ROUNDS[0].numbers
  );
  const [revealedChannels, setRevealedChannels] = useState<Record<ChannelLetter, boolean>>({
    A: true,
    B: true,
    C: true,
    D: true,
    E: true,
  });

  const lastAnimatedRoundRef = useRef<string | null>(null);
  const activeDrawTimeoutsRef = useRef<number[]>([]);
  const activeRollIntervalRef = useRef<number | null>(null);
  const isMutedRef = useRef<boolean>(false);
  const pendingWinCheckRoundRef = useRef<string | null>(null);
  const serverClockOffsetRef = useRef<number>(0);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const clearDrawAnimationTimers = useCallback(() => {
    if (activeRollIntervalRef.current !== null) {
      window.clearInterval(activeRollIntervalRef.current);
      activeRollIntervalRef.current = null;
    }
    activeDrawTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    activeDrawTimeoutsRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearDrawAnimationTimers();
  }, [clearDrawAnimationTimers]);

  const [selectionMode, setSelectionMode] = useState<SelectionMode>('NUMBER');
  const [selectedChannels, setSelectedChannels] = useState<ChannelLetter[]>(['A', 'B', 'C', 'D', 'E']);
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>(['42']);
  const [stakePerUnit, setStakePerUnit] = useState<number>(1000);
  const [isSubmittingBet, setIsSubmittingBet] = useState<boolean>(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [lastSubmittedBet, setLastSubmittedBet] = useState<{
    channels: ChannelLetter[];
    numbers: string[];
    stake: number;
  } | null>(null);

  const [activeReceiptTicket, setActiveReceiptTicket] = useState<BetTicket | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [winNotification, setWinNotification] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string | null>(null);

  const currentDate = getTodayDateStr();

  const handlePlayerLogin = (account: AppUser, token: string) => {
    setSessionNotice(null);
    localStorage.setItem(TOKEN_KEY_PLAYER, token);
    setPlayerToken(token);
    setPlayerSession(account);
    setBetError(null);
  };

  const handlePlayerLogout = useCallback(
    async (notice?: string) => {
      if (playerToken) {
        await lotteryApi.logout(playerToken);
      }
      clearDrawAnimationTimers();
      setIsDrawing(false);
      localStorage.removeItem(TOKEN_KEY_PLAYER);
      setPlayerToken(null);
      setPlayerSession(null);
      setPlayerTickets([]);
      setPlayerTransactions([]);
      setWinNotification(null);
      setLiveAnnouncement(null);
      if (notice) setSessionNotice(notice);
    },
    [playerToken, clearDrawAnimationTimers]
  );

  const startClientDrawAnimation = useCallback(
    (targetNumbers: Record<ChannelLetter, string>, roundIdToDraw: string) => {
      if (lastAnimatedRoundRef.current === roundIdToDraw) return;
      lastAnimatedRoundRef.current = roundIdToDraw;

      clearDrawAnimationTimers();
      setIsDrawing(true);
      setWinNotification(null);
      setLiveAnnouncement('ចាប់ផ្តើមចេញលទ្ធផល...');
      sound.playResultIncoming();

      setRevealedChannels({ A: false, B: false, C: false, D: false, E: false });
      const revealedMap: Record<ChannelLetter, boolean> = {
        A: false,
        B: false,
        C: false,
        D: false,
        E: false,
      };

      activeRollIntervalRef.current = window.setInterval(() => {
        sound.playReelTick();
        setRollingNumbers({
          A: revealedMap.A ? targetNumbers.A : padNumber(Math.floor(Math.random() * 99) + 1),
          B: revealedMap.B ? targetNumbers.B : padNumber(Math.floor(Math.random() * 99) + 1),
          C: revealedMap.C ? targetNumbers.C : padNumber(Math.floor(Math.random() * 99) + 1),
          D: revealedMap.D ? targetNumbers.D : padNumber(Math.floor(Math.random() * 99) + 1),
          E: revealedMap.E ? targetNumbers.E : padNumber(Math.floor(Math.random() * 99) + 1),
        });
      }, 80);

      const channels: ChannelLetter[] = ['A', 'B', 'C', 'D', 'E'];
      const channelKhmerNames: Record<ChannelLetter, string> = {
        A: 'ប៉ុស្តិ៍ អេ (A)',
        B: 'ប៉ុស្តិ៍ ប៊ី (B)',
        C: 'ប៉ុស្តិ៍ ស៊ី (C)',
        D: 'ប៉ុស្តិ៍ ឌី (D)',
        E: 'ប៉ុស្តិ៍ អ៊ី (E)',
      };

      channels.forEach((ch, idx) => {
        const timeoutId = window.setTimeout(() => {
          revealedMap[ch] = true;
          setRevealedChannels((prev) => ({ ...prev, [ch]: true }));
          setRollingNumbers((prev) => ({ ...prev, [ch]: targetNumbers[ch] }));
          sound.playChannelReveal(ch);
          setLiveAnnouncement(`${channelKhmerNames[ch]} លេខ ${targetNumbers[ch]}`);
          announceKhmerDraw(ch, targetNumbers[ch], isMutedRef.current);

          if (idx === channels.length - 1) {
            if (activeRollIntervalRef.current !== null) {
              window.clearInterval(activeRollIntervalRef.current);
              activeRollIntervalRef.current = null;
            }
            const finishId = window.setTimeout(() => {
              setIsDrawing(false);
              setLiveAnnouncement(null);
              pendingWinCheckRoundRef.current = roundIdToDraw;
            }, 1300);
            activeDrawTimeoutsRef.current.push(finishId);
          }
        }, 950 + idx * 1050);

        activeDrawTimeoutsRef.current.push(timeoutId);
      });
    },
    [clearDrawAnimationTimers]
  );

  const refreshPlayerState = useCallback(async () => {
    if (!playerToken) return;
    const res = await lotteryApi.getPlayerState(playerToken);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        await handlePlayerLogout(
          'គណនីរបស់អ្នកត្រូវបានផ្អាក ឬសម័យប្រើប្រាស់ផុតកំណត់! សូមចូលម្តងទៀត។'
        );
      }
      return;
    }
    const state = res.data;
    if (!state) return;

    serverClockOffsetRef.current = Date.now() - state.serverTimestamp;
    setPlayerSession(state.account);
    setCurrentRoundId(state.currentRoundId);
    setSystemConfig(state.systemConfig);
    setPastRounds(state.pastRounds);
    setPlayerTickets(state.tickets);
    setPlayerTransactions(state.transactions);

    if (state.isDrawing && state.activeDraw) {
      setCountdownSeconds(0);
      setBettingClosed(true);
      startClientDrawAnimation(state.activeDraw.numbers, state.activeDraw.roundId);
    } else {
      const maxDuration = Math.max(
        1,
        state.roundDurationSeconds || state.systemConfig.drawIntervalSeconds || 300
      );
      const remaining = Math.min(
        maxDuration,
        Math.max(
          0,
          Math.ceil((state.roundEndTime - (Date.now() - serverClockOffsetRef.current)) / 1000)
        )
      );
      setCountdownSeconds(remaining);
      setBettingClosed(
        Boolean(state.bettingClosed) || !state.systemConfig.isSystemOpen || remaining <= 0
      );
      if (!isDrawing && state.pastRounds.length > 0) {
        setRollingNumbers(state.pastRounds[0].numbers);
      }
    }

    if (pendingWinCheckRoundRef.current && !state.isDrawing) {
      const roundToCheck = pendingWinCheckRoundRef.current;
      const settledForRound = state.tickets.filter(
        (t) => t.roundId === roundToCheck && t.status !== 'PENDING'
      );
      if (settledForRound.length > 0 || state.pastRounds.some((r) => r.roundId === roundToCheck)) {
        pendingWinCheckRoundRef.current = null;
        const wonTotal = settledForRound.reduce((sum, t) => sum + (t.wonAmount || 0), 0);
        if (wonTotal > 0) {
          sound.playWin();
          confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
          setWinNotification(`អបអរសាទរ! អ្នកបានឈ្នះរង្វាន់ចំនួន +${wonTotal.toLocaleString()}៛`);
        }
      }
    }
  }, [playerToken, isDrawing, startClientDrawAnimation, handlePlayerLogout]);

  useEffect(() => {
    if (!playerToken || !playerSession) return;
    refreshPlayerState();
    const interval = window.setInterval(refreshPlayerState, 1000);
    const handleOnline = () => refreshPlayerState();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshPlayerState();
    };
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [playerToken, Boolean(playerSession), refreshPlayerState]);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    sound.setMuted(next);
  };

  const toggleChannel = (channel: ChannelLetter) => {
    setBetError(null);
    setSelectedChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
  };

  const selectAllChannels = () => {
    setBetError(null);
    setSelectedChannels((prev) => (prev.length === 5 ? [] : ['A', 'B', 'C', 'D', 'E']));
  };

  const toggleNumber = (num: string) => {
    setBetError(null);
    setSelectedNumbers((prev) =>
      prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]
    );
  };

  const selectMultipleNumbers = (nums: string[]) => {
    setBetError(null);
    setSelectedNumbers(nums);
  };

  const clearNumbers = () => {
    setBetError(null);
    setSelectedNumbers([]);
  };

  const handleSubmitBet = async () => {
    if (!playerToken || !playerSession || isSubmittingBet) return;
    setBetError(null);

    if (!systemConfig.isSystemOpen) {
      setBetError('ប្រព័ន្ធឆ្នោតកំពុងត្រូវបានផ្អាកជាបណ្ដោះអាសន្ន!');
      sound.playBeep();
      return;
    }
    if (bettingClosed || isDrawing || countdownSeconds <= 0) {
      setBetError('បិទការភ្នាល់សម្រាប់ជុំនេះហើយ (Betting Closed)! សូមរង់ចាំជុំបន្ទាប់។');
      sound.playBeep();
      return;
    }

    const totalBets = selectedChannels.length * selectedNumbers.length;
    const totalCost = totalBets * stakePerUnit;
    if (totalBets === 0 || stakePerUnit <= 0) return;
    if (totalCost > playerSession.balance) {
      setBetError('សមតុល្យទឹកប្រាក់មិនគ្រប់គ្រាន់ទេ! សូមទាក់ទងម្ចាស់ប្រព័ន្ធ (Owner) ដើម្បីដាក់ប្រាក់។');
      sound.playBeep();
      return;
    }

    setIsSubmittingBet(true);
    const clientRequestId = `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const res = await lotteryApi.placePlayerBet(playerToken, {
      channels: [...selectedChannels],
      numbers: [...selectedNumbers],
      stakePerUnit,
      clientRequestId,
    });
    setIsSubmittingBet(false);

    if (!res.ok || !res.data) {
      sound.playBeep();
      if (res.status === 401 || res.status === 403) {
        await handlePlayerLogout(
          'គណនីរបស់អ្នកត្រូវបានផ្អាក ឬសម័យប្រើប្រាស់ផុតកំណត់! សូមចូលម្តងទៀត។'
        );
        return;
      }
      setBetError(res.error || 'មិនអាចដាក់ការភ្នាល់បានទេ!');
      return;
    }

    sound.playCash();
    setLastSubmittedBet({
      channels: [...selectedChannels],
      numbers: [...selectedNumbers],
      stake: stakePerUnit,
    });
    setPlayerSession((prev) => (prev ? { ...prev, balance: res.data!.newBalance } : prev));
    setPlayerTickets((prev) => {
      if (prev.some((t) => t.ticketId === res.data!.ticket.ticketId)) return prev;
      return [res.data!.ticket, ...prev];
    });
    refreshPlayerState();
  };

  const handleRepeatLastBet = () => {
    if (!lastSubmittedBet) return;
    sound.playSelect();
    setBetError(null);
    setSelectedChannels(lastSubmittedBet.channels);
    setSelectedNumbers(lastSubmittedBet.numbers);
    setStakePerUnit(lastSubmittedBet.stake);
  };

  const handleClearAll = () => {
    sound.playClick();
    setBetError(null);
    setSelectedNumbers([]);
    setStakePerUnit(0);
  };

  const handleViewTicket = (ticket: BetTicket) => {
    sound.playClick();
    setActiveReceiptTicket(ticket);
    setIsPrintModalOpen(true);
  };

  const handlePrintSlipPreview = () => {
    if (!playerSession) return;
    const totalBets = selectedChannels.length * selectedNumbers.length;
    const totalCost = totalBets * stakePerUnit;
    const now = new Date();
    const previewTicket: BetTicket = {
      ticketId: `PREVIEW-${Math.floor(10000 + Math.random() * 90000)}`,
      userId: playerSession.id,
      roundId: currentRoundId,
      createdAt: `${currentDate} ${String(now.getHours()).padStart(2, '0')}:${String(
        now.getMinutes()
      ).padStart(2, '0')}`,
      timestamp: Date.now(),
      channels: [...selectedChannels],
      numbers: [...selectedNumbers],
      stakePerUnit,
      totalBetsCount: totalBets,
      totalCost,
      status: 'PENDING',
      wonAmount: 0,
      winningHits: [],
    };
    setActiveReceiptTicket(previewTicket);
    setIsPrintModalOpen(true);
  };

  const playerBalance = playerSession?.balance ?? 0;
  const inPlayBet = playerTickets
    .filter((t) => t.roundId === currentRoundId && t.status === 'PENDING')
    .reduce((acc, t) => acc + t.totalCost, 0);

  const latestFinishedRound = pastRounds[0] || INITIAL_PAST_ROUNDS[0];

  if (isVerifyingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-amber-400 font-bold text-sm">
        កំពុងផ្ទៀងផ្ទាត់ប្រព័ន្ធ (Loading Lottery888)...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#eef2f7]">
      {!playerSession ? (
        <div className="relative flex-1 flex flex-col">
          {sessionNotice && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-rose-600 text-white px-5 py-3 rounded-xl shadow-2xl border border-rose-400 text-xs font-bold flex items-center gap-3">
              <span>{sessionNotice}</span>
              <button
                onClick={() => setSessionNotice(null)}
                className="text-rose-100 hover:text-white underline cursor-pointer"
              >
                បិទ
              </button>
            </div>
          )}
          <PlayerLogin onLogin={handlePlayerLogin} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col animate-fadeIn">
          <Header
            currentTab={currentTab}
            setCurrentTab={setCurrentTab}
            balance={playerBalance}
            currentUserId={playerSession.id}
            currentUserName={playerSession.name}
            isMuted={isMuted}
            toggleMute={toggleMute}
            drawIntervalSeconds={systemConfig.drawIntervalSeconds}
            onOpenDeposit={() => setIsDepositModalOpen(true)}
            onLogout={() => handlePlayerLogout()}
          />

          <main className="flex-1 w-full max-w-[1720px] mx-auto p-2 sm:p-4">
            {currentTab === 'home' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 items-start">
                <aside className="lg:col-span-3 xl:col-span-2 order-2 lg:order-1">
                  <UserSidebar
                    currentDate={currentDate}
                    userId={playerSession.id}
                    balance={playerBalance}
                    inPlayBet={inPlayBet}
                    recentTickets={playerTickets}
                    onRefresh={() => {
                      sound.playClick();
                      refreshPlayerState();
                    }}
                    onViewTicket={handleViewTicket}
                    onOpenWalletInfo={() => setIsDepositModalOpen(true)}
                  />
                </aside>

                <section className="lg:col-span-6 xl:col-span-7 flex flex-col gap-3.5 order-1 lg:order-2">
                  <LiveDrawBillboard
                    currentRoundId={currentRoundId}
                    previousRound={latestFinishedRound}
                    countdownSeconds={countdownSeconds}
                    bettingClosed={bettingClosed}
                    isDrawing={isDrawing}
                    rollingNumbers={rollingNumbers}
                    revealedChannels={revealedChannels}
                    winNotification={winNotification}
                    liveAnnouncement={liveAnnouncement}
                  />

                  <NumberGrid
                    selectionMode={selectionMode}
                    setSelectionMode={setSelectionMode}
                    selectedChannels={selectedChannels}
                    toggleChannel={toggleChannel}
                    selectAllChannels={selectAllChannels}
                    selectedNumbers={selectedNumbers}
                    toggleNumber={toggleNumber}
                    selectMultipleNumbers={selectMultipleNumbers}
                    clearNumbers={clearNumbers}
                    disabled={bettingClosed || isDrawing}
                  />
                </section>

                <aside className="lg:col-span-3 xl:col-span-3 order-3">
                  <BettingPanel
                    stakePerUnit={stakePerUnit}
                    setStakePerUnit={(amt) => {
                      setBetError(null);
                      setStakePerUnit(amt);
                    }}
                    selectedChannels={selectedChannels}
                    selectedNumbers={selectedNumbers}
                    pastRounds={pastRounds}
                    onSubmitBet={handleSubmitBet}
                    onPrintSlip={handlePrintSlipPreview}
                    onClearAll={handleClearAll}
                    onRepeatLastBet={handleRepeatLastBet}
                    canRepeat={lastSubmittedBet !== null}
                    userBalance={playerBalance}
                    payoutRate={systemConfig.payoutRate}
                    isSubmitting={isSubmittingBet}
                    betError={betError}
                    isDrawing={isDrawing}
                    bettingClosed={bettingClosed}
                    currentDrawingRound={
                      isDrawing
                        ? {
                            roundId: currentRoundId,
                            drawTime: `${String(new Date().getHours()).padStart(2, '0')}:${String(
                              new Date().getMinutes()
                            ).padStart(2, '0')}`,
                            numbers: rollingNumbers,
                            revealed: revealedChannels,
                          }
                        : null
                    }
                  />
                </aside>
              </div>
            )}

            {currentTab === 'winloss' && (
              <WinLossView
                tickets={playerTickets}
                currentUser={playerSession}
                onViewTicket={handleViewTicket}
              />
            )}

            {currentTab === 'results' && (
              <ResultsArchiveView
                pastRounds={pastRounds}
                payoutRate={systemConfig.payoutRate}
              />
            )}
          </main>
        </div>
      )}

      <PrintReceiptModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        ticket={activeReceiptTicket}
      />

      <DepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
        currentBalance={playerBalance}
        currentUser={playerSession}
        transactions={playerTransactions}
      />
    </div>
  );
}
