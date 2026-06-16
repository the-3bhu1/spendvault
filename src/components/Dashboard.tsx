import { useMemo, useState } from 'react';
import { useFinance } from '../FinanceContext';
import { getCurrentMonthStr, formatCurrency, getOrdinalSuffix, getBillingCycleForDate, getLatestBilledCycle } from '../utils';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import RollingNumber from './RollingNumber';
import type { Account } from '../types';
import { format, parseISO, addMonths } from 'date-fns';

export default function Dashboard({ onViewStatement }: { onViewStatement: (acc: Account) => void }) {
  const { data } = useFinance();
  const currentMonth = getCurrentMonthStr(); // "YYYY-MM"
  const [activeCatIdx, setActiveCatIdx] = useState<number | null>(null);
  const [activeAccIdx, setActiveAccIdx] = useState<number | null>(null);

  const { totalSpend, spendByCategory, spendByAccount, ccDues, totalBilledCC, totalUnbilledCC } = useMemo(() => {
    let spend = 0;
    const catSpend: Record<string, number> = {};
    const accSpend: Record<string, number> = {};
    const dues: { accountName: string, billed: number, unbilled: number, total: number, dueDayStr?: string }[] = [];

    // Monthly Spend
    const currentMonthTxs = data.transactions.filter(t => t.date.startsWith(currentMonth));
    currentMonthTxs.forEach(t => {
      if (t.type === 'debit') {
        const account = data.accounts.find(a => a.id === t.accountId);
        {
          const cat = t.category.toLowerCase();
          if (cat === 'transfer' || cat === 'cc payment' || cat === 'ncmc travel recharge' || cat === 'sip' || cat === 'stocks') return;
          const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
          spend += effectiveAmount;
          catSpend[t.category] = (catSpend[t.category] || 0) + effectiveAmount;
          accSpend[account?.name || 'Unknown'] = (accSpend[account?.name || 'Unknown'] || 0) + effectiveAmount;
        }
      }
    });

    // Credit Card Dues calculation - Simple Version 1 Logic
    data.accounts.filter(a => a.type === 'credit_card').forEach(cc => {
      const statementDay = cc.statementDay || 1;
      const billedCycle = getLatestBilledCycle(statementDay);
      const unbilledCycle = format(addMonths(parseISO(`${billedCycle}-01`), 1), 'yyyy-MM');
      
      let billed = 0;
      let unbilled = 0;
      
      data.transactions.forEach(t => {
        if (t.accountId === cc.id) {
          const txCycle = t.appliedBillingCycleYearMonth || getBillingCycleForDate(t.date, statementDay);
          
          if (txCycle === unbilledCycle) {
            unbilled += t.type === 'debit' ? t.amount : -t.amount;
          } else if (txCycle === billedCycle) {
            billed += t.type === 'debit' ? t.amount : -t.amount;
          }
        }
      });

      const rawBilled = Math.max(0, billed);
      let finalBilled = rawBilled;
      const rounding = cc.statementRounding || 'none';
      if (rounding === 'round') finalBilled = Math.round(rawBilled);
      else if (rounding === 'floor') finalBilled = Math.floor(rawBilled);
      else if (rounding === 'ceil') finalBilled = Math.ceil(rawBilled);

      const finalUnbilled = Math.max(0, unbilled);
      const totalOutstanding = finalBilled + finalUnbilled;
      
      if (totalOutstanding > 0 || finalBilled > 0) {
        dues.push({ 
          accountName: cc.name, 
          billed: finalBilled,
          unbilled: finalUnbilled,
          total: totalOutstanding,
          dueDayStr: cc.dueDay ? getOrdinalSuffix(cc.dueDay) : undefined
        });
      }
    });

    const totalBilledCC = dues.reduce((sum, d) => sum + d.billed, 0);
    const totalUnbilledCC = dues.reduce((sum, d) => sum + d.unbilled, 0);

    return { totalSpend: spend, spendByCategory: catSpend, spendByAccount: accSpend, ccDues: dues, totalBilledCC, totalUnbilledCC };
  }, [data, currentMonth]);


  const pieData = Object.entries(spendByCategory).map(([name, value]) => ({ name, value }));
  const accPieData = Object.entries(spendByAccount).map(([name, value]) => ({ name, value }));
  const COLORS = ['#38bdf8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  const ACC_COLORS = ['#8b5cf6', '#ec4899', '#f59e0b', '#38bdf8', '#10b981', '#ef4444'];

  return (
    <div className="flex-col gap-6">
      <div className="flex justify-between align-center">
        <h2 className="text-mono" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>dashboard</h2>
        <span className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>
          {new Date(`${currentMonth}-01`).toLocaleString('default', { month: 'short' })} '{currentMonth.substring(2, 4)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-6 tour-dashboard-stats">
        <div className="card flex-col gap-2">
          <span className="text-muted text-sm">Total Spend</span>
          <h3 className="text-serif" style={{ fontSize: '2rem', fontWeight: 700 }}>{formatCurrency(totalSpend)}</h3>
        </div>
        <div className="card flex-col gap-2">
          <span className="text-muted text-sm">Active CC Dues</span>
          <h3 className="text-serif" style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--warning)', margin: 0 }}>
            {formatCurrency(ccDues.reduce((sum, d) => sum + d.total, 0))}
          </h3>
          <div className="flex gap-4" style={{ marginTop: '0.25rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
            <div className="flex-col">
              <span className="text-mono" style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>Billed</span>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--danger)' }}>{formatCurrency(totalBilledCC)}</span>
            </div>
            <div className="flex-col">
              <span className="text-mono" style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>Unbilled</span>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatCurrency(totalUnbilledCC)}</span>
            </div>
          </div>
        </div>

      </div>

      <div className="card flex-col gap-4">
        <h3>Current Outstanding Dues</h3>
        {ccDues.length === 0 ? (
          <p className="text-muted text-sm">No pending credit card dues.</p>
        ) : (
           <div className="flex-col gap-3">
             {ccDues.map((due, idx) => {
               const account = data.accounts.find(a => a.name === due.accountName);
               return (
                <div 
                  key={idx} 
                  className="flex-col" 
                  onClick={() => account && onViewStatement(account)}
                  style={{ background: 'var(--bg-color)', borderRadius: '12px', padding: '1.25rem', cursor: account ? 'pointer' : 'default', border: '1px solid var(--border-color)', transition: 'transform 0.2s ease', position: 'relative' }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <div className="flex justify-between align-center" style={{ marginBottom: '0.75rem' }}>
                    <div className="flex align-center gap-3">
                      <span className="text-xl">💳</span>
                      <span style={{ fontWeight: 600 }}>{due.accountName}</span>
                    </div>
                    <div className="flex align-center gap-2">
                      <span className="text-serif" style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '1.3rem' }}>{formatCurrency(due.total)}</span>
                      <span className="text-muted" style={{ fontSize: '1.2rem', opacity: 0.5 }}>›</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between align-center text-sm" style={{ padding: '0.5rem 0', borderTop: '1px dashed var(--border-color)', borderBottom: '1px dashed var(--border-color)' }}>
                    <div>
                      <span className="text-secondary" style={{ display: 'block' }}>Statement Bill {due.billed > 0 && due.dueDayStr && <span className="text-xs" style={{ color: 'var(--warning)' }}>(Due {due.dueDayStr})</span>}</span>
                    </div>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{formatCurrency(due.billed)}</span>
                  </div>
                  <div className="flex justify-between align-center text-sm" style={{ padding: '0.5rem 0 0 0' }}>
                    <span className="text-secondary">Unbilled Spends</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{formatCurrency(due.unbilled)}</span>
                  </div>
                </div>
               );
             })}
           </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="card flex-col gap-4">
          <span className="text-xs text-muted uppercase font-bold" style={{ letterSpacing: '1.5px', opacity: 0.6 }}>Spend by Category</span>
          {pieData.length === 0 ? (
             <p className="text-muted text-sm text-center" style={{ padding: '2rem 0' }}>No spending data for this month.</p>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ height: '300px', width: '300px', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      innerRadius={95}
                      outerRadius={135}
                      paddingAngle={0}
                      dataKey="value"
                      stroke="none"
                      onMouseEnter={(_, index) => setActiveCatIdx(index)}
                      onMouseLeave={() => setActiveCatIdx(null)}
                      onClick={(_, index) => setActiveCatIdx(index)}
                    >
                      {pieData.map((_, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={COLORS[index % COLORS.length]}
                          style={{
                            filter: activeCatIdx === index ? 'drop-shadow(0 0 8px rgba(0,0,0,0.2))' : 'none',
                            opacity: activeCatIdx === null || activeCatIdx === index ? 1 : 0.6,
                            transition: 'all 0.3s ease',
                            cursor: 'pointer'
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  pointerEvents: 'none'
                }}>
                  <span className="text-xs text-muted uppercase font-bold" style={{ display: 'block', marginBottom: '0.25rem' }}>
                    {activeCatIdx !== null ? pieData[activeCatIdx].name : 'Total Spend'}
                  </span>
                  <RollingNumber 
                    value={activeCatIdx !== null ? pieData[activeCatIdx].value : totalSpend} 
                    fontSize="1.8rem" 
                  />
                  <span className="text-xs text-muted font-bold" style={{ display: 'block', marginTop: '0.2rem' }}>
                    {activeCatIdx !== null ? ((pieData[activeCatIdx].value / (totalSpend || 1)) * 100).toFixed(1) : '100'}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card flex-col gap-4">
          <span className="text-xs text-muted uppercase font-bold" style={{ letterSpacing: '1.5px', opacity: 0.6 }}>Spend by Account</span>
          {accPieData.length === 0 ? (
             <p className="text-muted text-sm text-center" style={{ padding: '2rem 0' }}>No spending data for this month.</p>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ height: '300px', width: '300px', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={accPieData}
                      innerRadius={95}
                      outerRadius={135}
                      paddingAngle={0}
                      dataKey="value"
                      stroke="none"
                      onMouseEnter={(_, index) => setActiveAccIdx(index)}
                      onMouseLeave={() => setActiveAccIdx(null)}
                      onClick={(_, index) => setActiveAccIdx(index)}
                    >
                      {accPieData.map((_, index) => (
                        <Cell 
                          key={`acc-cell-${index}`} 
                          fill={ACC_COLORS[index % ACC_COLORS.length]}
                          style={{
                            filter: activeAccIdx === index ? 'drop-shadow(0 0 8px rgba(0,0,0,0.2))' : 'none',
                            opacity: activeAccIdx === null || activeAccIdx === index ? 1 : 0.6,
                            transition: 'all 0.3s ease',
                            cursor: 'pointer'
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  pointerEvents: 'none'
                }}>
                  <span className="text-xs text-muted uppercase font-bold" style={{ display: 'block', marginBottom: '0.25rem' }}>
                    {activeAccIdx !== null ? accPieData[activeAccIdx].name : 'Total Spend'}
                  </span>
                  <RollingNumber 
                    value={activeAccIdx !== null ? accPieData[activeAccIdx].value : totalSpend} 
                    fontSize="1.8rem" 
                  />
                  <span className="text-xs text-muted font-bold" style={{ display: 'block', marginTop: '0.2rem' }}>
                    {activeAccIdx !== null ? ((accPieData[activeAccIdx].value / (totalSpend || 1)) * 100).toFixed(1) : '100'}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
