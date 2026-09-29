# Agent Memory: line-ai-greeting-fallback-2026-09-29

Status: fixed on branch `claude/line-ai-greeting-fallback-20260929` (31607d27 fix, 65a42838 tests, plus the
follow-up that adds this note). 31607d27 is merged to develop (#865) and main (#866). Not deployed by this task.
Owner: controller session (UAT/production release); this task: root cause and fix.
Scope: UAT a521e2c8 LINE AI regressions: "สวัสดีจ้า" got the general fallback, "ของเดือนสิงหาละ" got
"ยังดึงข้อมูลไม่ได้", and several prepared reads failed on AgentCore.

Decisions:
- Owner 2026-09-29: "no more switches; always on". The gateway/AgentCore turn path no longer reads
  TOOLUSE_LOOP, COVERAGE_CRITIC, PREPARED_SIMPLE_READ, DRAFT_EDIT, REIMBURSEMENT_DRAFT_WRITE or
  APPROVED_KNOWLEDGE. Families come from a code constant (APPROVED_PREPARED_FAMILY_KEYS, the 10 approved,
  spec R-L4). ORCHESTRATION now defaults on and is read only by the gateway to pick the legacy deterministic
  path (maintenance serving sets it false). PUBLIC_LOOKUP (privacy/egress gate), DOCUMENT_QA and
  FUSED_PLAN_SHADOW (telemetry) are unchanged. API-side LINE_AI_* switches are out of scope.
- Budget: maxTurnSlots counts non-repair calls, and the one repair per turn rides on top
  (contracts aiBudgetV2CallAllowed/OrdinalCeiling/RepairsBefore; API reservation; gateway admission and guards).
  Spec amended in docs/specs/mangmee-ai-input-provider-budget-contract-2026-09-27.md.
- Router: an empty ADVISOR_CONVERSATION decision expands to one general clause (no repair call).
- Months: spoken/dotted forms resolve in the one period parser. A read whose own requested period nobody said
  asks back (READ_FILTER_NOT_UNDERSTOOD) instead of TOOL_INPUT_NOT_AUTHORIZED + READ_UNAVAILABLE.

Open questions:
- Production a2b926c6 has no v2 semantic path (no compact decode, budget grant v2 or semantic-turn-v2), so
  the slot and decode defects are not live there. Its AgentCore env has the same stale switches, so the
  classic path runs without the native tool loop and with four families until this release ships.
- advisorAnswer is still discarded on the v2 pure-general path (compose re-answers): cost/latency, not a
  dead end.

Artifacts:
- Replica harness (scratch, uncommitted): drives the router, the API lane/narrow rules and the real AgentCore
  runtime entry with real Sonnet 4.6. Results: before 30 calls, after 29 calls, forced repair 1+2 calls,
  knowledge check 4 calls.

Verification:
- Gateway test script 1506/1506. Whole-chain exit 0 (3263 TAP tests). Contracts 339/339. Config 153/153,
  config typecheck and config:validate pass. API typecheck and API test script pass. W00 manifest 4/4,
  pins current, git diff --check clean.
- Not run locally: the new PostgreSQL authority case (Extended Tests `--reliability-postgres`).

Next: controller deploys the merged commits through the UAT/production runbook; run owner acceptance on the
greetings and on "ดูค่าใช้จ่ายเดือนนี้" → "ของเดือนสิงหาละ".
