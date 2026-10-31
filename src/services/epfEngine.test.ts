import { describe, it, expect } from 'vitest';
import { calculateEPFProjection } from '../utils/epfEngine';
import { minifyPayload, expandPayload } from './backupCodec';
import type { Account } from '../types';

const epf = (over: Partial<Account>): Account => ({
  id: 'epf', name: 'EPF', type: 'epf', openingBalances: {},
  baseBalance: 66838, baseBalanceDate: '2026-09-01',
  epfContributionBasis: 'statutory_ceiling',
  salaryRevisions: [{ id: 'r1', effectiveDate: '2026-07-01', basicSalary: 33700 }],
  ...over,
});

describe('EPF projection', () => {
  it('earns interest on the whole balance when no pension share is entered', () => {
    const p = calculateEPFProjection(epf({}), '2026-10');
    expect(p.balance).toBe(66838 + 2350);
    expect(p.pensionBalance).toBe(0);
  });

  it('keeps the pension share out of interest and grows it with the balance', () => {
    const withPension = calculateEPFProjection(epf({ basePensionBalance: 22820 }), '2026-10');
    const epfOnly = calculateEPFProjection(epf({ baseBalance: 66838 - 22820 }), '2026-10');
    expect(withPension.balance).toBe(66838 + 3600);
    expect(withPension.pensionBalance).toBe(22820 + 1250);
    expect(withPension.accruedInterest).toBe(epfOnly.accruedInterest);
  });

  it('gives each account its own split rather than one fixed ratio', () => {
    const small = calculateEPFProjection(epf({ baseBalance: 100000, basePensionBalance: 10000 }), '2026-10');
    const large = calculateEPFProjection(epf({ baseBalance: 100000, basePensionBalance: 50000 }), '2026-10');
    expect(small.accruedInterest).toBeGreaterThan(large.accruedInterest);
  });

  it('does not invent a balance for an account that has none', () => {
    const p = calculateEPFProjection(epf({ baseBalance: undefined, baseBalanceDate: '2026-04-01' }), '2026-06');
    expect(p.balance).toBe(2 * 2350);
    expect(p.accruedInterest).toBeLessThan(100);
  });

  it('takes interest from a passbook correction, not the original balance', () => {
    const corrected = calculateEPFProjection(epf({
      baseBalance: 50000, baseBalanceDate: '2026-04-01',
      epfBalanceAdjustments: [{ id: 'a1', date: '2026-09-01', balance: 66838 }],
    }), '2026-10');
    const fresh = calculateEPFProjection(epf({}), '2026-10');
    expect(corrected.balance).toBe(fresh.balance);
    expect(corrected.accruedInterest).toBe(fresh.accruedInterest);
  });

  it('ignores the pension share when EPS is turned off', () => {
    const p = calculateEPFProjection(epf({ basePensionBalance: 22820, isEpsDisabled: true }), '2026-10');
    expect(p.pensionBalance).toBe(0);
    expect(p.employerEPSContribution).toBe(0);
  });

  it('projects interest on the EPF part only', () => {
    const withPension = calculateEPFProjection(epf({ basePensionBalance: 22820 }), '2026-10');
    const epfOnly = calculateEPFProjection(epf({ baseBalance: 66838 - 22820 }), '2026-10');
    expect(withPension.projectedOneYearBalance - epfOnly.projectedOneYearBalance).toBe(22820 + 13 * 1250);
  });

  it('works from the PF deduction on a payslip', () => {
    const p = calculateEPFProjection(epf({
      epfContributionBasis: 'payslip',
      salaryRevisions: [{ id: 'r1', effectiveDate: '2026-07-01', basicSalary: 0, employeeContribution: 2360 }],
    }), '2026-10');
    expect(p.employeeContribution).toBe(2360);
    expect(p.employerEPSContribution).toBe(1250);
    expect(p.employerEPFContribution).toBe(1110);
    expect(p.effectiveSalary.basic).toBe(19667);
    expect(p.balance).toBe(66838 + 2360 + 1110);
  });

  it('matches the ceiling rule when the payslip shows ₹1,800', () => {
    const payslip = calculateEPFProjection(epf({
      epfContributionBasis: 'payslip',
      basePensionBalance: 22820,
      salaryRevisions: [{ id: 'r1', effectiveDate: '2026-07-01', basicSalary: 0, employeeContribution: 1800 }],
    }), '2027-03');
    const ceiling = calculateEPFProjection(epf({ basePensionBalance: 22820 }), '2027-03');
    expect(payslip.balance).toBe(ceiling.balance);
    expect(payslip.accruedInterest).toBe(ceiling.accruedInterest);
    expect(payslip.projectedOneYearBalance).toBe(ceiling.projectedOneYearBalance);
  });

  it('keeps the pension share through a backup', () => {
    const payload = { accounts: [epf({
      basePensionBalance: 22820,
      epfContributionBasis: 'payslip',
      salaryRevisions: [{ id: 'r1', effectiveDate: '2026-07-01', basicSalary: 0, employeeContribution: 2360 }],
    })] };
    expect(expandPayload(minifyPayload(payload))).toEqual(payload);
  });
});
