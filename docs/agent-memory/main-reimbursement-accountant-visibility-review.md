# Agent Memory: Main reimbursement accountant visibility review

Status: Closed based on the user's confirmation on 2026-08-27 that they already fixed this issue. Do not continue listing it as pending or ask the earlier tab question unless the user reopens it. Their fix's commit/deployment has not been independently verified; the source review below is historical evidence, not the cause or implementation of their fix.

Owner: Current backlog review task.

Scope:

- User: ADMIN submits a reimbursement successfully and it reaches รออนุมัติ; an accounting account cannot see it and asks whether they did something wrong.
- Freshly fetched main: `007dcba70376acb94aa5b55275840304cabd6f68` (unchanged).
- Read-only investigation of role grants, accounting template, list scope, approval queue, finance queue, branch/related-record boundaries, and existing tests. No product code, permissions, workflow policy, customer data, or deployment changes.

Decisions:

1. Distinguish general visibility, responsibility to approve, and finance processing. The submitting actor's ADMIN role does not by itself route a claim to accounting. The configured approval role and the persisted step assignment determine who gets an approval task.
2. On main the standard ACCOUNTANT role has `reimbursement.read` and `reimbursement.finance_review`, but not approve/reject/payment permissions. The accounting template includes `pack.reimbursement.review`, which also grants read/related/finance-review/export but not approval/payment. A custom role merely named บัญชี is not proof of those effective grants.
3. Main's รายการที่เกี่ยวข้อง tab chooses the broadest granted scope via `reimbursementListScope`: a `reimbursement.read` holder does not send `scope=related` and is not limited to their own/previously handled claims. The list use case and repository apply tenant and branch filters but no pending-status exclusion. Thus a standard accountant should be able to see this pending ADMIN claim in the list when company/branch/filters permit it. This list-scope correction exists in `48a60fa4 feat(access): support multi-role permission composition`, already in main.
4. The คิวการเงิน tab deliberately queries only FINANCE_REVIEW, READY_FOR_PAYMENT, and PARTIALLY_PAID. A PENDING_APPROVAL claim is not in this queue yet; absence here alone is expected, not a permission bug. The approval/finance state transition must not be bypassed to make it appear.
5. The คิวอนุมัติ tab is for decision-capable assigned actors or exact frozen assignees. Merely having the ACCOUNTANT role/read-all/finance-review does not grant approval responsibility. Branch and current active membership remain required. Changing a policy now must not silently reassign an already-submitted frozen approval step.
6. If the user cannot see it in รายการที่เกี่ยวข้อง either, investigate actual effective read permission (including persisted custom-role grants), same company, allowed/selected branch, current list filters, and served version. Do not diagnose live entitlement/role/cache/deployment state from source alone or simply tell them to wait for approval in all tabs.

Open questions:

- None pending: the user confirms this issue is fixed. The earlier tab and live-state questions are superseded for backlog tracking; no new live inspection or implementation is requested.

Artifacts:

- [Main ACCOUNTANT grants](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/auth/permission-registry.ts#L868).
- [Main broadest list scope](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/reimbursements/reimbursements.logic.ts#L210).
- [Main finance queue status filter](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.ts#L52).
- [Main approval assignment filter](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.ts#L139).
- [Main list tenant/branch query](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts#L1750).
- Relevant docs: auth-authorization-rbac-spec §8.2; reimbursement-approver-routing-policy spec and memory; accounting review capability pack/template.

Verification:

- Tests used exact-main snapshot `/tmp/mangmee-main-wht-vat.nbXuKs`; no checkout change.
- `./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec apps/api/src/modules/reimbursements/application/use-cases/reimbursement-related-access.use-case.spec.ts apps/api/src/modules/reimbursements/application/use-cases/reimbursement-branch-scope.use-case.spec.ts apps/api/src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts apps/api/src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.spec.ts apps/api/src/modules/employee-access/domain/logic/role-template-system-role-parity.spec.ts` — PASS 117 tests, 15 suites.
- `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/reimbursements/reimbursements.logic.spec.ts apps/web/src/features/reimbursements/reimbursements.model.spec.ts` — PASS 71 tests, 24 suites.
- Existing tests assert broadest read scope, finance queue status set, branch restrictions, and exact-assignee behavior. Total 188 passing tests, no skips. No browser/live-user reproduction.

Next:

- No further work; closed per user confirmation. Do not duplicate their fix, change permissions/policies, or imply independent merge/deployment verification.
