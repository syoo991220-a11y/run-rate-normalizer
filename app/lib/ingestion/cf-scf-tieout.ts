import type { CashFlowReviewRow } from "../../types/studio-finance";

const TIE_TOLERANCE_CENTS = 100; // $1.00

export const CF_BEGINNING_CATEGORY = "Beginning Cash Balance" as const;
export const CF_ENDING_CATEGORY = "Ending Cash Balance" as const;

/** Operating + investing + financing lines included in net change and roll-forward. */
export const CF_STATEMENT_ACTIVITY_CATEGORIES = [
  "Operating — Net Income",
  "Operating — Non-Cash Adjustment",
  "Operating — Working Capital Change",
  "Investing Activities",
  "Financing Activities",
] as const;

export type CfScfTieOutResult = {
  ok: boolean;
  skipped: boolean;
  maxVarianceCents: number;
  maxVarianceDollars: number;
  hasBeginningTag: boolean;
  hasEndingTag: boolean;
  /** Signed (Beginning + OIF − Ending) in cents per year; non‑evaluated years omitted. */
  signedResidualCentsByYear: Partial<
    Record<"cy" | "py1" | "py2" | "py3", number>
  >;
};

function toCents(n: number) {
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

function rowYearCents(
  row: CashFlowReviewRow,
  year: "cy" | "py1" | "py2" | "py3",
): number {
  const v =
    year === "cy"
      ? row.cyBalance
      : year === "py1"
        ? row.py1Balance
        : year === "py2"
          ? (row.py2Balance ?? 0)
          : (row.py3Balance ?? 0);
  return toCents(v);
}

/** Lines excluded from the O+I+F activity subtotal (e.g. printed net change in cash). */
export function isExcludedFromScfActivitySum(lineItem: string): boolean {
  const t = lineItem.toLowerCase();
  if (/net\s*(increase|decrease|change)\s*(in|\/|\s)*\s*cash/i.test(t)) {
    return true;
  }
  return false;
}

function sumCategoryCents(
  rows: CashFlowReviewRow[],
  category: string,
  year: "cy" | "py1" | "py2" | "py3",
): number {
  let s = 0;
  for (const row of rows) {
    if (row.category !== category) continue;
    s += rowYearCents(row, year);
  }
  return s;
}

function sumActivityCents(
  rows: CashFlowReviewRow[],
  year: "cy" | "py1" | "py2" | "py3",
): number {
  let s = 0;
  for (const row of rows) {
    if (
      !(CF_STATEMENT_ACTIVITY_CATEGORIES as readonly string[]).includes(
        row.category,
      )
    ) {
      continue;
    }
    if (isExcludedFromScfActivitySum(row.lineItem)) continue;
    s += rowYearCents(row, year);
  }
  return s;
}

/**
 * Beginning + Σ(Operating, Investing, Financing activity) − Ending = 0 for each year.
 * Boundary amounts come from rows tagged {@link CF_BEGINNING_CATEGORY} / {@link CF_ENDING_CATEGORY}.
 */
export function evaluateCfScfTieOut(rows: CashFlowReviewRow[]): CfScfTieOutResult {
  const emptyResidual: CfScfTieOutResult["signedResidualCentsByYear"] = {};

  if (!rows.length) {
    return {
      ok: false,
      skipped: true,
      maxVarianceCents: Infinity,
      maxVarianceDollars: Infinity,
      hasBeginningTag: false,
      hasEndingTag: false,
      signedResidualCentsByYear: emptyResidual,
    };
  }

  const hasBeginningTag = rows.some(
    (r) => r.category === CF_BEGINNING_CATEGORY,
  );
  const hasEndingTag = rows.some((r) => r.category === CF_ENDING_CATEGORY);

  const years: ("cy" | "py1" | "py2" | "py3")[] = ["cy", "py1"];
  const hasPy2 = rows.some((r) => r.py2Balance !== undefined);
  const hasPy3 = rows.some((r) => r.py3Balance !== undefined);
  if (hasPy2) years.push("py2");
  if (hasPy3) years.push("py3");

  const signedResidualCentsByYear: CfScfTieOutResult["signedResidualCentsByYear"] =
    {};
  let maxVar = 0;

  for (const y of years) {
    const b = sumCategoryCents(rows, CF_BEGINNING_CATEGORY, y);
    const oif = sumActivityCents(rows, y);
    const e = sumCategoryCents(rows, CF_ENDING_CATEGORY, y);
    const residual = b + oif - e;
    signedResidualCentsByYear[y] = residual;
    const v = Math.abs(residual);
    if (v > maxVar) maxVar = v;
  }

  const boundaryOk = hasBeginningTag && hasEndingTag;
  const ok = boundaryOk && maxVar <= TIE_TOLERANCE_CENTS;

  return {
    ok,
    skipped: false,
    maxVarianceCents: maxVar,
    maxVarianceDollars: maxVar / 100,
    hasBeginningTag,
    hasEndingTag,
    signedResidualCentsByYear,
  };
}
