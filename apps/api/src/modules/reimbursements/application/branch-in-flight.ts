import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Owner decision 2026-08-31 (D1): a branch may not be deactivated while reimbursement claims on it
 * are still moving.
 *
 * The failure this prevents is silent and permanent. `prepareClaimProjections`
 * (prisma-reimbursement.repository.ts) asserts the claim's branch is still ACTIVE when finance
 * completes it, and reimbursements expose no way to change a claim's branch after create — edit is
 * DRAFT-only and never writes `branchId`. So a claim whose branch closes after approval can neither
 * be paid nor moved, and only SQL frees it. Refusing the closure is the only fix that does not
 * either weaken the ledger's branch dimension or add a branch picker to every finance gate.
 *
 * Reimbursements only, deliberately. Procurement's gates require a non-empty branch but never
 * assert it is ACTIVE, so an open PO, goods receipt or vendor bill on a closed branch completes
 * normally today; widening this check would refuse closures that currently work.
 */
type InFlightPrisma = {
  client: { reimbursementRequest: { count(args: unknown): Promise<number> } };
};

/** Terminal states — a claim here has nothing left to project, so it cannot be stranded. */
const SETTLED = ['PAID', 'REJECTED', 'CANCELLED', 'VOIDED'];

export async function assertNoInFlightReimbursements(
  prisma: InFlightPrisma,
  companyId: string,
  branchId: string,
): Promise<void> {
  const open = await prisma.client.reimbursementRequest.count({
    where: { companyId, branchId, status: { notIn: SETTLED } },
  });
  if (open > 0) {
    throw new UnprocessableEntityException({
      code: 'branch_has_open_reimbursements',
      message: `Cannot deactivate a branch with ${open} reimbursement request(s) still in progress.`,
      openReimbursements: open,
    });
  }
}
