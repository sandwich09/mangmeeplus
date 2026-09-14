import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STRIPE_API_VERSION, type BillingProviderScanView } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { BillingOperation, Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { StripeClient, StripeRequestError, type StripeObject } from '../infrastructure/stripe.client';
import { billingError, hashBilling } from '../domain/billing-policy';
import { BillingAdminService } from './billing-admin.service';
import { BILLING_STRIPE_EVENTS, validBillingEvent } from './billing-reconciler.service';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';

const TYPE = 'SCAN_PROVIDER_EVENTS', RUN = 'system.billing.reconcile.run';
type Source = { since: number; until: number; membershipId: string; actorCompanyId: string };
type Progress = { cursor: string | null; pages: number; seen: number; imported: number; known: number; ignored: number; incompatible: number; failures: number; retryAt: string | null };
const empty = (): Progress => ({ cursor: null, pages: 0, seen: 0, imported: 0, known: 0, ignored: 0, incompatible: 0, failures: 0, retryAt: null });
const windowOpen = (source: Source) => source.since >= Math.floor(Date.now() / 1000) - 29 * 86400;

@Injectable()
export class BillingProviderScansService {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient, private readonly admin: BillingAdminService) {}

  private scope() { return { type: TYPE, companyId: null, stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode }; }
  private async authorize(context: RequestContext, permission: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const access = await this.admin.access(context, permission, tx);
    if (!access.platformScope) throw new NotFoundException();
    return access;
  }
  private view(row: BillingOperation, canRun: boolean, userId: string): BillingProviderScanView {
    const source = row.proposedJson as Source, progress = row.resultJson as Progress;
    return { id: row.id, mode: row.livemode ? 'LIVE' : 'TEST', state: row.state, version: row.version, reason: row.reason,
      windowStart: new Date(source.since * 1000).toISOString(), windowEnd: new Date(source.until * 1000).toISOString(),
      createdAt: row.createdAt.toISOString(), checkpointAt: row.observedAt?.toISOString() ?? null,
      pages: progress.pages, seen: progress.seen, imported: progress.imported, known: progress.known, ignored: progress.ignored, incompatible: progress.incompatible,
      retryAt: progress.retryAt, errorCode: row.errorCode,
      canCancel: canRun && ['QUEUED', 'RUNNING', 'UNKNOWN', 'BLOCKED'].includes(row.state),
      canResume: canRun && this.stripe.enabled && row.initiatorUserId === userId && row.errorCode !== 'PAGE_LIMIT_REACHED' && ['UNKNOWN', 'BLOCKED'].includes(row.state) && windowOpen(source) && (!progress.retryAt || Date.parse(progress.retryAt) <= Date.now()) };
  }
  async get(context: RequestContext, id: string) {
    const access = await this.authorize(context, 'system.billing.read');
    const row = await this.prisma.client.billingOperation.findFirst({ where: { ...this.scope(), id } });
    if (!row) throw new NotFoundException();
    return this.view(row, access.capabilities.includes(RUN), context.userId);
  }
  async list(context: RequestContext, cursor?: string) {
    const access = await this.authorize(context, 'system.billing.read');
    const anchor = cursor ? await this.prisma.client.billingOperation.findFirst({ where: { ...this.scope(), id: cursor } }) : null;
    if (cursor && !anchor) throw new NotFoundException();
    const rows = await this.prisma.client.billingOperation.findMany({ where: { ...this.scope(), ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26 });
    return { items: rows.slice(0, 25).map(row => this.view(row, access.capabilities.includes(RUN), context.userId)), nextCursor: rows.length > 25 ? rows[24]!.id : null, canCreate: this.stripe.enabled && access.capabilities.includes(RUN) };
  }
  async create(context: RequestContext, input: { windowStart: string; windowEnd: string; reason: string }, key: string) {
    await this.authorize(context, RUN);
    if (!this.stripe.enabled) throw billingError('BILLING_NOT_CONFIGURED', 'ยังไม่ได้เปิดการเชื่อมต่อ Stripe');
    const source: Source = { since: Math.floor(Date.parse(input.windowStart) / 1000), until: Math.floor(Date.parse(input.windowEnd) / 1000), membershipId: context.membershipId, actorCompanyId: context.companyId };
    if (![input.windowStart,input.windowEnd].every(value=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) ||
      !/^[a-zA-Z0-9_-]{16,120}$/.test(key) || !Number.isFinite(source.since) || !Number.isFinite(source.until) || source.since >= source.until ||
      source.until > Math.floor(Date.now() / 1000) - 60 || !windowOpen(source) || !input.reason.trim() || input.reason.length > 500) throw new BadRequestException('Invalid discovery window or request');
    const requestHash = hashBilling([TYPE, source, input.reason.trim(), context.userId]);
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-discovery:${this.stripe.accountId}:${this.stripe.livemode}`},0))`;
      await this.authorize(context, RUN, tx);
      const old = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: { stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode, idempotencyKey: key } } });
      if (old) {
        if (old.type !== TYPE || old.requestHash !== requestHash || old.initiatorUserId !== context.userId) throw billingError('CONTROL_IDEMPOTENCY_CONFLICT', 'คำขอนี้ต่างจากรายการเดิม');
        return this.view(old, true, context.userId);
      }
      if (await tx.billingOperation.count({ where: { ...this.scope(), state: { in: ['QUEUED', 'RUNNING'] } } }) >= 5) throw billingError('CONTROL_SCAN_BUSY', 'มีงานตรวจที่ยังไม่จบ กรุณาเปิดงานเดิมก่อน');
      const row = await tx.billingOperation.create({ data: { ...this.scope(), state: 'QUEUED', proposedJson: source, sourceVersion: 0,
        reason: input.reason.trim(), initiatorUserId: context.userId, requestHash, idempotencyKey: key,
        expiresAt: new Date((source.since + 29 * 86400) * 1000), resultJson: empty() } });
      await this.audit(tx, context, row, 'created');
      return this.view(row, true, context.userId);
    });
  }
  async act(context: RequestContext, id: string, action: string, expectedVersion: number) {
    if (!['cancel', 'resume'].includes(action) || !Number.isInteger(expectedVersion)) throw new BadRequestException();
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-discovery:${this.stripe.accountId}:${this.stripe.livemode}`},0))`;
      await this.authorize(context, RUN, tx);
      const row = await tx.billingOperation.findFirst({ where: { ...this.scope(), id } });
      if (!row) throw new NotFoundException();
      const allowed = this.view(row, true, context.userId);
      if (action === 'cancel' ? !allowed.canCancel : !allowed.canResume) throw new ForbiddenException();
      if (action === 'resume' && await tx.billingOperation.count({ where: { ...this.scope(), state: { in: ['QUEUED', 'RUNNING'] } } }) >= 5) throw billingError('CONTROL_SCAN_BUSY', 'มีงานตรวจที่ยังไม่จบ กรุณาเปิดงานเดิมก่อน');
      const updated = await tx.billingOperation.updateMany({ where: { id, version: expectedVersion, state: row.state }, data: {
        state: action === 'cancel' ? 'CANCELLED' : 'QUEUED', errorCode: null, leaseToken: null, leaseUntil: null, version: { increment: 1 },
      } });
      if (!updated.count) throw billingError('CONTROL_PREVIEW_STALE', 'งานเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด');
      await this.audit(tx, context, row, action);
      return this.view(await tx.billingOperation.findUniqueOrThrow({ where: { id } }), true, context.userId);
    });
  }
  private audit(tx: Prisma.TransactionClient, context: RequestContext, row: BillingOperation, action: string) {
    return tx.auditLog.create({ data: { actorUserId: context.userId, action: `billing.discovery.${action}`, targetType: 'BillingOperation', targetId: row.id,
      requestId: context.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { mode: row.livemode ? 'LIVE' : 'TEST', reason: row.reason } } });
  }
  async drain() {
    if (!this.stripe.enabled) return { processed: 0, failed: 0 };
    const rows = await this.prisma.client.billingOperation.findMany({ where: { ...this.scope(), state: { in: ['QUEUED', 'RUNNING'] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 5 });
    let processed = 0, failed = 0;
    for (const row of rows.filter(row => !(row.resultJson as Progress).retryAt || Date.parse((row.resultJson as Progress).retryAt!) <= Date.now()).slice(0,1)) {
      const progress = row.resultJson as Progress, source = row.proposedJson as Source;
      if (progress.retryAt && Date.parse(progress.retryAt) > Date.now()) continue;
      const lease = randomUUID();
      const owned = await this.prisma.client.billingOperation.updateMany({ where: { id: row.id, version: row.version, state: row.state,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { state: 'RUNNING', leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000), version: { increment: 1 } } });
      if (!owned.count) continue;
      let authorized = false, errorCode = 'PROVIDER_UNAVAILABLE';
      try {
        await this.admin.authorizeOperation(row, RUN); authorized = true;
        if (!windowOpen(source)) { errorCode = 'RETENTION_WINDOW_EXPIRED'; throw new Error(); }
        if (progress.pages >= 2000) { errorCode = 'PAGE_LIMIT_REACHED'; throw new Error(); }
        await this.stripe.assertAccount();
        const page = await this.stripe.request('GET', '/events', { created: { gte: source.since, lte: source.until }, limit: 100,
          ...(progress.cursor ? { starting_after: progress.cursor } : {}) });
        errorCode = 'PROVIDER_PAGE_INVALID';
        if (page.object !== 'list' || !Array.isArray(page.data) || page.data.length > 100 || typeof page.has_more !== 'boolean') throw new Error();
        const events = page.data as StripeObject[], ids = new Set<string>();
        let ignored = 0, incompatible = 0;
        const imported: Prisma.BillingProviderEventCreateManyInput[] = [];
        for (const event of events) {
          if (!event || event.object !== 'event' || typeof event.id !== 'string' || !/^evt_[a-zA-Z0-9]+$/.test(event.id) || ids.has(event.id) ||
            !Number.isSafeInteger(event.created) || event.created < source.since || event.created > source.until ||
            event.livemode !== row.livemode || (event.account !== undefined && event.account !== row.stripeAccountId) || typeof event.type !== 'string') throw new Error();
          ids.add(event.id);
          if (!BILLING_STRIPE_EVENTS.has(event.type)) { ignored++; continue; }
          if (event.api_version !== STRIPE_API_VERSION) { incompatible++; continue; }
          if (!validBillingEvent(event, row.stripeAccountId, row.livemode)) throw new Error();
          imported.push({ stripeAccountId: row.stripeAccountId, livemode: row.livemode, eventId: event.id, eventType: event.type,
            objectId: event.data.object.id, apiVersion: event.api_version, evidenceHash: hashBilling(JSON.stringify(event)) });
        }
        const cursor = events.at(-1)?.id ?? progress.cursor;
        if (page.has_more && (!events.length || cursor === progress.cursor)) throw new Error();
        await this.prisma.client.$transaction(async tx => {
          const context = await this.admin.authorizeOperation(row, RUN, tx).catch(error => { authorized = false; throw error; });
          const claimed = await tx.billingOperation.updateMany({ where: { id: row.id, state: 'RUNNING', leaseToken: lease, leaseUntil: { gt: new Date() } }, data: {
            state: page.has_more ? 'QUEUED' : 'SUCCEEDED', leaseToken: null, leaseUntil: null, observedAt: new Date(), errorCode: null, version: { increment: 1 },
          } });
          if (!claimed.count) throw new Error('Lost discovery lease');
          const existing = await tx.billingProviderEvent.findMany({ where: { stripeAccountId: row.stripeAccountId, livemode: row.livemode, eventId: { in: imported.map(event => event.eventId) } } });
          if (existing.some(event => imported.some(source => source.eventId === event.eventId &&
            (source.eventType !== event.eventType || source.objectId !== event.objectId || source.apiVersion !== event.apiVersion)))) throw new Error('Conflicting event reference');
          const saved = await tx.billingProviderEvent.createMany({ data: imported, skipDuplicates: true });
          const result: Progress = { cursor, pages: progress.pages + 1, seen: progress.seen + events.length, imported: progress.imported + saved.count,
            known: progress.known + imported.length - saved.count, ignored: progress.ignored + ignored, incompatible: progress.incompatible + incompatible, failures: 0, retryAt: null };
          await tx.billingOperation.update({ where: { id: row.id }, data: { resultJson: result } });
          await this.audit(tx, context, row, page.has_more ? 'checkpoint' : 'completed');
          if (!page.has_more) await resolveBillingIssue(tx, { companyId: null, stripeAccountId: row.stripeAccountId, livemode: row.livemode,
            kind: 'PROVIDER_SCAN_FAILED', referenceId: row.id }, 'PROVIDER_DISCOVERY_COMPLETED');
          if (incompatible) await detectBillingIssue(tx, { companyId: null, stripeAccountId: row.stripeAccountId, livemode: row.livemode, kind: 'PROVIDER_SCAN_VERSION_UNSUPPORTED', referenceId: row.id });
        });
        processed++;
      } catch (error) {
        const failures = progress.failures + 1, delay = error instanceof StripeRequestError ? error.retryAfterSeconds : 60;
        const retryAt = new Date(Date.now() + Math.min(86400, Math.max(delay, 30 * 2 ** Math.min(failures, 8))) * 1000).toISOString();
        const terminal = !authorized || ['RETENTION_WINDOW_EXPIRED', 'PAGE_LIMIT_REACHED', 'PROVIDER_PAGE_INVALID'].includes(errorCode);
        const state = terminal ? 'BLOCKED' : failures >= 5 ? 'UNKNOWN' : 'QUEUED';
        await this.prisma.client.$transaction(async tx => {
          const changed = await tx.billingOperation.updateMany({ where: { id: row.id, state: 'RUNNING', leaseToken: lease, leaseUntil: { gt: new Date() } }, data: {
            state, errorCode: authorized ? errorCode : 'CONTROL_PERMISSION_CHANGED',
            leaseToken: null, leaseUntil: null, resultJson: { ...progress, failures, retryAt }, version: { increment: 1 },
          } });
          if (changed.count && state !== 'QUEUED') await detectBillingIssue(tx, { companyId: null, stripeAccountId: row.stripeAccountId, livemode: row.livemode,
            kind: 'PROVIDER_SCAN_FAILED', referenceId: row.id });
        });
        failed++;
      }
    }
    return { processed, failed };
  }
}
