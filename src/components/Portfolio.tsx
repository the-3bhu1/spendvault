import { useState, useEffect, useMemo } from 'react';
import { useFinance } from '../FinanceContext';
import type { Account } from '../types';
import { fetchPricesForSymbols, fetchStockHistory, fetchMFNavHistory, sliceHistoryByRange, getLatestFetchedAt, fetchCommodityPriceINR, getCachedCommodityPriceINR } from '../services/MarketDataService';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, RotateCcw, ChevronLeft, ChevronDown } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';

type HistoryDataPoint = { date: number; close: number };
type StockHistoryRange = '1d' | '5d' | '1mo' | '3mo' | '1y' | '5y';
type MFHistoryRange = '1m' | '6m' | '1y' | 'all';

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
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

export function Portfolio() {
  const { data } = useFinance();

  const [prices, setPrices] = useState<Record<string, number>>(() => {
    const cached: Record<string, number> = {};
    (data?.accounts || [])
      .filter((a: Account) => a.type === 'commodity' && a.marketSymbol)
      .forEach((a: Account) => { const p = getCachedCommodityPriceINR(a.marketSymbol!); if (p !== null) cached[a.marketSymbol!] = p; });
    return cached;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedAsset, setSelectedAsset] = useState<Account | null>(null);
  const [historyData, setHistoryData] = useState<HistoryDataPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [stockRange, setStockRange] = useState<StockHistoryRange>('1mo');
  const [mfRange, setMFRange] = useState<MFHistoryRange>('1y');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [portfolioView, setPortfolioView] = useState<'all' | 'mf' | 'stocks' | 'commodity'>('all');

  const toggleSection = (key: string) =>
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const sipAccounts = useMemo(() => {
    try {
      return (data?.accounts || []).filter((a: Account) => a.type === 'sips');
    } catch {
      return [];
    }
  }, [data?.accounts]);

  const stockAccounts = useMemo(() => {
    try {
      return (data?.accounts || []).filter((a: Account) => a.type === 'stocks');
    } catch {
      return [];
    }
  }, [data?.accounts]);

  const commodityAccounts = useMemo(() => {
    try {
      return (data?.accounts || []).filter((a: Account) => a.type === 'commodity');
    } catch {
      return [];
    }
  }, [data?.accounts]);

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      setError(null);

      const items = [
        ...sipAccounts.map((a: Account) => ({ symbol: a.marketSymbol || '', kind: 'sip' as const })),
        ...stockAccounts.map((a: Account) => ({ symbol: a.marketSymbol || '', kind: 'stock' as const }))
      ].filter(i => i.symbol);

      const commodityItems = commodityAccounts.filter((a: Account) => a.marketSymbol);

      if (items.length === 0 && commodityItems.length === 0) {
        setIsRefreshing(false);
        return;
      }

      const [newPrices, commodityPriceResults] = await Promise.all([
        fetchPricesForSymbols(items),
        Promise.all(commodityItems.map((a: Account) =>
          fetchCommodityPriceINR(a.marketSymbol!).then(p => [a.marketSymbol!, p] as [string, number | null])
        ))
      ]);
      commodityPriceResults.forEach(([sym, p]) => { if (p !== null) newPrices[sym] = p; });
      setPrices(newPrices);

      const latest = getLatestFetchedAt(items.map(i => i.symbol));
      if (latest !== null) setLastRefreshed(new Date(latest));
    } catch (e: any) {
      console.error('Failed to refresh prices:', e);
      setError(`Price refresh failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    handleRefresh();
  }, [sipAccounts, stockAccounts, commodityAccounts]);

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
      } else if (selectedAsset.type === 'sips') {
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
    const symbol = account.marketSymbol || '';
    const currentPrice = prices[symbol] ?? 0;

    const totalUnits = getTotalUnits(account);

    const txInvested = data.transactions
      .filter((t: any) => t.accountId === account.id && !t.isTravelTransaction && !t.isRewardTransaction)
      .reduce((sum: number, t: any) => t.type === 'credit' ? sum + t.amount : sum - t.amount, 0);

    const totalInvested = account.investedValue !== undefined
      ? account.investedValue + txInvested
      : (account.avgNav && totalUnits > 0 ? account.avgNav * totalUnits : 0);

    const currentValue = currentPrice * totalUnits;
    const totalReturn = currentValue - totalInvested;
    const totalReturnPct = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0;

    return {
      totalUnits,
      totalInvested,
      currentValue,
      totalReturn,
      totalReturnPct,
      currentPrice
    };
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

  const portfolioStats = useMemo(() => ({
    all: buildStats([...sipAccounts, ...stockAccounts, ...commodityAccounts]),
    mf: buildStats(sipAccounts),
    stocks: buildStats(stockAccounts),
    commodity: buildStats(commodityAccounts),
  }), [sipAccounts, stockAccounts, commodityAccounts, prices, data.transactions]);

  const getAvatarColor = (name: string) => {
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7', '#a29bfe'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(i);
      hash = hash & hash;
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatCurrency = (value: number) => {
    if (value >= 1_00_000) {
      return `₹${(value / 1_00_000).toFixed(1)}L`;
    } else if (value >= 1_000) {
      return `₹${(value / 1_000).toFixed(1)}K`;
    }
    return `₹${value.toFixed(0)}`;
  };

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const hasInvestments = sipAccounts.length > 0 || stockAccounts.length > 0 || commodityAccounts.length > 0;

  const userName = data.user?.name?.split(' ')[0] || 'Your';

  const renderAssetRow = (account: Account) => {
    const stats = getAccountStats(account);
    const positive = stats.totalReturn >= 0;
    return (
      <div
        key={account.id}
        onClick={() => setSelectedAsset(account)}
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
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            background: getAvatarColor(account.name),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 700,
            fontSize: '0.8rem',
            flexShrink: 0
          }}
        >
          {getInitials(account.name)}
        </div>
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
          <div style={{
            fontSize: '0.95rem',
            fontWeight: 700,
            color: positive ? '#22c55e' : '#ef4444'
          }}>
            {formatCurrency(stats.currentValue)}
          </div>
          <div style={{
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            marginTop: '0.15rem'
          }}>
            {formatCurrency(stats.totalInvested)}
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const handleBack = (e: Event) => {
      if (selectedAsset) {
        e.preventDefault();
        setSelectedAsset(null);
      }
    };
    window.addEventListener('appBackButton', handleBack);
    return () => window.removeEventListener('appBackButton', handleBack);
  }, [selectedAsset]);

  useEffect(() => {
    const appRoot = document.querySelector('.app-root');
    if (appRoot) appRoot.scrollTo({ top: 0, behavior: 'auto' });
  }, [selectedAsset]);

  return (
    <div style={{ background: 'var(--bg-primary)', paddingBottom: '100px' }}>
      {!selectedAsset && (
      <>
      <div style={{ padding: '1.75rem 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ marginBottom: '1rem' }}>
          <ProfileAvatar size={64} />
        </div>

        <div className="text-mono uppercase" style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '2px', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
          {userName}'s Portfolio
        </div>

        <div className="text-serif" style={{ fontSize: '2.75rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
          ₹{Math.round(portfolioStats[portfolioView].current).toLocaleString('en-IN')}
        </div>

        <div style={{
          fontSize: '0.95rem',
          fontWeight: 600,
          marginTop: '0.75rem',
          color: portfolioStats[portfolioView].pnl >= 0 ? '#22c55e' : '#ef4444'
        }}>
          {portfolioStats[portfolioView].pnl >= 0 ? '↑' : '↓'} ₹{Math.abs(portfolioStats[portfolioView].pnl).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({portfolioStats[portfolioView].pnlPct >= 0 ? '+' : ''}{portfolioStats[portfolioView].pnlPct.toFixed(2)}%)
        </div>

        <button
          onClick={handleRefresh}
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
            gap: '0.5rem',
            fontSize: '0.85rem',
            fontWeight: 600
          }}
        >
          <RotateCcw size={15} className={isRefreshing ? 'icon-spin' : ''} />
          {isRefreshing ? 'Refreshing...' : 'Refresh prices'}
        </button>

        {lastRefreshed && (
          <div className="text-mono uppercase" style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.6rem', letterSpacing: '0.5px' }}>
            Last refresh at {formatTime(lastRefreshed)}
          </div>
        )}

        {(sipAccounts.length > 0 || stockAccounts.length > 0 || commodityAccounts.length > 0) && (() => {
          const tabs = [
            { v: 'all', label: 'All' },
            { v: 'mf', label: 'MF' },
            { v: 'stocks', label: 'Stocks' },
            { v: 'commodity', label: 'Metals' },
          ] as const;
          const activeIdx = tabs.findIndex(t => t.v === portfolioView);
          const PAD = 4;
          return (
            <div style={{
              position: 'relative',
              display: 'flex',
              marginTop: '1.5rem',
              padding: `${PAD}px`,
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.08)',
              width: '272px',
            }}>
              <div style={{
                position: 'absolute',
                top: `${PAD}px`,
                bottom: `${PAD}px`,
                width: `calc((100% - ${PAD * 2}px) / 4)`,
                left: `calc(${PAD}px + ${activeIdx} * (100% - ${PAD * 2}px) / 4)`,
                borderRadius: '999px',
                background: 'rgba(255,255,255,0.11)',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.14)',
                transition: 'left 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)',
                pointerEvents: 'none'
              }} />
              {tabs.map(({ v, label }) => {
                const active = portfolioView === v;
                return (
                  <button
                    key={v}
                    onClick={() => setPortfolioView(v)}
                    style={{
                      flex: 1,
                      position: 'relative',
                      zIndex: 1,
                      padding: '0.5rem 0',
                      border: 'none',
                      background: 'transparent',
                      color: active ? 'var(--text-primary)' : 'rgba(255,255,255,0.32)',
                      borderRadius: '999px',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                      fontWeight: active ? 700 : 500,
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
        })()}
      </div>

      <div style={{
        margin: '0 1.5rem',
        padding: '1.25rem 0',
        borderTop: '1px solid var(--border-color)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        gap: '0.5rem'
      }}>
        {(() => {
          const s = portfolioStats[portfolioView];
          return (<>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="text-mono uppercase" style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Invested</div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatCurrency(s.invested)}</div>
            </div>
            <div style={{ width: '1px', background: 'var(--border-color)' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="text-mono uppercase" style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Returns</div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: s.pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                {s.pnl >= 0 ? '+' : ''}{s.pnlPct.toFixed(2)}%
              </div>
            </div>
          </>);
        })()}
      </div>

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

      {!hasInvestments ? (
        <div style={{
          padding: '3rem 1.5rem',
          textAlign: 'center',
          color: 'var(--text-secondary)'
        }}>
          <TrendingUp size={48} style={{ opacity: 0.5, margin: '0 auto 1rem' }} />
          <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No investments yet</div>
          <div style={{ fontSize: '0.9rem' }}>Add stocks or SIPs from the Accounts tab</div>
        </div>
      ) : (
        <>
          {sipAccounts.length > 0 && (() => {
            const isCollapsed = collapsedSections.has('mf');
            return (
            <div style={{ padding: '1.5rem 1.5rem 0.5rem' }}>
              <div
                className="flex align-center gap-3"
                style={{ cursor: 'pointer', userSelect: 'none', marginBottom: isCollapsed ? 0 : '0.25rem' }}
                onClick={() => toggleSection('mf')}
              >
                <span className="text-mono uppercase" style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '1.5px' }}>
                  Mutual Funds
                </span>
                <span className="text-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.6 }}>
                  {sipAccounts.length}
                </span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)', opacity: 0.5 }} />
                <ChevronDown size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0, transition: 'transform 0.2s ease', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} />
              </div>
              {!isCollapsed && (
                <div>
                  {sipAccounts.map((account: Account) => renderAssetRow(account))}
                </div>
              )}
            </div>
            );
          })()}

          {stockAccounts.length > 0 && (() => {
            const isCollapsed = collapsedSections.has('stocks');
            return (
            <div style={{ padding: '1.5rem 1.5rem 0.5rem' }}>
              <div
                className="flex align-center gap-3"
                style={{ cursor: 'pointer', userSelect: 'none', marginBottom: isCollapsed ? 0 : '0.25rem' }}
                onClick={() => toggleSection('stocks')}
              >
                <span className="text-mono uppercase" style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '1.5px' }}>
                  Stocks
                </span>
                <span className="text-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.6 }}>
                  {stockAccounts.length}
                </span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)', opacity: 0.5 }} />
                <ChevronDown size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0, transition: 'transform 0.2s ease', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} />
              </div>
              {!isCollapsed && (
                <div>
                  {stockAccounts.map((account: Account) => renderAssetRow(account))}
                </div>
              )}
            </div>
            );
          })()}

          {commodityAccounts.length > 0 && (() => {
            const isCollapsed = collapsedSections.has('commodity');
            return (
            <div style={{ padding: '1.5rem 1.5rem 0.5rem' }}>
              <div
                className="flex align-center gap-3"
                style={{ cursor: 'pointer', userSelect: 'none', marginBottom: isCollapsed ? 0 : '0.25rem' }}
                onClick={() => toggleSection('commodity')}
              >
                <span className="text-mono uppercase" style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '1.5px' }}>
                  Commodities
                </span>
                <span className="text-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.6 }}>
                  {commodityAccounts.length}
                </span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)', opacity: 0.5 }} />
                <ChevronDown size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0, transition: 'transform 0.2s ease', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} />
              </div>
              {!isCollapsed && (
                <div>
                  {commodityAccounts.map((account: Account) => renderAssetRow(account))}
                </div>
              )}
            </div>
            );
          })()}
        </>
      )}
      </>
      )}

      {selectedAsset && (() => {
        const stats = getAccountStats(selectedAsset);
        const oneDay = getOneDayReturn(selectedAsset);
        return (
        <div className="fade-in" style={{ boxSizing: 'border-box' }}>
          <div
            style={{
              boxSizing: 'border-box'
            }}
          >
            {/* Header with back button */}
            <div className="flex align-center gap-4" style={{ padding: '0 0 0.5rem', boxSizing: 'border-box' }}>
              <button
                className="btn btn-secondary"
                style={{ padding: '0.5rem', flexShrink: 0 }}
                onClick={() => setSelectedAsset(null)}
              >
                <ChevronLeft size={20} />
              </button>
            </div>

            {/* Asset identity — centered, CRED style */}
            <div style={{ padding: '0 1.5rem 1.5rem', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  background: getAvatarColor(selectedAsset.name),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 700,
                  fontSize: '1.2rem',
                  marginBottom: '1rem'
                }}
              >
                {getInitials(selectedAsset.name)}
              </div>

              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35, maxWidth: '90%' }}>
                {selectedAsset.name}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                {selectedAsset.type === 'sips' ? 'Mutual Fund' : selectedAsset.type === 'commodity' ? (selectedAsset.commodityMetal === 'silver' ? 'Silver' : 'Gold') : 'Stock'}
              </div>

              <div className="text-serif" style={{
                fontSize: '3rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginTop: '1.25rem',
                lineHeight: 1
              }}>
                {selectedAsset.type === 'commodity'
                  ? `₹${stats.currentPrice.toFixed(2)}/g`
                  : `₹${stats.currentPrice.toFixed(2)}`
                }
              </div>

              {oneDay ? (
                <div style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  marginTop: '0.75rem',
                  color: oneDay.perUnitChange >= 0 ? '#22c55e' : '#ef4444'
                }}>
                  {oneDay.perUnitChange >= 0 ? '↑' : '↓'} ₹{Math.abs(oneDay.perUnitChange).toFixed(2)} ({oneDay.pct >= 0 ? '+' : ''}{oneDay.pct.toFixed(2)}%)
                </div>
              ) : (
                <div style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  marginTop: '0.75rem',
                  color: stats.totalReturnPct >= 0 ? '#22c55e' : '#ef4444'
                }}>
                  {stats.totalReturnPct >= 0 ? '+' : ''}₹{stats.totalReturn.toFixed(2)} ({stats.totalReturnPct.toFixed(2)}%)
                </div>
              )}
            </div>

            {/* Chart — CRED style: auto-scaled, no axes/grid clutter, thin trend line */}
            {selectedAsset.type === 'commodity' ? null : historyLoading ? (
              <div style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading chart...
              </div>
            ) : historyData.length > 0 ? (() => {
              const up = historyData[historyData.length - 1].close >= historyData[0].close;
              const lineColor = up ? '#22c55e' : '#ef4444';
              return (
              <div style={{ padding: '0.5rem 0 0.5rem', width: '100%', boxSizing: 'border-box' }}>
                <div className="portfolio-chart" style={{ width: '100%', height: '280px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {/* plot bottom baseline: container 280 - x-axis height 30 */}
                    <AreaChart data={historyData} margin={{ top: 70, right: 0, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="portfolioChartFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={lineColor} stopOpacity={0.22}/>
                          <stop offset="100%" stopColor={lineColor} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <YAxis domain={['dataMin', 'dataMax']} hide />
                      <XAxis
                        dataKey="date"
                        height={30}
                        tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                        tickFormatter={d => new Date(d).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                        minTickGap={50}
                        axisLine={false}
                        tickLine={false}
                        padding={{ left: 16, right: 16 }}
                      />
                      <Tooltip
                        position={{ y: 6 }}
                        offset={0}
                        allowEscapeViewBox={{ x: true }}
                        cursor={false}
                        content={({ active, payload, label }: any) => {
                          if (!active || !payload || !payload.length) return null;
                          const val = payload[0].value as number;
                          return (
                            <div style={{
                              transform: 'translateX(-50%)',
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '0.6rem',
                              padding: '0.45rem 0.7rem',
                              position: 'relative',
                              whiteSpace: 'nowrap',
                              boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
                              pointerEvents: 'none'
                            }}>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                                {new Date(label as number).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                              </div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: lineColor }}>
                                ₹{val.toFixed(2)}
                              </div>
                              <div style={{
                                position: 'absolute',
                                bottom: '-5px',
                                left: '50%',
                                transform: 'translateX(-50%) rotate(45deg)',
                                width: '10px',
                                height: '10px',
                                background: 'var(--bg-card)',
                                borderRight: '1px solid var(--border-color)',
                                borderBottom: '1px solid var(--border-color)'
                              }} />
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="close"
                        stroke={lineColor}
                        strokeWidth={1.5}
                        fill="url(#portfolioChartFill)"
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

            {/* Range Selector — below chart, CRED style */}
            {selectedAsset.type !== 'commodity' && (
              <div style={{ padding: '0.75rem 1rem 0.5rem', boxSizing: 'border-box', borderBottom: '1px solid var(--border-color)' }}>
                <div className="no-scrollbar" style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', gap: '0.25rem' }}>
                  {(selectedAsset.type === 'stocks'
                    ? ['1d', '5d', '1mo', '3mo', '1y', '5y']
                    : ['1m', '6m', '1y', 'all']
                  ).map(r => {
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

            {/* Stats List */}
            <div style={{ padding: '0.5rem 1.25rem 1.5rem', boxSizing: 'border-box' }}>
              <StatRow
                label={selectedAsset.type === 'stocks' ? 'Shares' : selectedAsset.type === 'commodity' ? 'Grams' : 'Units'}
                value={`${stats.totalUnits.toLocaleString('en-IN', { maximumFractionDigits: 3 })}${selectedAsset.type === 'commodity' ? ' g' : ''}`}
              />
              <StatRow
                label="Total Returns"
                value={`${stats.totalReturn >= 0 ? '↑' : '↓'} ₹${Math.abs(stats.totalReturn).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${stats.totalReturnPct >= 0 ? '+' : ''}${stats.totalReturnPct.toFixed(2)}%)`}
                color={stats.totalReturn >= 0 ? '#4ade80' : '#f87171'}
              />
              {oneDay && (
                <StatRow
                  label="1 Day Returns"
                  value={`${oneDay.amount >= 0 ? '↑' : '↓'} ₹${Math.abs(oneDay.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${oneDay.pct >= 0 ? '+' : ''}${oneDay.pct.toFixed(2)}%)`}
                  color={oneDay.amount >= 0 ? '#4ade80' : '#f87171'}
                />
              )}

              <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.5rem 0' }} />

              <StatRow label="Current" value={formatFullCurrency(stats.currentValue)} />
              <StatRow label="Invested" value={formatFullCurrency(stats.totalInvested)} />
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
