# Agent Memory: line-ai-workflow-first

Status: DRAFT — documents only; R4-F2 CLOSED (focused review 2026-10-26); owner Q1–Q3 and MC1 remain open; A9/A10 moved to expense-trust-and-money-fixes; per-step engineering prerequisites remain; Re-anchored to develop e7c422802 on 2026-11-04; controller accepted 2026-11-04 (R26 package/knowledge fallback and R27 free no-AI admission checked against code)
Owner: LINE AI documents lane; controller assigns implementation after documents review
Related: `docs/specs/line-ai-workflow-first-spec.md`, `docs/specs/line-ai-measurement-and-eval-spec.md`, `docs/plans/line-ai-workflow-first-plan.md`, `docs/specs/expense-trust-and-money-fixes-spec.md`, `docs/plans/expense-trust-and-money-fixes-plan.md`
Baseline: HEAD `e7c4228026eec3c696fa76986420d2c97cb26676`, tree `1034bf4789c15b460ff2e293be912142f62954c9`, re-opened in this worktree 2026-11-04; earlier measurements and review dates remain historical


Scope:
- Docs-only round 2: restore valid eval cases and re-anchor only workflow spec, measurement spec, plan and this memory to develop `e7c422802` (2026-11-04). No code/corpus/package edits, network, cloud, build or runtime execution.
- Paid workflow ceiling stays starter plus entitled withholding; free never-paid source drafts are below the ceiling and reuse D04, three monthly document reads, source-only persistence and existing commercial/permission gates.

Decisions:
- **R4-F2 remains CLOSED.** Current buffer fast path excludes company commands (`apps/api/src/modules/line-ai/application/line-message-buffer.service.ts:510–511`), worker awaits dispatch (:707), commands are singleton groups (`apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts:399–401`), orphan replay preserves envelope (`apps/api/src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.ts:89,233`). A2 excludes only its three new controls; keep AC22 fresh/frozen/company-order regressions on free and paid paths.
- A9/B6: **moved to expense-trust-and-money-fixes, step 2 / P07 (R6)**. A10/B7: **step 1 / P04 (R5)**; A10/B8: **step 3 / P10 (R9)**. No duplicated fixes; current evidence still shows them. Classifier integrates the existing shared acceptance boundary once P07 lands.
- A6a/A6b ceiling stays: only sold workflow help actions and the single `expense_month` fixed read (`apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:155`). Both builders (:173–176, :579–581) and parser (:943–960) are named in the plan. Unsold formatter/conversion/workflow/tool/read work stays out; knowledge/package-boundary regressions remain allowed.
- **M-R14 correction:** all 19 originally cut conversations in measurement §3 are retained with unchanged ids: T-120/T-126/T-128 general knowledge; T-130–T-138/T-140 package replies; four H-outofpackage cases, H-auditor-general-vat and complete A-accountant-help-and-scope. They test sold behaviour; source corpora are untouched. Keep T-139 lower-pack WHT denial. Baseline/candidate use identical whole-conversation manifests/digests.
- R26/AC25 preserves both paid paths: business general knowledge gets the existing advisor answer; unavailable shop data gets the existing fixed package reply with no unsold tool, fabricated figure or mutation claim, no model-free conversion and no new refusal-specific charge. Reuse `scopePolicyOverride` (`apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts:406,417`), sole-clause call (`orchestrator.agent.ts:1168–1175`) and per-clause call (`semantic-turn-v2.ts:692–717`), without rewriting policy.
- `no_tool` checks ERP calls (`scripts/line-ai-expense-advisor/scorer.ts:366`), not zero model cost. Paid admission/settlement and R12 still apply; restored general knowledge may use the advisor. Free D04 explicitly overrides paid Q&A eligibility.
- R27/AC26 preserves the existing free early return (`apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6933–6942`) before intake (`process-line-webhook.use-case.ts:7050`): zero classifier/intake/planner/compose calls, no paid claim/payment/tax workflows. Welcome receipt, menu/services, support/company/package commands and package-advisor URI retain their current gates. Source OCR is the existing exception, not free typed questions.
- All R/M-R ids have path applicability in the specs. Q1 cannot bypass D04. Plain Thai, one short refusal sentence, same-message recovery, existing permissions/recipients, no new dependency/environment switch. Preserve existing expense activity history/audit; opening a card, modal or advisor never adds a business save.

Develop already fixed/changed (current code, not live verification):
- `049aa51de`: free source drafts and text-model refusal exist; keep quota/commercial/attachment implementation (`free-expense-quota.ts:9,21–28`; `expense-commercial-access.ts:22–25`; `free-expense-attachment.ts:23–26`). A1/B4 integrate around them, not rebuild them.
- `9036b8552`: welcome receipt alias (`line-staff-menu.logic.ts:885`) and package-advisor URI (`apps/api/src/modules/external-signup/application/line-signup-notify.service.ts:453–457`) exist. Preserve them; no new advisor/welcome work.
- `3f6db1729`: already-accepted confirmation duplicate is suppressed for the same recipient/chat/channel/proof (`apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:3717–3731`). A5/A8 shrink to preservation regressions around this; expiry B1/B4 is still separate work.
- `1fbba874e`/`884ba5307`: the concise activity modal exists (`apps/web/src/features/expenses/ExpenseHistoryModal.tsx:77–96`), update hooks exist (`apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:1207–1212`) and the free route allows history reads (`apps/api/src/modules/system-partner-management/application/free-expense-access.ts:78`). No history implementation here.
- `48295b57c`: picker commands survive delivery because `lineCustomerVisibleText` preserves message-action text (`apps/api/src/modules/line-ai/domain/logic/line-language.logic.ts:7–14`); existing registered adapter test at `line-reply.adapter.spec.ts:10`. The brief calls this a message-buffer change; code places it in the display transformer. Preserve both payload and buffer order; no duplicate picker fix.
- Citation/numeric correction: current prompt source (`semantic-turn-v2.ts:89`, file history `73a28b6d5`) does not support the old 12,782-character assertion, which is removed. Calibration already has two sizes with one bound (`intake-token-calibration.ts:9–16`, `62d6b4393`); no prompt/calibration implementation is added.
- Company commands currently retain order (`line-message-buffer.service.ts:510–511,707`; `line-message-buffer.logic.ts:399–401`); R4-F2 stays closed. Current buffer history includes `de9832352` and `c1adb5e56`; no new ordering implementation is inferred from the re-anchor.

Current-code bugs/gaps (static evidence; not reproduced):
- Existing B1/B4 expiry (120 seconds, `line-draft-preview.store.ts:33,215–224`), B2 invalid payee discards pending action (`line-expense-action.service.ts:988`), B3 intake before greeting (`process-line-webhook.use-case.ts:7050,7668`; flag `packages/config/src/index.ts:326`) and B5 pause allowlist (`process-line-webhook.use-case.ts:6636–6652`) remain. B6/B7/B8 remain trust/money-owned; no closed implementation claim.
- G19 remains a separate ordering hazard for existing non-company stateful controls (`line-message-buffer.service.ts:475,510–511`); A2 scope does not expand.
- **New G21, in scope R15/R27/A1:** free Q&A refusal has no same-message exit and the edit constant suggests editing without checking update access (`apps/api/src/modules/line-ai/domain/logic/free-expense-line.logic.ts:1–2`; `process-line-webhook.use-case.ts:6938–6939`). Delivery only derives media choices or links from the text (`process-line-webhook.use-case.ts:2669–2679`; `line-business-card.logic.ts:462–474`). Plan reuses `lineChoiceQuickReply` plus current read/update predicates for a permitted expense-list or support exit; no new capability.
- G22/MG11 is a **corrected document error**, not a code defect: general knowledge and package refusal cases already match scope policy; the round-1 exclusions are withdrawn.
- New G23, out of scope: history labels still include `ยกเลิกรายการบัญชี`, `ปรับข้อมูล VAT`, `ตัดสินใจเครดิตภาษีซื้อ` (`apps/web/src/features/expenses/expense-history.logic.ts:11,15–16`), displayed by `ExpenseHistoryModal.tsx:89`; record for the wording lane, no new history work here.
- MB1 hardcoded provider (`scripts/line-ai-expense-advisor/run-real.ts:220`), MB3 reused attempt ids (`scripts/line-ai-reliability-runtime.ts:436`) and spend-erasing resets (:92,372; `gold-oracle-pass.ts:128`; `run-preflight.ts:79`) still require Phase M. No newly fixed finding was kept as implementation work.

Weekly-summary handoff (outside this turn's four-file edit allowlist):
- A free shop receives **no proactive weekly summary** under source-drafts-only scope; no opt-in, paid dashboard/pending-payment link, WHT/tax reminder or invented confirmed-spend total. It retains ordinary source-read results/quota notices. Existing free route/permission allowlists include expense/history reads, not dashboard/notification settings (`apps/api/src/modules/system-partner-management/application/free-expense-access.ts:58–83`).
- The unchanged summary spec §1 still says never-paid expired shops are uniformly blocked, which `049aa51de` changed; §4 admits `expense.read` actors without a free-cohort qualification, but that key can survive the free intersection (:61,:67–68 above). Controller/summary lane must add explicit paid eligibility before opt-in/read/send. No summary files were edited here.
- Current daily-summary sweep selects active companies (`apps/api/src/modules/dashboard-notifications/application/use-cases/notification-sweeps.use-cases.ts:115–121`) and its creator selects owner/admin recipients and dashboard links (`notification.use-cases.ts:303–325`); no explicit free-cohort exclusion appears at those boundaries. This is an out-of-scope static gap for the summary lane, not proof that a free shop received a notice. Do not expand this LINE plan into notification implementation.

Open questions:
- Q1: paid zero-AI steps free and started tasks continue after credit exhaustion? Recommend yes; free D04 remains unchanged.
- Q2: move only the classifier to Haiku 5.5 after MA4? Recommend measured/provider-proven pass first.
- Q3 / measurement Q1: evaluation budget? Recommend 2,000 THB; historical estimates are not current quotes.
- MC1: creator-only draft picker without read scope? Recommend existing creator-limited action rights; owner must decide.
- No new owner-policy question: free D04 and retained knowledge/package coverage are explicit instructions, not inferred preferences.

Artifacts:
- Workflow spec: 27 R ids, AC1–AC26; new R26/AC25 and R27/AC26, current develop dispositions and complete traceability.
- Measurement spec: 14 M-R ids, MA1–MA6; 19 restored conversations, free/paid applicability, unchanged module ceiling and traceability.
- Plan: original 31 step ids/dependencies preserved, now mapped to R26/R27 where relevant; first tests use existing registered API/Gateway/harness files.

Verification:
- Read mandatory AGENTS, ponytail full, Thai UX and October owner decisions; traced current worktree code, scope-policy callers, corpus expectations and merged free/welcome/delivery/history changes. No network.
- API `grep -c` registrations rechecked 2026-11-04; positive counts retained in the plan. These are registration evidence, not test results.
- Round-2 static audit PASS: 41 requirement trace rows, AC1–AC26/MA1–MA6 intact, 31 original plan steps; 52 literal evidence quotes (≤15 words) match their cited lines. All 501 explicit path/alias citation endpoints resolve in 103 current files. All 11 API trace test paths are package-listed; the plan separately records all 16 listed API regression paths. `git diff --check` passed. Round-1 multi-spec counts are historical.
- No API/Gateway/harness/PG/browser tests, schema commands, provider calls, cloud operations, builds, commits, pushes or deploys. Browser checks remain planned at 390, 1280 and about 1556, using existing `e2e/journeys/*.journey.spec.ts` handoffs.

Next:
- Controller reviews these four docs; summary lane handles the explicit free-cohort handoff in its own files. Preserve Q1–Q3/MC1, R4-F2 closed and external P04/P07/P10 ownership.
- Implement only separately authorized steps after prerequisites; current free/source/welcome/dedupe/history behaviour is preserved, not reimplemented.
