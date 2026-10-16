# Agent Memory: mangmee-advisor-r7b-team-branches

Status: code and registered-spec verification complete; API typecheck completion inconclusive at the 60-minute task limit (2026-10-15). Diff uncommitted.
Owner: Round 7 lane B
Scope: LINE role/permission reads, employee create/update/status and branch create/update through human confirmation; no counterparties or quoted replies.
Decisions:
- Reuse the signed private-chat confirm-card delivery and preview store; add a company preview tool and a business adapter calling the web use-cases with fresh caller context at press time.
- Match names uniquely inside the caller's company/scope; ambiguous names require clarification. Bind cards to company/user/membership/chat/conversation epoch/payload/source state/expiry and reserve each press atomically.
- Employee creation follows the actual web DTO (username, display name, birth date, identity type/number, phone, one role), then branch assignment, completeDraft and LINE link issuance, as the web wizard does. No invented identity or date; optional email remains optional.
- Branch code/type are creation-only in the existing web use-case; updates support name/address and refuse attempts to change immutable fields.
- Reuse plan-term limit guards and existing package purchase trigger; never change gateway final-mutation policy or add flags.
Open questions: none; web validation and use-case guards remain authoritative.
Artifacts: docs/plans/mangmee-advisor-full-capability-plan-th.md; line-team-action.service.ts; erp-team-tools.use-case.ts; W00 manifest; /private/tmp/round-7-lane-b-last-message.md.
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: PASS (latest log /tmp/r7b-contracts-build.log).
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: PASS (/tmp/r7b-gateway-typecheck-final.log).
- API registered specs: line-draft-update.security, erp-business-tools, full line-intake-dispatch and process-line-webhook, create-employee, employee-lifecycle, update-employee-branch-scope, create-branch, update-branch: 1,143 passed, 0 failed (/tmp/r7b-api-final.log).
- Gateway registered orchestrator.agent + line-ai-feature-coverage: 108 passed, 0 failed (/tmp/r7b-gateway-final.log).
- Final required API regression after the scoped context-forwarding cleanup: 1,009 passed, 0 failed (/tmp/r7b-required-final.log).
- W00 regenerated and verified: 5 passed, 0 failed (/tmp/r7b-w00-current.log).
- All spec runs used `pnpm --filter <pkg> exec node --import tsx --test <files>`; no tsx CLI, network or Docker.
- Focused boundary evidence: all six actions preview/apply/replay/stale/binding; concurrent claims; cancellation; real self-role/last-owner/enable-capacity guards; partial employee provisioning resume; missing-field continuation; immutable branch fields; caller scope narrowing.
- Initial test defects were corrected: reimbursement rights intentionally survive feature disable as on the web; webhook harness stores complete message batches separately from the first-message shortcut.
- Earlier round-5 memories also document full API/Prisma structural-comparison stalls; no current-run diagnosis or passing API result is inferred from them.
- API typecheck initial runs found DTO typing/import errors, all corrected; final package-script run emitted no errors for over 25 minutes. At 14:52:14 UTC a Ctrl-C was sent to its exact exec session 19192 to stay within the overall 60-minute cap; that call returned exit 0 without compiler output. Completion vs. interruption is ambiguous, so this is NOT counted as a verified API typecheck pass. Re-run `pnpm --filter @watchdog-bms/api typecheck` on the final diff; log /tmp/r7b-api-typecheck-final.log. No pattern/process-wide stop was used.
- `git diff --check`: PASS. No package.json, dependency, feature-flag or final-mutation-policy edits.
- Sandbox has no database/LINE/browser/live-model access; no E2E or deployment claimed.

Limits:
- Code/type of an existing branch are immutable in the web use-case; LINE says so in Thai.
- Employee creation has the same staged provisioning as the web wizard; a partial failure retains its created employee id in the existing TTL store so the same card resumes remaining steps. A hard crash before that progress is retained has the existing web identity/username conflict guards as its backstop.
- Source snapshots are checked at preview delivery and press; existing employee/branch use-cases do not accept a source revision CAS, so this lane does not add a new transactional revision protocol.
- Forwardable LINE link and expiry use the web link issuer with the configured API origin plus /v1; the QR data URL and temporary password are never printed in chat.
Next: re-run the API package typecheck before integration; review the uncommitted diff and run real LINE acceptance in an environment with database/provider access. Handoff: /private/tmp/round-7-lane-b-last-message.md (27 lines).
