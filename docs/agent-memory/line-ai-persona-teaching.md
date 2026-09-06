# Agent Memory: line-ai-persona-teaching

Status: In progress 2026-09-06 — docs updated, code + specs on branch `codex/line-ai-persona-teaching` (cut from `origin/develop` f2bd38ed). Not merged, not deployed.
Owner: thawatchai
Scope: Wave-3 fix from UAT 2026-09-06 (build f2bd38ed, brand-new auto-approved company, OWNER, Thai). Two turns:
  (1) `คุณเป็นใคร` → the intake router's advisor draft was delivered verbatim: `สวัสดีครับ! หนูคือ AI Assistant ของ MangmeePlus 🤖 … มีอะไรให้ช่วยไหมครับ?` (male ครับ, wrong self-name, หนู/ครับ mix). Owner: "จริงต้องเป็น persona ผู้หญิงนะ".
  (2) `สอนฉันใช้งานเบื้องต้นแบบง่ายง่ายแบบมนุษย์แม่ป้าเข้าใจได้` → router wrote a long tutorial that did not parse (`ROUTER_JSON_PARSE_FAILED`, stopReason not max_tokens) → fallback `capability_help` → the fixed capability list. Owner: "ควรสอนการใช้งาน user ได้ตามฟีเจอร์ที่เปิดอยู่ และตามขอบเขตของผู้ถาม".
  `LINE_AI_ADVISOR_MODE` defaults to `social` in `infra/prod-ecs-express/deploy.sh` for BOTH uat and production, so (1) is live in production too.
Decisions:
- Root cause of (1): `ADVISOR_ANSWER_SECTION` (`intent-router.agent.ts`) never stated the persona and the surrounding prompt introduces the model as "the LINE Intake Router Agent for MangmeePlus"; the persona lived only in `RESPONSE_COMPOSER_SYSTEM_PROMPT`, which the direct-answer shortcut bypasses. Fix: ONE shared constant `MANGMEE_PERSONA_LINES` (`apps/ai-gateway/src/modules/line-ai/agents/mangmee-persona.ts`, precedent: `mangmee-joke-bank.ts`) used by both prompts; appended ONLY inside the advisor section so the default intake prompt stays byte-identical (existing byte-exact legacy test kept green).
- Prompt rules added to the advisor section: identity question answered in persona; a teaching/how-to request is NEVER `ADVISOR_CONVERSATION` (→ `UNSUPPORTED`, zero-tool `capability_help` preparedPlan under fusedPlan); `answerText` 1–3 sentences, never a list/steps/tutorial.
- Prompt wording is not a trust boundary, so the API's `advisorDirectAnswerText` gains a deterministic persona veto (male particle ครับ, own-pronoun ผม via `^ผม` / `\sผม(ชื่อ|คือ|เป็น|…)`, wrong self-name, and list/steps shape). Fail-closed to the full composer turn (which carries the persona); never repairs text. User-quoted `«ผม…»` does not veto.
- Teaching mode: deterministic `isTeachingRequest(messageText)` (literal Thai+English trigger list, NFC, whole message contains) selects a numbered beginner walkthrough in `composeCapabilityHelp`, built ONLY from the same `usableCapabilityGroupIds` + `canAdvertiseReceiptCapture` + a registry-derived role line (`reimbursement.list_pending_approvals` usable ⇒ one approvals line). Reuses the §8 example questions; ends with the existing closing sentence; mentions the `เมนูหลัก` tile once; ≤ 15 lines with everything on. Zero groups → existing `none` copy. Copy stays in the gateway (spec §6 "copy lives in the gateway").
- Orchestrator-side `INTENT_ROUTER_SYSTEM_PROMPT` capability_help description lists the teaching phrasings so the fallback classifier routes them to `capability_help`, not `casual_conversation`.
- API follow-up parity: `LINE_CAPABILITY_REPLY_PREFIXES` in `packages/contracts/src/ai-tools.ts` replaces the two hard-coded intro literals in `isDeliveredCapabilityFollowUp`; a gateway spec pins that every capability reply variant (card + walkthrough, th + en) starts with one of them, so "ยังไง" after the walkthrough still gets the how-to-ask examples.
- Observability: `routeIntake` now warns once on an unparseable router answer with `errorCode`, `stopReason`, `outputChars` and a whitespace-collapsed 160-char preview of the MODEL output only (never messageText or payload fields). `extractJson` escapes raw control characters inside JSON string literals before `JSON.parse` (bounded, deterministic; valid JSON is untouched by construction; plain prose still fails).
- No new env flags, no `deploy.sh` change, no `package.json` change (new api cases live in existing spec files because the api `test` script is a fixed file list).
Open questions:
- None blocking. Whether "หนู" as a self-pronoun should also be vetoed was left out on purpose (not male, not a wrong name); revisit if the Owner objects to หนู.
Artifacts:
- Specs: `docs/specs/line-ai-mangmee-advisor-conversation-spec.md` (§1 status line, §8.1, §9.2), `docs/specs/line-ai-capability-help-entitlement-spec.md` (§8.1 Teaching mode, AC-13..AC-15), `docs/specs/line-ai-assistant-ux-spec.md` (business rule + acceptance bullet).
- Gateway: `agents/mangmee-persona.ts` (new), `agents/intent-router.agent.ts`, `agents/response-composer.agent.ts`, `common/ai/extract-json.ts` + specs.
- Contracts: `packages/contracts/src/ai-tools.ts` (`LINE_CAPABILITY_REPLY_PREFIXES`).
- API: `domain/logic/line-advisor-direct-answer.logic.ts` (+spec), `domain/logic/line-ai-capability-follow-up.logic.ts`, `application/use-cases/process-line-webhook.use-case.ts` (intake AiTurn row records modelId/durationMs from the route's `usage`), `line-intake-dispatch.use-case.spec.ts`.
Verification:
- Recorded in the final handoff (typecheck ×2, gateway test suite, touched api specs, DI guard, spec-suite coverage) — see the branch report.
Next:
- Owner review → PR → UAT deploy with the same candidate → re-run the two UAT turns (`คุณเป็นใคร`, `สอนฉันใช้งานเบื้องต้น…`) and confirm persona + walkthrough → production promotion.
