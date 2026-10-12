import type { WhtHandoffMissingReason, WhtHandoffPrefillDto } from '@watchdog-bms/contracts';

/** Shared by the list's completeness hint and the issue command's refusals. */
export function whtHandoffMissing(prefill: WhtHandoffPrefillDto): WhtHandoffMissingReason[] {
  return [
    ...(!prefill.formType ? ['FORM_TYPE_UNRESOLVED' as const] : []),
    ...(!prefill.incomeCategoryCode || !prefill.incomeCategoryName || !prefill.whtRate ? ['INCOME_CATEGORY_OR_RATE_MISSING' as const] : []),
  ];
}
