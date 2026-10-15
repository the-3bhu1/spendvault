import { describe, it, expect } from 'vitest';
import { calculateBalance, calculateCycleBalanceForCycle, rewardUnitBalance, redemptionUnits, isPointsOverride, rewardPointsAdjustmentFor } from '../utils';
import type { Account, CashbackStatement, Transaction } from '../types';

describe('calculateBalance floating-point precision', () => {
  const tideAccount: Account = {
    id: 'tide-1',
    name: 'TIDE',
    type: 'debit_card',
    openingBalances: {
      '2026-05': 55.56,
    },
    cashbackRates: [],
  };

  it('eliminates floating-point residual noise near zero and returns clean 0 rather than scientific notation', () => {
    // Exactly matches the user's scenario where floating point math produces -2.842170943040401e-14
    const transactions: Transaction[] = [
      {
        id: 'tx-1',
        date: '2026-05-01',
        description: 'Transfer in',
        accountId: 'tide-1',
        type: 'credit',
        amount: 710,
        category: 'Transfer',
        isRecurring: false,
      },
      {
        id: 'tx-2',
        date: '2026-05-01',
        description: 'Blinkit',
        accountId: 'tide-1',
        type: 'debit',
        amount: 760,
        category: 'Shopping',
        isRecurring: false,
      },
      {
        id: 'tx-3',
        date: '2026-05-26',
        description: 'Transfer to Travel',
        accountId: 'tide-1',
        type: 'debit',
        amount: 105.56,
        category: 'Transfer',
        isRecurring: false,
      },
      {
        id: 'tx-4',
        date: '2026-05-04',
        description: 'Rewards',
        accountId: 'tide-1',
        type: 'credit',
        amount: 25,
        category: 'Cashback',
        isRecurring: false,
      },
      {
        id: 'tx-5',
        date: '2026-05-18',
        description: 'Rewards',
        accountId: 'tide-1',
        type: 'credit',
        amount: 10,
        category: 'Cashback',
        isRecurring: false,
      },
      {
        id: 'tx-6',
        date: '2026-05-20',
        description: 'Rewards',
        accountId: 'tide-1',
        type: 'credit',
        amount: 10,
        category: 'Cashback',
        isRecurring: false,
      },
      {
        id: 'tx-7',
        date: '2026-05-22',
        description: 'Rewards',
        accountId: 'tide-1',
        type: 'credit',
        amount: 10,
        category: 'Cashback',
        isRecurring: false,
      },
      {
        id: 'tx-8',
        date: '2026-05-12',
        description: 'Cashback',
        accountId: 'tide-1',
        type: 'credit',
        amount: 10,
        category: 'Cashback',
        isRecurring: false,
      },
      {
        id: 'tx-9',
        date: '2026-05-26',
        description: 'Cashback',
        accountId: 'tide-1',
        type: 'credit',
        amount: 35,
        category: 'Cashback',
        isRecurring: false,
      },
    ];

    const balance = calculateBalance(tideAccount, transactions, '2026-05');
    expect(balance).toBe(0);
    expect(Object.is(balance, -0)).toBe(false);
    expect(balance.toString()).toBe('0');
  });

  it('handles imprecise opening balances and rounds cleanly', () => {
    const noisyAcc: Account = {
      ...tideAccount,
      openingBalances: {
        '2026-05': 55.559999999999945,
      },
    };

    const transactions: Transaction[] = [
      {
        id: 'tx-1',
        date: '2026-05-01',
        description: 'Payment',
        accountId: 'tide-1',
        type: 'debit',
        amount: 55.56,
        category: 'Shopping',
        isRecurring: false,
      },
    ];

    const balance = calculateBalance(noisyAcc, transactions, '2026-05');
    expect(balance).toBe(0);
    expect(balance.toString()).toBe('0');
  });

  it('rounds calculateCycleBalanceForCycle cleanly to 2 decimal places', () => {
    const ccAccount: Account = {
      id: 'cc-1',
      name: 'Credit Card',
      type: 'credit_card',
      openingBalances: {},
      statementDay: 1,
    };

    const transactions: Transaction[] = [
      {
        id: 'tx-1',
        date: '2026-05-10',
        description: 'Charge 1',
        accountId: 'cc-1',
        type: 'debit',
        amount: 0.1,
        category: 'Food',
        isRecurring: false,
      },
      {
        id: 'tx-2',
        date: '2026-05-11',
        description: 'Charge 2',
        accountId: 'cc-1',
        type: 'debit',
        amount: 0.2,
        category: 'Food',
        isRecurring: false,
      },
    ];

    // For statementDay 1, May 10/11 falls in billing cycle 2026-06
    const cycleBalance = calculateCycleBalanceForCycle(ccAccount, transactions, '2026-06');
    expect(cycleBalance).toBe(0.3);
  });
});

describe('reward redemptions with an overridden point count', () => {
  // Cheq-style wallet: one rupee ledger, counted in Chips at 10 Chips = ₹1. Opens at ₹100 = 1000 Chips.
  const chips: Account = {
    id: 'cheq', name: 'Cheq', type: 'rewards', cashbackRates: [],
    rewardType: 'points', rewardUnit: 'Chips', pointsConversionRate: 10,
    openingBalances: { '2026-05': 100 },
  };
  // Jupiter-style card: a separate points ledger at 5 Jewels = ₹1, opening at 1000 Jewels.
  const jewels: Account = {
    id: 'jupiter', name: 'Jupiter', type: 'credit_card', cashbackRates: [],
    isCashbackEnabled: true, rewardType: 'points', rewardUnit: 'Jewels', pointsConversionRate: 5,
    openingBalances: {}, rewardOpeningBalances: { '2026-05': 1000 },
  };
  const leg = (accountId: string, amount: number, points: number | undefined, isRewardTransaction = false): Transaction => ({
    id: `leg-${accountId}-${amount}-${points}`, date: '2026-05-10', description: 'Paid toward: Dinner',
    accountId, type: 'debit', amount, points, category: 'Food', isRecurring: false, isRewardTransaction,
  });

  it('draws a unit-counted wallet down by the overridden points, not the leg\'s rupees', () => {
    // ₹50 paid with 450 Chips instead of the standard 500: the wallet is 450 Chips (₹45) lighter.
    expect(calculateBalance(chips, [leg('cheq', 50, 450)], '2026-05')).toBe(55);
    expect(rewardUnitBalance(chips, [leg('cheq', 50, 450)], '2026-05')).toBe(550);
  });

  it('leaves a wallet redemption at the standard rate exactly as the rupees say', () => {
    expect(calculateBalance(chips, [leg('cheq', 50, 500)], '2026-05')).toBe(50);
    // Legacy leg with no saved points.
    expect(calculateBalance(chips, [leg('cheq', 50, undefined)], '2026-05')).toBe(50);
  });

  it('takes a card\'s saved point count off its points ledger, and the rate when none is saved', () => {
    expect(calculateBalance(jewels, [leg('jupiter', 86, 400, true)], '2026-05', false, true)).toBe(600);
    expect(calculateBalance(jewels, [leg('jupiter', 86, undefined, true)], '2026-05', false, true)).toBe(570);
  });

  it('redemptionUnits reports the same figure each balance removes', () => {
    expect(redemptionUnits(chips, 50, 450)).toBe(450);
    expect(redemptionUnits(chips, 50, 500)).toBe(500);
    expect(redemptionUnits(chips, 50, undefined)).toBe(500);
    expect(redemptionUnits(jewels, 86, 400)).toBe(400);
    expect(redemptionUnits(jewels, 86, undefined)).toBe(430);
    const cred: Account = { id: 'cred', name: 'CRED', type: 'rewards', cashbackRates: [], rewardType: 'rupee', openingBalances: {} };
    expect(redemptionUnits(cred, 50, undefined)).toBe(50);
    expect(isPointsOverride(50, 500, chips)).toBe(false);
    expect(isPointsOverride(50, 450, chips)).toBe(true);
  });
});

describe('rewardPointsAdjustmentFor (the Accounts editor\'s points balance)', () => {
  // 5 Jewels = ₹1, opening 1000 Jewels in May. In May: an 86-rupee redemption (430 Jewels, no saved
  // count), and 100 Jewels of cashback confirmed — which leaves BOTH a statement (counted by the
  // balance) and a ₹20 "Cashback" credit row flagged as a reward (not counted by it).
  const card: Account = {
    id: 'jupiter', name: 'Jupiter', type: 'credit_card', cashbackRates: [],
    isCashbackEnabled: true, rewardType: 'points', rewardUnit: 'Jewels', pointsConversionRate: 5,
    openingBalances: {}, rewardOpeningBalances: { '2026-05': 1000 },
  };
  const txs: Transaction[] = [
    { id: 'r1', date: '2026-05-10', description: 'Paid toward: Dinner', accountId: 'jupiter', type: 'debit',
      amount: 86, category: 'Food', isRecurring: false, isRewardTransaction: true },
    { id: 'c1', date: '2026-05-20', description: 'Consolidated Cashback', accountId: 'jupiter', type: 'credit',
      amount: 20, category: 'Cashback', isRecurring: false, isRewardTransaction: true },
  ];
  const statements: CashbackStatement[] = [
    { id: 's1', accountId: 'jupiter', billingCycleYearMonth: '2026-05', expected: 100, realized: 100, confirmed: true },
  ];
  const pointsBalance = (acc: Account) => calculateBalance(acc, txs, '2026-05', false, true, statements);
  const saveWith = (acc: Account, entered: number): Account => ({
    ...acc,
    rewardBalanceAdjustments: {
      ...(acc.rewardBalanceAdjustments || {}),
      '2026-05': rewardPointsAdjustmentFor(acc, txs, '2026-05', 1000, entered, statements),
    },
  });

  it('re-saving the card with the pre-filled balance leaves it unchanged', () => {
    expect(pointsBalance(card)).toBe(670); // 1000 − 430 + 100
    const once = saveWith(card, pointsBalance(card));
    expect(pointsBalance(once)).toBe(670);
    expect(pointsBalance(saveWith(once, pointsBalance(once)))).toBe(670);
  });

  it('a typed correction is exactly what the balance then reads, replacing the month\'s old adjustment', () => {
    const corrected = saveWith(card, 700);
    expect(corrected.rewardBalanceAdjustments?.['2026-05']).toBe(30);
    expect(pointsBalance(corrected)).toBe(700);
    const again = saveWith(corrected, 650);
    expect(again.rewardBalanceAdjustments?.['2026-05']).toBe(-20);
    expect(pointsBalance(again)).toBe(650);
  });

  it('holds when the conversion rate changes in the same edit', () => {
    const rerated = { ...card, pointsConversionRate: 10 }; // the 86-rupee leg now reads as 860 Jewels
    expect(pointsBalance(saveWith(rerated, 500))).toBe(500);
  });
});
