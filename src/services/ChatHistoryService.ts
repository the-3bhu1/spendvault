// Local persistence for "Ask Vault" chat sessions. Kept in its own localStorage key (NOT in
// FinanceData) so it stays out of backups/exports, but is wiped by clearAllData() for privacy
// since conversations can quote the user's finances. All access is try/catch-wrapped: a full or
// disabled localStorage degrades to an in-memory session rather than throwing.

import type { ChatMessage } from './AskVaultService';

const CHAT_HISTORY_KEY = 'spendvault_chat_history_v1';
const MAX_SESSIONS = 30;        // cap stored conversations; oldest are dropped
const TITLE_MAX = 60;

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export function newSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Most-recently-updated first.
export function getSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    const list: ChatSession[] = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

function write(sessions: ChatSession[]): ChatSession[] {
  const trimmed = sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
  } catch { /* quota exceeded or storage disabled — keep going in-memory */ }
  return trimmed;
}

function clip(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUserText = (messages.find(m => m.role === 'user')?.text || '').trim();

  // A file-upload placeholder ("📎 filename") is a useless title — describe what the assistant
  // actually did with the file instead (e.g. "Logged 4 stock trades from your contract note"),
  // taken from the first line of its reply. Falls back to the bare filename if there's no reply yet.
  if (firstUserText.startsWith('📎')) {
    const firstModel = messages.find(m => m.role === 'model');
    const summary = (firstModel?.text || '').split('\n')[0]
      .replace(/^[^\p{L}\d]+/u, '')        // strip a leading status emoji like "✅ "
      .replace(/\s*\([^)]*\)\.?\s*$/, '')  // strip a trailing "(₹… total)." parenthetical
      .trim();
    if (summary) return clip(summary);
    return clip(firstUserText.replace(/^📎\s*/, '')); // no reply yet → filename without the clip icon
  }

  return clip(firstUserText || 'New chat');
}

// Insert or update a session by id, returning the refreshed (sorted, capped) list.
export function upsertSession(id: string, messages: ChatMessage[]): ChatSession[] {
  const now = Date.now();
  const sessions = getSessions();
  const existing = sessions.find(s => s.id === id);
  const session: ChatSession = {
    id,
    title: deriveTitle(messages),
    messages,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return write([session, ...sessions.filter(s => s.id !== id)]);
}

export function deleteSession(id: string): ChatSession[] {
  return write(getSessions().filter(s => s.id !== id));
}

export function clearChatHistory(): void {
  try { localStorage.removeItem(CHAT_HISTORY_KEY); } catch { /* ignore */ }
}
