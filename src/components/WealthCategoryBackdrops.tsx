// Decorative bas-relief backdrops for the three Wealth category screens.
//
// Same idiom as WealthBackdrop — inline SVG (crisp at any density, no network request, tones taken
// from CSS custom properties so one drawing serves both themes), shaded relief rather than line art,
// one light source at the top-left — but a DIFFERENT SUBJECT for each category. The tree screen's
// vault door says "your wealth"; repeating it on the inner screens would say nothing about which
// category you'd opened, so each gets its own engraving:
//
//   Portfolio  → a sunburst medallion behind a candlestick colonnade with a rising trend ribbon.
//   Assets     → a treasury facade: pediment, dentils, fluted colonnade, steps and coin stacks.
//   Retirement → a laurel wreath around an hourglass, sand running from the upper bulb.
//
// All three inherit WealthBackdrop's COMPOSITION contract, and it's load-bearing: the viewBox is
// square, everything is concentric about its centre, and the drawing is scaled with 'meet'. Each
// hero centres its content, so the drawing's centre lands on the content's centre at any width —
// which is what puts the avatar, label and total inside the medallion / between the columns / inside
// the wreath. Break the squareness or the centring and the content drifts off the motif.
//
// RELIEF, as in WealthBackdrop: filled bodies shaded by gradient, paired lit/shadow edge strokes
// (light on the top-left of a form, shadow on its bottom-right), and feDropShadow on the members
// that physically stand proud. Break the shared light direction and the whole thing flattens out.
import React from 'react';
import type { ReactNode } from 'react';

const VB = 400; // square: see COMPOSITION above
const C = VB / 2; // 200 — the centre of the motif and of the hero content alike

const f = (v: number) => v.toFixed(2);
const polar = (r: number, a: number) => ({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });
const deg = (a: number) => (a * 180) / Math.PI;

// A full ring with a hole punched in it (drawn with fillRule="evenodd"). A moulding needs a body to
// shade across its width — a stroked circle has no way to provide one.
const ring = (rIn: number, rOut: number) =>
  `M ${C - rOut} ${C} A ${rOut} ${rOut} 0 1 0 ${C + rOut} ${C} A ${rOut} ${rOut} 0 1 0 ${C - rOut} ${C} Z ` +
  `M ${C - rIn} ${C} A ${rIn} ${rIn} 0 1 0 ${C + rIn} ${C} A ${rIn} ${rIn} 0 1 0 ${C - rIn} ${C} Z`;

const arc = (r: number, a0: number, a1: number) => {
  const p0 = polar(r, a0);
  const p1 = polar(r, a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${f(p0.x)} ${f(p0.y)} A ${r} ${r} 0 ${large} ${sweep} ${f(p1.x)} ${f(p1.y)}`;
};

// A tapered radial limb: wide at rIn, narrowing to (near) a point at rOut. Used for sunburst rays.
const spike = (rIn: number, rOut: number, a: number, halfIn: number, halfOut: number) => {
  const p1 = polar(rIn, a - halfIn);
  const p2 = polar(rOut, a - halfOut);
  const p3 = polar(rOut, a + halfOut);
  const p4 = polar(rIn, a + halfIn);
  return `M ${f(p1.x)} ${f(p1.y)} L ${f(p2.x)} ${f(p2.y)} L ${f(p3.x)} ${f(p3.y)} L ${f(p4.x)} ${f(p4.y)} Z`;
};

// ── Shared defs ──────────────────────────────────────────────────────────────────────────────────
// Ids are prefixed per drawing. Only one category is ever on screen at a time, but duplicate ids
// across three mounted SVGs would be a silent trap the first time that changes.
const ReliefDefs: React.FC<{ p: string; wellRx: number; wellRy: number }> = ({ p, wellRx, wellRy }) => (
  <>
    {/* Vertical shading for members lit from above: lintels, plates, plinths. */}
    <linearGradient id={`${p}-stone-v`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="var(--relief-hi)" />
      <stop offset="55%" stopColor="var(--relief-mid)" />
      <stop offset="100%" stopColor="var(--relief-lo)" />
    </linearGradient>

    {/* Horizontal shading for round members lit from the left: columns, posts, candle bodies. */}
    <linearGradient id={`${p}-stone-h`} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor="var(--relief-hi)" />
      <stop offset="55%" stopColor="var(--relief-mid)" />
      <stop offset="100%" stopColor="var(--relief-lo)" />
    </linearGradient>

    {/* Offset focal point, so a disc or a ring reads as domed/toroidal rather than flat. */}
    <radialGradient id={`${p}-dome`} cx="38%" cy="34%" r="72%">
      <stop offset="0%" stopColor="var(--relief-hi)" />
      <stop offset="62%" stopColor="var(--relief-mid)" />
      <stop offset="100%" stopColor="var(--relief-lo)" />
    </radialGradient>

    {/* Cast shadows. Two strengths: a long one for members standing well proud of the wall, a tight
        one for small hardware sitting just off it. */}
    <filter id={`${p}-cast`} x="-30%" y="-30%" width="180%" height="180%">
      <feDropShadow dx="2.5" dy="3.5" stdDeviation="3" floodColor="var(--relief-shadow)" />
    </filter>
    <filter id={`${p}-cast-tight`} x="-50%" y="-50%" width="220%" height="220%">
      <feDropShadow dx="1" dy="1.4" stdDeviation="1.1" floodColor="var(--relief-shadow)" />
    </filter>

    {/* Fades the relief out at the very bottom so it doesn't butt up hard against the rows below. */}
    <linearGradient id={`${p}-fade`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#fff" stopOpacity="1" />
      <stop offset="80%" stopColor="#fff" stopOpacity="1" />
      <stop offset="100%" stopColor="#fff" stopOpacity="0.12" />
    </linearGradient>

    {/* Legibility well. Black in a luminance mask means "hide", so a higher stopOpacity mutes more:
        the centre keeps roughly a fifth of the relief — enough to still read as texture behind the
        avatar and the total without competing with them — and ramps back to full strength at the
        well's edge. Done in the mask rather than by weakening the tokens so the frame, columns and
        wreath, none of which sit under text, stay at full contrast. The well is an ellipse because
        these heroes are taller than they are busy: Portfolio stacks a total, a day change, a refresh
        button, a timestamp and a pill row down the same axis. */}
    <radialGradient id={`${p}-clear`} cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor="#000" stopOpacity="0.82" />
      <stop offset="42%" stopColor="#000" stopOpacity="0.7" />
      <stop offset="74%" stopColor="#000" stopOpacity="0.3" />
      <stop offset="100%" stopColor="#000" stopOpacity="0" />
    </radialGradient>

    <mask id={`${p}-mask`}>
      <rect width={VB} height={VB} fill={`url(#${p}-fade)`} />
      <ellipse cx={C} cy={C} rx={wellRx} ry={wellRy} fill={`url(#${p}-clear)`} />
    </mask>
  </>
);

const ReliefSvg: React.FC<{ p: string; wellRx: number; wellRy: number; children: ReactNode }> = ({
  p, wellRx, wellRy, children,
}) => (
  <svg
    viewBox={`0 0 ${VB} ${VB}`}
    // 'meet', not 'slice': the whole drawing has to be visible, so it scales to fit the hero box and
    // letterboxes rather than filling the box and cropping the motif away.
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
    focusable="false"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
  >
    <defs>
      <ReliefDefs p={p} wellRx={wellRx} wellRy={wellRy} />
    </defs>
    <g mask={`url(#${p}-mask)`} strokeLinecap="round">{children}</g>
  </svg>
);

// ── Portfolio: the bourse medallion ─────────────────────────────────────────────────────────────
// A coin-rim medallion, a carved sunburst filling it, and a colonnade of candlesticks standing on a
// stepped plinth with a trend ribbon rising across their tips. Candlesticks (rectangular bodies,
// wicks) are what make this unmistakably the market screen and not the cash one.
const PF = 'pfb';
const PF_RING_IN = 172;
const PF_RING_OUT = 190;
const PF_RAYS = 30;
// The rays stop well short of the hub. They read as a rayed border that way, and — more to the
// point — the candlesticks and the total both sit inside r≈120, and a fan of rays behind them turned
// that whole area into noise the legibility well could only flatten, not clean up.
const PF_RAY_IN = 126;

const PF_SUNBURST = Array.from({ length: PF_RAYS }, (_, i) => {
  const a = (Math.PI * 2 * i) / PF_RAYS - Math.PI / 2; // one ray straight up
  // Alternating lengths: a uniform fan reads as a gear, an alternating one as a sunburst.
  const rOut = i % 2 === 0 ? PF_RING_IN - 2 : PF_RING_IN - 18;
  return {
    body: spike(PF_RAY_IN, rOut, a, 0.036, 0.006),
    // The lit edge runs down the ray's upper-left flank, matching the global light direction.
    litEdge: `M ${f(polar(PF_RAY_IN, a - 0.036).x)} ${f(polar(PF_RAY_IN, a - 0.036).y)} ` +
             `L ${f(polar(rOut, a - 0.006).x)} ${f(polar(rOut, a - 0.006).y)}`,
  };
});

// Baseline the candles stand on, and the plinth under it.
const PF_BASE = C + 92;
const PF_CANDLE_W = 16;
// Heights are in units above PF_BASE. lo/hi are the wick extremes, a/b the body. The series rises
// with one pullback, so it reads as a market and not as a bar chart of nothing in particular.
const PF_CANDLES = [
  { lo: 6, hi: 56, a: 14, b: 48 },
  { lo: 16, hi: 70, a: 26, b: 62 },
  { lo: 26, hi: 74, a: 34, b: 58 },
  { lo: 34, hi: 100, a: 46, b: 92 },
  { lo: 50, hi: 112, a: 60, b: 98 },
  { lo: 58, hi: 128, a: 70, b: 118 },
  { lo: 74, hi: 152, a: 88, b: 144 },
].map((c, i) => ({ ...c, x: C - 90 + i * 30 }));

// Ribbon through the candle tips, carried on past the last one and finished with an arrowhead.
const PF_TIP = (c: typeof PF_CANDLES[number]) => ({ x: c.x, y: PF_BASE - c.hi - 9 });
const PF_TREND_END = { x: C + 112, y: PF_BASE - 172 };
const PF_TREND = `M ${PF_CANDLES.map(c => `${f(PF_TIP(c).x)} ${f(PF_TIP(c).y)}`).join(' L ')} L ${f(PF_TREND_END.x)} ${f(PF_TREND_END.y)}`;
const PF_ARROW =
  `M ${f(PF_TREND_END.x + 5)} ${f(PF_TREND_END.y - 5)} ` +
  `L ${f(PF_TREND_END.x - 13)} ${f(PF_TREND_END.y - 1)} ` +
  `L ${f(PF_TREND_END.x - 1)} ${f(PF_TREND_END.y + 13)} Z`;

export const PortfolioBackdrop: React.FC = () => (
  <ReliefSvg p={PF} wellRx={148} wellRy={162}>
    {/* ── Sunburst, behind everything ── */}
    <g filter={`url(#${PF}-cast-tight)`}>
      {PF_SUNBURST.map((s, i) => (
        <g key={`pf-ray-${i}`}>
          <path d={s.body} fill={`url(#${PF}-dome)`} stroke="var(--relief-line)" strokeWidth="0.5" />
          <path d={s.litEdge} fill="none" stroke="var(--relief-edge)" strokeWidth="0.7" opacity="0.7" />
        </g>
      ))}
    </g>

    {/* ── Coin rim: a torus lit from the top-left, so the offset radial gradient does the shading ── */}
    <g filter={`url(#${PF}-cast)`}>
      <path d={ring(PF_RING_IN, PF_RING_OUT)} fillRule="evenodd" fill={`url(#${PF}-dome)`} />
    </g>
    <circle cx={C} cy={C} r={PF_RING_OUT} fill="none" stroke="var(--relief-edge)" strokeWidth="1.4" />
    <circle cx={C} cy={C} r={PF_RING_OUT - 2} fill="none" stroke="var(--relief-shadow)" strokeWidth="0.8" opacity="0.5" />
    <circle cx={C} cy={C} r={PF_RING_IN} fill="none" stroke="var(--relief-line)" />
    <circle cx={C} cy={C} r={PF_RING_IN - 2} fill="none" stroke="var(--relief-shadow)" strokeWidth="1" opacity="0.45" />
    {/* Bead course inside the rim — the milled edge of a coin. */}
    {Array.from({ length: 48 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 48;
      const q = polar(PF_RING_IN + 9, a);
      return <circle key={`pf-bead-${i}`} cx={q.x} cy={q.y} r="1.9" fill="var(--relief-hi)" stroke="var(--relief-line)" strokeWidth="0.5" />;
    })}

    {/* ── Collar the rays spring from. Without it they read as free-floating teeth pointing inward
           rather than as a sunburst, since there's nothing at the centre for them to radiate out of
           (the vault door had its hub; here the hub is the user's total). ── */}
    <path d={ring(118, 126)} fillRule="evenodd" fill={`url(#${PF}-dome)`} />
    <circle cx={C} cy={C} r="126" fill="none" stroke="var(--relief-line)" strokeWidth="0.8" />
    <circle cx={C} cy={C} r="118" fill="none" stroke="var(--relief-shadow)" strokeWidth="0.9" opacity="0.4" />

    {/* ── Candlesticks stand directly on the baseline, no drawn plinth beneath them. A filled course
           lived here and sat right behind the refresh button and filter pills, reading as a second
           control track under the real UI. ── */}
    <g filter={`url(#${PF}-cast-tight)`}>
      {PF_CANDLES.map((c, i) => (
        <g key={`pf-candle-${i}`}>
          <line x1={c.x} y1={PF_BASE - c.lo} x2={c.x} y2={PF_BASE - c.hi} stroke="var(--relief-edge)" strokeWidth="1.7" opacity="0.9" />
          <rect
            x={c.x - PF_CANDLE_W / 2}
            y={PF_BASE - c.b}
            width={PF_CANDLE_W}
            height={c.b - c.a}
            fill={`url(#${PF}-stone-h)`}
            stroke="var(--relief-line)"
            strokeWidth="1"
          />
          {/* Lit top and left flanks, shadow down the right: the pair is what stands the body proud
              of the medallion rather than letting it read as a flat pale rectangle. */}
          <line x1={c.x - PF_CANDLE_W / 2} y1={PF_BASE - c.b} x2={c.x - PF_CANDLE_W / 2} y2={PF_BASE - c.a} stroke="var(--relief-edge)" strokeWidth="1.3" />
          <line x1={c.x - PF_CANDLE_W / 2} y1={PF_BASE - c.b} x2={c.x + PF_CANDLE_W / 2} y2={PF_BASE - c.b} stroke="var(--relief-edge)" strokeWidth="1.3" />
          <line x1={c.x + PF_CANDLE_W / 2} y1={PF_BASE - c.b} x2={c.x + PF_CANDLE_W / 2} y2={PF_BASE - c.a} stroke="var(--relief-shadow)" strokeWidth="1.2" opacity="0.5" />
        </g>
      ))}
    </g>

    {/* ── Trend ribbon: a shadow line under a lit one is what carves a groove into the relief ── */}
    <path d={PF_TREND} fill="none" stroke="var(--relief-shadow)" strokeWidth="2.6" opacity="0.5" transform="translate(1.4 2)" strokeLinejoin="round" />
    <path d={PF_TREND} fill="none" stroke="var(--relief-edge)" strokeWidth="2.2" strokeLinejoin="round" />
    <g filter={`url(#${PF}-cast-tight)`}>
      <path d={PF_ARROW} fill={`url(#${PF}-dome)`} stroke="var(--relief-edge)" strokeWidth="1.2" />
    </g>
  </ReliefSvg>
);

// ── Assets: the treasury facade ─────────────────────────────────────────────────────────────────
// A temple front: pediment with a rosette in the tympanum, architrave over a dentil course, six
// fluted columns, three steps, and coin stacks standing on the top step. Triangular where the tree
// screen is circular, and the coins are the tell that this is the cash screen.
const AS = 'asb';
const AS_PED_APEX_Y = C - 178;
const AS_PED_BASE_Y = C - 74;
const AS_PED_HALF = 178;
const AS_ARCH_Y = AS_PED_BASE_Y; // architrave sits directly under the pediment
const AS_ARCH_H = 18;
const AS_DENTIL_Y = AS_ARCH_Y + AS_ARCH_H;
const AS_CAP_Y = AS_DENTIL_Y + 9;
const AS_SHAFT_Y = AS_CAP_Y + 13;
const AS_SHAFT_BOTTOM = C + 100;
const AS_BASE_H = 14;
const AS_STEP_Y = AS_SHAFT_BOTTOM + AS_BASE_H;

const AS_COLUMNS = [-150, -90, -30, 30, 90, 150].map(dx => C + dx);
const AS_DENTILS = Array.from({ length: 19 }, (_, i) => C - 171 + i * 19);
// Widening treads. The last one runs to the bottom of the viewBox so the facade sits on the ground
// instead of floating; the mask's bottom fade takes it out from under the rows below.
const AS_STEPS = [
  { y: AS_STEP_Y, h: 15, half: 176 },
  { y: AS_STEP_Y + 15, h: 15, half: 188 },
  { y: AS_STEP_Y + 30, h: 26, half: 199 },
];
// Coin stacks standing on the cornice, out in the triangular void either side of the pediment. They
// were on the top step first, which put them squarely behind the filter pills — the one part of this
// hero that is guaranteed to have UI over it — where they read as scribble. Up here they're in the
// only large area of the drawing no content ever reaches, so they render at full contrast.
const AS_STACKS = [
  { x: C - 148, coins: 4 },
  { x: C + 148, coins: 3 },
];

export const AssetsBackdrop: React.FC = () => (
  <ReliefSvg p={AS} wellRx={150} wellRy={158}>
    {/* ── Pediment: outer cornice, recessed tympanum, rosette ── */}
    <g filter={`url(#${AS}-cast)`}>
      <path
        d={`M ${C} ${AS_PED_APEX_Y} L ${C + AS_PED_HALF} ${AS_PED_BASE_Y} L ${C - AS_PED_HALF} ${AS_PED_BASE_Y} Z`}
        fill={`url(#${AS}-stone-v)`}
        stroke="var(--relief-edge)"
        strokeWidth="1.3"
      />
    </g>
    {/* The recess: filled with the low tone and edged with shadow at the top, light at the bottom —
        the inverse of a raised member, which is what makes it read as sunk into the pediment. */}
    <path
      d={`M ${C} ${AS_PED_APEX_Y + 26} L ${C + 150} ${AS_PED_BASE_Y - 14} L ${C - 150} ${AS_PED_BASE_Y - 14} Z`}
      fill="var(--relief-lo)"
      stroke="var(--relief-shadow)"
      strokeWidth="1.2"
      opacity="0.85"
    />
    <line x1={C - 150} y1={AS_PED_BASE_Y - 14} x2={C + 150} y2={AS_PED_BASE_Y - 14} stroke="var(--relief-edge)" strokeWidth="0.9" opacity="0.7" />
    {/* The tympanum is left plain. A rosette lived here and was almost entirely hidden by the
        avatar, which sits directly in front of it. */}

    {/* ── Architrave and dentil course ── */}
    <g filter={`url(#${AS}-cast)`}>
      <rect x={C - 186} y={AS_ARCH_Y} width="372" height={AS_ARCH_H} fill={`url(#${AS}-stone-v)`} stroke="var(--relief-line)" strokeWidth="1" />
    </g>
    <line x1={C - 186} y1={AS_ARCH_Y} x2={C + 186} y2={AS_ARCH_Y} stroke="var(--relief-edge)" strokeWidth="1.2" />
    <g filter={`url(#${AS}-cast-tight)`}>
      {AS_DENTILS.map((x, i) => (
        <rect key={`as-dentil-${i}`} x={x} y={AS_DENTIL_Y} width="9" height="9" fill={`url(#${AS}-stone-h)`} stroke="var(--relief-line)" strokeWidth="0.6" />
      ))}
    </g>

    {/* ── Fluted colonnade ── */}
    {AS_COLUMNS.map((x, i) => (
      <g key={`as-col-${i}`}>
        <g filter={`url(#${AS}-cast)`}>
          <rect x={x - 19} y={AS_CAP_Y} width="38" height="13" fill={`url(#${AS}-stone-v)`} stroke="var(--relief-edge)" strokeWidth="1" />
          <rect x={x - 14} y={AS_SHAFT_Y} width="28" height={AS_SHAFT_BOTTOM - AS_SHAFT_Y} fill={`url(#${AS}-stone-h)`} stroke="var(--relief-line)" strokeWidth="0.9" />
          <rect x={x - 19} y={AS_SHAFT_BOTTOM} width="38" height={AS_BASE_H} fill={`url(#${AS}-stone-v)`} stroke="var(--relief-edge)" strokeWidth="1" />
        </g>
        {/* Flutes: a shadow groove with a lit lip on its left, repeated across the shaft. */}
        {[-7, 0, 7].map(dx => (
          <g key={`as-flute-${i}-${dx}`}>
            <line x1={x + dx} y1={AS_SHAFT_Y + 3} x2={x + dx} y2={AS_SHAFT_BOTTOM - 3} stroke="var(--relief-shadow)" strokeWidth="1.2" opacity="0.45" />
            <line x1={x + dx - 1.2} y1={AS_SHAFT_Y + 3} x2={x + dx - 1.2} y2={AS_SHAFT_BOTTOM - 3} stroke="var(--relief-edge)" strokeWidth="0.6" opacity="0.75" />
          </g>
        ))}
        <line x1={x - 14} y1={AS_SHAFT_Y} x2={x - 14} y2={AS_SHAFT_BOTTOM} stroke="var(--relief-edge)" strokeWidth="1" />
      </g>
    ))}

    {/* ── Steps ── */}
    <g filter={`url(#${AS}-cast)`}>
      {AS_STEPS.map((s, i) => (
        <rect key={`as-step-${i}`} x={C - s.half} y={s.y} width={s.half * 2} height={s.h} fill={`url(#${AS}-stone-v)`} stroke="var(--relief-line)" strokeWidth="1" />
      ))}
    </g>
    {AS_STEPS.map((s, i) => (
      <line key={`as-tread-${i}`} x1={C - s.half} y1={s.y} x2={C + s.half} y2={s.y} stroke="var(--relief-edge)" strokeWidth="1.1" />
    ))}

    {/* ── Coin stacks. Drawn as one cylinder — a shaded side wall, the top coin's face, and a rim line
           per coin down the front — rather than as N stacked ellipses: the tokens are near-transparent
           by design, so N outlines with almost no fill between them read as a coil of wire, not as
           money. One silhouette with divisions engraved into it is how relief does a stack. ── */}
    <g filter={`url(#${AS}-cast-tight)`}>
      {AS_STACKS.map(stack => {
        const { x } = stack;
        const rx = 18;
        const ry = 5.5;
        const step = 9;
        const baseY = AS_ARCH_Y - 5; // resting on the cornice
        const topY = baseY - (stack.coins - 1) * step;
        return (
          <g key={`as-stack-${x}`}>
            <path
              d={`M ${x - rx} ${topY} L ${x - rx} ${baseY} A ${rx} ${ry} 0 0 0 ${x + rx} ${baseY} L ${x + rx} ${topY} Z`}
              fill={`url(#${AS}-stone-h)`}
              stroke="var(--relief-line)"
              strokeWidth="0.8"
            />
            {Array.from({ length: stack.coins - 1 }, (_, i) => {
              const y = baseY - i * step;
              return (
                <path
                  key={`as-rim-${x}-${i}`}
                  d={`M ${x - rx} ${y} A ${rx} ${ry} 0 0 0 ${x + rx} ${y}`}
                  fill="none"
                  stroke="var(--relief-shadow)"
                  strokeWidth="0.9"
                  opacity="0.5"
                />
              );
            })}
            <ellipse cx={x} cy={topY} rx={rx} ry={ry} fill={`url(#${AS}-dome)`} stroke="var(--relief-edge)" strokeWidth="1" />
          </g>
        );
      })}
    </g>
  </ReliefSvg>
);

// ── Retirement: the wreath and the hourglass ────────────────────────────────────────────────────
// A laurel wreath, tied at the bottom and open at the top, around an hourglass whose sand has half
// run through. Time and honoured service, which is what a provident fund is — and nothing here is
// a circle of hardware or a row of columns, so it can't be mistaken for either of the other two.
const RT = 'rtb';
const RT_LEAF_OUT = 166;
const RT_LEAF_IN = 146;
const RT_STEM = 156;
const RT_BOTTOM = Math.PI / 2; // wreath is tied at the bottom
const RT_SPAN = 2.36; // sweep of each branch; the leftover at the top is the wreath's opening
const RT_START = 0.16; // clear of the knot

// Two rows of leaves per branch, the inner row offset by half a step so the rows interleave rather
// than lining up into spokes.
const RT_LEAVES = [-1, 1].flatMap(side =>
  [
    { r: RT_LEAF_OUT, n: 11, offset: 0 },
    { r: RT_LEAF_IN, n: 10, offset: 0.5 },
  ].flatMap(row =>
    Array.from({ length: row.n }, (_, i) => {
      const t = (i + row.offset) / 10;
      const a = RT_BOTTOM + side * (RT_START + t * RT_SPAN);
      const q = polar(row.r, a);
      return {
        ...q,
        // Rotated to the branch's tangent, then tilted outward the way a laurel leaf sits.
        rot: deg(a) + 90 - 26 * side,
        rx: row.r === RT_LEAF_OUT ? 15 : 12.5,
        ry: row.r === RT_LEAF_OUT ? 6.5 : 5.5,
      };
    })
  )
);

const RT_BRANCHES = [-1, 1].map(side => ({
  stem: arc(RT_STEM, RT_BOTTOM + side * RT_START, RT_BOTTOM + side * (RT_START + RT_SPAN)),
}));

// Rays filling the wreath's opening — the light the whole thing is pointed at.
const RT_RAYS = Array.from({ length: 7 }, (_, i) => {
  const a = -Math.PI / 2 + (i - 3) * 0.135;
  return spike(150, 186, a, 0.02, 0.005);
});

const RT_PLATE_HALF = 58;
const RT_PLATE_Y = 126; // ± from centre
const RT_POST_W = 10;
// Bulbs: from the plate's inner corners, curving in to a narrow neck at the centre. The cubic's
// first control point holds the sidewall almost vertical near the plate and the second pulls it in
// sharply at the neck, which is the profile of blown glass rather than a plain funnel.
const RT_UPPER_BULB =
  `M ${C - 42} ${C - 112} L ${C + 42} ${C - 112} ` +
  `C ${C + 40} ${C - 60} ${C + 14} ${C - 24} ${C + 4} ${C - 3} ` +
  `L ${C - 4} ${C - 3} ` +
  `C ${C - 14} ${C - 24} ${C - 40} ${C - 60} ${C - 42} ${C - 112} Z`;
const RT_LOWER_BULB =
  `M ${C - 42} ${C + 112} L ${C + 42} ${C + 112} ` +
  `C ${C + 40} ${C + 60} ${C + 14} ${C + 24} ${C + 4} ${C + 3} ` +
  `L ${C - 4} ${C + 3} ` +
  `C ${C - 14} ${C + 24} ${C - 40} ${C + 60} ${C - 42} ${C + 112} Z`;
// What's left in the upper bulb: a flat surface, tapering to the neck.
const RT_SAND_UPPER =
  `M ${C - 20} ${C - 58} L ${C + 20} ${C - 58} ` +
  `C ${C + 16} ${C - 34} ${C + 6} ${C - 16} ${C + 4} ${C - 3} ` +
  `L ${C - 4} ${C - 3} ` +
  `C ${C - 6} ${C - 16} ${C - 16} ${C - 34} ${C - 20} ${C - 58} Z`;
// …and the heap it has fallen into.
const RT_SAND_PILE =
  `M ${C - 34} ${C + 112} C ${C - 26} ${C + 112} ${C - 14} ${C + 88} ${C} ${C + 80} ` +
  `C ${C + 14} ${C + 88} ${C + 26} ${C + 112} ${C + 34} ${C + 112} Z`;

export const RetirementBackdrop: React.FC = () => (
  <ReliefSvg p={RT} wellRx={132} wellRy={150}>
    {/* ── Rays in the wreath's opening ── */}
    {RT_RAYS.map((d, i) => (
      <path key={`rt-ray-${i}`} d={d} fill={`url(#${RT}-dome)`} stroke="var(--relief-line)" strokeWidth="0.5" opacity="0.9" />
    ))}

    {/* ── Wreath: stems first, then the leaves standing proud of them ── */}
    {RT_BRANCHES.map((b, i) => (
      <g key={`rt-branch-${i}`}>
        <path d={b.stem} fill="none" stroke="var(--relief-shadow)" strokeWidth="3.4" opacity="0.45" transform="translate(1.2 1.8)" />
        <path d={b.stem} fill="none" stroke="var(--relief-edge)" strokeWidth="2.4" />
      </g>
    ))}
    <g filter={`url(#${RT}-cast-tight)`}>
      {RT_LEAVES.map((l, i) => (
        <ellipse
          key={`rt-leaf-${i}`}
          cx={l.x}
          cy={l.y}
          rx={l.rx}
          ry={l.ry}
          fill={`url(#${RT}-dome)`}
          stroke="var(--relief-line)"
          strokeWidth="0.8"
          transform={`rotate(${f(l.rot)} ${f(l.x)} ${f(l.y)})`}
        />
      ))}
    </g>

    {/* ── Knot and ribbon tails where the branches are tied. Each tail widens as it falls away from
           the knot and ends on a swallowtail notch, which is what reads as ribbon rather than as a
           stray curl — an earlier pair curved back over themselves and read as neither. ── */}
    <g filter={`url(#${RT}-cast-tight)`}>
      {[-1, 1].map(side => (
        <path
          key={`rt-tail-${side}`}
          d={
            `M ${C + side * 3} ${C + 170} ` +
            `C ${C + side * 20} ${C + 174} ${C + side * 34} ${C + 178} ${C + side * 50} ${C + 176} ` +
            `L ${C + side * 44} ${C + 183} L ${C + side * 52} ${C + 189} ` +
            `C ${C + side * 32} ${C + 190} ${C + side * 16} ${C + 184} ${C + side * 3} ${C + 178} Z`
          }
          fill={`url(#${RT}-dome)`}
          stroke="var(--relief-line)"
          strokeWidth="0.9"
        />
      ))}
      <circle cx={C} cy={C + 172} r="9" fill={`url(#${RT}-dome)`} stroke="var(--relief-edge)" strokeWidth="1.1" />
    </g>

    {/* ── Hourglass frame: plates and side posts, standing well proud of the wall ── */}
    <g filter={`url(#${RT}-cast)`}>
      <rect x={C - RT_PLATE_HALF} y={C - RT_PLATE_Y} width={RT_PLATE_HALF * 2} height="14" fill={`url(#${RT}-stone-v)`} stroke="var(--relief-edge)" strokeWidth="1.1" />
      <rect x={C - RT_PLATE_HALF} y={C + RT_PLATE_Y - 14} width={RT_PLATE_HALF * 2} height="14" fill={`url(#${RT}-stone-v)`} stroke="var(--relief-edge)" strokeWidth="1.1" />
      {[-1, 1].map(side => (
        <rect
          key={`rt-post-${side}`}
          x={side < 0 ? C - RT_PLATE_HALF : C + RT_PLATE_HALF - RT_POST_W}
          y={C - RT_PLATE_Y + 14}
          width={RT_POST_W}
          height={(RT_PLATE_Y - 14) * 2}
          fill={`url(#${RT}-stone-h)`}
          stroke="var(--relief-line)"
          strokeWidth="0.9"
        />
      ))}
    </g>

    {/* ── Glass: shaded body with a lit rim, plus a shadow line inside the right wall ── */}
    {[RT_UPPER_BULB, RT_LOWER_BULB].map((d, i) => (
      <g key={`rt-bulb-${i}`}>
        <path d={d} fill={`url(#${RT}-stone-v)`} stroke="var(--relief-edge)" strokeWidth="1.2" />
        <path d={d} fill="none" stroke="var(--relief-shadow)" strokeWidth="0.9" opacity="0.4" transform="translate(2 1.5)" />
      </g>
    ))}

    {/* ── Sand: still above, running, and heaped below ── */}
    <path d={RT_SAND_UPPER} fill="var(--relief-hi)" stroke="var(--relief-line)" strokeWidth="0.7" opacity="0.85" />
    <line x1={C - 20} y1={C - 58} x2={C + 20} y2={C - 58} stroke="var(--relief-edge)" strokeWidth="1.1" />
    <line x1={C} y1={C - 1} x2={C} y2={C + 74} stroke="var(--relief-edge)" strokeWidth="1.3" opacity="0.55" strokeDasharray="3 5" />
    <g filter={`url(#${RT}-cast-tight)`}>
      <path d={RT_SAND_PILE} fill="var(--relief-hi)" stroke="var(--relief-line)" strokeWidth="0.7" opacity="0.85" />
    </g>
  </ReliefSvg>
);
