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
  // Nothing has ever been logged — which is a different screen from "nothing this month". The first
  // needs to say what to do; the second is just a quiet month and needs no instruction.
  const firstRun = data.transactions.length === 0;

  // The figure is the coin's DENOMINATION, so it wants to fill the field — but the field is a fixed
  // circle and a rupee figure is not a fixed width. Stepped by magnitude rather than measured,
  // because RollingNumber renders one span per digit and has no width to measure until it has
  // already laid out. Ten characters at 3.15rem is about as wide as the field allows; a crore-scale
  // figure needs the smaller step to stay inside it.
  const heroFontSize = totalSpend >= 1_00_00_000 ? '2.5rem' : totalSpend >= 1_00_000 ? '2.85rem' : '3.15rem';

  return (
    <div className="flex-col gap-6">
      {/* The title stays. All three other nav screens announce themselves in this exact style
          (Accounts, Transactions, Settings) and the nav itself has no labels, so dropping only this
          one would read as an oversight. What left the row is the month, which was its only real
          information and now sits with the figure it scopes. lineHeight 1 for the same reason as the
          ledger's title: the inherited 1.5 pads ~9px of leading under 24px caps. */}
      <h2 className="text-mono" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', lineHeight: 1 }}>dashboard</h2>

      {/* Everything below the title enters in sequence — hero, then the doors, then the ring. The
          title is outside the group on purpose: it is the screen's label rather than one of its
          pieces, and the stagger reads as "the figure arrives first" only if the figure is first.
          A nested flex column with the same gap, so the spacing is unchanged. See .launch-stagger in
          index.css for the timings and the reduced-motion reset. */}
      <div className="flex-col gap-6 launch-stagger">

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
            /* The coin is scaled with 'meet' on a square viewBox, so it takes the SMALLER of this
               box's two sides — and this box has always been wider than it is tall. A flat 360px
               height therefore struck the same 349px coin on every phone, and a wider screen bought
               nothing but wider margins either side of it.
               Height follows width instead, and what it is solved for is the GUTTER. The rim sits at
               r 194 of a 200 viewBox, so the drawing spans 97% of the box's smaller side; dividing
               the container's content width by that 0.97 makes the rim land exactly ON that width —
               which is where the plaques below start. It used to be a flat 103vw, putting the rim on
               the screen edges instead, and the coin read as cropped by the phone rather than set on
               the page with everything else.
               `100vw - 1rem` IS the content width: .container pads 0.5rem a side on mobile. That
               figure has to stay in step with .container, like .detail-hero-bleed's does.
               The -1.5rem bleed STAYS, and is now load-bearing for a different reason than it was:
               it keeps the box wider than it is tall, so the height above is the side the drawing is
               actually sized by. Remove it and the (narrower) width takes over and the coin shrinks.
               Capped, because on a desktop-width container this would be a hero taller than the
               window. Past ~447px wide the cap takes over and the coin stops growing.
               Keeping height the smaller side also keeps the currency course's CSS fade aligned with
               the SVG one — see .coin-course-fade in index.css. */
            minHeight: 'min(calc((100vw - 1rem) / 0.97), 460px)',
            /* The negative TOP pulls the coin up under the title. The drawing already carries 6px
               of empty viewBox above its rim, and the column's own 32px gap sat on top of that, so
               the hero read as floating rather than as struck under the heading. Pulling the box up
               takes everything below it along, so the space under the coin is unchanged — this
               tightens the title-to-coin joint only. */
            margin: '-1.25rem -1.5rem 0',
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

          {/* One lifted wrapper, rather than a position/z-index on every figure inside it.
              paddingBottom is what strikes the FIGURE on the coin's centre instead of the block. The
              backdrop is concentric about the box's centre, and a centred two-line block puts that
              centre in the gap between the label and the digits — so the coin's device sat visibly
              above its own denomination. The pad equals the label's line box plus its margin, i.e.
              exactly what sits above the figure, and centring a block with that much dead space below
              it lifts the figure by half of it: onto the centre. Derived from the label's own values
              rather than a measured pixel count, so it tracks if either changes. */}
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 'calc(0.8rem * 1.5 + 0.7rem)' }}>
            {/* Same ink as the figure it scopes. RollingNumber sets no colour and inherits
                --text-primary, so this matches by naming that token rather than by omitting one —
                the label would otherwise inherit it too, which reads as an accident waiting to be
                "fixed" back to secondary. The month stays subordinate on size, weight and tracking,
                which is enough: dimming it as well made the coin's denomination look like two
                different pieces of type. */}
            <div className="text-mono uppercase" style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '3.5px', color: 'var(--text-primary)', marginBottom: '0.7rem' }}>
              {monthLabel}
            </div>
            {/* Whole rupees: this is a glance surface, and the paise belong on the screens where a
                figure is reconciled against Accounts. */}
            <RollingNumber value={totalSpend} fontSize={heroFontSize} whole />
            {!hasSpend && (
              <div className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                {firstRun ? 'Nothing logged yet' : 'Nothing logged this month yet'}
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

        {/* First run. A LINE, not a button: this screen carries one figure and two doors, and a third
            call to action would put a control on the one surface that deliberately has none — the
            ledger is a tab away and already has its own. It names the tab rather than pointing at it,
            because the nav has no labels. */}
        {firstRun && (
          <div className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.7 }}>
            Log your first spend from the<br />transactions tab
          </div>
        )}

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
    </div>
  );
}
