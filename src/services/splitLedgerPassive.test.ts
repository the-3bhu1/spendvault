import { describe, it, expect } from 'vitest';
import { syncSplitLedgerPassive, statsAmount } from '../utils';
import { minifyPayload, expandPayload } from './backupCodec';
import type { SplitItem, Transaction } from '../types';

const row = (over: Partial<Transaction> = {}): Transaction => ({
  id: 'tx1', date: '2026-10-12', description: 'Wonderla Locker', accountId: 'acc', type: 'debit',
  amount: 812, category: 'Entertainment', ...over,
} as Transaction);

const item = (over: Partial<SplitItem> = {}): SplitItem => ({
  id: 'it1', transactionId: 'tx1', amount: 812, description: 'Wonderla Locker',
  involvedPeople: ['A', 'B', 'C'], includeMe: true, splitType: 'equal', paidBy: 'me', ...over,
});

const txOf = (txs: Transaction[], id = 'tx1') => txs.find(t => t.id === id)!;

describe('linking a ledger row to a split with Passive Logs on', () => {
  it('carves out everything but your share, so Spends counts only your part', () => {
    // ₹812 four ways is ₹203 each: ₹609 belongs to the friends.
    const { transactions, items } = syncSplitLedgerPassive([row()], [], [item()], true);
    const tx = txOf(transactions);
    expect(tx.excludeFromStats).toBe(true);
    expect(tx.excludedAmount).toBe(609);
    expect(statsAmount(tx)).toBe(203);
    expect(items[0].ledgerPassive).toEqual({ excludedAmount: 609, prior: { excludeFromStats: undefined, excludedAmount: undefined } });
  });

  it('uses your custom share on an unequal split', () => {
    const { transactions } = syncSplitLedgerPassive([row()], [], [item({ splitType: 'unequal', shares: { me: 300, A: 512 } })], true);
    expect(statsAmount(txOf(transactions))).toBe(300);
  });

  it('carves the whole row when you are not part of the split', () => {
    const { transactions } = syncSplitLedgerPassive([row()], [], [item({ includeMe: false })], true);
    expect(statsAmount(txOf(transactions))).toBe(0);
  });

  it('does nothing with Passive Logs off', () => {
    const txs = [row()];
    const out = syncSplitLedgerPassive(txs, [], [item()], false);
    expect(out.transactions).toBe(txs);
    expect(out.items[0].ledgerPassive).toBeUndefined();
  });

  it('leaves custom expenses and system categories alone', () => {
    const txs = [row({ category: 'Transfer' })];
    expect(syncSplitLedgerPassive(txs, [], [item(), item({ id: 'it2', transactionId: 'custom' })], true).transactions).toBe(txs);
  });

  it('keeps a hand-set Passive Log when your share covers the whole row', () => {
    const txs = [row({ excludeFromStats: true, excludedAmount: 100 })];
    const out = syncSplitLedgerPassive(txs, [], [item({ splitType: 'unequal', shares: { me: 812 } })], true);
    expect(out.transactions).toBe(txs);
    expect(out.items[0].ledgerPassive).toBeUndefined();
  });
});

describe('editing and deleting a carved split item', () => {
  const linked = () => syncSplitLedgerPassive([row({ excludeFromStats: true, excludedAmount: 50 })], [], [item()], true);

  it('re-carves when your share changes', () => {
    const first = linked();
    const edited = { ...first.items[0], involvedPeople: ['A'] }; // two ways now: ₹406 each
    const { transactions, items } = syncSplitLedgerPassive(first.transactions, first.items, [edited], true);
    expect(txOf(transactions).excludedAmount).toBe(406);
    // The prior state is still the one from before the split ever touched the row.
    expect(items[0].ledgerPassive?.prior).toEqual({ excludeFromStats: true, excludedAmount: 50 });
  });

  it('puts the row back the way it was when the item is deleted', () => {
    const first = linked();
    const { transactions } = syncSplitLedgerPassive(first.transactions, first.items, [], true);
    expect(txOf(transactions)).toMatchObject({ excludeFromStats: true, excludedAmount: 50 });
  });

  it('puts the old row back and carves the new one when relinked', () => {
    const first = syncSplitLedgerPassive([row(), row({ id: 'tx2' })], [], [item()], true);
    const { transactions } = syncSplitLedgerPassive(first.transactions, first.items, [{ ...first.items[0], transactionId: 'tx2' }], true);
    expect(statsAmount(txOf(transactions, 'tx1'))).toBe(812);
    expect(statsAmount(txOf(transactions, 'tx2'))).toBe(203);
  });

  it('leaves a row edited in the ledger since alone on delete', () => {
    const first = linked();
    const handEdited = first.transactions.map(t => ({ ...t, excludedAmount: 700 }));
    const { transactions } = syncSplitLedgerPassive(handEdited, first.items, [], true);
    expect(txOf(transactions).excludedAmount).toBe(700);
  });

  it('does not rewrite the row when an unrelated edit leaves your share as it was', () => {
    const first = linked();
    const handEdited = first.transactions.map(t => ({ ...t, excludedAmount: 700 }));
    const renamed = { ...first.items[0], paidBy: 'A' };
    const { transactions, items } = syncSplitLedgerPassive(handEdited, first.items, [renamed], true);
    expect(transactions).toBe(handEdited);
    expect(items[0].ledgerPassive).toEqual(first.items[0].ledgerPassive);
  });

  it('carves an older item once it is saved again with Passive Logs on', () => {
    const old = item();
    const { transactions } = syncSplitLedgerPassive([row()], [old], [{ ...old }], true);
    expect(statsAmount(txOf(transactions))).toBe(203);
  });

  it('survives a compressed backup round trip', () => {
    const { items } = linked();
    expect(expandPayload(minifyPayload(items))).toEqual(items);
  });
});
