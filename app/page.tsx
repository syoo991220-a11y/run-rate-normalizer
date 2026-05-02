"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useStudioMemory } from "./context/studio-memory-context";
import {
  CF_REVIEW_CATEGORIES,
  type CashFlowLine,
  type CashFlowReviewRow,
  type CfReviewLineCategory,
  type CfStatementMethod,
  type TrialBalanceLine,
  type TrialBalanceReviewRow,
} from "./types/studio-finance";
import {
  COA_LEVEL1_KEYS,
  deriveLegacyGaapCategory,
  getCoaLevel2Options,
  getCoaLevel3Options,
  isFullyCategorized,
  isTbCoaMappingIncomplete,
} from "./lib/chart-of-accounts-hierarchy";
import { IngestionColumnMapper } from "./components/ingestion-column-mapper";
import { Stage2AmountInput } from "./components/stage2-amount-input";
import {
  emptyCfColumnSelection,
  emptyTbColumnSelection,
  guessCfMapping,
  guessTbMapping,
  transformCfWithColumnMap,
  transformTbWithColumnMap,
  validateCfMapping,
  validateTbMapping,
  type CfColumnSelection,
  type TbColumnSelection,
} from "./lib/ingestion/column-map-transform";
import { evaluateCfCashTieOutToTrialBalance } from "./lib/ingestion/cf-cash-reconcile";
import {
  CF_BEGINNING_CATEGORY,
  CF_ENDING_CATEGORY,
  evaluateCfScfTieOut,
  isExcludedFromScfActivitySum,
} from "./lib/ingestion/cf-scf-tieout";
import { detectCfKeywordPresentationMethod } from "./lib/ingestion/cf-method-detect";
import {
  arrayBufferToRawSheetTable,
  fileToRawSheetTable,
} from "./lib/ingestion/workbook-ingest";

type Stage = 1 | 2 | 3;

type MapSession =
  | {
      kind: "tb";
      fileName: string;
      headers: string[];
      rows: Record<string, string>[];
      selection: TbColumnSelection;
    }
  | {
      kind: "cf";
      fileName: string;
      headers: string[];
      rows: Record<string, string>[];
      selection: CfColumnSelection;
    };

const ACCEPT_FILES =
  ".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

const DEMO_TB_URL = "/demo/demo-tb.xlsx";
const DEMO_CF_URL = "/demo/demo-cashflow.xlsx";
const DEMO_TB_FILE_LABEL = "demo-tb.xlsx";
const DEMO_CF_FILE_LABEL = "demo-cashflow.xlsx";

/** Hint copy inside upload tiles — transparent fill; spacing from parent `space-y-2`. */
const DROPZONE_SUBTEXT_CLASS =
  "w-full max-w-md bg-transparent px-1 text-center text-sm leading-relaxed text-slate-400";

/** Operating lines included in Section 1 and in the net change roll-forward. */
const CF_STAGE2_OPERATING_CATEGORIES: readonly CfReviewLineCategory[] = [
  "Operating — Net Income",
  "Operating — Non-Cash Adjustment",
  "Operating — Working Capital Change",
];

function cfSumCol(
  rows: CashFlowReviewRow[],
  col: "cy" | "py1" | "py2" | "py3",
): number {
  return rows.reduce((s, r) => {
    const v =
      col === "cy"
        ? r.cyBalance
        : col === "py1"
          ? r.py1Balance
          : col === "py2"
            ? (r.py2Balance ?? 0)
            : (r.py3Balance ?? 0);
    return s + v;
  }, 0);
}

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

const STAGE2_REVIEW_ACTIONS_TH =
  "sticky right-0 z-20 w-[4.25rem] min-w-[4.25rem] border-l border-slate-800/90 bg-slate-950/95 px-2 py-3 text-center font-medium text-slate-400 shadow-[-6px_0_14px_rgba(15,23,42,0.65)] backdrop-blur-sm";

const STAGE2_REVIEW_DELETE_BTN =
  "inline-flex rounded-md border border-rose-900/45 bg-rose-950/25 p-1.5 text-rose-400/95 shadow-sm transition hover:border-rose-500/55 hover:bg-rose-900/35 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40";

const STAGE2_REVIEW_ACTIONS_TD_BASE =
  "sticky right-0 z-10 w-[4.25rem] min-w-[4.25rem] border-l px-2 py-2 text-center align-middle shadow-[-6px_0_14px_rgba(15,23,42,0.55)] backdrop-blur-sm";

function stage2CfRowActionsCell(
  tone: "default" | "amber" | "ending" | "supplemental",
): string {
  const borders: Record<typeof tone, string> = {
    default: "border-slate-800/80 bg-slate-950/90 group-hover:bg-slate-900/85",
    amber: "border-amber-800/35 bg-amber-950/30 group-hover:bg-amber-950/45",
    ending: "border-slate-800/80 bg-slate-950/90 group-hover:bg-slate-900/85",
    supplemental: "border-slate-800/80 bg-slate-950/25 group-hover:bg-slate-900/55",
  };
  return `${STAGE2_REVIEW_ACTIONS_TD_BASE} ${borders[tone]}`;
}

function stage2CfSubtotalActionsCell(): string {
  return `${STAGE2_REVIEW_ACTIONS_TD_BASE} border-slate-800/80 bg-slate-950/50`;
}

const STAGE2_REVIEW_TB_ACTIONS_TD = `${STAGE2_REVIEW_ACTIONS_TD_BASE} border-slate-800/80 bg-slate-950/90 group-hover:bg-slate-900/85`;

const STAGE2_COA_SELECT_CLASS =
  "min-w-[6.75rem] max-w-[11rem] shrink-0 rounded-md border border-slate-700 bg-slate-900 px-1.5 py-1 text-sm text-slate-100 outline-none focus-visible:border-slate-500 focus-visible:ring-2 focus-visible:ring-cyan-500/25";

function toCents(n: number) {
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

function sumTbYearCents(
  rows: TrialBalanceReviewRow[],
  key: "cyBalance" | "py1Balance" | "py2Balance" | "py3Balance",
): number {
  return rows.reduce((s, r) => s + toCents((r[key] as number | undefined) ?? 0), 0);
}

/** CY + PY1 always enforced; PY2/PY3 only when those columns were mapped at ingest. */
function trialBalanceNetsExactlyZero(rows: TrialBalanceReviewRow[]) {
  if (sumTbYearCents(rows, "cyBalance") !== 0) return false;
  if (sumTbYearCents(rows, "py1Balance") !== 0) return false;
  const hasPy2 = rows.some((r) => r.py2Balance !== undefined);
  const hasPy3 = rows.some((r) => r.py3Balance !== undefined);
  if (hasPy2 && sumTbYearCents(rows, "py2Balance") !== 0) return false;
  if (hasPy3 && sumTbYearCents(rows, "py3Balance") !== 0) return false;
  return true;
}

function tbNetZeroFailureHint(rows: TrialBalanceReviewRow[]) {
  if (sumTbYearCents(rows, "cyBalance") !== 0) {
    return "CY (current year) must net to exactly $0.00.";
  }
  if (sumTbYearCents(rows, "py1Balance") !== 0) {
    return "PY1 (prior year 1) must net to exactly $0.00.";
  }
  const hasPy2 = rows.some((r) => r.py2Balance !== undefined);
  const hasPy3 = rows.some((r) => r.py3Balance !== undefined);
  if (hasPy2 && sumTbYearCents(rows, "py2Balance") !== 0) {
    return "Mapped PY2 must net to exactly $0.00.";
  }
  if (hasPy3 && sumTbYearCents(rows, "py3Balance") !== 0) {
    return "Mapped PY3 must net to exactly $0.00.";
  }
  return "Trial balance year nets must equal $0.00.";
}

function toLedgerTrialBalance(row: TrialBalanceReviewRow): TrialBalanceLine {
  const display =
    row.accountNumber && row.accountNumber !== "—"
      ? `${row.accountNumber} — ${row.accountName}`
      : row.accountName;
  const line: TrialBalanceLine = {
    id: row.id,
    account: display,
    cyBalance: row.cyBalance,
    py1Balance: row.py1Balance,
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    gaapCategory: row.gaapCategory,
  };
  if (row.categoryL1) line.categoryL1 = row.categoryL1;
  if (row.categoryL2) line.categoryL2 = row.categoryL2;
  if (row.categoryL3) line.categoryL3 = row.categoryL3;
  if (row.py2Balance !== undefined) line.py2Balance = row.py2Balance;
  if (row.py3Balance !== undefined) line.py3Balance = row.py3Balance;
  return line;
}

function toLedgerCashFlow(row: CashFlowReviewRow): CashFlowLine {
  const line: CashFlowLine = {
    id: row.id,
    lineItem: row.lineItem,
    cyBalance: row.cyBalance,
    py1Balance: row.py1Balance,
    category: row.category,
  };
  if (row.py2Balance !== undefined) line.py2Balance = row.py2Balance;
  if (row.py3Balance !== undefined) line.py3Balance = row.py3Balance;
  return line;
}

/** Rebuild Stage 2/3 TB rows from Memory Bank lines (after route remount or finalize). */
function fromLedgerTrialBalance(row: TrialBalanceLine): TrialBalanceReviewRow {
  let accountNumber = row.accountNumber?.trim() ?? "";
  let accountName = row.accountName?.trim() ?? "";
  if (!accountNumber && !accountName && row.account) {
    const sep = " — ";
    const idx = row.account.indexOf(sep);
    if (idx >= 0) {
      accountNumber = row.account.slice(0, idx).trim();
      accountName = row.account.slice(idx + sep.length).trim();
    } else {
      accountName = row.account.trim();
    }
  }
  if (!accountNumber) accountNumber = "—";
  if (!accountName) accountName = row.account.trim() || "—";
  const storedCoa = {
    categoryL1: row.categoryL1?.trim() ?? "",
    categoryL2: row.categoryL2?.trim() ?? "",
    categoryL3: row.categoryL3?.trim() ?? "",
  };
  const hasAnyStored =
    !!storedCoa.categoryL1 ||
    !!storedCoa.categoryL2 ||
    !!storedCoa.categoryL3;
  const coa: {
    categoryL1: string;
    categoryL2: string;
    categoryL3: string;
  } = hasAnyStored
    ? { ...storedCoa }
    : {
        categoryL1: "",
        categoryL2: "",
        categoryL3: "",
      };
  if (
    coa.categoryL1 === "Assets" &&
    coa.categoryL2 === "Non-Current Assets" &&
    coa.categoryL3 === "Property, Plant & Equipment"
  ) {
    coa.categoryL3 = "Property, Plant, & Equipment";
  }
  if (coa.categoryL1 === "Equity") {
    if (coa.categoryL2 === "Other Comprehensive Income (AOCI)") {
      coa.categoryL2 = "Other Comprehensive Income";
    }
    const allowedEquityL2 = new Set([
      "Share Capital",
      "Retained Earnings",
      "Other Comprehensive Income",
    ]);
    if (coa.categoryL2 && !allowedEquityL2.has(coa.categoryL2)) {
      coa.categoryL2 = "";
    }
    coa.categoryL3 = "";
  }
  if (coa.categoryL1 === "Liabilities" && coa.categoryL2) {
    const allowedL2 = new Set(["Current Liabilities", "Non-Current Liabilities"]);
    if (!allowedL2.has(coa.categoryL2)) {
      coa.categoryL2 = "";
      coa.categoryL3 = "";
    } else if (coa.categoryL3) {
      const allowedL3 = new Set(
        getCoaLevel3Options("Liabilities", coa.categoryL2),
      );
      const legacyL3: Record<string, string> = {
        "Provisions / Contingent Liabilities": "Contingent Liabilities",
        "Lease Liabilities": "ROU Liabilities",
        "Taxes Payable": "Accrued Liabilities",
        "Pension & Post-Employment Obligations": "Other Non-Current Liabilities",
      };
      const mapped = legacyL3[coa.categoryL3] ?? coa.categoryL3;
      if (allowedL3.has(mapped)) {
        coa.categoryL3 = mapped;
      } else if (!allowedL3.has(coa.categoryL3)) {
        coa.categoryL3 = "";
      }
    }
  }
  const out: TrialBalanceReviewRow = {
    id: row.id,
    accountNumber,
    accountName,
    cyBalance: row.cyBalance,
    py1Balance: row.py1Balance,
    ...coa,
    gaapCategory: deriveLegacyGaapCategory(coa),
  };
  if (row.py2Balance !== undefined) out.py2Balance = row.py2Balance;
  if (row.py3Balance !== undefined) out.py3Balance = row.py3Balance;
  return out;
}

function fromLedgerCashFlow(row: CashFlowLine): CashFlowReviewRow {
  const out: CashFlowReviewRow = {
    id: row.id,
    lineItem: row.lineItem,
    cyBalance: row.cyBalance,
    py1Balance: row.py1Balance,
    category: row.category,
  };
  if (row.py2Balance !== undefined) out.py2Balance = row.py2Balance;
  if (row.py3Balance !== undefined) out.py3Balance = row.py3Balance;
  return out;
}

/** Map AI-suggested L1/L2/L3 strings onto valid COA hierarchy options for Stage 2 selects. */
function resolveAiCoaLevels(
  l1Raw: string,
  l2Raw: string,
  l3Raw: string,
): { categoryL1: string; categoryL2: string; categoryL3: string } {
  const t = (l1Raw ?? "").trim();
  if (!t) {
    return { categoryL1: "", categoryL2: "", categoryL3: "" };
  }
  const lower = t.toLowerCase();

  let categoryL1 = "";
  for (const k of COA_LEVEL1_KEYS) {
    if (k.toLowerCase() === lower) {
      categoryL1 = k;
      break;
    }
  }
  if (!categoryL1) {
    if (/^expenses?$/.test(lower)) categoryL1 = "Other Expense";
    else if (lower === "cogs" || lower.includes("cost of goods")) categoryL1 = "COGS";
    else if (lower === "sga" || lower.includes("sg&a") || lower.includes("operating expense"))
      categoryL1 = "SG&A";
    else if (lower.includes("income tax") || /^tax(es)?$/i.test(lower))
      categoryL1 = "Income Tax";
    else if (lower === "income" || lower.includes("other income")) categoryL1 = "Other Income";
  }
  if (!categoryL1) {
    return { categoryL1: "", categoryL2: "", categoryL3: "" };
  }

  const l2opts = getCoaLevel2Options(categoryL1);
  if (l2opts.length === 0) {
    return { categoryL1, categoryL2: "", categoryL3: "" };
  }

  const l2t = (l2Raw ?? "").trim();
  const categoryL2 =
    l2opts.find((o) => o.toLowerCase() === l2t.toLowerCase()) ?? "";

  let categoryL3 = "";
  if (categoryL2) {
    const l3opts = getCoaLevel3Options(categoryL1, categoryL2);
    const l3t = (l3Raw ?? "").trim();
    categoryL3 = l3opts.find((o) => o.toLowerCase() === l3t.toLowerCase()) ?? "";
    if (
      !categoryL3 &&
      categoryL1 === "Assets" &&
      categoryL2 === "Current Assets" &&
      l3t
    ) {
      const tl = l3t.toLowerCase();
      if (
        tl.includes("cash") &&
        (tl.includes("equivalent") || tl.includes("equiv") || tl === "cash")
      ) {
        categoryL3 = l3opts.find((o) => o === "Cash & Equivalents") ?? "";
      } else if (/prepaid\s*expenses?/i.test(l3t)) {
        categoryL3 = l3opts.find((o) => o === "Prepaid expense") ?? "";
      } else if (/right[-\s]?of[-\s]?use|^rou\b/i.test(l3t)) {
        categoryL3 = l3opts.find((o) => o === "ROU Assets") ?? "";
      }
    }
    if (
      !categoryL3 &&
      categoryL1 === "Assets" &&
      categoryL2 === "Non-Current Assets" &&
      l3t
    ) {
      const compact = l3t.toLowerCase().replace(/\s+/g, "");
      if (
        compact === "property,plant&equipment" ||
        compact === "propertyplant&equipment" ||
        compact === "propertyplantandequipment"
      ) {
        categoryL3 =
          l3opts.find((o) => o === "Property, Plant, & Equipment") ?? "";
      }
    }
  }

  if (categoryL1 === "Equity") {
    return { categoryL1, categoryL2, categoryL3: "" };
  }

  return { categoryL1, categoryL2, categoryL3 };
}

type AiCategorizeRow = {
  accountName: string;
  L1: string;
  L2: string;
  L3: string;
};

/** Smaller batches reduce Gemini timeouts on free tier (e.g. ~70 accounts → ~6 requests). */
const AI_CATEGORIZE_BATCH_SIZE = 12;

const AI_LIMIT_PARTIAL_MESSAGE =
  "AI limit reached. Some accounts were categorized; please click again in 60 seconds to finish the rest.";

function parseChatApiErrorMessage(data: unknown, res: Response): string {
  const statusLine = `${res.status} ${res.statusText || ""}`.trim();
  let detail = "";
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) {
      detail = o.message.trim();
    } else if (typeof o.error === "string" && o.error.trim()) {
      detail = o.error.trim();
    }
  }
  if (detail) return `${statusLine}: ${detail}`;
  return `${statusLine} (no JSON error details in response body)`;
}

/** If the server (or a proxy) returns fenced JSON, strip ``` / ```json before parsing. */
function stripMarkdownJsonFenceFromText(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/im.exec(trimmed);
  return fence ? fence[1]!.trim() : trimmed;
}

function parseResponseJsonSafely(resBody: string): unknown {
  const raw = resBody.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const unfenced = stripMarkdownJsonFenceFromText(raw);
    if (unfenced !== raw) {
      return JSON.parse(unfenced);
    }
    throw new SyntaxError("Could not parse JSON after stripping markdown fences.");
  }
}

function isAiLimitReachedResponse(res: Response, data: unknown): boolean {
  if (res.status === 429) return true;
  const msg = parseChatApiErrorMessage(data, res).toLowerCase();
  return (
    msg.includes("free limit") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("rate limit")
  );
}

function pickAiLevel(
  row: Record<string, unknown>,
  lowerKey: "l1" | "l2" | "l3",
): string {
  const upper = lowerKey.toUpperCase() as "L1" | "L2" | "L3";
  const v = row[lowerKey] ?? row[upper];
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

function mergeCategorizeArrayIntoMap(
  map: Map<string, AiCategorizeRow>,
  data: unknown,
): void {
  if (!Array.isArray(data)) return;
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const accountName =
      typeof row.accountName === "string" ? row.accountName.trim() : "";
    if (!accountName) continue;
    map.set(accountName.toLowerCase(), {
      accountName,
      L1: pickAiLevel(row, "l1").trim(),
      L2: pickAiLevel(row, "l2").trim(),
      L3: pickAiLevel(row, "l3").trim(),
    });
  }
}

export default function DataIngestionPage() {
  const router = useRouter();
  const {
    finalizeMemoryBankIngest,
    trialBalance: memoryTrialBalance,
    cashFlowLines: memoryCashFlowLines,
    cfStatementMethod: memoryCfStatementMethod,
    ingestionStage: stage,
    setIngestionStage: setStage,
    ingestionTbRows: tbRows,
    setIngestionTbRows: setTbRows,
    ingestionCfRows: cfRows,
    setIngestionCfRows: setCfRows,
    ingestionTbMappedFileName: tbMappedFileName,
    setIngestionTbMappedFileName: setTbMappedFileName,
    ingestionCfMappedFileName: cfMappedFileName,
    setIngestionCfMappedFileName: setCfMappedFileName,
    ingestionCfMethod: cfMethod,
    setIngestionCfMethod: setCfMethod,
    ingestionCfKeywordMethod: cfKeywordMethod,
    setIngestionCfKeywordMethod: setCfKeywordMethod,
    ingestionReuploadDraftMode,
    setIngestionReuploadDraftMode,
  } = useStudioMemory();

  const [reviewTab, setReviewTab] = useState<"tb" | "cf">("tb");
  const [aiCategorizeLoading, setAiCategorizeLoading] = useState(false);
  const [aiCategorizeError, setAiCategorizeError] = useState<string | null>(null);

  const [tbError, setTbError] = useState<string | null>(null);
  const [cfError, setCfError] = useState<string | null>(null);

  const [tbDrag, setTbDrag] = useState(false);
  const [cfDrag, setCfDrag] = useState(false);

  const [mapSession, setMapSession] = useState<MapSession | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);

  /** When demo TB needs manual column mapping, cash flow raw table is applied after TB confirm. */
  const pendingDemoCfAfterTbConfirmRef = useRef<{
    fileName: string;
    headers: string[];
    rows: Record<string, string>[];
  } | null>(null);
  const [demoFilesLoading, setDemoFilesLoading] = useState(false);
  const [demoSuccessNotice, setDemoSuccessNotice] = useState<string | null>(null);

  const tbInputRef = useRef<HTMLInputElement>(null);
  const cfInputRef = useRef<HTMLInputElement>(null);

  /** After a blocked jump to Stage 3, incomplete TB rows are highlighted until mapping is complete. */
  const [stage2TbAdvanceHighlight, setStage2TbAdvanceHighlight] = useState(false);

  /** If workpapers were lost on remount but Memory Bank still has imports, restore Stage 3. */
  useEffect(() => {
    if (tbRows.length > 0 || cfRows.length > 0) return;
    if (
      memoryTrialBalance.length === 0 ||
      memoryCashFlowLines.length === 0
    ) {
      return;
    }
    setTbRows(memoryTrialBalance.map(fromLedgerTrialBalance));
    setCfRows(memoryCashFlowLines.map(fromLedgerCashFlow));
    setStage(3);
    setCfMethod(memoryCfStatementMethod);
    setCfKeywordMethod(null);
    setTbMappedFileName(null);
    setCfMappedFileName(null);
  }, [
    tbRows.length,
    cfRows.length,
    memoryTrialBalance,
    memoryCashFlowLines,
    memoryCfStatementMethod,
    setTbRows,
    setCfRows,
    setStage,
    setCfMethod,
    setCfKeywordMethod,
    setTbMappedFileName,
    setCfMappedFileName,
  ]);

  useEffect(() => {
    if (!demoSuccessNotice) return;
    const id = window.setTimeout(() => setDemoSuccessNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [demoSuccessNotice]);

  const incompleteTbCategoryRows = useMemo(
    () => tbRows.filter((r) => isTbCoaMappingIncomplete(r)),
    [tbRows],
  );
  const hasIncompleteTbCategories = incompleteTbCategoryRows.length > 0;

  const handleContinueToStage3 = useCallback(() => {
    if (hasIncompleteTbCategories) {
      setStage2TbAdvanceHighlight(true);
      return;
    }
    setStage2TbAdvanceHighlight(false);
    setStage(3);
  }, [hasIncompleteTbCategories, setStage]);

  const cyNetCents = useMemo(
    () => tbRows.reduce((s, r) => s + toCents(r.cyBalance), 0),
    [tbRows],
  );
  const py1NetCents = useMemo(
    () => tbRows.reduce((s, r) => s + toCents(r.py1Balance), 0),
    [tbRows],
  );
  const tbHasPy2 = useMemo(
    () => tbRows.some((r) => r.py2Balance !== undefined),
    [tbRows],
  );
  const tbHasPy3 = useMemo(
    () => tbRows.some((r) => r.py3Balance !== undefined),
    [tbRows],
  );
  const py2NetCents = useMemo(
    () =>
      tbHasPy2
        ? tbRows.reduce((s, r) => s + toCents(r.py2Balance ?? 0), 0)
        : 0,
    [tbRows, tbHasPy2],
  );
  const py3NetCents = useMemo(
    () =>
      tbHasPy3
        ? tbRows.reduce((s, r) => s + toCents(r.py3Balance ?? 0), 0)
        : 0,
    [tbRows, tbHasPy3],
  );

  const cfHasPy2 = useMemo(
    () => cfRows.some((r) => r.py2Balance !== undefined),
    [cfRows],
  );
  const cfHasPy3 = useMemo(
    () => cfRows.some((r) => r.py3Balance !== undefined),
    [cfRows],
  );

  const cfStage2Partition = useMemo(() => {
    const beginningTagged = cfRows.filter(
      (r) => r.category === CF_BEGINNING_CATEGORY,
    );
    const endingTagged = cfRows.filter((r) => r.category === CF_ENDING_CATEGORY);
    const activity = cfRows.filter(
      (r) =>
        r.category !== CF_BEGINNING_CATEGORY &&
        r.category !== CF_ENDING_CATEGORY &&
        r.category !== "Supplemental / Non-Operating" &&
        !isExcludedFromScfActivitySum(r.lineItem),
    );
    const isOperating = (r: CashFlowReviewRow) =>
      CF_STAGE2_OPERATING_CATEGORIES.includes(r.category as CfReviewLineCategory);
    return {
      beginningTagged,
      endingTagged,
      operating: activity.filter(isOperating),
      investing: activity.filter((r) => r.category === "Investing Activities"),
      financing: activity.filter((r) => r.category === "Financing Activities"),
      supplemental: cfRows.filter(
        (r) => r.category === "Supplemental / Non-Operating",
      ),
      unclassified: activity.filter(
        (r) =>
          !isOperating(r) &&
          r.category !== "Investing Activities" &&
          r.category !== "Financing Activities",
      ),
    };
  }, [cfRows]);

  const cfTableColSpan = 4 + (cfHasPy2 ? 1 : 0) + (cfHasPy3 ? 1 : 0);
  const cfReviewFullRowColSpan = cfTableColSpan + 1;

  const cfNetChangeByCol = useMemo(() => {
    const p = cfStage2Partition;
    return {
      cy:
        cfSumCol(p.operating, "cy") +
        cfSumCol(p.investing, "cy") +
        cfSumCol(p.financing, "cy"),
      py1:
        cfSumCol(p.operating, "py1") +
        cfSumCol(p.investing, "py1") +
        cfSumCol(p.financing, "py1"),
      py2: cfHasPy2
        ? cfSumCol(p.operating, "py2") +
          cfSumCol(p.investing, "py2") +
          cfSumCol(p.financing, "py2")
        : undefined,
      py3: cfHasPy3
        ? cfSumCol(p.operating, "py3") +
          cfSumCol(p.investing, "py3") +
          cfSumCol(p.financing, "py3")
        : undefined,
    };
  }, [cfStage2Partition, cfHasPy2, cfHasPy3]);

  const cfCashTieOut = useMemo(
    () => evaluateCfCashTieOutToTrialBalance(tbRows, cfRows),
    [tbRows, cfRows],
  );

  const cfScfTieOut = useMemo(() => evaluateCfScfTieOut(cfRows), [cfRows]);

  const canFinalize =
    stage === 3 &&
    trialBalanceNetsExactlyZero(tbRows) &&
    !hasIncompleteTbCategories &&
    cfScfTieOut.ok;

  const canProceedFromIngestion = tbRows.length > 0 && cfRows.length > 0;

  const cfCategoryOptions = useMemo(() => [...CF_REVIEW_CATEGORIES], []);

  const handleTrialBalanceFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setTbError(null);
    setMappingError(null);
    try {
      const { headers, rows } = await fileToRawSheetTable(file);
      if (!headers.length) {
        setTbError("Could not read any column headers from the first row.");
        return;
      }
      setMapSession({
        kind: "tb",
        fileName: file.name,
        headers,
        rows,
        selection: { ...emptyTbColumnSelection(), ...guessTbMapping(headers) },
      });
    } catch (e) {
      setTbError(
        e instanceof Error ? e.message : "Could not read the workbook.",
      );
    }
  }, []);

  const handleCashFlowFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setCfError(null);
    setMappingError(null);
    setCfKeywordMethod(null);
    try {
      const { headers, rows } = await fileToRawSheetTable(file);
      if (!headers.length) {
        setCfError("Could not read any column headers from the first row.");
        return;
      }
      setMapSession({
        kind: "cf",
        fileName: file.name,
        headers,
        rows,
        selection: { ...emptyCfColumnSelection(), ...guessCfMapping(headers) },
      });
    } catch (e) {
      setCfError(
        e instanceof Error ? e.message : "Could not read the workbook.",
      );
    }
  }, []);

  const loadDemoFiles = useCallback(async () => {
    if (mapSession !== null || demoFilesLoading) return;
    pendingDemoCfAfterTbConfirmRef.current = null;
    setTbError(null);
    setCfError(null);
    setMappingError(null);
    setDemoSuccessNotice(null);
    setDemoFilesLoading(true);
    try {
      const [tbRes, cfRes] = await Promise.all([
        fetch(DEMO_TB_URL),
        fetch(DEMO_CF_URL),
      ]);
      if (!tbRes.ok) {
        setTbError(
          `Could not load demo trial balance (HTTP ${tbRes.status}). Is ${DEMO_TB_URL} in /public?`,
        );
        return;
      }
      if (!cfRes.ok) {
        setCfError(
          `Could not load demo cash flow (HTTP ${cfRes.status}). Is ${DEMO_CF_URL} in /public?`,
        );
        return;
      }
      const [tbBuf, cfBuf] = await Promise.all([
        tbRes.arrayBuffer(),
        cfRes.arrayBuffer(),
      ]);
      const tbTable = await arrayBufferToRawSheetTable(tbBuf, DEMO_TB_FILE_LABEL);
      const cfTable = await arrayBufferToRawSheetTable(cfBuf, DEMO_CF_FILE_LABEL);
      if (!tbTable.headers.length) {
        setTbError("Demo trial balance has no column headers in the first row.");
        return;
      }
      if (!cfTable.headers.length) {
        setCfError("Demo cash flow has no column headers in the first row.");
        return;
      }
      const tbSelection = {
        ...emptyTbColumnSelection(),
        ...guessTbMapping(tbTable.headers),
      };
      const tbMapErr = validateTbMapping(tbTable.headers, tbSelection);
      if (tbMapErr) {
        pendingDemoCfAfterTbConfirmRef.current = {
          fileName: DEMO_CF_FILE_LABEL,
          headers: cfTable.headers,
          rows: cfTable.rows,
        };
        setMapSession({
          kind: "tb",
          fileName: DEMO_TB_FILE_LABEL,
          headers: tbTable.headers,
          rows: tbTable.rows,
          selection: tbSelection,
        });
        setMappingError(tbMapErr);
        return;
      }
      const tbBuilt = transformTbWithColumnMap(tbTable.rows, tbSelection);
      if (!tbBuilt.length) {
        setTbError("No trial balance rows after mapping the demo file.");
        return;
      }
      setTbRows(tbBuilt);
      setTbMappedFileName(DEMO_TB_FILE_LABEL);

      const cfSelection = {
        ...emptyCfColumnSelection(),
        ...guessCfMapping(cfTable.headers),
      };
      const cfMapErr = validateCfMapping(cfTable.headers, cfSelection);
      if (cfMapErr) {
        setMapSession({
          kind: "cf",
          fileName: DEMO_CF_FILE_LABEL,
          headers: cfTable.headers,
          rows: cfTable.rows,
          selection: cfSelection,
        });
        setMappingError(cfMapErr);
        return;
      }
      const { rows: cfBuilt, method } = transformCfWithColumnMap(
        cfTable.rows,
        cfSelection,
      );
      if (!cfBuilt.length) {
        setCfError("No cash flow lines after mapping the demo file.");
        return;
      }
      setCfRows(cfBuilt);
      setCfMethod(method);
      setCfMappedFileName(DEMO_CF_FILE_LABEL);
      setCfKeywordMethod(
        detectCfKeywordPresentationMethod(cfBuilt.map((r) => r.lineItem)),
      );
      setIngestionReuploadDraftMode(false);
      setStage(2);
      setDemoSuccessNotice(
        "Demo trial balance and cash flow are loaded. You are on step 2 — review mapping.",
      );
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not load demo workbooks.";
      setTbError(msg);
      setCfError(msg);
    } finally {
      setDemoFilesLoading(false);
    }
  }, [
    mapSession,
    demoFilesLoading,
    setTbRows,
    setTbMappedFileName,
    setCfRows,
    setCfMethod,
    setCfMappedFileName,
    setCfKeywordMethod,
    setIngestionReuploadDraftMode,
    setStage,
  ]);

  const updateMapTbSelection = useCallback((sel: TbColumnSelection) => {
    setMapSession((m) => (m?.kind === "tb" ? { ...m, selection: sel } : m));
  }, []);

  const updateMapCfSelection = useCallback((sel: CfColumnSelection) => {
    setMapSession((m) => (m?.kind === "cf" ? { ...m, selection: sel } : m));
  }, []);

  const cancelColumnMapping = useCallback(() => {
    pendingDemoCfAfterTbConfirmRef.current = null;
    setMapSession(null);
    setMappingError(null);
  }, []);

  const confirmColumnMapping = useCallback(() => {
    if (!mapSession) return;
    setMappingError(null);
    if (mapSession.kind === "tb") {
      const err = validateTbMapping(mapSession.headers, mapSession.selection);
      if (err) {
        setMappingError(err);
        return;
      }
      const built = transformTbWithColumnMap(
        mapSession.rows,
        mapSession.selection,
      );
      if (!built.length) {
        setMappingError(
          "No data rows after mapping. Check column choices and file content.",
        );
        return;
      }
      setTbRows(built);
      setTbMappedFileName(mapSession.fileName);
      const demoCfPack = pendingDemoCfAfterTbConfirmRef.current;
      if (demoCfPack) {
        pendingDemoCfAfterTbConfirmRef.current = null;
        const cfSelection = {
          ...emptyCfColumnSelection(),
          ...guessCfMapping(demoCfPack.headers),
        };
        const cfErr = validateCfMapping(demoCfPack.headers, cfSelection);
        if (cfErr) {
          setMapSession({
            kind: "cf",
            fileName: demoCfPack.fileName,
            headers: demoCfPack.headers,
            rows: demoCfPack.rows,
            selection: cfSelection,
          });
          setMappingError(cfErr);
          return;
        }
        const { rows: cfBuilt, method } = transformCfWithColumnMap(
          demoCfPack.rows,
          cfSelection,
        );
        if (!cfBuilt.length) {
          setMappingError(
            "No cash flow lines after mapping. Check column choices and file content.",
          );
          return;
        }
        setCfRows(cfBuilt);
        setCfMethod(method);
        setCfMappedFileName(demoCfPack.fileName);
        setCfKeywordMethod(
          detectCfKeywordPresentationMethod(cfBuilt.map((r) => r.lineItem)),
        );
        setMapSession(null);
        setIngestionReuploadDraftMode(false);
        setStage(2);
        setDemoSuccessNotice(
          "Demo trial balance and cash flow are loaded. You are on step 2 — review mapping.",
        );
        return;
      }
      setMapSession(null);
      return;
    }
    const err = validateCfMapping(mapSession.headers, mapSession.selection);
    if (err) {
      setMappingError(err);
      return;
    }
    const { rows, method } = transformCfWithColumnMap(
      mapSession.rows,
      mapSession.selection,
    );
    if (!rows.length) {
      setMappingError(
        "No cash flow lines after mapping. Check column choices and file content.",
      );
      return;
    }
    setCfRows(rows);
    setCfMethod(method);
    setCfMappedFileName(mapSession.fileName);
    setCfKeywordMethod(
      detectCfKeywordPresentationMethod(rows.map((r) => r.lineItem)),
    );
    setMapSession(null);
  }, [
    mapSession,
    setTbRows,
    setTbMappedFileName,
    setCfRows,
    setCfMethod,
    setCfMappedFileName,
    setCfKeywordMethod,
    setIngestionReuploadDraftMode,
    setStage,
  ]);

  const updateTbCoaLevel = useCallback(
    (id: string, level: 1 | 2 | 3, value: string) => {
      setTbRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          let next: TrialBalanceReviewRow = { ...r };
          if (level === 1) {
            next = {
              ...next,
              categoryL1: value,
              categoryL2: "",
              categoryL3: "",
            };
          } else if (level === 2) {
            next = {
              ...next,
              categoryL2: value,
              categoryL3: "",
            };
          } else {
            next =
              next.categoryL1 === "Equity"
                ? { ...next, categoryL3: "" }
                : { ...next, categoryL3: value };
          }
          return {
            ...next,
            gaapCategory: deriveLegacyGaapCategory(next),
          };
        }),
      );
    },
    [],
  );

  /**
   * Primary way to bulk-populate L1–L3 from the model (mapped via `resolveAiCoaLevels`).
   * Suggestions are written into `ingestionTbRows` (Stage 2 dropdown state); the user can
   * override any value manually after each run.
   */
  const handleSmartAiCategorize = useCallback(async () => {
    if (tbRows.length === 0) return;
    setAiCategorizeLoading(true);
    setAiCategorizeError(null);
    try {
      const accounts = tbRows
        .map((r) => r.accountName.trim())
        .filter((name) => name.length > 0);
      if (accounts.length === 0) {
        setAiCategorizeError("No account names to categorize.");
        return;
      }

      const applySuggestionMap = (suggestions: Map<string, AiCategorizeRow>) => {
        setTbRows((prev) =>
          prev.map((r) => {
            const key = r.accountName.trim().toLowerCase();
            const sug = suggestions.get(key);
            if (!sug) return r;
            const { categoryL1, categoryL2, categoryL3 } = resolveAiCoaLevels(
              sug.L1,
              sug.L2,
              sug.L3,
            );
            const next: TrialBalanceReviewRow = {
              ...r,
              categoryL1,
              categoryL2,
              categoryL3,
              gaapCategory: deriveLegacyGaapCategory({
                categoryL1,
                categoryL2,
                categoryL3,
              }),
            };
            return next;
          }),
        );
      };

      const suggestions = new Map<string, AiCategorizeRow>();

      for (let i = 0; i < tbRows.length; i += AI_CATEGORIZE_BATCH_SIZE) {
        const chunkRows = tbRows.slice(i, i + AI_CATEGORIZE_BATCH_SIZE);
        const tbLines = chunkRows.map((r) => ({
          accountNumber: r.accountNumber.trim() || "—",
          accountName: r.accountName.trim(),
        }));
        const chunkNames = tbLines
          .map((l) => l.accountName)
          .filter((name) => name.length > 0);
        if (chunkNames.length === 0) continue;

        const dataToSend = {
          mode: "categorize" as const,
          prompt: chunkNames.join("\n"),
          tbLines,
        };

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dataToSend),
        });

        const resBody = await res.text();
        let data: unknown = null;
        try {
          data = resBody.trim() ? parseResponseJsonSafely(resBody) : null;
        } catch {
          data = {
            error:
              resBody.trim().slice(0, 400) ||
              "Response was not valid JSON (check /api/chat route or network).",
          };
        }

        if (!res.ok && isAiLimitReachedResponse(res, data)) {
          applySuggestionMap(suggestions);
          setAiCategorizeError(AI_LIMIT_PARTIAL_MESSAGE);
          return;
        }

        if (!res.ok) {
          applySuggestionMap(suggestions);
          throw new Error(parseChatApiErrorMessage(data, res));
        }

        if (!Array.isArray(data)) {
          applySuggestionMap(suggestions);
          throw new Error("Invalid response from AI categorization.");
        }

        mergeCategorizeArrayIntoMap(suggestions, data);
      }

      applySuggestionMap(suggestions);
    } catch (e) {
      setAiCategorizeError(
        e instanceof Error ? e.message : "Smart AI categorize failed.",
      );
    } finally {
      setAiCategorizeLoading(false);
    }
  }, [tbRows, setTbRows]);

  const updateCfCategory = useCallback((id: string, category: string) => {
    setCfRows((prev) => prev.map((r) => (r.id === id ? { ...r, category } : r)));
  }, []);

  const updateTbAmount = useCallback(
    (
      id: string,
      field: "cyBalance" | "py1Balance" | "py2Balance" | "py3Balance",
      next: number,
    ) => {
      setTbRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: next } : r)),
      );
    },
    [setTbRows],
  );

  const updateCfAmount = useCallback(
    (
      id: string,
      field: "cyBalance" | "py1Balance" | "py2Balance" | "py3Balance",
      next: number,
    ) => {
      setCfRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: next } : r)),
      );
    },
    [setCfRows],
  );

  /** Removes a mapped review row by stable id (index is unsafe for partitioned cash flow sections). */
  const removeRowFromReview = useCallback((type: "tb" | "cf", rowId: string) => {
    if (type === "tb") {
      setTbRows((prev) => prev.filter((r) => r.id !== rowId));
    } else {
      setCfRows((prev) => prev.filter((r) => r.id !== rowId));
    }
  }, []);

  const handleFinalize = useCallback(() => {
    if (!canFinalize) return;
    finalizeMemoryBankIngest({
      trialBalance: tbRows.map(toLedgerTrialBalance),
      cashFlow: cfRows.map(toLedgerCashFlow),
      cfStatementMethod: cfMethod,
      ingestionWorkpaperSnapshot: { tbRows, cfRows },
    });
    router.push("/materiality");
  }, [canFinalize, cfMethod, cfRows, finalizeMemoryBankIngest, router, tbRows]);

  const handleReuploadFiles = useCallback(() => {
    if (
      !window.confirm(
        "Return to upload new files? Your current trial balance and cash flow workpapers stay saved until you confirm a replacement in the column mapper. You can cancel the mapper to keep existing data. Replacing only one file leaves the other dataset unchanged.",
      )
    ) {
      return;
    }
    setIngestionReuploadDraftMode(true);
    setStage(1);
    setStage2TbAdvanceHighlight(false);
    pendingDemoCfAfterTbConfirmRef.current = null;
    setMapSession(null);
    setMappingError(null);
    setTbError(null);
    setCfError(null);
  }, [setIngestionReuploadDraftMode, setStage]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 pb-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          Module 01 · Data ingestion
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Data Ingestion & Integrity
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-400">
          Multi-format trial balance and cash flow ingestion (CSV or Excel),
          flexible column mapping to your headers, manual chart-of-accounts
          tagging in review, and an audit-locked net-to-zero gate.
        </p>

        <ol className="flex flex-wrap gap-2 pt-2 text-[11px] font-medium text-slate-500 sm:gap-3 sm:text-xs">
          {[
            { n: 1, label: "1. Upload Data" },
            { n: 2, label: "2. Review Mapping" },
            { n: 3, label: "3. Finalize & Lock" },
          ].map((s) => (
            <li
              key={s.n}
              className={[
                "inline-flex items-center rounded-full px-2.5 py-1 ring-1 sm:px-3",
                stage === s.n
                  ? "bg-cyan-500/10 text-cyan-200 ring-cyan-400/30"
                  : stage > s.n
                    ? "bg-slate-800/60 text-slate-300 ring-white/10"
                    : "bg-slate-900/40 text-slate-500 ring-slate-800",
              ].join(" ")}
            >
              {s.label}
            </li>
          ))}
        </ol>
      </header>

      {demoSuccessNotice ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-500/35 bg-emerald-950/25 px-4 py-3 text-sm leading-relaxed text-emerald-100 ring-1 ring-emerald-500/15"
        >
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300"
            aria-hidden
          />
          <span>{demoSuccessNotice}</span>
        </div>
      ) : null}

      {stage === 1 ? (
        <section className="flex flex-col gap-8">
          {ingestionReuploadDraftMode ? (
            <div className="flex flex-col gap-2 rounded-xl border border-cyan-500/25 bg-cyan-950/15 px-4 py-3 ring-1 ring-cyan-500/15 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200/95">
                  Current Data Cached
                </span>
                <p className="text-xs leading-relaxed text-cyan-100/85">
                  Prior workpapers and Memory Bank imports stay in place until you
                  confirm a new file. Cancel the mapper anytime to keep what you
                  have. Updating only trial balance or only cash flow does not touch
                  the other dataset.
                </p>
              </div>
            </div>
          ) : null}
          {mapSession ? (
            <IngestionColumnMapper
              variant={mapSession.kind}
              fileName={mapSession.fileName}
              headers={mapSession.headers}
              previewRows={mapSession.rows.slice(0, 5)}
              totalDataRows={mapSession.rows.length}
              error={mappingError}
              tbSelection={
                mapSession.kind === "tb"
                  ? mapSession.selection
                  : emptyTbColumnSelection()
              }
              cfSelection={
                mapSession.kind === "cf"
                  ? mapSession.selection
                  : emptyCfColumnSelection()
              }
              onTbSelectionChange={updateMapTbSelection}
              onCfSelectionChange={updateMapCfSelection}
              onConfirm={confirmColumnMapping}
              onCancel={cancelColumnMapping}
            />
          ) : (
          <>
          <div className="grid w-full grid-cols-2 items-stretch gap-4 sm:gap-8">
            <div className="flex w-full min-h-0 min-w-0 flex-col gap-3 bg-transparent">
              <h2 className="text-sm font-semibold text-white">
                Upload trial balance
              </h2>
              <input
                ref={tbInputRef}
                type="file"
                accept={ACCEPT_FILES}
                className="sr-only"
                onChange={(e) => {
                  void handleTrialBalanceFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") tbInputRef.current?.click();
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setTbDrag(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setTbDrag(false);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  setTbDrag(false);
                  void handleTrialBalanceFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => tbInputRef.current?.click()}
                className={[
                  "flex h-72 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-600/55 bg-slate-900/50 px-4 text-center shadow-inner ring-1 ring-slate-700/40 transition-colors",
                  tbDrag
                    ? "border-cyan-400/45 bg-cyan-500/[0.07] ring-cyan-900/30"
                    : "hover:border-cyan-500/35 hover:bg-slate-900/65 hover:ring-slate-600/35",
                ].join(" ")}
              >
                <div className="flex w-full max-w-md flex-col items-center justify-center space-y-4 bg-transparent px-2 text-center">
                  <UploadCloud
                    className="h-8 w-8 shrink-0 text-cyan-300"
                    strokeWidth={1.5}
                  />
                  <p className="w-full text-base font-semibold tracking-tight text-white">
                    Trial Balance
                  </p>
                  <p className={DROPZONE_SUBTEXT_CLASS}>
                    Drag and drop your file, or click to browse. Supports CSV and
                    Excel.
                  </p>
                  <span className="inline-flex w-full max-w-[220px] items-center justify-center gap-2 rounded-lg border border-slate-600/50 bg-transparent px-3 py-2 text-xs font-medium text-slate-200 ring-1 ring-slate-600/40 pointer-events-none">
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-cyan-200" />
                    Select file
                  </span>
                  {tbRows.length > 0 ? (
                    <div className="flex max-w-full flex-col items-center gap-1 pt-0.5 text-center">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                        <CheckCircle2
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden
                        />
                        File ready
                      </span>
                      {tbMappedFileName ? (
                        <p
                          className="max-w-full truncate px-1 font-mono text-[11px] text-slate-400"
                          title={tbMappedFileName}
                        >
                          {tbMappedFileName}
                        </p>
                      ) : null}
                      <p className="text-[11px] text-slate-500">
                        {tbRows.length} row{tbRows.length === 1 ? "" : "s"} in
                        ledger
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
              {tbError ? (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {tbError}
                </div>
              ) : null}
            </div>

            <div className="flex w-full min-h-0 min-w-0 flex-col gap-3 bg-transparent">
              <h2 className="text-sm font-semibold text-white">
                Upload cash flow statement
              </h2>
              <input
                ref={cfInputRef}
                type="file"
                accept={ACCEPT_FILES}
                className="sr-only"
                onChange={(e) => {
                  void handleCashFlowFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") cfInputRef.current?.click();
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setCfDrag(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setCfDrag(false);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  setCfDrag(false);
                  void handleCashFlowFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => cfInputRef.current?.click()}
                className={[
                  "flex h-72 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-600/55 bg-slate-900/50 px-4 text-center shadow-inner ring-1 ring-slate-700/40 transition-colors",
                  cfDrag
                    ? "border-indigo-400/45 bg-indigo-500/[0.07] ring-indigo-900/35"
                    : "hover:border-indigo-400/35 hover:bg-slate-900/65 hover:ring-slate-600/35",
                ].join(" ")}
              >
                <div className="flex w-full max-w-md flex-col items-center justify-center space-y-4 bg-transparent px-2 text-center">
                  <UploadCloud
                    className="h-8 w-8 shrink-0 text-indigo-200"
                    strokeWidth={1.5}
                  />
                  <p className="w-full text-base font-semibold tracking-tight text-white">
                    Cash Flow Statement
                  </p>
                  <p className={DROPZONE_SUBTEXT_CLASS}>
                    Drag and drop your file, or click to browse. Supports CSV and
                    Excel.
                  </p>
                  <span className="inline-flex w-full max-w-[220px] items-center justify-center gap-2 rounded-lg border border-slate-600/50 bg-transparent px-3 py-2 text-xs font-medium text-slate-200 ring-1 ring-slate-600/40 pointer-events-none">
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-indigo-200" />
                    Select file
                  </span>
                  {cfRows.length > 0 ? (
                    <div className="flex max-w-full flex-col items-center gap-1 pt-0.5 text-center">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                        <CheckCircle2
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden
                        />
                        File ready
                      </span>
                      {cfMappedFileName ? (
                        <p
                          className="max-w-full truncate px-1 font-mono text-[11px] text-slate-400"
                          title={cfMappedFileName}
                        >
                          {cfMappedFileName}
                        </p>
                      ) : null}
                      <p className="text-[11px] text-slate-500">
                        {cfRows.length} line{cfRows.length === 1 ? "" : "s"} ·{" "}
                        <span className="text-slate-400">
                          {cfMethod ?? "—"}
                        </span>
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
              {cfError ? (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {cfError}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-700/50 bg-slate-900/35 px-4 py-5 ring-1 ring-white/5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-slate-200">
                {"Don't have a Trial Balance handy?"}
              </p>
              <p className="text-xs leading-relaxed text-slate-500">
                Load our paired demo trial balance and cash flow Excel files to
                explore the workflow without uploading your own spreadsheets.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadDemoFiles()}
              disabled={demoFilesLoading}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-950/40 px-4 py-2.5 text-sm font-semibold text-amber-100 shadow-sm ring-1 ring-amber-500/20 transition hover:border-amber-400/50 hover:bg-amber-900/45 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {demoFilesLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <FileSpreadsheet className="h-4 w-4 text-amber-200/95" aria-hidden />
              )}
              Load Demo Excel Files
            </button>
          </div>
          </>
          )}

          {!mapSession ? (
          <div className="w-full">
            <button
              type="button"
              disabled={!canProceedFromIngestion}
              onClick={() => {
                setIngestionReuploadDraftMode(false);
                setStage(2);
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/90 bg-slate-800/50 py-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-500/40 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-8"
            >
              Continue to review mapping
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            {!canProceedFromIngestion ? (
              <p className="mt-2 text-center text-xs text-slate-500 sm:text-left">
                Map and confirm both files (column mapper), then continue.
              </p>
            ) : null}
          </div>
          ) : null}
        </section>
      ) : null}

      {stage >= 2 ? (
        <section className="flex flex-col gap-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              2. Review Mapping
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              Confirm trial balance chart-of-accounts mapping and cash flow line
              labels before you finalize.
            </p>
          </div>

          <div className="flex gap-1 rounded-xl border border-slate-800/90 bg-slate-900/40 p-1 ring-1 ring-white/5">
            <button
              type="button"
              onClick={() => setReviewTab("tb")}
              className={[
                "flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm",
                reviewTab === "tb"
                  ? "bg-slate-800 text-white shadow ring-1 ring-white/10"
                  : "text-slate-400 hover:text-slate-200",
              ].join(" ")}
            >
              Trial balance ({tbRows.length})
            </button>
            <button
              type="button"
              onClick={() => setReviewTab("cf")}
              className={[
                "flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm",
                reviewTab === "cf"
                  ? "bg-slate-800 text-white shadow ring-1 ring-white/10"
                  : "text-slate-400 hover:text-slate-200",
              ].join(" ")}
            >
              Cash flow ({cfRows.length})
            </button>
          </div>

          {reviewTab === "tb" && tbRows.length > 0 ? (
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                disabled={aiCategorizeLoading}
                onClick={() => void handleSmartAiCategorize()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-500/40 bg-violet-950/35 px-3 py-2 text-xs font-semibold text-violet-100 shadow-sm ring-1 ring-violet-400/20 transition hover:border-violet-400/55 hover:bg-violet-900/40 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
              >
                {aiCategorizeLoading ? (
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin text-violet-200"
                    aria-hidden
                  />
                ) : (
                  <Sparkles className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
                )}
                <span>Smart AI Categorize</span>
              </button>
              {aiCategorizeError ? (
                <p className="text-xs text-rose-400 sm:text-right">{aiCategorizeError}</p>
              ) : null}
            </div>
          ) : null}

          {reviewTab === "tb" ? (
            <div className="overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/30 shadow-xl ring-1 ring-white/5">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Account #</th>
                      <th className="px-4 py-3 font-medium">Account name</th>
                      <th className="px-4 py-3 text-right font-medium">CY</th>
                      <th className="px-4 py-3 text-right font-medium">PY1</th>
                      {tbHasPy2 ? (
                        <th className="px-4 py-3 text-right font-medium">PY2</th>
                      ) : null}
                      {tbHasPy3 ? (
                        <th className="px-4 py-3 text-right font-medium">PY3</th>
                      ) : null}
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className={STAGE2_REVIEW_ACTIONS_TH}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200">
                    {tbRows.map((row) => {
                      const l2opts = row.categoryL1
                        ? getCoaLevel2Options(row.categoryL1)
                        : [];
                      const l3opts =
                        row.categoryL1 && row.categoryL2
                          ? getCoaLevel3Options(row.categoryL1, row.categoryL2)
                          : [];
                      const showL2 = Boolean(row.categoryL1 && l2opts.length);
                      const showL3 = Boolean(row.categoryL2 && l3opts.length);
                      const mappingIncomplete = isTbCoaMappingIncomplete(row);
                      const categorized = isFullyCategorized(row);
                      const showTbAdvanceError =
                        stage2TbAdvanceHighlight &&
                        hasIncompleteTbCategories &&
                        mappingIncomplete;

                      return (
                      <tr
                        key={row.id}
                        className={[
                          "group",
                          showTbAdvanceError
                            ? "bg-rose-600/[0.22] ring-1 ring-inset ring-rose-500/40"
                            : categorized
                              ? "bg-sky-500/10"
                              : "bg-transparent",
                        ].join(" ")}
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-300">
                          {row.accountNumber}
                        </td>
                        <td className="max-w-[220px] px-4 py-2.5 text-slate-100">
                          {row.accountName}
                        </td>
                        <td className="px-2 py-1.5 text-right align-middle">
                          <Stage2AmountInput
                            value={row.cyBalance}
                            onChange={(n) => updateTbAmount(row.id, "cyBalance", n)}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right align-middle">
                          <Stage2AmountInput
                            value={row.py1Balance}
                            onChange={(n) => updateTbAmount(row.id, "py1Balance", n)}
                          />
                        </td>
                        {tbHasPy2 ? (
                          <td className="px-2 py-1.5 text-right align-middle">
                            <Stage2AmountInput
                              value={row.py2Balance ?? 0}
                              onChange={(n) =>
                                updateTbAmount(row.id, "py2Balance", n)
                              }
                              textClassName="text-slate-300"
                            />
                          </td>
                        ) : null}
                        {tbHasPy3 ? (
                          <td className="px-2 py-1.5 text-right align-middle">
                            <Stage2AmountInput
                              value={row.py3Balance ?? 0}
                              onChange={(n) =>
                                updateTbAmount(row.id, "py3Balance", n)
                              }
                              textClassName="text-slate-300"
                            />
                          </td>
                        ) : null}
                        <td className="min-w-[12rem] max-w-xl px-3 py-2 align-top">
                          <div className="flex flex-wrap items-center gap-1">
                            <select
                              aria-label="Category level 1"
                              value={row.categoryL1}
                              onChange={(e) =>
                                updateTbCoaLevel(row.id, 1, e.target.value)
                              }
                              className={STAGE2_COA_SELECT_CLASS}
                            >
                              <option value="">Select category</option>
                              {COA_LEVEL1_KEYS.map((k) => (
                                <option key={k} value={k}>
                                  {k}
                                </option>
                              ))}
                            </select>
                            {showL2 ? (
                              <select
                                aria-label="Category level 2"
                                value={row.categoryL2}
                                onChange={(e) =>
                                  updateTbCoaLevel(row.id, 2, e.target.value)
                                }
                                className={STAGE2_COA_SELECT_CLASS}
                              >
                                <option value="">Select…</option>
                                {l2opts.map((k) => (
                                  <option key={k} value={k}>
                                    {k}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            {showL3 ? (
                              <select
                                aria-label="Category level 3"
                                value={row.categoryL3}
                                onChange={(e) =>
                                  updateTbCoaLevel(row.id, 3, e.target.value)
                                }
                                className={STAGE2_COA_SELECT_CLASS}
                              >
                                <option value="">Select…</option>
                                {l3opts.map((k) => (
                                  <option key={k} value={k}>
                                    {k}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                          </div>
                        </td>
                        <td className={STAGE2_REVIEW_TB_ACTIONS_TD}>
                          <button
                            type="button"
                            onClick={() => removeRowFromReview("tb", row.id)}
                            className={STAGE2_REVIEW_DELETE_BTN}
                            title="Remove this account from the review"
                            aria-label={`Remove trial balance row ${row.accountName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                {cfRows.length > 0 ? (
                  <div className="flex justify-start">
                    {cfKeywordMethod === "Indirect" ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-200/95 ring-1 ring-emerald-400/20">
                        Indirect Method Detected
                      </span>
                    ) : cfKeywordMethod === "Direct" ? (
                      <span className="inline-flex items-center rounded-full border border-indigo-500/35 bg-indigo-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-200/95 ring-1 ring-indigo-400/20">
                        Direct Method Detected
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-slate-600/80 bg-slate-800/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 ring-1 ring-white/10">
                        Detecting format…
                      </span>
                    )}
                  </div>
                ) : null}
                <p className="text-left text-[11px] leading-relaxed text-slate-500">
                  Tag beginning and ending cash using the category column, then
                  operating (net income, non-cash, working capital), investing, and
                  financing. Changing a category moves the line immediately.
                  Supplemental lines sit below the roll-forward and are excluded from
                  net change and variance.
                </p>
              </div>

              {cfRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700/90 bg-slate-950/30 px-4 py-10 text-center text-xs text-slate-500">
                  Upload and map a cash flow file to populate this reconciliation.
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/30 shadow-xl ring-1 ring-white/5">
                  <div className="overflow-x-auto">
                    <table className="min-w-[760px] w-full text-left text-sm text-slate-200">
                      <thead className="bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-4 py-3 font-medium">Description</th>
                          <th className="px-4 py-3 text-right font-medium">CY</th>
                          <th className="px-4 py-3 text-right font-medium">PY1</th>
                          {cfHasPy2 ? (
                            <th className="px-4 py-3 text-right font-medium">PY2</th>
                          ) : null}
                          {cfHasPy3 ? (
                            <th className="px-4 py-3 text-right font-medium">PY3</th>
                          ) : null}
                          <th className="px-4 py-3 font-medium">Category</th>
                          <th className={STAGE2_REVIEW_ACTIONS_TH}>Actions</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-800/70">
                        <tr className="bg-slate-900/85">
                          <td
                            colSpan={cfReviewFullRowColSpan}
                            className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-100"
                          >
                            Beginning cash balance
                          </td>
                        </tr>
                        {cfStage2Partition.beginningTagged.length === 0 ? (
                          <tr className="bg-slate-950/30">
                            <td
                              colSpan={cfReviewFullRowColSpan}
                              className="px-4 py-3 text-xs italic text-slate-500"
                            >
                              No lines tagged yet — set category to &quot;Beginning
                              Cash Balance&quot; for the opening cash row(s).
                            </td>
                          </tr>
                        ) : (
                          cfStage2Partition.beginningTagged.map((row) => (
                            <tr key={row.id} className="group bg-slate-950/25">
                              <td className="px-4 py-2.5 font-medium text-slate-100">
                                {row.lineItem}
                              </td>
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.cyBalance}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "cyBalance", n)
                                  }
                                />
                              </td>
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.py1Balance}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "py1Balance", n)
                                  }
                                />
                              </td>
                              {cfHasPy2 ? (
                                <td className="px-2 py-1.5 text-right align-middle">
                                  <Stage2AmountInput
                                    value={row.py2Balance ?? 0}
                                    onChange={(n) =>
                                      updateCfAmount(row.id, "py2Balance", n)
                                    }
                                    textClassName="text-slate-300"
                                  />
                                </td>
                              ) : null}
                              {cfHasPy3 ? (
                                <td className="px-2 py-1.5 text-right align-middle">
                                  <Stage2AmountInput
                                    value={row.py3Balance ?? 0}
                                    onChange={(n) =>
                                      updateCfAmount(row.id, "py3Balance", n)
                                    }
                                    textClassName="text-slate-300"
                                  />
                                </td>
                              ) : null}
                              <td className="px-4 py-2.5">
                                <select
                                  value={row.category}
                                  onChange={(e) =>
                                    updateCfCategory(row.id, e.target.value)
                                  }
                                  className="w-full max-w-[min(100%,280px)] rounded-lg border border-slate-700/90 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                                >
                                  {cfCategoryOptions.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className={stage2CfRowActionsCell("default")}>
                                <button
                                  type="button"
                                  onClick={() => removeRowFromReview("cf", row.id)}
                                  className={STAGE2_REVIEW_DELETE_BTN}
                                  title="Remove this line from the cash flow review"
                                  aria-label={`Remove cash flow line ${row.lineItem}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                        <tr aria-hidden className="pointer-events-none h-0">
                          <td
                            colSpan={cfReviewFullRowColSpan}
                            className="h-1 border-0 bg-slate-600 p-0"
                          />
                        </tr>
                      </tbody>

                      <tbody className="divide-y divide-slate-800/70">
                        <tr className="bg-slate-950/55">
                          <td
                            colSpan={cfReviewFullRowColSpan}
                            className="border-t-2 border-slate-600 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200/95"
                          >
                            Operating activities
                          </td>
                        </tr>
                        {cfStage2Partition.operating.map((row) => (
                          <tr key={row.id} className="group bg-slate-950/25">
                            <td className="px-4 py-2.5 font-medium text-slate-100">
                              {row.lineItem}
                            </td>
                            <td className="px-2 py-1.5 text-right align-middle">
                              <Stage2AmountInput
                                value={row.cyBalance}
                                onChange={(n) =>
                                  updateCfAmount(row.id, "cyBalance", n)
                                }
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right align-middle">
                              <Stage2AmountInput
                                value={row.py1Balance}
                                onChange={(n) =>
                                  updateCfAmount(row.id, "py1Balance", n)
                                }
                              />
                            </td>
                            {cfHasPy2 ? (
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.py2Balance ?? 0}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "py2Balance", n)
                                  }
                                  textClassName="text-slate-300"
                                />
                              </td>
                            ) : null}
                            {cfHasPy3 ? (
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.py3Balance ?? 0}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "py3Balance", n)
                                  }
                                  textClassName="text-slate-300"
                                />
                              </td>
                            ) : null}
                            <td className="px-4 py-2.5">
                              <select
                                value={row.category}
                                onChange={(e) =>
                                  updateCfCategory(row.id, e.target.value)
                                }
                                className="w-full max-w-[min(100%,280px)] rounded-lg border border-slate-700/90 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                              >
                                {cfCategoryOptions.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className={stage2CfRowActionsCell("default")}>
                              <button
                                type="button"
                                onClick={() => removeRowFromReview("cf", row.id)}
                                className={STAGE2_REVIEW_DELETE_BTN}
                                title="Remove this line from the cash flow review"
                                aria-label={`Remove cash flow line ${row.lineItem}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                              </button>
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t border-slate-600/90 bg-slate-950/50">
                          <td className="px-4 py-2.5 text-xs font-semibold text-slate-200">
                            Cash generated by (used in) operating activities
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-100">
                            {formatUsd(
                              cfSumCol(cfStage2Partition.operating, "cy"),
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-100">
                            {formatUsd(
                              cfSumCol(cfStage2Partition.operating, "py1"),
                            )}
                          </td>
                          {cfHasPy2 ? (
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-200">
                              {formatUsd(
                                cfSumCol(cfStage2Partition.operating, "py2"),
                              )}
                            </td>
                          ) : null}
                          {cfHasPy3 ? (
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-200">
                              {formatUsd(
                                cfSumCol(cfStage2Partition.operating, "py3"),
                              )}
                            </td>
                          ) : null}
                          <td className="bg-slate-950/50 px-4 py-2.5" />
                          <td className={stage2CfSubtotalActionsCell()} aria-hidden />
                        </tr>
                      </tbody>

                      <tbody className="divide-y divide-slate-800/70">
                        <tr className="bg-slate-950/55">
                          <td
                            colSpan={cfReviewFullRowColSpan}
                            className="border-t-4 border-slate-600 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200/95"
                          >
                            Investing activities
                          </td>
                        </tr>
                        {cfStage2Partition.investing.map((row) => (
                          <tr key={row.id} className="group bg-slate-950/25">
                            <td className="px-4 py-2.5 font-medium text-slate-100">
                              {row.lineItem}
                            </td>
                            <td className="px-2 py-1.5 text-right align-middle">
                              <Stage2AmountInput
                                value={row.cyBalance}
                                onChange={(n) =>
                                  updateCfAmount(row.id, "cyBalance", n)
                                }
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right align-middle">
                              <Stage2AmountInput
                                value={row.py1Balance}
                                onChange={(n) =>
                                  updateCfAmount(row.id, "py1Balance", n)
                                }
                              />
                            </td>
                            {cfHasPy2 ? (
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.py2Balance ?? 0}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "py2Balance", n)
                                  }
                                  textClassName="text-slate-300"
                                />
                              </td>
                            ) : null}
                            {cfHasPy3 ? (
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.py3Balance ?? 0}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "py3Balance", n)
                                  }
                                  textClassName="text-slate-300"
                                />
                              </td>
                            ) : null}
                            <td className="px-4 py-2.5">
                              <select
                                value={row.category}
                                onChange={(e) =>
                                  updateCfCategory(row.id, e.target.value)
                                }
                                className="w-full max-w-[min(100%,280px)] rounded-lg border border-slate-700/90 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                              >
                                {cfCategoryOptions.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className={stage2CfRowActionsCell("default")}>
                              <button
                                type="button"
                                onClick={() => removeRowFromReview("cf", row.id)}
                                className={STAGE2_REVIEW_DELETE_BTN}
                                title="Remove this line from the cash flow review"
                                aria-label={`Remove cash flow line ${row.lineItem}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                              </button>
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t border-slate-600/90 bg-slate-950/50">
                          <td className="px-4 py-2.5 text-xs font-semibold text-slate-200">
                            Cash generated by (used in) investing activities
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-100">
                            {formatUsd(
                              cfSumCol(cfStage2Partition.investing, "cy"),
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-100">
                            {formatUsd(
                              cfSumCol(cfStage2Partition.investing, "py1"),
                            )}
                          </td>
                          {cfHasPy2 ? (
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-200">
                              {formatUsd(
                                cfSumCol(cfStage2Partition.investing, "py2"),
                              )}
                            </td>
                          ) : null}
                          {cfHasPy3 ? (
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-200">
                              {formatUsd(
                                cfSumCol(cfStage2Partition.investing, "py3"),
                              )}
                            </td>
                          ) : null}
                          <td className="bg-slate-950/50 px-4 py-2.5" />
                          <td className={stage2CfSubtotalActionsCell()} aria-hidden />
                        </tr>
                      </tbody>

                      <tbody className="divide-y divide-slate-800/70">
                        <tr className="bg-slate-950/55">
                          <td
                            colSpan={cfReviewFullRowColSpan}
                            className="border-t-4 border-slate-600 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200/95"
                          >
                            Financing activities
                          </td>
                        </tr>
                        {cfStage2Partition.financing.map((row) => (
                          <tr key={row.id} className="group bg-slate-950/25">
                            <td className="px-4 py-2.5 font-medium text-slate-100">
                              {row.lineItem}
                            </td>
                            <td className="px-2 py-1.5 text-right align-middle">
                              <Stage2AmountInput
                                value={row.cyBalance}
                                onChange={(n) =>
                                  updateCfAmount(row.id, "cyBalance", n)
                                }
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right align-middle">
                              <Stage2AmountInput
                                value={row.py1Balance}
                                onChange={(n) =>
                                  updateCfAmount(row.id, "py1Balance", n)
                                }
                              />
                            </td>
                            {cfHasPy2 ? (
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.py2Balance ?? 0}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "py2Balance", n)
                                  }
                                  textClassName="text-slate-300"
                                />
                              </td>
                            ) : null}
                            {cfHasPy3 ? (
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.py3Balance ?? 0}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "py3Balance", n)
                                  }
                                  textClassName="text-slate-300"
                                />
                              </td>
                            ) : null}
                            <td className="px-4 py-2.5">
                              <select
                                value={row.category}
                                onChange={(e) =>
                                  updateCfCategory(row.id, e.target.value)
                                }
                                className="w-full max-w-[min(100%,280px)] rounded-lg border border-slate-700/90 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                              >
                                {cfCategoryOptions.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className={stage2CfRowActionsCell("default")}>
                              <button
                                type="button"
                                onClick={() => removeRowFromReview("cf", row.id)}
                                className={STAGE2_REVIEW_DELETE_BTN}
                                title="Remove this line from the cash flow review"
                                aria-label={`Remove cash flow line ${row.lineItem}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                              </button>
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t border-slate-600/90 bg-slate-950/50">
                          <td className="px-4 py-2.5 text-xs font-semibold text-slate-200">
                            Cash generated by (used in) financing activities
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-100">
                            {formatUsd(
                              cfSumCol(cfStage2Partition.financing, "cy"),
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-100">
                            {formatUsd(
                              cfSumCol(cfStage2Partition.financing, "py1"),
                            )}
                          </td>
                          {cfHasPy2 ? (
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-200">
                              {formatUsd(
                                cfSumCol(cfStage2Partition.financing, "py2"),
                              )}
                            </td>
                          ) : null}
                          {cfHasPy3 ? (
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-200">
                              {formatUsd(
                                cfSumCol(cfStage2Partition.financing, "py3"),
                              )}
                            </td>
                          ) : null}
                          <td className="bg-slate-950/50 px-4 py-2.5" />
                          <td className={stage2CfSubtotalActionsCell()} aria-hidden />
                        </tr>
                      </tbody>

                      {cfStage2Partition.unclassified.length > 0 ? (
                        <tbody className="divide-y divide-slate-800/70">
                          <tr className="bg-amber-950/25">
                            <td
                              colSpan={cfReviewFullRowColSpan}
                              className="border-t-4 border-amber-700/50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-200/95"
                            >
                              Uncategorized (excluded from net change — assign a
                              category)
                            </td>
                          </tr>
                          {cfStage2Partition.unclassified.map((row) => (
                            <tr key={row.id} className="group bg-amber-950/10">
                              <td className="px-4 py-2.5 font-medium text-slate-100">
                                {row.lineItem}
                              </td>
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.cyBalance}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "cyBalance", n)
                                  }
                                  textClassName="text-slate-200"
                                />
                              </td>
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.py1Balance}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "py1Balance", n)
                                  }
                                  textClassName="text-slate-200"
                                />
                              </td>
                              {cfHasPy2 ? (
                                <td className="px-2 py-1.5 text-right align-middle">
                                  <Stage2AmountInput
                                    value={row.py2Balance ?? 0}
                                    onChange={(n) =>
                                      updateCfAmount(row.id, "py2Balance", n)
                                    }
                                    textClassName="text-slate-300"
                                  />
                                </td>
                              ) : null}
                              {cfHasPy3 ? (
                                <td className="px-2 py-1.5 text-right align-middle">
                                  <Stage2AmountInput
                                    value={row.py3Balance ?? 0}
                                    onChange={(n) =>
                                      updateCfAmount(row.id, "py3Balance", n)
                                    }
                                    textClassName="text-slate-300"
                                  />
                                </td>
                              ) : null}
                              <td className="px-4 py-2.5">
                                <select
                                  value={row.category}
                                  onChange={(e) =>
                                    updateCfCategory(row.id, e.target.value)
                                  }
                                  className="w-full max-w-[min(100%,280px)] rounded-lg border border-amber-700/50 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20"
                                >
                                  {cfCategoryOptions.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className={stage2CfRowActionsCell("amber")}>
                                <button
                                  type="button"
                                  onClick={() => removeRowFromReview("cf", row.id)}
                                  className={STAGE2_REVIEW_DELETE_BTN}
                                  title="Remove this line from the cash flow review"
                                  aria-label={`Remove cash flow line ${row.lineItem}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      ) : null}

                      <tbody>
                        <tr className="group border-t-4 border-slate-500">
                          <td className="px-4 py-3.5 text-[13px] font-semibold underline decoration-double decoration-slate-100/90 underline-offset-[6px]">
                            Net increase / (decrease) in cash
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-sm font-semibold tabular-nums tracking-tight">
                            {formatUsd(cfNetChangeByCol.cy)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-sm font-semibold tabular-nums tracking-tight">
                            {formatUsd(cfNetChangeByCol.py1)}
                          </td>
                          {cfHasPy2 ? (
                            <td className="px-4 py-3.5 text-right font-mono text-sm font-semibold tabular-nums tracking-tight text-slate-100">
                              {formatUsd(cfNetChangeByCol.py2 ?? 0)}
                            </td>
                          ) : null}
                          {cfHasPy3 ? (
                            <td className="px-4 py-3.5 text-right font-mono text-sm font-semibold tabular-nums tracking-tight text-slate-100">
                              {formatUsd(cfNetChangeByCol.py3 ?? 0)}
                            </td>
                          ) : null}
                          <td className="px-4 py-3.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            Operating + investing + financing
                          </td>
                          <td className={stage2CfRowActionsCell("default")} aria-hidden />
                        </tr>
                      </tbody>

                      <tbody className="divide-y divide-slate-800/70">
                        <tr className="group">
                          <td
                            colSpan={cfReviewFullRowColSpan}
                            className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-200"
                          >
                            Ending cash balance
                          </td>
                        </tr>
                        {cfStage2Partition.endingTagged.length === 0 ? (
                          <tr className="bg-slate-950/30">
                            <td
                              colSpan={cfReviewFullRowColSpan}
                              className="px-4 py-3 text-xs italic text-slate-500"
                            >
                              No lines tagged yet — set category to &quot;Ending Cash
                              Balance&quot; for the closing cash row(s).
                            </td>
                          </tr>
                        ) : (
                          cfStage2Partition.endingTagged.map((row) => (
                            <tr key={row.id} className="group bg-slate-950/25">
                              <td className="px-4 py-2.5 font-medium text-slate-100">
                                {row.lineItem}
                              </td>
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.cyBalance}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "cyBalance", n)
                                  }
                                  textClassName="font-semibold text-slate-100"
                                />
                              </td>
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.py1Balance}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "py1Balance", n)
                                  }
                                  textClassName="font-semibold text-slate-100"
                                />
                              </td>
                              {cfHasPy2 ? (
                                <td className="px-2 py-1.5 text-right align-middle">
                                  <Stage2AmountInput
                                    value={row.py2Balance ?? 0}
                                    onChange={(n) =>
                                      updateCfAmount(row.id, "py2Balance", n)
                                    }
                                    textClassName="font-semibold text-slate-200"
                                  />
                                </td>
                              ) : null}
                              {cfHasPy3 ? (
                                <td className="px-2 py-1.5 text-right align-middle">
                                  <Stage2AmountInput
                                    value={row.py3Balance ?? 0}
                                    onChange={(n) =>
                                      updateCfAmount(row.id, "py3Balance", n)
                                    }
                                    textClassName="font-semibold text-slate-200"
                                  />
                                </td>
                              ) : null}
                              <td className="px-4 py-2.5">
                                <select
                                  value={row.category}
                                  onChange={(e) =>
                                    updateCfCategory(row.id, e.target.value)
                                  }
                                  className="w-full max-w-[min(100%,280px)] rounded-lg border border-slate-600/80 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                                >
                                  {cfCategoryOptions.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className={stage2CfRowActionsCell("ending")}>
                                <button
                                  type="button"
                                  onClick={() => removeRowFromReview("cf", row.id)}
                                  className={STAGE2_REVIEW_DELETE_BTN}
                                  title="Remove this line from the cash flow review"
                                  aria-label={`Remove cash flow line ${row.lineItem}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>

                      {cfStage2Partition.supplemental.length > 0 ? (
                        <tbody className="divide-y divide-slate-800/70">
                          <tr className="bg-slate-950/60">
                            <td
                              colSpan={cfReviewFullRowColSpan}
                              className="border-t-4 border-slate-700 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400"
                            >
                              Supplemental / non-operating (excluded from net change)
                            </td>
                          </tr>
                          {cfStage2Partition.supplemental.map((row) => (
                            <tr key={row.id} className="group bg-slate-950/20">
                              <td className="px-4 py-2.5 font-medium text-slate-200">
                                {row.lineItem}
                              </td>
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.cyBalance}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "cyBalance", n)
                                  }
                                  textClassName="text-slate-300"
                                />
                              </td>
                              <td className="px-2 py-1.5 text-right align-middle">
                                <Stage2AmountInput
                                  value={row.py1Balance}
                                  onChange={(n) =>
                                    updateCfAmount(row.id, "py1Balance", n)
                                  }
                                  textClassName="text-slate-300"
                                />
                              </td>
                              {cfHasPy2 ? (
                                <td className="px-2 py-1.5 text-right align-middle">
                                  <Stage2AmountInput
                                    value={row.py2Balance ?? 0}
                                    onChange={(n) =>
                                      updateCfAmount(row.id, "py2Balance", n)
                                    }
                                    textClassName="text-slate-400"
                                  />
                                </td>
                              ) : null}
                              {cfHasPy3 ? (
                                <td className="px-2 py-1.5 text-right align-middle">
                                  <Stage2AmountInput
                                    value={row.py3Balance ?? 0}
                                    onChange={(n) =>
                                      updateCfAmount(row.id, "py3Balance", n)
                                    }
                                    textClassName="text-slate-400"
                                  />
                                </td>
                              ) : null}
                              <td className="px-4 py-2.5">
                                <select
                                  value={row.category}
                                  onChange={(e) =>
                                    updateCfCategory(row.id, e.target.value)
                                  }
                                  className="w-full max-w-[min(100%,280px)] rounded-lg border border-slate-600/90 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-slate-400/50 focus:ring-2 focus:ring-slate-500/20"
                                >
                                  {cfCategoryOptions.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className={stage2CfRowActionsCell("supplemental")}>
                                <button
                                  type="button"
                                  onClick={() => removeRowFromReview("cf", row.id)}
                                  className={STAGE2_REVIEW_DELETE_BTN}
                                  title="Remove this line from the cash flow review"
                                  aria-label={`Remove cash flow line ${row.lineItem}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      ) : null}
                    </table>
                    <div className="border-t border-slate-700/90 bg-slate-950/60 px-4 py-3 text-xs text-slate-300">
                      <p className="font-semibold text-slate-200">
                        Roll-forward variance (Beginning + Operating + Investing +
                        Financing − Ending)
                      </p>
                      <div className="mt-2 grid gap-1 font-mono text-[11px] sm:grid-cols-2">
                        <p>
                          CY:{" "}
                          <span
                            className={
                              Math.abs(cfScfTieOut.signedResidualCentsByYear.cy ?? 0) <=
                              100
                                ? "text-emerald-300"
                                : "text-rose-300"
                            }
                          >
                            {formatUsd(
                              (cfScfTieOut.signedResidualCentsByYear.cy ?? 0) / 100,
                            )}
                          </span>
                        </p>
                        <p>
                          PY1:{" "}
                          <span
                            className={
                              Math.abs(
                                cfScfTieOut.signedResidualCentsByYear.py1 ?? 0,
                              ) <= 100
                                ? "text-emerald-300"
                                : "text-rose-300"
                            }
                          >
                            {formatUsd(
                              (cfScfTieOut.signedResidualCentsByYear.py1 ?? 0) / 100,
                            )}
                          </span>
                        </p>
                        {cfHasPy2 ? (
                          <p>
                            PY2:{" "}
                            <span
                              className={
                                Math.abs(
                                  cfScfTieOut.signedResidualCentsByYear.py2 ?? 0,
                                ) <= 100
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }
                            >
                              {formatUsd(
                                (cfScfTieOut.signedResidualCentsByYear.py2 ?? 0) /
                                  100,
                              )}
                            </span>
                          </p>
                        ) : null}
                        {cfHasPy3 ? (
                          <p>
                            PY3:{" "}
                            <span
                              className={
                                Math.abs(
                                  cfScfTieOut.signedResidualCentsByYear.py3 ?? 0,
                                ) <= 100
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }
                            >
                              {formatUsd(
                                (cfScfTieOut.signedResidualCentsByYear.py3 ?? 0) /
                                  100,
                              )}
                            </span>
                          </p>
                        ) : null}
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        Target $0.00 per period (±$1.00 tolerance). Largest absolute
                        gap:{" "}
                        <span className="font-mono text-slate-200">
                          {formatUsd(cfScfTieOut.maxVarianceDollars)}
                        </span>
                        .
                      </p>
                      {!cfScfTieOut.hasBeginningTag || !cfScfTieOut.hasEndingTag ? (
                        <p className="mt-2 text-[11px] text-amber-200/90">
                          Tag at least one line as Beginning Cash Balance and one as
                          Ending Cash Balance to complete the check.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {stage === 2 ? (
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
              <button
                type="button"
                onClick={handleContinueToStage3}
                className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-600/90 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-cyan-500/40 hover:bg-slate-800"
              >
                Continue to finalize & lock
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
              {stage2TbAdvanceHighlight && hasIncompleteTbCategories ? (
                <p className="text-xs text-rose-300 sm:max-w-md">
                  Every trial balance line needs a full category (L1; L2/L3 where the chart
                  requires them — Equity uses L2 only, no L3). Incomplete rows are highlighted
                  in red above.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {stage === 3 ? (
        <div className="flex w-full flex-col gap-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleReuploadFiles}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-transparent px-3 py-2 text-[11px] font-semibold text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            >
              <UploadCloud className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Re-upload files
            </button>
          </div>
          <section className="rounded-2xl border border-slate-800/90 bg-slate-900/35 p-6 shadow-lg ring-1 ring-white/5">
          <div className="mb-6 flex flex-wrap items-start gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/25">
                <ShieldCheck className="h-6 w-6 text-emerald-300" aria-hidden />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  3. Finalize & Lock
                </h2>
                <p className="text-xs text-slate-500">
                  Finalize when CY and PY1 each net to exactly $0.00 (and mapped
                  PY2/PY3 nets, if any), the cash flow roll-forward (Beginning +
                  Operating + Investing + Financing − Ending) clears to $0.00 per
                  period, the optional CF↔TB cross-check passes when identifiable,
                  and every trial balance row has a complete category mapping
                  (Assets and Liabilities require L2 and L3 where the chart defines
                  sub-levels; Equity requires L2 only with no L3; Revenue / COGS /
                  SG&A and similar may only need L1).
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-4 ring-1 ring-white/5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                CY net (trial balance)
              </p>
              <p
                className={[
                  "mt-1 font-mono text-2xl font-semibold tabular-nums",
                  cyNetCents === 0 ? "text-emerald-300" : "text-rose-300",
                ].join(" ")}
              >
                {formatUsd(cyNetCents / 100)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-4 ring-1 ring-white/5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                PY1 net (trial balance)
              </p>
              <p
                className={[
                  "mt-1 font-mono text-2xl font-semibold tabular-nums",
                  py1NetCents === 0 ? "text-emerald-300" : "text-rose-300",
                ].join(" ")}
              >
                {formatUsd(py1NetCents / 100)}
              </p>
            </div>
            {tbHasPy2 ? (
              <div className="rounded-xl border border-violet-900/40 bg-violet-950/20 p-4 ring-1 ring-violet-500/15">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-200/80">
                  PY2 net (mapped)
                </p>
                <p
                  className={[
                    "mt-1 font-mono text-2xl font-semibold tabular-nums",
                    py2NetCents === 0 ? "text-emerald-300" : "text-rose-300",
                  ].join(" ")}
                >
                  {formatUsd(py2NetCents / 100)}
                </p>
              </div>
            ) : null}
            {tbHasPy3 ? (
              <div className="rounded-xl border border-fuchsia-900/40 bg-fuchsia-950/20 p-4 ring-1 ring-fuchsia-500/15">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fuchsia-200/80">
                  PY3 net (mapped)
                </p>
                <p
                  className={[
                    "mt-1 font-mono text-2xl font-semibold tabular-nums",
                    py3NetCents === 0 ? "text-emerald-300" : "text-rose-300",
                  ].join(" ")}
                >
                  {formatUsd(py3NetCents / 100)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex flex-col gap-3 rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 ring-1 ring-white/5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="inline-flex items-center gap-2 text-xs text-slate-200">
              {trialBalanceNetsExactlyZero(tbRows) ? (
                <>
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-emerald-400"
                    aria-hidden
                  />
                  <span className="font-medium text-emerald-200/90">
                    Trial balance nets to zero
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle
                    className="h-4 w-4 shrink-0 text-rose-400"
                    aria-hidden
                  />
                  <span className="font-medium text-rose-200/90">
                    Trial balance does not net to zero
                  </span>
                </>
              )}
            </div>
            <div className="inline-flex items-center gap-2 text-xs text-slate-200">
              {!cfRows.length ? (
                <span className="text-slate-500">
                  Cash flow tie-out: import a cash flow file to validate
                </span>
              ) : cfScfTieOut.ok ? (
                <>
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-emerald-400"
                    aria-hidden
                  />
                  <span className="font-medium text-emerald-200/90">
                    Cash Flow Statement Ties
                  </span>
                </>
              ) : !cfScfTieOut.hasBeginningTag || !cfScfTieOut.hasEndingTag ? (
                <>
                  <AlertTriangle
                    className="h-4 w-4 shrink-0 text-amber-400"
                    aria-hidden
                  />
                  <span className="font-medium text-amber-100/90">
                    Cash flow tie-out: tag one Beginning Cash Balance and one Ending
                    Cash Balance line in Stage 2.
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle
                    className="h-4 w-4 shrink-0 text-rose-400"
                    aria-hidden
                  />
                  <span className="font-medium text-rose-200/90">
                    Cash Flow Imbalance: {formatUsd(cfScfTieOut.maxVarianceDollars)}{" "}
                    Variance
                  </span>
                </>
              )}
            </div>
          </div>

          {tbRows.length > 0 && cfRows.length > 0 ? (
            <div
              className={[
                "mt-6 rounded-xl border p-4 text-xs ring-1",
                cfCashTieOut.skipped
                  ? "border-slate-800/80 bg-slate-950/30 text-slate-500 ring-white/5"
                  : cfCashTieOut.ok
                    ? "border-emerald-500/25 bg-emerald-950/20 text-emerald-100/90 ring-emerald-500/15"
                    : "border-rose-500/30 bg-rose-950/20 text-rose-100/90 ring-rose-500/20",
              ].join(" ")}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Cross-check: cash flow ↔ trial balance (CY, informational)
              </p>
              {cfCashTieOut.skipped ? (
                <p className="mt-2 leading-relaxed">
                  Tie-out not evaluated: include a line whose label reads like
                  &quot;Net increase (decrease) in cash&quot; on the cash flow
                  statement, and ensure the trial balance names a cash &amp;
                  equivalents account we can recognize.
                </p>
              ) : (
                <div className="mt-2 space-y-1.5 font-mono text-[11px] leading-relaxed tabular-nums text-slate-200">
                  <p>
                    CF net cash, current year:{" "}
                    {formatUsd((cfCashTieOut.cfNetCashCents ?? 0) / 100)}
                  </p>
                  <p>
                    TB cash &amp; equivalents Δ (CY − PY1):{" "}
                    {formatUsd((cfCashTieOut.tbCashDeltaCents ?? 0) / 100)}
                  </p>
                  <p>
                    Difference:{" "}
                    {formatUsd((Math.abs(cfCashTieOut.diffCents ?? 0)) / 100)}{" "}
                    <span className="font-sans text-slate-500">
                      (tolerance ±$1.00)
                    </span>
                  </p>
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-4 border-t border-slate-800/80 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 text-xs text-slate-500">
              {canFinalize ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-300/90">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                  Audit lock released — ready to import to the Memory Bank.
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-rose-200/90">
                  <Lock className="h-4 w-4 shrink-0" aria-hidden />
                  {!trialBalanceNetsExactlyZero(tbRows)
                    ? tbNetZeroFailureHint(tbRows)
                    : hasIncompleteTbCategories
                      ? "Complete every trial balance category (L1; L2/L3 where required — Equity is L2 only)."
                      : !cfScfTieOut.ok
                        ? !cfScfTieOut.hasBeginningTag ||
                            !cfScfTieOut.hasEndingTag
                          ? "Cash flow statement tie-out is blocked: tag Beginning Cash Balance and Ending Cash Balance lines in Stage 2."
                          : `Cash flow statement tie-out is blocked: roll-forward must clear to $0.00 (max variance ${formatUsd(cfScfTieOut.maxVarianceDollars)}).`
                        : "Complete prior steps."}
                </span>
              )}
            </div>
            <button
              type="button"
              disabled={!canFinalize}
              onClick={handleFinalize}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-900/20 transition hover:from-cyan-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
            >
              Finalize & import to ledger
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </section>
        </div>
      ) : null}
    </div>
  );
}
