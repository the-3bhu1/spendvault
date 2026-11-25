import React, { useState } from 'react';

/* A box that only ever holds a number being typed.

   `type="number"` was the old answer and it isn't one: the browser accepts "-", "+", "e" and "."
   anywhere (1e5 is a number), shows them, and then reports the box as EMPTY to the code — so a lone
   "-" sat on screen while the form believed nothing was typed. Filtering keystrokes doesn't work
   either: Android's on-screen keyboards send no usable key codes.

   So this is a text box whose every change is checked against the shape a number takes while it is
   being typed — digits, at most one decimal point, and a leading minus only where a negative is a
   real value — and a change that doesn't fit is simply not applied. A paste is cleaned first
   ("₹ 1,00,000" → 100000) rather than refused outright.

   It keeps the TEXT itself, because the number alone can't round-trip mid-typing: "12." parses to
   12, and a box bound to the number would eat the decimal point as it was typed. The text follows
   `value` whenever the two stop agreeing as numbers — a form reset, a pre-fill — and is otherwise
   left as typed. */

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  value: number | string | undefined | null;
  /** `num` is undefined for a blank box, or one holding only "-" or ".". */
  onValueChange: (text: string, num: number | undefined) => void;
  /** Whole numbers only — days, counts. */
  integer?: boolean;
  /** A leading minus is allowed. Off by default: most amounts can't be below zero. */
  allowNegative?: boolean;
  /** Most digits before the decimal point — 2 for a day of the month. */
  maxDigits?: number;
};

const toNumber = (text: string): number | undefined => {
  if (text === '' || text === '-' || text === '.' || text === '-.') return undefined;
  const n = parseFloat(text);
  return isNaN(n) ? undefined : n;
};

const asText = (value: Props['value']) =>
  value === undefined || value === null || (typeof value === 'number' && isNaN(value)) ? '' : String(value);

export function NumericInput({ value, onValueChange, integer, allowNegative, maxDigits, ...rest }: Props) {
  const [text, setText] = useState(() => asText(value));
  // Follow the outside value when it has moved on from what is typed — compared as numbers, so
  // "12." against 12 is NOT a change and the half-typed decimal survives.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    const outside = asText(value);
    if (toNumber(outside) !== toNumber(text)) {
      setText(outside);
    }
  }

  const digits = maxDigits ? `{0,${maxDigits}}` : '*';
  const shape = new RegExp(`^${allowNegative ? '-?' : ''}\\d${digits}${integer ? '' : '(\\.\\d*)?'}$`);

  const accept = (raw: string) => {
    let next = raw;
    // Deleting is always allowed, even out of a shape the box would not let you type: a value
    // carried in from elsewhere ("-1500" left behind when the account type moved from bank to
    // wallet) must be erasable with backspace, or the box is stuck holding it.
    const deleting = next.length < text.length;
    if (!shape.test(next) && !deleting) {
      // A paste, most likely: drop the currency sign, grouping commas and spaces, then try again.
      next = next.replace(/[₹,\s]/g, '');
      if (!shape.test(next)) return;
    }
    setText(next);
    onValueChange(next, toNumber(next));
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={text}
      onChange={e => accept(e.target.value)}
    />
  );
}
