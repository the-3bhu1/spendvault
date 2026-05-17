import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { CreditCard, Calendar, ShoppingBag, Utensils, Zap, Car, HeartPulse, Film, Wallet, ArrowRightLeft, MoreHorizontal, Coins, BadgeDollarSign, ArrowLeft } from 'lucide-react';
import { CustomPicker } from './CustomPicker';
import RollingNumber from './RollingNumber';
import { getBillingCycleForDate, getCardGradients } from '../utils';
import type { Account, Transaction } from '../types';
import { CardNetworkLogo } from './CardNetworkLogo';
import { useFinance } from '../FinanceContext';

interface AccountStatementProps {
  account: Account;
  transactions: Transaction[];
  onClose: () => void;
}

export default function AccountStatement({ account, transactions, onClose }: AccountStatementProps) {
  const context = useFinance();
  const allAccounts = context ? [...context.data.accounts].sort((a, b) => a.id.localeCompare(b.id)) : [];
  const accountIndex = allAccounts.findIndex(acc => acc.id === account.id);
  const themeIndex = accountIndex >= 0 ? accountIndex : 0;

  const transactionsViewportRef = useRef<HTMLDivElement>(null);
  const transactionsContentRef = useRef<HTMLDivElement>(null);
  const getCategoryIcon = (category: string) => {
    const cat = category.toLowerCase();
    if (cat.includes('shop')) return <ShoppingBag size={20} />;
    if (cat.includes('food') || cat.includes('eat') || cat.includes('dine')) return <Utensils size={20} />;
    if (cat.includes('travel') || cat.includes('transport') || cat.includes('fuel')) return <Car size={20} />;
    if (cat.includes('bill') || cat.includes('recharge') || cat.includes('utility')) return <Zap size={20} />;
    if (cat.includes('health') || cat.includes('med')) return <HeartPulse size={20} />;
    if (cat.includes('entertain') || cat.includes('movie') || cat.includes('ott')) return <Film size={20} />;
    if (cat.includes('salary')) return <BadgeDollarSign size={20} />;
    if (cat.includes('income')) return <Wallet size={20} />;
    if (cat.includes('cc payment')) return <CreditCard size={20} />;
    if (cat.includes('transfer')) return <ArrowRightLeft size={20} />;
    if (cat.includes('miscellaneous') || cat.includes('other')) return <MoreHorizontal size={20} />;
    return <Coins size={20} />;
  };

  const formatCredCurrency = (amount: number, font = 'serif') => {
    const parts = Math.abs(amount).toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).split('.');

    return (
      <span style={{ fontFamily: font, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {amount < 0 ? '-' : ''}{parts[0]}<span style={{ fontSize: '0.85em', opacity: 0.9 }}>.{parts[1]}</span>
      </span>
    );
  };

  const acc = account;
  const statementDay = acc.statementDay || 1;
  const currentCycle = getBillingCycleForDate(format(new Date(), 'yyyy-MM-dd'), statementDay);
  const getTransactionCycle = (tx: Transaction) => {
    if (tx.type === 'credit' && tx.appliedBillingCycleYearMonth) {
      return tx.appliedBillingCycleYearMonth;
    }
    return getBillingCycleForDate(tx.date, statementDay);
  };
  const relevantAccountTransactions = transactions.filter(t => {
    if (t.accountId !== acc.id) return false;
    return t.category.toLowerCase() !== 'transfer';
  });
  const cycleOptions = Array.from(new Set([
    currentCycle,
    ...relevantAccountTransactions.map(getTransactionCycle)
  ]))
    .sort((a, b) => b.localeCompare(a))
    .map(cycle => {
      const date = new Date(`${cycle}-01`);
      const year = date.getFullYear();
      return {
        id: cycle,
        name: `${date.toLocaleString('default', { month: 'short' })} '${date.getFullYear().toString().slice(-2)}`,
        subtext: cycle === currentCycle ? 'Open Cycle' : 'Closed Statement',
        group: `Year ${year}`
      };
    });

  const [selectedCycle, setSelectedCycle] = useState(currentCycle);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [isTransactionsClipped, setIsTransactionsClipped] = useState(false);

  const selectedCycleDate = new Date(`${selectedCycle}-01`);
  const currentMonthName = selectedCycleDate.toLocaleString('default', { month: 'long' }).toLowerCase();

  const cycleTxs = relevantAccountTransactions
    .filter(t => getTransactionCycle(t) === selectedCycle)
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalSpends = cycleTxs.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const totalPayments = cycleTxs.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
  const rawNetAmount = totalSpends - totalPayments;
  let netAmount = rawNetAmount;
  const rounding = acc.statementRounding || 'none';

  if (rounding === 'round') netAmount = Math.round(rawNetAmount);
  else if (rounding === 'floor') netAmount = Math.floor(rawNetAmount);
  else if (rounding === 'ceil') netAmount = Math.ceil(rawNetAmount);

  const cycleTitle = selectedCycle === currentCycle ? 'CURRENT OPEN CYCLE' : 'CLOSED BILLING CYCLE';

  useEffect(() => {
    const updateClippingState = () => {
      if (showAllTransactions) {
        setIsTransactionsClipped(false);
        return;
      }

      const viewport = transactionsViewportRef.current;
      const content = transactionsContentRef.current;
      if (!viewport || !content) {
        setIsTransactionsClipped(false);
        return;
      }

      setIsTransactionsClipped(content.scrollHeight > viewport.clientHeight + 1);
    };

    updateClippingState();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateClippingState())
      : null;

    if (resizeObserver) {
      if (transactionsViewportRef.current) resizeObserver.observe(transactionsViewportRef.current);
      if (transactionsContentRef.current) resizeObserver.observe(transactionsContentRef.current);
    }

    window.addEventListener('resize', updateClippingState);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateClippingState);
    };
  }, [cycleTxs, showAllTransactions]);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1900, background: 'var(--bg-color)', overflow: 'hidden' }} className="fade-in">
      <div className="flex-col" style={{ gap: 0, height: '100vh', background: 'var(--bg-color)' }}>
        <div style={{
          paddingTop: 'calc(2.5rem + env(safe-area-inset-top, 24px))',
          paddingLeft: '1.5rem',
          paddingRight: '1.5rem',
          paddingBottom: '1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-card)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          borderBottom: '1px solid var(--border-color)'
        }}>
          <div className="flex align-center gap-3">
            <div style={{ cursor: 'pointer', padding: '0.35rem', display: 'flex', alignItems: 'center', color: 'var(--text-primary)', opacity: 0.9 }} onClick={onClose}>
              <ArrowLeft size={24} strokeWidth={2.25} />
            </div>
            <div className="flex-col">
              <span className="text-mono font-bold uppercase" style={{ opacity: 0.72, color: 'var(--text-primary)', fontSize: '1rem' }}>{acc.name}</span>
              <span className="text-mono font-bold uppercase" style={{ color: selectedCycle === currentCycle ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '0.72rem', marginTop: '0.3rem' }}>{cycleTitle}</span>
            </div>
          </div>

          <div style={{ width: '150px', flexShrink: 0 }}>
            <CustomPicker
              label="Select Cycle"
              hideLabel={true}
              value={selectedCycle}
              options={cycleOptions}
              onChange={(val) => {
                setSelectedCycle(val);
                setShowAllTransactions(false);
              }}
              iconGetter={() => <Calendar size={18} />}
              allowTextWrap={false}
            />
          </div>
        </div>

        <div style={{
          height: showAllTransactions ? '0px' : '360px',
          overflow: 'hidden',
          transition: showAllTransactions
            ? 'height 1.2s cubic-bezier(0.76, 0, 0.24, 1) 0.3s'
            : 'height 1.2s cubic-bezier(0.76, 0, 0.24, 1)'
        }}>
          <div style={{
            height: '360px',
            background: 'linear-gradient(180deg, var(--bg-hover) 0%, var(--bg-color) 80%, var(--bg-color) 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            textAlign: 'center',
            color: 'var(--text-primary)',
          }}>
            <h2 className="text-serif" style={{
              fontSize: '2rem',
              marginTop: '1rem',
              opacity: showAllTransactions ? 0 : 0.9,
              transform: showAllTransactions ? 'translateY(-40px) scale(0.92)' : 'translateY(0) scale(1)',
              filter: showAllTransactions ? 'blur(4px)' : 'blur(0px)',
              transition: showAllTransactions
                ? 'opacity 0.6s ease, transform 0.7s cubic-bezier(0.4, 0, 1, 1), filter 0.6s ease'
                : 'opacity 0.6s ease 0.5s, transform 0.7s cubic-bezier(0, 0, 0.2, 1) 0.5s, filter 0.6s ease 0.5s'
            }}>
              here is your statement<br />for {currentMonthName}
            </h2>

            <div style={{
              marginTop: '2rem',
              width: '340px',
              height: '210px',
              background: account.cardDetails
                ? getCardGradients(themeIndex, account.cardDetails.network).front
                : 'var(--bg-card)',
              borderRadius: '16px',
              perspective: '800px',
              transform: showAllTransactions
                ? 'rotateX(70deg) translateY(-60px) scale(0.85)'
                : 'perspective(800px) rotateY(-4deg) rotateX(3deg) rotateZ(-1deg)',
              boxShadow: showAllTransactions
                ? '0 0px 10px rgba(0,0,0,0.1)'
                : '12px 16px 0 #000000',
              opacity: showAllTransactions ? 0 : 1,
              border: '1px solid rgba(255,255,255,0.1)',
              position: 'relative',
              overflow: 'hidden',
              transition: showAllTransactions
                ? 'transform 0.8s cubic-bezier(0.4, 0, 1, 1), opacity 0.7s ease, box-shadow 0.6s ease'
                : 'transform 0.8s cubic-bezier(0, 0, 0.2, 1) 0.5s, opacity 0.7s ease 0.5s, box-shadow 0.6s ease 0.5s'
            }}>
              {/* SIM Chip — always shown */}
              <div style={{ position: 'absolute', top: '24px', left: '24px', width: '34px', height: '24px', background: 'linear-gradient(135deg, #ffd700 0%, #ca8a04 100%)', borderRadius: '3px', overflow: 'hidden' }}>
                <svg width="34" height="24" viewBox="0 0 42 30" style={{ position: 'absolute', top: 0, left: 0 }}>
                  <line x1="0" y1="15" x2="42" y2="15" stroke="rgba(139,90,0,0.4)" strokeWidth="0.8" />
                  <line x1="21" y1="0" x2="21" y2="30" stroke="rgba(139,90,0,0.4)" strokeWidth="0.8" />
                  <line x1="14" y1="0" x2="14" y2="30" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <line x1="28" y1="0" x2="28" y2="30" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <line x1="0" y1="8" x2="14" y2="8" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <line x1="0" y1="22" x2="14" y2="22" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <line x1="28" y1="8" x2="42" y2="8" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <line x1="28" y1="22" x2="42" y2="22" stroke="rgba(139,90,0,0.3)" strokeWidth="0.5" />
                  <rect x="14" y="5" width="14" height="20" rx="2" fill="none" stroke="rgba(139,90,0,0.35)" strokeWidth="0.8" />
                </svg>
              </div>

              {acc.cardDetails ? (
                /* ── Real card details ── */
                <>
                  {/* Network logo top-right */}
                  <div style={{ position: 'absolute', top: '14px', right: '14px', overflow: 'visible' }}>
                    {acc.cardDetails.network
                      ? <CardNetworkLogo network={acc.cardDetails.network} size="md" />
                      : <CreditCard size={20} style={{ opacity: 0.3, color: 'white' }} />}
                  </div>

                  {/* Account Name + Cardholder name row */}
                  <div style={{ position: 'absolute', bottom: '24px', left: '24px', right: '24px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ 
                      fontFamily: 'var(--font-family)', 
                      fontSize: '10px', 
                      color: 'rgba(255,255,255,0.5)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      {acc.name}
                    </span>
                    <span style={{ 
                      fontFamily: '"Courier New", Courier, monospace', 
                      fontSize: '14px', 
                      color: 'rgba(255,255,255,0.9)',
                      textTransform: 'uppercase',
                      letterSpacing: '1.5px',
                      textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                    }}>
                      {acc.cardDetails.cardholderName || 'CARDHOLDER NAME'}
                    </span>
                  </div>

                  {/* Decorative radial overlay */}
                  <div style={{ position: 'absolute', top: 0, right: 0, width: '180px', height: '180px', background: 'white', opacity: 0.03, borderRadius: '50%', transform: 'translate(30%, -30%)' }} />
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 60%)', pointerEvents: 'none' }} />
                </>
              ) : (
                /* ── Placeholder card ── */
                <>
                  <div style={{ position: 'absolute', top: '20px', right: '20px', opacity: 0.2, color: 'var(--text-primary)' }}><CreditCard size={20} /></div>
                  <div style={{ position: 'absolute', bottom: '40px', left: '20px', fontSize: '0.75rem', color: 'var(--text-primary)', opacity: 0.3, letterSpacing: '2px' }}>XXXX XXXX XXXX 1234</div>
                  <div style={{ position: 'absolute', bottom: '20px', left: '20px', width: '75%', height: '6px', background: 'var(--text-primary)', opacity: 0.05, borderRadius: '3px' }} />
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(135deg, var(--text-primary) 0%, transparent 60%)', opacity: 0.04, pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', top: '0', right: '0', width: '140px', height: '140px', background: 'var(--accent)', opacity: 0.03, borderRadius: '50%', transform: 'translate(30%, -30%)' }} />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex-col" style={{
          padding: '1.2rem 1.5rem 0 1.5rem',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div className="flex-col align-center" style={{ flexShrink: 0 }}>
            <span className="text-mono text-xs text-muted font-bold uppercase" style={{ opacity: 0.5, marginBottom: '0.5rem' }}>Statement Amount</span>
            <div
              className="text-serif"
              style={{
                fontSize: '1rem',
                lineHeight: 1,
                transition: 'transform 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                transform: showAllTransactions ? 'scale(0.85)' : 'scale(1)'
              }}
            >
              <RollingNumber value={netAmount} fontSize="2.5rem" />
            </div>
          </div>

          <h4 className="text-mono text-xs text-muted uppercase font-bold" style={{ opacity: 0.4, marginTop: '1.2rem', marginBottom: '0.25rem', flexShrink: 0 }}>
            {showAllTransactions ? 'All Transactions' : 'Top Transactions'}
          </h4>

          <div
            ref={transactionsViewportRef}
            className="no-scrollbar"
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              overflowY: showAllTransactions ? 'auto' : 'hidden',
              overflowX: 'hidden',
            }}
          >
            <div ref={transactionsContentRef} className="flex-col" style={{ minHeight: '100%' }}>
              {cycleTxs.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100%' }}>
                  <p className="text-center text-muted" style={{ opacity: 0.5 }}>no transactions recorded yet.</p>
                </div>
              ) : (
                cycleTxs.map((tx, idx) => (
                  <div key={tx.id} className="flex justify-between align-center fade-in" style={{
                    borderBottom: '1px solid var(--border-color)',
                    opacity: 0.9,
                    padding: '0.85rem 0',
                    animationDelay: `${idx * 0.05}s`
                  }}>
                    <div className="flex align-center" style={{ gap: '0.75rem', flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '10px',
                        background: 'var(--bg-hover)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-primary)',
                        flexShrink: 0,
                      }}>
                        {getCategoryIcon(tx.category)}
                      </div>
                      <div className="flex-col" style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{tx.description}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{tx.category.toLowerCase()}</span>
                      </div>
                    </div>
                    <div className="flex-col align-end" style={{ flexShrink: 0, marginLeft: '0.75rem' }}>
                      <span className="text-mono" style={{ fontWeight: 700, fontSize: '1.1rem', color: tx.type === 'credit' ? '#10b981' : 'var(--text-primary)' }}>
                        {tx.type === 'credit' ? '+ ' : ''}{formatCredCurrency(tx.amount, 'var(--font-mono)')}
                      </span>
                      <span className="text-mono text-xs text-secondary" style={{ marginTop: '2px' }}>
                        {new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {!showAllTransactions && isTransactionsClipped && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '80px',
                background: 'linear-gradient(transparent, var(--bg-color))',
                pointerEvents: 'none',
              }} />
            )}
          </div>

          {cycleTxs.length > 0 && (
            <div className="flex justify-center" style={{ flexShrink: 0, padding: '0.75rem 0 1.5rem' }}>
              <button
                onClick={() => {
                  setShowAllTransactions(!showAllTransactions);
                }}
                style={{ color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'underline', opacity: 0.9, cursor: 'pointer', padding: '0.5rem 1rem' }}
              >
                {showAllTransactions ? 'Show fewer transactions' : `View all ${cycleTxs.length} transactions`}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
