# Agent Memory: substitute-receipt standalone menu

Status 2026-08-06: approval mode, standalone menu + hub, wizard, PDF download, payee identity, signature pad,
the ใบสำคัญรับเงิน voucher, and queued LINE handoff notifications are implemented. Phases 1–7 are committed;
the LINE handoff changes are verified but intentionally uncommitted.
Owner: owner request 2026-08-06 — "แยกใบรับรองแทนใบเสร็จออกมาเป็นอีกเมนู ทำได้ตั้งแต่ต้นจนจบ ดาวน์โหลดเอกสารได้"
(the existing in-detail flow was tested and found unusable).

Scope: `expenses` module (API + web + contracts), workspace navigation, company policy.
Branch: `20260804`, **not pushed** — the owner is holding the branch local ("เก็บไว้ก่อน ต้องแก้อีกหลายอย่าง").
Two migrations are applied to the local dev database only:
`20260806100000_substitute_receipt_approval_mode` and `20260807100000_substitute_receipt_payee_identity`.

## Decisions

Items 1, 2, 6 and 9 were put to the owner on 2026-08-06 and **confirmed**. Treat them as settled; do not
re-open them without a new owner decision.

1. **Default approval mode is `OWNER_SELF`.** *(owner-confirmed)* A solo SME owner must finish the whole flow
   alone with zero prior setup. `DESIGNATED_APPROVERS` (today's mandatory two-person rule) becomes opt-in.
   Self-approval is limited to `ctx.roles.includes('OWNER')`; a non-owner payer always needs a second person in
   either mode — the owner explicitly reaffirmed this limit.
2. **Existing policy rows are backfilled to `DESIGNATED_APPROVERS`** in the migration. *(owner-confirmed)*
   Companies that already named approvers keep their segregation of duties; the new default applies only to
   companies with no row. Owner's wording: a company that wants to go back to single-signer **must go and change
   the setting themselves**. So the backfill is not a migration convenience to be tidied away later — silently
   relaxing someone's control is the thing being prevented, and only an explicit act in settings may relax it.
3. **`configured` keeps its old meaning** ("a policy row exists", drives the ตั้งค่าแล้ว badge). A new `ready`
   flag drives whether preparation is allowed, so the old "prepare is permanently disabled until an admin finds a
   hidden settings page" dead end is gone.
4. **UI copy tone**: formal-professional Thai, layperson-readable, no casual particles or emoji.
   **Icons**: eye = view-only, pencil = edit/continue. **Dates**: `5 ส.ค. 2569` everywhere in UI; the rendered
   official document keeps the full month. Recorded in the plan §8.
5. **PDF export is implemented in Phase 4** with the already-direct `sharp` dependency at 200 dpi, `pdf-lib`
   for the one-page A4 container, and Noto Sans Thai in the runner image. The immutable SVG remains authoritative;
   the PDF is generated on demand and a 0.2% dark-pixel guard rejects implausibly blank output.
6. **One OWNER-aware approval predicate is shared by every UI surface.** *(owner-confirmed)*
   `mayApproveSubstituteReceipt` in `substitute-receipt-wizard.model.ts` is used by the hub model, wizard, and
   `DocumentReviewSection`; a non-owner payer is never offered self-approval in `OWNER_SELF` mode.
7. **Wizard candidate filtering is client-side.** The expense-list endpoint has no
   `expenseNeedsReceiptOrSubstitute` filter and its summary omits attachments/evidence, so the wizard pages
   through accessible expenses, loads their existing detail payloads, and applies the established model helper.
8. **Evidence deep links resolve through existing read APIs.** The company-wide substitute list maps an
   `evidenceId` to its `expenseId`, then per-expense history supplies the immutable evidence snapshot. Phase 3
   adds no endpoint or contract.
9. **Expense-detail read access is NOT widened for confirm-only roles.** *(owner-confirmed)* Every shipped role
   template granting `expense.confirm` (OWNER, ADMIN, FINANCE) also grants `expense.read_own` and
   `expense.read` — verified by evaluating `ROLE_GRANTS`. The gap is reachable only through a hand-built custom
   role, and a HIGH-risk read gate is not widened for a hypothetical. Revisit only if a real customer builds one.
10. **The legacy inline form in `DocumentReviewSection` is scheduled for deletion, not kept.** *(owner decision
    2026-08-06: "ถ้านิ่งแล้วลบออกให้เลย")* It survives today only because live dependencies still point at it.
    See "Scheduled removal" below for the exit criteria and what has to move first — this is a commitment, so
    do not quietly let it become permanent.

## Artifacts

- Design plan (EN): `docs/plans/substitute-receipt-standalone-menu-plan.md`
- Thai summary: `../../Doc/substitute-receipt-menu-redesign-th.md`
- Visual mockup: https://claude.ai/code/artifact/5c074eec-9540-4af1-96cc-540296734ad7
- Phase 1 handoff: `docs/plans/substitute-receipt-approval-mode-20260806-codex-handoff.md`
- Phase 2 handoff: `docs/plans/substitute-receipt-standalone-menu-20260806-codex-handoff.md`
- Phase 3 handoff: `docs/plans/substitute-receipt-wizard-20260806-codex-handoff.md`
- Phase 3 UI: `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx`
- Phase 3 model/spec: `apps/web/src/features/expenses/substitute-receipt-wizard.model.ts` and
  `substitute-receipt-wizard.model.spec.ts`
- Phase 4 handoff: `docs/plans/substitute-receipt-pdf-download-20260806-codex-handoff.md`
- Phase 4 renderer/spec: `apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts` and
  `substitute-receipt-pdf.logic.spec.ts`

## Verification (Phase 1, run on host — not in Codex's sandbox)

| Gate | Result |
|---|---|
| `pnpm --filter @watchdog-bms/contracts run build` | PASS |
| `pnpm --filter @watchdog-bms/api lint` (`tsc --noEmit`) | PASS |
| `pnpm --filter @watchdog-bms/web typecheck` | PASS |
| API substitute specs (3 files, from `apps/api`) | 12 tests, 12 pass, 0 fail |
| web `substitute-receipt-policy.model.spec.ts` | 2 tests, 2 pass |

Migration **not applied to any database** — `20260806100000_substitute_receipt_approval_mode` is written but
unrun. Apply it before any e2e or manual run, or every substitute query will fail on the missing column.

Defect Codex caught that the Phase 1 handoff missed: `DocumentReviewSection` hid the approval block whenever
`evidence.payerUserId === userId`, which would have blocked the owner journey even with the backend fixed. Now
mode-aware via `canApproveEvidence`, and the runtime-policy fetch was widened to `canReview || canConfirm` so an
approver-only user actually receives `approvalMode`.

## Verification (Phase 2)

| Gate | Result |
|---|---|
| `corepack pnpm --filter @watchdog-bms/contracts run build` | PASS |
| `corepack pnpm --filter @watchdog-bms/api lint` | PASS |
| `corepack pnpm --filter @watchdog-bms/web typecheck` | PASS |
| requested hub-model `tsx --test` | Sandbox blocked `tsx` IPC; `node --import tsx --test` PASS (2/2) |
| requested workspace-i18n `tsx --test` | Sandbox blocked `tsx` IPC; `node --import tsx --test` PASS (4/4) |

**Re-run on the host after the audit fixes below** (this is the authoritative result):
contracts build PASS · api lint PASS · web typecheck PASS ·
web specs (hub model + policy model + i18n parity) 9/9 ·
api specs (3 substitute + menu-entitlement-binding + runoff-matrix catalog) 25/25.

Phase 2 handoff mismatches Codex found: package presets live in `menu-entitlements.ts` (not
`feature-entitlements.ts`), the nav binding contains no `expenses.substitute_receipt` key, neither downstream
guard pins a closed submenu set, and the repository had no decimal-to-string helper (it added
`expenseDecimalToString` and reused it in the existing mapper). The runtime-policy controller gate was
`expense.review`-only and was widened to `expense.review | expense.confirm | expense.read_own` — required,
because the hub needs `approvalMode` and an approver need not hold `expense.review`. That payload is read-only
company config, so the widening is acceptable.

### Audit fixes applied on top of Codex's Phase 2

1. **`buildSubstituteReceiptHubModel` now takes `isOwner`.** Codex correctly reported that the handoff's
   "รอคุณอนุมัติ" bucket checked only `approvalMode === 'OWNER_SELF'` and dropped Phase 1's OWNER-role condition.
   Without it a non-owner payer with `expense.confirm` would be offered their own certificate, sign it, and be
   rejected by the API at the last step. The route page now passes `session.roles.includes('OWNER')`, and a spec
   case pins the behaviour.
2. **Hub description copy** promised ดาวน์โหลด while download is Phase 4 — reworded to ตรวจสอบ.
3. **Confirm-only detail access: investigated and deliberately NOT changed.** Every role template granting
   `expense.confirm` (OWNER, ADMIN, FINANCE) also grants `expense.read_own` and `expense.read` — verified by
   evaluating `ROLE_GRANTS`. The wall Codex describes is only reachable via a hand-built custom role, and
   widening a HIGH-risk read gate on a theoretical case is the wrong trade. Revisit only if a customer builds
   such a role.
4. **Site-wide date format** (owner directive): the shared `formatThaiDate` helper in
   `apps/web/src/common/i18n/thai-date.ts` already produces the agreed `16 ก.ค. 2569` and 31 files use it. One
   straggler rendered `toLocaleDateString('th-TH')` (Gregorian year) — `LedgerReportsPage.tsx:159`, now fixed.
   The web has no other raw date formatting.

## Verification (Phase 3)

| Gate | Result |
|---|---|
| `corepack pnpm --filter @watchdog-bms/web typecheck` | PASS |
| wizard-model `node --import tsx --test` | 3 tests, 3 pass |
| workspace-i18n `node --import tsx --test` | 4 tests, 4 pass |
| hub-model regression `node --import tsx --test` | 3 tests, 3 pass |
| `git diff --check` | PASS |

Phase 3 handoff mismatches Codex found: the named file list omitted `ExpenseReviewPage.tsx` and its server route,
but both must carry the OWNER flag into `DocumentReviewSection`; the expense list has no server-side
receipt-needed filter and its summary cannot evaluate the existing detail helper; and
`workspace-i18n.spec.ts` does not itself assert locale parity (typed dictionary access rejects a missing English
key during typecheck).

### Audit fix applied on top of Codex's Phase 3

**Step 1's candidate scan fanned out one detail request per expense in the company.** `listAllExpenses` paged
through *every* expense and called `getExpense` on each — a tenant with a few thousand expenses would fire a few
thousand requests, trip the API rate limiter, and hang the step. Replaced with `listCandidateExpenses`, which
takes the most recent page, filters summaries down to the three statuses `validateEligibility` actually accepts
(`DRAFT`, `NEEDS_REVIEW`, `READY_FOR_CONFIRMATION`) *before* fetching any detail, and caps the detail fan-out at
`MAX_CANDIDATE_DETAIL_LOOKUPS = 60`. The cap is not silent: when the scan is truncated the step renders
`expenses.substitute_wizard.candidate_truncated` telling the user to open older expenses from รายการค่าใช้จ่าย,
which deep-links back into this wizard.

A server-side `needsReceipt` filter on the expense list is the real fix and would let the cap go away — worth
doing when this feature next gets API time.

Also hardened in the same pass: `listCompanySubstituteReceipts` accepted an unvalidated `yearMonth`, which
reached `Date.UTC` as `NaN` and made Prisma throw a 500 instead of ignoring an unusable filter. It now carries
the same `/^\d{4}-\d{2}$/` guard the neighbouring `listSharedEvidence` query already had.

### Final host verification (authoritative, after every audit fix)

contracts build PASS · api lint PASS · web typecheck PASS ·
web specs 27/27 (wizard model, hub model, policy model, review steps, i18n) ·
api specs 51/51 (3 substitute suites, menu-entitlement binding, runoff-matrix catalog, permission registry).
`apps/web/next-env.d.ts` regenerated by typecheck was reverted; no `package.json` was touched.

Design conformance spot-checks: the consent checkbox blocks the document-type/VAT mutation (no silent rewrite
left); version history and supersede sit in a collapsed `<details>` on the done step only, never in the signing
path; no download button anywhere; `mayApproveSubstituteReceipt` is the single OWNER-aware predicate imported by
the hub model, the wizard, and `DocumentReviewSection`.

## Verification (Phase 4)

The requested commands were run in order. The sandbox could not reach the npm registry and its writable pnpm
store differs from the read-only store behind the existing `node_modules`, so `corepack pnpm install` did not
install `pdf-lib`. Consequently the first API lint and focused-test attempts failed only on the missing module;
web typecheck passed. With the exact `pdf-lib@1.17.1` already present in the local Codex runtime cache exposed
temporarily for verification, API lint passed and the focused test passed 2/2. The rendered page was 34,862
bytes and measured 2.339% dark pixels. `git diff --check` also passed.

The host still needs to run the four handoff commands after a normal dependency install and perform the
Docker build, which was expressly excluded from this run. The Docker runner now installs Noto Sans Thai and its
post-sharp-copy smoke check fails the build below 1,000 dark pixels.

Phase 4 handoff mismatches found: the named file list omitted the repository method needed to resolve the issued
artifact's storage coordinates (`prisma-expense.repository.ts`) and omitted the shared `IconBtn` file that needed
a primary-action tone (`ExpensesWorkspacePanels.tsx`). The existing `ICON.download` already existed and required
no change.

## Live verification against a running app (2026-08-06)

Migration applied to the local dev database (compose project `docker`, postgres on :15432 — **not** the
`watchdogfresh` project the older note describes). Both substitute tables were empty, so the
DESIGNATED_APPROVERS backfill touched nothing. API and web were built from this tree and run on :3011/:3211 so
the owner's 20-hour-old containers were left untouched.

Two blockers that every typecheck and unit test had reported green:

1. **The sidebar never gained the menu entry.** `feature-entitlements.ts` only decides what a company may buy;
   the sidebar is a hardcoded list in `web-core-workspace.logic.ts` and had no substitute-receipt item at all.
   The page existed, was reachable by URL, and was still invisible — the original complaint, unfixed. Any future
   nav work must edit that file; the catalog is not the nav.
2. **A solo owner still could not approve.** `issueSubstituteEvidence` re-checks separation of duties inside its
   advisory-locked transaction (correct — it is the only race-safe place) but hardcoded the two-person rule. The
   owner passed every use-case guard and hit a 409 from the repository. The guard now takes `allowSelfApproval`,
   set from the policy expression rather than from whether this call happens to be a self-approval. Specs on
   both approve paths assert the flag. **Mocked-repository specs cannot see repository-layer guards** — worth
   remembering for the next change to this module.

Proven on the running stack: no-policy company reports `ready: true, approvalMode: OWNER_SELF`; one OWNER drove
a fresh expense to ISSUED alone and the artifact contains the self-signed footnote and the Thai baht words;
switching to DESIGNATED_APPROVERS refuses that same journey at prepare (control intact, company restored
afterwards); the wizard's consent checkbox actually gates the classification change; the hub renders eye/pencil
per row state.

Three test certificates remain in the dev database so the hub has data to show.

Commits: `265f8578` (phases 1–3) and `87d27cb1` (the two live fixes), branch `20260804`, unpushed.

## Phase 4 (PDF) and payee identity — 2026-08-06

**PDF: sharp, not resvg.** The plan called for `@resvg/resvg-js`; measuring made it unnecessary. `sharp` is
already an `apps/api` dependency and the Dockerfile already carries its Linux binaries past the `--no-optional`
prod install, so rasterising costs nothing new. Only `pdf-lib` (pure JS) was added.

**Thai text fails silently without a font — guarded twice.** Probed in a real `node:22-bookworm-slim`
container by counting dark pixels on the document title: bare image 444 (text effectively absent, **no throw**),
with `fonts-noto-core` 14 331. So the renderer rejects an implausibly low ink ratio *and* the image build runs
the same probe. `fonts-noto-core` is ~42 MB; everything but the Noto Sans Thai/Latin faces is deleted in the
same layer. The document renderer already asks for "Noto Sans Thai", so the PDF matches the browser.

The PDF is generated on demand and deliberately **not** cached as an attachment: the SVG stays the single
immutable, checksummed artifact and the PDF is a rendering of it. The document number is passed into the
renderer rather than regex-scraped out of the SVG (Codex's first version did the latter — it would have broken
silently the next time the layout changed).

**Payee identity — the snapshot-compatibility scare, settled.** A Codex run stopped, correctly, on the handoff's
stop condition after finding that approval re-hashes a stored snapshot and compares it to
`snapshotChecksumSha256` (`substitute-receipt.use-case.ts:481-482`). The observation is right; the conclusion
was not. `canonicalSnapshotHash` hashes the stored `snapshotJson` **read from the database and merely cast** to
the type — `sortJsonKeys` walks runtime keys and never consults TypeScript. Measured: a legacy object hashes to
`8cbf6eb8…` before and after the type change, and identically again with `payee: undefined` (sortJsonKeys drops
undefined). Only new snapshots that actually carry a payee hash differently, as intended.

The real requirement was in the renderer: `payee` optional, block omitted when absent, or approving a
pre-change certificate would throw at re-render. Proven end to end against the running stack: an evidence row
whose stored snapshot has no `payee` key approved successfully (201 → ISSUED) and its PDF downloaded.

**If you add a field to the snapshot again:** the checksum is safe, the renderer is not. Make it optional and
render it conditionally.

## LINE handoff notification — verified, and one deployment hazard found

Wired through the existing queued rail (`CreateOrUpdateNotificationEventUseCase` → `NotificationDelivery` →
30 s `delivery.sweep` worker → shared-OA push), so preferences, quiet hours, dedup, retry and idempotency come
for free. Not `pushSystemLineMessage`, which bypasses all of that and is reserved for security notices.

Proven against the running stack:

| case | result |
|---|---|
| prepare with **myself** as payer | **no notification event at all** — the actor is excluded |
| prepare with another employee as payer | exactly one event, recipient exactly that employee |
| delivery rows | one WEB (SENT) + one LINE per recipient |

The self-exclusion matters most in the solo-owner flow: without it, certifying would immediately tell the owner
that a certificate awaits *their* approval, seconds after they signed it.

### Deployment hazard: a new trigger key + a rolling deploy silently drops notifications

While testing, the LINE row came back `PREFERENCE_SUPPRESSED` even though `DEFAULT_ENABLED_CHANNELS` includes
`line` and the recipient had no preference row. Cause: the worker sweeps against whichever API instance answers
`/internal/notifications/delivery-sweep`, and the **old** container was answering. `ProcessQueuedDeliveryUseCase`
defaults `enabledTriggers` to *its own* `IMPLEMENTED_TRIGGER_KEYS`, so an instance that predates the new key
suppresses the delivery — and `suppressed` is terminal, never retried.

Re-queuing the row and sweeping through the updated API turned it into
`SKIPPED / NO_LINE_DELIVERY_TARGET` (that seed employee has no linked LINE identity), which is the correct
outcome and confirms the key is recognised.

**So: whenever a trigger key is added, deploy the API before or with the producer, and expect notifications
emitted during a mixed-version window to be lost rather than delayed.** Worth a look at whether an unknown
trigger key should defer instead of suppress — logged here rather than changed, because it is the notification
module's decision, not this feature's.

## Closing verification — what is and is not proven

**The Docker font layer works; the full image cannot be built on Apple Silicon.**
`docker build` fails at the clamav step because the Dockerfile hardcodes
`clamav-1.5.3.linux.x86_64.deb`; retrying with `--platform linux/amd64` fails even earlier inside colima
("failed to get destination image"). Both are pre-existing repo/host constraints, unrelated to this work — but
they mean **the font smoke check has never run inside a real image build here**. Verified instead by executing
the exact added Dockerfile lines in a `node:22-bookworm-slim` container:

```
fonts kept       NotoSansThai-{Bold,Regular}.ttf + NotoSans-{Regular,Bold,BoldItalic}.ttf
font dir size    1.6 MB  (down from ~42 MB installed)
smoke check      4224 dark pixels   (threshold 1000)
```

So the layer is right; confirm it on the first real amd64 build, which is exactly what the in-build check
exists to catch.

**The full API suite is red, and was red before this work.** `pnpm --filter @watchdog-bms/api test` fails in
`pretest` on `prisma-reimbursement.repository.draft-submit-race.spec.ts` with
`legacy_reimbursement_approval_path_disabled` (409), 9 of 14 subtests. Attribution was proven rather than
assumed: a worktree at the pre-session commit `07327d62` fails the **same spec with the same 9 failures and the
same error**. Nothing in this task touches `modules/reimbursements` (`git diff --name-only 07327d62..HEAD`).
Do not treat that red as a regression here; it needs its own investigation.

**Never verified, and cannot be from this machine:** an actual LINE push to a phone. No employee in the local
seed has a linked LINE identity (`ExternalIdentity` where `provider='LINE'` returns 0 rows), so the delivery
correctly resolves to `SKIPPED / NO_LINE_DELIVERY_TARGET`. Someone has to link a real account by QR before the
end of that path is exercised.

## Scheduled removal — the legacy inline substitute form

Owner decision 2026-08-06: once the wizard is settled, **delete it** rather than leaving two ways to do the same
thing. Recorded here so it does not quietly become permanent.

**Correction to what earlier notes (and commit `265f8578`) claimed.** They said the
`ยืนยันและลงบัญชี` unlock depends on `DocumentReviewSection`. It does not:
`expenseSubstituteReceiptReady(detail)` reads the expense detail payload, and `ExpenseReviewPage.tsx:262`
calls it directly. The component has exactly one consumer (`ExpenseReviewPage.tsx:520`) and the confirm gate
survives its removal untouched.

**What is actually being removed is a sub-block, not the component.** `DocumentReviewSection`
(`ExpensesPages.tsx:367-814`) does two jobs. Keep the first, delete the second:

- *Keep* — document classification: `docType` / `taxStatus` / `categoryId` state, `saveDocumentReview`, the
  attachment list and viewer. The wizard does not replace this; it is how a reviewer classifies any expense.
- *Delete* — the substitute sub-panel: `showSub`, `prepareSubstitute`, `certifySubstitute`, `approveSubstitute`,
  `supersedeCurrentEvidence`, `supersedeReason`, the payer/evidence pickers and the signature UI. All of it now
  exists in `SubstituteReceiptWizardPage`.

After deleting, replace it with a read-only status line plus the wizard link that is already there, so the
detail page still tells a reviewer where the certificate stands.

**Exit criteria — all four before deleting:**
1. The owner has issued at least one real certificate through the wizard and is satisfied with it.
2. Phase 4 (or the print fallback) has landed, so nobody needs the old screen to get a document out.
3. ~~`e2e/expenses.spec.ts` no longer reaches the substitute flow through the inline panel.~~ **Already
   satisfied** — checked 2026-08-06: EXP-05 and EXP-08 are the only substitute references and both clear the
   gate with a real attachment through the API; no e2e drives this form.
4. A wizard happy-path e2e exists, so the deletion has a regression net.

## Open questions

- Solo-owner mode means one person satisfies both signatures. Confirm with the owner's accountant that this is
  acceptable for their filings before it ships to production tenants. **Still open** — the owner confirmed the
  product behaviour on 2026-08-06 but that is not a tax opinion, and nobody here is qualified to give one.

## Phase 7 — printable ใบสำคัญรับเงิน

- Added the read-only `GET /v1/companies/:companyId/expenses/:expenseId/payment-voucher.pdf` endpoint behind
  `expense.read_own`. It delegates expense access and branch-scope enforcement to `GetExpenseUseCase`.
- The unsaved step-2 payment date, payee name, address, and tax ID travel as optional query parameters. The API
  reuses `parseExpectedDate`, `optionalText`, and `optionalPayeeTaxId`; name falls back to `vendorNameSnapshot`.
- The SVG renderer reuses the certificate's Thai word wrapping, XML escaping, money/tax-ID formatting, and
  `thaiBahtText`, then passes the result through the existing guarded PDF renderer. It stores nothing.
- Wizard step 3 shows the secondary print action only for cash payments and reuses the existing authenticated
  binary download helper. The saved filename is `ใบสำคัญรับเงิน-<expenseNumber or expenseId>.pdf`.
- Handoff mismatch: the existing certificate renderer uses abbreviated Thai months (`ส.ค.`), despite the handoff
  saying full months are its convention. The voucher uses the required full form (`6 สิงหาคม 2569`) without
  changing the already-applied certificate phase.
- Handoff mismatch: its query example omitted `paymentDate`, but that value is unsaved at wizard step 3 too.
  The endpoint accepts it as another optional primitive so the stated "prefilled when known" behavior works;
  when absent, it still falls back to `expense.paidAt` and then to a ruled blank.

Verification, in the handoff's exact order: API lint PASS; web typecheck PASS; payment-voucher renderer spec
3/3 PASS; workspace i18n spec 4/4 PASS. A generated A4 sample was also rasterized with macOS `sips` because
Poppler is unavailable; visual inspection found no missing Thai glyphs, clipping, overlap, or misaligned rules.

## Phase 8 — notify the next signer through the queued LINE rail

- Preparation targets the selected payer; certification resolves active, branch-eligible `expense.confirm`
  members and intersects them with configured IDs in `DESIGNATED_APPROVERS` mode.
- One shared helper filters the acting `ctx.userId` before enqueue and skips an empty recipient list, covering
  self-preparation and solo-owner certification.
- Both producers use `CreateOrUpdateNotificationEventUseCase` with `severity: action` and the evidence deep link.
  Recipient resolution/enqueue failures are warned and swallowed after the business mutation succeeds.
- Registered `expense.substitute_receipt_signature_pending` in `IMPLEMENTED_TRIGGER_KEYS`, imported
  `DashboardNotificationsModule` into expenses, and changed the bilingual waiting copy to explain the LINE
  notification while retaining manual link copy.
- Corrected `notification-line-push-wiring.md`: the 30-second worker sweep and `ProcessQueuedDeliveryUseCase`
  shared-OA delivery path are implemented, not future design.

Verification, in the handoff's exact order: API lint PASS; web typecheck PASS; focused API suites 22/22 PASS;
workspace i18n suite 4/4 PASS.

Handoff mismatch: `ScanCrmSlaBreachesUseCase` does isolate notification failures as described, but
`CrmPaymentProofUseCase` currently awaits notification creation without a catch. This phase copied the verified
SLA-scanner catch/warn pattern.

## Next

1. Run the wizard happy-path e2e only when explicitly authorized; this phase did not start a server or run e2e.
2. Keep the printable voucher stateless; a photographed, signed copy enters the existing payment-evidence upload
   path rather than becoming a generated attachment.
