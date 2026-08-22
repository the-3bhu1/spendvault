// ── The bas-relief idiom, shared by every category backdrop ──────────────────────────────────────
//
// One engraving language, so a new tree's motif can't drift from the ones already on screen:
// inline SVG (crisp at any density, no network request, tones from CSS custom properties so one
// drawing serves both themes), shaded relief rather than line art, and a single light source at the
// top-left.
//
// COMPOSITION, and it is load-bearing: the viewBox is square, everything is concentric about its
// centre, and the drawing is scaled with 'meet'. Each hero centres its content, so the drawing's
// centre lands on the content's centre at any width — which is what puts the avatar, label and
// total inside the medallion / between the columns / on the card face. Break the squareness or the
// centring and the content drifts off the motif.
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

// ── Shared defs ──────────────────────────────────────────────────────────────────────────────────
// Ids are prefixed per drawing. Only one category is ever on screen at a time, but duplicate ids
// across three mounted SVGs would be a silent trap the first time that changes.
export const ReliefDefs: React.FC<{ p: string; wellRx: number; wellRy: number }> = ({ p, wellRx, wellRy }) => (
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

    {/* Fades the relief out at the very bottom so it doesn't butt up hard against the rows below. */}
    <linearGradient id={`${p}-fade`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#fff" stopOpacity="1" />
      <stop offset="80%" stopColor="#fff" stopOpacity="1" />
      <stop offset="100%" stopColor="#fff" stopOpacity="0.12" />
    </linearGradient>

    {/* Legibility well. Black in a luminance mask means "hide", so a higher stopOpacity mutes more:
        the centre keeps roughly a fifth of the relief — enough to still read as texture behind the
        avatar and the total without competing with them — and ramps back to full strength at the
        well's edge. Done in the mask rather than by weakening the tokens so the frame, columns and
        wreath, none of which sit under text, stay at full contrast. The well is an ellipse because
        these heroes are taller than they are busy: Portfolio stacks a total, a day change, a refresh
        button, a timestamp and a pill row down the same axis. */}
    <radialGradient id={`${p}-clear`} cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor="#000" stopOpacity="0.82" />
      <stop offset="42%" stopColor="#000" stopOpacity="0.7" />
      <stop offset="74%" stopColor="#000" stopOpacity="0.3" />
      <stop offset="100%" stopColor="#000" stopOpacity="0" />
    </radialGradient>

    <mask id={`${p}-mask`}>
      <rect width={VB} height={VB} fill={`url(#${p}-fade)`} />
      <ellipse cx={C} cy={C} rx={wellRx} ry={wellRy} fill={`url(#${p}-clear)`} />
    </mask>
  </>
);

export const ReliefSvg: React.FC<{ p: string; wellRx: number; wellRy: number; children: ReactNode }> = ({
  p, wellRx, wellRy, children,
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
      <ReliefDefs p={p} wellRx={wellRx} wellRy={wellRy} />
    </defs>
    <g mask={`url(#${p}-mask)`} strokeLinecap="round">{children}</g>
  </svg>
);

