// The bits every shareable PNG in the app is built out of. Rendered on a <canvas> rather than by
// rasterising DOM, so it works offline in the Android/iOS WebView with no extra dependency.
//
// Extracted when the debt history got a share button of its own: two renderers each carrying their
// own copy of this palette is how the two drift into looking like different apps.

// Palette (mirrors the app's dark theme).
export const C = {
  bg: '#0f1115',
  panel: '#1a1d24',
  panelBorder: 'rgba(255,255,255,0.06)',
  text: '#f5f6f8',
  muted: '#8b8f9a',
  accent: '#6366f1',
  success: '#34d399',
  danger: '#f87171',
};

/** Image width, and the gutter every section is inset by. */
export const W = 720;
export const PADX = 44;

export const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

export const ellipsize = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
};

/** A canvas of `h` logical pixels, already scaled for the device and painted with the background. */
export const newCanvas = (h: number) => {
  const scale = Math.min(3, Math.max(2, Math.floor(window.devicePixelRatio || 2)));
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, h);
  return { canvas, ctx };
};

export const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });

/** The line every share image signs off with. */
export const drawFooter = (ctx: CanvasRenderingContext2D, y: number) => {
  ctx.textAlign = 'center';
  ctx.fillStyle = C.muted;
  ctx.font = '600 13px monospace';
  ctx.fillText('Generated via SpendVault', W / 2, y + 12);
  ctx.textAlign = 'left';
};

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
