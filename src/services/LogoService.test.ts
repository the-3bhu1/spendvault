import { describe, it, expect } from 'vitest';
import { getLiquidLogoUrl, getCardLogoUrl, getAssetLogoUrl } from './LogoService';

describe('LogoService resolution & overrides', () => {
  it('resolves State Bank of India to SBI vector badge and NOT Bank of India', () => {
    const sbiFullName = getLiquidLogoUrl({ type: 'bank_account', name: 'State Bank of India' });
    const sbiShort = getLiquidLogoUrl({ type: 'bank_account', name: 'SBI' });
    const boi = getLiquidLogoUrl({ type: 'bank_account', name: 'Bank of India' });

    expect(sbiFullName).not.toBeNull();
    expect(sbiShort).not.toBeNull();
    // Both resolve to the high-res SVG data URL
    expect(sbiFullName).toBe(sbiShort);
    expect(sbiFullName).toContain('data:image/svg+xml;base64,');

    // Bank of India must still resolve to its own domain and NOT SBI
    expect(boi).not.toBe(sbiFullName);
    expect(boi).toContain('bankofindia.co.in');
  });

  it('resolves Cheq Chips to the official CheQ fintech vector mark', () => {
    const cheqChips = getLiquidLogoUrl({ type: 'rewards', name: 'Cheq Chips' });
    const cheq = getLiquidLogoUrl({ type: 'rewards', name: 'Cheq' });

    expect(cheqChips).not.toBeNull();
    expect(cheqChips).toBe(cheq);
    expect(cheqChips).toContain('data:image/svg+xml;base64,');
  });

  it('resolves co-branded cards to co-brand marks', () => {
    const swiggy = getCardLogoUrl({ type: 'credit_card', name: 'Swiggy x HDFC' });
    const supermoney = getCardLogoUrl({ type: 'credit_card', name: 'Supermoney x AXIS' });
    const jupiter = getCardLogoUrl({ type: 'credit_card', name: 'Jupiter x CSB' });

    expect(swiggy).toContain('swiggy.com');
    expect(supermoney).toContain('super.money');
    expect(jupiter).toContain('jupiter.money');
  });

  it('resolves stock holdings for SBIN and OLAELEC to sharp vector marks', () => {
    const sbin = getAssetLogoUrl({ type: 'stocks', name: 'State Bank of India', marketSymbol: 'SBIN' });
    const ola = getAssetLogoUrl({ type: 'stocks', name: 'Ola Electric', marketSymbol: 'OLAELEC' });

    expect(sbin).toContain('data:image/svg+xml;base64,');
    expect(ola).toContain('data:image/svg+xml;base64,');
  });

  it('resolves NIFTY 500 holdings from the built-in table without a Gemini lookup', () => {
    expect(getAssetLogoUrl({ type: 'stocks', name: 'Sagility', marketSymbol: 'SAGILITY.NS' })).toContain('sagility.com');
    expect(getAssetLogoUrl({ type: 'stocks', name: 'Varun Beverages', marketSymbol: 'VBL.NS' })).toContain('varunbeverages.com');
    expect(getAssetLogoUrl({ type: 'stocks', name: '360 ONE WAM', marketSymbol: '360ONE.NS' })).toContain('360.one');
  });

  it('normalizes & and - in symbols to match the table', () => {
    expect(getAssetLogoUrl({ type: 'stocks', name: 'Mahindra & Mahindra', marketSymbol: 'M&M.NS' })).toContain('mahindra.com');
    expect(getAssetLogoUrl({ type: 'stocks', name: 'Bajaj Auto', marketSymbol: 'BAJAJ-AUTO.NS' })).toContain('bajajauto.com');
    expect(getAssetLogoUrl({ type: 'stocks', name: 'J&K Bank', marketSymbol: 'J&KBANK.BO' })).toContain('jkbank.com');
  });

  it('keeps hand-tuned overrides and pre-rename symbols', () => {
    expect(getAssetLogoUrl({ type: 'stocks', name: 'NMDC Steel', marketSymbol: 'NSLNISP.NS' })).toContain('nmdc.co.in');
    expect(getAssetLogoUrl({ type: 'stocks', name: 'Zomato', marketSymbol: 'ZOMATO.NS' })).toContain('zomato.com');
    expect(getAssetLogoUrl({ type: 'stocks', name: 'Tata Motors', marketSymbol: 'TATAMOTORS.NS' })).toContain('tatamotors.com');
  });

  it('honors customLogoUrl override over any auto-detected brand', () => {
    const overriddenBank = getLiquidLogoUrl({
      type: 'bank_account',
      name: 'State Bank of India',
      customLogoUrl: 'https://example.com/custom-sbi.png',
    });
    expect(overriddenBank).toBe('https://example.com/custom-sbi.png');

    const domainOverride = getLiquidLogoUrl({
      type: 'rewards',
      name: 'Cheq Chips',
      customLogoUrl: 'cheq.one',
    });
    expect(domainOverride).toContain('cheq.one');

    const cardOverride = getCardLogoUrl({
      type: 'credit_card',
      name: 'Swiggy x HDFC',
      customLogoUrl: 'hdfcbank.com',
    });
    expect(cardOverride).toContain('hdfcbank.com');

    const assetOverride = getAssetLogoUrl({
      type: 'stocks',
      name: 'Ola Electric',
      marketSymbol: 'OLAELEC',
      customLogoUrl: 'data:image/svg+xml;base64,customdata',
    });
    expect(assetOverride).toBe('data:image/svg+xml;base64,customdata');
  });
});
