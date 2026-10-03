import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { CardNetwork } from '../types';

// Tap-to-add for the card form. Native side: CardNfcPlugin.kt + EmvReader.kt.
//
// Android only. iOS's Core NFC refuses payment-card AIDs to third-party apps, so there is no
// iOS implementation to write — callers just never see the button there.

export interface ScannedCard {
  cardNumber: string;
  expiryMonth?: number; // 1–12
  expiryYear?: number;  // 2-digit
  network?: CardNetwork;
  label?: string;       // the chip's own application label, e.g. "VISA DEBIT"
}

export type CardNfcErrorCode = 'NOT_EMV' | 'TAG_LOST' | 'READ_FAILED';

interface CardNfcPlugin {
  isAvailable(): Promise<{ supported: boolean; enabled: boolean }>;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  addListener(eventName: 'cardRead', listenerFunc: (card: ScannedCard) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'cardError', listenerFunc: (err: { code: CardNfcErrorCode; message: string }) => void): Promise<PluginListenerHandle>;
}

const CardNfc = registerPlugin<CardNfcPlugin>('CardNfc');

const isAndroid = () => Capacitor.getPlatform() === 'android';

export const getNfcAvailability = async (): Promise<{ supported: boolean; enabled: boolean }> => {
  if (!isAndroid()) return { supported: false, enabled: false };
  try {
    return await CardNfc.isAvailable();
  } catch {
    return { supported: false, enabled: false };
  }
};

export const CARD_NFC_ERROR_TEXT: Record<CardNfcErrorCode, string> = {
  NOT_EMV: "That doesn't look like a payment card. Try another card.",
  TAG_LOST: 'Card moved away too soon. Hold it still against the phone.',
  READ_FAILED: "Couldn't read this card. Try again, or enter the details by hand.",
};

/**
 * Listens until stopped. Errors are reported but don't end the scan: the usual one is the card
 * pulled away mid-read, and the fix is to tap again, not to reopen the sheet.
 *
 * Rejects (with code 'DISABLED' or 'UNSUPPORTED') if reader mode can't start. Returns the stop
 * function, which is safe to call more than once.
 */
export const startCardScan = async (
  onCard: (card: ScannedCard) => void,
  onError: (code: CardNfcErrorCode) => void,
): Promise<() => void> => {
  const handles = await Promise.all([
    CardNfc.addListener('cardRead', onCard),
    CardNfc.addListener('cardError', e => onError(e.code)),
  ]);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    handles.forEach(h => h.remove());
    CardNfc.stopScan().catch(() => {});
  };
  try {
    await CardNfc.startScan();
  } catch (e) {
    stop();
    throw e;
  }
  return stop;
};
