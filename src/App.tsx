import { useState, useEffect, useRef } from 'react';
import { Home, Wallet, ReceiptText, Gift, Users, Sparkles, LayoutGrid, ChevronRight, Calendar, HandCoins, LogOut, TrendingUpDown } from 'lucide-react';
import Dashboard from './components/Dashboard';
import Accounts from './components/Accounts';
import Transactions from './components/Transactions';
import Cashback from './components/Cashback';
import Settings from './components/Settings';
import Splits from './components/Splits';
import SplashScreen from './components/SplashScreen';
import Insights from './components/Insights';
import TransparentLogo from './components/TransparentLogo';
import ProfileAvatar from './components/ProfileAvatar';
import UpcomingBills from './components/UpcomingBills';
import Debts from './components/Debts';
import { Portfolio } from './components/Portfolio';

import { useFinance } from './FinanceContext';
import AuthScreen from './components/AuthScreen';
import OnboardingScreen from './components/OnboardingScreen';
import AccountStatement from './components/AccountStatement';
import AppTour from './components/AppTour';
import BillAlertBanner from './components/BillAlertBanner';
import type { Account } from './types';
import SmsReader, { startSmsListener } from './services/SmsService';
import { Capacitor } from '@capacitor/core';

export type Tab = 'dashboard' | 'accounts' | 'transactions' | 'cashback' | 'insights' | 'settings' | 'splits' | 'bills' | 'debts' | 'portfolio';

import { App as CapApp } from '@capacitor/app';

function App() {
  const { data, pendingTransfer, addToSmsQueue, isAuthenticated, setAuthenticated } = useFinance();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const scrollPositions = useRef<Record<string, number>>({});
  const addToSmsQueueRef = useRef(addToSmsQueue);
  addToSmsQueueRef.current = addToSmsQueue;

  const autoLogSmsRef = useRef(data.user?.autoLogSms);
  autoLogSmsRef.current = data.user?.autoLogSms;

  useEffect(() => {
    const appRoot = document.querySelector('.app-root');
    if (!appRoot) return;

    // Define which tabs should reset to top vs resume
    const resettingTabs = ['dashboard', 'insights', 'portfolio', 'cashback', 'splits', 'bills', 'debts'];
    
    // 1. Restore scroll position
    const savedPos = resettingTabs.includes(activeTab) ? 0 : (scrollPositions.current[activeTab] || 0);
    
    // Small delay to ensure DOM is updated before scrolling
    const timer = setTimeout(() => {
      appRoot.scrollTo({ top: savedPos, behavior: 'auto' });
    }, 10);

    // 2. Continuous listener to save scroll for persistent tabs
    const handleScroll = () => {
      if (!resettingTabs.includes(activeTab)) {
        scrollPositions.current[activeTab] = appRoot.scrollTop;
      }
    };

    appRoot.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      appRoot.removeEventListener('scroll', handleScroll);
      clearTimeout(timer);
    };
  }, [activeTab]);

  useEffect(() => {
    // Force initialize the plugin — Android only (SMS not available on iOS)
    if (Capacitor.getPlatform() === 'android') {
      SmsReader.ping().catch(() => {});
    }
  }, []);

  useEffect(() => {
    // SmsReader plugin only exists on Android
    if (Capacitor.getPlatform() !== 'android') return;
    SmsReader.setEnabled({ enabled: !!data.user?.autoLogSms }).catch((e) => {
      console.error("Failed to sync SMS auto-log setting to native:", e);
    });
  }, [data.user?.autoLogSms]);

  useEffect(() => {
    // SMS listener is Android-only — iOS has no SMS access API
    if (Capacitor.getPlatform() !== 'android') return;
    if (!data.user?.autoLogSms) return;

    console.log("Auto-Log SMS enabled. Registering SMS listener.");

    const listener = startSmsListener((tx) => {
      console.log("App received SMS transaction from plugin:", tx);
      setTimeout(() => {
        console.log("Adding SMS transaction to in-app queue.");
        addToSmsQueueRef.current(tx);
      }, 100);
    });
    return () => {
      listener.then((l: any) => l.remove());
    };
  }, [data.user?.autoLogSms]);

  const [showSplash, setShowSplash] = useState(true);
  const [selectedAccountForStatement, setSelectedAccountForStatement] = useState<Account | null>(null);
  const [isHubOpen, setIsHubOpen] = useState(false);

  const mainTabs: Tab[] = ['dashboard', 'accounts', 'transactions', 'settings'];
  const activeIndex = mainTabs.indexOf(activeTab);

  const appRootRef = useRef<HTMLDivElement>(null);
  const shouldLockOnReturnRef = useRef(false);
  const lastBackgroundTimeRef = useRef<number>(0);

  useEffect(() => {
    const checkAndOpenPending = async () => {
      // Launch intent check is Android-only (SMS notification deep-link)
      if (Capacitor.getPlatform() !== 'android') return;
      try {
        const { openPending } = await SmsReader.checkLaunchIntent();
        if (openPending) {
          console.log("SpendVaultSms: Launch intent 'openPending' is true. Routing to transactions tab.");
          setActiveTab('transactions');
        }
      } catch (e) {
        console.error("SpendVaultSms: Failed to check launch intent:", e);
      }
    };

    const needsAuth = data.user?.pinHash && !isAuthenticated;
    if (needsAuth || showSplash) return;

    // Check launch intent on mount/auth success
    checkAndOpenPending();

    // Drain any queued SMS transactions on initial mount (covers normal app opens where
    // appStateChange never fires — notifications are cleared inside drainPendingTransactions on native side)
    if (autoLogSmsRef.current && Capacitor.getPlatform() === 'android') {
      SmsReader.drainPendingTransactions().then(({ transactions }) => {
        transactions.forEach((tx) => {
          console.log("SpendVaultSms: Drained transaction on cold start:", tx);
          addToSmsQueueRef.current(tx);
        });
      }).catch((err) => {
        console.error("SpendVaultSms: Failed to drain transactions on cold start:", err);
      });
    }

    // Register active state resume change listener (warm restarts)
    const listener = CapApp.addListener('appStateChange', async (state) => {
      if (state.isActive) {
        console.log("SpendVaultSms: App resumed to active foreground. Checking launch intent and draining transactions...");
        
        // Proactively drain any pending SMS transactions when app is resumed (Android only)
        if (autoLogSmsRef.current && Capacitor.getPlatform() === 'android') {
          try {
            console.log("SpendVaultSms: Resume detected. Draining native pending SMS queue...");
            const { transactions } = await SmsReader.drainPendingTransactions();
            transactions.forEach((tx) => {
              console.log("SpendVaultSms: Drained transaction on warm resume:", tx);
              addToSmsQueueRef.current(tx);
            });
          } catch (err) {
            console.error("SpendVaultSms: Failed to drain transactions on warm resume:", err);
          }
        }

        setTimeout(() => {
          checkAndOpenPending();
        }, 150);
      }
    });

    return () => {
      listener.then((l: any) => l.remove());
    };
  }, [data.user?.pinHash, isAuthenticated, showSplash]);

  useEffect(() => {
    // Lock document-level scrolling to favor the dedicated root container
    document.documentElement.style.overflow = 'hidden';

    // Hide splash screen after animation completes (2.5s)
    const splashTimer = setTimeout(() => {
      setShowSplash(false);
    }, 2500);
    return () => {
      clearTimeout(splashTimer);
      document.documentElement.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'transactions') return;

    requestAnimationFrame(() => {
      appRootRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
  }, [activeTab]);

  useEffect(() => {
    if (pendingTransfer?.triggerTabSwitch) {
      // Small timeout to avoid synchronous state update in effect warning
      setTimeout(() => setActiveTab('transactions'), 0);
    }
  }, [pendingTransfer]);

  const [backPressCount, setBackPressCount] = useState(0);
  const [showExitToast, setShowExitToast] = useState(false);

  useEffect(() => {
    const handleBackButton = () => {
      if (isHubOpen) {
        setIsHubOpen(false);
        return;
      }
      if (selectedAccountForStatement) {
        setSelectedAccountForStatement(null);
        return;
      }

      // Check if any component handled the back button
      const backEvent = new CustomEvent('appBackButton', { cancelable: true });
      window.dispatchEvent(backEvent);

      if (backEvent.defaultPrevented) return;

      // If we're on the dashboard and no other state is active, implement "double back to exit"
      if (activeTab === 'dashboard') {
        if (backPressCount === 0) {
          setBackPressCount(1);
          setShowExitToast(true);
          setTimeout(() => {
            setBackPressCount(0);
            setShowExitToast(false);
          }, 2000);
        } else {
          // iOS: don't call exitApp() — Apple App Store prohibits programmatic termination
          if (Capacitor.getPlatform() === 'android') {
            CapApp.exitApp();
          }
        }
      } else {
        // If on another tab, maybe go back to dashboard?
        setActiveTab('dashboard');
      }
    };

    const listener = CapApp.addListener('backButton', handleBackButton);
    return () => {
      listener.then((l: any) => l.remove());
    };
  }, [isHubOpen, selectedAccountForStatement, activeTab, backPressCount]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!data.user?.pinHash) return;
      if (!isAuthenticated) return;

      if (document.visibilityState === 'hidden') {
        shouldLockOnReturnRef.current = true;
        lastBackgroundTimeRef.current = Date.now();
        return;
      }

      if (document.visibilityState === 'visible' && shouldLockOnReturnRef.current) {
        shouldLockOnReturnRef.current = false;
        
        // 30-second grace period for quick switches
        const elapsed = Date.now() - lastBackgroundTimeRef.current;
        if (elapsed > 30000) {
          setAuthenticated(false);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [data.user?.pinHash, isAuthenticated, setAuthenticated]);

  const needsOnboarding = !data.user?.pinHash;
  const needsAuth = data.user?.pinHash && !isAuthenticated;

  if (showSplash) {
    return <SplashScreen />;
  }

  if (needsOnboarding) {
    return <OnboardingScreen />;
  }

  if (needsAuth) {
    return <AuthScreen />;
  }

  const activeTour = (() => {
    if (!data.user) return null;
    if (!data.user.hasSeenTour) return 'onboarding';

    const featureTours = data.user.hasSeenFeatureTours || {};
    if (activeTab === 'splits' && !featureTours.splits) return 'splits';
    if (activeTab === 'debts' && !featureTours.debts) return 'debts';
    if (activeTab === 'bills' && !featureTours.bills) return 'bills';
    if (activeTab === 'cashback' && !featureTours.cashback) return 'cashback';
    if (activeTab === 'insights' && !featureTours.insights) return 'insights';

    return null;
  })();

  return (
    <div ref={appRootRef} className="app-root fade-in">
      <nav className="navbar">
        <div
          className="flex align-center gap-4"
          onClick={() => setActiveTab('dashboard')}
          style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
        >
          <TransparentLogo src="/logo.png" style={{ width: 64, height: 64, objectFit: 'contain' }} />
          <h1 className="navbar-title" style={{ fontSize: '1.75rem', marginBottom: 0, textTransform: 'lowercase' }}>spendvault</h1>
        </div>
        <div className="flex align-center gap-4">
          <button
            className={`nav-header-btn ${isHubOpen ? 'active' : ''}`}
            onClick={() => setIsHubOpen(true)}
            title="More Menu"
          >
            <LayoutGrid size={22} />
          </button>
        </div>
      </nav>

      <BillAlertBanner onNavigateToBills={() => setActiveTab('bills')} />

      {isHubOpen && (
        <div className="modal-overlay flex-center no-scroll" style={{ zIndex: 3000 }} onClick={() => setIsHubOpen(false)}>
          <div className="bottom-sheet" onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-color)', borderTop: '1px solid var(--border-color)' }}>
            <div className="flex justify-between align-center" style={{ padding: '1.5rem 1.75rem 1rem', borderBottom: '2px solid #000', marginBottom: '1rem', width: '100%' }}>
              <h3 className="text-mono uppercase" style={{ margin: 0, fontSize: '0.85rem', letterSpacing: '2px', color: 'var(--text-secondary)', fontWeight: 800 }}>SpendVault Hub</h3>
              <button onClick={() => setIsHubOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem', fontSize: '1.4rem', lineHeight: 1, display: 'flex', alignItems: 'center' }}>
                ✕
              </button>
            </div>

            <div className="flex-col gap-3 no-scrollbar" style={{ padding: '0.5rem 1.5rem 2rem', overflowY: 'auto' }}>
              <div
                className="card flex align-center gap-4 clickable"
                onClick={() => { setActiveTab('splits'); setIsHubOpen(false); }}
                style={{ padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}
              >
                <div className="flex-center" style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #6366f1, #a855f7)', color: 'white', flexShrink: 0 }}>
                  <Users size={22} />
                </div>
                <div className="flex-col flex-1">
                  <span className="font-bold uppercase text-mono" style={{ fontSize: '0.8rem', letterSpacing: '1px' }}>Group Splits</span>
                  <span className="text-xs text-muted">Shared expenses & trips</span>
                </div>
                <ChevronRight size={18} className="text-muted" />
              </div>

              <div
                className="card flex align-center gap-4 clickable"
                onClick={() => { setActiveTab('debts'); setIsHubOpen(false); }}
                style={{ padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}
              >
                <div className="flex-center" style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #f59e0b, #10b981)', color: 'white', flexShrink: 0 }}>
                  <HandCoins size={22} />
                </div>
                <div className="flex-col flex-1">
                  <span className="font-bold uppercase text-mono" style={{ fontSize: '0.8rem', letterSpacing: '1px' }}>Lending & Borrowing</span>
                  <span className="text-xs text-muted">Track owe & owed</span>
                </div>
                <ChevronRight size={18} className="text-muted" />
              </div>

              <div
                className="card flex align-center gap-4 clickable"
                onClick={() => { setActiveTab('bills'); setIsHubOpen(false); }}
                style={{ padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}
              >
                <div className="flex-center" style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', color: 'white', flexShrink: 0 }}>
                  <Calendar size={22} />
                </div>
                <div className="flex-col flex-1">
                  <span className="font-bold uppercase text-mono" style={{ fontSize: '0.8rem', letterSpacing: '1px' }}>Bills & SIPs</span>
                  <span className="text-xs text-muted">Upcoming obligations</span>
                </div>
                <ChevronRight size={18} className="text-muted" />
              </div>

              {data.accounts.some(acc => 
                acc.type === 'credit_card' && 
                (acc.isCashbackEnabled === true || (acc.isCashbackEnabled === undefined && (acc.defaultCashbackRate !== undefined || (acc.cashbackRates && acc.cashbackRates.length > 0))))
              ) && (
                <div
                  className="card flex align-center gap-4 clickable"
                  onClick={() => { setActiveTab('cashback'); setIsHubOpen(false); }}
                  style={{ padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}
                >
                  <div className="flex-center" style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #10b981, #3b82f6)', color: 'white', flexShrink: 0 }}>
                    <Gift size={22} />
                  </div>
                  <div className="flex-col flex-1">
                    <span className="font-bold uppercase text-mono" style={{ fontSize: '0.8rem', letterSpacing: '1px' }}>Rewards & Offers</span>
                    <span className="text-xs text-muted">Cashback & credit card perks</span>
                  </div>
                  <ChevronRight size={18} className="text-muted" />
                </div>
              )}

              {data.accounts.some(acc => acc.type === 'sips' || acc.type === 'stocks') && (
                <div
                  className="card flex align-center gap-4 clickable"
                  onClick={() => { setActiveTab('portfolio'); setIsHubOpen(false); }}
                  style={{ padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}
                >
                  <div className="flex-center" style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #06b6d4, #10b981)', color: 'white', flexShrink: 0 }}>
                    <TrendingUpDown size={22} />
                  </div>
                  <div className="flex-col flex-1">
                    <span className="font-bold uppercase text-mono" style={{ fontSize: '0.8rem', letterSpacing: '1px' }}>Portfolio</span>
                    <span className="text-xs text-muted">Stocks & mutual funds</span>
                  </div>
                  <ChevronRight size={18} className="text-muted" />
                </div>
              )}

              <div
                className="card flex align-center gap-4 clickable"
                onClick={() => { setActiveTab('insights'); setIsHubOpen(false); }}
                style={{ padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}
              >
                <div className="flex-center" style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: 'white', flexShrink: 0 }}>
                  <Sparkles size={22} />
                </div>
                <div className="flex-col flex-1">
                  <span className="font-bold uppercase text-mono" style={{ fontSize: '0.8rem', letterSpacing: '1px' }}>Smart Insights</span>
                  <span className="text-xs text-muted">Spend analysis & trends</span>
                </div>
                <ChevronRight size={18} className="text-muted" />
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="container flex-col gap-8 main-content" style={{ marginTop: 0 }}>
        {/* Persistent Tabs (preserve scroll) */}
        <div className="fade-in" style={{ display: activeTab === 'accounts' ? 'block' : 'none' }}>
          <Accounts onViewStatement={(acc) => setSelectedAccountForStatement(acc)} />
        </div>
        
        <div className="fade-in" style={{ display: activeTab === 'transactions' ? 'block' : 'none' }}>
          <Transactions />
        </div>

        {/* Dynamic/Resetting Tabs (unmount on change to reset scroll) */}
        {activeTab === 'dashboard' && (
          <div className="fade-in">
            <Dashboard onViewStatement={(acc) => setSelectedAccountForStatement(acc)} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="fade-in">
            <Settings />
          </div>
        )}

        {/* Other Dynamic Tabs */}
        {activeTab === 'cashback' && <div className="fade-in"><Cashback /></div>}
        {activeTab === 'portfolio' && <div className="fade-in"><Portfolio /></div>}
        {activeTab === 'insights' && <div className="fade-in"><Insights /></div>}
        {activeTab === 'splits' && <div className="fade-in"><Splits /></div>}
        {activeTab === 'bills' && <div className="fade-in"><UpcomingBills /></div>}
        {activeTab === 'debts' && <div className="fade-in"><Debts /></div>}
      </main>

      {selectedAccountForStatement && (
        <AccountStatement
          account={selectedAccountForStatement}
          transactions={data.transactions}
          onClose={() => setSelectedAccountForStatement(null)}
        />
      )}

      <div className="nav-links">
        {activeIndex !== -1 && (
          <div
            className="nav-active-pill"
            style={{
              transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * 0.5}rem))`
            }}
          />
        )}
        <button
          className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <Home size={24} strokeWidth={activeTab === 'dashboard' ? 2.5 : 1.5} />
          <span className="nav-label text-mono">home</span>
        </button>
        <button
          className={`nav-link ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          <Wallet size={24} strokeWidth={activeTab === 'accounts' ? 2.5 : 1.5} />
          <span className="nav-label text-mono">accounts</span>
        </button>
        <button
          className={`nav-link ${activeTab === 'transactions' ? 'active' : ''}`}
          onClick={() => setActiveTab('transactions')}
        >
          <ReceiptText size={24} strokeWidth={activeTab === 'transactions' ? 2.5 : 1.5} />
          <span className="nav-label text-mono">ledger</span>
        </button>
        <button
          className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <ProfileAvatar size={24} isActive={activeTab === 'settings'} />
          <span className="nav-label text-mono">profile</span>
        </button>
      </div>
      {showExitToast && (
        <div 
          style={{
            position: 'fixed',
            bottom: '100px',
            left: '0',
            right: '0',
            width: 'max-content',
            margin: '0 auto',
            background: 'var(--bg-card-elevated)',
            padding: '0.75rem 1.25rem',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 9999,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            animation: 'slideUp 0.3s ease'
          }}
        >
          <LogOut size={16} className="text-accent" />
          <span className="text-mono" style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '1px' }}>
            PRESS BACK AGAIN TO EXIT
          </span>
        </div>
      )}
      {activeTour && isAuthenticated && (
        <AppTour 
          tourType={activeTour}
          activeTab={activeTab} 
          setActiveTab={setActiveTab} 
          isHubOpen={isHubOpen} 
          setIsHubOpen={setIsHubOpen} 
        />
      )}
    </div>
  );
}

export default App;
