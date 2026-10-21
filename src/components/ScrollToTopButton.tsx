import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

/** How far down the screen has to be before the jump-to-top button appears. Roughly one
 *  screenful — below that the top is already a short flick away. */
const SCROLL_TOP_REVEAL_PX = 400;

/* Scroll-to-top affordance for the long lists (the ledger, Accounts). The scroll container is
   .app-root (App.tsx owns it and restores per-tab positions), not the screen using this — so the
   listener has to reach for it rather than use a local ref. */
export function ScrollToTopButton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const root = document.querySelector('.app-root');
    if (!root) return;
    const onScroll = () => setShow(root.scrollTop > SCROLL_TOP_REVEAL_PX);
    onScroll();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, []);

  return (
    /* Sits clear of the floating nav bar (which is 0.6rem + its own height off the bottom
        edge) and above the gesture bar. Jumps rather than animates: this is a "get me out of
        August" control, and a smooth scroll through 300 rows is a long way to watch. */
    /* Always mounted, never conditionally rendered: unmounting it the instant the scroll
        crosses back under the threshold cut the exit off mid-frame, which read as a jerk.
        Kept in the tree, both directions are the same transition played forwards or back,
        and it drops out of the tab order while hidden. */
    <button
      aria-label="Scroll to top"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      onClick={() => {
        const root = document.querySelector('.app-root');
        if (root) root.scrollTop = 0;
      }}
      style={{
        position: 'fixed',
        right: '1.25rem',
        bottom: 'calc(88px + var(--safe-area-inset-bottom))',
        width: '46px',
        height: '46px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-card-elevated)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        boxShadow: '3px 3px 0 #000',
        cursor: 'pointer',
        zIndex: 999,
        opacity: show ? 1 : 0,
        // Sinks toward the nav bar as it goes, so it reads as the button retiring rather
        // than the pixels simply switching off.
        transform: show ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.9)',
        pointerEvents: show ? 'auto' : 'none',
        transition: 'opacity 0.22s ease, transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <ArrowUp size={20} />
    </button>
  );
}
