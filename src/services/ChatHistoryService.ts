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

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  const text = (firstUser?.text || 'New chat').trim().replace(/\s+/g, ' ');
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
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
