// The Credit Cards tree's engravings. Same relief language as the Wealth category backdrops — see
// the COMPOSITION and RELIEF notes in relief.tsx — with subjects of their own:
//
//   Cards      → a stack of plates lying in a wallet, the top one carrying a chip, under a coin rim.
//   Dues       → one plate creased by a statement fold, with the charges ruled below it.
//   Statements → continuous-feed stationery, folded and perforated: one panel per cycle.
//   Rewards    → a voucher with a torn scalloped edge, a star struck in the middle of it.
//
// Why a card and not a coin or a vault: the Dashboard's hero is a coin (what you spent) and Wealth's
// is a vault door (what you own). A liability screen has to look like the plastic it tracks, or all
// three heroes read as the same drawing at a glance.
//
// WHERE THE DRAWING SITS is the hard part here, and two attempts got it wrong before this one.
//
// Measured in the running app, the Cards hero's content occupies viewBox y 59–341 of 400: avatar
// 59–123, label 139–157, total 169–213, billed/unbilled 229–269, utilization meter 285–310, due
// line 326–341. That is 70% of the drawing's height, and it cannot be escaped by making the hero
// taller — 'meet' scales the square by min(width, height) and centres it, so the drawing and the
// content grow together and the content stays at the same 70%.
//
// So the motif lives in the bands that are actually free: a rim in the LEFT AND RIGHT margins (its
// ticks suppressed near the vertical, where the content is), and the card stack in the BOTTOM strip,
// its top edges peeking up out of the lower border like cards in a wallet pocket and its bodies
// running off the viewBox. Nothing is drawn through the middle. Any future hero in this idiom has to
// measure its own stack the same way — the numbers above are this hero's, not a constant.
import React from 'react';
import { ReliefSvg } from './relief';
import { C, f } from '../utils/reliefGeometry';

// A card at the real 1.586:1 ISO/IEC 7810 ratio. Anything squarer stops reading as a card once the
// chip is on it.
const CARD_W = 250;
const CARD_H = Math.round(CARD_W / 1.586); // 158
const CARD_R = 11;

/** Rounded-rect path for a card plate, centred horizontally on C. */
const plate = (w: number, h: number, cy: number) =>
  `M ${f(C - w / 2 + CARD_R)} ${f(cy - h / 2)} ` +
  `h ${f(w - CARD_R * 2)} a ${CARD_R} ${CARD_R} 0 0 1 ${CARD_R} ${CARD_R} ` +
  `v ${f(h - CARD_R * 2)} a ${CARD_R} ${CARD_R} 0 0 1 ${-CARD_R} ${CARD_R} ` +
  `h ${f(-(w - CARD_R * 2))} a ${CARD_R} ${CARD_R} 0 0 1 ${-CARD_R} ${-CARD_R} ` +
  `v ${f(-(h - CARD_R * 2))} a ${CARD_R} ${CARD_R} 0 0 1 ${CARD_R} ${-CARD_R} Z`;

/** The EMV chip: a small plate with the contact pattern cut into it. */
const Chip: React.FC<{ p: string; x: number; y: number; w?: number }> = ({ p, x, y, w = 40 }) => {
  const h = w * 0.76;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g filter={`url(#${p}-cast-tight)`}>
      <rect x={x} y={y} width={w} height={h} rx="4" fill={`url(#${p}-stone-v)`} stroke="var(--relief-edge)" strokeWidth="0.9" opacity="0.9" />
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

/**
 * A milled coin rim, drawn as four arcs with gaps at the compass points rather than a closed ring
 * of ticks. The gaps are what keep it from reading as a dashed circle — a continuous chain of marks
 * at this weight looked like a border of little boxes, not a turned edge.
 */
const MilledRim: React.FC<{ r: number; mills?: number; opacity?: number }> = ({ r, mills = 96, opacity = 0.3 }) => {
  const ticks = Array.from({ length: mills }, (_, i) => {
    const a = (i / mills) * Math.PI * 2 - Math.PI / 2;
    // Suppressed near the top and bottom: the top is where the avatar sits and the bottom is where
    // the plates lie, and a tick crossing either reads as a scratch on the content.
    const deg = ((a * 180) / Math.PI + 450) % 360;
    const nearVertical = Math.min(Math.abs(deg - 90), Math.abs(deg - 270)) > 62;
    if (nearVertical) return null;
    const x1 = C + (r - 7) * Math.cos(a);
    const y1 = C + (r - 7) * Math.sin(a);
    const x2 = C + r * Math.cos(a);
    const y2 = C + r * Math.sin(a);
    return <line key={i} x1={f(x1)} y1={f(y1)} x2={f(x2)} y2={f(y2)} stroke="var(--relief-line)" strokeWidth="0.9" />;
  });
  return (
    <>
      <circle cx={C} cy={C} r={r} fill="none" stroke="var(--relief-line)" strokeWidth="0.9" opacity={opacity * 0.8} />
      <circle cx={C} cy={C} r={r - 7} fill="none" stroke="var(--relief-edge)" strokeWidth="0.7" opacity={opacity * 0.5} />
      <g opacity={opacity}>{ticks}</g>
    </>
  );
};

// ── Cards home: the wallet stack ─────────────────────────────────────────────────────────────────
const CD = 'cdb';
// The front plate's top edge, 11px below the due line's baseline — the first row of pixels that is
// certainly clear. Its centre therefore falls past the bottom of the viewBox, which is the point:
// only the top band of each card shows.
const CD_FRONT_EDGE = 352;
const CD_TOP_Y = CD_FRONT_EDGE + CARD_H / 2;
// Each plate behind is one further down the stack: its edge a few pixels higher, narrower for
// perspective, dimmer. Only those edges show, which is what makes it a stack and not a fan.
const CD_LAYERS = [
  { dy: 0, inset: 0, o: 1 },
  { dy: -9, inset: 18, o: 0.45 },
  { dy: -17, inset: 36, o: 0.24 },
];

export const CardsBackdrop: React.FC = () => (
  // A tall well: the content stack here is the longest in the app — avatar through due line.
  <ReliefSvg p={CD} wellRx={150} wellRy={172}>
    <MilledRim r={178} />

    {/* Back plates first, so the front one occludes them. Drawn in reverse order and clipped by
        nothing — the front plate's own fill is what hides their bodies. */}
    {[...CD_LAYERS].reverse().map(({ dy, inset, o }, i) => (
      <g key={i} opacity={o} filter={dy === 0 ? `url(#${CD}-cast)` : undefined}>
        <path
          d={plate(CARD_W - inset, CARD_H, CD_TOP_Y + dy)}
          fill={`url(#${CD}-stone-v)`}
          stroke={dy === 0 ? 'var(--relief-edge)' : 'var(--relief-line)'}
          strokeWidth={dy === 0 ? 1.2 : 0.9}
        />
      </g>
    ))}

    {/* Everything printed on the front plate has to fit the ~48px of it that is visible, so the
        chip and the stripe sit immediately below its top edge rather than in the card's usual
        positions. Below y=400 is off-screen and would be drawn for nobody. */}
    <Chip p={CD} x={C - CARD_W / 2 + 20} y={CD_FRONT_EDGE + 12} w={34} />
    {/* Magnetic stripe, as a recessed band: filled low, shadowed at its top edge and lit at its
        bottom — the inverse of a raised member, which is what makes it read as sunk in. */}
    <path
      d={`M ${C + 10} ${CD_FRONT_EDGE + 14} h ${CARD_W / 2 - 30} v 22 h ${-(CARD_W / 2 - 30)} Z`}
      fill="var(--relief-lo)" stroke="var(--relief-shadow)" strokeWidth="0.9" opacity="0.7"
    />
    <line
      x1={C + 10} y1={CD_FRONT_EDGE + 36}
      x2={C + CARD_W / 2 - 20} y2={CD_FRONT_EDGE + 36}
      stroke="var(--relief-edge)" strokeWidth="0.8" opacity="0.5"
    />
  </ReliefSvg>
);

// ── Dues: the plate, creased ─────────────────────────────────────────────────────────────────────
// A statement is a folded sheet, so this one puts the crease across the card and rules the charges
// under it. Same low placement, same reasoning: the Dues hero carries a total, a billed/unbilled
// pair and a pill row down the middle.
const DU = 'dub';
// The Dues hero's stack is shorter (no due line), but the clear band is the same place, so the plate
// sits at the same depth. The crease lands inside the visible band rather than at the card's middle.
const DU_EDGE = 348;
const DU_Y = DU_EDGE + CARD_H / 2;

export const DuesBackdrop: React.FC = () => (
  <ReliefSvg p={DU} wellRx={146} wellRy={164}>
    <MilledRim r={168} mills={80} opacity={0.22} />

    <g filter={`url(#${DU}-cast)`}>
      <path d={plate(CARD_W, CARD_H, DU_Y)} fill={`url(#${DU}-stone-v)`} stroke="var(--relief-edge)" strokeWidth="1.2" />
    </g>

    {/* The crease: a lit edge immediately above a shadowed one is the whole trick — two thin lines
        1.5px apart read as a fold, where either alone reads as a rule. */}
    <line x1={C - CARD_W / 2} y1={DU_EDGE + 26} x2={C + CARD_W / 2} y2={DU_EDGE + 26} stroke="var(--relief-edge)" strokeWidth="1" opacity="0.7" />
    <line x1={C - CARD_W / 2} y1={DU_EDGE + 27.5} x2={C + CARD_W / 2} y2={DU_EDGE + 27.5} stroke="var(--relief-shadow)" strokeWidth="1.3" opacity="0.55" />

    <Chip p={DU} x={C - CARD_W / 2 + 20} y={DU_EDGE + 8} w={30} />

    {/* Two charges ruled below the fold, ragged-right like a printed list — the shape of a statement
        with no legible figure on it. A readable number on a decorative plate reads as data the
        screen is claiming to know. */}
    {[0, 1].map(i => (
      <line
        key={i}
        x1={C - CARD_W / 2 + 20}
        y1={DU_EDGE + 38 + i * 11}
        x2={C - CARD_W / 2 + 20 + [150, 118][i]}
        y2={DU_EDGE + 38 + i * 11}
        stroke="var(--relief-line)" strokeWidth="1.6" opacity={0.3 - i * 0.07}
      />
    ))}
  </ReliefSvg>
);

// ── Statements: continuous stationery ────────────────────────────────────────────────────────────
// Not a card. The other two heroes in this tree are plastic because they are about a card's balance;
// this screen is about a RUN of statements, and what says "a series of these, one per month" is the
// paper they were printed on — tractor-feed fanfold, with the sprocket margins down both sides and a
// perforated tear line between sheets.
//
// It is drawn from ABOVE, and that is the second attempt. The first drew the fold edge-on, as a
// triangular wave: an accordion needs depth to read as one, and measured against this hero's own
// stack there are 64 units of clear space below the pill row — the wave came out as a zigzag line
// with nothing behind it. Seen from above, the same subject needs no depth at all: the sprocket holes
// are the whole signal, and they read at any height.
const SM = 'smb';
// Measured in the running app: avatar 64–130, label 146–166, total 181–228, count line 239–256, pill
// row 280–327. So the sheet's top edge is at 334 and everything below it is drawn in 66 units. See
// WHERE THE DRAWING SITS above — these numbers are this hero's, not a constant.
const SM_TOP = 334;
const SM_FOOT = 412; // past the viewBox, so the paper runs off the edge instead of ending on a line
const SM_L = 58;
const SM_R = 342;
// The sprocket margins: the narrow strips outside the printing area, where the holes are punched.
const SM_MARGIN = 16;
const SM_HOLE_R = 3;

export const StatementsBackdrop: React.FC = () => (
  <ReliefSvg p={SM} wellRx={148} wellRy={160}>
    <MilledRim r={170} mills={80} opacity={0.22} />

    <g filter={`url(#${SM}-cast)`}>
      <path
        d={`M ${SM_L} ${SM_TOP} H ${SM_R} V ${SM_FOOT} H ${SM_L} Z`}
        fill={`url(#${SM}-stone-v)`} stroke="var(--relief-edge)" strokeWidth="1.1"
      />
    </g>

    {/* The two rules that separate the sprocket margins from the printing area. On real stationery
        these are themselves perforations, so the margins tear off — drawn as rules here because at
        this scale a third and fourth dotted line turns the whole sheet into texture. */}
    {[SM_L + SM_MARGIN, SM_R - SM_MARGIN].map(x => (
      <line key={x} x1={x} y1={SM_TOP} x2={x} y2={SM_FOOT} stroke="var(--relief-line)" strokeWidth="0.8" opacity="0.3" />
    ))}

    {/* Sprocket holes. A hole is a shadow with a LIT LOWER edge — light from the top-left falls on
        the far wall of the punch — which is the inverse of the raised members elsewhere in this file.
        Get that backwards and they read as studs sitting on the paper. */}
    {[SM_L + SM_MARGIN / 2, SM_R - SM_MARGIN / 2].map(cx =>
      [346, 362, 378, 394].map(cy => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={SM_HOLE_R} fill="var(--relief-lo)" stroke="var(--relief-shadow)" strokeWidth="0.9" opacity="0.75" />
          <path
            d={`M ${cx - SM_HOLE_R * 0.8} ${cy + SM_HOLE_R * 0.6} A ${SM_HOLE_R} ${SM_HOLE_R} 0 0 0 ${cx + SM_HOLE_R * 0.8} ${cy + SM_HOLE_R * 0.6}`}
            fill="none" stroke="var(--relief-edge)" strokeWidth="0.7" opacity="0.5"
          />
        </g>
      ))
    )}

    {/* The tear lines: where one statement ends and the next begins. This is the element that makes
        it a RUN of sheets rather than one page, so it gets the dashes. */}
    {[354, 386].map(y => (
      <line
        key={y}
        x1={SM_L + SM_MARGIN} y1={y} x2={SM_R - SM_MARGIN} y2={y}
        stroke="var(--relief-line)" strokeWidth="1" opacity="0.4" strokeDasharray="2.5 5"
      />
    ))}

    {/* Print between the tear lines, ragged-right — the shape of a statement, with no legible figure
        on it. A readable number on a decorative sheet reads as data the screen is claiming to know. */}
    {[190, 148].map((w, i) => (
      <line
        key={i}
        x1={SM_L + SM_MARGIN + 14} y1={366 + i * 10}
        x2={SM_L + SM_MARGIN + 14 + w} y2={366 + i * 10}
        stroke="var(--relief-line)" strokeWidth="1.6" opacity={0.26 - i * 0.07}
      />
    ))}
  </ReliefSvg>
);

// ── Rewards: the voucher ─────────────────────────────────────────────────────────────────────────
// A coupon torn off its book: scalloped along the tear, with a star struck in the middle. Neither
// plastic nor a statement — a reward is a thing you're given, and the voucher is the one object in
// this tree that says "owed TO you" rather than "owed BY you".
//
// The star is the device, and it is the only closed figure in the tree's three motifs. That is
// deliberate: at a glance the eye finds it before it reads any of the paper, which is what stops the
// Rewards hero from looking like the Statements hero with different numbers on it.
const RW = 'rwb';
// Measured in the running app at the hero's 360px height: avatar 89–163, label 178–197, figure
// 210–255, one unit line 262–279, count line 291–308. A second unit line pushes that to ~325, which
// is the case the top edge has to clear — a first cut put it at 296, above the count line entirely.
// It lands at the same depth as the Statements sheet, which is worth having: the tree's two paper
// motifs then sit on the same line.
const RW_TOP = 336;
const RW_FOOT = 412;
const RW_L = 84;
const RW_R = 316;
const RW_SCALLOPS = 12;
const RW_BITE = (RW_R - RW_L) / RW_SCALLOPS;

// A five-pointed star, struck rather than drawn: ten vertices alternating between the outer and
// inner radius, starting at the top point.
const starPath = (cx: number, cy: number, rOut: number, rIn: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? rOut : rIn;
    return `${i === 0 ? 'M' : 'L'} ${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  }).join(' ') + ' Z';

export const RewardsBackdrop: React.FC = () => {
  // The tear: a run of semicircular bites taken OUT of the top edge. Sweep-flag 0 is what makes each
  // arc dip into the paper — with 1 they bulge upward and the edge reads as a row of beads sitting on
  // top of the voucher instead of a perforation torn through it.
  const tear = Array.from({ length: RW_SCALLOPS }, () =>
    `a ${f(RW_BITE / 2)} ${f(RW_BITE / 2)} 0 0 0 ${f(RW_BITE)} 0`).join(' ');

  return (
    <ReliefSvg p={RW} wellRx={146} wellRy={150}>
      <MilledRim r={170} mills={80} opacity={0.22} />

      <g filter={`url(#${RW}-cast)`}>
        <path
          d={`M ${RW_L} ${RW_TOP} ${tear} L ${RW_R} ${RW_FOOT} L ${RW_L} ${RW_FOOT} Z`}
          fill={`url(#${RW}-stone-v)`} stroke="var(--relief-edge)" strokeWidth="1.1"
        />
      </g>

      {/* The star, standing proud of the voucher: its own cast shadow plus a lit upper edge. A flat
          filled star at this size reads as a sticker; the shadow is what strikes it into the card. */}
      <g filter={`url(#${RW}-cast-tight)`}>
        <path d={starPath(C, 374, 24, 10)} fill={`url(#${RW}-dome)`} stroke="var(--relief-edge)" strokeWidth="1" opacity="0.95" />
      </g>

      {/* Print either side of the star, ragged — the shape of a voucher's terms, with nothing legible
          on it. Short, because the star has to stay the thing the eye lands on. */}
      {[[RW_L + 12, 56], [C + 40, 52]].map(([x, w], i) => (
        <React.Fragment key={i}>
          <line x1={x} y1="368" x2={x + w} y2="368" stroke="var(--relief-line)" strokeWidth="1.5" opacity="0.24" />
          <line x1={x} y1="380" x2={x + w * 0.7} y2="380" stroke="var(--relief-line)" strokeWidth="1.5" opacity="0.16" />
        </React.Fragment>
      ))}
    </ReliefSvg>
  );
};
