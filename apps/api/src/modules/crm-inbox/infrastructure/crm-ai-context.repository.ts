import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { TRUST_SCAN, type CrmTrustFactor, type CrmTrustSignals } from '../domain/logic/crm-ai-trust.logic';
import type { CrmAiCatalogItem } from '@watchdog-bms/contracts';

export type CrmAiCompanyContext = { brandName: string | null; name: string };
export type CrmTrustScanCandidate = { id: string; companyId: string; inbound30d: number };
export type CrmTrustSignalCustomer = {
  id: string;
  companyId: string;
  createdAt: Date;
  consentStatus: 'UNKNOWN' | 'GRANTED' | 'REVOKED' | 'NOT_REQUIRED';
  accountingCounterpartyId: string | null;
  lineLinked: boolean;
  keptAppointments: number;
  noShows90d: number;
};
export type CrmAiWindowMessageRow = {
  direction: string;
  authorType: string;
  contentText: string | null;
  deliveryStatus: string;
  createdAt: Date;
};
export type CrmAiTemplateExampleRow = { title: string; bodyText: string; version?: number };
export type CrmTrustReadRow = {
  trustScore: number | null;
  trustScoreFactorsJson: unknown;
  trustScoreComputedAt: Date | null;
};
export type CrmAiFeedbackInput = {
  companyId: string;
  conversationId: string;
  kind: 'SUMMARY' | 'REPLY_DRAFT' | 'INSIGHTS';
  rating: 'UP' | 'DOWN';
  comment?: string;
  requestId?: string;
  createdByUserId: string;
};

@Injectable()
export class CrmAiContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async findCompany(companyId: string): Promise<CrmAiCompanyContext | null> {
    return this.db.company.findUnique({ where: { id: companyId }, select: { brandName: true, name: true } });
  }

  async findCustomerConsent(companyId: string, customerId: string): Promise<'UNKNOWN' | 'GRANTED' | 'REVOKED' | 'NOT_REQUIRED' | null> {
    const row = await this.db.crmCustomer.findFirst({
      where: { id: customerId, companyId, personalDataErasedAt: null },
      select: { consentStatus: true },
    });
    return row?.consentStatus ?? null;
  }

  async findCustomerTrustRead(companyId: string, customerId: string): Promise<CrmTrustReadRow | null> {
    return this.db.crmCustomer.findFirst({
      where: { id: customerId, companyId, personalDataErasedAt: null },
      select: { trustScore: true, trustScoreFactorsJson: true, trustScoreComputedAt: true },
    });
  }

  async findTrustScanCandidates(now: Date): Promise<CrmTrustScanCandidate[]> {
    const engagementSince = daysBefore(now, TRUST_SCAN.engagementWindowDays);
    const staleSince = daysBefore(now, TRUST_SCAN.staleAfterDays);
    const [stale, neverScored] = await Promise.all([
      this.db.$queryRaw<CrmTrustScanCandidate[]>`
        WITH stale AS (
          SELECT c."id", c."companyId"
          FROM "CrmCustomer" c
          WHERE c."trustScoreComputedAt" < ${staleSince}
            AND c."personalDataErasedAt" IS NULL
          ORDER BY c."trustScoreComputedAt" ASC
          LIMIT ${TRUST_SCAN.batch}
        )
        SELECT stale."id", stale."companyId", COALESCE(m."inbound30d", 0)::int AS "inbound30d"
        FROM stale
        LEFT JOIN (
          SELECT conv."customerId", conv."companyId", COUNT(*) AS "inbound30d"
          FROM "CrmConversation" conv
          JOIN "CrmMessage" msg ON msg."conversationId" = conv."id" AND msg."companyId" = conv."companyId"
          JOIN stale ON stale."id" = conv."customerId" AND stale."companyId" = conv."companyId"
          WHERE msg."direction" = 'INBOUND'
            AND msg."createdAt" >= ${engagementSince}
          GROUP BY conv."customerId", conv."companyId"
        ) m ON m."customerId" = stale."id" AND m."companyId" = stale."companyId"
      `,
      this.db.$queryRaw<CrmTrustScanCandidate[]>`
        SELECT c."id", c."companyId", m."inbound30d"::int AS "inbound30d"
        FROM "CrmCustomer" c
        JOIN (
          SELECT conv."customerId", conv."companyId", COUNT(*) AS "inbound30d"
          FROM "CrmConversation" conv
          JOIN "CrmMessage" msg ON msg."conversationId" = conv."id" AND msg."companyId" = conv."companyId"
          WHERE msg."direction" = 'INBOUND'
            AND msg."createdAt" >= ${engagementSince}
          GROUP BY conv."customerId", conv."companyId"
          HAVING COUNT(*) >= ${TRUST_SCAN.minInbound}
        ) m ON m."customerId" = c."id" AND m."companyId" = c."companyId"
        WHERE c."trustScore" IS NULL
          AND c."personalDataErasedAt" IS NULL
        ORDER BY c."createdAt" ASC
        LIMIT ${TRUST_SCAN.batch}
      `,
    ]);
    const byId = new Map<string, CrmTrustScanCandidate>();
    for (const candidate of [...stale, ...neverScored]) {
      if (byId.size >= TRUST_SCAN.batch) break;
      byId.set(candidate.id, candidate);
    }
    return [...byId.values()];
  }

  async findTrustSignalCustomers(customerIds: string[], now: Date): Promise<CrmTrustSignalCustomer[]> {
    if (customerIds.length === 0) return [];
    const [customers, appointmentCounts] = await Promise.all([
      this.db.$queryRaw<Omit<CrmTrustSignalCustomer, 'keptAppointments' | 'noShows90d'>[]>`
        SELECT c."id", c."companyId", c."createdAt", c."consentStatus", c."accountingCounterpartyId",
          EXISTS (
            SELECT 1
            FROM "CrmChannelIdentity" i
            WHERE i."companyId" = c."companyId"
              AND i."customerId" = c."id"
              AND i."verifiedLinkAt" IS NOT NULL
          ) AS "lineLinked"
        FROM "CrmCustomer" c
        WHERE c."id" = ANY(${customerIds}::text[])
          AND c."personalDataErasedAt" IS NULL
      `,
      this.db.crmBooking.groupBy({
        by: ['companyId', 'customerId', 'status'],
        where: {
          customerId: { in: customerIds },
          OR: [
            { status: 'DONE' },
            { status: 'NO_SHOW', startAt: { gte: daysBefore(now, 90) } },
          ],
        },
        _count: { _all: true },
      }),
    ]);
    const countsByCustomer = new Map<string, { keptAppointments: number; noShows90d: number }>();
    for (const row of appointmentCounts) {
      const key = `${row.companyId}:${row.customerId}`;
      const counts = countsByCustomer.get(key) ?? { keptAppointments: 0, noShows90d: 0 };
      if (row.status === 'DONE') counts.keptAppointments = row._count._all;
      else counts.noShows90d = row._count._all;
      countsByCustomer.set(key, counts);
    }
    return customers.map((customer) => ({
      ...customer,
      ...(countsByCustomer.get(`${customer.companyId}:${customer.id}`) ?? { keptAppointments: 0, noShows90d: 0 }),
    }));
  }

  getTrustSignals(customer: CrmTrustSignalCustomer, now: Date, inboundMessages30d: number): CrmTrustSignals {
    return {
      tenureDays: Math.max(0, Math.floor((now.getTime() - customer.createdAt.getTime()) / 86_400_000)),
      lineLinked: customer.lineLinked,
      consentGranted: customer.consentStatus === 'GRANTED',
      financialIdentity: Boolean(customer.accountingCounterpartyId),
      inboundMessages30d,
      keptAppointments: customer.keptAppointments,
      noShows90d: customer.noShows90d,
    };
  }

  async saveTrustScore(companyId: string, customerId: string, score: number, factors: CrmTrustFactor[], at: Date): Promise<boolean> {
    return this.db.$transaction(async (tx: any) => {
      if (!await this.lockLiveCustomer(tx, companyId, customerId)) return false;
      const updated = await tx.crmCustomer.updateMany({
        where: { id: customerId, companyId, personalDataErasedAt: null },
        data: { trustScore: score, trustScoreFactorsJson: factors as any, trustScoreComputedAt: at },
      });
      return updated.count === 1;
    });
  }

  async updateCustomerAdvisory(
    companyId: string,
    customerId: string,
    data: { leadScore: number; sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' },
  ): Promise<boolean> {
    return this.db.$transaction(async (tx: any) => {
      if (!await this.lockLiveCustomer(tx, companyId, customerId)) return false;
      const updated = await tx.crmCustomer.updateMany({
        where: { id: customerId, companyId, personalDataErasedAt: null },
        data: { ...data, leadScoreUpdatedAt: new Date() },
      });
      return updated.count === 1;
    });
  }

  async saveConversationSummary(companyId: string, conversationId: string, text: string, at: Date): Promise<boolean> {
    return this.db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-identity-graph:' || ${companyId}))::text`;
      const discovered = await tx.crmConversation.findFirst({
        where: { id: conversationId, companyId },
        select: { customerId: true },
      });
      if (!discovered) return false;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${companyId} || ':' || ${discovered.customerId}))::text`;
      await tx.$queryRaw`SELECT "id" FROM "CrmConversation" WHERE "id" = ${conversationId} AND "companyId" = ${companyId} FOR UPDATE`;
      const conversation = await tx.crmConversation.findFirst({
        where: { id: conversationId, companyId },
        select: { customerId: true },
      });
      if (!conversation || conversation.customerId !== discovered.customerId) return false;
      if (!await this.liveCustomer(tx, companyId, conversation.customerId)) return false;
      const updated = await tx.crmConversation.updateMany({
        where: { id: conversationId, companyId, customerId: conversation.customerId },
        data: { aiSummaryText: text, aiSummaryAt: at },
      });
      return updated.count === 1;
    });
  }

  async listRecentWindowMessages(companyId: string, conversationId: string): Promise<CrmAiWindowMessageRow[]> {
    return this.db.crmMessage.findMany({
      where: {
        companyId,
        conversationId,
        visibility: 'CUSTOMER',
        contentText: { not: null },
        OR: [
          { direction: 'INBOUND' },
          { direction: 'OUTBOUND', deliveryStatus: 'SENT', authorType: { not: 'SYSTEM' } },
        ],
        conversation: { customer: { personalDataErasedAt: null } },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { direction: true, authorType: true, contentText: true, deliveryStatus: true, createdAt: true },
    });
  }

  async listActiveTemplateExamples(companyId: string): Promise<CrmAiTemplateExampleRow[]> {
    return this.db.crmMessageTemplate.findMany({
      where: { companyId, status: 'ACTIVE' },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
      take: 10,
      select: { title: true, bodyText: true },
    });
  }

  async listAiApprovedTemplateExamples(companyId: string): Promise<CrmAiTemplateExampleRow[]> {
    return this.db.$queryRaw<CrmAiTemplateExampleRow[]>`
      SELECT "title", "bodyText", "version"
      FROM "CrmMessageTemplate"
      WHERE "companyId" = ${companyId}
        AND "status" = 'ACTIVE'
        AND "aiApprovedVersion" = "version"
        AND "aiApprovedAt" IS NOT NULL
        AND "aiApprovedByUserId" IS NOT NULL
      ORDER BY "category" ASC NULLS FIRST, "title" ASC
      LIMIT 10
    `;
  }

  async listCustomerVisibleCatalog(companyId: string, kind?: CrmAiCatalogItem['kind']): Promise<CrmAiCatalogItem[]> {
    const rows = await this.db.product.findMany({
      where: { companyId, status: 'ACTIVE', customerVisible: true, ...(kind ? { kind } : {}) },
      orderBy: { name: 'asc' },
      take: 100,
      select: {
        id: true,
        sku: true,
        name: true,
        kind: true,
        description: true,
        category: true,
        unit: true,
        salePrice: true,
        bookingDurationMinutes: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      kind: row.kind,
      description: row.description ?? undefined,
      category: row.category ?? undefined,
      unit: row.unit,
      salePrice: row.salePrice?.toString(),
      bookingDurationMinutes: row.bookingDurationMinutes ?? undefined,
    }));
  }

  async saveLiveAssistFeedback(input: CrmAiFeedbackInput & { requestId: string }): Promise<{ id: string; createdAt: Date }> {
    return this.db.$transaction(async (tx: any) => {
      const discovered = await tx.crmConversation.findFirst({
        where: { id: input.conversationId, companyId: input.companyId },
        select: { customerId: true },
      });
      if (!discovered) throw new Error('conversation_not_found');
      if (!await this.lockLiveCustomer(tx, input.companyId, discovered.customerId)) throw new Error('customer_not_active');
      await tx.$queryRaw`SELECT "id" FROM "CrmConversation" WHERE "id" = ${input.conversationId} AND "companyId" = ${input.companyId} FOR UPDATE`;
      const conversation = await tx.crmConversation.findFirst({
        where: { id: input.conversationId, companyId: input.companyId },
        select: { customerId: true },
      });
      if (!conversation || conversation.customerId !== discovered.customerId) throw new Error('conversation_customer_changed');
      const key = {
        conversationId: input.conversationId,
        kind: input.kind,
        requestId: input.requestId,
        createdByUserId: input.createdByUserId,
      };
      const existing = await tx.crmAiAssistFeedback.findFirst({ where: key, select: { id: true, createdAt: true } });
      if (existing) {
        return tx.crmAiAssistFeedback.update({
          where: { id: existing.id },
          data: { rating: input.rating, comment: input.comment },
          select: { id: true, createdAt: true },
        });
      }
      return tx.crmAiAssistFeedback.create({
        data: input,
        select: { id: true, createdAt: true },
      });
    });
  }

  private async lockLiveCustomer(tx: any, companyId: string, customerId: string): Promise<boolean> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-identity-graph:' || ${companyId}))::text`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${companyId} || ':' || ${customerId}))::text`;
    return this.liveCustomer(tx, companyId, customerId);
  }

  private async liveCustomer(tx: any, companyId: string, customerId: string): Promise<boolean> {
    return Boolean(await tx.crmCustomer.findFirst({
      where: { id: customerId, companyId, status: 'ACTIVE', personalDataErasedAt: null },
      select: { id: true },
    }));
  }
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}
