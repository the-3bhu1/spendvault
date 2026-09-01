// The Credit Cards tree's engravings. Same relief language as the Wealth category backdrops — see
// the COMPOSITION and RELIEF notes in relief.tsx — with subjects of their own:
//
//   Cards      → a stack of four plates stepped up the frame, each carrying a chip.
//   My Cards   → a card held over a reader, mid-tap, the contactless mark cut between them.
//   Statements → continuous-feed stationery, folded and perforated: one panel per cycle.
//   Rewards    → coins and notes falling, tumbling, speed lines trailing up behind them.
//
// NO DRAWING IN THIS FILE CARRIES A COIN RIM ANY MORE, and the MilledRim helper went with the last
// one. Each of the four had the same fault in turn — a milled ring out in the margins, the subject
// squeezed into a strip at the foot, and a large empty circle in between — and each was redrawn to
// fill its frame instead. The rim was also the wrong borrowing: a coin's edge is the Dashboard's
// device (see SpendBackdrop), and these are screens about plastic. If a future motif here wants a
// ring it needs a reason of its own; don't restore this one from git.
//
// Why a card and not a coin or a vault: the Dashboard's hero is a coin (what you spent) and Wealth's
// is a vault door (what you own). A liability screen has to look like the plastic it tracks, or all
// three heroes read as the same drawing at a glance.
//
// WHERE THE DRAWING SITS is the hard part here, and two attempts got it wrong before this one.
//
// Measured in the running app, the Cards hero's content occupies viewBox y 41–359 of 400: avatar
// 41–109, label 126–145, total 157–205, billed/unbilled 222–265, the utilization bar 285–302, its
// "N% used" caption 312–325, due line 343–359. That is 80% of the drawing's height, and cannot be escaped
// by making the hero taller — 'meet' scales the square by min(width, height) and centres it, so the
// drawing and the content grow together and the content keeps the same share.
//
// The AVATAR's band is passable and the text bands are not. It is an opaque image, so an edge behind
// it is hidden across the middle and shows only in the empty margins either side — where there is
// nothing to collide with. The callout and the marker coin are opaque for the same reason. Treating
// those three as walls, rather than as the occluders they are, is what makes the arithmetic below
// look impossible when it isn't.
//
// The first answer was to keep out of the way entirely — a rim in the left and right margins, the
// plates in the bottom strip with only their top edges showing, nothing through the middle. That is
// what made this the odd hero out. Wealth's handwheel spokes cross behind its avatar and label, and
// the Dashboard's guilloche runs straight under its total; both motifs fill the square. Cards hugged
// the edges and left a hole, so its rim read as a circle with nothing to do with the two rectangles
// below it — which is exactly how it looked.
//
// The second answer, and the one below, is to cross the content the way the other two do and manage
// the crossing instead of avoiding it. What makes that safe is the TILT: a horizontal edge under a
// line of type parallels its baseline and reads as a rule or a strikethrough, while the same edge at
// 8° crosses it and reads as texture. Every plate edge here is therefore a diagonal, and the well
// mutes them to 40–70% where they pass behind the figures.
//
// Any future hero in this idiom still has to measure its own content the same way — the numbers
// above are this hero's, not a constant. The gaps BETWEEN those bands are the useful part: 157–169,
// 213–229, 269–285, 310–326, then 341 to the foot. An edge that has to be crisp goes in a gap.
import React from 'react';
import { ReliefSvg } from './relief';
import { VB, C, f } from '../utils/reliefGeometry';

// The corner radius every plate in this file shares. The 1.586:1 ISO/IEC 7810 ratio each one is cut
// to lives with the drawing that cuts it, since only the card-shaped members obey it — the terminal
// on My Cards is portrait and deliberately does not.
const CARD_R = 11;

/** Rounded-rect path for a plate at an arbitrary centre, with its own corner radius.
 *
 *  Off-centre is the point of it: every plate in this file used to sit on the vertical centre line,
 *  which the shared COMPOSITION contract assumes — but the My Cards tap is two objects with a
 *  direction between them, and a direction cannot be centred. See the note on that drawing. */
const plateAt = (w: number, h: number, cx: number, cy: number, r: number) =>
  `M ${f(cx - w / 2 + r)} ${f(cy - h / 2)} ` +
  `h ${f(w - r * 2)} a ${r} ${r} 0 0 1 ${r} ${r} ` +
  `v ${f(h - r * 2)} a ${r} ${r} 0 0 1 ${-r} ${r} ` +
  `h ${f(-(w - r * 2))} a ${r} ${r} 0 0 1 ${-r} ${-r} ` +
  `v ${f(-(h - r * 2))} a ${r} ${r} 0 0 1 ${r} ${-r} Z`;

/** Rounded-rect path for a card plate, centred horizontally on C. */
const plate = (w: number, h: number, cy: number) => plateAt(w, h, C, cy, CARD_R);

/** The EMV chip: a small plate with the contact pattern cut into it. */
const Chip: React.FC<{ p: string; x: number; y: number; w?: number }> = ({ p, x, y, w = 40 }) => {
  const h = w * 0.76;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g filter={`url(#${p}-cast-tight)`}>
      {/* Body damped per theme like the plates it sits on — see --relief-plate-fill in index.css.
          Undamped, the light theme's near-white fill washed out the due line running across it. The
          contact pattern below is stroked, so the chip still reads at full strength. */}
      <rect
        x={x} y={y} width={w} height={h} rx="4" fill={`url(#${p}-stone-v)`}
        style={{ fillOpacity: 'var(--relief-plate-fill)' }}
        stroke="var(--relief-edge)" strokeWidth="0.9" opacity="0.9"
      />
      {/* One horizontal bus with fingers off each side — the pattern actually printed on an EMV
          module, not a generic grid. */}
      <line x1={x + 4} y1={cy} x2={x + w - 4} y2={cy} stroke="var(--relief-line)" strokeWidth="1.1" opacity="0.75" />
      <line x1={cx} y1={y + 3.5} x2={cx} y2={y + h - 3.5} stroke="var(--relief-line)" strokeWidth="1.1" opacity="0.75" />
      {[0.3, 0.7].map(t => (
        <React.Fragment key={t}>
          <line x1={x + 4} y1={y + h * t} x2={cx - 5} y2={y + h * t} stroke="var(--relief-line)" strokeWidth="0.9" opacity="0.55" />
          <line x1={cx + 5} y1={y + h * t} x2={x + w - 4} y2={y + h * t} stroke="var(--relief-line)" strokeWidth="0.9" opacity="0.55" />
        </React.Fragment>
      ))}
    </g>
  );
};

// ── Cards home: the tilted stack ─────────────────────────────────────────────────────────────────
const CD = 'cdb';
// Plates all the SAME WIDTH. They used to be inset 18 and 36 units as they went back, which reads as
// a fan receding in perspective; cards held together are the same width and only the offset varies.
// Wider than the 250 the other drawings use, so the plates reach the left and right margins as well
// as the top and bottom ones.
const CD_W = 330;
const CD_H = Math.round(CD_W / 1.586); // 208

// FOUR plates, SQUARE TO THE FRAME, stepped 97. All three numbers are locked to each other by the
// gap map at the top of this file, and none of them is free.
//
// An earlier pass tilted the stack 8°, on the argument that a horizontal edge under a line of type
// parallels its baseline and reads as a rule while a diagonal reads as texture. That argument is
// sound, and it was buying something no longer needed: the tilt let the edges fall ANYWHERE, because
// a diagonal crossing the total is survivable. Upright, they cannot fall anywhere — so they fall in
// the gaps instead, which is the better answer to begin with. An edge that never touches a line of
// type needs no excuse for the angle it crosses it at.
//
// 307, 210, 113, 16. Every one lands in a gap: 302–312 (bar → caption), 205–222 (total → split),
// 109–126 (avatar → label), and clear above everything. That is what fixes the step at 97, and it is
// also what spans the square — the topmost edge sits 16 units off the top of the drawing, about where
// Wealth's archway crowns.
//
// THESE MOVE WHEN THE HERO'S CONTENT MOVES, and that is the trap in this file. They have been
// re-derived twice: once when the utilization meter became a bar with end labels and a callout, which
// was 30 units taller and pushed two edges into the label and the billed/unbilled row, and again when
// the callout came out and the bar lost its marker, which took 8 units back. A few units either way is
// enough, because the gaps this threads are as narrow as ten.
//
// So: re-measure before assuming this still holds. Changing CD_W, CD_STEP or CD_FRONT_EDGE moves all
// four edges — but so does adding a line of text to the hero, and that one gives no warning.
const CD_STEP = 97;
const CD_N = 4;
const CD_FRONT_EDGE = 307;
const CD_FRONT_CY = CD_FRONT_EDGE + CD_H / 2;
// A gentle falloff: with only four plates every one of them has to be plainly there, so the deepest
// still holds half its weight.
// How far below its own top edge each plate behind stops being drawn: it is hidden from there on by
// the plate in front, and the last CD_CUT_FADE units of that are a dissolve rather than a cut.
//
// This is the fix for the one thing the relief idiom gets wrong for free. Every fill here is a
// gradient of --relief-hi/mid/lo, which on the dark theme are white at 0.055, 0.028 and 0.008 alpha —
// a sheen, not a body. Four plates drawn that way do not occlude each other at all, so the bottom
// EDGE of each plate behind was being stroked straight across the face of the plate in front: two
// stray rules through the hero that no opaque object would ever show. Drawing order cannot fix it,
// because there is nothing solid to draw over. The plates have to be cut instead.
//
// An earlier pass also drifted each plate 7 units left of the one in front, to break the shared
// silhouette four identical upright rectangles make. That is gone — the plates are aligned, and the
// rounded top corner each one shows at the sides is what keeps the edge from reading as one line.
const CD_CUT_FADE = 26;
const CD_LAYERS = Array.from({ length: CD_N }, (_, i) => ({ i, o: 0.8 ** i }));

export const CardsBackdrop: React.FC = () => (
  // A tall well, widened a little now that plate faces sit behind the figures rather than only below
  // them. fade: full strength to y 344, then gone by 400 — a dissolve, not a dimmed cut, which is why
  // the front plate can run to 526 without being cut off.
  <ReliefSvg p={CD} wellRx={160} wellRy={196} fade={{ start: 0.86, floor: 0 }}>
    <defs>
      {/* Two shadows on every plate, and the FIRST one is the load-bearing half.

          The seam is ambient occlusion, not a cast shadow, and that is not a shortcut — it is the
          only cue available here. Every plate is the same width and sits directly over the next, so
          a shadow thrown by the shared top-left light falls down and to the right, where the plate
          in FRONT is already covering it: with this geometry a directional cast is invisible by
          construction. What a viewer would really see in the seam is the darkening of a crevice,
          which has no direction to be wrong about. Drawn soft and biased upward, into the crevice.

          It has to be BLURRED. The first attempt drew it as a hard line above each edge, and between
          that line and the plate's own lit stroke 2.5 below it, every seam came out as a thin rounded
          box — a stack of pills across the hero, which is what the group's strokeLinecap="round" does
          to any short heavy line here.

          The second is the ordinary lift, down and right, under the shared light. */}
      <filter id={`${CD}-plate`} x="-30%" y="-30%" width="180%" height="180%">
        <feDropShadow dx="0" dy="-4" stdDeviation="5.5" floodColor="var(--relief-shadow)" floodOpacity="0.75" />
        <feDropShadow dx="2.5" dy="4" stdDeviation="3.5" floodColor="var(--relief-shadow)" floodOpacity="0.5" />
      </filter>

      {/* One ramp, reused by every layer's cut. Gradients default to objectBoundingBox units, so it
          runs top-to-bottom of whichever rect fills itself with it, wherever that rect happens to be. */}
      <linearGradient id={`${CD}-cutfade`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fff" />
        <stop offset="100%" stopColor="#000" />
      </linearGradient>

      {/* The cut, one per plate behind. It has to be a MASK rather than a clip because the cut is a
          dissolve, and it has to be applied to the group rather than the path because the group is
          what carries the shadows. Both are safe: masking runs after filtering, so each plate's seam
          shadow is generated from its real geometry and only then trimmed — the cut edge casts
          nothing of its own, which it would if the shape were trimmed first.
          Starts 40 above the frame so the upward seam shadow is inside the mask and survives it. */}
      {CD_LAYERS.slice(1).map(({ i }) => {
        const cut = CD_FRONT_EDGE - (i - 1) * CD_STEP;
        return (
          <mask key={i} id={`${CD}-cut-${i}`} maskUnits="userSpaceOnUse" x="0" y="-40" width={VB} height={cut + 40}>
            <rect x="0" y="-40" width={VB} height={cut + 40 - CD_CUT_FADE} fill="#fff" />
            <rect x="0" y={cut - CD_CUT_FADE} width={VB} height={CD_CUT_FADE} fill={`url(#${CD}-cutfade)`} />
          </mask>
        );
      })}
    </defs>

    {/* Back plates first, so each is occluded by the one in front of it — their own fills are what
        hide the bodies, which is what makes this a stack and not a fan. */}
    {[...CD_LAYERS].reverse().map(({ i, o }) => {
      const edge = CD_FRONT_EDGE - i * CD_STEP;
      return (
        <g key={i} opacity={o} filter={`url(#${CD}-plate)`} mask={i > 0 ? `url(#${CD}-cut-${i})` : undefined}>
          <path
            d={plate(CD_W, CD_H, CD_FRONT_CY - i * CD_STEP)}
            fill={`url(#${CD}-stone-v)`}
            // Body damped per theme, strokes left alone — see --relief-plate-fill in index.css.
            // This is the only drawing that needs it: nothing else fills an area this large.
            style={{ fillOpacity: 'var(--relief-plate-fill)' }}
            stroke="var(--relief-edge)" strokeWidth="1.2"
          />

          {/* A chip on every plate, not just the front one. Each sits 36 below its own top edge, so
              each lands inside that plate's own 97 units of visible band. Far enough left (x 59–99)
              to clear the hero's centred type at every height — which is the whole reason it can be
              repeated four times without any of them landing on a figure. */}
          <Chip p={CD} x={C - CD_W / 2 + 24} y={edge + 36} w={40} />
        </g>
      );
    })}
  </ReliefSvg>
);

// ── My Cards: the tap ────────────────────────────────────────────────────────────────────────────
// A card held over a reader, mid-tap, with the contactless mark opening between them.
//
// WHY THIS AND NOT ANOTHER PLATE. The screen is the roster of cards you hold, one tap from
// everything the app knows about each — so the drawing is a card being USED, which is the one thing
// a stack of plates cannot depict. It also has to differ from the Cards root at a glance, and it
// does, on subject rather than on arrangement: the root is four plates stepped up a diagonal, this
// is a machine with a card over it.
//
// IT IS A SCENE, AND THAT IS A COST TAKEN DELIBERATELY. Every other motif in this app is one object
// rendered symmetric about the vertical centre line, which is what the COMPOSITION contract in
// relief.tsx asks for — the content is centred, so a symmetric drawing lands on it at any width. A
// tap is two objects with a DIRECTION between them and cannot be centred; the composition is
// diagonal and bilateral symmetry is gone. What replaces it as the organising principle is BALANCE:
// the terminal overhangs the left column and the card overhangs the right by roughly the same
// amount, so the frame reads as composed rather than as lopsided. One object overhanging alone is
// what would look like a mistake. Don't "fix" this back into symmetry — it would take the subject
// with it.
//
// WHERE THINGS SIT, measured in the running app at this hero's 414×360 box (viewBox units). These
// are THIS hero's numbers and they changed when the pill row left the screen, so the note on the
// Cards stack above does not apply here:
//   avatar 99–136 (x 184–216), label 164–183 (x 160–240), total 197–242 (x 121–279),
//   Billed/Unbilled 259–274 and their figures 277–305 (both x 123–276).
// Which leaves, and this is the useful part: a CLEAR FOOT at y 305–400 across the full width, and
// CLEAR COLUMNS at x < 121 and x > 279 for the entire height. The terminal lives in the left column
// and the foot, the card in the right column. Re-measure before moving either.
//
// THE BANDS ARE GROOVES, not ridges — cut into the ground rather than standing off it. That is the
// inverse of nearly everything else in this file and it is the same reasoning as the sprocket holes
// on the Statements sheet: a recess is a shadow with its FAR wall lit, because the light comes from
// the top-left and falls on the inside of the lower-right side. Get it backwards and they read as
// raised ribs. Cutting them also makes them the darkest thing in the drawing, which is what lets
// four thick members cross the lower half of the total without competing with it — they subtract
// light where the type adds it.
const MC = 'mcb';

/** One arc of a contactless mark, from a0 to a1 about (cx, cy). */
const mcArc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${f(x0)} ${f(y0)} A ${f(r)} ${f(r)} 0 ${large} ${sweep} ${f(x1)} ${f(y1)}`;
};

// 135° to 225°: springing from the card's inner corner, opening down-left onto the reader. The mark
// is always drawn on this span and rotated as a group, so every instance of it is the same object.
const MC_A0 = 2.36;
const MC_A1 = 3.93;

/**
 * The contactless mark, cut as grooves.
 *
 * The lit far wall is drawn FIRST and offset down-right; the dark body then lands over its inner
 * half and leaves only a rim of it showing. Two full-width strokes side by side would read as two
 * lines — it is the overlap that reads as one channel with a depth.
 *
 * A DARK MEMBER ON THE DARK THEME CANNOT CARRY ITSELF, which is the thing to know before touching
 * these numbers. --relief-shadow is black at 0.65 and the ground is #0F1115, so on its own the body
 * darkens almost nothing; the first version of this was invisible in the running app. What makes a
 * groove read is the LIT RIM, and the body's job is only to give that rim something to be the edge
 * of. Hence a wide offset and a rim opacity near the body's, rather than the token quarter-strength
 * a raised member gets.
 *
 * It is also why grooves were the right choice here at all. These four are the heaviest members in
 * the drawing and they cross the lower half of the total; a RAISED band there would be light
 * competing with light. Cut, they subtract where the type adds, so the figure gains contrast from
 * the thing crossing it — which is what lets the well over this drawing be shallower than any other
 * in the file.
 */
const TapMark: React.FC<{
  cx: number; cy: number; radii: number[];
  w0: number; wStep: number; o0: number; oStep: number;
}> = ({ cx, cy, radii, w0, wStep, o0, oStep }) => (
  <>
    {radii.map((r, i) => {
      const d = mcArc(cx, cy, r, MC_A0, MC_A1);
      const w = w0 - i * wStep;
      const o = o0 - i * oStep;
      return (
        <g key={r}>
          <path d={d} fill="none" stroke="var(--relief-edge)" strokeWidth={f(w)} opacity={f(o * 0.9)} transform="translate(2.4 2.8)" />
          <path d={d} fill="none" stroke="var(--relief-shadow)" strokeWidth={f(w)} opacity={f(o)} />
        </g>
      );
    })}
  </>
);

// The terminal, and the card over it. Both are rotated about their own centres, so nudging a centre
// moves the whole member and its furniture together.
//
// BOTH RUN OFF TWO EDGES, which is what fills the frame. The card is cut by the top and the right,
// the terminal by the left and the bottom, so the subject reads as a fragment of something larger
// rather than as two objects placed in a box — the same move that made the Statements sheet work.
// It also fixes the fault this arrangement had first time out: with the card sitting at y 155 the
// whole top of the frame was empty above it.
//
// AND THE CARD NOW CLEARS EVERY BAND. Solved against the measurement above rather than nudged: its
// lower-left edge runs from (218.3, 77.3) to (275.5, 189.5), which puts it 13 units clear of the
// avatar at y 99, 22 clear of the label at y 164, and entirely above the total, whose band starts at
// y 197. That is a better result than the smaller card had, and it is the reason to prefer these
// numbers over any that merely look similar. Re-derive before moving it.
// THE CASE'S WIDTH AND ITS CENTRE ARE SOLVED TOGETHER, against two constraints that pull opposite
// ways. It has to sit far enough IN that the gap either side of the tap reads as deliberate, and its
// bottom-left corner has to stay OUTSIDE the visible edge at x −30 — at 175 wide that corner landed
// at −0.7, just inside, and the lit edge of the case showed as a thin bright vertical sliver a few
// units from the frame, which reads as a stray mark rather than as a cropped object. Every unit the
// case moves right has to be paid for with two units of width. At 236/57 the corner is at −35.8 and
// the head of the case reaches x 149.8; going further in needs a wider case again.
const MC_TERM = { cx: 57, cy: 336, w: 236, h: 270, rot: -10 };
const MC_CARD = { cx: 336, cy: 88, w: 200, h: 126, rot: -27 };

// The terminal's furniture, as insets from its own case rather than as absolute coordinates — so
// resizing the case carries the screen and the keypad with it instead of stranding them. The left
// insets are large because that side of the case is off-frame: measured from the case, the screen
// would otherwise start at x −44 and be half invisible.
const MC_T_L = MC_TERM.cx - MC_TERM.w / 2;
const MC_T_T = MC_TERM.cy - MC_TERM.h / 2;
// The screen is a FIXED size rather than a fraction of the case: the case's left flank is off-frame
// by design, so a width derived from it grows into the void and drags the screen's centre — and its
// text — off the visible part of the machine.
const MC_SCR = { x: MC_T_L + 55, y: MC_T_T + 22, w: 150, h: 74 };
// Four rows, and the fourth is off the bottom of the frame on purpose: a keypad that stops inside
// the viewBox reads as a small machine, where one running off the edge reads as a cropped big one.
const MC_KEY = { x: MC_T_L + 62, y: MC_SCR.y + MC_SCR.h + 20, w: 34, h: 21, dx: 48, dy: 31, rows: 4 };

// The slot the receipt is printing out of, at the head of the case. Sized and placed AROUND the
// ribbon below rather than independently: paper wider than the slot it came out of is the one
// mistake this pairing can make. The slip is 116 across on centre MC_T_L + 137, so it spans
// MC_T_L + 79…195 and the slot has to contain that.
const MC_SLOT = { x: MC_T_L + 74, y: MC_T_T - 4, w: 126, h: 8 };

/** A torn paper edge: notches along the run from (x0,y0) to (x1,y1), emitted as path commands so it
 *  can close a ribbon rather than stand on its own. The notches bite along the run's NORMAL, so the
 *  tear stays perpendicular however the edge is angled.
 *
 *  Depths are a CYCLED LIST, not one value. A uniform sawtooth is a perforation — the machine-made
 *  edge of a cheque book or the fanfold on the Statements sheet — and paper ripped off a roll is
 *  never that even. Alternating deep and shallow is the whole difference between "torn" and
 *  "punched", and it is why this receipt does not read as a second helping of Statements. */
const tornEdge = (x0: number, y0: number, x1: number, y1: number, depths: number[]) => {
  const teeth = depths.length;
  const dx = (x1 - x0) / teeth;
  const dy = (y1 - y0) / teeth;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const nx = (-(y1 - y0) / len) * depths[i];
    const ny = ((x1 - x0) / len) * depths[i];
    d += ` L ${f(x0 + dx * (i + 0.5) + nx)} ${f(y0 + dy * (i + 0.5) + ny)}`;
    d += ` L ${f(x0 + dx * (i + 1))} ${f(y0 + dy * (i + 1))}`;
  }
  return d;
};

/** A hand-written squiggle from (x0,y0) to (x1,y1), oscillating on the segment's OWN normal so it
 *  lies along whatever line it is written on rather than staying level with the frame. */
const squiggle = (x0: number, y0: number, x1: number, y1: number, waves: number, amp: number) => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  let d = `M ${f(x0)} ${f(y0)}`;
  for (let i = 0; i < waves; i++) {
    const tm = (i + 0.5) / waves;
    const t1 = (i + 1) / waves;
    const sgn = i % 2 === 0 ? 1 : -1;
    d += ` Q ${f(x0 + dx * tm + nx * amp * sgn)} ${f(y0 + dy * tm + ny * amp * sgn)}` +
         ` ${f(x0 + dx * t1)} ${f(y0 + dy * t1)}`;
  }
  return d;
};

// THE RECEIPT, and it is the reason this drawing works at all now.
//
// Two objects on a diagonal can only hold two corners of a square frame. The card had the upper
// right and the terminal the lower left, which left the upper LEFT and lower RIGHT open — and no
// amount of resizing either object closes them, because the gap is a property of the ARRANGEMENT
// rather than of the sizes. The fix is a third object, which turns a diagonal into a TRIANGLE: the
// most stable composition there is, and the one that actually fills a frame.
//
// A receipt is the right third object because it is not a new subject. The reader has just said
// PAYMENT SUCCESSFUL; a slip printing out of it is the next second of the same event, so it adds
// mass without adding a second thing for the drawing to be about. Drawn in the terminal's own local
// coordinates so it rotates with the case — a receipt that did not share the machine's tilt would
// read as pasted on.
//
// SWEPT, NOT HAND-DRAWN, and that is the second attempt. The first gave it two hand-tuned edges,
// which drifted apart toward the middle and made the slip read as an angular shard rather than as
// paper — a torn sheet leaning on the machine instead of a strip coming out of it. Paper's whole
// signature is CONSTANT WIDTH along a curve, so it is generated: a centreline cubic, offset both
// ways along its own normal, closed with a torn edge at the tip.
type Pt = [number, number];
type Cubic = [Pt, Pt, Pt, Pt];

/** Point and unit normal on a cubic at t. */
const cubicPN = ([p0, p1, p2, p3]: Cubic, t: number) => {
  const u = 1 - t;
  const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
  const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
  const tx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const ty = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  const L = Math.hypot(tx, ty) || 1;
  return { x, y, nx: -ty / L, ny: tx / L };
};

/** A constant-width ribbon swept along a cubic, torn off at the far end.
 *
 *  Sampled rather than offset analytically, because the offset of a cubic is not a cubic — the exact
 *  curve needs a higher order. At this width an 18-step polyline is indistinguishable from it, and
 *  the sampling is what buys the constant width the hand-drawn version could not hold. */
const ribbon = (c: Cubic, halfW: number, depths: number[]) => {
  const N = 18;
  const edge = (t: number, sign: number): Pt => {
    const p = cubicPN(c, t);
    return [p.x + p.nx * halfW * sign, p.y + p.ny * halfW * sign];
  };
  let d = '';
  for (let i = 0; i <= N; i++) {
    const [x, y] = edge(i / N, 1);
    d += `${i === 0 ? 'M' : ' L'} ${f(x)} ${f(y)}`;
  }
  const [ax, ay] = edge(1, 1);
  const [bx, by] = edge(1, -1);
  d += tornEdge(ax, ay, bx, by, depths);
  for (let i = N; i >= 0; i--) {
    const [x, y] = edge(i / N, -1);
    d += ` L ${f(x)} ${f(y)}`;
  }
  return `${d} Z`;
};

// THE ARC IS A HOOK, not a bow, and it runs the full height of the left void. The spine leaves the
// head of the machine, climbs almost vertically, turns over the top and comes back DOWN to the
// right — screen (54, 210) → (60, 131) → (90, 74) → (129, 59) → (164, 109). That last leg is the
// whole point: a till slip has been on a roll for a mile and the paper remembers it, so the free
// end falls back on itself instead of pointing away. Two earlier versions missed this — one ran
// straight from slot to tip and read as a plank, the next bowed but never turned over, which is a
// banner rather than a receipt.
//
// Solved against the void rather than eyeballed, and the numbers are the constraint. Swept and
// rotated with the case, the ribbon occupies screen x −5…219, y 3…221: it grazes the top of the
// frame, clears a padded avatar box (x 172…228, y 87…148) at every one of 160 sampled edge points,
// and stops 17 units short of the card graphic at x 236. There is no slack left in it — re-run
// those bounds before moving any control point or the half-width.
const MC_R_CURVE: Cubic = [
  [MC_T_L + 137, MC_T_T + 14],
  [MC_T_L + 143, MC_T_T - 98],
  [MC_T_L + 246, MC_T_T - 186],
  [MC_T_L + 263, MC_T_T - 70],
];
// 116 units across, against a 236-unit case — half the width of the machine that prints it, which
// is about the ratio a real slip has. It was 58, then 96: both read as a ribbon or a strap, because
// what makes paper look like paper at this scale is being wide enough to carry print across.
const MC_R_HALF = 58;
// Deepened with the width. Teeth are SPACED across the torn end, so holding the depths while the
// end doubles in length turns a tear into a row of nicks.
const MC_RECEIPT = ribbon(MC_R_CURVE, MC_R_HALF, [10, 4, 11, 5, 8.5, 3.5]);

/** A point across the slip at t, given as a fraction of its half-width either side of the fold. */
const mcAcross = (t: number, k: number) => {
  const p = cubicPN(MC_R_CURVE, t);
  const d = MC_R_HALF * k;
  return { x1: p.x - p.nx * d, y1: p.y - p.ny * d, x2: p.x + p.nx * d, y2: p.y + p.ny * d };
};

// THE CURL, as one lit line running the length of the slip a third of the way across.
//
// This is what separates the receipt from every other flat member in the file. Paper coming off a
// roll does not lie flat, and a ribbon with nothing but an outline reads as a strap cut from card.
// One highlight along the fold gives it a near side and a far side, which is the cheapest possible
// way to say "this is limp" — and limpness is the only thing that distinguishes paper from plastic
// in a drawing where everything is the same tone.
const MC_R_CREASE = Array.from({ length: 15 }, (_, i) => {
  const p = cubicPN(MC_R_CURVE, i / 14);
  const d = -MC_R_HALF * 0.34;
  return `${i === 0 ? 'M' : 'L'} ${f(p.x + p.nx * d)} ${f(p.y + p.ny * d)}`;
}).join(' ');

// THE SIGNATURE, and it is the reason this slip is styled the way it is rather than as more print.
//
// A card slip is the one document in this whole app that you SIGN, and signing is exactly what makes
// a card yours rather than the bank's — which is the difference between this screen and the Cards
// root it sits under. So the receipt carries a ruled line with a hand across it, and the ruled line
// is drawn shorter than the hand that overruns it, because that is what a real signature does.
const MC_R_SIGN_RULE = mcAcross(0.2, 0.62);
const MC_R_SIGN = (() => {
  const a = mcAcross(0.26, 0.72);
  // Amplitude rises with the slip: the same 3.6 across a run twice as long flattens into a ruled
  // line with a wobble, which is a strikethrough, not a signature.
  return squiggle(a.x1, a.y1, a.x2, a.y2, 5, 5.6);
})();

// Illegible print across the slip, struck along its own normals so the lines lie ON the paper as it
// turns instead of staying level with the frame. A readable figure on a decorative drawing reads as
// data the screen is claiming to know — the rule the whole file keeps.
// Weight RISES toward the tip. A till printer feeds the head of the slip out first, so the tip is
// the top of the receipt and carries the heaviest line — the merchant's name. Reading the ramp the
// other way round would put the header at the machine and the total in mid-air.
const MC_RECEIPT_LINES = [0.45, 0.6, 0.78].map((t, i) => {
  const a = mcAcross(t, 0.66);
  return {
    key: t,
    x1: f(a.x1), y1: f(a.y1), x2: f(a.x2), y2: f(a.y2),
    w: [2, 2.3, 3.2][i],
    o: [0.6, 0.68, 0.85][i],
  };
});

export const MyCardsBackdrop: React.FC = () => (
  // A SHALLOWER WELL than anything else in this file, and the tap bands are the reason — see TapMark.
  // They are cut rather than raised, so they darken the ground under white type instead of competing
  // with it, and the default cut (which keeps under a fifth at the centre) erased them. The members
  // that do stand proud here — the terminal, the card — are out in the clear columns where the well
  // barely reaches, so nothing else pays for this.
  <ReliefSvg
    p={MC}
    wellRx={150}
    wellRy={168}
    well={[{ at: 0, hide: 0.55 }, { at: 45, hide: 0.42 }, { at: 78, hide: 0.15 }, { at: 100, hide: 0 }]}
  >
    {/* ── The terminal ── Running off the bottom edge, so it is standing on something rather than
        floating. The keypad is the feature that makes a slab of plastic read as a card machine; drop
        it and this is a phone. */}
    <g transform={`rotate(${MC_TERM.rot} ${MC_TERM.cx} ${MC_TERM.cy})`}>
      <g filter={`url(#${MC}-cast)`}>
        <path
          d={plateAt(MC_TERM.w, MC_TERM.h, MC_TERM.cx, MC_TERM.cy, 15)}
          fill={`url(#${MC}-stone-v)`}
          style={{ fillOpacity: 'var(--relief-plate-fill)' }}
          stroke="var(--relief-edge)" strokeWidth="1.3"
        />
      </g>

      {/* The screen: a recess, so it is filled with the low tone and gets no cast shadow of its
          own — a lit panel sitting proud of the case would read as a sticker. */}
      <rect
        x={MC_SCR.x} y={MC_SCR.y} width={MC_SCR.w} height={MC_SCR.h} rx="5"
        fill="var(--relief-lo)" stroke="var(--relief-edge)" strokeWidth="1" opacity="0.85"
      />

      {/* IT SAYS SOMETHING, and the precedent is the SETTLED stamp on the Statements sheet — see the
          long note there. The rule this file keeps is that no drawing may print a legible FIGURE,
          because a number on an engraving reads as data the screen is claiming to know. A terminal
          reading PAYMENT SUCCESSFUL claims nothing: it is the same kind of object as the stamp, and
          it is what completes the gesture — a tap with a blank screen is a tap that has not landed.
          Two lines because one would have to be set at half this size to fit the 114-unit screen. */}
      {['PAYMENT', 'SUCCESSFUL'].map((word, i) => (
        <text
          key={word}
          x={MC_SCR.x + MC_SCR.w / 2}
          y={MC_SCR.y + 28 + i * 23}
          textAnchor="middle" dominantBaseline="middle"
          fill="var(--relief-line)" opacity="0.95"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '17px', fontWeight: 800, letterSpacing: '0.5px' }}
        >
          {word}
        </text>
      ))}

      {/* The keypad: three to a row, which is the block a PIN pad actually reads as. */}
      {Array.from({ length: MC_KEY.rows }, (_, r) => [0, 1, 2].map(c => (
        <rect
          key={`${r}-${c}`}
          x={f(MC_KEY.x + c * MC_KEY.dx)} y={f(MC_KEY.y + r * MC_KEY.dy)}
          width={MC_KEY.w} height={MC_KEY.h} rx="3"
          fill={`url(#${MC}-stone-v)`}
          style={{ fillOpacity: 'var(--relief-plate-fill)' }}
          stroke="var(--relief-edge)" strokeWidth="0.8" opacity="0.8"
        />
      )))}

      {/* ── The receipt ── See MC_RECEIPT. Drawn before the slot below it, so the slot's dark mouth
          lands ON its base and the paper reads as coming OUT of the machine rather than as leaning
          against it. */}
      <g filter={`url(#${MC}-cast)`}>
        <path
          d={MC_RECEIPT} fill={`url(#${MC}-stone-v)`}
          style={{ fillOpacity: 'var(--relief-plate-fill)' }}
          stroke="var(--relief-edge)" strokeWidth="1.1"
        />
      </g>
      {/* The curl's highlight, then the print, then the signature over its rule — in that order so
          the hand sits on top of everything the way ink on paper does. */}
      <path d={MC_R_CREASE} fill="none" stroke="var(--relief-edge)" strokeWidth="1.2" opacity="0.55" />
      {MC_RECEIPT_LINES.map(l => (
        <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="var(--relief-line)" strokeWidth={l.w} opacity={l.o} />
      ))}
      <line
        x1={f(MC_R_SIGN_RULE.x1)} y1={f(MC_R_SIGN_RULE.y1)}
        x2={f(MC_R_SIGN_RULE.x2)} y2={f(MC_R_SIGN_RULE.y2)}
        stroke="var(--relief-line)" strokeWidth="1.1" opacity="0.45"
      />
      <path d={MC_R_SIGN} fill="none" stroke="var(--relief-edge)" strokeWidth="1.9" opacity="0.8" />

      {/* The mouth it is printing from — a recess, so it is the low tone with a lit lower lip. */}
      <rect
        x={f(MC_SLOT.x)} y={f(MC_SLOT.y)} width={MC_SLOT.w} height={MC_SLOT.h} rx="2"
        fill="var(--relief-lo)" stroke="var(--relief-shadow)" strokeWidth="1.1" opacity="0.95"
      />
      <line
        x1={f(MC_SLOT.x)} y1={f(MC_SLOT.y + MC_SLOT.h)} x2={f(MC_SLOT.x + MC_SLOT.w)} y2={f(MC_SLOT.y + MC_SLOT.h)}
        stroke="var(--relief-edge)" strokeWidth="1" opacity="0.7"
      />
    </g>

    {/* ── The card ── Smaller than the terminal, which is both the true relation between the two and
        what keeps it inside the clear right-hand column. */}
    <g transform={`rotate(${MC_CARD.rot} ${MC_CARD.cx} ${MC_CARD.cy})`}>
      <g filter={`url(#${MC}-cast)`}>
        <path
          d={plateAt(MC_CARD.w, MC_CARD.h, MC_CARD.cx, MC_CARD.cy, 9)}
          fill={`url(#${MC}-stone-v)`}
          style={{ fillOpacity: 'var(--relief-plate-fill)' }}
          stroke="var(--relief-edge)" strokeWidth="1.2"
        />
      </g>
      <Chip p={MC} x={266} y={52} w={38} />
      {/* Two embossed lines where a number and a name go — ragged, and illegible on purpose. */}
      {[[118, 152, 0.28], [130, 104, 0.2]].map(([y, len, o]) => (
        <line key={y} x1="266" y1={y} x2={266 + len} y2={y} stroke="var(--relief-line)" strokeWidth="2.4" opacity={o} />
      ))}
    </g>

    {/* ── The tap ── Last, so the channels are cut through everything under them.
        CENTRED IN THE GAP, not sprung off the card. The mark spans [cx − 88, cx − 0.707 × 28], so at
        cx 266.5 it stands 28.7 units clear of the reader's head at x 149.8 and 28.7 clear of the
        card's lower-left corner at x 275.5 — the same air on both sides. Solve it again if either
        object moves: the equal gaps are what stop the tap reading as stuck to the card. */}
    <TapMark cx={266.5} cy={187} radii={[28, 48, 68, 88]} w0={12} wStep={1.7} o0={1} oStep={0.15} />
  </ReliefSvg>
);

// ── Statements: continuous stationery ────────────────────────────────────────────────────────────
// Not a card. The other two heroes in this tree are plastic because they are about a card's balance;
// this screen is about a RUN of statements, and what says "a series of these, one per month" is the
// paper they were printed on — tractor-feed fanfold, with the sprocket margins down both sides and a
// perforated tear line between sheets.
//
// It is drawn from ABOVE, and that is the second attempt. The first drew the fold edge-on, as a
// triangular wave: an accordion needs depth to read as one, and there was not enough clear height
// below the pill row for the wave to be anything but a zigzag line with nothing behind it. Seen from
// above the same subject needs no depth at all: the sprocket holes are the whole signal, and they
// read at any height.
//
// THE SHEET NOW FILLS THE FRAME, which is the third attempt and the reason the rest of this comment
// is long. Confined to the strip below the pill row it had the fault the Cards root and Rewards both
// had before them — a milled rim out in the margins, the drawing itself squeezed into 78 units at
// the foot, and a large empty circle in between. The rim is gone with that version. It was a coin's
// edge, and this is paper; the sprocket columns are the margin ornament now, and they are the
// subject rather than a frame around it.
//
// Running the sheet the full height also fixes the thing the first two versions could only assert:
// continuous stationery is CONTINUOUS. It now runs off both the top and the bottom of the viewBox
// with no drawn top or bottom edge, so what you see is a length cut out of a longer run.
//
// WHERE THINGS SIT, measured in the running app at the hero's 374×340 box (viewBox units):
// avatar 52–118, label 134–154, the figure 169–216, its caption 228–245, the FY line 251–268, pill
// row 297–333. Both of the caption's two forms were measured — "Running across 5 cards" and "Billed
// across 3 statements" — because that line changes with the filter; they occupy the same band. That
// leaves clear bands at 0–52, 118–134, 154–169, 216–228, 245–251, 268–297 and 333–400.
//
// These numbers have now been re-derived three times, most recently when the hero grew a current-FY
// line and pushed every band below the figure down by roughly a dozen units. That is the standing
// cost of this method and it is worth paying, but it is a cost: a line added to that hero is never
// free.
//
// TEAR LINES ARE HORIZONTAL, and horizontal rules under type read as underlines or strikethroughs —
// the hazard this file has already paid for twice on the card stack. But a fanfold's folds are at a
// REGULAR PITCH: that regularity is what makes them sheet boundaries rather than three unrelated
// rules, so they cannot simply be dropped into whichever gaps are widest. The pitch and phase below
// were solved for against the band list above — every fold lands in a gap, and the tightest of them
// (161.5, in the 15-unit gap between the label and the figure) clears the type by 7.5 units on each
// side, which is the ceiling that gap allows rather than a choice. It is a fixed pitch over a
// measured gap map, so it survives neither a change to this hero's content nor a re-tuning of the
// pitch on its own: re-measure and re-solve, don't nudge.
//
// The legibility well does the rest. A fold crossing the centre line keeps under a fifth of its
// strength there and comes back to full out at the sprocket margins — which is where a perforation
// is most legible anyway, and it means the folds never assert themselves across the figure even
// though they cross it.
const SM = 'smb';
// Wide enough that the sheet reads as the hero's ground rather than a strip laid on it, and no
// wider: the hero box is 374 units of a 400 viewBox at this width, so the sprocket columns at 36 and
// 364 are the outermost thing that still lands on screen.
const SM_L = 28;
const SM_R = 372;
// The sprocket margins: the narrow strips outside the printing area, where the holes are punched.
const SM_MARGIN = 16;
const SM_HOLE_R = 3;
// One sheet, and the phase that puts every fold in a gap. See the note above before touching either.
const SM_PITCH = 118;
const SM_TEAR0 = 43.5;
const SM_TEARS = [0, 1, 2, 3].map(i => SM_TEAR0 + i * SM_PITCH); // 43.5, 161.5, 279.5, 397.5
// Eight holes to a sheet, so a hole lands ON every fold — which is how real stationery is punched,
// the perforation running between two holes rather than wandering across the strip.
const SM_HOLE_PITCH = SM_PITCH / 8;
// Started three holes ABOVE the first fold so the strip runs off the top of the frame rather than
// beginning at it — the phase that puts the folds in the gaps no longer starts near y 0.
const SM_HOLES = Array.from({ length: 28 }, (_, k) => SM_TEAR0 - 3 * SM_HOLE_PITCH + k * SM_HOLE_PITCH);
// The panels between the folds, plus the two partial ones running off the top and the bottom. Each
// gets its own gradient, and the direction alternates: paper is BRIGHTEST at a mountain fold, where
// it stands closest to the light, and DARKEST at a valley. So a panel that runs mountain-to-valley
// is lit at the top and falls away downward, and the panel after it does the reverse. That
// alternation is what makes the sheet read as folded rather than as a rectangle with lines on it —
// and it costs no new lines under the type, only a change of fill.
const SM_PANELS = [-8, ...SM_TEARS, 408];
// The printing area, inset from the sprocket margins.
const SM_PX = SM_L + SM_MARGIN + 14;
const SM_PXR = SM_R - SM_MARGIN - 14;
// A description on the left and a figure on the right, ruled, with a total under a double line —
// that pairing is the most statement-like thing a drawing can do without printing a legible number,
// and it is what the previous ragged-right lines were missing. They said "text"; this says "a bill".
// [y, where the description ends, where the figure starts] — all absolute x
// Kept ABOVE the first fold at 43.5. A fold is a full-width straight line and the print is wavy, so
// where the two nearly coincide the fold reads as a rule struck through a line of type rather than as
// a crease behind it — the one place on this sheet where "print overlaps print" does not look
// printed. Below the fold there are only seven units before the avatar, so everything goes above.
const SM_ROWS_TOP: [number, number, number][] = [[30, 178, 296], [38, 154, 304]];
const SM_ROWS_FOOT: [number, number, number][] = [[342, 186, 292], [353, 162, 300]];

/** One printed RULE — a divider, a total's underline, a margin. Straight, because that is what a
 *  rule is. The group's inherited round linecap keeps the heavier ones reading as set type rather
 *  than as drawn boxes. */
const SmRule: React.FC<{ x1: number; x2: number; y: number; w?: number; o?: number }> = ({ x1, x2, y, w = 1.6, o = 0.6 }) => (
  <line x1={x1} y1={y} x2={x2} y2={y} stroke="var(--relief-line)" strokeWidth={w} opacity={o} />
);

/** One line of TEXT, and the distinction from SmRule is the whole point of it existing.
 *
 *  Every illegible line on this sheet used to be dead straight, which is what a rule looks like and
 *  is not what type looks like: a line of print has ascenders, descenders and word gaps, and at this
 *  size the eye reads that unevenness as writing long before it can read a letter. A shallow wave
 *  supplies exactly that and nothing more.
 *
 *  The wave alternates direction every half-wavelength so it wanders rather than oscillating in
 *  step — a regular sine reads as a decorative squiggle, which is a different thing again. Amplitude
 *  stays near one unit: any more and it stops being text and becomes a ribbon. */
const scribble = (x1: number, x2: number, y: number, amp = 1.2, wl = 7) => {
  let d = `M ${x1} ${y}`;
  let up = true;
  for (let x = x1; x < x2; x += wl) {
    const nx = Math.min(x + wl, x2);
    d += ` Q ${(x + nx) / 2} ${y + (up ? -amp : amp)} ${nx} ${y}`;
    up = !up;
  }
  return d;
};

const SmText: React.FC<{ x1: number; x2: number; y: number; w?: number; o?: number; amp?: number }> = ({ x1, x2, y, w = 1.6, o = 0.6, amp }) => (
  <path d={scribble(x1, x2, y, amp)} fill="none" stroke="var(--relief-line)" strokeWidth={w} opacity={o} />
);

// THE STAMP.
//
// A rubber stamp slapped across a sheet is the right gesture for this drawing — it is the one mark
// a person adds to a statement by hand, and it belongs to the same world as the sprockets and the
// fanfold.
//
// It reads SETTLED, not PAID, and the distinction is the screen's own: a BILL is paid, a STATEMENT
// is settled. This plate heads a list of statements, and the rows under it use the same word.
//
// ROUND, not the rectangular banner it started as. A circular die is what an office stamp actually
// is — and it is the shape that survives the tilt, since a rotated rectangle reads as a crooked box
// where a rotated ring just reads as a ring pressed by hand.
//
// It was briefly conditional, rendered only when every statement in the list below was settled, on
// the reasoning that a WORD is a claim where the rest of this plate is deliberately illegible. That
// was the wrong line to draw, and the argument against it is the better one: this plate is an
// engraving, not a readout. The letterhead above the stamp heads no document, the ruled charges
// itemise nothing, and the total under the double rule totals nothing — every element here already
// depicts a statement that does not exist, and the stamp is the same kind of object. Nobody reads a
// bill's decoration to find out whether they have paid it, and nobody is in doubt about that anyway.
//
// It sits over the letterhead at the top right, tilted, because that is where a received invoice
// gets stamped and because that corner is outside the legibility well — the well would eat a stamp
// placed anywhere near the middle, which is exactly where a real one would go. Its position is
// bounded on two sides: at r=46 it can go no further right than cx 310 without crossing the sprocket
// margin rule at x 356, and no further down than cy 88 without its foot reaching the label band,
// which now starts at y 134 and runs out to x 318 — well under the stamp's left edge.
const SM_STAMP_CX = 304;
const SM_STAMP_CY = 82;
const SM_STAMP_R = 46;

const SettledStamp: React.FC = () => (
  <g transform={`rotate(-11 ${SM_STAMP_CX} ${SM_STAMP_CY})`} opacity="0.8">
    <circle
      cx={SM_STAMP_CX} cy={SM_STAMP_CY} r={SM_STAMP_R}
      fill="none" stroke="var(--relief-line)" strokeWidth="3" opacity="0.85"
    />
    <circle
      cx={SM_STAMP_CX} cy={SM_STAMP_CY} r={SM_STAMP_R - 7}
      fill="none" stroke="var(--relief-line)" strokeWidth="1.2" opacity="0.5"
    />
    {/* The rules an office die sets its word between. They also stop the word floating in the middle
        of an otherwise empty ring, which is what makes a round stamp read as a stamp. Run at least
        as wide as the word — a rule shorter than the type it brackets reads as a mistake — and no
        wider than the inner ring's chord at that height, which is 36 units. */}
    {[-15, 15].map(dy => (
      <line
        key={dy}
        x1={SM_STAMP_CX - 33} y1={SM_STAMP_CY + dy} x2={SM_STAMP_CX + 33} y2={SM_STAMP_CY + dy}
        stroke="var(--relief-line)" strokeWidth="1.2" opacity="0.45"
      />
    ))}
    <text
      x={SM_STAMP_CX} y={SM_STAMP_CY + 1}
      textAnchor="middle" dominantBaseline="middle"
      fill="var(--relief-line)" opacity="0.9"
      style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 800, letterSpacing: '1.2px' }}
    >
      SETTLED
    </text>
  </g>
);

export const StatementsBackdrop: React.FC = () => (
  <ReliefSvg p={SM} wellRx={148} wellRy={160}>
    {/* Two gradients rather than the shared stone-v, because this body is not one lit face: it is a
        run of panels hinged at the folds, and each one has to shade in the opposite direction to its
        neighbour. See SM_PANELS. */}
    <defs>
      <linearGradient id={`${SM}-fold-a`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--relief-hi)" />
        <stop offset="100%" stopColor="var(--relief-lo)" />
      </linearGradient>
      <linearGradient id={`${SM}-fold-b`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--relief-lo)" />
        <stop offset="100%" stopColor="var(--relief-hi)" />
      </linearGradient>
    </defs>

    {/* The sheet, running off both ends of the frame. The panels are adjacent and form one
        rectangle, so the filter sees a single silhouette and casts one shadow rather than banding
        the drawing at every fold. fillOpacity is damped by the shared token because --relief-hi is
        near-white in the light theme and this is a full-frame body: at full strength the lit end of
        every panel washes out the type over it. */}
    <g filter={`url(#${SM}-cast)`}>
      {SM_PANELS.slice(0, -1).map((y0, i) => (
        <rect
          key={y0} x={SM_L} y={y0} width={SM_R - SM_L} height={SM_PANELS[i + 1] - y0}
          fill={`url(#${SM}-fold-${i % 2 === 0 ? 'b' : 'a'})`}
          style={{ fillOpacity: 'var(--relief-plate-fill)' }}
        />
      ))}
      <path d={`M ${SM_L} -8 H ${SM_R} V 408 H ${SM_L} Z`} fill="none" stroke="var(--relief-edge)" strokeWidth="1.1" />
    </g>

    {/* The two rules that separate the sprocket margins from the printing area. On real stationery
        these are themselves perforations, so the margins tear off — drawn as rules here because at
        this scale a third and fourth dotted line turns the whole sheet into texture. They are also
        the only lines in this drawing that run the full height, and they can, because a vertical
        line is perpendicular to every baseline on the screen and can never read as a rule under
        type. */}
    {[SM_L + SM_MARGIN, SM_R - SM_MARGIN].map(x => (
      <line key={x} x1={x} y1={-8} x2={x} y2={408} stroke="var(--relief-line)" strokeWidth="0.9" opacity="0.42" />
    ))}

    {/* Sprocket holes. A hole is a shadow with a LIT LOWER edge — light from the top-left falls on
        the far wall of the punch — which is the inverse of the raised members elsewhere in this file.
        Get that backwards and they read as studs sitting on the paper. */}
    {[SM_L + SM_MARGIN / 2, SM_R - SM_MARGIN / 2].map(cx =>
      SM_HOLES.map(cy => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={SM_HOLE_R} fill="var(--relief-lo)" stroke="var(--relief-shadow)" strokeWidth="0.9" opacity="0.85" />
          <path
            d={`M ${cx - SM_HOLE_R * 0.8} ${cy + SM_HOLE_R * 0.6} A ${SM_HOLE_R} ${SM_HOLE_R} 0 0 0 ${cx + SM_HOLE_R * 0.8} ${cy + SM_HOLE_R * 0.6}`}
            fill="none" stroke="var(--relief-edge)" strokeWidth="0.8" opacity="0.75"
          />
        </g>
      ))
    )}

    {/* The folds: where one statement ends and the next begins. This is the element that makes it a
        RUN of sheets rather than one page, so it gets the dashes.
        Fanfold alternates mountain and valley, and that is what the parity is doing: a mountain
        catches the light on its upper side and casts below it, a valley the other way round. Drawn
        as one companion line to the perforation rather than the two-line crease used on the My Cards
        plate, because three lines at every fold turns four folds into twelve rules. */}
    {SM_TEARS.map((y, i) => {
      const mountain = i % 2 === 0;
      return (
        <g key={y}>
          <line
            x1={SM_L + SM_MARGIN} y1={y + (mountain ? -1.3 : 1.3)} x2={SM_R - SM_MARGIN} y2={y + (mountain ? -1.3 : 1.3)}
            stroke={mountain ? 'var(--relief-edge)' : 'var(--relief-shadow)'} strokeWidth="1.1" opacity="0.62"
          />
          <line
            x1={SM_L + SM_MARGIN} y1={y} x2={SM_R - SM_MARGIN} y2={y}
            stroke="var(--relief-line)" strokeWidth="1.1" opacity="0.6" strokeDasharray="2.5 5"
          />
        </g>
      );
    })}

    {/* Print, with no legible figure on it — a readable number on a decorative sheet reads as data
        the screen is claiming to know. The top sheet carries a letterhead and the head of a table;
        the bottom one carries the foot of it, ruled off with the double line accounting puts under a
        total. The sheets behind the figures stay blank, because the well would swallow print there
        and because blank paper under a total is what an unfilled statement looks like anyway. */}
    <SmText x1={SM_PX} x2={SM_PX + 112} y={11} w={3.6} o={0.8} amp={1.6} />
    <SmRule x1={SM_PX} x2={SM_PXR} y={21} w={1} o={0.45} />
    {SM_ROWS_TOP.map(([y, desc, amt], i) => (
      <g key={y}>
        <SmText x1={SM_PX} x2={desc} y={y} o={0.62 - i * 0.08} />
        <SmText x1={amt} x2={SM_PXR} y={y} o={0.62 - i * 0.08} />
      </g>
    ))}

    {SM_ROWS_FOOT.map(([y, desc, amt], i) => (
      <g key={y}>
        <SmText x1={SM_PX} x2={desc} y={y} o={0.6 - i * 0.07} />
        <SmText x1={amt} x2={SM_PXR} y={y} o={0.6 - i * 0.07} />
      </g>
    ))}
    {/* The total, set heavier, and the double rule under its figure. */}
    <SmText x1={SM_PX} x2={SM_PX + 54} y={366} w={2.6} o={0.85} amp={1.4} />
    <SmText x1={286} x2={SM_PXR} y={366} w={2.6} o={0.85} amp={1.4} />
    <SmRule x1={270} x2={SM_PXR} y={373} w={1} o={0.6} />
    <SmRule x1={270} x2={SM_PXR} y={376} w={1} o={0.6} />

    {/* Last, so the ink sits ON the print rather than under it. */}
    <SettledStamp />
  </ReliefSvg>
);

// ── Rewards: the cascade ─────────────────────────────────────────────────────────────────────────
// Coins and notes falling, tumbling, at every angle, with speed lines trailing behind them.
//
// It replaces a voucher torn off its book, and the voucher's fault was the one the Cards root had:
// a milled rim out in the margins, the paper confined to y 336–412, and nothing at all in between —
// a large empty circle with a small scalloped thing at the foot of it. The rim is gone with it. It
// was a coin's edge, and this drawing now has actual coins in it.
//
// WHERE THINGS SIT, measured in the running app at the hero's 374×392 box (viewBox units):
// avatar 81–140, label 155–173, lead figure 187–230, its caption 242–257, the rule 272, the trailing
// line 284–311. Two unit lines under the lead figure push all of that to roughly 58–357, and since
// the content is centred it grows at BOTH ends — so the vertical gaps between those bands are too
// small and too unstable to place anything in.
//
// What is stable is horizontal. The content is centred and none of it is wider than about 200 units,
// so x < 100 and x > 300 are clear for the full height whatever the figures do. That is where the
// cascade runs: two columns down the sides, with a few objects crossing the middle only in the strip
// above the avatar and the strip below the trailing line. It suits the subject — things falling past
// the figure rather than behind it — which is why this motif fits a hero that the card stack could
// not have.
//
// SPEED LINES RUN VERTICALLY, along the fall. Motion lines are drawn parallel to the direction of
// travel, so a falling thing trails them upward; horizontal ones would say the object is moving
// sideways. They are also the safe choice here, and for a reason this file has already paid for
// once: a horizontal line under a line of type parallels its baseline and reads as a rule or a
// strikethrough (see the note on the Cards stack). Vertical lines are perpendicular to every
// baseline on the screen and can never do that. Both arguments point the same way.
const RW = 'rwb';

/**
 * One thing in mid-air. Hand-placed, never randomised: a layout that reshuffled itself every render
 * would flicker on any state change the hero makes — and this hero changes its figures every time
 * the filter below it is switched.
 *
 * `tilt` is a coin's minor axis over its major one. A coin tumbling through the air is almost never
 * face-on to the viewer, and drawing them all as circles is what makes a coin drawing read as a row
 * of buttons. 1 is face-on, 0.45 is well over onto its side.
 */
interface Falling {
  kind: 'coin' | 'note';
  x: number; y: number;
  /** Coin radius, or note width. */ s: number;
  /** Degrees. */ rot: number;
  tilt: number;
  o: number;
  /** How far the speed lines reach back up. */ trail: number;
  /** Coins only. False on the hero coin, whose device is the hero's own figure — see RW_HERO. */
  device?: boolean;
}

// NINE objects, not fourteen, and each about half again as big. At the old size and count they read
// as confetti; the subject is money, and money wants some weight to it. Fewer and larger also keeps
// them out of the way more reliably — and mind that the columns are only clear out to x≈105 and in
// from x≈295, because the widest thing on this hero is the LABEL at y 155–173, not the figure.
const RW_FALL: Falling[] = [
  // Left column.
  { kind: 'coin', x: 54, y: 58, s: 34, rot: -16, tilt: 0.52, o: 0.9, trail: 34 },
  { kind: 'note', x: 58, y: 170, s: 84, rot: 22, tilt: 1, o: 0.8, trail: 26 },
  { kind: 'coin', x: 50, y: 288, s: 27, rot: 38, tilt: 0.8, o: 0.7, trail: 24 },
  { kind: 'note', x: 62, y: 374, s: 72, rot: -18, tilt: 1, o: 0.6, trail: 20 },
  // Right column.
  { kind: 'note', x: 340, y: 76, s: 78, rot: -26, tilt: 1, o: 0.85, trail: 30 },
  { kind: 'coin', x: 352, y: 190, s: 30, rot: 20, tilt: 0.62, o: 0.7, trail: 26 },
  { kind: 'note', x: 338, y: 296, s: 82, rot: 14, tilt: 1, o: 0.8, trail: 28 },
  { kind: 'coin', x: 346, y: 386, s: 32, rot: -30, tilt: 0.45, o: 0.55, trail: 22 },
  // One across the top, in the only strip the figures never reach whatever they say.
  { kind: 'coin', x: 178, y: 24, s: 21, rot: 10, tilt: 0.85, o: 0.5, trail: 16 },
];

// The big one, blurred, filling the middle the scatter has to keep clear.
//
// Its centre is the LEAD FIGURE's centre, measured in the running app at y 177–219 — so ₹499 lands
// where the device on a coin goes, and the coin is struck with the number the screen is about. That
// is why this one carries no ₹ of its own: two devices in one field would be a coin with a typo.
//
// It works where a big object normally could not because of the well. Suppression is 82% on the
// centre line and falls away outward, so the coin's rim reads at about 85% of its drawn weight while
// its field fades to nearly nothing behind the figure — the drawing gets a large form and the type
// keeps its ground, from the same mask, with no special-casing.
//
// Blurred on top of that, and the blur is doing two jobs: depth of field, which puts it behind the
// scatter rather than among it, and speed, since the thing is falling.
// Opacity 1 and a light blur, not the other way round. The relief tones are a sheen — white at 0.055
// on the dark theme — so this drawing lives almost entirely in its STROKES, and blur is what thins a
// stroke out. At stdDeviation 2.8 the coin had dissolved into a faint glow with no edge and no
// milling left; 1.8 keeps it a coin that happens to be out of focus.
// s=100, not 132. At 132 the coin was 264 across — two thirds of the frame — and stopped reading as
// an object in the scatter at all: it became a background wash the other nine things happened to be
// falling in front of. What fixes the size is what the coin is FOR: its inner ring has to hold the
// lead figure and not much more. At 100 that ring spans x 122–278 and y 143–253, and the figure sits
// at x≈163–253, y 177–219 — contained, with a field's worth of margin and no more.
const RW_HERO: Falling = { kind: 'coin', x: C, y: 198, s: 100, rot: -9, tilt: 0.7, o: 1, trail: 52, device: false };

/** The ₹ struck into a coin's field or printed on a note. SET rather than drawn as a path: the mono
 *  face already ships with the app and its ₹ is the glyph every figure on this screen is printed
 *  with, so the drawing and the numbers agree about what a rupee looks like. */
const Rupee: React.FC<{ p: string; size: number; opacity?: number }> = ({ p, size, opacity = 1 }) => (
  <text
    x="0" y={f(size * 0.36)} textAnchor="middle"
    style={{ fontFamily: 'var(--font-mono)', fontSize: `${f(size)}px`, fontWeight: 700 }}
    fill={`url(#${p}-stone-v)`} stroke="var(--relief-edge)" strokeWidth={f(size * 0.035)} opacity={opacity}
  >₹</text>
);

/**
 * A struck coin WITH THICKNESS: two ellipses, the far face offset down the minor axis, the band
 * between them milled. One ellipse reads as a printed disc however well it is shaded — what makes a
 * coin look like an object is being able to see its edge, and a tumbling coin shows more edge the
 * further over it has gone. Hence the thickness growing as `tilt` falls.
 *
 * The extrusion runs along the coin's OWN minor axis, not the frame's vertical, so it stays square
 * to the face at any rotation — which is why it sits inside the rotate. The speed lines outside it
 * are the opposite case: those belong to gravity, and gravity belongs to the frame.
 */
const Coin: React.FC<{ p: string; o: Falling }> = ({ p, o }) => {
  const ry = o.s * o.tilt;
  const t = o.s * (0.1 + (1 - o.tilt) * 0.2);
  const mills = Math.max(16, Math.round(o.s * 1.1));
  return (
    <g transform={`translate(${o.x} ${o.y}) rotate(${o.rot})`}>
      {/* The far face, showing below the near one as the edge. Lower tone: it is turned away. */}
      <ellipse cy={f(t)} rx={f(o.s)} ry={f(ry)} fill="var(--relief-lo)" stroke="var(--relief-edge)" strokeWidth="0.9" opacity="0.85" />
      {/* Milling on the EDGE, which is where a coin is actually knurled — the first version ran it
          across the face. Only the near half of the band is struck; the far half is behind the coin. */}
      {Array.from({ length: mills }, (_, i) => {
        const a = (i / mills) * Math.PI;
        const c = Math.cos(a);
        const sy = ry * Math.sin(a);
        return <line key={i} x1={f(o.s * c)} y1={f(sy)} x2={f(o.s * c)} y2={f(sy + t)} stroke="var(--relief-line)" strokeWidth="0.8" opacity="0.75" />;
      })}
      <ellipse rx={f(o.s)} ry={f(ry)} fill={`url(#${p}-dome)`} stroke="var(--relief-edge)" strokeWidth="1" />
      <ellipse rx={f(o.s * 0.78)} ry={f(ry * 0.78)} fill="none" stroke="var(--relief-edge)" strokeWidth="0.7" opacity="0.4" />
      {/* Specular: a short arc across the upper-left of the face, under the shared light. */}
      <path
        d={`M ${f(-o.s * 0.72)} ${f(-ry * 0.3)} A ${f(o.s * 0.8)} ${f(ry * 0.8)} 0 0 1 ${f(-o.s * 0.14)} ${f(-ry * 0.78)}`}
        fill="none" stroke="var(--relief-hi)" strokeWidth={f(o.s * 0.08)} opacity="0.9"
      />
      {/* The device, squashed by the same tilt as the coin it is struck into — an unsquashed glyph on
          an elliptical coin reads as a sticker lying on top rather than part of the face. */}
      {o.device !== false && (
        <g transform={`scale(1 ${f(o.tilt)})`}>
          <Rupee p={p} size={o.s * 1.05} opacity={0.95} />
        </g>
      )}
    </g>
  );
};

/** A banknote seen at an angle: the denomination's ₹ on the left, a watermark oval on the right, two
 *  lines of engraving between them. Nothing legible beyond the symbol — a readable figure on a
 *  decorative drawing reads as data the screen is claiming to know. */
const Note: React.FC<{ p: string; o: Falling }> = ({ p, o }) => {
  const w = o.s;
  const h = w / 2.15;
  return (
    <g transform={`translate(${o.x} ${o.y}) rotate(${o.rot})`}>
      <rect
        x={f(-w / 2)} y={f(-h / 2)} width={f(w)} height={f(h)} rx="3"
        fill={`url(#${p}-stone-v)`} stroke="var(--relief-edge)" strokeWidth="0.9"
      />
      <rect x={f(-w / 2 + 3.5)} y={f(-h / 2 + 3)} width={f(w - 7)} height={f(h - 6)} rx="2" fill="none" stroke="var(--relief-line)" strokeWidth="0.6" opacity="0.4" />
      <ellipse cx={f(w * 0.29)} cy="0" rx={f(h * 0.26)} ry={f(h * 0.32)} fill="none" stroke="var(--relief-line)" strokeWidth="0.8" opacity="0.75" />
      <g transform={`translate(${f(-w * 0.29)} 0)`}>
        <Rupee p={p} size={h * 0.78} opacity={0.9} />
      </g>
      {[-0.2, 0.16].map((k, i) => (
        <line key={i} x1={f(-w * 0.04)} y1={f(h * k)} x2={f(w * (i === 0 ? 0.14 : 0.08))} y2={f(h * k)} stroke="var(--relief-line)" strokeWidth="0.8" opacity={0.4 - i * 0.12} />
      ))}
    </g>
  );
};

/**
 * Speed lines: vertical, along the fall.
 *
 * Drawn OUTSIDE the object's own rotate, on purpose. Gravity does not tumble with the coin —
 * however the thing is spinning, it fell straight down, so the trail belongs to the frame and not to
 * the object. Rotate them with it and everything looks thrown rather than dropped.
 *
 * Vertical rather than horizontal for two reasons that happen to agree. Motion lines are drawn
 * parallel to the direction of travel, so a falling thing trails them upward. And a horizontal line
 * under a line of type parallels its baseline and reads as a rule or a strikethrough — the finding
 * the Cards stack in this same file had to be tilted to get around. Vertical lines are perpendicular
 * to every baseline on the screen and can never do that.
 */
const Trail: React.FC<{ o: Falling; ks?: number[] }> = ({ o, ks = [-0.5, 0, 0.55] }) => {
  const top = o.y - (o.kind === 'coin' ? o.s * o.tilt : o.s / 4.3) - 7;
  return (
    <>
      {ks.map((k, j) => {
        const mid = j === (ks.length - 1) / 2;
        const y1 = top - (mid ? 0 : 5);
        return (
          <line
            key={j}
            x1={f(o.x + k * o.s * 0.55)} y1={f(y1)}
            x2={f(o.x + k * o.s * 0.55)} y2={f(y1 - o.trail * (mid ? 1 : 0.62))}
            stroke="var(--relief-line)" strokeWidth={mid ? 1.3 : 0.85} opacity={mid ? 0.32 : 0.2}
          />
        );
      })}
    </>
  );
};

export const RewardsBackdrop: React.FC = () => (
  // Taller well than the voucher this replaced needed: the figures below the rule reach 321 on a
  // plain month and further once a card pays in its own unit, and the cascade runs behind all of it.
  <ReliefSvg p={RW} wellRx={150} wellRy={178}>
    <defs>
      <filter id={`${RW}-soft`} x="-25%" y="-25%" width="150%" height="150%">
        <feGaussianBlur stdDeviation="1.8" />
      </filter>
    </defs>

    {/* First, so everything else falls in front of it. */}
    <g opacity={RW_HERO.o} filter={`url(#${RW}-soft)`}>
      <Trail o={RW_HERO} ks={[-0.62, -0.3, 0, 0.32, 0.66]} />
      <Coin p={RW} o={RW_HERO} />
    </g>

    {RW_FALL.map((o, i) => (
      <g key={i} opacity={o.o}>
        <Trail o={o} />
        <g filter={`url(#${RW}-cast-tight)`}>
          {o.kind === 'coin' ? <Coin p={RW} o={o} /> : <Note p={RW} o={o} />}
        </g>
      </g>
    ))}
  </ReliefSvg>
);
