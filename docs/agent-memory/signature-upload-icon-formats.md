# Agent Memory: signature upload icon and source formats

Status: Complete
Owner: Codex
Scope: Web signature upload affordance and accepted source image formats.
Decisions:
- Replace the handwriting emoji in the upload dropzone with the existing neutral upload icon so it cannot be confused with the adjacent on-screen signing method.
- Accept PNG, JPG/JPEG/JPE, HEIC/HEIF, and GIF in the signature picker; mobile users may choose a saved image or use the camera option supplied by the image picker.
- Normalize HEIC/HEIF, GIF, JPE, and non-canonical JPEG MIME input in the browser to a static JPEG before the existing PNG/JPEG attachment validation and background-removal flow. Do not widen the backend attachment MIME allowlist.
- Keep the broader source-format policy scoped to signatures; receipt upload acceptance is unchanged.
Open questions: None.
Artifacts:
- `docs/specs/expense-receipt-upload-spec.md`
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx`
- `apps/web/src/features/expenses/expense-upload.logic.ts`
- `apps/web/src/features/expenses/expense-upload.logic.spec.ts`
Verification:
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/expense-upload.logic.spec.ts` — 26 passed.
- `corepack pnpm --filter @watchdog-bms/web typecheck` — passed.
- `git diff --check` — passed.
Next: Ready for mobile UAT with one camera-captured HEIC photo and one GIF/JPE fixture; no deployment was requested.
