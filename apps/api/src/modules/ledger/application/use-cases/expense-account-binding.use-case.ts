import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';

/**
 * Reads and writes the reviewed ledger account behind each expense category (audit CR-2).
 *
 * Deliberately guarded by `ledger.posting-rule.*` rather than `expense.category.manage`: naming the
 * account an expense lands in is the accounting decision the chart-of-accounts bootstrap spec calls
 * "reviewed", and whoever administers category names should not silently move where money is booked.
 * `ledger.posting-rule.manage` already existed in the permission registry with no route behind it —
 * this is that route.
 *
 * The accounting screens are closed to users this launch (owner decision 2026-08-09), so these are
 * API/operator endpoints with no UI of their own.
 */

export type ExpenseAccountBindingRow = {
  categoryId: string;
  categoryName: string;
  categoryStatus: string;
  /** Suggestion carried on the category. NEVER posting authority — see `ledgerAccountCode`. */
  accountHintKey: string;
  ledgerAccountCode: string | null;
  /** Resolved name of that code in this company's chart, or null when it no longer resolves. */
  ledgerAccountNameTh: string | null;
  /** False whenever posting this category would fail: unmapped, or mapped to an unusable account. */
  postable: boolean;
  /**
   * True while the binding is still the one onboarding seeded from the chart template. Postable
   * either way — this is the difference between an account the template chose and one a person
   * did, which is the whole review queue for an accountant taking over a new company.
   */
  awaitingHumanReview: boolean;
};

const SEEDED_REVIEWER_PREFIX = 'system:';

function seededBinding(reviewedByUserId: string | null | undefined): boolean {
  return typeof reviewedByUserId === 'string' && reviewedByUserId.startsWith(SEEDED_REVIEWER_PREFIX);
}

function assertPerm(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions?.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

/** Company chart rows a posting line may legally name, keyed by code. */
async function usableAccountsByCode(
  prisma: PrismaService,
  companyId: string,
  codes: string[],
): Promise<Map<string, { id: string; nameTh: string }>> {
  if (codes.length === 0) return new Map();
  const rows = await prisma.client.chartOfAccount.findMany({
    // Company rows only. A global system account is shared across tenants and is never a valid
    // target for one company's reviewed expense mapping.
    where: { companyId, code: { in: codes }, status: 'ACTIVE', isPosting: true, isControlled: false },
    select: { id: true, code: true, nameTh: true },
  });
  return new Map(rows.map((row) => [row.code, { id: row.id, nameTh: row.nameTh }]));
}

@Injectable()
export class ListExpenseAccountBindingsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: RequestContext): Promise<ExpenseAccountBindingRow[]> {
    assertPerm(ctx, 'ledger.posting-rule.read');
    const categories = await this.prisma.client.expenseCategory.findMany({
      where: { companyId: ctx.companyId },
      select: {
        id: true, name: true, status: true, accountHintKey: true,
        ledgerAccountCode: true, ledgerAccountReviewedByUserId: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const usable = await usableAccountsByCode(
      this.prisma,
      ctx.companyId,
      [...new Set(categories.map((category) => category.ledgerAccountCode).filter(Boolean))] as string[],
    );
    return categories.map((category) => {
      const account = category.ledgerAccountCode ? usable.get(category.ledgerAccountCode) : undefined;
      return {
        categoryId: category.id,
        categoryName: category.name,
        categoryStatus: category.status,
        accountHintKey: category.accountHintKey,
        ledgerAccountCode: category.ledgerAccountCode,
        ledgerAccountNameTh: account?.nameTh ?? null,
        postable: Boolean(account),
        awaitingHumanReview: seededBinding(category.ledgerAccountReviewedByUserId),
      };
    });
  }
}

@Injectable()
export class SetExpenseAccountBindingUseCase {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** `ledgerAccountCode: null` clears the binding, which returns the category to "not reviewed yet". */
  async execute(
    ctx: RequestContext,
    categoryId: string,
    input: { ledgerAccountCode: string | null },
  ): Promise<ExpenseAccountBindingRow> {
    assertPerm(ctx, 'ledger.posting-rule.manage');

    const category = await this.prisma.client.expenseCategory.findFirst({
      where: { id: categoryId, companyId: ctx.companyId },
      select: {
        id: true, name: true, status: true, accountHintKey: true,
        ledgerAccountCode: true, ledgerAccountReviewedByUserId: true,
      },
    });
    // Scoped by companyId, so a category belonging to another tenant — or a global default row,
    // which no single company may rebind — reads as not found rather than as a permission error.
    if (!category) throw new NotFoundException('Expense category not found for this company');

    const code = input.ledgerAccountCode?.trim() || null;
    let account: { id: string; nameTh: string } | undefined;
    if (code) {
      account = (await usableAccountsByCode(this.prisma, ctx.companyId, [code])).get(code);
      if (!account) {
        // One code covers every rejection reason on purpose: whether the account is missing,
        // archived, a header, or the suspense control account, the operator's next step is the same
        // — name a different account. The chart screen shows which.
        throw new BadRequestException({
          code: 'ledger_account_not_postable',
          accountCode: code,
          message: `บัญชี ${code} ใช้ลงรายการไม่ได้ — ต้องเป็นบัญชีของบริษัทนี้ที่ใช้งานอยู่ ลงรายการได้ และไม่ใช่บัญชีคุม`,
        });
      }
    }

    await this.prisma.client.expenseCategory.update({
      where: { id: categoryId },
      // Naming the account IS the review, so the same write records who attested it. Clearing the
      // binding clears the attestation with it — the category goes back to "nobody has decided".
      data: code === null
        ? { ledgerAccountCode: null, ledgerAccountReviewedByUserId: null, ledgerAccountReviewedAt: null }
        : { ledgerAccountCode: code, ledgerAccountReviewedByUserId: ctx.userId, ledgerAccountReviewedAt: new Date() },
    });

    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'ledger.expense-account-binding.set',
      targetType: 'expense_category',
      targetId: categoryId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      // Which account a category books to decides where money lands in the statutory accounts, so
      // the before/after pair is kept at the same risk level as a posting-rule change.
      riskLevel: 'HIGH',
      metadataJson: {
        categoryName: category.name, from: category.ledgerAccountCode, to: code,
        replacedSeededBinding: seededBinding(category.ledgerAccountReviewedByUserId),
      },
    });

    return {
      categoryId: category.id,
      categoryName: category.name,
      categoryStatus: category.status,
      accountHintKey: category.accountHintKey,
      ledgerAccountCode: code,
      ledgerAccountNameTh: account?.nameTh ?? null,
      postable: Boolean(account),
      awaitingHumanReview: false,
    };
  }
}
