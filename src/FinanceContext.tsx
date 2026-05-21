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
}

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
  addTransaction: (transaction: Transaction) => void;
  updateTransaction: (transaction: Transaction) => void;
  reorderTransactions: (tx1: Transaction, tx2: Transaction) => void;
  deleteTransaction: (id: string) => void;
  updateCashbackStatement: (statement: CashbackStatement) => void;
  updateCategories: (categories: string[]) => void;
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
  isAuthenticated: boolean;
  setAuthenticated: (value: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'minimalist_finance_data_v1';
const DEFAULT_CATEGORIES = ['Food', 'Shopping', 'Income', 'Salary', 'Rent', 'Travel', 'Bills', 'Entertainment', 'CC Payment', 'Loans', 'Lending & Borrowing', 'NCMC Travel Recharge', 'Cashback', 'Other/Miscellaneous'];
const DEFAULT_CUSTOM_ACCOUNT_TYPES: string[] = [];

export const FinanceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const [smsQueue, setSmsQueue] = useState<PendingSmsTransaction[]>([]);
  const [recentlyProcessedSms, setRecentlyProcessedSms] = useState<{ amount: number; type: string; sourceIdentifier?: string; timestamp: number }[]>([]);

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
            { amount: tx.amount, type: tx.type, sourceIdentifier: tx.sourceIdentifier, timestamp: now }
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

      // Record this transaction as processed
      setRecentlyProcessedSms(recent => [
        ...recent,
        { amount: tx.amount, type: tx.type, sourceIdentifier: tx.sourceIdentifier, timestamp: now }
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

  const [data, setData] = useState<FinanceData>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        
        // Data Migration: Convert old ncmc_card type to debit_card with NCMC enabled
        const nativeTypes = ['credit_card', 'debit_card', 'bank_account', 'e_wallet', 'stocks', 'sips', 'rewards', 'cash'];
        
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

        if (!parsed.categories || parsed.categories.length === 0) {
          parsed.categories = [...DEFAULT_CATEGORIES];
        } else if (!parsed.categories.includes('Loans')) {
          // Auto-add Loans if it's missing from existing data
          parsed.categories.push('Loans');
        } else {
          // Data Migration: Inject categories for existing users if missing
          if (!parsed.categories.includes('Cashback')) {
            parsed.categories.push('Cashback');
          }
          if (!parsed.categories.includes('Lending & Borrowing')) {
            parsed.categories.push('Lending & Borrowing');
          }
        }

        if (!parsed.user) {
          parsed.user = { id: 'default', name: 'spendvault user', biometricsEnabled: false };
        } else {
          // Migration: Remove old password if it exists
          if ((parsed.user as any).password) {
            delete (parsed.user as any).password;
          }
        }

        if (!parsed.theme) {
          parsed.theme = 'dark';
        }

        parsed.transactions = (parsed.transactions || []).map((t: any) => {
          if (t.linkedTransactionId && !t.linkedTransactionIds) {
            t = { ...t, linkedTransactionIds: [t.linkedTransactionId] };
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
        return parsed;
      } catch (e) {
        console.error("Failed to parse local storage", e);
      }
    }
    return { 
      user: { id: 'default', name: 'spendvault user', biometricsEnabled: false },
      accounts: [], 
      transactions: [], 
      cashbackStatements: [], 
      categories: DEFAULT_CATEGORIES,
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

  // Define these before migration hook
  const updateUser = (user: User) => {
    setData(prev => ({ ...prev, user }));
  };

  const setTheme = (theme: 'light' | 'dark') => {
    setData(prev => ({ ...prev, theme }));
  };

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

  const addTransaction = (transaction: Transaction) => {
    setData(prev => ({
      ...prev,
      transactions: [...prev.transactions, transaction]
    }));
  };

  const updateTransaction = (transaction: Transaction) => {
    setData(prev => {
      const oldTx = prev.transactions.find(t => t.id === transaction.id);
      const wasTransferOrCC = oldTx && (
        oldTx.category?.toLowerCase() === 'transfer' || 
        oldTx.category?.toLowerCase() === 'cc payment' || 
        oldTx.category?.toLowerCase() === 'ncmc travel recharge'
      );
      const isNowTransferOrCC = transaction.category?.toLowerCase() === 'transfer' || 
                                 transaction.category?.toLowerCase() === 'cc payment' || 
                                 transaction.category?.toLowerCase() === 'ncmc travel recharge';
      
      let txsToDelete: string[] = [];
      let updatedTransaction = { ...transaction };
      
      if (wasTransferOrCC && (!isNowTransferOrCC || !transaction.paymentSourceAccountId)) {
        const allLinkedIds = transaction.linkedTransactionIds || (transaction.linkedTransactionId ? [transaction.linkedTransactionId] : []);
        const counterpartTxs = prev.transactions.filter(t => 
          allLinkedIds.includes(t.id) && 
          t.id !== transaction.id &&
          (t.category?.toLowerCase() === 'transfer' || t.category?.toLowerCase() === 'cc payment' || t.category?.toLowerCase() === 'ncmc travel recharge')
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
      
      if (allLinkedIds.length > 0 && !isCashback) {
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
            } 
            // Otherwise it's a Transfer counterpart or CC payment bank portion
            else {
              const isCCPayment = updatedTransaction.category?.toLowerCase() === 'cc payment';
              const isNcmcRecharge = updatedTransaction.category?.toLowerCase() === 'ncmc travel recharge';
              if (isCCPayment) {
                if (updatedTransaction.rewardUsed && updatedTransaction.rewardUsedAccountId) {
                  // It's the bank portion
                  updated.amount = updatedTransaction.amount - updatedTransaction.rewardUsed;
                } else {
                  // Standard 1:1
                  updated.amount = updatedTransaction.amount;
                }
              } else {
                // Non-split transfer/payment: 1:1
                updated.amount = updatedTransaction.amount;
              }
              
              if (isNcmcRecharge) {
                updated.category = 'NCMC Travel Recharge';
              } else if (updatedTransaction.category === 'Transfer') {
                updated.category = 'Transfer';
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
      
      return { ...prev, transactions: updatedTxs, debts: updatedDebts };
    });
  };

  const reorderTransactions = (tx1: Transaction, tx2: Transaction) => {
    setData(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => {
        if (t.id === tx1.id) return tx1;
        if (t.id === tx2.id) return tx2;
        return t;
      })
    }));
  };

  const deleteTransaction = (id: string) => {
    setData(prev => {
      const tx = prev.transactions.find(t => t.id === id);
      if (!tx) return prev;

      const linkedIds = (tx.linkedTransactionIds || (tx.linkedTransactionId ? [tx.linkedTransactionId] : []));
      
      let updatedDebts = prev.debts || [];
      if (linkedIds.length > 0) {
        updatedDebts = updatedDebts.map(debt => ({
          ...debt,
          transactions: debt.transactions.filter(dt => !linkedIds.includes(dt.id))
        })).filter(debt => debt.transactions.length > 0);
      }

      // Determine which linked transactions should also be deleted
      const linkedTxsToDelete = prev.transactions.filter(t => {
        if (!linkedIds.includes(t.id)) return false;
        
        // 1. Always delete Transfer, CC Payment, or NCMC Travel Recharge counterpart legs
        if (tx.category === 'Transfer' || tx.category === 'CC Payment' || tx.category === 'NCMC Travel Recharge') return true;
        
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

  const clearAllData = () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setData({ user: { id: 'default', name: 'spendvault user', biometricsEnabled: false }, accounts: [], transactions: [], cashbackStatements: [], categories: DEFAULT_CATEGORIES, customAccountTypes: DEFAULT_CUSTOM_ACCOUNT_TYPES, theme: 'dark' });
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
      addTransaction,
      updateTransaction,
      reorderTransactions,
      deleteTransaction,
      updateCashbackStatement,
      updateCategories,
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
