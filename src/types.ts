export type BuiltInAccountType = 'credit_card' | 'bank_account' | 'cash' | 'debit_card' | 'e_wallet' | 'stocks' | 'sips' | 'rewards';
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

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  openingBalances: Record<string, number>; // key: 'YYYY-MM', value: number

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
  statementRounding?: RoundingRule;
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
}

export interface SplitItem {
  id: string;
  transactionId: string;
  amount: number;
  description: string;
  involvedPeople: string[]; // List of names from the parent event
  includeMe: boolean;
  splitType: 'equal';
}

export interface SplitEvent {
  id: string;
  name: string;
  people: string[];
  paidPeople?: string[]; // Names of people who have settled their share
  items: SplitItem[];
  createdAt: number;
  status?: 'active' | 'settled';
}

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

export interface DebtTransaction {
  id: string;
  amount: number;
  date: string;
  description: string;
  type: 'lent' | 'borrowed' | 'repayment_received' | 'repayment_sent';
  linkedTxId?: string;
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
  customAccountTypes?: string[];
  splitEvents?: SplitEvent[];
  recurringBills?: RecurringBill[];
  debts?: Debt[];
  theme?: 'light' | 'dark';
}
