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
// LEVEL 3 IS THE CARD, not the statement. It used to be a cycle picker over a cycle's ledger, which
// made it a second implementation of the AccountStatement modal reached by a longer route. That
// screen still exists and is still where a cycle is read: the Statements rows open it directly
// through onViewStatement, and Accounts opens it too. What level 3 does instead is answer the
// questions a statement can't — what the card costs to hold, how far into a fee waiver you are, what
// it has spent and earned back over a membership year — which is the summary you want when you are
// not asking about one particular month.
import { useState, useEffect, useMemo, useRef } from 'react';
import { CreditCard, FileText, Gift, Check, CheckCheck, AlertTriangle, Clock, Hourglass, Minus, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '../FinanceContext';
import type { Account } from '../types';
import {
  formatCurrency, userPossessive, getOrdinalSuffix, getCardGradients,
  getBillingCycleForDate, formatBillingCycleRange, getAppliedBillingCycle, affectsRupeeBalance,
} from '../utils';
import { getActiveCardDues, getCardCycleFigures, sumCardDues, cycleStatus, isCycleOverdue, CYCLE_STATUS_LABEL, type CardDues, type CycleStatus } from '../services/CardDuesService';
import { buildRewardRows, summariseRewards, summariseCardRewards, type PendingRewards } from '../services/RewardsService';
import { getCardYear, getCardSpendFigures, getCardFeeStanding } from '../services/CardYearService';
import Cashback from './Cashback';
import { CategoryCard, CategoryHero, SubviewHeader, SealedMark, FilterPills, SectionHeading } from './TreeUi';
import { DetailHeroBand, DETAIL_HERO_AVATAR, DETAIL_HERO_LIFT } from './DetailHeroBackdrop';
import { CardsBackdrop, MyCardsBackdrop, StatementsBackdrop, RewardsBackdrop } from './CardsBackdrops';
import { LogoAvatar } from './LogoAvatar';
import { ViewCardOverlay } from './ViewCardOverlay';
import { getCardLogoUrl } from '../services/LogoService';
import ProfileAvatar from './ProfileAvatar';

// 'mycards' was 'dues' until the category stopped being about what a card OWES. It now opens onto
// everything the app knows about one card — fees, the membership year, spend, cashback, the plastic
// itself — with the outstanding figure as its lead rather than its subject. The name was already
// reserved for a fourth category in this file's header note; the category it describes turned out to
// be this one grown up rather than a new one beside it.
type CardsCategory = 'mycards' | 'statements' | 'rewards';

/** What each category is called, on its row, its hero and the detail screen's header. */
const CATEGORY_LABELS: Record<CardsCategory, string> = { mycards: 'My Cards', statements: 'Statements', rewards: 'Rewards' };

/** One closed statement: what a card billed for one cycle that has already been cut. */
/** A row in the Statements list. Every one is a cycle of one card — closed, or the one still
 *  running — which is why the running cycle can sit in a year's group beside its statements rather
 *  than as a special case above them. `status` is what tells them apart. */
type StatementRow = ClosedStatement;

interface ClosedStatement {
  account: Account;
  cycle: string;
  /** What the cycle BILLED. A closed statement is a record of a month that has happened, so the
   *  figure on the row is what was charged in it — not what is still owed, which for a cycle you
   *  have already paid is zero, and a list of zeroes tells you nothing about where the money went. */
  amount: number;
  /** What is still owed on it. Zero on a settled cycle — hence `settled`, which says whether that
   *  zero means "paid off" or "nothing was ever charged". */
  due: number;
  settled: boolean;
  /** Raw debits, before cashback and refunds were netted off. Only worth showing when it differs
   *  from `amount` — see the row's sub-line. */
  spend: number;
  credits: number;
  /** The figure was entered by hand. Said out loud on the row for the same reason the statement
   *  screen says it: a corrected number that looks derived is worse than one that is a rupee out. */
  adjusted: boolean;
  /** Where the cycle stands, from the shared ladder — the icon and the word both read off this. */
  status: CycleStatus;
  count: number;
}

/** How a cycle's status is drawn. The ladder that decides the status lives in CardDuesService and is
 *  shared with the statement screen — only the glyph and the colour are this screen's business. */
/** How a cycle's status is drawn: one 33px ring for every row that has one, and at most one glyph
 *  inside it.
 *
 *  Only the RUNNING cycle has no glyph — its broken ring says everything there is to say about a
 *  month that has not been billed, and a glyph inside a dashed circle is two ideas where one will
 *  do. Every other ring row carries a mark that is not itself round, so it reads as something inside
 *  the circle rather than as a second, smaller circle competing with it. */
const CYCLE_LOOK: Record<CycleStatus, { Icon: LucideIcon | null; tone: string; ring: boolean; dash?: string }> = {
  open: { Icon: null, tone: 'var(--accent)', ring: true, dash: '5 4' },
  empty: { Icon: Minus, tone: 'var(--text-muted)', ring: false },
  overdue: { Icon: AlertTriangle, tone: 'var(--danger)', ring: true },
  overpaid: { Icon: CheckCheck, tone: 'var(--success)', ring: true },
  settled: { Icon: Check, tone: 'var(--success)', ring: true },
  partial: { Icon: Hourglass, tone: 'var(--accent)', ring: true },
  unpaid: { Icon: Clock, tone: 'var(--text-secondary)', ring: true },
};

/** The left-hand mark on a closed statement's row.
 *
 *  Three marks have stood here. The card's own logo, which under a card's pill meant the SAME logo
 *  repeated down every row — a rail of identical marks carrying no information, which is worse than
 *  a blank one because it looks like it means something. Then the month, which was no better for the
 *  opposite reason: the row's title six pixels to the right already says "August 2026", so the rail
 *  was repeating the line beside it.
 *
 *  What is left is the one thing the row does NOT otherwise say at a glance: where this statement
 *  stands. The ring closes as the statement is paid off — a proportion no glyph can carry — and the
 *  glyph inside names the state, because a ring at nine tenths and a ring at nine tenths a month
 *  past its due date look identical and are not the same news.
 *
 *  It keeps the avatar's 38px footprint on purpose. The "All" list still shows real card logos at
 *  that size, and the two lists are one tap apart — a change of size between them would read as a
 *  change of screen. */
const CycleMark: React.FC<{ amount: number; due: number; status: CycleStatus }> = ({ amount, due, status }) => {
  const size = 38;
  const r = 16.5;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const { Icon, tone, ring, dash } = CYCLE_LOOK[status];
  // Guarded against a cycle that billed nothing: a zero statement is not "0% paid", it is a month
  // with no statement to pay, and drawing an empty ring on it would say the wrong thing.
  const paid = amount > 0 ? Math.min(1, Math.max(0, (amount - due) / amount)) : 0;
  // Whether there is a bright arc for the ring to sit behind — and it is the presence of the ARC
  // that decides how strongly the ring is drawn, not the presence of a glyph.
  //
  // The rings are all exactly 33px across; measured, not assumed. What made some of them look
  // smaller was contrast: a full circle at 32% with a bright arc over part of it reads as a tighter,
  // thinner ring than one drawn whole, and a row with NOTHING paid was a whole circle at 32% with no
  // arc at all — which is how an overdue mark ended up looking half the size of the settled one
  // above it. So a ring with no arc is drawn at full strength, and a track that does carry one sits
  // back only far enough for the arc to lead.
  const hasArc = !dash && paid > 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {ring && (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} aria-hidden="true">
          <circle
            cx={c} cy={c} r={r} fill="none" strokeWidth="2"
            stroke={tone} strokeOpacity={hasArc ? 0.5 : 0.85} strokeDasharray={dash}
          />
          {hasArc && (
            <circle
              cx={c} cy={c} r={r} fill="none" strokeWidth="2" strokeLinecap="round"
              stroke={tone} strokeDasharray={`${circ * paid} ${circ}`}
            />
          )}
        </svg>
      )}
      {Icon && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone }}>
          <Icon size={16} strokeWidth={2.4} />
        </div>
      )}
    </div>
  );
};

/** The CALENDAR year a cycle falls in.
 *
 *  It was the financial year, April–March, and that was precision nobody needed: nothing about card
 *  spending is reckoned Apr–Mar — no tax follows it, no annual fee does — while every row on this
 *  list is titled "March 2026", so an "FY 25-26" header above it made the reader translate. The app
 *  keeps FY where the domain forces it (EPF interest is declared per financial year); this is not
 *  one of those places. */
const cycleYear = (cycle: string) => Number(cycle.split('-')[0]);

/** Whole rupees for the root screen and the category cards — paise are noise on a summary, and
 *  Wealth's tree makes the same call. Every inner figure uses formatCurrency so it reconciles
 *  digit-for-digit with Accounts. */
const formatWhole = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

/** How close to the due date a bill has to be before the figure turns urgent. Same three days as
 *  the bill-alert banner, so the two can't disagree about what "soon" means. */
const URGENCY_DAYS = 3;

/** The utilization advice line. Card issuers and every credit-score model treat 30% of the limit as
 *  the point past which usage starts counting against you, so it is the one number on this bar that
 *  isn't the user's own. */
const UTIL_ADVICE = 0.3;

/**
 * The heat ramp the utilization bar is painted with: a colour per fraction of the limit, interpolated
 * between the stops rather than switched at them. The old meter picked one of three tokens by band,
 * which meant a card sat flat green all the way to 49% and then jumped — the jump was the only signal,
 * and it told you nothing on either side of itself.
 *
 * Its own constant rather than the --success/--warning/--danger tokens, even though it starts and ends
 * near them: those are semantic UI colours for discrete states, and this is a continuous scale. It is
 * also why the values are RGB triples — the ramp has to be interpolated in JS for the callout and
 * emitted as a CSS gradient for the bar, from one source, and a hex string does neither.
 *
 * Flat green to UTIL_ADVICE, then away: below the advice line there is nothing to warn about, so a bar
 * that had already started yellowing at 20% would be crying wolf.
 */
const UTIL_RAMP: [number, [number, number, number]][] = [
  [0, [0, 255, 204]],           // --success
  [UTIL_ADVICE, [0, 255, 204]],
  [0.65, [251, 191, 36]],       // --warning
  [1, [255, 77, 77]],           // --danger
];

const UTIL_GRADIENT = `linear-gradient(90deg, ${UTIL_RAMP.map(([at, c]) => `rgb(${c.join(',')}) ${at * 100}%`).join(', ')})`;

/** The ramp sampled at one point, for the parts of the bar CSS can't paint with the gradient. */
const utilTone = (p: number) => {
  const t = Math.min(1, Math.max(0, p));
  for (let i = 1; i < UTIL_RAMP.length; i++) {
    const [a, ca] = UTIL_RAMP[i - 1];
    const [b, cb] = UTIL_RAMP[i];
    if (t <= b) {
      const k = b === a ? 0 : (t - a) / (b - a);
      return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * k)).join(',')})`;
    }
  }
  return `rgb(${UTIL_RAMP[UTIL_RAMP.length - 1][1].join(',')})`;
};

/** A reward summary's lead figure. Rupees when there are any; otherwise the largest unit, because a
 *  points-only wallet leading with a ₹0 would read as "nothing earned". */
const leadFigure = (s: PendingRewards) =>
  s.rupees > 0 || s.byUnit.length === 0
    ? formatWhole(s.rupees)
    : `${Math.round(s.byUnit[0].amount)} ${s.byUnit[0].unit.toLowerCase()}`;

/** The units that aren't already leading. */
const trailingUnits = (s: PendingRewards) => s.byUnit.slice(s.rupees > 0 ? 0 : 1);

const dueColor = (d: CardDues) =>
  d.billed <= 0 ? 'var(--text-secondary)'
    : d.daysToDue !== undefined && d.daysToDue <= URGENCY_DAYS ? 'var(--danger)'
      : 'var(--warning)';

/** One figure in a bordered cell — the unit the card summary's stat rows are built from. */
const StatCell: React.FC<{ label: string; value: string; tone: string }> = ({ label, value, tone }) => (
  <div className="card" style={{ flex: 1, padding: '0.85rem 0.5rem', textAlign: 'center', minWidth: 0 }}>
    <div className="text-mono uppercase" style={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: '1px', color: 'var(--text-muted)' }}>{label}</div>
    <div className="text-serif" style={{ fontSize: '1rem', fontWeight: 700, color: tone, marginTop: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {value}
    </div>
  </div>
);

/**
 * A year figure beside its all-time counterpart — collapsed to ONE cell while the two agree.
 *
 * They agree for every card less than a membership year old, which is to say for every card on its
 * first year and every card the app has only just been told about. Two cells side by side carrying
 * the identical number reads as a fault in the screen rather than as a fact about the card, and it
 * spends the width of the row saying one thing twice. Collapsed, the single label names both scopes,
 * so nothing is hidden — the row says outright that this year IS all-time so far.
 *
 * `same` is passed in rather than compared here: rupees compare with ===, reward units do not (see
 * sameRewards), and the cell has no business knowing which kind of figure it is holding.
 */
const StatPair: React.FC<{
  same: boolean; marginTop: string; tone?: string;
  yearLabel: string; allLabel: string; bothLabel: string;
  yearValue: string; allValue: string;
}> = ({ same, marginTop, tone = 'var(--text-primary)', yearLabel, allLabel, bothLabel, yearValue, allValue }) => (
  <div className="flex justify-between" style={{ gap: '0.75rem', marginTop }}>
    {same ? (
      <StatCell label={bothLabel} value={yearValue} tone={tone} />
    ) : (
      <>
        <StatCell label={yearLabel} value={yearValue} tone={tone} />
        <StatCell label={allLabel} value={allValue} tone={tone} />
      </>
    )}
  </div>
);

/**
 * Whether two reward summaries are the same earnings.
 *
 * Compared per UNIT, not on the string leadFigure would print. A card paying in more than one unit
 * renders only the first of them, so two genuinely different summaries can print identically — and
 * collapsing on that would hide a real difference behind a label claiming there is none. Matched by
 * unit name rather than by position, because two units on equal amounts have no guaranteed order.
 */
const sameRewards = (a: PendingRewards, b: PendingRewards) => {
  if (a.rupees !== b.rupees || a.byUnit.length !== b.byUnit.length) return false;
  const theirs = new Map(b.byUnit.map(u => [u.unit, u.amount]));
  return a.byUnit.every(u => theirs.get(u.unit) === u.amount);
};

/**
 * The due line on a card's own screen, spelled out.
 *
 * duePhrase alone was "In 1 day" — which sits under a balance, a billed/unbilled pair and a
 * utilisation bar, and could be counting down to any of them. Everywhere else that phrase follows
 * "Due 2nd" and inherits its subject from it; here it had none, so it says what is due and when.
 */
const dueSentence = (d: CardDues) => {
  if (d.billed <= 0) return d.dueDayStr ? `Nothing billed \u00b7 due ${d.dueDayStr}` : 'Nothing billed';
  if (d.daysToDue === undefined) return d.dueDayStr ? `Bill due ${d.dueDayStr}` : null;
  if (d.daysToDue < 0) {
    const n = Math.abs(d.daysToDue);
    return `Bill overdue by ${n} day${n === 1 ? '' : 's'}`;
  }
  if (d.daysToDue === 0) return 'Bill due today';
  return `Bill due in ${d.daysToDue} day${d.daysToDue === 1 ? '' : 's'}`;
};

/** "In 3 days" / "Due today" / "5 days overdue" — the same phrasing the Bills screen uses. */
const duePhrase = (d: CardDues) => {
  if (d.daysToDue === undefined) return null;
  if (d.daysToDue < 0) return `${Math.abs(d.daysToDue)}d overdue`;
  if (d.daysToDue === 0) return 'Due today';
  return `In ${d.daysToDue} day${d.daysToDue === 1 ? '' : 's'}`;
};

/**
 * One card, as a tile.
 *
 * PAINTED IN THE CARD'S OWN SKIN — the same `front` gradient ViewCardOverlay renders the plastic
 * with, so the tile you tap and the card that opens are visibly the same object. That is the whole
 * argument for a coloured tile over the ruled row it replaces: a row of identical grey rectangles
 * distinguished only by a 38px logo makes you READ to find a card, where a wall of colour lets you
 * point at one. `ink` comes off the skin too, because a few skins are light enough that white type
 * on them is unreadable, and guessing from the gradient string is not something to attempt.
 *
 * The mark keeps the round LogoAvatar the ruled rows used, rather than a wordmark: the Accounts
 * screen puts every institution behind that frame, and this is the same institution.
 *
 * WIDE tiles are shorter, not stretched. A full-width tile at 1:1 would be a 340px square and four
 * of them a scroll and a half; the content is anchored the same way — mark at the top, name and
 * figures at the foot — so a wide tile reads as the same tile in a different aperture.
 */
const CardTile: React.FC<{ d: CardDues; wide: boolean; onOpen: (account: Account) => void }> = ({ d, wide, onOpen }) => {
  const { data } = useFinance();
  // The index is the skin's theme seed and has to be stable, so it is taken from the same id-sorted
  // list ViewCardOverlay sorts — not from the position in `dues`, which reorders as cards are paid.
  const ordered = [...data.accounts].sort((a, b) => a.id.localeCompare(b.id));
  const idx = ordered.findIndex(a => a.id === d.account.id);
  const skin = getCardGradients(idx >= 0 ? idx : 0, d.account.cardDetails?.network, d.account.name);
  const ink = skin.ink === 'dark' ? '#0b0b0c' : '#fff';
  // Held back from full white/black: a figure at the same strength as the name gives the tile two
  // things shouting at once, and the name is what you are looking for.
  const inkSoft = skin.ink === 'dark' ? 'rgba(11,11,12,0.62)' : 'rgba(255,255,255,0.66)';
  const phrase = duePhrase(d);

  return (
    <div
      onClick={() => onOpen(d.account)}
      className="card clickable"
      style={{
        background: skin.front,
        // The tile IS the colour, so the card shell's border would draw a grey line around a
        // saturated field. The hard shadow stays — it is what makes every surface in this app sit on
        // the page rather than in it.
        border: 'none',
        padding: '1rem',
        cursor: 'pointer',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
        ...(wide ? { minHeight: '148px' } : { aspectRatio: '1 / 1' }),
      }}
    >
      <LogoAvatar name={d.account.name} logoUrl={getCardLogoUrl(d.account)} size={38} accountType={d.account.type} />

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: ink, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.account.name}
        </div>
        <div className="text-serif" style={{ fontSize: '1.35rem', fontWeight: 700, color: ink, marginTop: '0.45rem', lineHeight: 1 }}>
          {formatWhole(d.outstanding)}
        </div>
        {/* One line, and which line depends on whether there is a bill to answer for. An unbilled
            card gets its cut date, because that is the next thing that will happen to it; a billed
            one gets the due date and how long is left, which is the only urgent fact on this screen.
            The urgency colour from `dueColor` is deliberately NOT used: it is tuned against the
            app's dark ground and disappears on a saturated skin. */}
        <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.5px', color: inkSoft, marginTop: '0.35rem' }}>
          {d.billed > 0 && d.dueDayStr
            ? `Due ${d.dueDayStr}${phrase ? ` \u00b7 ${phrase}` : ''}`
            : `Cut ${getOrdinalSuffix(d.account.statementDay || 1)}`}
        </div>
      </div>
    </div>
  );
};

/**
 * The card wall.
 *
 * FOUR OR FEWER go one to a row at full width; more than that pairs them up, and an odd count gives
 * the LAST tile the full width so the grid never ends on a half-empty row. The rule is about how
 * much room a small collection deserves rather than about density: three cards in a two-column grid
 * is a screen two-thirds empty with a stub at the bottom, where three full-width tiles fill it.
 *
 * The odd tile is the last one rather than the first because the list is ordered by what is most
 * pressing — promoting the runt to the top would reorder the wall to suit its own geometry.
 */
const CardTileGrid: React.FC<{ dues: CardDues[]; onOpen: (account: Account) => void }> = ({ dues, onOpen }) => {
  const oneUp = dues.length <= 4;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: oneUp ? '1fr' : 'repeat(2, minmax(0, 1fr))',
      gap: '0.85rem',
    }}>
      {dues.map((d, i) => {
        // A card at ₹0 keeps its tile: its cut and due dates are information, and a card that
        // vanished when it was paid off would read as a card that had gone missing.
        const wide = oneUp || (dues.length % 2 === 1 && i === dues.length - 1);
        return (
          <div key={d.account.id} style={wide && !oneUp ? { gridColumn: '1 / -1' } : undefined}>
            <CardTile d={d} wide={wide} onOpen={onOpen} />
          </div>
        );
      })}
    </div>
  );
};

export default function CreditCards({ onExit, onViewStatement }: {
  onExit?: () => void;
  /** Opens the standalone statement screen for a card, at its current open cycle with a picker for
   *  past ones. Same screen and same handler the Accounts tab uses. */
  // Opens the standalone statement screen, at a given cycle when the row names one.
  onViewStatement?: (account: Account, cycle?: string) => void;
}) {
  const { data } = useFinance();
  const [category, setCategory] = useState<CardsCategory | null>(null);
  const [statementsFilter, setStatementsFilter] = useState<string>('all');
  // Level 3: which card's statement is open, and which of its cycles. The card is held by ID rather
  // than as an object so the screen reads today's figures — an Account captured on open would keep
  // whatever balance and dues it had at that moment while transactions carried on being logged.
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  // Which financial years are expanded, as OVERRIDES rather than as the whole truth: the default is
  // "this year open, the rest closed", and storing that as state would mean recomputing it every
  // time the clock crosses an April. Absent here means "whatever the default says".
  const [yearOpen, setYearOpen] = useState<Record<number, boolean>>({});
  // The Rewards list's credited-cycles filter, held HERE rather than inside Cashback: the hero above
  // it leads with a different figure depending on which way it is set, so one of the two has to own
  // the value and the hero is the one that can't be handed it from below.
  const [rewardsShowAll, setRewardsShowAll] = useState(false);
  // Which card's plastic is being turned over. Same overlay, same state shape, as Accounts.
  const [viewingCard, setViewingCard] = useState<Account | null>(null);
  // Where each level was scrolled to, so backing out of one lands where it was left rather than at
  // the top. Same two-slot memory as Wealth's — the detail screen always opens at the top, so it
  // needs no slot of its own.
  const scrollRef = useRef<{ tree: number; category: number }>({ tree: 0, category: 0 });

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
    for (const { account, billedCycle, daysToDue } of dues) {
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
        const f = getCardCycleFigures(account, data.transactions, cycle);
        const overdue = isCycleOverdue({ billedCycle, daysToDue }, cycle, f.due);
        out.push({
          account, cycle, amount: f.charged, due: f.due, settled: f.settled,
          spend: f.spend, credits: f.credits, adjusted: f.adjusted,
          status: cycleStatus(f, overdue), count,
        });
      }
    }
    // Newest cycle first, and within a cycle by card name, so a month's statements sit together.
    return out.sort((a, b) => b.cycle.localeCompare(a.cycle) || a.account.name.localeCompare(b.account.name));
  }, [dues, data.transactions]);

  // What the cards have earned but not yet paid out. Same derivation the vault screen uses — the row
  // and the hero here would drift from it within one change otherwise.
  const rewards = useMemo(() => {
    const rows = Object.values(buildRewardRows(data.transactions, data.accounts, data.cashbackStatements));
    return {
      rows,
      pending: summariseRewards(rows, data.accounts, 'pending'),
      lifetime: summariseRewards(rows, data.accounts, 'lifetime'),
    };
  }, [data.transactions, data.accounts, data.cashbackStatements]);

  // ONE ROW PER CARD, at the cycle that is still running — what the Statements list shows under the
  // "All" pill. The flat list of every closed cycle it replaced grew with cards × months and was
  // already fifteen rows deep on three cards, which is a history to scroll rather than a thing to
  // choose from. Per-card history did not go anywhere: it is behind these rows, and behind the
  // card's own pill.
  //
  // The open cycle, not the last closed one, so the row answers "what is this card running at right
  // now" — and so that tapping it lands on the same cycle the statement screen opens at, instead of
  // showing one figure and navigating to another.
  const openRows = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return dues.map(({ account }) => {
      const statementDay = account.statementDay || 1;
      const cycle = getBillingCycleForDate(today, statementDay);
      const count = data.transactions.filter(t =>
        t.accountId === account.id && affectsRupeeBalance(t) && getAppliedBillingCycle(t, statementDay) === cycle
      ).length;
      // CHARGED, the same measure every closed row on this screen shows. It was `payable` — net of
      // payments already made — which meant the running row was the one row in the list measuring
      // something different from its neighbours, and the year group summed the two together.
      return { account, cycle, amount: getCardCycleFigures(account, data.transactions, cycle).charged, count };
    });
  }, [dues, data.transactions]);

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

  // WHAT THE MY CARDS HERO LEADS WITH, and why it is not the outstanding total.
  //
  // The root of this tree already shows outstanding, its billed/unbilled split, the combined
  // utilisation bar and the next due date — so this hero was printing the same two figures one tap
  // below them. Two screens stacked showing the same number reads as a screen that failed to load.
  //
  // The root asks WHAT YOU OWE. This screen is the roster, so it asks WHAT YOU HOLD: how many cards,
  // how much credit they add up to, what they cost you a year, and what they have paid back. None of
  // those appear anywhere else, and the last two only exist at all because this tree now tracks fees.
  const cardCount = dues.length;
  // Summed across the cards that declare a limit — the same caveat DuesTotals.creditLimit carries.
  // Absent on every card, the figure would be a confident zero, so the hero leads with outstanding
  // instead and says which one it is rather than showing a blank where a headline should be.
  const hasLimit = totals.creditLimit > 0;
  /* How many of the wallet's cards cost nothing to hold. A COUNT rather than the summed rupee fee
     this used to show, because the sum answered a question nobody has: ₹3,500 across five cards
     says nothing about whether the next renewal hits you, and it moved whenever a card was added
     even if that card was free. Which cards are free is the fact you actually carry around.

     Absent or zero annualFee IS lifetime free — the fee picker stores nothing at all for an LTF
     card, so absent is that mode's shape rather than missing data. Same rule as
     getCardFeeStanding's; see CardFees in types.ts.

     Declared fees only. A spend waiver is a per-card, per-year question that the card's own screen
     answers with a progress bar, and folding it in here would make this flip between two words as
     the month's spending crosses a threshold. */
  const ltfCount = dues.filter(d => !d.account.cardFees?.annualFee).length;

  const openCategory = (next: CardsCategory) => {
    const appRoot = document.querySelector('.app-root');
    scrollRef.current.tree = appRoot?.scrollTop ?? 0;
    // Dropped on the way IN, kept on the way back from a detail screen: the remembered position
    // belongs to one visit down and back, not to the next entry from the tree.
    scrollRef.current.category = 0;
    setStatementsFilter('all');
    setCategory(next);
  };

  /** Opens one card's SUMMARY on the in-tree screen — its only caller is a My Cards tile, and that
   *  screen is about the card rather than about any one cycle. Statements rows go to the standalone
   *  statement screen instead, which is where a cycle is read. */
  const openCard = (account: Account) => {
    const appRoot = document.querySelector('.app-root');
    scrollRef.current.category = appRoot?.scrollTop ?? 0;
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

  /**
   * The mark on a card's row, in the Dues and Statements lists alike.
   *
   * LogoAvatar — the same round frame the Accounts screen puts every bank behind — rather than the
   * issuer's wordmark in a landscape tile. The tile was defensible on its own terms (a card's
   * proportions, and the bank spelled out), but it made the one screen in the app that shows
   * institutions look nothing like the other one. A round mark also survives being small: a 4:1
   * wordmark inscribed in a 38px row has to shrink to about 9px tall to fit, which is the height at
   * which "AXIS BANK" stops being readable and becomes a grey smear.
   *
   * The name is what resolves the logo, so a co-branded card shows the CO-BRAND (Jupiter, not CSB) —
   * the same mark its detail hero already carries, and the brand printed on the plastic. When the
   * name resolves nothing, getCardLogoUrl falls back to the issuing bank in the card's saved details
   * before it will guess at a domain; see the note there for what that guess does otherwise.
   */
  const renderCardMark = (account: Account, size: number) => (
    <LogoAvatar name={account.name} logoUrl={getCardLogoUrl(account)} size={size} accountType={account.type} />
  );

  /** The utilization meter. A BAR rather than an arc: the backdrop behind it is concentric about the
   *  same centre, and a second ring there competes with the engraving instead of reading on it.
   *
   *  Takes the FRACTION already computed by sumCardDues rather than recomputing it from a total.
   *  Dividing the grand outstanding by the summed limit overstates the ratio whenever a card
   *  declares no limit, because its balance is in the numerator and its (absent) limit is not —
   *  which is the whole reason DuesTotals.utilization exists. */
  const renderUtilization = (fraction: number, limit: number) => {
    const pct = Math.min(1, Math.max(0, fraction));
    const tone = utilTone(pct);
    // The gradient is laid out across the WHOLE track and then revealed to `pct`, rather than being
    // stretched to fit the filled part. That is what makes the colour mean something: a given
    // utilization is always the same colour, instead of every card showing the full green-to-red
    // sweep compressed into however much of the bar it happens to occupy.
    const reveal = pct > 0 ? `${100 / pct}% 100%` : '100% 100%';
    return (
      <div style={{ width: '88%', maxWidth: '300px', marginTop: '1.1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span className="text-mono" style={{ fontSize: '0.64rem', color: 'var(--text-secondary)', flexShrink: 0 }}>₹0</span>

          {/* No marker riding the fill. The end of the fill IS the position — a coin sitting on it
              added a second thing to read at the same place, and at 22px it was the largest object
              in the hero after the avatar. */}
          <div style={{ position: 'relative', flex: 1, height: '18px' }}>
            <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: '100%', height: '8px', borderRadius: '4px', background: 'var(--border-color)' }} />
            <div style={{
              position: 'absolute', top: '50%', transform: 'translateY(-50%)', height: '8px',
              width: `${pct * 100}%`, borderRadius: '4px',
              backgroundImage: UTIL_GRADIENT, backgroundSize: reveal, backgroundRepeat: 'no-repeat',
              transition: 'width 0.45s ease',
            }} />
            {/* The advice line, drawn THROUGH the track rather than on it — a dot sitting on the bar
                disappears the moment the fill reaches it, which is the one moment it matters. */}
            <div style={{ position: 'absolute', left: `${UTIL_ADVICE * 100}%`, top: '50%', transform: 'translate(-50%, -50%)', width: '2px', height: '16px', borderRadius: '1px', background: 'var(--text-primary)', opacity: 0.45 }} />
          </div>

          <span className="text-mono" style={{ fontSize: '0.64rem', color: 'var(--text-secondary)', flexShrink: 0 }}>{formatWhole(limit)}</span>
        </div>

        {/* The figure the callout used to carry, back under the bar as plain text. It keeps the ramp
            colour, which is the only place the tone still shows besides the bar itself. It does NOT
            repeat "of <limit>" the way the original caption did: the limit is now the label at the
            right-hand end of the track, two lines above it. */}
        <div className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--text-secondary)', marginTop: '0.45rem' }}>
          <span style={{ color: tone, fontWeight: 800 }}>{Math.round(pct * 100)}%</span> used
        </div>
      </div>
    );
  };

  /** Billed and unbilled as two mono-labelled figures. The pair appears on both levels, so it's
   *  built once — the hero above it changes, the split does not. */
  /** Two mono-labelled figures under a hero. The shape appears under three of them, so it is built
   *  once and the labels are the caller's business. */
  const renderFigures = (
    a: { label: string; value: string; tone?: string },
    b: { label: string; value: string; tone?: string },
  ) => (
    <div className="flex justify-center" style={{ gap: '2rem', marginTop: '1rem' }}>
      {[a, b].map(cell => (
        <div key={cell.label} style={{ textAlign: 'center' }}>
          <div className="text-mono uppercase" style={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: '1px', color: 'var(--text-muted)' }}>{cell.label}</div>
          <div className="text-serif" style={{ fontSize: '1.05rem', fontWeight: 700, color: cell.tone ?? 'var(--text-primary)', marginTop: '0.15rem' }}>
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );

  /** Billed and unbilled as two mono-labelled figures. Still its own function because the tone rule
   *  is particular to it: a zero BILLED is "nothing billed yet" and reads muted, where a zero
   *  unbilled is simply a month with no spend on it and reads normally. */
  const renderSplit = (billed: number, unbilled: number) => renderFigures(
    { label: 'Billed', value: formatWhole(billed), tone: billed > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' },
    { label: 'Unbilled', value: formatWhole(unbilled) },
  );

  const statementsShown = statementsFilter === 'all' ? statements : statements.filter(st => st.account.id === statementsFilter);
  // The hero's figure is the sum of what's LISTED, which is what makes the pill row mean something:
  // narrowing to one card narrows the total with it. A cross-card aggregate that ignored the filter
  // would be a number the screen shows but the screen can't explain.
  const statementsTotal = statementsShown.reduce((sum, st) => sum + st.amount, 0);
  // What the Statements hero says depends on which list is under it. Under "All" that list is one
  // open cycle per card, so the hero has to total THOSE — a "billed across 15 statements" figure over
  // a list of three current cycles would be a number the screen shows and the screen can't explain.
  const showingOpenRows = statementsFilter === 'all';
  // What this year has cost, on whatever the pill has narrowed to. The figure above it is the whole
  // history of the listed cards, which grows for ever and so answers no question anyone asks twice;
  // this one resets every April and is the number a year is actually judged on.
  const currentYear = cycleYear(format(new Date(), 'yyyy-MM'));
  // The card's own running cycle. Without it, selecting a card was a step BACKWARDS from "All": the
  // cross-card list leads with every card's live cycle, and narrowing to one of them dropped exactly
  // that row — so the month you are actually spending in vanished the moment you asked about it.
  //
  // It belongs INSIDE its financial year rather than floating above the groups. September 2026 is in
  // FY 26-27 as surely as August is, and a row sitting outside the only group it could belong to
  // reads as an exception to a rule nobody stated. Being in the group also means it is counted and
  // totalled with the rest — a header that says "5 cycles" over six rows is the next bug report.
  const openRow = showingOpenRows ? null : openRows.find(r => r.account.id === statementsFilter) ?? null;

  // Newest year first, and the rows inside each keep the order `statements` already sorted them
  // into. A card three years old lists thirty-odd statements, which is an archive rather than a
  // list; grouped by year it is four rows with one of them open.
  const statementGroups: [number, StatementRow[]][] = [];
  const pushRow = (row: StatementRow) => {
    const year = cycleYear(row.cycle);
    const group = statementGroups.find(g => g[0] === year);
    if (group) group[1].push(row); else statementGroups.push([year, [row]]);
  };
  // The running cycle leads its year: within a group the rows already run newest first, and it is
  // the newest of all.
  if (openRow) {
    pushRow({
      account: openRow.account, cycle: openRow.cycle, amount: openRow.amount,
      due: openRow.amount, settled: false, spend: openRow.amount, credits: 0,
      adjusted: false, status: 'open', count: openRow.count,
    });
  }
  for (const st of statementsShown) pushRow(st);
  statementGroups.sort((a, b) => b[0] - a[0]);
  const isYearOpen = (year: number) => yearOpen[year] ?? (year === currentYear);
  // The year's charged total, counting the RUNNING cycles as well — they are rows in the current
  // year's group like any other, so the group header and this figure have to agree.
  //
  // CHARGED, not billed and not spent. It has to be true of a month still open, which rules out
  // "billed"; and this app has already given "spent" a narrower meaning — raw debits, as in
  // "₹17,747 spent − ₹887 credited" — while this figure is net of those credits.
  const inCurrentYear = (cycle: string) => cycleYear(cycle) === currentYear;
  const statementsYearTotal =
    (statementsFilter === 'all' ? statements : statementsShown)
      .filter(st => inCurrentYear(st.cycle))
      .reduce((sum, st) => sum + st.amount, 0)
    + openRows
      .filter(r => (statementsFilter === 'all' || r.account.id === statementsFilter) && inCurrentYear(r.cycle))
      .reduce((sum, r) => sum + r.amount, 0);
  const statementsAllTimeTotal = statementsTotal + (openRow?.amount ?? 0);

  // THE HERO LEADS WITH THE YEAR, not with the card's whole history, and the trailing line carries
  // what it displaced.
  //
  // All-time on a credit card only ever grows: you cannot act on it, compare it, or be surprised by
  // it, and it answers no question anyone asks twice. The year resets, which makes it the figure
  // worth quoting and the one that reads differently next time. It is also what is ON SCREEN — years
  // are collapsible and only the current one opens by default, so leading with all-time meant
  // totalling rows that are folded away. And every other hero in this app leads with something live:
  // Dues with what is outstanding, the Portfolio with current value, and this very screen under
  // "All" with the running total rather than with history.
  //
  // The cost, taken deliberately: the figure now echoes the current year's group header a couple of
  // lines below. That is a big serif total agreeing with a small mono section header, which reads as
  // confirmation — unlike two identical small figures stacked in one block, which reads as a fault.
  const statementsHeroTotal = showingOpenRows
    ? openRows.reduce((sum, r) => sum + r.amount, 0)
    : statementsYearTotal;
  const statementsHeroNote = showingOpenRows
    ? `Running across ${openRows.length} card${openRows.length === 1 ? '' : 's'}`
    : `Charged in ${currentYear}`;
  // Which figure leads the Rewards hero, and which one trails it under the rule.
  //
  // The list below decides. On FILTER: PENDING it lists only what is still owed, so the hero leads
  // with that; on SHOWING ALL it lists every cycle ever earned, so the hero leads with the lifetime
  // total. The two swap places rather than one replacing the other, because both are worth seeing
  // either way round — what changes is which of them the screen is currently ABOUT.
  const rewardLead = rewardsShowAll ? rewards.lifetime : rewards.pending;
  const rewardTrail = rewardsShowAll ? rewards.pending : rewards.lifetime;
  const pendingPhrase = rewards.pending.count > 0
    ? `${rewards.pending.count} awaiting credit`
    : 'Everything credited';
  const leadCaption = rewardsShowAll ? 'Earned all-time' : pendingPhrase;
  const trailCaption = rewardsShowAll
    ? (rewards.pending.count > 0 ? `${rewards.pending.count} still pending` : 'Nothing pending')
    : 'Earned all-time';
  // The units that don't already lead the Rewards hero.
  const unitLines = trailingUnits(rewardLead);
  // The trailing figure's line, spelled out rather than folded into a "+1". A count of units is not
  // a fact anyone wants — "630 jewels" is, and it is the whole reason the service refuses to convert
  // units into rupees in the first place. Two at most, then a count, because this stays ONE line.
  const trailUnits = trailingUnits(rewardTrail);
  const trailUnitText = [
    ...trailUnits.slice(0, 2).map(u => `${Math.round(u.amount)} ${u.unit.toLowerCase()}`),
    ...(trailUnits.length > 2 ? [`+${trailUnits.length - 2} more`] : []),
  ].join(' · ');

  return (
    <div style={{ background: 'var(--bg-primary)', paddingBottom: '100px' }}>
      {/* ───────────────────────── Level 1: the tree ───────────────────────── */}
      {!activeCategory && !activeCard && (
        <>
          {/* position/overflow for the backdrop, which is absolutely positioned to this box and
              bleeds past the horizontal padding. minHeight gives the square drawing room to render
              at full size, and the centring is what lands the hero's stack on the card plate — see
              COMPOSITION in relief.tsx. */}
              {/* Out of the tree entirely, back to the Dashboard this screen was opened from. The
                  sub-views below have had a chevron here since they existed; the ROOT had none, so
                  the one screen you always arrive at from somewhere else was the one with no way
                  back except the bottom nav. Same control, same place, so it reads as one level up
                  rather than a different kind of exit. The negative margin below is what lets the
                  hero overlap this row, exactly as CategoryHero does for the sub-views. */}
              {onExit && <SubviewHeader title="" onBack={onExit} hideTitle />}
          <div className="tour-cards-summary" style={{ position: 'relative', overflow: 'hidden', minHeight: '400px', marginTop: onExit ? '-28px' : undefined, padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
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
              {/* No iconColor on any of the three: they take CategoryCard's default accent, so the
                  tiles are uniform indigo here exactly as they are on Wealth's Portfolio, Assets and
                  Retirement rows. The icon glyph is what tells the categories apart; colouring the
                  tiles as well made the two trees look like they came from different apps, and the
                  colours were not carrying meaning that the glyph and the label did not already. */}
              <CategoryCard
                icon={<CreditCard size={20} />}
                label={CATEGORY_LABELS.mycards}
                subtext="Dues, fees & rewards"
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
                onClick={() => openCategory('mycards')}
                tourClass="tour-cards-cat-mycards"
              />

              {/* Only when there IS history. A chevron into an empty list is a dead end, which is the
                  rule Wealth's tree already follows for a category with nothing in it. */}
              {statements.length > 0 && (
                <CategoryCard
                  icon={<FileText size={20} />}
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
      {activeCategory === 'mycards' && !activeCard && (
        <div className="fade-in">
          <SubviewHeader title="Cards" onBack={() => setCategory(null)} hideTitle />

          <CategoryHero backdrop={<MyCardsBackdrop />} label={CATEGORY_LABELS.mycards} minHeight="360px" userName={data.user?.name} possessive={false}>
            <div className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              {formatWhole(hasLimit ? totals.creditLimit : totals.outstanding)}
            </div>
            {/* The count rides in the caption rather than as the headline. It IS the fact the screen
                is about, but a bare numeral set at 2.5rem under a label reading MY CARDS reads as a
                figure that failed to render — and the caption is where the reader looks to find out
                what the big number means anyway. */}
            <div className="text-mono uppercase" style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-secondary)', marginTop: '0.6rem' }}>
              {cardCount} card{cardCount === 1 ? '' : 's'} · {hasLimit ? 'total limit' : 'outstanding'}
            </div>
            {/* Labels kept SHORT, and it is a measured constraint rather than a style preference.
                "Fees / year" and "Earned all-time" set this row 221 units wide, which pushed its
                left edge to x 89 — over the reader's screen, so the hero's label and the drawing's
                own PAYMENT SUCCESSFUL overlapped as two pieces of type in the same place. At these
                lengths the row is 142 wide and both clear columns come back. */}
            {/* "2 of 5" rather than "2 LTF · 3 paid", and the constraint above is the reason: at
                1.05rem serif a fourteen-character value sets this cell wider than BOTH labels did
                when they broke the layout. The label carries the subject so the value can be a bare
                count — which also makes every state fit in eight characters or fewer. */}
            {renderFigures(
              {
                label: 'LTF',
                value: ltfCount === cardCount ? 'All' : ltfCount === 0 ? 'None' : `${ltfCount} of ${cardCount}`,
                tone: ltfCount === cardCount ? 'var(--success)' : undefined,
              },
              { label: 'Earned', value: leadFigure(rewards.lifetime), tone: 'var(--success)' },
            )}
          </CategoryHero>

          {/* The pill row that used to sit at the foot of this hero is gone, and so is the ruled list
              it filtered. They were two controls naming the same cards a few pixels apart — one to
              narrow the list, one to open a card — and the tiles below do both jobs with one object.
              Losing the pills also gives the hero its bottom band back, which the motif redesign
              needs; it had been a strip of chrome sitting on the drawing. */}
          <div style={{ padding: '0.5rem 1.5rem calc(1.5rem + var(--safe-area-inset-bottom))' }}>
            <CardTileGrid dues={dues} onOpen={openCard} />
          </div>
        </div>
      )}

      {/* ───────────────────────── Level 2: Statements ───────────────────────── */}
      {activeCategory === 'statements' && !activeCard && (
        <div className="fade-in">
          <SubviewHeader title={CATEGORY_LABELS.statements} onBack={() => setCategory(null)} hideTitle />

          <CategoryHero
            backdrop={<StatementsBackdrop />}
            label={CATEGORY_LABELS.statements} minHeight="340px" userName={data.user?.name}
          >
            <div className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              {formatWhole(statementsHeroTotal)}
            </div>
            <div className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--text-secondary)', marginTop: '0.6rem' }}>
              {statementsHeroNote}
            </div>
            {/* The wider frame around whatever the hero leads with: under "All" that lead is a live
                running total, so this carries the year; under a card the lead IS the year, so this
                carries the history behind it. Either way it only renders when it says something the
                figure above does not — on a card whose whole history is one year the two are the
                same number, and printing it twice reads as a fault rather than a coincidence.

                ADDING THIS LINE MOVED EVERY BAND BELOW IT. The backdrop's folds are solved against a
                measured map of this hero's content — see the note at the top of StatementsBackdrop —
                so it was re-measured and the pitch re-solved when this went in. It keeps its slot in
                that map whether or not it renders, because the map is solved for the taller case.
                Any further line here needs the same treatment; it is not a free addition. */}
            <div className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--text-muted)', marginTop: '0.35rem', minHeight: '1em' }}>
              {showingOpenRows
                ? `${currentYear} · ${formatWhole(statementsYearTotal)} charged`
                : statementsAllTimeTotal !== statementsYearTotal
                  ? `All time · ${formatWhole(statementsAllTimeTotal)}`
                  : ''}
            </div>
            <FilterPills
              tabs={[
                { v: 'all', label: 'All' },
                // EVERY card, including one with no closed statement yet. It used to be only cards
                // that had one, on the reasoning that a pill filtering to an empty list is a dead
                // end — but the "All" list above shows all of them, so a card present in the list
                // and absent from the pills reads as a bug, and the user goes looking for a pill
                // that was never rendered. The empty state below is the honest answer instead.
                ...dues.map(d => ({ v: d.account.id, label: d.account.name.split(/[ ×x]/)[0] })),
              ]}
              active={statementsFilter}
              onSelect={setStatementsFilter}
              marginTop="1.25rem"
              flexible
              pillWidth={92}
              // Lets the row scroll once the pills stop fitting; whether they fit is measured.
              scrollable
            />
          </CategoryHero>

          <div style={{ padding: '0.5rem 1.5rem calc(1.5rem + var(--safe-area-inset-bottom))' }}>
            {/* Both lists open the same place: the standalone statement screen the Accounts tab
                opens, which carries a picker for every cycle behind the one it lands on. Under "All"
                a row is a card at its running cycle and lands there; under a card's pill a row is a
                named closed month and lands on THAT month, not on today's. That picker is where the
                per-cycle history the "All" list used to enumerate now lives, which is why collapsing
                it costs nothing — it moved one tap deeper into a control built for it. */}
            {showingOpenRows ? openRows.map(row => (
              <div
                key={row.account.id}
                onClick={() => onViewStatement?.(row.account)}
                className="clickable"
                style={{
                  padding: '1rem 0', borderBottom: '1px solid var(--border-color)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.9rem',
                }}
              >
                {renderCardMark(row.account, 38)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.account.name}
                  </div>
                  <div className="text-mono uppercase" style={{ fontSize: '0.58rem', color: 'var(--text-secondary)', marginTop: '0.2rem', letterSpacing: '0.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatBillingCycleRange(row.cycle, row.account.statementDay || 1)}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: row.amount > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {formatCurrency(row.amount)}
                  </div>
                  {/* No "Open" here. Every row in this list is a card's running cycle — that is what
                      the list IS — and the hero above already says "Running across N cards". */}
                  <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--accent)', marginTop: '0.2rem', letterSpacing: '0.5px' }}>
                    {row.count} {row.count === 1 ? 'transaction' : 'transactions'}
                  </div>
                </div>
              </div>
            )) : (
              <>
                {/* Only reachable when the card has no cycles at all — its running one is a row in
                    the groups above like any other, so a card with any history whatsoever has a
                    group. Said rather than left blank: a blank panel reads as a list that failed. */}
                {statementGroups.length === 0 && (
                  <div style={{ padding: '2.5rem 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    Nothing on this card yet.
                  </div>
                )}
                {statementGroups.map(([year, rows]) => {
              const open = isYearOpen(year);
              const yearTotal = rows.reduce((sum, st) => sum + st.amount, 0);
              return (
                <div key={year} style={{ marginTop: '1.1rem' }}>
                  {/* The year's own row, in the app's one section-heading shape — the same header
                      Wealth puts over its holdings, so a collapsible group looks like a collapsible
                      group wherever the user meets one. It carries no mark and no status: the ladder
                      describes a bill, and a year is not one. */}
                  <SectionHeading
                    label={String(year)}
                    count={rows.length}
                    // "2026 · 5" alone is the case that made the noun necessary: the label names a
                    // period, not a thing, so the number has nothing to attach to.
                    countNoun="cycle"
                    trailing={
                      <span className="text-mono" style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {formatWhole(yearTotal)}
                      </span>
                    }
                    chevron={
                      <ChevronDown
                        size={15}
                        style={{ color: 'var(--text-secondary)', flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                      />
                    }
                    onClick={() => setYearOpen(prev => ({ ...prev, [year]: !open }))}
                    marginBottom={open ? '0.25rem' : 0}
                  />
                  {open && rows.map(st => {
                    const statementDay = st.account.statementDay || 1;
                    return (
                <div
                  key={`${st.account.id}-${st.cycle}`}
                  onClick={() => onViewStatement?.(st.account, st.cycle)}
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
                  <CycleMark amount={st.amount} due={st.due} status={st.status} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* The month leads and the dates follow, because a cut day of the 26th means
                        "August" spans two calendar months and the row has to say which days. */}
                    <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                      {format(parseISO(`${st.cycle}-01`), "MMMM yyyy")}
                    </div>
                    {/* The dates, and nothing else. The entry count and the raw spend both lived
                        here and both were detail rather than orientation: five rows each carrying a
                        second figure made the list read as dense as the statement it points at. They
                        are one tap away, on a screen built to hold them. "Adjusted" stays, because a
                        hand-entered figure that looks derived is a caveat, not a detail. */}
                    <div className="text-mono uppercase" style={{ fontSize: '0.58rem', color: 'var(--text-secondary)', marginTop: '0.2rem', letterSpacing: '0.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatBillingCycleRange(st.cycle, statementDay, false)}
                      {st.adjusted ? ' · Adjusted' : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: st.amount > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {formatCurrency(st.amount)}
                    </div>
                    {/* The same word the icon means, from the same ladder. */}
                    <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, color: CYCLE_LOOK[st.status].tone, marginTop: '0.2rem', letterSpacing: '0.5px' }}>
                      {st.status === 'empty' ? '—' : CYCLE_STATUS_LABEL[st.status]}
                    </div>
                  </div>
                </div>
                    );
                  })}
                </div>
              );
            })}
              </>
            )}
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
          <CategoryHero backdrop={<RewardsBackdrop />} label={CATEGORY_LABELS.rewards} minHeight="392px" userName={data.user?.name}>
            {/* The lead figure — pending or lifetime, whichever the list below is currently about. */}
            <div className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              {leadFigure(rewardLead)}
            </div>
            {/* One line per remaining unit, and at most two of them. Never converted into the figure
                above: a conversion rate is what a point is worth if you spend it a particular way,
                not what you are owed. */}
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
              {leadCaption}
            </div>

            {/* The other figure, under a rule: its amount and units on one line, its caption on the
                next. Two lines rather than one, because the caption reads as a LABEL for the figure
                when it sits beneath it and as a third item in a list when it sits beside it — which
                is what "₹3,412 · 630 jewels · Earned all-time" was, three things separated by the
                same dot with no way to tell which of them the caption belonged to.
                Still capped at two lines whichever way the filter is set: it is the counterweight to
                the lead, not a second headline, and the drawing behind this hero only has room in
                the strips above and below the content. */}
            <div style={{ width: '58%', maxWidth: '220px', height: '1px', background: 'var(--border-color)', opacity: 0.5, margin: '0.85rem 0 0.65rem' }} />
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span className="text-serif" style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                {leadFigure(rewardTrail)}
              </span>
              {trailUnitText && (
                <span className="text-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '1px', color: 'var(--text-muted)' }}>
                  · {trailUnitText}
                </span>
              )}
            </div>
            <div className="text-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '1px', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              {trailCaption}
            </div>
          </CategoryHero>

          <div style={{ paddingBottom: 'calc(1.5rem + var(--safe-area-inset-bottom))' }}>
            <Cashback embedded showAll={rewardsShowAll} onShowAllChange={setRewardsShowAll} />
          </div>
        </div>
      )}

      {/* ───────────────────────── Level 3: one card, whole ───────────────────────── */}
      {activeCard && (() => {
        const cardDues = activeCard;
        const card = cardDues.account;

        // ONE YEAR FOR THE WHOLE SCREEN. Three figures below say "this year" — waiver progress,
        // spend, cashback — and if any of them meant a different twelve months the screen would
        // contradict itself in a way no label could rescue. See CardYearService for why that year is
        // the membership year and what happens when the card has no open date.
        const year = getCardYear(card);
        const spend = getCardSpendFigures(card, data.transactions, year);
        const fees = getCardFeeStanding(card, year, spend.yearSpend);
        const yearRewards = summariseCardRewards(rewards.rows, data.accounts, card.id, year);
        const lifeRewards = summariseCardRewards(rewards.rows, data.accounts, card.id);

        const last4 = card.cardDetails?.cardNumber?.replace(/\D/g, '').slice(-4);
        const identity = ['Credit card', card.cardDetails?.network?.toUpperCase(), last4 && `•••• ${last4}`]
          .filter(Boolean).join(' · ');

        // What the card costs, as one line, and an ABSENT fee block reads as LTF.
        //
        // It used to say "Not set" on the reasoning that a blank card is one nobody has described,
        // and announcing it free would be the screen inventing an answer. The fee picker settled
        // that: "Lifetime free" is now a mode you choose, and choosing it deliberately stores
        // nothing at all (see buildCardFees) — so absent and "told, and it is free" became the same
        // value, and there is nothing left to tell apart. LTF is also the right default to be wrong
        // about: it is the commonest card in the country by a wide margin.
        const feeLine = fees.lifetimeFree
          ? 'LTF'
          : [
              fees.inFirstFreeYear ? 'First year free' : null,
              fees.annualFee ? `${formatWhole(fees.annualFee)}/yr` : null,
              fees.joiningFee ? `${formatWhole(fees.joiningFee)} joining` : null,
            ].filter(Boolean).join(' · ');

        return (
          <div className="fade-in" style={{ boxSizing: 'border-box' }}>
            <SubviewHeader title={CATEGORY_LABELS[activeCategory ?? 'mycards']} onBack={() => setSelectedCardId(null)} hideTitle />

            <DetailHeroBand />

            {/* Identity block — the same shape as Wealth's holding detail, down to the lift that sets
                the mark into the panel above, so the app's two detail screens read as one screen. */}
            <div style={{ padding: '0 1.5rem 0.5rem', marginTop: `-${DETAIL_HERO_LIFT}px`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <SealedMark>
                {/* The wax is a CIRCLE centred on this box, which is why the mark inside it has to be
                    round: an issuer lockup is a 6:1 plate (HDFC) or a 4:1 wordmark (Axis), and
                    inscribed here it leaves an 8px-tall sliver that reads as a sticker stuck on the
                    seal rather than a device struck into it. LogoAvatar resolves the co-brand's round
                    mark and falls back to a monogram, which is what a seal carries anyway. The tiles
                    this screen is opened from now use the same avatar, so the mark does not change
                    shape on the way in. */}
                <LogoAvatar name={card.name} logoUrl={getCardLogoUrl(card)} size={DETAIL_HERO_AVATAR} accountType={card.type} />
              </SealedMark>

              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35, maxWidth: '90%' }}>
                {card.name}
              </div>
              <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.4rem', letterSpacing: '1px' }}>
                {identity}
              </div>

              <div className="text-serif" style={{ fontSize: '2.6rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '1.25rem', lineHeight: 1 }}>
                {formatCurrency(cardDues.outstanding)}
              </div>
              {renderSplit(cardDues.billed, cardDues.unbilled)}
              {cardDues.utilization !== undefined && renderUtilization(cardDues.utilization, cardDues.creditLimit ?? 0)}
              {dueSentence(cardDues) && (
                <div className="text-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.5px', color: dueColor(cardDues), marginTop: '1rem' }}>
                  {dueSentence(cardDues)}
                </div>
              )}
            </div>

            <div style={{ padding: '0 1.5rem calc(1.5rem + var(--safe-area-inset-bottom))' }}>
              {/* The plastic itself, one tap away. Same overlay the Accounts screen opens, taking
                  nothing but the account — so the card that flips here is the card that flips there,
                  rather than a second rendering of it that could drift. */}
              <button
                className="btn btn-secondary"
                style={{ width: '100%', marginTop: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                onClick={() => setViewingCard(card)}
              >
                <CreditCard size={16} />
                <span>View card</span>
              </button>

              {/* ── The membership year ────────────────────────────────────────────────────────
                  Named with its actual dates rather than as "this year", because on this screen it
                  is genuinely not obvious which twelve months are meant — and when the card has no
                  open date it is not even the year the bank would use. Saying which one you are
                  looking at costs a line and removes the whole question. */}
              <div style={{ marginTop: '1.75rem' }}>
                <SectionHeading label={year.isAnniversary ? 'Membership year' : 'Financial year'} count={null} marginBottom="0.4rem" />
              </div>
              <div className="text-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                {year.label}
                {!year.isAnniversary && (
                  <span style={{ color: 'var(--text-muted)' }}> · no open date set</span>
                )}
              </div>

              {/* Fees, then the waiver bar under them — the bar is the fee's fate, so it belongs
                  below the figure it decides rather than in a block of its own. */}
              <div className="card" style={{ padding: '1rem 1.15rem' }}>
                <div className="flex justify-between align-center" style={{ gap: '1rem' }}>
                  <div className="text-mono uppercase" style={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: '1px', color: 'var(--text-muted)' }}>
                    Card fees
                  </div>
                  <div className="text-serif" style={{ fontSize: '0.95rem', fontWeight: 700, color: card.cardFees ? 'var(--text-primary)' : 'var(--text-muted)', textAlign: 'right' }}>
                    {feeLine}
                  </div>
                </div>

                {fees.waiverSpend !== undefined && (
                  <div style={{ marginTop: '1rem' }}>
                    <div className="flex justify-between align-center" style={{ gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <span className="text-mono uppercase" style={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: '1px', color: 'var(--text-muted)' }}>
                        Fee waiver
                      </span>
                      <span className="text-mono" style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>
                        {formatWhole(spend.yearSpend)} / {formatWhole(fees.waiverSpend)}
                      </span>
                    </div>
                    {/* A plain track rather than the utilization ramp above it. That bar is coloured
                        because the MIDDLE of it means something — 30% is the advice line — whereas
                        here only the end does: you have either cleared the bar or you have not, and
                        a green-to-red sweep would say a half-met waiver was going badly when it is
                        simply half-met in August. */}
                    <div style={{ position: 'relative', width: '100%', height: '8px', borderRadius: '4px', background: 'var(--border-color)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${(fees.waiverProgress ?? 0) * 100}%`,
                        height: '100%',
                        borderRadius: '4px',
                        background: fees.waiverMet ? 'var(--success)' : 'var(--accent)',
                        transition: 'width 0.45s ease',
                      }} />
                    </div>
                    <div className="text-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.5px', marginTop: '0.5rem', color: fees.waiverMet ? 'var(--success)' : 'var(--text-secondary)' }}>
                      {fees.waiverMet
                        ? 'Waived · next annual fee is off'
                        : `${formatWhole(fees.waiverRemaining ?? 0)} to go · ${year.daysLeft} day${year.daysLeft === 1 ? '' : 's'} left`}
                    </div>
                  </div>
                )}

                {/* Offered only where it would change what is on screen: a card with a waiver but no
                    open date is the one case where the missing date costs you a bar rather than just
                    a label. Anywhere else this would be a nag. */}
                {card.cardFees?.waiverSpend !== undefined && !year.isAnniversary && (
                  <div className="text-mono uppercase" style={{ fontSize: '0.55rem', letterSpacing: '0.5px', color: 'var(--text-muted)', marginTop: '0.75rem', lineHeight: 1.6 }}>
                    Set the card's opening date in Accounts to track this waiver over the year your bank actually measures
                  </div>
                )}
              </div>

              {/* Spend, then rewards — each a year figure beside its all-time counterpart, and each
                  collapsing to one cell while those two agree. See StatPair. */}
              <StatPair
                marginTop="0.85rem"
                same={spend.yearSpend === spend.lifetimeSpend}
                yearLabel="Spent this year" allLabel="Spent all-time" bothLabel="Spent this year & all-time"
                yearValue={formatWhole(spend.yearSpend)} allValue={formatWhole(spend.lifetimeSpend)}
              />

              {/* Cashback through leadFigure, the same formatter the Rewards hero uses — so a card
                  that pays in Jewels says "630 jewels" here too rather than a rupee figure it never
                  earned. Units are never converted; see RewardsService. */}
              <StatPair
                marginTop="0.75rem"
                same={sameRewards(yearRewards, lifeRewards)}
                yearLabel="Earned this year" allLabel="Earned all-time" bothLabel="Earned this year & all-time"
                yearValue={leadFigure(yearRewards)} allValue={leadFigure(lifeRewards)}
                tone="var(--success)"
              />
            </div>
          </div>
        );
      })()}

      {viewingCard && <ViewCardOverlay account={viewingCard} onClose={() => setViewingCard(null)} />}
    </div>
  );
}
