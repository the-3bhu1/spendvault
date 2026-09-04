// The reward legs' behaviour when a split's SOURCES change on an edit — the decision table in
// RewardLegService, exercised transition by transition, for one source and for several.
//
// Every single-source case below was broken before that module existed, and broken in a way nothing
// reported: the leg was found by "which linked leg sits on the account the anchor points at?", so
// switching the picker made it unrecognisable and it fell through to the transfer-counterpart branch,
// which rewrote its amount to the anchor's own. The assertions here are mostly about a ₹86 redemption
// staying ₹86 — and, now that a split can name several wallets, about one source moving while its
// sibling sits still.
import { describe, it, expect } from 'vitest';
import { resolveRewardLegPlan, existingLegIdForSplit, isRewardSplitChildRow } from './RewardLegService';
import { EXTERNAL_REWARD_SOURCE_ID } from '../utils';
import type { Account, RewardSplitLeg, Transaction } from '../types';

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

const ACCOUNTS = [pointsCard(), rupeeWallet(), bank(), rupeeWallet({ id: 'super', name: 'super.money' })];

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', date: '2026-08-10', description: 'Swiggy Order', accountId: 'bank1',
  type: 'debit', amount: 100, category: 'Food', isRecurring: false, ...over,
});

/** A ₹448 purchase part-paid with ₹86 of rewards: the anchor stores the ₹362 actually paid. Written
 *  the way any build before multi-source splits wrote it — the legacy pair, no `rewardSplits`. */
const anchorWith = (source: string, over: Partial<Transaction> = {}) => tx({
  id: 'anchor', amount: 362, rewardUsed: 86, rewardUsedAccountId: source,
  linkedTransactionIds: ['leg'], ...over,
});
const legOn = (accountId: string, over: Partial<Transaction> = {}) => tx({
  id: 'leg', accountId, amount: 86, description: 'Paid toward: Swiggy Order',
  linkedTransactionIds: ['anchor'], ...over,
});

/** The same purchase funded from several wallets, in the shape a current save writes: the list is
 *  authoritative, `rewardUsed` is its total, and the first source is mirrored into the legacy field. */
const anchorSplit = (splits: RewardSplitLeg[], over: Partial<Transaction> = {}) => tx({
  id: 'anchor',
  amount: 448 - splits.reduce((s, x) => s + x.amount, 0),
  rewardUsed: splits.reduce((s, x) => s + x.amount, 0),
  rewardUsedAccountId: splits[0]?.accountId || '',
  rewardSplits: splits,
  linkedTransactionIds: splits.map(s => s.legId).filter((i): i is string => !!i),
  ...over,
});

const plan = (anchor: Transaction, storedAnchor: Transaction | undefined, transactions: Transaction[]) =>
  resolveRewardLegPlan({ anchor, storedAnchor, transactions, accounts: ACCOUNTS });

describe('a single-source split whose source changes', () => {
  it('moves the leg when one reward account is swapped for another', () => {
    const stored = anchorWith('cred');
    const leg = legOn('cred');
    const { syncs, deletes } = plan(anchorWith('card1'), stored, [stored, leg]);

    expect(deletes).toEqual([]);
    expect(syncs).toHaveLength(1);
    expect(syncs[0].legId).toBe('leg');
    expect(syncs[0].patch.accountId).toBe('card1');
    // The whole point: still the redemption, not the anchor's ₹362.
    expect(syncs[0].patch.amount).toBe(86);
  });

  it('flips isRewardTransaction to match the new source, both ways', () => {
    const toPoints = plan(anchorWith('card1'), anchorWith('cred'), [anchorWith('cred'), legOn('cred')]);
    // Onto a card's own points: the leg now belongs in the POINTS ledger, so the flag goes on. Left
    // off, the redemption would be counted as a rupee charge against the card's credit line.
    expect(toPoints.syncs[0].patch.isRewardTransaction).toBe(true);

    const toRupees = plan(
      anchorWith('cred'),
      anchorWith('card1'),
      [anchorWith('card1'), legOn('card1', { isRewardTransaction: true })],
    );
    // And back off again — a rupee wallet is debited in money. Carried over rather than recomputed,
    // this leg would keep claiming to be points and the wallet would never be debited at all.
    expect(toRupees.syncs[0].patch.isRewardTransaction).toBe(false);
  });

  it('moves the leg onto no account when the source becomes a one-time reward', () => {
    // A coupon is a source like any other now: the redemption keeps its leg (and its id, its links
    // and its share of any exclusion), the leg just stops sitting on an account — the sentinel
    // matches none, so nothing is debited anywhere.
    const stored = anchorWith('cred');
    const { syncs, deletes } = plan(anchorWith(EXTERNAL_REWARD_SOURCE_ID), stored, [stored, legOn('cred')]);
    expect(deletes).toEqual([]);
    expect(syncs).toHaveLength(1);
    expect(syncs[0].patch.accountId).toBe(EXTERNAL_REWARD_SOURCE_ID);
    expect(syncs[0].patch.amount).toBe(86);
    // Not points, so it stays in the rupee ledger — where it lands on no account at all.
    expect(syncs[0].patch.isRewardTransaction).toBe(false);
  });

  it('moves the leg onto a real account when a one-time reward is swapped for one', () => {
    const stored = anchorWith(EXTERNAL_REWARD_SOURCE_ID);
    const leg = legOn(EXTERNAL_REWARD_SOURCE_ID);
    const { syncs, deletes } = plan(anchorWith('cred'), stored, [stored, leg]);
    expect(deletes).toEqual([]);
    expect(syncs[0].patch.accountId).toBe('cred');
    expect(syncs[0].patch.amount).toBe(86);
  });

  it('deletes the leg when the split is cleared entirely', () => {
    const stored = anchorWith('cred');
    const cleared = tx({ id: 'anchor', amount: 362, rewardUsed: 0, rewardUsedAccountId: '', linkedTransactionIds: ['leg'] });
    expect(plan(cleared, stored, [stored, legOn('cred')])).toEqual({ syncs: [], deletes: ['leg'] });
  });

  it('has nothing to move when the split had no leg to begin with', () => {
    // A split written before a one-time reward earned a leg of its own: there is nothing to retarget,
    // so the form builds one, which existingLegIdForSplit covers.
    const stored = anchorWith(EXTERNAL_REWARD_SOURCE_ID, { linkedTransactionIds: [] });
    const next = anchorWith('cred', { linkedTransactionIds: [] });
    expect(plan(next, stored, [stored])).toEqual({ syncs: [], deletes: [] });
  });
});

describe('a split whose source does not change', () => {
  it('syncs the leg in place, as an ordinary amount edit', () => {
    const stored = anchorWith('cred');
    const raised = anchorWith('cred', { amount: 348, rewardUsed: 100 });
    const { syncs } = plan(raised, stored, [stored, legOn('cred')]);

    expect(syncs).toHaveLength(1);
    expect(syncs[0].legId).toBe('leg');
    expect(syncs[0].patch.amount).toBe(100);
    expect(syncs[0].patch.accountId).toBe('cred');
  });

  it('tracks the anchor description on a purchase but leaves a CC leg alone', () => {
    const stored = anchorWith('cred');
    const renamed = anchorWith('cred', { description: 'Zomato Order' });
    const purchase = plan(renamed, stored, [stored, legOn('cred')]);
    expect(purchase.syncs[0].patch.description).toBe('Paid toward: Zomato Order');

    // A CC leg's description names the card it paid, and is set once at creation.
    const ccStored = anchorWith('cred', { category: 'CC Payment' });
    const ccLeg = legOn('cred', { category: 'CC Payment', description: 'Paid toward: Jupiter x CSB' });
    const cc = plan(anchorWith('cred', { category: 'CC Payment' }), ccStored, [ccStored, ccLeg]);
    expect(cc.syncs[0].patch.description).toBe('Paid toward: Jupiter x CSB');
  });

  it('never mistakes a cashback leg or the anchor itself for the redemption', () => {
    // A card redeeming its OWN points puts the anchor and the leg on the same account, so only the
    // id separates them — matching on account alone would return the anchor.
    const stored = anchorWith('card1', { accountId: 'card1' });
    const cashback = tx({ id: 'cb', accountId: 'card1', category: 'Cashback', type: 'credit', amount: 9 });
    const own = anchorWith('card1', { accountId: 'card1', linkedTransactionIds: ['leg', 'cb'] });
    const { syncs, deletes } = plan(own, stored, [stored, cashback, legOn('card1', { accountId: 'card1' })]);
    expect(syncs.map(s => s.legId)).toEqual(['leg']);
    expect(deletes).toEqual([]);
  });

  it('leaves a CC payment’s bank leg alone — it is not a redemption', () => {
    // The bank leg is linked, is not cashback, and on a legacy row carries no id to distinguish it.
    // Only the stored SPLIT's accounts may be touched, or a source switch would delete the funding.
    const stored = anchorWith('cred', { category: 'CC Payment', accountId: 'card1', type: 'credit', linkedTransactionIds: ['leg', 'bankleg'] });
    const bankLeg = tx({ id: 'bankleg', accountId: 'bank1', amount: 362, category: 'CC Payment', linkedTransactionIds: ['anchor'] });
    const next = { ...stored, rewardUsedAccountId: 'card1' };
    const { syncs, deletes } = plan(next, stored, [stored, bankLeg, legOn('cred', { category: 'CC Payment' })]);
    expect(syncs.map(s => s.legId)).toEqual(['leg']);
    expect(deletes).toEqual([]);
  });
});

describe('a split funded from several sources', () => {
  const twoSources = [
    { accountId: 'cred', amount: 50, legId: 'legA' },
    { accountId: 'super', amount: 36, legId: 'legB' },
  ];
  const legA = legOn('cred', { id: 'legA', amount: 50 });
  const legB = legOn('super', { id: 'legB', amount: 36 });

  it('syncs each leg to its OWN source and amount', () => {
    const stored = anchorSplit(twoSources);
    const { syncs, deletes } = plan(stored, stored, [stored, legA, legB]);

    expect(deletes).toEqual([]);
    expect(syncs.map(s => [s.legId, s.patch.accountId, s.patch.amount])).toEqual([
      ['legA', 'cred', 50],
      ['legB', 'super', 36],
    ]);
  });

  it('raises one source without disturbing the other', () => {
    const stored = anchorSplit(twoSources);
    const raised = anchorSplit([{ ...twoSources[0], amount: 80 }, twoSources[1]]);
    const { syncs } = plan(raised, stored, [stored, legA, legB]);
    expect(syncs.find(s => s.legId === 'legA')!.patch.amount).toBe(80);
    expect(syncs.find(s => s.legId === 'legB')!.patch.amount).toBe(36);
  });

  it('moves only the source that was switched', () => {
    const stored = anchorSplit(twoSources);
    // The second wallet is swapped for the card's own points; the first is untouched.
    const moved = anchorSplit([twoSources[0], { ...twoSources[1], accountId: 'card1' }]);
    const { syncs, deletes } = plan(moved, stored, [stored, legA, legB]);

    expect(deletes).toEqual([]);
    expect(syncs.find(s => s.legId === 'legA')!.patch.accountId).toBe('cred');
    const b = syncs.find(s => s.legId === 'legB')!;
    expect(b.patch.accountId).toBe('card1');
    expect(b.patch.amount).toBe(36);
    // Points now, so the leg has to leave the rupee ledger.
    expect(b.patch.isRewardTransaction).toBe(true);
  });

  it('deletes only the dropped source’s leg when a split goes from two wallets to one', () => {
    const stored = anchorSplit(twoSources);
    const oneLeft = anchorSplit([twoSources[0]], { linkedTransactionIds: ['legA', 'legB'] });
    const { syncs, deletes } = plan(oneLeft, stored, [stored, legA, legB]);

    expect(syncs.map(s => s.legId)).toEqual(['legA']);
    expect(deletes).toEqual(['legB']);
  });

  it('keeps both legs when the second source becomes a one-time reward', () => {
    // The second leg is retargeted onto no account rather than removed: the ₹36 is still part of what
    // paid for this, and it is still a row the user can see and tap through to.
    const stored = anchorSplit(twoSources);
    const external = anchorSplit(
      [twoSources[0], { ...twoSources[1], accountId: EXTERNAL_REWARD_SOURCE_ID }],
      { linkedTransactionIds: ['legA', 'legB'] },
    );
    const { syncs, deletes } = plan(external, stored, [stored, legA, legB]);
    expect(deletes).toEqual([]);
    expect(syncs.find(s => s.legId === 'legB')!.patch).toMatchObject({
      accountId: EXTERNAL_REWARD_SOURCE_ID, amount: 36,
    });
    expect(syncs.find(s => s.legId === 'legA')!.patch.accountId).toBe('cred');
  });

  it('never hands one source its sibling’s leg', () => {
    // Both sources swapped accounts in one edit. Ids are what keep them apart: matched by account
    // alone, each would find the other's leg and the two redemptions would trade places.
    const stored = anchorSplit(twoSources);
    const swapped = anchorSplit([
      { ...twoSources[0], accountId: 'super' },
      { ...twoSources[1], accountId: 'cred' },
    ]);
    const { syncs } = plan(swapped, stored, [stored, legA, legB]);
    expect(syncs.find(s => s.legId === 'legA')!.patch).toMatchObject({ accountId: 'super', amount: 50 });
    expect(syncs.find(s => s.legId === 'legB')!.patch).toMatchObject({ accountId: 'cred', amount: 36 });
  });
});

describe('whether the form has to build a leg for a source', () => {
  const split = (over: Partial<RewardSplitLeg> = {}): RewardSplitLeg =>
    ({ accountId: 'cred', amount: 86, ...over });
  const base = { linkedIds: [] as string[], transactions: [] as Transaction[] };

  it('builds one for a new split on a real account', () => {
    expect(existingLegIdForSplit({ ...base, editId: null, split: split() })).toBeNull();
  });

  it('builds one for a one-time reward too, but none for no source at all', () => {
    // Null here means "build one". An empty card is not a source and never gets a leg.
    expect(existingLegIdForSplit({ ...base, editId: 'anchor', split: split({ accountId: EXTERNAL_REWARD_SOURCE_ID }) })).toBeNull();
    expect(existingLegIdForSplit({ ...base, editId: 'anchor', split: split({ accountId: '' }) })).toBeNull();
  });

  it('reuses a one-time reward’s existing leg rather than building a second', () => {
    const stored = anchorSplit([{ accountId: EXTERNAL_REWARD_SOURCE_ID, amount: 86, legId: 'legA' }]);
    expect(existingLegIdForSplit({
      editId: 'anchor', split: split({ accountId: EXTERNAL_REWARD_SOURCE_ID, legId: 'legA' }),
      linkedIds: ['legA'], transactions: [stored, legOn(EXTERNAL_REWARD_SOURCE_ID, { id: 'legA' })],
    })).toBe('legA');
  });

  it('reuses the leg a source names', () => {
    const stored = anchorSplit([{ accountId: 'cred', amount: 86, legId: 'legA' }]);
    expect(existingLegIdForSplit({
      editId: 'anchor', split: split({ legId: 'legA' }), linkedIds: ['legA'],
      transactions: [stored, legOn('cred', { id: 'legA' })],
    })).toBe('legA');
  });

  it('reuses a legacy row’s leg, which carries no id', () => {
    const stored = anchorWith('cred');
    expect(existingLegIdForSplit({
      editId: 'anchor', split: split(), linkedIds: ['leg'], transactions: [stored, legOn('cred')],
    })).toBe('leg');
  });

  it('adopts the stranded leg when a legacy row’s source was switched', () => {
    // The leg still sits on the OLD account, so looking only at the new one would find nothing and
    // build a second leg, leaving the split debiting two accounts at once.
    const stored = anchorWith('cred');
    expect(existingLegIdForSplit({
      editId: 'anchor', split: split({ accountId: 'card1' }), linkedIds: ['leg'],
      transactions: [stored, legOn('cred')],
    })).toBe('leg');
  });

  it('builds one for a source ADDED to an existing split, and never steals the sibling’s leg', () => {
    const stored = anchorSplit([{ accountId: 'cred', amount: 50, legId: 'legA' }]);
    expect(existingLegIdForSplit({
      editId: 'anchor', split: split({ accountId: 'super', amount: 36 }), linkedIds: ['legA'],
      transactions: [stored, legOn('cred', { id: 'legA', amount: 50 })],
      claimedLegIds: ['legA'],
    })).toBeNull();
  });

  it('builds one when an edit gives a one-time reward a real account', () => {
    const stored = anchorWith(EXTERNAL_REWARD_SOURCE_ID, { linkedTransactionIds: [] });
    expect(existingLegIdForSplit({
      editId: 'anchor', split: split(), linkedIds: [], transactions: [stored],
    })).toBeNull();
  });

  it('builds one when an edit adds a split to a row that never had one', () => {
    const plain = tx({ id: 'anchor', amount: 448 });
    expect(existingLegIdForSplit({
      editId: 'anchor', split: split(), linkedIds: [], transactions: [plain],
    })).toBeNull();
  });
});

describe('isRewardSplitChildRow', () => {
  it('spots the bank leg of a split, whose form carries reconstructed anchor fields', () => {
    // The real reward leg hangs off the anchor, so it is absent from THIS row's links every time —
    // without this test the save would look like "a split with no legs" and build duplicates.
    const anchor = anchorWith('cred', { category: 'CC Payment', linkedTransactionIds: ['leg', 'bankleg'] });
    const bankLeg = tx({ id: 'bankleg', accountId: 'bank1', category: 'CC Payment', linkedTransactionIds: ['anchor'] });
    expect(isRewardSplitChildRow('bankleg', [anchor, bankLeg, legOn('cred')])).toBe(true);
    expect(isRewardSplitChildRow('anchor', [anchor, bankLeg, legOn('cred')])).toBe(false);
    expect(isRewardSplitChildRow(null, [anchor])).toBe(false);
  });
});
