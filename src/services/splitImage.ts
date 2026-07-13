import { formatCurrency } from '../utils';

// Renders shareable "split summary" PNGs entirely on a <canvas>, so it works offline in the
// Android/iOS WebView with no extra dependency. Small splits fit in one combined image; large
// splits are broken into a Settle-Up image + one or more (paginated) Expenses images so no single
// image gets impractically tall. Returns an array of PNG Blobs.

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
}

// Layout thresholds — the "single vs. multiple" decision.
const SINGLE_MAX_ITEMS = 8;      // more expenses than this → split into separate images
const SINGLE_MAX_SETTLEMENTS = 6; // more settlements than this → split too
const ITEMS_PER_PAGE = 10;        // expenses per Expenses image once split

// Palette (mirrors the app's dark theme).
const C = {
  bg: '#0f1115',
  panel: '#1a1d24',
  panelBorder: 'rgba(255,255,255,0.06)',
  text: '#f5f6f8',
  muted: '#8b8f9a',
  accent: '#6366f1',
  success: '#34d399',
  danger: '#f87171',
};

const W = 720;
const PADX = 44;
const SETTLE_ROW = 62; // settle row card height + gap
const ITEM_ROW = 96;   // three-line expense row card height + gap

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const ellipsize = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
};

interface RenderInput {
  title: string;
  subtitle?: string;
  totalSpent: number;
  settlements?: SplitImageRow[];  // present → draw the Settle-Up section
  items?: SplitImageItem[];       // present → draw the Expenses section
  expensesLabel?: string;         // header text for the Expenses section (e.g. "Expenses (1/3)")
}

async function renderSplitImage(input: RenderInput): Promise<Blob> {
  const { title, subtitle, totalSpent, settlements, items, expensesLabel } = input;

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

  const scale = Math.min(3, Math.max(2, Math.floor(window.devicePixelRatio || 2)));
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

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
        const splitLabel = `Split (${it.participantNames.length}): ` + it.participantNames.join(', ');
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
  ctx.textAlign = 'center';
  ctx.fillStyle = C.muted;
  ctx.font = '600 13px monospace';
  ctx.fillText('Generated via SpendVault', W / 2, y + 12);
  ctx.textAlign = 'left';

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

// Decides single vs. multiple images and returns the rendered PNGs in share order.
export async function buildSplitShareImages(opts: SplitImageOpts): Promise<Blob[]> {
  const { title, subtitle, totalSpent, settlements, items } = opts;
  const head = { title, subtitle, totalSpent };

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

export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      // strip the "data:image/png;base64," prefix — Filesystem wants raw base64
      resolve(res.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
