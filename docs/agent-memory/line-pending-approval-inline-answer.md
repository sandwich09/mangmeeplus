# Agent Memory: LINE pending-approval card answers inline

Status: Implemented, unit-verified, not yet deployed to UAT.
Owner: thawatchai
Scope: `apps/api/src/modules/line-ai` (staff menu logic + webhook use case), `apps/api/src/modules/procurement/procurement.module.ts`.

Decisions:
- Owner feedback 2026-08-19: "รายการรออนุมัติ" is a query, so the card must answer it — มี/ไม่มี, first 5 rows, web link for the rest. The old card only linked out.
- Counts are read through the SAME permission-checked use cases the web queue pages call
  (`ListApprovalQueueUseCase`, `ListPurchaseRequestsUseCase`, `ListPurchaseOrdersUseCase`), never a
  repository. Reimbursement keeps approver-eligibility + self-approval filtering; procurement
  approval is permission + branch scope, so listing `PENDING_APPROVAL` in scope equals what the
  member may approve.
- A queue that cannot be read (missing `read` permission, or the query threw) is LEFT OUT of the
  card rather than shown as 0 — "nothing pending" and "nobody asked" must not look the same.
- A queue read and known empty loses its web button; there is nothing to open.
- Deps are `@Optional()`, so a context without them degrades to the old link-only card.

Open questions:
- Procurement PR/PO counts need `procurement.*.read` in addition to `.approve`; a company that
  grants approve without read gets the link-only wording. Left as-is until a real role does that.

Artifacts:
- `line-staff-menu.logic.ts`: `pendingApprovalSurfaceKeys`, `PendingApprovalQueues`,
  `PENDING_APPROVAL_ITEM_LIMIT = 5`, data-driven `buildPendingApprovalCard`.
- `process-line-webhook.use-case.ts`: `loadPendingApprovalQueues` + `formatApprovalAmount`.
- `procurement.module.ts`: exports `ListPurchaseRequestsUseCase`.

Verification:
- `npx tsx --test src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts` → 25/25 pass.
- `npx tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` → 73/73 pass.
- `npx tsc --noEmit -p apps/api/tsconfig.json` → clean.

Next:
- Verify on UAT LINE OA with a company that has both reimbursement and procurement approvals.
