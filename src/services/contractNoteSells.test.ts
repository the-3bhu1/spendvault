import { describe, it, expect } from 'vitest';
import { allocateCharges, planContractNoteSells, type ParsedContractNote, type NoteTradeLeg } from './ContractNoteService';
import type { Account, Transaction } from '../types';

const note = (over: Partial<ParsedContractNote>): ParsedContractNote => ({
  rows: [], brokerage: 0, exchangeCharges: 0, gst: 0, stt: 0, stampDuty: 0,
  sebiFees: 0, ipft: 0, other: 0, netAmount: 0, ...over,
});

describe('allocateCharges', () => {
  it('keeps sell rows, separate from a buy of the same stock', () => {
    const { trades } = allocateCharges(note({
      rows: [
        { name: 'IRB', isin: 'INE821I01022', side: 'sell', quantity: 10, tradeValueBeforeCharges: 600 },
        { name: 'IRB', isin: 'INE821I01022', side: 'buy', quantity: 5, tradeValueBeforeCharges: 300 },
      ],
    }));
    expect(trades.map(t => [t.side, t.quantity, t.tradeValue])).toEqual([['buy', 5, 300], ['sell', 10, 600]]);
  });

  it('splits pooled charges across buys and sells and reconciles against the net', () => {
    const { trades, reconciliationWarning } = allocateCharges(note({
      rows: [
        { name: 'HCC', side: 'buy', quantity: 100, tradeValueBeforeCharges: 3000 },
        { name: 'IRB', side: 'sell', quantity: 10, tradeValueBeforeCharges: 1000 },
      ],
      brokerage: 40, stt: 4,
      netAmount: 3000 + 20 + 3 - (1000 - 20 - 1),
    }));
    expect(trades.find(t => t.side === 'buy')!.brokerageTaxes).toBe(23);
    expect(trades.find(t => t.side === 'sell')!.brokerageTaxes).toBe(21);
    expect(reconciliationWarning).toBeUndefined();
  });

  it('warns when the net amount does not reconcile', () => {
    const { reconciliationWarning } = allocateCharges(note({
      rows: [{ name: 'IRB', side: 'sell', quantity: 10, tradeValueBeforeCharges: 1000 }],
      netAmount: 500,
    }));
    expect(reconciliationWarning).toBeDefined();
  });
});

const sag: Account = {
  id: 'sag', name: 'Sagility', type: 'stocks', openingBalances: {},
  numberOfShares: 30, investedValue: 1500,
} as Account;

const sell = (over: Partial<NoteTradeLeg>): NoteTradeLeg => ({
  rowId: 's', side: 'sell', accountId: 'sag', quantity: 10, tradeValue: 600, charges: 5, ...over,
});

describe('planContractNoteSells', () => {
  const noTx: Transaction[] = [];

  it('prices the units sold at average cost', () => {
    const plan = planContractNoteSells([sell({})], [sag], noTx, '2026-10-20').get('s');
    expect(plan).toEqual({ ok: true, held: 30, costBasis: 500, proceeds: 595, realizedPnl: 95 });
  });

  it('counts a buy on the same note towards what can be sold', () => {
    const plans = planContractNoteSells([
      { rowId: 'b', side: 'buy', accountId: 'sag', quantity: 10, tradeValue: 700, charges: 3 },
      sell({ quantity: 40 }),
    ], [sag], noTx, '2026-10-20');
    expect(plans.get('s')).toMatchObject({ ok: true, held: 40, costBasis: 2200 });
  });

  it('takes two sells from the same holding in turn', () => {
    const plans = planContractNoteSells([
      sell({ rowId: 's1', quantity: 20 }),
      sell({ rowId: 's2', quantity: 20 }),
    ], [sag], noTx, '2026-10-20');
    expect(plans.get('s1')).toMatchObject({ ok: true });
    expect(plans.get('s2')).toEqual({ ok: false, held: 10, error: 'Only 10 held on this date.' });
  });

  it('needs a holding and a quantity', () => {
    const plans = planContractNoteSells([
      sell({ rowId: 'a', accountId: '' }),
      sell({ rowId: 'q', quantity: 0 }),
    ], [sag], noTx, '2026-10-20');
    expect(plans.get('a')).toMatchObject({ ok: false });
    expect(plans.get('q')).toMatchObject({ ok: false, held: 30 });
  });
});
