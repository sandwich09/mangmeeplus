import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { companyBillingProfile } from '@watchdog-bms/contracts';
import type { BillingDocumentResendResult, BillingRecipientAdminInput, BillingRecipientAdminOperation, BillingRecipientAdminReview } from '@watchdog-bms/contracts';
import { stripeCustomerSyncPayload, stripeCustomerSynced } from './billing-company-profile';
import type { BillingAccount, BillingOperation, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { billingApprovalMode, canApproveBillingChange } from './billing-approval';
import { billingError, configurationHash } from '../domain/billing-policy';
import { StripeRequestError, type StripeObject } from '../infrastructure/stripe.client';
import { BillingService } from './billing.service';
import { BillingAdminService } from './billing-admin.service';
import { BillingConfigurationService } from './billing-configuration.service';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';
import { BILLING_RECIPIENT_CHANGED, TYPE as RECIPIENT_TYPE, pendingAdminRecipientChange } from './billing-email-recipient';
import { RESEND_NOTICE_EVENT, resendStripeDocuments } from './billing-document-resend';

/**
 * PR E admin tools (spec §18.2 R-E1/R-E2/R-E3/R-E4; DQ7/DQ10). Two things live here, both under
 * `system.billing.override.manage`:
 *
 * 1. An admin recipient change: the SAME `UPDATE_BILLING_EMAIL` operation the customer OTP flow
 *    creates (`billing-email-recipient.ts`), tagged `target.source: 'ADMIN'`, but reviewed and
 *    dispatched independently (own state machine below, cloned from `BillingRefundsService`) because
 *    that class's `preview`/`command`/`advance` assume the actor is a company owner with an account
 *    proof, which an admin is not. It never occupies `activeEmailOperationId` — see
 *    `pendingAdminRecipientChange` for how both directions stay mutually exclusive — and its success
 *    write reuses the customer flow's `billing.recipient.changed` audit shape and the
 *    `billing:recipient-changed:<opId>` outbox, so `BillingNotificationsService` drains either
 *    flow's row identically (extended there to recognise `source: 'ADMIN'`).
 * 2. Document resend (R-D1 for admins): synchronous, under its own lease and a 10/day limiter
 *    (`billing-resend-admin:<invoiceId>`, DQ10), calling PR C's `resendStripeDocuments`.
 * 3. `CUSTOMER_PROFILE_SYNC` (R-E3): a journaled, no-approval op enqueued by identity/profile writers
 *    in their own transaction and drained here.
 */
const MANAGE = 'system.billing.override.manage';
const READ = 'system.billing.financial.read';
const SYNC_TYPE = 'CUSTOMER_PROFILE_SYNC';
const RESEND_LIMIT_ADMIN = 10, RESEND_WINDOW_SECONDS = 86_400;

type Proposed = { accountId: string; customerId: string; companyId: string; stripeAccountId: string; livemode: boolean; invoiceId: string; invoiceNumber: string | null;
  membershipId: string; actorCompanyId: string; previousEmail: string | null; target: { email: string; source: 'ADMIN' };
  localHash: string; supportRequestId?: string };
type Journal = { submittedCredentialVersion?: string; approval?: { membershipId: string; companyId: string; credentialVersion: string; approvedAt: string };
  dispatchedAt?: string; providerKey?: string; notifiedAt?: string };
type SyncProposed = { accountId: string; customerId: string };

const stale = () => billingError('CONTROL_PREVIEW_STALE', 'รายการเปลี่ยนหรือหมดอายุ กรุณาโหลดข้อมูลล่าสุดแล้วตรวจใหม่');
const busyError = () => billingError('BILLING_RECIPIENT_BUSY', 'บริษัทมีรายการซื้อ คำสั่งต่ออายุ หรือคำขอเปลี่ยนผู้รับของลูกค้าค้างอยู่ รอให้เสร็จก่อน');
const json = (value: unknown) => value as Prisma.InputJsonValue;
const localHash = (a: BillingAccount, previousEmail: string | null) => configurationHash([a.id, a.companyId, a.stripeAccountId, a.livemode,
  a.customerId, a.version, a.activeAttemptId, a.activeCollectionOperationId, a.activeEmailOperationId, a.recipientEmail, a.recipientSource, previousEmail]);
const issueIdentity = (account: Pick<BillingAccount, 'companyId' | 'stripeAccountId' | 'livemode'>, id: string) =>
  ({ companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode, kind: 'CONTROL_OPERATION_REVIEW' as const, referenceId: id });
const busy = (account: Pick<BillingAccount, 'activeAttemptId' | 'activeCollectionOperationId' | 'activeEmailOperationId'>) =>
  Boolean(account.activeAttemptId || account.activeCollectionOperationId || account.activeEmailOperationId);

@Injectable()
export class BillingDocumentAdminService {
  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService, private readonly admin: BillingAdminService,
    private readonly configuration: BillingConfigurationService,
    // A `Pick<>` annotation emits no runtime type (erases to Object), so Nest has nothing to resolve
    // without this — same reason RedisRateLimitService names the token explicitly.
    @Inject(AppConfigService) private readonly appConfig: Pick<AppConfigService, 'postmarkServerId' | 'postmarkMessageStream'>) {}

  private async access(context: RequestContext, companyId: string, key = READ, tx: Prisma.TransactionClient = this.prisma.client) {
    const scoped = await this.admin.scopedCompany(context, companyId, tx);
    await this.admin.access(context, READ, tx); await this.admin.access(context, key, tx);
    if (!scoped.account) throw new NotFoundException();
    return scoped as typeof scoped & { account: BillingAccount };
  }
  private async invoice(account: BillingAccount, id: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const row = await tx.billingInvoice.findFirst({ where: { id, billingAccountId: account.id } });
    if (!row) throw new NotFoundException(); return row;
  }
  /** Same binding check as the customer flow's `customer()` private (billing-email-recipient.ts). */
  private customerBinding(value: StripeObject, account: BillingAccount) {
    if (value.id !== account.customerId || value.object !== 'customer' || value.deleted || value.livemode !== account.livemode ||
      value.metadata?.billingAccountId !== account.id) throw stale();
    return typeof value.email === 'string' ? value.email : null;
  }
  private async row(context: RequestContext, id: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const row = await tx.billingOperation.findFirst({ where: { id, type: RECIPIENT_TYPE, stripeAccountId: this.billing.stripe.accountId,
      livemode: this.billing.stripe.livemode, proposedJson: { path: ['target', 'source'], equals: 'ADMIN' } } });
    if (!row?.companyId) throw new NotFoundException(); await this.access(context, row.companyId, READ, tx); return row;
  }

  // ── Recipient change (reviewed op) ──────────────────────────────────────────────────────────

  async review(context: RequestContext, companyId: string, invoiceId: string): Promise<BillingRecipientAdminReview> {
    const { account, company } = await this.access(context, companyId, READ);
    const row = await this.invoice(account, invoiceId);
    let currentEmail: string | null = null;
    if (account.customerId) currentEmail = this.customerBinding(await this.billing.stripe.request('GET', `/customers/${account.customerId}`), account);
    const blocked = !account.customerId ? 'BILLING_RECIPIENT_NO_CUSTOMER'
      : busy(account) || await pendingAdminRecipientChange(this.prisma.client, account) ? 'BILLING_RECIPIENT_BUSY' : null;
    return { companyId, companyName: company.name, invoiceId, invoiceNumber: row.providerNumber, mode: account.livemode ? 'LIVE' : 'TEST',
      currentEmail, currentSource: account.recipientSource as BillingRecipientAdminReview['currentSource'], bouncedAt: account.recipientBouncedAt?.toISOString() ?? null,
      canChange: blocked === null, blockedReason: blocked, sourceHash: configurationHash([localHash(account, currentEmail)]), observedAt: new Date().toISOString() };
  }

  async preview(context: RequestContext, companyId: string, invoiceId: string, input: BillingRecipientAdminInput): Promise<BillingRecipientAdminOperation> {
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500 || typeof input.sourceHash !== 'string') throw new BadRequestException();
    const newEmail = (input.newEmail ?? '').trim().toLowerCase();
    if (!newEmail || newEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) throw billingError('BILLING_RECIPIENT_INVALID', 'รูปแบบอีเมลไม่ถูกต้อง');
    const { account, company } = await this.access(context, companyId, MANAGE);
    if (!account.customerId) throw billingError('BILLING_RECIPIENT_NO_CUSTOMER', 'บริษัทนี้ยังไม่มีบัญชีลูกค้าใน Stripe จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน');
    const invoiceRow = await this.invoice(account, invoiceId);
    const previousEmail = this.customerBinding(await this.billing.stripe.request('GET', `/customers/${account.customerId}`), account);
    if (newEmail === (previousEmail?.trim().toLowerCase() ?? '')) throw billingError('BILLING_RECIPIENT_UNCHANGED', 'อีเมลนี้เป็นอีเมลผู้รับเอกสารปัจจุบันอยู่แล้ว');
    const hash = localHash(account, previousEmail);
    if (configurationHash([hash]) !== input.sourceHash) throw stale();
    const supportRequestId = input.supportRequestId?.trim() || undefined;
    const id = randomUUID();
    const p: Proposed = { accountId: account.id, customerId: account.customerId, companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
      invoiceId, invoiceNumber: invoiceRow.providerNumber,
      membershipId: context.membershipId, actorCompanyId: context.companyId, previousEmail, target: { email: newEmail, source: 'ADMIN' }, localHash: hash,
      ...(supportRequestId ? { supportRequestId } : {}) };
    const row = await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, companyId);
      const { account: current } = await this.access(context, companyId, MANAGE, tx);
      if (localHash(current, previousEmail) !== hash) throw stale();
      if (busy(current) || await pendingAdminRecipientChange(tx, current)) throw busyError();
      return tx.billingOperation.create({ data: { id, type: RECIPIENT_TYPE, companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
        referenceId: invoiceId, initiatorUserId: context.userId, sourceVersion: account.version, proposedJson: json(p), reason: input.reason.trim(),
        requestHash: configurationHash([id, invoiceId, p, input.reason.trim()]), expiresAt: new Date(Date.now() + 600_000) } });
    });
    void company; // company already resolved above; view() re-derives it (keeps one read path)
    return this.view(context, row);
  }

  private async view(context: RequestContext, row: BillingOperation): Promise<BillingRecipientAdminOperation> {
    const { company, access } = await this.access(context, row.companyId!, READ);
    const p = row.proposedJson as unknown as Proposed, j = (row.resultJson ?? {}) as Journal;
    const own = row.initiatorUserId === context.userId, fresh = row.expiresAt > new Date();
    const manage = access.capabilities.includes(MANAGE), approve = access.capabilities.includes('system.billing.approval.approve');
    const issue = await this.prisma.client.billingIssue.findFirst({ where: { companyId: row.companyId, stripeAccountId: row.stripeAccountId, livemode: row.livemode,
      kind: 'CONTROL_OPERATION_REVIEW', referenceId: row.id } });
    return { id: row.id, type: 'UPDATE_BILLING_EMAIL', state: row.state as BillingRecipientAdminOperation['state'],
      scope: { kind: 'COMPANY', companyId: row.companyId!, mode: row.livemode ? 'LIVE' : 'TEST' }, version: row.version, reason: row.reason,
      initiatorUserId: row.initiatorUserId, approverUserId: row.approverUserId, approvalMode: billingApprovalMode(row), errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(), observedAt: row.observedAt?.toISOString() ?? null, expiresAt: row.expiresAt.toISOString(),
      referenceId: row.referenceId, sourceVersion: row.sourceVersion, previewHash: row.requestHash, companyName: company.name,
      invoiceNumber: p.invoiceNumber, previousEmail: p.previousEmail, newEmail: p.target.email, supportRequestId: p.supportRequestId ?? null,
      allowedActions: [...(own && manage && fresh && row.state === 'PREVIEW' ? ['submit' as const] : []),
        ...(canApproveBillingChange(access, row.initiatorUserId, context.userId, MANAGE) && fresh && row.state === 'AWAITING_APPROVAL' ? ['approve' as const] : []),
        ...(!j.dispatchedAt && ['PREVIEW', 'AWAITING_APPROVAL', 'QUEUED', 'BLOCKED'].includes(row.state) && (manage || approve) && (!row.leaseUntil || row.leaseUntil <= new Date()) ? ['cancel' as const] : []),
        // A request that ended without a change is over: nothing will be sent for it again, so staff start a new one.
        ...((manage || approve) && ['QUEUED', 'RUNNING', 'UNKNOWN', 'BLOCKED', 'FAILED'].includes(row.state) && row.errorCode !== 'CONTROL_RECIPIENT_NOT_CHANGED' && (!row.leaseUntil || row.leaseUntil <= new Date()) ? ['run' as const] : [])],
      dispatchedAt: j.dispatchedAt ?? null, reviewCaseId: issue?.id ?? null, notifiedAt: j.notifiedAt ?? null };
  }
  async get(context: RequestContext, id: string) { return this.view(context, await this.row(context, id)); }
  async list(context: RequestContext, companyId: string, invoiceId: string, cursor?: string) {
    const { account } = await this.access(context, companyId, READ); await this.invoice(account, invoiceId);
    // The recipient belongs to the account, not the invoice — every admin request for this account shows here.
    const anchor = cursor ? await this.row(context, cursor) : null;
    if (anchor && anchor.companyId !== companyId) throw new NotFoundException();
    const rows = await this.prisma.client.billingOperation.findMany({ where: { companyId, type: RECIPIENT_TYPE, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
      proposedJson: { path: ['target', 'source'], equals: 'ADMIN' }, ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26 });
    return { items: await Promise.all(rows.slice(0, 25).map(r => this.view(context, r))), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }

  private audit(tx: Prisma.TransactionClient, row: BillingOperation, action: string, actor?: string) {
    return tx.auditLog.create({ data: { companyId: row.companyId, actorUserId: actor ?? null, ...(!actor ? { actorType: 'SERVICE', actorRefId: 'billing-recipient-admin-worker' } : {}),
      action: `billing.recipient_admin.${action}`, targetType: 'BillingOperation', targetId: row.id, requestId: row.id, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { sourceHash: row.requestHash, invoiceId: row.referenceId, state: row.state, version: row.version, approvalMode: billingApprovalMode(row),
        initiatorUserId: row.initiatorUserId, approverUserId: row.approverUserId } } });
  }
  private async credential(tx: Prisma.TransactionClient, userId: string) {
    if (tx !== this.prisma.client) await tx.$queryRaw`SELECT id FROM "UserCredential" WHERE "userId"=${userId} FOR SHARE`;
    const row = await tx.userCredential.findUnique({ where: { userId } });
    if (!row || row.status !== 'ACTIVE' || row.mustChangePassword || (row.expiresAt && row.expiresAt <= new Date())) throw new ForbiddenException();
    return row.updatedAt.toISOString();
  }
  private async actors(row: BillingOperation, tx: Prisma.TransactionClient, needApproval = true) {
    const p = row.proposedJson as unknown as Proposed, j = (row.resultJson ?? {}) as Journal;
    await this.configuration.operationActor(row, row.initiatorUserId, p.membershipId, p.actorCompanyId, MANAGE, tx, row.companyId!);
    if (await this.credential(tx, row.initiatorUserId) !== j.submittedCredentialVersion) throw new ForbiddenException();
    if (needApproval) {
      const a = j.approval; if (!a || !row.approverUserId) throw new ForbiddenException();
      const approver = await this.configuration.operationActor(row, row.approverUserId, a.membershipId, a.companyId, 'system.billing.approval.approve', tx, row.companyId!);
      await this.configuration.requireApprovalActor(row, approver, MANAGE, tx);
      if (await this.credential(tx, row.approverUserId) !== a.credentialVersion) throw new ForbiddenException();
    }
  }
  private async current(row: BillingOperation, tx: Prisma.TransactionClient) {
    if (row.expiresAt <= new Date()) throw stale();
    const p = row.proposedJson as unknown as Proposed, account = await this.billing.account(row.companyId!, tx);
    if (!account || account.id !== p.accountId || account.customerId !== p.customerId || localHash(account, p.previousEmail) !== p.localHash) throw stale();
    if (busy(account) || await pendingAdminRecipientChange(tx, account, row.id)) throw busyError();
    return account;
  }
  async command(context: RequestContext, id: string, action: 'submit' | 'approve' | 'cancel', version: number, hash: string, key?: string) {
    const original = await this.row(context, id);
    if (action === 'submit' && (!key || !/^[a-zA-Z0-9_-]{16,120}$/.test(key))) throw new BadRequestException();
    const row = await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, original.companyId!);
      const current = await this.row(context, id, tx), p = current.proposedJson as unknown as Proposed, j = (current.resultJson ?? {}) as Journal;
      const scope = await this.access(context, current.companyId!, READ, tx);
      const permission = action === 'approve' ? 'system.billing.approval.approve' : MANAGE;
      if (!scope.access.capabilities.includes(permission) && !(action === 'cancel' && scope.access.capabilities.includes('system.billing.approval.approve'))) throw new ForbiddenException();
      await this.configuration.requireProof(context, tx);
      if (action === 'submit') {
        const replay = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: { stripeAccountId: current.stripeAccountId, livemode: current.livemode, idempotencyKey: key! } } });
        if (replay && (replay.id !== current.id || replay.initiatorUserId !== context.userId || replay.requestHash !== hash))
          throw billingError('CONTROL_IDEMPOTENCY_CONFLICT', 'ข้อมูลคำขอต่างจากรายการเดิม กรุณาเปิดคำขอเดิมหรือตรวจใหม่');
      }
      if (action === 'submit' && current.idempotencyKey === key && current.initiatorUserId === context.userId && current.requestHash === hash && current.state !== 'PREVIEW') return current;
      if (action === 'approve' && current.approverUserId === context.userId && current.requestHash === hash && j.approval) return current;
      if (action === 'cancel' && current.state === 'CANCELLED' && current.requestHash === hash) return current;
      if (current.version !== version || current.requestHash !== hash) throw stale();
      if (current.leaseUntil && current.leaseUntil > new Date()) throw stale();
      if (action === 'cancel') {
        if (j.dispatchedAt || !['PREVIEW', 'AWAITING_APPROVAL', 'QUEUED', 'BLOCKED'].includes(current.state)) throw stale();
      } else {
        if (current.expiresAt <= new Date()) throw stale(); await this.current(current, tx);
        if (action === 'submit') {
          if (current.initiatorUserId !== context.userId || current.state !== 'PREVIEW') throw new ForbiddenException();
          j.submittedCredentialVersion = await this.credential(tx, context.userId);
        } else {
          if (current.state !== 'AWAITING_APPROVAL') throw new ForbiddenException();
          await this.configuration.requireApprovalActor(current, context, MANAGE, tx);
          await this.actors(current, tx, false);
          j.approval = { membershipId: context.membershipId, companyId: context.companyId, credentialVersion: await this.credential(tx, context.userId), approvedAt: new Date().toISOString() };
        }
      }
      const updated = await tx.billingOperation.update({ where: { id }, data: { state: action === 'submit' ? 'AWAITING_APPROVAL' : action === 'approve' ? 'QUEUED' : 'CANCELLED',
        ...(action === 'submit' ? { idempotencyKey: key } : {}), ...(action === 'approve' ? { approverUserId: context.userId } : {}), resultJson: json(j), version: { increment: 1 } } });
      if (action === 'cancel') await resolveBillingIssue(tx, issueIdentity(p, updated.id), 'UNDISPATCHED_RECIPIENT_ADMIN_CANCELLED');
      await this.audit(tx, updated, action, context.userId);
      return updated;
    });
    return this.view(context, row);
  }
  async run(context: RequestContext, id: string, version: number) {
    const row = await this.row(context, id), view = await this.view(context, row);
    const { access } = await this.access(context, row.companyId!, READ);
    if (!access.capabilities.some(key => key === MANAGE || key === 'system.billing.approval.approve')) throw new ForbiddenException();
    if (row.version !== version || !view.allowedActions.includes('run')) throw stale();
    await this.configuration.requireProof(context, this.prisma.client);
    await this.executeRecipient(row);
    return this.get(context, id);
  }

  private async fence(tx: Prisma.TransactionClient, id: string, lease: string) {
    const row = await tx.billingOperation.findUniqueOrThrow({ where: { id } }); await lockPlanTermCompany(tx, row.companyId!);
    await tx.$queryRaw`SELECT id FROM "BillingAccount" WHERE id=${(row.proposedJson as unknown as Proposed).accountId} FOR UPDATE`;
    const account = await this.billing.account(row.companyId!, tx);
    if (row.type !== RECIPIENT_TYPE || row.stripeAccountId !== this.billing.stripe.accountId || row.livemode !== this.billing.stripe.livemode || row.state !== 'RUNNING' ||
      row.leaseToken !== lease || !row.leaseUntil || row.leaseUntil <= new Date() || !account || account.id !== (row.proposedJson as unknown as Proposed).accountId ||
      account.leaseToken !== lease || !account.leaseUntil || account.leaseUntil <= new Date()) throw stale();
    return { row, account };
  }
  private async writeLeased(tx: Prisma.TransactionClient, row: BillingOperation, lease: string, data: Prisma.BillingOperationUpdateManyMutationInput) {
    const changed = await tx.billingOperation.updateMany({ where: { id: row.id, version: row.version, state: 'RUNNING', leaseToken: lease, leaseUntil: { gt: new Date() } }, data });
    if (!changed.count) throw stale(); return tx.billingOperation.findUniqueOrThrow({ where: { id: row.id } });
  }
  private async executeRecipient(candidate: BillingOperation) {
    const lease = randomUUID();
    const claim = await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, candidate.companyId!);
      const current = await tx.billingOperation.findUniqueOrThrow({ where: { id: candidate.id } }), account = await this.billing.account(candidate.companyId!, tx), now = new Date();
      if (current.companyId !== candidate.companyId || current.stripeAccountId !== candidate.stripeAccountId || current.livemode !== candidate.livemode || current.type !== RECIPIENT_TYPE ||
        current.version !== candidate.version || !['QUEUED', 'RUNNING', 'UNKNOWN', 'BLOCKED', 'FAILED'].includes(current.state) || !account || account.id !== (current.proposedJson as unknown as Proposed).accountId ||
        (current.leaseUntil && current.leaseUntil > now) || (account.leaseUntil && account.leaseUntil > now)) return null;
      const got = await tx.billingAccount.updateMany({ where: { id: account.id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { leaseToken: lease, leaseUntil: new Date(now.getTime() + 120_000) } });
      if (!got.count) return null;
      return tx.billingOperation.update({ where: { id: current.id }, data: { state: 'RUNNING', leaseToken: lease, leaseUntil: new Date(now.getTime() + 120_000), version: { increment: 1 } } });
    });
    if (!claim) return;
    const p = claim.proposedJson as unknown as Proposed;
    try {
      const account = await this.billing.account(claim.companyId!);
      if (!account || account.id !== p.accountId || account.customerId !== p.customerId) throw stale();
      let journal = (claim.resultJson ?? {}) as Journal;
      const email = this.customerBinding(await this.billing.stripe.request('GET', `/customers/${account.customerId}`), account);
      if (journal.dispatchedAt && email === p.target.email) { await this.finishRecipient(account, claim, p, journal, lease); return; }
      // Not changed: `current` refuses every send once expiresAt has passed, so the last send of this request left at or before expiresAt (plus the
      // 120 s lease at most). An hour later nothing is in flight and nothing will be sent again, and the read above shows the provider does not hold
      // the target address. So the request ends without a change, in the catch below. (Same rule as billing-refunds.service.ts's
      // CONTROL_REFUND_NOT_CREATED; always earlier than the former 23-hour CONTROL_RECIPIENT_AGED_UNKNOWN.)
      if (journal.dispatchedAt && Date.now() - claim.expiresAt.getTime() >= 3_600_000) throw billingError('CONTROL_RECIPIENT_NOT_CHANGED', 'ตรวจกับผู้ให้บริการรับชำระเงินแล้ว อีเมลผู้รับเอกสารตอนนี้ไม่ใช่อีเมลใหม่ตามคำขอนี้ ถ้ายังต้องการเปลี่ยน ให้สร้างคำขอใหม่');
      if (email !== p.previousEmail) throw stale();
      // Only a readback equal to the target finishes the request. A dispatched send that never applied is sent again here, same key, while the request is still valid.
      journal = await this.prisma.client.$transaction(async tx => {
        const { row } = await this.fence(tx, claim.id, lease);
        await this.actors(row, tx); await this.current(row, tx);
        const j = (row.resultJson ?? {}) as Journal, providerKey = `billing-recipient-admin-${row.id}`;
        const updated: Journal = { ...j, dispatchedAt: j.dispatchedAt ?? new Date().toISOString(), providerKey };
        const saved = await this.writeLeased(tx, row, lease, { resultJson: json(updated) });
        await this.audit(tx, saved, j.dispatchedAt ? 'redispatch' : 'dispatch'); return updated;
      });
      await this.billing.stripe.request('POST', `/customers/${account.customerId}`, { email: p.target.email }, journal.providerKey);
      if (this.customerBinding(await this.billing.stripe.request('GET', `/customers/${account.customerId}`), account) !== p.target.email) throw stale();
      await this.finishRecipient(account, claim, p, journal, lease);
    } catch (error) {
      await this.prisma.client.$transaction(async tx => {
        const { row } = await this.fence(tx, claim.id, lease);
        const j = (row.resultJson ?? {}) as Journal;
        const rejected = error instanceof StripeRequestError && error.outcome === 'REJECTED';
        // Two ways a dispatched request ends with no change: the provider refused the update, or (the check in the try) it never applied one. The second keeps its review case.
        const notChanged = (error as { getResponse?: () => { code?: string } }).getResponse?.()?.code === 'CONTROL_RECIPIENT_NOT_CHANGED';
        const code = error instanceof ForbiddenException ? 'CONTROL_PERMISSION_CHANGED' : rejected ? 'CONTROL_RECIPIENT_PROVIDER_REJECTED'
          : notChanged ? 'CONTROL_RECIPIENT_NOT_CHANGED' : j.dispatchedAt ? 'CONTROL_RECIPIENT_REVIEW' : 'CONTROL_PREVIEW_STALE';
        const saved = await this.writeLeased(tx, row, lease, { state: rejected || notChanged ? 'FAILED' : j.dispatchedAt ? 'UNKNOWN' : 'BLOCKED', errorCode: code,
          scheduledFor: new Date(Date.now() + 300_000), leaseToken: null, leaseUntil: null, version: { increment: 1 } });
        await detectBillingIssue(tx, issueIdentity(p, row.id)); await this.audit(tx, saved, notChanged ? 'not_changed' : 'review');
        if (rejected) await resolveBillingIssue(tx, issueIdentity(p, row.id), 'PROVIDER_REJECTED_EMAIL_UPDATE');
      });
    } finally {
      await this.prisma.client.billingAccount.updateMany({ where: { id: p.accountId, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null, nextReconcileAt: new Date() } });
    }
  }
  /** Same success shape as the customer flow's `finish()` (billing-email-recipient.ts): account write,
   *  the shared `billing.recipient.changed` audit, an old-recipient notice — plus, admin-only, a second
   *  notice to the NEW recipient (R-E2: a changed recipient is a social-engineering target either way). */
  private async finishRecipient(account: BillingAccount, claim: BillingOperation, p: Proposed, journal: Journal, lease: string) {
    await this.prisma.client.$transaction(async tx => {
      const { row } = await this.fence(tx, claim.id, lease);
      const updated = await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'SUCCEEDED', errorCode: null, observedAt: new Date(),
        resultJson: json({ ...journal, notifiedAt: new Date().toISOString() } satisfies Journal), leaseToken: null, leaseUntil: null, version: { increment: 1 } } });
      await tx.billingAccount.update({ where: { id: account.id }, data: { recipientEmail: p.target.email, recipientSource: 'ADMIN',
        recipientBouncedAt: null, recipientBounceNotifiedAt: null, version: { increment: 1 } } });
      await resolveBillingIssue(tx, issueIdentity(account, row.id), 'CUSTOMER_EMAIL_READBACK_MATCHED');
      await this.audit(tx, updated, 'observed');
      await tx.auditLog.create({ data: { companyId: account.companyId, actorUserId: row.initiatorUserId, action: 'billing.recipient.changed', targetType: 'BillingAccount',
        targetId: account.id, requestId: row.id, result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: { source: 'ADMIN', operationId: row.id, hadPrevious: Boolean(p.previousEmail) } } });
      let noticeAttemptId: string | undefined, newNoticeAttemptId: string | undefined;
      if (this.appConfig.postmarkServerId) {
        if (p.previousEmail && p.previousEmail.trim().toLowerCase() !== p.target.email) {
          const notice = await tx.emailSendAttempt.create({ data: { id: randomUUID(), intentKey: `billing-recipient-notice:${row.id}`, generation: 1,
            companyId: account.companyId, purpose: 'billing_status', recipient: p.previousEmail.trim().toLowerCase(), provider: 'postmark', providerServerId: this.appConfig.postmarkServerId,
            stream: this.appConfig.postmarkMessageStream, status: 'READY' } });
          noticeAttemptId = notice.id;
        }
        const newNotice = await tx.emailSendAttempt.create({ data: { id: randomUUID(), intentKey: `billing-recipient-notice:${row.id}:new`, generation: 1,
          companyId: account.companyId, purpose: 'billing_status', recipient: p.target.email, provider: 'postmark', providerServerId: this.appConfig.postmarkServerId,
          stream: this.appConfig.postmarkMessageStream, status: 'READY' } });
        newNoticeAttemptId = newNotice.id;
      }
      await tx.outboxEvent.upsert({ where: { eventKey: `billing:recipient-changed:${row.id}` }, update: {}, create: { companyId: account.companyId,
        eventType: BILLING_RECIPIENT_CHANGED, aggregateType: 'BillingAccount', aggregateId: account.id, eventKey: `billing:recipient-changed:${row.id}`,
        payloadJson: { schemaVersion: 1, data: { operationId: row.id, source: 'ADMIN', ...(noticeAttemptId ? { noticeAttemptId } : {}), ...(newNoticeAttemptId ? { newNoticeAttemptId } : {}) } } } });
    });
  }

  // ── Document resend (R-D1 for admins; synchronous, own lease + 10/day limiter, DQ10) ─────────

  async resend(context: RequestContext, companyId: string, invoiceId: string, reason: string, limits: RedisRateLimitService, supportRequestId?: string): Promise<BillingDocumentResendResult> {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new BadRequestException();
    const { account } = await this.access(context, companyId, MANAGE);
    await this.configuration.requireProof(context, this.prisma.client);
    const row = await this.invoice(account, invoiceId);
    if (row.providerStatus !== 'paid' || row.applyStatus !== 'APPLIED') throw billingError('BILLING_RESEND_UNAVAILABLE', 'ส่งซ้ำได้เฉพาะเอกสารที่ชำระและเปิดสิทธิ์แล้ว');
    const recipient = account.recipientEmail;
    if (!recipient) throw billingError('BILLING_RESEND_UNAVAILABLE', 'ยังไม่มีอีเมลรับเอกสาร ให้เปลี่ยนอีเมลผู้รับก่อน');
    if (account.recipientBouncedAt) throw billingError('BILLING_RECIPIENT_BOUNCED', 'อีเมลรับเอกสารส่งไม่ถึง กรุณาแก้อีเมลรับเอกสารก่อน');
    // A30: inspect → Stripe → consume, so an attempt that failed at Stripe is not counted.
    const budget = await limits.inspect('billing-resend-admin', invoiceId, RESEND_LIMIT_ADMIN, RESEND_WINDOW_SECONDS);
    if (!budget.allowed) throw new HttpException({ code: 'BILLING_RESEND_LIMIT',
      message: 'วันนี้ส่งเอกสารใบนี้ซ้ำครบจำนวนที่กำหนดแล้ว ลองใหม่ได้พรุ่งนี้ หรือเปิดเอกสารจากหน้านี้ได้ทันที', retryAfterSeconds: budget.retryAfterSeconds }, 429);
    const lease = randomUUID();
    const claimed = await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
      data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
    if (!claimed.count) throw busyError();
    let result: { invoiceSent: boolean; receiptUpdated: boolean };
    try { result = await resendStripeDocuments(this.billing.stripe, account, row, recipient); }
    catch (error) { if (error instanceof StripeRequestError) throw billingError('BILLING_RESEND_UNAVAILABLE', 'ยังส่งเอกสารซ้ำไม่ได้ กรุณาลองใหม่ภายหลัง'); throw error; }
    finally { await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null } }); }
    const consumed = await limits.consume('billing-resend-admin', invoiceId, RESEND_LIMIT_ADMIN, RESEND_WINDOW_SECONDS);
    await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, companyId);
      // Our own mail with the in-app link, same event as the customer resend — keyed by this lease.
      const eventKey = `billing:notice-email:${row.id}:admin-resend:${lease}`;
      await tx.outboxEvent.upsert({ where: { eventKey }, update: {}, create: { companyId, eventType: RESEND_NOTICE_EVENT, aggregateType: 'BillingInvoice', aggregateId: row.id,
        eventKey, payloadJson: { schemaVersion: 2, data: { recipientUserId: null, resend: true } } } });
      await tx.auditLog.create({ data: { companyId, actorUserId: context.userId, action: 'billing.document.resent', targetType: 'BillingInvoice', targetId: row.id,
        requestId: context.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { invoiceSent: result.invoiceSent, receiptUpdated: result.receiptUpdated, actor: 'ADMIN', attempt: consumed.count,
          ...(supportRequestId?.trim() ? { supportRequestId: supportRequestId.trim() } : {}) } } });
    });
    return { ...result, recipientEmail: recipient, remainingToday: Math.max(0, RESEND_LIMIT_ADMIN - consumed.count) };
  }

  // ── CUSTOMER_PROFILE_SYNC (R-E3; journaled, no approval) ───────────────────────────────────────
  // Enqueued by identity/profile writers themselves (`enqueueCustomerProfileSync` in
  // billing-company-profile.ts — a plain function, not a method here: those writers live in
  // system-partner-management, and BillingModule already imports that module, so the reverse
  // dependency would cycle). This service only drains/executes what they queued.

  async drain() {
    const now = new Date();
    const recipients = await this.prisma.client.billingOperation.findMany({ where: { type: RECIPIENT_TYPE, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      proposedJson: { path: ['target', 'source'], equals: 'ADMIN' }, state: { in: ['QUEUED', 'UNKNOWN', 'RUNNING'] },
      AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] }] },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 25 });
    let failed = 0;
    for (const row of recipients) { try { await this.executeRecipient(row); } catch { failed++; } }
    const syncs = await this.drainSync();
    return { processed: recipients.length + syncs.processed, failed: failed + syncs.failed };
  }
  private async drainSync() {
    const now = new Date();
    const rows = await this.prisma.client.billingOperation.findMany({ where: { type: SYNC_TYPE, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      state: { in: ['QUEUED', 'UNKNOWN', 'RUNNING'] }, AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] }] },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 25 });
    let failed = 0;
    for (const row of rows) { try { await this.executeSync(row); } catch { failed++; } }
    return { processed: rows.length, failed };
  }
  private async executeSync(candidate: BillingOperation) {
    const lease = randomUUID(), accountId = (candidate.proposedJson as unknown as SyncProposed).accountId;
    const claim = await this.prisma.client.$transaction(async tx => {
      const current = await tx.billingOperation.findUniqueOrThrow({ where: { id: candidate.id } }), account = await this.billing.account(candidate.companyId!, tx), now = new Date();
      const p = current.proposedJson as unknown as SyncProposed;
      if (current.companyId !== candidate.companyId || current.type !== SYNC_TYPE || current.version !== candidate.version || !['QUEUED', 'RUNNING', 'UNKNOWN'].includes(current.state) ||
        !account || account.id !== p.accountId || (current.leaseUntil && current.leaseUntil > now) || (account.leaseUntil && account.leaseUntil > now)) return null;
      // A purchase in flight syncs the profile itself (billing.service.ts `mm:<attempt>:billing-profile`) — defer rather than race it.
      // A recipient change in flight (the shop's own or the team's) too: the column still holds the old address until that change ends, and sending it here
      // would write it back over a change the provider already applied. Both end within about seventy minutes at most, so this wait is bounded.
      if (account.activeAttemptId || account.activeEmailOperationId || await pendingAdminRecipientChange(tx, account)) { await tx.billingOperation.update({ where: { id: current.id }, data: { scheduledFor: new Date(now.getTime() + 300_000) } }); return null; }
      const got = await tx.billingAccount.updateMany({ where: { id: account.id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { leaseToken: lease, leaseUntil: new Date(now.getTime() + 120_000) } });
      if (!got.count) return null;
      return tx.billingOperation.update({ where: { id: current.id }, data: { state: 'RUNNING', leaseToken: lease, leaseUntil: new Date(now.getTime() + 120_000), version: { increment: 1 } } });
    });
    if (!claim) return;
    try {
      const account = await this.billing.account(claim.companyId!);
      if (!account?.customerId) throw new Error('billing.customer_sync_no_customer');
      const company = await this.prisma.client.company.findUniqueOrThrow({ where: { id: claim.companyId! } });
      const arg = { quote: { billingProfile: companyBillingProfile(company), billingEmail: account.recipientEmail ?? null, companyName: company.name } };
      const customer = await this.billing.stripe.request('POST', `/customers/${account.customerId}`, stripeCustomerSyncPayload(arg), `billing-customer-sync-${claim.id}`);
      if (!stripeCustomerSynced(customer, arg)) throw new Error('billing.customer_sync_unconfirmed');
      await this.prisma.client.$transaction(async tx => {
        await lockPlanTermCompany(tx, claim.companyId!);
        const updated = await tx.billingOperation.updateMany({ where: { id: claim.id, version: claim.version + 1, state: 'RUNNING', leaseToken: lease, leaseUntil: { gt: new Date() } },
          data: { state: 'SUCCEEDED', observedAt: new Date(), errorCode: null, leaseToken: null, leaseUntil: null, version: { increment: 1 } } });
        if (!updated.count) throw stale();
        await resolveBillingIssue(tx, issueIdentity(account, claim.id), 'CUSTOMER_EMAIL_READBACK_MATCHED');
        await tx.auditLog.create({ data: { companyId: claim.companyId, actorUserId: claim.initiatorUserId, action: 'billing.customer_sync.observed', targetType: 'BillingOperation',
          targetId: claim.id, requestId: claim.id, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { accountId: account.id } } });
      });
    } catch (error) {
      await this.prisma.client.$transaction(async tx => {
        const current = await tx.billingOperation.findUnique({ where: { id: claim.id } });
        if (!current || current.state !== 'RUNNING' || current.leaseToken !== lease) return;
        const rejected = error instanceof StripeRequestError && error.outcome === 'REJECTED';
        await tx.billingOperation.update({ where: { id: claim.id }, data: { state: rejected ? 'FAILED' : 'UNKNOWN', errorCode: 'CONTROL_CUSTOMER_SYNC_REVIEW',
          scheduledFor: new Date(Date.now() + 300_000), leaseToken: null, leaseUntil: null, version: { increment: 1 } } });
        await detectBillingIssue(tx, issueIdentity({ companyId: current.companyId!, stripeAccountId: current.stripeAccountId, livemode: current.livemode }, current.id));
        await tx.auditLog.create({ data: { companyId: current.companyId, action: 'billing.customer_sync.review', targetType: 'BillingOperation', targetId: current.id,
          requestId: current.id, result: 'FAILED', riskLevel: 'MEDIUM', metadataJson: { errorCode: rejected ? 'REJECTED' : 'UNKNOWN' } } });
      });
    } finally {
      await this.prisma.client.billingAccount.updateMany({ where: { id: accountId, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null, nextReconcileAt: new Date() } });
    }
  }
}
