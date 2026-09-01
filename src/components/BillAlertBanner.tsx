import { useState } from 'react';
import { format } from 'date-fns';
import { BellRing, X } from 'lucide-react';
import { useFinance } from '../FinanceContext';
import { getActiveCardDues } from '../services/CardDuesService';

interface BillAlertBannerProps {
  onNavigateToBills: () => void;
}

const STORAGE_KEY = 'spendvault_bill_alert_shown_date';
const URGENCY_DAYS = 3;

export default function BillAlertBanner({ onNavigateToBills }: BillAlertBannerProps) {
  const { data } = useFinance();

  const today = format(new Date(), 'yyyy-MM-dd');
  const [visible, setVisible] = useState(() => localStorage.getItem(STORAGE_KEY) !== today);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, today);
    setVisible(false);
  };

  const getDaysLeft = (dateStr: string) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const due = new Date(dateStr);
    due.setHours(0, 0, 0, 0);
    return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  // Manual bills. No paid check: a recurring bill has no settled state, and paying it rolls
  // nextDueDate forward — which is what drops it out of the 3-day window on its own.
  const manualAlerts = (data.recurringBills || [])
    .filter(bill => bill.isActive)
    .map(bill => ({ name: bill.name, daysLeft: getDaysLeft(bill.nextDueDate) }))
    .filter(b => b.daysLeft <= URGENCY_DAYS);

  // CC bills. The statement figure and the due date both come from CardDuesService, so this banner
  // can't warn about an amount the Dashboard and Accounts disagree with — which it used to, on any
  // card that had redeemed its own points.
  const ccAlerts = getActiveCardDues(data.accounts, data.transactions)
    .filter(d => d.daysToDue !== undefined && d.billed > 0 && d.daysToDue <= URGENCY_DAYS)
    .map(d => ({ name: `${d.account.name} Payment`, daysLeft: d.daysToDue! }));

  const allAlerts = [...manualAlerts, ...ccAlerts];
  const overdueCount = allAlerts.filter(a => a.daysLeft < 0).length;
  const urgentCount = allAlerts.filter(a => a.daysLeft >= 0).length;

  if (!visible || allAlerts.length === 0) return null;

  const hasOverdue = overdueCount > 0;
  const borderColor = hasOverdue ? 'var(--danger, #ff4d4d)' : 'var(--warning-color, #fbbf24)';
  const iconColor = hasOverdue ? 'var(--danger, #ff4d4d)' : 'var(--warning-color, #fbbf24)';

  const summaryParts: string[] = [];
  if (overdueCount > 0) summaryParts.push(`${overdueCount} overdue`);
  if (urgentCount > 0) summaryParts.push(`${urgentCount} due within 3 days`);

  return (
    <div
      className="animate-slide-down"
      style={{
        position: 'fixed',
        top: 'var(--safe-area-inset-top)',
        left: 0,
        right: 0,
        zIndex: 8500,
        padding: '0.5rem 1rem',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          background: 'var(--bg-card, #1a1a1a)',
          border: `2px solid ${borderColor}`,
          borderRadius: '14px',
          padding: '0.75rem 1rem',
          boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px ${borderColor}22`,
          pointerEvents: 'auto'
        }}
      >
        <button
          onClick={() => { onNavigateToBills(); dismiss(); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flex: 1,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textAlign: 'left',
            minWidth: 0
          }}
        >
          <BellRing size={20} style={{ color: iconColor, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {summaryParts.join(' · ')}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Tap to review bills
            </p>
          </div>
        </button>
        <button
          onClick={dismiss}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            padding: '0.25rem',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0
          }}
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
