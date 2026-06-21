import { useState, useMemo, useEffect, useRef } from 'react';
import { useFinance } from '../FinanceContext';
import { formatCurrency, formatDateString } from '../utils';
import { TrendingUp, TrendingDown, Star, Trophy, Calendar, ArrowUpRight, ArrowDownRight, Zap, Activity, Hash, Target, Pencil, Trash2, Check, X } from 'lucide-react';


import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Label } from 'recharts';
import RollingNumber from './RollingNumber';
import type { Transaction } from '../types';
import { CustomPicker } from './CustomPicker';

const isCountableTransaction = (tx: Transaction) => {
  const catLower = (tx.category || '').toLowerCase();
  // Scenario 1, 2, 3: Transfer, CC Payment, SIP, NCMC Travel Recharge
  if (['transfer', 'cc payment', 'sip', 'ncmc travel recharge'].includes(catLower)) {
    return false;
  }
  // Scenario 4: Cashback auto log
  if (catLower === 'cashback') {
    return false;
  }
  // Scenario 5: Reward Split auto log
  if (tx.isRewardTransaction) {
    return false;
  }
  return true;
};

// Categories that aren't discretionary spend, so a monthly budget makes no sense for them.
const NON_BUDGET_CATEGORIES = new Set([
  'transfer', 'cc payment', 'ncmc travel recharge', 'sip', 'stocks', 'commodity', 'cashback', 'income', 'salary',
]);

// Inline ₹ editor for a category budget: a full-width field (with a ₹ prefix) plus Save / Cancel.
// A `resolved` flag guards against onBlur firing a second commit after Enter/Escape/button already
// resolved the edit (so Cancel truly discards without re-saving). The Save/Cancel buttons use
// onMouseDown preventDefault so clicking them doesn't blur-commit the input first.
function BudgetInput({ value, onChange, onCommit, onCancel }: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const resolved = useRef(false);
  return (
    <div className="flex align-center gap-2">
      <div
        className="flex align-center"
        style={{ flex: 1, minWidth: 0, background: 'var(--bg-color)', border: '1px solid var(--accent)', borderRadius: '8px', padding: '0 0.7rem' }}
      >
        <span className="text-muted" style={{ fontWeight: 700, fontSize: '0.95rem', flexShrink: 0 }}>₹</span>
        <input
          type="number"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={() => { if (!resolved.current) onCommit(); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { resolved.current = true; onCommit(); }
            if (e.key === 'Escape') { resolved.current = true; onCancel(); }
          }}
          placeholder="monthly cap"
          style={{
            flex: 1, minWidth: 0, width: '100%', padding: '0.55rem 0.4rem',
            background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.95rem',
          }}
        />
      </div>
      <button
        className="btn btn-secondary"
        style={{ width: '34px', height: '34px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success)' }}
        onMouseDown={e => e.preventDefault()}
        onClick={() => { resolved.current = true; onCommit(); }}
        title="Save"
      >
        <Check size={16} />
      </button>
      <button
        className="btn btn-secondary"
        style={{ width: '34px', height: '34px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
        onMouseDown={e => e.preventDefault()}
        onClick={() => { resolved.current = true; onCancel(); }}
        title="Cancel"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export default function Insights() {
  const { data, updateCategoryBudgets } = useFinance();
  
  // Get all unique months from transactions, sorted descending (latest first)
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    data.transactions.forEach(t => {
      // Extract YYYY-MM
      months.add(t.date.substring(0, 7));
    });
    return Array.from(months).sort().reverse();
  }, [data.transactions]);

  const [selectedMonth, setSelectedMonth] = useState<string>(availableMonths[0] || '');

  useEffect(() => {
    if (availableMonths.length > 0 && (!selectedMonth || !availableMonths.includes(selectedMonth))) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  const insights = useMemo<{
    displayMonth: string;
    totalSpend: number;
    totalIncome: number;
    prevSpend: number;
    topCategory: { name: string; amount: number } | null;
    topAccount: { name: string; amount: number } | null;
    biggestTx: Transaction | null;
    txCount: number;
    catSpend: Record<string, number>;
    accSpend: Record<string, number>;
    prevCatSpend: Record<string, number>;
    monthTxs: Transaction[];
    weekendSpend: number;
    recurringSpend: number;
    daysInMonth: number;
    streakDays: { day: number; spend: number; state: string }[];
    tagSpend: Record<string, number>;
  } | null>(() => {

    if (!selectedMonth) return null;

    const monthsSorted = [...availableMonths].reverse();
    const currentIdx = monthsSorted.indexOf(selectedMonth);
    const prevMonth = currentIdx > 0 ? monthsSorted[currentIdx - 1] : null;

    const monthTxs = data.transactions.filter(t => t.date.startsWith(selectedMonth));
    const prevMonthTxs = prevMonth ? data.transactions.filter(t => t.date.startsWith(prevMonth)) : [];
    
    const calculateStats = (txs: Transaction[]) => {
      let spend = 0;
      let income = 0;
      const cat: Record<string, number> = {};
      const acc: Record<string, number> = {};
      let biggest: Transaction | null = null;
      txs.forEach(t => {
        const isSystemType = t.category.toLowerCase() === 'transfer' || t.category.toLowerCase() === 'cc payment' || t.category.toLowerCase() === 'ncmc travel recharge' || t.category.toLowerCase() === 'sip';
        if (isSystemType) return;
        const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
        
        if (t.type === 'debit' && !isSystemType) {
          spend += effectiveAmount;
          cat[t.category] = (cat[t.category] || 0) + effectiveAmount;
          const account = data.accounts.find(a => a.id === t.accountId);
          acc[account?.name || 'Unknown'] = (acc[account?.name || 'Unknown'] || 0) + effectiveAmount;
          if (!biggest || effectiveAmount > (biggest.amount - (biggest.excludedAmount || (biggest.excludeFromStats ? biggest.amount : 0)))) biggest = t;
        } else if (t.type === 'credit') {
          income += effectiveAmount;
        }
      });
      return { spend, income, cat, acc, biggest };
    };

    const currentStats = calculateStats(monthTxs);
    const prevStats = calculateStats(prevMonthTxs);

    const topCategory = Object.entries(currentStats.cat).sort((a, b) => b[1] - a[1])[0];
    const topAccount = Object.entries(currentStats.acc).sort((a, b) => b[1] - a[1])[0];

    const displayMonth = new Date(`${selectedMonth}-01`).toLocaleString('default', { month: 'long', year: 'numeric' });
    
    const weekendSpend = monthTxs.filter(t => {
      const d = new Date(t.date).getDay();
      const isSystemType = t.category.toLowerCase() === 'transfer' || t.category.toLowerCase() === 'cc payment' || t.category.toLowerCase() === 'ncmc travel recharge' || t.category.toLowerCase() === 'sip';
      if (isSystemType) return false;
      const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
      return (d === 0 || d === 6) && t.type === 'debit' && effectiveAmount > 0;
    }).reduce((s, t) => s + (t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0))), 0);

    const recurringSpend = monthTxs.filter(t => {
      const isSystemType = t.category.toLowerCase() === 'transfer' || t.category.toLowerCase() === 'cc payment' || t.category.toLowerCase() === 'ncmc travel recharge' || t.category.toLowerCase() === 'sip';
      if (isSystemType) return false;
      const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
      return t.isRecurring && t.type === 'debit' && effectiveAmount > 0;
    }).reduce((s, t) => s + (t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0))), 0);

    const [y, m] = selectedMonth.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();

    const tagSpend: Record<string, number> = {};
    monthTxs.forEach(t => {
      if (t.type !== 'debit') return;
      const isSystemType = ['transfer', 'cc payment', 'sip', 'ncmc travel recharge'].includes(t.category.toLowerCase());
      if (isSystemType) return;
      const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
      if (effectiveAmount <= 0) return;
      (t.tags || []).forEach(tag => {
        tagSpend[tag] = (tagSpend[tag] || 0) + effectiveAmount;
      });
    });

    return {
      displayMonth,
      totalSpend: currentStats.spend,
      totalIncome: currentStats.income,
      prevSpend: prevStats.spend,
      topCategory: topCategory ? { name: topCategory[0], amount: topCategory[1] } : null,
      topAccount: topAccount ? { name: topAccount[0], amount: topAccount[1] } : null,
      biggestTx: currentStats.biggest,
      txCount: monthTxs.filter(isCountableTransaction).length,
      catSpend: currentStats.cat,
      accSpend: currentStats.acc,
      prevCatSpend: prevStats.cat,
      monthTxs,
      weekendSpend,
      recurringSpend,
      daysInMonth,
      tagSpend,
      streakDays: Array.from({ length: daysInMonth }, (_, i) => {
        const dStr = `${y}-${m.toString().padStart(2, '0')}-${(i + 1).toString().padStart(2, '0')}`;
        const dayTxs = monthTxs.filter(t => {
          const isSystemType = t.category.toLowerCase() === 'transfer' || t.category.toLowerCase() === 'cc payment' || t.category.toLowerCase() === 'ncmc travel recharge' || t.category.toLowerCase() === 'sip';
          if (isSystemType) return false;
          const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
          return t.date === dStr && t.type === 'debit' && effectiveAmount > 0;
        });
        const spend = dayTxs.reduce((s, t) => s + (t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0))), 0);
        let state = '';
        if (spend > 0) {
          state = spend > (currentStats.spend / daysInMonth) * 1.5 ? 'heavy' : 'active';
        }
        return { day: i + 1, spend, state };
      })
    };
  }, [selectedMonth, data, availableMonths]);

  // Data for the Bar Chart (Monthly Trends)
  const monthlyTrendsData = useMemo(() => {
    // Get last 6 available months
    const last6Months = [...availableMonths].reverse().slice(-6);
    return last6Months.map(m => {
      const txs = data.transactions.filter(t => t.date.startsWith(m));
      const spend = txs.reduce((s, t) => {
        const isSystemType = t.category.toLowerCase() === 'transfer' || t.category.toLowerCase() === 'cc payment' || t.category.toLowerCase() === 'ncmc travel recharge' || t.category.toLowerCase() === 'sip';
        if (isSystemType) return s;
        const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
        return (t.type === 'debit' && effectiveAmount > 0) ? s + effectiveAmount : s;
      }, 0);
      return {
        name: new Date(`${m}-01`).toLocaleString('default', { month: 'short' }).toUpperCase(),
        amount: spend,
        originalMonth: m
      };
    });
  }, [availableMonths, data.transactions]);

  const avgMonthlySpend = useMemo(() => {
    if (monthlyTrendsData.length === 0) return 0;
    return monthlyTrendsData.reduce((s, d) => s + d.amount, 0) / monthlyTrendsData.length;
  }, [monthlyTrendsData]);

  const [activeCatIndex, setActiveCatIndex] = useState<number | null>(null);
  const [activeAccIndex, setActiveAccIndex] = useState<number | null>(null);

  // ── Category budgets ──────────────────────────────────────────────────────
  // A budget is a monthly cap (₹) per category; progress is the SELECTED month's spend in that
  // category (insights.catSpend), so switching months re-evaluates against the same cap.
  const [editingBudgetCat, setEditingBudgetCat] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState('');

  // Categories eligible for a budget (discretionary spend only).
  const spendableCats = useMemo(
    () => data.categories.filter(c => !NON_BUDGET_CATEGORIES.has(c.toLowerCase())),
    [data.categories]
  );

  // Only categories the user has actually set a budget for get a row + progress bar.
  const budgetRows = useMemo(() => {
    if (!insights) return [];
    const budgets = data.categoryBudgets || {};
    return spendableCats
      .filter(c => (budgets[c] || 0) > 0)
      .map(cat => ({ cat, budget: budgets[cat], spent: insights.catSpend[cat] || 0 }))
      .sort((a, b) => b.spent / b.budget - a.spent / a.budget);
  }, [insights, data.categoryBudgets, spendableCats]);

  const budgetedCount = budgetRows.length;

  // Categories offered in the "add a budget" picker: spendable, not yet budgeted, and not the one
  // currently being added (its input is already showing).
  const addableCats = useMemo(
    () => spendableCats.filter(c => !((data.categoryBudgets || {})[c] > 0) && c !== editingBudgetCat),
    [spendableCats, data.categoryBudgets, editingBudgetCat]
  );

  // A category picked from the add-picker that doesn't have a saved budget yet (input is open).
  const pendingNewCat = editingBudgetCat && !((data.categoryBudgets || {})[editingBudgetCat] > 0)
    ? editingBudgetCat : null;

  const startEditBudget = (cat: string, current: number) => {
    setEditingBudgetCat(cat);
    setBudgetInput(current > 0 ? String(current) : '');
  };

  const saveBudget = (cat: string) => {
    const val = Math.max(0, Math.round(Number(budgetInput) || 0));
    const next = { ...(data.categoryBudgets || {}) };
    if (val > 0) next[cat] = val;
    else delete next[cat]; // clearing the field cancels/removes the budget
    updateCategoryBudgets(next);
    setEditingBudgetCat(null);
  };

  const removeBudget = (cat: string) => {
    const next = { ...(data.categoryBudgets || {}) };
    delete next[cat];
    updateCategoryBudgets(next);
    if (editingBudgetCat === cat) setEditingBudgetCat(null);
  };
  const [highlightedBarMonth, setHighlightedBarMonth] = useState<string>(selectedMonth);

  // Reset bar highlight when dropdown month changes
  useEffect(() => {
    setHighlightedBarMonth(selectedMonth);
  }, [selectedMonth]);


  const catPieData = insights ? Object.entries(insights.catSpend).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) : [];
  const accPieData = insights ? Object.entries(insights.accSpend).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) : [];

  const COLORS = ['#38bdf8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  const ACC_COLORS = ['#8b5cf6', '#ec4899', '#f59e0b', '#38bdf8', '#10b981', '#ef4444'];

  return (
    <div className="flex-col gap-6 insights-tab-root">
      <div className="flex justify-between align-center">
        <h2 className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>insights</h2>
        {availableMonths.length > 0 && (
          <div style={{ width: '150px', flexShrink: 0 }}>
            <CustomPicker
              label="Select Month" 
              hideLabel={true}
              value={selectedMonth}
              options={availableMonths.map(m => {
                const d = new Date(`${m}-01`);
                const year = d.getFullYear();
                return {
                  id: m,
                  name: `${d.toLocaleString('default', { month: 'short' })} '${d.getFullYear().toString().slice(-2)}`,
                  group: `Year ${year}`
                };
              })}
              onChange={setSelectedMonth}
              iconGetter={() => <Calendar size={18} />}
              allowTextWrap={false}
            />
          </div>
        )}
      </div>

      {!insights ? (
        <div className="card text-center flex-col gap-4" style={{ padding: '4rem 2rem' }}>
          <p className="text-muted">No insights available for this period. Try logging some transactions!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <div className="card flex-col gap-4">
             <div className="flex justify-between align-start">
               <div className="flex align-center gap-2 text-muted">
                 <TrendingDown size={20} color="var(--danger)" />
                 <span className="text-mono font-bold uppercase" style={{ fontSize: '0.75rem', letterSpacing: '1px' }}>Total Spend</span>
               </div>
               {insights.prevSpend > 0 && (
                 <div className={`badge text-mono ${insights.totalSpend > insights.prevSpend ? 'badge-debit' : 'badge-credit'}`} style={{ fontSize: '0.65rem' }}>
                   {insights.totalSpend > insights.prevSpend ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                   {Math.abs(((insights.totalSpend - insights.prevSpend) / insights.prevSpend) * 100).toFixed(0)}% vs last month
                 </div>
               )}
             </div>
             <h3 className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0.5rem 0' }}>{formatCurrency(insights.totalSpend)}</h3>
          </div>

          <div className="card flex-col gap-4">
             <div className="flex align-center gap-2 text-muted">
               <TrendingUp size={20} color="var(--success)" />
               <span className="text-mono font-bold uppercase" style={{ fontSize: '0.75rem', letterSpacing: '1px' }}>Savings Rate</span>
             </div>
             <h3 className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0.5rem 0' }}>
               {insights.totalIncome > 0 ? (((insights.totalIncome - insights.totalSpend) / insights.totalIncome) * 100).toFixed(0) : 0}%
             </h3>
             <p className="text-mono text-xs text-secondary font-bold">
               NET: {formatCurrency(insights.totalIncome - insights.totalSpend)}
             </p>
          </div>

          <div className="card flex-col gap-4">
            <div className="flex align-center gap-2 text-muted">
              <Zap size={20} color="var(--accent)" />
              <span className="text-mono font-bold uppercase" style={{ fontSize: '0.75rem', letterSpacing: '1px' }}>Velocity</span>
            </div>
            <h3 className="text-serif" style={{ fontSize: '2rem', fontWeight: 800, margin: '0.25rem 0' }}>{formatCurrency(insights.totalSpend / insights.daysInMonth)} / day</h3>
            <span className="text-mono text-xs text-secondary font-bold uppercase" style={{ letterSpacing: '0.5px' }}>{insights.daysInMonth}-day avg for {insights.displayMonth}</span>
          </div>



          <div className="card flex-col gap-4">
            <div className="flex align-center gap-2 text-muted">
              <Calendar size={20} color="#8b5cf6" />
              <span className="text-mono font-bold uppercase" style={{ fontSize: '0.75rem', letterSpacing: '1px' }}>Weekend</span>
            </div>
            <h3 className="text-serif" style={{ fontSize: '2rem', fontWeight: 800, margin: '0.25rem 0' }}>{((insights.weekendSpend / (insights.totalSpend || 1)) * 100).toFixed(0)}%</h3>
            <span className="text-mono text-xs text-secondary font-bold uppercase" style={{ letterSpacing: '0.5px' }}>Spent on Sat/Sun</span>
          </div>

          {insights.topCategory && (
            <div className="card flex-col gap-4">
              <div className="flex justify-between align-start">
                <div className="flex align-center gap-2 text-muted">
                  <Star size={20} color="var(--warning)" />
                  <span className="text-mono font-bold uppercase" style={{ fontSize: '0.75rem', letterSpacing: '1px' }}>Top Category</span>
                </div>
                {insights.prevCatSpend[insights.topCategory.name] && (
                  <div className={`text-mono text-xs font-bold ${insights.topCategory.amount > insights.prevCatSpend[insights.topCategory.name] ? 'text-danger' : 'text-success'}`}>
                    {insights.topCategory.amount > insights.prevCatSpend[insights.topCategory.name] ? '+' : '-'}
                    {Math.abs(((insights.topCategory.amount - insights.prevCatSpend[insights.topCategory.name]) / insights.prevCatSpend[insights.topCategory.name]) * 100).toFixed(0)}% MoM
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-serif" style={{ fontSize: '1.75rem', fontWeight: 700, textTransform: 'uppercase' }}>{insights.topCategory.name}</h3>
                <span className="text-mono text-xs text-secondary font-bold uppercase" style={{ display: 'block', marginTop: '0.5rem', letterSpacing: '0.5px' }}>{formatCurrency(insights.topCategory.amount)} ({((insights.topCategory.amount / (insights.totalSpend || 1)) * 100).toFixed(1)}% OF TOTAL)</span>
              </div>
            </div>
          )}

          {insights.biggestTx && (
            <div className="card flex-col gap-4">
              <div className="flex align-center gap-2 text-muted">
                <Trophy size={20} color="#ec4899" />
                <span className="text-mono font-bold uppercase" style={{ fontSize: '0.75rem', letterSpacing: '1px' }}>Biggest Expense</span>
              </div>
              <div className="flex justify-between align-end">
                 <div className="min-width-0">
                    <h3 className="truncate" style={{ fontSize: '1.25rem', fontWeight: 700 }}>{insights.biggestTx.description}</h3>
                    <span className="text-mono text-xs text-secondary font-bold uppercase" style={{ letterSpacing: '0.5px' }}>{formatDateString(insights.biggestTx.date)}</span>
                 </div>
                 <span className="text-serif" style={{ fontWeight: 800, color: 'var(--danger)', fontSize: '1.5rem' }}>{formatCurrency(insights.biggestTx.amount)}</span>
             </div>
            </div>
          )}

          <div className="card flex-col gap-4" style={{ gridColumn: '1 / -1' }}>
            <div className="flex align-center gap-2 text-muted">
              <Activity size={20} color="#38bdf8" />
              <span className="text-mono font-bold uppercase" style={{ fontSize: '0.75rem', letterSpacing: '1px' }}>Activity Streak</span>
            </div>
            <div className="streak-grid" style={{
                // Auto calculate row size based on days, max 7 cols
                gridTemplateRows: 'repeat(5, 1fr)',
                gridAutoFlow: 'column', // Fill column by column to resemble github graphs
                direction: 'ltr'
              }}>
              {insights.streakDays.map((d: any, i: number) => (
                <div 
                  key={i} 
                  title={`Day ${d.day}: ${formatCurrency(d.spend)}`}
                  className={`streak-cell ${d.state}`} 
                />
              ))}
            </div>
            <div className="flex justify-end gap-3 align-center" style={{ marginTop: '-0.25rem' }}>
              <span className="text-mono text-xs text-muted">Less</span>
              <div className="streak-cell" style={{ width: '12px', height: '12px', boxShadow: '1px 1px 0 #000' }} />
              <div className="streak-cell active" style={{ width: '12px', height: '12px', boxShadow: '1px 1px 0 #000', transform: 'none' }} />
              <div className="streak-cell heavy" style={{ width: '12px', height: '12px', boxShadow: '1px 1px 0 #000', transform: 'none' }} />
              <span className="text-mono text-xs text-muted">More</span>
            </div>
          </div>
        </div>
      )}

      {insights && monthlyTrendsData.length > 0 && (
         <div className="card flex-col gap-6" style={{ padding: '2rem' }}>
            <div className="flex-col gap-2">
               <span className="text-mono text-xs text-muted uppercase font-bold" style={{ letterSpacing: '2px', opacity: 0.8 }}>Spend Trends</span>
               <div className="flex align-center gap-3">
                  <h3 className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 800 }}>
                    {insights.prevSpend > 0 ? (
                      <>
                        {Math.abs(((insights.totalSpend - insights.prevSpend) / insights.prevSpend) * 100).toFixed(1)}%
                        <span style={{ fontSize: '1rem', marginLeft: '0.5rem', color: insights.totalSpend > insights.prevSpend ? 'var(--danger)' : 'var(--success)' }}>
                          {insights.totalSpend > insights.prevSpend ? '▲' : '▼'}
                        </span>
                      </>
                    ) : '0.0%'}
                  </h3>
               </div>
               <p className="text-sm text-secondary">
                 spending has gone {insights.totalSpend > insights.prevSpend ? 'up' : 'down'} compared to last month. {insights.totalSpend < insights.prevSpend ? "that's some impressive discipline on display." : "try to keep an eye on those recurring expenses."}
               </p>
            </div>

            <div style={{ position: 'relative', marginTop: '1rem' }}>
              {/* Custom floating info near selected bar */}
              {(() => {
                const selectedIdx = monthlyTrendsData.findIndex(d => d.originalMonth === highlightedBarMonth);
                const selectedBar = monthlyTrendsData[selectedIdx];
                if (!selectedBar || selectedIdx < 0) return null;
                const barCount = monthlyTrendsData.length;
                
                // Horizontal: center over the bar
                const barCenterPct = ((selectedIdx + 0.5) / barCount) * 90 + 2; // 90% usable width, 2% left offset
                
                // Vertical: position relative to bar height
                const maxAmount = Math.max(...monthlyTrendsData.map(d => d.amount));
                const chartHeight = 300; // matches the div height
                const topMargin = 20;    // matches BarChart top margin  
                const bottomMargin = 30; // axis area
                const usableHeight = chartHeight - topMargin - bottomMargin;
                const barHeightRatio = maxAmount > 0 ? selectedBar.amount / maxAmount : 0;
                // Top of bar = topMargin + (1 - ratio) * usableHeight, then offset up for the card
                const barTopPx = topMargin + (1 - barHeightRatio) * usableHeight;
                const cardTopPx = Math.max(0, barTopPx - 52); // 52px = approx card height

                return (
                  <div className="fade-in-up" style={{
                    position: 'absolute',
                    top: `${cardTopPx}px`,
                    left: `${barCenterPct}%`,
                    transform: 'translateX(-50%)',
                    zIndex: 10,
                    padding: '0.5rem 1rem',
                    borderRadius: '8px',
                    background: 'var(--bg-hover)',
                    border: '1px solid var(--border-color)',
                    boxShadow: '4px 4px 0 #000',
                    textAlign: 'center',
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                    transition: 'top 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), left 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                  }}>
                    <p className="text-serif" style={{ fontWeight: 800, fontSize: '1.2rem', margin: 0 }}>{formatCurrency(selectedBar.amount)}</p>
                    <p className="text-xs text-muted" style={{ margin: 0, marginTop: '1px' }}>{selectedBar.name}</p>
                    {/* Downward triangle pointer */}
                    <div style={{
                      position: 'absolute',
                      bottom: '-6px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 0,
                      height: 0,
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderTop: '6px solid var(--border-color)'
                    }} />
                  </div>
                );
              })()}

              <div style={{ height: '300px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrendsData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" opacity={0.3} />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontWeight: 700 }}
                      dy={10}
                    />
                    <YAxis hide domain={[0, 'auto']} />
                    <ReferenceLine 
                      y={avgMonthlySpend} 
                      stroke="var(--success)" 
                      strokeDasharray="3 3" 
                      opacity={0.5}
                    >
                      <Label 
                        value={`AVG ${formatCurrency(avgMonthlySpend)}`} 
                        position="left" 
                        fill="var(--success)" 
                        fontSize={10} 
                        fontWeight={800}
                      />
                    </ReferenceLine>
                    <Bar 
                      dataKey="amount" 
                      fill="var(--bg-hover)" 
                      radius={[4, 4, 0, 0]}
                      barSize={40}
                      activeBar={false}
                      style={{ cursor: 'pointer' }}
                      onClick={(data: any) => {
                        if (data && data.originalMonth) {
                          setHighlightedBarMonth(data.originalMonth);
                        }
                      }}
                    >
                      {monthlyTrendsData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.originalMonth === highlightedBarMonth ? 'var(--accent)' : 'var(--bg-hover)'} 
                          opacity={entry.originalMonth === highlightedBarMonth ? 1 : 0.6}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
         </div>
      )
      }

      {insights && (
        <div className="grid grid-cols-1 gap-6">
          {spendableCats.length > 0 && (
            <div className="card flex-col gap-8" style={{ padding: '2rem' }}>
              <div className="flex-col gap-2">
                <span className="text-mono text-xs text-muted uppercase font-bold" style={{ letterSpacing: '2px', opacity: 0.8 }}>Category Budgets</span>
                <h3 className="text-serif" style={{ fontSize: '2.2rem', fontWeight: 800 }}>
                  {budgetedCount > 0 ? `${budgetedCount} ${budgetedCount === 1 ? 'budget' : 'budgets'} set` : 'No budgets yet'}
                </h3>
                <p className="text-sm text-secondary">
                  Pick a category and set a monthly cap. Bars turn <span style={{ color: 'var(--warning)', fontWeight: 700 }}>orange</span> past 80% and <span style={{ color: 'var(--danger)', fontWeight: 700 }}>red</span> once you cross it — showing {insights.displayMonth}.
                </p>
              </div>

              {(budgetRows.length > 0 || pendingNewCat) && (
                <div className="flex-col gap-5">
                  {budgetRows.map(({ cat, budget, spent }) => {
                    const pct = (spent / budget) * 100;
                    const color = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';
                    const isEditing = editingBudgetCat === cat;

                    return (
                      <div key={cat} className="flex-col gap-2">
                        {/* Line 1: category name + edit/delete actions */}
                        <div className="flex justify-between align-center gap-3">
                          <div className="flex align-center gap-2 min-width-0">
                            <Target size={15} style={{ color, flexShrink: 0 }} />
                            <span className="truncate" style={{ fontWeight: 700, fontSize: '1rem' }}>{cat.toLowerCase()}</span>
                          </div>
                          {!isEditing && (
                            <div className="flex align-center gap-3" style={{ flexShrink: 0 }}>
                              <button
                                className="btn btn-secondary"
                                style={{ width: '34px', height: '34px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
                                onClick={() => startEditBudget(cat, budget)}
                                title="Edit"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                className="btn btn-secondary"
                                style={{ width: '34px', height: '34px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)' }}
                                onClick={() => removeBudget(cat)}
                                title="Delete"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Line 2: spent / budget + percentage (or the inline editor) */}
                        {isEditing ? (
                          <BudgetInput
                            value={budgetInput}
                            onChange={setBudgetInput}
                            onCommit={() => saveBudget(cat)}
                            onCancel={() => setEditingBudgetCat(null)}
                          />
                        ) : (
                          <div className="flex justify-between align-center gap-3">
                            <span
                              className="text-mono font-bold"
                              style={{ fontSize: '0.95rem', cursor: 'pointer' }}
                              onClick={() => startEditBudget(cat, budget)}
                            >
                              {formatCurrency(spent)} <span className="text-muted">/ {formatCurrency(budget)}</span>
                            </span>
                            <span className="text-mono font-bold" style={{ color, fontSize: '0.9rem', flexShrink: 0 }}>{Math.round(pct)}%</span>
                          </div>
                        )}

                        {/* Line 3: progress bar */}
                        <div style={{ height: '6px', background: 'var(--bg-hover)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: '3px', transition: 'width 0.4s cubic-bezier(0.175,0.885,0.32,1.275)' }} />
                        </div>
                      </div>
                    );
                  })}

                  {/* Category just picked from the add-picker — set its cap before it becomes a row. */}
                  {pendingNewCat && (
                    <div className="flex-col gap-2">
                      <div className="flex align-center gap-2 min-width-0">
                        <Target size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        <span className="truncate" style={{ fontWeight: 700, fontSize: '1rem' }}>{pendingNewCat.toLowerCase()}</span>
                      </div>
                      <BudgetInput
                        value={budgetInput}
                        onChange={setBudgetInput}
                        onCommit={() => saveBudget(pendingNewCat)}
                        onCancel={() => setEditingBudgetCat(null)}
                      />
                    </div>
                  )}
                </div>
              )}

              {addableCats.length > 0 && (
                <div style={{ maxWidth: '340px' }}>
                  <CustomPicker
                    label="Add a budget"
                    hideLabel
                    value=""
                    placeholder="+ Add a budget for a category"
                    options={addableCats.map(c => ({ id: c, name: c }))}
                    onChange={(cat: string) => startEditBudget(cat, 0)}
                    iconGetter={() => <Target size={16} />}
                  />
                </div>
              )}
            </div>
          )}

          <div className="card flex-col gap-8" style={{ padding: '2rem' }}>
            <div className="flex-col gap-2">
              <span className="text-mono text-xs text-muted uppercase font-bold" style={{ letterSpacing: '2px', opacity: 0.8 }}>Top Spends Category</span>
              {insights.topCategory && (
                <h3 className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 800 }}>
                  {((insights.topCategory.amount / (insights.totalSpend || 1)) * 100).toFixed(1)}% on {insights.topCategory.name.toLowerCase()}
                </h3>
              )}
              <p className="text-sm text-secondary" style={{ maxWidth: '500px' }}>
                Every spend was a choice to enhance your life. You picked what truly mattered to you this month.
              </p>
            </div>

            <div className="flex align-center justify-between gap-12" style={{ flexWrap: 'wrap' }}>
              <div style={{ height: '300px', width: '300px', position: 'relative', flexShrink: 0, margin: '0 auto' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={catPieData}
                      innerRadius={95}
                      outerRadius={135}
                      paddingAngle={0}
                      dataKey="value"
                      stroke="none"
                      onMouseEnter={(_, index) => setActiveCatIndex(index)}
                      onMouseLeave={() => setActiveCatIndex(null)}
                      onClick={(_, index) => setActiveCatIndex(index)}
                    >
                      {catPieData.map((_, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={COLORS[index % COLORS.length]} 
                          style={{ 
                            filter: activeCatIndex === index ? 'drop-shadow(0 0 8px rgba(0,0,0,0.2))' : 'none',
                            cursor: 'pointer',
                            opacity: activeCatIndex === null || activeCatIndex === index ? 1 : 0.6,
                            transition: 'all 0.3s ease'
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                
                {/* Centered Content */}
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  pointerEvents: 'none'
                }}>
                  <span className="text-xs text-muted uppercase font-bold" style={{ display: 'block', marginBottom: '0.25rem' }}>
                    {activeCatIndex !== null ? catPieData[activeCatIndex].name : 'Total Spend'}
                  </span>
                  <RollingNumber 
                    value={activeCatIndex !== null ? catPieData[activeCatIndex].value : insights.totalSpend} 
                    fontSize="2.2rem" 
                  />
                </div>
              </div>

              {/* Custom Legend */}
              <div className="flex-1 flex-col gap-4" style={{ minWidth: '300px' }}>
                {catPieData.map((entry, index) => {
                  const txCount = insights.monthTxs.filter((t: Transaction) => t.category === entry.name).length;
                  const percentage = ((entry.value / (insights.totalSpend || 1)) * 100).toFixed(1);
                  const color = COLORS[index % COLORS.length];

                  return (
                    <div 
                      key={entry.name} 
                      className="flex justify-between align-center py-3" 
                      style={{ 
                        borderBottom: '1px dashed var(--border-color)',
                        opacity: activeCatIndex === null || activeCatIndex === catPieData.findIndex(d => d.name === entry.name) ? 1 : 0.4,
                        transition: 'opacity 0.3s ease'
                      }}
                    >
                      <div className="flex align-center gap-4">
                        <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: color }}></div>
                        <div className="flex-col">
                          <span style={{ fontWeight: 700, fontSize: '1rem' }}>{entry.name.toLowerCase()}</span>
                          <span className="text-xs text-muted font-bold">{txCount} {txCount === 1 ? 'transaction' : 'transactions'}</span>
                        </div>
                      </div>
                      <div className="flex-col align-end">
                        <RollingNumber value={entry.value} fontSize="1.1rem" />
                        <span className="text-xs text-muted font-bold">{percentage}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card flex-col gap-8" style={{ padding: '2rem' }}>
            <div className="flex-col gap-2">
              <span className="text-xs text-muted uppercase font-bold" style={{ letterSpacing: '1.5px', opacity: 0.6 }}>Spend by Account</span>
              {insights.topAccount && (
                <h3 style={{ fontSize: '2.2rem', fontWeight: 800, fontFamily: '"Playfair Display", serif' }}>
                  {((insights.topAccount.amount / (insights.totalSpend || 1)) * 100).toFixed(1)}% via {insights.topAccount.name.toLowerCase()}
                </h3>
              )}
            </div>
            
            {/* Centered donut chart */}
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
                      onMouseEnter={(_, index) => setActiveAccIndex(index)}
                      onMouseLeave={() => setActiveAccIndex(null)}
                      onClick={(_, index) => setActiveAccIndex(index)}
                    >
                      {accPieData.map((_, index) => (
                        <Cell 
                          key={`acc-cell-${index}`} 
                          fill={ACC_COLORS[index % ACC_COLORS.length]}
                          style={{ 
                            filter: activeAccIndex === index ? 'drop-shadow(0 0 8px rgba(0,0,0,0.2))' : 'none',
                            opacity: activeAccIndex === null || activeAccIndex === index ? 1 : 0.6,
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
                    {activeAccIndex !== null ? accPieData[activeAccIndex].name : 'Total Spend'}
                  </span>
                  <RollingNumber 
                    value={activeAccIndex !== null ? accPieData[activeAccIndex].value : insights.totalSpend} 
                    fontSize="2.2rem" 
                  />
                </div>
              </div>
            </div>

            {/* Account legend — same pattern as categories */}
            <div className="flex-col gap-4">
              {accPieData.map((entry, index) => {
                const txCount = insights.monthTxs.filter((t: Transaction) => {
                  const account = data.accounts.find(a => a.id === t.accountId);
                  return (account?.name || 'Unknown') === entry.name && t.type === 'debit';
                }).length;
                const percentage = ((entry.value / (insights.totalSpend || 1)) * 100).toFixed(1);
                const color = ACC_COLORS[index % ACC_COLORS.length];

                return (
                  <div 
                    key={entry.name} 
                    className="flex justify-between align-center py-3" 
                    style={{ 
                      borderBottom: '1px dashed var(--border-color)',
                      opacity: activeAccIndex === null || activeAccIndex === accPieData.findIndex(d => d.name === entry.name) ? 1 : 0.4,
                      transition: 'opacity 0.3s ease'
                    }}
                  >
                    <div className="flex align-center gap-4">
                      <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: color }}></div>
                      <div className="flex-col">
                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{entry.name.toLowerCase()}</span>
                        <span className="text-xs text-muted font-bold">{txCount} {txCount === 1 ? 'transaction' : 'transactions'}</span>
                      </div>
                    </div>
                    <div className="flex-col align-end">
                      <RollingNumber value={entry.value} fontSize="1.1rem" />
                      <span className="text-xs text-muted font-bold">{percentage}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {Object.keys(insights.tagSpend).length > 0 && (() => {
            const tagEntries = Object.entries(insights.tagSpend).sort((a, b) => b[1] - a[1]);
            const maxTagSpend = tagEntries[0]?.[1] || 1;
            const totalTagged = insights.monthTxs.filter(t => t.type === 'debit' && (t.tags || []).length > 0 && !['transfer', 'cc payment', 'sip', 'ncmc travel recharge'].includes(t.category.toLowerCase())).reduce((s, t) => s + (t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0))), 0);

            return (
              <div className="card flex-col gap-8" style={{ padding: '2rem' }}>
                <div className="flex-col gap-2">
                  <span className="text-mono text-xs text-muted uppercase font-bold" style={{ letterSpacing: '2px', opacity: 0.8 }}>Spend by Tag</span>
                  <h3 className="text-serif" style={{ fontSize: '2.2rem', fontWeight: 800 }}>
                    {tagEntries.length} {tagEntries.length === 1 ? 'bucket' : 'buckets'} tracked
                  </h3>
                  <p className="text-sm text-secondary">
                    {((totalTagged / (insights.totalSpend || 1)) * 100).toFixed(0)}% of total spend is grouped across {tagEntries.length} {tagEntries.length === 1 ? 'bucket' : 'buckets'} this month.
                  </p>
                </div>

                <div className="flex-col gap-5">
                  {tagEntries.map(([tag, amount]) => {
                    const txCount = insights.monthTxs.filter(t => (t.tags || []).includes(tag) && t.type === 'debit').length;
                    const pctOfTotal = ((amount / (insights.totalSpend || 1)) * 100).toFixed(1);
                    const barWidth = ((amount / maxTagSpend) * 100).toFixed(1);

                    return (
                      <div key={tag} className="flex-col gap-2">
                        <div className="flex justify-between align-center">
                          <div className="flex align-center gap-3">
                            <Hash size={13} style={{ color: 'var(--accent)', opacity: 0.8, flexShrink: 0 }} />
                            <span style={{ fontWeight: 700, fontSize: '1rem' }}>{tag}</span>
                            <span className="text-xs text-muted font-bold">{txCount} {txCount === 1 ? 'tx' : 'txs'}</span>
                          </div>
                          <div className="flex align-center gap-3">
                            <span className="text-mono font-bold" style={{ fontSize: '1rem' }}>{formatCurrency(amount)}</span>
                            <span className="text-xs text-muted font-bold" style={{ minWidth: '3ch', textAlign: 'right' }}>{pctOfTotal}%</span>
                          </div>
                        </div>
                        <div style={{ height: '5px', background: 'var(--bg-hover)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barWidth}%`, background: 'rgba(99,102,241,0.65)', borderRadius: '3px', transition: 'width 0.4s cubic-bezier(0.175,0.885,0.32,1.275)' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
