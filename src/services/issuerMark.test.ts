import { describe, it, expect } from 'vitest';
import { resolveCardIssuer, resolveIssuerMark, issuerMarkOf } from '../utils';
import { minifyPayload, expandPayload } from './backupCodec';
import type { Account } from '../types';

const saraswat: Account = { id: 'saraswat', name: 'Saraswat', type: 'bank_account', openingBalances: {} };
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
    const accounts = [saraswat, hdfc];
    expect(issuerMarkOf(debit({ linkedBankAccountId: 'hdfc' }), accounts)).toEqual({ brand: 'hdfc' });
    expect(issuerMarkOf(debit({ linkedBankAccountId: 'saraswat' }), accounts)).toEqual({ name: 'Saraswat' });
    expect(issuerMarkOf(debit({ name: 'Axis Debit', linkedBankAccountId: 'saraswat' }), accounts)).toEqual({ brand: 'axis' });
    expect(issuerMarkOf(debit({}), accounts)).toBeUndefined();
  });

  it.each([
    ['Kotak 811 Debit', 'kotak'],
    ['Amex Platinum Travel', 'amex'],
    ['American Express Gold', 'amex'],
    ['BOBCARD Eterna', 'bob'],
    ['Bank of Baroda Savings', 'bob'],
    ['RBL Shoprite', 'rbl'],
    ['Yes Bank Marquee', 'yes'],
    ['AU Bank LIT', 'au'],
    ['AU Small Finance Savings', 'au'],
    ['HSBC Live+', 'hsbc'],
    ['StanChart Smart', 'scb'],
    ['Standard Chartered Ultimate', 'scb'],
    ['PNB RuPay Select', 'pnb'],
    ['Punjab National Bank Salary', 'pnb'],
    ['Canara Bank Savings', 'canara'],
    ['Union Bank of India Debit', 'ubi'],
    ['Bank of India Savings', 'boi'],
    ['BOI Debit', 'boi'],
    ['Indian Bank Savings', 'indianbank'],
    ['IDBI Royale', 'idbi'],
  ] as const)('detects the bank in %s', (name, brand) => {
    expect(resolveCardIssuer(name)).toBe(brand);
  });

  it.each([
    'South Indian Bank Savings',
    'Central Bank of India Savings',
    'Marble Fund',
    'Yes Card',
    'Bob Personal',
    'Tableau Bank',
  ])('leaves %s without a logo', name => {
    expect(resolveCardIssuer(name)).toBeUndefined();
  });

  it('round-trips a typed issuer name through a backup', () => {
    const payload = { accounts: [debit({ cardDetails: { issuerName: 'Canara Bank' } })] };
    expect(expandPayload(minifyPayload(payload))).toEqual(payload);
  });
});
