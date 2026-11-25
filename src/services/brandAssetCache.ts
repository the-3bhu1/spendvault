export type BrandmarkTheme = 'light' | 'dark';

const CACHE_KEY = 'brandmark_cache_v1';

let cache: Record<string, string> = (() => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
})();
const persist = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* full — keep in memory */ } };

export const brandmarkKeyOf = (domain: string, theme: BrandmarkTheme) => `${domain.toLowerCase()}|${theme}`;
export const brandLogoKeyOf = (domain: string) => `${domain.toLowerCase()}|logo`;

export const isBrandAssetKnown = (key: string) => key in cache;

export function rememberBrandAsset(key: string, dataUrl: string) {
  cache[key] = dataUrl;
  persist();
}

export function forgetBrandAssetMisses() {
  cache = Object.fromEntries(Object.entries(cache).filter(([, v]) => !!v));
  persist();
}

export function getCachedBrandmark(domain: string, theme: BrandmarkTheme): string | null {
  return cache[brandmarkKeyOf(domain, theme)] || null;
}

export function getCachedBrandLogo(domain: string): string | null {
  return cache[brandLogoKeyOf(domain)] || null;
}
