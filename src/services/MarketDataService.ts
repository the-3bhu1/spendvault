const CACHE_KEY = 'market_prices_cache';
const HISTORY_CACHE_KEY = 'market_history_cache';
const STOCK_TTL = 5 * 60 * 1000;
const SIP_TTL = 8 * 60 * 60 * 1000;
const HISTORY_TTL = 24 * 60 * 60 * 1000;

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

function persist() {
  localStorage.setItem(CACHE_KEY, JSON.stringify(mem));
}

function persistHistory() {
  localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(historyMem));
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
