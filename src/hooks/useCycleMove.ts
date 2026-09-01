// ── Moving a charge between statements ───────────────────────────────────────────────────────────
//
// Lifted out of AccountStatement when the Cards tree grew a Level 3 statement screen. Two surfaces
// now show a cycle's ledger, and both have to offer the same gesture with the same rules: a charge
// moved on one is moved on the other, because both write the same field and every figure downstream
// reads it through getAppliedBillingCycle.
//
// LONG-PRESS, not swipe. Swipe-right on a transaction row already means DELETE everywhere else in
// the app (Transactions.tsx, and the tour teaches it), and borrowing a destructive gesture for a
// reversible one is the worst trade available. Long-press's other meaning — drag to reorder —
// doesn't exist on either of these screens, so there's nothing to confuse it with.
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '../FinanceContext';
import { hapticTap } from '../utils/haptics';
import type { Transaction } from '../types';

// Movable: purchases, refunds, reversals — anything whose cycle depends on when the bank got round
// to POSTING it. Two categories are excluded, and neither is long-pressable nor tagged, because for
// both the cycle is decided rather than observed:
//
// - CC Payment: you choose the statement it reduces when you log it ("Apply Payment To"). The log
//   form also re-derives the field on every save, so a move here would be overwritten anyway.
// - Cashback: generated to the card's own policy — same cycle or next, per cashbackCreditCycle —
//   and Cashback.tsx dates the credit off that rule. A bank that pays in the following cycle pays
//   in the following cycle; it doesn't slip to a third one the way a merchant's batch can.
const FIXED_CYCLE_CATEGORIES = new Set(['cc payment', 'cashback']);

export const canMoveCycle = (tx: Transaction) =>
  !FIXED_CYCLE_CATEGORIES.has((tx.category || '').toLowerCase());

// Shared with the statement figure's own hold — see useLongPress, which owns them now so the two
// gestures on this screen cannot drift apart.
import { LONG_PRESS_MS, PRESS_CANCEL_PX } from './useLongPress';

/** The handlers a ledger row spreads onto itself to become long-pressable. */
export type CyclePressHandlers = Pick<
  React.DOMAttributes<HTMLDivElement>,
  'onContextMenu' | 'onTouchStart' | 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel'
  | 'onMouseDown' | 'onMouseMove' | 'onMouseUp' | 'onMouseLeave'
>;

export interface CycleMoveState {
  /** The charge whose move sheet is open, if any. */
  moveTarget: Transaction | null;
  closeMove: () => void;
  /** The confirmation still on screen, if any. */
  undoState: { tx: Transaction; message: string } | null;
  applyCycleMove: (tx: Transaction, target: string | undefined) => void;
  undoCycleMove: () => void;
  press: (tx: Transaction) => CyclePressHandlers;
}

export function useCycleMove(): CycleMoveState {
  const context = useFinance();
  const updateTransaction = context?.updateTransaction;

  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const [moveTarget, setMoveTarget] = useState<Transaction | null>(null);
  const [undoState, setUndoState] = useState<{ tx: Transaction; message: string } | null>(null);

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

  // A press that turns into a scroll is a scroll. The rows sit in a scrollable viewport, and a
  // finger flicking it starts out identical to a press being held.
  const trackPress = (x: number, y: number) => {
    if (!pressOrigin.current) return;
    if (Math.hypot(x - pressOrigin.current.x, y - pressOrigin.current.y) > PRESS_CANCEL_PX) cancelPress();
  };

  useEffect(() => () => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
  }, []);

  // `target` of undefined clears the override and hands the charge back to its own date. Callers
  // only ever pass the natural cycle's neighbours — see CycleMoveSheet for why that's clamped.
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

  const press = (tx: Transaction): CyclePressHandlers => ({
    // Android pops text-selection handles on a long press otherwise, on top of the sheet.
    onContextMenu: e => e.preventDefault(),
    onTouchStart: e => startPress(tx, e.touches[0].clientX, e.touches[0].clientY),
    onTouchMove: e => trackPress(e.touches[0].clientX, e.touches[0].clientY),
    onTouchEnd: cancelPress,
    onTouchCancel: cancelPress,
    onMouseDown: e => startPress(tx, e.clientX, e.clientY),
    onMouseMove: e => trackPress(e.clientX, e.clientY),
    onMouseUp: cancelPress,
    onMouseLeave: cancelPress,
  });

  return { moveTarget, closeMove: () => setMoveTarget(null), undoState, applyCycleMove, undoCycleMove, press };
}
