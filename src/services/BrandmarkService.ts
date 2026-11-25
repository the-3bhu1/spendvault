import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { Capacitor } from '@capacitor/core';
import { notifyLogosUpdated } from './LogoService';

// ── A co-brand's full wordmark, for the back of its card ─────────────────────────────────────────
//
// The round logos come from img.logo.dev with the publishable token, and that CDN only ever serves a
// brand's SQUARE mark — Flipkart's "F", never "Flipkart". The wide lockup (logo.dev calls it the
// BRANDMARK) is only available from their Brand API, which takes the account's SECRET key. So this is
// opt-in: with a secret key saved in Settings, each co-brand's brandmark is looked up ONCE, the image
// downloaded and kept here for good, and the card's back prints it where Jupiter's wordmark sits.
// Without a key — or for a brand logo.dev has no brandmark for — the back keeps the round icon.
//
// Why once and kept: the API answers with a SIGNED image link that expires within about a day, and
// each lookup costs credits (3 per brand per day on their pricing). Seven co-branded cards is seven
// lookups, ever. A brand with no brandmark is remembered as such, so it is not asked about again —
// until the key changes, which clears those so a new key gets a fresh try.
//
// THE KEY IS A SECRET. logo.dev's advice is to keep it on a server; this app has none, so it is kept
// the way the Gemini key is — the OS keystore on the phone, localStorage only in the dev browser —
// and it is never part of a backup or a shared file. Anyone who can open the app could still use it;
// the free plan's spend is capped by its credits, and the key can be rotated in the logo.dev dashboard.

const SECRET_SERVER = 'spendvault.logodev'; // keystore namespace
const WEB_DEV_SECRET = 'logo_dev_secret_dev'; // web-only fallback
const CACHE_KEY = 'brandmark_cache_v1';
const API = 'https://api.logo.dev/v2/brands/brandmark';
/** Download width. The mark is drawn ~120px wide on the card; 400 keeps it sharp at 3× and small. */
const DOWNLOAD_SIZE = 400;

const isNative = Capacitor.isNativePlatform();

export type BrandmarkTheme = 'light' | 'dark';

// ── The secret key ───────────────────────────────────────────────────────────────────────────────
export async function setLogoDevSecret(key: string): Promise<void> {
  const trimmed = key.trim();
  if (isNative) {
    try { await NativeBiometric.deleteCredentials({ server: SECRET_SERVER }); } catch { /* none stored */ }
    if (trimmed) await NativeBiometric.setCredentials({ username: 'logodev', password: trimmed, server: SECRET_SERVER });
  } else {
    if (trimmed) localStorage.setItem(WEB_DEV_SECRET, trimmed);
    else localStorage.removeItem(WEB_DEV_SECRET);
  }
  // A new key deserves a fresh try at every brand an old one found nothing for (or failed on).
  forgetMisses();
  lastStatus = undefined;
}

export async function getLogoDevSecret(): Promise<string | null> {
  try {
    if (isNative) {
      const { password } = await NativeBiometric.getCredentials({ server: SECRET_SERVER });
      return password || null;
    }
    return localStorage.getItem(WEB_DEV_SECRET) || null;
  } catch {
    return null;
  }
}

export async function hasLogoDevSecret(): Promise<boolean> {
  return (await getLogoDevSecret()) !== null;
}

// ── The cache: 'flipkart.com|dark' → data URL, or '' for "logo.dev has no brandmark" ─────────────
let cache: Record<string, string> = (() => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
})();
const persist = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* full — keep in memory */ } };
const keyOf = (domain: string, theme: BrandmarkTheme) => `${domain.toLowerCase()}|${theme}`;

function forgetMisses() {
  cache = Object.fromEntries(Object.entries(cache).filter(([, v]) => !!v));
  persist();
}

/** The brandmark image for a domain, if one has been fetched. */
export function getCachedBrandmark(domain: string, theme: BrandmarkTheme): string | null {
  return cache[keyOf(domain, theme)] || null;
}

/** Why the last lookup did not produce an image — shown in Settings so a bad key is not silent. */
export type BrandmarkStatus = 'ok' | 'none' | 'bad_key' | 'no_credits' | 'rate_limited' | 'blocked' | 'error';
let lastStatus: BrandmarkStatus | undefined;
export const getLastBrandmarkStatus = () => lastStatus;

const inFlight = new Set<string>();

/**
 * Fire-and-forget: fetch a brand's brandmark once and keep it. Announces LOGOS_UPDATED_EVENT when an
 * image lands, so a card back that is open re-renders with it. Safe to call on every render: cached,
 * known-missing and in-flight lookups return at once.
 */
export async function ensureBrandmark(domain: string, theme: BrandmarkTheme): Promise<void> {
  const k = keyOf(domain, theme);
  if (k in cache || inFlight.has(k)) return;
  const secret = await getLogoDevSecret();
  if (!secret) return;

  inFlight.add(k);
  try {
    let res: Response;
    try {
      res = await fetch(`${API}?domain=${encodeURIComponent(domain)}`, { headers: { Authorization: `Bearer ${secret}` } });
    } catch {
      // On the phone the call goes through native HTTP and this means offline. In a desktop browser
      // it is most often logo.dev refusing a browser caller (CORS) — the docs say server-only.
      lastStatus = isNative ? 'error' : 'blocked';
      return;
    }
    if (res.status === 202) return;                                  // still indexing — try next time
    if (res.status === 404) { cache[k] = ''; persist(); lastStatus = 'none'; return; }
    if (res.status === 401 || res.status === 403) { lastStatus = 'bad_key'; return; }
    if (res.status === 402) { lastStatus = 'no_credits'; return; }
    if (res.status === 429) { lastStatus = 'rate_limited'; return; }
    if (!res.ok) { lastStatus = 'error'; return; }

    const body = await res.json() as { data?: { url?: string } };
    const url = body?.data?.url;
    if (!url) { cache[k] = ''; persist(); lastStatus = 'none'; return; }

    const img = await fetch(`${url}${url.includes('?') ? '&' : '?'}format=png&theme=${theme}&size=${DOWNLOAD_SIZE}`);
    if (!img.ok) { lastStatus = 'error'; return; }
    const blob = await img.blob();
    if (!blob.type.startsWith('image/')) { lastStatus = 'error'; return; }
    // btoa over the bytes rather than FileReader: same data: URL, and it runs outside a browser too.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const dataUrl = `data:${blob.type};base64,${btoa(binary)}`;
    if (!dataUrl.startsWith('data:image/')) { lastStatus = 'error'; return; }
    cache[k] = dataUrl;
    persist();
    lastStatus = 'ok';
    notifyLogosUpdated();
  } catch {
    lastStatus = 'error';
  } finally {
    inFlight.delete(k);
  }
}
