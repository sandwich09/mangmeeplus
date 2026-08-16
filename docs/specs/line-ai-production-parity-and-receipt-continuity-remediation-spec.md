# LINE AI Production Parity and Receipt Continuity Remediation Spec

Status: **DRAFT FOR OWNER APPROVAL — evidence-backed; no implementation or cloud mutation yet**

Date: 2026-08-16

Plan: [[plans/line-ai-production-parity-and-receipt-continuity-remediation-plan|LINE AI Production Parity and Receipt Continuity Remediation Plan]]

Memory: [[agent-memory/line-ai-production-parity-and-receipt-continuity-remediation|task memory]]

## 1. Outcome

UAT and Production must execute the same immutable LINE AI candidate through the same hosted runtime
path, preserve a receipt or other stored media item across clarification and follow-up turns, and
create an expense draft only when the existing deterministic evidence rules authorize it.

The release is not complete when only the first visible failure disappears. One candidate must prove
the full journey from LINE webhook through intake, stored-media continuity, AgentCore orchestration,
permission-checked API/tools, draft/read outcome, LINE delivery and web review before Production is
opened or called fixed.

## 2. Authority and precedence

This is a remediation addendum. It does not replace the product boundaries in:

- [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]];
- [[specs/expense-receipt-upload-spec|Expense and Receipt Upload Spec]];
- [[specs/business-document-image-intake-spec|Business Document Image Intake Spec]];
- [[specs/line-ai-multi-intent-completion-spec|LINE AI Multi-Intent Completion Spec]];
- [[specs/line-ai-conversation-reliability-spec|LINE AI Conversation Reliability Spec]]; and
- [[specs/ai-runtime-production-integration-spec|AI Runtime Production Integration Spec]].

Where older runtime/readiness wording permits UAT and Production to execute different source or
runtime paths, this addendum supersedes it for LINE AI promotion evidence.

## 3. Proven baseline

The following evidence was read on 2026-08-16 from account `311414082667`, region
`ap-southeast-1`, the repository, and the supplied screenshots. Prompt text is not logged; screenshot
to log correlation is by timestamp and observed outcome.

| ID | Evidence | Proven fact |
| --- | --- | --- |
| E-01 | ECS Express service read-back | UAT and Production AI Gateway are active on image digest `sha256:13f291bc6d93a723abf111d8463425811c84863584744d4875428049c1ac89e6` and `GIT_SHA=3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1`. |
| E-02 | Sanitized task environment read-back | UAT uses `LINE_AI_AGENT_RUNTIME=strands-local`; Production uses `agentcore`; both configure a 20,000 ms AgentCore timeout. |
| E-03 | `get-agent-runtime` | Production runtime `watchdog_orchestrator-6xOx1tCbz0`, version 14, is `READY` but runs `GIT_SHA=eaa9005a1857b3cd582ceda743977496ed955110`, last updated 2026-08-09; its object key embeds the same SHA and digest `406b4ecfb738f327781ef85792e0e9c7127308ad25eeb9bad277f9110be36bbd`. |
| E-04 | Git history/diff | Between `eaa9005a1857b3cd582ceda743977496ed955110` and deployed ECS source `3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1`, the scoped LINE AI/API/contracts paths changed 49 files, +2,887/-335, including casual, capability, receipt, menu and continuity fixes. |
| E-05 | Release/readiness source and runs | UAT run `31901904745`, READY run `31903027707` and Production run `31903336753` promoted ECS source `3c8de877...`; CI builds and retains an AgentCore artifact, but no deployment workflow calls `infra/ai-gateway/agentcore-deploy.sh`, while Production readiness hard-codes `eaa9005a1857b3cd582ceda743977496ed955110` as approved. |
| E-06 | Production CloudWatch, 13:40-14:35 ICT | Receipt OCR calls returned parseable success, while follow-up turns repeatedly completed `unknown/refused` with zero tools; one AgentCore invoke timed out at 20,001 ms. UAT had zero events in the screenshot window. |
| E-07 | UAT CloudWatch after the current deploy | The local current-source path completed eight `casual_conversation`, two `capability_help`, and one permission-checked expense read. One business turn took 20,918 ms. |
| E-08 | Deployed source `3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1` | The ledger contract and `openWaitingUser` contain `pendingMedia`, but `process-line-webhook` omits it while mapping `openWaiting` to `openClarifications`. |
| E-09 | Deployed source `3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1` | Any intake route of `EXPENSE_DOCUMENT_CAPTURE` immediately calls `captureExpenseNote.execute`; it does not re-prove amount plus purpose/category at that mutation boundary. |
| E-10 | Production log + screenshot at 14:05 | An ambiguous follow-up routed to `EXPENSE_DOCUMENT_CAPTURE` at confidence 0.72 and the user received the post-capture card. A Production DB row was not independently read back. |
| E-11 | Focused repository checks | Current source passes AI Gateway 84/84 and API/LINE 143/143; the process-level clarification test asserts question/subject but not `pendingMedia`, so the passing suite does not cover E-08. |
| E-12 | Existing product specs | Text-only notes may create a draft only when amount and purpose/category are detectable; ambiguous/unreadable media clarifies; final confirmation/issuance/posting remains web-only. |
| E-13 | Existing context contracts and code | The governing orchestration spec requires 15 stored `AiTurn` rows from the same company/user within 15 minutes, and existing guidance says free-text history is not authoritative slot state. Current `packages/contracts/src/line-ai.ts` instead exports `LINE_AI_CONTEXT_MAX_TURNS = 16` with a 15-minute window. Pending media has a separate 30-minute TTL. |
| E-14 | Existing substitute-receipt API, web journey and product spec | The canonical document is `ใบรับรองแทนใบเสร็จรับเงิน`. Preparation requires authenticated web, `expense.review`, an eligible current expense, reviewed fields, payer, current approval-mode readiness and evidence; certification/approval/issuance remain permission-checked web actions and internal evidence remains `SUPPORTING_ONLY`/`NON_CLAIMABLE`. No policy row currently means default `OWNER_SELF`, not an automatic disabled state. |

The supplied Royal Pizza receipt supports printed vendor/date/document/amount/VAT observations. It
does not prove a meeting, entertainment purpose, company policy, input-VAT eligibility or final
accounting treatment. The supplied handwritten document visibly contains a total candidate, but it
still requires review. External ChatGPT output in the screenshots is comparison evidence, not product
truth and not an instruction.

Sanitized Production log anchors for the reported journey:

| Time ICT | Request id | Outcome |
| --- | --- | --- |
| 13:49:21-28 | `d49fa8ab-afc2-4f8a-a8a0-e02a2437a42d` | `BUSINESS_READ_QUESTION` then `unknown/refused`, zero tools |
| 14:05:42 | `5c81c677-6888-45bc-8346-7341b3e871d1` | `EXPENSE_DOCUMENT_CAPTURE`, confidence 0.72 |
| 14:10:42-48 | `c02d9217-2255-4c22-b966-b010e812b6de` | `UNSUPPORTED` then `unknown/refused`, zero tools |
| 14:11:45-49 | `b041fdfc-7ab7-402f-9723-18448a9488d1` | `UNSUPPORTED` then `unknown/refused`, zero tools |
| 14:23:03-23 | `8d3d7be4-7e5d-45c7-bee5-3df4aae539ac` | AgentCore `TIMEOUT`, 20,001 ms |
| 14:24:00-14 | `dbc4dc62-a45f-41d0-82bb-e6d9e7709d9e` | retry completed `capability_overview`, one tool |

## 4. Confirmed defects and causal chain

### D-01 — Split release identity

The ECS release and the AgentCore execution release are independently mutable and not bound by one
candidate manifest. Production therefore reports the new ECS source while executing the old agent.
Readiness currently blesses the old fixed SHA instead of comparing it to the candidate.

### D-02 — UAT/Production execution-path mismatch

UAT acceptance exercises the local orchestrator while Production exercises hosted AgentCore. Passing
UAT behavior therefore does not prove the Production path, serialization contract, hosted artifact,
timeout or error mapping.

### D-03 — Stored-media context is dropped

The API stores the media and writes its opaque handle to the ledger. The next mapping discards that
handle, so the router sees an unanswered question but not the server-held media relationship.

### D-04 — Advisory route is treated as mutation authority

An intake model route alone can enter text expense capture. This violates the existing requirement
that text-only capture has detectable amount and purpose/category, and that ambiguous media must
clarify rather than mutate.

### D-05 — Post-capture follow-up is not grounded in the captured record

After deterministic receipt intake creates a reviewable draft, a natural question about that receipt
can fall into the model-selectable accounting evidence feature, which is intentionally disabled. The
user receives a feature-disabled refusal although the API already owns a safe captured summary.

### D-06 — Partial intent failure collapses the whole turn

A turn such as “ข้อ 1 และออกใบรับรองแทนเงินสดให้ฉัน” contains a clarification answer and a web-only
mutation request. The current response can discard the permitted first outcome and return one generic
refusal.

### D-07 — Timeout and refusal evidence are incomplete

The configured 20-second timeout is below at least one observed current-source UAT business turn.
Hosted results also lose a normalized refusal reason and artifact identity, producing
`unknown/refused/null` records that cannot distinguish product refusal from runtime drift.

### D-08 — Receipt completion has no grounded multi-turn workflow contract

The current LINE path has short-term free-text history and pending clarification/media records, but
no typed contract for collecting substitute-receipt prerequisites across partial answers, answering
an intervening question and resuming the same expense. Increasing raw history would not solve the
gap: it would leave the model to infer which fields were accepted, which expense is current and
whether web or another actor changed the record.

### D-09 — Implemented context cap drifted from the 15-turn product decision

The orchestration spec and owner decision require 15 recent turns, but the shared contract currently
exports 16 and the API loader consumes that constant. This is a bounded contract drift, not a reason
to expand to 30; the remediation candidate must restore one tested 15-turn value across contract,
loader, gateway request metadata and documentation.

## 5. Scope

### Included

1. Immutable candidate identity across ECS images, AgentCore artifact/runtime and signed release evidence.
2. Prod-shaped UAT execution of the same candidate AgentCore path used by Production.
3. Stored-media continuity through ledger, intake, turn, dispatcher and delivered outcome.
4. Deterministic text/media capture eligibility at the final API mutation boundary.
5. Grounded follow-up over the most recent captured/review record.
6. Per-subrequest completion for mixed clarification, read, web-handoff and refusal turns.
7. Measured latency budget, timeout behavior and end-to-end traceability.
8. Golden replay of the reported casual, capability, receipt, handwritten-document and mixed-intent journeys.
9. Additive compatibility and rollback for an older running AgentCore/ECS revision during promotion.
10. LINE OA verification status as an explicit customer-open readiness item.
11. Multi-turn, partial text completion of safe receipt/substitute-receipt draft fields, including
    interruption/resume and one consolidated preflight of remaining blockers.
12. Enforcing the selected 15-turn/15-minute short-term context bound while making API-owned
    workflow/draft state authoritative.

### Excluded

- Enabling final confirmation, payment, tax filing, ledger posting, document issuance or approval in LINE.
- Enabling `accounting.capture_receipt_evidence` as a model-selected write tool.
- Guessing expense purpose/category, tax eligibility or company policy from receipt pixels alone.
- Storing raw prompts, OCR text, image bytes, signed URLs, secrets or customer identifiers in release evidence/logs.
- Adding a provider, long-term memory system, generic workflow engine or new document database.
- Increasing the general LINE context window from 15 to 30 turns without measured quality, latency,
  cost and privacy evidence.
- Using Production deployment as a discovery test for incomplete lower layers.

## 6. Required user journeys

### J-01 — Casual and capability conversation

- Harmless casual text returns a short zero-tool Nong Mangmee reply.
- “ทำอะไรได้บ้าง” returns capability help without company/dashboard reads.
- A follow-up such as “อย่างไหร่” remains attached to the immediately delivered capability context or
  asks one concrete clarification; it does not silently become generic unsupported text.

### J-02 — Receipt capture and grounded follow-up

1. A permitted linked user sends one receipt.
2. Deterministic evidence gates create at most one reviewable draft.
3. LINE shows recognized fields, missing/uncertain fields, duplicate state and a web-review link.
4. A follow-up asking document type or how to use it as a company expense reads the captured draft or
   its bounded verification summary under current permission/company scope.
5. The answer separates printed facts, company-policy questions and finance/tax review. It does not
   invent purpose, meeting context or tax creditability.

### J-03 — Ambiguous reply while media is pending

- The stored media handle remains attached to the open clarification.
- A reply without a receipt/illustration decision and without detectable amount plus purpose/category
  remains pending and creates no expense row.
- The system asks at most one state-aware question about the existing file; it does not ask the user to
  upload the same file again.

### J-04 — Mixed clarification answer and web-only request

- The permitted clarification outcome completes independently.
- The final-mutation/issuance clause receives an honest web-only boundary and permission-filtered link.
- No final document is issued from LINE.
- Ledger consumption is per resolved clarification/subrequest, not all-or-nothing for the turn.

### J-05 — Partial text completion without layer-by-layer errors

1. LINE identifies one permitted current expense/workflow or asks one concrete target-selection
   question when it cannot do so safely.
2. The system preflights every currently knowable requirement and returns one actionable list of all
   missing, invalid or blocked items; it does not reveal one server error per turn.
3. The user may answer any subset in one message. Valid unambiguous values are accepted for the same
   workflow; invalid/ambiguous values do not erase accepted values.
4. The reply echoes the values accepted in that turn, lists all remaining known requirements and
   offers a permission-filtered web action.
5. When the safe draft prerequisites are complete, LINE says the draft is ready to continue in web.
   It does not claim that the certificate was signed, approved, issued or posted.

### J-06 — Intervening question and resume

- A question such as “ใบนี้เคลม VAT ได้ไหม” is answered as a separate grounded subrequest and is not
  consumed as a missing receipt field.
- The reply ends with a bounded resume capsule naming the current expense/workflow and all remaining
  fields. A later natural reply or “ทำใบรับรองต่อ” resumes the same current state.
- A single message may both fill fields and ask a question; each clause receives its own outcome.
- “พักไว้ก่อน” leaves accepted draft data intact. “ยกเลิก” closes only the targeted conversational
  workflow after disambiguation and never deletes the expense or source evidence.
- If more than one open workflow is eligible, LINE never silently switches; it asks the user to choose.
- After the 15-minute conversational window, raw history is not reused. Explicit resume reloads the
  current permission-checked draft/workflow; it never claims unsaved text survived.

### J-07 — Runtime timeout and retry

- A timeout is reported as temporary unavailability, never feature-disabled or permission-denied.
- The same inbound event does not create a duplicate draft during timeout/retry/redelivery.
- A retry after a timeout uses current source state and does not assume an undelivered answer entered context.

## 7. Functional and release requirements

### R-01 — One release identity

Each candidate has one machine-readable manifest containing at least source commit, API/AI/workers
image digests, AgentCore artifact SHA-256/object version, expected AgentCore source SHA, contract
version and build run identity. Production promotes those exact artifacts; it does not rebuild them.

Readiness fails when any of these differ:

- candidate source commit;
- ECS `GIT_SHA` and image-label source;
- AgentCore environment `GIT_SHA`;
- AgentCore artifact key/digest/object version; or
- signed UAT evidence candidate identity.

No source SHA is hard-coded as the permanently approved AgentCore source.

### R-02 — Same prod-shaped UAT path

The signed LINE AI UAT gate invokes the same immutable AgentCore artifact and contract path intended
for Production. Resource names may differ by environment; source, artifact bytes, runtime mode,
model policy, tool contracts and timeout policy may not silently differ.

Local `strands-local` remains useful for focused tests but cannot satisfy the Production promotion gate.

### R-03 — Compatible promotion and rollback

Before implementation chooses a promotion mechanism, it must verify the installed AWS CLI and
current official AgentCore version/qualifier semantics. The chosen mechanism must bind an ECS
revision to an exact immutable AgentCore version or isolated candidate runtime. Updating a mutable
default without a reversible binding is not acceptable.

Contract changes remain additive across the rolling window. Rollback restores the previously proven
ECS and AgentCore pair, not one side alone.

### R-04 — Stored-media continuity

`pendingMedia` must survive every mapping from ledger read to intake/turn request. It stays an opaque
server-owned handle, never authorization. The API re-resolves company, user, permission, expiry,
attachment state and source record on every turn.

If later reasoning needs document facts, the API supplies a bounded persisted verification/draft
summary. The model never receives an unrestricted object key, signed URL or database handle.

### R-05 — Final mutation-boundary guard

`EXPENSE_DOCUMENT_CAPTURE` is advisory and insufficient by itself. Immediately before any draft
write, the API must prove one of the existing authorized paths:

1. media classification passed the deterministic expense-document evidence gate; or
2. the user resolved the exact pending-media clarification as expense evidence; or
3. a text-only note has source-grounded, detectable amount and purpose/category as required by the
   Expense and Receipt Upload Spec.

Otherwise the result is clarification/no-op. Confidence alone never authorizes the write.

### R-06 — Grounded receipt continuation

A delivered capture outcome records a bounded continuation reference to the created/reused draft and
verification summary. Follow-ups may read it only through current permission-checked API/source
boundaries. Feature-disabled write-tool copy must not replace a valid read/clarification answer.

### R-07 — Per-subrequest outcome

Each detected clause ends as exactly one of: grounded answer, draft capture, one clarification,
web-only handoff, typed refusal or temporary unavailable. One refused clause does not erase another
completed clause. Only successfully delivered outcomes/clarifications are consumed into context.

### R-08 — Substitute-receipt boundary and truthful response

User wording such as “ใบทดแทนใบเสร็จ” is normalized to the canonical
`ใบรับรองแทนใบเสร็จรับเงิน`. LINE may inspect eligibility/readiness and collect safe draft facts, but
must not invoke preparation, certification, signature, approval, PDF issuance, confirmation, posting
or tax mutation endpoints that are web-only.

For one resolved expense, the response must distinguish:

- eligible and ready to continue in web;
- eligible but blocked, with every currently knowable blocker listed together;
- ineligible because a valid receipt exists or the source is not a real paid business expense;
- missing/ambiguous target, requiring one target-selection clarification;
- permission/company/branch denial; and
- temporary runtime/provider failure.

Only the first two states receive a target-specific substitute-receipt link. Other states may receive
the permission-filtered normal review, target-selection or settings remedy appropriate to that state;
they never receive an inaccessible or cross-scope target link. Generic feature-disabled copy is
invalid when the workflow exists but is web-only or not yet ready.

An eligible/blocked card includes only grounded expense identity/amount, the canonical document name,
accepted values, all remaining permission-visible blockers, the explicit web-only issuance boundary,
the internal-evidence/non-input-VAT caveat and the correct next action. It says “พร้อมดำเนินการต่อในเว็บ”
or equivalent, never “ออกเอกสารแล้ว”, until current source state proves issuance.

### R-09 — Typed partial slot completion and consolidated preflight

Free text may supply bounded normalized workflow candidates for missing-receipt reason, business
purpose, payee, payment date/method, item description, amount and configured category. Certificate-
form-only values are staged as authenticated web-prefill state and do not create `PREPARED` evidence.
Expense-owned values may update the reviewable expense draft only when the existing capture/correction
permission, status, provenance and validation rules authorize that field. “ฉันเป็นผู้จ่าย” may resolve
only to the current active LINE-linked member in scope; an arbitrary typed name cannot impersonate
another payer.

Text cannot replace a required source/supporting/payment evidence file, payer or approver signature,
approver policy, approval, PDF artifact, final confirmation/posting or external tax invoice. Printed
receipt facts and user-supplied business facts keep distinct provenance.

Before every prompt or web handoff, one API-owned preflight evaluates every requirement knowable for
the resolved target, including current eligibility/status/revision, reviewed amount and line details,
category/account hint, reason/purpose, payer/payee, payment date/method, current approval-mode readiness,
supporting/payment evidence, permission and branch scope. The response returns all actionable
failures together. Target selection may precede this only when no unique target can be resolved.

Each accepted partial answer is idempotently bound to the same workflow/expense and validated at the
API-owned continuation or draft-mutation boundary, as applicable. Store the bounded normalized value
and per-field provenance required to prefill/review it, never the whole source message. A bad or
ambiguous field leaves other accepted fields intact. The model never marks a slot resolved merely
because it appeared in conversational history.

### R-10 — Interruption, resume and bounded context

The general short-term context is exactly 15 stored turns within 15 minutes; the current shared
constant of 16 must be corrected and this remediation does not increase it to 30. A bounded typed
continuation state, not raw chat history, carries at least workflow id, company/user/expense identity,
status, normalized accepted values with per-field provenance, resolved and missing field keys,
attachment references, pending question, target revision and last activity. Raw prompt or OCR content
is not copied into that state.

The web handoff carries only an opaque workflow/expense reference. After authenticated permission and
revision re-checks, web loads the server-side accepted values for review; normalized business values,
attachment identifiers and customer facts are not placed in the URL.

The 15-turn/15-minute limit governs model conversation history, not the lifetime of a reviewable
business draft. Typed prefill state is company/user/expense scoped, follows the existing expense-draft
retention boundary, and is closed or purged by explicit cancel, successful web consumption or the
applicable retention cleanup. It is never reused for another expense. Pending media keeps its separate
existing expiry and cannot be resurrected merely because normalized text fields remain.

On every turn, the API re-resolves current company, membership, permissions, branch, expense revision,
attachments and policy. An intervening question is processed independently, then the response may
append a resume capsule generated from current source state. If web or another actor changed the
expense, LINE reloads and reports the conflict/current state instead of overwriting it. After short-term
context expiry, explicit resume discovers the current permitted open workflow/draft; multiple matches
require selection and no match gets an honest fresh-start/web response.

### R-11 — Evidence-derived latency policy

Do not select a new timeout by opinion. Record per-stage latency and model-call count for the fixed
replay matrix and expected-concurrency UAT run. Any timeout change must be derived from measured
p95/p99 and recorded with its margin. Acceptance requires zero unexpected timeout in the fixed
journeys and no timeout caused by a known serial call that can be deterministically skipped.

### R-12 — Trace and refusal contract

Every turn must be reconstructable from sanitized identifiers across webhook acceptance, buffer,
intake route, AgentCore invoke, tool calls, draft/read outcome and LINE delivery. Records include the
candidate source, AgentCore artifact/version, normalized intent/refusal/error code, stage durations,
tool outcomes and terminal delivery outcome. HTTP 200 from the buffered webhook is not AI success.

### R-13 — OCR and accounting truth

Provider `ok=true` means only that a response was returned and parsed. Acceptance compares expected
source-backed fields and uncertainty. Golden fixtures do not assert unsupported purpose/category or
tax treatment. Low-confidence/contradictory fields remain `NEEDS_REVIEW` and never become stronger
because a language model produced fluent copy.

### R-14 — Customer trust status

The release evidence records whether the shared LINE OA is verified. A screenshot showing LINE's
“account is not verified” banner prevents an unqualified customer-ready trust claim. Verification is
an external operational track; it must not be disguised as a code fix.

## 8. State and safety invariants

1. One LINE media message produces at most one pending-media row, one attachment and one target draft.
2. Ambiguous text produces zero new draft rows.
3. A text note without detectable amount plus purpose/category produces zero draft rows.
4. A failed/undelivered clarification is not consumed.
5. Permission, membership, company and branch scope are re-resolved on every continuation.
6. A stale/expired/deleted attachment cannot be resurrected by ledger context.
7. An older ledger entry without `pendingMedia` degrades to one clarification/no-op, never capture fallback.
8. Retry, redelivery, timeout and rollback preserve idempotency.
9. AgentCore and AI Gateway remain database-free; final source mutation stays API-owned.
10. No final money/accounting/tax/approval/document-issuance mutation is reachable from LINE.
11. Short-term history remains 15 turns/15 minutes and is never authoritative for accepted fields.
12. A side question, invalid value or undelivered reply cannot consume or clear unresolved workflow fields.
13. Partial answers, retries and redelivery update at most one targeted workflow/draft with current-revision protection.
14. “พักไว้ก่อน” and “ยกเลิก” never delete the expense, source attachment or issued evidence.
15. Text never substitutes for a required evidence file, signature, approval or external tax invoice.

## 9. Forward impact and gap analysis

| Change | Forward risk if addressed alone | Required paired control |
| --- | --- | --- |
| Deploy current AgentCore artifact | Reveals current-source media/capture, continuation, context-cap and latency defects that stale Prod previously masked | D-03 through D-09 and replay matrix must pass before Production promotion |
| Preserve `pendingMedia` | Richer context could make the router more confident and increase unintended writes | R-05 deterministic mutation guard in the same candidate |
| Add receipt continuation | Stale permission/company/branch context could expose a prior record | Re-resolve identity/access/source state; use opaque reference only |
| Split mixed intents | Whole-ledger ack could lose a refused or waiting clause | Per-subrequest delivery and consumption semantics |
| Raise timeout | Hides serial-call/cost growth and increases retry overlap | Per-stage latency/call-count telemetry and idempotency; derive timeout from p95/p99 |
| Add detailed logs | May leak receipt/OCR/prompt/customer data | Bounded codes, hashes and ids only; redaction tests |
| Add golden image tests | Raw user receipts may enter git and overfit one vendor/layout | Approved redacted fixtures, source hash/provenance, field-level uncertainty assertions |
| Rolling AgentCore/ECS deploy | Old and new contracts may overlap | Additive contracts and proven paired rollback |
| Tighten capture gate | Legitimate one-action text notes could stop capturing | Preserve the existing amount + purpose/category path and add clear one-tap clarification |
| Add partial text slot filling | Model history could become an accidental source of truth or overwrite newer web edits | Typed API-owned state, per-field provenance, idempotency and current-revision compare-and-set |
| List every blocker together | Readiness output could leak a record or policy outside current scope | Resolve target/access first, then return only permission-filtered actionable blockers |
| Allow intervening questions | A side question could be consumed as a field answer or clear the pending workflow | Per-subrequest classification plus a source-generated resume capsule |
| Resume by natural language | Multiple open expenses could be confused | Resume a unique permitted workflow only; otherwise require explicit selection |
| Increase raw context to improve continuity | Doubles stale/noisy history without guaranteeing correct slot state | Keep 15 turns/15 minutes; load authoritative workflow/draft state instead |
| Persist normalized web-prefill values | Business facts could outlive the chat or leak through a URL/another expense | Scope to company/user/expense, use existing draft retention/cleanup, opaque handoff and authenticated reload |
| Verify OA | External approval timing could block customer-open communications | Track separately; do not weaken software safety or claim verified status early |

## 10. Mandatory replay matrix

The test fixture set must be privacy-reviewed. Raw supplied images are not committed automatically.
Any redacted derivative retains a source SHA-256 and human-reviewed expected facts.

| Scenario | Expected outcome | Source of expectation |
| --- | --- | --- |
| Royal Pizza printed receipt | One reviewable draft; printed amount/VAT/date/vendor candidates; purpose/category/tax usability remain reviewable; grounded follow-up works | supplied image + receipt specs |
| Handwritten cash bill | Stored media remains attached; total/date are candidates or explicitly uncertain; no detached text note | supplied image + business-document rules |
| Ambiguous urgency reply after image | One clarification/no-op; zero new draft | E-10 + R-05 |
| `ข้อ 1 และออกใบรับรองแทนเงินสดให้ฉัน` | Resolve receipt choice; web-only issuance handoff; no final issuance | multi-intent and mutation boundary specs |
| Eligible substitute request with four missing fields | One response lists all four; zero preparation/issuance mutation | R-08/R-09 + substitute-receipt API contract |
| Two partial text answers across separate turns | Accepted fields remain on one workflow; remaining list shrinks; no duplicate draft | R-09 |
| Partial answer plus VAT question in one message | Safe field outcome and grounded VAT answer both complete; resume capsule lists remaining fields | R-07/R-10 |
| Unrelated question between two form answers | Question is answered without consuming a field; later answer resumes the same expense | R-10 |
| Resume after web edit or context expiry | Current revision/permissions are reloaded; stale values do not overwrite; ambiguous matches require selection | R-10 |
| Valid receipt already exists | Normal receipt-review handoff; no substitute preparation unless unavailable/materially incomplete is proven | Expense and Receipt Upload Spec |
| Text offered instead of required payment evidence/signature | Consolidated blocker remains; zero evidence/signature/approval mutation | R-08/R-09 |
| `หวยแตกมาก` | casual zero-tool reply | LINE AI UX spec |
| `ต่อยกันไหม` | safe casual zero-tool reply, no ERP data/action | LINE AI UX spec |
| `ระบบเธอทำอะไรได้บ้าง` then `อย่างไหร่` | capability help followed by contextual explanation/one clarification; no dashboard read unless explicitly requested | LINE AI UX spec |
| `/companies` | deterministic company list/control path; no AgentCore dependency | current command contract |
| Forced AgentCore timeout | typed temporary unavailable; zero duplicate mutation; retry remains valid | reliability spec |
| Permission revoked between capture and follow-up | explicit forbidden/no data disclosure; stored record unchanged | permission and multi-intent specs |
| Same media redelivered | one draft/attachment/outcome | idempotency specs |
| AgentCore/ECS SHA mismatch | readiness fails before promotion | R-01 |

## 11. Whole-chain release gate

No phase may be deployed to Production merely to expose the next failure. Production promotion
requires one candidate to pass all of the following in order:

1. repository contract/unit/integration/security tests, including tests that fail on E-08/E-09;
2. immutable artifact manifest and AgentCore/ECS parity verifier;
3. prod-shaped UAT deploy of the complete candidate through AgentCore;
4. the entire replay matrix, with state/read-back proving no false or duplicate drafts;
5. expected-concurrency latency run with stage p50/p95/p99 and zero unexplained terminal outcomes;
6. forced timeout, provider failure, permission revocation, delivery failure, redelivery and paired rollback drills;
7. an observation window with every accepted inbound reconciled to delivered, intentional no-op,
   delivery-pending or typed failed-terminal;
8. signed UAT and READY artifacts binding the same source/artifacts/runtime evidence; and
9. Production customer `OPEN` acceptance through the mandatory deployment protocol.

A successful workflow conclusion, HTTP 200 webhook, `READY` AgentCore status, parser `ok=true`, or
passing local tests alone is insufficient.

## 12. Rollback

- Preserve the last proven ECS/AgentCore pair and its manifest.
- Roll back both sides as one release intent.
- Park/close the customer gate before rollback if compatibility or mutation safety is uncertain.
- Re-run the mismatch verifier, safe casual/capability check, one receipt read-only check and one
  idempotency check after rollback.
- Never roll back to the known split pair `3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1`
  ECS + `eaa9005a1857b3cd582ceda743977496ed955110` AgentCore and call it healthy.

## 13. Acceptance criteria

- [ ] UAT and Production promotion evidence bind the same source and immutable AgentCore bytes.
- [ ] Readiness dynamically rejects any ECS/AgentCore candidate mismatch.
- [ ] UAT signed acceptance executes AgentCore, not only `strands-local`.
- [ ] `pendingMedia` survives the process-level request mapping and its end-to-end test.
- [ ] Ambiguous media follow-up and incomplete text note create zero drafts.
- [ ] Valid text note with detectable amount plus purpose/category still creates one reviewable draft.
- [ ] Captured receipt follow-up answers from the current permission-checked record/summary.
- [ ] Mixed clarification + web-only mutation completes each clause without final LINE mutation.
- [ ] General context remains 15 turns/15 minutes; free-text history is not authoritative workflow state.
- [ ] Partial text answers fill only validated safe draft fields on one idempotent workflow and report
      all remaining blockers together.
- [ ] Evidence, signatures, approval, issuance, posting and tax treatment cannot be satisfied by text.
- [ ] An intervening or same-message question completes independently and leaves a correct resume capsule.
- [ ] Resume after web edits, permission/company changes or context expiry reloads current source state
      and never overwrites or discloses a stale record.
- [ ] Multiple open workflows require explicit selection; pause/cancel never deletes source business data.
- [ ] Reported casual/capability journeys pass on the hosted candidate artifact.
- [ ] Fixed replay and expected-concurrency UAT runs record acceptable measured latency with no
      unexplained timeout; any timeout value is justified by those measurements.
- [ ] Every terminal turn records artifact identity, typed intent/refusal/error and delivery outcome.
- [ ] Redelivery/retry/rollback produce no duplicate target record.
- [ ] Raw customer media/prompt/OCR text is absent from logs and release artifacts.
- [ ] LINE OA verification status is truthfully recorded before customer-ready claims.

## 14. Non-blocking decisions to record during implementation

- Exact AgentCore immutable binding mechanism after current CLI/official-doc verification.
- Measured timeout and latency SLO after the complete UAT candidate exists.
- Whether OA verification is required for all customers or an owner-approved named pilot may run with
  the warning. This does not alter any software safety gate.
