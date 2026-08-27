# Agent Memory: Reimbursement no future dates

Status: Implemented; final integration verification in progress (2026-08-27).
Owner: /root/reimbursement_no_future_dates
Scope: User-confirmed incurred dates on reimbursement lines only, on
`codex/reimbursement-no-future-dates` from `origin/develop` `3b8bfd137db0786441874214acce9a41eb5c2137`.

Decisions:

- Follow ponytail full from the repo skill (legacy absolute path is unavailable): reuse
  ThemedDate bounds and contracts civil-date helpers; no dependency or package.json change.
- Today/past incurred dates are allowed; future calendar dates are rejected using the existing
  reimbursement business timezone, Asia/Bangkok, independent of browser/server timezone.
- Keep date-only inputs and existing ISO/Date read/update paths. Reject malformed calendar
  dates; do not clamp stored dates or mutate historical approved claims.
- Validate create, replacement-line draft updates and submit of existing drafts before any
  mutation. Keep ownership, branch, evidence, entitlement, receipt and approval checks intact.
- UI create/edit uses a maximum and Thai-business-day Today shortcut. All generic picker
  selections honor explicit min/max, including Today/This month; unconstrained pickers retain
  future selection. Payment dates, appointments, due dates and filters are outside scope.
- Date errors identify the line and tell the requester to correct the date; legacy future
  drafts remain visible/editable/cancellable. Shared toast and inline copy must agree.

Acceptance / plan:

1. Add one shared incurred-date rule using existing civil-date helpers; call it from API line
   validation and frontend validation. Wire the picker bounds and close its Today bypass.
2. Cover today/past/future, malformed input, month/year changes and Bangkok-midnight boundaries;
   prove create/update/submit reject before persistence and correction succeeds.
3. Verify picker bounds on a safe local browser harness if available, including mobile and a
   browser ahead/behind Bangkok; verify receipt/approval/access regressions.
4. Record evidence, commit scoped files, refetch/integrate develop and push without force.

Open questions: None. User explicitly confirmed the date task after the earlier wording ambiguity.
Artifacts: Reimbursement journey spec, shared contract rule, API/domain validation, web form/picker,
error translation and focused regression tests.
Verification:

- First focused run: web/contracts 146 tests (31 suites) passed; API 179 tests (36 suites) passed.
  Includes the shared date rule, malformed dates, leap/month/year boundaries, four host timezones,
  Bangkok midnight, actual create/update/submit use cases with no mutation on rejection, correction,
  and real client/fetch/toast-bus error-code translation (message-only and code-only HTTP bodies).
- Expanded final pre-integration run: web/contracts 176 passed (32 suites), API 208 passed
  (40 suites), 8 PostgreSQL race checks skipped because no DATABASE_URL was configured. No database
  connection or fixture was created. Expanded coverage includes branch/related-access guards and
  the existing authed-fetch error/refresh/CSRF behavior.
- Browser skill used for actual components in a local synthetic Next page at port 4350, no DB.
  A 2099 draft remained visible/unclamped; save named line 1; Today selected 27 August 2026 and
  28–31 were disabled; a past date remained selectable. Mobile 390×844 screenshot confirmed the
  full calendar and Today footer fit. Explicit business-day overrides ahead/behind browser today
  selected their correct date and respected max. Generic min/max blocked both day cells and Today;
  past-month max disabled This month; an unconstrained picker still selected 28 August.
- Synthetic HTTP 400 left the corrected date in the form and showed the reviewed inline error;
  executable client tests additionally prove one matching toast and no retry. No real submission.
- Added REIMB-06 to the existing E2E suite. `playwright test e2e/reimbursements.spec.ts --list
  --grep REIMB-06 --project chromium` finds it. Full signed-in DB-backed E2E not run: local
  synthetic component/browser checks plus use-case tests were used, not a live customer account.
- Web typecheck passed. API typecheck after generating Prisma ONLY into this worktree's own
  `apps/api/src/generated/prisma` reports missing installed `@aws-sdk/client-ses` at auth.module.ts
  and ses-auth-mailer.adapter.ts only; no remaining diagnostics in changed files. No package edit
  or shared generated-output write was performed to work around the unrelated dependency gap.
- Local fixture routes were removed with apply_patch, generated next-env restored, the browser
  viewport restored and tab closed, and the local Next process stopped.

Next: Refetch/merge current develop, rerun focused checks, commit and push scoped work without force.
No live DB, UAT, Production, permission sync, deployment or cloud operations were performed.
