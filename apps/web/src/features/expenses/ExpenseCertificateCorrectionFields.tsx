import { baht } from './ExpensesUi';
import type { ExpenseCertificateCorrectionValues } from './expense-certificate-correction.logic';

export function ExpenseCertificateCorrectionFields({ values }: { values: ExpenseCertificateCorrectionValues }) {
  const kind = values.formType === 'PND3' ? 'บุคคลธรรมดา' : 'นิติบุคคล';
  const income = values.incomeCategoryName || '—';
  const facts = `${income}${income.includes(kind) ? '' : ` (${kind})`} · ${Number(values.whtRate)}% · จ่าย ${baht(values.grossAmount)} · หักไว้ ${baht(values.withheldAmount)} · เลขผู้เสียภาษี ${values.payeeTaxId || '—'}`;
  return <p className="line-clamp-2 text-xs leading-5 text-gray-600 sm:col-span-2" title={facts}>{facts}</p>;
}
