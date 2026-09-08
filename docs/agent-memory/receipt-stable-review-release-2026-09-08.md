# Agent Memory: receipt-stable-review-release-2026-09-08

Status: local corrective implementation and verification complete; preparing PR CI and UAT deployment. Production deployment awaits a new owner approval.
Owner: root
Scope: stable PANDA MALA review form, removal of the redundant missing-data summary, atomic incomplete draft save; UAT redeploy and complete Production config/readiness preparation.
Decisions: keep current Production live/OPEN and unchanged. Do not activate Production email. Existing legal-owner approval is historical evidence; latest owner explicitly holds the new Production deployment until approved.
Open questions: none for implementation or UAT. Production approval pending after reviewable UAT result.
Artifacts: receipt-single-form-preview spec/plan/memory; /tmp/mangmee-release-receipt-stable-20260908/ (sanitized config audit and future exact release ledger).
Verification:
- Prior UAT 34172988969 SUCCESS (candidate bd1ceff8de86a05b59c7046bb248982855001ca2, controller be43fca70870e1ee87685312adbfd1db9cb8da74).
- Prior automatic READY 34174423705 SUCCESS, signed content SHA-256 9692368eb43d6ca701493f8c1e8f402f33d402849a9ed3b4f15a844187367237. Cosign identity and canonical full validator passed. maintenance_closed only; cannot be used for a live deployment.
- Pending migrations: 20260907130000_line_support_request_resolution and 20260907190000_line_signup_recovery_resolution. Both rehearsed on isolated clone, schema/compatibility PASSED; cleanup instanceAbsent/secretDeleted/snapshotDeleted/taskStopped true, residualResourceCount 0. Not applied to Production.
- Production readback at 2026-09-08T01:13:02Z: all three services unchanged (source 604ac785479ced5b9858d0b46d89f8d11cf2b9f6, exact original image/revision/capacity), live, ACTIVE; public customer gate OPEN and login 200.
- All three services passed current config schemas and validateProductionConfig for UAT, current Production and prepared Production (nine checks). Secret values were schema-valid surrogates only, never fetched; this verifies configuration shape, not live secret validity.
- Release maintenance pins: 45 exact files current. Existing production-serving-mode executable contract passed, including enabled/disabled/live/maintenance feature switches and disabled-email behavior. No release script change needed.
Next: finish focused API/web/browser proofs, merge passing exact PR head into develop/main, dispatch one UAT all-target run, verify signed Passport/runtime/customer journey and automatic READY; re-read config after deploy. Present UAT and Production preparation evidence, wait for new Production approval.

## Configuration audit before corrective release

Read all environment entries and secret binding names from the singleton ACTIVE Express configuration for api-web, ai-gateway and workers; do not rely on misleading `describe-services` counts. Secret payloads were not read for this comparison. Read protected GitHub environment/repository variable overrides and the actual workflow/deploy rendering rules.

| Service | UAT env entries | Production env entries | Missing Production keys |
| --- | ---: | ---: | --- |
| api-web | 98 | 94 | Four receipt flags listed below |
| ai-gateway | 54 | 54 | None |
| workers | 16 | 16 | None |

Secret binding names match for every service. Bindings correctly target separate environment resources. This proves configuration presence, not interchangeability of secret values.

| Setting | UAT live | Production now | Prepared next live deploy |
| --- | --- | --- | --- |
| LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED | true | absent | true (protected variable + workflow default) |
| LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED | true | absent | true (protected variable + workflow default) |
| LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED | true | absent | true (workflow/script default) |
| LINE_AI_FLEX_TEXT_FALLBACK_ENABLED | true | absent | true (workflow/script default) |
| LINE_SIGNUP_WARMUP_SLIPS | 15 | 10 | 15 (shared deploy default, no override) |
| LINE_AI_DRAFT_EDIT_ENABLED | true | true | true |
| LINE_SIGNUP_ENABLED / EXTERNAL_SIGNUP_ENABLED | true / true | true / true | true / true |
| LINE_SIGNUP_APPROVAL_MODE / RECEIPT_QUOTA_ENFORCED | AUTO_FREE / true | AUTO_FREE / true | AUTO_FREE / true |
| EMAIL_PROVIDER | ses (existing sandbox) | disabled | disabled, owner deferred activation |
| SES_FROM_ADDRESS | contact@mangmeeplus.com | contact@mangmeeplus.com | valid sender remains set even when provider disabled |
| MODEL_PROVIDER | bedrock | bedrock | bedrock |
| Chat + document model and approved model list | global.anthropic.claude-sonnet-4-6 | same | same |
| LINE_AI_AGENT_RUNTIME | agentcore | agentcore | environment-specific signed AgentCore candidate binding |
| Global maintenance / serving mode | false / live | false / live | live only after explicit Production approval |

AI Gateway/agent registry/orchestration/tool loop/coverage critic, advisor social mode, greeting/loading, fused/prepared read, deterministic response families, 1000 ms debounce, handoff/web login, free AI budget 8000 satang, daily signup cap 20 and business hours are equal. AI final mutation remains false in both environments. No new feature flag is introduced by the form correction.

Expected differences retained: domains/CORS/JWT issuer and audience, internal API/AI URLs, S3 bucket, LINE login/messaging channels and LIFF IDs, Production OA add/QR links, per-environment AgentCore runtime identities and signed source hashes, source/image versions until promotion. SES configuration/event topic are UAT-only because Production email is disabled. Production log KMS and security alert topic remain configured through protected variables; do not copy UAT's weaker infrastructure settings.

The UAT protected variable still says `LINE_AI_AGENT_RUNTIME=strands-local`, but the canonical workflow explicitly binds the signed AgentCore candidate and writes `agentcore`; live readback confirms that effective value. Check effective rendered/runtime config, not variables alone.

Evidence limitation: this is predeployment comparison against the old live Production. New source/image/AgentCore bindings and four added flags must be verified again after any approved live promotion. Passport/READY have a maximum 24-hour life; expired evidence or drift requires the canonical fresh readiness/release path, never a blind promote. Current maintenance READY cannot authorize live mode.

## Corrective verification before merge

- API typecheck and real PostgreSQL source-draft suite passed (13/13); reviewer authority, atomicity, source nulls, explicit values equal to old placeholders, Drtb-shaped financial reconciliation, contradictions and stale writes covered.
- Web typecheck and 1677-test full suite passed before final browser integration. Browser tests already proved PANDA MALA and Drtb-shaped receipts at mobile/desktop widths, originating uploader permissions and filling an unknown quantity with 1.
- Browser integration found an additional no-financial-row boundary: a partial form save omitted financial lines but sent the default VAT source NONE. Existing API correctly rejected it because changing tax source requires financial lines. Fix the outgoing empty-default payload; preserve the tax guard and explicit tax input rather than weakening reconciliation. Re-run the affected browser cases before acceptance.
- Initial browser failures also exposed test locators matching raw label text while inline notes are concatenated. Tests now use semantic textbox/spinbutton roles and accessible names; no product layout change for test selection.

## Owner follow-ups: mandatory fields and optional purpose

Owner asked to verify that complete visible mandatory fields advance via Next, without hidden validation requirements, then clarified the extra purpose field should be optional and explicitly requested API/database coverage. We asked whether this includes category; proceeded with the narrow stated interpretation that businessPurpose is optional and the existing financial category rule remains. Do not invent a purpose or replace the AI category.

Browser acceptance before this follow-up: 9/11 passed, including both no-financial-row receipts progressing through all three steps after visible mandatory inputs, both Drtb-shaped cases, unknown quantity equal to 1 and uploader permissions. Two findings: legacy READY reopened its editable data step before the response and could overwrite rapidly typed input on readback; WHT selector was visible but exposed its selected option as accessible name. Correct the race and label association before release.

API audit identified D-PURPOSE collection as the shared requirement used by source projection/summary and finalization. Normalize old persisted exact-revision continuations as well as new states; verify blank purpose survives API/DB/reload/READY with no purpose blocker.

## Final local browser evidence

- 11/11 Playwright cases passed with real local API/DB/MinIO at mobile390/desktop1280, including blank optional purpose -> all three steps -> reviewer-mark-ready POST200 -> DB READY_FOR_CONFIRMATION. Both no-financial-row source receipts and accepted Drtb/PANDA rows covered.
- WHT conditional selector presence/absence and Next enablement verified in the real browser; its accessible label now matches the visible label. Legacy READY mutation/readback completes before editing to prevent a fast user's input being overwritten.
- Web full suite 1678/1678, focused receipt/source 46/46, web typecheck pass.
- Synthetic, visually reviewed captures: docs/qa/evidence/receipt-stable-review-2026-09-08/. Real Drtb live browser acceptance remains pending: Mac locked and CUA cannot unlock; owner was asked to unlock while code/release preparation continues.

## API/database acceptance and final review

- Focused source/LINE logic and use cases: 37/37 passed. Broader LINE/API suite: 1328 passed, zero failed, two expected PostgreSQL skips (1330 total). Explicit real PostgreSQL source suite: 13/13 passed, including API/use-case -> database -> read projection -> READY -> confirmation with blank purpose and exact-revision legacy D-PURPOSE removal. Existing image/row/category/tax and tenant/revision boundaries retained.
- Central continuation parsing removes the retired D-PURPOSE requirement for both web and direct/resumed LINE readers. GET normalizes the returned AI missing-field summary in memory; it does not write the database. Subsequent saves persist current metadata/summary. The controller calls normalization before assembling the response.
- API typecheck passed with NODE_OPTIONS=--max-old-space-size=8192. Initial default 4 GB attempt exhausted heap; no type error remained.
- Purpose containing the existing internal note delimiter cannot be represented safely. The one validation uses a typed error mapped to Thai that names the purpose field and allows leaving it blank; no technical diagnostic/reload loop. Focused source boundary test 6/6 and shared web error-message tests passed after that envelope change. Normal supplied purpose remains stored and blank purpose is optional.
- Browser final run: 11/11 passed. No release workflow, dependency, database schema/migration or new flag changed in this correction.
- Whitespace diff check passed. No package.json change. UAT read-only preflight passed.
