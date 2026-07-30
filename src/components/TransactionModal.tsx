import React, { useState, useRef, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Sparkles, Calendar, Hash, BanknoteArrowUp, BanknoteArrowDown, Wallet } from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';
import { useFinance } from '../FinanceContext';
import type { Transaction, TransactionType, Account, InvestmentKind } from '../types';
import { CustomPicker } from './CustomPicker';
import { getCategoryIcon, getAccountTypeIcon, getAccountGroupLabel, sortByAccountType, getInvestmentKindIcon } from './transactionIcons';
import { getBillingCycleForDate, isInvestmentCategory, INVESTMENT_KIND_OPTIONS, investmentKindLabel, investmentAccountTypeFor } from '../utils';

// DUPLICATE MODAL WARNING: this is a separate, independent implementation of the
// log/edit-transaction form from the one inlined in Transactions.tsx (the main Ledger's
// "Log Transaction" modal). They are NOT the same component — this one is used by the
// Upcoming Bills "LOG" button (and any other initialData-driven quick-log entry points).
// Changing amount/decimal parsing, mutual-fund/stock allotted-vs-charges logic, reward-split
// handling, or account-icon rendering here must be mirrored in Transactions.tsx (and vice
// versa), or the two log forms will silently drift apart again.
interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  editId?: string | null;
  initialData?: Partial<Transaction>;
  onSuccess?: () => void;
}

export const getAccountIcon = (accountId: string, accounts: Account[]) => {
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return <Wallet size={18} />;
  return getAccountTypeIcon(acc.type, 18, acc.archived);
};

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  editId,
  initialData,
  onSuccess
}) => {
  const { data, addTransaction, updateTransaction, updateRecurringBill, updateTags } = useFinance();
  const [newTx, setNewTx] = useState<Partial<Transaction>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
    amount: 0,
    type: 'debit',
    category: 'Bills',
    accountId: data.accounts.find(a => !a.archived)?.id || '',
    excludeFromStats: false,
    tags: [],
    ...initialData
  });

  // Mirrors the numeric fields as raw text so a trailing "." or "0" typed by the
  // user isn't stripped by the numeric round-trip on every render (which would
  // block entering decimals like "2999.85").
  const toInputStr = (n?: number) => (n === 0 || n === undefined) ? '' : n.toString();
  const syncInputStrings = (tx: Partial<Transaction>) => setInputStrings({
    amount: toInputStr(tx.amount),
    allottedAmount: toInputStr(tx.allottedAmount),
    investmentCharges: toInputStr(tx.investmentCharges),
    rewardUsed: toInputStr(tx.rewardUsed),
    numberOfShares: toInputStr(tx.numberOfShares)
  });
  const [inputStrings, setInputStrings] = useState({
    amount: toInputStr(newTx.amount),
    allottedAmount: toInputStr(newTx.allottedAmount),
    investmentCharges: toInputStr(newTx.investmentCharges),
    rewardUsed: toInputStr(newTx.rewardUsed),
    numberOfShares: toInputStr(newTx.numberOfShares)
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [descriptionSuggestions, setDescriptionSuggestions] = useState<string[]>([]);
  const [paymentSourceAccountId, setPaymentSourceAccountId] = useState('');
  const [ccPaymentCycleTarget, setCcPaymentCycleTarget] = useState<'current_cycle' | 'previous_statement'>('previous_statement');
  const [showRewardSplit, setShowRewardSplit] = useState(false);
  const [selectedCashbackLevelId] = useState('');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');

  const rewardSplitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (editId) {
        const tx = data.transactions.find(t => t.id === editId);
        if (tx) {
          setNewTx(tx);
          syncInputStrings(tx);
          if (tx.rewardUsed && tx.rewardUsed > 0) setShowRewardSplit(true);
          if (tx.paymentSourceAccountId) setPaymentSourceAccountId(tx.paymentSourceAccountId);
        }
      } else if (initialData) {
        const freshTx = {
          date: format(new Date(), 'yyyy-MM-dd'),
          description: '',
          amount: 0,
          type: 'debit' as TransactionType,
          category: 'Bills',
          accountId: data.accounts.find(a => !a.archived)?.id || '',
          excludeFromStats: false,
          tags: [],
          ...initialData
        };
        setNewTx(freshTx);
        syncInputStrings(freshTx);
        // Reset local UI states for new entry
        setShowRewardSplit(false);
        setPaymentSourceAccountId(initialData.paymentSourceAccountId || '');
      }
      setNewTagInput('');
      setErrors({}); // clear stale validation errors from a previous open
    }
  }, [isOpen]); // Only run when modal opens

  const handleCreateTag = () => {
    const raw = newTagInput.trim().replace(/^#/, '');
    if (!raw) return;
    const existing = data.tags || [];
    if (!existing.includes(raw)) {
      updateTags([...existing, raw]);
    }
    if (!(newTx.tags || []).includes(raw)) {
      setNewTx(prev => ({ ...prev, tags: [...(prev.tags || []), raw] }));
    }
    setNewTagInput('');
  };

  if (!isOpen) return null;

  const isCCPayment = newTx.category?.toLowerCase() === 'cc payment';
  // Which investment this log is for. Mutual funds, stocks and commodity share the 'Investments'
  // category but need different fields and account types, so the kind is the discriminator — mirrors
  // activeInvestmentKind in Transactions.tsx (see the duplicate-modal warning at the top of this file).
  const activeInvestmentKind: InvestmentKind | undefined =
    isInvestmentCategory(newTx.category) ? newTx.investmentKind : undefined;

  const investmentDescriptionFor = (kind: InvestmentKind, accountIds: (string | undefined)[]) => {
    const wantType = investmentAccountTypeFor(kind);
    const acc = accountIds
      .map(id => (id ? data.accounts.find(a => a.id === id) : undefined))
      .find(a => a?.type === wantType);
    return acc?.name || investmentKindLabel(kind);
  };

  // Category (and, for Investments, the kind) decides which account types are valid, whether the
  // amount splits into invested + charges, whether a quantity applies, and the auto-description.
  // Both the Category picker and the Investment Type sub-picker route through here.
  const applyCategorySelection = (nextCategory: string, nextKind?: InvestmentKind) => {
    const prevKind = activeInvestmentKind;
    setNewTx(prev => {
      let nextAccountId = prev.accountId;
      if (nextKind) {
        // Drop an account that isn't valid for this kind and direction rather than saving a stock
        // buy against a mutual-fund account.
        const currentAcc = data.accounts.find(a => a.id === prev.accountId);
        const isValid = !!currentAcc && (prev.type === 'credit'
          ? currentAcc.type === investmentAccountTypeFor(nextKind)
          : (currentAcc.type === 'bank_account' || currentAcc.type === 'e_wallet'));
        if (!isValid) nextAccountId = '';
      }

      // The description counts as ours to rewrite only while it still matches what we'd generate for
      // the kind being left, so a name the user typed themselves is never discarded.
      const wasAutoFilled = !!prevKind
        && prev.description === investmentDescriptionFor(prevKind, [prev.accountId, paymentSourceAccountId]);
      let newDesc = prev.description;
      if (nextKind && (!prev.description || wasAutoFilled)) {
        newDesc = investmentDescriptionFor(nextKind, [nextAccountId, paymentSourceAccountId]);
      } else if (!nextKind && wasAutoFilled) {
        // Leaving investments — drop the name we generated for the old kind.
        newDesc = '';
      }

      const splitsCharges = nextKind === 'mutual_funds' || nextKind === 'stocks';
      const nextAllotted = splitsCharges ? (prev.allottedAmount || prev.amount || 0) : undefined;
      const nextCharges = splitsCharges ? (prev.investmentCharges || 0) : undefined;
      // Units, shares and grams aren't interchangeable, so a quantity survives only while its kind does.
      const nextShares = (nextKind && nextKind === prevKind) ? prev.numberOfShares : undefined;
      setInputStrings(s => ({
        ...s,
        allottedAmount: (nextAllotted === undefined || nextAllotted === 0) ? '' : nextAllotted.toString(),
        investmentCharges: (nextCharges === undefined || nextCharges === 0) ? '' : nextCharges.toString(),
        numberOfShares: toInputStr(nextShares)
      }));
      return {
        ...prev,
        category: nextCategory,
        investmentKind: nextKind,
        accountId: nextAccountId,
        description: newDesc,
        allottedAmount: nextAllotted,
        investmentCharges: nextCharges,
        numberOfShares: nextShares
      };
    });
    // The counterpart's valid types depend on the kind, so any change of kind invalidates it.
    if (isInvestmentCategory(nextCategory) !== isInvestmentCategory(newTx.category) || nextKind !== prevKind) {
      setPaymentSourceAccountId('');
    }
    if (errors.category || errors.investmentKind) {
      const newErr = { ...errors };
      delete newErr.category;
      delete newErr.investmentKind;
      setErrors(newErr);
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!newTx.date) newErrors.date = 'Date is required';
    if (!newTx.description) newErrors.description = 'Description is required';
    if (!newTx.amount || newTx.amount <= 0) newErrors.amount = 'Amount must be greater than 0';
    if (!newTx.accountId) newErrors.accountId = 'Account is required';
    if (!newTx.category) newErrors.category = 'Category is required';
    if (isInvestmentCategory(newTx.category) && !newTx.investmentKind) {
      newErrors.investmentKind = 'Investment type is required';
    }
    if (activeInvestmentKind === 'stocks' && !newTx.numberOfShares) {
      newErrors.numberOfShares = 'No. of Shares is required';
    }
    if (activeInvestmentKind === 'commodity' && !newTx.numberOfShares) {
      newErrors.numberOfShares = 'Grams is required';
    }
    if (showRewardSplit && (Number(newTx.rewardUsed) || 0) > 0 && !newTx.rewardUsedAccountId) {
      newErrors.rewardUsedAccountId = 'Reward account is required';
    }
    if (showRewardSplit && newTx.rewardUsedAccountId && (Number(newTx.rewardUsed) || 0) <= 0) {
      newErrors.rewardUsed = 'Reward amount is required when reward account is selected';
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      setTimeout(() => {
        const modalBody = document.querySelector('.modal-body');
        if (modalBody) {
          const firstErrorEl = modalBody.querySelector('.border-danger');
          if (firstErrorEl) {
            const inputGroup = firstErrorEl.closest('.input-group') || firstErrorEl;
            inputGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 50);
      return false;
    }
    return true;
  };

  const handleSave = () => {
    if (!validate()) return;

    const account = data.accounts.find(a => a.id === newTx.accountId);
    const ccPaymentAppliedCycle = account?.type === 'credit_card' && newTx.type === 'credit'
      ? (() => {
          const safeStatementDay = account.statementDay || 1;
          const currentCycle = getBillingCycleForDate(newTx.date!, safeStatementDay);
          if (ccPaymentCycleTarget === 'current_cycle') {
            return currentCycle;
          }
          const currentCycleDate = new Date(`${currentCycle}-01`);
          currentCycleDate.setMonth(currentCycleDate.getMonth() - 1);
          return `${currentCycleDate.getFullYear()}-${(currentCycleDate.getMonth() + 1).toString().padStart(2, '0')}`;
        })()
      : undefined;

    // Funds and stocks split into invested + charges; a commodity buy is a single gross amount.
    const isInvestment = activeInvestmentKind === 'mutual_funds' || activeInvestmentKind === 'stocks';
    const allottedAmount = isInvestment ? (newTx.allottedAmount !== undefined ? Number(newTx.allottedAmount) : Number(newTx.amount)) : Number(newTx.amount);
    const investmentCharges = isInvestment ? (newTx.investmentCharges !== undefined ? Number(newTx.investmentCharges) : Math.max(0, Number(newTx.amount) - allottedAmount)) : undefined;

    const secondaryTxId = paymentSourceAccountId ? crypto.randomUUID() : undefined;
    const currentLinkedIds: string[] = [];
    if (secondaryTxId) {
      currentLinkedIds.push(secondaryTxId);
    }

    const txId = editId || crypto.randomUUID();
    const txData: Transaction = {
      ...newTx,
      id: txId,
      amount: isInvestment ? (newTx.type === 'debit' ? (allottedAmount + (investmentCharges || 0)) : allottedAmount) : Number(newTx.amount),
      date: newTx.date!,
      description: newTx.description!,
      type: newTx.type!,
      accountId: newTx.accountId!,
      category: newTx.category!,
      allottedAmount: isInvestment ? allottedAmount : undefined,
      investmentCharges: isInvestment ? investmentCharges : undefined,
      investmentKind: activeInvestmentKind,
      numberOfShares: activeInvestmentKind ? newTx.numberOfShares : undefined,
      rewardEarnedType: newTx.rewardEarnedType || (selectedCashbackLevelId ? 'delayed' : 'none'),
      cashbackLevelId: selectedCashbackLevelId || undefined,
      paymentSourceAccountId: paymentSourceAccountId || undefined,
      ccPaymentCycleTarget: isCCPayment ? ccPaymentCycleTarget : undefined,
      appliedBillingCycleYearMonth: ccPaymentAppliedCycle,
      isRecurring: !!newTx.recurringBillId,
      linkedTransactionIds: currentLinkedIds,
      order: editId ? (data.transactions.find(t => t.id === editId)?.order || 0) : undefined
    } as Transaction;

    if (editId) {
      updateTransaction(txData);
    } else {
      addTransaction(txData);

      // Auto-advance recurring bill if linked
      if (txData.recurringBillId) {
        const bill = (data.recurringBills || []).find(b => b.id === txData.recurringBillId);
        if (bill) {
          const currentDate = new Date(bill.nextDueDate);
          const nextDate = new Date(currentDate);

          switch (bill.frequency) {
            case 'daily': nextDate.setDate(currentDate.getDate() + 1); break;
            case 'weekly': nextDate.setDate(currentDate.getDate() + 7); break;
            case 'monthly': nextDate.setMonth(currentDate.getMonth() + 1); break;
            case 'quarterly': nextDate.setMonth(currentDate.getMonth() + 3); break;
            case 'yearly': nextDate.setFullYear(currentDate.getFullYear() + 1); break;
            case 'custom': nextDate.setDate(currentDate.getDate() + (bill.customDays || 30)); break;
          }

          updateRecurringBill({
            ...bill,
            nextDueDate: format(nextDate, 'yyyy-MM-dd')
          });
        }
      }

      // Auto-log secondary transaction if payment source is selected
      if (paymentSourceAccountId && secondaryTxId) {
        const destAccount = data.accounts.find(a => a.id === paymentSourceAccountId);
        const counterpartType = txData.type === 'debit' ? 'credit' : 'debit';
        const secondaryTx: Transaction = {
          id: secondaryTxId,
          date: txData.date,
          description: isCCPayment
            ? (counterpartType === 'credit' ? 'CC Bill Payment' : `CC Payment: ${data.accounts.find(a => a.id === txData.accountId)?.name}`)
            : (activeInvestmentKind ? txData.description : `Transfer to ${data.accounts.find(a => a.id === txData.accountId)?.name}`),
          amount: isInvestment ? (counterpartType === 'credit' ? allottedAmount : (allottedAmount + (investmentCharges || 0))) : txData.amount,
          type: counterpartType,
          accountId: paymentSourceAccountId,
          category: txData.category,
          // The leg carries the kind too, so it keeps showing the right fields when opened on its own.
          investmentKind: activeInvestmentKind,
          isCCPaymentRecord: isCCPayment,
          isRecurring: false,
          allottedAmount: isInvestment ? allottedAmount : undefined,
          investmentCharges: isInvestment ? investmentCharges : undefined,
          numberOfShares: activeInvestmentKind ? newTx.numberOfShares : undefined,
          appliedBillingCycleYearMonth: isCCPayment && counterpartType === 'credit' && destAccount?.type === 'credit_card'
            ? (() => {
                const safeStatementDay = destAccount.statementDay || 1;
                const currentCycle = getBillingCycleForDate(txData.date, safeStatementDay);
                if (ccPaymentCycleTarget === 'current_cycle') {
                  return currentCycle;
                }
                const currentCycleDate = new Date(`${currentCycle}-01`);
                currentCycleDate.setMonth(currentCycleDate.getMonth() - 1);
                return `${currentCycleDate.getFullYear()}-${(currentCycleDate.getMonth() + 1).toString().padStart(2, '0')}`;
              })()
            : undefined,
          linkedTransactionIds: [txId],
          order: undefined
        };
        addTransaction(secondaryTx);
      }
    }

    onSuccess?.();
    onClose();
  };

  const handleDescriptionChange = (val: string) => {
    setNewTx({ ...newTx, description: val });
    if (errors.description) setErrors(prev => ({ ...prev, description: '' }));

    if (val.length > 1) {
      const suggestions = Array.from(new Set(
        data.transactions
          .filter(t => t.description.toLowerCase().includes(val.toLowerCase()))
          .map(t => t.description)
      )).slice(0, 5);
      setDescriptionSuggestions(suggestions);
    } else {
      setDescriptionSuggestions([]);
    }
  };

  const selectSuggestion = (desc: string) => {
    const lastTx = data.transactions.find(t => t.description === desc);
    if (lastTx) {
      setNewTx({
        ...newTx,
        description: desc,
        category: lastTx.category,
        type: lastTx.type,
        accountId: lastTx.accountId,
        cashbackLevelId: lastTx.cashbackLevelId,
        rewardEarnedType: lastTx.rewardEarnedType,
        rewardEarnedAccountId: lastTx.rewardEarnedAccountId
      });
    } else {
      setNewTx({ ...newTx, description: desc });
    }
    setDescriptionSuggestions([]);
  };



  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3>{editId ? 'Edit Transaction' : 'Log Transaction'}</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="input-group" onClick={() => setIsDatePickerOpen(true)}>
            <label>Date</label>
            <div className={`input-field flex align-center justify-between gap-3 clickable ${errors.date ? 'border-danger' : ''}`}>
              <span className="text-mono">{newTx.date ? format(parseISO(newTx.date), 'EEE, d MMM yyyy') : 'Select Date'}</span>
              <Calendar size={18} className="text-muted" />
            </div>
            {errors.date && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.date}</span>}
          </div>

          <CustomDatePicker 
            isOpen={isDatePickerOpen}
            onClose={() => setIsDatePickerOpen(false)}
            value={newTx.date || ''}
            onChange={(val) => {
              setNewTx({ ...newTx, date: val });
              if (errors.date) setErrors(prev => ({ ...prev, date: '' }));
            }}
          />

          <div className="input-group" style={{ position: 'relative' }}>
            <label>Description</label>
            <input className={`input-field ${errors.description ? 'border-danger' : ''}`} value={newTx.description} onChange={e => handleDescriptionChange(e.target.value)} onBlur={() => setTimeout(() => setDescriptionSuggestions([]), 150)} placeholder="e.g. Swiggy Order" autoComplete="off" />
            {errors.description && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.description}</span>}
            {descriptionSuggestions.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '0 0 12px 12px', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', marginTop: '-4px' }}>
                {descriptionSuggestions.map(s => (
                  <div key={s} style={{ padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.9rem' }} onClick={() => selectSuggestion(s)} onMouseDown={e => e.preventDefault()}>{s}</div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4" style={{ marginBottom: '1rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label>Amount</label>
              <input 
                type="text" 
                inputMode="decimal"
                className={`input-field ${errors.amount ? 'border-danger' : ''}`}
                value={inputStrings.amount}
                onChange={e => {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) {
                    setInputStrings(prev => ({ ...prev, amount: val }));
                    const totalAmount = val === '' ? 0 : (val === '.' ? 0 : parseFloat(val));
                    setNewTx(prev => {
                      const isInvestment = isInvestmentCategory(prev.category)
                        && (prev.investmentKind === 'mutual_funds' || prev.investmentKind === 'stocks');
                      if (!isInvestment) return { ...prev, amount: totalAmount };
                      // Keep invested fixed; charges absorb the change (amount = invested + charges).
                      // Read invested from prev (current state), not a stale render closure.
                      const invested = prev.allottedAmount || 0;
                      const charges = Math.max(0, totalAmount - invested);
                      setInputStrings(s => ({ ...s, investmentCharges: toInputStr(parseFloat(charges.toFixed(2))) }));
                      return { ...prev, amount: totalAmount, investmentCharges: parseFloat(charges.toFixed(2)) };
                    });
                    if (errors.amount) setErrors(prev => ({ ...prev, amount: '' }));
                  }
                }}
                placeholder="0.00" 
              />
              {errors.amount && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.amount}</span>}
            </div>
            <CustomPicker label="Type" value={newTx.type!} options={[{ id: 'debit', name: 'Debit (Spend)', subtext: 'Money Going Out' }, { id: 'credit', name: 'Credit (Receive)', subtext: 'Money Coming In' }]} onChange={val => {
              setNewTx(prev => {
                const nextType = val as TransactionType;
                let nextAccountId = prev.accountId;
                // Flipping direction swaps which leg holds the investment account, so any picked
                // account is no longer valid for the new direction.
                if (activeInvestmentKind) {
                  // Type changed: clear selections to avoid invalid combination
                  nextAccountId = '';
                  setPaymentSourceAccountId('');
                }
                return {
                  ...prev,
                  type: nextType,
                  accountId: nextAccountId
                };
              });
            }} iconGetter={_id => _id === 'debit' ? <BanknoteArrowDown size={18} /> : <BanknoteArrowUp size={18} />} style={{ marginBottom: 0 }} />
          </div>

          <CustomPicker label="Category" value={newTx.category || ''} placeholder="Select Category" options={[...[...(data.categories || [])].sort((a, b) => {
            const isAOther = a.toLowerCase().includes('other') || a.toLowerCase().includes('misc');
            const isBOther = b.toLowerCase().includes('other') || b.toLowerCase().includes('misc');
            if (isAOther && !isBOther) return 1;
            if (!isAOther && isBOther) return -1;
            return 0;
          }).map(c => ({ id: c, name: c })), ...(newTx.category && !(data.categories || []).includes(newTx.category) ? [{ id: newTx.category, name: newTx.category }] : [])]} onChange={val => {
            applyCategorySelection(val, isInvestmentCategory(val) ? activeInvestmentKind : undefined);
          }} iconGetter={c => getCategoryIcon(c)} error={errors.category} />

          {/* Investments is one category covering funds, stocks and metals, each with its own fields
              and valid account types. This sub-picker is what selects between them; it shares the
              category handler so both paths settle the same state. */}
          {isInvestmentCategory(newTx.category) && (
            <CustomPicker
              label="Investment Type"
              value={newTx.investmentKind || ''}
              placeholder="Select Investment Type"
              options={INVESTMENT_KIND_OPTIONS}
              onChange={val => applyCategorySelection(newTx.category as string, val as InvestmentKind)}
              iconGetter={id => getInvestmentKindIcon(id)}
              error={errors.investmentKind}
            />
          )}

          <CustomPicker 
            label="Account" 
            value={newTx.accountId || ''} 
            placeholder="Select an account" 
            defaultCollapsed={true}
            options={data.accounts
              .filter(acc => {
                // Hide archived (deleted) accounts from selection, but keep the one already on this
                // transaction so editing historical data doesn't blank the field.
                if (acc.archived && acc.id !== newTx.accountId) return false;
                if (newTx.category?.toLowerCase() === 'cc payment') {
                  return newTx.type === 'debit' ? (acc.type === 'bank_account' || acc.type === 'e_wallet') : acc.type === 'credit_card';
                }
                if (activeInvestmentKind) {
                  return newTx.type === 'credit'
                    ? acc.type === investmentAccountTypeFor(activeInvestmentKind)
                    : (acc.type === 'bank_account' || acc.type === 'e_wallet');
                }
                return true;
              })
              .sort(sortByAccountType)
              .map(acc => ({ id: acc.id, name: acc.archived ? `${acc.name} (deleted)` : acc.name, subtext: acc.type.replace('_', ' '), group: getAccountGroupLabel(acc.type, acc.archived) }))
            }
            onChange={val => {
              let updatedDesc = newTx.description;
              if (activeInvestmentKind) {
                updatedDesc = investmentDescriptionFor(activeInvestmentKind, [val, paymentSourceAccountId]);
              }
              setNewTx(prev => ({ ...prev, accountId: val, description: updatedDesc }));
              if (errors.accountId) { const newErr = { ...errors }; delete newErr.accountId; setErrors(newErr); }
            }} 
            iconGetter={id => getAccountIcon(id, data.accounts)} 
            error={errors.accountId} 
          />

          {(activeInvestmentKind === 'stocks' || activeInvestmentKind === 'commodity') && (
            <div className="input-group" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
              <label>{activeInvestmentKind === 'commodity' ? 'Grams' : 'No. of Shares'}</label>
              <input
                type="text"
                inputMode="decimal"
                className={`input-field ${errors.numberOfShares ? 'border-danger' : ''}`}
                value={inputStrings.numberOfShares}
                onChange={e => {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) {
                    setInputStrings(prev => ({ ...prev, numberOfShares: val }));
                    setNewTx(prev => ({ ...prev, numberOfShares: val === '' ? undefined : parseFloat(val) }));
                    if (errors.numberOfShares) setErrors(prev => ({ ...prev, numberOfShares: '' }));
                  }
                }}
                placeholder={activeInvestmentKind === 'commodity' ? 'e.g. 0.2456' : 'e.g. 10'}
              />
              {errors.numberOfShares && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.numberOfShares}</span>}
            </div>
          )}

          {(() => {
            const isMf = activeInvestmentKind === 'mutual_funds';
            const isStock = activeInvestmentKind === 'stocks';
            const isInvestment = isMf || isStock;
            return isInvestment && (
              <div style={{ marginTop: '0.5rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px', marginBottom: '1rem' }}>
              <div className="grid grid-cols-2 gap-4">
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>{isStock ? 'Invested Amount' : 'Allotted Amount'}</label>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    className="input-field"
                    value={inputStrings.allottedAmount}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        setInputStrings(prev => ({ ...prev, allottedAmount: val }));
                        const allotted = val === '' ? 0 : (val === '.' ? 0 : parseFloat(val));
                        setNewTx(prev => {
                          // Charges is the complement: charges = amount − invested.
                          const totalAmount = Number(prev.amount || 0);
                          const charges = Math.max(0, totalAmount - allotted);
                          setInputStrings(s => ({ ...s, investmentCharges: toInputStr(parseFloat(charges.toFixed(2))) }));
                          return { ...prev, allottedAmount: allotted, investmentCharges: parseFloat(charges.toFixed(2)) };
                        });
                      }
                    }}
                    placeholder="0.00" 
                  />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>{isStock ? 'Brokerage / Taxes' : 'Stamp Duty / Charges'}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input-field"
                    value={inputStrings.investmentCharges}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        setInputStrings(prev => ({ ...prev, investmentCharges: val }));
                        const charges = val === '' ? 0 : (val === '.' ? 0 : parseFloat(val));
                        setNewTx(prev => {
                          // Complement of invested: invested = amount − charges, so you can fill in
                          // whichever you know (invested or charges) and the other is derived.
                          const totalAmount = Number(prev.amount || 0);
                          const invested = Math.max(0, totalAmount - charges);
                          setInputStrings(s => ({ ...s, allottedAmount: toInputStr(parseFloat(invested.toFixed(2))) }));
                          return { ...prev, investmentCharges: charges, allottedAmount: parseFloat(invested.toFixed(2)) };
                        });
                      }
                    }}
                    placeholder="0.00"
                  />
                </div>
              </div>
              {isMf && (
                <div className="input-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                  <label>Units Allotted</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input-field"
                    value={inputStrings.numberOfShares}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        setInputStrings(prev => ({ ...prev, numberOfShares: val }));
                        setNewTx(prev => ({ ...prev, numberOfShares: val === '' ? undefined : parseFloat(val) }));
                      }
                    }}
                    placeholder="e.g. 78.234"
                  />
                </div>
              )}
              </div>
            );
          })()}

          {!editId && ((newTx.type === 'credit' && data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card') || isCCPayment || !!activeInvestmentKind) && (
            <CustomPicker label={activeInvestmentKind ? (newTx.type === 'debit' ? `Credit To ${investmentKindLabel(activeInvestmentKind)} Account` : 'Debit From Account') : (data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card' ? 'Debit From Account (Auto-Debit)' : 'Pay To Card (Auto-Credit)')} value={paymentSourceAccountId} placeholder="None (Manual Log)" defaultCollapsed={true} options={[{ id: '', name: 'None (Manual Log)' }, ...[...data.accounts].sort(sortByAccountType).filter(a => {
              if (a.id === newTx.accountId) return false;
              if (a.archived) return false; // this picker only shows for new transactions

              // Mirror of the main Account filter, one direction over: on a debit the counterpart is
              // the holding account receiving the units/shares/grams.
              if (activeInvestmentKind) {
                return newTx.type === 'debit'
                  ? a.type === investmentAccountTypeFor(activeInvestmentKind)
                  : (a.type === 'bank_account' || a.type === 'e_wallet');
              }
              return true;
            }).map(acc => ({ id: acc.id, name: acc.name, subtext: acc.type.replace('_', ' '), group: getAccountGroupLabel(acc.type, acc.archived) }))]} onChange={val => {
              setPaymentSourceAccountId(val);
              if (activeInvestmentKind) {
                setNewTx(prev => ({ ...prev, description: investmentDescriptionFor(activeInvestmentKind, [newTx.accountId, val]) }));
              }
            }} iconGetter={_id => _id ? getAccountIcon(_id, data.accounts) : '🚫'} />
          )}

          {newTx.type === 'debit' && !showRewardSplit && !isCCPayment && (
            <button className="btn btn-secondary w-100 flex align-center justify-center gap-2" style={{ marginTop: '0.5rem', padding: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }} onClick={() => { setShowRewardSplit(true); setTimeout(() => { rewardSplitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100); }}>
              <Sparkles size={14} className="text-primary" />
              <span>Split with Rewards?</span>
            </button>
          )}

          {((newTx.type === 'debit' && showRewardSplit) || (isCCPayment && paymentSourceAccountId)) && (
            <div ref={rewardSplitRef} className="grid grid-cols-2 gap-4" style={{ marginTop: '0.5rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
              <div className="flex justify-between align-center col-span-2">
                <span className="text-xs font-bold text-muted uppercase" style={{ letterSpacing: '1px' }}>Split Payment</span>
                {showRewardSplit && (
                  <button className="btn btn-danger flex align-center gap-1" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', minHeight: 'auto', boxShadow: '2px 2px 0 #000' }} onClick={() => { setShowRewardSplit(false); setInputStrings(prev => ({ ...prev, rewardUsed: '' })); setNewTx({ ...newTx, rewardUsed: 0, rewardUsedAccountId: '' }); }}>✕ Remove Split</button>
                )}
              </div>
              <div className="input-group">
                <label>Rewards Used <span className="text-muted" style={{ fontWeight: 400 }}>(Optional)</span></label>
                <input 
                  type="text" 
                  inputMode="decimal"
                  className={`input-field ${errors.rewardUsed ? 'border-danger' : ''}`}
                  value={inputStrings.rewardUsed}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                      setInputStrings(prev => ({ ...prev, rewardUsed: val }));
                      const numVal = val === '' ? 0 : (val === '.' ? 0 : parseFloat(val));
                      setNewTx({ ...newTx, rewardUsed: numVal });
                      if (errors.rewardUsed && numVal > 0) {
                        setErrors(prev => ({ ...prev, rewardUsed: '' }));
                      }
                    }
                  }}
                  placeholder="0.00" 
                />
                {errors.rewardUsed && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.rewardUsed}</span>}
              </div>
              <CustomPicker
                label="From Rewards"
                value={newTx.rewardUsedAccountId || ''}
                placeholder="Select Reward Account"
                options={[
                  { id: '', name: 'None (Select Account)' },
                  ...data.accounts.filter(a => (!a.archived || a.id === newTx.rewardUsedAccountId) && (a.type === 'rewards' || (a.isCashbackEnabled && a.rewardType === 'points'))).map(acc => ({ id: acc.id, name: acc.archived ? `${acc.name} (deleted)` : acc.name }))
                ]}
                onChange={val => {
                  setNewTx({
                    ...newTx,
                    rewardUsedAccountId: val,
                    ...(!val && (Number(newTx.rewardUsed) || 0) <= 0 ? { rewardUsed: 0 } : {})
                  });
                  if (errors.rewardUsedAccountId) setErrors(prev => ({ ...prev, rewardUsedAccountId: '' }));
                  if (errors.rewardUsed) setErrors(prev => ({ ...prev, rewardUsed: '' }));
                }}
                iconGetter={id => getAccountIcon(id, data.accounts)}
                error={errors.rewardUsedAccountId}
              />
            </div>
          )}

          <div className="input-group" style={{ marginTop: '1rem', marginBottom: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Hash size={13} style={{ opacity: 0.6 }} />Tags <span className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 400 }}>(optional)</span>
            </label>
            {(data.tags || []).length > 0 && (
              <CustomPicker
                label="Tags"
                hideLabel={true}
                value={newTx.tags || []}
                isMulti={true}
                options={(data.tags || []).map(t => ({ id: t, name: `#${t}` }))}
                onChange={(val: string[]) => {
                  const cleaned = (val || []).filter(v => v !== 'all' && v !== '');
                  setNewTx(prev => ({ ...prev, tags: cleaned.length > 0 ? cleaned : [] }));
                }}
                placeholder="Select tags"
                noSelectionLabel="None"
              />
            )}
            <div className="flex gap-2" style={{ marginTop: (data.tags || []).length > 0 ? '0.5rem' : '0' }}>
              <input
                className="input-field"
                style={{ flex: 1, fontSize: '0.85rem' }}
                value={newTagInput}
                onChange={e => setNewTagInput(e.target.value)}
                placeholder={`Create tag (e.g. Vacation2024)`}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateTag(); } }}
              />
              <button className="btn btn-secondary" style={{ minWidth: '42px', padding: '0 0.75rem' }} onClick={handleCreateTag} type="button">+</button>
            </div>
          </div>

          {((newTx.type === 'credit' && data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card') ||
            (newTx.type === 'debit' && isCCPayment && paymentSourceAccountId && data.accounts.find(a => a.id === paymentSourceAccountId)?.type === 'credit_card')) && (
            <div style={{ marginTop: '0.5rem' }}>
              <CustomPicker label="Apply Payment To" value={ccPaymentCycleTarget} options={[{ id: 'previous_statement', name: 'Previous Statement', subtext: 'Reduce Already Billed Dues' }, { id: 'current_cycle', name: 'Current Open Cycle', subtext: 'Count as an Early Payment for the Active Cycle' }]} onChange={val => setCcPaymentCycleTarget(val as 'current_cycle' | 'previous_statement')} iconGetter={id => id === 'current_cycle' ? '🟦' : '🧾'} />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>{editId ? 'Update' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
};

