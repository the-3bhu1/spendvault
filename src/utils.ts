import { format, parseISO, addMonths, subMonths, addDays, addWeeks, addQuarters, addYears, setDate, isAfter, isBefore, startOfDay } from 'date-fns';
import type { Account, Transaction, CardNetwork, RoundingRule, CashbackStatement, SplitEvent, SplitCycle, SplitItem, RecurringFrequency } from './types';

// The canonical mutual-fund category name. It was previously "SIP" (and before that
// "SIP / Mutual Funds") — a SIP is only one way to buy, and the account type is really a
// mutual-fund holding, so the category is now named after the asset. Stored data is migrated on
// load (see FinanceContext), but isMutualFundCategory() also accepts the legacy spellings so a
// freshly-imported OLD backup and any un-migrated row still classify correctly.
// Always compare through the helper, never a bare string.
export const MUTUAL_FUNDS_CATEGORY = 'Mutual Funds';
const MUTUAL_FUND_CATEGORY_ALIASES = new Set([
  MUTUAL_FUNDS_CATEGORY.toLowerCase(),
  'sip',
  'sip / mutual funds',
]);
export const isMutualFundCategory = (category?: string) =>
  MUTUAL_FUND_CATEGORY_ALIASES.has((category || '').toLowerCase());

// Categories that never count toward Spends/Income stats: pure ledger movements (transfers, CC bill
// payments, NCMC recharges), investments tracked separately (mutual funds/stocks/commodity), and
// lending & borrowing (money lent out or borrowed isn't a real spend/income — it's expected back).
// Single source of truth so every stats surface (Dashboard, Insights, Transactions) stays in sync.
export const STATS_EXCLUDED_CATEGORIES = new Set([
  'transfer', 'cc payment', 'ncmc travel recharge', 'mutual funds', 'sip', 'stocks', 'commodity', 'lending & borrowing'
]);
export const isStatsExcludedCategory = (category: string) =>
  STATS_EXCLUDED_CATEGORIES.has((category || '').toLowerCase());

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
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
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
    let cleanAmount = amount;
    if (Math.round(amount * 100) / 100 === 0) {
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

// Function to calculate credit card billing cycle for a given date
// If statementDay is 16, a transaction on the 16th falls into the NEXT cycle.
// This matches the rule that unbilled becomes billed exactly at 00:00 on the statement day.
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

// Start Date and End Date for a cycle string 'yyyy-MM' and statementDay
export const getBillingCycleDates = (cycle: string, statementDay: number) => {
  const statementDate = setDate(parseISO(`${cycle}-01`), statementDay);
  const endDate = addDays(statementDate, -1);
  const startDate = addMonths(statementDate, -1);
  return { startDate, endDate };
};

export const calculateCycleBalanceForCycle = (
  account: Account,
  transactions: Transaction[],
  cycle: string
): number => {
  const statementDay = account.statementDay || 1;
  return transactions
    .filter(t => {
      if (t.accountId !== account.id) return false;
      if (t.type === 'credit' && t.appliedBillingCycleYearMonth) {
        return t.appliedBillingCycleYearMonth === cycle;
      }
      return getBillingCycleForDate(t.date, statementDay) === cycle;
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

export const getLatestBilledCycle = (statementDay: number): string => {
  const today = new Date();
  const currentCycle = getBillingCycleForDate(format(today, 'yyyy-MM-dd'), statementDay);
  const currentCycleDate = parseISO(`${currentCycle}-01`);
  return format(subMonths(currentCycleDate, 1), 'yyyy-MM');
};

// Calculates the most recent statement generation date based on a given statement Day (1-31)
export const getMostRecentStatementDate = (statementDay: number) => {
  const today = startOfDay(new Date());
  let candidate = setDate(today, statementDay);
  if (isAfter(candidate, today)) {
    // If the 13th of this month is in the future, the last statement was last month
    candidate = addMonths(candidate, -1);
  }
  return candidate;
};

import { calculateEPFProjection } from './utils/epfEngine';

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
    const debitsTotal = rewardDebits.reduce((sum, t) => sum + t.amount, 0);

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
      return !t.isTravelTransaction && !t.isRewardTransaction;
    });

    change = relevantTransactions.reduce((acc, t) => {
      let effectiveAmount = t.amount;
      
      // For standard split expenses, the primary account only pays the out-of-pocket amount
      if (t.type === 'debit' && t.rewardUsed && t.rewardUsed > 0 && t.rewardUsedAccountId) {
        effectiveAmount = t.amount - t.rewardUsed;
      }

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

export const calculateTotalSpendPerCycle = (transactions: Transaction[], accountId: string, cycle: string, statementDay: number, rounding: RoundingRule = 'none') => {
  const ccTransactions = transactions.filter(t => t.accountId === accountId);
  let spend = 0;
  let payment = 0;
  
  ccTransactions.forEach(t => {
    const tCycle = t.appliedBillingCycleYearMonth || getBillingCycleForDate(t.date, statementDay);
    if (tCycle === cycle) {
      if (t.type === 'debit') spend += t.amount;
      if (t.type === 'credit') payment += t.amount;
    }
  });

  const rawNet = spend - payment;
  let netPayable = rawNet;
  if (rounding === 'round') netPayable = Math.round(rawNet);
  else if (rounding === 'floor') netPayable = Math.floor(rawNet);
  else if (rounding === 'ceil') netPayable = Math.ceil(rawNet);

  return { spend, payment, netPayable };
};

export const getCardGradients = (themeIndex: number, network?: CardNetwork) => {
  if (network === 'amex') {
    return {
      front: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
      back: 'linear-gradient(135deg, #111827 0%, #0f131a 100%)'
    };
  }
  
  const themes = [
    { front: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', back: 'linear-gradient(135deg, #16213e 0%, #0f3460 100%)' }, // Blue
    { front: 'linear-gradient(135deg, #2b0f19 0%, #3d1524 50%, #4a1528 100%)', back: 'linear-gradient(135deg, #3d1524 0%, #4a1528 100%)' }, // Burgundy
    { front: 'linear-gradient(135deg, #0f2b26 0%, #133b34 50%, #164a41 100%)', back: 'linear-gradient(135deg, #133b34 0%, #164a41 100%)' }, // Emerald
    { front: 'linear-gradient(135deg, #1b1338 0%, #24194a 50%, #2d205c 100%)', back: 'linear-gradient(135deg, #24194a 0%, #2d205c 100%)' }, // Indigo
    { front: 'linear-gradient(135deg, #1f1f1f 0%, #141414 50%, #0a0a0a 100%)', back: 'linear-gradient(135deg, #141414 0%, #0a0a0a 100%)' }, // Onyx
    { front: 'linear-gradient(135deg, #2c3e50 0%, #000000 100%)', back: 'linear-gradient(135deg, #1c2833 0%, #000000 100%)' }, // Charcoal
    { front: 'linear-gradient(135deg, #1a2a6c 0%, #b21f1f 50%, #fdbb2d 100%)', back: 'linear-gradient(135deg, #1a2a6c 0%, #b21f1f 100%)' }, // Sunset
    { front: 'linear-gradient(135deg, #301934 0%, #1e0d21 100%)', back: 'linear-gradient(135deg, #1e0d21 0%, #000000 100%)' }, // Deep Purple
    { front: 'linear-gradient(135deg, #010c1e 0%, #001f3f 100%)', back: 'linear-gradient(135deg, #001f3f 0%, #000000 100%)' }, // Midnight Navy
    { front: 'linear-gradient(135deg, #0b1e0b 0%, #1e3a1e 100%)', back: 'linear-gradient(135deg, #1e3a1e 0%, #000000 100%)' }, // Forest Green
  ];

  const index = Math.abs(themeIndex) % themes.length;
  return themes[index];
};

export const APP_VERSION = 'v2.1.0';

// ─── Recurring Split Cycle Helpers ──────────────────────────────────────────

/** Returns the end date (start of next cycle) given a cycle's start date + frequency. */
export const getNextCycleEndDate = (startDate: string, freq: RecurringFrequency, customDays?: number): string => {
  const d = parseISO(startDate);
  let next: Date;
  switch (freq) {
    case 'daily':     next = addDays(d, 1); break;
    case 'weekly':    next = addWeeks(d, 1); break;
    case 'monthly':   next = addMonths(d, 1); break;
    case 'quarterly': next = addQuarters(d, 1); break;
    case 'yearly':    next = addYears(d, 1); break;
    case 'custom':    next = addDays(d, customDays ?? 1); break;
    default:          next = addMonths(d, 1);
  }
  return format(next, 'yyyy-MM-dd');
};

/** True if today is on or after the current cycle's endDate. */
export const isCycleDue = (event: SplitEvent): boolean => {
  if (!event.isRecurring || !event.cycles || event.cycles.length === 0) return false;
  const current = event.cycles.find(c => c.id === event.currentCycleId);
  if (!current || current.status === 'settled') return false;
  const today = startOfDay(new Date());
  const end = parseISO(current.endDate);
  return !isBefore(today, end); // today >= endDate
};

/** Creates a brand-new SplitCycle object for the next period. */
export const buildNewCycle = (
  event: SplitEvent,
  prevCycle?: SplitCycle,
  copyItems: boolean = false
): SplitCycle => {
  const startDate = prevCycle ? prevCycle.endDate : (event.cycleStartDate || format(new Date(event.createdAt), 'yyyy-MM-dd'));
  const endDate = getNextCycleEndDate(startDate, event.frequency ?? 'monthly', event.customDays);
  const cycleNumber = prevCycle ? prevCycle.cycleNumber + 1 : 1;
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `cycle-${Date.now()}`,
    cycleNumber,
    startDate,
    endDate,
    items: copyItems && prevCycle ? [...prevCycle.items.map(i => ({ ...i, id: crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}-${i.id}` }))] : [],
    paidPeople: [],
    status: 'active',
  };
};

/**
 * One-time migration: takes a legacy recurring event (flat items/paidPeople)
 * and wraps everything into Cycle 1, returning the updated event.
 */
export const migrateEventToCycles = (event: SplitEvent): SplitEvent => {
  if (!event.isRecurring) return event;
  if (event.cycles && event.cycles.length > 0) return event; // already migrated

  const startDate = event.cycleStartDate || format(new Date(event.createdAt), 'yyyy-MM-dd');
  const endDate = getNextCycleEndDate(startDate, event.frequency ?? 'monthly', event.customDays);
  const cycle1: SplitCycle = {
    id: crypto.randomUUID ? crypto.randomUUID() : `cycle-${Date.now()}`,
    cycleNumber: 1,
    startDate,
    endDate,
    items: event.items ?? [],
    paidPeople: event.paidPeople ?? [],
    status: event.status ?? 'active',
  };
  return {
    ...event,
    cycles: [cycle1],
    currentCycleId: cycle1.id,
  };
};
