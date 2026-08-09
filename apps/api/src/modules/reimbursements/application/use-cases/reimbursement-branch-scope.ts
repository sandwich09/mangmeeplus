/**
 * Branch ABAC (10D) for reimbursements, in one place because it was previously in four and missing
 * from seven (audit H-2).
 *
 * The rule is the module-wide one: an undefined scope is unrestricted, and a null branchId is
 * company-central and reachable by everyone. What made the gaps hard to see is that the queues are
 * scoped at the repository — `listRequests` folds in `branchScopeWhere` — so a branch-restricted
 * user never sees another branch's claim in a list, and the module looks enforced. Every write here
 * takes an id, though, and an id needs no list to guess.
 *
 * Shaped like banking's `bank-branch-scope.ts` rather than a per-file copy of the check: the same
 * assertion in seven files is seven chances for the eighth to be forgotten.
 */
import { ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';

export function assertReimbursementBranchInScope(
  ctx: RequestContext,
  branchId: string | null | undefined,
): void {
  if (!isBranchInScope(ctx.scopes ?? {}, branchId)) {
    throw new ForbiddenException('Branch is outside your assigned branch scope.');
  }
}
