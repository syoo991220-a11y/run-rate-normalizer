export const GAAP_AMBIGUOUS_SENTINEL = "Ambiguous - Pending AI" as const;

/** Resolved US GAAP-style trial balance sub-categories (granular COA buckets). */
export const TB_FINAL_GAAP_CATEGORIES = [
  "Current Assets",
  "Property, Plant & Equipment (PPE)",
  "Intangible Assets",
  "Other Non-Current Assets",
  "Current Liabilities",
  "Non-Current Liabilities",
  "Equity (Retained Earnings, Common Stock, etc.)",
  "Mezzanine Equity",
  "Revenue",
  "Cost of Goods Sold (COGS)",
  "Operating Expenses (OpEx)",
  "Other Income/Expense",
  "Interest Expense",
  "Income Tax Expense",
] as const;

export type TbFinalGaapCategory = (typeof TB_FINAL_GAAP_CATEGORIES)[number];

/** Optgroup layout for Stage 2 category dropdowns. */
export const TB_GAAP_OPTGROUPS: readonly {
  label: string;
  options: readonly TbFinalGaapCategory[];
}[] = [
  {
    label: "Assets",
    options: [
      "Current Assets",
      "Property, Plant & Equipment (PPE)",
      "Intangible Assets",
      "Other Non-Current Assets",
    ],
  },
  {
    label: "Liabilities",
    options: ["Current Liabilities", "Non-Current Liabilities"],
  },
  {
    label: "Equity",
    options: [
      "Equity (Retained Earnings, Common Stock, etc.)",
      "Mezzanine Equity",
    ],
  },
  {
    label: "Income statement",
    options: [
      "Revenue",
      "Cost of Goods Sold (COGS)",
      "Operating Expenses (OpEx)",
      "Other Income/Expense",
      "Interest Expense",
      "Income Tax Expense",
    ],
  },
] as const;

export type GaapCategory =
  | TbFinalGaapCategory
  | typeof GAAP_AMBIGUOUS_SENTINEL;

export type TrialBalanceLine = {
  id: string;
  account: string;
  /** Current year (CY) net balance. */
  cyBalance: number;
  /** Prior year 1 (PY1) net balance. */
  py1Balance: number;
  /** Prior year 2 (PY2) net balance when mapped at ingest. */
  py2Balance?: number;
  /** Prior year 3 (PY3) net balance when mapped at ingest. */
  py3Balance?: number;
  accountNumber?: string;
  accountName?: string;
  gaapCategory?: GaapCategory;
  /** Cascading chart-of-accounts (Stage 2); persisted with the Memory Bank line. */
  categoryL1?: string;
  categoryL2?: string;
  categoryL3?: string;
};

export type TrialBalanceReviewRow = {
  id: string;
  accountNumber: string;
  accountName: string;
  cyBalance: number;
  py1Balance: number;
  py2Balance?: number;
  py3Balance?: number;
  gaapCategory: GaapCategory;
  /** Level 1 COA bucket (e.g. Assets, Liabilities). */
  categoryL1: string;
  categoryL2: string;
  categoryL3: string;
};

/** Cash flow statement presentation method. */
export type CfStatementMethod = "Indirect" | "Direct";

/**
 * Stage 2 cash flow line categories (GAAP-style SCF buckets for review & tagging).
 * Used for both presentation methods in the Run-Rate Studio review UI.
 */
export const CF_REVIEW_CATEGORIES = [
  "Beginning Cash Balance",
  "Operating — Net Income",
  "Operating — Non-Cash Adjustment",
  "Operating — Working Capital Change",
  "Investing Activities",
  "Financing Activities",
  "Ending Cash Balance",
  "Supplemental / Non-Operating",
] as const;

export type CfReviewLineCategory = (typeof CF_REVIEW_CATEGORIES)[number];

export type CashFlowLine = {
  id: string;
  lineItem: string;
  category: string;
  cyBalance: number;
  py1Balance: number;
  py2Balance?: number;
  py3Balance?: number;
};

export type CashFlowReviewRow = {
  id: string;
  lineItem: string;
  cyBalance: number;
  py1Balance: number;
  py2Balance?: number;
  py3Balance?: number;
  category: string;
};
