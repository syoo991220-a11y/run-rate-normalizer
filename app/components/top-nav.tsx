"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { BarChart3, Layers3, Scale, Sparkles } from "lucide-react";
import { useStudioMemory } from "../context/studio-memory-context";
import { computeNetIncomeCy } from "../lib/net-income-from-trial-balance";

const nav = [
  { href: "/", label: "1. Trial Balance", icon: Layers3 },
  { href: "/materiality", label: "2. Materiality & Audit", icon: Scale },
  { href: "/fpa", label: "3. FP&A Forecast", icon: BarChart3 },
] as const;

function formatCompactUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(n);
}

export function TopNav() {
  const pathname = usePathname();
  const { trialBalance } = useStudioMemory();
  const netIncomeCy = useMemo(
    () => computeNetIncomeCy(trialBalance),
    [trialBalance],
  );
  const netIncomeFormatted = formatCompactUsd(netIncomeCy);

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-14 overflow-hidden border-b border-slate-800/90 bg-slate-900/90 shadow-lg shadow-black/20 backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-[100vw] items-center gap-3 overflow-hidden px-4 sm:gap-4 sm:px-6 lg:px-8">
        <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/25 to-cyan-500/15 ring-1 ring-white/10 sm:h-10 sm:w-10 sm:rounded-xl">
            <Sparkles
              className="h-4 w-4 text-cyan-300 sm:h-5 sm:w-5"
              aria-hidden
            />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold tracking-tight text-slate-100">
              Run-Rate Studio
            </p>
            <p className="hidden text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:block">
              Close & forecast
            </p>
          </div>
        </div>

        <nav
          className="flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-hidden sm:gap-1 md:gap-2"
          aria-label="Primary"
        >
          {nav.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(`${href}/`);

            return (
              <Link
                key={href}
                href={href}
                className={[
                  "group relative flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-200 sm:px-3 sm:text-sm",
                  active
                    ? "bg-slate-800/90 text-white shadow-sm ring-1 ring-white/10"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100",
                ].join(" ")}
              >
                {active ? (
                  <span
                    className="pointer-events-none absolute bottom-1 left-2 right-2 h-0.5 rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400 sm:left-3 sm:right-3"
                    aria-hidden
                  />
                ) : null}
                <Icon
                  className={[
                    "hidden h-4 w-4 shrink-0 sm:block",
                    active
                      ? "text-cyan-300"
                      : "text-slate-500 group-hover:text-slate-200",
                  ].join(" ")}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="whitespace-nowrap">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden h-8 w-px shrink-0 bg-slate-700/80 sm:block" aria-hidden />
          <div
            className="flex min-w-0 items-center gap-2 text-sm"
            title="Current-year net income from mapped Revenue, Other Income, COGS, SG&A, and Other Expense (L1)."
          >
            <span className="hidden font-medium tracking-wide text-slate-400 sm:inline">
              NET INCOME
            </span>
            <span className="font-mono font-semibold sm:hidden text-slate-400">NI</span>
            <span
              className={[
                "font-mono font-semibold tabular-nums",
                netIncomeCy >= 0 ? "text-emerald-400" : "text-rose-400",
              ].join(" ")}
            >
              {netIncomeFormatted}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
