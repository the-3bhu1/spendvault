import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { Capacitor } from '@capacitor/core';

// Runtime config for the Gemini-based commodity price fetcher.
//
// Security: the Gemini API key is NEVER bundled. On native builds it lives in the OS
// keystore (Android KeyStore / iOS Keychain) via the biometric plugin's credential vault,
// entered by the user in Settings. On web (dev only) it falls back to localStorage.
// The vendor name and model are not secrets, so they live in plain localStorage.

const GEMINI_SERVER = 'spendvault.gemini'; // keystore namespace
const WEB_DEV_KEY = 'gemini_key_dev';      // web-only fallback
const VENDOR_LS = 'commodity_vendor';
const MODEL_LS = 'gemini_model';

const DEFAULT_VENDOR = 'MMTC-PAMP';
const DEFAULT_MODEL = 'gemini-2.5-flash';

const isNative = Capacitor.isNativePlatform();

export async function setGeminiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (isNative) {
    try { await NativeBiometric.deleteCredentials({ server: GEMINI_SERVER }); } catch { /* none stored */ }
    if (trimmed) await NativeBiometric.setCredentials({ username: 'gemini', password: trimmed, server: GEMINI_SERVER });
  } else {
    if (trimmed) localStorage.setItem(WEB_DEV_KEY, trimmed);
    else localStorage.removeItem(WEB_DEV_KEY);
  }
}

export async function getGeminiKey(): Promise<string | null> {
  try {
    if (isNative) {
      const { password } = await NativeBiometric.getCredentials({ server: GEMINI_SERVER });
      return password || null;
    }
    return localStorage.getItem(WEB_DEV_KEY) || null;
  } catch {
    return null; // nothing stored / keystore unavailable
  }
}

export async function clearGeminiKey(): Promise<void> {
  try {
    if (isNative) await NativeBiometric.deleteCredentials({ server: GEMINI_SERVER });
    else localStorage.removeItem(WEB_DEV_KEY);
  } catch { /* nothing stored */ }
}

export async function hasGeminiKey(): Promise<boolean> {
  return (await getGeminiKey()) !== null;
}

export function getCommodityVendor(): string {
  return localStorage.getItem(VENDOR_LS) || DEFAULT_VENDOR;
}

export function setCommodityVendor(vendor: string): void {
  const t = vendor.trim();
  if (t) localStorage.setItem(VENDOR_LS, t);
  else localStorage.removeItem(VENDOR_LS);
}

export function getGeminiModel(): string {
  return localStorage.getItem(MODEL_LS) || DEFAULT_MODEL;
}
