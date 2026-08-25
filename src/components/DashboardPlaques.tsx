// The Dashboard's two doors: engraved plaques for Cards and Wealth, side by side under the hero.
//
// Not category cards. The tree screens use CategoryCard — a row with a figure and a chevron — and
// that shape is right where a list of categories needs comparing. Here there are exactly two, they
// are the only navigation on the screen, and the screen's whole point is that the month's spend is
// the single figure on it. So they carry a MOTIF and a WORD and no number: two more ₹ amounts
// directly under the hero would take back exactly what stripping the rest of the screen bought, and
// each door opens onto a hero that states its own total immediately.
//
// Opposing subjects in one shell — a card for what you owe, a currency note for what you own —
// drawn as siblings of the full-size engravings on the screens they lead to.
//
// SCALE IS THE WHOLE PROBLEM at this size. A plaque is ~165px on a 393px phone, roughly 40% of a
// hero backdrop, and the --relief-* tokens are tuned for the big drawings: --relief-hi is white at
// 5.5% and --relief-line at 20%. Scaled down, a faithful copy of a hero motif turns into grey mush.
// So these drawings are deliberately COARSER than their large siblings: fewer elements, heavier
// strokes, higher opacities, no milling, no cast shadows, no legibility well (nothing is printed
// over them but the word at the foot, which has the plaque's own gradient behind it).
import React from 'react';
import type { ReactNode } from 'react';

const VB = 100; // small viewBox: these are simple drawings and the numbers stay readable

/** The shared shell: a .card so the plaque inherits the app's NeoPOP treatment — 4px radius, the
 *  hard `4px 4px 0 #000` edge, and the lift-on-hover / press-down-on-tap transitions. `clickable`
 *  is not used anywhere here because it has no CSS rule behind it (see the note in TreeUi). */
const Plaque: React.FC<{
  label: string;
  drawing: ReactNode;
  onClick: () => void;
  tourClass?: string;
  ariaLabel: string;
}> = ({ label, drawing, onClick, tourClass = '', ariaLabel }) => (
  <button
    type="button"
    className={`card ${tourClass}`}
    onClick={onClick}
    aria-label={ariaLabel}
    style={{
      position: 'relative',
      // Square, so the two read as a matched pair whatever the phone's width. A fixed height would
      // leave them different shapes on a narrow screen.
      aspectRatio: '1 / 1',
      width: '100%',
      padding: 0,
      overflow: 'hidden',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      // .btn styling is not wanted here (uppercase, letter-spacing, its own background); .card is
      // the shell, and a <button> is the element because this is the screen's primary control and
      // has to be reachable from a keyboard and announced as pressable.
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      font: 'inherit',
      color: 'inherit',
      textAlign: 'center',
    }}
  >
    {drawing}
    <span
      className="text-mono uppercase"
      style={{
        position: 'relative',
        zIndex: 1,
        fontSize: '0.7rem',
        fontWeight: 800,
        letterSpacing: '2.5px',
        color: 'var(--text-primary)',
        paddingBottom: '0.95rem',
      }}
    >
      {label}
    </span>
  </button>
);

const Svg: React.FC<{ children: ReactNode }> = ({ children }) => (
  <svg
    viewBox={`0 0 ${VB} ${VB}`}
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
    focusable="false"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
  >
    {children}
  </svg>
);

/** Shading for both plaques. Lit from the top-left, like every other relief in the app. */
const Defs: React.FC<{ p: string }> = ({ p }) => (
  <defs>
    <linearGradient id={`${p}-face`} x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stopColor="var(--relief-hi)" />
      <stop offset="55%" stopColor="var(--relief-mid)" />
      <stop offset="100%" stopColor="var(--relief-lo)" />
    </linearGradient>
    {/* Pulls the drawing away from the foot of the plaque so the word sits on a clean ground. */}
    <linearGradient id={`${p}-fade`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#fff" stopOpacity="1" />
      <stop offset="62%" stopColor="#fff" stopOpacity="1" />
      <stop offset="100%" stopColor="#fff" stopOpacity="0.06" />
    </linearGradient>
    <mask id={`${p}-mask`}>
      <rect width={VB} height={VB} fill={`url(#${p}-fade)`} />
    </mask>
  </defs>
);

// ── Cards: two plates, the front one chipped ─────────────────────────────────────────────────────
const CardsMotif: React.FC = () => (
  <Svg>
    <Defs p="plq-c" />
    <g mask="url(#plq-c-mask)" transform="translate(0, -6)">
      {/* The card behind, rotated: at this scale a stack of three is indistinguishable from a blur,
          so it's two, and the offset is large enough to survive being 60px wide on a phone. */}
      <rect x="22" y="30" width="56" height="35" rx="4"
        fill="url(#plq-c-face)" stroke="var(--relief-line)" strokeWidth="0.9" opacity="0.55"
        transform="rotate(-12 50 47)" />
      {/* The front card. */}
      <rect x="20" y="35" width="60" height="38" rx="4"
        fill="url(#plq-c-face)" stroke="var(--relief-edge)" strokeWidth="1.1" />
      {/* Chip: a plate with one cross of contacts. Anything more detailed is invisible here. */}
      <rect x="26" y="43" width="13" height="10" rx="1.6" fill="var(--relief-mid)" stroke="var(--relief-line)" strokeWidth="0.9" />
      <line x1="26" y1="48" x2="39" y2="48" stroke="var(--relief-line)" strokeWidth="0.7" opacity="0.8" />
      <line x1="32.5" y1="43" x2="32.5" y2="53" stroke="var(--relief-line)" strokeWidth="0.7" opacity="0.8" />
      {/* Two embossed rules where a number would be — the shape of a card number, not the digits. */}
      <line x1="26" y1="62" x2="56" y2="62" stroke="var(--relief-line)" strokeWidth="2.2" opacity="0.4" strokeLinecap="round" />
      <line x1="60" y1="62" x2="74" y2="62" stroke="var(--relief-line)" strokeWidth="2.2" opacity="0.25" strokeLinecap="round" />
    </g>
  </Svg>
);

// ── Wealth: a note with a rupee medallion ────────────────────────────────────────────────────────
const WealthMotif: React.FC = () => (
  <Svg>
    <Defs p="plq-w" />
    <g mask="url(#plq-w-mask)" transform="translate(0, -6)">
      {/* The note: a plate with an inner rule, the way a banknote's border is printed. */}
      <rect x="17" y="30" width="66" height="42" rx="2"
        fill="url(#plq-w-face)" stroke="var(--relief-edge)" strokeWidth="1.1" />
      <rect x="21" y="34" width="58" height="34" rx="1" fill="none" stroke="var(--relief-line)" strokeWidth="0.7" opacity="0.5" />
      {/* The medallion, concentric like the guilloche rosette on a note — and a deliberate echo of
          the coin on the hero above, which is the same subject at a different scale. */}
      <circle cx="50" cy="51" r="13" fill="none" stroke="var(--relief-line)" strokeWidth="1" opacity="0.75" />
      <circle cx="50" cy="51" r="17" fill="none" stroke="var(--relief-line)" strokeWidth="0.7" opacity="0.4" />
      {/* The ₹ itself, drawn rather than set: a text node here would take the page's font stack and
          land at a different size and weight on any device that substituted it. Two bars, a bowl and
          the diagonal leg. */}
      <g stroke="var(--relief-line)" strokeWidth="1.9" strokeLinecap="round" fill="none" opacity="0.95">
        <line x1="44" y1="45" x2="56" y2="45" />
        <line x1="44" y1="49" x2="56" y2="49" />
        <path d="M 46 45 C 55 45 55 54 46 54 L 46 54" />
        <line x1="47" y1="54" x2="55" y2="58" />
      </g>
      {/* Corner flourishes, standing in for a note's engraved counters. */}
      <line x1="24" y1="37" x2="31" y2="37" stroke="var(--relief-line)" strokeWidth="1.6" opacity="0.35" strokeLinecap="round" />
      <line x1="69" y1="65" x2="76" y2="65" stroke="var(--relief-line)" strokeWidth="1.6" opacity="0.35" strokeLinecap="round" />
    </g>
  </Svg>
);

export const CardsPlaque: React.FC<{ onClick: () => void; tourClass?: string }> = ({ onClick, tourClass }) => (
  <Plaque label="Cards" drawing={<CardsMotif />} onClick={onClick} tourClass={tourClass} ariaLabel="Cards — dues, statements and rewards" />
);

export const WealthPlaque: React.FC<{ onClick: () => void; tourClass?: string }> = ({ onClick, tourClass }) => (
  <Plaque label="Wealth" drawing={<WealthMotif />} onClick={onClick} tourClass={tourClass} ariaLabel="Wealth — portfolio, assets and retirement" />
);
