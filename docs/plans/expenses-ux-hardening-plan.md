# Plan: Expenses + Receipts UX Hardening (save buttons, popups, sanitization, upload robustness)

Status: PLANNED — 2026-07-26
Owner: Claude (harness engineer) → Codex (implementation)
Branch: `fix/permissions-system` (contains uncommitted expense-detail-stepper-ux work — do NOT revert it; line numbers below may drift, anchor on symbols)
Scope: `apps/web` only (plus i18n dictionary and tests). No API/contract/backend changes. No new runtime dependency.

## Product goals (from owner, Thai)

1. Every create/update/edit surface in ค่าใช้จ่าย + ใบเสร็จ must save via an explicit บันทึก button — never save-on-blur/immediately.
2. Tab บันทึกด้วยมือ (manual entry): polish UX/UI so it looks complete and is easy to understand for non-technical users.
3. Tab หมวดหมู่: add an "เพิ่มหมวดหมู่ใหม่" button that opens a popup with ชื่อหมวดหมู่ / ภาษีซื้อเริ่มต้น / รหัสบัญชีแนะนำ (optional) — same fields as today, but popup instead of always-visible side card.
4. All text inputs in the expenses feature: validate/deny unexpected special characters, and silently remove `\` (backslash) from anything typed/pasted.
5. Tab ลายเซ็นบริษัท: "อัปโหลดลายเซ็นใหม่" becomes a button that opens a popup (instead of always-visible side card).
6. Tab อัปโหลดใบเสร็จ: accept iPhone photo formats (HEIC/HEIF) and `.jpeg`/`.jpg`; images over 2MB are resized client-side to ≤ 2MB; make the AI-read flow robust so it completes without avoidable errors.
7. In the expense detail popup, rename the ปฏิเสธ button to ยกเลิกรายการ.

## Current state (verified 2026-07-26)

- Tabs defined in `ExpensesPages.tsx` (`EXPENSES_TABS`, `TAB_META` ~L1532–1541). `manual` tab label "บันทึกด้วยมือ" is a hardcoded literal, not a dictionary key.
- The ONLY auto-save in the feature: category rename input in `ExpensesWorkspacePanels.tsx` `CategoryManagePanel` (~L112–116) saves on `onBlur` and Enter via `saveName()`. Everything else already uses explicit buttons.
- Category add form: always-visible side card (`ExpensesWorkspacePanels.tsx` ~L138–153), fields name / VAT toggle (CLAIMABLE|NON_CLAIMABLE) / account hint → `createExpenseCategory` (`expenses.api.ts:227`).
- Signature upload: always-visible side card (`SignaturePanel`, `ExpensesWorkspacePanels.tsx` ~L312–340), `accept="image/png,image/jpeg"`, canvas background-removal preview, → `initSignatureUpload`/`createSignatureAsset`.
- Upload tab (`UploadPanel`, `ExpensesPages.tsx:107–219`): `accept="application/pdf,image/png,image/jpeg"`; the drag-drop path does not filter type at all; no client-side size limit or image processing. Server caps: 10MB upload (`UPLOAD_MAX_BYTES`), extraction caps 10MB image / 4MB PDF, extraction MIME whitelist jpeg|png|pdf (`expense-extraction.use-case.ts:10–14`). HEIC appears nowhere in the repo.
- Sanitization: web has only `apps/web/src/common/forms/trim.ts` (not imported by expenses). API globally deep-trims strings (`TrimStringsPipe`) but expense bodies are plain TS types — no runtime validation.
- ปฏิเสธ: `expenses.reject` (dict th ~L768 "ปฏิเสธ", en ~L1609 "Reject"), used only in `ExpenseDetailModal` (~L984, L990). A separate hardcoded ปฏิเสธ exists in `SignaturePanel` (signature approval; NOT in scope of the rename — it means rejecting a signature, not an expense).
- `ExpensesWorkspacePanels.tsx` has zero `t()` calls — all Thai literals. Shared `Modal` component exists at `apps/web/src/common/components/modal` and is already used by `ExpensesPages.tsx`.

## Workstreams

### W1 — Explicit save for category rename
File: `ExpensesWorkspacePanels.tsx` (`CategoryManagePanel`).
- Replace blur-save rename with: edit mode shows input + บันทึก + ยกเลิก buttons. Enter = save, Escape = cancel, **blur does nothing** (keeps edit mode). บันทึก disabled when trimmed value is empty or unchanged.
- Keep the archive confirm modal and the activate toggle as-is (a status switch is not a form; archive already confirms).
- Acceptance: clicking elsewhere while editing does NOT persist; only the บันทึก button (or Enter) calls `updateExpenseCategory`.

### W2 — Manual entry tab (บันทึกด้วยมือ) UX polish
File: `ExpensesPages.tsx` (`ManualExpensePanel` ~L1493–1529) + `workspace-dictionary.ts`.
- Add real dictionary keys `expenses.tab_manual` / `expenses.tab_manual_desc` (th+en) and remove the hardcoded `label`/`description` literals in `TAB_META.manual`.
- Restructure the form with labeled fields (currently placeholder-only inputs):
  - Section 1 "ข้อมูลเอกสาร": วันที่ค่าใช้จ่าย* (label above ThemedDate), รายละเอียดค่าใช้จ่าย* (label + input).
  - Section 2 "จำนวนเงิน": จำนวน*, ราคาต่อหน่วย*, and a read-only computed ยอดรวม display (`quantity × unitPrice`, formatted with the existing money formatter used elsewhere in the file).
  - Section 3 "ภาษี (Tax Code)": keep `TransactionTaxLineSelector` unchanged, with a label and one-line helper in plain Thai.
- Every required field marked `*`; submit button text "บันทึกฉบับร่าง" (busy: "กำลังบันทึก..."); keep the existing disabled conditions and the read-only permission note.
- Replace the dev-jargon subtitle ("ใช้ logic Tax Code รายบรรทัดเดียวกับ upload review; บันทึกเป็น draft ก่อนยืนยัน") with user-facing copy, e.g. "กรอกรายละเอียดค่าใช้จ่าย ระบบจะบันทึกเป็นฉบับร่างให้ตรวจสอบก่อนยืนยันลงบัญชี".
- All new strings via dictionary keys (th+en) — do not add more hardcoded literals to this component.
- Behavior/payload of `createExpenseDraft` unchanged.

### W3 — Categories tab: add-category popup
File: `ExpensesWorkspacePanels.tsx` (`CategoryManagePanel`) using the shared `Modal` from `apps/web/src/common/components/modal`.
- Remove the always-visible "เพิ่มหมวดหมู่ใหม่" side card; table card becomes full width.
- Add a "+ เพิ่มหมวดหมู่ใหม่" primary button in the table card header. Clicking opens a Modal titled "เพิ่มหมวดหมู่ใหม่" containing exactly the current three fields (ชื่อหมวดหมู่* / ภาษีซื้อเริ่มต้น toggle / รหัสบัญชีแนะนำ (ไม่บังคับ)) + footer buttons เพิ่มหมวดหมู่ (primary, disabled while `!name.trim()` or busy) and ยกเลิก.
- On success: close modal, reset fields, reload list. On error: show error inside the modal, keep it open.
- Payload unchanged: `{ name, accountHintKey: hint || \`expense.custom.${Date.now()}\`, inputVatDefault }`.
- Apply W4 sanitization to both text fields.

### W4 — Input sanitization (all expenses text inputs)
New file: `apps/web/src/common/forms/sanitize.ts` (+ colocated `sanitize.spec.ts`, node:test style like `trim.spec.ts`).
- `stripDisallowed(value: string): string` — removes `\` and ASCII control chars (except `\n` for textareas); collapses nothing else.
- `findForbiddenChars(value: string): string[]` — returns any of `< > { } | ^` \` present (for showing a validation message). Thai text, digits, and normal punctuation (`. , - / ( ) & # % + ' " : ; @ _ * !` etc.) must pass — vendor names and descriptions are real-world Thai strings.
- Policy: on every change, run `stripDisallowed` (so `\` can never enter state); on submit, `trim`. If `findForbiddenChars` is non-empty, block submit for that form and show a Thai message via new key `common.forbidden_chars` (th: "ห้ามใช้อักขระพิเศษ: {chars}", en equivalent) — reuse the pattern each form already uses for errors (ErrorBanner / inline text).
- Apply to every free-text input in the feature:
  - `ExpensesPages.tsx`: manual description; upload note; vendor name / vendor tax id / document number and line descriptions in `ExpenseReviewEditSection`; override reason; substitute reason/purpose; signer position; supersede reason; reject/void reason textarea.
  - `ExpensesWorkspacePanels.tsx`: category name, account hint, rename input, signature label, signature reject reason.
- Do NOT touch numeric inputs (`type="number"`), date inputs, or selects.
- Unit tests: backslash stripped; control chars stripped; Thai text with `บจก. เอ/บี (สาขา 1) & Co.` passes; `<script>` caught; empty result behavior.

### W5 — Signature tab: upload popup
File: `ExpensesWorkspacePanels.tsx` (`SignaturePanel`) using shared `Modal`.
- Remove the always-visible "อัปโหลดลายเซ็นใหม่" side card; left column content becomes full width.
- Add an "อัปโหลดลายเซ็นใหม่" primary button in the panel header (near "ลายเซ็นทั้งหมด" card title). Opens a Modal containing the existing uploader exactly: file picker (`accept="image/png,image/jpeg"`), optional label input (with W4 sanitization), "ลบพื้นหลัง (ดูตัวอย่าง)" preview flow (canvas + `removeLightBackground` unchanged), submit buttons, preview grid.
- On successful ส่งขออนุมัติ: close modal, reset state, reload list. Errors show inside the modal.
- Keep the hidden `<canvas>` inside the modal so refs still resolve.

### W6 — Upload receipt: HEIC/JPEG support + 2MB client-side resize
Files: `ExpensesPages.tsx` (`UploadPanel`), new `apps/web/src/features/expenses/expense-upload.logic.ts` (+ `.spec.ts`).
- Accept attr → `application/pdf,image/png,image/jpeg,image/heic,image/heif,.heic,.heif,.jpg,.jpeg` (`.jpeg`/`.jpg` already work via `image/jpeg`; explicit extensions help some pickers).
- New pure-ish module `expense-upload.logic.ts`:
  - `classifyUploadFile(name, type)` → `'image' | 'pdf' | 'heic' | 'unsupported'` (check MIME first, fall back to extension because dropped/AirDropped HEIC files often have empty `type`). Unit-testable.
  - `MAX_IMAGE_BYTES = 2 * 1024 * 1024`.
  - `prepareReceiptFile(file): Promise<{ file: File; resized: boolean } >` — browser part:
    - `pdf`: pass through (server 10MB cap still applies). If > 4MB, caller shows warning notice "ไฟล์ PDF ใหญ่เกิน 4MB — AI จะไม่สามารถอ่านอัตโนมัติได้ ต้องกรอกข้อมูลเอง" but upload proceeds.
    - `image` ≤ 2MB: pass through.
    - `image` > 2MB or `heic`: decode via `createImageBitmap(file)` (fallback `new Image` + objectURL), draw to canvas with max long-edge 2560px, export `canvas.toBlob('image/jpeg', q)` stepping quality 0.92 → 0.5 until ≤ 2MB (downscale further ×0.8 if quality floor still exceeds). Output `File` named `<base>.jpg`, `type: 'image/jpeg'`.
    - HEIC decode failure (browsers without HEIC support, e.g. Chrome): throw a typed error; UI shows "ไฟล์ HEIC จากไอโฟนเปิดไม่ได้ในเบราว์เซอร์นี้ — กรุณาเปิดใน Safari หรือส่งรูปเป็น JPG" . No new dependency (ponytail); note: iOS Safari transcodes HEIC→JPEG automatically for file inputs, so the common iPhone path works natively.
  - `unsupported`: block with clear Thai error naming allowed types.
- Wire BOTH the picker path and the drop path through `classifyUploadFile` + `prepareReceiptFile` (the drop path currently bypasses all filtering). Show a processing state ("กำลังเตรียมไฟล์...") while converting; show "✓ ย่อรูปเหลือ X MB" style feedback when resized.
- `handleUpload` sends the prepared file's `name/type/size` (so `initReceiptUpload` byteSize matches actual upload — this is what makes the AI-extraction size gate always pass for images).
- Update dropzone hint copy `expenses.upload_dropzone_hint` (th+en): "รองรับ JPG/JPEG PNG HEIC (รูปจากไอโฟน) หรือ PDF · รูปใหญ่จะถูกย่ออัตโนมัติ · หรือส่งจาก LINE ได้เลย".
- Unit tests (`expense-upload.logic.spec.ts`): `classifyUploadFile` matrix (jpeg/jpg/png/pdf/heic by MIME, heic by extension with empty MIME, exe → unsupported); quality/downscale step function if factored pure.

### W7 — AI read-flow robustness
File: `ExpensesPages.tsx` (`UploadPanel.handleUpload`, `extractionNotice`).
- After W6 every uploaded image is jpeg/png ≤ 2MB → extraction MIME/size gates (`SUPPORTED_MIME_TYPES`, `MAX_EXTRACTION_BYTES`) can no longer reject images. This is the main fix.
- Add one automatic retry: if `requestExpenseExtraction` throws (network) or returns `status: 'failed'`, retry once after ~1.5s before surfacing the failure notice. Never retry `not_configured`, `unsupported`, or `not_expense_document`.
- Keep the existing guarantee that upload itself succeeds even when extraction fails (notice + "อ่านเอกสารอีกครั้ง" in the detail modal already exist — verify unchanged).
- Verify all `ExtractionStatus` values map to a notice in `extractionNotice` (they do today; keep exhaustive — add a TS exhaustiveness check if cheap).
- No backend changes.

### W8 — Rename ปฏิเสธ → ยกเลิกรายการ (expense detail popup)
File: `workspace-dictionary.ts` only.
- `expenses.reject`: th "ปฏิเสธ" → "ยกเลิกรายการ"; en "Reject" → "Cancel item".
- `expenses.reject_reason`: th "เหตุผลปฏิเสธ" → "เหตุผลการยกเลิกรายการ"; en "Reject reason" → "Cancellation reason".
- Known wording collision (accepted): the void flow uses `expenses.void_reason` "เหตุผลยกเลิก". The two never render simultaneously; leave void wording unchanged.
- Do NOT rename the ปฏิเสธ button in `SignaturePanel` (that rejects a signature request, different meaning) or `expenses.rejected_at`.
- Check e2e/specs for text assertions on "ปฏิเสธ" and update if any.

## Out of scope

- Backend/API/contracts changes (incl. adding HEIC to server MIME whitelist — client transcodes instead).
- The `evidence` tab, list tab, substitute-receipt settings page.
- i18n retrofit of all of `ExpensesWorkspacePanels.tsx` (only strings touched by W1/W3/W5 move to keys… acceptable to keep them as literals matching the file's current style; new-key requirement is strict only for `ExpensesPages.tsx` which already uses `t()`).

## Verification protocol (harness runs these — Codex must run them too and paste output)

1. `corepack pnpm --filter @watchdog-bms/contracts build` (stale-dist guard)
2. `corepack pnpm --filter @watchdog-bms/web test` — all pass, including new `sanitize.spec.ts` + `expense-upload.logic.spec.ts` (baseline before this work: 325 pass)
3. `corepack pnpm --filter @watchdog-bms/web typecheck` — clean
4. `corepack pnpm --filter @watchdog-bms/web build` — succeeds
5. e2e (stack running): `EXP-01..09` still pass; grep e2e for "ปฏิเสธ" assertions
6. Harness manual review of full diff: confirm no behavior change beyond the 8 workstreams, no removed handlers/guards, stepper-UX work untouched, no new dependency in any package.json

## Acceptance checklist (harness signs off)

- [ ] W1: category rename persists only via บันทึก/Enter; blur does not save
- [ ] W2: manual tab has labeled sections, computed total, dictionary-backed tab label (th+en), same payload
- [ ] W3: add-category is a button + Modal popup; side card gone; error stays in modal
- [ ] W4: `\` cannot be typed/pasted into any expenses text input; forbidden chars block submit with Thai message; Thai vendor strings unaffected; helper unit-tested
- [ ] W5: signature upload is a button + Modal popup; preview/derived-asset flow still works
- [ ] W6: HEIC/JPEG accepted (picker + drop), image > 2MB auto-resized ≤ 2MB, prepared size sent to `initReceiptUpload`, PDF > 4MB warns, unsupported types blocked on both paths
- [ ] W7: images can no longer hit extraction size/MIME rejection; one auto-retry on transient failure; upload never lost when extraction fails
- [ ] W8: detail popup shows ยกเลิกรายการ; signature ปฏิเสธ untouched; en updated
- [ ] All verification commands green; no new deps; no backend diff
