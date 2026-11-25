// The brandmark lookup against a faked logo.dev: what it asks for, what it keeps, and when it asks
// again. Real calls cost credits, so none are made here.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});
vi.stubGlobal('window', { dispatchEvent: () => true });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const brandmark = (status: number) => new Response(
  status === 200 ? JSON.stringify({ data: { object: 'image', kind: 'brandmark', url: 'https://img.logo.dev/assets/SEALED' } }) : '{}',
  { status, headers: { 'content-type': 'application/json' } },
);
const image = () => new Response(new Blob([PNG], { type: 'image/png' }), { status: 200 });

const load = async () => {
  vi.resetModules();
  return import('./BrandmarkService');
};

describe('BrandmarkService', () => {
  beforeEach(() => { store.clear(); });

  it('does nothing without a secret key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.ensureBrandmark('flipkart.com', 'dark');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('looks a brand up once with the secret key, downloads it as a recoloured PNG, and keeps it', async () => {
    const fetch = vi.fn(async (url: string) => (url.startsWith('https://api.logo.dev') ? brandmark(200) : image()));
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_live_abc');
    await s.ensureBrandmark('flipkart.com', 'dark');

    const [apiUrl, apiInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(apiUrl).toBe('https://api.logo.dev/v2/brands/brandmark?domain=flipkart.com');
    expect((apiInit.headers as Record<string, string>).Authorization).toBe('Bearer sk_live_abc');
    expect(fetch.mock.calls[1][0]).toBe('https://img.logo.dev/assets/SEALED?format=png&theme=dark&size=400');
    expect(s.getCachedBrandmark('flipkart.com', 'dark')).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`);
    expect(s.getLastBrandmarkStatus()).toBe('ok');

    await s.ensureBrandmark('flipkart.com', 'dark');
    expect(fetch).toHaveBeenCalledTimes(2); // kept — not asked again
  });

  it('remembers a brand with no brandmark, until the key changes', async () => {
    const fetch = vi.fn(async () => brandmark(404));
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_one');
    await s.ensureBrandmark('eazydiner.com', 'dark');
    await s.ensureBrandmark('eazydiner.com', 'dark');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s.getCachedBrandmark('eazydiner.com', 'dark')).toBeNull();

    await s.setLogoDevSecret('sk_two');
    await s.ensureBrandmark('eazydiner.com', 'dark');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports a rejected key and tries again next time rather than giving up on the brand', async () => {
    const fetch = vi.fn(async () => brandmark(401));
    vi.stubGlobal('fetch', fetch);
    const s = await load();
    await s.setLogoDevSecret('sk_wrong');
    await s.ensureBrandmark('amazon.in', 'dark');
    expect(s.getLastBrandmarkStatus()).toBe('bad_key');
    await s.ensureBrandmark('amazon.in', 'dark');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the light and dark versions apart', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.startsWith('https://api.logo.dev') ? brandmark(200) : image())));
    const s = await load();
    await s.setLogoDevSecret('sk_x');
    await s.ensureBrandmark('iocl.com', 'light');
    expect(s.getCachedBrandmark('iocl.com', 'light')).not.toBeNull();
    expect(s.getCachedBrandmark('iocl.com', 'dark')).toBeNull();
  });
});
