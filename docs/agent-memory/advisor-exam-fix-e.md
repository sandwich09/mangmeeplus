# Agent Memory: advisor-exam-fix-e

Status: Implementation and offline verification complete, 2026-10-17; base 24d3545c2; uncommitted; finished in about 19 minutes within the 60 minute cap.
Owner: Codex, only lane E; ponytail full; no subagents.
Scope: C05 exact failing routes and continuation; J7 create help and purpose continuation; preserve D1a/D1b/D2.
Decisions:
- Keep the existing metered intake, AI budget profiles/call boundaries, draft ownership, tenant/branch/permission/source-state guards, evidence receipts and human final buttons. No flags, dependencies, package.json edits, cloud operations or final-mutation changes.
- E1: ordered continuations now show the short “ทำขั้นตอนถัดไป” button, preserving its original immutable source selection and a fresh metered intake on the next press. Two exact failing router JSONs replay through signed controller → webhook use case → real counterparty use cases → real CaptureLineExpenseNoteUseCase/CreateExpenseDraftUseCase → real LINE payload. They reach a saved DRAFT expense (unconfirmed and unpaid) with gross 10,000, withholding 300, net 9,700, and the confirmed counterparty tax identity/address. Certificate issuance remains pending its normal checks and human action.
- E2a: source words select create/submit/cancel/approve/reject/pay; an approval toolHint only retains the existing help admission/call boundary and cannot invent the approval verb. The multi-help composer uses each clause’s source text too. Strip the submit phrase and expense nouns from action-verb matching so “ส่ง…อนุมัติ” and “ค่าใช้จ่าย” cannot trigger another verb’s refusal. Use canonical ROLE_GRANTS in the 3-role × 6-operation table, with extra create/submit sibling phrases and a multi-help case.
- E2b: after metered intake, a plain amount-free answer with an active CREATE preview can update that same preview even when the router says CLARIFY or BUSINESS_EXPENSE and omits taskRef/purpose. Reuse D’s source-validated purpose proposal, preserve amount/date/category/evidence, invalidate the old signed confirm card, and save only after the new confirm button. Amount-bearing captures, questions and explicit commands do not become a purpose. D’s linked semantic continuation and foreign-task refusal remain covered.
C05 trace comparison / causality:
- Turn 0: all runs send the same 50 ทวิ how-to guide; fail2 omits its optional WHT toolHint without changing that answer.
- Turn 1 passing: top-level EXPENSE_DOCUMENT_CAPTURE, captureHints supplied, third goal is WHT calculation without “50 ทวิ”; existing order is expense → counterparty → WHT.
- Turn 1 failing twice: top-level BUSINESS_READ_QUESTION with a typed capture clause and third goal naming “50 ทวิ”; existing orderedExpenseWrites intentionally orders counterparty → expense → certificate.
- Passing turns 2–3 select and confirm the counterparty after the expense already exists, then offer WHT. Failing turn 2 confirms the counterparty and offers the retained expense; the harness stops without pressing that next button.
- orderedExpenseWrites is byte-identical on a0d21cb15 and 24d3545c2. Both failing routes also continue successfully on the unchanged 24d3545c2 production code when the returned original button is pressed (baseline replay selector uses the existing button text).
- No fix-D authority/writeIndexes/return-null change diverts C05: it invokes no reimbursement draft tool. The scope-rule reorder concerns reject/approve; orchestrator’s change concerns help text; read filter binding is unrelated. Fix D adds nine LINE_CHAT_ACTIONS, which the intake serializes as chatActions; observed provider route variation cannot establish that prompt change as its cause offline.
- The supplied “passing” summary itself says partial: cert=[] voucher=[] expense=[DRAFT/UNPAID 10000.0000 wht 300.0000]. It is not evidence of an issued certificate; this change does not claim one.
Product / architecture / integration evidence:
- Exact E1 (both failing routes), E2a and E2b controller/use-case/delivery replays pass, alongside the D1a/D1b/D2 replays. The E2b sibling BUSINESS_EXPENSE label also continues the same claim without a new capture.
- Exact E2a/E2b fail on the starting commit 24d3545c2, reproducing the wrong approval refusal and funding-source ask respectively; both pass with this diff.
- Existing full API C05 voucher/50 ทวิ signed-card suite remains part of the required package run; monetary mutation and certificate issuance retain their original use-case checks.
Open questions / limits:
- A new live-model/LINE/DB exam and real-browser visual evidence were unavailable in this offline sandbox. No web screen was changed. No live certificate issuance or model pass-rate improvement is claimed.
- The causal link between D’s changed router prompt input and C05’s changed model output is unproven; the deterministic sequence itself is unchanged and works on the starting commit.
Artifacts:
- docs/evidence/advisor-exam-e-router-replays.json: exact failing user inputs/router JSON and recorded task projections; fresh test server identities, evidence and grants are used at replay time.
- .live/exam/e-verification/: full package argv/TAP, all whole-chain suites, exact replays, baseline comparison and c05-root-cause.json (untracked).
- docs/research/mangmee-ai-capability-manifest-2026-09-27.json: W00 regenerated after the required gate; only source hash/digest and generation/checkout metadata changed.
Verification:
- Focused exact controller/use-case/delivery replays and retained D checks: 7/7 pass. Gateway role/verb, sibling/multi-help and existing call-boundary regressions: 120/120 pass (including all 24 role/phrase cases and the multi-help case).
- FULL package scripts were executed with their complete original file lists, replacing only tsx CLI with node --import tsx and dot with TAP: API pretest 16 pass / 131 PostgreSQL skips; API main 11,988 pass / 2 baseline EPERM failures / 198 PostgreSQL skips (12,188 total); gateway 2,413 pass / 0 failed / 46 baseline runtime cancellations (2,459 total); contracts 484/484 pass. Complete argv is recorded in *-summary.json.
- All 31 direct API importer specs: 1,787 pass / 0 failed / 131 PostgreSQL skips. Separate real-module DI + table-driven delivery-plan: 36/36 pass.
- All 12 whole-chain suites (10 catalog suites, including 4 passing infrastructure shell checks, plus the 2 runner meta suites) ran with node --import tsx where required: 4,962 pass / 12 baseline EPERM failures / 46 baseline runtime cancellations, 5,020 total. Corrected affected suites were rerun after the final source change.
- pnpm --filter @watchdog-bms/api typecheck and pnpm --filter @watchdog-bms/ai-gateway typecheck both exit 0. Contracts source was not changed; no contracts build was needed.
- W00 initially requested regeneration; its final gate passes without UPDATE (5/5). Reviewed manifest diff contains only source hash/digest and generation/checkout metadata.
- Baseline archive 24d3545c2 runs the actual failing specs: LINE reply adapter 15 pass / 2 EPERM failures; runtime 1 pass / 12 EPERM failures / 46 cancellations. compare-baseline.cjs checks exact failing/cancelled test names AND failureType/error/code, verifies the baseline spec bytes against git show 24d3545c2, and checks every other whole-chain status. baseline-comparison.json matched=true; no product assertion failure remains.
- Exact E2a/E2b replays fail on 24d3545c2 with the observed approval refusal / funding-source ask, and pass on this diff. Exact E1 continuations reach the same tax-bearing draft on both base and current after their returned next button is pressed.
- git diff --check passes. No package.json, budget profile, final-mutation gate or .live file is tracked in this diff; no commit was made.
Next: Review the uncommitted diff and .live/exam/last-message-e.md. A fresh live-provider/LINE/DB exam is needed to establish live model behavior; no further local implementation or verification is pending.
