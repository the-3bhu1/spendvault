import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import type { Account, CashbackStatement, FinanceData, Transaction, User, SplitEvent, RecurringBill, Debt, DebtTransaction } from './types';
import { BUILT_IN_ACCOUNT_TYPES, isOffsetTypeAlias } from './types';
import { classifySmsIsTransaction } from './services/GeminiService';
import { clearChatHistory } from './services/ChatHistoryService';
import {
  INVESTMENT_CATEGORY, isInvestmentCategory, inferInvestmentKind, getInvestmentKind,
  getRewardSplits, isRewardSourceOf, redistributeRewardSplits, rewardLegIdsOf,
  rewardSplitIndexOfLeg, rewardSplitOfLeg, rewardSplitTotal, withRewardSplits,
  insertIntoDay, linkedGroupOf, linkedIdsOf, sortDayByOrder,
} from './utils';
import { resolveRewardLegPlan } from './services/RewardLegService';

export interface PendingTransfer {
  fromAccountId: string;
  amount: number;
  triggerTabSwitch?: boolean;
}

export interface PendingSmsTransaction {
  amount: number;
  type: 'debit' | 'credit' | 'unknown';
  merchant: string | null;
  source: string;
  sourceIdentifier?: string;
  timestamp: number;
  raw: string;
  // Set when this SMS is one leg of a multi-leg real-world event (e.g. a bank debit and
  // the matching credit-card payment confirmation). Legs that share an eventGroupId
  // describe the same money movement and must not be double-counted.
  eventGroupId?: string;
  relationKind?: SmsRelationKind;
}

/** One SMS sitting in the Gemini second filter, or the verdict of one that has been through it.
 *  It exists purely so the ledger has something to render during the 2-5s the classify call
 *  takes: without it a notification tap lands on a screen with no pending card and no
 *  explanation, and a rejected SMS never explains why nothing appeared.
 *
 *  Tracked per SMS but never RENDERED per SMS — the ledger consolidates the whole batch into one
 *  card. A drain of ten notifications drew ten cards and pushed the transaction list off the
 *  screen entirely. `passed` is kept rather than deleted on the spot so the batch can state what
 *  it did once they have all been judged. */
export interface SmsScreening {
  id: string;
  status: 'screening' | 'passed' | 'rejected';
}

export type SmsRelationKind = 'cc_payment' | 'investment' | 'transfer';
type SmsSemantic = SmsRelationKind | 'generic';

// Window within which two same-amount SMS from *different* accounts are treated as two
// legs of one event rather than independent transactions.
const RELATED_SMS_WINDOW = 5 * 60 * 1000;

// Best-effort classification of what an SMS describes, from its raw text. Used to decide
// whether a same-amount counterpart is a complementary leg (CC bill payment, investment,
// transfer) rather than a coincidental second transaction.
const classifySmsSemantic = (tx: { raw?: string; merchant?: string | null; source?: string }): SmsSemantic => {
  const text = `${tx.raw || ''} ${tx.merchant || ''} ${tx.source || ''}`.toLowerCase();
  // Credit-card bill payment confirmation, e.g. "payment of Rs 310 for your ... Credit Card was successful".
  if (/credit\s*card/.test(text) && /(payment|paid|received|successful|towards)/.test(text)) return 'cc_payment';
  if (/\bcard\b/.test(text) && /(payment|paid).*(success|received|done|processed)/.test(text)) return 'cc_payment';
  // Investment legs (mutual fund / SIP debit / stock purchase). 'sip' stays in the keyword set
  // because that is the word bank/AMC SMS actually uses — it matches message text, not a category.
  if (/(sip|mutual fund|folio|\bnav\b|units?\s*allot)/.test(text)) return 'investment';
  if (/(equity|demat|broker|shares?\s*(bought|allot))/.test(text)) return 'investment';
  // Explicit transfers.
  if (/(self\s*transfer|own account|imps|neft|rtgs|fund transfer)/.test(text)) return 'transfer';
  return 'generic';
};

const sameSmsSource = (a: { sourceIdentifier?: string; source?: string }, b: { sourceIdentifier?: string; source?: string }): boolean => {
  if (a.sourceIdentifier && b.sourceIdentifier) return a.sourceIdentifier === b.sourceIdentifier;
  return (a.source || '').toLowerCase() === (b.source || '').toLowerCase();
};

interface FinanceContextType {
  data: FinanceData;
  pendingTransfer: PendingTransfer | null;
  setPendingTransfer: (transfer: PendingTransfer | null) => void;
  smsQueue: PendingSmsTransaction[];
  smsScreening: SmsScreening[];
  addToSmsQueue: (tx: PendingSmsTransaction) => void;
  removeFromSmsQueue: (index: number) => void;
  removeSmsByMatch: (amount: number, type: string, targetAccountId: string) => void;
  addAccount: (account: Account) => void;
  updateAccount: (account: Account) => void;
  deleteAccount: (id: string) => void;
  archiveAccount: (id: string) => void;
  restoreAccount: (id: string) => void;
  addTransaction: (transaction: Transaction) => void;
  updateTransaction: (transaction: Transaction) => void;
  reorderTransactions: (...txs: Transaction[]) => void;
  setRewardLegExclusion: (legId: string, excludedAmount: number | undefined) => void;
  deleteTransaction: (id: string) => void;
  updateCashbackStatement: (statement: CashbackStatement) => void;
  updateCategories: (categories: string[]) => void;
  updateCategoryBudgets: (budgets: Record<string, number>) => void;
  updateTags: (tags: string[]) => void;
  updateEventTags: (eventTags: string[]) => void;
  updateCustomAccountTypes: (accountTypes: string[]) => void;
  updateUser: (user: User) => void;
  addSplitEvent: (event: SplitEvent) => void;
  updateSplitEvent: (event: SplitEvent) => void;
  deleteSplitEvent: (id: string) => void;
  addRecurringBill: (bill: RecurringBill) => void;
  updateRecurringBill: (bill: RecurringBill) => void;
  deleteRecurringBill: (id: string) => void;
  addDebt: (debt: Debt) => void;
  updateDebt: (debt: Debt) => void;
  deleteDebt: (id: string) => void;
  clearAllData: () => void;
  loadDemoData: () => void;
  clearDemoData: () => void;
  isAuthenticated: boolean;
  setAuthenticated: (value: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'minimalist_finance_data_v1';
// Deliberately separate from LOCAL_STORAGE_KEY / the FinanceData shape: unconfirmed SMS detections
// are device-local scratch state, not part of the user's actual financial data, so they're kept out
// of `data` (and therefore out of backup export/import) while still surviving app kills/backgrounding
// the same way `data` does — see the persistence effect below.
const SMS_QUEUE_STORAGE_KEY = 'minimalist_finance_sms_queue_v1';
/** How long a finished screening batch states its result before the ledger closes back up. Long
 *  enough to read a two-line notice, short enough not to feel like a stuck card. */
const SMS_SCREENING_SUMMARY_MS = 3200;

// Renumber each day's `order` to a gap-free, duplicate-free 0..N-1 run that matches the order the
// list already renders in. Drag-reorder renumbers a day 0..N-1 on every move and assumes those
// values start clean; a backup/restore, a legacy record with no `order`, or an interrupted drag can
// leave gaps, duplicates, or undefined orders — the dirty state that let one drag scramble/reverse
// untouched rows. This heals such days on load WITHOUT changing their visible order (it sorts by the
// exact comparator the UI uses, then reassigns contiguous integers). Untouched days return their
// original objects so nothing re-renders needlessly.
function normalizeTransactionOrders(transactions: Transaction[]): Transaction[] {
  const byDate = new Map<string, Transaction[]>();
  transactions.forEach(t => {
    const arr = byDate.get(t.date);
    if (arr) arr.push(t); else byDate.set(t.date, [t]);
  });
  const normalized = new Map<string, number>();
  byDate.forEach(dayTxs => {
    const sorted = [...dayTxs].sort((a, b) => {
      const oa = a.order !== undefined ? a.order : dayTxs.indexOf(a);
      const ob = b.order !== undefined ? b.order : dayTxs.indexOf(b);
      return oa - ob;
    });
    sorted.forEach((t, i) => normalized.set(t.id, i));
  });
  let changed = false;
  const result = transactions.map(t => {
    const o = normalized.get(t.id);
    if (o !== undefined && t.order !== o) { changed = true; return { ...t, order: o }; }
    return t;
  });
  return changed ? result : transactions;
}
const DEFAULT_CATEGORIES = ['Food', 'Shopping', 'Income', 'Salary', 'Rent', 'Fund', 'Fuel', 'Travel', 'Bills', 'Entertainment', 'CC Payment', 'Loans', 'Lending & Borrowing', 'NCMC Travel Recharge', 'Cashback', 'Investments', 'Other/Miscellaneous'];
const DEFAULT_CUSTOM_ACCOUNT_TYPES: string[] = [];
const DEFAULT_TAGS: string[] = [];

export const FinanceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const [smsQueue, setSmsQueue] = useState<PendingSmsTransaction[]>(() => {
    try {
      const saved = localStorage.getItem(SMS_QUEUE_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Failed to parse saved SMS queue", e);
      return [];
    }
  });
  const [smsScreening, setSmsScreening] = useState<SmsScreening[]>([]);

  /* Retire the batch, once, when nothing is left in flight — not each SMS on its own timer. The
     ledger draws these as a single consolidated card, so they have to arrive and leave together:
     staggered removals would make the count tick down one by one and let a summary be stated over
     a batch that is still being judged.

     EVERY finished batch states its result first, including one where nothing was filtered out. The
     alternative — vanishing silently when all is well — makes the filter invisible in exactly the
     case that proves it ran, and the count of what was dropped is not knowable any other way: a
     rejected SMS leaves no trace at all.

     A new SMS landing before the notice is up cancels the timer through the cleanup and joins the
     batch, which is right — a drain arriving in waves is one continuous event to the person
     watching it. */
  useEffect(() => {
    if (smsScreening.length === 0) return;
    if (smsScreening.some(s => s.status === 'screening')) return;
    const timer = window.setTimeout(() => setSmsScreening([]), SMS_SCREENING_SUMMARY_MS);
    return () => clearTimeout(timer);
  }, [smsScreening]);

  const [recentlyProcessedSms, setRecentlyProcessedSms] = useState<{ amount: number; type: string; sourceIdentifier?: string; source?: string; raw?: string; timestamp: number }[]>([]);

  // Always-current snapshot of the user, so the async SMS second filter can read the
  // latest aiSmsFilter opt-in without being captured in a stale closure.
  const userRef = useRef<User | undefined>(undefined);

  // Synchronous enqueue primitive: dedup + related-leg linking + append.
  const enqueueSms = (tx: PendingSmsTransaction) => {
    setSmsQueue(prev => {
      const now = Date.now();
      const txDateString = new Date(tx.timestamp).toDateString();

      // Clean up old entries from recentlyProcessedSms (older than 10 minutes)
      setRecentlyProcessedSms(recent => recent.filter(r => now - r.timestamp < 10 * 60 * 1000));

      // 1. Check if there's a duplicate in the active queue
      const duplicateIdx = prev.findIndex(item => {
        const itemDateString = new Date(item.timestamp).toDateString();
        return item.amount === tx.amount &&
               item.type === tx.type &&
               item.sourceIdentifier === tx.sourceIdentifier &&
               itemDateString === txDateString;
      });

      if (duplicateIdx !== -1) {
        const duplicate = prev[duplicateIdx];
        console.log("SpendVaultSms: Found potential duplicate in active smsQueue:", duplicate, "vs new:", tx);
        
        // If the new one has more information (e.g. merchant is not null, while existing has null merchant),
        // we replace the existing one with the new one.
        if (tx.merchant && !duplicate.merchant) {
          console.log("SpendVaultSms: Replacing existing generic transaction in queue with detailed one.");
          const updated = [...prev];
          updated[duplicateIdx] = tx;
          
          // Also update the recently processed log
          setRecentlyProcessedSms(recent => [
            ...recent.filter(r => !(r.amount === tx.amount && r.type === tx.type && r.sourceIdentifier === tx.sourceIdentifier)),
            { amount: tx.amount, type: tx.type, sourceIdentifier: tx.sourceIdentifier, source: tx.source, raw: tx.raw, timestamp: now }
          ]);

          return updated;
        }
        
        console.log("SpendVaultSms: Ignoring duplicate transaction.");
        return prev;
      }

      // 2. Check recentlyProcessedSms for a warm-start/immediate duplicate within last 10 minutes
      const isRecentlyProcessed = recentlyProcessedSms.some(item => {
        return item.amount === tx.amount &&
               item.type === tx.type &&
               item.sourceIdentifier === tx.sourceIdentifier &&
               now - item.timestamp < 10 * 60 * 1000;
      });

      if (isRecentlyProcessed) {
        console.log("SpendVaultSms: Transaction matching this amount, type, and account was recently processed/ignored. Discarding duplicate.");
        return prev;
      }

      // 3. Related-transaction check. Not an exact duplicate — but it may be a complementary
      // leg of the same real-world event (e.g. a bank debit and the credit-card payment it
      // settled). Same amount, within a few minutes, from a *different* account, where one
      // leg is clearly a CC payment / investment / transfer. Link rather than double-count.
      const newSemantic = classifySmsSemantic(tx);
      const isRelated = (item: { amount: number; type: string; sourceIdentifier?: string; source?: string; raw?: string; timestamp: number }) => {
        if (item.amount !== tx.amount) return false;
        if (Math.abs(item.timestamp - tx.timestamp) > RELATED_SMS_WINDOW) return false;
        if (sameSmsSource(item, tx)) return false; // same account => duplicate, handled above
        // Require at least one clearly complementary leg (CC payment / investment / transfer).
        // A bare same-amount coincidence in two accounts is not enough to link — note the CC
        // case often has BOTH legs parsed as debit, so we key on semantics, not direction.
        return newSemantic !== 'generic' || classifySmsSemantic(item) !== 'generic';
      };

      const relatedIdx = prev.findIndex(isRelated);
      const relatedRecent = relatedIdx === -1 ? recentlyProcessedSms.find(isRelated) : undefined;

      if (relatedIdx !== -1 || relatedRecent) {
        const counterpart = relatedIdx !== -1 ? prev[relatedIdx] : relatedRecent!;
        const counterpartSemantic = classifySmsSemantic(counterpart);
        const relationKind: SmsRelationKind =
          newSemantic !== 'generic' ? newSemantic
          : counterpartSemantic !== 'generic' ? counterpartSemantic
          : 'transfer';
        const groupId = (relatedIdx !== -1 ? prev[relatedIdx].eventGroupId : undefined) || crypto.randomUUID();

        console.log("SpendVaultSms: Linking related transaction leg under common event:", relationKind, counterpart, "<->", tx);

        const taggedTx: PendingSmsTransaction = { ...tx, eventGroupId: groupId, relationKind };

        setRecentlyProcessedSms(recent => [
          ...recent,
          { amount: tx.amount, type: tx.type, sourceIdentifier: tx.sourceIdentifier, source: tx.source, raw: tx.raw, timestamp: now }
        ]);

        if (relatedIdx !== -1) {
          const updated = [...prev];
          updated[relatedIdx] = { ...updated[relatedIdx], eventGroupId: groupId, relationKind };
          return [...updated, taggedTx];
        }
        return [...prev, taggedTx];
      }

      // Record this transaction as processed
      setRecentlyProcessedSms(recent => [
        ...recent,
        { amount: tx.amount, type: tx.type, sourceIdentifier: tx.sourceIdentifier, source: tx.source, raw: tx.raw, timestamp: now }
      ]);

      return [...prev, tx];
    });
  };

  // Optional Gemini second filter. When the user has opted in (aiSmsFilter) and a shared
  // Gemini key is configured, ask Gemini whether the SMS is a real transaction before
  // queuing it. Fail open — any API/network/timeout error lets the SMS through so a genuine
  // transaction is never silently lost. OTPs are already excluded on-device (SmsParser.kt).
  const addToSmsQueue = async (tx: PendingSmsTransaction) => {
    if (userRef.current?.aiSmsFilter) {
      // Announce the wait before starting it. The classify call takes 2-5s, which is long
      // enough that a user arriving from the notification would otherwise see an unchanged
      // ledger and assume the tap did nothing.
      const id = `scr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setSmsScreening(prev => [...prev, { id, status: 'screening' }]);
      try {
        const ok = await classifySmsIsTransaction(tx.raw);
        if (!ok) {
          console.log("SpendVaultSms: Gemini second filter rejected SMS as non-transaction:", tx.raw);
          // Don't just vanish: the placeholder turns into a verdict and retires itself, so the
          // user learns the SMS was judged and dropped rather than being left waiting for a
          // card that is never coming.
          setSmsScreening(prev => prev.map(s => (s.id === id ? { ...s, status: 'rejected' } : s)));
          return;
        }
      } catch (e) {
        console.error("SpendVaultSms: Gemini second filter failed, failing open:", e);
      }
      // Passed, or the filter errored and we fail open. Marked rather than removed: the batch
      // retires as a unit once nothing is left in flight (see the effect below), and the count of
      // what got through is half of what the summary says.
      setSmsScreening(prev => prev.map(s => (s.id === id ? { ...s, status: 'passed' } : s)));
    }
    enqueueSms(tx);
  };

  const removeFromSmsQueue = (index: number) => {
    setSmsQueue(prev => prev.filter((_, i) => i !== index));
  };

  const removeSmsByMatch = (amount: number, type: string, targetAccountId: string) => {
    setSmsQueue(prev => {
      const idx = prev.findIndex(sms => {
        if (sms.amount !== amount || sms.type !== type) return false;
        const targetAccount = data.accounts.find(a => a.id === targetAccountId);
        if (!targetAccount) return false;
        
        if (sms.sourceIdentifier && targetAccount.cardDetails?.cardNumber?.endsWith(sms.sourceIdentifier)) return true;
        
        const normalizedSourceName = sms.source.toLowerCase().replace(/\s+bank$/i, '').trim();
        const normalizedAccountName = targetAccount.name.toLowerCase().replace(/\s+bank$/i, '').trim();
        return normalizedAccountName.includes(normalizedSourceName) || normalizedSourceName.includes(normalizedAccountName);
      });
      if (idx !== -1) {
        console.log("SpendVaultSms: Automatically sweeping matched counterpart duplicate SMS from queue.");
        return prev.filter((_, i) => i !== idx);
      }
      return prev;
    });
  };

  // Define these before migration hook
  const updateUser = (user: User) => {
    setData(prev => ({ ...prev, user }));
  };

  const setTheme = (theme: 'light' | 'dark') => {
    setData(prev => ({ ...prev, theme }));
  };

  const [data, setData] = useState<FinanceData>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        
        // Data Migration: Convert old ncmc_card type to debit_card with NCMC enabled
        const nativeTypes: readonly string[] = BUILT_IN_ACCOUNT_TYPES;

        parsed.accounts = (parsed.accounts || []).map((acc: any) => {
          if (acc.type === 'ncmc_card') {
            return { ...acc, type: 'debit_card', isNcmcEnabled: true };
          }
          // Migration: the 'sips' account type is now 'mutual_funds'. The type was always used for
          // mutual-fund holdings — a SIP is just one way to buy into one — so it is named after the
          // asset. Nothing else about the account changes.
          if (acc.type === 'sips') {
            return { ...acc, type: 'mutual_funds' };
          }
          // Migration: Convert custom 'eWallet' variations to native 'e_wallet' type
          const lowerType = acc.type.toLowerCase();
          if (lowerType === 'ewallet' || lowerType === 'e-wallet') {
            return { ...acc, type: 'e_wallet' };
          }
          // Migration: the offset ledger is now a built-in type. It began life as a hand-made custom
          // type, so an existing account carries whatever the user typed ('offset', 'Offset Ledger',
          // ...) — normalise every spelling onto the native 'offset' key. Nothing else about the
          // account changes; its transactions already reference it by id.
          if (isOffsetTypeAlias(acc.type)) {
            return { ...acc, type: 'offset' };
          }
          /* Migration: a rewards wallet that names a unit AND a rate is counted in that unit, so the
             balance figures entered against it were the user's own unit — they typed 500 under a
             field the Accounts card captions "CHIPS" — while everything that did arithmetic with
             them read rupees. The wallet is now unit-denominated for real (see isUnitDenominated):
             its stored figures are rupees, and the unit is applied on the way in and out. So the
             figures that were entered as units are divided by the rate once — 500 Chips at 10/₹1
             becomes the ₹50 it was always worth — and `rewardType: 'points'` records that this
             wallet is counted in points, which is what the display now keys off.

             Self-limiting: the flag it sets is part of the condition, and the account form has
             written it alongside the unit ever since, so the only shape this can fire on is the one
             no build produces any more. Transactions are untouched — those were always rupees. */
          if (acc.type === 'rewards' && acc.rewardUnit && (acc.pointsConversionRate || 0) > 0
            && acc.rewardType !== 'points') {
            const rate = acc.pointsConversionRate as number;
            const toRupees = (v: any) => Math.round(((Number(v) || 0) / rate) * 100) / 100;
            const mapValues = (m: any) => Object.fromEntries(
              Object.entries(m || {}).map(([month, v]) => [month, toRupees(v)])
            );
            return {
              ...acc,
              rewardType: 'points',
              openingBalances: mapValues(acc.openingBalances),
              balanceAdjustments: acc.balanceAdjustments ? mapValues(acc.balanceAdjustments) : acc.balanceAdjustments,
              balanceEditHistory: (acc.balanceEditHistory || []).map((h: any) => ({
                ...h,
                previousBalance: toRupees(h.previousBalance),
                newBalance: toRupees(h.newBalance),
              })),
            };
          }
          return acc;
        });

        if (!parsed.customAccountTypes) {
          parsed.customAccountTypes = [];
        }

        // A native type must never also be listed as a custom one — the pickers would show it twice.
        // (The 'sips' -> 'mutual_funds' rename and 'epf' being absent from nativeTypes both used to
        // leak entries in here.) Offset goes through isOffsetTypeAlias rather than nativeTypes so the
        // pre-native spellings ('Offset Ledger', ...) are retired along with the exact 'offset' key —
        // otherwise the accounts migrate to the built-in type but the custom entry outlives them.
        parsed.customAccountTypes = parsed.customAccountTypes.filter(
          (t: string) => !nativeTypes.includes(t) && t !== 'sips' && !isOffsetTypeAlias(t)
        );

        // Recovery: Re-add any custom account types found in the accounts list that are missing
        parsed.accounts.forEach((acc: any) => {
          if (!nativeTypes.includes(acc.type) && !parsed.customAccountTypes.includes(acc.type)) {
            parsed.customAccountTypes.push(acc.type);
          }
        });

        // Migration: Consolidate legacy investment categories ('Mutual Funds', 'Stocks', 'Commodity', 'SIP', 'SIP / Mutual Funds')
        // into a single canonical 'Investments' category.
        if (parsed.transactions) {
          parsed.transactions = parsed.transactions.map((tx: any) => {
            if (isInvestmentCategory(tx.category)) {
              return { ...tx, category: INVESTMENT_CATEGORY };
            }
            return tx;
          });
        }

        // Migration: backfill investmentKind on investment transactions written before the
        // sub-category existed (including those whose legacy 'Stocks'/'Commodity'/'Mutual Funds'
        // category was just collapsed above, losing the only marker of which kind they were). The
        // kind is recoverable because every investment log touches an account of the matching type
        // on one of its legs — an MF buy a mutual_funds account, a gold buy a commodity account.
        // A funding leg's own account is the bank, so its linked parent/sibling legs are searched
        // too; without that, only the investment-side leg would be identifiable.
        if (parsed.transactions) {
          const txById = new Map<string, any>(parsed.transactions.map((t: any) => [t.id, t]));
          parsed.transactions = parsed.transactions.map((tx: any) => {
            if (!isInvestmentCategory(tx.category) || tx.investmentKind) return tx;
            const legIds: string[] = tx.linkedTransactionIds || (tx.linkedTransactionId ? [tx.linkedTransactionId] : []);
            const candidateIds = [
              tx.accountId,
              tx.paymentSourceAccountId,
              ...legIds.flatMap((id: string) => {
                const leg = txById.get(id);
                return leg ? [leg.accountId, leg.paymentSourceAccountId] : [];
              }),
            ];
            const kind = inferInvestmentKind(candidateIds, parsed.accounts || []);
            return kind ? { ...tx, investmentKind: kind } : tx;
          });
        }

        if (parsed.categories) {
          parsed.categories = Array.from(new Set(
            parsed.categories.map((c: string) =>
              isInvestmentCategory(c) ? INVESTMENT_CATEGORY : c
            )
          ));
        }

        if (parsed.categoryBudgets) {
          let mergedBudget = parsed.categoryBudgets[INVESTMENT_CATEGORY] || 0;
          for (const legacy of ['Mutual Funds', 'Stocks', 'Commodity', 'SIP', 'SIP / Mutual Funds']) {
            if (parsed.categoryBudgets[legacy] !== undefined) {
              mergedBudget = Math.max(mergedBudget, parsed.categoryBudgets[legacy]);
              delete parsed.categoryBudgets[legacy];
            }
          }
          if (mergedBudget > 0) {
            parsed.categoryBudgets[INVESTMENT_CATEGORY] = mergedBudget;
          }
        }

        if (!parsed.categories || parsed.categories.length === 0) {
          parsed.categories = [...DEFAULT_CATEGORIES];
        } else {
          // Auto-add missing standard categories
          if (!parsed.categories.includes('Fuel')) {
            const rentIdx = parsed.categories.indexOf('Rent');
            if (rentIdx !== -1) {
              parsed.categories.splice(rentIdx + 1, 0, 'Fuel');
            } else {
              parsed.categories.push('Fuel');
            }
          }
          // Sits directly above Fuel, so it runs after the Fuel block has ensured Fuel exists.
          if (!parsed.categories.includes('Fund')) {
            const fuelIdx = parsed.categories.indexOf('Fuel');
            if (fuelIdx !== -1) {
              parsed.categories.splice(fuelIdx, 0, 'Fund');
            } else {
              parsed.categories.push('Fund');
            }
          }
          if (!parsed.categories.includes('Loans')) {
            parsed.categories.push('Loans');
          }
          if (!parsed.categories.includes('Cashback')) {
            parsed.categories.push('Cashback');
          }
          if (!parsed.categories.includes('Lending & Borrowing')) {
            parsed.categories.push('Lending & Borrowing');
          }
          if (!parsed.categories.includes(INVESTMENT_CATEGORY)) {
            parsed.categories.push(INVESTMENT_CATEGORY);
          }

          // Clean up legacy categories if any remain in categories array
          parsed.categories = parsed.categories.filter((c: string) => c !== 'Mutual Funds' && c !== 'Stocks' && c !== 'Commodity' && c !== 'SIP' && c !== 'SIP / Mutual Funds');

          // NOTE for future AI models: Ensure 'Other/Misc' is always at the end
          const miscIndex = parsed.categories.findIndex((c: string) => c.toLowerCase() === 'other/misc' || c.toLowerCase() === 'other/miscellaneous');
          if (miscIndex !== -1 && miscIndex !== parsed.categories.length - 1) {
            const [misc] = parsed.categories.splice(miscIndex, 1);
            parsed.categories.push(misc);
          }
        }

        const hasExistingData = ((parsed.accounts?.length || 0) > 0) || ((parsed.transactions?.length || 0) > 0);
        if (!parsed.user) {
          parsed.user = { id: 'default', name: 'spendvault user', biometricsEnabled: false, enablePassiveTransactions: true, onboarded: hasExistingData };
        } else {
          // Migration: Remove old password if it exists
          if ((parsed.user as any).password) {
            delete (parsed.user as any).password;
          }
          if (parsed.user.enablePassiveTransactions === undefined) {
            parsed.user.enablePassiveTransactions = true;
          }
          if (!parsed.user.hasSeenFeatureTours) {
            parsed.user.hasSeenFeatureTours = {};
          }
          // Migration: onboarding completion used to be inferred from having a PIN. Existing
          // users (a PIN set, or any data) have already onboarded — don't send them back.
          if (parsed.user.onboarded === undefined) {
            parsed.user.onboarded = !!parsed.user.pinHash || hasExistingData;
          }
        }

        if (!parsed.theme) {
          parsed.theme = 'dark';
        }

        parsed.transactions = (parsed.transactions || []).map((t: any) => {
          if (t.linkedTransactionId && !t.linkedTransactionIds) {
            t = { ...t, linkedTransactionIds: [t.linkedTransactionId] };
          }
          // Migration: mutual-fund category rename ('SIP / Mutual Funds' -> 'SIP' -> 'Mutual Funds').
          if (t.category === 'SIP / Mutual Funds' || t.category === 'SIP') {
            t.category = INVESTMENT_CATEGORY;
          }
          // Migration: sipAllottedAmount/sipCharges were renamed to allottedAmount/investmentCharges
          // (they always applied to stock buys too, so the sip* prefix was wrong). Same values, new
          // names — move them across and drop the old keys so nothing reads a stale field.
          if (t.sipAllottedAmount !== undefined) {
            if (t.allottedAmount === undefined) t.allottedAmount = t.sipAllottedAmount;
            delete t.sipAllottedAmount;
          }
          if (t.sipCharges !== undefined) {
            if (t.investmentCharges === undefined) t.investmentCharges = t.sipCharges;
            delete t.sipCharges;
          }
          // Migration: Map legacy types and strip time from dates
          if (t.type === 'expense') t.type = 'debit';
          if (t.type === 'income') t.type = 'credit';
          if (t.date && t.date.includes('T')) {
            t.date = t.date.split('T')[0];
          }
          // Fix for "year 0026" bug: convert 00xx-MM-dd to 20xx-MM-dd
          if (t.date && t.date.startsWith('00')) {
            t.date = '20' + t.date.substring(2);
          }
          // Migration: Backfill rewardEarnedType for old transactions that predate the field.
          // Without this, undefined rewardEarnedType triggers fallback cashback recalculations.
          if (t.rewardEarnedType === undefined) {
            t.rewardEarnedType = (t.rewardEarned > 0 || t.expectedCashback > 0) ? 'delayed' : 'none';
          }
          // Migration: Lending & Borrowing is now always stats-excluded via its category
          // (STATS_EXCLUDED_CATEGORIES), so the per-transaction passive flag is meaningless for it.
          // Clear any stale excludeFromStats/excludedAmount so no orphan "passive" icon lingers in the ledger.
          if ((t.category || '').toLowerCase() === 'lending & borrowing' && (t.excludeFromStats || t.excludedAmount !== undefined)) {
            t.excludeFromStats = false;
            t.excludedAmount = undefined;
          }
          return t;
        });

        // Migration: Clean up old "Statement Credit: Cashback from [UUID]" descriptions
        parsed.transactions = parsed.transactions.map((t: any) => {
          if (t.description?.startsWith('Statement Credit: Cashback from ')) {
            const linkedId = t.linkedTransactionIds?.[0];
            if (linkedId) {
              const originalTx = parsed.transactions.find((ot: any) => ot.id === linkedId);
              if (originalTx) {
                return { ...t, description: `Cashback: ${originalTx.description}` };
              }
            }
          }
          return t;
        });

        // Migration: Update Tide card cashback descriptions from generic "Cashback realized" to monthly format
        parsed.transactions = parsed.transactions.map((t: any) => {
          if (t.description === 'Cashback realized' && t.category === 'Cashback' && t.type === 'credit') {
            const acc = (parsed.accounts || []).find((a: any) => a.id === t.accountId);
            if (acc?.name?.toLowerCase().includes('tide')) {
              const linkedId = t.linkedTransactionIds?.[0];
              if (linkedId) {
                const originalTx = parsed.transactions.find((ot: any) => ot.id === linkedId);
                if (originalTx) {
                  const date = new Date(originalTx.date);
                  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  const month = months[date.getMonth()];
                  const year = date.getFullYear().toString().slice(-2);
                  return { ...t, description: `${month} '${year} Real Cashback` };
                }
              }
            }
          }
          return t;
        });

        // Migration: Standardize descriptions for Transfer & NCMC Travel Recharge transaction pairs
        {
          const descriptionOverrides = new Map<string, string>();
          const seenPairs = new Set<string>();

          (parsed.transactions || []).forEach((t: any) => {
            if (seenPairs.has(t.id)) return;
            const cat = (t.category || '').toLowerCase();
            const linkedId = t.linkedTransactionIds?.[0];
            const counterpart = linkedId ? (parsed.transactions || []).find((ot: any) => ot.id === linkedId) : null;

            if (cat === 'transfer') {
              const myAccount = (parsed.accounts || []).find((a: any) => a.id === t.accountId);
              const counterpartAccount = counterpart
                ? (parsed.accounts || []).find((a: any) => a.id === counterpart.accountId)
                : null;

              // Only migrate if we can resolve both account names — leave orphaned/unlinked logs untouched
              if (myAccount && counterpartAccount && counterpart) {
                if (t.type === 'debit') {
                  descriptionOverrides.set(t.id, `Transfer to ${counterpartAccount.name}`);
                  descriptionOverrides.set(counterpart.id, `Transfer from ${myAccount.name}`);
                } else {
                  descriptionOverrides.set(t.id, `Transfer from ${counterpartAccount.name}`);
                  descriptionOverrides.set(counterpart.id, `Transfer to ${myAccount.name}`);
                }
              }

              seenPairs.add(t.id);
              if (linkedId) seenPairs.add(linkedId);
            }

            if (cat === 'ncmc travel recharge') {
              seenPairs.add(t.id);
              if (linkedId) seenPairs.add(linkedId);

              if (t.isTravelTransaction) {
                // Parent: credit to travel wallet
                descriptionOverrides.set(t.id, 'NCMC Travel Recharge');
                if (counterpart) descriptionOverrides.set(counterpart.id, 'Transfer to Travel Wallet');
              } else {
                // Counterpart: debit from payment balance
                descriptionOverrides.set(t.id, 'Transfer to Travel Wallet');
                if (counterpart) descriptionOverrides.set(counterpart.id, 'NCMC Travel Recharge');
              }
            }
          });

          if (descriptionOverrides.size > 0) {
            parsed.transactions = (parsed.transactions || []).map((t: any) => {
              if (descriptionOverrides.has(t.id)) {
                return { ...t, description: descriptionOverrides.get(t.id) };
              }
              return t;
            });
          }
        }

        // Repair: Remove "Transfer to/from Unknown" descriptions written by the earlier buggy migration run.
        // These are Transfer-category transactions whose counterpart account could not be resolved.
        // Re-attempt resolution now; if still unresolvable, reset to a plain "Transfer" description.
        parsed.transactions = (parsed.transactions || []).map((t: any) => {
          if (
            (t.category?.toLowerCase() === 'transfer') &&
            (t.description === 'Transfer to Unknown' || t.description === 'Transfer from Unknown')
          ) {
            const linkedId = t.linkedTransactionIds?.[0];
            const counterpart = linkedId
              ? (parsed.transactions || []).find((ot: any) => ot.id === linkedId)
              : null;
            const myAccount = (parsed.accounts || []).find((a: any) => a.id === t.accountId);
            const counterpartAccount = counterpart
              ? (parsed.accounts || []).find((a: any) => a.id === counterpart.accountId)
              : null;

            if (myAccount && counterpartAccount) {
              // Successfully resolved — use the correct description
              return {
                ...t,
                description: t.type === 'debit'
                  ? `Transfer to ${counterpartAccount.name}`
                  : `Transfer from ${counterpartAccount.name}`
              };
            }
            // Still unresolvable — reset to plain "Transfer"
            return { ...t, description: 'Transfer' };
          }
          return t;
        });

        // Migration: Smart-match legacy unlinked Transfer pairs by date+amount.
        // Groups unlinked Transfer transactions by date+amount. If a group has exactly
        // one debit and one credit (unambiguous pair), it links them bidirectionally and
        // generates correct canonical descriptions. Same-account pairs (NCMC travel wallet
        // self-transfers) get special descriptions. Ambiguous groups just get the ": Transfer"
        // suffix stripped from debit descriptions as a safe fallback.
        {
          const unlinkedTransfers = (parsed.transactions || []).filter((t: any) =>
            t.category?.toLowerCase() === 'transfer' &&
            (!t.linkedTransactionIds || t.linkedTransactionIds.length === 0)
          );

          // Group by date + amount
          const groups = new Map<string, { debits: any[]; credits: any[] }>();
          unlinkedTransfers.forEach((t: any) => {
            const key = `${t.date}__${t.amount}`;
            if (!groups.has(key)) groups.set(key, { debits: [], credits: [] });
            if (t.type === 'debit') groups.get(key)!.debits.push(t);
            else groups.get(key)!.credits.push(t);
          });

          const idPatches = new Map<string, object>();

          groups.forEach(({ debits, credits }) => {
            if (debits.length === 1 && credits.length === 1) {
              // Unambiguous pair — link and update descriptions
              const debit = debits[0];
              const credit = credits[0];
              const debitAccount = (parsed.accounts || []).find((a: any) => a.id === debit.accountId);
              const creditAccount = (parsed.accounts || []).find((a: any) => a.id === credit.accountId);

              const isSameAccount = debit.accountId === credit.accountId;

              let debitDesc: string;
              let creditDesc: string;

              if (isSameAccount) {
                // NCMC self-transfer: payment balance → travel wallet (both legs on same account)
                debitDesc = 'Transfer to Travel Wallet';
                creditDesc = 'NCMC Travel Recharge';
              } else {
                debitDesc = `Transfer to ${creditAccount?.name || 'Unknown'}`;
                creditDesc = `Transfer from ${debitAccount?.name || 'Unknown'}`;
              }

              idPatches.set(debit.id, { description: debitDesc, linkedTransactionIds: [credit.id] });
              idPatches.set(credit.id, { description: creditDesc, linkedTransactionIds: [debit.id] });

            } else {
              // Ambiguous or unmatched — safe fallback: strip ": Transfer" suffix from debit leg
              debits.forEach((t: any) => {
                if (t.description?.endsWith(': Transfer')) {
                  idPatches.set(t.id, { description: t.description.replace(/: Transfer$/, '') });
                }
              });
            }
          });

          if (idPatches.size > 0) {
            parsed.transactions = (parsed.transactions || []).map((t: any) => {
              if (idPatches.has(t.id)) return { ...t, ...idPatches.get(t.id) };
              return t;
            });
          }
        }

        // Migration: Smart-match legacy unlinked CC Payment pairs by date+amount.
        // Same logic as the Transfer smart-match: groups unlinked CC Payment transactions
        // by date+amount. Unambiguous 1-debit + 1-credit pairs get linked and descriptions
        // regenerated canonically. Ambiguous groups are left untouched.
        {
          const unlinkedCC = (parsed.transactions || []).filter((t: any) =>
            t.category?.toLowerCase() === 'cc payment' &&
            (!t.linkedTransactionIds || t.linkedTransactionIds.length === 0)
          );

          const groups = new Map<string, { debits: any[]; credits: any[] }>();
          unlinkedCC.forEach((t: any) => {
            const key = `${t.date}__${t.amount}`;
            if (!groups.has(key)) groups.set(key, { debits: [], credits: [] });
            if (t.type === 'debit') groups.get(key)!.debits.push(t);
            else groups.get(key)!.credits.push(t);
          });

          const idPatches = new Map<string, object>();

          groups.forEach(({ debits, credits }) => {
            if (debits.length === 1 && credits.length === 1) {
              const debit = debits[0]; // bank pays out
              const credit = credits[0]; // card receives payment
              const creditAccount = (parsed.accounts || []).find((a: any) => a.id === credit.accountId);

              // Debit description: always canonical 'CC Payment: <card name>'
              // Credit description: preserve if it has a custom suffix (e.g. '- Partial');
              //   only standardize if it's a plain generic 'CC Bill Payment' / blank.
              const existingCreditDesc = (credit.description || '').trim();
              const isGenericCreditDesc = existingCreditDesc === '' || existingCreditDesc === 'CC Bill Payment';
              const debitDesc = `CC Payment: ${(creditAccount?.name || 'Unknown').trim()}`;
              const creditDesc = isGenericCreditDesc ? 'CC Bill Payment' : existingCreditDesc;

              idPatches.set(debit.id, { description: debitDesc, linkedTransactionIds: [credit.id] });
              idPatches.set(credit.id, { description: creditDesc, linkedTransactionIds: [debit.id] });
            }
            // Ambiguous pairs left untouched
          });

          if (idPatches.size > 0) {
            parsed.transactions = (parsed.transactions || []).map((t: any) => {
              if (idPatches.has(t.id)) return { ...t, ...idPatches.get(t.id) };
              return t;
            });
          }
        }

        // Migration: Global description trim — strip leading/trailing spaces from all
        // transaction descriptions to normalise legacy entries (e.g. 'CC Bill Payment ').
        parsed.transactions = (parsed.transactions || []).map((t: any) => {
          if (typeof t.description === 'string' && t.description !== t.description.trim()) {
            return { ...t, description: t.description.trim() };
          }
          return t;
        });

        // Repair: Restore CC Bill Payment descriptions that had custom suffixes (e.g. '- Partial')
        // but were overwritten to the plain 'CC Bill Payment' by an earlier migration run.
        // Source of truth: the original backup file (spendvault_backup_2026-05-18.json).
        const ccPartialRepairs: Record<string, string> = {
          '44cd10bb-60f0-46f1-a8e3-54d1c5ecf50c': 'CC Bill Payment - Partial',
          '0ad220dc-565a-4256-a506-889c39ed8b85': 'CC Bill Payment - Partial',
        };
        parsed.transactions = (parsed.transactions || []).map((t: any) => {
          if (ccPartialRepairs[t.id] && t.description === 'CC Bill Payment') {
            return { ...t, description: ccPartialRepairs[t.id] };
          }
          return t;
        });


        // CLEANUP of the old SIP-in-Bills feature, whose defining behaviour — linking a bill to a
        // mutual fund account so LOG auto-credited it — no longer exists. Those entries are stale, so
        // they're dropped rather than left behind half-wired.
        //
        // Mutual Funds IS still a selectable bill category (see UpcomingBills): a fund instalment is a
        // fine thing to want a due-date reminder for, it just gets no special treatment any more.
        //
        // So the match is on the LEGACY category SPELLINGS ONLY, never on isMutualFundCategory(). Bill
        // categories are not touched by the category rename above, so a pre-rename bill still reads
        // 'SIP' verbatim while anything the user creates from now on reads 'Mutual Funds'. That makes
        // this self-limiting: it runs on every load (as all migrations here do), but can only ever
        // match pre-rename data, so a brand-new Mutual Funds bill is safe. Widening this to the
        // canonical name would delete the user's own bills on their next app launch.
        //
        // Logged mutual-fund TRANSACTIONS and the fund ACCOUNTS themselves are untouched either way —
        // only the stale bill reminders go.
        {
          const isLegacySipBill = (b: any) =>
            b?.category === 'SIP' || b?.category === 'SIP / Mutual Funds';
          const bills = (parsed.recurringBills || []).filter((b: any) => !isLegacySipBill(b));
          const droppedIds = new Set(
            (parsed.recurringBills || [])
              .filter(isLegacySipBill)
              .map((b: any) => b.id)
          );
          parsed.recurringBills = bills.map((b: any) => {
            if (b.linkedSipAccountId === undefined && b.lsa === undefined) return b;
            const cleaned = { ...b };
            delete cleaned.linkedSipAccountId;
            delete cleaned.lsa;
            return cleaned;
          });
          // Clear the now-dangling recurringBillId on transactions that pointed at a dropped bill,
          // so nothing keeps looking up a reminder that no longer exists.
          if (droppedIds.size > 0) {
            parsed.transactions = (parsed.transactions || []).map((t: any) =>
              t.recurringBillId && droppedIds.has(t.recurringBillId)
                ? { ...t, recurringBillId: undefined }
                : t
            );
          }
        }

        if (!parsed.debts) parsed.debts = [];
        if (!parsed.tags) parsed.tags = [];
        if (!parsed.eventTags) parsed.eventTags = [];

        // Migration: trim stray leading/trailing whitespace left over from before every typable
        // field trimmed on save (transaction description already had its own pass above — this
        // covers the rest: account names/labels, debt & split people/descriptions, bill names, the
        // user's own name, and the free-text tag/category/account-type lists).
        const trimStr = (s: any) => typeof s === 'string' ? s.trim() : s;
        const trimArr = (a: any) => Array.isArray(a) ? a.map(trimStr) : a;

        parsed.accounts = (parsed.accounts || []).map((acc: any) => {
          const updated = { ...acc, name: trimStr(acc.name) };
          if (updated.rewardUnit !== undefined) updated.rewardUnit = trimStr(updated.rewardUnit);
          if (updated.currentEmployer !== undefined) updated.currentEmployer = trimStr(updated.currentEmployer);
          if (updated.cardDetails?.cardholderName !== undefined) {
            updated.cardDetails = { ...updated.cardDetails, cardholderName: trimStr(updated.cardDetails.cardholderName) };
          }
          if (updated.cashbackRates?.length) {
            updated.cashbackRates = updated.cashbackRates.map((r: any) => ({ ...r, name: trimStr(r.name) }));
          }
          return updated;
        });

        parsed.debts = (parsed.debts || []).map((d: any) => ({
          ...d,
          personName: trimStr(d.personName),
          transactions: (d.transactions || []).map((t: any) => ({ ...t, description: trimStr(t.description) }))
        }));

        parsed.splitEvents = (parsed.splitEvents || []).map((e: any) => ({
          ...e,
          name: trimStr(e.name),
          people: trimArr(e.people),
          paidPeople: trimArr(e.paidPeople),
          items: (e.items || []).map((it: any) => ({ ...it, description: trimStr(it.description), involvedPeople: trimArr(it.involvedPeople) })),
          cycles: (e.cycles || []).map((c: any) => ({
            ...c,
            paidPeople: trimArr(c.paidPeople),
            carriedOverPeople: trimArr(c.carriedOverPeople),
            items: (c.items || []).map((it: any) => ({ ...it, description: trimStr(it.description), involvedPeople: trimArr(it.involvedPeople) }))
          }))
        }));

        parsed.recurringBills = (parsed.recurringBills || []).map((b: any) => ({ ...b, name: trimStr(b.name) }));

        if (parsed.user?.name !== undefined) {
          parsed.user = { ...parsed.user, name: trimStr(parsed.user.name) };
        }

        parsed.tags = trimArr(parsed.tags);
        parsed.eventTags = trimArr(parsed.eventTags);
        parsed.categories = trimArr(parsed.categories);
        parsed.customAccountTypes = trimArr(parsed.customAccountTypes);

        // Drop billing-cycle stamps left by an older build that wrote appliedBillingCycleYearMonth
        // onto EVERY card credit, handing them the "Apply Payment To" picker's 'previous_statement'
        // default even though that picker only ever rendered for CC Payments. A cashback or a refund
        // caught by it bills a cycle early and stays that way — the form stopped writing them, but
        // existing records keep the stamp until they happen to be saved again.
        //
        // Runs on every load, like the migrations above, and is safe doing so. The two legitimate
        // owners of this field are both excluded: a CC Payment's cycle is written by the form on
        // purpose, and a cycle chosen from the statement screen carries cycleMovedManually. Once the
        // stale stamps are cleared this matches nothing, so it cannot creep.
        parsed.transactions = (parsed.transactions || []).map((t: Transaction) => {
          if (!t.appliedBillingCycleYearMonth) return t;
          if (t.cycleMovedManually) return t;
          if ((t.category || '').toLowerCase() === 'cc payment') return t;
          const cleaned = { ...t };
          delete cleaned.appliedBillingCycleYearMonth;
          return cleaned;
        });

        parsed.transactions = normalizeTransactionOrders(parsed.transactions || []);
        return parsed;
      } catch (e) {
        console.error("Failed to parse local storage", e);
      }
    }
    return { 
      user: { id: 'default', name: 'spendvault user', biometricsEnabled: false, enablePassiveTransactions: false },
      accounts: [],
      transactions: [],
      cashbackStatements: [],
      categories: DEFAULT_CATEGORIES,
      tags: DEFAULT_TAGS,
      eventTags: [],
      customAccountTypes: DEFAULT_CUSTOM_ACCOUNT_TYPES,
      splitEvents: [],
      recurringBills: [],
      debts: [],
      theme: 'dark'
    };
  });

  useEffect(() => {
    userRef.current = data.user;
  }, [data.user]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', data.theme || 'dark');
  }, [data.theme]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  // Persisted separately from `data` (see SMS_QUEUE_STORAGE_KEY above) — survives an app kill or
  // the OS reclaiming a backgrounded WebView, so an unconfirmed SMS detection isn't silently lost
  // just because the native side already drained it into this queue exactly once.
  useEffect(() => {
    localStorage.setItem(SMS_QUEUE_STORAGE_KEY, JSON.stringify(smsQueue));
  }, [smsQueue]);

  // The drag-reorder maths requires each day's `order` to be a gap-free,
  // duplicate-free 0..N-1 run with every linked group's legs on adjacent indices.
  // If either invariant breaks at runtime, report the offending day so we can
  // trace what produced it — this is the state that let a single drag scramble
  // untouched rows. Warn-only, never mutates: healing here would hide the write
  // that did the damage, which is exactly how this went unnoticed for so long.
  //
  // Runs in production too, and deliberately. Gated to DEV it could only ever
  // fire on a dataset a developer happened to be holding, and every real instance
  // of this bug lived on a phone. Deduped by signature so a genuinely broken day
  // reports once rather than on every keystroke that touches the ledger.
  const reportedInvariants = useRef(new Set<string>());
  useEffect(() => {
    const byDate = new Map<string, Transaction[]>();
    data.transactions.forEach(t => {
      const arr = byDate.get(t.date);
      if (arr) arr.push(t); else byDate.set(t.date, [t]);
    });
    const report = (signature: string, ...args: unknown[]) => {
      if (reportedInvariants.current.has(signature)) return;
      reportedInvariants.current.add(signature);
      console.warn(...args);
    };
    byDate.forEach((dayTxs, date) => {
      const sorted = sortDayByOrder(dayTxs);
      if (!sorted.every((t, i) => t.order === i)) {
        const orders = sorted.map(t => t.order);
        report(`run:${date}:${orders.join(',')}`,
          `[order-invariant] ${date}: order is not a clean 0..N-1 run`, orders);
      }
      // Checked through the same grouping rule the render and the drag use, so a
      // change to what counts as "one group" can never leave this check behind
      // asserting the old shape.
      const idxById = new Map(sorted.map((t, i) => [t.id, i]));
      const seen = new Set<string>();
      sorted.forEach(t => {
        if (seen.has(t.id)) return;
        const group = linkedGroupOf(t, sorted);
        group.forEach(m => seen.add(m.id));
        if (group.length < 2) return;
        const idxs = group.map(m => idxById.get(m.id)!).sort((a, b) => a - b);
        if (!idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1)) {
          report(`group:${date}:${group.map(m => m.id).sort().join(',')}`,
            `[order-invariant] ${date}: linked group not adjacent`,
            { ids: group.map(m => m.id), indices: idxs });
        }
      });
    });
  }, [data.transactions]);


  // Migration: Hash legacy plain PIN
  useEffect(() => {
    const migratePin = async () => {
      if (data.user?.pin && !data.user?.pinHash) {
        const encoder = new TextEncoder();
        const msgUint8 = encoder.encode(data.user.pin);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        const newUser = { ...data.user };
        newUser.pinHash = hashHex;
        delete newUser.pin;
        updateUser(newUser);
      }
    };
    migratePin();
  }, [data.user]);

  const addAccount = (account: Account) => {
    setData(prev => ({ ...prev, accounts: [...prev.accounts, account] }));
  };

  const updateAccount = (account: Account) => {
    setData(prev => ({
      ...prev,
      accounts: prev.accounts.map(a => a.id === account.id ? account : a)
    }));
  };

  const deleteAccount = (id: string) => {
    setData(prev => ({
      ...prev,
      accounts: prev.accounts.filter(a => a.id !== id)
    }));
  };

  // Soft-delete: hide the account everywhere but keep it in data so its past transactions still
  // resolve a name. Restorable. This is what the "Delete account" button now does — a hard
  // deleteAccount would orphan that history to "Unknown".
  const archiveAccount = (id: string) => {
    setData(prev => ({
      ...prev,
      accounts: prev.accounts.map(a => a.id === id ? { ...a, archived: true } : a)
    }));
  };

  const restoreAccount = (id: string) => {
    setData(prev => ({
      ...prev,
      accounts: prev.accounts.map(a => a.id === id ? { ...a, archived: false } : a)
    }));
  };

  const parseDebtDescription = (description: string, category: string, type: 'credit' | 'debit') => {
    if (category?.toLowerCase() !== 'lending & borrowing') return null;
    const colonIndex = description.indexOf(':');
    if (colonIndex === -1) return null;
    
    const personName = description.substring(0, colonIndex).trim();
    const actionPart = description.substring(colonIndex + 1).trim();
    const actionLower = actionPart.toLowerCase();
    
    if (actionLower === 'lent') {
      return { personName, action: 'Lent', type: 'lent' as const };
    } else if (actionLower === 'borrowed') {
      return { personName, action: 'Borrowed', type: 'borrowed' as const };
    } else if (actionLower.startsWith('repayment')) {
      const debtTxType = type === 'debit' ? 'repayment_sent' : 'repayment_received';
      return { personName, action: 'Repayment', type: debtTxType as 'repayment_sent' | 'repayment_received' };
    }
    return null;
  };

  const calcDebtBalance = (txs: DebtTransaction[]) => {
    return txs.reduce((sum, t) => {
      if (t.type === 'lent' || t.type === 'repayment_sent') {
        return sum + t.amount;
      }
      return sum - t.amount;
    }, 0);
  };

  const updateDebtStatus = (debt: Debt): Debt => {
    const balanced = calcDebtBalance(debt.transactions) === 0;
    return {
      ...debt,
      transactions: balanced ? debt.transactions.map(t => ({ ...t, markedDone: true })) : debt.transactions,
      status: balanced ? 'settled' : 'active',
      updatedAt: Date.now()
    };
  };

  const syncDebtsForTransaction = (
    prevDebts: Debt[],
    oldTx: Transaction | undefined,
    newTx: Transaction
  ): { updatedDebts: Debt[]; updatedTx: Transaction } => {
    let updatedDebts = [...prevDebts];
    const updatedTx = { ...newTx };

    const oldMatch = oldTx ? parseDebtDescription(oldTx.description, oldTx.category || '', oldTx.type) : null;
    const newMatch = parseDebtDescription(updatedTx.description, updatedTx.category || '', updatedTx.type);

    // Scenario A: Was not matching debt, but now matches
    if (!oldMatch && newMatch) {
      const debtTxId = crypto.randomUUID();
      const newDebtTx: DebtTransaction = {
        id: debtTxId,
        amount: updatedTx.amount,
        date: updatedTx.date,
        description: newMatch.action,
        type: newMatch.type,
        linkedTxId: updatedTx.id
      };

      updatedTx.linkedTransactionIds = [...(updatedTx.linkedTransactionIds || []), debtTxId];

      const personIndex = updatedDebts.findIndex(d => d.personName.toLowerCase() === newMatch.personName.toLowerCase());
      if (personIndex > -1) {
        const existingDebt = updatedDebts[personIndex];
        updatedDebts[personIndex] = updateDebtStatus({
          ...existingDebt,
          transactions: [...existingDebt.transactions, newDebtTx]
        });
      } else {
        const newDebt = updateDebtStatus({
          id: crypto.randomUUID(),
          personName: newMatch.personName,
          transactions: [newDebtTx],
          status: 'active',
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        updatedDebts.push(newDebt);
      }
    }
    // Scenario B: Was matching debt, but now does NOT match
    else if (oldMatch && !newMatch) {
      updatedDebts = updatedDebts.map(debt => {
        const filteredTxs = debt.transactions.filter(dt => dt.linkedTxId !== updatedTx.id && !(updatedTx.linkedTransactionIds || []).includes(dt.id));
        return {
          ...debt,
          transactions: filteredTxs
        };
      })
      .map(updateDebtStatus)
      .filter(debt => debt.transactions.length > 0);

      updatedTx.linkedTransactionIds = (updatedTx.linkedTransactionIds || []).filter(id => {
        return !prevDebts.some(d => d.transactions.some(dt => dt.id === id));
      });
    }
    // Scenario C: Was matching debt, and still matches
    else if (oldMatch && newMatch) {
      let linkedDebtTxId = (updatedTx.linkedTransactionIds || []).find(id => 
        prevDebts.some(d => d.transactions.some(dt => dt.id === id))
      );

      if (!linkedDebtTxId) {
        for (const d of prevDebts) {
          const found = d.transactions.find(dt => dt.linkedTxId === updatedTx.id);
          if (found) {
            linkedDebtTxId = found.id;
            break;
          }
        }
      }

      if (linkedDebtTxId) {
        const oldPersonIndex = updatedDebts.findIndex(d => d.transactions.some(dt => dt.id === linkedDebtTxId));
        
        const updatedDebtTx: DebtTransaction = {
          id: linkedDebtTxId,
          amount: updatedTx.amount,
          date: updatedTx.date,
          description: newMatch.action,
          type: newMatch.type,
          linkedTxId: updatedTx.id
        };

        if (oldMatch.personName.toLowerCase() !== newMatch.personName.toLowerCase()) {
          if (oldPersonIndex > -1) {
            const oldDebt = updatedDebts[oldPersonIndex];
            updatedDebts[oldPersonIndex] = updateDebtStatus({
              ...oldDebt,
              transactions: oldDebt.transactions.filter(dt => dt.id !== linkedDebtTxId)
            });
          }

          const newPersonIndex = updatedDebts.findIndex(d => d.personName.toLowerCase() === newMatch.personName.toLowerCase());
          if (newPersonIndex > -1) {
            const existingDebt = updatedDebts[newPersonIndex];
            updatedDebts[newPersonIndex] = updateDebtStatus({
              ...existingDebt,
              transactions: [...existingDebt.transactions, updatedDebtTx]
            });
          } else {
            const newDebt = updateDebtStatus({
              id: crypto.randomUUID(),
              personName: newMatch.personName,
              transactions: [updatedDebtTx],
              status: 'active',
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
            updatedDebts.push(newDebt);
          }
        } else {
          if (oldPersonIndex > -1) {
            const oldDebt = updatedDebts[oldPersonIndex];
            updatedDebts[oldPersonIndex] = updateDebtStatus({
              ...oldDebt,
              transactions: oldDebt.transactions.map(dt => dt.id === linkedDebtTxId ? updatedDebtTx : dt)
            });
          }
        }

        updatedDebts = updatedDebts.filter(d => d.transactions.length > 0);
      }
    }

    return { updatedDebts, updatedTx };
  };

  const addTransaction = (transaction: Transaction) => {
    setData(prev => {
      const newTxId = transaction.id || crypto.randomUUID();
      const initialTx = { ...transaction, id: newTxId };

      const { updatedDebts, updatedTx } = syncDebtsForTransaction(prev.debts || [], undefined, initialTx);

      return {
        ...prev,
        // Placed INSIDE its day rather than stamped with `maxOrder + 1`: a leg has
        // to land beside the parent it links to, or it strands itself at the far
        // end of the day and the gap it leaves behind makes the next drag on that
        // day haul every row in between along with it. See insertIntoDay.
        transactions: insertIntoDay(prev.transactions, updatedTx),
        debts: updatedDebts
      };
    });
  };

  // Linked (parent ↔ child) transaction edit/delete sync — full behavior matrix, discriminators,
  // and the "parent is source of truth" design rationale: docs/LINKED_TRANSACTIONS.md
  const updateTransaction = (transaction: Transaction) => {
    setData(prev => {
      // Categories that own an auto-generated counterpart leg, so dropping the payment source has to
      // delete it. Investments count via isInvestmentCategory() — they used to be listed here as
      // 'mutual funds'/'stocks'/'commodity', which no longer match anything now that all three log
      // under one category, leaving investment counterpart legs orphaned on edit.
      const ownsCounterpartLeg = (category?: string) => {
        const c = (category || '').toLowerCase();
        return c === 'transfer' || c === 'cc payment' || c === 'ncmc travel recharge' || isInvestmentCategory(c);
      };
      const oldTx = prev.transactions.find(t => t.id === transaction.id);
      const wasTransferOrCC = oldTx && ownsCounterpartLeg(oldTx.category);
      const isNowTransferOrCC = ownsCounterpartLeg(transaction.category);
      
      let txsToDelete: string[] = [];
      let updatedTransaction = { ...transaction };

      // Reward-split (3-leg CC Payment) edit detection — Option B keeps the card credit as the
      // fixed anchor; the non-edited funding leg absorbs the change. See docs/LINKED_TRANSACTIONS.md.
      // (a) editing a REWARD leg: a linked parent counts this tx among its split's legs. Asked via
      //     rewardSplitOfLeg rather than "the account the anchor points at", which could only ever
      //     name ONE source and so misread the second leg of a two-wallet split as a plain
      //     counterpart — handing it the anchor's own amount.
      const rewardSplitParent = prev.transactions.find(p =>
        p.id !== transaction.id &&
        (p.linkedTransactionIds || []).includes(transaction.id) &&
        !!rewardSplitOfLeg(p, transaction)
      );
      const editedSplit = rewardSplitParent ? rewardSplitOfLeg(rewardSplitParent, transaction) : undefined;
      const isRewardSplitChildEdit = !!rewardSplitParent;
      // (b) editing the BANK leg of a parent that has an active reward split: linked to it, but not
      //     one of its redemptions (by leg id, and — for a legacy row with no ids — by account).
      const bankLegParent = !rewardSplitParent ? prev.transactions.find(p =>
        p.id !== transaction.id &&
        (p.linkedTransactionIds || []).includes(transaction.id) &&
        rewardSplitTotal(p) > 0 &&
        !rewardSplitOfLeg(p, transaction) &&
        !isRewardSourceOf(p, transaction.accountId)
      ) : undefined;
      const isRewardSplitBankEdit = !!bankLegParent;

      // The split anchors ONLY on the card leg. When editing a child leg, its edit form may carry
      // reconstructed anchor fields (the bank leg shows the total + split; the reward leg shows the
      // card as its payment source) so the modal reads correctly — but those must NOT persist onto the
      // child, or two legs would claim the anchor. Strip them; the branches below rebalance the card.
      if (isRewardSplitBankEdit) {
        updatedTransaction = withRewardSplits(updatedTransaction, []);
      }
      if (isRewardSplitChildEdit) {
        updatedTransaction.paymentSourceAccountId = '';
      }

      // Guard: a reward/bank leg edit must NOT be mistaken for "payment source removed" (which would
      // delete the card parent). Those edits rebalance via the reverse blocks below instead.
      if (wasTransferOrCC && (!isNowTransferOrCC || !transaction.paymentSourceAccountId) && !isRewardSplitChildEdit && !isRewardSplitBankEdit) {
        const allLinkedIds = transaction.linkedTransactionIds || (transaction.linkedTransactionId ? [transaction.linkedTransactionId] : []);
        const counterpartTxs = prev.transactions.filter(t => 
          allLinkedIds.includes(t.id) &&
          t.id !== transaction.id &&
          ownsCounterpartLeg(t.category)
        );
        txsToDelete = counterpartTxs.map(t => t.id);
        
        if (updatedTransaction.linkedTransactionIds) {
          updatedTransaction.linkedTransactionIds = updatedTransaction.linkedTransactionIds.filter(id => !txsToDelete.includes(id));
        }
        updatedTransaction.paymentSourceAccountId = '';
      }

      /* What becomes of the split's reward leg — see services/RewardLegService. Skipped for a child
         leg's own edit: its form carries reconstructed anchor fields that the block above has just
         stripped, and reading those as a source change would delete its sibling. */
      const rewardLegPlan = (!isRewardSplitChildEdit && !isRewardSplitBankEdit)
        ? resolveRewardLegPlan({
          anchor: updatedTransaction,
          storedAnchor: oldTx,
          transactions: prev.transactions,
          accounts: prev.accounts,
        })
        : { syncs: [], deletes: [] };
      const rewardLegSyncs = new Map(rewardLegPlan.syncs.map(s => [s.legId, s.patch]));

      if (rewardLegPlan.deletes.length > 0) {
        const linkedIdsNow = updatedTransaction.linkedTransactionIds
          || (updatedTransaction.linkedTransactionId ? [updatedTransaction.linkedTransactionId] : []);
        txsToDelete = [...txsToDelete, ...rewardLegPlan.deletes];
        updatedTransaction.linkedTransactionIds = linkedIdsNow.filter(id => !rewardLegPlan.deletes.includes(id));
      }

      let updatedTxs = prev.transactions.map(t => t.id === transaction.id ? updatedTransaction : t);
      
      if (txsToDelete.length > 0) {
        updatedTxs = updatedTxs.filter(t => !txsToDelete.includes(t.id));
      }
      
      const allLinkedIds = updatedTransaction.linkedTransactionIds || (updatedTransaction.linkedTransactionId ? [updatedTransaction.linkedTransactionId] : []);
      
      const isCashback = updatedTransaction.category === 'Cashback';

      if (allLinkedIds.length > 0 && !isCashback && !isRewardSplitChildEdit && !isRewardSplitBankEdit) {
        updatedTxs = updatedTxs.map(t => {
          if (allLinkedIds.includes(t.id)) {
            // Propagate date ALWAYS
            const updated = { ...t, date: updatedTransaction.date };
            
            // Check if this linked transaction is a Cashback counterpart
            if (t.category === 'Cashback') {
              updated.amount = Number(updatedTransaction.rewardEarned) || 0;
              updated.description = `Instant Cashback: ${updatedTransaction.description}`;
              if (updatedTransaction.rewardEarnedAccountId) {
                updated.accountId = updatedTransaction.rewardEarnedAccountId;
              }
            } 
            // Check if this linked transaction is a Reward Split counterpart. The patch carries the
            // account too, so a leg whose source was switched moves with it instead of being left
            // behind to be mistaken for a transfer counterpart.
            else if (rewardLegSyncs.has(t.id)) {
              Object.assign(updated, rewardLegSyncs.get(t.id));
            }
            // Otherwise it's a Transfer counterpart, Mutual Funds, or CC payment bank portion
            else {
              const isCCPayment = updatedTransaction.category?.toLowerCase() === 'cc payment';
              const isNcmcRecharge = updatedTransaction.category?.toLowerCase() === 'ncmc travel recharge';
              // Which investment (if any) — the three kinds propagate different fields to their leg,
              // so this has to come from the kind, not the shared 'Investments' category.
              const invKind = getInvestmentKind(updatedTransaction, prev.accounts);
              const isMf = invKind === 'mutual_funds';
              const isStocks = invKind === 'stocks';
              const isCommodity = invKind === 'commodity';
              if (isCCPayment) {
                if (rewardSplitTotal(updatedTransaction) > 0) {
                  // It's the bank portion — what the card was paid, less every reward source.
                  updated.amount = updatedTransaction.amount - rewardSplitTotal(updatedTransaction);
                } else {
                  // Standard 1:1
                  updated.amount = updatedTransaction.amount;
                }
              } else if (isMf) {
                if (updated.type === 'credit') {
                  updated.amount = Number(updatedTransaction.allottedAmount) || 0;
                } else {
                  updated.amount = (Number(updatedTransaction.allottedAmount) || 0) + (Number(updatedTransaction.investmentCharges) || 0);
                }
                updated.allottedAmount = updatedTransaction.allottedAmount;
                updated.investmentCharges = updatedTransaction.investmentCharges;
                updated.numberOfShares = updatedTransaction.numberOfShares;
              } else if (isStocks) {
                if (updated.type === 'credit') {
                  updated.amount = Number(updatedTransaction.allottedAmount) || updatedTransaction.amount;
                } else {
                  updated.amount = (Number(updatedTransaction.allottedAmount) || updatedTransaction.amount) + (Number(updatedTransaction.investmentCharges) || 0);
                }
                updated.allottedAmount = updatedTransaction.allottedAmount;
                updated.investmentCharges = updatedTransaction.investmentCharges;
                updated.numberOfShares = updatedTransaction.numberOfShares;
              } else if (isCommodity) {
                updated.amount = updatedTransaction.amount;
                updated.numberOfShares = updatedTransaction.numberOfShares;
              } else {
                /* Transfers are 1:1 unless the row says otherwise. counterpartAmount is what the
                   FAR side moved — a discounted gift-card load credits more than it debits, a
                   fee-charging rail credits less — so it wins here, and the mirror below keeps
                   this leg able to describe the pair from its own side when it gets edited. */
                const farSide = updatedTransaction.counterpartAmount;
                updated.amount = (farSide !== undefined && farSide > 0) ? farSide : updatedTransaction.amount;
                updated.counterpartAmount = updated.amount !== updatedTransaction.amount
                  ? updatedTransaction.amount
                  : undefined;
              }

              if (isNcmcRecharge) {
                updated.category = 'NCMC Travel Recharge';
              } else if (updatedTransaction.category === 'Transfer') {
                updated.category = 'Transfer';
              } else if (invKind) {
                // Keep the leg's kind in step with the parent's, or an MF→Stocks edit would leave
                // the funding leg claiming the old kind.
                updated.category = INVESTMENT_CATEGORY;
                updated.investmentKind = invKind;
                if (isStocks || isCommodity) updated.description = updatedTransaction.description;
              }

              // Update counterpart account ID if changed
              if (updatedTransaction.paymentSourceAccountId) {
                updated.accountId = updatedTransaction.paymentSourceAccountId;
                
                // Sync counterpart description
                const parentAcc = prev.accounts.find(a => a.id === updatedTransaction.accountId);
                const counterpartAcc = prev.accounts.find(a => a.id === updatedTransaction.paymentSourceAccountId);
                if (isCCPayment) {
                  if (updated.type === 'credit') {
                    updated.description = 'CC Bill Payment';
                  } else {
                    const targetCardName = updatedTransaction.type === 'credit' ? parentAcc?.name : counterpartAcc?.name;
                    updated.description = `CC Payment: ${targetCardName || 'Unknown'}`;
                  }
                } else if (isMf || isStocks || isCommodity) {
                  updated.description = updatedTransaction.description;
                } else {
                  updated.description = updatedTransaction.type === 'credit' ? `Transfer to ${parentAcc?.name || 'Unknown'}` : `Transfer from ${parentAcc?.name || 'Unknown'}`;
                }
              }
            }
            return updated;
          }
          return t;
        });
      }
      
      // Reverse propagation: a child-leg edit reciprocates to its parent. Without this, editing a
      // collapsed child (cashback credit / reward-split debit) would silently desync — or worse,
      // the forward path above would corrupt the parent. See docs/LINKED_TRANSACTIONS.md.
      if (isCashback) {
        // Instant-cashback child → parent.rewardEarned / rewardEarnedAccountId
        updatedTxs = updatedTxs.map(t => {
          const tLinkedIds = t.linkedTransactionIds || (t.linkedTransactionId ? [t.linkedTransactionId] : []);
          if (t.id !== updatedTransaction.id && tLinkedIds.includes(updatedTransaction.id)) {
            return {
              ...t,
              rewardEarned: updatedTransaction.amount,
              rewardEarnedAccountId: updatedTransaction.accountId || t.rewardEarnedAccountId,
            };
          }
          return t;
        });
      } else if (isRewardSplitChildEdit && rewardSplitParent) {
        // Option B — edited ONE reward leg. Card credit (parent.amount) is the fixed anchor; the bank
        // leg absorbs: bank = total − every reward source. Only the edited source changes; a sibling
        // wallet on the same split is left exactly as it was, which is what makes a multi-source
        // split editable leg by leg.
        const total = rewardSplitParent.amount;
        const nextSplits = getRewardSplits(rewardSplitParent).map(s => (
          (editedSplit && (s.legId ? s.legId === editedSplit.legId : s.accountId === editedSplit.accountId))
            // The leg's own id is recorded while we have it: a legacy split that has just been
            // rebalanced becomes identifiable, so the next edit no longer relies on the account.
            ? { ...s, accountId: updatedTransaction.accountId, amount: updatedTransaction.amount, legId: s.legId || updatedTransaction.id }
            : s
        ));
        const rewardTotal = nextSplits.reduce((sum, s) => sum + (s.amount || 0), 0);
        const bankAmount = Math.max(0, total - rewardTotal);
        const bankLegId = (rewardSplitParent.linkedTransactionIds || []).find(id => {
          const lt = prev.transactions.find(t => t.id === id);
          // Not this leg, not a SIBLING redemption, and not the card itself.
          return !!lt && lt.id !== updatedTransaction.id
            && !rewardSplitOfLeg(rewardSplitParent, lt)
            && lt.accountId !== rewardSplitParent.accountId;
        });
        updatedTxs = updatedTxs.map(t => {
          if (t.id === rewardSplitParent.id) {
            return { ...withRewardSplits(t, nextSplits), date: updatedTransaction.date };
          }
          if (bankLegId && t.id === bankLegId) {
            return { ...t, amount: bankAmount, date: updatedTransaction.date };
          }
          return t;
        });
      } else if (isRewardSplitBankEdit && bankLegParent) {
        // Option B (symmetric) — edited the BANK leg. Card credit stays fixed; the rewards absorb:
        // reward total = total − bank. Which source takes the difference is redistributeRewardSplits'
        // decision (the last one, cascading back); a source flexed to ₹0 has stopped funding anything,
        // so its leg goes with it rather than lingering as a ₹0 row in the ledger.
        const total = bankLegParent.amount;
        const newBank = updatedTransaction.amount;
        const storedSplits = getRewardSplits(bankLegParent);
        const nextSplits = redistributeRewardSplits(storedSplits, Math.max(0, total - newBank));
        const liveSplits = nextSplits.filter(s => s.amount > 0);

        /* Which leg belongs to which source — by id, or by account for a legacy row. Same rule as
           rewardSplitIndexOfLeg, applied against the STORED list so the redistributed amounts can be
           matched back positionally. */
        const legAmounts = new Map<string, number>();
        const legsToDrop: string[] = [];
        (bankLegParent.linkedTransactionIds || []).forEach(id => {
          const lt = prev.transactions.find(t => t.id === id);
          if (!lt || lt.id === bankLegParent.id) return;
          const i = rewardSplitIndexOfLeg(bankLegParent, lt);
          if (i < 0) return;
          const amount = nextSplits[i]?.amount || 0;
          if (amount > 0) legAmounts.set(lt.id, amount);
          else legsToDrop.push(lt.id);
        });

        updatedTxs = updatedTxs
          .filter(t => !legsToDrop.includes(t.id))
          .map(t => {
            if (t.id === bankLegParent.id) {
              return {
                ...withRewardSplits(t, liveSplits),
                date: updatedTransaction.date,
                linkedTransactionIds: (t.linkedTransactionIds || []).filter(l => !legsToDrop.includes(l)),
              };
            }
            if (legAmounts.has(t.id)) {
              return { ...t, amount: legAmounts.get(t.id) as number, date: updatedTransaction.date };
            }
            return t;
          });
      }

      const syncResult = syncDebtsForTransaction(prev.debts || [], oldTx, updatedTransaction);
      let updatedDebts = syncResult.updatedDebts;
      updatedTransaction = syncResult.updatedTx;

      if (allLinkedIds.length > 0 || txsToDelete.length > 0) {
        updatedDebts = updatedDebts.map(debt => ({
          ...debt,
          transactions: debt.transactions
            .filter(dt => !txsToDelete.includes(dt.id))
            .map(dt => {
              if (allLinkedIds.includes(dt.id)) {
                return { ...dt, date: updatedTransaction.date };
              }
              return dt;
            })
        })).filter(debt => debt.transactions.length > 0);
      }
      
      updatedDebts = updatedDebts.map(updateDebtStatus);
      
      // When the edit moved the date to a different day, the old `order` is stale for the new day's
      // group (a tx that was order 0 on its old day would jump to the top of the new day). Re-stamp
      // the moved transaction AND any linked legs that were date-synced along with it (all share the
      // new date) to the END of the destination day, matching how addTransaction places new ones.
      if (oldTx && oldTx.date !== updatedTransaction.date) {
        const newDate = updatedTransaction.date;
        const movedIds = new Set(
          updatedTxs
            .filter(t => t.date === newDate)
            .filter(t => {
              const old = prev.transactions.find(p => p.id === t.id);
              return old && old.date !== newDate;
            })
            .map(t => t.id)
        );
        if (movedIds.size > 0) {
          // Highest order among transactions already living on the destination day.
          let maxOrder = updatedTxs
            .filter(t => t.date === newDate && !movedIds.has(t.id))
            .reduce((max, t, idx) => {
              const ord = t.order !== undefined ? t.order : idx;
              return ord > max ? ord : max;
            }, -1);
          // Assign sequential orders to the moved group, preserving their relative order.
          const newOrders = new Map<string, number>();
          updatedTxs.forEach(t => { if (movedIds.has(t.id)) newOrders.set(t.id, ++maxOrder); });
          updatedTxs = updatedTxs.map(t => newOrders.has(t.id) ? { ...t, order: newOrders.get(t.id) } : t);
        }
      }

      return { ...prev, transactions: updatedTxs, debts: updatedDebts };
    });
  };

  const reorderTransactions = (...txs: Transaction[]) => {
    const txMap = new Map(txs.map(t => [t.id, t]));
    setData(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => {
        const updated = txMap.get(t.id);
        return updated ? updated : t;
      })
    }));
  };

  // Linked-transaction delete cascade (both directions). See docs/LINKED_TRANSACTIONS.md
  /* Writes ONLY the passive fields of a reward-split leg.
   *
   * A passive exclusion is stated against the full price, but the price lives on two rows: the
   * anchor holds what the primary account paid and the leg holds what rewards covered. The anchor
   * can only absorb an exclusion up to its own amount (a bigger one would make statsAmount go
   * negative and subtract from other spends), so the remainder has to land on the leg.
   *
   * This is deliberately NOT updateTransaction: that treats any write to a leg as a "child edit"
   * and rebalances the split around it — stripping paymentSourceAccountId, re-deriving the anchor.
   * All this needs is two fields patched in place, with the leg's derived identity untouched.
   */
  const setRewardLegExclusion = (legId: string, excludedAmount: number | undefined) => {
    const excluded = excludedAmount && excludedAmount > 0 ? excludedAmount : undefined;
    setData(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => (
        t.id === legId
          ? { ...t, excludeFromStats: excluded !== undefined, excludedAmount: excluded }
          : t
      )),
    }));
  };

  const deleteTransaction = (id: string) => {
    setData(prev => {
      const tx = prev.transactions.find(t => t.id === id);
      if (!tx) return prev;

      // Special case: deleting ONLY a reward leg of a reward-split payment does NOT remove the
      // payment. It un-splits it by that much — the card credit stays, the bank leg absorbs what this
      // source was paying, and that source drops off the anchor. With several sources the others stay
      // exactly as they are: deleting the ₹36 super.money leg of a ₹448 bill leaves the ₹50 CRED leg
      // alone and hands the bank ₹36 more to carry. See docs/LINKED_TRANSACTIONS.md.
      const rewardSplitParentOnDelete = prev.transactions.find(p =>
        p.id !== tx.id &&
        (p.linkedTransactionIds || []).includes(tx.id) &&
        rewardSplitTotal(p) > 0 &&
        !!rewardSplitOfLeg(p, tx)
      );
      if (rewardSplitParentOnDelete) {
        const total = rewardSplitParentOnDelete.amount; // card credit = fixed total
        const goneIndex = rewardSplitIndexOfLeg(rewardSplitParentOnDelete, tx);
        const remainingSplits = getRewardSplits(rewardSplitParentOnDelete).filter((_, i) => i !== goneIndex);
        const remainingReward = remainingSplits.reduce((sum, sp) => sum + (sp.amount || 0), 0);
        const bankLegId = (rewardSplitParentOnDelete.linkedTransactionIds || []).find(lid => {
          const lt = prev.transactions.find(t => t.id === lid);
          // Not the leg going away, not a surviving redemption, and not the card itself.
          return !!lt && lt.id !== tx.id
            && !rewardSplitOfLeg(rewardSplitParentOnDelete, lt)
            && lt.accountId !== rewardSplitParentOnDelete.accountId;
        });
        const remaining = prev.transactions
          .filter(t => t.id !== tx.id)
          .map(t => {
            if (t.id === rewardSplitParentOnDelete.id) {
              return {
                ...withRewardSplits(t, remainingSplits),
                linkedTransactionIds: (t.linkedTransactionIds || []).filter(l => l !== tx.id),
              };
            }
            if (bankLegId && t.id === bankLegId) {
              return {
                ...t,
                amount: Math.max(0, total - remainingReward),
                linkedTransactionIds: (t.linkedTransactionIds || []).filter(l => l !== tx.id),
              };
            }
            if ((t.linkedTransactionIds || []).includes(tx.id)) {
              return { ...t, linkedTransactionIds: (t.linkedTransactionIds || []).filter(l => l !== tx.id) };
            }
            return t;
          });
        const debtsAfter = (prev.debts || [])
          .map(debt => ({ ...debt, transactions: debt.transactions.filter(dt => dt.id !== tx.id && dt.linkedTxId !== tx.id) }))
          .map(updateDebtStatus)
          .filter(debt => debt.transactions.length > 0);
        return { ...prev, transactions: remaining, debts: debtsAfter };
      }

      const linkedIds = (tx.linkedTransactionIds || (tx.linkedTransactionId ? [tx.linkedTransactionId] : []));
      
      let updatedDebts = prev.debts || [];
      updatedDebts = updatedDebts.map(debt => ({
        ...debt,
        transactions: debt.transactions.filter(dt => !linkedIds.includes(dt.id) && dt.linkedTxId !== tx.id)
      }))
      .map(updateDebtStatus)
      .filter(debt => debt.transactions.length > 0);

      // Leg-type links (Transfer/CC/NCMC/Mutual Funds/Stocks/Commodity) form a STAR around the parent:
      // children link to the parent, not to each other. Deleting one child must take the whole
      // group — otherwise a 3-leg reward-split CC payment orphans its sibling leg. So we expand
      // to the full transitively-linked leg group. See docs/LINKED_TRANSACTIONS.md.
      const LEG_CATS = ['transfer', 'cc payment', 'ncmc travel recharge', 'mutual funds', 'stocks', 'commodity'];
      const isLegCat = (c?: string) => LEG_CATS.includes((c || '').toLowerCase());
      const legGroup = new Set<string>([id]);
      if (isLegCat(tx.category)) {
        let changed = true;
        while (changed) {
          changed = false;
          for (const t of prev.transactions) {
            if (legGroup.has(t.id) || !isLegCat(t.category)) continue;
            const tLinks = t.linkedTransactionIds || [];
            const connected = [...legGroup].some(gid =>
              tLinks.includes(gid) ||
              (prev.transactions.find(x => x.id === gid)?.linkedTransactionIds || []).includes(t.id)
            );
            if (connected) { legGroup.add(t.id); changed = true; }
          }
        }
      }

      // Determine which linked transactions should also be deleted
      const linkedTxsToDelete = prev.transactions.filter(t => {
        if (t.id === id) return false;

        // 1. Whole leg group (transitive) is deleted together
        if (legGroup.has(t.id)) return true;

        if (!linkedIds.includes(t.id)) return false;

        // 2. If parent is deleted, delete linked instant cashback
        if (t.category === 'Cashback' && tx.type === 'debit') return true;

        // 3. If parent is deleted, delete every linked reward-split counterpart. Leg ids are
        //    unconditional — those rows exist only to fund this one — while the account fallback
        //    (legacy rows, which recorded no ids) keeps its original debit-only guard.
        if (rewardLegIdsOf(tx).includes(t.id)) return true;
        if (isRewardSourceOf(tx, t.accountId) && tx.type === 'debit') return true;

        return false;
      }).map(t => t.id);

      const transactionsToDelete = [id, ...linkedTxsToDelete];

      let remainingTxs = prev.transactions.filter(t => !transactionsToDelete.includes(t.id));

      // Clean up any references in remaining transactions to any deleted transaction
      remainingTxs = remainingTxs.map(t => {
        const intersection = (t.linkedTransactionIds || []).filter(lid => transactionsToDelete.includes(lid));
        if (intersection.length === 0) return t;

        const newLinkedIds = (t.linkedTransactionIds || []).filter(lid => !transactionsToDelete.includes(lid));
        const updated = { ...t, linkedTransactionIds: newLinkedIds };

        // If any of the deleted transactions was a cashback counterpart
        const wasCashbackDeleted = prev.transactions.some(del => intersection.includes(del.id) && del.category === 'Cashback');
        if (wasCashbackDeleted) {
          updated.rewardEarned = 0;
          updated.rewardEarnedType = 'delayed';
          updated.rewardEarnedAccountId = '';
        }

        // If any of the deleted transactions was a reward-split counterpart, that SOURCE goes with
        // it — and only that one. A two-wallet split whose second leg was swept up in a cascade keeps
        // funding the row from the first.
        const survivingSplits = getRewardSplits(t).filter((_, i) => !intersection.some(delId => {
          const del = prev.transactions.find(x => x.id === delId);
          return !!del && rewardSplitIndexOfLeg(t, del) === i;
        }));
        if (survivingSplits.length !== getRewardSplits(t).length) {
          Object.assign(updated, withRewardSplits(t, survivingSplits));
          updated.linkedTransactionIds = newLinkedIds;
        }

        return updated;
      });

      return {
        ...prev,
        transactions: remainingTxs,
        debts: updatedDebts
      };
    });
  };

  const updateCashbackStatement = (statement: CashbackStatement) => {
    setData(prev => {
      const exists = prev.cashbackStatements.find(s => s.id === statement.id);
      if (exists) {
        return {
          ...prev,
          cashbackStatements: prev.cashbackStatements.map(s => s.id === statement.id ? statement : s)
        };
      }
      return {
        ...prev,
        cashbackStatements: [...prev.cashbackStatements, statement]
      };
    });
  };

  const updateCategories = (categories: string[]) => {
    setData(prev => ({ ...prev, categories }));
  };

  const updateCategoryBudgets = (budgets: Record<string, number>) => {
    setData(prev => ({ ...prev, categoryBudgets: budgets }));
  };

  const updateTags = (tags: string[]) => {
    setData(prev => ({ ...prev, tags }));
  };

  const updateEventTags = (eventTags: string[]) => {
    setData(prev => ({ ...prev, eventTags }));
  };

  const updateCustomAccountTypes = (accountTypes: string[]) => {
    setData(prev => ({ ...prev, customAccountTypes: accountTypes }));
  };

  const addSplitEvent = (event: SplitEvent) => {
    setData(prev => ({
      ...prev,
      splitEvents: [...(prev.splitEvents || []), event]
    }));
  };

  const updateSplitEvent = (event: SplitEvent) => {
    setData(prev => ({
      ...prev,
      splitEvents: (prev.splitEvents || []).map(e => e.id === event.id ? event : e)
    }));
  };

  const deleteSplitEvent = (id: string) => {
    setData(prev => ({
      ...prev,
      splitEvents: (prev.splitEvents || []).filter(e => e.id !== id)
    }));
  };

  const addRecurringBill = (bill: RecurringBill) => {
    setData(prev => ({
      ...prev,
      recurringBills: [...(prev.recurringBills || []), bill]
    }));
  };

  const updateRecurringBill = (bill: RecurringBill) => {
    setData(prev => ({
      ...prev,
      recurringBills: (prev.recurringBills || []).map(b => b.id === bill.id ? bill : b)
    }));
  };

  const deleteRecurringBill = (id: string) => {
    setData(prev => ({
      ...prev,
      recurringBills: (prev.recurringBills || []).filter(b => b.id !== id)
    }));
  };

  const addDebt = (debt: Debt) => {
    setData(prev => ({ ...prev, debts: [...(prev.debts || []), debt] }));
  };

  const updateDebt = (debt: Debt) => {
    setData(prev => ({
      ...prev,
      debts: (prev.debts || []).map(d => d.id === debt.id ? debt : d)
    }));
  };

  const deleteDebt = (id: string) => {
    setData(prev => {
      // Transactions that referenced this debt's ledger entries keep their own
      // money record — removing a person is not a reason to delete bank rows —
      // but they have to let go of the reference, because nothing else ever will.
      // The one other cleanup (syncDebtsForTransaction's Scenario B) can only
      // strip ids it can still SEE in the debts, so an id whose entry is already
      // gone is unreachable from the moment it is stranded.
      const doomed = (prev.debts || []).find(d => d.id === id);
      const deadIds = new Set((doomed?.transactions || []).map(dt => dt.id));
      return {
        ...prev,
        debts: (prev.debts || []).filter(d => d.id !== id),
        transactions: deadIds.size === 0 ? prev.transactions : prev.transactions.map(t => {
          const links = linkedIdsOf(t);
          if (!links.some(l => deadIds.has(l))) return t;
          return { ...t, linkedTransactionIds: links.filter(l => !deadIds.has(l)) };
        })
      };
    });
  };

  const loadDemoData = () => {
    const getRelativeDate = (offsetDays: number): string => {
      const d = new Date();
      d.setDate(d.getDate() - offsetDays);
      return d.toISOString().split('T')[0];
    };

    const getMonthDate = (monthOffset: number, day: number): string => {
      const d = new Date();
      d.setMonth(d.getMonth() + monthOffset, 1);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, daysInMonth));
      return d.toISOString().split('T')[0];
    };

    const currentMonth = new Date().toISOString().substring(0, 7);

    const demoAccounts: Account[] = [
      {
        id: 'demo_hdfc',
        name: 'HDFC Bank Savings',
        type: 'bank_account',
        openingBalances: { [currentMonth]: 45000 }
      },
      {
        id: 'demo_indigo',
        name: 'Indigo Premium Card',
        type: 'credit_card',
        statementDay: 15,
        dueDay: 5,
        openingBalances: { [currentMonth]: 0 },
        defaultCashbackRate: 1.5,
        cashbackCreditCycle: 'same_cycle',
        isCashbackEnabled: true
      },
      // Sample investment + commodity holdings so the tour's Smart Features step can showcase
      // the Asset Logos and Commodity AI tiles (they only appear when such holdings exist).
      {
        id: 'demo_stock',
        name: 'OLA Electric Mobility',
        type: 'stocks',
        marketSymbol: 'OLAELEC',
        numberOfShares: 25,
        investedValue: 1500,
        openingBalances: {}
      },
      {
        id: 'demo_mf',
        name: 'Parag Parikh Flexi Cap Fund',
        type: 'mutual_funds',
        marketSymbol: '122639',
        numberOfShares: 150,
        avgNav: 72.5,
        investedValue: 10875,
        openingBalances: {}
      },
      {
        id: 'demo_gold',
        name: 'Digital Gold',
        type: 'commodity',
        commodityMetal: 'gold',
        marketSymbol: 'GOLD',
        investedValue: 3300,
        manualPricePerGram: 7200,
        openingBalances: {}
      },
      {
        id: 'demo_epf',
        name: 'EPFO Savings',
        type: 'epf',
        baseBalance: 34683,
        baseBalanceDate: `${currentMonth}-01`,
        openingBalances: {}
      }
    ];

    const demoTransactions: Transaction[] = [
      {
        id: 'demo_tx_1',
        accountId: 'demo_hdfc',
        date: getRelativeDate(-5),
        description: 'Salary Credit',
        amount: 50000,
        type: 'credit',
        category: 'Salary',
        isRecurring: false
      },
      {
        id: 'demo_tx_2',
        accountId: 'demo_indigo',
        date: getRelativeDate(0),
        description: 'Starbucks Coffee',
        amount: 320,
        type: 'debit',
        category: 'Food',
        isRecurring: false
      },
      {
        id: 'demo_tx_3',
        accountId: 'demo_hdfc',
        date: getRelativeDate(0),
        description: 'Uber Cab Ride',
        amount: 450,
        type: 'debit',
        category: 'Travel',
        isRecurring: false
      },
      {
        id: 'demo_tx_4',
        accountId: 'demo_indigo',
        date: getRelativeDate(0),
        description: 'Netflix Premium',
        amount: 649,
        type: 'debit',
        category: 'Entertainment',
        isRecurring: false
      },
      {
        id: 'demo_cb_tx_1',
        accountId: 'demo_indigo',
        date: getRelativeDate(3),
        description: 'Amazon Shopping Haul',
        amount: 4200,
        type: 'debit',
        category: 'Shopping',
        isRecurring: false,
        rewardEarned: 63,
        rewardEarnedType: 'delayed' as const
      },
      {
        id: 'demo_cb_tx_2',
        accountId: 'demo_indigo',
        date: getRelativeDate(5),
        description: 'Swiggy Dinner',
        amount: 860,
        type: 'debit',
        category: 'Food',
        isRecurring: false,
        rewardEarned: 12.9,
        rewardEarnedType: 'delayed' as const
      },
      {
        id: 'demo_insight_tx_1',
        accountId: 'demo_hdfc',
        date: getRelativeDate(4),
        description: 'Grocery Run',
        amount: 1840,
        type: 'debit',
        category: 'Shopping',
        isRecurring: false
      },
      {
        id: 'demo_insight_tx_2',
        accountId: 'demo_indigo',
        date: getRelativeDate(7),
        description: 'Weekend Brunch',
        amount: 1260,
        type: 'debit',
        category: 'Food',
        isRecurring: false
      },
      {
        id: 'demo_insight_tx_3',
        accountId: 'demo_hdfc',
        date: getRelativeDate(10),
        description: 'Metro Recharge',
        amount: 500,
        type: 'debit',
        category: 'Travel',
        isRecurring: false
      },
      {
        id: 'demo_insight_tx_4',
        accountId: 'demo_indigo',
        date: getRelativeDate(14),
        description: 'Phone Bill',
        amount: 799,
        type: 'debit',
        category: 'Bills',
        isRecurring: true
      },
      {
        id: 'demo_insight_tx_5',
        accountId: 'demo_hdfc',
        date: getMonthDate(-1, 4),
        description: 'Previous Month Groceries',
        amount: 2100,
        type: 'debit',
        category: 'Shopping',
        isRecurring: false
      },
      {
        id: 'demo_insight_tx_6',
        accountId: 'demo_indigo',
        date: getMonthDate(-1, 10),
        description: 'Movie Night',
        amount: 950,
        type: 'debit',
        category: 'Entertainment',
        isRecurring: false
      },
      {
        id: 'demo_insight_tx_7',
        accountId: 'demo_hdfc',
        date: getMonthDate(-1, 18),
        description: 'Fuel Stop',
        amount: 1500,
        type: 'debit',
        category: 'Travel',
        isRecurring: false
      },
      {
        id: 'demo_insight_tx_8',
        accountId: 'demo_hdfc',
        date: getMonthDate(-1, 1),
        description: 'Salary Credit',
        amount: 50000,
        type: 'credit',
        category: 'Salary',
        isRecurring: true
      }
    ];

    const demoSplitEvents: SplitEvent[] = [
      {
        id: 'demo_split_1',
        name: 'Manali Road Trip',
        // Rahul: owes user ₹1000  |  Priya: user owes ₹450  |  Sanjay: marked paid
        people: ['Rahul', 'Priya', 'Sanjay'],
        paidPeople: ['Sanjay'],
        createdAt: Date.now() - 5 * 24 * 3600 * 1000,
        status: 'active',
        items: [
          {
            id: 'demo_split_item_1',
            transactionId: '',
            amount: 2000,
            description: 'Cabin Booking',
            // Only Me + Rahul stayed in the cabin → Rahul owes Me ₹1000
            involvedPeople: ['Rahul'],
            includeMe: true,
            splitType: 'equal',
            paidBy: 'me'
          },
          {
            id: 'demo_split_item_2',
            transactionId: '',
            amount: 1800,
            description: 'Trekking & Meals',
            // All 4 people, Priya paid → Me owes Priya ₹450
            involvedPeople: ['Rahul', 'Sanjay'],
            includeMe: true,
            splitType: 'equal',
            paidBy: 'Priya'
          }
        ]
      }
    ];

    const demoDebts: Debt[] = [
      {
        id: 'demo_debt_1',
        personName: 'Rohan',
        status: 'active',
        createdAt: Date.now() - 6 * 24 * 3600 * 1000,
        updatedAt: Date.now(),
        transactions: [
          {
            id: 'demo_debt_tx_1',
            amount: 2000,
            date: getRelativeDate(5),
            description: 'Concert Tickets',
            type: 'lent'
          },
          {
            id: 'demo_debt_tx_2',
            amount: 500,
            date: getRelativeDate(1),
            description: 'Partial Return',
            type: 'repayment_received'
          }
        ]
      }
    ];

    const demoBills: RecurringBill[] = [
      {
        id: 'demo_bill_1',
        name: 'Electricity Bill',
        amount: 2200,
        category: 'Bills',
        frequency: 'monthly',
        nextDueDate: getRelativeDate(-15),
        accountId: 'demo_hdfc',
        type: 'debit',
        isActive: true
      }
    ];

    setData(prev => {
      const otherAccounts = prev.accounts.filter(a => !a.id.startsWith('demo_'));
      const otherTransactions = prev.transactions.filter(t => !t.id.startsWith('demo_'));
      const otherSplits = (prev.splitEvents || []).filter(s => !s.id.startsWith('demo_'));
      const otherDebts = (prev.debts || []).filter(d => !d.id.startsWith('demo_'));
      const otherBills = (prev.recurringBills || []).filter(b => !b.id.startsWith('demo_'));

      return {
        ...prev,
        accounts: [...otherAccounts, ...demoAccounts],
        transactions: [...otherTransactions, ...demoTransactions],
        splitEvents: [...otherSplits, ...demoSplitEvents],
        debts: [...otherDebts, ...demoDebts],
        recurringBills: [...otherBills, ...demoBills],
        cashbackStatements: (prev.cashbackStatements || []).filter(s => !s.id.startsWith('demo_'))
      };
    });
  };

  const clearDemoData = () => {
    setData(prev => ({
      ...prev,
      accounts: prev.accounts.filter(a => !a.id.startsWith('demo_')),
      transactions: prev.transactions.filter(t => !t.id.startsWith('demo_')),
      splitEvents: (prev.splitEvents || []).filter(s => !s.id.startsWith('demo_')),
      debts: (prev.debts || []).filter(d => !d.id.startsWith('demo_')),
      recurringBills: (prev.recurringBills || []).filter(b => !b.id.startsWith('demo_')),
      cashbackStatements: (prev.cashbackStatements || []).filter(s => !s.id.startsWith('demo_')),
    }));
  };

  const clearAllData = () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    clearChatHistory();   // Ask Vault chats can quote finances — wipe them too.
    setData({ user: { id: 'default', name: 'spendvault user', biometricsEnabled: false }, accounts: [], transactions: [], cashbackStatements: [], categories: DEFAULT_CATEGORIES, tags: DEFAULT_TAGS, customAccountTypes: DEFAULT_CUSTOM_ACCOUNT_TYPES, theme: 'dark' });
    window.location.reload();
  };

  return (
    <FinanceContext.Provider value={{
      data,
      pendingTransfer,
      setPendingTransfer,
      smsQueue,
      smsScreening,
      addToSmsQueue,
      removeFromSmsQueue,
      removeSmsByMatch,
      addAccount,
      updateAccount,
      deleteAccount,
      archiveAccount,
      restoreAccount,
      addTransaction,
      updateTransaction,
      reorderTransactions,
      setRewardLegExclusion,
      deleteTransaction,
      updateCashbackStatement,
      updateCategories,
      updateCategoryBudgets,
      updateTags,
      updateEventTags,
      updateCustomAccountTypes,
      addSplitEvent,
      updateSplitEvent,
      deleteSplitEvent,
      addRecurringBill,
      updateRecurringBill,
      deleteRecurringBill,
      addDebt,
      updateDebt,
      deleteDebt,
      clearAllData,
      loadDemoData,
      clearDemoData,
      updateUser,
      isAuthenticated,
      setAuthenticated,
      setTheme
    }}>
      {children}
    </FinanceContext.Provider>
  );
};

export const useFinance = () => {
  const context = useContext(FinanceContext);
  if (!context) throw new Error('useFinance must be used within FinanceProvider');
  return context;
};
