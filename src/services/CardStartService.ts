// ── Where a credit card STANDS on the day it is added ────────────────────────────────────────────
//
// A card is rarely added on the day it is issued. By then it has a bill out (paid or not), spends
// since that bill, and — if its annual fee is waived on spend — a year's progress towards the waiver.
// None of that is in the ledger, and every card screen is built from the ledger, so a card added
// with one "opening balance" figure used to show nothing owed at all: Cards, Bills and the Accounts
// tile all derive their dues from transactions, and the figure only ever reached Ask Vault.
//
// So the add form asks three things, and each lands where the screens already look:
//
//   Last bill, still due  → a hand-entered statement figure on the latest CLOSED cycle
//                           (statementAdjustments, the same thing a long-press on a statement
//                           writes). It is then billed, due on the card's due day, overdue once that
//                           passes, and cleared by a CC Payment applied to the previous statement.
//   Unbilled spends       → ONE ledger row on the card dated today, in the "Opening Balance"
//                           category. It is real money owed, so it counts in unbilled and rolls into
//                           the next bill with everything else; it is not a known purchase, so it
//                           stays out of Spends and Insights (STATS_EXCLUDED_CATEGORIES) and out of
//                           the fee-waiver count (the third answer already covers it).
//   Spent this card year  → spendBeforeTracking on the card: the TOTAL spent so far this card year,
//                           bill and unbilled included. CardYearService adds it to the year and
//                           lifetime spend, and ignores logged spends dated before it so a purchase
//                           back-filled later is not counted twice.
//
// Pure, so the whole decision can be tested without the form.
import { format, parseISO, setDate } from 'date-fns';
import type { Transaction } from '../types';
import { generateId, getLatestBilledCycle } from '../utils';

export const OPENING_BALANCE_CATEGORY = 'Opening Balance';

/** The row carrying a card's unbilled spends from before it was tracked. */
export const isOpeningBalanceEntry = (t: Pick<Transaction, 'category'>) =>
  (t.category || '').toLowerCase() === OPENING_BALANCE_CATEGORY.toLowerCase();

/** The bill the form's first question is about: the latest statement already cut, and the day it
 *  was cut — which is also the day the unbilled spends in the second question start from. */
export const lastBillOf = (statementDay: number, now: Date = new Date()) => {
  const cycle = getLatestBilledCycle(statementDay, now);
  // The same arithmetic getBillingCycleDates uses for the cut date, so the label names the day the
  // statement screen will show for this cycle.
  const cutOn = setDate(parseISO(`${cycle}-01`), statementDay);
  return { cycle, cutOn };
};

export interface CardStartInput {
  /** Still owed on the last bill. 0 when it is paid. */
  billed: number;
  /** Spent since the last bill was cut. */
  unbilled: number;
  /** Total spent this card year up to today, bill and unbilled included. Absent when not asked. */
  spentThisYear?: number;
}

export interface CardStartPlan {
  /** The current month's opening balance: what was owed before anything logged this month. */
  openingBalance: number;
  /** The billed figure, keyed by its cycle. Absent when nothing is due. */
  statementAdjustments?: Record<string, number>;
  /** The unbilled row. Absent when nothing is unbilled. */
  openingEntry?: Transaction;
  spendBeforeTracking?: { amount: number; asOf: string };
}

const money = (n: number | undefined) => Math.round(Math.max(0, Number(n) || 0) * 100) / 100;

export const planCardStart = (
  card: { id: string; statementDay: number },
  input: CardStartInput,
  now: Date = new Date(),
): CardStartPlan => {
  const today = format(now, 'yyyy-MM-dd');
  const billed = money(input.billed);
  const unbilled = money(input.unbilled);
  const spent = money(input.spentThisYear);
  const { cycle } = lastBillOf(card.statementDay, now);

  return {
    // The unbilled row is dated today, inside this month, so it reaches the card's balance through
    // the month's own movement; the opening is the bill alone. Together they equal what Cards shows
    // as outstanding.
    openingBalance: billed,
    statementAdjustments: billed > 0 ? { [cycle]: billed } : undefined,
    openingEntry: unbilled > 0
      ? {
        id: generateId(),
        date: today,
        description: 'Unbilled spends before tracking',
        accountId: card.id,
        type: 'debit',
        amount: unbilled,
        category: OPENING_BALANCE_CATEGORY,
        isRecurring: false,
      }
      : undefined,
    spendBeforeTracking: spent > 0 ? { amount: spent, asOf: today } : undefined,
  };
};
