// ── The launch screen ────────────────────────────────────────────────────────────────────────────
//
// One subject: what this month cost. Everything else that used to live here has a better home, and
// the screen is defined as much by what it refuses as by what it shows:
//
//   Credit card dues → the Cards tree. Spend is a MONTH concept and dues are a RIGHT NOW concept;
//     putting both here meant the screen had two subjects and no answer to "how am I doing?".
//   The delta, the six-month trend, ₹/day, the top category, spend by account → Insights, which
//     already had every one of them, with a month picker and the room to reason about them.
//   Recent activity → the Transactions tab, which is one tap away and is the actual ledger.
//
// What's left is a title, a hero, two doors and one chart. The month is pinned to the current one:
// with nothing here to compare across months, a picker would be a control whose only effect is
// changing a number — and Insights owns that question.
import { useMemo, useState } from 'react';
import { useFinance } from '../FinanceContext';
import { getCurrentMonthStr, isStatsExcludedCategory, statsAmount, CATEGORY_PALETTE, getDistinctChartColors } from '../utils';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import RollingNumber from './RollingNumber';
import { SpendBackdrop } from './SpendBackdrop';
import { CardsPlaque, WealthPlaque } from './DashboardPlaques';

export default function Dashboard({ onOpenCards, onOpenWealth }: {
  onOpenCards: () => void;
  onOpenWealth: () => void;
}) {
  const { data } = useFinance();
  const currentMonth = getCurrentMonthStr(); // "YYYY-MM"
  const [activeCatIdx, setActiveCatIdx] = useState<number | null>(null);

  const { totalSpend, spendByCategory } = useMemo(() => {
    let spend = 0;
    const catSpend: Record<string, number> = {};

    data.transactions.forEach(t => {
      if (!t.date.startsWith(currentMonth)) return;
      if (t.type !== 'debit') return;
      if (isStatsExcludedCategory(t.category)) return;
      // The shared carve-out helper, so a Passive Log shrinks this total by exactly as much as it
      // shrinks the same month on Insights.
      const effectiveAmount = statsAmount(t);
      spend += effectiveAmount;
      if (effectiveAmount > 0) {
        catSpend[t.category] = (catSpend[t.category] || 0) + effectiveAmount;
      }
    });

    return { totalSpend: spend, spendByCategory: catSpend };
  }, [data.transactions, currentMonth]);

  // Slices run largest-first (clockwise from 12 o'clock), so the ring reads as a ranking and the
  // slivers collect at the end instead of scattering. Without the sort the order was object-key
  // insertion order — i.e. whichever category happened to appear first in the transaction array —
  // which reshuffled the chart every month and on any reorder.
  const pieData = useMemo(
    () => Object.entries(spendByCategory).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })),
    [spendByCategory]
  );
  const catColors = useMemo(() => getDistinctChartColors(pieData.length, CATEGORY_PALETTE), [pieData.length]);

  const monthLabel = `${new Date(`${currentMonth}-01`).toLocaleString('default', { month: 'short' })} '${currentMonth.substring(2, 4)}`;
  const hasSpend = totalSpend > 0;

  return (
    <div className="flex-col gap-6">
      {/* The title stays. All three other nav screens announce themselves in this exact style
          (Accounts, Transactions, Settings) and the nav itself has no labels, so dropping only this
          one would read as an oversight. What left the row is the month, which was its only real
          information and now sits with the figure it scopes. lineHeight 1 for the same reason as the
          ledger's title: the inherited 1.5 pads ~9px of leading under 24px caps. */}
      <h2 className="text-mono" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', lineHeight: 1 }}>dashboard</h2>

      {/* ── Hero: the month's spend, struck on a coin ──
          position/overflow for the backdrop, which is absolutely positioned to this box and bleeds
          past the container's padding. The centring is what lands the figure on the coin's field:
          the drawing is concentric about its own centre, so both have to be centred in the same box
          (see COMPOSITION in relief.tsx). The tour points at this element — see AppTour. */}
      <div
        className="tour-dashboard-stats"
        style={{
          position: 'relative',
          overflow: 'hidden',
          minHeight: '300px',
          margin: '0 -1.5rem',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <SpendBackdrop />

        {/* One lifted wrapper, rather than a position/z-index on every figure inside it. */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="text-mono uppercase" style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '2.5px', color: 'var(--text-secondary)', marginBottom: '0.6rem' }}>
            {monthLabel}
          </div>
          {/* Whole rupees: this is a glance surface, and the paise belong on the screens where a
              figure is reconciled against Accounts. */}
          <RollingNumber value={totalSpend} fontSize="2.75rem" whole />
          {!hasSpend && (
            <div className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              Nothing logged this month yet
            </div>
          )}
        </div>
      </div>

      {/* ── The two doors ──
          An explicit two-column grid rather than .grid-cols-2, which index.css collapses to a single
          column at ≤768px — i.e. on every phone. That default is right for a grid of cards that would
          be cramped side by side; it is wrong here, because these two are a matched pair and reading
          them as "what you owe / what you own" depends on their being beside each other. */}
      <div className="tour-dashboard-doors" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <CardsPlaque onClick={onOpenCards} tourClass="tour-dashboard-cards" />
        <WealthPlaque onClick={onOpenWealth} tourClass="tour-dashboard-wealth" />
      </div>

      {/* ── Spend composition ──
          One ring, by category, and deliberately WITHOUT a legend: tapping a slice names it in the
          middle with its amount and share, which is the whole interaction on this screen. Spend by
          account used to sit beside it and has gone to Insights, where it can be compared against
          everything else.
          The ring is an aspect-ratio box rather than the fixed 300×300 it used to be. That box fit a
          phone only because index.css collapses .grid-cols-2 to one column below 768px; it could not
          adapt to its container, so it was oversized on a narrow phone and undersized on a tablet
          where the two-column grid does apply. Percentage radii inside an aspect-ratio box hold their
          proportions at any width. */}
      {pieData.length > 0 && (
        <div className="card flex-col gap-4">
          <span className="text-xs text-muted uppercase font-bold" style={{ letterSpacing: '1.5px', opacity: 0.6 }}>Spend by Category</span>
          <div style={{ position: 'relative', width: '100%', maxWidth: '280px', aspectRatio: '1 / 1', margin: '0 auto' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  // Percentages, so the ring keeps its proportions at every width instead of the
                  // fixed radii that only suited one container size.
                  innerRadius="68%"
                  outerRadius="96%"
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
                      fill={catColors[index]}
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
  );
}
