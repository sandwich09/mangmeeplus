'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS, DISBURSEMENT_VOUCHER_WORDS } from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { MoreActions } from '@/common/components/actions/MoreActions';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { Modal } from '@/common/components/modal';
import { Notice } from '@/common/components/notice';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDate, formatThaiDateTime } from '@/common/i18n/thai-date';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { PAYMENT_METHOD_LABELS } from '../expenses.model';
import { amountText, btnClass, ghostClass } from '../ExpensesUi';
import { getDisbursementVoucher } from './disbursement-vouchers.api';
import { disbursementVoucherDisplayAmount, disbursementLineShowsOutstanding, disbursementSummaryPartial, disbursementVoucherSummary } from './disbursement-vouchers.logic';
import { disbursementVoucherIsSender, disbursementPayeeBasisNote, disbursementVoucherHistory, disbursementVoucherMenu, disbursementVoucherPrimary, disbursementVoucherReturnNotice, disbursementVoucherSteps, disbursementReminderLast } from './disbursement-voucher-journey.logic';
import { useDisbursementVoucherRefresh } from './use-disbursement-voucher-refresh';
import { useDisbursementSendKind } from './use-disbursement-send-kind';
import { DisbursementVoucherCommandDialog } from './DisbursementVoucherCommandDialog';
import { DisbursementVoucherReissue } from './DisbursementVoucherReissue';
import { DisbursementVoucherDocumentFile } from './DisbursementVoucherDocumentFile';
import { DisbursementVoucherAccount } from './DisbursementVoucherAccount';
import { DisbursementVoucherSupportingFiles } from './DisbursementVoucherSupportingFiles';
import { DisbursementVoucherSlip } from './DisbursementVoucherSlip';
import { DisbursementVoucherWithholding } from './DisbursementVoucherWithholding';
import { DisbursementVoucherPayCard } from './DisbursementVoucherPayCard';
import { canPayDisbursementVoucher, disbursementCancelledPaymentLines } from './disbursement-voucher-payment.logic';
import type { DisbursementDialogKind, DisbursementVoucherDetail } from './disbursement-vouchers.model';
import { DisbursementVoucherStatusBadge } from './DisbursementVoucherUi';
import { disbursementVoucherPageTitle } from './disbursement-voucher-document.logic';
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
  const pageTitle = detail ? disbursementVoucherPageTitle(detail.header) : DISBURSEMENT_VOUCHER_WORDS.title;
  useEffect(() => {
    const previous = document.title;
    document.title = pageTitle;
    return () => { document.title = previous; };
  }, [pageTitle]);
  const menuOpener = useRef<HTMLElement | null>(null);
  const statusHeading = useRef<HTMLSpanElement>(null);
  const afterAction = useRef(false);
  const holdPrimary = () => { afterAction.current = true; setActionBusy(true); };
  useEffect(() => {
    if (!afterAction.current || dialog) return;
    const frame = requestAnimationFrame(() => {
      afterAction.current = false; window.scrollTo({ top: 0 });
      statusHeading.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [detail, dialog, actionBusy]);
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

  const sendChoice = useDisbursementSendKind(companyId, detail?.header.branchId, Boolean(detail?.actions.submitAndApprove), viewerUserId);
  if (!canRead) return <ForbiddenState titleAs="h1" />;
  const back = <Link href={listHref} className={ghostClass}>กลับไปรายการ</Link>;
  if (loading || error || !detail) {
    const status = (error as { status?: number } | null)?.status;
    return (
      <MangmeePage title={DISBURSEMENT_VOUCHER_WORDS.title} back={back} className={cx(styles.page, 'mangmee-flat')}>
        <MangmeeCard className={styles.section}>
          {loading ? <LoadingState label={t('expenses.disbursement.loading_document', 'th')} />
            : status === 403 ? <ForbiddenState />
              : status === 404 ? <EmptyState title={DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_not_found} description="" action={<Link href={listHref} className={ghostClass}>{t('expenses.disbursement.back_list', 'th')}</Link>} />
                : <ErrorState description={apiErrorMessage(error)} onRetry={() => setRetry((value) => value + 1)} />}
        </MangmeeCard>
      </MangmeePage>
    );
  }
  const { header, lines } = detail;
  const summary = disbursementVoucherSummary(detail);
  const display = disbursementVoucherDisplayAmount(detail);
  const isSender = disbursementVoucherIsSender(detail, viewerUserId);
  const offeredPrimary = disbursementVoucherPrimary(detail, viewerUserId);
  const primary = offeredPrimary === 'selfApprove' ? sendChoice : offeredPrimary;
  const lastReminder = header.status === 'PENDING_APPROVAL' ? disbursementReminderLast(detail) : null;
  const returned = disbursementVoucherReturnNotice(detail);
  // When any line carries another shop name, every line shows its own, so the reader can compare them. Lines that all carry the title's name do not repeat it.
  const mixedVendors = lines.some(line => line.vendorName && line.vendorName.trim() !== header.payeeName.trim());
  const basisNote = disbursementPayeeBasisNote(detail);
  // One control per destination: the sender's bar already holds "ส่งเตือนอีกครั้ง", so her menu does not repeat it.
  const orphaned = Boolean(header.submittedByUserId) && detail.preparerActive === false && detail.senderActive === false;
  const menu = disbursementVoucherMenu(detail).filter(action => action !== 'edit').filter(action => !(header.status === 'PAID' && action === 'history')).filter(action => !(action === 'remind' && isSender));
  const editHref = header.status === 'DRAFT' && detail.actions.edit ? `${listHref}/new?draft=${encodeURIComponent(id)}` : null;
  const history = disbursementVoucherHistory(detail);
  const canPay = canPayDisbursementVoucher(detail);
  const paid = header.status === 'PAID';
  const hasWht = Number(summary.withholding) > 0;
  const hasSenderActions = isSender && (detail.actions.remind || detail.actions.approve);
  const cancelledPayments = disbursementCancelledPaymentLines(detail);
  const primaryLabel = primary === 'selfApprove' ? 'expenses.disbursement.self_approve' : primary === 'approve' ? 'expenses.disbursement.approve_document' : 'expenses.disbursement.submit';
  return <DisbursementVoucherReissue key={id} companyId={companyId} detail={detail}>{(reissueButton, reissueNotice) => {
  // One extra action is shown as itself; a menu is only worth a press when it holds several.
  const moreEntries = menu.map(action => action === 'print' ? <DisbursementVoucherDocumentFile key={action} companyId={companyId} header={header} />
      : action === 'reissue' ? <span key={action}>{reissueButton()}</span>
      : <button key={action} type="button" className={action === 'delete' || action === 'cancel' ? `${ghostClass} ${styles.menuDanger}` : ghostClass} onClick={event => {
          menuOpener.current = event.currentTarget.closest('details')?.querySelector('summary') ?? event.currentTarget;
          event.currentTarget.closest('details')?.removeAttribute('open');
          if (action === 'history') { menuOpener.current = null; setHistoryOpen(true); } else setDialog(action);
        }}>
        {t(action === 'delete' ? 'expenses.disbursement.delete' : action === 'withdraw' ? 'expenses.disbursement.withdraw' : action === 'cancel' ? 'expenses.disbursement.cancel' : action === 'remind' ? 'expenses.disbursement.remind' : 'expenses.disbursement.history', 'th')}
      </button>);
  const more = <>
    {header.status === 'PAID' && <button type="button" className={ghostClass} onClick={() => setHistoryOpen(true)}>ดูประวัติ</button>}
    {/* A sent-back draft carries its own "แก้ไข" inside the notice that says why: one control per destination. */}
    {!(returned && detail.actions.edit) && editHref && <Link href={editHref} className={ghostClass}>{t('common.edit', 'th')}</Link>}
    {menu.length === 1 ? moreEntries : menu.length > 1 && <MoreActions label={t('expenses.disbursement.more', 'th')} align="end">{moreEntries}</MoreActions>}
  </>;

  return (
    <MangmeePage eyebrow={<span className="mangmee-unit">{paid ? 'ใบสำคัญจ่าย' : 'ใบเตรียมจ่าย'} {header.documentNumber ?? 'ยังไม่มีเลขที่'}</span>} title={header.payeeName} description={<span ref={statusHeading} tabIndex={-1} role="heading" aria-level={2} className="flex flex-wrap items-center gap-2 outline-none">
      {returned ? <MangmeeBadge tone="amber">ส่งกลับให้แก้</MangmeeBadge> : <DisbursementVoucherStatusBadge status={header.status} />}
    </span>} back={back} actions={<div className={styles.more}>{more}</div>} className={cx(styles.page, styles.documentPage, 'mangmee-flat', (primary || hasSenderActions || canPay || header.status === 'PAID') && styles.journeyPage)}>
      <div className={styles.stack}>
        {paid && <p className="text-sm text-gray-600">หลักฐานว่าบันทึกจ่ายแล้ว</p>}
        {orphaned && <Notice tone="warning" action={(detail.actions.withdraw || detail.actions.cancel) && <ActionGroup>
          {detail.actions.withdraw && <button type="button" className={ghostClass} onClick={() => setDialog('withdraw')}>กลับไปแก้</button>}
          {detail.actions.cancel && <button type="button" className={ghostClass} onClick={() => setDialog('cancel')}>ยกเลิกใบ</button>}
        </ActionGroup>}>
          ผู้เตรียมและผู้ส่งใบนี้ถูกปิดใช้งานแล้ว
          {permissions.includes('expense.disbursement.approve') && !detail.actions.withdraw && !detail.actions.cancel && !['PAID', 'CANCELLED'].includes(header.status) && <span className="block">ให้เจ้าของกิจการกลับไปแก้หรือยกเลิกใบนี้</span>}
        </Notice>}
        {!['PAID', 'CANCELLED'].includes(header.status) && <ThemedSteps steps={disbursementVoucherSteps(header.status)} aria-label="ขั้นตอน" />}
        {returned && <Notice tone="warning" action={detail.actions.edit && <Link className={ghostClass} href={`${listHref}/new?draft=${encodeURIComponent(id)}`}>{t('common.edit', 'th')}</Link>}>
          {returned.title}{returned.reason && <span className={cx('block', styles.historyReason)}>{returned.reason}</span>}
        </Notice>}
        {reissueNotice}
        {display.excludesCancelled && <Notice tone="warning">{t('expenses.disbursement.cancelled_amount_note', 'th')}</Notice>}
        {disbursementSummaryPartial(summary) && <Notice tone="warning">{t('expenses.disbursement.partial_note', 'th')}</Notice>}
        <MangmeeCard className={cx(styles.section, styles.stack, styles.mainCard)}>
          <div>
            <h2 className={styles.muted}>{paid ? 'ยอดที่จ่าย' : 'ยอดที่จะจ่าย'}</h2>
            <p className={cx('text-3xl font-semibold tabular-nums mangmee-unit', paid ? 'text-brand-700' : 'text-gray-900')}>
              {amountText(display.amount)} <span className="text-base font-normal">บาท</span>
            </p>
          </div>
          <dl className={styles.mainFacts}>
            {paid ? <>
              {header.paidDate && <div><dt>วันที่จ่าย</dt><dd className="mangmee-unit">{formatThaiDate(header.paidDate)}</dd></div>}
              {header.paidMethod && <div><dt>วิธีจ่าย</dt><dd>{PAYMENT_METHOD_LABELS[header.paidMethod]}</dd></div>}
            </> : <>
              {header.plannedPayDate && <div><dt>กำหนดจ่าย</dt><dd className="mangmee-unit">{formatThaiDate(header.plannedPayDate)}</dd></div>}
              {header.plannedMethod && <div><dt>วิธีที่จะจ่าย</dt><dd>{PAYMENT_METHOD_LABELS[header.plannedMethod]}</dd></div>}
            </>}
            {header.payeeAccountLast4 && !canPay && <div><dt>บัญชีผู้รับ</dt><dd><DisbursementVoucherAccount key={`${id}:${header.payeeAccountLast4}`} companyId={companyId} header={header} permissions={permissions} /></dd></div>}
            {paid && header.paidFromRef?.trim() && <div><dt>จ่ายจาก</dt><dd>{header.paidFromRef}</dd></div>}
            {hasWht && <>
              <div><dt>รวมเป็นเงิน</dt><dd className="mangmee-unit">{amountText(summary.gross)} บาท</dd></div>
              <div><dt>หัก ณ ที่จ่าย</dt><dd className="mangmee-unit">{amountText(summary.withholding)} บาท</dd></div>
            </>}
            {!paid && header.note?.trim() && <div className={styles.factNote}><dt>หมายเหตุ</dt><dd>{header.note}</dd></div>}
          </dl>
          {header.status === 'PENDING_APPROVAL' && (detail.requestedApproverName || lastReminder) && <p className={styles.muted}>
            {detail.requestedApproverName && <span>รอ {detail.requestedApproverName} อนุมัติ</span>}{detail.requestedApproverName && lastReminder && ' · '}{lastReminder}
          </p>}
          {header.origin === 'DIRECT_PAYMENT' && <p className={styles.muted}>{DISBURSEMENT_VOUCHER_WORDS.directPayment}</p>}
          {canPay && <div className={styles.mainCardEnd}><DisbursementVoucherPayCard key={`${id}:${header.version}`} companyId={companyId} detail={detail} permissions={permissions} actionBlocked={Boolean(dialog) || actionBusy} onSuccess={holdPrimary} onReload={reloadDocument} onWithdraw={() => setDialog('withdraw')} /></div>}
          <DisbursementVoucherSupportingFiles companyId={companyId} id={id} initialFiles={detail.supportingFiles ?? []} />
          {paid && <div className={styles.mainCardEnd}><DisbursementVoucherSlip key={id} companyId={companyId} id={id} slip={detail.slip} canAttach={detail.canAttachSlip} /></div>}
        </MangmeeCard>
        {basisNote && <p className={styles.muted}>{basisNote}</p>}
        <MangmeeCard className={styles.section}>
          <h2 className="mb-3 text-base font-semibold">รายการในใบนี้ ({lines.length})</h2>
          <div className={styles.documentLines} data-testid="disbursement-voucher-line-card-list">
            <div className={cx(styles.documentLine, styles.documentLineHead)}><span>รายการ</span><span>วันที่</span><span>ยอด (บาท)</span><span>{hasWht ? 'หัก ณ ที่จ่าย (บาท)' : ''}</span></div>
            {lines.map(line => <div key={line.expenseId} className={styles.documentLineGroup}>
              {(() => {
                const content = <>
                  <div className={styles.documentLineDescription}><strong>{line.description ?? line.expenseNumber}</strong>
                    <p className={styles.muted}>{/* A line without a description is already titled by its number: the number is not repeated under it. */}{(() => { const number = line.description ? line.expenseNumber : null; const invoice = line.vendorInvoiceNumber?.trim(); return <>{number && <span className="whitespace-nowrap">{number}</span>}{invoice && <>{number ? ' · ' : ''}{invoice}</>}<span className={styles.linePhoneDate}>{number || invoice ? ' · ' : ''}{formatThaiDate(line.expenseDate)}</span></>; })()}{line.vendorName && mixedVendors && <> · {line.vendorName}</>}</p>
                  </div>
                  <span className={cx(styles.lineWideDate, 'mangmee-unit')}>{formatThaiDate(line.expenseDate)}</span>
                  <span className={cx(styles.documentLineAmount, 'mangmee-unit')}>{amountText(line.amount)}<span className={styles.linePhoneDate}> บาท</span></span>
                  <span className={cx(styles.documentLineWht, 'mangmee-unit')}>{Number(line.whtAmount) > 0 && <><span className={styles.linePhoneDate}>หัก ณ ที่จ่าย </span>{amountText(line.whtAmount)}<span className={styles.linePhoneDate}> บาท</span></>}</span>
                </>;
                return permissions.includes('expense.read') ? <Link href={`/companies/${companyId}/expenses/${encodeURIComponent(line.expenseId)}`} aria-label={`เปิดรายจ่าย ${line.expenseNumber ?? ''}`} className={styles.documentLine}>{content}</Link> : <div className={styles.documentLine}>{content}</div>;
              })()}
              {disbursementLineShowsOutstanding(line) && <p className={styles.muted}>{t('expenses.disbursement.outstanding_now', 'th')} <span className="mangmee-unit">{amountText(line.outstandingAmount)} บาท</span></p>}
              <DisbursementVoucherWithholding companyId={companyId} detail={detail} line={line} canIssue={permissions.includes('wht.certificate.issue')}
                note={cancelledPayments.length > 0 && line.expensePaymentId && <p className={line.paymentInEffect ? styles.muted : styles.error}>
                  {t(line.paymentInEffect ? 'expenses.disbursement.payment_live' : 'expenses.disbursement.payment_cancelled', 'th')}
                </p>} />
            </div>)}
          </div>
        </MangmeeCard>
      </div>

      {(header.status === 'PAID' || header.status === 'CANCELLED' && header.cancelledAfterPaid) && <DisbursementVoucherDocumentFile key={`${id}:document`} companyId={companyId} header={header} primary={header.status === 'PAID'} actionBlocked={actionBusy} />}
      {(primary || hasSenderActions) && <div className={styles.journeyBar}>
        <div className={styles.journeyBarInner}>
          {primary && <ActionGroup>
            {detail.actions.return && <button type="button" className={ghostClass} disabled={Boolean(dialog) || actionBusy} onClick={() => setDialog('return')}>{t('expenses.disbursement.return', 'th')}</button>}
            <button type="button" className={cx(btnClass, styles.action)} disabled={Boolean(dialog) || actionBusy} aria-busy={actionBusy} onClick={() => { if (!dialog && !actionBusy) setDialog(primary); }}>{t(primaryLabel, 'th')}</button>
          </ActionGroup>}
          {/* The sender's two buttons are one group: one size, side by side. Pulling the document back is in the menu above. */}
          {hasSenderActions && <ActionGroup>
            {isSender && detail.actions.remind && <button type="button" className={ghostClass} disabled={Boolean(dialog) || actionBusy} onClick={() => setDialog('remind')}>{t('expenses.disbursement.remind', 'th')}</button>}
            {isSender && detail.actions.approve && <button type="button" className={ghostClass} disabled={Boolean(dialog) || actionBusy} onClick={() => setDialog('approve')}>{t('expenses.disbursement.approve_self', 'th')}</button>}
          </ActionGroup>}
        </div>
      </div>}
      {dialog && <DisbursementVoucherCommandDialog key={`${id}:${dialog}`} companyId={companyId} detail={detail} kind={dialog} viewerUserId={viewerUserId}
        onClose={() => { setDialog(null); if (!afterAction.current && menuOpener.current) { const opener = menuOpener.current; requestAnimationFrame(() => opener.focus({ preventScroll: true })); } menuOpener.current = null; }} onSuccess={holdPrimary} onReload={reloadDocument} onDeleted={() => router.push(listHref)} />}
      <Modal open={historyOpen} title={t('expenses.disbursement.history_title', 'th')} onClose={() => setHistoryOpen(false)} closeOnBackdrop={false}
        footer={<button type="button" className={ghostClass} onClick={() => setHistoryOpen(false)}>{t('common.close', 'th')}</button>}>
        <section className={styles.stack}>
          {history.map(group => <section key={group.day} className={styles.stack}>
            <h2 className={styles.payee}>{formatThaiDate(group.day)}</h2>
            <ol className={styles.history}>
              {group.events.map(event => <li key={event.key} className={styles.historyEvent}>
                <p className={styles.muted}><span className="mangmee-unit">{formatThaiDateTime(event.at)}</span>{event.actor && <> · {event.actor}</>}</p>
                <p>{event.label}</p>
                {event.key === 'paid' && <dl className={styles.facts}>
                  {header.paidDate && <div><dt>วันที่จ่าย</dt><dd className="mangmee-unit">{formatThaiDate(header.paidDate)}</dd></div>}
                  {header.paidMethod && <div><dt>วิธีจ่าย</dt><dd>{PAYMENT_METHOD_LABELS[header.paidMethod]}</dd></div>}
                  {header.paidFromRef?.trim() && <div><dt>จ่ายจาก</dt><dd>{header.paidFromRef}</dd></div>}
                </dl>}
                {event.key === 'paid' && header.status === 'CANCELLED' && <DisbursementVoucherSlip companyId={companyId} id={id} slip={detail.slip} canAttach={detail.canAttachSlip} />}
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
