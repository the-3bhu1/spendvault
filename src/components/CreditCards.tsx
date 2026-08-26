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
// Statements, Rewards and My Cards get their rows when their screens exist — an empty category is a
// dead end, and Wealth's tree already refuses to show one.
//
// Level 3 is the statement, on a screen. The modal AccountStatement still exists and Accounts still
// opens it: that entry point has nothing to do with this tree, and forcing it through three levels of
// navigation to reach one card would be worse than leaving it alone. What the two must not do is
// disagree, which is why the ledger rows and the long-press move are one implementation shared from
// CycleMove / useCycleMove rather than a copy.
import { useState, useEffect, useMemo, useRef } from 'react';
import { CreditCard, FileText, Gift } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '../FinanceContext';
import type { Account } from '../types';
import {
  formatCurrency, resolveCardIssuer, userPossessive, getOrdinalSuffix,
  getBillingCycleForDate, formatBillingCycleRange, getAppliedBillingCycle, affectsRupeeBalance,
} from '../utils';
import { getActiveCardDues, getCardCycleFigures, sumCardDues, type CardDues } from '../services/CardDuesService';
import { buildRewardRows, summarisePendingRewards } from '../services/RewardsService';
import Cashback from './Cashback';
import { CategoryCard, CategoryHero, SubviewHeader, SealedMark, FilterPills } from './TreeUi';
import { DetailHeroBand, DETAIL_HERO_AVATAR, DETAIL_HERO_LIFT } from './DetailHeroBackdrop';
import { useCycleMove } from '../hooks/useCycleMove';
import { CycleLedgerRow, CycleMoveSheet, CycleMoveToast } from './CycleMove';
import { CardsBackdrop, DuesBackdrop, StatementsBackdrop, RewardsBackdrop } from './CardsBackdrops';
import { CardBrandLogo } from './CardBrandLogo';
import { LogoAvatar } from './LogoAvatar';
import { getLiquidLogoUrl } from '../services/LogoService';
import ProfileAvatar from './ProfileAvatar';

type CardsCategory = 'dues' | 'statements' | 'rewards';

/** What each category is called, on its row, its hero and the detail screen's header. */
const CATEGORY_LABELS: Record<CardsCategory, string> = { dues: 'Dues', statements: 'Statements', rewards: 'Rewards' };

/** One closed statement: what a card billed for one cycle that has already been cut. */
interface ClosedStatement {
  account: Account;
  cycle: string;
  /** The printed figure — payable put through the card's rounding rule. */
  amount: number;
  count: number;
}

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

export default function CreditCards() {
  const { data } = useFinance();
  const [category, setCategory] = useState<CardsCategory | null>(null);
  const [duesFilter, setDuesFilter] = useState<string>('all');
  const [statementsFilter, setStatementsFilter] = useState<string>('all');
  // Level 3: which card's statement is open, and which of its cycles. The card is held by ID rather
  // than as an object so the screen reads today's figures — an Account captured on open would keep
  // whatever balance and dues it had at that moment while transactions carried on being logged.
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<string | null>(null);
  // Where each level was scrolled to, so backing out of one lands where it was left rather than at
  // the top. Same two-slot memory as Wealth's — the detail screen always opens at the top, so it
  // needs no slot of its own.
  const scrollRef = useRef<{ tree: number; category: number }>({ tree: 0, category: 0 });
  const cycleMove = useCycleMove();

  const dues = useMemo(
    () => getActiveCardDues(data.accounts, data.transactions),
    [data.accounts, data.transactions]
  );
  const totals = useMemo(() => sumCardDues(dues), [dues]);

  // Every cycle that has been CUT, newest first. The open cycle is excluded on purpose: it has no
  // printed statement, its figure moves with every charge, and it is the whole subject of Dues.
  // Cycles are 'YYYY-MM', so the string comparison below is a date comparison — which also drops a
  // charge moved beyond the open cycle, since a statement that hasn't been cut can't be listed.
  const statements = useMemo<ClosedStatement[]>(() => {
    const out: ClosedStatement[] = [];
    const today = format(new Date(), 'yyyy-MM-dd');
    for (const { account } of dues) {
      const statementDay = account.statementDay || 1;
      const openCycle = getBillingCycleForDate(today, statementDay);
      const counts = new Map<string, number>();
      for (const t of data.transactions) {
        if (t.accountId !== account.id) continue;
        if (!affectsRupeeBalance(t)) continue;
        const c = getAppliedBillingCycle(t, statementDay);
        if (c >= openCycle) continue;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      for (const [cycle, count] of counts) {
        out.push({ account, cycle, amount: getCardCycleFigures(account, data.transactions, cycle).statementAmount, count });
      }
    }
    // Newest cycle first, and within a cycle by card name, so a month's statements sit together.
    return out.sort((a, b) => b.cycle.localeCompare(a.cycle) || a.account.name.localeCompare(b.account.name));
  }, [dues, data.transactions]);

  // What the cards have earned but not yet paid out. Same derivation the vault screen uses — the row
  // and the hero here would drift from it within one change otherwise.
  const rewards = useMemo(() => {
    const rows = Object.values(buildRewardRows(data.transactions, data.accounts, data.cashbackStatements));
    return { rows, pending: summarisePendingRewards(rows, data.accounts) };
  }, [data.transactions, data.accounts, data.cashbackStatements]);

  const hasCards = dues.length > 0;
  // Derived rather than synced: archiving the last card while a sub-view is open has to put the user
  // back on the tree, and reading it here does that on the same render instead of through an effect
  // that fires afterwards. (If the card comes back while this tab is still mounted, the sub-view
  // comes back with it — it was never left deliberately.)
  const activeCategory = hasCards ? category : null;
  // Derived, not synced: a card archived or deleted while its statement was open has to put the user
  // back on the sub-view, and reading it here does that on the same render rather than through an
  // effect that fires afterwards.
  const activeCard = selectedCardId ? dues.find(d => d.account.id === selectedCardId) ?? null : null;
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
    setStatementsFilter('all');
    setCategory(next);
  };

  /** Opens one card's statement. `cycle` of undefined means the cycle still accruing — which is what
   *  a Dues row is about. Statements passes a closed one, because that's what it lists. */
  const openCard = (account: Account, cycle?: string) => {
    const appRoot = document.querySelector('.app-root');
    scrollRef.current.category = appRoot?.scrollTop ?? 0;
    setSelectedCycle(cycle ?? null);
    setSelectedCardId(account.id);
  };

  // The tour can navigate tabs on its own; it cannot navigate a tree. This lets a tour step open (or
  // close) one of the categories so it has something to point at — the same mechanism the splits tour
  // uses to close a detail view. setState in a listener, not in an effect body: this is a signal from
  // outside React, which is exactly what an effect subscription is for.
  useEffect(() => {
    const handleTourCategory = (e: Event) => {
      const next = (e as CustomEvent<CardsCategory | null>).detail ?? null;
      setSelectedCardId(null);
      setCategory(next);
    };
    window.addEventListener('tour-cards-category', handleTourCategory);
    return () => window.removeEventListener('tour-cards-category', handleTourCategory);
  }, []);

  useEffect(() => {
    const handleBack = (e: Event) => {
      // Unwinds one level at a time, innermost first: statement → sub-view → tree. The move sheet is
      // a .modal-overlay and closes itself before this fires.
      if (activeCard) {
        e.preventDefault();
        setSelectedCardId(null);
      } else if (activeCategory) {
        e.preventDefault();
        setCategory(null);
      }
    };
    window.addEventListener('appBackButton', handleBack);
    return () => window.removeEventListener('appBackButton', handleBack);
  }, [activeCategory, activeCard]);

  useEffect(() => {
    const appRoot = document.querySelector('.app-root');
    if (!appRoot) return;
    // Descending starts at the top; coming back restores that level's saved position.
    const top = activeCard ? 0 : activeCategory ? scrollRef.current.category : scrollRef.current.tree;
    appRoot.scrollTo({ top, behavior: 'auto' });
  }, [activeCategory, activeCard]);

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
  const statementsShown = statementsFilter === 'all' ? statements : statements.filter(st => st.account.id === statementsFilter);
  // The hero's figure is the sum of what's LISTED, which is what makes the pill row mean something:
  // narrowing to one card narrows the total with it. A cross-card aggregate that ignored the filter
  // would be a number the screen shows but the screen can't explain.
  const statementsTotal = statementsShown.reduce((sum, st) => sum + st.amount, 0);
  // Only cards that actually have a closed statement get a pill — a pill that filters to an empty
  // list is a dead end with extra steps.
  const statementCardIds = Array.from(new Set(statements.map(st => st.account.id)));
  // The units that don't already lead the Rewards hero.
  const unitLines = rewards.pending.byUnit.slice(rewards.pending.rupees > 0 ? 0 : 1);

  return (
    <div style={{ background: 'var(--bg-primary)', paddingBottom: '100px' }}>
      {/* ───────────────────────── Level 1: the tree ───────────────────────── */}
      {!activeCategory && !activeCard && (
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
                label={CATEGORY_LABELS.dues}
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

              {/* Only when there IS history. A chevron into an empty list is a dead end, which is the
                  rule Wealth's tree already follows for a category with nothing in it. */}
              {statements.length > 0 && (
                <CategoryCard
                  icon={<FileText size={20} />}
                  iconColor="var(--accent)"
                  label={CATEGORY_LABELS.statements}
                  subtext="Cycles & history"
                  // The count, not the card count the plan called for: this row is about cycles, and
                  // how many cards you hold is My Cards' figure rather than this one's.
                  value={String(statements.length)}
                  valueNote={
                    <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, marginTop: '0.3rem', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
                      {statements.length === 1 ? 'Closed cycle' : 'Closed cycles'}
                    </div>
                  }
                  onClick={() => openCategory('statements')}
                  tourClass="tour-cards-cat-statements"
                />
              )}

              {/* Shown once anything has ever earned a reward — including a fully-confirmed history,
                  which is worth being able to look back at. */}
              {rewards.rows.length > 0 && (
                <CategoryCard
                  icon={<Gift size={20} />}
                  iconColor="var(--success)"
                  label={CATEGORY_LABELS.rewards}
                  subtext="Cashback & points"
                  // A COUNT, not the rupee figure the plan called for, and the reason is arithmetic:
                  // a card can pay in its own unit (Jewels, EDGE points) at its own conversion rate,
                  // so one ₹ total across cards would be adding incompatible things. The hero below
                  // states each unit separately, which a single row has no room to do.
                  value={String(rewards.pending.count)}
                  valueNote={
                    <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, marginTop: '0.3rem', letterSpacing: '0.5px', color: rewards.pending.count > 0 ? 'var(--success)' : 'var(--text-secondary)' }}>
                      {rewards.pending.count > 0 ? 'Pending' : 'All credited'}
                    </div>
                  }
                  onClick={() => openCategory('rewards')}
                  tourClass="tour-cards-cat-rewards"
                />
              )}
            </div>
          )}
        </>
      )}

      {/* ───────────────────────── Level 2: Dues ───────────────────────── */}
      {activeCategory === 'dues' && !activeCard && (
        <div className="fade-in">
          <SubviewHeader title="Cards" onBack={() => setCategory(null)} hideTitle />

          <CategoryHero backdrop={<DuesBackdrop />} label={CATEGORY_LABELS.dues} minHeight="360px" userName={data.user?.name}>
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
                onClick={() => openCard(d.account)}
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

      {/* ───────────────────────── Level 2: Statements ───────────────────────── */}
      {activeCategory === 'statements' && !activeCard && (
        <div className="fade-in">
          <SubviewHeader title={CATEGORY_LABELS.statements} onBack={() => setCategory(null)} hideTitle />

          <CategoryHero backdrop={<StatementsBackdrop />} label={CATEGORY_LABELS.statements} minHeight="340px" userName={data.user?.name}>
            <div className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              {formatWhole(statementsTotal)}
            </div>
            <div className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--text-secondary)', marginTop: '0.6rem' }}>
              Billed across {statementsShown.length} statement{statementsShown.length === 1 ? '' : 's'}
            </div>
            <FilterPills
              tabs={[
                { v: 'all', label: 'All' },
                ...dues.filter(d => statementCardIds.includes(d.account.id))
                  .map(d => ({ v: d.account.id, label: d.account.name.split(/[ ×x]/)[0] })),
              ]}
              active={statementsFilter}
              onSelect={setStatementsFilter}
              marginTop="1.25rem"
              flexible
              pillWidth={92}
            />
          </CategoryHero>

          <div style={{ padding: '0.5rem 1.5rem calc(1.5rem + var(--safe-area-inset-bottom))' }}>
            {statementsShown.map(st => {
              const statementDay = st.account.statementDay || 1;
              return (
                <div
                  key={`${st.account.id}-${st.cycle}`}
                  onClick={() => openCard(st.account, st.cycle)}
                  className="clickable"
                  style={{
                    padding: '1rem 0',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.9rem',
                  }}
                >
                  {renderCardMark(st.account, 38)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* The month leads and the dates follow, because a cut day of the 26th means
                        "August" spans two calendar months and the row has to say which days. */}
                    <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                      {format(parseISO(`${st.cycle}-01`), "MMMM yyyy")}
                    </div>
                    <div className="text-mono uppercase" style={{ fontSize: '0.58rem', color: 'var(--text-secondary)', marginTop: '0.2rem', letterSpacing: '0.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatBillingCycleRange(st.cycle, statementDay)}
                      {statementsFilter === 'all' ? ` · ${st.account.name}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: st.amount > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {formatCurrency(st.amount)}
                    </div>
                    <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: '0.2rem', letterSpacing: '0.5px' }}>
                      {st.count} {st.count === 1 ? 'entry' : 'entries'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ───────────────────────── Level 2: Rewards ─────────────────────────
          The Cashback vault, absorbed. Its own screen is unchanged below the hero — it is the most
          intricate surface in the app (confirm, edit, bulk-confirm, consolidate) and redrawing it to
          match the tree would risk all of that for a header. What it loses is its title, because the
          hero directly above now says where you are. */}
      {activeCategory === 'rewards' && !activeCard && (
        <div className="fade-in">
          <SubviewHeader title={CATEGORY_LABELS.rewards} onBack={() => setCategory(null)} hideTitle />

          {/* 360px, matching Dues. The hero's own content decides this: 'meet' scales the square by
              min(width, height), so while the box is shorter than it is wide a taller hero genuinely
              buys the drawing room — the content is laid out in pixels, so a bigger scale shrinks its
              footprint in viewBox units. (That escape closes once height reaches width, which is the
              case the note in CardsBackdrops is about.) */}
          <CategoryHero backdrop={<RewardsBackdrop />} label={CATEGORY_LABELS.rewards} minHeight="360px" userName={data.user?.name}>
            {/* Rupees lead when there are any; a points-only wallet leads with its own unit rather
                than with a ₹0 that would read as "nothing owed". */}
            <div className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              {rewards.pending.rupees > 0 || rewards.pending.byUnit.length === 0
                ? formatWhole(rewards.pending.rupees)
                : `${Math.round(rewards.pending.byUnit[0].amount)} ${rewards.pending.byUnit[0].unit.toLowerCase()}`}
            </div>
            {/* One line per remaining unit, and at most two of them — the drawing below has a fixed
                top edge, and a third line would print over it. Never converted into the figure above:
                a conversion rate is what a point is worth if you spend it a particular way, not what
                you are owed. */}
            {unitLines.slice(0, 2).map(u => (
              <div key={u.unit} className="text-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '1px', color: 'var(--text-secondary)', marginTop: '0.45rem' }}>
                + {Math.round(u.amount * 100) / 100} {u.unit.toLowerCase()}
              </div>
            ))}
            {unitLines.length > 2 && (
              <div className="text-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '1px', color: 'var(--text-muted)', marginTop: '0.45rem' }}>
                + {unitLines.length - 2} more unit{unitLines.length - 2 === 1 ? '' : 's'}
              </div>
            )}
            <div className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--text-muted)', marginTop: '0.7rem' }}>
              {rewards.pending.count > 0
                ? `${rewards.pending.count} awaiting credit`
                : 'Everything credited'}
            </div>
          </CategoryHero>

          <div style={{ paddingBottom: 'calc(1.5rem + var(--safe-area-inset-bottom))' }}>
            <Cashback embedded />
          </div>
        </div>
      )}

      {/* ───────────────────────── Level 3: one card's statement ───────────────────────── */}
      {activeCard && (() => {
        const cardDues = activeCard;
        const card = cardDues.account;
        const statementDay = card.statementDay || 1;
        const openCycle = getBillingCycleForDate(format(new Date(), 'yyyy-MM-dd'), statementDay);
        const cycle = selectedCycle ?? openCycle;
        const isOpenCycle = cycle === openCycle;
        // Rupee legs only, matching the statement modal and every cycle sum in the service: a points
        // redemption draws on the reward wallet, so it is on neither side of this bill.
        const cardTxs = data.transactions.filter(t => t.accountId === card.id && affectsRupeeBalance(t));
        const cycleTxs = cardTxs
          .filter(t => getAppliedBillingCycle(t, statementDay) === cycle)
          .sort((a, b) => b.date.localeCompare(a.date));
        const figures = getCardCycleFigures(card, data.transactions, cycle);

        // Which cycles get a pill. Four at most: FilterPills is a fixed-width segmented control, and
        // a fifth pill truncates every label to three characters. The window slides to keep the
        // selected cycle lit, so a cycle opened from Statements is visible even if it's a year back —
        // and the open cycle is always in the set, because a card with no history still has one.
        const ranked = Array.from(new Set([openCycle, cycle, ...cardTxs.map(t => getAppliedBillingCycle(t, statementDay))]))
          .sort((a, b) => b.localeCompare(a));
        const at = ranked.indexOf(cycle);
        const from = Math.min(Math.max(0, at - 1), Math.max(0, ranked.length - 4));
        // Reversed for display: time runs left to right, so the newest cycle is the rightmost pill.
        const cycleTabs = ranked.slice(from, from + 4).reverse()
          .map(c => ({ v: c, label: format(parseISO(`${c}-01`), 'MMM') }));

        const last4 = card.cardDetails?.cardNumber?.replace(/\D/g, '').slice(-4);
        const identity = ['Credit card', card.cardDetails?.network?.toUpperCase(), last4 && `•••• ${last4}`]
          .filter(Boolean).join(' · ');

        return (
          <div className="fade-in" style={{ boxSizing: 'border-box' }}>
            <SubviewHeader title={CATEGORY_LABELS[activeCategory ?? 'dues']} onBack={() => setSelectedCardId(null)} hideTitle />

            <DetailHeroBand />

            {/* Identity block — the same shape as Wealth's holding detail, down to the lift that sets
                the mark into the panel above, so the app's two detail screens read as one screen. */}
            <div style={{ padding: '0 1.5rem 0.5rem', marginTop: `-${DETAIL_HERO_LIFT}px`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <SealedMark>
                {/* LogoAvatar, not the CardBrandLogo the Dues rows use — and the difference is the
                    shape of the hole it fills. The wax is a CIRCLE centred on this box, and an issuer
                    lockup is a 6:1 plate (HDFC) or a 4:1 wordmark (Axis): inscribed in a 60px circle
                    that leaves an 8px-tall sliver, which reads as a sticker stuck on the seal rather
                    than a device struck into it. LogoAvatar resolves the co-brand's round mark, and
                    falls back to a monogram — which is what a seal carries anyway. The issuer's
                    wordmark still names the bank on the row this screen was opened from, where a
                    landscape tile is the right shape for it. */}
                <LogoAvatar name={card.name} logoUrl={getLiquidLogoUrl(card)} size={DETAIL_HERO_AVATAR} accountType={card.type} />
              </SealedMark>

              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35, maxWidth: '90%' }}>
                {card.name}
              </div>
              <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.4rem', letterSpacing: '1px' }}>
                {identity}
              </div>

              {/* The CARD's position, not the cycle's: this is what the row that opened the screen
                  said, and a detail screen that opens on a different number reads as the wrong card.
                  The selected cycle's own figures are below the pills, where they change with them. */}
              <div className="text-serif" style={{ fontSize: '2.6rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '1.25rem', lineHeight: 1 }}>
                {formatCurrency(cardDues.outstanding)}
              </div>
              {renderSplit(cardDues.billed, cardDues.unbilled)}
              {cardDues.utilization !== undefined && renderUtilization(cardDues.utilization, cardDues.creditLimit ?? 0)}
              {duePhrase(cardDues) && (
                <div className="text-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.5px', color: dueColor(cardDues), marginTop: '1rem' }}>
                  {cardDues.billed > 0 ? duePhrase(cardDues) : `Nothing billed · due ${cardDues.dueDayStr}`}
                </div>
              )}
            </div>

            <div style={{ padding: '0 1.5rem calc(1.5rem + var(--safe-area-inset-bottom))' }}>
              <div className="flex justify-center" style={{ marginTop: '1.5rem' }}>
                <FilterPills tabs={cycleTabs} active={cycle} onSelect={setSelectedCycle} marginTop="0" flexible />
              </div>

              {/* What the selected cycle is, in dates. The pill says "Aug"; a statement is a range,
                  and which range depends on a cut day the pill can't show. */}
              <div className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '0.85rem' }}>
                {formatBillingCycleRange(cycle, statementDay)}
                {' · '}
                <span style={{ color: isOpenCycle ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {isOpenCycle ? 'Open cycle' : 'Closed statement'}
                </span>
              </div>

              {/* The cycle's three figures. NOT billed / unbilled / cashback, which the plan for this
                  screen called for: billed and unbilled are properties of the CARD (latest closed
                  cycle, and the open one), so under a cycle selector they would sit still while the
                  pills moved, and they already appear above. Spends and payments are the two sides of
                  whichever cycle is selected, and the third cell is their result — printed on a closed
                  statement, still moving on an open one. */}
              <div className="flex justify-between" style={{ gap: '0.75rem', marginTop: '1.25rem' }}>
                {[
                  { label: 'Spends', value: figures.spend, tone: 'var(--text-primary)' },
                  { label: 'Payments', value: figures.payment, tone: figures.payment > 0 ? 'var(--success)' : 'var(--text-secondary)' },
                  {
                    label: isOpenCycle ? 'Running' : 'Statement',
                    value: isOpenCycle ? figures.payable : figures.statementAmount,
                    tone: 'var(--text-primary)',
                  },
                ].map(cell => (
                  <div key={cell.label} className="card" style={{ flex: 1, padding: '0.85rem 0.5rem', textAlign: 'center', minWidth: 0 }}>
                    <div className="text-mono uppercase" style={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: '1px', color: 'var(--text-muted)' }}>{cell.label}</div>
                    <div className="text-serif" style={{ fontSize: '1rem', fontWeight: 700, color: cell.tone, marginTop: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {formatWhole(cell.value)}
                    </div>
                  </div>
                ))}
              </div>

              {/* The cycle's own ledger, rows and gesture shared with the statement modal. */}
              <div className="text-mono uppercase" style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '1.5px', color: 'var(--text-muted)', margin: '1.75rem 0 0.25rem' }}>
                {cycleTxs.length > 0 ? `${cycleTxs.length} transaction${cycleTxs.length === 1 ? '' : 's'}` : 'Ledger'}
              </div>
              {cycleTxs.length === 0 ? (
                <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Nothing billed to this cycle
                </div>
              ) : (
                cycleTxs.map((tx, idx) => (
                  <CycleLedgerRow
                    key={tx.id}
                    tx={tx}
                    statementDay={statementDay}
                    selectedCycle={cycle}
                    index={idx}
                    press={cycleMove.press(tx)}
                  />
                ))
              )}
              {/* Long-press is undiscoverable without being told once. The rows already carry a
                  dashed "may settle next" tag where it's most likely to be wanted; this says what to
                  do about it. */}
              {cycleTxs.length > 0 && (
                <div className="text-mono uppercase" style={{ fontSize: '0.55rem', letterSpacing: '0.5px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '1.25rem', opacity: 0.8 }}>
                  Hold a row to move it to another statement
                </div>
              )}
            </div>

            {cycleMove.moveTarget && (
              <CycleMoveSheet
                tx={cycleMove.moveTarget}
                statementDay={statementDay}
                selectedCycle={cycle}
                onApply={cycleMove.applyCycleMove}
                onCancel={cycleMove.closeMove}
              />
            )}
          </div>
        );
      })()}

      {cycleMove.undoState && <CycleMoveToast message={cycleMove.undoState.message} onUndo={cycleMove.undoCycleMove} />}
    </div>
  );
}
