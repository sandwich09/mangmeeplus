# Agent Memory: UAT LINE AI multi-round clarify (โต้ตอบไม่ฉลาด ถามหลายรอบ)

Status: Diagnosis complete from code read; no fix applied yet (owner reviewing findings). No AWS creds on this workstation, so UAT log confirmation is pending.
Owner: thawatchai (reporter) / Claude (investigation)
Scope: Why UAT LINE AI feels dumb — multiple Q&A rounds before an expense/receipt gets captured or a question gets answered.

## Decisions

- None yet. This file records the diagnosis for the fix decision.

## Findings (ranked by likely UAT impact)

1. **Pending-media follow-up is a keyword matcher, not the router.**
   `classifyPendingMediaReply` (process-line-webhook.use-case.ts:281) matches substrings
   (ใบเสร็จ/บันทึก/ใช่/บิล/สลิป vs ไม่/ยกเลิก). Free-form answers like "อันนี้ค่ากาแฟเมื่อเช้า"
   → `ambiguous` → pending photo row stays PENDING (TTL 30 min) and the reply is routed as a
   NEW message — the intake router then sees amount+purpose and creates a SEPARATE
   EXPENSE_NOTE_TEXT record while the photo dangles. The code comment itself says "swap for
   the intake router only if free-form replies start slipping through."
2. **One-clarify-per-turn policy serializes missing info.** ask_user "at most once per turn"
   (orchestrator.agent.ts:104, owner decision 2026-07-05); intake router emits ONE
   clarifyQuestion. captureHints.missingFields already lists ALL gaps but the user is asked
   one thing per round.
3. **Fail-closed downgrades create clarify rounds.** Confidence < 0.6 on capture/correction/
   signature → CLARIFY (intent-router.agent.ts:244-266); documentClassification
   .requiresClarification → CLARIFY; uncaptioned image auto-captures ONLY when OCR is strong
   (decideLineBusinessDocument, process-line-webhook.use-case.ts:136-168) else MEDIA_CLARIFY_REPLY round.
4. **Templates tell users to RESEND what the system already has.** CLARIFY_REPLY
   (process-line-webhook.use-case.ts:98) says "ส่งรูปอีกครั้งพร้อมข้อความ…" even though the
   media-clarify path already persisted the bytes; ORDER_OR_CHECK_BILL replies ask for a new
   photo instead of offering "บันทึกเป็นบิลค้างชำระ" as a one-tap continuation.
5. **Conversation memory is small and lossy.** 15 min / 16 turns / 240-char previews
   (PREVIEW_MAX_CHARS, process-line-webhook.use-case.ts:108; loadConversationContext:1337);
   assistant reply preview dropped when viewer permissions don't cover the tools used; media-path
   CLARIFY never enters the ledger (only text-path does). Follow-ups referencing earlier detail
   → model can't see it → re-asks.
6. **Coverage-critic deferral pushes rounds back to the user.** "⏳ ส่วน … ลองถามแยกอีกครั้ง"
   (appendCoverageLines, orchestrator.agent.ts:186) after the 8-tool budget (AI_MAX_TOOL_CALLS).
7. **Double routing.** API-side intake router + gateway-side IntentRouterAgent classify the same
   message with different prompts; each adds its own latency and failure/clarify modes. Turn cost:
   intake route → router → native loop (N) → critic (≤2) → composeAnswer ≈ 5-8 sequential model
   calls per round (all Sonnet via Bedrock global profile in UAT).

Note: UAT flags verified ON (deploy.sh:1175,1296-1299 — orchestration, tool-use loop, ledger; runtime strands-local). Not a flag issue. Model = global.anthropic.claude-sonnet-4-6 unless CompanyAiConfiguration overrides.

## Fix candidates (not yet decided)

- Route pending-media replies through the intake router (kill finding 1) — smallest high-impact fix.
- Batch all missingFields into ONE clarify message (finding 2).
- LINE quickReply chips for media-clarify + one-question clarifies (Phase 4 of item 10F, never built — "owner taste").
- Capture-first: create NEEDS_REVIEW draft immediately with whatever OCR got + ask remaining fields in the same reply (extends existing manual-review path).
- Raise PREVIEW_MAX_CHARS / context window.
- Stop "resend" copy when media is already stored.

## Verification

- Code-read only this turn. To confirm with data, query UAT: AiTurn intent='CLARIFY' ratio,
  LineIntakePendingMedia stuck PENDING/EXPIRED counts, ledger waiting_user re-asks. Workstation
  has no AWS/DB credentials (aws sts → NoCredentials, 2026-08-05).

## Next

- Owner picks fix scope; then spec/plan touch-ups per docs-first rule if the fix changes contracts.
