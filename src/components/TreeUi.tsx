// ── The shape a category tree is built from ──────────────────────────────────────────────────────
//
// Wealth established this pattern: a root screen with an illustrated hero and a stack of category
// cards, each opening a sub-view with its own hero and filter pills, each of those opening a detail
// screen whose identity is a mark pressed into a wax seal. Cards is the second tree to use it, so
// these five pieces move out of Wealth.tsx rather than being copied into it — a tree is now a thing
// the app HAS, not a thing one screen does.
//
// Lifted verbatim: every measurement, comment and rationale below came from Wealth and is load-
// bearing there. The only additions are the props a second consumer needs — the tour classes, which
// were hard-coded to Wealth's selectors, and CategoryHero's `label`, which was already a parameter.
import React from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';
import { DetailHeroSeal, DETAIL_HERO_AVATAR } from './DetailHeroBackdrop';
import { userPossessive } from '../utils';

export interface CategoryCardProps {
  icon: ReactNode;
  label: string;
  subtext: string;
  value: string;
  valueNote?: ReactNode;
  onClick: () => void;
  tourClass?: string;
  /** Tints the icon tile. Defaults to the accent; a tree can give each category its own. */
  iconColor?: string;
}

/**
 * One row on a tree's root screen: icon tile, label over subtext, figure on the right, chevron.
 */
export const CategoryCard: React.FC<CategoryCardProps> = ({
  icon, label, subtext, value, valueNote, onClick, tourClass = '', iconColor = 'var(--accent)',
}) => (
  // Uses .card rather than a bespoke shell: that's what carries the app's NeoPOP treatment —
  // 4px radius, the hard `4px 4px 0 #000` edge, and the lift-on-hover / press-down-on-tap
  // transitions. These cards previously hand-rolled a 1rem-radius, shadowless box and leaned on a
  // `clickable` class that has no CSS rule, so they read as flat panels from a different app and
  // gave no feedback on tap despite being the primary navigation on this screen.
  <div
    className={`card ${tourClass}`}
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
      padding: '1.15rem 1.25rem',
      minHeight: '92px',
      boxSizing: 'border-box',
      cursor: 'pointer'
    }}
  >
    {/* Square-cornered tile with its own hard edge, echoing .badge-scalloped — the soft circle it
        replaced was the only rounded-pill shape on the screen. */}
    <div style={{
      width: '44px',
      height: '44px',
      borderRadius: '4px',
      background: 'var(--bg-card-elevated)',
      border: '1px solid var(--border-color)',
      boxShadow: '3px 3px 0 #000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      color: iconColor
    }}>
      {icon}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="text-mono uppercase" style={{ fontSize: '0.74rem', fontWeight: 800, letterSpacing: '1.5px', color: 'var(--text-primary)' }}>
        {label}
      </div>
      <div style={{
        fontSize: '0.72rem',
        color: 'var(--text-secondary)',
        marginTop: '0.25rem',
        lineHeight: 1.4,
        // The text column is only ~110px wide, so a two-word subtext wraps. Breaking only on
        // spaces keeps "E-Wallets"-style labels intact; the card's minHeight absorbs the extra
        // line so all the cards stay the same height.
        overflowWrap: 'normal',
        wordBreak: 'keep-all'
      }}>
        {subtext}
      </div>
    </div>
    <div style={{ textAlign: 'right', flexShrink: 0 }}>
      {/* text-serif: every other figure in the app is set in the serif face (the hero above,
          account balances, holding values). A plain sans number here broke that. */}
      <div className="text-serif" style={{ fontSize: '1.15rem', color: 'var(--text-primary)' }}>{value}</div>
      {valueNote}
    </div>
    <ChevronRight size={18} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
  </div>
);

/**
 * Shared chrome for EVERY sub-view in a tree — both the category views and the detail screen.
 *
 * Deliberately carries no horizontal padding: that matches SubviewWrapper, Debts, Splits and
 * AccountStatement, which all sit the chevron at the page container's own padding with the title
 * beside it. Wealth used to add 1.5rem of its own here, putting its back button 24px further in
 * than every other screen's, and the holding detail hand-rolled a second, title-less variant.
 *
 * `hideTitle` drops the label beside the chevron — for a category screen, whose hero right below
 * already opens with "<Name>'s <Category>", repeating the same word here was pure noise. A detail
 * view still passes a title: it has no hero of its own to say where "back" goes.
 */
export const SubviewHeader: React.FC<{
  title: string;
  onBack: () => void;
  tourClass?: string;
  hideTitle?: boolean;
}> = ({ title, onBack, tourClass = '', hideTitle = false }) => (
  // Stacked above the hero explicitly: the hero below overlaps this row's box (see marginTop in
  // CategoryHero), and without this the chevron's hit area would sit underneath it.
  <div className="flex align-center gap-4" style={{ position: 'relative', zIndex: 2, padding: hideTitle ? 0 : '0 0 0.25rem', boxSizing: 'border-box' }}>
    <button
      className={`btn btn-secondary ${tourClass}`}
      style={{ padding: '0.5rem', flexShrink: 0 }}
      onClick={onBack}
    >
      <ChevronLeft size={20} />
    </button>
    {!hideTitle && (
      <div className="text-mono uppercase" style={{ fontSize: '0.8rem', fontWeight: 800, letterSpacing: '2px', color: 'var(--text-primary)' }}>
        {title}
      </div>
    )}
  </div>
);

/**
 * The account's mark as the device impressed in a detail hero's wax seal. The wrapper is sized to
 * the avatar and nothing more on purpose: the seal centres itself on its parent, so the parent IS
 * the registration mark (see COMPOSITION in DetailHeroBackdrop). The mark is lifted over the wax,
 * which is what makes it read as pressed into the seal rather than sitting behind it.
 *
 * Only valid inside an identity block that follows a DetailHeroBand and lifts itself by
 * DETAIL_HERO_LIFT — that pairing is what puts this box inside the panel.
 */
export const SealedMark: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div style={{
    position: 'relative',
    width: `${DETAIL_HERO_AVATAR}px`,
    height: `${DETAIL_HERO_AVATAR}px`,
    marginBottom: '1rem',
  }}>
    <DetailHeroSeal />
    <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
  </div>
);

/**
 * The illustrated hero a category screen opens with: that category's own bas-relief engraving, the
 * user's avatar and "<Name>'s <Category>" over it, then the figures the category leads with.
 *
 * position/overflow exist because the drawing is absolutely positioned to this box and bleeds past
 * the horizontal padding. The centring is what lands the content on the motif: each engraving is
 * concentric about its own centre, so the two only coincide if both are centred in the same box.
 * See the COMPOSITION note in WealthCategoryBackdrops.
 */
export const CategoryHero: React.FC<{
  backdrop: ReactNode;
  label: string;
  minHeight: string;
  userName?: string;
  children: ReactNode;
}> = ({ backdrop, label, minHeight, userName, children }) => (
  <div style={{
    position: 'relative',
    overflow: 'hidden',
    minHeight,
    // Pulls the whole hero up over the back button's row. That row is otherwise dead space —
    // the chevron is a small, left-aligned button with nothing beside it (see hideTitle above) —
    // while the hero's own content is horizontally centred, so the two never collide even
    // though they now overlap vertically.
    marginTop: '-28px',
    padding: '0 1.5rem 0.5rem',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center'
  }}>
    {backdrop}
    {/* One lifted wrapper, rather than a position/z-index on every figure inside it. */}
    <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <ProfileAvatar size={56} />
      <div className="text-mono uppercase" style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '2px', color: 'var(--text-primary)', opacity: 0.85, margin: '0.85rem 0 0.8rem' }}>
        {userPossessive(userName)} {label}
      </div>
      {children}
    </div>
  </div>
);

/**
 * A filter pill row. Pills are rendered only for the classes the caller actually has, and the row
 * disappears entirely below two — a lone "All" pill filters nothing. `flexible` lets the row span
 * the available width instead of the fixed 68px-per-pill sizing, which overflows a narrow phone
 * once there are five pills.
 */
export function FilterPills<T extends string>({
  tabs, active, onSelect, marginTop, flexible, pillWidth = 68, tourClass = '', buttonTourClass = '',
}: {
  tabs: { v: T; label: string }[];
  active: T;
  onSelect: (v: T) => void;
  marginTop: string;
  flexible?: boolean;
  /** Per-pill width budget. 68 suits one-word class names ("MF", "GOLD"); a row labelled with
   *  account names needs more, or every pill truncates to a few characters. Only ever a budget —
   *  `flexible` still caps the row at the container width, and the label ellipsises past that. */
  pillWidth?: number;
  tourClass?: string;
  buttonTourClass?: string;
}) {
  if (tabs.length < 2) return null;
  const N = tabs.length;
  const activeIdx = Math.max(0, tabs.findIndex(t => t.v === active));
  const PAD = 4;
  return (
    <div className={tourClass} style={{
      position: 'relative',
      display: 'flex',
      marginTop,
      padding: `${PAD}px`,
      // No backdrop-filter on the track or the thumb below: this row mounts fresh on every
      // entry into a category screen, so its backdrop snapshot isn't ready for the first
      // paint(s) and the control visibly flashed see-through before the blur applied. The
      // --pill-* tokens carry the frost as a static veil instead, correct from frame one.
      background: 'var(--pill-track-bg)',
      borderRadius: '999px',
      border: '1px solid var(--pill-track-border)',
      ...(flexible
        ? { width: '100%', maxWidth: `${N * pillWidth}px` }
        : { width: `${N * pillWidth}px` }),
    }}>
      <div style={{
        position: 'absolute',
        top: `${PAD}px`,
        bottom: `${PAD}px`,
        width: `calc((100% - ${PAD * 2}px) / ${N})`,
        left: `calc(${PAD}px + ${activeIdx} * (100% - ${PAD * 2}px) / ${N})`,
        borderRadius: '999px',
        background: 'var(--pill-thumb-bg)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.14)',
        transition: 'left 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)',
        pointerEvents: 'none'
      }} />
      {tabs.map(({ v, label }) => {
        const isActive = active === v;
        return (
          <button
            key={v}
            onClick={() => onSelect(v)}
            className={buttonTourClass}
            data-view={v}
            style={{
              flex: 1,
              minWidth: 0,
              position: 'relative',
              zIndex: 1,
              padding: '0.5rem 0',
              border: 'none',
              background: 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '999px',
              cursor: 'pointer',
              fontSize: '0.72rem',
              fontWeight: isActive ? 700 : 500,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              transition: 'color 0.28s ease',
              // Truncate rather than overflow: a label longer than its share of the row used to
              // spill across its neighbours, which read as two pills printed on top of each other.
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
