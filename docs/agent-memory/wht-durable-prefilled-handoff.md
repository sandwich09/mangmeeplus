# Agent Memory: WHT durable prefilled handoff (H4)

Status: Committed as 71f52a82 (H4 + r11 + r12 fix rounds), then the r13 fix round applied on top.
Not deployed — deploy itself is owner-deferred.
Owner: H4 lane (feature-entitlement decoupling initiative).

## Scope

Close the owner's ruling that WHT counts as a kill-switch only until a DURABLE PREFILLED HANDOFF
exists: when the system cannot issue the 50 ทวิ itself, the user must get a durable, prefilled
artifact to have it issued externally, recorded and linked back — instead of a bare 409.

In scope: `WhtCertificateHandoff` model, handoff creation at both the tax-endpoint seam and the
supplier-payment settlement seam, decoupled `wht.*` permissions, read/link API, AP web panel.

Out of scope (CC5 owns): `WhtReplacementCopyHandoff`, `WhtCommandRegistry`, `WhtCertificateCommand`,
`WhtCertificateCopyArtifact`, `WhtCorrectionCase`, `artifactOrigin`, number-namespace registration,
the one-active-certificate predicate, and any `ใบแทน` path.

## Coordinator rulings applied

- **OQ-1 = (b)** — `(companyId, creationCommandId)` is the operative idempotency fence; the four
  source-identity columns exist but are nullable. **Deviation recorded**: the spec anchors handoff
  identity on `(companyId, sourcePaymentType, sourcePaymentId, payeeId)`
  (tax-thailand-2026-spec.md:1342). Settlement-created rows populate that identity and the unique is
  operative for them; endpoint-seam rows leave it null (Postgres treats NULLs as distinct) and rely
  on the command-id fence. Both uniques ship.
- **OQ-2 = (b), scoped** — handoff creation is wired into the SUPPLIER-payment settlement seam.
  Expense-side WHT is a later slice. Rationale: under (a) nothing would ever create a handoff (the
  tax endpoint is `thai_tax`-gated and unreachable from web), so H4 would have shipped a dead panel.
- **OQ-3 = (a)** — linking writes only the handoff row. No `WhtCertificate` write, no
  `artifactOrigin` column, no FK relaxation.
- **OQ-4 = ACCEPTED** — `prefillSnapshotJson` + `prefillSnapshotHash` are a **deliberate addition
  beyond the spec's field list**. The spec re-derives prefill from a settled-payment row that does
  not exist yet, and tax-spec:1835 still requires the read to return an immutable prefilled snapshot
  after source access is gone.
- **OQ-5 = (a)** — 409 retained, enriched with `handoffId` + `handoffStatus`.
- **OQ-6** — the `ใบแทน` rule is governed in-repo by tax-spec:1300 plus the golden-fixture gate at
  :1302. The ประกาศ ทป.240 citation is **owner-sourced** (r2 review verdict); there is no in-repo
  source (`grep -n "240"` over tax-thailand-2026-spec.md returns zero matches). H4 builds no ใบแทน
  path, so no action.
- **R1 sign-off** — the zero-writes assertions at create-wht-certificate.use-case.spec.ts:80,86
  became a named allow-list (`CERTIFICATE_WRITES`). Guard-error and OPEN paths keep their original
  behaviour, each with one added assertion that no handoff is created.

## External review r11 fix round

Verdict on 43a30667: CHANGES_REQUIRED — 3 P0 + 4 P1 + 1 P2. All OQ rulings confirmed MATCH;
migration/decoupling/settlement verified clean. Fixes applied:

- **F3 (P0) — legal-evidence overwrite.** Linking was read-then-unconditional-update: two concurrent
  operators both read REQUIRED and the later silently overwrote the first one's evidence. Replay
  also compared the CREATION command id, so a retry and a genuine second link were
  indistinguishable. Fixed with migration `20260804110000_wht_handoff_link_hardening`: the link
  command gains its own identity (`linkCommandId` + `linkPayloadFingerprint`, NULL-distinct unique)
  and the transition became a single-statement CAS (`updateMany` on `status='REQUIRED'`); `count===0`
  reloads and either replays the identical command or returns 409 with the current state.
- **F2 (P0) — no runtime validation.** The link body was a type-only interface, so `''` could flip a
  handoff to EXTERNAL_LINKED. Added `LinkExternalWhtCertificateDto` as a class-validator class
  (`tax.dtos.ts`, following `procurement.dtos.ts`), plus defence-in-depth re-validation at the
  mutation boundary for internal callers that bypass the pipe.
- **F1 (P0 as filed → SCOPED by coordinator).** `branchCode` holds the PAYEE's tax branch code;
  the internal source branch was never captured. Added `sourceBranchId` (populated on the settlement
  path, null on the endpoint path) and optional `branchId`/`status` list filters.
  **Branch AUTHORIZATION is deliberately NOT enforced**: procurement/AP lists are company-scoped
  with `branchId` as an optional filter only, and no AP surface enforces a branch boundary today.
  H4 must not invent an estate-wide ABAC boundary in one module — flagged to owner as an
  estate-wide question.
- **F4 (P1) — route param ignored.** The three endpoints took `:companyId` but never checked it,
  while the auth guard lets an `x-company-id` header set context. Now bound and passed through
  `assertRouteCompany`, matching the house pattern already in this controller.
- **F5 (P1) — concurrent create.** `createOrReplay` was only sequentially idempotent; the loser of a
  race got a raw P2002. Now catches P2002 and reloads the winner — but **only outside a caller's
  transaction**, since inside one the violation has already poisoned it (25P02). The settlement path
  passes no `tx` and uses its own in-transaction helper.
- **F6 (P1) — web swallowed structured errors.** Added pure `whtLinkErrorOutcome`, branching on the
  stable codes and returning whether the list is stale and must refetch.
  **Correction (r12):** the AP screens use `authedApiFetch`, which already forwards `code`, so the
  F6 fix did not depend on the `mapResponseToApiError` change. That one-liner fixes a *separate*
  path — the `HttpClient`/`ApiError` one, where `code` was extracted but forwarded only for 401/403,
  leaving every 409 there without a code for `localizedErrorMessage(..., { conflictCodes })` to
  match. Still worth keeping, but it was not the F6 enabler.
- **F7 (P1) — R1 deviation.** The CLOSED allow-list could not observe PDF rendering because
  `buildTaxExportArtifact` was a direct import. Added `TaxArtifactRendererService` as a thin
  injectable seam; `render:pdf` is now in the forbidden list for CLOSED and asserted present (and
  correctly ordered after number reservation) for OPEN. No existing assertion weakened.
- **F8 (P2)** — this document.

## External review r12 fix round

Verdict on 2bf297ba: 5/8 CLOSED, both deviations ACCEPTED (the server-computed link fingerprint was
called "the correct trust model"). Four remaining findings, all fixed here:

- **r12-1 (P1, F3 residual) — cross-handoff command reuse.** The link fingerprint omitted the
  handoff id and the command lookup is company-wide, so command X that linked handoff A, resubmitted
  with identical evidence against handoff B, returned A as a successful "replay" while B silently
  stayed REQUIRED — success reported, payee never certified. The handoff id is now part of the
  fingerprint AND checked explicitly first: same command + different handoff is always a 409,
  regardless of fingerprint. The CAS is additionally wrapped so a cross-row unique violation racing
  the lookup returns the same typed 409 instead of escaping as a raw P2002. One shared
  `replayOrConflict` makes the pre-check and the recovery path answer identically.
- **r12-2 (P2) — dead web branches.** `whtLinkErrorOutcome` read `statusCode`, but the AP screens'
  actual client (`authedApiFetch`) sets `status`, so the 404/400/403 branches never fired. Now
  resolves `statusCode ?? status`, and the spec fixtures were rebuilt around the REAL thrown shape
  so this class of drift fails tests. Verified by reverting the fix: 3 tests go red.
- **r12-3 (P2) — divergent validators.** The mutation boundary accepted any Date-parsable string
  where the DTO demanded ISO-8601, truncated notes over 1000 chars, and threw TypeError on a
  non-string note. Replaced by one shared strict validator
  (`domain/logic/wht-link-evidence.logic.ts`) used by BOTH layers — the DTO's `@MaxLength` bounds now
  come from its constants. **Found while testing it:** `new Date('2026-02-31')` does not fail, it
  rolls over to 3 March, so a mistyped day would have been stored as a different date than the RD
  document shows. The validator now round-trips the Y-M-D components.
- **r12-4 (P2)** — this document.

## External review r13 fix round

r12-1/2/4 CLOSED. One finding, fixed here:

- **r13-1 (P2) — hour 24 stored the following day.** ISO-8601 defines hour 24 as midnight of the
  NEXT day, so `2026-02-28T24:00:00Z` parses to 1 March. The r12 calendar guard did not catch it,
  and the reason is worth recording: it compared `probe` — a Date built FROM the sliced Y-M-D
  components — back against those same components, so it could never disagree with itself. The
  check was **vacuous for the value actually being stored** (`new Date(rawDate)`), which is why a
  date-time whose date part read back correctly sailed through. Verified empirically against the
  exact r12 code: `2026-02-28T24:00:00Z` → ACCEPT, persisting `2026-03-01T00:00:00.000Z`.

  Fix: `issuedDate` is now a STRICT `YYYY-MM-DD` calendar date (an issued date is a day on a paper
  document and has no clock time), the stored `Date` is constructed from the validated components
  via `Date.UTC` and never by parsing the raw string, and the calendar-day check now compares the
  stored value itself. The DTO layer uses the same shared pattern (`@Matches(WHT_LINK_ISSUED_DATE)`
  replaces `@IsDateString`, which accepts date-times) so both layers answer identically.
  `<input type="date">` already sends date-only, so no caller loses anything.

  Regression cases pinned: `2026-02-28T24:00:00Z` rejected, `2026-02-31` rejected, `2026-02-28`
  accepted and persisting exactly `2026-02-28T00:00:00.000Z`. Mutation-checked against the exact
  r12 implementation: 3 tests go red.

## Decisions

- The launch gate stays authority. `isLaunchRouteOpen` is one shared translation used by both the
  tax use-case and the settlement path; only `feature_temporarily_unavailable` becomes `false`, and
  an unreadable guard still throws rather than manufacturing a handoff.
- Prefill is best-effort and never fabricated (spec:208). From a supplier payment the system knows
  payer, payee, gross, withheld and payment date; it does **not** know the income category or rate
  (they live on the withholding decision, not the payment header), so those stay null and the UI
  shows "ต้องระบุ". `formType` is derived only for `JURISTIC_PERSON` → PND53 and `INDIVIDUAL` → PND3;
  FOREIGN/GOVERNMENT/OTHER stay null.
- Decoupling is achieved by data, not logic: `pack.wht.certificate.manage` has no
  `featureEntitlementKey`, and `feature-gate.logic.ts:83` checks `ungatedPermissions` before the
  gated map. No `PREFIX_FEATURE_RULES` entry starts with `wht.`. The entitlement chokepoint is
  untouched.

## Artifacts

Contracts: `packages/contracts/src/tax.ts` (+`WhtHandoffStatus`, `WhtHandoffPrefillDto`,
`WhtCertificateHandoffDto`, `LinkExternalWhtCertificateDto`, `WhtSystemIssuanceUnavailableBody`).

Schema: `apps/api/prisma/schema.prisma` (`WhtHandoffStatus` enum, `WhtCertificateHandoff` model,
`Company.whtCertificateHandoffs`); migration
`apps/api/prisma/migrations/20260804100000_wht_certificate_handoff/migration.sql`.

Permissions: `apps/api/src/modules/auth/permission-registry.ts` (+`wht.certificate.read`,
`wht.external_certificate.link`; granted to FINANCE and ACCOUNTANT — OWNER inherits via
`COMPANY_PERMISSION_KEYS`); `capability-pack.registry.ts` (`pack.wht.certificate.manage`, ungated);
`role-template.registry.ts` (`FINANCE_PACKS`, `tpl.x.accounting`).

API: `wht-certificate-handoff.use-case.ts` (new), `create-wht-certificate.use-case.ts`,
`tax.controller.ts` (3 routes under `wht/payment-handoffs`), `tax.module.ts`.

Settlement: `procurement/application/use-cases/supplier-payment.use-case.ts`,
`procurement/infrastructure/prisma-procurement.repository.ts` (`createWhtHandoffForPayment`).

Web: `accounts-payable.logic.ts` (new `wht` tab), `accounts-payable.api.ts`,
`AccountsPayablePages.tsx` (`WhtHandoffPanel` + `WhtHandoffDetail`).

## Verification

| Check | Result |
|---|---|
| `prisma validate` | valid |
| Migration applied + re-run | idempotent (second run skipped every object) |
| Live real-DB probe | create with flat `companyId` scalar OK; compound-unique replay HIT; duplicate command rejected P2002; link OK; Thai prefill roundtrip OK |
| `feature-gate.logic.spec.ts` | 33/33 — `wht.*` survives an entitlement set without `thai_tax`; `tax.certificate.*` still stripped |
| `create-wht-certificate.use-case.spec.ts` | 7/7 |
| `wht-certificate-handoff.use-case.spec.ts` | 26/26 |
| `prisma-procurement-integrity.repository.spec.ts` | 17/17 (6 settlement tests) |
| `apps/web` accounts-payable.logic.spec.ts | 11/11 |
| `tsc --noEmit` api + web | clean (contracts built first) |
| `pnpm test:boot` | Nest resolved every provider in 186ms |
| Full API suite | **5238 tests, 0 failures, exit 0** |
| Full web suite | **593 tests, 0 failures, exit 0** |
| Live CAS probe | link #1 count=1, link #2 count=0, winner intact, replay HIT, cross-row fence P2002 |

## Open questions / follow-ups

- **Expense-side WHT** handoff creation is not wired (coordinator-scoped out of H4).
- **Pre-existing migration drift**: `prisma migrate dev` refuses to run because
  `20260728120000_stock_movement_single_reversal` was modified after being applied, and wants a
  destructive reset. The H4 migration was therefore hand-written in the repo's idempotent style and
  registered with `prisma migrate resolve --applied`. This drift predates H4 and is a deploy hazard
  for any lane that needs `migrate dev`.
- No E2E covers the settlement → handoff → link journey end to end; unit + live-DB evidence only.
- **Estate-wide ABAC (owner question, flagged by coordinator):** no AP/procurement surface enforces a
  branch authorization boundary — `branchId` is an optional filter everywhere. Whether branch should
  become an authorization dimension is an estate-wide decision, not an H4 one.
- The `WhtCertificate` table still requires `taxPeriodId` (schema:3382) and has no `artifactOrigin`.
  Both must change when CC5 makes an EXTERNAL link mint a real certificate row.

## Next

Deploy preflight must include **BOTH** migrations — `20260804100000_wht_certificate_handoff` and
`20260804110000_wht_handoff_link_hardening`. Both are hand-written (the pre-existing
`20260728120000_stock_movement_single_reversal` drift blocks `prisma migrate dev`), both are
idempotent on re-run, and both are recorded via `prisma migrate resolve --applied` locally.

Deploy itself is owner-deferred.
