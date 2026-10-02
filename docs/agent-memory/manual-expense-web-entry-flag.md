# Agent Memory: manual-expense-web-entry-flag

## Update 2026-10-02 — implementation (current state)

Everything below this section is kept unchanged as history. Where it disagrees with this section, this section wins.

Status: IN PROGRESS on branch `claude/manual-expense-web-entry-20261002` (worktree `/private/tmp/mangmee-manual-expense-entry-20261002`, from develop `608b4a6f5`). Not pushed, not released. Phase state: P0, P1, P2 and P3 done; P4–P6 follow in their own commits and update this section.

Owner: thawatchai / Claude (implementation lane; the controller session reviews, pushes and merges).

Scope: spec v3.1 and its plan, P0–P6. A per-company screen setting, the admin command, one `/auth/me` field, the web helper, gate and entrances, the admin switch. Nothing behind the entrances changes.

Decisions:
- Owner, 2026-10-02 ~23:08, mid-build: "สวิตช์ซ่อนเมนู ให้เป็น default ปิดไปเลยนะ". Read by the controller as: the menu is NOT shown by default; a company without a row reads as not shown, existing and new alike; the system admin switches it on per company. The owner has been asked to confirm this reading. The second half of D2 stands (purchases, upgrades, deals and presets never read or write the setting).
- The default lives in ONE place on the API side: `MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW` in `apps/api/src/modules/system-partner-management/domain/logic/manual-expense-web-entry.logic.ts`. `/auth/me`, the partner detail and the command read through `manualExpenseWebEntryState`. A different answer from the owner is that one line plus the one test that pins it (proved: flipping the constant fails exactly that test in `partner.controller.spec.ts`).
- The flag column has no database default, so a row always states its value and the table can hold "shown" rows (needed by the seed, and by the variant the owner may still choose: existing shops keep the menu through a one-time "shown" row. NOT built).
- The web predicate does not change with the default: `manualExpenseWebEntry !== false`. A missing field still shows the entrances (D5); its reason is rewritten in spec §6.1.
- API tests live in spec files the `test` script already lists (`partner.controller.spec.ts`, `auth.controller.spec.ts`); no `package.json` is edited. The P5 PostgreSQL spec is registered in `.github/workflows/ci.yml` like `data-rights-single-admin.pg.spec.ts`. This closes the open question of plan §4.
- The command locks the company row (`lockPlanTermCompany`), the lock every lifecycle writer takes, instead of adding an advisory lock of its own.
- Audit risk level MEDIUM (a screen setting, like a profile edit), action `system.partner_manual_expense_web_entry.update`.
- Six sentences of spec §8 were corrected because each was untrue in a state found during the build; the table of reasons is spec appendix C.

Open questions:
- The owner's confirmation of the controller's reading of the default change.
- Whether shops that exist at release should keep the menu (a one-time "shown" row). Not built.
- The reimbursement-payout release notes (`docs/evidence/reimbursement-payout-release-2026-10-02/`) name `20261002120000_data_rights_single_admin_mode` as the last migration; once this branch merges, the last one is `20261002230000_company_web_entry_setting`. Whoever cuts that release must account for it.

Artifacts (this branch):
- `apps/api/prisma/schema.prisma` (`CompanyWebEntrySetting`), migration `20261002230000_company_web_entry_setting`
- `apps/api/src/modules/system-partner-management/domain/logic/manual-expense-web-entry.logic.ts`
- `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-manual-expense-web-entry.use-case.ts`
- `partner.controller.ts` (`PUT :partnerCompanyId/manual-expense-web-entry`), `get-partner-detail.use-case.ts`, the module, `packages/contracts/src/partner-management.ts`
- P2: `auth.controller.ts` (`me()` answers `manualExpenseWebEntry`), `apps/web/src/common/models/web-session.model.ts`, `workspace-scope.api.ts` (type and fingerprint), `apps/web/src/features/expenses/manual-expense-entry.logic.ts` (`canOpenManualWeb`), `apps/api/prisma/seed.ts` (a "shown" row for `seed-local-company` and `seed-local-company-2`).
- P3: `manual-expense-entry.logic.ts` (admission and view), `ManualExpenseEntryNotEnabled.tsx`, `ExpensesPages.tsx` (hub admission, list button, open-form note), `web-core-workspace.logic.ts` + `WorkspaceLayout.tsx` (sidebar item), `IncomeExpenseLedgerPage.tsx`, `ai-suggestions.logic.ts` + `AiSuggestionsPages.tsx`, `features/user-guide/expenses-guide-manual-entry.ts`, the five server pages, four dictionary keys (Thai and English).
- With P1: `apps/web/src/common/api/api-error-message.ts` (Thai text of the 409 code; the web coverage spec demands one for every code of this API module).
- Spec v3.1, plan, this note.

Verification (real runs, 2026-10-02):
- P0 at `608b4a6f5`: F01–F13 re-checked by symbol, all hold (F02 fixed as the spec says); no entrance outside spec §9. Baseline: API 133 + 112 + 91 tests on the plan's three lines, web 232, ai-gateway approved-knowledge 9, all exit 0; maintenance pins `status=current` (48 files); contracts rebuilt from source.
- P1: `partner.controller.spec.ts` 46 pass (33 before). Each new behaviour was shown red by reverting its production line for one run: 16 single-line reverts, each failed the named test and nothing else of the new set (no-op, 409, lock refusal, 404, audit, two validations, version increment, company lock, the default constant, two partner-detail cases, endpoint permission, route parameter, argument forwarding, DTO). `prisma validate` exit 0; `migration:review` SQL for the new table copied into the migration; `check-di-metadata` exit 0; API typecheck exit 0.
- P2: `auth.controller.spec.ts` 24 pass (20 before; the 4 new ones were red before the change). `workspace-scope.api.spec.ts` 6 pass and the new `manual-expense-entry.logic.spec.ts` 4 pass (red before). Nine single-line reverts each failed their named test (the `/auth/me` field, ignoring the row, reading another company; the fingerprint field and its missing-means-shown reading; the helper's permission, missing-means-shown, company and value clauses). `api-error-coverage.spec.ts` was red without the Thai text of the 409 code and is green with it (68 pass with its two neighbours). API typecheck exit 0, web typecheck exit 0. `prisma/seed.ts` is outside the API typecheck (`include` is `src/**`); it is exercised by the local stack in P6.
- P3: six spec files, 124 tests pass (the new and changed ones were red before the change: 14 failing, two files not loadable). 27 single-line reverts each failed their named test: admission (withdrawn, admitted while closed, no late admission), the closed note, the setting's missing-means-shown reading, the sidebar item (and its permission), the AI card, the guide (link kept, no note, another section touched), the not-enabled state (a button the reader cannot open, no contact line, the sentence), and the wiring of the list button, the hub state, the hub admission, the note after save, the three ledger places, the layout and the five server pages. Whole web suite: 2684 pass, 0 fail, exit 0. Web typecheck exit 0. `approved-knowledge.spec.ts` 9 pass; the pinned guide file's hash is unchanged.
- The admission and the texts are proven in a browser in P6; the unit level proves the logic, the rendered not-enabled state and the wiring by source.

Next:
- P4 admin switch. P5 PostgreSQL invariants. P6 browser evidence and docs.

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
