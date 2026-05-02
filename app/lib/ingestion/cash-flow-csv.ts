import Papa from "papaparse";
import type { CashFlowLine } from "../../types/studio-finance";
import { parseMoneyCell } from "./parse-money";

function norm(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseCategory(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v === "investing") return "Investing";
  if (v === "financing") return "Financing";
  return "Operating";
}

export type CashFlowParseResult =
  | { ok: true; rows: CashFlowLine[] }
  | { ok: false; error: string };

export function parseCashFlowCsv(text: string): CashFlowParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length) {
    const msg = parsed.errors[0]?.message ?? "CSV parse error";
    return { ok: false, error: msg };
  }

  const data = parsed.data.filter((row) =>
    Object.values(row).some((v) => String(v ?? "").trim() !== ""),
  );

  if (!data.length) {
    return { ok: false, error: "The file has no data rows." };
  }

  const headerNorms = new Set(
    Object.keys(data[0] ?? {}).map((h) => norm(h)),
  );
  const required = ["line_item", "category", "py_actuals", "cy_actuals"];
  const missing = required.filter((r) => !headerNorms.has(r));
  if (missing.length) {
    return {
      ok: false,
      error: `Missing required column(s): ${missing.join(", ")}. Expected Line_Item, Category, PY_Actuals, CY_Actuals.`,
    };
  }

  const rows: CashFlowLine[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const byNorm: Record<string, string> = {};
    for (const k of Object.keys(row)) {
      byNorm[norm(k)] = row[k] ?? "";
    }
    const lineItem = byNorm.line_item?.trim() ?? "";
    if (!lineItem) continue;
    rows.push({
      id: `cf-upload-${i}`,
      lineItem,
      category: parseCategory(byNorm.category ?? "Operating"),
      py1Balance: parseMoneyCell(byNorm.py_actuals),
      cyBalance: parseMoneyCell(byNorm.cy_actuals),
    });
  }

  if (!rows.length) {
    return { ok: false, error: "No cash flow line items could be read." };
  }

  return { ok: true, rows };
}

export function buildDummyCashFlowLines(): CashFlowLine[] {
  const lines: Omit<CashFlowLine, "id">[] = [
    {
      lineItem: "Net Income",
      category: "Operating",
      py1Balance: 12_400_000,
      cyBalance: 13_850_000,
    },
    {
      lineItem: "Depreciation",
      category: "Operating",
      py1Balance: 2_100_000,
      cyBalance: 2_280_000,
    },
    {
      lineItem: "Stock-Based Compensation (SBC)",
      category: "Operating",
      py1Balance: 1_650_000,
      cyBalance: 1_920_000,
    },
    {
      lineItem: "Changes in NWC",
      category: "Operating",
      py1Balance: -980_000,
      cyBalance: -1_240_000,
    },
    {
      lineItem: "CapEx",
      category: "Investing",
      py1Balance: -3_200_000,
      cyBalance: -3_650_000,
    },
    {
      lineItem: "Proceeds from Debt Issuance",
      category: "Financing",
      py1Balance: 2_000_000,
      cyBalance: 0,
    },
  ];

  return lines.map((r, i) => ({ ...r, id: `cf-dummy-${i}` }));
}
