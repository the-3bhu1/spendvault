export interface CashFlow {
  date: Date;
  amount: number;
}

/**
 * Computes the annualized internal rate of return for a series of dated cashflows.
 * Uses bisection, which is guaranteed to converge for a standard investment profile
 * (negative outflows followed by a positive terminal value) where NPV(rate) is
 * monotonically decreasing and has exactly one root. Returns the rate as a decimal
 * (e.g. 0.1185 = 11.85%) or null if it can't be solved.
 */
export function xirr(cashflows: CashFlow[]): number | null {
  if (cashflows.length < 2) return null;

  const sorted = [...cashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const firstDate = sorted[0].date.getTime();

  const normalized = sorted.map(cf => ({
    years: (cf.date.getTime() - firstDate) / (1000 * 60 * 60 * 24 * 365),
    amount: cf.amount
  }));

  // Need at least one positive and one negative flow for a root to exist
  const hasPositive = normalized.some(cf => cf.amount > 0);
  const hasNegative = normalized.some(cf => cf.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const npv = (rate: number): number =>
    normalized.reduce((sum, cf) => sum + cf.amount / Math.pow(1 + rate, cf.years), 0);

  let lo = -0.9999;
  let hi = 100;
  let fLo = npv(lo);
  let fHi = npv(hi);

  // No sign change in bracket → no solvable root in range
  if (isNaN(fLo) || isNaN(fHi) || fLo * fHi > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);

    if (!isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-7 || (hi - lo) < 1e-9) {
      return mid;
    }

    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  return (lo + hi) / 2;
}
