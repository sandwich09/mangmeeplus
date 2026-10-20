/** Owner 2026-10-20 "ใบสำคัญจ่ายให้ default true": a company without a stored value (or a null one) shows the menu; only an explicit false hides it. */
export const DISBURSEMENT_VOUCHER_WEB_ENTRY_WITHOUT_ROW = true;

/** Read this screen setting and the shared company setting version. */
export function disbursementVoucherWebEntryState(
  row: { disbursementVoucherEntryEnabled: boolean | null; version: number } | null | undefined,
): { enabled: boolean; version: number } {
  return {
    enabled: row?.disbursementVoucherEntryEnabled ?? DISBURSEMENT_VOUCHER_WEB_ENTRY_WITHOUT_ROW,
    version: row?.version ?? 0,
  };
}
