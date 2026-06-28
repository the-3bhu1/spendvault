import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Sparkles, X, Plus, ArrowUp, Settings as SettingsIcon } from 'lucide-react';
import { useFinance } from '../FinanceContext';
import { hasGeminiKey } from '../services/GeminiConfig';
import { askVault, type ChatMessage } from '../services/AskVaultService';

const SUGGESTIONS = [
  'How much did I spend this month?',
  'What are my credit card dues?',
  'How do billing cycles work?',
  'How do I add a transaction?',
];

interface Msg extends ChatMessage {
  error?: boolean;
}

// Inline: split on **bold** spans (the model's only inline marker we care about).
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={`${keyPrefix}-${i}`}>{p.slice(2, -2)}</strong>
      : <span key={`${keyPrefix}-${i}`}>{p}</span>
  );
}

// Minimal markdown renderer: bold + bullet lists + paragraphs. Avoids a dependency and the raw
// asterisks the model emits. Consecutive bullet lines are grouped into a single list.
function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let bullets: { indent: number; text: string }[] = [];

  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="askvault-md-list">
        {items.map((b, i) => (
          <li key={i} style={{ marginLeft: b.indent ? b.indent * 14 : 0 }}>
            {renderInline(b.text, `li-${blocks.length}-${i}`)}
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((line, idx) => {
    const m = line.match(/^(\s*)[*\-•]\s+(.*)$/);
    if (m) {
      bullets.push({ indent: Math.floor(m[1].length / 2), text: m[2] });
      return;
    }
    flush();
    if (line.trim() === '') {
      blocks.push(<div key={`sp-${idx}`} style={{ height: '0.5rem' }} />);
    } else {
      blocks.push(<p key={`p-${idx}`} className="askvault-md-p">{renderInline(line, `p-${idx}`)}</p>);
    }
  });
  flush();
  return blocks;
}

export default function AskVault({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const { data, updateUser } = useFinance();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [keyReady, setKeyReady] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const consented = !!data.user?.aiAssistant;
  const blocked = keyReady === false || !consented;

  useEffect(() => { hasGeminiKey().then(setKeyReady); }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput('');
    // Drop any prior failed turn so retries don't pile up.
    const base = messages.filter(m => !m.error);
    const history: Msg[] = [...base, { role: 'user', text: trimmed }];
    setMessages(history);
    setLoading(true);
    try {
      const reply = await askVault(history, data);
      setMessages([...history, { role: 'model', text: reply }]);
    } catch {
      setMessages([...history, {
        role: 'model',
        text: "Sorry — I couldn't reach the assistant just now. Check your connection and try again.",
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser) send(lastUser.text);
  };

  const newChat = () => { setMessages([]); setInput(''); };

  return (
    <div className="askvault-overlay">
      {/* Header */}
      <div className="askvault-header">
        <div className="flex align-center gap-3">
          <div className="askvault-badge"><Sparkles size={18} /></div>
          <div className="flex-col">
            <span className="font-bold" style={{ fontSize: '1rem' }}>Ask Vault</span>
            <span className="text-xs text-muted">Your finances & how the app works</span>
          </div>
        </div>
        <div className="flex align-center gap-4">
          {messages.length > 0 && (
            <button className="askvault-icon-btn" onClick={newChat} title="New chat"><Plus size={20} /></button>
          )}
          <button className="askvault-icon-btn" onClick={onClose} title="Close"><X size={22} /></button>
        </div>
      </div>

      {/* Body */}
      <div className="askvault-body no-scrollbar" ref={scrollRef}>
        {keyReady === false && (
          <div className="card flex-col gap-3" style={{ padding: '1.25rem' }}>
            <span className="font-bold">Set up Ask Vault</span>
            <span className="text-xs text-muted">
              Ask Vault uses your Gemini API key to answer questions. Add it under Settings → AI Features.
              Your financial summary and relevant transactions are sent to Google's Gemini API to answer.
            </span>
            <button className="btn btn-primary flex align-center justify-center gap-2" onClick={onOpenSettings}>
              <SettingsIcon size={16} /> Open Settings
            </button>
          </div>
        )}

        {keyReady === true && !consented && (
          <div className="card flex-col gap-3" style={{ padding: '1.25rem' }}>
            <span className="font-bold">Enable Ask Vault</span>
            <span className="text-xs text-muted">
              To answer your questions, Ask Vault sends a <b>summary of your accounts and transactions</b> and
              the question itself to Google's Gemini API. Card numbers, CVVs and your PIN are never sent.
              This is off by default — turn it on to continue.
            </span>
            <button
              className="btn btn-primary"
              onClick={() => data.user && updateUser({ ...data.user, aiAssistant: true })}
            >Enable & continue</button>
          </div>
        )}

        {!blocked && messages.length === 0 && (
          <div className="flex-col gap-4" style={{ marginTop: '2rem' }}>
            <div className="flex-col align-center gap-2 text-center" style={{ marginBottom: '0.5rem' }}>
              <div className="askvault-badge" style={{ width: 56, height: 56 }}><Sparkles size={28} /></div>
              <span className="font-bold" style={{ fontSize: '1.1rem' }}>Ask me about your money</span>
              <span className="text-xs text-muted" style={{ maxWidth: 280 }}>
                I can read a summary of your accounts and transactions, and explain how SpendVault works.
              </span>
            </div>
            <div className="flex-col gap-2">
              {SUGGESTIONS.map(s => (
                <button key={s} className="askvault-suggestion" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`askvault-row ${m.role === 'user' ? 'user' : 'model'}`}>
            <div className={`askvault-bubble ${m.role} ${m.error ? 'error' : ''}`}>
              {m.role === 'model' && !m.error ? renderMarkdown(m.text) : m.text}
              {m.error && (
                <button className="askvault-retry" onClick={retry}>Retry</button>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="askvault-row model">
            <div className="askvault-bubble model askvault-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {!blocked && (
        <div className="askvault-footer">
          <textarea
            ref={inputRef}
            className="askvault-input no-scrollbar"
            value={input}
            rows={1}
            placeholder="Ask about your money or the app…"
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
          />
          <button
            className="askvault-send"
            disabled={!input.trim() || loading}
            onClick={() => send(input)}
            title="Send"
          >
            <ArrowUp size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
