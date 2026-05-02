"use client";

import { useMemo } from "react";
import type { TrialBalanceLine } from "../types/studio-finance";

function mag(n: number | undefined): number {
  return Math.abs(Number.isFinite(n ?? NaN) ? (n as number) : 0);
}

export type FpaTotals = {
  revenueCy: number;
  revenuePy1: number;
  cogsCy: number;
  cogsPy1: number;
  sgaCy: number;
  sgaPy1: number;
  currentAssetsCy: number;
  currentAssetsPy1: number;
  currentLiabilitiesCy: number;
  currentLiabilitiesPy1: number;
  arCy: number;
  arPy1: number;
  /** Sum of |PY2| for AR lines; undefined when trial balance has no PY2 column. */
  arPy2: number | undefined;
  inventoryCy: number;
  inventoryPy1: number;
  inventoryPy2: number | undefined;
  apCy: number;
  apPy1: number;
  apPy2: number | undefined;
  /** True when any row carries a defined `py2Balance` (upload included PY2). */
  hasPy2Dataset: boolean;
};

function trialBalanceHasPy2(rows: TrialBalanceLine[]): boolean {
  return rows.some((r) => r.py2Balance !== undefined);
}

function sumBucket(
  rows: TrialBalanceLine[],
  pred: (r: TrialBalanceLine) => boolean,
): { cy: number; py1: number } {
  let cy = 0;
  let py1 = 0;
  for (const r of rows) {
    if (!pred(r)) continue;
    cy += mag(r.cyBalance);
    py1 += mag(r.py1Balance);
  }
  return { cy, py1 };
}

function sumBucketWithOptionalPy2(
  rows: TrialBalanceLine[],
  pred: (r: TrialBalanceLine) => boolean,
  includePy2: boolean,
): { cy: number; py1: number; py2: number | undefined } {
  const { cy, py1 } = sumBucket(rows, pred);
  if (!includePy2) {
    return { cy, py1, py2: undefined };
  }
  let py2 = 0;
  for (const r of rows) {
    if (!pred(r)) continue;
    py2 += mag(r.py2Balance);
  }
  return { cy, py1, py2 };
}

/**
 * Aggregates trial balance lines by Stage 2 COA tags (L1/L2/L3).
 * Uses absolute balances per line so credit-convention TB nets still yield positive magnitudes for ratios.
 * PY2 is captured only for AR, Inventory, and AP when the upload includes a PY2 column (`py2Balance` defined on any row).
 */
export function computeFpaTotalsFromTrialBalance(
  rows: TrialBalanceLine[],
): FpaTotals {
  const hasPy2Dataset = trialBalanceHasPy2(rows);

  const l1 = (r: TrialBalanceLine, v: string) =>
    (r.categoryL1 ?? "").trim() === v;
  const l2 = (r: TrialBalanceLine, v: string) =>
    (r.categoryL2 ?? "").trim() === v;
  const l3 = (r: TrialBalanceLine, v: string) =>
    (r.categoryL3 ?? "").trim() === v;

  const rev = sumBucket(rows, (r) => l1(r, "Revenue"));
  const cogs = sumBucket(rows, (r) => l1(r, "COGS"));
  const sga = sumBucket(rows, (r) => l1(r, "SG&A"));
  const ca = sumBucket(rows, (r) => l2(r, "Current Assets"));
  const cl = sumBucket(rows, (r) => l2(r, "Current Liabilities"));
  const ar = sumBucketWithOptionalPy2(
    rows,
    (r) => l3(r, "Accounts Receivable"),
    hasPy2Dataset,
  );
  const inv = sumBucketWithOptionalPy2(
    rows,
    (r) => l3(r, "Inventory"),
    hasPy2Dataset,
  );
  const ap = sumBucketWithOptionalPy2(
    rows,
    (r) => l3(r, "Accounts Payable"),
    hasPy2Dataset,
  );

  return {
    revenueCy: rev.cy,
    revenuePy1: rev.py1,
    cogsCy: cogs.cy,
    cogsPy1: cogs.py1,
    sgaCy: sga.cy,
    sgaPy1: sga.py1,
    currentAssetsCy: ca.cy,
    currentAssetsPy1: ca.py1,
    currentLiabilitiesCy: cl.cy,
    currentLiabilitiesPy1: cl.py1,
    arCy: ar.cy,
    arPy1: ar.py1,
    arPy2: ar.py2,
    inventoryCy: inv.cy,
    inventoryPy1: inv.py1,
    inventoryPy2: inv.py2,
    apCy: ap.cy,
    apPy1: ap.py1,
    apPy2: ap.py2,
    hasPy2Dataset,
  };
}

export function useFpaData(trialBalanceData: TrialBalanceLine[]) {
  return useMemo(
    () => computeFpaTotalsFromTrialBalance(trialBalanceData),
    [trialBalanceData],
  );
}
