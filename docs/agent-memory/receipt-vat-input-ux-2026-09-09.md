# Agent Memory: Receipt VAT input and warning UX

Status: exact-head CI passed; PRs #500 (develop) and #501 (main) merged. UAT 34307378432 failed before rollout; native image pin repair in progress on codex/receipt-sharp-runtime-pins-20260909. Owner authorized both merges and UAT deployment; Production remains held.
Owner: Codex.
Scope: document/line VAT source unit changes, global number-input spinners, VAT spacing, operator tax preview, warning navigation.

## Decisions and plan

- An explicit change of VAT source unit starts new source fields empty. Do not reuse source amounts/rates or infer document evidence from calculated line rates. Changing document mode also removes old per-line sources; changing one line leaves other lines intact. Existing accounting line rates remain unchanged until explicitly edited.
- Test NONE, RATE, AMOUNT, BOTH and per-line transitions through the same payload used for preview/save. Required values must be visible; NONE uses system calculation without demanding hidden source fields. API source validation remains authoritative; no schema/migration or tax-rule changes.
- Make the VAT unit label a block so existing vertical spacing applies. Keep the established form layout and themed dropdown.
- Hide number spinners with global CSS, preserving number semantics, decimal steps and keyboard entry.
- For expense entry, omit the duplicate technical per-line tax/account/report summary; document VAT and totals cards already show the amounts used for the receipt. Preserve tax setup warnings/errors and validation. This avoids presenting the unadjusted fuel line base 2,252.07 as the document base 2,252.06.
- Render the validation navigation as a yellow warning with readable text and a focusable link to the invalid input. Preserve real validation and draft behavior.

## Verification

- Web model/validation/page QA/tax model: 143 passed, 0 failed. Command: `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test apps/web/src/features/expenses/expenses.model.spec.ts apps/web/src/features/expenses/expense-review-validation.spec.ts apps/web/src/features/expenses/ExpensesPages.qa.spec.ts apps/web/src/features/expenses/ExpenseReviewPage.qa.spec.ts apps/web/src/features/tax/transaction-tax.model.spec.ts`. Log `/tmp/receipt-vat-ux-tests.log`.
- API draft amount/preview suite: 26 passed, 0 failed. Command: `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/expenses/application/use-cases/expense-draft-amount-validation.use-case.spec.ts`. Log `/tmp/receipt-vat-ux-api.log`.
- Web TypeScript and `git diff --check` passed. Initial command without web tsconfig could not resolve `@/`; corrected invocation above. Initial typecheck caught a missing shared helper import; corrected before browser verification.
- Actual React form + freshly compiled global stylesheet + real API use case/DTO validation, isolated in-memory repository: `/tmp/receipt-precision-browser/vat-ux.cjs` passed 390/1280px, OS dark preference (app remains its existing light theme), header/per-line unit switches, exact preview/save payload, persisted snapshot readback and Next to step 2. No original UAT receipt was mutated. Re-selecting the same unit preserves evidence; changing one line does not create required values on other lines.
- Number inputs retain `appearance: textfield`, numeric semantics and original min/max/step; global CSS imported once by root layout covers all web routes. Chromium screenshots checked visually; Firefox uses standard appearance plus `-moz-appearance`, Safari/WebKit uses the native spin-button selectors. Firefox/Safari engines were not separately run.
- Warning yellow/background and text colors checked in rendered CSS, link focuses actual invalid amount/rate (including per-line). Dropdown-to-field spacing is at least 10px. Screenshots `/tmp/receipt-precision-browser/vat-warning-390.png` and `vat-warning-1280.png`.
- `/tmp/receipt-precision-browser/tax-copy.cjs` proves the real tax selector still resolves tax and displays configuration errors while omitting duplicate technical line amounts/account/report counts only for expense records. No tax calculation, backend permission, DTO contract, DB schema or migration change.
- Browser checks found the old per-line value handler reintroduced the hidden automatic-rounding row as a source entry; it now excludes that row consistently with the unit switch helper.

## Release prerequisite: dependency security fixes

- Exact-head CI runs 34305163212 / 34305165959 on df5e046fc2bd54c55e2eeb83c44347ac8a49c570 failed the existing HIGH security audit: newly published Next.js, sharp, multer, js-yaml and SVGO advisories. No audit waiver or check change.
- Upgrade only affected dependencies/overrides: Next.js locked 16.3.4, sharp 0.35.4, multer 2.3.0, js-yaml 4.3.2, SVGO 3.3.5, and required transitive/native packages. Next generated its new root-params type reference during the build; its AppRouterInstance also requires bfcacheId, so the existing notification test router fixture supplies a stable test value. No package scripts or metadata edits.
- Installed in the isolated worktree after unlinking its own shared dependency/dist symlinks; the user's root dependency installation was preserved.
- `pnpm security:audit` PASS: zero HIGH/CRITICAL (13 moderate and 1 low remain below the existing gate). Lockfile frozen install PASS.
- Updated dependencies: production Next webpack build PASS (including actual SVG loader); focused web tests 143 PASS; API upload/attachment/preview tests 64 PASS; AI image/controller tests 73 PASS. Web typecheck, the 3 notification render tests, and actual React/API browser tests at 390/1280px also PASS with the upgraded dependencies. Evidence `/tmp/mangmee-vat-ux-uat-20260909/`.

## Previous READY failure resolved

- Previous UAT 34271465242 passed. READY 34273932168 remains FAILED and is not promoted to a valid signed READY by this investigation.
- Read-only CloudTrail and exact resource lookups prove the migration rehearsal passed, DB deletion succeeded, and the failure was a transient RDS endpoint timeout during cleanup readback. Reconstructed A5 result validates both pending migrations, schema and compatibility as PASSED.
- Repeated current readback: clone DB, source snapshot, managed secret and task ENI absent; unique task definition revision 1 INACTIVE; no active task under the exact startedBy. No IAM change, retry, new clone or manual deletion was needed. Evidence `/tmp/mangmee-receipt-precision-uat-20260909/cleanup-readback-current.json`, `ready-cloudtrail-safe.json`, `recovered-clone-result.json`.
- New release is permitted after exact-head CI/merge. Ledger `/tmp/mangmee-vat-ux-uat-20260909/release-ledger.json` will record candidate/controller, UAT/READY IDs, signed artifacts and post-deploy acceptance. Production is HELD for separate explicit approval.

Next: finish exact-head CI, merge reviewed candidate into develop and main, single canonical UAT deployment, then runtime/signature and actual browser acceptance. Preserve original user tabs and receipt edits; use an isolated synthetic UAT draft for write/readback tests.

## Release execution (operator record)

- Candidate `580da9c896ebf526aac3c70766e78d6f388a9dde`; successful exact PR CI `34306044254` / `34306044546` (actual tests, DB, security and config checks passed).
- develop merge `86f60cd5247f356771386847544437160f039bae`; main/controller `e878ab1cbb2913e13854a43cd230ed483500d466`; all three file trees identical and candidate reachable in both branches.
- UAT `34307378432`, attempt 1, target all, controller verified; no other active UAT/READY/Production run at dispatch. Final UAT AWS preflight passed. Main frozen. No Production dispatch.
- Synthetic draft `cmttjb3ob013k1z4jwk7aokyv` in Drtb, label `UAT VAT UX TEST 580da9c8`, initial 107.00, prepared through authenticated UI for post-deploy save/readback testing. Customer original receipt and user tabs preserved.
- This operator record is local evidence; do not push a new controller commit during READY.

## UAT image-build failure and repair

- UAT `34307378432` attempt 1 terminal FAILED before runtime rollout; no valid new Passport/READY. Previous deployed source remains `4e78ccc28551a454754573fcb9768d818a49af02` until a successful new release.
- First failure: AI Docker COPY still referenced native sharp 0.35.3 / libvips 1.3.2 while the security dependency fix locked 0.35.4 / 1.3.3. Local JS tests/build did not exercise the Linux COPY paths. The security test repeated the old literal pins and therefore missed the drift.
- Small repair: update all three native-copy Dockerfiles (API, combined API/Web, AI), replace literal version assertions with a guard matching both native packages against pnpm-lock.yaml, and regenerate the existing maintenance hashes. Workers/release tools have no such COPY path. Workers were cancelled by the image matrix after AI failed; both release-tool jobs completed their existing build/verification boundaries. No runtime, IAM, migration or security-policy relaxation.
- Regression proof: new guard fails immediately against old Docker paths with the upgraded lockfile (`native-pins-regression-before.log`). Actual Linux/amd64 AI image build, its in-image sharp rotate/JPEG check and exported-filesystem allowlist pass. API/Web image and full release-security checks are being verified before a new exact-head CI and release; no blind UAT retry.
- Repair evidence remains under `/tmp/mangmee-vat-ux-uat-20260909/`. Main may advance for this repair only after terminal failed UAT; it will be frozen again at the next dispatch. Production remains held.

- Local combined image build initially found the development-only generated-client symlink copied from this worktree (ENOTDIR); removed only that symlink, preserving its root target, and rebuilt using the same clean-source generation path as CI. No repository code change for that local setup issue.
