import { Injectable } from '@nestjs/common';
import { requiredFeatureKeys } from '@watchdog-bms/contracts';
import { Prisma } from '../../../../generated/prisma/client';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { systemWorkerContext } from '../../../auth/domain/logic/system-worker-context';
import { PrismaService } from '../../../../common/database/prisma.service';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { PrismaReimbursementRepository } from '../../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { GenerateJournalFromSourceUseCase } from './journal.use-case';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';

/**
 * Auto-posting needs its own key AND every prerequisite the contracts matrix declares for it
 * (spec:264 — today `expense_auto_post ⇒ double_entry_ledger`). Derived, never re-typed, so the
 * worker cannot drift from the partner save guard.
 *
 * `expenses` is required on top of the matrix, and is NOT a contracts dependency on purpose: this
 * worker reads and WRITES `ExpenseRecord` rows (postingStatus/journalEntryId), so a frozen
 * `expenses` family (owner decision 2026-08-04 — disable stops the family and leaves its data
 * dormant) must stop the drain even while auto-post's own row is still ON. Declaring the dependency
 * instead would cascade `expense_auto_post` off and restamp its `updatedAt` activation cutoff on the
 * re-enable, permanently excluding everything pending at the freeze.
 */
export const AUTO_POST_REQUIRED_FEATURES = [
  'expense_auto_post',
  'expenses',
  ...requiredFeatureKeys('expense_auto_post'),
];
export const AUTO_POST_ENTITLEMENT_FILTER = AUTO_POST_REQUIRED_FEATURES
  .map((featureKey) => ({ featureEntitlements: { some: { featureKey, enabled: true } } }));
/** Owns `ReimbursementPayment`. Not a requirement of the drain — it gates the claim-payout branch only. */
const CLAIM_PAYMENT_FEATURE = 'reimbursement';

const NOOP_SHADOW = {
  startSweep: () => ({ record: async () => undefined, flush: async () => ({}) }),
} as unknown as LaunchShadowProbe;

export const EXPENSE_AUTO_POST_WORKER_PERMISSIONS = [
  'expense.read',
  'journal.entry.create',
  'journal.entry.post',
] as const;

function workerContext(companyId: string): RequestContext {
  return systemWorkerContext({
    requestId: `expense-auto-post-${companyId}-${Date.now()}`,
    companyId,
    permissions: EXPENSE_AUTO_POST_WORKER_PERMISSIONS,
    authSubject: 'expense-auto-post-worker',
  });
}

export type AutoPostSourceType = 'expense.record' | 'expense.payment' | 'reimbursement.payment';

/**
 * Claim payouts (2026-10-01). Same gates as an expense payment — recorded, still pending, created
 * at or after the activation boundary, no generated journal yet — and the same "a settlement waits
 * for its accrual" rule, which for a claim is `assertSettlementPostingReady`: every claim line has a
 * projection that is either a posted accrual or a confirmed duplicate needing none. A suspected
 * duplicate or an accrual still waiting keeps the payment OUT of the candidate set, so it stays
 * `pending` instead of being attempted, refused and marked `posting_error` once a minute.
 * This is a pre-filter only: the generator repeats the proof and stays authoritative.
 */
function claimPaymentCandidateSql(companyId: string, activationAt: Date): Prisma.Sql {
  return Prisma.sql`
      UNION ALL
      SELECT 'reimbursement.payment'::text AS "sourceType", payment."id" AS "sourceId",
        payment."createdAt" AS "eventAt", 2 AS "sortOrder"
      FROM "ReimbursementPayment" AS payment
      WHERE payment."companyId" = ${companyId}
        AND payment."status"::text = 'RECORDED'
        AND payment."postingStatus"::text = 'pending'
        AND payment."createdAt" >= ${activationAt}
        AND EXISTS (
          SELECT 1
          FROM "ReimbursementLine" AS line
          WHERE line."companyId" = payment."companyId"
            AND line."reimbursementRequestId" = payment."reimbursementRequestId"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "ReimbursementLine" AS line
          WHERE line."companyId" = payment."companyId"
            AND line."reimbursementRequestId" = payment."reimbursementRequestId"
            AND NOT EXISTS (
              SELECT 1
              FROM "ExpenseRecord" AS projection
              WHERE projection."companyId" = line."companyId"
                AND projection."sourceReimbursementRequestId" = line."reimbursementRequestId"
                AND projection."sourceReimbursementLineId" = line."id"
                AND (
                  (
                    projection."duplicateStatus"::text = 'CONFIRMED_DUPLICATE'
                    AND projection."postingStatus"::text = 'not_required'
                  )
                  OR (
                    projection."duplicateStatus"::text NOT IN ('POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE')
                    AND projection."status"::text = 'CONFIRMED'
                    AND EXISTS (
                      SELECT 1
                      FROM "JournalEntry" AS accrual
                      WHERE accrual."companyId" = projection."companyId"
                        AND accrual."sourceType" = 'expense.record'
                        AND accrual."sourceId" = projection."id"
                        AND accrual."entryType"::text = 'GENERATED'
                        AND accrual."status"::text = 'POSTED'
                    )
                  )
                )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "JournalEntry" AS journal
          WHERE journal."companyId" = payment."companyId"
            AND journal."sourceType" = 'reimbursement.payment'
            AND journal."sourceId" = payment."id"
            AND journal."entryType"::text = 'GENERATED'
        )
  `;
}

export function expenseAutoPostCandidateSql(
  companyId: string,
  activationAt: Date,
  limit: number,
  includeClaimPayments = true,
): Prisma.Sql {
  return Prisma.sql`
    SELECT candidate."sourceType", candidate."sourceId"
    FROM (
      SELECT 'expense.record'::text AS "sourceType", expense."id" AS "sourceId",
        expense."confirmedAt" AS "eventAt", 0 AS "sortOrder"
      FROM "ExpenseRecord" AS expense
      WHERE expense."companyId" = ${companyId}
        AND expense."status"::text = 'CONFIRMED'
        AND expense."postingStatus"::text = 'pending'
        AND expense."confirmedAt" >= ${activationAt}
        AND btrim(coalesce(expense."vendorNameSnapshot", '')) <> ''
        AND expense."taxEvidenceStatus"::text NOT IN ('NEEDS_REVIEW', 'NOT_TAX_EVIDENCE')
        -- A receipt-less claim projection is evidenced by its signed ใบเบิก (owner decision
        -- 2026-08-10): the confirm gate accepted the claim's missing-receipt reason under the
        -- projection authority, so the accrual must not wait for an attachment that can never
        -- be added to a confirmed record.
        AND (
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
          OR (
            expense."sourceReimbursementRequestId" IS NOT NULL
            AND btrim(coalesce(expense."missingReceiptReason", '')) <> ''
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "JournalEntry" AS journal
          WHERE journal."companyId" = expense."companyId"
            AND journal."sourceType" = 'expense.record'
            AND journal."sourceId" = expense."id"
            AND journal."entryType"::text = 'GENERATED'
        )
      UNION ALL
      SELECT 'expense.payment'::text AS "sourceType", payment."id" AS "sourceId",
        payment."createdAt" AS "eventAt", 1 AS "sortOrder"
      FROM "ExpensePayment" AS payment
      INNER JOIN "ExpenseRecord" AS expense
        ON expense."companyId" = payment."companyId" AND expense."id" = payment."expenseId"
      WHERE payment."companyId" = ${companyId}
        AND payment."status"::text = 'RECORDED'
        AND payment."postingStatus"::text = 'pending'
        AND payment."createdAt" >= ${activationAt}
        AND expense."status"::text = 'CONFIRMED'
        AND expense."sourceReimbursementRequestId" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "JournalEntry" AS accrual
          WHERE accrual."companyId" = expense."companyId"
            AND accrual."sourceType" = 'expense.record'
            AND accrual."sourceId" = expense."id"
            AND accrual."entryType"::text = 'GENERATED'
            AND accrual."status"::text = 'POSTED'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "JournalEntry" AS journal
          WHERE journal."companyId" = payment."companyId"
            AND journal."sourceType" = 'expense.payment'
            AND journal."sourceId" = payment."id"
            AND journal."entryType"::text = 'GENERATED'
        )
      ${includeClaimPayments ? claimPaymentCandidateSql(companyId, activationAt) : Prisma.empty}
    ) AS candidate
    ORDER BY candidate."eventAt" ASC, candidate."sortOrder" ASC, candidate."sourceId" ASC
    LIMIT ${limit}
  `;
}

export function redactedExpensePostingError(error: unknown): string {
  const response = typeof (error as { getResponse?: unknown })?.getResponse === 'function'
    ? (error as { getResponse: () => unknown }).getResponse()
    : null;
  const code = response && typeof response === 'object' && typeof (response as { code?: unknown }).code === 'string'
    ? (response as { code: string }).code
    : 'AUTO_POST_FAILED';
  return `ลงบัญชีอัตโนมัติไม่สำเร็จ (${code.slice(0, 80)})`;
}

export type ExpenseAutoPostDrainResult = {
  companies: number;
  candidates: number;
  posted: number;
  failed: number;
};

@Injectable()
export class DrainExpenseAutoPostUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generateJournal: GenerateJournalFromSourceUseCase,
    private readonly expenseRepo: PrismaExpenseRepository,
    private readonly reimbursementRepo: PrismaReimbursementRepository,
    private readonly shadow: LaunchShadowProbe = NOOP_SHADOW,
  ) {}

  async execute(requestedLimit = 20): Promise<ExpenseAutoPostDrainResult> {
    const limit = Math.max(1, Math.min(Math.trunc(requestedLimit) || 20, 100));
    const allActiveCompanies = await this.prisma.client.company.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        featureEntitlements: {
          where: { featureKey: { in: [...AUTO_POST_REQUIRED_FEATURES, CLAIM_PAYMENT_FEATURE] } },
          select: { featureKey: true, enabled: true, updatedAt: true },
        },
      },
    });
    const shadow = this.shadow.startSweep(SHADOW_SURFACES.expenseAutoPostDrain);
    try {
      for (const company of allActiveCompanies) await shadow.record(company.id, 'expense_auto_post');
      const companies = allActiveCompanies.filter((company) =>
        AUTO_POST_REQUIRED_FEATURES.every((featureKey) =>
          company.featureEntitlements.some((row) => row.featureKey === featureKey && row.enabled)));

      let candidates = 0;
      let posted = 0;
      let failed = 0;
      for (const company of companies) {
        const activationAt = company.featureEntitlements.find((row) => row.featureKey === 'expense_auto_post')?.updatedAt;
        if (!activationAt) continue;
        // Freeze in place, the rule `expenses` follows in AUTO_POST_REQUIRED_FEATURES: a disabled
        // `reimbursement` family leaves its payments dormant. Only an explicit OFF row freezes — with
        // `expenses` ON (required here) a company without the row inherits the family, exactly as
        // the canonical entitlement evaluator reads it.
        const claimPayments = !company.featureEntitlements.some((row) => row.featureKey === CLAIM_PAYMENT_FEATURE && !row.enabled);
        const rows = await this.prisma.client.$queryRaw<Array<{ sourceType: AutoPostSourceType; sourceId: string }>>(
          expenseAutoPostCandidateSql(company.id, activationAt, limit, claimPayments),
        );
        candidates += rows.length;
        const ctx = workerContext(company.id);
        for (const row of rows) {
          try {
            await this.generateJournal.execute(ctx, {
              companyId: company.id,
              sourceType: row.sourceType,
              sourceId: row.sourceId,
            } as any);
            posted += 1;
          } catch (error) {
            failed += 1;
            const postingError = redactedExpensePostingError(error);
            if (row.sourceType === 'reimbursement.payment') {
              // The payment row has no postingError column; the status alone hands it to the
              // accountant's worklist, where a retry shows the reason.
              await this.reimbursementRepo.updatePaymentPostingStatus(company.id, row.sourceId, { postingStatus: 'posting_error' });
            } else if (row.sourceType === 'expense.payment') {
              await this.expenseRepo.updatePaymentPostingStatus(company.id, row.sourceId, { postingStatus: 'posting_error', postingError });
            } else {
              await this.expenseRepo.updatePostingStatus(company.id, row.sourceId, { postingStatus: 'posting_error', postingError });
            }
          }
        }
      }
      return { companies: companies.length, candidates, posted, failed };
    } finally {
      await shadow.flush();
    }
  }
}
