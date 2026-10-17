# Agent Memory: advisor-exam-fix-g

Status: Code and offline verification complete; uncommitted handoff, with remaining exam gaps classified.
Owner: Code lane; resumed on claude/advisor-xg2-20261018 at a2e40a11e (tree identical to 511898fea).
Scope: G1 claim-from-words, G2 visible internal IDs, G3 bilingual LINE surfaces, G4 scoped entity/period resolution and continuing read instructions, G5 structural capacity guards.

Decisions:
- Follow ponytail full, the existing conversation spec/plan, and the owner's final-button rule. Fix F already covers stated expense amount, truthful amount edits and WHT next step; G addresses separate claim collection and shared output/read boundaries.
- Preserve API-owned tenancy, branch scope, permission, evidence, revision/CAS and final-mutation checks. No database/schema changes, dependencies, package scripts, switches, budget contract or final-mutation-gate changes.
- One-line claim previews can use the issued suggested category and API-owned Bangkok-today default; proven day words override model dates. Suggestions remain reviewable before the signed user press saves DRAFT. Missing-receipt reason remains policy controlled, never invented.
- Localize fixed UI vocabulary and initial expense capture according to canonical request language. Keep people/vendor legal names as data. Remove numbered pending-approval text.
- Replace known model-printed record IDs with labels; strip cuid/UUID from visible delivery and previews before hashing. Retain exact validated URI/postback targets and preserve fallback navigation without promoting arbitrary text URLs.
- Resolve head office/HQ/branch-number/category English aliases against the company catalog. Retain ambiguity and existing scope enforcement. Extend deterministic period abbreviations and router instructions for continuing entity reads; fresh provider generation is not verified offline.
- Structural creates use the same current capacity guards as web before collecting fields, and still recheck at execution. The current catalog permits BASIC with two branches, so Starter's next capable offer is BASIC rather than an assumed Pro.
- W00 requested regeneration; reviewed source hashes and metadata only. Removed an unrelated resumed relaxation of four heldout package-word assertions; no evaluation rubric was weakened.

Open questions:
- All 43 fact_1 failures are classified in .live/exam/g-verification/fact1-classification.json. Remaining product gaps include claim detail/count/paid/reason reads, derived comparisons, vendor snapshot/transliteration, WHT/add-on routing and language-switch restatement. Source-versus-rubric amount/period disputes need live DB evidence; no fabricated totals were added.
- Eighteen provider timeouts and rubric noise are listed separately. Exact replays use recorded router/planner JSON and repository doubles, not fresh model evaluation or PostgreSQL.

Artifacts:
- docs/evidence/advisor-exam-g-router-replays.json: recorded webhook/router/tool evidence for 12 conversations; tests exercise 10 representative conversations across G1–G5. G2 replays the successful recorded read and injects an ID-bearing question to prove presentation sanitization.
- .live/exam/last-message-g.md: handoff report (under 40 lines).
- .live/exam/g-verification/resume-{full,chain,types}.json: exact argv, status and counts; resume-baseline-comparison.json proves failure identity and identical Git trees.

Verification:
- Contracts build, then API/gateway/contracts typecheck: all pass.
- Full original API pretest/test file lists via node --import tsx: pretest 16 pass/131 skipped; main 12,009 pass/2 failures/198 skipped (12,209 tests).
- Full gateway: 2,415 pass/46 cancellations (2,461 tests); full contracts: 485/485 pass.
- Whole-chain catalog plus harness and all catalog suites via node --import tsx: 11/12 suites pass; 4,978 passes, 12 socket failures and 46 cancellations, all baseline-identical; four shell suites pass.
- Baseline logs were run before interruption at 511898fea in /private/tmp/exam-g-base. Both old and resumed bases have tree 38f57d5ba5f36b4ea971ae2466a79ad9c1270427. API's two localhost EPERM failures and gateway's runtime socket failures/cancellations match by test/file/type/error/code; affected specs are unchanged.
- Focused exact webhook replays + visible-ID guard + th/en/mixed renderer matrix: 12/12. Real-module DI + delivery table + preferences: 41/41. W00 final 5/5. git diff --check passes.
- No live provider, PostgreSQL, LINE or browser rendering check was available. No web screen was changed; LINE payloads were verified through controller/use case/delivery tests.

Next: Owner reviews the uncommitted diff and runs a fresh independent exam; investigate classified open read gaps with source evidence rather than exam-sentence tuning.
