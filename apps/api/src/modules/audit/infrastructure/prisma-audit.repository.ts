import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { AuditActorType, AuditLogEntry, AuditLogRecord, AuditResult, AuditRiskLevel } from '../domain/models/audit-log.model';
import { normalizeAuditActor } from '../domain/logic/audit-actor.logic';
import type { AuditTransactionClient, IAuditRepository } from '../domain/ports/audit-repository.port';

function isMissingTypedActorColumn(error: unknown): boolean {
  const prismaError = error as { code?: unknown; message?: unknown };
  return prismaError.code === 'P2022' && /actorType|actorRefId/.test(String(prismaError.message));
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
