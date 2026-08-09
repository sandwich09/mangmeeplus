# Agent Memory: CR-11 Civil Date Year Bound

Status: COMPLETE — verified
Owner: Codex
Scope: Reject far-future Gregorian/Buddhist-era years on the shared `CivilDate` contract and every expense write path that uses it.
Decisions:
- Accept Gregorian civil dates through 2100. Keep the lower range unchanged so historical legal facts are not rejected by an unrelated fix.
- Thai/Buddhist-era input must be converted to CE before reaching the wire; `2569-03-15` must never be stored as CE 2569.
- Date-only strings rejected by `isCivilDate` must not be reparsed by `coerceCivilDate` as instants.
- Receipt upload validates the date before creating an upload intent, preventing an orphan intent on invalid input.
Open questions:
- Existing rows dated after 2100 are not rewritten. Run a read-only production data audit before deploy and repair any hits through an approved data-correction plan.
- Banking statement import remains the separate H-27 finding: its parser does not use `CivilDate` and needs explicit BE-to-CE handling.
- Reimbursement, accounting-document, procurement, employee, and data-rights DTOs still use generic `IsDateString`/`Date` validation. They are outside the shared `CivilDate` path and should be handled as a follow-up cross-module year-bound sweep rather than expanding this expense fix speculatively.
Artifacts:
- `packages/contracts/src/civil-date.ts`
- `packages/contracts/src/civil-date.spec.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts`
- `apps/api/src/modules/expenses/presentation/http/expense.dtos.spec.ts`
Verification:
- `corepack pnpm --filter @watchdog-bms/contracts build` — pass.
- Built contracts test set via `node --test packages/contracts/dist/*.spec.js` equivalent explicit list — 118 pass, 0 fail. (`tsx` package runner could not open its IPC socket in the sandbox.)
- Expense upload + DTO focused tests — 30 pass, 0 fail.
- Broader expense branch/capture/upload focused tests — 50 pass, 0 fail.
- API exception filter focused tests — 12 pass, 0 fail.
- API `tsc --noEmit` is blocked by pre-existing errors in untouched substitute-receipt, reimbursement-related-access, and report spec files; no error points to this change.
Next:
- Before production deploy, audit persisted date columns for years after 2100 and open a reviewed correction plan if any rows exist.
- Handle H-27 bank-import conversion and the remaining generic date DTOs in separate scoped changes.
