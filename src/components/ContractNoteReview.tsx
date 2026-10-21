import { useState } from 'react';
import { format } from 'date-fns';
import { Calendar, X, AlertTriangle, Trash2, Plus } from 'lucide-react';
import { useFinance } from '../FinanceContext';
import { CustomPicker } from './CustomPicker';
import CustomDatePicker from './CustomDatePicker';
import { getAccountTypeIcon } from './transactionIcons';
import { generateId, INVESTMENT_CATEGORY, investmentLegAmount, investmentHoldingSideType } from '../utils';
import { planContractNoteSells, type AllocatedTrade } from '../services/ContractNoteService';

const CREATE_NEW = '__create_new__';

interface EditableRow {
  rowId: string;
  side: 'buy' | 'sell';
  name: string;
  quantityStr: string;
  investedStr: string;
  chargesStr: string;
  accountSelection: string; // existing account id, or CREATE_NEW
}

function fuzzyMatchAccountId(tradeName: string, accounts: { id: string; name: string }[], fallback: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(tradeName);
  if (!target) return fallback;
  const match = accounts.find(a => {
    const n = norm(a.name);
    return n === target || n.includes(target) || target.includes(n);
  });
  return match?.id || fallback;
}

interface ContractNoteReviewProps {
  trades: AllocatedTrade[];
  reconciliationWarning?: string;
  onConfirm: (summary: string) => void;
  onDismiss: () => void;
}

export default function ContractNoteReview({ trades, reconciliationWarning, onConfirm, onDismiss }: ContractNoteReviewProps) {
  const { data, addAccount, addTransaction } = useFinance();
  const stocksAccounts = data.accounts.filter(a => a.type === 'stocks' && !a.archived);
  const fundingAccounts = data.accounts.filter(a => (a.type === 'bank_account' || a.type === 'e_wallet') && !a.archived);

  const [rows, setRows] = useState<EditableRow[]>(() => trades.map(t => ({
    rowId: t.key,
    side: t.side,
    name: t.name,
    quantityStr: t.quantity ? t.quantity.toString() : '',
    investedStr: t.tradeValue ? t.tradeValue.toString() : '',
    chargesStr: t.brokerageTaxes ? t.brokerageTaxes.toString() : '',
    accountSelection: fuzzyMatchAccountId(t.name, stocksAccounts, t.side === 'sell' ? '' : CREATE_NEW),
  })));
  const [fundingAccountId, setFundingAccountId] = useState(fundingAccounts[0]?.id || '');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const updateRow = (rowId: string, patch: Partial<EditableRow>) => {
    setRows(prev => prev.map(r => r.rowId === rowId ? { ...r, ...patch } : r));
  };
  const removeRow = (rowId: string) => setRows(prev => prev.filter(r => r.rowId !== rowId));

  const decimalOnChange = (rowId: string, field: 'quantityStr' | 'investedStr' | 'chargesStr') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || /^\d*\.?\d*$/.test(val)) updateRow(rowId, { [field]: val } as Partial<EditableRow>);
  };

  const holdingOptions = stocksAccounts.map(a => ({ id: a.id, name: a.name, subtext: 'stocks' }));
  const accountOptions = [{ id: CREATE_NEW, name: 'Create new account' }, ...holdingOptions];

  const hasSells = rows.some(r => r.side === 'sell');
  const sellPlans = planContractNoteSells(
    rows.map(r => ({
      rowId: r.rowId,
      side: r.side,
      accountId: r.accountSelection === CREATE_NEW ? '' : r.accountSelection,
      quantity: parseFloat(r.quantityStr) || 0,
      tradeValue: parseFloat(r.investedStr) || 0,
      charges: parseFloat(r.chargesStr) || 0,
    })),
    data.accounts,
    data.transactions,
    date
  );
  const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signedInr = (n: number) => `${n < 0 ? '−' : '+'}₹${inr(Math.abs(n))}`;

  const handleLogAll = () => {
    if (!fundingAccountId) { setError('Select a funding account.'); return; }
    if (rows.length === 0) { setError('No trades to log.'); return; }
    for (const r of rows) {
      if (!r.name.trim() || !r.investedStr || parseFloat(r.investedStr) <= 0) {
        setError(`"${r.name || 'A row'}" needs a name and ${r.side === 'sell' ? 'sale value' : 'invested amount'}.`);
        return;
      }
      if (r.side === 'sell') {
        const plan = sellPlans.get(r.rowId);
        if (plan && !plan.ok) { setError(`"${r.name}": ${plan.error}`); return; }
        if ((parseFloat(r.chargesStr) || 0) > parseFloat(r.investedStr)) {
          setError(`"${r.name}": charges can't exceed the sale value.`);
          return;
        }
      }
    }
    setError('');
    setSaving(true);

    // Pre-create any new stocks accounts up front — data.accounts won't reflect an account
    // just added via addAccount() until the next render, so build the id map before writing
    // any transactions rather than re-reading `data` mid-loop.
    const monthKey = format(new Date(date), 'yyyy-MM');
    const accountIdByRow = new Map<string, string>();
    for (const r of rows) {
      if (r.accountSelection === CREATE_NEW) {
        const newId = generateId();
        addAccount({
          id: newId,
          name: r.name.trim(),
          type: 'stocks',
          openingBalances: { [monthKey]: 0 },
          balanceAdjustments: { [monthKey]: 0 },
          numberOfShares: 0,
          investedValue: 0,
        });
        accountIdByRow.set(r.rowId, newId);
      } else {
        accountIdByRow.set(r.rowId, r.accountSelection);
      }
    }

    let totalInvested = 0;
    let totalReceived = 0;
    const reportLines: string[] = [];
    for (const r of rows) {
      const stocksAccountId = accountIdByRow.get(r.rowId)!;
      const invested = parseFloat(r.investedStr) || 0;
      const charges = parseFloat(r.chargesStr) || 0;
      const quantity = r.quantityStr ? parseFloat(r.quantityStr) : undefined;
      const mainTxId = generateId();
      const counterpartId = generateId();

      // For an EXISTING account, log against its canonical name/casing (e.g. "DPSC Limited"),
      // keeping this trade consistent with that account's prior history — the contract note's
      // ALL-CAPS text is only used to name/describe a NEWLY created account.
      const existingAcc = r.accountSelection === CREATE_NEW ? undefined : data.accounts.find(a => a.id === r.accountSelection);
      const description = (existingAcc?.name || r.name).trim();

      if (r.side === 'sell') {
        const plan = sellPlans.get(r.rowId);
        if (!plan || !plan.ok) continue;
        const sellFields = {
          investmentAction: 'sell' as const,
          costBasis: plan.costBasis,
          allottedAmount: invested,
          investmentCharges: charges,
        };
        const holdingSide = investmentHoldingSideType('sell');
        const cashSide = holdingSide === 'credit' ? 'debit' : 'credit';
        addTransaction({
          id: counterpartId,
          date,
          description,
          accountId: fundingAccountId,
          type: cashSide,
          amount: investmentLegAmount(false, { amount: plan.proceeds, ...sellFields }, true),
          category: INVESTMENT_CATEGORY,
          investmentKind: 'stocks',
          isRecurring: false,
          linkedTransactionIds: [mainTxId],
          numberOfShares: quantity,
          ...sellFields,
        });
        addTransaction({
          id: mainTxId,
          date,
          description,
          accountId: stocksAccountId,
          type: holdingSide,
          amount: investmentLegAmount(true, { amount: plan.proceeds, ...sellFields }, true),
          category: INVESTMENT_CATEGORY,
          investmentKind: 'stocks',
          isRecurring: false,
          linkedTransactionIds: [counterpartId],
          paymentSourceAccountId: fundingAccountId,
          numberOfShares: quantity,
          ...sellFields,
        });
        totalReceived += plan.proceeds;
        reportLines.push(`• **${description}** — sold ${quantity} sh · ₹${inr(invested)} − ₹${inr(charges)} charges · P&L ${signedInr(plan.realizedPnl)}`);
        continue;
      }

      // Mirrors Transactions.tsx's isStocks branch: a stock purchase credits the stocks
      // account (shares acquired) and debits the funding account for invested + charges.
      addTransaction({
        id: counterpartId,
        date,
        description,
        accountId: fundingAccountId,
        type: 'debit',
        amount: invested + charges,
        category: INVESTMENT_CATEGORY,
        investmentKind: 'stocks',
        isRecurring: false,
        linkedTransactionIds: [mainTxId],
        numberOfShares: quantity,
        allottedAmount: invested,
        investmentCharges: charges,
      });
      addTransaction({
        id: mainTxId,
        date,
        description,
        accountId: stocksAccountId,
        type: 'credit',
        amount: invested,
        category: INVESTMENT_CATEGORY,
        investmentKind: 'stocks',
        isRecurring: false,
        linkedTransactionIds: [counterpartId],
        paymentSourceAccountId: fundingAccountId,
        numberOfShares: quantity,
        allottedAmount: invested,
        investmentCharges: charges,
      });
      totalInvested += invested + charges;
      // Per-stock recap line — rendered by AskVault's markdown renderer (bold + bullet list),
      // so the logged report stays visible in chat history, not just the total.
      const qtyPart = quantity !== undefined ? `${quantity} sh · ` : '';
      reportLines.push(`• **${description}** — ${qtyPart}₹${inr(invested)} + ₹${inr(charges)} charges`);
    }

    setSaving(false);
    const totals = [
      totalInvested > 0 ? `₹${inr(totalInvested)} invested` : '',
      totalReceived > 0 ? `₹${inr(totalReceived)} received` : '',
    ].filter(Boolean).join(', ');
    const header = `✅ Logged ${rows.length} stock trade${rows.length === 1 ? '' : 's'} from your contract note (${totals}).`;
    onConfirm(`${header}\n\n${reportLines.join('\n')}`);
  };

  return (
    <div className="card flex-col gap-3" style={{ padding: '1rem', marginTop: '0.5rem' }}>
      <div className="flex justify-between align-center">
        <span className="font-bold" style={{ fontSize: '0.95rem' }}>Detected {rows.length} stock trade{rows.length === 1 ? '' : 's'}</span>
        <button className="askvault-icon-btn" onClick={onDismiss} title="Dismiss"><X size={18} /></button>
      </div>

      {reconciliationWarning && (
        <div className="flex align-start gap-2 text-xs" style={{ padding: '0.6rem', borderRadius: '8px', background: 'rgba(234, 179, 8, 0.12)', color: '#eab308' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>{reconciliationWarning}</span>
        </div>
      )}

      <div className="flex-col gap-3">
        {rows.map(r => (
          <div key={r.rowId} className="flex-col gap-2" style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-hover)' }}>
            <div className="flex justify-between align-center gap-2">
              <span className="text-xs font-bold" style={{ padding: '0.2rem 0.5rem', borderRadius: '6px', flexShrink: 0, color: r.side === 'sell' ? 'var(--danger)' : 'var(--success)', border: `1px solid ${r.side === 'sell' ? 'var(--danger)' : 'var(--success)'}` }}>
                {r.side === 'sell' ? 'SELL' : 'BUY'}
              </span>
              <input
                className="input-field"
                style={{ fontWeight: 600 }}
                value={r.name}
                onChange={e => updateRow(r.rowId, { name: e.target.value })}
                placeholder="Stock name"
              />
              <button className="askvault-icon-btn" onClick={() => removeRow(r.rowId)} title="Remove"><Trash2 size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>{r.side === 'sell' ? 'Shares Sold' : 'No. of Shares'}</label>
                <input type="text" inputMode="decimal" className="input-field" value={r.quantityStr} onChange={decimalOnChange(r.rowId, 'quantityStr')} placeholder="e.g. 10" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>{r.side === 'sell' ? 'Sale Value' : 'Invested Amount'}</label>
                <input type="text" inputMode="decimal" className="input-field" value={r.investedStr} onChange={decimalOnChange(r.rowId, 'investedStr')} placeholder="0.00" />
              </div>
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label>Brokerage / Taxes</label>
              <input type="text" inputMode="decimal" className="input-field" value={r.chargesStr} onChange={decimalOnChange(r.rowId, 'chargesStr')} placeholder="0.00" />
            </div>
            <CustomPicker
              label="Stocks Account"
              value={r.accountSelection}
              placeholder="Select holding"
              options={r.side === 'sell' ? holdingOptions : accountOptions}
              onChange={val => updateRow(r.rowId, { accountSelection: val })}
              iconGetter={id => id === CREATE_NEW ? <Plus size={18} /> : getAccountTypeIcon('stocks')}
              style={{ marginBottom: 0 }}
            />
            {r.side === 'sell' && (() => {
              const plan = sellPlans.get(r.rowId);
              if (!plan) return null;
              if (!plan.ok) return <span className="text-xs text-danger">{plan.error}</span>;
              return (
                <div className="flex-col gap-1 text-xs">
                  <span className="text-muted">Held {plan.held} on this date</span>
                  <div className="flex justify-between"><span className="text-muted">Cost basis</span><span className="text-mono">₹{inr(plan.costBasis)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Received</span><span className="text-mono">₹{inr(plan.proceeds)}</span></div>
                  <div className="flex justify-between">
                    <span className="text-muted">Realized P&amp;L</span>
                    <span className="text-mono font-bold" style={{ color: plan.realizedPnl < 0 ? 'var(--danger)' : 'var(--success)' }}>{signedInr(plan.realizedPnl)}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>

      <CustomPicker
        label={hasSells ? 'Bank Account' : 'Funding Account'}
        value={fundingAccountId}
        placeholder="Select account"
        options={fundingAccounts.map(a => ({ id: a.id, name: a.name, subtext: a.type.replace('_', ' ') }))}
        onChange={setFundingAccountId}
        iconGetter={id => getAccountTypeIcon(fundingAccounts.find(a => a.id === id)?.type || '')}
      />

      <div className="input-group" style={{ marginBottom: 0 }}>
        <label>Date</label>
        <div className="input-field flex align-center justify-between gap-3 clickable" onClick={() => setIsDatePickerOpen(true)}>
          <span className="text-mono">{format(new Date(date), 'EEE, d MMM yyyy')}</span>
          <Calendar size={18} className="text-muted" />
        </div>
      </div>
      <CustomDatePicker isOpen={isDatePickerOpen} onClose={() => setIsDatePickerOpen(false)} value={date} onChange={setDate} />

      {error && <span className="text-xs text-danger">{error}</span>}

      <button className="btn btn-primary" disabled={saving} onClick={handleLogAll}>
        {saving ? 'Logging…' : `Log ${rows.length} Trade${rows.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}
