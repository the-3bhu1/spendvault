import { format, parseISO, addMonths, subMonths, addDays, setDate, differenceInCalendarDays } from 'date-fns';
import type { Account, Transaction, CardNetwork, CashbackStatement, SplitItem, InvestmentKind, RecurringBill, RewardSplitLeg, BrandKey } from './types';

/**
 * The message carried by a thrown value, if it has one.
 *
 * A `catch` binding is `unknown` — anything can be thrown. Real `Error`s carry a
 * message, and so do the plain `{ message }` objects the Capacitor plugins and
 * the Gemini fetch layer reject with, which is why this duck-types rather than
 * testing `instanceof Error`. Returns undefined when there is no message to
 * show, so callers keep supplying their own fallback copy:
 *
 *   setError(errorMessage(err) || 'Unknown error')
 */
export function errorMessage(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return undefined;
}

/**
 * Rolls a recurring bill to its next occurrence. A recurring bill has no settled state — every
 * way of satisfying one (the PAID button, LOG, or LINKing an existing transaction) advances the
 * due date instead, so the countdown is always the bill's status.
 *
 * Advances from nextDueDate, not from today: paying the 90-day recharge on its Aug 30 due date
 * lands on Nov 28, keeping the cycle anchored even when the payment is early or late.
 */
export function advanceBillCycle(bill: RecurringBill, paidOn: Date = new Date()): RecurringBill {
  const due = parseISO(bill.nextDueDate);
  let next: Date;

  switch (bill.frequency) {
    case 'daily': next = addDays(due, 1); break;
    case 'weekly': next = addDays(due, 7); break;
    case 'monthly': next = addMonths(due, 1); break;
    case 'quarterly': next = addMonths(due, 3); break;
    case 'half_yearly': next = addMonths(due, 6); break;
    case 'yearly': next = addMonths(due, 12); break;
    case 'custom': next = addDays(due, bill.customDays || 1); break;
    default: next = addMonths(due, 1);
  }

  return {
    ...bill,
    nextDueDate: format(next, 'yyyy-MM-dd'),
    lastPaidDate: format(paidOn, 'yyyy-MM-dd')
  };
}

// The canonical investment category name. Investment transactions (mutual funds, stocks,
// commodities, SIPs) are consolidated under "Investments". Stored data is migrated on load
// (see FinanceContext), but isInvestmentCategory() also accepts legacy category spellings.
export const INVESTMENT_CATEGORY = 'Investments';

const INVESTMENT_CATEGORY_ALIASES = new Set([
  INVESTMENT_CATEGORY.toLowerCase(),
  'investment',
  'mutual funds',
  'stocks',
  'commodity',
  'sip',
  'sip / mutual funds',
]);
export const isInvestmentCategory = (category?: string) =>
  INVESTMENT_CATEGORY_ALIASES.has((category || '').toLowerCase());

// ---- Investment sub-kinds -------------------------------------------------------------------
// One category, three behaviours. Mutual funds, stocks and commodity all log under 'Investments'
// but each needs its own quantity field (units / shares / grams), its own valid account type and
// its own auto-description, so every one of those decisions keys off the kind — never off the
// category, which no longer distinguishes them.
export const INVESTMENT_KIND_OPTIONS: { id: InvestmentKind; name: string; subtext: string }[] = [
  { id: 'mutual_funds', name: 'Mutual Funds', subtext: 'SIP / Lumpsum · Units Allotted' },
  { id: 'stocks', name: 'Stocks', subtext: 'Equity Buy / Sell · No. Of Shares' },
  { id: 'commodity', name: 'Commodity', subtext: 'Digital Gold / Silver · Grams' },
];

export const investmentKindLabel = (kind?: InvestmentKind) =>
  INVESTMENT_KIND_OPTIONS.find(o => o.id === kind)?.name || 'Investment';

// The account type that holds each kind. Reversing this map is how a legacy investment transaction
// (written before investmentKind existed) tells us what it was.
const INVESTMENT_KIND_ACCOUNT_TYPES: Record<InvestmentKind, string> = {
  mutual_funds: 'mutual_funds',
  stocks: 'stocks',
  commodity: 'commodity',
};
export const investmentAccountTypeFor = (kind: InvestmentKind) => INVESTMENT_KIND_ACCOUNT_TYPES[kind];
export const investmentKindForAccountType = (accountType?: string): InvestmentKind | undefined =>
  (Object.keys(INVESTMENT_KIND_ACCOUNT_TYPES) as InvestmentKind[])
    .find(k => INVESTMENT_KIND_ACCOUNT_TYPES[k] === accountType);

// First investment account among the given ids decides the kind. Used both for live form state
// (main account or counterpart, whichever is the investment side) and for the load-time backfill.
export const inferInvestmentKind = (
  accountIds: (string | undefined)[],
  accounts: Account[]
): InvestmentKind | undefined => {
  for (const id of accountIds) {
    if (!id) continue;
    const kind = investmentKindForAccountType(accounts.find(a => a.id === id)?.type);
    if (kind) return kind;
  }
  return undefined;
};

// The kind an investment transaction is for, or undefined if it isn't an investment at all.
// Prefers the stored field and falls back to inferring from the accounts on the transaction, so
// pre-existing rows keep showing their specialized fields even if the backfill couldn't reach them.
export const getInvestmentKind = (
  tx: Pick<Transaction, 'category' | 'investmentKind' | 'accountId' | 'paymentSourceAccountId'>,
  accounts: Account[]
): InvestmentKind | undefined => {
  if (!isInvestmentCategory(tx.category)) return undefined;
  return tx.investmentKind || inferInvestmentKind([tx.accountId, tx.paymentSourceAccountId], accounts);
};

// Categories that never count toward Spends/Income stats: pure ledger movements (transfers, CC bill
// payments, NCMC recharges), investments tracked separately (investments, mutual funds/stocks/commodity), and
// lending & borrowing (money lent out or borrowed isn't a real spend/income — it's expected back).
// Single source of truth so every stats surface (Dashboard, Insights, Transactions) stays in sync.
export const STATS_EXCLUDED_CATEGORIES = new Set([
  'transfer', 'cc payment', 'ncmc travel recharge', 'investments', 'investment', 'mutual funds', 'sip', 'stocks', 'commodity', 'lending & borrowing'
]);
export const isStatsExcludedCategory = (category: string) =>
  STATS_EXCLUDED_CATEGORIES.has((category || '').toLowerCase());

// The part of a transaction's amount that counts toward Spends/Income. A Passive Log carves out
// either the whole amount or a stated portion of it (see Settings' explainer), and every stats
// surface has to apply the same carve-out or two screens will disagree about the same month.
// Pairs with isStatsExcludedCategory: that one drops the row entirely, this one shrinks it.
export const statsAmount = (tx: Pick<Transaction, 'amount' | 'excludedAmount' | 'excludeFromStats'>) =>
  tx.amount - (tx.excludedAmount || (tx.excludeFromStats ? tx.amount : 0));

// Determines whether a transaction is counted towards monthly transaction count totals.
// System categories (transfers, cc payment, investments, etc.), cashback auto logs,
// reward split legs, and fully passive transactions (where 100% of the amount is excluded)
// are not counted. Partially passive transactions (where only a portion is excluded) ARE counted.
export const isCountableTransaction = (tx: Transaction) => {
  const catLower = (tx.category || '').toLowerCase();
  // Scenario 1, 2, 3: Transfer, CC Payment, Investments, NCMC Travel Recharge
  if (['transfer', 'cc payment', 'ncmc travel recharge'].includes(catLower) || isInvestmentCategory(catLower)) {
    return false;
  }
  // Scenario 4: Cashback auto log
  if (catLower === 'cashback') {
    return false;
  }
  // Scenario 5: Reward Split auto log
  if (tx.isRewardTransaction) {
    return false;
  }
  // Scenario 6: Fully passive transactions (excludeFromStats is true and 100% of the amount is excluded)
  if (tx.excludeFromStats) {
    const isFullyPassive = tx.excludedAmount === undefined || tx.excludedAmount >= tx.amount;
    if (isFullyPassive) {
      return false;
    }
  }
  return true;
};

// ---- Split settlement math ----------------------------------------------------------------
// 'me' is the self key used across split items (paidBy/shares); everything else is a friend name.
export const splitDisplayName = (key: string) => (key === 'me' ? 'Me' : key);

export interface SplitSettlement { from: string; to: string; amount: number; }

// Net balance per participant (including the self key 'me') across a set of split items.
// Positive = they should RECEIVE money; negative = they OWE money. Unlike the old me-centric
// calculation, this tracks EVERY participant, so a friend paying for another friend's share is
// captured instead of silently dropped — which is what a correct "who owes whom" needs.
export const computeSplitNetBalances = (items: SplitItem[]): Record<string, number> => {
  const net: Record<string, number> = {};
  const bump = (k: string, v: number) => { net[k] = (net[k] || 0) + v; };
  items.forEach(item => {
    const participants = item.includeMe ? [...item.involvedPeople, 'me'] : [...item.involvedPeople];
    if (participants.length === 0 || !(item.amount > 0)) return;
    const isUnequal = item.splitType === 'unequal';
    const payer = item.paidBy || 'me';
    bump(payer, item.amount); // the payer fronted the whole bill
    participants.forEach(p => {
      const share = isUnequal ? (item.shares?.[p] ?? 0) : (item.amount / participants.length);
      bump(p, -share); // each participant consumed their share
    });
  });
  Object.keys(net).forEach(k => { net[k] = Math.round(net[k] * 100) / 100; });
  return net;
};

// Greedy debt simplification: collapse net balances into a minimal-ish set of "from pays to"
// transfers so everyone settles in as few payments as possible (largest debtor pays largest
// creditor each step). This is what turns a pile of shared bills into "X pays Y ₹Z".
export const simplifyDebts = (net: Record<string, number>): SplitSettlement[] => {
  const creditors = Object.entries(net).filter(([, v]) => v > 0.005).map(([p, v]) => ({ p, v }));
  const debtors = Object.entries(net).filter(([, v]) => v < -0.005).map(([p, v]) => ({ p, v: -v }));
  creditors.sort((a, b) => b.v - a.v);
  debtors.sort((a, b) => b.v - a.v);
  const settlements: SplitSettlement[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].v, creditors[j].v);
    settlements.push({ from: debtors[i].p, to: creditors[j].p, amount: Math.round(amount * 100) / 100 });
    debtors[i].v -= amount;
    creditors[j].v -= amount;
    if (debtors[i].v < 0.005) i++;
    if (creditors[j].v < 0.005) j++;
  }
  return settlements;
};

export const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const getOrdinalSuffix = (d: number): string => {
  const j = d % 10, k = d % 100;
  if (j === 1 && k !== 11) return `${d}st`;
  if (j === 2 && k !== 12) return `${d}nd`;
  if (j === 3 && k !== 13) return `${d}rd`;
  return `${d}th`;
};

export const formatDateString = (dateStr: string) => {
  if (!dateStr) return '';
  // Extract just the date part if it's a full ISO string (e.g. 2026-05-13T00:00:00.000Z)
  const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const parts = cleanDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
};

export const formatCurrency = (amount: number) => {
  let cleanAmount = amount;
  if (Math.round(amount * 100) / 100 === 0) {
    cleanAmount = 0;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(cleanAmount);
};

export const formatAmount = (amount: number, account?: Account) => {
  if (account && account.type === 'rewards' && account.rewardUnit) {
    /* `amount` is RUPEES here, as it is on every row in the ledger — a wallet counted in Chips still
       keeps one rupee ledger, and the unit figure is its rate applied at render. Without this the
       label was pinned to the rupee number: ₹50 off a 10-Chips-to-₹1 wallet read "50 Chips" when 500
       Chips is what was spent, and the same redemption showed 500 in the log form's "= 500 Chips"
       hint and on the Accounts screen (both of which go through rewardUnitBalance, which does
       convert). A wallet at the default 1:1 rate is unaffected, which is why this stayed hidden.
       Not `rewardUnitBalance`: that reads an account's whole balance out of the ledger, while this
       renders ONE row's amount — but they agree, because both apply this same rate. */
    const inUnits = rupeesToRewardPoints(amount, account);
    let cleanAmount = inUnits;
    if (Math.round(inUnits * 100) / 100 === 0) {
      cleanAmount = 0;
    }
    const formatted = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(cleanAmount);
    return `${formatted} ${account.rewardUnit}`;
  }
  return formatCurrency(amount);
};

export const getCurrentMonthStr = () => format(new Date(), 'yyyy-MM'); // "2023-10"

// "Tribhuvan's", or "Your" when there's no name to work with. Every category-tree hero opens with
// it — the root screen's and each category's — and they have to stay in step, so it's built once.
export const userPossessive = (name?: string) => {
  const firstName = name?.split(' ')[0];
  return firstName ? `${firstName}'s` : 'Your';
};

// Function to calculate credit card billing cycle for a given date
//
// A statement closes ON statementDay, and the cut is exclusive: a transaction dated
// the 13th belongs to the NEXT cycle, not the one the 13th's statement bills.
//
// This isn't the convention the banks print — most describe the cycle as ending on
// the statement date — but it is what they do, for two reasons that hold at every
// issuer. The statement is generated at a moment on that day, usually overnight, so
// anything transacted afterwards is on the far side of the line. And statements bill
// by POSTING date: a swipe is an authorisation that posts a day or two later when the
// merchant submits its batch, so a same-day purchase has almost never posted by the
// time the statement is cut. Verified against a real Axis statement — a purchase on
// its 16th landed in the following cycle, and matching that took ₹210 out of a total
// that was otherwise ₹210 above the bank's.
//
// If an issuer ever turns out to differ, this is the line to make per-account.
export const getBillingCycleForDate = (dateStr: string, statementDay: number): string => {
  const date = parseISO(dateStr);
  const transDay = date.getDate();

  if (transDay >= statementDay) {
    // Falls into the next month's statement
    return format(addMonths(date, 1), 'yyyy-MM');
  }
  // Falls into the current month's statement
  return format(date, 'yyyy-MM');
};

// Start Date and End Date for a cycle string 'yyyy-MM' and statementDay.
// The window closes the day BEFORE the statement is cut — see getBillingCycleForDate.
// Example for cycle 2026-08 & statementDay 13: 13 Jul 2026 to 12 Aug 2026.
export const getBillingCycleDates = (cycle: string, statementDay: number) => {
  const statementDate = setDate(parseISO(`${cycle}-01`), statementDay);
  const endDate = addDays(statementDate, -1);
  const startDate = addMonths(statementDate, -1);
  return { startDate, endDate };
};

/** `showYear` of false drops the trailing year on a cycle that stays inside one — for callers whose
 *  row title already names the month and year, where repeating it costs the width that the rest of
 *  the line needs. A cycle that CROSSES a year still prints both, because there the year is the only
 *  thing telling the two halves apart. */
export const formatBillingCycleRange = (cycle: string, statementDay: number = 1, showYear: boolean = true): string => {
  const { startDate, endDate } = getBillingCycleDates(cycle, statementDay);
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const startFmt = format(startDate, sameYear ? 'd MMM' : 'd MMM yyyy');
  const endFmt = format(endDate, sameYear && !showYear ? 'd MMM' : 'd MMM yyyy');
  return `${startFmt} – ${endFmt}`;
};

// ---- Settlement lag: which statement a charge actually lands on ------------------------------
//
// getBillingCycleForDate bills by TRANSACTION date. Banks bill by POSTING date — a swipe is an
// authorisation, and the charge posts when the merchant submits its batch, typically 0–3 days
// later (e-commerce and travel are the slowest; a recharge or a UPI tap posts same-day). The
// exclusive cut absorbs one day of that, which is why a purchase ON the statement day rolls
// forward. It cannot absorb more, and no single lag figure would be right for every merchant:
// a 15 Aug Amazon order can miss a 17th cut while a 16 Aug recharge makes it.
//
// So the app doesn't guess. It flags the charges near enough to the cut for the question to be
// live, and lets the statement screen record what the bank actually did — see
// appliedBillingCycleYearMonth and the long-press move in AccountStatement.

// How close to the cut a charge has to fall to be worth flagging. Three days covers the common
// e-commerce batch lag without lighting up half the statement.
export const SETTLEMENT_BOUNDARY_DAYS = 3;

// The cycle a transaction's DATE alone puts it in — where it would be billed if it settled
// instantly. This is the anchor a manual move is measured against, NOT wherever it currently
// sits: clamping to natural ±1 is what stops repeated moves from ratcheting a charge arbitrarily
// far from the month it was actually made.
export const getNaturalBillingCycle = (tx: Transaction, statementDay: number): string =>
  getBillingCycleForDate(tx.date, statementDay);

// The cycle a transaction is actually BILLED in: the manual override if one was set, otherwise
// its date's cycle. Every cycle sum reads through this, so the statement, the card's outstanding
// balance and the bill reminder cannot disagree about which month a charge belongs to.
export const getAppliedBillingCycle = (tx: Transaction, statementDay: number): string =>
  tx.appliedBillingCycleYearMonth || getBillingCycleForDate(tx.date, statementDay);

// Shift a 'yyyy-MM' cycle by whole months.
export const shiftBillingCycle = (cycle: string, delta: number): string =>
  format(addMonths(parseISO(`${cycle}-01`), delta), 'yyyy-MM');

// Days from a transaction's date to the last day its natural cycle covers — 0 means the statement
// is cut tomorrow. Never negative: the date is what picks the cycle, so it always falls inside it.
export const daysToStatementCut = (dateStr: string, statementDay: number): number => {
  const cycle = getBillingCycleForDate(dateStr, statementDay);
  const { endDate } = getBillingCycleDates(cycle, statementDay);
  return differenceInCalendarDays(endDate, parseISO(dateStr));
};

// Close enough to the cut that the bank may well post it after the statement is generated.
export const isNearStatementCut = (dateStr: string, statementDay: number): boolean =>
  daysToStatementCut(dateStr, statementDay) < SETTLEMENT_BOUNDARY_DAYS;


export const calculateCycleBalanceForCycle = (
  account: Account,
  transactions: Transaction[],
  cycle: string
): number => {
  const statementDay = account.statementDay || 1;
  return transactions
    .filter(t => {
      if (t.accountId !== account.id) return false;
      // A points redemption isn't a charge on the card's credit line, so it must not enter the
      // statement cycle. Without this a card redeeming its own points counted the redemption leg as a
      // second debit alongside the reduced purchase, and reported the FULL price as outstanding.
      //
      // This runs FIRST, before any cycle test. A credit carrying an explicit cycle used to return
      // above this line, so a reward- or travel-flagged credit with one would have been counted as a
      // rupee credit and knocked its amount off the card's outstanding — points paid off money.
      // Nothing constructs that combination today, but the field is now writable from a second
      // place, and an unconditional guard is the point of having one predicate.
      if (!affectsRupeeBalance(t)) return false;
      // Honours the override for DEBITS as well as payments — a charge near the cut may post after
      // the statement is generated, and the statement screen lets that be recorded. The credit-only
      // branch that used to sit above became redundant once this moved below the guard:
      // getAppliedBillingCycle already returns the override when a transaction carries one.
      return getAppliedBillingCycle(t, statementDay) === cycle;
    })
    .reduce((sum, t) => sum + (t.type === 'debit' ? t.amount : -t.amount), 0);
};

export const calculateCycleBalance = (
  account: Account,
  transactions: Transaction[],
  todayStr: string
): number => {
  const statementDay = account.statementDay || 1;
  const currentCycle = getBillingCycleForDate(todayStr, statementDay);
  return calculateCycleBalanceForCycle(account, transactions, currentCycle);
};

export const getLatestBilledCycle = (statementDay: number, now: Date = new Date()): string => {
  // INJECTABLE, and it has to be. getCardDues takes a `now` and derives the open cycle from it while
  // taking the billed one from here; reading the wall clock instead meant the two disagreed for any
  // caller that passed a date, and could return the SAME cycle as both billed and unbilled — which
  // breaks the adjacency the whole service is built on. Every production caller happens to pass the
  // real today, so nothing shipped wrong; the parameter was simply a promise the function did not keep.
  const currentCycle = getBillingCycleForDate(format(now, 'yyyy-MM-dd'), statementDay);
  const currentCycleDate = parseISO(`${currentCycle}-01`);
  return format(subMonths(currentCycleDate, 1), 'yyyy-MM');
};

import { calculateEPFProjection } from './utils/epfEngine';

// ---- Reward points <-> rupees --------------------------------------------------------------
// A card's own points balance (Jupiter's Jewels, Edge Miles) is denominated in POINTS: its opening
// figure, the realized amounts on confirmed cashback statements, and the redemption legs subtracted
// from it are all point counts. Rupee amounts — what a purchase actually cost, what a bill's
// remaining balance is — are not. `pointsConversionRate` bridges the two, and reads as "how many
// points equal ₹1" (5 Jewels = ₹1), the same direction Cashback.tsx uses.
//
// The predicate below is deliberately the exact condition that sets `isRewardTransaction` on a
// redemption leg, because that flag is what routes the leg's amount into the points balance rather
// than the money balance. Tying the two together is what keeps the arithmetic homogeneous: an
// account is points-denominated for conversion purposes precisely when its legs land in the points
// ledger. A plain rupee reward wallet (CRED coins, super.money) fails the predicate and gets a rate
// of 1, so every call site can convert unconditionally and rupee wallets pass through untouched.
export const isPointsDenominated = (account?: Account) =>
  !!(account?.isCashbackEnabled && account?.rewardType === 'points');

/**
 * Is this account's balance COUNTED IN A UNIT — Jewels, Chips, Miles — rather than in rupees?
 *
 * Deliberately a different question from `isPointsDenominated`, which asks whether the account keeps
 * a SEPARATE reward-points ledger beside its money. Only a card does: its rupee balance is what the
 * credit line lent and its points balance is a second, parallel figure (`rewardOpeningBalances`, fed
 * by confirmed statement realizations). A `rewards` WALLET has one balance and one ledger — the
 * deposits it receives, the redemptions it funds, the liquidations out of it — and that ledger is in
 * rupees like every other amount in the app. Naming a unit and a rate on it does not create a second
 * balance; it says what the one balance is COUNTED IN, at that rate.
 *
 * Conflating the two is what made a "Cheq Chips" wallet with 500 Chips at 10/₹1 read as ₹500
 * everywhere: the unit only reached the Accounts card, which prints it as a caption, while every
 * other surface asked `rewardType === 'points'` (a card-only field) and fell through to rupees.
 *
 * So: this predicate drives DISPLAY and ENTRY — the ₹ | PTS toggle, the picker's balance line, the
 * account form's balance field — while `isPointsDenominated` keeps driving STORAGE, which balance map
 * is read, and whether a leg belongs to the points ledger (`isRewardTransaction`). A wallet's
 * redemption leg stays an ordinary rupee debit, because a wallet's balance is ordinary rupees.
 */
export const isUnitDenominated = (account?: Account) =>
  isPointsDenominated(account)
  || !!(account?.type === 'rewards' && account?.rewardUnit && account?.rewardType === 'points');

// A reward split whose source is a one-off the user doesn't track anywhere — a coupon, a voucher, a
// scratch-card credit, a friend's referral code — held in `rewardUsedAccountId` as a sentinel rather
// than a real account id. It is deliberately NOT an account: standing one up for a ₹40 coupon that
// will never be used again is more bookkeeping than the coupon is worth.
//
// The sentinel is safe in that field precisely because every consumer of `rewardUsedAccountId`
// asks "is this some account's id?" (`=== t.accountId`, `accounts.find(...)`), and this value
// matches no account, so an external split reads as "a split with no reward leg" everywhere without
// each of those sites needing to know the concept exists. The two places that DO need to know are
// the ones that would otherwise conjure a leg out of nothing: handleSave (creates no leg) and the
// balance check in validate() (there is no balance to check). Chosen over a separate boolean flag
// so that `!!rewardUsedAccountId` — the existing "this row anchors a split" test, used in half a
// dozen places — keeps working untouched.
export const EXTERNAL_REWARD_SOURCE_ID = '__external_reward__';

export const isExternalRewardSource = (accountId?: string) =>
  accountId === EXTERNAL_REWARD_SOURCE_ID;

/** What a one-time reward is CALLED where a row's account is named. Its redemption leg carries the
 *  sentinel in `accountId` — matching no account, which is the point — so every surface that would
 *  otherwise print "Unknown" says this instead. */
export const EXTERNAL_REWARD_NAME = 'One-time reward';

/** The name of the account a row sits on, including the row that sits on none. */
export const accountNameOf = (accountId: string | undefined, accounts: Account[]) =>
  isExternalRewardSource(accountId)
    ? EXTERNAL_REWARD_NAME
    : (accounts.find(a => a.id === accountId)?.name || 'Unknown');

export const rewardPointsRate = (account?: Account) =>
  isUnitDenominated(account) ? (account?.pointsConversionRate || 1) : 1;

/** Points spent -> the rupee value they paid off. 430 Jewels at 5/₹1 -> ₹86. */
export const rewardPointsToRupees = (points: number, account?: Account) =>
  Math.round((points / rewardPointsRate(account)) * 100) / 100;

/** Rupee value -> the points it costs. ₹86 at 5/₹1 -> 430 Jewels. */
export const rupeesToRewardPoints = (rupees: number, account?: Account) =>
  Math.round((rupees * rewardPointsRate(account)) * 100) / 100;

// ---- Reward splits: one anchor, many sources ------------------------------------------------
// A split is a list, not a pair. `rewardSplits` is authoritative when present; the legacy
// `rewardUsed` + `rewardUsedAccountId` pair is the same thing with one entry, and is what every row
// logged before this looks like. Reading through these accessors — never off the raw fields — is what
// lets the two shapes coexist with no migration: a 2015-vintage single split and a three-source one
// both come back as an array of `{ accountId, amount }`.
//
// The rule for WRITING is the mirror image, and lives in `withRewardSplits`: the list goes to
// `rewardSplits`, its sum to `rewardUsed`, and its first source to `rewardUsedAccountId`. That keeps
// `!!rewardUsedAccountId` ("this row anchors a split") and `total - rewardUsed` ("what the primary
// account actually paid") true for every consumer that has always relied on them.

/** Every reward source on this row, oldest first. Empty when there is no split. */
export const getRewardSplits = (tx?: Partial<Transaction>): RewardSplitLeg[] => {
  if (!tx) return [];
  if (tx.rewardSplits && tx.rewardSplits.length > 0) {
    return tx.rewardSplits.filter(s => !!s.accountId && (s.amount || 0) > 0);
  }
  return (tx.rewardUsedAccountId && (tx.rewardUsed || 0) > 0)
    ? [{ accountId: tx.rewardUsedAccountId, amount: tx.rewardUsed as number }]
    : [];
};

/** Total rupees redeemed on this row, across every source. The list is what is summed, so an anchor
 *  assembled mid-save (or in a test) reads correctly before `rewardUsed` has been recomputed; a row
 *  with a total but no readable source falls back to the stored figure rather than reporting zero,
 *  since that total is what the amount arithmetic has always subtracted. */
export const rewardSplitTotal = (tx?: Partial<Transaction>): number => {
  const splits = getRewardSplits(tx);
  if (splits.length === 0) return tx?.rewardUsed || 0;
  return Math.round(splits.reduce((sum, s) => sum + (s.amount || 0), 0) * 100) / 100;
};

/** Whether `accountId` is one of this row's reward sources — the multi-source form of the
 *  `p.rewardUsedAccountId === child.accountId` discriminator described in
 *  docs/LINKED_TRANSACTIONS.md. */
export const isRewardSourceOf = (tx: Partial<Transaction> | undefined, accountId?: string): boolean =>
  !!accountId && getRewardSplits(tx).some(s => s.accountId === accountId);

/** WHICH of `anchor`'s splits produced `leg`, as an index, or -1. Prefers the recorded `legId`, which
 *  survives a source switch and tells two sibling legs apart; falls back to the account for a legacy
 *  row that has no leg ids. Callers must have established that `leg` is linked to `anchor` and is not
 *  the anchor itself — a card redeeming its OWN points puts both on the same account.
 *
 *  The index, not just the split, because it is also the position the log form's split carousel
 *  opens at when a reward leg is tapped in the ledger. */
export const rewardSplitIndexOfLeg = (
  anchor: Partial<Transaction> | undefined,
  leg: Pick<Transaction, 'id' | 'accountId'>,
): number => {
  const splits = getRewardSplits(anchor);
  const byId = splits.findIndex(s => s.legId === leg.id);
  if (byId >= 0) return byId;
  return splits.findIndex(s => !s.legId && s.accountId === leg.accountId);
};

/** The split that produced `leg`, if any. See rewardSplitIndexOfLeg for how it is matched. */
export const rewardSplitOfLeg = (
  anchor: Partial<Transaction> | undefined,
  leg: Pick<Transaction, 'id' | 'accountId'>,
): RewardSplitLeg | undefined => {
  const i = rewardSplitIndexOfLeg(anchor, leg);
  return i >= 0 ? getRewardSplits(anchor)[i] : undefined;
};

/** The ids of the legs this row's splits generated (external sources contribute none). */
export const rewardLegIdsOf = (tx?: Partial<Transaction>): string[] =>
  getRewardSplits(tx).map(s => s.legId).filter((id): id is string => !!id);

/* Fit a split's sources to a new TOTAL, when something other than the sources themselves decided
   what that total must be — the Option-B rebalance below, where the bank leg was edited and the
   rewards have to absorb the difference. With one source it is a straight assignment. With several
   the difference has to land somewhere, and it lands on the LAST source: the sources are held in the
   order they were added, so the last is the one most recently tacked on, and flexing it leaves the
   primary redemption the user set up first exactly as they set it. It cascades backwards only when
   the last source runs out of room (a shrink deeper than it can absorb), and a source flexed to zero
   is dropped by the caller — a ₹0 leg is not a redemption. */
export function redistributeRewardSplits(splits: RewardSplitLeg[], target: number): RewardSplitLeg[] {
  if (splits.length === 0) return [];
  const total = Math.round(Math.max(0, target) * 100) / 100;
  const round = (n: number) => Math.round(Math.max(0, n) * 100) / 100;
  if (splits.length === 1) return [{ ...splits[0], amount: total }];

  const head = splits.slice(0, -1);
  let used = 0;
  const kept = head.map(s => {
    const amount = round(Math.min(s.amount, total - used));
    used = round(used + amount);
    return { ...s, amount };
  });
  return [...kept, { ...splits[splits.length - 1], amount: round(total - used) }];
}

/** Write a split list onto a row, keeping the legacy pair in step. Pass an empty list to clear the
 *  split entirely — `rewardSplits` is dropped rather than left as `[]`, so `getRewardSplits` never
 *  has to treat an empty array as meaningful. */
export const withRewardSplits = <T extends Partial<Transaction>>(tx: T, splits: RewardSplitLeg[]): T => {
  const live = splits.filter(s => !!s.accountId && (s.amount || 0) > 0);
  if (live.length === 0) {
    return { ...tx, rewardUsed: 0, rewardUsedAccountId: '', rewardSplits: undefined };
  }
  return {
    ...tx,
    rewardUsed: Math.round(live.reduce((sum, s) => sum + s.amount, 0) * 100) / 100,
    rewardUsedAccountId: live[0].accountId,
    rewardSplits: live,
  };
};

// Does this transaction move the account's own RUPEE balance? An account can carry up to three
// separate balances — its money, an NCMC travel purse, and a reward-points wallet — and a leg belongs
// to exactly one. A redemption leg in particular is NOT a rupee charge: it draws on points, which is
// why it's counted (at the conversion rate) by the isRewardPoints branch of calculateBalance instead.
//
// This exists because that rule was previously spelled out inline in some sums and simply missing from
// others, which was invisible until reward splits opened up beyond CC Payments. A card redeeming its
// OWN points then puts both legs on the same account, and every sum that forgot the rule started
// counting the redemption as a second charge: a ₹448 purchase paid with ₹362 of credit and ₹86 of
// Jewels reported ₹448 of card outstanding. One predicate, so a new sum can't quietly omit it.
/** Whether a card pays cashback at all — the test every cashback surface should use before offering
 *  a rate, a mode or a vault row for it.
 *
 *  `isCashbackEnabled` is the switch on the account form, but it was added after the field it
 *  replaced, so a card saved by an older build has it undefined while still carrying rates. Falling
 *  back to "does it have any rate configured" is what Accounts' own edit form does when it seeds the
 *  switch; doing the same here keeps a legacy card earning instead of silently losing its cashback
 *  the first time this test is applied to it. */
export const cardEarnsCashback = (account?: Account | null) =>
  !!account
  && (account.type === 'credit_card' || account.type === 'debit_card')
  && (account.isCashbackEnabled
    ?? (account.defaultCashbackRate !== undefined || !!account.cashbackRates?.length));

export const affectsRupeeBalance = (t: Transaction) =>
  !t.isTravelTransaction && !t.isRewardTransaction;

export const calculateBalance = (
  account: Account,
  transactions: Transaction[],
  monthStr: string,
  isTravel: boolean = false,
  isRewardPoints: boolean = false,
  cashbackStatements: CashbackStatement[] = []
) => {
  if (account.type === 'epf') {
    return calculateEPFProjection(account, monthStr).balance;
  }

  const balancesMap = isRewardPoints
    ? (account.rewardOpeningBalances || {})
    : isTravel
      ? (account.travelOpeningBalances || {})
      : (account.openingBalances || {});

  // Find the most recent opening balance at or before monthStr
  const candidateMonths = Object.keys(balancesMap).filter(m => m <= monthStr).sort();
  const baseMonth = candidateMonths.length > 0 ? candidateMonths[candidateMonths.length - 1] : null;
  const opening = baseMonth ? balancesMap[baseMonth] : 0;

  let change = 0;

  if (isRewardPoints) {
    // 1. Point redemptions (debit reward transactions)
    const rewardDebits = transactions.filter(t => {
      if (t.accountId !== account.id) return false;
      if (!t.isRewardTransaction || t.type !== 'debit') return false;
      const tMonth = format(parseISO(t.date), 'yyyy-MM');
      if (baseMonth && tMonth < baseMonth) return false;
      if (tMonth > monthStr) return false;
      return true;
    });
    // Redemption legs are stored in RUPEES, like every other transaction amount in the app — that is
    // what keeps them summable by the ledger's day totals, the spend stats and the Insights charts,
    // none of which know about points. This balance is the one place denominated in points (its
    // opening figure and the statement realizations below are point counts), so the rate is applied
    // here, at the single boundary, rather than by storing a point count on the transaction. It also
    // means splits logged before this conversion existed are read correctly without a migration.
    const debitsTotal = rewardDebits.reduce((sum, t) => sum + rupeesToRewardPoints(t.amount, account), 0);

    // 2. Confirmed cashbacks (realized points) from cashbackStatements
    const confirmedCredits = cashbackStatements.filter(s => {
      if (s.accountId !== account.id || !s.confirmed) return false;

      // Determine the month of the statement
      let sMonth = '';
      if (s.billingCycleYearMonth.length === 7) {
        sMonth = s.billingCycleYearMonth;
      } else {
        const tx = transactions.find(t => t.id === s.billingCycleYearMonth);
        if (tx) {
          sMonth = format(parseISO(tx.date), 'yyyy-MM');
        }
      }

      if (!sMonth) return false;
      if (baseMonth && sMonth < baseMonth) return false;
      if (sMonth > monthStr) return false;
      return true;
    });
    const creditsTotal = confirmedCredits.reduce((sum, s) => sum + s.realized, 0);

    change = creditsTotal - debitsTotal;
  } else {
    const relevantTransactions = transactions.filter(t => {
      if (t.accountId !== account.id) return false;
      const tMonth = format(parseISO(t.date), 'yyyy-MM');

      // Only count transactions from the baseMonth up to the target monthStr
      if (baseMonth && tMonth < baseMonth) return false;
      if (tMonth > monthStr) return false;

      if (isTravel) {
        return !!t.isTravelTransaction;
      }
      return affectsRupeeBalance(t);
    });

    change = relevantTransactions.reduce((acc, t) => {
      // `amount` is already the out-of-pocket figure on a split anchor: handleSave stores
      // `total − rewardUsed` for a debit (see docs/LINKED_TRANSACTIONS.md), and the redemption is a
      // separate leg. Subtracting rewardUsed again here took it off twice — a ₹448 purchase split with
      // ₹60 of rewards stored ₹388 and reported only ₹328 spent, leaving the funding account ₹60 richer
      // than it is. Unreachable while splits were CC-Payment-only: that anchor is the card CREDIT, and
      // the guard was on debits.
      const effectiveAmount = t.amount;

      if (account.type === 'credit_card') {
        // Credit card logic: debit means spending (adds to balance), credit means payment (reduces balance)
        return t.type === 'debit' ? acc + effectiveAmount : acc - effectiveAmount;
      } else {
        // Bank account/Cash/Debit Card logic: credit adds, debit subtracts
        return t.type === 'credit' ? acc + effectiveAmount : acc - effectiveAmount;
      }
    }, 0);
  }

  const adjustmentsMap = isRewardPoints
    ? (account.rewardBalanceAdjustments || {})
    : isTravel
      ? (account.travelBalanceAdjustments || {})
      : (account.balanceAdjustments || {});
  const adjustment = Object.keys(adjustmentsMap)
    .filter(m => (!baseMonth || m >= baseMonth) && m <= monthStr)
    .reduce((sum, m) => sum + (adjustmentsMap[m] || 0), 0);

  return opening + change + adjustment;
};

/**
 * A reward source's balance IN ITS OWN UNIT — the figure to show beside its name, and the ceiling a
 * redemption is checked against.
 *
 * The two kinds of reward balance are read differently, which is the whole reason this exists as one
 * function: a card's points wallet is a separate ledger that `calculateBalance` already returns in
 * points, while a `rewards` wallet's single balance is rupees and is converted here at its rate. Left
 * to each caller, half of them asked for the wrong one — a wallet holding 500 Chips at 10/₹1 was
 * reported as ₹500 in the split picker while the Accounts card called the same number 500 CHIPS.
 *
 * Returns plain rupees for an account with no unit at all (CRED coins, super.money), since
 * `rupeesToRewardPoints` is the identity at a rate of 1.
 */
export const rewardUnitBalance = (
  account: Account | undefined,
  transactions: Transaction[],
  monthStr: string,
  cashbackStatements: CashbackStatement[] = [],
) => {
  if (!account) return 0;
  return isPointsDenominated(account)
    ? calculateBalance(account, transactions, monthStr, false, true, cashbackStatements)
    : rupeesToRewardPoints(calculateBalance(account, transactions, monthStr, false, false, cashbackStatements), account);
};

/** How a reward balance reads: "500 Chips" for a unit-denominated source, "₹21" for a rupee wallet.
 *  Takes the figure already in the account's own unit — i.e. what `rewardUnitBalance` returns. */
export const formatRewardBalance = (account: Account | undefined, unitBalance: number) =>
  isUnitDenominated(account)
    ? `${unitBalance} ${account?.rewardUnit || 'Points'}`
    : formatCurrency(unitBalance);

// calculateTotalSpendPerCycle used to live here: a per-cycle spend/payment/net for one card, with
// no affectsRupeeBalance filter. That omission is why Bills and the bill-alert banner overstated the
// bill on any card that had redeemed its own points, while Accounts and the Dashboard did not. Both
// callers now read services/CardDuesService, which applies the predicate — and the function is gone
// rather than deprecated, so nothing can reach for the wrong one of two near-identical helpers.

export type CardTexture = 'weave' | 'hairline' | 'guilloche' | 'dots' | 'none';
export type CardGeometry = 'chevron' | 'slash' | 'facet' | 'arc' | 'none';

/**
 * The *material* a card is made of — everything <CardSurface> needs to render the
 * plastic itself. Content printed on the card (chip, network mark, names, buttons)
 * is layered on top by the consumer and is deliberately not part of this.
 *
 * `texture` / `geometry` / `sheen` are the layers that give the surface depth.
 * Every skin currently opts out of all three, so the surface renders exactly as it
 * did before this type existed — turning them on is a pure data change here.
 *
 * `ink` is the one piece of knowledge that has to cross the material/content
 * boundary: only the skin knows whether the surface is dark or light, and content
 * needs that to pick a text color. CardSurface publishes it as `--card-ink`.
 */
export interface CardSkin {
  front: string;
  back: string;
  texture: CardTexture;
  geometry: CardGeometry;
  sheen: number;          // 0–1 — opacity of the specular highlight layer
  ink: 'light' | 'dark';
  /**
   * Co-brand programme, printed on the back. This one IS a skin property: the
   * programme is what the skin depicts, so a card matching the swiggy skin is a
   * Swiggy card by definition. The issuing bank is not — see resolveCardIssuer.
   */
  coBrand?: BrandKey;
  /**
   * A brand symbol blown up as the front's background motif, in place of the
   * generic geometry layer. Set one or the other, not both — they occupy the
   * same visual role and fight for the same space.
   */
  watermark?: BrandKey;
}

type CardMaterial = Partial<Pick<CardSkin, 'texture' | 'geometry' | 'sheen' | 'ink' | 'coBrand' | 'watermark'>>;

/** Bank names as they appear inside a card's name. Longest first — 'indusind'
 *  must be tested before any shorter substring of it could match. */
const BANK_IN_NAME: ReadonlyArray<readonly [string, BrandKey]> = [
  ['indusind', 'indusind'],
  ['federal', 'federal'],
  ['icici', 'icici'],
  ['hdfc', 'hdfc'],
  ['axis', 'axis'],
  ['idfc', 'idfc'],
  ['csb', 'csb'],
  ['sbi', 'sbi'],
  ['tide', 'tide'],
];

/** Products issued by exactly one bank, so the bank is safe to infer when the
 *  name doesn't say it. Anything issued by more than one bank stays out:
 *  Jupiter ships on CSB *and* Federal, OneCard on BOB/Federal/SBM/IDFC. Naming
 *  a bank for those would be a guess, and the wrong logo is worse than none. */
const SINGLE_ISSUER_PRODUCT: ReadonlyArray<readonly [string, BrandKey]> = [
  ['swiggy', 'hdfc'],
  ['tata neu', 'hdfc'],
  ['infinia', 'hdfc'],
  ['regalia', 'hdfc'],
  ['millennia', 'hdfc'],
  ['amazon', 'icici'],
  ['flipkart', 'axis'],
  ['supermoney', 'axis'],
  ['scapia', 'federal'],
];

/**
 * Which bank's mark to print on a card, or none.
 *
 * In order: what the user set explicitly, then a bank named in the card's own
 * name, then a product only one bank issues. Note that 'gold' is deliberately
 * absent from both tables even though it shares a skin with Infinia and Regalia
 * — those are HDFC products, but "gold" is a tier every bank sells, and an Axis
 * Gold card must not end up wearing an HDFC logo.
 */
export const resolveCardIssuer = (
  cardName?: string,
  cardDetails?: { issuer?: BrandKey }
): BrandKey | undefined => {
  if (cardDetails?.issuer) return cardDetails.issuer;

  const name = (cardName || '').toLowerCase();
  if (!name) return undefined;

  for (const [needle, brand] of BANK_IN_NAME) {
    if (name.includes(needle)) return brand;
  }
  for (const [needle, brand] of SINGLE_ISSUER_PRODUCT) {
    if (name.includes(needle)) return brand;
  }
  return undefined;
};

const defineSkin = (front: string, back: string, material: CardMaterial = {}): CardSkin => ({
  front,
  back,
  texture: 'none',
  geometry: 'none',
  sheen: 0,
  ink: 'light',
  ...material,
});

export const getCardGradients = (themeIndex: number, network?: CardNetwork, cardName?: string): CardSkin => {
  const name = (cardName || '').toLowerCase();

  // Supermoney x Axis
  if (name.includes('supermoney')) {
    return defineSkin(
      'linear-gradient(135deg, #0a0f1d 0%, #151d33 50%, #0d2e2b 100%)',
      'linear-gradient(135deg, #151d33 0%, #0d2e2b 100%)',
      // No geometry: the Axis 'A' is the background motif, as on the real card.
      { geometry: 'none', texture: 'hairline', sheen: 0.55, coBrand: 'supermoney', watermark: 'axismark' }
    );
  }

  // Jupiter x CSB
  if (name.includes('jupiter') || name.includes('csb')) {
    return defineSkin(
      'linear-gradient(135deg, #1a1f6b 0%, #2d3192 55%, #3f46b8 100%)',
      'linear-gradient(135deg, #2d3192 0%, #3f46b8 100%)',
      { geometry: 'slash', texture: 'hairline', sheen: 0.6, coBrand: 'jupiter' }
    );
  }

  // Swiggy x HDFC
  if (name.includes('swiggy')) {
    return defineSkin(
      'linear-gradient(135deg, #1c092b 0%, #3b1459 55%, #fc8019 100%)',
      // Back runs orange-to-purple, opposite the front. The Swiggy mark is orange
      // and sits bottom-right, which is exactly where the front's gradient ends up
      // orange — the logo was disappearing into it. Flipping the back's direction
      // puts purple under the mark, and reads correctly anyway: turning a card over
      // mirrors it, so its gradient should run the other way.
      'linear-gradient(135deg, #fc8019 0%, #3b1459 100%)',
      { geometry: 'arc', texture: 'weave', sheen: 0.7, coBrand: 'swiggy' }
    );
  }

  // Tide (debit). Tide's own blue is #4050fb, which lands almost exactly on the
  // Jupiter x CSB skin — and both were slash + hairline, so the two cards were
  // near-indistinguishable in a list. Telling your own cards apart at a glance
  // beats matching a brand colour you can already see on the plastic, so this one
  // moves to violet and takes a different geometry and texture as well. Hue alone
  // wouldn't have been enough; they were the same material.
  if (name.includes('tide')) {
    return defineSkin(
      'linear-gradient(135deg, #170f2b 0%, #3a2063 55%, #6b3fae 100%)',
      'linear-gradient(135deg, #6b3fae 0%, #3a2063 100%)',
      { geometry: 'facet', texture: 'guilloche', sheen: 0.55 }
    );
  }

  // Amazon Pay ICICI
  if (name.includes('amazon')) {
    return defineSkin(
      'linear-gradient(135deg, #0d131f 0%, #1a2332 60%, #ff9900 100%)',
      'linear-gradient(135deg, #1a2332 0%, #ff9900 100%)',
      { geometry: 'slash', texture: 'hairline', sheen: 0.6 }
    );
  }

  // Flipkart Axis
  if (name.includes('flipkart')) {
    return defineSkin(
      'linear-gradient(135deg, #07152b 0%, #0f2952 65%, #2874f0 100%)',
      'linear-gradient(135deg, #0f2952 0%, #2874f0 100%)',
      { geometry: 'chevron', texture: 'weave', sheen: 0.6 }
    );
  }

  // OneCard
  if (name.includes('onecard') || name.includes('one card')) {
    return defineSkin(
      'linear-gradient(135deg, #141414 0%, #1f1f1f 50%, #050505 100%)',
      'linear-gradient(135deg, #1f1f1f 0%, #050505 100%)',
      // OneCard ships as a metal card — smooth, so a fine grain and a restrained gloss.
      { geometry: 'facet', texture: 'hairline', sheen: 0.45 }
    );
  }

  // Scapia
  if (name.includes('scapia')) {
    return defineSkin(
      'linear-gradient(135deg, #022c22 0%, #0d9488 60%, #14b8a6 100%)',
      'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)',
      { geometry: 'arc', texture: 'guilloche', sheen: 0.6 }
    );
  }

  // Tata Neu HDFC
  if (name.includes('tata neu') || name.includes('neu')) {
    return defineSkin(
      'linear-gradient(135deg, #1a0026 0%, #36004d 60%, #c026d3 100%)',
      'linear-gradient(135deg, #36004d 0%, #c026d3 100%)',
      { geometry: 'chevron', texture: 'weave', sheen: 0.65 }
    );
  }

  // SBI Cashback / SBI
  if (name.includes('sbi')) {
    return defineSkin(
      'linear-gradient(135deg, #0c2340 0%, #0284c7 65%, #38bdf8 100%)',
      'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
      { geometry: 'arc', texture: 'guilloche', sheen: 0.6 }
    );
  }

  // Infinia / Regalia / Millennia
  if (name.includes('infinia') || name.includes('regalia') || name.includes('millennia') || name.includes('gold')) {
    return defineSkin(
      'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #ca8a04 100%)',
      'linear-gradient(135deg, #1e293b 0%, #ca8a04 100%)',
      // Premium metal tier — brushed grain, strongest gloss of the set.
      { geometry: 'facet', texture: 'hairline', sheen: 0.75 }
    );
  }

  if (network === 'amex') {
    return defineSkin(
      'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
      'linear-gradient(135deg, #111827 0%, #0f131a 100%)',
      { geometry: 'slash', texture: 'dots', sheen: 0.5 }
    );
  }

  const themes: CardSkin[] = [
    defineSkin('linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', 'linear-gradient(135deg, #16213e 0%, #0f3460 100%)', { geometry: 'chevron', texture: 'weave', sheen: 0.55 }), // Blue
    defineSkin('linear-gradient(135deg, #2b0f19 0%, #3d1524 50%, #4a1528 100%)', 'linear-gradient(135deg, #3d1524 0%, #4a1528 100%)', { geometry: 'chevron', texture: 'guilloche', sheen: 0.5 }), // Burgundy
    defineSkin('linear-gradient(135deg, #0f2b26 0%, #133b34 50%, #164a41 100%)', 'linear-gradient(135deg, #133b34 0%, #164a41 100%)', { geometry: 'arc', texture: 'hairline', sheen: 0.55 }), // Emerald
    defineSkin('linear-gradient(135deg, #1b1338 0%, #24194a 50%, #2d205c 100%)', 'linear-gradient(135deg, #24194a 0%, #2d205c 100%)', { geometry: 'slash', texture: 'weave', sheen: 0.55 }), // Indigo
    defineSkin('linear-gradient(135deg, #1f1f1f 0%, #141414 50%, #0a0a0a 100%)', 'linear-gradient(135deg, #141414 0%, #0a0a0a 100%)', { geometry: 'facet', texture: 'hairline', sheen: 0.4 }), // Onyx
    defineSkin('linear-gradient(135deg, #2c3e50 0%, #000000 100%)', 'linear-gradient(135deg, #1c2833 0%, #000000 100%)', { geometry: 'slash', texture: 'dots', sheen: 0.45 }), // Charcoal
    defineSkin('linear-gradient(135deg, #1a2a6c 0%, #b21f1f 50%, #fdbb2d 100%)', 'linear-gradient(135deg, #1a2a6c 0%, #b21f1f 100%)', { geometry: 'arc', texture: 'weave', sheen: 0.6 }), // Sunset
    defineSkin('linear-gradient(135deg, #301934 0%, #1e0d21 100%)', 'linear-gradient(135deg, #1e0d21 0%, #000000 100%)', { geometry: 'facet', texture: 'guilloche', sheen: 0.5 }), // Deep Purple
    defineSkin('linear-gradient(135deg, #010c1e 0%, #001f3f 100%)', 'linear-gradient(135deg, #001f3f 0%, #000000 100%)', { geometry: 'slash', texture: 'hairline', sheen: 0.5 }), // Midnight Navy
    defineSkin('linear-gradient(135deg, #0b1e0b 0%, #1e3a1e 100%)', 'linear-gradient(135deg, #1e3a1e 0%, #000000 100%)', { geometry: 'chevron', texture: 'weave', sheen: 0.5 }), // Forest Green
  ];

  const index = Math.abs(themeIndex) % themes.length;
  return themes[index];
};

export const APP_VERSION = 'v2.1.0';

export const CATEGORY_PALETTE = [
  '#38bdf8', // Sky Blue
  '#f59e0b', // Amber Gold
  '#10b981', // Emerald Green
  '#ef4444', // Crimson Red
  '#a855f7', // Vivid Purple
  '#eab308', // Electric Yellow
  '#ec4899', // Hot Pink
  '#84cc16', // Lime Green
  '#6366f1', // Deep Indigo
  '#f97316', // Flame Orange
  '#d946ef', // Bright Fuchsia
  '#94a3b8', // Cool Slate
];

export const ACCOUNT_PALETTE = [
  '#a855f7', // Vivid Purple
  '#f59e0b', // Amber Gold
  '#38bdf8', // Sky Blue
  '#ec4899', // Hot Pink
  '#10b981', // Emerald Green
  '#ef4444', // Crimson Red
  '#eab308', // Electric Yellow
  '#6366f1', // Deep Indigo
  '#f97316', // Flame Orange
  '#84cc16', // Lime Green
  '#d946ef', // Bright Fuchsia
  '#94a3b8', // Cool Slate
];

/**
 * Returns an array of `count` colors from `palette` guaranteed to be completely unique
 * when count <= palette.length, or without adjacent/wrap-around collisions when count > palette.length.
 */
export function getDistinctChartColors(count: number, palette: string[]): string[] {
  if (count <= 0) return [];
  const P = palette.length;

  if (count <= P) {
    return palette.slice(0, count);
  }

  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    let idx = i % P;

    // Check wrap-around collision with element 0 when i is the last slice
    if (i === count - 1 && idx === 0) {
      idx = (idx + 1) % P;
    }

    // Check adjacent collision with element (i - 1)
    if (i > 0 && result[i - 1] === palette[idx]) {
      idx = (idx + 1) % P;
      if (i === count - 1 && palette[idx] === result[0]) {
        idx = (idx + 1) % P;
      }
    }

    result.push(palette[idx]);
  }
  return result;
}

export function getInvestmentAccountStats(
  account: Account,
  transactions: Transaction[],
  currentPrice: number = 0
) {
  // No annotations on these callbacks: `transactions` is already Transaction[], so
  // the parameters infer. They used to be `(t: any)`, which threw that away and
  // turned every field access below into an unchecked one.
  const totalUnits = Number(account.numberOfShares ?? 0) +
    transactions
      .filter((t) => t.accountId === account.id && t.numberOfShares !== undefined)
      .reduce((sum, t) => t.type === 'credit' ? sum + Number(t.numberOfShares ?? 0) : sum - Number(t.numberOfShares ?? 0), 0);

  const txInvested = transactions
    .filter((t) => t.accountId === account.id && !t.isTravelTransaction && !t.isRewardTransaction)
    .reduce((sum, t) => t.type === 'credit' ? sum + t.amount : sum - t.amount, 0);

  const totalInvested = account.investedValue !== undefined
    ? account.investedValue + txInvested
    : (account.avgNav && totalUnits > 0 ? account.avgNav * totalUnits : 0);

  const currentValue = currentPrice * totalUnits;
  const totalReturn = currentValue - totalInvested;
  const totalReturnPct = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0;

  // Average price paid per unit — derived, never stored. Nothing asks the user for it: it is
  // exactly the two numbers above divided, so a saved copy could only ever disagree with them.
  //
  // Caveat worth knowing when reading this figure: totalInvested is net cash flow, and a sell leg
  // subtracts its full proceeds (market price), not the cost of the units sold. So after a partial
  // sale at a profit this sits BELOW the true cost basis. Exact for accumulate-only holdings.
  const avgPrice = totalUnits > 0 ? totalInvested / totalUnits : 0;

  return {
    totalUnits,
    totalInvested,
    avgPrice,
    currentValue,
    totalReturn,
    totalReturnPct,
    currentPrice
  };
}

// ---------------------------------------------------------------------------
// Day ordering
//
// A transaction's `order` only means anything against the other rows sharing its
// `date`: each day is a gap-free, duplicate-free 0..N-1 run. Two invariants ride
// on that run, and the drag-reorder maths breaks the moment either slips:
//
//   1. the run is contiguous — no gaps, no duplicates
//   2. the members of a linked group sit on ADJACENT indices
//
// (2) is the subtle one, and it is what these helpers exist to keep true. A
// linked group is dragged as a unit, so the drag has to know how many slots it
// occupies; with its legs scattered the only answer available was "the span from
// the first leg to the last", which is how one drag used to pick up — and
// relocate — every unrelated row caught in between. Nothing renumbers a day into
// that state on purpose: a leg created by an EDIT used to be appended at
// `maxOrder + 1` while its parent kept the order it had always had, and the
// load-time heal deliberately preserves visible order, so it could never see the
// gap, let alone close it.
// ---------------------------------------------------------------------------

/** The ids `tx` links to, tolerating the legacy single-id field. */
export const linkedIdsOf = (tx: Transaction): string[] =>
  tx.linkedTransactionIds || (tx.linkedTransactionId ? [tx.linkedTransactionId] : []);

/**
 * Every member of `tx`'s linked group that is present in `pool`, in pool order.
 *
 * Legs use a STAR topology — children link to the parent, not to each other — so
 * a 1-hop walk from a child misses its siblings. The last clause closes that by
 * also pulling in rows that link to the same parent(s) `tx` links to. Kept here
 * rather than inline at each call site because the render, the drag and the
 * invariant check all have to agree on what "one group" means: when they drifted,
 * the drag moved a block the render had never drawn.
 *
 * Ids that resolve to nothing in `pool` are simply absent from the result — a ref
 * to a debt ledger entry (a legitimate cross-reference) or to a since-deleted row
 * contributes no member rather than corrupting the group.
 */
export function linkedGroupOf(tx: Transaction, pool: Transaction[]): Transaction[] {
  const linkedIds = linkedIdsOf(tx);
  if (!linkedIds.length) return pool.filter(o => o.id === tx.id);
  return pool.filter(o =>
    o.id === tx.id ||
    linkedIds.includes(o.id) ||
    linkedIdsOf(o).includes(tx.id) ||
    linkedIds.some(pid => linkedIdsOf(o).includes(pid))
  );
}

/**
 * `day` re-sequenced so every linked group occupies adjacent slots, each group
 * anchored at its FIRST member's position and everything else keeping its
 * relative order. Returns the input array itself when nothing had to move, so
 * callers can cheaply tell a no-op from a change.
 *
 * This is the invariant's enforcement point. It runs on every write that can
 * disturb a day, which is the only way to stop the scatter coming back: the fix
 * for how gaps were *created* stops new ones, but a day can still be nudged into
 * a split group by a reorder made while a filter is hiding part of it.
 */
export function compactLinkedGroups(day: Transaction[]): Transaction[] {
  const out: Transaction[] = [];
  const placed = new Set<string>();
  day.forEach(tx => {
    if (placed.has(tx.id)) return;
    linkedGroupOf(tx, day).forEach(member => {
      if (placed.has(member.id)) return;
      placed.add(member.id);
      out.push(member);
    });
  });
  return out.every((t, i) => t === day[i]) ? day : out;
}

/** `day`'s rows sorted into their stored order, falling back to array position. */
export const sortDayByOrder = (day: Transaction[]): Transaction[] =>
  [...day].sort((a, b) => {
    const oa = a.order !== undefined ? a.order : day.indexOf(a);
    const ob = b.order !== undefined ? b.order : day.indexOf(b);
    return oa - ob;
  });

/**
 * The day's rows after a reorder that only the VISIBLE rows took part in.
 *
 * `newVisible` is the visible rows in their new sequence; every other row in
 * `day` is hidden behind a filter or a search and must not be dragged along. Each
 * visible slot in `day` is refilled from `newVisible` in sequence, which makes
 * the whole operation a permutation of the slots the visible rows already
 * occupied: hidden rows keep their exact positions, and because no new order
 * values are invented the 0..N-1 run cannot gain a gap or a duplicate.
 *
 * With three visible rows sitting on orders 3, 5 and 7 of a ten-row day, dragging
 * the second above the first swaps 3 and 5 and leaves 7 — and every hidden row —
 * exactly where it was. The renumber this replaced wrote 0, 1, 2 onto those three
 * rows instead, colliding head-on with the hidden rows already holding 0, 1 and 2
 * and scrambling the day the moment the filter came off.
 *
 * A redeal can still drop an unrelated row between two legs (the visible slots a
 * group lands on need not be adjacent), so groups are compacted afterwards.
 */
export function applyVisibleReorder(day: Transaction[], newVisible: Transaction[]): Transaction[] {
  const visibleIds = new Set(newVisible.map(t => t.id));
  let next = 0;
  const redealt = day.map(t => (visibleIds.has(t.id) ? newVisible[next++] : t));
  return compactLinkedGroups(redealt);
}

/** The rows of `day` whose stored `order` no longer matches their position. */
export function dayOrderUpdates(day: Transaction[]): Transaction[] {
  const updates: Transaction[] = [];
  day.forEach((t, i) => {
    if (t.order !== i) updates.push({ ...t, order: i });
  });
  return updates;
}

/**
 * `transactions` with `tx` added, placed inside its own day rather than dumped at
 * the end of it.
 *
 * A leg lands directly after the last member of the group it links to. The log
 * form creates legs BEFORE saving the row they belong to, so on a brand-new log
 * the parent does not exist yet, the leg appends, the parent appends right behind
 * it and the two are adjacent anyway. On an EDIT the parent is already there on
 * whatever order it has always had, and appending stranded the new leg at the far
 * end of the day — the gap that armed the drag bug. An explicit `tx.order` is
 * honoured as an insertion index.
 *
 * Array position is left alone: rows are patched in place and `tx` is appended,
 * because `order` is what the day sorts by and other call sites lean on the array
 * order they already have.
 */
export function insertIntoDay(transactions: Transaction[], tx: Transaction): Transaction[] {
  const sorted = sortDayByOrder(transactions.filter(t => t.date === tx.date));

  let at = sorted.length;
  if (tx.order !== undefined) {
    at = Math.max(0, Math.min(sorted.length, tx.order));
  } else {
    const linkedIds = linkedIdsOf(tx);
    if (linkedIds.length) {
      // Every slot the linked group already occupies, so a second leg lands after
      // the first rather than between the parent and the leg it just gained.
      const anchors = sorted.filter(t => linkedIds.includes(t.id));
      const occupied = anchors
        .flatMap(a => linkedGroupOf(a, sorted))
        .map(m => sorted.indexOf(m))
        .filter(i => i > -1);
      if (occupied.length) at = Math.max(...occupied) + 1;
    }
  }

  const placed = compactLinkedGroups([...sorted.slice(0, at), tx, ...sorted.slice(at)]);
  const orderById = new Map(placed.map((t, i) => [t.id, i]));
  const patched = transactions.map(t => {
    const o = orderById.get(t.id);
    return o !== undefined && t.order !== o ? { ...t, order: o } : t;
  });
  return [...patched, { ...tx, order: orderById.get(tx.id) ?? 0 }];
}
