'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { expenseDisbursementReservationMessage, type ExpenseCorrectionCapabilities } from '@watchdog-bms/contracts';
import { Modal } from '@/common/components/modal';
import { CoverLoader } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import type { ExpenseDetail } from './expenses.model';
import { baht, btnClass, ghostClass } from './ExpensesUi';
import { canAddExpenseToDisbursement, expenseDisbursementPaymentAction } from './disbursement-vouchers/disbursement-voucher-expense.logic';
import { issueDisbursementVoucherFromPayment, listDisbursementPayableExpenses } from './disbursement-vouchers/disbursement-vouchers.api';
import { nextDraftCommand } from './disbursement-vouchers/disbursement-voucher-form.logic';

const word = (key: string) => t(`expenses.disbursement.${key}` as DictionaryKey, 'th');
const PaymentCardContext = createContext(false);
// The page reuses paymentHistory in refusal dialogs. Document actions belong only to the payment card.
export function ExpenseDisbursementPaymentScope({ children }: { children: ReactNode }) {
  return <PaymentCardContext.Provider value>{children}</PaymentCardContext.Provider>;
}
export function ExpenseDisbursementDirectPayment({ reservation, children }: { reservation: ExpenseCorrectionCapabilities['disbursementReservation'] | undefined; children: ReactNode }) {
  return reservation && reservation.status !== 'DRAFT' ? null : children;
}
// `named`: the button stands alone as the next step, so it says which document it opens.
export function ExpenseDisbursementOpenLink({ companyId, reservation, primary = false, named = false }: { companyId: string; reservation: ExpenseCorrectionCapabilities['disbursementReservation'] | undefined; primary?: boolean; named?: boolean }) {
  return reservation?.voucherId && reservation.viewerMay !== 'none' ? <Link className={primary ? btnClass : ghostClass}
    href={`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(reservation.voucherId)}`}>{named && reservation.documentNumber ? word('open_named').replace('{number}', reservation.documentNumber) : word('open_document')}</Link> : null;
}
// `brief`: the box above the card already names the document and opens it, so the card only says how to pay.
export function ExpenseDisbursementReservation({ companyId, reservation, brief = false }: { companyId: string; reservation: ExpenseCorrectionCapabilities['disbursementReservation'] | undefined; brief?: boolean }) {
  if (!reservation) return null;
  if (reservation.status === 'DRAFT') return <div role="status" className="flex flex-wrap items-center justify-between gap-3 text-sm">
    <p>อยู่ในร่างใบเตรียมจ่ายของ {reservation.preparerName ?? 'ผู้จัดทำ'}</p>
    {reservation.voucherId && reservation.viewerMay !== 'none' && <Link className={ghostClass} href={`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(reservation.voucherId)}`}>เปิดร่าง</Link>}
  </div>;
  return <div className="space-y-2 rounded-xl bg-warning-50 p-3 text-sm [overflow-wrap:anywhere]" role="status">
    {!brief && <p>{reservation.documentNumber ? <>{word('reservation').replace('{number}', '')}<span className="whitespace-nowrap">{reservation.documentNumber}</span>{reservation.preparerName && <> {word('reservation_preparer').replace('{name}', reservation.preparerName)}</>}</>
      : expenseDisbursementReservationMessage('recordPayment', null, null, reservation.viewerMay, reservation.viewerCanPay ?? false).split(' ให้')[0]}</p>}
    {!brief && <ExpenseDisbursementOpenLink companyId={companyId} reservation={reservation} />}
    <p>{(() => { const message = expenseDisbursementReservationMessage('recordPayment', null, null, reservation.viewerMay, reservation.viewerCanPay ?? false); return message.slice(message.indexOf(' ให้') + 1); })()}</p>
  </div>;
}
export function ExpenseDisbursementPrepareEntry({ companyId, detail, permissions, entryOpen, canRecordPayment = Boolean(detail.correctionCapabilities?.canRecordPayment), children }: { companyId: string; detail: ExpenseDetail; permissions: readonly string[]; entryOpen: boolean; canRecordPayment?: boolean; children?: ReactNode }) {
  const available = canAddExpenseToDisbursement(detail, permissions, entryOpen);
  const canApprove = permissions.includes('expense.disbursement.approve');
  const key = JSON.stringify([companyId, detail.id]);
  const [otherBills, setOtherBills] = useState<{ key: string; value: boolean } | null>(null);
  const read = useRef<{ key: string; answer: Promise<boolean> } | null>(null);
  useEffect(() => {
    if (!available || !canRecordPayment || !canApprove) return;
    let active = true;
    // As on the draft entry: the expense read has no payee key. One scoped read supplies it and its siblings.
    // Retain the promise across rerenders/Strict Mode effects; a failed read must not remove the way forward.
    if (read.current?.key !== key) read.current = { key, answer: listDisbursementPayableExpenses(companyId, {}, { suppressErrorToast: true })
      .then(rows => {
        const current = rows.find(row => row.expenseId === detail.id);
        return !current || rows.some(row => row.expenseId !== detail.id && row.payeeKey === current.payeeKey && row.selectable && !row.reservation);
      }).catch(() => true) };
    void read.current.answer.then(value => { if (active) setOtherBills({ key, value }); });
    return () => { active = false; };
  }, [companyId, detail.id, key, available, canRecordPayment, canApprove]);
  const show = available && (!canRecordPayment || !canApprove || otherBills?.key === key && otherBills.value);
  if (!show && !children) return null;
  return <div className="space-y-2 [overflow-wrap:anywhere]">
    {children}
    {show && <p className="text-sm text-gray-600">
      <Link className={canRecordPayment ? 'underline underline-offset-4 hover:text-gray-800' : ghostClass}
        href={`/companies/${companyId}/expenses/disbursement-vouchers/new?expenseId=${encodeURIComponent(detail.id)}`}>รวมกับบิลอื่น หรือให้คนอื่นอนุมัติก่อนจ่าย → ใบเตรียมจ่าย</Link>
    </p>}
  </div>;
}
export function ExpenseDisbursementPaymentEntry({ companyId, expenseId, payment, permissions, entryOpen, renderActions = actions => actions }: {
  renderActions?: (actions: ReactNode) => ReactNode;
  companyId: string; expenseId: string; payment: NonNullable<ExpenseDetail['payments']>[number]; permissions: readonly string[]; entryOpen: boolean;
}) {
  const inPaymentCard = useContext(PaymentCardContext);
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inFlight = useRef(false);
  const commandId = useRef<string | null>(null);
  const action = expenseDisbursementPaymentAction(payment, permissions, entryOpen);
  const issue = async () => {
    if (inFlight.current || action !== 'issue') return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      commandId.current = nextDraftCommand(commandId.current, false, () => crypto.randomUUID());
      const header = await issueDisbursementVoucherFromPayment(companyId, { commandId: commandId.current, expenseId, paymentId: payment.id });
      toast.success(word('issued_toast').replace('{number}', header.documentNumber!));
      router.push(`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(header.id)}`);
    } catch (failure) { setError(failure); }
    finally { inFlight.current = false; setBusy(false); }
  };
  if (!inPaymentCard) return renderActions(null);
  const cancelled = !payment.disbursementVoucher ? payment.cancelledDisbursementVoucher : null;
  // With the issue button right below, the line names both ways: this payment alone here, or every payment still in effect on the document's page.
  const [before, after] = word(payment.status === 'VOIDED' ? 'cancelled_with_payment' : action === 'issue' ? 'cancelled_document_for_payment_issue' : 'cancelled_document_for_payment')
    .replace('{button}', word('issue')).split('{number}');
  // The sentence comes before the row's buttons, wherever the row puts this component.
  const cancelledNotice = cancelled && <div className="order-first col-span-full min-w-0 space-y-1 [overflow-wrap:anywhere]">
    <p>{before}<span className="whitespace-nowrap">{cancelled.documentNumber}</span>{after}</p>
    {permissions.includes('expense.disbursement.read') && cancelled.id && <Link className={ghostClass}
      href={`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(cancelled.id)}`}>{word('open_document')}</Link>}
  </div>;
  if (action === 'none') return <>{cancelledNotice}{renderActions(null)}</>;
  // Beside the row's cancel button (one row of two buttons), or alone at the left when the payment cannot be cancelled.
  if (action === 'view') return renderActions(<Link className={ghostClass} href={`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(payment.disbursementVoucher!.id!)}`}>{word('view_paid')}</Link>);
  if (action === 'notice') return <><p className="order-first col-span-full [overflow-wrap:anywhere]">{word('payment_document').replace('{number}', '')}<span className="whitespace-nowrap">{payment.disbursementVoucher!.documentNumber}</span></p>{renderActions(null)}</>;
  // The same size as the row's cancel button, beside it (the window is drawn outside the row).
  return <>{cancelledNotice}
    {renderActions(<button type="button" className={ghostClass} onClick={() => { setError(null); setOpen(true); }}>{word('issue')}</button>)}
    <Modal open={open} title={word('issue_title').replace('{amount}', baht(payment.amount))} closeOnBackdrop={false} size="sm" onClose={() => { if (!inFlight.current) setOpen(false); }}
      footer={<>
        <button type="button" className={ghostClass} disabled={busy} onClick={() => setOpen(false)}>{t('common.close', 'th')}</button>
        <button type="button" className={btnClass} disabled={busy} aria-busy={busy} onClick={() => void issue()}>{busy ? word('working') : word('issue')}</button>
      </>}>
      <CoverLoader active={busy} scope="modal" label={word('working')}>
        <div className="space-y-3 [overflow-wrap:anywhere]">
          <p>{word('issue_confirm')}</p>
          {error !== null && <p role="alert" className="text-error-700">{apiErrorMessage(error)}</p>}
        </div>
      </CoverLoader>
    </Modal>
  </>;
}
export function ExpenseDisbursementVoidBlocker({ companyId, reservation, onClose, children, dialog = false }: { companyId: string; dialog?: boolean; reservation: ExpenseCorrectionCapabilities['disbursementReservation'] | undefined; onClose: () => void; children: ReactNode }) {
  if (!reservation) return children;
  const message = <p role="status" className="text-sm text-gray-600 [overflow-wrap:anywhere]">{expenseDisbursementReservationMessage('void', reservation.documentNumber, reservation.preparerName, reservation.viewerMay, reservation.viewerCanPay ?? false)}</p>;
  const close = <button type="button" className={ghostClass} onClick={onClose}>{t('common.close', 'th')}</button>;
  const open = <ExpenseDisbursementOpenLink companyId={companyId} reservation={reservation} primary />;
  return dialog ? <Modal open title={t('expenses.void_document', 'th')} closeOnBackdrop={false} onClose={onClose}
    footer={<>{close}{open}</>}>{message}</Modal>
    : <div className="space-y-2">{message}<div className="grid auto-cols-fr grid-flow-col gap-2 sm:w-max sm:auto-cols-[minmax(8rem,1fr)]">{close}{open}</div></div>;
}
