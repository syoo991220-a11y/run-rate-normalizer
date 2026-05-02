import Papa from "papaparse";
import type { TrialBalanceLine } from "../../types/studio-finance";
import { parseMoneyCell } from "./parse-money";

const NET_ZERO_TOLERANCE = 1; // $1 — absorbs CSV / float noise at scale

function norm(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function pickAccount(row: Record<string, string>) {
  const keys = Object.keys(row);
  for (const k of keys) {
    const n = norm(k);
    if (n === "account" || n === "account_name" || n === "gl_account" || n === "description") {
      return row[k]?.trim() ?? "";
    }
  }
  return "";
}

function pickPyCy(row: Record<string, string>): { py: number; cy: number } | null {
  const map = new Map<string, string>();
  for (const k of Object.keys(row)) {
    map.set(norm(k), row[k] ?? "");
  }
  const tryKeys = (pyKeys: string[], cyKeys: string[]) => {
    let pyRaw: string | undefined;
    let cyRaw: string | undefined;
    for (const pk of pyKeys) {
      if (map.has(pk)) {
        pyRaw = map.get(pk);
        break;
      }
    }
    for (const ck of cyKeys) {
      if (map.has(ck)) {
        cyRaw = map.get(ck);
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
    ) ??
    tryKeys(
      ["prior_period", "beginning_balance"],
      ["current_period", "ending_balance"],
    )
  );
}

export type TrialBalanceParseResult =
  | { ok: true; rows: TrialBalanceLine[] }
  | { ok: false; error: string };

export function sumBalances(
  rows: TrialBalanceLine[],
  field: "py1Balance" | "cyBalance",
) {
  return rows.reduce((s, r) => s + (Number.isFinite(r[field]) ? r[field] : 0), 0);
}

export function isTrialBalanceNetZero(rows: TrialBalanceLine[]) {
  const spy = sumBalances(rows, "py1Balance");
  const scy = sumBalances(rows, "cyBalance");
  return (
    Math.abs(spy) <= NET_ZERO_TOLERANCE && Math.abs(scy) <= NET_ZERO_TOLERANCE
  );
}

export function parseTrialBalanceCsv(text: string): TrialBalanceParseResult {
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

  const rows: TrialBalanceLine[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const account = pickAccount(row);
    const amounts = pickPyCy(row);
    if (!account || !amounts) {
      return {
        ok: false,
        error:
          "Could not find Account and PY/CY columns. Expected headers such as Account, PY, and CY.",
      };
    }
    rows.push({
      id: `tb-upload-${i}`,
      account,
      py1Balance: amounts.py,
      cyBalance: amounts.cy,
    });
  }

  if (!isTrialBalanceNetZero(rows)) {
    const spy = sumBalances(rows, "py1Balance");
    const scy = sumBalances(rows, "cyBalance");
    return {
      ok: false,
      error: `Net-to-zero check failed. PY net: ${spy.toFixed(2)}, CY net: ${scy.toFixed(2)} (tolerance ±${NET_ZERO_TOLERANCE}).`,
    };
  }

  return { ok: true, rows };
}
