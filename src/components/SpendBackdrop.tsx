// The Dashboard hero's engraving: a struck coin.
//
// Same relief language as the Wealth and Cards backdrops — see the COMPOSITION and RELIEF notes in
// relief.tsx. The subject completes the set: Wealth's vault door is what you own, Cards' wallet
// stack is what you owe, and this is what you spent — a coin, milled and struck, because spending is
// the only one of the three that is a single act rather than a holding.
//
// This is the ONE hero in the app whose motif can sit in the middle, and that's a deliberate
// consequence of the redesign rather than a free choice. The Dashboard hero now carries two lines —
// a month and a total — occupying roughly viewBox y 150–250 of 400. Cards and Wealth stack five or
// six elements over the same square and have to keep their centres clear (the long note in
// CardsBackdrops explains the arithmetic). Here the field is free, so the coin is struck on it: the
// rim frames the total, the laurel sits under it, and the legibility well keeps the figure crisp.
//
// NOT data-bound, on purpose. An early sketch sized the decoration by category weight, which invites
// the reader to measure a texture — and puts a second, less accurate chart on a screen that already
// has a real one below it.
import React from 'react';
import { ReliefSvg } from './relief';
import { C, f, polar } from '../utils/reliefGeometry';

const SP = 'spb';

// Rim: an outer edge, an inner step, and the milling between them. Wider than Cards' rim because
// nothing here competes with it at the margins.
const RIM_OUT = 186;
const RIM_IN = 168;
const MILLS = 120;

// The struck field, and the raised bead that separates it from the rim — the two circles a real
// coin's design sits between.
const FIELD = 150;
const BEAD = 158;

// A laurel sweeping across the lower field, under the figure — the wreath struck beneath a
// denomination on a real coin.
//
// This replaced a radial fan, and the reason is worth recording: arcs radiating from the centre
// through the field turned the whole drawing into a SPOKED WHEEL. Milling all the way round a rim is
// already wheel-adjacent; add spokes and the coin becomes a gear. Everything decorative now lives in
// a band (r 112–140) that is concentric with the rim and clear of the figure, so the eye reads rings
// rather than radii.
const LAUREL_R = 124;
// Angles are SCREEN angles: y grows downward, so polar(r, 90°) is the BOTTOM of the circle, not the
// top. The first attempt read 160°→380° as "round the bottom" and drew the wreath across the sky.
// 20°→160° through 90° is the lower arc, and its ends rise just past the horizontal on either side,
// framing the figure without reaching the month label.
const LAUREL_FROM = (20 * Math.PI) / 180;
const LAUREL_TO = (160 * Math.PI) / 180;
const LEAVES = 11;

export const SpendBackdrop: React.FC = () => (
  <ReliefSvg p={SP} wellRx={132} wellRy={104}>
    {/* ── Rim: body, milling, inner step ── */}
    <g filter={`url(#${SP}-cast)`}>
      <circle cx={C} cy={C} r={RIM_OUT} fill="none" stroke="var(--relief-line)" strokeWidth="1.4" opacity="0.6" />
    </g>
    <circle cx={C} cy={C} r={RIM_IN} fill="none" stroke="var(--relief-edge)" strokeWidth="1" opacity="0.45" />
    <g opacity="0.34">
      {Array.from({ length: MILLS }, (_, i) => {
        const a = (i / MILLS) * Math.PI * 2;
        const p1 = polar(RIM_IN, a);
        const p2 = polar(RIM_OUT, a);
        return <line key={i} x1={f(p1.x)} y1={f(p1.y)} x2={f(p2.x)} y2={f(p2.y)} stroke="var(--relief-line)" strokeWidth="1" />;
      })}
    </g>

    {/* ── The field: a domed disc, so the coin reads as struck rather than drawn ── */}
    <circle cx={C} cy={C} r={FIELD} fill={`url(#${SP}-dome)`} />
    {/* The bead: a lit arc on the top-left and a shadowed one on the bottom-right of the same
        circle. One stroke all the way round would read as a printed outline; the split is what
        makes it a raised ring under a light from the top-left. */}
    <path
      d={`M ${f(polar(BEAD, Math.PI * 0.75).x)} ${f(polar(BEAD, Math.PI * 0.75).y)} A ${BEAD} ${BEAD} 0 0 1 ${f(polar(BEAD, Math.PI * 1.75).x)} ${f(polar(BEAD, Math.PI * 1.75).y)}`}
      fill="none" stroke="var(--relief-edge)" strokeWidth="1.6" opacity="0.5"
    />
    <path
      d={`M ${f(polar(BEAD, Math.PI * 1.75).x)} ${f(polar(BEAD, Math.PI * 1.75).y)} A ${BEAD} ${BEAD} 0 0 1 ${f(polar(BEAD, Math.PI * 0.75).x)} ${f(polar(BEAD, Math.PI * 0.75).y)}`}
      fill="none" stroke="var(--relief-shadow)" strokeWidth="1.6" opacity="0.34"
    />

    {/* ── The laurel ── */}
    <g opacity="0.85">
      {/* The stem, sampled rather than drawn as an arc: A-command sweep flags are the second easy
          way to get this wrong (the first was the angle convention above), and a polyline of points
          on the same circle cannot be mirrored by a flag. */}
      <path
        d={Array.from({ length: 41 }, (_, i) => {
          const a = LAUREL_FROM + (i / 40) * (LAUREL_TO - LAUREL_FROM);
          const pt = polar(LAUREL_R, a);
          return `${i === 0 ? 'M' : 'L'} ${f(pt.x)} ${f(pt.y)}`;
        }).join(' ')}
        fill="none" stroke="var(--relief-line)" strokeWidth="1.6" opacity="0.4" strokeLinecap="round"
      />
      {/* Leaves: a short stroke off the stem at each step, leaning OUTWARD from the centre and
          alternating either side of it, which is how a struck laurel reads. */}
      {Array.from({ length: LEAVES }, (_, i) => {
        const t = (i + 0.5) / LEAVES;
        const a = LAUREL_FROM + t * (LAUREL_TO - LAUREL_FROM);
        const outward = i % 2 === 0 ? 15 : -13;
        const base = polar(LAUREL_R, a);
        // Tilted along the stem, not straight out from the hub: the tangent is what stops the row of
        // leaves from reading as another set of spokes.
        const tip = polar(LAUREL_R + outward, a + (outward > 0 ? 0.075 : -0.075));
        return (
          <line
            key={i}
            x1={f(base.x)} y1={f(base.y)} x2={f(tip.x)} y2={f(tip.y)}
            stroke="var(--relief-line)" strokeWidth="2" opacity={0.3} strokeLinecap="round"
          />
        );
      })}
      {/* The tie at the foot of the wreath. */}
      <circle cx={C} cy={f(C + LAUREL_R)} r="3.4" fill="var(--relief-line)" opacity="0.4" />
    </g>
  </ReliefSvg>
);
