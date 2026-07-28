import { useState } from 'react';
import { format } from 'date-fns';
import { Calendar, X, AlertTriangle, Trash2, Plus } from 'lucide-react';
import { useFinance } from '../FinanceContext';
import { CustomPicker } from './CustomPicker';
import CustomDatePicker from './CustomDatePicker';
import { getAccountTypeIcon } from './transactionIcons';
import { generateId } from '../utils';
import type { AllocatedTrade } from '../services/ContractNoteService';

const CREATE_NEW = '__create_new__';

interface EditableRow {
  rowId: string;
  name: string;
  quantityStr: string;
  investedStr: string;
  chargesStr: string;
  accountSelection: string; // existing account id, or CREATE_NEW
}

function fuzzyMatchAccountId(tradeName: string, accounts: { id: string; name: string }[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(tradeName);
  if (!target) return CREATE_NEW;
  const match = accounts.find(a => {
    const n = norm(a.name);
    return n === target || n.includes(target) || target.includes(n);
  });
  return match?.id || CREATE_NEW;
}

interface ContractNoteReviewProps {
  trades: AllocatedTrade[];
  skippedSellRows: number;
  reconciliationWarning?: string;
  onConfirm: (summary: string) => void;
  onDismiss: () => void;
}

export default function ContractNoteReview({ trades, skippedSellRows, reconciliationWarning, onConfirm, onDismiss }: ContractNoteReviewProps) {
  const { data, addAccount, addTransaction } = useFinance();
  const stocksAccounts = data.accounts.filter(a => a.type === 'stocks' && !a.archived);
  const fundingAccounts = data.accounts.filter(a => (a.type === 'bank_account' || a.type === 'e_wallet') && !a.archived);

  const [rows, setRows] = useState<EditableRow[]>(() => trades.map(t => ({
    rowId: t.key,
    name: t.name,
    quantityStr: t.quantity ? t.quantity.toString() : '',
    investedStr: t.investedAmount ? t.investedAmount.toString() : '',
    chargesStr: t.brokerageTaxes ? t.brokerageTaxes.toString() : '',
    accountSelection: fuzzyMatchAccountId(t.name, stocksAccounts),
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

  const accountOptions = [
    { id: CREATE_NEW, name: 'Create new account' },
    ...stocksAccounts.map(a => ({ id: a.id, name: a.name, subtext: 'stocks' })),
  ];

  const handleLogAll = () => {
    if (!fundingAccountId) { setError('Select a funding account.'); return; }
    if (rows.length === 0) { setError('No trades to log.'); return; }
    for (const r of rows) {
      if (!r.name.trim() || !r.investedStr || parseFloat(r.investedStr) <= 0) {
        setError(`"${r.name || 'A row'}" needs a name and invested amount.`);
        return;
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

    const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let totalLogged = 0;
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

      // Mirrors Transactions.tsx's isStocks branch: a stock purchase credits the stocks
      // account (shares acquired) and debits the funding account for invested + charges.
      addTransaction({
        id: counterpartId,
        date,
        description,
        accountId: fundingAccountId,
        type: 'debit',
        amount: invested + charges,
        category: 'Stocks',
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
        category: 'Stocks',
        isRecurring: false,
        linkedTransactionIds: [counterpartId],
        paymentSourceAccountId: fundingAccountId,
        numberOfShares: quantity,
        allottedAmount: invested,
        investmentCharges: charges,
      });
      totalLogged += invested + charges;
      // Per-stock recap line — rendered by AskVault's markdown renderer (bold + bullet list),
      // so the logged report stays visible in chat history, not just the total.
      const qtyPart = quantity !== undefined ? `${quantity} sh · ` : '';
      reportLines.push(`• **${description}** — ${qtyPart}₹${inr(invested)} + ₹${inr(charges)} charges`);
    }

    setSaving(false);
    const header = `✅ Logged ${rows.length} stock trade${rows.length === 1 ? '' : 's'} from your contract note (₹${inr(totalLogged)} total).`;
    onConfirm(`${header}\n\n${reportLines.join('\n')}`);
  };

  return (
    <div className="card flex-col gap-3" style={{ padding: '1rem', marginTop: '0.5rem' }}>
      <div className="flex justify-between align-center">
        <span className="font-bold" style={{ fontSize: '0.95rem' }}>Detected {rows.length} stock trade{rows.length === 1 ? '' : 's'}</span>
        <button className="askvault-icon-btn" onClick={onDismiss} title="Dismiss"><X size={18} /></button>
      </div>

      {skippedSellRows > 0 && (
        <div className="text-xs text-muted">Skipped {skippedSellRows} sell row{skippedSellRows === 1 ? '' : 's'} found on the note — only buys are logged here.</div>
      )}

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
                <label>No. of Shares</label>
                <input type="text" inputMode="decimal" className="input-field" value={r.quantityStr} onChange={decimalOnChange(r.rowId, 'quantityStr')} placeholder="e.g. 10" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>Invested Amount</label>
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
              options={accountOptions}
              onChange={val => updateRow(r.rowId, { accountSelection: val })}
              iconGetter={id => id === CREATE_NEW ? <Plus size={18} /> : getAccountTypeIcon('stocks')}
              style={{ marginBottom: 0 }}
            />
          </div>
        ))}
      </div>

      <CustomPicker
        label="Funding Account"
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
