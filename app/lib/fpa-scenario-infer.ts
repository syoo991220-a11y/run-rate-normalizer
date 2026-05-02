import type { ScenarioDrivers } from "../hooks/use-forecast-model";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

const ROW_LABELS = [
  "Revenue",
  "COGS",
  "Gross Profit",
  "SG&A",
  "Operating Income",
] as const;

/**
 * Offline heuristic when the AI API is unavailable or fails.
 * Nudges active forecast drivers from scenario keywords.
 */
export function inferScenarioFromNaturalLanguage(
  text: string,
  baseline: ScenarioDrivers,
): {
  drivers: ScenarioDrivers;
  cfoInsight: string;
  aiHighlightRows: string[];
} {
  const t = text.toLowerCase();
  let b = { ...baseline };

  if (/\b(raw material|material cost|cogs|inflation|cost pressure|supply chain)\b/.test(t)) {
    b = {
      ...b,
      cogsMargin: clamp(b.cogsMargin + 0.04, 0.35, 0.85),
      revenueGrowth: clamp(b.revenueGrowth - 0.02, -0.3, 0.5),
    };
  }
  if (/\b(europe|expand|expansion|new market|geo)\b/.test(t)) {
    b = {
      ...b,
      revenueGrowth: clamp(b.revenueGrowth + 0.06, -0.3, 0.55),
      sgaGrowth: clamp(b.sgaGrowth + 0.05, -0.2, 0.45),
    };
  }
  if (/\b(pricing|price increase|premium|mix shift)\b/.test(t)) {
    b = {
      ...b,
      revenueGrowth: clamp(b.revenueGrowth + 0.04, -0.3, 0.55),
      cogsMargin: clamp(b.cogsMargin - 0.02, 0.35, 0.85),
    };
  }
  if (/\b(hiring|headcount|scale team)\b/.test(t)) {
    b = { ...b, sgaGrowth: clamp(b.sgaGrowth + 0.04, -0.2, 0.45) };
  }
  if (/\b(recession|downturn|demand shock)\b/.test(t)) {
    b = {
      ...b,
      revenueGrowth: clamp(b.revenueGrowth - 0.08, -0.45, 0.5),
      cogsMargin: clamp(b.cogsMargin + 0.02, 0.35, 0.85),
    };
  }
  if (/\bq3\b/.test(t) && /\b15%|\b0\.15\b/.test(t)) {
    b = {
      ...b,
      cogsMargin: clamp(b.cogsMargin + 0.06, 0.35, 0.85),
      revenueGrowth: clamp(b.revenueGrowth + 0.02, -0.3, 0.55),
    };
  }

  const highlights: string[] = [];
  if (/\bsoftware|subscription|oci\b/.test(t)) highlights.push("SG&A", "Operating Income");
  if (/\b(inventory|liquidity|cash)\b/.test(t)) highlights.push("COGS", "Operating Income");
  if (/\b(cogs|raw material|inflation)\b/.test(t)) highlights.push("COGS", "Gross Profit");

  const unique = Array.from(new Set(highlights)).filter((h) =>
    ROW_LABELS.includes(h as (typeof ROW_LABELS)[number]),
  );

  const cfoInsight =
    "The active simulation increases forecast precision by applying a single event path to revenue, cost structure, and operating cadence. " +
    "Monitor gross margin and monthly operating cash conversion as the primary leading indicators under this updated trajectory. " +
    "Recommend validating key assumptions with one targeted sensitivity check before locking the plan.";

  return {
    drivers: b,
    cfoInsight,
    aiHighlightRows: unique.length ? unique : ["Operating Income"],
  };
}
