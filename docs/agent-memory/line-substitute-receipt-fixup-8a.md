# Agent Memory: LINE substitute receipt fix-up 8A

Status: Complete locally (2026-10-16); gateway listener cancellations reproduced on the original base.
Owner: Codex, lane 8A.
Scope: Legal facts parsing/review, paid expense wording/routing, current-state attachment replies.
Decisions:
- Use existing continuation, value extractors, signed action cards and permission-checked use cases.
- Recognise colon, newline and space-delimited labels; stop free text at the next label or date/method/funding/amount token.
- Company funding does not identify a human certifier. Ask for the unresolved person rather than invent one.
- Render collected facts before preparing/signing; paid replies use persisted payment facts and never offer another payment.
- Empty/conflicting corrections remain unresolved across JSON persistence and resume; old swallowed text must be reviewed again before preparation.
- Attachment caption and pending-media answer paths share the same post-attachment refresh; an offered button replaces the old numbered prompt.
- Keep lane 8B files, package.json, final-mutation gates and .live-r7 unchanged; no commit.
Open questions: None.
Artifacts:
- docs/specs/line-substitute-receipt-assisted-issuance-spec.md (exact live, colon, newline and mixed acceptance inputs).
- Existing continuation, line-draft-update.security, substitute-receipt and process-line-webhook specs; no package script changes.
- /private/tmp/fixup-8a-api-specs.json lists all 10 registered API specs mentioning/importing changed modules. The substitute spec imports/registers the continuation suite too.
- /private/tmp/fixup-8a-gateway-base-comparison.json compares the complete gateway results and every cancelled test name with the original base.
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: PASS.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: PASS.
- `pnpm --filter @watchdog-bms/api typecheck`: PASS on final code, including the old-continuation guard and nullable-method/web-prefill boundary.
- Full contracts test-script list via `pnpm --filter @watchdog-bms/contracts exec node --import tsx --test <every script test file>`: 419 passed, 0 failed/cancelled.
- Full gateway test-script list via `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test <every script test file>`: 1,669 passed, 0 failed, 46 cancelled (exit 1). The AgentCore `before` hook cannot listen on 0.0.0.0 (`listen EPERM`) in this sandbox.
- Ran the identical FULL gateway test list from a `git archive` of original base `4401a09cb41c51e7be23c61868847932acd3aff7` in /private/tmp/fixup-8a-base: identical 1,669 passed, 0 failed, 46 cancelled and identical 49 not-ok names (46 tests + 3 parent suites), with the same listen EPERM. Comparison assertion passed; no baseline assumption.
- All 10 registered importing API specs via `pnpm --filter @watchdog-bms/api exec node --import tsx --test <files in /private/tmp/fixup-8a-api-specs.json>`: 1,606 passed, 0 failed/cancelled.
- Focused continuation/security and webhook/action suites also passed; final importing-suite run includes every added case.
- `git diff --check`: PASS. No live/browser run: sandbox has no network/docker; signed button/card and permission/status integration paths are exercised locally.
- Full script lists were read from unchanged package.json scripts; only the tsx CLI was replaced with `node --import tsx`, as required by the sandbox instructions.
Next: Review/apply the uncommitted diff; report at /private/tmp/fixup-8a-last-message.md. Rerun the 46 gateway listener tests in an environment permitting local sockets.
