import { NotFoundException } from '@nestjs/common';
import type { BillingAccount, BillingOperation, Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { assertAccountEmailProof, lockAccountEmail, verifiedAccountEmailProof } from '../../auth/application/account-email-state';
import type { EmailProof } from '../../auth/domain/logic/email-otp.logic';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { billingError, hashBilling } from '../domain/billing-policy';
import { StripeRequestError, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';
import type { BillingService } from './billing.service';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';

const TYPE = 'UPDATE_BILLING_EMAIL';
type Proposed = { accountId: string; customerId: string; previousEmail: string | null; emailProof: EmailProof };
type Journal = { startedAt?: string };
const issueIdentity = (account: BillingAccount, id: string) => ({ companyId: account.companyId, stripeAccountId: account.stripeAccountId,
  livemode: account.livemode, kind: 'EMAIL_RECIPIENT_REVIEW', referenceId: id });
const review = () => billingError('BILLING_EMAIL_CHANGED', 'ข้อมูลผู้รับเอกสารเปลี่ยนแล้ว กรุณาโหลดข้อมูลและตรวจรายการใหม่');
export class BillingEmailRecipient {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient,
    private readonly billing: Pick<BillingService, 'assertOwner' | 'account'>) {}

  private async company(context: RequestContext, tx: Prisma.TransactionClient) {
    const company = await tx.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
    if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt)))
      throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมงาน');
  }
  private customer(value: StripeObject, account: BillingAccount) {
    if (value.id !== account.customerId || value.object !== 'customer' || value.deleted || value.livemode !== account.livemode ||
        value.metadata?.billingAccountId !== account.id) throw review();
    return typeof value.email === 'string' ? value.email : null;
  }
  private view(row: BillingOperation, actorUserId = row.initiatorUserId) {
    const proposed = row.proposedJson as unknown as Proposed, journal = row.resultJson as Journal | null;
    return { id: row.id, state: row.state, version: row.version, previewHash: row.requestHash, expiresAt: row.expiresAt.toISOString(),
      previousEmail: proposed.previousEmail, newEmail: proposed.emailProof.email,
      canSubmit: actorUserId === row.initiatorUserId && row.state === 'PREVIEW' && row.expiresAt > new Date(),
      canCancel: !journal?.startedAt && ['PREVIEW', 'QUEUED', 'BLOCKED'].includes(row.state) };
  }
  private async row(context: RequestContext, id: string, tx: Prisma.TransactionClient = this.prisma.client) {
    await this.billing.assertOwner(context, tx);
    const row = await tx.billingOperation.findFirst({ where: { id, companyId: context.companyId, stripeAccountId: this.stripe.accountId,
      livemode: this.stripe.livemode, type: TYPE } });
    if (!row) throw new NotFoundException(); return row;
  }
  async get(context: RequestContext, id: string) { return this.view(await this.row(context, id), context.userId); }
  async current(context: RequestContext) {
    await this.billing.assertOwner(context);
    const account = await this.billing.account(context.companyId);
    if (!account?.customerId) return { email: null, hasCustomer: false, operation: null };
    const customer = await this.stripe.request('GET', `/customers/${account.customerId}`);
    const operation = account.activeEmailOperationId ? await this.prisma.client.billingOperation.findUnique({ where: { id: account.activeEmailOperationId } }) : null;
    return { email: this.customer(customer, account), hasCustomer: true,
      operation: operation ? this.view(operation, context.userId) : null,
      busy: Boolean(operation) };
  }
  async preview(context: RequestContext) {
    await this.billing.assertOwner(context);
    const emailProof = await verifiedAccountEmailProof(this.prisma.client, context.userId);
    const account = await this.billing.account(context.companyId);
    if (!account?.customerId) throw review();
    const previousEmail = this.customer(await this.stripe.request('GET', `/customers/${account.customerId}`), account);
    const proposed: Proposed = { accountId: account.id, customerId: account.customerId, previousEmail, emailProof };
    return this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId); await this.billing.assertOwner(context, tx);
      await this.company(context, tx);
      await lockAccountEmail(tx, context.userId); await assertAccountEmailProof(tx, context.userId, emailProof);
      const current = await this.billing.account(context.companyId, tx);
      if (!current || current.version !== account.version || current.activeAttemptId || current.activeCollectionOperationId || current.activeEmailOperationId) throw review();
      const row = await tx.billingOperation.create({ data: { type: TYPE, companyId: context.companyId, stripeAccountId: account.stripeAccountId,
        livemode: account.livemode, initiatorUserId: context.userId, sourceVersion: account.version,
        requestHash: hashBilling([account.id, account.version, proposed]), proposedJson: proposed as unknown as Prisma.InputJsonValue,
        reason: 'เปลี่ยนผู้รับเอกสารในอนาคตของบริษัทที่เลือก', expiresAt: new Date(Date.now() + 600_000) } });
      return this.view(row);
    });
  }
  async command(context: RequestContext, id: string, action: 'submit' | 'cancel', version: number, previewHash: string, key: string) {
    if (action === 'submit' && !/^[a-zA-Z0-9_-]{16,120}$/.test(key)) throw review();
    return this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId);
      const row = await this.row(context, id, tx), proposed = row.proposedJson as unknown as Proposed;
      const account = await this.billing.account(context.companyId, tx);
      if (!account || account.id !== proposed.accountId || account.customerId !== proposed.customerId) throw review();
      if (action === 'submit' && row.initiatorUserId !== context.userId) throw review();
      if (action === 'submit' && row.idempotencyKey === key && row.requestHash === previewHash) return this.view(row);
      if (row.version !== version) throw review();
      if (action === 'cancel') {
        if (!this.view(row).canCancel) throw review();
        await tx.billingAccount.updateMany({ where: { id: account.id, activeEmailOperationId: row.id }, data: { activeEmailOperationId: null, version: { increment: 1 } } });
      } else {
        await this.company(context, tx);
        await lockAccountEmail(tx, context.userId); await assertAccountEmailProof(tx, context.userId, proposed.emailProof);
        if (!this.view(row).canSubmit || row.requestHash !== previewHash || account.version !== row.sourceVersion ||
            account.activeAttemptId || account.activeCollectionOperationId || account.activeEmailOperationId) throw review();
        await tx.billingAccount.update({ where: { id: account.id }, data: { activeEmailOperationId: row.id, version: { increment: 1 }, nextReconcileAt: new Date() } });
      }
      const updated = await tx.billingOperation.update({ where: { id }, data: {
        state: action === 'submit' ? 'QUEUED' : 'CANCELLED', ...(action === 'submit' ? { idempotencyKey: key } : {}), version: { increment: 1 },
      } });
      await this.audit(tx, { ...updated, initiatorUserId: context.userId }, action);
      return this.view(updated, context.userId);
    }).catch(error => {
      if ((error as { code?: string }).code === 'P2002') throw review();
      throw error;
    });
  }
  private async fence(tx: Prisma.TransactionClient, account: BillingAccount, id: string, lease: string) {
    await lockPlanTermCompany(tx, account.companyId);
    const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (current.activeEmailOperationId !== id || current.leaseToken !== lease || !current.leaseUntil || current.leaseUntil <= new Date()) throw new Error('billing.email_recipient_lost_lease');
    return current;
  }
  private audit(tx: Prisma.TransactionClient, row: BillingOperation, action: string) {
    return tx.auditLog.create({ data: { companyId: row.companyId!, actorUserId: row.initiatorUserId, action: `billing.email_recipient.${action}`,
      targetType: 'BillingOperation', targetId: row.id, requestId: row.id, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { sourceVersion: row.sourceVersion, previewHash: row.requestHash } } });
  }
  async advance(account: BillingAccount, lease: string) {
    const row = await this.prisma.client.billingOperation.findFirstOrThrow({ where: { id: account.activeEmailOperationId!, type: TYPE,
      companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode } });
    const proposed = row.proposedJson as unknown as Proposed;
    let journal = (row.resultJson as Journal | null) ?? {};
    if (row.state === 'BLOCKED' && !journal.startedAt) return;
    const finish = async () => this.prisma.client.$transaction(async tx => {
      await this.fence(tx, account, row.id, lease);
      const updated = await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'COMPLETED', errorCode: null, observedAt: new Date(), version: { increment: 1 } } });
      await tx.billingAccount.update({ where: { id: account.id }, data: { activeEmailOperationId: null, version: { increment: 1 } } });
      await resolveBillingIssue(tx, issueIdentity(account, row.id), 'CUSTOMER_EMAIL_READBACK_MATCHED');
      await this.audit(tx, updated, 'completed');
    });
    try {
      if (proposed.accountId !== account.id || proposed.customerId !== account.customerId) throw review();
      const email = this.customer(await this.stripe.request('GET', `/customers/${account.customerId}`), account);
      if (journal.startedAt && email === proposed.emailProof.email) { await finish(); return; }
      if (email !== proposed.previousEmail || (journal.startedAt && Date.now() - Date.parse(journal.startedAt) >= 23 * 3_600_000)) throw review();
      if (!journal.startedAt) {
        journal = { startedAt: new Date().toISOString() };
        await this.prisma.client.$transaction(async tx => {
          const current = await this.fence(tx, account, row.id, lease);
          await this.billing.assertOwner({ companyId: account.companyId, userId: row.initiatorUserId } as RequestContext, tx);
          await this.company({ companyId: account.companyId } as RequestContext, tx);
          await lockAccountEmail(tx, row.initiatorUserId); await assertAccountEmailProof(tx, row.initiatorUserId, proposed.emailProof);
          const operation = await tx.billingOperation.findUniqueOrThrow({ where: { id: row.id } });
          if (operation.version !== row.version || !['QUEUED', 'RECONCILING'].includes(operation.state) ||
              current.version !== operation.sourceVersion + 1 || operation.expiresAt <= new Date() || current.activeAttemptId || current.activeCollectionOperationId) throw review();
          await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'RUNNING', resultJson: journal, version: { increment: 1 } } });
        });
      }
      await this.stripe.request('POST', `/customers/${account.customerId}`, { email: proposed.emailProof.email }, `mm:email-recipient:${row.id}`);
      if (this.customer(await this.stripe.request('GET', `/customers/${account.customerId}`), account) !== proposed.emailProof.email) throw review();
      await finish();
    } catch (error) {
      await this.prisma.client.$transaction(async tx => {
        await this.fence(tx, account, row.id, lease);
        const persisted = await tx.billingOperation.findUniqueOrThrow({ where: { id: row.id } });
        const started = Boolean((persisted.resultJson as Journal | null)?.startedAt);
        const rejected = error instanceof StripeRequestError && error.outcome === 'REJECTED';
        await tx.billingOperation.update({ where: { id: row.id }, data: { state: started && !rejected ? 'RECONCILING' : 'BLOCKED',
          errorCode: started ? 'provider_result_unconfirmed' : 'email_authorization_changed', version: { increment: 1 } } });
        if (started && !rejected) await detectBillingIssue(tx, issueIdentity(account, row.id));
        // A rejected preflight can be cancelled; an uncertain external update keeps its reservation.
        if (rejected && started) {
          await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'FAILED' } });
          await resolveBillingIssue(tx, issueIdentity(account, row.id), 'PROVIDER_REJECTED_EMAIL_UPDATE');
          await tx.billingAccount.update({ where: { id: account.id }, data: { activeEmailOperationId: null, version: { increment: 1 } } });
        }
      });
    }
  }
}
