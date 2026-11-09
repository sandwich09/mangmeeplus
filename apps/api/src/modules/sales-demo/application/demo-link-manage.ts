import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DEMO_LINK_LIMITS, type SalesDemoLinkItem, type SalesDemoLinkUpdate } from '@watchdog-bms/contracts';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import type { AttachmentStoragePort } from '../../data-model-core/domain/ports/attachment-storage.port';
import { aiCreditLotBalances, applyAiCreditGrant, revokeAiCreditGrant } from '../../line-ai/application/ai-credit-ledger';
import { assertPlatformTenant, canSeeAllDeals } from '../../sales-console/application/sales-context';
import { purgeDemoCompany } from './demo-purge';

/** Owner 2026-11-09 (spec §11): list, edit, reset and delete demo links. Agents act on their own links. */
export class DemoLinkManager {
  constructor(private readonly db: PrismaClient, private readonly storage: AttachmentStoragePort | null) {}

  async list(ctx: RequestContext, now = new Date()): Promise<SalesDemoLinkItem[]> {
    assertPlatformTenant(ctx);
    const links = await this.db.salesDemoLink.findMany({
      where: { revokedAt: null, ...(canSeeAllDeals(ctx) ? {} : { createdByUserId: ctx.userId }) },
      orderBy: { createdAt: 'desc' }, take: 200,
      select: { id: true, createdAt: true, expiresAt: true, openedAt: true, companyId: true, aiCreditUnits: true, readLimit: true,
        createdBy: { select: { displayName: true } } },
    });
    const companyIds = links.flatMap(link => link.companyId ? [link.companyId] : []);
    const [used, reads] = companyIds.length ? await Promise.all([
      this.db.aiCreditEntry.groupBy({ by: ['companyId'], where: { companyId: { in: companyIds }, kind: 'CONSUME' }, _sum: { units: true } }),
      this.db.companyOcrUsageEvent.groupBy({ by: ['companyId'], where: { companyId: { in: companyIds } }, _count: { _all: true } }),
    ]) : [[], []];
    return links.map(link => ({
      id: link.id, createdAt: link.createdAt.toISOString(), expiresAt: link.expiresAt.toISOString(), openedAt: link.openedAt?.toISOString() ?? null,
      status: link.expiresAt <= now ? 'EXPIRED' : link.companyId ? 'OPENED' : 'WAITING',
      createdByName: link.createdBy.displayName, aiCredit: link.aiCreditUnits, readLimit: link.readLimit,
      creditUsed: link.companyId ? Math.ceil(-(used.find(row => row.companyId === link.companyId)?._sum.units ?? 0) / 100) : null,
      readsUsed: link.companyId ? reads.find(row => row.companyId === link.companyId)?._count._all ?? 0 : null,
    }));
  }

  async update(ctx: RequestContext, id: string, body: SalesDemoLinkUpdate, now = new Date()): Promise<SalesDemoLinkItem> {
    const change = validateUpdate(body, now);
    await this.db.$transaction(async tx => {
      const link = await this.lockOwned(tx, ctx, id);
      if (link.expiresAt <= now) throw new BadRequestException('ลิงก์นี้หมดอายุแล้ว แก้ไขไม่ได้ ลบลิงก์หรือสร้างลิงก์ใหม่แทน');
      await tx.salesDemoLink.update({ where: { id }, data: {
        ...(change.aiCredit !== undefined ? { aiCreditUnits: change.aiCredit } : {}),
        ...(change.readLimit !== undefined ? { readLimit: change.readLimit } : {}),
        ...(change.expiresAt ? { expiresAt: change.expiresAt } : {}),
      } });
      const companyId = link.companyId;
      if (companyId) {
        if (change.readLimit !== undefined) await tx.companyAiConfiguration.update({ where: { companyId }, data: { ocrMonthlyLimit: change.readLimit } });
        if (change.expiresAt) await tx.companyPlanTerm.update({ where: { companyId }, data: { termEndsAt: change.expiresAt } });
        if (change.aiCredit !== undefined && change.aiCredit !== link.aiCreditUnits) await resetDemoCredit(tx, companyId, id, change.aiCredit, now);
      }
      await this.audit(tx, ctx, 'sales.demo_link.update', id, {
        ...(change.aiCredit !== undefined ? { aiCredit: [link.aiCreditUnits, change.aiCredit] } : {}),
        ...(change.readLimit !== undefined ? { readLimit: [link.readLimit, change.readLimit] } : {}),
        ...(change.expiresAt ? { expiresAt: [link.expiresAt.toISOString(), change.expiresAt.toISOString()] } : {}),
      });
    }, { maxWait: 10_000, timeout: 30_000 });
    return (await this.list(ctx, now)).find(item => item.id === id)!;
  }

  /** Erase the sample shop; the link stays usable and the next opener gets a fresh shop with full credit. */
  async reset(ctx: RequestContext, id: string, now = new Date()): Promise<void> {
    const link = await this.db.$transaction(async tx => this.lockOwned(tx, ctx, id));
    if (link.expiresAt <= now) throw new BadRequestException('ลิงก์นี้หมดอายุแล้ว ล้างร้านไม่ได้ ลบลิงก์หรือสร้างลิงก์ใหม่แทน');
    if (link.companyId) await purgeDemoCompany(this.db, this.storage, link.companyId, now, true);
    await this.db.$transaction(async tx => {
      await tx.salesDemoLink.update({ where: { id }, data: { companyId: null, openedAt: null } });
      await this.audit(tx, ctx, 'sales.demo_link.reset', id, { companyId: link.companyId });
    });
  }

  /** Close the link now and erase its shop. The row stays as sales history, hidden from the list. */
  async remove(ctx: RequestContext, id: string, now = new Date()): Promise<void> {
    const link = await this.db.$transaction(async tx => {
      const owned = await this.lockOwned(tx, ctx, id);
      await tx.salesDemoLink.update({ where: { id }, data: { revokedAt: now } });
      await this.audit(tx, ctx, 'sales.demo_link.delete', id, { companyId: owned.companyId });
      return owned;
    });
    if (link.companyId) await purgeDemoCompany(this.db, this.storage, link.companyId, now, true);
  }

  private async lockOwned(tx: any, ctx: RequestContext, id: string) {
    assertPlatformTenant(ctx);
    if (typeof id !== 'string' || id.length > 64) throw new NotFoundException('ไม่พบลิงก์นี้');
    // Same per-link lock as opening the link, so an edit never races a first open.
    await tx.$queryRaw`SELECT "id" FROM "SalesDemoLink" WHERE "id" = ${id} FOR UPDATE`;
    const link = await tx.salesDemoLink.findUnique({ where: { id } });
    if (!link || link.revokedAt || (!canSeeAllDeals(ctx) && link.createdByUserId !== ctx.userId)) throw new NotFoundException('ไม่พบลิงก์นี้');
    return link as { id: string; companyId: string | null; expiresAt: Date; aiCreditUnits: number; readLimit: number };
  }

  private async audit(tx: any, ctx: RequestContext, action: string, id: string, metadataJson: object) {
    await tx.auditLog.create({ data: { actorUserId: ctx.userId, companyId: ctx.companyId, action, targetType: 'sales_demo_link', targetId: id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson } });
  }
}

export function validateUpdate(body: unknown, now: Date): { aiCredit?: number; readLimit?: number; expiresAt?: Date } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('ข้อมูลที่ส่งมาไม่ถูกต้อง ลองใหม่อีกครั้ง');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['aiCredit', 'readLimit', 'expiresAt'].includes(key) && input[key] !== undefined)) throw new BadRequestException('ข้อมูลที่ส่งมาไม่ถูกต้อง ลองใหม่อีกครั้ง');
  const whole = (value: unknown, [min, max]: readonly [number, number], message: string) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new BadRequestException(message);
    return value;
  };
  const aiCredit = whole(input.aiCredit, DEMO_LINK_LIMITS.aiCredit, 'เครดิตต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 300');
  const readLimit = whole(input.readLimit, DEMO_LINK_LIMITS.readLimit, 'จำนวนเอกสารต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 50');
  let expiresAt: Date | undefined;
  if (input.expiresAt !== undefined) {
    expiresAt = typeof input.expiresAt === 'string' ? new Date(input.expiresAt) : new Date(NaN);
    const min = now.getTime() + DEMO_LINK_LIMITS.minExpiryMinutes * 60_000, max = now.getTime() + DEMO_LINK_LIMITS.maxExpiryDays * 86_400_000;
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < min || expiresAt.getTime() > max) {
      throw new BadRequestException('เวลาหมดอายุต้องอยู่ระหว่าง 10 นาทีจากตอนนี้ ถึง 30 วันจากตอนนี้');
    }
  }
  if (aiCredit === undefined && readLimit === undefined && !expiresAt) throw new BadRequestException('ยังไม่ได้เปลี่ยนอะไร');
  return { ...(aiCredit !== undefined ? { aiCredit } : {}), ...(readLimit !== undefined ? { readLimit } : {}), ...(expiresAt ? { expiresAt } : {}) };
}

/**
 * The link's credit is the shop's total. Withdraw what is left of the live lots, then grant
 * total − used − still held (never below 0). Runs under L1 like every writer that lowers credit.
 */
async function resetDemoCredit(tx: any, companyId: string, linkId: string, total: number, now: Date): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${companyId}`}))`;
  const lots: Array<{ id: string; units: number }> = await tx.aiCreditGrant.findMany({ where: { companyId, revokedAt: null }, select: { id: true, units: true } });
  const all: Array<{ id: string }> = await tx.aiCreditGrant.findMany({ where: { companyId }, select: { id: true } });
  const consumed = await tx.aiCreditEntry.aggregate({ where: { companyId, kind: 'CONSUME' }, _sum: { units: true } });
  // With zero units a lot's balance is its settled entries plus its live holds; minus the settled sum = live holds.
  const balances = await aiCreditLotBalances(tx, companyId, all.map(lot => ({ id: lot.id, units: 0 })));
  const settled = await tx.aiCreditEntry.aggregate({ where: { companyId, kind: { not: 'RESERVE' } }, _sum: { units: true } });
  const held = -([...balances.values()].reduce((sum, value) => sum + value, 0) - (settled._sum.units ?? 0));
  const used = -(consumed._sum.units ?? 0);
  const edit = randomUUID();
  for (const lot of lots) await revokeAiCreditGrant(tx, { companyId, grantId: lot.id, operationKey: `sales-demo-edit:${edit}:${lot.id}`, now });
  const units = Math.max(0, total * 100 - used - Math.max(0, held));
  if (units > 0) {
    const sourceKey = `sales-demo:${linkId}:edit:${edit}`;
    await applyAiCreditGrant(tx, { companyId, billingAccountId: null, sourceKind: 'SALES_EVENT', units, sourceKey,
      sourceHash: createHash('sha256').update(JSON.stringify([sourceKey, companyId, units])).digest('hex'), at: now });
  }
}
