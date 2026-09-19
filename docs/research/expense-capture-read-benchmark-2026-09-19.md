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
