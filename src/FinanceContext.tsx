import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Account, CashbackStatement, FinanceData, Transaction, User, SplitEvent, RecurringBill, Debt } from './types';

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
  // Investment legs (SIP / mutual fund / stock purchase).
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
  deleteTransaction: (id: string) => void;
  updateCashbackStatement: (statement: CashbackStatement) => void;
  updateCategories: (categories: string[]) => void;
  updateCategoryBudgets: (budgets: Record<string, number>) => void;
  updateTags: (tags: string[]) => void;
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
const DEFAULT_CATEGORIES = ['Food', 'Shopping', 'Income', 'Salary', 'Rent', 'Travel', 'Bills', 'Entertainment', 'CC Payment', 'Loans', 'Lending & Borrowing', 'NCMC Travel Recharge', 'Cashback', 'SIP', 'Stocks', 'Commodity', 'Other/Miscellaneous'];
const DEFAULT_CUSTOM_ACCOUNT_TYPES: string[] = [];
const DEFAULT_TAGS: string[] = [];

export const FinanceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const [smsQueue, setSmsQueue] = useState<PendingSmsTransaction[]>([]);
  const [recentlyProcessedSms, setRecentlyProcessedSms] = useState<{ amount: number; type: string; sourceIdentifier?: string; source?: string; raw?: string; timestamp: number }[]>([]);

  const addToSmsQueue = (tx: PendingSmsTransaction) => {
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
        const nativeTypes = ['credit_card', 'debit_card', 'bank_account', 'e_wallet', 'stocks', 'sips', 'rewards', 'cash', 'commodity'];
        
        parsed.accounts = (parsed.accounts || []).map((acc: any) => {
          if (acc.type === 'ncmc_card') {
            return { ...acc, type: 'debit_card', isNcmcEnabled: true };
          }
          // Migration: Convert custom 'eWallet' variations to native 'e_wallet' type
          const lowerType = acc.type.toLowerCase();
          if (lowerType === 'ewallet' || lowerType === 'e-wallet') {
            return { ...acc, type: 'e_wallet' };
          }
          return acc;
        });

        if (!parsed.customAccountTypes) {
          parsed.customAccountTypes = [];
        }

        // Recovery: Re-add any custom account types found in the accounts list that are missing
        parsed.accounts.forEach((acc: any) => {
          if (!nativeTypes.includes(acc.type) && !parsed.customAccountTypes.includes(acc.type)) {
            parsed.customAccountTypes.push(acc.type);
          }
        });

        // Migration: Rename 'SIP / Mutual Funds' to 'SIP' in categories list
        if (parsed.categories) {
          parsed.categories = parsed.categories.map((c: string) => c === 'SIP / Mutual Funds' ? 'SIP' : c);
        }

        if (!parsed.categories || parsed.categories.length === 0) {
          parsed.categories = [...DEFAULT_CATEGORIES];
        } else {
          // Auto-add missing standard categories
          if (!parsed.categories.includes('Loans')) {
            parsed.categories.push('Loans');
          }
          if (!parsed.categories.includes('Cashback')) {
            parsed.categories.push('Cashback');
          }
          if (!parsed.categories.includes('Lending & Borrowing')) {
            parsed.categories.push('Lending & Borrowing');
          }
          if (!parsed.categories.includes('SIP')) {
            parsed.categories.push('SIP');
          }
          if (!parsed.categories.includes('Stocks')) {
            parsed.categories.push('Stocks');
          }
          if (!parsed.categories.includes('Commodity')) {
            parsed.categories.push('Commodity');
          }

          // NOTE for future AI models: Ensure 'Other/Misc' is always at the end
          const miscIndex = parsed.categories.findIndex((c: string) => c.toLowerCase() === 'other/misc' || c.toLowerCase() === 'other/miscellaneous');
          if (miscIndex !== -1 && miscIndex !== parsed.categories.length - 1) {
            const [misc] = parsed.categories.splice(miscIndex, 1);
            parsed.categories.push(misc);
          }
        }

        if (!parsed.user) {
          parsed.user = { id: 'default', name: 'spendvault user', biometricsEnabled: false, enablePassiveTransactions: true };
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
        }

        if (!parsed.theme) {
          parsed.theme = 'dark';
        }

        parsed.transactions = (parsed.transactions || []).map((t: any) => {
          if (t.linkedTransactionId && !t.linkedTransactionIds) {
            t = { ...t, linkedTransactionIds: [t.linkedTransactionId] };
          }
          if (t.category === 'SIP / Mutual Funds') {
            t.category = 'SIP';
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


        if (!parsed.debts) parsed.debts = [];
        if (!parsed.tags) parsed.tags = [];
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
      customAccountTypes: DEFAULT_CUSTOM_ACCOUNT_TYPES,
      splitEvents: [],
      recurringBills: [],
      debts: [],
      theme: 'dark'
    };
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', data.theme || 'dark');
  }, [data.theme]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  }, [data]);


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

  const addTransaction = (transaction: Transaction) => {
    setData(prev => {
      const txsOnDate = prev.transactions.filter(t => t.date === transaction.date);
      const maxOrder = txsOnDate.reduce((max, t, idx) => {
        const ord = t.order !== undefined ? t.order : idx;
        return ord > max ? ord : max;
      }, -1);
      const newTx = {
        ...transaction,
        order: transaction.order !== undefined ? transaction.order : (maxOrder + 1)
      };
      return {
        ...prev,
        transactions: [...prev.transactions, newTx]
      };
    });
  };

  // Linked (parent ↔ child) transaction edit/delete sync — full behavior matrix, discriminators,
  // and the "parent is source of truth" design rationale: docs/LINKED_TRANSACTIONS.md
  const updateTransaction = (transaction: Transaction) => {
    setData(prev => {
      const oldTx = prev.transactions.find(t => t.id === transaction.id);
      const wasTransferOrCC = oldTx && (
        oldTx.category?.toLowerCase() === 'transfer' ||
        oldTx.category?.toLowerCase() === 'cc payment' ||
        oldTx.category?.toLowerCase() === 'ncmc travel recharge' ||
        oldTx.category?.toLowerCase() === 'sip' ||
        oldTx.category?.toLowerCase() === 'stocks' ||
        oldTx.category?.toLowerCase() === 'commodity'
      );
      const isNowTransferOrCC = transaction.category?.toLowerCase() === 'transfer' ||
                                 transaction.category?.toLowerCase() === 'cc payment' ||
                                 transaction.category?.toLowerCase() === 'ncmc travel recharge' ||
                                 transaction.category?.toLowerCase() === 'sip' ||
                                 transaction.category?.toLowerCase() === 'stocks' ||
                                 transaction.category?.toLowerCase() === 'commodity';
      
      let txsToDelete: string[] = [];
      let updatedTransaction = { ...transaction };

      // Reward-split (3-leg CC Payment) edit detection — Option B keeps the card credit as the
      // fixed anchor; the non-edited funding leg absorbs the change. See docs/LINKED_TRANSACTIONS.md.
      // (a) editing the REWARD leg: a linked parent uses this tx's account as rewardUsedAccountId.
      const rewardSplitParent = prev.transactions.find(p =>
        p.id !== transaction.id &&
        (p.linkedTransactionIds || []).includes(transaction.id) &&
        !!p.rewardUsedAccountId &&
        p.rewardUsedAccountId === transaction.accountId
      );
      const isRewardSplitChildEdit = !!rewardSplitParent;
      // (b) editing the BANK leg of a parent that has an active reward split.
      const bankLegParent = !rewardSplitParent ? prev.transactions.find(p =>
        p.id !== transaction.id &&
        (p.linkedTransactionIds || []).includes(transaction.id) &&
        !!p.rewardUsedAccountId && (p.rewardUsed || 0) > 0 &&
        p.rewardUsedAccountId !== transaction.accountId
      ) : undefined;
      const isRewardSplitBankEdit = !!bankLegParent;

      // Guard: a reward/bank leg edit must NOT be mistaken for "payment source removed" (which would
      // delete the card parent). Those edits rebalance via the reverse blocks below instead.
      if (wasTransferOrCC && (!isNowTransferOrCC || !transaction.paymentSourceAccountId) && !isRewardSplitChildEdit && !isRewardSplitBankEdit) {
        const allLinkedIds = transaction.linkedTransactionIds || (transaction.linkedTransactionId ? [transaction.linkedTransactionId] : []);
        const counterpartTxs = prev.transactions.filter(t => 
          allLinkedIds.includes(t.id) && 
          t.id !== transaction.id &&
          (t.category?.toLowerCase() === 'transfer' || t.category?.toLowerCase() === 'cc payment' || t.category?.toLowerCase() === 'ncmc travel recharge' || t.category?.toLowerCase() === 'sip' || t.category?.toLowerCase() === 'stocks' || t.category?.toLowerCase() === 'commodity')
        );
        txsToDelete = counterpartTxs.map(t => t.id);
        
        if (updatedTransaction.linkedTransactionIds) {
          updatedTransaction.linkedTransactionIds = updatedTransaction.linkedTransactionIds.filter(id => !txsToDelete.includes(id));
        }
        updatedTransaction.paymentSourceAccountId = '';
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
            let updated = { ...t, date: updatedTransaction.date };
            
            // Check if this linked transaction is a Cashback counterpart
            if (t.category === 'Cashback') {
              updated.amount = Number(updatedTransaction.rewardEarned) || 0;
              updated.description = `Instant Cashback: ${updatedTransaction.description}`;
              if (updatedTransaction.rewardEarnedAccountId) {
                updated.accountId = updatedTransaction.rewardEarnedAccountId;
              }
            } 
            // Check if this linked transaction is a Reward Split counterpart
            else if (updatedTransaction.rewardUsedAccountId && t.accountId === updatedTransaction.rewardUsedAccountId) {
              updated.amount = Number(updatedTransaction.rewardUsed) || 0;
              const isCCPayment = updatedTransaction.category?.toLowerCase() === 'cc payment';
              updated.description = isCCPayment ? t.description : `Rewards applied to: ${updatedTransaction.description}`;
              const rewardsSourceAcc = prev.accounts.find(a => a.id === updatedTransaction.rewardUsedAccountId);
              updated.isRewardTransaction = !!(rewardsSourceAcc?.isCashbackEnabled && rewardsSourceAcc?.rewardType === 'points');
            } 
            // Otherwise it's a Transfer counterpart, SIP, or CC payment bank portion
            else {
              const isCCPayment = updatedTransaction.category?.toLowerCase() === 'cc payment';
              const isNcmcRecharge = updatedTransaction.category?.toLowerCase() === 'ncmc travel recharge';
              const isSip = updatedTransaction.category?.toLowerCase() === 'sip';
              const isStocks = updatedTransaction.category?.toLowerCase() === 'stocks';
              const isCommodity = updatedTransaction.category?.toLowerCase() === 'commodity';
              if (isCCPayment) {
                if (updatedTransaction.rewardUsed && updatedTransaction.rewardUsedAccountId) {
                  // It's the bank portion
                  updated.amount = updatedTransaction.amount - updatedTransaction.rewardUsed;
                } else {
                  // Standard 1:1
                  updated.amount = updatedTransaction.amount;
                }
              } else if (isSip) {
                if (updated.type === 'credit') {
                  updated.amount = Number(updatedTransaction.sipAllottedAmount) || 0;
                } else {
                  updated.amount = (Number(updatedTransaction.sipAllottedAmount) || 0) + (Number(updatedTransaction.sipCharges) || 0);
                }
                updated.sipAllottedAmount = updatedTransaction.sipAllottedAmount;
                updated.sipCharges = updatedTransaction.sipCharges;
                updated.numberOfShares = updatedTransaction.numberOfShares;
              } else if (isStocks) {
                if (updated.type === 'credit') {
                  updated.amount = Number(updatedTransaction.sipAllottedAmount) || updatedTransaction.amount;
                } else {
                  updated.amount = (Number(updatedTransaction.sipAllottedAmount) || updatedTransaction.amount) + (Number(updatedTransaction.sipCharges) || 0);
                }
                updated.sipAllottedAmount = updatedTransaction.sipAllottedAmount;
                updated.sipCharges = updatedTransaction.sipCharges;
                updated.numberOfShares = updatedTransaction.numberOfShares;
              } else if (isCommodity) {
                updated.amount = updatedTransaction.amount;
                updated.numberOfShares = updatedTransaction.numberOfShares;
              } else {
                // Non-split transfer/payment: 1:1
                updated.amount = updatedTransaction.amount;
              }

              if (isNcmcRecharge) {
                updated.category = 'NCMC Travel Recharge';
              } else if (updatedTransaction.category === 'Transfer') {
                updated.category = 'Transfer';
              } else if (isSip) {
                updated.category = 'SIP';
              } else if (isStocks) {
                updated.category = 'Stocks';
                updated.description = updatedTransaction.description;
              } else if (isCommodity) {
                updated.category = 'Commodity';
                updated.description = updatedTransaction.description;
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
                } else if (isSip || isStocks || isCommodity) {
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
        // Option B — edited the REWARD leg. Card credit (parent.amount) is the fixed anchor;
        // the bank leg absorbs: bank = total − reward. Parent.rewardUsed follows the reward leg.
        const total = rewardSplitParent.amount;
        const newReward = updatedTransaction.amount;
        const bankAmount = Math.max(0, total - newReward);
        const rewardAcct = updatedTransaction.accountId;
        const bankLegId = (rewardSplitParent.linkedTransactionIds || []).find(id => {
          const lt = prev.transactions.find(t => t.id === id);
          return !!lt && lt.id !== updatedTransaction.id && lt.accountId !== rewardAcct && lt.accountId !== rewardSplitParent.accountId;
        });
        updatedTxs = updatedTxs.map(t => {
          if (t.id === rewardSplitParent.id) {
            return { ...t, rewardUsed: newReward, rewardUsedAccountId: rewardAcct, date: updatedTransaction.date };
          }
          if (bankLegId && t.id === bankLegId) {
            return { ...t, amount: bankAmount, date: updatedTransaction.date };
          }
          return t;
        });
      } else if (isRewardSplitBankEdit && bankLegParent) {
        // Option B (symmetric) — edited the BANK leg. Card credit stays fixed; the reward leg
        // absorbs: reward = total − bank. Parent.rewardUsed follows the new reward amount.
        const total = bankLegParent.amount;
        const newBank = updatedTransaction.amount;
        const newReward = Math.max(0, total - newBank);
        const rewardAcct = bankLegParent.rewardUsedAccountId;
        const rewardLegId = (bankLegParent.linkedTransactionIds || []).find(id => {
          const lt = prev.transactions.find(t => t.id === id);
          return !!lt && lt.accountId === rewardAcct;
        });
        updatedTxs = updatedTxs.map(t => {
          if (t.id === bankLegParent.id) {
            return { ...t, rewardUsed: newReward, date: updatedTransaction.date };
          }
          if (rewardLegId && t.id === rewardLegId) {
            return { ...t, amount: newReward, date: updatedTransaction.date };
          }
          return t;
        });
      }

      let updatedDebts = prev.debts || [];
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
  const deleteTransaction = (id: string) => {
    setData(prev => {
      const tx = prev.transactions.find(t => t.id === id);
      if (!tx) return prev;

      // Special case: deleting ONLY the reward leg of a 3-leg reward-split payment does NOT remove
      // the payment. It un-splits it — the card credit stays, the bank leg absorbs the reward amount
      // (bank = card total), and the parent's reward split is cleared. See docs/LINKED_TRANSACTIONS.md.
      const rewardSplitParentOnDelete = prev.transactions.find(p =>
        p.id !== tx.id &&
        (p.linkedTransactionIds || []).includes(tx.id) &&
        !!p.rewardUsedAccountId && (p.rewardUsed || 0) > 0 &&
        p.rewardUsedAccountId === tx.accountId
      );
      if (rewardSplitParentOnDelete) {
        const total = rewardSplitParentOnDelete.amount; // card credit = fixed total
        const rewardAcct = tx.accountId;
        const bankLegId = (rewardSplitParentOnDelete.linkedTransactionIds || []).find(lid => {
          const lt = prev.transactions.find(t => t.id === lid);
          return !!lt && lt.id !== tx.id && lt.accountId !== rewardAcct && lt.accountId !== rewardSplitParentOnDelete.accountId;
        });
        const remaining = prev.transactions
          .filter(t => t.id !== tx.id)
          .map(t => {
            if (t.id === rewardSplitParentOnDelete.id) {
              return {
                ...t,
                rewardUsed: 0,
                rewardUsedAccountId: '',
                linkedTransactionIds: (t.linkedTransactionIds || []).filter(l => l !== tx.id),
              };
            }
            if (bankLegId && t.id === bankLegId) {
              return {
                ...t,
                amount: total,
                linkedTransactionIds: (t.linkedTransactionIds || []).filter(l => l !== tx.id),
              };
            }
            if ((t.linkedTransactionIds || []).includes(tx.id)) {
              return { ...t, linkedTransactionIds: (t.linkedTransactionIds || []).filter(l => l !== tx.id) };
            }
            return t;
          });
        const debtsAfter = (prev.debts || [])
          .map(debt => ({ ...debt, transactions: debt.transactions.filter(dt => dt.id !== tx.id) }))
          .filter(debt => debt.transactions.length > 0);
        return { ...prev, transactions: remaining, debts: debtsAfter };
      }

      const linkedIds = (tx.linkedTransactionIds || (tx.linkedTransactionId ? [tx.linkedTransactionId] : []));
      
      let updatedDebts = prev.debts || [];
      if (linkedIds.length > 0) {
        updatedDebts = updatedDebts.map(debt => ({
          ...debt,
          transactions: debt.transactions.filter(dt => !linkedIds.includes(dt.id))
        })).filter(debt => debt.transactions.length > 0);
      }

      // Leg-type links (Transfer/CC/NCMC/SIP/Stocks/Commodity) form a STAR around the parent:
      // children link to the parent, not to each other. Deleting one child must take the whole
      // group — otherwise a 3-leg reward-split CC payment orphans its sibling leg. So we expand
      // to the full transitively-linked leg group. See docs/LINKED_TRANSACTIONS.md.
      const LEG_CATS = ['transfer', 'cc payment', 'ncmc travel recharge', 'sip', 'stocks', 'commodity'];
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

        // 3. If parent is deleted, delete linked reward split counterpart
        if (tx.rewardUsedAccountId && t.accountId === tx.rewardUsedAccountId && tx.type === 'debit') return true;

        return false;
      }).map(t => t.id);

      const transactionsToDelete = [id, ...linkedTxsToDelete];

      let remainingTxs = prev.transactions.filter(t => !transactionsToDelete.includes(t.id));

      // Clean up any references in remaining transactions to any deleted transaction
      remainingTxs = remainingTxs.map(t => {
        const intersection = (t.linkedTransactionIds || []).filter(lid => transactionsToDelete.includes(lid));
        if (intersection.length === 0) return t;

        const newLinkedIds = (t.linkedTransactionIds || []).filter(lid => !transactionsToDelete.includes(lid));
        let updated = { ...t, linkedTransactionIds: newLinkedIds };

        // If any of the deleted transactions was a cashback counterpart
        const wasCashbackDeleted = prev.transactions.some(del => intersection.includes(del.id) && del.category === 'Cashback');
        if (wasCashbackDeleted) {
          updated.rewardEarned = 0;
          updated.rewardEarnedType = 'delayed';
          updated.rewardEarnedAccountId = '';
        }

        // If any of the deleted transactions was a reward split counterpart
        const wasRewardSplitDeleted = prev.transactions.some(del => intersection.includes(del.id) && t.rewardUsedAccountId && del.accountId === t.rewardUsedAccountId);
        if (wasRewardSplitDeleted) {
          updated.rewardUsed = 0;
          updated.rewardUsedAccountId = '';
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
    setData(prev => ({
      ...prev,
      debts: (prev.debts || []).filter(d => d.id !== id)
    }));
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
    setData({ user: { id: 'default', name: 'spendvault user', biometricsEnabled: false }, accounts: [], transactions: [], cashbackStatements: [], categories: DEFAULT_CATEGORIES, tags: DEFAULT_TAGS, customAccountTypes: DEFAULT_CUSTOM_ACCOUNT_TYPES, theme: 'dark' });
    window.location.reload();
  };

  return (
    <FinanceContext.Provider value={{
      data,
      pendingTransfer,
      setPendingTransfer,
      smsQueue,
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
      deleteTransaction,
      updateCashbackStatement,
      updateCategories,
      updateCategoryBudgets,
      updateTags,
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
