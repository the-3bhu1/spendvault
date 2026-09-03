// ── A cycle's ledger, and the sheet that moves a charge out of it ────────────────────────────────
//
// The rows, the move sheet and its undo toast, shared by the two screens that show one billing
// cycle: the statement modal opened from Accounts, and Level 3 of the Cards tree. They looked at the
// same data before this file existed, and one of them was about to grow a second implementation of
// it — see the note in useCycleMove.
//
// Rendering, only. Every rule about what may move and where lives in useCycleMove; these components
// take a press bundle and an apply callback and do as they are told.
import React from 'react';
import { format, parseISO, differenceInCalendarMonths } from 'date-fns';
import { ArrowDown, ArrowUp, RotateCcw, Undo2, X } from 'lucide-react';
import { getCategoryIcon } from './transactionIcons';
import { getAppliedBillingCycle, getNaturalBillingCycle, shiftBillingCycle, isNearStatementCut } from '../utils';
import { canMoveCycle, type CyclePressHandlers } from '../hooks/useCycleMove';
import type { Transaction } from '../types';

/** Rupees whole, paise smaller — the way a statement prints an amount. Used by the rows and by the
 *  sheet's summary line, so the same charge reads identically in both. Deliberately NOT exported:
 *  it returns JSX, so it can't live in utils.ts, and exporting it alongside these components breaks
 *  fast refresh for the whole file. Anything else that needs it should take a row instead. */
const formatCycleAmount = (amount: number, font = 'serif') => {
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

/**
 * One charge on a statement. Long-pressable when its cycle is observed rather than decided, and
 * tagged when the press has either already been used or is worth offering.
 */
export const CycleLedgerRow: React.FC<{
  tx: Transaction;
  statementDay: number;
  /** The cycle being looked at — decides whether the "may settle next" hint applies. */
  selectedCycle: string;
  /** Staggers the row's entrance. */
  index: number;
  press: CyclePressHandlers;
}> = ({ tx, statementDay, selectedCycle, index, press }) => {
  const naturalCycle = getNaturalBillingCycle(tx, statementDay);
  const appliedCycle = getAppliedBillingCycle(tx, statementDay);
  // Already moved by hand: say where it came from, so a 15 Aug row sitting among September's dates
  // reads as deliberate rather than as a sorting bug.
  //
  // Both tags track the gesture exactly: a row that can't be long-pressed must not be marked, or the
  // mark points at a control that isn't there. A CC payment sitting outside its date's cycle is not a
  // correction needing explanation — it's the normal result of "Apply Payment To", chosen when the
  // payment was logged, so tagging it told the person who set it something they already knew.
  const isMoved = canMoveCycle(tx) && appliedCycle !== naturalCycle;
  // Near enough to this cycle's cut that the bank may post it after the statement generates. Doubles
  // as the affordance — an unmarked long-press is undiscoverable.
  const nearCut = canMoveCycle(tx) && !isMoved
    && naturalCycle === selectedCycle
    && isNearStatementCut(tx.date, statementDay);

  return (
    <div
      className="flex justify-between align-center fade-in"
      style={{
        borderBottom: '1px solid var(--border-color)',
        opacity: 0.9,
        padding: '0.85rem 0',
        animationDelay: `${index * 0.05}s`,
        // Android pops text-selection handles on a long press otherwise, on top of the sheet.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
      {...press}
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
          {tx.type === 'credit' ? '+ ' : ''}{formatCycleAmount(tx.amount, 'var(--font-mono)')}
        </span>
        <span className="text-mono text-xs text-secondary" style={{ marginTop: '2px' }}>
          {new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase()}
        </span>
      </div>
    </div>
  );
};

/**
 * Where a charge may go. Both destinations are measured from the charge's NATURAL cycle, never from
 * wherever it currently sits, so the reachable set stays {previous, natural, next} no matter how many
 * times it's moved — otherwise three taps would put a purchase three months out with nothing on
 * screen explaining why. Options it already occupies are dropped, so the sheet never offers a move
 * that does nothing.
 */
export const CycleMoveSheet: React.FC<{
  tx: Transaction;
  statementDay: number;
  /** The cycle being looked at. Sorts the choices by how far each is from here. */
  selectedCycle: string;
  onApply: (tx: Transaction, target: string | undefined) => void;
  onCancel: () => void;
}> = ({ tx, statementDay, selectedCycle, onApply, onCancel }) => {
  const natural = getNaturalBillingCycle(tx, statementDay);
  const applied = getAppliedBillingCycle(tx, statementDay);
  const selectedDate = parseISO(`${selectedCycle}-01`);
  const monthName = (c: string) => format(parseISO(`${c}-01`), 'MMMM');
  // Up is later, down is earlier — the direction the cycle picker sorts in (newest cycle at the
  // top), so "up" moves the charge the same way the list reads.
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
    // holding a charge that was pushed forward, that puts "Reset" (one month back) above "Move to
    // July" (two) — the likely correction ahead of the distant one. Ties keep the declared order,
    // so an unmoved charge still offers next-then-previous, up-then-down.
    .sort((a, b) =>
      Math.abs(differenceInCalendarMonths(parseISO(`${a.cycle ?? natural}-01`), selectedDate))
      - Math.abs(differenceInCalendarMonths(parseISO(`${b.cycle ?? natural}-01`), selectedDate))
    );

  return (
    <div className="modal-overlay sheet-held" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          {/* "Transaction", not "Charge": refunds move too, and a refund isn't a charge. */}
          <h3>Move Transaction</h3>
          <button onClick={onCancel}><X /></button>
        </div>
        <div className="modal-body flex-col gap-3">
          <div className="flex-col" style={{ gap: '0.15rem', marginBottom: '0.25rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tx.description}
            </span>
            <span className="text-mono text-xs text-secondary">
              {formatCycleAmount(tx.amount, 'var(--font-mono)')}
              {' · '}
              {new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase()}
              {' · billed in '}{monthName(applied)}
            </span>
          </div>

          {choices.map(choice => (
            <button
              key={choice.cycle ?? 'reset'}
              className="btn btn-secondary w-100 flex-row align-center gap-3"
              style={{ justifyContent: 'flex-start', padding: '1rem', textAlign: 'left' }}
              onClick={() => onApply(tx, choice.cycle)}
            >
              {choice.icon}
              <span className="flex-col" style={{ gap: '0.15rem', minWidth: 0 }}>
                <span>{choice.label}</span>
                {/* .btn imposes uppercase + 1px letter-spacing on everything inside it, which on a
                    full sentence read louder and wider than the label above it even at a smaller
                    font-size. Opted out here so the explanation stays subordinate to the action, in
                    the sentence case it's written in. */}
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
          <button className="btn btn-secondary w-100" style={{ padding: '1rem' }} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

/** The way back from a move. Fixed to the viewport, so it belongs to the app rather than to
 *  whichever list the row left. */
export const CycleMoveToast: React.FC<{ message: string; onUndo: () => void }> = ({ message, onUndo }) => (
  <div
    className="fade-in flex align-center justify-between"
    style={{
      position: 'fixed',
      left: '1rem',
      right: '1rem',
      bottom: `calc(1.25rem + var(--safe-area-inset-bottom))`,
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
      {message}
    </span>
    <button
      className="flex align-center"
      onClick={onUndo}
      style={{ gap: '0.35rem', flexShrink: 0, background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', padding: '0.15rem 0.25rem' }}
    >
      <Undo2 size={15} /> Undo
    </button>
  </div>
);
