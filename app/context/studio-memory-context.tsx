"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type {
  CashFlowLine,
  CashFlowReviewRow,
  CfStatementMethod,
  TrialBalanceLine,
  TrialBalanceReviewRow,
} from "../types/studio-finance";

export type {
  CashFlowLine,
  CfStatementMethod,
  GaapCategory,
  TrialBalanceLine,
} from "../types/studio-finance";

export type IngestionStage = 1 | 2 | 3;

type StudioMemoryContextValue = {
  trialBalance: TrialBalanceLine[];
  cashFlowLines: CashFlowLine[];
  cfStatementMethod: CfStatementMethod | null;
  finalizeMemoryBankIngest: (payload: {
    trialBalance: TrialBalanceLine[];
    cashFlow: CashFlowLine[];
    cfStatementMethod: CfStatementMethod | null;
    /** Keeps Stage 2 edits in sync when returning from other routes after finalize. */
    ingestionWorkpaperSnapshot?: {
      tbRows: TrialBalanceReviewRow[];
      cfRows: CashFlowReviewRow[];
    };
  }) => void;
  /** Trial balance / cash flow review workpapers (survives client-side route changes). */
  ingestionStage: IngestionStage;
  setIngestionStage: Dispatch<SetStateAction<IngestionStage>>;
  ingestionTbRows: TrialBalanceReviewRow[];
  setIngestionTbRows: Dispatch<SetStateAction<TrialBalanceReviewRow[]>>;
  ingestionCfRows: CashFlowReviewRow[];
  setIngestionCfRows: Dispatch<SetStateAction<CashFlowReviewRow[]>>;
  ingestionTbMappedFileName: string | null;
  setIngestionTbMappedFileName: Dispatch<SetStateAction<string | null>>;
  ingestionCfMappedFileName: string | null;
  setIngestionCfMappedFileName: Dispatch<SetStateAction<string | null>>;
  ingestionCfMethod: CfStatementMethod | null;
  setIngestionCfMethod: Dispatch<SetStateAction<CfStatementMethod | null>>;
  ingestionCfKeywordMethod: CfStatementMethod | null;
  setIngestionCfKeywordMethod: Dispatch<SetStateAction<CfStatementMethod | null>>;
  /** True after "Re-upload" from Stage 3 until the user continues to Stage 2 again. */
  ingestionReuploadDraftMode: boolean;
  setIngestionReuploadDraftMode: Dispatch<SetStateAction<boolean>>;
  /** Clears workpapers, Memory Bank ledger imports, and thresholds-driven adjustments so the user can start over. */
  resetIngestionForReupload: () => void;
  adjustments: Record<string, number>;
  setAdjustment: (accountId: string, value: number) => void;
  totalAdjustments: number;
  /** Planning-level materiality (single driver for PM / SUD on Module 02). */
  overallMateriality: number;
  setOverallMateriality: (value: number) => void;
  revenueGrowthPct: number;
  opexInflationPct: number;
  setRevenueGrowthPct: (value: number) => void;
  setOpexInflationPct: (value: number) => void;
  normalizedEBITDA: number;
  cashFlowSynced: boolean;
  setCashFlowFromIngest: (rows: CashFlowLine[]) => void;
  clearCashFlowData: () => void;
};

const StudioMemoryContext = createContext<StudioMemoryContextValue | null>(
  null,
);

export function StudioMemoryProvider({ children }: { children: ReactNode }) {
  const [trialBalance, setTrialBalance] = useState<TrialBalanceLine[]>([]);
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  const [cashFlowLines, setCashFlowLines] = useState<CashFlowLine[]>([]);
  const [cfStatementMethod, setCfStatementMethod] =
    useState<CfStatementMethod | null>(null);
  const [cashFlowSynced, setCashFlowSynced] = useState(false);

  const [ingestionStage, setIngestionStage] = useState<IngestionStage>(1);
  const [ingestionTbRows, setIngestionTbRows] = useState<TrialBalanceReviewRow[]>(
    [],
  );
  const [ingestionCfRows, setIngestionCfRows] = useState<CashFlowReviewRow[]>([]);
  const [ingestionTbMappedFileName, setIngestionTbMappedFileName] = useState<
    string | null
  >(null);
  const [ingestionCfMappedFileName, setIngestionCfMappedFileName] = useState<
    string | null
  >(null);
  const [ingestionCfMethod, setIngestionCfMethod] =
    useState<CfStatementMethod | null>(null);
  const [ingestionCfKeywordMethod, setIngestionCfKeywordMethod] =
    useState<CfStatementMethod | null>(null);
  const [ingestionReuploadDraftMode, setIngestionReuploadDraftMode] =
    useState(false);
  const [overallMateriality, setOverallMateriality] = useState(500_000);
  const [revenueGrowthPct, setRevenueGrowthPct] = useState(6);
  const [opexInflationPct, setOpexInflationPct] = useState(3.5);

  const finalizeMemoryBankIngest = useCallback(
    (payload: {
      trialBalance: TrialBalanceLine[];
      cashFlow: CashFlowLine[];
      cfStatementMethod: CfStatementMethod | null;
      ingestionWorkpaperSnapshot?: {
        tbRows: TrialBalanceReviewRow[];
        cfRows: CashFlowReviewRow[];
      };
    }) => {
      setTrialBalance(payload.trialBalance);
      setCashFlowLines(payload.cashFlow);
      setCfStatementMethod(payload.cfStatementMethod);
      setCashFlowSynced(payload.cashFlow.length > 0);
      setAdjustments({});
      if (payload.ingestionWorkpaperSnapshot) {
        setIngestionTbRows(payload.ingestionWorkpaperSnapshot.tbRows);
        setIngestionCfRows(payload.ingestionWorkpaperSnapshot.cfRows);
        setIngestionStage(3);
      }
    },
    [],
  );

  const resetIngestionForReupload = useCallback(() => {
    setIngestionReuploadDraftMode(false);
    setIngestionStage(1);
    setIngestionTbRows([]);
    setIngestionCfRows([]);
    setIngestionTbMappedFileName(null);
    setIngestionCfMappedFileName(null);
    setIngestionCfMethod(null);
    setIngestionCfKeywordMethod(null);
    setTrialBalance([]);
    setCashFlowLines([]);
    setCfStatementMethod(null);
    setCashFlowSynced(false);
    setAdjustments({});
  }, []);

  const setCashFlowFromIngest = useCallback((rows: CashFlowLine[]) => {
    setCashFlowLines(rows);
    setCashFlowSynced(true);
  }, []);

  const clearCashFlowData = useCallback(() => {
    setCashFlowLines([]);
    setCfStatementMethod(null);
    setCashFlowSynced(false);
  }, []);

  const setAdjustment = useCallback((accountId: string, value: number) => {
    setAdjustments((prev) => ({ ...prev, [accountId]: value }));
  }, []);

  const totalAdjustments = useMemo(
    () =>
      Object.values(adjustments).reduce(
        (sum, n) => sum + (Number.isFinite(n) ? n : 0),
        0,
      ),
    [adjustments],
  );

  const normalizedEBITDA = useMemo(() => {
    const base = 18_250_000;
    const growthLift = (revenueGrowthPct / 100) * 420_000;
    const inflationDrag = (opexInflationPct / 100) * 180_000;
    return base + totalAdjustments + growthLift - inflationDrag;
  }, [opexInflationPct, revenueGrowthPct, totalAdjustments]);

  const value = useMemo<StudioMemoryContextValue>(
    () => ({
      trialBalance,
      cashFlowLines,
      cfStatementMethod,
      finalizeMemoryBankIngest,
      ingestionStage,
      setIngestionStage,
      ingestionTbRows,
      setIngestionTbRows,
      ingestionCfRows,
      setIngestionCfRows,
      ingestionTbMappedFileName,
      setIngestionTbMappedFileName,
      ingestionCfMappedFileName,
      setIngestionCfMappedFileName,
      ingestionCfMethod,
      setIngestionCfMethod,
      ingestionCfKeywordMethod,
      setIngestionCfKeywordMethod,
      ingestionReuploadDraftMode,
      setIngestionReuploadDraftMode,
      resetIngestionForReupload,
      adjustments,
      setAdjustment,
      totalAdjustments,
      overallMateriality,
      setOverallMateriality,
      revenueGrowthPct,
      opexInflationPct,
      setRevenueGrowthPct,
      setOpexInflationPct,
      normalizedEBITDA,
      cashFlowSynced,
      setCashFlowFromIngest,
      clearCashFlowData,
    }),
    [
      adjustments,
      cashFlowLines,
      cashFlowSynced,
      cfStatementMethod,
      clearCashFlowData,
      overallMateriality,
      finalizeMemoryBankIngest,
      ingestionCfKeywordMethod,
      ingestionCfMappedFileName,
      ingestionCfMethod,
      ingestionCfRows,
      ingestionReuploadDraftMode,
      ingestionStage,
      ingestionTbMappedFileName,
      ingestionTbRows,
      normalizedEBITDA,
      opexInflationPct,
      resetIngestionForReupload,
      revenueGrowthPct,
      setAdjustment,
      setCashFlowFromIngest,
      setOverallMateriality,
      totalAdjustments,
      trialBalance,
    ],
  );

  return (
    <StudioMemoryContext.Provider value={value}>
      {children}
    </StudioMemoryContext.Provider>
  );
}

export function useStudioMemory() {
  const ctx = useContext(StudioMemoryContext);
  if (!ctx) {
    throw new Error("useStudioMemory must be used within StudioMemoryProvider");
  }
  return ctx;
}
