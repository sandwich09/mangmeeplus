# Agent Memory: LINE AI production parity and receipt continuity remediation

Status: Release repair in progress after pre-rollout UAT run `31983841413` failed at AgentCore first create.
Documentation baseline is `3a06829`; repository stories 1-11
are `f0ab272`, `62b88a4`, `a43134b`, `7ce43fd`, `ad4405a`, `37b34e5`, `7fb7e5b`, `d7f8f6e`,
`9985770`, `5333bc0` and `e0f7383`. Look-forward local execution added story 12 (tsx application-graph
boot, `dfa2801`), story 13 (printed VAT annotation, `9b9834c`), story 14 (critical-field stability,
`74c7d70`), story 15 (controlled source-hashed image replay, `618bdb7`), story 16 (real-provider
15-turn conversation, `2be6faa`) and story 17 (aggregate local acceptance gate, `e1d0f5a`). Owner
follow-up documentation `65a8597`, Thai glossary `840a195` and whole-chain test registration `f2af517`
are pushed on `fix-line-ai-prod`. No deployment, cloud or database mutation was performed.

Owner: Product owner / implementation owner on `fix-line-ai-prod`.

Scope: Production AgentCore/ECS source parity; prod-shaped UAT; stored-media clarification continuity;
deterministic expense capture eligibility; grounded receipt follow-up; substitute-receipt preflight;
partial text completion; intervening-question resume; mixed-intent outcome; timeout,
artifact/refusal/delivery observability; whole-chain UAT/Production gate.

Decisions:

- Treat Production screenshots as evidence only; their timestamps correlate to Production logs, not UAT.
- Do not deploy the current AgentCore artifact alone: the current API still has a `pendingMedia` mapping
  defect and an insufficient final capture guard.
- Bind AgentCore and ECS with one immutable candidate manifest and paired rollback.
- Text-only expense capture continues only under the existing amount + purpose/category rule.
- Do not enable model-selected receipt write or any final LINE mutation.
- Enforce the owner-selected/general-spec context at 15 turns/15 minutes; current contract code is 16
  and must be reconciled to 15 rather than expanded to 30.
- Free-text history is not authoritative receipt workflow state. Use bounded typed state/current draft,
  re-resolve access and revision on every turn, and reload source state after context expiry.
- Permit multi-turn text completion only for validated safe draft fields. Text cannot replace evidence,
  identity checks, signatures, approver policy, approval, issued artifacts, posting or tax documents.
- Stage certificate-form-only values as bounded normalized server-side web-prefill state; update
  expense-owned fields only through existing draft/correction guards. Handoff URLs carry opaque
  references, not business values or attachment ids.
- The 15-turn/15-minute limit applies to prompt history, not business-draft lifetime. Typed prefill
  follows expense-draft retention and cleanup; expired pending media is never resurrected.
- Preflight and return every currently knowable permission-visible blocker together; do not unlock one
  validation error per user turn.
- Respect current approval-mode semantics: an absent policy row is default `OWNER_SELF`, not a false
  “feature disabled” blocker; `configured` and runtime `ready` remain distinct.
- Treat an intervening or same-message question as an independent subrequest, then return a current
  resume capsule without consuming unresolved fields.
- Resume only a unique permitted workflow; multiple matches require selection. Pause/cancel never
  deletes the expense, source attachments or issued evidence.
- Do not select a new timeout until full-candidate UAT p95/p99 exists.
- Require the complete replay/failure/state matrix before Production; no layer-by-layer unlock.
- Treat `ผปก`, `คชจ` and `ลค` as bounded semantic-routing glossary entries, never as permission or mutation authority.
- Add one permission-checked daily-closing snapshot rather than composing a financial answer from multiple generic tools.
- Separate expense date, upload date, due date, overdue and no-due-date buckets; group every amount by currency.
- Never claim a bill that never entered the system is missing without an expected-document source of truth.
- The owner accepts the LINE OA unverified banner only for protected-roster `Mangmee Plus Owner Pilot – 2026-08-16`; this is not a general-customer waiver.

Open questions:

- LINE OA verification policy for a named pilot versus all customers remains an owner operational decision.

Artifacts:

- `docs/specs/line-ai-production-parity-and-receipt-continuity-remediation-spec.md`
- `docs/plans/line-ai-production-parity-and-receipt-continuity-remediation-plan.md`
- `docs/product/line-ai-owner-daily-closing-feedback-th.md`
- `docs/specs/line-ai-owner-daily-closing-spec.md`
- `docs/plans/line-ai-owner-daily-closing-plan.md`
- `docs/specs/expense-receipt-upload-spec.md` approval-mode source-of-truth alignment
- `docs/plans/substitute-receipt-company-policy-plan.md` supersession note
- Active cross-cutting gate in `docs/plans/master-implementation-checklist.md`

Verification:

- Owner daily-closing documentation baseline `65a8597` was pushed to `origin/fix-line-ai-prod`.
- Thai business vocabulary is supplied as bounded stable context to both semantic routers while the
  original message remains byte-for-byte unchanged. The corpus covers `ลค.` customer and `ผปก.` +
  `คชจ.` expense routes without deterministic keyword-to-tool selection. Focused router/corpus tests
  pass 34/34, full LINE business-coverage tests pass 391/391, AI Gateway typecheck and diff check pass.
  Configured-provider shorthand rows remain intentionally coupled to the Story 2 daily-closing tool.
- The whole-chain coverage guard now recognizes the repository acceptance catalog as an owned runner,
  and the previously orphaned terminal-outcome suite is registered in its API behavior lane. Catalog
  tests pass 4/4 and the coverage/terminal suites pass 8/8; commit `f2af517` is pushed.
- Story 2 registers `expense.get_daily_closing` as one permission-checked API tool. Sixteen bounded
  aggregate/count/detail queries run in one repeatable-read snapshot and reuse current tenant, branch,
  own and related ABAC. The output keeps occurred/upload/due/overdue/no-due lenses separate, sums exact
  decimals per currency, exposes paid and outstanding portions of partial payments, excludes rejected/
  voided rows from active buckets, bounds detail to 1–10 and reports truncation plus the honest
  never-submitted limitation. Composite due/evidence indexes have a fail-fast lock policy for release
  rehearsal. Focused business/controller tests, schema validation and API/contracts typechecks pass.
- Story 3 now exposes that tool through the accounting/CFO catalog, semantic router and accounting
  specialist. Its deterministic LINE answer preserves scope, date, per-currency totals, paid versus
  outstanding, due-today versus overdue versus no-due, review/evidence/duplicate counts, bounded
  action rows and the never-submitted limitation. Daily closing deliberately skips the model rewrite
  because `due` must never mutate into approval/payment language. LINE business coverage passes
  397/397 including shorthand routing, THB+USD separation, full owner sections and read-only web link.
- Multi-entry ledger/notebook/phone images are now explicitly classified as `MULTI_DOCUMENT`, retained
  behind one three-way clarification and never collapsed into a single expense. Choosing “สรุปหลาย
  รายการ” creates no expense, returns an honest web/review handoff and changes the retained media to
  `RESOLVED_MULTI_ENTRY_REVIEW` only after successful LINE delivery. The focused API flow passes 87/87;
  Prisma schema validation passes and both intake/OCR prompts have regression assertions for the rule.
- Conversation continuity is now symmetric: substitute receipt and pending-media work both answer an
  intervening business question through the normal governed route, keep the pending source state open,
  and append a deterministic resume capsule after the answer. Pending-media clarification data is
  removed from the side-question model payload; two simultaneous workflows produce an explicit
  selection prompt. Existing source-owned partial-field behavior and the exact 15-turn/15-minute bound
  remain covered. Focused media dispatch passes 87/87 and substitute/context suites pass 82/82.
- The whole-chain catalog now has 22 rows: 19 repository scenarios and three source-hashed external
  images. New mandatory rows cover owner daily-closing shorthand, the photographed multi-entry ledger
  and pending-media side-question resume. The controlled-image harness can require `MULTI_DOCUMENT`,
  clarification and absence of a single grand total without storing image paths/facts in git. Catalog
  and harness contracts pass 8/8; the actual three-image provider replay remains a controlled run.
- The updated configured-Bedrock conversation completes all 15 turns with four permission-checked
  reads (daily close, customer, low stock and sales), nine zero-tool turns, one deterministic capability
  follow-up and one denied daily-close request. The denied request plans the correct tool but invokes no
  ERP source, returns `PERMISSION_DENIED` and leaks none of the fixture totals. There are zero non-read or
  final-mutation calls and zero user-facing unavailable turns. Daily close took 16,723 ms; the other reads
  took 10,730–13,323 ms. Internal timeout/throttle events recovered through existing grounded fallbacks,
  so hosted concurrency p95/p99 remains mandatory rather than being hidden by this successful sample.
- The conversation harness now distinguishes a correct permission refusal (expected tool in the plan,
  no invocation) from a normal read (expected tool must actually run), and emits bounded turn/expected/
  planned/invoked diagnostics on failure. It still emits no conversation text or business identifiers.
- The first three-image provider replay found one forward contract gap: the photographed ledger was
  correctly classified `MULTI_DOCUMENT` with clarification required, but its response still exposed one
  `grandTotalAmount`. The shared OCR boundary now returns no single-expense `fields` for every
  `MULTI_DOCUMENT` classification and never runs the single-total vision re-read for that content kind.
  This protects future consumers as well as the current API mutation gate. Controller tests pass 49/49.
- The unchanged-hash three-image replay then passes every assertion. Royal Pizza remains `2,890.00`,
  VAT `189.07`, sale date `2026-08-15`, `ABBREVIATED_TAX_INVOICE` and `PAID`; the handwritten cash bill
  remains `5,260.00`, `HANDWRITTEN_CASH_BILL`, `PAID` with date missing; the ledger remains
  `MULTI_DOCUMENT`, requires clarification and exposes zero draft field keys. No raw image/OCR text or
  customer identity was committed.
- Evidence review used live sanitized ECS/AgentCore/CloudWatch read-back, deployed source inspection and
  focused current-source tests: AI Gateway 84/84; API/LINE 143/143.
- `git diff --check` passed after the document patch.
- All internal wiki links introduced by the new spec/plan/memory resolve to existing repository docs.
- Evidence/stale-claim search confirmed the new gate names the known split SHA, runtime mismatch,
  dropped `pendingMedia`, measured timeouts and amount + purpose/category capture rule.
- Prettier check was not run because this workspace has no `prettier` executable; no dependency was
  added for a documentation-only task.
- 2026-08-16 owner refinements added to spec/plan: partial multi-turn text completion, consolidated
  preflight, intervening-question resume, strict web-only issuance and selected 15-turn context.
- Self-review found and recorded two source-of-truth drifts instead of hiding them: shared contract code
  currently uses 16 turns although the governing/owner decision is 15 (D-09), and an older receipt-policy
  paragraph still claimed no-policy fail-closed although the later owner-approved runtime default is
  `OWNER_SELF`; the authoritative receipt spec and supersession notes now match current policy semantics.
- Final documentation checks passed: tracked and untracked whitespace checks, unique J/R headings,
  sequential Phase 0-7 headings and internal wiki-link resolution. Application tests were not rerun
  because this refinement changed documentation only.
- Story 1 process proof preserves the exact pending-media id, attachment id and MIME type in both
  intake and turn requests. The final API mutation boundary now rejects text capture unless an amount
  is present in exact source/answered-clarification evidence and purpose/category is source-grounded;
  unavailable OCR plus a caption now clarifies instead of creating a model-authorized manual draft.
- Story 1 verification: 165/165 focused API tests passed; API and AI Gateway typechecks passed; `git
  diff --check` passed. The context test now asserts exactly 15 turns.
- Story 2 focused API tests: 102/102 pass across continuation, substitute preparation/repository and
  LINE dispatch suites. Web API focused tests: 15/15 pass. API and web typechecks pass after rebuilding
  the local contracts package; `git diff --check` passes.
- Story 2 self-review prevented two forward failures: web consumption now occurs atomically with
  PREPARED evidence so it cannot stale its own certificate, and hypothetical/intervening questions
  cannot be parsed as payment/reason answers. A web/concurrent revision mismatch fails closed even on
  explicit resume; pause/cancel remain metadata-only.
- Story 3 adds a bounded delivered receipt reference containing only opaque ids/hashes/revision and a
  verification-summary presence flag. A grounded Royal Pizza follow-up reads the current scoped expense
  without invoking the model and separates printed facts, current system state, unknown review fields,
  policy/tax caveats and web action. Multiple current targets require selection.
- Story 3 preserves independent outcomes for the exact reported mixed turn: the pending attachment is
  captured once, the substitute-receipt request is preflighted separately, only its unresolved question
  remains in the ledger, and LINE performs zero PREPARED/sign/approve/issue mutation. Arbitrary side
  questions use the normal read path with the substitute clarification removed from model input, then
  receive a deterministic resume capsule after successful delivery.
- Story 3 look-forward review fixed two latent failures before commit: `findByIdWithRelations` now applies
  caller branch scope to the main expense row, and receipt/illustration pending media is not resolved or
  acknowledged until LINE delivery succeeds. A later redelivery cannot touch the revision of an expense
  that already has active substitute evidence, avoiding self-invalidating PREPARED/certified documents.
- Story 3 focused verification after review: 95/95 selected continuation/dispatch/repository tests pass;
  the larger combined regression run passes 210/210 after the delivery-order hardening; API typecheck and
  `git diff --check` pass.
- Story 4 preserves the fixed capability answer only after its turn is `COMPLETED`, then handles an
  immediately bounded vague follow-up such as “อย่างไหร่” deterministically with examples and the web-only
  final-action boundary. The same text without the delivered capability marker remains on the normal route.
  Typed substitute prefill is lifecycle-bound to its expense row; cancel and atomic web preparation close
  it as `CANCELLED`/`CONSUMED`, and closed values are not resurrected by explicit resume.
- Story 5 adds an optional, bounded AgentCore evidence contract: artifact source/digest/service and
  contract version, hashed runtime binding plus qualifier, measured body/validation/orchestration/HTTP
  durations, model-call count, normalized refusal and error code. Older artifacts remain callable but
  omit identity, so release readiness can reject them without breaking an in-flight compatibility window.
- Story 5 persists only the bounded evidence object on `AiTurn`; prompts, OCR text, media bytes/object
  keys, signed URLs and raw LINE ids have no field in this schema. The runtime client now aborts the
  actual HTTP invocation at the existing 20-second timeout instead of allowing the losing `Promise.race`
  request to continue and overlap a retry.
- Story 5 focused verification: AgentCore runtime/client/turn suites pass 72/72; the full LINE webhook
  use-case spec passes; contracts, AI Gateway and API typechecks pass; Prisma Client generation and
  `git diff --check` pass. No timeout value was changed because hosted candidate p95/p99 evidence does
  not exist yet.
- Story 6 uses an environment-isolated AgentCore candidate runtime plus a source-specific custom
  endpoint pinned to the immutable runtime version. This follows the installed AWS CLI `2.36.15` and
  official versioning behavior: runtime updates create versions, custom endpoints target versions,
  while `DEFAULT` follows latest and is therefore forbidden for accepted candidates.
- Story 6 CI retains `production-image-manifest.json`, exact `agentcore.zip` and its artifact manifest,
  retained `line-ai-contract.ts`, and a canonical release manifest. UAT deploys those exact bytes,
  validates runtime `targetVersion` and `liveVersion`, configures only the UAT candidate resource
  family for task-role invocation, and puts the exact runtime/artifact/object-version/endpoint binding
  in signed Passport V2.
- Story 6 negative coverage rejects split source, rebuilt/tampered CodeZip, changed image or contract,
  source not embedded in the content-addressed object key, runtime/endpoint ARN mismatch, version
  mismatch, mutable `DEFAULT`, extra evidence fields, and a tampered binding inside Passport. Focused
  manifest/binding/Passport/UAT policy suites and all UAT shell specs pass; production bootstrap and
  object-version IAM regressions also pass.
- Story 6 self-review corrected the AWS endpoint response contract from the nonexistent
  `agentRuntimeVersion` field to exact `targetVersion` + `liveVersion`, bound the endpoint ARN under
  the runtime ARN, and stopped treating IAM/AgentCore read errors as absent resources. An
  `AccessDenied` can no longer fall through into create/update and reveal the next error layer.
- Story 7 uses a dedicated Production candidate runtime and execution role so staging cannot mutate the
  legacy live runtime or its trust. READY signs exact retained CodeZip/object version/source/contract,
  runtime version, endpoint target/live version and role identity; Production deploy derives its ARN and
  qualifier only from that signed binding. Mutable GitHub AgentCore identity variables are no longer an
  accepted promotion input.
- Story 7 forward review closed the paired-rollback gap: signed READY now records the previous active AI
  Gateway task definition plus its AgentCore runtime ARN/qualifier, rechecks that pair at the mutation
  boundary, and post-deploy verification rejects an active ECS revision bound to any other qualifier.
  ECS canary rollback restores the previous task definition atomically; bounded controller recovery uses
  the new exact retained pair in global maintenance mode. Static/negative suites cover split source,
  tampered artifact/object version, endpoint drift, prior-pair drift, active-task drift and IAM drift.
- Story 7 focused verification passes candidate binding, Passport, Production promotion resources,
  runtime readiness, READY schema/baseline, readiness/deploy workflow, security preflight/bootstrap and
  serving-mode suites; shell/YAML/JSON syntax and `git diff --check` pass. No AWS call or workflow ran.
- Story 8 injects expected AgentCore source, retained CodeZip digest and runtime contract version only
  from the validated UAT/Production binding. AI Gateway rejects a successful response that omits or
  mismatches that identity; timeout, credential, network and HTTP failures retain the signed expectation
  and endpoint binding without falsely claiming which artifact answered.
- Story 8 deployment gates reject missing/malformed expected identity, ECS/AgentCore source split and
  active-task endpoint/artifact/contract drift. Production READY baseline now signs and rechecks all
  expected identity fields together; it accepts an all-null previous baseline only for the first compatible
  rollout and rejects partial/mixed identity state.
- Story 8 focused verification passes config 115/115, AI Gateway 42/42, API 70/70, all four package
  typechecks, UAT candidate policy, Production READY schema/baseline, Production deploy workflow and
  serving-mode suites. Self-review also narrowed the media-clarification ack parameter to the fields it
  actually consumes, closing a build-only TypeScript failure that the runtime unit tests did not expose.
- Story 9 emits `line.ai.accepted` only when the first durable event row is created and emits one bounded
  outcome record only after its owning status CAS succeeds. Every batched bubble receives an explicit
  intentional-noop outcome; LINE redelivery/reclaim does not increment acceptance again. Successful
  fallback no longer emits a transient delivery-pending outcome before provider-unavailable, while a
  failed fallback remains replayable through the orphan worker.
- Story 9 separates monthly/rate admission, provider/network/HTTP unavailability and real timeout.
  Permission/feature cutoffs in the ledger are acknowledged only after a visible refusal reaches LINE;
  stale turns and delivery-cap poison entries finalize with typed failed-terminal status. Legal-acceptance
  delivery is claimed before terminalization, releases on failed delivery, and stale claims can be safely
  reclaimed without storing raw chat/media data.
- Story 9 look-forward review corrected media clarification, duplicate-pending-media, safety/privacy,
  untyped refusal and mutation-refusal outcome families instead of counting every visible reply as
  delivered. CloudWatch installs the accepted plus nine bounded outcome filters only on the API/web log
  group. Focused LINE outcome/buffer/drain/orphan/gateway tests pass 145/145; API/contracts typechecks,
  serving-mode deploy contract, maintenance pin/validator suites, full local production-image security
  omnibus and whitespace check pass. The full Phase 5 persisted-state reconciliation report remains
  deliberately separate and pending.
- Story 10 adds a read-only persisted-state reconciliation CLI bounded to a required time window,
  optional company scope, 1,000-row pages and a 100,000-row safety cap. It classifies each accepted
  durable event into the same nine terminal families as runtime telemetry and fails closed when an
  event is still in-flight/unknown, duplicated, lacks a reason for failed-terminal, or retains replay
  payload after a non-delivery-pending terminal outcome. Provider event ids are SHA-256 references in
  output, never raw values. Focused reconciliation tests pass 3/3 and API typecheck passes; the command
  was not pointed at a database because the final local persisted-state replay has not run yet.
- Story 11 encodes all 19 mandatory replay rows with semantic outcome/tool/mutation/delivery contracts
  and binds each row to behavioral evidence that the aggregate runner executes. Seventeen rows are
  repository-automated; the Royal Pizza and handwritten-bill rows remain explicitly controlled external
  image replays so raw customer paths/facts cannot enter git or become false green fixture claims.
- The aggregate runner passes catalog 4/4, API 266/266, AI Gateway 172/172, UAT candidate policy,
  Production serving-mode, Production promotion-resource and Production deploy/rollback workflow
  contracts. It exercises partial answers, consolidated blockers, side questions, revision/context
  reload, permission revocation, redelivery, timeout, exact source binding and paired recovery together.
- Whole-chain self-review found and corrected two stale-proof gaps rather than weakening runtime behavior:
  one response-composer fixture still advertised 16 turns, and the buffered-media clarification spec still
  expected generic `completed` even though a visible pending-media choice correctly terminalizes as
  `clarification_required`. The exact reported casual phrases are also asserted as zero-ERP-tool paths.
- Story 12 was found by starting the real local service before conversation replay. The configured
  `tsx watch` loader does not emit TypeScript constructor metadata, so Nest created the first typed
  provider with an undefined config and the gateway could not boot. All Nest-created gateway
  constructors now declare explicit injection tokens; manually constructed provider/agent helpers are
  unchanged. A new application-context test boots the complete auth/security/health/LINE/draft/CRM
  graph under tsx, and both that test and AI Gateway typecheck pass. A real local main process now maps
  all routes and reaches `Nest application successfully started`.
- Story 13 was found by sending the source-hashed Royal Pizza image through the real local Typhoon +
  configured Bedrock OCR path. The first replay returned the correct total/date/document kind but
  omitted the explicitly printed VAT `189.07`. The deterministic cross-check accepted a VAT label,
  optional rate and amount, but not the exact printed annotation shape `VAT 7% (รวม) 189.07`.
- The bounded VAT parser now accepts only the known included-VAT annotations `(รวม)`, `(INCL)`,
  `(INCLUDED)` or `(INC)` between a printed rate and adjacent decimal amount. It still rejects a rate
  alone and multiple tax components. Focused controller/cross-check tests pass 45/45 and AI Gateway
  typecheck passes. Replaying the unchanged source hash returns `vatAmount=189.07`, sale date
  `2026-08-15`, `ABBREVIATED_TAX_INVOICE` and `PAID`; the harness then correctly exposed its own
  display-format mismatch (`2,890.00` versus `2890.00`) before reaching the handwritten row.
- Story 14's repeated unchanged-hash replay exposed two forward nondeterminism gaps rather than a new
  expected-value exception. Royal Pizza alternated between sale date `2026-08-15` and later print date
  `2026-08-16`; its VAT also disappeared when Typhoon's first reading retained the VAT rate/mode but
  lost the amount. The cross-check now deterministically prioritizes exactly one transaction/sale-
  labeled date and leaves multiple such dates missing. A handwritten `7-6-69` remains explicitly
  missing because both D/M readings are possible under ADR-0011.
- The existing one-shot Bedrock image re-read now also covers a missing VAT amount only when the first
  result has a usable total and explicit VAT context. It merges only a second-reading VAT value whose
  cross-checked total equals the first in exact minor units; it never computes VAT, replaces unrelated
  first-pass fields or loops. Focused tests pass 48/48 and AI Gateway typecheck passes.
- The final unchanged-source replay passes both controlled rows end to end. Royal Pizza returns total
  `2,890.00`, VAT `189.07`, sale date `2026-08-15`, `ABBREVIATED_TAX_INVOICE`, `PAID`; the handwritten
  bill returns total `5,260.00`, `HANDWRITTEN_CASH_BILL`, `PAID`, and explicitly reports
  `expenseDate` missing alongside review fields. No raw image, OCR text or customer identity entered
  repository evidence.
- Story 15 adds the reusable controlled-image gate without putting either supplied customer image in
  git. It requires both known scenario ids, an exact SHA-256 for each external file, an explicit
  human-reviewed marker and field-level expectations before making any call. It compares money as
  exact minor units (so comma formatting cannot create a false failure), can assert that an ambiguous
  field remains explicitly missing, caps image size and request time, and reports only hashes, byte
  counts, bounded classifications, field keys and asserted values. Harness tests pass 3/3; the real
  unchanged-hash two-image run passes every assertion recorded in Story 14.
- Story 16 extracts the delivered capability-follow-up check/reply into API domain logic, so the API
  and controlled conversation use the same production function without importing a decorated Nest
  use case into the runner. The focused API dispatch suite passes 84/84 and API/AI Gateway typechecks
  pass after the extraction.
- The real-provider runner stays outside both application build graphs, uses the configured Bedrock
  provider and production Orchestrator, fixed read-only ERP results, current 15-turn/15-minute context
  and five-second human-like cadence. It fails on any non-read category (including suggestion,
  evidence capture or draft creation), fewer than three successful reads/zero-tool turns, empty reply,
  user-facing provider-unavailable route, context drift or final mutation. It writes no API/DB/LINE
  state and emits no conversation text or business/customer identifiers.
- Strict local replay completes 15/15 turns: four read turns (expense/inventory/sales/CRM), ten
  provider-routed zero-tool turns and one deterministic delivered-capability follow-up; zero
  user-facing unavailable turns and zero non-read/final-mutation tools. Measured turn durations were
  expense 19,778 ms, inventory 15,404 ms, sales 13,600 ms and CRM 9,603 ms. Bedrock still throttled
  some internal casual/loop/critic calls and the existing deterministic/grounded fallbacks preserved
  the turn. The expense sample has only 222 ms margin under the 20-second outer runtime timeout, so
  hosted UAT p95/p99/concurrency remains a hard blocker; this local sample does not justify raising
  the timeout or claiming Production capacity.
- Story 17 makes the controlled-image harness contract part of the repository aggregate instead of
  leaving the privacy-safe runner as an unguarded side command. The current aggregate passes catalog
  4/4, controlled-image harness 4/4, API behavior 274/274, AI Gateway 187/187, UAT candidate policy,
  Production serving-mode, Production promotion-resource and Production deploy/rollback workflow
  contracts. The three unchanged source-hashed image rows and the real-provider conversation remain
  separate controlled executions and passed; no raw media or conversation content was committed.
- Final self-review did not convert local success into a live-release claim. The read-only local
  conversation intentionally created no persisted replay window, and the reconciliation CLI therefore
  was not pointed at a database. Hosted AgentCore p95/p99/concurrency, exact immutable UAT read-back,
  signed READY/Production results, LINE OA policy and customer `OPEN` are still mandatory later gates.
- 2026-08-16 owner feedback follow-up records the operator's actual daily-close job, Thai shorthand,
  supplied handwritten/multi-entry evidence, current-code gaps and a no-guess daily-closing contract.
  Local implementation and source-hashed evidence are pushed; PR and hosted release evidence are pending.
- PR #110's first full CI run found one shared launch-surface gap rather than a runtime regression:
  thirteen expense/substitute-receipt API codes had no customer-safe Thai renderer. Their mappings are
  derived from the API eligibility and continuation guards, tell the user the next valid action, and are
  protected by focused expectations plus the source-derived launch-code coverage test. Focused error UX
  tests pass 37/37, the complete Web suite passes 944/944, and Web typecheck passes.
- PR #110 CI run `31958602747` then proved the Web gap closed and exposed a stale security-alarm
  contract test: it selected the first metric `--filter-pattern`, which is now the preceding
  `line.ai.accepted` metric, instead of the named `security-high-risk` filter. The Production deploy
  script still contains both `CRITICAL`/`HIGH` risk clauses and both explicit AI event clauses. The
  test now locates the intended filter by its stable name before validating its pattern; no alarm or
  deploy behavior changed. Focused security tests pass 13/13, the full API suite and API typecheck pass.

Next:

- Open the implementation PR to `develop`, obtain CI/review approval, then promote the accepted revision
  to `main` through the required separate reviewed PR.
- Before any UAT action, read both mandatory cloud/deployment
  runbooks, deploy exactly one complete immutable candidate, and record the exact UAT run id.
- Run the hosted full replay and persisted-state reconciliation before conditional READY. Record hosted
  concurrency p50/p95/p99 as deferred under the owner directive, never as passed, and do not raise the
  timeout from the 19,778 ms local observation.
- Production remains closed until exact paired artifact read-back, signed conditional READY, bounded
  canary, terminal reconciliation and named-pilot customer `OPEN` pass. Run the deferred concurrency
  evidence after opening and close/rollback on the recorded failure conditions.

## Release continuation — 2026-08-17

- The implementation PRs are merged through `main@911227f4813689416225091d07ed080738a81876`.
  Local signed-webhook reconciliation accepted and terminalized 3/3 events with delta zero; the
  successful daily-closing tools took 104 ms and 60 ms while the model loop consumed the tail budget.
- The first live prerequisite ceremony stopped before its first durable write: the temporary role
  policy read back exactly and policy simulation allowed `rds:DescribeDBInstances`, but the assumed
  session immediately received `AccessDenied`. Root readback then proved the bridge, role policy and
  role all retired as `NoSuchEntity`. The evidence excludes an RDS ARN scoping defect and is
  consistent with authorization-plane propagation lag; the new bounded canary distinguishes
  convergence from a permanent deny instead of assuming either one or retrying the unchanged ceremony.
- The wrapper now proves the selected full/clone/endpoint session with one exact non-mutating read,
  bounded by the existing propagation budget, before invoking any durable helper. Fixtures cover
  delayed convergence, permanent failure, every mode and cleanup-before-helper behavior.
- Owner directive `OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONCURRENCY-DEFERRED` explicitly defers only
  hosted concurrency p95/p99 until after conditional named-pilot `OPEN`. The deferred row remains
  unresolved and may not be recorded as `PASS`; the 20-second timeout remains unchanged and the
  measured `19,778 ms` local tail risk is accepted for this conditional pilot.
- Exact hosted identity, role/tenant security, real LINE pilot smoke, persisted-state/accepted-inbound
  reconciliation, forced failure and paired rollback still gate `OPEN`. After opening, the same release
  receives the deferred concurrency run; an unexplained timeout, duplicate mutation, permission leak or
  unreconciled terminal outcome closes the customer gate and invokes rollback. This approval does not
  establish general-customer or capacity readiness.
- UAT run `31979696132` (candidate `3904b1f92e7520b10c5d72ea8cf5e8a0957d34ae`, controller
  `48db8b139b15b6266b674b3c60374d6f6e06f960`) failed before image publication or environment
  mutation because `watchdog-bms-uat-ai-gateway-runtime` still had the pre-AgentCore policy. No
  unchanged retry was dispatched.
- The look-forward audit found two sibling prerequisites that a one-policy repair would have missed:
  the new UAT AgentCore execution role had not yet been established, and GitHub environment `uat`
  had lost `PUBLIC_DOMAIN_URL`. Live readback proved no UAT candidate runtime exists yet, both exact
  UAT secret metadata records exist, `https://uat.mangmeeplus.com/v1/health` responds, and the
  canonical environment variable was restored and exact-read without exposing secrets.
- The remediation adds one scoped non-root `--apply-uat-runtime` ceremony. Before any UAT retry it
  resolves the valid zero-runtime first-deploy state or one unique `READY` steady-state runtime,
  exact-applies/reads the UAT deploy, ECS AI and AgentCore execution roles, checks both secret ARNs,
  and repairs/reads artifact-bucket versioning. UAT preflight repeats the same exact role/policy/trust,
  runtime, secrets and bucket checks before publication. This also prevents the next UAT from falsely
  expecting a broad candidate wildcard after the first deploy has narrowed the task policy to the
  stable exact runtime ARN.

## Release continuation — UAT control-plane repair

Status: implementation and local contract checks complete; merge/ceremony pending and no second UAT dispatched.

Artifacts:

- Failed pre-mutation UAT: `31979696132`.
- Restored environment value: `PUBLIC_DOMAIN_URL=https://uat.mangmeeplus.com` (GitHub environment
  exact readback passed).
- Scoped durable boundary: `infra/security/run-production-promotion-prerequisite-ceremony.sh
  --apply-uat-runtime`.

Verification:

- `bash infra/uat/agentcore-candidate-policy.spec.sh` — PASS.
- `bash infra/security/production-promotion-bootstrap.spec.sh` — PASS, including scoped-mode
  authority selection/canary/cleanup.
- `bash infra/docker/production-image-security.spec.sh` — PASS after updating its exact UAT IAM
  least-privilege assertion and fail-closed provider fixture for the new preflight reads.
- Shell syntax, JSON parsing and `git diff --check` — PASS.

Next:

- Merge the reviewed controller to `develop` and `main`, run the scoped ceremony once with exact
  cleanup proof, then dispatch one fresh UAT `all` candidate. Do not dispatch before the ceremony
  exact-readback succeeds.

## Release continuation — AgentCore first-create failure

- Candidate `9c5cd40fe77a3cdcc26e11077048bebf429af2e3` passed exact PR CI run `31981271392`; controller
  `1e01510e35ecb16d0b1247774a663147e482cc74` dispatched UAT run `31983841413` after the scoped UAT
  prerequisite ceremony passed and cleaned up its temporary authority.
- The run published immutable service/tool artifacts and the AgentCore zip
  `d64692dcf2f6a74b013b8726b09d100e5098476e4bc5ffdaa96296ac74dc7716`, applied three migrations and
  held parent operation `8bbb4b6e-460c-4d82-afd1-4428299f40a4`. It then stopped before AgentCore
  creation and before every ECS rollout.
- Primary evidence is AWS CLI exit 252: `create-agent-runtime` rejected the unsupported
  `--metadata-configuration` option. AWS CreateAgentRuntime currently has no metadata input; AWS
  documents UpdateAgentRuntime as the required operation for `requireMMDSV2=true` before invocation.
- No UAT candidate runtime exists after the failure. The live UAT services remain on their prior stable
  source/runtime and the release task `8ebe018c5f4646f897e20b44a11c3fc3` stopped with exit 0 after
  creating the held parent. No Production mutation occurred.
- Look-forward review found the independent cleanup defect: retirement attempted
  `$DEPLOYMENT_EVIDENCE_DIR/api-web.json` although the AgentCore failure preceded service deployment.
  The repair must preserve post-intent retirement while routing this pre-rollout state to the existing
  exact `PRE_INTENT` recovery requirement; skipping the file alone would leave the parent unresolved.
- Standing owner authorization permits bypassing only the GitHub last-push-approval deadlock after
  exact-head CI/review proof, with immediate restoration/readback. UAT, signed evidence, exact state,
  rollback and customer gates are never bypassed.

Verification pending:

- AgentCore first-create/update command-order, terminal-failure and MMDSv2 exact-readback contracts pass
  in `infra/ai-gateway/h15-trust-boundary.spec.sh`. The installed AWS CLI input skeleton independently
  proves metadata is absent from CreateAgentRuntime and present on UpdateAgentRuntime.
- Live read-only Production output-shape evidence confirms `GetAgentRuntime` returns the artifact,
  environment, network, protocol, role, status/version and `metadataConfiguration.requireMMDSV2=true`
  fields used by the new exact readback; no secret values were printed.
- Pre-rollout cleanup diagnostic plus unchanged post-intent retirement contracts pass in
  `infra/docker/production-image-security.spec.sh`; the complete scanner exits 0.
- Whole-chain repository acceptance exits 0: catalog 4/4, controlled-image contract 4/4, API 274/274,
  AI Gateway 187/187, UAT candidate, serving-mode, promotion-resource and Production V2 contracts.
- Shell syntax, workflow YAML parsing and `git diff --check` pass.
- Exact recovery of parent `8bbb4b6e-460c-4d82-afd1-4428299f40a4` after lease expiry.
- One new UAT run only after merge, prerequisite readback and recovery.

## Release continuation — AgentCore tagging authorization

Status: primary failure isolated; repository repair in progress; no retry dispatched.

- UAT run `31987845249` reached the corrected AgentCore first-create path and failed at
  `CreateAgentRuntime` with AWS `AccessDeniedException`: the session for
  `watchdog-bms-deploy-uat` was not authorized for `bedrock-agentcore:TagResource` on the runtime.
- The script passes `Environment` and `ManagedBy` tags to both runtime and endpoint create commands.
  The UAT and Production deploy policy templates both covered every adjacent AgentCore action but
  omitted `TagResource`; this is a shared release-policy gap, not a UAT-only provider incident.
- The release task `52a66935fdde4ece83fccba9168a4ce1` created held parent
  `2f1da83a-71ec-4202-83c4-3c43d709a5d2`; the failure occurred before ECS rollout evidence. Exact
  `PRE_INTENT` recovery is required before the one allowed retry.
- The repair retains resource provenance tags, adds the missing action to both reviewed policy
  templates and extends the executable policy test across both environments. Live IAM/AgentCore/task
  readback is pending renewed AWS login; no Production mutation occurred.

Verification:

- `bash infra/uat/agentcore-candidate-policy.spec.sh` — PASS; both UAT and Production policies require
  `TagResource` with the complete runtime/endpoint action set.
- `bash infra/ai-gateway/h15-trust-boundary.spec.sh` — PASS.
- `bash infra/security/production-promotion-bootstrap.spec.sh` — PASS.
- `bash infra/docker/production-image-security.spec.sh` — PASS, including 26/26 final migration and
  READY authority tests.
- Both policy templates parse with `jq`; `git diff --check` passes.

## Release continuation — AgentCore workload-identity authorization

Status: primary failure isolated; exact recovery complete; repository repair verified locally.

- UAT run `31993914163` passed exact UAT preflight, published immutable artifacts and completed the
  release task with held parent `4e1df918-72fd-46b1-a315-33c7899a4b0d`. AWS then denied
  `bedrock-agentcore:CreateWorkloadIdentity` during first `CreateAgentRuntime`; no ECS rollout began.
- Live readback proved release task `0c14a694d49e45ec95382dc5b77663bc` is STOPPED, no matching runtime
  or workload identity exists, and `AWSServiceRoleForBedrockAgentCoreRuntimeIdentity` already exists.
- AWS documents that Runtime automatically creates a workload identity. The repair adds only that
  action to both UAT and Production candidate policy statements and extends their shared executable
  contract; it does not attach broad managed access or grant workload token APIs.
- Exact `PRE_INTENT` recovery run `31994699200` completed once with the stopped parent-task proof and
  terminalized the held parent. No UAT retry is allowed until exact-head CI/merge, scoped ceremony and
  live readback pass.

Verification:

- `bash infra/uat/agentcore-candidate-policy.spec.sh` — PASS for both UAT and Production.
- `bash infra/security/production-promotion-bootstrap.spec.sh` — PASS.
- `bash infra/docker/production-image-security.spec.sh` — PASS, including 26/26 final migration and
  READY authority tests.
- Both policies parse with `jq`; `git diff --check` passes.

## Release continuation — Production look-forward audit

Status: exact-head CI passed; Production remains stable/open; promotion prerequisites are ordered but
not yet applied for this release.

- PR-head CI run `31998020876` attempt 2 passed for develop SHA
  `a11d2dfcbac418e377ed33ece8492bec30784489`. Attempt 1 failed only at the bounded
  release-prepare timing spec; the same exact tests passed locally and attempt 2 passed without a
  source change. Security, migration, Production config and secret scanning all passed.
- Production live readback shows all three ECS Express services `ACTIVE`, singleton, capacity `1/2`,
  source `3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1`, serving mode `live`, and no current deployment.
  RDS is available/encrypted/Multi-AZ/deletion-protected with 35-day backup; Redis is available with
  two members, encryption/auth/failover; all 15 Production alarms are healthy. Public PlatformAccess
  and login markup both read `OPEN`.
- Current Production AgentCore runtime is `READY`, version 14, MMDSv2 enabled, with its exact
  versioned S3 artifact. The artifact bucket is in `ap-southeast-1` with versioning enabled; the
  Runtime Identity service-linked role and both required secret metadata records exist. The future
  candidate execution role is correctly absent before first READY creation, while live policy
  simulation allows its create/update/pass-role path and all required S3 actions.
- Exact policy comparison found only two Production deploy-role gaps:
  `bedrock-agentcore:TagResource` and `bedrock-agentcore:CreateWorkloadIdentity`. Production AI-task
  and security-readonly policies already match the reviewed templates. UAT deploy policy lacks only
  `CreateWorkloadIdentity`, and no UAT candidate runtime exists.
- READY would currently fail a later boundary because the one-time A5 reader-bootstrap controller is
  armed and `watchdog-bms-production-a5-bootstrap-execution` still exists. Required order is one new
  successful UAT Passport, full approved Production prerequisite ceremony, one
  `production-a5-reader-bootstrap.yml` run using that exact Passport until self-revocation/role
  absence is proven, then one live READY. Running READY before this cleanup is prohibited.
- The full ceremony's S3 lifecycle exact-read already matches the reviewed contract, but its
  noncurrent-version retention effect still requires the owner's explicit recorded approval before
  `--apply`. Hosted concurrency remains owner-deferred and is not represented as PASS.

## Release continuation — AgentCore endpoint lifecycle readback

Status: UAT run `32000951480` failed after provider convergence; endpoint validator repair verified
locally; no retry or Production mutation dispatched.

- Exact controller `9a258f5853e8a401d9e93597a32329cbb6a0d140` dispatched candidate
  `85f98ed6b4424c8c64ec3ca11365b9c009cdd5fb` once. Immutable images/tools, signatures, SBOMs,
  release task and zero-pending migration check passed.
- The release task `8ca8da2b665f48b1a2325b7cdcd8d8c3` is associated with held parent
  `b11a489a-eeea-445b-80d3-0d412492c8d1`; no ECS rollout began.
- Sanitized live AWS readback proves candidate runtime `watchdog_orchestrator_uat_candidate-NwJNiqG5Jd`
  is `READY`, version `2`, MMDSv2-required, and its source-specific endpoint is `READY` with
  `liveVersion="2"`. The settled endpoint payload has no `targetVersion` key.
- Root cause is the repository verifier's unconditional `jq -er .targetVersion` after convergence.
  This also affects the shared Production resource collector, so fixing only the UAT line would leave
  a predictable later READY failure.
- Required repair is one shared lifecycle-aware exact validator, provider-shaped regression fixtures,
  exact recovery after the parent lease becomes `UNKNOWN`, reviewed merge, and one UAT retry only.
- The shared validator accepts the sanitized live UAT endpoint response for exact runtime/name/version
  `2`. Focused candidate-binding, H-15, UAT policy and Production-resource specs pass. Whole-chain
  repository acceptance exits `0`: catalog 4/4, controlled-image contract 4/4, API 274/274, AI
  Gateway 187/187 and all four release contracts pass.
- The owner explicitly approved the full Production prerequisite ceremony's data-retention effect as
  `CHAT-OWNER-APPROVAL-2026-08-17-DATA-RETENTION`. This approval authorizes that ceremony after a
  successful Passport; it does not convert the failed UAT run into evidence or waive recovery/READY.
