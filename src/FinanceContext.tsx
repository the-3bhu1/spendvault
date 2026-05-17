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

  const addToSmsQueue = (tx: PendingSmsTransaction) => {
    setSmsQueue(prev => [...prev, tx]);
  };

  const removeFromSmsQueue = (index: number) => {
    setSmsQueue(prev => prev.filter((_, i) => i !== index));
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
      let updatedTxs = prev.transactions.map(t => t.id === transaction.id ? transaction : t);
      
      const allLinkedIds = transaction.linkedTransactionIds || (transaction.linkedTransactionId ? [transaction.linkedTransactionId] : []);
      
      const isCashback = transaction.category === 'Cashback';
      
      if (allLinkedIds.length > 0 && !isCashback) {
        updatedTxs = updatedTxs.map(t => {
          if (allLinkedIds.includes(t.id)) {
            // Propagate date ALWAYS
            let updated = { ...t, date: transaction.date };
            
            // Handle Amount Propagation
            const isCCPayment = transaction.category?.toLowerCase() === 'cc payment';
            if (isCCPayment) {
              if (transaction.rewardUsed && transaction.rewardUsedAccountId) {
                // Determine if this linked tx is the Reward Debit or the Bank Debit
                if (t.accountId === transaction.rewardUsedAccountId) {
                  updated.amount = transaction.rewardUsed;
                } else {
                  // It's the bank portion
                  updated.amount = transaction.amount - transaction.rewardUsed;
                }
              } else {
                // Standard 1:1
                updated.amount = transaction.amount;
              }
            } else {
              // Non-split transfer/payment: 1:1
              updated.amount = transaction.amount;
            }
            return updated;
          }
          return t;
        });
      }
      
      let updatedDebts = prev.debts || [];
      if (allLinkedIds.length > 0) {
        updatedDebts = updatedDebts.map(debt => ({
          ...debt,
          transactions: debt.transactions.map(dt => {
            if (allLinkedIds.includes(dt.id)) {
              return { ...dt, date: transaction.date };
            }
            return dt;
          })
        }));
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

      const shouldSyncDelete = tx.category === 'Transfer' || tx.category === 'CC Payment';
      const transactionsToDelete = [id, ...(shouldSyncDelete ? linkedIds : [])];

      return {
        ...prev,
        transactions: prev.transactions.filter(t => !transactionsToDelete.includes(t.id)),
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
