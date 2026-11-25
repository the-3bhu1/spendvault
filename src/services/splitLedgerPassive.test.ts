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

// A part-paid purchase linked WHOLE: ₹1,095 = ₹19 on the bank (the anchor) + ₹1,076 from a wallet
// (the leg). The carve is one figure spread anchor-first, exactly as the log form stores a passive
// amount on a split — so the purchase reopens there reading the same combined exclusion.
describe('linking a whole part-paid purchase', () => {
  const anchor = () => row({
    id: 'ord', description: 'Myntra Order', accountId: 'canara', amount: 19, category: 'Shopping',
    rewardSplits: [{ accountId: 'myntra', amount: 1076, legId: 'leg' }], linkedTransactionIds: ['leg'],
  });
  const leg = () => row({
    id: 'leg', description: 'Paid toward: Myntra Order', accountId: 'myntra', amount: 1076,
    category: 'Shopping', linkedTransactionIds: ['ord'],
  });
  const whole = (over: Partial<SplitItem> = {}) => item({
    transactionId: 'ord', amount: 1095, description: 'Myntra Order', wholePurchase: true,
    involvedPeople: ['V'], includeMe: false, ...over,
  });
  const counted = (txs: Transaction[]) => statsAmount(txOf(txs, 'ord')) + statsAmount(txOf(txs, 'leg'));

  it('carves across the anchor and its leg, anchor first', () => {
    // Bought entirely for a friend: none of the ₹1,095 is yours.
    const { transactions, items } = syncSplitLedgerPassive([anchor(), leg()], [], [whole()], true);
    expect(txOf(transactions, 'ord')).toMatchObject({ excludeFromStats: true, excludedAmount: 19 });
    expect(txOf(transactions, 'leg')).toMatchObject({ excludeFromStats: true, excludedAmount: 1076 });
    expect(counted(transactions)).toBe(0);
    expect(items[0].ledgerPassive).toEqual({ excludedAmount: 1095, prior: { excludeFromStats: false, excludedAmount: undefined } });
  });

  it('leaves your share counted, wherever the spread puts it', () => {
    // Half each: ₹547.50 is yours. The anchor gives up all ₹19, the leg the remaining ₹528.50.
    const { transactions } = syncSplitLedgerPassive([anchor(), leg()], [], [whole({ includeMe: true })], true);
    expect(txOf(transactions, 'ord').excludedAmount).toBe(19);
    expect(txOf(transactions, 'leg').excludedAmount).toBe(528.5);
    expect(counted(transactions)).toBe(547.5);
  });

  it('puts both rows back when the item is deleted', () => {
    const first = syncSplitLedgerPassive([anchor(), leg()], [], [whole()], true);
    const { transactions } = syncSplitLedgerPassive(first.transactions, first.items, [], true);
    expect(txOf(transactions, 'ord').excludeFromStats).toBe(false);
    expect(txOf(transactions, 'leg').excludeFromStats).toBe(false);
    expect(counted(transactions)).toBe(1095);
  });

  it('restores a passive amount the purchase already had, spread the same way', () => {
    // ₹30 was passive before the split touched it — all of it on the anchor's ₹19 and ₹11 on the leg.
    const before = [anchor(), leg()].map(t => (t.id === 'ord'
      ? { ...t, excludeFromStats: true, excludedAmount: 19 }
      : { ...t, excludeFromStats: true, excludedAmount: 11 }));
    const first = syncSplitLedgerPassive(before, [], [whole()], true);
    expect(first.items[0].ledgerPassive?.prior).toEqual({ excludeFromStats: true, excludedAmount: 30 });
    const { transactions } = syncSplitLedgerPassive(first.transactions, first.items, [], true);
    expect(txOf(transactions, 'ord').excludedAmount).toBe(19);
    expect(txOf(transactions, 'leg').excludedAmount).toBe(11);
  });

  it('re-carves when the same purchase is switched from whole to just its anchor', () => {
    const first = syncSplitLedgerPassive([anchor(), leg()], [], [whole()], true);
    const anchorOnly = { ...first.items[0], wholePurchase: undefined, amount: 19 };
    const { transactions, items } = syncSplitLedgerPassive(first.transactions, first.items, [anchorOnly], true);
    // The leg is put back; the anchor alone is now the bill, and none of it is yours.
    expect(txOf(transactions, 'leg').excludeFromStats).toBe(false);
    expect(txOf(transactions, 'ord')).toMatchObject({ excludeFromStats: true, excludedAmount: 19 });
    expect(items[0].ledgerPassive?.excludedAmount).toBe(19);
  });

  it('leaves the rows alone if they were edited by hand since', () => {
    const first = syncSplitLedgerPassive([anchor(), leg()], [], [whole()], true);
    const edited = first.transactions.map(t => (t.id === 'leg' ? { ...t, excludedAmount: 500 } : t));
    const { transactions } = syncSplitLedgerPassive(edited, first.items, [], true);
    expect(txOf(transactions, 'leg').excludedAmount).toBe(500);
    expect(txOf(transactions, 'ord').excludedAmount).toBe(19);
  });
});
