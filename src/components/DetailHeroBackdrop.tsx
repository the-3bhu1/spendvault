// The hero panel at the top of the two account detail screens.
//
// SUBJECT: a wax seal on its ribbon, over the ruled ground of a certificate. Every other backdrop in
// this app names what its screen is about — the vault door says "your wealth", the candlestick
// colonnade says the market, the treasury facade says cash, the wreath and hourglass say retirement —
// and a detail screen is about ONE named holding, examined on its own. What says that is an
// instrument: the certificate for this single thing, sealed. The account's own logo is the device
// impressed in the wax, which is the point of the composition and the reason this drawing suits this
// screen and no other: it is the only motif here that the account's own mark completes.
//
// It replaces an earlier attempt at engine-turned guilloché. That failed for a reason worth keeping
// in mind before adding to this file: guilloché is a PATTERN, not an object, so however financial the
// idea, there was nothing on screen to recognise. Texture cannot carry meaning the way an object can.
// What survives of it is the faint ruled print in the panel's upper half, which is now doing the job
// it is actually suited to — being the paper.
//
// Same idiom as the rest: inline SVG (crisp at any density, no network request or bundled binary,
// tones from CSS custom properties so one drawing serves both themes), relief built from filled bodies
// with gradients across them, paired lit/shadow edges, and feDropShadow on what stands proud — all
// lit from the top-left. Break the shared light direction and the whole thing flattens out.
//
// COMPOSITION — read before editing, because the panel is drawn in TWO pieces on purpose:
//
//   DetailHeroBand  the panel and the ribbon. Full-bleed, so its width is whatever the screen is and
//                   its aspect ratio is not knowable here. Drawn with preserveAspectRatio="none" —
//                   everything in it is a horizontal band or a horizontal rule, both of which stretch
//                   without giving anything away, and stretching beats cropping a fixed-aspect drawing
//                   at an unpredictable seam.
//   DetailHeroSeal  the wax. Centred on the mark, so it CANNOT live in the stretchy box — a stretched
//                   seal is an oval, and one placed by proportion drifts off the logo as the screen
//                   widens. It is a fixed-size square, absolutely centred on its parent, and that
//                   parent must be a box the size of the avatar and nothing else.
//
// The seal is a full circle, unlike the half-motifs an earlier draft used, which means its lower half
// has to fit between the mark's centre and the panel's lower edge — it is drawn outside the panel's
// own clip, so anything larger would spill onto the page below. SEAL_FITS is that inequality.
import React from 'react';

// ── Layout contract, shared with the screens that mount this ────────────────────────────────────
export const DETAIL_HERO_BAND = 140;
// How far above the panel's lower edge the mark's centre sits. Also the room the seal's lower half and
// its cast shadow have to live in.
export const DETAIL_HERO_LOGO_INSET = 50;
export const DETAIL_HERO_AVATAR = 60;
// What the identity block pulls up by, so its first child — the mark — lands inside the panel.
export const DETAIL_HERO_LIFT = DETAIL_HERO_LOGO_INSET + DETAIL_HERO_AVATAR / 2;

const f = (v: number) => v.toFixed(2);

// ── The band: ruled ground and the ribbon ───────────────────────────────────────────────────────
// A tall viewBox for a short box: the vertical scale is fixed (BAND_VB units map to BAND px) while the
// horizontal one floats with the screen. Every y below is therefore a real position in the panel —
// 420 units is its lower edge — and every x is a fraction of however wide the phone is.
const BAND_VB = 420;
const BAND_W = 1200;
const unitPx = DETAIL_HERO_BAND / BAND_VB; // 0.333: three units to the pixel
const px = (n: number) => n / unitPx;

// Stroke widths are quoted in PIXELS and converted, never written as raw units. The two drawings in
// this file are scaled very differently — the band's 420 units span 140px, the seal's 400 span 104 —
// so a literal that reads as "hairline" in one is a sub-pixel smudge in the other, and the other
// backdrops in this app are drawn near 1:1 where a bare strokeWidth="1" happens to mean 1px. An
// earlier cut of this panel was nearly invisible for exactly that reason.
const bandStroke = (widthPx: number) => widthPx / unitPx;

// The ribbon runs at the mark's own centre height, so it passes behind the seal and comes out the
// other side — which is how a seal is fixed to a document.
const RIBBON_Y = BAND_VB - px(DETAIL_HERO_LOGO_INSET);
const RIBBON_HALF = px(15);
const RIBBON_UNDULATE = px(4.5); // a slack ribbon lies in a shallow curve, not flat
const RIBBON_WAVE = 900;
const RULE_Y = px(12); // the document's ruled border
const RULE_GAP = px(4);

// The ribbon is widest where it disappears behind the seal and tapers toward both ends: a band lying
// away from the eye, not a stripe. Drawn as ONE outline per edge rather than as a body with fold
// wedges laid over it — relief in this app is carried by strokes, because the fill tokens are nearly
// transparent by design, so a filled fold showed up as a hard-edged trapezoid floating on nothing
// while the ribbon it was supposed to be twisting stayed invisible. A silhouette that narrows does
// the same work with lines only.
const ribbonHalf = (x: number) => {
  const fromCentre = Math.abs(x - BAND_W / 2) / (BAND_W / 2);
  return RIBBON_HALF * (0.34 + 0.66 * Math.cos((Math.PI / 2) * fromCentre));
};

const ribbonY = (x: number, side: -1 | 1) =>
  RIBBON_Y + side * ribbonHalf(x) + RIBBON_UNDULATE * Math.sin((Math.PI * 2 * x) / RIBBON_WAVE);

const ribbonEdge = (side: -1 | 1) => {
  const pts: string[] = [];
  for (let x = 0; x <= BAND_W; x += 10) pts.push(`${x} ${ribbonY(x, side).toFixed(1)}`);
  return pts;
};

const RIBBON_TOP = ribbonEdge(-1);
const RIBBON_BOTTOM = ribbonEdge(1);
const RIBBON_BODY = `M ${RIBBON_TOP.join(' L ')} L ${[...RIBBON_BOTTOM].reverse().join(' L ')} Z`;

// Creases, where the ribbon turns. One stroke across the band each — the whole vocabulary of a folded
// ribbon in line art, and enough to stop the taper reading as a solid wedge.
const CREASES = [0.22, 0.78].map(t => {
  const x = BAND_W * t;
  const lean = BAND_W * 0.018; // a crease leans with the fold; a vertical one reads as a seam
  return `M ${f(x - lean)} ${f(ribbonY(x, -1))} L ${f(x + lean)} ${f(ribbonY(x, 1))}`;
});

// The certificate's ground print: a faint braid of interlaced curves in the panel's upper half. Kept
// deliberately light — it is the paper, not the subject.
const PRINT_Y = px(38);
const PRINT_AMP = px(12);
const PRINT_WAVE = 300;
const PRINT_STRANDS = 4;
const printStrand = (index: number, dir: 1 | -1) => {
  const phase = (Math.PI * 2 * index) / PRINT_STRANDS;
  const pts: string[] = [];
  for (let x = 0; x <= BAND_W; x += 10) {
    const y = PRINT_Y + PRINT_AMP * Math.sin(dir * ((Math.PI * 2 * x) / PRINT_WAVE) + phase);
    pts.push(`${x} ${y.toFixed(1)}`);
  }
  return `M ${pts.join(' L ')}`;
};
const PRINT = [
  ...Array.from({ length: PRINT_STRANDS }, (_, i) => ({ d: printStrand(i, 1), key: `p${i}` })),
  ...Array.from({ length: PRINT_STRANDS }, (_, i) => ({ d: printStrand(i, -1), key: `q${i}` })),
];

export const DetailHeroBand: React.FC = () => (
  <div
    className="detail-hero-bleed"
    style={{
      position: 'relative',
      height: `${DETAIL_HERO_BAND}px`,
      // The panel is a surface, not a drawing on the page: the tonal step is what makes the seal read
      // as sitting ON something. Resolves to a lift in the dark theme and a tint in the light one,
      // from the same two tokens.
      background: 'linear-gradient(180deg, var(--bg-card) 0%, var(--bg-hover) 100%)',
      borderBottom: '1px solid var(--border-color)',
      overflow: 'hidden',
      pointerEvents: 'none',
    }}
  >
    <svg
      viewBox={`0 0 ${BAND_W} ${BAND_VB}`}
      preserveAspectRatio="none" // see COMPOSITION
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      <defs>
        {/* Across-the-ribbon shading, lit from above: the face of a flat band catching light along
            its upper edge and falling into shadow at its lower one. */}
        <linearGradient id="dhb-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--relief-hi)" />
          <stop offset="55%" stopColor="var(--relief-mid)" />
          <stop offset="100%" stopColor="var(--relief-lo)" />
        </linearGradient>
        {/* The underside, seen through a twist: the same band with the light on the wrong side. */}
        <linearGradient id="dhb-under" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--relief-lo)" />
          <stop offset="70%" stopColor="var(--relief-mid)" />
          <stop offset="100%" stopColor="var(--relief-hi)" />
        </linearGradient>
        <filter id="dhb-cast" x="-20%" y="-60%" width="140%" height="220%">
          <feDropShadow dx="0" dy={bandStroke(1.6)} stdDeviation={bandStroke(1.4)} floodColor="var(--relief-shadow)" />
        </filter>

        {/* Everything fades toward both ends rather than being cut off by the screen edge — a ribbon
            runs off the paper, but a stroke ending mid-air at a hard edge just looks clipped. */}
        <linearGradient id="dhb-ends" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="12%" stopColor="#fff" stopOpacity="1" />
          <stop offset="88%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="dhb-ends-mask">
          <rect width={BAND_W} height={BAND_VB} fill="url(#dhb-ends)" />
        </mask>
      </defs>

      <g mask="url(#dhb-ends-mask)">
        {/* ── Ruled border ── */}
        <g stroke="var(--relief-line)" fill="none">
          <line x1="0" y1={RULE_Y} x2={BAND_W} y2={RULE_Y} strokeWidth={bandStroke(1.3)} />
          <line x1="0" y1={RULE_Y + RULE_GAP} x2={BAND_W} y2={RULE_Y + RULE_GAP} strokeWidth={bandStroke(0.8)} opacity="0.7" />
        </g>

        {/* ── The paper's print, behind everything ── */}
        <g fill="none" opacity="0.5">
          {PRINT.map(s => (
            <path key={s.key} d={s.d} stroke="var(--relief-line)" strokeWidth={bandStroke(0.8)} />
          ))}
        </g>

        {/* ── The ribbon ── */}
        <g filter="url(#dhb-cast)">
          <path d={RIBBON_BODY} fill="url(#dhb-face)" />
        </g>
        {/* Paired edges: the lit one along the top of the band, the shadowed one under its lower edge.
            These two curves ARE the ribbon — everything else about it is shading. */}
        <path d={`M ${RIBBON_TOP.join(' L ')}`} fill="none" stroke="var(--relief-edge)" strokeWidth={bandStroke(1.2)} />
        <path d={`M ${RIBBON_BOTTOM.join(' L ')}`} fill="none" stroke="var(--relief-line)" strokeWidth={bandStroke(1.4)} />

        {CREASES.map((d, i) => (
          <path key={`dhb-crease-${i}`} d={d} fill="none" stroke="var(--relief-line)" strokeWidth={bandStroke(1)} opacity="0.8" />
        ))}
      </g>
    </svg>
  </div>
);

// ── The seal ────────────────────────────────────────────────────────────────────────────────────
const VB = 400;
const C = VB / 2;
// Big enough for the wax and the shadow it casts, and no bigger: this box is centred on a 60px mark,
// and every extra pixel of it is a pixel closer to the panel's edge.
export const DETAIL_HERO_SEAL = 104;
const SEAL_UNIT = VB / DETAIL_HERO_SEAL; // 3.85 units per px
const sealStroke = (widthPx: number) => widthPx * SEAL_UNIT;

const R_DEVICE = (DETAIL_HERO_AVATAR / 2) * SEAL_UNIT; // where the mark's edge falls
/* The wax closes UNDER the mark, not up to it. The mark is drawn over this svg (see
   renderSealedMark), so half a pixel of overlap costs nothing and removes the seam: a hole that
   stops at the mark's edge leaves two antialiased curves averaging against the panel between them,
   and that hairline of background is what read as the seal sitting off its logo. */
const R_WAX_IN = R_DEVICE - sealStroke(0.5);
/* Where the die pressed the wax down — UNDER the mark, not around it. Drawn outside it, even at a
   hair's width, this dark ring is itself the "thin gap": against a saturated logo any dark band
   hugging the edge reads as space between the two, whatever it was meant to depict. The impression
   now comes from the lip a little further out, and what actually touches the mark is wax. */
const R_PRESS = R_DEVICE - sealStroke(0.6);
const R_WAX_OUT = R_DEVICE + sealStroke(11);
// Same weight as the scalloped rim, so the seal's two circular edges are one family: the mark is
// held by a line of the same grey and thickness that draws the outside of the wax.
const RIM_HUG = sealStroke(1.2);
// Pinned to the band the dots always sat in, so tucking the inner edge under the mark doesn't drag
// the legend course inward with it.
const R_DOTS = (R_DEVICE + sealStroke(1) + R_WAX_OUT) / 2;
const SCALLOPS = 18;
const SCALLOP_BULGE = 0.62; // >0.5 of the chord, which is what makes each arc bow outward

// The inequality COMPOSITION depends on: the seal's ink, plus the shadow it throws, must fit between
// the mark's centre and the panel's lower edge. Named so that a change to any of the numbers it draws
// on surfaces here rather than as wax spilling onto the account name.
export const SEAL_FITS =
  (R_WAX_OUT + sealStroke(3)) / SEAL_UNIT <= DETAIL_HERO_LOGO_INSET;

const polar = (r: number, a: number) => ({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });

// A full circle as a path, so it can be the hole in an even-odd fill.
const circlePath = (r: number) =>
  `M ${C - r} ${C} A ${r} ${r} 0 1 0 ${C + r} ${C} A ${r} ${r} 0 1 0 ${C - r} ${C} Z`;

// The crimped edge of a blob of wax: n arcs bowing outward between points on a circle. This is what
// distinguishes a seal from a coin — a struck coin has a milled edge, poured wax has a scalloped one.
const scallopedRim = (r: number, n: number) => {
  const chord = 2 * r * Math.sin(Math.PI / n);
  const s = chord * SCALLOP_BULGE;
  const pts = Array.from({ length: n }, (_, i) => polar(r, (Math.PI * 2 * i) / n));
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    d += ` A ${f(s)} ${f(s)} 0 0 1 ${f(p.x)} ${f(p.y)}`;
  }
  return `${d} Z`;
};

const RIM = scallopedRim(R_WAX_OUT, SCALLOPS);

export const DetailHeroSeal: React.FC = () => (
  <svg
    viewBox={`0 0 ${VB} ${VB}`}
    aria-hidden="true"
    focusable="false"
    style={{
      position: 'absolute',
      // Centred on the parent, which must be the avatar's own box — see COMPOSITION.
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: `${DETAIL_HERO_SEAL}px`,
      height: `${DETAIL_HERO_SEAL}px`,
      pointerEvents: 'none',
    }}
  >
    <defs>
      {/* Offset focal point, so the wax reads as a domed blob rather than a flat washer. */}
      <radialGradient id="dhs-wax" cx="38%" cy="34%" r="70%">
        <stop offset="0%" stopColor="var(--relief-hi)" />
        <stop offset="58%" stopColor="var(--relief-mid)" />
        <stop offset="100%" stopColor="var(--relief-lo)" />
      </radialGradient>
      <filter id="dhs-cast" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx={sealStroke(0.8)} dy={sealStroke(1.4)} stdDeviation={sealStroke(1.2)} floodColor="var(--relief-shadow)" />
      </filter>
    </defs>

    {/* ── The wax: a scalloped blob with the device pressed out of its middle ── */}
    <g filter="url(#dhs-cast)">
      <path d={`${RIM} ${circlePath(R_WAX_IN)}`} fillRule="evenodd" fill="url(#dhs-wax)" />
    </g>

    {/* Paired edges. The rim catches the light; the ring immediately inside it is where the die
        pressed the wax down, so it is drawn as shadow — that step is what makes the mark look
        impressed INTO the seal rather than laid on top of it. */}
    <path d={RIM} fill="none" stroke="var(--relief-edge)" strokeWidth={sealStroke(1.2)} />
    <circle cx={C} cy={C} r={R_PRESS} fill="none" stroke="var(--relief-shadow)" strokeWidth={sealStroke(1.2)} opacity="0.55" />
    {/* The wax's inner rim, gripping the mark. Positioned by its INNER edge, not its centre: a
        stroke is drawn half either side of its radius, so centring it on the mark's circumference
        would bury half of it and offsetting it outward would fence a band of wax between ring and
        logo — which is exactly what read as a gap. Sitting the inner edge on R_DEVICE puts the
        whole width outside the mark, touching it. */}
    <circle
      cx={C}
      cy={C}
      r={R_DEVICE + RIM_HUG / 2}
      fill="none"
      /* The motif's own line: same token, same width and same full strength as the scalloped rim
         below, so this reads as part of the seal rather than as a shadow or a highlight of its own.
         The earlier 0.6 opacity is what made it a washed-out version of that line instead of it. */
      stroke="var(--relief-edge)"
      strokeWidth={RIM_HUG}
    />

    {/* Legend course: the ring of dots a seal's die leaves between its rim and its device. */}
    {Array.from({ length: 28 }, (_, i) => {
      const q = polar(R_DOTS, (Math.PI * 2 * i) / 28);
      return (
        <circle
          key={`dhs-dot-${i}`}
          cx={f(q.x)}
          cy={f(q.y)}
          r={sealStroke(1.1)}
          fill="var(--relief-hi)"
          stroke="var(--relief-line)"
          strokeWidth={sealStroke(0.4)}
        />
      );
    })}
  </svg>
);
