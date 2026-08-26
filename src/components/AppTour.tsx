import { useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useFinance } from '../FinanceContext';
import { Sparkles, ArrowRight, ArrowLeft, X, ShieldCheck, Eye, Smartphone, Zap, Gift, TrendingUp, CreditCard, MessageSquare, type LucideIcon } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import type { Tab } from '../App';

// 'cashback' is gone and 'cards' has taken its place. The Cashback vault is no longer a destination
// of its own — it is Rewards, one of three categories inside the Cards tree — so a tour that opened
// on it had nothing to open on. Everything it taught (what's pending per card, tap ✓ to confirm, the
// merge into the ledger) is now a step of the cards tour, which walks the tree that contains it.
export type TourType = 'onboarding' | 'splits' | 'debts' | 'bills' | 'cards' | 'insights' | 'wealth';

interface AppTourProps {
  tourType: TourType;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  isHubOpen: boolean;
  setIsHubOpen: (open: boolean) => void;
  isAskVaultOpen?: boolean;
  setIsAskVaultOpen?: (open: boolean) => void;
}

interface TourStep {
  title: string;
  description: string;
  selector?: string;
  tab?: Tab;
  actionBefore?: () => void;
  icon?: LucideIcon;
  cardPosition?: 'bottom' | 'top';
  /**
   * Selector for a set of cards to walk a pointing finger across, one per 1.8s, while this step is
   * shown. Replaces matching on the step's TITLE, which is how this used to be keyed — two tours now
   * have a category row that wants the same treatment, and one of them would have had to be found by
   * a string that also has to read well on screen.
   */
  demoCycle?: string;
}

export default function AppTour({ tourType, activeTab, setActiveTab, isHubOpen, setIsHubOpen, isAskVaultOpen, setIsAskVaultOpen }: AppTourProps) {
  const { data, loadDemoData, clearDemoData, updateUser } = useFinance();
  const [currentStep, setCurrentStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const [isTourModalOpen, setIsTourModalOpen] = useState(false);
  const [isHubTourOpenActive, setIsHubTourOpenActive] = useState(false);

  // Initialize/load demo data immediately on mount
  useEffect(() => {
    loadDemoData();
    return () => {
      // Just in case, clean up demo data on unmount
      clearDemoData();
    };
  }, [tourType]);

  // Step 6 (Smart Features) is platform-aware: Android leads with automatic SMS logging, while
  // web/iOS show the AI/wealth helpers that apply there. Same spotlight target — the grid
  // simply renders the subset of tiles available on each platform.
  const isAndroid = Capacitor.getPlatform() === 'android';

  const tours: Record<TourType, TourStep[]> = {
    onboarding: [
      {
        title: "Welcome to SpendVault",
        description: "SpendVault is a private, local-first finance vault. All your accounts, transactions, and settings are stored locally on this device. No tracking, and complete control.",
        icon: ShieldCheck
      },
      {
        title: "Dashboard Overview",
        description: "Your home screen answers one question: what this month cost. Tap the ring below it to see where the money went, or the Cards and Wealth plaques to open what you owe and what you own. We've populated some sample data so you can see SpendVault in action!",
        selector: ".tour-dashboard-stats",
        tab: "dashboard",
        icon: Sparkles
      },
      {
        title: "Your Accounts Vault",
        description: "Manage bank savings, credit cards, e-wallets, or NCMC travel cards. This shows your current balances and statement due tracking.",
        selector: ".tour-first-account",
        tab: "accounts",
        icon: Eye
      },
      {
        title: "Interactive Ledger",
        description: "All transaction logs support quick gestures! Watch below: Swipe right to delete, tap to edit details, and long-press to manually drag & reorder.",
        selector: ".tour-demo-month-header, .tour-demo-day-group",
        tab: "transactions",
        icon: Smartphone
      },
      {
        title: "SpendVault Hub",
        description: "Tap the Hub icon for the features that have no tab of their own: Group Splits, Lending & Borrowing, Bills, and Smart Insights. Cards and Wealth have their own plaques on the dashboard. Detailed tours activate automatically the first time you open any of them!",
        selector: ".tour-hub-btn",
        tab: "dashboard",
        icon: Zap
      },
      {
        title: "AskVault AI Assistant",
        description: "Talk to AskVault — your private financial AI. Ask questions about your spending, calculate budgets, or look up past transactions in plain English!",
        selector: ".tour-askvault-btn",
        tab: "dashboard",
        icon: MessageSquare,
        cardPosition: 'bottom'
      },
      {
        title: "Smart Features",
        description: isAndroid
          ? "SpendVault does the busywork for you. Auto-Log SMS reads your bank's transaction texts and logs spends automatically — add a Gemini key to enable an AI filter that drops promos & OTPs. Commodity AI and Asset Logos enrich your wealth dashboard, and Passive Logs let you keep investments or pass-through expenses out of your budget stats."
          : "Power up your vault. Add a Gemini key for AI-estimated commodity prices and real brand logos on your holdings, and use Passive Logs to flag investments or pass-through expenses so they don't distort your budget stats. (Automatic bank-SMS logging is available on the Android app.)",
        selector: ".tour-smart-features",
        tab: "settings",
        actionBefore: () => setIsHubOpen(false),
        icon: Sparkles
      },
      {
        title: "Ready to Start?",
        description: "You're all set! Let's clear the onboarding sample data so you can start fresh with your own expenses.",
        icon: ShieldCheck
      }
    ],
    splits: [
      {
        title: "Group Splits Tour",
        description: "Welcome to Group Splits! This feature allows you to split shared expenses with friends or housemates. You can create one-time splits or recurring cycles.",
        icon: ShieldCheck
      },
      {
        title: "Split Event",
        description: "Here is a sample split event, 'Manali Road Trip'. You can add expenses here, and SpendVault will automatically split them equally or unequally.",
        selector: ".tour-split-event-card",
        actionBefore: () => window.dispatchEvent(new CustomEvent('tour-close-split-detail')),
        icon: Sparkles
      },
      {
        title: "Inside a Split",
        description: "SpendVault shows your share, net balance, and each person's dues. Tap a person to mark them paid. Expenses are listed below — and use the Share button in the header to share the full summary as an image.",
        selector: ".tour-split-detail-header, .tour-split-detail-summary, .tour-split-per-person",
        actionBefore: () => window.dispatchEvent(new CustomEvent('tour-open-split-detail')),
        icon: Sparkles
      },
      {
        title: "Explore Group Splits",
        description: "You're ready to create your own split groups! We will clear the sample trip data now.",
        actionBefore: () => window.dispatchEvent(new CustomEvent('tour-close-split-detail')),
        icon: ShieldCheck
      }
    ],
    debts: [
      {
        title: "Lending & Borrowing Tour",
        description: "Welcome to Lending & Borrowing! Keep track of money lent to or borrowed from your friends and contacts.",
        icon: ShieldCheck
      },
      {
        title: "Debt Record",
        description: "Here is a sample lending record showing Rohan owes you money. You can add logs, record repayments, and settle balances easily.",
        selector: ".tour-debt-record-card",
        actionBefore: () => window.dispatchEvent(new CustomEvent('tour-close-debt-detail')),
        icon: Sparkles
      },
      {
        title: "Inside a Debt",
        description: "Open any person to see the running net balance, add lent/borrowed/repayment entries, and review the full transaction history for that relationship.",
        selector: ".tour-debt-detail-summary, .tour-debt-tx-log",
        actionBefore: () => window.dispatchEvent(new CustomEvent('tour-open-debt-detail')),
        icon: Sparkles,
        cardPosition: 'bottom'
      },
      {
        title: "Start Logging Debts",
        description: "You're ready! We will clear the sample debts now so you can log your own records.",
        actionBefore: () => window.dispatchEvent(new CustomEvent('tour-close-debt-detail')),
        icon: ShieldCheck
      }
    ],
    bills: [
      {
        title: "Bills Tour",
        description: "Welcome to Bills! Track upcoming monthly utility payments, subscriptions and credit card statement bills — anything with a due date you don't want to miss.",
        icon: ShieldCheck
      },
      {
        title: "Upcoming Obligations",
        description: "Here is a sample recurring Electricity Bill. SpendVault calculates days remaining, reminds you, and lets you link them to ledger transactions.",
        selector: ".tour-bill-card",
        icon: Sparkles
      },
      {
        title: "Bill Actions",
        description: "Each tracked bill gives you quick actions: LOG a fresh payment, LINK an existing ledger transaction, or tap PAID. All three roll the bill to its next cycle — a recurring bill is never 'done', it just becomes due again.",
        selector: ".tour-demo-bill-actions",
        icon: Sparkles
      },
      {
        title: "Track Your Bills",
        description: "Awesome! Let's clear the sample bill now and start tracking your own bills.",
        icon: ShieldCheck
      }
    ],
    cards: [
      {
        title: "Cards Tour",
        description: "Welcome to Cards — everything your credit cards owe, bill and earn, in one place. Open it any time from the Cards plaque on your dashboard.",
        icon: CreditCard
      },
      {
        title: "What You Owe",
        description: "Your total outstanding across every card, split into what has been billed and what is still accruing on the open cycle. The bar below is how much of your combined credit limit is in use, and the line under it names the card whose bill lands first.",
        selector: ".tour-cards-summary",
        icon: Sparkles
      },
      {
        title: "Three Categories",
        description: "Dues is what you owe right now. Statements is every cycle that has already been cut, newest first. Rewards is cashback and points waiting to be credited. Tap any category to open it — then tap any card for its own statement screen, with a cycle picker and that cycle's ledger.",
        selector: ".tour-cards-categories",
        cardPosition: 'top',
        demoCycle: ".tour-cards-categories .card",
        // Backing up to this step from the one below has to close the category that step opened,
        // or the spotlight lands on rows that are no longer on screen.
        actionBefore: () => window.dispatchEvent(new CustomEvent('tour-cards-category', { detail: null })),
        icon: Sparkles
      },
      {
        title: "Claim Your Rewards",
        description: "Each card shows the cashback it has earned but not yet been paid. Tap the ✓ once your bank credits it — SpendVault then merges that cycle's rewards into a single credit and logs it into your ledger, handling the date and category for you.",
        selector: ".tour-cashback-statement",
        // The tour can navigate TABS on its own; it cannot navigate a tree. The Cards screen listens
        // for this event so a step can open one of its categories — the same trick the splits tour
        // uses to close a detail view.
        actionBefore: () => window.dispatchEvent(new CustomEvent('tour-cards-category', { detail: 'rewards' })),
        icon: Gift
      },
      {
        title: "Stay Ahead of Your Bills",
        description: "That's Cards. We'll clear the sample cards now so you can add your own from the Accounts tab.",
        actionBefore: () => window.dispatchEvent(new CustomEvent('tour-cards-category', { detail: null })),
        icon: ShieldCheck
      }
    ],
    insights: [
      {
        title: "Smart Insights Tour",
        description: "Welcome to Smart Insights! Explore interactive category spend charts, account-wise distributions, and monthly averages.",
        icon: ShieldCheck
      },
      {
        title: "Spend Analysis",
        description: "Here you can see the spend by category chart. Toggle months to compare history and analyze trends.",
        selector: ".insights-tab-root .card",
        icon: Sparkles
      },
      {
        title: "Start Analyzing",
        description: "Excellent! Let's clear the sample insights and start tracking your finances.",
        icon: ShieldCheck
      }
    ],
    wealth: [
      {
        title: "Wealth Tour",
        description: "Welcome to your Wealth dashboard! Everything you own in one place — market investments, liquid cash, and retirement savings.",
        icon: TrendingUp
      },
      {
        title: "Your Total Wealth",
        description: "Everything you own, added up: market investments, the cash in your bank accounts and wallets, and your retirement savings. Below it, today's gain or loss across your market holdings.",
        selector: ".tour-wealth-summary",
        icon: Sparkles
      },
      {
        title: "Three Categories",
        description: "Your wealth is split into Portfolio (stocks, funds, metals), Assets (bank, cash, e-wallets) and Retirement (EPF). Tap any category to open it — then tap any row for its own detail screen, with a price or balance chart, its figures for the month, and its recent activity. Categories you don't use yet stay hidden.",
        selector: ".tour-wealth-categories",
        cardPosition: 'top',
        icon: Sparkles
      },
      {
        title: "Track Your Wealth",
        description: "You're all set! We'll clear the sample accounts now so you can add your own from the Accounts tab.",
        icon: ShieldCheck
      }
    ]
  };

  const steps = tours[tourType];
  const stepInfo = steps[currentStep];

  // Manage tab changes and action triggers for each step
  useEffect(() => {
    if (stepInfo.actionBefore) {
      stepInfo.actionBefore();
    }
    if (stepInfo.tab && activeTab !== stepInfo.tab) {
      setActiveTab(stepInfo.tab);
    }
    if (stepInfo.title === "Smart Features") {
      setTimeout(() => {
        const targetEl = document.querySelector('.tour-smart-features');
        const cardEl = document.querySelector('.tour-card');
        const appRoot = document.querySelector('.app-root');
        if (targetEl && appRoot) {
          const cardBottom = cardEl ? cardEl.getBoundingClientRect().bottom : 380;
          const targetTop = targetEl.getBoundingClientRect().top;
          const desiredTop = cardBottom + 12;
          const diff = targetTop - desiredTop;
          appRoot.scrollTop += diff;
          window.dispatchEvent(new Event('resize'));
          setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
        }
      }, 150);
    }
  }, [currentStep, tourType]);

  // Manage dynamic row animation classes and Hub open/close triggers
  useEffect(() => {
    const clearClasses = () => {
      document.querySelectorAll('.transaction-row').forEach(el => {
        el.classList.remove('demo-active', 'demo-active-second');
      });
      document.querySelectorAll('.nav-header-btn, .tour-hub-btn, .tour-askvault-btn').forEach(btn => {
        btn.classList.remove('demo-hub-active', 'demo-hub-finger', 'demo-askvault-active', 'demo-askvault-finger');
      });
      document.querySelectorAll('.tour-wealth-tab-btn, .tour-wealth-categories .card, .tour-cards-categories .card').forEach(btn => {
        btn.classList.remove('demo-tab-active', 'demo-tab-finger');
      });
    };

    clearClasses();
    setIsTourModalOpen(false);
    setIsHubTourOpenActive(false);

    let editTimer1: number | null = null;
    let editTimer2: number | null = null;
    let loopInterval: number | null = null;
    let hubTimer1: number | null = null;
    let hubTimer2: number | null = null;
    let hubInterval: number | null = null;
    let askTimer1: number | null = null;
    let askTimer2: number | null = null;
    let askInterval: number | null = null;
    let wealthTimer: number | null = null;
    let wealthInterval: number | null = null;
    let insightsScrollCleanup: (() => void) | null = null;

    if (tourType === 'onboarding' && stepInfo) {
      if (stepInfo.title === "Interactive Ledger") {
        const rows = document.querySelectorAll('.transactions-tab-root .transaction-row');
        if (rows[0]) {
          rows[0].classList.add('demo-active');
        }
        if (rows[1]) {
          rows[1].classList.add('demo-active-second');
        }

        const runCycle = () => {
          setIsTourModalOpen(false);

          // Schedule Edit Modal Open
          editTimer1 = window.setTimeout(() => {
            setSpotlightRect(null);
            setIsTourModalOpen(true);
            window.dispatchEvent(new CustomEvent('tour-open-edit'));
          }, 4200);

          // Schedule Edit Modal Close.
          // Fires tour-close-edit so Transactions plays the slide-down animation,
          // then waits 380ms (animation + buffer) before restoring the tour card.
          // Two-phase reveal: position the card while still hidden, then reveal —
          // so the CSS position transition never fires and the card appears in-place.
          editTimer2 = window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('tour-close-edit'));
            window.setTimeout(() => {
              if (stepInfo.selector) {
                const rects: DOMRect[] = [];
                stepInfo.selector.split(',').map((s: string) => s.trim()).filter(Boolean).forEach((sel: string) =>
                  document.querySelectorAll(sel).forEach(el => rects.push(el.getBoundingClientRect()))
                );
                if (rects.length > 0) {
                  const top = Math.min(...rects.map(r => r.top));
                  const left = Math.min(...rects.map(r => r.left));
                  const right = Math.max(...rects.map(r => r.right));
                  const bottom = Math.max(...rects.map(r => r.bottom));
                  flushSync(() => setSpotlightRect(
                    { top, left, width: right - left, height: bottom - top, right, bottom, x: left, y: top, toJSON: () => ({}) } as DOMRect
                  ));
                }
              }
              setIsTourModalOpen(false);
            }, 380);
          }, 6500);
        };

        runCycle();
        loopInterval = window.setInterval(runCycle, 10000);
      } else if (stepInfo.title === "SpendVault Hub") {
        const hubBtn = document.querySelector('.tour-hub-btn');
        if (hubBtn) {
          // demo-hub-active stays for the full step (position anchor for ::after)
          hubBtn.classList.add('demo-hub-active');
        }

        // Explicitly restart the finger animation each cycle so it's
        // never knocked out of sync by React re-renders touching the button.
        // Also re-asserts demo-hub-active because React may have replaced the
        // DOM node (losing manually-added classes), which would cause ::after
        // to lose its position:relative anchor and jump to the screen centre.
        const triggerHubFinger = () => {
          const b = document.querySelector('.tour-hub-btn');
          if (!b) return;
          b.classList.add('demo-hub-active');   // ensure position:relative anchor
          b.classList.remove('demo-hub-finger');
          void (b as HTMLElement).offsetWidth;  // force reflow to restart animation
          b.classList.add('demo-hub-finger');
        };

        const runHubCycle = () => {
          setIsHubTourOpenActive(false);
          setIsHubOpen(false);
          triggerHubFinger();

          // At 2000ms, open the bottom sheet
          hubTimer1 = window.setTimeout(() => {
            setIsHubTourOpenActive(true);
            setIsHubOpen(true);
          }, 2000);

          // At 6000ms, close the bottom sheet
          hubTimer2 = window.setTimeout(() => {
            setIsHubTourOpenActive(false);
            setIsHubOpen(false);
          }, 6000);
        };

        runHubCycle();
        hubInterval = window.setInterval(runHubCycle, 6500);
      } else if (stepInfo.title === "AskVault AI Assistant") {
        const askBtn = document.querySelector('.tour-askvault-btn');
        if (askBtn) {
          askBtn.classList.add('demo-askvault-active');
        }

        const triggerAskFinger = () => {
          const b = document.querySelector('.tour-askvault-btn');
          if (!b) return;
          b.classList.add('demo-askvault-active');
          b.classList.remove('demo-askvault-finger');
          void (b as HTMLElement).offsetWidth;
          b.classList.add('demo-askvault-finger');
        };

        const runAskCycle = () => {
          if (setIsAskVaultOpen) setIsAskVaultOpen(false);
          triggerAskFinger();

          // At 2000ms, open AskVault
          askTimer1 = window.setTimeout(() => {
            if (setIsAskVaultOpen) setIsAskVaultOpen(true);
          }, 2000);

          // At 6000ms, close AskVault
          askTimer2 = window.setTimeout(() => {
            if (setIsAskVaultOpen) setIsAskVaultOpen(false);
          }, 6000);
        };

        runAskCycle();
        askInterval = window.setInterval(runAskCycle, 6500);
      }
    }

    if (tourType === 'insights' && stepInfo && stepInfo.title === "Spend Analysis") {
      const appRoot = document.querySelector('.app-root') as HTMLElement | null;
      if (appRoot) {
        let active = true;
        let rafId = 0;
        let cycleStart: number | null = null;

        // Timing (ms): slow scroll down → brief pause → faster scroll back up → pause
        const DOWN_MS   = 5000;
        const BOT_MS    = 800;
        const UP_MS     = 3000;
        const TOP_MS    = 600;
        const CYCLE     = DOWN_MS + BOT_MS + UP_MS + TOP_MS;

        const ease = (t: number) => 0.5 - Math.cos(t * Math.PI) / 2;

        const tick = (ts: number) => {
          if (!active) return;
          if (cycleStart === null) cycleStart = ts;

          const max = appRoot.scrollHeight - appRoot.clientHeight;
          if (max > 0) {
            const phase = (ts - cycleStart) % CYCLE;
            let target: number;
            if (phase < DOWN_MS) {
              target = ease(phase / DOWN_MS) * max;
            } else if (phase < DOWN_MS + BOT_MS) {
              target = max;
            } else if (phase < DOWN_MS + BOT_MS + UP_MS) {
              target = (1 - ease((phase - DOWN_MS - BOT_MS) / UP_MS)) * max;
            } else {
              target = 0;
            }
            appRoot.scrollTop = target;
          }

          rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
        insightsScrollCleanup = () => {
          active = false;
          cancelAnimationFrame(rafId);
          appRoot.scrollTo({ top: 0, behavior: 'instant' });
        };
      }
    }

    // Walks a finger down the category cards so the user sees they're tappable. Unlike the old
    // filter-pill demo this must NOT click: a click navigates into the sub-view, which would
    // strand the spotlight on an element that no longer exists.
    // Keyed off the step's own demoCycle selector rather than off its title and tour: both the wealth
    // tree and the cards tree have a category row that wants this, and the two rows are named the
    // same thing on screen for the same reason.
    if (stepInfo?.demoCycle) {
      const cycleSelector = stepInfo.demoCycle;
      let tabIdx = 0;
      const triggerCardCycle = () => {
        const cards = document.querySelectorAll(cycleSelector);
        if (cards.length === 0) return;

        cards.forEach(c => {
          c.classList.remove('demo-tab-active', 'demo-tab-finger');
        });

        const currentCard = cards[tabIdx % cards.length] as HTMLElement;
        if (currentCard) {
          currentCard.classList.add('demo-tab-active');
          void currentCard.offsetWidth;
          currentCard.classList.add('demo-tab-finger');
        }
        tabIdx++;
      };

      wealthTimer = window.setTimeout(() => {
        triggerCardCycle();
        wealthInterval = window.setInterval(triggerCardCycle, 1800);
      }, 1000);
    }

    return () => {
      clearClasses();
      setIsTourModalOpen(false);
      setIsHubTourOpenActive(false);
      setIsHubOpen(false);
      if (setIsAskVaultOpen) setIsAskVaultOpen(false);
      if (editTimer1) clearTimeout(editTimer1);
      if (editTimer2) clearTimeout(editTimer2);
      if (loopInterval) clearInterval(loopInterval);
      if (hubTimer1) clearTimeout(hubTimer1);
      if (hubTimer2) clearTimeout(hubTimer2);
      if (hubInterval) clearInterval(hubInterval);
      if (askTimer1) clearTimeout(askTimer1);
      if (askTimer2) clearTimeout(askTimer2);
      if (askInterval) clearInterval(askInterval);
      if (wealthTimer) clearTimeout(wealthTimer);
      if (wealthInterval) clearInterval(wealthInterval);
      if (insightsScrollCleanup) insightsScrollCleanup();
      window.dispatchEvent(new CustomEvent('tour-close-edit'));
      document.body.classList.remove('tour-debt-inside-active');
    };
  }, [currentStep, tourType, activeTab]);

  // Recalculate spotlight size/position based on selector
  useEffect(() => {
    let selector = isTourModalOpen ? '.bottom-sheet' : stepInfo.selector;
    if (tourType === 'onboarding' && stepInfo && stepInfo.title === "SpendVault Hub" && isHubTourOpenActive) {
      selector = '.bottom-sheet';
    }
    if (tourType === 'onboarding' && stepInfo && stepInfo.title === "AskVault AI Assistant" && isAskVaultOpen) {
      selector = '.tour-askvault-chat';
    }

    if (!selector) {
      setSpotlightRect(null);
      return;
    }

    const updateSpotlight = () => {
      // Support comma-separated multi-selectors: compute union bounding rect of all matches
      const selectors = selector.split(',').map(s => s.trim()).filter(Boolean);
      const rects: DOMRect[] = [];
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          rects.push(el.getBoundingClientRect());
        });
      });

      if (rects.length === 0) {
        setSpotlightRect(null);
        return;
      }

      // Union rect: smallest box containing all matched elements
      const top = Math.min(...rects.map(r => r.top));
      const left = Math.min(...rects.map(r => r.left));
      const right = Math.max(...rects.map(r => r.right));
      const bottom = Math.max(...rects.map(r => r.bottom));
      setSpotlightRect({ top, left, width: right - left, height: bottom - top, right, bottom, x: left, y: top, toJSON: () => ({}) } as DOMRect);
    };

    // .bottom-sheet and .tour-askvault-chat have slide-up animations — wait for them to finish before reading rect
    const delay = (selector === '.bottom-sheet' || selector === '.tour-askvault-chat') ? 400 : 150;
    const timer = setTimeout(updateSpotlight, delay);
    // Second backup read slightly later for slow-rendering devices
    const timer2 = (selector === '.bottom-sheet' || selector === '.tour-askvault-chat') ? setTimeout(updateSpotlight, 550) : null;
    const timer3 = setTimeout(updateSpotlight, 1000);
    const timer4 = setTimeout(updateSpotlight, 1800);
    window.addEventListener('resize', updateSpotlight);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateSpotlight();
      });
      const selectors = selector.split(',').map(s => s.trim()).filter(Boolean);
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          resizeObserver?.observe(el);
        });
      });
    }

    return () => {
      clearTimeout(timer);
      if (timer2) clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
      window.removeEventListener('resize', updateSpotlight);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [currentStep, activeTab, isHubOpen, tourType, isTourModalOpen, isHubTourOpenActive, isAskVaultOpen]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const finishTour = () => {
    clearDemoData();
    document.body.classList.remove('tour-debt-inside-active');
    if (!data.user) return;

    if (tourType === 'onboarding') {
      updateUser({ ...data.user, hasSeenTour: true });
    } else {
      const featureTours = { ...(data.user.hasSeenFeatureTours || {}) };
      featureTours[tourType] = true;
      updateUser({ ...data.user, hasSeenFeatureTours: featureTours });
    }
  };

  const getCardStyle = (): React.CSSProperties | undefined => {
    const cardWidth = Math.min(340, window.innerWidth - 32);

    if ((stepInfo.title === "SpendVault Hub" && isHubTourOpenActive) || 
        stepInfo.title === "Smart Features" ||
        stepInfo.cardPosition === 'top') {
      const left = (window.innerWidth - cardWidth) / 2;
      return {
        position: 'fixed',
        top: 'calc(var(--safe-area-inset-top) + 16px)',
        bottom: 'auto',
        left: `${left}px`,
        width: `${cardWidth}px`,
        transform: 'none',
        zIndex: 99999
      };
    }

    if (stepInfo.cardPosition === 'bottom') {
      const left = (window.innerWidth - cardWidth) / 2;
      return {
        position: 'fixed',
        bottom: 'calc(var(--safe-area-inset-bottom) + 8px)',
        top: 'auto',
        left: `${left}px`,
        width: `${cardWidth}px`,
        transform: 'none'
      };
    }

    if (!spotlightRect) {
      const left = (window.innerWidth - cardWidth) / 2;
      const top = (window.innerHeight - 240) / 2;
      return {
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${cardWidth}px`,
        transform: 'none'
      };
    }

    const left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, spotlightRect.left + (spotlightRect.width / 2) - (cardWidth / 2)));
    const spaceBelow = window.innerHeight - spotlightRect.bottom;

    if (spaceBelow < 280) {
      const bottomVal = Math.max(16, Math.min(window.innerHeight - 260, window.innerHeight - spotlightRect.top + 16));
      return {
        position: 'fixed',
        bottom: `${bottomVal}px`,
        top: '',
        left: `${left}px`,
        width: `${cardWidth}px`,
        transform: 'none'
      };
    } else {
      const topVal = Math.max(16, Math.min(window.innerHeight - 260, spotlightRect.bottom + 16));
      return {
        position: 'fixed',
        top: `${topVal}px`,
        bottom: '',
        left: `${left}px`,
        width: `${cardWidth}px`,
        transform: 'none'
      };
    }
  };

  const StepIcon = stepInfo.icon || Sparkles;

  return (
    <div className="tour-root">
      {/* Semi-transparent Backdrop with spotlight border mask */}
      <div
        className={`tour-overlay ${isTourModalOpen ? 'tour-hidden' : ''}`}
        style={{
          background: spotlightRect ? 'transparent' : 'rgba(10, 10, 12, 0.75)',
          backdropFilter: spotlightRect ? 'none' : 'blur(4px)',
        }}
        onClick={stepInfo.selector ? undefined : finishTour}
      />

      {/* Spotlight Window overlay */}
      {spotlightRect && (
        <div
          className={`tour-spotlight ${isTourModalOpen ? 'tour-hidden' : ''}`}
          style={{
            top: spotlightRect.top - 8,
            left: spotlightRect.left - 8,
            width: spotlightRect.width + 16,
            height: spotlightRect.height + 16,
          }}
        />
      )}

      {/* Tour card containing info */}
      <div
        className={`tour-card fade-in ${!stepInfo.selector ? 'centered' : ''} ${isTourModalOpen ? 'tour-hidden' : ''}`}
        style={getCardStyle()}
      >
        <div className="flex-col gap-4">
          <div className="flex justify-between align-center">
            <div className="flex align-center" style={{ gap: '0.75rem' }}>
              <div className="tour-icon-bg">
                <StepIcon size={18} className="text-accent animate-pulse" />
              </div>
              <span className="text-mono uppercase font-bold text-xs" style={{ color: 'var(--text-muted)', letterSpacing: '1px' }}>
                step {currentStep + 1} of {steps.length}
              </span>
            </div>
            <button className="tour-close-btn" onClick={finishTour} title="Skip Tour">
              <X size={16} />
            </button>
          </div>

          <div className="flex-col gap-2">
            <h3 className="tour-title">{stepInfo.title}</h3>
            <p className="tour-description">{stepInfo.description}</p>
          </div>

          {currentStep === steps.length - 1 ? (
            <div className="flex-col gap-2" style={{ marginTop: '0.5rem' }}>
              <button
                className="btn btn-primary w-100 flex-center gap-2"
                style={{ padding: '0.85rem', background: 'linear-gradient(135deg, var(--accent), #4f46e5)' }}
                onClick={finishTour}
              >
                Finish & Start Fresh
              </button>
            </div>
          ) : (
            <div className="flex justify-between align-center" style={{ marginTop: '0.5rem' }}>
              {currentStep > 0 ? (
                <button className="tour-btn-nav" onClick={handleBack}>
                  <ArrowLeft size={16} /> Back
                </button>
              ) : (
                <button className="tour-btn-nav" onClick={finishTour}>
                  Skip Tour
                </button>
              )}
              <button className="btn btn-primary flex-center gap-2" style={{ padding: '0.5rem 1rem' }} onClick={handleNext}>
                Next <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .tour-root {
          position: fixed;
          inset: 0;
          z-index: 99990;
          pointer-events: none;
        }
        .tour-overlay {
          position: fixed;
          inset: 0;
          pointer-events: auto;
          transition: background 0.3s ease, backdrop-filter 0.3s ease, opacity 0.3s ease, visibility 0.3s;
        }
        .tour-spotlight {
          position: fixed;
          border-radius: 16px;
          border: 2px solid var(--accent);
          box-shadow: 0 0 0 9999px rgba(10, 10, 12, 0.75);
          transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease, visibility 0.3s;
          z-index: 99991;
          pointer-events: none;
          box-shadow: 0 0 0 9999px rgba(10, 10, 12, 0.75), 0 0 20px rgba(99, 102, 241, 0.5);
        }
        .tour-card {
          pointer-events: auto;
          background: rgba(20, 20, 25, 0.85);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 1.5rem;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
          z-index: 99992;
          transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease, visibility 0.3s;
        }
        .tour-card.centered {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 380px;
          max-width: 90vw;
        }
        .tour-hidden {
          opacity: 0 !important;
          pointer-events: none !important;
          visibility: hidden !important;
          transition: none !important;
        }
        .tour-icon-bg {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.15);
          border: 1px solid rgba(99, 102, 241, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .tour-close-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 0.25rem;
          opacity: 0.7;
          transition: opacity 0.2s;
        }
        .tour-close-btn:hover {
          opacity: 1;
        }
        .tour-title {
          font-family: 'Montserrat', sans-serif;
          font-weight: 800;
          font-size: 1.25rem;
          color: var(--text-primary);
          margin: 0;
          text-transform: lowercase;
        }
        .tour-description {
          font-size: 0.85rem;
          line-height: 1.5;
          color: var(--text-secondary);
          margin: 0;
        }
        .tour-btn-nav {
          background: none;
          border: none;
          color: var(--text-muted);
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0;
          transition: color 0.2s;
        }
        .tour-btn-nav:hover {
          color: var(--text-primary);
        }

        /* Tour-only modal slide-down dismiss animation */
        @keyframes tourSlideDown {
          from { transform: translateY(0); }
          to { transform: translateY(110%); }
        }
        @keyframes tourOverlayFadeOut {
          from { background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
          to   { background: rgba(0, 0, 0, 0);    backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); }
        }
        .modal-content.tour-modal-closing {
          animation: tourSlideDown 0.35s cubic-bezier(0.4, 0, 0.8, 1) forwards !important;
        }
        .modal-overlay.tour-modal-overlay-closing {
          animation: tourOverlayFadeOut 0.35s cubic-bezier(0.4, 0, 0.8, 1) forwards !important;
          pointer-events: none;
        }

        /* Dynamic ledger row swipe/edit/reorder animations */
        .transaction-row.demo-active,
        .transaction-row.demo-active-second {
          --demo-row-shift: 63px;
        }
        .transaction-row.demo-active {
          --demo-swipe-distance: clamp(160px, 46vw, 260px);
          --demo-delete-gap: 1rem;
          animation: demoLedgerFlow 10s infinite ease-in-out;
          position: relative;
          z-index: 10 !important;
        }
        .transaction-row.demo-active::before {
          content: 'DELETE';
          position: absolute;
          left: calc(var(--demo-swipe-distance) * -1);
          top: 0;
          height: 100%;
          background: var(--danger);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding-right: 1rem;
          color: white;
          font-weight: 800;
          font-size: 0.75rem;
          letter-spacing: 1px;
          font-family: var(--font-mono);
          z-index: 1;
          animation: demoDeleteBlock 10s infinite ease-in-out;
        }
        .transaction-row.demo-active-second {
          animation: demoLedgerSecondRow 10s infinite ease-in-out;
          position: relative;
        }

        /* Animated Touch Finger Pointer for Hub & AskVault Icons */
        .tour-hub-btn.demo-hub-active, .tour-askvault-btn.demo-askvault-active {
          position: relative;
        }
        /* demo-hub-finger is removed+reflow+re-added each JS cycle so the
           browser always restarts from frame 0, immune to React re-renders. */
        .tour-hub-btn.demo-hub-finger::after, .tour-askvault-btn.demo-askvault-finger::after {
          content: '';
          position: absolute;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.45);
          border: 2px solid rgba(255, 255, 255, 0.9);
          box-shadow: 0 0 10px rgba(99, 102, 241, 0.8), inset 0 0 8px rgba(255, 255, 255, 0.6);
          pointer-events: none;
          z-index: 100;
          left: 50%;
          top: 50%;
          opacity: 0;
          animation: demoHubFinger 2s ease-in-out forwards;
        }

        .tour-wealth-tab-btn.demo-tab-active,
        .tour-wealth-categories .card.demo-tab-active {
          position: relative;
        }
        .tour-wealth-tab-btn.demo-tab-finger::after,
        .tour-wealth-categories .card.demo-tab-finger::after {
          content: '';
          position: absolute;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.55);
          border: 2px solid rgba(255, 255, 255, 0.95);
          box-shadow: 0 0 10px rgba(99, 102, 241, 0.9), inset 0 0 8px rgba(255, 255, 255, 0.7);
          pointer-events: none;
          z-index: 100;
          left: 50%;
          top: 50%;
          opacity: 0;
          animation: demoTabFinger 0.7s ease-in-out forwards;
        }

        @keyframes demoTabFinger {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(1.3); }
          35% { opacity: 0.95; transform: translate(-50%, -50%) scale(0.85); }
          70%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
        }

        @keyframes demoHubFinger {
          /* 0–300ms: idle */
          0%, 15% { opacity: 0; transform: translate(-50%, -50%) scale(1.1); }
          /* 300–500ms: fade in & tap */
          25% { opacity: 0.85; transform: translate(-50%, -50%) scale(1.1); }
          38% { opacity: 0.95; transform: translate(-50%, -50%) scale(0.8); }
          /* 500–700ms: lift & fade */
          55%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
        }

        /* Animated Touch Finger Pointer */
        .transaction-row.demo-active::after {
          content: '';
          position: absolute;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.45);
          border: 2px solid rgba(255, 255, 255, 0.9);
          box-shadow: 0 0 10px rgba(99, 102, 241, 0.8), inset 0 0 8px rgba(255, 255, 255, 0.6);
          pointer-events: none;
          z-index: 100;
          left: 20px;
          top: 50%;
          transform: translateY(-50%) scale(1);
          opacity: 0;
          animation: demoFinger 10s infinite ease-in-out;
        }

        @keyframes demoLedgerFlow {
          /* 0% to 20%: Idle (reads first) */
          0%, 20% { transform: translateX(0) scale(1) translateY(0); background: transparent; box-shadow: none; z-index: 1; }
          
          /* 20% to 35%: Swipe to Delete */
          25%, 35% { transform: translateX(var(--demo-swipe-distance)) scale(1) translateY(0); background: rgba(239, 68, 68, 0.2); box-shadow: none; z-index: 1; }
          40% { transform: translateX(0) scale(1) translateY(0); background: transparent; box-shadow: none; z-index: 1; }
          
          /* 40% to 42%: Tap highlight */
          41% { transform: translateX(0) scale(0.96) translateY(0); filter: brightness(1.25); }
          42%, 65% { transform: translateX(0) scale(1) translateY(0); filter: brightness(1); }
          
          /* 65% to 70%: Long press lift */
          70% { transform: translateX(0) scale(1.02) translateY(0); box-shadow: 0 8px 25px rgba(99, 102, 241, 0.4); z-index: 15; }
          
          /* 70% to 92%: Drag down (swap completed) */
          75%, 92% { transform: translateX(0) scale(1.02) translateY(var(--demo-row-shift)); box-shadow: 0 8px 25px rgba(99, 102, 241, 0.4); z-index: 15; }
          
          /* 92% to 96%: Reset */
          96%, 100% { transform: translateX(0) scale(1) translateY(0); box-shadow: none; z-index: 1; }
        }
        @keyframes demoDeleteBlock {
          0%, 20% { opacity: 0; width: 0; }
          25%, 35% { opacity: 1; width: calc(var(--demo-swipe-distance) - var(--demo-delete-gap)); }
          40%, 100% { opacity: 0; width: 0; }
        }
        @keyframes demoLedgerSecondRow {
          0%, 70% { transform: translateY(0); }
          75%, 92% { transform: translateY(calc(var(--demo-row-shift) * -1)); }
          96%, 100% { transform: translateY(0); }
        }
        @keyframes demoFinger {
          /* 0s to 2s: Idle */
          0%, 19% { opacity: 0; transform: translateY(-50%) scale(1); left: 20px; }
          
          /* 2s to 3.5s: Swipe starts (fades in, moves right) */
          20% { opacity: 0.85; transform: translateY(-50%) scale(0.9); left: 20px; }
          25%, 35% { opacity: 0.85; transform: translateY(-50%) scale(0.9); left: calc(20px + var(--demo-swipe-distance)); }
          38%, 39% { opacity: 0; transform: translateY(-50%) scale(1); left: calc(20px + var(--demo-swipe-distance)); }
          
          /* 4s to 4.3s: Tap starts (appears in center, pulses down, fades) */
          40% { opacity: 0; transform: translate(-50%, -50%) scale(1.3); left: 50%; top: 50%; }
          41% { opacity: 0.9; transform: translate(-50%, -50%) scale(0.85); left: 50%; top: 50%; }
          43% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); left: 50%; top: 50%; }
          
          /* 4.3s to 6.5s: Edit Modal open (hidden) */
          44%, 64% { opacity: 0; left: 80%; top: 50%; }
          
          /* 6.5s to 7s: Long Press start (appears on right handle, holds) */
          65% { opacity: 0.85; transform: translateY(-50%) scale(1.2); left: 80%; top: 50%; }
          67%, 69% { opacity: 0.85; transform: translateY(-50%) scale(0.85); left: 80%; top: 50%; }
          
          /* 70s to 75s: Drag Down */
          75%, 91% { opacity: 0.85; transform: translateY(-50%) scale(0.85); left: 80%; top: calc(50% + var(--demo-row-shift)); }
          
          /* 92s to 100s: Reset/Fade out */
          92%, 100% { opacity: 0; transform: translateY(-50%) scale(1); left: 80%; top: calc(50% + var(--demo-row-shift)); }
        }
        /* Debt detail tour: hide the back-button/name header row so the balance
           card sits at the top and the tour card at the bottom has clear space. */
        .tour-debt-inside-active .debt-detail-header-row {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
