// Pure helpers for the tax workspace page. No API calls, no React — see
// docs/guidelines/web-frontend-code-style.md.

/**
 * §11.4 / §8 (D2): the ภ.พ.30 workpaper checklist line links into the expense list scoped to the
 * selected VAT period. `TaxPeriod.periodKey` is the only date the period carries for a monthly
 * form — the API's `formPeriodKey()` (tax-period.logic.ts) writes it as 'YYYY-MM' for PP30/PND3/
 * PND53 — so this turns that key into civil day bounds the same way `periodRange()` in
 * ExpensesPages.tsx turns its own month picker into a range. Annual ('YYYY') and half-year
 * ('YYYY-Hn') CIT keys are not this shape and correctly return null — only PP30 uses this today.
 */
export function monthlyPeriodDateRange(periodKey: string): { fromDate: string; toDate: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) return null;
  const [, year, month] = match;
  const monthNum = Number(month);
  if (monthNum < 1 || monthNum > 12) return null;
  const lastDay = new Date(Number(year), monthNum, 0).getDate();
  return { fromDate: `${year}-${month}-01`, toDate: `${year}-${month}-${String(lastDay).padStart(2, '0')}` };
}
