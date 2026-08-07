# Agent Memory: dto-boundary-conversion-g1

Status: DONE (2026-07-29). All 51 `@Body() body: any` handlers in `apps/api` are converted; `grep '@Body() body: any' apps/api/src` returns only comments. Committed on `develop`, NOT deployed.
Owner: thawatchai.
Scope: Gap G1 of `docs/plans/prisma-error-mapping-and-enum-parity-plan.md` — replace every untyped request body with a class-validator DTO so the global `ValidationPipe` (`whitelist + forbidNonWhitelisted + transform`) actually has a metatype to enforce.

## The rule every DTO follows

**Field list = (use-case `execute` input type) ∪ (what real callers send). Never narrower.**

Both halves matter and for different reasons:
- narrower than the caller → `forbidNonWhitelisted` turns a working page into a 400;
- narrower than the use case → `whitelist` silently strips a field the use case reads, changing behaviour with no test failing anywhere.

The use-case input types are the authoritative field list — they are wider than the
`@watchdog-bms/contracts` `Create*Dto` types in several places (vendor-bill lines
carry `transactionContext` and the PP36 `authoritative*` amounts; PO/PR headers
carry caller-computed totals). Contracts types were **not** treated as the source
of truth; where they disagreed with the implementation, the implementation won and
the divergence is recorded below.

## Caller payload details that constrained the DTOs

Each of these would have broken a live page if the DTO had been written from the
contracts type alone. All are covered by a named test in the module's `*.dtos.spec.ts`.

| Caller | Detail |
|---|---|
| `accounts-payable.api.ts` `createVendorBill` | sends `transactionContext` on every line — absent from `CreateVendorBillLineDto` in contracts |
| `accounts-payable.api.ts` `updateApprovalPolicy` | sends `dualApprovalThresholdAmount: null` to disable the threshold |
| `inventory.api.ts` `createMovement` | puts `movementType` in the body and picks the endpoint from it, so `/receive` and `/issue` receive a `movementType` the controller overrides |
| `InventoryPages.tsx` product edit | sends explicit `null` for `description`, `salePrice`, `bookingDurationMinutes` to clear columns |
| `NotificationPages.tsx` preferences | saves `{ ...pref, enabledChannels }`, so the whole preference — `userId` included — comes back on every toggle |
| `notification-worker.ts` | posts `{ periodKind }` and `{ periodKey }` to the two worker-token internal endpoints; failures there only surface as a status code in a log |
| `e2e/procurement.spec.ts` | goods-receipt lines send `rejectedQuantity: '0'` and `previouslyReceivedQuantity: '0'` — zero must be a legal decimal |

## Bugs found and fixed while converting

1. **Vendor bill create 500 on any line with a tax code.** `CreateVendorBillUseCase`
   types `billDate` as `Date` and calls `dto.billDate.toISOString()` whenever a line
   carries `taxCodeDefinitionId` or `externalTaxCode`, but the controller passed the
   raw JSON string through — `TypeError: toISOString is not a function` → 500. Date
   fields are now converted with `@Type(() => Date)`. Live-verified: the same payload
   that produced the crash path returns 201 with `billDate` stored as
   `2026-07-29T00:00:00.000Z`.
2. **`DocumentResetPolicy` contract was lowercase.** Contracts said
   `'none' | 'monthly' | 'yearly'`; the Prisma enum and the domain model are
   `NONE | MONTHLY | YEARLY`. Any client trusting the contract would have been
   rejected at the insert. Now a `DOCUMENT_RESET_POLICIES` runtime array registered
   in the parity guard.
3. **Pre-existing: `PartnerAiConfiguration.modelId` nullability.** `tsc` had been
   failing on `origin/develop` (3 errors) since that column went nullable.
   Fixed separately in `90a3485b` so `pnpm typecheck` could be used as a gate.
4. **Stale contracts build silently rejects everything.** `@IsIn(undefined)` does not
   throw — it rejects every value with "must be one of the following values:
   undefined". Found live. `common/pipes/enum-values.ts` now refuses to start the
   process instead. Not reachable in the deploy image (turbo `dependsOn: ["^build"]`
   builds contracts first).

## Deliberate behaviour changes

- **`POST /posting/generate` is now narrow.** `GenerateJournalFromSourceUseCase`
  rebuilds the whole posting input from the database for every recognized
  `sourceType` and throws `unsupported_posting_source` otherwise, so
  `sourceType`/`sourceId`/`sourceEventType` were always the only fields read — a
  caller-supplied `lines`/`periodKey`/`grossAmount` was accepted and discarded. The
  DTO now rejects them (400) and the use-case parameter is `PostingSourceRef`.
  Both apps/web callers send only the three fields.
- **Manual bank statement lines** cannot claim `sourceType: 'IMPORT'`, another
  tenant, or another account — those five fields are use-case-set and now rejected.
- **Rejecting/voiding** (`vendor bill reject`, all four void routes) now require a
  non-empty note/reason. apps/web already guards every one of these with
  `if (reason)` / `if (note)`, so no caller changes.

## Accepted residuals

- `UpdateNotificationPreferenceDto.userId` is accepted and never read — the page
  round-trips the whole preference. Tightening it means changing the page first.
- `supplierSnapshotJson` and PO `outstandingAmount` remain caller-supplied on
  procurement create routes: the repositories write them straight through today, so
  removing them is a behaviour change, not a DTO change. Server-deriving them is a
  separate task.
- Header totals on vendor bill create are accepted and then recomputed from the
  prepared lines. Accepted because every existing caller sends them.
- `GET` query params are still untyped (`@Query() q: any`). Out of G1's scope; a bad
  enum in a list filter now answers 400 generic via the Prisma-error filter.

## Artifacts

- `apps/api/src/common/pipes/decimal-string.patterns.ts`, `.../enum-values.ts`
- `apps/api/src/modules/{procurement,inventory,data-model-core,dashboard-notifications,banking}/presentation/http/*.dtos.ts` + `*.dtos.spec.ts`
- `apps/api/src/modules/ledger/presentation/http/ledger.dtos.ts` (`GenerateJournalFromSourceDto`)
- contracts: `PURCHASE_LINE_TYPES`, `PURCHASE_MATCHING_MODES`, `PAYMENT_METHODS`, `DOCUMENT_RESET_POLICIES` + their `prisma-enum-parity.spec.ts` registry entries

## Verification

- `pnpm typecheck` (workspace) clean; `pnpm --filter @watchdog-bms/api test` **3639 pass / 0 fail** (87 new boundary cases); `packages/contracts` 43/43; `pnpm --filter @watchdog-bms/api test:boot` — Nest resolved every provider.
- `pnpm test` (workspace) is green on re-run; a single ai-gateway oversize-upload test flaked once under concurrent load and passes 507/507 on its own.
- Live probe against the local stack (built API + docker postgres), all confirmed by
  response: unknown `supplierType` → 400 naming the field (was 500); typo'd field →
  400 `property supplierTyp should not exist`; nested line bad enum → 400
  `lines.0.inputVatClaimStatus ...`; valid supplier → 201; vendor bill with a tax
  code → 201; `movements/receive` with `movementType` in the body → 201;
  notification-preferences whole-object round-trip → 200; `posting/generate` with a
  forged `lines[]` → 400. Probe rows were removed afterwards in one verified
  transaction (demo product balance back to 134).

## Next

- Not deployed. Normal canary rules apply; nothing here needs a migration or a
  template sync.
- The e2e suite has now been run — see below.

## E2E run (2026-07-29)

**The DTO conversion caused no e2e regressions.** Full suite on base `2700246c`:
22 failed / 94 passed. Same suite on the converted tree: 23 / 93. The two deltas
(INV-03, SET-06) are load flakes with non-API signatures — INV-03 got past the
create (the URL had already changed to the new product id) and SET-06 died on
`ECONNRESET` at the web BFF's dev-login. One test (INV-05) failed on base and
passed on the converted tree.

That left 22 pre-existing failures, unrelated to this work. 15 were repaired
(commits `03b7cec7`, `84a56125`, `9216af5b`) — mostly assertions that stopped
matching shipped UI: strict-mode violations from a nav consolidation, ThemedSelect
and ThemedDate replacing native form controls, a Buddhist-Era calendar header,
seed bookings that drift out of "this week", a renamed review step, a moved
manual-expense route, and a sign-out `confirm()` Playwright auto-dismisses. One
real product bug came out of it (`/settings/permissions` lit up two sidebar rows);
two others found in the same pass were fixed concurrently by other sessions
(the Prisma-7 compound-FK nested create, and zero-line drafts).

### Still failing, and why they were not "fixed"

- **XC-01, NAV-03, INV-03** — none of these ever fails on an assertion; they die on
  `page.goto` / route compilation. The suite boots `next dev`, which compiles each
  route on first visit, and XC-01 alone sweeps 16 cold routes inside a 60s budget.
  Raising the budgets *does* make those two tests run — and measurably damages the
  suite: a controlled pair of full runs on the same quiet machine gave 34 failed /
  8.1 min without the change and 41 failed / 11.4 min with it, because the two
  sweeps then hold workers while everything else times out at 10s. The change was
  withdrawn. The real fix is to stop running these against a dev server (production
  build, or a rig where cold compiles are cheap), not to hand them more time.
- **XC-02** — quarantined with `test.fixme`, not a defect: the authenticated
  workspace is Thai-only by product decision.

### Rig caveat — do not trust absolute numbers from this workstation

The same suite, same settings, same machine, no code change between them, went
from 23 failed / 4.9 min in the morning to 34 failed / 8.1 min by the end of the
session. Next reports `Slow filesystem detected` from the start; the checkout has
28 sibling worktrees and this one gained its own `node_modules` mid-session. Treat
per-run counts from here as directional only; a real verdict needs CI or a clean
machine.

### Parallelisation note

Diagnosis and editing parallelise well (three lanes covered 15 cases at once,
partitioned by spec file so no two lanes shared a file). **Verification does not.**
Every lane's Playwright run builds into the same `apps/web/.next` and
`apps/api/dist`, so concurrent runs tear each other's output — the symptoms are a
corrupted `globals.css` and a `CircularDependencyException` in AuthModule that
does not exist in the source. `NEXT_DIST_DIR` covers the web side but made Tailwind
scan the extra build dirs (fixed separately in `c0da2e26`); the API side has no
equivalent until `playwright.config.ts` gained a per-port `API_DIST_DIR`. Serialise
verification, or give every lane its own output dirs first.
