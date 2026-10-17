# Agent Memory: advisor-exam-fix-c

Status: Scoped implementation and verification complete, 2026-10-17; uncommitted diff; base cd6f32f39; completed within the 60-minute cap.
Owner: Codex, lane C.
Scope: Permission/package limits, unsold modules, registered action how-to, concise tax explanations and social/general conversation; no lane A language/rendering implementation or lane B action handlers changed.
Decisions:
- Reuse existing scope-policy, metered composers, action registry and permission-checked APIs; no new flags, dependencies, model-free LINE route, budget or final-mutation changes.
- C1: shared scope/help/legacy/prepared refusals name the canonical Thai owner role and link permitted own-record work; management creation checks use registry permissions; own-draft deletion still reaches the use-case's ownership/status guards.
- C2: feature availability, tier names and prices derive from billingOffer/TIER_FEATURE_PRESETS; package comparisons have a button. Missing-pack outcomes do not become wrong owner permission denials; concepts remain available across roles/packs.
- C3: Thai/English unsold-module reads, capability questions and help explain today's Mangmee Plus scope and nearby expense/receipt/claim work; harmless general questions remain conversational.
- C4: registered how-to uses one procedural sentence and the existing action button; pure/polite explanations ignore wrong router/composer action selectors and retain their answer. All final actions remain human-confirmed; substitute signatures and bank details stay web-only.
- C5: existing casual/semantic model calls get short warm social/general guidance, without echoed input, generic ask-back or offers of unsold modules.
- Tax context/source checks: October 4 migration active service/professional 3%, rent 5%, advertising 2%, transport 1%; October 13 correction routes DRAFT individual interest/dividend to separate PND2; PND3/53 depends on payee, not payer; withholding uses the pre-VAT base. No historical DRAFT rate is presented as legal advice.
- Tax sources: current tax guide, contracts/tax.ts, migrations 20261004120000 and 20261013120100; RD primary form https://rd.go.th/fileadmin/tax_pdf/withhold/240360_attach2.pdf.
- W00 manifest regenerated/reviewed: only ai-tools.ts source hash, digest and checkout/generation metadata changed; operation wiring/authority are identical.
Open questions / integration:
- Lane A owns repeated question headers and reply-language handling; Flex wrappers in the harness are serialization, not raw markup sent as text.
- Lane B owns R018-A's raw action-service payment refusal and K011-A/K012-A branch-capacity copy; those paths still need named roles/catalog upgrade pricing when lanes integrate. Action handlers deliberately untouched here.
- Fresh live-provider exam and external-image acceptance were not run in the offline sandbox; replay providers are stubs, not a claimed live pass-rate improvement.
Artifacts:
- docs/evidence/advisor-exam-c-router-replays.json: 17 sanitized exact intake-router replays, re-bound to fresh server evidence hashes and real ROLE_GRANTS/tier presets.
- .live/exam/last-message-c.md: current handoff (25 lines); .live/exam/c-verification/: exact command argv, package/whole-chain TAP, baseline comparisons and typecheck result JSON. Evidence remains untracked.
Verification:
- Contracts build: pnpm --filter @watchdog-bms/contracts build — exit 0; full contracts test script: 449/449 pass.
- API package typecheck: pnpm --filter @watchdog-bms/api typecheck — exit 0, 152.25 seconds (typecheck-api-final.json); earlier interrupted sessions are not counted.
- CI API TypeScript 7 single-threaded check — natural exit 0 (typecheck-api-native.json); gateway package typecheck — exit 0.
- FULL API pretest: 16 pass, 131 PostgreSQL-dependent skips; FULL main: 11,932 pass, 2 baseline EPERM server-bind failures, 198 skips (12,132 total).
- FULL gateway main: 2,206 pass, 0 failed, 46 baseline runtime cancellations (2,252 total; command exits 1 on cancellation).
- All importing API specs + real-module DI + table-driven delivery plan: 624/624 pass; separate DI/delivery invocation: 34/34 pass.
- Whole-chain catalog's 12 suites executed: 4,719 pass, 12 baseline runtime EPERM failures, 46 baseline runtime cancellations; all other suites and all four infrastructure script checks pass.
- Exact baseline archive cd6f32f39 reproduces both API failures (15/17 pass) and runtime 12 failures/46 cancellations. baseline-comparison.json asserts every nonpassing test/suite name is identical; no product assertion failure remains.
- Canonical six-role × all 22 chat-action table; four packs × seven features; 72 role/pack/definition combinations; 17 routing replays; misleading-action-selector regression. Registered orchestrator spec: 578/578 pass.
- Full test scripts use pnpm --filter <pkg> exec node --import tsx --test with every registered file; no package.json edits. git diff --check passes.
Exam corrections:
- K013-B incorrectly says Pro permits only two branches; real catalog permits five. V056-B incorrectly chooses PND53 from the payer being a company.
- R004-A's blanket staff-delete prohibition ignores own-draft update access; ownership/status remain mandatory. V057-B includes PROVIDER_TIMEOUT.
- Refusal-only expectations for harmless O005/O006/O008 conflict with the owner's brief-answer rule. Generic knowledge does not need an unasked package upsell.
Next: Integrate with lanes A/B, review the uncommitted diff and rerun a fresh provider exam; do not claim customer/live acceptance from offline replays.

Owner addition 2026-10-17 (complete locally, uncommitted):
- Pending claim reads now follow ROLE_GRANTS read/read_related/read_own and the existing web ListReimbursementsUseCase, including branch and related/own scope; approval/rejection use-cases are unchanged.
- Generic pending lists are shop/related/own reads; only explicit approver: me uses the existing actionable approval queue. Reader wording names the waiting desk, never "รอคุณอนุมัติ".
- Held-out accountant/auditor gold and staff T-143 read wording updated only for this decision; action-denial gold remains unchanged.

- Pending-state words (including ค้างอนุมัติ/รอการอนุมัติ) and waiting-person questions stay reads; explicit approval-setting edits remain web links.
- A caller with no claim-read permission gets a named-role refusal plus a permitted package comparison; no suggestion to read their own claims without permission.
- The historical FX29 capture is unchanged; its current regression expectation reuses its recorded permission-checked baseline backlog read for the superseded accountant refusal.

Owner-addition verification (final):
- Contracts build and both package typecheck scripts: natural exit 0; `.live/exam/c-read-verification/typechecks.json` records commands/logs.
- FULL contracts script 449/449; FULL API pretest 16 pass/131 PostgreSQL skips; main 11,953 pass/2 baseline EPERM failures/198 skips (12,153 total).
- FULL gateway script 2,257 pass/0 fail/46 baseline runtime cancellations (2,303 total); exact script file lists/argv are in package summary JSON.
- All changed-file API importers plus real-module DI and table-driven delivery-plan: 656/656; final focused gateway regression set 929/929; shared result semantics 73/73.
- All ROLE_GRANTS rows plus no-grant control verify read visibility separately from approve/reject; API tool spec 32/32; 8 fresh pending-question variants × six shop roles (48 replays); 17 original sanitized exam routing replays remain covered.
- All 12 whole-chain suites run: 4,769 pass/12 baseline EPERM failures/46 baseline cancellations; other 11 suites and all infrastructure checks exit 0.
- Baseline rerun from cd6f32f39: runtime 1 pass/12 fail/46 cancelled; LINE adapter 15 pass/2 fail. `baseline-comparison.json` asserts identical API/whole-chain nonpassing names and the gateway cancellation subset; baseline spec bytes equal git HEAD.
- W00 regenerated: read-tool permission any-of and optional approver: me are the only operation changes; source hashes/digest/checkout metadata also updated.
- No package.json, final-mutation gate, AI budget, feature flag, write use-case or web screen changed. No live-provider improvement is claimed from offline fixtures.
Next: integrate lanes A/B and run a fresh live-provider exam; current local implementation/verification is finished.
