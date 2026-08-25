// ── What a card has earned but not yet paid out ──────────────────────────────────────────────────
//
// Lifted out of Cashback.tsx when the Cards tree grew a Rewards category. The tree's row and hero
// need the same figures the vault screen shows, and a second derivation of "what's pending" would
// diverge from it the first time either changed — the same reason CardDuesService exists.
//
// A REWARD IS NOT ALWAYS RUPEES. A card can pay in its own unit (Jewels, EDGE points, …), declared
// on the card or on the account the reward is deposited into, with a conversion rate beside it.
// Summing units into one figure would be arithmetic on incompatible things, so summarisePending
// keeps rupees apart from every other unit and never converts between them.
import type { Account, CashbackStatement, Transaction } from '../types';

/**
 * One reward-earning transaction together with the statement state tracked against it.
 *
 * Rebuilt from data.transactions on every render, then keyed by transaction id, grouped into
 * billing-cycle buckets, and passed around by the confirm/consolidate handlers — which is why it is
 * named rather than repeated inline at each of them.
 */
export interface RewardRow {
  expected: number;
  realized: number;
  confirmed: boolean;
  statementId: string | null;
  transaction: Transaction;
  account: Account;
  /**
   * Where the reward was deposited. Absent on a freshly built row — the merge from
   * data.cashbackStatements below copies realized/confirmed/statementId but not this — and grafted
   * on in-place by the confirm handlers so consolidation can read back the target they just used
   * without waiting for the next render.
   */
  realizedIntoAccountId?: string;
}

/**
 * The reward unit a card pays in, and what one of them is worth. An empty unit means rupees.
 *
 * The card's own declaration wins; failing that, the account the reward is deposited into decides —
 * a card that sweeps its cashback into a points wallet pays in that wallet's unit.
 */
export const getRewardUnit = (account: Account | undefined, accounts: Account[]): { unit: string; rate: number } => {
  if (!account) return { unit: '', rate: 1 };
  if (account.rewardUnit) {
    return { unit: account.rewardUnit, rate: account.pointsConversionRate || 1 };
  }
  if (account.cashbackDestinationAccountId) {
    const dest = accounts.find(a => a.id === account.cashbackDestinationAccountId);
    if (dest && dest.rewardUnit) {
      return { unit: dest.rewardUnit, rate: dest.pointsConversionRate || 1 };
    }
  }
  return { unit: '', rate: 1 };
};

/** Every reward-earning spend, keyed by transaction id, with any tracked statement merged in. */
export const buildRewardRows = (
  transactions: Transaction[],
  accounts: Account[],
  cashbackStatements?: CashbackStatement[]
): Record<string, RewardRow> => {
  const rows: Record<string, RewardRow> = {};

  transactions.forEach(tx => {
    const account = accounts.find(a => a.id === tx.accountId);
    // Deleting an account archives it rather than removing it, so a reward transaction should always
    // resolve one. Skip the row if it somehow doesn't: every consumer reads row.account.name/.id/
    // .statementDay unguarded, so an orphan would blank the whole screen.
    if (!account) return;

    // Only "Delayed" rewards, or legacy expectedCashback that isn't instant.
    const isDelayed = tx.rewardEarnedType === 'delayed' || (!tx.rewardEarnedType && (tx.expectedCashback || 0) > 0);

    if (isDelayed && tx.type === 'debit' && tx.category !== 'Transfer' && tx.category !== 'CC Payment' && tx.category !== 'NCMC Travel Recharge' && !tx.isTravelTransaction) {
      // The expectation is whatever the editor computed and stored — never re-derived here. The log
      // form applies the chosen Cashback Mode's rate (a named level, or the card default) and
      // deliberately computes ZERO when no mode is chosen, so a 0 here means "this spend earns
      // nothing", not "nobody worked it out yet".
      //
      // This used to fall back to the card's defaultCashbackRate whenever expected was 0, which
      // manufactured an estimate the editor had explicitly declined: a ₹362 recharge on a 5% card
      // showed 18 Jewels pending while its own Cashback Mode read "None". The fallback never did
      // serve the legacy rows it was written for either — those qualify through the
      // `!rewardEarnedType && expectedCashback > 0` clause above, so expected is already non-zero.
      const expected = tx.rewardEarned || tx.expectedCashback || 0;

      if (expected > 0) {
        rows[tx.id] = {
          expected,
          realized: 0,
          confirmed: false,
          statementId: null,
          transaction: tx,
          account,
        };
      }
    }
  });

  cashbackStatements?.forEach(s => {
    const txId = s.billingCycleYearMonth;
    if (rows[txId]) {
      rows[txId].realized = s.realized;
      rows[txId].confirmed = s.confirmed;
      rows[txId].statementId = s.id;
    }
  });

  return rows;
};

export interface PendingRewards {
  /** How many rewards are still waiting to be confirmed as credited. */
  count: number;
  /** Pending rupees. Cards that pay in a unit are NOT converted into this. */
  rupees: number;
  /** Pending amounts per non-rupee unit, largest first. */
  byUnit: { unit: string; amount: number }[];
}

/** What is still owed to the user, by unit. */
export const summarisePendingRewards = (rows: RewardRow[], accounts: Account[]): PendingRewards => {
  const units = new Map<string, number>();
  let rupees = 0;
  let count = 0;

  for (const row of rows) {
    if (row.confirmed) continue;
    count += 1;
    const { unit } = getRewardUnit(row.account, accounts);
    if (!unit) rupees += row.expected;
    else units.set(unit, (units.get(unit) ?? 0) + row.expected);
  }

  return {
    count,
    rupees,
    byUnit: [...units.entries()].map(([unit, amount]) => ({ unit, amount })).sort((a, b) => b.amount - a.amount),
  };
};
