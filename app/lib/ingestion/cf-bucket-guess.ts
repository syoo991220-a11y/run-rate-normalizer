import type { CashFlowReviewRow } from "../../types/studio-finance";

/** Visual SCF sections for Stage 2 grouping (10-K style). */
export type CfActivityBucket =
  | "Operating"
  | "Investing"
  | "Financing"
  | "Supplemental";

const ORDER: CfActivityBucket[] = [
  "Operating",
  "Investing",
  "Financing",
  "Supplemental",
];

export function cfBucketDisplayOrder(): readonly CfActivityBucket[] {
  return ORDER;
}

/**
 * Maps the assigned review category to a table section header.
 */
export function cfReviewBucketForRow(row: CashFlowReviewRow): CfActivityBucket {
  const c = row.category;
  if (c === "Beginning Cash Balance" || c === "Ending Cash Balance") {
    return "Supplemental";
  }
  if (c.startsWith("Operating")) return "Operating";
  if (c.startsWith("Investing")) return "Investing";
  if (c.startsWith("Financing")) return "Financing";
  if (/supplemental|non-?operating/i.test(c)) return "Supplemental";
  return guessCfStatementBucket(row.lineItem);
}

/**
 * Fallback when `category` is missing or non-standard — uses line-item text only.
 */
export function guessCfStatementBucket(lineItem: string): CfActivityBucket {
  const t = lineItem.toLowerCase();

  if (/supplemental|non-?operating|non-?cash.*(invest|financ)/i.test(t)) {
    return "Supplemental";
  }

  if (
    /\b(capex|capital expend|capital expenditure|fixed assets|purchase of ppe|sale of ppe|proceeds from sale of assets?|disposal of|acquisition)\b/i.test(
      t,
    ) ||
    /\binvesting activities\b/i.test(t)
  ) {
    return "Investing";
  }

  if (
    /\b(dividends?\s*paid|proceeds from debt|repayment of debt|debt issuance|borrowings|stock repurchase|financing activities|principal payment on debt)\b/i.test(
      t,
    ) ||
    /\bfinancing\b/i.test(t)
  ) {
    return "Financing";
  }

  return "Operating";
}
