// SINGLE SOURCE OF TRUTH for the built-in account types. Anything asking "is this type native or a
// user-created custom type?" must read this list — it used to be hand-copied into FinanceContext's
// migration and Settings' custom-type validator, and they drifted ('epf' was missing from both, so
// EPF accounts got mis-filed as custom types and "epf" was accepted as a new custom type name).
// The union type is derived from the array so the two can never disagree again.
export const BUILT_IN_ACCOUNT_TYPES = [
  'credit_card', 'bank_account', 'cash', 'debit_card', 'e_wallet',
  'stocks', 'mutual_funds', 'rewards', 'commodity', 'epf', 'offset',
] as const;
export type BuiltInAccountType = typeof BUILT_IN_ACCOUNT_TYPES[number];
export type AccountType = BuiltInAccountType | (string & {});

// 'offset' shipped as a user-created CUSTOM type long before it became native, and it was spelled
// several ways by hand. Every one of those spellings has to resolve to the native key, otherwise the
// old custom type survives alongside the built-in one and the pickers list the same thing twice.
// scripts/migrate-offset-account-type.mjs mirrors this list for backup files migrated outside the app.
export const OFFSET_TYPE_ALIASES: readonly string[] = [
  'offset', 'offset ledger', 'offset_ledger', 'offset-ledger', 'offsetledger',
];
export const isOffsetTypeAlias = (type: string): boolean =>
  OFFSET_TYPE_ALIASES.includes(type.trim().toLowerCase());

export type RoundingRule = 'round' | 'floor' | 'ceil' | 'none';

export interface EPFSalaryRevision {
  id: string;
  effectiveDate: string; // 'YYYY-MM-DD'
  basicSalary: number;
  dearnessAllowance?: number; // defaults to 0
  employeeContributionPct?: number; // default 12%
  employerContributionPct?: number; // default 12%
  notes?: string; // e.g. "Annual Increment", "Promotion", "Job Change"
}

export interface EPFInterestRateConfig {
  financialYear: string; // e.g. "FY 2024-25", "FY 2025-26"
  annualRate: number; // e.g. 8.25
}

export interface EPFBalanceAdjustment {
  id: string;
  date: string; // 'YYYY-MM-DD'
  balance: number;
  notes?: string; // e.g. "Passbook Verification", "Manual Correction"
}

export interface EPFProjectionResult {
  balance: number;
  employeeContribution: number;
  employerEPFContribution: number;
  employerEPSContribution: number;
  totalContribution: number;
  accruedInterest: number;
  projectedOneYearBalance: number;
  projectedDecBalance: number;
  effectiveSalary: {
    basic: number;
    da: number;
    effectiveDate: string;
  };
}

export interface CashbackRate {
  id: string;
  name: string; // e.g. "UPI", "Card Swipe"
  rate: number; // e.g. 3, 1
  roundOffCashback?: boolean;
}

export type CardNetwork = 'visa' | 'mastercard' | 'rupay' | 'amex' | 'diners';

/**
 * Brand marks a card can carry: the issuing bank, printed on the front, and the
 * co-brand programme, printed on the back. Artwork lives in CardBrandLogo.
 */
export type BrandKey =
  | 'hdfc' | 'axis' | 'csb' | 'tide'          // issuers, cards held
  | 'federal' | 'icici' | 'idfc' | 'indusind' | 'sbi'  // issuers, ready but unused
  | 'swiggy' | 'supermoney' | 'jupiter'       // co-brands
  | 'axismark';                               // symbol only, for watermarks

export interface CardDetails {
  cardholderName?: string;
  cardNumber?: string;    // Full card number (stored locally, app is PIN-protected)
  cvv?: string;           // 3 or 4 digit CVV
  expiryMonth?: number;   // 1–12
  expiryYear?: number;    // 2-digit, e.g. 27
  network?: CardNetwork;
  /**
   * Issuing bank, chosen explicitly. Optional: resolveCardIssuer() infers one
   * from the card's name when it safely can, and this overrides that. Set it for
   * a card whose name doesn't say which bank issued it — Jupiter ships on both
   * CSB and Federal, so "Jupiter" alone is unresolvable but "Jupiter CSB" isn't.
   */
  issuer?: BrandKey;
}

/**
 * What a card COSTS TO HOLD, as opposed to what it currently owes.
 *
 * Four arrangements are in circulation and this shape carries all of them without a discriminant,
 * because they are not four kinds of thing — they are four settings of the same three numbers:
 *
 *   Lifetime free      no annualFee (joiningFee may still be set — some LTF cards charge to issue)
 *   First year free    annualFee set, firstYearFree true
 *   Joining + annual   joiningFee and annualFee both set
 *   Spend-waived       annualFee set, waiverSpend set
 *
 * The WHOLE BLOCK IS ABSENT on a lifetime-free card, and that is the shape rather than an omission:
 * the fee picker stores nothing when "Lifetime free" is chosen, because there is no amount to store.
 * So absent means lifetime free, and a card nobody has described reads the same way. Those two were
 * briefly meant to be distinguishable — hence an earlier "Not set" on the card summary — but once
 * choosing LTF and never touching the form produce the identical value there is nothing left to tell
 * apart, and LTF is the right thing to be wrong about: it is the commonest card in the country.
 *
 * annualFee is what separates the two branches. Everything else is a detail hanging off it, which is
 * why a waiver or a first free year on a card with no annual fee is ignored rather than honoured.
 */
export interface CardFees {
  /** One-time, charged when the card was issued. */
  joiningFee?: number;
  /** Charged at every renewal. Absent means the card is lifetime free — see above. */
  annualFee?: number;
  /** The first renewal is skipped. Only meaningful alongside annualFee. */
  firstYearFree?: boolean;
  /** Spend within ONE membership year that waives the NEXT annual fee. Absent means never waived. */
  waiverSpend?: number;
}

export interface BalanceEditEntry {
  editedAt: string;        // ISO datetime of the edit
  monthKey: string;        // 'YYYY-MM' the edit applies to
  previousBalance: number;
  newBalance: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  // Soft-delete flag. An archived account is hidden from the accounts list, selection pickers and
  // balance/wealth totals, but is KEPT in data so its past transactions still resolve its name
  // (shown with a "deleted" badge) instead of orphaning to "Unknown". Restorable from Settings.
  archived?: boolean;
  openingBalances: Record<string, number>; // key: 'YYYY-MM', value: number
  balanceAdjustments?: Record<string, number>; // key: 'YYYY-MM', value: number
  travelBalanceAdjustments?: Record<string, number>; // key: 'YYYY-MM', value: number
  balanceEditHistory?: BalanceEditEntry[];

  // Specific to credit_card
  statementDay?: number;
  dueDay?: number;
  creditLimit?: number;
  defaultCashbackRate?: number;
  cashbackRates?: CashbackRate[];
  roundOffCashback?: boolean;
  cashbackCreditCycle?: 'same_cycle' | 'next_cycle';
  /** What the card costs to hold. See CardFees — absent means lifetime free. */
  cardFees?: CardFees;
  /**
   * When the card was issued, 'YYYY-MM-DD'. The anchor for the MEMBERSHIP YEAR, which is the window
   * a bank actually measures a fee waiver over — not the financial year and not the calendar year.
   *
   * Optional, and the card summary degrades rather than guesses when it is missing: it falls back to
   * the financial year and says so, because a waiver bar measured over the wrong twelve months would
   * read "waived" while the bank was still charging.
   */
  cardOpenedOn?: string;

  // Specific to debit_card/ncmc travel
  isNcmcEnabled?: boolean;
  travelOpeningBalances?: Record<string, number>;
  isCashbackEnabled?: boolean;

  // Optional saved card details (credit_card / debit_card only)
  cardDetails?: CardDetails;

  // Specific to commodity (gold, silver)
  commodityMetal?: 'gold' | 'silver';
  // Optional manual price override (₹/gram). Takes precedence over the AI estimate when set.
  manualPricePerGram?: number;

  // Specific to stocks / mutual funds
  numberOfShares?: number;
  marketSymbol?: string;
  investedValue?: number;
  avgNav?: number;
  statementRounding?: RoundingRule;
  /** Hand-entered statement figures, keyed by cycle ('YYYY-MM'). A bank's rounding is not always
   *  the rule you told us about — it can round the other way on one cycle, or change its policy —
   *  and the printed bill is the authority. An entry here wins over the derived figure for that
   *  cycle and nothing else; clearing it hands the cycle back to statementRounding. */
  statementAdjustments?: Record<string, number>;
  cashbackDestinationAccountId?: string;
  rewardUnit?: string;
  pointsConversionRate?: number;
  rewardType?: 'rupee' | 'points';
  rewardOpeningBalances?: Record<string, number>;
  rewardBalanceAdjustments?: Record<string, number>;

  // Specific to EPF (Employee Provident Fund)
  currentEmployer?: string;
  joiningDate?: string;
  baseBalance?: number;
  baseBalanceDate?: string;
  epfContributionBasis?: 'statutory_ceiling' | 'actual_basic';
  salaryRevisions?: EPFSalaryRevision[];
  isEpsDisabled?: boolean;
  epsWageCeiling?: number;
  interestRateOverrides?: EPFInterestRateConfig[];
  epfBalanceAdjustments?: EPFBalanceAdjustment[];
}

/** One reward source funding part of a transaction, and the leg it debited.
 *
 *  A split used to be a single pair of fields on the anchor (`rewardUsed` + `rewardUsedAccountId`),
 *  which could only ever name ONE source — so a bill part-paid from two wallets had to be logged as
 *  two transactions. This is that pair, made plural: the anchor holds a list, one entry per source,
 *  and `rewardUsed` became the TOTAL across them (so every consumer that does arithmetic with it —
 *  `amount = total - rewardUsed`, the Option-B rebalance, the stats — kept working untouched).
 *
 *  `legId` is what makes a multi-source split identifiable. With one source, "which leg is the
 *  redemption?" could be answered by the account the anchor pointed at; with several, the answer has
 *  to be recorded, or moving one source's picker makes its leg indistinguishable from a sibling's.
 *  It is absent on rows written before this existed (and on an external source, which has no leg),
 *  and those fall back to matching on the account — see `rewardSplitOfLeg` in utils. */
export interface RewardSplitLeg {
  /** A reward account's id, or EXTERNAL_REWARD_SOURCE_ID for an untracked one-time reward. */
  accountId: string;
  /** Rupees this source paid. Always rupees, like every other amount in the ledger; the points
   *  conversion happens when the source's points balance is read (see docs/LINKED_TRANSACTIONS.md). */
  amount: number;
  /** The debit leg this source generated. Absent for an external one-time reward — there is no
   *  account to debit — and for legacy single-source rows. */
  legId?: string;
}

export type TransactionType = 'credit' | 'debit';
export type RewardEarnedType = 'delayed' | 'instant' | 'none';
// Sub-kinds of the single 'Investments' category. Values deliberately match the corresponding
// Account['type'] ('mutual_funds' | 'stocks' | 'commodity') — that 1:1 pairing is what lets the kind
// of a legacy investment transaction be recovered from the account it moved money into or out of.
export type InvestmentKind = 'mutual_funds' | 'stocks' | 'commodity';

export interface Transaction {
  id: string;
  date: string; // ISO format 'YYYY-MM-DD'
  description: string;
  accountId: string;
  type: TransactionType;
  amount: number;
  category: string;
  isRecurring: boolean;
  /** What the OTHER leg of a transfer moves, when the two sides differ. Absent means 1:1.
   *  POV-neutral on purpose: logged as a debit it is the amount the destination received,
   *  logged as a credit it is the amount the source was debited. A discounted gift-card load
   *  (pay ₹180, receive ₹200 of balance) and a fee-charging transfer (send ₹200, ₹197 lands)
   *  are the same shape in opposite directions, so nothing here assumes which side is larger.
   *  Mirrored onto the counterpart row by updateTransaction, so either leg can be edited. */
  counterpartAmount?: number;
  appliedBillingCycleYearMonth?: string;
  /** Set only when appliedBillingCycleYearMonth was chosen deliberately by a statement-screen
   *  long-press. It exists to tell that apart from the SAME field written by an old build, which
   *  stamped every card credit with the "Apply Payment To" default even though the picker was never
   *  shown — see the note in LogTransactionForm's handleSave. Both look identical by value, so
   *  without this flag the log form cannot know whether to preserve the cycle on save or clear it.
   *  Absent means legacy (or never moved), which is why it needs no migration. */
  cycleMovedManually?: boolean;

  // Specific to rewards and linking
  expectedCashback?: number; // Kept for backward compatibility, mapped to rewardEarned
  rewardEarned?: number;
  rewardEarnedType?: RewardEarnedType;
  rewardEarnedAccountId?: string;

  /** TOTAL rupees redeemed across every reward source on this row. With one source it is that
   *  source's amount, which is what it has always meant; with several it is their sum. */
  rewardUsed?: number;
  /** The FIRST reward source. Retained beside `rewardSplits` because `!!rewardUsedAccountId` is the
   *  app's "this row anchors a split" test, and because a single-source split written by any older
   *  build (or read by one) is exactly this field. */
  rewardUsedAccountId?: string;
  /** Every source funding this row, in the order they were added. Authoritative when present;
   *  absent on rows written before multi-source splits, which `getRewardSplits` reconstructs from
   *  the two fields above. Never empty — a cleared split drops the field. */
  rewardSplits?: RewardSplitLeg[];

  isTravelTransaction?: boolean;
  isRewardTransaction?: boolean;
  order?: number; // Added to support manual ordering
  linkedTransactionId?: string; // Legacy: ID of the auto-generated counterpart
  /** Ids of this row's counterparts (e.g. Bank + Reward Account on a 3-leg split).
   *
   *  NOT every id in here names a Transaction. A row logged from the Lending & Borrowing screen
   *  carries the id of its DebtTransaction — an entry inside `debts[].transactions[]`, a different
   *  collection — and that cross-reference is load-bearing: it is the primary way
   *  updateTransaction finds the debt entry to keep in step, and the way deleteTransaction knows
   *  to retire it (see FinanceContext, "Scenario C", and Debts.tsx handleAddDebt).
   *
   *  So resolving these against `transactions` alone WILL leave misses, and those misses are not
   *  rot to be swept up — deleting them decouples a debt from its ledger row. Anything walking
   *  this list has to tolerate an id it cannot resolve rather than treat it as broken. */
  linkedTransactionIds?: string[];
  cashbackLevelId?: string; // ID of the specific CashbackRate selected
  excludeFromStats?: boolean;
  excludedAmount?: number;
  recurringBillId?: string;
  paymentSourceAccountId?: string;
  ccPaymentCycleTarget?: 'current_cycle' | 'previous_statement';
  isCCPaymentRecord?: boolean;
  // Investment legs (Mutual Funds / Stocks): the amount actually invested vs. the broker/AMC
  // charges on top of it. Total debited = allottedAmount + investmentCharges.
  allottedAmount?: number;
  investmentCharges?: number;
  numberOfShares?: number;
  /** Which kind of investment an 'Investments' transaction is. Mutual funds, stocks and commodity
   *  share one category but each has its own fields (units vs. shares vs. grams), account type and
   *  auto-description, so the kind is what selects that behaviour. Only meaningful when the
   *  category is 'Investments'; read it via getInvestmentKind(), which also infers it for rows
   *  written before this field existed. */
  investmentKind?: InvestmentKind;
  tags?: string[];
}

export interface CashbackStatement {
  id: string;
  accountId: string;
  billingCycleYearMonth: string; // 'YYYY-MM'
  expected: number;
  realized: number;
  confirmed: boolean;
  realizedIntoAccountId?: string; // Account where reward was deposited
}

export interface User {
  id: string;
  name: string;
  email?: string;
  profileImage?: string; // Base64 string
  pinHash?: string; // SHA-256 hash of the 4-digit PIN
  /** @deprecated Use pinHash instead. Stays here only for migration. */
  pin?: string;
  recoveryKeyHash?: string;
  /** True once the user has finished onboarding. Decoupled from pinHash so a user can
   *  complete onboarding without setting a PIN (app-lock is optional). */
  onboarded?: boolean;
  biometricsEnabled: boolean;
  autoLogSms?: boolean;
  /** Opt-in: send SMS that pass the keyword parser to Gemini as a second filter to drop
   *  misleading non-transactions. Requires the shared Gemini key (Settings → AI Features). */
  aiSmsFilter?: boolean;
  /** Opt-in: enable the "Ask Vault" in-app assistant. When on, a summary of the user's finances
   *  and relevant transactions are sent to Gemini to answer questions. Requires the Gemini key. */
  aiAssistant?: boolean;
  enablePassiveTransactions?: boolean;
  hasSeenTour?: boolean;
  hasSeenFeatureTours?: Record<string, boolean>;
}

export interface SplitItem {
  id: string;
  transactionId: string;
  amount: number;
  description: string;
  involvedPeople: string[]; // List of names from the parent event
  includeMe: boolean;
  splitType: 'equal' | 'unequal';
  shares?: Record<string, number>; // Maps participant name (or 'me') to their custom share amount
  paidBy?: string; // Who paid for this expense: 'me' or name of friend
}

export interface SplitCycle {
  id: string;
  cycleNumber: number;         // 1-indexed
  startDate: string;           // 'YYYY-MM-DD'
  endDate: string;             // 'YYYY-MM-DD' — first day of next cycle (exclusive)
  items: SplitItem[];          // snapshot of items added in this cycle
  paidPeople: string[];        // who settled in THIS cycle
  status: 'active' | 'settled';
  carriedOverPeople?: string[]; // people still unpaid when this cycle ended
}

export interface SplitEvent {
  id: string;
  name: string;
  people: string[];
  paidPeople?: string[]; // Names of people who have settled their share (non-recurring events)
  items: SplitItem[];    // Used for non-recurring events; for recurring, use cycles[].items
  createdAt: number;
  status?: 'active' | 'settled';
  isRecurring?: boolean;
  frequency?: RecurringFrequency;
  customDays?: number;
  // Recurring-only fields:
  cycleStartDate?: string;   // 'YYYY-MM-DD' — user-set anchor date for cycle 1
  cycles?: SplitCycle[];     // all cycles (historical + current)
  currentCycleId?: string;   // ID of the currently active cycle
}

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'custom';

export interface DebtTransaction {
  id: string;
  amount: number;
  date: string;
  description: string;
  type: 'lent' | 'borrowed' | 'repayment_received' | 'repayment_sent';
  linkedTxId?: string;
  markedDone?: boolean;
}

export interface Debt {
  id: string;
  personName: string;
  transactions: DebtTransaction[];
  status: 'active' | 'settled';
  createdAt: number;
  updatedAt: number;
}

export interface RecurringBill {
  id: string;
  name: string;
  amount: number;
  category: string;
  frequency: RecurringFrequency;
  customDays?: number; // Used when frequency is 'custom'
  nextDueDate: string; // ISO format 'YYYY-MM-DD'
  accountId?: string; // Preferred account to pay from
  type: TransactionType;
  isActive: boolean;
  lastPaidDate?: string; // ISO format 'YYYY-MM-DD'
}

export interface FinanceData {
  user?: User;
  accounts: Account[];
  transactions: Transaction[];
  cashbackStatements: CashbackStatement[];
  categories: string[];
  tags?: string[];
  eventTags?: string[];
  customAccountTypes?: string[];
  /** Monthly spend budget (₹) per category name, e.g. { Food: 10000 }. Absent = no budget set. */
  categoryBudgets?: Record<string, number>;
  splitEvents?: SplitEvent[];
  recurringBills?: RecurringBill[];
  debts?: Debt[];
  theme?: 'light' | 'dark';
}
