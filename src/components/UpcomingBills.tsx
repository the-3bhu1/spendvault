import { useState, useMemo, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Repeat,
  Link,
  ArrowUpRight,
  CreditCard,
  Clock,
  Trash2,
  Pencil,
  Plus,
  Calendar,
  AlertCircle,
  Check,
  CheckCircle2
} from 'lucide-react';
import { useFinance } from '../FinanceContext';
import type { RecurringBill, RecurringFrequency } from '../types';
import { SubviewWrapper } from './SubviewWrapper';
import { CustomPicker } from './CustomPicker';
import { TransactionSelector } from './TransactionSelector';
import { LogTransactionForm } from './LogTransactionForm';
import { getCategoryIcon } from './transactionIcons';
import CustomDatePicker from './CustomDatePicker';
import { calculateTotalSpendPerCycle, getLatestBilledCycle, advanceBillCycle } from '../utils';
import { scrollToFirstError } from '../utils/formErrors';

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-Yearly',
  yearly: 'Yearly',
  custom: 'Custom Days'
};


export default function UpcomingBills() {
  const { data, addRecurringBill, updateRecurringBill, deleteRecurringBill, updateTransaction } = useFinance();
  const [activeView, setActiveView] = useState<'main' | 'add'>('main');
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<RecurringBill | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const billFormRef = useRef<HTMLDivElement>(null);

  // The category picker offers EVERY category, Mutual Funds included — a fund instalment is a
  // legitimate thing to want a due-date reminder for. What was removed is the special MF wiring:
  // there is no "link to a mutual fund account" field and no auto-credit of that account on LOG.
  // A Mutual Funds bill is just a plain bill; LOG opens the normal investment form in the Ledger
  // modal, where the user picks the funding and fund accounts themselves.

  const handleLinkTransaction = (transaction: any) => {
    if (!selectedBill) return;

    // Link the transaction to the bill
    updateTransaction({
      ...transaction,
      recurringBillId: selectedBill.id
    });

    // ...and roll the bill forward, exactly as LOG and PAID do. Linking says "this payment
    // settled the current cycle", so leaving the due date alone would strand the bill as
    // overdue forever. lastPaidDate takes the transaction's date, not today's — the whole
    // point of LINK is that the payment already happened.
    updateRecurringBill(advanceBillCycle(selectedBill, parseISO(transaction.date)));

    setActiveView('main');
    setSelectedBill(null);
  };

  const handleMarkAsPaid = (bill: RecurringBill) => {
    updateRecurringBill(advanceBillCycle(bill));
  };

  const [newBill, setNewBill] = useState<Partial<RecurringBill>>({
    name: '',
    amount: 0,
    category: 'Bills',
    frequency: 'monthly',
    nextDueDate: format(new Date(), 'yyyy-MM-dd'),
    isActive: true,
    type: 'debit'
  });

  // Mirrors the amount as raw text so a trailing "." or "0" typed by the user isn't stripped by
  // the numeric round-trip on every render (which would block entering decimals like "349.50") —
  // same approach as the amount field in the Ledger transaction modal.
  const toInputStr = (n?: number) => (n === 0 || n === undefined) ? '' : n.toString();
  const [amountInput, setAmountInput] = useState('');

  const getDaysRemaining = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dateStr);
    due.setHours(0, 0, 0, 0);
    const diffTime = due.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const formatDays = (days: number) => {
    if (days === 0) return 'Due Today';
    if (days === 1) return 'Due Tomorrow';
    if (days < 0) return `${Math.abs(days)} days overdue`;
    return `In ${days} days`;
  };

  const resetForm = () => {
    setNewBill({
      name: '',
      amount: 0,
      category: 'Bills',
      frequency: 'monthly',
      nextDueDate: format(new Date(), 'yyyy-MM-dd'),
      isActive: true,
      type: 'debit'
    });
    setAmountInput('');
    setEditingBillId(null);
    setErrors({});
  };

  const handleAddBill = () => {
    // Every one of these used to fail silently (or via an alert() that said nothing about which
    // field), so "Start Tracking" looked dead. Mark the fields instead and scroll to the first.
    const newErrors: Record<string, string> = {};
    if (!newBill.name?.trim()) newErrors.name = 'Bill Name is required';
    if (!newBill.amount) newErrors.amount = 'Amount must be greater than 0';
    if (newBill.frequency === 'custom' && !newBill.customDays) {
      newErrors.customDays = 'Number of days is required for a custom frequency';
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      scrollToFirstError(billFormRef.current);
      return;
    }
    const trimmedBill = { ...newBill, name: (newBill.name || '').trim() } as RecurringBill;
    if (editingBillId) {
      updateRecurringBill({ ...trimmedBill, id: editingBillId });
    } else {
      addRecurringBill({ ...trimmedBill, id: crypto.randomUUID() });
    }
    setActiveView('main');
    resetForm();
  };



  // Combine manual bills and CC due dates
  const allUpcoming = useMemo(() => {
    const today = new Date();

    // 1. Process Manual Bills
    // A recurring bill has no settled state. Paying it rolls nextDueDate to the next occurrence
    // (handleMarkAsPaid here, or the LOG flow in LogTransactionForm), so the countdown IS the
    // status: pay the 90-day recharge on its due date and it reads "in 90 days", not "no dues".
    // The old derived flag only ever mislabelled live bills — a "Mobile Recharge(Maa)" payment
    // fuzzy-matched the separate "Mobile Recharge" bill and hid its actions for ten days.
    const manualBills = (data.recurringBills || []).map(bill => {
      // Older builds spread the derived flag back onto the record on save, so stored bills can
      // still carry a stale isPaid. Drop it on read; the next save writes the clean shape.
      const clean: RecurringBill & { isPaid?: boolean } = { ...bill };
      delete clean.isPaid;
      return clean as RecurringBill;
    });

    // 2. Process Credit Card Bills
    const ccBills = data.accounts
      .filter(acc => acc.type === 'credit_card' && acc.dueDay)
      .map(acc => {
        const dueDay = acc.dueDay!;
        const dueDate = new Date(today.getFullYear(), today.getMonth(), dueDay);

        const statementDay = acc.statementDay || 1;
        const lastStatementDate = new Date(today.getFullYear(), today.getMonth(), statementDay);
        if (today.getDate() < statementDay) {
          lastStatementDate.setMonth(lastStatementDate.getMonth() - 1);
        }

        if (dueDate < today) {
          dueDate.setMonth(dueDate.getMonth() + 1);
        }


        const lastStatementCycle = getLatestBilledCycle(statementDay);
        const { netPayable } = calculateTotalSpendPerCycle(data.transactions, acc.id, lastStatementCycle, statementDay, acc.statementRounding);

        const isPaid = netPayable <= 0;

        return {
          id: `cc-${acc.id}`,
          name: `${acc.name} Payment`,
          amount: Math.max(0, netPayable),
          category: 'CC Payment',
          nextDueDate: format(dueDate, 'yyyy-MM-dd'),
          isCC: true,
          isPaid,
          accountId: acc.id,
          statementDay
        };
      });

    return [...manualBills, ...ccBills].sort((a, b) => {
      // 1. Settled credit-card statements sink to the bottom. Manual bills never settle.
      const aSettled = 'isCC' in a && a.isPaid;
      const bSettled = 'isCC' in b && b.isPaid;
      if (aSettled !== bSettled) {
        return aSettled ? 1 : -1;
      }
      // 2. Then by date (closest first)
      return new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime();
    });
  }, [data.transactions, data.recurringBills, data.accounts]);

  return (
    <div className="flex-col gap-6 animate-in bills-tab-root">
      {activeView === 'main' && (
        <>
          <div className="flex justify-between align-center">
            <h2 className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>upcoming bills</h2>
            <button className="btn btn-primary flex align-center gap-2" onClick={() => setActiveView('add')}>
              <Plus size={18} strokeWidth={3} /> New Bill
            </button>
          </div>

          {allUpcoming.length === 0 ? (
            <div className="card flex-col align-center justify-center gap-4 text-center" style={{ padding: '3rem 1rem', opacity: 0.6 }}>
              <div className="flex-center" style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'var(--bg-hover)' }}>
                <Calendar size={32} />
              </div>
              <div className="flex-col gap-1">
                <p className="font-bold">All caught up!</p>
                <p className="text-xs">No upcoming bills tracked.</p>
              </div>
            </div>
          ) : (
            <div className="flex-col gap-4">
              {allUpcoming.map(bill => {
                const daysLeft = getDaysRemaining(bill.nextDueDate);
                const isOverdue = daysLeft < 0;
                const isUrgent = daysLeft <= 3;
                // Credit cards only — a statement genuinely settles. Manual bills never reach here.
                const isPaidCC = ('isCC' in bill && bill.isPaid);

                return (
                  <div key={bill.id} className="card flex-col gap-5 tour-bill-card" style={{
                    opacity: isPaidCC ? 0.7 : 1,
                    border: '2px solid var(--border-color)',
                    boxShadow: '4px 4px 0 var(--border-color)',
                    transition: 'transform 0.2s ease'
                  }}>
                    {/* Row 1: icon + name/frequency + action buttons */}
                    <div className="flex justify-between align-start gap-3">
                      <div className="flex align-center gap-3" style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex-center" style={{
                          width: '44px',
                          height: '44px',
                          flexShrink: 0,
                          borderRadius: '12px',
                          background: isPaidCC ? 'rgba(16, 185, 129, 0.1)' : isOverdue ? 'rgba(255, 59, 48, 0.1)' : 'var(--bg-hover)',
                          color: isPaidCC ? 'var(--success-color, #10b981)' : isOverdue ? 'var(--negative-color)' : 'var(--text-color)',
                          border: '1px solid var(--border-color)'
                        }}>
                          {isPaidCC ? <CheckCircle2 size={22} /> : (('isCC' in bill) ? <CreditCard size={22} /> : getCategoryIcon(bill.category as string, 22))}
                        </div>
                        <div className="flex-col gap-1" style={{ minWidth: 0 }}>
                          <span className="font-bold" style={{ fontSize: '1rem', lineHeight: 1.3 }}>{bill.name}</span>
                          <span className="text-muted text-xs font-medium uppercase tracking-wider">
                            {('isCC' in bill) ? (isPaidCC ? 'Next Statement Coming' : 'Credit Card Bill') : (bill.frequency === 'custom' ? `Every ${bill.customDays} Days` : FREQUENCY_LABELS[bill.frequency as RecurringFrequency])}
                          </span>
                        </div>
                      </div>
                      {!('isCC' in bill) && (
                        <div className="flex gap-3" style={{ flexShrink: 0 }}>
                          <button
                            className="btn btn-secondary"
                            style={{ width: '36px', height: '36px', minHeight: 'auto', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
                            onClick={() => {
                              setNewBill({ ...bill });
                              setAmountInput(toInputStr(bill.amount));
                              setEditingBillId(bill.id);
                              setActiveView('add');
                            }}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ width: '36px', height: '36px', minHeight: 'auto', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)' }}
                            onClick={() => deleteRecurringBill(bill.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Row 2: amount + due badge */}
                    <div className="flex justify-end align-center gap-3">
                      <span className={`text-xl font-bold ${isOverdue && !isPaidCC ? 'text-negative' : ''}`} style={{ fontFamily: 'var(--font-mono)' }}>
                        {bill.amount > 0 ? `₹${bill.amount.toLocaleString()}` : isPaidCC ? 'PAID' : '--'}
                      </span>
                      <div className="flex align-center gap-1 text-xs font-bold px-2 py-1" style={{
                        borderRadius: '6px',
                        background: isPaidCC ? 'rgba(16, 185, 129, 0.1)' : isOverdue ? 'var(--negative-color)' : isUrgent ? 'rgba(255, 159, 10, 0.1)' : 'var(--bg-hover)',
                        color: isPaidCC ? 'var(--success-color, #10b981)' : isOverdue ? 'white' : isUrgent ? 'var(--warning-color, #ff9f0a)' : 'var(--text-muted)',
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap'
                      }}>
                        {isPaidCC ? <Check size={12} /> : isOverdue ? <AlertCircle size={12} /> : <Clock size={12} />}
                        {isPaidCC ? 'No Dues' : formatDays(daysLeft)}
                      </div>
                    </div>

                    {!isPaidCC && (
                      <div className={`flex gap-2 tour-bill-actions${bill.id.startsWith('demo_') ? ' tour-demo-bill-actions' : ''}`} style={{ width: '100%', marginTop: '0.5rem' }}>
                        <button
                          className="btn flex-center gap-1"
                          style={{
                            height: '40px',
                            padding: '0 4px',
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            border: '2px solid var(--border-color)',
                            boxShadow: '3px 3px 0 var(--border-color)',
                            background: 'var(--bg-hover)',
                            color: 'var(--text-primary)',
                            boxSizing: 'border-box',
                            flex: 1
                          }}
                          onClick={() => {
                            setSelectedBill(bill as RecurringBill);
                            setIsLogModalOpen(true);
                          }}
                        >
                          <ArrowUpRight size={14} strokeWidth={3} /> LOG
                        </button>
                        {!('isCC' in bill) && (
                          <button
                            className="btn flex-center gap-1"
                            style={{
                              height: '40px',
                              padding: '0 4px',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              border: '2px solid var(--border-color)',
                              boxShadow: '3px 3px 0 var(--border-color)',
                              background: 'var(--bg-hover)',
                              color: 'var(--text-primary)',
                              boxSizing: 'border-box',
                              flex: 1
                            }}
                            onClick={() => {
                              setSelectedBill(bill as RecurringBill);
                              setIsLinkModalOpen(true);
                            }}
                          >
                            <Link size={14} strokeWidth={2.5} /> LINK
                          </button>
                        )}
                        <button
                          className="btn flex-center gap-1"
                          style={{
                            height: '40px',
                            padding: '0 4px',
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            border: '2px solid var(--border-color)',
                            boxShadow: '3px 3px 0 var(--border-color)',
                            background: 'var(--bg-hover)',
                            color: 'var(--success-color, #10b981)',
                            boxSizing: 'border-box',
                            flex: 1
                          }}
                          onClick={() => {
                            if ('isCC' in bill) {
                              alert('For Credit Card bills, please log a payment to clear the balance.');
                            } else {
                              handleMarkAsPaid(bill as RecurringBill);
                            }
                          }}
                        >
                          <Check size={14} strokeWidth={3} /> PAID
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}



      {activeView === 'add' && (
        <SubviewWrapper
          title={editingBillId ? 'Edit Bill' : 'Track New Bill'}
          onBack={() => { setActiveView('main'); resetForm(); }}
          footer={
            <button
              className="btn btn-primary w-100"
              style={{ padding: '1rem' }}
              onClick={handleAddBill}
            >
              {editingBillId ? 'Save Changes' : 'Start Tracking'}
            </button>
          }
        >
          <div className="flex-col gap-6" ref={billFormRef}>
            <div className="input-group">
              <label>Bill Name</label>
              <input
                type="text"
                className={`input-field ${errors.name ? 'border-danger' : ''}`}
                placeholder="e.g. Rent, Netflix, Electricity"
                value={newBill.name}
                onChange={e => {
                  setNewBill({ ...newBill, name: e.target.value });
                  if (errors.name) setErrors(prev => ({ ...prev, name: '' }));
                }}
              />
              {errors.name && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.name}</span>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="input-group flex-1">
                <label>Amount</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={`input-field ${errors.amount ? 'border-danger' : ''}`}
                  placeholder="0.00"
                  value={amountInput}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                      setAmountInput(val);
                      setNewBill({ ...newBill, amount: val === '' ? 0 : (val === '.' ? 0 : parseFloat(val)) });
                      if (errors.amount) setErrors(prev => ({ ...prev, amount: '' }));
                    }
                  }}
                />
                {errors.amount && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.amount}</span>}
              </div>
              <div className="input-group flex-1">
                <label>Frequency</label>
                <CustomPicker
                  label="Frequency"
                  hideLabel={true}
                  value={newBill.frequency || 'monthly'}
                  options={Object.entries(FREQUENCY_LABELS).map(([id, name]) => ({ id, name }))}
                  onChange={val => setNewBill({ ...newBill, frequency: val as RecurringFrequency })}
                  iconGetter={() => <Repeat size={18} />}
                  allowTextWrap={true}
                />
              </div>
            </div>

            {newBill.frequency === 'custom' && (
              <div className="input-group animate-in">
                <label>Days Interval</label>
                <input
                  type="number"
                  className={`input-field ${errors.customDays ? 'border-danger' : ''}`}
                  placeholder="e.g. 28, 56, 84"
                  value={newBill.customDays || ''}
                  onChange={e => {
                    setNewBill({ ...newBill, customDays: parseInt(e.target.value) });
                    if (errors.customDays) setErrors(prev => ({ ...prev, customDays: '' }));
                  }}
                />
                {errors.customDays && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.customDays}</span>}
                <p className="text-xs text-muted" style={{ marginTop: '0.5rem' }}>Bill will automatically advance by this many days after each payment.</p>
              </div>
            )}

            <div className="input-group" onClick={() => setIsDatePickerOpen(true)}>
              <label>Next Due Date</label>
            <div className="input-field flex align-center justify-between gap-3 clickable">
              <span className="text-mono">{newBill.nextDueDate ? format(parseISO(newBill.nextDueDate), 'EEE, d MMM yyyy') : 'Select Date'}</span>
              <Calendar size={18} className="text-muted" />
            </div>
            </div>

            <CustomDatePicker
              isOpen={isDatePickerOpen}
              onClose={() => setIsDatePickerOpen(false)}
              value={newBill.nextDueDate || ''}
              onChange={(val) => setNewBill({ ...newBill, nextDueDate: val })}
              label="Next Due Date"
            />

            <div className="input-group">
              <label>Category</label>
              <CustomPicker
                label="Category"
                hideLabel={true}
                value={newBill.category || 'Bills'}
                options={data.categories.map(cat => ({ id: cat, name: cat }))}
                onChange={val => setNewBill({ ...newBill, category: val })}
                iconGetter={(id) => getCategoryIcon(id)}
              />
            </div>
          </div>
        </SubviewWrapper>
      )}

      {/* The same form the main Ledger uses — see LogTransactionForm.tsx. LOG only prefills it;
          cashback, passive-log, NCMC and reward splits all behave exactly as they do in the Ledger. */}
      {isLogModalOpen && selectedBill && (
        <LogTransactionForm
          initialData={{
            description: 'isCC' in selectedBill ? 'CC Bill Payment' : selectedBill.name,
            amount: selectedBill.amount,
            category: 'isCC' in selectedBill ? 'CC Payment' : (selectedBill.category || 'Bills'),
            accountId: selectedBill.accountId || data.accounts.find(a => !a.archived)?.id || '',
            type: 'isCC' in selectedBill ? 'credit' : (selectedBill.type || 'debit'),
            // Only a tracked bill has a real id to link back to and advance on save. A credit-card
            // due date is synthesised per card ('cc-<accountId>'), so linking to it would persist a
            // foreign key that matches no bill — the card's dues clear from the payment itself.
            ...('isCC' in selectedBill ? {} : { recurringBillId: selectedBill.id })
          }}
          onClose={() => {
            setIsLogModalOpen(false);
            setSelectedBill(null);
          }}
        />
      )}

      <TransactionSelector
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        onSelect={(tx) => {
          handleLinkTransaction(tx);
          setIsLinkModalOpen(false);
        }}
        title="Select Transaction"
      />
    </div>
  );
}
