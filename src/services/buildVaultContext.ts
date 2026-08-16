// Assembles the per-question context for the "Ask Vault" assistant from the locally stored
// FinanceData. Two dynamic layers (the static app-knowledge layer lives in appKnowledge.ts):
//   B. A compact financial SUMMARY — computed with the SAME utils the UI uses, so the numbers
//      the assistant quotes match the Dashboard/Insights exactly. Never a raw dump.
//   C. A query-relevant TRANSACTION SLICE — a small, capped set of rows picked by lightly
//      parsing the question (month / category / account / keyword), so "what did I spend at X"
//      works without sending thousands of rows.
//
// Cost is bounded regardless of dataset size: the summary is fixed-shape and the slice is capped.

import type { FinanceData, Transaction } from '../types';
import {
  calculateBalance,
  formatCurrency,
  getCurrentMonthStr,
  getBillingCycleForDate,
  getLatestBilledCycle,
  isStatsExcludedCategory,
  isCountableTransaction,
  getInvestmentAccountStats,
  isPointsDenominated,
  affectsRupeeBalance,
} from '../utils';
import { format, parseISO, addMonths, subMonths } from 'date-fns';
import { calculateEPFProjection } from '../utils/epfEngine';
import { getCachedPrice, getCachedPrevPrice, getCachedCommodityPriceINR } from './MarketDataService';

const SLICE_CAP = 60;
const RECENT_FALLBACK = 40;
const TOP_N = 8;

// Categories that are internal bookkeeping, not real spending — shared with Dashboard/Insights/Transactions.
const isSystemCategory = (c: string) => isStatsExcludedCategory(c);

// Spend net of any explicit exclusion (mirrors the effectiveAmount logic in Insights/Dashboard).
const effectiveAmount = (t: Transaction) =>
  t.amount - (t.excludedAmount || (t.excludeFromStats ? t.amount : 0));

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

interface MonthStats {
  spend: number;
  income: number;
  count: number;
  byCategory: Record<string, number>;
  byAccount: Record<string, number>;
  // Credits per account, the counterpart to byAccount's debits. Needed because a liquid account's
  // detail screen now states its month's Income as well as its Spends, so "how much came into
  // Canara this month" is a question the UI invites — and one this context couldn't answer.
  incomeByAccount: Record<string, number>;
  byTag: Record<string, number>;
}

function monthStats(data: FinanceData, month: string): MonthStats {
  const stats: MonthStats = { spend: 0, income: 0, count: 0, byCategory: {}, byAccount: {}, incomeByAccount: {}, byTag: {} };
  data.transactions.filter(t => t.date.startsWith(month)).forEach(t => {
    // Insights headlines a transaction count, so quote the same number it does — the shared
    // rule drops system categories, cashback/reward auto-logs and fully passive rows.
    if (isCountableTransaction(t)) stats.count++;
    if (isSystemCategory(t.category)) return;
    const amt = effectiveAmount(t);
    if (t.type === 'debit') {
      if (amt <= 0) return;
      stats.spend += amt;
      stats.byCategory[t.category] = (stats.byCategory[t.category] || 0) + amt;
      const acc = data.accounts.find(a => a.id === t.accountId);
      const name = acc?.name || 'Unknown';
      stats.byAccount[name] = (stats.byAccount[name] || 0) + amt;
      // A transaction with multiple tags counts its full amount under each — tags aren't
      // mutually exclusive, so per-tag totals can legitimately exceed total spend.
      (t.tags || []).forEach(tag => {
        stats.byTag[tag] = (stats.byTag[tag] || 0) + amt;
      });
    } else if (t.type === 'credit') {
      if (amt <= 0) return;
      stats.income += amt;
      const acc = data.accounts.find(a => a.id === t.accountId);
      stats.incomeByAccount[acc?.name || 'Unknown'] = (stats.incomeByAccount[acc?.name || 'Unknown'] || 0) + amt;
    }
  });
  return stats;
}

function topEntries(rec: Record<string, number>, n = TOP_N): string {
  const items = Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n);
  if (!items.length) return '  (none)';
  return items.map(([k, v]) => `  - ${k}: ${formatCurrency(v)}`).join('\n');
}

function monthLabel(month: string): string {
  return new Date(`${month}-01`).toLocaleString('default', { month: 'long', year: 'numeric' });
}

// ── Layer B: financial summary ───────────────────────────────────────────────
function buildSummary(data: FinanceData): string {
  const today = format(new Date(), 'yyyy-MM-dd');
  const currentMonth = getCurrentMonthStr();
  const out: string[] = [];

  const dates = data.transactions.map(t => t.date).sort();
  out.push(`Today: ${today}. Currency: INR (₹).`);
  out.push(`Total transactions on record: ${data.transactions.length}` +
    (dates.length ? ` (earliest ${dates[0]}, latest ${dates[dates.length - 1]}).` : '.'));

  // Accounts (active only) with current balances.
  const active = data.accounts.filter(a => !a.archived);
  out.push('\n## Accounts & balances');
  if (!active.length) out.push('  (no accounts yet)');
  active.forEach(a => {
    if (a.type === 'stocks' || a.type === 'mutual_funds' || a.type === 'commodity') {
      const symbol = a.marketSymbol || '';
      const price = a.type === 'commodity'
        ? (a.manualPricePerGram ?? (symbol ? getCachedCommodityPriceINR(symbol) : null) ?? 0)
        : (symbol ? getCachedPrice(symbol) : null) ?? 0;
      const prevPrice = a.type === 'commodity' ? null : (symbol ? getCachedPrevPrice(symbol) : null);

      const stats = getInvestmentAccountStats(a, data.transactions, price);

      let invLine = `  - ${a.name} [${a.type}]: `;
      if (stats.currentPrice > 0) {
        invLine += `Current Value ${formatCurrency(stats.currentValue)} (Total Invested: ${formatCurrency(stats.totalInvested)}, Overall P&L: ${stats.totalReturn >= 0 ? '+' : ''}${formatCurrency(stats.totalReturn)} / ${stats.totalReturnPct.toFixed(2)}%)`;
        if (prevPrice && prevPrice > 0) {
          const oneDayReturn = (stats.currentPrice - prevPrice) * stats.totalUnits;
          const oneDayPct = ((stats.currentPrice - prevPrice) / prevPrice) * 100;
          invLine += ` [Today's Gain/Loss: ${oneDayReturn >= 0 ? '+' : ''}${formatCurrency(oneDayReturn)} / ${oneDayPct.toFixed(2)}%]`;
        }
      } else {
        invLine += `Total Invested ${formatCurrency(stats.totalInvested)} (Units: ${stats.totalUnits})`;
      }
      if (a.type === 'commodity' && a.commodityMetal) invLine += ` (${a.commodityMetal})`;
      out.push(invLine);
      return;
    }

    const isReward = a.type === 'rewards';
    const bal = calculateBalance(a, data.transactions, currentMonth, false, isReward, data.cashbackStatements);
    let line = `  - ${a.name} [${a.type}]: ${isReward ? `${bal} ${a.rewardUnit || 'pts'}` : formatCurrency(bal)}`;
    // A card with its own points programme (Jupiter's Jewels, Amex MR, Edge Miles) carries a SECOND
    // balance denominated in points, on top of its rupee outstanding — same shape as the NCMC travel
    // purse below. `isReward` only catches standalone rewards ACCOUNTS, so without this a card's
    // points are invisible to the assistant and "how many Jewels do I have" gets an honest but wrong
    // "I can't see that". Points became a first-class spending unit once reward splits opened up to
    // ordinary purchases, so this is now a question users actually ask.
    if (!isReward && isPointsDenominated(a)) {
      const pts = calculateBalance(a, data.transactions, currentMonth, false, true, data.cashbackStatements);
      line += ` (+ ${pts} ${a.rewardUnit || 'points'} available, ${a.pointsConversionRate || 1} ${a.rewardUnit || 'points'} = ₹1)`;
    }
    if (a.type === 'epf') {
      const proj = calculateEPFProjection(a, currentMonth);
      line += ` (Monthly Credit: ${formatCurrency(proj.totalContribution)}, Accrued Interest FY: ${formatCurrency(proj.accruedInterest)}, 1-Yr Projection: ${formatCurrency(proj.projectedOneYearBalance)})`;
    }
    // An NCMC-enabled card carries a SECOND, separate travel purse on top of its main balance, and the
    // Wealth screen counts both. calculateBalance returns only one at a time (the isTravel flag picks
    // which), so without this the assistant quotes a lower figure than Wealth shows for the same card.
    if (a.isNcmcEnabled) {
      const travelBal = calculateBalance(a, data.transactions, currentMonth, true, false, data.cashbackStatements);
      line += ` (+ NCMC travel balance: ${formatCurrency(travelBal)})`;
    }
    out.push(line);
  });

  // Credit-card dues (billed / unbilled) — mirrors the Dashboard calculation.
  const cards = data.accounts.filter(a => a.type === 'credit_card' && !a.archived);
  if (cards.length) {
    out.push('\n## Credit card dues');
    cards.forEach(cc => {
      const statementDay = cc.statementDay || 1;
      const billedCycle = getLatestBilledCycle(statementDay);
      const unbilledCycle = format(addMonths(parseISO(`${billedCycle}-01`), 1), 'yyyy-MM');
      let billed = 0, unbilled = 0;
      data.transactions.forEach(t => {
        if (t.accountId !== cc.id) return;
        // Mirrors the Dashboard: a points redemption isn't a charge on the credit line, so quoting it
        // as part of the dues would overstate them (and disagree with the card balance).
        if (!affectsRupeeBalance(t)) return;
        const cyc = t.appliedBillingCycleYearMonth || getBillingCycleForDate(t.date, statementDay);
        if (cyc === unbilledCycle) unbilled += t.type === 'debit' ? t.amount : -t.amount;
        else if (cyc === billedCycle) billed += t.type === 'debit' ? t.amount : -t.amount;
      });
      billed = Math.max(0, billed); unbilled = Math.max(0, unbilled);
      out.push(`  - ${cc.name}: billed ${formatCurrency(billed)}, unbilled ${formatCurrency(unbilled)}, total ${formatCurrency(billed + unbilled)}` +
        (cc.dueDay ? `, due day ${cc.dueDay}` : ''));
    });
  }

  // Monthly spend — current + previous two months.
  out.push('\n## Monthly spending (excludes transfers, payments & investments)');
  [0, 1, 2].forEach(offset => {
    const m = format(subMonths(parseISO(`${currentMonth}-01`), offset), 'yyyy-MM');
    const s = monthStats(data, m);
    out.push(`\n### ${monthLabel(m)}${offset === 0 ? ' (current)' : ''}`);
    out.push(`  Total spend: ${formatCurrency(s.spend)} · Income: ${formatCurrency(s.income)} · Transactions: ${s.count}`);
    out.push('  By category:');
    out.push(topEntries(s.byCategory));
    if (offset === 0) {
      // Labelled by direction now that both are here — a bare "By account" over debit-only figures
      // read as the account's whole month.
      out.push('  Spends by account:');
      out.push(topEntries(s.byAccount));
      if (Object.keys(s.incomeByAccount).length) {
        out.push('  Income by account:');
        out.push(topEntries(s.incomeByAccount));
      }
      if (Object.keys(s.byTag).length) {
        out.push('  By tag (a transaction can carry several, so these may overlap):');
        out.push(topEntries(s.byTag));
      }
    }
  });

  // Budgets vs actual (current month).
  const budgets = data.categoryBudgets || {};
  const budgetKeys = Object.keys(budgets);
  if (budgetKeys.length) {
    const cur = monthStats(data, currentMonth).byCategory;
    out.push('\n## Category budgets (this month: spent / budget)');
    budgetKeys.forEach(cat => {
      out.push(`  - ${cat}: ${formatCurrency(cur[cat] || 0)} / ${formatCurrency(budgets[cat])}`);
    });
  }

  // Debts (per-person net + recent dated ledger entries, so "when was the last repayment"
  // type questions can be answered — the entries live in debt.transactions, not data.transactions).
  const debts = (data.debts || []).filter(d => d.status === 'active');
  if (debts.length) {
    const ENTRY_LABELS: Record<string, string> = {
      lent: 'lent to them', borrowed: 'borrowed from them',
      repayment_received: 'repayment received', repayment_sent: 'repayment sent',
    };
    out.push('\n## Lending & borrowing (active)');
    debts.forEach(d => {
      const net = d.transactions.reduce((sum, tx) => {
        // Positive = they owe you; negative = you owe them.
        if (tx.type === 'lent') return sum + tx.amount;
        if (tx.type === 'borrowed') return sum - tx.amount;
        if (tx.type === 'repayment_received') return sum - tx.amount;
        if (tx.type === 'repayment_sent') return sum + tx.amount;
        return sum;
      }, 0);
      const who = net > 0 ? `${d.personName} owes you` : net < 0 ? `you owe ${d.personName}` : `settled with ${d.personName}`;
      out.push(`  - ${who} ${formatCurrency(Math.abs(net))}`);
      const recent = [...d.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
      recent.forEach(tx => {
        out.push(`      ${tx.date} | ${ENTRY_LABELS[tx.type] || tx.type} | ${formatCurrency(tx.amount)}` +
          (tx.description ? ` | ${tx.description}` : ''));
      });
    });
  }

  // Upcoming bills. Bills only — investment schedules are not trackable here (see UpcomingBills).
  const bills = (data.recurringBills || []).filter(b => b.isActive)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate)).slice(0, 8);
  if (bills.length) {
    out.push('\n## Upcoming bills');
    bills.forEach(b => {
      // Overdue is stated outright rather than left to be inferred from the date. It is a
      // first-class state on the Bills screen now — a bill only leaves it when LOG/LINK/PAID
      // rolls the cycle — and "which bills are overdue" is the obvious question about it.
      const overdue = b.nextDueDate < today ? ' (OVERDUE — not yet recorded as paid)' : '';
      out.push(`  - ${b.name}: ${formatCurrency(b.amount)} (${b.frequency}), next due ${b.nextDueDate}${overdue}`);
    });
  }

  return out.join('\n');
}

// ── Layer C: query-relevant transaction slice ────────────────────────────────
const STOPWORDS = new Set(['the', 'and', 'for', 'how', 'much', 'did', 'spend', 'spent', 'what',
  'was', 'were', 'are', 'have', 'has', 'this', 'that', 'last', 'month', 'year', 'show', 'tell',
  'about', 'with', 'from', 'into', 'all', 'any', 'list', 'give', 'pay', 'paid', 'total', 'many']);

function detectMonthRange(q: string, currentMonth: string): { start: string; end: string } | null {
  const lower = q.toLowerCase();
  // Explicit YYYY-MM
  const ym = lower.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (ym) return { start: `${ym[1]}-${ym[2]}-01`, end: `${ym[1]}-${ym[2]}-31` };
  if (/\blast month\b/.test(lower)) {
    const m = format(subMonths(parseISO(`${currentMonth}-01`), 1), 'yyyy-MM');
    return { start: `${m}-01`, end: `${m}-31` };
  }
  if (/\bthis month\b/.test(lower)) return { start: `${currentMonth}-01`, end: `${currentMonth}-31` };
  // Month name, optionally with a year.
  const nameIdx = MONTHS.findIndex(mn => new RegExp(`\\b${mn}\\b`).test(lower));
  if (nameIdx >= 0) {
    const yearMatch = lower.match(/\b(20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : currentMonth.slice(0, 4);
    const mm = String(nameIdx + 1).padStart(2, '0');
    return { start: `${year}-${mm}-01`, end: `${year}-${mm}-31` };
  }
  return null;
}

function buildSlice(data: FinanceData, query: string): string {
  const currentMonth = getCurrentMonthStr();
  const lower = query.toLowerCase();
  let txs = data.transactions;
  let filtered = false;

  const range = detectMonthRange(query, currentMonth);
  if (range) { txs = txs.filter(t => t.date >= range.start && t.date <= range.end); filtered = true; }

  const cat = (data.categories || []).find(c => c && lower.includes(c.toLowerCase()));
  if (cat) { txs = txs.filter(t => t.category.toLowerCase() === cat.toLowerCase()); filtered = true; }

  const acc = data.accounts.find(a => a.name && lower.includes(a.name.toLowerCase()));
  if (acc) { txs = txs.filter(t => t.accountId === acc.id); filtered = true; }

  // Tags — matched either by "#tag" tokens in the question or by a whole-word mention of a
  // known tag name. Filtering is AND with any month/category/account already applied above,
  // so "spend on #WorkTravel this month" narrows correctly.
  const hashTokens = (lower.match(/#([a-z0-9_]+)/g) || []).map(s => s.slice(1));
  const allKnownTags = [...(data.tags || []), ...(data.eventTags || [])];
  const queryTags = allKnownTags.filter(tag => {
    const t = tag.toLowerCase();
    if (hashTokens.includes(t)) return true;
    return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower);
  });
  if (queryTags.length) {
    const wanted = new Set(queryTags.map(t => t.toLowerCase()));
    txs = txs.filter(t => (t.tags || []).some(tg => wanted.has(tg.toLowerCase())));
    filtered = true;
  }

  // If nothing structured matched, try keyword search on the description.
  if (!filtered) {
    const tokens = lower.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w));
    if (tokens.length) {
      const hits = data.transactions.filter(t =>
        tokens.some(tok => t.description.toLowerCase().includes(tok)));
      if (hits.length) { txs = hits; filtered = true; }
    }
  }

  const matched = txs.length;
  const rows = [...txs]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, filtered ? SLICE_CAP : RECENT_FALLBACK)
    .map(t => {
      const acct = data.accounts.find(a => a.id === t.accountId)?.name || 'Unknown';
      const tagStr = (t.tags && t.tags.length) ? ` | ${t.tags.map(tg => `#${tg}`).join(' ')}` : '';
      return `${t.date} | ${t.description} | ${t.type === 'debit' ? '-' : '+'}${formatCurrency(t.amount)} | ${t.category} | ${acct}${tagStr}`;
    });

  const header = filtered
    ? `## Matching transactions (${rows.length} shown of ${matched})`
    : `## Most recent transactions (${rows.length})`;
  let body = rows.length ? rows.join('\n') : '  (no matching transactions)';
  if (matched > rows.length) {
    body += `\n(Truncated — ${matched - rows.length} more match. Ask the user to narrow by month, category, or account for the rest.)`;
  }

  // Accurate pre-computed totals for the full matched set (not just the shown rows), so tag/
  // category/account questions are answered from an exact figure rather than the model summing
  // a possibly-truncated list. Spend excludes internal-bookkeeping categories, matching the summary.
  if (filtered && matched) {
    let spend = 0, income = 0;
    txs.forEach(t => {
      if (isSystemCategory(t.category)) return;
      const amt = effectiveAmount(t);
      if (t.type === 'debit' && amt > 0) spend += amt;
      else if (t.type === 'credit') income += amt;
    });
    body += `\n\nTotals for ALL ${matched} matching transactions — spend ${formatCurrency(spend)}, income ${formatCurrency(income)}.`;
  }
  return `${header}\n${body}`;
}

/**
 * Builds the dynamic context (financial summary + query-relevant transaction slice) the assistant
 * sees for a single question. The static app-knowledge layer is added by AskVaultService.
 * `cardDetails`, PINs and other secrets are NEVER read here — only aggregates and trimmed rows.
 */
export function buildVaultContext(data: FinanceData, query: string): string {
  return `${buildSummary(data)}\n\n${buildSlice(data, query)}`;
}
