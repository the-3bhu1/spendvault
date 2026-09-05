// Phase 0 parity check: the new service must reproduce the numbers the OLD Dashboard/Accounts
// derivation produced, and must differ from the OLD Bills derivation only in the two ways intended
// (the affectsRupeeBalance filter, and the calendar-day due comparison). Kept as a test rather than
// a throwaway script because these are the invariants the whole redesign leans on.
import { describe, it, expect } from 'vitest';
import { format, addMonths, parseISO, subMonths, setDate } from 'date-fns';
import { getCardDues, getCardCycleFigures, getCardCycleFiguresByCycle, getCycleDueDate, sumCardDues, getActiveCardDues, cycleStatus, isCycleOverdue } from './CardDuesService';
import { getAppliedBillingCycle, getBillingCycleForDate, getLatestBilledCycle, affectsRupeeBalance, calculateCycleBalanceForCycle } from '../utils';
import type { Account, Transaction, RoundingRule } from '../types';

const NOW = new Date(2026, 7, 22); // 22 Aug 2026 — the date the plan was written against

const card = (over: Partial<Account> = {}): Account => ({
  id: 'cc1', name: 'Swiggy x HDFC', type: 'credit_card',
  openingBalances: {}, statementDay: 17, dueDay: 5, creditLimit: 90000, ...over,
});

let n = 0;
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, date: '2026-08-10', description: 'x', accountId: 'cc1',
  type: 'debit', amount: 100, category: 'Food', isRecurring: false, ...over,
});

// ── the OLD derivations, transcribed verbatim from git history ────────────────────────────────────

/** Dashboard.tsx:39-81 as it stood before the extraction. */
const oldDashboardDues = (acc: Account, txs: Transaction[]) => {
  const statementDay = acc.statementDay || 1;
  // Pinned to NOW like the service it is being compared against. Left on the wall clock this
  // transcription answers about a different instant, and the whole comparison silently stops
  // being like-for-like the moment the real date crosses a cycle boundary — which is exactly how
  // this surfaced, on 1 September against a NOW of 22 August.
  const billedCycle = getLatestBilledCycle(statementDay, NOW);
  const unbilledCycle = format(addMonths(parseISO(`${billedCycle}-01`), 1), 'yyyy-MM');
  let billed = 0, unbilled = 0;
  txs.forEach(t => {
    if (t.accountId === acc.id && affectsRupeeBalance(t)) {
      const c = getAppliedBillingCycle(t, statementDay);
      if (c === unbilledCycle) unbilled += t.type === 'debit' ? t.amount : -t.amount;
      else if (c === billedCycle) billed += t.type === 'debit' ? t.amount : -t.amount;
    }
  });
  const raw = Math.max(0, billed);
  const r = acc.statementRounding || 'none';
  const finalBilled = r === 'round' ? Math.round(raw) : r === 'floor' ? Math.floor(raw) : r === 'ceil' ? Math.ceil(raw) : raw;
  const finalUnbilled = Math.max(0, unbilled);
  return { billed: finalBilled, unbilled: finalUnbilled, total: finalBilled + finalUnbilled };
};

/** utils.ts calculateTotalSpendPerCycle as it stood — note the absent rupee-leg filter. */
const oldBillsNetPayable = (txs: Transaction[], accountId: string, cycle: string, statementDay: number, rounding: RoundingRule = 'none') => {
  let spend = 0, payment = 0;
  txs.forEach(t => {
    if (t.accountId !== accountId) return;
    if (getAppliedBillingCycle(t, statementDay) === cycle) {
      if (t.type === 'debit') spend += t.amount;
      if (t.type === 'credit') payment += t.amount;
    }
  });
  const raw = spend - payment;
  return rounding === 'round' ? Math.round(raw) : rounding === 'floor' ? Math.floor(raw) : rounding === 'ceil' ? Math.ceil(raw) : raw;
};

describe('parity with the old Dashboard/Accounts derivation', () => {
  const cases: [string, Partial<Account>, Transaction[]][] = [
    ['plain spend in both cycles', {}, [
      tx({ date: '2026-08-20', amount: 5000 }),          // open cycle (cut 17th)
      tx({ date: '2026-08-02', amount: 1200 }),          // billed cycle
      tx({ date: '2026-07-20', amount: 800 }),           // billed cycle
    ]],
    ['a payment against the closed statement', {}, [
      tx({ date: '2026-08-01', amount: 3000 }),
      tx({ date: '2026-08-05', amount: 2500, type: 'credit', category: 'CC Payment' }),
    ]],
    ['overpaid statement clamps to zero', { statementRounding: 'floor' }, [
      tx({ date: '2026-08-01', amount: 100 }),
      tx({ date: '2026-08-03', amount: 400, type: 'credit', category: 'CC Payment' }),
    ]],
    ['fractional amounts under each rounding rule — round', { statementRounding: 'round' }, [
      tx({ date: '2026-08-01', amount: 1200.63 }), tx({ date: '2026-08-20', amount: 55.44 }),
    ]],
    ['fractional amounts under each rounding rule — ceil', { statementRounding: 'ceil' }, [
      tx({ date: '2026-08-01', amount: 1200.11 }), tx({ date: '2026-08-20', amount: 55.44 }),
    ]],
    ['fractional amounts under each rounding rule — floor', { statementRounding: 'floor' }, [
      tx({ date: '2026-08-01', amount: 1200.91 }), tx({ date: '2026-08-20', amount: 55.44 }),
    ]],
    ['a manually moved charge', {}, [
      tx({ date: '2026-08-16', amount: 900, appliedBillingCycleYearMonth: '2026-09', cycleMovedManually: true }),
      tx({ date: '2026-08-02', amount: 400 }),
    ]],
    ['a reward-points redemption leg on the same card', {}, [
      // A ₹448 purchase settled with ₹362 of credit and ₹86 of the card's own points: the rupee leg
      // is what the card lent, the points leg is a different balance on the same account.
      tx({ date: '2026-08-01', amount: 362 }),
      tx({ date: '2026-08-01', amount: 86, isRewardTransaction: true }),
    ]],
    ['a travel-purse leg', {}, [
      tx({ date: '2026-08-01', amount: 500 }),
      tx({ date: '2026-08-01', amount: 200, isTravelTransaction: true }),
    ]],
    ['another account’s transactions are ignored', {}, [
      tx({ date: '2026-08-01', amount: 700 }),
      tx({ date: '2026-08-01', amount: 9999, accountId: 'other' }),
    ]],
    ['statement day 1 (the default fallback)', { statementDay: undefined }, [
      tx({ date: '2026-08-14', amount: 640 }), tx({ date: '2026-07-30', amount: 210 }),
    ]],
    ['nothing at all', {}, []],
  ];

  it.each(cases)('%s', (_label, over, txs) => {
    const acc = card(over);
    const old = oldDashboardDues(acc, txs);
    const next = getCardDues(acc, txs, NOW);
    expect(next.billed).toBe(old.billed);
    expect(next.unbilled).toBe(old.unbilled);
    expect(next.outstanding).toBe(old.total);
  });

  it('derives the same two cycles the old code did', () => {
    const acc = card();
    const billed = getLatestBilledCycle(acc.statementDay!, NOW);
    const dues = getCardDues(acc, [], NOW);
    expect(dues.billedCycle).toBe(billed);
    expect(dues.unbilledCycle).toBe(format(addMonths(parseISO(`${billed}-01`), 1), 'yyyy-MM'));
    expect(dues.unbilledCycle).toBe(getBillingCycleForDate(format(NOW, 'yyyy-MM-dd'), acc.statementDay!));
  });
});

describe('the two intended departures from the old Bills derivation', () => {
  it('excludes a points redemption that the old Bills math counted as a charge', () => {
    const acc = card();
    const txs = [
      tx({ date: '2026-08-01', amount: 362 }),
      tx({ date: '2026-08-01', amount: 86, isRewardTransaction: true }),
    ];
    const cycle = getLatestBilledCycle(acc.statementDay!, NOW);
    // The old Bills helper counted the points leg as a second charge — the exact failure the
    // affectsRupeeBalance predicate was written for.
    expect(oldBillsNetPayable(txs, acc.id, cycle, acc.statementDay!, acc.statementRounding)).toBe(448);
    // The card only ever lent ₹362, which is what Accounts and the Dashboard reported all along.
    expect(getCardDues(acc, txs, NOW).billed).toBe(362);
    expect(oldDashboardDues(acc, txs).billed).toBe(362);
  });

  it('a bill due today reads as due today, not next month', () => {
    const acc = card({ dueDay: 22 }); // NOW is the 22nd
    const dues = getCardDues(acc, [], NOW);
    expect(dues.daysToDue).toBe(0);
    expect(dues.dueDate).toBe('2026-08-22');
    // The old arithmetic: `new Date(y, m, dueDay)` is midnight, `today` carries a time, so on the
    // due date itself the comparison was true and the date jumped a month.
    const oldDue = new Date(2026, 7, 22);
    const oldToday = new Date(2026, 7, 22, 17, 49);
    expect(oldDue < oldToday).toBe(true); // …which is the bug
  });

  it('rolls forward only once the due date has passed', () => {
    expect(getCardDues(card({ dueDay: 5 }), [], NOW).dueDate).toBe('2026-09-05');
    expect(getCardDues(card({ dueDay: 25 }), [], NOW).dueDate).toBe('2026-08-25');
    expect(getCardDues(card({ dueDay: 25 }), [], NOW).daysToDue).toBe(3);
  });
});

describe('cycle figures, totals and ordering', () => {
  it('keeps the signed net alongside the clamped payable', () => {
    const acc = card({ statementRounding: 'floor' });
    const txs = [tx({ date: '2026-08-01', amount: 100 }), tx({ date: '2026-08-02', amount: 103.2, type: 'credit' })];
    const f = getCardCycleFigures(acc, txs, getLatestBilledCycle(17, NOW));
    expect(f.spend).toBe(100);
    expect(f.payment).toBe(103.2);
    expect(f.net).toBeCloseTo(-3.2);
    expect(f.payable).toBe(0); // clamped BEFORE any rounding — floor(-3.2) would have been -4
    expect(f.statementAmount).toBe(0);
  });

  it('reports utilization only against limits that exist', () => {
    const withLimit = card({ id: 'a', creditLimit: 100000 });
    const without = card({ id: 'b', name: 'Slice', creditLimit: undefined, dueDay: 20 });
    const txs = [
      tx({ accountId: 'a', date: '2026-08-01', amount: 25000 }),
      tx({ accountId: 'b', date: '2026-08-01', amount: 50000 }),
    ];
    const dues = getActiveCardDues([withLimit, without], txs, NOW);
    const totals = sumCardDues(dues);
    expect(totals.outstanding).toBe(75000);
    expect(totals.creditLimit).toBe(100000);
    expect(totals.utilization).toBeCloseTo(0.25); // not 0.75 — the unlimited card isn't in the ratio
  });

  it('skips archived cards and orders by urgency', () => {
    const soon = card({ id: 'a', name: 'Soon', dueDay: 25 });
    const later = card({ id: 'b', name: 'Later', dueDay: 10 });
    const gone = card({ id: 'c', name: 'Archived', archived: true });
    const order = getActiveCardDues([later, soon, gone], [], NOW).map(d => d.account.name);
    expect(order).toEqual(['Soon', 'Later']);
  });

  it('handles a statement day late in the month without skipping a cycle', () => {
    const acc = card({ statementDay: 30 });
    const dues = getCardDues(acc, [tx({ date: '2026-08-05', amount: 300 })], NOW);
    expect(dues.unbilledCycle).toBe('2026-08');
    expect(dues.billedCycle).toBe(format(subMonths(setDate(NOW, 1), 1), 'yyyy-MM'));
    expect(dues.outstanding).toBe(300);
  });
});

// ── a statement that was allowed to roll ──────────────────────────────────────────────────────────
//
// NOW is 22 Aug 2026 and the card cuts on the 17th, so:
//   cycle 2026-07 ran 17 Jun – 16 Jul, printed 17 Jul, and fell due 5 Aug — seventeen days ago.
//   cycle 2026-08 ran 17 Jul – 16 Aug, printed 17 Aug, and falls due 5 Sep — the latest statement.
//
// Everything below is about what the app said between those two dates, which was: nothing.
describe('an unpaid statement, once the next one is cut', () => {
  const JUL = tx({ date: '2026-07-01', amount: 5000 });   // cycle 2026-07 — never paid
  const AUG = tx({ date: '2026-08-01', amount: 7240 });   // cycle 2026-08 — the current statement

  it('stays in outstanding instead of vanishing with the old statement', () => {
    const d = getCardDues(card(), [JUL, AUG], NOW);
    expect(d.billedCycle).toBe('2026-08');
    expect(d.billed).toBe(7240);          // the latest statement, unchanged
    expect(d.overdue).toBe(5000);         // …and July, which used to drop out here entirely
    expect(d.overdueCycles).toEqual(['2026-07']);
    expect(d.outstanding).toBe(12240);    // was 7240
  });

  it('drags utilisation up with it — the figure a rolled bill used to flatter', () => {
    expect(getCardDues(card({ creditLimit: 100000 }), [JUL, AUG], NOW).utilization).toBeCloseTo(0.1224);
  });

  it('names every cycle it is made of, oldest first', () => {
    const jun = tx({ date: '2026-06-02', amount: 900 });
    const d = getCardDues(card(), [jun, JUL, AUG], NOW);
    expect(d.overdueCycles).toEqual(['2026-06', '2026-07']);
    expect(d.overdue).toBe(5900);
  });

  it('drops a cycle that was settled, however late', () => {
    const paid = tx({ date: '2026-07-10', amount: 5000, type: 'credit', category: 'CC Payment' });
    const d = getCardDues(card(), [JUL, paid, AUG], NOW);
    expect(d.overdue).toBe(0);
    expect(d.overdueCycles).toEqual([]);
    expect(d.outstanding).toBe(7240);
  });

  it('counts a hand-entered statement on a cycle with no transactions under it', () => {
    // The one case where the user HAS recorded what the bank carried forward. A scan driven by the
    // ledger alone would ignore the only number they typed in themselves.
    const d = getCardDues(card({ statementAdjustments: { '2026-06': 1500 } }), [AUG], NOW);
    expect(d.overdueCycles).toEqual(['2026-06']);
    expect(d.overdue).toBe(1500);
  });

  it('ignores a cycle the ledger has nothing in and nobody adjusted', () => {
    expect(getCardDues(card(), [AUG], NOW).overdue).toBe(0);
  });

  it('ignores a rounding residue rather than crying arrears over one rupee', () => {
    // round() turns a ₹1,538.92 statement into ₹1,539, and ₹1,538 clears it. The residue is a
    // property of the rounding, not of the data: correcting the cycle with a statement adjustment
    // is the real fix, and this floor only covers the cycles nobody has corrected.
    const acc = card({ statementRounding: 'round' });
    const txs = [
      tx({ date: '2026-07-01', amount: 1538.92 }),
      tx({ date: '2026-07-08', amount: 1538, type: 'credit', category: 'CC Payment' }),
      AUG,
    ];
    const d = getCardDues(acc, txs, NOW);
    expect(getCardCycleFigures(acc, txs, '2026-07').due).toBe(1);
    expect(d.overdue).toBe(0);
    expect(isCycleOverdue(d, '2026-07', 1)).toBe(false);
  });

  it('totals across the wallet', () => {
    const a = card({ id: 'a' });
    const b = card({ id: 'b', name: 'Jupiter x CSB' });
    const txs = [
      tx({ accountId: 'a', date: '2026-07-01', amount: 5000 }),
      tx({ accountId: 'a', date: '2026-08-01', amount: 7240 }),
      tx({ accountId: 'b', date: '2026-07-03', amount: 2000 }),
    ];
    const totals = sumCardDues(getActiveCardDues([a, b], txs, NOW));
    expect(totals.overdue).toBe(7000);
    expect(totals.outstanding).toBe(14240);
  });
});

describe('a due date is allowed to be in the past', () => {
  const LATE = new Date(2026, 8, 8);                      // 8 Sep 2026 — three days past the 5th
  const AUG = tx({ date: '2026-08-01', amount: 7240 });   // the statement that fell due 5 Sep

  it('reports the miss instead of rolling the date forward a month', () => {
    const d = getCardDues(card(), [AUG], LATE);
    expect(d.billedCycle).toBe('2026-08');
    expect(d.dueDate).toBe('2026-09-05');
    expect(d.daysToDue).toBe(-3);   // the old line floored this at 0 and showed "In 27 days"
    expect(isCycleOverdue(d, '2026-08', 7240)).toBe(true);
    expect(cycleStatus(getCardCycleFigures(card(), [AUG], '2026-08'), true)).toBe('overdue');
  });

  it('rolls forward as it always did once the statement is settled', () => {
    // Recorded against the statement it settles, which is what the app writes when a payment is
    // logged after the cut — see the applied-cycle override on every CC payment in the ledger.
    const paid = tx({
      date: '2026-09-02', amount: 7240, type: 'credit', category: 'CC Payment',
      appliedBillingCycleYearMonth: '2026-08',
    });
    const d = getCardDues(card(), [AUG, paid], LATE);
    expect(d.billed).toBe(0);
    expect(d.dueDate).toBe('2026-10-05');
    expect(d.daysToDue).toBe(27);
  });

  it('sorts an overdue card ahead of one merely due soon', () => {
    const late = card({ id: 'a', name: 'Late' });
    const soon = card({ id: 'b', name: 'Soon', dueDay: 9 });
    const txs = [
      tx({ accountId: 'a', date: '2026-08-01', amount: 7240 }),   // due 5 Sep — three days ago
      tx({ accountId: 'b', date: '2026-08-01', amount: 100 }),    // due 9 Sep — tomorrow
    ];
    expect(getActiveCardDues([soon, late], txs, LATE).map(d => d.account.name)).toEqual(['Late', 'Soon']);
  });

  it('places the due date after the cut, not before it', () => {
    // Cut on the 17th, due on the 5th → the 5th of the FOLLOWING month.
    expect(format(getCycleDueDate('2026-08', 17, 5), 'yyyy-MM-dd')).toBe('2026-09-05');
    // Cut on the 1st, due on the 20th → the 20th of the SAME month.
    expect(format(getCycleDueDate('2026-08', 1, 20), 'yyyy-MM-dd')).toBe('2026-08-20');
  });
});

describe('the all-cycles reader cannot drift from the one-cycle reader', () => {
  it('agrees cycle for cycle', () => {
    const acc = card({ statementRounding: 'floor', statementAdjustments: { '2026-05': 700 } });
    const txs = [
      tx({ date: '2026-06-02', amount: 900.4 }),
      tx({ date: '2026-07-01', amount: 5000 }),
      tx({ date: '2026-07-10', amount: 1200.75, type: 'credit', category: 'CC Payment' }),
      tx({ date: '2026-07-11', amount: 300.25, type: 'credit', category: 'Cashback' }),
      tx({ date: '2026-07-12', amount: 400, category: 'CC Payment' }),           // a returned payment
      tx({ date: '2026-08-01', amount: 7240, isRewardTransaction: true }),       // not a rupee leg
      tx({ date: '2026-08-02', amount: 88 }),
    ];
    const byCycle = getCardCycleFiguresByCycle(acc, txs);
    expect([...byCycle.keys()].sort()).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
    for (const [cycle, f] of byCycle) {
      expect(f).toEqual(getCardCycleFigures(acc, txs, cycle));
    }
  });
});

// ── the Accounts tile's PREV DUE ──────────────────────────────────────────────────────────────────
//
// The last card surface to be doing its own arithmetic. It is now `charged − settlement` on the
// latest billed cycle — `due` with the clamp taken off, because the tile paints a negative figure
// green. What follows is the old inline version and the three ways the new one is meant to differ.

/** Accounts.tsx:884-896 as it stood before the extraction. */
const oldAccountsPrevDue = (acc: Account, txs: Transaction[], now: Date) => {
  const statementDay = acc.statementDay || 1;
  const currentCycle = getBillingCycleForDate(format(now, 'yyyy-MM-dd'), statementDay);
  const prevCycle = format(addMonths(parseISO(`${currentCycle}-01`), -1), 'yyyy-MM');
  const due = calculateCycleBalanceForCycle(acc, txs, prevCycle);
  const r: RoundingRule = acc.statementRounding || 'none';
  return r === 'round' ? Math.round(due) : r === 'floor' ? Math.floor(due) : r === 'ceil' ? Math.ceil(due) : due;
};

const prevDue = (acc: Account, txs: Transaction[], now: Date) => {
  const f = getCardCycleFigures(acc, txs, getLatestBilledCycle(acc.statementDay || 1, now));
  return f.charged - f.settlement;
};

describe("the Accounts tile's PREV DUE", () => {
  it('picks the same cycle the old inline version did', () => {
    const acc = card();
    const currentCycle = getBillingCycleForDate(format(NOW, 'yyyy-MM-dd'), acc.statementDay!);
    expect(getLatestBilledCycle(acc.statementDay!, NOW))
      .toBe(format(addMonths(parseISO(`${currentCycle}-01`), -1), 'yyyy-MM'));
  });

  it('agrees with it on an ordinary cycle', () => {
    const acc = card();
    const txs = [
      tx({ date: '2026-08-01', amount: 5000 }),
      tx({ date: '2026-08-05', amount: 2000, type: 'credit', category: 'CC Payment' }),
    ];
    expect(prevDue(acc, txs, NOW)).toBe(3000);
    expect(oldAccountsPrevDue(acc, txs, NOW)).toBe(3000);
  });

  it('honours a hand-entered statement figure, which the old one ignored outright', () => {
    const acc = card({ statementAdjustments: { '2026-08': 4800 } });
    const txs = [
      tx({ date: '2026-08-01', amount: 5000 }),
      tx({ date: '2026-08-05', amount: 2000, type: 'credit', category: 'CC Payment' }),
    ];
    expect(prevDue(acc, txs, NOW)).toBe(2800);          // the bank billed 4800; 2000 is paid
    expect(oldAccountsPrevDue(acc, txs, NOW)).toBe(3000); // …the tile said this
  });

  it('rounds the bill and then subtracts the payment, not the other way round', () => {
    const acc = card({ statementRounding: 'floor' });
    const txs = [
      tx({ date: '2026-08-01', amount: 1000.60 }),
      tx({ date: '2026-08-05', amount: 500.50, type: 'credit', category: 'CC Payment' }),
    ];
    // floor(1000.60) = 1000 billed, 500.50 paid against it.
    expect(prevDue(acc, txs, NOW)).toBeCloseTo(499.50);
    // floor(1000.60 − 500.50) — a figure nobody was ever charged.
    expect(oldAccountsPrevDue(acc, txs, NOW)).toBe(500);
  });

  it('stays negative on an overpaid cycle, so the tile still reads green', () => {
    const acc = card();
    const txs = [
      tx({ date: '2026-08-01', amount: 100 }),
      tx({ date: '2026-08-03', amount: 400, type: 'credit', category: 'CC Payment' }),
    ];
    expect(prevDue(acc, txs, NOW)).toBe(-300);
    // The clamped figure the rest of the app shows would have hidden the credit balance entirely.
    expect(getCardCycleFigures(acc, txs, '2026-08').due).toBe(0);
  });
});
