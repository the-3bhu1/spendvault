// The reward leg of a split, and what has to happen to it when the split's SOURCE changes.
//
// A reward split records a redemption twice: as `rewardUsed` + `rewardUsedAccountId` on the anchor,
// and as a debit leg on the account the points came from. Keeping those two in step was the job of
// one line in updateTransaction, which found the leg by asking "which linked leg sits on the account
// the anchor points at?" — a question that stops having an answer the moment the picker is switched.
// The leg then fell through to the transfer-counterpart branch and was rewritten to the anchor's own
// amount: a ₹86 redemption on a ₹448 purchase silently became a ₹362 one.
//
// The fix is to identify the leg by the source the record ALREADY held, so it stays recognisable
// across the change, and then to treat every source change as one event with three outcomes. That is
// what lives here, as pure functions, because the interesting part is a decision table and a decision
// table is worth testing directly:
//
//   from            to              outcome
//   ─────────────── ─────────────── ──────────────────────────────────────────────
//   account A       account B       the leg moves to B (same redemption, new source)
//   account A       one-time / none the leg is deleted (nothing left to draw from)
//   one-time / none account B       a leg is created — see shouldCreateRewardLeg
//   account A       account A       the leg is synced in place, as it always was
//
// Creation is the form's job, not this module's: the leg is built there (id, date, category, links)
// and updateTransaction has never created one. Only the gate is here, so both halves of the same
// decision can be read — and tested — side by side.
import type { Account, Transaction } from '../types';
import { isExternalRewardSource, isPointsDenominated } from '../utils';

/** A real, debitable reward source: not empty, and not the untracked one-time sentinel. */
export const isDebitableRewardSource = (accountId?: string): accountId is string =>
  !!accountId && !isExternalRewardSource(accountId);

/** Legs that could be this split's redemption. Cashback legs are never one, and the anchor is not
 *  its own leg — a card redeeming its OWN points puts both on the same account, so the id is what
 *  separates them, not the account. */
const candidateLegs = (anchorId: string, linkedIds: string[], transactions: Transaction[]) =>
  transactions.filter(t => t.id !== anchorId && linkedIds.includes(t.id) && t.category !== 'Cashback');

const legOnAccount = (accountId: string | undefined, anchorId: string, linkedIds: string[], transactions: Transaction[]) =>
  accountId ? candidateLegs(anchorId, linkedIds, transactions).find(t => t.accountId === accountId) : undefined;

export type RewardLegTransition =
  /** Nothing to move or remove. Either there is no split, or its leg has yet to be built. */
  | { kind: 'none' }
  /** The source is gone (cleared, or now a one-time reward): delete this leg and unlink it. */
  | { kind: 'delete'; legId: string }
  /** This leg IS the redemption — retargeted or not — and these are the fields it must now carry. */
  | { kind: 'sync'; legId: string; patch: RewardLegPatch };

export interface RewardLegPatch {
  accountId: string;
  amount: number;
  description: string;
  /** What routes the leg into the POINTS ledger rather than the rupee one (see affectsRupeeBalance).
   *  Always recomputed against the new source: moving a redemption from a card's own points to a
   *  rupee wallet has to flip it, or the wallet is debited nothing at all. */
  isRewardTransaction: boolean;
}

/**
 * What must happen to a split's reward leg, given the anchor as it is being saved and as it was
 * stored. `storedAnchor` is the only place the PREVIOUS source can be read from, and is what makes a
 * switched source survivable.
 *
 * Call only when the anchor itself is being edited. A child leg's own edit form carries reconstructed
 * anchor fields so the modal reads correctly, and reading those as a source change would delete the
 * sibling leg.
 */
export function resolveRewardLegTransition(params: {
  anchor: Transaction;
  storedAnchor?: Transaction;
  transactions: Transaction[];
  accounts: Account[];
}): RewardLegTransition {
  const { anchor, storedAnchor, transactions, accounts } = params;

  const linkedIds = anchor.linkedTransactionIds
    || (anchor.linkedTransactionId ? [anchor.linkedTransactionId] : []);
  const prevSource = storedAnchor?.rewardUsedAccountId || '';
  const nextSource = anchor.rewardUsedAccountId || '';

  const stranded = (prevSource && prevSource !== nextSource)
    ? legOnAccount(prevSource, anchor.id, linkedIds, transactions)
    : undefined;

  // A one-time reward and a cleared split are the same thing to a leg: no account to draw from.
  if (stranded && !isDebitableRewardSource(nextSource)) {
    return { kind: 'delete', legId: stranded.id };
  }

  // Retarget where the source moved between two real accounts, otherwise the leg already sitting on
  // the current source (the ordinary same-source edit). Same path either way, so a move can never
  // diverge from a plain amount edit.
  const leg = stranded ?? legOnAccount(nextSource, anchor.id, linkedIds, transactions);
  if (!leg || !isDebitableRewardSource(nextSource)) return { kind: 'none' };

  const source = accounts.find(a => a.id === nextSource);
  const isCCPayment = anchor.category?.toLowerCase() === 'cc payment';
  return {
    kind: 'sync',
    legId: leg.id,
    patch: {
      accountId: nextSource,
      // Rupees on both sides — the points conversion lives in calculateBalance — so this is a copy.
      amount: Number(anchor.rewardUsed) || 0,
      // A CC leg's description names the card it paid and is set at creation; only a plain purchase's
      // tracks the anchor's description.
      description: isCCPayment ? leg.description : `Rewards applied to: ${anchor.description}`,
      isRewardTransaction: isPointsDenominated(source),
    },
  };
}

/**
 * Whether saving this form has to BUILD a reward leg. True for a new split, and — this is what was
 * missing — for an edit that gives an existing row a real source it did not have: switching off a
 * one-time reward, or adding a split to a row that never had one. Both used to record the redemption
 * on the anchor while the reward account was never debited.
 *
 * False when something is already serving as the leg. A source switched between two real accounts
 * still has its leg on the OLD account and `resolveRewardLegTransition` retargets that one, so both
 * the old and the new source are checked — building a second here would leave the split with two.
 */
export function shouldCreateRewardLeg(params: {
  editId?: string | null;
  /** The source now chosen in the form. */
  source?: string;
  /** The anchor's links as they stand mid-save. */
  linkedIds: string[];
  transactions: Transaction[];
}): boolean {
  const { editId, source, linkedIds, transactions } = params;
  if (!isDebitableRewardSource(source)) return false;
  if (!editId) return true;

  // Editing a child leg, not the anchor: the real reward leg hangs off the anchor rather than off
  // this row, so it is not in these links and would look absent every time.
  const isChildOfSplit = transactions.some(p =>
    p.id !== editId
    && (p.linkedTransactionIds || []).includes(editId)
    && !!p.rewardUsedAccountId
    && (p.rewardUsed || 0) > 0);
  if (isChildOfSplit) return false;

  const storedSource = transactions.find(t => t.id === editId)?.rewardUsedAccountId;
  const exists = !!legOnAccount(source, editId, linkedIds, transactions)
    || !!legOnAccount(storedSource, editId, linkedIds, transactions);
  return !exists;
}
