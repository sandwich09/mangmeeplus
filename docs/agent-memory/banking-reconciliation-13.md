# Agent Memory: Bank Accounts and Reconciliation (Item 13)

Status: PARTIAL - reviewed/fixed 2026-06-30; 2026-07-06 web import/matching slice + source candidate adapters DONE (live-verified); 2026-07-06 OCR/PDF statement intake (spec §20) DONE (live-verified). Remaining: evidence export artifacts, manual-line UI, AI/LINE summaries, real bank sample validation.
Owner: Sonnet 4.6 + Codex review; 2026-07-06 slice by Fable 5
Scope: Partial implementation - contracts, Prisma, API module, initial web UI, review fixes

## Decisions

- Full bank account number storage deferred (masked/last4 only) - no encryption primitive yet
- Statement import uses alias-based preset matching (not hardcoded column positions) for KASIKORNBANK_KBIZ and SCB_BUSINESS_ANYWHERE
- Matching tolerance is zero by default; override requires bank.match.override permission
- Reconciliation completion is ACCOUNTANT-owned by default
- Evidence export model/permission exist, but API endpoint and JSON/CSV/XLSX/PDF artifact generation are not implemented yet.
- Web routes at `/companies/[companyId]/banking` (not /finance/banking as spec draft suggested)
- Phase 8 (AI/LINE read-only tools) deferred - existing LINE AI module reads tool registry which needs separate integration work

## Review fixes 2026-06-30

- Replaced `parseFloat` reconciliation-session movement math with BigInt/cent domain helper.
- Replaced match allocation/status totals with BigInt/cent helpers to avoid decimal drift.
- Fixed source-direction validation so supplier/expense/reimbursement payments cannot match deposit lines.
- Changed reconciliation completion to build snapshot lines server-side from DB statement lines for the session account/period instead of trusting client `snapshotLines`.
- Completion now blocks real unmatched/suggested/partially matched statement lines, ignored lines without reason, missing ledger link, non-zero difference, and overlapping closed accounting periods.
- Completed reconciliation snapshots are refreshed when a reopened session is completed again.
- Unmatching and statement-import voiding now block lines locked by a completed reconciliation until the session is reopened.
- Bank account deactivation now blocks open reconciliation sessions and unreconciled statement lines.
- Web banking payloads now use backend enum/field names for bank account creation, reconciliation creation, cash position display, and bank adjustment approval ledger inputs.
- Added focused banking use-case tests and included them in the API test script.

## Web import/matching slice 2026-07-06

Owner directive: close item 13 web UI blockers first (import → preview → commit → matching), then OCR intake (spec §20), then back to 15A Phase 2.

Backend additions (smallest slice that makes the web workflow real):

- `GET bank-accounts/:id/statement-lines?status=` + `GET bank-accounts/:id/statement-imports` under existing `bank.statement.read` (already in permission registry + role grants; repo method `listStatementImports` added).
- Source candidate adapters (read-only discovery, Phase 4 read side): new `infrastructure/prisma-match-source.query.ts` (`PrismaMatchSourceQuery`, concrete class — module convention has no port interfaces). Queries non-voided payment facts cross-module: AccountingPayment (RECORDED+RECEIVED → CUSTOMER_PAYMENT), ExpenseRecord (paymentStatus PARTIALLY_PAID/PAID → EXPENSE_PAYMENT, uses paidAmount/paidAt/vendorNameSnapshot), SupplierPayment (RECORDED → netPaidAmount), ReimbursementPayment (RECORDED, joins request for requesterDisplayNameSnapshot), BankAdjustment (APPROVED/POSTED, direction from sign). Confirmed match allocations are summed per sourceType:sourceId and subtracted via new pure helper `applyConfirmedAllocations` in banking.logic.ts; fully-allocated candidates drop out. PAID-direction AccountingPayments deliberately excluded (overlap with supplier/expense sources would double-count). LEDGER_JOURNAL_LINE candidates deferred.
- `ListMatchCandidatesUseCase` response extended with `candidates: BankMatchCandidate[]` (contracts: new `BankMatchWorkspaceResult`). No pagination — module convention.

Web additions:

- `banking.logic.ts` (new): `parseDelimitedStatement` (CSV + TSV/Excel-paste, quoted fields, BOM strip; newlines-in-quotes unsupported by design), `sha256Hex` (crypto.subtle), `rankCandidatesForLine` (direction+currency filter, sort by amount diff then date diff — mirrors server scoring priorities), `suggestedAllocation`, `confirmedMatchedTotal`, Thai label maps.
- `StatementImportPanel.tsx` (new tab นำเข้า statement): account select → CSV file OR paste textarea → server preview (valid/duplicate/error counts, per-row errors, yellow/red row highlight) → duplicate policy radio (skip default / flag) → commit with fileHash → import history + void-with-reason.
- `MatchingPanel.tsx` (new tab จับคู่รายการ): open lines table → expand → confirmed matches (unmatch button) + ranked candidates (top 8) with allocation prefill → confirm / ignore-with-reason. Empty states for no candidates and no open lines.
- XLSX **file** upload not supported (no parser dependency in repo; Excel users paste rows — TSV path). Add SheetJS-or-equivalent only if owner asks for direct .xlsx files.
- API client: `listStatementLines`/`listStatementImports` added; `confirmMatch` allocatedAmount type fixed number→string (server does string cent-math; number payload would crash `.trim()`).

Verification 2026-07-06 (all green):

- API: focused banking tests + full suite `npm test` → 1007/1007; `tsc --noEmit` clean. Web: `npm test` → 180/180 (13 new banking.logic tests); `tsc --noEmit` clean. Contracts tsc clean.
- Live browser smoke (this session's own dev servers on 3000/3001, seed-local-company, seeded 1 RECORDED RECEIVED AccountingPayment 1500.00 via scratchpad `seed-banking-smoke.ts`): created bank account via UI → pasted Thai-header CSV (ถอน/ฝาก columns) → preview 3 rows = 2 valid + 1 error "Missing amount" → commit 2 lines → re-paste same rows → preview flags ซ้ำ 2 → mixed batch (2 dup + 1 new) with skip policy imported exactly 1 → matching tab showed candidate (number+counterparty+remaining, prefill 1500.00) → confirm → DB: line MATCHED, match CONFIRMED, candidate excluded from next query → ignore flow (prompt reason) → empty state. Zero console errors. Smoke rows cleaned (CLEANUP=1), servers stopped.

## OCR/PDF statement intake 2026-07-06 (spec §20)

Same-day second slice per owner sequence (item 13 web UI → OCR intake → back to 15A).

- Flow: `POST bank-accounts/:id/statement-imports/extract` {fileBase64, mimeType, fileName} under `bank.statement.import`, bounded by `UPLOAD_MAX_BYTES` (refuse-not-truncate). Returns `BankStatementExtractResult` = rows keyed by the SAME canonical CSV aliases (postedDate/description/debit/credit/amount/balance/bankReference) + rowConfidences + balanceChainBreaks + sourceKind + extractionModelId. Client then reuses the normal preview → commit; commit stores whitelisted `{sourceKind, extractionModelId}` into existing `BankStatementImport.mappingJson` — NO migration.
- PDF text path (no AI, spec-exact): **dependency decision recorded — added `pdfjs-dist` to apps/api** (no PDF parser existed anywhere; Thai CID fonts make hand-rolling unrealistic). ESM-only package under CJS swc build → loaded with `Function('return import(...)')()` native dynamic import (swc transpiles plain `import()` to require — verified with a probe). `PdfStatementTextExtractor` flips PDF-space y to reading order (+100k offset per page), then pure `clusterPdfTextRows` in banking.logic: y-tolerance line grouping → gap-merge into cells → header detection via the same alias lists `normalizeStatementRow` reads (Thai + English, case-insensitive) → nearest-column assignment → canonical keys; repeated page-2+ headers skipped. Scanned PDFs (<10 text items) or headerless docs → stable 422 codes (`extract_pdf_scanned_unsupported` / `extract_pdf_table_not_found`); UI tells user to photograph pages instead. Deliberate first-pass ceiling: no PDF→image rendering (would need `canvas` native dep).
- Photo path (AI, fail-closed): gateway `POST /internal/ai/bank-statement-extract` in the line-ai internal controller — same X-Internal-Secret + two-stage pipeline as receipt-ocr (Typhoon reads → provider structures rows JSON w/ per-row confidence, BE-year conversion in prompt, skip totals; bounded parse, modelId 'typhoon-ocr'). API side uses banking-owned `StatementAiExtractClient` (no cross-module import of line-ai's client), 60s timeout, `not_configured`/`failed` mapped to stable 422 codes.
- Guardrail: `checkRunningBalanceContinuity` (pure, cents; balance-less rows reset the chain) wired into BOTH extract result and the shared preview result (`balanceChainBreaks` added to `BankStatementImportPreviewResult` — CSV imports get it free).
- Body limits: route-scoped `json({limit})` mounted BEFORE the global 1mb parser — api main.ts regex for the extract route (uploadMaxBytes×1.5), gateway main.ts regex for BOTH internal OCR endpoints at 16mb (also fixes latent receipt-ocr rejection of images >~750KB base64 under global 1mb).
- Web: same import tab accepts .pdf/.jpg/.png → auto extract → auto preview; provenance banner (`SOURCE_KIND_LABELS`: pdf_text = "ไม่ใช้ AI", ocr = ตรวจทานก่อนยืนยัน + model id), CSV-preferred nudge, orange highlight for balance-chain breaks and OCR confidence <0.8 (`LOW_CONFIDENCE_THRESHOLD`), Thai messages for every stable error code (`extractErrorMessage`).
- Verification (all green): api 1015/1015 + tsc, gateway 222/222 + tsc (2 new endpoint tests incl. two-stage fake-fetch happy path), web 180/180 + tsc, contracts tsc; runnable integration check `scratchpad/pdf-extract-check.ts` builds a hand-written uncompressed text PDF and asserts extractor rows (also proves the ESM import trick under tsx); live browser: uploaded fixture PDF → banner "อ่านจากชั้นข้อความ PDF (ไม่ใช้ AI)" → preview 2 rows correct signs/balances → commit 2 lines → DB `mappingJson={"sourceKind":"pdf_text"}` → re-upload flagged ซ้ำ 2 (hash dedupe across extractions); image upload with gateway down → Thai fail-closed error, no crash. External-call paths (real Typhoon/Bedrock) deliberately NOT exercised — needs real bank samples + owner go-ahead.

## Artifacts

### contracts
- `packages/contracts/src/banking.ts` - all enums and DTOs (13 type aliases, 15 DTO types)
- `packages/contracts/src/index.ts` - exports `./banking.js`

### API module
- `apps/api/src/modules/banking/domain/models/banking.model.ts`
- `apps/api/src/modules/banking/domain/logic/banking.logic.ts` - pure functions (BigInt cent arithmetic)
- `apps/api/src/modules/banking/domain/logic/banking.logic.spec.ts` - domain tests
- `apps/api/src/modules/banking/infrastructure/prisma-banking.repository.ts` - Prisma persistence methods
- `apps/api/src/modules/banking/application/use-cases/bank-account.use-case.ts` - 5 use cases
- `apps/api/src/modules/banking/application/use-cases/statement-import.use-case.ts` - 4 use cases
- `apps/api/src/modules/banking/application/use-cases/matching.use-case.ts` - 5 use cases
- `apps/api/src/modules/banking/application/use-cases/bank-adjustment.use-case.ts` - 6 use cases
- `apps/api/src/modules/banking/application/use-cases/reconciliation.use-case.ts` - 6 use cases
- `apps/api/src/modules/banking/presentation/http/bank-account.controller.ts`
- `apps/api/src/modules/banking/presentation/http/statement.controller.ts`
- `apps/api/src/modules/banking/presentation/http/matching.controller.ts`
- `apps/api/src/modules/banking/presentation/http/adjustment.controller.ts`
- `apps/api/src/modules/banking/presentation/http/reconciliation.controller.ts`
- `apps/api/src/modules/banking/banking.module.ts`

### Prisma
- Migration `20260630090215_add_banking_models` applied
- 8 new models: BankAccount, BankStatementImport, BankStatementLine, BankReconciliationMatch, BankAdjustment, BankReconciliationSession, BankReconciliationSessionLine, BankReconciliationEvidenceExport
- 12 new enums in schema

### Permissions
- 23 banking permissions added to `apps/api/src/modules/auth/permission-registry.ts`
- OWNER/ADMIN/FINANCE/ACCOUNTANT/AUDITOR_READONLY/MANAGER role grants added

### Web
- `apps/web/src/features/banking/banking.api.ts` - API client (20 functions)
- `apps/web/src/features/banking/BankingPages.tsx` - 4-tab UI (bank accounts, cash position, reconciliations, adjustments)
- `apps/web/app/(workspace)/companies/[companyId]/banking/page.tsx` - route
- `web-core-workspace.constants.ts` - banking module entry added
- `workspace-dictionary.ts` - module.banking translation added

### App module
- `apps/api/src/app.module.ts` - BankingModule registered

## Verification

- `CI=true pnpm --filter @watchdog-bms/api exec tsx --test src/modules/banking/domain/logic/banking.logic.spec.ts src/modules/banking/application/use-cases/matching.use-case.spec.ts src/modules/banking/application/use-cases/reconciliation.use-case.spec.ts` → 55 tests pass, 0 fail
- `CI=true pnpm --filter @watchdog-bms/api exec tsc --noEmit` → 0 errors
- `CI=true pnpm --filter @watchdog-bms/web exec tsc --noEmit` → 0 errors
- `CI=true pnpm --filter @watchdog-bms/api test` → 459 tests pass, 0 fail
- First sandboxed focused test run hit `tsx` IPC `listen EPERM`; rerun outside sandbox passed.
- Earlier verification before review: API/web typecheck passed; Prisma migration applied locally; Prisma client regenerated.
- `prisma migrate dev --name add_banking_models` → migration applied to local DB
- `prisma generate` → Prisma client regenerated

## Open questions / deferred

- Phase 8 (AI/LINE banking read tools): needs LINE AI tool registry integration
- Evidence export file generation: PDF/XLSX output; current endpoint returns stub
- KBank K BIZ and SCB Business Anywhere real CSV samples: need real exports to validate alias presets beyond synthetic fixtures
- bank.account.sensitive_read: field-level redaction based on this permission not yet enforced at controller level
- Reconciliation evidence export endpoint/artifacts are not implemented in the current API controllers.
- Web workspace still lacks: manual statement line form, evidence export screen, XLSX file upload (paste-from-Excel covers most cases; needs parser dependency decision).
- DONE 2026-07-06: web statement import (preview/commit/dedupe/void) + matching workspace (candidates/confirm/unmatch/ignore); source candidate read adapters for items 08/09/12/14 + bank adjustments.

## Next

- Keep master checklist item 13 unchecked until remaining blockers are implemented and verified.
- Implement evidence export endpoint/artifacts for JSON/CSV/XLSX/PDF and audit/outbox.
- Wire read-only AI/LINE banking summaries through permission-checked API/tool path.
- Manual statement line UI form (API + permission already exist).
- Real bank format fixture validation (CSV presets AND PDF/photo extraction) when sample files available; exercise the real Typhoon photo path then.
- DONE 2026-07-06: OCR/PDF intake per spec §20 (see section above); owner sequence continues with 15A Phase 2 remainder.
