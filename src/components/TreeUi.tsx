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
import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';
import { DetailHeroSeal, DETAIL_HERO_AVATAR } from './DetailHeroBackdrop';
import { userPossessive } from '../utils';
import { PRESS_CANCEL_PX } from '../hooks/useLongPress';

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
  /**
   * Whether the label is possessed by the user. Default true — "Tribhuvan's Statements", which is
   * how every hero in both trees reads.
   *
   * Set false for a label that already carries a possessive of its own. "My Cards" does, and
   * "Tribhuvan's My Cards" is not a phrase: the two possessives stack rather than compose. The name
   * is right on the tree's row, where it sits beside Statements and Rewards and the "my" is doing
   * real work, so the fix belongs here rather than in the category's name.
   */
  possessive?: boolean;
  children: ReactNode;
}> = ({ backdrop, label, minHeight, userName, possessive = true, children }) => (
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
        {possessive ? `${userPossessive(userName)} ${label}` : label}
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
  tabs, active, onSelect, marginTop, flexible, pillWidth = 68, scrollable, offsetY = 0,
  tourClass = '', buttonTourClass = '',
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
  /** Lets the row SCROLL when its pills no longer fit. See the note below — whether it actually
   *  scrolls is measured, not counted. */
  scrollable?: boolean;
  /** Nudge the row down (px) without moving anything around it. For a row inside a hero that
   *  centres its content in a fixed minHeight, where margin would push the rest of the hero
   *  around instead — see the note at the Statements call site. */
  offsetY?: number;
  tourClass?: string;
  buttonTourClass?: string;
}) {
  const N = tabs.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  // WHETHER THE ROW SCROLLS IS MEASURED, NOT COUNTED. It used to trip at a fixed number of tabs,
  // which is a guess about width dressed up as a rule: the same four pills fit on a tablet and do
  // not on a small phone, and a user with two cards got a scrolling row for no reason. The pills
  // divide the width while they fit at a readable size, and the moment their fixed width exceeds the
  // track they start scrolling instead.
  //
  // The track is 100% wide in BOTH modes, so its own clientWidth is the measurement and flipping
  // modes cannot change it — no feedback loop between the decision and the thing it decides.
  // PILLS ARE SIZED TO THEIR LABELS on a scrolling row, so both of those numbers are measured. One
  // width for every pill is right for a segmented control, where equal cells ARE the control — but
  // this row holds proper nouns of wildly different lengths, and a 92px cell made the highlight
  // skin-tight around SUPERMONEY and loose around ALL, with the gap between a highlight edge and the
  // next label swinging from 6px to 34px purely on how long that neighbour happened to be. With
  // each pill sized to its own label and a fixed padding, every gap is the same by construction.
  //
  // The cost is that N * pillWidth stops being the set width, so the wrap below and the
  // scroll-into-view have to read the DOM instead: the active pill's offsetLeft locates it, and a
  // GHOST copy supplies the set width.
  //
  // The ghost is not an optimisation, it is the only thing that can answer the question. Measuring a
  // real copy fails: while the pills fit they are stretched to divide the row, so a real copy is
  // always exactly as wide as the track and "do they fit?" answers itself yes forever. The ghost is
  // laid out as it would be when scrolling — never stretched — so it reports the natural width in
  // both modes. It is observed too, so a font landing late re-measures rather than leaving the row
  // wrapping at the wrong offset.
  const [trackW, setTrackW] = useState(0);
  const [setWidth, setSetWidth] = useState(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el || !scrollable) return;
    // Measured in the observer's callback rather than the effect body: ResizeObserver fires once the
    // moment it starts observing, so one path covers the first paint and every later resize.
    const ro = new ResizeObserver(() => {
      setTrackW(el.clientWidth);
      if (ghostRef.current) setSetWidth(ghostRef.current.offsetWidth);
    });
    ro.observe(el);
    if (ghostRef.current) ro.observe(ghostRef.current);
    return () => ro.disconnect();
  }, [scrollable, N]);
  const scrolls = !!scrollable && trackW > 0 && setWidth > trackW + 1;
  const activeIdxForScroll = Math.max(0, tabs.findIndex(t => t.v === active));

  /* Where the sliding thumb sits, on a measured-fit row that currently fits. Its cells are sized to
     their labels there (see the pill styles), so the `(100% - 2·PAD) / N` arithmetic the thumb used
     — which is only true of equal cells — would leave it the wrong width over the wrong pill. The
     pill itself is the only thing that knows, so it is asked. Re-measured on resize, since a label's
     share of the slack moves with the track. Null until the first measurement lands, and until then
     the thumb falls back to the equal-cell arithmetic, which is still exactly right for the plain
     fixed rows that never opted into measuring. */
  const [thumbBox, setThumbBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = trackRef.current;
    // Every row that shows a thumb at all, since all of them are label-sized now — the same
    // condition the pill styles branch on, and it has to stay that way: a thumb still doing the
    // equal-cell arithmetic over label-sized pills lands the wrong width in the wrong place.
    if (!el || scrolls) {
      /* Measuring the DOM and storing the result is the one thing a layout effect is for, and there
         is no earlier moment to do it: the pill's width is decided by the browser laying out its
         label, which has not happened until this runs. The cascade the rule warns about is the point
         here — it is flushed before paint, so the thumb is never seen at the wrong width. */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setThumbBox(null);
      return;
    }
    const measure = () => {
      const pill = el.querySelector<HTMLElement>(`button[data-view="${CSS.escape(active)}"]`);
      if (pill) setThumbBox({ left: pill.offsetLeft, width: pill.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrolls, active, N]);

  // ENDLESS ROW. The pills are laid out THREE times over and the view is parked in the middle copy;
  // whenever scrolling carries it into the first or last copy, scrollLeft jumps by exactly one set.
  // The jump is invisible because the copies are identical — the pill under your finger is the same
  // pill at the same offset — so the row reads as a ring with no ends to hit.
  //
  // Three copies, not two: one set of slack is needed on EACH side, or a fast flick can outrun the
  // wrap and reach a real edge before the scroll handler fires.
  //
  // Only when the set is actually wider than the view. A row whose pills all fit has nothing to
  // wrap around, and three copies of it would just print the same pills again.
  // Looping needs no measurement of its own: `scrolls` is already "the set is wider than the track",
  // which is exactly the condition under which there is something to wrap around.
  const loops = scrolls;

  // Keep the selection in view. Selecting a pill that is half off the edge otherwise leaves the
  // highlight where it cannot be seen, and arriving on a screen whose saved filter is the last card
  // shows a row that looks like nothing is selected. When the row loops, scroll to whichever COPY of
  // the selected pill is nearest — going the short way round is the whole point of a ring.
  useEffect(() => {
    if (!scrolls) return;
    const el = trackRef.current;
    if (!el) return;
    // Read from the pill itself rather than computed from an index: with variable widths there is no
    // arithmetic that gets there. Every copy carries the same data-view, so querySelectorAll gives
    // the same pill in each, and the copies are one setWidth apart.
    const pills = el.querySelectorAll<HTMLElement>(`button[data-view="${CSS.escape(active)}"]`);
    if (!pills.length) return;
    const centred = (pill: HTMLElement) => pill.offsetLeft - (el.clientWidth - pill.offsetWidth) / 2;
    const candidates = [...pills].map(centred);
    const nearest = candidates.reduce((a, b) => (Math.abs(b - el.scrollLeft) < Math.abs(a - el.scrollLeft) ? b : a));
    el.scrollTo({ left: loops ? nearest : Math.max(0, nearest), behavior: 'smooth' });
  }, [scrolls, loops, active, activeIdxForScroll, setWidth]);

  // The wrap itself. Parks the view in the middle copy on the first measure, then keeps it there.
  useEffect(() => {
    if (!loops) return;
    const el = trackRef.current;
    if (!el) return;
    if (el.scrollLeft < setWidth * 0.5) el.scrollLeft += setWidth;
    const onScroll = () => {
      // No re-entry guard needed: assigning scrollLeft fires scroll again, but by then the value is
      // back inside the middle copy and both tests are false.
      if (el.scrollLeft < setWidth * 0.5) el.scrollLeft += setWidth;
      else if (el.scrollLeft > setWidth * 1.5) el.scrollLeft -= setWidth;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [loops, setWidth]);

  // A trackpad's natural gesture over this row is a VERTICAL two-finger swipe, and on an
  // overflow-x container that scrolls the page instead — the row reads as stuck even though it is
  // scrollable. Translating the vertical delta fixes that. Registered natively rather than through
  // onWheel because React attaches wheel listeners passively, and a passive listener cannot
  // preventDefault.
  useEffect(() => {
    if (!scrolls) return;
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // A deliberate sideways swipe already works; only take over the vertical one.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY;
      // Only swallow the gesture if the row actually moved, so that reaching either end hands
      // scrolling back to the page rather than trapping it here.
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scrolls]);

  // DRAG the row. Touch already scrolls it natively, and a wheel now does too, but a press-and-drag
  // — with a mouse, or a trackpad click held down — did nothing, and that is the gesture people try
  // on a row that visibly continues past its edge. Pointer events cover all three inputs at once.
  //
  // The click-suppression is the fiddly half: without it, letting go at the end of a drag lands as a
  // tap on whichever pill is under the cursor and switches the filter you were scrolling to reach.
  // Anything past a few pixels of travel counts as a drag and swallows the click that follows it.
  useEffect(() => {
    if (!scrolls) return;
    const el = trackRef.current;
    if (!el) return;
    let startX = 0;
    let startLeft = 0;
    let dragging = false;
    let moved = 0;
    // Set only when a drag has just ENDED, and consumed by the very next click. Testing `moved`
    // directly instead left the distance sitting there after the pointer came up, so the next click
    // to arrive was swallowed even if it had nothing to do with the drag — a synthetic click, or a
    // keyboard Enter on a focused pill, both of which reach the element without a pointerdown to
    // reset the counter.
    let swallowNextClick = false;

    const onDown = (e: PointerEvent) => {
      // Touch is left to the browser: it already scrolls this row, with momentum we would lose.
      if (e.pointerType === 'touch') return;
      dragging = true;
      moved = 0;
      swallowNextClick = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      if (moved > 3) {
        el.scrollLeft = startLeft - dx;
        e.preventDefault();
      }
    };
    const onUp = () => {
      if (dragging && moved > PRESS_CANCEL_PX) swallowNextClick = true;
      dragging = false;
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowNextClick) return;
      swallowNextClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    el.addEventListener('pointerdown', onDown);
    // On window, so a drag that leaves the row keeps scrolling and still ends cleanly.
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClick, true);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.removeEventListener('click', onClick, true);
    };
  }, [scrolls]);

  if (tabs.length < 2) return null;
  const activeIdx = Math.max(0, tabs.findIndex(t => t.v === active));
  const PAD = 4;
  // One pass over the tabs, or three when the row loops. Each pass is wrapped so its width can be
  // measured directly — with pills sized to their labels there is no formula for it.
  const copies = loops ? [0, 1, 2] : [0];
  return (
    <div className={tourClass} style={{
      position: 'relative',
      // Rides on the `relative` the thumb and the ghost already need, so the row shifts with its
      // own absolute children and nothing around it reflows.
      ...(offsetY ? { top: `${offsetY}px` } : {}),
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
      ...(scrollable
        ? {
          width: '100%',
          overflowX: scrolls ? ('auto' as const) : ('visible' as const),
          overflowY: 'hidden' as const,
          scrollbarWidth: 'none' as const,
        }
        : flexible
          ? { width: '100%', maxWidth: `${N * pillWidth}px` }
          : { width: `${N * pillWidth}px` }),
    }}
      ref={trackRef}
      // Hides the scrollbar in WebKit, which cannot be done from an inline style.
      data-pill-scroll={scrolls ? '' : undefined}
    >
      {/* The sliding thumb belongs to the FIXED row only. On a scrolling row it was already
          positioned in scrolled coordinates rather than sliding meaningfully, and on a LOOPING one it
          cannot exist at all: the selected pill appears three times, and a thumb animating its `left`
          across a wrap would streak the length of the row every time the view jumped a copy. There
          the highlight is the pill's own background — the same tokens, so it looks identical — which
          is simply drawn on whichever copies are on screen. */}
      {!scrolls && (
        <div style={{
          position: 'absolute',
          top: `${PAD}px`,
          bottom: `${PAD}px`,
          ...(thumbBox
            ? { left: `${thumbBox.left}px`, width: `${thumbBox.width}px` }
            : {
              width: `calc((100% - ${PAD * 2}px) / ${N})`,
              left: `calc(${PAD}px + ${activeIdx} * (100% - ${PAD * 2}px) / ${N})`,
            }),
          borderRadius: '999px',
          background: 'var(--pill-thumb-bg)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.14)',
          // `width` joins the slide now that the thumb resizes to the pill it lands on. Same curve,
          // so the two read as one movement rather than a slide with a stretch bolted on.
          transition: 'left 0.38s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)',
          pointerEvents: 'none'
        }} />
      )}
      {/* Off the flow and out of the tree for anything that reads the page: it exists to be
          measured. Its typography must match a real pill exactly or the measurement is fiction. */}
      {scrollable && (
        <div
          ref={ghostRef}
          aria-hidden="true"
          style={{
            position: 'absolute', top: 0, left: 0, display: 'flex',
            visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap',
          }}
        >
          {tabs.map(({ v, label }) => (
            <span
              key={v}
              style={{
                flex: 'none', padding: '0.5rem 0.95rem', maxWidth: '170px', overflow: 'hidden',
                fontSize: '0.72rem', fontWeight: 700, fontFamily: 'var(--font-mono)',
                letterSpacing: '1px', textTransform: 'uppercase',
              }}
            >
              {label}
            </span>
          ))}
        </div>
      )}
      {copies.map(copy => (
        <div
          key={copy}
          style={{ display: 'flex', flex: scrolls ? 'none' : 1, minWidth: 0 }}
        >
      {tabs.map(({ v, label }) => {
        const isActive = active === v;
        return (
          <button
            key={v}
            onClick={() => onSelect(v)}
            className={buttonTourClass}
            data-view={v}
            style={{
              ...(scrolls
                // Sized to the label, with the padding that makes every gap between two labels the
                // same: 2 × padding, whatever those labels happen to be. Capped, because one
                // absurdly long card name should truncate rather than push the row off the ring.
                ? { flex: 'none', padding: '0.5rem 0.95rem', maxWidth: '170px' }
                /* EVERY row that isn't scrolling, whichever width mode it is in. `flex: 1` here
                   meant equal cells, which put the label-sizing argument above into reverse: a
                   short label floated in the middle of a wide cell while a long one nearly filled
                   its own, so the whitespace around a label was set by the length of that label
                   instead of being constant. Wealth's Assets row ran 21.8px from the track's left
                   edge to ALL against 13.8px from OTHER to its right edge, with the gaps between
                   stepping 37.7 / 33.6 / 21.5 / 17.4 — every one different.
                   `1 1 auto` keeps the label-sized base and lets every pill grow from it by an
                   EQUAL share of the slack (equal grow factors divide free space N ways). Each
                   label then carries `padding + share/2` on both sides, so the two track edges
                   match and every label-to-label gap matches, exactly as they do when the row
                   scrolls.
                   This was gated on `scrollable` when the Statements row was fixed, which left
                   both of Wealth's rows behind — Assets on the `flexible` branch and Portfolio on
                   the plain fixed one. There is no mode in which equal cells were the right answer,
                   so the three branches are now one.

                   The padding is the one thing that still has to know which mode it is in, because
                   it is a MINIMUM and the two modes have very different room for it. A scrollable
                   row's track is the full width, so 0.95rem is free. A width-budgeted row's is
                   `N × pillWidth`, and 0.95rem a side leaves a 68px budget only 37.6px of label —
                   enough to ellipsise WALLETS, and enough to push the row's own base past the
                   track, at which point the pills SHRINK proportionally rather than grow equally
                   and the whole point is lost. (Measured: it clipped four of the five Assets pills
                   and left Portfolio's edges 16.2 against 8.8.) Half that keeps every current
                   label whole with slack to spare. */
                : { flex: '1 1 auto', minWidth: 0, padding: scrollable ? '0.5rem 0.95rem' : '0.5rem 0.5rem' }),
              position: 'relative',
              zIndex: 1,
              border: 'none',
              background: scrolls && isActive ? 'var(--pill-thumb-bg)' : 'transparent',
              boxShadow: scrolls && isActive ? '0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.14)' : 'none',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '999px',
              cursor: 'pointer',
              fontSize: '0.72rem',
              // CONSTANT on a scrolling row. Bold is wider than regular, so a weight that changed
              // with selection would resize the pill under the tap — shunting every pill after it
              // sideways and invalidating the set width the wrap depends on. The raised background
              // and the text colour carry the selection there instead.
              fontWeight: scrolls ? 700 : (isActive ? 700 : 500),
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
      ))}
    </div>
  );
}

/**
 * LABEL · count · rule · trailing · chevron — the heading over a collapsible group.
 *
 * Lifted out of Wealth when the Statements list grew financial-year groups. The comment it arrived
 * with said "one definition on purpose", and that had already stopped being true the moment a second
 * screen wanted the same header: a hand-rolled copy in CreditCards would have drifted from this one
 * exactly the way Wealth's own "Recent Activity" heading once did.
 *
 * `count` of null drops the number entirely — for a heading over a list the user can't collapse or
 * filter, where it says nothing the rows below don't. An EMPTY label does the reverse and leaves the
 * count to head the row on its own: when a filter has already narrowed the screen to one section,
 * repeating that section's name under the pill that selected it spends width the trailing controls
 * need, and on a narrow phone it pushed them off the edge.
 *
 * A count is always separated by a MIDDOT and named by `countNoun`. Bare, set close to the label, it
 * reads as part of the label rather than as a quantity — "Bank Accounts 11" survives that because
 * the label already says what is being counted, but "FY 26-27 5" does not, and the reader is left
 * asking five of what. The dot buys the distinction and the noun answers the question.
 */
export const SectionHeading: React.FC<{
  label: string;
  count: number | null;
  /** Singular; pluralised by appending an s, which is all any caller here needs. */
  countNoun?: string;
  trailing?: ReactNode;
  chevron?: ReactNode;
  onClick?: () => void;
  marginBottom?: string | number;
}> = ({ label, count, countNoun, trailing, chevron, onClick, marginBottom }) => (
  <div
    // Tighter gap only when something trails the rule: label + count + rule + pill is a lot for a
    // narrow phone, and this row is the one place here that can't wrap.
    className={`flex align-center ${trailing ? 'gap-2' : 'gap-3'}`}
    style={{ cursor: onClick ? 'pointer' : 'default', userSelect: 'none', marginBottom: marginBottom ?? '0.25rem' }}
    onClick={onClick}
  >
    {label && (
      <span className="text-mono uppercase" style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '1.5px', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    )}
    {count !== null && (
      // The separator belongs to the LABEL, not to the count: with no label there is nothing to
      // separate the count from, and a leading middot reads as a bullet point.
      <span className="text-mono uppercase" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: label ? 0.6 : 0.85, whiteSpace: 'nowrap', letterSpacing: label ? undefined : '1.5px' }}>
        {label ? '· ' : ''}{count}{countNoun ? ` ${count === 1 ? countNoun : `${countNoun}s`}` : ''}
      </span>
    )}
    {/* minWidth keeps the rule from collapsing to nothing when a long label and the trailing slot
        share the row on a narrow phone — it shrinks, but stays a visible connector. */}
    <div style={{ flex: 1, minWidth: '10px', height: '1px', background: 'var(--border-color)', opacity: 0.5 }} />
    {trailing}
    {chevron}
  </div>
);
