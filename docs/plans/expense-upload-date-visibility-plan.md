# Expense Upload-Date Visibility Plan

## 1. Status

v0.3, 2026-08-15. **Implemented and locally verified.**

The approved implementation is complete. No schema, migration, dependency, permission, controller, accounting, ledger or tax behavior changed.

Authority: [[specs/expense-upload-date-visibility-spec|Expense Upload-Date Visibility and Late-Document Tag Spec]]

Related plans/specs:

- [[plans/expenses-mangmee-reskin-plan|Expenses Mangmee UI Reskin Plan]] — current layout must be preserved.
- [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] — existing `uploadedAt` contract and Evidence date lenses.
- [[specs/date-time-correctness-spec|Date-Time Correctness Spec]] — Asia/Bangkok civil date boundary.

## 2. Purpose

Keep a newly entered expense visible in the month it entered the system even when the source document is dated in an earlier month, and show a derived cross-month lateness tag without changing accounting/tax semantics or redesigning the existing page.

## 3. Product and Architecture Evidence

Discovery completed 2026-08-15:

1. The bug is caused by the main list sending `fromDate/toDate`, which the repository applies to `expenseDate`.
2. `uploadedAt`, upload-range query parameters, serialization and a company index already exist.
3. Evidence Panel already proves both dates can coexist and defaults to upload-date folders.
4. Main-list KPI cards consume the loaded cohort, so their semantic changes with the query.
5. Main-list export explicitly uses document date and must stay accounting-oriented with clearer copy.
6. Server order must switch to `uploadedAt desc` when using an upload range; client sorting alone fails under the current 200-row cap.
7. Reimbursement projections and API/manual expenses use `uploadedAt` as system intake even without a file, requiring generic “ส่งเข้าระบบ” wording.
8. No database migration, dependency, permission or new endpoint is required.
9. Web upload creates the Expense at upload intent, while manual and substitute-new flows create it at draft save.
10. Substitute evidence added to an existing Expense must retain the original Expense intake; its hub uses payment/expense month independently.
11. Reimbursement attachment upload/submit does not create an Expense. Projection creation occurs at manager or finance approval and is the projected Expense's intake time.
12. LINE direct media and text notes create Expense rows immediately, but clarified media stores the attachment first and can create the Expense up to 30 minutes later.

## 4. Scope

### In scope

- Main Expenses day/month query uses `uploadedFromDate/uploadedToDate`.
- Server ordering follows `uploadedAt` for that query.
- Existing date/source cell and mobile card show document date plus system-intake date.
- Pure, Bangkok-correct `เอกสารย้อนหลัง X วัน` derivation.
- Tag on desktop and mobile only when document and intake months differ and intake is later.
- Intake-cohort helper copy for period/KPI/empty state.
- Explicit document-date copy for accountant export.
- Focused API/web tests and one end-to-end/browser path.
- Cross-channel regression coverage for web upload, manual, substitute existing/new, reimbursement projection and LINE direct/text/clarified paths, proportional to the touched logic.
- Documentation/memory updates after implementation evidence exists.

### Out of scope

Everything in spec §13, especially accounting/tax period changes, schema changes, UI redesign, other modules' tags and the 200-row aggregation redesign.

## 5. Expected Files

No `package.json` change.

| File | Intended change |
| --- | --- |
| `apps/web/src/features/expenses/ExpensesPages.tsx` | Upload-range list query; date/tag rendering; intake and export lens copy placement |
| `apps/web/src/features/expenses/expenses.model.ts` | Pure late-document derivation helper |
| `apps/web/src/features/expenses/expenses.model.spec.ts` | Helper unit cases |
| `apps/web/src/common/i18n/workspace-dictionary.ts` | Thai/English copy |
| `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts` | Conditional server ordering by upload date |
| focused expense repository spec | Query filter/order/scope regression cases |
| relevant E2E expense spec if stable fixture support exists | Upload month/document month journey |
| `docs/agent-memory/expense-upload-date-visibility.md` | Implementation evidence and final status |

Contract/schema/controller files should remain untouched unless discovery during implementation disproves the verified facts. If that happens, stop, update the spec and request a new decision before widening scope.

## 6. Implementation Sequence

### Step 0 — Approval gate

- Owner reviews and signs off spec decisions D1–D6 and rules R1–R10.
- Confirm no request to make the main-list export follow upload date.
- Confirm canonical domain wording `วันที่เข้ารายการค่าใช้จ่าย` and compact row wording `ส่งเข้าระบบ` for the technical `uploadedAt` field.
- Confirm clarified LINE media is grouped by Expense creation/confirmation month (recommended). If original media-arrival month is required, stop and revise scope/tests before implementation.
- Confirm a reimbursement projection is grouped by projection-creation month, not claim receipt-upload, draft or submission month.

Do not start code changes before this gate.

**Evidence to close Step 0:** record the approved decisions and any changed wording in the spec and task memory. A chat assumption or an implementer's interpretation is not sufficient evidence.

**Rollback/stop rule:** no code exists to roll back. If any decision changes D1–D6/R1–R10, revise the spec and plan first and keep implementation stopped.

### Step 1 — Pure date/tag logic

Add one pure helper in `expenses.model.ts`, for example:

```ts
lateDocumentDays(input: Pick<ExpenseSummary, 'expenseDate' | 'uploadedAt'>): number | null
```

Requirements:

- parse `expenseDate` as its civil `YYYY-MM-DD`;
- convert `uploadedAt` with shared `civilDate` in Asia/Bangkok;
- return positive whole days only when the month keys differ;
- return `null` for same month, invalid input or non-positive difference;
- no new date library.

Focused unit cases:

1. 20 June → 10 August = 51;
2. 31 July → 1 August = 1;
3. 1 August → 31 August = null;
4. equal dates = null;
5. document after intake = null;
6. Bangkok midnight boundary (`2026-07-31T17:30Z`) = 1 August;
7. malformed value = null rather than render a broken tag.

**Precondition:** baseline `expenses.model.spec.ts` passes before the helper is added.

**Proving sequence:** add the seven assertions first and run only that spec to capture the expected red result because the helper is absent; implement the pure helper; rerun to green. Review the diff to confirm no rendering, API or persistence code changed in this step.

**Evidence to close Step 1:** exact focused command, failing assertion summary before implementation, passing count after implementation and a diff limited to the helper plus its spec.

**Rollback:** revert only the helper and its seven tests. No stored data or schema cleanup is required. If shared civil-date primitives cannot express the rule without changing their public behavior, stop and revise the plan rather than broadening this step.

### Step 2 — Main-list query and server ordering

Web:

- preserve `periodRange(gran, month, day)`;
- send the resulting values as `uploadedFromDate/uploadedToDate` from `ExpenseListPage.load`;
- do not also send `fromDate/toDate`;
- keep branch, page-size and permissions behavior unchanged.

API repository:

- if an upload range is present and no document range is present, order by `uploadedAt desc` before `skip/take`;
- otherwise retain existing `expenseDate desc` behavior;
- add a deterministic tie-breaker only if consistent with existing Prisma patterns;
- do not infer a new accounting date.

Repository verification should prove the generated `where` still ANDs company, branch scope, own/related scope and upload range.

**Precondition:** characterize the current repository behavior before editing. There is no existing focused test that pins `listExpenses` upload-range ordering; this is a verified coverage gap, so a new repository spec is mandatory.

**Proving sequence:**

1. add a repository test where an older `expenseDate` has the newest `uploadedAt` and more rows exist than the requested page size;
2. prove the test fails under document-date ordering;
3. implement conditional upload ordering;
4. prove the new row is returned first and `skip/take` sees that order;
5. prove a no-range/document-range call still orders by `expenseDate`;
6. prove company + branch + own/related scope predicates remain combined with the upload range;
7. add/adjust the web request assertion so the main list sends only `uploadedFromDate/uploadedToDate` while export still sends `expenseDate`.

**Evidence to close Step 2:** red/green focused repository result, captured query arguments for both upload-range and no-range calls, focused web request assertion, and diff limited to main-list request construction/repository order plus tests.

**Rollback:** revert the main-list request keys and repository order together. They form one compatibility unit; reverting only one side recreates hidden or wrongly sorted rows. No data rollback exists because this step performs no migration or mutation. Stop if controller/contracts/schema changes become necessary; that contradicts discovery and needs a revised spec.

### Step 3 — Existing-design UI additions

Desktop:

- keep `GRID` and all five columns/actions;
- show `วันที่เอกสาร` and `ส่งเข้าระบบ` in the existing date/source cell;
- retain capture-source badge;
- render one existing-style amber `MangmeeBadge` when the helper returns days.

Mobile:

- keep the existing card and click target;
- show both dates and the same tag without horizontal overflow;
- preserve status and amount prominence.

Accessibility:

- tag text is visible text, not color-only or tooltip-only;
- no new icon-only action;
- existing row/card navigation remains keyboard/click equivalent.

**Precondition:** Step 1 helper and Step 2 query contract are green. Capture desktop and mobile screenshots of the current row/card before editing so layout preservation is observable, not remembered.

**Proving sequence:** render fixtures for no tag, same-month/no-tag, 51-day tag and long vendor/category text at desktop and mobile widths; assert both date labels and tag text in DOM; keyboard-open the same row/card; compare screenshots for column order, actions, amount/status prominence and overflow.

**Evidence to close Step 3:** before/after screenshots, DOM assertions for the two dates/tag, responsive result and accessibility interaction result. A visual statement without screenshots or DOM evidence does not close the step.

**Rollback:** revert only row/card/copy rendering while retaining the already-proven query/helper if product copy or layout is rejected. The main list would still be discoverable by intake month but without the additive display; record that temporary state and do not release until the accepted UI is restored.

### Step 4 — KPI and export semantics

- Update period/KPI subcopy to say that the rows/cards are documents sent into the system in the selected period.
- Update empty state to reference sent-into-system time.
- Keep `createAccountantPackage(... dateField: 'expenseDate' ...)` unchanged.
- Update adjacent export helper copy so it explicitly says the export is by document date for the selected day/month.
- Do not rename `accounting_period`, change VAT/WHT logic or modify exported columns.

**Precondition:** capture the existing export request payload and existing KPI fixture result before copy changes.

**Proving sequence:** assert list rows/KPI are built from the intake-range response; assert export still calls `dateField: 'expenseDate'`; inspect the network request or API-client spy for both operations; confirm no tax, ledger, export logic or contract file appears in the diff.

**Evidence to close Step 4:** one list-request payload, one export-request payload, KPI/copy assertion and scoped diff inspection. If export follows upload date or KPI is presented as an accounting-period total, the step fails.

**Rollback:** copy changes can be reverted independently. If list/export semantics cannot be made understandable with copy, stop release and return to product design; do not silently align them by changing accounting export behavior.

### Step 5 — Focused verification

Run the smallest relevant checks first:

1. web expense model unit tests;
2. focused API repository/list filter test;
3. web typecheck;
4. API typecheck;
5. relevant web test suite if focused runner broadens automatically;
6. browser/E2E scenario at desktop and mobile widths.

Required journey:

```text
selected month = August
create/upload expense in August
set/correct document date to June
return to list
row remains visible in August
row shows both dates + late tag
open row still reaches same detail
```

Also verify:

- same-month document has no tag;
- branch-scoped user sees no other-branch row;
- adding supporting evidence later does not move the row;
- Evidence Panel uploaded/document switch is unchanged;
- export request still sends `dateField=expenseDate`.

Cross-channel journeys:

1. web upload: OCR correction to an older month retains the upload-intent month;
2. manual: save with an older date, with and without a successful optional attachment;
3. substitute existing: prepare/sign/approve without changing the Expense intake month;
4. substitute new: create an old-dated manual Expense and confirm its intake month;
5. reimbursement: approve/materialize an old `incurredDate` line and confirm only the projected Expense enters the approval month;
6. LINE direct and text note: old extracted/entered date remains in the capture month;
7. LINE clarified media: pin the owner-approved month-boundary behavior.

Source-surface regression checks must prove the Substitute Receipt hub/candidate scan and Reimbursement Mine/Approval/Finance queues did not inherit the main Expenses upload-range filter.

**Precondition:** Steps 1–4 are individually green and their evidence is recorded. Use isolated fixture identifiers and dates calculated in `Asia/Bangkok`; do not depend on a hard-coded current month.

**Evidence to close Step 5:** command, environment/fixture prerequisites, pass/fail totals and screenshot/network/DB evidence for the required journey. Every skipped journey needs an exact blocker and must leave its acceptance criterion open; “inspected code” is not runtime verification.

**Rollback:** on any regression, stop at the failing layer and revert the smallest previously closed step that introduced it. Rerun that step's baseline plus the failing regression. Do not compensate by changing source workflow dates or accounting dates.

### Step 6 — Documentation and handoff

After implementation only:

- change spec/plan status from Proposed/Planned to the evidence-backed state;
- record exact commands/results and any deviations in task memory;
- note the existing 200-row KPI limitation without expanding scope;
- if a distinct tax/ledger date issue is discovered, create a separate spec instead of folding it into this change.

**Evidence to close Step 6:** status changes reference exact test commands/results and artifacts; `git diff --check`; file-scope inspection; explicit confirmation of no migration, package, permission, tax or ledger changes.

**Rollback:** documentation status is reverted from Implemented/Verified to Planned/Partial whenever required evidence is missing or later disproved. Documentation must describe the actual runtime state, not the intended state.

## 7. Acceptance Traceability

| Spec acceptance | Planned evidence |
| --- | --- |
| AC1–AC2 visibility | API filter test + E2E upload/correct/return journey |
| AC3–AC7 tag and timezone | pure helper unit tests + desktop/mobile browser inspection |
| AC8 ordering | repository focused test proving `orderBy` before `take` |
| AC9 scope | repository/use-case branch and related-scope regression case |
| AC10 design preservation | visual comparison of existing grid/card actions and responsive smoke |
| AC11 KPI semantics | KPI fixture plus browser DOM copy assertion |
| AC12 export boundary | API-client call assertion or browser network inspection |
| AC13 no architecture expansion | final changed-file allowlist check plus `git diff --check` |
| AC14 Evidence unchanged | focused Evidence browser smoke and request-payload assertion |
| AC15 attachment immutability | focused before/after `uploadedAt` assertion plus attachment journey |
| AC16 cross-channel creation | focused web/use-case cases for creation timestamp semantics |
| AC17, AC19 substitute boundaries | existing/new Expense wizard journey plus hub/candidate regression |
| AC18 reimbursement boundary | projection service/repository case plus Reimbursement queue smoke |
| AC20–AC21 LINE boundary | direct OCR correction case and clarified-media month-boundary case |

## 8. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Upload filter with document sort still hides old documents | Step 2 server-side upload ordering |
| KPI mistaken for accounting/VAT month | Step 4 explicit intake-cohort copy |
| Export mistaken for visible-row export | Step 4 explicit document-date export copy |
| UTC month boundary error | Shared civil-date helper and boundary test |
| Manual/API record labelled as file upload | Canonical `ส่งเข้าระบบ` wording |
| Reimbursement projection unexpectedly tagged | Spec R7 explicitly treats it as late system entry; no reimbursement mutation |
| Reimbursement projection mistaken for claim upload | Copy and test explicitly define projection-creation time as Expense intake |
| Substitute certificate action refreshes intake | Pin existing Expense `uploadedAt` immutability across certificate workflow |
| Clarified LINE receipt crosses month | Owner gate selects Expense creation month or explicitly revises scope before coding |
| Scope expands into tax/ledger correction | Stop and create a separate spec |
| Existing dirty worktree | Touch only planned files; do not alter unrelated `docs/agent-memory/legal-acceptance-item3-data-deletion.md` |

## 9. Reversibility and Release Safety

No migration, backfill, destructive mutation, new stored field or accounting/tax write is planned. That makes the feature code-reversible, but only if related changes are kept in the units below.

| Reversible unit | Must move together | Rollback action | Proof after rollback | Data repair |
| --- | --- | --- | --- | --- |
| A — helper | late-day helper + its tests | Revert both files/hunks | old web baseline passes; no unused import | None |
| B — query lens | main-list request keys + repository conditional order + their tests | Revert the full unit, not one side | August/June characterization returns to documented old behavior; no-range caller still green | None |
| C — row/card UI | both-date rendering + tag + related copy/tests | Revert UI/copy together | desktop/mobile baseline screenshot and DOM return | None |
| D — KPI/export copy | intake KPI/empty copy + explicit document-date export copy | Revert copy/assertions | payload semantics remain unchanged and baseline copy returns | None |
| E — source regressions | test-only additions for Substitute/Reimbursement/LINE boundaries | Keep when valid; revert only if the approved rule changes | affected existing source suite returns to baseline | None |

Implementation should keep these as separate reviewable commits or otherwise separable diffs. Do not combine a migration, date backfill, tax/ledger behavior or unrelated refactor with any unit. If an emergency rollback is needed after release, revert B + C + D together to restore a coherent old user experience; A can remain unused only temporarily and should then be removed.

Release stop conditions:

- any required acceptance criterion lacks executable evidence;
- list filter changes but server order does not;
- source pages inherit the main Expenses upload filter;
- accounting/tax/export date changes appear in the diff;
- cross-tenant/branch/own-related predicate evidence is missing;
- desktop or mobile hides an existing action/status/amount;
- clarified LINE or reimbursement semantics differ from the owner-approved rule;
- a migration or data repair becomes necessary without a new approved spec.

## 10. Executable Verification Matrix

### 10.1 Baseline commands already executed during planning

These commands prove the named existing suites are runnable; they do **not** prove the unimplemented feature:

```bash
corepack pnpm --dir apps/web exec tsx --test \
  src/features/expenses/expenses.model.spec.ts \
  src/features/expenses/substitute-receipt-hub.model.spec.ts \
  src/features/expenses/substitute-receipt-wizard.model.spec.ts
```

Result on 2026-08-15: 65/65 passed. The sandbox denied the tsx IPC pipe; the identical command passed when run with the required local permission.

```bash
corepack pnpm --dir apps/api exec tsx --test --test-reporter=spec \
  src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts \
  src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts
```

Result: 27/27 passed.

```bash
corepack pnpm --dir apps/api exec tsx --test --test-reporter=spec \
  src/modules/reimbursements/application/services/materialize-claim-expenses.service.spec.ts \
  src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts \
  src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.spec.ts
```

Result: 78/78 passed.

```bash
corepack pnpm --dir apps/api exec tsx --test --test-reporter=spec \
  src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts
```

Result: 73/73 passed, including direct media, text capture and stored-media clarification.

### 10.2 New tests required before implementation can be called verified

| Missing proof today | Required test/artifact | Failure that it must catch |
| --- | --- | --- |
| Upload-range server order before `take` | new focused Expense repository list spec | old-dated but newly uploaded row is omitted/buried |
| Main list sends upload range only | request/API-client assertion or browser network assertion | UI still sends `fromDate/toDate`, or sends both lenses |
| Cross-month helper | seven red/green unit cases from Step 1 | UTC slicing, same-month tag, negative days |
| Desktop/mobile design preservation | DOM assertions + before/after screenshots | missing actions, overflow, tag hidden on mobile |
| Substitute existing/new intake invariants | focused workflow assertion and browser journey | certificate action refreshes Expense intake |
| Reimbursement projection intake | repository/use-case assertion and E2E projection lookup | claim attachment/submission mistaken for Expense intake |
| LINE clarified month boundary | focused clock-controlled LINE test | original media time is silently substituted for creation time or vice versa |
| Permissions | repository/list test with company + branch + own/related scopes | upload range weakens ABAC/tenant filter |
| Export boundary | spy/network assertion | accountant package changes from document date |

### 10.3 Post-change focused commands

The repository assertions were added to the already-covered related-access spec so the default API test manifest continues to execute them without a `package.json` edit.

```bash
corepack pnpm --dir apps/web exec tsx --test \
  src/features/expenses/expenses.model.spec.ts \
  src/features/expenses/expenses.api.spec.ts \
  src/features/expenses/substitute-receipt-hub.model.spec.ts \
  src/features/expenses/substitute-receipt-wizard.model.spec.ts

corepack pnpm --dir apps/api exec tsx --test --test-reporter=spec \
  src/modules/expenses/application/use-cases/expense-related-access.use-case.spec.ts \
  src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts \
  src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts

corepack pnpm --dir apps/api exec tsx --test --test-reporter=spec \
  src/modules/reimbursements/application/services/materialize-claim-expenses.service.spec.ts \
  src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts \
  src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.spec.ts \
  src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts

corepack pnpm --dir apps/web typecheck
corepack pnpm --dir apps/api typecheck
```

The runnable path above replaced the planning placeholder and covers upload ordering, Bangkok boundaries, page limit, company/branch/related ABAC and legacy document ordering.

### 10.4 Integration/browser proof

Use the repository-owned local runner because it supplies the seeded API/web environment:

```bash
e2e/run-local.sh e2e/expenses.spec.ts e2e/reimbursements.spec.ts e2e/reimbursement-receipt.spec.ts
```

Actual receipt-byte journeys require the existing `S3_E2E=1`/MinIO setup; if unavailable, keep those checks explicitly open rather than replacing them with mocks. Add stable test IDs/names for the August-intake/June-document journey and run them with `--grep`. Use Bangkok-relative fixture dates so the test remains valid in later months.

Browser evidence must include:

- desktop and mobile screenshot of one 51-day tag and one same-month no-tag row;
- captured list query showing `uploadedFromDate/uploadedToDate`;
- captured export query showing `dateField=expenseDate`;
- row open/back journey with retained period;
- one source-surface smoke each for Substitute hub and Reimbursement queues.

### 10.5 Static and scope proof

```bash
git diff --check
git status --short
git diff --name-only
```

## 11. Completion Evidence (2026-08-15)

Implementation closed Steps 0–6 with the following evidence:

- Red-first web helper: failed because `lateDocumentDays` did not exist; green result 49/49 for the focused model spec.
- Red-first repository ordering: expected `uploadedAt desc`, received `expenseDate desc`; green result 8/8 after the conditional order.
- Review-discovered timezone red test: expected Bangkok bounds `2026-07-31T17:00Z`–`2026-08-31T17:00Z`, received UTC-midnight bounds; green 8/8 after the timestamp-lens correction.
- Web expense/API/substitute matrix: 80/80 passed.
- Expense upload/substitute/related API matrix: exit 0, including the 8/8 repository/ABAC cases.
- Reimbursement projection plus LINE direct/text/clarified-media matrix: exit 0.
- `corepack pnpm --dir apps/web typecheck`: passed.
- `corepack pnpm --dir apps/api typecheck`: passed.
- `e2e/expenses.spec.ts`: 16/16 passed against a fresh isolated stack after migrations and standard seed.
- `EXP-26`: passed independently after adding assertions for upload-only list query, 51-day tag, same-month no-tag, accountant export `dateField: expenseDate`, and desktop/mobile DOM.
- Review found three stale existing E2E fixtures in the touched file (two receipt intents sent timestamps instead of civil dates; one PATCH omitted `expectedUpdatedAt`); all were corrected and the formerly failing three paths passed in the 16/16 rerun.
- Isolated `codex-expense-date` containers, network and volumes were removed after verification; generated `next-env.d.ts` was restored and Playwright artifacts were moved outside the worktree.

Known limitation remains unchanged: main-list KPI/chip calculations operate on at most the newest 200 intake rows. Server ordering now guarantees that cap contains the newest intake cohort; server-side aggregate redesign remains out of scope.

Review the final file list against §5. Any schema, migration, contract, permission, package, tax, ledger or unrelated source file is a stop-and-explain event, not an automatically accepted change.

## 11. Evidence Record Required Per Step

Task memory must record this block for every step before marking it complete:

```text
Step:
Precondition/baseline:
Files changed:
Command actually run:
Environment/prerequisites:
Expected result:
Actual result and pass/fail count:
Artifact/query/screenshot:
Acceptance criteria closed:
Acceptance criteria still open:
Rollback unit:
Decision: proceed | stop | revise spec
```

“Code inspection,” “should work,” “looks correct,” or a broad suite without the target assertion cannot close a step. A skipped/blocked command is evidence of a blocker, not evidence of working behavior.

## 12. Current Planning Verification

Completed during this document-only task:

- traced main-list UI → API client → controller → use case → repository;
- verified existing `uploadedAt` contract, schema index, migration backfill and Evidence behavior;
- inspected KPI, export, reimbursement projection, dashboard, tax and ledger boundaries;
- traced web upload, manual entry, substitute existing/new, reimbursement attachment/submit/projection, and LINE direct/text/clarified creation paths;
- ran existing focused baseline suites: web Expense/Substitute 65/65, Expense upload/Substitute API 27/27, Reimbursement mapping/approval/finance 78/78, LINE intake including clarified media 73/73;
- confirmed no implementation files were changed.
