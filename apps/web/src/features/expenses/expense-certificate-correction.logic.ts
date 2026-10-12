import type { WhtCertificateCorrectionInput, WhtCertificateHandoffDto } from '@watchdog-bms/contracts';

export function expenseCertificateCorrectionValues(handoff: Pick<WhtCertificateHandoffDto, 'prefill' | 'currentCertificate'>) {
  const source = handoff.currentCertificate ?? handoff.prefill;
  const payee = handoff.currentCertificate ? handoff.currentCertificate.payee : handoff.prefill.payeeSnapshot;
  return {
    incomeCategoryCode: source.incomeCategoryCode ?? '', incomeCategoryName: source.incomeCategoryName ?? '',
    whtRate: source.whtRate ?? '', grossAmount: source.grossAmount ?? '', withheldAmount: source.withheldAmount ?? '',
    paymentDate: source.paymentDate ? source.paymentDate.slice(0, 10) : '', formType: source.formType ?? 'PND53',
    payeeName: payee.name ?? '', payeeTaxId: payee.taxId ?? '', payeeAddress: payee.address ?? '', payeeBranchCode: payee.branchCode ?? '',
  };
}
export type ExpenseCertificateCorrectionValues = ReturnType<typeof expenseCertificateCorrectionValues>;

export function expenseCertificateCorrectionChanges(values: ExpenseCertificateCorrectionValues, opened: ExpenseCertificateCorrectionValues | null): WhtCertificateCorrectionInput {
  const corrected: WhtCertificateCorrectionInput = {};
  if (!opened) return corrected;
  if (values.paymentDate !== opened.paymentDate) corrected.paymentDate = values.paymentDate ? new Date(values.paymentDate).toISOString() : '';
  for (const [field, key] of [['payeeName', 'name'], ['payeeAddress', 'address'], ['payeeBranchCode', 'branchCode']] as const) {
    if (values[field] !== opened[field]) corrected.payeeSnapshot = { ...corrected.payeeSnapshot, [key]: values[field] };
  }
  return corrected;
}
