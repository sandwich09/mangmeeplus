# Agent Memory: themed-file-rollout

Status: COMPLETE + VERIFIED (2026-08-08). Owner report: the manual-expense
receipt field showed the browser-drawn "Choose File / No file chosen" control —
hard to use, no icon, not localized.
Owner: Claude
Scope: Web-only. New `ThemedFile` field component + swap of every VISIBLE
native `<input type="file">` (12 sites). Hidden inputs with custom triggers
(ExpensesPages:337, ExpenseReviewPage:670, ExpensesWorkspacePanels:416,
SubstituteReceiptWizardPage:979, BroadcastPrototypePage:348) untouched.

Decisions:
- `apps/web/src/common/components/field/ThemedFile.tsx` mirrors ThemedDate:
  mangmee-input shell, paperclip + localized placeholder (ยังไม่ได้เลือกไฟล์),
  brand chip button (เลือกไฟล์/เปลี่ยนไฟล์ + upload icon), built-in clear (นำไฟล์ออก).
  Root is a <label> wrapping an sr-only native input — click anywhere opens the
  dialog natively; the clear <button> is interactive content so it doesn't
  re-trigger the dialog. Callers that wrapped the input in their own <label>
  were switched to <div> (nested labels are invalid).
- Controlled mode (`file`: File | string | null): parent owns the File; the
  native input is cleared after every pick so re-selecting the same file still
  fires — callers dropped their `key`-remount hacks (ExpensesPages manual
  receipt, ReimbursementCreatePage) and `e.target.value = ''` resets
  (ReimbursementsPages ×2, passed `file={null}` for upload-immediately flows).
  String form serves StatementImportPanel (only has a fileName string).
- Uncontrolled mode (`name`) keeps the FileList for FormData forms + native
  `required` (TradeTaxEvidencePage attachment). A form `reset` listener clears
  the shown name because React 19 form actions reset via form.reset().
- External "✓ name / นำออก" rows deleted where ThemedFile now shows them;
  dictionary key `expenses.manual_receipt_remove` (th+en) removed as dead.

Swapped sites: ExpensesPages 732/746 (supporting/payment evidence), 772+792
(signature ×2, replace_all), 1588 (manual receipt — the reported field);
SubstituteReceiptWizardPage 224 (signature upload); TradeTaxEvidencePage 139
(FormData, required); AccountsPayablePages 177 (tax-evidence upload);
ReimbursementCreatePage 191 (per-line receipt); ReimbursementsPages 793
(line receipt), 866 (signed copy), 1366 (signature modal);
StatementImportPanel 186 (statement file).

Verification:
- `corepack pnpm --filter @watchdog-bms/web typecheck` ✓
- `CI=true node --import tsx --test "src/**/*.spec.ts"` ✓ 771/771
  (768 baseline + 3 new ThemedFile.spec.ts: sr-only name/required contract,
  controlled name + clear button, disabled state)
- `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build` ✓
- `grep type="file"` → only the 5 hidden custom-trigger inputs remain.

Next:
- [ ] Host E2E + commit (alongside toast v2 / loading / themed-date /
      permission-visibility work — all uncommitted)
