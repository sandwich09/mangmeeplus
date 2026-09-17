# LINE AI concise owner summaries and count preservation

## Owner amendment — 2026-09-17: one complete summary format

The owner requested the same expense-summary presentation from the chat/Quick Reply
and rich-menu entries: total amount, record count, effective date range and source.
This supersedes the historical amount-only behavior below for broad sole
`expense.list_recent` summaries, including amount questions.

- Reuse the existing prepared expense formatter in the full response path. Both
  render the same source data without model composition or another ERP read.
- Use the tool's echoed effective period in both paths, including one-sided date
  requests. Never replace it with conversation dates or assume a missing period.
- Preserve the source reference, web link and as-of metadata. No preview records or
  payment/status breakdowns in a broad summary. Keep the excluded-cancelled note.
- Use only a nonnegative safe-integer `data.total` for the count; missing/invalid
  count is explicitly unavailable, never inferred from previews or another key.
  Zero remains a successful summary. Incomplete/invalid totals stay unavailable.
- Explicit count/subset/detail questions retain their existing safeguards and
  behavior. Daily closing, multi-tool answers, permissions, company/branch/own
  scope, routing and prepared-lane admission remain unchanged.
- Verify prepared/full reply and card parity on identical fixtures, zero state,
  cancelled records, effective periods, missing count, Thai/English and existing
  permission/unavailable regression paths. No live deployment is part of this edit.

## Historical implementation

Status: MERGED DEVELOP via [PR #288](https://github.com/MangmeeDev/mangmeeplus/pull/288)
at `c6f3d06f0558ef9dd3a0944ae2065bbae67946a0`, 2026-08-27T05:30:29Z, after
[CI33041868515](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33041868515)
SUCCESS on exact head `29a0605b10102cc6efc0802ba90abe4e5482b6d7` and
[fresh combined acceptance](../agent-memory/capture-integration-final.md).
This is the bounded response correction, not live-provider or main acceptance.

## Goal and existing authority

Owners should get a brief amount answer for a broad expense summary, but an explicit
count question must not lose its count. This extends the existing operator-intent spec
§8 and business-query coverage spec §7.4; it does not add a keyword router or tools.

Historical baseline: PR #264 (`0edb396b1d3bf56c042fbd53194778738e4d696e`) contains one
unmerged concise-card commit, now runtime-superseded by PR #288. Its amount-only
projection misses `ค่าใช้จ่ายเดือนนี้มีกี่ใบ` and `how many
expenses`, removes `total`, and rejects a correct count through its numeric guard.
The pre-existing AccountingSummaryAgent fallback also has no count fact. Reuse the
current composer boundary, where both raw data and grounded fallback are already available.

## Contract

- Only a sole `expense.list_recent` result can use the concise amount-only answer. Explicit
  count wording uses the same predicate as the existing requested-count guard and is
  never amount-only. Record/vendor/recent/status requests keep the original detail data.
- Broad amount summaries return their existing concise grounded total before model
  composition, just like count and daily-closing answers. Numeric membership cannot
  establish a monetary role: a year/date, earlier conversation amount or user-value
  candidate must not replace the current source total. Remove the now-unreachable
  amount-only model projection; the remaining model paths retain their full source data.
  Reuse the AccountingSummaryAgent `ยอดทั้งหมด` fact and existing `ยอดรวม` label; no new
  currency assumption, monetary parser or formatter. English questions use that same
  source line (currently Thai); this slice does not implement full fallback translation.
- For sole expense results, `กี่บาท` and `จำนวนเงิน` (allowing whitespace between words)
  ask for money, not record count. Remove only these phrases from count-detection text;
  leave the actual question unchanged. A mixed question that still asks `กี่ใบ`/`กี่รายการ`
  remains deterministic count+amount. This is a narrow Thai wording guard, not a general
  currency parser or NLU guarantee. Neither supported count nor amount-only answers
  call the provider; remaining model validation uses the same full data as its payload.
- An expense count comes only from a nonnegative safe-integer `data.total`. The actual
  API (`ExpenseListRecentTool`, `erp-tools.use-case.ts`) sets it to
  `summary.countedItems`, excluding REJECTED/VOIDED, after permission/tenant/branch reads.
  Its `items` is only a five-record preview and may include cancelled records: never use
  its length, sum preview rows, or invent zero when the count is missing/invalid.
- Explicit expense-record count questions return the deterministic count line before
  existing grounded facts, without calling model composition. Label the count as the in-system non-cancelled total;
  do not pretend it is a vendor/status-specific count. Mixed amount+count questions keep
  both facts. Zero is valid and means no matching counted records, not a source failure.
  Numeric membership alone cannot prevent a model from swapping the roles of count and
  money or quoting the count as a date. The canonical count and grounded amount labels
  therefore remain authoritative, as in the existing daily-closing path; no new unit parser.
- A count question naming a vendor/person, payment, recent-record or status subset is
  not this aggregate's count. Return explicit requested-breakdown-unavailable copy and
  the original grounded detail context without model composition; never substitute the
  global total or infer a distinct/subset count from previews, including when total is zero.
  This is a conservative response-boundary guard, not a new router or aggregation policy.
- Ordinary possessive context (`ร้านเรา`, `ร้านของเรา`, `บริษัทเรา`) is the current
  company's context, not a distinct-vendor filter. Explicit exclusion of both rejected and
  voided records matches this tool's existing basis and must not cause refusal. Normalize
  only these phrases for the breakdown guard, leaving the actual question/source intact;
  other vendor/status terms still require unavailable copy. Excluding just one status or
  requesting an additional subset does not establish a matching global-count request.
- Missing/invalid `total` yields explicit count-unavailable copy and no model guess.
  `truncated: true` is incomplete data: no exact amount/count answer or model composition.
  This slice does not add subset aggregation or change the API count basis.
- Numeric/semantic guards, daily-closing determinism, multi-tool responses, permission
  refusals, source refs and tenant links stay intact. Context and value candidates remain
  available to other model paths; they cannot rewrite a sole-expense canonical total.
- Default Flex headings use trusted tool-family/intent metadata. Same-family answers
  may name the topic; mixed/unknown families remain generic. Explicit nonblank card
  titles survive. Refused responses never inherit a business topic or untrusted cards.
- Capture intent is not mutation-success evidence: the deterministic gateway can return
  `capture_accounting_evidence`, `refused: false` and no presentation after no selected
  tools or a failed tool. Use the existing generic answering heading for capture, not an
  inferred received/saved-success heading. Explicit trusted titles and body stay unchanged;
  this renderer adds no outcome inference or new success policy.

## Acceptance and limits

Registered composer/orchestrator/card tests must cover Thai/English count phrases,
count+amount, valid zero, total larger than preview length, no model call for count or
amount-only answers, nonempty-preview date/context/candidate-as-money counterexamples,
swapped count/money and count-as-date responses, missing/invalid count, truncated source, detail/vendor/status intent,
unsupported distinct-vendor/status-subset counts and nested-count decoys,
single/mixed/unknown headings, explicit titles, refusals, and safe tenant links.
Fixtures are synthetic, provider calls are stubbed. These checks prove the local
response boundary, not live semantic-router/model quality, end-to-end latency, full
translation or LINE delivery.

No schema, permission, provider/config/secret, package, cloud, browser, or live-AI change.
