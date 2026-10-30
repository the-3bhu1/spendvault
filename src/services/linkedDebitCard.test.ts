import { describe, it, expect } from 'vitest';
import { calculateBalance, linkedBankOf, routeCardSpend, routeCardSpends, spendingAccountIdOf, cardMovableTransactions } from '../utils';
import { buildRewardRows } from './RewardsService';
import { minifyPayload, expandPayload } from './backupCodec';
import type { Account, Transaction } from '../types';

const bank: Account = { id: 'bank', name: 'HDFC Savings', type: 'bank_account', openingBalances: { '2026-10': 10000 } };
const card: Account = {
  id: 'card', name: 'HDFC Debit', type: 'debit_card', openingBalances: {}, linkedBankAccountId: 'bank',
  isCashbackEnabled: true, defaultCashbackRate: 1, isNcmcEnabled: true,
};
const standalone: Account = { id: 'prepaid', name: 'Niyo', type: 'debit_card', openingBalances: { '2026-10': 500 } };
const accounts = [bank, card, standalone];

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't1', date: '2026-10-05', description: 'Swiggy', accountId: 'card', type: 'debit',
  amount: 300, category: 'Food', isRecurring: false, ...over,
});

describe('linked debit cards', () => {
  it('resolves the bank only for a debit card that names one', () => {
    expect(linkedBankOf(card, accounts)?.id).toBe('bank');
    expect(linkedBankOf(standalone, accounts)).toBeUndefined();
    expect(linkedBankOf({ ...bank, linkedBankAccountId: 'bank' }, accounts)).toBeUndefined();
    expect(linkedBankOf({ ...card, linkedBankAccountId: 'gone' }, accounts)).toBeUndefined();
  });

  it('moves a spend on a linked card onto the bank and remembers the card', () => {
    const routed = routeCardSpend(tx({}), accounts);
    expect(routed.accountId).toBe('bank');
    expect(routed.paidViaCardId).toBe('card');
    expect(spendingAccountIdOf(routed)).toBe('card');
    expect(routeCardSpend(routed, accounts)).toBe(routed);
  });

  it('leaves travel-wallet and reward-points rows on the card', () => {
    expect(routeCardSpend(tx({ isTravelTransaction: true }), accounts).accountId).toBe('card');
    expect(routeCardSpend(tx({ isRewardTransaction: true }), accounts).accountId).toBe('card');
  });

  it('leaves a standalone card and plain bank rows alone', () => {
    const onPrepaid = tx({ accountId: 'prepaid' });
    expect(routeCardSpend(onPrepaid, accounts)).toBe(onPrepaid);
    const onBank = tx({ accountId: 'bank' });
    expect(routeCardSpend(onBank, accounts)).toBe(onBank);
  });

  it('takes the spend out of the bank balance, not the card', () => {
    const txs = routeCardSpends([tx({})], accounts);
    expect(calculateBalance(bank, txs, '2026-10')).toBe(9700);
    expect(calculateBalance(card, txs, '2026-10')).toBe(0);
  });

  it('returns the same array when nothing needs routing', () => {
    const txs = [tx({ accountId: 'bank' }), tx({ id: 't2', accountId: 'prepaid' })];
    expect(routeCardSpends(txs, accounts)).toBe(txs);
  });

  it('counts only the rupee rows still sitting on the card as movable', () => {
    const txs = [tx({}), tx({ id: 't2', isTravelTransaction: true }), tx({ id: 't3', accountId: 'bank' })];
    expect(cardMovableTransactions(card, txs).map(t => t.id)).toEqual(['t1']);
  });

  it('files the cashback a card spend earned under the card, not the bank', () => {
    const routed = routeCardSpend(tx({ rewardEarned: 3, rewardEarnedType: 'delayed' }), accounts);
    const rows = buildRewardRows([routed], accounts);
    expect(rows.t1.account.id).toBe('card');
  });

  it('survives a backup round trip', () => {
    const data = { accounts: [card], transactions: [routeCardSpend(tx({}), accounts)] };
    const restored = expandPayload(minifyPayload(data));
    expect(restored.accounts[0].linkedBankAccountId).toBe('bank');
    expect(restored.transactions[0].paidViaCardId).toBe('card');
  });
});
