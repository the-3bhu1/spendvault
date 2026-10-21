import { useEffect, useRef, useState } from 'react';

/** Up to `limit` descriptions from `pool` containing what's typed, case-insensitively — nothing until
 *  two characters are in, and never the exact text already typed. `pool` is de-duplicated here in
 *  its own order, so the caller decides which descriptions rank first. */
export function matchDescriptions(pool: string[], typed: string, limit = 5): string[] {
  const q = typed.trim().toLowerCase();
  if (q.length < 2) return [];
  return Array.from(new Set(pool))
    .filter(d => d.toLowerCase().includes(q) && d.toLowerCase() !== typed.toLowerCase())
    .slice(0, limit);
}

/** The dropdown under a description input. Its parent must be `position: relative`. mousedown is
 *  swallowed so picking a row doesn't blur the input first and close the list under the tap. */
export function SuggestionDropdown({ items, onSelect }: { items: string[]; onSelect: (s: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // On a field near the bottom of a sheet (the debt forms' Description is the last one) the list
  // opens below the fold, where it may as well not exist. Bring it into view when it appears or
  // grows. 'nearest' scrolls only as far as needed, and not at all when the list already shows.
  // Instant, a frame late, on purpose: a keystroke also makes the browser scroll the caret into
  // view, and that cut a smooth scroll off partway — two rows showing, three still under the fold.
  useEffect(() => {
    if (items.length === 0) return;
    const id = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(id);
  }, [items.length]);
  if (items.length === 0) return null;
  return (
    <div ref={ref} style={{
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      backgroundColor: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '0 0 12px 12px',
      zIndex: 10,
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      marginTop: '-4px'
    }}>
      {items.map(s => (
        <div
          key={s}
          style={{ padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.9rem' }}
          onClick={() => onSelect(s)}
          onMouseDown={e => e.preventDefault()}
        >
          {s}
        </div>
      ))}
    </div>
  );
}

/** A labelled description input that suggests from `pool` as you type, the way Log Transaction
 *  does. Picking a suggestion fills in the text only. */
export function DescriptionField({ label, placeholder, value, onChange, pool }: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  pool: string[];
}) {
  const [items, setItems] = useState<string[]>([]);
  return (
    <div className="input-group" style={{ position: 'relative' }}>
      <label>{label}</label>
      <input
        className="input-field"
        placeholder={placeholder}
        value={value}
        onChange={e => { onChange(e.target.value); setItems(matchDescriptions(pool, e.target.value)); }}
        onBlur={() => setTimeout(() => setItems([]), 150)}
        autoComplete="off"
      />
      <SuggestionDropdown items={items} onSelect={s => { onChange(s); setItems([]); }} />
    </div>
  );
}
