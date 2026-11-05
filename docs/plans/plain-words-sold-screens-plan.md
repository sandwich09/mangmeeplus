# Plan: plain words on sold screens and in LINE — owner step 6

Status: REVIEW DRAFT — six focused rounds, audit limits closed for the current free/paid baseline, implementation and reviewed-help approval pending · Re-anchored to develop e7c422802 on 2026-11-04 · controller accepted round 3 on 2026-11-04 (B18 daily retirement and B23 owner exception recorded outside wording); owner answers recorded 2026-11-04
Owner: thawatchai (wording/help approval); next implementation lane (scoped rounds and proof)
Related: `docs/specs/plain-words-sold-screens-spec.md`; `docs/guidelines/thai-ux-standard.md`; `docs/plans/sold-ux-owner-decisions-2026-10-13-plan.md`; `docs/agent-memory/expense-leadership-specs-2026-10-23.md`
Baseline: develop `e7c4228026eec3c696fa76986420d2c97cb26676` in worktree `expense-specs-20261023`, re-opened 2026-11-04. Original audit `0f938a36154c5bfbd8018b7bdafd8b18e3fd8df2` is retained as history.

## 1. Contract of the work

Use requirements R1–R13, word table W01–W34, proposed sentences C01–C60, acceptance A1–A13 and occurrence ledger from the spec. This plan adds no independent product requirement. Each round has about five related views, tests first where money/tax/permissions are involved, then the smallest text/helper diff, guide/journey pins and one proof bundle. No generic translation system, environment feature switch, new permission or dependency. No package.json edits.

Step 6 follows the owner's ordered correctness work; the ordering source is `docs/agent-memory/expense-leadership-specs-2026-10-23.md:51`–`:59`. In particular, the WHT month summary numeric correction belongs to owner step 3. The wording round must not take over that fix.

Exports, tax papers and printed PDFs are frozen. Shared-code changes require caller checks before editing: `expense-export.logic.ts:236` imports INPUT_VAT_RIGHT_LABELS; `expense-input-vat-decision.ts:63` stores reviewer condition labels; `disbursement-voucher-pdf.logic.ts:74` reads the shared voucher title. Preserve these exact consumers. No Prisma change is expected; do not run generate/validate for a text-only diff. If discovery requires schema work, stop that item and write a separate additive-only design; this plan does not authorize one.

## 2. Accepted five rounds, extended by round 6 below

All paths below are relative to the repository root. Short filenames refer to the exact inventory paths in the spec. Proposed test names are additions to existing files, not new tests silently claimed as already present. A step cannot be accepted with a refusal leading into an unsold/staff screen; B6/B7 require separately reviewed fixes, and their implementation-pending state must remain visible; their separate designs are resolved in spec §13.

### Round 1 — the review journey (about five views)

Views: document/evidence check, VAT decision, summary, confirmed detail and buyer-mismatch dialog. Covers R1–R3, R12; C01–C22 and C31/C32. No label change to exported status values.

| Step / depends on | Files / exact work | Test first / verification command | Acceptance / risks |
|---|---|---|---|
| P1.1 / baseline | Open current callers of `INPUT_VAT_RIGHT_LABEL`, `INPUT_VAT_RIGHT_LABELS`, reviewer conditions and correction helpers; snapshot exact export labels and saved decision facts | Add PWS-OUTPUT to `apps/api/src/modules/expenses/domain/logic/expense-export.logic.spec.ts`; run command API-EXPORT (§4) | A1/A12; catches accidental shared export changes before wording edits |
| P1.2 / P1.1 | `packages/contracts/src/expenses.ts` title only; `expense-input-vat-right.logic.ts` existing inputVatRightLabel/reviewer display; `ExpenseInputVatRight.tsx` label/condition rendering; `ExpensesPages.tsx` ExpenseReviewForm; preserve stable codes | Add PWS-VAT and PWS-WORDS in existing `ExpenseReviewPage.rendered.spec.ts`, `one-source-words.spec.ts`; run WEB-REVIEW | A2/A3; reason names and conditional legacy labels are pins |
| P1.3 / P1.2 | `ExpenseReviewPage.tsx` badge/review links, `expense-buyer-match.logic.ts` text consumer, `workspace-dictionary.ts` buyer mismatch and VAT labels; no predicate edits | Add PWS-VAT-UNDO to `expense-correction.spec.ts`, covering prior NEEDS_REVIEW/CLAIMABLE and header/line paths; run WEB-REVIEW | A3/A4; undo must not imply eligibility, line-owned tax cannot use header mark |
| P1.4 / P1.3; Q2 for source-hash publication | `expenses-guide.content.ts` and `company-profile.logic.ts` return wording; corresponding guide/hash metadata only through reviewed help step P5.4; UI pins in `e2e/journeys/expense-input-vat-right.journey.spec.ts` and `plain-shop-records-everything.journey.spec.ts` | PWS-CHAIN split UI assertions from unchanged export assertions; WEB-GUIDE plus JOURNEY for these two files | A11/A12; don't blanket-replace “สิทธิภาษีซื้อ” in export assertions at journey `:261` |
| P1.5 / P1.1–P1.4 | Inspect real review/detail/buyer dialogs as reviewer, sender/read-only and manager; record states actually visited | `bash scripts/local-proof/tsc.sh web`; focused checks once more only after new changes; browser 390/1280/1556 | A1–A4/A8; one primary action, available refusal exit, no Thai clipping; report help approval pending if not available |

### Round 2 — capture, totals and finding evidence (about five views)

Views: upload/result, manual form, list, categories and shared evidence/export dialog. Covers R4/R5; C23–C33/C37–C39. Uses Round 1 words without inventing a second label source.

| Step / depends on | Files / exact work | Test first / verification command | Acceptance / risks |
|---|---|---|---|
| P2.1 / P1.2 | `ExpensesPages.tsx` totals/override hints, `expenses.model.ts` audit wording, existing `EXPENSE_WITHHOLDING_WORDS` in contracts and corresponding dictionary values; C21 wrong button reference | PWS-MONEY in `ExpenseReviewPage.qa.spec.ts` plus rendered override branch in `ExpenseReviewPage.rendered.spec.ts`; WEB-REVIEW | A4; fixtures: VAT included/excluded, mixed/custom/0/exempt/non-VAT, explicit WHT base and missing carrier line |
| P2.2 / P2.1 | `tax/TransactionTaxLineSelector.tsx` existing taxChoiceLabel, `tax/transaction-tax.model.ts` sold-expense diagnostics; local display-only semantics; no master-data rename | PWS-VAT-CHOICE in existing `tax/transaction-tax.model.spec.ts`, `tax/transaction-tax-suggestion.spec.ts`; WEB-TAX-CAPTURE | A4; keep non-expense consumers unchanged, preserve custom unknown labels B9 |
| P2.3 / P2.1 | `workspace-dictionary.ts` upload/categories/claimability wording; `ExpensesPages.tsx` list badge; `ExpensesWorkspacePanels.tsx` only reachable category/evidence copy; `evidence-audit.logic.ts`, `SubstituteReceiptSettingsPage.tsx`; `external-signup/SignupWelcomePage.tsx` BULLETS C61 | PWS-CAPTURE in `ExpenseReviewPage.qa.spec.ts`, existing `expenses.model.spec.ts` if affected; PWS-WELCOME in existing `external-signup/signup-copy.qa.spec.ts`; WEB-REVIEW | A5; no hidden ledger/backfill text cleanup, loading differs from empty/error |
| P2.4 / P2.2–P2.3; Q2 for changed guide hash | `expenses-guide.content.ts`, `substitute-receipt-guide.content.ts`, existing manual-entry guide adapter; update same-round pins in `staff-receipt-from-phone.journey.spec.ts`, `evidence-and-settings.journey.spec.ts`, `no-receipt-certificate.journey.spec.ts` | WEB-GUIDE; API-EXPORT; JOURNEY for these three files | A5/A11/A12; UI export dialog may change, exported bytes/terms may not |
| P2.5 / P2.1–P2.4 | Real upload failure/result, manual/tax-choice/error, list/evidence and category dialogs; no provider spend required (existing local fixtures) | `bash scripts/local-proof/tsc.sh web`; browser 390/1280/1556 | A4/A5/A8; wrong input preserves typing and points to actual field |

### Round 3 — payment documents, claims and the shop (about five screen families)

Views: voucher list/draft/document, claim/payout, home/bell, employee-role builder and shop/profile/branch settings. Covers R6–R8; C34–C40 and kept W23/W24. Not a layout redesign.

| Step / depends on | Files / exact work | Test first / verification command | Acceptance / risks |
|---|---|---|---|
| P3.1 / P1.1; Q1 answered 2026-11-04 | `expenses/disbursement-vouchers/DisbursementVoucherDocumentPage.tsx` show “หลักฐานว่าบันทึกจ่ายแล้ว” once on the paid view, keeping “ใบสำคัญจ่าย”; dictionary/document logic names retained; `disbursement-voucher-guide.content.ts` agrees | Existing `e2e/journeys/payment-document-two-people.journey.spec.ts` and `voucher-supporting-files.journey.spec.ts` retain title/number/output checks; JOURNEY | A6/A12; don't alter shared PDF title or draft/paid state |
| P3.2 / P1.3 | `ReimbursementPayout.tsx`, `SavedPayoutAccountsCard.tsx`, `ReimbursementSourceFacts.tsx`, `reimbursements.logic.ts`; existing correction-message helpers for reachable refusals; bank save name C35 | PWS-PAYOUT in `reimbursement-saved-payout.spec.ts`; PWS-LOCK in `expense-correction.spec.ts`; WEB-CLAIM | A7; own/other owner's notice, frozen submitted account, no accounting rewrite |
| P3.3 / P3.2 | `CompanyProfilePage.tsx`, `company-profile.logic.ts`, `branch-settings/BranchSettingsPage.tsx` and `WhtPayerModeSettings.tsx` only identified copy; role pack labels in `employee-access/domain/registries/capability-pack.registry.ts` only sold packs; inspect home and notification consumers | Extend existing `settings-menu.logic.spec.ts` with PWS-SETTINGS; `e2e/journeys/team-and-roles.journey.spec.ts`; WEB-SHELL | A8; role names stay, no new owner notification, no unsold settings-card edits |
| P3.4 / P3.1–P3.3; Q2 for guide hashes | Corresponding `reimbursement-guide.content.ts`, voucher/starting guide and same-round journey pins (`claim-declined-then-paid.journey.spec.ts`, `paid-expense-reopened.journey.spec.ts`, `shop-menus-everyday.journey.spec.ts`) | WEB-GUIDE, WEB-CLAIM, JOURNEY for affected files | A6–A8/A11; notice wording must match actual recipient/state, not assumed delivery |
| P3.5 / P3.1–P3.4 | Browse all changed views/dialogs; inspect unchanged home/bell/roles explicitly if no replacements were needed | `bash scripts/local-proof/tsc.sh web`; API typecheck only if shared/API sentence changed; browser 390/1280/1556 | A6–A8/A12; preserve one-press expense payment, owner self-approval and required claim signatures |

### Round 4 — withholding papers and messages (about five views)

Views: combined-month page, form/review/filing dialog, 50 ทวิ list, issue/correction/external-history dialogs, tax signature/branch settings. Covers R9 and the tax subset of shared errors. External recording remains available in lower packs.

| Step / depends on | Files / exact work | Test first / verification command | Acceptance / risks |
|---|---|---|---|
| P4.1 / P1–P3 words | `tax/WithholdingPage.tsx` field/column wording and explanation; `WhtCertificatesPage.tsx`, dictionary WHT labels; no due-date/form/state calculations | PWS-WHT in existing `WithholdingPage.spec.ts`; WEB-WHT | A9; include filed/downloaded/additional, accountant-prepared and PND2 exception |
| P4.2 / P4.1 | `ExpenseCertificateCard.tsx`, `ExpenseCertificateReopen.tsx`, `ExpenseCertificateVoidDialog.tsx`, correction fields/history; `TaxSignatureSettingsPage.tsx` copy only if ledger identifies a change; preserve exact paper names | Existing `ExpenseReviewPage.certificate.spec.ts`, PWS-CERTIFICATE in `ExpenseReviewPage.rendered.spec.ts`; WEB-REVIEW; API-PDF | A9/A12; spelling correction is not factual correction; 249–999 must not gain system issue button |
| P4.3 / P4.1–P4.2 | `common/api/api-error-message.ts` sold code/exact/regex translations and shared correction-message functions; simplify actual refusal only; no unknown diagnostic or unsold bulk changes | PWS-ERROR in `api-error-message.spec.ts` and `api-error-coverage.spec.ts`, plus `expense-correction.spec.ts`; WEB-ERROR | A2/A9; code-based and regex paths must agree, month/form unknown stays unknown |
| P4.4 / P4.3; B7 separately corrected; Q2 | Sold portions of `tax-guide.content.ts`, `getting-started-guide.content.ts`; do not write new VAT/ledger/report guide instructions; pins in `withholding-forms.journey.spec.ts`, `package-upgrade-unlocks-50-tawi.journey.spec.ts` | WEB-GUIDE; JOURNEY; API-EXPORT/API-TAX-EXPORT | A9/A11/A12; report B7 as pending until content-scope fix passes |
| P4.5 / P4.1–P4.4 | Real 1,999 viewer/preparer/issuer and lower-pack external record, permission/error branches; inspect dialogs, accessible names and retained statutory terms | `bash scripts/local-proof/tsc.sh web`; `bash scripts/local-proof/tsc.sh api` if shared code changed; browser 390/1280/1556 | A8/A9/A12; exported/printed outputs are compared, never edited |

### Round 5 — fixed LINE, guides and chain proof (about five families)

Families: action/refusal cards, calculation/month read cards, captured-record explanation, persona/help cards and guide-linked replies. Covers R10–R13. All earlier rounds update their journey pins immediately; this is final cross-channel closure, not permission to leave them stale.

| Step / depends on | Files / exact work | Test first / verification command | Acceptance / risks |
|---|---|---|---|
| P5.1 / P1–P4; B6 behaviour fix separately reviewed | `line-expense-action.service.ts` MISSING_LABELS/refusals, `line-voucher-action.service.ts` preview labels, `process-line-webhook.use-case.ts` legacy fixed reply/card text, `line-language.logic.ts` exact Thai lookup keys; classifier/matcher/model prompt unchanged | PWS-LINE in registered `process-line-webhook.use-case.spec.ts`, testing allowed signed confirm/payment, blocked action, raw enum label and same-card web exit; API-LINE | A10; no blanket refusal after applied action, no staff-console dead-end accepted |
| P5.2 / P5.1; owner step 3 money correction already accepted | `erp-advisor-document-tools.use-case.ts` existing WHT tools; Gateway `expense-explain-formatter.ts`; fixed persona joke in `mangmee-joke-bank.ts`; sold fixed scope/card labels only | PWS-WHT-LINE in registered `erp-tax-tools.use-case.spec.ts`; Gateway `expense-explain-record.spec.ts` and fixed-copy assertions in `response-composer.agent.spec.ts`; API-WHT/GATEWAY | A4/A10; same gross/base/net, no rate/deadline inference; unsold tax/bank/report formatters unchanged |
| P5.3 / P1–P4 guides; Q2 concrete review | Q2 **answered 2026-11-04**: the controller shows the owner the real rendered C53–C56/C62/C71 cards, inherited titles and affected guide sources before release; record the owner’s approval of those actual renderings before P5.4/P6.2 publication. `product-help-draft-cards.ts` and `approved-product-help.ts` are the owning fixed card/pack sources. Retain active reviewed bytes until the new review is approved | PWS-HELP in existing `approved-knowledge.spec.ts`; verify current v4 fallback and v6 active source references; GATEWAY-HELP | A11; no fictitious owner reviewer/date, no prompt edit; if pending, report help portion pending |
| P5.4 / P5.3 approval | Create reviewed next help revision using existing version/status/hash fields, update exact changed guide source hashes; run guide quote pins. Regenerate W00 once only after final hashed source edits; inspect artifact change and rerun frozen check | WEB-GUIDE, GATEWAY-HELP, W00-UPDATE then W00-CHECK (§4); add no tests to unlisted W00 file | A11/A13; getting-started guide hash is separate from help pack source hashes; review both |
| P5.5 / P5.1–P5.4; B6/B7 closed or explicitly not accepted | Whole-chain LINE capture → web check/confirm → payment/voucher → external or system certificate → concerned person's notice → accountant download. Compare amounts/rows/terms; inspect all changed UI states at all widths | API-LINE/API-WHT/API-EXPORT/API-TAX-EXPORT/API-PDF; focused web/Gateway specs; typecheck API/web; affected JOURNEY files; W00-CHECK | A1–A13; release-ready claim requires all acceptance, owner review and actual browser evidence; no deployment in this plan |

## 3. Existing pins and exact test placement

| Existing pin, opened evidence | Why the round must update or preserve it |
|---|---|
| `apps/web/src/features/expenses/ExpenseReviewPage.qa.spec.ts:10` “does not promise ledger posting” | Add the sibling ExpensesPages VAT-override text to coverage; the old source read at `:8` misses it. |
| `apps/web/src/features/expenses/ExpenseReviewPage.rendered.spec.ts:21` “mutable” imports / harness | Render the real branches and accessible names; avoid an assertion that only mirrors a replacement string. |
| `apps/web/src/features/expenses/expense-correction.spec.ts:25` and `:38` | Existing lock tests pin accounting text and unknown-form safety. Update sentence expectations while retaining action/form/permission assertions. |
| `apps/web/src/features/user-guide/user-guide.content.spec.ts:456`, `:481`, `:492`, `:501` | Quote parity, exact control names, PND3/53 and lower-pack external recording. Keep unsold guide tests untouched except separately scoped B7 correction. |
| `apps/web/src/common/api/api-error-coverage.spec.ts:23` OPEN_MODULES | Includes unsold modules as well. Coverage passing is not proof the sold-only inventory is correct; change only identified sold error text and preserve raw-code fallback. |
| `apps/api/src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts:468` “every server-worded document summary follows th/en” | Preserve language selection/grounded facts when “ประเภทเงินได้” changes. |
| `apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts:60` / `:71` | Legacy reviewed pack and whole-file source hash are pinned; a guide-only edit can break this test. |
| `e2e/journeys/expense-input-vat-right.journey.spec.ts:197`, `:203`, `:261`, `:326` | Update textbox/region/choice labels, but retain exact accountant header expectations and semantic selection. |
| `e2e/journeys/payment-document-two-people.journey.spec.ts:257` | Keep “ใบสำคัญจ่าย”, one document number and paid-state title. |
| `e2e/journeys/plain-shop-records-everything.journey.spec.ts:123` | Current step name “ภาษีและเอกสาร” is retained unless explicitly changed; don't rename incidentally. |

API registration was checked read-only using the required `grep -c "<file>" apps/api/package.json` form. Counts are matching **lines**, not distinct test executions:

| Existing API file | Count / permitted use |
|---|---|
| `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` | 2 — new PWS-LINE tests here |
| `src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts` | 3 — new PWS-WHT-LINE tests here; this existing file already imports advisor document tools |
| `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` | 1 — new PWS-OUTPUT invariant tests here |
| `src/modules/tax/domain/logic/tax-export.logic.spec.ts` | 1 — existing tax export regression; add output-word invariant here only if needed |
| `src/modules/tax/domain/logic/wht-certificate-pdf.logic.spec.ts` | 1 — existing paper regression, no new PDF design |
| `src/modules/line-ai/line-ai-capability-manifest.spec.ts` | 0 — existing direct artifact check only, no new tests in this file |
| Proposed-looking `src/modules/expenses/expense-input-vat.pg.spec.ts` / `domain/logic/disbursement-voucher-pdf.logic.spec.ts` | 0; do not invent a registered path or edit package.json to add it |

## 4. Runnable verification commands

Execute from this worktree after the relevant implementation; commands below have not been run by the documents lane. The normal text-only round needs its focused specs and typecheck, plus its changed journeys/browser proof; do not run unrelated heavy suites without a changed dependency or failure.

```sh
# API-LINE
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
# API-WHT
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts
# API-EXPORT
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/domain/logic/expense-export.logic.spec.ts
# API-TAX-EXPORT
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/tax/domain/logic/tax-export.logic.spec.ts
# API-PDF
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/tax/domain/logic/wht-certificate-pdf.logic.spec.ts

# WEB-REVIEW
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/expenses/ExpenseReviewPage.qa.spec.ts src/features/expenses/ExpenseReviewPage.rendered.spec.ts src/features/expenses/ExpenseReviewPage.certificate.spec.ts src/features/expenses/expense-correction.spec.ts src/common/i18n/one-source-words.spec.ts
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/external-signup/signup-copy.qa.spec.ts
# WEB-TAX-CAPTURE
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/tax/transaction-tax.model.spec.ts src/features/tax/transaction-tax-suggestion.spec.ts
# WEB-CLAIM
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/reimbursements/reimbursement-saved-payout.spec.ts src/features/reimbursements/ReimbursementsPages.rendered.spec.ts
# WEB-SHELL
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/web-core-workspace/settings-menu.logic.spec.ts src/features/web-core-workspace/sold-features-regressions.spec.ts
# WEB-WHT
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/tax/WithholdingPage.spec.ts src/features/tax/TaxSignatureSettingsPage.spec.ts
# WEB-ERROR
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/common/api/api-error-message.spec.ts src/common/api/api-error-coverage.spec.ts src/features/expenses/expense-correction.spec.ts
# WEB-GUIDE
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/user-guide/user-guide.content.spec.ts src/features/user-guide/disbursement-voucher-guide.content.spec.ts src/features/user-guide/expenses-guide-manual-entry.spec.ts
# GATEWAY / GATEWAY-HELP
pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/agents/expense-explain-record.spec.ts src/modules/line-ai/agents/response-composer.agent.spec.ts src/modules/line-ai/agents/approved-knowledge.spec.ts

bash scripts/local-proof/tsc.sh web
bash scripts/local-proof/tsc.sh api
# Gateway compiler after Gateway edits; use its existing package command.
pnpm --filter @watchdog-bms/ai-gateway typecheck

# W00-UPDATE: maintenance mode, once after final source edits and reviewed help changes
UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts
# W00-CHECK: frozen result must pass independently
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts

# JOURNEY example; substitute exactly the affected existing journey files from the round.
pnpm exec playwright test e2e/journeys/expense-input-vat-right.journey.spec.ts --project=chromium
pnpm exec playwright test e2e/journeys/expense-input-vat-right.journey.spec.ts --project=journeys-mobile
```

`journeys-mobile` is **375 px**, not 390 (`playwright.config.ts:109`); `desktop-1280` matches only evidence specs (`:133`). Those project names do not establish this task's three required widths. In each affected existing journey, use the existing page/role fixture and set every participating page's viewport to 390, 1280 and 1556 before the respective pass (or the existing journey's own width parameter if it has one); do not change package scripts. Capture and inspect images, measure action groups and check page overflow at each width with the sidebar open. Report exact viewport and role rather than assuming a desktop project proves it.

No prisma command is scheduled: no schema/data shape changes are proposed. No cloud command/deploy, message to another person, live Revenue filing, actual transfer or paid AI experiment is part of wording verification.

## 5. Stop/acceptance record

Before accepting a round, record the exact changed files, requirement/acceptance ids, focused commands and pass/failure results, observed roles/cases/widths, images actually viewed, exports compared and unresolved gaps. The next implementation lane can use its normal task memory; this documents lane is limited to the two brief files and creates no third memory file.

Spec §11 now closes all 97 former D aliases (95 unique source lines). Spec §12 enumerates notification writers and 21 hidden role templates; §13 resolves B6/B7 designs independently. Spec §15 now certifies the current fixed-word source audit, with F/P paths and current-code exceptions.

Current documents-round evidence: read repo instructions/ponytail/Thai UX/owner plan; traced sold presets/routes/settings, review/tax/correction/LINE/guide/export consumers; checked registered API paths, W00 source set and help hashes. No app test/typecheck/browser was run because this round writes specs and plans only. Document checks verify file references and planned test paths separately; passing those is not feature acceptance.

Q1/Q2 are **answered 2026-11-04** in spec §9: P3.1 adds the approved paid-voucher line; P5.3/P5.4/P6.2 still require the controller’s rendered-card presentation and the owner’s approval before release. B6/B7 are code-findable behaviour gaps, not owner questions. Unknown/custom wording B9 is a bounded presentation limitation. Do not call the entire sold-surface programme complete while one of those required cases remains unverified.

## 6. Round-2 closure supplement: exact files, dependencies and pins

This section supersedes any first-round implication that D wording, notification templates or B6/B7 designs are undecided. It does not claim implementation. Each round remains about five related screen families; B6/B7 are adjacent corrections with separate proof. All 95 distinct D source lines use their exact step/test/acceptance/impact rows in spec §11. C01–C67 use §4/§14. Exports and paper generators are read-only regressions.

| Step / dependency | Exact smallest files/functions | Tests first and verification | Acceptance |
|---|---|---|---|
| P3.5-N / P3.2, before P3.5 browser proof | `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts` SIGNATURE_STAGES.PAYER/APPROVER C63/C64; `apps/api/src/modules/expenses/application/services/disbursement-voucher-notice.service.ts` send is a reader, not a recipient rewrite; contract notice text retained | Existing `src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts` :: PWS-NOTICE-SIGN/APPROVE; existing `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` :: PWS-NOTICE-VOUCHER; existing `src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts` :: PWS-NOTICE-PAYOUT; run exact API commands below, then API/web typecheck | A6/A7/A8/A12; no trigger, recipient, dedup, bank mask or PDF change; B18 excluded |
| P3.3-T / P1.1, alongside P3.3 | `apps/web/src/features/employee-access/role-picker.logic.ts` roleTemplateChoices and existing employee picker only as proof; registry names/bundles untouched | Existing `role-picker.logic.spec.ts` :: PWS-SOLD-TEMPLATES; registered `src/modules/employee-access/domain/logic/role-template-read-coverage.spec.ts` :: PWS-SOLD-BUNDLES; verify all four paid presets exclude the hidden examples without new grants | A1/A8 |
| P4.B7 / P1.1, before P4.4 | `apps/web/src/features/user-guide/tax-guide.content.ts` buildTaxGuide existing effective-tax-read predicate/sold branch; `apps/web/app/(workspace)/companies/[companyId]/user-guide/reports/page.tsx` ReportsUserGuideRoute existing report permissions; reuse `common/components/state/ForbiddenState.tsx` action prop | Existing `user-guide.content.spec.ts` :: PWS-B7 sold tax guide; existing `sold-features-regressions.spec.ts` :: PWS-B7 reports typed URL; WEB-GUIDE, WEB-SHELL, web typecheck and below journeys at all widths. Q2/source review before publishing hash | A1/A9/A11; full-tax/report historical readers keep original formal content; no unsold screen edit |
| P5.B6 / P1.1, before P5.1 | `apps/api/src/modules/line-ai/application/line-expense-action.service.ts` existing empty catalog return; `apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts` WhtCalculateWithholdingTool.execute empty readChoices; webhook presentation branch only after producers stop emitting staff URL | Existing registered webhook spec :: PWS-B6 empty catalog no staff URI and no automatic support request; existing registered `erp-tax-tools.use-case.spec.ts` :: PWS-B6 calculator offers message choice; API-LINE/API-WHT then API typecheck | A10; no added permission, staff-console access or final mutation |
| P5.1-A / P5.B6, before P5.5 | `packages/contracts/src/ai-tools.ts` LINE_CHAT_ACTIONS presentation only C65/C67; webhook utility draft reply C66; webhook `:12619` passes existing false to expenseReopenBlockerMessages | Registered webhook spec :: PWS-LINE-ACTION-NAME, PWS-LINE-MONTH-NAME, PWS-UTILITY-DRAFT-FACTS and PWS-LINE-PLAIN-BLOCKER; API-LINE then API typecheck; outgoing card and signed action payload assertions | A6/A9/A10/A12; voucher title itself retained |

Pinned specs and journeys must change together in the owning round; these are actual opened current anchors, not future line-number promises:

| Round | Existing pinned specs (file:line) | Journey anchors to update/preserve in that round |
|---|---|---|
| 1 review | `apps/web/src/features/expenses/ExpenseReviewPage.qa.spec.ts:10`; `ExpenseReviewPage.rendered.spec.ts:21`; `expense-correction.spec.ts:25`; `apps/web/src/features/user-guide/user-guide.content.spec.ts:456` | `e2e/journeys/expense-input-vat-right.journey.spec.ts:197`, `:203`, `:326` UI; `:261` accountant header retained; `plain-shop-records-everything.journey.spec.ts:123` journey title kept |
| 2 capture/evidence | Same review QA/rendered pins; `apps/web/src/features/tax/transaction-tax.model.spec.ts` existing diagnostic fixtures; `apps/web/src/features/external-signup/signup-copy.qa.spec.ts` welcome copy guard | `e2e/journeys/staff-receipt-from-phone.journey.spec.ts:20`; `evidence-and-settings.journey.spec.ts:37`, `:38`, `:67`; `no-receipt-certificate.journey.spec.ts:21`, `:263`; update changed UI words only |
| 3 payment/claim/shop/notice | `apps/web/src/features/reimbursements/reimbursement-saved-payout.spec.ts:23`, `:28`; `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts:165`, `:602`; `apps/api/src/modules/workflow/application/use-cases/workflow-template.use-case.spec.ts:48`, `:75` | `e2e/journeys/payment-document-two-people.journey.spec.ts:257` voucher title kept; `voucher-supporting-files.journey.spec.ts:30`; `claim-declined-then-paid.journey.spec.ts:104`; `paid-expense-reopened.journey.spec.ts:56`, `:57`; `shop-menus-everyday.journey.spec.ts:30`, `:34` |
| 4 WHT/guide scope | `apps/web/src/features/user-guide/user-guide.content.spec.ts:492`, `:501`; `apps/web/src/common/api/api-error-coverage.spec.ts:23`; `apps/web/src/features/expenses/expense-correction.spec.ts:38` | `e2e/journeys/withholding-forms.journey.spec.ts:70`; `package-upgrade-unlocks-50-tawi.journey.spec.ts:18`, `:112`, `:128`; add sold typed tax/reports-guide cases to this journey and `shop-menus-everyday.journey.spec.ts` without exposing modules |
| 5 LINE/help/chain | `apps/api/src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts:468`; `apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts:60`, `:71`; frozen W00 at existing `line-ai-capability-manifest.spec.ts:75` (no additions) | Replay Round 1–4 journey anchors with LINE capture/signed-action/notification evidence; no deferred UI pin updates. `staff-receipt-from-phone.journey.spec.ts:20` and `withholding-forms.journey.spec.ts:70` are the existing chain entry anchors |

Every browser proof uses **390, 1280 and about 1556 px**, changed states in Thai, reviewer/sender/no-grant and lower/upper pack. A text-only round requires focused specs + relevant typecheck + its own journeys; extra full suites only for an actual dependency/failure. The adjacent B6/B7 steps add their own focused checks, not a deployment or a legacy role gate.

Additional API registration checks actually executed with `grep -c "<file>" apps/api/package.json`: substitute-receipt.use-case.spec.ts **2**; workflow-template.use-case.spec.ts **1**; role-template-read-coverage.spec.ts **1**; dashboard-notification-correctness.spec.ts **1**; record-expense-payment.use-case.spec.ts **1**; reimbursement-request.use-case.spec.ts **1**; expense-document.use-case.spec.ts **1**. The initially tempting disbursement-voucher.use-case.spec.ts and reimbursement-payout.use-case.spec.ts paths return **0** and are not planned test files. No package.json edit.

```sh
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/workflow/application/use-cases/workflow-template.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/employee-access/domain/logic/role-template-read-coverage.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/record-expense-payment.use-case.spec.ts
bash scripts/local-proof/tsc.sh api
bash scripts/local-proof/tsc.sh web
```

No Prisma schema or database data changes are planned, so validate/generate/migrations are not needed for this wording work. A later schema need is a scope change; any approved migration must be additive. Never rewrite saved tax facts, stored notifications, historical PDFs or user-edited workflow rules to remove jargon. Notification source catalog changes, if any, use the existing built-in-only resync and its current preservation tests.

Documents-round result: 13 requirements; 76 change rows; all original candidate lines classified; all 97 D aliases closed; 21 role-template names enumerated; notification writers traced; B6/B7 designs resolved separately. Runtime checks unexecuted. Round 3 closes those audit boundaries in spec §15–§18 and adapts the steps to current F/P paths. Q1 approved the explanatory line; Q2 approved the recommended process, with real rendered help-card approval still required before release. No owner answer is needed to preserve the voucher title or to determine a route gate from code.

## 7. Round-3 implementation delta at develop e7c422802

Read this section with spec §18 before executing any older step. F is the eligible never-paid source-draft path and P is the active paid pack path. The same existing server-derived flag and permission intersection determine what words can appear. This adds the new audience to each requirement, as spec §18.1 states.

| Current step / dependency | Exact files and smallest work | First tests, pins and verification | Acceptance / impact |
|---|---|---|---|
| P0 / current baseline, before P1.1 | Re-open current cited sources. I0317's old follow-welcome sentence has been replaced by 9036b8552, so drop its former edit. Apply the free guard from 049aa51de, history from 1fbba874e/884ba5307 and existing delivery fixes 3f6db1729/48295b57c as baseline | Read-only id/source checks, then the unchanged focused test set for the first actual wording change. Keep the current command/postback bytes | A1/A13. No duplicate confirmation suppressor or company picker rewrite |
| P1.3 + P1.3-H / P1.1–P1.2 | `apps/web/src/common/i18n/workspace-dictionary.ts` buyer-match English values C68. `apps/web/src/features/expenses/expense-history.logic.ts` expenseHistoryActionLabel two values C73. Existing ExpenseHistoryModal consumes them | Existing `ExpenseReviewPage.rendered.spec.ts` :: PWS-DICTIONARY-EN, `expense-history.logic.spec.ts` :: PWS-HISTORY-WORDS. Add permission/source access cases only to registered `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` :: PWS-HISTORY-FREE-ACCESS. Extend `e2e/journeys/staff-receipt-from-phone.journey.spec.ts:20` and `paid-expense-reopened.journey.spec.ts:56` with history actor/action/time and safe close. WEB-REVIEW, API document command below, web/API typecheck | A1–A5/A8/A12. F sees human source edits, P sees financial history. The concise history stays action/actor/time |
| P2.2–P2.4 and P2.F / P1.2 | Existing dictionary English capture/base/substitute values C69 and free-upload hints C74, using every full J replacement. Current `ExpensesPages.tsx` and freeAllowanceNotice are readers | Existing `ExpensesPages.qa.spec.ts` :: PWS-FREE-COPY, `transaction-tax.model.spec.ts` :: PWS-DICTIONARY-AUDIT. Registered webhook spec :: PWS-FREE-WORDS tests 3 usable free reads, in-flight reservation, failed/unusable result, fourth-file refusal and editable old draft. Same-round `staff-receipt-from-phone` and `evidence-and-settings.journey.spec.ts:37` pins, source F and P variants. WEB-REVIEW/WEB-TAX-CAPTURE, API-LINE, web/API typecheck | A1/A2/A4/A5/A10/A12. Preserve current quota reason, amounts and draft ownership |
| P5.1–P5.2 / P5.B6 and current P0 | Existing free-expense-line.logic.ts refusal C74, line-draft-update-card.logic.ts englishDiffLabel and Gateway own-payment formatter C75, shared mangmee-persona.ts instruction C72, existing line-ai-scope-policy.logic.ts unsoldModuleReplyText no-offer refusal C76. C49/C50 stay in their actual paid branch | Registered webhook spec :: PWS-LINE-SOURCE-AUDIT/PWS-FREE-WORDS adds no-model F denial, paid signed action, already-accepted replay suppression and company-navigation preservation. Existing Gateway `mangmee-persona.spec.ts` :: PWS-PLAIN-PERSONA, `response-composer.agent.spec.ts` :: PWS-PLAIN-SPOKEN-LABELS, existing line-ai-scope-policy.logic.spec.ts :: PWS-PLAIN-UNSOLD-REFUSAL. API-LINE, GATEWAY, API/web typecheck | A1/A2/A10/A12. Regex, OCR transcription, stored keys and opaque action commands retain their existing meaning |
| P3.5-N / current P0, beside existing notice proof | External billing/plan-term/deal-ending writers from spec §17.2 are retained text. B18 **answered 2026-11-04**: keep daily recipients until owner step 10 / `docs/specs/proactive-expense-summary-spec.md` R10 retires the producer; B23 **answered 2026-11-04**: keep the deal-ending notice to OWNER under the explicit concerned-person-rule exception. The welcome's creation fence is proven in P6.3 | Existing registered `src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.spec.ts` :: PWS-NOTICE-SCOPE, and registered webhook spec for the received fixed wording. No tests added to unregistered new free/notification spec paths | A1/A8/A12. No wording-scope audience change; B18 retires in step 10/R10 and B23 remains OWNER by owner exception |

### Round 6 — public help and new-shop entry, about five related views

Views are public homepage/help, public wiki/common-question answers, the new-shop LINE welcome, advisor questions and advisor results. C70/C71 are the changes. The current welcome/advisor words are retained proof cases. R1/R2/R8/R10/R11/R13 apply to F/P and to a prospective buyer.

| Step / dependency | Exact files/functions | First tests and same-round journey pins | Verification / acceptance |
|---|---|---|---|
| P6.1 / P0 and P1/P2 vocabulary | `apps/web/src/features/public-home/home-wiki.ts` LLMS_FULL C70, free/paid signup description and plain VAT paragraph, complete text in spec §16.2 | Existing `apps/web/src/features/public-home/home-help-v6.spec.ts` :: PWS-WIKI-FREE-PAID. Update `e2e/journeys/public-home.journey.spec.ts:4`, `:8`, `:36` with the current public source and public text routes. Retain the existing homepage heading assertion, which matches PublicHome.tsx:51, and add the new wiki/free-path cases | Public-home focused web spec, web typecheck and public-home journey. A1/A2/A11/A12 |
| P6.2 / P6.1 and Q2/P5.3 approval | Reviewed `apps/web/src/features/public-home/home-help-v6.json` title/answer fields C71, active help revision/parity metadata through existing approved-product-help/product-help-draft-card ownership | Existing `home-help-v6.spec.ts:18` :: PWS-PUBLIC-HELP-WORDS, `approved-knowledge.spec.ts:71` :: PWS-HELP. Update exact public FAQ/title expectations in the same public-home journey. Retain O report cards and all formal downloads | WEB-GUIDE/GATEWAY-HELP plus public-home focused check. A2/A11/A12. Publication waits for the reviewed revision |
| P6.3 / P0, P6.1 wording parity | Existing `apps/api/src/modules/external-signup/application/line-signup-notify.service.ts` welcomeMessage and newShopReadyMessage, `apps/api/src/common/security/line-package-advisor.page.ts` current HTML/script. Retain the current fixed text with its real allowance/catalog cases | New tests only in registered `src/modules/external-signup/application/line-signup-notify.service.spec.ts` :: PWS-WELCOME-SOURCE and registered `src/modules/auth/line-liff-signup.spec.ts` :: PWS-ADVISOR-WORDS. Its current :13 import runs the existing advisor checks. Same-round public-home journey adds the public advisor entry and result/failure/back-to-receipt checks | Exact API commands below, API typecheck, browser 390/1280/1556. A1/A8/A10/A11. No typed model questions or invented VAT result |
| P6.4 / P5.3/P5.4, P6.1–P6.3 | Review final help source/title/body hashes together and run current W00 update/frozen check. W00 still hashes exactly the three web files recorded in spec §6 | Existing guide/helper quote pins, public snapshot sourcePackHash, active help approval and W00 frozen bytes. Update affected pins in the same round | Existing W00 maintenance command then frozen check. A11/A13 |
| P6.5 / all earlier focused proof, Q2 for approved-help publication | F receipt→source draft edit→history→quota/refusal→upgrade, then P review/confirm→payment→concerned notice→accountant download. Also replay a delivered confirmation and select another company during delivery | Extend existing `staff-receipt-from-phone.journey.spec.ts:20`, `paid-expense-reopened.journey.spec.ts:56`, `withholding-forms.journey.spec.ts:70`, `public-home.journey.spec.ts:4`. UI selectors follow the new words, exported tax/accounting assertions retain their exact terms | Focused specs/typechecks and affected journeys at 390/1280/about1556. A1–A13. Record actual states/browser evidence and remaining owner approval |

The original round 4 withholding work remains P-only, with F financial denial in the shared proof. B7's existing guide-scoping design also verifies F is denied by its earlier route guard and preserves a retained-history reader with an actual report read grant. B21/B22/B23/B28 are documented scope or recipient exceptions. This plan adds no wording work inside unsold ledger/report modules.

Current literal API package registration counts, rechecked on develop e7c422802, are webhook spec 2, erp-tax-tools.use-case.spec.ts 3, expense-document.use-case.spec.ts 1, line-liff-signup.spec.ts 1, line-signup-notify.service.spec.ts 1 and plan-term-sweep.use-case.spec.ts 1. The new free-expense-line.logic.spec.ts, free-expense-quota.pg.spec.ts, free-expense-attachment.spec.ts, free-expense-access.spec.ts, billing-notifications-recipient.spec.ts and line-delivery-plan.logic.spec.ts each return 0 for their literal path. They receive no new tests in this plan. No package.json change is planned.

```sh
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/auth/line-liff-signup.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/external-signup/application/line-signup-notify.service.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.spec.ts
bash scripts/local-proof/tsc.sh api
bash scripts/local-proof/tsc.sh web
```

Focused web and Gateway test commands use the existing command forms in §4 with the exact existing files named above. The document-only lane ran source/path/quote/id/table and registration checks. A read-only Node helper probe failed with ERR_MODULE_NOT_FOUND for tsx in this uninstalled checkout, so it supplies no runtime evidence. Implementation specs, typechecks, browser and journey commands remain unexecuted here. Prisma validate/generate and migrations are unnecessary for these text-only proposals.

Current deliverable totals are 13 requirements, 76 C changes and the preserved 97 D closures. All five controller audit limits are closed in spec §15–§18. Q1 is answered 2026-11-04: add the one-line paid-voucher explanation. Q2 is answered 2026-11-04: the controller presents real rendered LINE/public help cards, including C71, for owner approval before release; retain the reviewed source/hash gate.

B27 retires the dormant dictionary edits for I0674/I0698 after the current exact-key caller audit. Keep both ids in the documentation. The shared active payee hint remains with its real consumer. This is part of P0/P1.1 source validation and adds no implementation step.

Final source/id/excerpt/path/table and whitespace document checks passed on 2026-11-04. Every original id remains, the current C count is 76, and all 97 D aliases retain a closed current disposition. The API test additions use the registered paths and counts above. The current concise history baseline includes 884ba5307 as well as the original 1fbba874e feature commit.

## 8. Q5 follow-up questions (owner approved 2026-11-04) — after step 9 Phase A, before its real-model run

| Step / depends | Change | Tests | Checks |
|---|---|---|---|
| P7.1 | API: persist the delivered help/knowledge card ids and versions in the existing turn record and `loadConversationContext` (no reply text); gateway: accept them as DATA and always include them in `approvedKnowledgeCandidates` for the next turn (`approved-knowledge.ts`, `intent-router.agent.ts`) | `process-line-webhook.use-case.spec.ts` PWS-FOLLOW-STORE (ids only, window expiry, a different company or user never sees them); `approved-knowledge.spec.ts` PWS-FOLLOW-OFFER (included, not auto-selected, Q4 eligibility rechecked) | API/GATEWAY specs; W00 regenerate |
| P7.2 / P7.1 | Gateway: a vague follow-up (Q5 ②) after a card re-explains the same card in simpler words from its text only, using the LOW/MEDIUM rule; HIGH is shown again; "ยกตัวอย่าง" is built from the card facts or the steps | `semantic-turn-v2` spec PWS-FOLLOW-SIMPLER (numbers ⊆ allowedNumericFacts, title header, HIGH verbatim, no new action) | GATEWAY specs |
| P7.3 / P7.1 | Due-date follow-ups and ภ.ง.ด.3: `erp-advisor-document-tools.use-case.ts` accepts `formType: 'PND3' \| 'PND53'` with the same `pnd53PaperDueDay` rule and guards; the help path keeps the Q4 delivery rule | `erp-tax-tools.use-case.spec.ts` PWS-PND3-DUE, PWS-DUE-FOLLOW (next/previous/named month); the webhook help-route spec | API specs |
| P7.4 / P7.1–P7.3 + step 9 Phase A | About 30 question→follow-up conversations added to the step 9 M3 corpus; measured in the one real-model run | Corpus + scorer cases | Real-model run inside the 2,000 THB cap |

**Status 2026-11-05:**
- **P7.1** (card ids and versions in the turn record) and **P7.2** are in a lane on branch `codex/p7-followups-20261105`, not landed.
- **P7.2 card rule, controller decision:**
  - Runtime product-help cards are all `risk: 'R1'` and carry no `allowedNumericFacts`, so every card is treated as low risk and there is no HIGH branch.
  - The allowed numbers and dates are those in the card's own title, summary and body. A reply with any other number falls back to the card's summary as written.
  - "ยกตัวอย่าง" uses the card's steps when its text has no number.
- **P7.4** is measured in the run after Phase B lands, not in the M4 baseline. The baseline records the "before" for the same 30 Q5 conversations.

