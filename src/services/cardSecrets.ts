import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Account } from '../types';

// Card details never reach storage in the clear, and CVVs never reach a backup at all.
//
// In memory an account carries `cardDetails` in plaintext as before, so every screen reads it
// unchanged. At the storage boundary (FinanceContext's persist effect) the CVV is swapped for
// `cvvEnc` and the name, number and expiry for `detailsEnc`; on launch they are swapped back.
// Exports are built from memory: they keep the name, number and expiry in plaintext but drop the
// CVV and both ciphertexts (stripCardSecrets) — restoring one means typing CVVs in again.
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

/** null when the ciphertext can't be opened here — another device's key, a reset Keystore, or the
 *  other platform's prefix. Callers keep the ciphertext untouched rather than dropping it. */
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

const DETAIL_FIELDS = ['cardholderName', 'cardNumber', 'expiryMonth', 'expiryYear'] as const;
type DetailField = typeof DETAIL_FIELDS[number];
type CardDetailsOf = NonNullable<Account['cardDetails']>;

const packDetails = (cd: CardDetailsOf): string | null => {
  const picked: Partial<Pick<CardDetailsOf, DetailField>> = {};
  for (const f of DETAIL_FIELDS) if (cd[f] !== undefined && cd[f] !== '') (picked as Record<string, unknown>)[f] = cd[f];
  return Object.keys(picked).length ? JSON.stringify(picked) : null;
};

const withoutDetails = (cd: CardDetailsOf): CardDetailsOf => {
  const rest = { ...cd };
  for (const f of DETAIL_FIELDS) delete rest[f];
  return rest;
};

/**
 * Accounts as they go to storage. Each plaintext CVV is replaced by its ciphertext from `sealed`
 * (plaintext → ciphertext) as `cvvEnc`, and the cardholder name, number and expiry together by
 * theirs as `detailsEnc`. `missing` lists plaintexts with no ciphertext yet — encrypt those, add
 * them to `sealed`, and seal again. Meanwhile an unsealed CVV is left out, while unsealed details
 * stay in the clear rather than be lost. Ciphertexts not yet opened this launch are kept as they are.
 */
export const sealAccounts = (accounts: Account[], sealed: Map<string, string>): { accounts: Account[]; missing: string[] } => {
  const missing = new Set<string>();
  const out = accounts.map(acc => {
    if (!acc.cardDetails) return acc;
    let cd = acc.cardDetails;
    const cvv = cd.cvv;
    const packed = packDetails(cd);
    if (!cvv && !packed) return acc;
    if (cvv) {
      // A stale cvvEnc beside a plaintext CVV is an older value: the plaintext wins.
      const { cvv: _plain, cvvEnc: _stale, ...rest } = cd;
      const enc = sealed.get(cvv);
      if (!enc) missing.add(cvv);
      cd = { ...rest, ...(enc ? { cvvEnc: enc } : {}) };
    }
    if (packed) {
      const enc = sealed.get(packed);
      if (enc) {
        const { detailsEnc: _stale, ...rest } = withoutDetails(cd);
        cd = { ...rest, detailsEnc: enc };
      } else {
        missing.add(packed);
        const { detailsEnc: _stale, ...rest } = cd;
        cd = rest;
      }
    }
    return { ...acc, cardDetails: cd };
  });
  return { accounts: out, missing: [...missing] };
};

/**
 * Accounts as they come out of storage: each `cvvEnc` and `detailsEnc` swapped for what `opened`
 * holds for it (ciphertext → plaintext, or null when unreadable — then the ciphertext is kept as it
 * is, so the device that sealed it can still open it if the data goes back there). Plaintext from
 * before encryption, or from an old backup, is left for the next save to seal.
 */
export const openAccounts = (accounts: Account[], opened: Map<string, string | null>): Account[] =>
  accounts.map(acc => {
    if (!acc.cardDetails) return acc;
    let cd = acc.cardDetails;
    const cvv = cd.cvvEnc ? opened.get(cd.cvvEnc) : null;
    if (cvv) {
      const { cvvEnc: _enc, ...rest } = cd;
      cd = { ...rest, cvv };
    }
    const details = cd.detailsEnc ? opened.get(cd.detailsEnc) : null;
    if (details) {
      const { detailsEnc: _enc, ...rest } = cd;
      cd = { ...JSON.parse(details), ...rest };
    }
    return cd === acc.cardDetails ? acc : { ...acc, cardDetails: cd };
  });

/** Accounts as they go into a backup: no CVV in any form, and no ciphertext only this device can open. */
export const stripCardSecrets = (accounts: Account[]): Account[] =>
  accounts.map(acc => {
    const cd = acc.cardDetails;
    if (!cd || (!('cvv' in cd) && !('cvvEnc' in cd) && !('detailsEnc' in cd))) return acc;
    const { cvv: _plain, cvvEnc: _enc, detailsEnc: _details, ...rest } = cd;
    return { ...acc, cardDetails: rest };
  });
