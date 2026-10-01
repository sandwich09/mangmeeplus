# Agent Memory: manual-expense-web-entry-flag

## Update 2026-10-01 — independent review and spec v3.0 (current state)

2026-10-02: The owner answered every open decision with “ตามที่แนะนำทั้งหมด”. D1–D8 are decided as proposed; the spec, plan, review, bugs file and the notes on the audit, QA report and evidence README now read “ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ)”, and the spec's catalog-key appendix is kept as the alternative that was not chosen. No rule, contract field, number or screen wording changed. The owner has not ordered implementation.

Status: DECIDED, NOT STARTED. Spec v3.0 and its plan carry the owner's eight decisions (D1–D8 in spec §1.2, decided 2026-10-02 as proposed). Implementation NOT STARTED and not ordered; before it starts, every finding must be re-verified at the latest develop commit (plan P0). Everything under "History" below is kept unchanged and describes the state before the review; where it disagrees with this section, this section wins.

Owner: thawatchai / Claude (review and v3.0 amendments); earlier work by Codex.

What the independent review found (docs/research/manual-expense-web-entry-flag-review-2026-10-01-th.md, 25 findings RM-01..RM-25):
- The audit and the E2E simulation ran on 4a5817b42 plus uncommitted work. That commit is NOT an ancestor of origin/develop (develop ae13970b0 has 842 commits it lacks; 596 of the 3,728 hashed evidence files differ). Every finding must be re-verified at the commit where implementation starts.
- F03 (LINE draft idempotency key) was already fixed on develop in 6fddca795 (2026-09-29). It is not an open bug. The v2 proposal to change the key formula is withdrawn.
- A new key in FEATURE_CATALOG is treated as authority everywhere: billing rejects existing 60/62-row companies when the catalog grows, onboarding/billing/presets/deals would write the new key as false, the admin screen blocks disabling a key that has no stored row, the entitlement command wipes LINE conversation state and bumps setVersion (which holds a paid invoice). All run-verified in memory against real code.
- F02 (delete guard) is real but affects only roles built from the four finance templates, not the built-in roles.

Decisions in spec v3.0, decided by the owner on 2026-10-02 as proposed (the spec keeps each alternative and its cost as the record of what was not chosen):
- D1 storage: a per-company screen setting (the CompanyAiConfiguration.ocrEnabled precedent), not a catalog entitlement key; still shown under "บันทึกด้วยมือ" on the same admin page. Appendix B of the spec keeps what a catalog key would additionally require, as the alternative that was not chosen.
- D2 defaults: shown for every existing and new company; purchases, upgrades, presets and deals never change it.
- D3 purpose: hide the entry only; not access control. The admin wording says so.
- D4 guide and LINE text: the web guide hides the button and shows a note on the manual section; the LINE help card is left as is this round. (Narrower than the review's first suggestion of removing the whole section, because the guide refers to section numbers and to "8 submenus".)
- D5 unreadable value: show the menu.
- D6 phone reload after switch-off loses re-entry: accepted, with an admin warning.
- D7 switching off while upload is also off: allowed, with a warning.
- D8 delete bug: fix separately. Done: merged in PR #950 (develop `6dd3c8c7`) and PR #951 (main `4803be00`).

Open questions:
- Whether any production company uses a finance-template role (B1) or has a deal that stores only the parent menu (B3). No database was inspected.
- How new API spec files reach CI without editing package.json (plan §4). Needs a ruling.

Artifacts added or changed on 2026-10-01 (branch claude/spec-reviews-20261001, not pushed):
- docs/research/manual-expense-web-entry-flag-review-2026-10-01-th.md (review)
- docs/research/manual-expense-current-code-bugs-2026-10-01-th.md (B1, B3, B4; B1 and B3 were fixed on 2026-10-02 in PR #950/#951, B4 is not fixed)
- docs/specs/manual-expense-web-entry-flag-spec-th.md (v3.0)
- docs/plans/manual-expense-web-entry-flag-plan-th.md (rewritten for v3.0)
- Reviewer notes added at the top of the audit, the QA report and the evidence README. Their original text is unchanged.

Verification (review session, no file edits to application code, no database, no browser, no AI calls):
- In-memory simulation of the v2 catalog key against the real evaluator, permission filter, billingFeaturePlan, normalizer plan, admin-console logic and SetPartnerFeaturesUseCase.
- Baseline suites at ae13970b0 are green: API 133 + 109 + 89 tests on the plan's three command lines, web 227, ai-gateway approved-knowledge 9.
- node infra/security/sync-production-maintenance-release-pins.mjs --check reports status=current.
- Not done: Playwright, PostgreSQL specs, production/UAT, real LINE or AI.

Next:
- Wait for the owner's explicit instruction to implement. Then run plan P0–P6 from the latest develop, re-verifying every finding at that commit first.
- B1 and B3 were fixed separately (PR #950 / #951). B4 is still separate work and does not wait for this feature.

## History — state before the independent review (kept unchanged)

Status: SPEC v2 + PLAN + AUDIT + LOCAL E2E SIMULATION COMPLETE (2026-10-01); implementation NOT STARTED. Authorized work: spec, isolated testing, and documentation-only merge to main/develop. Application implementation remains unauthorized.

Owner: thawatchai / Codex

Scope:
- Audit manual expense flag and neighboring modules; write implementation-ready docs.
- User clarified “ปิดแค่ทางเข้าการ manual บน web”, “ยังไม่แก้นะ ทำ spec มาก่อน”.
- User then requested broad E2E simulation. During testing, selected a child switch beneath manual feature: hide the web menu/entry while backend behavior stays the same.
- No application/test/package source edits in the original workspace; no live flags, cloud or deployment.
- Owner subsequently requested “merge เข้า main+develop ไว้ก่อน”: deliver only this task’s spec, plan, audit, QA, memory and evidence independently to both target branches; preserve unrelated dirty work.

Decisions:
- LATEST v2: add `expenses.manual.web_entry`, empty permissionKeys; display under the existing manual feature. Keep `expenses.manual` and its create/update mapping unchanged.
- v1 proposal to reuse old manual flag/remove its permission mapping is SUPERSEDED. Do not restore permissions for companies whose OLD manual flag is OFF.
- Use existing flat entitlement storage/command/CAS; no new table, permission, SKU, env flag or recursive feature tree. `parentFeatureKey` still returns `expenses`; effective web entry checks all three keys.
- New switch hides dedicated web links and closes new admission/reload/direct URL/alias. Mounted admitted forms may finish under unchanged actual business authority. Keep OCR/wizard manual input available.
- Default absent new row inherits ON; preserve explicit/pending entry choice across presets, parent/manual cycles, billing and onboarding materialization.
- Forward entitledFeatureKeys through RequestContext/auth-me/WebSession/MyContext; add snapshot to existing 60-second/focus refresh fingerprint; preserve admitted form state.
- F02 DELETE guard mismatch and F03 LINE invalid idempotency key are separate backend follow-ups, NOT part of the entry-switch implementation diff.
- Local ponytail full read; old /Users/spare058 skill path is stale. Installed Next.js Playwright docs read for harness work.

Open questions:
- No unresolved owner-scope question; v2 reflects the latest child-switch proposal.
- Implementation still must verify new-key registry/default/preset/billing paths and every AC. Existing LINE-key historical compatibility investigation belongs to a separate backend fix; no customer data inspected.

Artifacts:
- docs/specs/manual-expense-web-entry-flag-spec-th.md (v2)
- docs/plans/manual-expense-web-entry-flag-plan-th.md
- docs/research/manual-expense-web-entry-flag-audit-2026-10-01-th.md
- docs/qa/manual-expense-web-entry-flag-e2e-simulation-2026-10-01-th.md
- docs/evidence/manual-expense-web-entry-flag-2026-10-01/ (reports, source hashes, harness, selected screenshots)
- Temporary full source snapshot/traces/logs: /tmp/manual-flag-e2e-20261001

Verification:
- Baseline HEAD 4a5817b42 with pre-existing dirty work. SHA-256 verification of 3,728 original apps/packages/e2e files: zero changed/missing.
- Earlier in-memory audit: 359 unit tests and 19 diagnostic observations; historical, not new-key acceptance.
- Local simulation: 72 valid case/browser variants, 55 passed / 15 failed against superseded v1 goals / 2 existing ON UI expectation mismatches. Pilot/replaced harness failures excluded; exact counting and limitations in QA report.
- Real PostgreSQL/Nest composed LINE note: ON/OFF × first/retry = four invalid-idempotency-key 400s, zero inserts. This proves an existing bug, not successful LINE creation.
- OFF upload, reviewer confirmation, upload-only LINE source editing, and reimbursement create→approval→finance→payout passed. Old OFF removes create/update, breaks generic own edits/mark-ready/delete, disables wizard create, discards mounted manual form on focus refresh, and blocks lost-response recovery.
- Chromium + WebKit at 1440px and 390px. No real LINE/OCR provider, real device, cloud/UAT/Production or full financial/signature/legacy-history matrix.
- Tests used a sanitized isolated source snapshot/API3061/web3060/PG25463/Redis26381/MinIO29003. Customer/local shared stack at 3000/3001/25461 was untouched. All task-owned servers/containers stopped after testing; snapshot and stopped containers retained.
- Documentation checks: 54 relative links valid across six docs; AC01–AC20 and P0–P5 complete; code fences/whitespace checked. Source hashes remain unchanged.
- Delivery preflight: documentation dependencies exist on both origin/main and origin/develop; evidence JSON parses; scan found no private keys, GitHub tokens, AWS access IDs, JWTs or live Stripe keys. Harness credentials are synthetic and pinned to the isolated localhost services.
- Both target branches use PR-only automatic CI; deployment workflows require explicit dispatch. No deploy or live flag change is part of the merge.

Next:
- Use the merged v2 documentation as the implementation handoff. Wait for explicit instruction to implement; the main/develop documentation merge does not authorize application changes.
- Implement P0–P5 with the NEW key only, then rerun acceptance with new-key toggles. The old-key E2E simulation cannot certify the new flag.
- Keep existing backend bugs and baseline UI test gaps separate and visible; do not silently fix unrelated dirty work.
