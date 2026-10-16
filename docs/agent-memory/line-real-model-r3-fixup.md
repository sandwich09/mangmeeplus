# Agent Memory: LINE real-model Round 3 fix-up

Status: H1–H5 implemented and locally verified within the owner's 60-minute cap. Final API specs 1,061/1,061 and gateway specs 247/247 pass; contracts build and both final typechecks pass. No commit/deploy.
Owner: Codex / owner request 2026-10-15
Scope: evidence-review confirmation, complete expense-action refusals, clean item descriptions, honest draft wording, unavailable-package next steps; exclude lanes 7A/7B and `.live-r3/`.
Decisions:
- Extend the existing signed round-2 card only when the web confirmation validators pass with the proposed evidence review; show vendor/date/total/VAT/document type/files, including the paired payment slip.
- Save the review through `UpdateExpenseDraftUseCase` (`documentReviewAcknowledged`, assessment, expected revision), then confirm through `ConfirmExpenseUseCase` with the saved revision and the same user context. These use-cases own separate transactions; report a saved-review/failed-confirm partial result explicitly.
- Keep all tenant/branch/permission/status/CAS checks; no model final mutation, flags, dependencies, or package.json changes.
- Enumerate source refusals and translate to Thai next steps; use existing chat edits/actions and web-link helper.
- Reuse the value extractor to remove money/date spans from item descriptions, preserve product identifiers, and retain purpose/payee fallback.
Open questions: none.
Artifacts: existing conversation spec/plan and full-capability plan; registered regression specs; final handoff `/private/tmp/fixup-3-last-message.md`.
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: PASS, exit 0 (`/private/tmp/fixup-3-contracts.log`).
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: PASS, exit 0 (`/private/tmp/fixup-3-gateway-typecheck-final.log`).
- `pnpm --filter @watchdog-bms/api typecheck`: PASS, natural exit 0 from final session 2236 (`/private/tmp/fixup-3-api-typecheck-verified.log`). Corrected nullable expense and mixed record-view types found by the earlier run; no errors waived. Earlier stale runs were stopped through their sessions and are not counted as passes.
- API: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/{line-draft-update.security,line-expense-draft-conversation.use-case,expense-draft-vat-decouple.use-case,record-expense-payment.use-case}.spec.ts src/modules/expenses/domain/logic/{line-expense-draft-conversation,line-draft-update}.logic.spec.ts src/modules/line-ai/application/use-cases/{line-intake-dispatch.use-case,process-line-webhook.use-case,process-line-task-resume}.spec.ts`: 1,061 passed, 0 failed, 0 skipped (`/private/tmp/fixup-3-api-final.log`).
- Gateway: `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/agents/{orchestrator.agent,line-ai-feature-coverage,response-composer.agent,orchestrator-model-loop.agent,orchestrator-native-loop.agent}.spec.ts`: 247 passed, 0 failed, 0 skipped (`/private/tmp/fixup-3-gateway-final.log`).
- H1 security specs use the real web update/review and confirmation use-cases, including an already repaired LINE receipt, paired-slip count, exact live refusal text, no-write preview, revoked review/confirm rights, tenant/member/chat/branch/epoch, changed files/facts, signed-assessment tampering, replay and a committed-review/failed-confirm partial result.
- H2 security spec inventories literal BadRequest/Conflict codes from the four action use-cases and their expense repository/funding/void/tax guards; webhook specs prove message buttons on preview and apply refusals. Structured missing fields retain category repair.
- H3 registered conversation/draft-update logic specs use `อินฟลู 500 บาท`, explicit Thai/numeric dates, purpose/payee fallback, A4 and quantity-unit preservation; amounts remain unchanged.
- H4 orchestrator spec uses the exact live `เพิ่งช่วยบันทึกค่าใช้จ่ายอินฟลู 500 บาท ... ไปเมื่อกี้ค่ะ` reply on planner/compose/casual paths; deterministic edit acknowledgements say `แก้ร่างแล้ว:`.
- H5 security spec uses unavailable `มืออาชีพ (PRO)`, nearest sellable package, no LINE purchase modes, and a web billing link; no quote/checkout runs for an unavailable package.
- `git diff --check`: PASS. `.live-r3/` remains untracked; no package.json, flags, final-mutation gates, commits or cloud operations changed. No network/Docker/live verification available.
Next: review/integrate the uncommitted diff; real-model LINE verification requires an environment with network/database access. Final handoff `/private/tmp/fixup-3-last-message.md` is 27 lines; no known code doubts remain.
