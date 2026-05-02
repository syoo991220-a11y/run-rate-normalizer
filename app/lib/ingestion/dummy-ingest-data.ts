import type {
  CashFlowReviewRow,
  CfStatementMethod,
  TrialBalanceReviewRow,
} from "../../types/studio-finance";
import { defaultCfCategoryForLine } from "./cf-category-defaults";
import { detectCfStatementMethod } from "./cf-method-detect";
import { deriveLegacyGaapCategory } from "../chart-of-accounts-hierarchy";

function tbRow(
  accountNumber: string,
  accountName: string,
  py1Balance: number,
  cyBalance: number,
  i: number,
): TrialBalanceReviewRow {
  const emptyCoa = {
    categoryL1: "",
    categoryL2: "",
    categoryL3: "",
  };
  return {
    id: `tb-dummy-${i}`,
    accountNumber,
    accountName,
    py1Balance,
    cyBalance,
    ...emptyCoa,
    gaapCategory: deriveLegacyGaapCategory(emptyCoa),
  };
}

/** Balanced trial balance with realistic GL codes for mapper testing. */
export function buildDummyTrialBalanceReviewRows(): TrialBalanceReviewRow[] {
  const base: TrialBalanceReviewRow[] = [
    tbRow("1100", "Cash and cash equivalents", 9_100_000, 22_260_000, 0),
    tbRow("1200", "Accounts receivable — trade", 6_100_000, 6_850_000, 1),
    tbRow("1500", "PP&E — net", 22_000_000, 23_400_000, 2),
    tbRow("2100", "Accounts payable", -4_200_000, -4_550_000, 3),
    tbRow("2300", "Accrued expenses", -2_800_000, -3_050_000, 4),
    tbRow("3100", "Retained earnings", -18_500_000, -19_200_000, 5),
    tbRow("4100", "Subscription revenue", -15_800_000, -17_200_000, 6),
    tbRow("5100", "Cost of revenue — hosting", 5_400_000, 5_900_000, 7),
    tbRow("6200", "Sales & marketing expense", 7_900_000, 8_450_000, 8),
    tbRow("6300", "G&A expense", 3_200_000, 3_350_000, 9),
    tbRow("7100", "Interest expense", 650_000, 720_000, 10),
    tbRow("7200", "Income tax expense", 1_100_000, 1_240_000, 11),
  ];

  const pyNet = base.reduce((s, r) => s + r.py1Balance, 0);
  const cyNet = base.reduce((s, r) => s + r.cyBalance, 0);

  const plugCoa = {
    categoryL1: "",
    categoryL2: "",
    categoryL3: "",
  };
  base.push({
    id: "tb-dummy-plug",
    accountNumber: "99999",
    accountName: "Statistical — close plug (rounding)",
    py1Balance: -pyNet,
    cyBalance: -cyNet,
    ...plugCoa,
    gaapCategory: deriveLegacyGaapCategory(plugCoa),
  });

  return base;
}

const INDIRECT_LINES: { lineItem: string; py1Balance: number; cyBalance: number }[] =
  [
    {
      lineItem: "Cash at beginning of period",
      py1Balance: 8_200_000,
      cyBalance: 9_100_000,
    },
    { lineItem: "Net Income", py1Balance: 12_400_000, cyBalance: 13_850_000 },
    { lineItem: "Depreciation", py1Balance: 2_100_000, cyBalance: 2_280_000 },
    {
      lineItem: "Stock-Based Compensation (SBC)",
      py1Balance: 1_650_000,
      cyBalance: 1_920_000,
    },
    { lineItem: "Changes in NWC", py1Balance: -980_000, cyBalance: -1_240_000 },
    { lineItem: "CapEx", py1Balance: -3_200_000, cyBalance: -3_650_000 },
    {
      lineItem: "Proceeds from Debt Issuance",
      py1Balance: 2_000_000,
      cyBalance: 0,
    },
    {
      lineItem: "Net increase (decrease) in cash",
      py1Balance: 13_970_000,
      cyBalance: 13_160_000,
    },
    {
      lineItem: "Cash at end of period",
      py1Balance: 22_170_000,
      cyBalance: 22_260_000,
    },
  ];

/** Default dummy CF is indirect-style (Net Income leading). */
export function buildDummyCashFlowReviewRows(): {
  rows: CashFlowReviewRow[];
  method: CfStatementMethod;
} {
  const method = detectCfStatementMethod(
    INDIRECT_LINES.map((l) => ({ lineItem: l.lineItem })),
  );
  const rows: CashFlowReviewRow[] = INDIRECT_LINES.map((r, i) => ({
    id: `cf-dummy-${i}`,
    lineItem: r.lineItem,
    py1Balance: r.py1Balance,
    cyBalance: r.cyBalance,
    category: defaultCfCategoryForLine(r.lineItem, method),
  }));
  return { rows, method };
}
