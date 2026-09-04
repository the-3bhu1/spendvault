import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '../FinanceContext';
import type { Transaction, TransactionType, InvestmentKind, RewardSplitLeg } from '../types';
import { generateId, formatCurrency, getBillingCycleForDate, calculateBalance, getCurrentMonthStr, isInvestmentCategory, INVESTMENT_CATEGORY, INVESTMENT_KIND_OPTIONS, investmentKindLabel, investmentAccountTypeFor, getInvestmentKind, isPointsDenominated, rewardPointsToRupees, rupeesToRewardPoints, advanceBillCycle, cardEarnsCashback, EXTERNAL_REWARD_SOURCE_ID, isExternalRewardSource, getRewardSplits, rewardSplitOfLeg, rewardSplitTotal, withRewardSplits, isUnitDenominated, rewardUnitBalance, formatRewardBalance } from '../utils';
import { Wallet, Calendar, Activity, Sparkles, Hash, BanknoteArrowUp, BanknoteArrowDown, X, Plus, Ticket } from 'lucide-react';
import { CustomPicker } from './CustomPicker';
import CustomDatePicker from './CustomDatePicker';
import { getCategoryIcon, getAccountTypeIcon, getAccountGroupLabel, getInvestmentKindIcon, sortByAccountType } from './transactionIcons';
import { scrollToFirstError } from '../utils/formErrors';
import { existingLegIdForSplit, isRewardSplitChildRow } from '../services/RewardLegService';

// THE log/edit-transaction form. Single implementation, shared by every entry point:
//   - the main Ledger (add, edit, SMS-driven prefill, Wealth "liquidate" prefill)
//   - the Upcoming Bills "LOG" button (bill prefill via initialData)
// It used to be duplicated — Transactions.tsx held one copy and TransactionModal.tsx another —
// and the two silently drifted apart twice (reward splits saved no reward leg from Bills, cashback
// /passive/NCMC sections existed only in the Ledger). Do NOT reintroduce a second copy: entry
// points differ only by the props below.
//
// Mounted only while open, so every field seeds on mount and resets on close.
export interface LogTransactionFormProps {
  /** Close the form. The parent unmounts it; all form state is discarded. */
  onClose: () => void;
  /** Editing an existing transaction — the full split/leg context is reconstructed from it. */
  editId?: string | null;
  /** Prefill for a new log (bill details, SMS-parsed fields, a pending liquidation). */
  initialData?: Partial<Transaction>;
  /** Preselects the counterpart ("auto-debit/auto-credit") account. */
  initialPaymentSourceAccountId?: string;
  /** Scroll to the reward-split panel once seeded. Set when a tap on a reward leg was redirected
   *  here, to its anchor — the redemption is what the user meant to reach. */
  focusSplit?: boolean;
  /** WHICH source card to open the split carousel at, and ring, when `focusSplit` is set. A split
   *  can be funded from several wallets and each has its own leg in the ledger, so landing on the
   *  panel is no longer enough — the card has to be the one that was tapped. */
  focusSplitIndex?: number;
  /** Ledger-only SMS queue integration. Omitted (Bills) means the form never touches the queue. */
  sms?: { processing: boolean; onDiscard: () => void };
  onSuccess?: () => void;
}

// The unit toggle and the remove button sit side by side in the split panel's header, so their
// height comes from one place — eyeballed padding on each drifted by a pixel or two.
const SPLIT_CONTROL_HEIGHT = '28px';

/* One card in the split carousel: a reward source, what it pays, and the leg it already has.
   `input` and `unit` are the typed state — a points source is entered in its own unit (430 Jewels)
   while `amount` stays the canonical rupee value, exactly as the single-source panel did, only now
   each source carries its own unit because they can differ (Jewels beside CRED coins). */
interface SplitDraft {
  accountId: string;
  amount: number;
  /** The leg this source already debits, when it has one. Seeded from the anchor so an edit reuses
   *  the leg instead of building a second — see existingLegIdForSplit. */
  legId?: string;
  input: string;
  unit: 'points' | 'rupee';
}

/* Rupees until the user says otherwise. A blank card has no source yet, so the first thing typed
   into it is read as money — and picking a points wallet afterwards must not retroactively decide
   that those digits were Chips. PTS is only ever reached through the toggle. */
const blankSplit = (): SplitDraft => ({ accountId: '', amount: 0, input: '', unit: 'rupee' });

/** How the stored anchor reads as carousel cards. Leg ids are recovered for a legacy row that never
 *  recorded them, by looking for the linked leg sitting on each source's account — with ids in hand
 *  the save reuses those legs rather than deleting and rebuilding them. */
const splitDraftsFrom = (
  anchor: Partial<Transaction> | undefined,
  transactions: Transaction[],
): SplitDraft[] => {
  const linkedIds = anchor?.linkedTransactionIds || (anchor?.linkedTransactionId ? [anchor.linkedTransactionId] : []);
  return getRewardSplits(anchor).map(split => {
    const legId = split.legId ?? transactions.find(t =>
      t.id !== anchor?.id
      && linkedIds.includes(t.id)
      && t.category !== 'Cashback'
      && t.accountId === split.accountId)?.id;
    // 'rupee' whatever this source is, like a blank card: the unit a split was typed in isn't
    // stored, so an edit reopens in the one unit every source shares rather than guessing that a
    // points wallet was entered in its issuer's figure. The toggle is still a click away, and the
    // hint line underneath already reads the amount back in Chips or Miles.
    return { accountId: split.accountId, amount: split.amount, legId, unit: 'rupee', input: split.amount === 0 ? '' : String(split.amount) };
  });
};

const blankTx = (): Partial<Transaction> => ({
  date: format(new Date(), 'yyyy-MM-dd'),
  description: '', accountId: '', type: 'debit', amount: 0, category: '', isRecurring: false,
  rewardEarned: 0, rewardEarnedType: 'delayed', rewardEarnedAccountId: '',
  rewardUsed: 0, rewardUsedAccountId: '',
  isTravelTransaction: false,
  excludeFromStats: false
});

const buildInputStrings = (tx: Partial<Transaction>) => ({
  amount: tx.amount === 0 ? '' : (tx.amount?.toString() || ''),
  rewardEarned: (tx.rewardEarned === 0 || tx.rewardEarned === undefined) ? '' : tx.rewardEarned.toString(),
  excludedAmount: (tx.excludedAmount === 0 || tx.excludedAmount === undefined) ? '' : tx.excludedAmount.toString(),
  counterpartAmount: tx.counterpartAmount === undefined ? '' : tx.counterpartAmount.toString(),
  // The complement of the exclusion against the full price. `amount` here is already the FULL price
  // on a reopened split (the sanitizer adds the reward back), and excludedAmount is likewise the
  // combined figure across both rows, so the two sides are measured on the same base.
  activeShare: (tx.excludeFromStats && tx.amount !== undefined)
    ? (() => {
        const s = Math.max(0, (tx.amount || 0) - (tx.excludedAmount || 0));
        return s === 0 ? '' : parseFloat(s.toFixed(2)).toString();
      })()
    : '',
  allottedAmount: (tx.allottedAmount === 0 || tx.allottedAmount === undefined) ? '' : tx.allottedAmount.toString(),
  investmentCharges: (tx.investmentCharges === 0 || tx.investmentCharges === undefined) ? '' : tx.investmentCharges.toString(),
  numberOfShares: (tx.numberOfShares === undefined) ? '' : tx.numberOfShares.toString()
});

export const LogTransactionForm: React.FC<LogTransactionFormProps> = ({
  onClose,
  editId = null,
  initialData,
  initialPaymentSourceAccountId = '',
  focusSplit = false,
  focusSplitIndex = 0,
  sms,
  onSuccess
}) => {
  const { data, addTransaction, updateTransaction, setRewardLegExclusion, updateTags, updateEventTags, updateRecurringBill, removeFromSmsQueue, removeSmsByMatch } = useFinance();

  const [newTx, setNewTx] = useState<Partial<Transaction>>(blankTx);
  const [inputStrings, setInputStrings] = useState(() => buildInputStrings(blankTx()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [descriptionSuggestions, setDescriptionSuggestions] = useState<string[]>([]);
  const [paymentSourceAccountId, setPaymentSourceAccountId] = useState('');
  const [ccPaymentCycleTarget, setCcPaymentCycleTarget] = useState<'current_cycle' | 'previous_statement'>('previous_statement');
  const [selectedCashbackLevelId, setSelectedCashbackLevelId] = useState('');
  // Instant-cashback input as a percentage of the debited amount, instead of a fixed ₹ value.
  const [cashbackPercentMode, setCashbackPercentMode] = useState(false);
  const [cashbackPercentStr, setCashbackPercentStr] = useState('');
  const [showRewardSplit, setShowRewardSplit] = useState(false);
  /* The split's sources, one per carousel card, in the order they were added. This is the panel's
     source of truth; `newTx.rewardUsed` / `rewardUsedAccountId` are written from it at save time by
     withRewardSplits. Each card's unit is its own (see SplitDraft): redeeming from a card's own
     balance is something you do in that card's units ("I spent 430 Jewels") while a rupee wallet has
     nothing to convert, and two sources on one split can disagree. */
  const [splits, setSplits] = useState<SplitDraft[]>([]);
  const [activeSplit, setActiveSplit] = useState(0);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [newTagTargetType, setNewTagTargetType] = useState<'active' | 'event'>('active');
  const [tempCreatedActiveTags, setTempCreatedActiveTags] = useState<string[]>([]);
  const [tempCreatedEventTags, setTempCreatedEventTags] = useState<string[]>([]);
  // What this split had already redeemed when the form opened, and from which account. Needed by the
  // balance check on an edit: the existing leg is already subtracted from the account's balance, so
  // without adding it back a ₹60 redemption from a now-empty wallet would look like an overdraw and
  // the transaction could never be re-saved — or even reduced. Read from the anchor at seed time
  // rather than from the live field, which by then holds whatever the user has typed.
  const committedRewardRef = useRef<Record<string, number>>({});
  const splitScrollRef = useRef<HTMLDivElement>(null);
  /* Where a programmatic scroll of the carousel is headed, while it is still travelling. Without it
     the two halves of the paging fight each other: the effect below scrolls smoothly toward the new
     card, `onScroll` fires on every frame of that animation, rounds a half-way scrollLeft back to the
     card being left, and the effect dutifully scrolls back — so pressing + built the second card and
     stayed on the first. Cleared on arrival, or by the timeout if the browser stops a pixel short. */
  const splitScrollTargetRef = useRef<number | null>(null);
  const rewardSplitRef = useRef<HTMLDivElement>(null);
  const passiveLogRef = useRef<HTMLDivElement>(null);
  const modalBodyRef = useRef<HTMLDivElement>(null);

  const syncInputStrings = (tx: Partial<Transaction>) => setInputStrings(buildInputStrings(tx));

  // When entering instant cashback as a percentage, keep rewardEarned in sync with
  // (percent × amount), recomputing whenever the percent or the debited amount changes.
  useEffect(() => {
    if (!cashbackPercentMode) return;
    const pct = parseFloat(cashbackPercentStr);
    const amt = Number(newTx.amount) || 0;
    const computed = (!isNaN(pct) && amt > 0) ? Math.round((amt * pct) / 100 * 100) / 100 : 0;
    setNewTx(prev => prev.rewardEarned === computed ? prev : { ...prev, rewardEarned: computed, rewardEarnedType: 'instant' });
  }, [cashbackPercentMode, cashbackPercentStr, newTx.amount]);

  const seedFromExisting = (tx: Transaction) => {
    setErrors({});
    const sanitizedTx: Partial<Transaction> = {
      ...tx,
      date: tx.date.split('T')[0],
      type: (tx.type as string) === 'expense' ? 'debit' : ((tx.type as string) === 'income' ? 'credit' : tx.type)
    };

    // Find linked counterpart account (Transfer/CC payment). Reward-split and cashback child
    // legs are excluded — they reciprocate via dedicated reverse-propagation in
    // updateTransaction, not the transfer/payment leg path. See docs/LINKED_TRANSACTIONS.md.
    const linkedIds = tx.linkedTransactionIds || (tx.linkedTransactionId ? [tx.linkedTransactionId] : []);
    const linkedTxs = data.transactions.filter(t => linkedIds.includes(t.id) && t.id !== tx.id);
    const isCashbackChild = tx.category === 'Cashback';

    // A reward split anchors on the CARD leg (holds rewardUsed). Each leg opens its own modal, so we
    // reconstruct the full split context per leg: the BANK leg shows the TOTAL bill + the split (so the
    // "Primary Account Debit" line derives back to the real bank portion, matching the logging form),
    // and both the bank and reward legs show the CARD in their auto-credit picker. The stored bank
    // amount stays the portion; only the form shows the total. See docs/LINKED_TRANSACTIONS.md.
    const rewardSplitAnchor = linkedTxs.find(t => t.category?.toLowerCase() === 'cc payment' && getRewardSplits(t).length > 0);
    const isSplitAnchor = tx.category?.toLowerCase() === 'cc payment' && getRewardSplits(tx).length > 0;
    const isSplitRewardLeg = !!rewardSplitAnchor && !!rewardSplitOfLeg(rewardSplitAnchor, tx);
    const isSplitBankLeg = !!rewardSplitAnchor && !isSplitRewardLeg && !isSplitAnchor;

    if (isSplitBankLeg && rewardSplitAnchor) {
      sanitizedTx.amount = rewardSplitAnchor.amount;               // show the full bill (192), not the stored portion (148)
      // The whole split, every source of it (44 across one wallet or two), so the "Primary Account
      // Debit" line derives back to what this leg really pays.
      sanitizedTx.rewardUsed = rewardSplitAnchor.rewardUsed;
      sanitizedTx.rewardUsedAccountId = rewardSplitAnchor.rewardUsedAccountId;
      sanitizedTx.rewardSplits = rewardSplitAnchor.rewardSplits;
    }

    // A split on an ordinary purchase (as opposed to a CC Payment) stores the REDUCED figure on the
    // account it charged — handleSave writes `total − rewardUsed` for a debit — while the form's
    // Amount field means the full price the split is taken out of. So add the reward back when
    // reopening one, or the "Primary Account Debit" line reads ₹276 on a ₹448 purchase and re-saving
    // subtracts the reward a second time. CC Payments don't need this: their anchor is the card leg,
    // which is a credit and keeps the full bill. Only reachable since splits were opened up beyond
    // CC Payment, which is why it went unnoticed.
    const isPlainSplitAnchor = tx.type === 'debit'
      && tx.category?.toLowerCase() !== 'cc payment'
      && getRewardSplits(tx).length > 0;
    if (isPlainSplitAnchor) {
      sanitizedTx.amount = (tx.amount || 0) + rewardSplitTotal(tx);
      // The exclusion is stored per row for the same reason the amount is, so reassemble it too:
      // the field means "how much of this purchase was passive", and the reward leg holds whatever
      // part of that the anchor could not absorb. Without this a ₹448 purchase excluded in full
      // reopens reading 362 and re-saving quietly un-excludes the reward leg.
      if (sanitizedTx.excludeFromStats && sanitizedTx.excludedAmount !== undefined) {
        // Every reward leg's share, not just the first source's: handleSave spreads the exclusion
        // across the anchor and each leg in turn, so reassembling it has to collect all of them.
        sanitizedTx.excludedAmount += linkedTxs
          .filter(t => !!rewardSplitOfLeg(tx, t))
          .reduce((sum, leg) => sum + (leg.excludedAmount || 0), 0);
      }
    }

    // Rows logged before the passive controls accounted for a split can hold an exclusion LARGER than
    // the amount they store — the toggle measured against the pre-split total, so a ₹448 purchase split
    // with ₹86 saved excludedAmount 448 beside a stored amount of 362. Clamping to the FULL price (the
    // reconstructed sanitizedTx.amount, not the stored figure) is what makes those rows legal again
    // rather than something to heal: 448 against a 448 purchase is exactly what this form now means,
    // and re-saving one redistributes it across the two rows properly.
    if (sanitizedTx.excludeFromStats && (sanitizedTx.excludedAmount || 0) > (sanitizedTx.amount || 0)) {
      sanitizedTx.excludedAmount = sanitizedTx.amount || 0;
    }

    const isRewardChild = linkedTxs.some(p => !!rewardSplitOfLeg(p, tx));
    let paySrc = '';
    if ((isSplitBankLeg || isSplitRewardLeg) && rewardSplitAnchor) {
      paySrc = rewardSplitAnchor.accountId; // the card being paid
    } else if (!isRewardChild && !isCashbackChild) {
      const counterpartTx = linkedTxs.find(t => t.category !== 'Cashback' && !rewardSplitOfLeg(tx, t));
      if (counterpartTx) paySrc = counterpartTx.accountId;
    }
    setPaymentSourceAccountId(paySrc);

    // Billing-cycle target ("Apply Payment To"): the cycle lives on the card leg, so for the bank/reward
    // child we read it off the anchor (and use the card's statement day), not the child's own record.
    const account = data.accounts.find(a => a.id === tx.accountId);
    const cycleFromAnchor = (isSplitBankLeg || isSplitRewardLeg) ? rewardSplitAnchor : undefined;
    if (cycleFromAnchor?.appliedBillingCycleYearMonth) {
      const cardAcc = data.accounts.find(a => a.id === cycleFromAnchor.accountId);
      const cyc = getBillingCycleForDate(sanitizedTx.date as string, cardAcc?.statementDay || 1);
      setCcPaymentCycleTarget(cycleFromAnchor.appliedBillingCycleYearMonth === cyc ? 'current_cycle' : 'previous_statement');
    } else if (account?.type === 'credit_card' && sanitizedTx.type === 'credit' && tx.appliedBillingCycleYearMonth) {
      const txCycle = getBillingCycleForDate(sanitizedTx.date as string, account.statementDay || 1);
      setCcPaymentCycleTarget(tx.appliedBillingCycleYearMonth === txCycle ? 'current_cycle' : 'previous_statement');
    } else {
      setCcPaymentCycleTarget('previous_statement');
    }
    setSelectedCashbackLevelId(tx.cashbackLevelId || '');
    setCashbackPercentMode(false);
    setCashbackPercentStr('');
    setShowRewardSplit(isSplitBankLeg || getRewardSplits(sanitizedTx).length > 0);
    setNewTx(sanitizedTx);
    syncInputStrings(sanitizedTx);
    /* The carousel's cards. Read off the ANCHOR (which for a bank-leg edit is the card leg, not this
       row) so leg ids resolve against the links that actually hold the legs, and each card's field is
       rendered in rupees, the unit every source shares — see splitDraftsFrom. */
    const splitAnchorTx = isSplitBankLeg && rewardSplitAnchor ? rewardSplitAnchor : sanitizedTx;
    const seededSplits = splitDraftsFrom(splitAnchorTx, data.transactions);
    setSplits(seededSplits);
    setActiveSplit(0);
    // What each source had already redeemed when the form opened. Per account, because the balance
    // check hands a source's own committed amount back to it and to nothing else.
    committedRewardRef.current = Object.fromEntries(seededSplits.map(sp => [sp.accountId, sp.amount]));
    setTempCreatedActiveTags([]);
    setTempCreatedEventTags([]);
  };

  // Seeds on mount (the parent mounts this only while the modal is open), so an edit's
  // reconstructed split context is in place before the first paint and a close-then-reopen can
  // never resurrect the previous entry's state.
  useLayoutEffect(() => {
    if (editId) {
      const existing = data.transactions.find(t => t.id === editId);
      if (existing) {
        seedFromExisting(existing);
        return;
      }
    }
    const initialTx = { ...blankTx(), ...initialData };
    setNewTx(initialTx);
    syncInputStrings(initialTx);
    setPaymentSourceAccountId(initialPaymentSourceAccountId || initialData?.paymentSourceAccountId || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Land on the split panel when a reward-leg tap was redirected to this anchor. Deferred a frame
  // past seeding: the panel only exists once `showRewardSplit` is true, which the seed above sets.
  useEffect(() => {
    if (!focusSplit) return;
    // Open AT the card that was tapped: with several sources the panel alone doesn't say which
    // redemption the ledger row stood for, and landing on it is the whole of the answer. No ring
    // around it — a border there reads as a selection or an error the user has to go and dismiss.
    setActiveSplit(prev => (focusSplitIndex > 0 ? focusSplitIndex : prev));
    const t = window.setTimeout(() => {
      rewardSplitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(t);
  }, [focusSplit, focusSplitIndex]);

  // A card can go away under the pointer (removed here, or dropped by a re-seed), and an index past
  // the end would leave the carousel on a page that isn't there and no dot lit.
  useEffect(() => {
    if (splits.length > 0 && activeSplit > splits.length - 1) setActiveSplit(splits.length - 1);
  }, [splits.length, activeSplit]);

  /* Keep the carousel showing the card the rest of the form thinks is active — a dot tap, a newly
     added source, the card a validation error lives on, or the leg a ledger tap arrived from. Scroll
     position is the only place "which card" is really stored (the scroller pages by geometry), so
     this is what writes it. Skipped while the user is mid-swipe, since then the scroller is already
     where it wants to be and `activeSplit` is following IT. */
  useEffect(() => {
    const el = splitScrollRef.current;
    if (!el || !showRewardSplit) return;
    const target = activeSplit * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) < 4) {
      splitScrollTargetRef.current = null;
      return;
    }
    splitScrollTargetRef.current = target;
    el.scrollTo({ left: target, behavior: 'smooth' });
    const t = window.setTimeout(() => { splitScrollTargetRef.current = null; }, 700);
    return () => window.clearTimeout(t);
  }, [activeSplit, showRewardSplit, splits.length]);

  const resolveCcPaymentCycle = (date: string, statementDay?: number) => {
    const safeStatementDay = statementDay || 1;
    const currentCycle = getBillingCycleForDate(date, safeStatementDay);

    if (ccPaymentCycleTarget === 'current_cycle') {
      return currentCycle;
    }

    const currentCycleDate = new Date(`${currentCycle}-01`);
    currentCycleDate.setMonth(currentCycleDate.getMonth() - 1);
    return `${currentCycleDate.getFullYear()}-${(currentCycleDate.getMonth() + 1).toString().padStart(2, '0')}`;
  };

  const handleDescriptionChange = (val: string) => {
    setNewTx(prev => ({ ...prev, description: val }));
    if (errors.description) setErrors(prev => ({ ...prev, description: '' }));
    if (val.trim().length < 2) {
      setDescriptionSuggestions([]);
      return;
    }

    const uniqueDescs = Array.from(new Set(data.transactions.map(t => t.description)));
    const matches = uniqueDescs
      .filter(d => d.toLowerCase().includes(val.toLowerCase()) && d.toLowerCase() !== val.toLowerCase())
      .slice(0, 5);
    setDescriptionSuggestions(matches);
  };

  const selectSuggestion = (suggestion: string) => {
    const pastTx = data.transactions
      .filter(t => t.description === suggestion)
      .sort((a, b) => {
        const dateComparison = b.date.localeCompare(a.date);
        if (dateComparison !== 0) return dateComparison;
        return (b.order ?? 0) - (a.order ?? 0);
      })[0];

    const isAmountUnselected = !newTx.amount || newTx.amount === 0;
    const isCategoryUnselected = !newTx.category;
    const isAccountIdUnselected = !newTx.accountId;
    const isTypeUnselected = !sms?.processing; // SMS-detected transactions already have their type selected
    const isTravelUnselected = !newTx.isTravelTransaction;

    const updatedTx = {
      ...newTx,
      description: suggestion,
      amount: !isAmountUnselected ? (newTx.amount ?? 0) : (pastTx?.amount ?? newTx.amount ?? 0),
      category: !isCategoryUnselected ? (newTx.category || '') : (pastTx?.category || newTx.category || ''),
      accountId: !isAccountIdUnselected ? (newTx.accountId || '') : (pastTx?.accountId || newTx.accountId || ''),
      type: !isTypeUnselected ? (newTx.type || 'debit') : (pastTx?.type || newTx.type || 'debit'),
      isTravelTransaction: !isTravelUnselected ? (newTx.isTravelTransaction ?? false) : (pastTx?.isTravelTransaction ?? newTx.isTravelTransaction ?? false)
      // Deliberately do NOT carry cashback config (cashbackLevelId / rewardEarnedType /
      // rewardEarnedAccountId) from the matched past transaction. Cashback is per-transaction, and
      // copying the deposit account + type without an amount left a half-populated Instant Cashback
      // (account selected, ₹0) that couldn't be cleared. Keep the new tx's own clean cashback state.
    };
    setNewTx(updatedTx);
    syncInputStrings(updatedTx);
    setDescriptionSuggestions([]);
  };

  const getAccountIcon = (accId: string) => {
    if (accId === 'all') return <Activity size={18} />;
    // A one-off reward has no account behind it, so it gets its own mark rather than the
    // no-such-account fallback wallet it would otherwise land on.
    if (isExternalRewardSource(accId)) return <Ticket size={18} />;
    const acc = data.accounts.find(a => a.id === accId);
    if (!acc) return <Wallet size={18} />;
    return getAccountTypeIcon(acc.type, 18, acc.archived);
  };

  // Which investment the form is currently logging — the single discriminator every
  // investment-specific field, account filter and auto-description below reads. Guarded on the
  // category so a stale kind left over from a previous selection can't leak into a non-investment log.
  const activeInvestmentKind: InvestmentKind | undefined =
    isInvestmentCategory(newTx.category) ? newTx.investmentKind : undefined;

  // The holding account for a kind, found on whichever leg carries it (main account or counterpart).
  const investmentAccountAmong = (kind: InvestmentKind, accountIds: (string | undefined)[]) => {
    const wantType = investmentAccountTypeFor(kind);
    return accountIds
      .map(id => (id ? data.accounts.find(a => a.id === id) : undefined))
      .find(a => a?.type === wantType);
  };
  // Investment logs are auto-named after the holding account (e.g. "Parag Parikh Flexi Cap Fund"),
  // falling back to the kind's own label until an account is picked.
  const investmentDescriptionFor = (kind: InvestmentKind, accountIds: (string | undefined)[]) =>
    investmentAccountAmong(kind, accountIds)?.name || investmentKindLabel(kind);

  // Picking a category — and, for Investments, picking the kind — settles the same five things: the
  // auto-filled description, which account selections are still valid, whether the amount splits into
  // invested + charges, whether a quantity applies, and the passive-log toggle. The Category picker
  // and the Investment Type sub-picker both route through here so they can never disagree.
  const applyCategorySelection = (nextCategory: string, nextKind?: InvestmentKind) => {
    const currentDesc = newTx.description || '';
    const isNcmcAccount = !!data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled;
    const prevKind = activeInvestmentKind;
    // Whether this call is an actual category/kind change vs. a no-op re-selection of the same one.
    const categoryOrKindChanged = nextCategory !== newTx.category || nextKind !== prevKind;

    // Transfer auto-fill / clear
    const wasTransfer = newTx.category?.toLowerCase() === 'transfer';
    const isNowTransfer = nextCategory.toLowerCase() === 'transfer';
    const isTransferAutoFilled = currentDesc.startsWith('Transfer to ') || currentDesc.startsWith('Transfer from ');

    // CC Payment auto-fill / clear
    const wasCC = newTx.category?.toLowerCase() === 'cc payment';
    const isNowCC = nextCategory.toLowerCase() === 'cc payment';
    const isCCAutoFilled = currentDesc === 'CC Bill Payment' || currentDesc.startsWith('CC Payment: ');
    const wasNcmc = newTx.category?.toLowerCase() === 'ncmc travel recharge';
    const isNowNcmc = nextCategory.toLowerCase() === 'ncmc travel recharge';
    const isNcmcAutoFilled = currentDesc === 'NCMC Travel Recharge';

    // Investment auto-fill / clear: the description counts as ours only while it still matches what
    // we'd generate for the kind being left, so a name the user typed themselves is never discarded.
    const isInvAutoFilled = !!prevKind
      && currentDesc === investmentDescriptionFor(prevKind, [newTx.accountId, paymentSourceAccountId]);

    let updatedDesc = currentDesc;
    if (wasTransfer && !isNowTransfer && isTransferAutoFilled) {
      updatedDesc = '';
    } else if (wasCC && !isNowCC && isCCAutoFilled) {
      // Leaving CC Payment — clear CC auto-fill
      updatedDesc = '';
    } else if (wasNcmc && !isNowNcmc && (isNcmcAutoFilled || currentDesc === 'Transfer to Travel Wallet')) {
      updatedDesc = '';
    } else if (prevKind && !nextKind && isInvAutoFilled) {
      updatedDesc = '';
    } else if (isNowCC && paymentSourceAccountId) {
      // Switching TO CC Payment with counterpart already selected — auto-fill
      if (currentDesc === '' || isCCAutoFilled || isTransferAutoFilled) {
        const selectedAcc = data.accounts.find(a => a.id === paymentSourceAccountId);
        if (selectedAcc) {
          updatedDesc = newTx.type === 'debit'
            ? `CC Payment: ${selectedAcc.name.trim()}`
            : 'CC Bill Payment';
        }
      }
    } else if (nextKind) {
      // Entering investments or switching kind — regenerate from the new kind's holding account.
      if (currentDesc === '' || isInvAutoFilled || isTransferAutoFilled || isCCAutoFilled || isNcmcAutoFilled) {
        updatedDesc = investmentDescriptionFor(nextKind, [newTx.accountId, paymentSourceAccountId]);
      }
    }

    const selectedAccForTravel = data.accounts.find(a => a.id === newTx.accountId);
    const shouldAutoTravel = newTx.type === 'credit' && selectedAccForTravel?.type === 'debit_card' && selectedAccForTravel?.isNcmcEnabled && isNowNcmc;
    const updatedIsTravel = shouldAutoTravel ? true : newTx.isTravelTransaction;

    if (isNowNcmc && isNcmcAccount && updatedIsTravel && newTx.type === 'credit') {
      if (currentDesc === '' || isNcmcAutoFilled || isTransferAutoFilled) {
        updatedDesc = 'NCMC Travel Recharge';
      }
    } else if (isNowNcmc && isNcmcAccount && !updatedIsTravel && newTx.type === 'debit') {
      if (currentDesc === '' || currentDesc === 'Transfer to Travel Wallet' || isTransferAutoFilled) {
        updatedDesc = 'Transfer to Travel Wallet';
      }
    }

    let updatedAccountId = newTx.accountId;
    if (isNowCC && updatedAccountId) {
      const selectedAcc = data.accounts.find(a => a.id === updatedAccountId);
      if (newTx.type === 'debit' && selectedAcc?.type === 'credit_card') {
        updatedAccountId = '';
        setPaymentSourceAccountId('');
      } else if (newTx.type === 'credit' && selectedAcc?.type !== 'credit_card') {
        updatedAccountId = '';
        setPaymentSourceAccountId('');
      }
    }

    if (nextKind) {
      // Keep the chosen account only if it's still valid for this kind and direction — otherwise a
      // fund→stock switch would silently save the buy against a mutual-fund account.
      const currentAcc = data.accounts.find(a => a.id === updatedAccountId);
      const isValid = !!currentAcc && (newTx.type === 'credit'
        ? currentAcc.type === investmentAccountTypeFor(nextKind)
        : (currentAcc.type === 'bank_account' || currentAcc.type === 'e_wallet'));
      if (!isValid) updatedAccountId = '';
    }
    // Any actual change of category or investment kind invalidates the counterpart account, any
    // reward split, and the billing-cycle target — these are transient to whichever category/kind
    // picked them, not properties of the transaction itself. Generic on purpose: it's not just CC
    // Payment that must come back fresh — switching to ANY other category and back must never
    // resurrect a stale pick from before the detour, regardless of which two categories are involved.
    if (categoryOrKindChanged) {
      setPaymentSourceAccountId('');
      setShowRewardSplit(false);
      // Every source with it, not just the panel: a leftover card would be saved as a redemption on
      // a category that may not even allow one.
      setSplits([]);
      setActiveSplit(0);
      setCcPaymentCycleTarget('previous_statement');
    }

    const hidesPassiveToggle = ['transfer', 'cc payment', 'ncmc travel recharge', 'lending & borrowing'].includes(nextCategory.toLowerCase());
    // Funds and stocks quote an invested amount with AMC/brokerage on top; a commodity buy is a
    // single gross amount, so it gets no allotted/charges pair.
    const splitsCharges = nextKind === 'mutual_funds' || nextKind === 'stocks';
    const nextAllotted = splitsCharges ? (newTx.allottedAmount || newTx.amount || 0) : undefined;
    const nextCharges = splitsCharges ? (newTx.investmentCharges || 0) : undefined;
    // A quantity only survives while the kind that measures it does — units, shares and grams
    // aren't interchangeable.
    const nextShares = (nextKind && nextKind === prevKind) ? newTx.numberOfShares : undefined;
    setNewTx({
      ...newTx,
      category: nextCategory,
      investmentKind: nextKind,
      description: updatedDesc,
      accountId: updatedAccountId,
      isTravelTransaction: updatedIsTravel,
      allottedAmount: nextAllotted,
      investmentCharges: nextCharges,
      numberOfShares: nextShares,
      excludeFromStats: hidesPassiveToggle ? false : newTx.excludeFromStats,
      excludedAmount: hidesPassiveToggle ? undefined : newTx.excludedAmount,
      ...(categoryOrKindChanged ? { rewardUsed: 0, rewardUsedAccountId: '', rewardSplits: undefined } : {})
    });
    setInputStrings(s => ({
      ...s,
      allottedAmount: (nextAllotted === undefined || nextAllotted === 0) ? '' : nextAllotted.toString(),
      investmentCharges: (nextCharges === undefined || nextCharges === 0) ? '' : nextCharges.toString(),
      numberOfShares: nextShares === undefined ? '' : nextShares.toString(),
    }));
    if (errors.category || errors.investmentKind) {
      const newErr = { ...errors };
      delete newErr.category;
      delete newErr.investmentKind;
      setErrors(newErr);
    }
  };

  const handleSave = () => {
    const newErrors: Record<string, string> = {};
    if (!newTx.date) newErrors.date = 'Date is required';
    if (!newTx.description) newErrors.description = 'Description is required';
    if (!newTx.amount) newErrors.amount = 'Amount is required';
    if (!newTx.accountId) newErrors.accountId = 'Account is required';
    if (!newTx.category) newErrors.category = 'Category is required';
    if (isInvestmentCategory(newTx.category) && !newTx.investmentKind) {
      newErrors.investmentKind = 'Investment type is required';
    }
    if (activeInvestmentKind === 'stocks' && !newTx.numberOfShares) {
      newErrors.numberOfShares = 'No. of Shares is required';
    }
    if (activeInvestmentKind === 'commodity' && !newTx.numberOfShares) {
      newErrors.numberOfShares = 'Grams is required';
    }
    // Measured against the full price. With a reward split active the excess over what this account
    // paid is carried by the reward leg, so the whole purchase can be excluded in one figure.
    if (newTx.excludeFromStats && (newTx.excludedAmount || 0) > passiveCeiling + 0.001) {
      newErrors.excludedAmount = 'Cannot exclude more than total amount';
    }
    /* Deliberately NOT "must be >= the amount paid". Which side is larger depends on the POV
       this row was logged from — a gift-card discount reads as a bigger credit from the debit
       side and a smaller debit from the credit side — and transfers that charge a fee land less
       than was sent either way. The only rules that hold in every direction are: it has to be
       there, and it has to be a real positive figure. The delta hint under the field is what
       catches a mistyped one. */
    if ((newTx.category || '').toLowerCase() === 'transfer' && paymentSourceAccountId
        && newTx.counterpartAmount !== undefined && !((Number(newTx.counterpartAmount) || 0) > 0)) {
      newErrors.counterpartAmount = 'Enter the amount the other account moved';
    }
    if (newTx.rewardEarnedType === 'instant' && (Number(newTx.rewardEarned) || 0) > 0 && !newTx.rewardEarnedAccountId) {
      newErrors.rewardEarnedAccountId = 'Deposit account is required for instant cashback';
    }
    if (newTx.rewardEarnedAccountId && (Number(newTx.rewardEarned) || 0) <= 0) {
      newErrors.rewardEarned = 'Cashback amount is required when deposit account is selected';
    }
    /* Every card in the split carousel, checked on its own terms — each source has its own balance,
       its own unit and its own pair of error slots (`rewardUsed_i` / `rewardSource_i`), so a
       shortfall on the second wallet can't be reported against the first. */
    if (showRewardSplit) {
      splits.forEach((sp, i) => {
        const amount = Number(sp.amount) || 0;
        if (amount > 0 && !sp.accountId) {
          newErrors[`rewardSource_${i}`] = 'Payment source is required';
        }
        if (sp.accountId && amount <= 0) {
          newErrors[`rewardUsed_${i}`] = 'Amount is required when a source is selected';
        }
        // One source, once. Two cards on the same account would produce two legs on it that nothing
        // could tell apart — not the ledger, not the next edit — and their balance checks would each
        // think the whole balance was theirs to spend.
        if (sp.accountId && splits.findIndex(o => o.accountId === sp.accountId) !== i) {
          newErrors[`rewardSource_${i}`] = 'Already used by another source on this split';
        }
        // Can't redeem more than the account holds. Compared in the account's own unit, and the
        // message names the figure because the collapsed picker shows only the account name. Skipped
        // for a one-time reward: it has no tracked balance, so there is no ceiling to test against.
        if (sp.accountId && !isExternalRewardSource(sp.accountId) && amount > 0) {
          const acc = sourceAccountOf(sp);
          const points = isUnitDenominated(acc);
          // On an edit, what this source had already redeemed has been taken out of its balance —
          // hand it back before comparing, or re-saving (or even lowering) an untouched redemption
          // would fail. Per account, so money spent from a source that has since been swapped out is
          // no help against the new one's balance.
          const reusable = committedRewardRef.current[sp.accountId] || 0;
          const available = rewardBalanceOf(sp) + (points ? rupeesToRewardPoints(reusable, acc) : reusable);
          const needed = points ? rupeesToRewardPoints(amount, acc) : amount;
          if (needed - available > 0.001) {
            newErrors[`rewardUsed_${i}`] = `Only ${formatRewardBalanceOf(sp, available)} available`;
          }
        }
      });
      /* The rewards together can never pay more than the price they come out of. This used to be
         checked for a one-time reward alone — the one source with no balance to bound it — but with
         several sources it is the SUM that has to fit, and mainAccountAmount floors at zero, so an
         overshoot would clamp the primary debit to ₹0 and quietly swallow the difference. */
      if (rewardTotal - (Number(newTx.amount) || 0) > 0.001) {
        const last = Math.max(0, splits.length - 1);
        newErrors[`rewardUsed_${last}`] = splits.length > 1
          ? `Together they exceed the ${formatCurrency(Number(newTx.amount) || 0)} total`
          : `Cannot exceed the ${formatCurrency(Number(newTx.amount) || 0)} total`;
      }
      // Only the active card is on screen, so an error on any other one has to bring it into view or
      // the form would refuse to save with nothing to show for it.
      const firstBad = splits.findIndex((_, i) => newErrors[`rewardUsed_${i}`] || newErrors[`rewardSource_${i}`]);
      if (firstBad >= 0) setActiveSplit(firstBad);
    }

    if (newTx.accountId && newTx.type === 'debit' && !newTx.isTravelTransaction && newTx.category?.toLowerCase() === 'ncmc travel recharge') {
      const account = data.accounts.find(a => a.id === newTx.accountId);
      if (account?.isNcmcEnabled) {
        const currentMonth = getCurrentMonthStr();
        const currentBalance = calculateBalance(account, data.transactions, currentMonth, false);
        const transferAmount = Number(newTx.amount) || 0;

        let availableBalance = currentBalance;
        if (editId) {
          const oldTx = data.transactions.find(t => t.id === editId);
          if (oldTx && oldTx.accountId === account.id && oldTx.type === 'debit' && !oldTx.isTravelTransaction) {
            availableBalance += oldTx.amount;
          }
        }

        const roundedAmount = Math.round(transferAmount * 100) / 100;
        const roundedBalance = Math.round(availableBalance * 100) / 100;

        if (roundedAmount > roundedBalance) {
          newErrors.amount = `Insufficient balance. Available Payments balance is ${formatCurrency(availableBalance)}`;
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      scrollToFirstError(modalBodyRef.current);
      return;
    }
    setErrors({});

    if (tempCreatedActiveTags.length > 0) {
      const currentActive = data.tags || [];
      const toAdd = tempCreatedActiveTags.filter(t => !currentActive.includes(t));
      if (toAdd.length > 0) {
        updateTags([...currentActive, ...toAdd]);
      }
    }
    if (tempCreatedEventTags.length > 0) {
      const currentEvent = data.eventTags || [];
      const toAdd = tempCreatedEventTags.filter(t => !currentEvent.includes(t));
      if (toAdd.length > 0) {
        updateEventTags([...currentEvent, ...toAdd]);
      }
    }

    const account = data.accounts.find(a => a.id === newTx.accountId);
    const isCCPayment = newTx.category?.toLowerCase() === 'cc payment';
    // Only a CC PAYMENT chooses which statement it lands on. That is the one flow where the
    // "Apply Payment To" picker is rendered, and the only one where "reduce already billed dues" is a
    // meaningful thing to ask. Every OTHER credit on a card — a merchant refund, a reversal, a
    // cashback credit — belongs to the cycle its own date falls in, exactly like a debit does.
    //
    // This used to fire for EVERY card credit while the picker rendered only for CC Payment, so those
    // credits silently inherited the picker's default of 'previous_statement' with no UI ever shown and
    // no way to change it: a 569 refund dated 12 Aug was filed against the JULY statement and vanished
    // from the August one it belonged to. Records written by that build are still out there — they
    // only heal when the row is next saved through this form, which is exactly what clearing does.
    //
    // Anything else keeps its cycle ONLY if cycleMovedManually says a human set it from the
    // statement screen (a refund settles late just like a purchase, so it can be moved there). That
    // flag is the whole point: a legacy stamp and a deliberate move are byte-identical in
    // appliedBillingCycleYearMonth, so preserving the field unconditionally would have made every
    // one of those old bad stamps permanent — turning the self-healing clear above into a no-op.
    const manualCycleKept = !isCCPayment
      && !!newTx.cycleMovedManually
      && !!newTx.appliedBillingCycleYearMonth;
    const ccPaymentAppliedCycle = isCCPayment && account?.type === 'credit_card' && newTx.type === 'credit'
      ? resolveCcPaymentCycle(newTx.date as string, account.statementDay)
      : (manualCycleKept ? newTx.appliedBillingCycleYearMonth : undefined);

    let finalCategory = newTx.category;
    const mainTxId = editId || generateId();
    let currentLinkedIds: string[] = [];

    if (editId) {
      const existingTx = data.transactions.find(t => t.id === editId);
      currentLinkedIds = existingTx?.linkedTransactionIds || (existingTx?.linkedTransactionId ? [existingTx.linkedTransactionId] : []);
    }

    // Linked counterpart (child leg) creation. Edit/delete sync behavior is documented in
    // docs/LINKED_TRANSACTIONS.md — keep that matrix accurate when changing this block.
    const isTransfer = newTx.category?.toLowerCase() === 'transfer';
    const hidesPassiveToggleFinal = ['transfer', 'cc payment', 'ncmc travel recharge', 'lending & borrowing'].includes((newTx.category || '').toLowerCase());
    const investmentKind = activeInvestmentKind;
    const isMf = investmentKind === 'mutual_funds';
    const isStocks = investmentKind === 'stocks';
    const isCommodity = investmentKind === 'commodity';
    // "isInvestment" here means the allotted-vs-charges pair applies (funds and stocks quote an
    // invested amount plus AMC/brokerage on top). Commodity buys are a single gross amount.
    const isInvestment = isMf || isStocks;
    const allottedAmount = isInvestment ? (newTx.allottedAmount !== undefined ? Number(newTx.allottedAmount) : Number(newTx.amount)) : Number(newTx.amount);
    const investmentCharges = isInvestment ? (newTx.investmentCharges !== undefined ? Number(newTx.investmentCharges) : Math.max(0, Number(newTx.amount) - allottedAmount)) : undefined;

    // Does an investment counterpart leg already exist (i.e. we're editing, not creating)? If so,
    // we skip re-creating it here — updateTransaction() in FinanceContext keeps it in sync, and
    // clears it when the pairing/category is removed. We only create a leg when there isn't one
    // yet, which also covers converting a plain log into an investment via edit.
    const hasLinkedCategoryLeg = (catLower: string) => currentLinkedIds.some(id => {
      const lt = data.transactions.find(t => t.id === id);
      return !!lt && lt.id !== mainTxId && lt.category?.toLowerCase() === catLower;
    });
    // All three investment kinds share one category, so an existing leg is matched on kind. A leg
    // whose kind can't be resolved still counts as this kind's leg: it IS the investment counterpart
    // (nothing else links here), and treating it as absent would create a second, duplicate leg.
    const hasLinkedInvestmentLeg = (kind: InvestmentKind) => currentLinkedIds.some(id => {
      const lt = data.transactions.find(t => t.id === id);
      if (!lt || lt.id === mainTxId || !isInvestmentCategory(lt.category)) return false;
      const legKind = getInvestmentKind(lt, data.accounts);
      return legKind === undefined || legKind === kind;
    });
    const hasStocksLeg = hasLinkedInvestmentLeg('stocks');
    const hasMfLeg = hasLinkedInvestmentLeg('mutual_funds');
    const hasCommodityLeg = hasLinkedInvestmentLeg('commodity');
    const hasTransferOrCCLeg = hasLinkedCategoryLeg('transfer') || hasLinkedCategoryLeg('cc payment');

    // A reward split always anchors on the CARD leg (whose amount is the full bill), per
    // docs/LINKED_TRANSACTIONS.md. Logged from Credit POV the card IS the main tx, so it holds the
    // anchor (rewardUsed + the reward leg) naturally. Logged from Debit POV the card is the counterpart,
    // so we move the anchor onto it and keep the bank main tx as a plain funding child. Without this,
    // the anchor would sit on the bank leg (partial amount ₹148) and both openEditModal reconstruction
    // and updateTransaction's Option-B rebalance would use the wrong total.
    // Any split about to be created needs an id for its reward leg — including a 2-leg split on an
    // ordinary purchase. This used to be generated only for the CC-Payment case, so a plain split
    // pushed `null` onto the parent's linkedTransactionIds: the leg pointed back at the parent but
    // the parent never pointed at the leg, which broke every sync that walks that list (editing the
    // amount left the leg stranded at its old figure, so the reward account stayed over-debited).
    // Unreachable while splits were CC-Payment-only.
    //
    // A split funded by a one-time reward ("Other") gets a leg like any other source — its account is
    // the external sentinel, which matches no account, so the leg debits nothing anywhere. It used to
    // create none, and the redemption showed up only as a pill on this row: nothing to expand,
    // nothing to tap through to the split panel, and a two-source split that listed one leg.
    const liveSplits = showRewardSplit
      ? splits.filter(sp => !!sp.accountId && (Number(sp.amount) || 0) > 0)
      : [];
    const hasRewardSplit = liveSplits.length > 0 && !editId;
    /* An edit can need a leg built too, and used to get none: the `!editId` above meant that giving an
       existing row a real reward source — switching it off a one-time reward, adding a split to a row
       that never had one, or (now) tacking a second wallet onto an existing split — recorded the
       redemption on the anchor while the reward account was never debited. updateTransaction syncs
       existing legs but has never created one, which is the same gap the instant-cashback block below
       already compensates for. The gate lives in RewardLegService beside the retarget/delete half of
       the same decision, and is asked once PER SOURCE: adding a wallet to a split must build exactly
       one leg and leave its siblings' legs alone.
       A funding CHILD of someone else's split (the bank leg, whose form carries the anchor's
       reconstructed sources) builds nothing at all — the legs it can see belong to the anchor. */
    const isSplitChildRow = isRewardSplitChildRow(editId, data.transactions);
    const claimedLegIds: string[] = [];
    const rewardSplitPlan = liveSplits.map(source => {
      if (isSplitChildRow) {
        if (source.legId) claimedLegIds.push(source.legId);
        return { source, legId: source.legId, isNew: false };
      }
      const existing = existingLegIdForSplit({
        editId,
        split: { accountId: source.accountId, amount: source.amount, legId: source.legId },
        linkedIds: currentLinkedIds,
        transactions: data.transactions,
        claimedLegIds,
      });
      const legId = existing ?? generateId();
      claimedLegIds.push(legId);
      return { source, legId, isNew: !existing };
    });
    /** What the anchor will record: one entry per source, each pointing at its own leg. */
    const anchorSplits: RewardSplitLeg[] = rewardSplitPlan.map(({ source, legId }) => ({
      accountId: source.accountId,
      amount: Number(source.amount) || 0,
      legId,
    }));
    const rewardUsedTotal = Math.round(anchorSplits.reduce((sum, sp) => sum + sp.amount, 0) * 100) / 100;
    const newRewardLegIds = rewardSplitPlan.filter(p => p.isNew).map(p => p.legId as string);
    // Anchoring, by contrast, IS CC-specific: a reward split anchors on the CARD leg (whose amount is
    // the full bill), per docs/LINKED_TRANSACTIONS.md. Logged from Credit POV the card IS the main tx,
    // so it holds the anchor (rewardUsed + the reward leg) naturally. Logged from Debit POV the card is
    // the counterpart, so we move the anchor onto it and keep the bank main tx as a plain funding
    // child. Without this the anchor would sit on the bank leg (partial amount ₹148) and both
    // openEditModal reconstruction and updateTransaction's Option-B rebalance would use the wrong total.
    const isCcRewardSplit = isCCPayment && hasRewardSplit;
    const anchorOnCounterpart = isCcRewardSplit && newTx.type === 'debit';
    let cardAnchorId: string | null = null;

    if (isStocks && paymentSourceAccountId && !hasStocksLeg) {
      const bankCounterpartId = generateId();
      currentLinkedIds.push(bankCounterpartId);
      const counterpartType = newTx.type === 'credit' ? 'debit' : 'credit';
      addTransaction({
        id: bankCounterpartId,
        date: newTx.date as string,
        description: (newTx.description as string).trim(),
        accountId: paymentSourceAccountId,
        type: counterpartType,
        amount: counterpartType === 'credit' ? allottedAmount : (allottedAmount + (investmentCharges || 0)),
        category: INVESTMENT_CATEGORY,
        investmentKind: 'stocks',
        isRecurring: false,
        linkedTransactionIds: [mainTxId],
        numberOfShares: newTx.numberOfShares,
        allottedAmount: allottedAmount,
        investmentCharges: investmentCharges
      });
    } else if (isCommodity && paymentSourceAccountId && !hasCommodityLeg) {
      const bankCounterpartId = generateId();
      currentLinkedIds.push(bankCounterpartId);
      const counterpartType = newTx.type === 'credit' ? 'debit' : 'credit';
      addTransaction({
        id: bankCounterpartId,
        date: newTx.date as string,
        description: (newTx.description as string).trim(),
        accountId: paymentSourceAccountId,
        type: counterpartType,
        amount: Number(newTx.amount),
        category: INVESTMENT_CATEGORY,
        investmentKind: 'commodity',
        isRecurring: false,
        linkedTransactionIds: [mainTxId],
        numberOfShares: newTx.numberOfShares
      });
    } else if (isMf && paymentSourceAccountId && !hasMfLeg) {
      const bankCounterpartId = generateId();
      currentLinkedIds.push(bankCounterpartId);
      const counterpartType = newTx.type === 'debit' ? 'credit' : 'debit';

      addTransaction({
        id: bankCounterpartId,
        date: newTx.date as string,
        description: (newTx.description as string).trim(),
        accountId: paymentSourceAccountId,
        type: counterpartType,
        amount: counterpartType === 'credit' ? allottedAmount : (allottedAmount + (investmentCharges || 0)),
        category: INVESTMENT_CATEGORY,
        investmentKind: 'mutual_funds',
        isRecurring: false,
        linkedTransactionIds: [mainTxId],
        allottedAmount: allottedAmount,
        investmentCharges: investmentCharges,
        numberOfShares: newTx.numberOfShares
      });
    } else if ((isTransfer || isCCPayment) && paymentSourceAccountId && !hasTransferOrCCLeg) {
      const bankCounterpartId = generateId();
      currentLinkedIds.push(bankCounterpartId);
      const destAccount = data.accounts.find(a => a.id === paymentSourceAccountId);
      const counterpartType = newTx.type === 'credit' ? 'debit' : 'credit';

      let counterpartDesc = '';
      if (isCCPayment) {
        if (counterpartType === 'credit') {
          counterpartDesc = 'CC Bill Payment';
        } else {
          const targetCardName = newTx.type === 'credit' ? account?.name : destAccount?.name;
          counterpartDesc = `CC Payment: ${targetCardName || 'Unknown'}`;
        }
      } else {
        counterpartDesc = newTx.type === 'credit' ? `Transfer to ${account?.name}` : `Transfer from ${account?.name}`;
      }

      const rewardUsedForTransfer = rewardUsedTotal;
      const bankPortion = Number(newTx.amount) - rewardUsedForTransfer;
      // The receiving/credit leg (e.g. CC bill reduction) must reflect the FULL payment
      // (bank portion + rewards portion). Only the funding/debit leg is reduced by rewards.
      const counterpartLegAmount = counterpartType === 'credit' ? Number(newTx.amount) : bankPortion;
      // A transfer may move a different figure on the far side — a discounted gift-card load
      // credits more than it debits, a fee-charging transfer credits less. Only plain transfers
      // get this: a CC payment always lands exactly what was sent, and investments already carry
      // their own allotted/charges split.
      const legAmount = (isTransfer && newTx.counterpartAmount !== undefined && newTx.counterpartAmount > 0)
        ? Number(newTx.counterpartAmount)
        : counterpartLegAmount;

      // Debit POV split: this credit counterpart IS the card, so it becomes the split anchor —
      // it holds rewardUsed + links to both the bank main tx and the reward leg. (Credit POV keeps
      // the anchor on the main tx, so this leg stays a plain counterpart.)
      const isCardAnchorLeg = anchorOnCounterpart && counterpartType === 'credit';
      if (isCardAnchorLeg) cardAnchorId = bankCounterpartId;

      addTransaction({
        id: bankCounterpartId,
        date: newTx.date as string,
        description: counterpartDesc,
        accountId: paymentSourceAccountId,
        type: counterpartType,
        amount: legAmount,
        // Mirrored so this row is self-describing too: opening it for edit shows the pair
        // the same way round, and re-saving from this side keeps both amounts.
        counterpartAmount: legAmount !== Number(newTx.amount) ? Number(newTx.amount) : undefined,
        category: isCCPayment ? 'CC Payment' : 'Transfer',
        isRecurring: false,
        // Every source of the split hangs off the card, this POV's anchor.
        linkedTransactionIds: isCardAnchorLeg
          ? [mainTxId, ...newRewardLegIds]
          : [mainTxId],
        // The card leg is the anchor from this POV, so the redemption list lives on it.
        ...(isCardAnchorLeg ? withRewardSplits({} as Partial<Transaction>, anchorSplits) : {}),
        appliedBillingCycleYearMonth: isCCPayment && counterpartType === 'credit' && destAccount?.type === 'credit_card'
          ? resolveCcPaymentCycle(newTx.date as string, destAccount.statementDay)
          : undefined
      });

      if (isCCPayment && newTx.type === 'credit') finalCategory = 'CC Payment';
    }

    const rewardUsed = rewardUsedTotal;
    // One leg per NEW source. The rewards pay down the CARD's bill, not the funding bank: the card is
    // the main account when logged as a Credit (Receive), or the paymentSourceAccountId ("Pay To
    // Card") when logged as a Debit (Spend) — mirror the targetCardName logic used for the bank leg
    // above.
    const paidCardName = (newTx.type === 'credit' ? account : data.accounts.find(a => a.id === paymentSourceAccountId))?.name;
    rewardSplitPlan.filter(p => p.isNew).forEach(({ source, legId }) => {
      // Debit POV: link the reward leg to the card anchor and keep it OFF the bank main tx's link list
      // (the card is the hub). Credit POV: the main tx IS the card, so link to it as before.
      if (!anchorOnCounterpart) currentLinkedIds.push(legId as string);
      const rewardsSourceAcc = data.accounts.find(a => a.id === source.accountId);
      addTransaction({
        id: legId as string,
        date: newTx.date as string,
        // "Paid toward", not "Rewards applied to": the source may now be an e-wallet holding real
        // money, and calling a ₹81 Flipkart Wallet payment a reward would be a plain lie on the row.
        // Reads correctly for a redemption too — points paid toward it just the same. Kept in step
        // with RewardLegService, which rewrites this on every anchor edit.
        description: `Paid toward: ${isCCPayment ? (paidCardName || account?.name || 'CC') : newTx.description}`,
        // A one-time reward's leg carries the external sentinel here. It matches no account, which is
        // exactly what makes the row safe: no balance moves, nothing had to be set up first, and the
        // redemption is still a row you can see, expand and tap through to the split it belongs to.
        accountId: source.accountId,
        type: 'debit',
        // Rupees, like every other amount in the ledger — a points figure here would be summed as
        // money by the day totals and spend stats. calculateBalance applies the rate when it reads
        // this leg into the points balance. See docs/LINKED_TRANSACTIONS.md.
        amount: Number(source.amount) || 0,
        category: isCCPayment ? 'CC Payment' : (newTx.category as string),
        isRecurring: false,
        // Deliberately isPointsDenominated, not isUnitDenominated: this flag routes the leg into an
        // account's SEPARATE points ledger, which only a card has. A rewards wallet counted in Chips
        // still has one rupee ledger, and this leg is what draws it down.
        isRewardTransaction: isPointsDenominated(rewardsSourceAcc),
        linkedTransactionIds: [(anchorOnCounterpart && cardAnchorId) ? cardAnchorId : mainTxId]
      });
    });

    const mainAccountAmount = isInvestment 
      ? (newTx.type === 'debit' ? (allottedAmount + (investmentCharges || 0)) : allottedAmount) 
      : ((newTx.type === 'debit')
        ? Math.max(0, Number(newTx.amount) - rewardUsed)
        : Number(newTx.amount));

    /* A passive exclusion is entered against the full price but has to be STORED per row, because
       statsAmount subtracts a row's exclusion from that row's own amount — parking the whole ₹448
       on an anchor that holds ₹362 would score the purchase at −₹86 and eat into other spends.
       So the anchor absorbs what it can and the reward leg carries the rest. An exclusion with no
       stated amount means "all of it", which is both rows in full. */
    const passiveOn = !hidesPassiveToggleFinal && !!newTx.excludeFromStats;
    const totalExcluded = passiveOn
      ? (newTx.excludedAmount ?? (Number(newTx.amount) || 0))
      : 0;
    const anchorExcluded = passiveOn ? Math.min(totalExcluded, mainAccountAmount) : 0;
    /* Whatever the anchor could not absorb runs down the reward legs in the order the sources were
       added, each taking up to what it paid. With one source that is the old "the leg carries the
       rest"; with two, a ₹448 purchase excluded in full and split ₹50 + ₹36 puts ₹362 on the anchor,
       ₹50 on the first leg and ₹36 on the second — so the three rows still sum to the price. */
    let unassignedExclusion = passiveOn ? Math.max(0, totalExcluded - mainAccountAmount) : 0;
    const legExclusions = rewardSplitPlan
      .filter(p => !!p.legId)
      .map(({ source, legId }) => {
        const take = Math.min(Number(source.amount) || 0, unassignedExclusion);
        unassignedExclusion = Math.round((unassignedExclusion - take) * 100) / 100;
        return { legId: legId as string, excluded: take };
      });

    // On edit, updateTransaction syncs an EXISTING linked cashback leg but won't create one.
    // So create the leg here when instant cashback is configured but no cashback leg exists yet
    // (covers both new transactions and edits that add cashback for the first time).
    const hasExistingCashbackLeg = editId
      ? data.transactions.some(t => currentLinkedIds.includes(t.id) && t.category === 'Cashback')
      : false;
    if (newTx.rewardEarnedType === 'instant' && (newTx.rewardEarned || 0) > 0 && newTx.rewardEarnedAccountId && !hasExistingCashbackLeg) {
      const instantCbId = generateId();
      currentLinkedIds.push(instantCbId);
      addTransaction({
        id: instantCbId,
        date: newTx.date as string,
        description: `Instant Cashback: ${newTx.description}`,
        accountId: newTx.rewardEarnedAccountId,
        type: 'credit',
        amount: Number(newTx.rewardEarned),
        category: 'Cashback',
        isRecurring: false,
        linkedTransactionIds: [mainTxId]
      });
    }

    if (account?.isNcmcEnabled && newTx.type === 'credit' && newTx.isTravelTransaction && !editId && !paymentSourceAccountId) {
      const counterpartId = generateId();
      currentLinkedIds.push(counterpartId);
      addTransaction({
        id: counterpartId,
        date: newTx.date as string,
        description: `Transfer to Travel Wallet`,
        accountId: account.id,
        type: 'debit',
        amount: Number(newTx.amount),
        category: finalCategory === 'NCMC Travel Recharge' ? 'NCMC Travel Recharge' : 'Transfer',
        isRecurring: false,
        isTravelTransaction: false,
        linkedTransactionIds: [mainTxId]
      });
    }

    if (account?.isNcmcEnabled && newTx.type === 'debit' && !newTx.isTravelTransaction && finalCategory === 'NCMC Travel Recharge' && !editId) {
      const counterpartId = generateId();
      currentLinkedIds.push(counterpartId);
      addTransaction({
        id: counterpartId,
        date: newTx.date as string,
        description: `NCMC Travel Recharge`,
        accountId: account.id,
        type: 'credit',
        amount: Number(newTx.amount),
        category: 'NCMC Travel Recharge',
        isRecurring: false,
        isTravelTransaction: true,
        linkedTransactionIds: [mainTxId]
      });
    }

    let finalRewardEarned = Number(newTx.rewardEarned) || 0;
    if (newTx.rewardEarnedType === 'delayed' && !finalRewardEarned) {
      if ((account?.type === 'credit_card' || account?.type === 'debit_card') && newTx.type === 'debit' && !newTx.isTravelTransaction && finalCategory !== 'Transfer' && finalCategory !== 'CC Payment' && finalCategory !== 'NCMC Travel Recharge') {
        const selectedCbObj = account.cashbackRates?.find(r => r.id === selectedCashbackLevelId);

        let rateToUse = 0;
        let shouldRoundOff = account.roundOffCashback;

        if (selectedCbObj) {
          rateToUse = selectedCbObj.rate;
          shouldRoundOff = selectedCbObj.roundOffCashback;
        } else if (selectedCashbackLevelId === 'default') {
          rateToUse = account.defaultCashbackRate || 0;
        }

        finalRewardEarned = (newTx.amount! * (rateToUse || 0)) / 100;
        if (shouldRoundOff) finalRewardEarned = Math.floor(finalRewardEarned);
      }
    }

    const finalTx: Transaction = {
      id: mainTxId,
      date: newTx.date as string,
      description: (newTx.description as string || '').trim(),
      accountId: newTx.accountId as string,
      type: newTx.type as TransactionType,
      amount: mainAccountAmount,
      category: finalCategory as string,
      // A log created from a tracked bill counts as recurring and keeps the link back to that bill,
      // which is what the Bills tab reads to mark it paid (and what advances the due date below).
      recurringBillId: newTx.recurringBillId,
      isRecurring: newTx.isRecurring || !!newTx.recurringBillId,
      appliedBillingCycleYearMonth: ccPaymentAppliedCycle,
      cycleMovedManually: manualCycleKept || undefined,
      // Carried across the edit, like isTravelTransaction below. Omitting it dropped the flag on
      // every save, and the flag is what keeps a leg OUT of the rupee ledger (affectsRupeeBalance):
      // a points cashback credit that lost it stopped being Jewels and started reducing the card's
      // real outstanding — the exact double-count the predicate exists to prevent.
      //
      // Re-tested against the CURRENT account rather than trusted blindly, because the flag is only
      // ever set when the destination is points-denominated. isTravelTransaction can be preserved
      // as-is since the account picker already clears it when the new account isn't NCMC-enabled;
      // nothing does that for this one, so a row moved to a rupee account would keep a stale true.
      isRewardTransaction: (newTx.isRewardTransaction && isPointsDenominated(account)) || undefined,
      rewardEarned: finalRewardEarned,
      rewardEarnedType: newTx.rewardEarnedType,
      rewardEarnedAccountId: newTx.rewardEarnedAccountId,
      // Debit POV split: the anchor (the redemption list) lives on the card counterpart, not this
      // bank main tx, which stays a plain funding child.
      ...withRewardSplits({} as Partial<Transaction>, anchorOnCounterpart ? [] : anchorSplits),
      isTravelTransaction: newTx.isTravelTransaction,
      counterpartAmount: (isTransfer && paymentSourceAccountId && newTx.counterpartAmount !== undefined && newTx.counterpartAmount > 0 && newTx.counterpartAmount !== Number(newTx.amount))
        ? Number(newTx.counterpartAmount)
        : undefined,
      linkedTransactionIds: currentLinkedIds,
      cashbackLevelId: selectedCashbackLevelId,
      excludeFromStats: hidesPassiveToggleFinal ? false : newTx.excludeFromStats,
      // Clamped to what is actually stored: a stale exclusion (e.g. the split was raised after the
      // passive amount was set) must never exceed the amount, or the row reads as fully passive.
      excludedAmount: passiveOn ? anchorExcluded : undefined,
      paymentSourceAccountId: paymentSourceAccountId,
      allottedAmount: isInvestment ? allottedAmount : undefined,
      investmentCharges: isInvestment ? investmentCharges : undefined,
      numberOfShares: investmentKind ? newTx.numberOfShares : undefined,
      investmentKind: investmentKind,
      tags: (newTx.tags || []).length > 0 ? newTx.tags : undefined,
      order: newTx.order
    };

    if (editId) {
      updateTransaction(finalTx);
    } else {
      addTransaction(finalTx);
    }

    /* Hand the reward leg its share of the exclusion. Done as a separate patch rather than inline
       at leg creation because the same call has to serve both paths: on an edit the leg already
       exists and is re-synced by updateTransaction above, which preserves the fields this writes.
       Both are functional state updates, so this one reads the result of the save. */
    legExclusions.forEach(({ legId, excluded }) => {
      setRewardLegExclusion(legId, excluded > 0 ? excluded : undefined);
    });

    // Logging a tracked bill rolls it to its next occurrence. Only ever reachable from the Upcoming
    // Bills "LOG" button, which is what puts recurringBillId on the prefill — the Ledger's own add
    // flow never sets it, so this is a no-op there. Skipped on edit: re-saving an already-logged
    // bill must not advance the due date a second time.
    if (!editId && finalTx.recurringBillId) {
      const bill = (data.recurringBills || []).find(b => b.id === finalTx.recurringBillId);
      if (bill) {
        updateRecurringBill(advanceBillCycle(bill, parseISO(finalTx.date)));
      }
    }

    // SMS queue upkeep is Ledger-only: the form is driven by a queued message there, and never is
    // from Bills, so without the sms prop neither the consume nor the counterpart sweep runs.
    if (sms) {
      if (sms.processing) removeFromSmsQueue(0);
      // Auto-sweep duplicate counterpart SMS generated by Transfer / CC Payment
      if ((isTransfer || isCCPayment) && paymentSourceAccountId && !editId) {
        const bankPortion = Number(newTx.amount) - rewardUsedTotal;
        const counterpartType = newTx.type === 'credit' ? 'debit' : 'credit';
        removeSmsByMatch(bankPortion, counterpartType, paymentSourceAccountId);
      }
    }

    onSuccess?.();
    onClose();
  };

  const handleCreateTag = () => {
    const raw = newTagInput.trim().replace(/^#/, '');
    if (!raw) return;
    const activeTags = [...(data.tags || []), ...tempCreatedActiveTags];
    const eventTags = [...(data.eventTags || []), ...tempCreatedEventTags];
    const matchActive = activeTags.find(t => t.toLowerCase() === raw.toLowerCase());
    const matchEvent = eventTags.find(t => t.toLowerCase() === raw.toLowerCase());
    const tagToApply = matchActive || matchEvent || raw;

    if (newTagTargetType === 'active') {
      if (!matchActive && !tempCreatedActiveTags.includes(raw)) {
        setTempCreatedActiveTags(prev => [...prev, raw]);
      }
    } else {
      if (!matchEvent && !tempCreatedEventTags.includes(raw)) {
        setTempCreatedEventTags(prev => [...prev, raw]);
      }
    }

    if (!(newTx.tags || []).includes(tagToApply)) {
      setNewTx(prev => ({ ...prev, tags: [...(prev.tags || []), tagToApply] }));
    }
    setNewTagInput('');
  };

  const isTransfer = newTx.category?.toLowerCase() === 'transfer';
  const isCCPayment = newTx.category?.toLowerCase() === 'cc payment';
  // Mirrors the "Deposit To" picker's own options, so the instant-cashback block is never offered
  // with an empty destination list.
  const hasCashbackDepositAccount = data.accounts.some(a =>
    (!a.archived || a.id === newTx.rewardEarnedAccountId) && (a.type === 'rewards' || a.type === 'e_wallet')
  );
  /* Which accounts can fund a split.
     Three kinds, and all three are offered unconditionally:
       - 'rewards' wallets, whatever they count in (CRED coins in rupees, Cheq Chips in Chips);
       - e-wallets, because the leg this panel writes is the same row either way: a plain rupee
         debit on the source, linked to the anchor, with the anchor holding `total − split`. A
         Flipkart order paid ₹81 from the Flipkart Wallet and ₹106 on a card is the same shape as
         one part-paid with CRED coins, and every reward-specific behaviour downstream is gated on
         `isPointsDenominated`, which an e-wallet does not satisfy — so its leg moves the wallet's
         rupee balance, exactly as it should. Loading the wallet was a Transfer, which is
         stats-excluded, so the spend is still counted once;
       - any card carrying its own points ledger (Jupiter's Jewels).

     That last one used to be tied to the card being charged, on the reasoning that issuer points
     only offset that issuer's own bill. True of most programmes, but it is a rule about the ISSUER,
     not about this ledger, and enforcing it here just hid a balance the user can see on the
     Accounts screen — there was no way to record a redemption the app had decided was impossible.
     The arithmetic never depended on it: a points leg carries `isRewardTransaction`, so it is read
     into its OWN card's points ledger by calculateBalance whichever account the anchor sits on.
     Cash is deliberately absent: a cash purchase has no second leg to reconcile. */
  const splitSourceAccounts = data.accounts.filter(a =>
    (!a.archived || splits.some(sp => sp.accountId === a.id))
    && (a.type === 'rewards' || a.type === 'e_wallet'
      || (a.isCashbackEnabled && a.rewardType === 'points'))
  );
  // Investments are excluded: paying part of a fund/stock/metal buy out of reward points isn't a
  // thing the holdings math models. Everything else that spends money can be split — a CC Payment
  // from either POV, or any ordinary debit. No longer gated on owning a reward account: "Other"
  // is always in the picker, so someone with no reward accounts at all can still record the ₹40
  // coupon that paid part of a bill.
  //
  // Keyed off the CATEGORY, not activeInvestmentKind: the kind is still unset in the window between
  // picking "Investments" and picking the type below it, and the split must already be gone by then
  // — otherwise it shows, gets filled in, and is then silently dropped when the kind lands.
  const canSplitWithRewards = !isInvestmentCategory(newTx.category)
    && (isCCPayment || newTx.type === 'debit');

  /* Each source decides its own unit and its own ceiling: a card's own balance is counted in its own
     unit, a plain rupee wallet (CRED coins, super.money) is already money, and a one-time reward has
     no balance at all. So everything the panel needs is a function OF a card rather than one set of
     values for "the" reward account — that shape is what made a second source impossible. */
  const rewardTotal = Math.round(splits.reduce((sum, sp) => sum + (Number(sp.amount) || 0), 0) * 100) / 100;
  const sourceAccountOf = (split: SplitDraft) => data.accounts.find(a => a.id === split.accountId);
  const rewardUnitLabelOf = (split: SplitDraft) => sourceAccountOf(split)?.rewardUnit || 'Points';
  // A rupee wallet has nothing to toggle, so it stays pinned to rupees whatever the card last held.
  const unitOf = (split: SplitDraft): 'points' | 'rupee' =>
    isUnitDenominated(sourceAccountOf(split)) ? split.unit : 'rupee';
  /* The balance the picker shows for this account, in the account's own unit. Reused by the shortfall
     message, which has to name the figure itself: the collapsed trigger deliberately shows only the
     account name. rewardUnitBalance is what knows the two kinds apart — a card's points wallet is a
     separate ledger already counted in points, a rewards wallet's is rupees converted at its rate. */
  const rewardBalanceOf = (split: SplitDraft) =>
    rewardUnitBalance(sourceAccountOf(split), data.transactions, getCurrentMonthStr(), data.cashbackStatements);
  const formatRewardBalanceOf = (split: SplitDraft, v: number) =>
    formatRewardBalance(sourceAccountOf(split), v);
  // Typed value -> canonical rupees. Points divide by the rate; rupees pass straight through.
  const inputToRupeesFor = (split: SplitDraft, n: number) =>
    unitOf(split) === 'points' ? rewardPointsToRupees(n, sourceAccountOf(split)) : n;

  /* The amount read back in the unit you are NOT typing in, or null when there is no second unit to
     read it in — a rupee wallet, or nothing entered yet. */
  const counterpartHintFor = (split: SplitDraft) => {
    if (!isUnitDenominated(sourceAccountOf(split)) || !(split.amount > 0)) return null;
    return unitOf(split) === 'points'
      ? `= ${formatCurrency(split.amount)}`
      : `= ${rupeesToRewardPoints(split.amount, sourceAccountOf(split))} ${rewardUnitLabelOf(split)}`;
  };
  /* One card carrying that extra line while its neighbour doesn't put their pickers at different
     heights, so swiping between two sources shifted the whole panel under your thumb. If ANY card
     shows the line, every card reserves its space — an empty slot on the cards that have nothing to
     say. Reserved per panel rather than always, so a split funded entirely from rupee wallets (which
     can never have a counterpart) keeps the tighter card it has always had. */
  const anySplitShowsHint = splits.some(sp => counterpartHintFor(sp) !== null);

  /* Sources still on offer for one card: everything eligible, minus what the OTHER cards already
     spend from — including "Other", which is a single one-off by definition and would be
     indistinguishable twice over. That is also the natural ceiling on how many cards there can be,
     so nothing here caps the count at two: split across as many wallets as exist. */
  const availableSourcesFor = (index: number) => splitSourceAccounts.filter(a =>
    a.id === splits[index]?.accountId || !splits.some((o, j) => j !== index && o.accountId === a.id));
  const externalTakenElsewhere = (index: number) =>
    splits.some((o, j) => j !== index && isExternalRewardSource(o.accountId));
  /* Offered on the LAST card, and only while that is the card on screen: the button adds a card
     AFTER this one, so anywhere else it points off screen — and a `+` sitting on every card reads as
     "add one here", which is not what it does. */
  const canAddSplitSource = splits.length > 0
    && activeSplit === splits.length - 1
    && !!splits[splits.length - 1].accountId
    && (splits[splits.length - 1].amount || 0) > 0
    && (availableSourcesFor(splits.length).length > 0 || !externalTakenElsewhere(splits.length));

  const patchSplit = (index: number, patch: Partial<SplitDraft>) => {
    setSplits(prev => prev.map((sp, j) => (j === index ? { ...sp, ...patch } : sp)));
    if (errors[`rewardUsed_${index}`] || errors[`rewardSource_${index}`]) {
      setErrors(prev => ({ ...prev, [`rewardUsed_${index}`]: '', [`rewardSource_${index}`]: '' }));
    }
  };
  /** Every card's errors, dropped at once. Adding or removing a source renumbers the cards, and the
   *  error keys are positions — left alone, the second card's shortfall would be reported against
   *  whichever source slid into its place. */
  const clearSplitErrors = () => setErrors(prev => {
    const next = { ...prev };
    Object.keys(next).forEach(k => {
      if (k.startsWith('rewardUsed_') || k.startsWith('rewardSource_')) delete next[k];
    });
    return next;
  });
  const addSplitSource = () => {
    setSplits(prev => [...prev, blankSplit()]);
    setActiveSplit(splits.length);
    clearSplitErrors();
  };
  /** Drop one source. The last one standing closes the panel — a split with no sources is not a
   *  split, and leaving an empty card behind reads as "there is something to fill in here". */
  const removeSplitSource = (index: number) => {
    const next = splits.filter((_, j) => j !== index);
    setSplits(next);
    setActiveSplit(Math.max(0, Math.min(index, next.length - 1)));
    clearSplitErrors();
    if (next.length === 0) setShowRewardSplit(false);
  };

  // What this row will actually STORE — the Amount field means the full price, but a reward split
  // leaves the primary account paying only the remainder (mirrors mainAccountAmount in handleSave).
  //
  // This is the ceiling for a passive exclusion. The passive controls used to work off the full price,
  // so on a ₹448 purchase split with ₹86 of rewards, marking it passive wrote excludedAmount 448 next
  // to a stored amount of 362 — an exclusion larger than the thing it excludes. Marking it FULLY
  // passive still behaved correctly (isFullyPassive tests `excludedAmount >= amount`), but a partial
  // exclusion was measured against a total this row never held, and the "Cannot exclude more than
  // total amount" check compared against the pre-split figure so it couldn't catch it. Excluded plus
  // active now always sum to what the row records.
  /* The exclusion is stated against the FULL price, rewards included, because that is the number
     the user thinks of as "this purchase". It gets stored split across the two rows — the anchor
     absorbs up to what the primary account actually paid, the overflow lands on the reward leg.
     handleSave does that division; mainAccountAmount there is the boundary. */
  const passiveCeiling = Number(newTx.amount) || 0;

  return (
  <div className="modal-overlay">
    <div className="modal-content">
      <div className="modal-header">
        <h3>{editId ? 'Edit Transaction' : 'Log Transaction'}</h3>
        <button onClick={onClose}><X /></button>
      </div>
      {/* Spacing convention for this form: every direct child of the body owns its
          BOTTOM margin (1rem — the `.input-group` default) and sets no top margin.
          Nothing here collapses, since these are all flex containers, so a stray
          marginTop simply adds to the margin above it.

          Most of this form is optional panels, and the two failure modes both came
          from spacing being shared between neighbours rather than owned by one. The
          Cashback panel carried a marginTop that the Tags block above it leaned on by
          zeroing its own marginBottom — so on a travel spend, where the panel is
          hidden, "Split Payment" ended up flush against the tag input. And the
          Passive panel's marginTop stacked on top of the margin the button above
          already had, for a 32px gap in a form where every other gap is 16. */}
      <div className="modal-body" ref={modalBodyRef}>
        <div className="input-group" onClick={() => setIsDatePickerOpen(true)}>
          <label>Date</label>
          <div className={`input-field flex align-center justify-between gap-3 clickable ${errors.date ? 'border-danger' : ''}`}>
            <span className="text-mono">{newTx.date ? format(parseISO(newTx.date), 'EEE, d MMM yyyy') : 'Select Date'}</span>
            <Calendar size={18} className="text-muted" />
          </div>
          {errors.date && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.date}</span>}
        </div>

        <CustomDatePicker
          isOpen={isDatePickerOpen}
          onClose={() => setIsDatePickerOpen(false)}
          value={newTx.date || ''}
          onChange={(val) => {
            setNewTx({ ...newTx, date: val });
            if (errors.date) setErrors(prev => ({ ...prev, date: '' }));
          }}
        />

        <div className="input-group" style={{ position: 'relative' }}>
          <label>Description</label>
          <input
            className={`input-field ${errors.description ? 'border-danger' : ''}`}
            value={newTx.description}
            onChange={e => handleDescriptionChange(e.target.value)}
            onBlur={() => setTimeout(() => setDescriptionSuggestions([]), 150)}
            placeholder="e.g. Swiggy Order"
            autoComplete="off"
          />
          {errors.description && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.description}</span>}
          {descriptionSuggestions.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '0 0 12px 12px',
              zIndex: 10,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              marginTop: '-4px'
            }}>
              {descriptionSuggestions.map(s => (
                <div
                  key={s}
                  style={{ padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.9rem' }}
                  onClick={() => selectSuggestion(s)}
                  onMouseDown={e => e.preventDefault()}
                >
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4" style={{ marginBottom: '1rem' }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label>Amount</label>
            <input
              type="text"
              inputMode="decimal"
              className={`input-field ${errors.amount ? 'border-danger' : ''}`}
              value={inputStrings.amount}
              onChange={e => {
                const val = e.target.value;
                if (val === '' || /^\d*\.?\d*$/.test(val)) {
                  const numVal = parseFloat(val);
                  const finalAmount = isNaN(numVal) ? 0 : numVal;
                  const isInvestment = activeInvestmentKind === 'mutual_funds' || activeInvestmentKind === 'stocks';
                  const allotted = newTx.allottedAmount || 0;
                  const charges = isInvestment ? Math.max(0, finalAmount - allotted) : undefined;

                  setNewTx(prev => ({
                    ...prev,
                    amount: finalAmount,
                    investmentCharges: charges !== undefined ? parseFloat(charges.toFixed(2)) : undefined
                  }));
                  setInputStrings(s => ({
                    ...s,
                    amount: val,
                    investmentCharges: charges !== undefined ? (parseFloat(charges.toFixed(2)) === 0 ? '' : parseFloat(charges.toFixed(2)).toString()) : s.investmentCharges,
                    // Excluded amount is authoritative; refresh the derived active-share field
                    // so it stays consistent when the total changes.
                    activeShare: newTx.excludeFromStats
                      ? (() => { const share = Math.max(0, finalAmount - (newTx.excludedAmount || 0)); return share === 0 ? '' : parseFloat(share.toFixed(2)).toString(); })()
                      : s.activeShare
                  }));

                  if (errors.amount) setErrors(prev => ({ ...prev, amount: '' }));
                  if (errors.excludedAmount && finalAmount >= (newTx.excludedAmount || 0)) {
                    setErrors(prev => ({ ...prev, excludedAmount: '' }));
                  }
                }
              }}
              placeholder="0.00"
            />
            {errors.amount && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.amount}</span>}
          </div>
          <CustomPicker
            label="Type"
            value={newTx.type!}
            options={[
              { id: 'debit', name: 'Debit (Spend)', subtext: 'Money Going Out' },
              { id: 'credit', name: 'Credit (Receive)', subtext: 'Money Coming In' }
            ]}
            onChange={val => {
              const newType = val as TransactionType;
              const currentDesc = newTx.description || '';
              const isTransferCat = newTx.category?.toLowerCase() === 'transfer';
              const isCCCat = newTx.category?.toLowerCase() === 'cc payment';
              const isTransferAutoFilled = currentDesc.startsWith('Transfer to ') || currentDesc.startsWith('Transfer from ');
              const isCCAutoFilled = currentDesc === 'CC Bill Payment' || currentDesc.startsWith('CC Payment: ');
              let updatedDesc = currentDesc;
              if (isTransferCat && isTransferAutoFilled && paymentSourceAccountId) {
                const selectedAcc = data.accounts.find(a => a.id === paymentSourceAccountId);
                if (selectedAcc) {
                  updatedDesc = newType === 'debit'
                    ? `Transfer to ${selectedAcc.name}`
                    : `Transfer from ${selectedAcc.name}`;
                }
              } else if (isCCCat && isCCAutoFilled) {
                // The card is whichever of the two OLD values is actually a credit_card — not
                // "whichever slot happened to be called paymentSourceAccountId", since that's
                // Account under debit but the funding leg under credit. Looking up by type
                // instead of by slot keeps this correct across the flip either direction.
                const cardAcc = [newTx.accountId, paymentSourceAccountId]
                  .map(id => id ? data.accounts.find(a => a.id === id) : undefined)
                  .find(a => a?.type === 'credit_card');
                if (cardAcc) {
                  // debit = bank pays out → 'CC Payment: <card>'; credit = card receives → 'CC Bill Payment'
                  updatedDesc = newType === 'debit'
                    ? `CC Payment: ${cardAcc.name.trim()}`
                    : 'CC Bill Payment';
                }
              }
              let updatedAccountId = newTx.accountId;
              if (isCCCat) {
                // Flipping direction always invalidates Account for its own slot (debit needs
                // bank/wallet, credit needs the card — mutually exclusive), but the two accounts
                // already on the form are still the right (card, funding) PAIR, just with
                // reversed roles. Swap rather than discard, so a filled-in leg survives the
                // flip instead of forcing a full reselect. The counterpart's own filter is the
                // exact mirror of Account's, so whatever swaps in is guaranteed to fit its slot.
                updatedAccountId = paymentSourceAccountId;
                setPaymentSourceAccountId(newTx.accountId || '');
              }
              let updatedIsTravel = newTx.isTravelTransaction;
              // Flipping direction swaps which side of an investment the main account is (the
              // holding account on a credit, the funding bank on a debit), so the picked
              // accounts can no longer be valid. Clear them for every kind — clearing only for
              // mutual funds used to leave stock/commodity logs pointing at the wrong account type.
              if (activeInvestmentKind) {
                updatedAccountId = '';
                setPaymentSourceAccountId('');
              }
              const selectedAcc = updatedAccountId ? data.accounts.find(a => a.id === updatedAccountId) : null;
              if (newType === 'credit' && selectedAcc?.type === 'debit_card' && selectedAcc?.isNcmcEnabled && newTx.category?.toLowerCase() === 'ncmc travel recharge') {
                updatedIsTravel = true;
                if (updatedDesc === '' || updatedDesc === 'NCMC Travel Recharge' || updatedDesc === 'Transfer to Travel Wallet') {
                  updatedDesc = 'NCMC Travel Recharge';
                }
              } else if (newType === 'debit' && selectedAcc?.type === 'debit_card' && selectedAcc?.isNcmcEnabled && newTx.category?.toLowerCase() === 'ncmc travel recharge') {
                updatedIsTravel = false;
                if (updatedDesc === '' || updatedDesc === 'NCMC Travel Recharge' || updatedDesc === 'Transfer to Travel Wallet') {
                  updatedDesc = 'Transfer to Travel Wallet';
                }
              }
              setNewTx({ ...newTx, type: newType, description: updatedDesc, accountId: updatedAccountId, isTravelTransaction: updatedIsTravel });
            }}
            iconGetter={_id => _id === 'debit' ? <BanknoteArrowDown size={18} /> : <BanknoteArrowUp size={18} />}
            style={{ marginBottom: 0 }}
          />
        </div>

        <CustomPicker
          label="Category"
          value={newTx.category || ''}
          placeholder="Select Category"
          options={[
            ...[...(data.categories || [])].sort((a, b) => {
              const isAOther = a.toLowerCase().includes('other') || a.toLowerCase().includes('misc');
              const isBOther = b.toLowerCase().includes('other') || b.toLowerCase().includes('misc');
              if (isAOther && !isBOther) return 1;
              if (!isAOther && isBOther) return -1;
              return 0;
            }).map(c => ({ id: c, name: c })),
            ...(newTx.category && !(data.categories || []).includes(newTx.category)
              ? [{ id: newTx.category, name: newTx.category }]
              : [])
          ]}
          onChange={val => applyCategorySelection(val, isInvestmentCategory(val) ? activeInvestmentKind : undefined)}
          iconGetter={c => getCategoryIcon(c)}
          error={errors.category}
        />

        {/* Investments is one category with three behaviours — this sub-picker is what selects
            which. Everything downstream (valid account types, quantity field, invested-vs-charges
            split, auto-description) keys off it, so it routes through the same handler as the
            category itself. */}
        {isInvestmentCategory(newTx.category) && (
          <CustomPicker
            label="Investment Type"
            value={newTx.investmentKind || ''}
            placeholder="Select Investment Type"
            options={INVESTMENT_KIND_OPTIONS}
            onChange={val => applyCategorySelection(newTx.category as string, val as InvestmentKind)}
            iconGetter={id => getInvestmentKindIcon(id)}
            error={errors.investmentKind}
          />
        )}

        <CustomPicker
          label="Account"
          value={newTx.accountId || ''}
          placeholder="Select an account"
          options={[...data.accounts]
            .sort(sortByAccountType)
            .filter(acc => {
              // Hide archived (deleted) accounts, but keep the one already on this transaction
              // so editing historical data doesn't blank the field (sorted to the end).
              if (acc.archived && acc.id !== newTx.accountId) return false;
              // Whatever account the transaction is actually ON always stays selectable, even when
              // the rules below wouldn't have offered it. Generalises the archived case above for
              // the same reason: a picker holding a value that matches no option silently renders
              // its placeholder, so a populated field reads as unset. That's what made the reward
              // leg of a CC-Payment split show "Select an account" — the leg is a CC Payment DEBIT
              // sitting on a `rewards` account, which the CC-Payment rule below narrows away to
              // bank/e-wallet only. The account was never actually lost, just unrenderable.
              if (acc.id === newTx.accountId) return true;
              if (isCCPayment) {
                return newTx.type === 'debit' ? (acc.type === 'bank_account' || acc.type === 'e_wallet') : acc.type === 'credit_card';
              }
              // Credit = the holding account receives the units/shares/grams; debit = the bank
              // or wallet funding the buy. One rule per kind, keyed off the matching account type.
              if (activeInvestmentKind) {
                return newTx.type === 'credit'
                  ? acc.type === investmentAccountTypeFor(activeInvestmentKind)
                  : (acc.type === 'bank_account' || acc.type === 'e_wallet');
              }
              return true;
            })
            .map(acc => ({
              id: acc.id,
              name: acc.archived ? `${acc.name} (deleted)` : acc.name,
              subtext: acc.type.replace('_', ' '),
              group: getAccountGroupLabel(acc.type, acc.archived)
            }))}
          onChange={val => {
            const selectedAcc = data.accounts.find(a => a.id === val);
            const isNcmcRecharge = newTx.category?.toLowerCase() === 'ncmc travel recharge';
            const shouldAutoTravel = newTx.type === 'credit' && selectedAcc?.type === 'debit_card' && selectedAcc?.isNcmcEnabled && isNcmcRecharge;
            const shouldAutoDebitDesc = newTx.type === 'debit' && selectedAcc?.type === 'debit_card' && selectedAcc?.isNcmcEnabled && isNcmcRecharge;
            let finalDesc = newTx.description;
            if (activeInvestmentKind) {
              // Name the log after the holding account, whichever leg it's on, so a fund/stock
              // /metal entry reads as the instrument rather than a bare "Investments".
              finalDesc = investmentDescriptionFor(activeInvestmentKind, [val, paymentSourceAccountId]);
            } else {
              finalDesc = shouldAutoDebitDesc ? 'Transfer to Travel Wallet' : (shouldAutoTravel ? 'NCMC Travel Recharge' : newTx.description);
            }
            setNewTx({
              ...newTx,
              accountId: val,
              isTravelTransaction: shouldAutoTravel ? true : (selectedAcc?.isNcmcEnabled ? newTx.isTravelTransaction : false),
              description: finalDesc
            });
            if (errors.accountId) {
              const newErr = { ...errors };
              delete newErr.accountId;
              setErrors(newErr);
            }
          }}
          iconGetter={id => getAccountIcon(id)}
          error={errors.accountId}
        />

        {/* Placed right after Account, ahead of the amount/quantity fields below: for an
            investment leg this picker names the OTHER side of the trade (the funding bank or
            the holding account), which reads more naturally as context before the numbers than
            buried under them. For CC Payment/Transfer/debit-card-credit nothing else renders
            between Account and here anyway, so the move is a no-op for those. */}
        {(
          // A plain credit to a card (refund, reversal, statement credit) has no funding bank,
          // so don't offer the picker there. The debit_card case keeps its generic credit
          // auto-debit source.
          (newTx.type === 'credit' && data.accounts.find(a => a.id === newTx.accountId)?.type === 'debit_card' && !newTx.isTravelTransaction)
          || isTransfer
          // CC Payment always needs the OTHER leg regardless of which account (if any) has been
          // picked yet — the counterpart's own options filter is keyed entirely off newTx.type,
          // not off which specific account ended up in Account, so there's nothing to wait for.
          || isCCPayment
          || !!activeInvestmentKind
        ) && (
            <CustomPicker
              label={
                activeInvestmentKind
                  ? (newTx.type === 'debit'
                    ? `Credit To ${investmentKindLabel(activeInvestmentKind)} Account`
                    : 'Debit From Account')
                  : (newTx.type === 'debit'
                    ? (isCCPayment ? 'Pay To Card (Auto-Credit)' : 'Credit To Account (Auto-Credit)')
                    : 'Debit From Account (Auto-Debit)')
              }
              value={paymentSourceAccountId}
              placeholder="None (Manual Log)"
              options={[
                { id: '', name: 'None (Manual Log)' },
                ...[...data.accounts].sort(sortByAccountType).filter(a => {
                  if (a.id === newTx.accountId) return false;
                  // Hide archived, but keep the counterpart already selected on this transaction.
                  if (a.archived && a.id !== paymentSourceAccountId) return false;
                  if (isCCPayment) {
                    // Symmetric with the main Account filter for the debit leg (bank_account/
                    // e_wallet only) — the credit leg's funding side is the same set of real
                    // money accounts, not "anything that isn't a card" (which let cash, rewards,
                    // debit cards etc. through).
                    return newTx.type === 'debit' ? a.type === 'credit_card' : (a.type === 'bank_account' || a.type === 'e_wallet');
                  }
                  // Mirror of the main Account filter, one direction over: on a debit the
                  // counterpart is the holding account receiving the units/shares/grams.
                  if (activeInvestmentKind) {
                    return newTx.type === 'debit'
                      ? a.type === investmentAccountTypeFor(activeInvestmentKind)
                      : (a.type === 'bank_account' || a.type === 'e_wallet');
                  }
                  return true;
                }).map(acc => ({
                  id: acc.id,
                  name: acc.archived ? `${acc.name} (deleted)` : acc.name,
                  subtext: acc.type.replace('_', ' '),
                  group: getAccountGroupLabel(acc.type, acc.archived)
                }))
              ]}
              onChange={(val) => {
                setPaymentSourceAccountId(val);
                const selectedAcc = val ? data.accounts.find(a => a.id === val) : null;
                const currentDesc = newTx.description || '';
                const isTransferAutoFilled = currentDesc === '' || currentDesc.startsWith('Transfer to ') || currentDesc.startsWith('Transfer from ');
                const isCCAutoFilled = currentDesc === '' || currentDesc === 'CC Bill Payment' || currentDesc.startsWith('CC Payment: ');

                if (isTransfer && isTransferAutoFilled) {
                  // Transfer: auto-fill from account name
                  const autoDesc = selectedAcc
                    ? (newTx.type === 'debit' ? `Transfer to ${selectedAcc.name.trim()}` : `Transfer from ${selectedAcc.name.trim()}`)
                    : '';
                  setNewTx(prev => ({ ...prev, description: autoDesc }));
                } else if (isCCPayment && isCCAutoFilled) {
                  // CC Payment: debit = bank paying card → 'CC Payment: <card>'; credit = card receives → 'CC Bill Payment'
                  const autoDesc = selectedAcc
                    ? (newTx.type === 'debit' ? `CC Payment: ${selectedAcc.name.trim()}` : 'CC Bill Payment')
                    : '';
                  setNewTx(prev => ({ ...prev, description: autoDesc }));
                } else if (activeInvestmentKind) {
                  setNewTx(prev => ({
                    ...prev,
                    description: investmentDescriptionFor(activeInvestmentKind, [newTx.accountId, val])
                  }));
                }
              }}
              iconGetter={_id => _id ? getAccountIcon(_id) : '🚫'}
            />
          )}

        {/* Two sides of a transfer are usually the same figure, and stay implicit when they are.
            They part company when a platform sells balance at a discount (pay ₹180 for a ₹200
            gift card) or a rail charges a fee (send ₹200, ₹197 lands) — both are one transfer,
            not a transfer plus a mystery row, so the far side gets to state its own amount. */}
        {isTransfer && !!paymentSourceAccountId && (() => {
          const isCustom = newTx.counterpartAmount !== undefined;
          const paid = Number(newTx.amount) || 0;
          const other = Number(newTx.counterpartAmount) || 0;
          /* Framed as leaves-vs-arrives, not as this row vs the other one. The same gift-card
             discount is a BIGGER counterpart from the debit side and a SMALLER one from the
             credit side, so reading the raw delta against the current row would call a discount
             a fee on half the screens. Money direction is the only POV-independent framing. */
          const leaves = newTx.type === 'debit' ? paid : other;
          const arrives = newTx.type === 'debit' ? other : paid;
          const delta = arrives - leaves;
          const otherAccName = data.accounts.find(a => a.id === paymentSourceAccountId)?.name || 'the other account';
          // Reads from whichever side this row was logged: a debit sends, a credit receives.
          const customLabel = newTx.type === 'debit' ? 'Amount Received' : 'Amount Debited';
          return (
            <div className="input-group" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
              <label>{newTx.type === 'debit' ? `${otherAccName} receives` : `${otherAccName} is debited`}</label>
              <div className="flex" style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                {([false, true] as const).map(custom => (
                  <button
                    key={String(custom)}
                    type="button"
                    className="text-mono text-xs font-bold"
                    style={{
                      flex: 1,
                      padding: '0.6rem 0.5rem',
                      background: custom === isCustom ? 'var(--accent)' : 'transparent',
                      color: custom === isCustom ? 'var(--btn-text)' : 'var(--text-secondary)',
                      border: 'none',
                      cursor: 'pointer',
                      letterSpacing: '0.5px',
                    }}
                    onClick={() => {
                      // Switching to custom seeds the field with what is being sent, so the row
                      // is valid the moment it appears and only the difference has to be typed.
                      const next = custom ? (paid || 0) : undefined;
                      setNewTx(prev => ({ ...prev, counterpartAmount: next }));
                      setInputStrings(prev => ({ ...prev, counterpartAmount: next === undefined ? '' : String(next) }));
                      if (errors.counterpartAmount) setErrors(prev => ({ ...prev, counterpartAmount: '' }));
                    }}
                  >
                    {custom ? 'CUSTOM AMOUNT' : 'SAME AMOUNT'}
                  </button>
                ))}
              </div>
              {isCustom && (
                <>
                  <label style={{ marginTop: '0.75rem' }}>{customLabel}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={`input-field ${errors.counterpartAmount ? 'border-danger' : ''}`}
                    value={inputStrings.counterpartAmount}
                    placeholder="0.00"
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        setInputStrings(prev => ({ ...prev, counterpartAmount: val }));
                        setNewTx(prev => ({ ...prev, counterpartAmount: val === '' ? 0 : parseFloat(val) }));
                        if (errors.counterpartAmount) setErrors(prev => ({ ...prev, counterpartAmount: '' }));
                      }
                    }}
                  />
                  {errors.counterpartAmount && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.counterpartAmount}</span>}
                  {/* States the difference rather than forbidding one. Which direction is
                      "correct" depends on the POV this row was logged from, so a rule would be
                      wrong half the time; a mistyped figure, though, reads as an absurd delta. */}
                  {!errors.counterpartAmount && other > 0 && delta !== 0 && (
                    <span className="text-xs text-muted" style={{ marginTop: '0.35rem' }}>
                      {formatCurrency(Math.abs(delta))} {delta > 0 ? 'more arrives than leaves' : 'less arrives than leaves'}
                      {' · '}{delta > 0 ? 'discount / bonus' : 'fee / charge'}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {(activeInvestmentKind === 'stocks' || activeInvestmentKind === 'commodity') && (
          <div className="input-group" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
            <label>{activeInvestmentKind === 'commodity' ? 'Grams' : 'No. of Shares'}</label>
            <input
              type="text"
              inputMode="decimal"
              className={`input-field ${errors.numberOfShares ? 'border-danger' : ''}`}
              value={inputStrings.numberOfShares}
              onChange={e => {
                const val = e.target.value;
                if (val === '' || /^\d*\.?\d*$/.test(val)) {
                  setInputStrings(prev => ({ ...prev, numberOfShares: val }));
                  setNewTx(prev => ({ ...prev, numberOfShares: val === '' ? undefined : parseFloat(val) }));
                  if (errors.numberOfShares) setErrors(prev => ({ ...prev, numberOfShares: '' }));
                }
              }}
              placeholder={activeInvestmentKind === 'commodity' ? 'e.g. 0.2456' : 'e.g. 10'}
            />
            {errors.numberOfShares && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.numberOfShares}</span>}
          </div>
        )}

        {(() => {
          const isMf = activeInvestmentKind === 'mutual_funds';
          const isStock = activeInvestmentKind === 'stocks';
          const isInvestment = isMf || isStock;
          return isInvestment && (
            <div style={{ marginTop: '0.5rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px', marginBottom: '1rem' }}>
              <div className="grid grid-cols-2 gap-4">
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>{isStock ? 'Invested Amount' : 'Allotted Amount'}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input-field"
                    value={inputStrings.allottedAmount}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        setInputStrings(prev => ({ ...prev, allottedAmount: val }));
                        const allotted = val === '' ? 0 : (val === '.' ? 0 : parseFloat(val));
                        // Charges is the complement: charges = amount − invested.
                        const totalAmount = Number(newTx.amount || 0);
                        const charges = Math.max(0, totalAmount - allotted);
                        setInputStrings(s => ({ ...s, investmentCharges: parseFloat(charges.toFixed(2)) === 0 ? '' : parseFloat(charges.toFixed(2)).toString() }));
                        setNewTx(prev => ({
                          ...prev,
                          allottedAmount: allotted,
                          investmentCharges: parseFloat(charges.toFixed(2))
                        }));
                      }
                    }}
                    placeholder="0.00"
                  />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>{isStock ? 'Brokerage / Taxes' : 'Stamp Duty / Charges'}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input-field"
                    value={inputStrings.investmentCharges}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        setInputStrings(prev => ({ ...prev, investmentCharges: val }));
                        const charges = val === '' ? 0 : (val === '.' ? 0 : parseFloat(val));
                        // Complement of invested: invested = amount − charges, so you can fill in
                        // whichever you know (invested or charges) and the other is derived.
                        const totalAmount = Number(newTx.amount || 0);
                        const invested = Math.max(0, totalAmount - charges);
                        setInputStrings(s => ({ ...s, allottedAmount: parseFloat(invested.toFixed(2)) === 0 ? '' : parseFloat(invested.toFixed(2)).toString() }));
                        setNewTx(prev => ({
                          ...prev,
                          investmentCharges: charges,
                          allottedAmount: parseFloat(invested.toFixed(2))
                        }));
                      }
                    }}
                    placeholder="0.00"
                  />
                </div>
              </div>
              {isMf && (
                <div className="input-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                  <label>Units Allotted</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input-field"
                    value={inputStrings.numberOfShares}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        setInputStrings(prev => ({ ...prev, numberOfShares: val }));
                        setNewTx(prev => ({ ...prev, numberOfShares: val === '' ? undefined : parseFloat(val) }));
                      }
                    }}
                    placeholder="e.g. 78.234"
                  />
                </div>
              )}
            </div>
          );
        })()}

        {data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled && (
          <div className="input-group">
            <label>Section</label>
            <div className="grid grid-cols-2 gap-2" style={{ marginTop: '0.25rem' }}>
              <button
                className={`btn ${!newTx.isTravelTransaction ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.75rem', borderRadius: '12px' }}
                onClick={() => {
                  const currentDesc = newTx.description || '';
                  const isNcmcCat = newTx.category?.toLowerCase() === 'ncmc travel recharge';
                  // Clear NCMC auto-fill when switching away from Travel section
                  const updatedDesc = isNcmcCat && currentDesc === 'NCMC Travel Recharge' ? '' : currentDesc;
                  const updatedType = isNcmcCat ? 'debit' : newTx.type;
                  setNewTx({ ...newTx, isTravelTransaction: false, description: updatedDesc, type: updatedType });
                }}
              >
                💳 Payments
              </button>
              <button
                className={`btn ${newTx.isTravelTransaction ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.75rem', borderRadius: '12px' }}
                onClick={() => {
                  const currentDesc = newTx.description || '';
                  const isNcmcCat = newTx.category?.toLowerCase() === 'ncmc travel recharge';
                  const isNcmcAccount = !!data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled;
                  const updatedType = isNcmcCat ? 'credit' : newTx.type;
                  // Auto-fill when switching to Travel section with NCMC Travel Recharge category
                  const shouldAutoFill = isNcmcCat && isNcmcAccount && updatedType === 'credit' && (currentDesc === '' || currentDesc === 'NCMC Travel Recharge');
                  const updatedDesc = shouldAutoFill ? 'NCMC Travel Recharge' : currentDesc;
                  setNewTx({ ...newTx, isTravelTransaction: true, description: updatedDesc, type: updatedType });
                }}
              >
                🚇 Travel
              </button>
            </div>
          </div>
        )}

        {!editId && newTx.type === 'credit' && data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled && newTx.isTravelTransaction && (
          <div className="text-xs text-accent flex align-center" style={{ marginTop: '0.5rem', marginBottom: '1rem', padding: '0.75rem', border: '1px dashed var(--accent)', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.05)' }}>
            <span style={{ marginRight: '0.5rem', fontSize: '1rem' }}>ℹ️</span>
            <span>This will automatically debit <strong>{data.accounts.find(a => a.id === newTx.accountId)?.name} (Payments)</strong></span>
          </div>
        )}

        {!editId && newTx.type === 'debit' && data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled && !newTx.isTravelTransaction && newTx.category?.toLowerCase() === 'ncmc travel recharge' && (
          <div className="text-xs text-accent flex align-center" style={{ marginTop: '0.5rem', marginBottom: '1rem', padding: '0.75rem', border: '1px dashed var(--accent)', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.05)' }}>
            <span style={{ marginRight: '0.5rem', fontSize: '1rem' }}>ℹ️</span>
            <span>This will automatically credit <strong>{data.accounts.find(a => a.id === newTx.accountId)?.name} (Travel)</strong></span>
          </div>
        )}

        {data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled && (
          <div className="input-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Hash size={13} style={{ opacity: 0.6 }} />Tags <span className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 400 }}>(optional)</span>
            </label>
            {((data.tags || []).length > 0 || (data.eventTags || []).length > 0 || tempCreatedActiveTags.length > 0 || tempCreatedEventTags.length > 0) && (
              <CustomPicker
                label="Tags"
                hideLabel={true}
                value={newTx.tags || []}
                isMulti={true}
                enableSearch={true}
                searchPlaceholder="Search active & event tags..."
                options={[
                  ...Array.from(new Set([...(data.tags || []), ...tempCreatedActiveTags])).map(t => ({ id: t, name: `#${t}` })),
                  ...Array.from(new Set([...(data.eventTags || []), ...tempCreatedEventTags])).map(t => ({ id: t, name: `#${t}`, subtext: 'Event Tag', group: 'Event Tags', showOnlyOnSearch: true }))
                ]}
                onChange={(val: string[]) => {
                  const cleaned = (val || []).filter(v => v !== 'all' && v !== '');
                  setNewTx(prev => ({ ...prev, tags: cleaned.length > 0 ? cleaned : [] }));
                }}
                placeholder="Select tags"
                noSelectionLabel="None"
              />
            )}
            <div className="flex align-center" style={{ marginTop: '0.5rem', gap: '0.35rem' }}>
              <input
                className="input-field"
                style={{ flex: 1, fontSize: '0.85rem', height: '42px', padding: '0 0.85rem' }}
                value={newTagInput}
                onChange={e => setNewTagInput(e.target.value)}
                placeholder={`Create ${newTagTargetType} tag`}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateTag(); } }}
              />
              <button
                type="button"
                className={`btn ${newTagTargetType === 'event' ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  width: '42px',
                  height: '42px',
                  padding: 0,
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                  flexShrink: 0,
                  borderRadius: '6px',
                  marginRight: '0.4rem'
                }}
                title={`Target: ${newTagTargetType === 'active' ? 'Active Tag' : 'Event Tag'}. Click to toggle.`}
                onClick={() => setNewTagTargetType(prev => prev === 'active' ? 'event' : 'active')}
              >
                {newTagTargetType === 'active' ? 'Active' : 'Event'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  width: '42px',
                  height: '42px',
                  padding: 0,
                  fontSize: '1.1rem',
                  fontWeight: 800,
                  flexShrink: 0,
                  borderRadius: '6px'
                }}
                onClick={handleCreateTag}
              >
                +
              </button>
            </div>
          </div>
        )}

        {(() => {
          const activeAcc = data.accounts.find(a => a.id === newTx.accountId);
          // A card that does not pay cashback has no business showing a Cashback Earned panel, let
          // alone a mode picker whose only real option reads "Default (0%)". The switch is off on the
          // account, so this block is not a thing the user can fill in — it is a thing they have to
          // scroll past on every spend.
          const isCard = cardEarnsCashback(activeAcc);
          const isBank = activeAcc?.type === 'bank_account';
          const isEWallet = activeAcc?.type === 'e_wallet';
          const showInstantUI = isBank || isEWallet;

          const isTransfer = newTx.category?.toLowerCase() === 'transfer';
          const isCCPayment = newTx.category?.toLowerCase() === 'cc payment';
          const isNcmcRecharge = newTx.category?.toLowerCase() === 'ncmc travel recharge';
          const isMf = activeInvestmentKind === 'mutual_funds';

          /* The category exclusions belong to ISSUER cashback only. A bank pays card cashback for
             spending on the card, never for moving money, so a transfer / bill payment / travel
             recharge / fund purchase earns nothing there — hence the block stays hidden for cards.
             INSTANT cashback is a different payer: the app that pushed the money (super.money,
             CRED, ...) rebates the payer whatever the money was for, and a discounted gift-card
             load is a transfer that very much does earn. Gating that on the category hid a real
             rebate behind a rule written for the other kind. */
          if (!showInstantUI && (isTransfer || isCCPayment || isNcmcRecharge || isMf)) return null;
          // Travel spends draw down an NCMC purse that was already loaded; nothing pays cashback
          // on the second hop. The recharge that funded it is a separate row and can still earn.
          if (newTx.isTravelTransaction) return null;

          if (!isCard && !showInstantUI) return null;
          // Cashback follows money going OUT. A credit is the receiving side of some other row.
          if (newTx.type !== 'debit') return null;
          // Instant cashback posts a real credit leg, so it needs somewhere to post it.
          if (showInstantUI && !hasCashbackDepositAccount) return null;

          return (
            <div className="flex-col gap-3" style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
              <div className="flex justify-between align-center">
                <span className="text-xs font-bold text-muted uppercase" style={{ letterSpacing: '1px' }}>Cashback Earned</span>
                {showInstantUI && (
                  <div className="flex align-center" style={{ gap: '1rem' }}>
                    <div className="flex" style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                      {(['amount', 'percent'] as const).map(mode => {
                        const active = (mode === 'percent') === cashbackPercentMode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            className="text-mono text-xs font-bold"
                            style={{
                              padding: '0.25rem 0.7rem',
                              minHeight: 'auto',
                              border: 'none',
                              cursor: 'pointer',
                              background: active ? 'var(--accent)' : 'transparent',
                              color: active ? '#ffffff' : 'var(--text-secondary)'
                            }}
                            onClick={() => {
                              const toPercent = mode === 'percent';
                              if (toPercent === cashbackPercentMode) return;
                              const amt = Number(newTx.amount) || 0;
                              const earned = Number(newTx.rewardEarned) || 0;
                              if (toPercent) {
                                // Back-compute the percent from the current ₹ value so the switch is lossless.
                                setCashbackPercentStr(amt > 0 && earned > 0 ? String(Math.round((earned / amt) * 100 * 100) / 100) : '');
                              } else {
                                // Reflect the computed ₹ value into the amount input.
                                setInputStrings(prev => ({ ...prev, rewardEarned: earned === 0 ? '' : String(earned) }));
                              }
                              setCashbackPercentMode(toPercent);
                            }}
                          >
                            {mode === 'percent' ? '%' : '₹'}
                          </button>
                        );
                      })}
                    </div>
                    <span className="text-mono text-xs text-success font-bold" style={{ display: 'flex', alignItems: 'center' }}>⚡ INSTANT</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {isCard ? (
                  <div className="col-span-2">
                    <CustomPicker
                      label="Cashback Mode"
                      value={selectedCashbackLevelId || 'none'}
                      options={[
                        { id: 'none', name: 'None' },
                        { 
                          id: 'default', 
                          name: (() => {
                            const unit = activeAcc?.rewardUnit || (activeAcc?.cashbackDestinationAccountId ? data.accounts.find(a => a.id === activeAcc.cashbackDestinationAccountId)?.rewardUnit : '');
                            return unit 
                              ? `Default (${activeAcc?.defaultCashbackRate || 0}% ${unit.toLowerCase()})`
                              : `Default (${activeAcc?.defaultCashbackRate || 0}%)`;
                          })()
                        },
                        ...(activeAcc?.cashbackRates || []).map(r => ({ 
                          id: r.id, 
                          name: (() => {
                            const unit = activeAcc?.rewardUnit || (activeAcc?.cashbackDestinationAccountId ? data.accounts.find(a => a.id === activeAcc.cashbackDestinationAccountId)?.rewardUnit : '');
                            return unit 
                              ? `${r.name} (${r.rate}% ${unit.toLowerCase()})`
                              : `${r.name} (${r.rate}%)`;
                          })()
                        }))
                      ]}
                      onChange={val => {
                        setSelectedCashbackLevelId(val === 'none' ? '' : val);
                        setNewTx({ ...newTx, rewardEarnedType: val === 'none' ? 'none' : 'delayed', rewardEarned: 0 });
                      }}
                      iconGetter={() => '✨'}
                    />
                  </div>
                ) : cashbackPercentMode ? (
                  <div className="flex-col gap-1">
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={`input-field ${errors.rewardEarned ? 'border-danger' : ''}`}
                        value={cashbackPercentStr}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            setCashbackPercentStr(val);
                            if (errors.rewardEarned) setErrors(prev => ({ ...prev, rewardEarned: '' }));
                          }
                        }}
                        placeholder="1.6"
                        style={{ width: '100%', paddingRight: '1.75rem' }}
                      />
                      <span className="text-muted text-mono font-bold" style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>%</span>
                    </div>
                    <span className="text-xs text-muted text-mono" style={{ opacity: 0.8 }}>
                      = {formatCurrency(Number(newTx.rewardEarned) || 0)}
                    </span>
                    {errors.rewardEarned && <span className="text-xs text-danger" style={{ marginTop: '0.1rem' }}>{errors.rewardEarned}</span>}
                  </div>
                ) : (
                  <div className="flex-col gap-1">
                    {/* The unit marker sits in the same spot in both modes — it tells you which unit
                        you are typing in, so it has to be findable at a glance when you flip the
                        toggle. Hence ₹ trailing here rather than leading, mirroring the % opposite. */}
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={`input-field ${errors.rewardEarned ? 'border-danger' : ''}`}
                        value={inputStrings.rewardEarned}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            setInputStrings(prev => ({ ...prev, rewardEarned: val }));
                            const numVal = parseFloat(val);
                            setNewTx({
                              ...newTx,
                              rewardEarned: isNaN(numVal) ? 0 : numVal,
                              rewardEarnedType: 'instant'
                            });
                            if (errors.rewardEarned && !isNaN(numVal) && numVal > 0) {
                              setErrors(prev => ({ ...prev, rewardEarned: '' }));
                            }
                          }
                        }}
                        placeholder="0.00"
                        style={{ width: '100%', paddingRight: '1.75rem' }}
                      />
                      <span className="text-muted text-mono font-bold" style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>₹</span>
                    </div>
                    {/* Mirror of the percent mode's "= ₹x" line: whichever unit you type, the other is
                        shown underneath. Rendered unconditionally, exactly as that one is — it reads
                        "= ₹0" with nothing filled in, so this must read "= 0%" rather than vanish, or
                        the panel gains and loses a row as you flip between the two modes. With no
                        amount yet there is nothing to take a percentage of, hence the 0 fallback
                        instead of a division by zero. */}
                    <span className="text-xs text-muted text-mono" style={{ opacity: 0.8 }}>
                      = {(Number(newTx.amount) || 0) > 0
                        ? Math.round(((Number(newTx.rewardEarned) || 0) / Number(newTx.amount)) * 100 * 100) / 100
                        : 0}%
                    </span>
                    {errors.rewardEarned && <span className="text-xs text-danger" style={{ marginTop: '0.1rem' }}>{errors.rewardEarned}</span>}
                  </div>
                )}

                {showInstantUI && (
                  <CustomPicker
                    label="Deposit To"
                    value={newTx.rewardEarnedAccountId || ''}
                    placeholder="Select Account"
                    options={[
                      { id: '', name: 'None (No Deposit Account)' },
                      ...[...data.accounts].sort(sortByAccountType).filter(a => (!a.archived || a.id === newTx.rewardEarnedAccountId) && (a.type === 'rewards' || a.type === 'e_wallet')).map(acc => ({
                        id: acc.id,
                        name: acc.archived ? `${acc.name} (deleted)` : acc.name,
                        subtext: acc.type.replace('_', ' '),
                        group: getAccountGroupLabel(acc.type, acc.archived)
                      }))
                    ]}
                    onChange={val => {
                      setNewTx({
                        ...newTx,
                        rewardEarnedAccountId: val,
                        rewardEarnedType: val ? 'instant' : 'none',
                        ...(!val && (Number(newTx.rewardEarned) || 0) <= 0 ? { rewardEarned: 0 } : {})
                      });
                      if (errors.rewardEarnedAccountId) setErrors(prev => ({ ...prev, rewardEarnedAccountId: '' }));
                      if (errors.rewardEarned) setErrors(prev => ({ ...prev, rewardEarned: '' }));
                    }}
                    iconGetter={id => getAccountIcon(id)}
                    error={errors.rewardEarnedAccountId}
                  />
                )}
                {isCard && (
                  <div className="col-span-2 flex align-center text-xs text-muted" style={{ opacity: 0.7 }}>
                    Will show in Cashback Vault for verification.
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Neither this button nor the panel below need the counterpart account picked yet:
            the reward split just reduces the total amount, and doesn't care which specific
            card/bank ends up on the other leg. */}
        {!showRewardSplit && canSplitWithRewards && (
          <button
            className="btn btn-secondary w-100 flex align-center justify-center"
            /* The gap is INLINE, and has to be. `.btn` sets `gap: 0.5rem` of its own and is declared
               after every `.gap-*` utility in the sheet, so at equal specificity it wins — the
               `gap-2` that used to sit in this className was doing nothing at all, and swapping it
               for gap-3 changed nothing either (measured: 8px both ways).
               0.75rem because the label is uppercase mono with 1px of letter-spacing, so its glyphs
               carry their own air and the icon needs a little more than the default to sit apart
               from them. */
            style={{ marginBottom: '1rem', padding: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', gap: '0.75rem' }}
            onClick={() => {
              setShowRewardSplit(true);
              // The panel IS its cards, so opening it means opening one — empty, ready for a source.
              setSplits(prev => (prev.length > 0 ? prev : [blankSplit()]));
              setActiveSplit(0);
              setTimeout(() => {
                rewardSplitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
            }}
          >
            <Sparkles size={14} className="text-primary" />
            <span>Split Payment</span>
          </button>
        )}

        {showRewardSplit && canSplitWithRewards && (
          <div
            ref={rewardSplitRef}
            style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px' }}
          >
            {/* The header's controls act on the card ON SCREEN — only one is visible at a time, and
                the unit toggle in particular belongs to that card's source (Jewels beside CRED coins
                is two different units on one split). */}
            <div className="flex justify-between align-center" style={{ marginBottom: '0.85rem' }}>
              <span className="text-xs font-bold text-muted uppercase" style={{ letterSpacing: '1px' }}>
                Split Payment
              </span>
              <div className="flex align-center" style={{ gap: '0.6rem' }}>
                {/* Only a points account has two units to switch between. 'PTS' rather than the
                    account's own unit name because that name is free text with no length limit
                    ("Reward Points" would not fit), and rather than a glyph because none of the
                    bundled font subsets carry one — a diamond or star would fall back to a system
                    font and sit at a different size than the ₹ beside it. */}
                {!!splits[activeSplit] && isUnitDenominated(sourceAccountOf(splits[activeSplit])) && (
                  <div className="flex" style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', height: SPLIT_CONTROL_HEIGHT, boxSizing: 'border-box' }}>
                    {(['rupee', 'points'] as const).map(mode => {
                      const card = splits[activeSplit];
                      const active = mode === unitOf(card);
                      return (
                        <button
                          key={mode}
                          type="button"
                          className="text-mono text-xs font-bold"
                          style={{
                            padding: '0 0.7rem',
                            height: '100%',
                            minHeight: 'auto',
                            border: 'none',
                            cursor: 'pointer',
                            background: active ? 'var(--accent)' : 'transparent',
                            color: active ? '#ffffff' : 'var(--text-secondary)'
                          }}
                          onClick={() => {
                            if (active) return;
                            // Lossless switch: the rupee value is canonical, so re-render the field
                            // from it in the new unit rather than reinterpreting the typed digits.
                            const shown = mode === 'points'
                              ? rupeesToRewardPoints(card.amount, sourceAccountOf(card))
                              : card.amount;
                            patchSplit(activeSplit, { unit: mode, input: shown === 0 ? '' : String(shown) });
                          }}
                        >
                          {mode === 'points' ? 'PTS' : '₹'}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* One more source, once the LAST card is actually funding something — see
                    canAddSplitSource for why it belongs to that card alone. Sits left of the remove
                    button, and is gone when every eligible source is already spoken for: the same
                    account twice would produce two legs nothing could tell apart. */}
                {canAddSplitSource && (
                  <button
                    className="btn btn-secondary flex-center"
                    title="Add another payment source"
                    aria-label="Add another payment source"
                    style={{
                      width: SPLIT_CONTROL_HEIGHT,
                      height: SPLIT_CONTROL_HEIGHT,
                      padding: 0,
                      minHeight: 'auto',
                      boxSizing: 'border-box',
                      boxShadow: '2px 2px 0 #000'
                    }}
                    onClick={addSplitSource}
                  >
                    <Plus size={14} strokeWidth={3} />
                  </button>
                )}
                <button
                  className="btn btn-danger flex-center"
                  title={splits.length > 1 ? 'Remove this source' : 'Remove split'}
                  aria-label={splits.length > 1 ? 'Remove this source' : 'Remove split'}
                  style={{
                    width: SPLIT_CONTROL_HEIGHT,
                    height: SPLIT_CONTROL_HEIGHT,
                    padding: 0,
                    minHeight: 'auto',
                    boxSizing: 'border-box',
                    boxShadow: '2px 2px 0 #000'
                  }}
                  onClick={() => {
                    if (splits.length > 1) {
                      removeSplitSource(activeSplit);
                      return;
                    }
                    setShowRewardSplit(false);
                    setSplits([]);
                    setActiveSplit(0);
                    clearSplitErrors();
                  }}
                >
                  <X size={14} strokeWidth={3} />
                </button>
              </div>
            </div>

            {/* One card per source, side by side on a snapping scroller: swipe, or tap a dot. Each
                card is exactly the panel's width, so the geometry is what pages it — no transform
                bookkeeping, and the drag keeps the platform's own feel. */}
            <div
              ref={splitScrollRef}
              className="split-carousel no-scrollbar"
              onScroll={e => {
                const el = e.currentTarget;
                // Mid-flight frames of a scroll WE started say nothing about which card the user
                // wants — reading them turns the effect above into a tug of war.
                const target = splitScrollTargetRef.current;
                if (target !== null) {
                  if (Math.abs(el.scrollLeft - target) < 4) splitScrollTargetRef.current = null;
                  return;
                }
                const page = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
                if (page !== activeSplit && page >= 0 && page < splits.length) setActiveSplit(page);
              }}
            >
              {splits.map((split, i) => {
                const unit = unitOf(split);
                const amountError = errors[`rewardUsed_${i}`];
                return (
                  <div
                    key={i}
                    className="split-card grid grid-cols-2 gap-4"
                  >
                    <div className="input-group">
                      {/* "Amount", not "Rewards Used": the panel is reached from a button that says
                          Split Payment and pairs this field with "Paid from", so naming the
                          money after one particular KIND of source contradicted both — and does so
                          on every split funded from an e-wallet.
                          No "(Optional)" either. It described the panel, not the field: the split as
                          a whole is optional, but you get here by asking for one, and the card has an
                          X to close if you change your mind. Inside an open card the amount is
                          required the moment a source is picked (see validate). */}
                      <label>Amount{unit === 'points' ? ` (${rewardUnitLabelOf(split)})` : ''}</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={`input-field ${amountError ? 'border-danger' : ''}`}
                        value={split.input}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            const numVal = parseFloat(val);
                            // Store rupees, always — utils' balance math and FinanceContext's leg
                            // rebalance both treat a split's amount as money. The points figure is
                            // derived, for display and on save.
                            patchSplit(i, { input: val, amount: isNaN(numVal) ? 0 : inputToRupeesFor(split, numVal) });
                          }
                        }}
                        placeholder={unit === 'points' ? '0' : '0.00'}
                      />
                      {/* The counterpart value, same treatment as the instant-cashback percent hint.
                          The empty twin holds the line's space open on a card that has no counterpart
                          to show, so every card in the panel puts its picker at the same height. */}
                      {counterpartHintFor(split) !== null ? (
                        <span className="text-xs text-muted text-mono" style={{ marginTop: '0.25rem', opacity: 0.8 }}>
                          {counterpartHintFor(split)}
                        </span>
                      ) : anySplitShowsHint && (
                        <span aria-hidden className="text-xs text-mono" style={{ marginTop: '0.25rem', visibility: 'hidden' }}>
                          &nbsp;
                        </span>
                      )}
                      {amountError && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{amountError}</span>}
                    </div>
                    <CustomPicker
                      label={splits.length > 1 ? `Paid from ${i + 1}` : 'Paid from'}
                      value={split.accountId}
                      placeholder="Select Account"
                      /* No "None" entry, unlike Deposit To above. That card has no dismiss control,
                         so its picker has to carry the way out; this one opens from a button and
                         closes on its own X, which drops the card and everything typed into it. A
                         "None" here would be a second, weaker way to undo — it clears the source but
                         leaves the amount and the open card behind. Nothing selected shows the
                         placeholder, which is the same empty state without the dead end. */
                      options={[
                        ...[...availableSourcesFor(i)].sort(sortByAccountType).map(acc => ({
                          id: acc.id,
                          name: acc.archived ? `${acc.name} (deleted)` : acc.name,
                          // Headed by account type, the way Deposit To already does it. The list is
                          // a mix of kinds now that e-wallets are eligible — a wallet, a rewards
                          // wallet and the charged card's own points ledger read as one undivided
                          // run without this, and they are not the same kind of money.
                          group: getAccountGroupLabel(acc.type, acc.archived),
                          // In whatever the account counts in. This used to ask `rewardType ===
                          // 'points'` directly, which is only ever set on a CARD — so a wallet
                          // holding 500 Chips was announced as ₹500 while the Accounts screen called
                          // the same figure 500 CHIPS.
                          subtext: formatRewardBalance(
                            acc,
                            rewardUnitBalance(acc, data.transactions, getCurrentMonthStr(), data.cashbackStatements),
                          ),
                        })),
                        // Last, as the catch-all it is: a coupon or voucher with no account to draw
                        // from. No balance line — there is nothing to run out of, which is the whole
                        // point of it. Offered once per split: a second untracked reward is
                        // indistinguishable from the first, so it would only be the same entry twice.
                        ...(externalTakenElsewhere(i)
                          ? []
                          // Headed separately, and not by an account type, because it ISN'T one: the
                          // sentinel matches no account, so nothing moves. Left ungrouped it would
                          // tuck itself under whichever real group happened to be last and read as
                          // one of them.
                          : [{ id: EXTERNAL_REWARD_SOURCE_ID, name: 'Other', subtext: 'One-time reward, not tracked', group: 'No Account' }])
                      ]}
                      onChange={val => {
                        // Accounts can differ in unit and rate, so the typed digits would change
                        // meaning on a switch. Hold the rupee value steady and re-render the field for
                        // the new account: 430 Jewels (₹86) picked over to a rupee wallet shows 86,
                        // still ₹86.
                        const nextAcc = data.accounts.find(a => a.id === val);
                        const nextUnit = isUnitDenominated(nextAcc) ? split.unit : 'rupee';
                        const shown = nextUnit === 'points' ? rupeesToRewardPoints(split.amount, nextAcc) : split.amount;
                        patchSplit(i, {
                          accountId: val,
                          input: shown === 0 ? '' : String(shown),
                          ...(!val && split.amount <= 0 ? { amount: 0 } : {})
                        });
                      }}
                      // "None" stands in for a reward source, so it wears one's mark rather than the
                      // no-such-account fallback wallet — every other row here is a Gift.
                      iconGetter={id => (id === '' ? getAccountTypeIcon('rewards', 18) : getAccountIcon(id))}
                      error={errors[`rewardSource_${i}`]}
                    />
                  </div>
                );
              })}
            </div>

            {/* Which card of how many, and a way back to any of them. Only earns its space once
                there is more than one source to page between. */}
            {splits.length > 1 && (
              <div className="split-dots">
                {splits.map((split, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Reward source ${i + 1}${split.accountId ? `: ${sourceAccountOf(split)?.name || 'One-time reward'}` : ''}`}
                    aria-current={i === activeSplit}
                    className={`split-dot${i === activeSplit ? ' split-dot--active' : ''}${(errors[`rewardUsed_${i}`] || errors[`rewardSource_${i}`]) ? ' split-dot--error' : ''}`}
                    onClick={() => setActiveSplit(i)}
                  />
                ))}
              </div>
            )}

            <div className="text-xs text-muted" style={{ opacity: 0.7, marginTop: '0.5rem' }}>
              Primary Account Debit: <strong>{formatCurrency(Math.max(0, (Number(newTx.amount) || 0) - rewardTotal))}</strong>
              {splits.filter(sp => !!sp.accountId).length > 1 && (
                <>
                  {' · '}
                  <strong>{formatCurrency(rewardTotal)}</strong>
                  {` from ${splits.filter(sp => !!sp.accountId).length} reward sources`}
                </>
              )}
            </div>
          </div>
        )}

        {/* CC Payment always ends up with a credit_card leg somewhere, and these two options
            (previous statement / current cycle) aren't specific to which card it is — so this
            doesn't need to wait for either account to actually be picked. */}
        {isCCPayment && (
            <div style={{ marginTop: '1rem' }}>
              <CustomPicker
                label="Apply Payment To"
                value={ccPaymentCycleTarget}
                options={[
                  { id: 'previous_statement', name: 'Previous Statement', subtext: 'Reduce Already Billed Dues' },
                  { id: 'current_cycle', name: 'Current Open Cycle', subtext: 'Count as an Early Payment for the Active Cycle' }
                ]}
                onChange={val => setCcPaymentCycleTarget(val as 'current_cycle' | 'previous_statement')}
                iconGetter={id => id === 'current_cycle' ? '🟦' : '🧾'}
              />
            </div>
          )}

        {/* Tags kept last so it stays at the end of the form across all scenarios (e.g. after
            the CC-payment "Apply Payment To" picker). */}
        {!data.accounts.find(a => a.id === newTx.accountId)?.isNcmcEnabled && (
          <div className="input-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Hash size={13} style={{ opacity: 0.6 }} />Tags <span className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 400 }}>(optional)</span>
            </label>
            {((data.tags || []).length > 0 || (data.eventTags || []).length > 0 || tempCreatedActiveTags.length > 0 || tempCreatedEventTags.length > 0) && (
              <CustomPicker
                label="Tags"
                hideLabel={true}
                value={newTx.tags || []}
                isMulti={true}
                enableSearch={true}
                searchPlaceholder="Search active & event tags..."
                options={[
                  ...Array.from(new Set([...(data.tags || []), ...tempCreatedActiveTags])).map(t => ({ id: t, name: `#${t}` })),
                  ...Array.from(new Set([...(data.eventTags || []), ...tempCreatedEventTags])).map(t => ({ id: t, name: `#${t}`, subtext: 'Event Tag', group: 'Event Tags', showOnlyOnSearch: true }))
                ]}
                onChange={(val: string[]) => {
                  const cleaned = (val || []).filter(v => v !== 'all' && v !== '');
                  setNewTx(prev => ({ ...prev, tags: cleaned.length > 0 ? cleaned : [] }));
                }}
                placeholder="Select tags"
                noSelectionLabel="None"
              />
            )}
            <div className="flex align-center" style={{ marginTop: '0.5rem', gap: '0.35rem' }}>
              <input
                className="input-field"
                style={{ flex: 1, fontSize: '0.85rem', height: '42px', padding: '0 0.85rem' }}
                value={newTagInput}
                onChange={e => setNewTagInput(e.target.value)}
                placeholder={`Create ${newTagTargetType} tag`}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateTag(); } }}
              />
              <button
                type="button"
                className={`btn ${newTagTargetType === 'event' ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  width: '42px',
                  height: '42px',
                  padding: 0,
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                  flexShrink: 0,
                  borderRadius: '6px',
                  marginRight: '0.4rem'
                }}
                title={`Target: ${newTagTargetType === 'active' ? 'Active Tag' : 'Event Tag'}. Click to toggle.`}
                onClick={() => setNewTagTargetType(prev => prev === 'active' ? 'event' : 'active')}
              >
                {newTagTargetType === 'active' ? 'Active' : 'Event'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  width: '42px',
                  height: '42px',
                  padding: 0,
                  fontSize: '1.1rem',
                  fontWeight: 800,
                  flexShrink: 0,
                  borderRadius: '6px'
                }}
                onClick={handleCreateTag}
              >
                +
              </button>
            </div>
          </div>
        )}



        {data.user?.enablePassiveTransactions && newTx.category?.toLowerCase() !== 'transfer' && newTx.category?.toLowerCase() !== 'cc payment' && newTx.category?.toLowerCase() !== 'ncmc travel recharge' && newTx.category?.toLowerCase() !== 'lending & borrowing' && (
          <div ref={passiveLogRef} className="flex-col gap-3" style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-hover)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div className="flex justify-between align-center">
              <div className="flex-col">
                <span className="text-xs font-bold text-muted uppercase" style={{ letterSpacing: '1px' }}>Passive Transaction</span>
                <span className="text-xs text-muted" style={{ fontSize: '0.65rem' }}>Exclude from Spends & Income stats</span>
              </div>
              <button
                className={`btn ${newTx.excludeFromStats ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.4rem 0.8rem', borderRadius: '8px', fontSize: '0.75rem' }}
                onClick={() => {
                  const isExpanding = !newTx.excludeFromStats;
                  // The full price: turning this on means the whole purchase was passive, rewards
                  // included. handleSave decides how much of it each row carries.
                  const amountToExclude = isExpanding ? passiveCeiling : undefined;
                  const updatedTx = {
                    ...newTx,
                    excludeFromStats: isExpanding,
                    excludedAmount: amountToExclude
                  };
                  setNewTx(updatedTx);
                  setInputStrings(prev => ({
                    ...prev,
                    excludedAmount: isExpanding ? (amountToExclude?.toString() || '') : '',
                    activeShare: ''
                  }));
                  if (errors.excludedAmount) setErrors(prev => ({ ...prev, excludedAmount: '' }));
                  if (isExpanding) {
                    setTimeout(() => {
                      passiveLogRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                  }
                }}
              >
                {newTx.excludeFromStats ? 'Excluded' : 'Included'}
              </button>
            </div>
            {newTx.excludeFromStats && (
              <div className="flex-col gap-2 pt-2" style={{ borderTop: '1px dashed var(--border-color)', marginTop: '0.5rem' }}>
                <span className="text-xs text-muted" style={{ fontSize: '0.65rem' }}>Fill in whichever you know — the other is calculated for you.</span>
                <div className="flex gap-3">
                  <div className="flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
                    <span className="text-xs text-muted">Excluded Amount</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={`input-field ${errors.excludedAmount ? 'border-danger' : ''}`}
                      style={{ height: '38px', fontSize: '0.9rem' }}
                      value={inputStrings.excludedAmount}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === '' || /^\d*\.?\d*$/.test(val)) {
                          const numVal = parseFloat(val);
                          const excluded = val === '' ? undefined : (isNaN(numVal) ? 0 : numVal);
                          // Excluded typed → derive the active share (clamped to the total).
                          const share = Math.max(0, (newTx.amount || 0) - (excluded || 0));
                          setInputStrings(prev => ({
                            ...prev,
                            excludedAmount: val,
                            activeShare: val === '' ? '' : parseFloat(share.toFixed(2)).toString()
                          }));
                          setNewTx({ ...newTx, excludedAmount: excluded });
                          if (errors.excludedAmount) setErrors(prev => ({ ...prev, excludedAmount: '' }));
                        }
                      }}
                      placeholder="e.g. 15915"
                    />
                  </div>
                  <div className="flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
                    <span className="text-xs font-bold text-accent">Active Share</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input-field"
                      style={{ height: '38px', fontSize: '0.9rem' }}
                      value={inputStrings.activeShare}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === '' || /^\d*\.?\d*$/.test(val)) {
                          const numVal = parseFloat(val);
                          const share = val === '' ? undefined : (isNaN(numVal) ? 0 : numVal);
                          // Active share typed → back out the excluded amount, against what this row
                          // stores rather than the full price, so excluded + active always reconcile.
                          const excluded = Math.max(0, passiveCeiling - (share || 0));
                          setInputStrings(prev => ({
                            ...prev,
                            activeShare: val,
                            excludedAmount: val === '' ? '' : parseFloat(excluded.toFixed(2)).toString()
                          }));
                          setNewTx({ ...newTx, excludedAmount: val === '' ? undefined : parseFloat(excluded.toFixed(2)) });
                          if (errors.excludedAmount) setErrors(prev => ({ ...prev, excludedAmount: '' }));
                        }
                      }}
                      placeholder="e.g. 1832.2"
                    />
                  </div>
                </div>
                {errors.excludedAmount && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.excludedAmount}</span>}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        {sms?.processing && (
          <button type="button" className="btn btn-danger" onClick={() => { sms.onDiscard(); onClose(); }} style={{ marginLeft: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
            Discard SMS
          </button>
        )}
        <button className="btn btn-primary" onClick={handleSave}>{editId ? 'Update' : 'Save'}</button>
      </div>
    </div>
  </div>
  );
};
