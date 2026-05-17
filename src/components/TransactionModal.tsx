import React, { useState, useRef, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import {
  ShoppingBag, Utensils, Zap, Car, HeartPulse, Film, CreditCard, Wallet,
  ArrowRightLeft, MoreHorizontal, Coins, BadgeDollarSign, Home, Gift,
  Landmark, Sparkles, Calendar
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
    case 'investment': return '📈';
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
  const { data, addTransaction, updateTransaction, updateRecurringBill } = useFinance();
  const [newTx, setNewTx] = useState<Partial<Transaction>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
    amount: 0,
    type: 'debit',
    category: 'Bills',
    accountId: data.accounts[0]?.id || '',
    excludeFromStats: false,
    ...initialData
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [descriptionSuggestions, setDescriptionSuggestions] = useState<string[]>([]);
  const [paymentSourceAccountId, setPaymentSourceAccountId] = useState('');
  const [ccPaymentCycleTarget, setCcPaymentCycleTarget] = useState<'current_cycle' | 'previous_statement'>('previous_statement');
  const [showRewardSplit, setShowRewardSplit] = useState(false);
  const [selectedCashbackLevelId] = useState('');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

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
          ...initialData
        });
        // Reset local UI states for new entry
        setShowRewardSplit(false);
        setPaymentSourceAccountId('');
      }
    }
  }, [isOpen]); // Only run when modal opens

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

    const secondaryTxId = paymentSourceAccountId ? crypto.randomUUID() : undefined;
    const currentLinkedIds: string[] = [];
    if (secondaryTxId) {
      currentLinkedIds.push(secondaryTxId);
    }

    const txId = editId || crypto.randomUUID();
    const txData: Transaction = {
      ...newTx,
      id: txId,
      amount: Number(newTx.amount),
      date: newTx.date!,
      description: newTx.description!,
      type: newTx.type!,
      accountId: newTx.accountId!,
      category: newTx.category!,
      rewardEarnedType: newTx.rewardEarnedType || (selectedCashbackLevelId ? 'delayed' : 'none'),
      cashbackLevelId: selectedCashbackLevelId || undefined,
      paymentSourceAccountId: paymentSourceAccountId || undefined,
      ccPaymentCycleTarget: isCCPayment ? ccPaymentCycleTarget : undefined,
      appliedBillingCycleYearMonth: ccPaymentAppliedCycle,
      isRecurring: !!newTx.recurringBillId,
      linkedTransactionIds: currentLinkedIds,
      order: editId ? (data.transactions.find(t => t.id === editId)?.order || 0) : data.transactions.length
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
            : `Transfer to ${data.accounts.find(a => a.id === txData.accountId)?.name}`,
          amount: txData.amount,
          type: counterpartType,
          accountId: paymentSourceAccountId,
          category: txData.category,
          isCCPaymentRecord: isCCPayment,
          isRecurring: false,
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
          order: data.transactions.length + 1
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
        accountId: lastTx.accountId
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
                    setNewTx({ ...newTx, amount: val === '' ? 0 : (val === '.' ? 0 : parseFloat(val)) }); 
                    if (errors.amount) setErrors(prev => ({ ...prev, amount: '' }));
                  }
                }} 
                placeholder="0.00" 
              />
              {errors.amount && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.amount}</span>}
            </div>
            <CustomPicker label="Type" value={newTx.type!} options={[{ id: 'debit', name: 'Debit (Spend)', subtext: 'Money going out' }, { id: 'credit', name: 'Credit (Receive)', subtext: 'Money coming in' }]} onChange={val => setNewTx({ ...newTx, type: val as TransactionType })} iconGetter={_id => _id === 'debit' ? '📉' : '📈'} style={{ marginBottom: 0 }} />
          </div>

          <CustomPicker label="Account" value={newTx.accountId || ''} placeholder="Select an account" options={data.accounts.map(acc => ({ id: acc.id, name: acc.name, subtext: acc.type.replace('_', ' ') }))} onChange={val => { setNewTx({ ...newTx, accountId: val }); if (errors.accountId) { const newErr = { ...errors }; delete newErr.accountId; setErrors(newErr); } }} iconGetter={id => getAccountIcon(id, data.accounts)} error={errors.accountId} />

          <CustomPicker label="Category" value={newTx.category || ''} placeholder="Select Category" options={[...(data.categories || []).map(c => ({ id: c, name: c })), ...(newTx.category && !(data.categories || []).includes(newTx.category) ? [{ id: newTx.category, name: newTx.category }] : [])]} onChange={val => { setNewTx({ ...newTx, category: val }); if (errors.category) { const newErr = { ...errors }; delete newErr.category; setErrors(newErr); } }} iconGetter={c => getCategoryIcon(c)} error={errors.category} />

          {!editId && ((newTx.type === 'credit' && data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card') || isCCPayment) && (
            <CustomPicker label={data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card' ? 'Debit From Account (Auto-Debit)' : 'Pay To Card (Auto-Credit)'} value={paymentSourceAccountId} placeholder="None (Manual Log)" options={[{ id: '', name: 'None (Manual Log)' }, ...data.accounts.filter(a => a.id !== newTx.accountId).map(acc => ({ id: acc.id, name: acc.name, subtext: acc.type.replace('_', ' ') }))]} onChange={setPaymentSourceAccountId} iconGetter={_id => _id ? getAccountIcon(_id, data.accounts) : '🚫'} />
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
              <CustomPicker label="From Rewards" value={newTx.rewardUsedAccountId || ''} placeholder="Select Reward Account" options={data.accounts.filter(a => a.type === 'rewards').map(acc => ({ id: acc.id, name: acc.name }))} onChange={val => setNewTx({ ...newTx, rewardUsedAccountId: val })} iconGetter={id => getAccountIcon(id, data.accounts)} />
            </div>
          )}

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

