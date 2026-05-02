import Papa from "papaparse";
import {
  CF_REVIEW_CATEGORIES,
  type CashFlowReviewRow,
  type CfStatementMethod,
} from "../../types/studio-finance";
import { defaultCfCategoryForLine } from "./cf-category-defaults";
import { detectCfStatementMethod } from "./cf-method-detect";
import { parseMoneyCell } from "./parse-money";

function norm(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeCategoryCell(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if ((CF_REVIEW_CATEGORIES as readonly string[]).includes(v)) return v;
  return null;
}

export type CfReviewParseResult =
  | { ok: true; rows: CashFlowReviewRow[]; method: CfStatementMethod }
  | { ok: false; error: string };

export function parseCashFlowRowsForReview(
  data: Record<string, string>[],
): CfReviewParseResult {
  if (!data.length) {
    return { ok: false, error: "The file has no data rows." };
  }

  const headerNorms = new Set(
    Object.keys(data[0] ?? {}).map((h) => norm(h)),
  );
  if (
    !headerNorms.has("line_item") ||
    !headerNorms.has("py_actuals") ||
    !headerNorms.has("cy_actuals")
  ) {
    return {
      ok: false,
      error:
        "Missing required columns: Line_Item, PY_Actuals, CY_Actuals. Optional Category.",
    };
  }

  const lite: { lineItem: string }[] = [];
  for (let i = 0; i < data.length; i++) {
    const byNorm: Record<string, string> = {};
    for (const k of Object.keys(data[i])) {
      byNorm[norm(k)] = data[i][k] ?? "";
    }
    const lineItem = byNorm.line_item?.trim() ?? "";
    if (lineItem) lite.push({ lineItem });
  }

  const method = detectCfStatementMethod(lite);

  const rows: CashFlowReviewRow[] = [];
  for (let i = 0; i < data.length; i++) {
    const byNorm: Record<string, string> = {};
    for (const k of Object.keys(data[i])) {
      byNorm[norm(k)] = data[i][k] ?? "";
    }
    const lineItem = byNorm.line_item?.trim() ?? "";
    if (!lineItem) continue;

    const catRaw = byNorm.category?.trim() ?? "";
    const parsedCat = normalizeCategoryCell(catRaw);
    const category =
      parsedCat ?? defaultCfCategoryForLine(lineItem, method);

    rows.push({
      id: `cf-ingest-${i}`,
      lineItem,
      py1Balance: parseMoneyCell(byNorm.py_actuals),
      cyBalance: parseMoneyCell(byNorm.cy_actuals),
      category,
    });
  }

  if (!rows.length) {
    return { ok: false, error: "No cash flow line items could be read." };
  }

  return { ok: true, rows, method };
}

export function parseCashFlowCsvForReview(text: string): CfReviewParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length) {
    return { ok: false, error: parsed.errors[0]?.message ?? "CSV parse error" };
  }

  const data = parsed.data.filter((row) =>
    Object.values(row).some((v) => String(v ?? "").trim() !== ""),
  );

  return parseCashFlowRowsForReview(data);
}
