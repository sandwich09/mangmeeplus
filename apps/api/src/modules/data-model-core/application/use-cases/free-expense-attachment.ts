import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { PrismaService } from '../../../../common/database/prisma.service';
import { isBranchInScope } from '../../domain/logic/branch.logic';
import { freeExpenseAllowanceSnapshot } from '../../../line-ai/application/free-expense-quota';

/** Internal admission identity; never accepted from an upload DTO or attachment metadata. */
export type FreeExpenseUploadReservation = { eventId: string; monthKey: string; sourceRoute: 'receipt-ocr-line'; requestId: string };
export type FreeExpenseAttachmentSource = { expenseId?: string; captureGroupId?: string; freeOcrReservation?: FreeExpenseUploadReservation };
type Db = PrismaService['client'];

/** A selected ID is untrusted input; derive provenance only after tenant/owner/state checks. */
export async function freeExpenseAttachmentSource(db: Db, ctx: RequestContext, source: FreeExpenseAttachmentSource, write: boolean) {
  const record = source.expenseId
    ? await db.expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: source.expenseId }, select: { id: true, branchId: true, createdByUserId: true, status: true, captureSource: true, lineMessageId: true } })
    : source.captureGroupId ? await db.expenseCaptureGroup.findFirst({ where: { companyId: ctx.companyId, id: source.captureGroupId }, select: { id: true, branchId: true, createdByUserId: true, status: true, handoffState: true } }) : null;
  const stateAllowed = source.expenseId ? ['DRAFT', 'NEEDS_REVIEW'].includes(record?.status ?? '')
    && 'captureSource' in (record ?? {}) && ['LINE_UPLOAD', 'WEB_UPLOAD'].includes((record as any).captureSource)
    : record?.status === 'OPEN' && (record as any)?.handoffState === 'NONE';
  const owner = record?.createdByUserId === ctx.userId;
  const canReadCompany = ctx.permissions.includes('expense.read');
  const canReadOwn = owner && ['expense.read_own', 'expense.receipt.upload', 'expense.receipt.line_upload'].some(permission => ctx.permissions.includes(permission));
  if (!record || !stateAllowed || !isBranchInScope(ctx.scopes ?? {}, record.branchId)
    || (write ? !owner : !canReadOwn && !canReadCompany)
    || (write && !['expense.receipt.upload', 'expense.receipt.line_upload'].some(p => ctx.permissions.includes(p)))) {
    throw new ForbiddenException({ code: 'FREE_EXPENSE_DRAFTS_ONLY', message: 'ไฟล์ต้องผูกกับร่างรายจ่ายที่มีสิทธิ์ใช้งาน' });
  }
  const member = await db.companyMembership.findFirst({ where: { companyId: ctx.companyId, userId: ctx.userId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
    select: { branchScopeMode: true, defaultBranchId: true, branchScopes: { select: { branchId: true } } } });
  if (!member || record.branchId && member.branchScopeMode !== 'ALL_BRANCHES'
    && (member.branchScopeMode === 'DEFAULT_BRANCH_ONLY' ? member.defaultBranchId !== record.branchId : !member.branchScopes.some(scope => scope.branchId === record.branchId))) {
    throw new ForbiddenException('Source membership or branch access changed.');
  }
  return { id: record.id, branchId: record.branchId, kind: source.expenseId ? 'EXPENSE' : 'CAPTURE_GROUP',
    lineMessageId: source.expenseId && 'lineMessageId' in record ? record.lineMessageId : null,
    captureSource: source.expenseId && 'captureSource' in record ? record.captureSource : null };
}

export async function verifyFreeExpenseUploadReservation(
  prisma: PrismaService, companyId: string, reservation: FreeExpenseUploadReservation, lineMessageId: string | null | undefined,
): Promise<void> {
  const event = await prisma.client.companyOcrUsageEvent.findUnique({ where: { id: reservation.eventId } });
  if (reservation.sourceRoute !== 'receipt-ocr-line' || !lineMessageId || reservation.requestId !== lineMessageId
    || !event || event.companyId !== companyId || event.sourceRoute !== reservation.sourceRoute || event.requestId !== reservation.requestId
    || event.monthKey !== reservation.monthKey || event.quotaSource !== 'FREE_MONTHLY_3' || event.succeededAt !== null || event.billingReceiptGrantId !== null) {
    throw new ForbiddenException({ code: 'FREE_EXPENSE_UPLOAD_RESERVATION_INVALID', message: 'สิทธิ์อ่านเอกสารนี้ไม่ตรงกับไฟล์ที่กำลังส่ง' });
  }
}

export async function assertFreeExpenseUploadAvailable(
  prisma: PrismaService, companyId: string, reservation?: FreeExpenseUploadReservation, lineMessageId?: string | null,
): Promise<string> {
  if (reservation) await verifyFreeExpenseUploadReservation(prisma, companyId, reservation, lineMessageId);
  const allowance = await freeExpenseAllowanceSnapshot(prisma, companyId, reservation?.monthKey);
  // An admitted LINE read already occupies its own slot. Only its exact pending event may
  // finish storage; all other events remain in the frozen month's admission total.
  const occupied = allowance.usedCount + allowance.inFlightCount - (reservation ? 1 : 0);
  if (occupied >= allowance.limit) throw new HttpException({ code: allowance.usedCount >= allowance.limit ? 'FREE_DOCUMENT_LIMIT_REACHED' : 'FREE_DOCUMENTS_IN_FLIGHT', message: allowance.usedCount >= allowance.limit ? 'ใช้สิทธิ์อ่านเอกสารฟรีครบ 3 ใบในเดือนนี้แล้วค่ะ' : 'กรุณารอเอกสารที่กำลังอ่านให้เสร็จก่อนค่ะ' }, HttpStatus.TOO_MANY_REQUESTS);
  const pending = await prisma.client.attachmentObject.count({ where: {
    companyId, status: { in: ['PENDING_UPLOAD', 'ACTIVE'] }, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    metadataJson: { path: ['freeExpenseUploadMonth'], equals: allowance.monthKey },
  } });
  if (pending >= 3) throw new HttpException({ code: 'FREE_DOCUMENTS_IN_FLIGHT', message: 'กรุณาใช้ไฟล์ที่ส่งไว้หรือลองอ่านไฟล์เดิมอีกครั้งค่ะ' }, HttpStatus.TOO_MANY_REQUESTS);
  return allowance.monthKey;
}
