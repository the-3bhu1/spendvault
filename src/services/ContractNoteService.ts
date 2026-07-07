// Parses a broker contract-note screenshot/PDF (Groww-style: pooled brokerage/STT/GST/stamp-duty
// across a multi-stock settlement, not broken out per stock) via Gemini's multimodal input, then
// deterministically allocates the pooled charges to each stock. The allocation math is plain TS,
// NOT trusted to the model — auditable, and doesn't depend on Gemini being good at arithmetic.
//
// Reuses the shared Gemini key/model (GeminiConfig.ts) and the same 503-retry/backoff pattern and
// defensive JSON-extraction already proven in GeminiService.ts's classifySmsIsTransaction — even
// with responseSchema set, the model can still truncate on MAX_TOKENS or emit near-JSON.

import { getGeminiKey, getGeminiModel } from './GeminiConfig';

export interface ParsedTradeRow {
  name: string;
  isin?: string;
  side: 'buy' | 'sell';
  quantity: number;
  buyValueBeforeCharges: number;
  brokerage?: number; // present only if the note itemizes brokerage per row
}

export interface ParsedContractNote {
  rows: ParsedTradeRow[];
  brokerage: number;      // pooled total (0 if fully itemized per row)
  exchangeCharges: number;
  gst: number;
  stt: number;
  stampDuty: number;
  sebiFees: number;
  ipft: number;
  other: number;
  netAmount: number;      // printed "Net Amount Payable" — used for reconciliation
}

export interface AllocatedTrade {
  key: string;            // stable grouping key (isin || name)
  name: string;
  isin?: string;
  quantity: number;
  investedAmount: number; // sum of buyValueBeforeCharges across this stock's rows
  brokerageTaxes: number; // allocated brokerage + allocated share of pooled other charges
}

export interface AllocationResult {
  trades: AllocatedTrade[];
  skippedSellRows: number;
  reconciliationWarning?: string;
}

const TIMEOUT_MS = 40000; // multimodal + schema-constrained generation is slower than a short chat reply

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          isin: { type: 'string' },
          side: { type: 'string', enum: ['buy', 'sell'] },
          quantity: { type: 'number' },
          buyValueBeforeCharges: { type: 'number' },
          brokerage: { type: 'number' },
        },
        required: ['name', 'side', 'quantity', 'buyValueBeforeCharges'],
      },
    },
    brokerage: { type: 'number' },
    exchangeCharges: { type: 'number' },
    gst: { type: 'number' },
    stt: { type: 'number' },
    stampDuty: { type: 'number' },
    sebiFees: { type: 'number' },
    ipft: { type: 'number' },
    other: { type: 'number' },
    netAmount: { type: 'number' },
  },
  required: ['rows', 'brokerage', 'exchangeCharges', 'gst', 'stt', 'stampDuty', 'netAmount'],
};

const PROMPT = `You are reading a stock broker's contract note / trade confirmation (India — NSE/BSE, e.g. Groww/Zerodha style).

Extract EVERY trade row exactly as printed — buys AND sells, do not skip or merge rows. If the same stock appears in more than one row (multiple orders), keep them as SEPARATE rows; do not pre-sum.

For each row report:
- name: the security/company name as printed
- isin: the ISIN code if visible, otherwise omit
- side: "buy" or "sell"
- quantity: number of shares in that row
- buyValueBeforeCharges: that row's gross trade value BEFORE brokerage/taxes. Compute it as quantity × the PRE-brokerage per-share price — the plain rate column (often "WAP per Share" or "Rate/Price"), NOT the "WAP per Share after brokerage" column and NOT the "Total Value after brokerage" / net-payable figure. Read the digits carefully and double-check quantity × price matches.
- brokerage: ONLY if this note itemizes brokerage per row (some brokers do, some pool it into a single footer total). Omit this field entirely if brokerage is only shown as a single pooled total for the whole note.

Also report these note-level POOLED totals (each as a plain non-negative number, 0 if not present/not applicable):
- brokerage: the single pooled brokerage total for the whole note, if NOT itemized per row above. If you filled in a per-row "brokerage" for every row, set this pooled total to 0.
- exchangeCharges: exchange transaction charges
- gst: total GST (CGST + SGST + IGST combined)
- stt: Securities Transaction Tax
- stampDuty: stamp duty
- sebiFees: SEBI turnover fees
- ipft: IPFT charges
- other: any other charge line not covered above (UTT, clearing fees, etc.) — sum them into this one field
- netAmount: the printed final "Net Amount Receivable/Payable by Client" (as a positive number, ignore the sign)

Respond with ONLY strict minified JSON matching the given schema — no prose, no markdown, no explanation.`;

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : text);
}

export async function parseContractNote(imageBase64: string, mimeType: string): Promise<ParsedContractNote> {
  const key = await getGeminiKey();
  if (!key) throw new Error('gemini: no key');

  const model = getGeminiModel();
  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType, data: imageBase64 } },
        { text: PROMPT },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let j: any = null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );
      } catch {
        throw new Error('gemini: contract note request failed');
      }
      j = await res.json().catch(() => null);
      if (j?.error && (j.error.code === 503 || j.error.status === 'UNAVAILABLE')) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      break;
    }
  } finally {
    clearTimeout(timer);
  }

  if (!j || j.error) throw new Error('gemini: no usable contract note response');

  const txt: string = (j?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text || '').join('').trim();
  if (!txt) throw new Error('gemini: empty contract note response');

  let parsed: any;
  try {
    parsed = extractJson(txt);
  } catch {
    // Surface the raw text so the caller can show it to the user rather than fail silently.
    const err: any = new Error('gemini: unparseable contract note response');
    err.rawText = txt;
    throw err;
  }

  const rows: ParsedTradeRow[] = Array.isArray(parsed.rows) ? parsed.rows.map((r: any) => ({
    name: String(r.name || 'Unknown'),
    isin: r.isin ? String(r.isin) : undefined,
    side: r.side === 'sell' ? 'sell' : 'buy',
    quantity: Number(r.quantity) || 0,
    buyValueBeforeCharges: Number(r.buyValueBeforeCharges) || 0,
    brokerage: r.brokerage !== undefined && r.brokerage !== null ? Number(r.brokerage) : undefined,
  })) : [];

  return {
    rows,
    brokerage: Number(parsed.brokerage) || 0,
    exchangeCharges: Number(parsed.exchangeCharges) || 0,
    gst: Number(parsed.gst) || 0,
    stt: Number(parsed.stt) || 0,
    stampDuty: Number(parsed.stampDuty) || 0,
    sebiFees: Number(parsed.sebiFees) || 0,
    ipft: Number(parsed.ipft) || 0,
    other: Number(parsed.other) || 0,
    netAmount: Number(parsed.netAmount) || 0,
  };
}

// Largest-remainder rounding: distributes a total across weighted shares to exactly 2 decimals,
// so per-stock amounts always sum to the pooled total to the paisa instead of drifting from
// independent per-row rounding.
function allocateProportionally(total: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) {
    // No basis to weight by (e.g. all-zero values) — split evenly as a fallback.
    const even = Math.round((total / Math.max(1, weights.length)) * 100);
    const base = weights.map(() => even);
    return reconcileToCents(base, Math.round(total * 100)).map(c => c / 100);
  }
  const totalCents = Math.round(total * 100);
  const rawCents = weights.map(w => (w / totalWeight) * totalCents);
  const floorCents = rawCents.map(Math.floor);
  return reconcileToCents(floorCents, totalCents, rawCents).map(c => c / 100);
}

function reconcileToCents(floorCents: number[], totalCents: number, rawCents?: number[]): number[] {
  const result = [...floorCents];
  let remainder = totalCents - result.reduce((s, c) => s + c, 0);
  if (remainder === 0) return result;
  // Distribute the leftover paise to the rows with the largest fractional remainder first
  // (largest-remainder method), or in array order if no fractional info is available.
  const order = rawCents
    ? rawCents.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac).map(o => o.i)
    : result.map((_, i) => i);
  for (let k = 0; remainder !== 0 && k < order.length; k++) {
    const i = order[k % order.length];
    const step = remainder > 0 ? 1 : -1;
    result[i] += step;
    remainder -= step;
  }
  return result;
}

export function allocateCharges(parsed: ParsedContractNote): AllocationResult {
  const buyRows = parsed.rows.filter(r => r.side === 'buy');
  const skippedSellRows = parsed.rows.length - buyRows.length;

  if (buyRows.length === 0) {
    return { trades: [], skippedSellRows };
  }

  // Brokerage per row: prefer the printed per-row figure; only flat-split the pooled total
  // across rows that don't have one (covers notes that itemize some rows but pool others,
  // e.g. a mixed per-leg fee schedule — rare, but cheap to handle correctly).
  const rowsMissingBrokerage = buyRows.filter(r => r.brokerage === undefined);
  const perRowFlatBrokerage = rowsMissingBrokerage.length > 0
    ? parsed.brokerage / rowsMissingBrokerage.length
    : 0;
  const rowBrokerage = buyRows.map(r => r.brokerage !== undefined ? r.brokerage : perRowFlatBrokerage);

  // All other pooled charges split proportional to each row's pre-brokerage trade value.
  const otherChargesTotal = parsed.exchangeCharges + parsed.gst + parsed.stt + parsed.stampDuty
    + parsed.sebiFees + parsed.ipft + parsed.other;
  const rowOtherCharges = allocateProportionally(
    otherChargesTotal,
    buyRows.map(r => r.buyValueBeforeCharges)
  );

  // Group allocated rows by stock (ISIN preferred, else normalized name) — a stock bought
  // across multiple rows/orders must sum its allocated shares, not just take one row's.
  const groups = new Map<string, AllocatedTrade>();
  buyRows.forEach((row, i) => {
    const key = row.isin || row.name.trim().toLowerCase();
    const existing = groups.get(key);
    const brokerage = rowBrokerage[i];
    const otherCharges = rowOtherCharges[i];
    if (existing) {
      existing.quantity += row.quantity;
      existing.investedAmount += row.buyValueBeforeCharges;
      existing.brokerageTaxes = parseFloat((existing.brokerageTaxes + brokerage + otherCharges).toFixed(2));
    } else {
      groups.set(key, {
        key,
        name: row.name,
        isin: row.isin,
        quantity: row.quantity,
        investedAmount: row.buyValueBeforeCharges,
        brokerageTaxes: parseFloat((brokerage + otherCharges).toFixed(2)),
      });
    }
  });

  const trades = Array.from(groups.values());

  let reconciliationWarning: string | undefined;
  if (parsed.netAmount > 0) {
    const computedTotal = trades.reduce((s, t) => s + t.investedAmount + t.brokerageTaxes, 0);
    if (Math.abs(computedTotal - parsed.netAmount) > 1) {
      reconciliationWarning = `Computed total ₹${computedTotal.toFixed(2)} doesn't match the note's printed net amount ₹${parsed.netAmount.toFixed(2)} — please check the figures below before logging.`;
    }
  }

  return { trades, skippedSellRows, reconciliationWarning };
}
