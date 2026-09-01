// The Dashboard hero's engraving: a struck coin, engine-turned, with a vault dial as its device.
//
// Same relief language as the Wealth and Cards backdrops — see the COMPOSITION and RELIEF notes in
// relief.tsx. Three pieces:
//
//   THE LEGEND RING, from the app's own logo (public/logo.png), which is itself a coin: a ring of
//   repeating text around a field with a device struck in the middle. A rim carrying nothing but
//   milling is a wheel; a rim carrying engraved words is a coin, and it says whose. Set with
//   textLength across the full circumference so the ring closes exactly however the mono face
//   resolves, rather than on a guess about character widths.
//
//   THE GUILLOCHE, filling the annulus. Engine-turning is the interlace printed on banknotes, share
//   certificates and cheques, and it is built here the way a rose engine builds it — rings of
//   overlapping circles whose centres sit on a circle, several counts against each other to make the
//   weave. It replaced a field of plain concentric rings that read as a frame around nothing.
//
//   THE VAULT DIAL, struck at the centre, with the total across it. A safe's combination dial:
//   graduated collar, domed knob with gripping spokes, hub, and the index it is read against. The app
//   is called SpendVault and this is the part that says so.
//
// The dial is also where the drawing's one apparent contradiction resolves. An early draft radiated
// arcs across the whole field and read as a spoked wheel, which is why everything decorative since
// has been concentric — but a handwheel is SUPPOSED to be spoked. The same radii that were wrong as
// an abstract flourish are right as a mechanism, and what contains them is that every one is short
// and sits inside the dial's own collar.
//
// WHAT MOVED, and why the earlier arrangement was wrong. The dial first sat BELOW the total, on the
// argument that two centres competing on one axis makes a field look busy — and the guilloche was
// pushed out to r 116 to leave the dial somewhere to be. That solved the wrong problem twice over: it
// gave the coin two focal points instead of one, and it hollowed out the rosette to make room for the
// second. A coin's device is struck in the MIDDLE of its field and its denomination sits over it;
// the legend, the weave and the device are concentric about one point, which is also the point the
// hero centres its type on. So the dial is back at the centre, the weave runs back in to r 100, and
// the way the figure stays legible is the VEIL below rather than an empty disc.
//
// The composition is the coin's own — legend at the rim, weave in the annulus, device and
// denomination together in the field — which is why this is the one hero in the app whose motif sits
// in the middle. Cards and Wealth stack five or six elements down the same square and have to keep
// their centres clear (the long note in CardsBackdrops has that arithmetic). Here the hero carries
// two lines, so the field is free.
//
// NOT data-bound. None of it moves with the numbers: a drawing whose geometry did would invite being
// measured, and there is a real chart on the screen below for that.
import React from 'react';
import { ReliefSvg } from './relief';
import { VB, C, f, polar } from '../utils/reliefGeometry';

const SP = 'spb';

// ── The veil ─────────────────────────────────────────────────────────────────────────────────────
// How this drawing steps back behind the month's total. Every element's own opacity below was tuned
// against its neighbours — the bead against the rim, the majors against the minors — and those
// relationships are worth keeping, so the fade is applied over the whole group rather than by editing
// forty numbers.
//
// RADIAL, and the first attempt at this was a flat group opacity of 0.58, which was wrong in a way
// worth recording: the figure only sits over the MIDDLE of the coin, so a uniform fade paid for its
// legibility with the rim, the legend and the outer weave — none of which have any type over them.
// The strength now belongs to the radius. Full at the rim, and down to about half by the centre.
//
// It composes with the legibility well in relief.tsx, which is a separate, elliptical mute sized to
// the text block; the two multiply. The well alone was not enough because it is shared with the Wealth
// and Cards heroes and is tuned for motifs that keep their middles empty — this is the one drawing
// whose device is deliberately behind the type. The well handles the type; the veil handles the
// gradient from rim to centre.
//
// Offsets are fractions of r = 200, so 62% ≈ r 124 — just past the weave's inner edge, which is
// where the fade has to be fully out of the way.
//
// LIFTED, along with the well below. Between them the two mutes used to leave 8% of the engraving at
// the dead centre, which is not "quiet behind the type", it is gone — and the vault dial had to be
// drawn at twice the stroke weight of anything else on the coin just to survive it. The pair now
// keeps about 27% there. That is still firmly subordinate to a figure at full white, but it is a
// drawing you can see rather than one you can infer, which is the whole point of striking the device
// behind the denomination.
//
// The two changes are one change. Lifting the floor without widening the well would have made a
// bright pocket with a hard rim; widening without lifting would have spread a hole. Together they
// read as a halo — the fall-off happens AROUND the figure over r 90 or so, rather than in a tight
// well behind it.
const VEIL = [
  { at: '0%', keep: 0.72 },
  { at: '30%', keep: 0.78 },
  { at: '50%', keep: 0.92 },
  { at: '62%', keep: 1 },
];

// The well's own depth, overriding the shared default in relief.tsx (0.82 at the centre). See the
// note above: this is the other half of the halo.
const WELL = [
  { at: 0, hide: 0.62 },
  { at: 45, hide: 0.52 },
  { at: 78, hide: 0.24 },
  { at: 100, hide: 0 },
];

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

// A full circle as one path, starting at 12 o'clock and running clockwise, for text to flow along.
// Two half-arcs, because a single arc command cannot describe a closed circle. Clockwise is what
// puts the glyphs' feet toward the centre and their caps outward — the legend and the currency
// course below both read that way.
const circlePath = (r: number) =>
  `M ${C} ${C - r} ` +
  `A ${r} ${r} 0 1 1 ${C} ${C + r} ` +
  `A ${r} ${r} 0 1 1 ${C} ${C - r}`;

// ── The field ────────────────────────────────────────────────────────────────────────────────────
// The bead is the raised ring that bounds the design; the field is the struck surface inside it.
const BEAD = 166;
const FIELD = 162;

// ── The annulus: a milled weave, and a course of currencies ──────────────────────────────────────
// The band between the dial and the bead is split in two at r 122. Below the divider, engine-turning
// — rings of overlapping circles whose centres sit on a circle, several counts against each other to
// make the weave. Above it, the world's currency symbols set on a path, turning.
//
// The weave used to own the whole annulus at rho 24/15/10. It now owns a quarter of it at rho 9/8/6,
// which is what makes the two bands read as different KINDS of thing rather than as two sizes of the
// same thing: a fine milled ground, with lettering struck over it. On a coin that is the correct
// relationship — the field is textured, the legend is read.
//
// Shrinking the circles is what forces the counts UP, from 26/34/46 to 40/52/68. A ring only
// interlaces while its circles overlap, i.e. while 2·rho exceeds the centre spacing 2πR/n; at the old
// counts these smaller circles would sit clear of each other and the band would read as three rows of
// beads. Every row below satisfies it, the tightest with about 12% to spare.
//
// The band is bounded by arithmetic, not by taste: each ring reaches R ± rho, so the innermost
// (109 ± 9) floors the weave at r 100 — clearing the dial's collar and its index with a margin — and
// the outermost (116 ± 6) tops it out at exactly the divider, which is what makes r 122 an edge the
// weave stops at rather than a line drawn over the top of it.
const GUILLOCHE = [
  { n: 40, R: 109, rho: 9, op: 0.85, w: 0.7 },   // 100 → 118 · spacing 17.1
  { n: 52, R: 113, rho: 8, op: 0.9, w: 0.65 },   // 105 → 121 · spacing 13.7
  { n: 68, R: 116, rho: 6, op: 0.95, w: 0.6 },   // 110 → 122 · spacing 10.7
];
const GUILLOCHE_IN = 100;
const GUILLOCHE_OUT = 164;
// Where the weave stops and the course begins.
const COURSE_IN = 122;

// The currency course. Text on a path stands its caps OFF the path outward, so the baseline goes low
// enough in the band that the cap band is centred in it — the same correction the rim legend makes
// above, and for the same reason. At 30 units these are twice the size the first draft set them, and
// that size is the point: they are the band's subject now, not a texture in it.
const COURSE_SIZE = 30;
const COURSE_CAP = COURSE_SIZE * 0.72;
const COURSE_R = COURSE_IN + (GUILLOCHE_OUT - COURSE_IN - COURSE_CAP) / 2;

// NOT set in the mono face the rest of the drawing uses. Overpass Mono carries exactly four of these
// — $ € £ ¥ — and falls back for the other eight, THE RUPEE INCLUDED. At 15 units that was invisible;
// at 30 it is not.
const COURSE_FONT = "system-ui, 'Segoe UI', Roboto, 'Noto Sans', sans-serif";
const COURSE_SYMBOLS = ['₹', '$', '€', '£', '¥', '₩', '₽', '₺', '₦', '฿', '₪', '₱'];

// Each symbol placed at its own angle, rather than one string flowed along a path with textLength.
// The path version is how the rim legend is built and it was the obvious way to do this too, but it
// spaces a RING wrong, for a reason worth recording:
//
//   lengthAdjust="spacing" distributes the slack into the gaps BETWEEN characters. For n characters
//   there are n−1 such gaps — and going round a circle there is an nth gap, from the last character
//   back to the first, which gets none of it. Every junction on the ring was opened up by about 7
//   units except the one either side of the wrap, which stayed at its natural width. So the first
//   glyph — the rupee, and it had to be the rupee, it leads the set — sat hard against the pellet to
//   its left while every other symbol was centred between its own two.
//
// Placing each glyph at i · 30° cannot have that bug: the spacing is the construction, not a
// side-effect of fitting a string to a length. It also stops the fallback faces from mattering. On a
// path their advance widths feed into the same fit, so eight substituted glyphs pulled the tracking
// around unevenly; here every symbol is centred on its own angle whatever face draws it.
//
// rotate() about the coin's centre does the positioning AND the orientation in one transform: a glyph
// written at the top of the circle and swung round by a lands with its baseline tangent and its caps
// pointing outward, which is what text on a clockwise path does and what makes the symbols face the
// centre. The pellets take the half-steps between, at i · 30° + 15°.
const COURSE_STEP = 360 / COURSE_SYMBOLS.length;

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
// At the coin's own centre, under the total. Its strokes are still the heaviest in the drawing,
// because this is the only part standing under BOTH mutes at once and weight is what survives a mute
// that brightness does not.
//
// WALKED BACK, though — collar 1.8 → 1.2, majors 2.4 → 1.8, minors 1.5 → 1.1, spokes 3.8 → 2.8. The
// old weights were compensating for a well that hid 82% of the relief at the centre; the halo leaves
// 27%, and a compensation carried past the problem it was correcting for is just a heavy dial. The
// ratios are kept — majors still read as majors against the minors — so the mechanism reads the same,
// only at a weight that belongs next to the fine weave outside it rather than shouting over it.
//
// The radius is set from the type rather than from the
// field: the hero's figure runs to roughly 220 units wide at its largest step, so a collar at r 78
// is bracketed BY the digits rather than hidden behind them — the dial reads as a whole object with
// the denomination struck across it, which is what a coin does, instead of as a ring peeking out
// from behind a number.
const DIAL_CX = C;
const DIAL_CY = C;
const DIAL_R = 78;

export const SpendBackdrop: React.FC = () => (
  <>
  {/* The well is sized to the text block — month label and figure — rather than to the field. It has
      to mute the rings directly behind the type without flattening the ones that give the rest of the
      surface its texture.
      WIDENED from 112×64, which was the block "Aug '26" and the total occupy and nothing more. A well
      cut to the exact size of the type makes a pocket with a rim; the fall-off has to happen outside
      the figure to read as a halo around it, which is what the extra 20 across and 18 down buy. It
      pairs with the shallower WELL depth and the lifted VEIL above — see the note there; all three
      are one change and moving any of them alone undoes it.
      It stops well short of the weave either way: 132 against an inner edge at r 100 sounds like an
      overlap, but the well's own gradient is already down to a few percent by its rim. */}
  <ReliefSvg p={SP} wellRx={132} wellRy={82} well={WELL}>
    {/* The veil. A local mask, nested inside the one ReliefSvg already applies — the two multiply,
        which is exactly the wanted result: full-strength engraving at the rim, thinning toward the
        centre, and thinner still inside the ellipse where the type sits. */}
    <defs>
      <radialGradient id={`${SP}-veil`} cx="50%" cy="50%" r="50%">
        {VEIL.map(({ at, keep }) => (
          <stop key={at} offset={at} stopColor="#fff" stopOpacity={keep} />
        ))}
      </radialGradient>
      {/* The rect runs to the viewBox corners, past the gradient's r: the last stop extends, so the
          corners keep full strength rather than being cut away. */}
      <mask id={`${SP}-veil-mask`}>
        <rect width={VB} height={VB} fill={`url(#${SP}-veil)`} />
      </mask>
    </defs>
    <g mask={`url(#${SP}-veil-mask)`}>
      {/* ── Rim ── */}
      <g filter={`url(#${SP}-cast)`}>
        <circle cx={C} cy={C} r={RIM_OUT} fill="none" stroke="var(--relief-line)" strokeWidth="1.6" opacity="0.55" />
      </g>
      <circle cx={C} cy={C} r={RIM_IN} fill="none" stroke="var(--relief-edge)" strokeWidth="1" opacity="0.4" />

      {/* ── Legend ──
          textLength + lengthAdjust="spacing" force the repeated word to occupy the circle exactly, so
          the ring closes cleanly whatever the font resolves to. The tracking comes out of that fit
          rather than from a letter-spacing value, for the same reason. */}
      <path id={`${SP}-legend-path`} d={circlePath(LEGEND_R)} fill="none" />
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

      {/* ── Field: the domed surface and its bead ── */}
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
      {/* The three circles that bound the annulus. The outer two stop the band fraying into the field;
          the middle one at r 122 is the divider, and it is the line that makes this read as two
          courses rather than as one busy band. Lighter than the other two on purpose — it separates
          two parts of the same design, where they separate the design from what is outside it. */}
      <circle cx={C} cy={C} r={GUILLOCHE_IN} fill="none" stroke="var(--relief-line)" strokeWidth="1" opacity="0.8" />
      <circle cx={C} cy={C} r={COURSE_IN} fill="none" stroke="var(--relief-line)" strokeWidth="1" opacity="0.7" />
      <circle cx={C} cy={C} r={GUILLOCHE_OUT} fill="none" stroke="var(--relief-line)" strokeWidth="1" opacity="0.85" />

      {/* ── The vault dial ── */}
      <g>
        {/* Graduated collar: the ring the index is read against. Ticks are the only radii in the
            drawing, and they live entirely inside this collar. 24 of them, majors at the quarters —
            a safe's dial is finely divided, and at r 78 that many marks still resolve on a phone. */}
        <circle cx={DIAL_CX} cy={DIAL_CY} r={DIAL_R} fill="none" stroke="var(--relief-line)" strokeWidth="1.2" opacity="1" />
        <circle cx={DIAL_CX} cy={DIAL_CY} r={f(DIAL_R * 0.86)} fill="none" stroke="var(--relief-edge)" strokeWidth="0.9" opacity="0.8" />
        <g opacity="0.95">
          {Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * Math.PI * 2;
            const major = i % 6 === 0;
            const r1 = DIAL_R * 0.86;
            const r2 = DIAL_R * (major ? 1 : 0.95);
            return (
              <line
                key={i}
                x1={f(DIAL_CX + r1 * Math.cos(a))} y1={f(DIAL_CY + r1 * Math.sin(a))}
                x2={f(DIAL_CX + r2 * Math.cos(a))} y2={f(DIAL_CY + r2 * Math.sin(a))}
                stroke="var(--relief-line)" strokeWidth={major ? 1.8 : 1.1}
              />
            );
          })}
        </g>

        {/* The knob: a domed disc with its own lit edge, so it stands proud of the collar rather than
            sitting flush in it. This is the surface the total is struck on, so it is a smooth
            gradient and nothing else — the detail that makes it hardware is all at its rim. */}
        <g filter={`url(#${SP}-cast-tight)`}>
          <circle cx={DIAL_CX} cy={DIAL_CY} r={f(DIAL_R * 0.8)} fill={`url(#${SP}-dome)`} stroke="var(--relief-edge)" strokeWidth="1.2" opacity="1" />
        </g>

        {/* Gripping spokes, on the diagonals: on the axes they would read as a crosshair, and a
            crosshair is a sight, not a handle. The diagonals also keep them out from under the
            digits, which sit on the horizontal. */}
        <g opacity="0.9">
          {[0.25, 0.75, 1.25, 1.75].map(k => {
            const a = Math.PI * k;
            const r1 = DIAL_R * 0.3;
            const r2 = DIAL_R * 0.72;
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

        {/* Hub and spindle: what the spokes converge ON. Dropped in a first pass at putting the dial
            behind the type, on the theory that a filled disc under the digits would muddy them — but
            four radii ending in mid-air read as scratches, not as a handle, and this sits at the
            well's deepest point where it is the faintest form on the coin. */}
        <circle cx={DIAL_CX} cy={DIAL_CY} r={f(DIAL_R * 0.3)} fill="var(--relief-mid)" stroke="var(--relief-line)" strokeWidth="1.5" opacity="0.95" />
        <circle cx={DIAL_CX} cy={DIAL_CY} r={f(DIAL_R * 0.12)} fill="var(--relief-line)" opacity="0.7" />

        {/* The index: a wedge above the collar, pointing at the graduation it reads. It is what makes
            the whole thing a dial you turn rather than a wheel you look at. Above the collar and not
            on it, so it is clear of the month label as well as of the figure. */}
        <path
          d={`M ${DIAL_CX} ${f(DIAL_CY - DIAL_R - 3)} L ${f(DIAL_CX - 7)} ${f(DIAL_CY - DIAL_R - 14)} L ${f(DIAL_CX + 7)} ${f(DIAL_CY - DIAL_R - 14)} Z`}
          fill="var(--relief-line)" opacity="0.9"
        />
      </g>

      {/* Four pellets on the diagonals, just inside the bead, where a coin's design is usually
          punctuated — clear of the figure, and clear of the legend. */}
      {[0.25, 0.75, 1.25, 1.75].map(k => {
        const p = polar(FIELD - 12, Math.PI * k);
        return <circle key={k} cx={f(p.x)} cy={f(p.y)} r="2.6" fill="var(--relief-line)" opacity="0.4" />;
      })}
    </g>
  </ReliefSvg>

  {/* ── The currency course ──
      Stacked OVER the coin as its own element rather than drawn inside it, and the reason is
      measured rather than stylistic: at 140s a revolution this ring travels under a tenth of a pixel
      between frames at the hero's size. Re-rasterising the glyphs at that rate re-quantises their
      positions every frame, so they hold still and then step. Lifted out, the ring is rasterised
      once and the compositor interpolates the transform, which is continuous. The nesting — a still
      box carrying the fade, a spinning one inside it — is in index.css, along with why.

      What it gives up by leaving the coin's SVG is the well and the veil, and under the halo values
      above that is close to nothing: the well's ellipse is 132×82 and the course starts at r 122, so
      the two only meet in two slivers at 3 and 9 o'clock where the well is already down to a few
      percent, and the veil is at full strength from r 124 out. The bottom fade is the only part that
      genuinely had to be rebuilt, and the CSS gradient reproduces it. */}
  <div className="coin-course-fade" aria-hidden="true">
    <svg
      className="coin-course"
      viewBox={`0 0 ${VB} ${VB}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="var(--relief-line)" opacity="0.95" textAnchor="middle">
        {COURSE_SYMBOLS.map((sym, i) => (
          <text
            key={sym}
            x={C}
            y={f(C - COURSE_R)}
            transform={`rotate(${f(i * COURSE_STEP)} ${C} ${C})`}
            style={{ fontFamily: COURSE_FONT, fontSize: `${COURSE_SIZE}px`, fontWeight: 700 }}
          >
            {sym}
          </text>
        ))}
        {COURSE_SYMBOLS.map((_, i) => (
          <text
            key={`pellet-${i}`}
            x={C}
            y={f(C - COURSE_R)}
            transform={`rotate(${f(i * COURSE_STEP + COURSE_STEP / 2)} ${C} ${C})`}
            opacity="0.6"
            style={{ fontFamily: COURSE_FONT, fontSize: `${COURSE_SIZE}px`, fontWeight: 700 }}
          >
            ·
          </text>
        ))}
      </g>
    </svg>
  </div>
  </>
);
