# Agent Memory: mangmee-advisor-r5a-tax-documents

Status: implementation and focused/full requested specs complete, 2026-10-15; API typecheck remains incomplete at the 60-minute task limit. No commit/deploy.
Owner: Codex, round 5 lane A.
Scope: READ/EXPLAIN only: voucher list/detail, sold-pack WHT month summary and catalog-based calculation, pinned draft help cards. No actions, confirm cards, PND3 changes, package.json or mutation gates.
Decisions:
- Reuse DisbursementVoucherUseCase.list/get with verified delegated web-user context and existing expense scope. Export the existing use-case; keep its LINE session write restriction.
- Add wht.get_month_summary rather than open tax.get_wht_summary: old tax.* tools require unsold tax permissions and include other forms. Read sold PND53 events with wht.pnd53.read and certificates through the existing handoff read boundary with wht.certificate.read; branch-filter aggregates.
- Use the existing ACTIVE income catalog and expense money rounding. Require an explicitly named catalog category; never infer its rate from a generic service/payment description. Ask with catalog buttons otherwise.
- New product-help cards require owner review: the historical AI-only approval covers the original 12 cards only. Prepare a DRAFT pack with source/body hashes; retain approved runtime pack and effective/review window.
Open questions: owner review of new draft help cards; real model/LINE evaluation outside this offline sandbox.
Artifacts: docs/plans/mangmee-advisor-full-capability-plan-th.md; /private/tmp/round-5-lane-a-last-message.md.
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: exit 0.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: exit 0 (latest run after gateway code changes).
- API package typecheck script was run; the latest attempt did not finish before the overall 60-minute task limit and was interrupted by its exact exec session (no pattern/process-wide stop). No compiler errors were emitted before interruption; this is NOT a passing typecheck. Re-run `pnpm --filter @watchdog-bms/api typecheck` on the final diff. Log `/private/tmp/r5a-api-typecheck-latest.log`.
- Registered API specs via `pnpm --filter @watchdog-bms/api exec node --import tsx --test`: `src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts`, `.../process-line-webhook.use-case.spec.ts`, `src/modules/line-ai/application/line-intake-dispatch.spec.ts`: 477 passed, 0 failed. ERP tax re-run after final source changes: 24 passed, 0 failed.
- Registered API source/guard regressions (ERP tax, internal-tools controller, generate-tax-filing-package, wht-certificate-handoff): 160 passed, 0 failed. Source fixture asserts current company, own and branch scope, denied/missing reads, all pages, cancelled/prior-month exclusion, exact money, scoped ACTIVE PND53 events and configured due date; separate permission paths do not read another source.
- Registered gateway specs via `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test`: `src/modules/line-ai/agents/orchestrator.agent.spec.ts`, `line-ai-feature-coverage.spec.ts`, `agent-tools.registry.spec.ts`, `tool-availability.spec.ts`: 208 passed, 0 failed. All newly added tests reside in registered specs; no package.json edits.
- `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts`: regenerated W00; 5 passed, 0 failed.
- `git diff --check`: clean. No network/docker/model/browser/live LINE/deployment was used.
Integration evidence:
- Voucher reads call the web use-case, carry verified delegated identity/permissions/scopes, strip bank/account/audit/action controls, and retain only IDs/labels/dates in follow-up understanding memory.
- WHT replaces the sold read path with a new tool: old tax.* entitlement and VAT/CIT remain unchanged. Starter WHT read/help gets the fixed Thai Business-package answer even when source permissions were stripped.
- WHT certificates (system or external) and payment bases are separate from synced PND53 remittance; missing period returns null with an explanation, never a fabricated deadline or zero remittance. Shared paper-deadline helper preserves the pre-existing filing artifact rule; configured extensions win.
- Calculations resolve exactly one explicitly named ACTIVE catalog entry (or an explicitly chosen matching code), never infer from ค่าจ้าง, and reuse calcLineTotals rounding; verified inputEvidence takes precedence on semantic v2. Amount is an explicitly conditional pre-VAT base. Unknown type returns catalog buttons; API read-proof storage binds buttons to company/user/member/chat/request and delivery replays current reads. Only accepted category name/base is retained for re-verification, not original chat text.
- Four proposed help cards pin source SHA-256 plus body/access hashes; test-only review fixtures prove filters. Production remains APPROVED v3 / 12 cards; DRAFT v4 / 16 cards is not offered until owner review. Effective/review deadline remains 2026-12-27.
Next: run the API package typecheck to completion on the final diff; owner reviews four DRAFT cards and performs real-model/LINE acceptance before any release. The 29-line handoff is `/private/tmp/round-5-lane-a-last-message.md`.
