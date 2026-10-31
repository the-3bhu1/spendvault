import type { Account, EPFInterestRateConfig, EPFProjectionResult, EPFSalaryRevision } from '../types';
import { parseISO, format, addMonths, isAfter } from 'date-fns';

export const DEFAULT_EPF_INTEREST_RATES: EPFInterestRateConfig[] = [
  { financialYear: 'FY 2022-23', annualRate: 8.15 },
  { financialYear: 'FY 2023-24', annualRate: 8.25 },
  { financialYear: 'FY 2024-25', annualRate: 8.25 },
  { financialYear: 'FY 2025-26', annualRate: 8.25 },
];

/**
 * Helper to determine Financial Year string (e.g. 'FY 2025-26') for a date string 'YYYY-MM-DD' or 'YYYY-MM'.
 * In India, FY runs from April 1 to March 31.
 */
export function getFinancialYearForDate(dateStr: string): string {
  const cleanDate = dateStr.length === 7 ? `${dateStr}-01` : dateStr;
  const d = parseISO(cleanDate);
  const month = d.getMonth() + 1; // 1-indexed
  const year = d.getFullYear();

  let startYear = year;
  if (month < 4) {
    startYear = year - 1;
  }
  const endYearShort = (startYear + 1).toString().slice(-2);
  return `FY ${startYear}-${endYearShort}`;
}

/**
 * Resolve applicable annual interest rate for a given Financial Year string
 */
export function getEPFInterestRate(fy: string, overrides?: EPFInterestRateConfig[]): number {
  if (overrides && overrides.length > 0) {
    const override = overrides.find(o => o.financialYear === fy);
    if (override) return override.annualRate;
  }
  const defaultRate = DEFAULT_EPF_INTEREST_RATES.find(d => d.financialYear === fy);
  if (defaultRate) return defaultRate.annualRate;
  return 8.25; // Default fallback
}

/**
 * Resolve active salary revision for a target date ('YYYY-MM-DD' or 'YYYY-MM')
 */
export function getEffectiveEPFSalary(
  revisions: EPFSalaryRevision[] = [],
  targetDateStr: string
): EPFSalaryRevision | null {
  if (!revisions || revisions.length === 0) return null;

  const targetDateKey = targetDateStr.length === 7 ? `${targetDateStr}-31` : targetDateStr;

  // Filter revisions effective on or before target date
  const validRevisions = revisions
    .filter(r => r.effectiveDate <= targetDateKey)
    .sort((a, b) => (a.effectiveDate > b.effectiveDate ? 1 : -1));

  if (validRevisions.length === 0) {
    // If target date is earlier than earliest revision, return earliest as fallback
    const sortedAll = [...revisions].sort((a, b) => (a.effectiveDate > b.effectiveDate ? 1 : -1));
    return sortedAll[0];
  }

  return validRevisions[validRevisions.length - 1];
}

export interface EPFMonthlySnapshot {
  monthKey: string; // 'YYYY-MM'
  financialYear: string;
  basicSalary: number;
  dearnessAllowance: number;
  employeeContribution: number;
  employerEPFContribution: number;
  employerEPSContribution: number;
  totalContribution: number;
  openingBalance: number;
  closingBalance: number;
  monthlyAccruedInterest: number;
  isFyEndCreditMonth: boolean;
  interestCreditedThisMonth: number;
  notes?: string;
}

/**
 * Core Projection Engine
 * Simulates monthly contributions & interest accrual from base balance date to target month.
 */
export function calculateEPFProjection(
  account: Account,
  targetMonthKey: string = format(new Date(), 'yyyy-MM'),
  globalInterestRates?: EPFInterestRateConfig[]
): EPFProjectionResult {
  let baseBalance = account.baseBalance ?? (account.openingBalances?.[Object.keys(account.openingBalances || {})[0]] || 0);

  // Determine current Financial Year start (April 1st of active FY)
  const targetDateObj = parseISO(`${targetMonthKey}-01`);
  const targetMonthNum = targetDateObj.getMonth() + 1;
  const targetYearNum = targetDateObj.getFullYear();
  const currentFyStartYear = targetMonthNum < 4 ? targetYearNum - 1 : targetYearNum;
  const activeFyStartStr = `${currentFyStartYear}-04-01`;

  const joiningDateStr = account.joiningDate || activeFyStartStr;
  const anchorDateStr = account.baseBalanceDate || `${targetMonthKey}-01`;
  let baseDateStr = anchorDateStr;

  // Check if there is a manual balance correction prior to or at targetMonthKey
  const adjustments = [...(account.epfBalanceAdjustments || [])].sort((a, b) => (a.date > b.date ? 1 : -1));
  const targetMonthEndKey = `${targetMonthKey}-31`;
  const applicableAdjustments = adjustments.filter(adj => adj.date <= targetMonthEndKey);

  if (applicableAdjustments.length > 0) {
    const latestAdj = applicableAdjustments[applicableAdjustments.length - 1];
    baseBalance = latestAdj.balance;
    baseDateStr = latestAdj.date;
  }

  const baseMonthKey = baseDateStr.slice(0, 7);
  const anchorMonthKey = anchorDateStr.slice(0, 7);

  let runningBalance = baseBalance;
  let accruedInterestInCurrentFY = 0;

  const revisions = account.salaryRevisions || [];
  const overrides = account.interestRateOverrides || globalInterestRates;
  const basis = account.epfContributionBasis || 'statutory_ceiling';
  const isStatutoryCap = basis === 'statutory_ceiling';
  const isPayslip = basis === 'payslip';

  let lastEmployeeContribution = 0;
  let lastEmployerEPFContribution = 0;
  let lastEmployerEPSContribution = 0;
  let lastTotalContribution = 0;
  let lastEffectiveSalary = { basic: 0, da: 0, effectiveDate: '' };
  let lastPayslipEmployee = 0;

  const contributionsFor = (revision: EPFSalaryRevision | null) => {
    const empPct = revision?.employeeContributionPct ?? 12;
    const emprPct = revision?.employerContributionPct ?? 12;
    let basic: number;
    let da: number;
    let wage: number;
    let epfEligibleWage: number;
    let employee: number;

    if (isPayslip) {
      employee = Math.round(revision ? (revision.employeeContribution || 0) : lastPayslipEmployee);
      wage = empPct > 0 ? employee / (empPct / 100) : 0;
      epfEligibleWage = wage;
      basic = Math.round(wage);
      da = 0;
    } else {
      basic = revision ? revision.basicSalary : lastEffectiveSalary.basic;
      da = revision ? (revision.dearnessAllowance || 0) : lastEffectiveSalary.da;
      wage = basic + da;
      const epfWageCeiling = 15000;
      epfEligibleWage = (isStatutoryCap && wage > epfWageCeiling) ? epfWageCeiling : wage;
      employee = Math.round(epfEligibleWage * (empPct / 100));
    }

    const employerTotal = Math.round(epfEligibleWage * (emprPct / 100));

    let eps = 0;
    if (!account.isEpsDisabled && wage > 0) {
      const epsWageCeiling = account.epsWageCeiling || 15000;
      eps = Math.min(1250, Math.round(Math.min(wage, epsWageCeiling) * (8.33 / 100)));
    }
    return { basic, da, employee, employerEpf: Math.max(0, employerTotal - eps), eps };
  };
  const contributionsForMonth = (monthKey: string) => contributionsFor(getEffectiveEPFSalary(revisions, monthKey));

  // Calculate current active month contribution metrics
  const activeMonthRevision = getEffectiveEPFSalary(revisions, targetMonthKey) || getEffectiveEPFSalary(revisions, joiningDateStr);
  if (activeMonthRevision) {
    const c = contributionsFor(activeMonthRevision);
    lastEffectiveSalary = { basic: c.basic, da: c.da, effectiveDate: activeMonthRevision.effectiveDate };
    lastPayslipEmployee = c.employee;
    lastEmployeeContribution = c.employee;
    lastEmployerEPSContribution = c.eps;
    lastEmployerEPFContribution = c.employerEpf;
    lastTotalContribution = c.employee + c.employerEpf;
  }

  const tracksPension = !account.isEpsDisabled && (account.basePensionBalance || 0) > 0;
  const epsBetween = (fromMonthKey: string, toMonthKey: string) => {
    let sum = 0;
    let iter = addMonths(parseISO(`${fromMonthKey}-01`), 1);
    const end = parseISO(`${toMonthKey}-01`);
    while (!isAfter(iter, end)) {
      sum += contributionsForMonth(format(iter, 'yyyy-MM')).eps;
      iter = addMonths(iter, 1);
    }
    return sum;
  };
  let pensionAtBase = 0;
  if (tracksPension) {
    const anchorPension = account.basePensionBalance || 0;
    pensionAtBase = baseMonthKey >= anchorMonthKey
      ? anchorPension + epsBetween(anchorMonthKey, baseMonthKey)
      : anchorPension - epsBetween(baseMonthKey, anchorMonthKey);
    pensionAtBase = Math.min(Math.max(0, pensionAtBase), Math.max(0, baseBalance));
  }
  let runningPension = pensionAtBase;

  // Monthly progression: if base date is in the past, add monthly contributions
  let currentMonthDate = parseISO(`${baseMonthKey}-01`);
  const targetMonthDate = parseISO(`${targetMonthKey}-01`);

  if (isAfter(targetMonthDate, currentMonthDate)) {
    currentMonthDate = addMonths(currentMonthDate, 1);
    while (!isAfter(currentMonthDate, targetMonthDate)) {
      const c = contributionsForMonth(format(currentMonthDate, 'yyyy-MM'));
      const pensionCredit = tracksPension ? c.eps : 0;
      runningBalance += c.employee + c.employerEpf + pensionCredit;
      runningPension += pensionCredit;
      currentMonthDate = addMonths(currentMonthDate, 1);
    }
  }

  // Accrue Current FY interest following official EPFO rules:
  // Interest accrues ONLY on the EPF Account (Employee Share + Employer EPF Share). EPS (Pension) does NOT earn interest.
  const baseEpfBalance = Math.max(0, baseBalance - pensionAtBase);

  let fyIterDate = parseISO(activeFyStartStr);
  let fyRunningEpfBalance = baseEpfBalance;

  // If base balance date is later than FY start, backtrack opening EPF balance to April 1st by deducting intermediate EPF credits
  if (baseDateStr > activeFyStartStr) {
    let backIter = parseISO(activeFyStartStr);
    let totalEpfDeductions = 0;
    while (format(backIter, 'yyyy-MM') < baseMonthKey) {
      const c = contributionsForMonth(format(backIter, 'yyyy-MM'));
      totalEpfDeductions += c.employee + c.employerEpf;
      backIter = addMonths(backIter, 1);
    }
    fyRunningEpfBalance = Math.max(0, baseEpfBalance - totalEpfDeductions);
  }

  while (!isAfter(fyIterDate, targetMonthDate)) {
    const monthKey = format(fyIterDate, 'yyyy-MM');
    const fy = getFinancialYearForDate(monthKey);
    const annualInterestRate = getEPFInterestRate(fy, overrides);

    // 1. Accrue monthly interest on opening EPF balance (Employee Share + Employer EPF Share)
    const monthlyAccruedInterest = (fyRunningEpfBalance * (annualInterestRate / 100)) / 12;
    accruedInterestInCurrentFY += monthlyAccruedInterest;

    // 2. Add monthly EPF credit for next month's opening EPF balance
    const c = contributionsForMonth(monthKey);
    fyRunningEpfBalance += c.employee + c.employerEpf;
    fyIterDate = addMonths(fyIterDate, 1);
  }

  const projectForward = (untilDate: Date, startAccruedInterest: number) => {
    let projected = runningBalance;
    let projectedPension = runningPension;
    let accrued = startAccruedInterest;
    let iter = addMonths(parseISO(`${targetMonthKey}-01`), 1);
    while (!isAfter(iter, untilDate)) {
      const monthKey = format(iter, 'yyyy-MM');
      const annualInterestRate = getEPFInterestRate(getFinancialYearForDate(monthKey), overrides);
      const c = contributionsForMonth(monthKey);
      const pensionCredit = tracksPension ? c.eps : 0;
      projected += c.employee + c.employerEpf + pensionCredit;
      projectedPension += pensionCredit;

      accrued += ((projected - projectedPension) * (annualInterestRate / 100)) / 12;

      if ((iter.getMonth() + 1) === 3) {
        projected += Math.round(accrued);
        accrued = 0;
      }
      iter = addMonths(iter, 1);
    }
    return projected;
  };

  // Calculate Projected Dec (EOY) Balance and 1-Year Projected Balance from targetMonthKey
  const decTargetDateObj = parseISO(`${targetDateObj.getFullYear()}-12-01`);
  const projectedDecBalance = isAfter(decTargetDateObj, targetDateObj)
    ? projectForward(decTargetDateObj, accruedInterestInCurrentFY)
    : runningBalance;
  const projectedOneYearBalance = projectForward(addMonths(targetDateObj, 12), accruedInterestInCurrentFY);

  return {
    balance: Math.round(runningBalance),
    pensionBalance: Math.round(runningPension),
    employeeContribution: lastEmployeeContribution,
    employerEPFContribution: lastEmployerEPFContribution,
    employerEPSContribution: lastEmployerEPSContribution,
    totalContribution: lastTotalContribution,
    accruedInterest: Math.round(accruedInterestInCurrentFY),
    projectedOneYearBalance: Math.round(projectedOneYearBalance),
    projectedDecBalance: Math.round(projectedDecBalance),
    effectiveSalary: lastEffectiveSalary,
  };
}
