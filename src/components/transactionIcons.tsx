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
  if (cat.includes('sip')) return <ChartNoAxesCombined size={size} />;
  if (cat.includes('stocks')) return <ChartCandlestick size={size} />;
  if (cat.includes('commodity')) return <Gem size={size} />;
  if (cat.includes('lend') || cat.includes('borrow')) return <HandCoins size={size} />;
  if (cat.includes('miscellaneous') || cat.includes('other')) return <MoreHorizontal size={size} />;
  return <Coins size={size} />;
};

export const getAccountTypeIcon = (type: string, size = 18) => {
  switch (type) {
    case 'credit_card':
    case 'debit_card':
      return <CreditCard size={size} />;
    case 'bank_account':
      return <Landmark size={size} />;
    case 'e_wallet':
      return <WalletCards size={size} />;
    case 'rewards':
      return <Gift size={size} />;
    case 'cash':
      return <WalletMinimal size={size} />;
    case 'sips':
      return <BarChart3 size={size} />;
    case 'stocks':
    case 'investment':
      return <TrendingUp size={size} />;
    case 'commodity':
      return <Medal size={size} />;
    default:
      return <Wallet size={size} />;
  }
};
