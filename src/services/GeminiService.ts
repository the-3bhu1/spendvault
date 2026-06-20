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
// Hard ceiling on grounded calls/day so we never burn the user's free quota (Gemini 2.5 Flash
// grounding is ~1500/day free; this sits far below). Only SUCCESSFUL calls count — transport
// failures, exhausted 503 retries, and the cap-reached path cost nothing, so a transient mobile
// failure can neither drain the budget nor get permanently cached as a "not found".
// The 1h price cache (COMMODITY_TTL) is the normal throttle; this is the backstop. Tunable.
const GEMINI_DAILY_CAP = 50;
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

// Resolves the official primary website domain for a company / mutual-fund house, for logo
// lookup. Uses Google Search grounding. Returns a bare hostname (e.g. "olaelectric.com"), or null
// ONLY when the model genuinely finds nothing (a result worth caching). THROWS on any transient
// failure (no key / cap reached / transport error / no usable API response) so the caller can
// leave it uncached and retry on a later cold start. Only a successful call counts against the cap.
function sanitizeDomain(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let d = v.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].trim();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

export async function resolveBrandDomain(query: string): Promise<string | null> {
  const key = await getGeminiKey();
  if (!key) throw new Error('gemini: no key'); // transient (caller already guards on hasGeminiKey) — never cache a no-key state
  if (readUsage().count >= GEMINI_DAILY_CAP) {
    console.warn('Gemini: daily safety cap reached; skipping logo domain lookup until tomorrow.');
    throw new Error('gemini: daily cap reached'); // cap resets next day → retry then, don't cache as "not found"
  }

  const model = getGeminiModel();
  const prompt =
`Using Google Search, find the official primary website domain of this Indian-listed company or mutual fund house: "${query}".
Respond with ONLY this strict minified JSON and NOTHING else — no prose, no markdown:
{"domain":"<bare hostname>"}
Rules: bare registrable hostname only (e.g. "olaelectric.com", "tcs.com") — no "https://", no "www.", no path. Use the company's main corporate site, not a stock-exchange or aggregator page. If you cannot confidently identify it, use an empty string.`;

  const body = { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] };
  let j: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
    } catch {
      throw new Error('gemini: domain fetch failed'); // transport failure (incl. native HTTP) — don't cache, retry next session
    }
    j = await res.json().catch(() => null);
    if (j?.error && (j.error.code === 503 || j.error.status === 'UNAVAILABLE')) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    break;
  }

  // No usable response (transport hiccup, exhausted 503 retries, or an API error like 400/403):
  // transient — throw so the caller leaves it uncached and the next cold start retries.
  if (!j || j.error) throw new Error('gemini: no usable domain response');

  // A real response came back → count it against the daily budget (failed attempts above cost nothing).
  bumpUsage();

  const txt: string = (j?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text || '').join('');
  const match = txt.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(match ? match[0] : txt);
    return sanitizeDomain(parsed.domain); // hostname, or null when the model genuinely found nothing → cached so we don't re-ask
  } catch {
    return null; // got a response but no parseable domain → treat as a genuine "not found"
  }
}

// vendorFound: whether the model found the NAMED vendor's own published prices (true) or fell back
// to a generic market estimate because it couldn't identify the vendor (false). Lets the UI warn
// when a typo/fake vendor silently degrades to a generic price. It's false on every no-result path
// (no key / cap / transport failure) too, but those don't overwrite a cached price so it's moot.
export interface VendorPrices { gold: number | null; silver: number | null; vendorFound: boolean }

export async function fetchVendorCommodityPrices(): Promise<VendorPrices> {
  const key = await getGeminiKey();
  if (!key) return { gold: null, silver: null, vendorFound: false };

  // Safety net: never exceed the daily cap, even in a failure/retry loop. Caller falls
  // back to the last cached value or the manual override.
  if (readUsage().count >= GEMINI_DAILY_CAP) {
    console.warn('Gemini: daily safety cap reached; using cached/manual price until tomorrow.');
    return { gold: null, silver: null, vendorFound: false };
  }

  const vendor = getCommodityVendor();
  const model = getGeminiModel();
  const prompt =
`Using Google Search, get ${vendor}'s CURRENT live BUY prices per GRAM in INR (INCLUDING ~3% GST), as shown for Digital Gold and Digital Silver on https://www.mmtcpamp.com/digital-gold.
Prefer ${vendor}'s own published "Live Buy Price" figures. If a metal's exact GST-inclusive figure isn't found, return your best grounded estimate of that metal's current Indian digital-${''}metal per-gram price including ~3% GST.
Respond with ONLY this strict minified JSON and NOTHING else — no prose, no markdown:
{"gold_inr_per_gram":<number>,"silver_inr_per_gram":<number>,"vendor_found":<true|false>}
Numbers only (no commas or symbols), per GRAM (if a source quotes per 10g, divide by 10). Both values MUST be > 0.
Set "vendor_found" to true ONLY if you actually found ${vendor}'s own published prices; set it to false if you could not identify that vendor and returned a generic Indian market estimate instead.`;

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
      return { gold: null, silver: null, vendorFound: false };
    }
    // Retry transient overload (503/UNAVAILABLE) with backoff.
    if (j?.error && (j.error.code === 503 || j.error.status === 'UNAVAILABLE')) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    break;
  }

  // No usable response (transport hiccup, exhausted 503 retries, or an API error): fall back to the
  // cached/manual price without counting it — only a real response costs a daily-cap slot.
  if (!j || j.error) return { gold: null, silver: null, vendorFound: false };
  bumpUsage();

  const txt: string = (j?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text || '').join('');
  const match = txt.match(/\{[\s\S]*\}/);
  let parsed: any = {};
  try { parsed = JSON.parse(match ? match[0] : txt); } catch { /* leave empty */ }

  return {
    gold: sane(parsed.gold_inr_per_gram, 'gold'),
    silver: sane(parsed.silver_inr_per_gram, 'silver'),
    vendorFound: parsed.vendor_found === true,
  };
}
