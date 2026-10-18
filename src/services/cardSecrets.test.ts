import { describe, it, expect } from 'vitest';
import { sealAccounts, openAccounts, stripCardSecrets } from './cardSecrets';
import type { Account } from '../types';

const card = (cardDetails: Account['cardDetails'], id = 'c1'): Account => ({
  id, name: 'HDFC Swiggy', type: 'credit_card', openingBalances: {}, cardDetails,
} as Account);

describe('CVVs at the storage boundary', () => {
  it('stores the ciphertext, never the CVV', () => {
    const { accounts, missing } = sealAccounts([card({ cardNumber: '4111', cvv: '123' })], new Map([['123', 'a1:xyz']]));
    expect(missing).toEqual([]);
    expect(accounts[0].cardDetails).toEqual({ cardNumber: '4111', cvvEnc: 'a1:xyz' });
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

  it('leaves accounts without a CVV as they are', () => {
    const plain = [card(undefined), card({ cardNumber: '4111' }, 'c2')];
    expect(sealAccounts(plain, new Map()).accounts).toEqual(plain);
  });

  it('opens ciphertexts back into CVVs on launch, dropping the unreadable', () => {
    const opened = new Map<string, string | null>([['a1:ok', '321'], ['a1:other-phone', null]]);
    const out = openAccounts([card({ cvvEnc: 'a1:ok' }), card({ cardNumber: '4111', cvvEnc: 'a1:other-phone' }, 'c2')], opened);
    expect(out[0].cardDetails).toEqual({ cvv: '321' });
    expect(out[1].cardDetails).toEqual({ cardNumber: '4111' });
  });

  it('round-trips: seal then open gives back the CVV', () => {
    const sealed = new Map([['123', 'a1:xyz']]);
    const stored = sealAccounts([card({ cvv: '123', network: 'visa' })], sealed).accounts;
    const back = openAccounts(stored, new Map([['a1:xyz', '123']]));
    expect(back[0].cardDetails).toEqual({ cvv: '123', network: 'visa' });
  });
});

describe('CVVs in a backup', () => {
  it('carries neither the CVV nor its ciphertext', () => {
    const out = stripCardSecrets([card({ cardNumber: '4111', cvv: '123' }), card({ cvvEnc: 'a1:xyz' }, 'c2'), card(undefined, 'c3')]);
    expect(out[0].cardDetails).toEqual({ cardNumber: '4111' });
    expect(out[1].cardDetails).toEqual({});
    expect(out[2].cardDetails).toBeUndefined();
  });
});
