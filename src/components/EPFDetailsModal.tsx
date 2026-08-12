import React, { useState, useRef } from 'react';
import type { Account, EPFInterestRateConfig, EPFSalaryRevision, EPFBalanceAdjustment } from '../types';
import { calculateEPFProjection, DEFAULT_EPF_INTEREST_RATES } from '../utils/epfEngine';
import { generateId, formatCurrency } from '../utils';
import { scrollToFirstError } from '../utils/formErrors';
import { Plus, Trash2, Edit2 } from 'lucide-react';

import { SubviewWrapper } from './SubviewWrapper';

interface EPFDetailsViewProps {
  account: Account;
  onClose: () => void;
  onUpdateAccount: (updatedAccount: Account) => void;
}

export const EPFDetailsView: React.FC<EPFDetailsViewProps> = ({
  account,
  onClose,
  onUpdateAccount,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'revisions' | 'corrections' | 'rates'>('overview');

  // Form states for Salary Revisions
  const [isAddingRevision, setIsAddingRevision] = useState(false);
  const [editingRevId, setEditingRevId] = useState<string | null>(null);
  const [revDate, setRevDate] = useState('');
  const [revBasic, setRevBasic] = useState('');
  const [revDa, setRevDa] = useState('');
  const [revEmpPct, setRevEmpPct] = useState('12');
  const [revEmprPct, setRevEmprPct] = useState('12');
  const [revNotes, setRevNotes] = useState('');
  // Both inline panels below used to bail out of their save with a bare `return`, so a missing
  // required field read as a dead button. Messages are shown against the field instead.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const revisionFormRef = useRef<HTMLDivElement>(null);
  const correctionFormRef = useRef<HTMLDivElement>(null);

  // Form states for Balance Corrections
  const [isAddingAdj, setIsAddingAdj] = useState(false);
  const [adjDate, setAdjDate] = useState('');
  const [adjBalance, setAdjBalance] = useState('');
  const [adjNotes, setAdjNotes] = useState('');

  // Rate override edit
  const [overrides, setOverrides] = useState<EPFInterestRateConfig[]>(
    account.interestRateOverrides || DEFAULT_EPF_INTEREST_RATES
  );

  const projection = calculateEPFProjection(account);

  const handleSaveRevision = () => {
    const newErrors: Record<string, string> = {};
    if (!revDate) newErrors.revDate = 'Effective Date is required';
    if (!revBasic) newErrors.revBasic = 'Basic Salary is required';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      scrollToFirstError(revisionFormRef.current);
      return;
    }
    const basicVal = parseFloat(revBasic) || 0;
    const daVal = parseFloat(revDa) || 0;
    const empPctVal = parseFloat(revEmpPct) || 12;
    const emprPctVal = parseFloat(revEmprPct) || 12;

    const currentRevisions = account.salaryRevisions || [];
    let updatedRevisions: EPFSalaryRevision[] = [];

    if (editingRevId) {
      updatedRevisions = currentRevisions.map(r => r.id === editingRevId ? {
        id: r.id,
        effectiveDate: revDate,
        basicSalary: basicVal,
        dearnessAllowance: daVal,
        employeeContributionPct: empPctVal,
        employerContributionPct: emprPctVal,
        notes: revNotes.trim() || undefined,
      } : r);
    } else {
      updatedRevisions = [...currentRevisions, {
        id: generateId(),
        effectiveDate: revDate,
        basicSalary: basicVal,
        dearnessAllowance: daVal,
        employeeContributionPct: empPctVal,
        employerContributionPct: emprPctVal,
        notes: revNotes.trim() || undefined,
      }];
    }

    updatedRevisions.sort((a, b) => (a.effectiveDate > b.effectiveDate ? 1 : -1));

    onUpdateAccount({
      ...account,
      salaryRevisions: updatedRevisions,
    });

    setIsAddingRevision(false);
    setEditingRevId(null);
    setRevDate('');
    setRevBasic('');
    setRevDa('');
    setRevNotes('');
  };

  const handleDeleteRevision = (id: string) => {
    const updated = (account.salaryRevisions || []).filter(r => r.id !== id);
    onUpdateAccount({
      ...account,
      salaryRevisions: updated,
    });
  };

  const handleOpenEditRevision = (rev: EPFSalaryRevision) => {
    setEditingRevId(rev.id);
    setRevDate(rev.effectiveDate);
    setRevBasic(rev.basicSalary.toString());
    setRevDa((rev.dearnessAllowance || 0).toString());
    setRevEmpPct((rev.employeeContributionPct || 12).toString());
    setRevEmprPct((rev.employerContributionPct || 12).toString());
    setRevNotes(rev.notes || '');
    setIsAddingRevision(true);
  };

  const handleSaveCorrection = () => {
    const newErrors: Record<string, string> = {};
    if (!adjDate) newErrors.adjDate = 'Passbook Statement Date is required';
    if (!adjBalance) newErrors.adjBalance = 'Verified Balance is required';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      scrollToFirstError(correctionFormRef.current);
      return;
    }
    const balVal = parseFloat(adjBalance) || 0;

    const currentAdjs = account.epfBalanceAdjustments || [];
    const updatedAdjs: EPFBalanceAdjustment[] = [
      ...currentAdjs,
      {
        id: generateId(),
        date: adjDate,
        balance: balVal,
        notes: adjNotes.trim() || undefined,
      }
    ].sort((a, b) => (a.date > b.date ? 1 : -1));

    onUpdateAccount({
      ...account,
      epfBalanceAdjustments: updatedAdjs,
    });

    setIsAddingAdj(false);
    setAdjDate('');
    setAdjBalance('');
    setAdjNotes('');
  };

  const handleDeleteCorrection = (id: string) => {
    const updated = (account.epfBalanceAdjustments || []).filter(a => a.id !== id);
    onUpdateAccount({
      ...account,
      epfBalanceAdjustments: updated,
    });
  };

  const handleSaveRates = (updatedRates: EPFInterestRateConfig[]) => {
    setOverrides(updatedRates);
    onUpdateAccount({
      ...account,
      interestRateOverrides: updatedRates,
    });
  };

  return (
    <SubviewWrapper
      title={
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>{account.name}</h2>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>EPF Auto-Projection Ledger{account.currentEmployer ? ` • ${account.currentEmployer}` : ''}</p>
        </div>
      }
      onBack={onClose}
    >

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color, #2a2e39)', paddingBottom: '0.5rem' }}>
          {[
            { id: 'overview', label: 'Overview & Projection' },
            { id: 'revisions', label: `Salary History (${(account.salaryRevisions || []).length})` },
            { id: 'corrections', label: `Corrections (${(account.epfBalanceAdjustments || []).length})` },
            { id: 'rates', label: 'Interest Rates' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                background: activeTab === tab.id ? 'var(--accent, #6366f1)' : 'transparent',
                color: activeTab === tab.id ? '#fff' : 'var(--text-secondary, #8a8f9d)',
                border: 'none', borderRadius: '8px', padding: '0.4rem 0.8rem', fontSize: '0.85rem',
                fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB 1: OVERVIEW & PROJECTION */}
        {activeTab === 'overview' && (
          <div className="flex-col gap-6">
            {/* Balance Highlights Card */}
            <div className="card flex-col gap-4" style={{ padding: '1.25rem' }}>
              <div className="flex justify-between align-start">
                <div className="flex-col gap-1">
                  <span className="text-mono text-muted text-xs">ESTIMATED EPF BALANCE</span>
                  <span className="text-serif" style={{ fontSize: '2rem', color: 'var(--success)', lineHeight: '1.1' }}>
                    {formatCurrency(projection.balance)}
                  </span>
                  <span className="text-muted text-xs" style={{ marginTop: '2px' }}>As of current month</span>
                </div>
              </div>

              <div style={{ height: '1px', background: 'var(--border-color)', opacity: 0.5 }} />

              <div className="flex justify-between align-end">
                <div className="flex-col gap-1">
                  <span className="text-mono text-muted text-xs">EST. BALANCE (DEC {new Date().getFullYear()} / EOY)</span>
                  <span className="text-serif" style={{ fontSize: '1.35rem', color: 'var(--text-primary)', marginTop: '2px' }}>
                    {formatCurrency(projection.projectedDecBalance)}
                  </span>
                </div>
              </div>

              <div style={{ height: '1px', background: 'var(--border-color)', opacity: 0.3 }} />

              <div className="flex justify-between align-end">
                <div className="flex-col gap-1">
                  <span className="text-mono text-muted text-xs">EST. BALANCE (IN 1 YEAR)</span>
                  <span className="text-serif" style={{ fontSize: '1.5rem', color: 'var(--accent)', marginTop: '2px' }}>
                    {formatCurrency(projection.projectedOneYearBalance)}
                  </span>
                </div>
                <span className="text-mono text-xs" style={{ color: 'var(--success)', fontWeight: 700 }}>
                  + {formatCurrency(projection.projectedOneYearBalance - projection.balance)} growth
                </span>
              </div>
            </div>

            {/* Monthly Contribution Breakdown Card */}
            <div className="card flex-col gap-4" style={{ padding: '1.25rem' }}>
              <span className="text-mono text-muted text-xs">MONTHLY CONTRIBUTION BREAKDOWN</span>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="card flex-col gap-1" style={{ background: 'var(--bg-hover)', padding: '0.85rem', border: '1px solid var(--border-color)' }}>
                  <span className="text-muted text-xs">Employee (12%)</span>
                  <span className="text-serif" style={{ fontSize: '1.3rem', color: 'var(--text-primary)' }}>
                    {formatCurrency(projection.employeeContribution)}
                  </span>
                </div>

                <div className="card flex-col gap-1" style={{ background: 'var(--bg-hover)', padding: '0.85rem', border: '1px solid var(--border-color)' }}>
                  <span className="text-muted text-xs">Employer EPF</span>
                  <span className="text-serif" style={{ fontSize: '1.3rem', color: 'var(--text-primary)' }}>
                    {formatCurrency(projection.employerEPFContribution)}
                  </span>
                </div>

                <div className="card flex-col gap-1" style={{ background: 'var(--bg-hover)', padding: '0.85rem', border: '1px solid var(--border-color)' }}>
                  <span className="text-muted text-xs">Employer EPS</span>
                  <span className="text-serif" style={{ fontSize: '1.3rem', color: 'var(--warning)' }}>
                    {formatCurrency(projection.employerEPSContribution)}
                  </span>
                  <span className="text-muted" style={{ fontSize: '10px' }}>Capped pension</span>
                </div>

                <div className="card flex-col gap-1" style={{ background: 'rgba(99, 102, 241, 0.08)', padding: '0.85rem', border: '1px solid rgba(99, 102, 241, 0.25)' }}>
                  <span className="text-mono text-xs" style={{ color: 'var(--accent)', fontWeight: 700 }}>Total Monthly Credit</span>
                  <span className="text-serif" style={{ fontSize: '1.3rem', color: 'var(--accent)' }}>
                    {formatCurrency(projection.totalContribution)}
                  </span>
                </div>
              </div>
            </div>

            {/* Salary & Reference Card */}
            <div className="card flex-col gap-3" style={{ padding: '1.25rem' }}>
              <div className="flex justify-between align-center">
                <span className="text-mono text-muted text-xs">ACTIVE BASIC + DA</span>
                <span className="text-serif font-bold" style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}>
                  {formatCurrency(projection.effectiveSalary.basic + projection.effectiveSalary.da)} / mo
                </span>
              </div>
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', background: 'rgba(255,255,255,0.02)', padding: '0.6rem 0.8rem', borderRadius: '6px' }}>
              ℹ️ Projections are estimated based on your configured salary revisions, 12% contribution rules, and financial year interest rates. Accumulated interest is credited at FY-end (March).
            </div>
          </div>
        )}

        {/* TAB 2: SALARY REVISONS */}
        {activeTab === 'revisions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Historical & Future Salary Timeline</span>
              {!isAddingRevision && (
                <button
                  className="btn btn-primary"
                  onClick={() => { setEditingRevId(null); setIsAddingRevision(true); setRevDate(''); setRevBasic(''); setRevDa(''); setRevNotes(''); }}
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <Plus size={14} /> Add Revision
                </button>
              )}
            </div>

            {/* Add / Edit Revision Form */}
            {isAddingRevision && (
              <div ref={revisionFormRef} style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--accent)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--accent)' }}>{editingRevId ? 'Edit Salary Revision' : 'Add New Salary Revision'}</h4>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>Effective Date *</label>
                    <input
                      type="date"
                      value={revDate}
                      onChange={e => {
                        setRevDate(e.target.value);
                        if (errors.revDate) setErrors(prev => ({ ...prev, revDate: '' }));
                      }}
                      className={`input ${errors.revDate ? 'border-danger' : ''}`}
                      style={{ width: '100%', padding: '0.4rem' }}
                    />
                    {errors.revDate && <span className="text-xs text-danger" style={{ marginTop: '0.2rem', display: 'block' }}>{errors.revDate}</span>}
                  </div>

                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>Basic Salary (₹/mo) *</label>
                    <input
                      type="number"
                      placeholder="e.g. 50000"
                      value={revBasic}
                      onChange={e => {
                        setRevBasic(e.target.value);
                        if (errors.revBasic) setErrors(prev => ({ ...prev, revBasic: '' }));
                      }}
                      className={`input ${errors.revBasic ? 'border-danger' : ''}`}
                      style={{ width: '100%', padding: '0.4rem' }}
                    />
                    {errors.revBasic && <span className="text-xs text-danger" style={{ marginTop: '0.2rem', display: 'block' }}>{errors.revBasic}</span>}
                  </div>

                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>Dearness Allowance (DA ₹/mo)</label>
                    <input
                      type="number"
                      placeholder="Optional, default 0"
                      value={revDa}
                      onChange={e => setRevDa(e.target.value)}
                      className="input"
                      style={{ width: '100%', padding: '0.4rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>Note / Reason</label>
                    <input
                      type="text"
                      placeholder="e.g. Annual Increment, Promotion"
                      value={revNotes}
                      onChange={e => setRevNotes(e.target.value)}
                      className="input"
                      style={{ width: '100%', padding: '0.4rem' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button onClick={() => { setIsAddingRevision(false); setEditingRevId(null); }} className="btn" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>Cancel</button>
                  <button onClick={handleSaveRevision} className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>Save Revision</button>
                </div>
              </div>
            )}

            {/* Revision List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(!account.salaryRevisions || account.salaryRevisions.length === 0) ? (
                <div style={{ textTransform: 'uppercase', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center' }}>
                  No salary revisions added yet. Projections require at least one basic salary entry.
                </div>
              ) : (
                [...account.salaryRevisions].sort((a, b) => (b.effectiveDate > a.effectiveDate ? 1 : -1)).map(rev => (
                  <div key={rev.id} style={{
                    background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '8px',
                    border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{formatCurrency(rev.basicSalary + (rev.dearnessAllowance || 0))} / mo</span>
                        {rev.notes && <span style={{ fontSize: '0.7rem', background: 'rgba(99,102,241,0.15)', color: 'var(--accent)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{rev.notes}</span>}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                        Effective: {rev.effectiveDate} | Basic: {formatCurrency(rev.basicSalary)} {rev.dearnessAllowance ? `| DA: ${formatCurrency(rev.dearnessAllowance)}` : ''}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button onClick={() => handleOpenEditRevision(rev)} className="btn-icon" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <Edit2 size={15} />
                      </button>
                      <button onClick={() => handleDeleteRevision(rev.id)} className="btn-icon" style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: BALANCE CORRECTIONS */}
        {activeTab === 'corrections' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Manual Passbook Balance Corrections</span>
              {!isAddingAdj && (
                <button
                  className="btn btn-primary"
                  onClick={() => setIsAddingAdj(true)}
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <Plus size={14} /> Add Correction
                </button>
              )}
            </div>

            {isAddingAdj && (
              <div ref={correctionFormRef} style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--accent)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--accent)' }}>Record Passbook Balance Correction</h4>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>Passbook Statement Date *</label>
                    <input
                      type="date"
                      value={adjDate}
                      onChange={e => {
                        setAdjDate(e.target.value);
                        if (errors.adjDate) setErrors(prev => ({ ...prev, adjDate: '' }));
                      }}
                      className={`input ${errors.adjDate ? 'border-danger' : ''}`}
                      style={{ width: '100%', padding: '0.4rem' }}
                    />
                    {errors.adjDate && <span className="text-xs text-danger" style={{ marginTop: '0.2rem', display: 'block' }}>{errors.adjDate}</span>}
                  </div>

                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>Verified Balance (₹) *</label>
                    <input
                      type="number"
                      placeholder="e.g. 520000"
                      value={adjBalance}
                      onChange={e => {
                        setAdjBalance(e.target.value);
                        if (errors.adjBalance) setErrors(prev => ({ ...prev, adjBalance: '' }));
                      }}
                      className={`input ${errors.adjBalance ? 'border-danger' : ''}`}
                      style={{ width: '100%', padding: '0.4rem' }}
                    />
                    {errors.adjBalance && <span className="text-xs text-danger" style={{ marginTop: '0.2rem', display: 'block' }}>{errors.adjBalance}</span>}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>Notes</label>
                  <input
                    type="text"
                    placeholder="e.g. Verified from EPFO Member Portal"
                    value={adjNotes}
                    onChange={e => setAdjNotes(e.target.value)}
                    className="input"
                    style={{ width: '100%', padding: '0.4rem' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button onClick={() => setIsAddingAdj(false)} className="btn" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>Cancel</button>
                  <button onClick={handleSaveCorrection} className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>Save Correction</button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(!account.epfBalanceAdjustments || account.epfBalanceAdjustments.length === 0) ? (
                <div style={{ textTransform: 'uppercase', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center' }}>
                  No manual corrections recorded. Projections continue from base balance date.
                </div>
              ) : (
                [...account.epfBalanceAdjustments].sort((a, b) => (b.date > a.date ? 1 : -1)).map(adj => (
                  <div key={adj.id} style={{
                    background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '8px',
                    border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{formatCurrency(adj.balance)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Date: {adj.date} {adj.notes ? `| ${adj.notes}` : ''}
                      </div>
                    </div>
                    <button onClick={() => handleDeleteCorrection(adj.id)} className="btn-icon" style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: INTEREST RATES */}
        {activeTab === 'rates' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Financial Year Interest Rate Table (% per annum)</span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {overrides.map((cfg, idx) => (
                <div key={cfg.financialYear} style={{
                  background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '8px',
                  border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{cfg.financialYear}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="number"
                      step="0.05"
                      value={cfg.annualRate}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        const next = [...overrides];
                        next[idx] = { ...next[idx], annualRate: val };
                        handleSaveRates(next);
                      }}
                      className="input"
                      style={{ width: '80px', padding: '0.25rem 0.5rem', textAlign: 'right', fontWeight: 700 }}
                    />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

    </SubviewWrapper>
  );
};
