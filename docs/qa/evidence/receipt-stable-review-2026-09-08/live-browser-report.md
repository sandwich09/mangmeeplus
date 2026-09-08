# Live UAT Drtb browser test — 2026-09-08

Result: **BLOCKED before final submission**, despite successful release infrastructure checks. Owner unlocked the Mac and asked to continue testing and report. No application code, deployment, Production setting or gate was changed during this test.

Tested the actual logged-in owner `sandwich` in Drtb, using the AMERICANO - ICED receipt for 55 baht. Company `cmtrt5rkc00j51o487luy5b2i`, expense `cmtrycweh001d231i4jexgvri`; deployed candidate `67773ad3244560b606c250e6cdbc65d36acd1bb7`. These identifiers are support evidence only, not proposed customer copy.

## Observed browser journey

| Check | Actual result |
| --- | --- |
| Original form | Ordinary PANDA MALA three-step review form; no second source-draft form or redundant missing-data overview |
| Original receipt date | Enlarged image reads 07 ก.ย. 26 09:42; payment description also shows 7/9/2026. Selected 2026-09-07 through the visible calendar |
| Before date entry | Date visibly blank with inline guidance; Next disabled |
| Draft save | Clicked บันทึกแบบร่าง; actual toast: บันทึกแบบร่างแล้ว กลับมาแก้ไขต่อได้ |
| Persistence | Reloaded actual page; date remains 7 ก.ย. 2569 and purpose stays blank |
| Financial preservation | Quantity1, accepted tax-exclusive price51.40, VAT3.60, total55.00 and meals category retained |
| Dropdown | Opened actual category selector; white/green theme and Thai options, current meals option selected; made no selection change |
| Navigation | Next successfully saves and advances step1 → step2 → step3 with purpose blank; draft-save button absent in step2/3 |
| Final review | Warning still says ยังไม่ระบุวันที่เอกสาร although heading shows the saved date; ส่งตรวจสอบ disabled |
| Duplicate check | Invoked visible check, loading ended, submission remained disabled. No exact API duplicate verdict inferred from the lack of a visible result |
| Console | Available browser error/warn log entries were empty; the failure is a business-state blocker, not an observed console exception |

Data effects: saved the original document date, left purpose blank, and invoked duplicate checking. Expense remains a draft; did not force the disabled button, submit, confirm, pay, delete or edit through a direct API. Saving and fresh browser reload verify application persistence; **no direct live database inspection or raw response capture was performed in this resumed test**. This test used desktop Chrome; earlier mobile tests were local synthetic evidence.

## Cause and affected boundaries

1. The update use case resolves `expenseDate` in `missingFields` when a date is supplied, then writes the actual date. It does not update `dateStatus` or retire the old date-specific review reason: `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:649` and `:711`.
2. Source-draft summary synchronization spreads the previous AI summary and refreshes only missing-field/question/collection metadata: `apps/api/src/modules/expenses/domain/logic/expense-source-draft.logic.ts:246`. The combined save persists that summary at `expense-draft.use-case.ts:827`.
3. The shared reader deliberately gives an explicit stored `dateStatus` priority over `missingFields`: `packages/contracts/src/line-ai-value-normalizer.ts:96`. Therefore clearing the missing field does not clear an earlier unreadable status.
4. Step completion still requires `expenseDateIsReadable` (`apps/web/src/features/expenses/expenses.model.ts:1346`). The final button is disabled when that data step is not done (`ExpenseReviewPage.tsx:714`). The audit warning uses the same stored date status (`expenses.model.ts:1201`). This code chain explains the observed saved-date/blocked-submit contradiction; it is code-backed diagnosis, not a claim that the raw live JSON was read.

Adjacent UX findings: after saving, the AI banner says it read everything while retaining the old reason that the date could not be read. The disabled submit tooltip generically asks for vendor/date/items and points to step2, even though the data form is step1 and the date has been supplied. A user cannot resolve this by repeatedly filling the visible form. Other receipts with explicitly unreadable/implausible AI date state may encounter the same class of blocker; this test proves only this Drtb record.

## Why previous tests missed it

The incomplete-date E2E fixture sets `missingFields: ['expenseDate', 'vendorName']` but omits an explicit `dateStatus` (`e2e/receipt-draft-continuity.spec.ts:47`). Its browser test really does click ส่งตรวจสอบ, assert the reviewer-mark-ready POST and read DB READY_FOR_CONFIRMATION (`:152`), rather than bypassing the UI. However, without explicit dateStatus, the fallback changes to verified once missingFields clears, so that fixture cannot reproduce this live state. The file contains no explicit dateStatus fixture. The real PostgreSQL source-draft suite also does not specify dateStatus.

## Corrective direction — not implemented in this test

- Reuse the current authorized save transaction to reconcile a manually supplied valid source date with current verification metadata, retaining audit provenance. Clear only resolved date warnings; retain unrelated AI findings.
- Keep the protection against treating the upload-day placeholder as an actual receipt date. Do not simply ignore dateStatus or enable the button whenever the NOT NULL date column has a value.
- Use consistent current validation for the form, Next, final review and API transitions. Any genuine blocker must name the visible field and correct step in human-readable Thai.
- Add an explicit unreadable dateStatus plus stale date reason to browser/API/PG fixtures. Cover a manually chosen date equal to the stored fallback, changed dates, reload, source-only and combined saves, optional blank purpose and the actual final UI click. Retain tenant/permission/stale-write checks.
- Verify how existing manually corrected drafts can recover via supported saves; do not blanket-mark historical placeholders verified or patch live database rows without a scoped recovery decision.

Production remains held. Resolve and verify this blocker before customer-journey acceptance, then use a fresh verified candidate/readiness chain and obtain the owner's new Production approval.

## Actual UAT captures

- [Original date](live-browser/drtb-01-original-date.png)
- [Save success toast](live-browser/drtb-02-draft-saved.png)
- [Category dropdown](live-browser/drtb-03-category-dropdown.png)
- [Saved date with blocked final submission](live-browser/drtb-07-date-present-submit-blocked.png)
