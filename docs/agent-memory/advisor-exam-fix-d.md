# Agent Memory: advisor-exam-fix-d

Status: Scoped implementation and verification complete, 2026-10-17; base a0d21cb15; uncommitted; finished in about 18 minutes within the 60-minute cap.
Owner: Codex, only lane D.
Scope: D1 own-scope reads and admitted claim continuations; D2 action-specific help; D3 gold oracle backlog wiring; D4 purchasable catalog truth; D5 provider failures.
Decisions:
- Keep the existing metered router, permission/tenant/branch/use-case guards and human final buttons; no flags, budget changes, dependencies, package.json edits or final-mutation gate changes.
- D1a: admit a continuation only against its persisted conversation task/action link. Claim continuations stay on the semantic claim lane, including when the expense draft conversation is disabled. Preserve the source-backed purpose hint in the accepted request; re-propose the same unsaved preview with validated current text receipts, preserving all other facts and invalidating the earlier confirm card. No request is saved until the signed button is pressed.
- D1b: groupBy is presentation, not permission or row scope. Drop it from both list_recent planner input and requested hints; keep all real filters and ERP own/related scope guards. An invalid read plan gets retry wording, never a permission refusal; actual permission refusals remain unchanged.
- D2: add distinct registry entries for claim submit/cancel/reject/pay and expense send-for-review/confirm/delete/void/pay. Specific source-text operation and approval tool hint outrank broad creation help cards; every entry retains its operation permission. Reject matching precedes the overlapping Thai approve verb. Existing approval and creation entries remain separate.
- D3: wire reimbursement.get_approval_backlog to ReimbursementGetApprovalBacklogTool and pending-approvals fact extraction in the real gold oracle. The held-out alternative remains present.
- D4: resolve availability through billingOffer/BILLING_PAID_TIERS, including the existing package button for sold features. All four purchasable tiers and SALES_DEAL_ALLOWED_FEATURE_KEYS exclude procurement, sales_documents, reports and inventory. The held-out invoice/report/procurement/stock no-package expectations are correct; none need changing. No corpus file was edited.
- D5: all provider failures use existing retry wording; router schema errors retain their separate clarification handling. Bedrock logs provider exception class and HTTP status when supplied, without private error messages or invented usage.
Product / architecture evidence:
- Exact J7#4 user text/router continuation updates purpose, preserves amount/date/category and returns the save button; the changed preview has a new signed confirmation and unlinked task authority is refused.
- Exact H-staff-vendor-breakdown-ordinal#1 uses expense.read_own, preserving the prior read period and limit 5, including a planner that repeats the router's groupBy hint.
- Exact C03#0 reaches the approval help button through signed webhook, OrchestratorAgent and real delivery payload. A ten-operation table also covers the sibling help mappings; no help executes a mutation.
Open questions / limits:
- The four zero-token failures are PROVIDER_UNKNOWN: tuning T-005#2 (10,186 ms), T-022#1 (18,839 ms), rerun T-005#0 (10,491 ms), #1 (10,511 ms). Original logs contain neither class nor HTTP status, so provider overload cannot be established from this evidence. The misleading clarification fallback is our confirmed bug and is fixed.
- Fresh live-provider/LINE acceptance, seeded DB oracle preflight and browser screenshots were not run in the offline sandbox; these are controller/tool/delivery regressions, not a claimed live-model pass-rate improvement or web-screen visual check.
Artifacts:
- docs/evidence/advisor-exam-d-router-replays.json: sanitized original router JSON/user input/task projection; fresh server evidence and local test owner bindings are used by the replay harness.
- .live/exam/d-verification/: complete package/script argv, TAP, baseline comparison, typechecks, catalog truth, provider diagnosis. .live/xd input evidence and all .live output remain untracked.
- docs/research/mangmee-ai-capability-manifest-2026-09-27.json: W00 regenerated/reviewed; only source hashes/digest and checkout/generation metadata changed, with no operation authority changes.
Verification:
- Contracts build exit 0; full contracts test script 484/484 pass.
- API and gateway package typecheck scripts exit 0 after generating the missing local Prisma client; no generated file is tracked.
- Exact D1a/D1b/D2 signed webhook replays 3/3; scorer + oracle offline checks 93/93, including every original corpus gold alternative.
- API changed-file importers plus DI/delivery: 1,488 pass, 125 PostgreSQL skips; separate real-module DI/table-driven delivery-plan 36/36 pass.
- FULL API pretest: 16 pass / 131 PostgreSQL skips; main: 11,984 pass / 2 baseline EPERM failures / 198 skips (12,184 total). Full scripts use every registered file with node --import tsx; TAP replaces the dot reporter for recorded counts.
- FULL gateway: 2,388 pass / 0 failed / 46 baseline runtime cancellations (2,434 total).
- Required node scripts/run-line-ai-whole-chain-acceptance.mjs was run: tsx CLI IPC hits sandbox EPERM on both current and base. All 12 original suites then ran with the same file lists through node --import tsx: 4,933 pass / 12 baseline EPERM failures / 46 baseline cancellations; all four infrastructure shell checks exit 0.
- Baseline archive a0d21cb15 reproduces API adapter 15 pass / 2 EPERM failures and runtime 1 pass / 12 EPERM failures / 46 cancellations. compare-baseline.cjs asserts exact nonpassing test-name equality across full API, gateway and whole-chain, and unchanged baseline spec bytes; baseline-comparison.json matched=true.
- W00 gate passes without UPDATE after regeneration; git diff --check passes. No product assertion failure remains.
Next: Review the uncommitted diff and .live/exam/last-message-d.md; a fresh live exam can establish model improvement when provider/LINE/DB access is available. No further local implementation or verification is pending.
