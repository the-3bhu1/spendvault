import { useEffect, useRef, useState } from 'react';
import { format, parseISO, differenceInCalendarMonths } from 'date-fns';
import { CreditCard, Calendar, ChevronLeft, ArrowDown, ArrowUp, RotateCcw, Undo2, X } from 'lucide-react';
import { CustomPicker } from './CustomPicker';
import { getCategoryIcon } from './transactionIcons';
import RollingNumber from './RollingNumber';
import {
  getBillingCycleForDate, getCardGradients, formatBillingCycleRange, affectsRupeeBalance, resolveCardIssuer,
  getAppliedBillingCycle, getNaturalBillingCycle, shiftBillingCycle, isNearStatementCut,
} from '../utils';
import { hapticTap } from '../utils/haptics';
import { CardSurface } from './CardSurface';
import { CardChip } from './CardChip';
import { CardBrandLogo } from './CardBrandLogo';
import type { Account, Transaction } from '../types';
import { CardNetworkLogo } from './CardNetworkLogo';
import { useFinance } from '../FinanceContext';

interface AccountStatementProps {
  account: Account;
  transactions: Transaction[];
  onClose: () => void;
}

export default function AccountStatement({ account, transactions, onClose }: AccountStatementProps) {
  const context = useFinance();
  const allAccounts = context ? [...context.data.accounts].sort((a, b) => a.id.localeCompare(b.id)) : [];
  const accountIndex = allAccounts.findIndex(acc => acc.id === account.id);
  const themeIndex = accountIndex >= 0 ? accountIndex : 0;

  const transactionsViewportRef = useRef<HTMLDivElement>(null);
  const transactionsContentRef = useRef<HTMLDivElement>(null);

  const smoothScrollToTop = (el: HTMLDivElement, duration: number, onDone: () => void) => {
    const start = el.scrollTop;
    if (start === 0) { onDone(); return; }
    const startTime = performance.now();
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      el.scrollTop = start * (1 - easeOutCubic(progress));
      if (progress < 1) requestAnimationFrame(step);
      else onDone();
    };
    requestAnimationFrame(step);
  };
  const formatCredCurrency = (amount: number, font = 'serif') => {
    const parts = Math.abs(amount).toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).split('.');

    return (
      <span style={{ fontFamily: font, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {amount < 0 ? '-' : ''}{parts[0]}<span style={{ fontSize: '0.85em', opacity: 0.9 }}>.{parts[1]}</span>
      </span>
    );
  };

  const acc = account;
  const statementDay = acc.statementDay || 1;
  const currentCycle = getBillingCycleForDate(format(new Date(), 'yyyy-MM-dd'), statementDay);
  // Reads the manual override for debits as well as payments — see getAppliedBillingCycle. The
  // card's outstanding balance (calculateCycleBalanceForCycle) and the bill reminder
  // (calculateTotalSpendPerCycle) go through the same helper, so a charge moved here moves
  // everywhere at once rather than leaving this screen disagreeing with the card it belongs to.
  const getTransactionCycle = (tx: Transaction) => getAppliedBillingCycle(tx, statementDay);

  // Declared up here rather than beside the other view state below: cycleOptions reads it.
  const [selectedCycle, setSelectedCycle] = useState(currentCycle);
  // This is only ever opened for credit_card accounts (see Accounts.tsx's onViewStatement gating), so
  // no CATEGORY is excluded from the due calculation — a prior version dropped
  // 'transfer'/'ncmc travel recharge'/'mutual funds' (borrowed from a spend-analytics pattern meant for
  // dashboards), which silently lost real balance-affecting postings like a bank-reversed CC payment
  // logged as a Transfer.
  //
  // What IS excluded is a leg that never posted to the credit line at all. A points redemption draws on
  // the card's reward wallet, so it belongs on neither side of a statement: it inflated the Statement
  // Amount to the full purchase price and listed a row for money the card never lent. Same rule, same
  // predicate as calculateCycleBalanceForCycle (utils.ts), which backs the "Total Balance" in Accounts —
  // the two must agree or the statement contradicts the card. Redemptions are a reward-wallet ledger
  // and want their own surface, not a line in the card's bill.
  const relevantAccountTransactions = transactions.filter(t => t.accountId === acc.id && affectsRupeeBalance(t));
  // selectedCycle is in the set so the cycle you are LOOKING at always has an option to point at.
  // Moving the last charge off a past cycle empties it, which would otherwise drop it from this
  // list while the picker still names it, leaving the trigger blank on the screen that caused it.
  const cycleOptions = Array.from(new Set([
    currentCycle,
    selectedCycle,
    ...relevantAccountTransactions.map(getTransactionCycle)
  ]))
    .sort((a, b) => b.localeCompare(a))
    .map(cycle => {
      const cycleRangeStr = formatBillingCycleRange(cycle, statementDay);
      const date = parseISO(`${cycle}-01`);
      const year = date.getFullYear();
      const monthName = format(date, 'MMMM yyyy');
      const shortMonthLabel = `${date.toLocaleString('default', { month: 'short' })} '${date.getFullYear().toString().slice(-2)}`;
      const statusText = cycle === currentCycle ? 'Open Cycle' : 'Closed Statement';
      return {
        id: cycle,
        name: monthName,
        triggerName: shortMonthLabel,
        subtext: `${cycleRangeStr} • ${statusText}`,
        group: `Year ${year}`
      };
    });

  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [isTransactionsClipped, setIsTransactionsClipped] = useState(false);

  const selectedDate = parseISO(`${selectedCycle}-01`);
  const selectedMonthName = format(selectedDate, 'MMMM');

  // ---- Long-press a charge to move it between cycles ------------------------------------------
  //
  // Long-press, not swipe. Swipe-right on a transaction row already means DELETE everywhere else
  // in the app (Transactions.tsx, and the tour teaches it), and borrowing a destructive gesture
  // for a reversible one is the worst trade available. Long-press's other meaning — drag to
  // reorder — doesn't exist on this screen, so there's nothing here to confuse it with.
  //
  // Movable: purchases, refunds, reversals — anything whose cycle depends on when the bank got
  // round to POSTING it. Two categories are excluded, and neither is long-pressable nor tagged,
  // because for both the cycle is decided rather than observed:
  //
  // - CC Payment: you choose the statement it reduces when you log it ("Apply Payment To"). The log
  //   form also re-derives the field on every save, so a move here would be overwritten anyway.
  // - Cashback: generated to the card's own policy — same cycle or next, per cashbackCreditCycle —
  //   and Cashback.tsx dates the credit off that rule. A bank that pays in the following cycle pays
  //   in the following cycle; it doesn't slip to a third one the way a merchant's batch can.
  const FIXED_CYCLE_CATEGORIES = new Set(['cc payment', 'cashback']);
  const canMoveCycle = (tx: Transaction) =>
    !FIXED_CYCLE_CATEGORIES.has((tx.category || '').toLowerCase());

  const LONG_PRESS_MS = 450;
  const PRESS_CANCEL_PX = 10;
  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const [moveTarget, setMoveTarget] = useState<Transaction | null>(null);
  const [undoState, setUndoState] = useState<{ tx: Transaction; message: string } | null>(null);
  const updateTransaction = context?.updateTransaction;

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
  };

  const startPress = (tx: Transaction, x: number, y: number) => {
    if (!canMoveCycle(tx) || !updateTransaction) return;
    cancelPress();
    pressOrigin.current = { x, y };
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      hapticTap();
      setMoveTarget(tx);
    }, LONG_PRESS_MS);
  };

  // A press that turns into a scroll is a scroll. The rows sit in a scrollable viewport once the
  // list is expanded, and a finger flicking it starts out identical to a press being held.
  const trackPress = (x: number, y: number) => {
    if (!pressOrigin.current) return;
    if (Math.hypot(x - pressOrigin.current.x, y - pressOrigin.current.y) > PRESS_CANCEL_PX) cancelPress();
  };

  useEffect(() => () => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
  }, []);

  // `target` of undefined clears the override and hands the charge back to its own date. Callers
  // only ever pass the natural cycle's neighbours — see the sheet below for why that's clamped.
  const applyCycleMove = (tx: Transaction, target: string | undefined) => {
    if (!updateTransaction) return;
    // cycleMovedManually is what tells the log form this cycle was chosen by a person and must
    // survive a later save. Without it the form clears the field — which is correct for the stamps
    // an old build left on card credits, and would silently undo this move.
    updateTransaction({
      ...tx,
      appliedBillingCycleYearMonth: target,
      cycleMovedManually: target ? true : undefined,
    });
    setMoveTarget(null);
    // The row vanishing off this statement IS the confirmation the move worked, which only reads
    // as success rather than loss if it comes with a way back.
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    setUndoState({
      tx,
      message: target
        ? `Moved to ${format(parseISO(`${target}-01`), 'MMMM')}`
        : 'Reset to transaction date',
    });
    undoTimer.current = window.setTimeout(() => setUndoState(null), 6000);
  };

  const undoCycleMove = () => {
    if (!undoState || !updateTransaction) return;
    updateTransaction(undoState.tx);
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    setUndoState(null);
  };

  const cycleTxs = relevantAccountTransactions
    .filter(t => getTransactionCycle(t) === selectedCycle)
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalSpends = cycleTxs.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const totalPayments = cycleTxs.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
  const rawNetAmount = totalSpends - totalPayments;
  let netAmount = rawNetAmount;
  const rounding = acc.statementRounding || 'none';

  if (rounding === 'round') netAmount = Math.round(rawNetAmount);
  else if (rounding === 'floor') netAmount = Math.floor(rawNetAmount);
  else if (rounding === 'ceil') netAmount = Math.ceil(rawNetAmount);

  useEffect(() => {
    const updateClippingState = () => {
      if (showAllTransactions) {
        setIsTransactionsClipped(false);
        return;
      }

      const viewport = transactionsViewportRef.current;
      const content = transactionsContentRef.current;
      if (!viewport || !content) {
        setIsTransactionsClipped(false);
        return;
      }

      setIsTransactionsClipped(content.scrollHeight > viewport.clientHeight + 1);
    };

    updateClippingState();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateClippingState())
      : null;

    if (resizeObserver) {
      if (transactionsViewportRef.current) resizeObserver.observe(transactionsViewportRef.current);
      if (transactionsContentRef.current) resizeObserver.observe(transactionsContentRef.current);
    }

    window.addEventListener('resize', updateClippingState);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateClippingState);
    };
  }, [cycleTxs, showAllTransactions]);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1900, background: 'var(--bg-color)', overflow: 'hidden' }} className="fade-in">
      <div className="flex-col" style={{ gap: 0, height: '100vh', background: 'var(--bg-color)' }}>
        <div style={{
          paddingTop: 'calc(2.5rem + env(safe-area-inset-top, 24px))',
          paddingLeft: '0.5rem',
          paddingRight: '0.5rem',
          paddingBottom: '1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-card)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          borderBottom: '1px solid var(--border-color)'
        }}>
          <div className="flex align-center gap-4">
            <button className="btn btn-secondary" style={{ padding: '0.5rem', flexShrink: 0 }} onClick={onClose}>
              <ChevronLeft size={20} />
            </button>
            <div className="flex-col">
              <span className="text-mono font-bold uppercase" style={{ color: 'var(--text-primary)', fontSize: '1rem', letterSpacing: '0.5px' }}>{account.name}</span>
              <span className="text-mono font-bold uppercase" style={{ color: selectedCycle === currentCycle ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '0.72rem', marginTop: '0.15rem' }}>{selectedCycle === currentCycle ? 'Current Open Cycle' : 'Closed Billing Cycle'}</span>
            </div>
          </div>

          <div style={{ width: '150px', flexShrink: 0 }}>
            <CustomPicker
              label="Select Cycle"
              hideLabel={true}
              value={selectedCycle}
              options={cycleOptions}
              onChange={(val) => {
                setSelectedCycle(val);
                setShowAllTransactions(false);
              }}
              iconGetter={() => <Calendar size={18} />}
              allowTextWrap={false}
            />
          </div>
        </div>

        {/* 380px — 20 over the original 360, down from the 400 a flat card needed.
            The card is a true 340x214 at the ID-1 ratio, and raking it back on the X
            axis reclaims some of that: projected height measures 205 against a 214
            layout box.

            Only *some*, though. Perspective enlarges the near edge by nearly as much
            as the tilt foreshortens the far one, so the rake is worth about 9px, not
            the 40 it looks like it should be. Don't rake it further expecting to get
            the band back to 360 — past this angle the near edge grows faster than the
            card shrinks, and it starts overflowing this overflow:hidden band bottom-
            first (the projected box sits ~8px below the layout box at 26deg). */}
        <div style={{
          height: showAllTransactions ? '0px' : '380px',
          overflow: 'hidden',
          transition: showAllTransactions
            ? 'height 1.2s cubic-bezier(0.76, 0, 0.24, 1) 0.3s'
            : 'height 1.2s cubic-bezier(0.76, 0, 0.24, 1)'
        }}>
          <div style={{
            height: '380px',
            background: 'linear-gradient(180deg, var(--bg-hover) 0%, var(--bg-color) 80%, var(--bg-color) 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            textAlign: 'center',
            color: 'var(--text-primary)',
          }}>
            <h2 className="text-serif" style={{
              fontSize: '1.85rem',
              marginTop: '1rem',
              opacity: showAllTransactions ? 0 : 0.9,
              transform: showAllTransactions ? 'translateY(-40px) scale(0.92)' : 'translateY(0) scale(1)',
              filter: showAllTransactions ? 'blur(4px)' : 'blur(0px)',
              transition: showAllTransactions
                ? 'opacity 0.6s ease, transform 0.7s cubic-bezier(0.4, 0, 1, 1), filter 0.6s ease'
                : 'opacity 0.6s ease 0.5s, transform 0.7s cubic-bezier(0, 0, 0.2, 1) 0.5s, filter 0.6s ease 0.5s'
            }}>
              here is your statement<br />for {selectedMonthName.toLowerCase()}
            </h2>

            <CardSurface
              skin={account.cardDetails
                ? getCardGradients(themeIndex, account.cardDetails.network, account.name)
                : undefined}
              style={{
                marginTop: '0.75rem',
                marginBottom: '0px',
                width: '340px',
                // Without this the flex column shrinks the card off its aspect ratio.
                flexShrink: 0,
                perspective: '800px',
                transform: showAllTransactions
                  ? 'rotateX(70deg) translateY(-60px) scale(0.85)'
                  : 'perspective(900px) rotateX(26deg) rotateY(-6deg) rotateZ(-1deg) scale(0.96)',
                boxShadow: showAllTransactions
                  ? '0 0px 10px rgba(0,0,0,0.1)'
                  // The old 12/16px hard offset shadow was drawn for a near-flat
                  // card; once raked it detaches into a slab behind the corner.
                  : '0 26px 34px -14px rgba(0,0,0,0.75)',
                opacity: showAllTransactions ? 0 : 1,
                border: '1px solid rgba(255,255,255,0.1)',
                transition: showAllTransactions
                  ? 'transform 0.8s cubic-bezier(0.4, 0, 1, 1), opacity 0.7s ease, box-shadow 0.6s ease'
                  : 'transform 0.8s cubic-bezier(0, 0, 0.2, 1) 0.5s, opacity 0.7s ease 0.5s, box-shadow 0.6s ease 0.5s'
              }}>
              {/* SIM Chip — always shown */}
              <CardChip width={34} style={{ position: 'absolute', top: '24px', left: '24px' }} />

              {acc.cardDetails ? (
                /* ── Real card details ── */
                <>
                  {/* Issuing bank top-right, matching the flip card. The network
                      mark used to sit here; it moves to the bottom-right corner so
                      the two views of the same card agree on where things go. */}
                  {(() => {
                    const issuer = resolveCardIssuer(acc.name, acc.cardDetails);
                    return issuer ? (
                      <div style={{ position: 'absolute', top: '18px', right: '20px' }}>
                        <CardBrandLogo brand={issuer} height={17} />
                      </div>
                    ) : null;
                  })()}

                  {/* Network logo bottom-right */}
                  <div style={{ position: 'absolute', bottom: '20px', right: '20px', overflow: 'visible' }}>
                    {acc.cardDetails.network
                      ? <CardNetworkLogo network={acc.cardDetails.network} size="md" />
                      : <CreditCard size={20} style={{ opacity: 0.3, color: 'rgb(var(--card-ink))' }} />}
                  </div>

                  {/* Account Name + Cardholder name row */}
                  <div style={{ position: 'absolute', bottom: '24px', left: '24px', right: '110px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{
                      fontFamily: 'var(--font-family)',
                      fontSize: '10px',
                      color: 'rgba(var(--card-ink), 0.5)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      {acc.name}
                    </span>
                    <span style={{
                      fontFamily: '"Courier New", Courier, monospace',
                      fontSize: '14px',
                      color: 'rgba(var(--card-ink), 0.9)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.15em',
                      textShadow: '0 -1px 0 rgba(255,255,255,0.14), 0 1px 1px rgba(0,0,0,0.55)',
                    }}>
                      {acc.cardDetails.cardholderName || 'CARDHOLDER NAME'}
                    </span>
                  </div>

                </>
              ) : (
                /* ── Placeholder card ── */
                <>
                  <div style={{ position: 'absolute', top: '20px', right: '20px', opacity: 0.2, color: 'var(--text-primary)' }}><CreditCard size={20} /></div>
                  <div style={{ position: 'absolute', bottom: '40px', left: '20px', fontSize: '0.75rem', color: 'var(--text-primary)', opacity: 0.3, letterSpacing: '2px' }}>XXXX XXXX XXXX 1234</div>
                  <div style={{ position: 'absolute', bottom: '20px', left: '20px', width: '75%', height: '6px', background: 'var(--text-primary)', opacity: 0.05, borderRadius: '3px' }} />
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(135deg, var(--text-primary) 0%, transparent 60%)', opacity: 0.04, pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', top: '0', right: '0', width: '140px', height: '140px', background: 'var(--accent)', opacity: 0.03, borderRadius: '50%', transform: 'translate(30%, -30%)' }} />
                </>
              )}
            </CardSurface>
          </div>
        </div>

        <div className="flex-col" style={{
          padding: '1.2rem 1.5rem 0 1.5rem',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div className="flex-col align-center" style={{ flexShrink: 0 }}>
            <span className="text-mono text-xs text-muted font-bold uppercase" style={{ opacity: 0.5, marginBottom: '0.5rem' }}>Statement Amount</span>
            <div
              className="text-serif"
              style={{
                fontSize: '1rem',
                lineHeight: 1,
                transition: 'transform 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                transform: showAllTransactions ? 'scale(0.85)' : 'scale(1)'
              }}
            >
              <RollingNumber value={netAmount} fontSize="2.5rem" />
            </div>
          </div>

          {cycleTxs.length > 0 && (
            <h4 className="text-mono text-xs text-muted uppercase font-bold" style={{ opacity: 0.4, marginTop: '1.2rem', marginBottom: '0.25rem', flexShrink: 0 }}>
              {showAllTransactions ? 'All Transactions' : 'Top Transactions'}
            </h4>
          )}

          <div
            ref={transactionsViewportRef}
            className="no-scrollbar"
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              overflowY: showAllTransactions ? 'auto' : 'hidden',
              overflowX: 'hidden',
            }}
          >
            <div ref={transactionsContentRef} className="flex-col" style={{ minHeight: '100%' }}>
              {cycleTxs.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100%' }}>
                  <p className="text-center text-muted" style={{ opacity: 0.5 }}>no transactions recorded yet.</p>
                </div>
              ) : (
                cycleTxs.map((tx, idx) => {
                  const naturalCycle = getNaturalBillingCycle(tx, statementDay);
                  // Already moved by hand: say where it came from, so a 15 Aug row sitting among
                  // September's dates reads as deliberate rather than as a sorting bug.
                  //
                  // Both tags track the gesture exactly: a row that can't be long-pressed must not
                  // be marked, or the mark points at a control that isn't there. A CC payment
                  // sitting outside its date's cycle is not a correction needing explanation — it's
                  // the normal result of "Apply Payment To", chosen when the payment was logged, so
                  // tagging it told the person who set it something they already knew.
                  const isMoved = canMoveCycle(tx) && getTransactionCycle(tx) !== naturalCycle;
                  // Near enough to this cycle's cut that the bank may post it after the statement
                  // generates. Doubles as the affordance — an unmarked long-press is undiscoverable.
                  const nearCut = canMoveCycle(tx) && !isMoved
                    && naturalCycle === selectedCycle
                    && isNearStatementCut(tx.date, statementDay);
                  return (
                  <div
                    key={tx.id}
                    className="flex justify-between align-center fade-in"
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      opacity: 0.9,
                      padding: '0.85rem 0',
                      animationDelay: `${idx * 0.05}s`,
                      // Android pops text-selection handles on a long press otherwise, on top of
                      // the sheet.
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                    }}
                    onContextMenu={e => e.preventDefault()}
                    onTouchStart={e => startPress(tx, e.touches[0].clientX, e.touches[0].clientY)}
                    onTouchMove={e => trackPress(e.touches[0].clientX, e.touches[0].clientY)}
                    onTouchEnd={cancelPress}
                    onTouchCancel={cancelPress}
                    onMouseDown={e => startPress(tx, e.clientX, e.clientY)}
                    onMouseMove={e => trackPress(e.clientX, e.clientY)}
                    onMouseUp={cancelPress}
                    onMouseLeave={cancelPress}
                  >
                    <div className="flex align-center" style={{ gap: '0.75rem', flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '10px',
                        background: 'var(--bg-hover)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-primary)',
                        flexShrink: 0,
                      }}>
                        {getCategoryIcon(tx.category, 20)}
                      </div>
                      <div className="flex-col" style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{tx.description}</span>
                        <div className="flex align-center" style={{ gap: '0.4rem', minWidth: 0 }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{tx.category.toLowerCase()}</span>
                          {(isMoved || nearCut) && (
                            <span
                              className="text-mono uppercase"
                              style={{
                                fontSize: '0.58rem',
                                letterSpacing: '0.4px',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                                padding: '0.08rem 0.35rem',
                                borderRadius: '4px',
                                color: isMoved ? 'var(--accent)' : 'var(--text-secondary)',
                                background: 'var(--bg-hover)',
                                // Dashed while it's only a possibility; solid once you've decided.
                                border: isMoved
                                  ? '1px solid var(--accent)'
                                  : '1px dashed var(--border-color)',
                                opacity: isMoved ? 0.95 : 0.75,
                              }}
                            >
                              {isMoved
                                ? `from ${format(parseISO(`${naturalCycle}-01`), 'MMM')}`
                                : 'may settle next'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex-col align-end" style={{ flexShrink: 0, marginLeft: '0.75rem' }}>
                      <span className="text-mono" style={{ fontWeight: 700, fontSize: '1.1rem', color: tx.type === 'credit' ? '#10b981' : 'var(--text-primary)' }}>
                        {tx.type === 'credit' ? '+ ' : ''}{formatCredCurrency(tx.amount, 'var(--font-mono)')}
                      </span>
                      <span className="text-mono text-xs text-secondary" style={{ marginTop: '2px' }}>
                        {new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase()}
                      </span>
                    </div>
                  </div>
                  );
                })
              )}
            </div>

            {!showAllTransactions && isTransactionsClipped && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '80px',
                background: 'linear-gradient(transparent, var(--bg-color))',
                pointerEvents: 'none',
              }} />
            )}
          </div>

          {cycleTxs.length > 0 && (
            <div className="flex justify-center" style={{ flexShrink: 0, padding: '0.75rem 0 1.5rem' }}>
              <button
                onClick={() => {
                  if (showAllTransactions && transactionsViewportRef.current) {
                    smoothScrollToTop(transactionsViewportRef.current, 900, () => setShowAllTransactions(false));
                  } else {
                    setShowAllTransactions(true);
                  }
                }}
                style={{ color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'underline', opacity: 0.9, cursor: 'pointer', padding: '0.5rem 1rem' }}
              >
                {showAllTransactions ? 'Show fewer transactions' : `View all ${cycleTxs.length} transactions`}
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Move sheet. Both destinations are measured from the charge's NATURAL cycle, never from
          wherever it currently sits, so the reachable set stays {previous, natural, next} no matter
          how many times it's moved — otherwise three taps would put a purchase three months out
          with nothing on screen explaining why. Options it already occupies are dropped, so the
          sheet never offers a move that does nothing. */}
      {moveTarget && (() => {
        const natural = getNaturalBillingCycle(moveTarget, statementDay);
        const applied = getTransactionCycle(moveTarget);
        const monthName = (c: string) => format(parseISO(`${c}-01`), 'MMMM');
        // Up is later, down is earlier — the direction the cycle picker above already sorts in
        // (newest cycle at the top), so "up" moves the charge the same way the list reads.
        const choices = [
          {
            cycle: shiftBillingCycle(natural, 1) as string | undefined,
            icon: <ArrowUp size={20} />,
            label: `Move to ${monthName(shiftBillingCycle(natural, 1))} statement`,
            sub: 'Posted after this cycle was cut',
          },
          {
            cycle: shiftBillingCycle(natural, -1) as string | undefined,
            icon: <ArrowDown size={20} />,
            label: `Move to ${monthName(shiftBillingCycle(natural, -1))} statement`,
            sub: 'Posted before this cycle opened',
          },
          {
            cycle: undefined,
            icon: <RotateCcw size={20} />,
            label: 'Reset to transaction date',
            sub: `Bills in ${monthName(natural)}, as dated`,
          },
        ]
          .filter(c => (c.cycle ?? natural) !== applied)
          // Nearest destination first, measured from the cycle you're looking at. On the open cycle
          // holding a charge that was pushed forward, that puts "Reset" (one month back) above
          // "Move to July" (two) — the likely correction ahead of the distant one. Ties keep the
          // declared order, so an unmoved charge still offers next-then-previous, up-then-down.
          .sort((a, b) =>
            Math.abs(differenceInCalendarMonths(parseISO(`${a.cycle ?? natural}-01`), selectedDate))
            - Math.abs(differenceInCalendarMonths(parseISO(`${b.cycle ?? natural}-01`), selectedDate))
          );

        return (
          <div className="modal-overlay" onClick={() => setMoveTarget(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                {/* "Transaction", not "Charge": refunds move too, and a refund isn't a charge. */}
                <h3>Move Transaction</h3>
                <button onClick={() => setMoveTarget(null)}><X /></button>
              </div>
              <div className="modal-body flex-col gap-3">
                <div className="flex-col" style={{ gap: '0.15rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {moveTarget.description}
                  </span>
                  <span className="text-mono text-xs text-secondary">
                    {formatCredCurrency(moveTarget.amount, 'var(--font-mono)')}
                    {' · '}
                    {new Date(moveTarget.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase()}
                    {' · billed in '}{monthName(applied)}
                  </span>
                </div>

                {choices.map(choice => (
                  <button
                    key={choice.cycle ?? 'reset'}
                    className="btn btn-secondary w-100 flex-row align-center gap-3"
                    style={{ justifyContent: 'flex-start', padding: '1rem', textAlign: 'left' }}
                    onClick={() => applyCycleMove(moveTarget, choice.cycle)}
                  >
                    {choice.icon}
                    <span className="flex-col" style={{ gap: '0.15rem', minWidth: 0 }}>
                      <span>{choice.label}</span>
                      {/* .btn imposes uppercase + 1px letter-spacing on everything inside it, which
                          on a full sentence read louder and wider than the label above it even at a
                          smaller font-size. Opted out here so the explanation stays subordinate to
                          the action, in the sentence case it's written in. */}
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 400,
                        color: 'var(--text-secondary)',
                        textTransform: 'none',
                        letterSpacing: 'normal',
                      }}>{choice.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary w-100" style={{ padding: '1rem' }} onClick={() => setMoveTarget(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {undoState && (
        <div
          className="fade-in flex align-center justify-between"
          style={{
            position: 'fixed',
            left: '1rem',
            right: '1rem',
            bottom: `calc(1.25rem + env(safe-area-inset-bottom, 12px))`,
            // Above .modal-overlay (9000) so it isn't buried if another sheet opens over it.
            zIndex: 9100,
            gap: '1rem',
            padding: '0.75rem 0.85rem 0.75rem 1rem',
            borderRadius: '12px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {undoState.message}
          </span>
          <button
            className="flex align-center"
            onClick={undoCycleMove}
            style={{ gap: '0.35rem', flexShrink: 0, background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', padding: '0.15rem 0.25rem' }}
          >
            <Undo2 size={15} /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
