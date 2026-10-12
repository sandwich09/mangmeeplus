'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS, DISBURSEMENT_VOUCHER_WORDS } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { MoreActions } from '@/common/components/actions/MoreActions';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { Modal } from '@/common/components/modal';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDate, formatThaiDateTime, formatThaiTime } from '@/common/i18n/thai-date';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { MoneyRow } from '../ExpensesPages';
import { PAYMENT_METHOD_LABELS } from '../expenses.model';
import { baht, btnClass, ghostClass } from '../ExpensesUi';
import { getDisbursementVoucher } from './disbursement-vouchers.api';
import { disbursementVoucherDisplayAmount, disbursementLineShowsOutstanding, disbursementSameAmount, disbursementSummaryPartial, disbursementVoucherNextSentence, disbursementVoucherSummary } from './disbursement-vouchers.logic';
import { disbursementReturnedApprover, disbursementVoucherIsSender, disbursementVoucherSenderSentence, disbursementPayeeBasisNote, disbursementVoucherHistory, disbursementVoucherMenu, disbursementVoucherPrimary, disbursementVoucherReturnNotice, disbursementVoucherSteps, disbursementVoucherWaitingLines, disbursementReminderLast } from './disbursement-voucher-journey.logic';
import { useDisbursementVoucherRefresh } from './use-disbursement-voucher-refresh';
import { DisbursementVoucherCommandDialog } from './DisbursementVoucherCommandDialog';
import { DisbursementVoucherReissue } from './DisbursementVoucherReissue';
import { DisbursementVoucherDocumentFile } from './DisbursementVoucherDocumentFile';
import { DisbursementVoucherAccount } from './DisbursementVoucherAccount';
import { DisbursementVoucherSlip } from './DisbursementVoucherSlip';
import { DisbursementVoucherWithholding } from './DisbursementVoucherWithholding';
import { DisbursementVoucherPayCard } from './DisbursementVoucherPayCard';
import { canPayDisbursementVoucher, disbursementCancelledPaymentLines } from './disbursement-voucher-payment.logic';
import type { DisbursementDialogKind, DisbursementVoucherDetail } from './disbursement-vouchers.model';
import { DisbursementVoucherStatusBadge } from './DisbursementVoucherUi';
import styles from './disbursement-vouchers.module.css';

export function DisbursementVoucherDocumentPage({ companyId, id, permissions, viewerUserId }: { companyId: string; id: string; permissions: string[]; viewerUserId?: string | null }) {
  const router = useRouter();
  const canRead = permissions.includes('expense.disbursement.read');
  const [detail, setDetail] = useState<DisbursementVoucherDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [dialog, setDialog] = useState<DisbursementDialogKind | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const holdPrimary = () => setActionBusy(true);
  useEffect(() => {
    if (!actionBusy) return;
    const timer = setTimeout(() => setActionBusy(false), 600);
    return () => clearTimeout(timer);
  }, [actionBusy]);
  const listHref = `/companies/${companyId}/expenses/disbursement-vouchers`;

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    setLoading(true); setError(null);
    void getDisbursementVoucher(companyId, id)
      .then((data) => { if (active) setDetail(data); })
      .catch((failure: unknown) => { if (active) setError(failure); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, id, canRead, retry]);

  const reloadDocument = async (canApply?: () => boolean) => {
    try {
      const data = await getDisbursementVoucher(companyId, id, { suppressErrorToast: true });
      if (!canApply || canApply()) setDetail(data);
    } catch (failure) {
      const status = (failure as { status?: number }).status;
      if ((!canApply || canApply()) && (status === 403 || status === 404)) { setDetail(null); setError(failure); }
      throw failure;
    }
  };

  useDisbursementVoucherRefresh(canRead && Boolean(detail) && !loading && !error, Boolean(dialog) || historyOpen, reloadDocument);

  if (!canRead) return <ForbiddenState />;
  const back = <Link href={listHref} className={ghostClass}>{t('expenses.disbursement.back_list', 'th')}</Link>;
  if (loading || error || !detail) {
    const status = (error as { status?: number } | null)?.status;
    return (
      <MangmeePage title={DISBURSEMENT_VOUCHER_WORDS.title} eyebrow={back} className={styles.page}>
        <MangmeeCard className={styles.section}>
          {loading ? <LoadingState label={t('expenses.disbursement.loading_document', 'th')} />
            : status === 403 ? <ForbiddenState />
              : status === 404 ? <EmptyState title={DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_not_found} description="" action={back} />
                : <ErrorState description={apiErrorMessage(error)} onRetry={() => setRetry((value) => value + 1)} />}
        </MangmeeCard>
      </MangmeePage>
    );
  }
  const { header, lines } = detail;
  const summary = disbursementVoucherSummary(detail);
  const display = disbursementVoucherDisplayAmount(detail);
  const isSender = disbursementVoucherIsSender(detail, viewerUserId);
  const primary = disbursementVoucherPrimary(detail, viewerUserId);
  const next = isSender ? disbursementVoucherSenderSentence(detail) : disbursementVoucherNextSentence(detail, viewerUserId);
  const waitingLines = isSender ? [] : disbursementVoucherWaitingLines(detail);
  const lastReminder = header.status === 'PENDING_APPROVAL' ? disbursementReminderLast(detail) : null;
  const returned = disbursementVoucherReturnNotice(detail);
  // When any line carries another shop name, every line shows its own, so the reader can compare them.
  const mixedVendors = lines.some(line => line.vendorName && line.vendorName.trim() !== header.payeeName.trim());
  const basisNote = disbursementPayeeBasisNote(detail);
  const menu = disbursementVoucherMenu(detail);
  const history = disbursementVoucherHistory(detail);
  const canPay = canPayDisbursementVoucher(detail);
  const returnedApprover = disbursementReturnedApprover(detail, viewerUserId);
  const hasSenderActions = isSender && (detail.actions.remind || detail.actions.withdraw || detail.actions.approve);
  const cancelledPayments = disbursementCancelledPaymentLines(detail);
  const primaryLabel = primary === 'selfApprove' ? 'expenses.disbursement.self_approve' : primary === 'approve' ? 'expenses.disbursement.approve_document' : returnedApprover ? 'expenses.disbursement.send_other' : 'expenses.disbursement.submit';
  return <DisbursementVoucherReissue key={id} companyId={companyId} detail={detail}>{(reissueButton, reissueNotice) => {
  // One extra action is shown as itself; a menu is only worth a press when it holds several.
  const moreEntries = menu.map(action => action === 'edit'
      ? <Link key={action} href={`${listHref}/new?draft=${encodeURIComponent(id)}`} className={ghostClass}>{t('common.edit', 'th')}</Link>
      : action === 'print' ? <DisbursementVoucherDocumentFile key={action} companyId={companyId} header={header} />
      : action === 'reissue' ? <span key={action}>{reissueButton()}</span>
      : <button key={action} type="button" className={action === 'delete' || action === 'cancel' ? `${ghostClass} ${styles.menuDanger}` : ghostClass} onClick={event => {
          event.currentTarget.closest('details')?.removeAttribute('open');
          if (action === 'history') setHistoryOpen(true); else setDialog(action);
        }}>
        {t(action === 'delete' ? 'expenses.disbursement.delete' : action === 'withdraw' ? 'expenses.disbursement.withdraw' : action === 'cancel' ? 'expenses.disbursement.cancel' : action === 'remind' ? 'expenses.disbursement.remind' : 'expenses.disbursement.history', 'th')}
      </button>);
  const more = menu.length === 1 ? moreEntries : menu.length > 1 && <MoreActions label={t('expenses.disbursement.more', 'th')} align="end">{moreEntries}</MoreActions>;

  return (
    <MangmeePage title={header.payeeName} eyebrow={back} actions={more && <div className={styles.more}>{more}</div>} className={cx(styles.page, (primary || hasSenderActions || canPay || header.status === 'PAID') && styles.journeyPage)}>
      <div className={styles.stack}>
        <ThemedSteps steps={disbursementVoucherSteps(header.status)} />
        <MangmeeCard className={cx(styles.section, styles.stack)}>
          <p className={styles.muted}>{header.paidRecordedAt ? DISBURSEMENT_VOUCHER_WORDS.oncePaid : DISBURSEMENT_VOUCHER_WORDS.beforePaid}</p>
          <div className={styles.cardHeader}>
            <p className={cx(styles.payee, styles.documentNumber)}>{header.documentNumber ? <>{t('expenses.disbursement.number', 'th').replace('{number}', '')}<span className="whitespace-nowrap">{header.documentNumber}</span></>
              : t(header.status === 'DRAFT' ? 'expenses.disbursement.draft_no_number' : 'expenses.disbursement.no_number', 'th')}</p>
            <DisbursementVoucherStatusBadge status={header.status} />
          </div>
          {header.origin === 'DIRECT_PAYMENT' && <p className={styles.muted}>{DISBURSEMENT_VOUCHER_WORDS.directPayment}</p>}
          {next && <p>{next}</p>}
          {isSender && detail.actions.approve && <p className={styles.muted}>{t('expenses.disbursement.sender_can_approve', 'th')}</p>}
          {waitingLines.map(line => <p key={line} className={styles.muted}>{line}</p>)}
          {lastReminder && <p className={styles.muted}>{lastReminder}</p>}
          {header.origin !== 'DIRECT_PAYMENT' && detail.preparerName && <p className={styles.muted}>{t('expenses.disbursement.reservation_preparer', 'th').replace('{name}', detail.preparerName)}</p>}
          {returned && <div role="status" className={styles.notice}>
            <p>{returned.title}</p>
            {returned.reason && <p className={styles.historyReason}>{returned.reason}</p>}
            {detail.actions.edit && <Link className={ghostClass} href={`${listHref}/new?draft=${encodeURIComponent(id)}`}>{t('common.edit', 'th')}</Link>}
          </div>}
          {/* One number unless more adds information: the amount with its name; the make-up of it only when tax was withheld or the payout is partial. */}
          <div>
            <p className={styles.amountLabel}>{t(header.paidRecordedAt ? 'expenses.disbursement.paid_amount' : header.status === 'CANCELLED' ? 'expenses.disbursement.line_amount' : 'expenses.disbursement.net', 'th')}</p>
            <div className={styles.amount}>{baht(display.amount)}</div>
          </div>
          {display.excludesCancelled && <p className={styles.muted}>{t('expenses.disbursement.cancelled_amount_note', 'th')}</p>}
          {!disbursementSameAmount(summary.gross, summary.payout) && <div>
            <MoneyRow label={t('expenses.disbursement.gross', 'th')} value={summary.gross} />
            <MoneyRow label={t('expenses.disbursement.wht', 'th')} value={summary.withholding} />
            {disbursementSummaryPartial(summary) && <p className={styles.muted}>{t('expenses.disbursement.partial_note', 'th')}</p>}
          </div>}
          {!canPay && !header.paidRecordedAt && header.status !== 'PAID' && <DisbursementVoucherAccount key={`${id}:${header.payeeAccountLast4}`} companyId={companyId} header={header} permissions={permissions} />}
          {header.approvedAt && <p className={styles.muted}>{t('expenses.disbursement.approved_by_at', 'th').replace('{name}', detail.approvedByName ?? t('expenses.disbursement.removed_member', 'th')).replace('{time}', formatThaiDateTime(header.approvedAt))}{header.selfApproved && <> · {t('expenses.disbursement.history_self', 'th')}</>}</p>}

        </MangmeeCard>

        {reissueNotice}
        {canPay && <DisbursementVoucherPayCard key={`${id}:${header.version}`} companyId={companyId} detail={detail} permissions={permissions} actionBlocked={Boolean(dialog) || actionBusy} onSuccess={holdPrimary} onReload={reloadDocument} onWithdraw={() => setDialog('withdraw')} />}
        {(header.status === 'PAID' || header.paidRecordedAt) && <MangmeeCard className={cx(styles.section, styles.stack)}>
          <dl className={styles.facts}>
            <div><dt>{t('expenses.disbursement.actual_paid_date', 'th')}</dt><dd>{formatThaiDate(header.paidDate)}</dd></div>
            <div><dt>{t('expenses.disbursement.paid_method', 'th')}</dt><dd>{header.paidMethod ? PAYMENT_METHOD_LABELS[header.paidMethod] : '—'}</dd></div>
            {header.paidFromRef && <div><dt>{t('expenses.disbursement.paid_from', 'th')}</dt><dd>{header.paidFromRef}</dd></div>}
            <div><dt>{t('expenses.disbursement.paid_by', 'th')}</dt><dd>{detail.paidByName ?? (header.paidByUserId ? t('expenses.disbursement.removed_member', 'th') : '—')}</dd></div>
            <div><dt>{t('expenses.disbursement.paid_recorded_at', 'th')}</dt><dd>{formatThaiDateTime(header.paidRecordedAt)}</dd></div>
          </dl>
          <DisbursementVoucherAccount key={`${id}:${header.payeeAccountLast4}`} companyId={companyId} header={header} permissions={permissions} />
          <DisbursementVoucherSlip key={id} companyId={companyId} id={id} slip={detail.slip} canAttach={detail.canAttachSlip} />
        </MangmeeCard>}
        {basisNote && <p className={styles.muted}>{basisNote}</p>}
        <div className={styles.lines} data-testid="disbursement-voucher-line-card-list">
          {lines.map((line) => (
            <MangmeeCard key={line.expenseId} className={cx(styles.section, styles.stack)}>
              {/* What was bought and its amount in this document on one row; other amounts only when they differ from it. */}
              <div className={styles.lineHead}>
                <div className="min-w-0">
                  <p className="font-semibold">{line.description ?? <span className="whitespace-nowrap">{line.expenseNumber}</span>}</p>
                  <p className={styles.muted}>
                    {line.description && line.expenseNumber && <><span className="whitespace-nowrap">{line.expenseNumber}</span> · </>}
                    <span className="whitespace-nowrap">{formatThaiDate(line.expenseDate)}</span>
                    {line.vendorName && (header.status === 'PENDING_APPROVAL' && detail.actions.approve || mixedVendors) && <> · {line.vendorName}</>}
                  </p>
                </div>
                <p className={styles.lineAmount}>{baht(line.amount)}</p>
              </div>
              {(disbursementLineShowsOutstanding(line) || header.status === 'PENDING_APPROVAL' && detail.actions.approve && Number(line.whtAmount) > 0) && <div>
                {disbursementLineShowsOutstanding(line) && <MoneyRow label={t('expenses.disbursement.outstanding_now', 'th')} value={line.outstandingAmount} />}
                {header.status === 'PENDING_APPROVAL' && detail.actions.approve && Number(line.whtAmount) > 0 && <MoneyRow label={t('expenses.disbursement.wht', 'th')} value={line.whtAmount} />}
              </div>}
              <DisbursementVoucherWithholding companyId={companyId} detail={detail} line={line} canIssue={permissions.includes('wht.certificate.issue')}
                note={cancelledPayments.length > 0 && line.expensePaymentId && <p className={line.paymentInEffect ? styles.muted : styles.error}>
                  {t(line.paymentInEffect ? 'expenses.disbursement.payment_live' : 'expenses.disbursement.payment_cancelled', 'th')}
                </p>}
                actions={permissions.includes('expense.read') && <Link href={`/companies/${companyId}/expenses/${encodeURIComponent(line.expenseId)}`} className={ghostClass}>ดูใบเสร็จ</Link>} />
            </MangmeeCard>
          ))}
        </div>

        {(header.plannedPayDate || header.plannedMethod || header.note) && <MangmeeCard className={styles.section}>
          <dl className={styles.facts}>
            {header.plannedPayDate && <div><dt>{t('expenses.disbursement.planned_date', 'th')}</dt><dd>{formatThaiDate(header.plannedPayDate)}</dd></div>}
            {header.plannedMethod && <div><dt>{t('expenses.disbursement.planned_method', 'th')}</dt><dd>{PAYMENT_METHOD_LABELS[header.plannedMethod]}</dd></div>}
            {header.note && <div><dt>{t('expenses.disbursement.note', 'th')}</dt><dd>{header.note}</dd></div>}
          </dl>
        </MangmeeCard>}
      </div>

      {(header.status === 'PAID' || header.status === 'CANCELLED' && header.cancelledAfterPaid) && <DisbursementVoucherDocumentFile key={`${id}:document`} companyId={companyId} header={header} primary={header.status === 'PAID'} actionBlocked={actionBusy} />}
      {(primary || hasSenderActions) && <div className={styles.journeyBar}>
        <div className={styles.journeyBarInner}>
          {primary && <button type="button" className={cx(btnClass, styles.action)} disabled={Boolean(dialog) || actionBusy} aria-busy={actionBusy} onClick={() => { if (!dialog && !actionBusy) setDialog(primary); }}>{t(primaryLabel, 'th')}</button>}
          {isSender && detail.actions.remind && <button type="button" className={ghostClass} disabled={Boolean(dialog) || actionBusy} onClick={() => setDialog('remind')}>{t('expenses.disbursement.remind', 'th')}</button>}
          {isSender && detail.actions.withdraw && <button type="button" className={ghostClass} disabled={Boolean(dialog) || actionBusy} onClick={() => setDialog('withdraw')}>{t('expenses.disbursement.withdraw', 'th')}</button>}
          {isSender && detail.actions.approve && <button type="button" className={ghostClass} disabled={Boolean(dialog) || actionBusy} onClick={() => setDialog('approve')}>{t('expenses.disbursement.approve_self', 'th')}</button>}
          {returnedApprover && <button type="button" className={ghostClass} onClick={() => setDialog('selfApprove')}>{t('expenses.disbursement.self_approve', 'th')}</button>}
          {primary === 'selfApprove' && detail.actions.submit && <button type="button" className={ghostClass} onClick={() => setDialog('submit')}>{t('expenses.disbursement.send_other', 'th')}</button>}
          {header.status === 'PENDING_APPROVAL' && detail.actions.return && <button type="button" className={ghostClass} onClick={() => setDialog('return')}>{t('expenses.disbursement.return', 'th')}</button>}
        </div>
      </div>}
      {dialog && <DisbursementVoucherCommandDialog key={`${id}:${dialog}`} companyId={companyId} detail={detail} kind={dialog} viewerUserId={viewerUserId}
        onClose={() => setDialog(null)} onSuccess={holdPrimary} onReload={reloadDocument} onDeleted={() => router.push(listHref)} />}
      <Modal open={historyOpen} title={t('expenses.disbursement.history_title', 'th')} onClose={() => setHistoryOpen(false)} closeOnBackdrop={false}
        footer={<div className={styles.modalFooter}><button type="button" className={`${ghostClass} w-full sm:w-auto`} onClick={() => setHistoryOpen(false)}>{t('common.close', 'th')}</button></div>}>
        <section className={styles.stack}>
          {history.map(group => <section key={group.day} className={styles.stack}>
            <h2 className={styles.payee}>{formatThaiDate(group.day)}</h2>
            <ol className={styles.history}>
              {group.events.map(event => <li key={event.key} className={styles.historyEvent}>
                <p className={styles.muted}>{formatThaiTime(event.at)}{event.actor && <> · {event.actor}</>}</p>
                <p>{event.label}</p>
                {event.recipient && <p className={styles.muted}>{t('expenses.disbursement.history_to', 'th').replace('{name}', event.recipient)}</p>}
                {event.reason && <p className={styles.historyReason}>{event.reason}</p>}
              </li>)}
            </ol>
          </section>)}
        </section>
      </Modal>
    </MangmeePage>
  );
  }}</DisbursementVoucherReissue>;
}
