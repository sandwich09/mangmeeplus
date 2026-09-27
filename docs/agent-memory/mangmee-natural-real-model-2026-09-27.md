# Agent Memory: Natural Thai real-model and outgoing LINE checks

Status: In progress; no quality acceptance claimed.
Owner: Current thread; product owner authorized testing on 2026-09-27.
Scope: NAT-01–12 / 60 natural Thai messages from the human review packet, real configured model, actual compiled API/Gateway/domain tools and isolated synthetic data, outgoing LINE content/cards/buttons/links.

Decisions:
- Owner said “โอเค ตรวแล้วคุณดำเนินการทดสอบต่อได้เลย ถ้าการทดสอบต่อไลน์จริงไม่ได้ ให้ดูถึงแค่ output ที่ออกไปถึง web hook ว่า เนื้อหา card ลิ้งค์ ถูกไหม”. This records review of the presented NAT questions and authorization to proceed. It does not certify model answers, all original 225 cases, receipt labels, or the draft knowledge pack.
- Native LINE delivery may be replaced by an explicit outgoing HTTP sink. Sink acceptance is never native delivery or customer latency evidence.
- Preserve the old corpus and its historical hashes. Bind NAT separately, with source-derived facts and semantic review where exact tool calls are not unique. Missing preconditions remain visible.
- Public lookup, voice, financial profiles and service recommendations remain deferred. No deployment or customer gate changes are part of this test.
- Reuse the committed runtime runner and Ponytail full workflow; no new dependency or package metadata changes.
- Read cloud/deployment runbooks before initial AWS read-only access. Non-root watchdog-bedrock identity confirmed; configured global Sonnet 4.6 profile is ACTIVE. Existing approval record is docs/security-evidence/p1-ai-processor-lawful-basis-register.md, DPO-2026-07-23-bedrock-global. Only synthetic test data goes to the provider.

Open questions: None blocking initial isolated diagnostic run. Knowledge/asset certification and diverse real-shop receipts remain separate acceptance gaps.

Artifacts:
- docs/research/mangmee-ai-human-review-2026-09-27-th.md
- scripts/line-ai-reliability-runtime.ts
- scripts/line-ai-natural-conversation-corpus.ts / .spec.ts: 12 conversations, 60 exact questions, actual synthetic ERP rows.
- scripts/line-ai-natural-wire-report.ts / .spec.ts: offline actual wire/card/action/link review.
- Local raw diagnostic artifacts: /tmp/mangmee-natural-20260927/ (synthetic data only; baseline runs remain separate).

Verification:
- Initial worktree clean at b4afff053f9f0f89662e9e64bedaeaa5fb3772b9; working branch codex/mangmee-natural-real-model-20260927.
- AWS STS confirmed non-root account identity; ListInferenceProfiles returned global.anthropic.claude-sonnet-4-6 ACTIVE. These checks do not prove successful inference.
- Restarted only task-owned local PostgreSQL (15439) and Redis (16389); customer/UAT/Production services unchanged.

Next: Bind NAT, capture actual outgoing wire, freeze code/fixtures, run real provider, review content/facts/effects/timing and record failures without weakening expectations.

## 2026-09-27 real-provider diagnostic baseline

- Fixed test infrastructure before judging the model: corpus categories needed required accountHintKey; isolated reset needed existing launch gate seed; versioned local MinIO serves actual frozen assets. Setup-only attempts made zero provider calls and are not quality samples.
- Baseline at 64bdcba8: NAT-01 five turns, eight actual Bedrock Sonnet 4.6 provider calls, 579 satang settled. All five failed the intended conversation. First outgoing replies took 7.3–16.2 seconds; these are failure replies, not successful-answer latency.
- Raw provider passthrough trace proves the first Thai typo question is understood, but the provider used endUtf16=34 for a 32-unit input. Strict evidence validation correctly rejected it. Candidate supplies an exact server-generated whole-part reference; strict parser stays unchanged.
- Code audit identified the semantic branch spending a control call despite the prepared simple-read plan and two-call envelope. Candidate bridges to the existing guarded deterministic formatter; does not increase grants or execute writes.
- Real baseline final general turn exhausted admission and delivered a misleading credit fallback without closing the webhook event. Candidate records honest terminal failures; does not enlarge deadlines.
- Baseline turn 2 failed before HTTP with LINE_AI_PROVIDER_UNAVAILABLE. Follow-up subject context, filter equivalence, general-lane deadline feasibility, arithmetic and receipt/card paths still require real testing.
- Unit evidence: router 127/127; prepared path 69/69; compatibility 81/81; Gateway noEmit; report 6/6 with strict TS and local visual review. These do not imply model acceptance.

Next: freeze candidate source, rebuild actual API/Gateway, run all 12 natural conversations once, retain every wire response and failure, and separately review facts, effects, cards and routes. Native LINE, customer latency, diverse real receipt labels and statistical acceptance remain unverified.
