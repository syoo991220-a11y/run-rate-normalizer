import type { CashFlowReviewRow } from "../../types/studio-finance";
import type { TrialBalanceReviewRow } from "../../types/studio-finance";

const TIE_OUT_TOLERANCE_CENTS = 100; // $1.00

function toCents(n: number) {
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

/** Matches common "Net increase (decrease) in cash" reconciliation lines. */
const NET_CASH_LINE_RE =
  /net\s*(increase|decrease|change)?\s*(in|\/|to)?\s*cash(\s|and|\s*e|$)/i;

export function findCfNetIncreaseInCashCyCents(
  rows: CashFlowReviewRow[],
): number | null {
  for (const r of rows) {
    if (NET_CASH_LINE_RE.test(r.lineItem)) {
      return toCents(r.cyBalance);
    }
  }
  return null;
}

function isLikelyCashGlRow(r: TrialBalanceReviewRow): boolean {
  const name = r.accountName.toLowerCase();
  const num = (r.accountNumber ?? "").trim().toLowerCase();
  if (/restricted\s*cash/.test(name)) return false;
  if (/\bcash(\s+and\s+cash\s+equivalents?|\s+equiv|\b)/i.test(name)) {
    return true;
  }
  if (/\bbank\b|\bpetty cash\b|\bchecking\b|\bmoney market\b/i.test(name)) {
    return true;
  }
  if (/^10[0-4]\d{0,4}$/.test(num) && /cash|bank|mmf/i.test(name)) {
    return true;
  }
  return false;
}

/** Sum of (CY − PY1) across rows that look like cash and equivalents on the TB. */
export function sumTbCashCyMinusPy1Cents(rows: TrialBalanceReviewRow[]): {
  cents: number;
  matched: boolean;
} {
  const cashRows = rows.filter(isLikelyCashGlRow);
  if (!cashRows.length) return { cents: 0, matched: false };
  const cents = cashRows.reduce(
    (s, r) => s + toCents(r.cyBalance) - toCents(r.py1Balance),
    0,
  );
  return { cents, matched: true };
}

export type CfCashTieOutResult = {
  /** When false, finalize should stay locked (only if both sides were identified). */
  ok: boolean;
  /** True when TB or CF missing, or we could not identify net-cash line / cash GL. */
  skipped: boolean;
  cfNetCashCents: number | null;
  tbCashDeltaCents: number | null;
  diffCents: number | null;
};

/**
 * When both datasets are present, compares the CF "net increase in cash" CY amount
 * to the net change in TB cash & equivalents (CY − PY1). Skips when either side
 * cannot be identified.
 */
export function evaluateCfCashTieOutToTrialBalance(
  tbRows: TrialBalanceReviewRow[],
  cfRows: CashFlowReviewRow[],
): CfCashTieOutResult {
  if (!tbRows.length || !cfRows.length) {
    return {
      ok: true,
      skipped: true,
      cfNetCashCents: null,
      tbCashDeltaCents: null,
      diffCents: null,
    };
  }

  const cfNet = findCfNetIncreaseInCashCyCents(cfRows);
  const { cents: tbDelta, matched: tbMatched } = sumTbCashCyMinusPy1Cents(tbRows);

  if (cfNet === null || !tbMatched) {
    return {
      ok: true,
      skipped: true,
      cfNetCashCents: cfNet,
      tbCashDeltaCents: tbMatched ? tbDelta : null,
      diffCents: null,
    };
  }

  const diff = cfNet - tbDelta;
  const ok = Math.abs(diff) <= TIE_OUT_TOLERANCE_CENTS;
  return {
    ok,
    skipped: false,
    cfNetCashCents: cfNet,
    tbCashDeltaCents: tbDelta,
    diffCents: diff,
  };
}
