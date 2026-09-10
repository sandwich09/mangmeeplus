import { ConflictException } from '@nestjs/common';

const terminalClaims = ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'];
export type FundingEvidenceIds = { attachmentIds: string[]; expenseIds: string[] };

/** Use the existing reimbursement exclusion keys on both sides of the source/claim boundary. */
export async function lockFundingEvidence(tx: any, companyId: string, ids: FundingEvidenceIds): Promise<void> {
  if (!ids.expenseIds.length && !ids.attachmentIds.length) return;
  // Expand to the whole known relation before locking. Starting from a secondary file must not
  // lock it first and discover an earlier-sorted sibling only after another transaction owns it.
  for (;;) {
    const size = ids.expenseIds.length + ids.attachmentIds.length;
    const related = await tx.attachmentLink.findMany({ where: { companyId, targetType: 'expense.record', OR: [
      { targetId: { in: ids.expenseIds } }, { attachmentId: { in: ids.attachmentIds } },
    ] }, select: { attachmentId: true, targetId: true } });
    ids.expenseIds = [...new Set([...ids.expenseIds, ...related.map((r: any) => r.targetId)])].sort() as string[];
    ids.attachmentIds = [...new Set([...ids.attachmentIds, ...related.map((r: any) => r.attachmentId)])].sort() as string[];
    if (ids.expenseIds.length + ids.attachmentIds.length === size) break;
  }
  const keys = [...ids.attachmentIds.map(id => `attachment:${id}`), ...ids.expenseIds.map(id => `expense:${id}`)].sort();
  for (const key of keys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:reimbursement-evidence:${key}`}))`;
  }
}

export async function lockExpenseFunding(tx: any, companyId: string, expenseId: string): Promise<void> {
  await lockFundingEvidence(tx, companyId, { expenseIds: [expenseId], attachmentIds: [] });
}

export async function assertFundingMutation(tx: any, companyId: string, expenseId: string, kind: 'payment' | 'confirm' | 'prepare' | 'supersede'): Promise<void> {
  const expense = await tx.expenseRecord.findFirst({ where: { companyId, id: expenseId }, select: { sourceReimbursementRequestId: true, sourceReimbursementLineId: true } });
  const source = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId, expenseId }, orderBy: { version: 'desc' } });
  const links = await tx.attachmentLink.findMany({ where: { companyId, targetType: 'expense.record', targetId: expenseId }, select: { attachmentId: true } });
  const claim = await tx.reimbursementLine.findFirst({ where: { companyId,
    // A claim's own payable is expected to share its manual receipt. Exclude only that
    // exact originating line; another claim or the original source remains protected.
    ...(expense?.sourceReimbursementRequestId && expense.sourceReimbursementLineId ? { NOT: { id: expense.sourceReimbursementLineId, reimbursementRequestId: expense.sourceReimbursementRequestId } } : {}),
    request: { status: { notIn: terminalClaims } }, OR: [
    { linkedExpenseId: expenseId }, { attachmentId: { in: links.map((r: any) => r.attachmentId) } },
  ] } });
  if (claim) throw new ConflictException({ code: 'substitute_source_has_live_claim', message: 'หลักฐานนี้อยู่ในคำขอเบิกแล้ว กรุณาดำเนินการผ่านคำขอเบิกเดิม' });
  if ((kind === 'payment' || kind === 'confirm') && source?.fundingSource === 'PERSONAL_ADVANCE') {
    throw new ConflictException({ code: 'substitute_personal_settles_via_reimbursement', message: 'ใบรับรองนี้ระบุว่าพนักงานจ่ายร้านแล้ว การคืนเงินให้พนักงานต้องดำเนินการแยกตามขั้นตอนการเงิน' });
  }
}
