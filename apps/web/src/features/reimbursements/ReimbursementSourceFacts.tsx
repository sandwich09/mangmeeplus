import type { ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
import { dateShort } from '../expenses/ExpensesUi';
import { formatMoney } from './reimbursements.logic';

/** The same retained facts appear while preparing and reviewing a claim. */
export function ReimbursementSourceFacts({ source }: { source: ReimbursementSourceSnapshot }) {
  return <dl className="mt-3 grid min-w-0 gap-x-4 gap-y-1 rounded-xl bg-gray-50 p-3 text-xs text-gray-600 sm:grid-cols-2">
    <div><dt className="font-semibold">ผู้ขาย</dt><dd className="break-words">{source.seller.name || '—'}</dd></div>
    <div><dt className="font-semibold">เอกสารอ้างอิง</dt><dd className="break-words">{source.certificate?.documentNumber ?? source.seller.documentNumber ?? '—'}</dd></div>
    <div><dt className="font-semibold">วันที่ค่าใช้จ่าย</dt><dd>{dateShort(source.expenseDate)}</dd></div>
    <div><dt className="font-semibold">วันที่จ่ายร้าน</dt><dd>{source.paymentDate ? dateShort(source.paymentDate) : 'ไม่ได้ระบุ'}</dd></div>
    {source.certificate && <div><dt className="font-semibold">ผู้สำรองจ่ายตามใบทดแทน</dt><dd className="break-words">{source.certificate.payerName}</dd></div>}
    <div><dt className="font-semibold">ยอดที่ขอคืน</dt><dd>{formatMoney(source.totals.netPayableAmount)} {source.currency}</dd></div>
    <div><dt className="font-semibold">VAT ตามต้นทาง / หัก ณ ที่จ่าย</dt><dd>{formatMoney(source.totals.vatAmount)} / {formatMoney(source.totals.whtAmount)}</dd></div>
  </dl>;
}
