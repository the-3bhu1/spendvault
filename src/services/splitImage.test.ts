import { describe, it, expect } from 'vitest';
import { namesOrEveryone } from './splitImage';

/* Who an expense was split among, as the shared image prints it. Pure, and the mistake it can make
   is a quiet one: labelling a subset "Everyone" understates who owes, on the very image being sent
   to the people it names. */
describe('naming who an expense was split among', () => {
  const TRIP = ['Skanda', 'Kundan', 'Tribhuvan'];

  it('says Everyone when the expense covers the whole event', () => {
    expect(namesOrEveryone(['Skanda', 'Kundan', 'Tribhuvan'], TRIP)).toBe('Everyone');
  });

  it('does not care what order the names arrive in', () => {
    expect(namesOrEveryone(['Tribhuvan', 'Skanda', 'Kundan'], TRIP)).toBe('Everyone');
  });

  it('names a subset instead', () => {
    expect(namesOrEveryone(['Skanda', 'Tribhuvan'], TRIP)).toBe('Skanda, Tribhuvan');
  });

  it('is a set test, not a headcount', () => {
    // Three people, but not the three on the trip. The count matches and the roster does not, which
    // is the case most worth not mislabelling.
    expect(namesOrEveryone(['Skanda', 'Kundan', 'Ravi'], TRIP)).toBe('Skanda, Kundan, Ravi');
  });

  it('will not say Everyone about a duplicate that pads the count', () => {
    expect(namesOrEveryone(['Skanda', 'Skanda', 'Kundan'], TRIP)).toBe('Skanda, Skanda, Kundan');
  });

  it('applies to a two-person event too', () => {
    expect(namesOrEveryone(['Skanda', 'Tribhuvan'], ['Skanda', 'Tribhuvan'])).toBe('Everyone');
  });

  it('leaves a one-person roster alone — there is nobody for Everyone to include', () => {
    expect(namesOrEveryone(['Tribhuvan'], ['Tribhuvan'])).toBe('Tribhuvan');
  });

  it('falls back to names when the roster is unknown', () => {
    expect(namesOrEveryone(['Skanda', 'Kundan'], undefined)).toBe('Skanda, Kundan');
    expect(namesOrEveryone(['Skanda', 'Kundan'], [])).toBe('Skanda, Kundan');
  });
});
