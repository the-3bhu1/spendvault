// ── What a credit card owes, derived in exactly one place ────────────────────────────────────────
//
// Before this file, four screens answered "what's billed?" with three different implementations:
//
//   • Accounts read calculateCycleBalanceForCycle (utils.ts), which filters affectsRupeeBalance.
//   • Bills and the bill-alert banner read calculateTotalSpendPerCycle (utils.ts), which does NOT.
//   • The Dashboard hand-rolled its own loop inline, which filters it AND clamps each side at zero.
//
// The first two genuinely disagreed. For a card redeeming its OWN points, the redemption leg draws on
// the reward wallet rather than the credit line, so counting it as a rupee charge reports the full
// purchase price as outstanding — see the note on affectsRupeeBalance. Accounts and the Dashboard
// excluded it; Bills and the alert banner counted it, and therefore overstated the bill on precisely
// the cards where reward splits are most used.
//
// Everything that asks about a card's dues now asks here, so the answer can only be one number.
//
// SEMANTICS, all deliberate:
//
//   Rupee legs only. A travel-purse or reward-points leg is a different balance on the same account
//   and belongs to neither side of a statement.
//
//   Cycle by APPLIED, not natural. getAppliedBillingCycle honours the statement screen's long-press
//   move, so a charge the bank actually billed a cycle late sits where the user recorded it.
//
//   Clamp, then round — and round the CLOSED cycle only. A fully-paid or overpaid cycle owes nothing,
//   so each side is floored at zero before any rounding: 'floor' on a −₹3.20 net would otherwise
//   report −₹4 due. `net` keeps the true signed figure for callers that want to show a credit balance.
//   statementRounding then applies to `billed` and NOT to `unbilled`, because it describes how the
//   bank rounds a statement it has actually printed. The open cycle has no statement yet, and
//   rounding a running total would make it drift by up to a rupee on every new charge. This matches
//   what the Dashboard did inline and what Accounts does — a parity test pins it.
//
//   Billed is the latest CLOSED cycle; unbilled is the open one. Those are adjacent by construction
//   (getLatestBilledCycle is the current cycle minus a month), and the assertion is worth stating
//   because a card's "outstanding" is the sum of exactly those two and nothing older: an unpaid
//   older statement rolls into the next one as a real posting, so it is already counted.
//
//   Due dates compare by CALENDAR DAY. Both Bills screens previously rolled the due date forward
//   whenever `dueDate < new Date()`, which is true from 00:00 onward on the due date itself — so a
//   bill due today silently advertised itself as due next month, and an overdue-today bill never
//   read as overdue.
import { format, addMonths, setDate, startOfDay, differenceInCalendarDays } from 'date-fns';
import type { Account, Transaction, RoundingRule } from '../types';
import {
  affectsRupeeBalance,
  getAppliedBillingCycle,
  getBillingCycleForDate,
  getLatestBilledCycle,
  getOrdinalSuffix,
} from '../utils';

/** One card, one billing cycle. */
export interface CardCycleFigures {
  cycle: string;
  /** Rupee debits applied to this cycle. */
  spend: number;
  /** Rupee credits applied to this cycle — payments, refunds, cashback paid in rupees. */
  payment: number;
  /** spend − payment, unclamped and unrounded. Negative means the cycle is overpaid. */
  net: number;
  /** What's owed: net floored at zero. NOT rounded — see `statementAmount`. */
  payable: number;
  /** `payable` put through the card's rounding rule. Only meaningful for a CLOSED cycle. */
  statementAmount: number;
}

export interface CardDues {
  account: Account;
  /** The latest closed statement. */
  billedCycle: string;
  /** The open cycle still accruing. Always the month after billedCycle. */
  unbilledCycle: string;
  billed: number;
  unbilled: number;
  /** billed + unbilled — the figure Accounts calls the card's balance. */
  outstanding: number;
  dueDay?: number;
  /** '5th', for prose. */
  dueDayStr?: string;
  /** The next occurrence of dueDay, today included. Absent when the card has no dueDay. */
  dueDate?: string;
  /** 0 means due today; negative means overdue. Absent when the card has no dueDay. */
  daysToDue?: number;
  creditLimit?: number;
  /** outstanding / creditLimit, as a fraction. Absent unless a positive limit is set. */
  utilization?: number;
}

export interface DuesTotals {
  billed: number;
  unbilled: number;
  outstanding: number;
  /** Summed across cards that declare a limit. 0 when none do. */
  creditLimit: number;
  /** Absent unless at least one card declares a limit. */
  utilization?: number;
}

const applyRounding = (value: number, rounding: RoundingRule = 'none') => {
  if (rounding === 'round') return Math.round(value);
  if (rounding === 'floor') return Math.floor(value);
  if (rounding === 'ceil') return Math.ceil(value);
  return value;
};

/** The two sides of one cycle for one card. */
export const getCardCycleFigures = (
  account: Account,
  transactions: Transaction[],
  cycle: string
): CardCycleFigures => {
  const statementDay = account.statementDay || 1;
  let spend = 0;
  let payment = 0;

  for (const t of transactions) {
    if (t.accountId !== account.id) continue;
    if (!affectsRupeeBalance(t)) continue;
    if (getAppliedBillingCycle(t, statementDay) !== cycle) continue;
    if (t.type === 'debit') spend += t.amount;
    else payment += t.amount;
  }

  const net = spend - payment;
  const payable = Math.max(0, net);
  return { cycle, spend, payment, net, payable, statementAmount: applyRounding(payable, account.statementRounding) };
};

/**
 * Everything one card owes right now. `now` is injectable so a caller can ask about a fixed
 * moment — and so this is testable without freezing the clock.
 */
export const getCardDues = (
  account: Account,
  transactions: Transaction[],
  now: Date = new Date()
): CardDues => {
  const statementDay = account.statementDay || 1;
  const todayStr = format(now, 'yyyy-MM-dd');

  const billedCycle = getLatestBilledCycle(statementDay);
  // The open cycle, by the same helper every other surface uses. Equal to billedCycle + 1 month;
  // derived from today rather than by adding a month so the two can't drift if that helper changes.
  const unbilledCycle = getBillingCycleForDate(todayStr, statementDay);

  // Rounded on the closed side, raw on the open one — see the note on rounding above.
  const billed = getCardCycleFigures(account, transactions, billedCycle).statementAmount;
  const unbilled = getCardCycleFigures(account, transactions, unbilledCycle).payable;
  const outstanding = billed + unbilled;

  const dues: CardDues = {
    account,
    billedCycle,
    unbilledCycle,
    billed,
    unbilled,
    outstanding,
  };

  if (account.dueDay) {
    const today = startOfDay(now);
    // This month's due date, rolled forward only once it has actually PASSED — a due date of today
    // stays today, at 0 days left.
    let dueDate = setDate(today, account.dueDay);
    if (dueDate < today) dueDate = addMonths(dueDate, 1);
    dues.dueDay = account.dueDay;
    dues.dueDayStr = getOrdinalSuffix(account.dueDay);
    dues.dueDate = format(dueDate, 'yyyy-MM-dd');
    dues.daysToDue = differenceInCalendarDays(dueDate, today);
  }

  if (account.creditLimit && account.creditLimit > 0) {
    dues.creditLimit = account.creditLimit;
    dues.utilization = outstanding / account.creditLimit;
  }

  return dues;
};

/**
 * Every live credit card, ordered by what's most urgent: soonest due date first, then by size.
 * Archived cards are excluded — they're hidden from balances everywhere else too.
 */
export const getActiveCardDues = (
  accounts: Account[],
  transactions: Transaction[],
  now: Date = new Date()
): CardDues[] =>
  accounts
    .filter(a => a.type === 'credit_card' && !a.archived)
    .map(a => getCardDues(a, transactions, now))
    .sort((a, b) => {
      // A card with no due day can't be ranked by urgency, so it sorts after those that can.
      const ad = a.daysToDue ?? Number.MAX_SAFE_INTEGER;
      const bd = b.daysToDue ?? Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      return b.outstanding - a.outstanding;
    });

export const sumCardDues = (dues: CardDues[]): DuesTotals => {
  const totals = dues.reduce<DuesTotals>(
    (acc, d) => ({
      billed: acc.billed + d.billed,
      unbilled: acc.unbilled + d.unbilled,
      outstanding: acc.outstanding + d.outstanding,
      creditLimit: acc.creditLimit + (d.creditLimit || 0),
    }),
    { billed: 0, unbilled: 0, outstanding: 0, creditLimit: 0 }
  );
  // Utilization only over cards that declare a limit — dividing the whole outstanding by a partial
  // limit would report a fraction of a denominator that doesn't cover it.
  if (totals.creditLimit > 0) {
    const covered = dues.filter(d => d.creditLimit).reduce((s, d) => s + d.outstanding, 0);
    totals.utilization = covered / totals.creditLimit;
  }
  return totals;
};
