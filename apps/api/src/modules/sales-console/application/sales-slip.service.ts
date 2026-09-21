/**
 * Q9 — the bank-transfer fallback for a deal (spec §19.5 Q9, product brief C).
 *
 * The customer attaches a slip on the package page; the shop stays locked. The Owner looks at the
 * image in `/system`, confirms with a password proof, and the deal applies exactly as a paid one
 * would — minus the Stripe half, which a transfer does not have. Nothing here reads a slip
 * automatically and nothing here ever travels over LINE.
 */
import { Injectable } from '@nestjs/common';
import {
  SALES_SLIP_MIME_TYPES,
  SALES_SLIP_PURPOSE,
  SALES_SLIP_TARGET_TYPE,
  type SalesDealSlipListDto,
  type SalesDealSlipRow,
  type SalesDealSnapshot,
  PLAN_TIER_PRESETS,
  type PlanTierKey,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/application/audit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { BillingConfigurationService } from '../../billing/application/billing-configuration.service';
import { applyDealEntitlement } from '../../billing/application/billing-deal-entitlement';
import { CreateDownloadUrlUseCase } from '../../data-model-core/application/use-cases/create-download-url.use-case';
import { CreateUploadIntentUseCase } from '../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { assertPlanTermAdjustmentActor } from '../../system-partner-management/application/plan-term-adjustment';
import { DEAL_KIND, offerExpiryFrom } from '../domain/sales-deal.logic';
import { SalesRenewalService } from './sales-renewal.service';
import { salesBadRequest, salesError, salesNotFound } from './sales-context';

const SLIP_LIST_LIMIT = 100;

type DealRow = {
  id: string; companyId: string; status: string; salesUserId: string | null; offerSnapshotJson: unknown;
  paymentState: string; offerExpiresAt: Date | null; slipAttachmentId: string | null;
  slipSubmittedAt: Date | null; renewalOfRequestId: string | null; version: number;
};

@Injectable()
export class SalesSlipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly uploads: CreateUploadIntentUseCase,
    private readonly completions: CompleteAttachmentUploadUseCase,
    private readonly downloads: CreateDownloadUrlUseCase,
    private readonly lifecycle: PartnerLifecycleTransitionUseCase,
    private readonly billingConfig: BillingConfigurationService,
    private readonly renewals: SalesRenewalService,
  ) {}

  // ── customer side ────────────────────────────────────────────────────────────────────

  async uploadIntent(ctx: RequestContext, companyId: string, dealId: string,
    body: { originalFileName: string; mimeType: string; byteSize: number }) {
    await this.openDeal(companyId, dealId);
    if (!SALES_SLIP_MIME_TYPES.includes(body.mimeType as never)) {
      throw salesBadRequest('SALES_SLIP_REQUIRED', 'แนบได้เฉพาะรูปภาพ (JPG/PNG/WEBP) หรือไฟล์ PDF');
    }
    const intent = await this.uploads.execute(ctx, {
      originalFileName: body.originalFileName, mimeType: body.mimeType, byteSize: body.byteSize,
      // A transfer slip is มั่งมี's own payment evidence, not a document the shop shares with its
      // customers — the same visibility the accounting evidence path uses.
      visibility: 'ACCOUNTING', metadataJson: { purpose: SALES_SLIP_PURPOSE, targetType: SALES_SLIP_TARGET_TYPE,
        packageChangeRequestId: dealId },
    });
    return { ...intent, expiresAt: intent.expiresAt.toISOString() };
  }

  /**
   * The malware scan, the checksum and the byte-for-byte re-read all live in
   * `CompleteAttachmentUploadUseCase`; this only records that the customer says they transferred.
   */
  async complete(ctx: RequestContext, companyId: string, dealId: string, attachmentId: string, checksumSha256?: string) {
    const deal = await this.openDeal(companyId, dealId);
    await this.completions.execute(ctx, { attachmentId, ...(checksumSha256 ? { checksumSha256 } : {}) });
    const now = new Date();
    const claimed = await this.prisma.client.packageChangeRequest.updateMany({
      where: { id: deal.id, kind: DEAL_KIND, status: 'APPROVED', paymentState: { in: ['NONE', 'SLIP_REJECTED'] } },
      data: { paymentState: 'SLIP_PENDING', slipAttachmentId: attachmentId, slipSubmittedAt: now, version: { increment: 1 } },
    });
    if (claimed.count !== 1) throw this.slipConflict();
    await this.audit.log({
      actorUserId: ctx.userId, companyId, action: 'sales.deal.slip_submitted',
      targetType: 'package_change_request', targetId: deal.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { attachmentId, salesUserId: deal.salesUserId },
    });
    await this.notifyAdmins(deal.id);
    return { dealId: deal.id, slipState: 'PENDING' as const, submittedAt: now.toISOString() };
  }

  /** The customer re-reading their own slip. Scoped to their company by the use case itself. */
  async customerSlipUrl(ctx: RequestContext, companyId: string, dealId: string) {
    const deal = await this.requireDeal(dealId, companyId);
    if (!deal.slipAttachmentId) throw salesNotFound('SALES_SLIP_REQUIRED', 'ยังไม่ได้แนบสลิปสำหรับข้อเสนอนี้');
    const signed = await this.downloads.execute(ctx, { attachmentId: deal.slipAttachmentId, disposition: 'inline' });
    return { downloadUrl: signed.downloadUrl, expiresAt: signed.expiresAt.toISOString() };
  }

  // ── admin side ───────────────────────────────────────────────────────────────────────

  async pending(): Promise<SalesDealSlipListDto> {
    const rows = await this.prisma.client.packageChangeRequest.findMany({
      where: { kind: DEAL_KIND, paymentState: 'SLIP_PENDING' },
      orderBy: { slipSubmittedAt: 'asc' }, take: SLIP_LIST_LIMIT,
    });
    if (rows.length === 0) return { items: [] };
    const [companies, agents] = await Promise.all([
      this.prisma.client.company.findMany({ where: { id: { in: rows.map((row) => row.companyId) } }, select: { id: true, name: true } }),
      this.prisma.client.user.findMany({ where: { id: { in: rows.flatMap((row) => row.salesUserId ? [row.salesUserId] : []) } },
        select: { id: true, displayName: true } }),
    ]);
    const nameByCompany = new Map(companies.map((company) => [company.id, company.name]));
    const nameByUser = new Map(agents.map((user) => [user.id, user.displayName]));
    return {
      items: rows.map((row): SalesDealSlipRow => {
        const snapshot = row.offerSnapshotJson as SalesDealSnapshot | null;
        return {
          dealId: row.id, companyId: row.companyId, companyName: nameByCompany.get(row.companyId) ?? '',
          salesUserId: row.salesUserId ?? '', salesDisplayName: nameByUser.get(row.salesUserId ?? '') ?? '',
          amountSatang: row.amountSatang ?? snapshot?.priceSatang ?? 0, months: snapshot?.months ?? 0,
          baseLabel: snapshot ? PLAN_TIER_PRESETS[snapshot.base as PlanTierKey]?.labelTh ?? snapshot.base : '',
          slipAttachmentId: row.slipAttachmentId, submittedAt: row.slipSubmittedAt?.toISOString() ?? null,
        };
      }),
    };
  }

  /**
   * The Owner previewing a customer's slip. The attachment belongs to the SHOP, and the admin's
   * own `ctx.companyId` is the platform tenant, so the read is made explicitly on the shop's
   * behalf: gated by `sales.agent_profile.manage` at the route, and audited every single time.
   */
  async adminSlipUrl(ctx: RequestContext, dealId: string) {
    const deal = await this.requireDeal(dealId);
    if (!deal.slipAttachmentId) throw salesNotFound('SALES_SLIP_REQUIRED', 'ข้อเสนอนี้ยังไม่มีสลิป');
    const signed = await this.downloads.execute({ ...ctx, companyId: deal.companyId },
      { attachmentId: deal.slipAttachmentId, disposition: 'inline' });
    await this.audit.log({
      actorUserId: ctx.userId, companyId: deal.companyId, action: 'sales.deal.slip_viewed',
      targetType: 'package_change_request', targetId: deal.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { attachmentId: deal.slipAttachmentId },
    });
    return { downloadUrl: signed.downloadUrl, expiresAt: signed.expiresAt.toISOString() };
  }

  /**
   * "ยืนยันการโอน" — the money is real, so the deal applies with the same entitlements a Stripe
   * payment would give it. Reviewed-operation posture: a password proof no older than five
   * minutes AND the dual SYSTEM_ADMIN + `system.partner_company.update` actor check.
   */
  async verify(ctx: RequestContext, dealId: string, reason: string) {
    const note = this.reason(reason);
    const deal = await this.requireDeal(dealId);
    if (deal.paymentState !== 'SLIP_PENDING' || deal.status !== 'APPROVED') throw this.slipConflict();
    const snapshot = deal.offerSnapshotJson as SalesDealSnapshot | null;
    if (!snapshot || !deal.salesUserId) throw this.slipConflict();
    const verifiedAt = deal.slipSubmittedAt ?? new Date();

    await this.prisma.client.$transaction(async (tx) => {
      await this.billingConfig.requireProof(ctx, tx);
      await assertPlanTermAdjustmentActor(tx, ctx.userId);
      const claimed = await tx.packageChangeRequest.updateMany({
        where: { id: deal.id, kind: DEAL_KIND, status: 'APPROVED', paymentState: 'SLIP_PENDING' },
        data: { status: 'APPLIED', paymentState: 'SLIP_VERIFIED', verifiedAt, verifiedByUserId: ctx.userId,
          decidedAt: new Date(), decidedByUserId: ctx.userId, internalReason: note, version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw this.slipConflict();
      await applyDealEntitlement(tx, { companyId: deal.companyId, dealId: deal.id, salesUserId: deal.salesUserId!,
        snapshot, paidAt: verifiedAt, verifiedByUserId: ctx.userId, renewal: Boolean(deal.renewalOfRequestId) });
      const company = await tx.company.findUniqueOrThrow({ where: { id: deal.companyId }, include: { planTerm: true } });
      if (company.status === 'DISABLED' && company.planTerm?.termDisabledAt) await this.lifecycle.execute({
        companyId: deal.companyId, targetStatus: 'ACTIVE', requestingAdminUserId: ctx.userId,
        requestId: deal.id, reason: 'sales_deal_slip_verified' }, tx);
      await this.audit.log({
        actorUserId: ctx.userId, companyId: deal.companyId, action: 'sales.deal.slip_verified',
        targetType: 'package_change_request', targetId: deal.id, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: { salesUserId: deal.salesUserId, amountSatang: snapshot.priceSatang, months: snapshot.months,
          attachmentId: deal.slipAttachmentId, reason: note, renewal: Boolean(deal.renewalOfRequestId) },
      }, tx);
    });
    return this.pending();
  }

  /**
   * "ปฏิเสธสลิป" — back to APPROVED so the customer can transfer again or pay by card. The offer
   * window is pushed out by exactly the time the slip spent under review, so a slow review never
   * costs the customer their offer.
   */
  async reject(ctx: RequestContext, dealId: string, reason: string) {
    const note = this.reason(reason);
    const deal = await this.requireDeal(dealId);
    if (deal.paymentState !== 'SLIP_PENDING') throw this.slipConflict();
    const heldMs = Math.max(0, Date.now() - (deal.slipSubmittedAt?.getTime() ?? Date.now()));
    const offerExpiresAt = deal.offerExpiresAt
      ? new Date(Math.max(deal.offerExpiresAt.getTime() + heldMs, Date.now() + 60_000))
      : offerExpiryFrom(new Date());
    await this.prisma.client.$transaction(async (tx) => {
      await assertPlanTermAdjustmentActor(tx, ctx.userId);
      const claimed = await tx.packageChangeRequest.updateMany({
        where: { id: deal.id, kind: DEAL_KIND, status: 'APPROVED', paymentState: 'SLIP_PENDING' },
        // `slipSubmittedAt` stays: it is what tells the customer's card "the last slip was turned
        // down", and it is the only record that the window was extended for a reason.
        data: { paymentState: 'SLIP_REJECTED', rejectedReason: note, offerExpiresAt,
          verifiedByUserId: ctx.userId, version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw this.slipConflict();
      await this.audit.log({
        actorUserId: ctx.userId, companyId: deal.companyId, action: 'sales.deal.slip_rejected',
        targetType: 'package_change_request', targetId: deal.id, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { salesUserId: deal.salesUserId, reason: note, offerExpiresAt: offerExpiresAt.toISOString() },
      }, tx);
    });
    return this.pending();
  }

  // ── internals ────────────────────────────────────────────────────────────────────────

  private async requireDeal(dealId: string, companyId?: string): Promise<DealRow> {
    const row = await this.prisma.client.packageChangeRequest.findFirst({
      where: { id: dealId, kind: DEAL_KIND, ...(companyId ? { companyId } : {}) },
    });
    if (!row) throw salesNotFound('SALES_COMPANY_NOT_FOUND', 'ไม่พบข้อเสนอนี้');
    return row as DealRow;
  }

  /** The customer may only attach a slip to a live offer they were actually made. */
  private async openDeal(companyId: string, dealId: string): Promise<DealRow> {
    const deal = await this.requireDeal(dealId, companyId);
    if (deal.status !== 'APPROVED' || !deal.offerExpiresAt || deal.offerExpiresAt <= new Date()) {
      throw salesError('SALES_DEAL_EXPIRED', 'ข้อเสนอนี้หมดอายุแล้ว กรุณาติดต่อทีมงาน');
    }
    if (deal.paymentState === 'SLIP_PENDING') {
      throw salesError('SALES_SLIP_STATE_CONFLICT', 'ส่งสลิปแล้ว รอทีมงานตรวจสอบ');
    }
    if (!['NONE', 'SLIP_REJECTED'].includes(deal.paymentState)) throw this.slipConflict();
    return deal;
  }

  private reason(raw: unknown): string {
    const reason = typeof raw === 'string' ? raw.trim() : '';
    if (!reason || reason.length > 500) {
      throw salesBadRequest('SALES_SLIP_STATE_CONFLICT', 'ต้องระบุเหตุผล (ไม่เกิน 500 ตัวอักษร)');
    }
    return reason;
  }

  private slipConflict() {
    return salesError('SALES_SLIP_STATE_CONFLICT', 'สถานะสลิปเปลี่ยนไปแล้ว โหลดหน้าใหม่แล้วลองอีกครั้ง');
  }

  /** The Owner is the only one who can act on a slip, so the notice goes to SYSTEM_ADMIN only. */
  private async notifyAdmins(dealId: string): Promise<void> {
    await this.renewals.notifySlipPending(dealId);
  }
}
