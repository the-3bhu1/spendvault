// SINGLE SOURCE OF TRUTH for the built-in account types. Anything asking "is this type native or a
// user-created custom type?" must read this list — it used to be hand-copied into FinanceContext's
// migration and Settings' custom-type validator, and they drifted ('epf' was missing from both, so
// EPF accounts got mis-filed as custom types and "epf" was accepted as a new custom type name).
// The union type is derived from the array so the two can never disagree again.
export const BUILT_IN_ACCOUNT_TYPES = [
  'credit_card', 'bank_account', 'cash', 'debit_card', 'e_wallet',
  'stocks', 'mutual_funds', 'rewards', 'commodity', 'epf',
] as const;
export type BuiltInAccountType = typeof BUILT_IN_ACCOUNT_TYPES[number];
export type AccountType = BuiltInAccountType | (string & {});
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

export interface CardDetails {
  cardholderName?: string;
  cardNumber?: string;    // Full card number (stored locally, app is PIN-protected)
  cvv?: string;           // 3 or 4 digit CVV
  expiryMonth?: number;   // 1–12
  expiryYear?: number;    // 2-digit, e.g. 27
  network?: CardNetwork;
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
  // balance/portfolio totals, but is KEPT in data so its past transactions still resolve its name
  // (shown with a "deleted" badge) instead of orphaning to "Unknown". Restorable from Settings.
  archived?: boolean;
  openingBalances: Record<string, number>; // key: 'YYYY-MM', value: number
  balanceAdjustments?: Record<string, number>; // key: 'YYYY-MM', value: number
  travelBalanceAdjustments?: Record<string, number>; // key: 'YYYY-MM', value: number
  balanceEditHistory?: BalanceEditEntry[];

  // Specific to credit_card
  statementDay?: number;
  dueDay?: number;
  defaultCashbackRate?: number;
  cashbackRates?: CashbackRate[];
  roundOffCashback?: boolean;
  cashbackCreditCycle?: 'same_cycle' | 'next_cycle';

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
  cashbackDestinationAccountId?: string;
  rewardUnit?: string;
  pointsConversionRate?: number;
  rewardType?: 'rupee' | 'points';
  rewardOpeningBalances?: Record<string, number>;
  rewardBalanceAdjustments?: Record<string, number>;

  // Specific to EPF (Employee Provident Fund)
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

export type TransactionType = 'credit' | 'debit';
export type RewardEarnedType = 'delayed' | 'instant' | 'none';

export interface Transaction {
  id: string;
  date: string; // ISO format 'YYYY-MM-DD'
  description: string;
  accountId: string;
  type: TransactionType;
  amount: number;
  category: string;
  isRecurring: boolean;
  appliedBillingCycleYearMonth?: string;

  // Specific to rewards and linking
  expectedCashback?: number; // Kept for backward compatibility, mapped to rewardEarned
  rewardEarned?: number;
  rewardEarnedType?: RewardEarnedType;
  rewardEarnedAccountId?: string;

  rewardUsed?: number;
  rewardUsedAccountId?: string;

  isTravelTransaction?: boolean;
  isRewardTransaction?: boolean;
  order?: number; // Added to support manual ordering
  linkedTransactionId?: string; // Legacy: ID of the auto-generated counterpart
  linkedTransactionIds?: string[]; // Multiple counterparts (e.g. Bank + Reward Account)
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

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

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
  customAccountTypes?: string[];
  /** Monthly spend budget (₹) per category name, e.g. { Food: 10000 }. Absent = no budget set. */
  categoryBudgets?: Record<string, number>;
  splitEvents?: SplitEvent[];
  recurringBills?: RecurringBill[];
  debts?: Debt[];
  theme?: 'light' | 'dark';
}
