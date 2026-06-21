// Single source of truth for backup minification.
//
// Backups are compressed by renaming every known field to a short code via KEY_MAP, and expanded
// back on import via the reverse map. This used to be duplicated in Settings.tsx (export + import)
// and OnboardingScreen.tsx (first-run import); the two copies drifted, so a compressed backup
// restored through onboarding silently failed to expand the keys missing from that copy (e.g.
// investment fields) — losing that data. Keeping the map and codec here, imported by both, makes
// that class of bug impossible.
//
// IMPORTANT: KEY_MAP is rename-only, NOT an allowlist — an unmapped key passes through with its
// full name (so data is never dropped), it just isn't compressed. Short codes must stay unique and
// must never be reused/reassigned, or previously-exported backups would decode to the wrong field.
export const KEY_MAP: Record<string, string> = {
  // Root keys
  version: 'v', exportedAt: 't', user: 'u', accounts: 'A', transactions: 'T',
  categories: 'C', tags: 'tg', customAccountTypes: 'X', cashbackStatements: 'S',
  categoryBudgets: 'CB',
  splitEvents: 'E', recurringBills: 'R', theme: 'm', debts: 'H',
  // User fields
  email: 'ue', profileImage: 'upi', pinHash: 'uph', recoveryKeyHash: 'urk',
  biometricsEnabled: 'ube', autoLogSms: 'uas', enablePassiveTransactions: 'uep',
  // Object keys (Accounts/Transactions/Debts)
  id: 'i', amount: 'a', date: 'd', description: 's', type: 'y',
  accountId: 'x', category: 'k', excludeFromStats: 'e', excludedAmount: 'ea',
  rewardUsed: 'r', rewardUsedAccountId: 'w', isTravelTransaction: 'l',
  rewardEarned: 're', rewardEarnedType: 'ret', rewardEarnedAccountId: 'rea',
  order: 'or', linkedTransactionId: 'lt', linkedTransactionIds: 'lts',
  cashbackLevelId: 'cl', linkedTxId: 'lx',
  appliedBillingCycleYearMonth: 'abc', recurringBillId: 'rbid',
  paymentSourceAccountId: 'psid', ccPaymentCycleTarget: 'ctar', isCCPaymentRecord: 'iscr',
  isRecurring: 'isrc', transactionId: 'txid', expectedCashback: 'exc',
  name: 'n', balance: 'b', color: 'c', icon: 'o', isNcmcEnabled: 'z',
  openingBalances: 'ob', statementDay: 'sd', dueDay: 'dd',
  defaultCashbackRate: 'dr', cashbackRates: 'cr', roundOffCashback: 'ro',
  cashbackCreditCycle: 'cc', travelOpeningBalances: 'tob', statementRounding: 'sr',
  isCashbackEnabled: 'ice',
  cardDetails: 'D', cardholderName: 'ch', cardNumber: 'cn', rate: 'rt',
  expiryMonth: 'em', expiryYear: 'ey', cvv: 'cv', network: 'nt',
  // Hub / SplitEvent / SplitItem keys
  people: 'pp', items: 'it', involvedPeople: 'ip', includeMe: 'im',
  splitType: 'st', paidBy: 'pb', shares: 'sh', customDays: 'cd',
  personName: 'pn', frequency: 'fq', nextDueDate: 'nd',
  isActive: 'ia', status: 'ss', createdAt: 'ca', updatedAt: 'ua',
  billingCycleYearMonth: 'bc', expected: 'ex', realized: 'rl',
  confirmed: 'cf', realizedIntoAccountId: 'ri', paidPeople: 'pd',
  // RecurringBill keys
  lastPaidDate: 'lpd',
  // New fields for custom reward points and balances
  balanceAdjustments: 'ba', travelBalanceAdjustments: 'tba',
  balanceEditHistory: 'beh', editedAt: 'eat', monthKey: 'mk', previousBalance: 'prb', newBalance: 'nwb',
  rewardType: 'ryt', rewardUnit: 'ryu', pointsConversionRate: 'pcr',
  rewardOpeningBalances: 'rob', rewardBalanceAdjustments: 'rba',
  isRewardTransaction: 'irt', cashbackDestinationAccountId: 'cda',
  // New fields for tours, sips, recurring splits, and debts
  sipAllottedAmount: 'saa', sipCharges: 'sc',
  hasSeenTour: 'hst', hasSeenFeatureTours: 'hsft',
  cycles: 'cy', currentCycleId: 'cci', cycleStartDate: 'csd',
  cycleNumber: 'cnm', startDate: 'sdt', endDate: 'edt', carriedOverPeople: 'cop',
  markedDone: 'md', linkedSipAccountId: 'lsa',
  // Stocks / SIPs / Commodity investment fields
  numberOfShares: 'ns', marketSymbol: 'ms', investedValue: 'iv', commodityMetal: 'cm',
  manualPricePerGram: 'mpg', avgNav: 'an',
  // Soft-delete flag (see Account.archived)
  archived: 'arc',
};

const REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k])
);

// Recursively rename keys to their short codes (unmapped keys keep their full name).
export const minifyPayload = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(minifyPayload);
  if (obj !== null && typeof obj === 'object') {
    const minified: any = {};
    for (const key in obj) {
      const newKey = KEY_MAP[key] || key;
      minified[newKey] = minifyPayload(obj[key]);
    }
    return minified;
  }
  return obj;
};

// Recursively restore short codes back to their full key names (unknown codes pass through).
export const expandPayload = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(expandPayload);
  if (obj !== null && typeof obj === 'object') {
    const expanded: any = {};
    for (const key in obj) {
      const originalKey = REVERSE_MAP[key] || key;
      expanded[originalKey] = expandPayload(obj[key]);
    }
    return expanded;
  }
  return obj;
};
