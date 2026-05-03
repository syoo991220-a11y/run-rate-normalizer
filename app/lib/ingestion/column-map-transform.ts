import type { CashFlowReviewRow, CfStatementMethod } from "../../types/studio-finance";
import type { TrialBalanceReviewRow } from "../../types/studio-finance";
import { defaultCfCategoryForLine } from "./cf-category-defaults";
import { detectCfStatementMethod } from "./cf-method-detect";
import { deriveLegacyGaapCategory } from "../chart-of-accounts-hierarchy";
import { parseMoneyCell } from "./parse-money";

export type TbColumnRole =
  | "Account Number"
  | "Account Name"
  | "Current Year Balance"
  | "Prior Year 1 Balance";

export type CfColumnRole =
  | "Line Item Name"
  | "Current Year Amount"
  | "Prior Year 1 Amount";

export type TbColumnSelection = Record<TbColumnRole, string>;
export type CfColumnSelection = Record<CfColumnRole, string>;

export const TB_REQUIRED_MAP_ROLES: TbColumnRole[] = [
  "Account Number",
  "Account Name",
  "Current Year Balance",
  "Prior Year 1 Balance",
];

/** Full column-assignment field list in display order. */
export const TB_MAP_ROLE_OPTIONS: TbColumnRole[] = [...TB_REQUIRED_MAP_ROLES];

export const CF_REQUIRED_MAP_ROLES: CfColumnRole[] = [
  "Line Item Name",
  "Current Year Amount",
  "Prior Year 1 Amount",
];

export const CF_MAP_ROLE_OPTIONS: CfColumnRole[] = [...CF_REQUIRED_MAP_ROLES];

export function emptyTbColumnSelection(): TbColumnSelection {
  return {
    "Account Number": "",
    "Account Name": "",
    "Current Year Balance": "",
    "Prior Year 1 Balance": "",
  };
}

export function emptyCfColumnSelection(): CfColumnSelection {
  return {
    "Line Item Name": "",
    "Current Year Amount": "",
    "Prior Year 1 Amount": "",
  };
}

function distinctNonEmpty(values: string[]) {
  const v = values.filter((x) => x.trim() !== "");
  return new Set(v).size === v.length;
}

function collectTbMappedHeaders(sel: TbColumnSelection): string[] {
  return TB_REQUIRED_MAP_ROLES.map((role) => sel[role].trim());
}

export function validateTbMapping(
  headers: string[],
  sel: TbColumnSelection,
): string | null {
  const headerSet = new Set(headers);
  for (const role of TB_REQUIRED_MAP_ROLES) {
    const h = sel[role]?.trim();
    if (!h) return `Select a column for "${role}".`;
    if (!headerSet.has(h)) return `Unknown column for "${role}": ${h}`;
  }
  const cols = collectTbMappedHeaders(sel);
  if (!distinctNonEmpty(cols)) {
    return "Each mapped column must map to a different file column.";
  }
  return null;
}

export function validateCfMapping(
  headers: string[],
  sel: CfColumnSelection,
): string | null {
  const headerSet = new Set(headers);
  for (const role of CF_REQUIRED_MAP_ROLES) {
    const h = sel[role]?.trim();
    if (!h) return `Select a column for "${role}".`;
    if (!headerSet.has(h)) return `Unknown column for "${role}": ${h}`;
  }
  /** Amount columns may repeat the same physical column as one another; line text must be separate. */
  const lineOnly = sel["Line Item Name"].trim();
  const activityCols = [
    sel["Current Year Amount"].trim(),
    sel["Prior Year 1 Amount"].trim(),
  ].filter(Boolean);
  if (activityCols.includes(lineOnly)) {
    return `"Line Item Name" must map to a different column than amount columns.`;
  }
  return null;
}

function tbRowFinanciallyBlank(cyBalance: number, py1Balance: number) {
  return cyBalance === 0 && py1Balance === 0;
}

export function transformTbWithColumnMap(
  data: Record<string, string>[],
  sel: TbColumnSelection,
): TrialBalanceReviewRow[] {
  const rows: TrialBalanceReviewRow[] = [];
  let i = 0;
  for (const r of data) {
    const accountNumber = (r[sel["Account Number"]] ?? "").trim();
    const accountName = (r[sel["Account Name"]] ?? "").trim();
    const cyBalance = parseMoneyCell(r[sel["Current Year Balance"]]);
    const py1Balance = parseMoneyCell(r[sel["Prior Year 1 Balance"]]);

    if (!accountNumber && !accountName) {
      if (tbRowFinanciallyBlank(cyBalance, py1Balance)) {
        continue;
      }
    }

    const seededCoa = {
      categoryL1: "",
      categoryL2: "",
      categoryL3: "",
    };
    const row: TrialBalanceReviewRow = {
      id: `tb-mapped-${i}`,
      accountNumber: accountNumber || "—",
      accountName: accountName || "—",
      cyBalance,
      py1Balance,
      ...seededCoa,
      gaapCategory: deriveLegacyGaapCategory(seededCoa),
    };
    rows.push(row);
    i += 1;
  }
  return rows;
}

export function transformCfWithColumnMap(
  data: Record<string, string>[],
  sel: CfColumnSelection,
): { rows: CashFlowReviewRow[]; method: CfStatementMethod } {
  const lite: { lineItem: string }[] = [];
  for (const r of data) {
    const lineItem = (r[sel["Line Item Name"]] ?? "").trim();
    if (lineItem) lite.push({ lineItem });
  }
  const method = detectCfStatementMethod(lite);

  const rows: CashFlowReviewRow[] = [];
  let i = 0;
  for (const r of data) {
    const lineItem = (r[sel["Line Item Name"]] ?? "").trim();
    if (!lineItem) continue;
    const cyBalance = parseMoneyCell(r[sel["Current Year Amount"]]);
    const py1Balance = parseMoneyCell(r[sel["Prior Year 1 Amount"]]);
    const category = defaultCfCategoryForLine(lineItem, method);
    const row: CashFlowReviewRow = {
      id: `cf-mapped-${i}`,
      lineItem,
      cyBalance,
      py1Balance,
      category,
    };
    rows.push(row);
    i += 1;
  }
  return { rows, method };
}

function firstHeaderMatching(headers: string[], patterns: RegExp[]) {
  for (const h of headers) {
    const l = h.toLowerCase();
    if (patterns.some((re) => re.test(l))) return h;
  }
  return "";
}

/** Best-effort defaults from header text (optional UX). */
export function guessTbMapping(headers: string[]): Partial<TbColumnSelection> {
  return {
    "Account Number": firstHeaderMatching(headers, [
      /\bgl\b|\bcoa\b|acct\s*#|account\s*#|account\s*no|acct\s*no|account\s*code/i,
    ]),
    "Account Name": firstHeaderMatching(headers, [
      /account\s*name|acct\s*name|description|account\s*title/i,
    ]),
    "Prior Year 1 Balance": firstHeaderMatching(headers, [
      /\bpy1\b|\bpy\b(?!\d).*(bal|amt|amount|net)|(bal|amt|amount|net).*\bpy\b(?!\d)|prior.*(year|yr|bal)(?!\s*[23])|\by1\b|year\s*-?\s*1/i,
    ]),
    "Current Year Balance": firstHeaderMatching(headers, [
      /\bcy\b.*(bal|amt|amount|net)|(bal|amt|amount|net).*\bcy\b|current.*(year|yr|bal)|\by2\b|year\s*-?\s*0/i,
    ]),
  };
}

export function guessCfMapping(headers: string[]): Partial<CfColumnSelection> {
  return {
    "Line Item Name": firstHeaderMatching(headers, [
      /line\s*item|^item\b|description|activity/i,
    ]),
    "Prior Year 1 Amount": firstHeaderMatching(headers, [
      /\bpy1\b|\bpy\b(?!\d)|prior(?!\s*[23])|y1|amount.*py1/i,
    ]),
    "Current Year Amount": firstHeaderMatching(headers, [
      /\bcy\b|current|y2|amount.*cy/i,
    ]),
  };
}
