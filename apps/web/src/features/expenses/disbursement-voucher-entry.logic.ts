/** Menu visibility only; existing documents and API commands keep their own permission checks. */
export function canOpenDisbursementVoucherWeb(
  session: { companyId: string; permissions: readonly string[]; disbursementVoucherWebEntry?: boolean } | null | undefined,
  companyId: string,
): boolean {
  return session?.companyId === companyId
    && session.permissions.includes('expense.disbursement.read')
    && session.disbursementVoucherWebEntry === true;
}
