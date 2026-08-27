# Expense Check-bill Early Rejection and Guided Routing Implementation Plan

## Linked Spec

- Spec: [[specs/expense-check-bill-guided-routing-spec|Expense Check-bill Early Rejection and Guided Routing Spec]]
- Related source specs:
  - [[specs/business-document-image-intake-spec|Business Document Image Intake Spec]]
  - [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Related plans:
  - [[plans/substitute-receipt-first-use-ux-redesign-plan|Substitute Receipt First-use UX Redesign]]
  - [[plans/expense-no-invoice-substitute-routing-plan|Expense No-Invoice Substitute Routing]]
- Memory: [[agent-memory/expense-check-bill-guided-routing|Expense Check-bill Guided Routing Memory]]
- Owner request: 2026-08-24

## Current Delivery Slice — Full Web + API + LINE

Status: core delivered via PR #228; recovery completion integrated into develop on 2026-08-27 (verification and delivery SHAs in scoped memory).

### Recovery completion checklist (2026-08-27)

- [x] Inspect current develop and confirm the post-override inline dead end, uncoded failures, ambiguous copy and permissive-CASH check-bill proof gap.
- [x] Confirm owner direction: same expense/provenance; separate real payment proof for check bills only; no historical rewrite or live mutation.
- [x] Route all new preparation to the canonical wizard; preserve PREPARED edit/history/sign/approve and genuine misclassification/final receipt paths.
- [x] Make check-bill picker/deep-link/reload behavior consistent with API routing; never infer tax validity from a route or override.
- [x] Share the authoritative check-bill payment-proof predicate across API, wizard/inline edit and LINE readiness. Reject source/self, cross-purpose, inactive, unlinked and foreign evidence.
- [x] Return stable known eligibility/evidence codes and actionable UI copy; retain safe unknown fallback.
- [x] Verify focused API/web/contracts, guards/atomicity, desktop synthetic browser, and current develop integration; record evidence and the physical-mobile/CSP limitation in `docs/agent-memory/check-bill-recovery-completion.md`.

This completion supersedes references below to preserving the cash-policy exception for check
bills. Other cash expenses and issued historical certificates are unchanged. Deployment is outside
this delivery; old rollout checkboxes are not acceptance for a source-only integration.

- [x] Open unresolved check bills directly on the evidence step.
- [x] Explain in plain Thai that the document proves an amount due, not payment.
- [x] Ask whether payment has happened and offer final-receipt upload, unpaid guidance, or the dedicated substitute wizard; LINE creates no expense until paid/no-receipt is confirmed.
- [x] Hide the inline preparation action/form while classification is blocked.
- [x] Disable `ถัดไป` and replace the generic finance-override footer message for this case.
- [x] Support `?entry=new` so the temporary paid/no-receipt workaround opens the wizard on manual-new entry.
- [x] Keep finance misclassification correction available as a secondary disclosure.
- [x] Replace the temporary new-draft workaround with same-expense atomic preparation.
- [x] Implement the LINE check-bill pending-media decision without creating an expense before the answer.
- [x] Move the mobile recovery decision above generic detail and remove the blocking sticky footer for this state.
- [x] Remove stale/duplicate mobile actions and keep destructive actions secondary.
- [x] Stack wizard prerequisite copy and repair action on narrow screens; progressively disclose secondary legal detail.
- [x] Add LINE Quick Reply choices and shorten the paid continuation to one confirmation plus one next question.

The API remains fail closed. The completed slice must never ask the reviewer to create or cancel a duplicate expense.

## Purpose

Fix the Production dead end where an explicit web-uploaded restaurant check bill is visibly blocked as non-expense evidence but still exposes an inline substitute-receipt form that the API rejects only after the user completes it.

The implementation will reject the file early **as a receipt**, explain the reason in everyday Thai, ask one question at a time, and route an already-paid expense without a final receipt into the existing dedicated substitute-receipt wizard. It will preserve the original attachment/classification, avoid duplicate expenses, and keep all tax, evidence, signature, approval, permission, audit, and concurrency boundaries fail closed.

## Specialist Review Summary

### UX

- Replace accounting/AI terminology with the immediate user question: `คุณจ่ายเงินรายการนี้แล้วหรือยัง?`
- Make one primary action visible at a time.
- Keep business blockers persistent and inline, not toast-only.
- Remove the unsupported inline preparation form and use the dedicated wizard.
- Design mobile-first for low digital confidence: 16 px primary copy, 44 px controls, vertical actions, clear back/retry, no colour-only meaning.

### Solution architecture

- Define one bounded shared `ExpenseEvidenceDecision` contract.
- Add a distinct, audited `ROUTED_TO_SUBSTITUTE_RECEIPT` resolution for a paid check bill; commit it atomically with prepared evidence and do not disguise it as a finance misclassification override.
- Reuse the current expense and immutable attachment; do not create a replacement record.
- Keep backend authoritative and revalidate on every mutation.
- Permit raw `ORDER_OR_CHECK_BILL` in substitute eligibility only with a current valid route resolution; keep every other raw ineligible kind blocked.
- Return stable machine codes for all known eligibility failures.

### Development

- Use existing contract, controller, use-case, audit, optimistic-concurrency, wizard, i18n, and UI patterns.
- No dependency or speculative schema migration.
- Smallest safe code path: shared evaluator → API resolution → web guided card → canonical wizard → regression/E2E.

## Current Repository Context

### Existing patterns to reuse

- `packages/contracts/src/expenses.ts`
  - `isNonExpenseClassificationBlocking`
  - bounded classification-resolution validation
  - substitute-receipt contracts and limits
- `apps/web/src/features/expenses/expenses.model.ts`
  - `deriveExpenseClassificationReviewState`
  - review-step state derivation
- `apps/web/src/features/expenses/substitute-receipt-wizard.model.ts`
  - candidate eligibility
  - deterministic readiness evaluators
- `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx`
  - canonical first-use and preparation journey
- `apps/web/src/features/expenses/ExpensesPages.tsx`
  - extraction notice, document review, current duplicate inline prepare form
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`
  - guided stepper and final-action gates
- `apps/web/src/common/api/api-error-message.ts`
  - stable code-to-Thai mapping and safe fallback
- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`
  - finance classification resolution, review update, ready/confirm gates
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`
  - authoritative preparation eligibility
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`
  - compare-and-set, advisory lock, idempotency, and prepared-evidence transaction

### Confirmed current defects

1. `DocumentReviewSection.prepareBlockers` omits classification/raw-kind/source/tax/currency eligibility.
2. The inline `จัดทำใบทดแทน` toggle remains visible while classification is blocked.
3. Dedicated wizard candidate eligibility correctly rejects `ORDER_OR_CHECK_BILL`, but there is no explicit paid-without-receipt resolution that can make this one kind conditionally eligible.
4. API eligibility computes stable issue codes but throws most issues as an un-coded `BadRequestException(message)`.
5. Web safely discards the raw 400 message and therefore renders the exact generic Production toast.
6. Normal send/confirm is correctly fail closed; the defect is routing, explanation, and duplicated preparation logic.
7. At 390 × 844, the generic sticky footer covers the recovery card and can continue showing `เลือกคำตอบ` after an answer exists.
8. Mobile shows duplicate back/cancel/delete affordances while the user is trying to answer one recovery question.
9. The wizard prerequisite uses a horizontal row that compresses Thai helper copy into an unreadable narrow column.
10. LINE exposes text-only numbered choices and the paid path repeats the generic accounting blocker dump before the next question.

## Implementation Rules

- Follow `docs/plans/master-implementation-checklist.md`.
- Before code edits, read and follow the repository Ponytail skill in full mode.
- Use the smallest correct diff and existing patterns first.
- Do not add a package dependency or edit `package.json`.
- Keep route/controllers thin and domain decisions in pure/shared logic or use cases.
- AI classification remains suggestion-only; deterministic API gates own mutations.
- Preserve tenant, branch, permission, audit, source-state, and final-mutation boundaries.
- Do not weaken input-VAT, payment-evidence, signature, approval, or certificate issuance rules.
- Do not auto-delete or auto-reject the original expense.
- Do not deploy until the mandatory UAT/Production protocol has been read and recorded.

## Scope

### In scope

- Shared evidence-decision and route-resolution contracts.
- Deterministic evaluator used by web and API.
- Permission-checked, audited atomic preparation route.
- Conditional check-bill eligibility for the dedicated substitute wizard.
- Plain-Thai guided action card and role-aware states.
- Removal/retirement of the inline pre-prepare form.
- Stable API business-error codes and Thai mappings.
- Unit, integration, UI/model, E2E, mobile browser, and production-observability coverage.

### Out of scope

- OCR provider/model replacement.
- Generic document inbox.
- New notification workflow.
- Automatic payment recording.
- New tax/legal inference.
- Database migration unless implementation discovery proves the bounded existing summary cannot safely persist the resolution.
- LINE-side signing, approval, or final mutation.
- Eligibility changes for quotations, POs, delivery notes, appointments, bookings, non-financial, unreadable, ambiguous, or multi-document images.

## Product, Architecture, Implementation, and Integration Gates

### Product gate

- A first-time user can explain why the file is blocked and choose the next action without knowing accounting terms.
- Copy says the file cannot prove payment; it does not say the real expense is impossible to record.
- The paid-without-receipt path is an explicit human choice, not an AI inference.

### Architecture gate

- One shared decision determines allowed business actions.
- API revalidates company, branch, permission, status, classification fingerprint, reviewed facts, and optimistic revision.
- Original provenance remains immutable/visible.
- Route resolution and finance correction are distinct.
- A check bill can become supporting evidence only; it never becomes tax evidence by routing.

### Implementation gate

- The inline form cannot enable an API-rejected preparation.
- Known business failures always carry a stable code.
- No new dependency or duplicate evaluator is introduced.
- Focused tests cover the exact Production regression.

### Integration gate

- Backend-to-web contract, loading/error/permission states, dedicated wizard entry, refresh/back behavior, and mobile path all pass.
- Normal receipt, existing substitute, signing, approval, and issued-document flows remain unchanged.

## Phase 0: Confirm Decisions and Baseline

### Goal

Freeze the current behavior and owner decisions before code changes.

### Tasks

- [ ] Re-read the linked spec and source-of-truth specs.
- [ ] Read the Ponytail skill before any code edit.
- [ ] Capture the exact Production scenario as a fixture: restaurant check bill, positive `Total Due`, VAT/tax ID, no settlement signal.
- [ ] Record current API/web behavior and relevant deployed commit.
- [ ] Confirm the first-slice defaults:
  - reuse the existing expense;
  - preserve the original attachment/classification;
  - no schema migration;
  - web-owned resolution and canonical wizard;
  - ordinary cash policy remains unchanged; check bills require separate actual payment proof (2026-08-27 owner direction).
- [ ] Add/update task memory with baseline commands and evidence.

### Tests

- Existing focused model/API tests only; no change expected.

### Exit criteria

- Product and architecture decisions have no unresolved blocker.

## Phase 1: Shared Evidence Decision Contract

### Goal

Create one bounded decision used by all layers.

### Tasks

- [ ] Add `ExpenseEvidenceDecision`, reason codes, allowed-action enum, and `ExpenseEvidenceRoutingResolution` to `packages/contracts/src/expenses.ts`.
- [ ] Add a pure `deriveExpenseEvidenceDecision` (or equivalently named) evaluator.
- [ ] Validate the route resolution structurally:
  - outcome;
  - paid acknowledgement;
  - supported missing-receipt reason;
  - classification fingerprint;
  - bound total;
  - actor/timestamp; and
  - current source/tax compatibility.
- [ ] Treat unknown/malformed values as blocked.
- [ ] Keep `isNonExpenseClassificationBlocking` backward compatible for existing finance resolutions while accepting a current valid route resolution only where the caller supplies the required context.
- [ ] Avoid a second client-only taxonomy.

### Focused tests

- [ ] Check bill + no settlement → `ACTION_REQUIRED/CHECK_BILL_MISSING_SETTLEMENT`.
- [ ] Guest signature alone does not change the decision.
- [ ] Final receipt with settlement signals follows normal acceptance.
- [ ] Malformed/stale route resolution fails closed.
- [ ] Quotation/PO/booking/non-financial remain blocked.
- [ ] Unknown enum/state returns `NEEDS_REVIEW`.

### Exit criteria

- API and web can consume the same compiled contract and pure evaluator.

## Phase 2: Atomic API Routing and Eligibility

### Goal

Persist an explicit, audited route together with prepared evidence, without creating a duplicate expense, and make API errors actionable.

### Tasks

- [ ] Extend the existing preparation input with an explicit bounded check-bill route flag.
- [ ] Extend the existing preparation use case so it:
  - loads the tenant-scoped current expense;
  - asserts branch scope and mutable status;
  - checks optimistic `expectedUpdatedAt`;
  - derives the current evidence decision;
  - checks reviewed positive THB amount/date/description/category;
  - computes server-owned classification fingerprint, actor, and timestamp;
  - stores the bounded resolution while preserving original classification;
  - preserves the original source type/classification, and sets `SUPPORTING_ONLY` plus `NON_CLAIMABLE` in the same transaction that creates prepared evidence; and
  - writes a bounded HIGH-risk audit event.
- [ ] Reuse the current prepared-evidence transaction, advisory lock, idempotency, and CAS; do not add a second route endpoint.
- [ ] Update substitute eligibility:
  - default raw `ORDER_OR_CHECK_BILL` stays ineligible;
  - current valid route resolution permits it;
  - all other raw ineligible kinds remain unchanged.
- [ ] Change every known eligibility failure to `{ code, message }`.
- [ ] Keep `validateEligibility` before `createPreparedSubstituteEvidence` so rejected requests persist nothing.
- [ ] Ensure a changed classification/re-extraction before prepare invalidates the route attempt through optimistic revision.

### Focused tests

- [ ] Permission, tenant, and branch rejection.
- [ ] Mutable-status and stale-revision rejection.
- [ ] Correct route mutation is atomic and audited.
- [ ] Original classification/attachment remains unchanged.
- [ ] Check bill without resolution cannot prepare.
- [ ] Check bill with valid resolution can reach remaining payer/policy/evidence gates.
- [ ] Quotation with finance override still cannot prepare.
- [ ] Known errors include stable code.
- [ ] No persistence occurs after rejected eligibility.
- [ ] Concurrent duplicate request is idempotent or stale, never double-mutating.

### Exit criteria

- Direct API calls cannot bypass any business boundary and web has actionable codes.

## Phase 3: Guided Web UX and Canonical Wizard

### Goal

Give a first-time mobile user one understandable next decision and remove the dead-end form.

### Tasks

- [ ] Add pure web presentation mapping from `ExpenseEvidenceDecision` to plain Thai/English copy.
- [ ] Render a dominant check-bill action card in expense review:
  - `เอกสารนี้ยังไม่ใช่ใบเสร็จ`;
  - reason in one short paragraph;
  - `คุณจ่ายเงินรายการนี้แล้วหรือยัง?`;
  - primary/secondary/tertiary actions.
- [ ] Use progressive disclosure for paid → receipt available? → payment evidence/substitute route.
- [ ] Show suggested date/amount/description only as uncommitted prefills and require human confirmation.
- [ ] On the single visible continue action, save dirty confirmed facts through the existing review-fields API, reload/use its newest `updatedAt`, then prepare evidence with the bounded check-bill route flag. If preparation fails, keep the saved facts and offer retry without re-entry; the route resolution must not be persisted separately.
- [ ] Preserve field state on back/retry; do not use toast as the only error surface.
- [ ] Apply permission-aware behavior:
  - uploader/non-reviewer may upload a final receipt under existing ownership rules;
  - only reviewer sees route mutation and finance-correction actions;
  - readonly user sees waiting-for-finance copy.
- [ ] Move finance correction under `ระบบอ่านเอกสารผิด?` disclosure and remove `override` wording.
- [ ] Remove/hide only the inline **preparation** form from `DocumentReviewSection`; preserve current evidence status/history/continuation links.
- [ ] Make the dedicated wizard the only new-prepare form.
- [ ] Update wizard candidate eligibility to accept a valid routed check bill.
- [ ] Auto-select the original check-bill attachment as supporting evidence; do not mutate it into a receipt.
- [ ] Keep payment evidence separate and governed by method/company policy.
- [ ] Mark the document step as action-required, not passed/green.
- [ ] Map all new/previous substitute issue codes to actionable Thai/English.
- [ ] Meet 44 px touch targets, readable mobile text, focus, screen-reader, reduced-motion, and no-colour-only requirements.
- [x] Suppress the generic sticky footer while the check-bill decision owns the screen; keep cancel/delete under secondary disclosure.
- [x] Put the recovery decision before extracted/accounting detail at 390 × 844.
- [x] Stack wizard prerequisite text and action vertically on mobile and shorten the visible legal copy.
- [x] Add LINE Quick Reply choices with numbered fallback; after paid/no-receipt show one confirmation and one next question.

### Focused tests

- [ ] Presentation model returns exact card/action states for reviewer and non-reviewer.
- [ ] No inline prepare action exists while classification is blocked.
- [ ] Back/retry preserves answers.
- [ ] Final receipt action opens the existing upload path.
- [ ] Paid-without-receipt action deep-links with the same `expenseId`; preparation sends the route flag once and never creates a replacement expense.
- [ ] Dirty reviewed facts are saved before preparation; the atomic route resolution never receives or trusts unsaved totals.
- [ ] Known 400 renders code-specific inline Thai.
- [ ] Existing issued/prepared evidence views remain accessible.
- [ ] Thai and English dictionaries contain every new key.
- [x] At 390 × 844, no stale footer or duplicate navigation competes with the payment question.
- [x] LINE Quick Reply and typed `1/2/3` produce identical state transitions and idempotent outcomes.

### Exit criteria

- The Production screenshot journey cannot reach an enabled action that the API rejects for classification.

## Phase 4: Integration and E2E Regression

### Goal

Prove the full backend-to-mobile journey and protect adjacent expense flows.

### Tasks

- [ ] Add an E2E fixture based on the real check-bill shape.
- [ ] Cover exact user paths:
  - upload final receipt;
  - paid/no receipt with card proof;
  - paid/no receipt with transfer proof;
  - permissive cash policy;
  - strict cash policy;
  - unpaid web draft and LINE no-draft outcome;
  - finance correction; and
  - readonly/non-reviewer.
- [ ] Verify a check bill with user signature alone remains blocked.
- [ ] Verify a merchant final receipt re-enters the normal path.
- [ ] Verify no duplicate expense is created.
- [ ] Verify refresh, browser back, network retry, stale revision, and double tap.
- [ ] Verify normal receipt, tax invoice, provider-unavailable manual review, existing substitute signing/approval/issuance, and rejection remain unchanged.
- [ ] Run browser QA at 390 × 844 and desktop.

### Suggested verification commands

```bash
corepack pnpm --filter @watchdog-bms/contracts typecheck
corepack pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/expenses/domain/logic/expense-status.logic.spec.ts \
  src/modules/expenses/application/use-cases/expense-draft.use-case.spec.ts \
  src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts
corepack pnpm --filter @watchdog-bms/web exec tsx --test \
  src/features/expenses/expenses.model.spec.ts \
  src/features/expenses/substitute-receipt-wizard.model.spec.ts \
  src/common/api/api-error-message.spec.ts
corepack pnpm --filter @watchdog-bms/api typecheck
corepack pnpm --filter @watchdog-bms/web typecheck
git diff --check
```

Run the existing expense E2E harness with a focused `@check-bill-routing` tag after adding the scenario. Do not edit `package.json` merely to add a convenience script.

### Exit criteria

- Focused tests, typechecks, E2E, mobile browser QA, and adjacent regression paths pass with recorded evidence.

## Phase 5: UAT, Rollout, and Monitoring

### Goal

Release without reintroducing the dead end or weakening tax/evidence controls.

### Tasks

- [ ] Read `docs/runbooks/uat-production-v2-deployment.md` immediately before UAT/Production work.
- [ ] Deploy API support before or together with web.
- [ ] UAT with real Thai documents:
  - restaurant check bill with total due;
  - same bill with guest signature;
  - merchant final receipt;
  - card/transfer/cash payment evidence;
  - quotation and booking negative controls.
- [ ] Record exact UAT, READY, and Production run IDs.
- [ ] Require signed-result and customer `OPEN` acceptance before declaring complete.
- [ ] Monitor bounded metrics:
  - check-bill decisions;
  - action selections;
  - route success/failure codes;
  - generic substitute 400 count;
  - duplicate-expense rate; and
  - wizard completion from this entry point.
- [ ] Keep a rollback path that disables the new route action while retaining early explanation and fail-closed API behavior.

### Exit criteria

- Customer can complete the real scenario in Production, known generic 400s disappear, and no tax/duplicate regression is observed.

## Integration Verification Checklist

- [ ] Product goal, persona, main journey, exceptions, and acceptance criteria are explicit.
- [ ] Shared decision contract compiles across contracts/API/web.
- [ ] Data impact is additive and original provenance remains.
- [ ] Permissions, ABAC, audit, and optimistic concurrency are verified.
- [ ] UI loading/error/readonly/forbidden/empty states are verified.
- [ ] Dedicated wizard and API eligibility agree.
- [ ] Known business errors have codes and actionable messages.
- [ ] Mobile/desktop browser paths are verified.
- [ ] Adjacent receipt, tax, signing, approval, and confirmation flows pass.
- [ ] Verification commands/results are recorded in memory.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Users treat the route as permission to claim VAT | Force `SUPPORTING_ONLY` + `NON_CLAIMABLE`; persistent plain-language notice |
| Finance uses route as a classification override shortcut | Distinct outcome/audit; only check-bill route allowed; original kind preserved |
| Stale AI result remains accepted after re-extraction | Server-owned classification fingerprint and optimistic revision |
| Duplicate expense created during recovery | Reuse current `expenseId`; E2E asserts record count |
| Web/API drift returns | One shared evaluator and code-based API errors; remove duplicate inline prepare form |
| Low-confidence user cannot recover | One question/action at a time; persistent inline copy; back/retry preservation |
| Existing issued evidence UI disappears with inline cleanup | Remove only pre-prepare UI; regression-test evidence status/history/continuation links |
| Older web calls new behavior before API support | Additive contract; deploy API first/together; gate route action on supported response |

## Open Questions

No implementation blocker remains if the spec defaults are accepted. Escalate only if discovery proves that an additive bounded resolution cannot be safely stored in the current review summary or if Product wants unpaid supplier-bill/AP management included in this slice.
