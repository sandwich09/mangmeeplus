# Agent Memory: Vendor bill second-approval notification (H-07 follow-up)

Status: DONE (implementation + unit + live DB query check, 2026-07-18)
Owner: Claude (session 2026-07-18)
Scope: `apps/api/src/modules/procurement/application/use-cases/vendor-bill.use-case.ts` (event payload), `apps/api/src/modules/workflow/**` (catalog template, action runner, repository), specs, `docs/specs/workflow-automation-spec.md` §18

## Decisions

- **Consume `vendor_bill.approval_recorded` through the existing workflow machinery**, not a bespoke direct-notify path: new catalog template `vendor_bill_second_approval` (EVENT, default trigger `{ eventType: 'vendor_bill.approval_recorded' }`, disabled by default like every template — admin enables from web; enable flow applies the default trigger via `WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG`).
- **Recipient = permission holders, not roles**: new generic SEND_NOTIFICATION config keys in the action runner —
  - `recipientPermissions: string[]` → `PrismaWorkflowRepository.findUserIdsByPermissions` (ACTIVE memberships whose roles carry the permission; mirrors `findUserIdsByRoles` and permission-resolver semantics, verified live vs include-based ground truth on :15432 DB).
  - `excludeRecipientPayloadKeys: string[]` → payload fields (string or string[]) holding user ids that must never receive the notification; applied to the whole recipient union.
  - Template config: `recipientPermissions: ['procurement.vendor_bill.approve']`, `excludeRecipientPayloadKeys: ['submitterUserId', 'approverUserIds']`.
- **Event payload enriched at the emit site** (ApproveVendorBillUseCase partial-approval branch): `billId`, `vendorBillNumber`, `grandTotalAmount`, `submitterUserId`, `approverUserIds` (recorded approvers incl. current), plus existing `status`/`recordedApprovers`/`requiredApprovers`. Workflow run payload = event `data` + `eventType` only, so exclusion ids must live in `data`.
- **Latent bug fixed in passing**: `vendor_bill.submitted` data had no `billId`, so sibling template `vendor_bill_pending_approval`'s default condition `billId EXISTS` could never match → added `billId` + `vendorBillNumber` to that event. Same bug exists for `reimbursement_pending_approval` (`requestId EXISTS` vs data without requestId) — spawned as separate task, NOT fixed here.
- **No eligible second approver left after exclusion** → existing no-recipients path: RetryableActionError → bounded retries → DEAD_LETTERED + HIGH audit. Deliberate: that state means the bill genuinely cannot get its second approval; dead letter is the alarm.
- Notification module untouched (no trigger-key allowlist in `CreateOrUpdateNotificationEventUseCase`; `workflow.vendor_bill_second_approval` trigger key works as-is).

## Artifacts

- `workflow-template-catalog.ts` — template + default trigger config entry
- `workflow-action-runner.use-case.ts` — `recipientPermissions` + `excludeRecipientPayloadKeys` in `sendNotification`
- `prisma-workflow.repository.ts` — `findUserIdsByPermissions`
- `vendor-bill.use-case.ts` — enriched `vendor_bill.submitted` + `vendor_bill.approval_recorded` data
- Specs: new `workflow-action-runner.use-case.spec.ts` (registered in apps/api package.json test list — hand-maintained!); extended `vendor-bill-maker-checker.use-case.spec.ts` (payload pin) + `workflow-runner.use-case.spec.ts` (mock gained `findUserIdsByPermissions`)

## Verification

- New/changed specs green; full API suite 2120/2120; `tsc --noEmit` clean
- Live DB (docker :15432/watchdog_bms): `findUserIdsByPermissions` matches independent resolver-style ground truth across all companies; empty-keys → [] (scratchpad `verify-permission-recipients.ts`, not committed)

## Next

- Prod: template row reaches DB via `prisma db seed` upsert (template-sync ops step already tracked for prior catalog additions); template ships disabled — an admin with `workflow.rule.manage`+`enable` must enable it per company
- Open sibling task: reimbursement template default-condition mismatch (spawned chip)
