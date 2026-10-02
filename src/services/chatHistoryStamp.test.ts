import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { upsertSession, getSessions, clearChatHistory } from './ChatHistoryService';

/* WHEN A CONVERSATION LAST HAPPENED, which is the only thing the history list's "3 weeks ago" is
   claiming. The failure it guards is silent and self-inflicted: opening a chat replays its stored
   messages into the same state a new turn is typed into, so the save runs on OPEN as well, and a
   session restamped on open reports the moment you looked at it as the moment you last spoke.
   Nothing throws, the label is just wrong — and wrong in the direction that makes every old chat
   look new. */

/* The service reads and writes one localStorage key and is otherwise pure, so it gets a Map rather
   than a DOM: the rest of this suite runs without one, and a whole jsdom dependency to hold six
   strings would be the tail wagging the dog. Only the four methods the service actually calls. */
const store = new Map<string, string>();
beforeAll(() => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
});

const t = (iso: string) => new Date(iso).getTime();

describe('when a chat session says it was last updated', () => {
  beforeEach(() => {
    clearChatHistory();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('stamps the turn that was actually said', () => {
    vi.setSystemTime(t('2026-09-07T10:00:00Z'));
    upsertSession('s1', [{ role: 'user', text: 'how much did i spend on #WorkTravel this month?' }]);
    expect(getSessions()[0].updatedAt).toBe(t('2026-09-07T10:00:00Z'));
  });

  it('does not move when the same transcript is saved again', () => {
    // Exactly what opening the conversation does: same id, same messages, later clock.
    vi.setSystemTime(t('2026-09-07T10:00:00Z'));
    const said = [
      { role: 'user' as const, text: 'how much did i spend on #WorkTravel this month?' },
      { role: 'model' as const, text: 'You spent ₹12,400 across 7 transactions tagged #WorkTravel.' },
    ];
    upsertSession('s1', said);

    vi.setSystemTime(t('2026-09-26T11:30:00Z')); // 19 days later — the user opens it
    upsertSession('s1', said.map(m => ({ ...m })));

    expect(getSessions()[0].updatedAt).toBe(t('2026-09-07T10:00:00Z'));
  });

  it('moves again as soon as something new is said', () => {
    vi.setSystemTime(t('2026-09-07T10:00:00Z'));
    const said = [{ role: 'user' as const, text: 'what are my dues?' }];
    upsertSession('s1', said);

    vi.setSystemTime(t('2026-09-26T11:30:00Z'));
    upsertSession('s1', [...said, { role: 'model' as const, text: '₹8,600 overdue on Supermoney x AXIS.' }]);

    expect(getSessions()[0].updatedAt).toBe(t('2026-09-26T11:30:00Z'));
  });

  it('keeps a reopened chat in its place in the list', () => {
    // The list is sorted by updatedAt, so restamping did not just mislabel the row — it jumped it
    // to the top over conversations that genuinely were more recent.
    vi.setSystemTime(t('2026-09-01T10:00:00Z'));
    upsertSession('old', [{ role: 'user', text: 'older chat' }]);
    vi.setSystemTime(t('2026-09-20T10:00:00Z'));
    upsertSession('recent', [{ role: 'user', text: 'newer chat' }]);

    vi.setSystemTime(t('2026-09-26T11:30:00Z')); // open the older one
    upsertSession('old', [{ role: 'user', text: 'older chat' }]);

    expect(getSessions().map(s => s.id)).toEqual(['recent', 'old']);
  });

  it('still records the first save of a session it has never seen', () => {
    vi.setSystemTime(t('2026-09-26T11:30:00Z'));
    const list = upsertSession('fresh', [{ role: 'user', text: 'new chat' }]);
    expect(list).toHaveLength(1);
    expect(list[0].createdAt).toBe(t('2026-09-26T11:30:00Z'));
  });

  it('treats a transcript of the same length but different words as a change', () => {
    // A guard that only compared lengths would miss an edited or regenerated reply.
    vi.setSystemTime(t('2026-09-07T10:00:00Z'));
    upsertSession('s1', [{ role: 'user', text: 'what are my dues?' }]);

    vi.setSystemTime(t('2026-09-26T11:30:00Z'));
    upsertSession('s1', [{ role: 'user', text: 'what are my dues this month?' }]);

    expect(getSessions()[0].updatedAt).toBe(t('2026-09-26T11:30:00Z'));
  });
});
