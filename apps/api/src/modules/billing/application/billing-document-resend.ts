import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BillingDocumentResendResult } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingInvoice } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { billingError } from '../domain/billing-policy';
import { StripeRequestError, type StripeClient } from '../infrastructure/stripe.client';
import { assertMappedCharge } from './billing-financial';
import { originalInvoice } from './billing-invoice-details';
import type { BillingService } from './billing.service';

export const RESEND_LIMIT = 3, RESEND_WINDOW_SECONDS = 86_400;
/**
 * Same value as `BILLING_NOTICE_EMAIL` in billing-notifications.service.ts, which the resend spec
 * asserts. Not imported: that module injects BillingService, and billing.service.ts builds this class,
 * so the import would close a cycle and erase BillingNotificationsService's DI metadata.
 */
export const RESEND_NOTICE_EVENT = 'billing.status.email';

/**
 * The Stripe half of R-D1, shared with the admin resend (PR E, under its own lease and limiter): send
 * the paid invoice again and, when the recipient differs, point the charge receipt at it — Stripe mails
 * a receipt only when `receipt_email` changes (A13). A StripeRequestError propagates; the caller maps it.
 */
export async function resendStripeDocuments(stripe: StripeClient, account: BillingAccount, row: BillingInvoice, recipient: string):
  Promise<{ invoiceSent: boolean; receiptUpdated: boolean }> {
  const invoice = await originalInvoice(stripe, account, row);
  const sent = await stripe.request('POST', `/invoices/${row.providerInvoiceId}/send`, {}, `mm:resend:${row.id}:${randomUUID()}`);
  let receiptUpdated = false;
  if (row.providerChargeId) {
    const charge = await stripe.request('GET', `/charges/${row.providerChargeId}`);
    assertMappedCharge(charge, account, row);
    if (charge.receipt_email !== recipient) {
      const updated = await stripe.request('POST', `/charges/${row.providerChargeId}`, { receipt_email: recipient }, `mm:resend-receipt:${row.id}:${randomUUID()}`);
      receiptUpdated = updated.receipt_email === recipient;
    }
  }
  return { invoiceSent: sent.id === invoice.id, receiptUpdated };
}

/** Customer resend (R-D1): a synchronous command under the account lease, 3 per invoice per day. */
export class BillingDocumentResend {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient,
    private readonly billing: Pick<BillingService, 'assertOwner' | 'account'>) {}

  async run(context: RequestContext, invoiceId: string, limits: RedisRateLimitService): Promise<BillingDocumentResendResult> {
    await this.billing.assertOwner(context);
    const company = await this.prisma.client.company.findUnique({ where: { id: context.companyId }, select: { status: true, planTerm: { select: { termDisabledAt: true } } } });
    if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw new ForbiddenException();
    const account = await this.billing.account(context.companyId);
    const row = account ? await this.prisma.client.billingInvoice.findFirst({ where: { id: invoiceId, billingAccountId: account.id } }) : null;
    if (!account || !row) throw new NotFoundException();
    if (row.providerStatus !== 'paid' || row.applyStatus !== 'APPLIED') throw billingError('BILLING_RESEND_UNAVAILABLE', 'ส่งซ้ำได้เฉพาะเอกสารที่ชำระและเปิดสิทธิ์แล้ว');
    if (account.activeEmailOperationId) throw billingError('BILLING_EMAIL_UPDATE_PENDING', 'กรุณาตรวจรายการเปลี่ยนผู้รับเอกสารให้เสร็จก่อน');
    const recipient = account.recipientEmail;
    if (!recipient) throw billingError('BILLING_RESEND_UNAVAILABLE', 'ยังไม่มีอีเมลรับเอกสาร กรุณาตั้งอีเมลรับเอกสารก่อน');
    if (account.recipientBouncedAt) throw billingError('BILLING_RECIPIENT_BOUNCED', 'อีเมลรับเอกสารส่งไม่ถึง กรุณาแก้อีเมลรับเอกสารก่อน');
    // A30: inspect → Stripe → consume, so an attempt that failed at Stripe is not counted.
    const budget = await limits.inspect('billing-resend', row.id, RESEND_LIMIT, RESEND_WINDOW_SECONDS);
    if (!budget.allowed) throw new HttpException({ code: 'BILLING_RESEND_LIMIT', message: 'ส่งเอกสารซ้ำได้สูงสุด 3 ครั้งต่อวันสำหรับใบนี้ กรุณาลองใหม่พรุ่งนี้',
      retryAfterSeconds: budget.retryAfterSeconds }, 429);
    const lease = randomUUID();
    const claimed = await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
      data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
    if (!claimed.count) throw billingError('BILLING_PURCHASE_PENDING', 'กำลังตรวจรายการเดิม กรุณาลองใหม่อีกครั้ง');
    let result: { invoiceSent: boolean; receiptUpdated: boolean };
    try {
      result = await resendStripeDocuments(this.stripe, account, row, recipient);
    } catch (error) {
      if (error instanceof StripeRequestError) throw billingError('BILLING_RESEND_UNAVAILABLE', 'ยังส่งเอกสารซ้ำไม่ได้ กรุณาลองใหม่ภายหลัง');
      throw error;
    } finally {
      await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null } });
    }
    const consumed = await limits.consume('billing-resend', row.id, RESEND_LIMIT, RESEND_WINDOW_SECONDS);
    await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId);
      // Our own mail with the in-app link, to the current recipient: the one path test mode can prove
      // (Stripe `/send` mails nothing there). Keyed by this command's lease, not the daily count, which
      // restarts at 1 when the window rolls over and would reuse yesterday's key.
      const eventKey = `billing:notice-email:${row.id}:resend:${lease}`;
      await tx.outboxEvent.upsert({ where: { eventKey }, update: {}, create: { companyId: context.companyId, eventType: RESEND_NOTICE_EVENT,
        aggregateType: 'BillingInvoice', aggregateId: row.id, eventKey, payloadJson: { schemaVersion: 2, data: { recipientUserId: null, resend: true } } } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'billing.document.resent', targetType: 'BillingInvoice',
        targetId: row.id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { invoiceSent: result.invoiceSent, receiptUpdated: result.receiptUpdated, attempt: consumed.count } } });
    });
    return { ...result, recipientEmail: recipient, remainingToday: Math.max(0, RESEND_LIMIT - consumed.count) };
  }
}
