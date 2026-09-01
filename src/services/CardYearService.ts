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
// The fallback, when no open date has been entered, is the financial year, and `isAnniversary` says
// which one you got. Callers are expected to SAY SO rather than quietly present a financial year as
// if it were the membership year — a wrong window shown confidently is worse than no bar at all,
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

/** Paying the card off is not spending on it. Same set, same reasoning, as CardDuesService. */
const SETTLEMENT_CATEGORIES = new Set(['cc payment', 'transfer']);

/** The twelve months a card's fees and totals are reckoned over. */
export interface CardYear {
  /** 'YYYY-MM-DD', inclusive. */
  start: string;
  /** 'YYYY-MM-DD', inclusive. */
  end: string;
  /** True when anchored on the card's own open date; false when this is the financial-year fallback. */
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
 * The membership year containing `now`, or the financial year when the card has no open date.
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

  // Financial year, April to March — the same reckoning the Statements screen groups by, so the
  // fallback at least agrees with the other year on screen.
  const y = today.getFullYear();
  const startYear = today.getMonth() >= 3 ? y : y - 1;
  const start = new Date(startYear, 3, 1);
  const end = new Date(startYear + 1, 2, 31);
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

  for (const t of transactions) {
    if (t.accountId !== account.id) continue;
    if (!affectsRupeeBalance(t)) continue;
    if (t.type !== 'debit') continue;
    if (SETTLEMENT_CATEGORIES.has((t.category || '').toLowerCase())) continue;
    lifetimeSpend += t.amount;
    // String comparison, and it is safe: both sides are 'YYYY-MM-DD', which sorts lexicographically
    // in date order. Inclusive at both ends — the window's last day is a day you can still spend on.
    if (t.date >= year.start && t.date <= year.end) {
      yearSpend += t.amount;
      yearCount += 1;
    }
  }

  return { yearSpend, lifetimeSpend, yearCount };
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
 * open date was never entered gets the financial-year fallback, where "which year is this" has no
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
