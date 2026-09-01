import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search, X } from 'lucide-react';

export interface PickerOption {
  id: string;
  name: string;
  triggerName?: string;
  subtext?: string;
  group?: string;
  showOnlyOnSearch?: boolean;
}

interface CustomPickerProps {
  label: string;
  value: any;
  options: PickerOption[];
  onChange: (val: any) => void;
  placeholder?: string;
  displayValue?: string;
  alwaysShowGroups?: boolean;
  iconGetter?: (id: string) => React.ReactNode;
  error?: string;
  hideLabel?: boolean;
  allowTextWrap?: boolean;
  isMulti?: boolean;
  noSelectionLabel?: string;
  style?: React.CSSProperties;
  defaultCollapsed?: boolean;
  defaultGroupExpanded?: boolean;
  enableSearch?: boolean;
  searchPlaceholder?: string;
}

export function CustomPicker({
  label,
  value,
  options,
  onChange,
  placeholder = "Select an option",
  displayValue,
  alwaysShowGroups = false,
  iconGetter,
  error,
  hideLabel,
  allowTextWrap = false,
  isMulti = false,
  noSelectionLabel = 'All',
  style = {},
  defaultCollapsed = false,
  defaultGroupExpanded = true,
  enableSearch = false,
  searchPlaceholder = "Search options..."
}: CustomPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const valueArray = isMulti ? (Array.isArray(value) ? value : (value ? [value] : [])) : [value];
  const selectedOptions = options.filter(o => valueArray.includes(o.id));
  const selectedOption = selectedOptions[0];

  // Which option's icon represents the whole selection on the closed trigger. With multi-select the
  // label collapses to "N selected", so borrowing the FIRST selection's icon actively misinforms:
  // one bank + one credit card read as "2 selected" under a bank icon. A specific icon is only
  // honest when every selection is the same kind of thing — i.e. they share a group — so a mixed
  // selection falls back to the neutral catch-all option ('all' / '') the caller supplied.
  const catchAllOption = options.find(o => o.id === 'all' || o.id === '');
  const triggerIconOption = (() => {
    if (!isMulti) return selectedOption;
    if (valueArray.includes('all') || valueArray.length === 0) return catchAllOption;
    if (selectedOptions.length <= 1) return selectedOption;
    const groups = new Set(selectedOptions.map(o => o.group));
    const sameGroup = groups.size === 1 && selectedOptions[0].group !== undefined;
    return sameGroup ? selectedOptions[0] : catchAllOption;
  })();

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isOpen) {
      setCollapsedGroups({});
      setSearchQuery('');
    }
  }, [isOpen]);

  const flatListThreshold = 7;
  const groupCollapseThreshold = 4;

  // If total options (excluding 'all' or empty placeholders) is <= 7 and no groups exist, render as flat list.
  // When options have groups (e.g. Year 2026), always render group headers with collapsible chevrons.
  const hasGroups = options.some(o => !!o.group);
  const isFlatList = !alwaysShowGroups && !hasGroups && options.filter(o => o.id !== 'all' && o.id !== '').length <= flatListThreshold;

  const isGroupExpanded = (g?: string) => {
    if (!g || isFlatList) return true;
    if (collapsedGroups[g] !== undefined) {
      return !collapsedGroups[g];
    }
    if (searchQuery.trim() !== '') return true;
    // Archived Accounts stays collapsed regardless of size, like a `defaultCollapsed` picker —
    // surfacing deleted accounts by default would bury the active ones it's meant to sit behind.
    if (g === 'Archived Accounts' || defaultCollapsed) {
      return selectedOption?.group === g;
    }
    if (defaultGroupExpanded) {
      return true;
    }
    // Count items in group g
    const itemsInGroup = options.filter(o => o.group === g).length;
    // If group has fewer than 4 items, start expanded
    if (itemsInGroup < groupCollapseThreshold) {
      return true;
    }
    // For groups with >= 4 items, expand if it contains the selected option
    return selectedOption?.group === g;
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);
  // Which row the sheet opens on. The catch-all ('all' / '') already sits at the top and means "no
  // real selection", so it never counts as a scroll target; a multi-select opens on its first pick.
  const scrollTargetId = selectedOptions.find(o => o.id !== 'all' && o.id !== '')?.id;

  // Open the list at the current selection instead of at the top — a grouped account picker would
  // otherwise open on "BANK ACCOUNTS" while the account actually in play is several groups down,
  // leaving no on-screen sign of what is selected.
  //
  // Measured with rects rather than scrollIntoView for two reasons: scrollIntoView also pans every
  // scrollable ancestor (the page behind the overlay included), and the difference between two rects
  // is immune to the sheet's slide-up animation, which is a pure translateY and so shifts both by the
  // same amount. Runs as a layout effect so the position is right in the frame the sheet first
  // paints, with no visible jump from the top.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const list = listRef.current;
    const item = selectedItemRef.current;
    if (!list || !item) return;
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    // Centre the row in the viewport where it fits; the browser clamps at both ends, so a selection
    // near the very top or bottom of the list just stays where it is.
    list.scrollTop += (itemRect.top - listRect.top) - (list.clientHeight - itemRect.height) / 2;
  }, [isOpen]);

  // Guarantee Archived Accounts options are always placed at the end after all active options
  const sortedPickerOptions = React.useMemo(() => {
    const isSearching = searchQuery.trim().length > 0;
    const activeOpts = options.filter(o => o.group !== 'Archived Accounts');
    const archivedOpts = options.filter(o => o.group === 'Archived Accounts');
    const all = [...activeOpts, ...archivedOpts];

    if (!isSearching) {
      return all.filter(o => !o.showOnlyOnSearch || valueArray.includes(o.id));
    }

    const q = searchQuery.toLowerCase().trim();
    return all.filter(o => 
      o.name.toLowerCase().includes(q) || 
      (o.id && o.id.toLowerCase().includes(q)) || 
      (o.subtext && o.subtext.toLowerCase().includes(q)) || 
      (o.group && o.group.toLowerCase().includes(q))
    );
  }, [options, searchQuery, valueArray]);

  const pickerContent = isOpen ? (
    <div className="bottom-sheet-overlay" onClick={() => setIsOpen(false)}>
      <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        {/* .modal-header so the close mark is sized by the one rule that governs every sheet's
            X — only the alignment and bottom padding differ here, because a long picker label
            wraps to a second line and the X stays on the first. */}
        <div className="modal-header" style={{ alignItems: 'flex-start', padding: '1.5rem 1.75rem 0.75rem', gap: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)', flex: 1, minWidth: 0, lineHeight: 1.1 }}>{label}</h3>
          <button onClick={() => setIsOpen(false)} style={{ justifyContent: 'center', flexShrink: 0, marginLeft: 'auto' }}>
            <X />
          </button>
        </div>

        {enableSearch && (
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
              <input
                type="text"
                className="input-field"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder || `Search ${label.toLowerCase()}...`}
                style={{ paddingLeft: '3rem', paddingRight: searchQuery ? '2.5rem' : '1rem', borderRadius: '12px', width: '100%' }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', padding: 0 }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
        <div ref={listRef} className="no-scrollbar" style={{
          overflowY: 'auto',
          flex: 1,
          padding: isMulti ? '0.5rem 1.5rem' : '0.5rem 1.5rem calc(1.5rem + var(--safe-area-inset-bottom))'
        }}>
          {sortedPickerOptions.length === 0 ? (
            <div className="text-center text-muted text-xs" style={{ padding: '1.5rem 0' }}>
              No matching options found.
            </div>
          ) : (
            (() => {
              let lastGroup = '';
              return sortedPickerOptions.map(opt => {
              const showHeader = !isFlatList && opt.group && opt.group !== lastGroup;
              if (opt.group) {
                lastGroup = opt.group;
              }
              const expanded = isGroupExpanded(opt.group);
              return (
                <React.Fragment key={opt.id}>
                  {showHeader && (
                    <div 
                      className="clickable flex justify-between align-center"
                      onClick={() => {
                        setCollapsedGroups(prev => ({
                          ...prev,
                          [opt.group!]: expanded
                        }));
                      }}
                      style={{
                        padding: '0.75rem 0.5rem 0.5rem 0.5rem',
                        fontSize: '0.75rem',
                        fontWeight: 800,
                        color: expanded ? 'var(--accent)' : 'var(--text-secondary)',
                        textTransform: 'uppercase',
                        letterSpacing: '1.5px',
                        borderBottom: '1px solid var(--border-color)',
                        marginBottom: '0.5rem',
                        marginTop: '0.75rem',
                        userSelect: 'none'
                      }}
                    >
                      <span>{opt.group}</span>
                      <ChevronDown 
                        size={14} 
                        style={{ 
                          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                          transition: 'transform 0.2s ease',
                          color: expanded ? 'var(--accent)' : 'var(--text-muted)',
                          opacity: 0.8
                        }} 
                      />
                    </div>
                  )}
                  {expanded && (
                    <div
                      ref={opt.id === scrollTargetId ? selectedItemRef : undefined}
                      className={`picker-option ${valueArray.includes(opt.id) ? 'selected' : ''}`}
                      onClick={() => {
                        if (isMulti) {
                          if (opt.id === 'all') {
                            onChange(['all']);
                          } else {
                            const newValues = valueArray.includes('all') ? [] : [...valueArray];
                            if (newValues.includes(opt.id)) {
                              const filtered = newValues.filter(v => v !== opt.id);
                              onChange(filtered.length === 0 ? ['all'] : filtered);
                            } else {
                              onChange([...newValues, opt.id]);
                            }
                          }
                        } else {
                          onChange(opt.id);
                          setIsOpen(false);
                        }
                      }}
                    >
                      {iconGetter && (
                        <div className="picker-option-icon">
                          {iconGetter(opt.id)}
                        </div>
                      )}
                      <div className="flex-col">
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{opt.name}</span>
                        {opt.subtext && <span className="text-xs text-muted" style={{ marginTop: '2px' }}>{opt.subtext}</span>}
                      </div>
                      {valueArray.includes(opt.id) && (
                        <div style={{ marginLeft: 'auto', color: 'var(--accent)', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Check size={14} strokeWidth={3} />
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            });
          })()
        )}
        </div>
        {isMulti && (
          <div style={{ 
            padding: '1rem 1.5rem calc(1rem + var(--safe-area-inset-bottom))', 
            background: 'var(--bg-card)', 
            borderTop: '1.5px solid var(--border-color)', 
            zIndex: 10,
            boxShadow: '0 -10px 20px rgba(0,0,0,0.2)',
            marginTop: 'auto'
          }}>
            <button 
              className="btn btn-primary" 
              style={{ width: '100%', padding: '0.85rem' }}
              onClick={() => setIsOpen(false)}
            >
              DONE
            </button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="input-group" style={{ ...(hideLabel ? { marginBottom: 0 } : {}), ...style }}>
      {!hideLabel && <label>{label}</label>}
      <div
        className={`custom-select-trigger ${isOpen ? 'active' : ''} ${error ? 'border-danger' : ''}`}
        onClick={() => setIsOpen(true)}
      >
        <div className="flex align-center gap-3" style={{ overflow: 'hidden', minWidth: 0, flex: 1 }}>
          {triggerIconOption && iconGetter && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {iconGetter(triggerIconOption.id)}
            </div>
          )}
          <span style={{
            color: selectedOption ? 'var(--text-primary)' : 'var(--text-secondary)',
            whiteSpace: allowTextWrap ? 'normal' : 'nowrap',
            overflow: 'hidden',
            textOverflow: allowTextWrap ? 'clip' : 'ellipsis',
            minWidth: 0,
            lineHeight: allowTextWrap ? 1.2 : undefined
          }}>
            {isMulti
              ? (valueArray.includes('all') || valueArray.length === 0 ? noSelectionLabel : (valueArray.length === 1 ? (selectedOptions[0] ? (selectedOptions[0].triggerName || selectedOptions[0].name) : `#${valueArray[0]}`) : `${valueArray.length} selected`))
              : (displayValue !== undefined ? displayValue : (selectedOption ? (selectedOption.triggerName || selectedOption.name) : placeholder))}
          </span>
        </div>
        <ChevronDown size={16} className={`text-muted transition-all ${isOpen ? 'rotate-180' : ''}`} />
      </div>
      {error && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{error}</span>}

      {pickerContent && createPortal(pickerContent, document.body)}
    </div>
  );
}
