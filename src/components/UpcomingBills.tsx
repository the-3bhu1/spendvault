import React, { useState, useMemo } from 'react';
import { format, parseISO, addDays, addMonths } from 'date-fns';
import {
  Repeat,
  Link,
  ArrowUpRight,
  Home,
  Smartphone,
  Tv,
  PieChart,
  Wallet,
  CreditCard,
  Clock,
  Trash2,
  Pencil,
  Plus,
  Calendar,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown
} from 'lucide-react';
import { useFinance } from '../FinanceContext';
import type { RecurringBill, RecurringFrequency } from '../types';
import { SubviewWrapper } from './SubviewWrapper';
import { CustomPicker } from './CustomPicker';
import { TransactionSelector } from './TransactionSelector';
import { TransactionModal } from './TransactionModal';
import CustomDatePicker from './CustomDatePicker';
import { calculateTotalSpendPerCycle, getLatestBilledCycle } from '../utils';

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  custom: 'Custom Days'
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Rent': <Home size={20} />,
  'Bills': <Smartphone size={20} />,
  'Entertainment': <Tv size={20} />,
  'Travel': <Repeat size={20} />,
  'SIP': <PieChart size={20} />,
  'Other': <Wallet size={20} />
};

export default function UpcomingBills() {
  const { data, addRecurringBill, updateRecurringBill, deleteRecurringBill, updateTransaction } = useFinance();
  const [activeView, setActiveView] = useState<'main' | 'add'>('main');
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<RecurringBill | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [billsOpen, setBillsOpen] = useState(true);
  const [sipsOpen, setSipsOpen] = useState(true);

  const handleLinkTransaction = (transaction: any) => {
    if (!selectedBill) return;

    // Link the transaction to the bill
    updateTransaction({
      ...transaction,
      recurringBillId: selectedBill.id
    });

    setActiveView('main');
    setSelectedBill(null);
  };

  const handleMarkAsPaid = (bill: RecurringBill) => {
    const nextDate = parseISO(bill.nextDueDate);
    let updatedDate: Date;

    switch (bill.frequency) {
      case 'daily': updatedDate = addDays(nextDate, 1); break;
      case 'weekly': updatedDate = addDays(nextDate, 7); break;
      case 'monthly': updatedDate = addMonths(nextDate, 1); break;
      case 'quarterly': updatedDate = addMonths(nextDate, 3); break;
      case 'yearly': updatedDate = addMonths(nextDate, 12); break;
      case 'custom': updatedDate = addDays(nextDate, bill.customDays || 1); break;
      default: updatedDate = addMonths(nextDate, 1);
    }

    updateRecurringBill({
      ...bill,
      nextDueDate: format(updatedDate, 'yyyy-MM-dd'),
      lastPaidDate: format(new Date(), 'yyyy-MM-dd')
    });
  };

  const [newBill, setNewBill] = useState<Partial<RecurringBill>>({
    name: '',
    amount: 0,
    category: 'Bills',
    frequency: 'monthly',
    nextDueDate: format(new Date(), 'yyyy-MM-dd'),
    isActive: true,
    type: 'debit',
    linkedSipAccountId: undefined
  });

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
      type: 'debit',
      linkedSipAccountId: undefined
    });
    setEditingBillId(null);
  };

  const handleAddBill = () => {
    if (!newBill.name || !newBill.amount) return;
    if (newBill.frequency === 'custom' && !newBill.customDays) {
      alert('Please specify the number of days for custom frequency.');
      return;
    }
    if (editingBillId) {
      updateRecurringBill({ ...newBill as RecurringBill, id: editingBillId });
    } else {
      addRecurringBill({ ...newBill as RecurringBill, id: crypto.randomUUID() });
    }
    setActiveView('main');
    resetForm();
  };



  // Combine manual bills and CC due dates
  const allUpcoming = useMemo(() => {
    const today = new Date();

    // 1. Process Manual Bills
    const manualBills = (data.recurringBills || []).map(bill => {
      const isPaid = data.transactions.some(t => {
        // Explicit link check first
        if (t.recurringBillId === bill.id) {
          const tDate = new Date(t.date);
          const isSameMonth = tDate.getMonth() === today.getMonth() && tDate.getFullYear() === today.getFullYear();
          if (bill.frequency === 'monthly') return isSameMonth;
          return true; // For non-monthly, any recent link counts
        }

        // Bills with a linked SIP account use only explicit recurringBillId — skip fuzzy
        if (bill.linkedSipAccountId) return false;

        // Fallback to fuzzy match
        const tDate = new Date(t.date);
        const isSameMonth = tDate.getMonth() === today.getMonth() && tDate.getFullYear() === today.getFullYear();
        const isNameMatch = t.description.toLowerCase().includes(bill.name.toLowerCase()) || bill.name.toLowerCase().includes(t.description.toLowerCase());
        const isCatMatch = t.category === bill.category;

        if (bill.frequency === 'monthly') return isSameMonth && isNameMatch && isCatMatch;
        const diffDays = Math.abs((tDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays < 10 && isNameMatch && isCatMatch;
      }) || (bill.lastPaidDate && (() => {
        const lpDate = parseISO(bill.lastPaidDate);
        const isSameMonth = lpDate.getMonth() === today.getMonth() && lpDate.getFullYear() === today.getFullYear();
        if (bill.frequency === 'monthly') return isSameMonth;
        const diffDays = Math.abs((lpDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays < 7;
      })());

      return { ...bill, isPaid };
    });

    // 2. Process Credit Card Bills
    const ccBills = data.accounts
      .filter(acc => acc.type === 'credit_card' && acc.dueDay)
      .map(acc => {
        let dueDay = acc.dueDay!;
        let dueDate = new Date(today.getFullYear(), today.getMonth(), dueDay);

        let statementDay = acc.statementDay || 1;
        let lastStatementDate = new Date(today.getFullYear(), today.getMonth(), statementDay);
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
      // 1. Pending (unpaid) first
      if (a.isPaid !== b.isPaid) {
        return a.isPaid ? 1 : -1;
      }
      // 2. Then by date (closest first)
      return new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime();
    });
  }, [data.transactions, data.recurringBills, data.accounts]);

  return (
    <div className="flex-col gap-6 animate-in bills-tab-root" style={{ padding: '0.5rem 0' }}>
      {activeView === 'main' && (
        <>
          <div className="flex justify-between align-center">
            <h2 className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>upcoming bills</h2>
            <button className="btn btn-primary flex align-center gap-2" onClick={() => setActiveView('add')}>
              <Plus size={18} strokeWidth={3} /> New Bill
            </button>
          </div>

          {(() => {
            const sipItems = allUpcoming.filter(b => !('isCC' in b) && (b as RecurringBill).category === 'SIP');
            const billItems = allUpcoming.filter(b => ('isCC' in b) || (b as RecurringBill).category !== 'SIP');

            if (allUpcoming.length === 0) return (
              <div className="card flex-col align-center justify-center gap-4 text-center" style={{ padding: '3rem 1rem', opacity: 0.6 }}>
                <div className="flex-center" style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'var(--bg-hover)' }}>
                  <Calendar size={32} />
                </div>
                <div className="flex-col gap-1">
                  <p className="font-bold">All caught up!</p>
                  <p className="text-xs">No upcoming bills or SIPs tracked.</p>
                </div>
              </div>
            );

            const SectionHeader = ({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) => (
              <button
                onClick={onToggle}
                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: '0.25rem' }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', opacity: 0.6 }}>{count}</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </button>
            );

            return (
              <div className="flex-col gap-6">
                {billItems.length > 0 && (
                  <div className="flex-col gap-4">
                    <SectionHeader label="Bills" count={billItems.length} open={billsOpen} onToggle={() => setBillsOpen(o => !o)} />
                    {billsOpen && billItems.map(bill => {
                const daysLeft = getDaysRemaining(bill.nextDueDate);
                const isOverdue = daysLeft < 0;
                const isUrgent = daysLeft <= 3;
                const isPaidCC = ('isPaid' in bill && bill.isPaid);

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
                          {isPaidCC ? <CheckCircle2 size={22} /> : (('isCC' in bill) ? <CreditCard size={22} /> : (CATEGORY_ICONS[bill.category as string] || <Clock size={22} />))}
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
                {sipItems.length > 0 && (
                  <div className="flex-col gap-4">
                    <SectionHeader label="SIPs" count={sipItems.length} open={sipsOpen} onToggle={() => setSipsOpen(o => !o)} />
                    {sipsOpen && sipItems.map(bill => {
                      const daysLeft = getDaysRemaining(bill.nextDueDate);
                      const isOverdue = daysLeft < 0;
                      const isUrgent = daysLeft <= 3;
                      const isPaidCC = ('isPaid' in bill && bill.isPaid);
                      return (
                        <div key={bill.id} className="card flex-col gap-5" style={{
                          opacity: isPaidCC ? 0.7 : 1,
                          border: '2px solid var(--border-color)',
                          boxShadow: '4px 4px 0 var(--border-color)',
                          transition: 'transform 0.2s ease'
                        }}>
                          <div className="flex justify-between align-start gap-3">
                            <div className="flex align-center gap-3" style={{ flex: 1, minWidth: 0 }}>
                              <div className="flex-center" style={{
                                width: '44px', height: '44px', flexShrink: 0, borderRadius: '12px',
                                background: isPaidCC ? 'rgba(16, 185, 129, 0.1)' : isOverdue ? 'rgba(255, 59, 48, 0.1)' : 'var(--bg-hover)',
                                color: isPaidCC ? 'var(--success-color, #10b981)' : isOverdue ? 'var(--negative-color)' : 'var(--text-color)',
                                border: '1px solid var(--border-color)'
                              }}>
                                {isPaidCC ? <CheckCircle2 size={22} /> : (CATEGORY_ICONS[(bill as RecurringBill).category as string] || <Clock size={22} />)}
                              </div>
                              <div className="flex-col gap-1" style={{ minWidth: 0 }}>
                                <span className="font-bold" style={{ fontSize: '1rem', lineHeight: 1.3 }}>{bill.name}</span>
                                <span className="text-muted text-xs font-medium uppercase tracking-wider">
                                  {(bill as RecurringBill).frequency === 'custom' ? `Every ${(bill as RecurringBill).customDays} Days` : FREQUENCY_LABELS[(bill as RecurringBill).frequency as RecurringFrequency]}
                                </span>
                              </div>
                            </div>
                            <div className="flex gap-3" style={{ flexShrink: 0 }}>
                              <button className="btn btn-secondary" style={{ width: '36px', height: '36px', minHeight: 'auto', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
                                onClick={() => { setNewBill({ ...bill }); setEditingBillId(bill.id); setActiveView('add'); }}>
                                <Pencil size={15} />
                              </button>
                              <button className="btn btn-secondary" style={{ width: '36px', height: '36px', minHeight: 'auto', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)' }}
                                onClick={() => deleteRecurringBill(bill.id)}>
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                          <div className="flex justify-end align-center gap-3">
                            <span className={`text-xl font-bold ${isOverdue && !isPaidCC ? 'text-negative' : ''}`} style={{ fontFamily: 'var(--font-mono)' }}>
                              {bill.amount > 0 ? `₹${bill.amount.toLocaleString()}` : '--'}
                            </span>
                            <div className="flex align-center gap-1 text-xs font-bold px-2 py-1" style={{
                              borderRadius: '6px',
                              background: isPaidCC ? 'rgba(16, 185, 129, 0.1)' : isOverdue ? 'var(--negative-color)' : isUrgent ? 'rgba(255, 159, 10, 0.1)' : 'var(--bg-hover)',
                              color: isPaidCC ? 'var(--success-color, #10b981)' : isOverdue ? 'white' : isUrgent ? 'var(--warning-color, #ff9f0a)' : 'var(--text-muted)',
                              textTransform: 'uppercase', whiteSpace: 'nowrap'
                            }}>
                              {isPaidCC ? <Check size={12} /> : isOverdue ? <AlertCircle size={12} /> : <Clock size={12} />}
                              {isPaidCC ? 'No Dues' : formatDays(daysLeft)}
                            </div>
                          </div>
                          {!isPaidCC && (
                            <div className="flex gap-2" style={{ width: '100%', marginTop: '0.5rem' }}>
                              <button className="btn flex-center gap-1" style={{ height: '40px', padding: '0 4px', fontSize: '0.75rem', fontWeight: 800, border: '2px solid var(--border-color)', boxShadow: '3px 3px 0 var(--border-color)', background: 'var(--bg-hover)', color: 'var(--text-primary)', boxSizing: 'border-box', flex: 1 }}
                                onClick={() => { setSelectedBill(bill as RecurringBill); setIsLogModalOpen(true); }}>
                                <ArrowUpRight size={14} strokeWidth={3} /> LOG
                              </button>
                              <button className="btn flex-center gap-1" style={{ height: '40px', padding: '0 4px', fontSize: '0.75rem', fontWeight: 800, border: '2px solid var(--border-color)', boxShadow: '3px 3px 0 var(--border-color)', background: 'var(--bg-hover)', color: 'var(--text-primary)', boxSizing: 'border-box', flex: 1 }}
                                onClick={() => { setSelectedBill(bill as RecurringBill); setIsLinkModalOpen(true); }}>
                                <Link size={14} strokeWidth={2.5} /> LINK
                              </button>
                              <button className="btn flex-center gap-1" style={{ height: '40px', padding: '0 4px', fontSize: '0.75rem', fontWeight: 800, border: '2px solid var(--border-color)', boxShadow: '3px 3px 0 var(--border-color)', background: 'var(--bg-hover)', color: 'var(--success-color, #10b981)', boxSizing: 'border-box', flex: 1 }}
                                onClick={() => handleMarkAsPaid(bill as RecurringBill)}>
                                <Check size={14} strokeWidth={3} /> PAID
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
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
          <div className="flex-col gap-6">
            <div className="input-group">
              <label>Bill Name</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Rent, Netflix, SIP"
                value={newBill.name}
                onChange={e => setNewBill({ ...newBill, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="input-group flex-1">
                <label>Amount</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-field"
                  placeholder="0.00"
                  value={newBill.amount || ''}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                      setNewBill({ ...newBill, amount: val === '' ? 0 : (val === '.' ? 0 : parseFloat(val)) });
                    }
                  }}
                />
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
                  className="input-field"
                  placeholder="e.g. 28, 56, 84"
                  value={newBill.customDays || ''}
                  onChange={e => setNewBill({ ...newBill, customDays: parseInt(e.target.value) })}
                />
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
                onChange={val => setNewBill({ ...newBill, category: val, linkedSipAccountId: val !== 'SIP' ? undefined : newBill.linkedSipAccountId })}
                iconGetter={(id) => CATEGORY_ICONS[id] || <Wallet size={18} />}
              />
            </div>

            {newBill.category === 'SIP' && (
              <div className="input-group animate-in">
                <label>Link to SIP Account</label>
                <CustomPicker
                  label="SIP Account"
                  hideLabel={true}
                  value={newBill.linkedSipAccountId || ''}
                  options={[
                    { id: '', name: 'None (Manual Log)' },
                    ...data.accounts.filter(a => a.type === 'sips').map(a => ({ id: a.id, name: a.name }))
                  ]}
                  onChange={val => {
                    const sipAcc = val ? data.accounts.find(a => a.id === val) : undefined;
                    setNewBill({
                      ...newBill,
                      linkedSipAccountId: val || undefined,
                      name: sipAcc ? sipAcc.name : newBill.name
                    });
                  }}
                  iconGetter={() => <PieChart size={18} />}
                />
                <p className="text-xs text-muted" style={{ marginTop: '0.5rem' }}>When logging this SIP, the investment amount will automatically be credited to the linked account.</p>
              </div>
            )}
          </div>
        </SubviewWrapper>
      )}

      <TransactionModal
        isOpen={isLogModalOpen}
        onClose={() => {
          setIsLogModalOpen(false);
          setSelectedBill(null);
        }}
        initialData={selectedBill ? (() => {
          const isSip = !('isCC' in selectedBill) && selectedBill.category === 'SIP';
          const sipAccount = isSip && selectedBill.linkedSipAccountId
            ? data.accounts.find(a => a.id === selectedBill.linkedSipAccountId)
            : undefined;
          return {
            description: 'isCC' in selectedBill ? 'CC Bill Payment' : selectedBill.name,
            amount: selectedBill.amount,
            category: 'isCC' in selectedBill ? 'CC Payment' : (selectedBill.category || 'Bills'),
            accountId: selectedBill.accountId || data.accounts[0]?.id || '',
            type: 'isCC' in selectedBill ? 'credit' : (selectedBill.type || 'debit'),
            recurringBillId: selectedBill.id,
            ...(isSip && sipAccount ? {
              paymentSourceAccountId: sipAccount.id,
              sipAllottedAmount: selectedBill.amount,
              sipCharges: 0
            } : {})
          };
        })() : undefined}
      />

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
