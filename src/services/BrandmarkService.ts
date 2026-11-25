import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { Capacitor } from '@capacitor/core';
import { getCachedLogo, getCardCoBrandDomain, notifyLogosUpdated } from './LogoService';
import { getCardGradients } from '../utils';
import type { Account } from '../types';
import {
  brandLogoKeyOf, brandmarkKeyOf, forgetBrandAssetMisses, getCachedBrandmark, isBrandAssetKnown, rememberBrandAsset,
  type BrandmarkTheme,
} from './brandAssetCache';

export { getCachedBrandmark, getCachedBrandLogo, type BrandmarkTheme } from './brandAssetCache';

// ── A co-brand's round logo and full wordmark, from logo.dev's Brand API ─────────────────────────
//
// Without a secret key, a co-branded card's round logo comes from img.logo.dev with the publishable
// token, and that CDN only ever serves a brand's SQUARE mark — Flipkart's "F", never "Flipkart". The
// wide lockup (logo.dev calls it the BRANDMARK) is only available from their Brand API, which takes the
// account's SECRET key. With that key saved in Settings, each co-brand's square logo AND brandmark are
// looked up ONCE from the Brand API, the images downloaded and kept here for good: the logo replaces
// the CDN one wherever the card is shown, and the card's back prints the brandmark where Jupiter's
// wordmark sits. Without a key — or for a brand logo.dev has nothing for — the CDN logo stays.
//
// Why once and kept: the API answers with a SIGNED image link that expires within about a day, and
// each lookup costs credits (5 for both, 2 for the logo, 3 for the brandmark). A brand with nothing
// is remembered as such, so it is not asked about again — until the key changes, which clears those
// so a new key gets a fresh try.
//
// THE KEY IS A SECRET. logo.dev's advice is to keep it on a server; this app has none, so it is kept
// the way the Gemini key is — the OS keystore on the phone, localStorage only in the dev browser —
// and it is never part of a backup or a shared file. Anyone who can open the app could still use it;
// the free plan's spend is capped by its credits, and the key can be rotated in the logo.dev dashboard.

const SECRET_SERVER = 'spendvault.logodev'; // keystore namespace
const WEB_DEV_SECRET = 'logo_dev_secret_dev'; // web-only fallback
const API = 'https://api.logo.dev/v2/brands';
/** Download width. The mark is drawn ~120px wide on the card; 400 keeps it sharp at 3× and small. */
const DOWNLOAD_SIZE = 400;
const LOGO_DOWNLOAD_SIZE = 256;

const isNative = Capacitor.isNativePlatform();

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
  forgetBrandAssetMisses();
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

/** Why the last lookup did not produce an image — shown in Settings so a bad key is not silent. */
export type BrandmarkStatus = 'ok' | 'none' | 'bad_key' | 'no_credits' | 'rate_limited' | 'blocked' | 'error';
let lastStatus: BrandmarkStatus | undefined;
export const getLastBrandmarkStatus = () => lastStatus;

const inFlight = new Set<string>();

type AssetLink = { url?: string } | null | undefined;
type BrandBody = { data?: { url?: string; logo?: AssetLink; brandmark?: AssetLink } };

async function downloadAsDataUrl(url: string, params: string): Promise<string | null> {
  const img = await fetch(`${url}${url.includes('?') ? '&' : '?'}${params}`);
  if (!img.ok) return null;
  const blob = await img.blob();
  if (!blob.type.startsWith('image/')) return null;
  // btoa over the bytes rather than FileReader: same data: URL, and it runs outside a browser too.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const dataUrl = `data:${blob.type};base64,${btoa(binary)}`;
  return dataUrl.startsWith('data:image/') ? dataUrl : null;
}

/**
 * Fire-and-forget: fetch a co-brand's square logo, and its brandmark in `wordmarkTheme` when one is
 * asked for, once each, and keep them. Announces LOGOS_UPDATED_EVENT when an image lands, so anything
 * showing the card re-renders with it. Safe to call on every render: cached, known-missing and
 * in-flight lookups return at once.
 */
export async function ensureBrandAssets(
  domain: string,
  wordmarkTheme?: BrandmarkTheme,
  { logo = true }: { logo?: boolean } = {},
): Promise<BrandmarkStatus | undefined> {
  const logoKey = brandLogoKeyOf(domain);
  const markKey = wordmarkTheme ? brandmarkKeyOf(domain, wordmarkTheme) : null;
  const wantLogo = logo && !isBrandAssetKnown(logoKey);
  const wantMark = !!markKey && !isBrandAssetKnown(markKey);
  const flightKey = domain.toLowerCase();
  if ((!wantLogo && !wantMark) || inFlight.has(flightKey)) return undefined;
  const secret = await getLogoDevSecret();
  if (!secret) return undefined;

  const route = wantLogo && wantMark ? '' : wantLogo ? '/logo' : '/brandmark';
  const settle = (status: BrandmarkStatus) => (lastStatus = status);
  const rememberMisses = () => {
    if (wantLogo) rememberBrandAsset(logoKey, '');
    if (wantMark && markKey) rememberBrandAsset(markKey, '');
  };
  inFlight.add(flightKey);
  try {
    let res: Response;
    try {
      res = await fetch(`${API}${route}?domain=${encodeURIComponent(domain)}`, { headers: { Authorization: `Bearer ${secret}` } });
    } catch {
      // On the phone the call goes through native HTTP and this means offline. In a desktop browser
      // it is most often logo.dev refusing a browser caller (CORS) — the docs say server-only.
      return settle(isNative ? 'error' : 'blocked');
    }
    if (res.status === 202) return undefined;                        // still indexing — try next time
    if (res.status === 404) { rememberMisses(); return settle('none'); }
    if (res.status === 401 || res.status === 403) return settle('bad_key');
    if (res.status === 402) return settle('no_credits');
    if (res.status === 429) return settle('rate_limited');
    if (!res.ok) return settle('error');

    const data = (await res.json() as BrandBody)?.data;
    const logoUrl = route === '' ? data?.logo?.url : route === '/logo' ? data?.url : undefined;
    const markUrl = route === '' ? data?.brandmark?.url : route === '/brandmark' ? data?.url : undefined;

    let landed = false;
    let failed = false;
    if (wantLogo) {
      const dataUrl = logoUrl ? await downloadAsDataUrl(logoUrl, `format=png&size=${LOGO_DOWNLOAD_SIZE}`) : '';
      if (dataUrl === null) failed = true;
      else { rememberBrandAsset(logoKey, dataUrl); landed ||= !!dataUrl; }
    }
    if (wantMark && markKey) {
      const dataUrl = markUrl ? await downloadAsDataUrl(markUrl, `format=png&theme=${wordmarkTheme}&size=${DOWNLOAD_SIZE}`) : '';
      if (dataUrl === null) failed = true;
      else { rememberBrandAsset(markKey, dataUrl); landed ||= !!dataUrl; }
    }
    if (landed) notifyLogosUpdated();
    return settle(failed ? 'error' : landed ? 'ok' : 'none');
  } catch {
    return settle('error');
  } finally {
    inFlight.delete(flightKey);
  }
}

type WordmarkCard = Pick<Account, 'name' | 'customLogoUrl' | 'customWordmarkUrl' | 'wordmarkOff'>;

export const isImageLink = (value: string) => /^(https?:|data:)/i.test(value);

export function cardWordmarkDomain(card: WordmarkCard): string | null {
  if (card.wordmarkOff) return null;
  const custom = card.customWordmarkUrl?.trim();
  if (custom) return isImageLink(custom) ? null : custom.toLowerCase();
  return getCardCoBrandDomain(card);
}

export function cardWordmarkImage(card: WordmarkCard, theme: BrandmarkTheme): string | null {
  if (card.wordmarkOff) return null;
  const custom = card.customWordmarkUrl?.trim();
  if (custom && isImageLink(custom)) return getCachedLogo(custom) ?? custom;
  const domain = cardWordmarkDomain(card);
  return domain ? getCachedBrandmark(domain, theme) : null;
}

export const wordmarkThemeForInk = (ink: 'light' | 'dark'): BrandmarkTheme => (ink === 'dark' ? 'light' : 'dark');

export type BrandAssetTarget = { accountId: string; domain: string; logo: boolean; wordmarkTheme?: BrandmarkTheme };

export function brandAssetTargets(accounts: Account[]): BrandAssetTarget[] {
  const ordered = [...accounts].sort((a, b) => a.id.localeCompare(b.id));
  return ordered.flatMap((card, index): BrandAssetTarget[] => {
    if (card.type !== 'credit_card' || card.archived) return [];
    const domain = getCardCoBrandDomain(card);
    if (!domain) return [];
    // Each card's wordmark in the colours its own card needs — the same choice its back makes.
    // Cards with a wordmark drawn into the app (super.money, Swiggy, Jupiter) never ask logo.dev —
    // their back already carries it, and a lookup would only spend credits.
    const skin = getCardGradients(index, card.cardDetails?.network, card.name);
    if (skin.coBrand) return [];
    const wordmarkTheme = wordmarkThemeForInk(skin.ink);
    const wordmarkDomain = cardWordmarkDomain(card);
    if (wordmarkDomain === domain) return [{ accountId: card.id, domain, logo: true, wordmarkTheme }];
    const targets: BrandAssetTarget[] = [{ accountId: card.id, domain, logo: true }];
    if (wordmarkDomain) targets.push({ accountId: card.id, domain: wordmarkDomain, logo: false, wordmarkTheme });
    return targets;
  });
}

const REFUSES_EVERY_BRAND: ReadonlySet<BrandmarkStatus> = new Set(['bad_key', 'no_credits', 'rate_limited', 'blocked']);

export async function ensureBrandAssetsFor(targets: BrandAssetTarget[]): Promise<BrandmarkStatus | undefined> {
  let outcome: BrandmarkStatus | undefined;
  for (const t of targets) {
    const status = await ensureBrandAssets(t.domain, t.wordmarkTheme, { logo: t.logo });
    if (status && (!outcome || (status !== 'ok' && status !== 'none'))) outcome = status;
    // A refused key, no credits left, a rate limit or a blocked caller will refuse every other
    // card the same way — stop at the first rather than repeat the failure down the list.
    if (status && REFUSES_EVERY_BRAND.has(status)) break;
  }
  return outcome;
}
