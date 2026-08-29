# Agent Memory: transaction-branch-backfill

Status: migration written + dry-run proven on UAT DB (BEGIN/ROLLBACK) 2026-08-29; shipping to develop→main→UAT
Owner: MangmeeDev
Scope: legacy rows created before 88aef194 (2026-08-27) enforced TRANSACTION_BRANCH_REQUIRED were stranded — the Owner hit it live on UAT: reimbursement "อนุมัติจ่าย" refused RB-202608-00002 (branchId NULL) and nothing offers a way to set the branch afterwards.
Decisions:
- Full-flow audit 2026-08-29 (all 28 call sites of requireTransactionBranchId/resolveTransactionBranchId/assertActiveTransactionBranch + aliased requireExpenseBranchId):
  - STRANDED, no setter: ReimbursementRequest (assertDecisionBranch ×10 + pay ×2 + evidence validate; edit is DRAFT-only AND the edit UI hides TransactionBranchField when editing AND update ignores branchId) and procurement (GR from PO, supplier payment from bill, PO from PR, bill from source doc — no branch-edit lane found).
  - Gated but has an escape hatch: ExpenseRecord (review lane edits branch; LINE capture defaults via pickLineDefaultBranchId), AccountingDocument (update accepts branchId; NULL also still means company-central — deliberately NOT backfilled), manual journal (draft re-save fills line defaults — not backfilled; posted lines are history).
- Owner picked ทาง B (2026-08-29 "จัดไป ทาง B เลย"): one-time SQL backfill, same priority the Owner confirmed 2026-08-27 for the LINE lane — sole ACTIVE branch → it; else sole ACTIVE HEAD_OFFICE → it; else leave NULL and report (never guess).
- Rejected: pay-time branch picker (would need ~14 pickers across gates), grandfather clause (branchless accounting rows forever).
- updatedAt deliberately untouched (expectedUpdatedAt optimistic checks keep matching); attachments referenced by backfilled claims (line evidence + primaryAttachmentId) inherit the claim's branch when NULL so the DRAFT-edit evidence-equality check cannot re-strand the same claim.
Artifacts:
- `apps/api/prisma/migrations/20260829170000_backfill_transaction_branch_defaults/migration.sql` (tables: ExpenseRecord, ReimbursementRequest, PurchaseRequest, PurchaseOrder, GoodsReceipt, VendorBill, AttachmentObject follow-claims)
Verification:
- UAT dry-run via SSM tunnel (infra/uat/db-port-forward.sh), whole migration inside BEGIN…ROLLBACK: BEFORE NULLs 12/155/0/1/3/0 (+241 attachments) → AFTER 0 across every transactional table, 9 claim attachments aligned; RB-202608-00002 resolves to its company's Head Office. Gotcha: launching the tunnel through `| head` kills it via SIGPIPE once output exceeds the pipe — run it unpiped in background.
Open questions:
- Production may hold the same stranded rows; this migration rides the normal release so production heals on its next deploy — do NOT ship the 10D enforcement era to production without it.
- Residual corner (accepted): a legacy DRAFT claim whose evidence already carries a DIFFERENT non-null branch than the backfilled header will hit the evidence-equality error on edit; resolved by a person.
Next: PR → develop → release → main → deploy UAT (migration applies for real) → verify RB-202608-00002 non-null + Owner retries อนุมัติจ่าย.
