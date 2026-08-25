// The Dashboard hero's engraving: a struck coin, engine-turned, with a vault dial as its device.
//
// Same relief language as the Wealth and Cards backdrops — see the COMPOSITION and RELIEF notes in
// relief.tsx. Three pieces, each answering a specific complaint about an earlier draft:
//
//   THE LEGEND RING, from the app's own logo (public/logo.png), which is itself a coin: a ring of
//   repeating text around a field with a device struck in the middle. A rim carrying nothing but
//   milling is a wheel; a rim carrying engraved words is a coin, and it says whose. Set with
//   textLength across the full circumference so the ring closes exactly however the mono face
//   resolves, rather than on a guess about character widths.
//
//   THE GUILLOCHE, filling the annulus. Engine-turning is the interlace printed on banknotes, share
//   certificates and cheques, and it is built here the way a rose engine builds it — rings of
//   overlapping circles whose centres sit on a circle, two counts against each other to make the
//   weave. It replaced a field of plain concentric rings that read as a frame around nothing.
//
//   THE VAULT DIAL, below the total. A safe's combination dial: graduated collar, domed knob with
//   gripping spokes, hub, and the index it is read against. The app is called SpendVault and this is
//   the part that says so.
//
// The dial is also where the drawing's one apparent contradiction resolves. An early draft radiated
// arcs across the whole field and read as a spoked wheel, which is why everything decorative since
// has been concentric — but a handwheel is SUPPOSED to be spoked. The same radii that were wrong as
// an abstract flourish are right as a mechanism, and what contains them is that every one is short
// and sits inside the dial's own collar.
//
// The composition is the coin's own — legend at the rim, denomination in the field, device below it —
// which is why this is the one hero in the app whose motif sits in the middle. Cards and Wealth stack
// five or six elements down the same square and have to keep their centres clear (the long note in
// CardsBackdrops has that arithmetic). Here the hero carries two lines, so the field is free.
//
// NOT data-bound. None of it moves with the numbers: a drawing whose geometry did would invite being
// measured, and there is a real chart on the screen below for that.
import React from 'react';
import { ReliefSvg } from './relief';
import { C, f, polar } from '../utils/reliefGeometry';

const SP = 'spb';

// ── The rim and its legend ───────────────────────────────────────────────────────────────────────
// Pushed close to the viewBox edge, and the band kept narrow: every unit the rim takes is a unit the
// field loses, and the field has to hold a ten-character rupee figure.
const RIM_OUT = 194;
const RIM_IN = 172;
const LEGEND_SIZE = 15;
// Text on a path sits with its BASELINE on the path and its caps standing off it — outward here,
// since the legend path runs clockwise. So the band's mid-radius is the wrong place to put the
// baseline: at (RIM_OUT + RIM_IN) / 2 the caps reached 183 + cap ≈ 194 and touched the outer ring.
// The baseline goes low enough that the cap band is centred in the rim instead. 0.72em is Overpass
// Mono's cap height; a substituted face shifts this by a pixel at most.
const LEGEND_CAP = LEGEND_SIZE * 0.72;
const LEGEND_R = RIM_IN + (RIM_OUT - RIM_IN - LEGEND_CAP) / 2;
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

// ── The guilloche ────────────────────────────────────────────────────────────────────────────────
// Engine-turning: the interlace printed on banknotes, share certificates and cheques, built the way
// a rose engine builds it — rings of overlapping circles whose centres sit on a circle. Two rings of
// different counts produce the weave; one alone reads as a chain of loops.
//
// Both rings are kept in the OUTER band, and that is not a stylistic choice. The field's clear disc
// is what the total and the dial have to live in: pull the guilloche inward and the interlace crosses
// the figure. Ring A's circles reach r ≈ 100 at their innermost, which is the floor of everything
// below it.
const GUILLOCHE = [
  { n: 32, R: 138, rho: 22, op: 0.26, w: 0.85 },
  { n: 46, R: 152, rho: 12, op: 0.3, w: 0.8 },
];
const GUILLOCHE_IN = 116;
const GUILLOCHE_OUT = 164;

// ── The vault dial ───────────────────────────────────────────────────────────────────────────────
// A safe's combination dial, face on: a graduated collar, a domed knob with gripping spokes, a hub,
// and the index mark you line the graduations up against.
//
// This is the one place radial geometry is not only allowed but required. An earlier draft radiated
// arcs across the whole field and read as a spoked wheel, which was a failure — but a handwheel is
// SUPPOSED to be spoked, so the same lines that were wrong as an abstract flourish are right as a
// mechanism. What keeps it from infecting the rest of the drawing is that every radius here is short
// and contained inside the dial's own collar.
//
// Placed below the total rather than behind it: the dial is a form with a centre of its own, and two
// centres competing on one axis is what makes a field look busy. This is where a coin puts a mint
// mark or a secondary device.
//
// Sized and placed against two hard edges: the total's baseline above it, and the guilloche's inner
// boundary below. A first cut sat at r 27 / cy 272 with 24 graduations and a 4px index wedge — at the
// ~48px this occupies on a phone, that much detail collapsed into a smudge, and the wedge landed
// under the figure's descenders. Fewer, heavier marks and a little more room in both directions.
const DIAL_CX = 200;
const DIAL_CY = 286;
const DIAL_R = 28;

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
      style={{ fontFamily: 'var(--font-mono)', fontSize: `${LEGEND_SIZE}px`, fontWeight: 700 }}
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

    {/* ── The guilloche ── */}
    {GUILLOCHE.map(({ n, R, rho, op, w }, gi) => (
      <g key={gi} opacity={op}>
        {Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2;
          const c = polar(R, a);
          return <circle key={i} cx={f(c.x)} cy={f(c.y)} r={rho} fill="none" stroke="var(--relief-line)" strokeWidth={w} />;
        })}
      </g>
    ))}
    {/* The two circles that bound the weave. Without them the interlace frays into the field instead
        of sitting in a band. */}
    <circle cx={C} cy={C} r={GUILLOCHE_IN} fill="none" stroke="var(--relief-line)" strokeWidth="1" opacity="0.24" />
    <circle cx={C} cy={C} r={GUILLOCHE_OUT} fill="none" stroke="var(--relief-line)" strokeWidth="1" opacity="0.28" />

    {/* ── The vault dial ── */}
    <g>
      {/* Graduated collar: the ring the index is read against. Ticks are the only radii in the
          drawing, and they live entirely inside this collar. */}
      <circle cx={DIAL_CX} cy={DIAL_CY} r={DIAL_R} fill="none" stroke="var(--relief-line)" strokeWidth="1.3" opacity="0.6" />
      <circle cx={DIAL_CX} cy={DIAL_CY} r={f(DIAL_R * 0.84)} fill="none" stroke="var(--relief-edge)" strokeWidth="0.8" opacity="0.4" />
      <g opacity="0.55">
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          const major = i % 4 === 0;
          const r1 = DIAL_R * 0.84;
          const r2 = DIAL_R * (major ? 1 : 0.94);
          return (
            <line
              key={i}
              x1={f(DIAL_CX + r1 * Math.cos(a))} y1={f(DIAL_CY + r1 * Math.sin(a))}
              x2={f(DIAL_CX + r2 * Math.cos(a))} y2={f(DIAL_CY + r2 * Math.sin(a))}
              stroke="var(--relief-line)" strokeWidth={major ? 1.6 : 1}
            />
          );
        })}
      </g>

      {/* The knob: a domed disc with its own lit and shadowed edge, so it stands proud of the collar
          rather than sitting flush in it. */}
      <g filter={`url(#${SP}-cast-tight)`}>
        <circle cx={DIAL_CX} cy={DIAL_CY} r={f(DIAL_R * 0.78)} fill={`url(#${SP}-dome)`} stroke="var(--relief-edge)" strokeWidth="1" opacity="0.9" />
      </g>

      {/* Gripping spokes, on the diagonals: on the axes they would read as a crosshair, and a
          crosshair is a sight, not a handle. */}
      <g opacity="0.62">
        {[0.25, 0.75, 1.25, 1.75].map(k => {
          const a = Math.PI * k;
          const r1 = DIAL_R * 0.26;
          const r2 = DIAL_R * 0.68;
          return (
            <line
              key={k}
              x1={f(DIAL_CX + r1 * Math.cos(a))} y1={f(DIAL_CY + r1 * Math.sin(a))}
              x2={f(DIAL_CX + r2 * Math.cos(a))} y2={f(DIAL_CY + r2 * Math.sin(a))}
              stroke="var(--relief-line)" strokeWidth="2.8" strokeLinecap="round"
            />
          );
        })}
      </g>

      {/* Hub and spindle. */}
      <circle cx={DIAL_CX} cy={DIAL_CY} r={f(DIAL_R * 0.24)} fill="var(--relief-mid)" stroke="var(--relief-line)" strokeWidth="1.1" opacity="0.75" />
      <circle cx={DIAL_CX} cy={DIAL_CY} r={f(DIAL_R * 0.1)} fill="var(--relief-line)" opacity="0.5" />

      {/* The index: a wedge above the collar, pointing at the graduation it reads. It is what makes
          the whole thing a dial you turn rather than a wheel you look at. */}
      <path
        d={`M ${DIAL_CX} ${f(DIAL_CY - DIAL_R - 2)} L ${f(DIAL_CX - 6)} ${f(DIAL_CY - DIAL_R - 13)} L ${f(DIAL_CX + 6)} ${f(DIAL_CY - DIAL_R - 13)} Z`}
        fill="var(--relief-line)" opacity="0.6"
      />
    </g>

    {/* Four pellets on the diagonals, just inside the bead, where a coin's design is usually
        punctuated — clear of the figure, and clear of the legend. */}
    {[0.25, 0.75, 1.25, 1.75].map(k => {
      const p = polar(FIELD - 12, Math.PI * k);
      return <circle key={k} cx={f(p.x)} cy={f(p.y)} r="2.6" fill="var(--relief-line)" opacity="0.4" />;
    })}
  </ReliefSvg>
);
