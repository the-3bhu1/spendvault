// Decorative bas-relief backdrop for the Wealth hero — the shaded engraving behind the avatar and total.
//
// It's an inline SVG, not an image asset, for three reasons: it stays crisp at any density (this
// renders full-bleed on phones from 360px to tablet width), it costs no network request or bundled
// binary, and it takes its tones from CSS custom properties, so one drawing works in both themes —
// a white sheen on the dark theme, ink and cast shadow on the light one — with no second asset.
//
// Subject: a bank vault door standing in its archway. The hardware is the real kind — a spoked
// handwheel, locking bolts thrown into the frame, rivets around the rim and a graduated dial — not a
// train of meshing cogs, which reads as clockwork rather than as a vault.
//
// RELIEF: this is shaded, not line art. Depth comes from three stacked cues, all consistent with a
// single light source at the top-left:
//   1. filled annuli with radial gradients, so each arch course reads as a rounded moulding rather
//      than a flat band (a radial gradient centred on the arch is geometrically right here — its
//      stops run across the band's width, exactly how a torus catches light);
//   2. paired edge strokes — a lit line on the top-left of a form and a shadow line on its
//      bottom-right, which is what makes stonework look carved instead of outlined;
//   3. cast shadows via feDropShadow on the members that physically stand proud: keystone, imposts,
//      plinth and the door itself.
// Break the shared light direction and the whole thing flattens out.
//
// COMPOSITION: everything is concentric about the viewBox centre, and the viewBox is square. That's
// deliberate — the hero centres its content, so a square viewBox scaled with `meet` puts the drawing's
// centre exactly on the content's centre at any width. The avatar, label and total therefore land
// inside the arch, over the clear hub of the door, with the wheel radiating out behind them. Break the
// squareness or the centring and the content drifts off the hub.
import React from 'react';

const VB = 400; // square: see COMPOSITION above
const C = VB / 2; // 200 — centre of the arch, the door and the content alike

// ── Archway ─────────────────────────────────────────────────────────────────────────────────────
// A stepped archivolt: an outer moulding, then a voussoir course of radiating stone blocks, then the
// inner soffit.
// The arch springs from y = C, so its apex is at C - R_ARCH_MOULD. That MUST stay >= 0 or the top of
// the arch is silently cropped and only the side fragments render.
// Budget: R_ARCH_MOULD + PROJECTION must stay <= C (200), or the imposts and plinth are clipped by
// the viewBox edge.
const PROJECTION = 8; // how far the impost/plinth blocks step out past the moulding
const R_ARCH_MOULD = 186; // outer moulding course
const R_ARCH_OUT = 172; // voussoir course, outer edge
const R_ARCH_IN = 156; // …inner edge, i.e. the soffit
const VOUSSOIRS = 19; // radial joints across the 180° span

// ── Door ────────────────────────────────────────────────────────────────────────────────────────
const R_BOLT_TIP = 132; // locking bolts thrown outward, into the frame
const R_RIM = 120;
const R_RIM_IN = 112;
const R_RIVETS = 116; // bolt-heads sit between the two rim lines
const R_DIAL_OUT = 104;
const R_DIAL_IN = 96;
const R_HUB = 44; // kept clear: the total sits here, so no linework inside it
const R_SPOKE_OUT = 88;
const SPOKES = 5;

// Radius over which the relief is muted so the hero text stays legible (see the wb-clear gradient).
// Stops just short of the soffit, so the archway itself is never touched.
const R_CLEAR = 150;

const polar = (r: number, angle: number) => ({
  x: C + r * Math.cos(angle),
  y: C + r * Math.sin(angle),
});

// Upper-half arc, drawn left→right over the top of the centre.
const archArc = (r: number) => `M ${C - r} ${C} A ${r} ${r} 0 0 1 ${C + r} ${C}`;

// Fillable half-annulus: out along the top of rOut, down to rIn, back under. Gives each arch course
// a body to shade, which a stroked arc has no way to provide.
const archBand = (rIn: number, rOut: number) =>
  `M ${C - rOut} ${C} A ${rOut} ${rOut} 0 0 1 ${C + rOut} ${C} ` +
  `L ${C + rIn} ${C} A ${rIn} ${rIn} 0 0 0 ${C - rIn} ${C} Z`;

// Masonry joints between the voussoirs, each a radial line across the arch band.
const JOINTS = Array.from({ length: VOUSSOIRS + 1 }, (_, i) => {
  const a = Math.PI + (Math.PI * i) / VOUSSOIRS;
  return { from: polar(R_ARCH_IN, a), to: polar(R_ARCH_OUT, a) };
});

// Rivets around the door rim. Each gets a lit cap and a shadowed underside, so it sits proud.
const RIVETS = Array.from({ length: 24 }, (_, i) => polar(R_RIVETS, (Math.PI * 2 * i) / 24));

// Dial graduations on the door face — the combination ring.
const GRADUATIONS = Array.from({ length: 48 }, (_, i) => {
  const a = (Math.PI * 2 * i) / 48;
  return { from: polar(R_DIAL_IN, a), to: polar(R_DIAL_OUT, a) };
});

// The bolts a vault throws into its frame when locked: stubby radial shafts past the rim.
const BOLTS = Array.from({ length: 8 }, (_, i) => {
  const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
  return { from: polar(R_RIM, a), to: polar(R_BOLT_TIP, a) };
});

// Handwheel: each spoke is a tapered quad (wide at the hub, narrow at the rim) so it can be filled
// and shaded as a cast limb, with a lit edge down one side.
const WHEEL = Array.from({ length: SPOKES }, (_, i) => {
  const a = (Math.PI * 2 * i) / SPOKES - Math.PI / 2; // one spoke straight up
  const spread = 0.075; // angular half-width at the hub
  const taper = 0.028; // …narrowing toward the rim
  const p1 = polar(R_HUB, a - spread);
  const p2 = polar(R_SPOKE_OUT, a - taper);
  const p3 = polar(R_SPOKE_OUT, a + taper);
  const p4 = polar(R_HUB, a + spread);
  const f = (v: number) => v.toFixed(2);
  return {
    body: `M ${f(p1.x)} ${f(p1.y)} L ${f(p2.x)} ${f(p2.y)} L ${f(p3.x)} ${f(p3.y)} L ${f(p4.x)} ${f(p4.y)} Z`,
    litEdge: `M ${f(p1.x)} ${f(p1.y)} L ${f(p2.x)} ${f(p2.y)}`,
    grip: polar(R_SPOKE_OUT, a),
  };
});

export const WealthBackdrop: React.FC = () => (
  <svg
    viewBox={`0 0 ${VB} ${VB}`}
    // 'meet', not 'slice': the whole drawing has to be visible, so it scales to fit the hero box and
    // letterboxes rather than filling the box and cropping the arch away.
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
    focusable="false"
    style={{
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    }}
  >
    <defs>
      {/* Across-the-band shading for the mouldings: dark at the inner edge, lit through the middle,
          falling off at the outer edge — a torus catching light from above. Stops are fractions of
          R_ARCH_MOULD, so they track the radii if those change. */}
      <radialGradient id="wb-mould" cx="50%" cy="50%" r="50%">
        <stop offset={`${(R_ARCH_OUT / R_ARCH_MOULD) * 100}%`} stopColor="var(--relief-lo)" />
        <stop offset={`${((R_ARCH_OUT + 6) / R_ARCH_MOULD) * 100}%`} stopColor="var(--relief-hi)" />
        <stop offset="100%" stopColor="var(--relief-lo)" />
      </radialGradient>

      {/* The voussoir course is the deepest member, so it stays darker overall with only a soft
          gleam near its outer edge. */}
      <radialGradient id="wb-voussoir" cx="50%" cy="50%" r="50%">
        <stop offset={`${(R_ARCH_IN / R_ARCH_OUT) * 100}%`} stopColor="var(--relief-lo)" />
        <stop offset={`${((R_ARCH_IN + 11) / R_ARCH_OUT) * 100}%`} stopColor="var(--relief-mid)" />
        <stop offset="100%" stopColor="var(--relief-lo)" />
      </radialGradient>

      {/* Steel door: brightest up-left of centre, falling to shadow bottom-right — the offset focal
          point is what turns a flat disc into a domed one. */}
      <radialGradient id="wb-door" cx="38%" cy="34%" r="72%">
        <stop offset="0%" stopColor="var(--relief-hi)" />
        <stop offset="62%" stopColor="var(--relief-mid)" />
        <stop offset="100%" stopColor="var(--relief-lo)" />
      </radialGradient>

      {/* Vertical shading for the piers, lit face to the left. */}
      <linearGradient id="wb-pier" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--relief-hi)" />
        <stop offset="55%" stopColor="var(--relief-mid)" />
        <stop offset="100%" stopColor="var(--relief-lo)" />
      </linearGradient>

      {/* Cast shadow for members standing proud of the wall. Two strengths: a tight one for small
          hardware, a longer one for the door and the blocks. */}
      <filter id="wb-cast" x="-30%" y="-30%" width="180%" height="180%">
        <feDropShadow dx="2.5" dy="3.5" stdDeviation="3" floodColor="var(--relief-shadow)" />
      </filter>
      <filter id="wb-cast-tight" x="-50%" y="-50%" width="220%" height="220%">
        <feDropShadow dx="1" dy="1.4" stdDeviation="1.1" floodColor="var(--relief-shadow)" />
      </filter>

      {/* Fades the relief out at the very bottom so it doesn't butt up hard against the cards. */}
      <linearGradient id="wb-fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fff" stopOpacity="1" />
        <stop offset="80%" stopColor="#fff" stopOpacity="1" />
        <stop offset="100%" stopColor="#fff" stopOpacity="0.12" />
      </linearGradient>

      {/* Legibility well. The hero's text sits dead centre, right over the busiest part of the
          drawing — hub, spokes, dial ring — so the mask is dimmed there and ramps back to full
          strength by R_CLEAR. Black in a luminance mask means "hide", so higher stopOpacity = more
          muting; the centre keeps ~18% of the relief, enough to still read as texture behind the
          numbers without competing with them. Done in the mask rather than by lowering the tokens so
          the arch, bolts and rim — none of which sit under text — stay at full contrast. */}
      <radialGradient id="wb-clear" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#000" stopOpacity="0.82" />
        <stop offset="40%" stopColor="#000" stopOpacity="0.72" />
        <stop offset="72%" stopColor="#000" stopOpacity="0.34" />
        <stop offset="100%" stopColor="#000" stopOpacity="0" />
      </radialGradient>

      <mask id="wb-mask">
        <rect width={VB} height={VB} fill="url(#wb-fade)" />
        <circle cx={C} cy={C} r={R_CLEAR} fill="url(#wb-clear)" />
      </mask>
    </defs>

    <g mask="url(#wb-mask)" strokeLinecap="round">
      {/* ── Piers, shaded as round columns and casting to the right ── */}
      <g filter="url(#wb-cast)">
      {[-1, 1].map(side => (
        <g key={`pier-${side}`}>
          <rect
            x={side < 0 ? C - R_ARCH_MOULD : C + R_ARCH_IN}
            y={C}
            width={R_ARCH_MOULD - R_ARCH_IN}
            height={VB - C}
            fill="url(#wb-pier)"
          />
          <line x1={C + side * R_ARCH_MOULD} y1={C} x2={C + side * R_ARCH_MOULD} y2={VB} stroke="var(--relief-line)" strokeWidth="1.3" />
          <line x1={C + side * R_ARCH_OUT} y1={C} x2={C + side * R_ARCH_OUT} y2={VB} stroke="var(--relief-line)" strokeWidth="0.8" />
          <line x1={C + side * R_ARCH_IN} y1={C} x2={C + side * R_ARCH_IN} y2={VB} stroke="var(--relief-line)" />
        </g>
      ))}
      </g>

      {/* ── Arch courses: filled and shaded, then engraved ── */}
      <g filter="url(#wb-cast)">
        <path d={archBand(R_ARCH_OUT, R_ARCH_MOULD)} fill="url(#wb-mould)" />
        <path d={archBand(R_ARCH_IN, R_ARCH_OUT)} fill="url(#wb-voussoir)" />
      </g>

      {/* Lit outer edge, shadowed inner edge: the pairing is what carves the moulding. */}
      <path d={archArc(R_ARCH_MOULD)} fill="none" stroke="var(--relief-edge)" strokeWidth="1.4" />
      <path d={archArc(R_ARCH_MOULD - 2)} fill="none" stroke="var(--relief-shadow)" strokeWidth="0.8" opacity="0.5" />
      <path d={archArc(R_ARCH_OUT)} fill="none" stroke="var(--relief-line)" />
      <path d={archArc(R_ARCH_IN)} fill="none" stroke="var(--relief-line)" />
      <path d={archArc(R_ARCH_IN - 2)} fill="none" stroke="var(--relief-shadow)" strokeWidth="1" opacity="0.45" />

      {/* Masonry joints, each shadowed on one side so the blocks read as separate stones */}
      {JOINTS.map((j, i) => (
        <g key={`joint-${i}`}>
          <line x1={j.from.x} y1={j.from.y} x2={j.to.x} y2={j.to.y} stroke="var(--relief-shadow)" strokeWidth="1.2" opacity="0.4" />
          <line x1={j.from.x + 1} y1={j.from.y} x2={j.to.x + 1} y2={j.to.y} stroke="var(--relief-line)" strokeWidth="0.6" />
        </g>
      ))}

      {/* ── Keystone: stands proud of both courses, so it casts ── */}
      <g filter="url(#wb-cast)">
        <path
          d={`M ${C - 17} ${C - R_ARCH_MOULD} L ${C + 17} ${C - R_ARCH_MOULD} L ${C + 12} ${C - R_ARCH_IN + 6} L ${C - 12} ${C - R_ARCH_IN + 6} Z`}
          fill="url(#wb-mould)"
          stroke="var(--relief-edge)"
          strokeWidth="1.1"
        />
      </g>

      {/* ── Impost blocks at the springing line ── */}
      <g filter="url(#wb-cast)">
      {[-1, 1].map(side => (
        <g key={`impost-${side}`}>
          <rect
            x={side < 0 ? C - (R_ARCH_MOULD + PROJECTION) : C + R_ARCH_IN}
            y={C}
            width={R_ARCH_MOULD + PROJECTION - R_ARCH_IN}
            height={13}
            fill="url(#wb-pier)"
            stroke="var(--relief-edge)"
            strokeWidth="1.1"
          />
        </g>
      ))}
      </g>

      {/* ── Plinth the piers stand on ── */}
      <g filter="url(#wb-cast)">
      {[-1, 1].map(side => (
        <g key={`plinth-${side}`}>
          <rect
            x={side < 0 ? C - (R_ARCH_MOULD + PROJECTION) : C + R_ARCH_IN}
            y={VB - 34}
            width={R_ARCH_MOULD + PROJECTION - R_ARCH_IN}
            height={34}
            fill="url(#wb-pier)"
            stroke="var(--relief-line)"
            strokeWidth="1.1"
          />
        </g>
      ))}
      </g>

      {/* ── Locking bolts, thrown into the frame ── */}
      <g filter="url(#wb-cast-tight)">
        {BOLTS.map((b, i) => (
          <line key={`bolt-${i}`} x1={b.from.x} y1={b.from.y} x2={b.to.x} y2={b.to.y} stroke="var(--relief-edge)" strokeWidth="2.6" />
        ))}
      </g>

      {/* ── Door: a shaded steel disc casting onto the wall behind it ── */}
      <g filter="url(#wb-cast)">
        <circle cx={C} cy={C} r={R_RIM} fill="url(#wb-door)" stroke="var(--relief-edge)" strokeWidth="1.2" />
      </g>
      <circle cx={C} cy={C} r={R_RIM_IN} fill="none" stroke="var(--relief-line)" strokeWidth="0.85" />
      <circle cx={C} cy={C} r={R_RIM_IN - 2} fill="none" stroke="var(--relief-shadow)" strokeWidth="0.9" opacity="0.4" />

      {/* Rivets: lit cap over a tight cast shadow */}
      <g filter="url(#wb-cast-tight)">
        {RIVETS.map((p, i) => (
          <circle key={`rivet-${i}`} cx={p.x} cy={p.y} r="2.8" fill="var(--relief-hi)" stroke="var(--relief-edge)" strokeWidth="0.8" />
        ))}
      </g>

      {/* Dial ring: recessed, so it's bounded by shadow above and light below */}
      <circle cx={C} cy={C} r={R_DIAL_OUT} fill="none" stroke="var(--relief-shadow)" strokeWidth="1.1" opacity="0.45" />
      <circle cx={C} cy={C} r={R_DIAL_OUT - 1.5} fill="none" stroke="var(--relief-line)" strokeWidth="0.6" />
      <circle cx={C} cy={C} r={R_DIAL_IN} fill="none" stroke="var(--relief-line)" strokeWidth="0.6" />
      {GRADUATIONS.map((g, i) => (
        // Every fourth graduation is a major mark, as on a real combination ring.
        <line
          key={`grad-${i}`}
          x1={g.from.x}
          y1={g.from.y}
          x2={g.to.x}
          y2={g.to.y}
          stroke="var(--relief-line)"
          strokeWidth={i % 4 === 0 ? '1.2' : '0.5'}
        />
      ))}

      {/* ── Handwheel: filled limbs with a lit edge, casting onto the door face ── */}
      <g filter="url(#wb-cast-tight)">
        {WHEEL.map((s, i) => (
          <g key={`spoke-${i}`}>
            <path d={s.body} fill="url(#wb-door)" stroke="var(--relief-line)" strokeWidth="0.8" />
            <path d={s.litEdge} fill="none" stroke="var(--relief-edge)" strokeWidth="0.9" />
            <circle cx={s.grip.x} cy={s.grip.y} r="7" fill="url(#wb-door)" stroke="var(--relief-edge)" strokeWidth="1" />
          </g>
        ))}
        <circle cx={C} cy={C} r={R_HUB} fill="url(#wb-door)" stroke="var(--relief-edge)" strokeWidth="1.3" />
      </g>
    </g>
  </svg>
);

export default WealthBackdrop;
