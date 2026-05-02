import { GoogleGenerativeAI, type RequestOptions } from "@google/generative-ai";
import { NextResponse, type NextRequest } from "next/server";
import { ACCOUNT_HIERARCHY } from "../../lib/chart-of-accounts-hierarchy";

export const runtime = "nodejs";

/**
 * Serverless time budget for this route (seconds).
 * Vercel Hobby caps lower; Pro/Enterprise can raise (e.g. 300). Adjust in `vercel.json` if needed.
 */
export const maxDuration = 60;

const GEMINI_MODEL_ID = "gemini-2.5-flash";

/** Stable `v1` REST path; SDK default is `v1beta` and can mis-resolve or lag behind current models. */
const geminiRequestOptions = { apiVersion: "v1" } satisfies RequestOptions;

function getGeminiModel() {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
  return genAI.getGenerativeModel({ model: GEMINI_MODEL_ID }, geminiRequestOptions);
}

const AUDITOR_SYSTEM_INSTRUCTION =
  "You are a Senior CPA Auditor. Your job is to analyze financial variance data provided by the user. Be professional, concise, and highlight potential risks in 3 sentences maximum.";

const FPA_SCENARIO_SYSTEM_INSTRUCTION =
  "You are a single-scenario financial simulator. The user will provide a business event. " +
  "You must apply Universal GAAP Engine logic with double-entry accounting and return exactly ONE 12-month array of updated projections (chart_data) plus thought_process. " +
  "Step 1: Calculate the Baseline. You will receive Current Year (CY) totals for Revenue, COGS, and Operating Expenses in currentYearTotals from payload. You MUST divide each CY total by 12 to establish the exact monthly baseline before applying any scenario. Example: if CY Revenue is 416000, each baseline month is exactly 34666.67 before any adjustments. You are strictly forbidden from inventing baseline numbers. " +
  "Step 2: Apply the Scenario. Only AFTER establishing the strict baseline, apply the user's event to the specific months requested. Example: if user says 'Add a $3M contract in August', add 3000000 to the August revenue baseline and keep all other months at baseline unless explicitly changed by the user. " +
  "For every user prompt, act as a Chief Accounting Officer. First, translate the scenario into a theoretical double-entry Journal Entry (Debit/Credit). " +
  "Then determine temporal impact: whether one specific month or recurring/amortized across multiple months. " +
  "Use universal GAAP/IFRS cash-flow routing from that journal-entry logic: " +
  "Operating cash flow (operating_cash_flow): net-income impacts, working-capital movement, customer revenue, operating expenses, interest, taxes. " +
  "Investing cash flow (investing_cash_flow): buying/selling PP&E, M&A acquisitions/disposals, marketable securities purchases/sales. " +
  "Financing cash flow (financing_cash_flow): issuing equity/stock, new debt, principal repayment, dividends. " +
  "In thought_process, explicitly include: (1) business event, (2) theoretical journal entry, (3) cash-flow classification, and (4) months impacted. " +
  "When the user specifies a timeframe (e.g., 'Q1', 'Next December', 'Summer'), you MUST isolate changes to the exact month objects in the 12-month chart_data array and keep other months on baseline trajectory. " +
  "Q1=Jan/Feb/Mar, Q2=Apr/May/Jun, Q3=Jul/Aug/Sep, Q4=Oct/Nov/Dec. Do NOT smooth a temporal event across all 12 months unless user explicitly asks for that. " +
  "Apply strict accounting logic for isolated purchases/expenses: " +
  "Rule A (CapEx: PP&E/equipment/servers/assets): book full purchase as a large NEGATIVE investing cash value in the specified month(s), then apply rough straight-line depreciation by reducing operating income by a smaller monthly amount from that month forward. " +
  "Rule B (OpEx: marketing/legal/general huge expense): subtract full amount from operating income and operating cash in that specific month only. " +
  "Even if only one month changes, you MUST return full 12-month chart_data with unchanged baseline values for other months. " +
  "Every month object in chart_data MUST include a month key with a month label string (e.g., Jan, February) and MUST include period as well. Do NOT omit month or period. " +
  "For EVERY month in chart_data, you MUST output exactly these keys: operating_cash_flow, investing_cash_flow, financing_cash_flow, and ending_cash_balance. If a category has no activity, set it to 0. Do NOT omit keys. " +
  "Ending Cash Balance math is mandatory: ending_cash_balance(month_n) = ending_cash_balance(month_n-1) + (operating_cash_flow + investing_cash_flow + financing_cash_flow). " +
  "The user may request changes using relative terms (e.g., 'PP&E will be three times larger' or 'Increase equipment by 20%'). " +
  "To handle this, look up the corresponding category in currentBalances from payload. " +
  "Calculate NEW balance from multiplier/percentage, subtract OLD balance to get Delta (cash spent), and inject this Delta as a NEGATIVE value in investing cash flow for the requested month/quarter in chart_data. " +
  "Example: current PP&E=100000 and 'PP&E will triple in Q4' => NEW=300000, Delta=200000, map -200000 into Q4 investing cash flow period(s). " +
  "If user uses a relative term but the needed currentBalances value is missing or 0, do NOT hallucinate a number. Keep JSON valid and mention in cfo_insight that a concrete dollar amount is required. " +
  "Apply deltas to full 12-month chart_data and update revenue, operating_income, operating_cash_flow, investing_cash_flow, financing_cash_flow, and ending_cash_balance per accounting logic. " +
  "Read current single forecast driver state from payload and apply requested changes cumulatively on top of existing assumptions. " +
  "Return ONLY a JSON object (no markdown, no code fences). " +
  "Shape exactly:\n" +
  "{\n" +
  '  "forecast_updates": { "rev_growth"?: number, "cogs_target"?: number, "sga_stepup"?: number } | null,\n' +
  '  "thought_process": string,\n' +
  '  "chart_data": [{ "month": string, "period": string, "revenueBar": number, "operating_income": number, "operating_cash_flow": number, "investing_cash_flow": number, "financing_cash_flow": number, "ending_cash_balance": number }],\n' +
  '  "cfo_insight": string (2-3 complete sentences on margins, liquidity/cash implications, and one actionable recommendation),\n' +
  '  "ai_highlight_rows": string[] (subset of: "Revenue","COGS","Gross Profit","SG&A","Operating Income")\n' +
  "}\n" +
  "For unchanged assumptions return null forecast_updates (or return original values). " +
  "Keep percentages realistic and internally coherent.";

/** Serialized COA injected into the categorize prompt so the model uses exact L2/L3 sets. */
const ACCOUNT_HIERARCHY_JSON = JSON.stringify(ACCOUNT_HIERARCHY, null, 2);

const CATEGORIZE_DEEP_INSTRUCTION =
  "You are a Senior CPA. Your task is to categorize a Trial Balance into a specific 3-level hierarchy (L1, L2, L3).\n\n" +
  "Rule 1: Analyze BOTH the Account Number and Account Name. (e.g., 1000s are usually Assets, 2000s Liabilities).\n\n" +
  "Rule 2: Use the provided hierarchy strictly. Every l1/l2/l3 you output must exist in that JSON (l3 must be one of the strings listed under the chosen l1 → l2 key, or null/empty when that l2 has an empty array).\n\n" +
  "Rule 3: If a category only goes to L2 (e.g. Equity), return l3 as null or an empty string. If it only goes to L1 (no L2 buckets under that l1 in the hierarchy), return l2 and l3 as null or empty strings.\n\n" +
  "Rule 4: Return ONLY a JSON array of objects. No markdown, no code fences, no commentary outside the array. " +
  'Each element must be: { "accountName": string, "l1": string, "l2": string | null, "l3": string | null } ' +
  "(use null or \"\" for unused levels). Match each object’s accountName exactly to the name from the input list.\n\n" +
  "Valid hierarchy (L1 → L2 → [L3 options]; empty array means no L3 for that L2):\n" +
  ACCOUNT_HIERARCHY_JSON;

const AUDIT_ANALYSIS_SYSTEM_INSTRUCTION =
  "You are a Senior Audit Manager. Perform a professional risk-based analytical review. Compare CY to PY1 and analyze the relationships between accounts.\n\n" +
  "Equity accounts are provided in their raw Trial Balance format (Credits are negative, Debits are positive). Analyze these as standard accounting balances.\n\n" +
  "Examples - Irregularity Flags:\n" +
  "Divergence: Revenue up, but AR down (or vice versa).\n" +
  "Omissions: PPE exists but $0 Depreciation; Revenue exists but $0 Accruals.\n" +
  "Inconsistency: OpEx growing significantly faster than Revenue.\n" +
  "Classification: Large balances in \"Other\" or \"Misc\" accounts.\n\n" +
  "Return ONLY a JSON array in this exact shape:\n" +
  '[{ "risk_type": "...", "title": "...", "finding": "...", "impact": "...", "severity": "high | medium", "suggested_procedure": "..." }]';

const RATE_LIMIT_MESSAGE =
  "The AI Auditor is currently at its free limit. Please try again in 60 seconds!";

const MAX_CATEGORIZE_ACCOUNTS = 150;

type CategorizeRow = {
  accountName: string;
  L1: string;
  L2: string;
  L3: string;
};

type RequestBody = {
  mode?: unknown;
  prompt?: unknown;
  /** Current single forecast driver state from client. */
  forecastDrivers?: unknown;
  currentYearTotals?: unknown;
  currentBalances?: unknown;
  accounts?: unknown;
  /** Preferred: { accountNumber, accountName }[] for Rule 1 (number + name). */
  tbLines?: unknown;
  trialBalance?: unknown;
  overallMateriality?: unknown;
  performanceMateriality?: unknown;
};

type CategorizeTbLine = { accountNumber: string; accountName: string };
type AuditAnalysisRow = {
  accountNumber: string;
  accountName: string;
  cy: number;
  py1: number;
  l1: string;
  l2: string;
  l3: string;
};
type AuditRiskInsight = {
  risk_type: string;
  title: string;
  finding: string;
  impact: string;
  severity: "high" | "medium";
  suggested_procedure: string;
};

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  const status = e.status;
  if (typeof status === "number") return status;
  if (typeof status === "string" && status.trim() === "429") return 429;
  const cause = e.cause;
  if (cause && typeof cause === "object") {
    const c = cause as Record<string, unknown>;
    if (typeof c.status === "number") return c.status;
  }
  return undefined;
}

function isQuotaOrRateLimit(error: unknown): boolean {
  if (getErrorStatus(error) === 429) return true;
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "";
  return /429|RESOURCE_EXHAUSTED|quota/i.test(msg);
}

function formatRouteErrorMessage(error: unknown, step: string): string {
  const base =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  return `[${step}] ${base}`;
}

/** Flatten SDK / fetch errors for logs (404 vs quota vs region often hide in nested fields). */
function geminiErrorLogBlob(error: unknown): string {
  const chunks: string[] = [];
  if (error instanceof Error) chunks.push(error.message, error.stack ?? "");
  if (error && typeof error === "object") {
    const o = error as Record<string, unknown>;
    if (typeof o.status === "number") chunks.push(`httpStatus=${o.status}`);
    if (typeof o.statusText === "string") chunks.push(String(o.statusText));
    if (o.errorDetails !== undefined) {
      try {
        chunks.push(`errorDetails=${JSON.stringify(o.errorDetails)}`);
      } catch {
        chunks.push("errorDetails=[unserializable]");
      }
    }
    if (o.cause !== undefined) chunks.push(`cause=${String(o.cause)}`);
  }
  if (typeof error === "string") chunks.push(error);
  return chunks.filter(Boolean).join(" | ");
}

function logGeminiErrorWithRegionQuotaHints(step: string, error: unknown) {
  const blob = geminiErrorLogBlob(error);
  const lower = blob.toLowerCase();
  const mentionsLocation =
    /\blocation\b/.test(lower) || /\bregion\b/.test(lower) || /\bnot available in your country\b/.test(lower);
  const mentionsQuota =
    /\bquota\b/.test(lower) ||
    /\bresource_exhausted\b/.test(lower) ||
    /\brate limit\b/.test(lower) ||
    /\b429\b/.test(lower);
  console.error(
    `[Gemini ${step}] diagnostics: mentionsLocationOrRegion=${mentionsLocation} mentionsQuotaOrRateLimit=${mentionsQuota} | raw: ${blob}`,
  );
}

/** Build ordered unique account names from `prompt` (newline-separated) and/or `accounts` array. */
function normalizeAccountNames(accounts: unknown, promptFallback: string): string[] {
  const fromPrompt =
    typeof promptFallback === "string" && promptFallback.trim()
      ? promptFallback
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  const fromAccounts = Array.isArray(accounts)
    ? accounts
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.trim())
        .filter(Boolean)
    : [];
  const combined = [...fromPrompt, ...fromAccounts];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of combined) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Prefer structured TB lines; otherwise derive names-only lines from prompt/accounts. */
function buildCategorizeTbLines(body: RequestBody): CategorizeTbLine[] {
  const tbLines = body.tbLines;
  if (Array.isArray(tbLines) && tbLines.length > 0) {
    const out: CategorizeTbLine[] = [];
    const seen = new Set<string>();
    for (const item of tbLines) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const accountName =
        typeof o.accountName === "string" ? o.accountName.trim() : "";
      if (!accountName) continue;
      const key = accountName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const rawNum = o.accountNumber;
      const accountNumber =
        typeof rawNum === "string"
          ? rawNum.trim()
          : rawNum !== undefined && rawNum !== null
            ? String(rawNum).trim()
            : "";
      out.push({ accountNumber: accountNumber || "—", accountName });
    }
    return out;
  }
  const promptStr = typeof body.prompt === "string" ? body.prompt : "";
  const names = normalizeAccountNames(body.accounts, promptStr);
  return names.map((accountName) => ({ accountNumber: "—", accountName }));
}

function stripMarkdownJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}

/**
 * Gemini often prefixes/suffixes prose around the array. Take the substring from
 * the first "[" through the last "]" so JSON.parse sees only the array.
 */
function extractJsonArraySubstring(text: string): string {
  const normalized = stripMarkdownJsonFence(text.trim());
  const first = normalized.indexOf("[");
  const last = normalized.lastIndexOf("]");
  if (first === -1 || last === -1 || last <= first) {
    throw new SyntaxError("No JSON array delimiters found in model response.");
  }
  return normalized.slice(first, last + 1);
}

function extractJsonObjectSubstring(text: string): string {
  const normalized = stripMarkdownJsonFence(text.trim());
  const first = normalized.indexOf("{");
  const last = normalized.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new SyntaxError("No JSON object delimiters found in model response.");
  }
  return normalized.slice(first, last + 1);
}

const FPA_ROW_LABELS = new Set([
  "Revenue",
  "COGS",
  "Gross Profit",
  "SG&A",
  "Operating Income",
]);

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseFpaScenarioResponse(text: string): {
  forecast_updates: {
    rev_growth?: number;
    cogs_target?: number;
    sga_stepup?: number;
  } | null;
  thought_process: string;
  chart_data: Array<{
    month: string;
    period: string;
    revenueBar: number;
    operating_income: number;
    operating_cash_flow: number;
    investing_cash_flow: number;
    financing_cash_flow: number;
    ending_cash_balance: number;
  }>;
  cfo_insight: string;
  ai_highlight_rows: string[];
} {
  const jsonSlice = extractJsonObjectSubstring(text);
  const parsed: unknown = JSON.parse(jsonSlice);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model response was not a JSON object.");
  }
  const root = parsed as Record<string, unknown>;
  const thoughtProcess =
    typeof root.thought_process === "string" ? root.thought_process.trim() : "";
  const cfoInsight =
    typeof root.cfo_insight === "string" ? root.cfo_insight.trim() : "";

  function parseScenarioUpdate(raw: unknown): {
    rev_growth?: number;
    cogs_target?: number;
    sga_stepup?: number;
  } | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "object") return null;
    const s = raw as Record<string, unknown>;
    const parsedScenario: {
      rev_growth?: number;
      cogs_target?: number;
      sga_stepup?: number;
    } = {};
    if (Number.isFinite(Number(s.rev_growth))) {
      parsedScenario.rev_growth = clamp(Number(s.rev_growth), -100, 100);
    }
    if (Number.isFinite(Number(s.cogs_target))) {
      parsedScenario.cogs_target = clamp(Number(s.cogs_target), 0, 100);
    }
    if (Number.isFinite(Number(s.sga_stepup))) {
      parsedScenario.sga_stepup = clamp(Number(s.sga_stepup), -100, 100);
    }
    return Object.keys(parsedScenario).length > 0 ? parsedScenario : null;
  }

  const forecast_updates = parseScenarioUpdate(root.forecast_updates);

  const highlightsRaw = root.ai_highlight_rows;
  const aiHighlightRows: string[] = [];
  if (Array.isArray(highlightsRaw)) {
    for (const item of highlightsRaw) {
      if (typeof item !== "string") continue;
      const t = item.trim();
      if (FPA_ROW_LABELS.has(t)) aiHighlightRows.push(t);
    }
  }

  const chartRowsRaw = root.chart_data;
  const chart_data: Array<{
    month: string;
    period: string;
    revenueBar: number;
    operating_income: number;
    operating_cash_flow: number;
    investing_cash_flow: number;
    financing_cash_flow: number;
    ending_cash_balance: number;
  }> = [];
  if (Array.isArray(chartRowsRaw)) {
    for (const item of chartRowsRaw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      chart_data.push({
        month: typeof o.month === "string" ? o.month : typeof o.period === "string" ? o.period : "",
        period: typeof o.period === "string" ? o.period : "",
        revenueBar: Number(o.revenueBar) || 0,
        operating_income: Number(o.operating_income) || 0,
        operating_cash_flow: Number(o.operating_cash_flow) || Number(o.operating_cash) || 0,
        investing_cash_flow: Number(o.investing_cash_flow) || 0,
        financing_cash_flow: Number(o.financing_cash_flow) || 0,
        ending_cash_balance: Number(o.ending_cash_balance) || Number(o.endingCash) || 0,
      });
    }
  }
  return {
    forecast_updates,
    thought_process:
      thoughtProcess ||
      "Event classified using baseline and delta logic before monthly chart_data generation.",
    chart_data,
    cfo_insight: cfoInsight || "Scenario drivers updated from the model output.",
    ai_highlight_rows: aiHighlightRows,
  };
}

function pickLevelField(o: Record<string, unknown>, lowerKey: "l1" | "l2" | "l3"): string {
  const upper = lowerKey.toUpperCase() as "L1" | "L2" | "L3";
  const v = o[lowerKey] ?? o[upper];
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

function parseCategorizeResponse(text: string): CategorizeRow[] {
  const jsonSlice = extractJsonArraySubstring(text);
  const parsed: unknown = JSON.parse(jsonSlice);
  if (!Array.isArray(parsed)) {
    throw new Error("Model response was not a JSON array.");
  }
  const rows: CategorizeRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const accountName = typeof o.accountName === "string" ? o.accountName.trim() : "";
    const L1 = pickLevelField(o, "l1");
    const L2 = pickLevelField(o, "l2");
    const L3 = pickLevelField(o, "l3");
    if (!accountName) continue;
    rows.push({ accountName, L1, L2, L3 });
  }
  if (rows.length === 0) {
    throw new Error("No valid categorization objects in model response.");
  }
  return rows;
}

function parseAuditInsightsResponse(text: string): AuditRiskInsight[] {
  const jsonSlice = extractJsonArraySubstring(text);
  const parsed: unknown = JSON.parse(jsonSlice);
  if (!Array.isArray(parsed)) {
    throw new Error("Model response was not a JSON array.");
  }
  const rows: AuditRiskInsight[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const risk_type =
      typeof o.risk_type === "string" ? o.risk_type.trim() : "";
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const finding = typeof o.finding === "string" ? o.finding.trim() : "";
    const impact = typeof o.impact === "string" ? o.impact.trim() : "";
    const severityRaw =
      typeof o.severity === "string" ? o.severity.trim().toLowerCase() : "";
    const suggested_procedure =
      typeof o.suggested_procedure === "string"
        ? o.suggested_procedure.trim()
        : "";
    const severity: "high" | "medium" =
      severityRaw === "high" ? "high" : "medium";
    if (!title || !finding) continue;
    rows.push({
      risk_type: risk_type || "Analytical",
      title,
      finding,
      impact: impact || "Potential material misstatement risk.",
      severity,
      suggested_procedure:
        suggested_procedure ||
        "Perform targeted substantive procedures for this area.",
    });
  }
  if (rows.length === 0) {
    throw new Error("No valid analytical risk insight objects in model response.");
  }
  return rows;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      {
        error:
          'Invalid JSON body. Use { "prompt": "..." } for chat or { "mode": "categorize", "prompt": "name per line" }.',
      },
      { status: 400 },
    );
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const mode = typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "";
  const isCategorize = mode === "categorize";
  const isAuditAnalysis = mode === "audit_analysis";
  const isFpaScenario = mode === "fpa_scenario";

  if (isFpaScenario) {
    const scenarioPrompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!scenarioPrompt) {
      return NextResponse.json(
        { error: 'Missing or empty "prompt" for { "mode": "fpa_scenario" }.' },
        { status: 400 },
      );
    }
    const forecastDrivers =
      body.forecastDrivers && typeof body.forecastDrivers === "object"
        ? body.forecastDrivers
        : {};
    const currentBalances =
      body.currentBalances && typeof body.currentBalances === "object"
        ? body.currentBalances
        : {};
    const currentYearTotals =
      body.currentYearTotals && typeof body.currentYearTotals === "object"
        ? body.currentYearTotals
        : {};

    try {
      const model = getGeminiModel();
      const finalPrompt =
        FPA_SCENARIO_SYSTEM_INSTRUCTION +
        "\n\nCurrent forecast drivers from the UI (JSON):\n" +
        JSON.stringify(forecastDrivers, null, 2) +
        "\n\ncurrentYearTotals (CY factual totals for baseline spreading):\n" +
        JSON.stringify(currentYearTotals, null, 2) +
        "\n\ncurrentBalances (CY baseline category balances):\n" +
        JSON.stringify(currentBalances, null, 2) +
        "\n\nUser natural-language scenario:\n" +
        scenarioPrompt;
      const result = await model.generateContent(finalPrompt);
      const text = result.response.text();
      try {
        const payload = parseFpaScenarioResponse(text);
        return NextResponse.json(payload, { status: 200 });
      } catch {
        return NextResponse.json(
          { error: "JSON parsing failed", step: "fpa_scenario_parse" },
          { status: 500 },
        );
      }
    } catch (error: unknown) {
      const msg = formatRouteErrorMessage(error, "fpa_scenario");
      console.error("Gemini Error (fpa_scenario):", msg, error);
      logGeminiErrorWithRegionQuotaHints("fpa_scenario", error);
      const status = getErrorStatus(error);
      if (status === 429 || isQuotaOrRateLimit(error)) {
        return NextResponse.json({ message: RATE_LIMIT_MESSAGE }, { status: 429 });
      }
      return NextResponse.json({ error: msg, step: "fpa_scenario" }, { status: 500 });
    }
  }

  if (isAuditAnalysis) {
    const trialBalance = Array.isArray(body.trialBalance) ? body.trialBalance : [];
    const rows: AuditAnalysisRow[] = [];
    for (const item of trialBalance) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const accountName =
        typeof o.accountName === "string" ? o.accountName.trim() : "";
      if (!accountName) continue;
      const rawNum = o.accountNumber;
      const accountNumber =
        typeof rawNum === "string"
          ? rawNum.trim()
          : rawNum !== undefined && rawNum !== null
            ? String(rawNum).trim()
            : "—";
      rows.push({
        accountNumber: accountNumber || "—",
        accountName,
        cy: Number(o.cy) || 0,
        py1: Number(o.py1) || 0,
        l1: typeof o.l1 === "string" ? o.l1.trim() : "",
        l2: typeof o.l2 === "string" ? o.l2.trim() : "",
        l3: typeof o.l3 === "string" ? o.l3.trim() : "",
      });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            'Provide trialBalance rows in body: [{ "accountNumber", "accountName", "cy", "py1", "l1", "l2", "l3" }].',
        },
        { status: 400 },
      );
    }

    const overallMateriality =
      typeof body.overallMateriality === "number"
        ? body.overallMateriality
        : Number(body.overallMateriality) || 0;
    const performanceMateriality =
      typeof body.performanceMateriality === "number"
        ? body.performanceMateriality
        : Number(body.performanceMateriality) || 0;

    const linesBlock = rows
      .map(
        (r) =>
          `${r.accountNumber}\t${r.accountName}\tCY=${r.cy}\tPY1=${r.py1}\tL1=${r.l1 || "—"}\tL2=${r.l2 || "—"}\tL3=${r.l3 || "—"}`,
      )
      .join("\n");

    try {
      const model = getGeminiModel();
      const finalPrompt =
        AUDIT_ANALYSIS_SYSTEM_INSTRUCTION +
        `\n\nOverall Materiality: ${overallMateriality}` +
        `\nPerformance Materiality: ${performanceMateriality}` +
        "\n\nTrial Balance data (tab-separated fields):\n" +
        linesBlock;
      const result = await model.generateContent(finalPrompt);
      const text = result.response.text();
      const insights = parseAuditInsightsResponse(text);
      return NextResponse.json(insights, { status: 200 });
    } catch (error: unknown) {
      const msg = formatRouteErrorMessage(error, "audit_analysis");
      console.error("Gemini Error (audit_analysis):", msg, error);
      logGeminiErrorWithRegionQuotaHints("audit_analysis", error);
      const status = getErrorStatus(error);
      if (status === 429 || isQuotaOrRateLimit(error)) {
        return NextResponse.json({ message: RATE_LIMIT_MESSAGE }, { status: 429 });
      }
      if (error instanceof SyntaxError) {
        return NextResponse.json(
          {
            error: formatRouteErrorMessage(error, "audit_analysis_parse"),
            step: "audit_analysis",
            hint: "Expected a JSON array in the model reply (no markdown).",
          },
          { status: 502 },
        );
      }
      return NextResponse.json({ error: msg, step: "audit_analysis" }, { status: 500 });
    }
  }

  if (isCategorize) {
    const tbLinesBuilt = buildCategorizeTbLines(body);

    if (tbLinesBuilt.length === 0) {
      return NextResponse.json(
        {
          error:
            'Provide TB lines: "tbLines": [{ "accountNumber": "...", "accountName": "..." }, ...] (preferred), or account names in "prompt" (one per line) / "accounts": ["..."].',
        },
        { status: 400 },
      );
    }
    if (tbLinesBuilt.length > MAX_CATEGORIZE_ACCOUNTS) {
      return NextResponse.json(
        {
          error: `Too many accounts in one request (max ${MAX_CATEGORIZE_ACCOUNTS}). Send smaller batches from the client.`,
        },
        { status: 400 },
      );
    }

    const linesBlock = tbLinesBuilt
      .map((l) => `${l.accountNumber}\t${l.accountName}`)
      .join("\n");

    try {
      const model = getGeminiModel();
      const finalPrompt =
        CATEGORIZE_DEEP_INSTRUCTION +
        "\n\nHere are the Trial Balance lines (tab-separated: AccountNumber then AccountName). Use both columns for Rule 1:\n" +
        linesBlock;
      const result = await model.generateContent(finalPrompt);
      const text = result.response.text();
      const categories = parseCategorizeResponse(text);
      return NextResponse.json(categories, { status: 200 });
    } catch (error: unknown) {
      const msg = formatRouteErrorMessage(error, "categorize");
      console.error("Gemini Error (categorize):", msg, error);
      logGeminiErrorWithRegionQuotaHints("categorize", error);
      const status = getErrorStatus(error);
      if (status === 429 || isQuotaOrRateLimit(error)) {
        return NextResponse.json({ message: RATE_LIMIT_MESSAGE }, { status: 429 });
      }
      if (error instanceof SyntaxError) {
        return NextResponse.json(
          {
            error: formatRouteErrorMessage(error, "categorize_parse"),
            step: "categorize",
            hint: "Expected a JSON array in the model reply (no markdown).",
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        {
          error: msg,
          step: "categorize",
        },
        { status: 500 },
      );
    }
  }

  const prompt =
    typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json(
      {
        error:
          'Missing or empty "prompt". For categorization, send { "mode": "categorize", "prompt": "Account A\\nAccount B" }.',
      },
      { status: 400 },
    );
  }

  try {
    const model = getGeminiModel();
    const finalPrompt = AUDITOR_SYSTEM_INSTRUCTION + "\n\n" + prompt;
    const result = await model.generateContent(finalPrompt);
    const response = result.response;
    const text = response.text();

    return NextResponse.json({ reply: text }, { status: 200 });
  } catch (error: unknown) {
    const msg = formatRouteErrorMessage(error, "chat");
    console.error("Gemini Error (chat):", msg, error);
    logGeminiErrorWithRegionQuotaHints("chat", error);
    const status = getErrorStatus(error);
    if (status === 429 || isQuotaOrRateLimit(error)) {
      return NextResponse.json({ message: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    return NextResponse.json({ error: msg, step: "chat" }, { status: 500 });
  }
}
