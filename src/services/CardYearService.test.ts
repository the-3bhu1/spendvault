// The membership year is date arithmetic that nobody can check by looking at the screen: a window
// that is a day out, or that steps wrong across a leap year, produces a waiver bar that is quietly
// measuring the wrong twelve months. These pin the boundaries — the day before an anniversary, the
// day of it, 29 February, and a card whose open date has not been entered at all.
import { describe, it, expect } from 'vitest';
import { getCardYear, getCardSpendFigures, getCardFeeStanding } from './CardYearService';
import type { Account, Transaction } from '../types';

const card = (over: Partial<Account> = {}): Account => ({
  id: 'cc1', name: 'Swiggy x HDFC', type: 'credit_card',
  openingBalances: {}, statementDay: 17, dueDay: 5, creditLimit: 90000, ...over,
});

let n = 0;
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, date: '2026-08-10', description: 'x', accountId: 'cc1',
  type: 'debit', amount: 1000, category: 'Food', isRecurring: false, ...over,
});

describe('getCardYear — the membership window', () => {
  it('runs from the anniversary to the day before the next one', () => {
    const y = getCardYear(card({ cardOpenedOn: '2024-03-14' }), new Date(2026, 7, 30));
    expect(y.isAnniversary).toBe(true);
    expect(y.start).toBe('2026-03-14');
    // The day BEFORE the next anniversary. A window ending on the anniversary itself would count
    // one day into two membership years.
    expect(y.end).toBe('2027-03-13');
    expect(y.yearsHeld).toBe(2);
  });

  it('holds the old window on the day before the anniversary and turns over on the day itself', () => {
    const acc = card({ cardOpenedOn: '2024-03-14' });
    const before = getCardYear(acc, new Date(2026, 2, 13));
    expect(before.start).toBe('2025-03-14');
    expect(before.yearsHeld).toBe(1);
    expect(before.daysLeft).toBe(0);

    const on = getCardYear(acc, new Date(2026, 2, 14));
    expect(on.start).toBe('2026-03-14');
    expect(on.yearsHeld).toBe(2);
  });

  it('is in its first year until the first anniversary', () => {
    const y = getCardYear(card({ cardOpenedOn: '2026-06-20' }), new Date(2026, 7, 30));
    expect(y.yearsHeld).toBe(0);
    expect(y.start).toBe('2026-06-20');
  });

  it('clamps a 29 February anniversary to the 28th in a common year rather than drifting to 1 March', () => {
    const y = getCardYear(card({ cardOpenedOn: '2024-02-29' }), new Date(2026, 5, 1));
    expect(y.start).toBe('2026-02-28');
    expect(y.end).toBe('2027-02-27');
  });

  it('gives a card opened in the future its first year rather than a negative one', () => {
    const y = getCardYear(card({ cardOpenedOn: '2030-01-01' }), new Date(2026, 7, 30));
    expect(y.yearsHeld).toBe(0);
    expect(y.start).toBe('2030-01-01');
  });

  it('falls back to the financial year, and says so, when no open date is set', () => {
    const y = getCardYear(card(), new Date(2026, 7, 30));
    expect(y.isAnniversary).toBe(false);
    expect(y.start).toBe('2026-04-01');
    expect(y.end).toBe('2027-03-31');
    expect(y.yearsHeld).toBeUndefined();
  });

  it('puts January in the financial year that began the previous April', () => {
    const y = getCardYear(card(), new Date(2027, 0, 15));
    expect(y.start).toBe('2026-04-01');
    expect(y.end).toBe('2027-03-31');
  });
});

describe('getCardSpendFigures', () => {
  const acc = card({ cardOpenedOn: '2024-03-14' });
  const year = getCardYear(acc, new Date(2026, 7, 30)); // 2026-03-14 → 2027-03-13

  it('counts both window bounds inclusively', () => {
    const txs = [
      tx({ date: '2026-03-13', amount: 500 }),  // day before — out
      tx({ date: '2026-03-14', amount: 100 }),  // first day — in
      tx({ date: '2027-03-13', amount: 200 }),  // last day — in
      tx({ date: '2027-03-14', amount: 800 }),  // day after — out
    ];
    const f = getCardSpendFigures(acc, txs, year);
    expect(f.yearSpend).toBe(300);
    expect(f.yearCount).toBe(2);
    expect(f.lifetimeSpend).toBe(1600);
  });

  it('excludes settlements, credits, other accounts and non-rupee legs', () => {
    const txs = [
      tx({ date: '2026-08-01', amount: 1000 }),
      tx({ date: '2026-08-02', amount: 5000, category: 'CC Payment' }),
      tx({ date: '2026-08-03', amount: 4000, category: 'Transfer' }),
      tx({ date: '2026-08-04', amount: 300, type: 'credit' }),
      tx({ date: '2026-08-05', amount: 900, accountId: 'other' }),
      tx({ date: '2026-08-06', amount: 700, isRewardTransaction: true }),
      tx({ date: '2026-08-07', amount: 600, isTravelTransaction: true }),
    ];
    const f = getCardSpendFigures(acc, txs, year);
    expect(f.yearSpend).toBe(1000);
    expect(f.lifetimeSpend).toBe(1000);
  });
});

describe('getCardFeeStanding', () => {
  const anniversaryYear = (opened: string, now: Date) => getCardYear(card({ cardOpenedOn: opened }), now);

  it('reads a card with no fee block as lifetime free — that is the shape LTF saves as', () => {
    const s = getCardFeeStanding(card(), getCardYear(card()), 0);
    expect(s.lifetimeFree).toBe(true);
    expect(s.waiverSpend).toBeUndefined();
  });

  it('tracks progress toward a waiver and clears it once met', () => {
    const acc = card({ cardFees: { annualFee: 500, waiverSpend: 200000 } });
    const year = getCardYear(acc);

    const part = getCardFeeStanding(acc, year, 50000);
    expect(part.waiverProgress).toBeCloseTo(0.25);
    expect(part.waiverRemaining).toBe(150000);
    expect(part.waiverMet).toBe(false);

    const met = getCardFeeStanding(acc, year, 200000);
    expect(met.waiverMet).toBe(true);
    expect(met.waiverRemaining).toBe(0);
    // Clamped: a bar cannot be more than full.
    expect(getCardFeeStanding(acc, year, 900000).waiverProgress).toBe(1);
  });

  it('ignores a waiver on a card that charges no annual fee — there is nothing at the end of the bar', () => {
    const acc = card({ cardFees: { waiverSpend: 200000 } });
    const s = getCardFeeStanding(acc, getCardYear(acc), 10);
    expect(s.lifetimeFree).toBe(true);
    expect(s.waiverSpend).toBeUndefined();
  });

  it('is in its first free year only during the first membership year', () => {
    const fees = { annualFee: 1000, firstYearFree: true };
    const first = card({ cardOpenedOn: '2026-06-20', cardFees: fees });
    expect(getCardFeeStanding(first, anniversaryYear('2026-06-20', new Date(2026, 7, 30)), 0).inFirstFreeYear).toBe(true);

    const second = card({ cardOpenedOn: '2025-06-20', cardFees: fees });
    expect(getCardFeeStanding(second, anniversaryYear('2025-06-20', new Date(2026, 7, 30)), 0).inFirstFreeYear).toBe(false);
  });

  it('will not claim a first free year on the financial-year fallback, where "which year" has no answer', () => {
    const acc = card({ cardFees: { annualFee: 1000, firstYearFree: true } });
    expect(getCardFeeStanding(acc, getCardYear(acc), 0).inFirstFreeYear).toBe(false);
  });
});
