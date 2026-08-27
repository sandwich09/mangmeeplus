# Agent Memory: Vendor Bill Supplier Source Number

Status: LOCAL CAPTURE ACCEPTANCE PASS; isolated branch `codex/vendor-bill-source-number` initially from `origin/develop` `d2b40f37`. Final submit-scoped implementation passes full AP6/6 and web1126/1126, actual Chrome desktop/mobile checks and read-only persisted draft verification. Integration/CI pending; no main or deployment claim.
Owner: Codex implementation agent; root owns review, repo E2E and real Chrome sessions.
Scope: Capture-first direct vendor-bill form: expose the existing optional supplier document number and translate its duplicate rejection; fix verified supplier-name contract drift and label existing direct-entry controls in plain Thai. No subscription, connectors, reconciliation, P28 credit/approval policy, schema or backend behavior changes.

## Current evidence and contract

- [Capture-first scope](mangmee-capture-first-scope.md) keeps purchase/payment/source-document capture active; [canonical procurement spec](../specs/procurement-supplier-ap-spec.md#vendorbill) distinguishes nullable `supplierDocumentNumber` from `taxInvoiceNumber` and scopes uniqueness by company+supplier.
- `AccountsPayablePages.tsx:260` contains the only `CreateVendorBillForm`; its only caller at `:466` requires both `procurement.vendor_bill.create` and `procurement.vendor_bill.direct_entry`. Its only `createVendorBill` call omits the source number.
- `accounts-payable.api.ts:23` already accepts the contract's optional field and uses the existing authenticated/CSRF client. `CreateVendorBillDto` (`procurement.dtos.ts:287`) accepts an optional string up to 80 characters. Route-company and direct-entry permission checks remain authoritative.
- `vendor-bill.use-case.ts` passes the field to `prisma-procurement.repository.ts:898`; same-company/supplier exact-number duplicates produce `ConflictException('duplicate_supplier_document_number')`. `schema.prisma:4714` additionally has the three-column unique constraint; absent numbers remain null and may repeat.
- Nest's string conflict body reaches `authedApiFetch` as `Error(message)` plus status409; the mapper checks known message/code before its generic status fallback. The fixed Prisma P2002 translation also names exactly `companyId, supplierId, supplierDocumentNumber` when that unique constraint reports its fields. No existing mapping covers these source-number errors.

## Scoped spec / acceptance before implementation

1. Show a visible, associated Thai label "เลขที่เอกสารผู้ขาย (ถ้ามี)" and help explaining that absence is allowed and this does not replace tax-invoice evidence. Reuse `mangmee-input`; input maxLength80, disabled without create permission or while saving.
2. Send trimmed outer whitespace as `supplierDocumentNumber`; blank/whitespace-only means omit the field, not a placeholder. Preserve case/internal characters and never populate `taxInvoiceNumber` from this input.
3. Map only the exact source-number duplicate diagnostic/code and exact known unique-field diagnostic to useful Thai guidance to inspect the existing bill. Do not relabel unrelated409/permissions or automatically retry a duplicate.
4. Keep the entered number after rejection so the user can inspect/correct it. Preserve all money, tax, matching, approval, permission and no-number policies.
5. Registered unit coverage checks exact error shapes, no-number/length/separate-tax DTO contract; existing `e2e/accounts-payable.spec.ts` adds real form entry, persisted readback, duplicate409 with Thai reason, and repeated blank-number creation. Root executes E2E; this agent only lists cases.

### Real-Chrome follow-up acceptance (recorded before code)

- Root's actual browser found all supplier names blank: the form cast an `any` API result to `{ displayName }`, but `SupplierSummary.displayNameSnapshot` and the server's `ListSuppliersUseCase` are authoritative. `listSuppliers` has exactly two web callers: this form and `ProcurementPages.SupplierList`, which already renders `displayNameSnapshot` but uses `any` state/map.
- Type the shared list response as existing `PaginatedProcurementResult<SupplierSummary>`, use `SupplierSummary[]` state in both consumers, and remove the incorrect form cast / supplier-list map `any`. Do not invent a fallback name or change the default first-active-supplier selection, 100-row cap, endpoint, guards or handler semantics.
- Give existing supplier, purchase context, document date, due date, description, quantity and THB unit-price controls visible Thai labels and accessible names using the existing components. Use plain Thai form heading, submit and success copy. Keep values, tax behavior, matching and approval untouched; do not modify the global tax selector.
- Strengthen AP-03 before creation: inspect the actual browser supplier response, assert displayed selected/default supplier name plus visible option labels, choose that visible option and assert the POST's `supplierId` equals its response ID. Update AP-03/AP-04 to use named direct-entry controls and the Thai submit label; verify labeled dates/quantity as well. Existing API-created AP-01/AP-02/AP-20 stay registered.
- Root owns live dev/HMR, real Chrome and E2E. This agent only edits isolated source/docs/tests and runs non-browser checks/listing; preserve root-generated `apps/web/next-env.d.ts` runtime diff.

### Mobile submit-error follow-up acceptance (recorded before code)

- Real Chrome at 390×844 reported duplicate409 text correct and source number preserved, but the alert was above the viewport (top=-553, bottom=-467) while the user remained at the submit/footer area. Root captured `docs/evidence/vendor-bill-source-number/mobile-duplicate-before-focus-fix.jpg`.
- Reuse the existing `SubstituteReceiptWizardPage` focus pattern: scroll the committed target into view, then focus with `preventScroll:true`; use the shell's existing `--app-header-h` plus space as scroll margin. Keep this form's error summary local, focusable with `tabIndex=-1` and `role=alert`; do not rewrite global ErrorBanner, request handlers, guards or money/tax logic. No animated scrolling is needed.
- Extend AP-03 to assert the default supplier name, then select a second visible supplier when available and retain exact name/options plus POST/readback-ID verification. Before the duplicate retry switch to 390×844 and submit from the button area; require actual alert focus and full viewport bounds below the header, not only `toBeVisible`.
- Refresh the manual playbook's stale direct-entry form title/copy. Existing ThemedSelect summary controls have correct `aria-label` accessible names but are not native labelable controls: visible-label tap-to-focus is not claimed, and no global select rewrite is in scope.
- The initial Opus verdict was REQUEST_CHANGES: selected-option checkmark assertion and exclusion of generated next-env from staging; no initial production blocker was reported. The later focus change was not covered by that review.

### Submit-scoped focus acceptance (recorded before code)

- Bounded Opus follow-up verdict: REQUEST_CHANGES. Valid finding: the effect depended on all `error` changes, so a supplier-list GET failure could steal focus/scroll even without a submit. Add a monotonic submit-failure signal, increment only in the submit catch, and trigger focus only for a nonzero signal change. Keep root's `outline-hidden` class and existing `setError('')` at submit start. The review's same-error/stale-success claim does not describe that existing clearing behavior; the repeat-duplicate test below explicitly covers the intended focus outcome twice.
- AP-03 requires at least two active suppliers in the existing local QA seed/list (root observed >80), chooses fixed index1 after checking the initial index0 label, and keeps all exact name/ID assertions. Use only the form panel's direct-child alert. At390×844 submit the same duplicate twice from the button area; each attempt must focus the alert and keep it inside the viewport below a real company banner whose count, visible height and bottom are positive.
- Prove existing header configuration rather than adding fallback CSS: `apps/web/app/globals.css:63` defines `--app-header-h:68px`. Capture computed alert scroll margin/header variable and measured banner bounds in the E2E assertion; root records actual Chrome proof.
- Add AP-05 using the existing harness: delay and fulfill only the supplier GET with403, focus an existing control at a stable scroll position, then release the response and assert the displayed error does not change focus/scroll. No form submission or financial mutation.
- Root owns active vendor dev session38639 and all real E2E/browser execution. This agent only changes scoped source/docs/tests and runs focused unit/TypeScript/discovery; no server, commit or rebase operation.

Plan:
- Add the field/payload and exact shared error mapping; no new component or harness.
- Extend existing registered unit/E2E files, then run offline dependency setup, build/typecheck and non-DB unit tests.
- Hand off uncommitted changes and exact E2E grep; record evidence before merge.

Decisions: AGENTS and ponytail full read; the legacy skill path is absent, so use the available repo skill. No package/dependency changes. Do not touch the P24 worktree.
Open questions: None for this bounded UI contract; backend concurrency/normalization and P28 policy are not changed or claimed solved.
Artifacts: This memory; direct vendor-bill form; shared API error mapper; typed supplier-list API/consumers; existing unit and accounts-payable E2E files. No backend behavior/schema/dependency changes.

## Verification — 2026-08-27

- `corepack pnpm install --offline --frozen-lockfile --ignore-scripts` — pass; no manifest/lockfile diff.
- `corepack pnpm --filter @watchdog-bms/config build && corepack pnpm --filter @watchdog-bms/contracts build` — pass.
- `corepack pnpm --filter @watchdog-bms/web typecheck` — pass (`next typegen && tsc --noEmit`).
- From `apps/web`: `corepack pnpm exec tsx --test src/common/api/api-error-message.spec.ts src/features/accounts-payable/accounts-payable.logic.spec.ts src/features/accounts-payable/accounts-payable.model.spec.ts` — 49/49 pass, zero skipped.
- From `apps/api`: `corepack pnpm exec tsx --test src/modules/procurement/presentation/http/procurement.dtos.spec.ts` — 32/32 pass, zero skipped; DTO/ValidationPipe only, no database.
- `corepack pnpm exec playwright test e2e/accounts-payable.spec.ts --project=chromium --grep 'AP-0[34]' --list` — finds both UI-entry regressions; listing only, no browser/server started.
- `git diff --check` — pass. No DB, cloud, browser, commit or push operation performed. No P24 worktree file touched.

### Follow-up verification after real-Chrome findings

- Re-read AGENTS and ponytail full. Traced both `listSuppliers` consumers plus server `ListSuppliersUseCase` and shared contract; no caller uses the incorrect `displayName` cast now. Supplier state/rendering in both consumers uses `SupplierSummary` without blanket casts.
- From `apps/web`: `corepack pnpm exec tsc --noEmit` — pass. Used existing generated route types and deliberately did not run `next typegen` over root's dev runtime.
- From `apps/web`: `corepack pnpm exec tsx --test --test-reporter=spec src/common/api/api-error-message.spec.ts src/features/accounts-payable/accounts-payable.logic.spec.ts src/features/accounts-payable/accounts-payable.model.spec.ts src/features/procurement/procurement.logic.spec.ts` — 55/55 pass, zero skipped. The previous 32/32 DTO result remains applicable; no DTO change in this follow-up.
- `corepack pnpm exec playwright test e2e/accounts-payable.spec.ts --project=chromium --list` — all five AP cases discovered. AP-03 now verifies real response names, rendered selection/options and the submitted/persisted supplier ID; both entry tests use accessible Thai field/action names.
- No old English create-form heading/submit/success strings remain in web/E2E. `git diff --check` passes. Root's generated `apps/web/next-env.d.ts` modification is preserved and not part of this agent's source edits.
- Root's first revised full AP run: 4/5 pass; AP-03 failed at the option text assertion because `toHaveText` included the selected option's decorative `aria-hidden="true"` checkmark (`✓`). The run rendered 82 options for 82 returned suppliers, and the first supplier name was correct. This is an assertion mismatch, not a supplier contract regression.
- Test-only correction: retain exact option-count and per-index name comparisons against every returned supplier, but use each option's accessible name so the explicitly hidden checkmark is excluded. Keep the displayed selection and submitted/persisted supplier-ID assertions unchanged. Production source remains frozen; root owns the next execution.

### Mobile focus correction verification

- Form-local error summary now uses a ref/effect to scroll into view and focus (`preventScroll:true`), with `scroll-margin-top: calc(var(--app-header-h) + 1rem)`. Existing shared ErrorBanner and all request handlers/guards/money/tax logic are unchanged.
- AP-03 preserves exact full-option name checks, verifies the default name, then selects the second row when available and verifies its submitted/persisted ID. Duplicate submission runs after switching to 390×844 and scrolling to submit; assertions require focus, alert top below header+8px, bottom inside viewport, and no horizontal clipping. Source-number preservation remains asserted.
- From `apps/web`: `corepack pnpm exec tsc --noEmit` — pass; the same four focused web suites — 55/55 pass, zero skipped.
- Full AP `--list` — five tests found; `git diff --check` — pass. Actual execution is reserved for root; no claim that the new viewport/focus assertion has passed yet.
- Manual playbook §11.4 now names the Thai form/fields/action and covers the visible source identity, optional number and mobile error-focus outcome. The non-native label-tap limitation above remains explicitly outside this bounded fix.

### Submit-scoped correction verification

- Production focus now depends on `submitErrorRevision`, initialized0 and incremented only by the submit catch. The background supplier-list catch still displays its error but cannot trigger focus. `setError('')` at submit start and root's `focus-visible:outline-hidden` remain unchanged.
- AP-03 requires two active QA suppliers (no silent fallback), checks all exact accessible option names, selects index1, verifies persisted supplier ID, then repeats the same duplicate twice at390×844. Both retries check the direct-child form alert, real positive banner bounds, computed CSS header variable/scroll margin, viewport containment, focus and preserved input.
- AP-05 is a UI-only403 response-path regression using the existing route-fulfillment pattern: supplier GET held until an existing control has focus at scroll0, then released; after passive effects settle, focus/scroll must remain unchanged. No bill submit or financial write occurs in this test.
- From `apps/web`: `corepack pnpm exec tsc --noEmit` — pass; same four focused web suites — 55/55 pass, zero skipped. Full AP `--list` now discovers six tests, including AP-05; `git diff --check` passes.
- Root's prior AP5/5/web1126/1126 results are recorded as prior-version evidence, not proof of the new signal/AP-05 behavior. The latest six-case E2E, computed Chrome header/margin evidence and review remain root-owned and pending. No server, browser, commit, push or rebase operation performed by this agent.

## Parent acceptance — 2026-08-27

- Final source: **AP6/6 PASS**, full web **1126/1126 PASS**, procurement DTO **32/32 PASS**, zero skipped; web typecheck and diff check pass. This supersedes the author-only and five-case statuses above.
- Actual Chrome1280×900/390×844: entered source/description/125.50, selected the named Thai supplier, and retried the same known duplicate twice on mobile then desktop. Both mobile attempts focused the alert at top84/bottom170 below header68, computed margin84; desktop top84/bottom130. Input retained, no horizontal overflow, warning/error log empty. One interim click was refused because HMR had reset the unsaved form after source edits; the final frozen form was refilled before acceptance.
- Read-only local SQL after all duplicate attempts proves one retained DRAFT `cmtay6ucu0066tak1roc4ke68` for `CHROME-CAPTURE-20260827-01`, supplier `seed-supplier-beauty-supply`, netPayable125.5000 and no taxInvoiceNumber. No approval/payment/posting or shared-data deletion. E2E's ordinary labeled drafts are retained.
- [Evidence and reproduction](../evidence/vendor-bill-source-number/README.md) includes before/after screenshots; screenshots were visually inspected, not treated as substitutes for API/SQL assertions.
- Root accepted the corrected focus implementation after the Opus REQUEST_CHANGES: submit-only revision resolves background focus theft; same-error repeat is proven twice; actual positive banner/CSS computed assertions resolve the weak test. The existing global68px CSS token is verified, so no speculative fallback was added. `setError('')` already clears at submit start, disproving the conditional stale-error claim. No final Opus APPROVE verdict is claimed; root's code/E2E/Chrome review is the acceptance.

- Rebased onto current develop `78057e3848414190b5803d89658aee83b0b51420` after P24/partner-copy merges; scoped form/API/E2E source is unchanged by rebase. Post-rebase **AP6/6**, full web **1129/1129, zero skipped**, typecheck and diff check PASS. The count includes three additional merged partner-copy tests. Screenshots above remain the exact pre-rebase captures, not images from the later test run.

Next: Push/open PR; merge only after exact-head CI succeeds. Native select label-tap, full P24, P28 accounting policy and physical-device/human acceptance remain separate.
