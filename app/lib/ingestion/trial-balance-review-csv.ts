import Papa from "papaparse";
import type { TrialBalanceReviewRow } from "../../types/studio-finance";
import { deriveLegacyGaapCategory } from "../chart-of-accounts-hierarchy";
import { parseMoneyCell } from "./parse-money";

function norm(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function rowMap(row: Record<string, string>) {
  const m = new Map<string, string>();
  for (const k of Object.keys(row)) {
    m.set(norm(k), row[k] ?? "");
  }
  return m;
}

function pickPyCy(m: Map<string, string>): { py: number; cy: number } | null {
  const tryKeys = (pyKeys: string[], cyKeys: string[]) => {
    let pyRaw: string | undefined;
    let cyRaw: string | undefined;
    for (const pk of pyKeys) {
      if (m.has(pk)) {
        pyRaw = m.get(pk);
        break;
      }
    }
    for (const ck of cyKeys) {
      if (m.has(ck)) {
        cyRaw = m.get(ck);
        break;
      }
    }
    if (pyRaw === undefined || cyRaw === undefined) return null;
    return { py: parseMoneyCell(pyRaw), cy: parseMoneyCell(cyRaw) };
  };

  return (
    tryKeys(
      ["py", "prior_year", "prior", "py_balance", "py_actuals", "y1"],
      ["cy", "current_year", "current", "cy_balance", "cy_actuals", "y2"],
    ) ?? tryKeys(["prior_period"], ["current_period"])
  );
}

function pickAccountNumberAndName(m: Map<string, string>): {
  accountNumber: string;
  accountName: string;
} | null {
  const numKeys = [
    "account_number",
    "gl_account",
    "account_no",
    "acct_no",
    "account#",
    "account_code",
    "coa",
  ];
  const nameKeys = [
    "account_name",
    "description",
    "account_description",
    "gl_description",
    "name",
  ];

  let accountNumber = "";
  for (const k of numKeys) {
    if (m.has(k)) {
      accountNumber = (m.get(k) ?? "").trim();
      break;
    }
  }

  let accountName = "";
  for (const k of nameKeys) {
    if (m.has(k)) {
      accountName = (m.get(k) ?? "").trim();
      break;
    }
  }

  if (!accountNumber && m.has("account")) {
    const combined = (m.get("account") ?? "").trim();
    const mSplit = /^(\d+[\d\-]*)\s*[-–—:]\s*(.+)$/.exec(combined);
    if (mSplit) {
      accountNumber = mSplit[1].trim();
      accountName = mSplit[2].trim();
    } else {
      accountName = combined;
    }
  }

  if (!accountName && !accountNumber) {
    return null;
  }

  return { accountNumber: accountNumber || "—", accountName: accountName || "—" };
}

export type TbReviewParseResult =
  | { ok: true; rows: TrialBalanceReviewRow[] }
  | { ok: false; error: string };

export function parseTrialBalanceRowsForReview(
  data: Record<string, string>[],
): TbReviewParseResult {
  if (!data.length) {
    return { ok: false, error: "The file has no data rows." };
  }

  const rows: TrialBalanceReviewRow[] = [];
  for (let i = 0; i < data.length; i++) {
    const m = rowMap(data[i]);
    const ids = pickAccountNumberAndName(m);
    const amounts = pickPyCy(m);
    if (!ids || !amounts) {
      return {
        ok: false,
        error:
          "Missing columns. Expected Account_Number (or Account) plus Account_Name (or combined Account) with PY and CY balances.",
      };
    }
    const emptyCoa = {
      categoryL1: "",
      categoryL2: "",
      categoryL3: "",
    };
    rows.push({
      id: `tb-ingest-${i}`,
      accountNumber: ids.accountNumber,
      accountName: ids.accountName,
      py1Balance: amounts.py,
      cyBalance: amounts.cy,
      ...emptyCoa,
      gaapCategory: deriveLegacyGaapCategory(emptyCoa),
    });
  }

  return { ok: true, rows };
}

export function parseTrialBalanceCsvForReview(text: string): TbReviewParseResult {
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

  return parseTrialBalanceRowsForReview(data);
}
