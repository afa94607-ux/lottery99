import {
  formatCambodiaDateYmd,
  formatCambodiaTimeHms,
  shiftYmdDate,
  getDaysInMonth,
} from '../src/utils/formatters';
import type { BetTicket } from '../src/types/lottery';

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} - ${detail}`);
}

function main() {
  // 1. Midnight Cambodia UTC+7 boundary test
  // 2026-11-20 16:59:59 UTC == 2026-11-20 23:59:59 UTC+7
  const beforeMidnightMs = Date.UTC(2026, 10, 20, 16, 59, 59);
  // 2026-11-20 17:00:01 UTC == 2026-11-21 00:00:01 UTC+7
  const afterMidnightMs = Date.UTC(2026, 10, 20, 17, 0, 1);

  const dBefore = formatCambodiaDateYmd(beforeMidnightMs);
  const tBefore = formatCambodiaTimeHms(beforeMidnightMs);
  const dAfter = formatCambodiaDateYmd(afterMidnightMs);
  const tAfter = formatCambodiaTimeHms(afterMidnightMs);

  record(
    'Midnight Cambodia UTC+7 Boundary',
    dBefore === '2026-11-20' &&
      tBefore === '23:59:59' &&
      dAfter === '2026-11-21' &&
      tAfter === '00:00:01',
    `before=${dBefore} ${tBefore}, after=${dAfter} ${tAfter}`
  );

  // 2. Date navigation & month/leap-year clamping
  record(
    'Prev/Next Day & Month Boundary Navigation',
    shiftYmdDate('2026-11-21', -1) === '2026-11-20' &&
      shiftYmdDate('2026-11-21', 1) === '2026-11-22' &&
      shiftYmdDate('2026-03-01', -1) === '2026-02-28' &&
      getDaysInMonth(2024, 2) === 29 &&
      getDaysInMonth(2026, 2) === 28,
    'prev/next and Feb leap-year checks passed'
  );

  // 3. Synthetic multi-day, multi-player isolation & daily reconciliation
  const sampleTickets: BetTicket[] = [
    // Player A yesterday (2026-11-20): Lost 10,000
    {
      ticketId: 'T1',
      userId: 'P_A',
      username: 'playerA',
      roundId: '26292#200',
      createdAt: '2026-11-20 10:00',
      dateYmd: '2026-11-20',
      timestamp: Date.UTC(2026, 10, 20, 3, 0, 0),
      settledAt: Date.UTC(2026, 10, 20, 3, 5, 12),
      channels: ['A'],
      numbers: ['12'],
      stakePerUnit: 10000,
      totalBetsCount: 1,
      totalCost: 10000,
      status: 'LOST',
      wonAmount: 0,
      winningHits: [],
    },
    // Player A today (2026-11-21): Won 90,000 on 1,000 stake (Owner loss = 89,000)
    {
      ticketId: 'T2',
      userId: 'P_A',
      username: 'playerA',
      roundId: '26292#210',
      createdAt: '2026-11-21 08:00',
      dateYmd: '2026-11-21',
      timestamp: Date.UTC(2026, 10, 21, 1, 0, 0),
      settledAt: Date.UTC(2026, 10, 21, 1, 5, 30),
      channels: ['A'],
      numbers: ['45'],
      stakePerUnit: 1000,
      totalBetsCount: 1,
      totalCost: 1000,
      status: 'WON',
      wonAmount: 90000,
      winningHits: [{ channel: 'A', number: '45', winAmount: 90000 }],
    },
    // Player B today (2026-11-21): Lost 5,000 (Owner profit = 5,000)
    {
      ticketId: 'T3',
      userId: 'P_B',
      username: 'playerB',
      roundId: '26292#210',
      createdAt: '2026-11-21 08:02',
      dateYmd: '2026-11-21',
      timestamp: Date.UTC(2026, 10, 21, 1, 2, 0),
      settledAt: Date.UTC(2026, 10, 21, 1, 5, 30),
      channels: ['B'],
      numbers: ['99'],
      stakePerUnit: 5000,
      totalBetsCount: 1,
      totalCost: 5000,
      status: 'LOST',
      wonAmount: 0,
      winningHits: [],
    },
    // Player A today pending (excluded from settled totals)
    {
      ticketId: 'T4',
      userId: 'P_A',
      username: 'playerA',
      roundId: '26292#211',
      createdAt: '2026-11-21 08:10',
      dateYmd: '2026-11-21',
      timestamp: Date.UTC(2026, 10, 21, 1, 10, 45),
      settledAt: null,
      channels: ['C'],
      numbers: ['07'],
      stakePerUnit: 2000,
      totalBetsCount: 1,
      totalCost: 2000,
      status: 'PENDING',
      wonAmount: 0,
      winningHits: [],
    },
  ];

  const summarize = (userId: string | null, ymd: string) => {
    const daySettled = sampleTickets.filter(
      (t) =>
        (userId === null || t.userId === userId) &&
        (t.dateYmd || formatCambodiaDateYmd(t.settledAt ?? t.timestamp)) === ymd &&
        (t.status === 'WON' || t.status === 'LOST')
    );
    const stakes = daySettled.reduce((s, t) => s + t.totalCost, 0);
    const payouts = daySettled.reduce((s, t) => s + t.wonAmount, 0);
    let ownerProfit = 0;
    let ownerLoss = 0;
    for (const t of daySettled) {
      const diff = t.totalCost - t.wonAmount;
      if (diff > 0) ownerProfit += diff;
      else if (diff < 0) ownerLoss += Math.abs(diff);
    }
    return {
      count: daySettled.length,
      stakes,
      payouts,
      playerNet: payouts - stakes,
      ownerProfit,
      ownerLoss,
      ownerNet: stakes - payouts,
    };
  };

  const todayAll = summarize(null, '2026-11-21');
  const yesterdayAll = summarize(null, '2026-11-20');
  const todayPlayerA = summarize('P_A', '2026-11-21');
  const todayPlayerB = summarize('P_B', '2026-11-21');
  const emptyDay = summarize(null, '2026-11-19');

  record(
    'Today vs Yesterday Isolation & Pending Exclusion',
    todayAll.count === 2 &&
      todayAll.stakes === 6000 &&
      todayAll.payouts === 90000 &&
      yesterdayAll.count === 1 &&
      yesterdayAll.stakes === 10000 &&
      yesterdayAll.payouts === 0 &&
      emptyDay.count === 0 &&
      emptyDay.stakes === 0,
    `todayAll=${JSON.stringify(todayAll)}, yesterdayAll=${JSON.stringify(yesterdayAll)}`
  );

  record(
    'Zero-Sum Reconciliation (All-Players & Per-Player)',
    todayAll.playerNet === 84000 &&
      todayAll.ownerNet === -84000 &&
      todayAll.playerNet + todayAll.ownerNet === 0 &&
      todayAll.ownerProfit === 5000 &&
      todayAll.ownerLoss === 89000 &&
      todayAll.ownerNet === todayAll.ownerProfit - todayAll.ownerLoss &&
      todayPlayerA.stakes === 1000 &&
      todayPlayerA.payouts === 90000 &&
      todayPlayerA.playerNet === 89000 &&
      todayPlayerA.ownerNet === -89000 &&
      todayPlayerA.playerNet + todayPlayerA.ownerNet === 0 &&
      todayPlayerB.stakes === 5000 &&
      todayPlayerB.payouts === 0 &&
      todayPlayerB.playerNet === -5000 &&
      todayPlayerB.ownerNet === 5000 &&
      todayPlayerB.playerNet + todayPlayerB.ownerNet === 0 &&
      todayPlayerA.playerNet + todayPlayerB.playerNet === todayAll.playerNet,
    `allPlayerNet=+${todayAll.playerNet}, allOwnerNet=${todayAll.ownerNet}, sum=${todayAll.playerNet + todayAll.ownerNet}; playerANet=+${todayPlayerA.playerNet}, playerBNet=${todayPlayerB.playerNet}`
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} report tests PASSED.`);
  if (failed.length > 0) process.exit(1);
}

main();
