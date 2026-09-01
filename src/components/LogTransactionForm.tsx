import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '../FinanceContext';
import type { Transaction, TransactionType, InvestmentKind } from '../types';
import { generateId, formatCurrency, getBillingCycleForDate, calculateBalance, getCurrentMonthStr, isInvestmentCategory, INVESTMENT_CATEGORY, INVESTMENT_KIND_OPTIONS, investmentKindLabel, investmentAccountTypeFor, getInvestmentKind, isPointsDenominated, rewardPointsToRupees, rupeesToRewardPoints, advanceBillCycle, cardEarnsCashback } from '../utils';
import { Wallet, Calendar, Activity, Sparkles, Hash, BanknoteArrowUp, BanknoteArrowDown, X } from 'lucide-react';
import { CustomPicker } from './CustomPicker';
import CustomDatePicker from './CustomDatePicker';
import { getCategoryIcon, getAccountTypeIcon, getAccountGroupLabel, getInvestmentKindIcon, sortByAccountType } from './transactionIcons';
import { scrollToFirstError } from '../utils/formErrors';

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
  /** Ledger-only SMS queue integration. Omitted (Bills) means the form never touches the queue. */
  sms?: { processing: boolean; onDiscard: () => void };
  onSuccess?: () => void;
}

// The unit toggle and the remove button sit side by side in the split panel's header, so their
// height comes from one place — eyeballed padding on each drifted by a pixel or two.
const SPLIT_CONTROL_HEIGHT = '28px';

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
  rewardUsed: (tx.rewardUsed === 0 || tx.rewardUsed === undefined) ? '' : tx.rewardUsed.toString(),
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
  // Which unit the "Rewards Used" field is typed in. Defaults to points: redeeming from a card's
  // own balance is something you do in that card's own units ("I spent 430 Jewels"), and the rupee
  // value is the derived quantity. newTx.rewardUsed always holds the RUPEE value regardless, since
  // that is what every consumer of the field does arithmetic with.
  const [rewardUnitMode, setRewardUnitMode] = useState<'points' | 'rupee'>('points');
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
  const committedRewardRef = useRef<{ rupees: number; accountId: string }>({ rupees: 0, accountId: '' });
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
    const rewardSplitAnchor = linkedTxs.find(t => t.category?.toLowerCase() === 'cc payment' && (t.rewardUsed || 0) > 0 && !!t.rewardUsedAccountId);
    const isSplitAnchor = tx.category?.toLowerCase() === 'cc payment' && (tx.rewardUsed || 0) > 0 && !!tx.rewardUsedAccountId;
    const isSplitRewardLeg = !!rewardSplitAnchor && rewardSplitAnchor.rewardUsedAccountId === tx.accountId;
    const isSplitBankLeg = !!rewardSplitAnchor && !isSplitRewardLeg && !isSplitAnchor;

    if (isSplitBankLeg && rewardSplitAnchor) {
      sanitizedTx.amount = rewardSplitAnchor.amount;               // show the full bill (192), not the stored portion (148)
      sanitizedTx.rewardUsed = rewardSplitAnchor.rewardUsed;       // 44
      sanitizedTx.rewardUsedAccountId = rewardSplitAnchor.rewardUsedAccountId;
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
      && (tx.rewardUsed || 0) > 0
      && !!tx.rewardUsedAccountId;
    if (isPlainSplitAnchor) {
      sanitizedTx.amount = (tx.amount || 0) + (tx.rewardUsed || 0);
      // The exclusion is stored per row for the same reason the amount is, so reassemble it too:
      // the field means "how much of this purchase was passive", and the reward leg holds whatever
      // part of that the anchor could not absorb. Without this a ₹448 purchase excluded in full
      // reopens reading 362 and re-saving quietly un-excludes the reward leg.
      if (sanitizedTx.excludeFromStats && sanitizedTx.excludedAmount !== undefined) {
        const leg = linkedTxs.find(t => t.accountId === tx.rewardUsedAccountId);
        sanitizedTx.excludedAmount += leg?.excludedAmount || 0;
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

    const isRewardChild = linkedTxs.some(p => p.rewardUsedAccountId && p.rewardUsedAccountId === tx.accountId);
    let paySrc = '';
    if ((isSplitBankLeg || isSplitRewardLeg) && rewardSplitAnchor) {
      paySrc = rewardSplitAnchor.accountId; // the card being paid
    } else if (!isRewardChild && !isCashbackChild) {
      const counterpartTx = linkedTxs.find(t => t.category !== 'Cashback' && t.accountId !== tx.rewardUsedAccountId);
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
    setShowRewardSplit(isSplitBankLeg || (tx.rewardUsed || 0) > 0);
    setNewTx(sanitizedTx);
    syncInputStrings(sanitizedTx);
    // rewardUsed is stored in rupees, but the field defaults to the points unit — so re-render it in
    // points when the source is a card's own balance, or the form would show ₹86 under a "(Jewels)"
    // label. buildInputStrings can't do this itself: it has no view of which account was used.
    committedRewardRef.current = {
      rupees: Number(sanitizedTx.rewardUsed) || 0,
      accountId: sanitizedTx.rewardUsedAccountId || ''
    };
    const seedRewardSrc = data.accounts.find(a => a.id === sanitizedTx.rewardUsedAccountId);
    if (isPointsDenominated(seedRewardSrc) && (sanitizedTx.rewardUsed || 0) > 0) {
      const pts = rupeesToRewardPoints(sanitizedTx.rewardUsed || 0, seedRewardSrc);
      setInputStrings(prev => ({ ...prev, rewardUsed: String(pts) }));
    }
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
    const t = window.setTimeout(() => {
      rewardSplitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(t);
  }, [focusSplit]);

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
      ...(categoryOrKindChanged ? { rewardUsed: 0, rewardUsedAccountId: '' } : {})
    });
    setInputStrings(s => ({
      ...s,
      allottedAmount: (nextAllotted === undefined || nextAllotted === 0) ? '' : nextAllotted.toString(),
      investmentCharges: (nextCharges === undefined || nextCharges === 0) ? '' : nextCharges.toString(),
      numberOfShares: nextShares === undefined ? '' : nextShares.toString(),
      ...(categoryOrKindChanged ? { rewardUsed: '' } : {})
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
    if (showRewardSplit && (Number(newTx.rewardUsed) || 0) > 0 && !newTx.rewardUsedAccountId) {
      newErrors.rewardUsedAccountId = 'Reward account is required';
    }
    if (showRewardSplit && newTx.rewardUsedAccountId && (Number(newTx.rewardUsed) || 0) <= 0) {
      newErrors.rewardUsed = 'Reward amount is required when reward account is selected';
    }
    // Can't redeem more than the account holds. Compared in the account's own unit, and the message
    // names the figure because the collapsed picker shows only the account name.
    if (showRewardSplit && newTx.rewardUsedAccountId && rewardRupees > 0) {
      // On an edit, this split's own existing leg has already been taken out of the balance — hand it
      // back before comparing, or re-saving (or even lowering) an untouched redemption would fail.
      // Only when the source account is unchanged: money spent from the old account is no help
      // against a different one's balance.
      const reusable = committedRewardRef.current.accountId === newTx.rewardUsedAccountId
        ? committedRewardRef.current.rupees
        : 0;
      const available = rewardBalance + (isPointsSource ? rupeesToRewardPoints(reusable, rewardSourceAcc) : reusable);
      const needed = isPointsSource ? rewardPoints : rewardRupees;
      if (needed - available > 0.001) {
        newErrors.rewardUsed = `Only ${formatRewardBalance(available)} available`;
      }
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
    const willCreateRewardLeg = showRewardSplit && (Number(newTx.rewardUsed) || 0) > 0 && !!newTx.rewardUsedAccountId && !editId;
    const rewardCounterpartId = willCreateRewardLeg ? generateId() : null;
    // Anchoring, by contrast, IS CC-specific: a reward split anchors on the CARD leg (whose amount is
    // the full bill), per docs/LINKED_TRANSACTIONS.md. Logged from Credit POV the card IS the main tx,
    // so it holds the anchor (rewardUsed + the reward leg) naturally. Logged from Debit POV the card is
    // the counterpart, so we move the anchor onto it and keep the bank main tx as a plain funding
    // child. Without this the anchor would sit on the bank leg (partial amount ₹148) and both
    // openEditModal reconstruction and updateTransaction's Option-B rebalance would use the wrong total.
    const isCcRewardSplit = isCCPayment && willCreateRewardLeg;
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

      const rewardUsedForTransfer = showRewardSplit ? (Number(newTx.rewardUsed) || 0) : 0;
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
        linkedTransactionIds: isCardAnchorLeg ? [mainTxId, rewardCounterpartId as string] : [mainTxId],
        rewardUsed: isCardAnchorLeg ? rewardUsedForTransfer : undefined,
        rewardUsedAccountId: isCardAnchorLeg ? newTx.rewardUsedAccountId : undefined,
        appliedBillingCycleYearMonth: isCCPayment && counterpartType === 'credit' && destAccount?.type === 'credit_card'
          ? resolveCcPaymentCycle(newTx.date as string, destAccount.statementDay)
          : undefined
      });

      if (isCCPayment && newTx.type === 'credit') finalCategory = 'CC Payment';
    }

    const rewardUsed = showRewardSplit ? (Number(newTx.rewardUsed) || 0) : 0;
    if (rewardUsed > 0 && newTx.rewardUsedAccountId && !editId) {
      const rewardLegId = rewardCounterpartId as string;
      // Debit POV: link the reward leg to the card anchor and keep it OFF the bank main tx's link list
      // (the card is the hub). Credit POV: the main tx IS the card, so link to it as before.
      if (!anchorOnCounterpart) currentLinkedIds.push(rewardLegId);
      const rewardsSourceAcc = data.accounts.find(a => a.id === newTx.rewardUsedAccountId);
      const isInternalPoints = isPointsDenominated(rewardsSourceAcc);
      // The rewards pay down the CARD's bill, not the funding bank. The card is the main account
      // when logged as a Credit (Receive), or the paymentSourceAccountId ("Pay To Card") when logged
      // as a Debit (Spend) — mirror the targetCardName logic used for the bank leg above.
      const paidCardName = (newTx.type === 'credit' ? account : data.accounts.find(a => a.id === paymentSourceAccountId))?.name;
      addTransaction({
        id: rewardLegId,
        date: newTx.date as string,
        description: isCCPayment ? `Rewards used for ${paidCardName || account?.name || 'CC'}` : `Rewards applied to: ${newTx.description}`,
        accountId: newTx.rewardUsedAccountId,
        type: 'debit',
        // Rupees, like every other amount in the ledger — a points figure here would be summed as
        // money by the day totals and spend stats. calculateBalance applies the rate when it reads
        // this leg into the points balance. See docs/LINKED_TRANSACTIONS.md.
        amount: rewardUsed,
        category: isCCPayment ? 'CC Payment' : (newTx.category as string),
        isRecurring: false,
        isRewardTransaction: isInternalPoints,
        linkedTransactionIds: [(anchorOnCounterpart && cardAnchorId) ? cardAnchorId : mainTxId]
      });
    }

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
    const rewardLegExcluded = passiveOn
      ? Math.min(rewardUsed, Math.max(0, totalExcluded - mainAccountAmount))
      : 0;

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
      // Debit POV split: the anchor (rewardUsed) lives on the card counterpart, not this bank main tx.
      rewardUsed: anchorOnCounterpart ? 0 : rewardUsed,
      rewardUsedAccountId: anchorOnCounterpart ? undefined : newTx.rewardUsedAccountId,
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
    const rewardLegId = rewardCounterpartId
      ?? (editId && newTx.rewardUsedAccountId
        ? (data.transactions.find(t => currentLinkedIds.includes(t.id) && t.accountId === newTx.rewardUsedAccountId)?.id ?? null)
        : null);
    if (rewardLegId) {
      setRewardLegExclusion(rewardLegId, rewardLegExcluded > 0 ? rewardLegExcluded : undefined);
    }

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
        const rewardUsedForTransfer = showRewardSplit ? (Number(newTx.rewardUsed) || 0) : 0;
        const bankPortion = Number(newTx.amount) - rewardUsedForTransfer;
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
  // Which accounts can fund a reward split. A card's own points balance (e.g. Jupiter's Jewels)
  // only offsets THAT card's own bill — issuer points aren't fungible across cards — so the
  // points option is tied to the CARD leg of this log: on a CC Payment that's whichever side
  // holds the card (Account when logged as a Credit, the counterpart when logged as a Debit);
  // on a plain purchase it's the account being charged. Plain 'rewards' wallets (CRED coins,
  // super.money) are already rupee-denominated, so they stay universal.
  const cardLegAccountId = isCCPayment
    ? (newTx.type === 'credit' ? newTx.accountId : paymentSourceAccountId)
    : newTx.accountId;
  const splitSourceAccounts = data.accounts.filter(a =>
    (!a.archived || a.id === newTx.rewardUsedAccountId)
    && (a.type === 'rewards' || (a.isCashbackEnabled && a.rewardType === 'points' && !!cardLegAccountId && a.id === cardLegAccountId))
  );
  // Investments are excluded: paying part of a fund/stock/metal buy out of reward points isn't a
  // thing the holdings math models. Everything else that spends money can be split — a CC Payment
  // from either POV, or any ordinary debit. Gated on there actually being a source to spend from,
  // so the button never opens a panel whose picker has nothing in it.
  //
  // Keyed off the CATEGORY, not activeInvestmentKind: the kind is still unset in the window between
  // picking "Investments" and picking the type below it, and the split must already be gone by then
  // — otherwise it shows, gets filled in, and is then silently dropped when the kind lands.
  const canSplitWithRewards = !isInvestmentCategory(newTx.category)
    && (isCCPayment || newTx.type === 'debit')
    && splitSourceAccounts.length > 0;

  // The chosen reward source decides whether points apply at all: a card's own balance is counted in
  // its own unit, a plain rupee wallet (CRED coins, super.money) is already money. With no account
  // picked yet there's no rate to convert with, so the field stays plain rupees.
  const rewardSourceAcc = data.accounts.find(a => a.id === newTx.rewardUsedAccountId);
  const isPointsSource = isPointsDenominated(rewardSourceAcc);
  const rewardUnitLabel = rewardSourceAcc?.rewardUnit || 'Points';
  // A rupee wallet has nothing to toggle, so it stays pinned to rupees whatever the mode last was.
  const activeRewardUnit: 'points' | 'rupee' = isPointsSource ? rewardUnitMode : 'rupee';
  const rewardRupees = Number(newTx.rewardUsed) || 0;
  const rewardPoints = rupeesToRewardPoints(rewardRupees, rewardSourceAcc);
  // The balance the picker shows for this account. Reused by the shortfall message, which has to
  // name the figure itself: the collapsed trigger deliberately shows only the account name.
  const rewardBalance = rewardSourceAcc
    ? calculateBalance(rewardSourceAcc, data.transactions, getCurrentMonthStr(), false, isPointsSource, data.cashbackStatements)
    : 0;
  const formatRewardBalance = (v: number) => isPointsSource ? `${v} ${rewardUnitLabel}` : formatCurrency(v);
  // Typed value -> canonical rupees. Points divide by the rate; rupees pass straight through.
  const rewardInputToRupees = (n: number) =>
    activeRewardUnit === 'points' ? rewardPointsToRupees(n, rewardSourceAcc) : n;

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
          <div className="input-group" style={{ marginBottom: 0 }}>
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
            <div className="flex-col gap-3" style={{ marginTop: '0.5rem', marginBottom: '1rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
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
            className="btn btn-secondary w-100 flex align-center justify-center gap-2"
            style={{ marginBottom: '1rem', padding: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}
            onClick={() => {
              setShowRewardSplit(true);
              setTimeout(() => {
                rewardSplitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
            }}
          >
            <Sparkles size={14} className="text-primary" />
            <span>Split with Rewards?</span>
          </button>
        )}

        {showRewardSplit && canSplitWithRewards && (
          <div
            ref={rewardSplitRef}
            className="grid grid-cols-2 gap-4"
            style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px' }}
          >
            <div className="flex justify-between align-center col-span-2">
              <span className="text-xs font-bold text-muted uppercase" style={{ letterSpacing: '1px' }}>Split Payment</span>
              <div className="flex align-center" style={{ gap: '0.6rem' }}>
                {/* Only a points account has two units to switch between. 'PTS' rather than the
                    account's own unit name because that name is free text with no length limit
                    ("Reward Points" would not fit), and rather than a glyph because none of the
                    bundled font subsets carry one — a diamond or star would fall back to a system
                    font and sit at a different size than the ₹ beside it. */}
                {isPointsSource && (
                  <div className="flex" style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', height: SPLIT_CONTROL_HEIGHT, boxSizing: 'border-box' }}>
                    {(['rupee', 'points'] as const).map(mode => {
                      const active = mode === activeRewardUnit;
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
                            if (mode === activeRewardUnit) return;
                            // Lossless switch: the rupee value is canonical, so re-render the field
                            // from it in the new unit rather than reinterpreting the typed digits.
                            const shown = mode === 'points'
                              ? rupeesToRewardPoints(rewardRupees, rewardSourceAcc)
                              : rewardRupees;
                            setInputStrings(prev => ({ ...prev, rewardUsed: shown === 0 ? '' : String(shown) }));
                            setRewardUnitMode(mode);
                          }}
                        >
                          {mode === 'points' ? 'PTS' : '₹'}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  className="btn btn-danger flex-center"
                  title="Remove split"
                  aria-label="Remove split"
                  style={{
                    width: SPLIT_CONTROL_HEIGHT,
                    height: SPLIT_CONTROL_HEIGHT,
                    padding: 0,
                    minHeight: 'auto',
                    boxSizing: 'border-box',
                    boxShadow: '2px 2px 0 #000'
                  }}
                  onClick={() => {
                    setShowRewardSplit(false);
                    setInputStrings(prev => ({ ...prev, rewardUsed: '' }));
                    setNewTx({ ...newTx, rewardUsed: 0, rewardUsedAccountId: '' });
                    if (errors.rewardUsedAccountId) setErrors(prev => ({ ...prev, rewardUsedAccountId: '' }));
                    if (errors.rewardUsed) setErrors(prev => ({ ...prev, rewardUsed: '' }));
                  }}
                >
                  <X size={14} strokeWidth={3} />
                </button>
              </div>
            </div>
            <div className="input-group">
              <label>
                Rewards Used{activeRewardUnit === 'points' ? ` (${rewardUnitLabel})` : ''}{' '}
                <span className="text-muted" style={{ fontWeight: 400 }}>(Optional)</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                className={`input-field ${errors.rewardUsed ? 'border-danger' : ''}`}
                value={inputStrings.rewardUsed}
                onChange={e => {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) {
                    setInputStrings(prev => ({ ...prev, rewardUsed: val }));
                    const numVal = parseFloat(val);
                    // Store rupees, always — utils' balance math and FinanceContext's leg rebalance
                    // both treat rewardUsed as money. The points figure is derived on save.
                    setNewTx({ ...newTx, rewardUsed: isNaN(numVal) ? 0 : rewardInputToRupees(numVal) });
                    if (errors.rewardUsed && !isNaN(numVal) && numVal > 0) {
                      setErrors(prev => ({ ...prev, rewardUsed: '' }));
                    }
                    if (errors.rewardUsedAccountId && (isNaN(numVal) || numVal <= 0)) {
                      setErrors(prev => ({ ...prev, rewardUsedAccountId: '' }));
                    }
                  }
                }}
                placeholder={activeRewardUnit === 'points' ? '0' : '0.00'}
              />
              {/* The counterpart value, same treatment as the instant-cashback percent hint. */}
              {isPointsSource && rewardRupees > 0 && (
                <span className="text-xs text-muted text-mono" style={{ marginTop: '0.25rem', opacity: 0.8 }}>
                  {activeRewardUnit === 'points'
                    ? `= ${formatCurrency(rewardRupees)}`
                    : `= ${rewardPoints} ${rewardUnitLabel}`}
                </span>
              )}
              {errors.rewardUsed && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.rewardUsed}</span>}
            </div>
            <CustomPicker
              label="From Rewards"
              value={newTx.rewardUsedAccountId || ''}
              placeholder="Select Reward Account"
              options={[
                { id: '', name: 'None (Select Account)' },
                // splitSourceAccounts is also what gates the button/panel above, so the picker can
                // never be offered empty (nor hide an account the gate counted).
                ...[...splitSourceAccounts].sort(sortByAccountType).map(acc => ({
                  id: acc.id,
                  name: acc.archived ? `${acc.name} (deleted)` : acc.name,
                  subtext: acc.rewardType === 'points'
                    ? `${calculateBalance(acc, data.transactions, getCurrentMonthStr(), false, true, data.cashbackStatements)} ${acc.rewardUnit || ''}`
                    : formatCurrency(calculateBalance(acc, data.transactions, getCurrentMonthStr(), false, false, data.cashbackStatements))
                }))
              ]}
              onChange={val => {
                // Accounts can differ in unit and rate, so the typed digits would change meaning on
                // a switch. Hold the rupee value steady and re-render the field for the new account:
                // 430 Jewels (₹86) picked over to a rupee wallet shows 86, still ₹86.
                const nextAcc = data.accounts.find(a => a.id === val);
                const nextUnit = isPointsDenominated(nextAcc) ? rewardUnitMode : 'rupee';
                const shown = nextUnit === 'points' ? rupeesToRewardPoints(rewardRupees, nextAcc) : rewardRupees;
                setInputStrings(prev => ({ ...prev, rewardUsed: shown === 0 ? '' : String(shown) }));
                setNewTx({
                  ...newTx,
                  rewardUsedAccountId: val,
                  ...(!val && (Number(newTx.rewardUsed) || 0) <= 0 ? { rewardUsed: 0 } : {})
                });
                if (errors.rewardUsedAccountId) setErrors(prev => ({ ...prev, rewardUsedAccountId: '' }));
                if (errors.rewardUsed) setErrors(prev => ({ ...prev, rewardUsed: '' }));
              }}
              iconGetter={id => getAccountIcon(id)}
              error={errors.rewardUsedAccountId}
            />
            <div className="col-span-2 text-xs text-muted" style={{ opacity: 0.7 }}>
              Primary Account Debit: <strong>{formatCurrency(Math.max(0, Number(newTx.amount || 0) - Number(newTx.rewardUsed || 0)))}</strong>
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
          <div className="input-group" style={{ marginBottom: 0 }}>
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
          <div ref={passiveLogRef} className="flex-col gap-3" style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-hover)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
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
