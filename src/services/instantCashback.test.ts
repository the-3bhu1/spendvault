import { describe, it, expect } from 'vitest';
import {
  applyInstantCashbacks, getInstantCashbacks, instantCashbackLegsOf, instantCashbacksOf, linkedTxGroupOf, withInstantCashbacks,
} from '../utils';
import { minifyPayload, expandPayload } from './backupCodec';
import type { Transaction } from '../types';

const row = (over: Partial<Transaction>): Transaction => ({
  id: 'x', date: '2026-10-27', description: '', accountId: 'canara',
  type: 'debit', amount: 30816.56, category: 'CC Payment', isRecurring: false, ...over,
});

const creditSidePair = (): Transaction[] => [
  row({ id: 'bank', description: 'CC Payment: Jupiter x CSB', linkedTransactionIds: ['card'], order: 0 }),
  row({ id: 'card', accountId: 'jupiter', type: 'credit', description: 'CC Bill Payment',
    paymentSourceAccountId: 'canara', linkedTransactionIds: ['bank'], order: 1 }),
];

const byId = (txs: Transaction[]) => Object.fromEntries(txs.map(t => [t.id, t]));
const cashbackRows = (txs: Transaction[]) => txs.filter(t => t.category === 'Cashback');

describe('instant cashback lives on the paying row', () => {
  it('creates the cashback on the debit row of a payment logged from the card side', () => {
    const t = byId(applyInstantCashbacks(creditSidePair(), 'bank', [{ accountId: 'cheq', amount: 30.8 }], ['cb']));
    expect(t.bank).toMatchObject({ rewardEarned: 30.8, rewardEarnedType: 'instant', rewardEarnedAccountId: 'cheq',
      linkedTransactionIds: ['card', 'cb'], instantCashbacks: [{ accountId: 'cheq', amount: 30.8, legId: 'cb' }] });
    expect(t.cb).toMatchObject({ type: 'credit', category: 'Cashback', amount: 30.8, accountId: 'cheq',
      date: '2026-10-27', description: 'Instant Cashback: CC Payment: Jupiter x CSB', linkedTransactionIds: ['bank'] });
    expect(t.card.rewardEarned).toBeUndefined();
  });

  it('puts the cashback in the same group as both sides of the payment', () => {
    const txs = applyInstantCashbacks(creditSidePair(), 'bank', [{ accountId: 'cheq', amount: 30.8 }], ['cb']);
    const card = txs.find(t => t.id === 'card') as Transaction;
    expect(linkedTxGroupOf(card, txs).map(t => t.id).sort()).toEqual(['bank', 'card', 'cb']);
  });

  it('removes the cashback and clears the paying row when it is taken off', () => {
    const withCb = applyInstantCashbacks(creditSidePair(), 'bank', [{ accountId: 'cheq', amount: 30.8 }], ['cb']);
    const cleared = applyInstantCashbacks(withCb, 'bank', [], []);
    expect(cashbackRows(cleared)).toHaveLength(0);
    expect(byId(cleared).bank).toMatchObject({ rewardEarned: 0, rewardEarnedType: 'none', linkedTransactionIds: ['card'] });
    expect(byId(cleared).bank.instantCashbacks).toBeUndefined();
  });

  it('leaves a payment with no cashback untouched when there is nothing to remove', () => {
    const txs = creditSidePair();
    expect(applyInstantCashbacks(txs, 'bank', [], [])).toBe(txs);
  });

  it('leaves card cashback alone when there is no instant cashback to remove', () => {
    const txs = [row({ id: 'spend', accountId: 'hdfc', rewardEarned: 12, rewardEarnedType: 'delayed' })];
    expect(applyInstantCashbacks(txs, 'spend', [], [])).toBe(txs);
  });
});

describe('several cashbacks on one payment', () => {
  const two = () => applyInstantCashbacks(creditSidePair(), 'bank', [
    { accountId: 'cheq', amount: 30.8 },
    { accountId: 'cred', amount: 10 },
  ], ['cb1', 'cb2']);

  it('posts one cashback row per wallet and keeps the total on the paying row', () => {
    const txs = two();
    expect(cashbackRows(txs).map(t => [t.id, t.accountId, t.amount])).toEqual([['cb1', 'cheq', 30.8], ['cb2', 'cred', 10]]);
    expect(byId(txs).bank).toMatchObject({ rewardEarned: 40.8, rewardEarnedAccountId: 'cheq', linkedTransactionIds: ['card', 'cb1', 'cb2'] });
    expect(instantCashbackLegsOf(byId(txs).bank, txs).map(t => t.id)).toEqual(['cb1', 'cb2']);
  });

  it('changes one wallet without touching the other or adding rows', () => {
    const txs = two();
    const edited = applyInstantCashbacks(txs, 'bank', [
      { accountId: 'cheq', amount: 30.8, legId: 'cb1' },
      { accountId: 'cred', amount: 12, legId: 'cb2' },
    ], ['unused1', 'unused2']);
    expect(cashbackRows(edited).map(t => [t.id, t.amount])).toEqual([['cb1', 30.8], ['cb2', 12]]);
    expect(byId(edited).bank.rewardEarned).toBe(42.8);
  });

  it('drops only the wallet that was removed', () => {
    const edited = applyInstantCashbacks(two(), 'bank', [{ accountId: 'cred', amount: 10, legId: 'cb2' }], ['unused']);
    expect(cashbackRows(edited).map(t => t.id)).toEqual(['cb2']);
    expect(byId(edited).bank).toMatchObject({ rewardEarned: 10, rewardEarnedAccountId: 'cred', linkedTransactionIds: ['card', 'cb2'] });
  });

  it('adds a second wallet to a payment saved with a single cashback before lists existed', () => {
    const legacy: Transaction[] = [
      row({ id: 'bank', description: 'Lunch', rewardEarned: 5, rewardEarnedType: 'instant', rewardEarnedAccountId: 'cred',
        linkedTransactionIds: ['old'] }),
      row({ id: 'old', accountId: 'cred', type: 'credit', amount: 5, category: 'Cashback', linkedTransactionIds: ['bank'] }),
    ];
    const seeded = instantCashbacksOf(legacy[0], legacy);
    expect(seeded).toEqual([{ accountId: 'cred', amount: 5, legId: 'old' }]);
    const next = applyInstantCashbacks(legacy, 'bank', [...seeded, { accountId: 'cheq', amount: 3 }], ['new']);
    expect(cashbackRows(next).map(t => [t.id, t.accountId, t.amount])).toEqual([['old', 'cred', 5], ['new', 'cheq', 3]]);
    expect(byId(next).bank.rewardEarned).toBe(8);
  });

  it('reads a legacy single cashback as a one-item list', () => {
    expect(getInstantCashbacks({ rewardEarned: 5, rewardEarnedType: 'instant', rewardEarnedAccountId: 'cred' }))
      .toEqual([{ accountId: 'cred', amount: 5 }]);
    expect(getInstantCashbacks({ rewardEarned: 12, rewardEarnedType: 'delayed' })).toEqual([]);
  });

  it('survives a backup round trip', () => {
    const bank = withInstantCashbacks(row({ id: 'bank' }), [
      { accountId: 'cheq', amount: 30.8, legId: 'cb1' },
      { accountId: 'cred', amount: 10, legId: 'cb2' },
    ]);
    const payload = { transactions: [bank] };
    expect(expandPayload(minifyPayload(payload))).toEqual(payload);
  });
});
