# Agent Memory: mangmee-advisor-r7a-counterparties-quotes

Status: implemented and verified locally; no commit or deploy
Owner: Codex, round 7 lane A
Scope: Accounting counterparty reads/create-update confirmation; LINE quoted-message grounding. Employee/branch implementation untouched.
Decisions:
- Owner rule and full-capability plan: direct reads; final writes only after a signed human button press. No new flag/dependency/schema/package.json changes; final-mutation gates unchanged.
- Counterparties use the web List/Get/Create/Update use-cases. Effective accounting permissions and the existing originator/receipt-uploader relation apply. Entitlement is expenses OR sales_documents, independent of procurement. Registry rows are company-wide; branchCode is the payee tax branch, not an ABAC branchId.
- Preview signs exact patch, displayed diff, tenant/user/membership/private chat/conversation epoch/revision/expiry. Apply rechecks web authorization and features, uses expectedUpdatedAt CAS, and shares the existing claim/replay store for double presses.
- Thai numeric tax IDs require 13 digits; the existing thaiTaxIdChecksumValid produces a warning, consistent with its existing warning-only contract. Foreign IDs retain the web's 32-character rule. Address/entity/branch fields retain web bounds and normalization. No bank/payout fields exist on the web counterparty record.
- LINE's accepted sentMessages IDs are retained in existing delivery batch states or outcome authorization JSON, with typed record IDs only. No additional copied text or quote token. Existing purge/retention and context-window query apply. Per-message item/control associations resolve mixed deliveries.
- Quote lookup binds company/user/membership/chat/channel/recipient/current access fingerprint and conversation epoch when present. Unaccepted, unknown or foreign messages provide no references. The chosen IDs enter recentReads/quotedRecords and narrow active draft routing; tools still recheck live source access/state.
- Existing capture name/tax matching and draft business rules remain unchanged. Expense detail exposes its existing vendorCounterpartyId so the assistant can read missing payee identity and offer the new confirmation card for a later 50 ทวิ.
Open questions: none. Live LINE UAT unavailable in this sandbox. Two existing adapter HTTP-server tests cannot bind 127.0.0.1 (EPERM).
Artifacts: docs/plans/mangmee-advisor-full-capability-plan-th.md; docs/research/mangmee-ai-capability-manifest-2026-09-27.json; last-message.md
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: passed.
- `pnpm --filter @watchdog-bms/api typecheck`: passed (package script; exit 0).
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: passed (exit 0).
- `pnpm --filter @watchdog-bms/api exec node --import tsx --test` with registered specs: line-intake-dispatch.use-case, process-line-webhook.use-case, auth/line-webhook.controller, line-draft-update.security, erp-procurement-ledger-tools.use-case, erp-core-detail-tools.use-case, line-delivery-plan.logic, internal-tools.controller, line-read-evidence, line-message-buffer.service, line-message-buffer.logic: 1,185 passed, 0 failed. Log: /private/tmp/r7a-final-api-specs.log.
- Gateway registered orchestrator.agent + line-ai-feature-coverage: 108 passed, 0 failed. Log: /private/tmp/r7a-final-gateway-specs.log.
- Existing ensure-vendor-counterparty-from-expense + expense-vendor-counterparty-autosave: 40 passed, 0 failed. Log: /private/tmp/r7a-capture-matching.log.
- Adapter `--test-name-pattern='Round 7A'`: 1 passed. Full adapter attempt was blocked only in two pre-existing local HTTP-server tests (EPERM); log /private/tmp/r7a-focused-initial.log.
- Final focused erp-procurement-ledger-tools (including preview signature/display binding): 16 passed, 0 failed. Log: /private/tmp/r7a-counterparty-last.log.
- `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts`: regenerated W00, 5 passed, 0 failed. Log: /private/tmp/r7a-manifest-last.log.
- `git diff --check`: passed. No package.json, employee or branch implementation diff.
Next: Review the uncommitted diff. Live LINE/device acceptance and the two HTTP-server adapter tests require an environment allowing network/port binding.
