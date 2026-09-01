// ── The bas-relief idiom, shared by every category backdrop ──────────────────────────────────────
//
// One engraving language, so a new tree's motif can't drift from the ones already on screen:
// inline SVG (crisp at any density, no network request, tones from CSS custom properties so one
// drawing serves both themes), shaded relief rather than line art, and a single light source at the
// top-left.
//
// COMPOSITION, and it is load-bearing: the viewBox is square, everything is symmetric about its
// vertical centre line, and the drawing is scaled with 'meet'. Each hero centres its content, so the
// drawing's centre lands on the content's centre at any width — which is what puts the avatar, label
// and total inside the medallion / between the columns / on the card face. Break the squareness or
// the centring and the content drifts off the motif.
//
// Most of these drawings are CONCENTRIC about that centre, which is the stronger property and the
// one to reach for first. CardsBackdrop is the exception: a wallet is not a ring, so it settles for
// bilateral symmetry, which is all the contract above actually requires. That is a deliberate
// relaxation, not an oversight — don't "fix" it back into a circle.
//
// RELIEF: filled bodies shaded by gradient, paired lit/shadow edge strokes (light on the top-left
// of a form, shadow on its bottom-right), and feDropShadow on the members that physically stand
// proud. Break the shared light direction and the whole thing flattens out.
//
// Extracted from WealthCategoryBackdrops when Cards became the second tree to need it. The drawings
// themselves stay with their own screens; only the language lives here.
import React from 'react';
import type { ReactNode } from 'react';
import { VB, C } from '../utils/reliefGeometry';

/**
 * How a drawing fades out at its foot. `start` is where the ramp begins as a fraction of the
 * viewBox height, `floor` the opacity it reaches at the bottom edge.
 *
 * The default leaves a faint ghost, which is right for a motif whose members are CUT by the
 * viewBox — the ghost is what stops the cut reading as a hard edge. A drawing whose foot is meant
 * to DISSOLVE wants the opposite: a later start and a floor of 0, so the member holds full strength
 * for longer and is then gone rather than dimmed. CardsBackdrop is the one that does.
 */
export interface ReliefFade { start: number; floor: number }
const DEFAULT_FADE: ReliefFade = { start: 0.8, floor: 0.12 };

/**
 * How deep the legibility well cuts, as stops from its centre (`at`, a percentage of the ellipse's
 * radius) to its edge. `hide` is how much of the relief is thrown away there — it goes into a
 * luminance mask as black, so 0.82 keeps under a fifth and 0 keeps everything.
 *
 * Overridable per drawing because the right depth depends on what is UNDER the type. The default
 * suits the heroes whose motifs keep their middles empty — there the well only has to damp a bit of
 * texture, so it can afford to cut hard. A drawing whose device is deliberately behind the figure
 * wants a shallower cut over a wider ellipse: the fall-off then reads as a halo around the type
 * rather than as a hole punched through the drawing. SpendBackdrop is the one that does.
 */
export type ReliefWell = { at: number; hide: number }[];
const DEFAULT_WELL: ReliefWell = [
  { at: 0, hide: 0.82 }, { at: 42, hide: 0.7 }, { at: 74, hide: 0.3 }, { at: 100, hide: 0 },
];

// ── Shared defs ──────────────────────────────────────────────────────────────────────────────────
// Ids are prefixed per drawing. Only one category is ever on screen at a time, but duplicate ids
// across three mounted SVGs would be a silent trap the first time that changes.
export const ReliefDefs: React.FC<{ p: string; wellRx: number; wellRy: number; fade?: ReliefFade; well?: ReliefWell }> = ({
  p, wellRx, wellRy, fade = DEFAULT_FADE, well = DEFAULT_WELL,
}) => (
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

    {/* Fades the relief out at the very bottom so it doesn't butt up hard against the rows below.
        Shape per drawing — see ReliefFade above. */}
    <linearGradient id={`${p}-fade`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#fff" stopOpacity="1" />
      <stop offset={`${fade.start * 100}%`} stopColor="#fff" stopOpacity="1" />
      <stop offset="100%" stopColor="#fff" stopOpacity={fade.floor} />
    </linearGradient>

    {/* Legibility well. Black in a luminance mask means "hide", so a higher stopOpacity mutes more:
        the centre keeps roughly a fifth of the relief — enough to still read as texture behind the
        avatar and the total without competing with them — and ramps back to full strength at the
        well's edge. Done in the mask rather than by weakening the tokens so the frame, columns and
        wreath, none of which sit under text, stay at full contrast. The well is an ellipse because
        these heroes are taller than they are busy: Portfolio stacks a total, a day change, a refresh
        button, a timestamp and a pill row down the same axis. */}
    <radialGradient id={`${p}-clear`} cx="50%" cy="50%" r="50%">
      {well.map(({ at, hide }) => (
        <stop key={at} offset={`${at}%`} stopColor="#000" stopOpacity={hide} />
      ))}
    </radialGradient>

    <mask id={`${p}-mask`}>
      <rect width={VB} height={VB} fill={`url(#${p}-fade)`} />
      <ellipse cx={C} cy={C} rx={wellRx} ry={wellRy} fill={`url(#${p}-clear)`} />
    </mask>
  </>
);

export const ReliefSvg: React.FC<{
  p: string; wellRx: number; wellRy: number; fade?: ReliefFade; well?: ReliefWell; children: ReactNode;
}> = ({
  p, wellRx, wellRy, fade, well, children,
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
      <ReliefDefs p={p} wellRx={wellRx} wellRy={wellRy} fade={fade} well={well} />
    </defs>
    <g mask={`url(#${p}-mask)`} strokeLinecap="round">{children}</g>
  </svg>
);

