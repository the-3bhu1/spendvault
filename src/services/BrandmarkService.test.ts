// The Brand API lookup against a faked logo.dev: what it asks for, what it keeps, and when it asks
// again. Real calls cost credits, so none are made here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Account } from '../types';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});
vi.stubGlobal('window', { dispatchEvent: () => true });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const PNG_DATA_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
const LOGO = 'https://img.logo.dev/assets/LOGO';
const MARK = 'https://img.logo.dev/assets/MARK';
const image = () => new Response(new Blob([PNG], { type: 'image/png' }), { status: 200 });

const fakeLogoDev = (opts: { status?: (url: string) => number; logo?: boolean; mark?: boolean } = {}) =>
  vi.fn(async (url: string) => {
    if (!url.startsWith('https://api.logo.dev')) return image();
    const status = opts.status?.(url) ?? 200;
    if (status !== 200) return new Response('{}', { status });
    const logo = opts.logo === false ? null : { url: LOGO };
    const brandmark = opts.mark === false ? null : { url: MARK };
    const path = new URL(url).pathname;
    const data = path.endsWith('/logo') ? logo : path.endsWith('/brandmark') ? brandmark : { logo, brandmark };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

const apiCalls = (fetch: ReturnType<typeof fakeLogoDev>) =>
  fetch.mock.calls.map(c => c[0] as string).filter(u => u.startsWith('https://api.logo.dev'));

const load = async () => {
  vi.resetModules();
  return import('./BrandmarkService');
};

const card = (id: string, name: string, extra: Partial<Account> = {}): Account =>
  ({ id, name, type: 'credit_card', openingBalances: {}, ...extra });

describe('BrandmarkService', () => {
  beforeEach(() => { store.clear(); });

  it('does nothing without a secret key', async () => {
    const fetch = fakeLogoDev();
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.ensureBrandAssets('flipkart.com', 'dark');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('takes the logo and the wordmark from one brand lookup, and keeps both', async () => {
    const fetch = fakeLogoDev();
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_live_abc');
    expect(await s.ensureBrandAssets('flipkart.com', 'dark')).toBe('ok');

    const [apiUrl, apiInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(apiUrl).toBe('https://api.logo.dev/v2/brands?domain=flipkart.com');
    expect((apiInit.headers as Record<string, string>).Authorization).toBe('Bearer sk_live_abc');
    expect(fetch.mock.calls.map(c => c[0])).toContain(`${LOGO}?format=png&size=256`);
    expect(fetch.mock.calls.map(c => c[0])).toContain(`${MARK}?format=png&theme=dark&size=400`);
    expect(s.getCachedBrandLogo('flipkart.com')).toBe(PNG_DATA_URL);
    expect(s.getCachedBrandmark('flipkart.com', 'dark')).toBe(PNG_DATA_URL);

    await s.ensureBrandAssets('flipkart.com', 'dark');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('asks only for the logo when the wordmark was fetched before logos came from the Brand API', async () => {
    store.set('brandmark_cache_v1', JSON.stringify({ 'amazon.in|dark': PNG_DATA_URL }));
    const fetch = fakeLogoDev();
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_x');
    await s.ensureBrandAssets('amazon.in', 'dark');
    expect(apiCalls(fetch)).toEqual(['https://api.logo.dev/v2/brands/logo?domain=amazon.in']);
    expect(s.getCachedBrandLogo('amazon.in')).toBe(PNG_DATA_URL);
  });

  it('asks only for the brandmark when the card needs the other colour of a brand it already has', async () => {
    const fetch = fakeLogoDev();
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_x');
    await s.ensureBrandAssets('iocl.com', 'light');
    await s.ensureBrandAssets('iocl.com', 'dark');
    expect(apiCalls(fetch)).toEqual([
      'https://api.logo.dev/v2/brands?domain=iocl.com',
      'https://api.logo.dev/v2/brands/brandmark?domain=iocl.com',
    ]);
    expect(s.getCachedBrandmark('iocl.com', 'light')).not.toBeNull();
    expect(s.getCachedBrandmark('iocl.com', 'dark')).not.toBeNull();
  });

  it('asks only for the logo when no wordmark is wanted', async () => {
    const fetch = fakeLogoDev();
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_x');
    await s.ensureBrandAssets('swiggy.com');
    expect(apiCalls(fetch)).toEqual(['https://api.logo.dev/v2/brands/logo?domain=swiggy.com']);
  });

  it('remembers a brand logo.dev does not know, until the key changes', async () => {
    const fetch = fakeLogoDev({ status: () => 404 });
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_one');
    expect(await s.ensureBrandAssets('eazydiner.com', 'dark')).toBe('none');
    await s.ensureBrandAssets('eazydiner.com', 'dark');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s.getCachedBrandLogo('eazydiner.com')).toBeNull();

    await s.setLogoDevSecret('sk_two');
    await s.ensureBrandAssets('eazydiner.com', 'dark');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the logo when the brand has no wordmark, and does not ask about the wordmark again', async () => {
    const fetch = fakeLogoDev({ mark: false });
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_x');
    expect(await s.ensureBrandAssets('marriott.com', 'dark')).toBe('ok');
    expect(s.getCachedBrandLogo('marriott.com')).toBe(PNG_DATA_URL);
    expect(s.getCachedBrandmark('marriott.com', 'dark')).toBeNull();
    await s.ensureBrandAssets('marriott.com', 'dark');
    expect(apiCalls(fetch)).toHaveLength(1);
  });

  it('reports a rejected key and tries again next time rather than giving up on the brand', async () => {
    const fetch = fakeLogoDev({ status: () => 401 });
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_wrong');
    expect(await s.ensureBrandAssets('amazon.in', 'dark')).toBe('bad_key');
    expect(s.getLastBrandmarkStatus()).toBe('bad_key');
    await s.ensureBrandAssets('amazon.in', 'dark');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('targets live co-branded credit cards, leaving out those with a wordmark drawn in', async () => {
    const s = await load();
    const targets = s.brandAssetTargets([
      card('a', 'Amazon Pay ICICI Bank Credit Card'),
      card('b', 'HDFC Millennia'),
      card('c', 'Swiggy x HDFC'),
      card('d', 'IndiGo HDFC', { archived: true }),
      card('e', 'Flipkart Wallet', { type: 'wallet' }),
      card('f', 'Marriott Bonvoy HDFC Bank Credit Card'),
    ]);
    expect(targets.map(t => [t.accountId, t.domain])).toEqual([
      ['a', 'amazon.in'],
      ['f', 'marriott.com'],
    ]);
  });

  it('fetches only the brand a newly added card brings', async () => {
    const fetch = fakeLogoDev();
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_x');
    const cards = [card('a', 'Amazon Pay ICICI Bank Credit Card')];
    expect(await s.ensureBrandAssetsFor(s.brandAssetTargets(cards))).toBe('ok');
    expect(apiCalls(fetch)).toHaveLength(1);

    cards.push(card('b', 'HDFC IndianOil Credit Card'));
    await s.ensureBrandAssetsFor(s.brandAssetTargets(cards));
    expect(apiCalls(fetch)).toEqual([
      'https://api.logo.dev/v2/brands?domain=amazon.in',
      'https://api.logo.dev/v2/brands?domain=iocl.com',
    ]);
  });

  it('stops at the first card when logo.dev refuses the key', async () => {
    const fetch = fakeLogoDev({ status: () => 401 });
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_wrong');
    const targets = s.brandAssetTargets([
      card('a', 'Amazon Pay ICICI Bank Credit Card'),
      card('b', 'IndiGo HDFC'),
      card('c', 'EazyDiner IndusInd Bank Platinum Credit Card'),
    ]);
    expect(await s.ensureBrandAssetsFor(targets)).toBe('bad_key');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports the failure, not a later success, when cards fare differently', async () => {
    vi.stubGlobal('fetch', fakeLogoDev({ status: url => (url.includes('domain=amazon.in') ? 500 : 200) }));
    const s = await load();
    await s.setLogoDevSecret('sk_x');
    const targets = s.brandAssetTargets([card('a', 'Amazon Pay ICICI Bank Credit Card'), card('b', 'IndiGo HDFC')]);
    expect(await s.ensureBrandAssetsFor(targets)).toBe('error');
    expect(s.getCachedBrandLogo('goindigo.in')).not.toBeNull();
  });
});

describe('a card’s own wordmark choice', () => {
  beforeEach(() => { store.clear(); });

  it('fetches only the custom wordmark’s domain for the wordmark, and the brand for the logo', async () => {
    const fetch = fakeLogoDev();
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_x');
    const marriott = card('a', 'Marriott Bonvoy HDFC Bank Credit Card', { customWordmarkUrl: 'Bonvoy.com' });
    const targets = s.brandAssetTargets([marriott]);
    expect(targets.map(t => [t.domain, t.logo, !!t.wordmarkTheme])).toEqual([['marriott.com', true, false], ['bonvoy.com', false, true]]);

    await s.ensureBrandAssetsFor(targets);
    expect(apiCalls(fetch)).toEqual([
      'https://api.logo.dev/v2/brands/logo?domain=marriott.com',
      'https://api.logo.dev/v2/brands/brandmark?domain=bonvoy.com',
    ]);
    expect(s.cardWordmarkImage(marriott, targets[1].wordmarkTheme!)).toBe(PNG_DATA_URL);
  });

  it('uses a custom image link as it is, and asks logo.dev only for the round logo', async () => {
    const s = await load();
    const link = 'https://example.com/m.png';
    const marriott = card('a', 'Marriott Bonvoy HDFC Bank Credit Card', { customWordmarkUrl: link });
    expect(s.cardWordmarkImage(marriott, 'dark')).toBe(link);
    expect(s.cardWordmarkDomain(marriott)).toBeNull();
    expect(s.brandAssetTargets([marriott]).map(t => [t.domain, t.logo, !!t.wordmarkTheme])).toEqual([['marriott.com', true, false]]);
  });

  it('shows no wordmark, and fetches none, when the card uses its round logo instead', async () => {
    store.set('brandmark_cache_v1', JSON.stringify({ 'marriott.com|dark': PNG_DATA_URL }));
    const s = await load();
    const marriott = card('a', 'Marriott Bonvoy HDFC Bank Credit Card', { wordmarkOff: true });
    expect(s.cardWordmarkImage(marriott, 'dark')).toBeNull();
    expect(s.brandAssetTargets([marriott]).map(t => [t.domain, t.logo, !!t.wordmarkTheme])).toEqual([['marriott.com', true, false]]);
  });

  it('falls back to the brand’s own wordmark with nothing chosen', async () => {
    store.set('brandmark_cache_v1', JSON.stringify({ 'marriott.com|dark': PNG_DATA_URL }));
    const s = await load();
    expect(s.cardWordmarkImage(card('a', 'Marriott Bonvoy HDFC Bank Credit Card'), 'dark')).toBe(PNG_DATA_URL);
  });
});

describe('a co-branded card’s round logo', () => {
  beforeEach(() => { store.clear(); });

  it('comes from the Brand API once fetched, and from the logo token until then', async () => {
    vi.resetModules();
    const logos = await import('./LogoService');
    const amazon = { type: 'credit_card', name: 'Amazon Pay ICICI Bank Credit Card' };
    expect(logos.getCardLogoUrl(amazon)).not.toBe(PNG_DATA_URL);

    vi.stubGlobal('fetch', fakeLogoDev());
    const s = await import('./BrandmarkService');
    await s.setLogoDevSecret('sk_x');
    await s.ensureBrandAssets('amazon.in', 'dark');
    expect(logos.getCardLogoUrl(amazon)).toBe(PNG_DATA_URL);
    expect(logos.getCardCoBrandLogoUrl(amazon)).toBe(PNG_DATA_URL);
  });

  it('gives way to a custom logo image, and leaves plain bank cards alone', async () => {
    store.set('brandmark_cache_v1', JSON.stringify({ 'amazon.in|logo': PNG_DATA_URL, 'hdfcbank.com|logo': PNG_DATA_URL }));
    vi.resetModules();
    const logos = await import('./LogoService');
    const custom = 'https://example.com/amazon.png';
    expect(logos.getCardLogoUrl({ type: 'credit_card', name: 'Amazon Pay ICICI', customLogoUrl: custom })).toBe(custom);
    expect(logos.getCardLogoUrl({ type: 'credit_card', name: 'HDFC Millennia' })).not.toBe(PNG_DATA_URL);
  });
});
