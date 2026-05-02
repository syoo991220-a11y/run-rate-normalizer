"use client";

import {
  CF_MAP_ROLE_OPTIONS,
  TB_MAP_ROLE_OPTIONS,
  type CfColumnSelection,
  type TbColumnSelection,
} from "../lib/ingestion/column-map-transform";

const PREVIEW_ROW_COUNT = 5;

type Props = {
  variant: "tb" | "cf";
  fileName: string;
  headers: string[];
  previewRows: Record<string, string>[];
  /** Total data rows in the workbook (excluding header). */
  totalDataRows: number;
  error: string | null;
  tbSelection: TbColumnSelection;
  cfSelection: CfColumnSelection;
  onTbSelectionChange: (next: TbColumnSelection) => void;
  onCfSelectionChange: (next: CfColumnSelection) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function IngestionColumnMapper({
  variant,
  fileName,
  headers,
  previewRows,
  totalDataRows,
  error,
  tbSelection,
  cfSelection,
  onTbSelectionChange,
  onCfSelectionChange,
  onConfirm,
  onCancel,
}: Props) {
  const roles = variant === "tb" ? TB_MAP_ROLE_OPTIONS : CF_MAP_ROLE_OPTIONS;
  const title =
    variant === "tb" ? "Map trial balance columns" : "Map cash flow columns";
  const subtitle =
    variant === "tb"
      ? "Assign each system field to a column from your file. Amounts should be net (debits and credits combined) for each fiscal year."
      : "Map line item name, current year amount, prior year 1 amount, and optional prior year 2 and 3 amounts. Beginning and ending cash are tagged in Stage 2 using the category dropdown — not here.";

  const additionalImported = Math.max(0, totalDataRows - PREVIEW_ROW_COUNT);

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-slate-800/90 bg-slate-900/35 p-6 shadow-lg ring-1 ring-white/5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Map your columns</h2>
          <p className="mt-1 text-xs text-slate-500">{title}</p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-400">
            {subtitle}
          </p>
          <p className="mt-2 font-mono text-[11px] text-slate-500">{fileName}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-lg border border-slate-700/90 bg-slate-950/50 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white"
        >
          Cancel
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="min-w-0">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            First {PREVIEW_ROW_COUNT} data rows (preview)
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-950/40 ring-1 ring-white/5">
            <table className="min-w-full text-left text-xs text-slate-200">
              <thead className="bg-slate-950/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {previewRows.length ? (
                  previewRows.map((row, ri) => (
                    <tr
                      key={ri}
                      className="bg-slate-950/20 transition-colors hover:bg-slate-800/40"
                    >
                      {headers.map((h) => (
                        <td
                          key={h}
                          className="max-w-[200px] truncate px-3 py-2 font-mono text-[11px] text-slate-300"
                          title={row[h] ?? ""}
                        >
                          {(row[h] ?? "").trim() || "—"}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={Math.max(headers.length, 1)}
                      className="px-3 py-6 text-center text-slate-500"
                    >
                      No preview rows in this file.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-dashed border-slate-700/90 bg-gradient-to-r from-slate-950/95 via-slate-900/80 to-slate-950/95">
                  <td
                    colSpan={Math.max(headers.length, 1)}
                    className="px-3 py-3 text-center text-[11px] leading-relaxed text-slate-500"
                  >
                    <span className="font-medium tracking-wide text-slate-400/90">
                      … and {additionalImported} additional row
                      {additionalImported === 1 ? "" : "s"} successfully imported.
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Column assignment
          </p>
          <div className="flex flex-col gap-3">
            {roles.map((role) => (
              <div key={role} className="flex flex-col gap-1">
                <label className="text-xs font-medium leading-snug text-slate-300">
                  {role}
                </label>
                <select
                  value={
                    variant === "tb"
                      ? tbSelection[role as keyof TbColumnSelection]
                      : cfSelection[role as keyof CfColumnSelection]
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (variant === "tb") {
                      onTbSelectionChange({
                        ...tbSelection,
                        [role]: v,
                      } as TbColumnSelection);
                    } else {
                      onCfSelectionChange({
                        ...cfSelection,
                        [role]: v,
                      } as CfColumnSelection);
                    }
                  }}
                  className="w-full rounded-lg border border-slate-700/90 bg-slate-950/70 px-2 py-2 text-xs text-slate-100 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                >
                  <option value="">Select column…</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onConfirm}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-600/20 py-2.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-600/30"
          >
            Confirm column mapping
          </button>
        </div>
      </div>
    </div>
  );
}
