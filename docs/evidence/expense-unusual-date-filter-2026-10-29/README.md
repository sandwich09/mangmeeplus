# Expense unusual-date filter — 29 October 2026

## Result and scope

Read-only UAT reproduction: receipt OR670318000742 showed 18 March 2024 and an unusual-date warning, but March 2024 was empty. Searching its number in October 2026 found it with intake date 29 October 2026. `implausible` dates were incorrectly grouped with unread placeholders in the shared query.

The correction uses an unusual document date for discovery, retains its warning, and leaves `expenseDateIsReadable` and confirmation/source-completion guards unchanged. Shared list/evidence filtering, folders, accountant export date/status and highlighted navigation agree. Only `unverified`/legacy missing dates fall back to the Bangkok intake date. No schema, financial mutation, package dependency or customer-data rewrite.

## Verification

- API focused suites: 178 passed, no skips. Export (old and future date with `implausible` warning), receipt OCR and evidence/branch scope.
- Source-draft completion guard: 8 passed, including rejection of unresolved `implausible` and `unverified` dates.
- Web model/navigation/page checks: 130 passed, no skips. Existing unreadable-date acceptance semantics preserved.
- Real PostgreSQL focused regression: 1 passed, no skips; 9 fixtures cover legacy, verified, assumed, unread, implausible, 18 March 2024, future 18 March 2028, matching day/month list and evidence folders, and explicit intake-date queries. Neighboring days exclude the March receipt.
- API compile with `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec tsc --outDir dist/expense-date-filter`: exit 0. Initial duplicate import found and removed before this successful final build.
- Web `pnpm exec tsc --noEmit`: exit 0. `git diff --check`: clean.

Commands run from `apps/api`:

```sh
pnpm exec tsx --test --test-reporter=spec src/modules/expenses/domain/logic/expense-export.logic.spec.ts src/modules/expenses/infrastructure/prisma-expense.repository.posting-source.spec.ts src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts
pnpm exec tsx --test --test-reporter=spec src/modules/expenses/domain/logic/expense-source-draft.logic.spec.ts
# With the disposable local DATABASE_URL:
pnpm exec tsx --test --test-name-pattern="same document month" --test-reporter=spec src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts
```

Commands run from `apps/web`:

```sh
pnpm exec tsx --test --test-reporter=spec src/features/expenses/expenses.model.spec.ts src/features/expenses/expense-list-navigation.logic.spec.ts src/features/expenses/ExpensesPages.qa.spec.ts
pnpm exec tsc --noEmit
```

## Actual Chrome acceptance

Local web 3080 and real API 3081 with disposable database `expense_date_filter_20261029`, cloned from the retained synthetic fixture. A local paid shop was activated in this clone only. No OCR or external provider was called.

1. Normal password login succeeds. March 2024 shows the old document, its total and warning at 390 pixels (01).
2. Open the row and press the existing back link: March 2024 and the highlighted row remain at 1280 pixels (02).
3. Press the month picker and `เดือนนี้`: October 2026 shows only the unread-date fixture, with no invented document date (03).
4. Search TEST-20240318 in October: empty result. Press the picker, previous year twice, March: the same search finds the dated receipt (04).
5. No horizontal overflow at 390, 1280 or 1536; desktop sidebar open. Status-chip groups are equal width/height. Existing chips measure 36 px high (below the current general touch-target guideline); this patch changes no layout/style/button component and does not claim to fix that pre-existing issue.

Limitations: the minimal local fixture has no receipt attachment and its detail totals preview is unavailable; only navigation through that page was accepted, not financial review. The UAT detail itself was inspected read-only. No complete receipt review/payment/export-download journey, native LINE test, UAT/Production deployment or live data edit is claimed. Source guard and export contracts were exercised by the focused tests above.

Screenshots contain synthetic local data. Temporary viewport override was reset and the local account signed out. Task-started API/web and three local data containers are stopped after acceptance; fixture database remains for recovery. The owner's UAT tabs and original checkout are unchanged.
