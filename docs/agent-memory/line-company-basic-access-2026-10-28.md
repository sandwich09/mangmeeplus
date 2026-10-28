# Agent Memory: LINE company selection and basic access

Status: Implementation and local verification complete; direct main/develop publication authorized by the user on 2026-10-28 without a PR. Deployment remains pending.
Owner: user / Codex.
Scope: Repair company selection looping back to the picker and audit existing unpaid/expired account navigation.
Decisions:
- Work from origin/develop 351dd92cd in an isolated worktree; the original checkout is older and has unrelated edits.
- The delivery formatter rewrites every field named text, including message-action commands. UUID/CUID company IDs become “ไม่ระบุ”, so the clicked command cannot match a membership.
- Fix the shared formatter used by legacy reply/push and delivery-v2. Preserve executable message text, postback data and URI targets; continue sanitizing display text.
- Basic access follows existing P29 and purchase recovery policy: company list/switch, login/account recovery, package management, company identity setup and contact remain available with their normal membership/permission checks.
- No new free ERP/AI/OCR entitlement, no schema/dependency change, no cloud operation or deploy.
- Publication scope: only this six-file patch, as a normal fast-forward to both main and develop. Fresh remote read found both at 351dd92cde1a187cb6dea64af12c5c21d969dd47, the tested base. Use an atomic push so either both refs advance or neither does; no force push.
- Repository workflows do not run CI or deploy on branch push. No PR or workflow dispatch is part of this publication.
Open questions: None for this repair. Expanding free business operations beyond existing policy needs a separate product decision.
Artifacts: line-language.logic.ts; existing delivery-plan, reply-adapter and process-line-webhook regression suites; line-rich-menu-v2-spec.md regression boundary.
Verification:
- Before fix: two wire/adapter regression tests failed because UUID and CUID actions became `/company ไม่ระบุ`; the picker→click→handler regression independently failed for the same reason.
- After fix: 939 tests passed, 0 failed/skipped. Includes six unpaid/expired selection cases (OWNER/STAFF × no package/expiry before sweep/expiry after sweep), foreign-company rejection, no model calls, unchanged body sanitization, immutable source messages and idempotent replay formatting.
- Command, from apps/api: `pnpm exec tsx --test --test-reporter=spec src/modules/line-ai/domain/logic/line-delivery-plan.logic.spec.ts src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts src/modules/line-ai/domain/logic/line-ai-classifier.spec.ts src/modules/auth/auth.guard.spec.ts src/modules/auth/line-handoff.spec.ts`.
- Contracts/config builds, local Prisma client generation and `pnpm --filter @watchdog-bms/api typecheck` passed. `git diff --check` passed.
- Local private logs: /tmp/line-company-basic-access-{red,roundtrip-red,tests,typecheck}.log.

Audit:

| Surface | Finding / evidence |
| --- | --- |
| Thai company picker | Confirmed bug for any UUID/CUID, independent of payment status. Shared formatter repaired. |
| Flex and Quick Reply message actions | Same formatter could alter any executable text containing IDs or normalized wording; all message-action text now stays exact. |
| Pagination, static menus, contact/package commands | Existing command matching and card suites pass; no additional payment dependency found in these account/public routes. |
| English company picker, business confirmation postbacks, web links | Data and URI fields were already preserved. Regression also proves visible labels/displayText are still cleaned. |
| Expired-company open-web | Existing picker chooses billing for plan managers and dashboard/recovery for staff; handoff tests cover expiry, fresh membership, token reuse and no security-hold bypass. |
| Login, company switcher, account recovery, profile and billing | AuthGuard exact recovery-route tests pass, including permission/legal checks and refusal of ordinary expense access. |
| Business questions and receipt uploads | Existing locked-company tests still refuse AI/OCR calls, retain neutral staff wording and direct authorized plan managers to package recovery. |

Limits: Unit/use-case evidence uses simulated persistence and intercepted provider transport. No live LINE message, real-browser session, real database, cloud read or payment was used. No layout or displayed-label change was made. This does not claim a complete audit of every ERP function or native LINE acceptance.
Next: Release through the repository deployment protocol when requested; then generate a fresh company card and confirm selection in native LINE. Previously delivered malformed buttons keep their old payload and cannot be repaired in place.
