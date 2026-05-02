/** Map cash flow line item text to legacy high-level activity labels. */
export function autoMapCfLineCategory(lineItem: string): string {
  const s = lineItem.toLowerCase();

  if (
    /dividend|debt issuance|debt repayment|borrow|repurchase|equity issuance|lease principal|financing/.test(
      s,
    )
  ) {
    return "Financing";
  }

  if (
    /capex|capital expend|acquisition|ppe|purchase of|sale of asset|investment in|proceeds from sale|investing/.test(
      s,
    )
  ) {
    return "Investing";
  }

  return "Operating";
}
