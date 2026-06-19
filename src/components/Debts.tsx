import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '../FinanceContext';
import {
  ChevronLeft,
  Plus,
  User as UserIcon,
  ArrowUpRight,
  ArrowDownLeft,
  Trash2,
  Check,
  CheckCircle2,
  History,
  HandCoins,
  ChevronRight,
  Search,
  UserPlus,
  Wallet,
  Edit2,
  Calendar
} from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';
import ConfirmDialog from './ConfirmDialog';
import { getAccountTypeIcon } from './transactionIcons';
import { generateId, formatCurrency, calculateBalance, getCurrentMonthStr } from '../utils';
import type { Debt, DebtTransaction, Account } from '../types';
import { CustomPicker } from './CustomPicker';
import { TransactionSelector } from './TransactionSelector';
import { SubviewWrapper } from './SubviewWrapper';

const calcDebtBalance = (transactions: DebtTransaction[]) =>
  transactions.reduce((sum, t) => {
    if (t.type === 'lent' || t.type === 'repayment_sent') return sum + t.amount;
    if (t.type === 'borrowed' || t.type === 'repayment_received') return sum - t.amount;
    return sum;
  }, 0);

export default function Debts() {
  const { data, addDebt, updateDebt, deleteDebt, addTransaction, updateTransaction } = useFinance();
  const [activeDebtId, setActiveDebtId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    onThirdAction?: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
    thirdLabel?: string;
    isDanger?: boolean;
  } | null>(null);

  const debts = data.debts || [];

  const activeDebt = useMemo(() =>
    debts.find(d => d.id === activeDebtId),
    [debts, activeDebtId]
  );

  const filteredDebts = useMemo(() => {
    return debts.filter(d =>
      d.personName.toLowerCase().includes(searchQuery.toLowerCase())
    ).sort((a, b) => {
      if (a.status !== b.status) return a.status === 'settled' ? 1 : -1;
      return b.updatedAt - a.updatedAt;
    });
  }, [debts, searchQuery]);

  useEffect(() => {
    const handleGlobalBack = (e: Event) => {
      if (activeDebtId) {
        setActiveDebtId(null);
        e.preventDefault();
      } else if (showAddModal) {
        setShowAddModal(false);
        e.preventDefault();
      }
    };
    window.addEventListener('appBackButton', handleGlobalBack);
    return () => window.removeEventListener('appBackButton', handleGlobalBack);
  }, [activeDebtId, showAddModal]);

  useEffect(() => {
    const openTourDebtDetail = () => {
      const demoDebt = debts.find(debt => debt.id === 'demo_debt_1') || debts[0];
      if (!demoDebt) return;
      setShowAddModal(false);
      setActiveDebtId(demoDebt.id);
      document.body.classList.add('tour-debt-inside-active');
    };
    const closeTourDebtDetail = () => {
      setActiveDebtId(null);
      setShowAddModal(false);
      document.body.classList.remove('tour-debt-inside-active');
    };

    window.addEventListener('tour-open-debt-detail', openTourDebtDetail);
    window.addEventListener('tour-close-debt-detail', closeTourDebtDetail);
    return () => {
      window.removeEventListener('tour-open-debt-detail', openTourDebtDetail);
      window.removeEventListener('tour-close-debt-detail', closeTourDebtDetail);
    };
  }, [debts]);

  const stats = useMemo(() => {
    let owedToMe = 0;
    let iOwe = 0;

    debts.forEach(debt => {
      if (debt.status === 'settled') return;
      const net = debt.transactions.reduce((sum, t) => {
        if (t.type === 'lent' || t.type === 'repayment_sent') return sum + t.amount;
        if (t.type === 'borrowed' || t.type === 'repayment_received') return sum - t.amount;
        return sum;
      }, 0);

      if (net > 0) owedToMe += net;
      else if (net < 0) iOwe += Math.abs(net);
    });

    return { owedToMe, iOwe };
  }, [debts]);

  const getPersonNetBalance = (debt: Debt) => {
    return debt.transactions.reduce((sum, t) => {
      if (t.type === 'lent' || t.type === 'repayment_sent') return sum + t.amount;
      if (t.type === 'borrowed' || t.type === 'repayment_received') return sum - t.amount;
      return sum;
    }, 0);
  };

  const handleAddDebt = (name: string, amount: number, type: 'lent' | 'borrowed', desc: string, date: string, accountId: string, logInLedger: boolean, linkedTxId?: string) => {
    const txId = generateId();
    const newTx: DebtTransaction = {
      id: txId,
      amount,
      date: date || format(new Date(), 'yyyy-MM-dd'),
      description: desc || (type === 'lent' ? 'Lent money' : 'Borrowed money'),
      type,
      linkedTxId
    };

    if (logInLedger && accountId) {
      const ledgerTx = {
        id: generateId(),
        accountId,
        amount,
        type: type === 'lent' ? 'debit' : 'credit',
        category: 'Lending & Borrowing',
        description: `${name}: ${newTx.description}`,
        date: newTx.date,
        linkedTransactionIds: [txId]
      };
      addTransaction(ledgerTx as any);
    }

    const existingDebt = debts.find(d => d.personName.toLowerCase() === name.toLowerCase());

    if (existingDebt) {
      updateDebt({
        ...existingDebt,
        transactions: [...existingDebt.transactions, newTx],
        status: 'active',
        updatedAt: Date.now()
      });
    } else {
      const newDebt: Debt = {
        id: generateId(),
        personName: name,
        transactions: [newTx],
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      addDebt(newDebt);
    }
    setShowAddModal(false);
  };

  const handleAddTransaction = (amount: number, type: DebtTransaction['type'], desc: string, date: string, accountId: string, logInLedger: boolean, linkedTxId?: string) => {
    if (!activeDebtId) return;
    const debt = debts.find(d => d.id === activeDebtId);
    if (!debt) return;

    const txId = generateId();
    const newTx: DebtTransaction = {
      id: txId,
      amount,
      date: date || format(new Date(), 'yyyy-MM-dd'),
      description: desc,
      type,
      linkedTxId
    };

    if (logInLedger && accountId) {
      const ledgerTx = {
        id: generateId(),
        accountId,
        amount,
        type: (type === 'lent' || type === 'repayment_sent') ? 'debit' : 'credit',
        category: 'Lending & Borrowing',
        description: `${debt.personName}: ${newTx.description}`,
        date: newTx.date,
        linkedTransactionIds: [txId]
      };
      addTransaction(ledgerTx as any);
    } else if (linkedTxId) {
      // Link to an existing ledger transaction bidirectionally
      const existingTx = data.transactions.find(t => t.id === linkedTxId);
      if (existingTx) {
        updateTransaction({
          ...existingTx,
          linkedTransactionIds: [...(existingTx.linkedTransactionIds || []), txId]
        });
      }
    }

    const updatedTransactions = [...debt.transactions, newTx];
    const balanced = calcDebtBalance(updatedTransactions) === 0;
    const finalTransactions = balanced
      ? updatedTransactions.map(t => ({ ...t, markedDone: true }))
      : updatedTransactions;
    const updatedDebt = {
      ...debt,
      transactions: finalTransactions,
      status: balanced ? 'settled' : 'active',
      updatedAt: Date.now()
    } as Debt;

    updateDebt(updatedDebt);
  };

  return (
    <>
      {activeDebtId && activeDebt ? (
        <DebtDetail
          debt={activeDebt}
          onBack={() => setActiveDebtId(null)}
          onAddTx={handleAddTransaction}
          onUpdateDebt={updateDebt}
          onDelete={() => { deleteDebt(activeDebtId); setActiveDebtId(null); }}
          setConfirmConfig={setConfirmConfig}
          existingNames={debts.map(d => d.personName).filter(n => n !== activeDebt.personName)}
        />
      ) : showAddModal ? (
        <AddDebtModal
          existingNames={debts.map(d => d.personName)}
          accounts={data.accounts}
          onAdd={handleAddDebt}
          onClose={() => setShowAddModal(false)}
        />
      ) : (
        <div className="flex-col gap-6 fade-in debts-tab-root">
          <div className="flex justify-between align-center">
            <div className="flex-col">
              <h2 className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>money owed</h2>
            </div>
            <button
              className="btn btn-primary flex align-center gap-2"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={18} strokeWidth={3} /> New Log
            </button>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="card flex-col gap-1" style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--success)',
              boxShadow: '3px 3px 0 var(--success)',
              padding: '1rem'
            }}>
              <span className="text-mono text-xs font-bold uppercase" style={{ letterSpacing: '1px', color: 'var(--success)', opacity: 0.8 }}>Owed to Me</span>
              <span className="text-xl font-bold text-success">{formatCurrency(stats.owedToMe)}</span>
            </div>
            <div className="card flex-col gap-1" style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--danger)',
              boxShadow: '3px 3px 0 var(--danger)',
              padding: '1rem'
            }}>
              <span className="text-mono text-xs font-bold uppercase" style={{ letterSpacing: '1px', color: 'var(--danger)', opacity: 0.8 }}>I Owe</span>
              <span className="text-xl font-bold text-danger">{formatCurrency(stats.iOwe)}</span>
            </div>
          </div>

          <div className="flex align-center gap-3" style={{ background: 'var(--bg-hover)', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <Search size={18} className="text-muted" />
            <input
              className="text-sm w-100"
              style={{ background: 'none', border: 'none', color: 'var(--text-primary)', outline: 'none' }}
              placeholder="Search by name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex-col gap-3">
            {filteredDebts.length === 0 ? (
              <div className="flex-col align-center justify-center gap-4" style={{ padding: '4rem 0', opacity: 0.5 }}>
                <HandCoins size={48} strokeWidth={1} />
                <p className="text-sm text-muted">No lending or borrowing logs found.</p>
              </div>
            ) : (
              filteredDebts.map(debt => {
                const balance = getPersonNetBalance(debt);
                const isSettled = debt.status === 'settled';
                return (
                  <div
                    key={debt.id}
                    className="card flex align-center justify-between clickable tour-debt-record-card"
                    style={{
                      padding: '1rem',
                      opacity: isSettled ? 0.6 : 1,
                      background: isSettled ? 'var(--bg-color)' : 'var(--bg-card)'
                    }}
                    onClick={() => setActiveDebtId(debt.id)}
                  >
                    <div className="flex align-center gap-4">
                      <div className="flex-center" style={{ width: '44px', height: '44px', borderRadius: '12px', background: isSettled ? 'var(--bg-hover)' : 'var(--primary-soft)', color: isSettled ? 'var(--text-muted)' : 'var(--accent)' }}>
                        <UserIcon size={20} />
                      </div>
                      <div className="flex-col">
                        <span className="font-bold">{debt.personName}</span>
                        <span className="text-xs text-muted">{debt.transactions.length} transactions</span>
                      </div>
                    </div>
                    <div className="flex-col align-end">
                      {isSettled ? (
                        <span className="text-xs font-bold uppercase text-muted" style={{ letterSpacing: '1px' }}>Settled</span>
                      ) : (
                        <>
                          <span className={`font-bold ${balance >= 0 ? 'text-success' : 'text-danger'}`}>
                            {balance > 0 ? '+' : ''}{formatCurrency(balance)}
                          </span>
                          <span className="text-xs text-muted uppercase font-bold" style={{ fontSize: '9px' }}>
                            {balance > 0 ? 'Owes You' : 'You Owe'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {confirmConfig && (
        <ConfirmDialog
          isOpen={!!confirmConfig}
          {...confirmConfig}
          onCancel={() => setConfirmConfig(null)}
        />
      )}
    </>
  );
}

function DebtDetail({ debt, onBack, onAddTx, onUpdateDebt, onDelete, setConfirmConfig, existingNames }: {
  debt: Debt,
  onBack: () => void,
  onAddTx: (amt: number, type: DebtTransaction['type'], desc: string, date: string, accountId: string, logInLedger: boolean, linkedTxId?: string) => void,
  onUpdateDebt: (debt: Debt) => void,
  onDelete: () => void,
  setConfirmConfig: (config: any) => void,
  existingNames: string[]
}) {
  const { data, deleteTransaction, updateTransaction } = useFinance();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(debt.personName);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    document.querySelector('.app-root')?.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) { setNameError('Name cannot be empty.'); return; }
    if (existingNames.map(n => n.toLowerCase()).includes(trimmed.toLowerCase())) {
      setNameError('A log with this name already exists.');
      return;
    }
    onUpdateDebt({ ...debt, personName: trimmed, updatedAt: Date.now() });
    setIsEditingName(false);
    setNameError('');
  };
  const [showActionModal, setShowActionModal] = useState<'lent' | 'borrowed' | 'repayment' | null>(null);
  const [editingTx, setEditingTx] = useState<DebtTransaction | null>(null);
  const netBalance = debt.transactions.reduce((sum, t) => {
    if (t.type === 'lent' || t.type === 'repayment_sent') return sum + t.amount;
    if (t.type === 'borrowed' || t.type === 'repayment_received') return sum - t.amount;
    return sum;
  }, 0);

  const toggleSettled = () => {
    if (debt.status === 'settled') {
      onUpdateDebt({
        ...debt,
        transactions: debt.transactions.filter(t => t.description !== 'Final Settlement'),
        status: 'active',
        updatedAt: Date.now()
      });
      return;
    }

    if (debt.status === 'active' && netBalance !== 0) {
      setConfirmConfig({
        title: "Settlement Required",
        message: `Outstanding balance: ${formatCurrency(Math.abs(netBalance))}. Would you like to add a final settlement transaction to bring the balance to zero?`,
        confirmLabel: "Settle Now",
        onConfirm: () => {
          const settleTx: DebtTransaction = {
            id: generateId(),
            amount: Math.abs(netBalance),
            date: format(new Date(), 'yyyy-MM-dd'),
            description: 'Final Settlement',
            type: netBalance > 0 ? 'repayment_received' : 'repayment_sent'
          };
          onUpdateDebt({
            ...debt,
            transactions: [...debt.transactions, settleTx],
            status: 'settled',
            updatedAt: Date.now()
          });
          setConfirmConfig(null);
        }
      });
      return;
    }

    onUpdateDebt({
      ...debt,
      status: 'settled',
      updatedAt: Date.now()
    });
  };

  const hasLent = debt.transactions.some(t => t.type === 'lent');
  const hasBorrowed = debt.transactions.some(t => t.type === 'borrowed');

  // Measure real navbar height (varies with safe-area-inset-top per device)
  const [navbarHeight, setNavbarHeight] = useState(56);
  useLayoutEffect(() => {
    const navbar = document.querySelector('.navbar') as HTMLElement | null;
    if (!navbar) return;
    const update = () => setNavbarHeight(navbar.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(navbar);
    return () => ro.disconnect();
  }, []);

  // Compact bar visibility — true when action buttons have scrolled out of view
  const actionsRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    const el = actionsRef.current;
    if (!el) return;
    const root = document.querySelector('.app-root');
    const observer = new IntersectionObserver(
      ([entry]) => setIsCompact(!entry.isIntersecting),
      { root, rootMargin: `-${navbarHeight}px 0px 0px 0px`, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [navbarHeight]);

  return (
    <>
      <div className="flex-col gap-6 fade-in" style={{ paddingBottom: '180px' }}>

        {/* Balance card + action buttons — scroll away normally */}
        <div className="flex-col gap-6 tour-debt-detail-summary">
          <div className="flex justify-between align-center debt-detail-header-row">
            <div className="flex align-center gap-4">
              <button className="btn btn-secondary" style={{ padding: '0.5rem' }} onClick={onBack}>
                <ChevronLeft size={20} />
              </button>
              <div className="flex-col">
                <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{debt.personName}</h2>
                <span className="text-xs text-muted uppercase font-bold text-mono">History</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                className="btn btn-secondary"
                style={{
                  width: '36px', height: '36px', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: debt.status === 'settled' ? 'var(--success)' : 'var(--text-muted)',
                  borderColor: debt.status === 'settled' ? 'var(--success)' : undefined,
                  background: debt.status === 'settled' ? 'var(--success-soft)' : undefined
                }}
                onClick={toggleSettled}
                title={debt.status === 'settled' ? "Re-open" : "Mark Settled"}
              >
                <Check size={18} strokeWidth={3} />
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => { setNameInput(debt.personName); setNameError(''); setIsEditingName(true); }}
                title="Edit Name"
              >
                <Edit2 size={18} />
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)' }}
                onClick={() => setConfirmConfig({
                  title: "Delete History?",
                  message: "Are you sure you want to delete the entire history with this person? This cannot be undone.",
                  confirmLabel: "Delete All",
                  isDanger: true,
                  onConfirm: () => { onDelete(); setConfirmConfig(null); }
                })}
                title="Delete History"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>

          <div className="card flex-col align-center gap-4" style={{ padding: '2rem 1.5rem', background: 'var(--bg-hover)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: '-20px', right: '-20px', opacity: 0.05 }}>
              <HandCoins size={120} />
            </div>
            <span className="text-xs text-muted font-bold uppercase" style={{ letterSpacing: '2px' }}>Current Net Balance</span>
            <h1 style={{ margin: 0, fontSize: '2.5rem', color: netBalance === 0 ? 'var(--text-primary)' : (netBalance > 0 ? 'var(--success)' : 'var(--danger)') }}>
              {formatCurrency(netBalance)}
            </h1>
            <div className="flex gap-2">
              {netBalance !== 0 && (
                <div className={`metric-pill ${netBalance > 0 ? 'border-success text-success' : 'border-danger text-danger'}`}>
                  {netBalance > 0 ? 'They owe you' : 'You owe them'}
                </div>
              )}
              {debt.status === 'settled' && (
                <div className="metric-pill border-muted text-muted">Settled</div>
              )}
            </div>
          </div>

          <div ref={actionsRef} className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
            <button className="btn btn-primary" onClick={() => setShowActionModal('lent')} style={{ background: 'var(--success)', border: 'none', color: '#000' }}>
              <ArrowUpRight size={18} /> Lent Money
            </button>
            <button className="btn btn-primary" onClick={() => setShowActionModal('borrowed')} style={{ background: 'var(--danger)', border: 'none', color: '#fff' }}>
              <ArrowDownLeft size={18} /> Borrowed
            </button>
            <button className="btn btn-secondary" onClick={() => setShowActionModal('repayment')} style={{ gridColumn: 'span 2' }}>
              <History size={18} /> Repayment
            </button>
          </div>
        </div>

        {/* Compact bar — fixed, slides in from behind navbar when action buttons leave viewport */}
        <div
          style={{
            position: 'fixed',
            top: navbarHeight,
            left: 0,
            right: 0,
            zIndex: 10,
            background: 'var(--bg-color)',
            borderBottom: '1px solid var(--border-color)',
            padding: '0.6rem 1.5rem',
            transform: isCompact ? 'translateY(0)' : 'translateY(-110%)',
            opacity: isCompact ? 1 : 0,
            transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease',
            pointerEvents: isCompact ? 'auto' : 'none',
          }}
        >
          <div className="flex justify-between align-center">
            <span className="font-bold" style={{ fontSize: '1rem' }}>{debt.personName}</span>
            <span className={`font-bold text-sm ${netBalance === 0 ? '' : (netBalance > 0 ? 'text-success' : 'text-danger')}`}>
              {formatCurrency(netBalance)}
            </span>
          </div>
        </div>

        <div className="flex-col gap-4 tour-debt-tx-log">
          <span className="text-xs text-muted font-bold uppercase" style={{ letterSpacing: '1px' }}>Transaction Log</span>
          <div className="flex-col gap-3">
            {[...debt.transactions].sort((a, b) => {
              const timeDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
              if (timeDiff !== 0) return timeDiff;
              return debt.transactions.indexOf(b) - debt.transactions.indexOf(a);
            }).map(tx => (
              <div key={tx.id} className="card flex align-center justify-between" style={{
                padding: '0.75rem 1rem',
                background: 'var(--bg-color)',
                opacity: tx.markedDone ? 0.45 : 1,
                transition: 'opacity 0.2s ease'
              }}>
                <div className="flex align-center gap-3" style={{ minWidth: 0, flex: 1 }}>
                  <div className="flex-center" style={{
                    width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
                    background: tx.markedDone ? 'rgba(120,120,120,0.1)' : ((tx.type === 'lent' || tx.type === 'repayment_received') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'),
                    color: tx.markedDone ? 'var(--text-muted)' : ((tx.type === 'lent' || tx.type === 'repayment_received') ? 'var(--success)' : 'var(--danger)')
                  }}>
                    {tx.markedDone ? <Check size={14} /> : (tx.type.includes('repayment') ? <History size={14} /> : (tx.type === 'lent' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />))}
                  </div>
                  <div className="flex-col" style={{ minWidth: 0 }}>
                    <span className="text-sm font-bold" style={{
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      textDecoration: tx.markedDone ? 'line-through' : 'none',
                      color: tx.markedDone ? 'var(--text-muted)' : undefined
                    }}>{tx.description}</span>
                    <span className="text-xs text-muted" style={{ fontSize: '10px' }}>{new Date(tx.date).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex align-center gap-3" style={{ flexShrink: 0, marginLeft: '0.5rem' }}>
                  <span className={`font-bold ${tx.markedDone ? 'text-muted' : ((tx.type === 'lent' || tx.type === 'repayment_received') ? 'text-success' : 'text-danger')}`} style={{
                    whiteSpace: 'nowrap',
                    textDecoration: tx.markedDone ? 'line-through' : 'none'
                  }}>
                    {formatCurrency(tx.amount)}
                  </span>
                  <div className="flex gap-3">
                    <button
                      className="btn btn-secondary flex-center"
                      style={{
                        width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: tx.markedDone ? 'var(--success)' : 'var(--text-muted)',
                        borderColor: tx.markedDone ? 'var(--success)' : undefined,
                        background: tx.markedDone ? 'var(--success-soft)' : undefined,
                      }}
                      title={tx.markedDone ? 'Unmark as done' : 'Mark as done'}
                      onClick={() => {
                        const updated = debt.transactions.map(t =>
                          t.id === tx.id ? { ...t, markedDone: !t.markedDone } : t
                        );
                        onUpdateDebt({ ...debt, transactions: updated, updatedAt: Date.now() });
                      }}
                    >
                      <Check size={14} strokeWidth={3} />
                    </button>
                    <button
                      className="btn btn-secondary flex-center"
                      style={{ width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onClick={() => setEditingTx(tx)}
                    >
                      <Edit2 size={14} className="text-muted" />
                    </button>
                    <button
                      className="btn btn-secondary flex-center"
                      style={{ width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onClick={() => {
                        const ledgerTx = data.transactions.find(t => t.linkedTransactionIds?.includes(tx.id));
                        const isLendingCategory = ledgerTx?.category === 'Lending & Borrowing';
                        setConfirmConfig({
                          title: (ledgerTx && !isLendingCategory) ? "Delete Linked Transaction?" : "Delete Transaction?",
                          message: (ledgerTx && !isLendingCategory)
                            ? "This record is linked to your Ledger. What would you like to do?"
                            : "Are you sure you want to delete this record?",
                          confirmLabel: (ledgerTx && !isLendingCategory) ? "Delete from Both" : "Delete",
                          thirdLabel: (ledgerTx && !isLendingCategory) ? "Remove from History Only" : undefined,
                          isDanger: true,
                          onConfirm: () => {
                            if (ledgerTx) deleteTransaction(ledgerTx.id);
                            const updatedTransactions = debt.transactions.filter(t => t.id !== tx.id);
                            if (updatedTransactions.length === 0) {
                              onDelete();
                            } else {
                              onUpdateDebt({ ...debt, transactions: updatedTransactions, status: calcDebtBalance(updatedTransactions) === 0 ? 'settled' : 'active', updatedAt: Date.now() });
                            }
                            setConfirmConfig(null);
                          },
                          onThirdAction: (ledgerTx && !isLendingCategory) ? () => {
                            updateTransaction({
                              ...ledgerTx,
                              linkedTransactionIds: ledgerTx.linkedTransactionIds?.filter(id => id !== tx.id)
                            });
                            const updatedTransactions = debt.transactions.filter(t => t.id !== tx.id);
                            if (updatedTransactions.length === 0) {
                              onDelete();
                            } else {
                              onUpdateDebt({ ...debt, transactions: updatedTransactions, status: calcDebtBalance(updatedTransactions) === 0 ? 'settled' : 'active', updatedAt: Date.now() });
                            }
                            setConfirmConfig(null);
                          } : undefined,
                          onCancel: () => setConfirmConfig(null)
                        });
                      }}
                    >
                      <Trash2 size={14} className="text-danger" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showActionModal && (
        <DebtTransactionModal
          type={showActionModal}
          personName={debt.personName}
          currentBalance={netBalance}
          hasLent={hasLent}
          hasBorrowed={hasBorrowed}
          accounts={data.accounts}
          onAdd={(amt, type, desc, date, accountId, logInLedger, linkedTxId) => { onAddTx(amt, type, desc, date, accountId, logInLedger, linkedTxId); setShowActionModal(null); }}
          onClose={() => setShowActionModal(null)}
        />
      )}

      {editingTx && (
        <DebtTransactionModal
          initialTx={editingTx}
          type={editingTx.type.includes('repayment') ? 'repayment' : (editingTx.type === 'lent' ? 'lent' : 'borrowed')}
          personName={debt.personName}
          currentBalance={netBalance}
          accounts={data.accounts}
          onAdd={(amt, type, desc, date, accountId, _logInLedger, linkedTxId) => {
            // Sync with ledger if linked
            const ledgerTx = data.transactions.find(t => t.linkedTransactionIds?.includes(editingTx.id));
            if (ledgerTx) {
              updateTransaction({
                ...ledgerTx,
                // Keep ledger amount and description as they are
                date,
                accountId
              });
            } else if (linkedTxId) {
              // If not in ledger yet, but we are linking to an existing one now
              const existingTx = data.transactions.find(t => t.id === linkedTxId);
              if (existingTx && !existingTx.linkedTransactionIds?.includes(editingTx.id)) {
                updateTransaction({
                  ...existingTx,
                  linkedTransactionIds: [...(existingTx.linkedTransactionIds || []), editingTx.id]
                });
              }
            }

            // Always update the debt record itself with all custom fields (amt, desc, etc)
            const updatedTxs = debt.transactions.map(t =>
              t.id === editingTx.id ? { ...t, amount: amt, type, description: desc, date, linkedTxId } : t
            );
            const balanced = calcDebtBalance(updatedTxs) === 0;
            const finalTxs = balanced ? updatedTxs.map(t => ({ ...t, markedDone: true })) : updatedTxs;
            onUpdateDebt({
              ...debt,
              transactions: finalTxs,
              status: balanced ? 'settled' : 'active',
              updatedAt: Date.now()
            });
            setEditingTx(null);
          }}
          onClose={() => setEditingTx(null)}
        />
      )}

      {isEditingName && (
        <div className="modal-overlay" onClick={() => setIsEditingName(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: 0 }}>
            <div className="modal-header">
              <h3>Edit Name</h3>
              <button onClick={() => setIsEditingName(false)}>✕</button>
            </div>
            <div className="modal-body flex-col gap-4" style={{ padding: '1rem 1.5rem 2rem' }}>
              <div className="input-group">
                <label>Person / Group Name</label>
                <input
                  className={`input-field ${nameError ? 'border-danger' : ''}`}
                  value={nameInput}
                  onChange={e => { setNameInput(e.target.value); setNameError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); }}
                  autoFocus
                />
                {nameError && <span className="text-xs text-danger">{nameError}</span>}
              </div>
              <button className="btn btn-primary" style={{ padding: '1rem' }} onClick={handleSaveName}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AddDebtModal({ existingNames, accounts, onAdd, onClose }: {
  existingNames: string[],
  accounts: Account[],
  onAdd: (name: string, amt: number, type: 'lent' | 'borrowed', desc: string, date: string, accountId: string, logInLedger: boolean, linkedTxId?: string) => void,
  onClose: () => void
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'lent' | 'borrowed'>('lent');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [logInLedger, setLogInLedger] = useState(true);
  const [isLinking, setIsLinking] = useState(false);
  const [linkedTxId, setLinkedTxId] = useState<string | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const suggestions = useMemo(() => {
    if (!name.trim()) return [];
    return existingNames.filter(n =>
      n.toLowerCase().includes(name.toLowerCase()) &&
      n.toLowerCase() !== name.toLowerCase()
    );
  }, [name, existingNames]);

  const exactMatch = existingNames.find(n => n.toLowerCase() === name.toLowerCase());

  const getAccountIcon = (accountId: string) => {
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return <Wallet size={18} />;
    return getAccountTypeIcon(acc.type);
  };

  const { data } = useFinance();
  const accountOptions = useMemo(() => {
    const currentMonth = getCurrentMonthStr();
    const TYPE_ORDER = ['bank_account', 'credit_card', 'debit_card', 'cash', 'e_wallet'];
    return accounts
      .filter(acc => !['stocks', 'sips', 'rewards', 'commodity'].includes(acc.type))
      .sort((a, b) => {
        const ai = TYPE_ORDER.indexOf(a.type);
        const bi = TYPE_ORDER.indexOf(b.type);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .map(acc => ({
        id: acc.id,
        name: acc.name,
        subtext: formatCurrency(calculateBalance(acc, data.transactions, currentMonth))
      }));
  }, [accounts, data.transactions]);

  const handleCreateRecord = () => {
    if (!name || !amount || (logInLedger && !accountId)) return;
    onAdd(name, parseFloat(amount), type, desc, date, accountId, logInLedger, linkedTxId || undefined);
  };

  return (
    <>
      <SubviewWrapper
        title="Add Log"
        onBack={onClose}
        footer={
          <button
            className="btn btn-primary w-100"
            style={{ padding: '1rem' }}
            disabled={!name || !amount || (logInLedger && !accountId)}
            onClick={handleCreateRecord}
          >
            Create Record
          </button>
        }
      >
        <div className="flex-col gap-6">
          <div className="input-group">
            <label>Person Name</label>
            <div className="flex align-center gap-3 input-field" style={{ borderColor: exactMatch ? 'var(--success)' : 'var(--border-color)' }}>
              <UserPlus size={20} className={exactMatch ? 'text-success' : 'text-muted'} />
              <input
                placeholder="Who is this?"
                value={name}
                onChange={e => setName(e.target.value)}
                style={{ background: 'none', border: 'none', outline: 'none', color: 'inherit', width: '100%' }}
              />
            </div>
            {exactMatch && (
              <span className="text-xs text-success font-bold" style={{ marginTop: '-0.25rem' }}>
                Existing person found
              </span>
            )}
            {suggestions.length > 0 && (
              <div className="flex gap-2 overflow-x-auto hide-scrollbar" style={{ marginTop: '0.25rem', paddingBottom: '0.5rem' }}>
                {suggestions.map(s => (
                  <button
                    key={s}
                    className="btn-secondary"
                    style={{
                      padding: '0.4rem 0.8rem',
                      fontSize: '10px',
                      whiteSpace: 'nowrap',
                      borderRadius: '6px',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      boxShadow: '2px 2px 0 #000'
                    }}
                    onClick={() => setName(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="input-group">
            <label>Transaction Type</label>
            <div className="flex gap-3 w-100">
              <button
                className="flex-col align-center justify-center gap-1"
                style={{
                  flex: 1,
                  height: "74px",
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0.5rem',
                  borderRadius: '6px',
                  background: type === 'lent' ? 'var(--success)' : 'var(--bg-hover)',
                  border: '1.5px solid #000',
                  boxShadow: type === 'lent' ? 'none' : '3px 3px 0 #000',
                  transform: type === 'lent' ? 'translate(3px, 3px)' : 'none',
                  color: type === 'lent' ? '#000' : 'var(--text-secondary)',
                  transition: 'all 0.1s ease',
                  cursor: 'pointer',
                  gap: '8px'
                }}
                onClick={() => setType('lent')}
              >
                <ArrowUpRight size={16} strokeWidth={3} />
                <span className="text-mono font-bold uppercase" style={{ fontSize: '9px', letterSpacing: '1px' }}>Lent Money</span>
              </button>
              <button
                className="flex-col align-center justify-center gap-1"
                style={{
                  flex: 1,
                  height: "74px",
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0.5rem',
                  borderRadius: '6px',
                  background: type === 'borrowed' ? 'var(--danger)' : 'var(--bg-hover)',
                  border: '1.5px solid #000',
                  boxShadow: type === 'borrowed' ? 'none' : '3px 3px 0 #000',
                  transform: type === 'borrowed' ? 'translate(3px, 3px)' : 'none',
                  color: type === 'borrowed' ? '#fff' : 'var(--text-secondary)',
                  transition: 'all 0.1s ease',
                  cursor: 'pointer',
                  gap: '8px'
                }}
                onClick={() => setType('borrowed')}
              >
                <ArrowDownLeft size={16} strokeWidth={3} />
                <span className="text-mono font-bold uppercase" style={{ fontSize: '9px', letterSpacing: '1px' }}>Borrowed</span>
              </button>
            </div>
          </div>

          <div className="input-group">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <button
                className="flex-col align-center justify-center"
                style={{
                  flex: 1,
                  height: "74px",
                  padding: '0.5rem',
                  background: logInLedger ? 'var(--success)' : 'var(--bg-hover)',
                  borderRadius: '6px',
                  border: '1.5px solid #000',
                  boxShadow: logInLedger ? 'none' : '3px 3px 0 #000',
                  transform: logInLedger ? 'translate(3px, 3px)' : 'none',
                  color: logInLedger ? '#000' : 'var(--text-secondary)',
                  transition: 'all 0.1s ease',
                  cursor: 'pointer',
                  gap: '8px'
                }}
                onClick={() => setLogInLedger(!logInLedger)}
              >
                <div className="flex align-center gap-2">
                  <History size={14} />
                  <span className="text-mono font-bold uppercase" style={{ fontSize: '9px', letterSpacing: '1px', lineHeight: 1, transform: 'translateY(1.5px)' }}>Log in Ledger</span>
                </div>
                <span className="text-mono" style={{ fontSize: '10px', opacity: 0.8 }}>Update balance</span>
              </button>

              <button
                className="flex-col align-center justify-center"
                style={{
                  flex: 1,
                  height: "74px",
                  padding: '0.5rem',
                  background: linkedTxId ? 'var(--success)' : 'var(--bg-hover)',
                  borderRadius: '6px',
                  border: '1.5px solid #000',
                  boxShadow: linkedTxId ? 'none' : '3px 3px 0 #000',
                  transform: linkedTxId ? 'translate(3px, 3px)' : 'none',
                  color: linkedTxId ? '#000' : 'var(--text-secondary)',
                  transition: 'all 0.1s ease',
                  cursor: 'pointer',
                  gap: '8px'
                }}
                onClick={() => linkedTxId ? setLinkedTxId(null) : setIsLinking(true)}
              >
                <div className="flex align-center gap-2">
                  {linkedTxId ? <CheckCircle2 size={14} /> : <History size={14} />}
                  <span className="text-mono font-bold uppercase" style={{ fontSize: '9px', letterSpacing: '1px', lineHeight: 1, transform: 'translateY(1.5px)' }}>
                    {linkedTxId ? 'Linked' : 'Link Ledger'}
                  </span>
                </div>
                <span className="text-mono" style={{ fontSize: '10px', opacity: 0.8 }}>{linkedTxId ? 'Click to clear' : 'Pick transaction'}</span>
              </button>
            </div>
          </div>

          <div className="input-group">
            <label>Amount</label>
            <input
              className="input-field"
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          </div>

          {logInLedger && (
            <CustomPicker
              label="Account"
              value={accountId}
              options={accountOptions}
              onChange={setAccountId}
              iconGetter={getAccountIcon}
            />
          )}

          <div className="input-group" onClick={() => setIsDatePickerOpen(true)}>
            <label>Date</label>
            <div className="input-field flex align-center justify-between gap-3 clickable">
              <span className="text-mono">{format(parseISO(date), 'EEE, d MMM yyyy')}</span>
              <Calendar size={18} className="text-muted" />
            </div>
          </div>

          <CustomDatePicker 
            isOpen={isDatePickerOpen}
            onClose={() => setIsDatePickerOpen(false)}
            value={date}
            onChange={setDate}
            label="Log Date"
          />

          <div className="input-group">
            <label>Description (Optional)</label>
            <input
              className="input-field"
              placeholder="What was it for?"
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />
          </div>
        </div>
      </SubviewWrapper>
      <TransactionSelector
        isOpen={isLinking}
        onClose={() => setIsLinking(false)}
        onSelect={(t) => {
          setAmount(t.amount.toString());
          setDesc(t.description || '');
          setDate(t.date);
          setAccountId(t.accountId);
          setLogInLedger(false);
          setLinkedTxId(t.id);
          setIsLinking(false);
        }}
      />
    </>
  );
}

function DebtTransactionModal({ initialTx, type, personName, currentBalance, hasLent, hasBorrowed, accounts, onAdd, onClose }: {
  initialTx?: DebtTransaction,
  type: 'lent' | 'borrowed' | 'repayment',
  personName: string,
  currentBalance: number,
  hasLent?: boolean,
  hasBorrowed?: boolean,
  accounts: Account[],
  onAdd: (amt: number, type: DebtTransaction['type'], txType: string, date: string, accountId: string, logInLedger: boolean, linkedTxId?: string) => void,
  onClose: () => void
}) {
  const { data } = useFinance();
  const ledgerTx = useMemo(() =>
    initialTx ? data.transactions.find(t => t.linkedTransactionIds?.includes(initialTx.id)) : null
    , [initialTx, data.transactions]);

  const [amount, setAmount] = useState(initialTx ? initialTx.amount.toString() : '');
  const [desc, setDesc] = useState(initialTx ? initialTx.description : '');
  const [repaymentType, setRepaymentType] = useState<'received' | 'sent'>(
    initialTx
      ? (initialTx.type === 'repayment_received' ? 'received' : 'sent')
      : (currentBalance > 0 ? 'received' : 'sent')
  );
  const [date, setDate] = useState(initialTx ? initialTx.date.split('T')[0] : format(new Date(), 'yyyy-MM-dd'));
  const [accountId, setAccountId] = useState(ledgerTx ? ledgerTx.accountId : (accounts[0]?.id || ''));
  const [logInLedger, setLogInLedger] = useState(initialTx ? !!ledgerTx : true);
  const [isLinking, setIsLinking] = useState(false);
  // If a ledgerTx already exists (auto-synced), don't also show the manual link as active
  const [linkedTxId, setLinkedTxId] = useState<string | null>(ledgerTx ? null : (initialTx?.linkedTxId || null));
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const getAccountIcon = (accountId: string) => {
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return <Wallet size={18} />;
    return getAccountTypeIcon(acc.type);
  };

  const accountOptions = useMemo(() => {
    const currentMonth = getCurrentMonthStr();
    const TYPE_ORDER = ['bank_account', 'credit_card', 'debit_card', 'cash', 'e_wallet'];
    return accounts
      .filter(acc => !['stocks', 'sips', 'rewards', 'commodity'].includes(acc.type))
      .sort((a, b) => {
        const ai = TYPE_ORDER.indexOf(a.type);
        const bi = TYPE_ORDER.indexOf(b.type);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .map(acc => ({
        id: acc.id,
        name: acc.name,
        subtext: formatCurrency(calculateBalance(acc, data.transactions, currentMonth))
      }));
  }, [accounts, data.transactions]);

  const handleAdd = () => {
    const numAmt = parseFloat(amount) || 0;
    if (numAmt <= 0) return;

    let txType: DebtTransaction['type'] = type as any;
    if (type === 'repayment') {
      txType = repaymentType === 'received' ? 'repayment_received' : 'repayment_sent';
    }
    const defaultDesc = type === 'lent' ? 'Lent money' : (type === 'borrowed' ? 'Borrowed money' : 'Repayment');
    onAdd(numAmt, txType, desc || defaultDesc, date, accountId, logInLedger, linkedTxId || undefined);
  };

  const newBalance = useMemo(() => {
    const numAmt = parseFloat(amount) || 0;
    const baseBalance = initialTx
      ? (initialTx.type === 'lent' || initialTx.type === 'repayment_sent' ? currentBalance - initialTx.amount : currentBalance + initialTx.amount)
      : currentBalance;

    if (type === 'repayment') {
      return repaymentType === 'received' ? baseBalance - numAmt : baseBalance + numAmt;
    }
    return type === 'lent' ? baseBalance + numAmt : baseBalance - numAmt;
  }, [type, repaymentType, currentBalance, amount, initialTx]);

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: 0 }}>
          <div className="modal-header">
            <h3>
              {initialTx ? 'Edit' : 'Add'} {type === 'repayment' ? 'Repayment' : (type === 'lent' ? 'Lent' : 'Borrowed')}
            </h3>
            <button onClick={onClose}>✕</button>
          </div>
          <div className="modal-body flex-col gap-3 no-scrollbar" style={{ padding: '1rem 1.5rem 2rem', overflowY: 'auto' }}>
            {type === 'repayment' && (
              <div className="input-group">
                <label>Repayment Direction</label>
                <div className="flex gap-3 w-100">
                  {(hasLent || currentBalance > 0 || (initialTx?.type === 'repayment_received')) && (
                    <button
                      className="flex-col align-center justify-center gap-1"
                      style={{
                        flex: 1,
                        height: "74px",
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        background: repaymentType === 'received' ? 'var(--success)' : 'var(--bg-hover)',
                        border: '1.5px solid #000',
                        boxShadow: repaymentType === 'received' ? 'none' : '3px 3px 0 #000',
                        transform: repaymentType === 'received' ? 'translate(3px, 3px)' : 'none',
                        color: repaymentType === 'received' ? '#000' : 'var(--text-secondary)',
                        transition: 'all 0.1s ease',
                        cursor: 'pointer',
                        gap: '8px'
                      }}
                      onClick={() => setRepaymentType('received')}
                    >
                      <ArrowDownLeft size={16} strokeWidth={3} />
                      <span className="text-mono font-bold uppercase" style={{ fontSize: '9px', letterSpacing: '1px' }}>I Received</span>
                    </button>
                  )}
                  {(hasBorrowed || currentBalance < 0 || (initialTx?.type === 'repayment_sent')) && (
                    <button
                      className="flex-col align-center justify-center gap-1"
                      style={{
                        flex: 1,
                        height: "74px",
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        background: repaymentType === 'sent' ? 'var(--danger)' : 'var(--bg-hover)',
                        border: '1.5px solid #000',
                        boxShadow: repaymentType === 'sent' ? 'none' : '3px 3px 0 #000',
                        transform: repaymentType === 'sent' ? 'translate(3px, 3px)' : 'none',
                        color: repaymentType === 'sent' ? '#fff' : 'var(--text-secondary)',
                        transition: 'all 0.1s ease',
                        cursor: 'pointer',
                        gap: '8px'
                      }}
                      onClick={() => setRepaymentType('sent')}
                    >
                      <ArrowUpRight size={16} strokeWidth={3} />
                      <span className="text-mono font-bold uppercase" style={{ fontSize: '9px', letterSpacing: '1px' }}>I Paid Back</span>
                    </button>
                  )}
                </div>

                <div className="flex-col gap-1" style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                  <span className="text-xs text-muted" style={{ fontStyle: 'italic' }}>
                    {repaymentType === 'received'
                      ? `${personName} is paying you. This reduces their debt.`
                      : `You are paying ${personName}. This reduces your debt.`
                    }
                  </span>
                  <div className="flex align-center gap-2" style={{ marginTop: '0.25rem' }}>
                    <span className="text-xs font-bold text-mono">{formatCurrency(currentBalance)}</span>
                    <ChevronRight size={10} className="text-muted" />
                    <span className="text-xs font-bold text-mono" style={{ color: newBalance === 0 ? 'var(--text-primary)' : (newBalance > 0 ? 'var(--success)' : 'var(--danger)') }}>
                      {formatCurrency(newBalance)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {initialTx ? (
              ledgerTx ? (
                <div className="input-group">
                  <label>Linked Ledger Transaction</label>
                  <div style={{ padding: '0.75rem 1rem', background: 'rgba(56,189,248,0.06)', borderRadius: '8px', border: '1px solid rgba(56,189,248,0.2)' }}>
                    <div className="flex justify-between align-center" style={{ marginBottom: '0.35rem' }}>
                      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{ledgerTx.description}</span>
                      <span className="text-sm font-bold text-accent">{formatCurrency(ledgerTx.amount)}</span>
                    </div>
                    <div className="flex justify-between align-center">
                      <span className="text-xs text-muted">{format(parseISO(ledgerTx.date), 'dd MMM yyyy')}</span>
                      <span className="text-xs text-muted">{data.accounts.find(a => a.id === ledgerTx.accountId)?.name ?? '—'}</span>
                    </div>
                    {ledgerTx.description !== initialTx.description && (
                      <div className="flex align-center gap-1" style={{ marginTop: '0.4rem' }}>
                        <History size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <span className="text-xs text-muted" style={{ fontStyle: 'italic' }}>Debt entry: "{initialTx.description}"</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="input-group">
                  <label>Ledger Link</label>
                  <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-hover)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                    <span className="text-xs text-muted">No ledger transaction linked to this entry.</span>
                  </div>
                </div>
              )
            ) : (
              <div className="input-group">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <button
                    className="flex-col align-center justify-center"
                    style={{
                      flex: 1,
                      height: "74px",
                      padding: '0.5rem',
                      background: logInLedger ? 'var(--success)' : 'var(--bg-hover)',
                      borderRadius: '6px',
                      border: '1.5px solid #000',
                      boxShadow: logInLedger ? 'none' : '3px 3px 0 #000',
                      transform: logInLedger ? 'translate(3px, 3px)' : 'none',
                      color: logInLedger ? '#000' : 'var(--text-secondary)',
                      transition: 'all 0.1s ease',
                      cursor: 'pointer',
                      gap: '8px'
                    }}
                    onClick={() => setLogInLedger(!logInLedger)}
                  >
                    <div className="flex align-center gap-2">
                      <History size={14} />
                      <span className="text-mono font-bold uppercase" style={{ fontSize: '9px', letterSpacing: '1px', lineHeight: 1, transform: 'translateY(1.5px)' }}>Log in Ledger</span>
                    </div>
                    <span className="text-mono" style={{ fontSize: '10px', opacity: 0.8 }}>Update balance</span>
                  </button>

                  <button
                    className="flex-col align-center justify-center"
                    style={{
                      flex: 1,
                      height: "74px",
                      padding: '0.5rem',
                      background: linkedTxId ? 'var(--success)' : 'var(--bg-hover)',
                      borderRadius: '6px',
                      border: '1.5px solid #000',
                      boxShadow: linkedTxId ? 'none' : '3px 3px 0 #000',
                      transform: linkedTxId ? 'translate(3px, 3px)' : 'none',
                      color: linkedTxId ? '#000' : 'var(--text-secondary)',
                      transition: 'all 0.1s ease',
                      cursor: 'pointer',
                      gap: '8px'
                    }}
                    onClick={() => linkedTxId ? setLinkedTxId(null) : setIsLinking(true)}
                  >
                    <div className="flex align-center gap-2">
                      {linkedTxId ? <CheckCircle2 size={14} /> : <History size={14} />}
                      <span className="text-mono font-bold uppercase" style={{ fontSize: '9px', letterSpacing: '1px', lineHeight: 1, transform: 'translateY(1.5px)' }}>
                        {linkedTxId ? 'Linked' : 'Link Ledger'}
                      </span>
                    </div>
                    <span className="text-mono" style={{ fontSize: '10px', opacity: 0.8 }}>{linkedTxId ? 'Click to clear' : 'Pick transaction'}</span>
                  </button>
                </div>
              </div>
            )}

            <div className="input-group">
              <label>Amount</label>
              <input
                className="input-field"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>

            {logInLedger && (
              <CustomPicker
                label="Account"
                value={accountId}
                options={accountOptions}
                onChange={setAccountId}
                iconGetter={getAccountIcon}
              />
            )}

            <div className="input-group" onClick={() => setIsDatePickerOpen(true)}>
              <label>Date</label>
              <div className="input-field flex align-center justify-between gap-3 clickable">
                <span className="text-mono">{format(parseISO(date), 'EEE, d MMM yyyy')}</span>
                <Calendar size={18} className="text-muted" />
              </div>
            </div>

            <CustomDatePicker 
              isOpen={isDatePickerOpen}
              onClose={() => setIsDatePickerOpen(false)}
              value={date}
              onChange={setDate}
              label="Transaction Date"
            />

            <div className="input-group">
              <label>Description (Optional)</label>
              <input
                className="input-field"
                placeholder="What was it for?"
                value={desc}
                onChange={e => setDesc(e.target.value)}
              />
            </div>

            <button
              className="btn btn-primary"
              style={{ marginTop: 'auto', padding: '1rem' }}
              disabled={!amount || (logInLedger && !accountId)}
              onClick={handleAdd}
            >
              {initialTx ? 'Save Changes' : 'Log Transaction'}
            </button>
          </div>
        </div>
      </div>
      <TransactionSelector
        isOpen={isLinking}
        onClose={() => setIsLinking(false)}
        onSelect={(t) => {
          setAmount(t.amount.toString());
          setDesc(t.description || '');
          setDate(t.date);
          setAccountId(t.accountId);
          setLogInLedger(false);
          setLinkedTxId(t.id);
          setIsLinking(false);
        }}
      />
    </>
  );
}
