import { describe, it, expect } from 'vitest';
import { resolveCardIssuer, resolveIssuerMark, issuerMarkOf } from '../utils';
import { minifyPayload, expandPayload } from './backupCodec';
import type { Account } from '../types';

const canara: Account = { id: 'canara', name: 'Canara', type: 'bank_account', openingBalances: {} };
const hdfc: Account = { id: 'hdfc', name: 'HDFC Savings', type: 'bank_account', openingBalances: {} };
const debit = (over: Partial<Account>): Account => ({
  id: 'card', name: 'Debit', type: 'debit_card', openingBalances: {}, ...over,
});

describe('issuer marks', () => {
  it('prints a typed bank name when the bank has no logo', () => {
    expect(resolveIssuerMark('Salary Card', { issuerName: ' Canara Bank ' })).toEqual({ name: 'Canara Bank' });
  });

  it('lets a typed name override what the card name would detect', () => {
    expect(resolveCardIssuer('HDFC Debit', { issuerName: 'Canara Bank' })).toBeUndefined();
    expect(resolveIssuerMark('HDFC Debit', { issuerName: 'Canara Bank' })).toEqual({ name: 'Canara Bank' });
  });

  it('prefers a chosen logo over a typed name', () => {
    expect(resolveIssuerMark('Debit', { issuer: 'sbi', issuerName: 'Canara Bank' })).toEqual({ brand: 'sbi' });
  });

  it('takes the issuer from the linked bank', () => {
    const accounts = [canara, hdfc];
    expect(issuerMarkOf(debit({ linkedBankAccountId: 'hdfc' }), accounts)).toEqual({ brand: 'hdfc' });
    expect(issuerMarkOf(debit({ linkedBankAccountId: 'canara' }), accounts)).toEqual({ name: 'Canara' });
    expect(issuerMarkOf(debit({ name: 'Axis Debit', linkedBankAccountId: 'canara' }), accounts)).toEqual({ brand: 'axis' });
    expect(issuerMarkOf(debit({}), accounts)).toBeUndefined();
  });

  it('round-trips a typed issuer name through a backup', () => {
    const payload = { accounts: [debit({ cardDetails: { issuerName: 'Canara Bank' } })] };
    expect(expandPayload(minifyPayload(payload))).toEqual(payload);
  });
});
