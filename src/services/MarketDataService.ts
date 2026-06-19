import { fetchVendorCommodityPrices } from './GeminiService';

const CACHE_KEY = 'market_prices_cache';
const HISTORY_CACHE_KEY = 'market_history_cache';
const PREV_CACHE_KEY = 'market_prev_prices_cache';
const STOCK_TTL = 5 * 60 * 1000;
const SIP_TTL = 8 * 60 * 60 * 1000;
const HISTORY_TTL = 24 * 60 * 60 * 1000;
// Commodity prices come from Gemini grounding (an approximate, lagging source). Cache for 1h
// and ALWAYS respect it (no force path) — both auto and manual refreshes serve cache when it's
// fresh, exactly like stocks/MFs. So Gemini is hit at most once per hour across all screens
// (gold + silver share one grounded call) → max ~24 calls/day, regardless of how many times the
// user taps refresh. The daily safety cap (30) is just a backstop against failure loops.
const COMMODITY_TTL = 1 * 60 * 60 * 1000;

interface CacheEntry {
  price: number;
  fetchedAt: number;
}

interface HistoryEntry {
  data: Array<{ date: number; close: number }>;
  fetchedAt: number;
}

type PriceCache = Record<string, CacheEntry>;
type HistoryCache = Record<string, HistoryEntry>;

let mem: PriceCache = (() => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
})();

let historyMem: HistoryCache = (() => {
  try {
    const raw = localStorage.getItem(HISTORY_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
})();

let prevMem: Record<string, number> = (() => {
  try {
    const raw = localStorage.getItem(PREV_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
})();

// Broadcast so any already-mounted screen (e.g. the persistent Accounts tab) can re-read the
// shared cache when prices change — keeps every view in sync with the latest fetch.
function notifyPricesUpdated() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('marketPricesUpdated'));
}

function persist() {
  localStorage.setItem(CACHE_KEY, JSON.stringify(mem));
  notifyPricesUpdated();
}

function persistHistory() {
  localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(historyMem));
}

function persistPrev() {
  localStorage.setItem(PREV_CACHE_KEY, JSON.stringify(prevMem));
}

function fresh(entry: CacheEntry, ttl: number) {
  return Date.now() - entry.fetchedAt < ttl;
}

export async function fetchStockPrice(symbol: string): Promise<number | null> {
  if (mem[symbol] && fresh(mem[symbol], STOCK_TTL)) return mem[symbol].price;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        },
      }
    );
    const json = await res.json();
    const price: unknown = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price === 'number') {
      mem[symbol] = { price, fetchedAt: Date.now() };
      persist();
      const prevClose: unknown = json?.chart?.result?.[0]?.meta?.chartPreviousClose;
      if (typeof prevClose === 'number') { prevMem[symbol] = prevClose; persistPrev(); }
      return price;
    }
    return null;
  } catch { return null; }
}

export async function fetchMFNav(schemeCode: string): Promise<number | null> {
  if (mem[schemeCode] && fresh(mem[schemeCode], SIP_TTL)) return mem[schemeCode].price;
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}/latest`);
    const json = await res.json();
    const nav: unknown = json?.data?.[0]?.nav;
    if (nav !== undefined) {
      const price = parseFloat(String(nav));
      if (!isNaN(price)) {
        mem[schemeCode] = { price, fetchedAt: Date.now() };
        persist();
        return price;
      }
    }
    return null;
  } catch { return null; }
}

export function getCachedPrice(symbol: string): number | null {
  return mem[symbol]?.price ?? null;
}

// When the symbol's price was last actually fetched from the network (epoch ms), or null.
export function getCacheFetchedAt(symbol: string): number | null {
  return mem[symbol]?.fetchedAt ?? null;
}

// The most recent real API fetch time across the given symbols (epoch ms), or null if none cached.
export function getLatestFetchedAt(symbols: string[]): number | null {
  const times = symbols
    .map(s => mem[s]?.fetchedAt)
    .filter((t): t is number => typeof t === 'number');
  return times.length ? Math.max(...times) : null;
}

export function isCacheFresh(symbol: string, kind: 'stock' | 'sip'): boolean {
  const entry = mem[symbol];
  if (!entry) return false;
  return fresh(entry, kind === 'sip' ? SIP_TTL : STOCK_TTL);
}

export async function fetchPricesForSymbols(
  items: Array<{ symbol: string; kind: 'stock' | 'sip' }>
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  await Promise.all(
    items.map(async ({ symbol, kind }) => {
      const price = kind === 'stock' ? await fetchStockPrice(symbol) : await fetchMFNav(symbol);
      if (price !== null) results[symbol] = price;
    })
  );
  return results;
}

type StockRange = '1d' | '5d' | '1mo' | '3mo' | '1y' | '5y';
type HistoryDataPoint = { date: number; close: number };

function getYahooIntervalAndRange(range: StockRange): { interval: string; range: string } {
  const map: Record<StockRange, { interval: string; range: string }> = {
    '1d': { interval: '5m', range: '1d' },
    '5d': { interval: '1h', range: '5d' },
    '1mo': { interval: '1d', range: '1mo' },
    '3mo': { interval: '1d', range: '3mo' },
    '1y': { interval: '1wk', range: '1y' },
    '5y': { interval: '1mo', range: '5y' }
  };
  return map[range];
}

export async function fetchStockHistory(
  symbol: string,
  range: StockRange
): Promise<HistoryDataPoint[]> {
  const cacheKey = `stock_${symbol}_${range}`;
  const cached = historyMem[cacheKey];

  if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL) {
    return cached.data;
  }

  try {
    const { interval, range: yahooRange } = getYahooIntervalAndRange(range);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${yahooRange}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        },
      }
    );
    const json = await res.json();
    const timestamps = json?.chart?.result?.[0]?.timestamp || [];
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];

    if (!Array.isArray(timestamps) || !Array.isArray(closes)) {
      return [];
    }

    const data = timestamps
      .map((ts: number, idx: number) => ({
        date: ts * 1000,
        close: closes[idx]
      }))
      .filter((d: HistoryDataPoint) => typeof d.close === 'number');

    historyMem[cacheKey] = { data, fetchedAt: Date.now() };
    persistHistory();
    return data;
  } catch {
    return [];
  }
}

export async function fetchMFNavHistory(
  schemeCode: string
): Promise<HistoryDataPoint[]> {
  const cacheKey = `mf_${schemeCode}`;
  const cached = historyMem[cacheKey];

  if (cached && Date.now() - cached.fetchedAt < SIP_TTL) {
    return cached.data;
  }

  try {
    const res = await fetch(
      `https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`
    );
    const json = await res.json();
    const navArray = json?.data || [];

    if (!Array.isArray(navArray)) {
      return [];
    }

    const data = navArray
      .map((entry: any) => {
        const dateStr = entry.date || '';
        const navStr = entry.nav || '';
        const nav = parseFloat(navStr);
        if (!dateStr || isNaN(nav)) return null;

        const [day, month, year] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day).getTime();

        return { date, close: nav };
      })
      .filter((d: HistoryDataPoint | null): d is HistoryDataPoint => d !== null)
      .reverse();

    historyMem[cacheKey] = { data, fetchedAt: Date.now() };
    persistHistory();
    return data;
  } catch {
    return [];
  }
}

export interface MFSearchResult {
  schemeName: string;
  schemeCode: string;
}

export interface StockSearchResult {
  name: string;
  symbol: string;
  exchange: string;
}

export async function searchMFByName(query: string): Promise<MFSearchResult[]> {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`);
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return json.slice(0, 6).map((item: any) => ({
      schemeName: String(item.schemeName || ''),
      schemeCode: String(item.schemeCode || ''),
    }));
  } catch { return []; }
}

export async function searchStockByName(query: string): Promise<StockSearchResult[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        },
      }
    );
    const json = await res.json();
    const quotes: any[] = json?.quotes || json?.finance?.result?.[0]?.quotes || [];
    return quotes
      .filter((q: any) => q.quoteType === 'EQUITY' && q.symbol)
      .slice(0, 6)
      .map((q: any) => ({
        name: q.longname || q.shortname || q.symbol,
        symbol: String(q.symbol),
        exchange: String(q.exchange || ''),
      }));
  } catch { return []; }
}

// ---- Commodity prices: Gemini grounding (approximate, BYOK) ----
// The exact vendor price (MMTC-PAMP) is behind Akamai/JS and has no usable free feed, so we
// use Gemini + Google Search grounding as an APPROXIMATE auto-fill (see GeminiService). It's
// labelled as an estimate in the UI, with a manual override for exactness. If Gemini yields
// nothing, we serve the last cached value (even if stale) rather than a wrong/zero price.

function metalFromTicker(metalTicker: string): 'gold' | 'silver' | null {
  const t = metalTicker.toUpperCase();
  if (t.startsWith('GC') || t.includes('GOLD')) return 'gold';
  if (t.startsWith('SI') || t.includes('SILVER')) return 'silver';
  return null;
}

// One in-flight Gemini request shared across callers, so fetching gold + silver together
// (as the Accounts/Portfolio views do) costs a SINGLE grounded call, not two.
let commodityInFlight: Promise<{ gold: number | null; silver: number | null }> | null = null;

function fetchBothMetals(): Promise<{ gold: number | null; silver: number | null }> {
  if (!commodityInFlight) {
    commodityInFlight = fetchVendorCommodityPrices()
      .catch(() => ({ gold: null, silver: null }))
      .finally(() => { commodityInFlight = null; });
  }
  return commodityInFlight;
}

// Always respects the 1h cache (no force flag) so repeated manual refreshes can't burn the
// Gemini quota — a fetch only happens when the cached value is older than COMMODITY_TTL.
export async function fetchCommodityPriceINR(metalTicker: string): Promise<number | null> {
  const cacheKey = `cINR_${metalTicker}`;
  if (mem[cacheKey] && fresh(mem[cacheKey], COMMODITY_TTL)) return mem[cacheKey].price;

  const metal = metalFromTicker(metalTicker);
  if (!metal) return mem[cacheKey]?.price ?? null;

  // One grounded call returns both metals; cache both so the sibling commodity account is
  // served from the same request.
  const all = await fetchBothMetals();
  const now = Date.now();
  if (all.gold !== null) mem['cINR_GC=F'] = { price: all.gold, fetchedAt: now };
  if (all.silver !== null) mem['cINR_SI=F'] = { price: all.silver, fetchedAt: now };
  if (all.gold !== null || all.silver !== null) persist();

  // Fresh value if we got one, else fall back to the last cached value (even if stale).
  return all[metal] ?? mem[cacheKey]?.price ?? null;
}

export function getCachedCommodityPriceINR(metalTicker: string): number | null {
  const cacheKey = `cINR_${metalTicker}`;
  return mem[cacheKey]?.price ?? null;
}

// Whether the cached commodity estimate is still within the 1h window. Used to gate the manual
// refresh button (same freshness-gated pattern as stocks/MFs) so we don't spend Gemini calls
// that can't return anything newer.
export function isCommodityCacheFresh(metalTicker: string): boolean {
  const entry = mem[`cINR_${metalTicker}`];
  if (!entry) return false;
  return fresh(entry, COMMODITY_TTL);
}

// The most recent real Gemini fetch time across the given commodity tickers (epoch ms), or null.
// Commodity prices live under a `cINR_` cache key, so they need their own lookup — used so
// "Last refresh at" reflects a commodity-only refresh too, not just stock/MF fetches.
export function getLatestCommodityFetchedAt(metalTickers: string[]): number | null {
  const times = metalTickers
    .map(t => mem[`cINR_${t}`]?.fetchedAt)
    .filter((t): t is number => typeof t === 'number');
  return times.length ? Math.max(...times) : null;
}

export function getCachedPrevPrice(symbol: string): number | null {
  return prevMem[symbol] ?? null;
}

export function getCachedPrevCommodityPriceINR(_metalTicker: string): number | null {
  // No previous-day data for the Gemini commodity source.
  return null;
}

export async function fetchMFPrevNav(schemeCode: string): Promise<number | null> {
  const history = await fetchMFNavHistory(schemeCode);
  if (history.length < 2) return null;
  const prev = history[history.length - 2].close;
  prevMem[schemeCode] = prev;
  persistPrev();
  return prev;
}

export async function fetchPrevClosesForSymbols(
  items: Array<{ symbol: string; kind: 'stock' | 'sip' }>
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  await Promise.all(
    items.map(async ({ symbol, kind }) => {
      if (kind === 'stock') {
        if (prevMem[symbol] !== undefined) { results[symbol] = prevMem[symbol]; return; }
        await fetchStockPrice(symbol);
        if (prevMem[symbol] !== undefined) results[symbol] = prevMem[symbol];
      } else {
        const prev = await fetchMFPrevNav(symbol);
        if (prev !== null) results[symbol] = prev;
      }
    })
  );
  return results;
}

export function sliceHistoryByRange(
  data: HistoryDataPoint[],
  range: 'all' | '1y' | '6m' | '1m' | '1w' | '1d'
): HistoryDataPoint[] {
  if (range === 'all' || data.length === 0) return data;

  const now = Date.now();
  const rangeMs: Record<string, number> = {
    '1d': 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
    '1m': 30 * 24 * 60 * 60 * 1000,
    '6m': 180 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000,
    'all': Infinity
  };

  const cutoff = now - rangeMs[range];
  return data.filter(d => d.date >= cutoff);
}
