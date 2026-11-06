import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ScannedCard } from './CardNfcService';

export type CardScanErrorCode = 'PERMISSION_DENIED' | 'UNAVAILABLE';

interface CardScanPlugin {
  isAvailable(): Promise<{ supported: boolean }>;
  scan(): Promise<ScannedCard>;
}

const CardScan = registerPlugin<CardScanPlugin>('CardScan');

export const isCardScanAvailable = async (): Promise<boolean> => {
  if (Capacitor.getPlatform() !== 'android') return false;
  try {
    return (await CardScan.isAvailable()).supported;
  } catch {
    return false;
  }
};

export const CARD_SCAN_ERROR_TEXT: Record<CardScanErrorCode, string> = {
  PERMISSION_DENIED: "SpendVault can't use the camera. Allow it in your phone's Settings → Apps → SpendVault → Permissions, then try again.",
  UNAVAILABLE: "Couldn't start the camera. Try again, or enter the details by hand.",
};

export const scanCardWithCamera = async (): Promise<ScannedCard | null> => {
  try {
    return await CardScan.scan();
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'CANCELLED') return null;
    throw Object.assign(new Error('Card scan failed'), {
      code: code === 'PERMISSION_DENIED' ? 'PERMISSION_DENIED' : 'UNAVAILABLE',
    });
  }
};
