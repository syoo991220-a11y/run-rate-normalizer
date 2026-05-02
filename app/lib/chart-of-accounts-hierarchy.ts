import {
  GAAP_AMBIGUOUS_SENTINEL,
  type GaapCategory,
  type TbFinalGaapCategory,
} from "../types/studio-finance";

/**
 * Nested COA: Level 1 → Level 2 → list of Level 3 account buckets (no L4).
 */
export type CoaHierarchy = Record<string, Record<string, readonly string[]>>;

/** Stage 2 — Assets → Current Assets (exact L3 set). */
export const CURRENT_ASSETS_L3 = [
  "Cash & Equivalents",
  "Restricted Cash",
  "Marketable Securities",
  "Accounts Receivable",
  "Inventory",
  "Prepaid expense",
  "ROU Assets",
  "Deferred Tax Assets",
  "Other Current Assets",
] as const;

/** Stage 2 — Assets → Non-Current Assets (exact L3 set). */
export const NON_CURRENT_ASSETS_L3 = [
  "Property, Plant, & Equipment",
  "Intangible Assets",
  "Right-of-Use Assets",
  "Investments",
  "Accounts Receivable",
  "Deferred Tax Assets",
  "Other Non-Current Assets",
] as const;

/** Stage 2 — Liabilities → Current Liabilities (exact L3 set). */
export const CURRENT_LIABILITIES_L3 = [
  "Accounts Payable",
  "Accrued Liabilities",
  "Deferred Revenue",
  "Short-Term Debt",
  "Contingent Liabilities",
  "ROU Liabilities",
  "Deferred Tax Liabilities",
  "Other Current Liabilities",
] as const;

/** Stage 2 — Liabilities → Non-Current Liabilities (exact L3 set). */
export const NON_CURRENT_LIABILITIES_L3 = [
  "Accounts Payable",
  "Long-Term Debt",
  "Accrued Liabilities",
  "Deferred Revenue",
  "Contingent Liabilities",
  "ROU Liabilities",
  "Deferred Tax Liabilities",
  "Other Non-Current Liabilities",
] as const;

export const CHART_OF_ACCOUNTS_HIERARCHY = {
  Assets: {
    "Current Assets": [...CURRENT_ASSETS_L3],
    "Non-Current Assets": [...NON_CURRENT_ASSETS_L3],
  },
  Liabilities: {
    "Current Liabilities": [...CURRENT_LIABILITIES_L3],
    "Non-Current Liabilities": [...NON_CURRENT_LIABILITIES_L3],
  },
  /** L2-only buckets; L3 is intentionally unused (empty arrays → no L3 dropdown in Stage 2). */
  Equity: {
    "Share Capital": [],
    "Retained Earnings": [],
    "Other Comprehensive Income": [],
  },
  Revenue: {},
  COGS: {},
  "SG&A": {},
  "Other Expense": {},
  "Other Income": {},
  "Income Tax": {},
} as const satisfies CoaHierarchy;

/** Full nested COA; same object as {@link CHART_OF_ACCOUNTS_HIERARCHY}. */
export const ACCOUNT_HIERARCHY = CHART_OF_ACCOUNTS_HIERARCHY;

/** Stable L1 ordering for selects (matches product copy). */
export const COA_LEVEL1_KEYS = [
  "Assets",
  "Liabilities",
  "Equity",
  "Revenue",
  "COGS",
  "SG&A",
  "Other Expense",
  "Other Income",
  "Income Tax",
] as const;

export function getCoaLevel2Options(l1: string): string[] {
  const branch = CHART_OF_ACCOUNTS_HIERARCHY[l1 as keyof typeof CHART_OF_ACCOUNTS_HIERARCHY];
  if (!branch || typeof branch !== "object") return [];
  return Object.keys(branch);
}

export function getCoaLevel3Options(l1: string, l2: string): string[] {
  const branch = CHART_OF_ACCOUNTS_HIERARCHY[l1 as keyof typeof CHART_OF_ACCOUNTS_HIERARCHY];
  if (!branch || !l2) return [];
  const list = (branch as Record<string, readonly string[]>)[l2];
  return list ? [...list] : [];
}

export function isTbCoaMappingIncomplete(row: {
  categoryL1: string;
  categoryL2: string;
  categoryL3: string;
}): boolean {
  if (!row.categoryL1.trim()) return true;
  const l2s = getCoaLevel2Options(row.categoryL1);
  if (l2s.length === 0) {
    return false;
  }
  if (!row.categoryL2.trim()) return true;
  const l3s = getCoaLevel3Options(row.categoryL1, row.categoryL2);
  if (l3s.length === 0) {
    return false;
  }
  return !row.categoryL3.trim();
}

/**
 * True when L1–L3 selections satisfy the COA taxonomy for this row:
 * - L1 with no L2 buckets → only L1 required.
 * - L1 with L2 buckets → L2 required; if that L2 has no L3 list, done at L2; else L3 required.
 */
export function isFullyCategorized(row: {
  categoryL1: string;
  categoryL2: string;
  categoryL3: string;
}): boolean {
  return !isTbCoaMappingIncomplete(row);
}

/** Maps legacy GAAP buckets into L1–L3 where possible (ingest / migration helpers). */
export function seedCoaFromLegacyGaap(gaap: GaapCategory): {
  categoryL1: string;
  categoryL2: string;
  categoryL3: string;
} {
  const empty = { categoryL1: "", categoryL2: "", categoryL3: "" };
  if (gaap === GAAP_AMBIGUOUS_SENTINEL) return empty;

  const g = gaap as TbFinalGaapCategory;

  switch (g) {
    case "Current Assets":
      return {
        categoryL1: "Assets",
        categoryL2: "Current Assets",
        categoryL3: "",
      };
    case "Property, Plant & Equipment (PPE)":
      return {
        categoryL1: "Assets",
        categoryL2: "Non-Current Assets",
        categoryL3: "Property, Plant, & Equipment",
      };
    case "Intangible Assets":
      return {
        categoryL1: "Assets",
        categoryL2: "Non-Current Assets",
        categoryL3: "Intangible Assets",
      };
    case "Other Non-Current Assets":
      return {
        categoryL1: "Assets",
        categoryL2: "Non-Current Assets",
        categoryL3: "Other Non-Current Assets",
      };
    case "Current Liabilities":
    case "Non-Current Liabilities":
      return { categoryL1: "Liabilities", categoryL2: "", categoryL3: "" };
    case "Equity (Retained Earnings, Common Stock, etc.)":
    case "Mezzanine Equity":
      return { categoryL1: "Equity", categoryL2: "", categoryL3: "" };
    case "Revenue":
      return { categoryL1: "Revenue", categoryL2: "", categoryL3: "" };
    case "Cost of Goods Sold (COGS)":
      return { categoryL1: "COGS", categoryL2: "", categoryL3: "" };
    case "Operating Expenses (OpEx)":
      return { categoryL1: "SG&A", categoryL2: "", categoryL3: "" };
    case "Other Income/Expense":
      return { categoryL1: "Other Expense", categoryL2: "", categoryL3: "" };
    case "Interest Expense":
      return { categoryL1: "Other Expense", categoryL2: "", categoryL3: "" };
    case "Income Tax Expense":
      return { categoryL1: "Income Tax", categoryL2: "", categoryL3: "" };
    default:
      return empty;
  }
}

/** Best-effort legacy `gaapCategory` for Memory Bank / APIs from the cascading selection. */
export function deriveLegacyGaapCategory(row: {
  categoryL1: string;
  categoryL2: string;
  categoryL3: string;
}): GaapCategory {
  const l1 = row.categoryL1.trim();
  if (!l1) return GAAP_AMBIGUOUS_SENTINEL;

  if (l1 === "Assets") {
    if (!row.categoryL2.trim() || !row.categoryL3.trim()) {
      return GAAP_AMBIGUOUS_SENTINEL;
    }
    if (row.categoryL2 === "Current Assets") {
      return "Current Assets";
    }
    if (row.categoryL2 === "Non-Current Assets") {
      const l3 = row.categoryL3;
      if (
        l3 === "Property, Plant, & Equipment" ||
        l3 === "Property, Plant & Equipment"
      ) {
        return "Property, Plant & Equipment (PPE)";
      }
      if (l3 === "Intangible Assets") {
        return "Intangible Assets";
      }
      if (
        l3 === "Right-of-Use Assets" ||
        l3 === "Investments" ||
        l3 === "Accounts Receivable" ||
        l3 === "Deferred Tax Assets" ||
        l3 === "Other Non-Current Assets"
      ) {
        return "Other Non-Current Assets";
      }
    }
    return GAAP_AMBIGUOUS_SENTINEL;
  }

  if (l1 === "Liabilities") {
    if (!row.categoryL2.trim() || !row.categoryL3.trim()) {
      return GAAP_AMBIGUOUS_SENTINEL;
    }
    if (row.categoryL2 === "Current Liabilities") {
      return "Current Liabilities";
    }
    if (row.categoryL2 === "Non-Current Liabilities") {
      return "Non-Current Liabilities";
    }
    return GAAP_AMBIGUOUS_SENTINEL;
  }

  if (l1 === "Equity") {
    if (!row.categoryL2.trim()) {
      return GAAP_AMBIGUOUS_SENTINEL;
    }
    return "Equity (Retained Earnings, Common Stock, etc.)";
  }

  switch (l1) {
    case "Revenue":
      return "Revenue";
    case "COGS":
      return "Cost of Goods Sold (COGS)";
    case "SG&A":
      return "Operating Expenses (OpEx)";
    case "Other Expense":
      return "Interest Expense";
    case "Other Income":
      return "Other Income/Expense";
    case "Income Tax":
      return "Income Tax Expense";
    default:
      return GAAP_AMBIGUOUS_SENTINEL;
  }
}
