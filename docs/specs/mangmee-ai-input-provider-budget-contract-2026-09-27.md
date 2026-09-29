# Mangmee AI input, provider and budget contract — 2026-09-27

Status: **Proposed normative implementation appendix for conversation spec v2.4; not implemented or enabled.**

Owner: W01/W03/W11/W13; verification W14/W15. Source audited: `f932b57766f5dd22c0d28aedd4bc06f210e374ef`. Parent: [conversation specification](mangmee-ai-understanding-and-advisor-reliability-spec-th.md), especially §§16, 19–20; [implementation plan](../plans/mangmee-ai-understanding-and-advisor-reliability-plan-2026-09-26.md). This appendix fixes the decisions below; implementation must not silently select different limits. Changing a default requires a versioned amendment and a new candidate evaluation.

Scope: complete text admission, evidence spans, provider completion, same-model adaptive work and paid invocation bounds. Business documents mean รายจ่าย, ใบทดแทน and ใบเบิก, including existing draft creation/correction boundaries. No model migration, new provider, hidden reasoning API, autonomous final posting/payment, or audio is introduced. The separately gated R2 public lookup and document Q&A profiles in §6 implement the [core capability contract](mangmee-ai-core-capability-contract-2026-09-27.md); they cannot borrow text/OCR profiles.

## 1. Existing behavior and reproduced defects

At the pinned source, the buffer uses 20 items/4,000 characters; downstream normalization and transport limits differ. Value candidates silently cap amounts/dates/periods at 20/12/12. The provider guard counts UTF-8 text bytes, catalog/schema bytes and declared media ceilings, while `line-intake-text` permits 20,000 input tokens. Source references are in §12.

An in-memory probe loaded the pinned router, contracts, estimator and provider adapters with synthetic input and mocked transports. It made no provider/network/database calls and wrote no application files:

| Probe | Result | Interpretation |
|---|---:|---|
| Short Thai text, capabilities off | estimator 14,239; limit 20,000 | negative control fits |
| Same text, advisor on | 19,194 | only 806 bytes of current estimator headroom |
| Same text, fused on | 40,779 | existing SPLIT input refusal |
| Same text, fused + advisor | 45,734 | existing SPLIT input refusal |
| OpenAI incomplete function arguments | `ok:true`, arguments `{}`, `stopReason:tool_use` | malformed/truncated calls are presented as usable calls |
| Bedrock non-text block followed by visible text | `ok:true`, empty text | first-block-only extraction loses visible content |
| Current envelope output 1,024 / changed 4,096 | accepts / rejects | exact-bound version skew is intentional fail-closed behavior |
| Sonnet LINE full-profile hold at FX33: output 1,024 → 4,096 | 546 → 698 satang per call | raising shared ceilings changes short-call admission too |

These are source/probe facts, not deployed flags, current p95, actual model token counts or release acceptance. Absent a budget envelope, the existing wrapper passes through. New numeric limits below are **design defaults subject to feasibility gates**, not limits already validated by these probes.

## 2. Complete input and units

Use the existing intake/turn contracts with an additive, versioned `inputEvidence` field, not another conversation service. V2 `messageText` is the complete raw joined text. It must not contain the old lowercased/whitespace-collapsed/sliced semantic view.

```ts
type SourceRefV2 = {
  partId: string;                  // server-generated, within this turn
  startUtf16: number;              // inclusive, original part offsets
  endUtf16: number;                // exclusive
  rawSha256: string;               // lowercase hex SHA-256 of original UTF-8 part
};
type InputEvidenceV2 = {
  version: 2;
  turnKey: string;                 // opaque server-derived identity; no raw LINE ids
  parts: Array<{
    partId: string;
    eventIdHash: string;
    acceptedAtMs: number;
    rawText: string;
    rawSha256: string;
  }>;
  joinedSha256: string;
  complete: true;
  utf16Units: number;
  utf8Bytes: number;
  normalizationVersion: 'lookup-v2';
};
```

Admission limits: **20 text parts; 12,000 UTF-16 code units and 48,000 UTF-8 bytes for the joined turn**, counting one literal `\n` separator between parts. All conditions apply. IDs are bounded ASCII ≤128 characters; hashes exactly 64 lowercase hexadecimal characters; time is a nonnegative safe integer UTC Unix millisecond value. Reject unpaired surrogates and unsupported C0 controls; allow tab, CR and LF as original content. A separator has no source authority: spans cannot cross parts. Offsets must be safe integers, within the part, and must not bisect a surrogate pair. Text equality uses original code units, not visual similarity.

The original text preserves case, spacing, newlines, Thai digits, punctuation, combining marks and the user's negation/correction suffix. It is the only view allowed to supply a persisted vendor/document/note value. A separate locally computed `commandView` may trim/collapse whitespace and lowercase for exact commands; it is never the model's replacement input or evidence. Candidate matching may use a digit-normalized or NFC lookup view only with an explicit lookup-index → original-grapheme-span mapping. Do not derive original offsets with `indexOf` after normalization: repeated equal strings have different provenance.

### 2.1 Buffer/admission algorithm

1. Verify the webhook and legal/access prerequisites, deduplicate and durably accept using existing event rows. Preserve immutable first accepted time and ordered event references.
2. Keep the existing cohort quiet-window/max-wait rules. The 4,000-character threshold becomes a legacy-v1 limit; it must not split a v2 burst into an executable prefix. Freeze the selected contract version on batch creation.
3. At each append, compute joined part count/code units/bytes. If any v2 limit is exceeded, mark the **entire batch** `INPUT_OVERFLOW`; retain event references and bounded diagnostic counts, not an additional unlimited copy of text. Continue collecting event references until the existing seal boundary. Never route, save or send a success for the accepted prefix.
4. At seal, either produce the complete `InputEvidenceV2`, or deliver one explicit overflow reply identifying the supported limit and asking for smaller separate requests or the existing file flow. The latter makes zero model/tool calls and no business mutation. Earlier accepted source events keep their existing retention policy; this appendix does not extend raw retention.
5. `3,900 + 5,000` characters in one otherwise valid burst is one 8,901-unit input, not a 3,900-character job followed by an unrelated 5,000-character job. A 12,001-unit burst is wholly overflowed. A correction in the last part must reach every semantic consumer when the batch fits.
6. Receiver recomputes order, joined text, sizes and hashes. `messageText !== parts.map(rawText).join('\n')`, duplicate part IDs, missing parts, invalid offsets or mismatching digest returns `INPUT_EVIDENCE_INVALID`; no model/ERP calls. Never accept `complete:false` as an executable conversational input.

The first verified accepted event remains the timing origin. Neither overflow, normalization, continuation nor retry resets it. Attachment bytes stay under existing image/PDF admission; they do not masquerade as text parts.

## 3. Candidate replacement and field overflow

Extend existing candidate types/parser rather than maintain a second numeric interpreter. `ValueCandidatesV2` has `version:2`, `inputDigest`, `extractorVersion:'value-v2'`, pinned `todayIso` in Asia/Bangkok, `completeness:'complete'|'overflow'`, candidate arrays and `counts`. A candidate retains existing canonical value/date/period fields and adds `candidateId` and `source:SourceRefV2`; the existing `span` must equal the exact original substring. IDs are SHA-256 of the canonical tuple `(inputDigest, kind, partId, start, end, canonicalReading, extractorVersion)`; different readings of an ambiguous date keep distinct IDs.

The exhaustive limits are **128 amount readings, 64 date readings, 32 period readings and 49,152 UTF-8 bytes for the complete serialized candidate object**. Count readings, including alternatives, not merely matched substrings. Extraction scans all admitted parts; it does not stop after the first 20 values. Each original span is ≤160 UTF-16 units; existing currency/assumption/date validity constraints still apply. Decimal values remain plain decimal strings, not JS floating-point money. Civil dates remain ISO CE `YYYY-MM-DD`; BE display year is derived by code. Relative dates use the admitted turn's pinned Bangkok date across retry/resume. The48KiB limit deliberately includes IDs/hashes/provenance; a24KiB cap could prevent even128 short amount readings from fitting. Count ceilings and byte ceiling both apply, so their maxima need not fit simultaneously.

Algorithm: extract all bounded-input readings → sort by part order/start/end/kind/canonical reading → deduplicate identical tuples → count and encode → either emit all candidates with `complete`, or emit no authoritative candidate arrays with `overflow` and the observed per-kind counts. Never send the first N candidates while implying completeness. The receiver re-extracts with the same version/date from original parts and compares canonical tuples/digest, then verifies every selected ID and span. Substring membership alone is insufficient.

Overflow is `VALUE_CANDIDATES_OVERFLOW`, distinct from invalid evidence. It forbids automatic amount/date/period-dependent write/read arguments from that incomplete set. It does not classify the whole subject as unsupported: the assistant can answer an independent nonnumeric question, or ask for the one affected field/source part. A subsequent explicit field reply is a new complete input bound to the pending task; it must revalidate the selected field, not resurrect the discarded prefix as authority. Long lists needing all numbers use the existing file/review flow. Model-proposed numbers cannot repair candidate overflow by bypassing deterministic extraction.

Business field limits stay with their source DTO/repository. Before preview or write, validate full raw selected values against those limits (including existing vendor200/document60/note500 boundaries where applicable); return `FIELD_VALUE_TOO_LONG` with the field and limit. Do not slice a 201/61/501-unit value or lowercase it to make a write pass. The business-workflow appendix owns preview/revision/application; these source references identify evidence and never authorize a mutation.

## 4. Wire and receiver contract

| Boundary | Sender requirement | Receiver requirement |
|---|---|---|
| Buffer → webhook use case | complete original parts/version/timing | validate once before old normalization helpers run; pass raw semantic input |
| API → intake gateway | original message + evidence + v2 candidates + server capabilities + budget grant | shared runtime parser; recompute hashes/bounds; no silent downgrade |
| API/Gateway → AgentCore | same evidence/candidates/turn version/deadlines and negotiated contract | parse every field; verify exact accepted version/profile digest; preserve structured provenance |
| Router/prepared plan → tool selector | selected candidate IDs/source refs and effective intent slots | resolve against authoritative candidates; prepared/JSON/native use identical check |
| Gateway → ERP API | existing signed permission/delegation plus bounded proposed input/evidence refs | repeat source/candidate membership and business-field validation; live access/source revision remain authoritative |
| Provider → gateway caller | completion metadata + visible content + separately retained usage | use §5 caller policy, not JSON parsing alone |
| Gateway/API → renderer | complete canonical answer or explicit partial outcome | renderer may not erase incompleteness; delivery contract governs lossless presentation |

`inputEvidence.version=2` requires negotiated `input-evidence-v2` and `budget-envelope-v2`. Unknown versions/required fields produce `AI_CONTRACT_UNSUPPORTED` before provider dispatch. Parsers enforce numeric/string/array bounds at runtime; TypeScript casts are not validation. New receivers continue parsing v1 separately with its original rules. A v2 turn never retries through a v1 parser after refusing v2. Old persisted candidates cannot be promoted by adding `version:2`; re-extract from verified original events or ask for missing input.

The adapter builds one immutable `RenderedProviderInvocation` before reservation: approved provider/model/region, prompt version, complete provider messages, tools/schema, image/document references/digests, requested output tokens and provider parameters. Canonicalization is deterministic UTF-8 JSON with lexicographically ordered object keys, original array order, no undefined/NaN/infinite values and no Unicode normalization. Hash the full body including attachment content digest and its MIME type; never log body/content. `payloadDigest`, `schemaDigest` and `inputDigest` are separate SHA-256 fields. Retries with changed correction/tool results are new invocations and new digests.

## 5. Provider completion, usage and consumer policy

V2 provider output is a discriminated success/error union. Success includes `completion:'complete'|'output_limit'|'blocked'|'unknown'`, bounded `providerStopReason`, concatenated visible `text`, and validated tool calls. `end_turn/completed` map to `complete`; `max_tokens/max_output_tokens` map to `output_limit`; provider refusal/filter maps to `blocked`; missing/unrecognized completion is `unknown`. Legacy optional `stopReason` remains only in the v1 compatibility adapter, not as proof of v2 completeness.

Bedrock text extraction collects every actual text block in order. Reasoning/signature/non-text blocks do not become user text, logs or business context. OpenAI must classify incomplete status before considering function calls. Each tool argument must parse to the required object shape and pass its registered schema; invalid JSON is `PROVIDER_TOOL_ARGUMENT_INVALID`, never `{}`. A response with any incomplete/invalid tool call dispatches **none of that response's calls**. `ask_user` is subject to the same completeness rule before its question is accepted. Known blocked/unknown completion cannot be relabeled `end_turn`.

Provider-reported usage is captured immediately after reading the response, before output parsing, and survives every parser/completeness failure. Each paid dispatch appends exactly one usage entry; `ok` records transport/provider outcome, while `completion` and `businessOutcome` record content acceptance. Refusal/truncation/parser failure never zeroes known counters. Missing usage is unknown; timeout estimation uses the reserved invocation bounds, separately labeled `CONSERVATIVE_ESTIMATE`. Do not estimate against a whole 160k profile when only 18k was reserved. SHARED and SPLIT use the same completion/visible-content rules; only monetary enforcement differs.

| Consumer | Complete response | Output limit / invalid output | Maximum repair behavior |
|---|---|---|---|
| Text intake/prepared/general answer | validate full schema and subrequest coverage | no complete-route/write claim, even if partial JSON parses | one repair if §6 total budget/deadline/credit allows |
| JSON plan / selector / native calls | validate schema, available tool and all inputs | no tool dispatch for this response; keep earlier validated read facts | one repair across the turn; counts as another model call |
| Composer / polish | grounded, source/coverage checked canonical answer | do not label clipped text complete; return validated existing fallback/explicit partial | one turn-shared repair; no compulsory polish call |
| Legacy receipt read/extract | existing receipt parsing/reconciliation | preserve current `OCR_OUTPUT_TRUNCATED` fail/re-read behavior | existing total ≤4 provider calls; no added generic repair |
| Capture transcription | retain complete pages and explicit page status | preserve current earlier-page salvage; last incomplete page remains partial | existing chunk retry/job budget; never erase paid complete pages |
| Capture extraction | full validated observation schema | `OCR_OUTPUT_TRUNCATED`, no complete observation set | current per-window one-call profile; no new repair |
| Bank statement stage2 | full rows/schema | `OCR_OUTPUT_TRUNCATED`, no silent partial rows presented as complete | current two-call chain, no added repair |
| CRM summary/reply/intake/profile/booking/insights/broadcast/trust | current domain schema/content validation | existing uncertain/unavailable channel with explicit diagnostic; no autonomous send from partial output | current single call, no generic repair |
| AI draft generation | current validated draft schema | `MODEL_OUTPUT_INCOMPLETE`, retryable false at current job seam | current single call; do not cause job retry storms |

Repair uses only a bounded error code, the original task/evidence and at most 4,096 UTF-8 bytes of non-secret model output needed to explain the schema defect. Do not include raw hidden reasoning. One repair means **one extra provider dispatch total across intake/plan/answer**, not one at every layer. Failed/throttled/timed-out provider dispatches consume the same turn count; no automatic retry outside that allocation. A budget, permission, cancellation, source-stale or contract refusal is never model-repaired.

Adaptive effort means the existing same-model routing/coverage path may select direct answer, clarify, permitted read, or one useful repair. This specification does not turn on native tool loop, provider reasoning parameters or a different model. Native remains default-off until its own budget/dispatch regressions pass.

## 6. Immutable v2 profiles and allocation

Keep `AI_BUDGET_STEP_BOUNDS` v1 entries byte-for-byte. Add a separate versioned profile table in the same contracts module and parser discriminator; do not widen an existing entry. The following are frozen **profile ceilings**, not the amount held on every request:

| Profile ID | Input-token estimate ceiling | Output-token ceiling | Provider dispatch slots per turn/profile |
|---|---:|---:|---:|
| `line-intake-text/2` | 160,000 | 4,096 | 2 |
| `line-intake-image/2` (R2 QA admission only) | 160,000 | 8,000 | 1 |
| `line-control/2` (plan/selector/critic) | 160,000 | 2,048 | 3 |
| `line-answer/2` (compose/polish) | 160,000 | 4,096 | 2 |
| `document-qa/2` (R2 question-only read/answer) | 160,000 | 8,192 | 2 including its single possible repair |
| `public-lookup/2` (R2 approved Responses web-search request) | 32,000 | 4,096 | 1; additionally reserve2 hosted-tool units |

Existing receipt/capture image-intake, receipt OCR, capture, bank, CRM and draft profile bounds/call ceilings remain v1 in this release. Adapter bug repairs apply to them with §5 policies, but they do not acquire text-turn repair or higher limits. The separate QA image-intake v2 profile preserves its8,000 output/one-call ceiling while using actual rendered reservation and the QA global count; it cannot be selected for legacy receipt/capture to escape their limits. PDF question-only admission uses the document-QA reader, not an image-only intake adapter. R2 profiles above remain disabled until their capability, tariff, privacy/egress and quality gates pass; having a row is not activation.

Use positive safe integer requested output caps: plain intake1,536; fused intake2,048; concise answer1,536; detailed answer4,096; control768 (complex validated task/control schema2,048); correction repair uses at most the failed profile ceiling. Existing validated task state or explicit user answer-detail preference chooses concise/detailed; unknown starts concise and may use the one repair if truncation would lose material content. Never infer a provider reasoning budget from these visible-output caps. A multi-intent control response may use2,048 only within the mixed lane already selected by semantic intake.

Global answer-slot ceilings, **including intake**, are general/help2, eligible simple read2, mixed/explain/compare4, counting non-repair calls only; the one repair per turn (intake, control or answer) rides on top of them and never spends an answer slot (amended 2026-09-29 after UAT: an intake repair used to leave a general turn with no slot for its answer, so a greeting got the fallback; `aiBudgetV2CallAllowed`). QA keeps its whole-task two-dispatch ceiling. Before intake, the server grant has an immutable maximum4 but only intake is permitted; after validated classification the API narrows the active lane to2 or4. It never resets counts. A prepared/simple read still renders deterministically; general/simple after an intake repair keeps its one answer call. Mixed may spend intake1 + control1 + answer1 + repair1, or intake1 + control2 + answer1; do not reserve four calls up front. A model-free prepared runtime uses zero runtime provider slots. Read concurrency≤2 is independent of provider concurrency: provider invocations sharing the turn remain serial.

R2 QA has **two provider dispatches across the entire admitted task**, including any paid intake: intake1+QA1, or direct accepted QA1+repair1. It cannot run intake1+QA1+repair1. The direct QA path requires an already explicit accepted question-only document task; it is not a keyword bypass of semantic routing. All requested pages are admitted as one bounded task; QA-only media policy permits≤5 attachments and≤20 selected pages total, with10MiB/file as in the core contract. Its estimator uses the actual pages/media rendered,3,000/page and2,000/image plus text/framing; the current generic8-page guard must dispatch by profile so only QA permits20. Legacy receipt/capture bounds remain unchanged. If an approved adapter cannot read the admitted page set in this two-call envelope, that model/reader combination fails activation; do not split it into invisible unbounded jobs or silently read the first pages. QA output_limit can use the remaining single repair or produces explicit partial coverage, never a complete answer by parsing a prefix.

R2 public research has a whole-turn maximum4 provider calls including intake, lookup, answer and any permitted text repair. The `public-lookup/2` call itself is one Responses invocation with `max_tool_calls:2`, max output4,096,≤5 source facts and no automatic retry/repair of hosted search. Search/open actions together consume at most2 hosted-tool calls, not2 search plus3 opens. Reserve2 units at the pinned external tariff and settle actual reported units plus token usage exactly once. Missing external usage keeps that component's hold unresolved; do not infer zero from missing metadata. This profile is accepted only when the grant's existing approved configured model/provider supports the public capability; a Bedrock grant cannot silently turn into an OpenAI call. A profile/model-specific tariff must cover any search-content token treatment without double counting usage already included in reported input. Unknown tariff/capability leaves public lookup off.

### 6.1 Actual rendered input allocator

1. Freeze required current raw input, current correction/negation, source refs, active clarification, selected capabilities and required schemas. None may be silently dropped to fit.
2. Render only the selected route's tool catalog and required source evidence. Exclude unrelated catalogs, stale raw history and duplicated tool text. Keep explicit coverage metadata when evidence is partial.
3. Optional prior context/evidence is capped at8,192 UTF-8 bytes; remove oldest noncritical entries first, marking omitted entry IDs. Critical task constraints remain required, not silently reclassified optional. Omit a whole entry, never a numeric suffix or half of a source record.
4. Estimate the **actual provider-rendered content**, including every text occurrence, tool specification/schema, tool arguments/results and media occurrence. `utf8-v2` adds4,096 tokens of conservative framing allowance to UTF-8 text/schema byte count plus existing per-image2,000/per-PDF-page3,000 declared ceilings, then rounds up to the next1,024 tokens. PDFs still require provable page bounds; repeated attachments must be counted each time actually rendered. Correct the OpenAI adapter's image placement to the last user message before relying on one-image estimation.
5. Require estimate≤profile ceiling and estimate+requestedOutput≤the approved model's declared context limit. If unknown, fail profile feasibility before enablement; do not assume a new model supports the request. If required content still cannot fit, return `AI_INPUT_BUDGET_EXCEEDED` before paid dispatch, with no prefix task execution.
6. Freeze payload/schema/input digests, estimator version, actual estimated input and requested output. These exact invocation limits are reserved in §7. A model response cannot request a larger hold or mutate a prepared payload after reservation.

The160k ceiling accommodates the admitted raw/candidate/prompt envelope without imposing a160k charge/hold on short text. It is not a claim that every possible maximal serialized prompt fits: feasibility must construct all maxima and escaping/Unicode cases. Any admitted ordinary workload that regresses into budget refusal fails the paired quality gate; fix allocation or amend the profile before release, not during runtime.

## 7. Reservation, tariff and failed-call accounting

V1 keeps its current API-created ordinal0 hold and exact-bound envelopes. V2 reuses the existing internal `budget-step`, reservation, dispatch, settle and reconciliation seams, but reserves **after rendering**, including ordinal0. No separate money service or model preparation call is added.

The API issues an authenticated `BudgetGrantV2` after the applicable access/legal/global AI/billing admission. Required fields: `version:2`, `turnKey`, `authorityKind:'webhook_event'|'ledger_entry'|'qa_job'`, durable authority ID, verified channel/owner digest, attemptKey, pinned monthKey and payer, approved model/provider/region, allowed profile IDs+immutable table digest, maximum turn slots4 (QA2), one repair maximum, admitted/work/final deadline timestamps, nonce and issuer/signing-key version. Private/task-bound grants additionally carry membership/lifecycle epoch and task revision. The existing internal authentication/signing pattern is reused with a distinct purpose; the grant is server authority, never a model/user field.

Authority is the existing durably admitted webhook event/batch (`LineWebhookEventLog` plus its accepted event references), existing ledger entry/delivery (`LineLedgerDelivery`), or the accepted QA job, with bounded `budgetAuthorityJson` metadata and atomic revision. `AiConversation` is an advisory context projection, **not a prerequisite or the financial authority**. Stateless general/help can be admitted when that projection is unavailable; group/public general grants use verified channel/chat admission and only public/general profiles, without fetching private conversation, pending media, company profile or private task history. They still honor applicable AI opt-in/legal/global budget/rate/provider gates and an already authoritative payer binding; missing payer authority is not permission to charge a guessed company. Private reads/writes require their live access/owner epoch and relevant task/source checks separately. A context-store failure must not become a false provider-budget refusal for a stateless answer when durable admission/budget authority is available.

Cancellation/revocation checks consult the durable execution authority and, where private-bound, the current verified owner/membership epoch. Task projection TTL15minutes does not delete the grant, paid holds, usage or reconciliation authority. Explicit opt-out/delete/revoke updates the execution authority according to parent lifecycle policy, prevents new private work and suppresses stale output while preserving required finance/audit evidence. Failure of the durable admission/budget store itself remains unavailable: do not call a paid provider using only volatile authority.

The gateway sends a v2 `budget-step` request containing the grant, global ordinal0..3 (QA0..1), narrowed lane, profile ID, `inputTokenBound`, `requestedOutputTokens`, estimator/prompt versions and sealed digests. The API verifies authenticated caller/grant/durable admitted authority/month/model/profile/deadline and integer bounds, plus live owner/task checks only for profiles that require private/task authority, atomically claims the ordinal under existing locks, prices the **invocation limits**, reserves available money, and commits `DISPATCHED` before returning the envelope. It must not accept caller-selected tariff/model/month/bucket. Ordinal0 is allowed only in this v2 branch; v1 retains `ordinal>=1` and parent-reservation checks.

V2 envelope echoes all immutable grant identity/profile fields plus invocation limits/digests, reservation ID and tariffVersion. Receiver requires exact identity/profile-table version equality, `actualEstimator<=reservedInputBound<=profileCeiling`, `requestedOutput==reservedOutput<=profileCeiling`, same sealed payload/schema digests and same approved model. Mismatch is `AI_BUDGET_UNAVAILABLE` with internal reason, not a silent lower cap. Provider is never called if any check fails. Persist a global invocation key `company#attempt#provider-v2#ordinal` so a changed profile cannot reuse ordinal0. Store actual profile/step/source route on the reservation separately. A claimed slot is not reused after cancellation/crash; reported providerCalls separately counts actual dispatched provider attempts. Restart never recreates a fresh grant/counter for the same turn.

Per invocation: `RESERVED → DISPATCHED → SETTLED`, or `RESERVED → CANCELLED` with proof that dispatch never occurred, or `DISPATCHED → UNRESOLVED` while outcome/spend is unknown. Existing sweep/operator/late-evidence rules remain. No new ambiguous state releases money. Business cancellation does not mean the provider was free. With a DISPATCHED response lost before the gateway starts the provider, retain the conservative hold until the existing proof/reconciliation path establishes the outcome. Repeating `budget-step` cannot dispatch the provider twice.

Reservation formula, integer satang: `ceil((inputTokenBound * max(inputUSD, cacheWriteUSD) + requestedOutputTokens * outputUSD) * pinnedTHBperUSD * 100 / 1_000_000)`. SDK attempts are1. Use an immutable tariff record containing exact model ID, rates, currency/unit, approved processing region and effective version; substring fallback pricing cannot qualify a new v2 profile. Existing approved models remain the only choices. Do not reprice a hold with the process's current tariff at settlement: actual token components use the reservation's pinned rates and FX, half-up rounded once per invocation, with component rounding residue recorded. Paid actuals above the bound are recorded fully and trigger the existing breach closure; never clamp actual usage.

Examples at the currently pinned Sonnet rates/FX33, **arithmetic only**: static40,000/1,024 bound546satang; static40,000/4,096 bound698satang. A rendered18,432-input/1,536-output invocation holds305satang; a48,128-input/4,096-output invocation holds799satang. The profile ceiling itself is not multiplied into every reservation. Insufficient credit returns existing `AI_BUDGET_INSUFFICIENT` and correct scope, distinct from exhausted credit or unavailable evidence. Larger useful work can cost more; quality acceptance cannot hide a new credit refusal as a faster answer.

Each paid repair/failure has its own invocation key/usage row; duplicate response-path settlement is idempotent. Add completion, repair reason and profile/estimator/tariff versions as bounded diagnostics, not fabricated token categories. Billing UI retains measured/estimated/unknown labels and existing total/bucket/model-call reconciliation. No raw prompts, function arguments, hidden reasoning or business text in billing logs.

## 8. Deadline and cancellation contract

Use parent§20 unchanged: first accepted event, general10s/simple15s/mixed30s/public40s base ceilings,3s delivery reserve and sealed bounded burst allowance. Neither per-call repair nor credit polling extends the turn. Before every provider/tool dispatch use `min(configuredStepTimeout, workDeadlineAt-now)` and refuse when≤0. Provider port gains in-process `AbortSignal` plus immutable deadline metadata; only timestamps/turn identities cross JSON, never an AbortSignal object. API→Gateway→AgentCore→provider/tool derives a local controller and propagates cancellation. Keep timeout active through headers, bounded body reading and JSON parsing, not only until response headers.

Private grants issued before paid semantic intake know only the admitted maximum envelope. Their later lane narrowing preserves the authenticated durable row's already-issued absolute work/final deadlines; it narrows profiles, slots and cost authority without retroactively replacing those timestamps. For these private turns, the10/15/30-second lane values remain latency objectives and diagnostic thresholds. The issued envelope remains the hard cutoff and never resets or extends on retry. Direct `PUBLIC_GENERAL` issuance and QA transfer keep their existing deadline formulas. See [LINE AI private grant narrowing deadline](line-ai-private-grant-narrowing-deadline-spec-2026-09-27.md).

QA fixes both timestamps at first admission: `foregroundDeadlineAt=admittedAt+40_000`, `jobDeadlineAt=admittedAt+900_000`. Foreground waiting for the final answer stops by its3,000ms delivery reserve and reports durable progress if the accepted job is incomplete. The job grant's `workDeadlineAt` is `jobDeadlineAt-3_000` from initial issuance; each QA provider invocation is still capped at the existing document45s timeout. The foreground cutoff is not a provider cancellation or another grant. The compatible worker continues the same durable job within that already issued deadline; switching at40s never calculates a new15-minute deadline. Its global provider count remains2, same grant/task identity and original owner epoch, and cannot borrow capture's40 calls. Execution ownership is fenced from initial job claim so a provider already running is awaited/canceled/reconciled, not dispatched again by a second worker. Cancel/delete/revocation and the original job deadline apply to both phases; a result arriving after the foreground cutoff uses the durable result-delivery path, not the expired reply attempt.

States for execution diagnostics: `ready → reserving → dispatched → completed|failed|aborted|outcome_unknown`; these do not replace financial states. Client disconnect alone does not cancel an already durably accepted LINE turn. Explicit user cancel, owner/membership invalidation, superseded task version or work deadline prevents new dispatches and aborts an active request where supported. If underlying work cannot abort, suppress stale ordinary output and settle/reconcile its actual usage. A committed business mutation or UNKNOWN delivery follows the parent recovery/delivery protocol, not an automatic retry or fabricated rollback.

Budget RPCs before dispatch use remaining work time. Settlement after a paid dispatch has its own bounded existing evidence/reconciliation lifecycle and must survive work cancellation; do not fire-and-forget evidence. Retain the existing bounded inline settlement attempts/durable queue initially, but include their time in feasibility and latency measurements. A future optimization may shorten inline settlement only after evidence durability and crash recovery tests pass. Existing document45s call timeout, receipt195s HTTP ceiling and capture40calls/15min accumulated work/5attempts remain separate from chat deadlines.

## 9. Migration and coordinated switch

1. Deploy parsers/adapters supporting both v1 and v2 with v2 issuance disabled. Versioned profile/estimator/tariff definitions are immutable. Capability response advertises their exact IDs/digests plus input/provider-output contract versions. Do not infer support from a build number alone.
2. Add bounded `budgetAuthorityJson` and revision/CAS fields to the existing admitted event/ledger owners (and the new QA job owned by the core appendix), not to the expiring conversation projection as sole authority; add nullable profileVersion, contractVersion, payload/schema/input digests and invocation-limit metadata to reservation/pricing evidence using existing JSON snapshots where appropriate. Existing unique invocation fence remains; add an indexed turn/attempt reference for cross-profile global counting. References to deletable conversation state must not cascade-delete money/audit evidence; authority metadata/receipt is retained at least until all its holds and delivery outcomes are terminal, then follows the applicable finance/audit retention. No raw-text backfill and no candidate offset guesses.
3. Existing reservation snapshots already carry rate/bound data. Backfill tariff identity from the **stored rates**, without changing money or tokens. If a legacy outstanding hold lacks provable stored rates, retain legacy reconcile/operator handling and flag `TARIFF_EVIDENCE_MISSING`; do not silently assign a new tariff. Recorded historical events are never repriced.
4. Publish one release manifest pinning API/Gateway/AgentCore source artifacts, input2/provider-output2/budget2 versions, table digests, estimator, prompt and tariff versions. Test old sender→new receiver and new sender→old receiver. New→old must refuse before provider; it must not strip v2 evidence and execute v1. Rollback support for v2 settle/reconcile remains installed while any v2 hold/delivery is outstanding.
5. Enable v2 issuance only for an explicitly eligible cohort when every hop advertises the pinned combination and §11 gates pass. Full raw input exceeding v1 capacity cannot fall back to v1. Legacy cohorts continue legacy behavior and are labeled separately; v2 claims apply only to the accepted v2 cohort.
6. Rollback disables **new v2 grants**, drains/finishes or explicitly cancels accepted v2 turns, and keeps v2 parsers/settlement until no live v2 holds remain. Do not roll a receiver back to one that cannot reconcile existing v2 invocations. No bound/table mutation in place and no automatic native-loop enablement.

## 10. Errors and user-visible outcomes

| Error | Retry/side effect policy | User outcome |
|---|---|---|
| `INPUT_OVERFLOW` | zero model/tools/writes; same burst not split-executed | ask for smaller separate requests or supported file flow |
| `INPUT_EVIDENCE_INVALID` / `AI_CONTRACT_UNSUPPORTED` | zero provider dispatch; diagnostic mismatch | truthful unavailable, preserve accepted event for controlled recovery |
| `VALUE_CANDIDATES_OVERFLOW` | no numeric/date-dependent mutation from incomplete candidates | ask for affected field or file/review; independent safe answer may continue |
| `FIELD_VALUE_TOO_LONG` | no clipped preview/write | identify field/limit; ask for explicit user replacement |
| `AI_INPUT_BUDGET_EXCEEDED` | no paid prefix call; no automatic model switch | bounded unavailable/required-input request; quality gate records failure |
| `PROVIDER_TOOL_ARGUMENT_INVALID` / incomplete response | no calls from that response; already paid usage retained | one admitted repair or grounded partial/unavailable |
| `AI_BUDGET_INSUFFICIENT` / exhausted / unavailable | no model repair; retain proper scope | existing distinct budget copy |
| `DEADLINE_EXCEEDED` / cancelled / superseded | no new work; cancel active if possible; settle paid usage | parent delivery/recovery outcome; no late ordinary answer |

## 11. Acceptance and implementation commands

Add focused cases to existing suites; no new test runner/dependency/package scripts. Every case asserts provider dispatch count, actual tool arguments, output completeness and reservation/usage state, not only text matching.

| ID | Required fixture and assertion |
|---|---|
| IB01 | 3,900+5,000 burst includes final correction;12,000 boundary succeeds;12,001/21parts wholly overflow with zero prefix writes; no split surrogate |
| IB02 | mixed case/newlines/repeated amounts/Thai digits/NFC equivalent sequences retain original values and exact part offsets; mutated digest or span rejected at both receivers |
| IB03 | 21st and128th short amount visible when the byte cap fits;129th reading yields explicit overflow;64/65 dates,32/33 periods and48KiB candidate envelope; ambiguous alternatives not discarded |
| IB04 | vendor201/document61/note501 fail before preview/write; exact boundaries pass; no silent slice/lowercase |
| IB05 | actual production prompt builders × plain/fused/advisor/both × SHARED/SPLIT × max raw/candidates/context/escaping/repair. Estimate and requested output fit the reserved invocation/profile; current fused>20k regression reproduced as negative control |
| IB06 | incomplete function args with tool id yield no ERP call; blocked/unknown/max_tokens never become complete; Bedrock leading reasoning/multiple visible blocks preserves only all visible text |
| IB07 | receipt rejection, capture earlier-page salvage, bank partial rows, all CRM consumers and AI draft incomplete output keep their declared policies; known paid counters survive parse/error paths |
| IB08 | intake1+answer1, intake repair2, mixed4, fifth call refusal, second repair refusal; model/profile/hash change after hold refused; provider overlap refused while two allowed readtools can run concurrently |
| IB09 | exact rendered hold vs profile ceiling, cached/cold pricing, unknown tariff, changed live tariff with outstanding hold, duplicate settle, timeout estimate≤invocation bound, actual>hold breach; totals reconcile with UI measured/estimated/unknown labels |
| IB10 | both version-skew directions, unsupported profile digest, rollback with live v2 hold, deleted/revoked conversation owner, late evidence after cancel, same-ordinal replay through different profile: no duplicate paid dispatch or deleted evidence |
| IB11 | headers arrive/body stalls; abort during provider and settlement; exhausted queue/debounce budget; no deadline reset; late provider result suppressed while charged/reconciled; committed business draft preserved |
| IB12 | QA intake+reader=2, forbidden third call,20-page selected coverage,40s→background uses original15-minute deadline and same counter, worker fence prevents overlap; public1 Responses/≤2hostedunits, no retry, missing units hold unresolved, model/tariff mismatch refuses and no private query leakage |
| IB13 | context projection unavailable/expired with durable event budget authority: general answer remains eligible; group general issues no private context/profile/pending-media queries; missing durable authority or payer refuses safely; owner revoke prevents private dispatch and old hold still settles after context deletion |

Run on the implementation candidate, not a dirty unrelated checkout:

```sh
pnpm -C packages/contracts exec tsx --test src/line-ai-value-normalizer.spec.ts src/line-ai-prepared-plan.spec.ts
pnpm -C apps/ai-gateway exec tsx --test src/modules/line-ai/infrastructure/provider/openai.provider.spec.ts src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts src/common/usage/ai-usage.interceptor.spec.ts src/modules/line-ai/agents/intent-router.agent.spec.ts src/modules/line-ai/agents/response-composer.agent.spec.ts src/modules/line-ai/presentation/http/expense-capture-routes.spec.ts src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts
pnpm -C apps/ai-gateway exec tsx --test src/modules/crm-customer-ai/agents/*.spec.ts src/modules/ai-draft/generate-draft.use-case.spec.ts
pnpm -C apps/api exec tsx --test src/modules/line-ai/application/company-ai-budget-reservation.spec.ts src/modules/line-ai/application/ai-model-pricing.spec.ts src/modules/line-ai/application/company-ai-usage-meter.spec.ts src/modules/line-ai/presentation/http/internal-ai-budget.controller.spec.ts src/modules/expenses/infrastructure/expense-capture-read.client.spec.ts src/modules/expenses/application/services/expense-capture-read-runner.service.spec.ts
```

Also run existing buffer/webhook/runtime contract and combined LINE regressions for changed seams, focused DB reservation-race/migration tests in an isolated test database, and the parent's paired quality/latency/business-document journeys. Provider-backed feasibility must show reported total billed input≤sealed estimate, actual output≤requested cap, no receipt salvage regression, no invented usage, no increased false refusals for supported tasks and no loss of task completion. Freeze configuration before evaluation; insufficient sample or failed feasibility leaves issuance disabled. No current p95 is asserted here. Documentation completion is not implementation/release completion.

## 12. Exact source map and task record

All references below are pinned-source lines, not line claims about future edits:

| File | Relevant lines / responsibility |
|---|---|
| `apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts` |55–56,171–180: old20/4000 limits; preserve complete v2 burst |
| `apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.logic.ts` |67: destructive normalized helper; restrict to lookup use |
| `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` |4126,4238,5484: normalized input/candidates forwarded; preserve raw semantic evidence |
| `packages/contracts/src/line-ai-value-normalizer.ts` |10–58 types;62–95 parser;420–421,642–643,705,1324 caps; shared candidate/span implementation |
| `packages/contracts/src/ai-budget-bounds.ts` |76–106 legacy rows;185–193 exact equality; preserve v1 and add v2 discriminator/table |
| `packages/contracts/src/ai-lineage.ts` |18–40 usage evidence and invocation identity; bounded additive diagnostics |
| `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts` |485–492 rendered prompt;502–523 completion parsing;626–652 plan retries |
| `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts` |1840–1855 native call/completion; share guards and total count with JSON/prepared paths |
| `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts` |580–604 composer;625–632 polish; caller completeness/coverage |
| `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port.ts` |6–26,59–78: provider input/output/deadline contract |
| `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/openai.provider.ts` |64–73 image placement;165–178 tool parsing;194–207 usage preservation |
| `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts` |72–76 visible extraction;125–175 native/usage;262–272 timeout estimate |
| `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.factory.ts` |15–44 model/timeout/attempt policy;58–70 guard/seam |
| `apps/ai-gateway/src/common/usage/ai-budget-provider.ts` |123–145 estimate;163–193 admission;206–242 settle;263–300 serial guard/paid lifecycle |
| `apps/ai-gateway/src/common/usage/ai-budget-seam.ts` |98–103 envelope parser;137–149 settlement retry/evidence queue |
| `apps/api/src/modules/line-ai/presentation/http/internal-ai-budget.controller.ts` |33–39 v1 ordinal restrictions;93–99 parent reservation lookup; add separate v2 branch |
| `apps/api/src/modules/line-ai/application/company-ai-budget-reservation.ts` |280–300 reservation;788–816 tariff settlement;844 breach; preserve finance invariants |
| `apps/api/src/modules/line-ai/application/ai-model-pricing.ts` |100–115 full-step pricing;135–158 snapshot components; add invocation pricing/pinned settlement |
| `apps/api/src/modules/line-ai/application/company-ai-usage-meter.ts` |604–637 duplicate response settlement;645–677 reporting evidence |
| `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts` |699/727 receipt truncation;813 capture salvage;917 capture extract;962–967 bank output |
| `apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts` |40–44 job limits;280 chunk retry; preserve accumulated counters/checkpoints |
| `apps/api/src/modules/expenses/infrastructure/expense-capture-read.client.ts` |74/106 profile selection;151–165 admission;212–220 usage/cancel evidence |
| `apps/api/src/modules/banking/infrastructure/statement-ai-extract.client.ts` |29 timeout;63 budget kind; shared adapter impact |
| `apps/api/src/modules/crm-inbox/infrastructure/crm-ai-gateway.client.ts` |159–183 refusal/usage carrier; all CRM routes share provider |
| `apps/ai-gateway/src/modules/crm-customer-ai/agents/crm-customer-reply.agent.ts` |40–49 output/parse; equivalent domain policy tests for all eight CRM agents |
| `apps/ai-gateway/src/modules/ai-draft/generate-draft.use-case.ts` |38–63 provider/parse; existing draft caller retains one-call profile |
| `apps/api/src/modules/ai-draft/application/use-cases/generate-suggestion.use-case.ts` |152–154 admission; no retry loop from completeness errors |
| `apps/web/src/features/system-partners/ai-budget.logic.ts` |144–180 evidence labels; pricing/usage changes must reconcile without relabeling estimates |
| `packages/contracts/src/ai-timeouts.ts` |18–41 document timeout/call formulas; not a whole capture-job deadline |

Task record: docs-only proposed decisions and existing source/probe evidence,2026-09-27. Verification in this task: pinned source reads and previously completed synthetic in-memory probes; application tests/provider calls/migrations not run. Next: parent incorporates this appendix into W01/W11 implementation ordering; implement receiver/adapters and exact rendered admission before enabling longer context/answers or repair. Only this appendix is edited by its author; parent owns the shared task memory and master spec/plan.
