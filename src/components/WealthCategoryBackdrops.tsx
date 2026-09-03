// The three Wealth category engravings. The shared relief language — square viewBox, concentric
// composition, lit/shadow edges, the legibility well — lives in relief.tsx; what's here is the
// SUBJECT of each drawing, and each category gets its own:
//
//   Portfolio  → a sunburst medallion behind a candlestick colonnade with a rising trend ribbon.
//   Assets     → a treasury facade: pediment, dentils, fluted colonnade, steps and coin stacks.
//   Retirement → a shield around an hourglass, sand falling from the upper bulb into the lower.
//
// The tree screen's vault door (WealthBackdrop) says "your wealth"; repeating it on the inner
// screens would say nothing about which category you'd opened.
import React from 'react';
import { ReliefSvg } from './relief';
import { C, f, polar, ring, spike } from '../utils/reliefGeometry';

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

// ── Retirement: the shield and the hourglass ────────────────────────────────────────────────────
// A shield around an hourglass with its sand running. Time and statutory protection, which is what a
// provident fund is — and nothing here is a circle of hardware or a row of columns, so it can't be
// mistaken for either of the other two.
//
// THE SHIELD IS THE LUCIDE `shield` OUTLINE, verbatim, because it is the same mark the app already
// uses for an EPF account: ShieldUser on the account row (see transactionIcons) and ShieldCheck on
// this category's own card. Redrawing it by hand would have produced a shield that is nearly the
// icon and not quite, which is worse than either — the point of borrowing it is that the engraving
// and the 18px glyph are recognisably one device.
//
// It replaces a laurel wreath. The wreath said "honoured service" and read well, but it said nothing
// about protection, and it shared its vocabulary with nothing else in the app — where the shield is
// already this category's mark everywhere the user has been. The rays that filled the wreath's
// opening and the ribbon that tied its foot went with it: a wreath is open at the top and needs
// something in the gap, a shield is closed and needs nothing.
const RT = 'rtb';

// Lucide's `shield`, on its own 24-unit grid. Kept as the icon ships it so a future lucide update
// can be diffed against this string rather than re-derived.
const RT_SHIELD_D =
  'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 ' +
  '6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z';
// SCALED UNEVENLY, and that is the one deliberate liberty taken with the borrowed path.
//
// The icon is a 4:5 upright, and only viewBox y 0–400 is ever on screen while the hero box is wide
// enough to show x −30…430. So a uniformly scaled shield hits the top and bottom of the frame long
// before it reaches the sides: grown until it fills the height it still leaves 76 units of empty
// margin either side, against 95 before. Stretching x by a fifth takes that to 46 and is what
// actually fills the frame.
//
// The cost, stated so nobody has to rediscover it: a stroke inside this group renders 20% thicker on
// the shield's vertical flanks than on its horizontal crest. At an 11-unit moulding that is 11
// against 9.2, which does not read at this size — and it is a far smaller fault than the hole it
// buys out. Should the hero ever get taller, drop RT_SHIELD_SX back toward RT_SHIELD_SY.
const RT_SHIELD_SY = 19.2;
const RT_SHIELD_SX = 23;
// The icon's own centre is (12, 12).
const RT_SHIELD_T =
  `translate(${f(C - 12 * RT_SHIELD_SX)} ${f(C - 12 * RT_SHIELD_SY)}) scale(${RT_SHIELD_SX} ${RT_SHIELD_SY})`;
/** A width or an offset given in FINAL viewBox units, expressed in the shield's own scaled space.
 *  Everything inside that group is multiplied by the scale, so a raw 1.6 there would draw a 30-unit
 *  slab. Divided by the SMALLER factor, so a stroke is never thinner than asked for. */
const rtS = (v: number) => f(v / RT_SHIELD_SY);

/** How much bigger the hourglass is than the geometry below describes it.
 *
 *  The paths are all written about C at their original size and then scaled as one group, rather
 *  than each being re-authored — which keeps the bulb profile, the sand and the frame in the exact
 *  proportions they were tuned in. It also widens the bulb faster than the avatar grows (the avatar
 *  is a fixed 62 units), so MORE of the sand's funnel clears it than before. */
const RT_GLASS_S = 1.18;

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

// ── The sand, and why it is drawn the way it is ─────────────────────────────────────────────────
// IT USED TO BE INVISIBLE, and the cause is worth recording because it will catch the next drawing
// too: the sand was filled with --relief-hi, which is a SHEEN token — white at 0.055 on the dark
// theme — not a body colour. Damped on top of that by the legibility well over the middle of the
// frame, it came out at about one percent of white and the hourglass read as empty. The dome
// gradient is no better for this: all three of its stops are the same near-transparent sheen, which
// is right for a form read through its EDGES and useless for one that has to read as a mass.
//
// SO THE SAND IS FILLED WITH --relief-line, which is the only token in the set that is a visible
// tone against its own ground in BOTH themes — white at 0.20 on the dark one, slate at 0.16 on the
// light. --relief-edge would have been brighter on dark and then invisible on light, where it is
// near-white on a near-white ground; that inversion is the trap every choice here has to clear.
//
// THE TOP SURFACE IS A FUNNEL, not a flat line. A flat surface is what an hourglass that has STOPPED
// looks like; one that is running has a conical depression drawn down toward the neck, and that cone
// is the single strongest signal that the thing is in motion. The stream and the grains say the same
// thing again in case the cone is missed at small sizes.
//
// THE SURFACE HAS TO SIT HIGH IN THE BULB, and that is forced rather than chosen. The avatar is an
// opaque 62-unit disc on the same axis, occupying roughly y 105–167 — which is most of the upper
// bulb — so a surface drawn at any comfortable "half full" height is simply hidden behind it. At
// y C−100 the bulb's sidewall is ±40 units (solved off its own cubic), which is outside the avatar's
// ±31, so the funnel's two outer rims show either side of the disc and only the bottom of the cone
// is occluded. That is the whole trick: the parts of the funnel that carry the meaning are its
// slopes, and those are the parts that clear the avatar.
const RT_SAND_UPPER =
  `M ${C - 40} ${C - 100} ` +
  `C ${C - 28} ${C - 84} ${C - 14} ${C - 78} ${C} ${C - 78} ` +
  `C ${C + 14} ${C - 78} ${C + 28} ${C - 84} ${C + 40} ${C - 100} ` +
  `C ${C + 38} ${C - 58} ${C + 13} ${C - 23} ${C + 4} ${C - 3} ` +
  `L ${C - 4} ${C - 3} ` +
  `C ${C - 13} ${C - 23} ${C - 38} ${C - 58} ${C - 40} ${C - 100} Z`;
// THE FALL IS GRAINS, ALL OF IT, and two earlier versions are why.
//
// It began as one filled quad running the whole 76 units from neck to heap — 7 units wide at the top,
// 11 at the bottom, plus a 1.3 stroke, all multiplied by RT_GLASS_S. At that size a solid column IS a
// bar: the widening its note relied on to save it ("a column that fell dead straight would read as a
// rule drawn down the middle of the glass") is 4 units over 76, which nobody reads as taper. Five
// grains at r≈2 beside a slab of that area cannot be seen next to it either.
//
// The second version cut that column to a 20-unit thread at the neck and made the rest grains, on the
// argument that real sand is continuous for the first few millimetres before it breaks up. True of
// sand, and useless here: 20 units tall by 6 wide is a bar with the same proportions as the original,
// just shorter, and it sat at the mouth where the eye lands first. A form reads as a bar or as a
// grain by its ASPECT, not by its length — and nothing 3× taller than it is wide reads as a grain.
//
// So there is no continuous member at all now. The grains simply start tight under the neck (5-unit
// pitch, barely off the axis, near-full opacity, which is what "not yet dispersed" looks like when
// it is made of countable things) and loosen as they fall. Nothing in the drawing is a rectangle any
// more, which is the only way the bar cannot come back.
const RT_FALL_TOP = 6;  // the first grain, just clear of the neck
const RT_FALL_BOT = 83; // the last, just clear of the heap's peak at C+88
// Hand-placed, never randomised: a backdrop that reshuffled itself on every render would flicker on
// any state change the hero makes.
//
// Placed to three rules, none of them decorative. They ALTERNATE across the axis, because a single
// file of dots is the bar again with gaps in it. Their spread WIDENS as they descend (±2 at the neck,
// ±6.5 at the heap), which is what a stream losing its coherence does — and it is this, rather than
// any solid thread, that now carries "the sand is still joined up as it leaves the neck". And they
// THIN downward, so the eye is carried from neck to heap rather than meeting a uniform speckle.
// They stay off the axis by at least 1.5 units: the legibility well is cut deepest dead centre, so a
// grain sitting exactly on the midline is the one least likely to survive it.
const RT_GRAINS = [
  { x: C - 1.8, y: C + 6, r: 2.4, o: 0.92 },
  { x: C + 2.0, y: C + 11, r: 2.2, o: 0.90 },
  { x: C - 2.4, y: C + 16, r: 2.5, o: 0.88 },
  { x: C + 1.8, y: C + 21, r: 2.1, o: 0.86 },
  { x: C - 3.2, y: C + 26, r: 2.2, o: 0.82 },
  { x: C + 3.0, y: C + 31, r: 1.9, o: 0.78 },
  { x: C - 4.2, y: C + 37, r: 2.4, o: 0.74 },
  { x: C + 1.8, y: C + 43, r: 1.8, o: 0.70 },
  { x: C + 5.2, y: C + 50, r: 2.2, o: 0.66 },
  { x: C - 5.6, y: C + 57, r: 2.0, o: 0.60 },
  { x: C + 2.4, y: C + 64, r: 2.5, o: 0.54 },
  { x: C - 3.0, y: C + 71, r: 1.9, o: 0.48 },
  { x: C + 6.0, y: C + 77, r: 2.1, o: 0.42 },
  { x: C - 6.5, y: C + 83, r: 1.7, o: 0.36 },
];
// …and the cone it has fallen into, peaked where the stream lands. Smaller than the mass above it,
// because the two have to add up: a full upper bulb over a deep heap is more sand than the glass
// holds, and that reads as wrong even when nobody can say why.
const RT_SAND_PILE =
  `M ${C - 30} ${C + 112} C ${C - 22} ${C + 112} ${C - 12} ${C + 94} ${C} ${C + 88} ` +
  `C ${C + 12} ${C + 94} ${C + 22} ${C + 112} ${C + 30} ${C + 112} Z`;

export const RetirementBackdrop: React.FC = () => (
  // A shallower well than the default, and the sand is the reason. The hourglass sits dead centre —
  // it has to, the shield is symmetric about the same axis — so the default cut, which keeps under a
  // fifth there, took the one part of the drawing that says the thing is running. The sand is a
  // small, bright, isolated form rather than a field of texture, so it survives the shallower cut
  // without crowding the figures the way a full-strength background would.
  <ReliefSvg
    p={RT}
    wellRx={140}
    wellRy={158}
    well={[{ at: 0, hide: 0.55 }, { at: 42, hide: 0.45 }, { at: 74, hide: 0.2 }, { at: 100, hide: 0 }]}
    // A later, shallower foot fade than the default. The shield's point now reaches y 392, and under
    // the standard ramp (from 0.8, down to 0.12) it would render at about a tenth and read as cut
    // off rather than tapered. It needs no help dissolving in any case — it is already a point.
    fade={{ start: 0.9, floor: 0.32 }}
  >
    {/* ── The shield ── A moulding, not an outline: a shadow copy behind, the stone body, and a lit
        rim on top, which is how every raised member in this file is built. The chased inner line is
        the border a real escutcheon carries, and it is what stops a single thick stroke reading as a
        cartoon outline. */}
    <g transform={RT_SHIELD_T}>
      <path d={RT_SHIELD_D} fill="none" stroke="var(--relief-shadow)" strokeWidth={rtS(12)} opacity="0.5" transform={`translate(${rtS(2.5)} ${rtS(3.5)})`} />
      <path
        d={RT_SHIELD_D} fill="none" stroke={`url(#${RT}-stone-v)`}
        style={{ strokeOpacity: 'var(--relief-plate-fill)' }} strokeWidth={rtS(11)}
      />
      <path d={RT_SHIELD_D} fill="none" stroke="var(--relief-edge)" strokeWidth={rtS(1.7)} />
      <g transform="translate(12 12) scale(0.9) translate(-12 -12)">
        <path d={RT_SHIELD_D} fill="none" stroke="var(--relief-line)" strokeWidth={rtS(1.5)} opacity="0.5" />
      </g>
    </g>

    {/* ── The hourglass ── One scale about the centre for the whole instrument, so the frame, the
        glass and the sand keep the proportions they were tuned in. Stroke weights scale with it,
        which is right: a bigger member carries a heavier moulding. */}
    <g transform={`translate(${C} ${C}) scale(${RT_GLASS_S}) translate(${-C} ${-C})`}>

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

    {/* ── Sand: draining above, falling through, heaping below ── */}
    <g filter={`url(#${RT}-cast-tight)`}>
      {/* Still in the top bulb, its surface drawn down into a funnel. The rim highlights are the two
          short lines: a funnel's high points are its outer edges, so that is where the light is. */}
      <path d={RT_SAND_UPPER} fill="var(--relief-line)" fillOpacity="0.85" stroke="var(--relief-edge)" strokeWidth="1.5" />
      {[-1, 1].map(side => (
        <line
          key={`rt-rim-${side}`}
          x1={C + side * 40} y1={C - 100} x2={C + side * 15} y2={C - 82}
          stroke="var(--relief-edge)" strokeWidth="1.5" opacity="0.9"
        />
      ))}

      {/* The fall itself — grains the whole way, no continuous member. See the note above. */}
      {RT_GRAINS.map(g => {
        /* A grain draws out as it falls, because it is going faster the further it has fallen. The
           ellipse stretches with depth rather than every grain being struck from one die — which is
           what separates a fall from a column of identical dots, and it costs one number. */
        const depth = Math.min(1, Math.max(0, (g.y - (C + RT_FALL_TOP)) / (RT_FALL_BOT - RT_FALL_TOP)));
        return (
          <ellipse
            key={`rt-grain-${g.x}-${g.y}`}
            cx={g.x} cy={g.y} rx={g.r} ry={f(g.r * (1.35 + depth * 0.9))}
            fill="var(--relief-line)" stroke="var(--relief-edge)" strokeWidth="1" opacity={g.o}
          />
        );
      })}

      {/* The cone it has fallen into, peaked where the stream lands. */}
      <path d={RT_SAND_PILE} fill="var(--relief-line)" fillOpacity="0.85" stroke="var(--relief-edge)" strokeWidth="1.5" />
    </g>

    </g>
  </ReliefSvg>
);
