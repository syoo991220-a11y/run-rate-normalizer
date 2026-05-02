import {
  GAAP_AMBIGUOUS_SENTINEL,
  type GaapCategory,
} from "../../types/studio-finance";

function parseLeadingFiveDigitAccount(accountNumber: string): number | null {
  const digits = accountNumber.replace(/\D/g, "");
  if (!digits.length) return null;
  const five =
    digits.length >= 5 ? digits.slice(0, 5) : digits.padEnd(5, "0");
  if (!/^\d{5}$/.test(five)) return null;
  const n = Number.parseInt(five, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * US GAAP-style COA mapping: name-based contra/allowance rules first, then
 * 5-digit account class ranges (10xxx–14xxx current assets, etc.).
 * Non-conforming accounts are flagged for AI resolution.
 */
export function gaapAutoMap(accountName: string, accountNumber: string): GaapCategory {
  const name = accountName.trim();
  const n = name.toLowerCase();

  if (
    /\bmisc\b|\bsuspense\b|ask my accountant/i.test(n) ||
    /\bother\s+misc/i.test(n)
  ) {
    return GAAP_AMBIGUOUS_SENTINEL;
  }

  /** Contra-PPE and similar — keep granular PPE tagging. */
  if (
    /accumulated depreciation/i.test(n) ||
    /\baccumulated\s+depletion\b/i.test(n) ||
    /\bcontra-?\s*asset\b.*\b(ppe|fixed|plant|equipment|property)\b/i.test(n)
  ) {
    return "Property, Plant & Equipment (PPE)";
  }

  /** Contra-intangible / accumulated amortization on intangibles. */
  if (
    /accumulated amortization/i.test(n) ||
    /\bcontra-?\s*asset\b.*\b(intang|goodwill|patent|license)\b/i.test(n)
  ) {
    return "Intangible Assets";
  }

  /** Allowance accounts (e.g. doubtful accounts on receivables) → current assets. */
  if (/\ballowance\b/i.test(n)) {
    return "Current Assets";
  }

  const acct = parseLeadingFiveDigitAccount(accountNumber);
  if (acct === null) {
    return GAAP_AMBIGUOUS_SENTINEL;
  }

  if (acct < 10000 || acct > 99999) {
    return GAAP_AMBIGUOUS_SENTINEL;
  }

  if (acct >= 10000 && acct <= 14999) {
    return "Current Assets";
  }
  if (acct >= 15000 && acct <= 17999) {
    return "Property, Plant & Equipment (PPE)";
  }
  if (acct >= 18000 && acct <= 18999) {
    return "Intangible Assets";
  }
  if (acct >= 19000 && acct <= 19999) {
    return "Other Non-Current Assets";
  }
  if (acct >= 20000 && acct <= 24999) {
    return "Current Liabilities";
  }
  if (acct >= 25000 && acct <= 29999) {
    return "Non-Current Liabilities";
  }
  if (acct >= 30000 && acct <= 39999) {
    if (
      /mezzanine|temporary equity|warrant|derivative liability|preferred.*mandatorily redeemable/i.test(
        n,
      )
    ) {
      return "Mezzanine Equity";
    }
    return "Equity (Retained Earnings, Common Stock, etc.)";
  }
  if (acct >= 40000 && acct <= 49999) {
    return "Revenue";
  }
  if (acct >= 50000 && acct <= 59999) {
    return "Cost of Goods Sold (COGS)";
  }
  if (acct >= 60000 && acct <= 89999) {
    return "Operating Expenses (OpEx)";
  }
  if (acct >= 90000 && acct <= 99999) {
    if (
      /\binterest expense\b|\binterest paid\b|\bnet interest\b/i.test(n) ||
      (/interest/i.test(n) && /expense|cost|charge/i.test(n))
    ) {
      return "Interest Expense";
    }
    if (
      /\bincome tax expense\b|\btax expense\b|\bprovision for income taxes\b|\bcurrent tax\b|\bdeferred tax\b/i.test(
        n,
      )
    ) {
      return "Income Tax Expense";
    }
    return "Other Income/Expense";
  }

  return GAAP_AMBIGUOUS_SENTINEL;
}
