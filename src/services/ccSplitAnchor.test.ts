import { describe, it, expect } from 'vitest';
import { anchorCcSplitOnCard, anchorCcSplitsOnCards, getRewardSplits } from '../utils';
import type { Transaction } from '../types';

const row = (over: Partial<Transaction>): Transaction => ({
  id: 'x', date: '2026-10-22', description: 'CC Payment: Supermoney x AXIS', accountId: 'canara',
  type: 'debit', amount: 0, category: 'CC Payment', isRecurring: false, ...over,
});

const bankAnchored = (cardType: Transaction['type'], cardAmount: number, bankAmount: number): Transaction[] => [
  row({ id: 'card', accountId: 'supermoney', type: cardType, amount: cardAmount, linkedTransactionIds: ['bank'] }),
  row({
    id: 'bank', amount: bankAmount, paymentSourceAccountId: 'supermoney',
    rewardUsed: 91, rewardUsedAccountId: 'cred', rewardSplits: [{ accountId: 'cred', amount: 91, legId: 'leg' }],
    rewardEarned: 10, rewardEarnedType: 'instant', rewardEarnedAccountId: 'cred',
    linkedTransactionIds: ['card', 'leg', 'cb'],
  }),
  row({ id: 'leg', accountId: 'cred', amount: 91, description: 'Paid toward: Supermoney x AXIS', linkedTransactionIds: ['bank'] }),
  row({ id: 'cb', accountId: 'cred', type: 'credit', amount: 10, category: 'Cashback', linkedTransactionIds: ['bank'] }),
];

const byId = (txs: Transaction[]) => Object.fromEntries(txs.map(t => [t.id, t]));

describe('a card payment split anchors on the card', () => {
  it('moves a split saved on the bank row onto the card row', () => {
    const t = byId(anchorCcSplitOnCard(bankAnchored('credit', 904, 995), 'bank'));
    expect(t.card).toMatchObject({ type: 'credit', amount: 1086, linkedTransactionIds: ['bank', 'leg'] });
    expect(getRewardSplits(t.card)).toEqual([{ accountId: 'cred', amount: 91, legId: 'leg' }]);
    expect(t.bank.amount).toBe(995);
    expect(getRewardSplits(t.bank)).toEqual([]);
    expect(t.bank.linkedTransactionIds).toEqual(['card', 'cb']);
    expect(t.bank.rewardEarned).toBe(10);
    expect(t.leg.linkedTransactionIds).toEqual(['card']);
    expect(t.cb.linkedTransactionIds).toEqual(['bank']);
  });

  it('turns a card row that became a debit back into the credit that pays the bill', () => {
    const t = byId(anchorCcSplitsOnCards(bankAnchored('debit', 995, 1086)));
    expect(t.card).toMatchObject({ type: 'credit', amount: 1177, description: 'CC Bill Payment' });
    expect(t.bank).toMatchObject({ type: 'debit', amount: 1086 });
  });

  it('leaves a payment already anchored on the card alone', () => {
    const txs = [
      row({ id: 'card', accountId: 'supermoney', type: 'credit', amount: 1086, paymentSourceAccountId: 'canara',
        rewardUsed: 91, rewardUsedAccountId: 'cred', rewardSplits: [{ accountId: 'cred', amount: 91, legId: 'leg' }],
        linkedTransactionIds: ['bank', 'leg'] }),
      row({ id: 'bank', amount: 995, linkedTransactionIds: ['card'] }),
      row({ id: 'leg', accountId: 'cred', amount: 91, linkedTransactionIds: ['card'] }),
    ];
    expect(anchorCcSplitsOnCards(txs)).toBe(txs);
  });

  it('leaves a payment with no split alone', () => {
    const txs = [
      row({ id: 'bank', amount: 500, paymentSourceAccountId: 'supermoney', linkedTransactionIds: ['card'] }),
      row({ id: 'card', accountId: 'supermoney', type: 'credit', amount: 500, linkedTransactionIds: ['bank'] }),
    ];
    expect(anchorCcSplitOnCard(txs, 'bank')).toBe(txs);
  });
});
