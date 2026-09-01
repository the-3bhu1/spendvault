import { registerPlugin } from '@capacitor/core';

export interface SmsTransaction {
  amount: number;
  type: 'debit' | 'credit' | 'unknown';
  merchant: string | null;
  source: string;
  sourceIdentifier?: string; // e.g. "2355"
  timestamp: number;
  raw: string;
}

export interface SmsReaderPlugin {
  checkPermissions(): Promise<{ sms: string; notifications: string }>;
  requestPermissions(options?: { permissions: string[] }): Promise<{ sms: string; notifications: string }>;
  addListener(eventName: 'onTransaction', listenerFunc: (transaction: SmsTransaction) => void): Promise<any>;
  ping(): Promise<void>;
  setEnabled(options: { enabled: boolean }): Promise<void>;
  drainPendingTransactions(): Promise<{ transactions: SmsTransaction[] }>;
  checkLaunchIntent(): Promise<{ openPending: boolean }>;
}

const SmsReader = registerPlugin<SmsReaderPlugin>('SmsReader');

export default SmsReader;
