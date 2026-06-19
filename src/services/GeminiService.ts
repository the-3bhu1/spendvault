import { getGeminiKey, getCommodityVendor, getGeminiModel } from './GeminiConfig';

// Fetches the vendor's current per-gram BUY price (incl. GST) for gold & silver using
// Gemini + Google Search grounding. This is an APPROXIMATE source: grounding reads
// Google's index (a lagging snapshot), so values can be ~1-2% off and a bit stale — the
// UI labels them as estimates and offers a manual override. Returns nulls on any failure.

// INR-per-gram sanity rails — reject hallucinated / wrong-unit values (e.g. a per-10g
// figure) so a bad number never reaches the portfolio. Wide, to allow for price rallies.
const BAND: Record<'gold' | 'silver', { min: number; max: number }> = {
  gold: { min: 3000, max: 60000 },
  silver: { min: 25, max: 800 },
};

function sane(v: unknown, metal: 'gold' | 'silver'): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,₹\s]/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  return n >= BAND[metal].min && n <= BAND[metal].max ? n : null;
}

// ---- Daily safety cap ----
// Hard ceiling on grounded calls/day so a failure loop or retry-spam can never burn the
// user's free quota (Gemini 2.5 Flash grounding is ~1500/day free; this sits far below).
// The 1h price cache (COMMODITY_TTL) is the normal throttle; this is the backstop. Tunable.
const GEMINI_DAILY_CAP = 30;
const GEMINI_USAGE_KEY = 'gemini_usage'; // { day: 'YYYY-MM-DD', count: number }

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readUsage(): { day: string; count: number } {
  const day = todayKey();
  try {
    const p = JSON.parse(localStorage.getItem(GEMINI_USAGE_KEY) || 'null');
    if (p && p.day === day) return p;
  } catch { /* ignore */ }
  return { day, count: 0 }; // new day resets the counter
}

function bumpUsage(): void {
  const u = readUsage();
  localStorage.setItem(GEMINI_USAGE_KEY, JSON.stringify({ day: u.day, count: u.count + 1 }));
}

// How many grounded fetches have been spent today, and the cap we enforce.
export function getGeminiUsageToday(): { count: number; cap: number } {
  return { count: readUsage().count, cap: GEMINI_DAILY_CAP };
}

export interface VendorPrices { gold: number | null; silver: number | null }

export async function fetchVendorCommodityPrices(): Promise<VendorPrices> {
  const key = await getGeminiKey();
  if (!key) return { gold: null, silver: null };

  // Safety net: never exceed the daily cap, even in a failure/retry loop. Caller falls
  // back to the last cached value or the manual override.
  if (readUsage().count >= GEMINI_DAILY_CAP) {
    console.warn('Gemini: daily safety cap reached; using cached/manual price until tomorrow.');
    return { gold: null, silver: null };
  }
  bumpUsage(); // count this fetch operation up-front (conservative)

  const vendor = getCommodityVendor();
  const model = getGeminiModel();
  const prompt =
`Using Google Search, get ${vendor}'s CURRENT live BUY prices per GRAM in INR (INCLUDING ~3% GST), as shown for Digital Gold and Digital Silver on https://www.mmtcpamp.com/digital-gold.
Prefer ${vendor}'s own published "Live Buy Price" figures. If a metal's exact GST-inclusive figure isn't found, return your best grounded estimate of that metal's current Indian digital-${''}metal per-gram price including ~3% GST.
Respond with ONLY this strict minified JSON and NOTHING else — no prose, no markdown:
{"gold_inr_per_gram":<number>,"silver_inr_per_gram":<number>}
Numbers only (no commas or symbols), per GRAM (if a source quotes per 10g, divide by 10). Both values MUST be > 0.`;

  const body = { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] };
  let j: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      j = await res.json();
    } catch {
      return { gold: null, silver: null };
    }
    // Retry transient overload (503/UNAVAILABLE) with backoff.
    if (j?.error && (j.error.code === 503 || j.error.status === 'UNAVAILABLE')) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    break;
  }

  const txt: string = (j?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text || '').join('');
  const match = txt.match(/\{[\s\S]*\}/);
  let parsed: any = {};
  try { parsed = JSON.parse(match ? match[0] : txt); } catch { /* leave empty */ }

  return {
    gold: sane(parsed.gold_inr_per_gram, 'gold'),
    silver: sane(parsed.silver_inr_per_gram, 'silver'),
  };
}
