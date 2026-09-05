import { describe, it, expect } from 'vitest';
import { shareSelfName, splitDisplayName } from '../utils';

/* What the user is called in a summary that leaves the device. Worth its own tests because the
   failure mode is silent and lands in someone else's group chat: nothing throws, the image just
   goes out naming the sender something nobody recognises. */
describe('the name a shared summary calls you', () => {
  it('uses the first name, not the whole one', () => {
    // Everyone else in a split is down as the one name their friends use. A full legal name among
    // them reads as a different kind of entry.
    expect(shareSelfName('Tribhuvan Komarla')).toBe('Tribhuvan');
  });

  it('leaves a single-word name alone', () => {
    expect(shareSelfName('Tribhuvan')).toBe('Tribhuvan');
  });

  it('takes only the first of several names', () => {
    expect(shareSelfName('Anand Kumar Reddy Gari')).toBe('Anand');
  });

  it('is not confused by stray whitespace', () => {
    expect(shareSelfName('   Tribhuvan   Komarla  ')).toBe('Tribhuvan');
  });

  it('keeps the whole name when it opens with an initial', () => {
    // "K" is no better than the "Me" this exists to replace, so the full string wins.
    expect(shareSelfName('K S Tribhuvan')).toBe('K S Tribhuvan');
    expect(shareSelfName('K. S. Tribhuvan')).toBe('K. S. Tribhuvan');
  });

  it('treats a non-Latin initial the same way', () => {
    // \p{L}, not [A-Za-z] — the rule is "one letter", in whatever script the name is written.
    expect(shareSelfName('ఎ శ్రీనివాస్')).toBe('ఎ శ్రీనివాస్');
  });

  it('does not mistake a short real name for an initial', () => {
    expect(shareSelfName('Jo Patel')).toBe('Jo');
  });

  it('gives back nothing when there is no name', () => {
    expect(shareSelfName(undefined)).toBe('');
    expect(shareSelfName('')).toBe('');
    expect(shareSelfName('   ')).toBe('');
  });
});

describe('who a split row is about', () => {
  it('falls back to Me when no name is set, rather than to a blank', () => {
    expect(splitDisplayName('me', shareSelfName(undefined))).toBe('Me');
    expect(splitDisplayName('me', shareSelfName('   '))).toBe('Me');
  });

  it('names the user once there is a name to use', () => {
    expect(splitDisplayName('me', shareSelfName('Tribhuvan Komarla'))).toBe('Tribhuvan');
  });

  it('says Me on screen, where no name is passed at all', () => {
    expect(splitDisplayName('me')).toBe('Me');
  });

  it('leaves every other participant untouched', () => {
    expect(splitDisplayName('Balaji', 'Tribhuvan')).toBe('Balaji');
  });
});
