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

export const startSmsListener = async (onReceive: (tx: SmsTransaction) => void) => {
  console.log("Starting SMS listener...");
  
  // Browser safety: Capacitor plugins might not be available in a regular browser
  try {
    // Gap Buffer: Store any live events that arrive while we are draining the persistent queue
    const startupBuffer: SmsTransaction[] = [];
    let isDraining = true;

    const listener = await SmsReader.addListener('onTransaction', (tx) => {
      if (isDraining) {
        console.log("Buffering live SMS transaction during startup:", tx);
        startupBuffer.push(tx);
      } else {
        console.log("New SMS Transaction Detected on JS side:", tx);
        onReceive(tx);
      }
    });

    try {
      const { transactions } = await SmsReader.drainPendingTransactions();
      
      // 1. Process all persistent (oldest) transactions first
      transactions.forEach((tx) => {
        console.log("Delivering persistent queued SMS transaction:", tx);
        onReceive(tx);
      });

      // 2. Process all transactions that arrived while draining
      isDraining = false;
      startupBuffer.forEach((tx) => {
        console.log("Delivering buffered startup SMS transaction:", tx);
        onReceive(tx);
      });
    } catch (queueError) {
      isDraining = false;
      console.error("Failed to drain queued SMS transactions:", queueError);
    }

    return listener;
  } catch (e) {
    console.error("SMS Reader plugin failed to start:", e);
    return Promise.resolve({ remove: () => {} });
  }
};

export default SmsReader;
