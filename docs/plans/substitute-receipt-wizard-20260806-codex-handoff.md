# Substitute receipt — end-to-end wizard — Codex CLI Handoff

Status: Implement-ready 2026-08-06. Phase 3 of [[substitute-receipt-standalone-menu-plan]].
Depends on Phase 1 (`approvalMode`) and Phase 2 (standalone menu + hub page) already being applied in the working
tree. Task state: [[substitute-receipt-standalone-menu]].

Executor: Codex CLI. Never commit, never `git add`/`checkout`/`restore`/`stash`, never start servers, never run
e2e, no `prisma migrate` (this phase adds no schema change).

## Why

Phase 2 gave the feature a menu and a list, but doing the work still means understanding the expense-detail
stepper: the user must find the ⚠ banner in step "หลักฐาน", expand a collapsible block, and fill a dense form
that mixes preparation, signing, approval, and version-supersede controls in one column. The owner reported this
as the reason the feature was unusable. This phase adds a linear wizard that owns the whole lifecycle.

**Reuse only.** Every API call already exists (`generateSubstituteReceipt`, `previewSubstituteReceipt`,
`certifySubstituteReceipt`, `approveSubstituteReceipt`, the signature-upload pair, the payer list, the runtime
policy). Do **not** add endpoints, change contracts, or touch the domain. This is a UI composition phase.

## Routes

```
/companies/[companyId]/expenses/substitute-receipts/new                → wizard, step 1
/companies/[companyId]/expenses/substitute-receipts/[evidenceId]       → wizard, resumed by evidence status
```

Both are thin server components in `apps/web/app/(workspace)/…` matching the sibling expense routes, rendering
one client component `SubstituteReceiptWizardPage` from
`apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx`.

`/new` accepts `?expenseId=<id>` to preselect an expense — the hub's `+ สร้างใบรับรองฉบับใหม่` button and the
expense-detail banner both link here, so intent is never lost across a hop.

## Step model

Put the step derivation in a **pure exported function** in a new
`apps/web/src/features/expenses/substitute-receipt-wizard.model.ts`, and test that — not the component. This is
the pattern the rest of the feature follows (`expenses.model.ts` + `expense-review-steps.logic.spec.ts`).

```ts
export type WizardStep = 'expense' | 'details' | 'evidence' | 'certify' | 'approve' | 'done';

// Resume rule, given the evidence (or null before preparation) and who is looking:
//   null                                  → 'expense'
//   PREPARED  + viewer is the payer       → 'certify'
//   PREPARED  + viewer is not the payer   → 'certify' (read-only waiting state)
//   PAYER_CERTIFIED + viewer may approve  → 'approve'
//   PAYER_CERTIFIED + viewer may not      → 'approve' (read-only waiting state)
//   ISSUED / SUPERSEDED                   → 'done'
export function resolveWizardStep(...): WizardStep
```

"may approve" = `permissions.includes('expense.confirm')` and (`evidence.payerUserId !== userId` **or** the
runtime policy's `approvalMode === 'OWNER_SELF'`). This is the same predicate `DocumentReviewSection` now uses
as `canApproveEvidence` — extract it into the model file and have **both** call sites use the one function, so
they cannot drift.

**Owner-self collapse**: when the viewer is both the payer and an eligible self-approver, `certify` and
`approve` are rendered as one continuous step labelled `ลงนามและอนุมัติ` with a visible sub-progress
(`1. ลงนามในฐานะผู้จ่ายเงิน` → `2. ลงนามในฐานะผู้อนุมัติ`). Two API calls still happen in order, unchanged.

Steps 1–3 are freely navigable backwards before preparation; once prepared, the earlier steps become read-only
summaries (the snapshot is immutable — do not offer edits that the API will reject).

## Step contents

**1 · เลือกรายการค่าใช้จ่าย** — two panels: pick from expenses that still need a receipt (reuse the existing
expense list query with the filter the detail page uses for `expenseNeedsReceiptOrSubstitute`; if no such server
filter exists, filter client-side over the existing list call and say so in your report), or a compact
"บันทึกรายการค่าใช้จ่ายใหม่" form calling the existing manual-draft endpoint. After selection, show a
**consent panel** — required checkbox:

> รายการนี้จะถูกบันทึกเป็นรายจ่ายที่ไม่มีใบเสร็จรับเงิน และจะไม่สามารถนำภาษีซื้อ (VAT) มาขอคืนได้
> ☐ ข้าพเจ้ารับทราบและยืนยันการดำเนินการ

Only after it is ticked does the wizard apply the document-type/tax-evidence presets that
`startGuidedSubstitute` applies today. The silent mutation must not survive this phase.

**2 · เหตุผลและผู้จ่ายเงิน** — reason code, missing-receipt reason, business purpose, payer, payment method,
payment date. Same fields and same validation as the current form. (Payee identity fields — name, address,
เลขประจำตัวประชาชน — are **plan Phase 2**, they need a migration and a document-render change; do not add them
here.)

**3 · แนบหลักฐาน** — the two labelled dropzones (หลักฐานประกอบรายการ / หลักฐานการชำระเงิน), driven by the runtime
policy exactly as today. Completing this step calls `generateSubstituteReceipt` and routes to
`/substitute-receipts/{evidenceId}`.

**4 · ลงนามในฐานะผู้จ่ายเงิน** — mandatory full preview first (existing checksum lock), position field,
signature upload with the existing background-removal helper, then certify. Keep the existing
`removeLightBackground` / `findOpaqueBounds` pipeline; an on-screen signature pad is plan Phase 2, not this one.

**5 · ตรวจสอบและอนุมัติ** — mandatory open of the certified artifact, position, signature, approve.

**6 · เสร็จสิ้น** — document number, issued badge, `เปิดดูเอกสาร`, and a link back to the expense
(`ไปยืนยันรายการเพื่อบันทึกบัญชี`). **No download button** — PDF is Phase 4; do not fake one.
Version history and the supersede control live here behind a collapsed
`ประวัติและการจัดทำฉบับแก้ไข` section — they must not appear anywhere in steps 4–5, which is the mixing the
owner complained about.

## Waiting states (replace the current dead ends)

When the viewer cannot act on the current step, render an explicit card naming who is expected to act and what
happens next — e.g. `รอผู้จ่ายเงิน (ชื่อ) ลงนามด้วยตนเอง` / `รอผู้มีอำนาจอนุมัติตรวจสอบและออกเอกสาร`, plus
`คัดลอกลิงก์สำหรับส่งให้ผู้ลงนาม` (a plain `navigator.clipboard` copy of the wizard URL). LINE/in-app
notification is plan Phase 2 — a copyable link is the honest interim.

## Keep the old entry points working

`DocumentReviewSection` in `ExpensesPages.tsx` keeps its status display but its call-to-action buttons now link
into the wizard instead of expanding the inline form:
- the ⚠ no-receipt banner → `/expenses/substitute-receipts/new?expenseId={id}`
- an existing evidence → `/expenses/substitute-receipts/{evidenceId}`

Do **not** delete the inline form in this phase — `expenseSubstituteReceiptReady` and the
`ยืนยันและลงบัญชี` unlock depend on that component's data, and existing e2e paths open it. Leave the form
mounted behind its current toggle and add the links above it. Removing it is a later cleanup.

Also repoint the upload tab's `expenses.upload_no_document_link` so it goes to the wizard with the intent
preserved rather than dropping the user on `/expenses/manual`.

## Copy, icons, dates (owner directives — enforce in every string you add)

- Formal-professional Thai a layperson understands. Official vocabulary (ลงลายมือชื่อ, เลขประจำตัวประชาชน),
  short sentences, verb-first buttons (ดำเนินการต่อ, ตรวจสอบเอกสาร, ย้อนกลับ). No casual particles, no emoji.
- Confirmations in first-person formal: `ข้าพเจ้ารับทราบและยืนยันการดำเนินการ`.
- Icons: **eye = view-only, pencil = edit/continue**. Reuse `IconBtn` and the project icon set.
- Dates: `5 ส.ค. 2569` everywhere. Reuse the single Thai date formatter Phase 2 established — do not add a second.
- Every new user-visible string goes through the `t()` dictionary with **both** `th` and `en` entries
  (`workspace-i18n.spec.ts` asserts locale parity).

## Files

```
apps/web/app/(workspace)/companies/[companyId]/expenses/substitute-receipts/new/page.tsx           (new)
apps/web/app/(workspace)/companies/[companyId]/expenses/substitute-receipts/[evidenceId]/page.tsx  (new)
apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx                                     (new)
apps/web/src/features/expenses/substitute-receipt-wizard.model.ts                                  (new)
apps/web/src/features/expenses/substitute-receipt-wizard.model.spec.ts                             (new)
apps/web/src/features/expenses/ExpensesPages.tsx          (link out to the wizard; keep the inline form)
apps/web/src/features/expenses/SubstituteReceiptHubPage.tsx   (point + สร้างใบรับรองฉบับใหม่ at the wizard)
apps/web/src/common/i18n/workspace-dictionary.ts
apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts   (only if the new sub-routes need a
                                                                        path rule; check before editing)
```

No API, contracts, or prisma changes in this phase. If you believe one is unavoidable, stop and say so in your
report instead of making it.

## Verify (run exactly these, in order)

```
corepack pnpm --filter @watchdog-bms/web typecheck
cd apps/web && corepack pnpm exec node --import tsx --test src/features/expenses/substitute-receipt-wizard.model.spec.ts
cd apps/web && corepack pnpm exec node --import tsx --test src/common/i18n/workspace-i18n.spec.ts
```

## Report back

1. `resolveWizardStep`'s final body, and where the shared "may approve" predicate now lives.
2. How step 1 finds expenses that still need a receipt (server filter or client-side, and why).
3. Which entry points you repointed at the wizard, and confirmation the inline form still mounts.
4. Test output for each verify command.
5. Anything in this handoff that was wrong about the code — say so plainly rather than working around it.
