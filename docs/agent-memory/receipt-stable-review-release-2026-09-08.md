# Agent Memory: receipt-stable-review-release-2026-09-08

Status: corrective UAT 34181149388 and automatic READY 34182722501 SUCCESS; signatures, runtime/deep-DB/customer-OPEN and clone rehearsal/cleanup all PASS. Production deployment awaits a new owner approval; live browser journey awaits Mac unlock.
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
Next: test Drtb in the logged-in browser after Mac unlock. Wait for new Production approval, then recheck expiry/controller/baseline and issue a live READY with the real owner reference before a live promotion. Main is frozen at dde31797dc67461715fdfaba965a28ac38a0e06b; do not merge the documentation-only checkpoint branch codex/receipt-stable-release-evidence-20260908 during the release hold.

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

## Exact corrective release

- Candidate: 67773ad3244560b606c250e6cdbc65d36acd1bb7. PR #488 -> develop 21b0282777bf8bd0e79f6156fb1b5c287dbebd17 and PR #489 -> main/controller dde31797dc67461715fdfaba965a28ac38a0e06b, both admin merge after full exact-head CI 34180007551 and 34180021014 SUCCESS. All six required jobs actually ran and passed, including Typecheck and Test with pnpm typecheck and pnpm test.
- Candidate is an ancestor of both remote branches. ci.yml/deploy-uat.yml blob parity passed. UAT preflight rerun PASS immediately before dispatch.
- Zero active UAT/READY/Production/recovery runs across queued/in_progress/waiting/requested/pending. The sole historical metadata row 31611733340 was excluded only after fresh verification of unchanged 2026-08-12 timestamp/head and zero jobs/check-runs, per the existing documented provider incident. No cancellation/rerun performed.
- Single UAT all-target dispatch 34181149388 at 2026-09-08T02:45:21Z. Exact candidate/title/controller confirmed. Reused validated PR CI 34180021014; validation skips in the UAT reusable workflow are expected and backed by that full successful exact-head CI.
- Production readback 2026-09-08T02:46:42Z: all three exact prior source/images/revisions/capacity unchanged, ACTIVE/live; public customer OPEN and login200. No Production deployment or gate/email mutation.
- Live browser check remains pending because Mac is locked and CUA automatic unlock failed; owner was asked to unlock. Local real browser/API/PostgreSQL acceptance is complete, but is not represented as a post-deploy live Drtb test.
- UAT 34181149388 SUCCESS. Passport content cc43bc0843f8ea5e79e0a5854f290f0cad7fcea4ebc5b392360a405995f2e569, artifact10039443941, archive SHA-256 63f3c8e1f8621aca8cf15b0a39026f3a4cc68759385ba4524e734a30121e6b1c; signed workflow/controller identity and full canonical validator PASS. Issued1788837153, expiry1788923553.
- Post-deploy config readback 2026-09-08T03:11:38Z: new candidate across all three singleton services; all eight receipt/signup/quota flags true, AUTO_FREE, trial15. Config keys and secret binding names audited again, Production email remains disabled.
- Runtime acceptance 2026-09-08T03:14:06Z: exact signed images/source, ACTIVE singleton and running tasks at capacity1/2; deep readiness API200/dbOK, health/signupHTML/signupJS200, public customer OPEN, login200, unauthenticated me401. Production independent readback03:14:02Z still exact old images/source/revisions/capacity and live/OPEN.
- Automatic READY 34182722501 started03:12:42Z on frozen controller dde31797, workflow_run from this exact UAT. Validation only in maintenance_closed; cannot authorize a live promotion.
- Migration count178, Prisma schema SHA0808c7a1188a56d49381ac28a2c5c4e23d68b723f3262cc027dbab6191e140f2 and repository catalog hash2ff6c2072c34b49218d470a6d246519874601e8a63c92f64339956fcf8ca2535 are unchanged from prior UAT. The signed catalog file hash changes only because sourceCommit binds the new candidate. No schema/migration change in this correction.
- Automatic READY 34182722501 SUCCESS. Signed content ca465f579a7bc20f1a7e6624cb34d22ed0f83fad4204a716e346db4a75699c87, artifact10039888765, archive SHA-256 9260100aaf95ea201fe657906bcc9091393d60e1384b1bc09ab44c5ba0bbc7f9. Cosign workflow/controller identity, canonical full validator and all seven checks PASS.
- Exact two pending migrations (line_support_request_resolution and line_signup_recovery_resolution) executed on the isolated clone; migration/schema/compatibility PASSED. Signed cleanup instanceAbsent/secretDeleted/snapshotDeleted/taskStopped true, residualResourceCount0. Independent RDS readback confirms only the original UAT/Production DBs remain, both available.
- Final Production readback2026-09-08T03:36:27Z: exact original three source/images/revisions/capacity unchanged, ACTIVE/live, customerOPEN/login200. PROD_RUN_ID remains null. No live service, gate, email or customer DB migration changed.
- Passport/READY expiry: 2026-09-09T10:12:33+07:00. The automatic maintenance_closed READY is preparation evidence only; live mode needs fresh owner approval and the dedicated live READY path, plus current expiry/drift checks.
- Portable sanitized ledger: docs/qa/evidence/receipt-stable-review-2026-09-08/release-verification.json. Real browser/API/PG tests are local synthetic evidence; the live Drtb browser flow is still pending because Mac remains locked. Do not claim that journey was completed on the newly deployed UAT.
