// Selling an investment. A sell is a buy in reverse — the holding is debited, the bank credited — and
// the one decision that matters is WHAT the holding is debited by: the cost of the units sold, not
// the proceeds. getInvestmentAccountStats derives the average price as invested / units, so a debit
// carrying proceeds would drag the average of what remains below what was actually paid for it.
import { describe, it, expect } from 'vitest';
import {
  getInvestmentAccountStats, holdingPositionOn, sellCostBasis, investmentLegAmount,
  investmentHoldingSideType, realizedPnlOf, sellProceedsOf,
} from '../utils';
import type { Account, Transaction } from '../types';

const holding: Account = {
  id: 'sag', name: 'Sagility', type: 'stocks', openingBalances: {},
  numberOfShares: 30, investedValue: 1581,
} as Account;

const leg = (over: Partial<Transaction>): Transaction => ({
  id: 'x', date: '2026-06-14', description: 'Sagility', accountId: 'sag',
  type: 'credit', amount: 0, category: 'Investments', isRecurring: false,
  investmentKind: 'stocks', ...over,
});

// 30 opening at ₹1,581 plus 25 bought for ₹1,017.50 = 55 shares, ₹2,598.50, avg ₹47.245…
const buy = leg({ id: 'buy', amount: 1017.5, numberOfShares: 25, allottedAmount: 1017.5, investmentCharges: 7.17 });

describe('holdingPositionOn', () => {
  it('counts the opening figures and every leg up to the date', () => {
    const p = holdingPositionOn(holding, [buy], '2026-06-14');
    expect(p.units).toBe(55);
    expect(p.invested).toBeCloseTo(2598.5, 2);
  });

  it('ignores legs dated after the sale and the pair being edited', () => {
    const later = leg({ id: 'later', date: '2026-07-01', amount: 500, numberOfShares: 10 });
    expect(holdingPositionOn(holding, [buy, later], '2026-06-30').units).toBe(55);
    expect(holdingPositionOn(holding, [buy], '2026-06-30', ['buy']).units).toBe(30);
  });
});

describe('sellCostBasis', () => {
  const position = holdingPositionOn(holding, [buy], '2026-06-30');

  it('is units × average cost on a partial sale', () => {
    expect(sellCostBasis(position, 20)).toBeCloseTo(2598.5 / 55 * 20, 2);
  });

  it('is the whole invested figure on a full exit, so nothing is left over', () => {
    expect(sellCostBasis(position, 55)).toBe(2598.5);
  });

  it('is zero for nothing sold or nothing held', () => {
    expect(sellCostBasis(position, 0)).toBe(0);
    expect(sellCostBasis({ units: 0, invested: 0, avgPrice: 0 }, 5)).toBe(0);
  });
});

describe('a sell keeps the average price of what remains', () => {
  it('debits the holding by cost basis and leaves avg unchanged after a profitable partial sale', () => {
    const before = getInvestmentAccountStats(holding, [buy]);
    const costBasis = sellCostBasis(holdingPositionOn(holding, [buy], '2026-07-10'), 20);
    // Sold 20 at ₹60 (₹1,200 gross), ₹15 charges, ₹1,185 landed in the bank.
    const pair = { investmentAction: 'sell' as const, amount: 1185, allottedAmount: 1200, investmentCharges: 15, costBasis };
    const sell = leg({
      id: 'sell', date: '2026-07-10', type: investmentHoldingSideType('sell'),
      numberOfShares: 20, ...pair, amount: investmentLegAmount(true, pair, true),
    });
    const after = getInvestmentAccountStats(holding, [buy, sell]);
    expect(after.totalUnits).toBe(35);
    expect(after.avgPrice).toBeCloseTo(before.avgPrice, 2);
    expect(after.realizedPnl).toBeCloseTo(1185 - costBasis, 2);
  });
});

describe('investmentLegAmount', () => {
  it('buy: holding gets the invested amount, cash pays it plus charges', () => {
    const tx = { amount: 1024.67, allottedAmount: 1017.5, investmentCharges: 7.17 };
    expect(investmentLegAmount(true, tx, true)).toBe(1017.5);
    expect(investmentLegAmount(false, tx, true)).toBe(1024.67);
  });

  it('commodity buy: one gross figure on both legs', () => {
    expect(investmentLegAmount(true, { amount: 1610.37 }, false)).toBe(1610.37);
    expect(investmentLegAmount(false, { amount: 1610.37 }, false)).toBe(1610.37);
  });

  it('sell: holding gives up cost basis, cash receives net proceeds', () => {
    const tx = { investmentAction: 'sell' as const, amount: 1185, allottedAmount: 1200, investmentCharges: 15, costBasis: 944.91 };
    expect(investmentLegAmount(true, tx, true)).toBe(944.91);
    expect(investmentLegAmount(false, tx, true)).toBe(1185);
  });
});

describe('realizedPnlOf', () => {
  it('is proceeds less cost basis on a sell, and undefined on anything else', () => {
    const sell = leg({ investmentAction: 'sell', allottedAmount: 1200, investmentCharges: 15, costBasis: 944.91 });
    expect(sellProceedsOf(sell)).toBe(1185);
    expect(realizedPnlOf(sell)).toBe(240.09);
    expect(realizedPnlOf(buy)).toBeUndefined();
  });

  it('can be a loss', () => {
    const sell = leg({ investmentAction: 'sell', allottedAmount: 800, investmentCharges: 0, costBasis: 944.91 });
    expect(realizedPnlOf(sell)).toBe(-144.91);
  });
});
