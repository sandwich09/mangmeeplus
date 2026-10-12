/** A company without a stored value, or with a null value from before this setting existed, hides the menu. */
export const DISBURSEMENT_VOUCHER_WEB_ENTRY_WITHOUT_ROW = false;

/** Read this screen setting and the shared company setting version. */
export function disbursementVoucherWebEntryState(
  row: { disbursementVoucherEntryEnabled: boolean | null; version: number } | null | undefined,
): { enabled: boolean; version: number } {
  return {
    enabled: row?.disbursementVoucherEntryEnabled ?? DISBURSEMENT_VOUCHER_WEB_ENTRY_WITHOUT_ROW,
    version: row?.version ?? 0,
  };
}
