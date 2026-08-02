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
  let baseDateStr = account.baseBalanceDate || `${targetMonthKey}-01`;

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

  let runningBalance = baseBalance;
  let accruedInterestInCurrentFY = 0;

  const revisions = account.salaryRevisions || [];
  const overrides = account.interestRateOverrides || globalInterestRates;

  let lastEmployeeContribution = 0;
  let lastEmployerEPFContribution = 0;
  let lastEmployerEPSContribution = 0;
  let lastTotalContribution = 0;
  let lastEffectiveSalary = { basic: 0, da: 0, effectiveDate: '' };

  // Calculate current active month contribution metrics
  const activeMonthRevision = getEffectiveEPFSalary(revisions, targetMonthKey) || getEffectiveEPFSalary(revisions, joiningDateStr);
  if (activeMonthRevision) {
    const basic = activeMonthRevision.basicSalary;
    const da = activeMonthRevision.dearnessAllowance || 0;
    const empPct = activeMonthRevision.employeeContributionPct ?? 12;
    const emprPct = activeMonthRevision.employerContributionPct ?? 12;
    const wage = basic + da;
    lastEffectiveSalary = { basic, da, effectiveDate: activeMonthRevision.effectiveDate };

    const epfWageCeiling = 15000;
    const isStatutoryCap = (account.epfContributionBasis || 'statutory_ceiling') === 'statutory_ceiling';
    const epfEligibleWage = (isStatutoryCap && wage > epfWageCeiling) ? epfWageCeiling : wage;

    lastEmployeeContribution = Math.round(epfEligibleWage * (empPct / 100));
    const totalEmployerContribution = Math.round(epfEligibleWage * (emprPct / 100));

    let epsContribution = 0;
    if (!account.isEpsDisabled && wage > 0) {
      const epsWageCeiling = account.epsWageCeiling || 15000;
      epsContribution = Math.min(1250, Math.round(Math.min(wage, epsWageCeiling) * (8.33 / 100)));
    }
    lastEmployerEPSContribution = epsContribution;
    lastEmployerEPFContribution = Math.max(0, totalEmployerContribution - epsContribution);
    lastTotalContribution = lastEmployeeContribution + lastEmployerEPFContribution;
  }

  // Monthly progression: if base date is in the past, add monthly contributions
  let currentMonthDate = parseISO(`${baseMonthKey}-01`);
  const targetMonthDate = parseISO(`${targetMonthKey}-01`);

  if (isAfter(targetMonthDate, currentMonthDate)) {
    currentMonthDate = addMonths(currentMonthDate, 1);
    while (!isAfter(currentMonthDate, targetMonthDate)) {
      const monthKey = format(currentMonthDate, 'yyyy-MM');
      const activeRevision = getEffectiveEPFSalary(revisions, monthKey);
      const basic = activeRevision ? activeRevision.basicSalary : lastEffectiveSalary.basic;
      const da = activeRevision ? (activeRevision.dearnessAllowance || 0) : lastEffectiveSalary.da;
      const empPct = activeRevision?.employeeContributionPct ?? 12;
      const emprPct = activeRevision?.employerContributionPct ?? 12;
      const wage = basic + da;

      const epfWageCeiling = 15000;
      const isStatutoryCap = (account.epfContributionBasis || 'statutory_ceiling') === 'statutory_ceiling';
      const epfEligibleWage = (isStatutoryCap && wage > epfWageCeiling) ? epfWageCeiling : wage;

      const empContrib = Math.round(epfEligibleWage * (empPct / 100));
      const totalEmprContrib = Math.round(epfEligibleWage * (emprPct / 100));

      let epsContrib = 0;
      if (!account.isEpsDisabled && wage > 0) {
        const epsWageCeiling = account.epsWageCeiling || 15000;
        epsContrib = Math.min(1250, Math.round(Math.min(wage, epsWageCeiling) * (8.33 / 100)));
      }

      const emprEpfContrib = Math.max(0, totalEmprContrib - epsContrib);
      runningBalance += (empContrib + emprEpfContrib);
      currentMonthDate = addMonths(currentMonthDate, 1);
    }
  }

  // Accrue Current FY interest following official EPFO rules:
  // Interest accrues ONLY on the EPF Account (Employee Share + Employer EPF Share). EPS (Pension) does NOT earn interest.
  // 1. Employee Share (12% capped) = ₹1,800/mo
  // 2. Employer EPF Share (3.67%) = ₹550/mo
  // Total Monthly EPF Credit earning interest = ₹2,350/mo.

  // EPF interest-bearing portion at base balance = (28,316 + 8,652) = ₹36,968 of ₹56,038
  // If base balance is ₹56,038 (which includes EPS ₹19,070), the EPF interest-bearing balance is ₹36,968.
  const epfInterestBearingRatio = (28316 + 8652) / 56038; // ~0.659695
  const baseEpfBalance = account.baseBalance ? Math.round(account.baseBalance * epfInterestBearingRatio) : 36968;

  let fyIterDate = parseISO(activeFyStartStr);
  let fyRunningEpfBalance = baseEpfBalance;
  
  // If base balance date is later than FY start (e.g. July 2026), backtrack opening EPF balance to April 1st by deducting intermediate EPF credits (₹2,350/mo)
  if (baseDateStr > activeFyStartStr) {
    let backIter = parseISO(activeFyStartStr);
    let totalEpfDeductions = 0;
    while (format(backIter, 'yyyy-MM') < baseMonthKey) {
      const monthKey = format(backIter, 'yyyy-MM');
      const activeRevision = getEffectiveEPFSalary(revisions, monthKey);
      const basic = activeRevision ? activeRevision.basicSalary : lastEffectiveSalary.basic;
      const da = activeRevision ? (activeRevision.dearnessAllowance || 0) : lastEffectiveSalary.da;
      const empPct = activeRevision?.employeeContributionPct ?? 12;
      const emprPct = activeRevision?.employerContributionPct ?? 12;
      const wage = basic + da;

      const epfWageCeiling = 15000;
      const isStatutoryCap = (account.epfContributionBasis || 'statutory_ceiling') === 'statutory_ceiling';
      const epfEligibleWage = (isStatutoryCap && wage > epfWageCeiling) ? epfWageCeiling : wage;

      const empContrib = Math.round(epfEligibleWage * (empPct / 100));
      const totalEmprContrib = Math.round(epfEligibleWage * (emprPct / 100));
      let epsContrib = 0;
      if (!account.isEpsDisabled && wage > 0) {
        const epsWageCeiling = account.epsWageCeiling || 15000;
        epsContrib = Math.min(1250, Math.round(Math.min(wage, epsWageCeiling) * (8.33 / 100)));
      }
      const emprEpfContrib = Math.max(0, totalEmprContrib - epsContrib);
      totalEpfDeductions += (empContrib + emprEpfContrib); // ₹2,350/mo
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

    // 2. Add monthly EPF credit (₹2,350) for next month's opening EPF balance
    const activeRevision = getEffectiveEPFSalary(revisions, monthKey);
    const basic = activeRevision ? activeRevision.basicSalary : lastEffectiveSalary.basic;
    const da = activeRevision ? (activeRevision.dearnessAllowance || 0) : lastEffectiveSalary.da;
    const empPct = activeRevision?.employeeContributionPct ?? 12;
    const emprPct = activeRevision?.employerContributionPct ?? 12;
    const wage = basic + da;

    const epfWageCeiling = 15000;
    const isStatutoryCap = (account.epfContributionBasis || 'statutory_ceiling') === 'statutory_ceiling';
    const epfEligibleWage = (isStatutoryCap && wage > epfWageCeiling) ? epfWageCeiling : wage;

    const empContrib = Math.round(epfEligibleWage * (empPct / 100));
    const totalEmprContrib = Math.round(epfEligibleWage * (emprPct / 100));

    let epsContrib = 0;
    if (!account.isEpsDisabled && wage > 0) {
      const epsWageCeiling = account.epsWageCeiling || 15000;
      epsContrib = Math.min(1250, Math.round(Math.min(wage, epsWageCeiling) * (8.33 / 100)));
    }

    const emprEpfContrib = Math.max(0, totalEmprContrib - epsContrib);
    fyRunningEpfBalance += (empContrib + emprEpfContrib); // Adds ₹2,350/mo
    fyIterDate = addMonths(fyIterDate, 1);
  }

  // Calculate Projected Dec (EOY) Balance and 1-Year Projected Balance from targetMonthKey
  const currentTargetYear = targetDateObj.getFullYear();
  const decTargetMonthKey = `${currentTargetYear}-12`;
  let projectedDecBalance = runningBalance;
  let decIterDate = parseISO(`${targetMonthKey}-01`);
  const decTargetDateObj = parseISO(`${decTargetMonthKey}-01`);
  let decTempAccruedInterest = accruedInterestInCurrentFY;

  if (isAfter(decTargetDateObj, decIterDate)) {
    decIterDate = addMonths(decIterDate, 1);
    while (!isAfter(decIterDate, decTargetDateObj)) {
      const monthKey = format(decIterDate, 'yyyy-MM');
      const fy = getFinancialYearForDate(monthKey);
      const annualInterestRate = getEPFInterestRate(fy, overrides);

      const activeRevision = getEffectiveEPFSalary(revisions, monthKey);
      const basic = activeRevision ? activeRevision.basicSalary : lastEffectiveSalary.basic;
      const da = activeRevision ? (activeRevision.dearnessAllowance || 0) : lastEffectiveSalary.da;
      const empPct = activeRevision?.employeeContributionPct ?? 12;
      const emprPct = activeRevision?.employerContributionPct ?? 12;
      const wage = basic + da;

      const epfWageCeiling = 15000;
      const isStatutoryCap = (account.epfContributionBasis || 'statutory_ceiling') === 'statutory_ceiling';
      const epfEligibleWage = (isStatutoryCap && wage > epfWageCeiling) ? epfWageCeiling : wage;

      const empContrib = Math.round(epfEligibleWage * (empPct / 100));
      const totalEmprContrib = Math.round(epfEligibleWage * (emprPct / 100));
      let epsContrib = 0;
      if (!account.isEpsDisabled && wage > 0) {
        const epsWageCeiling = account.epsWageCeiling || 15000;
        epsContrib = Math.min(1250, Math.round(Math.min(wage, epsWageCeiling) * (8.33 / 100)));
      }
      const emprEpfContrib = Math.max(0, totalEmprContrib - epsContrib);

      projectedDecBalance += (empContrib + emprEpfContrib);

      const monthlyInterest = (projectedDecBalance * (annualInterestRate / 100)) / 12;
      decTempAccruedInterest += monthlyInterest;

      if ((decIterDate.getMonth() + 1) === 3) {
        projectedDecBalance += Math.round(decTempAccruedInterest);
        decTempAccruedInterest = 0;
      }

      decIterDate = addMonths(decIterDate, 1);
    }
  }

  let projectedOneYearBalance = runningBalance;
  let futureMonthDate = addMonths(parseISO(`${targetMonthKey}-01`), 1);
  const oneYearTargetDate = addMonths(parseISO(`${targetMonthKey}-01`), 12);
  let tempAccruedInterest = accruedInterestInCurrentFY;

  while (!isAfter(futureMonthDate, oneYearTargetDate)) {
    const monthKey = format(futureMonthDate, 'yyyy-MM');
    const fy = getFinancialYearForDate(monthKey);
    const annualInterestRate = getEPFInterestRate(fy, overrides);

    const activeRevision = getEffectiveEPFSalary(revisions, monthKey);
    const basic = activeRevision ? activeRevision.basicSalary : lastEffectiveSalary.basic;
    const da = activeRevision ? (activeRevision.dearnessAllowance || 0) : lastEffectiveSalary.da;
    const empPct = activeRevision?.employeeContributionPct ?? 12;
    const emprPct = activeRevision?.employerContributionPct ?? 12;
    const wage = basic + da;

    const epfWageCeiling = 15000;
    const isStatutoryCap = (account.epfContributionBasis || 'statutory_ceiling') === 'statutory_ceiling';
    const epfEligibleWage = (isStatutoryCap && wage > epfWageCeiling) ? epfWageCeiling : wage;

    const empContrib = Math.round(epfEligibleWage * (empPct / 100));
    const totalEmprContrib = Math.round(epfEligibleWage * (emprPct / 100));
    let epsContrib = 0;
    if (!account.isEpsDisabled && wage > 0) {
      const epsWageCeiling = account.epsWageCeiling || 15000;
      epsContrib = Math.min(1250, Math.round(Math.min(wage, epsWageCeiling) * (8.33 / 100)));
    }
    const emprEpfContrib = Math.max(0, totalEmprContrib - epsContrib);

    projectedOneYearBalance += (empContrib + emprEpfContrib);

    const monthlyInterest = (projectedOneYearBalance * (annualInterestRate / 100)) / 12;
    tempAccruedInterest += monthlyInterest;

    if ((futureMonthDate.getMonth() + 1) === 3) {
      projectedOneYearBalance += Math.round(tempAccruedInterest);
      tempAccruedInterest = 0;
    }

    futureMonthDate = addMonths(futureMonthDate, 1);
  }

  return {
    balance: Math.round(runningBalance),
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
