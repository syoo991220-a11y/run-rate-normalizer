import type { TrialBalanceLine } from "../types/studio-finance";

function mag(n: number | undefined): number {
  return Math.abs(Number.isFinite(n ?? NaN) ? (n as number) : 0);
}

const REVENUE_L1 = new Set(["Revenue", "Other Income"]);
const EXPENSE_L1 = new Set(["COGS", "SG&A", "Other Expense", "Income Tax"]);

/**
 * Current-year net income from Stage 2 L1 buckets.
 * Uses per-line absolute CY balances so credit-normal revenue and debit-normal expenses
 * aggregate to economically sensible magnitudes (same convention as FP&A totals).
 */
export function computeNetIncomeCy(rows: TrialBalanceLine[]): number {
  let revenueSide = 0;
  let expenseSide = 0;
  for (const r of rows) {
    const l1 = (r.categoryL1 ?? "").trim();
    if (REVENUE_L1.has(l1)) revenueSide += mag(r.cyBalance);
    else if (EXPENSE_L1.has(l1)) expenseSide += mag(r.cyBalance);
  }
  return revenueSide - expenseSide;
}
