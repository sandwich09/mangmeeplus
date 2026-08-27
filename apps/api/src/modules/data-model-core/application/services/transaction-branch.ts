import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../../../common/database/prisma.service';
import { isBranchInScope, type BranchScopes } from '../../domain/logic/branch.logic';

type BranchDb = Pick<PrismaService['client'], 'branch'>;

export function requireTransactionBranchId(branchId: string | null | undefined): string {
  if (!branchId?.trim()) {
    throw new UnprocessableEntityException({
      code: 'TRANSACTION_BRANCH_REQUIRED', message: 'กรุณาเลือกสาขาของรายการก่อนบันทึก',
    });
  }
  return branchId;
}

export async function assertActiveTransactionBranch(db: BranchDb, companyId: string, branchId: string | null | undefined): Promise<void> {
  const id = requireTransactionBranchId(branchId);
  if (!await db.branch.findFirst({ where: { id, companyId, status: 'ACTIVE' }, select: { id: true } })) {
    throw new UnprocessableEntityException({
      code: 'TRANSACTION_BRANCH_INVALID', message: 'ไม่พบสาขาที่ใช้งานได้ในบริษัทนี้ กรุณาเลือกสาขาอีกครั้ง',
    });
  }
}

/** Selection wins. Exactly one available branch may default; an all-branch read scope may not. */
export async function resolveTransactionBranchId(
  db: BranchDb, companyId: string, scopes: BranchScopes, selectedBranchId?: string | null,
): Promise<string> {
  if (selectedBranchId) {
    if (!isBranchInScope(scopes, selectedBranchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    await assertActiveTransactionBranch(db, companyId, selectedBranchId);
    return selectedBranchId;
  }
  const branches = await db.branch.findMany({
    where: { companyId, status: 'ACTIVE', ...(scopes.branchIds && { id: { in: scopes.branchIds } }) },
    select: { id: true }, take: 2,
  });
  return requireTransactionBranchId(branches.length === 1 ? branches[0]!.id : null);
}
