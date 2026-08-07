# Agent Memory: business-document-image-intake

Status: Implemented and locally verified 2026-07-13; live provider/LINE calibration smoke pending
Owner: thawatchai / Codex
Scope: Cross-domain image/document classification and routing for shared LINE and web Expenses; receipts, bills, quotations, appointments, bookings/reservations, payment evidence, signatures, other/non-financial, unreadable, and multi-document images.
Decisions:
- Global document classification stays separate from expense `SourceDocumentType`.
- A receipt requires printed positive transaction total plus receipt/settlement evidence; quantity-only item lists are never receipts.
- Shared LINE classifies before expense draft creation. Router/provider unavailable plus uncaptioned media clarifies instead of creating an expense.
- Quotation, appointment, booking, and reservation images receive review guidance only; no official accounting/CRM mutation from image classification.
- Web explicit Expenses upload keeps its draft/attachment but non-expense classifications apply no financial fields.
- Manual web upload uses the same final workflow boundary: unresolved/malformed `NOT_EXPENSE_DOCUMENT` blocks mark-ready and confirm in UI and API. Finance must explicitly acknowledge, choose a reviewed expense document type, and enter a 1–500 character reason; ordinary edits cannot silently override.
- Preserve the original classification/status after finance override. Store one bounded `FINANCE_OVERRIDDEN_AS_EXPENSE` resolution, expose it in web, and record `expense.classification.override` as a distinct HIGH-risk audit event.
- Reuse Typhoon + configured model, current attachment/pending-media paths, and runtime permissions. No new provider, dependency, generic document table, or classification migration.
Open questions:
- Live provider calibration thresholds may need adjustment after a representative Thai document image set is available; first code slice uses deterministic missing-evidence gates and review fallback.
Artifacts:
- `docs/specs/business-document-image-intake-spec.md`
- `docs/plans/business-document-image-intake-plan.md`
- `packages/contracts/src/line-ai.ts`
- `packages/contracts/src/expenses.ts`
- `apps/ai-gateway/src/modules/line-ai/domain/logic/business-document-classification.logic.ts`
- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/expenses/domain/logic/expense-document.logic.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`
- `apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts`
- `apps/api/src/modules/expenses/presentation/http/expense.controller.ts`
- `apps/web/src/features/expenses/ExpensesPages.tsx`
Verification:
- Parallel repo/business audits completed 2026-07-13; both identified create-before-classify and receipt-assuming prompt/contract as root causes.
- Claude CLI private-repo consultation/editing was blocked by platform data-exfiltration policy even after owner approval. A sanitized no-files architecture consultation was attempted separately.
- Focused AI Gateway classification/router/controller tests: 44/44 passed.
- Focused API LINE/expense extraction/domain tests: 83/83 passed.
- Full regression after manual-web follow-up: AI Gateway 344/344 (unchanged gateway), API 1865/1865, web 266/266 passed.
- `@watchdog-bms/contracts`, `@watchdog-bms/ai-gateway`, `@watchdog-bms/api`, and `@watchdog-bms/web` typechecks passed.
- `git diff --check` passed.
- Browser smoke reached the local login UI and the real dev-login request path with web and API running on ports 3000/3001. The seeded login endpoint returned HTTP 500 in the current local runtime, so an authenticated Expenses-page smoke could not be completed; API/web workflow acceptance remains covered by the focused and full automated suites above.
- Business re-review fixed three integration defects before acceptance: receipt must be `PAID` with settlement and matching amount signal at the API gate; users without capture permission cannot read an existing expense through media redelivery; unpaid check bills no longer receive a false “missing total” explanation.
- Manual-web recheck found and closed an advancement bypass: extraction already applied no fields, but an unresolved non-expense draft could still mark ready/confirm. Focused API proof after all review fixes: 47/47; web expense logic: 7/7. The final guard fails closed on malformed/legacy overrides, preserves the original classification, requires finance acknowledgement/reason, verifies the endpoint is protected by `expense.review`, and verifies confirmation emits one outbox event only after valid resolution. Independent final review also found and closed a reviewer permission mismatch: `expense.review` roles now use a reviewer-protected mark-ready route, while own-draft `expense.update` keeps its existing route.
Next:
- Run live configured-provider + real LINE smoke using at least a valid receipt, quantity-only food order, unpaid check bill, quotation, appointment/booking confirmation, ordinary photo, blurred image, and two-document image.
- Calibrate model confidence only from labeled false-positive/false-negative evidence; deterministic missing-total/settlement/permission gates remain fixed.
