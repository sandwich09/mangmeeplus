/**
 * Sales-event discounts, console side (docs/specs/sales-event-discounts-spec-th.md §3.1, §3.2, §6.2,
 * §7.1, §9): batches, who may hand them out, their QR, the ticket list and revocation.
 *
 * Scope follows the role, like the rest of the console: SYSTEM_ADMIN sees and manages everything; a
 * หัวหน้าทีม sees the batches they created plus those their team hands out, and manages only their
 * own; a เซลล์ sees the batches they were assigned and only the tickets they handed out. No switch:
 * a discount exists only because someone with `sales.event.manage` created the batch (SD-O10).
 *
 * The claim that turns a QR into a ticket is SD-B's (`sales-event-claim.logic.ts` is shared so the
 * token this service issues is the one the claim finds). Nothing here reads a LINE identity back out.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  billingOfferLabel,
  SALES_EVENT_PAGE_SIZE,
  type SalesEventAgentSearch,
  type SalesEventBatchInput,
  type SalesEventBatchList,
  type SalesEventBatchStateBody,
  type SalesEventBatchUpdate,
  type SalesEventBatchView,
  type SalesEventQr,
  type SalesEventRedeemPath,
  type SalesEventTicketList,
  type SalesEventTicketRevokeBody,
  type SalesEventTicketView,
} from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/models/audit-action';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { BillingService } from '../../billing/application/billing.service';
import { qrSvgDataUrl } from '../../employee-access/domain/logic/employee-access.logic';
import {
  newSalesEventQrToken,
  salesEventQrLink,
  salesEventTicketDisplayState,
} from '../domain/sales-event-claim.logic';
import {
  batchActionReason, batchClaimOpen, firstOfferBelowMinimum, nextBatchState, scopeFromJson,
  SalesEventRuleError, ticketCounts, validateSalesEventBatch, type SalesEventBatchValues,
} from '../domain/sales-event.logic';
import {
  isSystemAdmin, PLATFORM_TENANT_ID, SALES_LEAD_ROLE,
  salesBadRequest, salesError, salesForbidden, salesNotFound,
} from './sales-context';

const BATCH_SELECT = {
  id: true, eventName: true, batchName: true, discountSatang: true, rewardChatCreditUnits: true,
  rewardReceiptImageUnits: true, issueCap: true, issuedCount: true, claimStartsAt: true, claimEndsAt: true,
  scopeJson: true, state: true, revision: true, version: true, createdByUserId: true, createdAt: true, updatedAt: true,
  agents: { select: { salesUserId: true, active: true }, orderBy: { addedAt: 'asc' } },
} as const satisfies Prisma.SalesEventBatchSelect;
type BatchRow = Prisma.SalesEventBatchGetPayload<{ select: typeof BATCH_SELECT }>;

/** Ticket columns the console may read: never the holder's LINE identity, never a billing id. */
const TICKET_SELECT = {
  id: true, serial: true, state: true, redeemedAs: true, salesUserId: true, discountSatang: true,
  rewardChatCreditUnits: true, rewardReceiptImageUnits: true, expiresAt: true, createdAt: true,
  usedAt: true, revokedAt: true, revokeReason: true, version: true,
} as const satisfies Prisma.SalesEventTicketSelect;
type TicketRow = Prisma.SalesEventTicketGetPayload<{ select: typeof TICKET_SELECT }>;

type Role = 'ADMIN' | 'LEAD' | 'AGENT';

function roleOf(ctx: RequestContext): Role {
  if (isSystemAdmin(ctx)) return 'ADMIN';
  return ctx.roles.includes(SALES_LEAD_ROLE) ? 'LEAD' : 'AGENT';
}

function staleBatch(): never {
  throw salesError('SALES_EVENT_BATCH_STALE', 'ข้อมูลชุดส่วนลดเปลี่ยนไปแล้ว กรุณาโหลดใหม่');
}

function notFound(): never {
  throw salesNotFound('SALES_EVENT_NOT_FOUND', 'ไม่พบชุดส่วนลดหรือรายการส่วนลดนี้');
}

/** A rule the lead broke becomes a 400 carrying its code (and, for the minimum, which package). */
function rule<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SalesEventRuleError) {
      throw new BadRequestException({ code: error.code, message: error.message, ...error.details });
    }
    throw error;
  }
}

/** Keyset page: one extra row says whether there is a next page, and its predecessor is the cursor. */
function page<T extends { id: string }>(rows: T[]): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, SALES_EVENT_PAGE_SIZE);
  return { items, nextCursor: rows.length > SALES_EVENT_PAGE_SIZE ? items[items.length - 1]!.id : null };
}

function cursorArgs(cursor: string | undefined): { cursor?: { id: string }; skip?: number } {
  const id = cursor?.trim();
  return id ? { cursor: { id }, skip: 1 } : {};
}

function batchColumns(values: SalesEventBatchValues) {
  return {
    eventName: values.eventName, batchName: values.batchName, discountSatang: values.discountSatang,
    rewardChatCreditUnits: values.rewardChatCreditUnits, rewardReceiptImageUnits: values.rewardReceiptImageUnits,
    issueCap: values.issueCap, claimStartsAt: values.claimStartsAt, claimEndsAt: values.claimEndsAt,
    scopeJson: values.scope as unknown as Prisma.InputJsonValue,
  };
}

/** What the audit row records for one revision — the values, never who holds a ticket. */
function auditValues(values: Pick<SalesEventBatchValues, 'eventName' | 'batchName' | 'discountSatang' | 'rewardChatCreditUnits'
  | 'rewardReceiptImageUnits' | 'issueCap' | 'claimStartsAt' | 'claimEndsAt' | 'scope'>) {
  return {
    eventName: values.eventName, batchName: values.batchName, discountSatang: values.discountSatang,
    rewardChatCreditUnits: values.rewardChatCreditUnits, rewardReceiptImageUnits: values.rewardReceiptImageUnits,
    issueCap: values.issueCap, claimStartsAt: values.claimStartsAt.toISOString(), claimEndsAt: values.claimEndsAt.toISOString(),
    scope: values.scope,
  };
}

@Injectable()
export class SalesEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly billing: BillingService,
  ) {}

  async list(ctx: RequestContext, cursor?: string): Promise<SalesEventBatchList> {
    const rows = await this.prisma.client.salesEventBatch.findMany({
      where: await this.visibleWhere(ctx),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SALES_EVENT_PAGE_SIZE + 1,
      ...cursorArgs(cursor),
      select: BATCH_SELECT,
    });
    const { items, nextCursor } = page(rows);
    return { items: await this.toViews(ctx, items), nextCursor };
  }

  async get(ctx: RequestContext, batchId: string): Promise<SalesEventBatchView> {
    const [view] = await this.toViews(ctx, [await this.visibleBatch(ctx, batchId)]);
    return view!;
  }

  async create(ctx: RequestContext, input: SalesEventBatchInput): Promise<SalesEventBatchView> {
    const values = rule(() => validateSalesEventBatch(input, new Date()));
    await this.assertAboveMinimum(values);
    await this.assertAssignable(ctx, values.agentUserIds);
    const id = await this.prisma.client.$transaction(async (tx) => {
      // "ยืนยันและเปิดแจกส่วนลด": there is no server-side draft, so the batch is OPEN from birth.
      const row = await tx.salesEventBatch.create({
        data: {
          ...batchColumns(values), state: 'OPEN', createdByUserId: ctx.userId,
          agents: { create: values.agentUserIds.map((salesUserId) => ({ salesUserId, addedByUserId: ctx.userId })) },
        },
        select: { id: true },
      });
      await this.audit.log({
        actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID, action: AuditAction.SALES_EVENT_BATCH_CREATE,
        targetType: 'SalesEventBatch', targetId: row.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { ...auditValues(values), agentUserIds: values.agentUserIds },
      }, tx);
      return row.id;
    });
    return this.get(ctx, id);
  }

  /**
   * "บันทึกการเปลี่ยนแปลง": a new revision. Tickets already handed out keep what they were issued with
   * (spec §6.2); a เซลล์ taken off the batch keeps their tickets but their QR stops at once.
   */
  async update(ctx: RequestContext, batchId: string, input: SalesEventBatchUpdate): Promise<SalesEventBatchView> {
    const current = await this.manageableBatch(ctx, batchId);
    if (current.version !== input.expectedVersion) staleBatch();
    const now = new Date();
    const values = rule(() => validateSalesEventBatch(input, now, current));
    await this.assertAboveMinimum(values);
    const active = new Set(current.agents.filter((agent) => agent.active).map((agent) => agent.salesUserId));
    const added = values.agentUserIds.filter((userId) => !active.has(userId));
    const removed = [...active].filter((userId) => !values.agentUserIds.includes(userId));
    await this.assertAssignable(ctx, added);

    await this.prisma.client.$transaction(async (tx) => {
      // The issued-count guard sits in the WHERE because a claim may land between the read above and
      // this write; claims never bump `version`, so the version alone cannot see it.
      const written = await tx.salesEventBatch.updateMany({
        where: { id: batchId, version: input.expectedVersion, issuedCount: { lte: values.issueCap } },
        data: { ...batchColumns(values), revision: { increment: 1 }, version: { increment: 1 } },
      });
      if (written.count === 0) {
        const fresh = await tx.salesEventBatch.findUnique({ where: { id: batchId }, select: { version: true, issuedCount: true } });
        if (!fresh || fresh.version !== input.expectedVersion) staleBatch();
        throw salesBadRequest('SALES_EVENT_BATCH_INVALID', `จำนวนแจกสูงสุดต้องไม่น้อยกว่าที่แจกไปแล้ว ${fresh.issuedCount} รายการ`);
      }
      if (removed.length > 0) {
        await tx.salesEventBatchAgent.updateMany({
          where: { batchId, salesUserId: { in: removed }, active: true },
          data: { active: false, removedAt: now },
        });
      }
      for (const salesUserId of added) {
        await tx.salesEventBatchAgent.upsert({
          where: { batchId_salesUserId: { batchId, salesUserId } },
          create: { batchId, salesUserId, addedByUserId: ctx.userId, addedAt: now },
          update: { active: true, removedAt: null, addedByUserId: ctx.userId, addedAt: now },
        });
      }
      await this.audit.log({
        actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID, action: AuditAction.SALES_EVENT_BATCH_UPDATE,
        targetType: 'SalesEventBatch', targetId: batchId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          revision: current.revision + 1,
          before: auditValues({ ...current, scope: scopeFromJson(current.scopeJson) }),
          after: auditValues(values),
          agentsAdded: added, agentsRemoved: removed,
        },
      }, tx);
    });
    return this.get(ctx, batchId);
  }

  /** "พักแจก" / "เปิดแจกต่อ" / "ระงับการใช้" / "ยกเลิกการระงับ" (spec §6.2). */
  async changeState(ctx: RequestContext, batchId: string, body: SalesEventBatchStateBody): Promise<SalesEventBatchView> {
    const current = await this.manageableBatch(ctx, batchId);
    const next = nextBatchState(current.state, body.action);
    // An action the batch's state does not offer means the screen that sent it is out of date.
    if (!next || current.version !== body.expectedVersion) staleBatch();
    const reason = rule(() => batchActionReason(body.action, body.reason));
    await this.prisma.client.$transaction(async (tx) => {
      const written = await tx.salesEventBatch.updateMany({
        where: { id: batchId, version: body.expectedVersion, state: current.state },
        data: { state: next, version: { increment: 1 } },
      });
      if (written.count === 0) staleBatch();
      await this.audit.log({
        actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID, action: AuditAction.SALES_EVENT_BATCH_STATE_CHANGE,
        targetType: 'SalesEventBatch', targetId: batchId, requestId: ctx.requestId, result: 'SUCCESS',
        riskLevel: body.action === 'SUSPEND' || body.action === 'LIFT' ? 'HIGH' : 'MEDIUM',
        metadataJson: { action: body.action, from: current.state, to: next, reason },
      }, tx);
    });
    return this.get(ctx, batchId);
  }

  /**
   * The เซลล์ a batch may be handed to: a lead's own team (and the lead), or everyone for SYSTEM_ADMIN.
   * ACTIVE profiles only, searched by name, username or sales code.
   */
  async searchAgents(ctx: RequestContext, q?: string, cursor?: string): Promise<SalesEventAgentSearch> {
    const term = (q ?? '').trim().slice(0, 120);
    const profiles = await this.prisma.client.salesAgentProfile.findMany({
      where: { status: 'ACTIVE', ...this.teamWhere(ctx) },
      select: { userId: true, salesCode: true },
    });
    const codeByUser = new Map(profiles.map((profile) => [profile.userId, profile.salesCode]));
    const codeMatches = term ? profiles.filter((profile) => profile.salesCode.includes(term.toUpperCase())).map((profile) => profile.userId) : [];
    const users = await this.prisma.client.user.findMany({
      where: {
        id: { in: [...codeByUser.keys()] }, status: 'ACTIVE',
        ...(term ? { OR: [
          { displayName: { contains: term, mode: 'insensitive' } },
          { username: { contains: term, mode: 'insensitive' } },
          { id: { in: codeMatches } },
        ] } : {}),
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: SALES_EVENT_PAGE_SIZE + 1,
      ...cursorArgs(cursor),
      select: { id: true, displayName: true },
    });
    const { items, nextCursor } = page(users);
    return {
      items: items.map((user) => ({ userId: user.id, displayName: user.displayName ?? '', salesCode: codeByUser.get(user.id) ?? '' })),
      nextCursor,
    };
  }

  /**
   * "แสดง QR" (spec §3.2): a fresh token each press. Only an active distributor of a batch that is
   * open right now gets one. The raw token exists only in the image. Owner 2026-09-29 (SD-O11): the QR
   * has no clock of its own — it may be printed or put on a screen, and it keeps working while the
   * batch is OPEN inside its claim window and this เซลล์ stays an active distributor. The stored
   * `expiresAt` records the claim end at issue; the claim judges the batch as it is at scan time.
   */
  async issueQr(ctx: RequestContext, batchId: string, apiBaseUrl: string): Promise<SalesEventQr> {
    const now = new Date();
    const [batch, assignment, profile] = await Promise.all([
      this.prisma.client.salesEventBatch.findUnique({
        where: { id: batchId },
        select: { id: true, state: true, claimStartsAt: true, claimEndsAt: true, issueCap: true, issuedCount: true, revision: true },
      }),
      this.prisma.client.salesEventBatchAgent.findUnique({
        where: { batchId_salesUserId: { batchId, salesUserId: ctx.userId } }, select: { active: true },
      }),
      this.prisma.client.salesAgentProfile.findUnique({ where: { userId: ctx.userId }, select: { status: true } }),
    ]);
    if (!batch) notFound();
    if (!assignment?.active || profile?.status !== 'ACTIVE') {
      throw salesForbidden('SALES_EVENT_AGENT_INACTIVE', 'คุณไม่ได้เป็นผู้แจกของชุดนี้');
    }
    if (!batchClaimOpen(batch, now)) throw salesError('SALES_EVENT_CLAIM_CLOSED', 'ชุดนี้ไม่ได้เปิดแจกอยู่ตอนนี้');
    if (batch.issuedCount >= batch.issueCap) throw salesError('SALES_EVENT_ISSUE_FULL', 'ส่วนลดของชุดนี้ถูกแจกครบแล้ว');

    const { rawToken, tokenHash } = newSalesEventQrToken();
    const expiresAt = batch.claimEndsAt;
    await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.salesEventQrToken.create({
        data: { tokenHash, batchId, salesUserId: ctx.userId, batchRevision: batch.revision, expiresAt },
        select: { id: true },
      });
      // `qrId`, not a key with "token" in it: the audit sanitizer would redact that, and there is
      // nothing secret here anyway — the hash stays in its own table.
      await this.audit.log({
        actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID, action: AuditAction.SALES_EVENT_QR_ISSUE,
        targetType: 'SalesEventBatch', targetId: batchId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { qrId: row.id, batchRevision: batch.revision, expiresAt: expiresAt.toISOString() },
      }, tx);
    });
    return {
      qrImageUrl: qrSvgDataUrl(salesEventQrLink(apiBaseUrl, rawToken, this.config.lineLiffId)),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Newest first. A เซลล์ sees only what they handed out; nobody sees who holds a ticket. */
  async tickets(ctx: RequestContext, batchId: string, cursor?: string): Promise<SalesEventTicketList> {
    await this.visibleBatch(ctx, batchId);
    const rows = await this.prisma.client.salesEventTicket.findMany({
      where: { batchId, ...(roleOf(ctx) === 'AGENT' ? { salesUserId: ctx.userId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SALES_EVENT_PAGE_SIZE + 1,
      ...cursorArgs(cursor),
      select: TICKET_SELECT,
    });
    const { items, nextCursor } = page(rows);
    const names = await this.displayNames(items.map((ticket) => ticket.salesUserId));
    const now = new Date();
    return { items: items.map((ticket) => this.toTicketView(ticket, names, now)), nextCursor };
  }

  /** "เพิกถอน": ISSUED only (spec §6.3). The cap is not given back — it counts the batch's whole life. */
  async revoke(ctx: RequestContext, ticketId: string, body: SalesEventTicketRevokeBody): Promise<SalesEventTicketView> {
    const ticket = await this.prisma.client.salesEventTicket.findUnique({ where: { id: ticketId }, select: { batchId: true } });
    if (!ticket) notFound();
    await this.manageableBatch(ctx, ticket.batchId);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw salesBadRequest('SALES_EVENT_BATCH_INVALID', 'ต้องระบุเหตุผลที่เพิกถอน');
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      const written = await tx.salesEventTicket.updateMany({
        where: { id: ticketId, state: 'ISSUED', version: body.expectedVersion },
        data: { state: 'REVOKED', revokedAt: now, revokedByUserId: ctx.userId, revokeReason: reason, version: { increment: 1 } },
      });
      if (written.count === 0) {
        const fresh = await tx.salesEventTicket.findUnique({ where: { id: ticketId }, select: { state: true } });
        if (fresh?.state !== 'ISSUED') {
          throw salesError('SALES_EVENT_TICKET_NOT_REVOCABLE', 'ส่วนลดนี้กำลังชำระหรือใช้แล้ว เพิกถอนไม่ได้');
        }
        staleBatch();
      }
      await this.audit.log({
        actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID, action: AuditAction.SALES_EVENT_TICKET_REVOKE,
        targetType: 'SalesEventTicket', targetId: ticketId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { batchId: ticket.batchId, reason },
      }, tx);
    });
    const row = await this.prisma.client.salesEventTicket.findUniqueOrThrow({ where: { id: ticketId }, select: TICKET_SELECT });
    return this.toTicketView(row, await this.displayNames([row.salesUserId]), now);
  }

  // ── internals ────────────────────────────────────────────────────────────────────────

  /** A lead's own team, the lead included; SYSTEM_ADMIN is not narrowed. */
  private teamWhere(ctx: RequestContext): Prisma.SalesAgentProfileWhereInput {
    return roleOf(ctx) === 'ADMIN' ? {} : { OR: [{ teamLeadUserId: ctx.userId }, { userId: ctx.userId }] };
  }

  private async visibleWhere(ctx: RequestContext): Promise<Prisma.SalesEventBatchWhereInput> {
    const role = roleOf(ctx);
    if (role === 'ADMIN') return {};
    if (role === 'AGENT') return { agents: { some: { salesUserId: ctx.userId } } };
    const team = await this.prisma.client.salesAgentProfile.findMany({ where: this.teamWhere(ctx), select: { userId: true } });
    const teamUserIds = [...new Set([ctx.userId, ...team.map((member) => member.userId)])];
    return { OR: [{ createdByUserId: ctx.userId }, { agents: { some: { salesUserId: { in: teamUserIds } } } }] };
  }

  private async visibleBatch(ctx: RequestContext, batchId: string): Promise<BatchRow> {
    const row = await this.prisma.client.salesEventBatch.findFirst({
      where: { AND: [{ id: batchId }, await this.visibleWhere(ctx)] }, select: BATCH_SELECT,
    });
    return row ?? notFound();
  }

  /** SYSTEM_ADMIN manages every batch; a หัวหน้าทีม only the ones they created (spec §9). */
  private async manageableBatch(ctx: RequestContext, batchId: string): Promise<BatchRow> {
    const row = await this.prisma.client.salesEventBatch.findUnique({ where: { id: batchId }, select: BATCH_SELECT });
    if (!row || !this.canManage(ctx, row)) notFound();
    return row;
  }

  private canManage(ctx: RequestContext, row: { createdByUserId: string }): boolean {
    return ctx.permissions.includes('sales.event.manage') && (roleOf(ctx) === 'ADMIN' || row.createdByUserId === ctx.userId);
  }

  /** Every เซลล์ being added must be ACTIVE and inside the caller's reach (spec §3.1, SED-18). */
  private async assertAssignable(ctx: RequestContext, userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const found = await this.prisma.client.salesAgentProfile.count({
      where: { AND: [{ userId: { in: [...userIds] }, status: 'ACTIVE' }, this.teamWhere(ctx)] },
    });
    if (found !== userIds.length) {
      throw salesBadRequest('SALES_AGENT_NOT_FOUND', 'เลือกได้เฉพาะเซลล์ที่ยังทำงานอยู่ในทีมของคุณ');
    }
  }

  /**
   * Spec §4.5: publishing is refused when the discount would take any package/cycle in scope under ฿10
   * at TODAY's catalog price. The quote re-checks at its own price later (SD-C).
   */
  private async assertAboveMinimum(values: SalesEventBatchValues): Promise<void> {
    if (values.discountSatang === 0) return;
    const catalog = await this.billing.catalog();
    const blocked = firstOfferBelowMinimum(catalog.offers, values.scope, values.discountSatang, catalog.taxTreatment);
    if (blocked) {
      throw new BadRequestException({
        code: 'SALES_EVENT_DISCOUNT_TOO_HIGH',
        message: `ส่วนลดสูงเกินราคาของ ${billingOfferLabel(`${blocked.offerKey}:${blocked.interval}`)}`,
        offerKey: blocked.offerKey, interval: blocked.interval,
      });
    }
  }

  private async displayNames(userIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.client.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true } });
    return new Map(users.map((user) => [user.id, user.displayName ?? '']));
  }

  private async toViews(ctx: RequestContext, rows: readonly BatchRow[]): Promise<SalesEventBatchView[]> {
    if (rows.length === 0) return [];
    const now = new Date();
    const batchIds = rows.map((row) => row.id);
    // A เซลล์'s figures count only the tickets they handed out, like the ticket list itself.
    const own = roleOf(ctx) === 'AGENT' ? { salesUserId: ctx.userId } : {};
    const [names, groups, expired] = await Promise.all([
      this.displayNames(rows.flatMap((row) => [row.createdByUserId, ...row.agents.map((agent) => agent.salesUserId)])),
      this.prisma.client.salesEventTicket.groupBy({
        by: ['batchId', 'state', 'redeemedAs'], where: { batchId: { in: batchIds }, ...own }, _count: { _all: true },
      }),
      this.prisma.client.salesEventTicket.groupBy({
        by: ['batchId'], where: { batchId: { in: batchIds }, state: 'ISSUED', expiresAt: { lte: now }, ...own }, _count: { _all: true },
      }),
    ]);
    return rows.map((row): SalesEventBatchView => ({
      id: row.id, eventName: row.eventName, batchName: row.batchName,
      discountSatang: row.discountSatang, rewardChatCreditUnits: row.rewardChatCreditUnits,
      rewardReceiptImageUnits: row.rewardReceiptImageUnits,
      issueCap: row.issueCap, issuedCount: row.issuedCount,
      claimStartsAt: row.claimStartsAt.toISOString(), claimEndsAt: row.claimEndsAt.toISOString(),
      scope: scopeFromJson(row.scopeJson),
      state: row.state as SalesEventBatchView['state'],
      claimOpen: batchClaimOpen(row, now),
      revision: row.revision, version: row.version,
      createdByUserId: row.createdByUserId, createdByDisplayName: names.get(row.createdByUserId) ?? '',
      agents: row.agents.map((agent) => ({ userId: agent.salesUserId, displayName: names.get(agent.salesUserId) ?? '', active: agent.active })),
      isDistributor: row.agents.some((agent) => agent.salesUserId === ctx.userId && agent.active),
      canManage: this.canManage(ctx, row),
      counts: ticketCounts(
        groups.filter((group) => group.batchId === row.id).map((group) => ({ state: group.state, redeemedAs: group.redeemedAs, count: group._count._all })),
        expired.find((group) => group.batchId === row.id)?._count._all ?? 0,
      ),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    }));
  }

  private toTicketView(ticket: TicketRow, names: Map<string, string>, now: Date): SalesEventTicketView {
    return {
      id: ticket.id, serial: ticket.serial,
      state: salesEventTicketDisplayState(ticket, now),
      redeemedAs: ticket.redeemedAs as SalesEventRedeemPath | null,
      salesUserId: ticket.salesUserId, salesDisplayName: names.get(ticket.salesUserId) ?? '',
      discountSatang: ticket.discountSatang, rewardChatCreditUnits: ticket.rewardChatCreditUnits,
      rewardReceiptImageUnits: ticket.rewardReceiptImageUnits,
      expiresAt: ticket.expiresAt.toISOString(), issuedAt: ticket.createdAt.toISOString(),
      usedAt: ticket.usedAt?.toISOString() ?? null, revokedAt: ticket.revokedAt?.toISOString() ?? null,
      revokeReason: ticket.revokeReason, version: ticket.version,
    };
  }
}
