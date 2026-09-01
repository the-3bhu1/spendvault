// The reward leg's behaviour when a split's SOURCE changes on an edit — the decision table in
// RewardLegService, exercised transition by transition.
//
// Every case below was broken before that module existed, and broken in a way nothing reported: the
// leg was found by "which linked leg sits on the account the anchor points at?", so switching the
// picker made it unrecognisable and it fell through to the transfer-counterpart branch, which
// rewrote its amount to the anchor's own. The assertions here are mostly about a ₹86 redemption
// staying ₹86.
import { describe, it, expect } from 'vitest';
import { resolveRewardLegTransition, shouldCreateRewardLeg, isDebitableRewardSource } from './RewardLegService';
import { EXTERNAL_REWARD_SOURCE_ID } from '../utils';
import type { Account, Transaction } from '../types';

// A card whose own points wallet funds redemptions (Jewels at 5 to ₹1).
const pointsCard = (over: Partial<Account> = {}): Account => ({
  id: 'card1', name: 'Jupiter x CSB', type: 'credit_card', openingBalances: {},
  isCashbackEnabled: true, rewardType: 'points', rewardUnit: 'Jewels', pointsConversionRate: 5, ...over,
});
// A rupee-denominated rewards wallet (CRED coins, super.money): already money, no conversion.
const rupeeWallet = (over: Partial<Account> = {}): Account => ({
  id: 'cred', name: 'CRED rewards', type: 'rewards', openingBalances: {}, ...over,
});
const bank = (over: Partial<Account> = {}): Account => ({
  id: 'bank1', name: 'Canara', type: 'bank_account', openingBalances: {}, ...over,
});

const ACCOUNTS = [pointsCard(), rupeeWallet(), bank()];

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', date: '2026-08-10', description: 'Swiggy Order', accountId: 'bank1',
  type: 'debit', amount: 100, category: 'Food', isRecurring: false, ...over,
});

/** A ₹448 purchase part-paid with ₹86 of rewards: the anchor stores the ₹362 actually paid. */
const anchorWith = (source: string, over: Partial<Transaction> = {}) => tx({
  id: 'anchor', amount: 362, rewardUsed: 86, rewardUsedAccountId: source,
  linkedTransactionIds: ['leg'], ...over,
});
const legOn = (accountId: string, over: Partial<Transaction> = {}) => tx({
  id: 'leg', accountId, amount: 86, description: 'Rewards applied to: Swiggy Order',
  linkedTransactionIds: ['anchor'], ...over,
});

const resolve = (anchor: Transaction, storedAnchor: Transaction | undefined, transactions: Transaction[]) =>
  resolveRewardLegTransition({ anchor, storedAnchor, transactions, accounts: ACCOUNTS });

describe('a split whose source changes', () => {
  it('moves the leg when one reward account is swapped for another', () => {
    const stored = anchorWith('cred');
    const leg = legOn('cred');
    const move = resolve(anchorWith('card1'), stored, [stored, leg]);

    expect(move.kind).toBe('sync');
    if (move.kind !== 'sync') return;
    expect(move.legId).toBe('leg');
    expect(move.patch.accountId).toBe('card1');
    // The whole point: still the redemption, not the anchor's ₹362.
    expect(move.patch.amount).toBe(86);
  });

  it('flips isRewardTransaction to match the new source, both ways', () => {
    const fromRupees = resolve(anchorWith('card1'), anchorWith('cred'), [anchorWith('cred'), legOn('cred')]);
    // Onto a card's own points: the leg now belongs in the POINTS ledger, so the flag goes on. Left
    // off, the redemption would be counted as a rupee charge against the card's credit line.
    expect(fromRupees.kind === 'sync' && fromRupees.patch.isRewardTransaction).toBe(true);

    const fromPoints = resolve(
      anchorWith('cred'),
      anchorWith('card1'),
      [anchorWith('card1'), legOn('card1', { isRewardTransaction: true })],
    );
    // And back off again — a rupee wallet is debited in money. Carried over rather than recomputed,
    // this leg would keep claiming to be points and the wallet would never be debited at all.
    expect(fromPoints.kind === 'sync' && fromPoints.patch.isRewardTransaction).toBe(false);
  });

  it('deletes the leg when the source becomes a one-time reward', () => {
    const stored = anchorWith('cred');
    const move = resolve(anchorWith(EXTERNAL_REWARD_SOURCE_ID), stored, [stored, legOn('cred')]);
    expect(move).toEqual({ kind: 'delete', legId: 'leg' });
  });

  it('deletes the leg when the split is cleared entirely', () => {
    const stored = anchorWith('cred');
    const cleared = tx({ id: 'anchor', amount: 362, rewardUsed: 0, rewardUsedAccountId: '', linkedTransactionIds: ['leg'] });
    expect(resolve(cleared, stored, [stored, legOn('cred')])).toEqual({ kind: 'delete', legId: 'leg' });
  });

  it('has nothing to move when a one-time reward becomes a real account', () => {
    // There was never a leg to retarget — the form builds one, which shouldCreateRewardLeg covers.
    const stored = anchorWith(EXTERNAL_REWARD_SOURCE_ID, { linkedTransactionIds: [] });
    const next = anchorWith('cred', { linkedTransactionIds: [] });
    expect(resolve(next, stored, [stored])).toEqual({ kind: 'none' });
  });
});

describe('a split whose source does not change', () => {
  it('syncs the leg in place, as an ordinary amount edit', () => {
    const stored = anchorWith('cred');
    const raised = anchorWith('cred', { amount: 348, rewardUsed: 100 });
    const move = resolve(raised, stored, [stored, legOn('cred')]);

    expect(move.kind).toBe('sync');
    if (move.kind !== 'sync') return;
    expect(move.legId).toBe('leg');
    expect(move.patch.amount).toBe(100);
    expect(move.patch.accountId).toBe('cred');
  });

  it('tracks the anchor description on a purchase but leaves a CC leg alone', () => {
    const stored = anchorWith('cred');
    const renamed = anchorWith('cred', { description: 'Zomato Order' });
    const purchase = resolve(renamed, stored, [stored, legOn('cred')]);
    expect(purchase.kind === 'sync' && purchase.patch.description).toBe('Rewards applied to: Zomato Order');

    // A CC leg's description names the card it paid, and is set once at creation.
    const ccStored = anchorWith('cred', { category: 'CC Payment' });
    const ccLeg = legOn('cred', { category: 'CC Payment', description: 'Rewards used for Jupiter x CSB' });
    const cc = resolve(anchorWith('cred', { category: 'CC Payment' }), ccStored, [ccStored, ccLeg]);
    expect(cc.kind === 'sync' && cc.patch.description).toBe('Rewards used for Jupiter x CSB');
  });

  it('never mistakes a cashback leg or the anchor itself for the redemption', () => {
    // A card redeeming its OWN points puts the anchor and the leg on the same account, so only the
    // id separates them — matching on account alone would return the anchor.
    const stored = anchorWith('card1', { accountId: 'card1' });
    const cashback = tx({ id: 'cb', accountId: 'card1', category: 'Cashback', type: 'credit', amount: 9 });
    const own = anchorWith('card1', { accountId: 'card1', linkedTransactionIds: ['leg', 'cb'] });
    const move = resolve(own, stored, [stored, cashback, legOn('card1', { accountId: 'card1' })]);
    expect(move.kind === 'sync' && move.legId).toBe('leg');
  });
});

describe('whether the form has to build a leg', () => {
  const base = { linkedIds: [] as string[], transactions: [] as Transaction[] };

  it('builds one for a new split on a real account', () => {
    expect(shouldCreateRewardLeg({ ...base, editId: null, source: 'cred' })).toBe(true);
  });

  it('builds none for a one-time reward, or for no source at all', () => {
    expect(shouldCreateRewardLeg({ ...base, editId: null, source: EXTERNAL_REWARD_SOURCE_ID })).toBe(false);
    expect(shouldCreateRewardLeg({ ...base, editId: null, source: '' })).toBe(false);
    expect(shouldCreateRewardLeg({ ...base, editId: null })).toBe(false);
  });

  it('builds one when an edit gives a one-time reward a real account', () => {
    const stored = anchorWith(EXTERNAL_REWARD_SOURCE_ID, { linkedTransactionIds: [] });
    expect(shouldCreateRewardLeg({
      editId: 'anchor', source: 'cred', linkedIds: [], transactions: [stored],
    })).toBe(true);
  });

  it('builds one when an edit adds a split to a row that never had one', () => {
    const plain = tx({ id: 'anchor', amount: 448 });
    expect(shouldCreateRewardLeg({
      editId: 'anchor', source: 'cred', linkedIds: [], transactions: [plain],
    })).toBe(true);
  });

  it('builds none when the leg already exists on the chosen account', () => {
    const stored = anchorWith('cred');
    expect(shouldCreateRewardLeg({
      editId: 'anchor', source: 'cred', linkedIds: ['leg'], transactions: [stored, legOn('cred')],
    })).toBe(false);
  });

  it('builds none when the source was switched — that leg is retargeted, not rebuilt', () => {
    // The leg still sits on the OLD account, so looking only at the new one would find nothing and
    // build a second leg, leaving the split debiting two accounts at once.
    const stored = anchorWith('cred');
    expect(shouldCreateRewardLeg({
      editId: 'anchor', source: 'card1', linkedIds: ['leg'], transactions: [stored, legOn('cred')],
    })).toBe(false);
  });

  it('builds none while a child leg of the split is what is being edited', () => {
    // The bank leg of a CC split opens carrying the anchor's reconstructed reward fields; the real
    // reward leg hangs off the anchor, so it is absent from THIS row's links every time.
    const anchor = anchorWith('cred', { id: 'anchor', category: 'CC Payment', linkedTransactionIds: ['leg', 'bankleg'] });
    const bankLeg = tx({ id: 'bankleg', accountId: 'bank1', category: 'CC Payment', linkedTransactionIds: ['anchor'] });
    expect(shouldCreateRewardLeg({
      editId: 'bankleg', source: 'cred', linkedIds: ['anchor'], transactions: [anchor, bankLeg, legOn('cred')],
    })).toBe(false);
  });
});

describe('isDebitableRewardSource', () => {
  it('accepts a real account and rejects the untracked and empty cases', () => {
    expect(isDebitableRewardSource('cred')).toBe(true);
    expect(isDebitableRewardSource(EXTERNAL_REWARD_SOURCE_ID)).toBe(false);
    expect(isDebitableRewardSource('')).toBe(false);
    expect(isDebitableRewardSource(undefined)).toBe(false);
  });
});
