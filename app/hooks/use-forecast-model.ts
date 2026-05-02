"use client";

import { useMemo } from "react";
import type { TrialBalanceLine } from "../types/studio-finance";

export type ScenarioDrivers = {
  revenueGrowth: number;
  cogsMargin: number;
  sgaGrowth: number;
};

type ForecastRow = {
  label: "Revenue" | "COGS" | "Gross Profit" | "SG&A" | "Operating Income";
  pyActual: number;
  cyCurrent: number;
  forecast: number;
  varianceDollar: number;
  variancePct: number;
};

export type ForecastModel = {
  pyActuals: {
    revenue: number;
    cogs: number;
    sga: number;
    otherExpense: number;
    incomeTaxExpense: number;
  };
  cyCurrent: {
    revenue: number;
    cogs: number;
    sga: number;
    otherExpense: number;
    incomeTaxExpense: number;
  };
  forecast: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    sga: number;
    otherExpense: number;
    incomeTaxExpense: number;
    operatingIncome: number;
  };
  kpis: {
    grossMarginPct: number;
    operatingMarginPct: number;
    monthlyCashTrajectory: number;
  };
  tableRows: ForecastRow[];
};

const EPSILON = 0.000001;

function safeValue(value: number | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function sumByL1(trialBalanceData: TrialBalanceLine[], category: string): number {
  return trialBalanceData.reduce((sum, row) => {
    const l1 = (row.categoryL1 ?? "").trim();
    if (l1 !== category) return sum;
    return sum + safeValue(row.cyBalance);
  }, 0);
}

function sumByL1Py(trialBalanceData: TrialBalanceLine[], category: string): number {
  return trialBalanceData.reduce((sum, row) => {
    const l1 = (row.categoryL1 ?? "").trim();
    if (l1 !== category) return sum;
    return sum + safeValue(row.py1Balance);
  }, 0);
}

function variancePct(base: number, compare: number): number {
  if (Math.abs(base) < EPSILON) return 0;
  return (compare - base) / base;
}

export function computeForecastModel(
  trialBalanceData: TrialBalanceLine[],
  scenarioDrivers: ScenarioDrivers,
): ForecastModel {
  const pyActualRevenue = sumByL1Py(trialBalanceData, "Revenue");
  const pyActualCogs = sumByL1Py(trialBalanceData, "COGS");
  const pyActualSga = sumByL1Py(trialBalanceData, "SG&A");
  const pyActualOtherExpense = sumByL1Py(trialBalanceData, "Other Expense");
  const pyActualIncomeTax = sumByL1Py(trialBalanceData, "Income Tax");

  const cyActualRevenue = sumByL1(trialBalanceData, "Revenue");
  const cyActualCogs = sumByL1(trialBalanceData, "COGS");
  const cyActualSga = sumByL1(trialBalanceData, "SG&A");
  const cyActualOtherExpense = sumByL1(trialBalanceData, "Other Expense");
  const cyActualIncomeTax = sumByL1(trialBalanceData, "Income Tax");

  // Strict annual model: CY trial balance amounts are full fiscal year (no partial-year run-rate).
  const runRateRevenue = cyActualRevenue;
  const runRateCogs = cyActualCogs;
  const runRateSga = cyActualSga;
  const runRateOtherExpense = cyActualOtherExpense;
  const runRateIncomeTax = cyActualIncomeTax;

  const forecastRevenue = runRateRevenue * (1 + scenarioDrivers.revenueGrowth);
  const forecastCogs = forecastRevenue * scenarioDrivers.cogsMargin;
  const forecastGrossProfit = forecastRevenue - forecastCogs;
  const forecastSga = runRateSga * (1 + scenarioDrivers.sgaGrowth);
  const forecastOtherExpense = runRateOtherExpense;
  const forecastIncomeTaxExpense = runRateIncomeTax;
  const forecastOperatingIncome = forecastRevenue - forecastCogs - forecastSga;

  const runRateGrossProfit = runRateRevenue - runRateCogs;
  const runRateOperatingIncome = runRateRevenue - runRateCogs - runRateSga;

  const grossMarginPct =
    Math.abs(forecastRevenue) < EPSILON ? 0 : forecastGrossProfit / forecastRevenue;
  const operatingMarginPct =
    Math.abs(forecastRevenue) < EPSILON ? 0 : forecastOperatingIncome / forecastRevenue;
  const monthlyCashTrajectory = forecastOperatingIncome / 12;

  const tableRows: ForecastRow[] = [
    {
      label: "Revenue",
      pyActual: pyActualRevenue,
      cyCurrent: runRateRevenue,
      forecast: forecastRevenue,
      varianceDollar: forecastRevenue - runRateRevenue,
      variancePct: variancePct(runRateRevenue, forecastRevenue),
    },
    {
      label: "COGS",
      pyActual: pyActualCogs,
      cyCurrent: runRateCogs,
      forecast: forecastCogs,
      varianceDollar: forecastCogs - runRateCogs,
      variancePct: variancePct(runRateCogs, forecastCogs),
    },
    {
      label: "Gross Profit",
      pyActual: pyActualRevenue - pyActualCogs,
      cyCurrent: runRateGrossProfit,
      forecast: forecastGrossProfit,
      varianceDollar: forecastGrossProfit - runRateGrossProfit,
      variancePct: variancePct(runRateGrossProfit, forecastGrossProfit),
    },
    {
      label: "SG&A",
      pyActual: pyActualSga,
      cyCurrent: runRateSga,
      forecast: forecastSga,
      varianceDollar: forecastSga - runRateSga,
      variancePct: variancePct(runRateSga, forecastSga),
    },
    {
      label: "Operating Income",
      pyActual: pyActualRevenue - pyActualCogs - pyActualSga,
      cyCurrent: runRateOperatingIncome,
      forecast: forecastOperatingIncome,
      varianceDollar: forecastOperatingIncome - runRateOperatingIncome,
      variancePct: variancePct(runRateOperatingIncome, forecastOperatingIncome),
    },
  ];

  return {
    pyActuals: {
      revenue: pyActualRevenue,
      cogs: pyActualCogs,
      sga: pyActualSga,
      otherExpense: pyActualOtherExpense,
      incomeTaxExpense: pyActualIncomeTax,
    },
    cyCurrent: {
      revenue: runRateRevenue,
      cogs: runRateCogs,
      sga: runRateSga,
      otherExpense: runRateOtherExpense,
      incomeTaxExpense: runRateIncomeTax,
    },
    forecast: {
      revenue: forecastRevenue,
      cogs: forecastCogs,
      grossProfit: forecastGrossProfit,
      sga: forecastSga,
      otherExpense: forecastOtherExpense,
      incomeTaxExpense: forecastIncomeTaxExpense,
      operatingIncome: forecastOperatingIncome,
    },
    kpis: {
      grossMarginPct,
      operatingMarginPct,
      monthlyCashTrajectory,
    },
    tableRows,
  };
}

export function useForecastModel(
  trialBalanceData: TrialBalanceLine[],
  scenarioDrivers: ScenarioDrivers,
): ForecastModel {
  return useMemo(
    () => computeForecastModel(trialBalanceData, scenarioDrivers),
    [scenarioDrivers, trialBalanceData],
  );
}
