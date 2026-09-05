import { formatCurrency } from '../utils';
import { C, W, PADX, roundRect, ellipsize, newCanvas, canvasToBlob, drawFooter } from './shareCanvas';

// Renders shareable "split summary" PNGs entirely on a <canvas>, so it works offline in the
// Android/iOS WebView with no extra dependency. Small splits fit in one combined image; large
// splits are broken into a Settle-Up image + one or more (paginated) Expenses images so no single
// image gets impractically tall. Returns an array of PNG Blobs. Palette, geometry and the drawing
// primitives are shared with every other share image — see shareCanvas.

export interface SplitImageRow { from: string; to: string; amount: number; }
export interface SplitImageItem {
  description: string;
  amount: number;
  paidBy: string;
  participantNames: string[]; // who this expense was split among (names only — keeps the row short)
}
export interface SplitImageOpts {
  title: string;
  subtitle?: string;
  totalSpent: number;
  settlements: SplitImageRow[];
  items: SplitImageItem[];
  /** Everyone the EVENT has, as display names — not everyone a given expense has. An expense
   *  covering all of them is labelled "Everyone" instead of repeating the roster; see splitLabel. */
  everyone: string[];
}

// Layout thresholds — the "single vs. multiple" decision.
const SINGLE_MAX_ITEMS = 8;      // more expenses than this → split into separate images
const SINGLE_MAX_SETTLEMENTS = 6; // more settlements than this → split too
const ITEMS_PER_PAGE = 10;        // expenses per Expenses image once split

const SETTLE_ROW = 62; // settle row card height + gap
const ITEM_ROW = 96;   // three-line expense row card height + gap

interface RenderInput {
  title: string;
  subtitle?: string;
  totalSpent: number;
  settlements?: SplitImageRow[];  // present → draw the Settle-Up section
  items?: SplitImageItem[];       // present → draw the Expenses section
  everyone?: string[];            // the event's full roster, for the "Everyone" shorthand
  expensesLabel?: string;         // header text for the Expenses section (e.g. "Expenses (1/3)")
}

/* Who an expense was split among — by name, unless that is the whole event, in which case saying so
   is shorter AND clearer than proving it.
 
   On a trip most expenses cover everybody, so the roster is printed on line after line and the eye
   stops reading it; the ONE line that matters is the odd expense covering a subset, and it looks
   exactly like the five above it until you compare the lists name by name. "Everyone" collapses the
   repetition into a word, and the subsets are then the only rows carrying names — which is the
   difference you were meant to notice.
 
   Compared as a SET, not by count: an expense with as many people as the event but not the same
   people is not everyone, and it is the case most worth not mislabelling. The count stays in the
   "Split (3)" prefix, because that is what a reader dividing the total by heads is looking for.
 
   BOTH DIRECTIONS. "Every name is on the roster" is not enough on its own — with a name repeated,
   three entries can be two people and still pass it, and the third member goes unmentioned on an
   expense the image then calls Everyone. So the distinct names have to cover the roster and match
   it in size.
 
   Two-person events still get "Everyone" — the rule is worth more as one rule than as one with an
   exception — but a roster of one does not, since there is nobody for "everyone" to include. */
export const namesOrEveryone = (names: string[], everyone?: string[]) => {
  const roster = new Set(everyone || []);
  if (roster.size < 2) return names.join(', ');
  const involved = new Set(names);
  const isEveryone = involved.size === roster.size && [...roster].every(p => involved.has(p));
  return isEveryone ? 'Everyone' : names.join(', ');
};

async function renderSplitImage(input: RenderInput): Promise<Blob> {
  const { title, subtitle, totalSpent, settlements, items, expensesLabel, everyone } = input;

  // ---- Measure total height up front ----
  let H = 44 + 22 + 46 + 30; // top pad + kicker + title + total line
  if (settlements) {
    H += 30 + 30; // divider gap + section header
    H += settlements.length ? settlements.length * SETTLE_ROW : 56;
  }
  if (items) {
    H += 32 + 30; // divider gap + section header
    H += items.length ? items.length * ITEM_ROW : 56;
  }
  H += 72; // footer

  const { canvas, ctx } = newCanvas(H);

  let y = 44;

  // Kicker
  ctx.fillStyle = C.muted;
  ctx.font = '700 13px monospace';
  ctx.fillText('💰  SPLIT SUMMARY', PADX, y + 14);
  y += 34;

  // Event name
  ctx.fillStyle = C.text;
  ctx.font = '800 30px sans-serif';
  ctx.fillText(ellipsize(ctx, title, W - PADX * 2), PADX, y + 12);
  y += 40;

  // Total + subtitle
  ctx.font = '600 15px sans-serif';
  ctx.fillStyle = C.muted;
  ctx.fillText(`Total ${formatCurrency(totalSpent)}${subtitle ? '  ·  ' + subtitle : ''}`, PADX, y + 6);
  y += 26;

  const divider = () => {
    ctx.strokeStyle = C.panelBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADX, y);
    ctx.lineTo(W - PADX, y);
    ctx.stroke();
    y += 30;
  };

  // ---- Settle Up ----
  if (settlements) {
    divider();
    ctx.fillStyle = C.accent;
    ctx.font = '700 13px monospace';
    ctx.fillText('SETTLE UP · WHO PAYS WHOM', PADX, y + 4);
    y += 22;

    if (!settlements.length) {
      ctx.fillStyle = C.success;
      ctx.font = '600 15px sans-serif';
      ctx.fillText('✅  All settled up — no payments needed.', PADX, y + 20);
      y += 56;
    } else {
      settlements.forEach(s => {
        const rowH = SETTLE_ROW - 12;
        ctx.fillStyle = C.panel;
        roundRect(ctx, PADX, y, W - PADX * 2, rowH, 14);
        ctx.fill();

        const cx = PADX + 20;
        const midY = y + rowH / 2 + 5;
        ctx.font = '700 15px sans-serif';
        ctx.fillStyle = C.danger;
        const fromT = ellipsize(ctx, s.from, 190);
        ctx.fillText(fromT, cx, midY);
        const arrowX = cx + ctx.measureText(fromT).width + 12;
        ctx.fillStyle = C.muted;
        ctx.font = '700 16px sans-serif';
        ctx.fillText('→', arrowX, midY);
        ctx.fillStyle = C.success;
        ctx.font = '700 15px sans-serif';
        ctx.fillText(ellipsize(ctx, s.to, 190), arrowX + 26, midY);
        ctx.fillStyle = C.text;
        ctx.font = '800 17px sans-serif';
        const amtT = formatCurrency(s.amount);
        ctx.fillText(amtT, W - PADX - 20 - ctx.measureText(amtT).width, midY);

        y += SETTLE_ROW;
      });
    }
    y += 2;
  }

  // ---- Expenses ----
  if (items) {
    divider();
    ctx.fillStyle = C.muted;
    ctx.font = '700 13px monospace';
    ctx.fillText((expensesLabel || `Expenses (${items.length})`).toUpperCase(), PADX, y + 4);
    y += 22;

    if (!items.length) {
      ctx.fillStyle = C.muted;
      ctx.font = '600 15px sans-serif';
      ctx.fillText('No expenses added yet.', PADX, y + 20);
      y += 56;
    } else {
      items.forEach(it => {
        const rowH = ITEM_ROW - 12;
        ctx.fillStyle = C.panel;
        roundRect(ctx, PADX, y, W - PADX * 2, rowH, 14);
        ctx.fill();

        const cx = PADX + 20;
        const textMaxW = W - PADX * 2 - 200;
        ctx.fillStyle = C.text;
        ctx.font = '700 16px sans-serif';
        ctx.fillText(ellipsize(ctx, it.description || 'Expense', textMaxW), cx, y + 26);
        ctx.fillStyle = C.muted;
        ctx.font = '500 13px sans-serif';
        ctx.fillText(`Paid by ${it.paidBy}`, cx, y + 46);
        // split among — names only, so it's clear WHO each expense covers without bloating the row
        ctx.fillStyle = C.accent;
        ctx.font = '600 12px sans-serif';
        const splitLabel = `Split (${it.participantNames.length}): ${namesOrEveryone(it.participantNames, everyone)}`;
        ctx.fillText(ellipsize(ctx, splitLabel, W - PADX * 2 - 40), cx, y + 66);
        ctx.fillStyle = C.text;
        ctx.font = '800 18px sans-serif';
        const amtT = formatCurrency(it.amount);
        ctx.fillText(amtT, W - PADX - 20 - ctx.measureText(amtT).width, y + 40);

        y += ITEM_ROW;
      });
    }
  }

  // ---- Footer ----
  y += 18;
  drawFooter(ctx, y);

  return await canvasToBlob(canvas);
}

// Decides single vs. multiple images and returns the rendered PNGs in share order.
export async function buildSplitShareImages(opts: SplitImageOpts): Promise<Blob[]> {
  const { title, subtitle, totalSpent, settlements, items, everyone } = opts;
  const head = { title, subtitle, totalSpent, everyone };

  const fitsSingle = items.length <= SINGLE_MAX_ITEMS && settlements.length <= SINGLE_MAX_SETTLEMENTS;
  if (fitsSingle) {
    return [await renderSplitImage({ ...head, settlements, items, expensesLabel: `Expenses (${items.length})` })];
  }

  // Too long for one image → Settle-Up image first, then paginated Expenses images.
  const blobs: Blob[] = [];
  blobs.push(await renderSplitImage({ ...head, settlements }));

  const pages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  for (let p = 0; p < pages; p++) {
    const chunk = items.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
    const label = pages > 1 ? `Expenses (${p + 1}/${pages})` : `Expenses (${items.length})`;
    blobs.push(await renderSplitImage({ ...head, items: chunk, expensesLabel: label }));
  }
  return blobs;
}
