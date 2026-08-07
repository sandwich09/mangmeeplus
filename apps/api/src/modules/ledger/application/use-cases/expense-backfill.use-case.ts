import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import type {
  ExpenseBackfillPreview,
  ExpenseBackfillResult,
  RequestContext,
  TaxEvidenceStatus,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import {
  expenseAutoPostBlockers,
  type ExpenseAutoPostBlocker,
} from '../../../expenses/domain/logic/expense-auto-post.logic';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { AUTO_POST_ENTITLEMENT_FILTER } from './expense-auto-post.use-case';
import { GenerateJournalFromSourceUseCase } from './journal.use-case';
import { redactedExpensePostingError } from './expense-auto-post.use-case';

function requireBackfillPermissions(ctx: RequestContext): void {
  for (const permission of ['expense.read', 'journal.entry.create', 'journal.entry.post']) {
    if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
  }
}

function branchScopeSql(branchIds: string[] | undefined): Prisma.Sql {
  if (!branchIds) return Prisma.empty;
  if (branchIds.length === 0) return Prisma.sql`AND expense."branchId" IS NULL`;
  return Prisma.sql`AND (expense."branchId" IS NULL OR expense."branchId" IN (${Prisma.join(branchIds)}))`;
}

const activeEvidenceSql = Prisma.sql`
  EXISTS (
    SELECT 1
    FROM "AttachmentLink" AS link
    INNER JOIN "AttachmentObject" AS attachment
      ON attachment."companyId" = link."companyId"
      AND attachment."id" = link."attachmentId"
    WHERE link."companyId" = expense."companyId"
      AND link."targetType" = 'expense.record'
      AND link."targetId" = expense."id"
      AND attachment."status"::text = 'ACTIVE'
  )
`;

const cleanEvidenceSql = Prisma.sql`
  ${activeEvidenceSql}
  AND expense."taxEvidenceStatus"::text NOT IN ('NEEDS_REVIEW', 'NOT_TAX_EVIDENCE')
  AND btrim(coalesce(expense."vendorNameSnapshot", '')) <> ''
`;

function historicalBaseSql(companyId: string, activationAt: Date, branchIds: string[] | undefined): Prisma.Sql {
  return Prisma.sql`
    expense."companyId" = ${companyId}
    AND expense."status"::text = 'CONFIRMED'
    AND expense."postingStatus"::text = 'pending'
    AND expense."confirmedAt" < ${activationAt}
    ${branchScopeSql(branchIds)}
    AND NOT EXISTS (
      SELECT 1
      FROM "JournalEntry" AS journal
      WHERE journal."companyId" = expense."companyId"
        AND journal."sourceType" = 'expense.record'
        AND journal."sourceId" = expense."id"
        AND journal."entryType"::text = 'GENERATED'
    )
  `;
}

export function expenseBackfillCandidateSql(
  companyId: string,
  activationAt: Date,
  branchIds: string[] | undefined,
  limit: number,
): Prisma.Sql {
  return Prisma.sql`
    SELECT expense."id"
    FROM "ExpenseRecord" AS expense
    WHERE ${historicalBaseSql(companyId, activationAt, branchIds)}
      AND ${cleanEvidenceSql}
    ORDER BY expense."confirmedAt" ASC, expense."id" ASC
    LIMIT ${limit}
  `;
}

async function loadActivationAt(prisma: PrismaService, companyId: string): Promise<Date> {
  const company = await prisma.client.company.findFirst({
    where: {
      id: companyId,
      status: 'ACTIVE',
      // Same contracts-derived filter the worker uses (spec:264) — one source, two callers.
      AND: AUTO_POST_ENTITLEMENT_FILTER,
    },
    select: {
      featureEntitlements: {
        where: { featureKey: 'expense_auto_post', enabled: true },
        select: { updatedAt: true },
        take: 1,
      },
    },
  });
  const activationAt = company?.featureEntitlements[0]?.updatedAt;
  if (!activationAt) {
    // spec:333 — feature absence is never a 400.
    throw new ForbiddenException({
      code: 'expense_auto_post_not_enabled',
      message: 'ต้องเปิดระบบบัญชีและ Auto-post ค่าใช้จ่ายก่อนตรวจหรือดำเนินการย้อนหลัง',
    });
  }
  return activationAt;
}

type PreviewCountRow = {
  totalHistoricalPending: bigint | number | string;
  eligibleCount: bigint | number | string;
  manualReviewCount: bigint | number | string;
  noActiveEvidence: bigint | number | string;
  taxEvidenceNeedsReview: bigint | number | string;
  notTaxEvidence: bigint | number | string;
  vendorNameMissing: bigint | number | string;
};

type PreviewSampleRow = {
  id: string;
  expenseNumber: string | null;
  vendorNameSnapshot: string | null;
  confirmedAt: Date;
  taxEvidenceStatus: TaxEvidenceStatus;
  activeEvidenceCount: bigint | number | string;
};

@Injectable()
export class PreviewExpenseBackfillUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: RequestContext, requestedSampleLimit = 20): Promise<ExpenseBackfillPreview> {
    requireBackfillPermissions(ctx);
    const activationAt = await loadActivationAt(this.prisma, ctx.companyId);
    const scope = ctx.scopes?.branchIds;
    const counts = await this.prisma.client.$queryRaw<PreviewCountRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS "totalHistoricalPending",
        COUNT(*) FILTER (WHERE ${cleanEvidenceSql})::bigint AS "eligibleCount",
        COUNT(*) FILTER (WHERE NOT (${cleanEvidenceSql}))::bigint AS "manualReviewCount",
        COUNT(*) FILTER (WHERE NOT (${activeEvidenceSql}))::bigint AS "noActiveEvidence",
        COUNT(*) FILTER (WHERE expense."taxEvidenceStatus"::text = 'NEEDS_REVIEW')::bigint AS "taxEvidenceNeedsReview",
        COUNT(*) FILTER (WHERE expense."taxEvidenceStatus"::text = 'NOT_TAX_EVIDENCE')::bigint AS "notTaxEvidence",
        COUNT(*) FILTER (WHERE btrim(coalesce(expense."vendorNameSnapshot", '')) = '')::bigint AS "vendorNameMissing"
      FROM "ExpenseRecord" AS expense
      WHERE ${historicalBaseSql(ctx.companyId, activationAt, scope)}
    `);
    const row = counts[0] ?? {
      totalHistoricalPending: 0,
      eligibleCount: 0,
      manualReviewCount: 0,
      noActiveEvidence: 0,
      taxEvidenceNeedsReview: 0,
      notTaxEvidence: 0,
      vendorNameMissing: 0,
    };
    const sampleLimit = Math.max(0, Math.min(Math.trunc(requestedSampleLimit) || 0, 50));
    const sampleRows = sampleLimit > 0
      ? await this.prisma.client.$queryRaw<PreviewSampleRow[]>(Prisma.sql`
          SELECT
            expense."id",
            expense."expenseNumber",
            expense."vendorNameSnapshot",
            expense."confirmedAt",
            expense."taxEvidenceStatus",
            CASE WHEN ${activeEvidenceSql} THEN 1 ELSE 0 END AS "activeEvidenceCount"
          FROM "ExpenseRecord" AS expense
          WHERE ${historicalBaseSql(ctx.companyId, activationAt, scope)}
          ORDER BY expense."confirmedAt" ASC, expense."id" ASC
          LIMIT ${sampleLimit}
        `)
      : [];
    return {
      activationAt: activationAt.toISOString(),
      totalHistoricalPending: Number(row.totalHistoricalPending),
      eligibleCount: Number(row.eligibleCount),
      manualReviewCount: Number(row.manualReviewCount),
      blockerCounts: {
        NO_ACTIVE_EVIDENCE: Number(row.noActiveEvidence),
        TAX_EVIDENCE_NEEDS_REVIEW: Number(row.taxEvidenceNeedsReview),
        NOT_TAX_EVIDENCE: Number(row.notTaxEvidence),
        VENDOR_NAME_MISSING: Number(row.vendorNameMissing),
      },
      samples: sampleRows.map((sample) => ({
        expenseId: sample.id,
        expenseNumber: sample.expenseNumber,
        vendorNameSnapshot: sample.vendorNameSnapshot,
        confirmedAt: sample.confirmedAt.toISOString(),
        blockers: expenseAutoPostBlockers({
          activeEvidenceCount: Number(sample.activeEvidenceCount),
          taxEvidenceStatus: sample.taxEvidenceStatus,
          vendorNameSnapshot: sample.vendorNameSnapshot,
        }) as ExpenseAutoPostBlocker[],
      })),
    };
  }
}

@Injectable()
export class RunExpenseBackfillUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preview: PreviewExpenseBackfillUseCase,
    private readonly generateJournal: GenerateJournalFromSourceUseCase,
    private readonly expenseRepo: PrismaExpenseRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(
    ctx: RequestContext,
    input: { confirmed?: boolean; limit?: number } | undefined,
  ): Promise<ExpenseBackfillResult> {
    requireBackfillPermissions(ctx);
    if (input?.confirmed !== true) {
      throw new BadRequestException({
        code: 'expense_backfill_confirmation_required',
        message: 'กรุณาดูตัวอย่างและยืนยันก่อนลงบัญชีเอกสารย้อนหลัง',
      });
    }
    const before = await this.preview.execute(ctx, 0);
    const activationAt = new Date(before.activationAt);
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 20) || 20, 100));
    const rows = await this.prisma.client.$queryRaw<Array<{ id: string }>>(
      expenseBackfillCandidateSql(ctx.companyId, activationAt, ctx.scopes?.branchIds, limit),
    );
    let posted = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.generateJournal.execute(ctx, {
          companyId: ctx.companyId,
          sourceType: 'expense.record',
          sourceId: row.id,
        } as any);
        posted += 1;
      } catch (error) {
        failed += 1;
        await this.expenseRepo.updatePostingStatus(ctx.companyId, row.id, {
          postingStatus: 'posting_error',
          postingError: redactedExpensePostingError(error),
        });
      }
    }
    const after = await this.preview.execute(ctx, 0);
    const result: ExpenseBackfillResult = {
      activationAt: before.activationAt,
      eligibleAtStart: before.eligibleCount,
      attempted: rows.length,
      posted,
      failed,
      skipped: before.manualReviewCount,
      remaining: after.eligibleCount,
    };
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'ledger.expense_backfill.run',
      targetType: 'company',
      targetId: ctx.companyId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { ...result, limit },
    });
    return result;
  }
}
