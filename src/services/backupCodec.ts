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
  categories: 'C', tags: 'tg', eventTags: 'etg', customAccountTypes: 'X', cashbackStatements: 'S',
  categoryBudgets: 'CB',
  splitEvents: 'E', recurringBills: 'R', theme: 'm', debts: 'H',
  // User fields
  email: 'ue', profileImage: 'upi', pinHash: 'uph', recoveryKeyHash: 'urk',
  biometricsEnabled: 'ube', autoLogSms: 'uas', enablePassiveTransactions: 'uep',
  onboarded: 'uob', aiSmsFilter: 'uaf', aiAssistant: 'uaa',
  // Object keys (Accounts/Transactions/Debts)
  id: 'i', amount: 'a', date: 'd', description: 's', type: 'y',
  accountId: 'x', category: 'k', excludeFromStats: 'e', excludedAmount: 'ea',
  rewardUsed: 'r', rewardUsedAccountId: 'w', isTravelTransaction: 'l',
  // Every source of a multi-wallet reward split. 'rs' is the list; each entry reuses the existing
  // 'x' (accountId) and 'a' (amount) codes, and 'rlg' names the leg it debits. `rewardUsed` and
  // `rewardUsedAccountId` above are still written beside it (the total, and the first source), so a
  // backup restored into an older build keeps a working single-source split.
  rewardSplits: 'rs', legId: 'rlg',
  rewardEarned: 're', rewardEarnedType: 'ret', rewardEarnedAccountId: 'rea',
  order: 'or', linkedTransactionId: 'lt', linkedTransactionIds: 'lts',
  cashbackLevelId: 'cl', linkedTxId: 'lx',
  appliedBillingCycleYearMonth: 'abc', cycleMovedManually: 'cmm', recurringBillId: 'rbid',
  paymentSourceAccountId: 'psid', ccPaymentCycleTarget: 'ctar', isCCPaymentRecord: 'iscr',
  counterpartAmount: 'cpa',
  isRecurring: 'isrc', transactionId: 'txid', expectedCashback: 'exc',
  name: 'n', isNcmcEnabled: 'z',
  // MOSTLY RETIRED: 'c'/'o' mapped Account.color/icon, neither of which exists on Account any more
  // (colour/icon were never shipped). They stay mapped so an ancient backup still expands them to a
  // named field instead of a raw 2-char key. 'b' is NOT retired — Account.balance became the per-month
  // openingBalances map, but EPFBalanceAdjustment.balance still uses this code today (same field name,
  // so the shared mapping is correct). Like 'lsa', these codes are burnt — never repoint them.
  balance: 'b', color: 'c', icon: 'o',
  openingBalances: 'ob', statementDay: 'sd', dueDay: 'dd', creditLimit: 'clim',
  defaultCashbackRate: 'dr', cashbackRates: 'cr', roundOffCashback: 'ro',
  currentEmployer: 'ce',
  cashbackCreditCycle: 'cc', travelOpeningBalances: 'tob', statementRounding: 'sr', statementAdjustments: 'sa',
  isCashbackEnabled: 'ice',
  cardDetails: 'D', cardholderName: 'ch', cardNumber: 'cn', rate: 'rt',
  expiryMonth: 'em', expiryYear: 'ey', cvv: 'cv', network: 'nt', issuer: 'isr',
  // What a card costs to hold, and the date the membership year is measured from. 'af' is the
  // annual fee — mind that 'sa'/'saa' are already taken and unrelated.
  cardFees: 'CF', joiningFee: 'jf', annualFee: 'af', firstYearFree: 'fyf', waiverSpend: 'wvs',
  cardOpenedOn: 'cod',
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
  // New fields for tours, investments, recurring splits, and debts.
  // NOTE: 'saa'/'sc' were minted for the old field names sipAllottedAmount/sipCharges. Those fields
  // were RENAMED (not replaced) to allottedAmount/investmentCharges, so keeping the same codes is
  // correct and keeps every previously-exported backup decoding into the new names.
  allottedAmount: 'saa', investmentCharges: 'sc', investmentKind: 'ik',
  hasSeenTour: 'hst', hasSeenFeatureTours: 'hsft',
  cycles: 'cy', currentCycleId: 'cci', cycleStartDate: 'csd',
  cycleNumber: 'cnm', startDate: 'sdt', endDate: 'edt', carriedOverPeople: 'cop',
  markedDone: 'md',
  // RETIRED: 'lsa' = RecurringBill.linkedSipAccountId, from when mutual funds could be tracked as
  // bills. The field is gone; the code stays mapped so old backups still expand it to a recognisable
  // name that the load migration then strips. Never reassign 'lsa' to a different field.
  linkedSipAccountId: 'lsa',
  // Stocks / Mutual Funds / Commodity / EPF investment fields
  numberOfShares: 'ns', marketSymbol: 'ms', investedValue: 'iv', commodityMetal: 'cm',
  manualPricePerGram: 'mpg', avgNav: 'an', epfContributionBasis: 'ecb',
  joiningDate: 'jd', baseBalance: 'bb', baseBalanceDate: 'bbd',
  salaryRevisions: 'srv', isEpsDisabled: 'ied', epsWageCeiling: 'ewc',
  interestRateOverrides: 'iro', epfBalanceAdjustments: 'eba',
  basicSalary: 'bs', dearnessAllowance: 'da', employeeContributionPct: 'ecp', employerContributionPct: 'ercp',
  effectiveDate: 'efd',
  // EPF sub-object fields that were left unmapped when EPF shipped, so they went into backups at full
  // length. Adding them is backward-compatible: an older backup carries the long names, which pass
  // through expandPayload untouched (the reverse lookup only fires on a known short code).
  // 'notes' is shared by EPFSalaryRevision and EPFBalanceAdjustment — one code covers both.
  financialYear: 'fyr', annualRate: 'anr', notes: 'nte',
  // Soft-delete flag (see Account.archived)
  archived: 'arc',
};

const REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k])
);

// Recursively rename keys to their short codes (unmapped keys keep their full name).
export const minifyPayload = (obj: any): any => {
  if (typeof obj === 'string') return obj.trim();
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
  if (typeof obj === 'string') return obj.trim();
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
