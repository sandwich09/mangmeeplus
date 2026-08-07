# Agent Memory: line-ai-voice-messages

Status: Spec + plan authored (2026-07-30); no code yet. Phase 0a (un-ghost) is the next executable step.
Owner: thawtchai (product decisions: STT vendor pin, PDPA register row, prod flag-on)
Scope: Employee OA voice-note intake → server STT → existing buffered text pipeline. CRM customer OA explicitly out (owner decision 2026-07-06 stands). No TTS, no audio persistence, no biometrics.

Decisions:
- Voice notes become text buffer items at dispatch time (substitution BEFORE `segmentBatch`), so every buffering-spec semantic (joins, captions, ordering, orphan recovery, push fallback) is inherited unchanged.
- STT runs in the AI Gateway behind `assertApproved` provider/model/region governance (new `/internal/ai/line-stt`), NOT in the API — mirrors receipt OCR's vendor hop; audio ships base64 over the internal hop like OCR images.
- Silence is banned in every configuration: flag off / vendor down / too long all produce fixed Thai replies (spec §10).
- Echo-back prefix (🎙️ ได้ยินว่า …) always on by default — the trust + provenance mechanism; mutations additionally ride the unchanged confirm gates (double provenance, spec §11).
- Metering without migration: `AiUsageEntry.durationMs` (already exists) + per-minute price branch in `computeCostSatang`; `sourceRoute 'line-stt'`; new `stt` rate bucket; monthly satang cap covers it automatically.
- Default vendor NOT pinned yet — Phase 0b probe over real employee clips decides among typhoon / openai-whisper / aws-transcribe (selection rule spec §9: quality on Thai+code-switch+amounts first, then residency, latency, price).

Open questions:
- Does the Typhoon (SCB10X) API expose ASR today, and at what price? (Blocks the probe matrix; existing vendor + ap-southeast-1 region make it the residency favorite.)
- Transcribe th-TH streaming availability + real batch latency from ap-southeast-1 (batch startup may blow the 25 s shutdown-drain bound; spec §14).
- If OpenAI wins: owner decision to approve US processing region for voice + provision `OPENAI_API_KEY` in prod task def.
- Consented clip collection from the pilot group (owner to arrange) — needed before any probe runs.

Artifacts:
- Spec: `docs/specs/line-ai-voice-message-spec.md`
- Plan: `docs/plans/line-ai-voice-message-plan.md`
- Discovery findings (2026-07-30 field test) recorded in spec §2; typo/code-switch baseline eval is plan Phase 0b, separate from the voice build.
- Current-state anchors: silent drop at `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` (text/image/file only); CRM voice-to-text-first comment at `crm-inbox.logic.ts` `isUnsupportedLineMedia`.

Verification: none run yet (docs-only change). Phase 0a exit = registered unit tests + one manual voice note getting the decline reply on local.

Next: (1) owner reviews spec §9 candidates + arranges consented clips; (2) implement Phase 0a; (3) run Phase 0b probe and pin `STT_PROVIDER`.
