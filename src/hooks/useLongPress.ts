// ── The app's long-press gesture, on its own ─────────────────────────────────────────────────────
//
// Extracted from useCycleMove when a second thing on the statement screen became long-pressable.
// The timings live here rather than in either caller so the two gestures can't drift apart: a user
// who has learnt the ledger row's press must get the same press on the statement figure, and 450ms
// against 500ms is exactly the kind of difference that reads as "it didn't work".
//
// LONG-PRESS, not swipe — the reasoning is in useCycleMove and applies here too: swipe-right already
// means DELETE everywhere else in the app, and borrowing a destructive gesture for a reversible one
// is the worst trade available.
import { useEffect, useRef } from 'react';
import type React from 'react';
import { hapticTap } from '../utils/haptics';

export const LONG_PRESS_MS = 450;
/** Moving further than this cancels the press: it was a scroll, not a hold. */
export const PRESS_CANCEL_PX = 10;

export type LongPressHandlers = Pick<
  React.DOMAttributes<HTMLElement>,
  'onContextMenu' | 'onTouchStart' | 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel'
  | 'onMouseDown' | 'onMouseMove' | 'onMouseUp' | 'onMouseLeave'
>;

/**
 * Handlers to spread onto whatever should respond to a hold. `enabled` of false returns handlers
 * that do nothing rather than no handlers at all, so a caller can spread it unconditionally.
 */
export function useLongPress(onLongPress: () => void, enabled = true): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Read through a ref so a hold that outlives a re-render still fires the CURRENT callback rather
  // than the one captured when the finger went down. Written in an effect, not during render.
  const cb = useRef(onLongPress);
  useEffect(() => { cb.current = onLongPress; });

  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  };

  // Only for unmount: a timer that fires into a gone component would setState on nothing.
  useEffect(() => cancel, []);

  const start = (x: number, y: number) => {
    if (!enabled) return;
    cancel();
    origin.current = { x, y };
    timer.current = window.setTimeout(() => {
      timer.current = null;
      hapticTap();
      cb.current();
    }, LONG_PRESS_MS);
  };

  const move = (x: number, y: number) => {
    if (!origin.current) return;
    if (Math.abs(x - origin.current.x) > PRESS_CANCEL_PX || Math.abs(y - origin.current.y) > PRESS_CANCEL_PX) cancel();
  };

  return {
    // Desktop's own hold gesture. Without this a right-click (or a trackpad hold) opens the browser
    // menu on top of the sheet the press just opened.
    onContextMenu: e => { if (enabled) e.preventDefault(); },
    onTouchStart: e => start(e.touches[0].clientX, e.touches[0].clientY),
    onTouchMove: e => move(e.touches[0].clientX, e.touches[0].clientY),
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onMouseDown: e => start(e.clientX, e.clientY),
    onMouseMove: e => move(e.clientX, e.clientY),
    onMouseUp: cancel,
    onMouseLeave: cancel,
  };
}
