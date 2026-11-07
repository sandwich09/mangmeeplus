# Accountant export pack v2 implementation plan

Status: DRAFT — documents only, 2026-11-07. Five implementation steps proposed. Controller review done 2026-11-07; spec Q1 decided; owner kept every original file. No implementation, test run, migration or browser proof performed.
Owner: Expenses documents lane, owner thawatchai, controller review
Related: `docs/specs/accountant-export-pack-v2-spec.md`, `docs/agent-memory/accountant-exports.md`, `docs/specs/accountant-export-cleanup-spec.md`, `docs/specs/accounting-software-export-spec.md`, `docs/guidelines/thai-ux-standard.md`, `docs/plans/sold-ux-owner-decisions-2026-10-13-plan.md`
Baseline: Local HEAD `8de3f67e0cf832d06b637f064f0b843e88efad12`, opened 2026-11-07. The companion spec §1 records implemented RC-F2, commercial guard and software-export route that older documents still describe as pending.

## Scope and dependency order

Implement the companion spec's R1–R16 through the existing accountant-package endpoints. Reuse `CreateAccountantPackageUseCase`, the current scoped row loader, existing document readers, pdf-lib, sharp, decimal.js and the Thai PDF/XLSX renderers. Each requirement's evidence, test name, acceptance row and first source is mapped once in spec §11.

P1 precedes financial, tax and permission implementation. P2 and P3 consume its failing regressions. P4 follows the final output contract. P5 proves the assembled result through actual endpoints and browser downloads. Owner Q1 must be answered before accepting multi-line claim inclusion. Its conservative exclusion can be implemented and tested while that answer is pending, but acceptance A8 remains open.

| Step | Depends on | Requirements | Acceptance |
|---|---|---|---|
| P1 — fixtures and failing regressions | Controller accepts source trace and test locations | R1–R13, R16 | Establish failing cases for A1–A13/A16 |
| P2 — packet and signed-claim readers | P1 (Q1 decided: full claim only when all its expenses are selected) | R2–R8 | A2–A8 |
| P3 — workbook issues, summary and purchase listing | P1, P2's file/claim status shape | R4, R9–R13, R16 | A4, A9–A13, A16 |
| P4 — access note, guide and hash maintenance | P2/P3 contracts stable | R14, R15 | A14, A15 |
| P5 — integration, printed files and 300-expense proof | P1–P4 | R1–R16 | A1–A16 |

## Registered test files

Counts below were obtained in this worktree on 2026-11-07 with `grep -c "<file>" apps/api/package.json`. They establish registration, not passing tests. New API tests are limited to these existing files. Proposed PDF helper tests are placed in the registered expense-export spec, importing the new helper. No new spec file or package.json edit is needed.

| Abbreviation | API path, relative to apps/api | grep count |
|---|---|---|
| E | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` | 1 |
| D | `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` | 1 |
| C | `src/modules/reimbursements/application/use-cases/reimbursement-claim-form.use-case.spec.ts` | 1 |
| A | `src/modules/auth/auth.guard.spec.ts` | 1 |
| L | `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` | 2 |
| P | `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` | 1 |

Existing checks for the help pack and capability manifest are separately invoked below. The approved-knowledge spec has count 0 in `apps/ai-gateway/package.json`, and the capability-manifest spec has count 0 in `apps/api/package.json`. Add no new assertions to either. Their existing checks remain necessary because guide edits change the hashes they verify. Gateway and API registration are separate facts.

## P1 — tests before money, tax and permission changes

### Files and concrete cases

Extend the existing fixtures in E/D/C/A/L/P. Reuse D's co-voucher and direct-use-case commercial cases at `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts:1298-1339`, its legacy path check at `:1639-1648`, and its 60-file/60-MB boundary cases at `:1650-1659`. Preserve existing assertions while extending expected output for the new counted file kinds.

E's workbook reader defaults to sheet1.xml (`apps/api/src/modules/expenses/domain/logic/expense-export.logic.spec.ts:385`). Resolve a sheet by its workbook name before reading financial cells, since sheet1 becomes `ต้องตามเอกสาร`. Keep its generic one-sheet XLSX test at `:356-368` unchanged. The journey's fixed sheet/header map at `e2e/journeys/evidence-and-settings.journey.spec.ts:38-60` will be updated in P5.

| File | Planned tests to add first and required distinguishing input |
|---|---|
| D | `pack v2 rejects stale free grants before row or file reads` — all three endpoints/direct methods, stale permissions, never-paid free shop, paid controls and current SYSTEM_ADMIN exception. |
| A | `pack v2 routes retain export permission and free denial` — existing endpoint decorators/allowlist, with no added permission or entitlement. |
| L | `free export requests retain model-free menu exit` — actor's denial/menu exit, no export file, AI model work, charge or owner delivery. Reuse existing free-routing test facilities. |
| D | `pack v2 never reads an unselected co-voucher source` — V(A,B), selected A, A+B, [], omitted IDs, explicit pages, branch-filtered B and unrelated tenant. Spy before byte reads, asserting absent B numbers and signatures as well as absent monetary rows. |
| D | `pack v2 assembles each paid voucher in original line order` — two voucher lines, shared proof/supporting file, different receipts and certificates. Include one expense in two paid vouchers and one additional direct payment. |
| E | `pack v2 cover and packet links preserve one expense money row` — header totals, two payment rows, partial/outstanding, unknown date, packet set and internal/relative links. |
| D | `pack v2 includes direct and cross-period payment proofs` — September expense selected by October upload date, September payment/certificate and October payment, without changing month-sheet populations. |
| E | `pack v2 preserves protected originals and reports rejected appendices` — ordinary PDF, real cryptographically signed PDF, signature field/ByteRange/permission signature, encrypted/malformed PDF, protected embedded payload, oversized/unknown structures and unchanged original SHA-256. |
| D | `pack v2 records generated document refusal safely` — measurement-time Forbidden/NotFound, original-byte failure, packet build failure, and denied aggregate name redaction. |
| E | `pack v2 bounds print images and dates every assembled page` — rotated JPEG, PNG transparency, long receipt, landscape PDF, small Thai text, decoder limit, footer date/timezone boundary and no original mutation. |
| D | `pack v2 sizes all file kinds sequentially at part boundaries` — original, claim and packet at 60/61 files, exact/excess 60 MB, oversized-alone and unavailable sequence positions. Instrument maximum concurrent document construction. |
| C | `signed export reuses claim completeness scope and account reveal rules` — complete digital, acknowledged paper, BOTH with incomplete digital signatures, unsigned, skipped approval, legacy four-block, superseded payout declaration, scope denial, signature checksum mismatch and audited account reveal. Test new export entry and existing preview together. |
| D | `pack v2 deduplicates current signed claim assets` — two selected expenses share C, C included once in `ใบเบิก/` and in both packets. Include partial claim selection according to Q1 and permission-denied claim access. |
| E | `pack v2 lists each follow-up problem with an internal link` — all eight requested classes, separate missing tax-ID/branch rows, first-sheet/no-problem ordering, earlier unconfirmed payment and actual skipped file. |
| D | `pack v2 distinguishes unsigned unavailable external and bank-remitted documents` — EXTERNAL_LINKED 50 ทวิ, known issued certificate outside the export payment month, actor without certificate visibility, signed claim whose bytes fail, and E_WHT without a 50 ทวิ. |
| E | `pack v2 summary separates currencies and effective VAT rights` — THB/USD, two unrecognized currency codes, stored VAT 21.01, V7+ND, later document-level refusal, PARTIAL without deductible amount, mixed categories/tax treatment, charge-category inheritance and four-decimal legacy values. |
| E | `pack v2 separates document WHT payment WHT and e-WHT` — installments, amount-only rate, PND2, PND3, PND53, unknown kind/rate, e-WHT and historical FILED snapshot. |
| D | `pack v2 XLSX summary reconciles expense WHT and purchase subsets` — deserialize actual workbook cells from the normal use case, including earlier-document-month WHT, keyless and aggregate FILED coverage and later payment-date changes. Assert all equations in spec §6. |
| E | `pack v2 purchase listing follows RD layout and fully claimable groups` — exact column/header layout, text tax IDs/branches, one row per source document, mixed eligible/prohibited VAT, unquantified PARTIAL, THB/foreign and Customs/PP36 receipts. |
| D | `pack v2 uses document month and dated registration facts` — September invoice uploaded and judged in November, current false boolean with historic REGISTERED, NOT_REGISTERED, uncovered UNKNOWN, unread date and several tax establishments. |
| P | `pack v2 extra readers preserve tenant branch and selected IDs`<br>`pack v2 reads historical registration and branch headers without writes` — real local PostgreSQL, scoped line/claim/registration reads and unchanged source records. Extend the existing real-PG harness at `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts:428-445`, requiring its PG gate and zero skipped cases. |
| D | `pack v2 keeps legacy payloads and software export isolated` — CSV/indexRows/manifest shapes and original filenames unchanged, and software purchase_journal unaffected. New file kinds occur only in XLSX/bundle projections. |

### Verification

Run each registered test file with the exact pattern below. In P1 record the new expected failures by name and existing regressions separately. Compile/import failures are fixed before treating a test as a useful failing assertion.

```bash
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/domain/logic/expense-export.logic.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/reimbursements/application/use-cases/reimbursement-claim-form.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/auth/auth.guard.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
EXPENSE_PAYMENT_REQUIRE_POSTGRES=true pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts
```

The PG command uses the existing test-only requirement flag from P at line 429 and an existing isolated local database. It adds no product feature switch. Follow local-proof database/lock procedures when running the future checks. This documents round does not start services or access a database.

## P2 — sequential record PDFs and signed claim assets

### Exact implementation locations

| File / function | Smallest planned change |
|---|---|
| `apps/api/src/modules/expenses/domain/logic/expense-record-pdf.logic.ts` — new `buildExpenseRecordPdf`, local `appendRecordFile` | One destination PDF per record, input loader callbacks supplied by the authorized use case, protected-original classification/reference, image resize/slicing, cover/appendix index and final date footer. Reuse pdf-lib/sharp and the existing Thai renderer. No new dependency, service interface or generic PDF framework. |
| `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts` — `bundleContents`, local `addDocument`, `planBundle`, `downloadBundle` | Keep E/L and all-source guards. Read complete voucher lines with `orderBy: { position: 'asc' }`, including their expense-payment IDs. Extend permitted history discovery for loaded records, add `recordPacks`/`claimForms` descriptors, safe measurement-failure metadata, exact generated-byte sizing and sequential loaders. Keep originals, naming, oversized-alone behavior and part/index output. Set `legacyFileName` only for the original collector's entries and filter the legacy filename projection by its presence. Standalone `execute` must avoid packet rendering. |
| `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-claim-form.use-case.ts` — `PreviewReimbursementClaimFormUseCase.executeSignedForExport` | New signed-export method reuses existing claim load, `assertCanReadRequest`, `documentSignedVia`, current acknowledged copies, snapshot builder, signature loader and audited `withAccountNumber`. Factor only the rendering shared with existing `execute`. Return status/asset facts sufficient for the bundle and follow-up sheet. |
| `apps/api/src/modules/expenses/expenses.module.ts` — provider list | Provide existing `PrismaReimbursementRepository` and claim print use case locally, using DataModelCore/Audit/config dependencies already available. Confirm normal DI boot. ReimbursementsModule imports ExpensesModule at `reimbursements.module.ts:59`, so adding a reverse module import would create a cycle. |
| `packages/contracts/src/expenses.ts` — `AccountantEvidenceBundlePlan`, workbook file kinds/packet column | Add optional count fields and packet reference representation. Legacy CSV/indexRows/manifest structures and request filters retain their meanings. |

Default signed-claim preference is the newest current acknowledged paper form, otherwise a complete digital form. A BOTH state with incomplete digital signatures uses paper. The original's integrity and every file read are rechecked for the actor. Multi-line claims follow the answered Q1 policy. Account numbers retain existing per-reader audited behavior, and raw signature assets never become standalone ZIP files.

### Impacts and risks

Web receives higher file/part counts using its existing plan contract. API adds bounded PDF work and claim reads. LINE/AI Gateway keep existing routing. Exports gain the two folders. Tax and claim mutations remain outside this step. Download audit stays on the existing API path. Risks are wrong aggregate membership, byte-sensitive original mutation, later evidence revision leakage, missing out-of-period proof, stale signatures, denied-name disclosure, DI cycles and rerender cost.

### Verification

Run E, D and C with the P1 commands, then `bash scripts/local-proof/tsc.sh api`. Inspect packet pages and original hashes from a small extracted ZIP before moving to P3. A passing mocked constructor does not satisfy the provider-wiring gate. P5 must call the existing HTTP entry points.

## P3 — first sheet, currency summary and purchase tax listing

### Exact implementation locations

| File / function | Smallest planned change |
|---|---|
| `packages/contracts/src/expenses.ts` — `ACCOUNTANT_WORKBOOK_SHEETS`, workbook columns/labels | Add `ต้องตามเอกสาร`, `สรุปรายเดือน`, `รายงานภาษีซื้อ` and the ZIP packet reference label. Existing columns stay in order and old file-kind labels remain available. |
| `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts` — `workbookProjection`, company read in `createIndex` | Reuse loaded expense/payment/certificate facts and P2 claim/failure results. Load selected line tax fields already read by `CreateAccountingSoftwareExportUseCase.execute` at `:680-685`, category names through `PrismaExpenseRepository.listCategoryNames` at `prisma-expense.repository.ts:4088-4092`, and existing company registration facts. Share the resulting projections within one workbook build. Preserve selected-expense vs loaded-payment populations. |
| Same file — live WHT loop in `workbookProjection` | Separate live E_WHT from shop-filed W rows, preserving immutable FILED rows and recording a current-remittance difference. Supply bank-remitted payment facts to the summary. `buildAccountantWorkbook` uses the truthful empty-WHT sentence in spec §6 for an e-WHT-only selection. No tax writer changes. |
| `apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts` — `buildAccountantWorkbook`, new `buildAccountantFollowUpRows`, `buildAccountantMonthSummary`, `buildAccountantPurchaseTaxRows` | Pure projections over supplied facts. Issue rows link internally, summary groups by currency code, and purchase blocks group by document month/tax establishment. Reuse existing labels, date formatting and safe relative paths. Quantize money consistently with displayed expense cells, preserving stored VAT/WHT amounts and legacy payloads. |
| `apps/api/src/modules/expenses/domain/logic/accounting-software-export.logic.ts` — existing exports `effectiveInputVatRight`, `groupExpenseLines`, `allocateToHeader` | Reuse these functions from the new projection with an empty office mapping. Preserve their callers and software-export output. Header-only legacy fallback is local to the new accountant projection. No change to the office mapping or posting helpers is required. |

Build each workbook from its already-collected facts. One record with five issues has five first-sheet rows and one expense money row. A missing permission produces an unchecked/unavailable issue, never an invented missing certificate. Standalone XLSX names byte checks still pending. Each ZIP first sheet contains actual failures in that part and identifies the remaining part checks.

The summary uses E for document totals and W for payment WHT. Its explicit bridge keeps prior-document-month rows, installment/out-of-period differences, unknown payment dates and e-WHT separate. Read the actual XLSX in D to prove the bridge. Include PND2 and unknown rates without grouping them under PND3.

The purchase listing uses document-date months, dated VAT registration, current document gate plus line restrictions, THB and verified header/seller identity. Missing use month, unknown registration, foreign currency, unresolved PARTIAL and receipt-order fallback are stated on the sheet and reconciled. The RD source and column mapping are in spec §7. Controller tax review verifies those exact fixtures, including Customs/PP36, before acceptance.

### Impacts, risks and verification

Main risks are 21.01 becoming 21.00, prohibited line VAT being promoted, cross-currency aggregation, an upload-month header being mislabeled as tax-use month, blank branch being treated as headquarters, and filed WHT being duplicated after a payment-date change. Existing journal metadata in the shared loader is incidental and its modules remain outside this edit.

Run E/D/P with the P1 commands, with PG required for P, then run the following checks.

```bash
bash scripts/local-proof/tsc.sh api
pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma
pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma
```

Existing schema fields suffice. No schema or migration change is planned. If implementation exposes a genuine missing stored fact, stop and revise this spec first. Any subsequently approved migration must be additive. Prisma commands are planned validation/client checks and do not create a migration.

## P4 — accountant self-download note and guide integrity

### Files and small edits

- `apps/web/src/features/expenses/ExpensesPages.tsx`, existing export dialog at `:3057-3064`, and `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx`, existing export card at `:973-977`. Add `ผู้ทำบัญชีที่เชิญเข้าร้านดาวน์โหลดเองได้ตามสิทธิ์ที่ได้รับ` adjacent to the current download actions. Its qualifier protects custom/branch-limited roles.
- `apps/web/src/features/expenses/EvidenceBundleDownload.tsx`, `EvidenceBundleActions`. Include optional new counts, keep the first part button primary and use existing secondary classes for other parts. No new progress state is needed. Keep the existing same-screen retry/return actions and selection-version guard at `:36-74`.
- `apps/web/src/features/user-guide/expenses-guide.content.ts`, existing export section at `:327-336`. Add the same access fact and concise steps for the first sheet and record folder. The accounting report names belong to downloaded files. Screens/help use plain Thai.
- `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts`, reviewed source hash map at `:129-136` and current card/pack version derivation at `:148-163`. Recalculate the edited guide's source hash, review cards sourced from it and record current review provenance. Bump the reviewed pack version and affected served card versions, then refresh hashes through their existing hash functions. Preserve historical approved-pack pins.
- `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`, the existing frozen artifact named at `apps/api/src/modules/line-ai/line-ai-capability-manifest.ts:38` and returned through `lineAiCapabilityManifestArtifactPath` at `:686-687`. Refresh only after the relevant help-source change is reviewed. The help source path is registered at `:173` and hashed at `:629-630`.

The existing `scripts/local-proof/repin.sh:9-26` also writes maintenance-release pins and its guide regex updates the legacy `sources` entries. That broad script is unsuitable for this scoped change. Use the reviewed guide-hash map and the existing manifest-specific update path directly, then inspect their exact diff. The manifest's existing update flag is a test/artifact tool, not a new product feature switch.

### Verification

Run the existing guide/help checks as-is and the web compiler check. These are existing separately invoked checks. Add no assertions in unregistered API specs.

```bash
pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/agents/approved-knowledge.spec.ts
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/user-guide/user-guide.content.spec.ts
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts
bash scripts/local-proof/tsc.sh web
```

If the manifest reports this reviewed source change, use its existing explicit artifact-update mode and rerun the check. Record the paths and results. Broad pin churn, changed old knowledge answers and reusing an old approval label for newly changed content fail the review. No new LINE reply, AI call, notification or customer charge belongs to this step.

## P5 — integrated browser, file and performance proof

Extend only the existing journey file `e2e/journeys/evidence-and-settings.journey.spec.ts` for new journeys. Update its workbook-name/header reader at `:38-60` to assert the new required sheets and existing conditional sheets by name. Keep its existing real free/paid denial journey at `:67-124`.

| Planned journey | Evidence |
|---|---|
| `@journey invited accountant downloads pack v2 within assigned scope` | Real invited ACCOUNTANT membership with a restricted branch, qualified access note, actual workbook/ZIP download, complete permitted packet, and exclusion of another branch/claim/voucher peer. |
| `@journey pack v2 export states and accountant hint at 390 1280 1556` | Loop over explicit viewport widths 390, 1280, 1556. Capture real browser screenshots and inspect normal, loading, empty, multi-part, denied and recoverable download failure states. Check one primary, equal grouped controls, no clipped Thai or horizontal scrolling, and the same-screen exits. |
| `@journey pack v2 workbook and extracted packet links reconcile` | Inspect standalone XLSX and extracted `สารบัญ.xlsx`, first-sheet links, packet references, sheet subtotals and original hashes. Exercise cross-part locations and a partial claim selection after Q1. Verify a real signed PDF stays separate. |

Run with the existing browser project. The project and test entry are defined in `playwright.config.ts:57-91`, and journey tests already set the three widths themselves at `evidence-and-settings.journey.spec.ts:67-69`.

```bash
pnpm exec playwright test e2e/journeys/evidence-and-settings.journey.spec.ts --project=chromium --grep 'pack v2|invited accountant|free shops'
```

Open the extracted workbook and relative links in an available desktop spreadsheet application. Record the exact application/version, missing application coverage and cross-part behavior. Visual-check portrait, landscape, long receipt, Thai small text, voucher signatures, digital/paper claim signatures and every-page export date. Byte/hash assertions alone do not prove legibility.

### 300-expense workload

Use D's planned `pack v2 300 expense envelope` for instrumented repeatable data and the same data through normal HTTP entry points. The ordinary fixture and budgets are in spec §3. Record rather than assume these numbers.

- 300 direct-paid expenses with 500 KB receipt, 250 KB payment proof and at most 750 KB packet. Expect 900 counted files, about 450 MB and 15 parts, subject to actual consecutive-file byte grouping.
- Add 30 shared readable claims averaging 250 KB. With packet sizes still within 750 KB, expect 930 counted files, about 457.5 MB and 16 parts. Prove once-per-claim standalone deduplication and repeated inclusion in each eligible packet.
- Measure cold/warm plan and all numbered downloads, peak RSS above warmed idle, maximum simultaneous packet builds, largest packet, actual file bytes and part count. Targets are plan at most 30 seconds, each ordinary part at most 30 seconds, total at most 8.5 minutes for 16 parts, and incremental RSS at most 256 MiB. These targets are unmeasured in this documents round.
- Also exercise a voucher with many lines, oversized original, many-page PDF, decoder-limit image and the existing oversized-alone rule. A pathological appendix is referenced/explained according to the spec's bounded behavior, with original preservation whenever permitted.
- Repeated sizing is an explicit risk because each download calls `bundleContents` again (`expense-evidence.use-case.ts:634-645`). Failed budgets stop acceptance and trigger a focused design revision. No speculative job/cache infrastructure is included in advance.

Run all P1 API commands again, both local-proof compiler checks, Prisma validate/generate and the browser command. Record test counts, including zero skips for the real-PG assertions. Recheck existing software-export/legacy payload cases. Use the exact รายจ่าย release-note sentence in spec §8 in the implementation handoff.

## Completion record and remaining decisions

Update `docs/agent-memory/accountant-exports.md` after each implementation step with files, actual verification commands/results, accepted design changes and the next state. Attach screenshot and benchmark evidence using the repository's existing local evidence convention during implementation. R1–R16 are complete only when their matching A rows pass.

No owner question remains. Spec Q1 is decided (full claim only when all its expenses are selected), and the owner kept every original file (2026-11-07).

This documents lane changed only the two new documents and a short entry in the named task memory. No implementation check was run because the authorized work in this round is specs and plans only.
