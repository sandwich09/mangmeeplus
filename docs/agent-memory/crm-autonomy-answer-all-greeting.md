# Agent Memory: CRM autonomy — deterministic greeting + AI-answers-all

Status: DEPLOYED to prod ECS 2026-07-14 (all 3 services rolloutState=COMPLETED, /v1/health 200)
Deferred (YAGNI): log reply.confidence on successful sends as telemetry — add when a
labeled-outcome calibration pipeline exists (skip() already logs confidence on denials).
Owner: develop
Scope: apps/api crm-inbox (auto-reply logic + use-case + process-inbound), apps/ai-gateway crm-customer-reply parser, apps/api crm booking-proposal cancel logic, spec §27/§28

## Problem (live prod root cause, refined)
Customer OA auto-reply never actually answers questions. `crm-intake` returns a
self-reported `confidence` (haiku-4-5); real questions score < `CRM_AI_MIN_CONFIDENCE`
(0.7) → gate A skips `low_confidence`. Greetings classify as non-QUESTION →
`not_actionable`. Both reasons are NOT in `HOLDING_MESSAGE_BLOCKED_REASONS`, so the
customer gets the generic holding "เจ้าหน้าที่จะรีบติดต่อกลับ" (or it dedups) — never an AI answer.

## Owner requirement
"AI ควรตอบลูกค้าได้หมด ส่วนที่เป็น greeting ให้ใช้ determinating" — AI answers ALL legitimate
customer messages; greeting uses a deterministic (rule-based, no confidence) reply.
Owner decision on sensitive turns: follow codex — COMPLAINT/NEEDS_HUMAN → deterministic
ack + handoff; SPAM → silent; everything else → AI answers.

## Design (codex-approved, refined)
- Standalone greeting → pure API rule `matchStandaloneGreeting` (whole-message grammar,
  not includes). Deterministic reply, zero gateway call. authorType=SYSTEM, aiDraftUsed=false,
  but consumes cap + counts as a response (reply-source discriminator AI|DETERMINISTIC|HOLDING).
- Confidence gate A → special-routing gate (not reply/no-reply). High confidence permits
  booking/complaint/needs-human/spam special handling; low confidence falls through to
  ordinary AI reply (never booking extraction). Booking-extract threshold unchanged.
- Gate B (reply confidence) removed for low-risk replies — AFTER tightening the gateway
  parser to require explicit finite confidence + explicit boolean needsHuman.
- Fix false-CANCEL: bare `ไม่`/`no` embedded in a substantive sentence must be UNCLEAR,
  not CANCEL (was cancelling live booking proposals).
- Greeting decision stays INSIDE evaluate(), after cap/consent, before intake — proposal-first
  ordering (tryResolveBookingProposal) preserved.

## Decisions
- No model GREETING class, no new contract/endpoint/schema/dependency, no lowered prod env.
- turnClass label 'GREETING' used only on the API decision for audit/attribution.

## Open questions
- (resolved) sensitive turns → codex option A.

## Verification
- crm-auto-reply.logic.spec.ts: greeting grammar (match/no-match table from codex).
- crm-booking-proposal.logic.spec.ts: embedded-negative → UNCLEAR.
- crm-customer-reply.agent parser: missing confidence/needsHuman → uncertain.
- typecheck + targeted tsx --test.

## Next
Implement edits, run targeted tests, register new specs in apps/api test list, deploy.
