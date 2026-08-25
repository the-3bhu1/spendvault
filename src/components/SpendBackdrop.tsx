// The Dashboard hero's engraving: SpendVault's own coin, struck at monument scale.
//
// Same relief language as the Wealth and Cards backdrops — see the COMPOSITION and RELIEF notes in
// relief.tsx — but this one is not an invented motif. THE APP'S LOGO IS ALREADY A COIN (public/
// logo.png): a legend ring of repeating "DIGITAL RUPEE" around a field of fine concentric rings,
// with an e₹ struck in the middle as its device. So the hero didn't need a new subject; it needed the
// brand's own one at size, with the month's total taking the device's place — which is exactly what a
// coin does with its denomination.
//
// That is also the fix for two earlier drafts, which read first as a spoked wheel and then as
// unfinished. Both of the logo's signatures were missing:
//
//   THE LEGEND RING. A rim carrying nothing but milling is a wheel. A rim carrying engraved words is
//   a coin, and it says whose coin. The legend is set with textLength across the full circumference,
//   so it closes exactly however the mono face resolves — no gap, no overlap, and no dependence on a
//   guess about character widths.
//
//   THE RINGED FIELD. The logo's field is dense with fine concentric circles — the "digital" in
//   digital rupee, a struck record. An empty field is what made the drawing read as a frame around
//   nothing; the rings are what make that emptiness a surface.
//
// Everything decorative is CONCENTRIC, deliberately, after the wheel draft: rings read as a turned
// and struck object, radii read as spokes.
//
// The composition is the coin's own — legend at the rim, denomination in the field — which is why
// this is the one hero in the app whose motif sits in the middle. Cards and Wealth stack five or six
// elements down the same square and have to keep their centres clear (the long note in
// CardsBackdrops has that arithmetic). Here the hero carries two lines, so the field is free.
//
// NOT data-bound. The rings are a fixed texture, not a chart: a drawing whose geometry moves with the
// numbers invites being measured, and there is a real chart on the screen below for that.
import React from 'react';
import { ReliefSvg } from './relief';
import { C, f, polar } from '../utils/reliefGeometry';

const SP = 'spb';

// ── The rim and its legend ───────────────────────────────────────────────────────────────────────
// Pushed close to the viewBox edge, and the band kept narrow: every unit the rim takes is a unit the
// field loses, and the field has to hold a ten-character rupee figure.
const RIM_OUT = 194;
const RIM_IN = 172;
const LEGEND_R = (RIM_OUT + RIM_IN) / 2;
const LEGEND_CIRCUMFERENCE = 2 * Math.PI * LEGEND_R;
// Repeated with a pellet between, exactly as the logo repeats its own legend. Six passes at this
// radius set the word at a size that reads as engraved lettering rather than as a texture.
const LEGEND = Array.from({ length: 6 }, () => 'SPENDVAULT').join(' · ') + ' · ';

// A full circle as one path, starting at 12 o'clock and running clockwise, for the legend to flow
// along. Two half-arcs, because a single arc command cannot describe a closed circle.
const legendPath =
  `M ${C} ${C - LEGEND_R} ` +
  `A ${LEGEND_R} ${LEGEND_R} 0 1 1 ${C} ${C + LEGEND_R} ` +
  `A ${LEGEND_R} ${LEGEND_R} 0 1 1 ${C} ${C - LEGEND_R}`;

// ── The field ────────────────────────────────────────────────────────────────────────────────────
// The bead is the raised ring that bounds the design; the field is the struck surface inside it.
const BEAD = 166;
const FIELD = 162;
// The record: fine rings from just outside the figure to just inside the bead, evenly spaced and
// fading outward so the surface reads as domed rather than as a flat target.
const RINGS = 16;
const RING_IN = 30;
const RING_OUT = 152;

export const SpendBackdrop: React.FC = () => (
  // The well is sized to the text block — month label and figure — rather than to the field. It has
  // to mute the rings directly behind the type without flattening the ones that give the rest of the
  // surface its texture.
  <ReliefSvg p={SP} wellRx={142} wellRy={104}>
    {/* ── Rim ── */}
    <g filter={`url(#${SP}-cast)`}>
      <circle cx={C} cy={C} r={RIM_OUT} fill="none" stroke="var(--relief-line)" strokeWidth="1.6" opacity="0.55" />
    </g>
    <circle cx={C} cy={C} r={RIM_IN} fill="none" stroke="var(--relief-edge)" strokeWidth="1" opacity="0.4" />

    {/* ── Legend ──
        textLength + lengthAdjust="spacing" force the repeated word to occupy the circle exactly, so
        the ring closes cleanly whatever the font resolves to. The tracking comes out of that fit
        rather than from a letter-spacing value, for the same reason. */}
    <path id={`${SP}-legend-path`} d={legendPath} fill="none" />
    <text
      fill="var(--relief-line)"
      opacity="0.62"
      style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', fontWeight: 700 }}
    >
      <textPath
        href={`#${SP}-legend-path`}
        startOffset="0"
        textLength={f(LEGEND_CIRCUMFERENCE)}
        lengthAdjust="spacing"
      >
        {LEGEND}
      </textPath>
    </text>

    {/* ── Field: the domed surface, its bead, and the record's rings ── */}
    <circle cx={C} cy={C} r={FIELD} fill={`url(#${SP}-dome)`} />
    {/* The bead reads as raised because its lit half and its shadowed half are separate strokes: one
        continuous stroke all the way round would be a printed outline, not a moulding under a light
        from the top-left. */}
    <path
      d={`M ${f(polar(BEAD, Math.PI * 0.75).x)} ${f(polar(BEAD, Math.PI * 0.75).y)} A ${BEAD} ${BEAD} 0 0 1 ${f(polar(BEAD, Math.PI * 1.75).x)} ${f(polar(BEAD, Math.PI * 1.75).y)}`}
      fill="none" stroke="var(--relief-edge)" strokeWidth="1.8" opacity="0.5"
    />
    <path
      d={`M ${f(polar(BEAD, Math.PI * 1.75).x)} ${f(polar(BEAD, Math.PI * 1.75).y)} A ${BEAD} ${BEAD} 0 0 1 ${f(polar(BEAD, Math.PI * 0.75).x)} ${f(polar(BEAD, Math.PI * 0.75).y)}`}
      fill="none" stroke="var(--relief-shadow)" strokeWidth="1.8" opacity="0.34"
    />

    <g>
      {Array.from({ length: RINGS }, (_, i) => {
        const t = i / (RINGS - 1);
        const r = RING_IN + t * (RING_OUT - RING_IN);
        return (
          <circle
            key={i}
            cx={C} cy={C} r={f(r)}
            fill="none"
            stroke="var(--relief-line)"
            strokeWidth={i % 4 === 0 ? 1.1 : 0.7}
            opacity={0.3 - t * 0.16}
          />
        );
      })}
    </g>

    {/* Four pellets on the diagonals, just inside the bead, where a coin's design is usually
        punctuated — clear of the figure, and clear of the legend. */}
    {[0.25, 0.75, 1.25, 1.75].map(k => {
      const p = polar(FIELD - 12, Math.PI * k);
      return <circle key={k} cx={f(p.x)} cy={f(p.y)} r="2.6" fill="var(--relief-line)" opacity="0.4" />;
    })}
  </ReliefSvg>
);
