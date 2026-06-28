// "Ask Vault" — the in-app conversational assistant. Reuses the shared Gemini key/model and the
// same 503-retry/backoff pattern as GeminiService, but is a grounded chat call: it is given a
// static app-knowledge layer plus a freshly computed snapshot of the user's finances, and is told
// to answer ONLY from that. Non-streaming (generateContent) to mirror the proven code path.

import { getGeminiKey, getGeminiModel } from './GeminiConfig';
import { buildVaultContext } from './buildVaultContext';
import { APP_KNOWLEDGE, OUT_OF_SCOPE_REPLY, CONTACT } from '../knowledge/appKnowledge';
import type { FinanceData } from '../types';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const TIMEOUT_MS = 20000;       // answers are longer than the SMS classifier's 6s
const MAX_HISTORY_TURNS = 8;    // cap context cost; older turns are dropped

function systemInstruction(context: string): string {
  return `You are "Ask Vault", the built-in assistant inside the SpendVault personal-finance app.
You help the user with two things only:
  1. How SpendVault works (features, terms, "how do I…").
  2. The user's own financial data, as provided in the CONTEXT below.

RULES:
- Answer ONLY from the APP KNOWLEDGE and CONTEXT below. Do NOT use outside knowledge or make up numbers.
- If a specific figure isn't in the CONTEXT, say it's not available and suggest where to find it
  in the app (e.g. "open Insights and pick that month"). Never guess an amount.
- For anything outside SpendVault or the user's finances (general questions, news, advice you can't
  ground, coding, etc.), reply with EXACTLY this line and nothing else:
  "${OUT_OF_SCOPE_REPLY}"
- You are READ-ONLY: you cannot add, edit, or delete anything. If asked to, explain where in the app
  the user can do it themselves.
- Do not give investment, tax, or legal advice or predictions — report and explain what's in the data.
- Style: concise and mobile-friendly. Format money as ₹ with Indian grouping. Use short bullet lists.
  No markdown tables. Be friendly, not chatty.
- The transaction list in CONTEXT may be a truncated subset; if it looks incomplete for the question,
  ask the user to narrow by month, category, or account rather than guessing.
- The creator's contact for anything you can't help with is ${CONTACT}.

===== APP KNOWLEDGE =====
${APP_KNOWLEDGE}

===== CONTEXT (the user's current finances) =====
${context}`;
}

/**
 * Sends the conversation to Gemini and returns the assistant's reply text.
 * `history` must end with the latest user message. Throws on failure so the UI can offer a retry.
 */
export async function askVault(history: ChatMessage[], data: FinanceData): Promise<string> {
  const key = await getGeminiKey();
  if (!key) throw new Error('gemini: no key');

  const lastUser = [...history].reverse().find(m => m.role === 'user');
  const context = buildVaultContext(data, lastUser?.text || '');

  const model = getGeminiModel();
  // Gemini requires the contents to start with a 'user' turn — drop any leading 'model' messages
  // that a mid-conversation slice might begin with.
  let recent = history.slice(-MAX_HISTORY_TURNS);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction(context) }] },
    contents: recent.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
    generationConfig: { temperature: 0.3 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let j: any = null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );
      } catch {
        throw new Error('gemini: chat request failed');
      }
      j = await res.json().catch(() => null);
      if (j?.error && (j.error.code === 503 || j.error.status === 'UNAVAILABLE')) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      break;
    }
  } finally {
    clearTimeout(timer);
  }

  if (!j || j.error) throw new Error('gemini: no usable chat response');

  const txt: string = (j?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text || '').join('').trim();
  if (!txt) throw new Error('gemini: empty chat response');
  return txt;
}
