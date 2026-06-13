import { useState, useRef, useEffect } from 'react';
import { useFinance } from '../FinanceContext';
import { Pencil, Trash2, Plus, FileText, CreditCard, Check, X, RefreshCw } from 'lucide-react';
import { fetchStockPrice, fetchMFNav, getCachedPrice, fetchPricesForSymbols } from '../services/MarketDataService';
import { CustomPicker } from './CustomPicker';
import ConfirmDialog from './ConfirmDialog';
import type { Account, AccountType, CardDetails, CardNetwork } from '../types';
import { generateId, formatCurrency, getCurrentMonthStr, calculateBalance, getOrdinalSuffix } from '../utils';
import { CardNetworkLogo } from './CardNetworkLogo';
import { ViewCardOverlay } from './ViewCardOverlay';

export default function Accounts({ onViewStatement }: { onViewStatement: (acc: Account) => void }) {
  const { data, setPendingTransfer, addAccount, updateAccount, deleteAccount } = useFinance();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewingCard, setViewingCard] = useState<Account | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>(() => {
    const symbols = data.accounts
      .filter(a => (a.type === 'stocks' || a.type === 'sips') && a.marketSymbol)
      .map(a => a.marketSymbol!);
    const cached: Record<string, number> = {};
    symbols.forEach(s => { const p = getCachedPrice(s); if (p !== null) cached[s] = p; });
    return cached;
  });
  const [pricesLoading, setPricesLoading] = useState(false);

  useEffect(() => {
    const handleGlobalBack = (e: Event) => {
      if (viewingCard) {
        setViewingCard(null);
        e.preventDefault();
      } else if (isModalOpen) {
        setIsModalOpen(false);
        e.preventDefault();
      } else if (deleteConfirmId) {
        setDeleteConfirmId(null);
        e.preventDefault();
      }
    };
    window.addEventListener('appBackButton', handleGlobalBack);
    return () => window.removeEventListener('appBackButton', handleGlobalBack);
  }, [viewingCard, isModalOpen, deleteConfirmId]);

  useEffect(() => {
    const items = data.accounts
      .filter(a => (a.type === 'stocks' || a.type === 'sips') && a.marketSymbol)
      .map(a => ({ symbol: a.marketSymbol!, kind: (a.type === 'stocks' ? 'stock' : 'sip') as 'stock' | 'sip' }));
    if (items.length === 0) return;
    setPricesLoading(true);
    fetchPricesForSymbols(items).then(result => {
      setPrices(prev => ({ ...prev, ...result }));
      setPricesLoading(false);
    });
  }, []);

  const handleLiquidate = (acc: Account) => {
    const currentMonth = getCurrentMonthStr();
    const bal = calculateBalance(acc, data.transactions, currentMonth);
    if (bal <= 0) {
      alert('Account balance is zero.');
      return;
    }
    setPendingTransfer({ fromAccountId: acc.id, amount: bal, triggerTabSwitch: true });
  };

  const accountTypeOptions = [
    { id: 'bank_account', name: 'Bank Account', subtext: 'Savings or Current' },
    { id: 'credit_card', name: 'Credit Card', subtext: 'Credit line with cycles' },
    { id: 'debit_card', name: 'Debit Card', subtext: 'Linked to bank account' },
    { id: 'e_wallet', name: 'E-Wallet', subtext: 'Digital Currency' },
    { id: 'stocks', name: 'Stocks', subtext: 'Market Investments' },
    { id: 'sips', name: 'SIPs', subtext: 'Systematic Investment Plan' },
    { id: 'rewards', name: 'Rewards', subtext: 'Cashback & Points' },
    { id: 'cash', name: 'Cash', subtext: 'Physical wallet' },
    ...(data.customAccountTypes || []).map(type => ({
      id: type,
      name: type,
      subtext: 'Custom account type'
    }))
  ];

  const [newAccount, setNewAccount] = useState<Partial<Account>>({
    name: '', type: 'bank_account', openingBalances: {}, cashbackRates: []
  });

  const [openingBalanceInput, setOpeningBalanceInput] = useState('');
  const [newCbName, setNewCbName] = useState('');
  const [newCbRate, setNewCbRate] = useState('');
  const [travelOpeningBalanceInput, setTravelOpeningBalanceInput] = useState('');
  const [rewardOpeningBalanceInput, setRewardOpeningBalanceInput] = useState('');
  const cardDetailsRef = useRef<HTMLDivElement>(null);

  const [newCbRoundOff, setNewCbRoundOff] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [expiryInput, setExpiryInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [editingCashbackRateId, setEditingCashbackRateId] = useState<string | null>(null);
  const [isEditingCardDetails, setIsEditingCardDetails] = useState(false);

  const addCashbackRate = () => {
    if (!newCbName || !newCbRate) return;
    if (editingCashbackRateId) {
      setNewAccount(prev => ({
        ...prev,
        cashbackRates: prev.cashbackRates?.map(r => r.id === editingCashbackRateId ? { ...r, name: newCbName, rate: parseFloat(newCbRate), roundOffCashback: newCbRoundOff } : r)
      }));
      setEditingCashbackRateId(null);
    } else {
      setNewAccount(prev => ({
        ...prev,
        cashbackRates: [...(prev.cashbackRates || []), { id: generateId(), name: newCbName, rate: parseFloat(newCbRate), roundOffCashback: newCbRoundOff }]
      }));
    }
    setNewCbName('');
    setNewCbRate('');
    setNewCbRoundOff(false);
  };

  const removeCashbackRate = (id: string) => {
    if (editingCashbackRateId === id) {
      setEditingCashbackRateId(null);
      setNewCbName('');
      setNewCbRate('');
      setNewCbRoundOff(false);
    }
    setNewAccount(prev => ({
      ...prev,
      cashbackRates: prev.cashbackRates?.filter(r => r.id !== id)
    }));
  };

  const openAddModal = () => {
    setEditId(null);
    setNewAccount({ name: '', type: 'bank_account', openingBalances: {}, cashbackRates: [], isCashbackEnabled: false });
    setOpeningBalanceInput('');
    setNewCbName('');
    setNewCbRate('');
    setNewCbRoundOff(false);
    setEditingCashbackRateId(null);
    setIsEditingCardDetails(false);
    setTravelOpeningBalanceInput('');
    setRewardOpeningBalanceInput('');
    setExpiryInput('');
    setShowCvv(false);
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (acc: Account) => {
    const month = getCurrentMonthStr();
    setEditId(acc.id);
    setErrors({});
    setNewAccount({
      ...acc,
      isCashbackEnabled: acc.isCashbackEnabled ?? (acc.defaultCashbackRate !== undefined || (acc.cashbackRates && acc.cashbackRates.length > 0))
    });
    setNewCbName('');
    setNewCbRate('');
    setNewCbRoundOff(false);
    setEditingCashbackRateId(null);
    setIsEditingCardDetails(false);

    const currentBalance = calculateBalance(acc, data.transactions, month);
    setOpeningBalanceInput(currentBalance.toString());

    const currentTravelBalance = calculateBalance(acc, data.transactions, month, true);
    setTravelOpeningBalanceInput(currentTravelBalance.toString());

    const currentRewardBalance = calculateBalance(acc, data.transactions, month, false, true, data.cashbackStatements);
    setRewardOpeningBalanceInput(currentRewardBalance.toString());

    // Pre-fill expiry string from saved cardDetails
    const cd = acc.cardDetails;
    if (cd?.expiryMonth && cd?.expiryYear) {
      setExpiryInput(`${String(cd.expiryMonth).padStart(2, '0')}/${String(cd.expiryYear).padStart(2, '0')}`);
    } else {
      setExpiryInput('');
    }
    setShowCvv(false);

    setIsModalOpen(true);
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!newAccount.name?.trim()) {
      newErrors.name = 'Account Name is required';
    }
    if (!newAccount.type) {
      newErrors.type = 'Account Type is required';
    }
    if (!openingBalanceInput.trim()) {
      newErrors.openingBalance = 'Opening Balance is required';
    }
    if (newAccount.type === 'credit_card') {
      if (!newAccount.statementDay || newAccount.statementDay < 1 || newAccount.statementDay > 31) {
        newErrors.statementDay = 'Statement Generation Day is required';
      }
      if (!newAccount.dueDay || newAccount.dueDay < 1 || newAccount.dueDay > 31) {
        newErrors.dueDay = 'Payment Due Day is required';
      }
    }
    if (newAccount.isNcmcEnabled) {
      if (!travelOpeningBalanceInput.trim()) {
        newErrors.travelOpeningBalance = 'Travel Wallet Opening Balance is required';
      }
    }
    if (((newAccount.type === 'credit_card' && newAccount.isCashbackEnabled) || (newAccount.type === 'debit_card' && newAccount.isCashbackEnabled))) {
      if (newAccount.defaultCashbackRate === undefined || isNaN(newAccount.defaultCashbackRate) || newAccount.defaultCashbackRate < 0) {
        newErrors.defaultCashbackRate = 'Default Cashback Rate is required';
      }
      if (newAccount.rewardType === 'points') {
        if (!newAccount.rewardUnit?.trim()) {
          newErrors.rewardUnit = 'Reward Unit Name is required';
        }
        if (!rewardOpeningBalanceInput.trim()) {
          newErrors.rewardOpeningBalance = 'Reward Points Opening Balance is required';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const month = getCurrentMonthStr();

    let updatedOpeningBalances = { ...(newAccount.openingBalances || {}) };
    let updatedBalanceAdjustments = { ...(newAccount.balanceAdjustments || {}) };
    let updatedTravelOpeningBalances = newAccount.isNcmcEnabled ? { ...(newAccount.travelOpeningBalances || {}) } : undefined;
    let updatedTravelBalanceAdjustments = newAccount.isNcmcEnabled ? { ...(newAccount.travelBalanceAdjustments || {}) } : undefined;
    let updatedBalanceEditHistory = [...(newAccount.balanceEditHistory || [])];
    
    const hasInternalRewards = (newAccount.type === 'credit_card' || newAccount.type === 'debit_card') && newAccount.isCashbackEnabled && newAccount.rewardType === 'points';
    let updatedRewardOpeningBalances = hasInternalRewards ? { ...(newAccount.rewardOpeningBalances || {}) } : undefined;
    let updatedRewardBalanceAdjustments = hasInternalRewards ? { ...(newAccount.rewardBalanceAdjustments || {}) } : undefined;

    if (editId) {
      const originalAcc = data.accounts.find(a => a.id === editId);
      if (originalAcc) {
        // 1. Standard Wallet Opening Balance setup/rollover folding
        let opening = originalAcc.openingBalances[month];
        if (opening === undefined) {
          const prevMonthDate = new Date();
          prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
          const prevMonthStr = `${prevMonthDate.getFullYear()}-${(prevMonthDate.getMonth() + 1).toString().padStart(2, '0')}`;
          opening = calculateBalance(originalAcc, data.transactions, prevMonthStr);
          updatedOpeningBalances[month] = opening;
        }

        // Calculate standard transactions change for the current month
        const currentMonthTransactions = data.transactions.filter(t => {
          if (t.accountId !== editId) return false;
          const tMonth = t.date.slice(0, 7);
          return tMonth === month && !t.isTravelTransaction && !t.isRewardTransaction;
        });
        const standardChange = currentMonthTransactions.reduce((acc, t) => {
          let effectiveAmount = t.amount;
          if (t.type === 'debit' && t.rewardUsed && t.rewardUsed > 0 && t.rewardUsedAccountId) {
            effectiveAmount = t.amount - t.rewardUsed;
          }
          if (originalAcc.type === 'credit_card') {
            return t.type === 'debit' ? acc + effectiveAmount : acc - effectiveAmount;
          } else {
            return t.type === 'credit' ? acc + effectiveAmount : acc - effectiveAmount;
          }
        }, 0);

        const enteredCurrentBalance = parseFloat(openingBalanceInput) || 0;
        const previousBalance = calculateBalance(originalAcc, data.transactions, month);
        updatedBalanceAdjustments[month] = enteredCurrentBalance - opening - standardChange;

        if (enteredCurrentBalance !== previousBalance) {
          updatedBalanceEditHistory.push({
            editedAt: new Date().toISOString(),
            monthKey: month,
            previousBalance,
            newBalance: enteredCurrentBalance,
          });
        }

        // 2. Travel Wallet Setup
        if (newAccount.isNcmcEnabled && updatedTravelOpeningBalances) {
          let travelOpening = originalAcc.travelOpeningBalances?.[month];
          if (travelOpening === undefined) {
            const prevMonthDate = new Date();
            prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
            const prevMonthStr = `${prevMonthDate.getFullYear()}-${(prevMonthDate.getMonth() + 1).toString().padStart(2, '0')}`;
            travelOpening = calculateBalance(originalAcc, data.transactions, prevMonthStr, true);
            updatedTravelOpeningBalances[month] = travelOpening;
          }

          const travelTransactions = data.transactions.filter(t => {
            if (t.accountId !== editId) return false;
            const tMonth = t.date.slice(0, 7);
            return tMonth === month && !!t.isTravelTransaction;
          });
          const travelChange = travelTransactions.reduce((acc, t) => {
            if (originalAcc.type === 'credit_card') {
              return t.type === 'debit' ? acc + t.amount : acc - t.amount;
            } else {
              return t.type === 'credit' ? acc + t.amount : acc - t.amount;
            }
          }, 0);

          const enteredCurrentTravelBalance = parseFloat(travelOpeningBalanceInput) || 0;
          if (!updatedTravelBalanceAdjustments) updatedTravelBalanceAdjustments = {};
          updatedTravelBalanceAdjustments[month] = enteredCurrentTravelBalance - travelOpening - travelChange;
        }

        // 3. Rewards Wallet Setup
        if (hasInternalRewards && updatedRewardOpeningBalances) {
          let rewardOpening = originalAcc.rewardOpeningBalances?.[month];
          if (rewardOpening === undefined) {
            const prevMonthDate = new Date();
            prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
            const prevMonthStr = `${prevMonthDate.getFullYear()}-${(prevMonthDate.getMonth() + 1).toString().padStart(2, '0')}`;
            rewardOpening = calculateBalance(originalAcc, data.transactions, prevMonthStr, false, true, data.cashbackStatements);
            updatedRewardOpeningBalances[month] = rewardOpening;
          }

          const rewardTransactions = data.transactions.filter(t => {
            if (t.accountId !== editId) return false;
            const tMonth = t.date.slice(0, 7);
            return tMonth === month && !!t.isRewardTransaction;
          });
          const rewardChange = rewardTransactions.reduce((acc, t) => {
            return t.type === 'credit' ? acc + t.amount : acc - t.amount;
          }, 0);

          const enteredCurrentRewardBalance = parseFloat(rewardOpeningBalanceInput) || 0;
          if (!updatedRewardBalanceAdjustments) updatedRewardBalanceAdjustments = {};
          updatedRewardBalanceAdjustments[month] = enteredCurrentRewardBalance - rewardOpening - rewardChange;
        }
      }
    } else {
      // In add mode, set opening balance as input and reset adjustment for standard
      updatedOpeningBalances[month] = parseFloat(openingBalanceInput) || 0;
      updatedBalanceAdjustments[month] = 0;

      if (newAccount.isNcmcEnabled && updatedTravelOpeningBalances) {
        updatedTravelOpeningBalances[month] = parseFloat(travelOpeningBalanceInput) || 0;
        if (!updatedTravelBalanceAdjustments) updatedTravelBalanceAdjustments = {};
        updatedTravelBalanceAdjustments[month] = 0;
      }

      if (hasInternalRewards && updatedRewardOpeningBalances) {
        updatedRewardOpeningBalances[month] = parseFloat(rewardOpeningBalanceInput) || 0;
        if (!updatedRewardBalanceAdjustments) updatedRewardBalanceAdjustments = {};
        updatedRewardBalanceAdjustments[month] = 0;
      }
    }

    const accountData: Account = {
      id: editId || generateId(),
      name: newAccount.name || '',
      type: newAccount.type as AccountType,
      openingBalances: updatedOpeningBalances,
      balanceAdjustments: updatedBalanceAdjustments,
      balanceEditHistory: updatedBalanceEditHistory.length > 0 ? updatedBalanceEditHistory : undefined,
      defaultCashbackRate: ((newAccount.type === 'credit_card' && newAccount.isCashbackEnabled) || (newAccount.type === 'debit_card' && newAccount.isCashbackEnabled)) ? newAccount.defaultCashbackRate : undefined,
      cashbackRates: ((newAccount.type === 'credit_card' && newAccount.isCashbackEnabled) || (newAccount.type === 'debit_card' && newAccount.isCashbackEnabled)) ? newAccount.cashbackRates : undefined,
      roundOffCashback: ((newAccount.type === 'credit_card' && newAccount.isCashbackEnabled) || (newAccount.type === 'debit_card' && newAccount.isCashbackEnabled)) ? newAccount.roundOffCashback : undefined,
      isCashbackEnabled: (newAccount.type === 'credit_card' || newAccount.type === 'debit_card') ? newAccount.isCashbackEnabled : undefined,
      statementDay: newAccount.type === 'credit_card' ? newAccount.statementDay : undefined,
      dueDay: newAccount.type === 'credit_card' ? newAccount.dueDay : undefined,
      cashbackCreditCycle: newAccount.type === 'credit_card' ? (newAccount.cashbackCreditCycle || 'next_cycle') : undefined,
      cashbackDestinationAccountId: ((newAccount.type === 'credit_card' && newAccount.isCashbackEnabled) || (newAccount.type === 'debit_card' && newAccount.isCashbackEnabled)) ? newAccount.cashbackDestinationAccountId : undefined,
      isNcmcEnabled: newAccount.isNcmcEnabled,
      travelOpeningBalances: updatedTravelOpeningBalances,
      travelBalanceAdjustments: updatedTravelBalanceAdjustments,
      cardDetails: (newAccount.type === 'credit_card' || newAccount.type === 'debit_card')
        ? newAccount.cardDetails
        : undefined,
      statementRounding: newAccount.statementRounding || 'none',
      numberOfShares: (newAccount.type === 'stocks' || newAccount.type === 'sips') ? newAccount.numberOfShares : undefined,
      marketSymbol: (newAccount.type === 'stocks' || newAccount.type === 'sips') ? (newAccount.marketSymbol?.trim() || undefined) : undefined,
      averagePrice: (newAccount.type === 'stocks' || newAccount.type === 'sips') ? newAccount.averagePrice : undefined,
      rewardUnit: (newAccount.type === 'rewards' || hasInternalRewards) ? newAccount.rewardUnit : undefined,
      pointsConversionRate: (newAccount.type === 'rewards' || hasInternalRewards) ? newAccount.pointsConversionRate : undefined,
      rewardType: (newAccount.type === 'credit_card' || newAccount.type === 'debit_card') && newAccount.isCashbackEnabled ? (newAccount.rewardType || 'rupee') : undefined,
      rewardOpeningBalances: updatedRewardOpeningBalances,
      rewardBalanceAdjustments: updatedRewardBalanceAdjustments,
    };

    if (editId) {
      updateAccount(accountData);
    } else {
      addAccount(accountData);
    }

    setIsModalOpen(false);
  };

  const currentMonth = getCurrentMonthStr();

  const getAccountIcon = (acc: Account) => {
    if (acc.isNcmcEnabled) return '🪪';
    switch (acc.type) {
      case 'credit_card': return '💳';
      case 'debit_card': return '🪪';
      case 'bank_account': return '🏦';
      case 'e_wallet': return '🪙';
      case 'stocks': return '📈';
      case 'sips': return '💹';
      case 'rewards': return '🎁';
      case 'cash': return '💵';
      default: return '💼';
    }
  };

  const getDestAccountUnit = (acc: Partial<Account>) => {
    if (acc.rewardUnit) return acc.rewardUnit;
    if (acc.cashbackDestinationAccountId) {
      const dest = data.accounts.find(a => a.id === acc.cashbackDestinationAccountId);
      if (dest && dest.rewardUnit) return dest.rewardUnit;
    }
    return '';
  };

  return (
    <div className="flex-col gap-6" style={{ maxWidth: '600px', margin: '0 auto', width: '100%' }}>
      <div className="flex justify-between align-center" style={{ marginBottom: '1rem' }}>
        <h2 className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>accounts</h2>
        <button className="btn btn-primary" onClick={openAddModal} style={{ padding: '0.6rem 1.25rem' }}>
          + Add New
        </button>
      </div>

      <div className="flex-col gap-10">
        {(() => {
          const TYPE_LABELS: Record<string, string> = {
            bank_account: 'Bank Accounts',
            credit_card: 'Credit Cards',
            debit_card: 'Debit Cards',
            e_wallet: 'E-Wallets',
            stocks: 'Stocks & Investments',
            sips: 'SIPs',
            rewards: 'Rewards & Cashback',
            cash: 'Physical Cash'
          };

          const TYPE_ORDER = [
            'bank_account',
            'credit_card',
            'debit_card',
            'cash',
            'e_wallet',
            'rewards',
            'stocks',
            'sips'
          ];

          const grouped = data.accounts.reduce((acc, account) => {
            if (!acc[account.type]) acc[account.type] = [];
            acc[account.type].push(account);
            return acc;
          }, {} as Record<string, Account[]>);

          // Sort groups based on TYPE_ORDER, then append any remaining custom types
          const sortedTypes = [...TYPE_ORDER.filter(t => grouped[t]), ...Object.keys(grouped).filter(t => !TYPE_ORDER.includes(t))];

          if (sortedTypes.length === 0) {
            return (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <p className="text-muted text-center" style={{ padding: '2rem' }}>No accounts added yet.</p>
              </div>
            );
          }

          return sortedTypes.map((type, index) => (
            <div key={type} className="flex-col gap-4" style={{ marginTop: index === 0 ? '0' : '2.5rem' }}>
              <div className="flex align-center gap-3" style={{ padding: '0 0.5rem', marginBottom: '0.5rem' }}>
                <span className="text-mono" style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--accent)', opacity: 0.8 }}>
                  {TYPE_LABELS[type] || type.replace('_', ' ')}
                </span>
                <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, var(--accent), transparent)', opacity: 0.2 }}></div>
              </div>

              <div className="flex-col gap-6">
                {grouped[type].map(acc => {
                  const rawBal = calculateBalance(acc, data.transactions, currentMonth);
                  let bal = rawBal;
                  if (acc.type === 'credit_card') {
                    const rounding = acc.statementRounding || 'none';
                    if (rounding === 'round') bal = Math.round(rawBal);
                    else if (rounding === 'floor') bal = Math.floor(rawBal);
                    else if (rounding === 'ceil') bal = Math.ceil(rawBal);
                  }

                  const roundedBal = Math.round(bal * 100) / 100;

                  let openingBal = acc.openingBalances[currentMonth];
                  if (openingBal === undefined) {
                    const prevMonthDate = new Date();
                    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
                    const prevMonthStr = `${prevMonthDate.getFullYear()}-${(prevMonthDate.getMonth() + 1).toString().padStart(2, '0')}`;
                    openingBal = calculateBalance(acc, data.transactions, prevMonthStr);
                  }

                  const isFirstAccount = index === 0 && acc.id === grouped[type][0].id;

                  return (
                    <div key={acc.id} className={`card flex-col ${isFirstAccount ? 'tour-first-account' : ''}`} style={{ padding: '0' }}>
                      {/* Top Section - Hardware / Branding */}
                      <div className="flex justify-between align-start" style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-hover)' }}>
                        <div className="flex-col gap-1">
                          <span className="text-mono text-muted">{getAccountIcon(acc)} {acc.type.replace('_', ' ')}</span>
                          <span className="text-serif" style={{ fontSize: '1.15rem', color: 'var(--text-primary)' }}>{acc.name}</span>
                        </div>
                        <div className="flex gap-3">
                          <button
                            className="btn btn-secondary"
                            style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
                            onClick={() => openEditModal(acc)}
                            title="Edit"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)' }}
                            onClick={() => setDeleteConfirmId(acc.id)}
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Middle Section - Balance */}
                      <div className="flex justify-between align-start" style={{ padding: '0.85rem 1rem' }}>
                        <div className="flex-col gap-1">
                          <span className="text-mono text-muted text-xs">
                            {acc.isNcmcEnabled ? 'PAYMENTS BALANCE' : 'TOTAL BALANCE'}
                          </span>
                          <span className="text-serif" style={{
                            fontSize: '1.8rem',
                            color: acc.type === 'credit_card'
                              ? (roundedBal > 0 ? 'var(--danger)' : 'var(--success)')
                              : (roundedBal >= 0 ? 'var(--success)' : 'var(--danger)'),
                            lineHeight: '1.2'
                          }}>
                            {acc.type === 'rewards' && acc.rewardUnit ? (
                              <span className="flex-col" style={{ alignItems: 'flex-start', gap: '6px', lineHeight: '1' }}>
                                <span>{bal}</span>
                                <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 800, opacity: 0.7 }}>{acc.rewardUnit}</span>
                              </span>
                            ) : (
                              formatCurrency(bal)
                            )}
                          </span>
                          {(acc.type === 'credit_card' || acc.type === 'debit_card') && acc.defaultCashbackRate ? (
                            <span className="text-muted text-xs" style={{ marginTop: '4px' }}>Base Reward Rate: {acc.defaultCashbackRate}%</span>
                          ) : null}
                        </div>
 
                        <div className="flex gap-4 align-end">
                          {(acc.type === 'rewards' || acc.type === 'e_wallet') && (
                            <button
                              className="btn btn-secondary flex align-center gap-2"
                              style={{ fontSize: '0.8rem', padding: '0.5rem 1rem' }}
                              onClick={() => handleLiquidate(acc)}
                            >
                              <span>Send to Bank</span>
                            </button>
                          )}
                          <div className="flex-col gap-1" style={{ alignItems: 'flex-end', textAlign: 'right' }}>
                            <span className="text-mono text-muted text-xs">OPENING BAL</span>
                            <span className="text-serif" style={{
                              fontSize: '1.4rem',
                              color: 'var(--text-secondary)',
                              marginTop: '0.1rem'
                            }}>
                              {acc.type === 'rewards' && acc.rewardUnit ? (
                                <span className="flex-col" style={{ alignItems: 'flex-end', gap: '6px', lineHeight: '1' }}>
                                  <span>{openingBal}</span>
                                  <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 800, opacity: 0.7 }}>{acc.rewardUnit}</span>
                                </span>
                              ) : (
                                formatCurrency(openingBal)
                              )}
                            </span>
                          </div>
                        </div>
                      </div>



                      {/* Bottom Section - Auxiliary Details */}
                      {acc.isNcmcEnabled && (
                        <div className="flex justify-between align-center" style={{ padding: '0.65rem 1rem', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-hover)' }}>
                          <span className="text-mono text-muted text-xs">TRAVEL WALLET</span>
                          <div className="flex align-center gap-3">
                            <span className="text-serif" style={{ color: 'var(--accent)', fontSize: '1.1rem' }}>
                              {formatCurrency(calculateBalance(acc, data.transactions, currentMonth, true))}
                            </span>
                            {acc.cardDetails?.cardNumber && (
                              <>
                                <div style={{ width: '1px', height: '18px', background: 'var(--border-color)', margin: '0 4px', opacity: 0.5 }} />
                                <button
                                  className="btn btn-secondary flex align-center gap-2"
                                  style={{ fontSize: '0.7rem', padding: '0.35rem 0.75rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, color: 'var(--accent)' }}
                                  onClick={() => setViewingCard(acc)}
                                >
                                  <CreditCard size={14} />
                                  <span>Card</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {acc.type === 'credit_card' && (
                        <div className="flex justify-between align-center gap-4" style={{ padding: '0.65rem 1rem', borderTop: '1px solid var(--border-color)' }}>
                          <div className="flex-col gap-1">
                            <span className="text-mono text-muted" style={{ fontSize: '10px' }}>STATEMENT CYCLE</span>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{acc.statementDay ? getOrdinalSuffix(acc.statementDay) : 'N/A'}</span>
                          </div>
                          <div className="flex-col gap-1">
                            <span className="text-mono text-muted" style={{ fontSize: '10px' }}>PAY DUE BY</span>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{acc.dueDay ? getOrdinalSuffix(acc.dueDay) : 'N/A'}</span>
                          </div>

                          <div className="flex gap-3" style={{ marginLeft: 'auto' }}>
                            <button
                              className="btn btn-secondary flex align-center gap-2"
                              style={{ fontSize: '0.7rem', padding: '0.4rem 0.8rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}
                              onClick={() => onViewStatement(acc)}
                            >
                              <FileText size={14} />
                              <span>Statement</span>
                            </button>

                            {acc.cardDetails?.cardNumber && (
                              <button
                                className="btn btn-secondary flex align-center gap-2"
                                style={{ fontSize: '0.7rem', padding: '0.4rem 0.8rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, color: 'var(--accent)' }}
                                onClick={() => setViewingCard(acc)}
                              >
                                <CreditCard size={14} />
                                <span>Card</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {acc.type === 'debit_card' && !acc.isNcmcEnabled && acc.cardDetails?.cardNumber && (
                        <div className="flex justify-end align-center gap-4" style={{ padding: '0.65rem 1rem', borderTop: '1px solid var(--border-color)' }}>
                           <button
                             className="btn btn-secondary flex align-center gap-2"
                             style={{ fontSize: '0.7rem', padding: '0.4rem 0.8rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, color: 'var(--accent)' }}
                             onClick={() => setViewingCard(acc)}
                           >
                             <CreditCard size={14} />
                             <span>Card</span>
                           </button>
                        </div>
                      )}

                      {acc.isCashbackEnabled && acc.rewardType === 'points' && acc.rewardUnit && (
                        <div className="flex justify-between align-center" style={{ padding: '0.65rem 1rem', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-hover)' }}>
                          <span className="text-mono text-muted text-xs" style={{ textTransform: 'uppercase', fontWeight: 800 }}>{acc.rewardUnit}</span>
                          <span className="text-serif" style={{ color: 'var(--accent)', fontSize: '1.2rem', fontWeight: 700 }}>
                            {calculateBalance(acc, data.transactions, currentMonth, false, true, data.cashbackStatements)}
                          </span>
                        </div>
                      )}

                      {(acc.type === 'stocks' || acc.type === 'sips') && (() => {
                        const txShares = data.transactions
                          .filter(t => t.accountId === acc.id && t.numberOfShares !== undefined)
                          .reduce((sum, t) => t.type === 'credit' ? sum + (t.numberOfShares ?? 0) : sum - (t.numberOfShares ?? 0), 0);
                        const totalShares = (acc.numberOfShares ?? 0) + txShares;
                        const hasShares = acc.numberOfShares !== undefined || txShares !== 0;
                        const isSip = acc.type === 'sips';
                        const currentPrice = acc.marketSymbol ? (prices[acc.marketSymbol] ?? null) : null;
                        const hasPnLSetup = !!acc.marketSymbol && acc.averagePrice !== undefined && totalShares > 0;

                        if (!hasShares && !hasPnLSetup) return null;

                        const pnl = hasPnLSetup && currentPrice !== null
                          ? (currentPrice - acc.averagePrice!) * totalShares
                          : null;
                        const pnlPct = hasPnLSetup && currentPrice !== null && acc.averagePrice! > 0
                          ? ((currentPrice - acc.averagePrice!) / acc.averagePrice!) * 100
                          : null;
                        const pnlPos = pnl !== null && pnl >= 0;

                        return (
                          <>
                            {hasShares && (
                              <div className="flex justify-between align-center" style={{ padding: '0.65rem 1rem', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-hover)' }}>
                                <span className="text-mono text-muted text-xs">{isSip ? 'TOTAL UNITS' : 'TOTAL SHARES'}</span>
                                <span className="text-serif" style={{ color: 'var(--accent)', fontSize: '1.1rem' }}>{totalShares}</span>
                              </div>
                            )}
                            {hasPnLSetup && (
                              <div className="flex justify-between align-center" style={{ padding: '0.65rem 1rem', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-hover)' }}>
                                {currentPrice !== null ? (
                                  <>
                                    <div className="flex-col gap-0">
                                      <span className="text-mono text-muted text-xs">{isSip ? 'CURRENT NAV' : 'LTP'}</span>
                                      <span style={{ color: 'var(--accent)', fontSize: '0.95rem', fontWeight: 700 }}>
                                        ₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                    <div className="flex align-center gap-2">
                                      {pnl !== null && pnlPct !== null && (
                                        <div className="flex-col gap-0" style={{ alignItems: 'flex-end' }}>
                                          <span className="text-mono text-muted text-xs">P&amp;L ({pnlPos ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
                                          <span style={{ color: pnlPos ? 'var(--success)' : 'var(--danger)', fontSize: '0.95rem', fontWeight: 700 }}>
                                            {pnlPos ? '+' : '-'}₹{Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                          </span>
                                        </div>
                                      )}
                                      <button
                                        className="btn btn-secondary"
                                        style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                                        title="Refresh price"
                                        onClick={async () => {
                                          const sym = acc.marketSymbol!;
                                          const price = isSip ? await fetchMFNav(sym) : await fetchStockPrice(sym);
                                          if (price !== null) setPrices(prev => ({ ...prev, [sym]: price }));
                                        }}
                                      >
                                        <RefreshCw size={11} />
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-mono text-muted text-xs">LIVE P&amp;L</span>
                                    {pricesLoading ? (
                                      <span className="text-xs text-muted">Fetching...</span>
                                    ) : (
                                      <button
                                        className="btn btn-secondary"
                                        style={{ fontSize: '0.7rem', padding: '0.3rem 0.75rem' }}
                                        onClick={async () => {
                                          const sym = acc.marketSymbol!;
                                          const price = isSip ? await fetchMFNav(sym) : await fetchStockPrice(sym);
                                          if (price !== null) setPrices(prev => ({ ...prev, [sym]: price }));
                                        }}
                                      >
                                        Fetch
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          ));
        })()}
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>{editId ? 'Edit Account' : 'Add New Account'}</h3>
              <button onClick={() => setIsModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="input-group">
                <label>Account Name</label>
                <input
                  className={`input-field ${errors.name ? 'border-danger' : ''}`}
                  value={newAccount.name}
                  onChange={e => {
                    setNewAccount({ ...newAccount, name: e.target.value });
                    if (errors.name) setErrors(prev => ({ ...prev, name: '' }));
                  }}
                  placeholder="e.g. HDFC Millenia"
                />
                {errors.name && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.name}</span>}
              </div>
              <CustomPicker
                label="Account Type"
                value={newAccount.type || ''}
                options={accountTypeOptions}
                onChange={val => {
                  setNewAccount({ ...newAccount, type: val as AccountType });
                  if (errors.type) setErrors(prev => ({ ...prev, type: '' }));
                }}
                error={errors.type}
                iconGetter={id => {
                  switch (id) {
                    case 'bank_account': return '🏦';
                    case 'credit_card': return '💳';
                    case 'debit_card': return '🪪';
                    case 'e_wallet': return '🪙';
                    case 'stocks': return '📈';
                    case 'sips': return '💹';
                    case 'rewards': return '🎁';
                    case 'cash': return '💵';
                    default: return '💼';
                  }
                }}
              />
              <div className="input-group">
                <label>{editId ? 'Current Balance (Current Month)' : 'Opening Balance (Current Month)'}</label>
                <input
                  type="number"
                  className={`input-field ${errors.openingBalance ? 'border-danger' : ''}`}
                  value={openingBalanceInput}
                  onChange={e => {
                    setOpeningBalanceInput(e.target.value);
                    if (errors.openingBalance) setErrors(prev => ({ ...prev, openingBalance: '' }));
                  }}
                  placeholder="0.00"
                />
                {errors.openingBalance && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.openingBalance}</span>}
              </div>

              {newAccount.type === 'debit_card' && (
                <>
                  <div className="input-group">
                    <label className="flex align-center" style={{ cursor: 'pointer', margin: '0.5rem 0', fontWeight: 500, color: 'var(--text-primary)', gap: '10px' }}>
                      <input
                        type="checkbox"
                        style={{ margin: 0, width: '16px', height: '16px' }}
                        checked={newAccount.isNcmcEnabled || false}
                        onChange={e => setNewAccount({ ...newAccount, isNcmcEnabled: e.target.checked })}
                      />
                      <span style={{ display: 'inline-flex', alignItems: 'center', transform: 'translateY(1px)' }}>Enable NCMC Travel Wallet?</span>
                    </label>
                  </div>

                  {newAccount.isNcmcEnabled && (
                    <div className="input-group">
                      <label>{editId ? 'Travel Wallet Current Balance' : 'Travel Wallet Opening Balance'}</label>
                      <input
                        type="number"
                        className={`input-field ${errors.travelOpeningBalance ? 'border-danger' : ''}`}
                        value={travelOpeningBalanceInput}
                        onChange={e => {
                          setTravelOpeningBalanceInput(e.target.value);
                          if (errors.travelOpeningBalance) setErrors(prev => ({ ...prev, travelOpeningBalance: '' }));
                        }}
                        placeholder="0.00"
                      />
                      {errors.travelOpeningBalance && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.travelOpeningBalance}</span>}
                    </div>
                  )}

                  <div className="input-group">
                    <label className="flex align-center" style={{ cursor: 'pointer', margin: '0.5rem 0', fontWeight: 500, color: 'var(--text-primary)', gap: '10px' }}>
                      <input
                        type="checkbox"
                        style={{ margin: 0, width: '16px', height: '16px' }}
                        checked={newAccount.isCashbackEnabled || false}
                        onChange={e => {
                          const checked = e.target.checked;
                          setNewAccount({
                            ...newAccount,
                            isCashbackEnabled: checked,
                            defaultCashbackRate: checked ? newAccount.defaultCashbackRate : undefined,
                            cashbackRates: checked ? newAccount.cashbackRates : [],
                            roundOffCashback: checked ? newAccount.roundOffCashback : false
                          });
                        }}
                      />
                      <span style={{ display: 'inline-flex', alignItems: 'center', transform: 'translateY(1px)' }}>Enable Cashback?</span>
                    </label>
                  </div>
                </>
              )}
 
              {newAccount.type === 'rewards' && (
                <>
                  <div className="input-group">
                    <label>Reward Unit Name (Optional)</label>
                    <input
                      className="input-field"
                      value={newAccount.rewardUnit || ''}
                      onChange={e => setNewAccount({ ...newAccount, rewardUnit: e.target.value })}
                      placeholder="e.g. Jewels, Points, Miles"
                    />
                  </div>
                  {newAccount.rewardUnit && (
                    <div className="input-group">
                      <label>Points to ₹1 Conversion Rate (Optional)</label>
                      <input
                        type="number"
                        className="input-field"
                        value={newAccount.pointsConversionRate || ''}
                        onChange={e => setNewAccount({ ...newAccount, pointsConversionRate: parseFloat(e.target.value) || undefined })}
                        placeholder="e.g. 5 (means 5 Jewels = ₹1)"
                        step="any"
                        min="0.0001"
                      />
                      <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                        Used to automatically convert cashback rupees to points, and display estimated Rupee value in statements.
                      </p>
                    </div>
                  )}
                </>
              )}

              {(newAccount.type === 'stocks' || newAccount.type === 'sips') && (
                <>
                  <div className="input-group">
                    <label>{newAccount.type === 'sips' ? 'Opening Units (Optional)' : 'Opening Shares (Optional)'}</label>
                    <input
                      type="number"
                      className="input-field"
                      value={newAccount.numberOfShares ?? ''}
                      onChange={e => setNewAccount({ ...newAccount, numberOfShares: e.target.value ? parseFloat(e.target.value) : undefined })}
                      placeholder="e.g. 100"
                      step="any"
                      min="0"
                    />
                  </div>
                  <div className="input-group">
                    <label>{newAccount.type === 'sips' ? 'MF Scheme Code (Optional)' : 'Market Symbol (Optional)'}</label>
                    <input
                      type="text"
                      className="input-field"
                      value={newAccount.marketSymbol || ''}
                      onChange={e => setNewAccount({ ...newAccount, marketSymbol: e.target.value.toUpperCase() || undefined })}
                      placeholder={newAccount.type === 'sips' ? 'e.g. 120503' : 'e.g. TCS.NS'}
                      style={{ textTransform: newAccount.type === 'stocks' ? 'uppercase' : 'none' }}
                    />
                    <span className="text-xs text-muted" style={{ marginTop: '0.25rem', display: 'block' }}>
                      {newAccount.type === 'sips'
                        ? 'Find on mfapi.in — search your fund name to get the scheme code'
                        : 'NSE stocks use .NS suffix (e.g. RELIANCE.NS, TCS.NS)'}
                    </span>
                  </div>
                  <div className="input-group">
                    <label>{newAccount.type === 'sips' ? 'Average NAV — ₹/unit (Optional)' : 'Average Buy Price — ₹/share (Optional)'}</label>
                    <input
                      type="number"
                      className="input-field"
                      value={newAccount.averagePrice ?? ''}
                      onChange={e => setNewAccount({ ...newAccount, averagePrice: e.target.value ? parseFloat(e.target.value) : undefined })}
                      placeholder="e.g. 3400.50"
                      step="any"
                      min="0"
                    />
                  </div>
                </>
              )}

              {newAccount.type === 'credit_card' && (
                <>
                  <div className="input-group">
                    <label>Statement Generation Day (1-31)</label>
                    <input
                      type="number"
                      className={`input-field ${errors.statementDay ? 'border-danger' : ''}`}
                      value={newAccount.statementDay || ''}
                      onChange={e => {
                        setNewAccount({ ...newAccount, statementDay: parseInt(e.target.value) });
                        if (errors.statementDay) setErrors(prev => ({ ...prev, statementDay: '' }));
                      }}
                      placeholder="e.g. 5"
                      min="1" max="31"
                    />
                    {errors.statementDay && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.statementDay}</span>}
                  </div>
                  <div className="input-group">
                    <label>Payment Due Day (1-31)</label>
                    <input
                      type="number"
                      className={`input-field ${errors.dueDay ? 'border-danger' : ''}`}
                      value={newAccount.dueDay || ''}
                      onChange={e => {
                        setNewAccount({ ...newAccount, dueDay: parseInt(e.target.value) });
                        if (errors.dueDay) setErrors(prev => ({ ...prev, dueDay: '' }));
                      }}
                      placeholder="e.g. 25"
                      min="1" max="31"
                    />
                    {errors.dueDay && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.dueDay}</span>}
                  </div>
                  <div style={{ marginTop: '0.5rem' }}>
                    <CustomPicker
                      label="Statement Bill Rounding"
                      value={newAccount.statementRounding || 'none'}
                      options={[
                        { id: 'none', name: 'No Rounding', subtext: 'Keep exact decimals (e.g. 1538.92)' },
                        { id: 'floor', name: 'Round Down (Floor)', subtext: 'Drop decimals (e.g. 1538.00)' },
                        { id: 'round', name: 'Nearest Integer', subtext: 'Round to closest (e.g. 1539.00)' },
                        { id: 'ceil', name: 'Round Up (Ceil)', subtext: 'Always round up (e.g. 1539.00)' }
                      ]}
                      onChange={val => setNewAccount({ ...newAccount, statementRounding: val as any })}
                      iconGetter={id => {
                        if (id === 'none') return '🔢';
                        if (id === 'floor') return '⬇️';
                        if (id === 'round') return '🎯';
                        return '⬆️';
                      }}
                    />
                  </div>
                  <div className="input-group" style={{ marginTop: '0.5rem' }}>
                    <label className="flex align-center" style={{ cursor: 'pointer', margin: '0.5rem 0', fontWeight: 500, color: 'var(--text-primary)', gap: '10px' }}>
                      <input
                        type="checkbox"
                        style={{ margin: 0, width: '16px', height: '16px' }}
                        checked={newAccount.isCashbackEnabled || false}
                        onChange={e => {
                          const checked = e.target.checked;
                          setNewAccount({
                            ...newAccount,
                            isCashbackEnabled: checked,
                            defaultCashbackRate: checked ? newAccount.defaultCashbackRate : undefined,
                            cashbackRates: checked ? newAccount.cashbackRates : [],
                            roundOffCashback: checked ? newAccount.roundOffCashback : false
                          });
                        }}
                      />
                      <span style={{ display: 'inline-flex', alignItems: 'center', transform: 'translateY(1px)' }}>Enable Cashback / Rewards?</span>
                    </label>
                  </div>
                </>
              )}

              {((newAccount.type === 'credit_card' && newAccount.isCashbackEnabled) || (newAccount.type === 'debit_card' && newAccount.isCashbackEnabled)) && (
                <>
                  <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                    <CustomPicker
                      label="Reward Type"
                      value={newAccount.rewardType || 'rupee'}
                      options={[
                        { id: 'rupee', name: 'Rupee (Statement Credit)', subtext: 'Cashback in form of Rupees credited directly to the card' },
                        { id: 'points', name: 'Custom Reward Points', subtext: 'Cashback in custom reward unit tracked internally' }
                      ]}
                      onChange={val => setNewAccount({ 
                        ...newAccount, 
                        rewardType: val as 'rupee' | 'points',
                        rewardUnit: val === 'rupee' ? undefined : newAccount.rewardUnit,
                        pointsConversionRate: val === 'rupee' ? undefined : newAccount.pointsConversionRate
                      })}
                      iconGetter={id => id === 'rupee' ? '💵' : '🎁'}
                    />
                  </div>

                  {(newAccount.rewardType || 'rupee') === 'rupee' && newAccount.type === 'credit_card' && (
                    <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                      <CustomPicker
                        label="Apply Statement Credits To"
                        value={newAccount.cashbackCreditCycle || 'next_cycle'}
                        options={[
                          { id: 'next_cycle', name: 'Next Cycle', subtext: 'Reduces the upcoming statement (Default)' },
                          { id: 'same_cycle', name: 'Same Cycle', subtext: 'Reduces the current statement' }
                        ]}
                        onChange={val => setNewAccount({ ...newAccount, cashbackCreditCycle: val as 'same_cycle' | 'next_cycle' })}
                        iconGetter={id => id === 'next_cycle' ? '➡️' : '🔄'}
                      />
                    </div>
                  )}

                  {newAccount.rewardType === 'points' && (
                    <>
                      <div className="input-group">
                        <label>Reward Unit Name</label>
                        <input
                          className={`input-field ${errors.rewardUnit ? 'border-danger' : ''}`}
                          value={newAccount.rewardUnit || ''}
                          onChange={e => {
                            setNewAccount({ ...newAccount, rewardUnit: e.target.value });
                            if (errors.rewardUnit) setErrors(prev => ({ ...prev, rewardUnit: '' }));
                          }}
                          placeholder="e.g. Jewels, Points, Miles"
                        />
                        {errors.rewardUnit && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.rewardUnit}</span>}
                      </div>
                      <div className="input-group">
                        <label>Points to ₹1 Conversion Rate (Optional)</label>
                        <input
                          type="number"
                          className="input-field"
                          value={newAccount.pointsConversionRate || ''}
                          onChange={e => setNewAccount({ ...newAccount, pointsConversionRate: parseFloat(e.target.value) || undefined })}
                          placeholder="e.g. 5 (means 5 Jewels = ₹1)"
                          step="any"
                          min="0.0001"
                        />
                        <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                          Used to automatically convert cashback rupees to points.
                        </p>
                      </div>
                      <div className="input-group">
                        <label>{editId ? 'Reward Points Current Balance' : 'Reward Points Opening Balance'}</label>
                        <input
                          type="number"
                          className={`input-field ${errors.rewardOpeningBalance ? 'border-danger' : ''}`}
                          value={rewardOpeningBalanceInput}
                          onChange={e => {
                            setRewardOpeningBalanceInput(e.target.value);
                            if (errors.rewardOpeningBalance) setErrors(prev => ({ ...prev, rewardOpeningBalance: '' }));
                          }}
                          placeholder="0"
                        />
                        {errors.rewardOpeningBalance && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.rewardOpeningBalance}</span>}
                      </div>
                    </>
                  )}



                  <div className="input-group">
                    <label>
                      Default Cashback Rate (%{(() => {
                        const unit = getDestAccountUnit(newAccount);
                        return unit ? ` in ${unit.toLowerCase()}` : '';
                      })()})
                    </label>
                    <input
                      type="number"
                      className={`input-field ${errors.defaultCashbackRate ? 'border-danger' : ''}`}
                      value={newAccount.defaultCashbackRate || ''}
                      onChange={e => {
                        setNewAccount({ ...newAccount, defaultCashbackRate: parseFloat(e.target.value) });
                        if (errors.defaultCashbackRate) setErrors(prev => ({ ...prev, defaultCashbackRate: '' }));
                      }}
                      placeholder="e.g. 1.5"
                      step="0.1"
                    />
                    {errors.defaultCashbackRate && <span className="text-xs text-danger" style={{ marginTop: '0.25rem' }}>{errors.defaultCashbackRate}</span>}
                  </div>
                  <div className="input-group">
                    <label className="flex align-center" style={{ cursor: 'pointer', margin: '0.5rem 0', fontWeight: 500, color: 'var(--text-primary)', gap: '10px' }}>
                      <input
                        type="checkbox"
                        style={{ margin: 0, width: '16px', height: '16px' }}
                        checked={newAccount.roundOffCashback || false}
                        onChange={e => setNewAccount({ ...newAccount, roundOffCashback: e.target.checked })}
                      />
                      <span style={{ display: 'inline-flex', alignItems: 'center', transform: 'translateY(1px)' }}>Round off cashback?</span>
                    </label>
                  </div>

                  <div className="flex-col gap-3" style={{ marginTop: '1.25rem' }}>
                    <label className="text-sm" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Custom Cashback Levels (Optional)</label>

                    {newAccount.cashbackRates && newAccount.cashbackRates.length > 0 && (
                      <div className="flex-col gap-2" style={{ marginBottom: '0.5rem' }}>
                        {newAccount.cashbackRates.map((cr, idx) => (
                          <div key={cr.id} className="flex-col gap-2" style={{ padding: '0.75rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                            <div className="flex justify-between align-center">
                              <span className="text-sm" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{cr.name} <span className="text-muted">({cr.rate}%)</span></span>
                              <div className="flex gap-3">
                                <button
                                  className="btn btn-secondary"
                                  style={{
                                    width: '30px',
                                    height: '30px',
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--text-muted)',
                                    minHeight: 'auto',
                                    boxShadow: '2px 2px 0 #000'
                                  }}
                                  onClick={() => {
                                    setEditingCashbackRateId(cr.id);
                                    setNewCbName(cr.name);
                                    setNewCbRate(cr.rate.toString());
                                    setNewCbRoundOff(cr.roundOffCashback || false);
                                  }}
                                  title="Edit"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  style={{
                                    width: '30px',
                                    height: '30px',
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--danger)',
                                    minHeight: 'auto',
                                    boxShadow: '2px 2px 0 #000'
                                  }}
                                  onClick={() => removeCashbackRate(cr.id)}
                                  title="Remove"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                            <label className="flex align-center text-sm text-secondary" style={{ cursor: 'pointer', fontWeight: 500, gap: '10px' }}>
                              <input
                                type="checkbox"
                                style={{ margin: 0, width: '16px', height: '16px' }}
                                checked={cr.roundOffCashback || false}
                                onChange={e => {
                                  if (!newAccount.cashbackRates) return;
                                  const updated = [...newAccount.cashbackRates];
                                  updated[idx] = { ...updated[idx], roundOffCashback: e.target.checked };
                                  setNewAccount({ ...newAccount, cashbackRates: updated });
                                }}
                              />
                              <span style={{ display: 'inline-flex', alignItems: 'center', transform: 'translateY(1px)' }}>Round off cashback?</span>
                            </label>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex-col gap-2">
                      <div className="flex gap-2" style={{ alignItems: 'stretch' }}>
                        <input className="input-field" style={{ flex: 1, minWidth: '100px' }} placeholder="Label (e.g. UPI)" value={newCbName} onChange={e => setNewCbName(e.target.value)} />
                        <input
                          className="input-field"
                          style={{ width: '70px', flexShrink: 0, textAlign: 'center' }}
                          placeholder={(() => {
                            const unit = getDestAccountUnit(newAccount);
                            return unit ? `% ${unit.slice(0, 3).toLowerCase()}` : "%";
                          })()}
                          type="number"
                          step="0.1"
                          value={newCbRate}
                          onChange={e => setNewCbRate(e.target.value)}
                        />
                        {editingCashbackRateId ? (
                          <div className="flex gap-2">
                            <button className="btn btn-secondary" style={{ padding: '0.75rem', minWidth: '54px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success)', boxShadow: 'none' }} onClick={addCashbackRate} aria-label="Save Cashback Rate"><Check size={18} /></button>
                            <button className="btn btn-secondary" style={{ padding: '0.75rem', minWidth: '54px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)', boxShadow: 'none' }} onClick={() => { setEditingCashbackRateId(null); setNewCbName(''); setNewCbRate(''); setNewCbRoundOff(false); }} aria-label="Cancel Edit"><X size={18} /></button>
                          </div>
                        ) : (
                          <button className="btn btn-secondary" style={{ padding: '0.75rem', minWidth: '54px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'none' }} onClick={addCashbackRate} aria-label="Add Cashback Rate"><Plus size={18} /></button>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
              {(newAccount.type === 'credit_card' || newAccount.type === 'debit_card') && (
                <>
                  {/* ── Card Details (Optional) ───────────────────────────── */}
                  <div
                    ref={cardDetailsRef}
                    className="flex-col gap-3"
                    style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '12px' }}
                  >
                    <div className="flex justify-between align-center">
                      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>💳 Card Details <span className="text-muted" style={{ fontWeight: 400 }}>(Optional)</span></span>
                      {newAccount.cardDetails ? (
                        <div className="flex gap-3">
                          {isEditingCardDetails ? (
                            <button
                              className="btn btn-secondary"
                              style={{
                                width: '30px',
                                height: '30px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--success)',
                                minHeight: 'auto',
                                boxShadow: '2px 2px 0 #000'
                              }}
                              onClick={() => setIsEditingCardDetails(false)}
                              title="Save Details"
                            >
                              <Check size={14} />
                            </button>
                          ) : (
                            <button
                              className="btn btn-secondary"
                              style={{
                                width: '30px',
                                height: '30px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--text-muted)',
                                minHeight: 'auto',
                                boxShadow: '2px 2px 0 #000'
                              }}
                              onClick={() => {
                                setIsEditingCardDetails(true);
                                if (newAccount.cardDetails?.expiryMonth && newAccount.cardDetails?.expiryYear) {
                                  setExpiryInput(`${newAccount.cardDetails.expiryMonth.toString().padStart(2, '0')}/${newAccount.cardDetails.expiryYear.toString().padStart(2, '0')}`);
                                } else {
                                  setExpiryInput('');
                                }
                              }}
                              title="Edit Details"
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                          <button
                            className="btn btn-secondary"
                            style={{
                              width: '30px',
                              height: '30px',
                              padding: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--danger)',
                              minHeight: 'auto',
                              boxShadow: '2px 2px 0 #000'
                            }}
                            onClick={() => {
                              setNewAccount({ ...newAccount, cardDetails: undefined });
                              setIsEditingCardDetails(false);
                            }}
                            title="Remove Details"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-secondary"
                          style={{
                            width: '30px',
                            height: '30px',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-muted)',
                            minHeight: 'auto',
                            boxShadow: '2px 2px 0 #000'
                          }}
                          onClick={() => {
                            setNewAccount({ ...newAccount, cardDetails: {} });
                            setIsEditingCardDetails(true);
                            setExpiryInput('');
                            setTimeout(() => {
                              cardDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 100);
                          }}
                          title="Add Details"
                        >
                          <Plus size={14} />
                        </button>
                      )}
                    </div>

                    {newAccount.cardDetails && (
                      <div className="flex-col gap-3">
                        <p className="text-xs text-muted" style={{ margin: 0 }}>Stored locally on your device, protected by your app PIN.</p>

                        <div className="flex-col gap-1">
                          <label className="text-xs text-muted font-bold">CARDHOLDER NAME</label>
                          {isEditingCardDetails ? (
                            <input
                              className="input-field"
                              placeholder="e.g. TRIBHUVAN K"
                              value={newAccount.cardDetails.cardholderName || ''}
                              onChange={e => setNewAccount({ ...newAccount, cardDetails: { ...newAccount.cardDetails, cardholderName: e.target.value.toUpperCase() } as CardDetails })}
                              style={{ textTransform: 'uppercase', height: '48px', fontWeight: 'normal' }}
                            />
                          ) : (
                            <div style={{ padding: '0.85rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '4px', textTransform: 'uppercase', fontFamily: "'Overpass Mono', monospace", fontSize: '1rem', lineHeight: '1.5', color: 'var(--text-primary)', boxShadow: 'inset 3px 3px 0 rgba(0, 0, 0, 0.4)', height: '48px', display: 'flex', alignItems: 'center' }}>
                              {newAccount.cardDetails.cardholderName || 'N/A'}
                            </div>
                          )}
                        </div>

                        <div className="flex-col gap-1">
                          <label className="text-xs text-muted font-bold">CARD NUMBER</label>
                          {isEditingCardDetails ? (
                            <input
                              className="input-field"
                              placeholder="1234 5678 9012 3456"
                              inputMode="numeric"
                              maxLength={19}
                              value={newAccount.cardDetails.cardNumber
                                ? newAccount.cardDetails.cardNumber.replace(/\D/g, '').replace(/(\d{4})/g, '$1 ').trim()
                                : ''}
                              onChange={e => {
                                const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
                                setNewAccount({ ...newAccount, cardDetails: { ...newAccount.cardDetails, cardNumber: digits } as CardDetails });
                              }}
                              style={{ fontFamily: "'Overpass Mono', monospace", letterSpacing: '3px', height: '48px', fontWeight: 'normal' }}
                            />
                          ) : (
                            <div style={{ padding: '0.85rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '4px', fontFamily: "'Overpass Mono', monospace", letterSpacing: '3px', fontSize: '1rem', lineHeight: '1.5', color: 'var(--text-primary)', boxShadow: 'inset 3px 3px 0 rgba(0, 0, 0, 0.4)', height: '48px', display: 'flex', alignItems: 'center' }}>
                              {newAccount.cardDetails.cardNumber
                                ? newAccount.cardDetails.cardNumber.replace(/\D/g, '').replace(/(\d{4})/g, '$1 ').trim()
                                : '•••• •••• •••• ••••'}
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <div className="flex-col gap-1" style={{ width: '90px' }}>
                            <label className="text-xs text-muted font-bold">EXPIRY</label>
                            {isEditingCardDetails ? (
                              <input
                                className="input-field"
                                placeholder="MM/YY"
                                inputMode="numeric"
                                maxLength={5}
                                value={expiryInput}
                                onChange={e => {
                                  let val = e.target.value;
                                  const digits = val.replace(/\D/g, '');
                                  let formatted = digits.slice(0, 4);
                                  if (formatted.length > 2) {
                                    formatted = formatted.slice(0, 2) + '/' + formatted.slice(2);
                                  }
                                  setExpiryInput(formatted);
                                  const mm = digits.length >= 2 ? parseInt(digits.slice(0, 2)) || undefined : undefined;
                                  const yy = digits.length >= 4 ? parseInt(digits.slice(2, 4)) || undefined : undefined;
                                  setNewAccount(prev => ({ ...prev, cardDetails: { ...prev.cardDetails, expiryMonth: mm, expiryYear: yy } as CardDetails }));
                                }}
                                style={{ fontFamily: "'Overpass Mono', monospace", letterSpacing: '2px', height: '48px', fontWeight: 'normal' }}
                              />
                            ) : (
                              <div style={{ padding: '0.85rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '4px', fontFamily: "'Overpass Mono', monospace", letterSpacing: '2px', fontSize: '1rem', lineHeight: '1.5', color: 'var(--text-primary)', boxShadow: 'inset 3px 3px 0 rgba(0, 0, 0, 0.4)', height: '48px', display: 'flex', alignItems: 'center' }}>
                                {newAccount.cardDetails.expiryMonth && newAccount.cardDetails.expiryYear
                                  ? `${newAccount.cardDetails.expiryMonth.toString().padStart(2, '0')}/${newAccount.cardDetails.expiryYear.toString().padStart(2, '0')}`
                                  : 'MM/YY'}
                              </div>
                            )}
                          </div>
                          <div className="flex-col gap-1" style={{ flex: 1, position: 'relative' }}>
                            <label className="text-xs text-muted font-bold">CVV</label>
                            {isEditingCardDetails ? (
                              <div style={{ position: 'relative' }}>
                                <input
                                  className="input-field"
                                  placeholder="•••"
                                  type={showCvv ? 'text' : 'password'}
                                  inputMode="numeric"
                                  maxLength={4}
                                  value={newAccount.cardDetails.cvv || ''}
                                  onChange={e => setNewAccount({ ...newAccount, cardDetails: { ...newAccount.cardDetails, cvv: e.target.value.replace(/\D/g, '') } as CardDetails })}
                                  style={{ fontFamily: "'Overpass Mono', monospace", letterSpacing: '4px', width: '100%', paddingRight: '2.5rem', height: '48px', fontWeight: 'normal' }}
                                />
                                <button
                                  onClick={() => setShowCvv(v => !v)}
                                  style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: '0.75rem', cursor: 'pointer' }}
                                  title={showCvv ? 'Hide CVV' : 'Show CVV'}
                                >
                                  {showCvv ? '🙈' : '👁️'}
                                </button>
                              </div>
                            ) : (
                              <div style={{ position: 'relative' }}>
                                <div style={{ padding: '0.85rem', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '4px', fontFamily: "'Overpass Mono', monospace", letterSpacing: '4px', fontSize: '1rem', lineHeight: '1.5', color: 'var(--text-primary)', width: '100%', boxShadow: 'inset 3px 3px 0 rgba(0, 0, 0, 0.4)', paddingRight: '2.5rem', height: '48px', display: 'flex', alignItems: 'center' }}>
                                  {newAccount.cardDetails.cvv ? (showCvv ? newAccount.cardDetails.cvv : '•••') : 'N/A'}
                                </div>
                                {newAccount.cardDetails.cvv && (
                                  <button
                                    onClick={() => setShowCvv(v => !v)}
                                    style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: '0.75rem', cursor: 'pointer' }}
                                    title={showCvv ? 'Hide CVV' : 'Show CVV'}
                                  >
                                    {showCvv ? '🙈' : '👁️'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex-col gap-1">
                          <label className="text-xs text-muted font-bold">NETWORK</label>
                          {isEditingCardDetails ? (
                            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                              {(['visa', 'mastercard', 'rupay', 'amex', 'diners'] as CardNetwork[]).map(net => {
                                const isSelected = newAccount.cardDetails?.network === net;
                                return (
                                  <button
                                    key={net}
                                    onClick={() => setNewAccount({ ...newAccount, cardDetails: { ...newAccount.cardDetails, network: isSelected ? undefined : net } as CardDetails })}
                                    style={{
                                      width: '56px',
                                      height: '32px',
                                      padding: 0,
                                      borderRadius: '10px',
                                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'}`,
                                      background: isSelected ? 'rgba(var(--accent-rgb, 20,184,166), 0.12)' : 'var(--bg-color)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                      transition: 'all 0.2s',
                                      boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                                      color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
                                    }}
                                  >
                                    <CardNetworkLogo network={net} size="sm" />
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div style={{ display: 'flex' }}>
                              <div
                                style={{
                                  width: '56px',
                                  height: '32px',
                                  borderRadius: '10px',
                                  border: '1px solid var(--border-color)',
                                  background: 'var(--bg-color)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {newAccount.cardDetails.network ? (
                                  <CardNetworkLogo network={newAccount.cardDetails.network} size="sm" />
                                ) : (
                                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>N/A</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>Save Account</button>
            </div>
          </div>
        </div>
      )}

      {viewingCard && (
        <ViewCardOverlay
          account={viewingCard}
          onClose={() => setViewingCard(null)}
        />
      )}
      {/* Custom Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="Delete Account?"
        message="Are you sure you want to remove this account? This will also remove its associated transaction history."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (deleteConfirmId) {
            deleteAccount(deleteConfirmId);
            setDeleteConfirmId(null);
          }
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
}
