// The reward legs of a split, and what has to happen to them when the split's SOURCES change.
//
// A reward split records each redemption twice: as an entry in `rewardSplits` on the anchor (plus
// the legacy `rewardUsed`/`rewardUsedAccountId` pair, which `withRewardSplits` keeps in step), and
// as a debit leg on the account the points came from. Keeping those two in step was once the job of
// one line in updateTransaction, which found the leg by asking "which linked leg sits on the account
// the anchor points at?" — a question that stops having an answer the moment the picker is switched.
// The leg then fell through to the transfer-counterpart branch and was rewritten to the anchor's own
// amount: a ₹86 redemption on a ₹448 purchase silently became a ₹362 one.
//
// The fix is to identify each leg by what the record ALREADY held, so it stays recognisable across
// the change, and then to treat every source change as one event with three outcomes. That is what
// lives here, as pure functions, because the interesting part is a decision table and a decision
// table is worth testing directly:
//
//   from            to              outcome
//   ─────────────── ─────────────── ──────────────────────────────────────────────
//   account A       account B       the leg moves to B (same redemption, new source)
//   account A       one-time        the leg moves to no account at all (see below)
//   one-time        account B       the leg moves onto B
//   nothing         any source      a leg is created — see existingLegIdForSplit
//   any source      dropped/cleared the leg is deleted (nothing funds it any more)
//   account A       account A       the leg is synced in place, as it always was
//
// A ONE-TIME reward — a coupon, a voucher, a scratch-card credit — is a source like any other here,
// and it gets a leg like any other: `accountId` holds the external sentinel, which matches no account,
// so the leg draws its amount down from nothing and no balance anywhere moves. It used to create no
// leg at all, and the redemption existed only as a pill on the anchor: nothing to expand, nothing to
// tap, and a two-source split that reported one leg. Everything else about it — grouping, tapping
// through to the anchor, the passive-exclusion share, deletion un-splitting by that source — now
// works because it is a row like its siblings.
//
// Every row of that table now runs PER SOURCE: a split funded from two wallets has two legs, and one
// source can be swapped, raised or dropped while its sibling sits still. What makes that safe is
// `legId` on each split (see types.ts) — with several legs on the same anchor, "which one is this
// source's?" can no longer be answered by the account alone. Rows written before multi-source splits
// carry no leg ids, so account matching stays as the fallback, and the stray-pairing pass below is
// what still retargets THEIR legs across a source switch.
//
// Creation is the form's job, not this module's: the leg is built there (id, date, category, links)
// and updateTransaction has never created one. Only the gate is here, so both halves of the same
// decision can be read — and tested — side by side.
import type { Account, RewardSplitLeg, Transaction } from '../types';
import { getRewardSplits, isPointsDenominated } from '../utils';

/** Legs that could be one of this split's redemptions. Cashback legs are never one, and the anchor
 *  is not its own leg — a card redeeming its OWN points puts both on the same account, so the id is
 *  what separates them, not the account. */
const candidateLegs = (anchorId: string, linkedIds: string[], transactions: Transaction[]) =>
  transactions.filter(t => t.id !== anchorId && linkedIds.includes(t.id) && t.category !== 'Cashback');

export interface RewardLegPatch {
  accountId: string;
  amount: number;
  description: string;
  /** What routes the leg into the POINTS ledger rather than the rupee one (see affectsRupeeBalance).
   *  Always recomputed against the new source: moving a redemption from a card's own points to a
   *  rupee wallet has to flip it, or the wallet is debited nothing at all. */
  isRewardTransaction: boolean;
}

export interface RewardLegPlan {
  /** Legs that ARE a redemption — retargeted or not — and the fields each must now carry. */
  syncs: { legId: string; patch: RewardLegPatch }[];
  /** Legs whose source is gone (cleared, dropped, or now a one-time reward): delete and unlink. */
  deletes: string[];
}

const EMPTY_PLAN: RewardLegPlan = { syncs: [], deletes: [] };

const patchFor = (split: RewardSplitLeg, anchor: Transaction, leg: Transaction, accounts: Account[]): RewardLegPatch => {
  const source = accounts.find(a => a.id === split.accountId);
  const isCCPayment = anchor.category?.toLowerCase() === 'cc payment';
  return {
    accountId: split.accountId,
    // Rupees on both sides — the points conversion lives in calculateBalance — so this is a copy.
    amount: Number(split.amount) || 0,
    // A CC leg's description names the card it paid and is set at creation; only a plain purchase's
    // tracks the anchor's description.
    description: isCCPayment ? leg.description : `Paid toward: ${anchor.description}`,
    isRewardTransaction: isPointsDenominated(source),
  };
};

/**
 * What must happen to a split's reward legs, given the anchor as it is being saved and as it was
 * stored. `storedAnchor` is the only place the PREVIOUS sources can be read from, and is what makes a
 * switched source survivable.
 *
 * Call only when the anchor itself is being edited. A child leg's own edit form carries reconstructed
 * anchor fields so the modal reads correctly, and reading those as a source change would delete the
 * sibling legs.
 */
export function resolveRewardLegPlan(params: {
  anchor: Transaction;
  storedAnchor?: Transaction;
  transactions: Transaction[];
  accounts: Account[];
}): RewardLegPlan {
  const { anchor, storedAnchor, transactions, accounts } = params;

  const linkedIds = anchor.linkedTransactionIds
    || (anchor.linkedTransactionId ? [anchor.linkedTransactionId] : []);
  const nextSplits = getRewardSplits(anchor);
  const storedSplits = getRewardSplits(storedAnchor);
  if (nextSplits.length === 0 && storedSplits.length === 0) return EMPTY_PLAN;

  const candidates = candidateLegs(anchor.id, linkedIds, transactions);
  if (candidates.length === 0) return EMPTY_PLAN;

  /* Only legs the STORED split accounted for may be deleted or retargeted. Everything else linked to
     the anchor — the bank leg of a CC payment, an NCMC counterpart — is somebody else's leg, and the
     account/id matching below must never be allowed to reach it. */
  const wasRewardLeg = (leg: Transaction) => storedSplits.some(s =>
    s.legId ? s.legId === leg.id : s.accountId === leg.accountId);
  const previousLegs = candidates.filter(wasRewardLeg);

  const claimed = new Set<string>();
  const claim = (leg: Transaction | undefined) => {
    if (!leg || claimed.has(leg.id)) return undefined;
    claimed.add(leg.id);
    return leg;
  };

  // Pass 1 — each source takes the leg it names, or (legacy, no ids) the leg sitting on it.
  const matched = new Map<number, Transaction>();
  nextSplits.forEach((split, i) => {
    const byId = split.legId ? candidates.find(c => c.id === split.legId) : undefined;
    const leg = claim(byId) ?? claim(candidates.find(c => c.accountId === split.accountId && wasRewardLeg(c)));
    if (leg) matched.set(i, leg);
  });

  // Pass 2 — a source that found nothing adopts a leg the stored split left behind. This is the
  // "account A -> account B" row of the table for a row with no leg ids: the leg still sits on A, so
  // nothing above can match it, and without this it would be deleted and rebuilt (losing the leg's
  // own exclusion) or worse, mistaken for a transfer counterpart and rewritten to the full amount.
  nextSplits.forEach((_split, i) => {
    if (matched.has(i)) return;
    const stray = claim(previousLegs.find(l => !claimed.has(l.id)));
    if (stray) matched.set(i, stray);
  });

  const syncs = [...matched.entries()].map(([i, leg]) => ({
    legId: leg.id,
    patch: patchFor(nextSplits[i], anchor, leg, accounts),
  }));
  // Anything the stored split owned and no current source claimed has lost its funding: the source
  // was dropped, cleared, or turned into a one-time reward. Same outcome for all three.
  const deletes = previousLegs.filter(l => !claimed.has(l.id)).map(l => l.id);

  return { syncs, deletes };
}

/**
 * Whether the row being saved is a FUNDING CHILD of someone else's split — the bank leg of a 3-leg
 * CC payment. Its form carries the anchor's reconstructed reward fields so the modal reads
 * correctly, so without this test a save from that side would look like "a split with no legs yet"
 * and build a duplicate set of them.
 */
export function isRewardSplitChildRow(editId: string | null | undefined, transactions: Transaction[]): boolean {
  if (!editId) return false;
  return transactions.some(p =>
    p.id !== editId
    && (p.linkedTransactionIds || []).includes(editId)
    && getRewardSplits(p).length > 0);
}

/**
 * For ONE source on the row being saved: the id of the leg already serving it, or null when a leg has
 * to be built. Called per source, so a split can gain a second wallet without disturbing the first.
 *
 * A leg is built for a brand-new split, and — this is what was once missing — for an edit that gives
 * a source a real account it did not have: switching off a one-time reward, or adding a source to a
 * row that never had one. Both used to record the redemption on the anchor while the reward account
 * was never debited.
 *
 * `split.legId` is authoritative when the leg it names still exists. Legacy rows carry none, so the
 * source's own account is checked, and so is the account the STORED split used: a source switched
 * between two real accounts still has its leg on the OLD account, and `resolveRewardLegPlan`
 * retargets that one — building a second here would leave the split debiting two accounts at once.
 */
export function existingLegIdForSplit(params: {
  editId?: string | null;
  /** The source as the form now holds it (with its `legId`, if it has ever had one). */
  split: RewardSplitLeg;
  /** The anchor's links as they stand mid-save. */
  linkedIds: string[];
  transactions: Transaction[];
  /** Sources on this same save that have already claimed a leg, so two can't claim one. */
  claimedLegIds?: string[];
}): string | null {
  const { editId, split, linkedIds, transactions, claimedLegIds = [] } = params;
  if (!split.accountId) return null;
  if (!editId) return null;

  const candidates = candidateLegs(editId, linkedIds, transactions)
    .filter(c => !claimedLegIds.includes(c.id));
  const storedSplits = getRewardSplits(transactions.find(t => t.id === editId));

  // 1. The leg this source names, when it is still there.
  if (split.legId) {
    const named = candidates.find(c => c.id === split.legId);
    if (named) return named.id;
  }
  // 2. Legacy row, source unchanged: no ids were ever recorded, so the leg is the one sitting on
  //    this account — and it has to be one the STORED split owned, or a CC payment's bank leg on a
  //    rewards account would be mistaken for a redemption.
  const sameAccount = candidates.find(c =>
    c.accountId === split.accountId
    && storedSplits.some(s => s.accountId === c.accountId));
  if (sameAccount) return sameAccount.id;

  // 3. Legacy row, source switched between two real accounts: the leg still sits on the OLD account,
  //    so nothing above sees it. Adopt it — resolveRewardLegPlan retargets it — rather than build a
  //    second, which would leave the split debiting both accounts at once. Legs another source on
  //    this same save has already taken are excluded by `claimedLegIds` above.
  const stranded = candidates.find(c =>
    storedSplits.some(s => (s.legId ? s.legId === c.id : s.accountId === c.accountId)));
  return stranded ? stranded.id : null;
}
