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
- New NAT corpus and wire report in progress.

Verification:
- Initial worktree clean at b4afff053f9f0f89662e9e64bedaeaa5fb3772b9; working branch codex/mangmee-natural-real-model-20260927.
- AWS STS confirmed non-root account identity; ListInferenceProfiles returned global.anthropic.claude-sonnet-4-6 ACTIVE. These checks do not prove successful inference.
- Restarted only task-owned local PostgreSQL (15439) and Redis (16389); customer/UAT/Production services unchanged.

Next: Bind NAT, capture actual outgoing wire, freeze code/fixtures, run real provider, review content/facts/effects/timing and record failures without weakening expectations.
