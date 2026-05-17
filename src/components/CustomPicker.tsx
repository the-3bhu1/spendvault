import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface PickerOption {
  id: string;
  name: string;
  subtext?: string;
  group?: string;
}

interface CustomPickerProps {
  label: string;
  value: any;
  options: PickerOption[];
  onChange: (val: any) => void;
  placeholder?: string;
  iconGetter?: (id: string) => React.ReactNode;
  error?: string;
  hideLabel?: boolean;
  allowTextWrap?: boolean;
  isMulti?: boolean;
  style?: React.CSSProperties;
}

export function CustomPicker({
  label,
  value,
  options,
  onChange,
  placeholder = "Select an option",
  iconGetter,
  error,
  hideLabel,
  allowTextWrap = false,
  isMulti = false,
  style = {}
}: CustomPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const valueArray = isMulti ? (Array.isArray(value) ? value : (value ? [value] : [])) : [value];
  const selectedOptions = options.filter(o => valueArray.includes(o.id));
  const selectedOption = selectedOptions[0];

  const uniqueGroups = Array.from(new Set(options.map(o => o.group).filter(Boolean))) as string[];
  const firstGroup = uniqueGroups[0] || '';
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const isGroupExpanded = (g?: string) => {
    if (!g) return true;
    if (collapsedGroups[g] !== undefined) {
      return !collapsedGroups[g];
    }
    return g === firstGroup || selectedOption?.group === g;
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen]);

  const pickerContent = isOpen ? (
    <div className="bottom-sheet-overlay" onClick={() => setIsOpen(false)}>
      <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="flex align-start" style={{ padding: '1.5rem 1.75rem 1rem', borderBottom: '2px solid #000', marginBottom: '0.5rem', gap: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)', flex: 1, minWidth: 0, lineHeight: 1.1 }}>{label}</h3>
          <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem', fontSize: '1.4rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 'auto' }}>
            ✕
          </button>
        </div>
        <div className="no-scrollbar" style={{ 
          overflowY: 'auto', 
          flex: 1, 
          padding: isMulti ? '0.5rem 1.5rem' : '0.5rem 1.5rem calc(1.5rem + env(safe-area-inset-bottom, 16px))' 
        }}>
          {(() => {
            let lastGroup = '';
            return options.map(opt => {
              const showHeader = opt.group && opt.group !== lastGroup;
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
                        size={12} 
                        style={{ 
                          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease',
                          color: expanded ? 'var(--accent)' : 'var(--text-muted)'
                        }} 
                      />
                    </div>
                  )}
                  {expanded && (
                    <div
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
          })()}
        </div>
        {isMulti && (
          <div style={{ 
            padding: '1rem 1.5rem calc(1rem + env(safe-area-inset-bottom, 16px))', 
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
          {selectedOption && iconGetter && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {iconGetter(selectedOption.id)}
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
              ? (valueArray.includes('all') || valueArray.length === 0 ? 'All' : (valueArray.length === 1 ? selectedOptions[0].name : `${valueArray.length} selected`))
              : (selectedOption ? selectedOption.name : placeholder)}
          </span>
        </div>
        <ChevronDown size={16} className={`text-muted transition-all ${isOpen ? 'rotate-180' : ''}`} />
      </div>
      {error && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{error}</span>}

      {pickerContent && createPortal(pickerContent, document.body)}
    </div>
  );
}
