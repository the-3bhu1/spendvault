// ── The Credit Cards tree ────────────────────────────────────────────────────────────────────────
//
// Second tree in the app, built on the same three levels as Wealth: a root screen with an
// illustrated hero and category cards, a sub-view per category, and a detail screen per card. The
// shared pieces come from TreeUi; the navigation machinery below (scroll memory, the back chain,
// auto-exit) is deliberately the same shape as Wealth's, because a user who has learned one tree
// should not have to learn the other.
//
// Every figure on every level comes from CardDuesService. That's the point of the service: the
// Dashboard tile, this hero, these rows and the Bills screen cannot disagree about what a card owes.
//
// Phase 1 ships the tree and Dues. Statements, Rewards and My Cards get their rows when their
// screens exist — an empty category is a dead end, and Wealth's tree already refuses to show one.
// A Dues row opens the existing statement modal for now: that modal is exactly what Level 3 will
// absorb, so the destination is right even though it isn't a screen yet.
import { useState, useEffect, useMemo, useRef } from 'react';
import { CreditCard } from 'lucide-react';
import { useFinance } from '../FinanceContext';
import type { Account } from '../types';
import { formatCurrency, resolveCardIssuer, userPossessive, getOrdinalSuffix } from '../utils';
import { getActiveCardDues, sumCardDues, type CardDues } from '../services/CardDuesService';
import { CategoryCard, CategoryHero, SubviewHeader, FilterPills } from './TreeUi';
import { CardsBackdrop, DuesBackdrop } from './CardsBackdrops';
import { CardBrandLogo } from './CardBrandLogo';
import { LogoAvatar } from './LogoAvatar';
import { getLiquidLogoUrl } from '../services/LogoService';
import ProfileAvatar from './ProfileAvatar';

type CardsCategory = 'dues';

/** Whole rupees for the root screen and the category cards — paise are noise on a summary, and
 *  Wealth's tree makes the same call. Every inner figure uses formatCurrency so it reconciles
 *  digit-for-digit with Accounts. */
const formatWhole = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

/** How close to the due date a bill has to be before the figure turns urgent. Same three days as
 *  the bill-alert banner, so the two can't disagree about what "soon" means. */
const URGENCY_DAYS = 3;

const dueColor = (d: CardDues) =>
  d.billed <= 0 ? 'var(--text-secondary)'
    : d.daysToDue !== undefined && d.daysToDue <= URGENCY_DAYS ? 'var(--danger)'
      : 'var(--warning)';

/** "In 3 days" / "Due today" / "5 days overdue" — the same phrasing the Bills screen uses. */
const duePhrase = (d: CardDues) => {
  if (d.daysToDue === undefined) return null;
  if (d.daysToDue < 0) return `${Math.abs(d.daysToDue)}d overdue`;
  if (d.daysToDue === 0) return 'Due today';
  return `In ${d.daysToDue} day${d.daysToDue === 1 ? '' : 's'}`;
};

export default function CreditCards({ onViewStatement }: { onViewStatement: (acc: Account) => void }) {
  const { data } = useFinance();
  const [category, setCategory] = useState<CardsCategory | null>(null);
  const [duesFilter, setDuesFilter] = useState<string>('all');
  // Where each level was scrolled to, so backing out of one lands where it was left rather than at
  // the top. Same two-slot memory as Wealth's.
  const scrollRef = useRef<{ tree: number; category: number }>({ tree: 0, category: 0 });

  const dues = useMemo(
    () => getActiveCardDues(data.accounts, data.transactions),
    [data.accounts, data.transactions]
  );
  const totals = useMemo(() => sumCardDues(dues), [dues]);

  const hasCards = dues.length > 0;
  // Derived rather than synced: archiving the last card while a sub-view is open has to put the user
  // back on the tree, and reading it here does that on the same render instead of through an effect
  // that fires afterwards. (If the card comes back while this tab is still mounted, the sub-view
  // comes back with it — it was never left deliberately.)
  const activeCategory = hasCards ? category : null;
  const possessive = userPossessive(data.user?.name);

  // The card whose bill lands first and still has something on it. Nothing to say when every
  // statement is settled — and "next due" on a paid-off set of cards would be a date with no bill.
  const nextDue = dues.find(d => d.billed > 0 && d.daysToDue !== undefined) ?? null;

  const openCategory = (next: CardsCategory) => {
    const appRoot = document.querySelector('.app-root');
    scrollRef.current.tree = appRoot?.scrollTop ?? 0;
    // Dropped on the way IN, kept on the way back from a detail screen: the remembered position
    // belongs to one visit down and back, not to the next entry from the tree.
    scrollRef.current.category = 0;
    setDuesFilter('all');
    setCategory(next);
  };

  useEffect(() => {
    const handleBack = (e: Event) => {
      // Unwinds one level at a time. The statement modal is unwound by App before this event is even
      // dispatched, so by the time we see it the innermost level open here is the sub-view.
      if (activeCategory) {
        e.preventDefault();
        setCategory(null);
      }
    };
    window.addEventListener('appBackButton', handleBack);
    return () => window.removeEventListener('appBackButton', handleBack);
  }, [activeCategory]);

  useEffect(() => {
    const appRoot = document.querySelector('.app-root');
    if (!appRoot) return;
    appRoot.scrollTo({ top: activeCategory ? scrollRef.current.category : scrollRef.current.tree, behavior: 'auto' });
  }, [activeCategory]);

  // A card whose issuer resolves gets its real mark; anything else falls back to the brand-domain
  // favicon, and then to initials inside LogoAvatar. resolveCardIssuer reads the card's saved
  // details first and its name second, so a co-branded card shows the co-brand rather than the bank.
  const renderCardMark = (account: Account, size: number) => {
    const issuer = resolveCardIssuer(account.name, account.cardDetails);
    if (issuer) {
      // A LANDSCAPE box, and `fit` rather than a height. CardBrandLogo's default sizing is optical
      // height with width:auto, which is right on a card face and wrong in a fixed tile: a wide
      // wordmark (AXIS BANK, HDFC BANK) grew sideways out of the tile and printed over the account
      // name beside it. `fit` scales the artwork to the box with 'meet', and overflow:hidden is the
      // backstop. The proportions are a card's own, which suits the subject.
      const w = Math.round(size * 1.35);
      return (
        <div
          className="flex-center"
          style={{
            width: `${w}px`, height: `${size}px`, flexShrink: 0,
            borderRadius: '4px',
            background: 'var(--bg-card-elevated)',
            border: '1px solid var(--border-color)',
            boxShadow: '3px 3px 0 #000',
            padding: '5px 7px', boxSizing: 'border-box', overflow: 'hidden',
          }}
        >
          <CardBrandLogo brand={issuer} fit />
        </div>
      );
    }
    return <LogoAvatar name={account.name} logoUrl={getLiquidLogoUrl(account)} size={size} accountType={account.type} />;
  };

  /** The utilization meter. A BAR rather than an arc: the backdrop behind it is concentric about the
   *  same centre, and a second ring there competes with the engraving instead of reading on it.
   *
   *  Takes the FRACTION already computed by sumCardDues rather than recomputing it from a total.
   *  Dividing the grand outstanding by the summed limit overstates the ratio whenever a card
   *  declares no limit, because its balance is in the numerator and its (absent) limit is not —
   *  which is the whole reason DuesTotals.utilization exists. */
  const renderUtilization = (fraction: number, limit: number) => {
    const pct = Math.min(1, Math.max(0, fraction));
    // Colour by how much of the line is gone, not by whether a bill is due — this is a measure of
    // headroom, and 90% used is worth flagging even on a freshly paid card.
    const tone = pct >= 0.9 ? 'var(--danger)' : pct >= 0.5 ? 'var(--warning)' : 'var(--success)';
    return (
      <div style={{ width: '78%', maxWidth: '260px', marginTop: '1rem' }}>
        <div style={{ height: '4px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct * 100}%`, background: tone, transition: 'width 0.4s ease' }} />
        </div>
        <div className="text-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '1px', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
          {Math.round(pct * 100)}% of {formatWhole(limit)} limit
        </div>
      </div>
    );
  };

  /** Billed and unbilled as two mono-labelled figures. The pair appears on both levels, so it's
   *  built once — the hero above it changes, the split does not. */
  const renderSplit = (billed: number, unbilled: number) => (
    <div className="flex justify-center" style={{ gap: '2rem', marginTop: '1rem' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="text-mono uppercase" style={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: '1px', color: 'var(--text-muted)' }}>Billed</div>
        <div className="text-serif" style={{ fontSize: '1.05rem', fontWeight: 700, color: billed > 0 ? 'var(--text-primary)' : 'var(--text-secondary)', marginTop: '0.15rem' }}>
          {formatWhole(billed)}
        </div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div className="text-mono uppercase" style={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: '1px', color: 'var(--text-muted)' }}>Unbilled</div>
        <div className="text-serif" style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
          {formatWhole(unbilled)}
        </div>
      </div>
    </div>
  );

  const duesShown = duesFilter === 'all' ? dues : dues.filter(d => d.account.id === duesFilter);

  return (
    <div style={{ background: 'var(--bg-primary)', paddingBottom: '100px' }}>
      {/* ───────────────────────── Level 1: the tree ───────────────────────── */}
      {!activeCategory && (
        <>
          {/* position/overflow for the backdrop, which is absolutely positioned to this box and
              bleeds past the horizontal padding. minHeight gives the square drawing room to render
              at full size, and the centring is what lands the hero's stack on the card plate — see
              COMPOSITION in relief.tsx. */}
          <div className="tour-cards-summary" style={{ position: 'relative', overflow: 'hidden', minHeight: '400px', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            <CardsBackdrop />

            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
              <ProfileAvatar size={64} />
              <div className="text-mono uppercase" style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '2px', color: 'var(--text-primary)', opacity: 0.85, margin: '1rem 0 0.75rem' }}>
                {possessive} Cards
              </div>

              <div className="text-serif" style={{ fontSize: '2.75rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                {formatWhole(totals.outstanding)}
              </div>

              {!hasCards ? null : (
                <>
                  {renderSplit(totals.billed, totals.unbilled)}
                  {totals.utilization !== undefined && renderUtilization(totals.utilization, totals.creditLimit)}
                  {nextDue && (
                    <div className="text-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.5px', color: dueColor(nextDue), marginTop: '1rem' }}>
                      Next due {nextDue.dueDayStr} · {nextDue.account.name}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {!hasCards ? (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <CreditCard size={48} style={{ opacity: 0.5, margin: '0 auto 1rem' }} />
              <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No cards yet</div>
              <div style={{ fontSize: '0.9rem' }}>Add a credit card from the Accounts tab to track its dues here</div>
            </div>
          ) : (
            <div className="tour-cards-categories" style={{ padding: '0.5rem 0 0', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <CategoryCard
                icon={<CreditCard size={20} />}
                iconColor="var(--warning)"
                label="Dues"
                subtext="Billed & unbilled"
                value={formatWhole(totals.outstanding)}
                valueNote={nextDue ? (
                  <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, marginTop: '0.3rem', letterSpacing: '0.5px', color: dueColor(nextDue) }}>
                    {duePhrase(nextDue)}
                  </div>
                ) : (
                  <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, marginTop: '0.3rem', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
                    All settled
                  </div>
                )}
                onClick={() => openCategory('dues')}
                tourClass="tour-cards-cat-dues"
              />
            </div>
          )}
        </>
      )}

      {/* ───────────────────────── Level 2: Dues ───────────────────────── */}
      {activeCategory === 'dues' && (
        <div className="fade-in">
          <SubviewHeader title="Cards" onBack={() => setCategory(null)} hideTitle />

          <CategoryHero backdrop={<DuesBackdrop />} label="Dues" minHeight="360px" userName={data.user?.name}>
            <div className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              {formatCurrency(totals.outstanding)}
            </div>
            {renderSplit(totals.billed, totals.unbilled)}
            {/* One pill per card, plus All. Below two cards the row disappears on its own — a lone
                All pill filters nothing. */}
            <FilterPills
              tabs={[
                { v: 'all', label: 'All' },
                // The card's own first word — "Swiggy", not "Swiggy x HDFC". The issuer is on the
                // row's mark a few pixels below, so repeating it in the pill spends width twice.
                ...dues.map(d => ({ v: d.account.id, label: d.account.name.split(/[ ×x]/)[0] })),
              ]}
              active={duesFilter}
              onSelect={setDuesFilter}
              marginTop="1.25rem"
              flexible
              pillWidth={92}
            />
          </CategoryHero>

          <div style={{ padding: '0.5rem 1.5rem calc(1.5rem + var(--safe-area-inset-bottom))' }}>
            {duesShown.map(d => (
              // A card at ₹0 keeps its row: its cut and due dates are information, and a card that
              // vanished when it was paid off would read as a card that had gone missing.
              <div
                key={d.account.id}
                onClick={() => onViewStatement(d.account)}
                className="clickable"
                style={{
                  padding: '1rem 0',
                  borderBottom: '1px solid var(--border-color)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.9rem'
                }}
              >
                {renderCardMark(d.account, 38)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                    {d.account.name}
                  </div>
                  <div className="text-mono uppercase" style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.2rem', letterSpacing: '0.5px' }}>
                    Cut {getOrdinalSuffix(d.account.statementDay || 1)}
                    {d.dueDayStr ? ` · Due ${d.dueDayStr}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: d.outstanding > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {formatCurrency(d.outstanding)}
                  </div>
                  {d.billed > 0 ? (
                    <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, color: dueColor(d), marginTop: '0.2rem', letterSpacing: '0.5px' }}>
                      {formatCurrency(d.billed)} billed
                    </div>
                  ) : (
                    <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: '0.2rem', letterSpacing: '0.5px' }}>
                      Nothing billed
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Level 3, the per-card detail screen, is Phase 3 — see the note at the top of this file. */}
    </div>
  );
}
