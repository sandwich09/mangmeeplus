import { isCivilDate, type CivilDate, type VatRegistrationStatus } from '@watchdog-bms/contracts';

/**
 * Whether expense capture asks Thai VAT questions (Tax Code, VAT mode, claimability) or not.
 *
 * A presentation policy, NOT a fact about the company — never persisted, never audited, never used
 * to decide tax correctness. The fact is `VatRegistrationStatus`; the claim guard in
 * `expense-status.logic.ts` is what reads the fact.
 */
export type ExpenseCaptureMode = 'FULL' | 'SIMPLE';

/**
 * Spec §5. An answered fact decides on its own; only `UNKNOWN` defers to the entitlement.
 *
 * `NOT_REGISTERED` must win over `thai_tax`, because `thai_tax` is ON by default for every new
 * company (`DEFAULT_ENABLED_FEATURE_KEYS`). Letting the entitlement win there would show the full
 * tax UI to a company that has told us it is not registered, and the claim guard in
 * `expense-status.logic.ts` would then reject what that UI invited.
 *
 * The `UNKNOWN` + entitled arm is load-bearing and must not be removed: no UI writes a
 * registration fact yet, so every existing company reads `UNKNOWN` and would otherwise lose its
 * tax capture on deploy. It reads an entitlement, never a proxy for registration status.
 *
 * Consequence worth knowing: because `thai_tax` defaults on, a company only reaches SIMPLE once
 * somebody actually answers the VAT question. Hiding the tax questions requires asking one.
 */
export function expenseCaptureMode(input: {
  vatStatus: VatRegistrationStatus;
  thaiTaxEnabled: boolean;
}): ExpenseCaptureMode {
  return input.vatStatus === 'REGISTERED'
    || (input.vatStatus === 'UNKNOWN' && input.thaiTaxEnabled) ? 'FULL' : 'SIMPLE';
}

/**
 * The calendar day a capture-policy read is about, from what clients actually send.
 *
 * Shipped web builds pass the expense's own `expenseDate` straight through, and the API renders
 * that column as an instant (`2026-08-05T00:00:00.000Z`). The mode depends only on the day, so a
 * datetime is narrowed to its date part rather than refused — every refusal fell back to FULL
 * silently, which is the wrong form for a company that answered NOT_REGISTERED. A string whose
 * date part is not a real calendar day, or whose remainder is not a time at all, is still refused
 * (`null` -> 422): a caller that sent something else did not mean this day.
 */
export function capturePolicyDate(on: string): CivilDate | null {
  const day = on.slice(0, 10);
  if (!isCivilDate(day)) return null;
  return on.length === day.length || !Number.isNaN(Date.parse(on)) ? day : null;
}
