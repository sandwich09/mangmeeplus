# Agent Memory: Receipt reliability and UX review

Status: Analysis, owner UX corrections, and adjacent impact audit complete; no implementation authorized.
Owner: Codex / owner-requested UX, SA, BA and AI engineer perspectives.
Scope: Receipt intake, OCR validation, persistence, retry/outcome delivery, duplicate handling, quotas, company setup, and usability for entrepreneurs including older users.
Decisions:
- Diagnosis-only scope persists. Do not fix, enable flags, deploy, write customer data, send messages, or resume prior release mutations.
- Review the deployed application SHA 604ac785479ced5b9858d0b46d89f8d11cf2b9f6 in ../mangmeeplus-prod-email-fix-20260907; preserve its pre-existing deployment-runbook edit.
- Reuse existing event/outcome/receipt/duplicate/quota/worker infrastructure in the proposed plan.
- Separate confirmed incidents, code-confirmed gaps, conditional reproductions, and user research hypotheses.
- Owner correction: ask ALL currently missing user-supplied fields together in one response; never drip-feed one field per turn. Keep language/grouping simple and accept complete or partial replies. This retains the existing all-questions spec rather than replacing it.
- Silence retains the incomplete draft without nudging/deleting/finalizing. Unrelated tasks must proceed without treating their text as bill answers or repeatedly reattaching bill questions.
- In incomplete receipt context, “บันทึกไปก่อน”, “บันทึกไว้ก่อน”, and “เดี๋ยวไปแก้ในเว็บ” mean retain the draft, stop collection questions, and provide a direct link to edit the SAME draft in the web. No financial confirmation/approval/posting is implied.
- Required web completion: original image, extracted facts, incomplete staged item rows, and missing fields must all be visible/editable; LINE must use the newer web revision when resumed. Current implementation is not claimed to satisfy this fully.
- Admission-counting quota/customer credits remain a separate proposed product revision; no silent implementation policy changes.
- Latest owner request expands impact/bug/gap review around partial drafts, web continuation, permissions, and multi-draft discovery; diagnosis-only boundary remains in force.
- Owner follow-up asks whether the complete chain since the first issue has evidence and corresponding fixes. Added report §13: all 18 review entries map evidence level L/C/R/U to proposed fix and future acceptance cases T01–T18, plus the earlier receipt-attempt/settings answers and their limits. This request is not implementation authorization.
- Treat new conversation money-loss/resume defects as blockers before enabling that capability, not as proof they affected the incident in prod where the dedicated conversation flag defaults off. Do not conflate it with the enabled LINE_AI_DRAFT_EDIT_ENABLED feature.
Open questions:
- Actual persisted OCR rows, image hashes, draft leftovers and customer quota consumption for the incident have not been queried.
- The third read's exact line-level difference remains unknown. Model call success/token counts cannot prove a particular omitted row or fallback.
- No usability sessions or device-level accessibility testing have been performed.
- Existing implementation memory explicitly defers rendering incomplete staged item rows on the web. The deterministic control helper lacks the exact new save-for-later phrases; full intent handling still needs integration verification. Dedicated conversation remains default off in inspected runtime config.
Artifacts:
- docs/research/line-receipt-reliability-ux-review-2026-09-07-th.md
- docs/agent-memory/line-receipt-zero-price-diagnosis-2026-09-07.md
Verification:
- Reviewed relevant specs and deployed-source code for validation, apply transaction, intake identity timing, duplicate detection, outcome upsert, orphan recovery, LINE adapter, quota admission and draft renderer.
- Read cloud-operations runbook before AWS reads. Express active config readback from prod and UAT: same source SHA; terminal outcome replay and dedicated expense draft conversation flags absent from environment and secret names. Schema defaults both to false. LINE_AI_DRAFT_EDIT_ENABLED is true. These are distinct capabilities.
- New no-write reproduction using actual ProcessLineWebhookUseCase prototype with in-memory DB/LINE boundaries and simulated successful receipt work: first result send fails, generic fallback succeeds; with replay enabled the fallback overwrites the receipt summary, is marked delivered, while event remains delivery_pending. Assertions pass, pnpm exec tsx --eval exit 0. Conditional replay bug is not claimed as an observed production incident because replay defaults off in inspected configuration.
- Earlier actual-service zero-price reproduction remains recorded in the diagnostic memory.
- Consulted primary LINE retry/webhook documentation and W3C older-user/cognitive/target-size/status-message guidance. Report cites exact pages and distinguishes LINE API acceptance from actual device delivery/read status.
- No new test or application files; documentation only. No outbound network writes, customer database writes, feature toggles, deployments, merges or pushes.
- Owner correction follow-up: inspected deployed-source spec §§8–10, deterministic control phrases, and implementation memory about staged web fields; updated the research report to remove the one-question-at-a-time recommendation and record the complete save-for-later/web-edit contract. No application changes.
- Adjacent audit: checkout HEAD is 3720db9a (release configuration follow-up); `git diff --name-only 604ac785 HEAD -- apps packages` is empty, so inspected application source matches deployed SHA. Pre-existing deployment-runbook edit preserved.
- No-write composite reproduction using actual LineExpenseDraftConversationUseCase and UpdateExpenseDraftUseCase with cloned in-memory repository, audit and tax boundaries: purpose-only answer replaces financial rows; synthetic item 100 minus discount 20 plus service charge 10 (total 90) becomes one item, discount 0, no charge, total 100. Directly routing “บันทึกไปก่อน” into the same use case does the same with acceptedFields=[]; natural-language router was not exercised. OCR service was not composed into this new fixture, and no production amount change or final-posting bypass is claimed.
- Same composite reproduction: 21 OCR item hints with 21 stored rows / total 210 become 20 continuation items and, after purpose answer, 20 stored rows / total 200. Initial metadata-only persistence retains all 21; damage occurs on later materialization.
- No-write resume reproduction: newer web expense revision with old persisted continuation, deep-cloned reads, two “ต่อ” turns both STALE with identical old expected revision and zero commits. Existing tests assert only initial stale handling.
- Actual web validator/helper reproduction: blank unitPrice blocks otherwise-valid review form; all six conversation missing-field names are ignored by web data/evidence helper. Source save rejects every blocking validation error. Web has no incomplete staged-item renderer; shared update clear map does not synchronize continuation fields/state.
- Actual UpdateDraft permission reproduction: own LINE collection with upload-only capability passes its internal authority boundary; own web edit without that authority is Forbidden. This is a conditional role gap, not a claim every owner lacks access.
- Actual conversation target reproduction: six paused drafts with discovery take=5; explicit sixth target returns TARGET_REQUIRED without direct detail lookup. Deterministic save-for-later phrases all null, while “พักไว้ก่อน” returns pause.
- All three new `pnpm exec tsx --eval` command groups exited 0 with assertions passing. This proves current defects under fixtures, not fixes. No signed webhook/LLM routing/browser/real DB end-to-end run, no network/customer writes, no new application/test files. Added report §§11–12 with A1–A8 evidence, impact, proposed remedies and regression acceptance.
- Traceability follow-up re-read diagnostic memory and report; every P0/P1/P2/A entry is mapped exactly once in §13 to T01–T18. After-fix evidence remains absent for every case because no fix was authorized/performed. Existing sanitized log references and transient tool outputs are not claimed as exported raw logs or committed reproducible regression files; implementation spec/plan, PR/commit and actual post-fix/UAT results must be added if work is later authorized.
Next: Owner reviews proposed priorities and product rules. Any implementation requires a subsequent instruction; do not infer authorization to execute this plan.
