import React, { useState, useRef, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { useFinance } from '../FinanceContext';
import type { Transaction, TransactionType, Account, InvestmentKind } from '../types';
import { formatCurrency, formatAmount, formatDateString, getCurrentMonthStr, isStatsExcludedCategory, isInvestmentCategory, INVESTMENT_KIND_OPTIONS, investmentKindLabel, getInvestmentKind, isCountableTransaction, isExternalRewardSource, isPointsDenominated, getRewardSplits, rewardSplitIndexOfLeg, rewardSplitOfLeg, rewardSplitTotal, rewardSplitGross, accountNameOf, linkedGroupOf, applyVisibleReorder, dayOrderUpdates, sortDayByOrder } from '../utils';
import { Wallet, ArrowRightLeft, Calendar, Activity, X, Search, Smartphone, ChevronRight, ChevronDown, Hash, Shapes, Layers, Sparkles, Loader2, Filter, ArrowUp } from 'lucide-react';
import { CustomPicker } from './CustomPicker';
import ConfirmDialog from './ConfirmDialog';
import { getCategoryIcon, getAccountTypeIcon, getAccountGroupLabel, getInvestmentKindIcon } from './transactionIcons';
import { LogTransactionForm } from './LogTransactionForm';

// The anchor a reward-redemption leg belongs to — and WHICH of its sources this leg is — or null if
// `tx` isn't one. A leg carries no editable identity of its own: its amount is its source's amount on
// the anchor, its account is that source's account, and description/category/date are derived and
// propagated down — so tapping one has to edit the anchor instead. The index comes back with it
// because a split can be funded from several wallets, each with its own leg in the ledger: the form
// has to open at the card the tap came from, or it would land on the first source every time.
//
// Matched through rewardSplitOfLeg (leg id first, account for a legacy row) rather than on
// `isRewardTransaction`, which is only set when the reward source is points-denominated (a rupee
// wallet like CRED coins leaves it false). The `p.id !== tx.id` guard is load-bearing: a card
// redeeming its OWN points has leg.accountId === anchor.accountId, so without it the anchor, whose
// linkedTransactionIds point back at the leg, would resolve to itself.
function rewardSplitAnchorOf(
  tx: Transaction,
  transactions: Transaction[],
): { anchor: Transaction; index: number } | null {
  const linkedIds = tx.linkedTransactionIds || (tx.linkedTransactionId ? [tx.linkedTransactionId] : []);
  if (!linkedIds.length) return null;
  const anchor = transactions.find(p =>
    p.id !== tx.id
    && linkedIds.includes(p.id)
    && !!rewardSplitOfLeg(p, tx)
  );
  return anchor ? { anchor, index: Math.max(0, rewardSplitIndexOfLeg(anchor, tx)) } : null;
}


function TransactionRow({ tx, acc, isFirst, isLast, onEdit, onDelete, onMoveBy, blockLen, counterparts }: {
  tx: Transaction,
  acc: Account | undefined,
  isFirst: boolean,
  isLast: boolean,
  onEdit: (tx: Transaction) => void,
  onDelete: (id: string) => void,
  onMoveBy: (steps: number) => boolean,
  blockLen: number,
  counterparts?: { tx: Transaction; acc: Account | undefined }[]
}) {
  const { data } = useFinance();
  const [isCounterpartExpanded, setIsCounterpartExpanded] = useState(false);
  const isDemoAnimatingRow = tx.id === 'demo_tx_2' || tx.id === 'demo_tx_3';
  // Hoisted out of the icon lookup below so the kind label pill (next to the category pill) can
  // use it too, without a second, possibly inconsistent lookup.
  const invKind = getInvestmentKind(tx, data.accounts);
  // The full price of a part-paid purchase, and what came from elsewhere. 0 on anything that is not
  // a split — see rewardSplitGross, which is where the reasoning lives.
  const splitPaidElsewhere = rewardSplitTotal(tx);
  const splitGross = rewardSplitGross(tx);
  // How much of that "elsewhere" money is ACTUALLY IN THIS VIEW, as legs rendered under this row.
  // Counterparts are built from the filtered day list, so filtering the ledger to the card takes the
  // wallet leg out of both the counterparts and the day and month totals — and the headline was the
  // one figure that carried on quoting the full price regardless. A ₹187 row over a ₹106 day total,
  // with the ₹81 that explains the gap filtered out of reach.
  //
  // Read off the SPLIT rather than the leg's own amount: the split's figure is the one
  // rewardSplitTotal added up, so a row with every leg present lands back on splitGross exactly,
  // with no float drift deciding which branch below is taken.
  const splitShownHere = (counterparts || []).reduce(
    (sum, c) => sum + (rewardSplitOfLeg(tx, c.tx)?.amount || 0), 0);
  // What the screen can account for, which is what the totals beside it counted. Equals splitGross
  // unfiltered, and tx.amount once the legs are filtered away.
  const headline = tx.amount + splitShownHere;
  const [swipeX, setSwipeX] = useState(0);
  const [swipeY, setSwipeY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStart = useRef({ x: 0, y: 0, time: 0, dir: 'none' });
  const reorderTimer = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const isTouch = 'touches' in e;
    const touch = isTouch ? (e as React.TouchEvent).touches[0] : (e as React.MouseEvent);
    touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now(), dir: 'none' };

    if (reorderTimer.current) clearTimeout(reorderTimer.current);
    setIsDragging(false);

    reorderTimer.current = window.setTimeout(() => {
      setIsDragging(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
    }, 450);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;

    if (!isDragging) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        if (reorderTimer.current) {
          clearTimeout(reorderTimer.current);
          reorderTimer.current = null;
        }
      }

      if (touchStart.current.dir === 'none') {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          touchStart.current.dir = 'horizontal';
        } else if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          touchStart.current.dir = 'vertical';
        }
      }

      if (touchStart.current.dir === 'horizontal') {
        setSwipeX(dx);
      }
      setSwipeY(dy);
    } else {
      e.preventDefault();
      // Walk the ACTUAL rendered neighbours (the outer wrappers) and consume their real heights,
      // not a single assumed row height. A neighbour with a child leg renders as one tall row but
      // spans several array slots (data-block-len), so crossing it visually must advance the array
      // by that many slots — otherwise the drag stalls when passing a log that has children.
      const wrapper = rowRef.current?.parentElement || null;
      let consumedPx = 0;   // visual pixels of neighbours fully crossed since the anchor
      let arraySteps = 0;   // array slots those neighbours occupy (signed)
      if (wrapper) {
        if (dy > 0 && !isLast) {
          let sib = wrapper.nextElementSibling as HTMLElement | null;
          while (sib && dy - consumedPx >= sib.offsetHeight) {
            consumedPx += sib.offsetHeight;
            arraySteps += Number(sib.dataset.blockLen) || 1;
            sib = sib.nextElementSibling as HTMLElement | null;
          }
        } else if (dy < 0 && !isFirst) {
          let sib = wrapper.previousElementSibling as HTMLElement | null;
          while (sib && -dy - consumedPx >= sib.offsetHeight) {
            consumedPx += sib.offsetHeight;
            arraySteps -= Number(sib.dataset.blockLen) || 1;
            sib = sib.previousElementSibling as HTMLElement | null;
          }
        }
      }
      if (arraySteps !== 0) {
        // onMoveBy returns false when a prior reorder from THIS drag hasn't committed to
        // React state yet (rapid touchmove on a fling). If we advanced the anchor anyway we'd
        // drop that crossing on the floor; instead leave the anchor put so the very next event
        // — after the DOM has caught up — re-detects and applies the same crossing. This stops
        // overlapping full-day renumbers built from stale snapshots (the "rows above reversed"
        // glitch).
        const applied = onMoveBy(arraySteps);
        if (applied) {
          // Advance the anchor by the visual distance crossed (signed) so the leftover sub-row
          // remainder becomes the live translateY below — the row stays glued to the finger.
          touchStart.current.y += dy > 0 ? consumedPx : -consumedPx;
        }
      }
      // Live follow: translate the whole group by whatever finger offset hasn't been consumed
      // into a slot swap yet, so the dragged row sits under the finger instead of trailing it.
      setSwipeY(touch.clientY - touchStart.current.y);
    }
  };

  const handleTouchEnd = () => {
    if (reorderTimer.current) {
      clearTimeout(reorderTimer.current);
      reorderTimer.current = null;
    }
    const duration = Date.now() - touchStart.current.time;
    // Require a slightly longer press or very still tap to open edit
    const isQuickTap = duration < 300 && Math.abs(swipeX) < 5 && Math.abs(swipeY) < 5 && !isDragging;
    if (isQuickTap) {
      onEdit(tx);
    }
    if (swipeX > 150) {
      onDelete(tx.id);
    }
    setSwipeX(0);
    setSwipeY(0);
    setIsDragging(false);
  };

  // Android fires touchcancel (NOT touchend) when a gesture is interrupted — e.g. the app is
  // backgrounded or a notification shade opens mid-drag. Without this, isDragging stays stuck
  // true, the document-level touchmove blocker below is never removed, and ALL scrolling
  // (lists and dropdowns) freezes until a cold start. Reset state only — no edit/delete.
  const handleTouchCancel = () => {
    if (reorderTimer.current) {
      clearTimeout(reorderTimer.current);
      reorderTimer.current = null;
    }
    setSwipeX(0);
    setSwipeY(0);
    setIsDragging(false);
  };

  useEffect(() => {
    if (!isDragging) return;

    // For Native WebViews (Capacitor), explicitly lock the scroll container
    document.querySelector('.app-root')?.classList.add('no-scroll');

    const preventScroll = (e: TouchEvent) => {
      e.preventDefault();
    };
    document.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      // Re-query rather than reuse a captured node — the .app-root reference could be stale
      // after a re-render, which would leave the lock applied to the live element.
      document.querySelector('.app-root')?.classList.remove('no-scroll');
      document.removeEventListener('touchmove', preventScroll);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => handleTouchStart(e);
  const handleMouseUp = () => handleTouchEnd();

  const hasCounterparts = counterparts && counterparts.length > 0;

  return (
    <div
      data-block-len={blockLen}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        borderBottom: '1px solid var(--border-color)',
        overflow: hasCounterparts ? 'visible' : undefined,
        // While dragging, lift the whole group and glide it under the finger (translateY). zIndex
        // floats it above neighbours; transition off so it tracks 1:1 without easing lag.
        transform: isDragging ? `translateY(${swipeY}px)` : undefined,
        position: isDragging ? 'relative' : undefined,
        zIndex: isDragging ? 20 : undefined,
        transition: isDragging ? 'none' : undefined
      }}>
      <div
        ref={rowRef}
        className={`fade-in transaction-row ${isDragging ? 'is-dragging' : ''}`}
        style={{
          transform: isDemoAnimatingRow ? undefined : (isDragging ? undefined : `translateX(${swipeX}px)`),
          background: swipeX > 100 ? 'rgba(239, 68, 68, 0.2)' : undefined,
          transition: isDemoAnimatingRow ? 'none' : ((swipeX === 0 && !isDragging) ? 'all 0.3s ease' : 'none'),
          position: 'relative',
          userSelect: 'none',
          touchAction: isDragging ? 'none' : 'pan-y',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: 'none',
          padding: '0.6rem 1rem',
          opacity: 0.95,
          width: '100%'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div className="flex align-center" style={{ gap: '1rem', flex: 1, minWidth: 0, position: 'relative', zIndex: 2 }}>
          <div className="badge-scalloped">
            {invKind ? getInvestmentKindIcon(invKind) : getCategoryIcon(tx.category)}
          </div>
          <div className="flex-col min-width-0">
            <div className="flex align-center gap-2">
              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }} className="truncate">
                {tx.description}
              </span>
              {tx.excludeFromStats && (
                <div title="Excluded from stats" style={{ opacity: 0.4 }}>
                  <Activity size={12} style={{ transform: 'rotate(90deg)' }} />
                </div>
              )}
            </div>
            <div className="flex align-center gap-2" style={{ marginTop: '2px', flexWrap: 'wrap', rowGap: '4px' }}>
              {/* A one-time reward's redemption leg sits on no account at all, so this is where it
                  would otherwise read "Unknown" — accountNameOf gives it its name. */}
              <span className="text-mono text-muted text-xs truncate" style={{ fontWeight: 600, flexShrink: 0, maxWidth: '100%' }}>{accountNameOf(tx.accountId, data.accounts)}{acc?.archived ? ' (deleted)' : ''}</span>
              <span className="metric-pill truncate" style={{ flexShrink: 0, maxWidth: '100%' }}>{tx.category}</span>
              {/* 'Investments' alone doesn't say fund vs. stock vs. metal — the kind pill fills that in. */}
              {invKind && (
                <span className="metric-pill truncate" style={{ flexShrink: 0, maxWidth: '100%' }}>{investmentKindLabel(invKind)}</span>
              )}
              {/* A one-time reward now gets a redemption leg of its own, collapsed under this row
                  like every other source — so this pill is only for the splits written BEFORE that,
                  which have nothing to expand into and would otherwise leave no trace of the
                  discount at all. A source with a leg needs no pill; the leg is the trace. */}
              {(() => {
                const oneTime = getRewardSplits(tx)
                  .filter(sp => isExternalRewardSource(sp.accountId) && !sp.legId)
                  .reduce((sum, sp) => sum + sp.amount, 0);
                return oneTime > 0 ? (
                  <span className="metric-pill truncate" style={{ flexShrink: 0, maxWidth: '100%' }}>
                    {formatCurrency(oneTime)} reward
                  </span>
                ) : null;
              })()}
              {(tx.tags || []).slice(0, 2).map(tag => (
                <span key={tag} className="tag-pill truncate" style={{ flexShrink: 0, maxWidth: '100%' }}>#{tag}</span>
              ))}
              {(tx.tags || []).length > 2 && (
                <span className="tag-pill tag-pill-overflow" style={{ flexShrink: 0 }}>+{(tx.tags || []).length - 2}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex-col align-end" style={{ flexShrink: 0, marginLeft: '1rem', position: 'relative', zIndex: 2 }}>
          {/* WHAT THE PURCHASE COST leads, and the account's share is subordinate to it.
              
              The row's big figure is normally the movement on this account, and on a split row that
              is the one number nobody wants: "Flipkart Order −₹106" answers "what did the card
              lend", when the question a ledger is scanned with is "what did this cost". So on a
              split — and only on a split — the headline becomes the price, and what this account
              actually put in drops to the line below it.
              
              Deliberately in the AMOUNT column rather than as another pill beside the category:
              that row already carries the account, the category, an investment kind and up to three
              tags, and it wraps, so a pill there costs a whole line on a narrow phone.
              
              Both figures go through formatAmount with the same account, so a wallet counted in
              Chips renders both lines in Chips rather than switching units halfway down. */}
          <span className="text-mono" style={{ fontWeight: 800, fontSize: '1rem', color: tx.type === 'credit' ? '#10b981' : '#ef4444' }}>
            {tx.type === 'credit' ? '+' : '-'}{formatAmount(headline, acc)}
          </span>
          {/* The account's own share, in the metadata row's exact type — same classes, same weight —
              so it lands on the line the account NAME is already on, and the two read across as
              "Jupiter x CSB … ₹106". That pairing is what lets the figure go unlabelled; there is no
              room in this column for a caption, and a bare number under a bold total would otherwise
              be as likely to read as a discount. */}
          {splitGross > 0 && (
            <span
              className="text-mono text-muted text-xs"
              title={`${formatAmount(splitGross, acc)} total · ${formatAmount(tx.amount, acc)} from ${accountNameOf(tx.accountId, data.accounts)} · ${formatAmount(splitPaidElsewhere, acc)} from another source`}
              style={{ fontWeight: 600, marginTop: '2px' }}
            >
              {/* Whichever of the two figures the headline is NOT, so the pair always spans the
                  whole purchase. Unfiltered the headline is the price and this is the card's share,
                  reading across to the account name beside it. Filtered, the headline has dropped to
                  the card's share and this becomes the price — which needs the "of", because a
                  LARGER number sitting under the total would otherwise read as anything but. */}
              {headline >= splitGross ? formatAmount(tx.amount, acc) : `of ${formatAmount(splitGross, acc)}`}
            </span>
          )}
          {acc?.isNcmcEnabled && tx.isTravelTransaction && <span className="metric-pill" style={{ marginTop: '6px', backgroundColor: 'var(--accent)', color: 'var(--bg-color)', borderColor: 'var(--accent)' }}>TRAVEL</span>}
        </div>

        {swipeX > 50 && (
          <div style={{
            position: 'absolute',
            left: -swipeX,
            height: '100%',
            width: swipeX,
            background: 'var(--danger)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: '1rem',
            color: 'white',
            fontWeight: 800,
            fontSize: '0.75rem',
            letterSpacing: '1px',
            fontFamily: 'var(--font-mono)',
            zIndex: 1
          }}>
            DELETE
          </div>
        )}
      </div>

      {hasCounterparts && (
        <>
          <div style={{ width: '100%', borderTop: '1px solid var(--border-color)' }} />
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            margin: '0 0.6rem 0.5rem',
            borderRadius: '0 0 20px 20px',
            overflow: 'hidden',
            borderLeft: '2px solid var(--border-color)',
            borderRight: '2px solid var(--border-color)',
            borderBottom: '2px solid var(--border-color)'
          }}>
          {/* Hover lives in CSS (.linked-entry-toggle), gated on a real pointer. It used to be an
              inline onMouseOver/onMouseOut pair, which no media query can reach: on touch the
              mouseover fires on tap and the matching mouseout never arrives, so collapsing the row
              left it stuck in the hover shade until the next tap landed somewhere else. */}
          <button
            className="linked-entry-toggle"
            onClick={() => setIsCounterpartExpanded(!isCounterpartExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.4rem 1rem',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '0.72rem',
              textAlign: 'left',
              cursor: 'pointer',
              width: '100%',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              letterSpacing: '0.3px'
            }}
          >
            <ChevronRight 
              size={12} 
              style={{ 
                transform: isCounterpartExpanded ? 'rotate(90deg)' : 'none', 
                transition: 'transform 0.2s',
                flexShrink: 0
              }} 
            />
            <span>
              {isCounterpartExpanded
                ? 'Hide linked entry'
                : (() => {
                    const cats = counterparts!.map(c => c.tx.category.toLowerCase());
                    // A hidden reward redemption outranks the category-derived wording below: it's
                    // the one leg the category can't hint at, and "Paid from funding account" was
                    // actively misleading for a 3-leg split, describing only the bank leg while a
                    // rewards leg sat hidden beside it. Reward splits never coexist with the
                    // investment / transfer / NCMC groups below, so checking first costs nothing.
                    const rewardLegs = counterparts!.filter(c => !!rewardSplitOfLeg(tx, c.tx));
                    const rewardLegCount = rewardLegs.length;
                    const hidesRewardLeg = rewardLegCount > 0;
                    /* NOT EVERY SPLIT SOURCE IS A REWARD, and calling one that isn't a reward is the
                       kind of wrong that makes a user distrust the figure beside it. The split picker
                       offers three kinds and only two of them are winnings: a rewards wallet (CRED
                       coins, Cheq Chips), a card's own points ledger (Jewels), and — the odd one out
                       — an E-WALLET, which is a Flipkart or Amazon Pay balance holding money the user
                       put there themselves. "Part-paid with rewards" over ₹81 of their own money
                       reads as a discount they were given.
    
                       isPointsDenominated is the card-ledger test and `type === 'rewards'` the wallet
                       one; the external sentinel is a coupon and the most reward-ish of the lot. An
                       e-wallet answers no to all three, which is exactly the distinction wanted —
                       and it is the same predicate pair that decides whether a leg lands in the
                       points ledger or the rupee one, so the wording can't drift from the arithmetic. */
                    const isWinnings = (leg: Transaction) => {
                      if (isExternalRewardSource(leg.accountId)) return true;
                      const src = data.accounts.find(a => a.id === leg.accountId);
                      return src?.type === 'rewards' || isPointsDenominated(src);
                    };
                    const moneyLegCount = rewardLegs.filter(c => !isWinnings(c.tx)).length;
                    // Two wallets funding one bill are two separate entries in there, and the toggle
                    // is the only hint of how many before it is opened. A mixed split gets the
                    // neutral "sources": there is no honest collective noun for a coupon and a
                    // Flipkart balance, and picking either one libels the other.
                    // Spelt out rather than pluralised by a helper: "rewards" is a mass noun and
                    // stays plural at one source ("Part-paid with rewards"), where "wallet" is a
                    // count noun and does not ("Part-paid from wallet").
                    const sourceWord = moneyLegCount === 0
                      ? (rewardLegCount > 1 ? `${rewardLegCount} rewards` : 'rewards')
                      : moneyLegCount === rewardLegCount
                        ? (rewardLegCount > 1 ? `${rewardLegCount} wallets` : 'wallet')
                        : `${rewardLegCount} sources`;
                    // "with rewards" but "from a wallet" — the money was already the user's.
                    const partPaid = `Part-paid ${moneyLegCount === 0 ? 'with' : 'from'} ${sourceWord}`;
                    /* Same argument one category over: an instant-cashback leg is money that
                       arrived and is hidden in here, and no category below hints at it. Reachable
                       on far more rows than it used to be, now that instant cashback is offered on
                       transfers and bill payments (it is the payment app that pays it, not the
                       card issuer — see the gate in LogTransactionForm). */
                    const hidesCashbackLeg = counterparts!.some(c => (c.tx.category || '').toLowerCase() === 'cashback');
                    const cashbackSuffix = hidesCashbackLeg ? ' + cashback' : '';
                    /* Every label here has to survive on ONE line at 0.72rem mono inside a card that
                       is already inset from both screen edges — roughly 30 characters on a narrow
                       phone. So a label that takes a suffix drops its prose form for a list: "Paid
                       from funding account + rewards + cashback" wrapped, and a two-line toggle
                       reads as a paragraph rather than a control. The bare forms keep the prose,
                       since they have the room for it. */
                    if (hidesRewardLeg) {
                      return cats.includes('cc payment')
                        ? `Funding + ${sourceWord}${cashbackSuffix}`
                        : (hidesCashbackLeg
                          ? `${sourceWord.charAt(0).toUpperCase()}${sourceWord.slice(1)} + cashback`
                          : partPaid);
                    }
                    // Investment legs all share one category, so the wording comes from the leg's kind.
                    const invKinds = counterparts!.filter(c => isInvestmentCategory(c.tx.category)).map(c => c.tx.investmentKind);
                    if (invKinds.includes('mutual_funds')) return 'Mutual fund debited from bank';
                    if (invKinds.includes('stocks')) return 'Stock debited from wallet';
                    if (invKinds.includes('commodity')) return 'Commodity debited from bank';
                    if (invKinds.length > 0) return 'Investment funding entry';
                    if (cats.includes('transfer')) {
                      return hidesCashbackLeg ? 'Transfer + cashback' : 'Transfer entry';
                    }
                    // The grouping below always parents a CC Payment pair on the card's credit leg
                    // (creditParent || pool[0], and the credit leg is always present) — so the hidden
                    // counterpart here is always the funding/debit side, never the card. A reward leg
                    // among them is handled above.
                    if (cats.includes('cc payment')) {
                      return hidesCashbackLeg ? 'Funding + cashback' : 'Paid from funding account';
                    }
                    if (cats.includes('ncmc travel recharge')) {
                      return hidesCashbackLeg ? 'Top-up + cashback' : 'Travel wallet top-up';
                    }
                    // A plain purchase that earned instant cashback has no other leg to describe,
                    // so the cashback IS the group rather than a footnote on it.
                    if (hidesCashbackLeg) return 'Instant cashback logged';
                    return 'Linked entry';
                  })()}
            </span>
          </button>
          
          {isCounterpartExpanded && (
            <div style={{ 
              background: 'rgba(255,255,255,0.005)',
              borderTop: '1px solid var(--border-color)'
            }}>
              {counterparts!.map(c => (
                <TransactionRow
                  key={c.tx.id}
                  tx={c.tx}
                  acc={c.acc}
                  isFirst={false}
                  isLast={false}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onMoveBy={() => false}
                  blockLen={1}
                />
              ))}
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}

/** How far down the ledger has to be before the jump-to-top button appears. Roughly one
 *  screenful — below that the top is already a short flick away. */
const SCROLL_TOP_REVEAL_PX = 400;

export default function Transactions() {
  const { data, pendingTransfer, setPendingTransfer, smsQueue, smsScreening, removeFromSmsQueue, reorderTransactions, deleteTransaction } = useFinance();

  const ACCOUNT_TYPE_ORDER = ['bank_account', 'credit_card', 'debit_card', 'cash', 'e_wallet', 'rewards', 'stocks', 'mutual_funds', 'commodity'];
  const sortByAccountType = (a: { type: string }, b: { type: string }) => {
    const ai = ACCOUNT_TYPE_ORDER.indexOf(a.type);
    const bi = ACCOUNT_TYPE_ORDER.indexOf(b.type);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  };

  // Guards the drag reorder against re-entrancy: touchmove can fire faster than React can
  // re-render, so without this a single fling would call onMoveBy several times against the
  // same stale render closure, each doing a full 0..N-1 renumber of the day from a snapshot
  // that no longer reflects committed state — which scrambled/reversed the untouched rows.
  // Set true the instant we apply a reorder; cleared by the effect below once the resulting
  // state actually commits (transactions reference changes), so the next crossing runs against
  // a fresh closure.
  const reorderPendingRef = useRef(false);
  useEffect(() => { reorderPendingRef.current = false; }, [data.transactions]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [processingSms, setProcessingSms] = useState(false);
  // Prefill handed to the log form when something other than a blank "add" opens it: a parsed SMS,
  // or a pending liquidation routed here from Wealth.
  const [modalPrefill, setModalPrefill] = useState<Partial<Transaction> | undefined>(undefined);
  const [modalPaySrc, setModalPaySrc] = useState('');

  const processNextSms = () => {
    if (smsQueue.length > 0 && !isModalOpen) {
      const tx = smsQueue[0];
      const { amount, type, merchant, source, sourceIdentifier, timestamp, relationKind } = tx;

      const cardMatch = sourceIdentifier
        ? data.accounts.find(a => a.cardDetails?.cardNumber?.endsWith(sourceIdentifier))
        : undefined;
      const matchedAccount = cardMatch ?? data.accounts.find(a => {
        const normalizedSourceName = source.toLowerCase().replace(/\s+bank$/i, '').trim();
        const normalizedAccountName = a.name.toLowerCase().replace(/\s+bank$/i, '').trim();
        return normalizedAccountName.includes(normalizedSourceName) || normalizedSourceName.includes(normalizedAccountName);
      });

      // If this SMS was detected as a leg of a linked event (e.g. the credit-card payment
      // that settles a bank debit), prefill it as that event instead of a raw expense — a
      // CC-payment confirmation on a card is a payment INTO the card, not a debit spend.
      let initialType: TransactionType = type === 'unknown' ? 'debit' : type;
      let initialCategory = '';
      if (relationKind === 'cc_payment') {
        initialCategory = 'CC Payment';
        if (matchedAccount?.type === 'credit_card') initialType = 'credit';
      } else if (relationKind === 'transfer') {
        initialCategory = 'Transfer';
      }

      setEditId(null);
      const prefill: Partial<Transaction> = {
        date: format(new Date(timestamp), 'yyyy-MM-dd'),
        description: merchant || `Transaction via ${source}`,
        accountId: matchedAccount?.id || '',
        type: initialType,
        amount: amount,
        category: initialCategory,
        isRecurring: false,
        rewardEarned: 0,
        rewardEarnedType: 'delayed',
        rewardEarnedAccountId: '',
        rewardUsed: 0,
        rewardUsedAccountId: '',
        isTravelTransaction: false,
        excludeFromStats: false
      };
      setModalPrefill(prefill);
      setModalPaySrc('');
      setIsModalOpen(true);
      setProcessingSms(true);
    }
  };

  // A liquidation routed here from Wealth ("Send to Bank") arrives as context state rather than as a
  // click, so the form opens off it directly. Derived rather than copied into local state by an
  // effect: an effect would need a render pass just to mirror what's already known, and clearing
  // pendingTransfer up front (as it used to) meant the trigger was gone before the user had either
  // saved or cancelled. It's now cleared on close instead, so the prefill stays valid while the form
  // is open and can't re-fire afterwards.
  const transferPrefill: Partial<Transaction> | undefined = pendingTransfer ? {
    date: format(new Date(), 'yyyy-MM-dd'),
    description: `Liquidate ${data.accounts.find(a => a.id === pendingTransfer.fromAccountId)?.name} to Bank`,
    // Suggest the first available bank account as the destination
    accountId: data.accounts.find(a => a.type === 'bank_account' && !a.archived)?.id || '',
    type: 'credit',
    amount: pendingTransfer.amount,
    category: 'Transfer',
    isRecurring: false,
    rewardEarned: 0,
    rewardEarnedType: 'delayed',
    rewardEarnedAccountId: '',
    rewardUsed: 0,
    rewardUsedAccountId: '',
    isTravelTransaction: false
  } : undefined;



  const getAccountIcon = (accId: string) => {
    if (accId === 'all') return <Activity size={18} />;
    const acc = data.accounts.find(a => a.id === accId);
    if (!acc) return <Wallet size={18} />;
    return getAccountTypeIcon(acc.type, 18, acc.archived);
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  // Filters state
  const [filterType, setFilterType] = useState<'all' | 'debit' | 'credit'>('all');
  const [filterAccountId, setFilterAccountId] = useState<string[]>(['all']);
  const [filterCategory, setFilterCategory] = useState<string[]>(['all']);
  // Sub-filter for the Investments category: 'Investments' alone can't separate a fund SIP from a
  // gold buy, so this narrows by kind. Only meaningful while an investment category is filtered on.
  const [filterInvestmentKind, setFilterInvestmentKind] = useState<string[]>(['all']);
  const [filterMonth, setFilterMonth] = useState<string[]>(['all']);
  const [filterTag, setFilterTag] = useState<string[]>(['all']);
  const [searchQuery, setSearchQuery] = useState('');

  const [showFilters, setShowFilters] = useState(false);




  // Set when a tap on a reward leg was redirected to its anchor, so the form can scroll to the split.
  const [focusSplitOnOpen, setFocusSplitOnOpen] = useState(false);
  /** Which reward source of the split to open at, when a tap on one of its legs sent us here. */
  const [focusSplitIndex, setFocusSplitIndex] = useState(0);

  const openAddModal = () => {
    setEditId(null);
    setModalPrefill(undefined);
    setModalPaySrc('');
    setFocusSplitOnOpen(false);
    setFocusSplitIndex(0);
    setIsModalOpen(true);
  };

  // A reward-redemption leg has no editable identity of its own: its amount IS the anchor's
  // `rewardUsed`, its account IS the anchor's `rewardUsedAccountId`, and its description, category
  // and date are all derived and propagated down. Every control in an editor for it would therefore
  // be a no-op, a restatement, or a back-door into the anchor — which is what the reconstruct-then-
  // strip machinery in updateTransaction exists to paper over. So tapping one edits the ANCHOR, where
  // the redemption sits next to the total it came out of ("₹448 total, ₹86 rewards, ₹362 from the
  // card") — a relationship the leg can't show alone. Deleting the leg is untouched and still
  // un-splits the payment.
  //
  // Deliberately NOT applied to the bank leg of a 3-leg split: that one is real money leaving a real
  // account, is independently meaningful, and keeps its Option-B rebalance (docs/LINKED_TRANSACTIONS).
  // The form reconstructs the whole edit context (split anchor, counterpart account, billing-cycle
  // target) from the id, so opening only has to say which transaction.
  const openEditModal = useCallback((tx: Transaction) => {
    const split = rewardSplitAnchorOf(tx, data.transactions);
    setEditId((split?.anchor || tx).id);
    setModalPrefill(undefined);
    setModalPaySrc('');
    // The anchor carries the split, so the form already opens with the panel expanded; this asks it
    // to scroll there and — since the split may be funded from several wallets — to open at and ring
    // the source THIS leg was, so the redemption you tapped is the one you land on.
    setFocusSplitOnOpen(!!split);
    setFocusSplitIndex(split?.index ?? 0);
    setIsModalOpen(true);
  }, [data.transactions]);

  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({
    [format(new Date(), 'yyyy-MM')]: true
  });

  /* Scroll-to-top affordance. The ledger is the one screen that can run to hundreds of rows,
     and the scroll container is .app-root (App.tsx owns it and restores per-tab positions),
     not this component — so the listener has to reach for it rather than use a local ref. */
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const root = document.querySelector('.app-root');
    if (!root) return;
    const onScroll = () => setShowScrollTop(root.scrollTop > SCROLL_TOP_REVEAL_PX);
    onScroll();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, []);

  const toggleMonth = (month: string) => {
    setExpandedMonths(prev => ({
      ...prev,
      [month]: !prev[month]
    }));
  };

  const availableMonths = Array.from(new Set(data.transactions.map(tx => tx.date.substring(0, 7)))).sort((a, b) => b.localeCompare(a));

  const filteredTransactions = data.transactions
    .filter(tx => {
      const matchesType = filterType === 'all' || tx.type === filterType;
      const matchesAccount = filterAccountId.includes('all') || filterAccountId.includes(tx.accountId);
      const matchesCategory = filterCategory.includes('all') || filterCategory.includes(tx.category);
      // Investment-kind sub-filter. Only constrains investment transactions — filtering by kind
      // alongside other categories shouldn't wipe out those other categories' rows. The kind is read
      // via getInvestmentKind so legacy rows the backfill couldn't reach still match by account type.
      const matchesInvestmentKind = filterInvestmentKind.includes('all')
        || !isInvestmentCategory(tx.category)
        || filterInvestmentKind.includes(getInvestmentKind(tx, data.accounts) ?? '');
      const matchesMonth = filterMonth.includes('all') || filterMonth.includes(tx.date.substring(0, 7));
      const matchesTag = filterTag.includes('all') || (tx.tags || []).some(t => filterTag.includes(t));
      const matchesSearch = tx.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tx.category.toLowerCase().includes(searchQuery.toLowerCase());

      const today = format(new Date(), 'yyyy-MM-dd');
      const isFuture = tx.date > today;

      return matchesType && matchesAccount && matchesCategory && matchesInvestmentKind && matchesMonth && matchesTag && matchesSearch && !isFuture && tx.amount > 0;
    });

  useEffect(() => {
    const handleTourEdit = () => {
      const firstTx = filteredTransactions.find(t => t.id.startsWith('demo_')) || filteredTransactions[0];
      if (firstTx) {
        openEditModal(firstTx);
      }
    };
    const handleTourCloseEdit = () => {
      const modalContent = document.querySelector('.modal-content');
      const modalOverlay = document.querySelector('.modal-overlay');
      if (modalContent) {
        if (modalOverlay) modalOverlay.classList.add('tour-modal-overlay-closing');
        modalContent.classList.add('tour-modal-closing');
        setTimeout(() => setIsModalOpen(false), 350);
      } else {
        setIsModalOpen(false);
      }
    };

    window.addEventListener('tour-open-edit', handleTourEdit);
    window.addEventListener('tour-close-edit', handleTourCloseEdit);
    return () => {
      window.removeEventListener('tour-open-edit', handleTourEdit);
      window.removeEventListener('tour-close-edit', handleTourCloseEdit);
    };
    // openEditModal is a dependency now that it resolves a reward leg's anchor out of
    // data.transactions — it is no longer just a setter call, so it can go stale.
  }, [filteredTransactions, openEditModal]);

  // The investment-kind picker only shows while an investment category is being filtered on, so a
  // stale kind must still count as active — otherwise switching category away from Investments would
  // silently keep filtering by a kind with no visible control to clear it.
  const isInvestmentFilterVisible = !filterCategory.includes('all')
    && filterCategory.some(c => isInvestmentCategory(c));
  const isFilterActive = filterType !== 'all' || !filterAccountId.includes('all') || !filterCategory.includes('all') || !filterInvestmentKind.includes('all') || !filterMonth.includes('all') || !filterTag.includes('all') || searchQuery !== '';

  const clearFilters = () => {
    setFilterType('all');
    setFilterAccountId(['all']);
    setFilterCategory(['all']);
    setFilterInvestmentKind(['all']);
    setFilterMonth(['all']);
    setFilterTag(['all']);
    setSearchQuery('');
    // Months opened while a filter narrowed the list were opened to see THAT result, not as a
    // lasting preference. Clearing the filter restores the whole ledger, so the accordion goes
    // back to its default too — current month open, everything older collapsed.
    setExpandedMonths({ [format(new Date(), 'yyyy-MM')]: true });
  };

  const filteredIncome = filteredTransactions.reduce((sum, tx) => {
    if (isStatsExcludedCategory(tx.category)) return sum;
    const effectiveAmount = tx.amount - (tx.excludedAmount || (tx.excludeFromStats ? tx.amount : 0));
    return sum + (tx.type === 'credit' ? effectiveAmount : 0);
  }, 0);
  const filteredSpend = filteredTransactions.reduce((sum, tx) => {
    if (isStatsExcludedCategory(tx.category)) return sum;
    const effectiveAmount = tx.amount - (tx.excludedAmount || (tx.excludeFromStats ? tx.amount : 0));
    return sum + (tx.type === 'debit' ? effectiveAmount : 0);
  }, 0);


  const groupedByMonth = filteredTransactions.reduce((acc, tx) => {
    const month = tx.date.substring(0, 7);
    if (!acc[month]) acc[month] = [];
    acc[month].push(tx);
    return acc;
  }, {} as Record<string, Transaction[]>);

  const sortedMonths = Object.keys(groupedByMonth).sort((a, b) => b.localeCompare(a));

  /* One card for the whole screening batch, never one per SMS. While anything is still with Gemini
     the card counts what is in flight; once the batch settles it reports what came of it, for every
     batch — including one where nothing was dropped, which is the only evidence the filter ran at
     all. The dropped count in particular is knowable nowhere else: a rejected SMS leaves no trace. */
  const smsInFlight = smsScreening.filter(s => s.status === 'screening').length;
  const smsPassed = smsScreening.filter(s => s.status === 'passed').length;
  const smsRejected = smsScreening.filter(s => s.status === 'rejected').length;
  const isSmsScreening = smsInFlight > 0;
  // Half the width each once both cards are up. The copy shortens to match — a phone split in two
  // has room for "4 Pending", not "4 Pending Transactions".
  const isSmsRowSplit = smsScreening.length > 0 && smsQueue.length > 0;

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const smsScreeningTitle = isSmsScreening
    ? (smsInFlight === 1 ? 'Checking SMS' : `Checking ${smsInFlight} SMSes`)
    // Nothing got through: the count of what was dropped IS the whole result, so it leads.
    : smsPassed === 0
      ? (smsRejected === 1 ? 'Filtered out' : `${smsRejected} filtered out`)
      : isSmsRowSplit
        ? `${smsPassed} detected`
        : `${smsPassed} ${plural(smsPassed, 'transaction', 'transactions')} detected`;
  const smsScreeningSubtitle = isSmsScreening
    ? (isSmsRowSplit ? 'Gemini is reading them…' : 'Gemini smart SMS filter is reading them…')
    : smsPassed === 0
      ? `Not ${plural(smsRejected, 'a valid transaction', 'valid transactions')} — nothing was added.`
      : isSmsRowSplit
        ? (smsRejected === 0 ? 'None filtered out' : `${smsRejected} filtered out`)
        : smsRejected === 0
          ? 'Nothing was filtered out by the AI filter.'
          : `${smsRejected} ${plural(smsRejected, 'message was', 'messages were')} not a transaction and ${plural(smsRejected, 'was', 'were')} dropped.`;

  return (
    <div className="flex-col gap-6 transactions-tab-root">
      <div className="flex-col gap-4">
        {/* line-height 1 so the title's box hugs its caps — the inherited 1.5 padded ~9px of leading
            under the glyphs, which read as a bigger gap above the pending card than below it. */}
        <h2 className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', lineHeight: 1 }}>transactions</h2>

        {/* The SMS strip: the pending queue and the Gemini second filter share ONE row, whatever
            the volume. Each side states a whole batch, and they split the width when both have
            something to say, so this costs the same height for twenty notifications as for one.
            Drawn per SMS in flight, as it was, ten drained notifications stacked ten cards and
            pushed the transaction list clean off the screen. */}
        {(smsQueue.length > 0 || smsScreening.length > 0) && (
          <div className={`sms-status-row${isSmsRowSplit ? ' is-split' : ''}`}>
            {smsQueue.length > 0 && (
              <div className="card fade-in sms-status-card sms-status-card--pending" onClick={processNextSms}>
                <div className="flex align-center gap-3" style={{ minWidth: 0 }}>
                  <div className="flex-center sms-status-card__icon" style={{ background: 'var(--accent)', color: 'var(--bg-color)' }}>
                    <Smartphone size={isSmsRowSplit ? 16 : 20} />
                  </div>
                  <div className="flex-col" style={{ minWidth: 0 }}>
                    <span className="font-bold text-mono sms-status-card__title" style={{ color: 'var(--text-primary)' }}>
                      {isSmsRowSplit
                        ? `${smsQueue.length} Pending`
                        : `${smsQueue.length} Pending ${smsQueue.length === 1 ? 'Transaction' : 'Transactions'}`}
                    </span>
                    <span className="text-xs text-muted sms-status-card__sub">
                      {smsQueue[0]?.relationKind === 'cc_payment' ? (isSmsRowSplit ? 'Next: card payment' : 'Next: linked card payment — pre-filled as CC Payment')
                        : smsQueue[0]?.relationKind === 'transfer' ? (isSmsRowSplit ? 'Next: transfer leg' : 'Next: linked transfer leg')
                        : smsQueue[0]?.relationKind === 'investment' ? (isSmsRowSplit ? 'Next: investment leg' : 'Next: linked investment leg')
                        : isSmsRowSplit ? 'Tap to review' : 'Tap to review and log'}
                    </span>
                  </div>
                </div>
                <ChevronRight size={20} className="text-muted sms-status-card__chevron" />
              </div>
            )}
            {smsScreening.length > 0 && (
              <div
                className="card fade-in sms-status-card sms-status-card--screening"
                style={isSmsScreening ? undefined : { background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="flex align-center gap-3" style={{ minWidth: 0 }}>
                  <div
                    className="flex-center sms-status-card__icon"
                    style={{
                      background: isSmsScreening ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.05)',
                      color: isSmsScreening ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {isSmsScreening ? <Sparkles size={isSmsRowSplit ? 16 : 20} /> : <Filter size={isSmsRowSplit ? 16 : 20} />}
                  </div>
                  <div className="flex-col" style={{ minWidth: 0 }}>
                    <span className="font-bold text-mono sms-status-card__title" style={{ color: 'var(--text-primary)' }}>
                      {smsScreeningTitle}
                    </span>
                    <span className="text-xs text-muted sms-status-card__sub">{smsScreeningSubtitle}</span>
                  </div>
                </div>
                {isSmsScreening
                  ? <Loader2 size={20} className="icon-spin text-muted" style={{ flexShrink: 0 }} />
                  : <X size={18} className="text-muted" style={{ flexShrink: 0 }} />}
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="flex gap-3 align-center">
            <button
              className="btn btn-primary"
              style={{ fontWeight: 800, letterSpacing: '1px' }}
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? (isFilterActive ? 'Minimize' : 'Hide Filters') : 'Filters'}
            </button>
            {isFilterActive && (
              <button
                className="btn btn-secondary"
                onClick={clearFilters}
                style={{ fontWeight: 800, letterSpacing: '1px' }}
              >
                Clear
              </button>
            )}
          </div>
          <button className="btn btn-primary" onClick={openAddModal} style={{ fontWeight: 800, letterSpacing: '1px' }}>
            + Log Transaction
          </button>
        </div>
      </div>

      {!showFilters && isFilterActive && (
        <div className="flex-col gap-3 card fade-in" style={{ padding: '0.9rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)' }}>
          <div className="flex justify-between align-center">
            <div className="flex gap-2 flex-wrap" style={{ paddingBottom: '2px' }}>
              {filterType !== 'all' && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--accent)', letterSpacing: '0.5px' }}>{filterType}</span>
                  <div
                    onClick={() => setFilterType('all')}
                    style={{ cursor: 'pointer', display: 'center', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {!filterAccountId.includes('all') && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
                    {filterAccountId.length === 1
                      ? data.accounts.find(a => a.id === filterAccountId[0])?.name
                      : (filterAccountId.length === 2
                        ? `${data.accounts.find(a => a.id === filterAccountId[0])?.name.split(' ')[0]} + ${data.accounts.find(a => a.id === filterAccountId[1])?.name.split(' ')[0]}`
                        : `${filterAccountId.length} Accounts`)}
                  </span>
                  <div
                    onClick={() => setFilterAccountId(['all'])}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {!filterCategory.includes('all') && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
                    {filterCategory.length === 1
                      ? filterCategory[0]
                      : (filterCategory.length === 2
                        ? `${filterCategory[0]} + ${filterCategory[1]}`
                        : `${filterCategory.length} Categories`)}
                  </span>
                  <div
                    onClick={() => { setFilterCategory(['all']); setFilterInvestmentKind(['all']); }}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {!filterInvestmentKind.includes('all') && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
                    {filterInvestmentKind.length === 1
                      ? investmentKindLabel(filterInvestmentKind[0] as InvestmentKind)
                      : `${filterInvestmentKind.length} Investment Types`}
                  </span>
                  <div
                    onClick={() => setFilterInvestmentKind(['all'])}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {!filterMonth.includes('all') && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
                    {filterMonth.length === 1
                      ? (() => {
                        const d = new Date(`${filterMonth[0]}-01`);
                        return `${d.toLocaleString('default', { month: 'short' })} '${d.getFullYear().toString().slice(-2)}`;
                      })()
                      : (filterMonth.length === 2
                        ? `${new Date(`${filterMonth[0]}-01`).toLocaleString('default', { month: 'short' })} + ${new Date(`${filterMonth[1]}-01`).toLocaleString('default', { month: 'short' })}`
                        : `${filterMonth.length} Months`)}
                  </span>
                  <div
                    onClick={() => setFilterMonth(['all'])}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {searchQuery && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>"{searchQuery}"</span>
                  <div
                    onClick={() => setSearchQuery('')}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                  >
                    <X size={14} />
                  </div>
                </div>
              )}
              {!filterTag.includes('all') && (
                <div className="flex align-center gap-2" style={{ background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                  <Hash size={11} style={{ color: 'var(--accent)', opacity: 0.8 }} />
                  <span className="text-xs uppercase font-extrabold" style={{ color: 'var(--accent)', letterSpacing: '0.5px' }}>
                    {filterTag.length === 1
                      ? filterTag[0]
                      : (filterTag.length === 2
                        ? `${filterTag[0]} + ${filterTag[1]}`
                        : `${filterTag.length} Tags`)}
                  </span>
                  <div onClick={() => setFilterTag(['all'])} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.6 }}>
                    <X size={14} />
                  </div>
                </div>
              )}</div>
          </div>

          <div className="flex gap-6 pt-3" style={{ borderTop: '1px dashed var(--border-color)', marginTop: '0.25rem' }}>
            <div className="flex align-center gap-2">
              <span className="text-xs text-muted font-bold uppercase" style={{ letterSpacing: '0.5px', opacity: 0.5 }}>Income</span>
              <span style={{ fontWeight: 800, color: 'var(--success)', fontSize: '1rem' }}>+{formatCurrency(filteredIncome)}</span>
            </div>
            <div className="flex align-center gap-2">
              <span className="text-xs text-muted font-bold uppercase" style={{ letterSpacing: '0.5px', opacity: 0.5 }}>Spends</span>
              <span style={{ fontWeight: 800, color: 'var(--danger)', fontSize: '1rem' }}>-{formatCurrency(filteredSpend)}</span>
            </div>
          </div>
        </div>
      )}

      {showFilters && (
        <div className="flex-col gap-3 card" style={{ padding: '1rem' }}>
          {isFilterActive && (
            <div className="flex justify-between align-center" style={{ backgroundColor: 'var(--bg-hover)', padding: '0.85rem 1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'inset 3px 3px 0 rgba(0, 0, 0, 0.4)' }}>
              <div className="flex gap-4">
                <div className="flex align-center gap-2">
                  <span className="text-xs text-muted" style={{ fontSize: '0.75rem' }}>Income:</span>
                  <span style={{ fontWeight: 700, color: 'var(--success)', fontSize: '0.95rem' }}>+{formatCurrency(filteredIncome)}</span>
                </div>
                <div className="flex align-center gap-2">
                  <span className="text-xs text-muted" style={{ fontSize: '0.75rem' }}>Spends:</span>
                  <span style={{ fontWeight: 700, color: '#ff4d4d', fontSize: '0.95rem' }}>-{formatCurrency(filteredSpend)}</span>
                </div>
              </div>
              <span className="text-xs text-muted" style={{ letterSpacing: '0.5px', opacity: 0.6 }}>Summary</span>
            </div>
          )}

          <div className="flex gap-2 align-center" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}>
              <Search size={18} />
            </div>
            <input
              className="input-field"
              style={{
                flex: 1,
                padding: '0.75rem 1rem 0.75rem 2.8rem',
                minHeight: '48px',
                borderRadius: '12px',
                fontSize: '0.95rem'
              }}
              placeholder="Search description..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex-col gap-1" style={{ minWidth: 0 }}>
              <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Type</label>
              <CustomPicker
                label="Type"
                hideLabel={true}
                value={filterType}
                options={[
                  { id: 'all', name: 'All Types' },
                  { id: 'debit', name: 'Debit Only' },
                  { id: 'credit', name: 'Credit Only' }
                ]}
                onChange={(val) => setFilterType(val as 'all' | 'debit' | 'credit')}
                iconGetter={(id) => id === 'all' ? <Activity size={16} /> : (id === 'debit' ? <ArrowRightLeft size={16} className="rotate-90 text-danger" /> : <ArrowRightLeft size={16} className="-rotate-90 text-success" />)}
              />
            </div>
            <div className="flex-col gap-1" style={{ minWidth: 0 }}>
              <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Account</label>
              <CustomPicker
                label="Account"
                hideLabel={true}
                value={filterAccountId}
                isMulti={true}
                options={[
                  { id: 'all', name: 'All Accounts' },
                  // Keep archived accounts here so their history is still filterable, just labelled
                  // and pushed to the end of the list.
                  ...data.accounts
                    .filter(a => !a.archived)
                    .sort((a, b) => sortByAccountType(a, b))
                    .map(a => ({ id: a.id, name: a.name, group: getAccountGroupLabel(a.type, false) })),
                  ...data.accounts
                    .filter(a => a.archived)
                    .sort((a, b) => sortByAccountType(a, b))
                    .map(a => ({ id: a.id, name: `${a.name} (deleted)`, group: 'Archived Accounts' }))
                ]}
                onChange={setFilterAccountId}
                iconGetter={(id) => id === 'all' ? <Wallet size={18} /> : getAccountIcon(id)}
              />
            </div>
            <div className="flex-col gap-1" style={{ minWidth: 0 }}>
              <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Category</label>
              <CustomPicker
                label="Category"
                hideLabel={true}
                value={filterCategory}
                isMulti={true}
                options={[
                  { id: 'all', name: 'All Categories' },
                  ...(data.categories || []).map(c => ({ id: c, name: c }))
                ]}
                onChange={(vals: string[]) => {
                  setFilterCategory(vals);
                  // Deselecting Investments hides the kind picker, so drop the kind with it rather
                  // than leaving an invisible filter narrowing the results.
                  const stillInvestments = !vals.includes('all') && vals.some(c => isInvestmentCategory(c));
                  if (!stillInvestments) setFilterInvestmentKind(['all']);
                }}
                iconGetter={(c) => c === 'all' ? <Shapes size={17} /> : getCategoryIcon(c)}
              />
            </div>
            {isInvestmentFilterVisible && (
              <div className="flex-col gap-1" style={{ minWidth: 0 }}>
                <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Investment Type</label>
                <CustomPicker
                  label="Investment Type"
                  hideLabel={true}
                  value={filterInvestmentKind}
                  isMulti={true}
                  options={[
                    { id: 'all', name: 'All Investment Types' },
                    ...INVESTMENT_KIND_OPTIONS.map(o => ({ id: o.id as string, name: o.name }))
                  ]}
                  onChange={setFilterInvestmentKind}
                  // Layers, not Shapes: Shapes is the "All Categories" glyph one row above, so both
                  // "All" rows rendered identically while an investment category was filtered on.
                  iconGetter={(k) => k === 'all' ? <Layers size={17} /> : getInvestmentKindIcon(k, 17)}
                />
              </div>
            )}
            {(data.tags || []).length > 0 && (
              <div className="flex-col gap-1" style={{ minWidth: 0 }}>
                <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Tag</label>
                <CustomPicker
                  label="Tag"
                  hideLabel={true}
                  value={filterTag}
                  isMulti={true}
                  enableSearch={true}
                  searchPlaceholder="Search active & event tags..."
                  options={[
                    { id: 'all', name: 'All Tags' },
                    ...(data.tags || []).map(t => ({ id: t, name: `#${t}` })),
                    ...(data.eventTags || []).map(t => ({ id: t, name: `#${t}`, subtext: 'Event Tag', group: 'Event Tags', showOnlyOnSearch: true }))
                  ]}
                  onChange={setFilterTag}
                  iconGetter={() => <Hash size={16} />}
                />
              </div>
            )}
            <div className="flex-col gap-1" style={{ minWidth: 0 }}>
              <label className="text-xs text-muted" style={{ marginLeft: '0.5rem', marginBottom: '2px' }}>Month</label>
              <CustomPicker
                label="Month"
                hideLabel={true}
                value={filterMonth}
                isMulti={true}
                defaultGroupExpanded={true}
                options={[
                  { id: 'all', name: 'All Months' },
                  ...availableMonths.map(m => {
                    const d = new Date(`${m}-01`);
                    const year = d.getFullYear();
                    return {
                      id: m,
                      name: `${d.toLocaleString('default', { month: 'short' })} '${d.getFullYear().toString().slice(-2)}`,
                      group: `Year ${year}`
                    };
                  })
                ]}
                onChange={setFilterMonth}
                iconGetter={() => <Calendar size={16} />}
              />
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filteredTransactions.length === 0 ? (
          <p className="text-muted text-center" style={{ padding: '2rem' }}>No transactions found.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sortedMonths.map(monthStr => {
              const isExpanded = expandedMonths[monthStr];
              const txsInMonth = groupedByMonth[monthStr];
              const monthDate = new Date(`${monthStr}-01`);
              const monthLabel = monthDate.toLocaleString('default', { month: 'long', year: 'numeric' });

              const groupedByDate = txsInMonth.reduce((acc, tx) => {
                if (!acc[tx.date]) acc[tx.date] = [];
                acc[tx.date].push(tx);
                return acc;
              }, {} as Record<string, Transaction[]>);

              return (
                <div key={monthStr} className="flex-col">
                  <div
                    className={`flex justify-between align-center ${monthStr === getCurrentMonthStr() ? 'tour-demo-month-header' : ''}`}
                    style={{ padding: '0.75rem 1.5rem', backgroundColor: 'var(--bg-hover)', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                    onClick={() => toggleMonth(monthStr)}
                  >
                    <span className="text-mono" style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.85rem', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{monthLabel}</span>
                    <div className="flex align-center gap-2 text-mono text-muted" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                      <span>{txsInMonth.filter(isCountableTransaction).length} transactions</span>
                      <ChevronDown
                        size={14}
                        style={{
                          transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                          transition: 'transform 0.2s ease',
                          opacity: 0.7
                        }}
                      />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="fade-in">
                      {Object.entries(groupedByDate).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()).map(([date, txs]) => {
                        // The WHOLE day, filters ignored. `txs` below is the filtered
                        // view; a reorder has to be written back against this, or it
                        // renumbers over the top of rows the filter is hiding.
                        const sortedAllTxsOnDate = sortDayByOrder(data.transactions.filter(t => t.date === date));
                        const sortedTxs = [...txs].sort((a, b) => {
                          return sortedAllTxsOnDate.indexOf(a) - sortedAllTxsOnDate.indexOf(b);
                        });
                        const dailyIncome = txs.reduce((sum, t) => {
                          if (isStatsExcludedCategory(t.category)) return sum;
                          const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
                          return sum + (t.type === 'credit' ? effectiveAmount : 0);
                        }, 0);
                        const dailySpend = txs.reduce((sum, t) => {
                          if (isStatsExcludedCategory(t.category)) return sum;
                          const effectiveAmount = t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));
                          return sum + (t.type === 'debit' ? effectiveAmount : 0);
                        }, 0);
                        // Target date for Starbucks/Uber/Netflix demo transactions is getRelativeDate(0) which is today.
                        const isDemoDay = (() => {
                          const targetDateStr = new Date().toISOString().split('T')[0];
                          return date === targetDateStr;
                        })();

                        return (
                          <React.Fragment key={date}>
                            <div className="flex justify-between align-center" style={{ backgroundColor: 'rgba(99,102,241,0.06)', fontWeight: 700, color: 'var(--accent)', padding: '0.5rem 1.5rem', fontSize: '0.7rem', borderBottom: '2px solid rgba(99,102,241,0.2)', borderTop: '2px solid rgba(99,102,241,0.2)', letterSpacing: '0.5px' }}>
                              <span className="text-mono" style={{ textTransform: 'uppercase', letterSpacing: '1px' }}>{formatDateString(date)}</span>
                              <div className="flex gap-3">
                                {dailyIncome > 0 && <span style={{ color: 'var(--success)' }}>+{formatCurrency(dailyIncome)}</span>}
                                {dailySpend > 0 && <span style={{ color: 'var(--danger)' }}>-{formatCurrency(dailySpend)}</span>}
                              </div>
                            </div>
                            <div className={isDemoDay ? 'tour-demo-day-group' : ''}>
                              {(() => {
                                const collapsedTxIds = new Set<string>();
                                const txCounterpartsMap = new Map<string, { tx: Transaction; acc: Account | undefined }[]>();

                                sortedTxs.forEach(t => {
                                  if (collapsedTxIds.has(t.id)) return;

                                  const linkedIds = t.linkedTransactionIds || (t.linkedTransactionId ? [t.linkedTransactionId] : []);
                                  if (linkedIds.length > 0) {
                                    // Shared with the drag and the invariant check — see linkedGroupOf.
                                    // All three have to agree on what "one group" is: while the drag
                                    // kept its own copy of this rule it moved blocks the render had
                                    // never drawn. (Star topology: children link to the parent, not to
                                    // each other. See docs/LINKED_TRANSACTIONS.md.)
                                    const group = linkedGroupOf(t, sortedTxs);

                                    const uncollapsedInGroup = group.filter(other => !collapsedTxIds.has(other.id));
                                    if (uncollapsedInGroup.length > 1) {
                                      // A reward-redemption leg is never the parent row: it is derived
                                      // from the anchor's `rewardUsed` and means nothing on its own.
                                      // In a 2-leg split on an ordinary purchase BOTH entries are
                                      // debits on the same date, so the plain `find(type === 'debit')`
                                      // below just picked whichever sorted FIRST — letting display
                                      // order decide which row means what. Real data: the ₹86 "Rewards
                                      // applied to: Mobile Recharge(Maa)" leg carried order 3 against
                                      // its ₹362 anchor's order 4, so the leg rendered as the parent
                                      // and the actual purchase collapsed underneath it.
                                      //
                                      // Detected via the anchor's own fields, not `isRewardTransaction`
                                      // — that flag is only set when the reward source is
                                      // points-denominated, so a rupee wallet (CRED coins) leaves it
                                      // false. The `p.id !== o.id` guard is load-bearing: a card
                                      // redeeming its OWN points has leg.accountId === anchor.accountId,
                                      // so without it the anchor would flag itself.
                                      const isRewardLeg = (o: Transaction) => uncollapsedInGroup.some(p =>
                                        p.id !== o.id && !!rewardSplitOfLeg(p, o)
                                      );
                                      const eligible = uncollapsedInGroup.filter(other => !isRewardLeg(other));
                                      // Never leave the group headless: if every member looks like a
                                      // reward leg, fall back to the whole group rather than render nothing.
                                      const pool = eligible.length ? eligible : uncollapsedInGroup;
                                      const debitParent = pool.find(other => other.type === 'debit');
                                      const creditParent = pool.find(other => other.type === 'credit');
                                      // Groups whose CREDIT leg is the one worth showing as the parent
                                      // row. Every investment qualifies: the holding account receiving
                                      // the units/shares/grams is the point of the entry, and the bank
                                      // debit is just how it was funded. (Commodity used to be the odd
                                      // one out here, showing its funding leg as the parent.)
                                      const creditCategories = ['cc payment', 'transfer', 'ncmc travel recharge'];
                                      const isCreditParentGroup = uncollapsedInGroup.some(other =>
                                        creditCategories.includes(other.category?.toLowerCase() ?? '')
                                        || isInvestmentCategory(other.category)
                                      );
                                      const parent = isCreditParentGroup ? (creditParent || pool[0]) : (debitParent || pool[0]);
                                      /* Display order inside an expanded group, by three rules:
                                         1. the primary account's own leg leads. It is the movement the
                                            row is actually about — the figure the log form calls
                                            "Primary Account Debit" — and a reward redemption or a
                                            cashback credit is a modifier on it, not a peer.
                                         2. the other legs that FUNDED it follow, descending by value,
                                            so they read biggest-first and the largest share of what is
                                            left sits closest to the primary leg.
                                         3. a cashback credit goes last, whatever it is worth.
                                         Before any of this there was no rule at all: the legs came out
                                         in the `order` they were WRITTEN in, which put the reward legs
                                         above the account that paid the bulk of the bill.

                                         Rule 3 is what keeps the group's arithmetic legible. Ranks 0
                                         and 1 are the bill: 4,883 + 50 + 10 is exactly the ₹4,943
                                         anchor above them. A cashback leg is NOT part of that sum — it
                                         is what the payment earned back — so sorting it among them by
                                         value (₹29.80 landing between a ₹50 redemption and a ₹10
                                         coupon, as it did) breaks a column that otherwise reconciles,
                                         and flips the sign mid-column while it is at it: cashback is
                                         the one credit among debits, so grouping by direction lets the
                                         eye read "what this cost" without checking every row's sign.

                                         Rule 2 reads `amount`, which is rupees on every leg — a points
                                         redemption included, since the "−500 Chips" on screen is the
                                         account's rate applied at render (see formatAmount). So it
                                         compares money with money, and a wallet's unit never decides
                                         where its row sits: ₹50 shown as 500 Chips still outranks a
                                         ₹10 coupon. */
                                      const legRank = (o: Transaction) =>
                                        (o.category || '').toLowerCase() === 'cashback' ? 2
                                          : rewardSplitOfLeg(parent, o) ? 1
                                            : 0;
                                      const counterpartsList = uncollapsedInGroup
                                        .filter(other => other.id !== parent.id)
                                        .sort((a, b) => legRank(a) - legRank(b) || b.amount - a.amount);

                                      counterpartsList.forEach(cp => {
                                        collapsedTxIds.add(cp.id);
                                      });

                                      const resolvedCParts = counterpartsList.map(cp => ({
                                        tx: cp,
                                        acc: data.accounts.find(a => a.id === cp.accountId)
                                      }));

                                      txCounterpartsMap.set(parent.id, resolvedCParts);
                                    }
                                  }
                                });

                                return sortedTxs.map((tx) => {
                                  if (collapsedTxIds.has(tx.id)) return null;

                                  const group = linkedGroupOf(tx, sortedTxs);
                                  const groupIds = new Set(group.map(g => g.id));
                                  const firstGroupIdx = sortedTxs.findIndex(t => groupIds.has(t.id));
                                  const lastGroupIdx = sortedTxs.map(t => groupIds.has(t.id)).lastIndexOf(true);
                                  const isFirstInGroupAndList = firstGroupIdx === 0;
                                  const isLastInGroupAndList = lastGroupIdx === sortedTxs.length - 1;
                                  // How many slots this row really consumes — its MEMBER COUNT, not
                                  // the distance from its first leg to its last. Those are the same
                                  // number for a group whose legs are adjacent, which they are meant
                                  // to be; the span was what turned a scattered group into a drag
                                  // that swallowed every unrelated row lying between two legs.
                                  const groupBlockLen = group.length;

                                  return (
                                    <TransactionRow
                                      key={tx.id}
                                      tx={tx}
                                      acc={data.accounts.find(a => a.id === tx.accountId)}
                                      isFirst={isFirstInGroupAndList}
                                      isLast={isLastInGroupAndList}
                                      onEdit={openEditModal}
                                      onDelete={handleDelete}
                                      blockLen={groupBlockLen}
                                      onMoveBy={(steps) => {
                                        // Reposition this (possibly linked) group by `steps` slots in
                                        // one pass, which is what keeps the dragged row locked to the
                                        // finger even on a fast multi-row drag.
                                        //
                                        // Bail if a prior reorder from this same drag hasn't committed
                                        // yet: our `sortedTxs`/`firstGroupIdx` closure would be stale and
                                        // the renumber would fight the in-flight one. Returning false tells
                                        // the row not to consume this crossing so it retries post-commit.
                                        if (reorderPendingRef.current) return false;

                                        // Move the group's ACTUAL members. Splicing out
                                        // `first..last` instead swept up everything sitting between
                                        // two legs and relocated it — rows the drag never touched.
                                        const block = sortedTxs.filter(t => groupIds.has(t.id));
                                        const rest = sortedTxs.filter(t => !groupIds.has(t.id));
                                        // `firstGroupIdx` is the group's lowest slot, so no member
                                        // precedes it and the index needs no correction for removal.
                                        let insertAt = firstGroupIdx + steps;
                                        if (insertAt < 0) insertAt = 0;
                                        if (insertAt > rest.length) insertAt = rest.length;
                                        const newVisible = [
                                          ...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)
                                        ];

                                        // Write the move back against the WHOLE day. `sortedTxs` is
                                        // the filtered view, so renumbering it 0..N-1 — as this used
                                        // to — stamped orders straight onto rows a filter was hiding:
                                        // three visible rows became 0, 1, 2 and collided with the
                                        // three hidden rows already holding 0, 1 and 2. Redealing
                                        // instead permutes only the slots the visible rows already
                                        // occupied, so hidden rows keep their positions and the day
                                        // cannot gain a gap or a duplicate.
                                        const updates = dayOrderUpdates(
                                          applyVisibleReorder(sortedAllTxsOnDate, newVisible)
                                        );
                                        if (updates.length) {
                                          reorderPendingRef.current = true;
                                          reorderTransactions(...updates);
                                        }
                                        return true;
                                      }}
                                      counterparts={txCounterpartsMap.get(tx.id)}
                                    />
                                  );
                                });
                              })()}
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(isModalOpen || !!transferPrefill) && (
        <LogTransactionForm
          // The form seeds once per mount, so the key is what makes a different entry point
          // (liquidation vs. a specific edit vs. a blank add) re-seed even if one arrives while
          // the form is already open.
          key={transferPrefill ? 'liquidate' : (editId ?? 'new')}
          editId={transferPrefill ? null : editId}
          initialData={transferPrefill ?? modalPrefill}
          initialPaymentSourceAccountId={pendingTransfer ? pendingTransfer.fromAccountId : modalPaySrc}
          focusSplit={focusSplitOnOpen}
          focusSplitIndex={focusSplitIndex}
          sms={{ processing: processingSms, onDiscard: () => removeFromSmsQueue(0) }}
          onClose={() => {
            setIsModalOpen(false);
            setProcessingSms(false);
            if (pendingTransfer) setPendingTransfer(null);
          }}
        />
      )}
      {/* Custom Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="Delete Transaction?"
        message="Are you sure you want to remove this transaction? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (deleteConfirmId) {
            deleteTransaction(deleteConfirmId);
            setDeleteConfirmId(null);
          }
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />

      {/* Sits clear of the floating nav bar (which is 0.6rem + its own height off the bottom
          edge) and above the gesture bar. Jumps rather than animates: this is a "get me out of
          August" control, and a smooth scroll through 300 rows is a long way to watch. */}
      {/* Always mounted, never conditionally rendered: unmounting it the instant the scroll
          crosses back under the threshold cut the exit off mid-frame, which read as a jerk.
          Kept in the tree, both directions are the same transition played forwards or back,
          and it drops out of the tab order while hidden. */}
      <button
        aria-label="Scroll to top"
        aria-hidden={!showScrollTop}
        tabIndex={showScrollTop ? 0 : -1}
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
          opacity: showScrollTop ? 1 : 0,
          // Sinks toward the nav bar as it goes, so it reads as the button retiring rather
          // than the pixels simply switching off.
          transform: showScrollTop ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.9)',
          pointerEvents: showScrollTop ? 'auto' : 'none',
          transition: 'opacity 0.22s ease, transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <ArrowUp size={20} />
      </button>
    </div>
  );
}
