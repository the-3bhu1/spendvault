import React, { useState, useRef, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '../FinanceContext';
import type { Transaction, TransactionType, Account } from '../types';
import { generateId, formatCurrency, formatDateString, getBillingCycleForDate, calculateBalance, getCurrentMonthStr } from '../utils';
import { ShoppingBag, Utensils, Zap, Car, HeartPulse, Film, CreditCard, Wallet, ArrowRightLeft, MoreHorizontal, Coins, BadgeDollarSign, Calendar, Activity, X, Search, Home, Gift, Landmark, Smartphone, Sparkles, ChevronRight } from 'lucide-react';
import { CustomPicker } from './CustomPicker';
import CustomDatePicker from './CustomDatePicker';
import ConfirmDialog from './ConfirmDialog';


const getCategoryIcon = (category: string) => {
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

function TransactionRow({ tx, acc, isFirst, isLast, onEdit, onDelete, onMoveUp, onMoveDown }: {
  tx: Transaction,
  acc: Account | undefined,
  isFirst: boolean,
  isLast: boolean,
  onEdit: (tx: Transaction) => void,
  onDelete: (id: string) => void,
  onMoveUp: () => void,
  onMoveDown: () => void
}) {
  const [swipeX, setSwipeX] = useState(0);
  const [swipeY, setSwipeY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStart = useRef({ x: 0, y: 0, time: 0, dir: 'none' });
  const reorderTimer = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const isTouch = 'touches' in e;
    const touch = isTouch ? (e as React.TouchEvent).touches[0] : (e as React.MouseEvent);
    touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now(), dir: 'none' };

    if (reorderTimer.current) clearTimeout(reorderTimer.current);
    setIsDragging(false);

    reorderTimer.current = window.setTimeout(() => {
      setIsDragging(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
    }, 450);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;

    if (!isDragging) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        if (reorderTimer.current) {
          clearTimeout(reorderTimer.current);
          reorderTimer.current = null;
        }
      }

      if (touchStart.current.dir === 'none') {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          touchStart.current.dir = 'horizontal';
        } else if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          touchStart.current.dir = 'vertical';
        }
      }

      if (touchStart.current.dir === 'horizontal') {
        setSwipeX(dx);
      }
      setSwipeY(dy);
    } else {
      e.preventDefault();
      const rowHeight = rowRef.current?.offsetHeight || 60;
      if (dy > rowHeight * 0.9 && !isLast) {
        onMoveDown();
        touchStart.current.y = touch.clientY;
      } else if (dy < -rowHeight * 0.9 && !isFirst) {
        onMoveUp();
        touchStart.current.y = touch.clientY;
      }
    }
  };

  const handleTouchEnd = () => {
    if (reorderTimer.current) {
      clearTimeout(reorderTimer.current);
      reorderTimer.current = null;
    }
    const duration = Date.now() - touchStart.current.time;
    // Require a slightly longer press or very still tap to open edit
    const isQuickTap = duration < 300 && Math.abs(swipeX) < 5 && Math.abs(swipeY) < 5 && !isDragging;
    if (isQuickTap) {
      onEdit(tx);
    }
    if (swipeX > 150) {
      onDelete(tx.id);
    }
    setSwipeX(0);
    setSwipeY(0);
    setIsDragging(false);
  };

  useEffect(() => {
    if (!isDragging) return;

    // For Native WebViews (Capacitor), explicitly lock the scroll container
    const appRoot = document.querySelector('.app-root');
    if (appRoot) appRoot.classList.add('no-scroll');

    const preventScroll = (e: TouchEvent) => {
      e.preventDefault();
    };
    document.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      if (appRoot) appRoot.classList.remove('no-scroll');
      document.removeEventListener('touchmove', preventScroll);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => handleTouchStart(e);
  const handleMouseUp = () => handleTouchEnd();

  return (
    <div
      ref={rowRef}
      className={`fade-in ${isDragging ? 'is-dragging' : ''}`}
      style={{
        transform: isDragging ? undefined : `translateX(${swipeX}px)`,
        background: swipeX > 100 ? 'rgba(239, 68, 68, 0.2)' : undefined,
        transition: (swipeX === 0 && !isDragging) ? 'all 0.3s ease' : 'none',
        position: 'relative',
        userSelect: 'none',
        touchAction: isDragging ? 'none' : 'pan-y',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--border-color)',
        padding: '0.6rem 1rem',
        opacity: 0.95
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="flex align-center" style={{ gap: '1rem', flex: 1, minWidth: 0 }}>
        <div className="badge-scalloped">
          {getCategoryIcon(tx.category)}
        </div>
        <div className="flex-col min-width-0">
          <div className="flex align-center gap-2">
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }} className="truncate">
              {tx.description}
            </span>
            {tx.excludeFromStats && (
              <div title="Excluded from stats" style={{ opacity: 0.4 }}>
                <Activity size={12} style={{ transform: 'rotate(90deg)' }} />
              </div>
            )}
          </div>
          <div className="flex align-center gap-2" style={{ marginTop: '2px' }}>
            <span className="text-mono text-muted text-xs truncate" style={{ fontWeight: 600 }}>{acc?.name || 'Unknown'}</span>
            <span className="metric-pill truncate">{tx.category}</span>
          </div>
        </div>
      </div>

      <div className="flex-col align-end" style={{ flexShrink: 0, marginLeft: '1rem' }}>
        <span className="text-mono" style={{ fontWeight: 800, fontSize: '1rem', color: tx.type === 'credit' ? '#10b981' : '#ef4444' }}>
          {tx.type === 'credit' ? '+' : '-'}{formatCurrency(tx.amount)}
        </span>
        {acc?.isNcmcEnabled && tx.isTravelTransaction && <span className="metric-pill" style={{ marginTop: '6px', backgroundColor: 'var(--accent)', color: 'var(--bg-color)', borderColor: 'var(--accent)' }}>TRAVEL</span>}
      </div>

      {swipeX > 50 && (
        <div style={{
          position: 'absolute',
          left: -swipeX,
          height: '100%',
          width: swipeX,
          background: 'var(--danger)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingRight: '1rem',
          color: 'white',
          fontWeight: 800,
          fontSize: '0.75rem',
          letterSpacing: '1px',
          fontFamily: 'var(--font-mono)'
        }}>
          DELETE
        </div>
      )}
    </div>
  );
}

export default function Transactions() {
  const { data, pendingTransfer, setPendingTransfer, smsQueue, removeFromSmsQueue, removeSmsByMatch, addTransaction, updateTransaction, reorderTransactions, deleteTransaction } = useFinance();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [processingSms, setProcessingSms] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const processNextSms = () => {
    if (smsQueue.length > 0 && !isModalOpen) {
      const tx = smsQueue[0];
      const { amount, type, merchant, source, sourceIdentifier, timestamp } = tx;

      const matchedAccount = data.accounts.find(a => {
        if (sourceIdentifier && a.cardDetails?.cardNumber?.endsWith(sourceIdentifier)) return true;
        const normalizedSourceName = source.toLowerCase().replace(/\s+bank$/i, '').trim();
        const normalizedAccountName = a.name.toLowerCase().replace(/\s+bank$/i, '').trim();
        return normalizedAccountName.includes(normalizedSourceName) || normalizedSourceName.includes(normalizedAccountName);
      });

      setEditId(null);
      const initialTx: Partial<Transaction> = {
        date: format(new Date(timestamp), 'yyyy-MM-dd'),
        description: merchant || `Transaction via ${source}`,
        accountId: matchedAccount?.id || '',
        type: type === 'unknown' ? 'debit' : type,
        amount: amount,
        category: '',
        isRecurring: false,
        rewardEarned: 0,
        rewardEarnedType: 'delayed',
        rewardEarnedAccountId: '',
        rewardUsed: 0,
        rewardUsedAccountId: '',
        isTravelTransaction: false,
        excludeFromStats: false
      };
      setNewTx(initialTx);
      syncInputStrings(initialTx);
      setIsModalOpen(true);
      setProcessingSms(true);
    }
  };

  useEffect(() => {
    if (pendingTransfer) {
      // Find the first available bank account to suggest as destination
      const bankAcc = data.accounts.find(a => a.type === 'bank_account');

      setEditId(null);
      const initialTx: Partial<Transaction> = {
        date: format(new Date(), 'yyyy-MM-dd'),
        description: `Liquidate ${data.accounts.find(a => a.id === pendingTransfer.fromAccountId)?.name} to Bank`,
        accountId: bankAcc?.id || '',
        type: 'credit',
        amount: pendingTransfer.amount,
        category: 'Transfer',
        isRecurring: false,
        rewardEarned: 0,
        rewardEarnedType: 'delayed',
        rewardEarnedAccountId: '',
        rewardUsed: 0,
        rewardUsedAccountId: '',
        isTravelTransaction: false
      };
      setNewTx(initialTx);
      syncInputStrings(initialTx);
      setPaymentSourceAccountId(pendingTransfer.fromAccountId);
      setCcPaymentCycleTarget('previous_statement');
      setIsModalOpen(true);

      // Clear the pending state so it doesn't re-trigger
      setPendingTransfer(null);
    }
  }, [pendingTransfer]);

  const [newTx, setNewTx] = useState<Partial<Transaction>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
    accountId: '',
    type: 'debit',
    amount: 0,
    category: '',
    isRecurring: false,
    rewardEarned: 0,
    rewardEarnedType: 'delayed',
    rewardEarnedAccountId: '',
    rewardUsed: 0,
    rewardUsedAccountId: '',
    excludeFromStats: false,
  });

  const [inputStrings, setInputStrings] = useState({
    amount: '',
    rewardEarned: '',
    rewardUsed: '',
    excludedAmount: ''
  });

  const syncInputStrings = (tx: Partial<Transaction>) => {
    setInputStrings({
      amount: tx.amount === 0 ? '' : (tx.amount?.toString() || ''),
      rewardEarned: (tx.rewardEarned === 0 || tx.rewardEarned === undefined) ? '' : tx.rewardEarned.toString(),
      rewardUsed: (tx.rewardUsed === 0 || tx.rewardUsed === undefined) ? '' : tx.rewardUsed.toString(),
      excludedAmount: (tx.excludedAmount === 0 || tx.excludedAmount === undefined) ? '' : tx.excludedAmount.toString()
    });
  };
  const [paymentSourceAccountId, setPaymentSourceAccountId] = useState('');
  const [ccPaymentCycleTarget, setCcPaymentCycleTarget] = useState<'current_cycle' | 'previous_statement'>('previous_statement');
  const [selectedCashbackLevelId, setSelectedCashbackLevelId] = useState('');
  const [showRewardSplit, setShowRewardSplit] = useState(false);
  const rewardSplitRef = useRef<HTMLDivElement>(null);
  const passiveLogRef = useRef<HTMLDivElement>(null);

  const [descriptionSuggestions, setDescriptionSuggestions] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resolveCcPaymentCycle = (date: string, statementDay?: number) => {
    const safeStatementDay = statementDay || 1;
    const currentCycle = getBillingCycleForDate(date, safeStatementDay);

    if (ccPaymentCycleTarget === 'current_cycle') {
      return currentCycle;
    }

    const currentCycleDate = new Date(`${currentCycle}-01`);
    currentCycleDate.setMonth(currentCycleDate.getMonth() - 1);
    return `${currentCycleDate.getFullYear()}-${(currentCycleDate.getMonth() + 1).toString().padStart(2, '0')}`;
  };

  const handleDescriptionChange = (val: string) => {
    setNewTx(prev => ({ ...prev, description: val }));
    if (errors.description) setErrors(prev => ({ ...prev, description: '' }));
    if (val.trim().length < 2) {
      setDescriptionSuggestions([]);
      return;
    }

    const uniqueDescs = Array.from(new Set(data.transactions.map(t => t.description)));
    const matches = uniqueDescs
      .filter(d => d.toLowerCase().includes(val.toLowerCase()) && d.toLowerCase() !== val.toLowerCase())
      .slice(0, 5);
    setDescriptionSuggestions(matches);
  };

  const selectSuggestion = (suggestion: string) => {
    const pastTx = data.transactions
      .filter(t => t.description === suggestion)
      .sort((a, b) => {
        const dateComparison = b.date.localeCompare(a.date);
        if (dateComparison !== 0) return dateComparison;
        return (b.order ?? 0) - (a.order ?? 0);
      })[0];

    const isAmountUnselected = !newTx.amount || newTx.amount === 0;
    const isCategoryUnselected = !newTx.category;
    const isAccountIdUnselected = !newTx.accountId;
    const isTypeUnselected = !processingSms; // SMS-detected transactions already have their type selected
    const isTravelUnselected = !newTx.isTravelTransaction;

    const updatedTx = {
      ...newTx,
      description: suggestion,
      amount: !isAmountUnselected ? (newTx.amount ?? 0) : (pastTx?.amount ?? newTx.amount ?? 0),
      category: !isCategoryUnselected ? (newTx.category || '') : (pastTx?.category || newTx.category || ''),
      accountId: !isAccountIdUnselected ? (newTx.accountId || '') : (pastTx?.accountId || newTx.accountId || ''),
      type: !isTypeUnselected ? (newTx.type || 'debit') : (pastTx?.type || newTx.type || 'debit'),
      isTravelTransaction: !isTravelUnselected ? (newTx.isTravelTransaction ?? false) : (pastTx?.isTravelTransaction ?? newTx.isTravelTransaction ?? false)
    };
    setNewTx(updatedTx);
    syncInputStrings(updatedTx);
    setDescriptionSuggestions([]);
  };

  const getAccountIcon = (accId: string) => {
    if (accId === 'all') return <Activity size={18} />;
    const acc = data.accounts.find(a => a.id === accId);
    if (!acc) return <Wallet size={18} />;

    switch (acc.type) {
      case 'credit_card':
      case 'debit_card':
        return <CreditCard size={18} />;
      case 'bank_account':
        return <Landmark size={18} />;
      case 'e_wallet':
        return <Smartphone size={18} />;
      case 'rewards':
        return <Gift size={18} />;
      case 'cash':
        return <Coins size={18} />;
      default:
        return <Wallet size={18} />;
    }
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  // Filters state
  const [filterType, setFilterType] = useState<'all' | 'debit' | 'credit'>('all');
  const [filterAccountId, setFilterAccountId] = useState<string[]>(['all']);
  const [filterCategory, setFilterCategory] = useState<string[]>(['all']);
  const [filterMonth, setFilterMonth] = useState<string[]>(['all']);
  const [searchQuery, setSearchQuery] = useState('');

  const [showFilters, setShowFilters] = useState(false);

  const handleSave = () => {
    console.log("=== handleSave TRIGGERED ===");
    console.log("newTx State:", newTx);
    const newErrors: Record<string, string> = {};
    if (!newTx.date) newErrors.date = 'Date is required';
    if (!newTx.description) newErrors.description = 'Description is required';
    if (!newTx.amount) newErrors.amount = 'Amount is required';
    if (!newTx.accountId) newErrors.accountId = 'Account is required';
    if (!newTx.category) newErrors.category = 'Category is required';
    if (newTx.excludeFromStats && (newTx.excludedAmount || 0) > (newTx.amount || 0)) {
      newErrors.excludedAmount = 'Cannot exclude more than total amount';
    }

    if (newTx.accountId && newTx.type === 'debit' && !newTx.isTravelTransaction && newTx.category?.toLowerCase() === 'ncmc travel recharge') {
      const account = data.accounts.find(a => a.id === newTx.accountId);
      if (account?.isNcmcEnabled) {
        const currentMonth = getCurrentMonthStr();
        const currentBalance = calculateBalance(account, data.transactions, currentMonth, false);
        const transferAmount = Number(newTx.amount) || 0;

        let availableBalance = currentBalance;
        if (editId) {
          const oldTx = data.transactions.find(t => t.id === editId);
          if (oldTx && oldTx.accountId === account.id && oldTx.type === 'debit' && !oldTx.isTravelTransaction) {
            availableBalance += oldTx.amount;
          }
        }

        const roundedAmount = Math.round(transferAmount * 100) / 100;
        const roundedBalance = Math.round(availableBalance * 100) / 100;

        if (roundedAmount > roundedBalance) {
          newErrors.amount = `Insufficient balance. Available Payments balance is ${formatCurrency(availableBalance)}`;
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      console.log("Validation Failed! newErrors:", newErrors);
      setErrors(newErrors);
      return;
    }
    console.log("Validation Passed! Saving transaction...");
    setErrors({});

    const account = data.accounts.find(a => a.id === newTx.accountId);
    const ccPaymentAppliedCycle = account?.type === 'credit_card' && newTx.type === 'credit'
      ? resolveCcPaymentCycle(newTx.date as string, account.statementDay)
      : undefined;

    let finalCategory = newTx.category;
    const mainTxId = editId || generateId();
    let currentLinkedIds: string[] = [];

    if (editId) {
      const existingTx = data.transactions.find(t => t.id === editId);
      currentLinkedIds = existingTx?.linkedTransactionIds || (existingTx?.linkedTransactionId ? [existingTx.linkedTransactionId] : []);
    }

    const isTransfer = newTx.category?.toLowerCase() === 'transfer';
    const isCCPayment = newTx.category?.toLowerCase() === 'cc payment';

    if ((isTransfer || isCCPayment) && paymentSourceAccountId && !editId) {
      const bankCounterpartId = generateId();
      currentLinkedIds.push(bankCounterpartId);
      const destAccount = data.accounts.find(a => a.id === paymentSourceAccountId);
      const counterpartType = newTx.type === 'credit' ? 'debit' : 'credit';

      let counterpartDesc = '';
      if (isCCPayment) {
        if (counterpartType === 'credit') {
          counterpartDesc = 'CC Bill Payment';
        } else {
          const targetCardName = newTx.type === 'credit' ? account?.name : destAccount?.name;
          counterpartDesc = `CC Payment: ${targetCardName || 'Unknown'}`;
        }
      } else {
        counterpartDesc = newTx.type === 'credit' ? `Transfer to ${account?.name}` : `Transfer from ${account?.name}`;
      }

      const rewardUsedForTransfer = showRewardSplit ? (Number(newTx.rewardUsed) || 0) : 0;
      const bankPortion = Number(newTx.amount) - rewardUsedForTransfer;

      addTransaction({
        id: bankCounterpartId,
        date: newTx.date as string,
        description: counterpartDesc,
        accountId: paymentSourceAccountId,
        type: counterpartType,
        amount: bankPortion,
        category: isCCPayment ? 'CC Payment' : 'Transfer',
        isRecurring: false,
        linkedTransactionIds: [mainTxId],
        appliedBillingCycleYearMonth: isCCPayment && counterpartType === 'credit' && destAccount?.type === 'credit_card'
          ? resolveCcPaymentCycle(newTx.date as string, destAccount.statementDay)
          : undefined
      });

      if (isCCPayment && newTx.type === 'credit') finalCategory = 'CC Payment';
    }

    const rewardUsed = showRewardSplit ? (Number(newTx.rewardUsed) || 0) : 0;
    if (rewardUsed > 0 && newTx.rewardUsedAccountId && !editId) {
      const rewardCounterpartId = generateId();
      currentLinkedIds.push(rewardCounterpartId);
      addTransaction({
        id: rewardCounterpartId,
        date: newTx.date as string,
        description: isCCPayment ? `Rewards used for ${account?.name || 'CC'}` : `Rewards applied to: ${newTx.description}`,
        accountId: newTx.rewardUsedAccountId,
        type: 'debit',
        amount: rewardUsed,
        category: isCCPayment ? 'CC Payment' : (newTx.category as string),
        isRecurring: false,
        linkedTransactionIds: [mainTxId]
      });
    }

    const mainAccountAmount = (newTx.type === 'debit')
      ? Math.max(0, Number(newTx.amount) - rewardUsed)
      : Number(newTx.amount);

    if (newTx.rewardEarnedType === 'instant' && (newTx.rewardEarned || 0) > 0 && newTx.rewardEarnedAccountId && !editId) {
      const instantCbId = generateId();
      currentLinkedIds.push(instantCbId);
      addTransaction({
        id: instantCbId,
        date: newTx.date as string,
        description: `Instant Cashback: ${newTx.description}`,
        accountId: newTx.rewardEarnedAccountId,
        type: 'credit',
        amount: Number(newTx.rewardEarned),
        category: 'Cashback',
        isRecurring: false,
        linkedTransactionIds: [mainTxId]
      });
    }

    if (account?.isNcmcEnabled && newTx.type === 'credit' && newTx.isTravelTransaction && !editId && !paymentSourceAccountId) {
      const counterpartId = generateId();
      currentLinkedIds.push(counterpartId);
      addTransaction({
        id: counterpartId,
        date: newTx.date as string,
        description: `Transfer to Travel Wallet`,
        accountId: account.id,
        type: 'debit',
        amount: Number(newTx.amount),
        category: finalCategory === 'NCMC Travel Recharge' ? 'NCMC Travel Recharge' : 'Transfer',
        isRecurring: false,
        isTravelTransaction: false,
        linkedTransactionIds: [mainTxId]
      });
    }

    if (account?.isNcmcEnabled && newTx.type === 'debit' && !newTx.isTravelTransaction && finalCategory === 'NCMC Travel Recharge' && !editId) {
      const counterpartId = generateId();
      currentLinkedIds.push(counterpartId);
      addTransaction({
        id: counterpartId,
        date: newTx.date as string,
        description: `NCMC Travel Recharge`,
        accountId: account.id,
        type: 'credit',
        amount: Number(newTx.amount),
        category: 'NCMC Travel Recharge',
        isRecurring: false,
        isTravelTransaction: true,
        linkedTransactionIds: [mainTxId]
      });
    }

    let finalRewardEarned = Number(newTx.rewardEarned) || 0;
    if (newTx.rewardEarnedType === 'delayed' && !finalRewardEarned) {
      if ((account?.type === 'credit_card' || account?.type === 'debit_card') && newTx.type === 'debit' && !newTx.isTravelTransaction && finalCategory !== 'Transfer' && finalCategory !== 'CC Payment' && finalCategory !== 'NCMC Travel Recharge') {
        const selectedCbObj = account.cashbackRates?.find(r => r.id === selectedCashbackLevelId);

        let rateToUse = 0;
        let shouldRoundOff = account.roundOffCashback;

        if (selectedCbObj) {
          rateToUse = selectedCbObj.rate;
          shouldRoundOff = selectedCbObj.roundOffCashback;
        } else if (selectedCashbackLevelId === 'default') {
          rateToUse = account.defaultCashbackRate || 0;
        }

        finalRewardEarned = (newTx.amount! * (rateToUse || 0)) / 100;
        if (shouldRoundOff) finalRewardEarned = Math.floor(finalRewardEarned);
      }
    }

    const finalTx: Transaction = {
      id: mainTxId,
      date: newTx.date as string,
      description: (newTx.description as string || '').trim(),
      accountId: newTx.accountId as string,
      type: newTx.type as TransactionType,
      amount: mainAccountAmount,
      category: finalCategory as string,
      isRecurring: newTx.isRecurring || false,
      appliedBillingCycleYearMonth: ccPaymentAppliedCycle,
      rewardEarned: finalRewardEarned,
      rewardEarnedType: newTx.rewardEarnedType,
      rewardEarnedAccountId: newTx.rewardEarnedAccountId,
      rewardUsed: rewardUsed,
      rewardUsedAccountId: newTx.rewardUsedAccountId,
      isTravelTransaction: newTx.isTravelTransaction,
      linkedTransactionIds: currentLinkedIds,
      cashbackLevelId: selectedCashbackLevelId,
      excludeFromStats: newTx.excludeFromStats,
      excludedAmount: newTx.excludeFromStats ? newTx.excludedAmount : undefined,
      paymentSourceAccountId: paymentSourceAccountId,
      order: newTx.order
    };

    if (editId) {
      updateTransaction(finalTx);
    } else {
      addTransaction(finalTx);
    }

    const resetTx: Partial<Transaction> = {
      date: format(new Date(), 'yyyy-MM-dd'),
      description: '', accountId: '', type: 'debit', amount: 0, category: '', isRecurring: false,
      rewardEarned: 0, rewardEarnedType: 'delayed', rewardEarnedAccountId: '',
      rewardUsed: 0, rewardUsedAccountId: '',
      isTravelTransaction: false
    };
    setNewTx(resetTx);
    syncInputStrings(resetTx);
    setPaymentSourceAccountId('');
    setCcPaymentCycleTarget('previous_statement');
    setSelectedCashbackLevelId('');
    setShowRewardSplit(false);
    setEditId(null);
    setErrors({});
    if (processingSms) {
      removeFromSmsQueue(0);
      setProcessingSms(false);
    }

    // Auto-sweep duplicate counterpart SMS generated by Transfer / CC Payment
    if ((isTransfer || isCCPayment) && paymentSourceAccountId && !editId) {
      const rewardUsedForTransfer = showRewardSplit ? (Number(newTx.rewardUsed) || 0) : 0;
      const bankPortion = Number(newTx.amount) - rewardUsedForTransfer;
      const counterpartType = newTx.type === 'credit' ? 'debit' : 'credit';
      removeSmsByMatch(bankPortion, counterpartType, paymentSourceAccountId);
    }

    setIsModalOpen(false);
  };

  const openAddModal = () => {
    setEditId(null);
    const initialTx: Partial<Transaction> = {
      date: format(new Date(), 'yyyy-MM-dd'),
      description: '', accountId: '', type: 'debit', amount: 0, category: '', isRecurring: false,
      rewardEarned: 0, rewardEarnedType: 'delayed', rewardEarnedAccountId: '',
      rewardUsed: 0, rewardUsedAccountId: '',
      excludeFromStats: false,
    };
    setNewTx(initialTx);
    syncInputStrings(initialTx);
    setPaymentSourceAccountId('');
    setCcPaymentCycleTarget('previous_statement');
    setShowRewardSplit(false);
    setIsModalOpen(true);
  };

  const openEditModal = (tx: Transaction) => {
    setEditId(tx.id);
    const sanitizedTx = {
      ...tx,
      date: tx.date.split('T')[0],
      type: (tx.type as string) === 'expense' ? 'debit' : ((tx.type as string) === 'income' ? 'credit' : tx.type)
    };
    setNewTx(sanitizedTx);

    // Find linked counterpart account (Transfer/CC payment)
    const linkedIds = tx.linkedTransactionIds || (tx.linkedTransactionId ? [tx.linkedTransactionId] : []);
    const counterpartTx = data.transactions.find(t =>
      linkedIds.includes(t.id) &&
      t.id !== tx.id &&
      t.category !== 'Cashback' &&
      t.accountId !== tx.rewardUsedAccountId
    );
    if (counterpartTx) {
      setPaymentSourceAccountId(counterpartTx.accountId);
    } else {
      setPaymentSourceAccountId('');
    }
    const account = data.accounts.find(a => a.id === tx.accountId);
    if (account?.type === 'credit_card' && sanitizedTx.type === 'credit' && tx.appliedBillingCycleYearMonth) {
      const txCycle = getBillingCycleForDate(sanitizedTx.date, account.statementDay || 1);
      setCcPaymentCycleTarget(tx.appliedBillingCycleYearMonth === txCycle ? 'current_cycle' : 'previous_statement');
    } else {
      setCcPaymentCycleTarget('previous_statement');
    }
    setSelectedCashbackLevelId(tx.cashbackLevelId || '');
    setShowRewardSplit((tx.rewardUsed || 0) > 0);
    setNewTx(sanitizedTx);
    syncInputStrings(sanitizedTx);
    setIsModalOpen(true);
  };

  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({
    [format(new Date(), 'yyyy-MM')]: true
  });

  const toggleMonth = (month: string) => {
    setExpandedMonths(prev => ({
      ...prev,
      [month]: !prev[month]
    }));
  };

  const availableMonths = Array.from(new Set(data.transactions.map(tx => tx.date.substring(0, 7)))).sort((a, b) => b.localeCompare(a));

  const filteredTransactions = data.transactions
    .filter(tx => {
      const matchesType = filterType === 'all' || tx.type === filterType;
      const matchesAccount = filterAccountId.includes('all') || filterAccountId.includes(tx.accountId);
      const matchesCategory = filterCategory.includes('all') || filterCategory.includes(tx.category);
      const matchesMonth = filterMonth.includes('all') || filterMonth.includes(tx.date.substring(0, 7));
      const matchesSearch = tx.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tx.category.toLowerCase().includes(searchQuery.toLowerCase());

      const today = format(new Date(), 'yyyy-MM-dd');
      const isFuture = tx.date > today;

      return matchesType && matchesAccount && matchesCategory && matchesMonth && matchesSearch && !isFuture && tx.amount > 0;
    });

  const isFilterActive = filterType !== 'all' || !filterAccountId.includes('all') || !filterCategory.includes('all') || !filterMonth.includes('all') || searchQuery !== '';

  const clearFilters = () => {
    setFilterType('all');
    setFilterAccountId(['all']);
    setFilterCategory(['all']);
    setFilterMonth(['all']);
    setSearchQuery('');
  };

  const filteredIncome = filteredTransactions.reduce((sum, tx) => {
    const isExcludedCategory = tx.category.toLowerCase() === 'transfer' || tx.category.toLowerCase() === 'cc payment' || tx.category.toLowerCase() === 'ncmc travel recharge';
    if (isExcludedCategory) return sum;
    const effectiveAmount = tx.amount - (tx.excludedAmount || (tx.excludeFromStats ? tx.amount : 0));
    return sum + (tx.type === 'credit' ? effectiveAmount : 0);
  }, 0);
  const filteredSpend = filteredTransactions.reduce((sum, tx) => {
    const isExcludedCategory = tx.category.toLowerCase() === 'transfer' || tx.category.toLowerCase() === 'cc payment' || tx.category.toLowerCase() === 'ncmc travel recharge';
    if (isExcludedCategory) return sum;
    const effectiveAmount = tx.amount - (tx.excludedAmount || (tx.excludeFromStats ? tx.amount : 0));
    return sum + (tx.type === 'debit' ? effectiveAmount : 0);
  }, 0);


  const groupedByMonth = filteredTransactions.reduce((acc, tx) => {
    const month = tx.date.substring(0, 7);
    if (!acc[month]) acc[month] = [];
    acc[month].push(tx);
    return acc;
  }, {} as Record<string, Transaction[]>);

  const sortedMonths = Object.keys(groupedByMonth).sort((a, b) => b.localeCompare(a));

  const isTransfer = newTx.category?.toLowerCase() === 'transfer';
  const isCCPayment = newTx.category?.toLowerCase() === 'cc payment';
  const hasRewardsOrWallet = data.accounts.some(a => a.type === 'rewards' || a.type === 'e_wallet');

  return (
    <div className="flex-col gap-6">
      {smsQueue.length > 0 && (
        <div
          className="card fade-in"
          style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1))',
            border: '1px solid var(--accent)',
            padding: '1rem',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
          onClick={processNextSms}
        >
          <div className="flex align-center gap-3">
            <div className="flex-center" style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--accent)', color: 'var(--bg-color)' }}>
              <Smartphone size={20} />
            </div>
            <div className="flex-col">
              <span className="font-bold text-mono" style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                {smsQueue.length} Pending {smsQueue.length === 1 ? 'Transaction' : 'Transactions'}
              </span>
              <span className="text-xs text-muted">Tap to review and log</span>
            </div>
          </div>
          <ChevronRight size={20} className="text-muted" />
        </div>
      )}
      <div className="flex-col gap-4">
        <h2 className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>transactions</h2>
        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="flex gap-3 align-center">
            <button
              className={`btn ${showFilters ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontWeight: 800, letterSpacing: '1px' }}
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? (isFilterActive ? 'Minimize' : 'Hide Filters') : 'Filters'}
            </button>
            {isFilterActive && (
              <button
                className="btn btn-secondary"
                onClick={clearFilters}
                style={{ fontWeight: 800, letterSpacing: '1px' }}
              >
                Clear
              </button>
            )}
          </div>
          <button className="btn btn-primary" onClick={openAddModal} style={{ fontWeight: 800, letterSpacing: '1px' }}>
            + Log Transaction
          </button>
        </div>
      </div>

      {!showFilters && isFilterActive && (
        <div className="flex-col gap-3 card fade-in" style={{ padding: '0.9rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)' }}>
          <div className="flex justify-between align-center">
            <div className="flex gap-2 flex-wrap" style={{ paddingBottom: '2px' }}>
              {filterType !== 'all' && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--accent)', letterSpacing: '0.5px' }}>{filterType}</span>
                  <div
                    onClick={() => setFilterType('all')}
                    style={{ cursor: 'pointer', display: 'center', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {!filterAccountId.includes('all') && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
                    {filterAccountId.length === 1
                      ? data.accounts.find(a => a.id === filterAccountId[0])?.name
                      : (filterAccountId.length === 2
                        ? `${data.accounts.find(a => a.id === filterAccountId[0])?.name.split(' ')[0]} + ${data.accounts.find(a => a.id === filterAccountId[1])?.name.split(' ')[0]}`
                        : `${filterAccountId.length} Accounts`)}
                  </span>
                  <div
                    onClick={() => setFilterAccountId(['all'])}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {!filterCategory.includes('all') && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
                    {filterCategory.length === 1
                      ? filterCategory[0]
                      : (filterCategory.length === 2
                        ? `${filterCategory[0]} + ${filterCategory[1]}`
                        : `${filterCategory.length} Categories`)}
                  </span>
                  <div
                    onClick={() => setFilterCategory(['all'])}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {!filterMonth.includes('all') && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
                    {filterMonth.length === 1
                      ? (() => {
                        const d = new Date(`${filterMonth[0]}-01`);
                        return `${d.toLocaleString('default', { month: 'short' })} '${d.getFullYear().toString().slice(-2)}`;
                      })()
                      : (filterMonth.length === 2
                        ? `${new Date(`${filterMonth[0]}-01`).toLocaleString('default', { month: 'short' })} + ${new Date(`${filterMonth[1]}-01`).toLocaleString('default', { month: 'short' })}`
                        : `${filterMonth.length} Months`)}
                  </span>
                  <div
                    onClick={() => setFilterMonth(['all'])}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {searchQuery && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>"{searchQuery}"</span>
                  <div
                    onClick={() => setSearchQuery('')}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}</div>
          </div>

          <div className="flex gap-6 pt-3" style={{ borderTop: '1px dashed var(--border-color)', marginTop: '0.25rem' }}>
            <div className="flex align-center gap-2">
              <span className="text-xs text-muted font-bold uppercase" style={{ letterSpacing: '0.5px', opacity: 0.5 }}>Income</span>
              <span style={{ fontWeight: 800, color: 'var(--success)', fontSize: '1rem' }}>+{formatCurrency(filteredIncome)}</span>
            </div>
            <div className="flex align-center gap-2">
              <span className="text-xs text-muted font-bold uppercase" style={{ letterSpacing: '0.5px', opacity: 0.5 }}>Spends</span>
              <span style={{ fontWeight: 800, color: 'var(--danger)', fontSize: '1rem' }}>-{formatCurrency(filteredSpend)}</span>
            </div>
          </div>
        </div>
      )}

      {showFilters && (
        <div className="flex-col gap-3 card" style={{ padding: '1rem' }}>
          {isFilterActive && (
            <div className="flex justify-between align-center" style={{ backgroundColor: 'var(--bg-hover)', padding: '0.85rem 1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'inset 3px 3px 0 rgba(0, 0, 0, 0.4)' }}>
              <div className="flex gap-4">
                <div className="flex align-center gap-2">
                  <span className="text-xs text-muted" style={{ fontSize: '0.75rem' }}>Income:</span>
                  <span style={{ fontWeight: 700, color: 'var(--success)', fontSize: '0.95rem' }}>+{formatCurrency(filteredIncome)}</span>
                </div>
                <div className="flex align-center gap-2">
                  <span className="text-xs text-muted" style={{ fontSize: '0.75rem' }}>Spends:</span>
                  <span style={{ fontWeight: 700, color: '#ff4d4d', fontSize: '0.95rem' }}>-{formatCurrency(filteredSpend)}</span>
                </div>
              </div>
              <span className="text-xs text-muted" style={{ letterSpacing: '0.5px', opacity: 0.6 }}>Summary</span>
            </div>
          )}

          <div className="flex gap-2 align-center" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}>
              <Search size={18} />
            </div>
            <input
              className="input-field"
              style={{
                flex: 1,
                padding: '0.75rem 1rem 0.75rem 2.8rem',
                minHeight: '48px',
                borderRadius: '12px',
                fontSize: '0.95rem'
              }}
              placeholder="Search description..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex-col gap-1">
              <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Type</label>
              <CustomPicker
                label="Type"
                hideLabel={true}
                value={filterType}
                options={[
                  { id: 'all', name: 'All Types' },
                  { id: 'debit', name: 'Debit Only' },
                  { id: 'credit', name: 'Credit Only' }
                ]}
                onChange={(val) => setFilterType(val as 'all' | 'debit' | 'credit')}
                iconGetter={(id) => id === 'all' ? <Activity size={16} /> : (id === 'debit' ? <ArrowRightLeft size={16} className="rotate-90 text-danger" /> : <ArrowRightLeft size={16} className="-rotate-90 text-success" />)}
              />
            </div>
            <div className="flex-col gap-1">
              <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Account</label>
              <CustomPicker
                label="Account"
                hideLabel={true}
                value={filterAccountId}
                isMulti={true}
                options={[
                  { id: 'all', name: 'All Accounts' },
                  ...data.accounts.map(a => ({ id: a.id, name: a.name }))
                ]}
                onChange={setFilterAccountId}
                iconGetter={getAccountIcon}
              />
            </div>
            <div className="flex-col gap-1">
              <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Category</label>
              <CustomPicker
                label="Category"
                hideLabel={true}
                value={filterCategory}
                isMulti={true}
                options={[
                  { id: 'all', name: 'All Categories' },
                  ...(data.categories || []).map(c => ({ id: c, name: c }))
                ]}
                onChange={setFilterCategory}
                iconGetter={getCategoryIcon}
              />
            </div>
            <div className="flex-col gap-1">
              <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Month</label>
              <CustomPicker
                label="Month"
                hideLabel={true}
                value={filterMonth}
                isMulti={true}
                options={[
                  { id: 'all', name: 'All Months' },
                  ...availableMonths.map(m => {
                    const d = new Date(`${m}-01`);
                    const year = d.getFullYear();
                    return {
                      id: m,
                      name: `${d.toLocaleString('default', { month: 'short' })} '${d.getFullYear().toString().slice(-2)}`,
                      group: `Year ${year}`
                    };
                  })
                ]}
                onChange={setFilterMonth}
                iconGetter={() => <Calendar size={16} />}
              />
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filteredTransactions.length === 0 ? (
          <p className="text-muted text-center" style={{ padding: '2rem' }}>No transactions found.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sortedMonths.map(monthStr => {
              const isExpanded = expandedMonths[monthStr];
              const txsInMonth = groupedByMonth[monthStr];
              const monthDate = new Date(`${monthStr}-01`);
              const monthLabel = monthDate.toLocaleString('default', { month: 'long', year: 'numeric' });

              const groupedByDate = txsInMonth.reduce((acc, tx) => {
                if (!acc[tx.date]) acc[tx.date] = [];
                acc[tx.date].push(tx);
                return acc;
              }, {} as Record<string, Transaction[]>);

              return (
                <div key={monthStr} className="flex-col">
                  <div
                    className="flex justify-between align-center"
                    style={{ padding: '0.75rem 1.5rem', backgroundColor: 'var(--bg-hover)', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                    onClick={() => toggleMonth(monthStr)}
                  >
                    <span className="text-mono" style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.85rem', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{monthLabel}</span>
                    <span className="text-mono text-muted" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                      {txsInMonth.length} transactions {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="fade-in">
                      {Object.entries(groupedByDate).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()).map(([date, txs]) => {
                        const sortedTxs = [...txs].sort((a, b) => {
                          const orderA = a.order !== undefined ? a.order : txs.indexOf(a);
                          const orderB = b.order !== undefined ? b.order : txs.indexOf(b);
                          return orderA - orderB;
                        });
                        const dailyIncome = txs.reduce((sum, t) => {
                          const isExcludedCategory = t.category.toLowerCase() === 'transfer' || t.category.toLowerCase() === 'cc payment' || t.category.toLowerCase() === 'ncmc travel recharge';
                          if (isExcludedCategory) return sum;
                          const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
                          return sum + (t.type === 'credit' ? effectiveAmount : 0);
                        }, 0);
                        const dailySpend = txs.reduce((sum, t) => {
                          const isExcludedCategory = t.category.toLowerCase() === 'transfer' || t.category.toLowerCase() === 'cc payment' || t.category.toLowerCase() === 'ncmc travel recharge';
                          if (isExcludedCategory) return sum;
                          const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
                          return sum + (t.type === 'debit' ? effectiveAmount : 0);
                        }, 0);
                        return (
                          <React.Fragment key={date}>
                            <div className="flex justify-between align-center" style={{ backgroundColor: 'var(--bg-card)', fontWeight: 600, color: 'var(--text-secondary)', padding: '0.5rem 1.5rem', fontSize: '0.7rem', opacity: 0.8, borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                              <span className="text-mono" style={{ textTransform: 'uppercase', letterSpacing: '1px' }}>{formatDateString(date)}</span>
                              <div className="flex gap-3">
                                {dailyIncome > 0 && <span style={{ color: 'var(--success)' }}>+{formatCurrency(dailyIncome)}</span>}
                                {dailySpend > 0 && <span style={{ color: 'var(--danger)' }}>-{formatCurrency(dailySpend)}</span>}
                              </div>
                            </div>
                            {sortedTxs.map((tx, index) => (
                              <TransactionRow
                                key={tx.id}
                                tx={tx}
                                acc={data.accounts.find(a => a.id === tx.accountId)}
                                isFirst={index === 0}
                                isLast={index === sortedTxs.length - 1}
                                onEdit={openEditModal}
                                onDelete={handleDelete}
                                onMoveUp={() => {
                                  const prev = sortedTxs[index - 1];
                                  reorderTransactions({ ...tx, order: prev.order || (index - 1) }, { ...prev, order: tx.order || index });
                                }}
                                onMoveDown={() => {
                                  const next = sortedTxs[index + 1];
                                  reorderTransactions({ ...tx, order: next.order || (index + 1) }, { ...next, order: tx.order || index });
                                }}
                              />
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>{editId ? 'Edit Transaction' : 'Log Transaction'}</h3>
              <button onClick={() => { setIsModalOpen(false); setProcessingSms(false); }}>✕</button>
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
                <input
                  className={`input-field ${errors.description ? 'border-danger' : ''}`}
                  value={newTx.description}
                  onChange={e => handleDescriptionChange(e.target.value)}
                  onBlur={() => setTimeout(() => setDescriptionSuggestions([]), 150)}
                  placeholder="e.g. Swiggy Order"
                  autoComplete="off"
                />
                {errors.description && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.description}</span>}
                {descriptionSuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '0 0 12px 12px',
                    zIndex: 10,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    marginTop: '-4px'
                  }}>
                    {descriptionSuggestions.map(s => (
                      <div
                        key={s}
                        style={{ padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.9rem' }}
                        onClick={() => selectSuggestion(s)}
                        onMouseDown={e => e.preventDefault()}
                      >
                        {s}
                      </div>
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
                        const numVal = parseFloat(val);
                        const finalAmount = isNaN(numVal) ? 0 : numVal;

                        setNewTx(prev => ({ ...prev, amount: finalAmount }));
                        setInputStrings(s => ({ ...s, amount: val }));

                        if (errors.amount) setErrors(prev => ({ ...prev, amount: '' }));
                        if (errors.excludedAmount && finalAmount >= (newTx.excludedAmount || 0)) {
                          setErrors(prev => ({ ...prev, excludedAmount: '' }));
                        }
                      }
                    }}
                    placeholder="0.00"
                  />
                  {errors.amount && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.amount}</span>}
                </div>
                <CustomPicker
                  label="Type"
                  value={newTx.type!}
                  options={[
                    { id: 'debit', name: 'Debit (Spend)', subtext: 'Money going out' },
                    { id: 'credit', name: 'Credit (Receive)', subtext: 'Money coming in' }
                  ]}
                  onChange={val => {
                    const newType = val as TransactionType;
                    const currentDesc = newTx.description || '';
                    const isTransferCat = newTx.category?.toLowerCase() === 'transfer';
                    const isCCCat = newTx.category?.toLowerCase() === 'cc payment';
                    const isTransferAutoFilled = currentDesc.startsWith('Transfer to ') || currentDesc.startsWith('Transfer from ');
                    const isCCAutoFilled = currentDesc === 'CC Bill Payment' || currentDesc.startsWith('CC Payment: ');
                    let updatedDesc = currentDesc;
                    if (isTransferCat && isTransferAutoFilled && paymentSourceAccountId) {
                      const selectedAcc = data.accounts.find(a => a.id === paymentSourceAccountId);
                      if (selectedAcc) {
                        updatedDesc = newType === 'debit'
                          ? `Transfer to ${selectedAcc.name}`
                          : `Transfer from ${selectedAcc.name}`;
                      }
                    } else if (isCCCat && isCCAutoFilled && paymentSourceAccountId) {
                      const selectedAcc = data.accounts.find(a => a.id === paymentSourceAccountId);
                      if (selectedAcc) {
                        // debit = bank pays out → 'CC Payment: <card>'; credit = card receives → 'CC Bill Payment'
                        updatedDesc = newType === 'debit'
                          ? `CC Payment: ${selectedAcc.name.trim()}`
                          : 'CC Bill Payment';
                      }
                    }
                    let updatedAccountId = newTx.accountId;
                    if (isCCCat && updatedAccountId) {
                      const selectedAcc = data.accounts.find(a => a.id === updatedAccountId);
                      if (newType === 'debit' && selectedAcc?.type === 'credit_card') {
                        updatedAccountId = '';
                        setPaymentSourceAccountId('');
                      } else if (newType === 'credit' && selectedAcc?.type !== 'credit_card') {
                        updatedAccountId = '';
                        setPaymentSourceAccountId('');
                      }
                    }
                    let updatedIsTravel = newTx.isTravelTransaction;
                    const selectedAcc = updatedAccountId ? data.accounts.find(a => a.id === updatedAccountId) : null;
                    if (newType === 'credit' && selectedAcc?.type === 'debit_card' && selectedAcc?.isNcmcEnabled && newTx.category?.toLowerCase() === 'ncmc travel recharge') {
                      updatedIsTravel = true;
                      if (updatedDesc === '' || updatedDesc === 'NCMC Travel Recharge' || updatedDesc === 'Transfer to Travel Wallet') {
                        updatedDesc = 'NCMC Travel Recharge';
                      }
                    } else if (newType === 'debit' && selectedAcc?.type === 'debit_card' && selectedAcc?.isNcmcEnabled && newTx.category?.toLowerCase() === 'ncmc travel recharge') {
                      updatedIsTravel = false;
                      if (updatedDesc === '' || updatedDesc === 'NCMC Travel Recharge' || updatedDesc === 'Transfer to Travel Wallet') {
                        updatedDesc = 'Transfer to Travel Wallet';
                      }
                    }
                    setNewTx({ ...newTx, type: newType, description: updatedDesc, accountId: updatedAccountId, isTravelTransaction: updatedIsTravel });
                  }}
                  iconGetter={_id => _id === 'debit' ? '📉' : '📈'}
                  style={{ marginBottom: 0 }}
                />
              </div>

              <CustomPicker
                label="Account"
                value={newTx.accountId || ''}
                placeholder="Select an account"
                options={data.accounts
                  .filter(acc => {
                    if (isCCPayment) {
                      return newTx.type === 'debit' ? acc.type !== 'credit_card' : acc.type === 'credit_card';
                    }
                    return true;
                  })
                  .map(acc => ({
                    id: acc.id,
                    name: acc.name,
                    subtext: acc.type.replace('_', ' ')
                  }))}
                onChange={val => {
                  const selectedAcc = data.accounts.find(a => a.id === val);
                  const isNcmcRecharge = newTx.category?.toLowerCase() === 'ncmc travel recharge';
                  const shouldAutoTravel = newTx.type === 'credit' && selectedAcc?.type === 'debit_card' && selectedAcc?.isNcmcEnabled && isNcmcRecharge;
                  const shouldAutoDebitDesc = newTx.type === 'debit' && selectedAcc?.type === 'debit_card' && selectedAcc?.isNcmcEnabled && isNcmcRecharge;
                  setNewTx({
                    ...newTx,
                    accountId: val,
                    isTravelTransaction: shouldAutoTravel ? true : (selectedAcc?.isNcmcEnabled ? newTx.isTravelTransaction : false),
                    description: shouldAutoDebitDesc ? 'Transfer to Travel Wallet' : (shouldAutoTravel ? 'NCMC Travel Recharge' : newTx.description)
                  });
                  if (errors.accountId) {
                    const newErr = { ...errors };
                    delete newErr.accountId;
                    setErrors(newErr);
                  }
                }}
                iconGetter={id => getAccountIcon(id)}
                error={errors.accountId}
              />

              <CustomPicker
                label="Category"
                value={newTx.category || ''}
                placeholder="Select Category"
                options={[
                  ...(data.categories || []).map(c => ({ id: c, name: c })),
                  ...(newTx.category && !(data.categories || []).includes(newTx.category)
                    ? [{ id: newTx.category, name: newTx.category }]
                    : [])
                ]}
                onChange={val => {
                  const currentDesc = newTx.description || '';
                  const isNcmcAccount = !!data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled;

                  // Transfer auto-fill / clear
                  const wasTransfer = newTx.category?.toLowerCase() === 'transfer';
                  const isNowTransfer = val.toLowerCase() === 'transfer';
                  const isTransferAutoFilled = currentDesc.startsWith('Transfer to ') || currentDesc.startsWith('Transfer from ');

                  // CC Payment auto-fill / clear
                  const wasCC = newTx.category?.toLowerCase() === 'cc payment';
                  const isNowCC = val.toLowerCase() === 'cc payment';
                  const isCCAutoFilled = currentDesc === 'CC Bill Payment' || currentDesc.startsWith('CC Payment: ');

                  // NCMC auto-fill / clear
                  const wasNcmc = newTx.category?.toLowerCase() === 'ncmc travel recharge';
                  const isNowNcmc = val.toLowerCase() === 'ncmc travel recharge';
                  const isNcmcAutoFilled = currentDesc === 'NCMC Travel Recharge';

                  let updatedDesc = currentDesc;
                  if (wasTransfer && !isNowTransfer && isTransferAutoFilled) {
                    updatedDesc = '';
                  } else if (wasCC && !isNowCC && isCCAutoFilled) {
                    // Leaving CC Payment — clear CC auto-fill
                    updatedDesc = '';
                  } else if (wasNcmc && !isNowNcmc && (isNcmcAutoFilled || currentDesc === 'Transfer to Travel Wallet')) {
                    updatedDesc = '';
                  } else if (isNowCC && paymentSourceAccountId) {
                    // Switching TO CC Payment with counterpart already selected — auto-fill
                    if (currentDesc === '' || isCCAutoFilled || isTransferAutoFilled) {
                      const selectedAcc = data.accounts.find(a => a.id === paymentSourceAccountId);
                      if (selectedAcc) {
                        updatedDesc = newTx.type === 'debit'
                          ? `CC Payment: ${selectedAcc.name.trim()}`
                          : 'CC Bill Payment';
                      }
                    }
                  }
                  const selectedAccForTravel = data.accounts.find(a => a.id === newTx.accountId);
                  const shouldAutoTravel = newTx.type === 'credit' && selectedAccForTravel?.type === 'debit_card' && selectedAccForTravel?.isNcmcEnabled && isNowNcmc;
                  const updatedIsTravel = shouldAutoTravel ? true : newTx.isTravelTransaction;

                  if (isNowNcmc && isNcmcAccount && updatedIsTravel && newTx.type === 'credit') {
                    if (currentDesc === '' || isNcmcAutoFilled || isTransferAutoFilled) {
                      updatedDesc = 'NCMC Travel Recharge';
                    }
                  } else if (isNowNcmc && isNcmcAccount && !updatedIsTravel && newTx.type === 'debit') {
                    if (currentDesc === '' || currentDesc === 'Transfer to Travel Wallet' || isTransferAutoFilled) {
                      updatedDesc = 'Transfer to Travel Wallet';
                    }
                  }

                  let updatedAccountId = newTx.accountId;
                  if (isNowCC && updatedAccountId) {
                    const selectedAcc = data.accounts.find(a => a.id === updatedAccountId);
                    if (newTx.type === 'debit' && selectedAcc?.type === 'credit_card') {
                      updatedAccountId = '';
                      setPaymentSourceAccountId('');
                    } else if (newTx.type === 'credit' && selectedAcc?.type !== 'credit_card') {
                      updatedAccountId = '';
                      setPaymentSourceAccountId('');
                    }
                  }

                  setNewTx({ ...newTx, category: val, description: updatedDesc, accountId: updatedAccountId, isTravelTransaction: updatedIsTravel });
                  if (errors.category) {
                    const newErr = { ...errors };
                    delete newErr.category;
                    setErrors(newErr);
                  }
                }}
                iconGetter={c => getCategoryIcon(c)}
                error={errors.category}
              />

              {(
                (newTx.type === 'credit' && (data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card' || (data.accounts.find(a => a.id === newTx.accountId)?.type === 'debit_card' && !newTx.isTravelTransaction)))
                || isTransfer
                || (isCCPayment && newTx.accountId && (
                  newTx.type === 'debit'
                    ? data.accounts.find(a => a.id === newTx.accountId)?.type !== 'credit_card'
                    : data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card'
                ))
              ) && (
                  <CustomPicker
                    label={
                      newTx.type === 'debit'
                        ? (isCCPayment ? 'Pay To Card (Auto-Credit)' : 'Credit To Account (Auto-Credit)')
                        : 'Debit From Account (Auto-Debit)'
                    }
                    value={paymentSourceAccountId}
                    placeholder="None (Manual Log)"
                    options={[
                      { id: '', name: 'None (Manual Log)' },
                      ...data.accounts.filter(a => {
                        if (a.id === newTx.accountId) return false;
                        if (isCCPayment) {
                          return newTx.type === 'debit' ? a.type === 'credit_card' : a.type !== 'credit_card';
                        }
                        return true;
                      }).map(acc => ({
                        id: acc.id,
                        name: acc.name,
                        subtext: acc.type.replace('_', ' ')
                      }))
                    ]}
                    onChange={(val) => {
                      setPaymentSourceAccountId(val);
                      const selectedAcc = val ? data.accounts.find(a => a.id === val) : null;
                      const currentDesc = newTx.description || '';
                      const isTransferAutoFilled = currentDesc === '' || currentDesc.startsWith('Transfer to ') || currentDesc.startsWith('Transfer from ');
                      const isCCAutoFilled = currentDesc === '' || currentDesc === 'CC Bill Payment' || currentDesc.startsWith('CC Payment: ');

                      if (isTransfer && isTransferAutoFilled) {
                        // Transfer: auto-fill from account name
                        const autoDesc = selectedAcc
                          ? (newTx.type === 'debit' ? `Transfer to ${selectedAcc.name.trim()}` : `Transfer from ${selectedAcc.name.trim()}`)
                          : '';
                        setNewTx(prev => ({ ...prev, description: autoDesc }));
                      } else if (isCCPayment && isCCAutoFilled) {
                        // CC Payment: debit = bank paying card → 'CC Payment: <card>'; credit = card receives → 'CC Bill Payment'
                        const autoDesc = selectedAcc
                          ? (newTx.type === 'debit' ? `CC Payment: ${selectedAcc.name.trim()}` : 'CC Bill Payment')
                          : '';
                        setNewTx(prev => ({ ...prev, description: autoDesc }));
                      }
                    }}
                    iconGetter={_id => _id ? getAccountIcon(_id) : '🚫'}
                  />
                )}

              {data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled && (
                <div className="input-group">
                  <label>Section</label>
                  <div className="grid grid-cols-2 gap-2" style={{ marginTop: '0.25rem' }}>
                    <button
                      className={`btn ${!newTx.isTravelTransaction ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.75rem', borderRadius: '12px' }}
                      onClick={() => {
                        const currentDesc = newTx.description || '';
                        const isNcmcCat = newTx.category?.toLowerCase() === 'ncmc travel recharge';
                        // Clear NCMC auto-fill when switching away from Travel section
                        const updatedDesc = isNcmcCat && currentDesc === 'NCMC Travel Recharge' ? '' : currentDesc;
                        const updatedType = isNcmcCat ? 'debit' : newTx.type;
                        setNewTx({ ...newTx, isTravelTransaction: false, description: updatedDesc, type: updatedType });
                      }}
                    >
                      💳 Payments
                    </button>
                    <button
                      className={`btn ${!!newTx.isTravelTransaction ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.75rem', borderRadius: '12px' }}
                      onClick={() => {
                        const currentDesc = newTx.description || '';
                        const isNcmcCat = newTx.category?.toLowerCase() === 'ncmc travel recharge';
                        const isNcmcAccount = !!data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled;
                        const updatedType = isNcmcCat ? 'credit' : newTx.type;
                        // Auto-fill when switching to Travel section with NCMC Travel Recharge category
                        const shouldAutoFill = isNcmcCat && isNcmcAccount && updatedType === 'credit' && (currentDesc === '' || currentDesc === 'NCMC Travel Recharge');
                        const updatedDesc = shouldAutoFill ? 'NCMC Travel Recharge' : currentDesc;
                        setNewTx({ ...newTx, isTravelTransaction: true, description: updatedDesc, type: updatedType });
                      }}
                    >
                      🚇 Travel
                    </button>
                  </div>
                </div>
              )}

              {!editId && newTx.type === 'credit' && data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled && newTx.isTravelTransaction && (
                <div className="text-xs text-accent flex align-center" style={{ marginTop: '0.5rem', marginBottom: '1rem', padding: '0.75rem', border: '1px dashed var(--accent)', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.05)' }}>
                  <span style={{ marginRight: '0.5rem', fontSize: '1rem' }}>ℹ️</span>
                  <span>This will automatically debit <strong>{data.accounts.find(a => a.id === newTx.accountId)?.name} (Payments)</strong></span>
                </div>
              )}

              {!editId && newTx.type === 'debit' && data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled && !newTx.isTravelTransaction && newTx.category?.toLowerCase() === 'ncmc travel recharge' && (
                <div className="text-xs text-accent flex align-center" style={{ marginTop: '0.5rem', marginBottom: '1rem', padding: '0.75rem', border: '1px dashed var(--accent)', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.05)' }}>
                  <span style={{ marginRight: '0.5rem', fontSize: '1rem' }}>ℹ️</span>
                  <span>This will automatically credit <strong>{data.accounts.find(a => a.id === newTx.accountId)?.name} (Travel)</strong></span>
                </div>
              )}

              {(() => {
                const activeAcc = data.accounts.find(a => a.id === newTx.accountId);
                const isCard = activeAcc?.type === 'credit_card' || activeAcc?.type === 'debit_card';
                const isBank = activeAcc?.type === 'bank_account';
                const isEWallet = activeAcc?.type === 'e_wallet';
                const showInstantUI = isBank || isEWallet;

                const isTransfer = newTx.category?.toLowerCase() === 'transfer';
                const isCCPayment = newTx.category?.toLowerCase() === 'cc payment';
                const isNcmcRecharge = newTx.category?.toLowerCase() === 'ncmc travel recharge';

                if (isTransfer || isCCPayment || isNcmcRecharge) return null;
                if (newTx.isTravelTransaction) return null;

                if (!isCard && !showInstantUI) return null;
                if (newTx.type !== 'debit') return null;
                if (showInstantUI && !hasRewardsOrWallet) return null;

                return (
                  <div className="flex-col gap-3" style={{ marginTop: '0.5rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                    <div className="flex justify-between align-center">
                      <span className="text-xs font-bold text-muted uppercase" style={{ letterSpacing: '1px' }}>Cashback Earned</span>
                      {showInstantUI && (
                        <div className="flex gap-2">
                          <span className="text-mono text-xs text-success font-bold" style={{ display: 'flex', alignItems: 'center' }}>⚡ INSTANT</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {isCard ? (
                        <div className="col-span-2">
                          <CustomPicker
                            label="Cashback Mode"
                            value={selectedCashbackLevelId || 'none'}
                            options={[
                              { id: 'none', name: 'None' },
                              { id: 'default', name: `Default (${activeAcc?.defaultCashbackRate || 0}%)` },
                              ...(activeAcc?.cashbackRates || []).map(r => ({ id: r.id, name: `${r.name} (${r.rate}%)` }))
                            ]}
                            onChange={val => {
                              setSelectedCashbackLevelId(val === 'none' ? '' : val);
                              setNewTx({ ...newTx, rewardEarnedType: 'delayed', rewardEarned: 0 });
                            }}
                            iconGetter={() => '✨'}
                          />
                        </div>
                      ) : (
                        <input
                          type="text"
                          inputMode="decimal"
                          className="input-field"
                          value={inputStrings.rewardEarned}
                          onChange={e => {
                            const val = e.target.value;
                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                              setInputStrings(prev => ({ ...prev, rewardEarned: val }));
                              const numVal = parseFloat(val);
                              setNewTx({
                                ...newTx,
                                rewardEarned: isNaN(numVal) ? 0 : numVal,
                                rewardEarnedType: 'instant'
                              });
                            }
                          }}
                          placeholder="0.00"
                        />
                      )}

                      {showInstantUI && (
                        <CustomPicker
                          label="Deposit To"
                          value={newTx.rewardEarnedAccountId || ''}
                          placeholder="Select Account"
                          options={data.accounts.filter(a => a.type === 'rewards' || a.type === 'e_wallet').map(acc => ({
                            id: acc.id,
                            name: acc.name,
                            subtext: acc.type.replace('_', ' ')
                          }))}
                          onChange={val => setNewTx({ ...newTx, rewardEarnedAccountId: val, rewardEarnedType: 'instant' })}
                          iconGetter={id => getAccountIcon(id)}
                        />
                      )}
                      {isCard && (
                        <div className="col-span-2 flex align-center text-xs text-muted" style={{ opacity: 0.7 }}>
                          Will show in Cashback Vault for verification.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}



              {!showRewardSplit && isCCPayment && paymentSourceAccountId && hasRewardsOrWallet && (
                <button
                  className="btn btn-secondary w-100 flex align-center justify-center gap-2"
                  style={{ marginTop: '0.25rem', marginBottom: '1.25rem', padding: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}
                  onClick={() => {
                    setShowRewardSplit(true);
                    setTimeout(() => {
                      rewardSplitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                  }}
                >
                  <Sparkles size={14} className="text-primary" />
                  <span>Split with Rewards?</span>
                </button>
              )}

              {showRewardSplit && isCCPayment && paymentSourceAccountId && hasRewardsOrWallet && (
                <div
                  ref={rewardSplitRef}
                  className="grid grid-cols-2 gap-4"
                  style={{ marginTop: '0.25rem', marginBottom: '1.25rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px' }}
                >
                  <div className="flex justify-between align-center col-span-2">
                    <span className="text-xs font-bold text-muted uppercase" style={{ letterSpacing: '1px' }}>Split Payment</span>
                    {showRewardSplit && (
                      <button
                        className="btn btn-danger flex align-center gap-1"
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.25rem 0.6rem',
                          minHeight: 'auto',
                          boxShadow: '2px 2px 0 #000'
                        }}
                        onClick={() => {
                          setShowRewardSplit(false);
                          setNewTx({ ...newTx, rewardUsed: 0, rewardUsedAccountId: '' });
                        }}
                      >
                        ✕ Remove Split
                      </button>
                    )}
                  </div>
                  <div className="input-group">
                    <label>Rewards Used <span className="text-muted" style={{ fontWeight: 400 }}>(Optional)</span></label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input-field"
                      value={inputStrings.rewardUsed}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === '' || /^\d*\.?\d*$/.test(val)) {
                          setInputStrings(prev => ({ ...prev, rewardUsed: val }));
                          const numVal = parseFloat(val);
                          setNewTx({ ...newTx, rewardUsed: isNaN(numVal) ? 0 : numVal });
                        }
                      }}
                      placeholder="0.00"
                    />
                  </div>
                  <CustomPicker
                    label="From Rewards"
                    value={newTx.rewardUsedAccountId || ''}
                    placeholder="Select Reward Account"
                    options={data.accounts.filter(a => a.type === 'rewards').map(acc => ({
                      id: acc.id,
                      name: acc.name,
                      subtext: formatCurrency(calculateBalance(acc, data.transactions, getCurrentMonthStr()))
                    }))}
                    onChange={val => setNewTx({ ...newTx, rewardUsedAccountId: val })}
                    iconGetter={id => getAccountIcon(id)}
                  />
                  <div className="col-span-2 text-xs text-muted" style={{ opacity: 0.7 }}>
                    Primary Account Debit: <strong>{formatCurrency(Math.max(0, Number(newTx.amount || 0) - Number(newTx.rewardUsed || 0)))}</strong>
                  </div>
                </div>
              )}

              {((newTx.type === 'credit' && data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card') ||
                (newTx.type === 'debit' && isCCPayment && paymentSourceAccountId && data.accounts.find(a => a.id === paymentSourceAccountId)?.type === 'credit_card')) && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <CustomPicker
                      label="Apply Payment To"
                      value={ccPaymentCycleTarget}
                      options={[
                        { id: 'previous_statement', name: 'Previous Statement', subtext: 'Reduce already billed dues' },
                        { id: 'current_cycle', name: 'Current Open Cycle', subtext: 'Count as an early payment for the active cycle' }
                      ]}
                      onChange={val => setCcPaymentCycleTarget(val as 'current_cycle' | 'previous_statement')}
                      iconGetter={id => id === 'current_cycle' ? '🟦' : '🧾'}
                    />
                  </div>
                )}



              {data.user?.enablePassiveTransactions && newTx.category?.toLowerCase() !== 'transfer' && newTx.category?.toLowerCase() !== 'cc payment' && newTx.category?.toLowerCase() !== 'ncmc travel recharge' && (
                <div ref={passiveLogRef} className="flex-col gap-3" style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-hover)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <div className="flex justify-between align-center">
                    <div className="flex-col">
                      <span className="text-xs font-bold text-muted uppercase" style={{ letterSpacing: '1px' }}>Passive Transaction</span>
                      <span className="text-xs text-muted" style={{ fontSize: '0.65rem' }}>Exclude from Spends & Income stats</span>
                    </div>
                    <button
                      className={`btn ${newTx.excludeFromStats ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.4rem 0.8rem', borderRadius: '8px', fontSize: '0.75rem' }}
                      onClick={() => {
                        const isExpanding = !newTx.excludeFromStats;
                        const amountToExclude = isExpanding ? (newTx.amount || 0) : undefined;
                        const updatedTx = {
                          ...newTx,
                          excludeFromStats: isExpanding,
                          excludedAmount: amountToExclude
                        };
                        setNewTx(updatedTx);
                        setInputStrings(prev => ({
                          ...prev,
                          excludedAmount: isExpanding ? (amountToExclude?.toString() || '') : ''
                        }));
                        if (errors.excludedAmount) setErrors(prev => ({ ...prev, excludedAmount: '' }));
                        if (isExpanding) {
                          setTimeout(() => {
                            passiveLogRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }, 100);
                        }
                      }}
                    >
                      {newTx.excludeFromStats ? 'Excluded' : 'Included'}
                    </button>
                  </div>
                  {newTx.excludeFromStats && (
                    <div className="flex-col gap-2 pt-2" style={{ borderTop: '1px dashed var(--border-color)', marginTop: '0.5rem' }}>
                      <div className="flex justify-between align-center">
                        <span className="text-xs text-muted">Excluded Amount</span>
                        <span className="text-xs font-bold text-accent">Active Share: {formatCurrency(Math.max(0, (newTx.amount || 0) - (newTx.excludedAmount || 0)))}</span>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={`input-field ${errors.excludedAmount ? 'border-danger' : ''}`}
                        style={{ height: '38px', fontSize: '0.9rem' }}
                        value={inputStrings.excludedAmount}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            setInputStrings(prev => ({ ...prev, excludedAmount: val }));
                            const numVal = parseFloat(val);
                            setNewTx({ ...newTx, excludedAmount: val === '' ? undefined : (isNaN(numVal) ? 0 : numVal) });
                            if (errors.excludedAmount) setErrors(prev => ({ ...prev, excludedAmount: '' }));
                          }
                        }}
                        placeholder="Amount to exclude"
                      />
                      {errors.excludedAmount && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.excludedAmount}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => { setIsModalOpen(false); setProcessingSms(false); }}>Cancel</button>
              {processingSms && (
                <button type="button" className="btn btn-danger" onClick={() => { removeFromSmsQueue(0); setProcessingSms(false); setIsModalOpen(false); }} style={{ marginLeft: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
                  Discard SMS
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSave}>{editId ? 'Update' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
      {/* Custom Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="Delete Transaction?"
        message="Are you sure you want to remove this transaction? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (deleteConfirmId) {
            deleteTransaction(deleteConfirmId);
            setDeleteConfirmId(null);
          }
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
}
