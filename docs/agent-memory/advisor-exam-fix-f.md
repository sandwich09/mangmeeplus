# Agent Memory: advisor-exam-fix-f

Status: implementation and offline verification complete, 2026-10-17 07:53 UTC; started 07:30 UTC; within the 60 minute cap; base ecade1c18; uncommitted.
Owner: Codex, only lane F; ponytail full; no subagents.
Scope: stated expense amount capture/edit, invalid-router retry wording, WHT expense next step.
Decisions:
- Exact C01 fail/pass comparison: both routers return amount 1800; failing item sourceText omits the money, so item grounding drops it and the conversation ignores the grounded document total. Recover it only for one-item text notes; do not assign a document total to multiple items or media.
- Explicit edit/confirm/delete commands reach the existing metered route instead of being swallowed as a date answer from “เมื่อกี้” or “วันนี้”. The existing collection correction updates the same unconfirmed draft; a requested amount edit with only incidental accepted fields returns “ยังไม่ได้แก้ยอดเงินค่ะ” without writing. Materialized editor and financial actions retain their signed buttons.
- Fix E's amount-free claim continuation is not the capture cause: the original route contains BUSINESS_EXPENSE and an amount; both C01 routers supply 1800, while only the failing item span omits it. The one-question formatter only exposes the resulting missing money.
- WHT captures offer the existing confirmation preflight and its missing-field buttons immediately. They retain the voucher path instead of preparing a direct payment during confirmation. The existing signed voucher/50 ทวิ actions recheck permissions on each press.
- When evidence blocks confirmation, a user with expense.confirm gets a review-and-confirm link to the same expense, alongside receipt choices. The photo answer opens LINE's native picker instead of repeating its message button; the upload target retains owner, tenant, membership, branch, source revision and checksum checks. Existing contract-valid substitute selection remains available by text after the picker.
- Evidence and substitute-receipt web guards remain authoritative; no evidence-free confirmation, certification, approval or preview was added.
- No package.json, dependencies, flags, budget contract, final-mutation gates, cloud operations, other checkout/process or commit.
Open questions: none.
Artifacts:
- docs/evidence/advisor-exam-f-router-replays.json: original failing/passing webhook inputs and router outputs, plus the original unmetered edit and receipt-photo press; .live/xf remains untracked.
- All new regressions are in existing registered expense-document, line-draft-update.security and process-line-webhook specs; no package script was edited.
- .live/exam/f-verification contains full original package argv, TAP, whole-chain results and baseline comparison; .live/exam/last-message-f.md is the handoff.
Verification:
- Exact F1/F2 plus related regressions: 13/13 pass; all eight new F tests also pass in the full API script. On archived starting HEAD ecade1c18 with the same new tests: seven assertions fail and the already-working counterparty continuation passes.
- F1 replays use the two exact capture routes, the exact failing edit text and exact invalid delete response. The failing edit originally never called intake; its new admitted response is replayed from the passing journey's correction output, rebound to the current test target. This proves routing/application, not fresh provider output.
- F2 replays cover C05-run1 counterparty → capture, C05-run2 capture → actionable category/next buttons, and C05-run1's exact receipt-photo press through the real confirmation/evidence use cases and delivered LINE payload. Existing signed lifecycle suites cover income/expense category confirmation → voucher create/submit/approve/pay → 50 ทวิ.
- FULL original package scripts, using node --import tsx: API pretest 16 pass / 131 PostgreSQL skips; API main 11,996 pass / 2 baseline localhost EPERM failures / 198 PostgreSQL skips. Gateway 2,413 pass / 46 baseline cancellations / zero assertion failures; contracts 484/484 pass.
- All 19 importing/mandatory API specs: 2,406 pass / the same 2 baseline EPERM failures. Separate real-module DI + table-driven delivery-plan: 36/36 pass.
- All 12 whole-chain suites: 4,967 pass / 12 baseline EPERM failures / 46 baseline cancellations; all four infrastructure shell suites pass. The two runner/catalog suites contribute nine passes to that total.
- Starting-HEAD LINE adapter/runtime specs reproduce the same failed/cancelled names, failureType, error and code. compare-baseline.cjs verifies their original bytes and records matched=true; no product assertion failure remains.
- API and gateway package typecheck scripts both exit 0. W00 requested regeneration; reviewed diff changes only two source hashes, digest and generation/checkout metadata; final gate 5/5 without UPDATE. git diff --check passes.
Open doubts / limits:
- No live provider/LINE, PostgreSQL/Docker or browser verification is available in this offline sandbox. No web screen changed and no live certificate issuance is claimed; existing evidence and permission requirements can require the web review step before confirmation.
Next: review the uncommitted diff and run a fresh independent live exam when the provider/LINE environment is available; no local implementation or verification remains.
