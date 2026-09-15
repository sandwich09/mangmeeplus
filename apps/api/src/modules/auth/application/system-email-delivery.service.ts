import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EMAIL_DELIVERY_PURPOSES, EMAIL_DELIVERY_STATES, type EmailDeliveryPurpose, type SystemEmailConnectionDto, type SystemEmailDeliveryDto } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../domain/models/request-context.model';
import { PostmarkClient } from '../infrastructure/postmark.client';
import { POSTMARK_EVENT_TYPE } from './email-delivery.service';

const permission = 'system.email_delivery.read';
const pendingStates = ['READY', 'SENDING', 'UNKNOWN', 'RETRY'];
const reviewWhere: Prisma.EmailSendAttemptWhereInput = { OR: [
  { status: { in: ['UNKNOWN', 'CONFIG', 'PERMANENT', 'SUPPRESSED'] } }, { suppressedAt: { not: null } },
  { status: { notIn: [...EMAIL_DELIVERY_STATES] } }, { status: 'RETRY', generation: { gte: 5 } },
] };
export type EmailHistoryQuery = { cursor?: string; purpose?: EmailDeliveryPurpose; review?: '1' };
const iso = (value: Date | null) => value?.toISOString() ?? null;

@Injectable()
export class SystemEmailDeliveryService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService,
    private readonly postmark: PostmarkClient, private readonly limits: RedisRateLimitService) {}

  private async authority(context: RequestContext): Promise<Set<string>> {
    const member = await this.prisma.client.companyMembership.findFirst({ where: {
      id: context.membershipId, userId: context.userId, companyId: context.companyId, status: 'ACTIVE',
    }, include: { user: { select: { status: true } }, company: { select: { status: true } },
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
    const roles = member?.roles.map(link => link.role).filter(role => role.status === 'ACTIVE' && role.isSystem && role.scopeKey === 'system' && role.companyId === null) ?? [];
    const current = new Set(roles.flatMap(role => role.permissions.map(link => link.permission.key)).filter(key => context.permissions.includes(key)));
    if (member?.user.status !== 'ACTIVE' || member.company.status !== 'ACTIVE' ||
        !roles.some(role => role.key === 'SYSTEM_ADMIN') || !current.has(permission)) throw new ForbiddenException();
    return current;
  }

  private scope() {
    const serverId = this.config.postmarkServerId, stream = this.config.postmarkMessageStream;
    return Number.isSafeInteger(serverId) && serverId! > 0 && typeof stream === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(stream)
      ? { provider: 'postmark', providerServerId: serverId!, stream } : null;
  }

  async history(context: RequestContext, query: EmailHistoryQuery): Promise<SystemEmailDeliveryDto> {
    await this.authority(context);
    if (Object.keys(query).some(key => !['cursor', 'purpose', 'review'].includes(key)) ||
        query.purpose !== undefined && !EMAIL_DELIVERY_PURPOSES.includes(query.purpose) ||
        query.review !== undefined && query.review !== '1') throw new BadRequestException();
    const db = this.prisma.client, scope = this.scope(), now = new Date(), start = new Date(now.getTime() - 7 * 86400000);
    const result: SystemEmailDeliveryDto = { observedAt: now.toISOString(), windowStartedAt: start.toISOString(),
      configured: Boolean(scope), outboundSelected: this.config.emailProvider === 'postmark', totals: null, pending: null, callbacks: null, items: [], nextCursor: null };
    if (!scope) { if (query.cursor) throw new BadRequestException(); await this.authority(context); return result; }
    const scopeHash = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
    const binding = { scope: scopeHash, purpose: query.purpose ?? null, review: query.review ?? null };
    const where: Prisma.EmailSendAttemptWhereInput = { ...scope, ...(query.purpose ? { purpose: query.purpose } : {}), ...(query.review ? reviewWhere : {}) };
    let after: { id: string; createdAt: Date } | null = null;
    if (query.cursor !== undefined) {
      let cursor: { id: string; scope: string; purpose: string | null; review: string | null };
      try {
        if (typeof query.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(query.cursor)) throw new Error();
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (!cursor || Object.keys(cursor).sort().join() !== 'id,purpose,review,scope' ||
            !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(cursor.id) || cursor.scope !== binding.scope ||
            cursor.purpose !== binding.purpose || cursor.review !== binding.review) throw new Error();
      } catch { throw new BadRequestException(); }
      after = await db.emailSendAttempt.findFirst({ where: { AND: [where, { id: cursor.id }] }, select: { id: true, createdAt: true } });
      if (!after) throw new NotFoundException();
    }
    const rows = await db.emailSendAttempt.findMany({ where: { AND: [where, ...(after ? [{ OR: [
      { createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } },
    ] }] : [])] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26,
      select: { id: true, purpose: true, status: true, generation: true, createdAt: true, submittedAt: true, deliveredAt: true,
        suppressedAt: true, deadlineAt: true, nextRecoveryAt: true, possibleDuplicate: true, signupRequestId: true } });
    const [totals] = await db.$queryRaw<NonNullable<SystemEmailDeliveryDto['totals']>[]>`SELECT
      count(*)::int AS attempts, count(DISTINCT "intentKey")::int AS intents,
      count(*) FILTER (WHERE "submittedAt" IS NOT NULL)::int AS accepted,
      count(*) FILTER (WHERE "deliveredAt" IS NOT NULL)::int AS delivered,
      count(*) FILTER (WHERE "suppressedAt" IS NOT NULL)::int AS suppressed,
      count(*) FILTER (WHERE "possibleDuplicate")::int AS "possibleDuplicates"
      FROM "EmailSendAttempt" WHERE provider = 'postmark' AND "providerServerId" = ${scope.providerServerId}
      AND stream = ${scope.stream} AND "createdAt" >= ${start} AND "createdAt" <= ${now}`;
    const pending = await db.emailSendAttempt.aggregate({ where: { ...scope, status: { in: pendingStates } }, _count: true, _min: { createdAt: true } });
    const needsReview = await db.emailSendAttempt.count({ where: { AND: [scope, reviewWhere] } });
    const overdueRecovery = await db.emailSendAttempt.count({ where: { ...scope, status: { in: pendingStates }, nextRecoveryAt: { lte: now } } });
    const [callbacks] = await db.$queryRaw<(Omit<NonNullable<SystemEmailDeliveryDto['callbacks']>, 'latestReceivedAt'> & { latestReceivedAt: Date | null })[]>`SELECT
      count(*)::int AS received, count(*) FILTER (WHERE status::text IN ('PENDING','PROCESSING'))::int AS pending,
      count(*) FILTER (WHERE status::text IN ('FAILED','DEAD'))::int AS failed, max("createdAt") AS "latestReceivedAt"
      FROM "OutboxEvent" WHERE "eventType" = ${POSTMARK_EVENT_TYPE} AND "createdAt" >= ${start} AND "createdAt" <= ${now}
      AND "payloadJson"->'serverId' = ${String(scope.providerServerId)}::jsonb AND "payloadJson"->>'stream' = ${scope.stream}`;
    const billingIds = rows.slice(0, 25).filter(row => row.purpose === 'billing_status').map(row => row.id);
    const billingLinks = billingIds.length && this.config.stripeAccountId && this.config.billingMode !== 'disabled'
      ? await db.$queryRaw<Array<{ attemptId: string; outboxId: string; companyId: string }>>(Prisma.sql`
        SELECT a.id AS "attemptId", o.id AS "outboxId", b."companyId" FROM "EmailSendAttempt" a
        JOIN "OutboxEvent" o ON o.id = substring(a."intentKey" from 16) AND a."intentKey" = 'billing-notice:' || o.id
        JOIN "BillingInvoice" i ON i.id = o."aggregateId" JOIN "BillingAccount" b ON b.id = i."billingAccountId"
        WHERE a.id IN (${Prisma.join(billingIds)}) AND a.purpose = 'billing_status' AND a.provider = 'postmark'
        AND a."providerServerId" = ${scope.providerServerId} AND a.stream = ${scope.stream}
        AND o."eventType" = 'billing.status.email' AND o."aggregateType" = 'BillingInvoice' AND o."companyId" = b."companyId"
        AND jsonb_typeof(o."payloadJson"->'data'->'recipientUserId') = 'string'
        AND b."stripeAccountId" = ${this.config.stripeAccountId} AND b.livemode = ${this.config.billingMode === 'live'}`) : [];
    const current = await this.authority(context);
    // Configuration may be changed while querying: never relabel another server's observations.
    if (JSON.stringify(this.scope()) !== JSON.stringify(scope)) throw new HttpException('โหลดการตั้งค่าใหม่แล้วลองอีกครั้ง', 409);
    result.totals = totals!;
    result.pending = { attempts: pending._count, oldestCreatedAt: iso(pending._min.createdAt), needsReview, overdueRecovery };
    result.callbacks = { ...callbacks!, latestReceivedAt: iso(callbacks!.latestReceivedAt) };
    result.items = rows.slice(0, 25).map(row => {
      const billingLink = current.has('system.billing.read') ? billingLinks.find(link => link.attemptId === row.id) : undefined;
      return { id: row.id,
      purpose: EMAIL_DELIVERY_PURPOSES.includes(row.purpose as EmailDeliveryPurpose) ? row.purpose as EmailDeliveryPurpose : 'other',
      state: EMAIL_DELIVERY_STATES.includes(row.status as typeof EMAIL_DELIVERY_STATES[number]) ? row.status as typeof EMAIL_DELIVERY_STATES[number] : 'UNRECOGNIZED',
      generation: row.generation, createdAt: row.createdAt.toISOString(), submittedAt: iso(row.submittedAt), deliveredAt: iso(row.deliveredAt),
      suppressedAt: iso(row.suppressedAt), deadlineAt: iso(row.deadlineAt), nextRecoveryAt: iso(row.nextRecoveryAt), possibleDuplicate: row.possibleDuplicate,
      needsReview: Boolean(row.suppressedAt) || ['UNKNOWN', 'CONFIG', 'PERMANENT', 'SUPPRESSED'].includes(row.status) ||
        !EMAIL_DELIVERY_STATES.includes(row.status as typeof EMAIL_DELIVERY_STATES[number]) || row.status === 'RETRY' && row.generation >= 5,
      signupHistoryPath: row.purpose === 'account_claim' && row.signupRequestId && /^[A-Za-z0-9_-]{20,40}$/.test(row.signupRequestId) && current.has('system.company_onboarding.read')
        ? `/system/signup-requests/${row.signupRequestId}/mail` : null,
      billingHistoryPath: billingLink ? `/system/billing/companies/${encodeURIComponent(billingLink.companyId)}/deliveries/${encodeURIComponent(`email:${billingLink.outboxId}`)}` : null,
    }; });
    result.nextCursor = rows.length > 25 ? Buffer.from(JSON.stringify({ ...binding, id: rows[24]!.id })).toString('base64url') : null;
    return result;
  }

  async connection(context: RequestContext): Promise<SystemEmailConnectionDto> {
    await this.authority(context);
    const scope = this.scope();
    if (!scope) return { observedAt: new Date().toISOString(), status: 'NOT_CONFIGURED', facts: null };
    const limit = await this.limits.consume('system-email-connection', context.userId, 6, 60);
    if (!limit.allowed) throw new HttpException({ message: 'กรุณารอสักครู่แล้วตรวจอีกครั้ง', retryAfterSeconds: limit.retryAfterSeconds }, 429);
    let facts: SystemEmailConnectionDto['facts'] = null;
    try { facts = await this.postmark.inspectConfiguration(); } catch { /* Safe observation only; provider errors can contain secrets. */ }
    await this.authority(context);
    if (JSON.stringify(this.scope()) !== JSON.stringify(scope)) throw new HttpException('โหลดการตั้งค่าใหม่แล้วลองอีกครั้ง', 409);
    const matched = facts?.server === 'MATCHED' && facts.stream === 'MATCHED' && facts.mode !== 'UNKNOWN' && facts.transactional === true && facts.archived === false;
    return { observedAt: new Date().toISOString(), status: !facts ? 'UNAVAILABLE' : matched ? 'MATCHED' : 'NEEDS_REVIEW', facts };
  }
}
