# Agent Memory: LINE exam A language

Status: Previously listed legacy branches finished and verified; additional employee/branch wizard language gap remains. Final API typecheck and complete test list finished.
Owner: Exam lane A
Scope: Current-message language across gateway composition, deterministic LINE copy, cards, controls, continuations and delivery fallbacks; actions and limits policy stay with lanes B/C.
Decisions:
- English input receives polite English; any Thai input, including mixed input, receives Thai with the feminine persona.
- Current language overrides account locale and saved response style. Neutral control/continuation data inherits the conversation language.
- Pass presentation language through existing builders and validated postback metadata; preserve tenant, branch, permission, revision, final-button and budget boundaries.
- Independent exam evidence identifies behavior classes; do not match its sentences.
Open questions: None.
Artifacts: `.live/exam/` is local evidence only; `.live/last-message.md` is the final report; `.live/exam-a-files.txt` lists changed files.
Root cause:
- API reliability context defaulted responsePreferences.language to Thai; semantic composition preferred it over correctly detected English.
- Persona sanitization translated English terms into Thai; fixed templates, API-built cards, synthetic controls and async notifications lost language.
Implementation:
- Contracts/runtime/request/scope/composer preserve current language; persona sanitization respects English.
- Existing API builders localize confirmation titles, fields, buttons, quick replies, help/menu/policy, capture/claim/voucher, refusals, waits and errors.
- Continuation and media language reaches package-purchase exceptions, substitute-receipt blocked/target/field/scan flows, expense evidence/repair actions, file attempts, receipt status and correction guidance.
- Company navigation uses validated language metadata and the existing membership-checked commands. Capture, buffer, recovery and orphan notifications preserve language.
- Canonical correction/source snapshots stay unchanged; only their display labels are localized. Draft route-context builders accept language, with canonical source proofs retaining their existing default.
Verification:
- Delivery table: 73 surfaces × {th,en,mixed}, real durable delivery-plan builder and actual LINE adapter, primary/fallback payloads.
- Package service legacy exceptions: selection, availability, busy, existing payment and permission cases × three language forms.
- Substitute continuation spec: 250 passed, including language matrix and English field acceptance without asking again.
- Six offline exam replays: C016-A, C021-A, O002-A, H031-A, H047-A, H050-A; language-sensitive provider doubles, not live-provider evaluations.
- Contracts build and complete test list passed: 450 tests. Gateway typecheck passed; complete list: 2,034 passed, 46 cancelled by socket EPERM.
- Final exact `pnpm --filter @watchdog-bms/api typecheck` completed successfully with no tests running alongside it; log: /private/tmp/exam-a-api-typecheck-verified-final.log.
- Final focused delivery/manifest/intake dispatch run: 400 passed; final vocabulary/matrix/manifest rerun: 35 passed. Real-module DI passed in the complete final API run.
- Complete final API script list (511 files) through node --import tsx: 12,138 tests; 11,938 passed, 198 skipped, 2 failed, no cancellations. Both failures are HTTP adapter listen EPERM at 127.0.0.1, reproduced on base. Log: /private/tmp/exam-a-api-full-verified-final.log.
- Supplemental whole-chain through node --import tsx: 9/10 suites passed; API behavior 2,368 passed, API reliability 468 passed, gateway behavior 899 passed. Only runtime socket suite fails (12 failures, 46 cancellations), matching base. Log: /private/tmp/exam-a-whole-chain-import-verified-final.log.
- Exact whole-chain command reaches tsx pipe `listen EPERM`; same suite/error reproduced on base cd6f32f39.
- Socket baseline evidence remains in /private/tmp/exam-a-{adapter,runtime,minimal-runtime,whole-chain}-base.log; API HTTP adapter: 15 passed/2 EPERM failures; gateway runtime: 46 cancellations; minimal runtime: 1 passed/12 EPERM failures.
Remaining Thai content:
- Customer/source names, descriptions, evidence and configured category names remain verbatim; they are business data.
- The existing Thai promotion PNG is omitted from English delivery, which receives English promotion text and controls.
- Additional gap found during final audit: `line-team-action.service.ts` employee/branch wizard follow-up questions, refusal/expiry replies and dynamic detail labels are still Thai. Its model tool preview, pending-input store and confirmation apply do not yet receive presentation language. English confirmation action/status vocabulary is localized, but the entire wizard is not. This is outside the previously listed legacy branches; report it as unfinished rather than hiding the data or weakening guards.
- A live provider/exam rerun and LINE-client visual QA are unavailable in this sandbox.
Exam notes:
- C016-A/C021-A/H039-A literal-Flex complaints concern harness serialization; traces contain structured Flex. Their language failures are valid.
- X067-A db_new_voucher expects a save before the user's final button; preserve prepare-before-confirm behavior.
Next: Finish the employee/branch wizard language seam, add real delivered-payload coverage for its ask-backs/refusals/dynamic details and rerun affected/full verification. The current diff is left uncommitted. No package.json, dependency, feature-flag, AI budget-contract or final-mutation-gate changes.
