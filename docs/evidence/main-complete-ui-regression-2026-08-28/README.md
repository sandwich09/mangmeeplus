# Complete UI regression — 28 August 2026

## Acceptance status

**Local default-feature regression matrix passed before PR332; its conflict is now resolved and integrated local checks pass. Exact integrated-head CI/develop integration pending.**

The user completed the password change and the requested payment-evidence upload. All ten assignable system roles, Owner and two custom-role variants were exercised through authenticated local UI. Twenty-two additional findings (F10–F31) were fixed and their affected paths repeated. The transfer certificate lifecycle, duplicate-resolution branches and final role/default-feature checks are complete within the explicit matrix below. This is not a claim about every possible role × input permutation or unconfigured external services.

Chrome rejected automated file selection with `Not allowed`; the user selected the original QA scribble manually. The test continued from the uploaded preview. No alternate browser/API bypass was used.

- Worktree: `mangmeeplus-main-qa-20260828`; branch `codex/main-complete-ui-regression`.
- Base: `f9f2402d23a4770d3b8570905b7643d9afda1de8`, same tree as develop integration `f734a04373520860bc9a2cc599a1e0e351e5c615`.
- Local web3000/API3003; isolated database `watchdog_main_qa_20260828`.
- Primary company still **16 enabled / 44 disabled**. No feature opened to manufacture a pass.
- Integration is the next step. PR330 was rechecked OPEN, develop→main; update it rather than creating a duplicate. No deployment, UAT mutation, real payment or external message in this pass.
- Original dirty `plan` worktree preserved. No package.json, dependency or database-schema change.

Exact ON keys rechecked after the final UI repeat: `company_settings`, `company_settings.branches`, `company_settings.security`, `dashboard_notifications`, `employee_access`, `employee_access.employees`, `employee_access.overview`, `employee_access.roles`, `expenses`, `expenses.categories`, `expenses.evidence`, `expenses.list`, `expenses.manual`, `expenses.signatures`, `expenses.upload`, `sales_documents`.

## Findings fixed

| ID | Finding | Fix and actual repeat |
| --- | --- | --- |
| F10 | “Last7days” represented Monday–Sunday. | Existing calendar-week label; all four periods and source links repeated. |
| F11 | Dashboard could retain or accept an outdated scope response. | Shared load/refresh sequence, clear stale snapshot, invalidate old requests; all/HO/Siam/Ari and rapid period changes repeated. Deterministic delayed-network reproduction is not claimed. |
| F12 | Resumed employee draft returned the previous username. | Return normalized submitted login for a single-company draft, preserve shared-account login; failing-before37-test suite and actual rename/back/next/activation/login. |
| F13 | Branch-restricted Manager could grant its own account another branch. | Trusted granter scope checked on update and activation; both UI pickers restricted. Same old UI request denied after fix; normal in-scope profile edit still works. |
| F14 | Waiting copy implied LINE delivery or posting that had not happened. | Accurate source-state wording; fresh certificate waiting/notification/expense confirmation repeated. |
| F15 | PDF renderer ignored SVG textLength and long signer names overlapped. | Font-size fitting supported by browser and rasterizer; new issued PDF downloaded/rendered. Earlier immutable affected PDF retained, not rewritten. |
| F16 | Rejected quotation had no correction/resubmission route. | Revision returns to DRAFT, clears approval state, retains rejection in audit, guarded concurrent review; Sales→Owner reject→revise→approve→issue passed. |
| F17 | Converted invoice showed no source. | Existing convertedFromDocumentId fallback and source button; opens the correct closed quotation. |
| F18 | Evidence warning filter showed3 rows but exported all records. | Selected IDs intersect server scope/filter, matched cards/counts/export, stale-package invalidation; actual XLSX3rows and manifest0files verified. |
| F19 | API outage appeared as missing permission; retry replayed cached error. | Honest temporary-error boundary and full-page retry; controlled outage/recovery restored the same authenticated session. |
| F20 | Custom role label displayed “user menu”. | Scoped display-only role names; authorization remains role-key based. Actual custom login/rename/permissions verified. |
| F21 | PREPARED/PAYER_CERTIFIED certificates lacked cancel/revise controls. | Existing guarded history panel visible at every stage; both pending versions cancelled/revised, reasons retained, cancelled notification source non-actionable. |
| F22 | Voided non-posted document still said pending posting. | Not-required status on non-reversal void, normalize obsolete legacy queue display; new receipt void and old debit-note display repeated. Real journal reversal remains unchanged. |
| F23 | Standalone receipt issued unpaid with no settlement action; linked receipt could claim another posting. | UI creates receipts from fully-paid invoices or existing atomic income flow; linked receipt PAID/zero outstanding/not_required. Duplicate/parent-child guards tested. Legacy standalone API semantics and payment-allocation permissions not broadened. |
| F24 | Deferred income called anonymous customers “cash sale”. | Neutral unnamed-customer copy; both modes repeated. |
| F25 | Disabled custom role looked active and still offered Edit/Disable. | Disabled status on card/detail, no repeated actions; reload and grant-picker exclusion verified. |
| F26 | Permission overview omitted own/related expense access and own editing. | Read-only permission projection includes existing scoped read/update keys; Staff shows3menus with expense view/create/edit, no approval/delete. No grants changed. |
| F27 | Sales lists silently stopped at the API's first20 rows. | Existing Pagination reused for documents/counterparties/payments, late-response guards and filter resets. UI pages20+8,20+1,20+1, next/previous/type-reset passed. |
| F28 | Staff duplicate guidance instructed an unavailable resolution button. | Shared TH/EN copy asks an authorized reviewer; Staff still cannot resolve or confirm. Actual warning repeated without a permission change. |
| F29 | Confirmed duplicates still said merely possible and asked for another resolution. | Existing duplicate state drives summary/card/footer/confirmation-blocker copy. Owner/Staff/Auditor see the final state; confirmation stays blocked and resolution buttons remain absent. |
| F30 | Employee menu projection looked like the role's entire permission set. | Clarified the existing registry-only summary/count/empty state, without expanding the matrix or changing grants. Admin/Owner/Manager actual repeat. |
| F31 | Disabled branches remained selectable and broke scope changes with403. | Both employee pickers exclude inactive branches and retained inactive selections; backend validation unchanged. Failed-before4/5→5/5; Owner saved Manager to HO-only, restricted Manager had no broader grants, wizard restored Staff/all branches successfully. |

Separate test-fixture repair: the real-PostgreSQL reimbursement race suite had8 failures because old fixtures omitted required branchId. A branch belonging to that test company is now created and passed by both factories. The same8 race tests pass with PostgreSQL required; production enforcement was not weakened.

## Actual UI coverage

| Area | Exercised |
| --- | --- |
| Accounts | Draft/resume/username correction/activate; user-completed password change; legal required acknowledgements and linked documents; login/logout; disable revokes session and rejects login; re-enable restores access. |
| Role matrix | STAFF, SALES, INVENTORY, MARKETING, MANAGER, HR, ADMIN, AUDITOR_READONLY, FINANCE, ACCOUNTANT, Owner; custom read-only and own-expense variants. This is representative per-role testing, not every role × every possible mutation. |
| Permission boundaries | Protected Owner immutable; prohibited grant options absent; HR operational grants; Admin filtered grants; Manager own branch enforcement; read-only direct-route denial; own-expense isolation. |
| Dashboard/tasks | Four periods, refresh, all/HO/Siam/Ari, exact pending links including empty queue. Workflow-new remains OFF; no new standalone workflow task claimed. |
| Notifications | Real payer/approver event, bell/center counts, unread/all, mark/read-all/dismiss, source links including cancelled/stale sources, empty and API-down/recovery. Preferences/rules remain OFF. |
| Expenses | Manual3line arithmetic, discount/service, included/excluded/mixed VAT, WHT and over-base gate; back/next/save/reload; submit/confirm; reject/restart/edit/resubmit; partial/full/overpayment rejection and void. |
| UAT example | Existing authorized UAT UI and matching local sample read only; local upload/preview; manual180.00 / includedVAT11.78 after local AI Gateway unavailability feedback. The current reader is Vision AI, not a separate legacy OCR provider; no live AI-read success is claimed. |
| Signatures | Original QA zigzags only; empty/draw/clear/redraw/save/reload, replace/retire, uploaded image/background removal. No real identity imitated. |
| Certificates | Cash and transfer source→prepare→payer review/attest/sign→Owner review/sign/issue→actual PDF→source confirmation; Owner-self case; missing prerequisites; pending cancel/revise, version history, source notification state. Transfer missing-proof/unselected-proof gates and user-uploaded proof passed. |
| Duplicates | Staff created3 same-seller/number/date/42.28 documents through UI. Owner scan, exact source link, empty/short reason, cancel, dismiss, partial dismissal with another candidate, confirmed duplicate and persistent rescan states passed. Staff/Auditor cannot resolve. Concurrent stale save rejected; reload recovered. These are metadata-match cases, not a second binary-checksum upload. |
| Sales | Quotation300→invoice→partial100+201 with credit1; independent quotation15.55→billing→fully paid; correction-note direction/capacity/reason checks, issue/void; linked receipt duplicate/parent-void guards. Tax-invoice creation honestly gated by missing configured applicable Tax Codes; no success claimed. |
| Income | Immediate300.30, WHT9, cash291.30 with invoice/receipt bundle; deferred22.40 due-date validation→payment→receipt; named customer + revenue category + card1.11 persisted on invoice/receipt. |
| Master data/settings | Expense and revenue categories create/duplicate/rename/off/on; QA branch create/invalid tax code/duplicate/rename/disable; counterparties and pagination. Missing designated approver disables save. Saved/reloaded/cleared QA advice with original functional policy defaults. |
| Evidence/downloads | Date/branch/status/warning/empty filters; empty export disabled; actual XLSX and signed manifest inspected. Post-fix no-file workbook3rows/43columns/sum36473.50 rendered across all columns; PDF A4 and long labels visually checked. |
| Responsive/guides | 390×844 dashboard/menu/manual draft-create/delete, no horizontal overflow; viewport restored. All10 expense,12 certificate,13 reimbursement guide topics expanded. Not all-device certification. |

### Key records and safe evidence

- Expense EXP00050 confirmed250.25/WHT5.25/cash245; uploaded EXP00051 paid80+100 then voided.
- 23.00 source `cmtcuw2v70016jjk1eelbli5s` rejected/restarted/corrected/resubmitted; SRC00003/00004 cancelled versions retained. SRC00005 version3 issued with both dummy signatures; source EXP00052 confirmed and transfer23.00 recorded once, zero outstanding.
- QT00003→INV00014; QT00004→BN00002 fully paid15.55. Final UI/DB show BN payments OTHER5.55 plus CHEQUE five×1.00 and5.00; earlier memory's transfer attribution was incorrect. Transfer coverage comes independently from INV00014 and EXP00052.
- Duplicate sources A `cmtczj789002yozk1htq3iocq`, B `cmtczk5xo0033ozk1hwblvxum`, C `cmtcznhag003mozk1s3ulrxl1`; B dismissed, C confirmed duplicate. These deliberately unresolved accounting drafts were not financially confirmed.
- REC00004 linked300; REC00006 linked22.40; REC00007 linked1.11: issued PAID/not_required.
- QA employee restored ACTIVE/STAFF/all branches. Custom role disabled; QAUI28 branch inactive. QA categories remain active.
- Only the newly created mobile QA draft12.34 was permanently deleted through its confirmation dialog. No existing user record deleted.
- Policy is now explicitly configured as OWNER_SELF / ALLOW_SUPPORTING_EVIDENCE_ONLY with advice NULL, equivalent to prior functional defaults.

[Role matrix](role-matrix-ui.json), [final role/default-feature repeats](final-role-ui.json), [dashboard earlier final links](dashboard-periods-final.json), [expense amounts](staff-expense-amounts.json), [payment result](finance-payment-ui.json), [filtered workbook](evidence-no-file-filter-three.xlsx), [fixed cash PDF](SRC-202608-00001-after-fix.pdf), [transfer version3 PDF](SRC-202608-00005-transfer-dummy.pdf), [full-page transfer rendering](SRC-TRANSFER-09-pdf-full-page.png).

The BUG-Fxx screenshots distinguish before and after. Earlier screenshots and counts are chronological evidence, not later acceptance claims. `dashboard-periods-after-fix.json` predates F11; `final-role-ui.json` contains the latest four-period links (HO pending7, outstanding2494) and all three sales lists on page2. The Sales-role page2 capture is counterparties, not documents: that role sees only5 quotations. Owner verifies document pagination20+8.

## Automated verification

After develop received PR332 (`9efcebf2`), its review-page changes were merged without dropping either side: the visible confirmation-blocker notice and F29 confirmed-duplicate decision now share one helper. Integrated checks: web1251/1251, gateway1001/1001, contracts206/206, required-PostgreSQL API suite exit0, API/web types and API/isolated web builds exit0. Conflict-focused55/55 and LINE-buffer65/65. A timing-sensitive pre-existing batching test was changed to existing mock timers (no production logic change); original assertions remain plus precise boundary assertions.

Actual post-merge Owner next/next confirmed the disabled final-duplicate action and visible reason; role-builder open/cancel and disabled-role state pass. [Owner duplicate](MERGE-331-01-owner-confirmed-duplicate.jpg), [role builder](MERGE-331-02-role-builder.jpg). Staff post-merge repeat is not claimed: its in-app tab is trapped on a connection-error data URL rejected by Browser policy. Earlier full role-matrix evidence remains pre-PR332 evidence, not silently relabeled.

The table below records the preceding complete matrix checkpoint.

| Check | Final result |
| --- | --- |
| Web `pnpm test` | 1235passed,257suites,0failed/skipped after F31 |
| API `REIMBURSEMENT_PG_GATE_REQUIRED=true pnpm test` with local QA environment | Exit0, including real-PostgreSQL pretest; dot reporter, no asserted test total |
| PostgreSQL race focused | 8passed,0skipped |
| Permission matrix focused | Before4pass/1fail; after5passed |
| Duplicate copy/audit/steps focused | F28 before2pass/1fail→3passed; F29 combined34passed |
| Employee picker focused | F30 before3pass/1fail→4passed; F31 before4pass/1fail→5passed, plus actual UI saves |
| API and web `pnpm exec tsc --noEmit` | Both exit0 |
| Contracts/API builds | Exit0 |
| Web `NEXT_DIST_DIR=.next-main-complete-qa-build pnpm exec next build --webpack` | Exit0; separate build directory preserves the running dev server |
| Maintenance pin generator `--check`, pin-sync spec and full `production-image-security.spec.sh` | Passed after refreshing the two generated checksum lines; local/mock checks, no deploy |
| Linux PDF font parity | DejaVu-only fallback reproduced signer overflow; production Noto fonts pass the same unchanged raster bounds in two existing local Linux images. Full focused PDF/certificate/voucher suite23/23 on macOS and Linux. CI now installs/verifies the runtime's existing Noto prerequisite; YAML/45-file pins/full security checks pass; corrected-head full CI pending. |
| `git diff --check` | Clean |

Latest logs: `/tmp/mangmee-main-qa-web-final-f31.log`, `web-types-f31.log`, `web-build-f31.log` under the same prefix; unchanged backend verified by `/tmp/mangmee-main-qa-api-final-f29.log` and `api-types-f29.log`. Focused before/after checks are also documented in [task memory](../../agent-memory/main-complete-ui-regression-2026-08-28.md). Tests and database corroboration do not replace UI actions.

## Integration and boundaries

1. [Develop integration PR331](https://github.com/MangmeeDev/mangmeeplus/pull/331) contains code/evidence commit `c5aee0142686aeb7e3f41f1448b9e32efe299bb7`. Initial CI `33177695687` failed the stale maintenance-pin preflight; later tests were skipped, not passed. The standard generator refreshed only server-session and validator checksums; no gate/policy condition changed. Require the corrected-head CI before merge, then update existing main PR330.
   - [CI33179749488](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33179749488) completed SUCCESS on `3a495c3720c30fb006b9d631943039e57059d30b`. Develop subsequently accepted PR332 and PR331 conflicted in two button hunks of ExpenseReviewPage. The combined source requires its own CI; the old successful run does not certify that merge.
   - CI `33178043014` on69c5e086 passed web1235, but failed the added long-signer raster test because CI lacked the existing runtime font prerequisite. Local Linux DejaVu-only reproduction: payer ink102–377 against allowed105–375; approver475–755 against480–750. With production Noto fonts the same helper yields111–368 and484–746. Add fonts-noto-core/fontconfig and require fc-match to resolve Noto Sans Thai before tests. Bounds and application code remain unchanged; this failed CI is not an acceptance pass.
2. No main merge/deployment is authorized or performed by this task. Deploy workflows are manual; no UAT/production/READY run was dispatched.
3. Missing applicable Tax Codes, unconfigured local Vision AI service, feature-OFF new workflows and physical paper/external delivery are explicit prerequisites or scope exclusions, not claimed successful flows. No known unexpected blocker remains in the earlier exercised local matrix.
4. User clarified one receipt-read unit, not one unit per model call. Existing governance already counts one admitted document/image command and deduplicates transport retries; LINE router/extraction share one admission. Internal `ocr` identifiers are compatibility names. Whether an explicit new manual read of the same receipt should remain1 total is awaiting the user's answer; no speculative quota/billing change or historical backfill was made.

Credentials, raw UAT images, private receipt screenshots and signed download manifests/URLs remain outside the repository. Physical wet-signed paper, live LINE/Vision AI delivery and real payment integrations are not certified by these local dummy tests.
