# Capture read benchmark — synthetic fixtures against real Bedrock (2026-09-19)

W08 of the [buyer expense capture plan](../plans/marketplace-buyer-expense-capture-plan-th.md) §5,
and item 5 of the owner-confirmation list in the
[contract appendix](../specs/marketplace-buyer-expense-capture-contract-appendix-th.md) §15
("Bedrock replay ด้วย fixture สังเคราะห์เพื่อพิสูจน์ pipeline จริง, ประมาณ ≤ THB 100").

Every wave before this one proved the capture reader against fakes. This is the first time W03's
pipeline has been driven end to end by a real model, and it is the evidence behind the A75–A82 rows
of the [acceptance matrix](../qa/evidence/marketplace-buyer-expense-capture-2026-09-19/acceptance-matrix.md).

**It found two real defects.** Both are fixed in this wave, and the table below is the run **after**
those fixes; §4 records what the first run produced.

## 1. Method

- Harness: `scripts/expense-capture-read-benchmark.ts`, with the fixtures and the accuracy scoring
  in `scripts/expense-capture-read.fixtures.ts` (covered by
  `scripts/expense-capture-read.fixtures.spec.ts`, which runs in `pnpm test:harness` and costs
  nothing — a benchmark that grades itself is worth what its grader is worth).
- In-process, **no API, no database, no HTTP, no LINE**. The real code under test is:
  1. `planCapturePreprocessing` (W03) — the pdf-lib page runs, the byte measurement, the
     pdfjs + `@napi-rs/canvas` render and the 2×N tiling decision;
  2. `LineAiInternalController.captureRead` — the real gateway route, prompt and strict page parser;
  3. `planWindows` (W03) — the 12,000-character window planner;
  4. `LineAiInternalController.captureExtract` — the real gateway route, prompt, strict observation
     parser and its ONE repair retry;
  5. `assembleCaptureObservations` (W03) — merge, reconciliation and `suspectedMissingPages`.
- Only the model calls are real: `MODEL_PROVIDER=bedrock`, profile `watchdog-bedrock`,
  `ap-southeast-1`, `global.anthropic.claude-sonnet-4-6`, `bedrock-runtime` only.
- **Fixtures are generated at run time and are entirely synthetic** (appendix §13). Every issuer,
  tax id, item and amount is invented in the repo; no customer document, no personal data and no
  LINE content is involved. The Thai text on the scanned fixtures is rendered by `sharp` from an SVG.
- Cost uses the repo's own price map with per-call satang rounding
  (`apps/api/src/modules/line-ai/application/ai-model-pricing.ts`) at a fixed `--thb-per-usd 33` —
  the same map and the same FX as the LINE intake benchmark, so the two are comparable.
- Spend guard: `--max-thb 100`, counting **this task's own prior ledger spend**, so a repeat run
  cannot walk past the authorisation one invocation at a time. `--smoke` additionally caps the
  single invocation at THB 2.

### Exact commands

```sh
cd apps/ai-gateway          # its tsconfig carries experimentalDecorators; its pnpm exec resolves sharp
export BENCH="MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6"

# fixtures only, no provider call, no money
env $BENCH pnpm exec tsx ../../scripts/expense-capture-read-benchmark.ts --dry-run --out <dir>

# credentials + whole chain on the cheapest fixture (guarded at THB 2)
env $BENCH pnpm exec tsx ../../scripts/expense-capture-read-benchmark.ts --smoke \
  --label capture-read --out <dir> --ledger <ledger>

# the measured run
env $BENCH pnpm exec tsx ../../scripts/expense-capture-read-benchmark.ts \
  --label capture-read --out <dir> --ledger <ledger>
```

## 2. Result (run `capture-read-2026-09-18T21-02-20-441Z`, base `65d15411`)

| Fixture | Proves | Bytes | Pages | Chunks (kind) | Windows | Calls | In/Out tokens | THB | Docs | Items | Totals | Reconciliation | Missing-pages | Wall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FX-PDF-02 | A81/A77/A75 | 2,048 | 2 | 1 (pdf) | 1 | 2 | 4,721 / 1,643 | 1.53 | 1/1 | 8/8 | 1/1 | reconciled, diff 0 | false (want false) | 14.6 s |
| FX-PDF-05 | A81/A77 | 4,056 | 5 | 2 (pdf) | 1 | 3 | 11,295 / 3,283 | 2.76 | 1/1 | 20/20 | 1/1 | reconciled, diff 0 | false (want false) | 27.9 s |
| FX-PDF-10 | A81/A77/A79 | 7,409 | 10 | 4 (pdf) | 1 | 5 | 22,502 / 6,205 | 5.30 | 1/1 | 40/40 | 1/1 | reconciled, diff 0 | false (want false) | 48.6 s |
| FX-PDF-20 | A81/A79 | 14,099 | 20 | 7 (pdf) | 1 | 8 | 44,151 / 12,003 | 10.32 | 1/1 | 80/80 | 1/1 | reconciled, diff 0 | false (want false) | 94.2 s |
| FX-PDF-MULTI-03 | A65/A82/A54 | 2,647 | 3 | 1 (pdf) | 1 | 2 | 6,524 / 2,624 | 2.20 | 3/3 | 9/9 | 3/3 | 3 × reconciled, diff 0 | false (want false) | 22.6 s |
| FX-PDF-SCAN-05 | A75/A76 | 10,266,444 | 5 | 5 (pdf) | 1 | 6 | 12,820 / 3,002 | 2.77 | 1/1 | 15/15 | 1/1 | reconciled, diff 0 | false (want false) | 84.9 s |
| FX-PDF-BIG-01 | A76 | 7,418,128 | 1 | 1 (tiles) | 1 | 2 | 5,447 / 1,834 | 1.47 | 1/1 | 10/10 | 1/1 | reconciled, diff 0 | false (want false) | 26.3 s |
| FX-PDF-MISSING-01 | UXE-15/A82 | 1,960 | 2 | 1 (pdf) | 1 | 2 | 4,618 / 1,375 | 1.16 | 1/1 | 6/6 | 1/1 | reconciled, diff 0 | **true** (want true) | 14.0 s |

No blank page, no failed chunk, no failed window and no error on any fixture. `itemsTruncated` is
false everywhere; `pagesCovered` equals the file's page count on every fixture.

## 3. Spend

| | THB |
|---|---|
| This run | 27.51 |
| This task's earlier runs (2 smokes + the pre-fix run + 1 diagnostic re-run) | 32.50 |
| **This task, cumulative** | **60.01** |
| Authorised ceiling (appendix §15 item 5) | 100.00 |

Every run is appended to the shared spend ledger with the label `capture-read*`; the guard sums
exactly those rows, so the earlier authorised benchmarks in the same ledger are not double-counted.

## 4. What it found (both fixed in this wave)

### 4.1 `capture-extract` could not produce a single document — `OCR_SCHEMA_INVALID`

The very first smoke, on a clean two-page receipt, came back with zero documents after burning the
one repair retry. `CAPTURE_EXTRACT_PROMPT` described the classification object by **naming its keys**
and spelled out enum values only for `documentKind` and `documentFamily`. The model therefore
answered with plausible words that are not in the allowlist — `contentKind: "RECEIPT"`,
`businessDirection: "EXPENSE"`, `transactionState: "COMPLETED"`,
`evidenceRoles: ["EXPENSE_EVIDENCE"]` — `parseBusinessDocumentClassification` rejected the
classification, the parser dropped the only document, and the whole window was lost.

This is not a fixture artefact: it is every capture window, on every lane, for every customer.
Fix: `CAPTURE_EXTRACT_PROMPT` now carries the four remaining allowlists, generated from the
contract's own constants (`BUSINESS_DOCUMENT_CONTENT_KINDS`, `…_DIRECTIONS`,
`…_TRANSACTION_STATES`, `…_EVIDENCE_ROLES`), and says the lists are closed. A regression test
asserts the prompt offers every value the parser accepts, so the two cannot drift apart again.

### 4.2 A complete multi-page receipt reported missing pages

`hasMissingPages` (§16.8) decides from `document.printedPages` — but nothing ever produced that
field. The prompt asked only for `printedPage: {number, of}`, the parser never read `printedPages`,
and the assembly's only source for it was the MERGE of two window observations. A document read in
ONE window — the normal case — therefore knew only "page 1 of 20" and reported the other nineteen
as missing. In the product that is UXE-15 telling a customer to go and find pages that are all there.

Fix: the prompt asks for `printedPages` (every page number this document prints inside this window)
and the parser reads it, deduped, sorted, bounded at 64 and refusing 0. Before the fix, 4 of 8
fixtures were wrongly flagged; after it, only FX-PDF-MISSING-01 is flagged, which is the one that
really does print 1/3 and 3/3 in a two-page file.

### 4.3 Not a defect: reconciliation is not perfectly stable run to run

The pre-fix run reported `mismatch` on FX-PDF-20 and FX-PDF-BIG-01 with a difference equal to the
document total — the model had classified an extra line as a `charge` component, doubling the
computed total. A repeat of FX-PDF-BIG-01 on the same bytes reconciled with difference 0, and the
post-fix run reconciled all eight fixtures. So this is **model variance, not a pipeline bug**, and
the product's behaviour when it happens is the intended one: `mismatch` is shown to the reviewer
(UXE-16 "ตรวจจุดที่ไม่ตรง") rather than balanced away. It is also a reminder that a single benchmark
pass is not a stability measurement.

## 5. Honest accuracy summary, and what it means for A75–A82

**What matched.** On this corpus, on one pass, after the fixes: every document, every item and every
printed document total, on 2, 5, 10 and 20-page native-text PDFs, on three receipts in one file, on
a 10,266,444-byte five-page scan, on a single 8,500 pt page read as tiles, and on the missing-page
fixture. The printed-page evidence of §16.8 was right on all eight. No page was silently dropped:
`pagesCovered` equals the page count everywhere, and the 20-page file really did come back as seven
bounded chunks and 80 of 80 items.

**What this does NOT establish.**

- **It is not an accuracy measurement on real documents.** The fixtures are generated by this repo,
  in a layout this repo chose, mostly in Latin script. The Thai coverage is the scanned fixtures'
  printed header and shop name (`sharp`-rendered), because `pdf-lib`'s standard fonts cannot encode
  Thai and this wave adds no font dependency. IG14/IG25 — authorised Thai held-out bundles — stay
  **open**, and nothing here may be quoted as "the reader is N % accurate".
- **One pass is not a distribution.** §4.3 shows the same bytes can reconcile or mismatch. Anyone
  quoting a rate from this table should run repetitions first.
- **The three lanes are not compared here.** The benchmark drives the pipeline directly, not through
  LINE, upload or replacement. Lane parity is proven by tests
  (`expense-capture-lane-parity.spec.ts`), not by this run.
- **Nothing is deployed.** These are local, in-process runs against Bedrock. A75–A82 remain
  `PARTIAL` in the matrix for exactly that reason: the pipeline is proven, the three real entry
  points on a deployed environment are not.

**Cost and latency, for the record.** THB 0.55–1.29 per bounded chunk-or-window call and roughly
THB 0.5 per page of native text; the 20-page file cost THB 10.32 and 94 seconds of wall time in
8 provider calls, which is well inside the job's own ceilings (`providerCallCount ≤ 40`,
15 minutes per job). The five-page 10 MB scan cost THB 2.77 — **less** than the 10-page text file,
because a scanned page transcribes to far less text than a dense printed one.

## 6. Real public samples — 2026-09-19 (owner request: "ไปหาบิลจริงในอินเตอร์เน็ตมาลอง")

The same reader (`capture-read` → `capture-extract` → assembly), the same profile and region, run
through `scripts/expense-capture-read-benchmark.ts --files …` (added for this: real files on disk go
through the same preprocessing, routes, spend guard and ledger; no expectation, so no score — the
record carries the assembled facts and, for real files, the per-page transcription so a missed total
can be traced). Every file is a **publicly published** document; none is committed to this repo.

**What is public, and what is not.** Marketplaces do not issue the buyer's tax invoice: Shopee, Lazada
and TikTok Shop only forward the buyer's details, and the **seller** issues it — with whatever
e-tax tool it uses (Leceipt, FlowAccount, PEAK, the RD's e-Tax by Email). So "a Lazada bill" is one of
those templates. Retail chains (7-Eleven, Lotus's, Big C, Makro, CJ) issue their own e-Tax/e-receipt,
but only to the buyer's account/e-mail; the only public specimens are the samples in help articles
and the few crops people post on forums. Couriers (Flash, Kerry, ไปรษณีย์) were not found in public
at all — only chat screenshots. The owner's own documents, on UAT, remain the real test (§5).

| File (source, year) | What it is | Read | Right | Wrong / missing | THB |
|---|---|---|---|---|---|
| Leceipt "Lazada" receipt/tax invoice ([docs](https://www.leceipt.com/docs/etax/สร้าง-e-tax-จาก-lazada), 2021, 896×533 screenshot) | seller-issued ใบเสร็จรับเงิน/ใบกำกับภาษี for a Lazada order, demo data | TAX_INVOICE, PAID | issuer + tax id, doc no. `TIV20210500001`, date, the one item 7,000.00 | the totals block (รวมก่อน VAT 6,542.06 / VAT 457.94 / ทั้งสิ้น 7,000.00) was **not transcribed at all** by `capture-read` (text ≈ 8 px high) → no `document_total`, reconciliation `insufficient`; the draft would carry the line but no grand total | 0.99 + 0.77 |
| Leceipt e-Tax by Email sample ([blog](https://www.leceipt.com/blog/ตัวอย่างใบกำกับภาษี-e-tax-invoice-by-email), 2019, 913×497 screenshot) | RD-format e-Tax invoice, ETDA demo data | TAX_INVOICE | issuer, tax id, doc no. | no items, no totals (screenshot too small) → `insufficient` | 0.70 |
| FlowAccount ใบกำกับภาษีเต็มรูป ([blog](https://flowaccount.com/blog/tax-invoice-example/), Oct 2025, 1200×1636) | the current full-form template most marketplace sellers use, demo data | TAX_INVOICE, DUE | issuer, doc no. `INV2025020003`, 27/02/2025, item 50 × 250.00 with 5 % line discount = 11,875.00, รวม 12,500, ส่วนลด 625, VAT 776.87, ex-VAT 11,098.13, **ทั้งสิ้น 11,875.00** | reconciliation `mismatch −625`: the line amount is already net of its 5 % discount and the summary prints the same 625 as a document-level discount, so §4.4's `Σ sale − Σ discount` subtracts it twice. Money on the draft stays right (summary line: 12,500 − 625 = 11,875); with ≥ 2 such lines the draft would fall back to a summary line instead of the item breakdown | 1.50 |
| FlowAccount ใบกำกับภาษีอย่างย่อ (same blog, 2025, 1200×1503) | abbreviated tax invoice (cash sale), demo data | ABBREVIATED_TAX_INVOICE, PAID | doc no. `CA2025020012`, date, item, all totals | same `−625` double count | 1.10 |
| 7-Eleven ใบเสร็จรับเงิน/ใบกำกับภาษี full form ([CP ALL campaign photo via DroidSans](https://droidsans.com/how-to-get-receipt-from-7-11/), 20/12/2566, photographed at an angle; buyer name/address blurred locally before upload) | a real store-printed full tax invoice | TAX_INVOICE, PAID | บมจ. ซีพี ออลล์, tax id 0107542000011, branch 15888, doc no. `H158886612200001`, date, 5 of 6 items, merchandise 80.00, **ทั้งสิ้น 80.00** | the first item row was under the blur; "สินค้าไม่เสียภาษีมูลค่าเพิ่ม 9.00" (the N-flagged goods) was labelled `applied_discount` → `mismatch −9`; VAT 4.64 came back as `summary`, not `tax`, so the draft's VAT field stays empty for the reviewer | 1.91 |
| Lotus's e-Tax invoice, lower half ([Pantip crop](https://pantip.com/topic/42497883), 2023, 781×624) | a real e-Tax invoice's item + VAT/non-VAT block, no header | RECEIPT, PAID | 3 items, VAT 9.87, **รวม 178.00**, `reconciled` | no issuer (cropped away) | 0.94 |

Spend: two runs, THB 4.54 + 3.37 = **THB 7.91** (task cumulative THB 67.92 of the THB 100 ceiling,
ledger rows `capture-read-2026-09-19T07-54-35-232Z`, `…T07-57-05-635Z`).

### 6.1 What this says about the reader (three defects worth fixing, none blocking)

1. **Discount printed twice, subtracted twice.** Thai invoice templates (FlowAccount, PEAK, Leceipt)
   print a per-line discount column *and* repeat the total discount in the summary. The assembly's
   §4.4 sum subtracts the summary discount from line amounts that are already net → a spurious
   `mismatch` of exactly the discount. Fix: when every sale row carries a printed discount (or the
   summary discount equals Σ line discounts), treat the summary discount as already applied, or
   reconcile against the gross (`merchandise`) total instead. Add a synthetic fixture with this
   layout to `expense-capture-read.fixtures.ts`.
2. **Non-VAT goods mistaken for a discount on the 7-Eleven layout.** The CP ALL full-form invoice
   lists "สินค้าไม่เสียภาษีมูลค่าเพิ่ม" (N-flagged items) in the summary; the extract prompt returned
   it as `applied_discount`, and the VAT line as `summary`. Fix: teach `capture-extract` the
   ก่อนภาษี / ไม่เสียภาษี / ภาษีมูลค่าเพิ่ม / รวมภาษี rows as `tax`/`summary` kinds (7-Eleven, Lotus's,
   Big C and Makro all print this N/V split), with a fixture.
3. **Small text is dropped, not flagged.** On the 896-px Lazada screenshot the transcription omitted
   the whole totals block without marking the page `truncated`. Real PDFs carry a text layer and
   are unaffected; photos and screenshots below ≈ 1,000 px are. Fix: have `capture-read` report low
   confidence / partial transcription so the job ends PARTIAL (§17.6 copy) instead of a draft with
   an item and no total; and the web/LINE guidance should ask for the PDF or a full-size photo.

### 6.2 Not proven here

Shopee-, Lazada- and TikTok-specific layouts beyond the seller templates above; Big C, Makro and CJ
e-receipts; every courier. Those need the owner's own documents on UAT (D05/D09 bundles) — the
reader is generic, and these six say it reads issuer, number, date and the grand total correctly on
every legible document, and that the breakdown rules above are where it still stumbles.
