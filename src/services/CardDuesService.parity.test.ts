// Phase 0 parity check: the new service must reproduce the numbers the OLD Dashboard/Accounts
// derivation produced, and must differ from the OLD Bills derivation only in the two ways intended
// (the affectsRupeeBalance filter, and the calendar-day due comparison). Kept as a test rather than
// a throwaway script because these are the invariants the whole redesign leans on.
import { describe, it, expect } from 'vitest';
import { format, addMonths, parseISO, subMonths, setDate } from 'date-fns';
import { getCardDues, getCardCycleFigures, sumCardDues, getActiveCardDues } from './CardDuesService';
import { getAppliedBillingCycle, getBillingCycleForDate, getLatestBilledCycle, affectsRupeeBalance } from '../utils';
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
  const billedCycle = getLatestBilledCycle(statementDay);
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
    const billed = getLatestBilledCycle(acc.statementDay!);
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
    const cycle = getLatestBilledCycle(acc.statementDay!);
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
    const f = getCardCycleFigures(acc, txs, getLatestBilledCycle(17));
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
