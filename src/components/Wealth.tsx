import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFinance } from '../FinanceContext';
import type { Account, Transaction } from '../types';
import { BUILT_IN_ACCOUNT_TYPES } from '../types';
import { fetchPricesForSymbols, fetchStockHistory, fetchMFNavHistory, sliceHistoryByRange, getLatestFetchedAt, getLatestCommodityFetchedAt, getCacheFetchedAt, fetchCommodityPriceINR, getCachedPrice, getCachedCommodityPriceINR, fetchPrevClosesForSymbols, getCachedPrevPrice, getCachedPrevCommodityPriceINR } from '../services/MarketDataService';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, RotateCcw, ChevronLeft, ChevronRight, ChevronDown, Landmark, ShieldCheck } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';
import WealthBackdrop from './WealthBackdrop';
import { PortfolioBackdrop, AssetsBackdrop, RetirementBackdrop } from './WealthCategoryBackdrops';
import { LogoAvatar } from './LogoAvatar';
import { DetailHeroBand, DetailHeroSeal, DETAIL_HERO_AVATAR, DETAIL_HERO_LIFT } from './DetailHeroBackdrop';
import { getAssetLogoUrl, getLiquidLogoUrl, ensureAssetLogo, ensureLiquidLogo, LOGOS_UPDATED_EVENT } from '../services/LogoService';
import { calculateEPFProjection, getEPFInterestRate, getFinancialYearForDate } from '../utils/epfEngine';
import { calculateBalance, getCurrentMonthStr, formatCurrency, getInvestmentAccountStats, affectsRupeeBalance, isStatsExcludedCategory, statsAmount } from '../utils';
import { getCategoryIcon } from './transactionIcons';

type HistoryDataPoint = { date: number; close: number };
type StockHistoryRange = '1d' | '5d' | '1mo' | '3mo' | '1y' | '5y';
type MFHistoryRange = '1m' | '6m' | '1y' | 'all';
// A liquid account's longer windows are assembled from month-keyed opening balances, so they're
// counts of months. 1M is the exception: a single month is one point at that granularity, so it's
// built day by day from the ledger instead.
type BalanceRange = '1m' | '6m' | '1y' | 'all';
const BALANCE_RANGE_MONTHS: Record<Exclude<BalanceRange, '1m'>, number> = { '6m': 6, '1y': 12, all: 120 };
const DAILY_WINDOW_DAYS = 30;

// Each chart's pill row, in display order — and by construction the range it opens at, because every
// detail screen resets to its row's FIRST option (see openAssetDetail). Declared here rather than
// inline at the pill rows so a row and its default can't drift apart: reorder a row and the default
// follows it, with nothing to restate.
const STOCK_RANGES: StockHistoryRange[] = ['1d', '5d', '1mo', '3mo', '1y', '5y'];
const MF_RANGES: MFHistoryRange[] = ['1m', '6m', '1y', 'all'];
const BALANCE_RANGES: BalanceRange[] = ['1m', '6m', '1y', 'all'];
// A points wallet drops 1M: its balance also moves on confirmed cashback statements at a conversion
// rate that only calculateBalance knows how to apply, so it can't be walked day by day. That makes
// 6M the first pill in its row, and therefore its default.
const POINTS_BALANCE_RANGES: BalanceRange[] = ['6m', '1y', 'all'];
// 1D is sampled every 5 minutes and 5D hourly (see getYahooIntervalAndRange), so a date-only tooltip
// label would repeat itself down the whole series. Only stocks offer these two.
const INTRADAY_STOCK_RANGES = new Set<StockHistoryRange>(['1d', '5d']);

// The three top-level Wealth categories. `null` = the category tree (main screen).
type WealthCategory = 'portfolio' | 'assets' | 'retirement';
// Portfolio holds market investments only; EPF has its own category now.
type PortfolioFilter = 'all' | 'mf' | 'stocks' | 'commodity';
// "other" catches debit cards, rewards wallets and user-created custom account types — every
// liquid type that isn't a bank account, cash or an e-wallet.
type AssetsFilter = 'all' | 'bank' | 'cash' | 'ewallet' | 'other';

// Which figure a holding row shows on its right. Cycled from a pill on the section header, so the
// numbers a holding has are all reachable from the list instead of only inside its detail screen.
// Only offered when the list is narrowed to ONE asset class — across mixed classes the rows would
// be comparing figures that aren't comparable. Each class advertises only the stops it can answer:
// Metals omit 'oneDay', having no dependable previous close.
type HoldingMetric = 'value' | 'oneDay' | 'returns';
const HOLDING_METRICS: { v: HoldingMetric; label: string }[] = [
  { v: 'value', label: 'Current (Invested)' },
  { v: 'oneDay', label: '1D Change' },
  { v: 'returns', label: 'Returns' },
];

// The arrow and the amount are one unit, so they're set with a hair of margin rather than a space
// character: in the mono face a space carries a full advance plus .text-mono's 0.05em tracking, which
// opened a visible gap between the arrow and the ₹.
const signedAmount = (positive: boolean, body: ReactNode) => (
  <>
    <span style={{ marginRight: '0.14em' }}>{positive ? '↑' : '↓'}</span>
    {body}
  </>
);

function StatRow({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '1rem',
      padding: '0.85rem 0'
    }}>
      <span className="text-mono uppercase" style={{
        fontSize: '0.78rem',
        fontWeight: 700,
        letterSpacing: '1px',
        color: 'var(--text-secondary)',
        flexShrink: 0
      }}>
        {label}
      </span>
      <span style={{
        fontSize: '0.95rem',
        fontWeight: 700,
        color: color || 'var(--text-primary)',
        textAlign: 'right',
        overflowWrap: 'anywhere'
      }}>
        {value}
      </span>
    </div>
  );
}

// The end padding the XAxis reserves inside the plot: without it the first and last points sit glued
// to the container's edge. It means the graph's own visual edge — where the trend line and the area
// fill start — is this far in from the box, which makes it the gutter every left-aligned row on a
// detail screen has to match. A stat list at 1.25rem and a chart at 16px don't share a column; the
// 4px difference reads as a misalignment rather than as breathing room.
const CHART_END_PAD = 16;
const DETAIL_GUTTER = `${CHART_END_PAD}px`;

// How close the tooltip may come to the chart's edge before it stops following the point.
const TOOLTIP_EDGE_PAD = 10;
// How close the caret may come to the bubble's own corners: it has to sit on a flat stretch of the
// bottom edge, clear of the rounded corners, or it reads as detached.
const TOOLTIP_CARET_INSET = 12;

type ChartTooltipProps = {
  active?: boolean;
  payload?: readonly { value?: unknown }[];
  label?: string | number;
  coordinate?: { x?: number; y?: number };
  color: string;
  formatDate: (ms: number) => string;
  formatValue: (n: number) => string;
};

// The tooltip shared by every chart on this screen.
//
// Recharts parks its wrapper on the data point and we centre the bubble over it with
// translateX(-50%), which sends half the bubble off-screen at the first and last points. So: measure
// the bubble, clamp its centre to stay inside the plot, and slide the caret the opposite way by the
// same amount so it keeps pointing at the point the bubble is actually describing.
function ChartTooltip({ active, payload, label, coordinate, color, formatDate, formatValue }: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  const raw = payload && payload.length ? Number(payload[0].value) : null;
  const valueText = raw === null || Number.isNaN(raw) ? '' : formatValue(raw);
  const dateText = label == null ? '' : formatDate(Number(label));

  // The point comes from props, NOT from measuring the wrapper recharts positions us in: recharts
  // writes that wrapper's transform in its own effect, which runs after this child's, so reading it
  // here yields the PREVIOUS point and every clamp lands one hover behind. `coordinate.x` is
  // plot-relative for the current render; only the container's box needs the DOM, and that's stable.
  //
  // Layout effect, not a plain one: the shift has to land in the same paint as the bubble, or it
  // visibly jumps from off-screen to clamped on every hover. Depending on coordinate.x rather than
  // the rendered text is what makes a dependency array safe here — two adjacent points can format
  // identically, but they can't share an x.
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.closest('.wealth-chart');
    if (!el || !box || coordinate?.x == null) return;
    const half = el.offsetWidth / 2;
    const boxRect = box.getBoundingClientRect();
    const pointX = boxRect.left + coordinate.x;
    const min = boxRect.left + TOOLTIP_EDGE_PAD + half;
    const max = boxRect.right - TOOLTIP_EDGE_PAD - half;
    // A bubble wider than the chart can't be clamped into it — leave it centred rather than
    // wedging it against one side.
    const wanted = max < min ? 0 : Math.min(Math.max(pointX, min), max) - pointX;
    // The caret can only travel as far as its own inset from the bubble's corners, so the bubble
    // may not travel further than that either: past it the caret stalls at the corner while the
    // bubble keeps going, and the two stop meeting over the point. The edge pad is the softer of
    // the two promises — a bubble that hugs the edge tighter than asked still reads fine, a caret
    // sitting a dozen pixels off its dotted line does not.
    const reach = Math.max(0, half - TOOLTIP_CARET_INSET);
    const next = Math.min(Math.max(wanted, -reach), reach);
    // Guarded so a sub-pixel difference can't ping-pong the effect.
    setShift(prev => (Math.abs(prev - next) < 0.5 ? prev : next));
  }, [coordinate?.x, valueText, dateText]);

  if (!active || !payload || !payload.length) return null;

  return (
    <div
      ref={ref}
      style={{
        transform: `translateX(calc(-50% + ${shift}px))`,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: '0.6rem',
        padding: '0.45rem 0.7rem',
        position: 'relative',
        whiteSpace: 'nowrap',
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        pointerEvents: 'none'
      }}
    >
      <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
        {dateText}
      </div>
      <div style={{ fontSize: '0.9rem', fontWeight: 700, color }}>
        {valueText}
      </div>
      <div style={{
        position: 'absolute',
        bottom: '-5px',
        // Undoes the bubble's shift, exactly, so the caret stays over the data point. No clamp is
        // needed here: the shift is already capped to the caret's reach, which keeps this within
        // TOOLTIP_CARET_INSET of both corners.
        left: `calc(50% - ${shift}px)`,
        transform: 'translateX(-50%) rotate(45deg)',
        width: '10px',
        height: '10px',
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border-color)',
        borderBottom: '1px solid var(--border-color)'
      }} />
    </div>
  );
}

// We hide the 1-day return only on the day's FIRST Wealth load (when the cached figure is
// shown), because the market didn't move — we just re-rendered the baseline. Once the user
// taps "Refresh", we calculate the actual change from the API response and display it.
const WEALTH_REFRESH_DAY_KEY = 'wealth_last_refresh_day';

function currentDayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Wealth() {
  const { data } = useFinance();

  const [prices, setPrices] = useState<Record<string, number>>(() => {
    const cached: Record<string, number> = {};
    (data?.accounts || [])
      .filter((a: Account) => (a.type === 'stocks' || a.type === 'mutual_funds') && a.marketSymbol)
      .forEach((a: Account) => { const p = getCachedPrice(a.marketSymbol!); if (p !== null) cached[a.marketSymbol!] = p; });
    (data?.accounts || [])
      .filter((a: Account) => a.type === 'commodity' && a.marketSymbol)
      .forEach((a: Account) => { const p = getCachedCommodityPriceINR(a.marketSymbol!); if (p !== null) cached[a.marketSymbol!] = p; });
    return cached;
  });

  const [prevPrices, setPrevPrices] = useState<Record<string, number>>(() => {
    const cached: Record<string, number> = {};
    (data?.accounts || [])
      .filter((a: Account) => (a.type === 'stocks' || a.type === 'mutual_funds') && a.marketSymbol)
      .forEach((a: Account) => { const p = getCachedPrevPrice(a.marketSymbol!); if (p !== null) cached[a.marketSymbol!] = p; });
    (data?.accounts || [])
      .filter((a: Account) => a.type === 'commodity' && a.marketSymbol)
      .forEach((a: Account) => { const p = getCachedPrevCommodityPriceINR(a.marketSymbol!); if (p !== null) cached[a.marketSymbol!] = p; });
    return cached;
  });
  // Start true: a refresh always runs on mount, and we don't want to flash a partial 1-day
  // return (e.g. stocks-only, before MF prev-NAV loads) for a frame before the spinner shows.
  const [isRefreshing, setIsRefreshing] = useState(true);
  // Gates the PORTFOLIO hero's 1-day return, which stays put through later refreshes: if we
  // already refreshed today (per the persisted day) the cached value is current + complete, so
  // seed this true and show it immediately on remount/reopen. The root Wealth hero deliberately
  // ignores this and keys off isRefreshing alone — see the loader branch in the root hero.
  const [hasRefreshed, setHasRefreshed] = useState(() => {
    try { return localStorage.getItem(WEALTH_REFRESH_DAY_KEY) === currentDayStr(); } catch { return false; }
  });
  // Seed from the cached fetch time so "Last refresh at" shows immediately (no blink) — but only
  // when we've already refreshed today. On the day's first load the cached fetchedAt is
  // yesterday's, which would show a misleading HH:MM, so stay hidden until the fresh refresh.
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(() => {
    try {
      if (localStorage.getItem(WEALTH_REFRESH_DAY_KEY) !== currentDayStr()) return null;
      const syms = (data?.accounts || [])
        .filter((a: Account) => (a.type === 'stocks' || a.type === 'mutual_funds') && a.marketSymbol)
        .map((a: Account) => a.marketSymbol!);
      const metalTickers = (data?.accounts || [])
        .filter((a: Account) => a.type === 'commodity' && a.marketSymbol && a.manualPricePerGram === undefined)
        .map((a: Account) => a.marketSymbol!);
      const latest = Math.max(
        getLatestFetchedAt(syms) ?? 0,
        getLatestCommodityFetchedAt(metalTickers) ?? 0
      );
      return latest > 0 ? new Date(latest) : null;
    } catch { return null; }
  });
  const [error, setError] = useState<string | null>(null);

  const [selectedAsset, setSelectedAsset] = useState<Account | null>(null);
  // Which top-level category is open; null = the category tree.
  const [category, setCategory] = useState<WealthCategory | null>(null);
  // Scroll position per navigation level, so backing out of a sub-view (or a holding detail)
  // lands where the user was instead of at the top. Keyed by level, not a single scalar, because
  // the stack is now two deep: tree → sub-view → holding detail.
  const scrollRef = useRef<{ tree: number; category: number }>({ tree: 0, category: 0 });
  const [historyData, setHistoryData] = useState<HistoryDataPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [stockRange, setStockRange] = useState<StockHistoryRange>(STOCK_RANGES[0]);
  const [mfRange, setMFRange] = useState<MFHistoryRange>(MF_RANGES[0]);
  const [balanceRange, setBalanceRange] = useState<BalanceRange>(BALANCE_RANGES[0]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [portfolioFilter, setPortfolioFilter] = useState<PortfolioFilter>('all');
  const [assetsFilter, setAssetsFilter] = useState<AssetsFilter>('all');
  // Reset to 'value' whenever the class filter changes or the category is re-entered — see those
  // call sites. The cycler is a look at the current list, not a preference that follows you around.
  const [holdingMetric, setHoldingMetric] = useState<HoldingMetric>('value');
  // Bumped when a background AI logo lookup resolves, so resolved logos appear without a reload.
  const [, setLogoTick] = useState(0);

  const toggleSection = (key: string) =>
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Archived (soft-deleted) accounts are excluded from Wealth — they shouldn't count toward
  // any category total or appear in the lists.
  const isDemoActive = useMemo(() => {
    return (data?.accounts || []).some((a: Account) => a.id.startsWith('demo_'));
  }, [data?.accounts]);

  const activeAccounts = useMemo(() => {
    const raw = data?.accounts || [];
    if (isDemoActive) {
      return raw.filter((a: Account) => a.id.startsWith('demo_'));
    }
    return raw;
  }, [data?.accounts, isDemoActive]);

  const mfAccounts = useMemo(() => {
    try {
      return activeAccounts.filter((a: Account) => a.type === 'mutual_funds' && !a.archived);
    } catch {
      return [];
    }
  }, [activeAccounts]);

  const stockAccounts = useMemo(() => {
    try {
      return activeAccounts.filter((a: Account) => a.type === 'stocks' && !a.archived);
    } catch {
      return [];
    }
  }, [activeAccounts]);

  const commodityAccounts = useMemo(() => {
    try {
      return activeAccounts.filter((a: Account) => a.type === 'commodity' && !a.archived);
    } catch {
      return [];
    }
  }, [activeAccounts]);

  const epfAccounts = useMemo(() => {
    try {
      return activeAccounts.filter((a: Account) => a.type === 'epf' && !a.archived);
    } catch {
      return [];
    }
  }, [activeAccounts]);

  // ── Assets (liquid) ───────────────────────────────────────────────────────────────────────────
  // Every non-investment account that holds spendable money. `credit_card` is deliberately absent:
  // it's a liability, and Wealth doesn't net debt (see the Debts screen for that).
  const currentMonth = getCurrentMonthStr();

  const liquidGroups = useMemo(() => {
    const live = activeAccounts.filter((a: Account) => !a.archived);
    const isCustomType = (t: string) => !(BUILT_IN_ACCOUNT_TYPES as readonly string[]).includes(t);
    return {
      bank: live.filter((a: Account) => a.type === 'bank_account'),
      cash: live.filter((a: Account) => a.type === 'cash'),
      ewallet: live.filter((a: Account) => a.type === 'e_wallet'),
      // Debit cards, rewards wallets, and anything the user defined themselves. Grouped rather
      // than dropped so the Assets total matches the money the user actually holds.
      other: live.filter((a: Account) =>
        a.type === 'debit_card' || a.type === 'rewards' || isCustomType(a.type)
      ),
    };
  }, [activeAccounts]);

  const liquidAccounts = useMemo(
    () => [...liquidGroups.bank, ...liquidGroups.cash, ...liquidGroups.ewallet, ...liquidGroups.other],
    [liquidGroups]
  );

  // A rewards account with a `rewardUnit` is denominated in points/miles, not rupees — adding it
  // to a ₹ total would be meaningless, so it contributes 0 (the row still shows its point balance).
  const isPointsDenominated = (a: Account) => a.type === 'rewards' && !!a.rewardUnit;

  const getLiquidBalanceAt = (account: Account, month: string) => {
    if (isPointsDenominated(account)) return 0;
    let bal = calculateBalance(account, data.transactions, month);
    // An NCMC-enabled debit card carries a second, separate travel-wallet balance. It's real
    // money on the card, so it counts toward the account's contribution.
    if (account.isNcmcEnabled) {
      bal += calculateBalance(account, data.transactions, month, true);
    }
    return bal;
  };
  const getLiquidBalance = (account: Account) => getLiquidBalanceAt(account, currentMonth);

  // 'YYYY-MM' one month back. Done by hand rather than with date-fns because constructing a Date from
  // the string and subtracting would drag timezone handling into what is pure string arithmetic.
  const previousMonthStr = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  };

  const liquidTotals = useMemo(() => {
    const sum = (accts: Account[]) => accts.reduce((s, a) => s + getLiquidBalance(a), 0);
    return {
      all: sum(liquidAccounts),
      bank: sum(liquidGroups.bank),
      cash: sum(liquidGroups.cash),
      ewallet: sum(liquidGroups.ewallet),
      other: sum(liquidGroups.other),
    };
  }, [liquidGroups, liquidAccounts, data.transactions, currentMonth]);

  // How much the liquid balances actually moved this month: this month's closing balance less last
  // month's. It's the one fact about cash the headline total can't tell you, which is what earns it a
  // place in the Assets strip beside the account count.
  const liquidMonthChange = useMemo(() => {
    const prev = previousMonthStr(currentMonth);
    const delta = (accts: Account[]) =>
      accts.reduce((s, a) => s + getLiquidBalanceAt(a, currentMonth) - getLiquidBalanceAt(a, prev), 0);
    return {
      all: delta(liquidAccounts),
      bank: delta(liquidGroups.bank),
      cash: delta(liquidGroups.cash),
      ewallet: delta(liquidGroups.ewallet),
      other: delta(liquidGroups.other),
    };
  }, [liquidGroups, liquidAccounts, data.transactions, currentMonth]);

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      setError(null);

      const items = [
        ...mfAccounts.map((a: Account) => ({ symbol: a.marketSymbol || '', kind: 'mf' as const })),
        ...stockAccounts.map((a: Account) => ({ symbol: a.marketSymbol || '', kind: 'stock' as const }))
      ].filter(i => i.symbol);

      // Skip accounts with a manual price override — no need to spend a Gemini call for them.
      const commodityItems = commodityAccounts.filter((a: Account) => a.marketSymbol && a.manualPricePerGram === undefined);

      if (items.length === 0 && commodityItems.length === 0) {
        setIsRefreshing(false);
        return;
      }

      const [newPrices, commodityPriceResults] = await Promise.all([
        fetchPricesForSymbols(items),
        // Non-forced: respects the 1h commodity cache, so repeated manual refreshes don't keep
        // calling Gemini — a call happens only when the estimate is older than its TTL.
        Promise.all(commodityItems.map((a: Account) =>
          fetchCommodityPriceINR(a.marketSymbol!).then(p => [a.marketSymbol!, p] as [string, number | null])
        ))
      ]);
      commodityPriceResults.forEach(([sym, p]) => { if (p !== null) newPrices[sym] = p; });
      // Merge over previous values so a symbol whose fetch failed keeps its last-known price
      // instead of dropping back to 0.
      setPrices(prev => ({ ...prev, ...newPrices }));

      // "Last refresh at" = the most recent real fetch across stocks/MFs AND commodities, so a
      // commodity-only refresh (its Gemini call) moves the timestamp too.
      const latest = Math.max(
        getLatestFetchedAt(items.map(i => i.symbol)) ?? 0,
        getLatestCommodityFetchedAt(commodityItems.map((a: Account) => a.marketSymbol!)) ?? 0
      );
      if (latest > 0) setLastRefreshed(new Date(latest));

      const newPrevPrices = await fetchPrevClosesForSymbols(items);
      commodityItems.forEach((a: Account) => {
        const p = getCachedPrevCommodityPriceINR(a.marketSymbol!);
        if (p !== null) newPrevPrices[a.marketSymbol!] = p;
      });
      setPrevPrices(prev => ({ ...prev, ...newPrevPrices }));
      // Mark that we've done a full refresh today, so the next same-day load shows the cached
      // 1-day return immediately instead of hiding it.
      try { localStorage.setItem(WEALTH_REFRESH_DAY_KEY, currentDayStr()); } catch { /* ignore */ }
    } catch (e: any) {
      console.error('Failed to refresh prices:', e);
      setError(`Price refresh failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsRefreshing(false);
      setHasRefreshed(true);
    }
  };

  useEffect(() => {
    handleRefresh();
  }, [mfAccounts, stockAccounts, commodityAccounts]);

  // Resolve real logos for any stock/MF/liquid account the static registry misses (one cached
  // Gemini lookup each, in the background), and re-render when one lands. Both ensure* calls are
  // no-ops for anything already covered by a registry, already cached, or already in flight, so
  // re-running this effect on every account change is cheap.
  useEffect(() => {
    const onLogosUpdated = () => setLogoTick(t => t + 1);
    window.addEventListener(LOGOS_UPDATED_EVENT, onLogosUpdated);
    [...mfAccounts, ...stockAccounts].forEach(acc => { ensureAssetLogo(acc); });
    liquidAccounts.forEach(acc => { ensureLiquidLogo(acc); });
    return () => window.removeEventListener(LOGOS_UPDATED_EVENT, onLogosUpdated);
  }, [mfAccounts, stockAccounts, liquidAccounts]);

  useEffect(() => {
    if (!selectedAsset) {
      setHistoryData([]);
      return;
    }

    const loadHistory = async () => {
      setHistoryLoading(true);
      const symbol = selectedAsset.marketSymbol || '';
      let history: HistoryDataPoint[] = [];

      if (selectedAsset.type === 'stocks') {
        history = await fetchStockHistory(symbol, stockRange);
      } else if (selectedAsset.type === 'mutual_funds') {
        const fullHistory = await fetchMFNavHistory(symbol);
        const range = mfRange === 'all' ? 'all' : mfRange;
        history = sliceHistoryByRange(fullHistory, range);
      }

      setHistoryData(history);
      setHistoryLoading(false);
    };

    loadHistory();
  }, [selectedAsset, stockRange, mfRange]);

  const getTotalUnits = (account: Account) =>
    Number(account.numberOfShares ?? 0) +
    data.transactions
      .filter((t: any) => t.accountId === account.id && t.numberOfShares !== undefined)
      .reduce((sum: number, t: any) => t.type === 'credit' ? sum + Number(t.numberOfShares ?? 0) : sum - Number(t.numberOfShares ?? 0), 0);

  const getAccountStats = (account: Account) => {
    if (account.type === 'epf') {
      const proj = calculateEPFProjection(account);
      return {
        totalUnits: 1,
        totalInvested: 0,
        currentValue: proj.balance,
        totalReturn: 0,
        totalReturnPct: 0,
        currentPrice: proj.balance
      };
    }
    const symbol = account.marketSymbol || '';
    const currentPrice = account.manualPricePerGram ?? prices[symbol] ?? 0;
    return getInvestmentAccountStats(account, data.transactions, currentPrice);
  };

  const getOneDayReturn = (account: Account) => {
    if (historyData.length < 2) return null;
    const totalUnits = getTotalUnits(account);
    const latest = historyData[historyData.length - 1].close;
    const prev = historyData[historyData.length - 2].close;
    const perUnitChange = latest - prev;
    const amount = perUnitChange * totalUnits;
    const pct = prev > 0 ? (perUnitChange / prev) * 100 : 0;
    return { amount, pct, perUnitChange };
  };

  const formatFullCurrency = (value: number) =>
    `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const buildStats = (accounts: Account[]) => {
    const invested = accounts.reduce((sum, acc) => sum + getAccountStats(acc).totalInvested, 0);
    const current = accounts.reduce((sum, acc) => sum + getAccountStats(acc).currentValue, 0);
    const pnl = current - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    return { invested, current, pnl, pnlPct };
  };

  // Market investments only — Portfolio's own numbers. EPF and liquid cash are tracked separately
  // because neither has an "invested vs. current" story.
  const marketAccounts = useMemo(
    () => [...mfAccounts, ...stockAccounts, ...commodityAccounts],
    [mfAccounts, stockAccounts, commodityAccounts]
  );

  const portfolioStats = useMemo(() => ({
    all: buildStats(marketAccounts),
    mf: buildStats(mfAccounts),
    stocks: buildStats(stockAccounts),
    commodity: buildStats(commodityAccounts),
  }), [marketAccounts, mfAccounts, stockAccounts, commodityAccounts, prices, data.transactions]);

  const retirementTotals = useMemo(() => {
    const projections = epfAccounts.map((a: Account) => calculateEPFProjection(a));
    return {
      balance: projections.reduce((s, p) => s + p.balance, 0),
      accruedInterest: projections.reduce((s, p) => s + p.accruedInterest, 0),
      projectedOneYearBalance: projections.reduce((s, p) => s + p.projectedOneYearBalance, 0),
      monthlyCredit: projections.reduce(
        (s, p) => s + p.employeeContribution + p.employerEPFContribution + p.employerEPSContribution,
        0
      ),
      employeeContribution: projections.reduce((s, p) => s + p.employeeContribution, 0),
      employerEPFContribution: projections.reduce((s, p) => s + p.employerEPFContribution, 0),
      employerEPSContribution: projections.reduce((s, p) => s + p.employerEPSContribution, 0),
    };
  }, [epfAccounts]);

  // The interest rate EPF is currently accruing at. Sourced from the engine (which honours a
  // per-account override) instead of hardcoding 8.25%, so a customised account isn't misreported.
  // Distinct rates across accounts have no single answer, so the spread is shown rather than a
  // number that would be wrong for at least one of them.
  const retirementRateLabel = useMemo(() => {
    const fy = getFinancialYearForDate(currentMonth);
    const rates = Array.from(
      new Set(epfAccounts.map((a: Account) => getEPFInterestRate(fy, a.interestRateOverrides)))
    ).sort((x, y) => x - y);
    if (rates.length === 0) return '—';
    if (rates.length === 1) return `${rates[0]}%`;
    return `${rates[0]}–${rates[rates.length - 1]}%`;
  }, [epfAccounts, currentMonth]);

  // The headline figure: every category summed. Liquid cash is included, so this is gross wealth —
  // credit-card outstanding and tracked debts are NOT subtracted.
  const totalWealth = portfolioStats.all.current + liquidTotals.all + retirementTotals.balance;

  const oneDayReturnFor = (accounts: Account[]) => {
    let amount = 0;
    let prevTotal = 0;
    for (const acc of accounts) {
      const symbol = acc.marketSymbol || '';
      const currentPrice = acc.manualPricePerGram ?? prices[symbol] ?? 0;
      const prevPrice = prevPrices[symbol];
      if (!prevPrice || currentPrice === 0) continue;
      const units = getTotalUnits(acc);
      amount += (currentPrice - prevPrice) * units;
      prevTotal += prevPrice * units;
    }
    if (prevTotal === 0) return null;
    return { amount, pct: (amount / prevTotal) * 100 };
  };

  // On the tree the 1-day figure always covers the whole Portfolio; inside the Portfolio sub-view
  // it follows the active filter pill.
  const wealthOneDayReturn = useMemo(
    () => oneDayReturnFor(marketAccounts),
    [marketAccounts, prices, prevPrices, data.transactions]
  );

  const filteredPortfolioOneDayReturn = useMemo(() => {
    const byFilter = {
      all: marketAccounts, mf: mfAccounts, stocks: stockAccounts, commodity: commodityAccounts,
    }[portfolioFilter];
    // An empty class means the filter is stale (that class was archived) — the whole-Portfolio
    // figure is the honest fallback, matching the sub-view's own filter guard.
    return oneDayReturnFor(byFilter.length > 0 ? byFilter : marketAccounts);
  }, [portfolioFilter, marketAccounts, mfAccounts, stockAccounts, commodityAccounts, prices, prevPrices, data.transactions]);

  const displayRefreshedAt = useMemo(() => {
    if (!lastRefreshed) return null;
    const onlyStr = (arr: (string | undefined)[]) => arr.filter((s): s is string => !!s);
    const mfSyms = onlyStr(mfAccounts.map((a: Account) => a.marketSymbol));
    const stockSyms = onlyStr(stockAccounts.map((a: Account) => a.marketSymbol));
    const metalTickers = onlyStr(
      commodityAccounts
        .filter((a: Account) => a.manualPricePerGram === undefined)
        .map((a: Account) => a.marketSymbol)
    );
    let ts: number | null;
    if (portfolioFilter === 'mf') ts = getLatestFetchedAt(mfSyms);
    else if (portfolioFilter === 'stocks') ts = getLatestFetchedAt(stockSyms);
    else if (portfolioFilter === 'commodity') ts = getLatestCommodityFetchedAt(metalTickers);
    else ts = Math.max(
      getLatestFetchedAt([...mfSyms, ...stockSyms]) ?? 0,
      getLatestCommodityFetchedAt(metalTickers) ?? 0
    ) || null;
    return ts && ts > 0 ? new Date(ts) : lastRefreshed;
  }, [portfolioFilter, lastRefreshed, mfAccounts, stockAccounts, commodityAccounts]);

  // Whole rupees, for the root screen only. The headline and the three category cards are summaries
  // where paise are noise; every inner category and detail screen uses the shared formatCurrency so
  // its figures reconcile digit-for-digit with the Accounts tab.
  const formatWhole = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Which categories the user actually has. A category with no accounts gets no card on the tree
  // and no sub-view — a ₹0 chevron that opens an empty screen is a dead end, not information.
  const hasPortfolio = marketAccounts.length > 0;
  const hasAssets = liquidAccounts.length > 0;
  const hasRetirement = epfAccounts.length > 0;
  const hasAnyWealth = hasPortfolio || hasAssets || hasRetirement;

  // The 1-day return excludes commodities (no previous-day price). When commodities are part of
  // the "All" view, spell out which classes the figure actually covers so it's not mistaken for
  // the whole portfolio. Empty when there's nothing to clarify.
  const todayScope = [
    mfAccounts.length > 0 ? 'MF' : null,
    stockAccounts.length > 0 ? 'Stocks' : null,
  ].filter(Boolean).join(' + ');

  // "Tribhuvan's", or "Your" when we have no name to work with. Built once because four hero labels
  // now use it — the tree's total plus each category screen's — and they have to stay in step.
  const firstName = data.user?.name?.split(' ')[0];
  const userPossessive = firstName ? `${firstName}'s` : 'Your';

  // Named for where the user goes to fix it, so the hint tells them what to do, not just what's
  // absent. Only rendered while at least one category exists — a brand-new user gets the full
  // empty state instead.
  // Kept to one word or two per category so the joined line stays readable — at most two can be
  // missing here, since all three missing means there are no accounts at all (the empty state).
  const missingCategoryHint = [
    !hasPortfolio ? 'investments' : null,
    !hasAssets ? 'cash accounts' : null,
    !hasRetirement ? 'EPF' : null,
  ].filter(Boolean).join(' or ');

  // Both list types enter a detail screen the same way: remember where the list was scrolled to, and
  // start the detail's own view state fresh rather than inheriting the last account's.
  //
  // All three ranges are reset, not just the balance one. Only balanceRange used to be, so a stock
  // detail silently inherited whatever window you had left on a different holding while a bank
  // account never did — one pill row, two behaviours. Each goes back to the first pill in its own
  // row, so the lit pill on entry is always the leading one.
  const openAssetDetail = (account: Account) => {
    const appRoot = document.querySelector('.app-root');
    scrollRef.current.category = appRoot?.scrollTop ?? 0;
    setBalanceRange((isPointsDenominated(account) ? POINTS_BALANCE_RANGES : BALANCE_RANGES)[0]);
    setStockRange(STOCK_RANGES[0]);
    setMFRange(MF_RANGES[0]);
    setSelectedAsset(account);
  };

  const renderHoldingRow = (account: Account, metric: HoldingMetric = 'value') => {
    const stats = getAccountStats(account);
    const positive = stats.totalReturn >= 0;
    // EPF is priceless in the literal sense — no market symbol, no invested basis — so its row stays
    // a plain balance no matter where the cycler sits. It's also never in a cycler-bearing list.
    const isEpf = account.type === 'epf';
    // Reuses the same helper the hero totals use, so a row and the headline above it can never
    // disagree about what "today" means. Null when there's no previous close to compare against.
    const oneDay = !isEpf && metric === 'oneDay' ? oneDayReturnFor([account]) : null;
    // Without a live price `currentValue` is 0, and the return would read as a total loss of money
    // that hasn't gone anywhere — the same guard the Portfolio metric strip applies.
    const priced = stats.currentValue > 0;
    // The figure behind whichever change metric is active, or null when this holding can't answer
    // it. `value` is the odd one out (two unsigned figures, not a change) and renders separately.
    const change =
      metric === 'oneDay' ? (oneDay && { amount: oneDay.amount, pct: oneDay.pct, up: oneDay.amount >= 0 })
        : metric === 'returns' ? (priced ? { amount: stats.totalReturn, pct: stats.totalReturnPct, up: positive } : null)
          : null;
    return (
      <div
        key={account.id}
        onClick={() => openAssetDetail(account)}
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
        <LogoAvatar name={account.name} logoUrl={getAssetLogoUrl(account)} size={42} metal={account.type === 'commodity' ? (account.commodityMetal === 'silver' ? 'silver' : 'gold') : undefined} isEpf={account.type === 'epf'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '0.92rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            lineHeight: 1.3
          }}>
            {account.name}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {/* Both change metrics read the same way — a signed rupee figure over its percentage — so
            they share one renderer. No "1D" tag on the row: the pill on the section header already
            names the metric, and repeating it on every line only crowds the number. */}
          {!isEpf && change ? (
            <>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: change.up ? '#22c55e' : '#ef4444' }}>
                {signedAmount(change.up, formatCurrency(Math.abs(change.amount)))}
              </div>
              <div className="text-mono" style={{ fontSize: '0.7rem', fontWeight: 600, color: change.up ? '#22c55e' : '#ef4444', opacity: 0.9, marginTop: '0.15rem', letterSpacing: '0.5px' }}>
                {Math.abs(change.pct).toFixed(2)}%
              </div>
            </>
          ) : !isEpf && metric !== 'value' ? (
            // Nothing to compare against: a holding whose previous close never arrived, or one with
            // no live price at all. Better a dash than a ₹0 that reads as a genuinely flat day.
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-secondary)' }}>—</div>
          ) : (
            <>
              <div style={{
                fontSize: '0.95rem',
                fontWeight: 700,
                color: isEpf ? 'var(--text-primary)' : (positive ? '#22c55e' : '#ef4444')
              }}>
                {formatCurrency(stats.currentValue)}
              </div>
              {!isEpf && (
                <div style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  marginTop: '0.15rem'
                }}>
                  {formatCurrency(stats.totalInvested)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // A liquid account has no market price and no invested basis, so its detail screen is built from
  // its own ledger instead: a balance history, the month's flows, and recent activity.
  const ACCOUNT_TYPE_SUBTEXT: Record<string, string> = {
    bank_account: 'Bank Account',
    cash: 'Physical Wallet',
    e_wallet: 'E-Wallet',
    debit_card: 'Debit Card',
    rewards: 'Rewards Wallet',
  };

  const renderLiquidRow = (account: Account) => {
    const points = isPointsDenominated(account);
    const bal = calculateBalance(account, data.transactions, currentMonth);
    const travelBal = account.isNcmcEnabled
      ? calculateBalance(account, data.transactions, currentMonth, true)
      : null;
    // Custom types carry no friendly label, so title-case the raw type ('chit_fund' → 'Chit Fund').
    const subtext = ACCOUNT_TYPE_SUBTEXT[account.type]
      || account.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return (
      <div
        key={account.id}
        onClick={() => openAssetDetail(account)}
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
        <LogoAvatar name={account.name} logoUrl={getLiquidLogoUrl(account)} size={42} accountType={account.type} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {account.name}
          </div>
          <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.2rem', letterSpacing: '0.5px' }}>
            {subtext}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {points
              ? `${bal.toLocaleString('en-IN')} ${account.rewardUnit}`
              : formatCurrency(bal)}
          </div>
          {travelBal !== null && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              + {formatCurrency(travelBal)} travel
            </div>
          )}
          {points && (
            <div className="text-mono uppercase" style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '0.2rem', letterSpacing: '0.5px' }}>
              Not in total
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCategoryCard = ({ icon, label, subtext, value, valueNote, onClick, tourClass }: {
    icon: ReactNode;
    label: string;
    subtext: string;
    value: string;
    valueNote?: ReactNode;
    onClick: () => void;
    tourClass: string;
  }) => (
    // Uses .card rather than a bespoke shell: that's what carries the app's NeoPOP treatment —
    // 4px radius, the hard `4px 4px 0 #000` edge, and the lift-on-hover / press-down-on-tap
    // transitions. These cards previously hand-rolled a 1rem-radius, shadowless box and leaned on a
    // `clickable` class that has no CSS rule, so they read as flat panels from a different app and
    // gave no feedback on tap despite being the primary navigation on this screen.
    <div
      className={`card ${tourClass}`}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        padding: '1.15rem 1.25rem',
        minHeight: '92px',
        boxSizing: 'border-box',
        cursor: 'pointer'
      }}
    >
      {/* Square-cornered tile with its own hard edge, echoing .badge-scalloped — the soft circle it
          replaced was the only rounded-pill shape on the screen. */}
      <div style={{
        width: '44px',
        height: '44px',
        borderRadius: '4px',
        background: 'var(--bg-card-elevated)',
        border: '1px solid var(--border-color)',
        boxShadow: '3px 3px 0 #000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: 'var(--accent)'
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="text-mono uppercase" style={{ fontSize: '0.74rem', fontWeight: 800, letterSpacing: '1.5px', color: 'var(--text-primary)' }}>
          {label}
        </div>
        <div style={{
          fontSize: '0.72rem',
          color: 'var(--text-secondary)',
          marginTop: '0.25rem',
          lineHeight: 1.4,
          // The text column is only ~110px wide, so a two-word subtext wraps. Breaking only on
          // spaces keeps "E-Wallets"-style labels intact; the card's minHeight absorbs the extra
          // line so all three cards stay the same height.
          overflowWrap: 'normal',
          wordBreak: 'keep-all'
        }}>
          {subtext}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {/* text-serif: every other figure in the app is set in the serif face (the wealth hero above,
            account balances, holding values). A plain sans number here broke that. */}
        <div className="text-serif" style={{ fontSize: '1.15rem', color: 'var(--text-primary)' }}>{value}</div>
        {valueNote}
      </div>
      <ChevronRight size={18} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
    </div>
  );

  const openCategory = (next: WealthCategory) => {
    const appRoot = document.querySelector('.app-root');
    scrollRef.current.tree = appRoot?.scrollTop ?? 0;
    setCategory(next);
    // Every sub-view opens in its resting state — All, showing Current (Invested) — rather than
    // resuming whatever was selected on the last visit. The narrowed view is a thing you go and do,
    // not a setting: re-entering to a filtered list reads as a screen missing half its holdings,
    // and the total in the hero silently means something narrower than "Portfolio".
    // Drilling into a holding and coming back is NOT this path, so that still keeps its filter.
    setPortfolioFilter('all');
    setAssetsFilter('all');
    setHoldingMetric('value');
  };

  useEffect(() => {
    const handleBack = (e: Event) => {
      // Unwinds one level at a time, innermost first: holding detail → sub-view → tree.
      if (selectedAsset) {
        e.preventDefault();
        setSelectedAsset(null);
      } else if (category) {
        e.preventDefault();
        setCategory(null);
      }
    };
    window.addEventListener('appBackButton', handleBack);
    return () => window.removeEventListener('appBackButton', handleBack);
  }, [selectedAsset, category]);

  useEffect(() => {
    const appRoot = document.querySelector('.app-root');
    if (!appRoot) return;
    // Descending starts at the top; coming back restores that level's saved position.
    const top = selectedAsset ? 0 : category ? scrollRef.current.category : scrollRef.current.tree;
    appRoot.scrollTo({ top, behavior: 'auto' });
  }, [selectedAsset, category]);

  // A category the user emptied (last account archived/deleted) while its sub-view was open would
  // otherwise leave them stranded on a blank screen.
  useEffect(() => {
    if (category === 'portfolio' && !hasPortfolio) setCategory(null);
    else if (category === 'assets' && !hasAssets) setCategory(null);
    else if (category === 'retirement' && !hasRetirement) setCategory(null);
  }, [category, hasPortfolio, hasAssets, hasRetirement]);

  // Shared chrome for EVERY Wealth sub-view — both the category views and the holding detail.
  // Deliberately carries no horizontal padding: that matches SubviewWrapper, Debts, Splits and
  // AccountStatement, which all sit the chevron at the page container's own padding with the title
  // beside it. Wealth used to add 1.5rem of its own here, putting its back button 24px further in
  // than every other screen's, and the holding detail hand-rolled a second, title-less variant.
  // `hideTitle` drops the label beside the chevron — for the category screens, whose hero right
  // below already opens with "<Name>'s <Category>", repeating the same word here was pure noise.
  // The holding-detail view still passes a title: it has no hero of its own to say where "back" goes.
  const renderSubviewHeader = (title: string, onBack: () => void, tourClass = '', hideTitle = false) => (
    // Stacked above the hero explicitly: the hero below overlaps this row's box (see marginTop in
    // renderCategoryHero), and without this the chevron's hit area would sit underneath it.
    <div className="flex align-center gap-4" style={{ position: 'relative', zIndex: 2, padding: hideTitle ? 0 : '0 0 0.25rem', boxSizing: 'border-box' }}>
      <button
        className={`btn btn-secondary ${tourClass}`}
        style={{ padding: '0.5rem', flexShrink: 0 }}
        onClick={onBack}
      >
        <ChevronLeft size={20} />
      </button>
      {!hideTitle && (
        <div className="text-mono uppercase" style={{ fontSize: '0.8rem', fontWeight: 800, letterSpacing: '2px', color: 'var(--text-primary)' }}>
          {title}
        </div>
      )}
    </div>
  );

  // The account's mark as the device impressed in the hero's wax seal. The wrapper is sized to the
  // avatar and nothing more on purpose: the seal centres itself on its parent, so the parent IS the
  // registration mark (see COMPOSITION in DetailHeroBackdrop). The mark is lifted over the wax, which
  // is what makes it read as pressed into the seal rather than sitting behind it.
  //
  // Only valid inside an identity block that follows a DetailHeroBand and lifts itself by
  // DETAIL_HERO_LIFT — that pairing is what puts this box inside the panel.
  const renderSealedMark = (logo: ReactNode) => (
    <div style={{
      position: 'relative',
      width: `${DETAIL_HERO_AVATAR}px`,
      height: `${DETAIL_HERO_AVATAR}px`,
      marginBottom: '1rem',
    }}>
      <DetailHeroSeal />
      <div style={{ position: 'relative', zIndex: 1 }}>{logo}</div>
    </div>
  );

  // The illustrated hero each category screen opens with: that category's own bas-relief engraving,
  // the user's avatar and "<Name>'s <Category>" over it, then the figures the category leads with.
  // Same treatment as the tree screen's hero, and for the same reason — position/overflow because
  // the drawing is absolutely positioned to this box and bleeds past the horizontal padding, and the
  // centring because each engraving is concentric about its own centre, so the content only lands on
  // the motif (inside the medallion, between the columns, inside the wreath) if both are centred in
  // the same box. See the COMPOSITION note in WealthCategoryBackdrops.
  const renderCategoryHero = (backdrop: ReactNode, label: string, minHeight: string, children: ReactNode) => (
    <div style={{
      position: 'relative',
      overflow: 'hidden',
      minHeight,
      // Pulls the whole hero up over the back button's row. That row is otherwise dead space —
      // the chevron is a small, left-aligned button with nothing beside it (see hideTitle above) —
      // while the hero's own content is horizontally centred, so the two never collide even
      // though they now overlap vertically.
      marginTop: '-28px',
      padding: '0 1.5rem 0.5rem',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center'
    }}>
      {backdrop}
      {/* One lifted wrapper, rather than a position/z-index on every figure inside it. */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        <ProfileAvatar size={56} />
        <div className="text-mono uppercase" style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '2px', color: 'var(--text-primary)', opacity: 0.85, margin: '0.85rem 0 0.8rem' }}>
          {userPossessive} {label}
        </div>
        {children}
      </div>
    </div>
  );

  const CATEGORY_LABELS: Record<WealthCategory, string> = {
    portfolio: 'Portfolio',
    assets: 'Assets',
    retirement: 'Retirement',
  };

  // A filter pill row. Pills are rendered only for classes the user actually holds, and the row
  // disappears entirely below two — a lone "All" pill filters nothing. `flexible` lets the row span
  // the available width instead of the fixed 68px-per-pill sizing, which overflows a narrow phone
  // once there are five pills (Assets can have ALL + four classes).
  const renderFilterPills = <T extends string>(
    tabs: { v: T; label: string }[],
    active: T,
    onSelect: (v: T) => void,
    opts: { marginTop: string; flexible?: boolean }
  ) => {
    if (tabs.length < 2) return null;
    const N = tabs.length;
    const activeIdx = Math.max(0, tabs.findIndex(t => t.v === active));
    const PAD = 4;
    return (
      <div className="tour-wealth-tabs" style={{
        position: 'relative',
        display: 'flex',
        marginTop: opts.marginTop,
        padding: `${PAD}px`,
        // No backdrop-filter on the track or the thumb below: this row mounts fresh on every
        // entry into a category screen, so its backdrop snapshot isn't ready for the first
        // paint(s) and the control visibly flashed see-through before the blur applied. The
        // --pill-* tokens carry the frost as a static veil instead, correct from frame one.
        background: 'var(--pill-track-bg)',
        borderRadius: '999px',
        border: '1px solid var(--pill-track-border)',
        ...(opts.flexible
          ? { width: '100%', maxWidth: `${N * 68}px` }
          : { width: `${N * 68}px` }),
      }}>
        <div style={{
          position: 'absolute',
          top: `${PAD}px`,
          bottom: `${PAD}px`,
          width: `calc((100% - ${PAD * 2}px) / ${N})`,
          left: `calc(${PAD}px + ${activeIdx} * (100% - ${PAD * 2}px) / ${N})`,
          borderRadius: '999px',
          background: 'var(--pill-thumb-bg)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.14)',
          transition: 'left 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)',
          pointerEvents: 'none'
        }} />
        {tabs.map(({ v, label }) => {
          const isActive = active === v;
          return (
            <button
              key={v}
              onClick={() => onSelect(v)}
              className="tour-wealth-tab-btn"
              data-view={v}
              style={{
                flex: 1,
                minWidth: 0,
                position: 'relative',
                zIndex: 1,
                padding: '0.5rem 0',
                border: 'none',
                background: 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderRadius: '999px',
                cursor: 'pointer',
                fontSize: '0.72rem',
                fontWeight: isActive ? 700 : 500,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '1px',
                textTransform: 'uppercase',
                transition: 'color 0.28s ease',
                whiteSpace: 'nowrap'
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  };

  // The metric cycler, rendered at the trailing end of a single-class section header. Tapping the
  // label steps forward; the chevrons step either way, so a three-stop cycle never needs two taps
  // to go back. Every tap stops propagation — the header row it sits in is itself a collapse toggle.
  // `metrics` is the subset this class can actually answer, so a stop that would only ever read "—"
  // is never cycled through rather than shown and then apologised for.
  const renderMetricCycler = (metrics: { v: HoldingMetric; label: string }[], active: HoldingMetric) => {
    const idx = Math.max(0, metrics.findIndex(m => m.v === active));
    const step = (delta: number) =>
      setHoldingMetric(metrics[(idx + delta + metrics.length) % metrics.length].v);
    const chevron = (dir: -1 | 1) => (
      <button
        onClick={e => { e.stopPropagation(); step(dir); }}
        aria-label={dir === 1 ? 'Next metric' : 'Previous metric'}
        style={{
          display: 'flex', alignItems: 'center', padding: 0, border: 'none',
          background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer'
        }}
      >
        {dir === 1 ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
      </button>
    );
    return (
      <div
        onClick={e => { e.stopPropagation(); step(1); }}
        className="clickable"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          flexShrink: 0,
          padding: '0.34rem 0.6rem',
          borderRadius: '999px',
          border: '1px solid var(--pill-track-border)',
          background: 'var(--pill-track-bg)',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <span className="text-mono uppercase" style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.8px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          {metrics[idx].label}
        </span>
        {chevron(-1)}
        {chevron(1)}
      </div>
    );
  };

  // LABEL · count · rule — the heading over every list on this screen. One definition on purpose:
  // the asset detail's "Recent Activity" heading used to hand-roll the same markup and had drifted a
  // gap step tighter, so the count sat almost against its label and read as a different system.
  // `null` drops the count entirely — for a heading over a list the user can't collapse or filter,
  // where the number says nothing they can't see in the rows right below it.
  const renderSectionHeading = (
    label: string,
    count: number | null,
    opts: { trailing?: ReactNode; chevron?: ReactNode; onClick?: () => void; marginBottom?: string | number } = {}
  ) => (
    <div
      // Tighter gap only when something trails the rule: label + count + rule + pill is a lot for a
      // narrow phone, and this row is the one place here that can't wrap.
      className={`flex align-center ${opts.trailing ? 'gap-2' : 'gap-3'}`}
      style={{
        cursor: opts.onClick ? 'pointer' : 'default',
        userSelect: 'none',
        marginBottom: opts.marginBottom ?? '0.25rem',
      }}
      onClick={opts.onClick}
    >
      <span className="text-mono uppercase" style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '1.5px', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {count !== null && (
        <span className="text-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.6 }}>
          {count}
        </span>
      )}
      {/* minWidth keeps the rule from collapsing to nothing when a long label and the cycler
        share the row on a narrow phone — it shrinks, but stays a visible connector. */}
      <div style={{ flex: 1, minWidth: '10px', height: '1px', background: 'var(--border-color)', opacity: 0.5 }} />
      {opts.trailing}
      {opts.chevron}
    </div>
  );

  // A collapsible, labelled group of rows. Collapsing is disabled when a filter has already
  // narrowed the list to this one class — there'd be nothing left on screen.
  const renderHoldingSection = (
    key: string,
    label: string,
    accounts: Account[],
    single: boolean,
    renderRow: (a: Account) => ReactNode,
    tourClass = '',
    // Sits at the trailing end of the header row, after the rule. Only the metric cycler uses it,
    // and only on a section the filter has already narrowed to — so it never competes with the
    // collapse chevron for that end of the row.
    trailing?: ReactNode
  ) => {
    const isCollapsed = single ? false : collapsedSections.has(key);
    return (
      <div className={tourClass} style={{ padding: '1.5rem 1.5rem 0.5rem' }}>
        {renderSectionHeading(label, accounts.length, {
          trailing,
          chevron: !single && (
            <ChevronDown size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0, transition: 'transform 0.2s ease', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} />
          ),
          onClick: single ? undefined : () => toggleSection(key),
          marginBottom: isCollapsed ? 0 : '0.25rem',
        })}
        {/* Called with one argument on purpose: passing `renderRow` straight to map would feed it
          the index too, which lands in renderHoldingRow's optional `metric` parameter. */}
        {!isCollapsed && <div>{accounts.map(a => renderRow(a))}</div>}
      </div>
    );
  };

  const metricCell = (label: ReactNode, value: ReactNode, color?: string) => (
    <div style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div className="text-mono uppercase" style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '0.4rem', lineHeight: 1.3 }}>
        {label}
      </div>
      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );

  const metricDivider = <div style={{ width: '1px', background: 'var(--border-color)' }} />;

  // The category screens keep the 1.5rem gutter their section headings use. A detail screen passes
  // DETAIL_GUTTER instead, so the strip's rules end where the chart above it does — its top and
  // bottom borders are the widest horizontal lines on that screen, and a border that stops 8px short
  // of the trend line is the most visible mismatch of the lot.
  //
  // `heading` names the window the figures cover. It sits INSIDE the top rule rather than above it:
  // a caption stranded between the range pills and the strip's border reads as a footnote to the
  // pills, and giving it a rule of its own would put two lines a few pixels apart.
  const metricStrip = (children: ReactNode, opts: { gutter?: string; heading?: string } = {}) => (
    <div style={{
      margin: `0 ${opts.gutter ?? '1.5rem'}`,
      padding: '1.25rem 0',
      borderTop: '1px solid var(--border-color)',
      borderBottom: '1px solid var(--border-color)',
    }}>
      {opts.heading && (
        // Centred, like the cells it labels: left-aligned it read as a heading for the whole screen
        // rather than a caption on this one strip.
        <div className="text-mono uppercase" style={{
          fontSize: '0.66rem', fontWeight: 800, letterSpacing: '1.5px',
          color: 'var(--text-muted)', marginBottom: '0.9rem', textAlign: 'center'
        }}>
          {opts.heading}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
        {children}
      </div>
    </div>
  );

  // ─────────────────── Liquid account detail (Assets → tap a row) ───────────────────

  // Everything that isn't a market holding, EPF, or a credit card — i.e. exactly what the Assets
  // sub-view lists. Typed by exclusion so a user-defined custom account type is covered too.
  const isLiquidAccount = (a: Account) =>
    a.type !== 'stocks' && a.type !== 'mutual_funds' && a.type !== 'commodity'
    && a.type !== 'epf' && a.type !== 'credit_card';

  // The ledger behind the balance this screen shows. A points wallet's balance moves on reward
  // legs; every other account's moves on rupee legs. Travel legs are excluded for the same reason
  // the hero shows the payments balance on its own: mixing the two wallets makes the flows below
  // fail to reconcile with the figure above them.
  const liquidLedgerFilter = (account: Account) => {
    const points = isPointsDenominated(account);
    return (t: Transaction) =>
      t.accountId === account.id && (points ? !!t.isRewardTransaction : affectsRupeeBalance(t));
  };

  const liquidBalanceAt = (account: Account, month: string) =>
    isPointsDenominated(account)
      ? calculateBalance(account, data.transactions, month, false, true)
      : calculateBalance(account, data.transactions, month);

  const monthTimestamp = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).getTime();
  };

  // Month-by-month closing balances, oldest first. Walks backwards from the current month and stops
  // at the account's first sign of life, so a three-month-old account draws three points rather than
  // six, five of them a flat line at its opening balance.
  const buildBalanceSeries = (account: Account, range: Exclude<BalanceRange, '1m'>): HistoryDataPoint[] => {
    const openingKeys = Object.keys(
      isPointsDenominated(account)
        ? (account.rewardOpeningBalances || {})
        : (account.openingBalances || {})
    );
    const txMonths = data.transactions
      .filter(liquidLedgerFilter(account))
      .map(t => t.date.slice(0, 7));
    const earliest = [...openingKeys, ...txMonths].sort()[0] || currentMonth;

    const months: string[] = [];
    let m = currentMonth;
    // The 'all' window is capped at BALANCE_RANGE_MONTHS rather than left unbounded: the loop is
    // also the guard against a stray future-dated opening balance never reaching `earliest`.
    while (months.length < BALANCE_RANGE_MONTHS[range]) {
      months.unshift(m);
      if (m <= earliest) break;
      m = previousMonthStr(m);
    }
    return months.map(mm => ({ date: monthTimestamp(mm), close: liquidBalanceAt(account, mm) }));
  };

  const isoDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // The last 30 days, one point per day. Built by walking backwards from the month-end balance and
  // undoing each day's movement, rather than forwards from a baseline: calculateBalance owns all the
  // opening-balance and adjustment logic, and re-deriving a start-of-window figure by hand would miss
  // an opening balance keyed to the current month.
  //
  // The last point is today's true balance, so it can sit below the hero when the user has logged a
  // transaction dated later this month. That's deliberate: the hero follows the app-wide month-end
  // convention (as do the Assets rows and totals), but a point plotted at today's date must not
  // include money that hasn't moved yet.
  const buildDailyBalanceSeries = (account: Account): HistoryDataPoint[] => {
    const deltas = new Map<string, number>();
    for (const t of data.transactions.filter(liquidLedgerFilter(account))) {
      deltas.set(t.date, (deltas.get(t.date) || 0) + (t.type === 'credit' ? t.amount : -t.amount));
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAILY_WINDOW_DAYS - 1));
    const todayStr = isoDay(today);

    // The month-end figure includes anything dated later this month, which hasn't happened yet as
    // far as today's point is concerned — take it back off before walking.
    let running = liquidBalanceAt(account, currentMonth);
    deltas.forEach((v, d) => {
      if (d.slice(0, 7) === currentMonth && d > todayStr) running -= v;
    });

    const out: HistoryDataPoint[] = [];
    const cursor = new Date(today);
    while (cursor.getTime() >= start.getTime()) {
      out.unshift({ date: cursor.getTime(), close: running });
      // Undo this day's movement to land on the previous day's closing balance.
      running -= deltas.get(isoDay(cursor)) || 0;
      cursor.setDate(cursor.getDate() - 1);
    }
    return out;
  };

  const renderLiquidDetail = (account: Account) => {
    const points = isPointsDenominated(account);
    const unit = account.rewardUnit || '';
    // Points have no paise and no ₹ sign; everything else formats as money.
    const fmt = (n: number) =>
      points ? `${Math.round(n).toLocaleString('en-IN')} ${unit}` : formatCurrency(n);

    const balance = liquidBalanceAt(account, currentMonth);
    const monthChange = balance - liquidBalanceAt(account, previousMonthStr(currentMonth));
    // Sub-paise drift is rounding noise, not a movement — same threshold as the Assets strip.
    const flat = Math.abs(monthChange) < 0.005;
    // An NCMC card's travel wallet is real money but a separate purse, so it's stated beside the
    // payments balance rather than folded into it.
    const travelBal = account.isNcmcEnabled
      ? calculateBalance(account, data.transactions, currentMonth, true)
      : null;
    const subtext = ACCOUNT_TYPE_SUBTEXT[account.type]
      || account.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const ledger = data.transactions.filter(liquidLedgerFilter(account));
    // In and Out are money earned and spent this month, NOT every rupee that crossed the account.
    // A transfer to another of the user's own accounts, a card bill payment, an SIP debit or a loan
    // repaid is the same money changing pockets, and a Passive Log is movement the user has told us
    // not to count — counting any of them inflates both figures without saying anything about the
    // month. Same rule as the Income / Spends pair on the Transactions screen, so filtering that
    // screen to this account and this month now agrees with this strip.
    const monthTxs = ledger.filter(t =>
      t.date.slice(0, 7) === currentMonth && !isStatsExcludedCategory(t.category));
    const flow = (type: Transaction['type']) =>
      monthTxs.filter(t => t.type === type).reduce((s, t) => s + statsAmount(t), 0);
    const inflow = flow('credit');
    const outflow = flow('debit');
    // Named, not "This month": the hero already owns that phrase for a figure these two don't add up
    // to, so repeating it would tie them together again. The month itself is also the more useful
    // label — it stays true in a screenshot.
    const monthLabel = new Date(monthTimestamp(currentMonth))
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    const shown = [...ledger]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .slice(0, 5);

    // 1M needs a rupee ledger to walk day by day, which is why a points wallet is offered the monthly
    // windows only — the same way the metric cycler drops a stop a class can't answer.
    const ranges = points ? POINTS_BALANCE_RANGES : BALANCE_RANGES;
    // Falls back to this row's own first pill, matching what openAssetDetail would have set. Still
    // needed as a guard: the pill row shrinks for a points wallet, so a 1M left over from a rupee
    // account — mid-session, before any reset — would name a range this screen doesn't offer.
    const range = ranges.includes(balanceRange) ? balanceRange : ranges[0];
    const daily = range === '1m';
    // Tested inline rather than through `daily` so the else branch narrows '1m' out of `range` —
    // buildBalanceSeries only accepts the month-counted windows.
    const series = range === '1m' ? buildDailyBalanceSeries(account) : buildBalanceSeries(account, range);
    const up = series.length > 1 && series[series.length - 1].close >= series[0].close;
    const lineColor = up ? '#22c55e' : '#ef4444';

    return (
      <div className="fade-in" style={{ boxSizing: 'border-box' }}>
        {renderSubviewHeader(category ? CATEGORY_LABELS[category] : 'Wealth', () => setSelectedAsset(null), '', true)}

        <DetailHeroBand />

        {/* Identity block — deliberately the same shape as a holding's, down to the lift that sets the
          mark into the panel above, so the two detail screens read as the same screen. The lift
          replaces the old -28px pull over the back button's row: the panel now covers that row. */}
        <div style={{ padding: '0 1.5rem 0.5rem', marginTop: `-${DETAIL_HERO_LIFT}px`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          {renderSealedMark(
            <LogoAvatar name={account.name} logoUrl={getLiquidLogoUrl(account)} size={DETAIL_HERO_AVATAR} accountType={account.type} />
          )}

          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35, maxWidth: '90%' }}>
            {account.name}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            {subtext}
          </div>

          <div className="text-serif" style={{ fontSize: '3rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '1.25rem', lineHeight: 1 }}>
            {fmt(balance)}
          </div>

          {/* Where a holding puts its 1-day change. A balance has no market to move it, so the
            honest equivalent is what the month did to it. */}
          <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '0.75rem', color: flat ? 'var(--text-secondary)' : monthChange > 0 ? '#22c55e' : '#ef4444' }}>
            {flat ? fmt(0) : signedAmount(monthChange > 0, fmt(Math.abs(monthChange)))}
          </div>
          <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.2rem', letterSpacing: '0.5px' }}>
            This month
          </div>

          {travelBal !== null && (
            <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.6rem', letterSpacing: '0.5px' }}>
              + {formatCurrency(travelBal)} travel wallet
            </div>
          )}
          {points && (
            <div className="text-mono uppercase" style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '0.6rem', letterSpacing: '0.5px' }}>
              Not counted in the Assets total
            </div>
          )}
        </div>

        {/* A single point is a dot, not a trend — below two months the chart is simply omitted. */}
        {series.length > 1 && (
          <>
            <div style={{ padding: '0 0 0.5rem', width: '100%', boxSizing: 'border-box' }}>
              {/* 220: 70px of it is the tooltip's reserve, and with no date axis below there's no
                30px axis strip to pay for either. The flows strip and activity list want the room. */}
              <div className="wealth-chart" style={{ width: '100%', height: '220px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 70, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="liquidChartFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    {/* Balances belong on a zero baseline: a ₹8,100→₹8,400 month auto-scaled to
                      dataMin/dataMax would draw a cliff out of a 4% move. The floor follows the data
                      below zero, so an overdrawn month isn't clipped off the bottom. */}
                    <YAxis domain={[(dataMin: number) => Math.min(0, dataMin), 'dataMax']} hide />
                    {/* Hidden, not removed: the axis still defines the horizontal scale and the
                      end padding that sets this screen's gutter. Its labels are dropped because
                      recharts thins them to whatever fits, which lands them at uneven intervals —
                      and the tooltip names the date of whatever point you touch anyway. */}
                    <XAxis dataKey="date" hide padding={{ left: CHART_END_PAD, right: CHART_END_PAD }} />
                    <Tooltip
                      position={{ y: 6 }}
                      offset={0}
                      // Recharts must place the wrapper exactly on the point, without clamping of
                      // its own — ChartTooltip does the clamping, and it knows about the centring
                      // transform that recharts' own edge maths can't see.
                      allowEscapeViewBox={{ x: true }}
                      cursor={false}
                      content={props => (
                        <ChartTooltip
                          {...props}
                          color={lineColor}
                          formatDate={ms => new Date(ms).toLocaleDateString('en-IN',
                            daily ? { day: 'numeric', month: 'short', year: '2-digit' } : { month: 'short', year: 'numeric' })}
                          formatValue={fmt}
                        />
                      )}
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke={lineColor}
                      strokeWidth={1.5}
                      fill="url(#liquidChartFill)"
                      dot={false}
                      activeDot={({ cx, cy }: { cx?: number; cy?: number }) => {
                        if (cx == null || cy == null) return <g />;
                        return (
                          <g>
                            {/* Meets the tooltip caret's tip: tooltip top y=6 plus its height. */}
                            <line x1={cx} y1={cy} x2={cx} y2={64} stroke={lineColor} strokeWidth={1.25} strokeDasharray="5 4" strokeOpacity={0.4} />
                            <circle cx={cx} cy={cy} r={3.5} fill={lineColor} />
                          </g>
                        );
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* No bottom rule here, unlike the holding screen's copy: the Income/Spends strip that
              follows opens with one of its own a few pixels below, and two parallel lines that close
              nothing between them just look like a mistake. */}
            <div style={{ padding: `0.75rem ${DETAIL_GUTTER} 0.5rem`, boxSizing: 'border-box' }}>
              <div className="no-scrollbar" style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', gap: '0.25rem' }}>
                {ranges.map(r => {
                  const isActive = range === r;
                  return (
                    <button
                      key={r}
                      onClick={() => setBalanceRange(r)}
                      style={{
                        padding: '0.4rem 0.9rem',
                        border: `1px solid ${isActive ? 'var(--border-color)' : 'transparent'}`,
                        background: isActive ? 'var(--bg-hover)' : 'transparent',
                        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                        borderRadius: '999px',
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                        fontWeight: isActive ? 700 : 500,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {r.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Two cells, no Net. It used to be left out because the net WAS the hero's "this month"
          figure; now it's left out because it isn't — the hero tracks the balance, which every
          transfer and passive log moves, while these two count only real income and spending. A third
          cell showing the difference would sit right below the hero inviting exactly that false
          comparison.

          Named Income/Spends, not In/Out: those two read as raw cash movement, which is what they
          used to be and why they once reconciled with the hero. Borrowing the Transactions screen's
          own words is what tells the user these are the stats figures, exclusions already applied.
          A points wallet earns and redeems rather than earning and spending, so it says so. */}
        <div style={{ marginTop: series.length > 1 ? '0.5rem' : '1rem' }}>
          {metricStrip(<>
            {metricCell(points ? 'Earned' : 'Income', fmt(inflow), inflow > 0 ? 'var(--success)' : undefined)}
            {metricDivider}
            {metricCell(points ? 'Redeemed' : 'Spends', fmt(outflow), outflow > 0 ? '#ef4444' : undefined)}
          </>, { gutter: DETAIL_GUTTER, heading: monthLabel })}
        </div>

        <div style={{ padding: `1.5rem ${DETAIL_GUTTER} 0.5rem` }}>
          {/* No count: this list is neither collapsible nor filtered, so the number only ever
            restated the rows immediately below it. */}
          {renderSectionHeading('Recent Activity', null)}

          {shown.length === 0 ? (
            <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-muted)', letterSpacing: '0.5px', textAlign: 'center', padding: '2rem 0', lineHeight: 1.6 }}>
              No transactions on this account yet
            </div>
          ) : (
            <>
              {shown.map(t => {
                const credit = t.type === 'credit';
                const [y, mo, d] = t.date.split('-').map(Number);
                return (
                  <div key={t.id} style={{ padding: '0.85rem 0', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                    <div className="flex-center" style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--bg-hover)', color: 'var(--text-secondary)', flexShrink: 0 }}>
                      {getCategoryIcon(t.category, 17)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.description}
                      </div>
                      <div className="text-mono uppercase" style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.2rem', letterSpacing: '0.5px' }}>
                        {new Date(y, mo - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {t.category}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, flexShrink: 0, color: credit ? '#22c55e' : 'var(--text-primary)' }}>
                      {credit ? '+' : '−'} {fmt(t.amount)}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: 'var(--bg-primary)', paddingBottom: '100px' }}>
      {/* ───────────────────────── Level 1: the category tree ───────────────────────── */}
      {!selectedAsset && !category && (
        <>
          {/* position/overflow exist for WealthBackdrop: the sketch is absolutely positioned to this box
          and bleeds past the horizontal padding, so it has to be clipped here.
          minHeight gives the backdrop room to draw at full size — its viewBox is square, so a short
          hero would scale it down by height and leave the arch small. justifyContent centring is what
          lands the avatar and total on the door's hub (see COMPOSITION in WealthBackdrop): the drawing
          is concentric about its own centre, so both must be centred in the same box. It also spends
          the dead space that used to sit below the cards. */}
          <div className="tour-wealth-summary" style={{ position: 'relative', overflow: 'hidden', minHeight: '400px', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            <WealthBackdrop />

            {/* Every hero element is lifted above the backdrop; the sketch is the only thing at z 0. */}
            <div style={{ position: 'relative', zIndex: 1, marginBottom: '1rem' }}>
              <ProfileAvatar size={64} />
            </div>

            <div className="text-mono uppercase" style={{ position: 'relative', zIndex: 1, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '2px', color: 'var(--text-primary)', opacity: 0.85, marginBottom: '0.75rem' }}>
              {userPossessive} Wealth
            </div>

            <div className="text-serif" style={{ position: 'relative', zIndex: 1, fontSize: '2.75rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              ₹{Math.round(totalWealth).toLocaleString('en-IN')}
            </div>

            {/* The daily figure can only ever cover market holdings — cash and EPF don't move with the
            market — so it's suppressed entirely when the user has no Portfolio. */}
            {/* Keyed off isRefreshing alone, NOT `&& !hasRefreshed`: the loader takes over for every
            in-flight refresh, including the manual ones fired from the Portfolio screen's Refresh
            prices button (this state is shared, so coming back out mid-fetch lands here). The root
            is a glance surface — a figure sitting here while a refresh runs is a number the user
            can't tell is stale, so we show the fetch instead and then render whatever it returns,
            identical value or not. */}
            {!hasPortfolio ? null : isRefreshing ? (
              <div style={{ position: 'relative', zIndex: 1, marginTop: '0.75rem', textAlign: 'center' }}>
                <div className="flex align-center justify-center text-mono" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', gap: '0.45rem' }}>
                  {/* size 12, not 13: the ring's ink is 5/6 of the icon box, so 12 makes it exactly as
                  tall as the 12px text's cap box — at 13 the two heights differ by 1px and no nudge can
                  centre them once the device rounds to whole pixels. translateY corrects Overpass Mono's
                  baseline, which rides high in a line-height:1 box. Same pair on the Refresh button. */}
                  <RotateCcw size={12} className="icon-spin-ccw" style={{ flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ lineHeight: 1, transform: 'translateY(1.25px)', display: 'inline-block' }}>Updating live prices...</span>
                </div>
                <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-primary)', opacity: 0.7, marginTop: '0.2rem', letterSpacing: '0.5px' }}>
                  Today{todayScope ? ` (${todayScope})` : ''}
                </div>
              </div>
            ) : wealthOneDayReturn !== null ? (
              <div style={{ position: 'relative', zIndex: 1, marginTop: '0.75rem', textAlign: 'center' }}>
                <div className="text-mono" style={{ fontSize: '0.9rem', fontWeight: 700, color: wealthOneDayReturn.amount >= 0 ? 'var(--success)' : '#ef4444' }}>
                  {/* Amount only. The root is a glance surface — the percentage lives on the Portfolio
                  screen, where it sits beside Invested and can actually be reasoned about. */}
                  {signedAmount(wealthOneDayReturn.amount >= 0, formatWhole(Math.abs(wealthOneDayReturn.amount)))}
                </div>
                <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-primary)', opacity: 0.7, marginTop: '0.2rem', letterSpacing: '0.5px' }}>
                  Today{todayScope ? ` (${todayScope})` : ''}
                </div>
              </div>
            ) : (mfAccounts.length > 0 || stockAccounts.length > 0) ? (
              <div className="text-mono uppercase" style={{ position: 'relative', zIndex: 1, fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.75rem', letterSpacing: '0.5px' }}>— today</div>
            ) : null}
          </div>

          {!hasAnyWealth ? (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <TrendingUp size={48} style={{ opacity: 0.5, margin: '0 auto 1rem' }} />
              <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Nothing to track yet</div>
              <div style={{ fontSize: '0.9rem' }}>Add a bank account, investment or EPF from the Accounts tab</div>
            </div>
          ) : (
            <div className="tour-wealth-categories" style={{ padding: '0.5rem 0 0', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {hasPortfolio && renderCategoryCard({
                icon: <TrendingUp size={20} />,
                label: 'Portfolio',
                // Fixed descriptors, not a list of what's present: a list changes length as accounts
                // are added, which re-wraps and leaves the three cards at different heights. Each is
                // short enough to wrap to exactly two lines in the ~100px text column.
                subtext: 'Market investments',
                value: formatWhole(portfolioStats.all.current),
                // P&L is only meaningful against a live valuation. With no mutual funds or stocks the
                // only holdings are commodities, whose ₹/gram comes from an AI estimate that may never
                // have been fetched — current then reads 0 and this claimed a −100% loss on money that
                // is still entirely there. Gating on `current > 0` rather than on account type also
                // covers a fund/stock portfolio whose prices haven't been refreshed yet.
                valueNote: portfolioStats.all.current > 0 ? (
                  <div className="text-mono" style={{ fontSize: '0.68rem', fontWeight: 700, marginTop: '0.25rem', color: portfolioStats.all.pnl >= 0 ? 'var(--success)' : '#ef4444' }}>
                    {signedAmount(portfolioStats.all.pnl >= 0, formatWhole(Math.abs(portfolioStats.all.pnl)))} TR
                  </div>
                ) : (
                  <div className="text-mono uppercase" style={{ fontSize: '0.58rem', fontWeight: 700, marginTop: '0.3rem', color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
                    Awaiting prices
                  </div>
                ),
                onClick: () => openCategory('portfolio'),
                tourClass: 'tour-wealth-cat-portfolio',
              })}

              {hasAssets && renderCategoryCard({
                icon: <Landmark size={20} />,
                label: 'Assets',
                subtext: 'Bank, Cash & Wallets',
                value: formatWhole(liquidTotals.all),
                valueNote: (() => {
                  const change = liquidMonthChange.all;
                  const flat = Math.abs(change) < 0.005;
                  return (
                    <div className="text-mono" style={{ fontSize: '0.68rem', fontWeight: 700, marginTop: '0.25rem', color: flat ? 'var(--text-secondary)' : change > 0 ? 'var(--success)' : '#ef4444' }}>
                      <span style={{ marginRight: '0.14em' }}>{flat ? '' : change > 0 ? '↑' : '↓'}</span>
                      {formatWhole(Math.abs(change))} MO
                    </div>
                  );
                })(),
                onClick: () => openCategory('assets'),
                tourClass: 'tour-wealth-cat-assets',
              })}

              {hasRetirement && renderCategoryCard({
                icon: <ShieldCheck size={20} />,
                label: 'Retirement',
                subtext: 'Provident Fund (EPF)',
                value: formatWhole(retirementTotals.balance),
                valueNote: (
                  <div className="text-mono" style={{ fontSize: '0.68rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--success)' }}>
                    <span style={{ marginRight: '0.14em' }}>↑</span>{formatWhole(retirementTotals.accruedInterest)} FY
                  </div>
                ),
                onClick: () => openCategory('retirement'),
                tourClass: 'tour-wealth-cat-retirement',
              })}

              {missingCategoryHint && (
                <div className="text-mono uppercase" style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.5px', textAlign: 'center', marginTop: '0.35rem', lineHeight: 1.6 }}>
                  Add {missingCategoryHint} from the Accounts tab
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ───────────────────────── Level 2a: Portfolio ───────────────────────── */}
      {!selectedAsset && category === 'portfolio' && (() => {
        const presentTabs = [
          mfAccounts.length > 0 ? { v: 'mf' as const, label: 'MF' } : null,
          stockAccounts.length > 0 ? { v: 'stocks' as const, label: 'Stocks' } : null,
          commodityAccounts.length > 0 ? { v: 'commodity' as const, label: 'Metals' } : null,
        ].filter((t): t is { v: 'mf' | 'stocks' | 'commodity'; label: string } => t !== null);
        const tabs: { v: PortfolioFilter; label: string }[] = presentTabs.length < 2
          ? []
          : [{ v: 'all', label: 'All' }, ...presentTabs];
        // A filter whose pill is gone (its asset class was archived/deleted) would show a ₹0 total
        // over an empty list, so fall back to All.
        const activeFilter: PortfolioFilter =
          tabs.length === 0 || tabs.some(t => t.v === portfolioFilter) ? portfolioFilter : 'all';
        const s = portfolioStats[activeFilter];
        const oneDay = filteredPortfolioOneDayReturn;
        // Any single class gets the cycler; "All" doesn't, because its rows would be comparing
        // figures across classes that aren't comparable.
        const showMetricCycler = activeFilter !== 'all';
        // Metals drop the 1D stop: a metal priced by an hourly AI estimate — or by hand — has no
        // dependable previous close, which is the same reason the hero hides their "today".
        const metrics = activeFilter === 'commodity'
          ? HOLDING_METRICS.filter(m => m.v !== 'oneDay')
          : HOLDING_METRICS;
        // Belt-and-braces: switching class already resets to 'value', so a metric this class can't
        // answer shouldn't be reachable — but deriving it here means a future change to that reset
        // can't leave Metals asking for a 1D figure that doesn't exist.
        const metric = metrics.some(m => m.v === holdingMetric) ? holdingMetric : 'value';
        // With the cycler hidden the rows fall back to their default Current (Invested), so a mixed
        // "All" list never inherits a metric the user picked while a single class was showing.
        const rowRenderer = showMetricCycler
          ? (a: Account) => renderHoldingRow(a, metric)
          : renderHoldingRow;
        const cycler = showMetricCycler ? renderMetricCycler(metrics, metric) : undefined;
        return (
          <div className="fade-in">
            {renderSubviewHeader('Portfolio', () => setCategory(null), 'tour-wealth-back', true)}

            {renderCategoryHero(<PortfolioBackdrop />, 'Portfolio', '360px', <>
              <div className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                {formatCurrency(s.current)}
              </div>

              {isRefreshing && !hasRefreshed ? null : oneDay !== null ? (
                <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: oneDay.amount >= 0 ? '#22c55e' : '#ef4444' }}>
                    {signedAmount(oneDay.amount >= 0, `₹${Math.abs(oneDay.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${Math.abs(oneDay.pct).toFixed(2)}%)`)}
                  </div>
                  <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.2rem', letterSpacing: '0.5px' }}>
                    Today{activeFilter === 'all' && commodityAccounts.length > 0 && todayScope ? ` (${todayScope})` : ''}
                  </div>
                </div>
              ) : activeFilter !== 'commodity' && (mfAccounts.length > 0 || stockAccounts.length > 0) ? (
                <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.75rem', letterSpacing: '0.5px' }}>— today</div>
              ) : null}

              <button
                onClick={() => handleRefresh()}
                disabled={isRefreshing}
                style={{
                  marginTop: '1.25rem',
                  padding: '0.55rem 1.25rem',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  borderRadius: '999px',
                  cursor: isRefreshing ? 'default' : 'pointer',
                  opacity: isRefreshing ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.5px'
                }}
              >
                {/* size 12 + the 1.25px nudge — see the loader on the Wealth root for why */}
                <RotateCcw size={12} className={isRefreshing ? 'icon-spin-ccw' : ''} style={{ flexShrink: 0, display: 'inline-block' }} />
                <span style={{ lineHeight: 1, transform: 'translateY(1.25px)', display: 'inline-block' }}>{isRefreshing ? 'Refreshing...' : 'Refresh prices'}</span>
              </button>

              {displayRefreshedAt && (
                <div className="text-mono uppercase" style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.6rem', letterSpacing: '0.5px' }}>
                  Last refresh at {formatTime(displayRefreshedAt)}
                </div>
              )}

              {/* Changing class resets the row metric: each class is a fresh list, and Current
                (Invested) is the figure that always makes sense on one. Carrying the previous
                choice over meant landing on Stocks already showing a metric you picked for MF. */}
              {renderFilterPills(tabs, activeFilter, v => { setPortfolioFilter(v); setHoldingMetric('value'); }, {
                marginTop: displayRefreshedAt ? '1.5rem' : '2.2rem',
              })}
            </>)}

            <div className="tour-wealth-holdings-section">
              <div className="tour-wealth-holdings-container">
                {/* No 'Current' cell: the headline above is the same `s.current`, so it tracked the
                  filter pills identically and simply repeated itself. Invested and Returns are the
                  two figures the headline does NOT already give you. */}
                {metricStrip(<>
                  {metricCell('Invested', formatCurrency(s.invested))}
                  {metricDivider}
                  <div style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div className="text-mono uppercase" style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Returns</div>
                    {/* Same guard as the Portfolio card: without a live valuation `current` is 0 and the
                      return reads as a total loss of money that hasn't gone anywhere. */}
                    {s.current > 0 ? (
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ position: 'relative', fontSize: '0.88rem', fontWeight: 700, color: s.pnl >= 0 ? 'var(--success)' : '#ef4444', lineHeight: 1.2 }}>
                          <span style={{ position: 'absolute', right: '100%', marginRight: '2px', fontWeight: 700 }}>
                            {s.pnl >= 0 ? '↑' : '↓'}
                          </span>
                          {formatCurrency(Math.abs(s.pnl))}
                        </div>
                        <div style={{ fontSize: '0.70rem', fontWeight: 600, color: s.pnl >= 0 ? 'var(--success)' : '#ef4444', opacity: 0.9, marginTop: '0.15rem' }}>
                          ({Math.abs(s.pnlPct).toFixed(2)}%)
                        </div>
                      </div>
                    ) : (
                      <div className="text-mono" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-secondary)' }}>—</div>
                    )}
                  </div>
                </>)}

                {error && (
                  <div style={{
                    padding: '1rem 1.5rem',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                    fontSize: '0.9rem',
                    margin: '1rem'
                  }}>
                    {error}
                  </div>
                )}

                {/* The cycler rides the section header. `cycler` is non-null only when a single-class
                  filter is active, and that filter leaves exactly one section on screen — so passing
                  it to all three can't put a pill on more than one header. */}
                {mfAccounts.length > 0 && (activeFilter === 'all' || activeFilter === 'mf') &&
                  renderHoldingSection('mf', 'Mutual Funds', mfAccounts, activeFilter !== 'all', rowRenderer, 'tour-wealth-holdings', cycler)}

                {stockAccounts.length > 0 && (activeFilter === 'all' || activeFilter === 'stocks') &&
                  renderHoldingSection('stocks', 'Stocks', stockAccounts, activeFilter !== 'all', rowRenderer, 'tour-wealth-holdings', cycler)}

                {commodityAccounts.length > 0 && (activeFilter === 'all' || activeFilter === 'commodity') &&
                  renderHoldingSection('commodity', 'Commodities', commodityAccounts, activeFilter !== 'all', rowRenderer, 'tour-wealth-holdings', cycler)}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ───────────────────────── Level 2b: Assets ───────────────────────── */}
      {!selectedAsset && category === 'assets' && (() => {
        const presentTabs = [
          liquidGroups.bank.length > 0 ? { v: 'bank' as const, label: 'Bank' } : null,
          liquidGroups.cash.length > 0 ? { v: 'cash' as const, label: 'Cash' } : null,
          liquidGroups.ewallet.length > 0 ? { v: 'ewallet' as const, label: 'Wallets' } : null,
          liquidGroups.other.length > 0 ? { v: 'other' as const, label: 'Other' } : null,
        ].filter((t): t is { v: 'bank' | 'cash' | 'ewallet' | 'other'; label: string } => t !== null);
        const tabs: { v: AssetsFilter; label: string }[] = presentTabs.length < 2
          ? []
          : [{ v: 'all', label: 'All' }, ...presentTabs];
        // A filter the user can't see (its group emptied) would silently show an empty list.
        const activeFilter: AssetsFilter =
          tabs.length === 0 || tabs.some(t => t.v === assetsFilter) ? assetsFilter : 'all';
        const single = activeFilter !== 'all';
        const pointsOnly = liquidAccounts.filter(isPointsDenominated).length;
        return (
          <div className="fade-in">
            {renderSubviewHeader('Assets', () => setCategory(null), 'tour-wealth-back', true)}

            {renderCategoryHero(<AssetsBackdrop />, 'Assets', '340px', <>
              <div className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                {formatCurrency(liquidTotals[activeFilter])}
              </div>
              <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.5rem', letterSpacing: '0.5px' }}>
                Cash &amp; funds available
              </div>

              {renderFilterPills(tabs, activeFilter, setAssetsFilter, { marginTop: '1.75rem', flexible: true })}
            </>)}

            {/* 'Total' used to sit here and simply repeated the headline above. Replaced with the
              month's net movement — the one thing about these balances the headline doesn't say. */}
            {metricStrip(<>
              {metricCell('Accounts', String(
                activeFilter === 'all' ? liquidAccounts.length : liquidGroups[activeFilter].length
              ))}
              {metricDivider}
              {(() => {
                const change = liquidMonthChange[activeFilter];
                // Sub-paise drift is noise, not a gain or a loss, so it stays uncoloured.
                const flat = Math.abs(change) < 0.005;
                return metricCell(
                  'This Month',
                  flat ? formatCurrency(Math.abs(change)) : signedAmount(change > 0, formatCurrency(Math.abs(change))),
                  flat ? undefined : change > 0 ? 'var(--success)' : '#ef4444'
                );
              })()}
            </>)}

            {liquidGroups.bank.length > 0 && (activeFilter === 'all' || activeFilter === 'bank') &&
              renderHoldingSection('bank', 'Bank Accounts', liquidGroups.bank, single, renderLiquidRow)}

            {liquidGroups.cash.length > 0 && (activeFilter === 'all' || activeFilter === 'cash') &&
              renderHoldingSection('cash', 'Physical Cash', liquidGroups.cash, single, renderLiquidRow)}

            {liquidGroups.ewallet.length > 0 && (activeFilter === 'all' || activeFilter === 'ewallet') &&
              renderHoldingSection('ewallet', 'E-Wallets', liquidGroups.ewallet, single, renderLiquidRow)}

            {liquidGroups.other.length > 0 && (activeFilter === 'all' || activeFilter === 'other') &&
              renderHoldingSection('other', 'Other Accounts', liquidGroups.other, single, renderLiquidRow)}

            {pointsOnly > 0 && (
              <div className="text-mono uppercase" style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.5px', textAlign: 'center', padding: '1.5rem', lineHeight: 1.6 }}>
                {pointsOnly} points-based {pointsOnly === 1 ? 'wallet is' : 'wallets are'} listed but excluded from the total
              </div>
            )}
          </div>
        );
      })()}

      {/* ───────────────────────── Level 2c: Retirement ───────────────────────── */}
      {!selectedAsset && category === 'retirement' && (
        <div className="fade-in">
          {renderSubviewHeader('Retirement', () => setCategory(null), 'tour-wealth-back', true)}

          {renderCategoryHero(<RetirementBackdrop />, 'Retirement', '360px', <>
            <div className="text-serif" style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              {formatCurrency(retirementTotals.balance)}
            </div>
            <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.5rem', letterSpacing: '0.5px' }}>
              Employee Provident Fund
            </div>
          </>)}

          {/* 'Current' used to sit here and simply repeated the headline above. The accruing rate is
              the fact the headline can't carry, and it pairs naturally with the interest earned. */}
          {metricStrip(<>
            {metricCell(<>Interest Rate<br />(Current FY)</>, retirementRateLabel)}
            {metricDivider}
            {metricCell(<>Interest Earned<br />(Current FY)</>, formatCurrency(retirementTotals.accruedInterest), 'var(--success)')}
          </>)}

          {/* The contribution/projection breakdown is deliberately NOT repeated here. It's per-account
              data, and the account's own detail view (tap a row below) already shows every line of it.
              Rendering it at category level as well duplicated the whole block on the common
              single-account setup, and would have read as a combined total once a second EPF account
              existed — which it isn't; retirementTotals sums them. */}

          {/* Per-account rows — the full passbook (wage ceiling, salary revisions, adjustments)
              lives in each account's own detail view. */}
          {renderHoldingSection('epf', 'EPF Accounts', epfAccounts, epfAccounts.length === 1, renderHoldingRow)}
        </div>
      )}

      {/* A liquid account takes its own branch rather than falling through below: getAccountStats is
        built on invested-vs-current, which a bank balance has no version of. */}
      {selectedAsset && isLiquidAccount(selectedAsset) && renderLiquidDetail(selectedAsset)}

      {selectedAsset && !isLiquidAccount(selectedAsset) && (() => {
        const stats = getAccountStats(selectedAsset);
        const oneDay = getOneDayReturn(selectedAsset);
        // This holding's OWN last fetch time, not the Portfolio-wide max shown in the sub-view header.
        // Commodities live under a cINR_ cache key; a manual ₹/g override has no fetch time at all.
        const isManualCommodity = selectedAsset.type === 'commodity' && selectedAsset.manualPricePerGram !== undefined;
        const selectedFetchedAt = !selectedAsset.marketSymbol || isManualCommodity ? null
          : selectedAsset.type === 'commodity'
            ? getLatestCommodityFetchedAt([selectedAsset.marketSymbol])
            : getCacheFetchedAt(selectedAsset.marketSymbol);
        // Same condition the chart block below keys off — the header spacing depends on it.
        const hasPriceChart = selectedAsset.type !== 'commodity' && selectedAsset.type !== 'epf';
        // On an intraday window every point falls on the same day (1D) or repeats each day seven-odd
        // times (5D), so the tooltip names the time instead of restating the date. It matters more now
        // that 1D is where a stock opens: a column of identical "13 Aug 26" labels was survivable when
        // you had to go looking for it.
        const intradayLabel = selectedAsset.type === 'stocks' && INTRADAY_STOCK_RANGES.has(stockRange);
        const formatPointLabel = (ms: number) => {
          const d = new Date(ms);
          const time = () => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
          if (!intradayLabel) return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
          // 1D is one day by definition, so the date would be noise; 5D still needs it to place the point.
          return stockRange === '1d'
            ? time()
            : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time()}`;
        };
        return (
          <div className="fade-in" style={{ boxSizing: 'border-box' }}>
            <div
              style={{
                boxSizing: 'border-box'
              }}
            >
              {/* Title hidden: the asset's own name/logo right below already says what this screen is,
                so the category label would only repeat it. The chevron alone still says where "back" goes. */}
              {renderSubviewHeader(category ? CATEGORY_LABELS[category] : 'Wealth', () => setSelectedAsset(null), '', true)}

              {/* Asset identity — centered, CRED style. Pulled up over the back button's row, same as
                renderCategoryHero: that row is dead space once its title is hidden — just a small,
                left-aligned chevron — so it can overlap this centered content without collision. */}
              {/* Tighter bottom padding when a chart follows: the chart already reserves 70px above its
                plot for the tooltip pill, so the full 1.5rem stacked on top of that read as dead space
                between "Last refresh at" and the pill. Commodity/EPF have no chart, so they keep it. */}
              <DetailHeroBand />

              {/* Lifted into the panel above, as on the liquid detail — see renderSealedMark. */}
              <div style={{ padding: `0 1.5rem ${hasPriceChart ? '0.5rem' : '1.5rem'}`, marginTop: `-${DETAIL_HERO_LIFT}px`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                {renderSealedMark(
                  <LogoAvatar name={selectedAsset.name} logoUrl={getAssetLogoUrl(selectedAsset)} size={DETAIL_HERO_AVATAR} metal={selectedAsset.type === 'commodity' ? (selectedAsset.commodityMetal === 'silver' ? 'silver' : 'gold') : undefined} isEpf={selectedAsset.type === 'epf'} />
                )}

                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35, maxWidth: '90%' }}>
                  {selectedAsset.name}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                  {selectedAsset.type === 'epf' ? 'Employee Provident Fund' : selectedAsset.type === 'mutual_funds' ? 'Mutual Fund' : selectedAsset.type === 'commodity' ? (selectedAsset.commodityMetal === 'silver' ? 'Silver' : 'Gold') : 'Stock'}
                </div>
                {selectedAsset.type === 'epf' && selectedAsset.currentEmployer && (
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', opacity: 0.8, marginTop: '0.2rem' }}>
                    {selectedAsset.currentEmployer}
                  </div>
                )}

                <div className="text-serif" style={{
                  fontSize: '3rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginTop: '1.25rem',
                  lineHeight: 1
                }}>
                  {selectedAsset.type === 'epf'
                    ? `₹${Math.round(stats.currentValue).toLocaleString('en-IN')}`
                    : selectedAsset.type === 'commodity'
                      ? `₹${(stats.currentPrice ?? 0).toFixed(2)}/g`
                      : `₹${(stats.currentPrice ?? 0).toFixed(2)}`
                  }
                </div>

                {oneDay ? (
                  <div style={{
                    fontSize: '1rem',
                    fontWeight: 600,
                    marginTop: '0.75rem',
                    color: oneDay.perUnitChange >= 0 ? '#22c55e' : '#ef4444'
                  }}>
                    {signedAmount(oneDay.perUnitChange >= 0, `₹${Math.abs(oneDay.perUnitChange).toFixed(2)} (${oneDay.pct >= 0 ? '+' : ''}${oneDay.pct.toFixed(2)}%)`)}
                  </div>
                ) : (selectedAsset.type === 'commodity' || selectedAsset.type === 'epf') ? null : (
                  <div style={{
                    fontSize: '1rem',
                    fontWeight: 600,
                    marginTop: '0.75rem',
                    color: stats.totalReturnPct >= 0 ? '#22c55e' : '#ef4444'
                  }}>
                    {stats.totalReturnPct >= 0 ? '+' : ''}₹{stats.totalReturn.toFixed(2)} ({stats.totalReturnPct.toFixed(2)}%)
                  </div>
                )}

                {(selectedFetchedAt || isManualCommodity) ? (
                  <div className="text-mono uppercase" style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '0.75rem', letterSpacing: '0.5px' }}>
                    {isManualCommodity ? 'Manual price' : `Last refresh at ${formatTime(new Date(selectedFetchedAt!))}`}
                  </div>
                ) : selectedAsset.type === 'epf' ? (
                  <div style={{ height: '0.75rem' }} />
                ) : null}
              </div>

              {/* Chart — CRED style: auto-scaled, no axes/grid clutter, thin trend line */}
              {!hasPriceChart ? null : historyLoading ? (
                <div style={{ padding: '0 0 0.5rem', width: '100%', boxSizing: 'border-box' }}>
                  {/* Mirrors the real chart's box: 250px tall, 70px of tooltip reserve on top. The
                    row of stub bars that used to stand in for date labels went with the axis —
                    a skeleton promising labels that never arrive is a layout shift. */}
                  <div style={{ width: '100%', height: '250px', padding: '70px 0 0', boxSizing: 'border-box' }}>
                    <div
                      className="skeleton-bar"
                      style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: 0,
                        clipPath: 'polygon(0% 72%, 5% 58%, 10% 64%, 15% 48%, 20% 56%, 25% 40%, 30% 50%, 35% 36%, 40% 52%, 45% 62%, 50% 74%, 55% 80%, 60% 66%, 65% 74%, 70% 56%, 75% 44%, 80% 34%, 85% 44%, 90% 26%, 95% 34%, 100% 18%, 100% 100%, 0% 100%)'
                      }}
                    />
                  </div>
                </div>
              ) : historyData.length > 0 ? (() => {
                const up = historyData[historyData.length - 1].close >= historyData[0].close;
                const lineColor = up ? '#22c55e' : '#ef4444';
                return (
                  <div style={{ padding: '0 0 0.5rem', width: '100%', boxSizing: 'border-box' }}>
                    {/* 250, down from 280: a hidden axis reserves no space, so keeping 280 would just
                      have handed the plot the 30px the date labels used to occupy. */}
                    <div className="wealth-chart" style={{ width: '100%', height: '250px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={historyData} margin={{ top: 70, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="wealthChartFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
                              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <YAxis domain={['dataMin', 'dataMax']} hide />
                          {/* Hidden, not removed: the axis still defines the horizontal scale and
                            the end padding that sets this screen's gutter. Its labels are dropped
                            because recharts thins them to whatever fits, which lands them at uneven
                            intervals — and the tooltip names the date of whatever point you touch. */}
                          <XAxis dataKey="date" hide padding={{ left: CHART_END_PAD, right: CHART_END_PAD }} />
                          <Tooltip
                            position={{ y: 6 }}
                            offset={0}
                            // See the Assets chart's copy: ChartTooltip owns the edge clamping, so
                            // recharts must place the wrapper on the point and not clamp it itself.
                            allowEscapeViewBox={{ x: true }}
                            cursor={false}
                            content={props => (
                              <ChartTooltip
                                {...props}
                                color={lineColor}
                                formatDate={formatPointLabel}
                                formatValue={v => `₹${v.toFixed(2)}`}
                              />
                            )}
                          />
                          <Area
                            type="monotone"
                            dataKey="close"
                            stroke={lineColor}
                            strokeWidth={1.5}
                            fill="url(#wealthChartFill)"
                            dot={false}
                            activeDot={(props: any) => {
                              const { cx, cy } = props;
                              if (cx == null || cy == null) return <g />;
                              const topAnchor = 64; // meet the tooltip caret tip (tooltip top y=6 + height)
                              return (
                                <g>
                                  <line
                                    x1={cx} y1={cy} x2={cx} y2={topAnchor}
                                    stroke={lineColor} strokeWidth={1.25}
                                    strokeDasharray="5 4" strokeOpacity={0.4}
                                  />
                                  <circle cx={cx} cy={cy} r={3.5} fill={lineColor} />
                                </g>
                              );
                            }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No chart data available
                </div>
              )}

              {/* Range Selector — below chart, CRED style. Margin rather than padding, so its rule
                ends at the gutter instead of running the full width of the screen — every other line
                here stops level with the chart. This screen keeps the rule, unlike the liquid detail's
                copy: the stat rows below have no border of their own to open on. */}
              {selectedAsset.type !== 'commodity' && selectedAsset.type !== 'epf' && (
                <div style={{ margin: `0 ${DETAIL_GUTTER}`, padding: '0.75rem 0 0.5rem', boxSizing: 'border-box', borderBottom: '1px solid var(--border-color)' }}>
                  <div className="no-scrollbar" style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', gap: '0.25rem' }}>
                    {(selectedAsset.type === 'stocks' ? STOCK_RANGES : MF_RANGES).map(r => {
                      const isActive = selectedAsset.type === 'stocks' ? stockRange === r : mfRange === r;
                      return (
                        <button
                          key={r}
                          onClick={() => selectedAsset.type === 'stocks'
                            ? setStockRange(r as StockHistoryRange)
                            : setMFRange(r as MFHistoryRange)}
                          style={{
                            padding: '0.4rem 0.9rem',
                            border: `1px solid ${isActive ? 'var(--border-color)' : 'transparent'}`,
                            background: isActive ? 'var(--bg-hover)' : 'transparent',
                            color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                            borderRadius: '999px',
                            cursor: 'pointer',
                            fontSize: '0.82rem',
                            fontWeight: isActive ? 700 : 500,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {r.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* EPF Clean StatRow Subscreen */}
              {selectedAsset.type === 'epf' ? (() => {
                const epfProj = calculateEPFProjection(selectedAsset);
                const monthlyCredit = epfProj.employeeContribution + epfProj.employerEPFContribution + epfProj.employerEPSContribution;

                return (
                  <div style={{ padding: `0.5rem ${DETAIL_GUTTER} 1.5rem`, boxSizing: 'border-box' }}>
                    <StatRow
                      label="Monthly Credit"
                      value={formatFullCurrency(monthlyCredit)}
                    />
                    <StatRow
                      label="Employee Share (12%)"
                      value={formatFullCurrency(epfProj.employeeContribution)}
                    />
                    <StatRow
                      label="Employer EPF Share"
                      value={formatFullCurrency(epfProj.employerEPFContribution)}
                    />
                    <StatRow
                      label="Employer EPS (Pension)"
                      value={formatFullCurrency(epfProj.employerEPSContribution)}
                      color="var(--warning)"
                    />

                    <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.75rem 0' }} />

                    <StatRow
                      label="Interest Earned (Current FY)"
                      value={formatFullCurrency(epfProj.accruedInterest)}
                      color="var(--success)"
                    />

                    <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.75rem 0' }} />

                    <StatRow
                      label={`Est. Balance (Dec ${new Date().getFullYear()} / EOY)`}
                      value={formatFullCurrency(epfProj.projectedDecBalance)}
                    />
                    <StatRow
                      label="Est. Balance (1 Year)"
                      value={formatFullCurrency(epfProj.projectedOneYearBalance)}
                    />
                    <StatRow
                      label="Projected Annual Growth"
                      value={`+ ${formatFullCurrency(epfProj.projectedOneYearBalance - epfProj.balance)}`}
                      color="var(--success)"
                    />
                  </div>
                );
              })() : (
                /* Stats List for Stocks & Mutual Funds */
                <div style={{ padding: `0.5rem ${DETAIL_GUTTER} 1.5rem`, boxSizing: 'border-box' }}>
                  <StatRow
                    label={selectedAsset.type === 'stocks' ? 'Shares' : selectedAsset.type === 'commodity' ? 'Grams' : 'Units'}
                    value={`${stats.totalUnits.toLocaleString('en-IN', { maximumFractionDigits: 4 })}${selectedAsset.type === 'commodity' ? ' g' : ''}`}
                  />
                  <StatRow
                    label="Total Returns"
                    value={signedAmount(stats.totalReturn >= 0, `₹${Math.abs(stats.totalReturn).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${stats.totalReturnPct >= 0 ? '+' : ''}${stats.totalReturnPct.toFixed(2)}%)`)}
                    color={stats.totalReturn >= 0 ? '#4ade80' : '#f87171'}
                  />
                  {oneDay && (
                    <StatRow
                      label="1 Day Returns"
                      value={signedAmount(oneDay.amount >= 0, `₹${Math.abs(oneDay.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${oneDay.pct >= 0 ? '+' : ''}${oneDay.pct.toFixed(2)}%)`)}
                      color={oneDay.amount >= 0 ? '#4ade80' : '#f87171'}
                    />
                  )}

                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.5rem 0' }} />

                  <StatRow label="Current" value={formatFullCurrency(stats.currentValue)} />
                  <StatRow label="Invested" value={formatFullCurrency(stats.totalInvested)} />
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
