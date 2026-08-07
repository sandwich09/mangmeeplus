# Reimbursement Journey Uplift Plan

Spec: [[specs/reimbursement-journey-uplift-spec|Reimbursement Journey Uplift Spec]]
Task memory: `docs/agent-memory/reimbursement-journey-uplift.md`
Execution model: Fable plans/reviews business correctness; Opus implements + tests + code-reviews per lane. Lanes run sequentially A → B → C → D in one shared worktree.

## Repo-wide traps (read before every lane)

- Node: shell defaults to v14. Prefix every command: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- Prisma CLI picks up stale `apps/api/.env` (5432/mydb). Always pass `DATABASE_URL="postgresql://postgres:postgres@localhost:15432/watchdog_bms"` explicitly (real local DB; e2e DB is a separate rebuild on :5432 — see e2e docs).
- Shared worktree with concurrent sessions: never `git add -A`; stage explicit paths only; re-read files before editing; do not commit unless asked.
- Do not run two typechecks concurrently. `pnpm --filter @watchdog/api exec tsc --noEmit` style, one at a time.
- apps/api tests are a hand-maintained explicit file list in `apps/api/package.json` ("test" script). Every NEW `*.spec.ts` under apps/api must be appended there or it silently never runs. apps/web uses a glob (auto).
- New migrations must be idempotent-safe against the dirty-tree deploy hazard: use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` style SQL (see docs/agent-memory on prod migration drift).
- Prisma 7: never `create → catch P2002` inside `$transaction` (aborts txn, 25P02). Precheck or upsert instead.
- Prisma 7 compound-FK nested create: when creating children through a compound-FK relation (e.g. `JournalLine`), omit `companyId` scalar. For the new `ReimbursementLine` we deliberately use the SIMPLE-FK shape (like `ExpenseLine`) with explicit `companyId` — mirror `prisma-expense.repository.ts:1166-1219` (`upsertLines`: advisory lock → deleteMany absent → per-line upsert on compound unique).
- Contracts build: packages/contracts has a dist build; after editing contracts run its build before api/web typecheck (see password-reset memory: contracts-dist trap).
- Verification servers: use `web-verify-3004` launch config (NEXT_DIST_DIR) if a second dev server is needed; login `Owner/Owner@12345`.

Focused checks per lane (minimum):

- API unit: `export PATH=...; pnpm --filter @watchdog/api test` (after registering new spec files).
- Web unit: `pnpm --filter @watchdog/web test`.
- Typecheck: contracts build → api tsc → web tsc (sequential).
- Browser verify via preview tools for UI lanes.

## Lane A — LINE staff-menu approvals card + hub tab param

1. `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts`
   - `buildPendingApprovalCard` (`:128-145`, URI at `:130`): accept the member's permission set (the caller `process-line-webhook.use-case.ts:567-586` already computes gating at `:37-39`); emit one footer button per surface:
     - `reimbursement.approve` → label `คำขอเบิกเงิน` → `${base}/companies/:id/reimbursements?tab=approvals`
     - `procurement.purchase_request.approve || procurement.purchase_order.approve` → label `ใบขอซื้อ/ใบสั่งซื้อ` → `${base}/companies/:id/procurement`
   - Keep flex-card shape; body copy stays generic. Update/extend the existing logic spec for this file if present; else add one and register it.
2. `apps/web/src/features/reimbursements/ReimbursementsPages.tsx` (`:34-62`): initialize the active tab from `useSearchParams()` `tab` (`mine|approvals|finance|policy`, else default). Next 16 app router: the page wrapper is a server component — read params in the client component via `useSearchParams`.
3. Tests: unit for card-per-permission variants; web logic spec for tab-param parsing (pure helper so it is testable without DOM).

## Lane B — notifications end-to-end

Backend catalog + payloads:

1. `apps/api/src/modules/workflow/domain/workflow-template-catalog.ts`
   - Add `autoEnable?: boolean` to the template type (`:3-17`); set `true` on the 5 reimbursement-flow templates (3 existing at `:87-144` + 2 new).
   - New templates (mirror `reimbursement_pending_approval` shape `:87-103`):
     - `reimbursement_ready_for_payment`: EVENT; binding `reimbursement.ready_for_payment` in `WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG` (`:23-29`); action SEND_NOTIFICATION `triggerKey: 'workflow.reimbursement_ready_for_payment'`, `recipientPermissions: ['reimbursement.payment.record']`, title `พร้อมจ่ายเบิกจ่าย: {{requestNo}}`, severity `action`.
     - `reimbursement_payment_recorded`: EVENT; binding `reimbursement.payment_recorded`; SEND_NOTIFICATION `triggerKey: 'workflow.reimbursement_payment_recorded'`, `recipientPayloadKeys: ['requesterUserId']`, title `จ่ายเงินเบิกแล้ว: {{requestNo}}`, severity `info`.
   - Recipient resolution already supports `recipientPermissions` (`workflow-action-runner.use-case.ts:144-147`).
2. Payload widening (keep existing keys, add):
   - `reimbursement-finance.use-case.ts:111-115` (`ready_for_payment`): add `requestId`, `requestNo`, `requesterUserId`.
   - `reimbursement-finance.use-case.ts:201-205` (`payment_recorded`): add `requestNo`, `requesterUserId` (requestNo from the loaded request; keep redactPayload).
   - `reimbursement-approval.use-case.ts:102-106` (`approved`): add `requestNo`; `:155-159` (`rejected`): add `requestNo`, `amount`, `currency`.
3. Deep links:
   - `workflow-action-runner.use-case.ts:48-51` `sourceWebPath`: map `reimbursement_request` → `/companies/{companyId}/reimbursements?focus={sourceId}`; leave other source types as-is.
   - Per-template tab hint: add optional `deepLinkPathTemplate` on the notification action config (rendered with the same payload renderer as titles); templates set `?tab=approvals&focus={{requestId}}` / `?tab=mine&focus={{requestId}}` / `?tab=finance&focus={{requestId}}` per spec B5. Fallback stays `sourceWebPath`. `WorkflowTask.webDeepLink` (`:216`) uses the same resolved path.
4. LINE preference gate:
   - `apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts:112-119` `IMPLEMENTED_TRIGGER_KEYS`: add the 5 `workflow.reimbursement_*`/`workflow.approval_sla_breach` keys.
   - `apps/api/prisma/seed.ts:2825`: stop narrowing owner `enabledTriggerKeysJson` (null/omit → default-all).
5. LINE identity fallback:
   - `notification.use-cases.ts:331-346`: when channel-scoped lookup misses, fall back to `findFirst({ userId, provider: 'LINE', status: 'ACTIVE' })` (mirror `notify-password-reset-request.use-case.ts:117-121`), log/mark the delivery errorCode-free but with a distinct log line for observability.
6. Template sync + auto-enable:
   - New `apps/api/prisma/sync-workflow-templates.ts` mirroring `sync-permissions.ts`: (a) upsert `WorkflowTemplate` rows from catalog by key; (b) for each ACTIVE company × autoEnable template with NO existing `WorkflowRule` for that templateId: create rule + version + ENABLED via the same primitives as `EnableWorkflowTemplateUseCase`/`createRuleVersionAndEnable` (`workflow-template.use-case.ts:38-61`, `workflow-rule.use-case.ts:150-174`) — reuse logic, do not fork semantics; system actor id recorded.
   - Add to `infra/prod-ecs-express/run-release-task.sh:87` command chain after sync-permissions; add to local seed flow (`seed.ts` calls or docs).
   - Idempotency test: run twice → second run creates nothing; a DISABLED existing rule stays DISABLED.
7. Company onboarding: after company creation, invoke the same auto-enable helper (seam: `create-company-onboarding.use-case.ts`) so fresh companies need no release run.

Web:

8. Notification center `apps/web/src/features/dashboard-notifications/NotificationPages.tsx:100-117`: item click → `markRead` + `router.push(item.deepLinkHref)` when present (internal hrefs only — guard startsWith(`/`)).
9. Nav: `web-core-workspace.constants.ts:268-276` notifications entry → buildHref `/notifications` (center); badge via `getUnreadCount` (`dashboard-notifications.api.ts:81-83`) — poll lightly (on workspace mount + focus), no websockets.
10. Reimbursements hub `focus` param: highlight row in the active tab (lane A already reads `tab`); after lane C, `focus` opens the drawer.

Tests: template catalog spec (bindings + autoEnable set), payload assertions in approval/finance use-case specs, sync script spec (idempotency + no-tramble), preference-gate spec (workflow key passes), action-runner deepLink spec, web api spec for unread badge helper. Register new api spec files in `apps/api/package.json`.

E2E-level check (api): submit claim → drain outbox → assert NotificationEvent row with correct deepLinkHref (extend `e2e/notifications.spec.ts` or api-level spec with fake outbox drain — choose the cheaper existing harness pattern).

## Lane C — multi-line claim

Schema + migration:

1. `apps/api/prisma/schema.prisma`: add `ReimbursementLine` after `ReimbursementRequest` (fields per spec §Lane C; Decimal(18,4); relations: `company` + `request` cascade; `@@unique([reimbursementRequestId, lineNo])`, `@@index([companyId, linkedExpenseId])`, `@@index([companyId, attachmentId])`); add `lines ReimbursementLine[]` to `ReimbursementRequest`.
2. Migration SQL (idempotent): `CREATE TABLE IF NOT EXISTS` + backfill INSERT one line per existing request from header fields (`lineNo=1`, description = COALESCE(title, LEFT(reason, …)), amount, incurredDate, categoryKey/label, attachmentId=primaryAttachmentId, linkedExpenseId) with `WHERE NOT EXISTS` guard. Run against local docker DB first; e2e DB rebuild after.

Domain/application (`apps/api/src/modules/reimbursements/`):

3. `domain/logic/reimbursement.logic.ts`
   - `validateRequestFields` (`:41-52`): validate lines (≥1, ≤50, dense lineNo, amount>0 each, description required) + total>0.
   - `computeSnapshotHash` (`:66-76`): fold lines in lineNo order per spec; keep header fields.
   - `computeReceiptRequirement` (`:106-120`): per-line evidence per spec (every line evidenced OR missingReceiptReason).
   - `scoreDuplicate` (`:196-209`): accept line evidence sets; +60 on any shared attachmentId/linkedExpenseId across lines; keep header total/date signals.
   - Rollup helpers: `computeClaimTotal(lines)`, header category/incurredDate derivation per spec.
4. `application/use-cases/reimbursement-request.use-case.ts`
   - create (`:34-85`): accept `lines[]`, compute rollup server-side, persist lines; audit metadata gains lineCount.
   - update draft (`:87-…`): replace lines wholesale (upsert pattern), recompute rollup; DRAFT-only unchanged.
   - submit (`:172-283`): receipt gate with lines; dup detection over lines; double-claim check (`expense_already_claimed`/`attachment_already_claimed`) — repo query on ReimbursementLine of other active requests; snapshot hash with lines; `outstandingAmount` = rollup.
5. `application/services/reimbursement-evidence.service.ts`: validate per-line evidence (ownership rules unchanged; loop lines), plus the cross-claim uniqueness query.
6. `infrastructure/prisma-reimbursement.repository.ts`: `createRequest`/`updateRequest` persist lines (mirror `upsertLines` pattern from `prisma-expense.repository.ts:1166-1219`, advisory lock keyed on request id); `findRequestById` include `lines orderBy lineNo` (`:103-108`); mapper rows.
7. `application/dto/reimbursement.mapper.ts`: `toLineSummary`; detail gains `lines`; summary gains `lineCount`.
8. Contracts `packages/contracts/src/reimbursements.ts`: `ReimbursementLineInput`, `ReimbursementLineSummary`, `lines` on create/update/detail, `lineCount` on summary. Rebuild contracts dist before typechecks.
9. New `presentation/http/reimbursement.dtos.ts` (class-validator, follow `ledger.dtos.ts:1-40` conventions) for create/update/payment bodies; controller binds DTO classes (`reimbursement.controller.ts:113,127,178`).
10. LINE AI read tools: `erp-reimbursement-tools.use-case.ts:40` + `erp-core-detail-tools.use-case.ts:224-229` — totals unchanged; detail tool may add lineCount (keep payload small).

Web (`apps/web/src/features/reimbursements/`):

11. `reimbursements.logic.ts`: `validateRequestForm` → lines validation + client-side sum display helper.
12. `ReimbursementsPages.tsx`: create form → line-rows editor per spec; per-line attach via existing 3-step flow then draft update writing that line's `attachmentId`; DetailDrawer lifted to hub level, openable from all 3 queues (read-only + role actions: approve/reject in approvals context, finance actions in finance context — reuse existing handlers); drawer renders line table + evidence per line; `focus` param opens drawer (completes lane B hook). Keep list/queue columns + add จำนวนรายการ.
13. `reimbursements.api.ts`: typed-ish helpers for lines payloads (keep existing style).

Tests:

14. Update `reimbursement.logic.spec.ts` (hash-with-lines, per-line receipt gate, dup-over-lines, rollup), `reimbursement-approval.use-case.spec.ts` (stale snapshot on line edit), `reimbursement-finance.use-case.spec.ts` (payment vs rollup), new `reimbursement-request.use-case.spec.ts` (create/update/submit with lines, double-claim rejection) — REGISTER in `apps/api/package.json`.
15. Web `reimbursements.logic.spec.ts` update. e2e `reimbursements.spec.ts` posts `lines[]`; `reimbursement-receipt.spec.ts` drawer flow updated.
16. Migration verify: run migration on local docker DB; spot-check an existing request shows 1 line and identical total; suite green.

## Lane D — printable claim form

1. `apps/api/src/modules/reimbursements/domain/logic/claim-form.logic.ts`: `renderReimbursementClaimFormSvg(snapshot): Buffer` — copy structure/helpers from `substitute-receipt.logic.ts` (`Intl.Segmenter` wrap `:8-9,:240`, `estimatedWidth :265`, `thaiBahtText :73`, XSS escaping, A4-proportioned width, computed height). Layout per spec §Lane D (5-column table, checklist, reason, 4 signature blocks). Reuse font stack `Noto Sans Thai, Tahoma, sans-serif`.
2. Snapshot builder in a new `application/use-cases/reimbursement-claim-form.use-case.ts`: load detail (lines, steps, payments, policy not needed), resolve display names via member-identity lookup (mirror `prisma-expense.repository.ts:428-441 findActiveMemberIdentity` — add equivalent to reimbursement repo), company letterhead via the substitute-receipt precedence (`getSubstituteCompanyContext` pattern `prisma-expense.repository.ts:526-533` — replicate, don't import across modules).
3. Endpoint `POST companies/:companyId/reimbursements/:requestId/claim-form/preview` → `{ svgDataUrl, checksumSha256 }`; permission = same guard as GET detail (`reimbursement.read_own` + `assertCanReadRequest`); reject `status === 'DRAFT'` (`claim_form_requires_submitted`).
4. Detail contract/mapper: add display names to step/payment summaries (approverName, decidedByName, financeReviewedByName, paidByName) — drawer renders them.
5. Web: `พิมพ์ใบเบิก` button in drawer header (status !== DRAFT) → call preview → open in existing fullscreen viewer (`onOpenFile` img pattern from `ExpensesPages.tsx:385-389`); user prints via browser.
6. Tests: renderer spec (UTF-8 Thai present, escape, per-status signature rendering, 3-line table sums) — mirror `substitute-receipt.logic.spec.ts`; use-case spec for name resolution + DRAFT rejection. Register both.
7. Browser verify: print preview on a paid claim; screenshot for evidence.

## Lane E — owner-feedback UI fixes

1. `WorkspaceLayout.tsx:50-65`: add `'reimbursements'` to `DESIGN_HANDOFF_NAV_ORDER` right after `'expenses'` (rank sort keeps the finance block contiguous; `AppSidebar.tsx:223-246` then emits one การเงินและบัญชี header). Nothing else needed (label `workspace-dictionary.ts:63`, icon in ICON_MAP, tone in mangmee-design.ts:33).
2. Currency → `ThemedSelect` at `ReimbursementsPages.tsx:255` (component already imported; option บาท (THB) value THB; keep `form.currency` seeding at `:179`).
3. Portal the popovers: `common/components/field/ThemedSelect.tsx` (panel at `:150-155`) + `ThemedDate.tsx` (panel at `:169`) render panels via `createPortal` (pattern + rationale: `common/components/modal/Modal.tsx:4,:56-58,:82`) with `position: fixed` anchored to trigger `getBoundingClientRect()`; close (or reposition) on scroll/resize; `use-close-on-outside-click.ts` gains an optional extra ref/node so the portaled panel counts as inside. Keep DOM/ARIA semantics. Browser-verify one legacy usage (ProcurementPages filter `:105`) unchanged.
4. Drawer padding fix at `ReimbursementsPages.tsx:365-368`: scroll container drops `p-6`; header keeps `sticky top-0 z-10 … px-6 pt-6 pb-3` without negative margins; body content wrapped `px-6 pb-6` (copy `ExpensesPages.tsx:1052` + `:1061` pattern).
5. Tab gating: `app/(workspace)/companies/[companyId]/reimbursements/page.tsx` fetches server session and passes `permissions` (copy expenses `page.tsx`); hub filters the tab list per spec E5; `parseHubTab` result validated against visible tabs (fallback = first visible); drawer/away states unaffected. Update `reimbursements.logic` helper + spec for the visible-tab fallback (pure fn).
6. Remove `rowClass` helper `ReimbursementsPages.tsx:44-47` + call sites `:315,:502,:560` (keep `focusId` → `openDetail` effect at `:73`).

Verification: web tests + typecheck; browser: sidebar shows การเบิกจ่าย under การเงินและบัญชี, currency dropdown, date/category popovers float above the table uncut, drawer header clean, STAFF-less tabs hidden (spot-check by permission filter), no yellow tint.

## Lane F — claim-form signatures + signed-copy round trip

Backend:
1. Schema: `ReimbursementClaimSignature` per spec (+ relation on request); idempotent migration (CREATE TABLE/INDEX IF NOT EXISTS; enum via DO $$ guard); apply with `prisma db execute` (drift unchanged), `prisma generate`.
2. New `application/use-cases/reimbursement-claim-signature.use-case.ts`: `InitClaimSignatureUploadUseCase` + `CompleteClaimSignatureUploadUseCase` (mirror `InitSubstituteSignatureUploadUseCase:469-509` incl. PNG/JPEG ≤2MB, metadata tag, `withAttachmentCreate` pattern) and `SignClaimFormUseCase` (eligibility per spec role mapping; ack `snapshotHash` vs live `computeSnapshotHash` → `stale_claim_snapshot`; upsert on `[requestId, role]`; audit MEDIUM). Loader `loadOwnedClaimSignature` mirrors `loadOwnedSignature:531-552` (magic bytes + checksum → data URL).
3. Claim-form snapshot/renderer: signatures map role→dataUrl; `claim-form.logic.ts` embeds `<image>` above the name line in each signed block (mirror `substitute-receipt.logic.ts:181-186`); unsigned roles keep ruled lines.
4. Signed-copy endpoints: reuse generic attachment upload-intent/complete + `POST :requestId/claim-form/signed-copies` linking via `LinkAttachmentUseCase` semantics (targetType `reimbursement_request`, purpose `reimbursement.claim_form.signed`; permission per spec: requester or finance/payment holders; requires `requestNo`), `GET` list included in detail response (`signedCopies: [{attachmentId, fileName, uploadedAt}]`). Evidence export gains their ids.
5. Controller wiring + DTOs (class-validator) for sign + signed-copy endpoints.

Web:
6. Drawer signature section: 4 role slots w/ signed-by + date; "ลงนาม" button when session user is eligible for an unsigned/owned role → dialog (signature file input + bg-removal reuse — lift the canvas helper from `ExpensesWorkspacePanels.tsx:195-214` into `common` or copy per repo convention + ack current hash from detail) → sign call → drawer + print preview refresh.
7. Signed copies list + "แนบใบเบิกที่เซ็นแล้ว" upload (3-step + link endpoint) with standard viewer links.

Tests: use-case specs (eligibility per role incl. wrong-actor rejection, stale hash, replace-own, requestNo gate), renderer spec (signed vs unsigned blocks), signed-copy permission + listing; REGISTER new api spec files in `apps/api/package.json` (re-read tail first). e2e: extend `reimbursement-receipt.spec.ts` happy path if cheap, else record.

Verification: targeted subset + full-suite foreign-delta rule + sequential typechecks + live check on local DB (sign REQUESTER on the PAID seed claim via API probe, re-render form shows the image; signed-copy upload listed).

## Review gates per lane (Fable)

- Business rules hold exactly as spec'd (rollup, evidence, double-claim, signature mapping, no-tramble enablement).
- Contract ↔ UI ↔ e2e consistency; loading/error/permission states on new UI paths.
- Traps checklist above respected (test registration, idempotent migration, contracts dist, staging discipline).
- Task memory updated with verification evidence after each lane.
