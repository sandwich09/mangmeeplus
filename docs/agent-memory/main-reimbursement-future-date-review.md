# Agent Memory: Main reimbursement future-date review

Status: Main review complete on 2026-08-27: future-date restriction was not implemented there. User authorized implementation; agent `/root/reimbursement_no_future_dates` completed and pushed feature/develop at `bd43d9aea45c24b9f262425a60c8e712034e6b04`. No UAT/Production deployment.

Owner: Current backlog review task for evidence/coordination; `/root/reimbursement_no_future_dates` for implementation, verification, and develop integration.

Scope:

- User says the Date Picker should not allow selecting a future date. Interpret in the current reimbursement discussion as the date on an incurred-expense claim line; do not silently apply a global past-only policy to due dates, appointments, future-effective settings, or search filters.
- Freshly fetched remote main remains `007dcba70376acb94aa5b55275840304cabd6f68`.
- Read-only review of shared date picker, reimbursement create/edit/payment inputs, web validation, runtime DTOs, shared domain validation, and civil-date helpers. No application/permission/policy/deployment changes.

Decisions:

1. `ThemedDate` already accepts `min`/`max` and disables out-of-range day/month grid cells. The reimbursement create/edit line at ReimbursementCreatePage.tsx:275 passes no max, so future days are selectable. The payment-date picker also passes no max; that adjacent observation is not authorization to change unrelated flows.
2. `validateRequestForm` checks that incurredDate is present, not that it is today or earlier. API `ReimbursementLineDto` uses IsDateString(strict), which validates format/calendar validity but not a today ceiling. `validateLines`, used by create/update/submit, also checks presence without an upper date bound.
3. Isolated executable probes confirm create/update DTOs and the shared domain line validator accept the valid date `2099-12-31`. No actual database write or API call was made. These probes record the bug and are not proposed regression expectations for a fix.
4. The smallest correct implementation should reuse the picker max prop and existing civil-date helpers while enforcing the same rule in frontend validation and the shared API/domain boundary. Today and past dates remain allowed; future line dates fail with an actionable line-specific message. Submit must also revalidate existing future-dated drafts; do not silently clamp/change stored dates or mutate historical approved claims.
5. Compare calendar dates in the company's business timezone (existing default Asia/Bangkok), not UTC-day slices or browser-local clocks. `todayCivilDate` and related helpers already exist in contracts. Check Bangkok midnight, month/year boundaries, and differing browser/server zones.
6. Shared picker caveat: its วันนี้/เดือนนี้ shortcut currently calls emit directly and uses browser-local today; it does not consult min/max. A future fix must ensure the shortcut cannot bypass the configured ceiling, particularly for a browser ahead of company time. Keep the generic picker opt-in via min/max rather than globally banning future dates.

Open questions:

- Resolved: user answered “ใช่” to the clarification that the new agent should fix future dates on reimbursement incurred-date pickers and test/push into develop. The copied “notification bug” wording does not authorize a duplicate of the already-delivered notification task.
- No extra question is needed for the scoped status report. If the user intends the restriction across all date fields, inventory field semantics first rather than applying a blanket rule. The present review is scoped to reimbursement incurred dates.

Artifacts:

- [Main incurred-date picker](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx#L275).
- [Main shared date bounds](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/common/components/field/ThemedDate.tsx#L58) and [today shortcut](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/common/components/field/ThemedDate.tsx#L260).
- [Main web validation](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/reimbursements/reimbursements.logic.ts#L162).
- [Main DTO date validation](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/reimbursements/presentation/http/reimbursement.dtos.ts#L32) and [shared line validation](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts#L123).
- [Existing company civil-date helper](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/packages/contracts/src/civil-date.ts#L95).
- Temporary observation probe: `/tmp/mangmee-main-wht-vat.nbXuKs/apps/api/src/modules/reimbursements/presentation/http/reimbursement-future-date-review.probe.spec.ts`.
- Relevant docs inspected: reimbursement-journey-uplift-spec per-line/header date rules; reimbursement-approval-spec.

Verification:

- Used exact-main snapshot `/tmp/mangmee-main-wht-vat.nbXuKs`, not the dirty root plan checkout.
- `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/common/components/field/ThemedDate.spec.ts apps/web/src/features/reimbursements/reimbursements.logic.spec.ts packages/contracts/src/civil-date.spec.ts` — PASS 75 tests, 23 suites.
- `./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec apps/api/src/modules/reimbursements/presentation/http/reimbursement-future-date-review.probe.spec.ts apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.spec.ts apps/api/src/modules/reimbursements/presentation/http/reimbursement.dtos.spec.ts` — PASS 73 tests, 21 suites (71 existing plus 2 observation probes).
- Total: 146 existing tests plus 2 probes passed; probes confirm the missing guard rather than a fix. No browser or live UAT verification.

Next:

- Develop delivery complete: implementation `fb8b5854`, integration merge `19311157` includes develop `11bc6893`, final delivery `bd43d9aea45c24b9f262425a60c8e712034e6b04`. Agent verified both remote branches after atomic non-force push; its worktree is clean.
- Post-merge checks: Web 176 and API 208 passed (384 total); eight PostgreSQL tests skipped without DATABASE_URL. Web typecheck and contracts build passed. API typecheck remains blocked by two pre-existing auth imports of locally missing `@aws-sdk/client-ses`; no package.json changes made.
- Actual local browser checks passed desktop/mobile, including future draft correction, today/past selection, blocked future cells, and shortcut bounds. No live account/database operations or deploy. Full implementation evidence is in the isolated worktree's `docs/agent-memory/reimbursement-no-future-dates.md`.
- Created `codex/reimbursement-no-future-dates` in `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-reimbursement-no-future-dates`, based on freshly fetched develop `3b8bfd137db0786441874214acce9a41eb5c2137`. Agent `/root/reimbursement_no_future_dates` confirmed starting; parent continues the next password-error backlog review.
- Agent owns scoped docs/code/tests and normal non-force develop integration, preserving current data, draft recovery, permission/tenant/branch/CAS boundaries, and generic date picker opt-in min/max behavior. No payment-date/global date-policy expansion, deployment, live database operation, or shared generated/dependency writes. Implementation memory belongs in the isolated worktree.
