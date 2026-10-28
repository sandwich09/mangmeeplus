import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { isFreeExpenseDraftCompany } from '../../system-partner-management/application/free-expense-access';

type AccessDb = Parameters<typeof isFreeExpenseDraftCompany>[0];

/** Re-read commercial/lifecycle state for direct tools and workers as well as HTTP sessions. */
export async function expenseDraftAccess(ctx: RequestContext, db?: AccessDb): Promise<boolean> {
  // Bare-constructed legacy unit fixtures have no database. Production repositories always do.
  if (!db) {
    if (ctx.freeExpenseDrafts) throw new ServiceUnavailableException('Expense access verification unavailable.');
    return false;
  }
  if (await isFreeExpenseDraftCompany(db, ctx.companyId)) return true;
  const company = await db.company.findUnique({ where: { id: ctx.companyId }, select: { status: true, archivedAt: true, planTerm: { select: { termEndsAt: true, termDisabledAt: true } } } });
  if (!company || company.status !== 'ACTIVE' || company.archivedAt || (company.planTerm && (company.planTerm.termDisabledAt || company.planTerm.termEndsAt <= new Date()))) {
    throw new ForbiddenException({ code: 'company_access_unavailable', message: 'ไม่สามารถใช้สิทธิ์ร้านนี้ได้ในขณะนี้' });
  }
  return false;
}

export async function assertExpenseFinancialAccess(ctx: RequestContext, db?: AccessDb): Promise<void> {
  if (await expenseDraftAccess(ctx, db)) {
    throw new ForbiddenException({ code: 'FREE_EXPENSE_DRAFTS_ONLY', message: 'สิทธิ์นี้ใช้สำหรับอ่านเอกสารและเก็บร่างรายจ่ายเท่านั้น' });
  }
}
