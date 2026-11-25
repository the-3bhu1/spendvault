// ── A card's YEAR: the window a fee waiver is measured over, and what was spent in it ────────────
//
// The Cards tree's card summary screen answers three questions that all say "this year", and they
// have to mean the SAME year or the screen contradicts itself: how far along a spend-based fee
// waiver is, what the card has been spent on, and what it has earned back. This file decides what
// that year is, once, so those three can't drift.
//
// THE YEAR IS THE MEMBERSHIP YEAR, anchored on Account.cardOpenedOn. That is the window a bank
// actually measures a waiver over — a card issued in March renews in March — and it is the only
// choice that can be RIGHT. The financial year is right for cards opened in April and wrong by up
// to eleven months for every other card, which on a waiver bar is not a cosmetic error: it would
// read "waived" while the bank was still charging.
//
// The fallback, when no open date has been entered, is the calendar year (January–December), and
// `isAnniversary` says which one you got. Callers are expected to SAY SO rather than quietly present a
// calendar year as if it were the membership year — a wrong window shown confidently is worse than no bar at all,
// which is why this returns the flag instead of pretending.
//
// SPEND IS COUNTED BY TRANSACTION DATE, not by applied billing cycle — the one place in this app
// where those two deliberately part company. CardDuesService counts by cycle because a statement IS
// a cycle; a membership year is a range of DATES, and a bank measuring your spend for a waiver
// measures when you spent it. The two answers differ for charges near a statement boundary, and each
// is correct about its own question.
//
// Settlement legs are excluded on the same reasoning as CardDuesService: paying your own bill is not
// spending on the card, and a transfer is not a purchase. Credits are not netted off — a waiver is
// measured on what you SPENT, and a refund posted months later does not un-spend it. That is a
// judgement, and it is the lenient one; banks differ, and a bar that ran backwards when a refund
// landed would be the more confusing of the two errors.
import {
  addYears, differenceInCalendarDays, differenceInCalendarYears, format, isAfter, parseISO,
  startOfDay, subDays,
} from 'date-fns';
import type { Account, Transaction } from '../types';
import { affectsRupeeBalance } from '../utils';
import { isOpeningBalanceEntry } from './CardStartService';

/** Paying the card off is not spending on it. Same set, same reasoning, as CardDuesService. */
const SETTLEMENT_CATEGORIES = new Set(['cc payment', 'transfer']);

/** The twelve months a card's fees and totals are reckoned over. */
export interface CardYear {
  /** 'YYYY-MM-DD', inclusive. */
  start: string;
  /** 'YYYY-MM-DD', inclusive. */
  end: string;
  /** True when anchored on the card's own open date; false when this is the calendar-year fallback. */
  isAnniversary: boolean;
  /** '14 Mar 2026 – 13 Mar 2027'. Printed in full because "this year" is ambiguous and this isn't. */
  label: string;
  /** How many membership years the card has completed. 0 during the first one. Anniversary only. */
  yearsHeld?: number;
  /** Days remaining in the window, today included. 0 on the last day. */
  daysLeft: number;
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const pretty = (d: Date) => format(d, 'd MMM yyyy');

/**
 * The membership year containing `now`, or the calendar year when the card has no open date.
 *
 * Anniversaries are stepped with addYears rather than by setting the year on the open date, which
 * matters for exactly one card in fourteen hundred: addYears clamps 29 Feb to 28 Feb in a common
 * year, where setYear rolls it forward to 1 March and drifts the window by a day for ever after.
 */
export const getCardYear = (account: Account, now: Date = new Date()): CardYear => {
  const today = startOfDay(now);

  if (account.cardOpenedOn) {
    const opened = startOfDay(parseISO(account.cardOpenedOn));
    // differenceInCalendarYears counts year numbers, so it can land one ahead when the anniversary
    // hasn't come round yet this year — hence the step back. Clamped at zero for a card whose open
    // date is in the future, which is a typo rather than a state: it gets its first year.
    let held = Math.max(0, differenceInCalendarYears(today, opened));
    let start = addYears(opened, held);
    if (isAfter(start, today)) {
      held = Math.max(0, held - 1);
      start = addYears(opened, held);
    }
    const end = subDays(addYears(start, 1), 1);
    return {
      start: iso(start),
      end: iso(end),
      isAnniversary: true,
      label: `${pretty(start)} – ${pretty(end)}`,
      yearsHeld: held,
      daysLeft: Math.max(0, differenceInCalendarDays(end, today)),
    };
  }

  // Calendar year, January to December — the same reckoning the Statements screen groups its cycles
  // by, so the fallback at least agrees with the other year on screen. (It was the financial year,
  // April–March, which nothing about a card follows: no fee and no waiver is measured over it.)
  const y = today.getFullYear();
  const start = new Date(y, 0, 1);
  const end = new Date(y, 11, 31);
  return {
    start: iso(start),
    end: iso(end),
    isAnniversary: false,
    label: `${pretty(start)} – ${pretty(end)}`,
    daysLeft: Math.max(0, differenceInCalendarDays(end, today)),
  };
};

/** What one card has been spent on. */
export interface CardSpendFigures {
  /** Purchases inside the window. */
  yearSpend: number;
  /** Every purchase ever put on the card. */
  lifetimeSpend: number;
  /** How many purchases the year figure is made of — so an empty year can say so. */
  yearCount: number;
  /** The part of yearSpend entered as "spent before tracking" rather than logged. 0 when none. */
  carriedIn: number;
  /** Set when the year figure only covers PART of the year: the card was added after the year
   *  began and no "spent before tracking" total fills the gap. The earliest day it does cover — the
   *  day the card was added, or an earlier logged spend if one was back-filled. */
  countedFrom?: string;
}

/**
 * Purchases on a card, inside the window and over its whole life.
 *
 * Both figures come off ONE pass so they cannot disagree about what counts as a purchase, which is
 * the entire failure mode this shape exists to prevent — a lifetime total that excludes something
 * the year total includes reads as a bug in the smaller number.
 */
export const getCardSpendFigures = (
  account: Account,
  transactions: Transaction[],
  year: CardYear
): CardSpendFigures => {
  let yearSpend = 0;
  let lifetimeSpend = 0;
  let yearCount = 0;
  let earliestInYear: string | undefined;

  /* SPENT BEFORE TRACKING. A card added mid-year carries the total it had been spent on so far
     (spendBeforeTracking), and that total already holds everything up to the day it was entered —
     so logged spends dated BEFORE that day are not counted again: a purchase back-filled into
     October after the card was added in November is part of the figure typed in November. It
     belongs to the card year containing that day, and simply stops counting once the card renews. */
  const before = account.spendBeforeTracking;
  const carriedIn = before && before.amount > 0 && before.asOf >= year.start && before.asOf <= year.end ? before.amount : 0;
  const countsFrom = before && before.amount > 0 ? before.asOf : undefined;

  for (const t of transactions) {
    if (t.accountId !== account.id) continue;
    if (!affectsRupeeBalance(t)) continue;
    if (t.type !== 'debit') continue;
    if (SETTLEMENT_CATEGORIES.has((t.category || '').toLowerCase())) continue;
    // The unbilled spends carried in when the card was added are inside spendBeforeTracking already —
    // but only when there IS one. Without it they are real spends on the card nothing else counts,
    // and dropping them would leave the waiver short by exactly the figure typed in as unbilled.
    if (countsFrom && isOpeningBalanceEntry(t)) continue;
    if (countsFrom && t.date < countsFrom) continue;
    lifetimeSpend += t.amount;
    // String comparison, and it is safe: both sides are 'YYYY-MM-DD', which sorts lexicographically
    // in date order. Inclusive at both ends — the window's last day is a day you can still spend on.
    if (t.date >= year.start && t.date <= year.end) {
      yearSpend += t.amount;
      yearCount += 1;
      if (!earliestInYear || t.date < earliestInYear) earliestInYear = t.date;
    }
  }

  // Into lifetime as well, whichever year it belongs to — an all-time figure smaller than this
  // year's would read as a bug in one of them.
  /* HOW MUCH OF THE YEAR THE FIGURE COVERS. A card added on 24 Nov with no total typed in knows
     nothing about July–November, and calling ₹3,500 "spent this year" would understate it with
     confidence. Partial only when the card was added after the year began and nothing — neither a
     carried total nor a back-filled spend — reaches back to the start. */
  let countedFrom: string | undefined;
  const tracked = account.trackedFrom;
  if (carriedIn === 0 && tracked && tracked > year.start && tracked <= year.end) {
    const from = earliestInYear && earliestInYear < tracked ? earliestInYear : tracked;
    if (from > year.start) countedFrom = from;
  }

  return {
    yearSpend: yearSpend + carriedIn,
    lifetimeSpend: lifetimeSpend + (before && before.amount > 0 ? before.amount : 0),
    yearCount,
    carriedIn,
    countedFrom,
  };
};

/** Where a card stands against its annual fee. */
export interface CardFeeStanding {
  joiningFee?: number;
  annualFee?: number;
  /** True when the card charges no annual fee at all. */
  lifetimeFree: boolean;
  /** True when an annual fee exists but this year's renewal is skipped as the first. */
  inFirstFreeYear: boolean;
  /** The spend that waives the next annual fee. Absent when the card offers no waiver. */
  waiverSpend?: number;
  /** 0–1, clamped. Absent when there is no waiver to make progress against. */
  waiverProgress?: number;
  /** Still to spend to earn the waiver. 0 once met. Absent when there is no waiver. */
  waiverRemaining?: number;
  /** Whether the year's spend has already cleared the bar. */
  waiverMet: boolean;
}

/**
 * What the card costs and whether this year's spend has bought its way out of the annual fee.
 *
 * `inFirstFreeYear` reads off the membership year's own count rather than off a date comparison, so
 * it is only ever true when the window is a real anniversary window — a first-year-free card whose
 * open date was never entered gets the calendar-year fallback, where "which year is this" has no
 * answer and claiming one would be a guess.
 */
export const getCardFeeStanding = (
  account: Account,
  year: CardYear,
  yearSpend: number
): CardFeeStanding => {
  const fees = account.cardFees;
  const annualFee = fees?.annualFee;
  // No annual fee — absent or zero — IS lifetime free. The fee picker stores nothing at all for an
  // LTF card, so absent is the shape that mode saves rather than a gap in the data. See CardFees.
  const lifetimeFree = !annualFee;
  const waiverSpend = fees?.waiverSpend;
  const standing: CardFeeStanding = {
    joiningFee: fees?.joiningFee,
    annualFee,
    lifetimeFree,
    inFirstFreeYear: !!fees?.firstYearFree && !lifetimeFree && year.isAnniversary && year.yearsHeld === 0,
    waiverMet: false,
  };

  // A waiver on a card with no annual fee is not a thing to make progress against — there would be
  // nothing at the end of the bar.
  if (waiverSpend && waiverSpend > 0 && !lifetimeFree) {
    standing.waiverSpend = waiverSpend;
    standing.waiverProgress = Math.min(1, Math.max(0, yearSpend / waiverSpend));
    standing.waiverRemaining = Math.max(0, waiverSpend - yearSpend);
    standing.waiverMet = yearSpend >= waiverSpend;
  }

  return standing;
};
