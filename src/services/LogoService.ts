// Resolves real brand logos for investment holdings (mutual funds → AMC/fund-house logo,
// stocks → company logo) from a built-in domain registry. Resolution is pure and synchronous:
// a holding's name/ticker maps to a brand domain, and the domain maps to a logo URL.
//
// Image source is layered:
//   - If a logo.dev publishable token is configured → high-quality logos (img.logo.dev).
//   - Otherwise → Google's no-key favicon service (lower-res, but real brand marks).
// Either way, callers render the URL in an <img> that falls back to a colored-initials avatar
// on error (see LogoAvatar), so a wrong/missing domain degrades gracefully.

import { resolveBrandDomain } from './GeminiService';
import { hasGeminiKey } from './GeminiConfig';

const LOGO_DEV_TOKEN_KEY = 'logo_dev_token';

export function getLogoDevToken(): string {
  try { return localStorage.getItem(LOGO_DEV_TOKEN_KEY)?.trim() || ''; } catch { return ''; }
}

export function setLogoDevToken(token: string): void {
  try {
    const t = token.trim();
    if (t) localStorage.setItem(LOGO_DEV_TOKEN_KEY, t);
    else localStorage.removeItem(LOGO_DEV_TOKEN_KEY);
  } catch { /* ignore */ }
}

export function hasLogoDevToken(): boolean {
  return getLogoDevToken().length > 0;
}

// --- AMC (mutual fund house) registry -------------------------------------------------
// `match` is checked against the lowercased holding name; the entry with the LONGEST matched
// keyword wins, so "quantum" beats "quant" and "aditya birla" isn't shadowed by a shorter token.
type BrandEntry = { match: string[]; domain: string };

const AMC_REGISTRY: BrandEntry[] = [
  { match: ['sbi'], domain: 'sbimf.com' },
  { match: ['hdfc'], domain: 'hdfcfund.com' },
  { match: ['icici prudential', 'icici pru', 'icici'], domain: 'icicipruamc.com' },
  { match: ['nippon india', 'nippon'], domain: 'nipponindiamf.com' },
  { match: ['axis'], domain: 'axismf.com' },
  { match: ['kotak'], domain: 'kotakmf.com' },
  { match: ['aditya birla', 'birla sun life', 'absl'], domain: 'adityabirlacapital.com' },
  { match: ['uti'], domain: 'utimf.com' },
  { match: ['mirae asset', 'mirae'], domain: 'miraeassetmf.co.in' },
  { match: ['dsp'], domain: 'dspim.com' },
  { match: ['tata'], domain: 'tatamutualfund.com' },
  { match: ['franklin templeton', 'franklin'], domain: 'franklintempletonindia.com' },
  { match: ['edelweiss'], domain: 'edelweissmf.com' },
  { match: ['motilal oswal', 'motilal'], domain: 'motilaloswalmf.com' },
  { match: ['quantum'], domain: 'quantumamc.com' },
  { match: ['quant'], domain: 'quantmutual.com' },
  { match: ['parag parikh', 'ppfas'], domain: 'ppfas.com' },
  { match: ['canara robeco', 'canara'], domain: 'canararobeco.com' },
  { match: ['invesco'], domain: 'invescomutualfund.com' },
  { match: ['bandhan', 'idfc'], domain: 'bandhanmutual.com' },
  { match: ['sundaram'], domain: 'sundarammutual.com' },
  { match: ['lic'], domain: 'licmf.com' },
  { match: ['baroda bnp paribas', 'baroda', 'bnp paribas'], domain: 'barodabnpparibasmf.in' },
  { match: ['hsbc'], domain: 'assetmanagement.hsbc.co.in' },
  { match: ['navi'], domain: 'navimutualfund.com' },
  { match: ['mahindra manulife', 'mahindra'], domain: 'mahindramanulife.com' },
  { match: ['iti'], domain: 'itimf.com' },
  { match: ['jm financial', 'jm '], domain: 'jmfinancialmf.com' },
  { match: ['pgim india', 'pgim'], domain: 'pgimindiamf.com' },
  { match: ['union'], domain: 'unionmf.com' },
  { match: ['trustmf', 'trust mutual', 'trust '], domain: 'trustmf.com' },
  { match: ['whiteoak', 'white oak'], domain: 'whiteoakamc.com' },
  { match: ['samco'], domain: 'samcomf.com' },
  { match: ['nj '], domain: 'njmutualfund.com' },
  { match: ['bajaj finserv', 'bajaj'], domain: 'bajajfinservmf.in' },
  { match: ['helios'], domain: 'helioscapital.in' },
  { match: ['groww'], domain: 'growwmf.in' },
  { match: ['jioblackrock', 'jio blackrock'], domain: 'jioblackrock.com' },
  { match: ['old bridge', 'oldbridge'], domain: 'oldbridgemf.com' },
  { match: ['zerodha'], domain: 'zerodhafundhouse.com' },
];

// --- Stock registry (base ticker → company domain) ------------------------------------
// Keyed by the ticker WITHOUT its exchange suffix (RELIANCE.NS → RELIANCE). Covers the common
// Indian large-caps, where logo.dev's ticker endpoint is weakest. US/global tickers fall through
// to logo.dev's ticker endpoint (token only).
const STOCK_REGISTRY: Record<string, string> = {
  RELIANCE: 'ril.com',
  TCS: 'tcs.com',
  INFY: 'infosys.com',
  HDFCBANK: 'hdfcbank.com',
  ICICIBANK: 'icicibank.com',
  SBIN: 'sbi.co.in',
  HINDUNILVR: 'hul.co.in',
  ITC: 'itcportal.com',
  BHARTIARTL: 'airtel.in',
  LT: 'larsentoubro.com',
  KOTAKBANK: 'kotak.com',
  AXISBANK: 'axisbank.com',
  BAJFINANCE: 'bajajfinserv.in',
  BAJAJFINSV: 'bajajfinserv.in',
  ASIANPAINT: 'asianpaints.com',
  MARUTI: 'marutisuzuki.com',
  WIPRO: 'wipro.com',
  HCLTECH: 'hcltech.com',
  SUNPHARMA: 'sunpharma.com',
  TATAMOTORS: 'tatamotors.com',
  TATASTEEL: 'tatasteel.com',
  TITAN: 'titancompany.in',
  ULTRACEMCO: 'ultratechcement.com',
  NESTLEIND: 'nestle.in',
  POWERGRID: 'powergrid.in',
  NTPC: 'ntpc.co.in',
  ONGC: 'ongcindia.com',
  ADANIENT: 'adanienterprises.com',
  ADANIPORTS: 'adaniports.com',
  COALINDIA: 'coalindia.in',
  TECHM: 'techmahindra.com',
  M_M: 'mahindra.com',
  ZOMATO: 'zomato.com',
  PAYTM: 'paytm.com',
  DMART: 'dmart.in',
};

function logoFromDomain(domain: string): string {
  const token = getLogoDevToken();
  // fallback=404 → logo.dev returns a 404 (not a generated single-letter monogram) when it has no
  // logo for the domain, so the <img> errors out and LogoAvatar shows our 2-letter initials avatar.
  if (token) return `https://img.logo.dev/${domain}?token=${encodeURIComponent(token)}&size=256&retina=true&format=png&fallback=404`;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function resolveAmcDomain(name: string): string | null {
  const n = name.toLowerCase();
  let best: { domain: string; len: number } | null = null;
  for (const entry of AMC_REGISTRY) {
    for (const kw of entry.match) {
      if (n.includes(kw) && (!best || kw.length > best.len)) {
        best = { domain: entry.domain, len: kw.length };
      }
    }
  }
  return best?.domain ?? null;
}

function baseTicker(symbol: string): string {
  // Strip Yahoo exchange suffix (.NS/.BO/etc.) and normalize separators.
  return symbol.split('.')[0].replace(/[-]/g, '_').toUpperCase();
}

type AccountLike = { type: string; name: string; marketSymbol?: string };

// --- AI-resolved domain cache ---------------------------------------------------------
// Domains resolved by Gemini for holdings the static registries miss. Cached forever (a brand's
// domain doesn't change): a positive hit is the hostname, a negative result is '' so we never
// re-ask. Negatives are only stored when a Gemini key was present, so adding a key later still
// triggers a fresh lookup.
const DOMAIN_CACHE_KEY = 'logo_domain_cache';
const DOMAIN_CACHE_MIGRATION_KEY = 'logo_domain_cache_v2';
let domainCache: Record<string, string> = (() => {
  try {
    const raw = localStorage.getItem(DOMAIN_CACHE_KEY);
    const parsed: Record<string, string> = raw ? JSON.parse(raw) : {};
    // One-time cleanup: the old resolver couldn't tell a transient failure (network/cap) from a
    // genuine "not found" and cached '' for both — so any holding that failed once (common on
    // mobile) was stuck on initials forever. Drop those empties once so they re-resolve under the
    // new logic; a true not-found simply gets re-cached as '' after a clean lookup.
    if (!localStorage.getItem(DOMAIN_CACHE_MIGRATION_KEY)) {
      for (const k of Object.keys(parsed)) if (!parsed[k]) delete parsed[k];
      localStorage.setItem(DOMAIN_CACHE_KEY, JSON.stringify(parsed));
      localStorage.setItem(DOMAIN_CACHE_MIGRATION_KEY, '1');
    }
    return parsed;
  } catch { return {}; }
})();
const inFlight = new Set<string>();

export const LOGOS_UPDATED_EVENT = 'logosUpdated';
function notifyLogosUpdated() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOGOS_UPDATED_EVENT));
}

// Stocks key off the (stable) ticker; MFs off the scheme name.
function aiCacheKey(account: AccountLike): string {
  return account.type === 'stocks'
    ? `s:${(account.marketSymbol || account.name).toUpperCase()}`
    : `m:${account.name.toLowerCase()}`;
}

function stockRegistryUrl(symbol: string | undefined): string | null {
  if (!symbol) return null;
  const domain = STOCK_REGISTRY[baseTicker(symbol)];
  return domain ? logoFromDomain(domain) : null;
}

// logo.dev's ticker endpoint (token only) — an optimistic guess that 404s (→ initials fallback)
// for tickers it doesn't know. Used only as a last resort, after the AI-resolved domain.
function stockTickerGuessUrl(symbol: string | undefined): string | null {
  if (!symbol) return null;
  const token = getLogoDevToken();
  if (!token) return null;
  // fallback=404 so an unknown ticker 404s into our initials avatar instead of logo.dev's monogram.
  return `https://img.logo.dev/ticker/${encodeURIComponent(baseTicker(symbol))}?token=${encodeURIComponent(token)}&size=256&retina=true&format=png&fallback=404`;
}

/** Logo URL for a mutual-fund holding (resolved from its scheme name), or null if no AMC match. */
export function getMFLogoUrl(accountName: string): string | null {
  const domain = resolveAmcDomain(accountName);
  return domain ? logoFromDomain(domain) : null;
}

/** Best-known logo URL for an investment account right now, or null for the initials fallback.
 *  Order: static registry → AI-resolved domain → (stocks) logo.dev ticker guess. */
export function getAssetLogoUrl(account: AccountLike): string | null {
  if (account.type !== 'sips' && account.type !== 'stocks') return null;

  const registry = account.type === 'sips' ? getMFLogoUrl(account.name) : stockRegistryUrl(account.marketSymbol);
  if (registry) return registry;

  const aiDomain = domainCache[aiCacheKey(account)];
  if (aiDomain) return logoFromDomain(aiDomain);

  return account.type === 'stocks' ? stockTickerGuessUrl(account.marketSymbol) : null;
}

/** Fire-and-forget: for a holding the static registry can't resolve, ask Gemini for its domain
 *  once, cache it, and emit LOGOS_UPDATED_EVENT so listeners re-render with the real logo. */
export async function ensureAssetLogo(account: AccountLike): Promise<void> {
  if (account.type !== 'sips' && account.type !== 'stocks') return;

  const registry = account.type === 'sips' ? resolveAmcDomain(account.name) : (account.marketSymbol ? STOCK_REGISTRY[baseTicker(account.marketSymbol)] : null);
  if (registry) return; // already covered deterministically

  const key = aiCacheKey(account);
  if (key in domainCache || inFlight.has(key)) return;

  inFlight.add(key);
  try {
    if (!(await hasGeminiKey())) return; // no key → skip without caching, so a future key retries
    const query = account.type === 'sips'
      ? `${account.name} (Indian mutual fund house / AMC)`
      : `${account.name}${account.marketSymbol ? ` (NSE/BSE ticker ${baseTicker(account.marketSymbol)})` : ''} (Indian listed company)`;
    const domain = await resolveBrandDomain(query);
    domainCache[key] = domain || '';
    try { localStorage.setItem(DOMAIN_CACHE_KEY, JSON.stringify(domainCache)); } catch { /* ignore */ }
    if (domain) notifyLogosUpdated();
  } catch {
    /* transient failure — leave uncached so it retries next session */
  } finally {
    inFlight.delete(key);
  }
}
