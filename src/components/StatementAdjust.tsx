// ── Correcting a statement figure by hand ────────────────────────────────────────────────────────
//
// The app derives a statement the way a bank does — purchases, less cashback and refunds, put
// through the card's rounding rule — and that is right almost always. Almost: a bank can round the
// other way on a single cycle, or change its policy without saying so, and when it does the printed
// bill is the authority and we are a rupee out. There is no rule to infer from one such cycle, so
// this lets the printed figure win for that cycle and nothing else.
//
// It is reached by HOLDING the statement amount, which is the same gesture the ledger rows below it
// already use to move a charge between cycles — one screen, one way of saying "this figure is
// wrong, let me fix it". See useLongPress.
import React, { useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { formatCurrency, formatBillingCycleRange } from '../utils';

export const StatementAdjustSheet: React.FC<{
  cycle: string;
  statementDay: number;
  /** What is on screen now — the hand-entered figure if there is one, else the derived one. */
  charged: number;
  /** What the app works the statement out to be. The reset target. */
  computed: number;
  adjusted: boolean;
  /** `undefined` clears the adjustment and hands the cycle back to the rounding rule. */
  onApply: (value: number | undefined) => void;
  onCancel: () => void;
}> = ({ cycle, statementDay, charged, computed, adjusted, onApply, onCancel }) => {
  // Seeded from what is on screen, so the common edit — a rupee up or down — starts from the right
  // number rather than from an empty field.
  const [text, setText] = useState(String(charged));
  const parsed = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
  // Saving the derived figure is not an adjustment, it is agreement — storing it would pin the cycle
  // against a later change to the rounding rule for no reason the user asked for.
  const isNoOp = valid && parsed === computed;

  return (
    <div className="modal-overlay sheet-held" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Statement Amount</h3>
          <button onClick={onCancel}><X /></button>
        </div>
        <div className="modal-body flex-col gap-3">
          <div className="flex-col" style={{ gap: '0.15rem', marginBottom: '0.25rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              {format(parseISO(`${cycle}-01`), 'MMMM yyyy')}
            </span>
            <span className="text-mono text-xs text-secondary">
              {formatBillingCycleRange(cycle, statementDay)}
            </span>
          </div>

          <p className="text-secondary" style={{ fontSize: '0.82rem', lineHeight: 1.5, margin: 0 }}>
            Enter the figure your bank printed. Banks don't always round the way they say they do,
            and the bill wins. This changes {format(parseISO(`${cycle}-01`), 'MMMM')} only — every
            other cycle keeps following the card's rounding rule.
          </p>

          {/* The app's own field, down to the digits-only guard the log form uses: a native number
              input renders its own spinner and its own font, and this modal sat one screen away from
              a form that looks nothing like it. */}
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label>Statement amount</label>
            <input
              type="text"
              inputMode="decimal"
              className="input-field"
              value={text}
              onChange={e => {
                const v = e.target.value;
                if (v === '' || /^\d*\.?\d*$/.test(v)) setText(v);
              }}
              placeholder={String(computed)}
              autoFocus
            />
            <span className="text-mono text-xs text-secondary" style={{ marginTop: '0.4rem' }}>
              Calculated: {formatCurrency(computed)}
            </span>
          </div>

          <button
            className="btn btn-primary w-100"
            disabled={!valid || isNoOp}
            onClick={() => onApply(parsed)}
            style={{ padding: '0.9rem' }}
          >
            {isNoOp ? 'Same as calculated' : 'Save statement amount'}
          </button>

          {adjusted && (
            <button
              className="btn btn-secondary w-100 flex-row align-center gap-3"
              style={{ justifyContent: 'center', padding: '0.9rem' }}
              onClick={() => onApply(undefined)}
            >
              <RotateCcw size={18} />
              Reset to {formatCurrency(computed)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
