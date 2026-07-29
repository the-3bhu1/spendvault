// Canonical category + account-type icon mappings used by the ledger transaction modal, and
// reused by every other picker (Upcoming Bills, Lending & Borrowing) so icons never drift
// between screens. Update an icon here and it changes everywhere.
import {
  Train, ShoppingBag, Utensils, Car, Zap, HeartPulse, Film, BadgeIndianRupee, Banknote,
  CreditCard, ArrowRightLeft, Home, Handshake, Gift, ChartNoAxesCombined, ChartCandlestick,
  Gem, HandCoins, MoreHorizontal, Coins, Landmark, WalletCards, WalletMinimal, BarChart3,
  TrendingUp, Medal, Wallet
} from 'lucide-react';

export const getCategoryIcon = (category: string, size = 17) => {
  const cat = category.toLowerCase();
  if (cat.includes('ncmc')) return <Train size={size} />;
  if (cat.includes('shop')) return <ShoppingBag size={size} />;
  if (cat.includes('food') || cat.includes('eat') || cat.includes('dine')) return <Utensils size={size} />;
  if (cat.includes('travel') || cat.includes('transport') || cat.includes('fuel')) return <Car size={size} />;
  if (cat.includes('bill') || cat.includes('recharge') || cat.includes('utility')) return <Zap size={size} />;
  if (cat.includes('health') || cat.includes('med')) return <HeartPulse size={size} />;
  if (cat.includes('entertain') || cat.includes('movie') || cat.includes('ott')) return <Film size={size} />;
  if (cat.includes('salary')) return <BadgeIndianRupee size={size} />;
  if (cat.includes('income')) return <Banknote size={size} />;
  if (cat.includes('cc payment')) return <CreditCard size={size} />;
  if (cat.includes('transfer')) return <ArrowRightLeft size={size} />;
  if (cat.includes('rent')) return <Home size={size} />;
  if (cat.includes('loan')) return <Handshake size={size} />;
  if (cat.includes('cashback')) return <Gift size={size} />;
  if (cat.includes('invest') || cat.includes('mutual fund') || cat.includes('sip') || cat.includes('stock') || cat.includes('commodity')) return <TrendingUp size={size} />;
  if (cat.includes('lend') || cat.includes('borrow')) return <HandCoins size={size} />;
  if (cat.includes('miscellaneous') || cat.includes('other')) return <MoreHorizontal size={size} />;
  return <Coins size={size} />;
};

// Canonical emoji per account type — the "playful" style used on the Accounts page, the account-type
// picker, and Upcoming Bills. Kept here (one source) so the three spots never drift apart. Pass the
// account's isNcmcEnabled / commodityMetal when available: a specific metal account shows its medal
// (🥇/🥈), while the generic commodity type (no account context, e.g. the type picker) shows 💎.
export const getAccountEmoji = (
  type: string,
  opts?: { isNcmcEnabled?: boolean; commodityMetal?: 'gold' | 'silver' }
): string => {
  if (opts?.isNcmcEnabled) return '🪪';
  switch (type) {
    case 'credit_card': return '💳';
    case 'debit_card': return '🪪';
    case 'bank_account': return '🏦';
    case 'e_wallet': return '🪙';
    case 'stocks':
    case 'investment': return '📈';
    case 'mutual_funds': return '💹';
    case 'rewards': return '🎁';
    case 'cash': return '💵';
    case 'epf': return '🏛️';
    case 'commodity':
      return opts?.commodityMetal === 'silver' ? '🥈' : opts?.commodityMetal === 'gold' ? '🥇' : '💎';
    default: return '💼';
  }
};

export const getAccountTypeIcon = (type: string, size = 18) => {
  switch (type) {
    case 'credit_card':
    case 'debit_card':
      return <CreditCard size={size} />;
    case 'bank_account':
    case 'epf':
      return <Landmark size={size} />;
    case 'e_wallet':
      return <WalletCards size={size} />;
    case 'rewards':
      return <Gift size={size} />;
    case 'cash':
      return <WalletMinimal size={size} />;
    case 'mutual_funds':
      return <BarChart3 size={size} />;
    case 'stocks':
    case 'investment':
      return <TrendingUp size={size} />;
    default:
      return <Wallet size={size} />;
  }
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank_account: 'Bank Accounts',
  credit_card: 'Credit Cards',
  debit_card: 'Debit Cards',
  cash: 'Physical Cash',
  e_wallet: 'E-Wallets',
  rewards: 'Rewards & Cashback',
  epf: 'EPF (Provident Fund)',
  stocks: 'Stocks & Investments',
  mutual_funds: 'Mutual Funds',
  commodity: 'Commodities'
};

export const ACCOUNT_TYPE_ORDER: Record<string, number> = {
  bank_account: 0,
  credit_card: 1,
  debit_card: 2,
  cash: 3,
  e_wallet: 4,
  rewards: 5,
  epf: 6,
  stocks: 7,
  mutual_funds: 8,
  commodity: 9
};

export const getAccountGroupLabel = (type: string, archived?: boolean): string => {
  if (archived) return 'Archived Accounts';
  return ACCOUNT_TYPE_LABELS[type] || type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export const sortByAccountType = (a: { type: string; archived?: boolean }, b: { type: string; archived?: boolean }) => {
  const isArchivedA = !!a.archived;
  const isArchivedB = !!b.archived;
  if (isArchivedA !== isArchivedB) return isArchivedA ? 1 : -1;
  const orderA = ACCOUNT_TYPE_ORDER[a.type] ?? 99;
  const orderB = ACCOUNT_TYPE_ORDER[b.type] ?? 99;
  return orderA - orderB;
};

