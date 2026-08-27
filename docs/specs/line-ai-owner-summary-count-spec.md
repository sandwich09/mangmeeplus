# LINE AI concise owner summaries and count preservation

Status: Root integrated checks passed on develop `11153296`, 2026-08-27.
Independent bounded review passed; phase PR/CI pending, no deployment authorized.

## Goal and existing authority

Owners should get a brief amount answer for a broad expense summary, but an explicit
count question must not lose its count. This extends the existing operator-intent spec
§8 and business-query coverage spec §7.4; it does not add a keyword router or tools.

PR #264 (`0edb396b1d3bf56c042fbd53194778738e4d696e`) contains one unmerged concise-card
commit. Its amount-only projection misses `ค่าใช้จ่ายเดือนนี้มีกี่ใบ` and `how many
expenses`, removes `total`, and rejects a correct count through its numeric guard.
The pre-existing AccountingSummaryAgent fallback also has no count fact. Reuse the
current composer boundary, where both raw data and grounded fallback are already available.

## Contract

- Only a sole `expense.list_recent` result can use amount-only projection. Explicit
  count wording uses the same predicate as the existing requested-count guard and is
  never amount-only. Record/vendor/recent/status requests keep the original detail data.
- Broad amount summaries expose only their amount to model composition and return the
  corresponding concise grounded total on provider failure or grounding rejection.
- For sole expense results, `กี่บาท` and `จำนวนเงิน` (allowing whitespace between words)
  ask for money, not record count. Remove only these phrases from count-detection text;
  leave the actual question unchanged. A mixed question that still asks `กี่ใบ`/`กี่รายการ`
  remains deterministic count+amount. This is a narrow Thai wording guard, not a general
  currency parser or NLU guarantee. Subsequent model count validation sees the same
  projected data as the model, never the raw record count that was intentionally pruned.
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
  `truncated: true` is incomplete data: no exact amount/count answer or model projection.
  This slice does not add subset aggregation or change the API count basis.
- Numeric/semantic guards, daily-closing determinism, multi-tool responses, current
  conversation context, permission refusals, source refs and tenant links stay intact.
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
count+amount, valid zero, total larger than preview length, no model call for count,
swapped count/money and count-as-date responses, missing/invalid count, truncated source, detail/vendor/status intent,
unsupported distinct-vendor/status-subset counts and nested-count decoys,
single/mixed/unknown headings, explicit titles, refusals, and safe tenant links.
Fixtures are synthetic, provider calls are stubbed. These checks prove the local
response boundary, not live semantic-router/model quality or LINE delivery.

No schema, permission, provider/config/secret, package, cloud, browser, or live-AI change.
