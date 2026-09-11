# Expense evidence routing: implementation verification

Date: 2026-09-11. Existing branch `codex/substitute-step3-edit-20260910`, base `d6abe87e`, including prior uncommitted work. No merge/deployment/cloud operation. This report supersedes the **implementation status**, not the historical observations, in the [baseline proof](expense-evidence-recovery-proof-2026-09-11.md).

## Implemented behavior

- Source receipts, including abbreviated tax invoices and complete handwritten bills, can use their reviewed source file without an internal substitute certificate. A selected file may be in a supporting slot.
- An authorized reviewer can accept alternative evidence with the selected active files and a reason. This remains supporting/non-creditable evidence; review does not create a payment, VAT entitlement or a tax-deductibility ruling.
- A substitute certificate is an explicit third choice. Its existing cash/payment proof, signing, funding, numbering, amendment, correction and financial locks remain authoritative.
- Step 2 can save incomplete selections on the same expense. Save draft is separate from Save review; Next/new prepare/final confirmation require the current review where applicable. No accountant assignment, queue, send action or new permission was added.
- Web and LINE use the permission-checked review use case. Final confirmation and number reservation recheck in the database transaction. Generated artifacts and certificate-owned fields do not create a review/issue dependency cycle.
- The review snapshot is semantic: JSONB property order, decimal formatting, unrelated files and harmless saves do not invalidate it. Changed selected files, money, classification or a new OCR request do. Rereading OCR preserves the user's evidence choice and prior review history without approving the new extraction. Deleted selections remain visible/removable rather than losing the user's reason.

## Executed checks

| Evidence | Result | Practical boundary |
|---|---|---|
| [Runnable focused checks](expense-evidence-implementation-checks-2026-09-11.sh) | API/contracts 761 + web 111 passed; 0 failed/skipped | Domain, use-case, repository mock-transaction, LINE and web-model assertions; not 872 browser journeys |
| PostgreSQL source-continuity suite | 17 passed, 0 failed/skipped | Real local PostgreSQL, source/CAS/signing continuity |
| API + web TypeScript | Passed | API needed a 10 GiB Node heap; default heap exhaustion was rerun successfully |
| Existing Playwright expense suite | EXP-05, EXP-08, EXP-EVIDENCE: 3 passed, 0 skipped | Actual UI/API/local storage; rerun after final API build/contracts update |
| Three route journeys below | Passed through final confirmation | Browser review + API/database; SRC also real local object storage and synthetic paper signing |
| Responsive smoke | 390 px fresh mobile context has no horizontal overflow; desktop 1440 inspected | Not the complete device/zoom/keyboard/usability matrix |

Run focused checks from repository root:

```sh
bash docs/research/expense-evidence-implementation-checks-2026-09-11.sh
NODE_OPTIONS=--max-old-space-size=10240 node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json
node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json
```

With the existing isolated local services/dev-auth configured, run the existing Playwright harness:

```sh
S3_E2E=1 node_modules/.bin/playwright test e2e/expenses.spec.ts --project=chromium --grep 'EXP-EVIDENCE|EXP-05 |EXP-08 '
RECEIPT_SOURCE_DRAFT_TEST_DATABASE_URL="$DATABASE_URL" apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/expenses/expense-source-draft.pg.spec.ts
```

This worktree reuses installed workspace dependencies. The local runner supplied `NODE_PATH` for contracts and used the Playwright CLI belonging to the same installation as the harness. Initial module-resolution/duplicate-Playwright errors were test-environment setup failures, corrected before the passing run. No package.json changes.

## Actual route journeys

1. **Source document:** pending selections saved/reloaded without approval; abbreviated receipt chosen from a supporting slot; explicit review persisted through PostgreSQL JSONB/reload; Next and actual ready/confirm succeeded; no certificate.
2. **Alternative evidence:** transfer proof required a selected file and written reason; a real concurrent API change caused 409 and preserved the form input; deliberate reload/re-review succeeded; final confirmation succeeded without certificate/VAT credit.
3. **Substitute certificate:** explicit review with no attachment; opening the wizard reserved no number; prepare reserved one certificate for the payment month; unsigned PDF downloaded; a PDF clearly marked SYNTHETIC TEST ONLY was uploaded to local MinIO, reviewed, accepted and issued; expense confirmation succeeded with the same certificate ID/number. No real person's signature or external LINE message was used.

The first two route fixtures used synthetic file metadata; their preview returned 404. Their passing results establish evidence identity/review/routing/final acceptance, **not image rendering**. The third route and existing EXP-05/08 exercised real upload/storage. Initial synthetic-paper harness failures (URL composition and forwarding browser cookies to MinIO) were corrected by using the returned upload URL/headers with an unauthenticated upload request.

## Acceptance matrix status

“Layer pass” means the cited behavior is covered by executed unit/integration assertions; it does not mean every wording of the broad acceptance case was driven in a browser. “Partial” identifies an unexecuted part.

| Cases | Status / evidence |
|---|---|
| T01 | Partial: abbreviated source browser→confirm passed on synthetic 100 THB; 680/44.49 printed amounts covered in shared-contract tests, not that exact photograph E2E |
| T02–T04 | Layer pass: existing invoice/VAT validation, complete/incomplete handwritten classification, missing-fact guards; blurry-image reupload UX is not a new OCR accuracy claim |
| T05–T06 | Browser/API pass for alternative and supporting-slot source; selected file authority/audit assertions also pass |
| T07–T08 | Layer pass: partial-save/fact guards, required alternative reason/files; real third-party voucher image not separately tested |
| T09–T12 | Layer pass: cash/strict/noncash/classification/check-bill guards; zero-attachment synthetic paper route also confirmed; high-value policy and all unpaid scenarios not separately browser-driven |
| T13–T16 | Browser/API + layer pass: explicit save, reopen, stale change, no-op/JSONB/decimal consistency |
| T17 | Layer pass: extraction/CAS, retained human metadata, new OCR revision invalidates review; external OCR service not called in this round |
| T18 | Real 409 browser pass; network/server/auth failure handling layer coverage, not every outage injected |
| T19–T21 | Layer pass: direct prepare/confirm without review, forged/foreign files, branch/role restrictions, final transactional recheck; zero number reservation on refused new prepare |
| T22 | Partial: no-file reviewed expense→new wizard→prepare/sign/issue passed; brand-new standalone wizard creation not separately rerun |
| T23 | Layer pass: LINE target selection, explicit decision/revision rebinding, signatures and paid check-bill route; no external messages sent |
| T24–T25 | Layer + PostgreSQL pass: existing amendment/date/number/source continuity; old PREPARED/PAYER_CERTIFIED amendment does not require a new v2 marker first |
| T26–T29 | Layer pass: finalized/correction/payment/idempotency boundaries and source VAT/WHT regressions; synthetic COMPANY full-paid paper route also passed |
| T30–T31 | Layer pass: legacy marker needs re-review only for applicable mutable actions, existing issued/claim authority retained, unavailable selected files invalidate review while choice/reason remains recoverable |
| T32 | Partial: unsigned PDF and issued paper artifact path passed; full status/printing matrix not rerun |
| T33 | Partial: mobile390 + desktop1440 smoke; full1024–1920, 200% zoom and keyboard acceptance not completed |
| T34 | NOT RUN: representative older/non-accounting users are required; automation cannot establish their comprehension |
| T35–T36 | Layer pass: selected source goes to VAT validation; source changes conflict; generated certificate/payment facts do not create stale-review loops; actual certificate final path passed |
| T37–T39 | Browser/API + layer pass: incomplete step-2 draft save/reopen without approval/accounting handoff/SRC; unknown source facts remain protected by existing ready/confirm validation |
| T40 | Partial: real CAS preserves inputs and success/refetch handling implemented; session expiry/partial network failure not exhaustively browser-injected |
| T41 | Layer pass for existing currency/funding/renderer/financial restrictions; these are actionable waiting states, not promises of automatic completion |
| T42 | Partial: all three supported routes completed against actual API/DB; recovery actions mapped below. Every failure in all 28 states was not separately driven through browser |

## Recovery actions and persistence boundaries

This maps the original 28-state model to implemented/existing paths. It does not replace the execution limits above.

| Model states | Action / implementation / persistence |
|---|---|
| PENDING_REVIEW, REVIEW_DIRTY | DocumentReviewSection Save draft → PATCH review-fields with expectedUpdatedAt; saved choices reopen on the same expense; Save review separately binds the current facts |
| CERT_DETAILS | Existing wizard retains in-progress details in principal/company-scoped session storage; prepare persists the certificate after validation. Session storage is not durable server/offline storage |
| PREPARED, SIGNED | Existing wizard/form/download/signing endpoints keep the same certificate; authorized review/approval proceeds after real requirements are met |
| MISSING_PROOF, CASH_STRICT | Save draft, attach/select actual proof, re-review; existing prepare policy still applies |
| UNKNOWN_AMOUNT | Existing source-draft save retains known facts; amount required at existing completion boundary |
| CHECK_BILL_UNPAID | Keep draft; paid-check-bill continuation requires explicit paid decision and separate proof, never fabricates payment |
| NO_REVIEW_PERMISSION, NO_CONFIRM_PERMISSION | Existing update/view actions only; authorization errors remain. No new handoff queue or role escalation |
| ACCESS_REVOKED, SESSION_EXPIRED | Existing auth/access handling; obtain permitted session and refetch current revision; no guaranteed save after revocation |
| NETWORK_FAILED, CAS_CONFLICT | Keep unsent form state in the current session; retry or reload/compare deliberately; no false success/unlock |
| READ_ONLY, ISSUED_CHANGE, CLOSED_PERIOD | Existing view/history/download/correction/cancellation and period guards; new route choice does not mutate finalized finances |
| UNSUPPORTED_CURRENCY, RENDER_LIMIT, PARTIAL_FUNDING, NO_APPROVER | Existing wizard reports actual unsupported/missing requirement and retains current work according to its draft/session boundary; no invented amount/signature/truncation |
| POSSIBLE_DUPLICATE, KNOWN_DUPLICATE | Existing duplicate review/open-original flow; no extra expense/payment from evidence review |
| VAT_DIFFERENCE, WHT_CLASS_MISSING | Existing source-VAT acceptance/line correction and payee-class validation; evidence review grants no tax authority |
| SOURCE_CHANGED_AFTER_SIGN, REJECTED | Existing mutable amendment/review flow, new signature where required; finalized source uses correction instead |

## Cleanup and release limits

Exact test-owned IDs from this round's manifests and Playwright annotations were inspected before deletion. Cleanup removed **9 synthetic expenses, 1 certificate, 1 payment and 10 attachment records**; 8 exact local MinIO keys were deleted and verified absent. Remaining scoped expense/certificate/payment/attachment/outbox/journal/document-number counts are all zero. Document sequence counters were not reset or reused. No customer/company records or production data were touched.

[Machine-readable evidence](expense-evidence-implementation-evidence-2026-09-11.json) records fixture IDs, source hashes and counts. [Mobile smoke screenshot](expense-evidence-implementation-mobile-2026-09-11.png) shows the pending state; it is not a usability study.

Review metadata is additive JSON; no schema migration/new dependency. Roll out backend/contracts with matching FE/LINE behavior before exposing new routes. Unreviewed legacy mutable drafts need explicit review when progressing; issued/claim/amendment authority remains supported. A rollback must retain reading and processing of accepted alternative evidence, not delete it or silently force certificates. CI full-suite, UAT, Production, merge and T34 usability were not performed in this implementation round.
