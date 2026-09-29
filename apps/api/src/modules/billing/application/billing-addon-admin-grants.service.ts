import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BillingAddOnAdminLot, BillingAddOnCredits, BillingAddOnGrantInput, BillingAddOnGrantOperation, BillingAddOnProductKind } from '@watchdog-bms/contracts';
import type { BillingOperation, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { assertKeys, billingError, configurationHash, hashBilling } from '../domain/billing-policy';
import { appendPackageInterval } from '../domain/billing-package';
import { billingApprovalMode, canApproveBillingChange } from './billing-approval';
import { addOnGrantReady, applyAddOnGrant } from './billing-addon-grants';
import { BillingAdminService } from './billing-admin.service';
import { BillingConfigurationService } from './billing-configuration.service';
import { isReceiptPackageKind, receiptLots, RECEIPT_ADDON_KINDS, visibleReceiptLots, type ReceiptLot } from './billing-receipt-grants';
import { BillingService } from './billing.service';

const types = ['ADDON_ADMIN_GRANT', 'ADDON_ADMIN_REVOKE'];
const products: readonly string[] = ['CHAT_CREDIT', 'RECEIPT_IMAGE'];
/** Team lots an operator may take back (spec §16 item 8, sales-event spec §5.6). A paid lot leaves by refund only. */
const revocable: readonly string[] = ['ADD_ON_ADMIN', 'SALES_EVENT'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const stale = () => billingError('CONTROL_PREVIEW_STALE', 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจรายการอีกครั้ง');
const json = (value: unknown) => value as Prisma.InputJsonValue;
type Proposed = { productKind: BillingAddOnProductKind; accountId: string; membershipId: string; actorCompanyId: string; sourceHash: string;
  units: number; grantId: string | null; grantSourceHash: string | null; projectedExpiresAt: string | null };
type Journal = { requesterCredentialVersion?: string; approverCredentialVersion?: string; approvedAt?: string; lotId?: string;
  expiresAt?: string; revokedUnits?: number; beforeAdditional?: number; afterAdditional?: number };
type Scoped = Awaited<ReturnType<BillingAdminService['scopedCompany']>>;

/**
 * Add-on plan PR B (spec §16, §18.2, F-21): the operator adds units to a shop, or takes back the unused units
 * of a team lot, through the same reviewed preview → submit → approve as the receipt adjustment, with the
 * same permissions. The approval writes through the shared seam (`applyAddOnGrant`), so a team lot is used,
 * held, released and expires exactly like a bought one. No expiry is typed: it is 12 months from approval
 * (D8, C03). The source never includes the checkout or collection slot (C04) — adding units touches neither.
 */
@Injectable()
export class BillingAddOnAdminGrantsService {
  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService, private readonly admin: BillingAdminService,
    private readonly configuration: BillingConfigurationService) {}

  private async scope(context: RequestContext, companyId: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const result = await this.admin.scopedCompany(context, companyId, tx);
    await this.admin.access(context, 'system.billing.financial.read', tx);
    return result;
  }
  /** L1 → L4 (spec §8.3): the order OCR admission and the seam use. */
  private async lock(tx: Prisma.TransactionClient, companyId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${companyId}`}))`;
    await lockPlanTermCompany(tx, companyId);
  }
  private source(s: Scoped) {
    const a = s.account, t = s.company.planTerm;
    return hashBilling([s.company.id, s.company.status, a?.id, a?.stripeAccountId, a?.livemode, t?.billingReceiptAccountId, t?.termDisabledAt]);
  }
  private async blocked(s: Scoped, productKind: BillingAddOnProductKind, tx: Prisma.TransactionClient) {
    if (!s.account || !await addOnGrantReady(tx, s.company.id, s.account.id, productKind)) return 'CONTROL_ADDON_NOT_READY';
    if (s.company.status !== 'ACTIVE' || s.company.planTerm?.termDisabledAt) return 'CONTROL_COMPANY_HELD';
    return null;
  }
  private lotView(lot: ReceiptLot, now = new Date()): BillingAddOnAdminLot {
    const state = lot.revokedAt ? 'REVOKED' : lot.expiresAt <= now ? 'EXPIRED' : lot.availableAt > now ? 'PENDING' : 'ACTIVE';
    const open = state === 'ACTIVE' || state === 'PENDING';
    return { id: lot.id, productKind: 'RECEIPT_IMAGE', source: lot.kind as BillingAddOnAdminLot['source'], units: lot.units,
      reserved: lot.reserved, consumed: lot.consumed, revoked: lot.revoked, remaining: open ? lot.remaining : 0,
      availableAt: lot.availableAt.toISOString(), expiresAt: lot.expiresAt.toISOString(), revokedAt: lot.revokedAt?.toISOString() ?? null,
      state, canRevoke: open && revocable.includes(lot.kind) };
  }
  /** One team lot of this account, with its projection; anything else is not found. */
  private async revocableLot(tx: Prisma.TransactionClient, companyId: string, accountId: string, id: string) {
    const row = await tx.billingReceiptGrant.findFirst({ where: { id, companyId, billingAccountId: accountId, kind: { in: [...revocable] } },
      select: { sourceHash: true } });
    const [lot] = row ? await receiptLots(tx, { id }) : [];
    if (!row || !lot) throw new NotFoundException();
    return { ...lot, sourceHash: row.sourceHash };
  }
  /** "ยอดเพิ่มเติม" as spec §17.2 counts it: team + purchased lots the admission can use now. */
  private async additional(tx: Prisma.TransactionClient, companyId: string, accountId: string) {
    return (await receiptLots(tx, visibleReceiptLots(companyId, accountId, new Date())))
      .filter((lot) => !isReceiptPackageKind(lot.kind)).reduce((total, lot) => total + lot.remaining, 0);
  }
  private async row(context: RequestContext, id: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const row = await tx.billingOperation.findFirst({ where: { id, type: { in: types }, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode } });
    if (!row?.companyId) throw new NotFoundException();
    await this.scope(context, row.companyId, tx);
    return row;
  }
  private async view(context: RequestContext, row: BillingOperation, tx: Prisma.TransactionClient = this.prisma.client): Promise<BillingAddOnGrantOperation> {
    const s = await this.scope(context, row.companyId!, tx), p = row.proposedJson as Proposed, j = (row.resultJson ?? {}) as Journal;
    const fresh = row.expiresAt > new Date(), own = row.initiatorUserId === context.userId;
    const manage = s.access.capabilities.includes('system.billing.override.manage'), approve = s.access.capabilities.includes('system.billing.approval.approve');
    const actors = await tx.user.findMany({ where: { id: { in: [row.initiatorUserId, ...row.approverUserId ? [row.approverUserId] : []] } }, select: { id: true, displayName: true } });
    const lotId = j.lotId ?? p.grantId, [lot] = lotId ? await receiptLots(tx, { id: lotId, companyId: row.companyId! }) : [];
    return { id: row.id, type: row.type as BillingAddOnGrantOperation['type'], state: row.state as BillingAddOnGrantOperation['state'],
      scope: { kind: 'COMPANY', companyId: row.companyId!, mode: row.livemode ? 'LIVE' : 'TEST' }, companyName: s.company.name,
      version: row.version, reason: row.reason, initiatorUserId: row.initiatorUserId, approverUserId: row.approverUserId,
      approvalMode: billingApprovalMode(row), errorCode: row.errorCode, createdAt: row.createdAt.toISOString(),
      observedAt: row.observedAt?.toISOString() ?? null, expiresAt: row.expiresAt.toISOString(), referenceId: row.referenceId,
      previewHash: row.requestHash, productKind: p.productKind, units: j.revokedUnits ?? p.units,
      grantExpiresAt: j.expiresAt ?? p.projectedExpiresAt ?? lot?.expiresAt.toISOString() ?? row.expiresAt.toISOString(),
      lot: lot ? this.lotView(lot) : null,
      requesterName: actors.find((a) => a.id === row.initiatorUserId)?.displayName ?? null,
      approverName: actors.find((a) => a.id === row.approverUserId)?.displayName ?? null,
      allowedActions: [...(fresh && own && manage && row.state === 'PREVIEW' ? ['submit' as const] : []),
        ...(fresh && canApproveBillingChange(s.access, row.initiatorUserId, context.userId, 'system.billing.override.manage') && row.state === 'AWAITING_APPROVAL' ? ['approve' as const] : []),
        ...(['PREVIEW', 'AWAITING_APPROVAL'].includes(row.state) && (manage || approve) ? ['cancel' as const] : [])] };
  }

  async get(context: RequestContext, id: string) { return this.view(context, await this.row(context, id)); }

  async list(context: RequestContext, companyId: string, cursor?: string): Promise<BillingAddOnCredits> {
    const s = await this.scope(context, companyId), anchor = cursor ? await this.row(context, cursor) : null;
    if (anchor && anchor.companyId !== companyId) throw new NotFoundException();
    const db = this.prisma.client;
    const rows = await db.billingOperation.findMany({ where: { companyId, type: { in: types }, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      ...anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {} },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26 });
    const blockedReason = await this.blocked(s, 'RECEIPT_IMAGE', db), receiptAccountId = s.company.planTerm?.billingReceiptAccountId ?? null;
    const visible = receiptAccountId ? await receiptLots(db, visibleReceiptLots(companyId, receiptAccountId, new Date())) : [];
    const lots = s.account ? await receiptLots(db, { companyId, billingAccountId: s.account.id, kind: { in: [...RECEIPT_ADDON_KINDS] } }) : [];
    const remaining = (pkg: boolean) => visible.filter((lot) => isReceiptPackageKind(lot.kind) === pkg).reduce((total, lot) => total + lot.remaining, 0);
    return { companyId, companyName: s.company.name, sourceHash: this.source(s), blockedReason,
      canCreate: !blockedReason && s.access.capabilities.includes('system.billing.override.manage'),
      images: { packageRemaining: receiptAccountId ? remaining(true) : null, additionalRemaining: remaining(false), lots: lots.map((lot) => this.lotView(lot)) },
      items: await Promise.all(rows.slice(0, 25).map((row) => this.view(context, row))), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }

  async preview(context: RequestContext, companyId: string, input: BillingAddOnGrantInput) {
    assertKeys(input, ['type', 'productKind', 'units', 'grantId', 'sourceHash', 'reason']);
    if (!types.includes(input.type) || !products.includes(input.productKind) || typeof input.reason !== 'string' || !input.reason.trim()
      || input.reason.length > 500 || typeof input.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceHash)) throw new BadRequestException();
    const row = await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, companyId);
      const s = await this.scope(context, companyId, tx);
      await this.admin.access(context, 'system.billing.override.manage', tx);
      const blocked = await this.blocked(s, input.productKind, tx);
      if (blocked) throw billingError(blocked, 'ตรวจสถานะร้านก่อนเพิ่มหรือถอนยอด');
      if (this.source(s) !== input.sourceHash) throw stale();
      const accountId = s.account!.id, now = new Date();
      let units: number, grantId: string | null = null, grantSourceHash: string | null = null, projectedExpiresAt: string | null = null;
      if (input.type === 'ADDON_ADMIN_GRANT') {
        if (input.grantId !== undefined || !Number.isSafeInteger(input.units) || input.units! < 1 || input.units! > 2_147_483_647) throw new BadRequestException();
        units = input.units!;
        projectedExpiresAt = appendPackageInterval(now, 'year').toISOString();
      } else {
        if (input.units !== undefined || typeof input.grantId !== 'string' || !uuid.test(input.grantId)) throw new BadRequestException();
        const lot = await this.revocableLot(tx, companyId, accountId, input.grantId);
        if (lot.revokedAt || lot.expiresAt <= now) throw stale();
        units = lot.remaining; grantId = lot.id; grantSourceHash = lot.sourceHash;
      }
      const id = randomUUID(), reason = input.reason.trim();
      const p: Proposed = { productKind: input.productKind, accountId, membershipId: context.membershipId, actorCompanyId: context.companyId,
        sourceHash: input.sourceHash, units, grantId, grantSourceHash, projectedExpiresAt };
      return tx.billingOperation.create({ data: { id, companyId, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
        type: input.type, referenceId: grantId, proposedJson: json(p), sourceVersion: s.account?.version ?? 0, reason, initiatorUserId: context.userId,
        requestHash: configurationHash([id, input.type, p, reason]), expiresAt: new Date(now.getTime() + 600_000) } });
    });
    return this.view(context, row);
  }

  async command(context: RequestContext, id: string, action: 'submit' | 'approve' | 'cancel', version: number, hash: string, key?: string) {
    const original = await this.row(context, id);
    if (action === 'submit' && (!key || !/^[a-zA-Z0-9_-]{16,120}$/.test(key))) throw new BadRequestException();
    const row = await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, original.companyId!);
      const row = await this.row(context, id, tx), s = await this.scope(context, row.companyId!, tx);
      const p = row.proposedJson as Proposed, j = (row.resultJson ?? {}) as Journal;
      const permission = action === 'approve' ? 'system.billing.approval.approve' : 'system.billing.override.manage';
      if (!s.access.capabilities.includes(permission) && !(action === 'cancel' && s.access.capabilities.includes('system.billing.approval.approve'))) throw new ForbiddenException();
      await this.configuration.requireProof(context, tx);
      if (row.requestHash !== hash || hash !== configurationHash([id, row.type, p, row.reason])) throw stale();
      if (action === 'submit') {
        const replay = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: { stripeAccountId: row.stripeAccountId, livemode: row.livemode, idempotencyKey: key! } } });
        if (replay && (replay.id !== id || replay.initiatorUserId !== context.userId || replay.requestHash !== hash)) throw billingError('CONTROL_IDEMPOTENCY_CONFLICT', 'คำขอนี้ต่างจากรายการเดิม เปิดรายการเดิมเพื่อตรวจสอบ');
        if (row.idempotencyKey === key && row.initiatorUserId === context.userId && row.state !== 'PREVIEW') return row;
      }
      if (action === 'approve' && row.state === 'SUCCEEDED' && row.approverUserId === context.userId) return row;
      if (action === 'cancel' && row.state === 'CANCELLED') return row;
      if (row.version !== version || !['PREVIEW', 'AWAITING_APPROVAL'].includes(row.state)) throw stale();
      if (action !== 'cancel') {
        if (row.expiresAt <= new Date() || this.source(s) !== p.sourceHash || await this.blocked(s, p.productKind, tx)) throw stale();
        if (action === 'submit') {
          if (row.initiatorUserId !== context.userId || row.state !== 'PREVIEW') throw new ForbiddenException();
          j.requesterCredentialVersion = (await tx.userCredential.findUniqueOrThrow({ where: { userId: context.userId } })).updatedAt.toISOString();
        } else {
          if (row.state !== 'AWAITING_APPROVAL') throw new ForbiddenException();
          await this.configuration.requireApprovalActor(row, context, 'system.billing.override.manage', tx);
          await this.configuration.operationActor(row, row.initiatorUserId, p.membershipId, p.actorCompanyId, 'system.billing.override.manage', tx, row.companyId!);
          await tx.$queryRaw`SELECT "userId" FROM "UserCredential" WHERE "userId"=${row.initiatorUserId} FOR SHARE`;
          const credential = await tx.userCredential.findUnique({ where: { userId: row.initiatorUserId } });
          if (!credential || credential.status !== 'ACTIVE' || credential.mustChangePassword || (credential.expiresAt && credential.expiresAt <= new Date())
            || credential.updatedAt.toISOString() !== j.requesterCredentialVersion) throw new ForbiddenException();
          // Fence the approving actor's scope and role assignments through commit as well.
          await this.configuration.operationActor(row, context.userId, context.membershipId, context.companyId, 'system.billing.approval.approve', tx, row.companyId!);
          await this.configuration.requireProof(context, tx);
          j.approverCredentialVersion = (await tx.userCredential.findUniqueOrThrow({ where: { userId: context.userId } })).updatedAt.toISOString();
          j.approvedAt = new Date().toISOString();
          j.beforeAdditional = await this.additional(tx, row.companyId!, p.accountId);
          if (row.type === 'ADDON_ADMIN_GRANT') {
            const granted = await applyAddOnGrant(tx, { companyId: row.companyId!, billingAccountId: p.accountId, productKind: p.productKind,
              sourceKind: 'ADD_ON_ADMIN', sourceKey: `addon-admin:${row.id}`, sourceHash: row.requestHash, units: p.units, at: new Date(j.approvedAt) });
            j.lotId = granted.lotId; j.expiresAt = granted.expiresAt.toISOString();
          } else {
            // Under L1: units held by a running read stay with it and settle on this lot; only the unused part is revoked (§16 item 8).
            const lot = await this.revocableLot(tx, row.companyId!, p.accountId, p.grantId!);
            if (lot.revokedAt || lot.expiresAt <= new Date() || lot.sourceHash !== p.grantSourceHash) throw stale();
            if (lot.remaining > 0) await tx.receiptUnitEntry.create({ data: { companyId: row.companyId!, grantId: lot.id,
              operationKey: `addon-revoke:${row.id}`, generation: 1, kind: 'REVOKE', units: lot.remaining } });
            await tx.billingReceiptGrant.update({ where: { id: lot.id }, data: { revokedAt: new Date(j.approvedAt) } });
            j.lotId = lot.id; j.revokedUnits = lot.remaining;
          }
          j.afterAdditional = await this.additional(tx, row.companyId!, p.accountId);
        }
      }
      const updated = await tx.billingOperation.update({ where: { id }, data: {
        state: action === 'submit' ? 'AWAITING_APPROVAL' : action === 'approve' ? 'SUCCEEDED' : 'CANCELLED',
        ...action === 'submit' ? { idempotencyKey: key } : {}, ...action === 'approve' ? { approverUserId: context.userId, observedAt: new Date() } : {},
        resultJson: json(j), version: { increment: 1 } } });
      await tx.auditLog.create({ data: { companyId: row.companyId, actorUserId: context.userId, action: `billing.addon_grant.${action}`,
        targetType: 'BillingOperation', targetId: id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: { source: 'ADD_ON_ADMIN', type: row.type, productKind: p.productKind, reason: row.reason, fromState: row.state, toState: updated.state,
          requestedUnits: p.units, revokedUnits: j.revokedUnits ?? null, lotId: j.lotId ?? p.grantId, expiresAt: j.expiresAt ?? null,
          beforeAdditional: j.beforeAdditional ?? null, afterAdditional: j.afterAdditional ?? null,
          initiatorUserId: row.initiatorUserId, approverUserId: updated.approverUserId, approvalMode: billingApprovalMode(updated) } } });
      return updated;
    });
    return this.view(context, row);
  }
}
