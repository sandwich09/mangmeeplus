# Agent Memory: Main Check-bill Guided Routing Review

Status: Remaining-gap implementation and develop delivery complete on 2026-08-27 by `/root/wht_units_mixed_vat`. Code `32ed42f2`, final remote feature/develop `dbf1501a2b6292e748fe558d99685d912ce2190e`; parent fetch/ancestry confirmed. No live operation or deployment.
Owner: Root coordinates; `/root/wht_units_mixed_vat` implements the new check-bill recovery completion task.
Scope: Fix remaining inline/wizard eligibility mismatch, actionable messages, preservation of the same expense facts, and separate payment proof for Check bill substitute preparation.

Decisions:
- Main fetched 2026-08-27: `007dcba70376acb94aa5b55275840304cabd6f68`. Check-bill core fix `8de195cb` is already in main (PR #228 per implementation memory).
- Initial turn was backlog review. User subsequently explicitly authorized remaining fixes and agent-led branch/test/develop delivery, clarifying Check bill is a list of items but not a receipt. This still does not authorize cancelling the actual hotel expense, creating a replacement live expense, changing unrelated cash policy, or deploying. No actual hotel image, expense record, or live classification was inspected; supplied date/vendor/amount are example facts only.
- Read exact-main check-bill spec/plan/memory and earlier no-invoice routing docs. The newer 2026-08-25 product decision explicitly supersedes the temporary create-Manual/cancel-original workaround: reuse the same expense and preserve the original attachment/classification.
- Ponytail full used for narrow observation probes against the existing functions; no application logic, dependencies, or package.json changed.

Already implemented on main:
- `CheckBillGuidanceCard` explains the document is not yet a receipt, asks whether payment happened, offers final-receipt upload, and offers the paid/no-receipt wizard route for reviewers.
- The normal unresolved `ORDER_OR_CHECK_BILL` state hides inline preparation through `canShowInlineSubstitutePreparation`, opens the evidence/recovery path, and blocks normal forward/send/confirm actions. Cancel/delete remains in permission-checked secondary actions.
- The route links to `/expenses/substitute-receipts/new?expenseId=...&route=check-bill`. The Next page forwards both props, and the wizard loads the same saved expense rather than creating a new Manual expense. Existing date/lines/total remain on that expense; vendor prefills payee and active original attachments are selected as supporting evidence, separately from payment attachments.
- Prepare sends `routeCheckBill: true`; API checks authoritative raw classification plus the existing permission, branch, positive THB total, category, evidence, payment and revision rules. The repository records `ROUTED_TO_SUBSTITUTE_RECEIPT`, `SUPPORTING_ONLY`, and `NON_CLAIMABLE` atomically with prepared evidence, preserving raw classification and source type. Existing signing/approval lifecycle remains.

Remaining gaps verified:
1. Inline flow still exists for non-blocked classifications. A valid `FINANCE_OVERRIDDEN_AS_EXPENSE` resolution on an original check bill makes `isNonExpenseClassificationBlocking` false, removes the check-bill recovery card, and re-enables inline preparation. The inline call omits `routeCheckBill`; API still rejects the raw `ORDER_OR_CHECK_BILL` as `document_kind_ineligible`. The ordinary wizard candidate filter also excludes it. This reproduces the late-refusal family after finance correction, although the initial unresolved case has been fixed.
2. `collectSubstituteReceiptEligibilityIssues` computes stable codes, but `validateEligibility` throws most issues as `BadRequestException(issue.message)` without a code. The actual post-override refusal still becomes the generic Thai 400 toast. Code-to-message labels existing in web alone do not solve this. The existing plan's all-known-errors-coded and canonical-wizard goals are not fully implemented despite its memory describing the core as complete.
3. Current Thai description ends “จึงยังส่งตรวจหรือบันทึกบัญชีไม่ได้”, lacking the explicit “ด้วยเอกสารใบนี้เพียงใบเดียว” qualifier requested by the user and the spec. The heading/actions improve understanding, but the body can still sound like rejection of the underlying real expense.
4. Separate payment evidence is required for non-cash and strict cash-policy companies only. `CASH` with `ALLOW_SUPPORTING_EVIDENCE_ONLY` (including the no-policy default) can prepare without separate payment proof. An existing test explicitly allows a routed check bill under that policy. This matches the existing spec's cash-policy exception, but not the new proposal to require actual payment evidence for every check bill. Changing it would be a scoped policy change, not just a toast fix.

Open questions:
- Resolved by the user's instruction to fix the reported remaining gaps: require separate payment proof for Check bill substitute preparation, including cash under permissive/default policies. Keep ordinary non-check-bill cash policy unchanged; no retroactive mutation of issued historical certificates.
- Parent explained existing same-expense behavior before authorization. User asked to fix what remains, so preserve that behavior rather than introduce a duplicate Manual expense or auto-cancel flow.
- No blocking product question for this scope. Agent must escalate any new ambiguity rather than broaden data/deployment authority.

Artifacts:
- New worktree: `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-check-bill-recovery-completion`.
- Branch: `codex/check-bill-recovery-completion`, created from freshly fetched `origin/develop` `0b611f14e03ae407d6d210790b60c3ce3d883448` (PR #312) on 2026-08-27.
- Agent implementation evidence belongs in the new worktree's `docs/agent-memory/check-bill-recovery-completion.md`; prior WHT/login worktrees stay untouched.
- Exact-main snapshot: `/tmp/mangmee-main-wht-vat.nbXuKs`.
- `apps/web/src/features/expenses/ExpensesPages.tsx`: recovery card line 429, same-expense route line 486, helper use line 674, inline prepare line 723, conditional form line 987.
- `apps/web/src/features/expenses/expenses.model.ts`: `isBlockedCheckBillClassification` and `canShowInlineSubstitutePreparation` near lines 265–280.
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`: classification/forward/confirm gates and secondary reject/delete controls near lines 473–636.
- `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx`: same-expense load line 779, supporting preselection line 737, evidence requirement line 1109, route input line 1143.
- `apps/web/src/features/expenses/substitute-receipt-wizard.model.ts`: candidate eligibility near line 186.
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`: eligibility collector line 158, un-coded throw line 224, cash proof rule near line 477.
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`: same-transaction routing resolution near line 1405, tax state update near line 1454.
- `packages/contracts/src/expenses.ts`: classification resolution validation near line 105.
- `apps/web/src/common/i18n/workspace-dictionary.ts`: check-bill copy at lines 747–765 and English counterparts.
- Source-of-truth docs: `docs/specs/expense-check-bill-guided-routing-spec.md`, `docs/plans/expense-check-bill-guided-routing-plan.md`, and `docs/agent-memory/expense-check-bill-guided-routing.md` read from main.
- Temporary observations: snapshot `check-bill-api-review.probe.spec.ts` and `apps/web/src/features/expenses/check-bill-web-review.probe.spec.ts`. These intentionally assert current gaps, not desired post-fix behavior.

Verification:
- In the main snapshot: `./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.substitute-number.spec.ts apps/api/src/modules/expenses/domain/logic/expense-status.logic.spec.ts` — 90/90 passed, including same-expense routed check bill, cash-policy exception, signed lifecycle, and atomic tax/resolution persistence.
- `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/expenses/expenses.model.spec.ts apps/web/src/features/expenses/substitute-receipt-wizard.model.spec.ts apps/web/src/features/expenses/expense-review-steps.logic.spec.ts apps/web/src/common/api/api-error-message.spec.ts apps/web/src/common/i18n/workspace-i18n.spec.ts` — 139/139 passed.
- API probe using the real preparation use case and real toast translator with a fake repository — 1/1 passed: after finance override, normal classification is unblocked; prepare rejects raw check bill before any persistence; body has no code and shows the reported generic 400 wording.
- Web probes using actual model functions — 2/2 passed: normal unresolved case hides inline; finance-overridden raw check bill reopens inline while the normal wizard excludes it.
- Total: 229 existing tests + 3 observation probes = 232 passed. Passing observation tests confirms remaining bugs, not a completed fix.
- API preparation, wizard page, and wizard candidate model have no changes between reviewed main and fetched develop `3a39d95d856df9883661194eaf9e8c363f1f9781`.
- No browser/live UAT or Production verification this turn. No cloud operation, real bill cancellation, account, session, database, or application source mutation.

Next:
- Delivery complete: implementation `32ed42f2`, merge `b601472c` includes employee/password work through `aa003846`, verification `959b1e95`, final delivery `dbf1501a2b6292e748fe558d99685d912ce2190e`. Feature/remote verified by agent; parent fetched and confirmed containment in newer develop. Worktree clean.
- New preparation uses the canonical same-expense wizard; raw persisted classification derives Checkbill routing even after finance override or direct links. Separate actual payment proof is mandatory for Checkbill, including cash/permissive/no-policy cases, without changing ordinary cash rules. Structured eligibility codes and localized actionable errors/copy replace generic failures.
- Post-merge tests: API 357, web 373, contracts 45, suite registration 3 passed; retained boundary 107 + attachment 3 checks also passed. Owned API/web typechecks passed. No package/lock/schema/dependency changes.
- Synthetic browser exercised raw/deep-link/reload/post-finance-override/CASH-proof/English actual-API toast+inline and valid PREPARED progression preserving ID/date/vendor/2883.65/source attachment and SUPPORTING_ONLY/NON_CLAIMABLE. No duplicate/cancel/auto-issue. Physical mobile viewport was not exercised because the attempted iframe preview was CSP-blocked; CSP was not weakened. No live DB/UAT/deployment tests.
- Full evidence: `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-check-bill-recovery-completion/docs/agent-memory/check-bill-recovery-completion.md`. No required implementation remains. Original delegation scope retained below as history.
- Agent owns scoped spec/plan updates, implementation, and focused API/web/LINE caller regressions. Parent continues next backlog intake.
- Preserve authoritative raw classification, same-expense provenance, supporting/payment separation, tax non-claimability, role/tenant/branch checks, and atomic revision/idempotency/audit boundaries; keep final-receipt replacement and existing signing/approval flows.
- Verify post-finance-override and direct-link recovery, code-to-toast feedback, check-bill cash/non-cash proof rules, unaffected ordinary cash, existing saved facts/files, stale/retry behavior, and local synthetic browser flow. No live bill/account/database operation or deploy.
- Fetch/merge/retest latest develop before normal non-force feature/develop push; coordinate common error/dictionary files with the draft-employee agent and preserve prior login/password/date deliveries. No package.json changes or shared generated-artifact writes.
