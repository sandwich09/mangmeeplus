# Substitute Receipt Evidence Hardening Plan

Status: IMPLEMENTED AND LOCALLY VERIFIED — 2026-07-13

Owner: WatchDog primary agent

Canonical spec: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]

Memory: [[agent-memory/substitute-receipt-evidence-hardening|Substitute Receipt Evidence Hardening Memory]]

Execution roles: the primary WatchDog/Codex agent implements and self-verifies. Claude CLI may only perform read-only development review and test verification. Claude CLI must not edit, implement, stage, commit, or deploy. If private-repository access is blocked, record it and use internal independent reviewers; do not bypass policy.

## Outcome

When finance selects “ใบรับรองรายจ่ายกรณีไม่มีใบเสร็จ”, WatchDog must create a real, readable, immutable, versioned evidence artifact that resolves from the expense detail and accountant export. It must preserve the original evidence, enforce branch and tax boundaries, and never imply that internal evidence is a tax invoice or input-VAT entitlement.

## Audit Gaps Closed — 2026-07-13

The pre-fix audit found the following gaps; the implementation result below closes them:

1. `GenerateSubstituteReceiptUseCase` writes reason/type/tax status/timestamps only; it creates no artifact, attachment, checksum, immutable snapshot, or resolvable version.
2. Web and export claim the document exists: UI shows “created”, and accountant export synthesizes `SUBSTITUTE-*`, even when there is no generated evidence file.
3. Generation overwrites `sourceDocumentType`, losing the original source classification instead of adding a separate evidence role.
4. Internal evidence can retain or later regain claimable VAT. Confirm does not enforce `SUPPORTING_ONLY + NON_CLAIMABLE`; ledger posts VAT amounts, and tax sync creates VAT-input events for states other than `NON_CLAIMABLE`.
5. Generate and signature-fill mutations omit branch ABAC. Generate also lacks an enforced web-only channel guard.
6. Any mutable draft plus a reason is eligible; positive amount, category/account, reviewed tax state, business purpose, claimant/certifier, approver, payment proof, and original/supporting evidence are not required.
7. Signature fill can succeed and write a HIGH-risk audit without a rendered attachment. The web sends only a signature asset id and never renders the selected signature into evidence.
8. Repeat generation overwrites the prior reason/time/reviewer; there is no idempotency, version, superseded state, immutable snapshot, or compare-and-set protection against concurrent confirmation.
9. Substitute reason input truncates silently; malformed/non-string input and unbounded notes are not handled as typed validation errors.
10. Existing tests assert metadata success, including signature-fill success without a rendered artifact; no browser/integration test proves artifact creation, preview, download, export resolution, VAT safety, ABAC, or version behavior.

## Business Decision Matrix

| Scenario | WatchDog route | Tax treatment |
|---|---|---|
| Valid receipt/tax invoice is available | Keep original; no substitute | Review under normal receipt/tax-invoice rules |
| Valid VAT tax invoice was lost/damaged | Request issuer-created replacement tax invoice | No input VAT from internal substitute alone |
| Receipt is missing/incomplete for a real direct company expense | `ใบรับรองแทนใบเสร็จรับเงิน` personally certified by the employee who paid, with supporting/payment proof and authorized approval | `SUPPORTING_ONLY`, `NON_CLAIMABLE` until valid external tax invoice exists |
| Direct payee can acknowledge payment | Capture payee receipt/identity fields required by policy and payee acknowledgement | Supporting expense evidence; VAT still needs valid tax invoice |
| Employee reimbursement | Reuse item 14 requester, manager/finance approval, voucher, and payment facts | Item 14 owns reimbursement approval/payment; item 09 supplies evidence refs |
| Quotation, quantity-only order, appointment, booking, reservation, unrelated/unreadable image | Not eligible | Not expense evidence until separately resolved through correct source flow |

## Phase 0 — Immediate Truth and Safety Gates — COMPLETE

- Stop returning “created” unless artifact-backed evidence exists. Legacy timestamp-only rows display `หลักฐานใบแทนยังไม่สมบูรณ์` and remain blocked for confirm/export-as-evidence.
- Add one shared eligibility validator used by generate and confirm: tenant, branch ABAC, web channel, permission, mutable status, resolved non-expense classification, positive amount, category/account, business-purpose details, reason, and reviewed tax state.
- Enforce internal evidence invariant at generation, generic update, confirmation, source-posting input, ledger, and tax sync: `SUPPORTING_ONLY`, `NON_CLAIMABLE`, and no VAT-input event from internal substitute evidence alone.
- Make update compare-and-set by company/id/expected mutable status or run generation in a transaction so a concurrent confirm cannot be modified afterward.
- Bound and type-check reason/note inputs; reject instead of silently truncating.

Exit: current false-success, VAT leakage, cross-branch mutation, malformed input, and confirm/generate race paths are blocked by focused tests.

## Phase 1 — Evidence Model and Migration — COMPLETE

- Add the smallest separate substitute-evidence record rather than overloading `ExpenseRecord`: company/expense/branch, evidence subtype, version/current/superseded state, document number, idempotency key, immutable snapshot JSON, checksum, artifact attachment id, original/supporting/payment evidence refs, reason code/detail, actual payer/certifier identity and position, authorized approver, attestation/signature timestamps, issued timestamps, and audit provenance.
- Preserve `ExpenseRecord.sourceDocumentType`. Treat existing `sourceDocumentType = SUBSTITUTE_RECEIPT` plus timestamp/no artifact as legacy incomplete state; do not fabricate an artifact or original classification during migration.
- Keep subtypes explicit enough to distinguish employee/company certification, direct payee acknowledgement, and reimbursement-owned voucher references. Do not create a second item 14 payment approval model.
- Add retention/append-only rules for confirmed original, generated, signed, and superseded evidence versions.

Exit: migration is additive; legacy rows fail closed; current artifact/version can be resolved without synthetic references.

## Phase 2 — Deterministic Artifact Generation — COMPLETE

- Build the artifact from the immutable snapshot, not live mutable expense fields.
- Render the canonical title `ใบรับรองแทนใบเสร็จรับเงิน`, legal company/branch identity, expense/payment date, itemized description and quantity where applicable, amount/total in numbers and Thai words, reason, actual payer name/position and company-business certification, payer signature/date, approver signature/date, document number/version, and supporting/payment evidence references.
- Prefer an existing repo-native renderer/export primitive. If no renderer can produce readable Thai, store a canonical UTF-8 printable snapshot/artifact first and add one narrowly justified Thai-capable PDF path only after proving no existing primitive works.
- Store checksum, byte size, MIME type, artifact attachment, and `expense.review.evidence` link atomically with the evidence version.
- Generation failure leaves no issued status, no synthetic export ref, and no partial link.
- Retry with the same idempotency key returns the same artifact/version; deliberate regeneration creates a new version and supersedes the old one without deleting it.

Exit: artifact opens from API/web and its checksum matches the issued snapshot; edits to the expense do not rewrite an issued version.

## Phase 3 — Certification, Approval, and Signature Semantics — COMPLETE

- Separate actual payer/certifier, authorized approver, and direct payee acknowledgement roles. Only the employee recorded as the actual payer may personally certify the company-business expense; finance cannot sign on that employee's behalf.
- A reusable company signature may fill only the role it was approved for; it is not automatically the payee signature or employee certification.
- Require an actual rendered artifact id and checksum/version match before recording signature fill. Render/link/fill must be atomic or compensating-clean.
- Fix signature-list permission alignment: reviewers can list ACTIVE fillable assets; managers/admins/staff see only actions they can execute.
- Preserve every signed version and expose fill history in the expense detail.

Exit: no success/audit state exists without a readable signed artifact tied to the exact evidence version.

## Phase 4 — Web Review Journey — COMPLETE

- Show the action only to users who can review and only for eligible states.
- Replace the one-field reason form with required subtype/reason, business purpose, reviewed amount/items/category/tax, payment proof, actual payer/certifier name and position, certification acknowledgement, and approver summary. Reuse already-reviewed expense data and ask only for missing fields.
- Show explicit guidance for lost VAT invoices: request an issuer replacement; internal evidence will not preserve input VAT.
- Provide preview before issue/sign, issued/superseded/legacy-incomplete states, artifact download, attachment-purpose list, version history, and clear loading/forbidden/error/empty states.
- Do not silently swallow signature-list 403/network errors or silently truncate reason text.

Exit: finance can complete the journey without raw ids; staff without review permission never see a dead action.

## Phase 5 — Confirmation, Posting, Export, and Retention — COMPLETE

- Confirm requires a current issued artifact when missing-receipt policy relies on substitute evidence; a text reason alone is insufficient.
- Posting input includes source-document and tax-evidence provenance. Ledger does not debit input VAT for `NON_CLAIMABLE`/internal evidence; tax sync does not create an active VAT-input event.
- Accountant package emits a substitute reference only when it resolves to the current artifact in the evidence manifest; original/supporting/superseded files remain available according to permission and retention policy.
- Normal delete cannot remove confirmed or retention-active original/generated/signed evidence.

Exit: expense → ledger → tax → accountant export remains consistent and evidence-resolvable.

## Implementation Result — 2026-07-13

- Added additive Prisma evidence/version state with `PREPARED`, `PAYER_CERTIFIED`, `ISSUED`, and `SUPERSEDED`, complete database state checks, current-version uniqueness, immutable snapshot/checksum fields, bound payer/approver signatures, artifact links, retained evidence references, and supersede reason/history.
- Added deterministic UTF-8 SVG generation from the frozen snapshot. The artifact carries the Revenue Department-aligned title, company/branch, expense and payment dates, detail, quantity, amount, note, numeric and Thai-word total, reason, business purpose, evidence references, payer certification/signature, separate approval, document/version, and internal-evidence tax disclaimer. Long required values wrap without dropping tail content.
- Added preview-before-sign and certified-artifact-before-approval checksum acknowledgements. Payer and approver signatures are evidence-and-role-bound uploads whose bytes, MIME type, metadata, and checksums are revalidated. Raw signature ids are excluded from ordinary responses/downloads.
- Added advisory locks and compare-and-set handling across preparation, material expense edits, certification, approval, confirmation, and retention/delete. Confirmation writes its outbox event in the same transaction. Signed/issued evidence and referenced source/support/payment/signature artifacts cannot be mutated or deleted through ordinary paths.
- Preserved original document classification and attachments. Finance override cannot make quotation/order/appointment/booking/reservation/non-business classifications eligible. Receipt/tax-invoice cases require an unavailable or materially incomplete reason. Internal evidence forces `SUPPORTING_ONLY` and `NON_CLAIMABLE`; ledger/tax sync recognize input VAT only for the exact `CLAIMABLE + USABLE_FOR_TAX` external-evidence state.
- Manual web upload now sends the selected branch and the API resolves the same branch for upload intent and expense. Web uses the same non-expense block/finance-override gate, separates source/supporting evidence from payment proof, requires payment date/method and business purpose, previews the unsigned form, requires the payer to sign, requires a distinct approver, supports supersede/history, and blocks confirm until the issued artifact exists.
- Accountant list/folder/export and artifact download paths enforce branch scope. Export references the substitute only after the artifact resolves into the manifest.

## Verification Matrix

- Unit: eligibility scenarios, positive total, business/category/tax prerequisites, reason/note validation, VAT invariant, source-type preservation, version/idempotency, immutable snapshot/hash.
- API/use case: permission, cross-company hiding, branch ABAC, LINE rejection, compare-and-set race, atomic artifact link, retry/regenerate, rendered-signature requirement, retention delete blocker.
- Ledger/tax: no input-VAT journal/event from internal substitute; valid issuer-created replacement follows the normal tax-invoice path.
- Web: permission-gated action, complete form validation, preview/issue/sign/download/version states, typed errors, signature picker permissions.
- Integration: missing/incomplete receipt -> supporting/payment evidence -> issued artifact -> optional rendered certification/approval -> confirm -> posting/tax guard -> accountant manifest resolves artifact.
- Regression: valid receipt, lost VAT invoice, quotation/order/appointment/booking/non-financial image, legacy timestamp-only substitute, retry, concurrent confirm, and evidence deletion.
- Browser: finance happy path plus staff forbidden path on manual web upload. Record exact runtime limitation if authentication or object storage prevents the smoke.

Recorded result 2026-07-13:

- 57/57 focused substitute lifecycle/artifact/branch/download/delete/retention/manual-upload/document/export tests passed.
- 44/44 focused AI Gateway classification tests, 62/62 API document/status/VAT ledger-tax-source tests, and 5/5 web expense logic tests passed.
- Contracts/AI Gateway/API/web typechecks, Prisma generation, API build, clean Turbopack production web build, fresh 58/58 migration, and seed passed.
- Authenticated browser smoke passed manual upload, selected-branch propagation surface, expense detail, and the guarded pre-sign form. The local seed has one payer candidate, so exact payer plus distinct-approver issuance remained API-lifecycle evidence rather than fabricated browser data.

## Recommended Smallest Fix Sequence

1. Phase 0 safety gates and failing tests.
2. Phase 1 evidence row/migration and legacy fail-closed behavior.
3. Phase 2 real artifact plus resolvable export reference.
4. Phase 3 real signature/certification semantics.
5. Phase 4 web journey.
6. Phase 5 posting/tax/export/retention integration and browser proof.

Checklist item 09B may be marked complete because all six phases passed focused verification and the authenticated production-build browser path reached the guarded pre-sign journey. Exact payer certification and distinct-approver issuance are covered by API lifecycle tests; the one-user local seed was not modified to fabricate browser approval evidence.

Reference note: the Revenue Department accounting-evidence guide is primary and its example form/attestation is the canonical field baseline for WatchDog. The linked public-sector บก.111 page is secondary layout context only; WatchDog renders the private company's identity and never labels the artifact as an official government บก.111 form.
