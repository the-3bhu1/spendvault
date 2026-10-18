import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Account } from '../types';

// Card CVVs never reach storage or a backup in the clear.
//
// In memory an account carries `cardDetails.cvv` as before, so every screen reads it unchanged. At
// the storage boundary (FinanceContext's persist effect) the CVV is swapped for `cvvEnc`, a
// ciphertext; on launch it is swapped back. Exports drop both (stripCardSecrets), so a backup file
// or clipboard code never holds a CVV — restoring one means typing CVVs in again.
//
// Android: AES-GCM under an Android Keystore key (CardSecretPlugin.kt) that can't leave the device
// and isn't in Auto Backup. Browser (development): WebCrypto AES-GCM with a non-extractable key kept
// in IndexedDB. The prefix says which made a ciphertext.

interface CardSecretPlugin {
  encrypt(o: { plaintext: string }): Promise<{ ciphertext: string }>;
  decrypt(o: { ciphertext: string }): Promise<{ plaintext: string }>;
}

const CardSecret = registerPlugin<CardSecretPlugin>('CardSecret');

const NATIVE = 'a1:';
const WEB = 'w1:';

const onAndroid = () => Capacitor.getPlatform() === 'android';

// ---- browser fallback --------------------------------------------------------------------------

let webKey: Promise<CryptoKey> | null = null;

const idb = <T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open('spendvault-secrets', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('keys');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = run(open.result.transaction('keys', mode).objectStore('keys'));
      req.onsuccess = () => { resolve(req.result); open.result.close(); };
      req.onerror = () => { reject(req.error); open.result.close(); };
    };
  });

const getWebKey = () => {
  webKey ??= (async () => {
    const saved = await idb<CryptoKey | undefined>(s => s.get('card'), 'readonly');
    if (saved) return saved;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idb(s => s.put(key, 'card'), 'readwrite');
    return key;
  })();
  webKey.catch(() => { webKey = null; });
  return webKey;
};

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// ---- cipher ------------------------------------------------------------------------------------

export const encryptSecret = async (plaintext: string): Promise<string> => {
  if (onAndroid()) return NATIVE + (await CardSecret.encrypt({ plaintext })).ciphertext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getWebKey(), new TextEncoder().encode(plaintext)));
  const sealed = new Uint8Array(iv.length + ct.length);
  sealed.set(iv);
  sealed.set(ct, iv.length);
  return WEB + toB64(sealed);
};

/** null when the ciphertext can't be opened here — another device's key (a restored backup), a
 *  reset Keystore, or the other platform's prefix. That is permanent, so callers drop it. */
export const decryptSecret = async (ciphertext: string): Promise<string | null> => {
  try {
    if (ciphertext.startsWith(NATIVE) && onAndroid()) {
      return (await CardSecret.decrypt({ ciphertext: ciphertext.slice(NATIVE.length) })).plaintext;
    }
    if (ciphertext.startsWith(WEB) && !onAndroid()) {
      const sealed = fromB64(ciphertext.slice(WEB.length));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12) }, await getWebKey(), sealed.slice(12));
      return new TextDecoder().decode(plain);
    }
  } catch { /* unreadable — fall through */ }
  return null;
};

// ---- the storage and export boundaries (pure) --------------------------------------------------

/**
 * Accounts as they go to storage: each plaintext CVV replaced by its ciphertext from `sealed`
 * (plaintext → ciphertext). `missing` lists CVVs with no ciphertext yet — encrypt those, add them
 * to `sealed`, and seal again. An account still holding only `cvvEnc` (not yet opened this launch)
 * keeps it as it is.
 */
export const sealAccounts = (accounts: Account[], sealed: Map<string, string>): { accounts: Account[]; missing: string[] } => {
  const missing = new Set<string>();
  const out = accounts.map(acc => {
    const cvv = acc.cardDetails?.cvv;
    if (!acc.cardDetails || !cvv) return acc;
    // A stale cvvEnc beside a plaintext CVV is an older value: the plaintext wins.
    const { cvv: _plain, cvvEnc: _stale, ...rest } = acc.cardDetails;
    const enc = sealed.get(cvv);
    if (!enc) missing.add(cvv);
    return { ...acc, cardDetails: { ...rest, ...(enc ? { cvvEnc: enc } : {}) } };
  });
  return { accounts: out, missing: [...missing] };
};

/**
 * Accounts as they come out of storage: each `cvvEnc` swapped for the CVV `opened` holds for it
 * (ciphertext → plaintext, or null when unreadable — then the CVV is dropped). A plaintext `cvv` from
 * before encryption, or from an old backup, is left for the next save to seal.
 */
export const openAccounts = (accounts: Account[], opened: Map<string, string | null>): Account[] =>
  accounts.map(acc => {
    const enc = acc.cardDetails?.cvvEnc;
    if (!acc.cardDetails || !enc || !opened.has(enc)) return acc;
    const { cvvEnc: _enc, ...rest } = acc.cardDetails;
    const cvv = opened.get(enc);
    return { ...acc, cardDetails: { ...rest, ...(cvv ? { cvv } : {}) } };
  });

/** Accounts as they go into a backup: no CVV in any form. */
export const stripCardSecrets = (accounts: Account[]): Account[] =>
  accounts.map(acc => {
    if (!acc.cardDetails || (!('cvv' in acc.cardDetails) && !('cvvEnc' in acc.cardDetails))) return acc;
    const { cvv: _plain, cvvEnc: _enc, ...rest } = acc.cardDetails;
    return { ...acc, cardDetails: rest };
  });
