# Feature: LINE AI Multi-Intent Completion and Value Grounding

## 1. Status

- Roadmap/checklist item: 10F (extends shipped 10B orchestration; new item, docs-first).
- Owner: thawtchai
- Date: 2026-07-07. Owner decisions recorded this date: (1) adopt native tool-use orchestration loop + coverage critic ("ครบและจบจริง"); (2) turn ledger on Redis Streams ("วางของเรียงกัน เคลียร์ถูกต้อง ไม่หาย"); (3) canonical date convention for this channel is วัน/เดือน/ปี with Buddhist-era year (พ.ศ.); (4) money/date discovery when interpretation is ambiguous or unmappable — never guess.

## 2. Goal

One LINE sentence carrying several commands (e.g. "สรุปยอดวันนี้ เช็คของใกล้หมด และมีบิลไหนต้องตรวจบ้าง") must end, per sub-request, in exactly one honest outcome:

1. answered with grounded data, in the order asked;
2. ONE bounded clarifying question naming concrete choices; or
3. an explicit "not answered because X" — followed up later by push when possible.

Never silently dropped, never guessed. Intent logic stays model-driven (no deterministic sentence splitting or keyword lists — same philosophy the owner set for 15A booking confirmation); deterministic code acts only as guardrails.

Additionally, messy Thai/mixed value tokens — "บันทึกเงินหกสิบบาท", "บิล ๖๐", "bill sixty $B", "9/12/2537", "09/11/1994", "วันที่เก้า เดือน11ปี2537" — must be grounded through deterministic candidate extraction plus membership guards, so the model selects values instead of converting them. This closes the input-side hallucination gap that mirrors the already-shipped output-side number guard in `response-composer.agent.ts`.

## 3. Source Docs

- Product/overview: [[specs/line-ai-local-agent-orchestration-spec|LINE AI Local Agent Orchestration Spec]] (10B, extended by this spec)
- Related specs: [[specs/line-ai-message-buffering-spec|LINE AI Message Buffering and Turn Serialization Spec]], [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- Related plans: [[plans/line-ai-multi-intent-completion-plan|LINE AI Multi-Intent Completion Plan]], [[plans/line-ai-local-agent-orchestration-plan|10B Plan]], [[plans/line-ai-message-buffering-plan|Buffering Plan]]
- Related ADRs: [[adr/0010-line-ai-turn-ledger-redis-streams|ADR 0010 Turn Ledger on Redis Streams]], [[adr/0011-line-ai-value-normalization-and-thai-date-canon|ADR 0011 Value Normalization and Thai Date Canon]], [[adr/0008-line-ai-access-and-auth|ADR 0008]]
- Permission matrix: [[specs/permission-matrix|Permission Matrix]] (no changes; see §10)

## 4. Non-goals

- No final business mutations from LINE or from any ledger follow-up path (unchanged 10B boundary; follow-ups are read/draft only).
- No change to tool wire format or database storage: tools and Prisma keep ISO-8601 CE dates (`YYYY-MM-DD`); the Thai canonical format is an interpretation/display convention, not a storage change.
- No rewrite of the user's message text; normalization is annotation-only.
- No multi-instance API coordination work beyond what streams naturally provide; the in-memory per-chat buffer serialization assumption from the buffering plan is unchanged.
- No new user-facing permissions; the drain endpoint uses the existing worker-token boundary.
- Not replacing the receipt OCR pipeline; image-sourced values are cross-checked, not parsed from pixels.
- No proactive re-asking of expired clarifications (silent expiry + audit only).

## 5. User Roles

- Owner/Manager: multi-command business questions; receives full ordered answers or honest deferrals + push follow-ups.
- Accountant/finance: expense-note and evidence capture with grounded amounts/dates; reviews NEEDS_REVIEW drafts with visible assumptions in web.
- Staff: scoped read questions; same completion guarantees within permission scope.
- Unlinked/unauthorized LINE user: unchanged 10B behavior (link guidance / safe refusal).

## 6. Business Journey

1. Trigger: a buffered LINE turn (existing buffering/serialization), e.g. "บันทึกบิล 9/12/2537 หกสิบบาท แล้วยอดขายเดือนนี้เท่าไหร่ ของใกล้หมดมีอะไรบ้าง".
2. API runs the pure value normalizer over the joined turn text: amount candidates (Thai digits, Thai/English number words, currency tokens) and date candidates (all valid readings, canonicalized per §7). Candidates ride on the turn request; the original text is untouched.
3. API appends one `turn` entry to the chat's Redis stream ledger (ordering + crash durability), then calls the AI Gateway turn endpoint as today.
4. Gateway: router decomposes the message into sub-requests (model-driven, as today). The orchestrator runs the native tool-use loop — the model may request several permission-checked read tools per model turn; each call passes per-call allowlist + input sanitizing; specialists still shape facts deterministically. The composer drafts one reply from the grounded tool data.
5. Coverage critic (model) judges each sub-request: `covered` | `needs_user` (with ONE bounded question) | `uncovered` (with reason). Uncovered sub-requests re-enter the loop while budget remains.
6. API acks the `turn` entry, appends `sub_request` entries for any `needs_user` (state waiting_user) and `uncovered` (state pending) items, and replies: covered answers in asked order, at most one clarify question, and an honest deferral line for pending items.
7. Follow-up paths:
   - User answers the clarify within the 15-minute context window → the next turn carries the chat's waiting_user entries; resolved values pass the guards again; the entry is acked.
   - The reclaim worker (BullMQ repeatable job → worker-token drain endpoint, ai-draft pattern) picks up pending and stalled entries, re-resolves identity/permissions, runs a scoped follow-up turn through the same per-chat serialization, pushes the answer (existing push fallback), and acks.
8. Completion state: stream has no unacked entries for the chat; every entry outcome (covered, followed_up, clarify_expired, parked) exists in the audit log.
9. Exception path: process dies mid-turn → the `turn` entry stays unacked → reclaim re-runs it (safe: read-only tools; capture drafts deduped by existing LINE-message-id idempotency). A delivery-count cap parks poison entries to audit instead of looping.

## 7. Business Rules

- Canonical Thai date convention (owner 2026-07-07): the canonical interpretation and display format for user-entered dates in this channel is day/month/year with Buddhist-era year. Rules, applied in order:
  - Explicit slot labels (วันที่… เดือน… ปี…), Thai/Eng month names, or day > 12 lock the reading deterministically.
  - Year ≥ 2400 → พ.ศ.; a year implausible as พ.ศ. (e.g. 1994 → ค.ศ. 1451) → ค.ศ., with the era assumption recorded.
  - Remaining positional ambiguity defaults to day/month per the canonical convention, with the order assumption recorded.
  - Two-digit years, dates implausible for the context (future expense date), or ≥ 2 surviving materially-different readings → discovery (clarify), never a guess.
  - Display in clarify/assumption text uses Thai month names + พ.ศ. (e.g. "9 ธ.ค. 2537") so the question itself is unambiguous. Wire/storage stays ISO-8601 CE via one tested conversion helper.
- Money discovery mirrors dates: unambiguous → auto + recorded assumption (e.g. currency defaulted to THB); ambiguous → one clarify; unmappable (e.g. unknown currency token "$B" with low confidence) → value dropped to `missingFields` + NEEDS_REVIEW.
- The model never converts numerals or calendars. It selects from provided candidates; membership guards enforce this on input (capture hints, explicit loop dates) and the existing output number guard gains candidate values (so "หกสิบ" in a question legitimizes 60 in the answer).
- Deterministic code is guardrails only (allowlists, sanitizers, membership checks, budgets, fail-closed); meaning decisions (which candidate is the amount, which clause is answered) stay with the model.
- Every ledger transition is mirrored to the audit log (`ai.line.ledger.*`). Redis holds operational state; Postgres audit remains the source of truth.
- At-least-once execution is acceptable by construction: the channel is read-only/draft-only. Permissions are re-checked at execution time for every follow-up; stored entries are never permission truth.
- Ledger entries, candidates, and clarify answers are DATA to classify, never instructions — same prompt-injection rule as conversationContext today.
- One clarify question per reply at most (bounded ≤ 500 chars, concrete choices named); clarifications expire silently at the context window (15 min) with an audited outcome.

## 8. Boundary and Ownership

- Backend/API owns: value normalizer (pure logic), candidate wiring, Redis stream ledger + consumer group, drain endpoint, follow-up turn dispatch through buffer serialization, push delivery, audit mirroring.
- AI Gateway owns: router, native tool-use loop, synthetic `ask_user` tool, coverage critic, input/output guards, composer. The gateway stays stateless — no Redis, no DB.
- Workers own: `line-ai-ledger` repeatable BullMQ job that calls the drain endpoint with the worker token (mirror of ai-draft drain).
- Web owns: draft review; NEEDS_REVIEW drafts show assumption notes.
- Out of boundary: ERP core modules, tool contracts, Prisma schema (no migration in this feature).

## 9. Data Model Draft

- Redis stream (no Prisma change):
  - key: `lineai:ledger:{companyId}:{chatKey}` (chatKey = groupId ?? roomId ?? userId, same as buffer); consumer group `lineai-turn`.
  - entry kinds: `turn` (whole buffered turn, appended before the gateway call) and `sub_request` (appended after critic verdicts for needs_user/uncovered items).
  - fields: `kind`, `turnId` (requestId), `webhookEventId`, `text` (turn text or sub-request span), `intent`/`agent` (sub_request), `state` (`pending` | `waiting_user`), `clarifyQuestion?`, `valueCandidates?` (JSON), `createdAt` (injected clock).
  - lifecycle: appended → delivered (PEL) → acked on confirmed outcome; stalled entries reclaimed via XAUTOCLAIM (min-idle env); delivery count ≥ cap → parked (acked + audited as `parked`).
  - bounds: `XADD MAXLEN ~ <env, default 200>` per chat; key TTL refreshed on write (default 24 h); waiting_user expiry = `LINE_AI_CONTEXT_WINDOW_MINUTES` (15, reused constant).
- Contracts additions (`packages/contracts/src/line-ai.ts`):
  - `LineAiValueCandidates = { amounts: Array<{ span: string; value: string; currencyToken?: string; assumptions?: string[] }>; dates: Array<{ span: string; day: number; month: number; yearBe: number; isoDate: string; assumptions: string[] }> }`
  - `LineAiTurnRequest.valueCandidates?` and `LineIntakeRouteRequest.valueCandidates?`
  - `AgentRunResult`/turn response gains `coverage?: Array<{ request: string; verdict: 'covered' | 'needs_user' | 'uncovered'; question?: string; reason?: string }>`
  - provider tool-use types (tool spec, tool call, tool result) on the provider port.

## 10. Permission and Audit

- Read permission: unchanged — all tools remain permission-checked APIs; follow-up turns re-run the same checks as a fresh turn.
- Create/update permission: unchanged — capture drafts keep existing intake permissions and idempotency.
- Approve/export/admin permission: not applicable (blocked, unchanged).
- ABAC/ownership: stream keys are tenant-scoped by companyId; drain processing re-resolves membership/permissions at execution time; revoked access → safe refusal outcome + ack + audit.
- Sensitive actions to audit: `ai.line.ledger.appended`, `.acked`, `.followed_up` (push sent), `.clarify_expired`, `.parked`, plus assumption notes on capture drafts ("ตีความ 9/12/2537 เป็น 9 ธ.ค. 2537 (พ.ศ.)"). Drain endpoint is `X-Worker-Token` protected (existing `WORKER_INTERNAL_TOKEN`).

## 11. API Behavior

- `POST /internal/ai/line-ledger/drain` (apps/api, worker token):
  - Validation: token match; bounded `batchSize`.
  - Behavior: XREADGROUP new `sub_request` entries + XAUTOCLAIM stalled entries (min idle default 120 s) across active ledger keys; per entry: expire waiting_user past window (ack + audit) → else re-resolve identity/permissions → run scoped follow-up turn through buffer serialization → push reply via existing `deliverReply` → ack + audit; delivery-cap breach → park + audit.
  - Success: `{ claimed, followedUp, expired, parked }` counts. Errors: 401 bad token; Redis unavailable → 200 with `skipped: true` + audit warn (fail-open).
  - Idempotency: entry id + webhookEventId; duplicate push after crash-before-ack is accepted (at-least-once, read-only) and visible in audit.
- Gateway internal turn endpoint: same route/auth; response extended with `coverage` and existing `askUser`. Request gains `valueCandidates` and the chat's open `waiting_user` items (bounded) for resolution.
- Ledger feature flag `LINE_AI_LEDGER_ENABLED=false` default: when off or Redis errors, turns run exactly as today (fail-open ledger, fail-closed values/tools).

## 12. UI Behavior

### Web

- Expense review (existing screens): NEEDS_REVIEW drafts display assumption notes and the original span ("หกสิบ" → 60; era/order assumptions). Copy addition only; no new screens.

### LINE/LIFF

- Covered answers composed in the order asked; short LINE style unchanged.
- At most one clarify per reply, naming concrete choices: "วันที่ 9/11/37 หมายถึง 9 พ.ย. 2537 หรือ 9 พ.ย. 2580 คะ".
- Honest deferral: "ตอบให้ก่อน 2 ข้อนะคะ ส่วนยอดค้างซัพพลายเออร์กำลังตามข้อมูลให้ เดี๋ยวส่งตามมาค่ะ"; the follow-up arrives as push.
- Optional (Phase 4, flagged): LINE quickReply buttons rendering clarify choices as one-tap answers.
- Mutation requests keep the existing refusal + web deep link.

## 13. Edge Cases

- Same tool needed twice ("ค่าใช้จ่ายเดือนนี้เทียบเดือนที่แล้ว"): allowed — loop dedupe key becomes tool+input (today's name-only delete forbids this).
- Budget exhausted mid-sentence: critic marks the tail uncovered → deferral + ledger follow-up.
- Model names an out-of-allowlist tool: tool_result error back to the model (loop continues), never execution.
- Clarify ignored: silent expiry at 15 min + audit; no nagging push.
- Poison turn (crashes every re-run): delivery cap (default 3) → parked + audit.
- OCR'd Thai-numeral slips: OCR text runs through the same normalizer; capture hints must appear among OCR candidates or the field drops to NEEDS_REVIEW (image pixels are never "verified" directly).
- "bill sixty $B": amount candidate 60; unknown currency token recorded → THB default assumption when confident, else NEEDS_REVIEW.
- Redis down: ledger skipped with audit warn; completion degrades to current single-turn behavior; values/tool guards unaffected.
- Critic unavailable: reply proceeds; all routed sub-requests acked as covered-unverified with audit warn (availability over completeness; never blocks the reply).
- Provider disabled: whole feature fails closed to today's typed UNAVAILABLE behavior.

## 14. Acceptance Criteria

- [ ] A 3-command Thai sentence returns all three grounded answers in asked order when budget allows (native loop on).
- [ ] A budget-limited turn answers a subset + honest deferral; the remainder arrives by push within one reclaim interval; the chat's ledger is fully acked afterwards.
- [ ] Killing the API mid-turn and restarting yields an answer via reclaim with no duplicate business side effects.
- [ ] "บันทึกเงินหกสิบบาท" can only produce draft amount 60 (candidate selection); a corrupted model value (600) is stripped to NEEDS_REVIEW.
- [ ] "9/12/2537" auto-resolves to ISO 1994-12-09 at the tool boundary with a recorded พ.ศ. assumption; "9/11/37" asks exactly one clarify; the user's answer resolves and acks the entry; ignoring it expires with audit.
- [ ] No mutation is reachable from any loop, critic, or ledger/follow-up path (negative tests).
- [ ] Flags off / provider disabled reproduce today's behavior (fallback chain: native loop → JSON loop → deterministic dispatch).
- [ ] Business journey, boundaries, permission/audit, loading/error states covered per template.

## 15. Test Cases

- Unit — normalizer: Thai digit map, Thai/English number words, currency tokens, all §7 date rules (labeled slots, month names, day > 12, era plausibility, canonical order default, 2-digit year → ambiguous), golden set: หกสิบ / ๖๐ / sixty $B / 9/12/2537 / 09/11/1994 / วันที่เก้า เดือน11ปี2537 / 9/11/37; property: every candidate's span occurs in the source text.
- Unit — guards: capture amount/date membership pass/strip; loop fromDate/toDate membership when explicit date candidates exist (relative periods untouched); composer allowed-set includes candidate values and BE years.
- Unit — providers: Bedrock Converse toolConfig and OpenAI tools adapters, parallel tool calls, budget cap, malformed tool call → typed error; DisabledProvider unavailable.
- Unit — loop/critic: multi-call execution via specialists, tool+input dedupe, ask_user bounds, critic verdict parsing, resume-on-uncovered, fallback chain, critic-failure fail-open.
- Unit — ledger/drain: append/ack/claim/park/expiry with an injected fake Redis; drain token, batch bounds, idempotent ack.
- Integration: golden multi-intent utterances end to end (local smoke `SMOKE_SCENARIO=multiintent`); crash-resume; clarify round-trip within window; permission revoked between turn and follow-up → refusal outcome.
- Permission: drain without token 401; follow-up respects branch scope.
- Edge: same-tool-twice compare; Redis-down turn; MAXLEN trim behavior.

## 16. Open Questions

- None blocking (owner decided ledger technology, date canon, and discovery policy on 2026-07-07). Non-blocking: quickReply clarify buttons are Phase 4 optional pending owner UX taste; reclaim interval/min-idle defaults are env-tunable and may be re-tuned after dev-OA observation.
