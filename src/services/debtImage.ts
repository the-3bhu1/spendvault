import { formatCurrency } from '../utils';
import { C, W, PADX, roundRect, ellipsize, newCanvas, canvasToBlob, drawFooter } from './shareCanvas';

// Renders a person's debt history as shareable PNG(s) — the image you send the other person so you
// both agree on where you stand. Built on the same canvas primitives as the split summary.
//
// EVERY ENTRY, ALWAYS, and that is a decision rather than an omission. The obvious alternatives are
// "just the open ones" and "just this date range", and neither can be told honestly:
//
//   - "Open ones" would mean the un-ticked entries, but a tick is a checkoff, not a settlement — it
//     changes nothing about the balance (see the netBalance reduce in Debts.tsx). So a filtered
//     image would list rows that do not add up to the figure printed above them, which is the one
//     thing a statement between two people must never do.
//   - A date range is worse for the same reason turned around: this ledger is cumulative, so the
//     entries BEFORE the window are precisely what makes the balance non-zero. A window is only
//     honest with a brought-forward opening balance, and that is a statement, not a share button.
//
// So: everything, newest first, paginated as far as it needs to go.

export interface DebtImageEntry {
  date: string;          // ISO — rendered as dd/MM/yyyy
  description: string;
  amount: number;
  /** Which way the money went. Drives both the label and the colour. */
  type: 'lent' | 'borrowed' | 'repayment_received' | 'repayment_sent';
  /** Ticked off on the screen. Carried through so the image looks like what the sender is looking at. */
  markedDone?: boolean;
}

export interface DebtImageOpts {
  personName: string;
  /** Positive: they owe you. Negative: you owe them. */
  netBalance: number;
  settled: boolean;
  entries: DebtImageEntry[];
}

/** Entries per page. The header block is repeated on each, so every image stands on its own. */
const ENTRIES_PER_PAGE = 12;
const ENTRY_ROW = 78; // two-line entry card height + gap

const TYPE_LABEL: Record<DebtImageEntry['type'], string> = {
  lent: 'Lent',
  borrowed: 'Borrowed',
  repayment_received: 'Repayment received',
  repayment_sent: 'Repayment sent',
};

/* Green is YOUR side of the entry — you lent it, or you got it back. Deliberately the same rule as
   the row icons on screen, which is a different axis from the sign in the net balance: a repayment
   received is green here but SUBTRACTS from what they owe you. Mirroring the screen matters more
   than mirroring the arithmetic, because the person sharing it is looking at the screen. */
const toneOf = (t: DebtImageEntry['type']) =>
  t === 'lent' || t === 'repayment_received' ? C.success : C.danger;

async function renderDebtPage(
  opts: DebtImageOpts,
  entries: DebtImageEntry[],
  page: number,
  pages: number,
): Promise<Blob> {
  const { personName, netBalance, settled } = opts;

  // ---- Measure up front, so the canvas is exactly as tall as its content ----
  let H = 44 + 34 + 40 + 30;                        // top pad + kicker + name + balance line
  H += 30 + 30;                                     // divider gap + section header
  H += entries.length ? entries.length * ENTRY_ROW : 56;
  H += 72;                                          // footer

  const { canvas, ctx } = newCanvas(H);
  let y = 44;

  // Kicker
  ctx.fillStyle = C.muted;
  ctx.font = '700 13px monospace';
  // \u2002 is an EN SPACE. A plain space sets the emoji too tight against the words, and two
  // plain spaces overshoot; one en-space is the gap this pairing wants.
  ctx.fillText('\u{1F91D}\u2002DEBT SUMMARY', PADX, y + 14);
  y += 34;

  // Person
  ctx.fillStyle = C.text;
  ctx.font = '800 30px sans-serif';
  ctx.fillText(ellipsize(ctx, personName, W - PADX * 2), PADX, y + 12);
  y += 40;

  /* The headline, and the words that say which way it points. A bare ₹18,164.45 between two people
     is the one number that MUST NOT be ambiguous — it is the whole reason the image is being sent —
     so the direction is spelt out rather than left to the colour, which does not survive a
     screenshot pasted into a chat with a light background. */
  const owed = netBalance > 0 ? `${personName} owes you`
    : netBalance < 0 ? `You owe ${personName}`
      : 'All settled up';
  ctx.font = '800 34px sans-serif';
  ctx.fillStyle = netBalance === 0 ? C.text : netBalance > 0 ? C.success : C.danger;
  const amtHead = netBalance === 0 ? formatCurrency(0) : formatCurrency(Math.abs(netBalance));
  ctx.fillText(amtHead, PADX, y + 12);
  const headW = ctx.measureText(amtHead).width;
  ctx.font = '600 15px sans-serif';
  ctx.fillStyle = C.muted;
  ctx.fillText(ellipsize(ctx, `·  ${owed}${settled ? '  ·  Settled' : ''}`, W - PADX * 2 - headW - 16), PADX + headW + 16, y + 10);
  y += 30;

  // Divider
  ctx.strokeStyle = C.panelBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADX, y);
  ctx.lineTo(W - PADX, y);
  ctx.stroke();
  y += 30;

  // ---- Entries ----
  ctx.fillStyle = C.accent;
  ctx.font = '700 13px monospace';
  const label = pages > 1
    ? `TRANSACTION LOG (${page + 1}/${pages})`
    : `TRANSACTION LOG (${entries.length})`;
  ctx.fillText(label, PADX, y + 4);
  y += 22;

  if (!entries.length) {
    ctx.fillStyle = C.muted;
    ctx.font = '600 15px sans-serif';
    ctx.fillText('No entries yet.', PADX, y + 20);
    y += 56;
  } else {
    entries.forEach(e => {
      const rowH = ENTRY_ROW - 12;
      ctx.fillStyle = C.panel;
      roundRect(ctx, PADX, y, W - PADX * 2, rowH, 14);
      ctx.fill();

      const cx = PADX + 20;
      const tone = e.markedDone ? C.muted : toneOf(e.type);
      const amtT = formatCurrency(e.amount);

      // Amount first, so the description knows how much room is left for it.
      ctx.font = '800 18px sans-serif';
      const amtW = ctx.measureText(amtT).width;
      ctx.fillStyle = tone;
      ctx.fillText(amtT, W - PADX - 20 - amtW, y + 32);

      ctx.fillStyle = e.markedDone ? C.muted : C.text;
      ctx.font = '700 16px sans-serif';
      const descT = ellipsize(ctx, e.description || TYPE_LABEL[e.type], W - PADX * 2 - amtW - 70);
      ctx.fillText(descT, cx, y + 26);

      /* The kind is dropped when the description already IS it. Most entries are logged with a
         description of their own, but the quick ones inherit the button's word — and "Lent" over
         "23/08/2026 · Lent" spends a line saying it twice. */
      const kind = e.description.trim().toLowerCase() === TYPE_LABEL[e.type].toLowerCase()
        ? '' : `  ·  ${TYPE_LABEL[e.type]}`;
      ctx.fillStyle = C.muted;
      ctx.font = '500 13px sans-serif';
      ctx.fillText(`${e.date}${kind}${e.markedDone ? '  ·  Done' : ''}`, cx, y + 48);

      /* A ticked entry is struck through on screen; canvas has no text-decoration, so the line is
         drawn. Both the description and the amount, matching the row it is a picture of. */
      if (e.markedDone) {
        ctx.strokeStyle = C.muted;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, y + 21);
        ctx.lineTo(cx + ctx.measureText(descT).width, y + 21);
        ctx.moveTo(W - PADX - 20 - amtW, y + 26);
        ctx.lineTo(W - PADX - 20, y + 26);
        ctx.stroke();
      }

      y += ENTRY_ROW;
    });
  }

  y += 18;
  drawFooter(ctx, y);
  return await canvasToBlob(canvas);
}

/** The history as one image, or as many as its length needs. Newest entry first, as on screen. */
export async function buildDebtShareImages(opts: DebtImageOpts): Promise<Blob[]> {
  const { entries } = opts;
  const pages = Math.max(1, Math.ceil(entries.length / ENTRIES_PER_PAGE));
  const blobs: Blob[] = [];
  for (let p = 0; p < pages; p++) {
    blobs.push(await renderDebtPage(opts, entries.slice(p * ENTRIES_PER_PAGE, (p + 1) * ENTRIES_PER_PAGE), p, pages));
  }
  return blobs;
}
