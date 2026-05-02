import type { TrialBalanceLine } from "../types/studio-finance";

export type RiskLevel = "Red" | "Yellow" | "Green";

export type RiskAssessment = {
  level: RiskLevel;
  reason: string;
};

export type RiskAccountInput = Pick<TrialBalanceLine, "cyBalance" | "py1Balance"> & {
  categoryL1?: string | null;
};

/**
 * Assertion-based risk engine: existence (P1), completeness (P2), general variance (P3), then pass.
 * PM = performance materiality; trivialThreshold = clearly trivial (SUD).
 */
export function calculateRiskLevel(
  account: RiskAccountInput,
  performanceMateriality: number,
  trivialThreshold: number,
): RiskAssessment {
  const variance = account.cyBalance - account.py1Balance;
  const absVariance = Math.abs(variance);
  const cyBalance = Math.abs(account.cyBalance);
  const l1 = (account.categoryL1 ?? "").trim();

  // Priority 1 — Existence risk (Assets, Revenue, Other Income)
  if (l1 === "Assets" || l1 === "Revenue" || l1 === "Other Income") {
    if (cyBalance >= performanceMateriality) {
      return { level: "Red", reason: "High Existence Risk (Balance > PM)" };
    }
    if (variance > 0 && absVariance >= performanceMateriality) {
      return { level: "Red", reason: "High Existence Risk (Spike > PM)" };
    }
    if (cyBalance >= trivialThreshold) {
      return { level: "Yellow", reason: "Moderate Existence Risk (Balance > Trivial)" };
    }
    if (variance > 0 && absVariance >= trivialThreshold) {
      return { level: "Yellow", reason: "Moderate Existence Risk (Spike > Trivial)" };
    }
  }

  // Priority 2 — Completeness risk (Liabilities, COGS, SG&A, Other Expense), CY decrease vs PY1
  if (
    (l1 === "Liabilities" ||
      l1 === "COGS" ||
      l1 === "SG&A" ||
      l1 === "Other Expense") &&
    variance < 0
  ) {
    if (absVariance >= performanceMateriality) {
      return { level: "Red", reason: "High Completeness Risk (Drop > PM)" };
    }
    if (absVariance >= trivialThreshold) {
      return { level: "Yellow", reason: "Moderate Completeness Risk (Drop > Trivial)" };
    }
  }

  // Priority 3 — General variance risk
  if (absVariance >= performanceMateriality) {
    return { level: "Red", reason: "Variance Exceeds PM" };
  }
  if (absVariance >= trivialThreshold) {
    return { level: "Yellow", reason: "Variance > Trivial Threshold" };
  }

  // Priority 4 — Default
  return { level: "Green", reason: "Balance/Variance within acceptable limits" };
}
