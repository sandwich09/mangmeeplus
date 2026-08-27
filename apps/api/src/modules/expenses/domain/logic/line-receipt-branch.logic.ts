/**
 * LINE quick-capture branch default (Owner 2026-08-27). A multi-branch company killed the LINE
 * receipt capture AFTER a successful multi-call OCR with TRANSACTION_BRANCH_REQUIRED — the LINE
 * flow has no branch picker. Thai registration always designates a head office (สำนักงานใหญ่), so
 * when the shared resolver would be ambiguous the capture defaults to the single in-scope ACTIVE
 * HEAD_OFFICE branch; the record lands in the review lane where the branch stays editable on the
 * web. Anything still ambiguous (no HQ in scope, or several) returns undefined and the caller
 * answers honestly instead of guessing a branch into an accounting record.
 */
export function pickLineDefaultBranchId(branches: ReadonlyArray<{ id: string; type: string }>): string | undefined {
  if (branches.length === 1) return branches[0]!.id;
  const headOffices = branches.filter((branch) => branch.type === 'HEAD_OFFICE');
  return headOffices.length === 1 ? headOffices[0]!.id : undefined;
}
