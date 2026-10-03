import { describe, it, expect } from 'vitest';
import { computeSplitNetBalances, simplifyDebts, splitPayments, describeSplitPayers, splitDisplayName } from '../utils';
import { minifyPayload, expandPayload } from './backupCodec';
import type { SplitItem } from '../types';

const ten = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const item = (over: Partial<SplitItem>): SplitItem => ({
  id: 'x', transactionId: '', amount: 1000, description: 'Dinner',
  involvedPeople: ten, includeMe: true, splitType: 'equal', ...over,
});

describe('a split item with more than one payer', () => {
  it('credits each payer with what they put in, and charges everyone their share', () => {
    // 10 people, ₹1,000, A paid ₹400 and B ₹600 — everyone's share is ₹100.
    const net = computeSplitNetBalances([item({ paidBy: 'B', paidAmounts: { A: 400, B: 600 } })]);
    expect(net.A).toBe(300);
    expect(net.B).toBe(500);
    ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'me'].forEach(p => expect(net[p]).toBe(-100));
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
  });

  it('settles to the two payers and no one else', () => {
    const settlements = simplifyDebts(computeSplitNetBalances([item({ paidBy: 'B', paidAmounts: { A: 400, B: 600 } })]));
    expect(settlements).toHaveLength(8);
    const received = (p: string) => settlements.filter(s => s.to === p).reduce((a, s) => a + s.amount, 0);
    expect(received('A')).toBeCloseTo(300, 2);
    expect(received('B')).toBeCloseTo(500, 2);
  });

  it('can include a payer who is not splitting the bill', () => {
    // "me" covered ₹500 of a meal I didn't eat; A covered the rest and ate with B.
    const net = computeSplitNetBalances([item({ amount: 1000, involvedPeople: ['A', 'B'], includeMe: false, paidAmounts: { me: 500, A: 500 } })]);
    expect(net).toEqual({ me: 500, A: 0, B: -500 });
  });
});

describe('items written before multiple payers existed', () => {
  it('still treat paidBy as having paid the whole bill', () => {
    expect(splitPayments(item({ paidBy: 'C' }))).toEqual({ C: 1000 });
    expect(splitPayments(item({}))).toEqual({ me: 1000 });
    expect(computeSplitNetBalances([item({ paidBy: 'C' })]).C).toBe(900);
  });
});

describe('the payer label', () => {
  it('is just the name for one payer', () => {
    expect(describeSplitPayers(item({ paidBy: 'me' }), k => splitDisplayName(k))).toBe('Me');
  });

  it('lists each payer with their amount for several', () => {
    expect(describeSplitPayers(item({ paidAmounts: { A: 400, me: 600 } }), k => splitDisplayName(k, 'Tribhuvan')))
      .toBe('A ₹400.00 + Tribhuvan ₹600.00');
  });
});

describe('backups', () => {
  it('round-trip paidAmounts', () => {
    const it0 = item({ paidBy: 'B', paidAmounts: { A: 400, B: 600 } });
    const packed = minifyPayload(it0);
    expect(packed.pam).toEqual({ A: 400, B: 600 });
    expect(expandPayload(packed)).toEqual(it0);
  });

  it('leave friend names alone even when they look like a short code', () => {
    // "A", "S", "T"... are all KEY_MAP codes. As keys of a name-keyed map they are people.
    const it0 = item({ splitType: 'unequal', involvedPeople: ['A', 'S'], shares: { A: 500, S: 500 }, paidAmounts: { T: 1000 } });
    expect(expandPayload(minifyPayload(it0))).toEqual(it0);
  });
});
