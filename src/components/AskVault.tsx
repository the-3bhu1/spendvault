import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Sparkles, X, Plus, ArrowUp, Settings as SettingsIcon, History, Trash2, ArrowLeft, Paperclip } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useFinance } from '../FinanceContext';
import { hasGeminiKey } from '../services/GeminiConfig';
import { askVault, type ChatMessage } from '../services/AskVaultService';
import {
  getSessions, upsertSession, deleteSession, newSessionId, type ChatSession,
} from '../services/ChatHistoryService';
import { parseContractNote, allocateCharges, type AllocationResult } from '../services/ContractNoteService';
import ContractNoteReview from './ContractNoteReview';

type PendingReview =
  | { status: 'loading'; fileLabel: string }
  | { status: 'success'; fileLabel: string; result: AllocationResult }
  | { status: 'error'; fileLabel: string; message: string; rawText?: string };

const PENDING_REVIEW_KEY = 'askvault_pending_contract_note';

// Downscales an image client-side before base64-encoding (canvas resize to ~2000px long edge,
// JPEG ~85%) — guards payload size/latency for a full-res phone photo, not just a screenshot.
// PDFs pass through as-is (Gemini handles them natively as inlineData).
function fileToGeminiPart(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve({ base64: dataUrl.split(',')[1] || '', mimeType: file.type || 'application/pdf' });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX_EDGE = 2000;
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(url);
      resolve({ base64: dataUrl.split(',')[1] || '', mimeType: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

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

interface AskVaultProps {
  isOpen?: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
  isDemo?: boolean;
}

export default function AskVault({ isOpen: _isOpen, onClose, onOpenSettings, isDemo }: AskVaultProps) {
  const { data, updateUser } = useFinance();
  const [sessions, setSessions] = useState<ChatSession[]>(() => getSessions());
  const [sessionId, setSessionId] = useState<string>(() => newSessionId());
  const [messages, setMessages] = useState<Msg[]>(() => 
    isDemo ? [
      { role: 'user' as const, text: "How much did I spend on dining out this month?" },
      { role: 'model' as const, text: "You've spent **₹4,850** across 6 dining transactions this month. That's **12% lower** than your average monthly dining budget!" },
      { role: 'user' as const, text: "Can you check my active credit card statement dues?" },
      { role: 'model' as const, text: "You have 1 active statement due: **Indigo Premium Card** with **₹799** due on the 5th." }
    ] : []
  );
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [keyReady, setKeyReady] = useState<boolean | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(() => {
    try {
      const cached = sessionStorage.getItem(PENDING_REVIEW_KEY);
      if (!cached) return null;
      const c = JSON.parse(cached);
      return { status: 'success', result: c.result, fileLabel: c.fileLabel || 'Uploaded file' };
    } catch { return null; }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadCountRef = useRef(0); // fallback numbering ("Image 2") when a file has no usable name

  const consented = !!data.user?.aiAssistant;
  const blocked = isDemo ? false : (keyReady === false || !consented);

  useEffect(() => { hasGeminiKey().then(setKeyReady); }, []);

  // Persist the active conversation after every turn. Error bubbles aren't saved — only the real
  // exchange — and a chat with no real messages yet never creates an empty session.
  useEffect(() => {
    if (isDemo) return;
    const clean = messages.filter(m => !m.error).map(({ role, text }) => ({ role, text }));
    if (!clean.length) return;
    setSessions(upsertSession(sessionId, clean));
  }, [messages, sessionId, isDemo]);

  // Pin the overlay to the visual viewport (the area above the keyboard) instead of
  // the layout viewport. Without this, opening the on-screen keyboard hides the input
  // behind it and the webview scrolls the whole fixed overlay up — pushing the header
  // and earlier messages off-screen. Tracking visualViewport keeps everything in view.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      if (overlayRef.current) {
        overlayRef.current.style.height = `${vv.height}px`;
        overlayRef.current.style.top = `${vv.offsetTop}px`;
      }
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pendingReview, loading]);

  const send = async (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if (!text || loading || blocked) return;

    setInput('');
    const newMsgs: Msg[] = [...messages, { role: 'user', text }];
    setMessages(newMsgs);
    setLoading(true);

    try {
      const resp = await askVault(newMsgs.map(m => ({ role: m.role, text: m.text })), data);
      setMessages([...newMsgs, { role: 'model', text: resp }]);
    } catch (err: any) {
      setMessages([
        ...newMsgs,
        {
          role: 'model',
          text: err?.message || 'Failed to get a response. Please check your Gemini API key under Settings → AI Features.',
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser) send(lastUser.text);
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || loading) return;
    const isImage = file.type.startsWith('image/');
    const n = ++uploadCountRef.current;
    const fileLabel = (file.name && file.name.trim()) ? file.name.trim() : (isImage ? `Image ${n}` : `PDF ${n}`);
    setPendingReview({ status: 'loading', fileLabel });
    try {
      const { base64, mimeType } = await fileToGeminiPart(file);
      const parsed = await parseContractNote(base64, mimeType);
      const result = allocateCharges(parsed);
      if (result.trades.length === 0) {
        setPendingReview({ status: 'error', fileLabel, message: "Couldn't find any buy trades on that note — try a clearer screenshot, or log it manually." });
        return;
      }
      setPendingReview({ status: 'success', fileLabel, result });
      try { sessionStorage.setItem(PENDING_REVIEW_KEY, JSON.stringify({ result, fileLabel })); } catch { /* ignore */ }
    } catch (err: any) {
      setPendingReview({
        status: 'error',
        fileLabel,
        message: err?.message || "Couldn't process that file. Make sure it's a valid Zerodha/Groww contract note PDF or screenshot.",
      });
    }
  };

  const clearPendingReview = () => {
    setPendingReview(null);
    try { sessionStorage.removeItem(PENDING_REVIEW_KEY); } catch { /* ignore */ }
  };

  const handleReviewConfirm = (summary: string) => {
    const label = pendingReview?.fileLabel;
    clearPendingReview();
    setMessages(prev => [
      ...prev,
      ...(label ? [{ role: 'user' as const, text: `📎 ${label}` }] : []),
      { role: 'model', text: summary },
    ]);
  };

  const handleReviewDismiss = () => clearPendingReview();

  const handleClose = () => {
    clearPendingReview();
    onClose();
  };

  const newChat = () => {
    clearPendingReview();
    setMessages([]);
    setInput('');
    setSessionId(newSessionId());
    setShowHistory(false);
  };

  const loadSession = (s: ChatSession) => {
    setSessionId(s.id);
    setMessages(s.messages);
    setInput('');
    setShowHistory(false);
  };

  const removeSession = (id: string) => {
    setSessions(deleteSession(id));
    if (id === sessionId) newChat();
  };

  return (
    <div className="askvault-overlay" ref={overlayRef}>
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
          {!blocked && sessions.length > 0 && (
            <button
              className="askvault-icon-btn"
              onClick={() => setShowHistory(v => !v)}
              title={showHistory ? 'Back to chat' : 'Chat history'}
            >{showHistory ? <ArrowLeft size={20} /> : <History size={20} />}</button>
          )}
          {(messages.length > 0 || !!pendingReview) && !showHistory && (
            <button className="askvault-icon-btn" onClick={newChat} title="New chat"><Plus size={20} /></button>
          )}
          <button className="askvault-icon-btn" onClick={handleClose} title="Close"><X size={22} /></button>
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="askvault-body no-scrollbar">
          {sessions.length === 0 ? (
            <div className="text-muted text-center" style={{ marginTop: '2rem' }}>No saved chats yet.</div>
          ) : (
            <div className="flex-col gap-2">
              {sessions.map(s => (
                <div
                  key={s.id}
                  className={`askvault-history-item ${s.id === sessionId ? 'active' : ''}`}
                  onClick={() => loadSession(s)}
                >
                  <div className="flex-col" style={{ minWidth: 0, flex: 1 }}>
                    <span className="askvault-history-title">{s.title}</span>
                    <span className="text-xs text-muted">{formatDistanceToNow(s.updatedAt, { addSuffix: true })}</span>
                  </div>
                  <button
                    className="askvault-history-del"
                    onClick={e => { e.stopPropagation(); removeSession(s.id); }}
                    title="Delete chat"
                  ><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="askvault-body no-scrollbar" ref={scrollRef} style={showHistory ? { display: 'none' } : undefined}>
        {!isDemo && keyReady === false && (
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

        {!isDemo && keyReady === true && !consented && (
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

        {!blocked && messages.length === 0 && !isDemo && !pendingReview && (
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

        {!blocked && (
          <div className="tour-askvault-chat flex-col gap-3">
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
          </div>
        )}

        {pendingReview && (
          <div className="askvault-row user">
            <div className="askvault-bubble user flex align-center gap-2">
              <Paperclip size={14} style={{ flexShrink: 0, opacity: 0.8 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingReview.fileLabel}</span>
            </div>
          </div>
        )}

        {pendingReview?.status === 'loading' && (
          <div className="askvault-row model">
            <div className="askvault-bubble model">Reading your contract note…</div>
          </div>
        )}

        {pendingReview?.status === 'error' && (
          <div className="askvault-row model">
            <div className="askvault-bubble model error">
              {pendingReview.message}
              {pendingReview.rawText && (
                <pre className="text-xs text-muted" style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{pendingReview.rawText}</pre>
              )}
              <button className="askvault-retry" onClick={() => setPendingReview(null)}>Dismiss</button>
            </div>
          </div>
        )}

        {pendingReview?.status === 'success' && (
          <ContractNoteReview
            trades={pendingReview.result.trades}
            skippedSellRows={pendingReview.result.skippedSellRows}
            reconciliationWarning={pendingReview.result.reconciliationWarning}
            onConfirm={handleReviewConfirm}
            onDismiss={handleReviewDismiss}
          />
        )}

        {loading && (
          <div className="askvault-row model">
            <div className="askvault-bubble model askvault-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {!blocked && !showHistory && (
        <div className="askvault-footer">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />
          <button
            className="askvault-attach"
            onClick={handleAttachClick}
            disabled={pendingReview?.status === 'loading'}
            title="Attach a contract note"
          >
            <Paperclip size={20} />
          </button>
          <textarea
            ref={inputRef}
            className="askvault-input no-scrollbar"
            value={input}
            rows={1}
            placeholder="Ask about your money…"
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
