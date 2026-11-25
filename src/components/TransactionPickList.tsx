import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Search, Calendar, ChevronDown, ChevronRight, ReceiptIndianRupee } from 'lucide-react';
import { useFinance } from '../FinanceContext';
import type { Transaction } from '../types';
import { accountNameOf, formatCurrency, formatDateString, getRewardSplits, rewardSplitGross, splitPurchaseRows } from '../utils';

/** One pick from the list. `amount` is what was picked is worth — use it, not `tx.amount`, which on
 *  a part-paid purchase picked whole is only the primary account's share. `wholePurchase` is true
 *  exactly when `tx` is such a purchase's anchor standing for ALL of it. */
export interface TxPick {
  tx: Transaction;
  amount: number;
  wholePurchase: boolean;
}

interface TransactionPickListProps {
  /** Which rows can be picked at all. Applied to the top-level rows; a part-paid purchase's sub logs
   *  ride along with it. */
  filter: (tx: Transaction) => boolean;
  search: string;
  onPick: (pick: TxPick) => void;
}

/* The month → day → row list both transaction pickers show: Link Ledger / Link (TransactionSelector)
   and the Splits "add expense" sheet. One copy, so the two cannot drift on how a split purchase reads.

   A part-paid purchase is ONE payment written as several rows: the anchor on the primary account
   (₹19 on Canara) and a "Paid toward:" leg per other source (₹1,076 from the Myntra Wallet). Listed
   flat, a picker offered the halves and never the ₹1,095 order. So the purchase is one row at its
   full price, naming every account that paid — tap it to take the whole thing — and the ledger's
   linked-entry card under it opens the sub logs, each pickable on its own for when only one part
   is wanted. */
export const TransactionPickList: React.FC<TransactionPickListProps> = ({ filter, search, onPick }) => {
  const { data } = useFinance();
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({
    [format(new Date(), 'yyyy-MM')]: true
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Each split anchor's sub logs, and the set of legs that therefore never list at the top level.
  // Built once per data change: the leg lookup is a scan of every transaction per anchor, and the
  // list re-renders on every keystroke in the search box.
  const { subLogsOf, legIds } = useMemo(() => {
    const subLogsOf = new Map<string, Transaction[]>();
    const legIds = new Set<string>();
    data.transactions.forEach(t => {
      if (getRewardSplits(t).length === 0) return;
      const legs = splitPurchaseRows(t, data.transactions).slice(1);
      if (legs.length === 0) return;
      legs.forEach(l => legIds.add(l.id));
      // The anchor's own share is a sub log too, but only when the top row stands for MORE than it.
      // On a paired category (a CC Payment) there is no full price to assemble — rewardSplitGross is
      // 0 and the top row is the anchor itself — so only the legs sit underneath.
      subLogsOf.set(t.id, rewardSplitGross(t) > 0 ? [t, ...legs] : legs);
    });
    return { subLogsOf, legIds };
  }, [data.transactions]);

  const priceOf = (t: Transaction) => rewardSplitGross(t) || t.amount;
  // The whole purchase names every account that paid for it; anything else names its own.
  const accountsOf = (t: Transaction) => {
    if (rewardSplitGross(t) <= 0) return accountNameOf(t.accountId, data.accounts);
    return [t.accountId, ...getRewardSplits(t).map(s => s.accountId)]
      .filter(Boolean)
      .map(id => accountNameOf(id, data.accounts))
      .join(' + ');
  };
  const subtitleOf = (t: Transaction, accounts: string) => (accounts && accounts !== 'Unknown' ? `${t.category} · ${accounts}` : t.category);

  const q = search.toLowerCase();
  const filtered = data.transactions
    .filter(t => !legIds.has(t.id))
    .filter(filter)
    .filter(t => (t.description || '').toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (filtered.length === 0) {
    return (
      <div className="flex-col align-center justify-center gap-4" style={{ padding: '4rem 2rem', opacity: 0.5 }}>
        <Search size={40} />
        <p>No transactions found</p>
      </div>
    );
  }

  const months = Array.from(new Set(filtered.map(t => t.date.substring(0, 7)))).sort((a, b) => b.localeCompare(a));

  /* The picker's own compact row — receipt tile, description, "Category · Account", amount. Only the
     disclosure under a split purchase borrows the ledger's look (its linked-entry card); the rows
     stay plain so the list scans as a list of choices, not a second ledger. */
  const renderRow = (t: Transaction, opts: { amount: number; whole: boolean; nested?: boolean; withBorder?: boolean }) => (
    <div
      className="flex justify-between align-center clickable"
      onClick={() => onPick({ tx: t, amount: opts.amount, wholePurchase: opts.whole })}
      style={{
        padding: opts.nested ? '0.75rem 1rem' : '1rem 1.5rem',
        borderBottom: opts.withBorder ? '1px solid var(--border-color)' : 'none',
        flexWrap: 'nowrap',
      }}
    >
      <div className="flex align-center gap-3 flex-1" style={{ minWidth: 0 }}>
        <div className="flex-center" style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', flexShrink: 0 }}>
          <ReceiptIndianRupee size={18} className="text-primary" />
        </div>
        <div className="flex-col" style={{ minWidth: 0, flex: 1 }}>
          <span className="font-bold truncate" style={{ fontSize: '0.9rem', display: 'block' }}>{t.description}</span>
          <span className="text-xs text-muted truncate" style={{ display: 'block' }}>
            {subtitleOf(t, opts.whole ? accountsOf(t) : accountNameOf(t.accountId, data.accounts))}
          </span>
        </div>
      </div>
      <div className="flex-col align-end" style={{ flexShrink: 0, marginLeft: '1rem' }}>
        <span className={`text-mono font-bold ${t.type === 'debit' ? 'text-danger' : 'text-success'}`}>
          {t.type === 'debit' ? '-' : '+'}{formatCurrency(opts.amount)}
        </span>
      </div>
    </div>
  );

  return (
    <>
      {months.map(m => {
        const txsInMonth = filtered.filter(t => t.date.substring(0, 7) === m);
        const isExpanded = expandedMonths[m];
        const monthLabel = new Date(`${m}-01`).toLocaleString('default', { month: 'long', year: 'numeric' });
        const byDate = txsInMonth.reduce((acc, tx) => {
          (acc[tx.date] ||= []).push(tx);
          return acc;
        }, {} as Record<string, Transaction[]>);

        return (
          <div key={m} className="flex-col">
            <div
              className="flex justify-between align-center clickable"
              onClick={() => setExpandedMonths(prev => ({ ...prev, [m]: !prev[m] }))}
              style={{ padding: '0.75rem 1.5rem', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border-color)' }}
            >
              <div className="flex align-center gap-3 text-mono font-bold" style={{ fontSize: '0.8rem', letterSpacing: '1px' }}>
                <Calendar size={14} className="text-primary" />
                {/* Optical centring: Overpass Mono's ascent and descent are asymmetric, so an all-caps
                    label draws ~0.2em above the middle of its own line box. Flexbox centres that box, not
                    the glyphs, and line-height cannot move them — the half-leading cancels out. A nudge of
                    the measured difference is the only lever. */}
                <span style={{ position: 'relative', top: '0.2em' }}>{monthLabel.toUpperCase()}</span>
              </div>
              <div className="flex align-center gap-2 text-muted" style={{ fontSize: '0.7rem' }}>
                {txsInMonth.length} items
                <ChevronDown size={14} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </div>
            </div>

            {isExpanded && (
              <div className="flex-col fade-in">
                {Object.entries(byDate)
                  .sort((a, b) => b[0].localeCompare(a[0]))
                  .map(([date, txs]) => {
                    const sortedTxs = [...txs].sort((a, b) =>
                      (a.order !== undefined ? a.order : txs.indexOf(a)) - (b.order !== undefined ? b.order : txs.indexOf(b)));
                    return (
                      <div key={date} className="flex-col">
                        <div style={{ padding: '0.4rem 1.5rem', background: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
                          {formatDateString(date)}
                        </div>
                        {sortedTxs.map(t => {
                          const subLogs = subLogsOf.get(t.id);
                          const whole = rewardSplitGross(t) > 0;
                          const isOpen = !!openGroups[t.id];
                          return (
                            /* The row, then — for a split purchase — a hairline and the ledger's rounded
                               linked-entry card hanging off it, holding the disclosure and, opened, the
                               parts. Same borders, radius and margins as TransactionRow's counterparts. */
                            <div key={t.id} style={{ display: 'flex', flexDirection: 'column', width: '100%', borderBottom: '1px solid var(--border-color)' }}>
                              {renderRow(t, { amount: priceOf(t), whole })}
                              {subLogs && (
                                <>
                                  <div style={{ width: '100%', borderTop: '1px solid var(--border-color)' }} />
                                  <div style={{
                                    display: 'flex', flexDirection: 'column', margin: '0 0.6rem 0.5rem',
                                    borderRadius: '0 0 20px 20px', overflow: 'hidden',
                                    borderLeft: '2px solid var(--border-color)', borderRight: '2px solid var(--border-color)',
                                    borderBottom: '2px solid var(--border-color)',
                                  }}>
                                    <button
                                      type="button"
                                      className="linked-entry-toggle"
                                      onClick={e => { e.stopPropagation(); setOpenGroups(prev => ({ ...prev, [t.id]: !prev[t.id] })); }}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 1rem',
                                        border: 'none', color: 'var(--text-muted)', fontSize: '0.72rem', textAlign: 'left',
                                        cursor: 'pointer', width: '100%', fontFamily: 'var(--font-mono)', fontWeight: 600,
                                        letterSpacing: '0.3px',
                                      }}
                                    >
                                      <ChevronRight size={12} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
                                      <span>{isOpen ? 'Hide sub logs' : `${subLogs.length} sub logs · pick one`}</span>
                                    </button>
                                    {isOpen && (
                                      <div style={{ background: 'rgba(255,255,255,0.005)', borderTop: '1px solid var(--border-color)' }}>
                                        {subLogs.map((sub, k) => (
                                          <React.Fragment key={sub.id}>
                                            {renderRow(sub, { amount: sub.amount, whole: false, nested: true, withBorder: k < subLogs.length - 1 })}
                                          </React.Fragment>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};
