import { describe, it, expect } from 'vitest';
import { linkedTxGroupOf } from '../utils';
import type { Transaction } from '../types';

const row = (over: Partial<Transaction>): Transaction => ({
  id: 'x', date: '2026-10-29', description: '', accountId: 'canara',
  type: 'debit', amount: 50, category: 'Transfer', isRecurring: false, ...over,
});

const transfer = [
  row({ id: 'main', accountId: 'amazon', type: 'credit', description: 'Transfer from Canara',
    paymentSourceAccountId: 'canara', rewardEarned: 25, rewardEarnedType: 'instant', linkedTransactionIds: ['leg', 'cb'] }),
  row({ id: 'leg', description: 'Transfer to Amazon Pay Balance', linkedTransactionIds: ['main'] }),
  row({ id: 'cb', accountId: 'amazon', type: 'credit', amount: 25, category: 'Cashback', linkedTransactionIds: ['main'] }),
  row({ id: 'other', description: 'Lunch' }),
];

const ids = (txs: Transaction[]) => txs.map(t => t.id).sort();

describe('linkedTxGroupOf', () => {
  it('reaches the cashback from the leg that does not link to it', () => {
    expect(ids(linkedTxGroupOf(transfer[1], transfer))).toEqual(['cb', 'leg', 'main']);
  });

  it('is the same group from the parent', () => {
    expect(ids(linkedTxGroupOf(transfer[0], transfer))).toEqual(['cb', 'leg', 'main']);
  });

  it('does not join rows that only share a cashback-cycle id', () => {
    const deposits = [
      row({ id: 'd1', type: 'credit', category: 'Cashback', linkedTransactionIds: ['2026-09'] }),
      row({ id: 'd2', type: 'credit', category: 'Cashback', linkedTransactionIds: ['2026-09'] }),
    ];
    expect(ids(linkedTxGroupOf(deposits[0], deposits))).toEqual(['d1']);
  });
});
