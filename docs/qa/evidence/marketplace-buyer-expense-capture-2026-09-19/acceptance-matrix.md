# Acceptance matrix — buyer expense capture, 2026-09-19

Every row of spec §10 (A01–A88), §14.2 (IG01–IG29), §17.2 (UXE-01–27), §18.4 (NR01–NR09) and
§18.1–18.2 (CC01–CC10), against the tests and the evidence this wave actually ran.

- Branch `codex/mkt-w08-acceptance-20260918`, base `9c1f9dad`.
- `PASSED` is used **only** where a named test below ran green in this wave. It is not a promise
  about a deployed environment.
- `PARTIAL` means the machine-checkable half is proven and the row also asks for something this
  wave did not run: a deployed environment (UAT/production), real LINE, an authorised Thai document
  bundle, or a usability session with 40+ users.
- `NOT_RUN` means nothing in this wave exercises the row at all. The reason is always one of
  **real LINE**, **UAT/production**, **UX 40+**, or **authorised bundle**.
- Nothing on a deployed environment was touched. Everything here is local, in-process, or against a
  throwaway Postgres — except the capture read benchmark, which called real Bedrock with synthetic
  fixtures under the owner's THB 100 authorisation
  ([research note](../../../research/expense-capture-read-benchmark-2026-09-19.md)).

## W09 (owner decision 2026-09-19) — rows whose proof was a group screen

The owner withdrew the capture-group screens on 2026-09-19 ([appendix
§25](../../../specs/marketplace-buyer-expense-capture-contract-appendix-th.md)). Every row below was
proved by a picture of, or an assertion about, a page that no longer exists. The row's verdict is
therefore **downgraded here, not in place**, so the original evidence stays readable:

| Row | Was | Now | Reason |
|---|---|---|---|
| A14 | PARTIAL | WITHDRAWN | the manifest and the "ทำงานเดิมต่อ/เริ่มงานใหม่" question are deleted; several files are N ordinary uploads |
| A18 | PASSED | PARTIAL | the use-case assertion still runs; `group-handed-derived` photographs a deleted screen |
| A28 | PASSED | PARTIAL | both logic assertions still run; `group-open-facts` photographs a deleted screen |
| A39 | PASSED | PARTIAL | the pg and compatibility assertions still run (the pg one now asserts the expense-list path); `capture-list` photographs a deleted screen |
| A40 | PASSED | PARTIAL | both assertions still run; `group-handed-derived` photographs a deleted screen |
| UXE-16 | PASSED | PARTIAL | `expense-capture-facts.logic.spec.ts` still runs; the mismatch chip had only the group page to appear on |
| UXE-17 | PASSED | PARTIAL | the runner assertion still runs; the "ยังไม่ได้ตรวจ" line had only the group page to appear on |
| A45 | PASSED | WITHDRAWN | the "งานเดิม / ใบใหม่" question is removed with the groups it moved files between |
| A55, A56, A57 (business-use / payer questions) | see rows below | WITHDRAWN | the two questions were only ever asked on the group page |

W09's own evidence is in [`w09/`](w09/README.md): the upload panel with three files, the list right
after, the review page while reading and after the engine's verdict, the auto-split notice, and the
legacy single-image flow unchanged. The controller review on top of W09 (appendix §25.6) changed six
engine/LINE behaviours without adding a screen; its proof is unit-level (runner, notifier, dispatch,
delete, handoff pg spec) plus the intake spec above.

## How this was derived

The verdicts come from the `it`/`test` titles of the capture surface area, read with:

```sh
grep -rn "^[[:space:]]*it(" apps/api/src/modules/expenses/**/*capture*.spec.ts \
  apps/api/src/modules/expenses/expense-capture*.spec.ts \
  apps/ai-gateway/src/modules/line-ai/presentation/http/expense-capture-routes.spec.ts \
  apps/api/src/modules/line-ai/**/*capture*.spec.ts apps/api/src/modules/line-ai/domain/logic/line-*.spec.ts \
  apps/web/src/features/expenses/**/*.spec.ts apps/web/src/features/reimbursements/*.spec.ts
grep -rn "^test(" apps/web/src/features/expenses/**/*.qa.spec.ts
```

and from the suites that were then run (§ "Verification" at the end).

## Counts

| Set | PASSED | PARTIAL | NOT_RUN | Total |
| --- | --- | --- | --- | --- |
| A01–A88 (acceptance) | 65 | 21 | 2 | 88 |
| IG01–IG29 (gap register) | 21 closed | 8 open | — | 29 |
| UXE-01–27 (error UX) | 22 | 5 | 0 | 27 |
| NR01–NR09 (LINE non-receipt) | 9 | 0 | 0 | 9 |
| CC01–CC10 (courier) | 0 | 4 | 6 | 10 |

## A01–A88

Surface key: **U** unit/logic, **PG** real PostgreSQL, **B** browser (this bundle),
**GW** ai-gateway route, **BM** the Bedrock benchmark.

| ID | Status | Proof | Surface | Note |
| --- | --- | --- | --- | --- |
| A01 | PASSED | `expense-upload.use-case.spec.ts` "writes exactly the legacy row when a completion carries no intent"; `expense-extraction.use-case.spec.ts` "leaves the image lane on the synchronous path, with no capture job (A01)"; `expense-list-legacy`, `expense-legacy-review` | U, B | The legacy write is asserted with `deepEqual`, and the legacy page is asserted to carry no group badge |
| A02 | PASSED | `expense-capture-assembly.logic.spec.ts` "A26: the same order panel read twice yields one document and one set of totals" / "A26: two different orders in one checkout stay two documents"; `expense-capture-group.use-case.spec.ts` "completes an upload once…" | U | |
| A03 | PASSED | `expense-capture-allocation.logic.spec.ts` "A03/A04 — ร้านเอ company, ร้านบี personal: 810 and 480" | U | Lands on 810/480/1,290 exactly |
| A04 | PASSED | same row, plus `expense-capture-handoff.use-case.spec.ts` "creates one ordinary expense per scope…" and `expense-capture-handoff.pg.spec.ts` "passes the resolver for the recorded payer and refuses everybody else" | U, PG | |
| A05 | PASSED | `expense-capture-allocation.logic.spec.ts` "A05 — the company paid for personal items: computed and shown, handoff blocked" | U | |
| A06 | PASSED | `expense-capture-facts.logic.spec.ts` "A29/A06 — a coupon the buyer will receive reduces nothing" | U | |
| A07 | PASSED | `expense-capture-assembly.logic.spec.ts` "A25: a subtotal that already includes shipping is not added to the shipping charge again"; `expense-capture-allocation.logic.spec.ts` "splits the NET shipping by the items in the parcel and never counts the gross twice" | U | |
| A08 | PASSED | `expense-capture-allocation.logic.spec.ts` "a printed tax line from an issuer we cannot identify waits for review, it is not zeroed (A08)" / "A04/A08/A17 — an undecided tax stops the claim, not the source" | U | |
| A09 | PASSED | `expense-capture.pg.spec.ts` "resolves a named sibling, still refuses an outsider, and accepts the recorded payer" | PG | |
| A10 | PASSED | `expense-capture-handoff.pg.spec.ts` "gives two concurrent handoffs one batch and the same expense ids"; `expense-capture-certificate.pg.spec.ts` "A20/A10: two approvers issuing the same shop at once record the company payment once" | PG | |
| A11 | PASSED | `expense-capture-review.use-case.spec.ts` "A11 — a second review supersedes the first preview and invalidates an acceptance" / "refuses an allocation computed before a later change (A11)" | U | |
| A12 | PASSED | `expense-capture-facts.logic.spec.ts` "prefers a HUMAN correction over a later AI read of the same file (A12/A48)"; `expense-capture-review.use-case.spec.ts` "writes a new HUMAN observation instead of overwriting the read (A12)" | U | |
| A13 | PARTIAL | `expense-capture-certificate.pg.spec.ts` "§12.4/A22: editing a derived source re-signs its certificate exactly as an ordinary expense does"; `expense-capture-handoff.pg.spec.ts` "sees a paid, posted, confirmed or certified source as consumed too" | PG | The late-invoice/refund journey itself (a second document arriving days later) has no end-to-end run |
| A14 | PARTIAL | `expense-capture-upload.logic.spec.ts` "the manifest survives the tab and is scoped to its company" / "an unfinished group is a question…"; `group-open-summary` | U, B | The four §13.2 state chips are photographed; a 40+ user understanding them is UX 40+ |
| A15 | PASSED | `expense-capture-group.use-case.spec.ts` "answers 404 for another company, so an id cannot be probed across tenants (A15)"; `expense-capture-review.use-case.spec.ts` "A15 — another company's…"; `expense-capture-handoff.use-case.spec.ts` "answers 404 for a group of another company" | U | |
| A16 | PASSED | `expense-capture.pg.spec.ts` "refuses a second derived source for the same issuer scope in one group (§2.3 handoff fence)"; `expense-capture-handoff.pg.spec.ts` "refuses a second source for the same scope even when the group state says otherwise" | PG | |
| A17 | PASSED | `substitute-receipt-capture.use-case.spec.ts` "prepares when the reviewed facts show the shop was paid" / "prints the company share against the amount actually paid… (D04)"; `expense-capture-allocation.logic.spec.ts` "A04/A08/A17 — an undecided tax stops the claim, not the source" | U | |
| A18 | PASSED | `expense-capture-group.use-case.spec.ts` "offers no certificate for a shop that issued a receipt (A18)"; `group-handed-derived` | U, B | The picture shows ร้านเครื่องเขียน with **มีใบเสร็จใช้ได้** and no certificate CTA |
| A19 | PASSED | `substitute-receipt-capture.use-case.spec.ts` "refuses an order that is only waiting to be paid (A23)" and "refuses a funding source the group did not review (§12.4)" | U | Nothing auto-creates a certificate from a missing tax invoice |
| A20 | PASSED | `expense-capture-certificate.pg.spec.ts` "A20/A10…" and "A20/§12.4: a part-paid source blocks the whole issuance instead of topping the payment up" | PG | |
| A21 | PARTIAL | `expense-capture-certificate.pg.spec.ts` (DIGITAL path); `substitute-receipt.use-case.spec.ts` payer-link rules | PG, U | PAPER with an unverified payer link is covered by the existing substitute suite, not re-run per capture scope |
| A22 | PASSED | `substitute-receipt-capture.use-case.spec.ts` "refuses the preview / the signature / the approval — the last gate before the document is real" + "still lets an unchanged allocation through all three" | U | |
| A23 | PASSED | `substitute-receipt-capture.use-case.spec.ts` "refuses an order that is only waiting to be paid (A23)" | U | |
| A24 | PASSED | `expense-capture-facts.logic.spec.ts` "keeps a mismatch instead of inventing a balancing row (A24/A34/A58)"; `expense-capture-allocation.logic.spec.ts` "A24/A34/A58 — a document that does not add up blocks instead of being balanced" | U | |
| A25 | PASSED | `expense-capture-assembly.logic.spec.ts` "A25: a subtotal that already includes shipping…" | U | |
| A26 | PASSED | `expense-capture-assembly.logic.spec.ts` "A26" ×2 | U | |
| A27 | PASSED | `expense-capture-assembly.logic.spec.ts` "A27: same-name rows are two purchases and a zero-price gift changes no total"; `expense-capture-allocation.logic.spec.ts` "A27 — a gift is selectable and adds nothing" | U | |
| A28 | PASSED | `expense-capture-assembly.logic.spec.ts` "A28: one row the page never priced leaves the document unprovable, not 0"; `expense-capture-allocation.logic.spec.ts` "A28/A41 — a selected row with no amount blocks; it never becomes 0"; `group-open-facts` | U, B | The picture shows **ไม่ทราบ** in both the price and the amount column |
| A29 | PASSED | `expense-capture-assembly.logic.spec.ts` "A29: a coupon for next time reduces nothing" | U | |
| A30 | PARTIAL | `expense-capture-assembly.logic.spec.ts` refund/void rows; `expense-capture-facts.logic.spec.ts` "A57 — points balances are not converted to money" | U | Wallet credit vs bank confirmation as separate destinations has no dedicated case |
| A31 | PASSED | `expense-capture-allocation.logic.spec.ts` "A31 — a foreign-currency document keeps its facts and is not converted" | U | |
| A32 | PASSED | `expense-capture-review.use-case.spec.ts` "A32 — naming somebody else as the payer needs expense.review" and "refuses a payer who is not an active member of this company and branch" | U | |
| A33 | PASSED | `expense-capture.logic.spec.ts` "maps an unknown document type to NEEDS_REVIEW instead of guessing a kind"; gateway parser "never invents an issuer or a date the window does not print" | U, GW | |
| A34 | PASSED | `substitute-receipt-capture.use-case.spec.ts` "refuses a checkout whose totals do not reconcile (A34)"; `expense-capture-facts.logic.spec.ts` "keeps a mismatch…" | U | |
| A35 | PASSED | `expense-capture-group.use-case.spec.ts` "refuses to detach a file a derived expense already uses as its receipt" / "…a certified substitute receipt retains" / "detaches a free file: the group link goes, the job is cancelled, the object is not deleted"; `expense-capture.pg.spec.ts` "deletes the orphan evidence of an aged-out group and keeps what an expense still uses (§8 retention)" | U, PG | |
| A36 | PASSED | `expense-capture-upload.logic.spec.ts` "a failure stops at its own file: the ones already stored are never sent again" / "a lost response is UNKNOWN, not failed" / "a file whose bytes never arrived asks to be picked again" | U | |
| A37 | PASSED | gateway parser "caps items and components and says so instead of cutting silently"; `expense-capture-allocation.logic.spec.ts` "§16.2 — a row with no printed quantity is all-or-nothing, never split" | GW, U | |
| A38 | PASSED | `expense-capture-compatibility.spec.ts` (all 7 cases) | U | 404 on confirm/pay, `reimbursement_source_unavailable` on a claim, one export row, one posting source |
| A39 | PASSED | `expense-capture-handoff.pg.spec.ts` "counts a derived source once everywhere the money is read, and the group never"; `expense-capture-compatibility.spec.ts` "builds exactly one accountant index row…"; `capture-list`, `expense-list-legacy` | PG, U, B | |
| A40 | PASSED | `substitute-receipt-capture.use-case.spec.ts` "reports what each shop is waiting for, so a retry continues with B only (A40)"; `expense-capture-certificate.pg.spec.ts` "A40: shop A stays issued while a failed shop B is retried"; `group-handed-derived` | U, PG, B | |
| A41 | PASSED | `expense-capture-allocation.logic.spec.ts` "A41 — everything personal ends as evidence with no money to hand on"; `expense-capture-review.use-case.spec.ts` "A41 — accepting…"; `expense-capture.pg.spec.ts` §8 retention | U, PG | D08 retention is now implemented and proven, not merely promised |
| A42 | PASSED | `expense-capture-allocation.logic.spec.ts` "uses the … date when the reviewer picks it" / "blocks rather than dating the expense today when nothing printed a date" | U | |
| A43 | PASSED | `expense-capture-read-runner.service.spec.ts` "counts the customer OCR read exactly once for a file of many chunks" / "pauses with ai_credit on a money refusal and keeps the checkpoint" / "resumes from the checkpoint…" | U | |
| A44 | PASSED | `expense-capture-review.use-case.spec.ts` "refuses to reopen once one derived source has been used"; `expense-capture-certificate.pg.spec.ts` "A44/§12.4: a prepared certificate stops the group being rebuilt" | U, PG | |
| A45 | PARTIAL | `line-capture-result-notifier.use-case.spec.ts` "a group chat is answered IN the group chat it arrived from" / "a 1:1 capture with no stored target still reaches the sender"; `line-capture-branch-default.spec.ts` (10 cases) | U | The "two jobs open, a late photo" ambiguity prompt is **real LINE** |
| A46 | PARTIAL | `expense-capture-group.use-case.spec.ts` "lets read_own see its own group and refuses somebody else's"; `expense-capture-read-status.use-case.spec.ts` "lets an uploader follow their own record, and refuses a stranger" | U | Download/export/LINE authorisation of the ORIGINAL from a child link is not separately exercised |
| A47 | PASSED | `expense-capture-compatibility.spec.ts` "refuses new evidence with the shared entitlement code…" / "removes only `add_file`…"; `expense-capture-group.use-case.spec.ts` "refuses a new file with the intake flag off but still completes, detaches and closes (A47)"; `expense-capture-handoff.use-case.spec.ts` "hands off with intake closed (A47)"; `expense-capture-read-status.use-case.spec.ts` "still answers while new intake is disabled (A47)" | U | |
| A48 | PASSED | `expense-capture-review.use-case.spec.ts` "A48 — the edit invalidates the preview and the acceptance built on the old numbers"; `expense-capture-read-runner.service.spec.ts` "reports applied: false when the draft moved while the job was reading" | U | |
| A49 | PASSED | `expense-capture-assembly.logic.spec.ts` "A49: cash 500 with 432 change is a purchase of 68"; `expense-capture-facts.logic.spec.ts` "A49 — cash 500 change 432 is a 68 purchase" | U | |
| A50 | PASSED | `expense-capture-assembly.logic.spec.ts` "A50: an order discount printed on two pages is subtracted once" | U | |
| A51 | PARTIAL | `expense-capture-facts.logic.spec.ts` "A57 — points balances are not converted to money"; `expense-capture-allocation.logic.spec.ts` tender/change rules | U | The document-222 vs settlement-44+178 split has no dedicated case |
| A52 | PASSED | `expense-capture-assembly.logic.spec.ts` "A52: a linked void cancels its row, an unlinked negative row does not"; `expense-capture-allocation.logic.spec.ts` "A52 — a voided row cannot be handed to the company" | U | |
| A53 | PASSED | `expense-capture-assembly.logic.spec.ts` "A53: a printed pack size and tax code survive and never become a rate"; `expense-capture-allocation.logic.spec.ts` "A53 — a tax CODE never becomes a rate" | U | |
| A54 | PASSED | `expense-capture-assembly.logic.spec.ts` "A54: two receipts of different shops in one file stay two documents"; benchmark FX-PDF-MULTI-03 (3/3 documents, 3/3 totals) | U, BM | |
| A55 | PARTIAL | `expense-capture-handoff.pg.spec.ts` "sees a paid, posted, confirmed or certified source as consumed too" | PG | A later replacement document arriving against a settled source is not run end to end |
| A56 | PASSED | `expense-capture-facts.logic.spec.ts` "A56 — coupon 0, discount −10, queue 21 comes to 35 and the queue number is not money" | U | |
| A57 | PASSED | `expense-capture-facts.logic.spec.ts` "A57 — points balances are not converted to money" | U | |
| A58 | PASSED | `expense-capture-facts.logic.spec.ts` "keeps a mismatch instead of inventing a balancing row (A24/A34/A58)" | U | |
| A59 | NOT_RUN | — | — | **authorised bundle**: the row itself says the fixture does not exist ("ยังขาดfixtureจริง") |
| A60 | PARTIAL | `substitute-receipt-capture.use-case.spec.ts` (certificate never replaces a tax invoice); `expense-capture-handoff.pg.spec.ts` (consumed source) | U, PG | The full lost→abbreviated→full→certificate ladder needs an **authorised bundle** |
| A61 | PARTIAL | `expense-capture-preprocess.logic.spec.ts` "renders a big scanned page instead of shipping a PDF the reader cannot see"; benchmark FX-PDF-SCAN-05 / FX-PDF-BIG-01 | U, BM | Provenance conflict between a text layer and an OCR of the same page has no case |
| A62 | PARTIAL | `expense-capture-read-runner.service.spec.ts` "reports an unreadable file as electronically UNCHECKABLE, not merely unchecked"; D09 baseline in the group read model | U, B | pass/fail per method needs D09 automated verification and an **authorised bundle**; the release only ever says NOT_CHECKED / UNAVAILABLE |
| A63 | PARTIAL | `expense-capture-certificate.pg.spec.ts` "§12.4/A22: editing a derived source re-signs its certificate"; §16.4 matrix in `expense-upload.use-case.spec.ts` | PG, U | The paper→screenshot→PDF→credit-note chain is not run as one journey |
| A64 | PASSED | `expense-capture-preprocess.logic.spec.ts` "reports an encrypted PDF rather than trying to read it" / "reports a corrupt buffer as corrupt, not as encrypted"; `expense-capture-status.logic.spec.ts` "says the file is saved in every terminal-failure message, and points at this page" | U | No password reaches a log or a prompt: the preprocessor never opens the file |
| A65 | PASSED | benchmark FX-PDF-MULTI-03 (3 documents in one file, 3/3 totals, `pagesCovered` 3); `expense-capture-assembly.logic.spec.ts` "A81: page coverage is the union of what the windows reported" | BM, U | |
| A66 | PASSED | gateway parser "drops a row whose evidence span is not in the window text" / "never invents an issuer or a date the window does not print"; the extract prompt treats all three blocks as data | GW | No arbitrary URL is fetched: the reader is given bytes, never a link |
| A67 | PASSED | `expense-capture-lane-parity.spec.ts` "accepts exactly 10,485,760 bytes of PDF and refuses one byte more" + "is one configured number, not three constants"; `expense-capture-upload.logic.spec.ts` "takes the limit from the server capability" | U | Benchmark FX-PDF-SCAN-05 is 10,266,444 bytes and read automatically — 4 MB alone is not a refusal |
| A68 | PARTIAL | `line-capture-result-notifier.use-case.spec.ts` (15 cases); `line-non-receipt-reply.logic.spec.ts` (6 cases) | U | **real LINE** for the delivery half |
| A69 | PASSED | `expense-capture-lane-parity.spec.ts` (4 cases: one limit, one sentence, one credit wording); `expense-capture-upload.logic.spec.ts` "is the same boundary and the same two numbers the other two lanes print" | U | |
| A70 | PASSED | `expense-capture-status.logic.spec.ts` "is hidden for every terminal failure of the current file" / "says the file is saved in every terminal-failure message, and points at this page"; `expense-upload.use-case.spec.ts` stale-provenance write | U | |
| A71 | PASSED | `expense-upload.use-case.spec.ts` §16.4 intent/expected-target cases; `expense-capture-group.use-case.spec.ts` "records a completion whose revision moved while the bytes were being stored" | U | |
| A72 | PASSED | `expense-upload.use-case.spec.ts` §16.4 state matrix; `expense-capture-group.use-case.spec.ts` "refuses a file on a closed group" | U | |
| A73 | PARTIAL | `expense-upload.use-case.spec.ts` stale provenance (`sourceStale`, `sourceAttachmentId`) | U | "ask before accepting the new facts" is a UI journey; not photographed (see README "not captured") |
| A74 | PASSED | `expense-capture-read.client.spec.ts` "answers typed when the gateway is unreachable or refuses" / "answers not_configured rather than posting to a gateway with no secret"; `expense-capture-status.logic.spec.ts` "maps each ending to its §17.2 case" | U | |
| A75 | PARTIAL | benchmark FX-PDF-SCAN-05 (10,266,444 bytes, 5 chunks, 5/5 pages, items 15/15, total 1/1) and FX-PDF-20 | BM | The pipeline is proven; the **three entry points on a deployed environment** are not (UAT) |
| A76 | PARTIAL | benchmark FX-PDF-BIG-01 (one 8,500 pt page → a `tiles` chunk, items 10/10, total 1/1); `expense-capture-preprocess.logic.spec.ts` "tiles one very large page with an overview and 5 % overlap" | BM, U | Tiny-print Thai legibility at scale needs an **authorised bundle** |
| A77 | PASSED | benchmark FX-PDF-10 / FX-PDF-20 (header page, item pages, final total → one document, 40/40 and 80/80 items, reconciled diff 0); `expense-capture-assembly.logic.spec.ts` "A77: a header page, item pages and a final total assemble into one document" | BM, U | |
| A78 | PASSED | `expense-capture-read-runner.service.spec.ts` "resumes from the checkpoint and re-reads only what it has no answer for" / "writes nothing after its lease was reclaimed" / "cancels when the expense no longer points at this attachment"; `expense-capture-read.pg.spec.ts` (5 cases) | U, PG | |
| A79 | PASSED | `expense-capture-read-runner.service.spec.ts` "pauses with page_limit / call_budget / time_budget / memory_budget…"; benchmark FX-PDF-20 (7 chunks, 8 calls, 94 s — inside the 40-call and 15-minute ceilings) | U, BM | |
| A80 | PARTIAL | `expense-capture-read-runner.service.spec.ts` "fails without reading anything when the stored bytes are not the ones the job fenced on"; benchmark (originals untouched, derivatives built in memory) | U, BM | Signature/timestamp verification of the original is D09, still **not built** |
| A81 | PASSED | benchmark FX-PDF-02/05/10/20 (manifest covers every page, printed page numbers 1..n, reconciled diff 0); `expense-capture-assembly.logic.spec.ts` "A81: page coverage is the union of what the windows reported" | BM, U | The 17-page certificate ceiling is not the reader's: 20 pages read |
| A82 | PASSED | benchmark FX-PDF-MISSING-01 (printed 1/3 and 3/3 in a two-page file → `suspectedMissingPages` true, and false on all seven complete fixtures); `expense-capture-assembly.logic.spec.ts` "A82" ×3 | BM, U | The third case was **added in this wave** after the benchmark exposed the false positive |
| A83 | PARTIAL | the UXE table below (22 PASSED, 5 PARTIAL); `expense-capture-status.logic.spec.ts` "every sentence it can choose exists in both locales" | U, B | Error injection through all three lanes is **real LINE** + UAT |
| A84 | PASSED | `expense-capture-handoff.use-case.spec.ts` "answers a second call for the same allocation with the first batch, writing nothing"; `substitute-receipt-capture.use-case.spec.ts` "reports what each shop is waiting for" | U | |
| A85 | NOT_RUN | — | — | **UX 40+**: the row is a usability result, not a code path |
| A86 | PARTIAL | `line-file-attempt-answer.logic.spec.ts` (11 cases: oversize quotes the real size, an UNKNOWN outcome is never reported as saved, several candidates listed) | U | **real LINE** for the conversation itself |
| A87 | PARTIAL | `line-file-attempt-answer.logic.spec.ts` "several candidates are listed, numbered, with name, time and state" / "not-found, lookup-failure and delivery-failure are three different answers"; `expense-capture.pg.spec.ts` "records and reads back a LINE intake attempt without keeping the raw file name" | U, PG | **real LINE** |
| A88 | PARTIAL | `line-file-attempt-answer.logic.spec.ts` "a problem since fixed answers with both states, so nobody sends or pays twice"; `line-capture-result-notifier.use-case.spec.ts` "a push LINE refuses is recorded as undelivered, not as a delivered result" | U | **real LINE** |

**NOT_RUN in A01–A88 (2):** A59 (**authorised bundle** — the row itself records that the fixture
does not exist) and A85 (**UX 40+** — the row is a usability result, not a code path). Every other
row has at least the machine-checkable half proven; the 21 `PARTIAL` rows name what is missing
individually, and it is always one of the same four reasons.

## IG01–IG29

| ID | Status | Closing evidence | Left open |
| --- | --- | --- | --- |
| IG01 (P0) | CLOSED | append/replace/detach intent + per-file identity + resume (`expense-upload.use-case.spec.ts`, `expense-capture-upload.logic.spec.ts`, `expense-capture-group.use-case.spec.ts` detach cases), and §8 retention now implemented (`expense-capture.pg.spec.ts`) | — |
| IG02 | CLOSED | bounded per-window output with `itemsTruncated`, page/item completeness, contract version (gateway parser + `expense-capture-assembly.logic.spec.ts`) | — |
| IG03 (P0) | CLOSED | no capture-only `ExpenseRecord` exists at all; `expense-capture-handoff.pg.spec.ts` "counts a derived source once everywhere the money is read, and the group never" + `expense-capture-compatibility.spec.ts` | — |
| IG04 (P0) | CLOSED | `expense-capture-handoff.pg.spec.ts` resolver + payer cases, `expense-capture.pg.spec.ts` sibling/alias, `expense-capture-handoff.logic.spec.ts` totals identity | — |
| IG05 (P0) | CLOSED | `expense-capture-certificate.pg.spec.ts` (5 cases: payment once, per-shop retry, partial blocks, prepared blocks rebuild, correction) | — |
| IG06 | CLOSED | group/allocation revision fences (`expense-capture-review.use-case.spec.ts`, `expense-capture-read-runner.service.spec.ts` "reports applied: false…") | — |
| IG07 (P0) | CLOSED | canonical scope key + unique index (`expense-capture.logic.spec.ts`, `expense-capture.pg.spec.ts`), reopen rules (`expense-capture-review.use-case.spec.ts`) | — |
| IG08 | CLOSED | per-attempt checkpoint, one admitted OCR read per file, `ai_credit` pause (`expense-capture-read-runner.service.spec.ts`, `expense-capture-read.pg.spec.ts`) | — |
| IG09 | OPEN | authorisation per surface is tested; retention now sweeps | Original-evidence authorisation on **download/export/LINE** from a child link is not separately proven (A46) |
| IG10 | OPEN | `line-capture-result-notifier.use-case.spec.ts` target/push rules, `line-capture-branch-default.spec.ts` | The multi-job ambiguity prompt needs **real LINE** |
| IG11 (P0) | CLOSED | tax decisions never forced (`expense-capture-allocation.logic.spec.ts` tax block), unsupported routes pause instead of finalising | D03/D04/D08 confirmed by the owner 2026-09-19 (appendix §15) |
| IG12 | CLOSED | `expense-capture-allocation.logic.spec.ts` "A41 — everything personal…", "A28/A41 — a selected row with no amount blocks", multiple event dates | — |
| IG13 | CLOSED | `expense-capture-compatibility.spec.ts` + the three flag-off cases beside their harnesses + the rollback note in this bundle's README | — |
| IG14 | OPEN | the Bedrock benchmark measured the pipeline on synthetic fixtures | **authorised bundle** + **UX 40+**; the research note says explicitly that no accuracy rate may be quoted |
| IG15 | CLOSED | permission keys decided and enforced at every entry point (`expense-capture-group.use-case.spec.ts`, `expense-capture-review.use-case.spec.ts`, `expense-capture-handoff.use-case.spec.ts`) | — |
| IG16 | CLOSED | signed events normalised before materialisation (`expense-capture-assembly.logic.spec.ts` A49/A50/A52/A56/A57) | — |
| IG17 | CLOSED | qty/UOM/pack and per-line tax kept apart (`expense-capture-assembly.logic.spec.ts` A53, `expense-capture-allocation.logic.spec.ts` tax block) | — |
| IG18 | CLOSED | `expense-capture-lane-parity.spec.ts` — one configured number, one sentence, one credit wording | — |
| IG19 | CLOSED | typed capability errors + page/document completeness (`expense-capture-read.client.spec.ts`, gateway parser) | — |
| IG20 | OPEN | the LINE file lane and its bounded reader are built and unit-tested | End-to-end persist→read on **real LINE** |
| IG21 | OPEN | D09 baseline only: NOT_CHECKED / UNAVAILABLE, never "verified" | Method-specific verification is **not built** (A62/A80) |
| IG22 | CLOSED | `expense-upload.use-case.spec.ts` stale provenance on replace; `expense-capture-status.logic.spec.ts` no reread CTA on a terminal failure | — |
| IG23 (P0) | CLOSED | expected old attachment + revision + operation replay (`expense-upload.use-case.spec.ts`), state matrix, retention | — |
| IG24 (P0) | CLOSED | document relations and single-use consumption (`expense-capture-handoff.pg.spec.ts`, `expense-capture.pg.spec.ts`) | — |
| IG25 | OPEN | — | **authorised bundle** for five brands + **UX 40+** |
| IG26 | CLOSED | bounded page/region preprocessing with measured sizes and overlap (`expense-capture-preprocess.logic.spec.ts`); benchmark FX-PDF-BIG-01 read as tiles | — |
| IG27 | CLOSED | durable runner, per-chunk checkpoint, budgets (`expense-capture-read-runner.service.spec.ts`, `expense-capture-read.pg.spec.ts`); benchmark shows a 20-page file inside the ceilings | — |
| IG28 | OPEN | the UXE table below | Error injection through three lanes + **UX 40+** |
| IG29 | OPEN | `line-file-attempt-answer.logic.spec.ts` (11 cases) | **real LINE** |

**21 closed, 8 open** — the eight are IG09, IG10, IG14, IG20, IG21, IG25, IG28 and IG29.

## UXE-01–27

| ID | Status | Where it is shown | Test |
| --- | --- | --- | --- |
| UXE-01 | PASSED | web upload panel | `expense-capture-upload.logic.spec.ts` "a file whose bytes never arrived asks to be picked again instead of being called saved" |
| UXE-02 | PASSED | web upload panel | `expense-capture-upload.logic.spec.ts` "a lost response is UNKNOWN, not failed" + "ตรวจสอบสถานะ believes the group" |
| UXE-03 | PARTIAL | LINE | `line-file-attempt-answer.logic.spec.ts` "a download failure with no known cause says exactly that" — delivery is **real LINE** |
| UXE-04 | PASSED | all three lanes | `line-file-attempt-answer.logic.spec.ts` "an unsupported type names the kinds the capability really listed" |
| UXE-05 | PASSED | all three lanes | `expense-capture-lane-parity.spec.ts` "prints the size and the limit the same way the web does" |
| UXE-06 | PASSED | job → web | `expense-capture-preprocess.logic.spec.ts` "reports an encrypted PDF rather than trying to read it" + `expense-capture-status.logic.spec.ts` terminal-failure copy |
| UXE-07 | PASSED | job → web | `expense-capture-preprocess.logic.spec.ts` "reports a corrupt buffer as corrupt, not as encrypted" |
| UXE-08 | PASSED | all three lanes | `expense-capture-group.use-case.spec.ts` "rejects the file slot when the object was quarantined" |
| UXE-09 | PASSED | all three lanes | same case (the scanner-unavailable arm keeps the slot) |
| UXE-10 | PASSED | LINE push + web notice | `expense-capture-status.logic.spec.ts` "says the file is saved in every terminal-failure message, and points at this page"; `line-non-receipt-reply.logic.spec.ts` "NR09 / §17.6" |
| UXE-11 | PASSED | web notice | `expense-capture-status.logic.spec.ts` "maps each ending to its §17.2 case" |
| UXE-12 | PASSED | web + LINE | `expense-capture-status.logic.spec.ts` "uses the wave-2 credit wording when a read stops for money"; `expense-capture-lane-parity.spec.ts` "says เครดิตสำหรับการอ่านเอกสารไม่พอ" |
| UXE-13 | PASSED | web notice | `expense-capture-status.logic.spec.ts` "counts pages only once the reader has opened the file" |
| UXE-14 | PASSED | web notice | `expense-capture-status.logic.spec.ts` "every paused reason has Thai words a shop owner can act on — no error codes" |
| UXE-15 | PASSED | group page | `expense-capture-assembly.logic.spec.ts` "A82" ×3; benchmark FX-PDF-MISSING-01 |
| UXE-16 | PASSED | group page | `group-open-facts` shows **ยอดไม่ตรง — ตรวจจุดที่ไม่ตรง**; `expense-capture-facts.logic.spec.ts` "keeps a mismatch…" |
| UXE-17 | PASSED | group page | D09 baseline line in the group read model (`group-open-files`); `expense-capture-read-runner.service.spec.ts` "reports an unreadable file as electronically UNCHECKABLE" |
| UXE-18 | PASSED | web | `expense-capture-group.use-case.spec.ts` 401/403 cases; `ExpenseCaptureGroupPage.qa.spec.ts` server-gated affordances |
| UXE-19 | PASSED | replace page | `expense-upload.use-case.spec.ts` §16.4 refusal leaves the current primary |
| UXE-20 | PASSED | replace page | `expense-capture-status.logic.spec.ts` "is hidden for every terminal failure of the current file" |
| UXE-21 | PASSED | group + expense | `expense-capture-review.use-case.spec.ts` "refuses a stale revision"; `expense-capture-group.use-case.spec.ts` revision conflict |
| UXE-22 | PASSED | expense | `expense-capture-review.use-case.spec.ts` "refuses once the group has handed off — correction belongs to the expense" |
| UXE-23 | PARTIAL | expense | the existing duplicate-candidate suite; no capture-specific case |
| UXE-24 | PASSED | group page | `expense-capture-handoff.use-case.spec.ts` idempotent replay; `ExpenseCaptureGroupPage.qa.spec.ts` UXE-24 path |
| UXE-25 | PARTIAL | LINE | `line-capture-result-notifier.use-case.spec.ts` "a push LINE refuses is recorded as undelivered" — delivery is **real LINE** |
| UXE-26 | PARTIAL | expense | `substitute-receipt-capture.use-case.spec.ts` eligibility gate; the "เพิ่มหลักฐาน" journey is not photographed |
| UXE-27 | PARTIAL | everywhere | unknown fallback exists in the error map; no injected-unknown run |

**22 PASSED, 5 PARTIAL, 0 NOT_RUN.**

## NR01–NR09

All nine are proven by `line-non-receipt-reply.logic.spec.ts` — the table-driven case
"`${name}` maps to `${expectedCase}` with the §18.4 sentence" walks every one — plus the four
rules beside it: "NR04 prints the amount only when the reader read one", "NR06 stays with the
check-bill continuation", "only NR01–NR03 and NR08 may offer the Web CTA, and only with a real
link", and "NR09 / §17.6: the three read outcomes each name their own state and never each other".

| ID | Status | Note |
| --- | --- | --- |
| NR01 | PASSED | parcel label → no expense, offer to send the freight receipt |
| NR02 | PASSED | drop-off slip → weight/COD never stands in for the freight |
| NR03 | PASSED | quotation / PO / delivery note |
| NR04 | PASSED | supplier invoice, amount only when read |
| NR05 | PASSED | transfer slip / marketplace order |
| NR06 | PASSED | check bill keeps its existing continuation |
| NR07 | PASSED | non-financial image: nothing stored, nothing created |
| NR08 | PASSED | unsure: the Web CTA only with a persisted work item |
| NR09 | PASSED | failed / partial, §17.6 |

**Delivery of these sentences to a phone is real LINE and is not part of this wave.** What is
proven is the mapping, the wording and the CTA rule.

## CC01–CC10 (courier documents)

Synthetic coverage only — say so plainly. This wave built **no courier fixture** and obtained no
courier bundle; the rows below record what the general capture rules already give a courier
document, not a courier test.

| ID | Status | Note |
| --- | --- | --- |
| CC01 | PARTIAL | Document kinds are reused, not extended: `line-non-receipt-reply.logic.spec.ts` proves a parcel label and a drop-off slip both classify as `DELIVERY_NOTE` with their own signal. No courier specimen was read |
| CC02 | PARTIAL | One document, several parcels: the assembly's "two documents of the SAME shop without numbers are never merged on the name alone" and the summary/detail dedupe rules apply, untested on a courier layout |
| CC03 | PARTIAL | Freight, packaging, fuel, insurance and COD fees are ordinary `charge` components; `expense-capture-allocation.logic.spec.ts` shipping rules apply. No courier charge table was read |
| CC04 | NOT_RUN | **authorised bundle**: COD principal vs freight vs insured value needs a real courier receipt |
| CC05 | NOT_RUN | **authorised bundle**: temporary → full, monthly bill, credit note relations |
| CC06 | NOT_RUN | **authorised bundle**: same as CC05 |
| CC07 | NOT_RUN | **authorised bundle**: customs receipt / duty invoice roles |
| CC08 | PARTIAL | A courier document needs no carrier or tax-type question first — the three lanes take any supported file; proven by the lane-parity suite, not by a courier document |
| CC09 | NOT_RUN | **UX 40+**: the review order (freight total, date, issuer first) is a usability claim |
| CC10 | NOT_RUN | **authorised bundle** + D09: "Digitally signed" text is not verification |

**0 PASSED, 4 PARTIAL, 6 NOT_RUN.**

## Verification run for this matrix (2026-09-19, base `9c1f9dad`)

| Command | Result |
| --- | --- |
| `pnpm --filter @watchdog-bms/contracts build && … test` | 324 pass / 0 fail |
| `pnpm --filter @watchdog-bms/config build && … test` | 144 pass / 0 fail |
| `pnpm --filter @watchdog-bms/api test` (dot reporter) | rc=0, 11,183 passing, 0 fail |
| `pnpm --filter @watchdog-bms/api lint` (`tsc --noEmit`) | clean |
| the four capture pg specs against a throwaway Postgres (`127.0.0.1:15521`, all four `*_TEST_DATABASE_URL` and `*_REQUIRE_POSTGRES` set) | 28 pass / 0 fail / **0 skipped** |
| `pnpm --filter @watchdog-bms/web test` | 1,868 pass / 0 fail |
| `pnpm --filter @watchdog-bms/web lint` (`next typegen && tsc --noEmit`) | clean |
| `pnpm --filter @watchdog-bms/ai-gateway test` | 1,237 pass / 0 fail |
| `pnpm --filter @watchdog-bms/ai-gateway lint` | clean |
| `pnpm --filter @watchdog-bms/workers test` / `lint` | 43 pass / 0 fail; clean |
| `node scripts/run-line-ai-whole-chain-acceptance.mjs` | rc=0, 1,961 pass / 0 fail, 8 suites |
| `pnpm test:harness` | 27 pass / 0 fail |
| `node infra/security/sync-production-maintenance-release-pins.mjs --check` | `status=current` |
| `git diff --check` | clean |
| capture read benchmark, full run | 8 fixtures, 8/8 documents, items and totals exact, THB 27.51 (task cumulative THB 60.01 of 100) |
