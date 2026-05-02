import type { CfStatementMethod } from "../../types/studio-finance";

/**
 * Scans mapped line-item text for presentation-method keywords (product / UX).
 * Direct phrases checked first; then indirect. Returns null if no keyword hit.
 */
export function detectCfKeywordPresentationMethod(
  lineItems: string[],
): CfStatementMethod | null {
  const corpus = lineItems.join("\n");
  const hasDirect =
    /cash receipts/i.test(corpus) ||
    /payments to suppliers/i.test(corpus) ||
    /payroll paid/i.test(corpus);
  const hasIndirect =
    /\bnet income\b/i.test(corpus) ||
    /depreciation/i.test(corpus) ||
    /changes in working capital/i.test(corpus);
  if (hasDirect) return "Direct";
  if (hasIndirect) return "Indirect";
  return null;
}

/**
 * Indirect method cash flows typically start from Net Income.
 * Direct method lines often reference receipts and supplier payments.
 */
export function detectCfStatementMethod(
  rows: { lineItem: string }[],
  scanFirst = 25,
): CfStatementMethod {
  const top = rows.slice(0, Math.min(scanFirst, rows.length));

  for (const r of top) {
    const t = r.lineItem.toLowerCase();
    if (
      /\breceipts\b/i.test(t) ||
      /\bpayments to suppliers\b/i.test(t) ||
      /\bcash payments to suppliers\b/i.test(t) ||
      /\bcash receipts\b/i.test(t)
    ) {
      return "Direct";
    }
  }

  for (const r of top) {
    if (/\bnet income\b/i.test(r.lineItem)) {
      return "Indirect";
    }
  }

  return "Indirect";
}
