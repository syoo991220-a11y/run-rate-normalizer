"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TimeHorizon = "annual" | "monthly";

type TrajectoryPoint = {
  month: string;
  period: string;
  revenue: number;
  operatingIncome: number;
};

type CashFlowChartRow = {
  month: string;
  operating_cash_flow: number;
  investing_cash_flow: number;
  financing_cash_flow: number;
  ending_cash_balance: number;
  aiImpact?: boolean;
  year?: string;
};

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatUsdCompact(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

type CashFlowTooltipRow = {
  month?: string;
  year?: string;
  operating_cash_flow?: number;
  investing_cash_flow?: number;
  financing_cash_flow?: number;
  ending_cash_balance?: number;
};

type RechartsTooltipPayload = {
  payload?: CashFlowTooltipRow;
};

function CashFlowTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: RechartsTooltipPayload[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const operatingCash = Number(row.operating_cash_flow) || 0;
  const investingOut = Number(row.investing_cash_flow) || 0;
  const financing = Number(row.financing_cash_flow) || 0;
  const netCashChange = operatingCash + investingOut + financing;
  const endingCashBalance = Number(row.ending_cash_balance) || 0;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs text-slate-100 shadow-lg">
      <p className="font-semibold text-slate-200">{label ?? row.month ?? row.year ?? "Period"}</p>
      <p className="mt-1 text-emerald-300">Operating: {formatUsd(operatingCash)}</p>
      <p className="text-amber-300">Investing: {formatUsd(investingOut)}</p>
      <p className="text-slate-300">Financing: {formatUsd(financing)}</p>
      <div className="my-1 h-px bg-slate-700" />
      <p className="font-semibold text-cyan-200">Net Cash Change: {formatUsd(netCashChange)}</p>
      <p className="font-semibold text-white">Ending Cash Balance: {formatUsd(endingCashBalance)}</p>
    </div>
  );
}

export type FpaChartsPanelProps = {
  timeHorizon: TimeHorizon;
  onTimeHorizonChange: (h: TimeHorizon) => void;
  revenueProfitChartData: TrajectoryPoint[];
  cashFlowChartData: CashFlowChartRow[];
};

export function FpaChartsPanel({
  timeHorizon,
  onTimeHorizonChange,
  revenueProfitChartData,
  cashFlowChartData,
}: FpaChartsPanelProps) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Visual Analytics</h2>
        <p className="text-sm text-slate-400">
          Active Simulation trajectory with a projected cash bridge across FY+1 months.
        </p>
      </div>
      <div className="inline-flex rounded-xl border border-slate-700/80 bg-slate-950/60 p-1 ring-1 ring-white/5">
        <button
          type="button"
          onClick={() => onTimeHorizonChange("monthly")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            timeHorizon === "monthly"
              ? "bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-300/30"
              : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
          }`}
        >
          Monthly (Runway)
        </button>
        <button
          type="button"
          onClick={() => onTimeHorizonChange("annual")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            timeHorizon === "annual"
              ? "bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-300/30"
              : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
          }`}
        >
          Annual (Strategic)
        </button>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-800/90 bg-slate-900/40 p-5 shadow-lg ring-1 ring-white/5">
          <h3 className="text-sm font-semibold text-slate-200">
            Revenue &amp; Profit Trajectory (Active Simulation)
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {timeHorizon === "annual"
              ? "Annual strategic view (PY, CY, FY+1) for the active forecast."
              : "Monthly runway view (Jan-Dec) for the active forecast with revenue bars and operating income trend."}
          </p>
          <div className="mt-4 h-80 min-h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={revenueProfitChartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                {timeHorizon === "annual" ? (
                  <XAxis
                    dataKey="period"
                    stroke="#94a3b8"
                    tickLine={false}
                    interval={0}
                    minTickGap={0}
                  />
                ) : (
                  <XAxis
                    dataKey="month"
                    stroke="#94a3b8"
                    tickLine={false}
                    interval={0}
                    minTickGap={0}
                    tickFormatter={(tick) =>
                      typeof tick === "string" ? tick.substring(0, 3) : tick
                    }
                  />
                )}
                <YAxis
                  yAxisId="left"
                  stroke="#94a3b8"
                  tickLine={false}
                  axisLine={false}
                  domain={["auto", "auto"]}
                  tickFormatter={formatUsdCompact}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#4ade80"
                  tickLine={false}
                  axisLine={false}
                  domain={["auto", "auto"]}
                  tickFormatter={formatUsdCompact}
                />
                <Tooltip
                  cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: "0.75rem",
                    color: "#e2e8f0",
                  }}
                  labelFormatter={(label) =>
                    typeof label === "string" ? label.substring(0, 3) : label
                  }
                  formatter={(value) => formatUsd(Number(value ?? 0))}
                />
                <Legend verticalAlign="bottom" height={40} />
                <Bar
                  yAxisId="left"
                  dataKey="revenue"
                  name="Revenue"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="operatingIncome"
                  name="Operating Income"
                  stroke="#4ade80"
                  strokeWidth={3}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-800/90 bg-slate-900/40 p-5 shadow-lg ring-1 ring-white/5">
          <h3 className="text-sm font-semibold text-slate-200">
            Cash Flow Analysis (Stacked + Ending Cash)
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {timeHorizon === "annual"
              ? "Annual view: Operating Cash Flow, Investing/Financing totals, and year-end cash balance for the active forecast."
              : "Monthly projected operating, investing, and financing flows for the active forecast with an ending cash balance track. Negative investing/financing values render below zero."}
          </p>
          <div className="mt-4 h-80 min-h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={cashFlowChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <ReferenceLine y={0} yAxisId="left" stroke="#64748b" strokeDasharray="4 4" />
                <XAxis dataKey="month" stroke="#94a3b8" tickLine={false} />
                <YAxis
                  yAxisId="left"
                  stroke="#94a3b8"
                  tickLine={false}
                  axisLine={false}
                  domain={["auto", "auto"]}
                  tickFormatter={formatUsdCompact}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#cbd5e1"
                  tickLine={false}
                  axisLine={false}
                  domain={["auto", "auto"]}
                  tickFormatter={formatUsdCompact}
                />
                <Tooltip
                  cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
                  content={<CashFlowTooltip />}
                />
                <Legend verticalAlign="bottom" height={40} />
                <Bar
                  yAxisId="left"
                  dataKey="operating_cash_flow"
                  name="Operating cash"
                  fill="#10b981"
                  radius={[2, 2, 0, 0]}
                />
                <Bar
                  yAxisId="left"
                  dataKey="investing_cash_flow"
                  name="Investing (outflow)"
                  fill="#f59e0b"
                >
                  {cashFlowChartData.map((entry, idx) => (
                    <Cell
                      key={`investing-cell-${idx}`}
                      fill={entry.aiImpact ? "#fbbf24" : "#f59e0b"}
                      stroke={entry.aiImpact ? "#fde68a" : "none"}
                      strokeWidth={entry.aiImpact ? 2 : 0}
                    />
                  ))}
                </Bar>
                <Bar
                  yAxisId="left"
                  dataKey="financing_cash_flow"
                  name="Financing (outflow)"
                  fill="#64748b"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="ending_cash_balance"
                  name="Ending cash balance"
                  stroke="#f8fafc"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>
    </section>
  );
}
