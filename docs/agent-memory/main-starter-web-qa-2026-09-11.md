# Agent Memory: Main starter package web QA 2026-09-11

Status: Complete — local browser audit closed at user's explicit request; external prerequisites and unexecuted cases recorded. Product fixes not implemented. Not an all-cases-pass or production-readiness declaration.
Owner: Codex root.
Scope: Restart local services from main; exercise starter via real web UI as SYSTEM_ADMIN, OWNER and STAFF; find bugs and journey gaps.

## Decisions

- User clarified starter only, authorized changing dummy local credentials/data, then chose “ปิดรายงาน local ระบุเคสที่ยังทดสอบไม่ได้”. No pending clarification.
- Main fetched/fast-forwarded to07824efc9dd6c53c926b7f275a16581f97b8266e in /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-main-starter-qa-20260911. Original dirty checkout on codex/substitute-receipt-local-20260910 preserved.
- Fresh PostgreSQL watchdog_starter_qa_20260911; stopped/restarted local postgres/redis/minio, volumes retained. Redis DB11 queue. Replaced web3000 with main; unrelated local services preserved. No cloud/UAT/Production.
- Starter feature17keys/7menus defines scope. Separate STARTER_249 term1branch/2members/30slips; renewed1day to31days/12Oct2026.
- Business mutations through browser; code/setup/files only corroboration. No real payments/signatures/external messages.
- Ponytail full read from repo-local skill because historical absolute path missing. PDF/spreadsheet skills used for labeled local fixtures, PDF render and downloaded Excel read-only inspection.
- No product code/package.json edits, commit or push. Restored generated next-env.d.ts diff.

## Findings

Ten findings; proposed1P1/7P2/2P3:

- F09 P1 reimbursement export omits linked source certificate/evidence/requester/funding/payer/provenance; accountant package and full list export reproduce. Amounts correct.
- F11 P2 canceled pre-issued paper scan remains current evidence/export without SUPERSEDED classification.
- F05 P2 personal source unfinishable pending/unpaid after claimPAID. Projection separation intentional; never double-confirm source.
- F03 P2 quota enforced, generic422 hides correct quota reason.
- F01 P2 product decision: starter term/default19menus differs from explicit starter7menus; backend denial works.
- F10 P2 AI nav filtered despite entitlement; templates offer unavailable modules and owner403.
- F07 P2 completed work remains actionable notification; rawREJECTED.
- F08 P2 guideVAT/menu/JV/TaxCode/tab labels mismatch.
- F06 P3 STAFF edit hides partial permissions in checkboxes; code preserves unmatched keys, no proven permission loss.
- F02 P3 duplicate heading and ReactcompanyIdkey.
- F04 excluded: in-app PDF limitation; Chrome and downloaded/rendered files pass.

## Artifacts

- Final [report](../qa/main-starter-web-qa-2026-09-11.md): reproduction, expected/actual, code pointers, coverage/blocked/not-run matrix.
- docs/qa/evidence/starter-web-20260911/: screenshots01–19, PDFs, dummy fixtures, guides, XLSX/JSON.
- expense-index-all.xlsx/manifest BEFORE void:2rows/1125. expense-list-short-after-void.xlsx7columns and expense-list-full-after-void.xlsx48columns AFTER void:1row/125; exact cells in expense-list-export-inspection.json.
- Launcher /tmp/starter-qa-run-20260911.py; /tmp/starter-qa-{web,api,workers,ai-gateway}.log plus setup logs.

## Verification

- Frozen/offline install, Prisma7.8 generation/migrations, shared/API/workers/AI builds, tokens, seed346permissions/13roles/1486grants and launch gates passed.
- Browser admin onboarding/package/renew/lifecycle; forced password/legal; profile/branch/employee/role boundaries; expense validation/calculations; digital/paper certificates; claim rejection/resubmit/approve/finance/payout/reversal; exports; mobile390×844; guides executed as report.
- Downloaded SRC00001 PDF1A4page and SRC00003 PDF2pages inspected. Synthetic wet-signed fixtures labeled. Native Chrome PDF viewer passes.
- Last API health http://localhost:3001/v1/health ok at2026-09-11T12:33:17.968Z. Local containers/services remain running.
- Full unit/E2E suite not run: audit-only/no logic edits. Do not claim exhaustive external/full-system pass.

## Final local state

- Company cmtwv2xtb0003tek1mpgwuwwc QAเริ่มต้น1109 ACTIVE; owner qa.starter1109/staff qa.starter.staff1109 ACTIVE; staff role restored; HOสำนักงานใหญ่QA; custom category archived, custom readonly role unassigned.
- Dummy passwords changed with user authorization; activation/legal complete. Do not publish credentials in final report.
- EXP00001 cmtwvf0bl00catek1rhn50dj5 personal125 READY_FOR_CONFIRMATION(F05); SRC00001 cmtwvld6w001kbuk13j4stoin issued.
- RB00001 cmtwvv491003pbuk1683cwwn7 PAID125/outstanding0; payment1VOIDED/payment2active. ProjectionEXP00002 cmtwvy9a1005sbuk1tqead05q CONFIRMEDpaid125.
- EXP00003 cmtwwa63i00b6buk1h4jm3myq VOIDED/payment1000VOIDEDhistory; paperSRC00002canceled, SRC00003 cmtwwqq4q00e0buk1av6cxy41 formerlyissued then canceled withsourcevoid.
- OCR draft cmtww5k5n00a3buk1zwt4pbvt deletedthroughUI.
- Main web3000/API3001/AI3002/workers left running; parentPIDs54136/54858/54860/54859 observed at closure.

Open questions: None. AI/OCR provider,LINE sandbox,email delivery BLOCKED. File-limit matrix/full claim print-signature/every correction-payment branch/concurrency-scale/archive-expiry NOT RUN; other packages OUT OF SCOPE.
Next: Deliver report. Future fixes prioritizeF09/F11 thenF05/F03/F10; resolveF01 product semantics first. External cases only with sandbox. Do not restart audit or overwrite original dirty work.


## Fix clarification preparation — 2026-09-11

User asks which decisions are needed before fixing, in a detailed numbered list. No implementation started.

Re-read report, package/menu mirror and term specs, reimbursement source consistency/CC2 specs, certificate paper/company-payer specs, dashboard notification lifecycle and AI suggestion scope.

Already specified; do not re-ask: source reference/facts in evidence exports; preserving canceled document history and immutable files; resolving notifications when source condition ends while read state remains recipient-owned; retaining source/projection accounting separation; quota enforcement with precise Thai errors.

Product questions to present:
1. New-company starter term should also initialize starter feature set, or retain separately chosen/trial features.
2. Changing commercial tier should preserve custom feature choices or explicitly offer bundled replacement preview.
3. Existing mismatched companies should keep current access with admin review, or be explicitly migrated after impact review; no live changes authorized here.
4. Starter AI means OCR/LINE only versus the web suggestions page too; respect source entitlements and do not introduce new AI use cases silently.
5. Expense list summary should count each underlying cost once or all document records with explicit separation; source repayment state must stop appearing as an impossible pending task either way.
6. Optional existing open scope: paper/no-account beneficiary requires verified member linkage versus a separate external-payee claim journey. Not a blocker for the ten audited fixes.

Next: Await product answers, then record accepted rules in relevant spec/plan and implement only when requested. Prior local QA closure remains valid.


## Owner answers and implementation — 2026-09-11

Status: Local audit remains complete; fixes now active on codex/starter-qa-fixes-20260911 in same isolated worktree.

Accepted owner decisions: starter always existing7-menu pack independent of purchase; all admin overrides allowed with visible before/after; preserve existing company rights; AI limited to declared starter/enabled permissions and can explain permitted usage; cost summaries follow proposed once-per-cost view; external/no-account payee reimbursement stays outside system, store only supported facts.

Latest steering: inspect surrounding bugs/gaps/impacts while fixing. No further permission question needed. Root-cause/shared-callers and regression checks included.

Artifacts: docs/specs/starter-web-qa-fixes-spec.md; docs/plans/starter-web-qa-fixes-plan.md. No product code changes yet. Next: implement and verify all10 scoped findings, preserving financial/scope/history boundaries and original dirty checkout.

## Implementation progress — 2026-09-11 (local, in progress)
- Branch `codex/starter-qa-fixes-20260911` in the isolated main QA worktree. Original dirty checkout untouched.
- Implemented starter-by-default onboarding independent of purchased term, before/after admin changes, quota validation/copy, preserved partial role grant display, AI navigation/template permission checks and usage guidance.
- Implemented retained claim source evidence hydration across detail/shared evidence/export, historical canceled scan labels, source claim progress and cost deduplication. No expense/payment/ledger state migration.
- Notification status is a current-source read projection: completed work remains in history without unread/action count; payment void can reactivate the same work without duplicate delivery. Guide copy aligned with current starter controls.
- Adjacent AI protections: recheck queued request permission, fail instead of leaving GENERATING when membership resolution fails, retain generation branch scope and recheck current source access before showing stored previews/details.
- Checks so far: onboarding 56, web quota/admin 58; latest API evidence/notification/generation group 95 tests pass; web model tests pass; AI source/template/generation/review tests pass. API production-source typecheck (8 GB, specs excluded), web typecheck and SWC API build passed before latest scope/warning additions. Full API typecheck including all historical specs exhausted Node default 4 GB heap; no product runtime OOM.
- Remaining: final focused checks/build after last edits, restart local API and verify admin/owner/staff journeys through CUA browser; inspect linked accountant export; record exact outcomes and any provider-blocked cases. This section supersedes the earlier “no product code changed” note.


### Regression progress — 2026-09-11 21:10 local

- Closed adjacent generated-certificate checksum mismatch: confirmation transaction now resolves attachments exactly like preflight; added a regression including cancelled certificate history. Restored realistic attachment ID/target/branch fields in repository fixtures.
- Expense regression: 53 non-PG spec files, 1,251 cases, 1,245 pass, 6 conditional skips, 0 fail. AI/notification/onboarding regression: 253 pass. Web scoped regression: 541 pass; additional reimbursement group 107 pass. Logs `/tmp/starter-fixes-*.log`.
- Browser owner dashboard/list: cost 125 once, pending 0, source read-only with paid progress and working claim link. STAFF evidence direct route denied; AI usage guidance restricted to 3 allowed links vs OWNER 6.
- Browser owner resolved notification history confirmed. Voided simulated RBPAY-00002: same ready-payment task becomes actionable again, other tasks remain resolved, read history stays intact. Paying back 125 using local dummy reference QA-LOCAL-REGRESSION-1109 underway/verify next.
- Found notification deep link while hub already mounted kept old tab and same focus would not reopen after close. Fixed query-driven tab/focus synchronization and clearing focus on drawer close; browser now opens finance drawer with payment action.
- API rebuilt/restarted PID 53562, web stays on 3000. Production-source API and web type checks run with empty error logs; capture final exit results before close.
- Remaining: final browser payment state, current + cancelled evidence exports and workbook facts; employee quota, guide wording; final docs and diff check. External provider/LINE remain blocked by the already accepted prerequisites.


### Final handoff — approved local fixes complete

Status: Complete for authorized local implementation and regression; external-provider follow-up requires a separate sandbox-enabled round.
Owner: Codex root; no subagents used.
Scope: F01/F02/F03/F05/F06/F07/F08/F09/F10/F11 plus surrounding permission, source snapshot, confirmation checksum, notification contract/deep-link and quota/guide consistency impacts.
Decisions: All six owner answers recorded in `docs/specs/starter-web-qa-fixes-spec.md`. No further product question pending. Existing company entitlements preserved; Starter 7 independent of commercial tier; external/no-account repayment remains outside the system.
Artifacts: `docs/qa/starter-fixes-regression-2026-09-11.md`, approved spec/plan, and `docs/qa/evidence/starter-web-20260911/fixes/` screenshots/XLSX/JSON/verification summary. Prior report is labeled baseline/pre-fix.
Verification: Expense 1,245 pass + 6 initial DB skips; required local PostgreSQL rerun 25/25 passes (includes all 6 skipped cases). AI/notification/onboarding 253; web 648; guide 7; final document/export focused reruns 39 + 12 all pass. API build/contracts build pass. Final API production-source tsc with 8 GiB heap and web tsc both exit 0. `git diff --check` passes; no package.json changes. Full API including historical spec typings was not certified because earlier default 4 GiB heap run exhausted memory; executed specs are listed separately.
Browser: New admin-created QA Starter Fix 1109 gets 7 features by default, stays 7 after PRO switch. Before/after plan/slip/renewal displayed; cancel preserves values. Original company limits 1/2/30 restored. Branch/member quota rejects retain useful errors; wizard inline generic gap fixed and browser-retested. Owner source/projection cost 125, pending 0, read-only paid source and claim link. STAFF AI has 3 permitted guidance links and evidence URL denied. Owner completed work remains historical; void payment reopens only ready-payment notification and same-page link now opens finance drawer; repaid 125 creates RBPAY-202609-00003. Final claim PAID, outstanding 0, older payments 00001/00002 VOIDED. Manifest has 2 pinned source files; 48-column workbook seller reference QA1109-001 matches browser source. Cancelled export has 3 SUPERSEDED/history files and empty current evidence references. Guides match current controls. Screenshots visually checked.
Runtime: Worktree `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-main-starter-qa-20260911`; branch `codex/starter-qa-fixes-20260911`; API final PID 56298 port 3001, web 3000, AI 3002, DB watchdog_starter_qa_20260911/Redis11. Original checkout and other running projects were not modified by this task. No commit/push/cloud/deploy performed.
Next: User review of local diff/report. Keep external OCR/AI/LINE/mail marked blocked, not passed; inherited exhaustive variants are enumerated in the report. Do not claim UAT/Production acceptance.


### Merge requested — 2026-09-11

Status: Integrating approved Starter fixes into main and develop after explicit owner request “ทำเลย”.
Scope: Commit scoped code/docs/evidence, reconcile each remote target, run PR checks and merge without force-pushing or dropping other branch changes. No cloud deployment requested.
Remote baseline: origin/main 120256910c9a320409e9cfabfe3ec5ae377c4e18; origin/develop 4153bbe9725ad0d96142fb3b66894e782f0335d6. Main adds restored migration history relative to tested baseline; develop has equivalent product tree with different merge ancestry. Main protection requires one approving review; develop does not require reviews. Follow normal PR protection.
Evidence hygiene: removed presigned local URL query strings from committed JSON, preserving file/checksum/history metadata.
Next: Commit, prepare target branches/PRs, verify checks, merge each allowed target and record exact commit/PR outcomes.
