// Pure helpers for the partner console's "AI Usage & Budget" card. The API speaks satang; the
// operator thinks in baht, so the conversion and the guardrails live here where they are testable.

/** Same money idiom as the expenses surface, kept local to this feature. */
export const satangToBaht = (satang: number) =>
  '฿' + (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Prefill/placeholder value for the baht input — no separators (it is an <input type="number">),
 *  and satang are shown, never rounded away: an override of 200050 must round-trip as 2000.50. */
export const satangToBahtInput = (satang: number) =>
  satang % 100 === 0 ? String(satang / 100) : (satang / 100).toFixed(2);

export type BudgetInputParse =
  | { ok: true; monthlyBudgetSatang: number | null }
  | { ok: false; message: string };

/** Baht with at most two decimals (spec §7.4). Parsed as integer + fraction parts rather than
 *  `Number(x) * 100`, so '2000.50' cannot drift into 200049.99999 on the way to satang. */
const BAHT_INPUT = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Empty means "clear the override and inherit the platform default" (the API's `null`).
 * Anything else must be baht ≥ 1 with at most two decimals — a third decimal is rejected, never
 * silently rounded. The ceiling is enforced server-side so the operator always sees the API's
 * own 422 wording for it.
 */
export function parseBudgetBahtInput(raw: string): BudgetInputParse {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, monthlyBudgetSatang: null };
  const parts = BAHT_INPUT.exec(trimmed);
  if (!parts) {
    return {
      ok: false,
      message: 'Enter an amount in baht with at most two decimals (for example 2000.50), or leave the field empty to inherit the platform default.',
    };
  }
  const satang = Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
  if (satang < 100) {
    return { ok: false, message: 'Enter at least ฿1. Switching AI off is a feature entitlement (ai_line_assistant), not a budget of zero.' };
  }
  return { ok: true, monthlyBudgetSatang: satang };
}

/** Month-to-date share of the effective budget. Unclamped: 140% is worth reading as 140%. */
export function budgetPercent(spendSatang: number, budgetSatang: number): number {
  if (!(budgetSatang > 0)) return 0;
  return Math.round((spendSatang / budgetSatang) * 100);
}

/** The bar can only draw 0–100. */
export const budgetBarWidth = (percent: number) => Math.min(100, Math.max(0, percent));

/** At the cap it is a refusal (red); the meter emits its alert at 80% (amber). */
export function budgetBarClass(percent: number): string {
  if (percent >= 100) return 'bg-red-500';
  if (percent > 80) return 'bg-yellow-500';
  return 'bg-brand-600';
}

export function budgetTextClass(percent: number): string {
  if (percent >= 100) return 'text-red-600';
  if (percent > 80) return 'text-yellow-600';
  return 'text-gray-500';
}
