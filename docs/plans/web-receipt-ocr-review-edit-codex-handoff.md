# Web Receipt OCR + Review Edit — Codex CLI Handoff Harness

Status: Implement-ready 2026-07-10. Closes the web-upload extraction gap + missing review edit form. Spec authority: `docs/specs/expense-receipt-upload-spec.md` **§19a** (owner decisions 2026-07-10) + §11 (`extraction-request` endpoint) + §13 (editable extraction suggestions) + `docs/specs/typhoon-receipt-ocr-spec.md` (JPEG/PNG first slice). Task memory: `docs/agent-memory/web-receipt-ocr-review-edit.md`. Predecessor harnesses (patterns to follow): `docs/plans/mvp1-prod-gap-closure-codex-handoff.md`.

Executor model: **Codex CLI** — `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s workspace-write`. Codex codes + adds/updates tests + runs the listed verify commands per phase and self-reviews. **Claude reviews each phase for business completeness (diff-vs-intent + ponytail + boundary audit), drives fixes, runs the real `pnpm test` gate, and commits per-phase after PASS (explicit paths only, never `git add -A`). Codex never commits, never `git add`.**

## Problem (ground truth, verified 2026-07-10)

- Web upload flow: `ExpensesPages.tsx:76` `initReceiptUpload` → PUT file → `completeReceiptUpload` — **ends there**. `CompleteReceiptUploadUseCase` (`expense-upload.use-case.ts:82`) links the attachment, sets `NEEDS_REVIEW`, appends outbox `expense.receipt_uploaded` (`:130`) which **has no consumer anywhere**. Draft keeps the all-zero totals set at init (`:60-67`). Result: every web-channel expense shows "(รอระบุผู้ขาย)" ฿0.00.
- The ONLY receipt-OCR caller is the LINE webhook: `process-line-webhook.use-case.ts:1150` (`aiGateway.requestReceiptOcr`) with private `tryExtractReceiptFields` (`:1142`) + `applyReceiptOcrFields` (`:1175`) + helpers `deriveUnitPrice` (`:183`), `validDate`/`validVatMode`/`toMoney4` (same file).
- Review panel edit: `updateExpenseDraft` PATCH client exists (`expenses.api.ts:85`) and the backend `UpdateExpenseDraftUseCase` (`expense-draft.use-case.ts:114`) **already supports** vendor fields, vatMode, and full `lines` upsert with server-side totals recompute (`calcLineTotals`/`calcDocumentTotals`). But the web UI uses PATCH for exactly one thing: docType/taxStatus/category (`ExpensesPages.tsx:198`). No form for vendor/amounts/lines exists.
- Gateway endpoint `POST /internal/ai/receipt-ocr` (`line-ai-internal.controller.ts:65`): requires `contentBase64`, rejects non-JPEG/PNG with `UNSUPPORTED_MIME_TYPE`, returns `not_configured` without Typhoon key. JSON body limit 16mb (`ai-gateway/src/main.ts:42`).
- `AttachmentStoragePort` (`data-model-core/domain/ports/attachment-storage.port.ts:42`) has NO byte-read method — only upload-intent/download-url/metadata. Adapters: `s3-storage.adapter.ts` (H4) + local adapter in `data-model-core/infrastructure/storage/`.
- Banking already models a thin per-module gateway client: `statement-ai-extract.client.ts` (internal secret header, 60s timeout, fail-closed `not_configured`/`failed`). Copy this transport pattern.
- Permissions registered: `expense.ocr.request` (`permission-registry.ts:130`, granted OWNER+FINANCE). Uploader-own-draft rule per spec §19a decision 2.
- Contracts: `ReceiptOcrRequest/Response`, `ReceiptOcrFieldResult`, `LineAiAttachment` in `packages/contracts/src/line-ai.ts:107-145` — reuse, don't duplicate.
- Module dependency direction: line-ai already imports expenses use-cases (init/complete upload are injected into the webhook use-case) — so moving apply-logic INTO expenses and having line-ai call it is the correct direction. Expenses must NOT import from line-ai.

## Environment quirks (read before running anything)

- **Node**: shell defaults to v14. Prefix EVERY session: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- **API tests are a HAND-MAINTAINED explicit list** in `apps/api/package.json` `"test"` — every new `*.spec.ts` MUST be added there in the same phase or it silently never runs.
- **NEVER run `prisma migrate`/`db push` locally.** This harness needs **zero schema changes** — if you think you need one, STOP and report.
- After editing `packages/contracts`: `pnpm --filter @watchdog-bms/contracts build` before dependent typechecks.
- Sandbox fallback: if `pnpm --filter … test` hits tsx IPC `listen EPERM`, use `node --import tsx --test <files>`.
- Specs stay pure-logic/mocked (repo convention) — mock prisma/storage/gateway clients; no live DB, no live gateway.

## Hard rules (violating any = wrong implementation)

1. **No commits, no `git add`**, no dev servers. Shared worktree — touch only the files each phase names.
2. **Contracts + existing clients only**: web data via `expenses.api.ts` + `@watchdog-bms/contracts`; new contract types additive.
3. **Security/tenant/permission/audit explicit**: new route = server-side tenant scope + permission check per §19a decision 2 + audit log + no raw bytes/object keys/base64 in HTTP responses.
4. Extraction stays **suggestion-only** (`aiVerificationStatus: 'PARTIAL'`, review mandatory). LINE/AI final-mutation ban untouched.
5. **No new dependency.** S3 `GetObjectCommand` comes from the already-present `@aws-sdk/client-s3`.
6. **XSS-inert**: OCR-derived strings (vendor name, description) render as text nodes only.
7. LINE path behavior must remain byte-for-byte equivalent (same statuses, same audit actions, same reply text) — this is a refactor + new caller, not a redesign.
8. Deterministic gates only — OCR output never auto-confirms anything.

---

# Phases (sequenced — each gated by Claude review, committed individually)

## W1 — Shared extraction service + `extraction-request` endpoint (API)

Business intent: a web-uploaded receipt gets the same AI read as a LINE-uploaded one, on demand, with identical provenance; LINE keeps working unchanged.

Changes:
1. **Storage byte-read**: add `getObject(input: { bucket: string; objectKey: string }): Promise<{ bytes: Buffer; mimeType?: string }>` to `AttachmentStoragePort` + implement in the S3 adapter (`GetObjectCommand`) and the local adapter (fs read). Throw on missing object (caller maps to `failed`).
2. **Thin gateway client**: `apps/api/src/modules/expenses/infrastructure/receipt-ocr.client.ts` — mirror `statement-ai-extract.client.ts` exactly (X-Internal-Secret, `aiGatewayInternalUrl` + `/internal/ai/receipt-ocr`, 60s `AbortSignal.timeout`, secret missing → `not_configured`, transport error → `failed`). Types from `@watchdog-bms/contracts` (`ReceiptOcrRequest/Response`).
3. **Move apply-logic into expenses**: new `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts` holding today's `applyReceiptOcrFields` + `deriveUnitPrice` + `validDate` + `validVatMode` + `toMoney4` logic verbatim (same field mapping, same `$transaction` line-replace, same `aiVerificationStatus: 'PARTIAL'`). Export from expenses module; refactor `process-line-webhook.use-case.ts` to inject and call it (delete the private copies). LINE call sites/behavior unchanged.
4. **New use-case** `RequestReceiptExtractionUseCase` (new file `expense-extraction.use-case.ts`):
   - Permission: `expense.ocr.request` OR `expense.review` OR (`expense.receipt.upload` AND `expense.createdByUserId === ctx.userId`). Else 403.
   - Load expense (tenant-scoped, 404 if absent). Status must be `DRAFT`/`NEEDS_REVIEW`/`READY_FOR_CONFIRMATION` — else 409/BadRequest (no re-extracting confirmed docs).
   - Resolve primary attachment (or the single linked receipt attachment if primary unset). None → `{ status: 'no_attachment' }`.
   - MIME not `image/jpeg`/`image/png` → `{ status: 'unsupported' }` (PDF stays manual per spec). `byteSize > 10_000_000` → `{ status: 'unsupported' }` (16mb JSON limit headroom).
   - `getObject` → base64 → client call. `ok`+fields → apply via shared service, also update `aiVerificationSummaryJson` = `{ status: 'OCR_EXTRACTED_NEEDS_REVIEW', recognizedFields, missingFields, nextAction: 'review_in_web' }` (mirror LINE shape, `process-line-webhook.use-case.ts:1111-1123`). Audit `expense.ocr.request` SUCCESS/FAILURE (metadata: attachmentId, status, field count — never base64).
   - Return additive contract type `ExpenseExtractionResult` (new in `packages/contracts/src/expenses.ts`): `{ status: 'ok' | 'not_configured' | 'unsupported' | 'no_attachment' | 'failed'; fields?: ReceiptOcrFieldResult; missingFields?: string[] }`.
5. **Route**: `POST :expenseId/extraction-request` in `expense.controller.ts` (same guard/decorator pattern as sibling routes; permission enforcement inside the use-case like `CompleteReceiptUploadUseCase` does).
6. Wire DI in `expenses.module.ts`; export the apply service for `LineAiModule`.

Codex verify: new spec `expense-extraction.use-case.spec.ts` (mock repo/storage/client/audit): permission matrix (ocr.request ✓ / review ✓ / uploader-own ✓ / other-staff ✗); PDF → `unsupported`, no gateway call; no attachment → `no_attachment`; gateway `not_configured` passthrough, no field writes; `ok` → apply called with fields + summary JSON written + audit; confirmed-status → rejects. Existing LINE webhook specs still green (they pin the moved logic). Register new spec in `apps/api/package.json`. Run: contracts build → `pnpm --filter @watchdog-bms/api typecheck` (or `tsc --noEmit` equivalent script) → full `pnpm --filter @watchdog-bms/api test`.

Claude gate: LINE path diff is pure delegation (no behavior drift); no route returns base64/object keys; permission model matches §19a decision 2; expenses module has zero line-ai imports.

## W2 — Web upload wiring + extraction states

Business intent: after a web upload the user sees the AI read happen and its outcome — fields filled, or a clear reason (PDF unsupported / AI not configured / failed) with retry — instead of a silent ฿0 draft.

Changes (web only, `apps/web/src/features/expenses/`):
1. `expenses.api.ts`: `requestExpenseExtraction(companyId, expenseId): Promise<ExpenseExtractionResult>` via `apiFetch` POST.
2. Upload flow (`ExpensesPages.tsx` `handleUpload`): after `completeReceiptUpload`, call `requestExpenseExtraction`; progress copy while pending (e.g. "AI กำลังอ่านเอกสาร…"); then `onSuccess()` routes to the draft as today. Map result → Thai banner on the detail/review panel: `ok` → summary of read fields; `unsupported` → "ไฟล์ PDF/ชนิดนี้ยังไม่รองรับการอ่านอัตโนมัติ — กรอกข้อมูลเองได้ที่ฟอร์มตรวจ"; `not_configured` → manual-review notice; `failed` → error + retry. Extraction failure must NOT fail the upload (upload already succeeded — banner only).
3. Detail/review panel: "อ่านเอกสารอีกครั้ง" (re-extract) button for drafts, calling the same endpoint, disabled while pending, refreshes detail on completion. Show for permitted users only (button can render always; a 403 shows the error banner — match existing panel error handling).
4. Surface `aiVerificationSummaryJson.missingFields` as a compact "ข้อมูลที่ยังขาด" chip list on the panel (text nodes only).

Codex verify: `pnpm --filter @watchdog-bms/web typecheck` + `pnpm --filter @watchdog-bms/web build` (or repo's existing web check script); reuse existing web test setup if any for the state mapping (pure function for result→banner copy is fine + tiny spec if the repo has web unit tests; otherwise keep mapping trivial and inline).

Claude gate: upload never blocks/fails on extraction outcome; all four non-ok states have distinct visible copy; no `dangerouslySetInnerHTML`; loading/error/permission states present; Thai copy consistent with existing screens.

## W3 — Review edit form + price-mismatch warning (web)

Business intent: reviewer can fix vendor/date/amounts/lines when OCR is wrong or absent — "ราคาไม่ตรง" is correctable — before ยืนยันและลงบัญชี.

Changes (web only):
1. Review panel (`ExpensesPages.tsx` detail panel): editable fields — vendor name, vendor tax id, document number, expense date, VAT mode select, and a line-items editor (description, quantity, unit price, discount, VAT rate per line; add/remove line). Prefill from current detail (OCR-filled or blank). Save via existing `updateExpenseDraft` PATCH sending `{ vendorName…, vatMode, lines: [...] }` per `UpdateExpenseDraftInput` (backend recomputes totals — client must NOT compute/send document totals). Editable only in `DRAFT`/`NEEDS_REVIEW`/`READY_FOR_CONFIRMATION`; read-only otherwise (matches backend `expense-draft.use-case.ts:126`).
2. Deterministic mismatch warnings (client-side display only):
   - OCR grand total (`aiVerifiedFieldsJson.grandTotalAmount`) vs server-computed `grandTotalAmount` differ (numeric compare, tolerance 0.01) → amber banner "ยอดที่ AI อ่านได้ไม่ตรงกับยอดจากรายการ — ตรวจสอบรายการหรือแก้ไขก่อนยืนยัน".
   - Confirm button context: `grandTotalAmount == 0` → amber note that a zero-amount expense is about to be confirmed (do not block — server rules stay authoritative).
3. After save, refetch detail so totals/status chips reflect server truth.

Codex verify: web typecheck + build green; extract the mismatch predicate + PATCH payload builder as small pure functions with a focused spec if web unit-test infra exists (check for `*.test.ts(x)` under `apps/web` — if none, keep them pure and reviewed, note "no web unit infra" in report).

Claude gate: PATCH payload matches `UpdateExpenseDraftInput` exactly (line fields the backend expects, no client-computed totals); permission/read-only states correct; warning math deterministic; no layout break on mobile widths (existing responsive classes reused).

## W4 — E2E + docs close-out

Business intent: the full web journey — upload → extract (deterministic `not_configured` locally) → edit lines → totals recompute → confirm — is pinned by E2E, and docs/task memory record the shipped state.

Changes:
1. `e2e/expenses.spec.ts`: extend (pattern: EXP-06 at `:79`) — EXP-07: upload receipt via API flow, `POST extraction-request` → expect `not_configured` (no Typhoon key in E2E env) and expense stays `NEEDS_REVIEW`; EXP-08: PATCH lines `[{qty 2, unitPrice 150}]` → GET detail shows `grandTotalAmount` 300 recomputed server-side → confirm succeeds. Respect the existing S3_E2E/MinIO guard for the upload part; the PATCH/confirm part must run without MinIO (create draft via `POST /expenses` manual path if needed).
2. Docs: update task memory (final state, verification evidence); tick the §13 "extraction suggestions … editable" behavior as shipped in the spec addendum §19a (append "Shipped: <date> <commits>" line). Update `docs/agent-memory/mvp1-gap-closure` successor pointer if that file lists remaining ops.

Codex verify: `pnpm --filter @watchdog-bms/api test` full suite; e2e spec syntax-checked via Playwright `--list`; if local MinIO/postgres E2E env available run `e2e/run-local.sh` filtered to expenses, else record exact reason not run.

Claude gate: E2E asserts server-recomputed totals (not client echo); no test weakened; docs/task-memory updated; runs recorded.
