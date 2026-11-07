# Agent Memory: accountant exports (backlog 25 + 13)

Status: DRAFT — RC-F2 co-voucher intersect redesigned 2026-10-26; controller checked the design against code 2026-11-04 (accepted; implementation pending); Re-anchored to develop e7c422802 on 2026-11-04; owner answers recorded 2026-11-04
Owner: Expenses documents lane (controller review)
Related: `docs/specs/accountant-export-cleanup-spec.md`, `docs/plans/accountant-export-cleanup-plan.md`, `docs/specs/accounting-software-export-spec.md`, `docs/plans/accounting-software-export-plan.md`, `docs/guidelines/thai-ux-standard.md`, `docs/plans/sold-ux-owner-decisions-2026-10-13-plan.md`
Baseline: develop `e7c4228026eec3c696fa76986420d2c97cb26676`, re-read 2026-11-04 in this worktree; supersedes citation baseline `0f938a361` (2026-10-26).

Scope:
- Documents only: the five files in this brief. No implementation, package.json change, migration, commit, push, network or deployment.
- Free source drafts are inside the ceiling; no export entitlement, typed questions or financial actions are added. Both specs now require free denial on web/API/LINE.
- Cleanup: sold expense workbook/ZIP + sold withholding-office workbook; keep existing expense-capture/handoff fixes in their separate steps. E5 income–expense ledger and new posting/JV workbook features are removed.
- Software export: starter expense data → office file and later proven FlowAccount preset, using existing permissions. No internal ledger, VAT workspace/ภ.พ.30, procurement, CRM, bank reconciliation, inventory, sales documents, reports or shop LINE OA work.
- Requirement inventory: cleanup R1–R22 (22); software R1–R17 (17). Each spec ends with one Traceability table including path coverage (free/paid), source document, evidence/short quote, plan step, test file/name and acceptance.

Decisions:
1. **RC-F2 / first commit**: `bundleContents` must intersect the complete merged `extraIds` with a present selection before pagination/500-ID loads; filing-query-only filtering was insufficient. Keep every existing scope/filter check and full voucher lines/all-source artifact guards. Current-code hotfix is cleanup step **0.1**, an independent commit in the later implementation round, before S and workbook redesign.
2. Phase 1.2 adds optional WHT filter semantics: `[]` returns no rows, omitted filter/IDs keeps today's projection. Update adapter and `ExpenseSourcePort`; sync still calls two arguments. Phase 1.4 adds the **new** two WHT reads in `createIndex`, both restricted to IDs of `page.rows` actually loaded. Do not union raw candidates after the scoped loader.
3. `[]`: workbook no data, bundle 0 parts, download part 1 → 404, unchanged. Explicit workbook pages do not expand. ZIP reads the whole selection; bundle HTTP DTO does not accept page fields.
4. Keep full V(A,B) lines. Select A → omit V PDF/slip/supporting files, not an A-labelled full A+B PDF. Omitted selection permits V only when every source is loaded and authorized.
5. CSV/indexRows/manifest keep their schema/serializer and values for identical eligible rows/artifacts. R8 removes leaked B and combined V(A,B) artifacts, so A also loses V in voucher_numbers/bundle_file_names (expense-evidence.use-case.ts:234-237, :404); these intentional changes override blanket “same bytes” language. Workbook/ZIP use new file names; CSV keeps `legacyFileName`. Goldens pin time/URL when needed.
6. Every sold tier uses starter (`packages/contracts/src/menu-entitlements.ts:432-450`, `:496-501`); 1,999 adds only WHT features. No new key, no environment feature switch. All sold workbooks omit posting status/error/JV, even with old values in data. Legacy CSV retains its old columns.
7. **Cuts checked:** E5 step 3.1, its contracts/API/UI/tests and positive ledger acceptance removed; B14/B24 remain out-of-scope bug records. Posting columns, new posting label/error maps, ledger entitlement query and conditional ledger tests removed. No surviving step depends on them. Currency helper remains because E1–E3 and E6 use it. Main sheet = 25 fixed columns + ZIP file column + shop branch when needed (no other structural posting columns).
8. Software mapping is a separate per-shop mapping, not a write to `ExpenseCategory.ledgerAccountCode`. Existing expense VAT/WHT snapshots remain valid input, without enabling/using an unsold workspace. No change to `posting-engine` is planned.
9. Earlier WHT design protections retained: payment-level bases/tax; current document VAT gate AND line restriction; frozen FILED line coverage before date filtering; keyless/aggregate-key coverage; no duplicate filed rows across explicit pages.
10. Screens/LINE/help use plain Thai; exact accounting names stay in exported/official documents. UI purchase_journal label = `ไฟล์แยกตามหมวด`, mapping fields = `รหัสหมวดในไฟล์`/`ชื่อหมวดในไฟล์`; file headings stay exact. Refusals have an action on the same screen. New notifications are not introduced; failed/unusable AI must not charge the customer.
11. Corrected PG test plan: `prisma-expense.repository.tax-snapshot.spec.ts:21-36` is a mock. Use the existing registered real harness in `prisma-expense.repository.payment.spec.ts:415-443` for mapping unique/cascade/tenant assertions; require its existing local PG gate and zero skipped checks.
12. FlowAccount Phase 0 template access and trial-company import are authorized (Q2 answered 2026-11-04); the proof still must pass before owner step 8 starts. Prior external research is dated 2026-10-23/24 and was not re-opened in this no-network round. No live-company import or new vendor compatibility claim.

## 2026-11-04 re-anchor / ceil7 round 2

- Preserve the controller’s accepted RC-F2 design and first independent commit. `expense-evidence.use-case.ts`, `expense-document.use-case.ts` and the tax subtree have no tree diff against `0f938a361`; current selection remains at `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:359-375`, all-source guards at `:404`/`:421`. This round does not implement or reopen that decision.
- Re-anchored existing citation locations, including repository, schema, contracts, extraction/upload, controller, webhook and web line shifts. `expense-export.logic.ts` line numbers did not move: its import and date condition changed. Repository diff is 99 additions/5 deletions (net 94), including a date predicate change, not only shifted lines.
- **Already fixed — retain, do not implement again:** `8c112ea70` changed `documentDate` at `apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts:148` and document-month filtering at `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:561-567`/`:4853`. An unusual printed March date stays March even when uploaded in October; `unverified` uses intake month and an unknown date. Existing `expense-export.logic.spec.ts:119-137` and `prisma-expense.repository.payment.spec.ts:711-716` cover the distinction. Cleanup R10/AC-23 and software R6/AC-20 preserve it in future builders; CSV compatibility now means the e7c422802 baseline. Do not relax software CONFIRMED-only eligibility or change payment/WHT dates.
- **B26 adapted, still open:** `049aa51de` added free eligibility/creator/draft checks at `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts:95-114`, but the initial load remains unscoped at `:96`. Cleanup S retains the source-only writer, quota callback and free restrictions while adding scope before storage/AI/queue on both paths. `receipt-ocr-apply.service.ts:1098-1103` checks the free source actor later; that does not substitute for the pre-read boundary.
- **B23 adapted, still open:** `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:11136-11140` + `:11212` still promises reading after queue failure; free PDF uses the same path at `:9931-9939`. Cleanup 3.5 must preserve free admission/ownership, source identity and failed-result refund; intentional `read: 'none'` at `:11243-11244` is not a queue failure. No duplicate draft, paid/free read charge, or confirmation card from result-delivery retry.
- **Free enforcement exists:** `apps/api/src/modules/system-partner-management/application/free-expense-access.ts:58-83`, `apps/api/src/modules/auth/presentation/auth.guard.ts:295-326`, `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:130`, `apps/web/src/features/expenses/expenses.model.ts:1631-1632`, and `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6933-6941`. Free is the historical/lifecycle predicate, not every expired trial or every shop with no current paid account. D04 remains model-free; usable persisted results alone consume the existing three-read allowance (`free-expense-quota.ts:24-28`, `:44-57`).
- **G13 / software S-G4 — new in-scope gap:** direct accountant use-case calls only check permission/scope before row loading (`expense-evidence.use-case.ts:317-324`), without current commercial-state verification. This is not an observed HTTP bypass. Cleanup **0.2** reuses `assertExpenseFinancialAccess` (`expense-commercial-access.ts:22-24`) for customer calls, preserving existing SYSTEM_ADMIN exemption (`auth.guard.ts:325`); software Phase 1.4 shares the guarded loader. No new permission, policy resolver or switch.
- **G14 / software S-G5 — new in-scope wording gap:** free typed export request gets the generic D04 refusal (`free-expense-line.logic.ts:1`, `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6938-6939`) without an action (`:543-549`). Cleanup 0.2 adds `เมนูหลัก` through existing `lineChoiceQuickReply`/`deliverReply` (`:2659-2669`), keeping the sentence and no-model early return. Same actor/company only; no welcome replay or owner notification.
- **G15 / software S-G6 — new runner gap, out of code scope:** `free-expense-access.spec.ts:107-115` is unregistered (`grep -c` = 0). Planned regressions instead go into registered auth, expense-document and LINE webhook specs; no package.json edit.
- **Existing integration to preserve:** welcome/advisor `9036b8552` rechecks marker/recipient/free allowance (`line-signup-notify.service.ts:402-428`) and is read-only (`auth.controller.ts:529-546`); history `1fbba874e`/`884ba5307` keeps actor/action/time and durable audit (`prisma-expense.repository.ts:2078-2135`, `ExpenseHistoryModal.tsx:85-93`); confirmation suppression `3f6db1729` requires an accepted exact result (`process-line-webhook.use-case.ts:3717-3731`). No implementation of these features is repeated.
- **Brief nuance:** company-command ordering exists at `line-message-buffer.service.ts:506-516`, but that file has no diff from the old anchor. Treat it as an existing regression boundary, not newly merged behavior or a missing fix. The three named unchanged areas and the export date-condition change otherwise agree with the brief.
- W00 integration adapts to new step 0.2 as well as 3.5: both change the hashed webhook (`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts:232`), so future implementation updates the artifact and runs the existing manual check/whole-chain. No new tests in the unregistered manifest spec.
- No new owner question. The four choices below are answered 2026-11-04; free export denial and three-read/D04 rules are already decided.

## 2026-10-26 RC-F2 brief and current-code recheck

Historical round-one evidence, line numbers re-anchored and rechecked on 2026-11-04:

| Evidence opened | Result / scope |
|---|---|
| `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:359` “lines: { some:” | Paid V selected if any line is A. |
| same file `:370` “paidVouchers.flatMap” and `:375` “expenseIds: extraIds.slice” | All V lines enter the candidate union and replace the original selection during extra load. **B29 current bug, in scope.** |
| same file `:288-310` “paymentEvidenceRows” | B lands in payment-evidence workbook rows, manifest and ZIP; B does not enter the original main-sheet indexRows/count. This distinction does not remove the leak. |
| same file `:404` “ids.some” and `:421` “ids.every” | Keep both guards and complete voucher lines to exclude full V when B is not loaded. |
| same file `:445` “parts.push([])” and `:462` “throw new NotFoundException()” | Empty selection produces no parts and a 404 on download; preserved. |
| same file `:137-310` (`createIndex`) | No live WHT projection or FILED-line read yet; both are new Phase 1.4 work. **G10 design/code distinction.** |
| `apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts:70` and `apps/api/src/modules/tax/domain/ports/source-reader.port.ts:127` | Both current signatures take two arguments; optional selection is a planned extension. |
| `apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts:277` “findConfirmedWithWhtByCompany(companyId, since)” | Sync omits selection and must remain unchanged. |
| `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts:1295-1296` | Current voucher fixture has one expense per voucher. **G9 coverage gap; add A+B fixture first.** |

Required test names (first):
- `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts`: **selection excludes an unselected co-voucher expense from workbook, WHT and ZIP**. First commit covers today's workbook/certificate/ZIP path; 1.4 extends the same regression to new WHT rows and both read arguments. Cover A-only, empty, omitted, explicit pages/empty page and scoped exclusions.
- `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts`: **WHT selection distinguishes empty from omitted IDs**. Guard test precedes adapter/port change in 1.2, includes unchanged no-selection sync.

## Additional findings and limits

- **G11 (in scope):** old spec called the list's empty sentence the evidence page's existing text. Actual evidence page says “ไม่มีรายการตามตัวกรองในช่วงนี้ จึงยังส่งออกไม่ได้” at `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:773`; proposed shared message now says only “ไม่มีรายการตามที่เลือก” with a change-dates action. Success text must also work for a FILED-only workbook.
- **S-G1 (in scope):** mock-versus-PG gap described in Decision 11; no current application bug alleged.
- **S-G2 (in scope capability gap):** `prisma-expense.repository.ts:4066` category response has no per-office mapping; the internal ledger binding is not that mapping (`schema.prisma:2588`).
- **G12 (runner gap, outside implementation scope):** `src/modules/line-ai/line-ai-capability-manifest.spec.ts` exists (`:71-78`, frozen-artifact check) but `grep -c` against `apps/api/package.json` is **0**. Existing manual W00 check may run separately; add no API tests to it and do not claim package test coverage. `thai-date.logic.spec.ts` has direct count 0, but registered `apps/api/src/modules/expenses/domain/logic/expense-export.logic.spec.ts:3` imports and executes it (`31ad07964`); the earlier compile-only claim was wrong. Update existing callers only; add new assertions in registered specs.
- Historical current-code B1–B28 remain in cleanup spec, with B14/B24 explicitly out of scope. B26 extraction still uses unscoped `findById` (`expense-extraction.use-case.ts:96`); prior “closed” was design review, not shipped remediation.
- **Prior-document correction:** B2 was too broad: `derivePostingStatus` returns `not_required` for `CONFIRMED_DUPLICATE`, not `pending` (`apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts:340`). The sold-export removal is unchanged.
- **Brief contradictions:** none in its RC-F2 mechanics, empty-bundle behavior, two requested test registrations or sold preset ceiling. Nuances: B is in the payment-evidence worksheet, not main indexRows; createIndex's two WHT reads are future work. Both are recorded, not treated as implemented facts.

Owner answers (recorded 2026-11-04):
- Cleanup Q1 — **answered 2026-11-04**: remove the brief/full selector; one accountant file; cleanup Phase 2.1–2.2 no longer waits on an owner answer, and backend compatibility remains.
- Software Q1: no longer open; owner ceiling means existing starter expense.export, no new entitlement.
- Software Q2 — **answered 2026-11-04**: team may view/download the owner-company FlowAccount “นำเข้าบิลและใบเสร็จ” template and try imports in a trial company; Phase 0 remains the first proof gate before owner step 8 starts.
- Software Q3 — **answered 2026-11-04**: wait for PEAK/Express templates from customers or accounting offices.
- Software Q4 — **answered 2026-11-04**: no “exported” marker or stored export state.

Artifacts (only files changed this round):
- `docs/specs/accountant-export-cleanup-spec.md`
- `docs/plans/accountant-export-cleanup-plan.md`
- `docs/specs/accounting-software-export-spec.md`
- `docs/plans/accounting-software-export-plan.md`
- `docs/agent-memory/accountant-exports.md`

Verification:
- Read AGENTS.md, local ponytail full skill, Thai UX standard and owner decisions before editing; source trace is local only. No agents delegated.
- Read-only `git rev-parse HEAD` recorded baseline; no writing git command.
- `grep -c "<path>" apps/api/package.json` results below; positive counts mean registered occurrences, not passing tests. No package.json change.

| API spec path | Count |
|---|---|
| `src/modules/auth/auth.guard.spec.ts` | 1 |
| `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` | 1 |
| `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` | 1 |
| `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` | 1 |
| `src/modules/expenses/domain/logic/expense-document.logic.spec.ts` | 1 |
| `src/modules/expenses/presentation/http/expense.dtos.spec.ts` | 1 |
| `src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts` | 1 |
| `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` | 1 |
| `src/modules/expenses/infrastructure/prisma-expense.repository.tax-snapshot.spec.ts` (existing mock evidence only) | 2 |
| `src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.spec.ts` | 2 |
| `src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.spec.ts` | 1 |
| `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` | 2 |
| `src/modules/line-ai/application/line-message-buffer.service.spec.ts` | 1 |
| `src/modules/system-partner-management/application/free-expense-access.spec.ts` (read-only finding; no planned additions) | 0 |
| `src/modules/line-ai/line-ai-capability-manifest.spec.ts` (existing manual check only) | 0 |
| `src/common/export/thai-date.logic.spec.ts` (existing callers; runs through registered import) | 0 |

- AI Gateway registration: `grep -c 'src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts' apps/ai-gateway/package.json` = 1.
- Runtime tests/build/Prisma/browser/vendor imports **not run**: documents-only brief; runtime checks are outside this documents-only round. Plans record exact future node --import tsx, local-proof tsc, additive Prisma and browser commands. Browser proof remains at 390, 1280 and approximately 1556 px.
- Re-anchor document integrity check (2026-11-04) PASS: all five Status lines retain the controller decision and contain the e7c422802 re-anchor; cleanup R1–R22 and software R1–R17 total **39 requirements**; final Traceability tables include free/paid path, plan/test/acceptance/source; **74 local evidence quotes match the cited lines exactly**, each at most 15 words; all referenced acceptance IDs exist. Local citation range check resolved 317 unique code ranges without an out-of-bounds line, followed by manual checks of changed flows and comma-separated caller lists.
- Registration rechecked 2026-11-04 with `grep -c` for every planned API spec, including new auth and message-buffer regression locations (1 each); required RC-F2 files remain 1 / 1. No new tests are planned in the three direct-count-zero files. `rg` found no import of the free-access or W00 spec; it did find the Thai-date import documented above.
- Re-anchor does not claim runtime test, browser or vendor-import results. Preserve the delivered welcome/advisor/history/confirmation features; current co-voucher leak, extraction boundary and failed-queue reply remain implementation risks.
- Round-one document integrity check (2026-10-26) PASS: all five headers; three exact RC-F2 status lines; 21 cleanup + 16 software requirements; complete plan/test/acceptance/source cells; 66 exact local traceability quotes, each at most 15 words; all nine API files used for new traceability tests registered. Required RC-F2 spec counts rechecked with `grep -c`: 1 / 1.
- Scoped `git diff --check -- docs/specs/accountant-export-cleanup-spec.md docs/plans/accountant-export-cleanup-plan.md docs/specs/accounting-software-export-spec.md docs/plans/accounting-software-export-plan.md docs/agent-memory/accountant-exports.md` PASS. Other lanes have concurrent changes; this lane wrote only the five authorized documents.

## Historical provenance (not current implementation status)

- 2026-10-23 backlog items 25/13 originated these two specs. Older external research and expense-receipt-upload Amendment remain separate sources; not edited this round.
- Review 2026-10-24 F1/F2: PND2 routing and WHT per payment; F3–F7/F10: currency, explicit base, VAT grouping/rounding, amount-only/legacy per-line WHT; F11: separate CSV projection; F12: DTO pagination; F14/F15/F16: payment-only month, actual payment dates and certificate history; F17/F19/F20/F21/F33: vendor payment rules, exclusions, historical category scope, status default and input validation.
- F31: blank means absent/inapplicable; missing required data remains explicit. Round 2 F2: preserve separate RENT/SERVICE WHT groups; F6: withholding requires a supported payment method; F15: distinguish actual payment exclusion reasons and do not warn unpaid no-WHT documents. Round 3 R3-F2: do not merge claimable and prohibited VAT. Focused recheck kept the **current document gate AND line restriction** design. These are requirement provenance, not claims that a new software-export endpoint exists.
- R3-F1 extraction access design, R3-F3 filed coverage-before-date and RC-F1 pagination designs passed earlier document review. Their code still needs implementation/proof.
- Old RC-F2 design restricted only filing candidates; superseded by the complete co-voucher intersect in this round. Old E5 and ledger-positive plans are superseded by the owner ceiling.

Next:
1. Done 2026-11-04: controller checked the RC-F2 redesign against `expense-evidence.use-case.ts:359/370/372/404/421/445/462`. Only the paid-voucher branch widens the selection, since payments and handoffs already filter by `request.expenseIds`, so the intersect closes it. A-only drops the whole V(A,B) artifact by design. Both test files are registered. The removed E5/posting dependencies are confirmed unused.
2. In the implementation round, write 0.1's regression then the independent hotfix commit, followed by free-boundary step 0.2; Phase S remains separately shippable. No implementation is performed here.
3. RC-F2 design is already accepted. Phase 1.2/1.4 still need WHT filter/loaded-source implementation proof; do not confuse design acceptance with a shipped fix.
4. Owner answers are recorded; software owner step 8 starts only after authorized Phase 0 proof, and software Phase 1 also depends on cleanup Phase 1.

## 2026-11-07 accountant export pack v2 — documents round

Status: DRAFT documents complete for controller review. Implementation, runtime/browser proof and performance measurement pending.
Owner: Expenses documents lane, owner thawatchai.
Scope: Only `docs/specs/accountant-export-pack-v2-spec.md`, `docs/plans/accountant-export-pack-v2-plan.md` and this short entry. Baseline `8de3f67e0cf832d06b637f064f0b843e88efad12`.
Decisions: 16 requirements cover the five owner additions, existing access/RC-F2, record PDFs, signed claim readers, first-sheet issues, currency reconciliation, document-month RD purchase listing, accountant access note and guide hash impact. Reuse existing pdf-lib/sharp/decimal.js and document gates. No migration is planned. Performance numbers in spec §3 are unmeasured budgets.
Current-code correction: Historical pending claims above are superseded for this baseline. RC-F2 intersect and commercial guard exist at `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:522-524` and `:85-93`. Software export exists at `apps/api/src/modules/expenses/presentation/http/expense.controller.ts:282-286`.
Findings: Spec §9 records G1–G16, with 11 in-scope gaps/defects and five out-of-scope findings. Current defects include silent generated-document omissions (`expense-evidence.use-case.ts:570-572`), live e-WHT treated as ordinary form WHT (`:459-472`) and multiple primary part buttons (`apps/web/src/features/expenses/EvidenceBundleDownload.tsx:27-29`). The broad guide repin script updates legacy source entries at `scripts/local-proof/repin.sh:20`, while the reviewed help pack uses its own hash map at `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts:131` and `:153`. P4 refreshes that map directly.
Brief nuances: Existing sheets are conditional (`expense-export.logic.ts:343-374`). Claim signatures can precede payment (`apps/api/src/modules/reimbursements/application/use-cases/reimbursement-claim-signature.use-case.ts:39-54`). E_WHT requires no 50 ทวิ (`packages/contracts/src/tax.ts:94`). Claim printing currently returns SVG pages (`reimbursement-claim-form.use-case.ts:55-62`).
Open questions: none. Q1 decided by the controller 2026-11-07 (full claim only when all its expenses are selected, as RC-F2). Owner 2026-11-07: keep every original file in the ZIP ("เก็บครบทุกไฟล์"), accepting more parts.
Artifacts: New spec has the requirement/evidence/step/test/acceptance/source table. New plan has five dependent steps, exact implementation files/functions and registered tests first. RD template and notices were read directly from rd.go.th, with primary links in spec §7.
Verification: Local read-only source trace and registration checks completed. The six planned API specs have grep counts 1/1/1/1/2/1, listed in plan. Static document checks passed for headers, 16 requirement/acceptance mappings, five dependent steps, 32 exact short evidence quotes, local citation ranges and whitespace. Scoped `git diff --check` passed. Existing help and manifest checks are separately invoked, with no new assertions in their unregistered files. Runtime, Prisma and browser checks were not run in this documents-only round.
Next: Controller reviews scope, protected-PDF classification, signed-claim selection and tax subset reconciliation. Use P1–P5 for the later implementation round and record actual verification and the 300-expense benchmark.

## Pack v2 round 1 landed, 2026-11-07
- **Plan P1 + P3:**
  - the `ต้องตามเอกสาร`, `สรุปรายเดือน` and `รายงานภาษีซื้อ` sheets;
  - live e-WHT payments moved out of the shop-filed WHT sheet into a separate summary block (G7);
  - currency identity kept by code (G8);
  - 17 new `pack v2` tests.
- **Limitation:** retained claim files carry no receipt role, so "receipt missing" is not inferred for them. The sheet discloses this.
- **Verification (batch31):**
  - API 13,164 pass, 0 fail;
  - web 5,256 pass;
  - contracts 509 pass;
  - tsc api/web 0.
  - Pre-existing reds, not this change: maintenance pins, the workers demo spec typecheck, billing recipient mail R-A7.
- **Pins repaired:** four LINE help label pins in `line-help-cards-review-2026-10-20.md` were stale after web commit `4b0030885`, and now point at the current lines.
- **Next:** P2 (record PDFs and signed claims), then P4 and P5 (screen note, guide, browser and 300-expense proof).
