import type { ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
import { dateShort } from '../expenses/ExpensesUi';
import { money } from './reimbursements.logic';

/** The same retained facts appear while preparing and reviewing a claim. */
export function ReimbursementSourceFacts({ source, formatAmount = money }: { source: ReimbursementSourceSnapshot; formatAmount?: typeof money }) {
  return <dl className="mt-3 grid min-w-0 gap-x-4 gap-y-1 rounded-xl bg-gray-50 p-3 text-xs text-gray-600 sm:grid-cols-2">
    <div><dt className="font-semibold">ผู้ขาย</dt><dd className="break-words">{source.seller.name || 'ยังไม่ระบุ'}</dd></div>
    <div><dt className="font-semibold">เอกสารอ้างอิง</dt><dd className="break-words">{source.certificate?.documentNumber ?? source.seller.documentNumber ?? 'ไม่มีเลขอ้างอิง'}</dd></div>
    <div><dt className="font-semibold">วันที่ค่าใช้จ่าย</dt><dd>{dateShort(source.expenseDate)}</dd></div>
    <div><dt className="font-semibold">วันที่จ่ายร้าน</dt><dd>{source.paymentDate ? dateShort(source.paymentDate) : 'ไม่ได้ระบุ'}</dd></div>
    {source.certificate && <div><dt className="font-semibold">ผู้สำรองจ่ายตามใบทดแทน</dt><dd className="break-words">{source.certificate.payerName}</dd></div>}
    <div><dt className="font-semibold">ยอดที่ขอคืน</dt><dd>{formatAmount(source.totals.netPayableAmount, source.currency)}</dd></div>
    <div><dt className="font-semibold">VAT / หัก ณ ที่จ่าย ตามเอกสารเดิม</dt><dd>{formatAmount(source.totals.vatAmount, source.currency)} / {formatAmount(source.totals.whtAmount, source.currency)}</dd></div>
  </dl>;
}

/** The claim forms name file types with every name kept whole: the same rendering as the expense screens. */
export { WholeWords } from '../expenses/ExpensesUi';
