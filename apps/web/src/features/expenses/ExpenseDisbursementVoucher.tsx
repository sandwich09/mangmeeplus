'use client';

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
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
import { btnClass, ghostClass } from './ExpensesUi';
import { canAddExpenseToDisbursement, expenseDisbursementPaymentAction } from './disbursement-vouchers/disbursement-voucher-expense.logic';
import { issueDisbursementVoucherFromPayment } from './disbursement-vouchers/disbursement-vouchers.api';
import { nextDraftCommand } from './disbursement-vouchers/disbursement-voucher-form.logic';

const word = (key: string) => t(`expenses.disbursement.${key}` as DictionaryKey, 'th');
const PaymentCardContext = createContext(false);
// The page reuses paymentHistory in refusal dialogs. Document actions belong only to the payment card.
export function ExpenseDisbursementPaymentScope({ children }: { children: ReactNode }) {
  return <PaymentCardContext.Provider value>{children}</PaymentCardContext.Provider>;
}
export function ExpenseDisbursementDirectPayment({ reservation, children }: { reservation: ExpenseCorrectionCapabilities['disbursementReservation'] | undefined; children: ReactNode }) {
  return reservation ? null : children;
}
export function ExpenseDisbursementOpenLink({ companyId, reservation, primary = false }: { companyId: string; reservation: ExpenseCorrectionCapabilities['disbursementReservation'] | undefined; primary?: boolean }) {
  return reservation?.voucherId && reservation.viewerMay !== 'none' ? <Link className={`${primary ? btnClass : ghostClass} w-full sm:w-auto`}
    href={`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(reservation.voucherId)}`}>{word('open_document')}</Link> : null;
}
export function ExpenseDisbursementReservation({ companyId, reservation }: { companyId: string; reservation: ExpenseCorrectionCapabilities['disbursementReservation'] | undefined }) {
  if (!reservation) return null;
  return <div className="space-y-2 rounded-xl bg-warning-50 p-3 text-sm [overflow-wrap:anywhere]" role="status">
    <p>{reservation.documentNumber ? <>{word('reservation').replace('{number}', '')}<span className="whitespace-nowrap">{reservation.documentNumber}</span>{reservation.preparerName && <> {word('reservation_preparer').replace('{name}', reservation.preparerName)}</>}</>
      : expenseDisbursementReservationMessage('recordPayment', null, null, reservation.viewerMay, reservation.viewerCanPay ?? false).split(' ให้')[0]}</p>
    <ExpenseDisbursementOpenLink companyId={companyId} reservation={reservation} />
    <p>{(() => { const message = expenseDisbursementReservationMessage('recordPayment', null, null, reservation.viewerMay, reservation.viewerCanPay ?? false); return message.slice(message.indexOf(' ให้') + 1); })()}</p>
  </div>;
}
export function ExpenseDisbursementPrepareEntry({ companyId, detail, permissions, entryOpen }: { companyId: string; detail: ExpenseDetail; permissions: readonly string[]; entryOpen: boolean }) {
  if (!canAddExpenseToDisbursement(detail, permissions, entryOpen)) return null;
  return <div className="space-y-2 [overflow-wrap:anywhere]">
    <Link className={ghostClass} href={`/companies/${companyId}/expenses/disbursement-vouchers/new?expenseId=${encodeURIComponent(detail.id)}`}>{word('add_expense')}</Link>
    <p className="text-sm text-gray-600">{word('add_expense_hint')}</p>
  </div>;
}
export function ExpenseDisbursementPaymentEntry({ companyId, expenseId, payment, permissions, entryOpen }: {
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
  if (!inPaymentCard) return null;
  const cancelled = !payment.disbursementVoucher ? payment.cancelledDisbursementVoucher : null;
  // With the issue button right below, the line names both ways: this payment alone here, or every payment still in effect on the document's page.
  const [before, after] = word(payment.status === 'VOIDED' ? 'cancelled_with_payment' : action === 'issue' ? 'cancelled_document_for_payment_issue' : 'cancelled_document_for_payment')
    .replace('{button}', word('issue')).split('{number}');
  const cancelledNotice = cancelled && <div className="col-span-2 min-w-0 space-y-1 [overflow-wrap:anywhere]">
    <p>{before}<span className="whitespace-nowrap">{cancelled.documentNumber}</span>{after}</p>
    {permissions.includes('expense.disbursement.read') && cancelled.id && <Link className={ghostClass}
      href={`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(cancelled.id)}`}>{word('open_document')}</Link>}
  </div>;
  if (action === 'none') return cancelledNotice;
  // Beside the row's cancel button (one row of two buttons), or alone at the left when the payment cannot be cancelled.
  if (action === 'view') return <Link className={`${ghostClass} w-full justify-center whitespace-nowrap`} href={`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(payment.disbursementVoucher!.id!)}`}>{word('view_paid')}</Link>;
  if (action === 'notice') return <p className="col-span-2 [overflow-wrap:anywhere]">{word('payment_document').replace('{number}', '')}<span className="whitespace-nowrap">{payment.disbursementVoucher!.documentNumber}</span></p>;
  return <>{cancelledNotice}<div className="col-span-2 min-w-0">
    <button type="button" className={ghostClass} onClick={() => { setError(null); setOpen(true); }}>{word('issue')}</button>
    <Modal open={open} title={word('issue')} closeOnBackdrop={false} size="sm" onClose={() => { if (!inFlight.current) setOpen(false); }}
      footer={<div className="grid w-full gap-2 sm:ml-auto sm:w-max sm:max-w-full sm:auto-cols-[minmax(8rem,1fr)] sm:grid-flow-col pb-[env(safe-area-inset-bottom)]">
        <button type="button" className={`${ghostClass} w-full`} disabled={busy} onClick={() => setOpen(false)}>{t('common.cancel', 'th')}</button>
        <button type="button" className={`${btnClass} w-full`} disabled={busy} aria-busy={busy} onClick={() => void issue()}>{busy ? word('working') : word('issue')}</button>
      </div>}>
      <CoverLoader active={busy} scope="modal" label={word('working')}>
        <div className="space-y-3 [overflow-wrap:anywhere]">
          <p>{word('issue_confirm')}</p>
          {error !== null && <p role="alert" className="text-error-700">{apiErrorMessage(error)}</p>}
        </div>
      </CoverLoader>
    </Modal>
  </div></>;
}
export function ExpenseDisbursementVoidBlocker({ companyId, reservation, onClose, children, dialog = false }: { companyId: string; dialog?: boolean; reservation: ExpenseCorrectionCapabilities['disbursementReservation'] | undefined; onClose: () => void; children: ReactNode }) {
  if (!reservation) return children;
  const message = <p role="status" className="text-sm text-gray-600 [overflow-wrap:anywhere]">{expenseDisbursementReservationMessage('void', reservation.documentNumber, reservation.preparerName, reservation.viewerMay, reservation.viewerCanPay ?? false)}</p>;
  const close = <button type="button" className={`${ghostClass} w-full sm:w-auto`} onClick={onClose}>{t('common.close', 'th')}</button>;
  const open = <ExpenseDisbursementOpenLink companyId={companyId} reservation={reservation} primary />;
  return dialog ? <Modal open title={t('expenses.void_document', 'th')} closeOnBackdrop={false} onClose={onClose}
    footer={<div className="mangmee-safe-bottom grid w-full gap-2 sm:ml-auto sm:w-max sm:max-w-full sm:auto-cols-[minmax(8rem,1fr)] sm:grid-flow-col">{close}{open}</div>}>{message}</Modal>
    : <div className="space-y-2">{message}<div className="grid auto-cols-fr grid-flow-col gap-2 sm:w-max sm:auto-cols-[minmax(8rem,1fr)]">{close}{open}</div></div>;
}
