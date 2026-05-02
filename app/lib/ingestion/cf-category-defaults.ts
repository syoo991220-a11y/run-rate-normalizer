import type {
  CfReviewLineCategory,
  CfStatementMethod,
} from "../../types/studio-finance";

const BEG = "Beginning Cash Balance" satisfies CfReviewLineCategory;
const END = "Ending Cash Balance" satisfies CfReviewLineCategory;
const NI = "Operating — Net Income" satisfies CfReviewLineCategory;
const NCA = "Operating — Non-Cash Adjustment" satisfies CfReviewLineCategory;
const WC = "Operating — Working Capital Change" satisfies CfReviewLineCategory;
const INV = "Investing Activities" satisfies CfReviewLineCategory;
const FIN = "Financing Activities" satisfies CfReviewLineCategory;
const SUP = "Supplemental / Non-Operating" satisfies CfReviewLineCategory;

function unifiedTag(lineItem: string, _method: CfStatementMethod): CfReviewLineCategory {
  const t = lineItem.toLowerCase();

  if (/net\s*(increase|decrease|change)\s*(in|\/|\s)*\s*cash/i.test(t)) {
    return SUP;
  }

  if (
    /cash at beginning|beginning of period|beg\.?\s*cash|opening cash|cash,\s*beginning|cash\s+beginning|beginning\s+cash|^cash\s*[-–]\s*beginning/i.test(
      t,
    )
  ) {
    return BEG;
  }

  if (
    /cash at end|ending cash|end of period|closing cash|cash,\s*ending|cash\s+ending|ending\s+cash|^cash\s*[-–]\s*end/i.test(
      t,
    )
  ) {
    return END;
  }

  if (/\bnet income\b|\bnet loss\b/i.test(t)) {
    return NI;
  }

  if (
    /depreciation|amortization|stock-?based|(\bsbc\b)|share-?based compensation/i.test(
      t,
    )
  ) {
    return NCA;
  }

  if (/receivable|payable|inventory/i.test(t)) {
    return WC;
  }

  if (/capital expenditure|fixed assets/i.test(t)) {
    return INV;
  }

  if (
    /\b(capex|capital expend|purchase of ppe|sale of ppe|acquisition|disposal|proceeds from sale of assets?)\b/i.test(
      t,
    )
  ) {
    return INV;
  }

  if (
    /\b(nwc|working capital|accrued|prepaid|changes in)\b/i.test(t) &&
    !/net income/i.test(t)
  ) {
    return WC;
  }

  if (
    /\b(debt|dividend|financ|lease principal|repurchase|borrow|issuance|equity)\b/i.test(
      t,
    )
  ) {
    return FIN;
  }

  if (
    /supplemental|non-?operating|non-?cash.*(invest|financ)|schedule.*non-?cash/i.test(
      t,
    )
  ) {
    return SUP;
  }

  if (
    _method === "Direct" &&
    (/receipt|collections|received from customers|payments to suppliers|payroll paid|cash paid|cash received/i.test(
      t,
    ))
  ) {
    return WC;
  }

  return NCA;
}

export function defaultCfCategoryForLine(
  lineItem: string,
  method: CfStatementMethod,
): CfReviewLineCategory {
  return unifiedTag(lineItem, method);
}
