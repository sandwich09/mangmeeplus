import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';

/** Activation uses the saved scope, never a wider grant hidden in a status command. Call under Company lock. */
export async function assertEmployeeActivationScope(tx: Prisma.TransactionClient, companyId: string, membershipId: string, requesterBranchIds?: string[]) {
  const membership = await tx.companyMembership.findUniqueOrThrow({ where: { id: membershipId, companyId },
    select: { branchScopeMode: true, defaultBranchId: true, branchScopes: { select: { branchId: true } } } });
  const all = membership.branchScopeMode === 'ALL_BRANCHES';
  const ids = membership.branchScopeMode === 'DEFAULT_BRANCH_ONLY' ? (membership.defaultBranchId ? [membership.defaultBranchId] : []) : membership.branchScopes.map(s => s.branchId);
  if (requesterBranchIds !== undefined && (all || !ids.length || [...ids, ...(membership.defaultBranchId ? [membership.defaultBranchId] : [])].some(id => !requesterBranchIds.includes(id))))
    throw new ForbiddenException("Cannot activate access outside the requester's branch scope.");
  const available = await tx.branch.count({ where: { companyId, status: 'ACTIVE', ...(all ? {} : { id: { in: ids } }) } });
  const validDefault = !membership.defaultBranchId || await tx.branch.count({ where: { companyId, id: membership.defaultBranchId, status: 'ACTIVE' } }) === 1;
  if (!available || !validDefault || (!all && membership.defaultBranchId && !ids.includes(membership.defaultBranchId))) throw new ConflictException({ code: 'EMPLOYEE_BRANCH_SCOPE_UNAVAILABLE',
    message: 'สาขาที่พนักงานมีสิทธิ์หรือสาขาเริ่มต้นยังใช้ไม่ได้ แก้ให้เป็นสาขาที่ใช้งานได้ก่อนเปิดสิทธิ์อีกครั้ง' });
}
