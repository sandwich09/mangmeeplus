# Plan: LINE expense edit capability consistency

Spec: [capability consistency](../specs/line-ai-expense-edit-capability-consistency-spec-th.md)
Parent: [LINE draft control](../specs/line-ai-draft-control-spec-th.md)

Status: implementation and local verification complete; independent review/UAT remain. SEC-04 confirm/cancel preview binding, post-commit vendor-link parity, scoped API types, and AI Gateway client fixtures are implemented. No UAT deployment.

## Product outcome

Answer a narrow “แก้รายการได้ไหม” question from the current user's eligible LINE expense candidate and `expense.update` permission without writing business or conversation state. Every supported change to an existing LINE expense must produce the existing preview card; only its confirm postback may apply the update. If the API preview lane is disabled, do not fall through to the legacy direct correction writer.

## Architecture and decisions

- Keep identity, legal acceptance, assistant/launch gates, support-pause handling, postback, media, and pending clarification precedence in `ProcessLineWebhookUseCase`.
- Resolve candidates with the shared 24-hour creator/chat/branch/status rule. `expense.update` is the edit permission; candidate access does not depend on receipt-upload permission. Recheck the same source snapshot and current access before delivery.
- Keep the spec's two-runtime capability gate. Add a small authenticated Gateway config probe so the pre-intake read-only answer can verify the serving Gateway/AgentCore S-4 flag without sending the question to a model. API preview handles correction hints (date, vendor, document number, append-note, amount) plus the existing deterministic detector (charge add, line remove/move/amount). The Gateway S-4 tool catalog handles remaining supported line/VAT tools. If either serving flag is off or the probe is unavailable, answer that LINE editing is unavailable and route to web; no business write is permitted in `CorrectLineCapturedExpenseUseCase`.
- Combine multiple header hints in one `expense.draft.set_header` preview. If a turn mixes header and non-header tools, ask for one change at a time; never silently omit a requested field.
- Preserve note append/provenance. A preview must refuse a note that cannot fit completely within the 500-character cap, rather than previewing a value that will be truncated on apply.
- Capability-only answers update only the normal webhook outcome. Do not persist an intake turn, consume clarification, create a draft preview, or emit apply audit. Check API and Gateway feature flags before claiming capability.
- Preserve web reviewer edit access (`expense.review`) in web guidance; only LINE preview requires `expense.update`.
- Reconcile duplicate candidates inside the confirmed apply transaction when a duplicate-sensitive header or amount change is applied. Do not trigger it from the preview rollback.
- Follow the existing writer lock order: acquire the company duplicate-reconciliation advisory lock before the expense update, then reconcile using the same transaction, so apply cannot deadlock with other duplicate-sensitive writers.
- LINE confirmed edits now run eligible vendor-counterparty auto-save only after the expense transaction commits, matching the web save path. Preview/rollback never calls the registry. If the vendor identity changes, the old link is cleared in the main update before the post-commit registry lookup; a follow-up link CAS failure keeps expense success and has separate honest copy.

## Implementation slices

1. Add a narrow pure classifier and deterministic read-only answer for expense-edit capability questions. Gate it on API + authenticated serving-Gateway draft-edit flags, `expense.update`, eligible candidate(s), and no attachment/open clarification/active expense draft/substitute continuation. Handle zero and multiple candidates without choosing a target. Do not persist the question as a conversation turn.
2. Load and delivery-recheck correction candidates for users with `expense.update`, including users whose receipt-capture permission was revoked. Keep the existing provenance and access-fingerprint checks.
3. Convert all supported correction hints (date, vendor, document number, append-note, amount) into existing API `LineDraftUpdateUseCase.preview`; retain the Gateway S-4 tool route for other line/VAT inputs and the deterministic API detector for charge add/remove/move/line amount. Reject mixed requests needing multiple tool types with a clarification. Remove the webhook fallback that applies legacy corrections.
4. Make the legacy correction use case non-writing so another caller cannot bypass the preview boundary. Keep its guidance result contract where needed. Run duplicate candidate reconciliation only during confirmed apply, in the same transaction as the expense update and audit.
5. Correct status/explain copy: `READY_FOR_CONFIRMATION` says not yet confirmed; edit claims require candidate, permission, eligible state, provenance, and API feature flag. An ID-only explain reference never advertises edit capability. Set `editableOverLine` to the actually supported fields; never claim note replacement when notes append.
6. Update focused tests and task memory; no package manifests, schema, dependency, or deploy changes.
7. Carry opaque `previewId` metadata from LINE postback controller through buffer/ledger replay to the draft handler; preserve visible button labels, reject legacy no-ID and typed confirm/cancel without touching the latest preview, and bind both confirm and cancel to exact stored preview.
8. For every confirmed edit with eligible vendor data, call existing `EnsureVendorCounterpartyFromExpenseUseCase` only after the expense transaction commits; preserve uploader/source fields, detach the old counterparty link on vendor rename, apply returned link/entity-kind under the committed revision, preserve expense success if registry autosave/linking fails, update replay revision, and render registry failure separately from link CAS failure.
9. Fix the two scoped counterparty TypeScript contract mismatches without changing response privacy or authorization.
10. Repair the missing Prisma delegates in the existing AI Gateway budget/admission test fixture, keeping its current coverage and adding no runtime changes unless the fixture reveals an actual defect.

## Verification

- Focused API batch (controller, card, buffer, orphan replay, draft security, process webhook, full Gateway client, and counterparty registry/autosave use cases) — run with `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot` over those specs — pass, 561/561 at that checkpoint. The subsequently added cancel permission/revision case was verified in the standalone security suite below, now 17/17.
- SEC-04/vendor service tests — `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts` — pass, 17/17. Covers old confirm/cancel after replacement, two-worker claim/save coordination, permission/revision recheck before cancel, preview rollback without registry writes, post-commit autosave, link-CAS failure honesty, and final replay revision.
- Three-turn process webhook test — `pnpm --filter @watchdog-bms/api exec tsx --test --test-name-pattern='asks read-only, previews a correction without update' src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — pass, 1/1; root independently ran the full webhook suite at 352/352.
- Transport/controller/card/buffer/orphan suite — root independently ran 132/132; line postback id is preserved through accepted payload and replay.
- Full AI Gateway client suite — 35/35; the seven formerly failing budget/admission fixtures now provide the monthly usage delegate and return no prior usage for those cases.
- `pnpm --filter @watchdog-bms/contracts build` — pass.
- `pnpm --filter @watchdog-bms/api typecheck` — pass; the scoped counterparty privacy return type and nullable vendor-link inputs now typecheck.
- `pnpm --filter @watchdog-bms/web typecheck` — pass after rebuilding contracts; counterparty notice tests — 21/21.
- Focused Gateway/AgentCore suites — 230/230; `pnpm --filter @watchdog-bms/ai-gateway typecheck` passes.
- `git diff --check` — pass. No UAT/Production deployment; local code behavior changed. Live three-turn verification remains an owner/runbook step.

## Impact and release notes

- `expense.review`-only users lose the old immediate LINE correction. Web edit permission remains as the continuation path.
- Disabling the API draft-edit flag now disables every edit of an existing expense over LINE; this is the supported rollback behavior.
- A small authenticated capability probe reports the serving Gateway/AgentCore S-4 flag without model routing or per-message probing; call it only for a capability question or a claim-forming explain record. Correction-hint changes are previewed directly by the API, deterministic charge/line edits by the API detector, and remaining line/VAT tools by the Gateway tool catalog.
- Follow-up closes the former vendor-counterparty autosave parity gap and SEC-04 card-binding gap under the constraints above.
- Live UAT still needs the owner three-turn check after all serving config is aligned; this plan does not claim deployment or live resolution.
