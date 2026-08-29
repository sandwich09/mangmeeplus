# Reimbursement Journey Uplift Spec

## 1. Status

Ready for implementation. Date: 2026-07-26.
Owner decisions captured verbatim from owner chat (2026-07-26):

- Chat-created reimbursement requests: **not needed yet** ("ใช่ยังไม่ต้องมี"). LINE stays read-only for reimbursement mutations. This spec does NOT add any chat entry point.
- LINE staff-menu "รายการรออนุมัติ" deep-link bug: **fix**.
- Reimbursement notification templates: **should be enabled**, and the notification path must be implemented completely across BE + UI + usage flow ("ควรเปิด ดูรอบๆด้วย ควร implement ให้ครบทั้ง ui be flow การใช้งาน").
- One claim should hold multiple line items ("1 ใบเบิกควรมีได้หลายรายการ") — covers both the paper-form table and the LINE-captured `ExpenseRecord` linkage.
- Printable claim form returns, using the same template layout as `Reimbursement_Claim_Form_Template.docx` ("กลับมาอีกครั้งและใช้ template เดียวกันกับในไฟล์ Word").

Supersedes/amends parts of [[specs/reimbursement-approval-spec|Reimbursement and Approval Spec]] (item 14):

- Revives `ReimbursementLine` (spec §ReimbursementLine, previously skipped per `docs/agent-memory/reimbursement-approval-14.md`).
- Revives a printable document, but as the per-request claim form `ใบเบิกค่าใช้จ่าย` — NOT the grouped per-payee `ใบสำคัญจ่าย` payment voucher of item-14 spec table rows "Create/Get payment voucher". The grouped voucher stays unimplemented and out of scope.
- Item-14 boundary "LINE does not approve, reject, or mark paid" is unchanged and reaffirmed.

Linked plan: [[plans/reimbursement-journey-uplift-plan|Reimbursement Journey Uplift Plan]]
Task memory: `docs/agent-memory/reimbursement-journey-uplift.md`

## 2. Goal and users

Make the reimbursement journey actually usable end-to-end for a Thai SME:

- Requester (any employee with `pack.reimbursement.self`): files one claim with several expense rows exactly like the paper form, attaches a receipt per row (or links a LINE-captured expense), gets notified of the decision and of payout.
- Approver (MANAGER role): gets notified on LINE + web when a claim needs approval, taps through to the right queue, sees the line breakdown before deciding.
- Finance/accounting (FINANCE/ACCOUNTANT): gets notified when a claim is ready to pay, records payment, and can print the claim form for the physical signature file.
- Owner/Admin: nothing new to configure — the notification rules arrive enabled by default and remain manageable in the existing Workflow UI.

## 3. Scope — four lanes

### Lane A — LINE staff-menu approvals card fix

Problem: `buildPendingApprovalCard` links to `/companies/:id/settings/po-approval`, which is a settings page with demo data — wrong for every audience.

Behavior:

- The card shows one button per approval surface the member can actually act on:
  - `reimbursement.approve` → "คำขอเบิกเงิน" → `{web}/companies/:companyId/reimbursements?tab=approvals`
  - `procurement.purchase_request.approve` or `procurement.purchase_order.approve` → "ใบขอซื้อ/ใบสั่งซื้อ" → `{web}/companies/:companyId/procurement`
- If the member has neither permission the existing gating already hides the menu item; keep that.
- The reimbursements hub must honor `?tab=mine|approvals|finance|policy` (initial tab from query param; invalid/absent → current default). This reader is part of lane A.

### Lane B — reimbursement notifications, complete

Business outcome: submitting, deciding, readying, and paying a claim each notify the right person on web and LINE, with a working deep link, with zero admin setup.

B1. Template catalog changes (`workflow-template-catalog.ts`):

- Keep existing 3: `reimbursement_pending_approval`, `approval_sla_breach`, `reimbursement_decision_requester`.
- Add 2 new EVENT templates:
  - `reimbursement_ready_for_payment` — event `reimbursement.ready_for_payment`; notify recipients holding permission `reimbursement.payment.record` (use `recipientPermissions`, not roles); title `พร้อมจ่ายเบิกจ่าย: {{requestNo}}`; severity `action`.
  - `reimbursement_payment_recorded` — event `reimbursement.payment_recorded`; notify `recipientPayloadKeys: ['requesterUserId']`; title `จ่ายเงินเบิกแล้ว: {{requestNo}}`; severity `info`.
- Mark all 5 reimbursement-flow templates `autoEnable: true` (new catalog field, see B3).

B2. Event payload widening (submit/approve/reject/ready/paid must be template-renderable):

- `reimbursement.ready_for_payment` payload gains `requestId`, `requestNo`, `requesterUserId` (today it has only status/amount/currency — `{{requestNo}}` would render empty and deep links cannot be built).
- `reimbursement.payment_recorded` payload gains `requestNo`, `requesterUserId`.
- `reimbursement.rejected` payload gains `requestNo`, `amount`, `currency`.
- `reimbursement.approved` payload gains `requestNo`.
- Amounts in payloads remain the claim total (see lane C rollup rule) — no line detail in notification payloads.

B3. Enablement with zero admin setup, without trampling admin intent:

- New `prisma/sync-workflow-templates.ts` (same shape as `sync-permissions.ts`): upserts the global `WorkflowTemplate` rows from the catalog, then for every ACTIVE company and every template with `autoEnable: true`, creates an ENABLED `WorkflowRule` (with version snapshot, default trigger config) **only when no rule for that template exists in any status**. Existing rules are never modified — an admin's explicit disable stays disabled.
- Wire the script into `infra/prod-ecs-express/run-release-task.sh` after `sync-permissions.ts`, and into the local seed path.
- Company creation: new companies get the autoEnable rules at onboarding (reuse the same helper in the onboarding use case or rely on the sync script idempotency — plan decides the seam; behavior requirement is: a fresh company has the 5 rules ENABLED without admin action).

B4. LINE delivery unblocking:

- Add the 5 workflow trigger keys (`workflow.reimbursement_pending_approval`, `workflow.approval_sla_breach`, `workflow.reimbursement_decision_requester`, `workflow.reimbursement_ready_for_payment`, `workflow.reimbursement_payment_recorded`) to `IMPLEMENTED_TRIGGER_KEYS` so the preference gate stops suppressing them.
- Seed's owner preference row must not narrow triggers anymore (remove the explicit `enabledTriggerKeysJson` narrowing, or set it to null = default-all). Users with explicit preference rows keep their choices; the preferences UI at `/settings/notifications` is the way to opt out.
- Identity fallback: when the channel-scoped `ExternalIdentity` lookup misses, fall back to any ACTIVE LINE identity for the user (same behavior as the password-reset notifier) so identities linked before `LINE_MESSAGING_CHANNEL_ID` was configured still receive pushes. Log the fallback distinctly.

B5. Deep links that actually open the right screen:

- `sourceWebPath` mapping for `reimbursement_request` becomes `/companies/:companyId/reimbursements?focus=:requestId` (no more `/reimbursements/reimbursement_request/:id` 404).
- Per-template tab targeting: pending_approval → `?tab=approvals&focus=`, decision_requester → `?tab=mine&focus=`, ready_for_payment → `?tab=finance&focus=`, payment_recorded → `?tab=mine&focus=`. Plan decides mechanism (template-level path template rendered with payload is acceptable).
- The reimbursements hub honors `focus`: switch to the indicated tab and visually highlight the focused row; after lane C's drawer lift, focus opens the detail drawer.
- `WorkflowTask.webDeepLink` and the LINE message tail reuse the same corrected path.

B6. Notification center usable:

- Notification list items with `deepLinkHref` navigate on click (and mark read).
- Workspace nav: the notifications nav entry points at the notification center (`/notifications`), shows an unread badge via the existing `getUnreadCount`; the center keeps its link to preferences.

Out of scope for B: rewriting the dead worker-side delivery adapters (they stay dead), per-user digest, new channels.

### Lane C — multi-line claim (1 ใบเบิก หลายรายการ)

Data model — new table `ReimbursementLine`, mirroring the repo's child-line convention (`ExpenseLine` shape: simple parent FK + denormalized `companyId` + `@@unique([reimbursementRequestId, lineNo])`):

- `id`, `companyId`, `reimbursementRequestId`, `lineNo` (1..N dense), `incurredDate`, `description` (รายการ), `purpose` nullable (วัตถุประสงค์), `categoryKey`, `categoryLabelSnapshot`, `amount Decimal(18,4)`, `attachmentId` nullable, `linkedExpenseId` nullable, `createdAt`, `updatedAt`.
- No `currency` on lines: **one currency per claim** (header). Mixed-currency claims are rejected at the edge (there is no input to express them).
- Linkage grain is `ExpenseRecord` (`linkedExpenseId`), not `ExpenseLine` — LINE receipt capture produces one `ExpenseRecord` per receipt and users think in receipts. (Deviation from item-14 spec's `linkedExpenseLineId`, recorded here.)

Header semantics:

- `ReimbursementRequest.amount` becomes a server-computed rollup = sum of line amounts. Clients never send a total; create/update inputs carry `lines[]` and the server computes. All existing consumers (queues, summary, AI tools, banking, workflow payloads, payment validation) keep reading the header total unchanged.
- Header `categoryKey`/`categoryLabelSnapshot` become display defaults: single-category claim → that category; mixed → `categoryKey` of line 1 and label `หลายหมวด (N รายการ)`.
- Header `incurredDate` = earliest line date (display/dup-scoring compatibility).
- `linkedExpenseId`/`primaryAttachmentId` on the header stay as legacy columns; new writes go to lines. Migration: every existing request gets exactly one line synthesized from header fields (lineNo 1, description = title or reason, amount/incurredDate/category/attachment/linked-expense from header).

Business rules:

- A claim must have ≥1 line; every line `amount > 0`; claim total > 0. Line count cap 50.
- Incurred dates must be real calendar dates on or before today in the reimbursement business
  timezone (Asia/Bangkok), not the browser/server local day or UTC today. Create, replacement-line
  draft updates and submit validate every line; an existing future-dated draft must be corrected
  before submission. Date errors name the line, leave values available to correct, and never
  silently clamp dates or change historical approved requests. The create/edit picker bounds all
  selection paths (including Today); this rule does not constrain payment dates, appointments,
  due dates or search filters. Existing ISO/Date compatibility is retained.
- Evidence per line: a line is evidenced when it has `attachmentId` or `linkedExpenseId`. When policy requires receipts, submit requires every line evidenced, OR a claim-level `missingReceiptReason` (one reason may cover multiple gaps — matches the existing single field). `receiptRequirementStatus` stays claim-level.
- Double-claim protection: an `ExpenseRecord` or attachment already referenced by a line of another active claim (status not REJECTED/CANCELLED/VOIDED) cannot be linked again — submit-time validation error `expense_already_claimed` / `attachment_already_claimed`.
- Duplicate detection: scoring inputs now iterate lines — any shared line `attachmentId` (+60) or `linkedExpenseId` (+60) across requests; total-amount (+20) and same-day (+10) signals stay header-level. `ReimbursementDuplicateCandidate` schema unchanged; the offending line is named in `reason`.
- Snapshot hash: `computeSnapshotHash` folds header fields plus every line's `(lineNo, amount, categoryKey, incurredDate, description, purpose, attachmentId, linkedExpenseId)` in lineNo order — any line edit invalidates a pending approval exactly like an amount edit does today.
- Payment: unchanged — full payment of the claim total only; no per-line payment; void math unchanged (header totals).
- Approval/finance permissions, states, SLA: unchanged.

Contracts and validation:

- `ReimbursementLineInput` + `lines[]` on `CreateReimbursementRequestInput`/`UpdateReimbursementDraftInput`; `ReimbursementLineSummary[]` on detail (and `lineCount` on summary).
- Add `reimbursement.dtos.ts` with class-validator DTOs (`@ValidateNested({ each: true })`) — the controller currently binds raw types with zero runtime validation; that gap closes in this lane.

Web UI:

- Create form becomes a line table (per row: วันที่, รายการ, วัตถุประสงค์, หมวด, จำนวนเงิน, ใบเสร็จ attach/link) with add/remove row and a live รวมเป็นเงิน display.
- Per-line receipt upload reuses the 3-step upload-intent flow, then writes the line's `attachmentId` via draft update.
- Detail drawer shows the line table; drawer is lifted to hub level and openable (read-only + role-appropriate actions) from all three queues — an approver must see line detail and evidence before approving.
- Approval/finance queue rows keep header totals; add line count.
- e2e specs updated (`e2e/reimbursements.spec.ts`, `e2e/reimbursement-receipt.spec.ts`).

Out of scope for C: partial payment, ledger posting adapter (`postingStatus` stays write-only; the accounting plug-in path owns it), per-line tax fields (`taxInvoiceNo`, `taxReviewJson` — deferred), reordering UI beyond add/remove.

### Lane D — printable claim form (ใบเบิกค่าใช้จ่าย)

Document identity: per-request claim form matching `Reimbursement_Claim_Form_Template.docx`:

- Header: `REIMBURSEMENT CLAIM FORM` / `ใบเบิกค่าใช้จ่าย`, company letterhead line (registeredName ?? name, สาขา, เลขประจำตัวผู้เสียภาษี — same precedence as substitute receipt), เลขที่เอกสาร = `requestNo`, วันที่ = submitted date.
- Line table: ลำดับ / วันที่ / รายการ / วัตถุประสงค์ / จำนวนเงิน (฿) — from lane C lines; รวมเป็นเงิน = claim total + Thai baht text (`thaiBahtText`).
- เอกสารแนบ checklist: ใบเสร็จรับเงิน (checked when any line evidenced), ใบกำกับภาษี / หลักฐานการชำระเงิน / อื่น ๆ (rendered unchecked — wet-ink use).
- เหตุผลในการเบิก: claim `reason`.
- Four signature blocks mapped to real actors, printing name + date when the step happened, otherwise a blank ruled line for wet ink:
  - ผู้เบิก = `requesterDisplayNameSnapshot` + submittedAt
  - ผู้อนุมัติ = approval step decider display name + decidedAt
  - ฝ่ายบัญชี = finance-review actor display name + financeReviewedAt
  - ฝ่ายการเงิน = payment `paidByUserId` display name + paidAt

Mechanism: mirror the substitute-receipt stack exactly — pure `renderReimbursementClaimFormSvg(snapshot)` domain fn (Thai wrap/escape/baht-text helpers reused), snapshot builder resolving display names via member-identity lookup, `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/preview` returning `{ svgDataUrl }` (permission: same read path as GET detail), web opens it in the existing fullscreen file viewer; printing is browser print. No PDF library, no persistence in this pass.

Detail response also gains display names for approval steps, finance reviewer, and payments (the drawer shows them too — a cuid on screen is as unusable as on paper).

Availability: print button in the detail drawer header, visible when `status !== 'DRAFT'` (a draft has no requestNo). Reachable from all queues via the lifted drawer (lane C).

### Lane E — owner-feedback UI fixes (2026-07-26 review round)

Owner feedback verbatim: no sidebar entry; currency should be a themed dropdown defaulting to บาท; dropdown/calendar/drawer-header bleed-through ("ทะลุ"); policy tab visible to OWNER+ADMIN only; remove the yellow row highlight (status chip colors are correct and sufficient).

E1. Sidebar entry: `reimbursements` joins `DESIGN_HANDOFF_NAV_ORDER` immediately after `expenses` so การเบิกจ่าย renders under การเงินและบัญชี (registry entry, label, icon, tone, permission gating all pre-exist).
E2. สกุลเงิน becomes a `ThemedSelect` with the single option `บาท (THB)` (value `THB`, default selected). One currency per claim stays the rule; non-THB is not offered.
E3. Popover integrity: `ThemedSelect` and `ThemedDate` panels must not be clipped by, nor paint through, scroll containers — render the open panel via a portal with fixed positioning anchored to the trigger (same rationale as the shared `Modal`), extending the outside-click hook to treat the portaled panel as inside. Reposition-or-close on scroll/resize. All existing usages (filter bars in procurement/inventory/AP, policy tab) must be visually unchanged.
E4. Drawer sticky header: opaque, flush with the scrollport top, no content showing through — padding moves off the scroll container onto the header and body blocks (copy the `ExpensesPages` sticky pattern); negative margins removed.
E5. Tab gating: the reimbursements route passes server-session permissions into the hub (same pattern as the expenses page). Tabs render only with their permission: คำขอของฉัน → `reimbursement.read_own`; คิวอนุมัติ → `reimbursement.approve`; คิวการเงิน → `reimbursement.finance_review`; ตั้งค่านโยบาย → `reimbursement.policy.manage` only (OWNER/ADMIN). `?tab=` targets outside the visible set fall back to the first visible tab.
E6. Remove the `?focus=` yellow row tint everywhere (keep the focus behavior: tab switch + drawer auto-open).

### Lane E amendment — related-record visibility (2026-08-10)

The owner-approved cross-document rule supersedes E5's requester-only wording and Lane F's historical "no new permission
keys" constraint for reads. `reimbursement.read_related` is a universal, entitlement-gated, view-only key. The first tab is
labelled "รายการที่เกี่ยวข้อง" and lists only tenant/branch-scoped claims where the caller is a persisted request,
approval, finance, payment, signature, signed-copy or linked-expense actor. Requester update/submit/cancel controls still
require requester identity, the exact action permission and the allowed state; relation alone never renders them.

### Lane F — claim-form signatures + signed-copy round trip

Owner intent: the claim form gets an add-signature flow like the substitute receipt (ใบรับรองแทนใบเสร็จ), stays printable for wet-ink signing, and a signed photo/scan can be uploaded back into the system.

Data model: new table `ReimbursementClaimSignature` — `id`, `companyId`, `reimbursementRequestId`, `role` enum (`REQUESTER | APPROVER | FINANCE_REVIEW | PAYER`), `signatureAttachmentId`, `signedByUserId`, `signedAt`, timestamps, `@@unique([reimbursementRequestId, role])`. Idempotent migration, no backfill.

Digital signing rules:
- Eligible signer per role is the real actor of that step: REQUESTER = `requesterUserId` (claim submitted or later); APPROVER = decider of the APPROVED step; FINANCE_REVIEW = `financeReviewedByUserId`; PAYER = `paidByUserId` of the latest RECORDED payment. A user may sign exactly the roles they are eligible for; re-signing replaces their own signature.
- Sign action = per-document signature image upload (PNG/JPEG ≤ 2 MB, background-removal helper reused from the expenses flow), tagged `metadataJson { generatedFor: 'reimbursement_claim_signature', requestId, role }`, using the temporary-`attachment.create` grant pattern; no new permission keys.
- Sign requires acknowledging the claim's current snapshot hash (server recomputes and rejects `stale_claim_snapshot` on mismatch) — you sign what you previewed.
- The claim-form renderer embeds each stored signature image above the matching name line (mirror the substitute-receipt `<image>` embedding, magic-byte + checksum verification on load). Rendering stays on-demand; no per-signature stored artifact versions — the immutable record is the signed scan (below). Trade-off recorded.

Signed-copy round trip:
- Drawer gains "แนบใบเบิกที่เซ็นแล้ว" for claims with a `requestNo`: 3-step upload (PDF/JPG/PNG) then `AttachmentLink { targetType: 'reimbursement_request', purpose: 'reimbursement.claim_form.signed' }`. Multiple uploads allowed (latest first); each listed in the drawer with the standard viewer; evidence export includes their attachment ids.
- Upload allowed for the requester and holders of `reimbursement.finance_review` or `reimbursement.payment.record`.

Out of scope for F: LINE-channel signature capture for claims, approval-state coupling (signatures never gate the state machine), grouped voucher.

### Lane G — "อยู่ที่ใคร" current desk + claim timeline (Owner decision 2026-08-29)

Problem: a claim shows its status but never says who the ball is with. "รออนุมัติ" does not say
whose desk it sits on, and the drawer shows steps/payments as separate blocks, not as a journey.

G1. Current desk on every queue card — appended to what the card already shows, shortest form,
**no step numbers or fractions** (Owner explicitly rejected "(ขั้น 1/2)"):

- `อยู่ที่ คุณยุนกิ` — PENDING_APPROVAL, naming the ASSIGNED approvers of the current pending step
  (several read as `A หรือ B`; any one of them can decide).
- `อยู่ที่ ฝ่ายการเงิน` — FINANCE_REVIEW.
- `อยู่ที่ ฝ่ายการเงิน (รอบันทึกจ่าย)` — READY_FOR_PAYMENT / PARTIALLY_PAID.
- `อยู่ที่ ผู้ยื่น` — DRAFT.
- Nothing appended on a terminal claim (PAID / REJECTED / CANCELLED / VOIDED).

Pool-vs-person rule: individuals are named ONLY where the system truly assigns individuals — the
approval step's frozen assignment snapshot. Finance review and payment are permission pools and
print as the pool, never as a guessed person. When no assignee name resolves (role-routed step, or
a response path that did not load names) the card prints `ผู้มีสิทธิ์อนุมัติ`, never a cuid.

Contract: additive optional `currentDesk?: { kind: 'REQUESTER' | 'APPROVER' | 'FINANCE' | 'PAYMENT';
names?: string[] }` on `ReimbursementRequestSummary` (so detail and both queue items inherit it),
derived by the pure `currentDesk()` in `reimbursement.logic.ts`. APPROVED is transient and routes by
`financeReviewStatus`: PENDING → FINANCE, otherwise PAYMENT.

Query cost is the constraint, not a new read model:

- Finance queue — every row is FINANCE/PAYMENT by status alone: **zero** extra queries.
- Approvals queue — `listRequests` already includes the pending steps for a PENDING_APPROVAL query
  and the use case already collects the assignee ids: **one** batched display-name lookup per queue.
- Mine queue — **two** batched lookups for the page (pending steps of the page's PENDING_APPROVAL
  rows, then their names), and neither runs when the page holds no such row.
- Detail — steps and names are already loaded; computed, not queried. `detailUserIds` widens to
  include the frozen assignees so the waiting row can name them.

G2. Timeline block in the claim detail drawer (`เส้นทางของใบเบิก`) — the journey as a vertical list
built by a pure `buildClaimTimeline(detail)` from the detail payload alone: done rows (`✓` + who +
date), the current waiting row highlighted (`●` + `กำลังรอ …`), future rows dim (`○`). The waiting
approver row reuses the same resolved `currentDesk` names, so the card line and the timeline can
never disagree. Rows that cannot apply are omitted rather than shown as never-reached: a rejection
or cancellation ends the list there, and a claim whose policy path went straight to
READY_FOR_PAYMENT has no finance-review row.

Out of scope for G: desk history/aging per stage, reassignment from the timeline, LINE rendering of
the desk line, and a desk column in the desktop tables (the drawer's timeline answers it there).

## 4. Explicit non-goals (reaffirmed)

- No chat/LINE creation, approval, rejection, or payment of claims. LINE remains read-only + deep links for reimbursements.
- No grouped per-payee `ใบสำคัญจ่าย` payment voucher.
- No partial payments. No ledger posting adapter. No advance (เบิกล่วงหน้า) concept.
- No new permission keys; existing `reimbursement.*` keys cover all lanes.

## 5. Acceptance criteria

A. Tapping "รายการรออนุมัติ" in LINE as a MANAGER opens the reimbursements hub on the approvals tab; as a PO approver it offers the procurement page; `/settings/po-approval` is no longer a target.

B. On a fresh company (and on every existing company after one release-task run): submitting a claim notifies MANAGER members in-app and on LINE (linked identity) with a link that opens the approvals tab focused on that claim; approving/rejecting notifies the requester; reaching READY_FOR_PAYMENT notifies payment-permission holders; recording payment notifies the requester; all with rendered `{{requestNo}}`. SLA breach escalates per existing template. Notification center items navigate on click and the nav badge shows unread count. No admin setup was performed.

C. A requester can create one claim with 3 lines (different dates/categories), attach a receipt to two lines and link a LINE-captured expense to the third, submit, and the approver sees all 3 lines + evidence in the drawer before approving; header lists/queues/AI tools show the correct total; editing a line after submit invalidates the pending approval (stale snapshot); linking the same expense on a second claim is rejected; payment still requires the exact total; existing single-amount requests keep working (each shows one migrated line).

D. From an approved-and-paid claim, print preview renders the claim form matching the Word template structure (header, 5-column line table, total + Thai baht text, checklist, reason, 4 signature blocks with real names/dates for completed steps), Thai text intact, and the browser print dialog produces a clean A4 page.

## 6. Verification expectations

- Unit: line rollup/validation, snapshot-hash-with-lines, per-line evidence gate, double-claim rejection, dup scoring over lines, payload widening, template autoEnable sync idempotency (run twice → no change; admin-disabled rule untouched), LINE preference gate passes workflow keys, renderer output (Thai text present, XSS escape, signature blocks).
- New API spec files must be appended to the hand-maintained `apps/api/package.json` test list.
- e2e: updated REIMB flows with lines; notification chain check at API level (submit → rule run → notification row exists with correct deepLinkHref).
- Browser verification of hub tab/focus params, drawer from queues, print preview.
