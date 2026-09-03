// The reward-split accessors in `utils`, and the rule that decides which source flexes when
// something else fixes the total.
//
// These are the seam that lets one anchor name several reward sources without a migration: a row
// written before multi-source splits carries the legacy `rewardUsed` + `rewardUsedAccountId` pair and
// no leg ids, a current one carries the list, and every reader in the app sees the same shape. So the
// interesting cases are the OLD shapes, and they are what most of this file is about.
import { describe, it, expect } from 'vitest';
import {
  getRewardSplits, rewardSplitTotal, isRewardSourceOf, rewardSplitOfLeg, accountNameOf,
  rewardSplitIndexOfLeg, rewardLegIdsOf, withRewardSplits, redistributeRewardSplits,
  isPointsDenominated, isUnitDenominated, rewardUnitBalance, formatRewardBalance,
  rupeesToRewardPoints, EXTERNAL_REWARD_SOURCE_ID,
} from '../utils';
import type { Account, Transaction } from '../types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'anchor', date: '2026-08-10', description: 'Swiggy Order', accountId: 'bank1',
  type: 'debit', amount: 362, category: 'Food', isRecurring: false, ...over,
});

/** A ₹448 purchase part-paid with ₹86 of rewards, as any build before multi-source splits wrote it. */
const legacy = tx({ rewardUsed: 86, rewardUsedAccountId: 'cred' });
/** The same purchase, funded from two wallets, as a current save writes it. */
const modern = tx({
  amount: 362,
  rewardUsed: 86,
  rewardUsedAccountId: 'cred',
  rewardSplits: [
    { accountId: 'cred', amount: 50, legId: 'legA' },
    { accountId: 'super', amount: 36, legId: 'legB' },
  ],
});

describe('reading a split, whichever shape it was stored in', () => {
  it('reads a legacy single-source row as one source', () => {
    expect(getRewardSplits(legacy)).toEqual([{ accountId: 'cred', amount: 86 }]);
    expect(rewardSplitTotal(legacy)).toBe(86);
    expect(rewardLegIdsOf(legacy)).toEqual([]);
  });

  it('reads a multi-source row as its list, and totals it', () => {
    expect(getRewardSplits(modern)).toHaveLength(2);
    expect(rewardSplitTotal(modern)).toBe(86);
    expect(rewardLegIdsOf(modern)).toEqual(['legA', 'legB']);
  });

  it('reads a row with no split as no split', () => {
    expect(getRewardSplits(tx({}))).toEqual([]);
    expect(rewardSplitTotal(tx({}))).toBe(0);
    // A source with nothing spent from it is not a source: the form's empty card, mid-edit.
    expect(getRewardSplits(tx({ rewardUsed: 0, rewardUsedAccountId: 'cred' }))).toEqual([]);
  });

  it('counts a one-time reward as a source like any other, leg and all', () => {
    const mixed = withRewardSplits(tx({}), [
      { accountId: 'cred', amount: 50, legId: 'legA' },
      { accountId: EXTERNAL_REWARD_SOURCE_ID, amount: 36, legId: 'legB' },
    ]);
    expect(rewardSplitTotal(mixed)).toBe(86);
    expect(rewardLegIdsOf(mixed)).toEqual(['legA', 'legB']);
    // Its leg sits on no account, which is what keeps it out of every balance — and what makes it
    // need a name of its own wherever a row's account is printed.
    expect(accountNameOf(EXTERNAL_REWARD_SOURCE_ID, [])).toBe('One-time reward');
    expect(accountNameOf('nope', [])).toBe('Unknown');
  });

  it('answers "is this account a source here?" across both shapes', () => {
    expect(isRewardSourceOf(legacy, 'cred')).toBe(true);
    expect(isRewardSourceOf(legacy, 'super')).toBe(false);
    expect(isRewardSourceOf(modern, 'super')).toBe(true);
    expect(isRewardSourceOf(modern, undefined)).toBe(false);
  });
});

describe('matching a leg to the source that produced it', () => {
  it('matches by leg id, so two sibling legs can never be confused', () => {
    // Both legs are on the anchor; only the id says which redemption each one is. This is the case
    // the single-field model could not express at all.
    expect(rewardSplitOfLeg(modern, { id: 'legB', accountId: 'super' })?.amount).toBe(36);
    expect(rewardSplitIndexOfLeg(modern, { id: 'legB', accountId: 'super' })).toBe(1);
  });

  it('still matches a leg by id after its source was pointed elsewhere', () => {
    // Mid-edit the anchor names a new account while the leg is still on the old one. Matching on
    // account alone here is what used to make the leg unrecognisable, and it was then rewritten to
    // the anchor's own amount.
    const moved = { ...modern, rewardSplits: [modern.rewardSplits![0], { accountId: 'card1', amount: 36, legId: 'legB' }] };
    expect(rewardSplitOfLeg(moved, { id: 'legB', accountId: 'super' })?.accountId).toBe('card1');
  });

  it('falls back to the account for a legacy row, which recorded no ids', () => {
    expect(rewardSplitOfLeg(legacy, { id: 'leg', accountId: 'cred' })?.amount).toBe(86);
    expect(rewardSplitOfLeg(legacy, { id: 'leg', accountId: 'bank1' })).toBeUndefined();
    expect(rewardSplitIndexOfLeg(legacy, { id: 'leg', accountId: 'bank1' })).toBe(-1);
  });

  it('does not hand a legacy account match to a row whose sources all name their legs', () => {
    // The bank leg of a CC payment is linked and not cashback, so only this keeps it out: every
    // source names its leg, and this row is not one of them.
    expect(rewardSplitOfLeg(modern, { id: 'bankleg', accountId: 'bank1' })).toBeUndefined();
  });
});

describe('writing a split back', () => {
  it('keeps the legacy pair in step: the total, and the first source', () => {
    const written = withRewardSplits(tx({}), [
      { accountId: 'cred', amount: 50, legId: 'legA' },
      { accountId: 'super', amount: 36, legId: 'legB' },
    ]);
    // `total - rewardUsed` and `!!rewardUsedAccountId` are relied on all over the app; both still
    // hold for a two-wallet split.
    expect(written.rewardUsed).toBe(86);
    expect(written.rewardUsedAccountId).toBe('cred');
    expect(written.rewardSplits).toHaveLength(2);
  });

  it('drops sources with nothing spent from them', () => {
    const written = withRewardSplits(tx({}), [
      { accountId: 'cred', amount: 50, legId: 'legA' },
      { accountId: 'super', amount: 0, legId: 'legB' },
      { accountId: '', amount: 20 },
    ]);
    expect(written.rewardSplits).toEqual([{ accountId: 'cred', amount: 50, legId: 'legA' }]);
    expect(written.rewardUsed).toBe(50);
  });

  it('clears the field rather than leaving an empty list behind', () => {
    const cleared = withRewardSplits(modern, []);
    expect(cleared.rewardSplits).toBeUndefined();
    expect(cleared.rewardUsed).toBe(0);
    expect(cleared.rewardUsedAccountId).toBe('');
    expect(getRewardSplits(cleared)).toEqual([]);
  });
});

describe('fitting the sources to a total someone else decided', () => {
  const two = [
    { accountId: 'cred', amount: 50, legId: 'legA' },
    { accountId: 'super', amount: 36, legId: 'legB' },
  ];

  it('assigns the whole total when there is one source', () => {
    expect(redistributeRewardSplits([two[0]], 70)).toEqual([{ ...two[0], amount: 70 }]);
  });

  it('flexes the LAST source, leaving the first as the user set it', () => {
    // The bank leg was raised by ₹10, so ₹10 less comes from rewards. The redemption set up first
    // stays put; the one most recently tacked on absorbs it.
    expect(redistributeRewardSplits(two, 76)).toEqual([
      { ...two[0], amount: 50 },
      { ...two[1], amount: 26 },
    ]);
  });

  it('grows the last source when the rewards have to cover more', () => {
    expect(redistributeRewardSplits(two, 120)).toEqual([
      { ...two[0], amount: 50 },
      { ...two[1], amount: 70 },
    ]);
  });

  it('cascades backwards when the last source runs out of room', () => {
    // Down to ₹30 — less than the last source alone was paying, so it empties and the first gives up
    // the rest. A source left at ₹0 is dropped by the caller, along with its leg.
    expect(redistributeRewardSplits(two, 30)).toEqual([
      { ...two[0], amount: 30 },
      { ...two[1], amount: 0 },
    ]);
  });

  it('never assigns a negative amount, and survives an empty list', () => {
    expect(redistributeRewardSplits(two, -40)).toEqual([
      { ...two[0], amount: 0 },
      { ...two[1], amount: 0 },
    ]);
    expect(redistributeRewardSplits([], 50)).toEqual([]);
  });

  it('keeps the sources summing to the target through the rounding', () => {
    const thirds = [
      { accountId: 'a', amount: 33.33 },
      { accountId: 'b', amount: 33.33 },
      { accountId: 'c', amount: 33.34 },
    ];
    const out = redistributeRewardSplits(thirds, 66.67);
    expect(out.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(66.67, 2);
  });
});

describe('a rewards wallet counted in its own unit', () => {
  // "Cheq Chips": a rewards wallet holding the rupee value of 500 Chips at 10 Chips = ₹1. The rupees
  // are what is stored — its deposits, redemptions and liquidations are ordinary rupee movements —
  // and the unit is applied on the way in and out.
  const chips = (over: Partial<Account> = {}): Account => ({
    id: 'chips', name: 'Cheq Chips', type: 'rewards',
    openingBalances: { '2026-09': 50 },
    rewardUnit: 'Chips', pointsConversionRate: 10, rewardType: 'points', ...over,
  });
  // A card with its own points programme: a SECOND balance beside its rupee outstanding.
  const jewelCard = (over: Partial<Account> = {}): Account => ({
    id: 'card1', name: 'Jupiter x CSB', type: 'credit_card', openingBalances: {},
    rewardOpeningBalances: { '2026-09': 477 },
    isCashbackEnabled: true, rewardType: 'points', rewardUnit: 'Jewels', pointsConversionRate: 5, ...over,
  });
  const cred = (over: Partial<Account> = {}): Account => ({
    id: 'cred', name: 'CRED rewards', type: 'rewards', openingBalances: { '2026-09': 21 }, ...over,
  });

  it('is counted in a unit, but keeps no separate points ledger', () => {
    // The distinction the two predicates exist to draw: only a card has two balances to tell apart,
    // so only a card's legs belong to a points ledger. Reading isPointsDenominated for the DISPLAY
    // question is what reported 500 Chips as ₹500 everywhere but the Accounts card.
    expect(isUnitDenominated(chips())).toBe(true);
    expect(isPointsDenominated(chips())).toBe(false);
    expect(isUnitDenominated(jewelCard())).toBe(true);
    expect(isPointsDenominated(jewelCard())).toBe(true);
    // A plain rupee wallet, and a wallet that names a unit but has not been normalised to it yet
    // (the pre-migration shape: no rewardType, so its stored figures are still plain rupees).
    expect(isUnitDenominated(cred())).toBe(false);
    expect(isUnitDenominated(cred({ rewardUnit: 'Coins', pointsConversionRate: 10 }))).toBe(false);
  });

  it('converts its rupee balance into its unit, net of what has been redeemed', () => {
    // A ₹20 redemption leg — an ordinary rupee debit, since the wallet has no points ledger.
    const redemption = tx({
      id: 'leg', accountId: 'chips', date: '2026-09-05', amount: 20,
      description: 'Rewards applied to: Swiggy Order',
    });
    expect(rewardUnitBalance(chips(), [redemption], '2026-09')).toBe(300);
    expect(formatRewardBalance(chips(), 300)).toBe('300 Chips');
  });

  it('reads a card’s points wallet from its own ledger instead', () => {
    // Already a point count, so nothing is converted: the rate belongs to the legs, not the balance.
    expect(rewardUnitBalance(jewelCard(), [], '2026-09')).toBe(477);
    expect(formatRewardBalance(jewelCard(), 477)).toBe('477 Jewels');
  });

  it('leaves a rupee wallet in rupees', () => {
    expect(rewardUnitBalance(cred(), [], '2026-09')).toBe(21);
    expect(formatRewardBalance(cred(), 21)).toBe('₹21');
    // The rate is what a unit costs; with no unit there is nothing to convert at.
    expect(rupeesToRewardPoints(21, cred())).toBe(21);
  });

  it('prices a redemption in the wallet’s unit', () => {
    // 200 Chips typed into the split card is ₹20 off the bill — the leg's amount — and the balance
    // check compares 200 against the 500 the wallet holds.
    expect(rupeesToRewardPoints(20, chips())).toBe(200);
    expect(rewardUnitBalance(chips(), [], '2026-09')).toBe(500);
  });
});
