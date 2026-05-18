import { useState } from 'react';
import { format, addMonths } from 'date-fns';
import { useFinance } from '../FinanceContext';
import { formatCurrency, generateId, formatDateString, getBillingCycleForDate, getBillingCycleDates } from '../utils';
import type { CashbackStatement, Transaction } from '../types';
import { Info, Pencil, Check, X, ChevronDown, RotateCcw } from 'lucide-react';
import { CustomPicker } from './CustomPicker';

export default function Cashback() {
  const { data, addTransaction, updateCashbackStatement, deleteTransaction, updateTransaction } = useFinance();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<number>(0);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [confirmingStatement, setConfirmingStatement] = useState<{ txId: string, expected: number, prevId: string | null, accountId: string } | null>(null);
  const [depositAccountId, setDepositAccountId] = useState('');
  const [showCreditedCycles, setShowCreditedCycles] = useState(false);

  const getBillingCycleLabel = (txDateStr: string, statementDay?: number) => {
    if (!statementDay) {
      const d = new Date(txDateStr);
      return d.toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    const d = new Date(txDateStr);
    let year = d.getFullYear();
    let month = d.getMonth();
    let day = d.getDate();

    if (day > statementDay) {
      month++;
      if (month > 11) {
        month = 0;
        year++;
      }
    }

    const statementDate = new Date(year, month, statementDay);
    const monthStr = (statementDate.getMonth() + 1).toString().padStart(2, '0');
    const yearStr = statementDate.getFullYear();
    const cycleLabel = `${monthStr}-${yearStr}`;
    const suffix = statementDay === 1 ? 'st' : statementDay === 2 ? 'nd' : statementDay === 3 ? 'rd' : 'th';
    return `Cycle ending ${statementDay}${suffix} ${cycleLabel}`;
  };

  const statements: Record<string, { expected: number, realized: number, confirmed: boolean, statementId: string | null, transaction: Transaction, account: any }> = {};

  data.transactions.forEach(tx => {
    const account = data.accounts.find(a => a.id === tx.accountId);

    // Only show "Delayed" rewards or legacy expectedCashback that isn't instant
    const isDelayed = tx.rewardEarnedType === 'delayed' || (!tx.rewardEarnedType && (tx.expectedCashback || 0) > 0);

    if (isDelayed && tx.type === 'debit' && tx.category !== 'Transfer' && tx.category !== 'CC Payment' && !tx.isTravelTransaction) {
      let expected = tx.rewardEarned || tx.expectedCashback || 0;
      if (expected === 0 && account) {
        const rate = account.defaultCashbackRate || 0;
        expected = (tx.amount * rate) / 100;
        if (account.roundOffCashback) expected = Math.floor(expected);
      }

      if (expected > 0) {
        statements[tx.id] = {
          expected: expected,
          realized: 0,
          confirmed: false,
          statementId: null,
          transaction: tx,
          account
        };
      }
    }
  });

  data.cashbackStatements?.forEach(s => {
    const txId = s.billingCycleYearMonth;
    if (statements[txId]) {
      statements[txId].realized = s.realized;
      statements[txId].confirmed = s.confirmed;
      statements[txId].statementId = s.id;
    }
  });

  const consolidateCycleGroup = (accId: string, sts: any[]) => {
    const confirmedSts = sts.filter(s => s.confirmed);
    const allStIds = sts.map(s => s.transaction.id);

    // If no items confirmed, we still need to delete any existing consolidated tx
    if (confirmedSts.length === 0) {
      const existingTxs = data.transactions.filter(t =>
        t.accountId === accId &&
        t.type === 'credit' &&
        t.category === 'Cashback' &&
        t.linkedTransactionIds?.some(id => allStIds.includes(id))
      );
      existingTxs.forEach(t => deleteTransaction(t.id));
      return;
    }

    const first = confirmedSts[0];
    const acc = first.account;
    const isCC = acc?.type === 'credit_card';

    // Determine target date and description
    let targetDate = format(new Date(), 'yyyy-MM-dd');
    let consolidatedDescription = isCC ? 'Consolidated Cashback' : 'Cashback realized';

    if (acc?.name?.toLowerCase().includes('tide')) {
      const txDate = new Date(first.transaction.date);
      consolidatedDescription = `${format(txDate, "MMM ''yy")} Real Cashback`;
    }

    if (isCC && acc.statementDay) {
      const originalCycle = getBillingCycleForDate(first.transaction.date, acc.statementDay);
      const { endDate } = getBillingCycleDates(originalCycle, acc.statementDay);

      if (acc.cashbackCreditCycle === 'same_cycle') {
        targetDate = format(endDate, 'yyyy-MM-dd');
        consolidatedDescription = 'Cashback from current cycle';
      } else {
        const nextCycleDate = addMonths(endDate, 1);
        targetDate = format(nextCycleDate, 'yyyy-MM-dd');
        consolidatedDescription = 'Cashback from previous cycle';
      }
    }

    const totalRealized = confirmedSts.reduce((sum, s) => sum + s.realized, 0);
    const allLinkedIds = confirmedSts.map(s => s.transaction.id);
    const finalDepositAccountId = isCC ? accId : (first.realizedIntoAccountId || accId);

    // Find ALL existing transactions in the ledger that are linked to ANY of these confirmed cashbacks
    const existingRelatedTxs = data.transactions.filter(t =>
      t.accountId === finalDepositAccountId &&
      t.type === 'credit' &&
      t.category === 'Cashback' &&
      (
        t.linkedTransactionIds?.some(id => allLinkedIds.includes(id)) ||
        (t.date === targetDate && (
          t.description === 'Cashback from current cycle' ||
          t.description === 'Cashback from previous cycle' ||
          t.description === 'Consolidated Cashback'
        ))
      )
    );

    if (existingRelatedTxs.length > 0) {
      const [mainTx, ...toDelete] = existingRelatedTxs;
      toDelete.forEach(t => deleteTransaction(t.id));

      const otherGroupIds = (mainTx.linkedTransactionIds || []).filter(id => !allStIds.includes(id));
      const combinedIds = Array.from(new Set([...otherGroupIds, ...allLinkedIds]));

      // Calculate the portion of the existing transaction that belongs to OTHER groups
      const totalForOtherGroups = data.cashbackStatements
        ? data.cashbackStatements
          .filter(s => s.confirmed && otherGroupIds.includes(s.billingCycleYearMonth))
          .reduce((sum, s) => sum + s.realized, 0)
        : 0;

      // The new total is the sum of the current group's total + the other groups' share
      // If the transaction was found via date/description but had NO linked IDs, 
      // we preserve its full amount as a "manual" entry.
      const belongsToAnyGroup = (mainTx.linkedTransactionIds || []).length > 0;
      const newAmount = belongsToAnyGroup 
        ? totalForOtherGroups + totalRealized 
        : (mainTx.amount || 0) + totalRealized;

      if (newAmount > 0) {
        updateTransaction({
          ...mainTx,
          date: targetDate,
          amount: newAmount,
          description: consolidatedDescription,
          linkedTransactionIds: combinedIds
        });
      } else {
        deleteTransaction(mainTx.id);
      }
    } else if (totalRealized > 0) {
      addTransaction({
        id: generateId(),
        date: targetDate,
        description: consolidatedDescription,
        accountId: finalDepositAccountId,
        type: 'credit',
        amount: totalRealized,
        category: 'Cashback',
        isRecurring: false,
        linkedTransactionIds: allLinkedIds
      });
    }
  };

  const handleConfirmAction = () => {
    if (!confirmingStatement) return;
    const { txId, expected, prevId, accountId } = confirmingStatement;
    const acc = data.accounts.find(a => a.id === accountId);
    const isCC = acc?.type === 'credit_card';
    const isAutomatic = isCC || acc?.type === 'bank_account' || acc?.type === 'debit_card';

    if (!isAutomatic && !depositAccountId) return;

    const realized = editingId === txId ? editingValue : expected;
    const st = statements[txId];
    const finalDepositAccountId = isAutomatic ? accountId : depositAccountId;

    const statement: CashbackStatement = {
      id: prevId || generateId(),
      accountId: accountId,
      billingCycleYearMonth: txId,
      expected,
      realized,
      confirmed: true,
      realizedIntoAccountId: finalDepositAccountId
    };

    updateCashbackStatement(statement);

    // After updating the statement, we trigger the consolidation for the entire group
    // We pass the current cycle's statements to ensure we merge everything correctly
    const cycleLabel = getBillingCycleLabel(st.transaction.date, st.account.statementDay);
    const accKey = `${st.account.name} — ${cycleLabel}`;

    // Prepare the list for consolidation (including the fresh update)
    const currentGroupSts = groupedStatements[accKey] || [];
    const updatedGroupSts = currentGroupSts.map(gs =>
      gs.transaction.id === txId ? { ...gs, confirmed: true, realized, realizedIntoAccountId: finalDepositAccountId } : gs
    );

    consolidateCycleGroup(accountId, updatedGroupSts);

    setConfirmingStatement(null);
    setDepositAccountId('');
    setEditingId(null);
  };

  const handleUndoConfirmation = (txId: string) => {
    const st = statements[txId];
    if (!st || !st.statementId) return;

    const originalSt = data.cashbackStatements?.find(s => s.id === st.statementId);
    if (!originalSt) return;

    const updatedStatement: CashbackStatement = {
      ...originalSt,
      confirmed: false,
      realized: 0
    };

    updateCashbackStatement(updatedStatement);

    // Recalculate consolidation for this group
    const cycleLabel = getBillingCycleLabel(st.transaction.date, st.account.statementDay);
    const accKey = `${st.account.name} — ${cycleLabel}`;
    const currentGroupSts = groupedStatements[accKey] || [];
    const updatedGroupSts = currentGroupSts.map(gs =>
      gs.transaction.id === txId ? { ...gs, confirmed: false, realized: 0 } : gs
    );

    consolidateCycleGroup(st.account.id, updatedGroupSts);
  };

  const statementArray = Object.keys(statements).map(key => statements[key]).sort((a, b) =>
    new Date(b.transaction.date).getTime() - new Date(a.transaction.date).getTime()
  );

  const groupedStatements = statementArray.reduce((acc, st) => {
    const cycleLabel = getBillingCycleLabel(st.transaction.date, st.account.statementDay);
    const accKey = `${st.account.name} — ${cycleLabel}`;
    if (!acc[accKey]) acc[accKey] = [];
    acc[accKey].push(st);
    return acc;
  }, {} as Record<string, typeof statementArray>);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (name: string, currentCollapsed: boolean) => {
    setCollapsedGroups(prev => ({ ...prev, [name]: !currentCollapsed }));
  };

  const [consolidatedFeedback, setConsolidatedFeedback] = useState<string[]>([]);

  const handleConsolidateClick = (accKey: string, accId: string, sts: any[]) => {
    consolidateCycleGroup(accId, sts);
    setConsolidatedFeedback(prev => [...prev, accKey]);
    setTimeout(() => {
      setConsolidatedFeedback(prev => prev.filter(k => k !== accKey));
    }, 2000);
  };

  const sortedEntries = Object.entries(groupedStatements).sort((a, b) => {
    const accountNameA = a[0].split(' — ')[0];
    const accountNameB = b[0].split(' — ')[0];
    if (accountNameA !== accountNameB) {
      return accountNameA.localeCompare(accountNameB);
    }
    const maxDateA = Math.max(...a[1].map(st => new Date(st.transaction.date).getTime()));
    const maxDateB = Math.max(...b[1].map(st => new Date(st.transaction.date).getTime()));
    return maxDateB - maxDateA;
  });

  const cardsData: { cardName: string; cycles: Array<{ accKey: string; sts: any[] }> }[] = [];
  sortedEntries.forEach(([accKey, sts]) => {
    const isFullyCredited = sts.every(st => st.confirmed);
    if (!showCreditedCycles && isFullyCredited) return;

    const cardName = accKey.split(' — ')[0];
    const lastCard = cardsData[cardsData.length - 1];
    if (lastCard && lastCard.cardName === cardName) {
      lastCard.cycles.push({ accKey, sts });
    } else {
      cardsData.push({ cardName, cycles: [{ accKey, sts }] });
    }
  });

  return (
    <div className="flex-col gap-6" style={{ maxWidth: '600px', margin: '0 auto', width: '100%' }}>
      <div className="flex justify-between align-center gap-4">
        <h2 className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>cashback vault</h2>
        {statementArray.length > 0 && (
          <button 
            className="btn flex align-center gap-1 text-mono text-xs" 
            style={{
              height: '32px',
              minHeight: 'auto',
              padding: '0 0.75rem',
              borderRadius: '20px',
              border: '2px solid var(--border-color)',
              boxShadow: '2px 2px 0 var(--border-color)',
              background: showCreditedCycles ? 'var(--accent)' : 'var(--bg-hover)',
              color: showCreditedCycles ? '#fff' : 'var(--text-secondary)',
              fontWeight: 800
            }}
            onClick={() => setShowCreditedCycles(!showCreditedCycles)}
          >
            {showCreditedCycles ? '👁️ SHOWING ALL' : 'FILTER: PENDING'}
          </button>
        )}
      </div>

      <div className="flex-col gap-6 mt-4">
        <p className="text-mono text-xs text-muted" style={{ padding: '0 0.5rem', opacity: 0.6 }}>
          EXPECTED CASHBACK IS TRACKED FOR QUALIFYING TRANSACTIONS. CONFIRM REALIZED AMOUNTS ONCE CREDITED.
        </p>

        {statementArray.length === 0 ? (
          <p className="text-center text-muted p-4">No individual cashback transactions tracked yet.</p>
        ) : cardsData.length === 0 ? (
          <div className="text-center p-6 card flex-col align-center gap-3" style={{ background: 'var(--bg-hover)', border: '1px dashed var(--border-color)', borderRadius: '12px' }}>
            <span style={{ fontSize: '2rem' }}>🎉</span>
            <p className="text-muted text-sm font-bold" style={{ margin: 0 }}>All cashback has been fully credited & confirmed!</p>
            <button 
              className="btn btn-secondary text-mono text-xs" 
              style={{
                height: '32px',
                minHeight: 'auto',
                padding: '0 0.75rem',
                borderRadius: '20px',
                border: '2px solid var(--border-color)',
                boxShadow: '2px 2px 0 var(--border-color)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontWeight: 800
              }}
              onClick={() => setShowCreditedCycles(true)}
            >
              VIEW CREDITED HISTORY
            </button>
          </div>
        ) : (
          <div className="flex-col gap-6">
            {cardsData.map((card) => (
              <div key={card.cardName} className="card flex-col" style={{ padding: 0, overflow: 'hidden' }}>
                {card.cycles.map((cycle, cycleIndex) => {
                  const { accKey: accName, sts } = cycle;
                  const isFullyCredited = sts.every(st => st.confirmed);
                  const isCollapsed = collapsedGroups[accName] !== undefined ? collapsedGroups[accName] : isFullyCredited;
                  const total = sts.reduce((sum, st) => sum + (st.confirmed ? st.realized : st.expected), 0);

                  const confirmedSts = sts.filter(s => s.confirmed);
                  const allLinkedIds = confirmedSts.map(s => s.transaction.id);
                  const isPerfectlyConsolidated = confirmedSts.length > 0 && data.transactions.some(t =>
                    t.type === 'credit' &&
                    t.category === 'Cashback' &&
                    allLinkedIds.length > 0 &&
                    allLinkedIds.every(id => t.linkedTransactionIds?.includes(id))
                  );

                  const isLastCycle = cycleIndex === card.cycles.length - 1;

                  return (
                    <div key={accName} className="flex-col" style={{ borderBottom: isLastCycle ? 'none' : '1px solid var(--border-color)' }}>
                      <div
                        className="flex justify-between clickable"
                        onClick={(e) => {
                          toggleGroup(accName, isCollapsed);
                          if (isCollapsed) {
                            const header = e.currentTarget;
                            setTimeout(() => {
                              const itemsContainer = header.nextElementSibling;
                              if (itemsContainer) {
                                const headerRect = header.getBoundingClientRect();
                                const itemsRect = itemsContainer.getBoundingClientRect();
                                
                                const itemsBottom = itemsRect.bottom;
                                const visibleBottom = window.innerHeight - 100; // Account for bottom tab bar
                                
                                if (itemsBottom > visibleBottom) {
                                  const amountToScroll = itemsBottom - visibleBottom;
                                  const maxScroll = headerRect.top - 80; // Keep header below sticky navbar
                                  const finalScroll = Math.min(amountToScroll, Math.max(0, maxScroll));
                                  
                                  if (finalScroll > 0) {
                                    const appRoot = document.querySelector('.app-root');
                                    if (appRoot) {
                                      const start = appRoot.scrollTop;
                                      const duration = 600;
                                      const startTime = performance.now();
                                      
                                      const easeInOutQuart = (t: number) => t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
                                      
                                      const animateScroll = (currentTime: number) => {
                                        const elapsed = currentTime - startTime;
                                        const progress = Math.min(elapsed / duration, 1);
                                        appRoot.scrollTop = start + (finalScroll * easeInOutQuart(progress));
                                        
                                        if (progress < 1) {
                                          requestAnimationFrame(animateScroll);
                                        }
                                      };
                                      
                                      requestAnimationFrame(animateScroll);
                                    }
                                  }
                                }
                              }
                            }, 550);
                          }
                        }}
                        style={{ padding: '1rem 1.5rem', background: 'var(--bg-hover)', borderBottom: isCollapsed ? 'none' : '1px solid var(--border-color)', transition: '0.2s', alignItems: 'flex-start' }}
                      >
                        <span className="text-mono font-bold" style={{ textTransform: 'uppercase', color: 'var(--text-primary)', letterSpacing: '1px', fontSize: '0.85rem', flex: 1, marginRight: '1.5rem', marginTop: '0.15rem' }}>
                          {accName}
                        </span>

                        <div className="flex align-center gap-3" style={{ flexShrink: 0 }}>
                          <div className="flex align-center gap-2">
                            {confirmedSts.length > 1 && !isPerfectlyConsolidated && (
                              <button
                                className="btn-text text-accent text-mono"
                                style={{
                                  fontSize: '10px',
                                  padding: '2px 8px',
                                  border: `1px solid ${consolidatedFeedback.includes(accName) ? 'var(--success)' : 'var(--accent)'}`,
                                  borderRadius: '4px',
                                  opacity: 0.8,
                                  color: consolidatedFeedback.includes(accName) ? 'var(--success)' : 'var(--accent)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                onClick={(e) => { e.stopPropagation(); handleConsolidateClick(accName, sts[0].account.id, sts); }}
                              >
                                {consolidatedFeedback.includes(accName) ? (
                                  <>
                                    <Check size={10} /> DONE
                                  </>
                                ) : (
                                  'CONSOLIDATE'
                                )}
                              </button>
                            )}
                            <span className="text-mono font-bold" style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>
                              {formatCurrency(total)}
                            </span>
                          </div>
                          <ChevronDown size={18} style={{
                            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                            transition: '0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                            opacity: 0.5,
                            marginTop: '0.1rem'
                          }} />
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateRows: isCollapsed ? '0fr' : '1fr',
                          transition: 'grid-template-rows 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                        }}
                      >
                        <div className="flex-col" style={{ overflow: 'hidden' }}>
                          {sts.map((st, index) => {
                            const txId = st.transaction.id;
                            const isEditing = editingId === txId;
                            return (
                              <div key={txId} className="flex justify-between align-center" style={{
                                padding: '1rem 1.5rem',
                                borderBottom: index === sts.length - 1 ? 'none' : '1px solid var(--border-color)',
                                backgroundColor: isEditing ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                                transition: '0.2s'
                              }}>
                                <div className="flex-col gap-1 min-width-0" style={{ flex: 1, paddingRight: '1rem' }}>
                                  <div className="flex align-center gap-2">
                                    <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }} className="truncate">{st.transaction.description}</span>
                                    <button
                                      className="btn-text text-muted"
                                      style={{ padding: 0 }}
                                      onClick={() => setSelectedTx(st.transaction)}
                                    ><Info size={14} /></button>
                                  </div>
                                  <span className="text-mono text-xs text-muted">
                                    Exp: {formatCurrency(st.expected)}
                                  </span>
                                </div>

                                <div className="flex-col align-end gap-2" style={{ flexShrink: 0 }}>
                                  <div className="flex align-center gap-2">
                                    {isEditing ? (
                                      <input
                                        type="number"
                                        className="input-field text-mono"
                                        style={{ padding: '0.3rem 0.5rem', width: '90px', fontSize: '0.95rem', textAlign: 'right' }}
                                        value={editingValue}
                                        onChange={(e) => setEditingValue(parseFloat(e.target.value))}
                                        autoFocus
                                      />
                                    ) : (
                                      <span className="text-mono" style={{ fontSize: '1.2rem', fontWeight: 700, color: st.confirmed ? 'var(--success)' : 'var(--warning)' }}>
                                        {formatCurrency(st.confirmed ? st.realized : st.expected)}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex align-center gap-2">
                                    {st.confirmed ? (
                                      <span className="badge badge-credit text-mono" style={{ fontSize: '10px' }}>CREDITED</span>
                                    ) : (
                                      <span className="badge text-mono" style={{ backgroundColor: 'var(--warning)', color: '#000', fontSize: '10px' }}>PENDING</span>
                                    )}

                                    {isEditing ? (
                                      <div className="flex gap-3" style={{ marginLeft: '0.5rem' }}>
                                        <button className="btn btn-secondary" style={{ padding: '0.4rem', color: 'var(--text-muted)' }} onClick={() => setEditingId(null)}><X size={16} /></button>
                                        <button className="btn btn-secondary" style={{ padding: '0.4rem', color: 'var(--success)' }} onClick={() => setConfirmingStatement({ txId, expected: st.expected, prevId: st.statementId, accountId: st.account.id })}><Check size={16} /></button>
                                      </div>
                                    ) : (
                                      <div className="flex gap-3" style={{ marginLeft: '0.5rem' }}>
                                        {st.confirmed ? (
                                          <>
                                            <button className="btn btn-secondary" style={{ padding: '0.4rem', color: 'var(--text-muted)' }} title="Undo Confirmation" onClick={() => handleUndoConfirmation(txId)}><RotateCcw size={16} /></button>
                                            <button className="btn btn-secondary" style={{ padding: '0.4rem', color: 'var(--text-muted)' }} title="Edit" onClick={() => { setEditingId(txId); setEditingValue(st.confirmed ? st.realized : st.expected); }}><Pencil size={16} /></button>
                                          </>
                                        ) : (
                                          <>
                                            <button className="btn btn-secondary" style={{ padding: '0.4rem', color: 'var(--success)' }} title="Confirm" onClick={() => setConfirmingStatement({ txId, expected: st.expected, prevId: st.statementId, accountId: st.account.id })}><Check size={16} /></button>
                                            <button className="btn btn-secondary" style={{ padding: '0.4rem', color: 'var(--text-muted)' }} title="Edit" onClick={() => { setEditingId(txId); setEditingValue(st.confirmed ? st.realized : st.expected); }}><Pencil size={16} /></button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmingStatement && (() => {
        const acc = data.accounts.find(a => a.id === confirmingStatement.accountId);
        const isCC = acc?.type === 'credit_card';
        const isAutomatic = isCC || acc?.type === 'bank_account' || acc?.type === 'debit_card';

        return (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h3>Realize Cashback</h3>
                <button onClick={() => setConfirmingStatement(null)}>✕</button>
              </div>
              <div className="modal-body flex-col gap-4">
                {isAutomatic ? (
                  <div className="text-xs text-accent flex align-center" style={{ padding: '0.75rem', border: '1px dashed var(--accent)', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.05)' }}>
                    <span style={{ marginRight: '0.5rem', fontSize: '1rem' }}>ℹ️</span>
                    <span>This will be automatically applied as a credit to <strong>{acc?.name}</strong>.</span>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted">Select the Rewards account where this cashback was credited.</p>
                    <CustomPicker
                      label="Deposit Into"
                      value={depositAccountId}
                      placeholder="Select Reward Account"
                      options={data.accounts.filter(a => a.type === 'rewards' || a.type === 'e_wallet').map(account => ({
                        id: account.id,
                        name: account.name,
                        subtext: account.type.replace('_', ' ')
                      }))}
                      onChange={setDepositAccountId}
                      iconGetter={(_id: string) => '🎁'}
                    />
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setConfirmingStatement(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={!isAutomatic && !depositAccountId} onClick={handleConfirmAction}>Confirm & Apply</button>
              </div>
            </div>
          </div>
        );
      })()}

      {selectedTx && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Transaction Details</h3>
              <button onClick={() => setSelectedTx(null)}>✕</button>
            </div>
            <div className="modal-body flex-col gap-4 text-sm" style={{ paddingBottom: '1rem' }}>
              <div className="flex justify-between" style={{ paddingBottom: '0.75rem', borderBottom: '1px dashed var(--border-color)' }}>
                <span className="text-muted">Description</span>
                <span style={{ fontWeight: 600 }}>{selectedTx.description}</span>
              </div>
              <div className="flex justify-between" style={{ paddingBottom: '0.75rem', borderBottom: '1px dashed var(--border-color)' }}>
                <span className="text-muted">Date</span>
                <span style={{ fontWeight: 500 }}>{formatDateString(selectedTx.date)}</span>
              </div>
              <div className="flex justify-between" style={{ paddingBottom: '0.75rem', borderBottom: '1px dashed var(--border-color)' }}>
                <span className="text-muted">Amount</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{formatCurrency(selectedTx.amount)}</span>
              </div>
              <div className="flex justify-between" style={{ alignItems: 'center' }}>
                <span className="text-muted">Category</span>
                <span className="badge badge-neutral">{selectedTx.category}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
