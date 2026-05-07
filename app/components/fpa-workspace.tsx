"use client";

import { Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useStudioMemory } from "../context/studio-memory-context";
import { useFpaData } from "../hooks/use-fpa-data";
import {
  type ScenarioDrivers,
  computeForecastModel,
} from "../hooks/use-forecast-model";
import { inferScenarioFromNaturalLanguage } from "../lib/fpa-scenario-infer";
import type { TrialBalanceLine } from "../types/studio-finance";
import type { TimeHorizon } from "./fpa-charts-panel";

const FpaChartsPanelLazy = dynamic(
  () => import("./fpa-charts-panel").then((m) => m.FpaChartsPanel),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-800/80" />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="h-80 min-h-[280px] animate-pulse rounded-2xl bg-slate-900/40" />
          <div className="h-80 min-h-[280px] animate-pulse rounded-2xl bg-slate-900/40" />
        </div>
      </div>
    ),
  },
);

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

const BASELINE_FORECAST_DRIVERS: ScenarioDrivers = {
  revenueGrowth: 0.1,
  cogsMargin: 0.58,
  sgaGrowth: 0.06,
};

type ScenarioDriverInputs = {
  revenueGrowth: string;
  cogsMargin: string;
  sgaGrowth: string;
};

function isSubtotal(label: string) {
  return label === "Gross Profit" || label === "Operating Income";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toDriverInputState(drivers: ScenarioDrivers): ScenarioDriverInputs {
  return {
    revenueGrowth: (drivers.revenueGrowth * 100).toFixed(2),
    cogsMargin: (drivers.cogsMargin * 100).toFixed(2),
    sgaGrowth: (drivers.sgaGrowth * 100).toFixed(2),
  };
}

function parseNumberInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalFinite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sumTrialBalanceByL1(rows: TrialBalanceLine[], l1: string) {
  return rows.reduce((sum, row) => {
    if ((row.categoryL1 ?? "").trim() !== l1) return sum;
    const n = Number(row.cyBalance);
    return sum + (Number.isFinite(n) ? Math.abs(n) : 0);
  }, 0);
}

function sumTrialBalanceByL1Year(
  rows: TrialBalanceLine[],
  l1: string,
  year: "cy" | "py1",
) {
  return rows.reduce((sum, row) => {
    if ((row.categoryL1 ?? "").trim() !== l1) return sum;
    const raw = year === "cy" ? row.cyBalance : row.py1Balance;
    const n = Number(raw);
    return sum + (Number.isFinite(n) ? Math.abs(n) : 0);
  }, 0);
}

function sumTrialBalanceByL2(rows: TrialBalanceLine[], l2: string) {
  return rows.reduce((sum, row) => {
    if ((row.categoryL2 ?? "").trim() !== l2) return sum;
    const n = Number(row.cyBalance);
    return sum + (Number.isFinite(n) ? Math.abs(n) : 0);
  }, 0);
}

function sumTrialBalanceCashByYear(rows: TrialBalanceLine[], year: "cy" | "py1") {
  return rows.reduce((sum, row) => {
    if ((row.categoryL3 ?? "").trim() !== "Cash & Equivalents") return sum;
    const raw = year === "cy" ? row.cyBalance : row.py1Balance;
    const n = Number(raw);
    return sum + (Number.isFinite(n) ? Math.abs(n) : 0);
  }, 0);
}

function inputsToDrivers(inputs: ScenarioDriverInputs): ScenarioDrivers {
  return {
    revenueGrowth: parseNumberInput(inputs.revenueGrowth) / 100,
    cogsMargin: parseNumberInput(inputs.cogsMargin) / 100,
    sgaGrowth: parseNumberInput(inputs.sgaGrowth) / 100,
  };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const CFO_INSIGHT_DEFAULT =
  "Simulate a natural-language scenario with the AI Financial Copilot to generate a live CFO Strategic Insight narrative tied to your drivers and trial balance context.";

const EPSILON_KPI = 1e-9;

/** Single FY+1 month used by charts and KPI roll-ups. */
type ActiveForecastMonth = {
  month: string;
  period: string;
  revenue: number;
  cogs: number;
  opex: number;
  operatingIncome: number;
  operating_cash_flow: number;
  investing_cash_flow: number;
  financing_cash_flow: number;
  ending_cash_balance: number;
  aiImpact: boolean;
};

type AiAnnualProjection = {
  fy1: {
    revenue: number;
    operatingIncome: number;
    operating_cash_flow: number;
    investing_cash_flow: number;
    financing_cash_flow: number;
    ending_cash_balance: number;
  };
  fy2: {
    revenue: number;
    operatingIncome: number;
    operating_cash_flow: number;
    investing_cash_flow: number;
    financing_cash_flow: number;
    ending_cash_balance: number;
  };
};

type AiScenarioData = {
  chartRows: Array<Record<string, unknown>>;
  annualProjection: AiAnnualProjection;
};

function computeAiCashImpactIndex(
  rows: { period: string; operatingIncome: number }[],
): number {
  let bestIdx = -1;
  let largestNegative = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const period = rows[i]!.period;
    const monthIdx = MONTHS.findIndex((m) => m === period);
    if (monthIdx < 0) continue;
    const oi = rows[i]!.operatingIncome;
    if (oi < largestNegative) {
      largestNegative = oi;
      bestIdx = monthIdx;
    }
  }
  return bestIdx;
}

function buildManualActiveForecastMonths(
  annualProjection: {
    revenue: number;
    cogs: number;
    sga: number;
    operatingIncome: number;
    operating_cash_flow: number;
    investing_cash_flow: number;
    financing_cash_flow: number;
  },
  startingCash: number,
  highlightMonthIndex: number,
): ActiveForecastMonth[] {
  const revM = annualProjection.revenue / 12;
  const cogsM = annualProjection.cogs / 12;
  const sgaM = annualProjection.sga / 12;
  const oiM = annualProjection.operatingIncome / 12;
  const opcfM = annualProjection.operating_cash_flow / 12;
  const invM = annualProjection.investing_cash_flow / 12;
  const finM = annualProjection.financing_cash_flow / 12;
  const out: ActiveForecastMonth[] = [];
  let prev = startingCash;
  for (let i = 0; i < 12; i += 1) {
    const m = MONTHS[i]!;
    const net = opcfM + invM + finM;
    prev += net;
    out.push({
      month: m,
      period: m,
      revenue: revM,
      cogs: cogsM,
      opex: sgaM,
      operatingIncome: oiM,
      operating_cash_flow: opcfM,
      investing_cash_flow: invM,
      financing_cash_flow: finM,
      ending_cash_balance: prev,
      aiImpact: highlightMonthIndex >= 0 && i === highlightMonthIndex,
    });
  }
  return out;
}

function buildAiActiveForecastMonths(
  chartRows: Array<Record<string, unknown>>,
  startingCash: number,
  cyCogs: number,
  cyRev: number,
  cySga: number,
  highlightMonthIndex: number,
): ActiveForecastMonth[] {
  const split = cyCogs + cySga > EPSILON_KPI ? cyCogs / (cyCogs + cySga) : 0.5;
  const out: ActiveForecastMonth[] = [];
  let rolling = startingCash;
  const rows = chartRows.slice(0, 12);
  for (let i = 0; i < 12; i += 1) {
    const row = rows[i] ?? {};
    const month =
      typeof row.month === "string"
        ? row.month
        : typeof row.period === "string"
          ? row.period
          : MONTHS[i]!;
    const period = typeof row.period === "string" ? row.period : month;
    const revenue = Number(row.revenueBar) || 0;
    const operatingIncome = Number(row.operating_income) || 0;
    const nonOpex = revenue - operatingIncome;
    const cogs = Math.max(0, nonOpex * split);
    const opex = Math.max(0, nonOpex - cogs);
    const opcf = Number(row.operating_cash_flow) || Number(row.operating_cash) || 0;
    const inv = Number(row.investing_cash_flow) || 0;
    const fin = Number(row.financing_cash_flow) || 0;
    rolling += opcf + inv + fin;
    const ending = rolling;
    rolling = ending;
    out.push({
      month,
      period,
      revenue,
      cogs,
      opex,
      operatingIncome,
      operating_cash_flow: opcf,
      investing_cash_flow: inv,
      financing_cash_flow: fin,
      ending_cash_balance: ending,
      aiImpact: highlightMonthIndex >= 0 && i === highlightMonthIndex,
    });
  }
  return out;
}

type FpaScenarioApiPayload = {
  rev_growth?: number;
  cogs_target?: number;
  sga_stepup?: number;
  chart_data?: Array<Record<string, unknown>>;
  cfo_insight?: string;
  thought_process?: string;
  ai_highlight_rows?: string[];
  forecast_updates?: {
    rev_growth?: number;
    cogs_target?: number;
    sga_stepup?: number;
  } | null;
};

function getChangedDriverKeys(
  prev: ScenarioDriverInputs,
  next: ScenarioDriverInputs,
): Array<keyof ScenarioDriverInputs> {
  const keys: Array<keyof ScenarioDriverInputs> = [
    "revenueGrowth",
    "cogsMargin",
    "sgaGrowth",
  ];
  return keys.filter((k) => prev[k] !== next[k]);
}

function mapForecastUpdatesToDriverInputs(
  current: ScenarioDrivers,
  next: NonNullable<FpaScenarioApiPayload["forecast_updates"]>,
): ScenarioDriverInputs {
  return {
    revenueGrowth: clamp(
      parseOptionalFinite(next.rev_growth) ?? current.revenueGrowth * 100,
      -100,
      100,
    ).toFixed(2),
    cogsMargin: clamp(
      parseOptionalFinite(next.cogs_target) ?? current.cogsMargin * 100,
      0,
      100,
    ).toFixed(2),
    sgaGrowth: clamp(
      parseOptionalFinite(next.sga_stepup) ?? current.sgaGrowth * 100,
      -100,
      100,
    ).toFixed(2),
  };
}

function mapForecastUpdatesToPercentPoints(
  current: ScenarioDrivers,
  next: NonNullable<FpaScenarioApiPayload["forecast_updates"]>,
): {
  revenueGrowth: number;
  cogsMargin: number;
  sgaGrowth: number;
} {
  const inputs = mapForecastUpdatesToDriverInputs(current, next);
  return {
    revenueGrowth: parseNumberInput(inputs.revenueGrowth),
    cogsMargin: parseNumberInput(inputs.cogsMargin),
    sgaGrowth: parseNumberInput(inputs.sgaGrowth),
  };
}

function toPctString(value: number) {
  return value.toFixed(2);
}

function computeHistoricalDriverInputDefaults(
  trialBalance: TrialBalanceLine[],
): ScenarioDriverInputs {
  const pyRevenue = sumTrialBalanceByL1Year(trialBalance, "Revenue", "py1");
  const cyRevenue = sumTrialBalanceByL1Year(trialBalance, "Revenue", "cy");
  const cyCogs = sumTrialBalanceByL1Year(trialBalance, "COGS", "cy");
  const pySga = sumTrialBalanceByL1Year(trialBalance, "SG&A", "py1");
  const cySga = sumTrialBalanceByL1Year(trialBalance, "SG&A", "cy");

  const revenueGrowthPct =
    pyRevenue > EPSILON_KPI ? ((cyRevenue - pyRevenue) / pyRevenue) * 100 : 0;
  const cogsTargetPct = cyRevenue > EPSILON_KPI ? (cyCogs / cyRevenue) * 100 : 0;
  const sgaStepupPct = pySga > EPSILON_KPI ? ((cySga - pySga) / pySga) * 100 : 0;

  return {
    revenueGrowth: toPctString(revenueGrowthPct),
    cogsMargin: toPctString(cogsTargetPct),
    sgaGrowth: toPctString(sgaStepupPct),
  };
}

function forceOutflowBelowZero(value: number) {
  return value > 0 ? -value : value;
}

function normalizeOutflowForChart(value: number, isExplicitInflow?: boolean) {
  if (isExplicitInflow) return value;
  return forceOutflowBelowZero(value);
}

export function FpaWorkspace() {
  const { trialBalance, cashFlowLines } = useStudioMemory();
  const historicalDriverDefaults = useMemo(
    () => computeHistoricalDriverInputDefaults(trialBalance),
    [trialBalance],
  );
  const fpaTotals = useFpaData(trialBalance);
  const [forecastDrivers, setForecastDrivers] = useState<ScenarioDriverInputs>(() =>
    computeHistoricalDriverInputDefaults(trialBalance),
  );
  const [nlScenario, setNlScenario] = useState("");
  const [cfoInsight, setCfoInsight] = useState(CFO_INSIGHT_DEFAULT);
  const [, setAiHighlightRows] = useState<string[]>([]);
  const [aiUpdatedFields, setAiUpdatedFields] = useState<
    Partial<Record<keyof ScenarioDriverInputs, boolean>>
  >({});
  const [aiScenarioData, setAiScenarioData] = useState<AiScenarioData | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const [isSimulationActive, setIsSimulationActive] = useState(false);
  const [simulationDisplayPercents, setSimulationDisplayPercents] = useState<{
    revenueGrowth: number;
    cogsMargin: number;
    sgaGrowth: number;
  } | null>(null);
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>("annual");
  const activeDriverInputs = forecastDrivers;
  const activeForecastDrivers = useMemo(() => inputsToDrivers(forecastDrivers), [forecastDrivers]);
  const baselineModel = useMemo(
    () => computeForecastModel(trialBalance, BASELINE_FORECAST_DRIVERS),
    [trialBalance],
  );

  const hasTrialBalanceData = trialBalance.length > 0;

  const startingCash = useMemo(() => {
    const cyCash = sumTrialBalanceCashByYear(trialBalance, "cy");
    if (Number.isFinite(cyCash) && cyCash > 0) return cyCash;
    const wc = fpaTotals.currentAssetsCy - fpaTotals.currentLiabilitiesCy;
    if (Number.isFinite(wc) && wc > 0) return wc;
    return 0;
  }, [fpaTotals.currentAssetsCy, fpaTotals.currentLiabilitiesCy, trialBalance]);
  const pyEndingCashActual = useMemo(
    () => sumTrialBalanceCashByYear(trialBalance, "py1"),
    [trialBalance],
  );
  const cyEndingCashActual = useMemo(
    () => sumTrialBalanceCashByYear(trialBalance, "cy"),
    [trialBalance],
  );
  const historicalCashFlowTotals = useMemo(() => {
    const totals = {
      py: { operating: 0, investing: 0, financing: 0 },
      cy: { operating: 0, investing: 0, financing: 0 },
    };
    for (const row of cashFlowLines) {
      const category = (row.category ?? "").trim();
      if (!category || category === "Beginning Cash Balance" || category === "Ending Cash Balance") {
        continue;
      }
      if (category === "Supplemental / Non-Operating") continue;

      const cy = Number(row.cyBalance);
      const py1 = Number(row.py1Balance);
      const cyAmount = Number.isFinite(cy) ? cy : 0;
      const pyAmount = Number.isFinite(py1) ? py1 : 0;

      if (category.startsWith("Operating")) {
        totals.cy.operating += cyAmount;
        totals.py.operating += pyAmount;
      } else if (category === "Investing Activities") {
        totals.cy.investing += cyAmount;
        totals.py.investing += pyAmount;
      } else if (category === "Financing Activities") {
        totals.cy.financing += cyAmount;
        totals.py.financing += pyAmount;
      }
    }
    return totals;
  }, [cashFlowLines]);

  const cyRevenueActual = useMemo(() => sumTrialBalanceByL1(trialBalance, "Revenue"), [trialBalance]);
  const cyCogsActual = useMemo(() => sumTrialBalanceByL1(trialBalance, "COGS"), [trialBalance]);
  const cySgaActual = useMemo(() => sumTrialBalanceByL1(trialBalance, "SG&A"), [trialBalance]);
  const cyOperatingIncomeActual = cyRevenueActual - cyCogsActual - cySgaActual;
  const baselineManualProjection = useMemo(() => {
    const calcRevGrowth = activeForecastDrivers.revenueGrowth;
    const calcCogsTarget = activeForecastDrivers.cogsMargin;
    const calcSgaStepup = activeForecastDrivers.sgaGrowth;
    const operatingCfRatio =
      Math.abs(cyOperatingIncomeActual) > EPSILON_KPI
        ? historicalCashFlowTotals.cy.operating / cyOperatingIncomeActual
        : 0;
    const investingCfRatio =
      Math.abs(cyRevenueActual) > EPSILON_KPI
        ? historicalCashFlowTotals.cy.investing / cyRevenueActual
        : 0;

    const fy1Revenue = cyRevenueActual * (1 + calcRevGrowth);
    const fy1Cogs = fy1Revenue * calcCogsTarget;
    const fy1Sga = cySgaActual * (1 + calcSgaStepup);
    const fy1OperatingIncome = fy1Revenue - fy1Cogs - fy1Sga;
    const fy1OperatingCashFlow = fy1OperatingIncome * operatingCfRatio;
    const fy1InvestingCashFlow = fy1Revenue * investingCfRatio;
    const fy1FinancingCashFlow = historicalCashFlowTotals.cy.financing;

    return {
      revenue: fy1Revenue,
      cogs: fy1Cogs,
      sga: fy1Sga,
      operatingIncome: fy1OperatingIncome,
      operating_cash_flow: fy1OperatingCashFlow,
      investing_cash_flow: forceOutflowBelowZero(fy1InvestingCashFlow),
      financing_cash_flow: forceOutflowBelowZero(fy1FinancingCashFlow),
    };
  }, [
    activeForecastDrivers.cogsMargin,
    activeForecastDrivers.revenueGrowth,
    activeForecastDrivers.sgaGrowth,
    cyOperatingIncomeActual,
    cyRevenueActual,
    cySgaActual,
    historicalCashFlowTotals.cy.financing,
    historicalCashFlowTotals.cy.investing,
    historicalCashFlowTotals.cy.operating,
  ]);
  const currentBalances = useMemo(() => {
    const ppe = sumTrialBalanceByL2(trialBalance, "Property, Plant & Equipment (PPE)");
    const intangible = sumTrialBalanceByL2(trialBalance, "Intangible Assets");
    const currentAssets = sumTrialBalanceByL2(trialBalance, "Current Assets");
    const currentLiabilities = sumTrialBalanceByL2(trialBalance, "Current Liabilities");
    const nonCurrentLiabilities = sumTrialBalanceByL2(
      trialBalance,
      "Non-Current Liabilities",
    );
    const inventory = trialBalance.reduce((sum, row) => {
      if ((row.categoryL3 ?? "").trim() !== "Inventory") return sum;
      const n = Number(row.cyBalance);
      return sum + (Number.isFinite(n) ? Math.abs(n) : 0);
    }, 0);
    return {
      property_plant_equipment: ppe,
      intangible_assets: intangible,
      inventory,
      current_assets: currentAssets,
      current_liabilities: currentLiabilities,
      non_current_liabilities: nonCurrentLiabilities,
    };
  }, [trialBalance]);

  /** Used only to pick the highlighted investing bar month before building full active rows. */
  const revenueOiSeriesForHighlight = useMemo(() => {
    if (aiScenarioData?.chartRows?.length) {
      return aiScenarioData.chartRows.slice(0, 12).map((row, i) => ({
        period:
          typeof row.period === "string"
            ? row.period
            : typeof row.month === "string"
              ? row.month
              : MONTHS[i]!,
        operatingIncome: Number(row.operating_income) || 0,
      }));
    }
    const oiM = baselineManualProjection.operatingIncome / 12;
    return MONTHS.map((m) => ({ period: m, operatingIncome: oiM }));
  }, [aiScenarioData, baselineManualProjection.operatingIncome]);

  const aiCashImpactMonthIndex = useMemo(
    () => computeAiCashImpactIndex(revenueOiSeriesForHighlight),
    [revenueOiSeriesForHighlight],
  );

  const activeForecastData = useMemo((): ActiveForecastMonth[] => {
    if (aiScenarioData?.chartRows?.length) {
      return buildAiActiveForecastMonths(
        aiScenarioData.chartRows,
        startingCash,
        cyCogsActual,
        cyRevenueActual,
        cySgaActual,
        aiCashImpactMonthIndex,
      );
    }
    return buildManualActiveForecastMonths(
      baselineManualProjection,
      startingCash,
      aiCashImpactMonthIndex,
    );
  }, [
    aiScenarioData,
    baselineManualProjection,
    startingCash,
    cyCogsActual,
    cyRevenueActual,
    cySgaActual,
    aiCashImpactMonthIndex,
  ]);

  const activeForecastKpis = useMemo(() => {
    const fy1Revenue = activeForecastData.reduce((s, m) => s + m.revenue, 0);
    const fy1Cogs = activeForecastData.reduce((s, m) => s + m.cogs, 0);
    const fy1Opex = activeForecastData.reduce((s, m) => s + m.opex, 0);
    const fy1OperatingIncome = fy1Revenue - fy1Cogs - fy1Opex;
    const grossMarginPct =
      fy1Revenue > EPSILON_KPI ? (fy1Revenue - fy1Cogs) / fy1Revenue : 0;
    const operatingMarginPct =
      fy1Revenue > EPSILON_KPI ? fy1OperatingIncome / fy1Revenue : 0;
    const totalNetCash = activeForecastData.reduce(
      (s, m) =>
        s + m.operating_cash_flow + m.investing_cash_flow + m.financing_cash_flow,
      0,
    );
    const monthlyNetCash = totalNetCash / 12;
    return {
      fy1Revenue,
      fy1Cogs,
      fy1Opex,
      fy1OperatingIncome,
      grossMarginPct,
      operatingMarginPct,
      monthlyNetCash,
    };
  }, [activeForecastData]);

  const trajectoryComposedData = useMemo(
    () =>
      activeForecastData.map((m) => ({
        month: m.month,
        period: m.period,
        revenue: m.revenue,
        operatingIncome: m.operatingIncome,
      })),
    [activeForecastData],
  );

  const annualTrajectoryData = useMemo(() => {
    const pyRevenue = baselineModel.pyActuals.revenue;
    const pyOi =
      baselineModel.pyActuals.revenue - baselineModel.pyActuals.cogs - baselineModel.pyActuals.sga;
    const cyRevenue = cyRevenueActual;
    const cyOi = cyRevenueActual - cyCogsActual - cySgaActual;

    const fy1Revenue = activeForecastKpis.fy1Revenue;
    const fy1Oi = activeForecastKpis.fy1OperatingIncome;

    return [
      { month: "PY", period: "PY", revenue: pyRevenue, operatingIncome: pyOi },
      { month: "CY", period: "CY", revenue: cyRevenue, operatingIncome: cyOi },
      { month: "FY+1", period: "FY+1", revenue: fy1Revenue, operatingIncome: fy1Oi },
    ];
  }, [
    activeForecastKpis.fy1OperatingIncome,
    activeForecastKpis.fy1Revenue,
    cyCogsActual,
    cyRevenueActual,
    cySgaActual,
    baselineModel,
  ]);

  const annualCashFlowData = useMemo(() => {
    const fy1Rev = activeForecastKpis.fy1Revenue;
    const yearRows = [
      {
        year: "PY",
        revenue: baselineModel.pyActuals.revenue,
        operatingIncome:
          baselineModel.pyActuals.revenue - baselineModel.pyActuals.cogs - baselineModel.pyActuals.sga,
      },
      {
        year: "CY",
        revenue: cyRevenueActual,
        operatingIncome: cyRevenueActual - cyCogsActual - cySgaActual,
      },
      {
        year: "FY+1",
        revenue: fy1Rev,
        operatingIncome: activeForecastKpis.fy1OperatingIncome,
      },
    ];

    const aiProj = aiScenarioData?.annualProjection;

    return yearRows.map((row) => {
      const operatingCash =
        row.year === "FY+1" && aiProj
          ? aiProj.fy1.operating_cash_flow
          : row.year === "FY+1"
            ? activeForecastData.reduce((s, m) => s + m.operating_cash_flow, 0)
            : row.year === "PY"
              ? historicalCashFlowTotals.py.operating
              : historicalCashFlowTotals.cy.operating;
      const investingOut =
        row.year === "FY+1" && aiProj
          ? aiProj.fy1.investing_cash_flow
          : row.year === "FY+1"
            ? activeForecastData.reduce((s, m) => s + m.investing_cash_flow, 0)
            : row.year === "PY"
              ? historicalCashFlowTotals.py.investing
              : historicalCashFlowTotals.cy.investing;
      const financingOut =
        row.year === "FY+1" && aiProj
          ? aiProj.fy1.financing_cash_flow
          : row.year === "FY+1"
            ? activeForecastData.reduce((s, m) => s + m.financing_cash_flow, 0)
            : row.year === "PY"
              ? historicalCashFlowTotals.py.financing
              : historicalCashFlowTotals.cy.financing;
      const endingCash =
        row.year === "PY"
          ? pyEndingCashActual
          : row.year === "CY"
            ? cyEndingCashActual
            : activeForecastData.length
              ? activeForecastData[activeForecastData.length - 1]!.ending_cash_balance
              : startingCash + operatingCash + investingOut + financingOut;
      return {
        year: row.year,
        operating_cash_flow: operatingCash,
        investing_cash_flow: normalizeOutflowForChart(investingOut),
        financing_cash_flow: normalizeOutflowForChart(financingOut),
        ending_cash_balance: endingCash,
        aiImpact: false,
      };
    });
  }, [
    activeForecastData,
    activeForecastKpis.fy1OperatingIncome,
    activeForecastKpis.fy1Revenue,
    aiScenarioData,
    cyCogsActual,
    cyRevenueActual,
    cySgaActual,
    baselineModel.pyActuals.cogs,
    baselineModel.pyActuals.revenue,
    baselineModel.pyActuals.sga,
    cyEndingCashActual,
    historicalCashFlowTotals,
    pyEndingCashActual,
    startingCash,
  ]);

  const kpiCards = useMemo(() => {
    const k = activeForecastKpis;
    const burn = k.monthlyNetCash < 0;
    return [
      {
        label: "Forecast Gross Margin",
        value: formatPct(k.grossMarginPct),
        valueClass: "text-white",
        suffix: "",
      },
      {
        label: "Forecast Operating Margin",
        value: formatPct(k.operatingMarginPct),
        valueClass: "text-white",
        suffix: "",
      },
      {
        label: burn ? "Monthly cash burn (avg.)" : "Monthly cash generation (avg.)",
        value: formatUsd(Math.abs(k.monthlyNetCash)),
        valueClass: burn ? "text-rose-400" : "text-emerald-300",
        suffix: burn ? " Burn" : "",
      },
      {
        label: "FY+1 Operating Income",
        value: formatUsd(k.fy1OperatingIncome),
        valueClass: "text-white",
        suffix: "",
      },
    ];
  }, [activeForecastKpis]);

  const revenueProfitChartData = useMemo(
    () => (timeHorizon === "annual" ? annualTrajectoryData : trajectoryComposedData),
    [timeHorizon, annualTrajectoryData, trajectoryComposedData],
  );

  const monthlyCashFlowSeries = useMemo(
    () =>
      activeForecastData.map((m) => ({
        month: m.month,
        operating_cash_flow: m.operating_cash_flow,
        investing_cash_flow: normalizeOutflowForChart(
          m.investing_cash_flow,
          (m as ActiveForecastMonth & { investing_is_inflow?: boolean }).investing_is_inflow,
        ),
        financing_cash_flow: normalizeOutflowForChart(
          m.financing_cash_flow,
          (m as ActiveForecastMonth & { financing_is_inflow?: boolean }).financing_is_inflow,
        ),
        ending_cash_balance: m.ending_cash_balance,
        aiImpact: m.aiImpact,
      })),
    [activeForecastData],
  );

  const cashFlowChartDataForComposed = useMemo(() => {
    if (timeHorizon === "annual") {
      return annualCashFlowData.map((r) => ({ ...r, month: r.year }));
    }
    return monthlyCashFlowSeries;
  }, [timeHorizon, annualCashFlowData, monthlyCashFlowSeries]);

  const comparisonRows = useMemo(() => {
    const k = activeForecastKpis;
    const fyRev = k.fy1Revenue;
    const fyCogs = k.fy1Cogs;
    const fySga = k.fy1Opex;
    const fyGp = fyRev - fyCogs;
    const fyOi = k.fy1OperatingIncome;
    const forecastByLabel: Record<string, number> = {
      Revenue: fyRev,
      COGS: fyCogs,
      "Gross Profit": fyGp,
      "SG&A": fySga,
      "Operating Income": fyOi,
    };
    const byLabel = (m: (typeof baselineModel)["tableRows"]) =>
      Object.fromEntries(m.map((r) => [r.label, r])) as Record<
        string,
        (typeof baselineModel)["tableRows"][number]
      >;
    const b = byLabel(baselineModel.tableRows);
    const labels = baselineModel.tableRows.map((r) => r.label);
    return labels.map((label) => {
      const rowB = b[label]!;
      return {
        label,
        py: rowB.pyActual,
        cy: rowB.cyCurrent,
        forecast: forecastByLabel[label] ?? 0,
      };
    });
  }, [activeForecastKpis, baselineModel.tableRows]);

  function updateDriverInput<K extends keyof ScenarioDriverInputs>(
    key: K,
    value: ScenarioDriverInputs[K],
  ) {
    setForecastDrivers((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function clampPercentInputOnBlur(
    key: "revenueGrowth" | "cogsMargin" | "sgaGrowth",
    min: number,
    max: number,
  ) {
    const rawValue = activeDriverInputs[key].trim();
    const parsedValue = Number(rawValue);

    if (rawValue === "" || !Number.isFinite(parsedValue)) {
      updateDriverInput(key, "0.00");
      return;
    }

    const clamped = clamp(parsedValue, min, max);
    updateDriverInput(key, clamped.toFixed(2));
  }

  const flashDriverFieldDiff = useCallback(
    (prev: ScenarioDriverInputs, next: ScenarioDriverInputs) => {
      const changed = getChangedDriverKeys(prev, next);
      if (changed.length > 0) {
        const marker: Partial<Record<keyof ScenarioDriverInputs, boolean>> = {};
        for (const k of changed) marker[k] = true;
        setAiUpdatedFields(marker);
        setTimeout(() => setAiUpdatedFields({}), 1200);
      } else {
        setAiUpdatedFields({});
      }
    },
    [],
  );

  const simulateScenario = useCallback(async () => {
    const prompt = nlScenario.trim();
    if (!prompt) {
      setSimulateError("Describe a scenario in the copilot field first.");
      return;
    }
    setSimulateError(null);
    setSimulating(true);
    const prevDriverInputStrings: ScenarioDriverInputs = { ...forecastDrivers };
    const snapshot = inputsToDrivers(forecastDrivers);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "fpa_scenario",
          prompt,
          currentYearTotals: {
            cy_revenue: cyRevenueActual,
            cy_cogs: cyCogsActual,
            cy_opex: cySgaActual,
          },
          currentBalances,
          forecastDrivers: {
            revenueGrowth: snapshot.revenueGrowth,
            cogsMargin: snapshot.cogsMargin,
            sgaGrowth: snapshot.sgaGrowth,
          },
        }),
      });
      const raw: unknown = await res.json().catch(() => null);
      if (res.ok && raw && typeof raw === "object") {
        const data = raw as FpaScenarioApiPayload;
        const fu = data.forecast_updates;
        const hasForecastUpdates =
          fu !== null &&
          fu !== undefined &&
          typeof fu === "object" &&
          (Number.isFinite(Number((fu as { rev_growth?: unknown }).rev_growth)) ||
            Number.isFinite(Number((fu as { cogs_target?: unknown }).cogs_target)) ||
            Number.isFinite(Number((fu as { sga_stepup?: unknown }).sga_stepup)));

        let resolvedForModel: ScenarioDriverInputs | null = null;
        if (hasForecastUpdates) {
          resolvedForModel = mapForecastUpdatesToDriverInputs(snapshot, fu);
          setForecastDrivers(resolvedForModel);
          setIsSimulationActive(true);
          setSimulationDisplayPercents(mapForecastUpdatesToPercentPoints(snapshot, fu));
          flashDriverFieldDiff(prevDriverInputStrings, resolvedForModel);
        } else {
          setIsSimulationActive(false);
          setSimulationDisplayPercents(null);
          setAiUpdatedFields({});
        }

        const driversForFy2 = inputsToDrivers(resolvedForModel ?? prevDriverInputStrings);
        const modelForFy2 = computeForecastModel(trialBalance, driversForFy2);
        if (typeof data.cfo_insight === "string" && data.cfo_insight.trim()) {
          setCfoInsight(data.cfo_insight.trim());
        }
        if (Array.isArray(data.ai_highlight_rows)) {
          setAiHighlightRows(
            data.ai_highlight_rows.filter((x): x is string => typeof x === "string"),
          );
        } else {
          setAiHighlightRows([]);
        }
        if (Array.isArray(data.chart_data)) {
          const chartData = data.chart_data.slice(0, 12);

          if (chartData.length > 0) {
            type Fy1Agg = {
              revenue: number;
              operatingIncome: number;
              operating_cash_flow: number;
              investing_cash_flow: number;
              financing_cash_flow: number;
            };
            const fy1Agg = chartData.reduce<Fy1Agg>(
              (acc, row) => {
                acc.revenue += Number(row.revenueBar) || 0;
                acc.operatingIncome += Number(row.operating_income) || 0;
                acc.operating_cash_flow +=
                  Number(row.operating_cash_flow) || Number(row.operating_cash) || 0;
                acc.investing_cash_flow += Number(row.investing_cash_flow) || 0;
                acc.financing_cash_flow += Number(row.financing_cash_flow) || 0;
                return acc;
              },
              {
                revenue: 0,
                operatingIncome: 0,
                operating_cash_flow: 0,
                investing_cash_flow: 0,
                financing_cash_flow: 0,
              },
            );
            const dec = chartData[chartData.length - 1];
            const fy1EndingCash =
              Number(dec?.ending_cash_balance) || Number(dec?.endingCash) || startingCash;

            const fy2Revenue = fy1Agg.revenue * (1 + driversForFy2.revenueGrowth);
            const fy2OperatingIncome =
              fy2Revenue -
              fy2Revenue * driversForFy2.cogsMargin -
              modelForFy2.forecast.sga * (1 + driversForFy2.sgaGrowth);
            const fy2OperatingCashFlow = fy1Agg.operating_cash_flow;
            const fy2InvestingCashFlow = fy1Agg.investing_cash_flow;
            const fy2FinancingCashFlow = fy1Agg.financing_cash_flow;
            const fy2EndingCash =
              fy1EndingCash +
              fy2OperatingCashFlow +
              fy2InvestingCashFlow +
              fy2FinancingCashFlow;

            setAiScenarioData({
              chartRows: chartData,
              annualProjection: {
                fy1: {
                  revenue: fy1Agg.revenue,
                  operatingIncome: fy1Agg.operatingIncome,
                  operating_cash_flow: fy1Agg.operating_cash_flow,
                  investing_cash_flow: fy1Agg.investing_cash_flow,
                  financing_cash_flow: fy1Agg.financing_cash_flow,
                  ending_cash_balance: fy1EndingCash,
                },
                fy2: {
                  revenue: fy2Revenue,
                  operatingIncome: fy2OperatingIncome,
                  operating_cash_flow: fy2OperatingCashFlow,
                  investing_cash_flow: fy2InvestingCashFlow,
                  financing_cash_flow: fy2FinancingCashFlow,
                  ending_cash_balance: fy2EndingCash,
                },
              },
            });
          } else {
            setAiScenarioData(null);
          }
        } else {
          setAiScenarioData(null);
        }
        return;
      }
      if (res.status >= 500) {
        setSimulateError("Scenario generation failed. Please try again.");
        return;
      }
      const inferred = inferScenarioFromNaturalLanguage(prompt, snapshot);
      const inferredInputs = toDriverInputState(inferred.drivers);
      setIsSimulationActive(false);
      setSimulationDisplayPercents(null);
      setForecastDrivers(inferredInputs);
      flashDriverFieldDiff(prevDriverInputStrings, inferredInputs);
      setCfoInsight(inferred.cfoInsight);
      setAiHighlightRows(inferred.aiHighlightRows);
      setAiScenarioData(null);
      if (!res.ok && raw && typeof raw === "object" && "error" in raw) {
        setSimulateError(
          String((raw as { error?: unknown }).error ?? "API error; applied offline heuristic."),
        );
      }
    } catch {
      const inferred = inferScenarioFromNaturalLanguage(prompt, snapshot);
      const inferredInputs = toDriverInputState(inferred.drivers);
      setIsSimulationActive(false);
      setSimulationDisplayPercents(null);
      setForecastDrivers(inferredInputs);
      flashDriverFieldDiff(prevDriverInputStrings, inferredInputs);
      setCfoInsight(inferred.cfoInsight);
      setAiHighlightRows(inferred.aiHighlightRows);
      setAiScenarioData(null);
      setSimulateError("Network error; applied offline heuristic drivers.");
    } finally {
      setSimulating(false);
    }
  }, [
    flashDriverFieldDiff,
    forecastDrivers,
    nlScenario,
    cyCogsActual,
    cyRevenueActual,
    cySgaActual,
    currentBalances,
    startingCash,
    trialBalance,
  ]);

  const handleResetToBaseline = useCallback(() => {
    setAiScenarioData(null);
    setNlScenario("");
    setIsSimulationActive(false);
    setSimulationDisplayPercents(null);
    setForecastDrivers(historicalDriverDefaults);
    setCfoInsight(CFO_INSIGHT_DEFAULT);
    setAiHighlightRows([]);
    setAiUpdatedFields({});
    setSimulateError(null);
  }, [historicalDriverDefaults]);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-8 px-4 py-10 sm:px-6 lg:px-10">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          Module 03
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          FP&amp;A Forecast · AI-Driven Scenario Modeler
        </h1>
        <div className="rounded-2xl border border-violet-500/25 bg-gradient-to-br from-slate-900/80 via-slate-900/50 to-indigo-950/40 p-5 shadow-lg ring-1 ring-violet-400/10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200/90">
            CFO Strategic Insight
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-200/95">{cfoInsight}</p>
        </div>
      </header>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 space-y-4 lg:sticky lg:top-24 lg:w-[min(100%,280px)]">
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/50 p-5 shadow-lg ring-1 ring-white/5">
            <h2 className="text-sm font-semibold tracking-tight text-white">
              ✨ AI Financial Copilot
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Describe a business event in plain language. The active simulation updates a single
              forecast path using GAAP-driven assumptions.
            </p>
            <textarea
              value={nlScenario}
              onChange={(e) => setNlScenario(e.target.value)}
              rows={6}
              placeholder='e.g., "Increase Q3 marketing spend by $600k and assume 4% lift in revenue conversion starting July."'
              className="mt-4 w-full resize-y rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-3 text-sm text-slate-100 outline-none ring-violet-400/0 transition placeholder:text-slate-500 focus:border-violet-500/50 focus:ring-2 focus:ring-violet-400/30"
            />
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void simulateScenario()}
                disabled={simulating}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
                {simulating ? "Simulating…" : "Simulate Scenario"}
              </button>
              <button
                type="button"
                onClick={handleResetToBaseline}
                className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Reset to Baseline
              </button>
            </div>
            {simulateError ? (
              <p className="mt-2 text-xs text-amber-300/90">{simulateError}</p>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-8">
          <section className="rounded-2xl border border-slate-800/90 bg-slate-900/35 p-6 shadow-lg ring-1 ring-white/5">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/55 p-4 ring-1 ring-white/5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Revenue growth %
                    </span>
                    {isSimulationActive && simulationDisplayPercents ? (
                      <span
                        className="shrink-0 rounded-md border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200"
                        title="AI forecast_updates · rev_growth"
                      >
                        AI
                      </span>
                    ) : null}
                  </div>
                  {isSimulationActive && simulationDisplayPercents ? (
                    <div
                      className="text-xl font-bold tabular-nums text-cyan-400"
                      aria-live="polite"
                    >
                      {simulationDisplayPercents.revenueGrowth.toFixed(2)}%
                    </div>
                  ) : (
                    <input
                      type="number"
                      min={-100}
                      max={100}
                      step={0.01}
                      aria-label="Revenue growth percent"
                      value={activeDriverInputs.revenueGrowth}
                      onChange={(e) => updateDriverInput("revenueGrowth", e.target.value)}
                      onBlur={() => clampPercentInputOnBlur("revenueGrowth", -100, 100)}
                      className={`w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition focus:ring-2 ${
                        aiUpdatedFields.revenueGrowth
                          ? "border-emerald-400 ring-2 ring-emerald-300/50 bg-emerald-500/10"
                          : "border-slate-700 focus:border-cyan-500/40 focus:ring-cyan-500/20"
                      }`}
                    />
                  )}
                </div>

                <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/55 p-4 ring-1 ring-white/5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Target COGS %
                    </span>
                    {isSimulationActive && simulationDisplayPercents ? (
                      <span
                        className="shrink-0 rounded-md border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200"
                        title="AI forecast_updates · cogs_target"
                      >
                        AI
                      </span>
                    ) : null}
                  </div>
                  {isSimulationActive && simulationDisplayPercents ? (
                    <div
                      className="text-xl font-bold tabular-nums text-cyan-400"
                      aria-live="polite"
                    >
                      {simulationDisplayPercents.cogsMargin.toFixed(2)}%
                    </div>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      aria-label="Target COGS percent"
                      value={activeDriverInputs.cogsMargin}
                      onChange={(e) => updateDriverInput("cogsMargin", e.target.value)}
                      onBlur={() => clampPercentInputOnBlur("cogsMargin", 0, 100)}
                      className={`w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition focus:ring-2 ${
                        aiUpdatedFields.cogsMargin
                          ? "border-emerald-400 ring-2 ring-emerald-300/50 bg-emerald-500/10"
                          : "border-slate-700 focus:border-cyan-500/40 focus:ring-cyan-500/20"
                      }`}
                    />
                  )}
                </div>

                <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/55 p-4 ring-1 ring-white/5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      SG&amp;A step-up %
                    </span>
                    {isSimulationActive && simulationDisplayPercents ? (
                      <span
                        className="shrink-0 rounded-md border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200"
                        title="AI forecast_updates · sga_stepup"
                      >
                        AI
                      </span>
                    ) : null}
                  </div>
                  {isSimulationActive && simulationDisplayPercents ? (
                    <div
                      className="text-xl font-bold tabular-nums text-cyan-400"
                      aria-live="polite"
                    >
                      {simulationDisplayPercents.sgaGrowth.toFixed(2)}%
                    </div>
                  ) : (
                    <input
                      type="number"
                      min={-100}
                      max={100}
                      step={0.01}
                      aria-label="SG&A step-up percent"
                      value={activeDriverInputs.sgaGrowth}
                      onChange={(e) => updateDriverInput("sgaGrowth", e.target.value)}
                      onBlur={() => clampPercentInputOnBlur("sgaGrowth", -100, 100)}
                      className={`w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition focus:ring-2 ${
                        aiUpdatedFields.sgaGrowth
                          ? "border-emerald-400 ring-2 ring-emerald-300/50 bg-emerald-500/10"
                          : "border-slate-700 focus:border-cyan-500/40 focus:ring-cyan-500/20"
                      }`}
                    />
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpiCards.map((card) => (
              <article
                key={card.label}
                className="rounded-2xl border border-slate-800/90 bg-slate-900/40 p-5 shadow-lg ring-1 ring-white/5"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {card.label}
                </p>
                <p
                  className={[
                    "mt-2 text-2xl font-semibold tracking-tight",
                    card.valueClass ?? "text-white",
                  ].join(" ")}
                >
                  {card.value}
                  {card.suffix ? (
                    <span className="text-lg font-semibold">{card.suffix}</span>
                  ) : null}
                </p>
              </article>
            ))}
          </section>

          <FpaChartsPanelLazy
            timeHorizon={timeHorizon}
            onTimeHorizonChange={setTimeHorizon}
            revenueProfitChartData={revenueProfitChartData}
            cashFlowChartData={cashFlowChartDataForComposed}
          />

          <section className="rounded-2xl border border-slate-800/90 bg-slate-900/35 p-4 shadow-lg ring-1 ring-white/5 sm:p-6">
            <h3 className="mb-3 text-sm font-semibold text-slate-200">Scenario comparison</h3>
            <div className="overflow-x-auto">
              <table className="min-w-[920px] w-full divide-y divide-slate-800 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3 font-semibold">Category</th>
                    <th className="px-3 py-3 font-semibold">PY</th>
                    <th className="px-3 py-3 font-semibold">CY</th>
                    <th className="px-3 py-3 font-semibold">FY+1 Forecast</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-slate-200">
                  {comparisonRows.map((row) => {
                    const subtotal = isSubtotal(row.label);
                    return (
                      <tr
                        key={row.label}
                        className={
                          subtotal
                            ? "bg-slate-800/35 font-semibold text-white"
                            : "bg-transparent"
                        }
                      >
                        <td className="whitespace-nowrap px-3 py-3">
                          {row.label}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{formatUsd(row.py)}</td>
                        <td className="whitespace-nowrap px-3 py-3">{formatUsd(row.cy)}</td>
                        <td className="whitespace-nowrap px-3 py-3">{formatUsd(row.forecast)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!hasTrialBalanceData && (
              <p className="mt-4 text-xs text-slate-400">
                Load and map trial balance data in the ingestion flow to populate this forecast
                model. Cash bridge starting point uses working capital when balances are available.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
