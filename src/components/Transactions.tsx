import React, { useState, useRef, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '../FinanceContext';
import type { Transaction, TransactionType, Account, InvestmentKind } from '../types';
import { generateId, formatCurrency, formatAmount, formatDateString, getBillingCycleForDate, calculateBalance, getCurrentMonthStr, isStatsExcludedCategory, isInvestmentCategory, INVESTMENT_CATEGORY, INVESTMENT_KIND_OPTIONS, investmentKindLabel, investmentAccountTypeFor, getInvestmentKind, isCountableTransaction } from '../utils';
import { Wallet, ArrowRightLeft, Calendar, Activity, X, Search, Smartphone, Sparkles, ChevronRight, ChevronDown, Hash, BanknoteArrowUp, BanknoteArrowDown, Shapes, Layers } from 'lucide-react';
import { CustomPicker } from './CustomPicker';
import CustomDatePicker from './CustomDatePicker';
import ConfirmDialog from './ConfirmDialog';
import { getCategoryIcon, getAccountTypeIcon, getAccountGroupLabel, getInvestmentKindIcon } from './transactionIcons';


function TransactionRow({ tx, acc, isFirst, isLast, onEdit, onDelete, onMoveBy, blockLen, counterparts }: {
  tx: Transaction,
  acc: Account | undefined,
  isFirst: boolean,
  isLast: boolean,
  onEdit: (tx: Transaction) => void,
  onDelete: (id: string) => void,
  onMoveBy: (steps: number) => boolean,
  blockLen: number,
  counterparts?: { tx: Transaction; acc: Account | undefined }[]
}) {
  const { data } = useFinance();
  const [isCounterpartExpanded, setIsCounterpartExpanded] = useState(false);
  const isDemoAnimatingRow = tx.id === 'demo_tx_2' || tx.id === 'demo_tx_3';
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
      // Walk the ACTUAL rendered neighbours (the outer wrappers) and consume their real heights,
      // not a single assumed row height. A neighbour with a child leg renders as one tall row but
      // spans several array slots (data-block-len), so crossing it visually must advance the array
      // by that many slots — otherwise the drag stalls when passing a log that has children.
      const wrapper = rowRef.current?.parentElement || null;
      let consumedPx = 0;   // visual pixels of neighbours fully crossed since the anchor
      let arraySteps = 0;   // array slots those neighbours occupy (signed)
      if (wrapper) {
        if (dy > 0 && !isLast) {
          let sib = wrapper.nextElementSibling as HTMLElement | null;
          while (sib && dy - consumedPx >= sib.offsetHeight) {
            consumedPx += sib.offsetHeight;
            arraySteps += Number(sib.dataset.blockLen) || 1;
            sib = sib.nextElementSibling as HTMLElement | null;
          }
        } else if (dy < 0 && !isFirst) {
          let sib = wrapper.previousElementSibling as HTMLElement | null;
          while (sib && -dy - consumedPx >= sib.offsetHeight) {
            consumedPx += sib.offsetHeight;
            arraySteps -= Number(sib.dataset.blockLen) || 1;
            sib = sib.previousElementSibling as HTMLElement | null;
          }
        }
      }
      if (arraySteps !== 0) {
        // onMoveBy returns false when a prior reorder from THIS drag hasn't committed to
        // React state yet (rapid touchmove on a fling). If we advanced the anchor anyway we'd
        // drop that crossing on the floor; instead leave the anchor put so the very next event
        // — after the DOM has caught up — re-detects and applies the same crossing. This stops
        // overlapping full-day renumbers built from stale snapshots (the "rows above reversed"
        // glitch).
        const applied = onMoveBy(arraySteps);
        if (applied) {
          // Advance the anchor by the visual distance crossed (signed) so the leftover sub-row
          // remainder becomes the live translateY below — the row stays glued to the finger.
          touchStart.current.y += dy > 0 ? consumedPx : -consumedPx;
        }
      }
      // Live follow: translate the whole group by whatever finger offset hasn't been consumed
      // into a slot swap yet, so the dragged row sits under the finger instead of trailing it.
      setSwipeY(touch.clientY - touchStart.current.y);
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

  // Android fires touchcancel (NOT touchend) when a gesture is interrupted — e.g. the app is
  // backgrounded or a notification shade opens mid-drag. Without this, isDragging stays stuck
  // true, the document-level touchmove blocker below is never removed, and ALL scrolling
  // (lists and dropdowns) freezes until a cold start. Reset state only — no edit/delete.
  const handleTouchCancel = () => {
    if (reorderTimer.current) {
      clearTimeout(reorderTimer.current);
      reorderTimer.current = null;
    }
    setSwipeX(0);
    setSwipeY(0);
    setIsDragging(false);
  };

  useEffect(() => {
    if (!isDragging) return;

    // For Native WebViews (Capacitor), explicitly lock the scroll container
    document.querySelector('.app-root')?.classList.add('no-scroll');

    const preventScroll = (e: TouchEvent) => {
      e.preventDefault();
    };
    document.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      // Re-query rather than reuse a captured node — the .app-root reference could be stale
      // after a re-render, which would leave the lock applied to the live element.
      document.querySelector('.app-root')?.classList.remove('no-scroll');
      document.removeEventListener('touchmove', preventScroll);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => handleTouchStart(e);
  const handleMouseUp = () => handleTouchEnd();

  const hasCounterparts = counterparts && counterparts.length > 0;

  return (
    <div
      data-block-len={blockLen}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        borderBottom: '1px solid var(--border-color)',
        overflow: hasCounterparts ? 'visible' : undefined,
        // While dragging, lift the whole group and glide it under the finger (translateY). zIndex
        // floats it above neighbours; transition off so it tracks 1:1 without easing lag.
        transform: isDragging ? `translateY(${swipeY}px)` : undefined,
        position: isDragging ? 'relative' : undefined,
        zIndex: isDragging ? 20 : undefined,
        transition: isDragging ? 'none' : undefined
      }}>
      <div
        ref={rowRef}
        className={`fade-in transaction-row ${isDragging ? 'is-dragging' : ''}`}
        style={{
          transform: isDemoAnimatingRow ? undefined : (isDragging ? undefined : `translateX(${swipeX}px)`),
          background: swipeX > 100 ? 'rgba(239, 68, 68, 0.2)' : undefined,
          transition: isDemoAnimatingRow ? 'none' : ((swipeX === 0 && !isDragging) ? 'all 0.3s ease' : 'none'),
          position: 'relative',
          userSelect: 'none',
          touchAction: isDragging ? 'none' : 'pan-y',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: 'none',
          padding: '0.6rem 1rem',
          opacity: 0.95,
          width: '100%'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div className="flex align-center" style={{ gap: '1rem', flex: 1, minWidth: 0, position: 'relative', zIndex: 2 }}>
          <div className="badge-scalloped">
            {(() => {
              const invKind = getInvestmentKind(tx, data.accounts);
              return invKind ? getInvestmentKindIcon(invKind) : getCategoryIcon(tx.category);
            })()}
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
            <div className="flex align-center gap-2" style={{ marginTop: '2px', flexWrap: 'wrap', rowGap: '4px' }}>
              <span className="text-mono text-muted text-xs truncate" style={{ fontWeight: 600, flexShrink: 0, maxWidth: '100%' }}>{acc?.name || 'Unknown'}{acc?.archived ? ' (deleted)' : ''}</span>
              <span className="metric-pill truncate" style={{ flexShrink: 0, maxWidth: '100%' }}>{tx.category}</span>
              {(tx.tags || []).slice(0, 2).map(tag => (
                <span key={tag} className="tag-pill truncate" style={{ flexShrink: 0, maxWidth: '100%' }}>#{tag}</span>
              ))}
              {(tx.tags || []).length > 2 && (
                <span className="tag-pill tag-pill-overflow" style={{ flexShrink: 0 }}>+{(tx.tags || []).length - 2}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex-col align-end" style={{ flexShrink: 0, marginLeft: '1rem', position: 'relative', zIndex: 2 }}>
          <span className="text-mono" style={{ fontWeight: 800, fontSize: '1rem', color: tx.type === 'credit' ? '#10b981' : '#ef4444' }}>
            {tx.type === 'credit' ? '+' : '-'}{formatAmount(tx.amount, acc)}
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
            fontFamily: 'var(--font-mono)',
            zIndex: 1
          }}>
            DELETE
          </div>
        )}
      </div>

      {hasCounterparts && (
        <>
          <div style={{ width: '100%', borderTop: '1px solid var(--border-color)' }} />
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            margin: '0 0.6rem 0.5rem',
            borderRadius: '0 0 20px 20px',
            overflow: 'hidden',
            borderLeft: '2px solid var(--border-color)',
            borderRight: '2px solid var(--border-color)',
            borderBottom: '2px solid var(--border-color)'
          }}>
          <button
            onClick={() => setIsCounterpartExpanded(!isCounterpartExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.4rem 1rem',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '0.72rem',
              textAlign: 'left',
              cursor: 'pointer',
              width: '100%',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              letterSpacing: '0.3px',
              transition: 'background 0.2s'
            }}
            onMouseOver={e => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          >
            <ChevronRight 
              size={12} 
              style={{ 
                transform: isCounterpartExpanded ? 'rotate(90deg)' : 'none', 
                transition: 'transform 0.2s',
                flexShrink: 0
              }} 
            />
            <span>
              {isCounterpartExpanded
                ? 'Hide linked entry'
                : (() => {
                    const cats = counterparts!.map(c => c.tx.category.toLowerCase());
                    // Investment legs all share one category, so the wording comes from the leg's kind.
                    const invKinds = counterparts!.filter(c => isInvestmentCategory(c.tx.category)).map(c => c.tx.investmentKind);
                    if (invKinds.includes('mutual_funds')) return 'Mutual fund auto-debited from bank';
                    if (invKinds.includes('stocks')) return 'Stock purchase debited from wallet';
                    if (invKinds.includes('commodity')) return 'Commodity purchase debited from bank';
                    if (invKinds.length > 0) return 'Investment auto-logged from funding account';
                    if (cats.includes('transfer')) return 'Transfer entry on destination account';
                    if (cats.includes('cc payment')) return 'Payment reflected on card';
                    if (cats.includes('ncmc travel recharge')) return 'Travel wallet top-up entry';
                    return 'Linked entry';
                  })()}
            </span>
          </button>
          
          {isCounterpartExpanded && (
            <div style={{ 
              background: 'rgba(255,255,255,0.005)',
              borderTop: '1px solid var(--border-color)'
            }}>
              {counterparts!.map(c => (
                <TransactionRow
                  key={c.tx.id}
                  tx={c.tx}
                  acc={c.acc}
                  isFirst={false}
                  isLast={false}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onMoveBy={() => false}
                  blockLen={1}
                />
              ))}
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}

export default function Transactions() {
  const { data, pendingTransfer, setPendingTransfer, smsQueue, removeFromSmsQueue, removeSmsByMatch, addTransaction, updateTransaction, reorderTransactions, deleteTransaction, updateTags, updateEventTags } = useFinance();
  const [tempCreatedActiveTags, setTempCreatedActiveTags] = useState<string[]>([]);
  const [tempCreatedEventTags, setTempCreatedEventTags] = useState<string[]>([]);
  const [newTagTargetType, setNewTagTargetType] = useState<'active' | 'event'>('active');

  const ACCOUNT_TYPE_ORDER = ['bank_account', 'credit_card', 'debit_card', 'cash', 'e_wallet', 'rewards', 'stocks', 'mutual_funds', 'commodity'];
  const sortByAccountType = (a: { type: string }, b: { type: string }) => {
    const ai = ACCOUNT_TYPE_ORDER.indexOf(a.type);
    const bi = ACCOUNT_TYPE_ORDER.indexOf(b.type);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  };

  // Guards the drag reorder against re-entrancy: touchmove can fire faster than React can
  // re-render, so without this a single fling would call onMoveBy several times against the
  // same stale render closure, each doing a full 0..N-1 renumber of the day from a snapshot
  // that no longer reflects committed state — which scrambled/reversed the untouched rows.
  // Set true the instant we apply a reorder; cleared by the effect below once the resulting
  // state actually commits (transactions reference changes), so the next crossing runs against
  // a fresh closure.
  const reorderPendingRef = useRef(false);
  useEffect(() => { reorderPendingRef.current = false; }, [data.transactions]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [processingSms, setProcessingSms] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const processNextSms = () => {
    if (smsQueue.length > 0 && !isModalOpen) {
      const tx = smsQueue[0];
      const { amount, type, merchant, source, sourceIdentifier, timestamp, relationKind } = tx;

      const cardMatch = sourceIdentifier
        ? data.accounts.find(a => a.cardDetails?.cardNumber?.endsWith(sourceIdentifier))
        : undefined;
      const matchedAccount = cardMatch ?? data.accounts.find(a => {
        const normalizedSourceName = source.toLowerCase().replace(/\s+bank$/i, '').trim();
        const normalizedAccountName = a.name.toLowerCase().replace(/\s+bank$/i, '').trim();
        return normalizedAccountName.includes(normalizedSourceName) || normalizedSourceName.includes(normalizedAccountName);
      });

      // If this SMS was detected as a leg of a linked event (e.g. the credit-card payment
      // that settles a bank debit), prefill it as that event instead of a raw expense — a
      // CC-payment confirmation on a card is a payment INTO the card, not a debit spend.
      let initialType: TransactionType = type === 'unknown' ? 'debit' : type;
      let initialCategory = '';
      if (relationKind === 'cc_payment') {
        initialCategory = 'CC Payment';
        if (matchedAccount?.type === 'credit_card') initialType = 'credit';
      } else if (relationKind === 'transfer') {
        initialCategory = 'Transfer';
      }

      setEditId(null);
      const initialTx: Partial<Transaction> = {
        date: format(new Date(timestamp), 'yyyy-MM-dd'),
        description: merchant || `Transaction via ${source}`,
        accountId: matchedAccount?.id || '',
        type: initialType,
        amount: amount,
        category: initialCategory,
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
      setErrors({});
      setIsModalOpen(true);
      setProcessingSms(true);
    }
  };

  useEffect(() => {
    if (pendingTransfer) {
      // Find the first available bank account to suggest as destination
      const bankAcc = data.accounts.find(a => a.type === 'bank_account' && !a.archived);

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
    excludedAmount: '',
    activeShare: '',
    allottedAmount: '',
    investmentCharges: '',
    numberOfShares: ''
  });

  const syncInputStrings = (tx: Partial<Transaction>) => {
    setInputStrings({
      amount: tx.amount === 0 ? '' : (tx.amount?.toString() || ''),
      rewardEarned: (tx.rewardEarned === 0 || tx.rewardEarned === undefined) ? '' : tx.rewardEarned.toString(),
      rewardUsed: (tx.rewardUsed === 0 || tx.rewardUsed === undefined) ? '' : tx.rewardUsed.toString(),
      excludedAmount: (tx.excludedAmount === 0 || tx.excludedAmount === undefined) ? '' : tx.excludedAmount.toString(),
      activeShare: (tx.excludeFromStats && tx.amount !== undefined)
        ? (() => { const s = Math.max(0, (tx.amount || 0) - (tx.excludedAmount || 0)); return s === 0 ? '' : parseFloat(s.toFixed(2)).toString(); })()
        : '',
      allottedAmount: (tx.allottedAmount === 0 || tx.allottedAmount === undefined) ? '' : tx.allottedAmount.toString(),
      investmentCharges: (tx.investmentCharges === 0 || tx.investmentCharges === undefined) ? '' : tx.investmentCharges.toString(),
      numberOfShares: (tx.numberOfShares === undefined) ? '' : tx.numberOfShares.toString()
    });
  };
  const [paymentSourceAccountId, setPaymentSourceAccountId] = useState('');
  const [ccPaymentCycleTarget, setCcPaymentCycleTarget] = useState<'current_cycle' | 'previous_statement'>('previous_statement');
  const [selectedCashbackLevelId, setSelectedCashbackLevelId] = useState('');
  // Instant-cashback input as a percentage of the debited amount, instead of a fixed ₹ value.
  const [cashbackPercentMode, setCashbackPercentMode] = useState(false);
  const [cashbackPercentStr, setCashbackPercentStr] = useState('');
  const [showRewardSplit, setShowRewardSplit] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const rewardSplitRef = useRef<HTMLDivElement>(null);

  // When entering instant cashback as a percentage, keep rewardEarned in sync with
  // (percent × amount), recomputing whenever the percent or the debited amount changes.
  useEffect(() => {
    if (!cashbackPercentMode) return;
    const pct = parseFloat(cashbackPercentStr);
    const amt = Number(newTx.amount) || 0;
    const computed = (!isNaN(pct) && amt > 0) ? Math.round((amt * pct) / 100 * 100) / 100 : 0;
    setNewTx(prev => prev.rewardEarned === computed ? prev : { ...prev, rewardEarned: computed, rewardEarnedType: 'instant' });
  }, [cashbackPercentMode, cashbackPercentStr, newTx.amount]);
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
      // Deliberately do NOT carry cashback config (cashbackLevelId / rewardEarnedType /
      // rewardEarnedAccountId) from the matched past transaction. Cashback is per-transaction, and
      // copying the deposit account + type without an amount left a half-populated Instant Cashback
      // (account selected, ₹0) that couldn't be cleared. Keep the new tx's own clean cashback state.
    };
    setNewTx(updatedTx);
    syncInputStrings(updatedTx);
    setDescriptionSuggestions([]);
  };

  const getAccountIcon = (accId: string) => {
    if (accId === 'all') return <Activity size={18} />;
    const acc = data.accounts.find(a => a.id === accId);
    if (!acc) return <Wallet size={18} />;
    return getAccountTypeIcon(acc.type, 18, acc.archived);
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  // Filters state
  const [filterType, setFilterType] = useState<'all' | 'debit' | 'credit'>('all');
  const [filterAccountId, setFilterAccountId] = useState<string[]>(['all']);
  const [filterCategory, setFilterCategory] = useState<string[]>(['all']);
  // Sub-filter for the Investments category: 'Investments' alone can't separate a fund SIP from a
  // gold buy, so this narrows by kind. Only meaningful while an investment category is filtered on.
  const [filterInvestmentKind, setFilterInvestmentKind] = useState<string[]>(['all']);
  const [filterMonth, setFilterMonth] = useState<string[]>(['all']);
  const [filterTag, setFilterTag] = useState<string[]>(['all']);
  const [searchQuery, setSearchQuery] = useState('');

  const [showFilters, setShowFilters] = useState(false);

  // Which investment the form is currently logging — the single discriminator every
  // investment-specific field, account filter and auto-description below reads. Guarded on the
  // category so a stale kind left over from a previous selection can't leak into a non-investment log.
  const activeInvestmentKind: InvestmentKind | undefined =
    isInvestmentCategory(newTx.category) ? newTx.investmentKind : undefined;

  // The holding account for a kind, found on whichever leg carries it (main account or counterpart).
  const investmentAccountAmong = (kind: InvestmentKind, accountIds: (string | undefined)[]) => {
    const wantType = investmentAccountTypeFor(kind);
    return accountIds
      .map(id => (id ? data.accounts.find(a => a.id === id) : undefined))
      .find(a => a?.type === wantType);
  };
  // Investment logs are auto-named after the holding account (e.g. "Parag Parikh Flexi Cap Fund"),
  // falling back to the kind's own label until an account is picked.
  const investmentDescriptionFor = (kind: InvestmentKind, accountIds: (string | undefined)[]) =>
    investmentAccountAmong(kind, accountIds)?.name || investmentKindLabel(kind);

  // Picking a category — and, for Investments, picking the kind — settles the same five things: the
  // auto-filled description, which account selections are still valid, whether the amount splits into
  // invested + charges, whether a quantity applies, and the passive-log toggle. The Category picker
  // and the Investment Type sub-picker both route through here so they can never disagree.
  const applyCategorySelection = (nextCategory: string, nextKind?: InvestmentKind) => {
    const currentDesc = newTx.description || '';
    const isNcmcAccount = !!data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled;
    const prevKind = activeInvestmentKind;
    const wasInvestment = isInvestmentCategory(newTx.category);
    const isNowInvestment = isInvestmentCategory(nextCategory);

    // Transfer auto-fill / clear
    const wasTransfer = newTx.category?.toLowerCase() === 'transfer';
    const isNowTransfer = nextCategory.toLowerCase() === 'transfer';
    const isTransferAutoFilled = currentDesc.startsWith('Transfer to ') || currentDesc.startsWith('Transfer from ');

    // CC Payment auto-fill / clear
    const wasCC = newTx.category?.toLowerCase() === 'cc payment';
    const isNowCC = nextCategory.toLowerCase() === 'cc payment';
    const isCCAutoFilled = currentDesc === 'CC Bill Payment' || currentDesc.startsWith('CC Payment: ');
    const wasNcmc = newTx.category?.toLowerCase() === 'ncmc travel recharge';
    const isNowNcmc = nextCategory.toLowerCase() === 'ncmc travel recharge';
    const isNcmcAutoFilled = currentDesc === 'NCMC Travel Recharge';

    // Investment auto-fill / clear: the description counts as ours only while it still matches what
    // we'd generate for the kind being left, so a name the user typed themselves is never discarded.
    const isInvAutoFilled = !!prevKind
      && currentDesc === investmentDescriptionFor(prevKind, [newTx.accountId, paymentSourceAccountId]);

    let updatedDesc = currentDesc;
    if (wasTransfer && !isNowTransfer && isTransferAutoFilled) {
      updatedDesc = '';
    } else if (wasCC && !isNowCC && isCCAutoFilled) {
      // Leaving CC Payment — clear CC auto-fill
      updatedDesc = '';
    } else if (wasNcmc && !isNowNcmc && (isNcmcAutoFilled || currentDesc === 'Transfer to Travel Wallet')) {
      updatedDesc = '';
    } else if (prevKind && !nextKind && isInvAutoFilled) {
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
    } else if (nextKind) {
      // Entering investments or switching kind — regenerate from the new kind's holding account.
      if (currentDesc === '' || isInvAutoFilled || isTransferAutoFilled || isCCAutoFilled || isNcmcAutoFilled) {
        updatedDesc = investmentDescriptionFor(nextKind, [newTx.accountId, paymentSourceAccountId]);
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

    if (nextKind) {
      // Keep the chosen account only if it's still valid for this kind and direction — otherwise a
      // fund→stock switch would silently save the buy against a mutual-fund account.
      const currentAcc = data.accounts.find(a => a.id === updatedAccountId);
      const isValid = !!currentAcc && (newTx.type === 'credit'
        ? currentAcc.type === investmentAccountTypeFor(nextKind)
        : (currentAcc.type === 'bank_account' || currentAcc.type === 'e_wallet'));
      if (!isValid) updatedAccountId = '';
    }
    // The counterpart's valid types depend on the kind, so any change of kind (or crossing the
    // investment boundary at all) invalidates whatever was picked.
    if (isNowInvestment !== wasInvestment || nextKind !== prevKind) {
      setPaymentSourceAccountId('');
    }

    const hidesPassiveToggle = ['transfer', 'cc payment', 'ncmc travel recharge', 'lending & borrowing'].includes(nextCategory.toLowerCase());
    // Funds and stocks quote an invested amount with AMC/brokerage on top; a commodity buy is a
    // single gross amount, so it gets no allotted/charges pair.
    const splitsCharges = nextKind === 'mutual_funds' || nextKind === 'stocks';
    const nextAllotted = splitsCharges ? (newTx.allottedAmount || newTx.amount || 0) : undefined;
    const nextCharges = splitsCharges ? (newTx.investmentCharges || 0) : undefined;
    // A quantity only survives while the kind that measures it does — units, shares and grams
    // aren't interchangeable.
    const nextShares = (nextKind && nextKind === prevKind) ? newTx.numberOfShares : undefined;
    setNewTx({
      ...newTx,
      category: nextCategory,
      investmentKind: nextKind,
      description: updatedDesc,
      accountId: updatedAccountId,
      isTravelTransaction: updatedIsTravel,
      allottedAmount: nextAllotted,
      investmentCharges: nextCharges,
      numberOfShares: nextShares,
      excludeFromStats: hidesPassiveToggle ? false : newTx.excludeFromStats,
      excludedAmount: hidesPassiveToggle ? undefined : newTx.excludedAmount
    });
    setInputStrings(s => ({
      ...s,
      allottedAmount: (nextAllotted === undefined || nextAllotted === 0) ? '' : nextAllotted.toString(),
      investmentCharges: (nextCharges === undefined || nextCharges === 0) ? '' : nextCharges.toString(),
      numberOfShares: nextShares === undefined ? '' : nextShares.toString()
    }));
    if (errors.category || errors.investmentKind) {
      const newErr = { ...errors };
      delete newErr.category;
      delete newErr.investmentKind;
      setErrors(newErr);
    }
  };

  const handleSave = () => {
    console.log("=== handleSave TRIGGERED ===");
    console.log("newTx State:", newTx);
    const newErrors: Record<string, string> = {};
    if (!newTx.date) newErrors.date = 'Date is required';
    if (!newTx.description) newErrors.description = 'Description is required';
    if (!newTx.amount) newErrors.amount = 'Amount is required';
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
    if (newTx.excludeFromStats && (newTx.excludedAmount || 0) > (newTx.amount || 0)) {
      newErrors.excludedAmount = 'Cannot exclude more than total amount';
    }
    if (newTx.rewardEarnedType === 'instant' && (Number(newTx.rewardEarned) || 0) > 0 && !newTx.rewardEarnedAccountId) {
      newErrors.rewardEarnedAccountId = 'Deposit account is required for instant cashback';
    }
    if (newTx.rewardEarnedAccountId && (Number(newTx.rewardEarned) || 0) <= 0) {
      newErrors.rewardEarned = 'Cashback amount is required when deposit account is selected';
    }
    if (showRewardSplit && (Number(newTx.rewardUsed) || 0) > 0 && !newTx.rewardUsedAccountId) {
      newErrors.rewardUsedAccountId = 'Reward account is required';
    }
    if (showRewardSplit && newTx.rewardUsedAccountId && (Number(newTx.rewardUsed) || 0) <= 0) {
      newErrors.rewardUsed = 'Reward amount is required when reward account is selected';
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
      return;
    }
    console.log("Validation Passed! Saving transaction...");
    setErrors({});

    if (tempCreatedActiveTags.length > 0) {
      const currentActive = data.tags || [];
      const toAdd = tempCreatedActiveTags.filter(t => !currentActive.includes(t));
      if (toAdd.length > 0) {
        updateTags([...currentActive, ...toAdd]);
      }
    }
    if (tempCreatedEventTags.length > 0) {
      const currentEvent = data.eventTags || [];
      const toAdd = tempCreatedEventTags.filter(t => !currentEvent.includes(t));
      if (toAdd.length > 0) {
        updateEventTags([...currentEvent, ...toAdd]);
      }
    }

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

    // Linked counterpart (child leg) creation. Edit/delete sync behavior is documented in
    // docs/LINKED_TRANSACTIONS.md — keep that matrix accurate when changing this block.
    const isTransfer = newTx.category?.toLowerCase() === 'transfer';
    const isCCPayment = newTx.category?.toLowerCase() === 'cc payment';
    const hidesPassiveToggleFinal = ['transfer', 'cc payment', 'ncmc travel recharge', 'lending & borrowing'].includes((newTx.category || '').toLowerCase());
    const investmentKind = activeInvestmentKind;
    const isMf = investmentKind === 'mutual_funds';
    const isStocks = investmentKind === 'stocks';
    const isCommodity = investmentKind === 'commodity';
    // "isInvestment" here means the allotted-vs-charges pair applies (funds and stocks quote an
    // invested amount plus AMC/brokerage on top). Commodity buys are a single gross amount.
    const isInvestment = isMf || isStocks;
    const allottedAmount = isInvestment ? (newTx.allottedAmount !== undefined ? Number(newTx.allottedAmount) : Number(newTx.amount)) : Number(newTx.amount);
    const investmentCharges = isInvestment ? (newTx.investmentCharges !== undefined ? Number(newTx.investmentCharges) : Math.max(0, Number(newTx.amount) - allottedAmount)) : undefined;

    // Does an investment counterpart leg already exist (i.e. we're editing, not creating)? If so,
    // we skip re-creating it here — updateTransaction() in FinanceContext keeps it in sync, and
    // clears it when the pairing/category is removed. We only create a leg when there isn't one
    // yet, which also covers converting a plain log into an investment via edit.
    const hasLinkedCategoryLeg = (catLower: string) => currentLinkedIds.some(id => {
      const lt = data.transactions.find(t => t.id === id);
      return !!lt && lt.id !== mainTxId && lt.category?.toLowerCase() === catLower;
    });
    // All three investment kinds share one category, so an existing leg is matched on kind. A leg
    // whose kind can't be resolved still counts as this kind's leg: it IS the investment counterpart
    // (nothing else links here), and treating it as absent would create a second, duplicate leg.
    const hasLinkedInvestmentLeg = (kind: InvestmentKind) => currentLinkedIds.some(id => {
      const lt = data.transactions.find(t => t.id === id);
      if (!lt || lt.id === mainTxId || !isInvestmentCategory(lt.category)) return false;
      const legKind = getInvestmentKind(lt, data.accounts);
      return legKind === undefined || legKind === kind;
    });
    const hasStocksLeg = hasLinkedInvestmentLeg('stocks');
    const hasMfLeg = hasLinkedInvestmentLeg('mutual_funds');
    const hasCommodityLeg = hasLinkedInvestmentLeg('commodity');
    const hasTransferOrCCLeg = hasLinkedCategoryLeg('transfer') || hasLinkedCategoryLeg('cc payment');

    // A reward split always anchors on the CARD leg (whose amount is the full bill), per
    // docs/LINKED_TRANSACTIONS.md. Logged from Credit POV the card IS the main tx, so it holds the
    // anchor (rewardUsed + the reward leg) naturally. Logged from Debit POV the card is the counterpart,
    // so we move the anchor onto it and keep the bank main tx as a plain funding child. Without this,
    // the anchor would sit on the bank leg (partial amount ₹148) and both openEditModal reconstruction
    // and updateTransaction's Option-B rebalance would use the wrong total.
    const isCcRewardSplit = isCCPayment && showRewardSplit && (Number(newTx.rewardUsed) || 0) > 0 && !!newTx.rewardUsedAccountId && !editId;
    const anchorOnCounterpart = isCcRewardSplit && newTx.type === 'debit';
    const rewardCounterpartId = isCcRewardSplit ? generateId() : null;
    let cardAnchorId: string | null = null;

    if (isStocks && paymentSourceAccountId && !hasStocksLeg) {
      const bankCounterpartId = generateId();
      currentLinkedIds.push(bankCounterpartId);
      const counterpartType = newTx.type === 'credit' ? 'debit' : 'credit';
      addTransaction({
        id: bankCounterpartId,
        date: newTx.date as string,
        description: newTx.description as string,
        accountId: paymentSourceAccountId,
        type: counterpartType,
        amount: counterpartType === 'credit' ? allottedAmount : (allottedAmount + (investmentCharges || 0)),
        category: INVESTMENT_CATEGORY,
        investmentKind: 'stocks',
        isRecurring: false,
        linkedTransactionIds: [mainTxId],
        numberOfShares: newTx.numberOfShares,
        allottedAmount: allottedAmount,
        investmentCharges: investmentCharges
      });
    } else if (isCommodity && paymentSourceAccountId && !hasCommodityLeg) {
      const bankCounterpartId = generateId();
      currentLinkedIds.push(bankCounterpartId);
      const counterpartType = newTx.type === 'credit' ? 'debit' : 'credit';
      addTransaction({
        id: bankCounterpartId,
        date: newTx.date as string,
        description: newTx.description as string,
        accountId: paymentSourceAccountId,
        type: counterpartType,
        amount: Number(newTx.amount),
        category: INVESTMENT_CATEGORY,
        investmentKind: 'commodity',
        isRecurring: false,
        linkedTransactionIds: [mainTxId],
        numberOfShares: newTx.numberOfShares
      });
    } else if (isMf && paymentSourceAccountId && !hasMfLeg) {
      const bankCounterpartId = generateId();
      currentLinkedIds.push(bankCounterpartId);
      const counterpartType = newTx.type === 'debit' ? 'credit' : 'debit';

      addTransaction({
        id: bankCounterpartId,
        date: newTx.date as string,
        description: newTx.description as string,
        accountId: paymentSourceAccountId,
        type: counterpartType,
        amount: counterpartType === 'credit' ? allottedAmount : (allottedAmount + (investmentCharges || 0)),
        category: INVESTMENT_CATEGORY,
        investmentKind: 'mutual_funds',
        isRecurring: false,
        linkedTransactionIds: [mainTxId],
        allottedAmount: allottedAmount,
        investmentCharges: investmentCharges,
        numberOfShares: newTx.numberOfShares
      });
    } else if ((isTransfer || isCCPayment) && paymentSourceAccountId && !hasTransferOrCCLeg) {
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
      // The receiving/credit leg (e.g. CC bill reduction) must reflect the FULL payment
      // (bank portion + rewards portion). Only the funding/debit leg is reduced by rewards.
      const counterpartAmount = counterpartType === 'credit' ? Number(newTx.amount) : bankPortion;

      // Debit POV split: this credit counterpart IS the card, so it becomes the split anchor —
      // it holds rewardUsed + links to both the bank main tx and the reward leg. (Credit POV keeps
      // the anchor on the main tx, so this leg stays a plain counterpart.)
      const isCardAnchorLeg = anchorOnCounterpart && counterpartType === 'credit';
      if (isCardAnchorLeg) cardAnchorId = bankCounterpartId;

      addTransaction({
        id: bankCounterpartId,
        date: newTx.date as string,
        description: counterpartDesc,
        accountId: paymentSourceAccountId,
        type: counterpartType,
        amount: counterpartAmount,
        category: isCCPayment ? 'CC Payment' : 'Transfer',
        isRecurring: false,
        linkedTransactionIds: isCardAnchorLeg ? [mainTxId, rewardCounterpartId as string] : [mainTxId],
        rewardUsed: isCardAnchorLeg ? rewardUsedForTransfer : undefined,
        rewardUsedAccountId: isCardAnchorLeg ? newTx.rewardUsedAccountId : undefined,
        appliedBillingCycleYearMonth: isCCPayment && counterpartType === 'credit' && destAccount?.type === 'credit_card'
          ? resolveCcPaymentCycle(newTx.date as string, destAccount.statementDay)
          : undefined
      });

      if (isCCPayment && newTx.type === 'credit') finalCategory = 'CC Payment';
    }

    const rewardUsed = showRewardSplit ? (Number(newTx.rewardUsed) || 0) : 0;
    if (rewardUsed > 0 && newTx.rewardUsedAccountId && !editId) {
      const rewardLegId = rewardCounterpartId as string;
      // Debit POV: link the reward leg to the card anchor and keep it OFF the bank main tx's link list
      // (the card is the hub). Credit POV: the main tx IS the card, so link to it as before.
      if (!anchorOnCounterpart) currentLinkedIds.push(rewardLegId);
      const rewardsSourceAcc = data.accounts.find(a => a.id === newTx.rewardUsedAccountId);
      const isInternalPoints = !!(rewardsSourceAcc?.isCashbackEnabled && rewardsSourceAcc?.rewardType === 'points');
      // The rewards pay down the CARD's bill, not the funding bank. The card is the main account
      // when logged as a Credit (Receive), or the paymentSourceAccountId ("Pay To Card") when logged
      // as a Debit (Spend) — mirror the targetCardName logic used for the bank leg above.
      const paidCardName = (newTx.type === 'credit' ? account : data.accounts.find(a => a.id === paymentSourceAccountId))?.name;
      addTransaction({
        id: rewardLegId,
        date: newTx.date as string,
        description: isCCPayment ? `Rewards used for ${paidCardName || account?.name || 'CC'}` : `Rewards applied to: ${newTx.description}`,
        accountId: newTx.rewardUsedAccountId,
        type: 'debit',
        amount: rewardUsed,
        category: isCCPayment ? 'CC Payment' : (newTx.category as string),
        isRecurring: false,
        isRewardTransaction: isInternalPoints,
        linkedTransactionIds: [(anchorOnCounterpart && cardAnchorId) ? cardAnchorId : mainTxId]
      });
    }

    const mainAccountAmount = isInvestment 
      ? (newTx.type === 'debit' ? (allottedAmount + (investmentCharges || 0)) : allottedAmount) 
      : ((newTx.type === 'debit')
        ? Math.max(0, Number(newTx.amount) - rewardUsed)
        : Number(newTx.amount));

    // On edit, updateTransaction syncs an EXISTING linked cashback leg but won't create one.
    // So create the leg here when instant cashback is configured but no cashback leg exists yet
    // (covers both new transactions and edits that add cashback for the first time).
    const hasExistingCashbackLeg = editId
      ? data.transactions.some(t => currentLinkedIds.includes(t.id) && t.category === 'Cashback')
      : false;
    if (newTx.rewardEarnedType === 'instant' && (newTx.rewardEarned || 0) > 0 && newTx.rewardEarnedAccountId && !hasExistingCashbackLeg) {
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
      // Debit POV split: the anchor (rewardUsed) lives on the card counterpart, not this bank main tx.
      rewardUsed: anchorOnCounterpart ? 0 : rewardUsed,
      rewardUsedAccountId: anchorOnCounterpart ? undefined : newTx.rewardUsedAccountId,
      isTravelTransaction: newTx.isTravelTransaction,
      linkedTransactionIds: currentLinkedIds,
      cashbackLevelId: selectedCashbackLevelId,
      excludeFromStats: hidesPassiveToggleFinal ? false : newTx.excludeFromStats,
      excludedAmount: (!hidesPassiveToggleFinal && newTx.excludeFromStats) ? newTx.excludedAmount : undefined,
      paymentSourceAccountId: paymentSourceAccountId,
      allottedAmount: isInvestment ? allottedAmount : undefined,
      investmentCharges: isInvestment ? investmentCharges : undefined,
      numberOfShares: investmentKind ? newTx.numberOfShares : undefined,
      investmentKind: investmentKind,
      tags: (newTx.tags || []).length > 0 ? newTx.tags : undefined,
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
    setCashbackPercentMode(false);
    setCashbackPercentStr('');
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

  const handleCreateTag = () => {
    const raw = newTagInput.trim().replace(/^#/, '');
    if (!raw) return;
    const activeTags = [...(data.tags || []), ...tempCreatedActiveTags];
    const eventTags = [...(data.eventTags || []), ...tempCreatedEventTags];
    const matchActive = activeTags.find(t => t.toLowerCase() === raw.toLowerCase());
    const matchEvent = eventTags.find(t => t.toLowerCase() === raw.toLowerCase());
    const tagToApply = matchActive || matchEvent || raw;

    if (newTagTargetType === 'active') {
      if (!matchActive && !tempCreatedActiveTags.includes(raw)) {
        setTempCreatedActiveTags(prev => [...prev, raw]);
      }
    } else {
      if (!matchEvent && !tempCreatedEventTags.includes(raw)) {
        setTempCreatedEventTags(prev => [...prev, raw]);
      }
    }

    if (!(newTx.tags || []).includes(tagToApply)) {
      setNewTx(prev => ({ ...prev, tags: [...(prev.tags || []), tagToApply] }));
    }
    setNewTagInput('');
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
    setCashbackPercentMode(false);
    setCashbackPercentStr('');
    setShowRewardSplit(false);
    setNewTagInput('');
    setTempCreatedActiveTags([]);
    setTempCreatedEventTags([]);
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (tx: Transaction) => {
    setEditId(tx.id);
    setErrors({});
    const sanitizedTx: Partial<Transaction> = {
      ...tx,
      date: tx.date.split('T')[0],
      type: (tx.type as string) === 'expense' ? 'debit' : ((tx.type as string) === 'income' ? 'credit' : tx.type)
    };

    // Find linked counterpart account (Transfer/CC payment). Reward-split and cashback child
    // legs are excluded — they reciprocate via dedicated reverse-propagation in
    // updateTransaction, not the transfer/payment leg path. See docs/LINKED_TRANSACTIONS.md.
    const linkedIds = tx.linkedTransactionIds || (tx.linkedTransactionId ? [tx.linkedTransactionId] : []);
    const linkedTxs = data.transactions.filter(t => linkedIds.includes(t.id) && t.id !== tx.id);
    const isCashbackChild = tx.category === 'Cashback';

    // A reward split anchors on the CARD leg (holds rewardUsed). Each leg opens its own modal, so we
    // reconstruct the full split context per leg: the BANK leg shows the TOTAL bill + the split (so the
    // "Primary Account Debit" line derives back to the real bank portion, matching the logging form),
    // and both the bank and reward legs show the CARD in their auto-credit picker. The stored bank
    // amount stays the portion; only the form shows the total. See docs/LINKED_TRANSACTIONS.md.
    const rewardSplitAnchor = linkedTxs.find(t => t.category?.toLowerCase() === 'cc payment' && (t.rewardUsed || 0) > 0 && !!t.rewardUsedAccountId);
    const isSplitAnchor = tx.category?.toLowerCase() === 'cc payment' && (tx.rewardUsed || 0) > 0 && !!tx.rewardUsedAccountId;
    const isSplitRewardLeg = !!rewardSplitAnchor && rewardSplitAnchor.rewardUsedAccountId === tx.accountId;
    const isSplitBankLeg = !!rewardSplitAnchor && !isSplitRewardLeg && !isSplitAnchor;

    if (isSplitBankLeg && rewardSplitAnchor) {
      sanitizedTx.amount = rewardSplitAnchor.amount;               // show the full bill (192), not the stored portion (148)
      sanitizedTx.rewardUsed = rewardSplitAnchor.rewardUsed;       // 44
      sanitizedTx.rewardUsedAccountId = rewardSplitAnchor.rewardUsedAccountId;
    }

    const isRewardChild = linkedTxs.some(p => p.rewardUsedAccountId && p.rewardUsedAccountId === tx.accountId);
    let paySrc = '';
    if ((isSplitBankLeg || isSplitRewardLeg) && rewardSplitAnchor) {
      paySrc = rewardSplitAnchor.accountId; // the card being paid
    } else if (!isRewardChild && !isCashbackChild) {
      const counterpartTx = linkedTxs.find(t => t.category !== 'Cashback' && t.accountId !== tx.rewardUsedAccountId);
      if (counterpartTx) paySrc = counterpartTx.accountId;
    }
    setPaymentSourceAccountId(paySrc);

    // Billing-cycle target ("Apply Payment To"): the cycle lives on the card leg, so for the bank/reward
    // child we read it off the anchor (and use the card's statement day), not the child's own record.
    const account = data.accounts.find(a => a.id === tx.accountId);
    const cycleFromAnchor = (isSplitBankLeg || isSplitRewardLeg) ? rewardSplitAnchor : undefined;
    if (cycleFromAnchor?.appliedBillingCycleYearMonth) {
      const cardAcc = data.accounts.find(a => a.id === cycleFromAnchor.accountId);
      const cyc = getBillingCycleForDate(sanitizedTx.date as string, cardAcc?.statementDay || 1);
      setCcPaymentCycleTarget(cycleFromAnchor.appliedBillingCycleYearMonth === cyc ? 'current_cycle' : 'previous_statement');
    } else if (account?.type === 'credit_card' && sanitizedTx.type === 'credit' && tx.appliedBillingCycleYearMonth) {
      const txCycle = getBillingCycleForDate(sanitizedTx.date as string, account.statementDay || 1);
      setCcPaymentCycleTarget(tx.appliedBillingCycleYearMonth === txCycle ? 'current_cycle' : 'previous_statement');
    } else {
      setCcPaymentCycleTarget('previous_statement');
    }
    setSelectedCashbackLevelId(tx.cashbackLevelId || '');
    setCashbackPercentMode(false);
    setCashbackPercentStr('');
    setShowRewardSplit(isSplitBankLeg || (tx.rewardUsed || 0) > 0);
    setNewTx(sanitizedTx);
    syncInputStrings(sanitizedTx);
    setTempCreatedActiveTags([]);
    setTempCreatedEventTags([]);
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
      // Investment-kind sub-filter. Only constrains investment transactions — filtering by kind
      // alongside other categories shouldn't wipe out those other categories' rows. The kind is read
      // via getInvestmentKind so legacy rows the backfill couldn't reach still match by account type.
      const matchesInvestmentKind = filterInvestmentKind.includes('all')
        || !isInvestmentCategory(tx.category)
        || filterInvestmentKind.includes(getInvestmentKind(tx, data.accounts) ?? '');
      const matchesMonth = filterMonth.includes('all') || filterMonth.includes(tx.date.substring(0, 7));
      const matchesTag = filterTag.includes('all') || (tx.tags || []).some(t => filterTag.includes(t));
      const matchesSearch = tx.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tx.category.toLowerCase().includes(searchQuery.toLowerCase());

      const today = format(new Date(), 'yyyy-MM-dd');
      const isFuture = tx.date > today;

      return matchesType && matchesAccount && matchesCategory && matchesInvestmentKind && matchesMonth && matchesTag && matchesSearch && !isFuture && tx.amount > 0;
    });

  useEffect(() => {
    const handleTourEdit = () => {
      const firstTx = filteredTransactions.find(t => t.id.startsWith('demo_')) || filteredTransactions[0];
      if (firstTx) {
        openEditModal(firstTx);
      }
    };
    const handleTourCloseEdit = () => {
      const modalContent = document.querySelector('.modal-content');
      const modalOverlay = document.querySelector('.modal-overlay');
      if (modalContent) {
        if (modalOverlay) modalOverlay.classList.add('tour-modal-overlay-closing');
        modalContent.classList.add('tour-modal-closing');
        setTimeout(() => setIsModalOpen(false), 350);
      } else {
        setIsModalOpen(false);
      }
    };

    window.addEventListener('tour-open-edit', handleTourEdit);
    window.addEventListener('tour-close-edit', handleTourCloseEdit);
    return () => {
      window.removeEventListener('tour-open-edit', handleTourEdit);
      window.removeEventListener('tour-close-edit', handleTourCloseEdit);
    };
  }, [filteredTransactions]);

  // The investment-kind picker only shows while an investment category is being filtered on, so a
  // stale kind must still count as active — otherwise switching category away from Investments would
  // silently keep filtering by a kind with no visible control to clear it.
  const isInvestmentFilterVisible = !filterCategory.includes('all')
    && filterCategory.some(c => isInvestmentCategory(c));
  const isFilterActive = filterType !== 'all' || !filterAccountId.includes('all') || !filterCategory.includes('all') || !filterInvestmentKind.includes('all') || !filterMonth.includes('all') || !filterTag.includes('all') || searchQuery !== '';

  const clearFilters = () => {
    setFilterType('all');
    setFilterAccountId(['all']);
    setFilterCategory(['all']);
    setFilterInvestmentKind(['all']);
    setFilterMonth(['all']);
    setFilterTag(['all']);
    setSearchQuery('');
  };

  const filteredIncome = filteredTransactions.reduce((sum, tx) => {
    if (isStatsExcludedCategory(tx.category)) return sum;
    const effectiveAmount = tx.amount - (tx.excludedAmount || (tx.excludeFromStats ? tx.amount : 0));
    return sum + (tx.type === 'credit' ? effectiveAmount : 0);
  }, 0);
  const filteredSpend = filteredTransactions.reduce((sum, tx) => {
    if (isStatsExcludedCategory(tx.category)) return sum;
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
    <div className="flex-col gap-6 transactions-tab-root">
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
              <span className="text-xs text-muted">
                {smsQueue[0]?.relationKind === 'cc_payment' ? 'Next: linked card payment — pre-filled as CC Payment'
                  : smsQueue[0]?.relationKind === 'transfer' ? 'Next: linked transfer leg'
                  : smsQueue[0]?.relationKind === 'investment' ? 'Next: linked investment leg'
                  : 'Tap to review and log'}
              </span>
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
              className="btn btn-primary"
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
                    onClick={() => { setFilterCategory(['all']); setFilterInvestmentKind(['all']); }}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {!filterInvestmentKind.includes('all') && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
                    {filterInvestmentKind.length === 1
                      ? investmentKindLabel(filterInvestmentKind[0] as InvestmentKind)
                      : `${filterInvestmentKind.length} Investment Types`}
                  </span>
                  <div
                    onClick={() => setFilterInvestmentKind(['all'])}
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
              )}
              {!filterTag.includes('all') && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <Hash size={11} style={{ color: 'var(--accent)', opacity: 0.8 }} />
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--accent)', letterSpacing: '0.5px' }}>
                    {filterTag.length === 1
                      ? filterTag[0]
                      : (filterTag.length === 2
                        ? `${filterTag[0]} + ${filterTag[1]}`
                        : `${filterTag.length} Tags`)}
                  </span>
                  <div onClick={() => setFilterTag(['all'])} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}>
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
            <div className="flex-col gap-1" style={{ minWidth: 0 }}>
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
            <div className="flex-col gap-1" style={{ minWidth: 0 }}>
              <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Account</label>
              <CustomPicker
                label="Account"
                hideLabel={true}
                value={filterAccountId}
                isMulti={true}
                options={[
                  { id: 'all', name: 'All Accounts' },
                  // Keep archived accounts here so their history is still filterable, just labelled
                  // and pushed to the end of the list.
                  ...data.accounts
                    .filter(a => !a.archived)
                    .sort((a, b) => sortByAccountType(a, b))
                    .map(a => ({ id: a.id, name: a.name, group: getAccountGroupLabel(a.type, false) })),
                  ...data.accounts
                    .filter(a => a.archived)
                    .sort((a, b) => sortByAccountType(a, b))
                    .map(a => ({ id: a.id, name: `${a.name} (deleted)`, group: 'Archived Accounts' }))
                ]}
                onChange={setFilterAccountId}
                iconGetter={(id) => id === 'all' ? <Wallet size={18} /> : getAccountIcon(id)}
              />
            </div>
            <div className="flex-col gap-1" style={{ minWidth: 0 }}>
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
                onChange={(vals: string[]) => {
                  setFilterCategory(vals);
                  // Deselecting Investments hides the kind picker, so drop the kind with it rather
                  // than leaving an invisible filter narrowing the results.
                  const stillInvestments = !vals.includes('all') && vals.some(c => isInvestmentCategory(c));
                  if (!stillInvestments) setFilterInvestmentKind(['all']);
                }}
                iconGetter={(c) => c === 'all' ? <Shapes size={17} /> : getCategoryIcon(c)}
              />
            </div>
            {isInvestmentFilterVisible && (
              <div className="flex-col gap-1" style={{ minWidth: 0 }}>
                <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Investment Type</label>
                <CustomPicker
                  label="Investment Type"
                  hideLabel={true}
                  value={filterInvestmentKind}
                  isMulti={true}
                  options={[
                    { id: 'all', name: 'All Investment Types' },
                    ...INVESTMENT_KIND_OPTIONS.map(o => ({ id: o.id as string, name: o.name }))
                  ]}
                  onChange={setFilterInvestmentKind}
                  // Layers, not Shapes: Shapes is the "All Categories" glyph one row above, so both
                  // "All" rows rendered identically while an investment category was filtered on.
                  iconGetter={(k) => k === 'all' ? <Layers size={17} /> : getInvestmentKindIcon(k, 17)}
                />
              </div>
            )}
            {(data.tags || []).length > 0 && (
              <div className="flex-col gap-1" style={{ minWidth: 0 }}>
                <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Tag</label>
                <CustomPicker
                  label="Tag"
                  hideLabel={true}
                  value={filterTag}
                  isMulti={true}
                  enableSearch={true}
                  searchPlaceholder="Search active & event tags..."
                  options={[
                    { id: 'all', name: 'All Tags' },
                    ...(data.tags || []).map(t => ({ id: t, name: `#${t}` })),
                    ...(data.eventTags || []).map(t => ({ id: t, name: `#${t}`, subtext: 'Event Tag', group: 'Event Tags', showOnlyOnSearch: true }))
                  ]}
                  onChange={setFilterTag}
                  iconGetter={() => <Hash size={16} />}
                />
              </div>
            )}
            <div className="flex-col gap-1" style={{ minWidth: 0 }}>
              <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Month</label>
              <CustomPicker
                label="Month"
                hideLabel={true}
                value={filterMonth}
                isMulti={true}
                defaultGroupExpanded={true}
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
                    className={`flex justify-between align-center ${monthStr === getCurrentMonthStr() ? 'tour-demo-month-header' : ''}`}
                    style={{ padding: '0.75rem 1.5rem', backgroundColor: 'var(--bg-hover)', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                    onClick={() => toggleMonth(monthStr)}
                  >
                    <span className="text-mono" style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.85rem', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{monthLabel}</span>
                    <div className="flex align-center gap-2 text-mono text-muted" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                      <span>{txsInMonth.filter(isCountableTransaction).length} transactions</span>
                      <ChevronDown
                        size={14}
                        style={{
                          transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                          transition: 'transform 0.2s ease',
                          opacity: 0.7
                        }}
                      />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="fade-in">
                      {Object.entries(groupedByDate).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()).map(([date, txs]) => {
                        const allTxsOnDate = data.transactions.filter(t => t.date === date);
                        const sortedAllTxsOnDate = [...allTxsOnDate].sort((a, b) => {
                          const orderA = a.order !== undefined ? a.order : allTxsOnDate.indexOf(a);
                          const orderB = b.order !== undefined ? b.order : allTxsOnDate.indexOf(b);
                          return orderA - orderB;
                        });
                        const sortedTxs = [...txs].sort((a, b) => {
                          return sortedAllTxsOnDate.indexOf(a) - sortedAllTxsOnDate.indexOf(b);
                        });
                        const dailyIncome = txs.reduce((sum, t) => {
                          if (isStatsExcludedCategory(t.category)) return sum;
                          const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
                          return sum + (t.type === 'credit' ? effectiveAmount : 0);
                        }, 0);
                        const dailySpend = txs.reduce((sum, t) => {
                          if (isStatsExcludedCategory(t.category)) return sum;
                          const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
                          return sum + (t.type === 'debit' ? effectiveAmount : 0);
                        }, 0);
                        // Target date for Starbucks/Uber/Netflix demo transactions is getRelativeDate(0) which is today.
                        const isDemoDay = (() => {
                          const targetDateStr = new Date().toISOString().split('T')[0];
                          return date === targetDateStr;
                        })();

                        return (
                          <React.Fragment key={date}>
                            <div className="flex justify-between align-center" style={{ backgroundColor: 'rgba(99,102,241,0.06)', fontWeight: 700, color: 'var(--accent)', padding: '0.5rem 1.5rem', fontSize: '0.7rem', borderBottom: '2px solid rgba(99,102,241,0.2)', borderTop: '2px solid rgba(99,102,241,0.2)', letterSpacing: '0.5px' }}>
                              <span className="text-mono" style={{ textTransform: 'uppercase', letterSpacing: '1px' }}>{formatDateString(date)}</span>
                              <div className="flex gap-3">
                                {dailyIncome > 0 && <span style={{ color: 'var(--success)' }}>+{formatCurrency(dailyIncome)}</span>}
                                {dailySpend > 0 && <span style={{ color: 'var(--danger)' }}>-{formatCurrency(dailySpend)}</span>}
                              </div>
                            </div>
                            <div className={isDemoDay ? 'tour-demo-day-group' : ''}>
                              {(() => {
                                const collapsedTxIds = new Set<string>();
                                const txCounterpartsMap = new Map<string, { tx: Transaction; acc: Account | undefined }[]>();

                                sortedTxs.forEach(t => {
                                  if (collapsedTxIds.has(t.id)) return;

                                  const linkedIds = t.linkedTransactionIds || (t.linkedTransactionId ? [t.linkedTransactionId] : []);
                                  if (linkedIds.length > 0) {
                                    // Linked legs use a STAR topology (children link only to the parent,
                                    // not to each other). A 1-hop filter from a child misses its siblings,
                                    // so also pull in txs that link to the same parent(s) `t` links to.
                                    // Without this, a 3-leg group (e.g. reward split: card + bank + reward)
                                    // whose parent is iterated AFTER its children maps only the last child
                                    // and silently hides the other leg. See docs/LINKED_TRANSACTIONS.md.
                                    const group = sortedTxs.filter(other =>
                                      other.id === t.id ||
                                      linkedIds.includes(other.id) ||
                                      (other.linkedTransactionIds && other.linkedTransactionIds.includes(t.id)) ||
                                      linkedIds.some(pid => other.linkedTransactionIds?.includes(pid))
                                    );

                                    const uncollapsedInGroup = group.filter(other => !collapsedTxIds.has(other.id));
                                    if (uncollapsedInGroup.length > 1) {
                                      const debitParent = uncollapsedInGroup.find(other => other.type === 'debit');
                                      const creditParent = uncollapsedInGroup.find(other => other.type === 'credit');
                                      // Groups whose CREDIT leg is the one worth showing as the parent
                                      // row. Every investment qualifies: the holding account receiving
                                      // the units/shares/grams is the point of the entry, and the bank
                                      // debit is just how it was funded. (Commodity used to be the odd
                                      // one out here, showing its funding leg as the parent.)
                                      const creditCategories = ['cc payment', 'transfer', 'ncmc travel recharge'];
                                      const isCreditParentGroup = uncollapsedInGroup.some(other =>
                                        creditCategories.includes(other.category?.toLowerCase() ?? '')
                                        || isInvestmentCategory(other.category)
                                      );
                                      const parent = isCreditParentGroup ? (creditParent || uncollapsedInGroup[0]) : (debitParent || uncollapsedInGroup[0]);
                                      const counterpartsList = uncollapsedInGroup.filter(other => other.id !== parent.id);

                                      counterpartsList.forEach(cp => {
                                        collapsedTxIds.add(cp.id);
                                      });

                                      const resolvedCParts = counterpartsList.map(cp => ({
                                        tx: cp,
                                        acc: data.accounts.find(a => a.id === cp.accountId)
                                      }));

                                      txCounterpartsMap.set(parent.id, resolvedCParts);
                                    }
                                  }
                                });

                                return sortedTxs.map((tx) => {
                                  if (collapsedTxIds.has(tx.id)) return null;

                                  const linkedIds = tx.linkedTransactionIds || (tx.linkedTransactionId ? [tx.linkedTransactionId] : []);
                                  const group = sortedTxs.filter(t =>
                                    t.id === tx.id ||
                                    linkedIds.includes(t.id) ||
                                    (t.linkedTransactionIds && t.linkedTransactionIds.includes(tx.id)) ||
                                    linkedIds.some(pid => t.linkedTransactionIds?.includes(pid))
                                  );
                                  const firstGroupIdx = sortedTxs.indexOf(group[0]);
                                  const lastGroupIdx = sortedTxs.indexOf(group[group.length - 1]);
                                  const isFirstInGroupAndList = firstGroupIdx === 0;
                                  const isLastInGroupAndList = lastGroupIdx === sortedTxs.length - 1;
                                  const groupBlockLen = lastGroupIdx - firstGroupIdx + 1;

                                  return (
                                    <TransactionRow
                                      key={tx.id}
                                      tx={tx}
                                      acc={data.accounts.find(a => a.id === tx.accountId)}
                                      isFirst={isFirstInGroupAndList}
                                      isLast={isLastInGroupAndList}
                                      onEdit={openEditModal}
                                      onDelete={handleDelete}
                                      blockLen={groupBlockLen}
                                      onMoveBy={(steps) => {
                                        // Reposition the whole (possibly linked) group by `steps`
                                        // slots within this date in one shot, then renumber the
                                        // date's order field 0..N-1. Single pass keeps the dragged
                                        // row locked to the finger even on fast multi-row drags.
                                        //
                                        // Bail if a prior reorder from this same drag hasn't committed
                                        // yet: our `sortedTxs`/`firstGroupIdx` closure would be stale and
                                        // the renumber would fight the in-flight one. Returning false tells
                                        // the row not to consume this crossing so it retries post-commit.
                                        if (reorderPendingRef.current) return false;
                                        const blockLen = lastGroupIdx - firstGroupIdx + 1;
                                        const list = [...sortedTxs];
                                        const block = list.splice(firstGroupIdx, blockLen);
                                        let insertAt = firstGroupIdx + steps;
                                        if (insertAt < 0) insertAt = 0;
                                        if (insertAt > list.length) insertAt = list.length;
                                        list.splice(insertAt, 0, ...block);
                                        const updates: Transaction[] = [];
                                        list.forEach((t, i) => {
                                          if (t.order !== i) updates.push({ ...t, order: i });
                                        });
                                        if (updates.length) {
                                          reorderPendingRef.current = true;
                                          reorderTransactions(...updates);
                                        }
                                        return true;
                                      }}
                                      counterparts={txCounterpartsMap.get(tx.id)}
                                    />
                                  );
                                });
                              })()}
                            </div>
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

      {/* DUPLICATE MODAL WARNING: this inline Log/Edit Transaction form is a separate,
          independent implementation from TransactionModal.tsx (used by the Upcoming Bills
          "LOG" button and other initialData-driven quick-log entry points). They are NOT
          the same component. Changing amount/decimal parsing, mutual-fund/stock allotted-vs-charges
          logic, reward-split handling, or account-icon rendering here must be mirrored in
          TransactionModal.tsx (and vice versa), or the two log forms will silently drift
          apart again. */}
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
                        const isInvestment = activeInvestmentKind === 'mutual_funds' || activeInvestmentKind === 'stocks';
                        const allotted = newTx.allottedAmount || 0;
                        const charges = isInvestment ? Math.max(0, finalAmount - allotted) : undefined;

                        setNewTx(prev => ({
                          ...prev,
                          amount: finalAmount,
                          investmentCharges: charges !== undefined ? parseFloat(charges.toFixed(2)) : undefined
                        }));
                        setInputStrings(s => ({
                          ...s,
                          amount: val,
                          investmentCharges: charges !== undefined ? (parseFloat(charges.toFixed(2)) === 0 ? '' : parseFloat(charges.toFixed(2)).toString()) : s.investmentCharges,
                          // Excluded amount is authoritative; refresh the derived active-share field
                          // so it stays consistent when the total changes.
                          activeShare: newTx.excludeFromStats
                            ? (() => { const share = Math.max(0, finalAmount - (newTx.excludedAmount || 0)); return share === 0 ? '' : parseFloat(share.toFixed(2)).toString(); })()
                            : s.activeShare
                        }));

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
                    { id: 'debit', name: 'Debit (Spend)', subtext: 'Money Going Out' },
                    { id: 'credit', name: 'Credit (Receive)', subtext: 'Money Coming In' }
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
                    // Flipping direction swaps which side of an investment the main account is (the
                    // holding account on a credit, the funding bank on a debit), so the picked
                    // accounts can no longer be valid. Clear them for every kind — clearing only for
                    // mutual funds used to leave stock/commodity logs pointing at the wrong account type.
                    if (activeInvestmentKind) {
                      updatedAccountId = '';
                      setPaymentSourceAccountId('');
                    }
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
                  iconGetter={_id => _id === 'debit' ? <BanknoteArrowDown size={18} /> : <BanknoteArrowUp size={18} />}
                  style={{ marginBottom: 0 }}
                />
              </div>

              <CustomPicker
                label="Category"
                value={newTx.category || ''}
                placeholder="Select Category"
                options={[
                  ...[...(data.categories || [])].sort((a, b) => {
                    const isAOther = a.toLowerCase().includes('other') || a.toLowerCase().includes('misc');
                    const isBOther = b.toLowerCase().includes('other') || b.toLowerCase().includes('misc');
                    if (isAOther && !isBOther) return 1;
                    if (!isAOther && isBOther) return -1;
                    return 0;
                  }).map(c => ({ id: c, name: c })),
                  ...(newTx.category && !(data.categories || []).includes(newTx.category)
                    ? [{ id: newTx.category, name: newTx.category }]
                    : [])
                ]}
                onChange={val => applyCategorySelection(val, isInvestmentCategory(val) ? activeInvestmentKind : undefined)}
                iconGetter={c => getCategoryIcon(c)}
                error={errors.category}
              />

              {/* Investments is one category with three behaviours — this sub-picker is what selects
                  which. Everything downstream (valid account types, quantity field, invested-vs-charges
                  split, auto-description) keys off it, so it routes through the same handler as the
                  category itself. */}
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
                options={[...data.accounts]
                  .sort(sortByAccountType)
                  .filter(acc => {
                    // Hide archived (deleted) accounts, but keep the one already on this transaction
                    // so editing historical data doesn't blank the field (sorted to the end).
                    if (acc.archived && acc.id !== newTx.accountId) return false;
                    if (isCCPayment) {
                      return newTx.type === 'debit' ? (acc.type === 'bank_account' || acc.type === 'e_wallet') : acc.type === 'credit_card';
                    }
                    // Credit = the holding account receives the units/shares/grams; debit = the bank
                    // or wallet funding the buy. One rule per kind, keyed off the matching account type.
                    if (activeInvestmentKind) {
                      return newTx.type === 'credit'
                        ? acc.type === investmentAccountTypeFor(activeInvestmentKind)
                        : (acc.type === 'bank_account' || acc.type === 'e_wallet');
                    }
                    return true;
                  })
                  .map(acc => ({
                    id: acc.id,
                    name: acc.archived ? `${acc.name} (deleted)` : acc.name,
                    subtext: acc.type.replace('_', ' '),
                    group: getAccountGroupLabel(acc.type, acc.archived)
                  }))}
                onChange={val => {
                  const selectedAcc = data.accounts.find(a => a.id === val);
                  const isNcmcRecharge = newTx.category?.toLowerCase() === 'ncmc travel recharge';
                  const shouldAutoTravel = newTx.type === 'credit' && selectedAcc?.type === 'debit_card' && selectedAcc?.isNcmcEnabled && isNcmcRecharge;
                  const shouldAutoDebitDesc = newTx.type === 'debit' && selectedAcc?.type === 'debit_card' && selectedAcc?.isNcmcEnabled && isNcmcRecharge;
                  let finalDesc = newTx.description;
                  if (activeInvestmentKind) {
                    // Name the log after the holding account, whichever leg it's on, so a fund/stock
                    // /metal entry reads as the instrument rather than a bare "Investments".
                    finalDesc = investmentDescriptionFor(activeInvestmentKind, [val, paymentSourceAccountId]);
                  } else {
                    finalDesc = shouldAutoDebitDesc ? 'Transfer to Travel Wallet' : (shouldAutoTravel ? 'NCMC Travel Recharge' : newTx.description);
                  }
                  setNewTx({
                    ...newTx,
                    accountId: val,
                    isTravelTransaction: shouldAutoTravel ? true : (selectedAcc?.isNcmcEnabled ? newTx.isTravelTransaction : false),
                    description: finalDesc
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
                              // Charges is the complement: charges = amount − invested.
                              const totalAmount = Number(newTx.amount || 0);
                              const charges = Math.max(0, totalAmount - allotted);
                              setInputStrings(s => ({ ...s, investmentCharges: parseFloat(charges.toFixed(2)) === 0 ? '' : parseFloat(charges.toFixed(2)).toString() }));
                              setNewTx(prev => ({
                                ...prev,
                                allottedAmount: allotted,
                                investmentCharges: parseFloat(charges.toFixed(2))
                              }));
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
                              // Complement of invested: invested = amount − charges, so you can fill in
                              // whichever you know (invested or charges) and the other is derived.
                              const totalAmount = Number(newTx.amount || 0);
                              const invested = Math.max(0, totalAmount - charges);
                              setInputStrings(s => ({ ...s, allottedAmount: parseFloat(invested.toFixed(2)) === 0 ? '' : parseFloat(invested.toFixed(2)).toString() }));
                              setNewTx(prev => ({
                                ...prev,
                                investmentCharges: charges,
                                allottedAmount: parseFloat(invested.toFixed(2))
                              }));
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

              {(
                // Crediting a credit card only needs an auto-debit funding source for a CC Payment
                // (handled by the isCCPayment clause below). A plain credit to a card (refund, reversal,
                // statement credit) has no funding bank, so don't offer the picker there. The debit_card
                // case keeps its generic credit auto-debit source.
                (newTx.type === 'credit' && data.accounts.find(a => a.id === newTx.accountId)?.type === 'debit_card' && !newTx.isTravelTransaction)
                || isTransfer
                || (isCCPayment && newTx.accountId && (
                  newTx.type === 'debit'
                    ? data.accounts.find(a => a.id === newTx.accountId)?.type !== 'credit_card'
                    : data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card'
                ))
                || !!activeInvestmentKind
              ) && (
                  <CustomPicker
                    label={
                      activeInvestmentKind
                        ? (newTx.type === 'debit'
                          ? `Credit To ${investmentKindLabel(activeInvestmentKind)} Account`
                          : 'Debit From Account')
                        : (newTx.type === 'debit'
                          ? (isCCPayment ? 'Pay To Card (Auto-Credit)' : 'Credit To Account (Auto-Credit)')
                          : 'Debit From Account (Auto-Debit)')
                    }
                    value={paymentSourceAccountId}
                    placeholder="None (Manual Log)"
                    options={[
                      { id: '', name: 'None (Manual Log)' },
                      ...[...data.accounts].sort(sortByAccountType).filter(a => {
                        if (a.id === newTx.accountId) return false;
                        // Hide archived, but keep the counterpart already selected on this transaction.
                        if (a.archived && a.id !== paymentSourceAccountId) return false;
                        if (isCCPayment) {
                          return newTx.type === 'debit' ? a.type === 'credit_card' : a.type !== 'credit_card';
                        }
                        // Mirror of the main Account filter, one direction over: on a debit the
                        // counterpart is the holding account receiving the units/shares/grams.
                        if (activeInvestmentKind) {
                          return newTx.type === 'debit'
                            ? a.type === investmentAccountTypeFor(activeInvestmentKind)
                            : (a.type === 'bank_account' || a.type === 'e_wallet');
                        }
                        return true;
                      }).map(acc => ({
                        id: acc.id,
                        name: acc.archived ? `${acc.name} (deleted)` : acc.name,
                        subtext: acc.type.replace('_', ' '),
                        group: getAccountGroupLabel(acc.type, acc.archived)
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
                      } else if (activeInvestmentKind) {
                        setNewTx(prev => ({
                          ...prev,
                          description: investmentDescriptionFor(activeInvestmentKind, [newTx.accountId, val])
                        }));
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

              {data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled && (
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Hash size={13} style={{ opacity: 0.6 }} />Tags <span className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 400 }}>(optional)</span>
                  </label>
                  {((data.tags || []).length > 0 || (data.eventTags || []).length > 0 || tempCreatedActiveTags.length > 0 || tempCreatedEventTags.length > 0) && (
                    <CustomPicker
                      label="Tags"
                      hideLabel={true}
                      value={newTx.tags || []}
                      isMulti={true}
                      enableSearch={true}
                      searchPlaceholder="Search active & event tags..."
                      options={[
                        ...Array.from(new Set([...(data.tags || []), ...tempCreatedActiveTags])).map(t => ({ id: t, name: `#${t}` })),
                        ...Array.from(new Set([...(data.eventTags || []), ...tempCreatedEventTags])).map(t => ({ id: t, name: `#${t}`, subtext: 'Event Tag', group: 'Event Tags', showOnlyOnSearch: true }))
                      ]}
                      onChange={(val: string[]) => {
                        const cleaned = (val || []).filter(v => v !== 'all' && v !== '');
                        setNewTx(prev => ({ ...prev, tags: cleaned.length > 0 ? cleaned : [] }));
                      }}
                      placeholder="Select tags"
                      noSelectionLabel="None"
                    />
                  )}
                  <div className="flex align-center" style={{ marginTop: '0.5rem', gap: '0.35rem' }}>
                    <input
                      className="input-field"
                      style={{ flex: 1, fontSize: '0.85rem', height: '42px', padding: '0 0.85rem' }}
                      value={newTagInput}
                      onChange={e => setNewTagInput(e.target.value)}
                      placeholder={`Create ${newTagTargetType} tag`}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateTag(); } }}
                    />
                    <button
                      type="button"
                      className={`btn ${newTagTargetType === 'event' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{
                        width: '42px',
                        height: '42px',
                        padding: 0,
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        letterSpacing: '0.5px',
                        flexShrink: 0,
                        borderRadius: '6px',
                        marginRight: '0.4rem'
                      }}
                      title={`Target: ${newTagTargetType === 'active' ? 'Active Tag' : 'Event Tag'}. Click to toggle.`}
                      onClick={() => setNewTagTargetType(prev => prev === 'active' ? 'event' : 'active')}
                    >
                      {newTagTargetType === 'active' ? 'Active' : 'Event'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{
                        width: '42px',
                        height: '42px',
                        padding: 0,
                        fontSize: '1.1rem',
                        fontWeight: 800,
                        flexShrink: 0,
                        borderRadius: '6px'
                      }}
                      onClick={handleCreateTag}
                    >
                      +
                    </button>
                  </div>
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
                const isMf = activeInvestmentKind === 'mutual_funds';

                if (isTransfer || isCCPayment || isNcmcRecharge || isMf) return null;
                if (newTx.isTravelTransaction) return null;

                if (!isCard && !showInstantUI) return null;
                if (newTx.type !== 'debit') return null;
                if (showInstantUI && !hasRewardsOrWallet) return null;

                return (
                  <div className="flex-col gap-3" style={{ marginTop: '0.5rem', marginBottom: '1rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                    <div className="flex justify-between align-center">
                      <span className="text-xs font-bold text-muted uppercase" style={{ letterSpacing: '1px' }}>Cashback Earned</span>
                      {showInstantUI && (
                        <div className="flex align-center" style={{ gap: '1rem' }}>
                          <div className="flex" style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                            {(['amount', 'percent'] as const).map(mode => {
                              const active = (mode === 'percent') === cashbackPercentMode;
                              return (
                                <button
                                  key={mode}
                                  type="button"
                                  className="text-mono text-xs font-bold"
                                  style={{
                                    padding: '0.25rem 0.7rem',
                                    minHeight: 'auto',
                                    border: 'none',
                                    cursor: 'pointer',
                                    background: active ? 'var(--accent)' : 'transparent',
                                    color: active ? '#ffffff' : 'var(--text-secondary)'
                                  }}
                                  onClick={() => {
                                    const toPercent = mode === 'percent';
                                    if (toPercent === cashbackPercentMode) return;
                                    const amt = Number(newTx.amount) || 0;
                                    const earned = Number(newTx.rewardEarned) || 0;
                                    if (toPercent) {
                                      // Back-compute the percent from the current ₹ value so the switch is lossless.
                                      setCashbackPercentStr(amt > 0 && earned > 0 ? String(Math.round((earned / amt) * 100 * 100) / 100) : '');
                                    } else {
                                      // Reflect the computed ₹ value into the amount input.
                                      setInputStrings(prev => ({ ...prev, rewardEarned: earned === 0 ? '' : String(earned) }));
                                    }
                                    setCashbackPercentMode(toPercent);
                                  }}
                                >
                                  {mode === 'percent' ? '%' : '₹'}
                                </button>
                              );
                            })}
                          </div>
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
                              { 
                                id: 'default', 
                                name: (() => {
                                  const unit = activeAcc?.rewardUnit || (activeAcc?.cashbackDestinationAccountId ? data.accounts.find(a => a.id === activeAcc.cashbackDestinationAccountId)?.rewardUnit : '');
                                  return unit 
                                    ? `Default (${activeAcc?.defaultCashbackRate || 0}% ${unit.toLowerCase()})`
                                    : `Default (${activeAcc?.defaultCashbackRate || 0}%)`;
                                })()
                              },
                              ...(activeAcc?.cashbackRates || []).map(r => ({ 
                                id: r.id, 
                                name: (() => {
                                  const unit = activeAcc?.rewardUnit || (activeAcc?.cashbackDestinationAccountId ? data.accounts.find(a => a.id === activeAcc.cashbackDestinationAccountId)?.rewardUnit : '');
                                  return unit 
                                    ? `${r.name} (${r.rate}% ${unit.toLowerCase()})`
                                    : `${r.name} (${r.rate}%)`;
                                })()
                              }))
                            ]}
                            onChange={val => {
                              setSelectedCashbackLevelId(val === 'none' ? '' : val);
                              setNewTx({ ...newTx, rewardEarnedType: val === 'none' ? 'none' : 'delayed', rewardEarned: 0 });
                            }}
                            iconGetter={() => '✨'}
                          />
                        </div>
                      ) : cashbackPercentMode ? (
                        <div className="flex-col gap-1">
                          <div style={{ position: 'relative' }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              className={`input-field ${errors.rewardEarned ? 'border-danger' : ''}`}
                              value={cashbackPercentStr}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                  setCashbackPercentStr(val);
                                  if (errors.rewardEarned) setErrors(prev => ({ ...prev, rewardEarned: '' }));
                                }
                              }}
                              placeholder="1.6"
                              style={{ width: '100%', paddingRight: '1.75rem' }}
                            />
                            <span className="text-muted text-mono font-bold" style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>%</span>
                          </div>
                          <span className="text-xs text-muted text-mono" style={{ opacity: 0.8 }}>
                            = {formatCurrency(Number(newTx.rewardEarned) || 0)}
                          </span>
                          {errors.rewardEarned && <span className="text-xs text-danger" style={{ marginTop: '0.1rem' }}>{errors.rewardEarned}</span>}
                        </div>
                      ) : (
                        <div className="flex-col gap-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            className={`input-field ${errors.rewardEarned ? 'border-danger' : ''}`}
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
                                if (errors.rewardEarned && !isNaN(numVal) && numVal > 0) {
                                  setErrors(prev => ({ ...prev, rewardEarned: '' }));
                                }
                              }
                            }}
                            placeholder="0.00"
                          />
                          {errors.rewardEarned && <span className="text-xs text-danger" style={{ marginTop: '0.1rem' }}>{errors.rewardEarned}</span>}
                        </div>
                      )}

                      {showInstantUI && (
                        <CustomPicker
                          label="Deposit To"
                          value={newTx.rewardEarnedAccountId || ''}
                          placeholder="Select Account"
                          options={[
                            { id: '', name: 'None (No Deposit Account)' },
                            ...[...data.accounts].sort(sortByAccountType).filter(a => (!a.archived || a.id === newTx.rewardEarnedAccountId) && (a.type === 'rewards' || a.type === 'e_wallet')).map(acc => ({
                              id: acc.id,
                              name: acc.archived ? `${acc.name} (deleted)` : acc.name,
                              subtext: acc.type.replace('_', ' ')
                            }))
                          ]}
                          onChange={val => {
                            setNewTx({
                              ...newTx,
                              rewardEarnedAccountId: val,
                              rewardEarnedType: val ? 'instant' : 'none',
                              ...(!val && (Number(newTx.rewardEarned) || 0) <= 0 ? { rewardEarned: 0 } : {})
                            });
                            if (errors.rewardEarnedAccountId) setErrors(prev => ({ ...prev, rewardEarnedAccountId: '' }));
                            if (errors.rewardEarned) setErrors(prev => ({ ...prev, rewardEarned: '' }));
                          }}
                          iconGetter={id => getAccountIcon(id)}
                          error={errors.rewardEarnedAccountId}
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
                  style={{ marginBottom: '1rem', padding: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}
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
                  style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px' }}
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
                          if (errors.rewardUsedAccountId) setErrors(prev => ({ ...prev, rewardUsedAccountId: '' }));
                          if (errors.rewardUsed) setErrors(prev => ({ ...prev, rewardUsed: '' }));
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
                      className={`input-field ${errors.rewardUsed ? 'border-danger' : ''}`}
                      value={inputStrings.rewardUsed}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === '' || /^\d*\.?\d*$/.test(val)) {
                          setInputStrings(prev => ({ ...prev, rewardUsed: val }));
                          const numVal = parseFloat(val);
                          setNewTx({ ...newTx, rewardUsed: isNaN(numVal) ? 0 : numVal });
                          if (errors.rewardUsed && !isNaN(numVal) && numVal > 0) {
                            setErrors(prev => ({ ...prev, rewardUsed: '' }));
                          }
                          if (errors.rewardUsedAccountId && (isNaN(numVal) || numVal <= 0)) {
                            setErrors(prev => ({ ...prev, rewardUsedAccountId: '' }));
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
                      ...[...data.accounts].sort(sortByAccountType).filter(a => (!a.archived || a.id === newTx.rewardUsedAccountId) && (a.type === 'rewards' || (a.isCashbackEnabled && a.rewardType === 'points'))).map(acc => ({
                        id: acc.id,
                        name: acc.archived ? `${acc.name} (deleted)` : acc.name,
                        subtext: acc.rewardType === 'points'
                          ? `${calculateBalance(acc, data.transactions, getCurrentMonthStr(), false, true, data.cashbackStatements)} ${acc.rewardUnit || ''}`
                          : formatCurrency(calculateBalance(acc, data.transactions, getCurrentMonthStr(), false, false, data.cashbackStatements))
                      }))
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
                    iconGetter={id => getAccountIcon(id)}
                    error={errors.rewardUsedAccountId}
                  />
                  <div className="col-span-2 text-xs text-muted" style={{ opacity: 0.7 }}>
                    Primary Account Debit: <strong>{formatCurrency(Math.max(0, Number(newTx.amount || 0) - Number(newTx.rewardUsed || 0)))}</strong>
                  </div>
                </div>
              )}

              {((newTx.type === 'credit' && data.accounts.find(a => a.id === newTx.accountId)?.type === 'credit_card') ||
                (newTx.type === 'debit' && isCCPayment && paymentSourceAccountId && data.accounts.find(a => a.id === paymentSourceAccountId)?.type === 'credit_card')) && (
                  <div style={{ marginTop: '1rem' }}>
                    <CustomPicker
                      label="Apply Payment To"
                      value={ccPaymentCycleTarget}
                      options={[
                        { id: 'previous_statement', name: 'Previous Statement', subtext: 'Reduce Already Billed Dues' },
                        { id: 'current_cycle', name: 'Current Open Cycle', subtext: 'Count as an Early Payment for the Active Cycle' }
                      ]}
                      onChange={val => setCcPaymentCycleTarget(val as 'current_cycle' | 'previous_statement')}
                      iconGetter={id => id === 'current_cycle' ? '🟦' : '🧾'}
                    />
                  </div>
                )}

              {/* Tags kept last so it stays at the end of the form across all scenarios (e.g. after
                  the CC-payment "Apply Payment To" picker). */}
              {!data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled && (
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Hash size={13} style={{ opacity: 0.6 }} />Tags <span className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 400 }}>(optional)</span>
                  </label>
                  {((data.tags || []).length > 0 || (data.eventTags || []).length > 0 || tempCreatedActiveTags.length > 0 || tempCreatedEventTags.length > 0) && (
                    <CustomPicker
                      label="Tags"
                      hideLabel={true}
                      value={newTx.tags || []}
                      isMulti={true}
                      enableSearch={true}
                      searchPlaceholder="Search active & event tags..."
                      options={[
                        ...Array.from(new Set([...(data.tags || []), ...tempCreatedActiveTags])).map(t => ({ id: t, name: `#${t}` })),
                        ...Array.from(new Set([...(data.eventTags || []), ...tempCreatedEventTags])).map(t => ({ id: t, name: `#${t}`, subtext: 'Event Tag', group: 'Event Tags', showOnlyOnSearch: true }))
                      ]}
                      onChange={(val: string[]) => {
                        const cleaned = (val || []).filter(v => v !== 'all' && v !== '');
                        setNewTx(prev => ({ ...prev, tags: cleaned.length > 0 ? cleaned : [] }));
                      }}
                      placeholder="Select tags"
                      noSelectionLabel="None"
                    />
                  )}
                  <div className="flex align-center" style={{ marginTop: '0.5rem', gap: '0.35rem' }}>
                    <input
                      className="input-field"
                      style={{ flex: 1, fontSize: '0.85rem', height: '42px', padding: '0 0.85rem' }}
                      value={newTagInput}
                      onChange={e => setNewTagInput(e.target.value)}
                      placeholder={`Create ${newTagTargetType} tag`}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateTag(); } }}
                    />
                    <button
                      type="button"
                      className={`btn ${newTagTargetType === 'event' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{
                        width: '42px',
                        height: '42px',
                        padding: 0,
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        letterSpacing: '0.5px',
                        flexShrink: 0,
                        borderRadius: '6px',
                        marginRight: '0.4rem'
                      }}
                      title={`Target: ${newTagTargetType === 'active' ? 'Active Tag' : 'Event Tag'}. Click to toggle.`}
                      onClick={() => setNewTagTargetType(prev => prev === 'active' ? 'event' : 'active')}
                    >
                      {newTagTargetType === 'active' ? 'Active' : 'Event'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{
                        width: '42px',
                        height: '42px',
                        padding: 0,
                        fontSize: '1.1rem',
                        fontWeight: 800,
                        flexShrink: 0,
                        borderRadius: '6px'
                      }}
                      onClick={handleCreateTag}
                    >
                      +
                    </button>
                  </div>
                </div>
              )}



              {data.user?.enablePassiveTransactions && newTx.category?.toLowerCase() !== 'transfer' && newTx.category?.toLowerCase() !== 'cc payment' && newTx.category?.toLowerCase() !== 'ncmc travel recharge' && newTx.category?.toLowerCase() !== 'lending & borrowing' && (
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
                          excludedAmount: isExpanding ? (amountToExclude?.toString() || '') : '',
                          activeShare: ''
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
                      <span className="text-xs text-muted" style={{ fontSize: '0.65rem' }}>Fill in whichever you know — the other is calculated for you.</span>
                      <div className="flex gap-3">
                        <div className="flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
                          <span className="text-xs text-muted">Excluded Amount</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={`input-field ${errors.excludedAmount ? 'border-danger' : ''}`}
                            style={{ height: '38px', fontSize: '0.9rem' }}
                            value={inputStrings.excludedAmount}
                            onChange={e => {
                              const val = e.target.value;
                              if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                const numVal = parseFloat(val);
                                const excluded = val === '' ? undefined : (isNaN(numVal) ? 0 : numVal);
                                // Excluded typed → derive the active share (clamped to the total).
                                const share = Math.max(0, (newTx.amount || 0) - (excluded || 0));
                                setInputStrings(prev => ({
                                  ...prev,
                                  excludedAmount: val,
                                  activeShare: val === '' ? '' : parseFloat(share.toFixed(2)).toString()
                                }));
                                setNewTx({ ...newTx, excludedAmount: excluded });
                                if (errors.excludedAmount) setErrors(prev => ({ ...prev, excludedAmount: '' }));
                              }
                            }}
                            placeholder="e.g. 15915"
                          />
                        </div>
                        <div className="flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
                          <span className="text-xs font-bold text-accent">Active Share</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="input-field"
                            style={{ height: '38px', fontSize: '0.9rem' }}
                            value={inputStrings.activeShare}
                            onChange={e => {
                              const val = e.target.value;
                              if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                const numVal = parseFloat(val);
                                const share = val === '' ? undefined : (isNaN(numVal) ? 0 : numVal);
                                // Active share typed → back out the excluded amount (clamped to the total).
                                const excluded = Math.max(0, (newTx.amount || 0) - (share || 0));
                                setInputStrings(prev => ({
                                  ...prev,
                                  activeShare: val,
                                  excludedAmount: val === '' ? '' : parseFloat(excluded.toFixed(2)).toString()
                                }));
                                setNewTx({ ...newTx, excludedAmount: val === '' ? undefined : parseFloat(excluded.toFixed(2)) });
                                if (errors.excludedAmount) setErrors(prev => ({ ...prev, excludedAmount: '' }));
                              }
                            }}
                            placeholder="e.g. 1832.2"
                          />
                        </div>
                      </div>
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
