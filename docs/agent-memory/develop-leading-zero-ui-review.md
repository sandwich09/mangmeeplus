# Agent Memory: Develop leading-zero amount input UI review

Status: COMPLETE — reproduced in the existing local UI; no application fix requested or implemented.
Owner: Codex / root, 2026-08-28–29 (Asia/Bangkok).
Scope: Check whether unit price and discount still retain a leading zero (`0400`), while valid decimals such as `0.402` work. User explicitly requested local UI verification.
Decisions:
- Remote `develop` verified with `git ls-remote` at `b19067658b04386ca6873ed1c9a9edfa87e4b0b6`. Existing local `develop` is older; do not use it as latest-branch evidence.
- Read-only source review found PR #332 / `9efcebf2` adds shared Decimal(18,4) validation to expense review. Inputs still pass their raw strings to state; validation and automatic normalization are separate behaviors to verify.
- User explicitly requested reuse of the existing local app, without a separate instance. Stopped temporary Web3011 and removed the newly created isolated worktree and its installed dependencies. Existing Web3000/API3003 were left running.
- All reported UI cases were tested on `http://127.0.0.1:3000`, served by `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-main-qa-20260828`. `git diff b19067658b04386ca6873ed1c9a9edfa87e4b0b6 -- apps/web packages/contracts pnpm-lock.yaml` returned no differences, confirming the relevant source matches latest develop checked above.
- Browser skill used for actual UI. Do not submit business records, alter gates, seed/reset data, change app code/package.json, or touch cloud/deploy/PR state. Preserve existing dirty worktrees and services.
Open questions: None for input/validation inspection.
Artifacts:
- This memory.
- Raw screenshots were intentionally removed from `docs/evidence/` during repository cleanup on 2026-08-29; the verified observations remain recorded below.
Verification:
- Actual typing (`pressSequentially`) in both fields on both pages preserves `0400`; pressing Tab does not normalize it. Clicking the description field separately also leaves leading-zero values visible. No automatic `0400` → `400` conversion exists.
- Manual `/companies/seed-local-company/expenses/manual`: unit price and discount retain `0400`, `aria-invalid` absent, no inline format message. `0.402` also remains visible, but each native input uses `step=0.01` and reports `validity.stepMismatch=true`; do not claim this manual form accepts three-decimal submission.
- Review `/companies/seed-local-company/expenses/cmtcznhag003mozk1s3ulrxl1` (existing local QA fixture): `0400` in either field sets `aria-invalid=true`, shows “กรอกเป็นตัวเลขธรรมดา ห้ามมีศูนย์นำหน้า ...”, and disables “ถัดไป”. `0.402` in either field has no format error, native step mismatch false, and enables Next. Each field was tested separately with a valid counterpart to avoid discount-above-price interference.
- Review original price `42.28` and discount `0` restored; reload showed these original saved values. No Next/save/confirm/payment action clicked, no business records created or updated. Unsaved manual entries were discarded by navigation.
- `pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/expense-review-validation.spec.ts`: PASS, 38 tests, 2 suites, 0 failures/skips. Run against exact develop snapshot before removing the temporary worktree; the reused app's source matches identical.
- Source: `apps/web/src/features/expenses/ExpensesPages.tsx:1264` keeps raw state; review inputs at 1751/1756; manual inputs at 2422/2423. `expense-review-validation.ts:173` checks both money fields; `packages/contracts/src/expenses.ts:463` defines the shared decimal pattern. PR #332 / `9efcebf2` is validation, not input normalization.
- Scope limit: actual create/save responses and other modules/pages were not exercised; no deployment status claim.
Next: Report that the UI leading-zero behavior remains. Review validation is fixed, manual validation is not equivalent. Implement normalization or unify validation only if the user explicitly asks for a fix.
