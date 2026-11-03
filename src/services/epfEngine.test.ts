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
    expect(p.balance).toBe(66838 + 3917);
    expect(p.pensionBalance).toBe(0);
  });

  it('keeps the pension share out of interest and grows it with the balance', () => {
    const withPension = calculateEPFProjection(epf({ basePensionBalance: 22820 }), '2026-10');
    const epfOnly = calculateEPFProjection(epf({ baseBalance: 66838 - 22820 }), '2026-10');
    expect(withPension.balance).toBe(66838 + 6000);
    expect(withPension.pensionBalance).toBe(22820 + 2083);
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
    expect(withPension.projectedOneYearBalance - epfOnly.projectedOneYearBalance).toBe(22820 + 13 * 2083);
  });

  it('works from the PF deduction on a payslip', () => {
    const p = calculateEPFProjection(epf({
      epfContributionBasis: 'payslip',
      salaryRevisions: [{ id: 'r1', effectiveDate: '2026-07-01', basicSalary: 0, employeeContribution: 2360 }],
    }), '2026-10');
    expect(p.employeeContribution).toBe(2360);
    expect(p.employerEPSContribution).toBe(1638);
    expect(p.employerEPFContribution).toBe(722);
    expect(p.effectiveSalary.basic).toBe(19667);
    expect(p.balance).toBe(66838 + 2360 + 722);
  });

  it('matches the ceiling rule when the payslip follows the ₹25,000 change', () => {
    const payslip = calculateEPFProjection(epf({
      epfContributionBasis: 'payslip',
      basePensionBalance: 22820,
      salaryRevisions: [
        { id: 'r1', effectiveDate: '2026-07-01', basicSalary: 0, employeeContribution: 1800 },
        { id: 'r2', effectiveDate: '2026-09-01', basicSalary: 0, employeeContribution: 2360 },
        { id: 'r3', effectiveDate: '2026-10-01', basicSalary: 0, employeeContribution: 3000 },
      ],
    }), '2027-03');
    const ceiling = calculateEPFProjection(epf({ basePensionBalance: 22820 }), '2027-03');
    expect(payslip.balance).toBe(ceiling.balance);
    expect(payslip.accruedInterest).toBe(ceiling.accruedInterest);
    expect(payslip.projectedOneYearBalance).toBe(ceiling.projectedOneYearBalance);
  });

  it('caps at ₹15,000 before 17 September 2026', () => {
    const p = calculateEPFProjection(epf({ baseBalanceDate: '2026-07-01' }), '2026-08');
    expect(p.employeeContribution).toBe(1800);
    expect(p.employerEPSContribution).toBe(1250);
    expect(p.employerEPFContribution).toBe(550);
  });

  it('caps at ₹25,000 from October 2026', () => {
    const p = calculateEPFProjection(epf({}), '2026-10');
    expect(p.employeeContribution).toBe(3000);
    expect(p.employerEPSContribution).toBe(2083);
    expect(p.employerEPFContribution).toBe(917);
  });

  it('blends the two ceilings by days in September 2026', () => {
    const p = calculateEPFProjection(epf({ baseBalanceDate: '2026-08-01' }), '2026-09');
    expect(p.employeeContribution).toBe(2360);
    expect(p.employerEPSContribution).toBe(1638);
    expect(p.employerEPFContribution).toBe(722);
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
