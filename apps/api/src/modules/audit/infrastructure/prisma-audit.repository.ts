import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { PLATFORM_TENANT_ID } from '../../sales-console/application/sales-context';
import { PLATFORM_AUDIT_ACTION_PREFIXES, TENANT_BILLING_AUDIT_ACTION_PREFIXES } from '../domain/models/audit-action';
import type { AuditActorType, AuditLogEntry, AuditLogRecord, AuditResult, AuditRiskLevel } from '../domain/models/audit-log.model';
import { normalizeAuditActor } from '../domain/logic/audit-actor.logic';
import type { AuditTransactionClient, IAuditRepository } from '../domain/ports/audit-repository.port';

function isMissingTypedActorColumn(error: unknown): boolean {
  const prismaError = error as { code?: unknown; message?: unknown };
  return prismaError.code === 'P2022' && /actorType|actorRefId/.test(String(prismaError.message));
}

/**
 * RB-38 — a company's audit list is its OWN trail. Platform code also writes rows carrying the
 * company's id (a flag review of its sales credit, a referral repair, a refund billing observed),
 * and the list used to hand those, with platform staff ids, to the shop's OWNER and auditor.
 *
 * Three rules, each written so a row with no user (`actorUserId` NULL) is decided by an explicit
 * branch and never by how SQL treats NULL:
 *  1. never a platform-side action, whoever did it;
 *  2. of `billing.`, only what one of the company's own people did;
 *  3. never a person who acts from the platform company and holds no membership here. Membership
 *     of any status counts, and an account with no membership anywhere stays visible: an account
 *     merge moves the membership to the surviving account and leaves the old id on its audit rows.
 *
 * Rows the system wrote about the company's own work (a scheduled job, an automatic approval) pass
 * all three. The platform company itself is not filtered.
 *
 * ponytail: `startsWith` is a SQL LIKE, so `_` in a prefix matches any one character. No action
 * name differs from another by one character in that position; escape it if one ever does.
 */
function ownTrailOnly(companyId: string) {
  const startsWith = (prefix: string) => ({ action: { startsWith: prefix } });
  return {
    AND: [
      { NOT: { OR: PLATFORM_AUDIT_ACTION_PREFIXES.map(startsWith) } },
      { OR: [{ NOT: startsWith('billing.') }, { actorUserId: { not: null }, OR: TENANT_BILLING_AUDIT_ACTION_PREFIXES.map(startsWith) }] },
      {
        OR: [
          { actorUserId: null },
          { actor: { is: { OR: [{ memberships: { some: { companyId } } }, { memberships: { none: { companyId: PLATFORM_TENANT_ID } } }] } } },
        ],
      },
    ],
  };
}

@Injectable()
export class PrismaAuditRepository implements IAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry, tx?: AuditTransactionClient): Promise<void> {
    // `tx` writes the row inside the caller's transaction so a rollback drops the
    // audit row with the mutation it describes (and vice versa).
    const client = tx ?? this.prisma.client;
    // Enforce the invariant in code: a non-USER actor never writes into the
    // User FK, and a USER actor never carries actorRefId.
    const actor = normalizeAuditActor(entry);
    const data = {
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      actorRefId: actor.actorRefId,
      companyId: entry.companyId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      requestId: entry.requestId,
      result: entry.result,
      riskLevel: entry.riskLevel ?? 'LOW',
      // ponytail: cast required - Prisma InputJsonValue vs domain Record<string,unknown>
      metadataJson: entry.metadataJson as Parameters<typeof this.prisma.client.auditLog.create>[0]['data']['metadataJson'],
    };

    try {
      await client.auditLog.create({ data });
    } catch (error) {
      if (actor.actorType !== 'USER' || !isMissingTypedActorColumn(error)) throw error;
      // Rolling/local compatibility: preserve USER audits on the legacy table until
      // 20260712200000 lands. Non-user actors still fail closed because the old schema
      // cannot represent their identity safely.
      await client.$executeRaw`
        INSERT INTO "AuditLog" (
          "id", "actorUserId", "companyId", "action", "targetType", "targetId",
          "requestId", "result", "riskLevel", "metadataJson"
        ) VALUES (
          ${randomUUID()}, ${actor.actorUserId}, ${entry.companyId ?? null}, ${entry.action}, ${entry.targetType}, ${entry.targetId ?? null},
          ${entry.requestId}, ${entry.result}, ${entry.riskLevel ?? 'LOW'}, ${entry.metadataJson ? JSON.stringify(entry.metadataJson) : null}::jsonb
        )
      `;
    }
  }

  async getCompanyLogs(params: {
    companyId: string;
    actorUserId?: string;
    targetType?: string;
    categories?: string[];
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ data: AuditLogRecord[]; total: number }> {
    const { companyId, actorUserId, targetType, categories, from, to, page, pageSize } = params;
    const categoryPrefixes = [...new Set((categories ?? []).flatMap((category) => AUDIT_CATEGORY_PREFIXES[category] ?? []))];
    const where = {
      companyId,
      ...(actorUserId ? { actorUserId } : {}),
      ...(targetType ? { targetType } : {}),
      ...(categoryPrefixes.length > 0
        ? { OR: categoryPrefixes.map((prefix) => ({ action: { startsWith: prefix } })) }
        : {}),
      ...((from ?? to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(companyId === PLATFORM_TENANT_ID ? {} : ownTrailOnly(companyId)),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.auditLog.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        actorType: r.actorType as AuditActorType,
        actorRefId: r.actorRefId ?? undefined,
        actorUserId: r.actorUserId ?? undefined,
        companyId: r.companyId ?? undefined,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId ?? undefined,
        requestId: r.requestId,
        result: r.result as AuditResult,
        riskLevel: r.riskLevel as AuditRiskLevel,
        metadataJson: (r.metadataJson ?? undefined) as Record<string, unknown> | undefined,
      })),
      total,
    };
  }
}

const AUDIT_CATEGORY_PREFIXES: Record<string, string[]> = {
  admin: ['admin.'],
  security: ['auth.', 'identity.', 'audit.', 'ai.'],
  accounting: ['accounting.', 'ledger.', 'journal.'],
  tax: ['tax.'],
  finance: ['finance.', 'payment.', 'expense.', 'bank.'],
};
