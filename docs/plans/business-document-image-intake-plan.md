# Business Document Image Intake Plan

Status: Implemented and locally verified (2026-07-13); live provider/LINE calibration smoke pending

Spec: [[specs/business-document-image-intake-spec|Business Document Image Intake Spec]]

Memory: [[agent-memory/business-document-image-intake|Business Document Image Intake Memory]]

## Product Evidence

- Current defect: a food order/check image with quantities but no monetary amount can be reported as a receipt and create an expense draft.
- Required families: receipt, bill/invoice, quotation, appointment, booking/reservation, transfer slip, signature, other/non-financial, unreadable, and multi-document.
- Safe first slice: classify and route; only the existing expense and signature paths may create draft/ticket records. Commercial and scheduling images get guidance/deep links only.

## Architecture Evidence

- Shared LINE media currently enters `executeReceiptUpload` regardless of actual document purpose.
- Intake router has no cross-domain business-document route.
- Receipt OCR stage 2 assumes receipt/tax invoice and its contract has no classification.
- Media expense draft is created before OCR, and router unavailability falls through to draft creation.
- Existing numeric cross-check proves a number occurs in OCR text but does not require a transaction total or payment evidence.
- Web explicit expense upload already owns a draft before extraction; that path must stop applying fields for a non-expense classification rather than deleting user data.

## Implementation Decision

Use the existing two-stage Typhoon + configured-model path. Add one bounded classification to the existing OCR result, one pure deterministic evidence gate, and one pure API route decision. Do not add a dependency, provider abstraction, generic document table, or automatic accounting/CRM mutation.

## Phase 1: Add contracts and pure gates

1. Extend `packages/contracts/src/line-ai.ts` with global business-document classification enums/types and additive OCR classification output.
2. Add a small pure classifier/gate near AI Gateway receipt OCR that:
   - validates enum/bounded model output;
   - requires a positive cross-checked transaction total for expense evidence;
   - requires settlement/receipt evidence for `RECEIPT`;
   - forces quantity-only/no-total documents to `ORDER_OR_CHECK_BILL`;
   - never upgrades weak evidence.
3. Add a small pure API decision that combines router plan, OCR classification, caption presence, and provider availability into `expense | reference | clarify | unsupported`.

Focused proof:

- Quantity-only order is never receipt/expense eligible.
- Receipt requires total plus settlement evidence.
- Quotation/appointment/booking/reservation/non-financial kinds never produce expense route.
- Unknown enum/low confidence/contradiction downgrades to review/clarify.

## Phase 2: Make prompts neutral and bounded

1. Change receipt OCR stage-2 prompt from an assumed receipt extractor to one business-document classifier/extractor.
2. Return classification plus the existing receipt fields; omit irrelevant fields.
3. Require bounded evidence signals and reason codes; do not return raw chain-of-thought or unbounded OCR text.
4. Extend parser and existing numeric cross-check without adding keyword dictionaries or a second model call.
5. Extend LINE intake router with one `BUSINESS_DOCUMENT_REFERENCE` route and bounded document hints, rather than one intent per document type.

Focused proof:

- Router accepts only known kinds/reasons.
- Low-confidence draft/signature behavior remains clarify.
- Image bytes stay in provider image input, not JSON/audit text.
- Prompt injection inside the image remains data.

## Phase 3: Decide before shared-LINE expense creation

1. Download media once.
2. For JPEG/PNG expense candidates, run document OCR/classification before `initReceiptUpload`.
3. Use the pure decision:
   - accepted expense evidence -> existing upload/complete/draft/apply flow;
   - quotation/appointment/booking/reservation/order/non-business -> no expense, bounded reply;
   - unavailable/uncertain uncaptioned media -> existing pending-media clarification, not expense fallback;
   - explicit expense caption plus unavailable classifier -> existing manual-review confirmation path may remain.
4. Preserve company/message idempotency and signature ticket behavior.
5. Audit only bounded kind/reason/status, never raw OCR/image/provider data.

Focused proof:

- No init/complete/create calls for order-only, quotation, appointment, reservation, or generic photo.
- Valid receipt still uploads once, creates one draft, and applies the same validated fields.
- Router unavailable + no caption persists/clarifies and creates no expense.
- Redelivery creates one decision/record.

## Phase 4: Gate web expense extraction

1. Add `not_expense_document` to `ExpenseExtractionResult`.
2. In `RequestReceiptExtractionUseCase`, inspect deterministic classification before `ReceiptOcrApplyService.apply`.
3. Keep the explicit expense draft/attachment, write a bounded review summary, apply no vendor/money/line fields, and return classification to web.
4. Add Thai/English UI notice explaining the detected non-expense kind and next action.
5. Fail closed in both mark-ready and confirm while `NOT_EXPENSE_DOCUMENT` has no structurally valid finance resolution.
6. Add an explicit `expense.review` override route requiring acknowledgement, a reviewed non-`NEEDS_REVIEW` expense document type, and a 1–500 character reason. Preserve the original classification/status and record a distinct HIGH-risk bounded audit event.
7. Mirror the boundary in web: disable advancement, show finance-only override controls, show a waiting state to other users, and retain the original AI classification plus resolution after reload.

Focused proof:

- Web quotation/order/appointment image remains attached but money/vendor/lines are not auto-keyed.
- Unresolved or malformed non-expense classification cannot mark ready or confirm through UI or direct API.
- Incidental document-type edits do not override; a valid finance acknowledgement/reason unblocks and remains auditable.
- Valid receipt behavior is unchanged.
- Provider unavailable remains manual review.

## Phase 5: Business and tax consistency

1. Tighten receipt tax-evidence derivation so `VALID_RECEIPT_FIELDS` cannot be reached without accepted receipt classification and monetary evidence.
2. Keep transfer slip `SUPPORTING_ONLY`, quotation/scheduling/non-business `NOT_TAX_EVIDENCE` or `NEEDS_REVIEW` as appropriate.
3. Do not add global kinds to expense `SourceDocumentType`; map only accepted expense-family kinds.
4. Use runtime `crm.booking.*` permission names in new docs/logic; do not introduce stale `crm.appointment.*` keys.

## Phase 6: Verification and review

Run at minimum:

```bash
corepack pnpm --filter @watchdog-bms/contracts typecheck
corepack pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts src/modules/line-ai/agents/line-intake-router.agent.spec.ts
corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts src/modules/expenses/domain/logic/expense-document.logic.spec.ts
corepack pnpm --filter @watchdog-bms/ai-gateway typecheck
corepack pnpm --filter @watchdog-bms/api typecheck
corepack pnpm --filter @watchdog-bms/web typecheck
git diff --check
```

Review evidence must explicitly cover:

- Product taxonomy and route matrix.
- Backend-to-frontend classification contract.
- Permission/final-mutation boundaries.
- Loading/error/provider-unavailable states.
- Existing signature, receipt, pending-media, redelivery, and customer-OA separation behavior.

## Rollout

- No schema migration or config change is expected.
- Deploy API + AI Gateway + web together because the additive contract and UI notice span all three.
- Keep current AI provider kill switches and manual review available.
- Smoke with a real receipt, quantity-only food order, quotation, appointment/booking confirmation, unrelated photo, and blurry image before production-ready claim.

## Exit Criteria

- Quantity-only food order never creates or labels a receipt/expense automatically.
- Valid expense evidence retains the current reviewable draft journey.
- Cross-domain documents are recognized without autonomous accounting/CRM mutation.
- Provider-unavailable uncaptioned images fail closed to clarification.
- Focused tests and package typechecks pass.
- Source-of-truth docs, checklist follow-up, and memory record actual evidence and any remaining live-smoke gap.

## Implementation Evidence — 2026-07-13

- Additive global classification contract and `BUSINESS_DOCUMENT_REFERENCE` route implemented.
- Neutral OCR prompt, strict bounded parser, exact OCR-span validation, receipt hard gate, and quantity-only downgrade implemented in AI Gateway.
- Shared LINE now classifies before `initReceiptUpload`; unavailable uncaptioned media clarifies; reference documents create no expense or CRM/accounting record.
- Web Expenses keeps the explicit draft/attachment but applies no fields for rejected classifications and shows Thai/English next-action guidance.
- Manual web upload advancement now uses the same fail-closed boundary: unresolved `NOT_EXPENSE_DOCUMENT` blocks mark-ready and confirm in UI and API; only a finance reviewer can use the explicit acknowledged/reasoned override endpoint. The original classification remains stored and visible, while a distinct HIGH-risk audit event records the bounded resolution.
- Root review added API settlement/amount re-checks, fixed the redelivery permission boundary, distinguished no-total orders from unpaid check bills, and updated older LINE fixtures to the new fail-closed contract.
- Focused suites: AI Gateway 44/44, initial API intake 83/83, final API manual-web guard 47/47, and web expense logic 7/7 passed.
- Full regression suites after the manual-web follow-up: AI Gateway 344/344 (unchanged gateway), API 1865/1865, and web 266/266 passed.
- Contracts, AI Gateway, API, and web typechecks passed; `git diff --check` passed.
- Local browser smoke rendered the login UI and reached the real dev-login request with web/API running on ports 3000/3001. The seeded login endpoint returned HTTP 500 in the current runtime, so authenticated Expenses-page smoke remains pending rather than being claimed as passed.
- No schema migration, new dependency, autonomous quotation/booking mutation, or customer-OA boundary change was introduced.
