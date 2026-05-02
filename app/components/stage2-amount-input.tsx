"use client";

import { useCallback, useEffect, useState } from "react";

/** Parses a loose decimal string (optional leading minus, optional fraction). */
export function parseMoneyInput(raw: string): number | undefined {
  const t = raw.replace(/,/g, "").trim();
  if (t === "" || t === "-" || t === "." || t === "-.") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeDisplayNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Number(n.toFixed(10)));
}

/** Allows typing negatives and decimals; rejects other characters. */
function isAllowedAmountTyping(s: string): boolean {
  return /^-?\d*\.?\d*$/.test(s);
}

const INPUT_CLASS =
  "block w-full min-w-[5.25rem] max-w-[9rem] bg-transparent text-right font-mono text-xs tabular-nums outline-none rounded-md border border-transparent px-1.5 py-1 transition-[border-color,box-shadow,background-color] focus:border-cyan-500/50 focus:bg-slate-900/40 focus:shadow-[0_0_0_1px_rgba(34,211,238,0.25)]";

type Props = {
  value: number;
  onChange: (next: number) => void;
  /** Merged with base input classes (e.g. font-semibold, text-slate-300). */
  textClassName?: string;
};

/**
 * Borderless amount editor for Stage 2 review tables. Uses `inputMode="decimal"`
 * for a numeric keypad; entry is constrained to decimal patterns (including `-`).
 */
export function Stage2AmountInput({
  value,
  onChange,
  textClassName = "text-slate-200",
}: Props) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(normalizeDisplayNumber(value));

  useEffect(() => {
    if (!focused) setText(normalizeDisplayNumber(value));
  }, [value, focused]);

  const flush = useCallback(
    (raw: string) => {
      const n = parseMoneyInput(raw);
      const next = n !== undefined ? n : value;
      onChange(next);
      setText(normalizeDisplayNumber(next));
    },
    [onChange, value],
  );

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label="Amount"
      value={text}
      onFocus={() => {
        setFocused(true);
        setText(normalizeDisplayNumber(value));
      }}
      onChange={(e) => {
        const v = e.target.value;
        if (!isAllowedAmountTyping(v)) return;
        setText(v);
        if (v === "" || v === "-" || v === "." || v === "-.") return;
        const n = parseMoneyInput(v);
        if (n !== undefined) onChange(n);
      }}
      onBlur={() => {
        setFocused(false);
        flush(text);
      }}
      className={[INPUT_CLASS, textClassName].join(" ")}
    />
  );
}
