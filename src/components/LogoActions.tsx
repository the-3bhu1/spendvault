import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Eye, Camera, Trash2, X } from 'lucide-react';
import { LogoAvatar, type LogoStatus } from './LogoAvatar';
import { logoFromDomain } from '../services/LogoService';
import { useLongPress } from '../hooks/useLongPress';

/* The logo interactions a detail screen offers on its hero mark: tap (or long-press) the mark, and
   a sheet offers to view it full-screen, set a custom one, or go back to the default. Built for the
   credit card screen to match what Wealth's detail screens already do, with one addition those never
   needed: SEVERAL logos in one sheet, because a co-branded card carries two — the programme and the
   bank — and each can be wrong on its own. The markup is Wealth's, so the two look like one feature. */

export interface LogoSlot {
  key: string;
  /** "IndianOil" — who the logo is for. */
  title: string;
  /** "Brand" / "Bank" — shown only when the sheet has more than one slot. */
  role?: string;
  /** What is showing now: the custom logo if one is set, else the default. */
  url: string | null;
  /** What showing nothing custom would give — the preview while the custom box is empty. */
  defaultUrl: string | null;
  /** The saved override, if any — what the custom box opens with, and whether Reset is offered. */
  custom?: string;
  accountType?: string;
  /** Passed through to LogoAvatar — a gold/silver holding's coin and EPF's mark are drawn, not fetched. */
  metal?: 'gold' | 'silver';
  isEpf?: boolean;
}

/** Tap or long-press to open the logo sheet — the gesture Wealth's hero marks answer to. */
export function LogoTapTarget({ onTrigger, children }: { onTrigger: () => void; children: ReactNode }) {
  const justLongPressed = useRef(false);
  const trigger = () => {
    try { window.getSelection?.()?.removeAllRanges(); } catch { /* ignore */ }
    onTrigger();
  };
  const handlers = useLongPress(() => {
    justLongPressed.current = true;
    trigger();
    setTimeout(() => { justLongPressed.current = false; }, 350);
  });
  return (
    <div
      {...handlers}
      onMouseDown={e => { e.preventDefault(); handlers.onMouseDown?.(e); }}
      onClick={e => {
        if (justLongPressed.current) return;
        e.stopPropagation();
        trigger();
      }}
      title="Tap for logo options"
      className="interactive-hero-avatar"
      style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', cursor: 'pointer' }}
    >
      {children}
    </div>
  );
}

export function LogoActionSheet({ slots, initialKey, onView, onCustom, onReset, onClose }: {
  slots: LogoSlot[];
  /** Which logo starts selected — the one last acted on, when the sheet comes back from the viewer
   *  or the custom-logo editor. The first slot (the brand) otherwise. */
  initialKey?: string;
  onView: (slot: LogoSlot) => void;
  onCustom: (slot: LogoSlot) => void;
  onReset: (slot: LogoSlot) => void;
  onClose: () => void;
}) {
  /* TWO LOGOS: PICK ONE, THEN ACT ON IT. A co-branded card's two marks sit side by side at the top as
     cards you can select — the brand selected to begin with, since it is the card's main mark — and
     the actions are listed ONCE underneath, for whichever is selected. The first version stacked a
     full set of buttons under each logo, which doubled the sheet and left two "Custom Logo" buttons a
     glance apart. One logo needs no picking, and gets the plain list. */
  const [selectedKey, setSelectedKey] = useState(initialKey ?? slots[0]?.key);
  const selected = slots.find(s => s.key === selectedKey) ?? slots[0];
  const several = slots.length > 1;
  const noSelect = { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as const;
  if (!selected) return null;
  return (
    <div className="modal-overlay action-sheet-modal" style={noSelect} onClick={onClose}>
      <div className="modal-content action-sheet-modal" style={noSelect} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{several ? 'Logos' : 'Logo'}</h3>
          <button onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body flex-col gap-3">
          {several && (
            <div role="radiogroup" aria-label="Which logo" style={{ display: 'grid', gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))`, gap: '0.75rem', marginBottom: '0.25rem' }}>
              {slots.map(slot => {
                const on = slot.key === selected.key;
                return (
                  <button
                    key={slot.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setSelectedKey(slot.key)}
                    className="flex-col align-center"
                    style={{
                      position: 'relative',
                      gap: '0.5rem',
                      padding: '1rem 0.6rem 0.85rem',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      background: on ? 'var(--bg-hover)' : 'transparent',
                      border: `2px solid ${on ? 'var(--accent)' : 'var(--border-color)'}`,
                      opacity: on ? 1 : 0.6,
                      transition: 'border-color 0.15s, opacity 0.15s, background 0.15s',
                      minWidth: 0,
                    }}
                  >
                    <LogoAvatar name={slot.title} logoUrl={slot.url} size={52} accountType={slot.accountType} metal={slot.metal} isEpf={slot.isEpf} />
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {slot.title}
                    </span>
                    {slot.role && (
                      <span className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: on ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {slot.role}{slot.custom ? ' · custom' : ''}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <button
            className="btn btn-secondary w-100 flex-row align-center gap-3"
            style={{ justifyContent: 'flex-start', padding: '1rem' }}
            onClick={() => onView(selected)}
          >
            <Eye size={20} /> View Logo
          </button>
          <button
            className="btn btn-secondary w-100 flex-row align-center gap-3"
            style={{ justifyContent: 'flex-start', padding: '1rem' }}
            onClick={() => onCustom(selected)}
          >
            <Camera size={20} /> Custom Logo
          </button>
          {selected.custom && (
            <button
              className="btn btn-secondary w-100 flex-row align-center gap-3 text-danger"
              style={{ justifyContent: 'flex-start', padding: '1rem' }}
              onClick={() => onReset(selected)}
            >
              <Trash2 size={20} /> Reset to Default Logo
            </button>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary w-100" style={{ padding: '1rem' }} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function LogoViewer({ name, url, accountType, metal, isEpf, onClose }: { name: string; url: string | null; accountType?: string; metal?: 'gold' | 'silver'; isEpf?: boolean; onClose: () => void }) {
  return (
    <div className="modal-overlay" style={{ background: '#000' }} onClick={onClose}>
      <button
        style={{
          position: 'absolute', top: 'calc(var(--safe-area-inset-top, 0px) + 1rem)', right: '1rem',
          background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: '40px', height: '40px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', zIndex: 100, cursor: 'pointer',
        }}
        onClick={onClose}
        aria-label="Close"
      >
        <X size={24} />
      </button>
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
        <div
          style={{
            width: 'min(78vw, 320px)', height: 'min(78vw, 320px)', borderRadius: '50%', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 60px rgba(0, 0, 0, 0.9)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <LogoAvatar name={name} logoUrl={url} size={320} accountType={accountType} metal={metal} isEpf={isEpf} />
        </div>
      </div>
    </div>
  );
}

export function CustomLogoModal({ slot, heading, onSave, onClose }: {
  slot: LogoSlot;
  /** The modal's title — "Custom Logo", or "Bank Logo" for a co-brand's second mark. */
  heading?: string;
  onSave: (value: string | undefined) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState(slot.custom || '');
  // Previewed once typing pauses, as on Wealth: otherwise every keystroke of a domain fires a lookup.
  const [preview, setPreview] = useState(slot.custom?.trim() || '');
  const [status, setStatus] = useState<LogoStatus>('none');
  useEffect(() => {
    const t = setTimeout(() => setPreview(input.trim()), 500);
    return () => clearTimeout(t);
  }, [input]);

  const typed = input.trim();
  const previewUrl = preview ? logoFromDomain(preview) : slot.defaultUrl;
  const settled = typed === preview;
  const line = !typed
    ? { text: 'Using default mark', color: 'var(--text-secondary)' }
    : !settled || status === 'loading'
      ? { text: 'Looking up logo…', color: 'var(--text-secondary)' }
      : status === 'shown'
        ? { text: 'Logo found — Save to use it', color: 'var(--success)' }
        : { text: `No logo found for ${typed}`, color: 'var(--danger)' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{heading || 'Custom Logo'}</h3>
          <button onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body flex-col gap-3">
          <div
            className="flex align-center gap-3"
            style={{ padding: '0.85rem', background: 'var(--bg-hover)', borderRadius: '8px', border: '1px solid var(--border-color)' }}
          >
            <LogoAvatar name={slot.title} logoUrl={previewUrl} size={52} accountType={slot.accountType} metal={slot.metal} isEpf={slot.isEpf} onStatus={setStatus} />
            <div className="flex-col" style={{ minWidth: 0, flex: 1 }}>
              <span className="text-sm font-bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                {slot.title}
              </span>
              <span className="text-xs" style={{ color: line.color }}>{line.text}</span>
            </div>
          </div>
          <div className="input-group">
            <label>Domain or Image URL</label>
            <input
              className="input-field"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="e.g. hdfcbank.com, iocl.com, or https://..."
              autoFocus
            />
            <span className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
              Enter a website domain (e.g. <code>hdfcbank.com</code>), image URL, or SVG. Leave empty for default.
            </span>
          </div>
        </div>
        <div className="modal-footer flex-row gap-2">
          <button className="btn btn-secondary flex-1" style={{ padding: '1rem' }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1" style={{ padding: '1rem' }} onClick={() => onSave(typed || undefined)}>Save</button>
        </div>
      </div>
    </div>
  );
}
