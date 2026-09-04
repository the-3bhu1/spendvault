// The day-ordering helpers in `utils` — the invariant that drag-reorder rests on.
//
// Each day's `order` is a gap-free, duplicate-free 0..N-1 run, and a linked group's legs have to sit
// on ADJACENT indices within it. The bug these were written for came from the second rule: an edit
// that gave a row a new leg appended that leg at `maxOrder + 1` while the parent kept the order it
// had always had, and the drag then measured the group as "first leg to last leg" — so one drag on a
// day with a scattered pair picked up every unrelated row lying between the two and moved it too.
//
// The other half is reordering under a filter. `sortedTxs` in the transactions list is the FILTERED
// view, and the old code renumbered it 0..N-1, stamping those values onto rows a filter was hiding.
// applyVisibleReorder is the fix, and the case worth reading first is 'reordering with a filter on'.
import { describe, it, expect } from 'vitest';
import {
  linkedIdsOf, linkedGroupOf, compactLinkedGroups, sortDayByOrder,
  applyVisibleReorder, dayOrderUpdates, insertIntoDay,
} from '../utils';
import type { Transaction } from '../types';

/** A row, identified by `id`, sitting at `order` on a single shared date. */
const row = (id: string, order: number, links?: string[], over: Partial<Transaction> = {}): Transaction => ({
  id, date: '2026-08-28', description: id, accountId: 'bank1',
  type: 'debit', amount: 100, category: 'Food', isRecurring: false,
  order, ...(links ? { linkedTransactionIds: links } : {}), ...over,
});

const ids = (txs: Transaction[]) => txs.map(t => t.id);

describe('linkedIdsOf', () => {
  it('reads the current list and the legacy single-id field alike', () => {
    expect(linkedIdsOf(row('a', 0, ['b', 'c']))).toEqual(['b', 'c']);
    expect(linkedIdsOf({ ...row('a', 0), linkedTransactionId: 'b' })).toEqual(['b']);
    expect(linkedIdsOf(row('a', 0))).toEqual([]);
  });
});

describe('linkedGroupOf', () => {
  it('finds a plain two-leg pair from either end', () => {
    const day = [row('parent', 0, ['leg']), row('leg', 1, ['parent'])];
    expect(ids(linkedGroupOf(day[0], day))).toEqual(['parent', 'leg']);
    expect(ids(linkedGroupOf(day[1], day))).toEqual(['parent', 'leg']);
  });

  it('reaches a sibling leg through the shared parent (star topology)', () => {
    // Children link to the parent, never to each other. Asked from one child, a
    // 1-hop walk would return just that child and the parent, and the group would
    // render — and drag — a leg short.
    const day = [row('legA', 0, ['parent']), row('legB', 1, ['parent']), row('parent', 2, ['legA', 'legB'])];
    expect(ids(linkedGroupOf(day[0], day))).toEqual(['legA', 'legB', 'parent']);
  });

  it('is a singleton for an unlinked row', () => {
    const day = [row('a', 0), row('b', 1, ['c']), row('c', 2, ['b'])];
    expect(ids(linkedGroupOf(day[0], day))).toEqual(['a']);
  });

  it('ignores ids that resolve to nothing in the pool', () => {
    // A ref to a debt ledger entry is a legitimate cross-reference into another
    // collection, and a ref left behind by a deleted row resolves to nothing
    // either. Both must contribute no member rather than corrupt the group.
    const day = [row('a', 0, ['debt-entry-id', 'deleted-row-id'])];
    expect(ids(linkedGroupOf(day[0], day))).toEqual(['a']);
  });
});

describe('compactLinkedGroups', () => {
  it('leaves an already-contiguous day untouched, by identity', () => {
    const day = [row('a', 0), row('p', 1, ['l']), row('l', 2, ['p']), row('b', 3)];
    expect(compactLinkedGroups(day)).toBe(day);
  });

  it('pulls a scattered pair together at the first leg, shifting the rest down', () => {
    // The real 2026-08-28 shape: an "Instant Cashback" leg on order 0 and the
    // "Metro to PG" purchase it belongs to on order 6, five unrelated rows apart.
    const day = [
      row('cashback', 0, ['metro']),
      row('x1', 1), row('x2', 2), row('x3', 3), row('x4', 4), row('x5', 5),
      row('metro', 6, ['cashback']),
    ];
    expect(ids(compactLinkedGroups(day))).toEqual(['cashback', 'metro', 'x1', 'x2', 'x3', 'x4', 'x5']);
  });

  it('keeps a three-leg group together', () => {
    const day = [row('legA', 0, ['p']), row('x', 1), row('p', 2, ['legA', 'legB']), row('legB', 3, ['p'])];
    expect(ids(compactLinkedGroups(day))).toEqual(['legA', 'p', 'legB', 'x']);
  });
});

describe('sortDayByOrder', () => {
  it('sorts by stored order', () => {
    expect(ids(sortDayByOrder([row('c', 2), row('a', 0), row('b', 1)]))).toEqual(['a', 'b', 'c']);
  });

  it('falls back to array position for a legacy row with no order', () => {
    const legacy = { ...row('n', 0), order: undefined };
    expect(ids(sortDayByOrder([legacy, row('a', 1)]))).toEqual(['n', 'a']);
  });
});

describe('applyVisibleReorder', () => {
  it('reordering with a filter on moves only the visible rows', () => {
    // A ten-row day; a filter leaves the rows on orders 3, 5 and 7 showing. Drag
    // the second above the first and those two SWAP the slots they already held:
    // orders 3 and 5 exchange, 7 stays, and every hidden row keeps its position.
    //
    // The renumber this replaced wrote 0, 1, 2 onto the three visible rows, which
    // collided head-on with the hidden rows already holding 0, 1 and 2 — and the
    // day only looked scrambled once the filter came off.
    const day = Array.from({ length: 10 }, (_, i) => row(`r${i}`, i));
    const visible = [day[3], day[5], day[7]];
    const newVisible = [day[5], day[3], day[7]];

    const next = applyVisibleReorder(day, newVisible);

    expect(ids(next)).toEqual(['r0', 'r1', 'r2', 'r5', 'r4', 'r3', 'r6', 'r7', 'r8', 'r9']);
    // Only the two dragged rows changed order; nothing hidden was written at all.
    expect(dayOrderUpdates(next).map(t => [t.id, t.order])).toEqual([['r5', 3], ['r3', 5]]);
    expect(visible).toHaveLength(3); // (the visible set itself is never mutated)
  });

  it('keeps the day a clean 0..N-1 run, whatever the visible subset', () => {
    const day = Array.from({ length: 10 }, (_, i) => row(`r${i}`, i));
    const next = applyVisibleReorder(day, [day[7], day[3], day[5]]);
    expect(dayOrderUpdates(next).every(t => t.order !== undefined)).toBe(true);
    expect(next.map((_, i) => i)).toEqual([...Array(10).keys()]);
    expect(new Set(ids(next)).size).toBe(10);
  });

  it('rotates three visible rows rather than only swapping two', () => {
    const day = Array.from({ length: 10 }, (_, i) => row(`r${i}`, i));
    // Visible [r3, r5, r7] dragged to [r7, r3, r5] — a 3-cycle over slots 3/5/7.
    const next = applyVisibleReorder(day, [day[7], day[3], day[5]]);
    expect(ids(next)).toEqual(['r0', 'r1', 'r2', 'r7', 'r4', 'r3', 'r6', 'r5', 'r8', 'r9']);
  });

  it('does not let a redeal drop an unrelated row between two legs', () => {
    // Slots the group lands on need not be adjacent: here a hidden row sits
    // between them afterwards, so the compaction pass has to close it back up.
    const day = [row('h0', 0), row('A1', 1, ['A2']), row('A2', 2, ['A1']), row('h3', 3), row('B', 4)];
    const next = applyVisibleReorder(day, [day[4], day[1], day[2]]);
    const at = (id: string) => ids(next).indexOf(id);
    expect(at('A2')).toBe(at('A1') + 1);
    expect(ids(next)).toEqual(['h0', 'B', 'A1', 'A2', 'h3']);
  });
});

describe('insertIntoDay', () => {
  it('puts a leg created by an EDIT beside its parent, not at the end of the day', () => {
    // The 'Transfer to Amazon Pay Balance' case. Five rows exist; the row on
    // order 1 is edited into a transfer and gains a counterpart. Appending gave
    // that leg order 5 and left the group as {1, 5} — the gap that armed the drag
    // bug. It belongs on order 2, directly behind its parent.
    const day = [row('r0', 0), row('parent', 1), row('r2', 2), row('r3', 3), row('r4', 4)];
    const leg = { ...row('leg', 0, ['parent']), order: undefined };

    const next = insertIntoDay(day, leg);
    const sorted = sortDayByOrder(next);

    expect(ids(sorted)).toEqual(['r0', 'parent', 'leg', 'r2', 'r3', 'r4']);
    expect(sorted.map(t => t.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('lands a second leg after the first, not between parent and leg', () => {
    const day = [row('r0', 0), row('parent', 1, ['legA']), row('legA', 2, ['parent']), row('r3', 3)];
    const legB = { ...row('legB', 0, ['parent']), order: undefined };
    expect(ids(sortDayByOrder(insertIntoDay(day, legB)))).toEqual(['r0', 'parent', 'legA', 'legB', 'r3']);
  });

  it('appends when the parent is not saved yet, so a new log still ends up adjacent', () => {
    // The log form writes legs BEFORE the row they belong to. There is nothing to
    // sit beside, so the leg appends — and the parent appends right behind it.
    const day = [row('r0', 0), row('r1', 1)];
    const leg = { ...row('leg', 0, ['not-saved-yet']), order: undefined };
    const withLeg = insertIntoDay(day, leg);
    expect(ids(sortDayByOrder(withLeg))).toEqual(['r0', 'r1', 'leg']);

    const parent = { ...row('not-saved-yet', 0, ['leg']), order: undefined };
    expect(ids(sortDayByOrder(insertIntoDay(withLeg, parent)))).toEqual(['r0', 'r1', 'leg', 'not-saved-yet']);
  });

  it('appends a plain unlinked row', () => {
    const day = [row('r0', 0), row('r1', 1)];
    const fresh = { ...row('fresh', 0), order: undefined };
    expect(ids(sortDayByOrder(insertIntoDay(day, fresh)))).toEqual(['r0', 'r1', 'fresh']);
  });

  it('honours an explicit order as an insertion index', () => {
    const day = [row('r0', 0), row('r1', 1), row('r2', 2)];
    expect(ids(sortDayByOrder(insertIntoDay(day, row('mid', 1))))).toEqual(['r0', 'mid', 'r1', 'r2']);
  });

  it('leaves other days alone and keeps array positions stable', () => {
    const other = { ...row('other', 0), date: '2026-08-27' };
    const day = [other, row('r0', 0), row('parent', 1)];
    const next = insertIntoDay(day, { ...row('leg', 0, ['parent']), order: undefined });
    expect(next[0]).toBe(other);
    expect(ids(next)).toEqual(['other', 'r0', 'parent', 'leg']);
  });
});
