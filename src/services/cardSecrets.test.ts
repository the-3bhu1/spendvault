import { describe, it, expect } from 'vitest';
import { sealAccounts, openAccounts, stripCardSecrets } from './cardSecrets';
import type { Account } from '../types';

const card = (cardDetails: Account['cardDetails'], id = 'c1'): Account => ({
  id, name: 'HDFC Swiggy', type: 'credit_card', openingBalances: {}, cardDetails,
} as Account);

describe('CVVs at the storage boundary', () => {
  it('stores the ciphertext, never the CVV', () => {
    const { accounts, missing } = sealAccounts([card({ network: 'visa', cvv: '123' })], new Map([['123', 'a1:xyz']]));
    expect(missing).toEqual([]);
    expect(accounts[0].cardDetails).toEqual({ network: 'visa', cvvEnc: 'a1:xyz' });
    expect(JSON.stringify(accounts)).not.toContain('123');
  });

  it('asks for CVVs it has no ciphertext for, and leaves them out meanwhile', () => {
    const { accounts, missing } = sealAccounts([card({ cvv: '123' }), card({ cvv: '123' }, 'c2'), card({ cvv: '4567' }, 'c3')], new Map());
    expect(missing).toEqual(['123', '4567']);
    expect(accounts.every(a => !a.cardDetails?.cvv && !a.cardDetails?.cvvEnc)).toBe(true);
  });

  it('keeps a ciphertext not yet opened this launch, and replaces a stale one', () => {
    const sealed = new Map([['999', 'a1:new']]);
    const { accounts } = sealAccounts([card({ cvvEnc: 'a1:untouched' }), card({ cvv: '999', cvvEnc: 'a1:old' }, 'c2')], sealed);
    expect(accounts[0].cardDetails).toEqual({ cvvEnc: 'a1:untouched' });
    expect(accounts[1].cardDetails).toEqual({ cvvEnc: 'a1:new' });
  });

  it('leaves accounts without card secrets as they are', () => {
    const plain = [card(undefined), card({ network: 'visa', issuer: 'hdfc' }, 'c2')];
    expect(sealAccounts(plain, new Map()).accounts).toEqual(plain);
  });

  it('stores name, number and expiry as one ciphertext beside the CVV', () => {
    const packed = JSON.stringify({ cardholderName: 'TRIBHUVAN K', cardNumber: '4111222233334444', expiryMonth: 1, expiryYear: 30 });
    const sealed = new Map([['123', 'a1:cvv'], [packed, 'a1:details']]);
    const { accounts, missing } = sealAccounts([card({ cardholderName: 'TRIBHUVAN K', cardNumber: '4111222233334444', expiryMonth: 1, expiryYear: 30, cvv: '123', network: 'visa' })], sealed);
    expect(missing).toEqual([]);
    expect(accounts[0].cardDetails).toEqual({ network: 'visa', cvvEnc: 'a1:cvv', detailsEnc: 'a1:details' });
    expect(JSON.stringify(accounts)).not.toContain('4111');
  });

  it('keeps details in the clear until they are sealed, rather than lose them', () => {
    const { accounts, missing } = sealAccounts([card({ cardNumber: '4111', cvv: '123' })], new Map());
    expect(missing).toEqual(['123', JSON.stringify({ cardNumber: '4111' })]);
    expect(accounts[0].cardDetails).toEqual({ cardNumber: '4111' });
  });

  it('opens sealed details back on launch, and keeps them sealed when unreadable', () => {
    const packed = JSON.stringify({ cardNumber: '4111', expiryMonth: 1, expiryYear: 30 });
    const opened = new Map<string, string | null>([['a1:details', packed], ['w1:elsewhere', null]]);
    const out = openAccounts([card({ detailsEnc: 'a1:details', network: 'rupay' }), card({ detailsEnc: 'w1:elsewhere' }, 'c2')], opened);
    expect(out[0].cardDetails).toEqual({ cardNumber: '4111', expiryMonth: 1, expiryYear: 30, network: 'rupay' });
    expect(out[1].cardDetails).toEqual({ detailsEnc: 'w1:elsewhere' });
  });

  it('re-saving opened details reuses their ciphertext', () => {
    const packed = JSON.stringify({ cardNumber: '4111' });
    const sealed = new Map([[packed, 'a1:details']]);
    const back = openAccounts([card({ detailsEnc: 'a1:details' })], new Map([['a1:details', packed]]));
    const { accounts, missing } = sealAccounts(back, sealed);
    expect(missing).toEqual([]);
    expect(accounts[0].cardDetails).toEqual({ detailsEnc: 'a1:details' });
  });

  it('opens ciphertexts back into CVVs on launch, keeping the unreadable sealed', () => {
    const opened = new Map<string, string | null>([['a1:ok', '321'], ['a1:other-phone', null]]);
    const out = openAccounts([card({ cvvEnc: 'a1:ok' }), card({ cardNumber: '4111', cvvEnc: 'a1:other-phone' }, 'c2')], opened);
    expect(out[0].cardDetails).toEqual({ cvv: '321' });
    expect(out[1].cardDetails).toEqual({ cardNumber: '4111', cvvEnc: 'a1:other-phone' });
  });

  it('a kept unreadable ciphertext survives the next save, and a re-typed CVV replaces it', () => {
    const kept = openAccounts([card({ cvvEnc: 'w1:other-browser' })], new Map([['w1:other-browser', null]]));
    expect(sealAccounts(kept, new Map()).accounts[0].cardDetails).toEqual({ cvvEnc: 'w1:other-browser' });
    const retyped = [{ ...kept[0], cardDetails: { ...kept[0].cardDetails, cvv: '456' } }];
    expect(sealAccounts(retyped, new Map([['456', 'a1:fresh']])).accounts[0].cardDetails).toEqual({ cvvEnc: 'a1:fresh' });
  });

  it('round-trips: seal then open gives back the CVV', () => {
    const sealed = new Map([['123', 'a1:xyz']]);
    const stored = sealAccounts([card({ cvv: '123', network: 'visa' })], sealed).accounts;
    const back = openAccounts(stored, new Map([['a1:xyz', '123']]));
    expect(back[0].cardDetails).toEqual({ cvv: '123', network: 'visa' });
  });
});

describe('CVVs in a backup', () => {
  it('carries neither the CVV nor any ciphertext, but keeps the opened details', () => {
    const out = stripCardSecrets([card({ cardNumber: '4111', cvv: '123' }), card({ cvvEnc: 'a1:xyz', detailsEnc: 'a1:d' }, 'c2'), card(undefined, 'c3')]);
    expect(out[0].cardDetails).toEqual({ cardNumber: '4111' });
    expect(out[1].cardDetails).toEqual({});
    expect(out[2].cardDetails).toBeUndefined();
  });
});
