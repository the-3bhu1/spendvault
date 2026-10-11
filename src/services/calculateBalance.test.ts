import { describe, it, expect } from 'vitest';
import { calculateBalance, calculateCycleBalanceForCycle } from '../utils';
import type { Account, Transaction } from '../types';

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
