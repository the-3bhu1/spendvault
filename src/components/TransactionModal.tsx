import React, { useState, useRef, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import {
  ShoppingBag, Utensils, Zap, Car, HeartPulse, Film, CreditCard, Wallet,
  ArrowRightLeft, MoreHorizontal, Coins, BadgeDollarSign, Home, Gift,
  Landmark, Sparkles, Calendar, TrendingUp, Train, BarChart, Hash
} from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';
import { useFinance } from '../FinanceContext';
import type { Transaction, TransactionType, Account } from '../types';
import { CustomPicker } from './CustomPicker';
import { getBillingCycleForDate } from '../utils';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  editId?: string | null;
  initialData?: Partial<Transaction>;
  onSuccess?: () => void;
}

export const getCategoryIcon = (category: string) => {
  const cat = category.toLowerCase();
  if (cat.includes('ncmc')) return <Train size={17} />;
  if (cat.includes('shop')) return <ShoppingBag size={17} />;
  if (cat.includes('food') || cat.includes('eat') || cat.includes('dine')) return <Utensils size={17} />;
  if (cat.includes('travel') || cat.includes('transport') || cat.includes('fuel')) return <Car size={17} />;
  if (cat.includes('bill') || cat.includes('recharge') || cat.includes('utility')) return <Zap size={17} />;
  if (cat.includes('health') || cat.includes('med')) return <HeartPulse size={17} />;
  if (cat.includes('entertain') || cat.includes('movie') || cat.includes('ott')) return <Film size={17} />;
  if (cat.includes('salary')) return <BadgeDollarSign size={17} />;
  if (cat.includes('income')) return <Wallet size={17} />;
  if (cat.includes('cc payment')) return <CreditCard size={17} />;
  if (cat.includes('transfer')) return <ArrowRightLeft size={17} />;
  if (cat.includes('rent')) return <Home size={17} />;
  if (cat.includes('loan')) return <Landmark size={17} />;
  if (cat.includes('cashback')) return <Gift size={17} />;
  if (cat.includes('sip')) return <BarChart size={17} />;
  if (cat.includes('stocks')) return <TrendingUp size={17} />;
  if (cat.includes('miscellaneous') || cat.includes('other')) return <MoreHorizontal size={17} />;
  return <Coins size={17} />;
};

export const getAccountIcon = (accountId: string, accounts: Account[]) => {
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return '💳';
  switch (acc.type) {
    case 'bank_account': return '🏦';
    case 'credit_card': return '💳';
    case 'e_wallet': return '📱';
    case 'rewards': return '✨';
    case 'investment':
    case 'stocks': return '📈';
    case 'sips': return '💹';
    case 'cash': return '💵';
    case 'debit_card': return '💳';
    default: return '💰';
  }
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
    accountId: data.accounts[0]?.id || '',
    excludeFromStats: false,
    tags: [],
    ...initialData
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
          if (tx.rewardUsed && tx.rewardUsed > 0) setShowRewardSplit(true);
          if (tx.paymentSourceAccountId) setPaymentSourceAccountId(tx.paymentSourceAccountId);
        }
      } else if (initialData) {
        setNewTx({
          date: format(new Date(), 'yyyy-MM-dd'),
          description: '',
          amount: 0,
          type: 'debit',
          category: 'Bills',
          accountId: data.accounts[0]?.id || '',
          excludeFromStats: false,
          tags: [],
          ...initialData
        });
        // Reset local UI states for new entry
        setShowRewardSplit(false);
        setPaymentSourceAccountId(initialData.paymentSourceAccountId || '');
      }
      setNewTagInput('');
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

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!newTx.date) newErrors.date = 'Date is required';
    if (!newTx.description) newErrors.description = 'Description is required';
    if (!newTx.amount || newTx.amount <= 0) newErrors.amount = 'Amount must be greater than 0';
    if (!newTx.accountId) newErrors.accountId = 'Account is required';
    if (!newTx.category) newErrors.category = 'Category is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
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

    const isSip = newTx.category?.toLowerCase() === 'sip';
    const allottedAmount = isSip ? (newTx.sipAllottedAmount !== undefined ? Number(newTx.sipAllottedAmount) : Number(newTx.amount)) : Number(newTx.amount);
    const sipCharges = isSip ? (newTx.sipCharges !== undefined ? Number(newTx.sipCharges) : Math.max(0, Number(newTx.amount) - allottedAmount)) : undefined;

    const secondaryTxId = paymentSourceAccountId ? crypto.randomUUID() : undefined;
    const currentLinkedIds: string[] = [];
    if (secondaryTxId) {
      currentLinkedIds.push(secondaryTxId);
    }

    const txId = editId || crypto.randomUUID();
    const txData: Transaction = {
      ...newTx,
      id: txId,
      amount: isSip ? (newTx.type === 'debit' ? (allottedAmount + (sipCharges || 0)) : allottedAmount) : Number(newTx.amount),
      date: newTx.date!,
      description: newTx.description!,
      type: newTx.type!,
      accountId: newTx.accountId!,
      category: newTx.category!,
      sipAllottedAmount: isSip ? allottedAmount : undefined,
      sipCharges: isSip ? sipCharges : undefined,
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
            : (isSip ? txData.description : `Transfer to ${data.accounts.find(a => a.id === txData.accountId)?.name}`),
          amount: isSip ? (counterpartType === 'credit' ? allottedAmount : (allottedAmount + (sipCharges || 0))) : txData.amount,
          type: counterpartType,
          accountId: paymentSourceAccountId,
          category: txData.category,
          isCCPaymentRecord: isCCPayment,
          isRecurring: false,
          sipAllottedAmount: isSip ? allottedAmount : undefined,
          sipCharges: isSip ? sipCharges : undefined,
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
                value={newTx.amount === 0 && !editId ? '' : (newTx.amount ?? '')} 
                onChange={e => { 
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) {
                    const totalAmount = val === '' ? 0 : (val === '.' ? 0 : parseFloat(val));
                    const isSip = newTx.category?.toLowerCase() === 'sip';
                    const allotted = newTx.sipAllottedAmount || 0;
                    const charges = isSip ? Math.max(0, totalAmount - allotted) : undefined;
                    setNewTx(prev => ({ 
                      ...prev, 
                      amount: totalAmount,
                      sipCharges: charges !== undefined ? parseFloat(charges.toFixed(2)) : undefined
                    })); 
                    if (errors.amount) setErrors(prev => ({ ...prev, amount: '' }));
                  }
                }} 
                placeholder="0.00" 
              />
              {errors.amount && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.amount}</span>}
            </div>
            <CustomPicker label="Type" value={newTx.type!} options={[{ id: 'debit', name: 'Debit (Spend)', subtext: 'Money going out' }, { id: 'credit', name: 'Credit (Receive)', subtext: 'Money coming in' }]} onChange={val => {
              const isSip = newTx.category?.toLowerCase() === 'sip';
              setNewTx(prev => {
                const nextType = val as TransactionType;
                let nextAccountId = prev.accountId;
                if (isSip) {
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
            }} iconGetter={_id => _id === 'debit' ? '📉' : '📈'} style={{ marginBottom: 0 }} />
          </div>

          <CustomPicker 
            label="Account" 
            value={newTx.accountId || ''} 
            placeholder="Select an account" 
            options={data.accounts
              .filter(acc => {
                if (newTx.category?.toLowerCase() === 'sip') {
                  return newTx.type === 'credit' ? acc.type === 'sips' : acc.type === 'bank_account';
                }
                return true;
              })
              .map(acc => ({ id: acc.id, name: acc.name, subtext: acc.type.replace('_', ' ') }))
            } 
            onChange={val => {
              const isSip = newTx.category?.toLowerCase() === 'sip';
              const selectedAcc = data.accounts.find(a => a.id === val);
              let updatedDesc = newTx.description;
              if (isSip) {
                const counterpartAcc = data.accounts.find(a => a.id === paymentSourceAccountId);
                const sipAcc = selectedAcc?.type === 'sips' ? selectedAcc : (counterpartAcc?.type === 'sips' ? counterpartAcc : null);
                updatedDesc = sipAcc ? sipAcc.name : 'SIP';
              }
              setNewTx(prev => ({ ...prev, accountId: val, description: updatedDesc }));
              if (errors.accountId) { const newErr = { ...errors }; delete newErr.accountId; setErrors(newErr); }
            }} 
            iconGetter={id => getAccountIcon(id, data.accounts)} 
            error={errors.accountId} 
          />

          <CustomPicker label="Category" value={newTx.category || ''} placeholder="Select Category" options={[...[...(data.categories || [])].sort((a, b) => {
            const isAOther = a.toLowerCase().includes('other') || a.toLowerCase().includes('misc');
            const isBOther = b.toLowerCase().includes('other') || b.toLowerCase().includes('misc');
            if (isAOther && !isBOther) return 1;
            if (!isAOther && isBOther) return -1;
            return 0;
          }).map(c => ({ id: c, name: c })), ...(newTx.category && !(data.categories || []).includes(newTx.category) ? [{ id: newTx.category, name: newTx.category }] : [])]} onChange={val => {
            const isSip = val.toLowerCase() === 'sip';
            setNewTx(prev => {
              let nextAccountId = prev.accountId;
              if (isSip) {
                const currentAcc = data.accounts.find(a => a.id === prev.accountId);
                const isValid = currentAcc && (prev.type === 'credit' ? currentAcc.type === 'sips' : currentAcc.type === 'bank_account');
                if (!isValid) {
                  nextAccountId = '';
                }
                setPaymentSourceAccountId('');
              }
              const mainAcc = data.accounts.find(a => a.id === nextAccountId);
              const sipAcc = mainAcc?.type === 'sips' ? mainAcc : null;
              return { 
                ...prev, 
                category: val, 
                accountId: nextAccountId,
                description: isSip ? (sipAcc ? sipAcc.name : 'SIP') : prev.description,
                sipAllottedAmount: isSip ? prev.sipAllottedAmount || prev.amount : undefined,
                sipCharges: isSip ? prev.sipCharges || 0 : undefined
              };
            }); 
            if (errors.category) { const newErr = { ...errors }; delete newErr.category; setErrors(newErr); } 
          }} iconGetter={c => getCategoryIcon(c)} error={errors.category} />

          {(() => {
            const isSip = newTx.category?.toLowerCase() === 'sip';
            return isSip && (
              <div className="grid grid-cols-2 gap-4" style={{ marginTop: '0.5rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px', marginBottom: '1rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>Allotted Amount</label>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    className="input-field" 
                    value={newTx.sipAllottedAmount === 0 ? '' : (newTx.sipAllottedAmount ?? '')} 
                    onChange={e => { 
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        const allotted = val === '' ? 0 : (val === '.' ? 0 : parseFloat(val));
                        const totalAmount = Number(newTx.amount || 0);
                        const charges = Math.max(0, totalAmount - allotted);
                        setNewTx(prev => ({ 
                          ...prev, 
                          sipAllottedAmount: allotted,
                          sipCharges: parseFloat(charges.toFixed(2))
                        }));
                      }
                    }} 
                    placeholder="0.00" 
                  />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>Stamp Duty / Charges</label>
                  <div className="input-field flex align-center text-muted text-mono" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', height: '42px', borderRadius: '12px', padding: '0.75rem 1rem' }}>
                    {newTx.sipCharges !== undefined ? newTx.sipCharges : '0.00'}
                  </div>
                </div>
              </div>
            );
          })()}

          {!editId && ((newTx.type === 'credit' && data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card') || isCCPayment || (newTx.category?.toLowerCase() === 'sip')) && (
            <CustomPicker label={newTx.category?.toLowerCase() === 'sip' ? (newTx.type === 'debit' ? 'Credit To SIP Account' : 'Debit From Bank Account') : (data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card' ? 'Debit From Account (Auto-Debit)' : 'Pay To Card (Auto-Credit)')} value={paymentSourceAccountId} placeholder="None (Manual Log)" options={[{ id: '', name: 'None (Manual Log)' }, ...data.accounts.filter(a => {
              if (a.id === newTx.accountId) return false;
              if (newTx.category?.toLowerCase() === 'sip') {
                return newTx.type === 'debit' ? a.type === 'sips' : a.type === 'bank_account';
              }
              return true;
            }).map(acc => ({ id: acc.id, name: acc.name, subtext: acc.type.replace('_', ' ') }))]} onChange={val => {
              setPaymentSourceAccountId(val);
              const isSip = newTx.category?.toLowerCase() === 'sip';
              if (isSip) {
                const mainAcc = data.accounts.find(a => a.id === newTx.accountId);
                const counterpartAcc = data.accounts.find(a => a.id === val);
                const sipAcc = mainAcc?.type === 'sips' ? mainAcc : (counterpartAcc?.type === 'sips' ? counterpartAcc : null);
                setNewTx(prev => ({ ...prev, description: sipAcc ? sipAcc.name : 'SIP' }));
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
                  <button className="btn btn-danger flex align-center gap-1" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', minHeight: 'auto', boxShadow: '2px 2px 0 #000' }} onClick={() => { setShowRewardSplit(false); setNewTx({ ...newTx, rewardUsed: 0, rewardUsedAccountId: '' }); }}>✕ Remove Split</button>
                )}
              </div>
              <div className="input-group">
                <label>Rewards Used <span className="text-muted" style={{ fontWeight: 400 }}>(Optional)</span></label>
                <input 
                  type="text" 
                  inputMode="decimal"
                  className="input-field" 
                  value={newTx.rewardUsed === 0 ? '' : (newTx.rewardUsed ?? '')} 
                  onChange={e => { 
                    const val = e.target.value;
                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                      setNewTx({ ...newTx, rewardUsed: val === '' ? 0 : (val === '.' ? 0 : parseFloat(val)) });
                    }
                  }} 
                  placeholder="0.00" 
                />
              </div>
              <CustomPicker label="From Rewards" value={newTx.rewardUsedAccountId || ''} placeholder="Select Reward Account" options={data.accounts.filter(a => a.type === 'rewards' || (a.isCashbackEnabled && a.rewardType === 'points')).map(acc => ({ id: acc.id, name: acc.name }))} onChange={val => setNewTx({ ...newTx, rewardUsedAccountId: val })} iconGetter={id => getAccountIcon(id, data.accounts)} />
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
              <CustomPicker label="Apply Payment To" value={ccPaymentCycleTarget} options={[{ id: 'previous_statement', name: 'Previous Statement', subtext: 'Reduce already billed dues' }, { id: 'current_cycle', name: 'Current Open Cycle', subtext: 'Count as an early payment for the active cycle' }]} onChange={val => setCcPaymentCycleTarget(val as 'current_cycle' | 'previous_statement')} iconGetter={id => id === 'current_cycle' ? '🟦' : '🧾'} />
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

