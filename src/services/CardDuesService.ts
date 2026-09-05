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
import { format, addMonths, setDate, startOfDay, differenceInCalendarDays, parseISO } from 'date-fns';
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
  /** What is STILL OWED on a closed cycle — the printed statement less what has been paid against
   *  it. Identical to `due`, and kept as a second name only because the dues, bills, dashboard and
   *  utilisation surfaces have always called it this. */
  statementAmount: number;
  /** Credits that SETTLE the bill rather than reduce it: CC payments and transfers into the card.
   *  A bank does not subtract these from the statement it prints — it prints the amount and then
   *  records what you paid against it. */
  settlement: number;
  /** Every other credit — cashback paid in rupees, refunds, reversals. A bank DOES net these into
   *  the statement, because they are adjustments to what you were charged rather than money you
   *  sent to clear it. This is the whole reason `payment` is not a single number any more. */
  credits: number;
  /** THE STATEMENT FIGURE, the way a bank generates one: spend less the credits above, then put
   *  through the card's rounding rule. Not `spend` — netting cashback in is what makes ₹2,832.40 of
   *  purchases against ₹1,293.48 of cashback print as ₹1,538 rather than ₹2,832. And not net of
   *  `settlement`, which is what `due` is for. */
  charged: number;
  /** What is still owed on the printed statement: `charged` less what has been paid against it.
   *  Deliberately derived from the ROUNDED figure rather than from raw arithmetic — the bank bills
   *  you ₹1,538 and you clear it by paying ₹1,538, and the 92 paise the rounding threw away must not
   *  come back as a balance. (`statementAmount` rounds in the other order and is left alone because
   *  the dues and utilisation surfaces are built on it.) */
  due: number;
  /** What `charged` would be with no hand-entered figure — what the sheet offers to reset to. */
  computed: number;
  /** True when `charged` is a hand-entered figure rather than a derived one. Every surface showing
   *  the figure has to be able to SAY so: a number that quietly disagrees with the ledger under it
   *  is the one thing worse than a number that is a rupee out. */
  adjusted: boolean;
  /** Something was billed on this cycle and it has been paid off. Distinguishes a settled cycle from
   *  an empty one, which a zero remainder alone cannot. */
  settled: boolean;
  /** Meaningfully more was paid against the statement than it billed. A stronger claim than
   *  `settled` and worth saying separately: the money is not lost, it sits as credit on the card,
   *  but a row that only said "settled" would give the user no reason to go looking for it. */
  overpaid: boolean;
}

/** How far past the statement a payment has to land before it counts as an OVERpayment.
 *
 *  A whole rupee, because the statement is rounded and what is paid against it is not. A ₹16,859.84
 *  bill rounds to ₹16,860 and gets cleared by ₹16,860.16 of payments — sixteen paise of residue from
 *  a returned transfer — and a bare `settlement > charged` read that as an overpayment and put a
 *  double tick on a perfectly ordinary settled statement. Nothing under a rupee is news. */
const OVERPAY_MIN = 1;
/** Float slack for the settled test alone: 0.1 + 0.2 is not 0.3, and a statement cleared to the
 *  paisa must not fail by a billionth. Far too small to forgive a real shortfall. */
const SETTLE_EPS = 0.005;

/** How much has to be left on a statement before the app calls it OVERDUE.
 *
 *  A whole rupee, mirroring OVERPAY_MIN, and for the same reason viewed from the other side:
 *  `charged` is rounded and what is paid against it is not. A bill the bank printed at ₹1,538.92
 *  rounds to ₹1,539, is cleared in full by ₹1,538, and leaves ₹1 of residue that nobody owes — and
 *  without a floor the new overdue band would announce it in red for as long as the card exists.
 *  Arrears are a statement you skipped, not a rounding remainder.
 *
 *  Strictly greater, because rounding can manufacture a residue of exactly ₹1.00.
 *
 *  IT GATES THE WORD, NOT THE ARITHMETIC. The floor used to drop the rupee out of the sum as well,
 *  which meant `outstanding` — the figure Accounts calls the card's balance — disagreed with the
 *  Statements screen showing the very same cycle still owing it, and a genuine ₹1 shortfall left
 *  the card's balance quietly light. Below the floor the money now lands in `residue`: counted in
 *  the total, never called overdue.
 *
 *  This is a SECOND line of defence, not the first. A cycle whose printed figure disagrees with the
 *  ledger is meant to be corrected outright by long-pressing the statement and entering what the
 *  bank actually charged (statementAdjustments), which drives the residue to zero rather than
 *  hiding it. The floor is here for the cycles nobody has got round to correcting. */
const ARREARS_MIN = 1;

/** Money sent to clear the bill, rather than anything that was bought or credited. These are the
 *  app's own "pure ledger movement" categories (see STATS_EXCLUDED_CATEGORIES); anything else on the
 *  card is either a purchase or an adjustment to one.
 *
 *  SIGNED BY DIRECTION, and that is the whole point. A credit here is money paid INTO the card; a
 *  debit is money the bank sent back OUT of it — a payment returned because it arrived before the
 *  purchase it was meant for had posted. The two legs are a matched pair that nets to nothing, and
 *  counting the return as a PURCHASE (which is what "every debit is spend" did) inflated both the
 *  month's spend and the statement by the size of the payment: ₹17,747 of tickets read as ₹35,247
 *  spent and a ₹34,359 bill. Neither number happened. */
const SETTLEMENT_CATEGORIES = new Set(['cc payment', 'transfer']);

export interface CardDues {
  account: Account;
  /** The latest closed statement. */
  billedCycle: string;
  /** The open cycle still accruing. Always the month after billedCycle. */
  unbilledCycle: string;
  billed: number;
  unbilled: number;
  /** Still owed on statements OLDER than billedCycle — see the long note in getCardDues. 0 for a
   *  card that has never missed one, which is why nothing had noticed it was missing. */
  overdue: number;
  /** Which cycles those are, oldest first, so a surface can name them rather than just total them.
   *  Empty whenever `overdue` is 0. */
  overdueCycles: string[];
  /** Arrears too small to call overdue — see ARREARS_MIN. Real money, and counted in `outstanding`,
   *  but deliberately kept out of `overdue` so no badge, banner or status pill fires over a rounding
   *  remainder. 0 on every card that has no uncorrected cycle, which is nearly all of them. */
  residue: number;
  /** overdue + residue + billed + unbilled — the figure Accounts calls the card's balance. */
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
  /** Summed across cards. Non-zero means at least one statement went a whole cycle unpaid. */
  overdue: number;
  /** Summed across cards. Sub-floor arrears — in `outstanding`, never called overdue. */
  residue: number;
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

/** Where a cycle stands, as one word. ONE ladder, shared by every surface that shows a statement:
 *  the Statements row draws an icon from it and the statement screen prints the label, and the two
 *  said different things — "Paid in full" against a green tick, "₹1,900 due" against a red triangle
 *  — for as long as each derived its own.
 *
 *  PRECEDENCE IS LOAD-BEARING, and it is the reason this is a ladder rather than a set of flags:
 *
 *  `open` is NOT on the ladder and cycleStatus never returns it: a cycle still accruing has not
 *  been billed, so none of the tests below apply to it and the caller that knows it is looking at
 *  the running cycle says so outright. It lives in this type because it is part of the same
 *  vocabulary — every surface that names a cycle's state should name that one the same way.
 *
 *  - `empty` first, because it is not a payment state at all. A month you did not use the card in
 *    has no balance to be early or late with, and every test below would read that zero as "paid".
 *  - `overdue` above `partial`: a cycle half cleared but a month past its date is a problem, and an
 *    "in progress" reading would bury it.
 *  - `overpaid` above `settled`, because settled is true of it too, and the weaker of two true
 *    statements is the wrong one to show. */
export type CycleStatus = 'open' | 'empty' | 'overdue' | 'overpaid' | 'settled' | 'partial' | 'unpaid';

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  open: 'Open',
  empty: 'Nothing billed',
  overdue: 'Overdue',
  overpaid: 'Overpaid',
  settled: 'Settled',
  partial: 'Partially paid',
  unpaid: 'Unpaid',
};

export const cycleStatus = (
  f: Pick<CardCycleFigures, 'charged' | 'due' | 'settled' | 'overpaid'>,
  overdue: boolean
): CycleStatus => {
  if (f.charged === 0) return 'empty';
  if (overdue) return 'overdue';
  if (f.overpaid) return 'overpaid';
  if (f.settled) return 'settled';
  return f.due < f.charged ? 'partial' : 'unpaid';
};

/** Whether a cycle's own due date has gone by. Only the latest closed statement can have a date
 *  still ahead — the card knows that one, and since getCardDues stopped rolling it forward past its
 *  own cycle, `daysToDue < 0` is a live test rather than the dead branch it used to be. Every OLDER
 *  cycle that still owes something is past due by construction: a newer statement has since been
 *  cut, so that one's date went by a month or more ago. */
export const isCycleOverdue = (dues: Pick<CardDues, 'billedCycle' | 'daysToDue'>, cycle: string, due: number) =>
  due > ARREARS_MIN
  && (cycle < dues.billedCycle || (cycle === dues.billedCycle && dues.daysToDue !== undefined && dues.daysToDue < 0));

/** The three running sums a cycle is built from, before any clamping or rounding. */
interface CycleTally { spend: number; settlement: number; credits: number; }

/** Fold one transaction into a tally.
 *
 *  Split out for the same reason the rest of this file exists: there are now TWO readers — one
 *  cycle, and every cycle at once — and a returned payment classified as spend on one path and as a
 *  negative settlement on the other would let a card's overdue total disagree with the statement
 *  screen showing the very same month. One classifier, so they cannot. */
const tally = (into: CycleTally, t: Transaction) => {
  if (SETTLEMENT_CATEGORIES.has((t.category || '').toLowerCase())) into.settlement += t.type === 'debit' ? -t.amount : t.amount;
  else if (t.type === 'debit') into.spend += t.amount;
  else into.credits += t.amount;
};

/** Tally → statement. Everything below this line is the arithmetic that was always here. */
const finalise = (account: Account, cycle: string, { spend, settlement, credits }: CycleTally): CardCycleFigures => {
  const payment = settlement + credits;
  // Unchanged by the signing above: moving a returned payment out of `spend` and into a negative
  // `settlement` shifts it across the minus sign, so `net` — and therefore the card's balance,
  // dues and utilisation — comes out exactly where it always did. Only the SPLIT changed.
  const net = spend - payment;
  const payable = Math.max(0, net);
  // A bank's rounding is not always the rule you told us about — it can differ by a rupee, or the
  // bank can simply change it — so a cycle may carry a hand-entered figure that wins outright. See
  // the note on statementAdjustments; `computed` is kept alongside so the sheet can offer it back.
  const computed = applyRounding(Math.max(0, spend - credits), account.statementRounding);
  const adjustment = account.statementAdjustments?.[cycle];
  const charged = adjustment ?? computed;
  const due = Math.max(0, charged - settlement);
  return {
    cycle, spend, payment, settlement, credits, net, payable,
    // ONE REMAINDER FOR THE WHOLE APP. This used to round the remainder — round(spend − credits −
    // payments) — while the statements screen rounded the BILL and subtracted payments from it. The
    // two agree whenever payments are whole rupees and diverge the moment one carries paise: a
    // ₹1,000.60 statement floored to ₹1,000 against a ₹500.50 payment is ₹499.50 owed, and the old
    // order reported ₹500, a figure nobody was ever charged. The bank rounds the bill, then you pay
    // against the rounded bill; that is the order, and now every screen uses it.
    statementAmount: due,
    charged,
    computed,
    adjusted: adjustment !== undefined,
    due,
    settled: charged > 0 && settlement >= charged - SETTLE_EPS,
    // Against something billed, deliberately: a lone credit landing in a month with no purchases is
    // almost always a payment logged into the wrong cycle, not an overpayment, and flagging it as
    // one would put a warning on the most ordinary mistake in the ledger.
    overpaid: charged > 0 && settlement - charged >= OVERPAY_MIN,
  };
};

/** The two sides of one cycle for one card. */
export const getCardCycleFigures = (
  account: Account,
  transactions: Transaction[],
  cycle: string
): CardCycleFigures => {
  const statementDay = account.statementDay || 1;
  const sums: CycleTally = { spend: 0, settlement: 0, credits: 0 };
  for (const t of transactions) {
    if (t.accountId !== account.id) continue;
    if (!affectsRupeeBalance(t)) continue;
    if (getAppliedBillingCycle(t, statementDay) !== cycle) continue;
    tally(sums, t);
  }
  return finalise(account, cycle, sums);
};

/**
 * EVERY cycle the card has, in one pass over the ledger.
 *
 * getCardDues needs an unbounded number of cycles now that it looks for unpaid older statements,
 * and calling getCardCycleFigures per cycle walks the whole transaction list once per month of the
 * card's history. The bill-alert banner calls getActiveCardDues on every render with no memo, so
 * that is cards × months × transactions on each paint.
 *
 * A cycle carrying only a hand-entered figure is included even with no transactions under it. That
 * is precisely the case where the user HAS recorded what the bank carried forward, and a map keyed
 * off the ledger alone would drop the one number they typed in themselves.
 */
export const getCardCycleFiguresByCycle = (
  account: Account,
  transactions: Transaction[]
): Map<string, CardCycleFigures> => {
  const statementDay = account.statementDay || 1;
  const sums = new Map<string, CycleTally>();
  const bucket = (cycle: string) => {
    let t = sums.get(cycle);
    if (!t) { t = { spend: 0, settlement: 0, credits: 0 }; sums.set(cycle, t); }
    return t;
  };
  for (const t of transactions) {
    if (t.accountId !== account.id) continue;
    if (!affectsRupeeBalance(t)) continue;
    tally(bucket(getAppliedBillingCycle(t, statementDay)), t);
  }
  for (const cycle of Object.keys(account.statementAdjustments ?? {})) bucket(cycle);
  const out = new Map<string, CardCycleFigures>();
  for (const [cycle, t] of sums) out.set(cycle, finalise(account, cycle, t));
  return out;
};

/**
 * The date the statement for `cycle` falls due.
 *
 * A cycle is named for the month its statement is CUT in: 2026-08 on a 20th statement day covers
 * 20 Jul – 19 Aug and prints on 20 Aug (getBillingCycleDates). The due day that follows is the next
 * dueDay STRICTLY after the cut — a card cut on the 20th and due on the 7th is due the 7th of the
 * next month; one cut on the 1st and due on the 20th is due that same month.
 *
 * Derived from the cycle rather than from today, which is the whole point: this can return a date
 * in the past, and a due date that is allowed to be behind us is what makes "overdue" expressible.
 */
export const getCycleDueDate = (cycle: string, statementDay: number, dueDay: number): Date => {
  const cut = setDate(parseISO(`${cycle}-01`), statementDay);
  const due = setDate(cut, dueDay);
  return due <= cut ? addMonths(due, 1) : due;
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

  const billedCycle = getLatestBilledCycle(statementDay, now);
  // The open cycle, by the same helper every other surface uses. Equal to billedCycle + 1 month;
  // derived from today rather than by adding a month so the two can't drift if that helper changes.
  const unbilledCycle = getBillingCycleForDate(todayStr, statementDay);

  // One pass for every cycle rather than one pass per cycle — see getCardCycleFiguresByCycle. A
  // cycle with no transactions and no adjustment is absent from the map and owes nothing, which is
  // what the missing figures object used to compute the long way round.
  const figures = getCardCycleFiguresByCycle(account, transactions);

  // Rounded on the closed side, raw on the open one — see the note on rounding above.
  const billed = figures.get(billedCycle)?.statementAmount ?? 0;
  const unbilled = figures.get(unbilledCycle)?.payable ?? 0;

  // WHAT AN UNPAID STATEMENT DOES ONCE THE NEXT ONE IS CUT — and why this is a third component of
  // the balance rather than a display flag.
  //
  // This service used to hold that a card owes exactly `billed + unbilled` and nothing older,
  // on the grounds that "an unpaid older statement rolls into the next one as a real posting, so it
  // is already counted". A BANK does that. This app does not: `charged` is derived from the
  // transactions the user entered inside the cycle, and nobody enters the previous balance the bank
  // carried forward. So on the morning a new statement was cut, an unpaid one stopped being billed,
  // stopped being unbilled, and left the card's outstanding, its utilisation and the Bills screen
  // without so much as changing colour on the way out. The only place it survived was the
  // Statements list, which is the screen you go to when you already know something is wrong.
  //
  // Oldest first, so a caller can name the months instead of only totalling them.
  const overdueCycles: string[] = [];
  let overdue = 0;
  let residue = 0;
  for (const cycle of [...figures.keys()].sort()) {
    if (cycle >= billedCycle) continue;
    const due = figures.get(cycle)!.due;
    if (due <= 0) continue;
    // Two questions, and the floor only answers the second: is this money, and is it worth
    // alarming about. `continue` here answered both at once and so lost the rupee from the total.
    if (due <= ARREARS_MIN) { residue += due; continue; }
    overdueCycles.push(cycle);
    overdue += due;
  }

  const outstanding = overdue + residue + billed + unbilled;

  const dues: CardDues = {
    account,
    billedCycle,
    unbilledCycle,
    billed,
    unbilled,
    overdue,
    overdueCycles,
    residue,
    outstanding,
  };

  if (account.dueDay) {
    const today = startOfDay(now);
    // THE DATE THE LATEST STATEMENT FALLS DUE — not the next dueDay on the calendar.
    //
    // Those two agree right up until you miss a payment, and then they part company in the worst
    // available direction. This was `setDate(today, dueDay)` rolled forward once it had passed,
    // which floors `daysToDue` at zero and makes a due date behind us unrepresentable: the morning
    // after you missed a bill the row went from "Due today" to "In 30 days" while still showing the
    // money you had not paid. Every `daysToDue < 0` branch downstream — the Bills card's overdue
    // styling, duePhrase, dueSentence, the alert banner's overdue count — was unreachable.
    //
    // Taken from the CYCLE instead, so it sits where the bank put it and is allowed to be in the
    // past. The calendar answer is kept for a SETTLED card: nothing is owed, so there is no date to
    // be late for, and the honest reading of "next due" is the next time this card's day comes
    // round. That is also the behaviour every surface has always shown for a paid card.
    let dueDate = getCycleDueDate(billedCycle, statementDay, account.dueDay);
    if (billed <= 0) {
      dueDate = setDate(today, account.dueDay);
      if (dueDate < today) dueDate = addMonths(dueDate, 1);
    }
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
      overdue: acc.overdue + d.overdue,
      residue: acc.residue + d.residue,
      outstanding: acc.outstanding + d.outstanding,
      creditLimit: acc.creditLimit + (d.creditLimit || 0),
    }),
    { billed: 0, unbilled: 0, overdue: 0, residue: 0, outstanding: 0, creditLimit: 0 }
  );
  // Utilization only over cards that declare a limit — dividing the whole outstanding by a partial
  // limit would report a fraction of a denominator that doesn't cover it.
  if (totals.creditLimit > 0) {
    const covered = dues.filter(d => d.creditLimit).reduce((s, d) => s + d.outstanding, 0);
    totals.utilization = covered / totals.creditLimit;
  }
  return totals;
};
