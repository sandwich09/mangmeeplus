import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BillingRecipientSource } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingOperation, Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { AppConfigService } from '../../../common/config/app-config.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { assertAccountEmailProof, lockAccountEmail, verifiedAccountEmailProof } from '../../auth/application/account-email-state';
import type { EmailProof } from '../../auth/domain/logic/email-otp.logic';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { billingError, hashBilling } from '../domain/billing-policy';
import { BILLING_RECIPIENT_PROOF_TTL_MS } from '../domain/billing-recipient-otp.logic';
import { StripeRequestError, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';
import type { BillingService } from './billing.service';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';

/** PR E: BillingDocumentAdminService creates/dispatches its own rows of this same type (`source: 'ADMIN'`)
 *  — see pendingAdminRecipientChange() below. Exported so it tags them identically. */
export const TYPE = 'UPDATE_BILLING_EMAIL';
/** Outbox event the billing notifications drain turns into the old-recipient mail and the plan-manager push. */
export const BILLING_RECIPIENT_CHANGED = 'billing.recipient.changed';
/** Who proved the new recipient: the buyer's verified account email, a code sent to a new mailbox (R-A8),
 *  or an admin acting under a reviewed op (PR E, R-E1/R-E2 — its own preview/submit/approve, never this
 *  class's `preview`/`command`, which require account ownership this class has no way to grant an admin). */
type Target = { email: string; source: 'ACCOUNT_EMAIL' | 'CUSTOMER_OTP' | 'ADMIN'; emailProof?: EmailProof; challengeId?: string };
/** `emailProof` at the top level is the shape proposed before purchase-without-setup; it still advances. */
type Proposed = { accountId: string; customerId: string; previousEmail: string | null; target?: Target; emailProof?: EmailProof };
const targetOf = (p: Proposed): Target => p.target ?? { email: p.emailProof!.email, source: 'ACCOUNT_EMAIL', emailProof: p.emailProof };
type Journal = { startedAt?: string };
// The shop waits on this command: re-send for one hour from the first send, then only read; ten quiet minutes later nothing sent can still be in flight.
const RESEND_WINDOW_MS = 3_600_000, QUIET_MARGIN_MS = 600_000;
/** The request ended because, after that bound, the provider's customer e-mail was not this request's new address. */
const NOT_TARGET = 'provider_email_not_target';
const issueIdentity = (account: BillingAccount, id: string) => ({ companyId: account.companyId, stripeAccountId: account.stripeAccountId,
  livemode: account.livemode, kind: 'EMAIL_RECIPIENT_REVIEW', referenceId: id });
const review = () => billingError('BILLING_EMAIL_CHANGED', 'ข้อมูลผู้รับเอกสารเปลี่ยนแล้ว กรุณาโหลดข้อมูลและตรวจรายการใหม่');
const proofInvalid = (message = 'การยืนยันอีเมลนี้ใช้ไม่ได้แล้ว กรุณาขอรหัสยืนยันใหม่') => billingError('BILLING_RECIPIENT_PROOF_INVALID', message);
// The lazily backfilled Stripe email must fit the VARCHAR(320) column.
const storable = (email: string | null) => email && email.trim().length <= 320 ? email.trim().toLowerCase() : null;

/**
 * The proof that opens, submits and advances a CUSTOMER_OTP change: a USED challenge of this company
 * and user (for this email, when given), owned by no other live review or operation. The 30-minute
 * window applies only when a review is opened (`opId` absent); an operation keeps its proof until it ends.
 */
export async function assertRecipientProof(tx: Prisma.TransactionClient, proof: { challengeId: string; companyId: string; userId: string; email?: string },
  opId?: string) {
  const token = await tx.emailVerificationToken.findFirst({ where: { id: proof.challengeId, companyId: proof.companyId, userId: proof.userId,
    proofKind: 'BILLING_RECIPIENT', status: 'USED' } });
  if (!token?.usedAt || (proof.email !== undefined && token.newEmail !== proof.email)) throw proofInvalid();
  const other = await tx.billingOperation.findFirst({ where: { type: TYPE, companyId: proof.companyId,
    proposedJson: { path: ['target', 'challengeId'], equals: proof.challengeId }, ...(opId ? { id: { not: opId } } : {}),
    OR: [{ state: { notIn: ['PREVIEW', 'CANCELLED', 'FAILED'] } }, { state: 'PREVIEW', expiresAt: { gt: new Date() } }] }, select: { id: true } });
  if (other) throw proofInvalid('การยืนยันอีเมลนี้ถูกใช้แล้ว กรุณาขอรหัสยืนยันใหม่');
  if (!opId && Date.now() - token.usedAt.getTime() > BILLING_RECIPIENT_PROOF_TTL_MS) throw proofInvalid('การยืนยันอีเมลนี้หมดอายุแล้ว กรุณาขอรหัสยืนยันใหม่');
  return token;
}

/**
 * PR E (spec §18.2 R-E1, A11): an admin-initiated recipient change in flight for this account. It is
 * the same `UPDATE_BILLING_EMAIL` type as this file's own op but never occupies `activeEmailOperationId`
 * — BillingDocumentAdminService has its own lease and drain — so both directions check this explicitly:
 * this class's own preview/submit below, and that service's guards before it creates or dispatches one.
 */
export async function pendingAdminRecipientChange(tx: Prisma.TransactionClient,
  account: Pick<BillingAccount, 'companyId' | 'stripeAccountId' | 'livemode'>, excludeId?: string) {
  // A request never sent to the provider holds nothing once it has expired: it can no longer be submitted, approved or dispatched
  // (`current()` refuses it), so nothing is in flight. A dispatched one holds until it ends, whatever its age.
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "BillingOperation" WHERE "companyId"=${account.companyId}
    AND "stripeAccountId"=${account.stripeAccountId} AND livemode=${account.livemode} AND type=${TYPE}
    AND "proposedJson"->'target'->>'source'='ADMIN' AND id<>${excludeId ?? ''}
    AND (state IN ('RUNNING','UNKNOWN') OR (state IN ('PREVIEW','AWAITING_APPROVAL','QUEUED','BLOCKED')
      AND ("resultJson"->>'dispatchedAt' IS NOT NULL OR "expiresAt">${new Date()}))) LIMIT 1`;
  return rows[0] ?? null;
}

export class BillingEmailRecipient {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient,
    private readonly billing: Pick<BillingService, 'assertOwner' | 'account'>,
    private readonly config: Pick<AppConfigService, 'postmarkServerId' | 'postmarkMessageStream'>) {}

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
  /** The authority behind a target: the account proof, or the company recipient code (checked against its op when given). */
  private async assertTarget(tx: Prisma.TransactionClient, target: Target, companyId: string, userId: string, opId?: string) {
    if (target.source === 'ACCOUNT_EMAIL') { await lockAccountEmail(tx, userId); await assertAccountEmailProof(tx, userId, target.emailProof); }
    else await assertRecipientProof(tx, { challengeId: target.challengeId!, companyId, userId, email: target.email }, opId);
  }
  private view(row: BillingOperation, actorUserId = row.initiatorUserId) {
    const proposed = row.proposedJson as unknown as Proposed, journal = row.resultJson as Journal | null, target = targetOf(proposed);
    return { id: row.id, state: row.state, version: row.version, previewHash: row.requestHash, expiresAt: row.expiresAt.toISOString(),
      previousEmail: proposed.previousEmail, newEmail: target.email, source: target.source as BillingRecipientSource, errorCode: row.errorCode,
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
    // PR E: an admin-initiated change never sets activeEmailOperationId (it has its own drain), so it
    // would otherwise not show as busy here even while it holds the account.
    const adminPending = await pendingAdminRecipientChange(this.prisma.client, account);
    const email = this.customer(customer, account), legacy = storable(email);
    // Lazy backfill (§3.3) of a recipient that predates the column. Not while a purchase is in flight:
    // its apply captures the Checkout recipient with the right source.
    if (legacy && !account.recipientEmail && !account.activeAttemptId) await this.prisma.client.billingAccount.updateMany({
      where: { id: account.id, recipientEmail: null, activeAttemptId: null }, data: { recipientEmail: legacy, recipientSource: 'ACCOUNT_EMAIL' } });
    const stored = await this.billing.account(context.companyId);
    return { email, hasCustomer: true,
      operation: operation ? this.view(operation, context.userId) : null,
      busy: Boolean(operation) || Boolean(adminPending),
      stored: { email: stored?.recipientEmail ?? null, source: (stored?.recipientSource as BillingRecipientSource | null) ?? null,
        bouncedAt: stored?.recipientBouncedAt?.toISOString() ?? null, canChange: !operation && !adminPending && !stored?.activeAttemptId } };
  }
  /** `recipientProofId` absent = the original "use my verified account email" review. */
  async preview(context: RequestContext, recipientProofId?: string) {
    await this.billing.assertOwner(context);
    const account = await this.billing.account(context.companyId);
    if (!account?.customerId) throw review();
    const target: Target = recipientProofId
      ? await this.prisma.client.$transaction(async tx => {
        const token = await assertRecipientProof(tx, { challengeId: recipientProofId, companyId: context.companyId, userId: context.userId });
        return { email: token.newEmail, source: 'CUSTOMER_OTP' as const, challengeId: token.id };
      })
      : await verifiedAccountEmailProof(this.prisma.client, context.userId).then(emailProof => ({ email: emailProof.email, source: 'ACCOUNT_EMAIL' as const, emailProof }));
    if (target.email.trim().toLowerCase() === account.recipientEmail) throw billingError('BILLING_RECIPIENT_UNCHANGED', 'อีเมลนี้เป็นอีเมลรับเอกสารปัจจุบันอยู่แล้ว');
    const previousEmail = this.customer(await this.stripe.request('GET', `/customers/${account.customerId}`), account);
    const proposed: Proposed = { accountId: account.id, customerId: account.customerId, previousEmail, target };
    return this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId); await this.billing.assertOwner(context, tx);
      await this.company(context, tx);
      await this.assertTarget(tx, target, context.companyId, context.userId);
      const current = await this.billing.account(context.companyId, tx);
      if (!current || current.version !== account.version || current.activeAttemptId || current.activeCollectionOperationId || current.activeEmailOperationId ||
          await pendingAdminRecipientChange(tx, current)) throw review();
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
        await this.assertTarget(tx, targetOf(proposed), context.companyId, context.userId, row.id);
        if (!this.view(row).canSubmit || row.requestHash !== previewHash || account.version !== row.sourceVersion ||
            account.activeAttemptId || account.activeCollectionOperationId || account.activeEmailOperationId ||
            await pendingAdminRecipientChange(tx, account)) throw review();
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
    const proposed = row.proposedJson as unknown as Proposed, target = targetOf(proposed);
    let journal = (row.resultJson as Journal | null) ?? {}, notTarget = false;
    const finish = async () => this.prisma.client.$transaction(async tx => {
      await this.fence(tx, account, row.id, lease);
      const updated = await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'COMPLETED', errorCode: null, observedAt: new Date(), version: { increment: 1 } } });
      // R-A8: the column follows Stripe; a bounce of the old address no longer applies to the new one.
      await tx.billingAccount.update({ where: { id: account.id }, data: { activeEmailOperationId: null, recipientEmail: target.email.trim().toLowerCase(),
        recipientSource: target.source, recipientBouncedAt: null, recipientBounceNotifiedAt: null, version: { increment: 1 } } });
      await resolveBillingIssue(tx, issueIdentity(account, row.id), 'CUSTOMER_EMAIL_READBACK_MATCHED');
      await this.audit(tx, updated, 'completed');
      await tx.auditLog.create({ data: { companyId: account.companyId, actorUserId: row.initiatorUserId, action: 'billing.recipient.changed',
        targetType: 'BillingAccount', targetId: account.id, requestId: row.id, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { source: target.source, operationId: row.id, hadPrevious: !!proposed.previousEmail } } });
      // The old recipient hears of it by email (a prepared attempt, no address in the outbox) and every plan
      // manager on LINE/web, both through the billing notifications drain.
      let noticeAttemptId: string | undefined;
      if (proposed.previousEmail && proposed.previousEmail.trim().toLowerCase() !== target.email.trim().toLowerCase() && this.config.postmarkServerId) {
        const notice = await tx.emailSendAttempt.create({ data: { id: randomUUID(), intentKey: `billing-recipient-notice:${row.id}`, generation: 1,
          companyId: account.companyId, purpose: 'billing_status', recipient: proposed.previousEmail.trim().toLowerCase(), provider: 'postmark', providerServerId: this.config.postmarkServerId,
          stream: this.config.postmarkMessageStream, status: 'READY' } });
        noticeAttemptId = notice.id;
      }
      await tx.outboxEvent.upsert({ where: { eventKey: `billing:recipient-changed:${row.id}` }, update: {}, create: { companyId: account.companyId,
        eventType: BILLING_RECIPIENT_CHANGED, aggregateType: 'BillingAccount', aggregateId: account.id, eventKey: `billing:recipient-changed:${row.id}`,
        payloadJson: { schemaVersion: 1, data: { operationId: row.id, ...(noticeAttemptId ? { noticeAttemptId } : {}) } } } });
    });
    try {
      // Never sent and no pass will send it (a row left BLOCKED before this rule): it ends in the catch below.
      if (row.state === 'BLOCKED' && !journal.startedAt) throw review();
      if (proposed.accountId !== account.id || proposed.customerId !== account.customerId) throw review();
      const email = this.customer(await this.stripe.request('GET', `/customers/${account.customerId}`), account);
      if (journal.startedAt && email === target.email) { await finish(); return; }
      const age = journal.startedAt ? Date.now() - Date.parse(journal.startedAt) : 0;
      // The last send left within the re-send window, so after the quiet margin nothing is in flight and nothing is sent again; the read above
      // shows the provider does not hold the new address (the previous one or any other). The request ends in the catch below, review case kept.
      if (age >= RESEND_WINDOW_MS + QUIET_MARGIN_MS) { notTarget = true; throw review(); }
      if (email !== proposed.previousEmail || age >= RESEND_WINDOW_MS) throw review();
      if (!journal.startedAt) {
        journal = { startedAt: new Date().toISOString() };
        await this.prisma.client.$transaction(async tx => {
          const current = await this.fence(tx, account, row.id, lease);
          await this.billing.assertOwner({ companyId: account.companyId, userId: row.initiatorUserId } as RequestContext, tx);
          await this.company({ companyId: account.companyId } as RequestContext, tx);
          await this.assertTarget(tx, target, account.companyId, row.initiatorUserId, row.id);
          const operation = await tx.billingOperation.findUniqueOrThrow({ where: { id: row.id } });
          if (operation.version !== row.version || !['QUEUED', 'RECONCILING'].includes(operation.state) ||
              current.version !== operation.sourceVersion + 1 || operation.expiresAt <= new Date() || current.activeAttemptId || current.activeCollectionOperationId) throw review();
          await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'RUNNING', resultJson: journal, version: { increment: 1 } } });
        });
      }
      await this.stripe.request('POST', `/customers/${account.customerId}`, { email: target.email }, `mm:email-recipient:${row.id}`);
      if (this.customer(await this.stripe.request('GET', `/customers/${account.customerId}`), account) !== target.email) throw review();
      await finish();
    } catch (error) {
      await this.prisma.client.$transaction(async tx => {
        await this.fence(tx, account, row.id, lease);
        const persisted = await tx.billingOperation.findUniqueOrThrow({ where: { id: row.id } });
        const started = Boolean((persisted.resultJson as Journal | null)?.startedAt);
        const rejected = error instanceof StripeRequestError && error.outcome === 'REJECTED';
        // A provider read that failed before any send decides nothing: the request waits for the next pass while it can still be sent.
        if (!started && error instanceof StripeRequestError && !rejected && persisted.state !== 'BLOCKED' && persisted.expiresAt > new Date()) return;
        // Only an uncertain external update inside its bound keeps its reservation. A request that was never sent (no pass sends it later), one the
        // provider refused, and one the provider does not hold after the bound are over: they end here and release the shop in this transaction.
        const waiting = started && !rejected && !notTarget;
        const updated = await tx.billingOperation.update({ where: { id: row.id }, data: { state: waiting ? 'RECONCILING' : 'FAILED',
          errorCode: notTarget ? NOT_TARGET : started ? 'provider_result_unconfirmed' : 'email_authorization_changed', version: { increment: 1 } } });
        if (started && !rejected) await detectBillingIssue(tx, issueIdentity(account, row.id));
        if (!waiting) {
          if (started && rejected) await resolveBillingIssue(tx, issueIdentity(account, row.id), 'PROVIDER_REJECTED_EMAIL_UPDATE');
          await tx.billingAccount.update({ where: { id: account.id }, data: { activeEmailOperationId: null, version: { increment: 1 } } });
          await this.audit(tx, updated, notTarget ? 'not_changed' : 'failed');
        }
      });
    }
  }
}
