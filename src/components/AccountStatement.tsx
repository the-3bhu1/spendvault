import { useLayoutEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CreditCard, Calendar, ChevronLeft } from 'lucide-react';
import { CustomPicker } from './CustomPicker';
import RollingNumber from './RollingNumber';
import {
  getBillingCycleForDate, getCardGradients, formatBillingCycleRange, affectsRupeeBalance, resolveCardIssuer,
  getAppliedBillingCycle, formatCurrency,
} from '../utils';
import { useCycleMove } from '../hooks/useCycleMove';
import { CycleLedgerRow, CycleMoveSheet, CycleMoveToast } from './CycleMove';
import { CardSurface } from './CardSurface';
import { CardChip } from './CardChip';
import { CardBrandLogo } from './CardBrandLogo';
import type { Account, Transaction } from '../types';
import { CardNetworkLogo } from './CardNetworkLogo';
import { useFinance } from '../FinanceContext';
import { getCardCycleFigures, getCardDues, cycleStatus, isCycleOverdue, CYCLE_STATUS_LABEL } from '../services/CardDuesService';
import { useLongPress } from '../hooks/useLongPress';
import { StatementAdjustSheet } from './StatementAdjust';

interface AccountStatementProps {
  account: Account;
  transactions: Transaction[];
  onClose: () => void;
  // Which cycle to land on. Omitted means the one still running, which is what every entry point
  // wanted until the Statements list started opening this screen from a row that names a specific
  // closed month — that row has to arrive at the month it shows, not at today's.
  initialCycle?: string;
}

/** Matches the Statements list's icon colours, so the same state reads the same on both screens. */
const STATUS_TONE: Record<string, string> = {
  overdue: 'var(--danger)',
  overpaid: 'var(--success)',
  settled: 'var(--success)',
  partial: 'var(--accent)',
  unpaid: 'var(--text-secondary)',
};

export default function AccountStatement({ account, transactions, onClose, initialCycle }: AccountStatementProps) {
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
  // The LIVE account, not the prop. The prop is a snapshot taken when this screen was opened, so a
  // statement figure corrected below would be written to the store and then not appear here.
  const acc = context?.data.accounts.find(a => a.id === account.id) ?? account;
  const statementDay = acc.statementDay || 1;
  const currentCycle = getBillingCycleForDate(format(new Date(), 'yyyy-MM-dd'), statementDay);
  // Reads the manual override for debits as well as payments — see getAppliedBillingCycle. The
  // card's outstanding balance (calculateCycleBalanceForCycle) and the bill reminder
  // (CardDuesService) go through the same helper, so a charge moved here moves everywhere at once
  // rather than leaving this screen disagreeing with the card it belongs to.
  const getTransactionCycle = (tx: Transaction) => getAppliedBillingCycle(tx, statementDay);

  // Declared up here rather than beside the other view state below: cycleOptions reads it.
  const [selectedCycle, setSelectedCycle] = useState(initialCycle ?? currentCycle);
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

  // Long-press a charge to move it between cycles. The rules, the timers and the writes all live
  // in useCycleMove, because Level 3 of the Cards tree offers the same gesture over the same field —
  // see the note at the top of that file.
  const { moveTarget, closeMove, undoState, applyCycleMove, undoCycleMove, press } = useCycleMove();

  const cycleTxs = relevantAccountTransactions
    .filter(t => getTransactionCycle(t) === selectedCycle)
    .sort((a, b) => b.date.localeCompare(a.date));

  // Derived by the service, not re-summed here. This screen and the Statements list are one tap
  // apart and must not be able to disagree about the same cycle — and the arithmetic is no longer
  // "debits minus credits": cashback and refunds are netted INTO the statement the way a bank nets
  // them, while payments are recorded against it. One place decides which credit is which.
  const figures = getCardCycleFigures(acc, transactions, selectedCycle);
  // WHAT THE CYCLE BILLED, not what is left owing on it. The headline used to be the net of
  // payments, which meant a statement you had already cleared showed ₹0.00 directly above the list
  // of the very charges that made it up — the screen contradicting its own ledger, and no way to
  // find out what a settled month had cost you. What is still owed is the line underneath.
  const chargedAmount = figures.charged;
  const stillDue = figures.due;
  // The same word the Statements row's icon means, off the same ladder — the two screens are one tap
  // apart and used to disagree, this one saying "Paid in full" under a row drawn with a red triangle.
  const status = cycleStatus(
    figures,
    isCycleOverdue(getCardDues(acc, transactions), selectedCycle, figures.due)
  );

  // Hold the figure to correct it by hand — the same gesture the ledger rows below use to move a
  // charge.
  const [adjusting, setAdjusting] = useState(false);
  const adjustPress = useLongPress(() => setAdjusting(true));
  const applyAdjustment = (value: number | undefined) => {
    const next = { ...(acc.statementAdjustments || {}) };
    if (value === undefined) delete next[selectedCycle];
    else next[selectedCycle] = value;
    // Dropped entirely when the last entry goes, so an account that has been corrected and then
    // un-corrected serialises identically to one that never was.
    context.updateAccount({ ...acc, statementAdjustments: Object.keys(next).length ? next : undefined });
    setAdjusting(false);
  };

  /* Layout effect, not a plain effect: the "View all" button renders only when this says the
     list is clipped, so the measurement has to settle BEFORE paint or the button pops in a
     frame late on every open. */
  useLayoutEffect(() => {
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

      /* No slack in this comparison. A row cut by even a pixel is a row the user cannot fully
         read, so it counts as clipped and earns the "View all" link — erring toward offering
         the link is always cheaper than silently hiding half a transaction. */
      setIsTransactionsClipped(content.scrollHeight > viewport.clientHeight);
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
      <div className="flex-col" style={{ gap: 0, height: '100%', background: 'var(--bg-color)' }}>
        <div style={{
          paddingTop: 'calc(0.75rem + var(--safe-area-inset-top))',
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
          height: showAllTransactions ? '0px' : '348px',
          overflow: 'hidden',
          transition: showAllTransactions
            ? 'height 1.2s cubic-bezier(0.76, 0, 0.24, 1) 0.3s'
            : 'height 1.2s cubic-bezier(0.76, 0, 0.24, 1)'
        }}>
          <div style={{
            height: '348px',
            background: 'linear-gradient(180deg, var(--bg-hover) 0%, var(--bg-color) 80%, var(--bg-color) 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            /* Asymmetric on purpose. The band is sized to its content (title 88.8 + card 214.4
               + 12 gap = 315.2), so this padding IS the visible breathing room: 20px above the
               title, 12px below the card. The lower figure is the smaller of the two because
               the raked card's near edge projects 1px ABOVE its layout box, so the ink already
               reads as further from the edge than the number suggests — 12px is what keeps the
               drop shadow from being cut by this band's overflow:hidden. */
            padding: '1.25rem 1.5rem 0.75rem',
            textAlign: 'center',
            color: 'var(--text-primary)',
          }}>
            <h2 className="text-serif" style={{
              fontSize: '1.85rem',
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
                      /* Same family as the account name directly above it. This was
                         '"Courier New", Courier, monospace' — a stack that ships on no Android
                         device, so it fell back to the system mono and left the name as the one
                         element on this card face in a typeface used nowhere else in the app.
                         Monospacing was the tell, not the specific face, so the app mono read
                         no better; matching the neighbouring label is what makes it belong. */
                      fontFamily: 'var(--font-family)',
                      /* 400, matching the label above and the weight the old Courier rendered at.
                         Anything heavier stops reading as embossed lettering and starts reading
                         as a headline. */
                      fontWeight: 400,
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
          padding: '0.75rem 1.5rem 0 1.5rem',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div className="flex-col align-center" style={{ flexShrink: 0 }}>
            <span className="text-mono text-xs text-muted font-bold uppercase" style={{ opacity: 0.5, marginBottom: '0.5rem' }}>
              Statement Amount
              {/* Said out loud, always. A hand-entered figure that looks exactly like a derived one
                  is the only outcome here worse than being a rupee out. */}
              {figures.adjusted && <span style={{ color: 'var(--warning)', marginLeft: '0.5rem' }}>· Adjusted</span>}
            </span>
            <div
              className="text-serif"
              {...adjustPress}
              style={{
                fontSize: '1rem',
                lineHeight: 1,
                cursor: 'pointer',
                WebkitTouchCallout: 'none',
                WebkitUserSelect: 'none',
                userSelect: 'none',
                transition: 'transform 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                transform: showAllTransactions ? 'scale(0.85)' : 'scale(1)'
              }}
            >
              <RollingNumber value={chargedAmount} fontSize="2.5rem" />
            </div>
            {/* How the figure above was arrived at, when it is not simply the month's purchases.
                A bank prints this as a summary block; here it is one line, because the only part
                that is ever surprising is that the headline is smaller than what you spent. */}
            {figures.credits > 0 && (
              <span
                className="text-mono text-xs uppercase"
                style={{ marginTop: '0.5rem', letterSpacing: '0.5px', color: 'var(--text-secondary)', opacity: 0.85 }}
              >
                {formatCurrency(figures.spend)} spent − {formatCurrency(figures.credits)} credited
              </span>
            )}
            {status !== 'empty' && (
              <span
                className="text-mono text-xs font-bold uppercase"
                style={{ marginTop: '0.4rem', letterSpacing: '0.5px', color: STATUS_TONE[status] }}
              >
                {CYCLE_STATUS_LABEL[status]}
                {/* The remainder rides with the word rather than replacing it. This screen is the
                    record, and "Overdue" without the figure sends you back to the ledger to add up
                    what is left. */}
                {stillDue > 0 && ` · ${formatCurrency(stillDue)} still due`}
              </span>
            )}
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
                cycleTxs.map((tx, idx) => (
                  <CycleLedgerRow
                    key={tx.id}
                    tx={tx}
                    statementDay={statementDay}
                    selectedCycle={selectedCycle}
                    index={idx}
                    press={press(tx)}
                  />
                ))
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

          {/* Same condition the fade scrim uses, so the link and the fade always agree: offer
              "View all" only when something is actually hidden. Once expanded the link stays,
              as the way back to the collapsed view. */}
          {cycleTxs.length > 0 && (showAllTransactions || isTransactionsClipped) && (
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

      {moveTarget && (
        <CycleMoveSheet
          tx={moveTarget}
          statementDay={statementDay}
          selectedCycle={selectedCycle}
          onApply={applyCycleMove}
          onCancel={closeMove}
        />
      )}

      {undoState && <CycleMoveToast message={undoState.message} onUndo={undoCycleMove} />}

      {adjusting && (
        <StatementAdjustSheet
          cycle={selectedCycle}
          statementDay={statementDay}
          charged={chargedAmount}
          computed={figures.computed}
          adjusted={figures.adjusted}
          onApply={applyAdjustment}
          onCancel={() => setAdjusting(false)}
        />
      )}
    </div>
  );
}
