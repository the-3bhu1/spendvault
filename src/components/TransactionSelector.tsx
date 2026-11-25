import React, { useState } from 'react';
import { format } from 'date-fns';
import { Search, X } from 'lucide-react';
import { TransactionPickList } from './TransactionPickList';
import type { Transaction } from '../types';

interface TransactionSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  /** `amount` is what was picked is worth: the full price of a part-paid purchase picked whole, the
   *  row's own amount otherwise (one of its sub logs included). Use it, not `tx.amount`, which on a
   *  whole purchase is only the primary account's share. */
  onSelect: (tx: Transaction, amount: number) => void;
  title?: string;
  filter?: (tx: Transaction) => boolean;
}

export const TransactionSelector: React.FC<TransactionSelectorProps> = ({
  isOpen,
  onClose,
  onSelect,
  title = "Select Transaction",
  filter
}) => {
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  // Applied to the top-level rows; a part-paid purchase's legs are folded under it by the list.
  const pickable = (t: Transaction) =>
    (filter ? filter(t) : (t.type === 'debit' || t.type === 'credit'))
    && t.category !== 'Cashback' // Exclude automatic cashback
    && t.date <= todayStr; // Exclude future-dated

  return (
    <div className="modal-overlay flex-center" style={{ zIndex: 10000 }}>
      <div className="modal-content animate-in full-screen flex-col" style={{ padding: 0 }}>
        <div className="modal-header" style={{ padding: 'calc(0.75rem + var(--safe-area-inset-top)) 1.75rem 1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="flex-col flex-1" style={{ overflow: 'hidden', minHeight: 0 }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
              <input
                type="text"
                className="input-field"
                placeholder="Search ledger..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: '3rem', borderRadius: '12px', width: '100%' }}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y no-scrollbar" style={{ background: 'var(--bg-color)', overflowY: 'auto' }}>
            <TransactionPickList filter={pickable} search={search} onPick={p => onSelect(p.tx, p.amount)} />
          </div>
        </div>
      </div>
    </div>
  );
};
