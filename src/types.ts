export type BuiltInAccountType = 'credit_card' | 'bank_account' | 'cash' | 'debit_card' | 'e_wallet' | 'stocks' | 'sips' | 'rewards' | 'commodity';
export type AccountType = BuiltInAccountType | (string & {});
export type RoundingRule = 'round' | 'floor' | 'ceil' | 'none';

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

  // Specific to stocks / sips
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
  sipAllottedAmount?: number;
  sipCharges?: number;
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
  biometricsEnabled: boolean;
  autoLogSms?: boolean;
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
  linkedSipAccountId?: string; // SIP account to credit when logging (only for SIP category)
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
