# Agent Memory: LINE รายการรออนุมัติ counts + permission-scoped capability answer

Status: Implemented, verified by focused tests. Not yet deployed to UAT.
Owner: thawatchai
Scope: `apps/api` line-ai (staff menu logic, webhook use case, capability follow-up), `apps/ai-gateway` response composer, `packages/contracts` ai-tools, `docs/specs/line-ai-assistant-ux-spec.md`.

Decisions:

- UAT 2026-08-18 (owner, from LINE screenshots): the รายการรออนุมัติ card only said "เปิดรายการจริงในเว็บ", so an approver could not tell from LINE whether anything was waiting. It now states the total, names each queue, and lists at most 5 rows before the web buttons.
- Counts are read through the same permission-checked use cases the web approval screens use — `ListApprovalQueueUseCase`, `ListPurchaseRequestsUseCase`, `ListPurchaseOrdersUseCase` — never repositories, so LINE can never list a row the person cannot see on the web. Approval itself stays on the web.
- A queue that is unwired or refuses (an approver without the matching `*.read` permission) is left OUT of the snapshot instead of reported as 0: "ไม่มีรายการ" and "อ่านไม่ได้" must not look the same to someone deciding whether to open the web app.
- Same UAT: "ทำอะไรได้บ้าง" advertised every module the product has, so a company without sales/CRM/tax was offered them and got "คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้" one turn later. The answer is now built from `LINE_CAPABILITY_GROUPS` (contracts) and a bullet survives only when at least one tool behind it passes `hasToolPermissions`.
- Permission-only gating is sufficient for the feature dimension: `prisma-permission-resolver.repository.ts` already strips permissions of features a company has not enabled (`filterPermissionsByEntitlement`). No entitlement plumbing was added to the gateway request contract.
- The table lives in contracts because the gateway composes the capability answer and the API composes the "อย่างไร" follow-up examples; one table, two consumers, so the follow-up cannot re-offer what the first reply left out.
- Capability groups stay one-feature-wide. Merging สินค้า with ลูกค้า would re-advertise a closed module the moment its neighbour is open. At most 6 bullets are rendered, with "• และงานอื่นตามสิทธิ์ของคุณ" when more exist.

Open questions:

- The card counts PR + PO into one "ใบขอซื้อ/ใบสั่งซื้อ" line. Owner 2026-08-18: procurement is not switched on yet, so no split is needed; leave it as one line.
- Owner 2026-08-18 asked about ใบสั่งซื้อ. Verified by running the real gate: with `procurement` off and entitlement rows present, `filterPermissionsByEntitlement` drops every procurement permission, so the approval queue, the menu button, and the new capability bullet all disappear. The ONE case where they still appear is the repo-wide legacy fail-open — a company with zero `CompanyFeatureEntitlement` rows gives `entitled === null` and every feature reads as on. If a live company shows ใบสั่งซื้อ in LINE, check its entitlement rows first; the fix is seeding them, not a special case in the LINE code.

Artifacts:

- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` — `PendingApprovalSnapshot`, `availableApprovalSurfaceKeys`, card rendering.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — `loadPendingApprovals`, three new `@Optional()` queue deps.
- `apps/api/src/modules/procurement/procurement.module.ts` — exports `ListPurchaseRequestsUseCase`.
- `packages/contracts/src/ai-tools.ts` — `LINE_CAPABILITY_GROUPS`, `availableLineCapabilityGroups`, `canCaptureLineReceipt`.
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts` — `composeCapabilityHelp(..., permissions)`.
- `apps/api/src/modules/line-ai/domain/logic/line-ai-capability-follow-up.logic.ts` — permission-backed follow-up examples.

Verification:

- `apps/api`: `pnpm typecheck` clean; `npx tsx --test` on `line-staff-menu.logic.spec.ts` (26 pass), `process-line-webhook.use-case.spec.ts` (79 pass), `line-intake-dispatch.use-case.spec.ts` (94 pass).
- `apps/ai-gateway`: `pnpm typecheck` clean; `npx tsx --test` on `response-composer.agent.spec.ts` + `orchestrator.agent.spec.ts` (70 pass).
- `packages/contracts`: build + `pnpm test` (125 pass).

Rebase (2026-08-19):

- Rebuilt on `origin/main` after the waiting-feedback (PR #167), sidebar account menu, and durable
  expense-draft (PR #169) work merged. `process-line-webhook.use-case.ts` was reset to the upstream
  file and only the approval-count wiring, the permission-scoped follow-up, and the OCR audit were
  re-applied, so nothing upstream is reverted. The local `LineReplyEvent` refactor was dropped —
  upstream already carries `beforeReply`/`pushTargetId` on those event types.
- Re-verified after the rebase: `apps/api` typecheck clean, `line-staff-menu.logic` +
  `process-line-webhook.use-case` + `expense-extraction.use-case` 114 pass,
  `line-intake-dispatch.use-case` 100 pass; `apps/ai-gateway` typecheck clean, 62 pass;
  `packages/contracts` build + 125 pass.

Merge resolution 2026-08-19 (PR #175 stack into develop):

- The approval-card half of this document stands as written and is the shipped implementation.
- The capability half is SUPERSEDED by the entitlement-derived answer of PR #175
  ([[specs/line-ai-capability-help-entitlement-spec|LINE AI Capability-Help Entitlement Honesty]],
  [[agent-memory/line-ai-capability-help-entitlement|capability-help entitlement memory]]). The
  decision above that "permission-only gating is sufficient for the feature dimension" is wrong for
  the CRM-on / sales-off case: `crm.report.read` reaches `sales.get_sales_summary`, so permissions
  alone cannot tell that company apart from one that bought sales. `entitledFeatureKeys` is now
  plumbed to the gateway and both replies gate on permissions ∧ entitlement.
- Consequently `LineCapabilityGroup`, `availableLineCapabilityGroups`, and `canCaptureLineReceipt`
  no longer exist. The contracts API is `LINE_CAPABILITY_GROUPS` (feature-key groups with `id`),
  `LineCapabilityGroupId`, `usableCapabilityGroupIds(permissions, entitled)`, and
  `canAdvertiseReceiptCapture(permissions, entitled)`; copy lives with its consumer, keyed by group
  id. `composeCapabilityHelp` takes `CapabilityAccess`, not a permission array.

Next:

- Ship to UAT and re-run the two LINE journeys from the screenshots: รายการรออนุมัติ on a reimbursement approver, and ทำอะไรได้บ้าง on a company with only some features enabled.
