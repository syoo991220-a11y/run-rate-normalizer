"use client";

import { Fragment, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Loader2,
  Minus,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { TrialBalanceLine } from "../types/studio-finance";
import { calculateRiskLevel, type RiskLevel } from "../lib/audit-risk-level";
import { useStudioMemory } from "../context/studio-memory-context";
import { useFpaData } from "../hooks/use-fpa-data";

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function displayAccountName(row: TrialBalanceLine): string {
  const name = row.accountName?.trim();
  if (name) return name;
  const sep = " — ";
  const idx = row.account.indexOf(sep);
  if (idx >= 0) return row.account.slice(idx + sep.length).trim();
  return row.account.trim() || "—";
}

function usesNaturalCreditSign(row: TrialBalanceLine): boolean {
  const l1 = (row.categoryL1 ?? "").trim();
  return (
    l1 === "Liabilities" ||
    l1 === "Revenue" ||
    l1 === "Other Income"
  );
}

function toNaturalSignedAmount(row: TrialBalanceLine, amount: number): number {
  return usesNaturalCreditSign(row) ? amount * -1 : amount;
}

function RiskStatusCell({ level, reason }: { level: RiskLevel; reason: string }) {
  const badge =
    level === "Red" ? (
      <span className="inline-flex rounded-full bg-rose-600/90 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ring-rose-400/50">
        High risk
      </span>
    ) : level === "Yellow" ? (
      <span className="inline-flex rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-semibold text-amber-950 shadow-sm ring-1 ring-amber-300/60">
        Review
      </span>
    ) : (
      <span className="inline-flex rounded-full bg-emerald-600/90 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ring-emerald-400/45">
        Pass
      </span>
    );

  return (
    <div className="flex max-w-[16rem] flex-col gap-1">
      <span title={reason}>{badge}</span>
      <p className="text-[10px] leading-snug text-slate-500">{reason}</p>
    </div>
  );
}

function horizontalVariancePct(py: number, cy: number) {
  if (py === 0 && cy > 0) return 100;
  if (py > 0 && cy === 0) return -100;
  if (py === 0 && cy === 0) return 0;
  return ((cy - py) / Math.abs(py)) * 100;
}

function grossMarginPct(rev: number, cogs: number): number | null {
  if (rev === 0) return null;
  return ((rev - cogs) / rev) * 100;
}

function operatingMarginPct(rev: number, cogs: number, sga: number): number | null {
  if (rev === 0) return null;
  return ((rev - cogs - sga) / rev) * 100;
}

function ratioOrNa(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

/** CY average balance = (CY ending + PY1 ending) / 2. */
function averageBalanceCyEnding(cy: number, py1: number): number {
  return (cy + py1) / 2;
}

/**
 * PY1 average balance = (PY1 ending + PY2 ending) / 2.
 * Returns null when PY2 is not available (cannot use PY1 alone).
 */
function averageBalancePy1Ending(
  py1: number,
  py2: number | undefined,
): number | null {
  if (py2 === undefined) return null;
  return (py1 + py2) / 2;
}

/** (Average balance / denominator) × 365; null when average or denominator invalid. */
function turnoverDaysFromAverage(
  averageBalance: number | null,
  denominator: number,
): number | null {
  if (averageBalance === null || !Number.isFinite(averageBalance)) return null;
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  return (averageBalance / denominator) * 365;
}

function formatPct1(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return `${n.toFixed(1)}%`;
}

function formatRatio2(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return `${n.toFixed(2)}x`;
}

function formatDays0(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return `${Math.round(n)}d`;
}

type TrendKind = "favorable" | "unfavorable" | "flat" | "none";

function trendFromDelta(
  cy: number | null,
  py: number | null,
  higherIsBetter: boolean,
): TrendKind {
  if (cy === null || py === null) return "none";
  const d = cy - py;
  if (Math.abs(d) < 1e-6) return "flat";
  const good = higherIsBetter ? d > 0 : d < 0;
  return good ? "favorable" : "unfavorable";
}

function TrendIcon({ kind }: { kind: TrendKind }) {
  if (kind === "none") return null;
  if (kind === "flat") {
    return <Minus className="h-4 w-4 text-slate-500" aria-hidden />;
  }
  if (kind === "favorable") {
    return <ArrowUpRight className="h-4 w-4 text-emerald-400" aria-hidden />;
  }
  return <ArrowDownRight className="h-4 w-4 text-rose-400" aria-hidden />;
}

function KpiCard({
  title,
  subtitle,
  cyDisplay,
  pyDisplay,
  trend,
}: {
  title: string;
  subtitle: string;
  cyDisplay: string;
  pyDisplay: string;
  trend: TrendKind;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-800/90 bg-gradient-to-b from-slate-900/80 to-slate-950/90 p-4 shadow-lg ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {title}
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-600">{subtitle}</p>
        </div>
        <div className="shrink-0 pt-0.5" title="vs prior year">
          <TrendIcon kind={trend} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-slate-500">Current year</p>
          <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-cyan-100">
            {cyDisplay}
          </p>
        </div>
        <div>
          <p className="text-slate-500">Prior year 1</p>
          <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-300">
            {pyDisplay}
          </p>
        </div>
      </div>
    </div>
  );
}

type AuditRiskInsight = {
  risk_type: string;
  title: string;
  finding: string;
  impact: string;
  severity: "high" | "medium";
  suggested_procedure: string;
};

function stripMarkdownJsonFenceFromText(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/im.exec(trimmed);
  return fence ? fence[1]!.trim() : trimmed;
}

function parseInsightsJsonResponse(raw: string): AuditRiskInsight[] {
  const trimmed = stripMarkdownJsonFenceFromText(raw.trim());
  const first = trimmed.indexOf("[");
  const last = trimmed.lastIndexOf("]");
  const jsonSlice =
    first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
  const parsed: unknown = JSON.parse(jsonSlice);
  if (!Array.isArray(parsed)) {
    throw new Error("AI response was not a JSON array.");
  }
  const out: AuditRiskInsight[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const finding = typeof o.finding === "string" ? o.finding.trim() : "";
    const impact = typeof o.impact === "string" ? o.impact.trim() : "";
    const suggested_procedure =
      typeof o.suggested_procedure === "string"
        ? o.suggested_procedure.trim()
        : "";
    const risk_type =
      typeof o.risk_type === "string" && o.risk_type.trim()
        ? o.risk_type.trim()
        : "Analytical";
    const severityRaw =
      typeof o.severity === "string" ? o.severity.trim().toLowerCase() : "";
    const severity: "high" | "medium" =
      severityRaw === "high" ? "high" : "medium";
    if (!title || !finding) continue;
    out.push({
      risk_type,
      title,
      finding,
      impact: impact || "Potential material misstatement risk.",
      severity,
      suggested_procedure:
        suggested_procedure ||
        "Perform targeted substantive procedures for this area.",
    });
  }
  return out;
}

export function MaterialityWorkspace() {
  const { trialBalance, overallMateriality, setOverallMateriality } = useStudioMemory();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isAiAnalysisLoading, setIsAiAnalysisLoading] = useState(false);
  const [riskInsights, setRiskInsights] = useState<AuditRiskInsight[]>([]);
  const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);
  const fpa = useFpaData(trialBalance);

  const performanceMateriality = overallMateriality * 0.75;
  const clearlyTrivial = overallMateriality * 0.05;

  const gmCy = grossMarginPct(fpa.revenueCy, fpa.cogsCy);
  const gmPy = grossMarginPct(fpa.revenuePy1, fpa.cogsPy1);
  const omCy = operatingMarginPct(fpa.revenueCy, fpa.cogsCy, fpa.sgaCy);
  const omPy = operatingMarginPct(fpa.revenuePy1, fpa.cogsPy1, fpa.sgaPy1);
  const curRCy = ratioOrNa(fpa.currentAssetsCy, fpa.currentLiabilitiesCy);
  const curRPy = ratioOrNa(fpa.currentAssetsPy1, fpa.currentLiabilitiesPy1);

  const avgArCy = averageBalanceCyEnding(fpa.arCy, fpa.arPy1);
  const avgArPy1 = averageBalancePy1Ending(fpa.arPy1, fpa.arPy2);
  const dsoCy = turnoverDaysFromAverage(avgArCy, fpa.revenueCy);
  const dsoPy = turnoverDaysFromAverage(avgArPy1, fpa.revenuePy1);

  const avgInvCy = averageBalanceCyEnding(fpa.inventoryCy, fpa.inventoryPy1);
  const avgInvPy1 = averageBalancePy1Ending(
    fpa.inventoryPy1,
    fpa.inventoryPy2,
  );
  const invDaysCy = turnoverDaysFromAverage(avgInvCy, fpa.cogsCy);
  const invDaysPy = turnoverDaysFromAverage(avgInvPy1, fpa.cogsPy1);

  const avgApCy = averageBalanceCyEnding(fpa.apCy, fpa.apPy1);
  const avgApPy1 = averageBalancePy1Ending(fpa.apPy1, fpa.apPy2);
  const apDaysCy = turnoverDaysFromAverage(avgApCy, fpa.cogsCy);
  const apDaysPy = turnoverDaysFromAverage(avgApPy1, fpa.cogsPy1);

  const riskReviewRows = useMemo(
    () =>
      trialBalance.map((row) => {
        const risk = calculateRiskLevel(
          row,
          performanceMateriality,
          clearlyTrivial,
        );
        const pyNatural = toNaturalSignedAmount(row, row.py1Balance);
        const cyNatural = toNaturalSignedAmount(row, row.cyBalance);
        const varianceDollar = cyNatural - pyNatural;
        const variancePercent = horizontalVariancePct(pyNatural, cyNatural);
        return { row, risk, pyNatural, cyNatural, varianceDollar, variancePercent };
      }),
    [trialBalance, performanceMateriality, clearlyTrivial],
  );

  const groupedRiskRows = useMemo(() => {
    const groups = new Map<
      string,
      {
        groupKey: string;
        pyTotal: number;
        cyTotal: number;
        varianceTotal: number;
        variancePctTotal: number;
        rows: typeof riskReviewRows;
      }
    >();

    for (const entry of riskReviewRows) {
      const groupKey =
        (entry.row.categoryL2 ?? "").trim() ||
        (entry.row.categoryL1 ?? "").trim() ||
        "Uncategorized";

      const existing = groups.get(groupKey);
      if (existing) {
        existing.pyTotal += entry.pyNatural;
        existing.cyTotal += entry.cyNatural;
        existing.varianceTotal += entry.varianceDollar;
        existing.rows.push(entry);
        existing.variancePctTotal = horizontalVariancePct(existing.pyTotal, existing.cyTotal);
      } else {
        const pyTotal = entry.pyNatural;
        const cyTotal = entry.cyNatural;
        const varianceTotal = cyTotal - pyTotal;
        groups.set(groupKey, {
          groupKey,
          pyTotal,
          cyTotal,
          varianceTotal,
          variancePctTotal: horizontalVariancePct(pyTotal, cyTotal),
          rows: [entry],
        });
      }
    }

    return [...groups.values()];
  }, [riskReviewRows]);

  const toggleGroup = (groupKey: string) =>
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));

  const hasTrialBalanceData = trialBalance.length > 0;
  const handleRunAuditAnalysis = async () => {
    if (!hasTrialBalanceData || isAiAnalysisLoading) return;
    setIsAiAnalysisLoading(true);
    setAiAnalysisError(null);
    try {
      const trialBalancePayload = trialBalance.map((row) => ({
        accountNumber: row.accountNumber?.trim() || "—",
        accountName: displayAccountName(row),
        cy: toNaturalSignedAmount(row, row.cyBalance),
        py1: toNaturalSignedAmount(row, row.py1Balance),
        l1: (row.categoryL1 ?? "").trim(),
        l2: (row.categoryL2 ?? "").trim(),
        l3: (row.categoryL3 ?? "").trim(),
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "audit_analysis",
          trialBalance: trialBalancePayload,
          overallMateriality,
          performanceMateriality,
        }),
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(raw.trim().slice(0, 500) || `API ${res.status}`);
      }
      const insights = parseInsightsJsonResponse(raw);
      setRiskInsights(insights);
    } catch (error) {
      setRiskInsights([]);
      setAiAnalysisError(
        error instanceof Error
          ? error.message
          : "Failed to run AI audit analysis.",
      );
    } finally {
      setIsAiAnalysisLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10 lg:px-10">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          Module 02
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Materiality &amp; Audit
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
          FP&amp;A-style KPIs from your tagged trial balance, materiality planning
          thresholds, and assertion-based risk review.
        </p>
      </header>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-100">FP&amp;A analytics</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            title="Gross margin"
            subtitle="(Revenue − COGS) / Revenue"
            cyDisplay={formatPct1(gmCy)}
            pyDisplay={formatPct1(gmPy)}
            trend={trendFromDelta(gmCy, gmPy, true)}
          />
          <KpiCard
            title="Operating margin"
            subtitle="(Revenue − COGS − SG&A) / Revenue"
            cyDisplay={formatPct1(omCy)}
            pyDisplay={formatPct1(omPy)}
            trend={trendFromDelta(omCy, omPy, true)}
          />
          <KpiCard
            title="Current ratio"
            subtitle="Current assets / Current liabilities"
            cyDisplay={formatRatio2(curRCy)}
            pyDisplay={formatRatio2(curRPy)}
            trend={trendFromDelta(curRCy, curRPy, true)}
          />
          <KpiCard
            title="AR Days"
            subtitle="(Average AR / Revenue) × 365"
            cyDisplay={formatDays0(dsoCy)}
            pyDisplay={formatDays0(dsoPy)}
            trend={trendFromDelta(dsoCy, dsoPy, false)}
          />
          <KpiCard
            title="Inventory days"
            subtitle="(Average Inventory / COGS) × 365"
            cyDisplay={formatDays0(invDaysCy)}
            pyDisplay={formatDays0(invDaysPy)}
            trend={trendFromDelta(invDaysCy, invDaysPy, false)}
          />
          <KpiCard
            title="AP days"
            subtitle="(Average AP / COGS) × 365"
            cyDisplay={formatDays0(apDaysCy)}
            pyDisplay={formatDays0(apDaysPy)}
            trend={trendFromDelta(apDaysCy, apDaysPy, false)}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/90 bg-slate-900/35 p-6 shadow-lg ring-1 ring-white/5">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800/80 ring-1 ring-white/10">
            <SlidersHorizontal className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Materiality</h2>
            <p className="text-xs text-slate-500">
              Performance materiality and clearly trivial threshold derive from
              overall materiality.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <label className="block max-w-md space-y-2">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Overall materiality
              </span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                  $
                </span>
                <input
                  type="number"
                  min={0}
                  value={Number.isFinite(overallMateriality) ? overallMateriality : 0}
                  onChange={(e) =>
                    setOverallMateriality(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-full rounded-xl border border-slate-700/90 bg-slate-950/60 py-2.5 pl-8 pr-3 text-sm text-slate-100 shadow-inner outline-none transition focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>
            </label>
            <div className="mt-3 max-w-md">
              <button
                type="button"
                onClick={() => void handleRunAuditAnalysis()}
                disabled={!hasTrialBalanceData || isAiAnalysisLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/25 transition hover:from-sky-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
              >
                {isAiAnalysisLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    <span>Analyzing Trial Balance...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" aria-hidden />
                    <span>Run AI Audit Analysis</span>
                  </>
                )}
              </button>
            </div>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3 ring-1 ring-white/5">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Performance materiality (PM)
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
                  {formatUsd(performanceMateriality)}
                </dd>
                <p className="mt-1 text-[10px] text-slate-600">75% of overall materiality</p>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3 ring-1 ring-white/5">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Clearly trivial threshold (SUD)
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">
                  {formatUsd(clearlyTrivial)}
                </dd>
                <p className="mt-1 text-[10px] text-slate-600">5% of overall materiality</p>
              </div>
            </dl>
            <div className="mt-6 border-t border-slate-800/80 pt-4 text-xs text-slate-500">
              Overall materiality:{" "}
              <span className="font-mono text-slate-300">{formatUsd(overallMateriality)}</span>
              {" · "}
              PM: <span className="font-mono text-slate-300">{formatUsd(performanceMateriality)}</span>
              {" · "}
              SUD: <span className="font-mono text-slate-300">{formatUsd(clearlyTrivial)}</span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-4 ring-1 ring-white/5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-100">AI Audit Analysis</h3>
              {riskInsights.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setRiskInsights([])}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Clear Analysis
                </button>
              ) : null}
            </div>
            {aiAnalysisError ? (
              <p className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {aiAnalysisError}
              </p>
            ) : null}
            {riskInsights.length === 0 && !aiAnalysisError ? (
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                Run AI Audit Analysis to generate risk findings from your mapped trial
                balance and current materiality thresholds.
              </p>
            ) : null}
            <div className="mt-3 space-y-3">
              {riskInsights.map((item, idx) => (
                <article
                  key={`${item.title}-${idx}`}
                  className={`rounded-lg border px-3 py-3 ${
                    item.severity === "high"
                      ? "border-rose-500/40 bg-rose-500/10"
                      : "border-amber-500/40 bg-amber-500/10"
                  }`}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      {item.risk_type}
                    </p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        item.severity === "high"
                          ? "bg-rose-500/20 text-rose-200"
                          : "bg-amber-500/20 text-amber-100"
                      }`}
                    >
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {item.severity}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-100">{item.title}</h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-300">{item.finding}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    <span className="font-semibold text-slate-300">Impact:</span> {item.impact}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    <span className="font-semibold text-slate-300">Suggested procedure:</span>{" "}
                    {item.suggested_procedure}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/30 shadow-xl ring-1 ring-white/5">
        <div className="border-b border-slate-800/80 px-5 py-4">
          <p className="text-sm font-semibold text-slate-200">
            Assertion-Based Risk Engine
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-950/60 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Account name</th>
                <th className="px-4 py-3 text-right font-medium">Prior year</th>
                <th className="px-4 py-3 text-right font-medium">Current year</th>
                <th className="px-4 py-3 text-right font-medium">Variance ($)</th>
                <th className="px-4 py-3 text-right font-medium">Variance (%)</th>
                <th className="px-4 py-3 font-medium">Risk status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-200">
              {groupedRiskRows.map((group) => (
                <Fragment key={`${group.groupKey}-group`}>
                  <tr
                    onClick={() => toggleGroup(group.groupKey)}
                    className="cursor-pointer border-b-2 border-slate-600 bg-slate-800/80 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-slate-700/80"
                  >
                    <td colSpan={2} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {expandedGroups[group.groupKey] !== false ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <span>{group.groupKey}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatUsd(group.pyTotal)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatUsd(group.cyTotal)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatUsd(group.varianceTotal)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono tabular-nums font-bold ${
                        Math.abs(group.variancePctTotal) > 50 ? "text-amber-400" : "text-slate-300"
                      }`}
                    >
                      {group.variancePctTotal.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3"></td>
                  </tr>
                  {expandedGroups[group.groupKey] !== false &&
                    group.rows.map(({ row, risk, cyNatural, pyNatural, varianceDollar, variancePercent }) => (
                      <tr
                        key={row.id}
                        className="bg-slate-950/10 transition-colors hover:bg-slate-800/25"
                      >
                        <td className="max-w-[10rem] px-4 py-2.5 text-xs text-slate-300">
                          {(row.categoryL3 ?? "").trim() ||
                            (row.categoryL2 ?? "").trim() ||
                            (row.categoryL1 ?? "").trim() ||
                            "Uncategorized"}
                        </td>
                        <td className="max-w-[14rem] px-4 py-2.5 font-medium text-slate-100">
                          {displayAccountName(row)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-slate-300">
                          {formatUsd(pyNatural)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-slate-200">
                          {formatUsd(cyNatural)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-slate-200">
                          {formatUsd(varianceDollar)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-slate-300">
                          {variancePercent.toFixed(1)}%
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <RiskStatusCell level={risk.level} reason={risk.reason} />
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
