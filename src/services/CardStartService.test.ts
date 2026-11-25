// A card added mid-life: IndusInd Tiger, opened 14 Jul 2026, added 24 Nov 2026. Statement on the
// 5th, due on the 25th. The 5 Nov bill of ₹8,000 is unpaid, ₹3,500 has been spent since, and ₹50,000
// has gone on the card this card year in all — towards a ₹1,00,000 annual-fee waiver.
//
// These follow each answer through the screens that read it: the dues (Cards, Bills, Accounts),
// the waiver bar and the year/lifetime spend, and Spends.
import { describe, it, expect } from 'vitest';
import { lastBillOf, planCardStart, isOpeningBalanceEntry } from './CardStartService';
import { getCardDues } from './CardDuesService';
import { getCardYear, getCardSpendFigures, getCardFeeStanding } from './CardYearService';
import { isCountableTransaction, isStatsExcludedCategory, calculateBalance } from '../utils';
import type { Account, Transaction } from '../types';

const NOW = new Date(2026, 10, 24); // 24 Nov 2026
const baseCard: Account = {
  id: 'tiger', name: 'IndusInd Tiger', type: 'credit_card', openingBalances: {},
  statementDay: 5, dueDay: 25, creditLimit: 200000, cardOpenedOn: '2026-07-14',
  cardFees: { annualFee: 1500, waiverSpend: 100000 },
};

const addCard = (input: Parameters<typeof planCardStart>[1]) => {
  const plan = planCardStart({ id: baseCard.id, statementDay: 5 }, input, NOW);
  const account: Account = {
    ...baseCard,
    openingBalances: { '2026-11': plan.openingBalance },
    statementAdjustments: plan.statementAdjustments,
    spendBeforeTracking: plan.spendBeforeTracking,
  };
  const transactions: Transaction[] = plan.openingEntry ? [plan.openingEntry] : [];
  return { plan, account, transactions };
};

describe('the last bill', () => {
  it('is the statement cut on 5 Nov', () => {
    const { cycle, cutOn } = lastBillOf(5, NOW);
    expect(cycle).toBe('2026-11');
    expect(cutOn.getDate()).toBe(5);
    expect(cutOn.getMonth()).toBe(10);
  });

  it('before this month\'s statement day, is last month\'s', () => {
    expect(lastBillOf(5, new Date(2026, 10, 3)).cycle).toBe('2026-10');
  });
});

describe('adding a card with a bill out and spends since', () => {
  const { plan, account, transactions } = addCard({ billed: 8000, unbilled: 3500, spentThisYear: 50000 });

  it('shows the ₹8,000 as billed, due 25 Nov, and the ₹3,500 as unbilled', () => {
    const dues = getCardDues(account, transactions, NOW);
    expect(dues.billed).toBe(8000);
    expect(dues.unbilled).toBe(3500);
    expect(dues.outstanding).toBe(11500);
    expect(dues.dueDate).toBe('2026-11-25');
    expect(dues.daysToDue).toBe(1);
  });

  it('agrees with the card balance Ask Vault reads', () => {
    expect(calculateBalance(account, transactions, '2026-11')).toBe(11500);
  });

  it('clears the bill with a CC Payment against the previous statement', () => {
    const paid: Transaction = {
      id: 'pay', date: '2026-11-24', description: 'Bill', accountId: 'tiger', type: 'credit',
      amount: 8000, category: 'CC Payment', isRecurring: false, appliedBillingCycleYearMonth: '2026-11',
    };
    const dues = getCardDues(account, [...transactions, paid], NOW);
    expect(dues.billed).toBe(0);
    expect(dues.unbilled).toBe(3500);
  });

  it('rolls the unbilled row into the next bill with everything logged after it', () => {
    const dinner: Transaction = { id: 'd', date: '2026-11-30', description: 'Dinner', accountId: 'tiger', type: 'debit', amount: 600, category: 'Food', isRecurring: false };
    const afterCut = getCardDues(account, [...transactions, dinner], new Date(2026, 11, 6)); // 6 Dec
    expect(afterCut.billed).toBe(4100);
  });

  it('keeps the unbilled row out of Spends', () => {
    const row = plan.openingEntry!;
    expect(isOpeningBalanceEntry(row)).toBe(true);
    expect(isStatsExcludedCategory(row.category)).toBe(true);
    expect(isCountableTransaction(row)).toBe(false);
  });

  it('starts the fee waiver at ₹50,000, not at the ₹3,500 the ledger holds', () => {
    const year = getCardYear(account, NOW);
    const spend = getCardSpendFigures(account, transactions, year);
    expect(spend.yearSpend).toBe(50000);
    expect(spend.carriedIn).toBe(50000);
    expect(spend.lifetimeSpend).toBe(50000);
    expect(getCardFeeStanding(account, year, spend.yearSpend).waiverRemaining).toBe(50000);
  });

  it('adds spends logged from today on, and ignores ones back-filled before it', () => {
    const year = getCardYear(account, NOW);
    const today: Transaction = { id: 'a', date: '2026-11-24', description: 'Lunch', accountId: 'tiger', type: 'debit', amount: 2000, category: 'Food', isRecurring: false };
    const backfilled: Transaction = { id: 'b', date: '2026-10-02', description: 'Old', accountId: 'tiger', type: 'debit', amount: 9000, category: 'Shopping', isRecurring: false };
    const spend = getCardSpendFigures(account, [...transactions, today, backfilled], year);
    expect(spend.yearSpend).toBe(52000);
  });

  it('drops the carried total once the card renews', () => {
    const nextYear = getCardYear(account, new Date(2027, 7, 1)); // Aug 2027: year from 14 Jul 2027
    const fresh: Transaction = { id: 'n', date: '2027-07-20', description: 'New year', accountId: 'tiger', type: 'debit', amount: 1200, category: 'Food', isRecurring: false };
    const spend = getCardSpendFigures(account, [...transactions, fresh], nextYear);
    expect(spend.yearSpend).toBe(1200);
    expect(spend.carriedIn).toBe(0);
  });
});

describe('adding a card that owes nothing', () => {
  it('writes no bill, no row and no carried spend', () => {
    const { plan, account, transactions } = addCard({ billed: 0, unbilled: 0 });
    expect(plan.statementAdjustments).toBeUndefined();
    expect(plan.openingEntry).toBeUndefined();
    expect(plan.spendBeforeTracking).toBeUndefined();
    expect(getCardDues(account, transactions, NOW).outstanding).toBe(0);
  });

  it('with the bill paid, shows only the unbilled', () => {
    const { account, transactions } = addCard({ billed: 0, unbilled: 3500 });
    const dues = getCardDues(account, transactions, NOW);
    expect(dues.billed).toBe(0);
    expect(dues.unbilled).toBe(3500);
  });
});

describe('adding a card without the spent-this-year total', () => {
  it('counts the unbilled row toward the waiver, since nothing else covers it', () => {
    const { account, transactions } = addCard({ billed: 8000, unbilled: 3500 });
    const spend = getCardSpendFigures(account, transactions, getCardYear(account, NOW));
    expect(spend.carriedIn).toBe(0);
    expect(spend.yearSpend).toBe(3500);
  });
});

describe('how much of the year the spend figure covers', () => {
  const tracked = (over: Partial<Account> = {}): Account => ({ ...baseCard, trackedFrom: '2026-11-24', ...over });
  const year = getCardYear(baseCard, NOW);
  const lunch: Transaction = { id: 'l', date: '2026-11-26', description: 'Lunch', accountId: 'tiger', type: 'debit', amount: 400, category: 'Food', isRecurring: false };

  it('counts from the day the card was added when no earlier total was given', () => {
    expect(getCardSpendFigures(tracked(), [lunch], year).countedFrom).toBe('2026-11-24');
  });

  it('covers the whole year once a spent-before-tracking total is set', () => {
    const card = tracked({ spendBeforeTracking: { amount: 50000, asOf: '2026-11-24' } });
    expect(getCardSpendFigures(card, [lunch], year).countedFrom).toBeUndefined();
  });

  it('reaches back to a back-filled spend', () => {
    const oct: Transaction = { ...lunch, id: 'o', date: '2026-10-02' };
    expect(getCardSpendFigures(tracked(), [lunch, oct], year).countedFrom).toBe('2026-10-02');
  });

  it('is the whole year for a card added before the year began, or with no add date', () => {
    expect(getCardSpendFigures(tracked({ trackedFrom: '2026-05-01' }), [lunch], year).countedFrom).toBeUndefined();
    expect(getCardSpendFigures(baseCard, [lunch], year).countedFrom).toBeUndefined();
  });

  it('is the whole year again after the card renews', () => {
    const next = getCardYear(baseCard, new Date(2027, 7, 1));
    expect(getCardSpendFigures(tracked(), [], next).countedFrom).toBeUndefined();
  });
});
