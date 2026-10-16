# Agent Memory: mangmee-advisor-r5b-voucher-actions

Status: implementation complete and focused/regression specs passed; API typecheck did not complete, 2026-10-15. Uncommitted diff.
Owner: Round 5 lane B.
Scope: confirmed-expense voucher create/submit/approve/return/pay/cancel and paid-voucher 50 ทวิ through the existing private signed confirm cards; no READ tools, ภงด.3, new flags, dependencies or package.json edits.
Decisions:
- Extend expense.action.preview and its existing HMAC/store/replay/private webhook lifecycle.
- Keep the user's RequestContext unchanged; explicitly scoped internal LINE entry to the existing voucher use-case retains web endpoint denial and all repository guards.
- Create from grounded confirmed expenses using web's satang truncation of outstanding and existing payee/source preparation. Existing use-cases own tax, reservations, approval and payment.
- Certificate selects existing handoffs from voucher source expenses, uses the web issue use-case and existing payee-address save path; ask only for fields actually required by that use-case.
- Ground voucher references in shownItems of any voucher.* tool; expense references in expense shownItems/captures. Check feature entitlements again on press.
Open questions: none.
Artifacts: docs/plans/mangmee-advisor-full-capability-plan-th.md; /private/tmp/round-5-lane-b-last-message.md.
Verification:
- Reproducible commands: `/private/tmp/r5-checks.sh`. All added tests are in existing registered specs.
- Contracts build PASS (`/private/tmp/r5-contracts-final.log`); gateway package typecheck PASS (`/private/tmp/r5-gateway-typecheck-final.log`). API package-script typecheck did not complete: repeated runs stalled at full-Prisma-client structural comparisons, first in unchanged LineMessagingCredentialsService.get and then (during a reverted type-only narrowing experiment) unchanged auth OTP. Exact trace: `/private/tmp/r5-api-trace/trace.json`; log: `/private/tmp/r5-api-typecheck-trace.log`. A HEAD archive at `/private/tmp/r5b-typecheck-baseline` using the same installed dependencies and generated Prisma client reaches the same LINE-credential hotspot (`/private/tmp/r5-base-trace/trace.json`, `/private/tmp/r5-api-typecheck-baseline.log`). This reproduces the hotspot, not a completed baseline pass/failure. All diagnostic type changes outside task scope were reverted. Own check sessions were stopped individually; no unrelated process was stopped. API typecheck is not claimed passing.
- API focused + required full security/intake/webhook + issuer/handoff/DI specs: 1,130 PASS, 0 FAIL, 0 SKIP (`/private/tmp/r5-api-final.log`).
- Gateway full feature-coverage, orchestrator and intent-router specs: 214 PASS, 0 FAIL (`/private/tmp/r5-gateway-final.log`).
- W00 regenerated and independently checked: 5/5 PASS each (`/private/tmp/r5-manifest-update.log`, `/private/tmp/r5-manifest-parity.log`). Source hashes now include the shared action lane and voucher adapter.
- `git diff --check` PASS. No package.json, dependency, new flag, final-mutation-policy, ภงด.3, commit, deploy or cloud changes.
Integration evidence:
- `line-draft-update.security.spec.ts`, Round 5: all seven actions preview without writes, dispatch the matching existing use-case with the exact user ctx, reject permission/status/feature failures, revoked authority, stale revisions, foreign actor/tenant/membership/branch/chat/epoch/signature/payload, and execute once under concurrent presses. Any voucher.* shown tool is accepted; expense/category/claim/invented voucher refs refuse. Multi-expense create grounds every source.
- `expense-related-access.use-case.spec.ts`, Round 5: real web use-case/repository guards check confirmed sources, lifecycle eligibility, branch scope and source revision under the correction lock, without preview reservations/audits/writes. Ordinary HTTP LINE entry remains denied.
- LINE slip bytes are copied into the existing exclusive voucher upload, scanned/completed through the existing completion use-case, then attached using the unchanged exclusive-file guard and paid with its destination attachment. Existing source tenant/user/chat/revision/status/branch/active-file checks run before I/O and again before attachment; no generic attachment exclusivity rule was widened. Both real-path and action-dispatch specs prove stale/foreign/inactive evidence refusal.
- Certificate cards use one existing single-expense handoff per card; another pending source is offered after each successful issue, avoiding a partially issued batch. Selection survives the address answer. Existing issuer owns route readiness, source confirmation, identity and tax preconditions, number reservation, rendering, history and locking.
- Missing payee address asks one field, keeps the card unconfirmable, then saves via WhtCertificateHandoffUseCase.setPayeeAddress only after press and issues with that updated revision. Address and issue paths check expected revision. Current issuer does not require the payee tax ID; no new tax-ID requirement or tax rule was added. Certificate number and a web URI filtered to that number are returned. Stale issued-handoff replay refuses.
- Missing payment method asks one question and retains the selected payment date; existing planned method defaults remain authoritative. Return/cancel reasons use the same pending-field path.
- Gateway semantic/legacy planners accept only grounded IDs, expose the same preview with old draft switches off, and never acknowledge financial execution. URI/offer cards use the existing delivery proof/rehydration path. Nest export spec covers the existing voucher/issuer dependencies.
Open doubts / environment limits:
- No live LINE, browser/PDF visual inspection or PostgreSQL race run in this offline sandbox. Unit harnesses exercise the existing transaction boundaries; they are not proof of deployed behavior.
Next: review/integrate with lane 5A voucher READ tools; rerun the API package typecheck in an environment where its full Prisma structural comparison completes. Leave all changes uncommitted.
