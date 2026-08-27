/**
 * LINE quick-capture branch default (Owner 2026-08-27, corrected same evening: "เป็นสาขาที่ user
 * นั้นอยู่"). A multi-branch company killed the LINE receipt capture AFTER a successful multi-call
 * OCR with TRANSACTION_BRANCH_REQUIRED — the LINE flow has no branch picker. Priority:
 *
 *   1. The user's OWN branch — `CompanyMembership.defaultBranchId` — when it is among the
 *      in-scope ACTIVE candidates (a stale/deactivated/out-of-scope assignment never wins).
 *   2. The single in-scope ACTIVE branch (nothing to choose).
 *   3. The sole ACTIVE head office (สาขาหลัก) — Owner-confirmed for both the owner account and a
 *      person assigned several branches with no designated default.
 *
 * The record lands in the review lane where the branch stays editable on the web. Anything still
 * ambiguous returns undefined and the caller answers honestly instead of guessing a branch into
 * an accounting record.
 */
export function pickLineDefaultBranchId(
  branches: ReadonlyArray<{ id: string; type: string }>,
  memberDefaultBranchId?: string | null,
): string | undefined {
  if (memberDefaultBranchId && branches.some((branch) => branch.id === memberDefaultBranchId)) {
    return memberDefaultBranchId;
  }
  if (branches.length === 1) return branches[0]!.id;
  const headOffices = branches.filter((branch) => branch.type === 'HEAD_OFFICE');
  return headOffices.length === 1 ? headOffices[0]!.id : undefined;
}
