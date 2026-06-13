const CACHE_KEY = 'market_prices_cache';
const STOCK_TTL = 5 * 60 * 1000;
const SIP_TTL = 8 * 60 * 60 * 1000;

interface CacheEntry {
  price: number;
  fetchedAt: number;
}

type PriceCache = Record<string, CacheEntry>;

let mem: PriceCache = (() => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
})();

function persist() {
  localStorage.setItem(CACHE_KEY, JSON.stringify(mem));
}

function fresh(entry: CacheEntry, ttl: number) {
  return Date.now() - entry.fetchedAt < ttl;
}

export async function fetchStockPrice(symbol: string): Promise<number | null> {
  if (mem[symbol] && fresh(mem[symbol], STOCK_TTL)) return mem[symbol].price;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: { Accept: 'application/json' } }
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
