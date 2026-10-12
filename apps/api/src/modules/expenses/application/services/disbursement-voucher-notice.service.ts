import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DISBURSEMENT_VOUCHER_NOTICE_WORDS as words, type DisbursementVoucherHeader, type RequestContext } from '@watchdog-bms/contracts';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { PrismaDisbursementVoucherRepository } from '../../infrastructure/prisma-disbursement-voucher.repository';
import { formatThaiExportDate } from '../../../../common/export/thai-date.logic';

type NoticeAction = 'submit' | 'approve' | 'return' | 'withdraw' | 'pay' | 'cancel' | 'remind';

/** Called only after commit. Notice failures never change the command's result. */
@Injectable()
export class DisbursementVoucherNoticeService {
  constructor(private readonly repo: PrismaDisbursementVoucherRepository, private readonly notify: CreateOrUpdateNotificationEventUseCase) {}

  async send(ctx: RequestContext, header: DisbursementVoucherHeader, action: NoticeAction,
    options: { reason?: string | null; approverUserId?: string; hasRemainingPayments?: boolean; hasEarlierPayment?: boolean } = {}) {
    try {
      if (!header.documentNumber || action === 'submit' && header.selfApproved) return;
      const names = await this.repo.memberNames(ctx.companyId, [ctx.userId, header.preparedByUserId]);
      const actor = names.get(ctx.userId) ?? 'ผู้ทำรายการ';
      const facts: Record<string, string> = { number: header.documentNumber, payee: header.payeeName, total: new Decimal(header.totalAmount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
        preparer: names.get(header.preparedByUserId) ?? 'ผู้จัดทำ', actor, approver: actor, payer: actor,
        reason: options.reason ?? header.cancelReason ?? header.returnReason ?? '',
        reasonSuffix: options.reason ? ` เหตุผล: ${options.reason}` : '',
        date: formatThaiExportDate(header.paidDate) };
      let suffix: string, title: string, body: string, recipients: string[];
      let periodKey = String(header.revision);
      let payerRecipients: string[] = [];
      let preparerCanPay = false;
      if (action === 'submit' || action === 'remind') {
        suffix = 'pending_approval'; title = action === 'remind' ? words.reminderTitle : words.pendingTitle; body = action === 'remind' ? words.reminderBody : words.pendingBody;
        recipients = [options.approverUserId ?? header.requestedApproverUserId ?? ''].filter(Boolean);
        if (action === 'remind') periodKey = `${header.revision}:${header.reminderCount}`;
      } else if (action === 'approve') {
        if (ctx.userId === header.preparedByUserId) return;
        suffix = 'approved'; title = words.approvedTitle; body = words.approvedBody; recipients = [header.preparedByUserId];
        const payers = await this.repo.membersWithPermission(ctx.companyId, header.branchId, 'expense.disbursement.pay');
        preparerCanPay = payers.some(p => p.userId === header.preparedByUserId);
        if (!preparerCanPay) body = words.approvedCannotPayBody;
        if (!payers.some(p => p.userId === ctx.userId || p.userId === header.preparedByUserId)) payerRecipients = payers.map(p => p.userId);
      } else if (action === 'return' || action === 'withdraw') {
        suffix = 'returned'; title = words.returnedTitle; body = action === 'return' ? words.returnedBody : words.withdrawnBody; recipients = [header.preparedByUserId];
      } else if (action === 'pay') {
        suffix = 'paid'; title = words.paidTitle; body = words.paidBody; recipients = [header.preparedByUserId]; periodKey = header.id;
      } else {
        suffix = 'cancelled'; title = words.cancelledTitle; recipients = [header.preparedByUserId]; periodKey = header.id;
        const sources = options.hasRemainingPayments === undefined && options.hasEarlierPayment === undefined
          ? await this.repo.notificationFacts(ctx.companyId, header.id) : options;
        // Cancelling the document never erases an earlier partial payment; a one-line cancelled
        // payment also leaves nothing to reissue. Each sentence must describe those facts truthfully.
        body = header.cancelledAfterPaid ? sources?.hasRemainingPayments ? words.cancelledAfterPaidBody : words.cancelledNoPaymentBody
          : sources?.hasEarlierPayment ? words.cancelledPartialBody : words.cancelledBody;
      }
      const active = new Set(await this.repo.activeMemberIds(ctx.companyId, [...recipients, ...payerRecipients]));
      const render = (template: string) => template.replace(/\{(\w+)\}/g, (_, key: string) => facts[key] ?? '');
      const messages = [{ title, body, recipients, periodKey, severity: suffix === 'pending_approval' || preparerCanPay ? 'action' as const : 'info' as const },
        ...(payerRecipients.length ? [{ title: words.payerTitle, body: words.payerBody, recipients: payerRecipients, periodKey: `${periodKey}:payers`, severity: 'action' as const }] : [])];
      for (const message of messages) {
        const recipientUserIds = [...new Set(message.recipients)].filter(id => id !== ctx.userId && active.has(id));
        if (!recipientUserIds.length) continue;
        await this.notify.execute({ companyId: ctx.companyId, triggerKey: `expense.disbursement_${suffix}`, sourceModule: 'expenses',
          sourceType: 'disbursement_voucher', sourceId: header.id, periodKey: message.periodKey, sourceRefs: [{ revision: header.revision }], severity: message.severity,
          title: render(message.title), body: render(message.body), deepLinkHref: `/companies/${ctx.companyId}/expenses/disbursement-vouchers/${header.id}`, recipientUserIds });
      }
    } catch {
      Logger.warn({ msg: 'disbursement_voucher_notice_failed', companyId: ctx.companyId, voucherId: header.id, action }, DisbursementVoucherNoticeService.name);
    }
  }

  async cancelled(ctx: RequestContext, ids: string[]) {
    for (const id of [...new Set(ids)]) {
      try {
        const facts = await this.repo.notificationFacts(ctx.companyId, id);
        if (facts?.header.status === 'CANCELLED' && facts.header.cancelledAfterPaid) await this.send(ctx, facts.header, 'cancel', facts);
      } catch {
        Logger.warn({ msg: 'disbursement_voucher_notice_failed', companyId: ctx.companyId, voucherId: id, action: 'cancel' }, DisbursementVoucherNoticeService.name);
      }
    }
  }
}
