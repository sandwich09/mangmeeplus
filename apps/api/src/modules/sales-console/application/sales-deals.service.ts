/**
 * Sales deals (spec R3–R5, S17–S19, S24, S31, Q5/Q6).
 *
 * A deal is a `PackageChangeRequest` row with `kind = 'SALES_DEAL'`. It deliberately never takes
 * `status = 'OPEN'`, so the customer's own one-open-request index is untouched; its own
 * "one non-final deal per company" fence is the second partial unique index added by the
 * 20260921120000_sales_console migration.
 *
 * Phase 2 stops at APPROVED. PAID/APPLIED are Phase 3's payment path.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  billingOffer,
  SALES_DEAL_OPEN_STATUSES,
  SALES_DEAL_REASON_MAX,
  type SalesDealBaseTier,
  type SalesDealListDto,
  type SalesDealSaveBody,
  type SalesDealSnapshot,
  type SalesDealStatus,
  type SalesDealView,
  type SalesMyWorkDto,
  type SalesMyWorkItem,
  type SalesMyWorkKind,
} from '@watchdog-bms/contracts';
import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { uniqueConstraintFields } from '../../../common/database/prisma-error';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';
import { AuditService } from '../../audit/application/audit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { pushSystemLineMessage } from '../../auth/infrastructure/system-line-push';
import { ownerLineUserIds } from '../../system-partner-management/application/use-cases/package-change-decision.use-case';
import {
  buildDealSnapshot,
  canTransitionDeal,
  CUSTOMER_REQUEST_KIND,
  DEAL_KIND,
  derivedDealStatus,
  EDITABLE_DEAL_STATUSES,
  dealSlipState,
  offerExpiryFrom,
  overLimitCounts,
  requireReason,
  salesOfferNoticeText,
  SalesSnapshotError,
} from '../domain/sales-deal.logic';
import { SalesCompanySearchService } from './sales-company-search.service';
import { canSeeAllDeals, isSystemAdmin, salesBadRequest, salesError, salesForbidden, salesNotFound } from './sales-context';

/**
 * Either partial index on PackageChangeRequest is keyed on `companyId` alone, so a unique
 * violation naming that column is the "one non-final deal per company" fence (S18).
 *
 * `uniqueConstraintFields` is the repo's one reader of the Prisma 7 adapter shape: the columns
 * arrive under `meta.driverAdapterError.cause.constraint.fields` and quoted (`"companyId"`), never
 * under `meta.target`. Hand-rolling this comparison is exactly how a friendly 409 becomes a 500.
 */
function isDealConflict(error: unknown): boolean {
  const fields = uniqueConstraintFields(error);
  return Array.isArray(fields) && (fields.length === 0 || fields.includes('companyId'));
}

type DealRow = {
  id: string; companyId: string; status: string; version: number; salesUserId: string | null;
  offerSnapshotJson: unknown; internalReason: string | null; amountSatang: number | null; paymentState: string;
  verifiedAt: Date | null; decidedAt: Date | null;
  approvedByUserId: string | null; approvedAt: Date | null; selfApproved: boolean;
  offerExpiresAt: Date | null; rejectedReason: string | null; createdAt: Date; updatedAt: Date;
  renewalOfRequestId: string | null; slipSubmittedAt: Date | null;
};

const DEAL_SELECT = {
  id: true, companyId: true, status: true, version: true, salesUserId: true,
  offerSnapshotJson: true, internalReason: true, amountSatang: true, paymentState: true,
  verifiedAt: true, decidedAt: true,
  approvedByUserId: true, approvedAt: true, selfApproved: true,
  offerExpiresAt: true, rejectedReason: true, createdAt: true, updatedAt: true,
  renewalOfRequestId: true, slipSubmittedAt: true,
} as const;

@Injectable()
export class SalesDealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companies: SalesCompanySearchService,
    private readonly lineCredentials: LineMessagingCredentialsService,
    private readonly config: AppConfigService,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  // ── reads ────────────────────────────────────────────────────────────────────────────

  async list(ctx: RequestContext): Promise<SalesDealListDto> {
    const rows = await this.prisma.client.packageChangeRequest.findMany({
      where: { kind: DEAL_KIND, ...(canSeeAllDeals(ctx) ? {} : { salesUserId: ctx.userId }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: DEAL_SELECT,
    });
    return { items: await this.toViews(rows) };
  }

  async get(ctx: RequestContext, dealId: string): Promise<SalesDealView> {
    const row = await this.requireDeal(ctx, dealId);
    const [view] = await this.toViews([row]);
    return view!;
  }

  /**
   * Q6/S30 — the console's only notification surface. Everything here is derived from the deal
   * rows themselves; no notification table, no trigger keys, nothing to keep in sync.
   */
  async myWork(ctx: RequestContext): Promise<SalesMyWorkDto> {
    const lead = canSeeAllDeals(ctx);
    const admin = isSystemAdmin(ctx);
    const rows = await this.prisma.client.packageChangeRequest.findMany({
      where: {
        kind: DEAL_KIND,
        OR: [
          ...(lead ? [{ status: 'PENDING_APPROVAL' }] : []),
          // Q9: only the Owner can confirm a transfer, so only the Owner is shown the queue.
          ...(admin ? [{ paymentState: 'SLIP_PENDING' }] : []),
          { salesUserId: ctx.userId, status: { in: ['REJECTED', 'APPROVED', 'APPLIED'] } },
          { salesUserId: ctx.userId, status: 'CANCELLED', paymentState: 'CATALOG_SUPERSEDED' },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: DEAL_SELECT,
    });
    const views = await this.toViews(rows);

    const items: SalesMyWorkItem[] = views.map((deal, index) => ({
      kind: workKind(deal, { own: deal.salesUserId === ctx.userId, lead, paymentState: rows[index]!.paymentState }),
      deal,
      at: deal.updatedAt,
    }));
    // The lead's queue comes first, then their own deals (spec Q6).
    items.sort((a, b) => Number(b.kind === 'APPROVAL_PENDING') - Number(a.kind === 'APPROVAL_PENDING'));
    const badge = items.filter((item) => item.kind === 'DEAL_SLIP_PENDING'
      ? admin
      : lead
        ? item.kind === 'APPROVAL_PENDING'
        // D3: a renewal sitting with the lead is the agent's own work item, not something to act on.
        : item.kind === 'DEAL_REJECTED' || item.kind === 'DEAL_EXPIRED').length;
    return { items, badge };
  }

  // ── writes ───────────────────────────────────────────────────────────────────────────

  async save(ctx: RequestContext, body: SalesDealSaveBody, dealId?: string): Promise<SalesDealView> {
    const snapshot = this.snapshot(body);
    const internalReason = this.reason(body.internalReason);
    // Proves the company exists and is one this console may write a deal against (Q4/Q5: any
    // shop, locked or paying — the warnings are the form's job, not a refusal here).
    await this.companies.one(body.companyId);

    if (dealId) return this.update(ctx, dealId, body, snapshot, internalReason);

    try {
      const row = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.packageChangeRequest.create({
          data: {
            companyId: body.companyId,
            requestedByUserId: ctx.userId,
            requestedTierKey: snapshot.base,
            kind: DEAL_KIND,
            status: 'DRAFT',
            salesUserId: ctx.userId,
            offerSnapshotJson: snapshot as unknown as object,
            amountSatang: snapshot.priceSatang,
            internalReason,
            version: 1,
          },
          select: DEAL_SELECT,
        });
        await this.auditDeal(tx, ctx, created, 'created');
        return created;
      });
      const [view] = await this.toViews([row]);
      return view!;
    } catch (error) {
      throw this.mapConflict(error);
    }
  }

  async submit(ctx: RequestContext, dealId: string, version: number): Promise<SalesDealView> {
    return this.transition(ctx, dealId, version, 'PENDING_APPROVAL', 'submitted', (row) => {
      if (!row.offerSnapshotJson) throw salesBadRequest('SALES_DEAL_STATE_CONFLICT', 'ดีลนี้ยังไม่มีรายละเอียด');
      return {};
    });
  }

  /**
   * R5: the approval reason is OPTIONAL — the audit row already records who approved and whether
   * it was their own deal (`selfApproved`), which is the fact an operator has to be able to see.
   * Rejecting and cancelling still require one, because there the reason is what the agent reads.
   */
  async approve(ctx: RequestContext, dealId: string, version: number, reason?: string): Promise<SalesDealView> {
    const note = (reason ?? '').trim().slice(0, SALES_DEAL_REASON_MAX);
    const view = await this.transition(ctx, dealId, version, 'APPROVED', 'approved', (row, tx) => {
      // R5: an agent can never approve. A lead or the Owner approving their OWN deal is allowed
      // by D2 (single-admin reality) but recorded, so the exception is visible rather than silent.
      if (!ctx.permissions.includes('sales.deal.approve')) {
        throw salesForbidden('SALES_DEAL_SELF_APPROVAL', 'เฉพาะหัวหน้าทีมขายเท่านั้นที่อนุมัติดีลได้');
      }
      return this.approvalData(row, ctx, tx, note);
    });
    // After commit: a dead LINE OA must never undo an approval that already happened.
    await this.notifyOwners(view.company.companyId);
    return view;
  }

  async reject(ctx: RequestContext, dealId: string, version: number, reason: string): Promise<SalesDealView> {
    const rejectedReason = this.reason(reason);
    return this.transition(ctx, dealId, version, 'REJECTED', 'rejected', () => {
      if (!ctx.permissions.includes('sales.deal.approve')) {
        throw salesForbidden('SALES_DEAL_SELF_APPROVAL', 'เฉพาะหัวหน้าทีมขายเท่านั้นที่ปฏิเสธดีลได้');
      }
      return { rejectedReason };
    });
  }

  async cancel(ctx: RequestContext, dealId: string, version: number, reason: string): Promise<SalesDealView> {
    const cancelReason = this.reason(reason);
    return this.transition(ctx, dealId, version, 'CANCELLED', 'cancelled', () => ({ rejectedReason: cancelReason }));
  }

  /**
   * S17 daily sweep. Idempotent by its own WHERE clause: only rows still sitting at APPROVED past
   * their window are touched, so a double run closes nothing twice.
   *
   * Phase 3 will add "skip rows with an open Checkout attempt" here.
   */
  async expireSweep(now = new Date()): Promise<{ expired: number }> {
    const due = await this.prisma.client.packageChangeRequest.findMany({
      // Q9: a customer who has attached a slip has answered the offer. The window is frozen until
      // the Owner verifies or rejects it — a reject extends `offerExpiresAt` by the review time.
      where: { kind: DEAL_KIND, status: 'APPROVED', offerExpiresAt: { lt: now }, paymentState: { not: 'SLIP_PENDING' } },
      select: { id: true, companyId: true, version: true, salesUserId: true },
      take: 500,
    });
    // S46: a Checkout opened inside the window is still honoured — a customer staring at a QR code
    // must not have the offer closed underneath them. The attempt resolves the row instead.
    const live = due.length === 0 ? [] : await this.prisma.client.billingAttempt.findMany({
      where: { dealRequestId: { in: due.map((deal) => deal.id) }, status: { notIn: ['COMPLETED', 'FAILED', 'EXPIRED'] } },
      select: { dealRequestId: true },
    });
    const paying = new Set(live.map((attempt) => attempt.dealRequestId));
    let expired = 0;
    for (const deal of due) {
      if (paying.has(deal.id)) continue;
      const written = await this.prisma.client.packageChangeRequest.updateMany({
        where: { id: deal.id, status: 'APPROVED', version: deal.version },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
      if (written.count === 0) continue;
      expired += 1;
      await this.audit.log({
        actorType: 'SYSTEM', actorRefId: 'sales-deal-expire-sweep', companyId: deal.companyId,
        action: 'sales.deal.expired', targetType: 'PackageChangeRequest', targetId: deal.id,
        requestId: `sales-expire-${deal.id}`, result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: { salesUserId: deal.salesUserId },
      });
    }
    return { expired };
  }

  // ── internals ────────────────────────────────────────────────────────────────────────

  private snapshot(body: SalesDealSaveBody): SalesDealSnapshot {
    try {
      return buildDealSnapshot(body);
    } catch (error) {
      if (error instanceof SalesSnapshotError) {
        throw salesBadRequest('SALES_DEAL_STATE_CONFLICT', dealFieldMessageTh(error.message));
      }
      throw error;
    }
  }

  private reason(raw: unknown): string {
    try {
      return requireReason(raw);
    } catch (error) {
      if (error instanceof SalesSnapshotError) {
        throw salesBadRequest('SALES_DEAL_STATE_CONFLICT', 'ต้องระบุเหตุผล (ไม่เกิน 500 ตัวอักษร)');
      }
      throw error;
    }
  }

  private async update(
    ctx: RequestContext, dealId: string, body: SalesDealSaveBody,
    snapshot: SalesDealSnapshot, internalReason: string,
  ): Promise<SalesDealView> {
    const current = await this.requireDeal(ctx, dealId);
    if (!EDITABLE_DEAL_STATUSES.includes(current.status as SalesDealStatus)) {
      throw salesError('SALES_DEAL_STATE_CONFLICT', 'ดีลที่อนุมัติแล้วแก้ไขไม่ได้ ให้ยกเลิกแล้วออกใหม่');
    }
    if (current.companyId !== body.companyId) {
      throw salesError('SALES_DEAL_STATE_CONFLICT', 'เปลี่ยนร้านของดีลที่สร้างแล้วไม่ได้');
    }
    const row = await this.prisma.client.$transaction(async (tx) => {
      const written = await tx.packageChangeRequest.updateMany({
        where: { id: dealId, version: body.version ?? current.version, status: current.status },
        data: {
          requestedTierKey: snapshot.base,
          offerSnapshotJson: snapshot as unknown as object,
          amountSatang: snapshot.priceSatang,
          internalReason,
          // R4: saving a rejected deal puts it back in DRAFT and clears the stale reason.
          status: 'DRAFT',
          rejectedReason: null,
          version: { increment: 1 },
        },
      });
      if (written.count === 0) throw this.stateConflict();
      const updated = await tx.packageChangeRequest.findUniqueOrThrow({ where: { id: dealId }, select: DEAL_SELECT });
      await this.auditDeal(tx, ctx, updated, 'created');
      return updated;
    }).catch((error: unknown) => { throw this.mapConflict(error); });
    const [view] = await this.toViews([row]);
    return view!;
  }

  private async transition(
    ctx: RequestContext,
    dealId: string,
    version: number,
    to: SalesDealStatus,
    action: 'submitted' | 'approved' | 'rejected' | 'cancelled',
    extra: (row: DealRow, tx: PrismaTx) => Promise<Record<string, unknown>> | Record<string, unknown>,
  ): Promise<SalesDealView> {
    const current = await this.requireDeal(ctx, dealId);
    const from = derivedDealStatus(current, new Date());
    // A window that closed while the page was open is its own answer — "approve" on an expired
    // offer must say so rather than report a generic state conflict.
    if (from === 'EXPIRED' && current.status === 'APPROVED') {
      throw salesError('SALES_DEAL_EXPIRED', 'ข้อเสนอนี้หมดอายุแล้ว ให้ออกข้อเสนอใหม่');
    }
    if (!canTransitionDeal(from, to)) throw this.stateConflict();

    const row = await this.prisma.client.$transaction(async (tx) => {
      const data = await extra(current, tx);
      const written = await tx.packageChangeRequest.updateMany({
        // The CAS carries the status too: two leads clicking approve at once must not both win.
        where: { id: dealId, version, status: current.status },
        data: { ...data, status: to, version: { increment: 1 } },
      });
      if (written.count === 0) throw this.stateConflict();
      const updated = await tx.packageChangeRequest.findUniqueOrThrow({ where: { id: dealId }, select: DEAL_SELECT });
      await this.auditDeal(tx, ctx, updated, action);
      return updated;
    }).catch((error: unknown) => { throw this.mapConflict(error); });

    const [view] = await this.toViews([row]);
    return view!;
  }

  /** S18: approving is the moment the offer becomes real, so the customer-lane check lands here. */
  private async approvalData(
    row: DealRow, ctx: RequestContext, tx: PrismaTx, note: string,
  ): Promise<Record<string, unknown>> {
    const openCustomerRequest = await tx.packageChangeRequest.findFirst({
      where: { companyId: row.companyId, kind: CUSTOMER_REQUEST_KIND, status: 'OPEN' },
      select: { id: true },
    });
    if (openCustomerRequest) {
      throw salesError(
        'SALES_COMPANY_HAS_OPEN_REQUEST',
        'ร้านนี้มีคำขอเปลี่ยนแพ็กเกจของลูกค้าค้างอยู่ ให้ปิดคำขอนั้นก่อนอนุมัติดีล',
      );
    }
    const approvedAt = new Date();
    return {
      approvedByUserId: ctx.userId,
      approvedAt,
      offerExpiresAt: offerExpiryFrom(approvedAt),
      // D2: recorded, never refused. The audit row carries the same flag.
      selfApproved: row.salesUserId === ctx.userId,
      // An empty approval note leaves the agent's own internalReason intact rather than blanking it.
      ...(note ? { internalReason: note } : {}),
    };
  }

  private stateConflict() {
    return salesError('SALES_DEAL_STATE_CONFLICT', 'ดีลนี้ถูกแก้ไขไปแล้ว โหลดหน้าใหม่แล้วลองอีกครั้ง');
  }

  private mapConflict(error: unknown): unknown {
    if (isDealConflict(error)) {
      return salesError('SALES_DEAL_ALREADY_OPEN', 'ร้านนี้มีดีลที่ยังไม่จบอยู่แล้ว หนึ่งร้านมีได้หนึ่งดีล');
    }
    return error;
  }

  private async requireDeal(ctx: RequestContext, dealId: string): Promise<DealRow> {
    const row = await this.prisma.client.packageChangeRequest.findFirst({
      where: { id: dealId, kind: DEAL_KIND },
      select: DEAL_SELECT,
    });
    if (!row) throw salesNotFound('SALES_COMPANY_NOT_FOUND', 'ไม่พบดีลนี้');
    // R11: an agent may not read another agent's deal — answered as "not found" so the console
    // cannot be used to enumerate the team's pipeline.
    if (!canSeeAllDeals(ctx) && row.salesUserId !== ctx.userId) {
      throw salesNotFound('SALES_COMPANY_NOT_FOUND', 'ไม่พบดีลนี้');
    }
    return row;
  }

  private async auditDeal(
    tx: PrismaTx, ctx: RequestContext, row: DealRow,
    action: 'created' | 'submitted' | 'approved' | 'rejected' | 'cancelled',
  ): Promise<void> {
    // In-transaction audit: a deal transition that cannot be recorded is rolled back (R5 asks for
    // audit on EVERY transition, so a best-effort write would not satisfy it).
    // metadataJson carries no customer PII and no agent PII — ids, money and status only (S24/S10).
    await this.audit.log({
      actorUserId: ctx.userId,
      companyId: row.companyId,
      action: `sales.deal.${action}`,
      targetType: 'PackageChangeRequest',
      targetId: row.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'CRITICAL',
      metadataJson: {
        status: row.status, version: row.version, salesUserId: row.salesUserId,
        amountSatang: row.amountSatang, selfApproved: row.selfApproved,
        ...(row.approvedByUserId ? { approvedByUserId: row.approvedByUserId } : {}),
      },
    }, tx);
  }

  /**
   * S19: the shop's OWNERs learn an offer exists — and nothing more. No price, no tier, no months.
   * Prices never travel over LINE (R14), so the message is a pointer to the package page.
   */
  private async notifyOwners(companyId: string): Promise<void> {
    const credentials = await this.lineCredentials.get().catch(() => null);
    const token = credentials?.accessToken;
    if (!token || !credentials?.channelId) return;
    const text = salesOfferNoticeText(this.config.webBaseUrl, companyId);
    for (const providerUserId of await ownerLineUserIds(this.prisma, companyId, credentials.channelId)) {
      if (!await pushSystemLineMessage(token, providerUserId, text)) {
        this.logger.warn({ event: 'sales.deal.offer_notice_failed', riskLevel: 'LOW' }, 'sales.deal.offer_notice_failed');
      }
    }
  }

  private async toViews(rows: readonly DealRow[]): Promise<SalesDealView[]> {
    if (rows.length === 0) return [];
    const now = new Date();
    const userIds = [...new Set(rows.flatMap((row) => [row.salesUserId, row.approvedByUserId]).filter((id): id is string => Boolean(id)))];
    const companyIds = [...new Set(rows.map((row) => row.companyId))];
    const [users, companies, subscriptions] = await Promise.all([
      userIds.length
        ? this.prisma.client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } })
        : Promise.resolve([]),
      Promise.all(companyIds.map(async (companyId) => ({
        companyId,
        item: await this.companies.one(companyId),
        usage: await this.companies.usage(companyId),
      }))),
      // Q7/§19.3: paying this deal cancels a live auto-renewing subscription. The form shows it so
      // the agent can net the remaining value off the price themselves — the system prorates nothing.
      this.prisma.client.billingAccount.findMany({
        where: { companyId: { in: companyIds }, baseSubscriptionId: { not: null }, paidThrough: { gt: now } },
        select: { companyId: true, renewalMode: true },
      }),
    ]);
    const nameByUserId = new Map(users.map((user) => [user.id, user.displayName]));
    const companyById = new Map(companies.map((entry) => [entry.companyId, entry]));
    const subscriptionByCompany = new Map(subscriptions.map((account) => [account.companyId, account.renewalMode]));

    return rows.map((row): SalesDealView => {
      const snapshot = row.offerSnapshotJson as SalesDealSnapshot;
      const company = companyById.get(row.companyId)!;
      return {
        id: row.id,
        status: derivedDealStatus(row, now),
        version: row.version,
        company: { ...company.item, branchCount: company.usage.branchCount, employeeCount: company.usage.employeeCount },
        salesUserId: row.salesUserId ?? '',
        salesDisplayName: nameByUserId.get(row.salesUserId ?? '') ?? '',
        snapshot,
        internalReason: row.internalReason ?? '',
        catalogPriceSatang: catalogPriceFor(snapshot),
        overLimit: overLimitCounts(snapshot, company.usage),
        approvedByUserId: row.approvedByUserId,
        approvedByDisplayName: row.approvedByUserId ? nameByUserId.get(row.approvedByUserId) ?? null : null,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        selfApproved: row.selfApproved,
        // Phase 3 writes both at apply: `verifiedAt` is Stripe's payment instant, `decidedAt` the
        // moment the term opened. `decidedAt` also carries reject/cancel, so it is only an apply
        // date on an APPLIED row.
        paidAt: row.verifiedAt?.toISOString() ?? null,
        appliedAt: row.status === 'APPLIED' ? row.decidedAt?.toISOString() ?? null : null,
        offerExpiresAt: row.offerExpiresAt?.toISOString() ?? null,
        rejectedReason: row.rejectedReason,
        renewalOfRequestId: row.renewalOfRequestId,
        slipState: dealSlipState(row.paymentState, row.slipSubmittedAt),
        conversionOf: conversionMode(subscriptionByCompany.get(row.companyId)),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }
}

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

/**
 * The list price of the deal's base tier for the same number of months, for the form's
 * "สูงกว่าราคา catalog" warning only — never a quote.
 *
 * ponytail: reads the code catalog, not the stored BillingPolicy. If the Owner ever sets
 * `offerTerms`, this threshold drifts from the real catalog price; the upgrade path is to pass the
 * active policy into `billingOffer`. Every other caller in the repo reads it the same way.
 */
function catalogPriceFor(snapshot: SalesDealSnapshot | null): number {
  if (!snapshot) return 0;
  return billingOffer(snapshot.base as SalesDealBaseTier, 'month').priceSatang * snapshot.months;
}

export function workKind(deal: Pick<SalesDealView, 'status' | 'renewalOfRequestId'>,
  viewer: { own: boolean; lead: boolean; paymentState: string }): SalesMyWorkKind {
  const { own, lead, paymentState } = viewer;
  // A slip waiting for the Owner outranks everything: the customer has already paid.
  if (paymentState === 'SLIP_PENDING') return 'DEAL_SLIP_PENDING';
  // D3: an agent sees their own renewal as "รออนุมัติ"; a lead sees the same row as their queue,
  // because a lead may approve it (D2) and the badge counts what the viewer can act on.
  if (deal.status === 'PENDING_APPROVAL') return deal.renewalOfRequestId && own && !lead ? 'DEAL_RENEWAL_PENDING' : 'APPROVAL_PENDING';
  if (deal.status === 'CANCELLED' && paymentState === 'CATALOG_SUPERSEDED') return 'DEAL_SUPERSEDED';
  if (deal.status === 'REJECTED' && own) return 'DEAL_REJECTED';
  if (deal.status === 'EXPIRED' && own) return 'DEAL_EXPIRED';
  if (deal.status === 'APPLIED') return 'DEAL_APPLIED';
  return 'DEAL_APPROVED_WAITING';
}

function conversionMode(renewalMode: string | undefined): 'CARD_AUTO' | 'PROMPTPAY_RENEW' | null {
  return renewalMode === 'CARD_AUTO' || renewalMode === 'PROMPTPAY_RENEW' ? renewalMode : null;
}

function dealFieldMessageTh(field: string): string {
  switch (field) {
    case 'base': return 'เลือกแพ็กเกจฐานของดีล';
    case 'priceSatang': return 'ราคาต้องเป็นจำนวนเต็มอย่างน้อย 1 สตางค์';
    case 'months': return 'จำนวนเดือนต้องอยู่ระหว่าง 1 ถึง 36';
    case 'description': return 'โน้ตถึงลูกค้าต้องไม่ว่างและไม่เกิน 200 ตัวอักษร';
    case 'description_plus': return 'โน้ตถึงลูกค้าห้ามใช้เครื่องหมาย + ให้เขียนว่า "และ"';
    // "เครดิต AI" is the product term (W-01); never the retired AI-money wording.
    case 'aiMonthlyBudgetSatang': return 'เครดิต AI ต่อเดือนต้องเป็นจำนวนเต็มตั้งแต่ 1 สตางค์ขึ้นไป หรือเว้นว่างเพื่อใช้ค่าเริ่มต้น (ปิด AI = เอาเมนู AI ออก)';
    case 'featureKeys': return 'รายการเมนูไม่ถูกต้อง';
    default: return 'ข้อมูลดีลไม่ถูกต้อง';
  }
}

export { SALES_DEAL_OPEN_STATUSES };
