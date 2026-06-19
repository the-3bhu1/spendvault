import React, { useState } from 'react';
import { format } from 'date-fns';
import { Search, Calendar, ChevronDown, ReceiptIndianRupee, X } from 'lucide-react';
import { useFinance } from '../FinanceContext';
import type { Transaction } from '../types';
import { formatCurrency, formatDateString } from '../utils';

interface TransactionSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (tx: Transaction) => void;
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
  const { data } = useFinance();
  const [search, setSearch] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({
    [format(new Date(), 'yyyy-MM')]: true
  });

  if (!isOpen) return null;

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  
  const filtered = data.transactions
    .filter(t => {
      // Apply custom filter if provided, otherwise default to debit/credit
      if (filter) return filter(t);
      return t.type === 'debit' || t.type === 'credit';
    })
    .filter(t => t.category !== 'Cashback') // Exclude automatic cashback
    .filter(t => t.date <= todayStr) // Exclude future-dated
    .filter(t =>
      (t.description || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.category || '').toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  const months = Array.from(new Set(filtered.map(t => t.date.substring(0, 7))))
    .sort((a, b) => b.localeCompare(a));

  return (
    <div className="modal-overlay flex-center" style={{ zIndex: 10000 }}>
      <div className="modal-content animate-in full-screen flex-col" style={{ padding: 0 }}>
        <div className="flex justify-between align-center" style={{ padding: 'calc(1.5rem + env(safe-area-inset-top, 0px)) 1.75rem 1rem', borderBottom: '2px solid #000', width: '100%' }}>
          <h3 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem', fontSize: '1.4rem', lineHeight: 1, display: 'flex', alignItems: 'center' }}>
            <X size={24} />
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
            {filtered.length === 0 ? (
              <div className="flex-col align-center justify-center gap-4" style={{ padding: '4rem 2rem', opacity: 0.5 }}>
                <Search size={40} />
                <p>No transactions found</p>
              </div>
            ) : (
              months.map(m => {
                const txsInMonth = filtered.filter(t => t.date.substring(0, 7) === m);
                const isExpanded = expandedMonths[m];
                const monthDate = new Date(`${m}-01`);
                const monthLabel = monthDate.toLocaleString('default', { month: 'long', year: 'numeric' });

                return (
                  <div key={m} className="flex-col">
                    <div
                      className="flex justify-between align-center clickable"
                      onClick={() => setExpandedMonths(prev => ({ ...prev, [m]: !prev[m] }))}
                      style={{ padding: '0.75rem 1.5rem', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border-color)' }}
                    >
                      <div className="flex align-center gap-2 text-mono font-bold" style={{ fontSize: '0.8rem', letterSpacing: '1px' }}>
                        <Calendar size={14} className="text-primary" />
                        {monthLabel.toUpperCase()}
                      </div>
                      <div className="flex align-center gap-2 text-muted" style={{ fontSize: '0.7rem' }}>
                        {txsInMonth.length} items
                        <ChevronDown size={14} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="flex-col fade-in">
                        {(() => {
                          const groupedByDate = txsInMonth.reduce((acc, tx) => {
                            if (!acc[tx.date]) acc[tx.date] = [];
                            acc[tx.date].push(tx);
                            return acc;
                          }, {} as Record<string, typeof data.transactions>);

                          return Object.entries(groupedByDate)
                            .sort((a, b) => b[0].localeCompare(a[0]))
                            .map(([date, txs]) => {
                              const sortedTxs = [...txs].sort((a, b) => {
                                const orderA = a.order !== undefined ? a.order : txs.indexOf(a);
                                const orderB = b.order !== undefined ? b.order : txs.indexOf(b);
                                return orderA - orderB;
                              });
                              return (
                              <div key={date} className="flex-col">
                                <div style={{ padding: '0.4rem 1.5rem', background: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
                                  {formatDateString(date)}
                                </div>
                                {sortedTxs.map(t => (
                                  <div
                                    key={t.id}
                                    className="flex justify-between align-center clickable"
                                    onClick={() => onSelect(t)}
                                    style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'nowrap' }}
                                  >
                                    <div className="flex align-center gap-3 flex-1" style={{ minWidth: 0 }}>
                                      <div className="flex-center" style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', flexShrink: 0 }}>
                                        <ReceiptIndianRupee size={18} className="text-primary" />
                                      </div>
                                      <div className="flex-col" style={{ minWidth: 0, flex: 1 }}>
                                        <span className="font-bold truncate" style={{ fontSize: '0.9rem', display: 'block' }}>{t.description}</span>
                                        <span className="text-xs text-muted">{t.category}</span>
                                      </div>
                                    </div>
                                    <div className="flex-col align-end" style={{ flexShrink: 0, marginLeft: '1rem' }}>
                                      <span className={`text-mono font-bold ${t.type === 'debit' ? 'text-danger' : 'text-success'}`}>
                                        {t.type === 'debit' ? '-' : '+'}{formatCurrency(t.amount)}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              );
                            });
                        })()}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
