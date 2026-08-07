# Global Toast Feedback — Codex Execution Handoff

Read `docs/plans/global-toast-feedback-plan.md` first — it is the design
authority. This file tells you exactly what to do in each phase, the
environment quirks of your sandbox, and the gate you must pass before
reporting done. Execute ONLY the phase named in your kickoff prompt.

## Environment contract (read every phase)

- Repo root: current working directory. App: `apps/web` (Next 16, React 19,
  Tailwind v4, TypeScript strict).
- Your shell has NO bare `pnpm`. Use `corepack pnpm …`.
- Your sandbox CANNOT reach postgres — never run e2e or anything needing the DB.
- Unit tests: run from `apps/web` with
  `CI=true npx tsx --test "src/**/*.spec.ts"` (or `node --import tsx --test`).
  Baseline: **740 pass / 0 fail**. Your phase must keep 0 fail and only ADD tests.
- Typecheck: `corepack pnpm --filter @watchdog-bms/web typecheck`.
- Build check: `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build`
  (default Turbopack stalls in your sandbox; use exactly this).
- Do NOT edit any `package.json`, `pnpm-lock.yaml`, or `packages/contracts/*`.
  No new dependencies — the toast system is hand-rolled.
- Do NOT touch `e2e/` except where Phase 4 says so.
- Test files must be `.spec.ts` (NOT `.spec.tsx` — the glob won't match) and
  use `node:test` + `node:assert/strict`. React rendering in specs via
  `renderToStaticMarkup` + `React.createElement` with `globalThis.React = React`
  and a dynamic `await import('./X')` — copy the idiom from
  `apps/web/src/common/components/field/Field.spec.ts`.
- UI copy: formal-professional Thai, verb-first, no emoji/casual particles.
  Success pattern: `<กริยา><กรรม>เรียบร้อยแล้ว`. `/system/*` pages keep English.
- Keep diffs minimal: reuse existing patterns, no speculative abstractions,
  match surrounding code style. Do not reformat untouched code.

## Phase 1 — Foundation

Deliverables:

1. `apps/web/src/common/feedback/toast-bus.ts` — framework-free:
   `type ToastEvent = { tone: 'success'|'warning'|'error'; message: string }`,
   `subscribeToastBus(fn): () => void`, `emitToast(event): void`,
   `emitApiErrorToast(error: unknown): void` (maps via `apiErrorMessage` from
   `../api/api-error-message`). No React import. SSR-safe (no window access at
   module top level).
2. `apps/web/src/common/components/toast/` per plan §2.1–2.3:
   - `toast.model.ts` — `ToastTone`, `ToastItem { id, tone, message }`, durations
     (success/warning 4000 ms, error 6000 ms), `MAX_VISIBLE = 3`, `DEDUP_MS = 1000`.
   - `toast.logic.ts` — pure functions over a queue:
     `addToast(items, input, now)` (dedup same tone+message within `DEDUP_MS`,
     cap at `MAX_VISIBLE` dropping oldest, id generation via injected counter or
     now-param — no `Date.now()` inside logic; the caller passes `now`),
     `removeToast(items, id)`, `toastDuration(tone)`.
   - `Toast.tsx` — one pill, presentational. Visual + a11y spec in plan §2.2
     exactly (classes per tone table, ✕ dismiss `IconButton`-style button with
     `aria-label="ปิดการแจ้งเตือน"`, glyphs ✓ ⚠ ✕; error pill `role="alert"`,
     success/warning `role="status"`).
   - `ToastProvider.tsx` — `'use client'`; holds items state; context value
     `{ success(m), warning(m), error(input) }`; subscribes `toast-bus` on mount;
     portals the stack to `document.body` (guard `typeof document`); one
     `setTimeout` per toast id stored in a ref map, cleared on dismiss/unmount —
     timers must NOT reset on re-render (do not put items in the effect deps).
     Container classes per plan §2.2. Enter transition gated behind
     `@media (prefers-reduced-motion: no-preference)` — add a tiny
     `@keyframes toast-in` + class in `apps/web/app/globals.css` next to
     `login-floaty`, following its reduced-motion wrapping.
   - `use-toast.ts` — `useToast()`; throws
     `'useToast must be used within a ToastProvider'` outside provider (idiom:
     `apps/web/src/common/components/app-shell/SidebarContext.tsx:21`).
     `error(input: unknown)` → string passes through, otherwise
     `apiErrorMessage(input)`.
   - `index.ts` barrel: `ToastProvider`, `useToast`, types.
3. Mount: `apps/web/app/layout.tsx` — wrap `{children}` with `<ToastProvider>`
   inside `<body>`. Root layout stays a server component (ToastProvider is the
   client boundary). Do not move fonts/metadata.
4. Seam hook in `apps/web/src/common/api/authed-fetch.ts` per plan §2.4:
   - `export type AuthedInit = RequestInit & { suppressErrorToast?: boolean }`;
     `authedApiFetch<T>(path, init?: AuthedInit, …)`.
   - In the `!res.ok` branch, after building the error object and only when
     `MUTATING_METHOD.test(method) && typeof window !== 'undefined' && !init?.suppressErrorToast`,
     call `emitApiErrorToast(error)` then throw as today. Strip
     `suppressErrorToast` before passing init to `fetch` (destructure it off in
     `authedApiFetch`; never send it into `authedFetch`'s RequestInit spread).
   - `authedFetch` itself (raw Response variant) stays untouched.
5. Legacy migration per plan §2.6:
   - `apps/web/src/features/expenses/ExpenseReviewPage.tsx` — replace
     `ActionToast`/`ToastState` usage (`:34,:38,:67,:170,:179-181,:925`) with
     `useToast` (`toast.success` / `toast.warning`; same messages). Delete
     `ActionToast` + `ToastState` from `ExpensesPages.tsx:79-98` and the
     now-unused import.
   - `apps/web/src/features/system-partners/PartnerDetailPage.tsx` — delete local
     `Toast` (`:129`) + toast state/timeout (`:1291-1296`); `showToast` becomes an
     adapter over `useToast` (`variant === 'error' ? toast.error : toast.success`);
     keep its prop-drilled signature so sub-sections don't change. Remove the
     `<Toast …/>` render.
   - Same removal in `SharedLineSettingsPage.tsx` (`:24`, `:141-147`, `:156`) and
     `PlatformAiBudgetPage.tsx` (`:13`, `:40-45`) → `useToast`. English messages stay.
6. Specs (all in the new toast dir unless noted):
   - `toast.logic.spec.ts` — add/dedup-window/cap-drops-oldest/durations;
     ids stable; no real timers.
   - `toast-render.spec.ts` — `renderToStaticMarkup` a success, warning, and
     error `Toast`: assert `bg-success-50`, `bg-warning-50`, `bg-error-50`,
     `text-*-700`, `role="status"` vs `role="alert"`, dismiss button aria-label.
   - Extend `apps/web/src/common/api/authed-fetch.spec.ts` (same scripted
     `fetchImpl` idiom): POST 500 → one bus event with Thai message; GET 500 →
     none; `suppressErrorToast: true` → none; event emitted before the throw
     reaches the caller. Subscribe/unsubscribe directly via `toast-bus`.
   - `apps/web/src/common/components/toast/no-local-toast.spec.ts` — walk
     `apps/web/src/features/**/*.tsx` (idiom:
     `common/components/mangmee/mangmee-interactive-theme.spec.ts:17`) and fail
     on `/function (ActionToast|Toast)\(/`.
7. If `border-error-500/20` produces no border color in the build output,
   fall back to the inline `color-mix` style from plan §2.2 and note it in
   your report.

Gate (run all; report outputs):
`corepack pnpm --filter @watchdog-bms/web typecheck` →
unit suite 0 fail (≥740 + your new tests) →
`IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build`.

## Phase 2 — Finance rollout

Scope dirs: `apps/web/src/features/{expenses,reimbursements,accounts-payable,accounting-documents,accounting-tax-setup,tax,banking,ledger}`.

Mechanic (plan §2.5): import `useToast`; success toasts only — NEVER
`toast.error` for API failures (seam covers it); keep existing inline
ErrorBanners; pure-client actions and redirect flows do not toast.

1. Shared helpers gain an optional success message:
   - `ExpenseReviewPage.tsx:147` `doAction` → `doAction(fn, successMessage?)`;
     wire its 9 silent call sites (ส่งตรวจสอบ, ยืนยันและลงบัญชี, ปฏิเสธ,
     ยกเลิกเอกสาร, ยืนยัน/ไม่ใช่รายการซ้ำ, บันทึกการจ่าย, ยอมรับยอด,
     สร้างสมุดรายวัน, เริ่มตรวจใหม่) with copy derived from each button label.
   - `ExpensesPages.tsx:461` `run(fn, doneText)` → success path becomes
     `toast.success(doneText)`; drop the InfoBanner set for plain done-texts,
     keep banners that carry instructions (read each site).
   - `banking/BankingPages.tsx:76` `action`, `reimbursements/ReimbursementsPages.tsx:288 drawerAction/:496 action/:1148 action`,
     `accounts-payable/AccountsPayablePages.tsx:282 action` — same optional
     successMessage param, wire every call site listed silent in the plan audit.
2. `AccountsPayablePages.tsx` shared `<p>` message (`:87`, `:167`): success text
   moves to `toast.success`; the `<p>` renders errors only (plan §2.7).
3. Silent modals/forms across the scope (create bill, create payment, WHT
   attach already has a status panel — leave; accounting-documents ALL 13
   actions; tax mark-filed/mark-paid/toggle/retire/activate/save-account/
   save-mapping/review-reconciliation/evidence verify; banking create-account/
   disable/reconcile-complete/reopen/adjustment flows/statement void/match/
   ignore/unmatch; ledger ปิดงวด; reimbursements submit/cancel/approve/reject/
   pay/sign/attach) → `toast.success` with per-action copy.
4. Warnings: 0-row exports (`ExpensesPages.tsx:1311`,
   `ExpensesWorkspacePanels.tsx:497`) become `toast.warning` instead of the
   error banner; reimbursement partial success `ReimbursementCreatePage.tsx:90`
   stays inline (has next-step UI) — no toast.
5. Redirects stay silent: `ExpensesPages:1710/:1552`,
   `ReimbursementCreatePage:88`, `SubstituteReceiptWizardPage:582`,
   `AccountingTaxSetupPage:302/:318/:344` (but its `saveMappings`
   not-activatable branch gets `toast.success('บันทึกการตั้งค่าเรียบร้อยแล้ว')`).
6. Auto-save on blur/change sites keep existing banners, no toast (plan §2.5.5).

Gate: same three commands as Phase 1.

## Phase 3 — Ops + CRM rollout

Scope dirs: `apps/web/src/features/{inventory,procurement,reports,workflow,crm,crm-inbox,ai-suggestions,dashboard-notifications}`.

Same mechanic. Additionally the feedback-adjacent fixes from plan §2.7:

1. `InventoryPages.tsx` — (a) `:328` whole-page `if (error) return` takeover →
   inline `ErrorBanner` above the form, form stays; (b) capture
   `event.currentTarget` into a local const BEFORE any `await` at `:310`,
   `:436`, `:602` and call `.reset()` on the captured element; (c) clear the
   stale `message` on new submission/failure (`:298`, `:320`); (d) local
   `errorMessage` (`:54`) → shared `apiErrorMessage`; (e) success toasts:
   update product, add barcode, generate QRs, create location, movement save —
   movement copy names the mode (e.g. `บันทึกรับเข้าเรียบร้อยแล้ว` per
   `MODE_LABELS`); stock-count no-op (`stockCount` returns null) →
   `toast.warning('ยอดตรงกับระบบอยู่แล้ว ไม่มีการปรับปรุง')`.
2. `procurement/ProcurementPages.tsx` — `action()` helpers ×3 get
   successMessage; all 6 silent actions wired. `window.prompt` mechanics stay.
3. `reports/ReportsWorkspacePage.tsx` — save view + export CSV success toasts;
   export not-READY → `toast.warning` (file will appear in history); defer
   `URL.revokeObjectURL` (`setTimeout(..., 0)` or revoke in a follow-up tick)
   per plan §2.7.
4. `workflow/WorkflowPages.tsx` — all 11 silent actions (enable template,
   rule toggle, save draft, replay, snooze, complete, cancel task, replay DLQ,
   ignore DLQ, create webhook, webhook toggle) → success toasts. Webhook create
   copy must confirm the secret was stored.
5. `crm` — CrmPages 11 actions, CustomersPrototypePage save/archive/merge/link,
   BookingsPrototypePage save/cancel/done/no-show/reschedule (buffer select is
   auto-save → no toast), Customer360 erase keeps its inline done-state (has
   counts) — no toast. Unmounted files (BroadcastPage, BroadcastPrototypePage)
   untouched.
6. `crm-inbox` — InboxPrototypePage: ส่งข้อความ/บันทึกโน้ต succeed via bubble —
   no toast; status/priority/auto-reply/tags/assign/deal/task/quotation →
   success toasts; keep inline errors. InboxAiPanel copy/feedback inline states
   stay (already explicit). LineOaSettingsPage: connect + disable get success
   toasts; existing notice banners stay.
7. `ai-suggestions` — validate/create-draft/regenerate/dismiss → success
   toasts; request modal keeps its done-panel.
8. `dashboard-notifications` — keep optimistic UI and the `.catch` swallows
   (seam now toasts the failure); `อ่านทั้งหมด` and rule/channel toggles get
   success toasts; quiet-hours blur-save gets NO success toast (auto-save rule)
   — errors surface via seam.

Gate: same three commands.

## Phase 4 — Auth/settings/system rollout + e2e authoring

Scope: `apps/web/src/features/{branch-settings,employee-access,system-onboarding,system-partners}` remainder + e2e spec (author only — DO NOT run e2e).

1. `branch-settings/BranchSettingsPage.tsx` — create/edit → success toasts.
2. `employee-access` — AddEmployeePrototypePage: draft save advances the wizard
   (own panel — no toast) but `finishEmployee` gets
   `toast.success('เปิดใช้งานพนักงานเรียบร้อยแล้ว')`; IndividualPermissions
   keeps its transient "บันทึกแล้ว" AND adds no toast (already explicit,
   avoid double) EXCEPT delete-employee →
   `toast.success('ปิดการใช้งานพนักงานเรียบร้อยแล้ว')`; PermissionMatrix create/
   update/disable role → success toasts; DiscountPolicyPage +
   PoApprovalSettingsPage: keep ✓ button swap, remove the bare `catch {}`
   swallow so the seam toast fires and keep their inline error banners showing
   `apiErrorMessage(e)` instead of the hardcoded string.
3. `system-onboarding/SystemOnboardingNewPage.tsx` — uses raw `authedFetch`
   (Response variant) so the seam does NOT cover it; leave its manual error
   handling; add success toasts for the two maintenance actions next to their
   result cards? NO — result cards are the explicit feedback; instead only add
   `.catch(() => undefined)` on the clipboard promise at `:78`. No other change.
4. `system-partners` — after Phase 1 all four pages already use `useToast`;
   sweep for any silent action remaining (reveal-password `:338` stays silent —
   audited decision).
5. E2E authoring (write, do not execute): `e2e/toast-feedback.spec.ts` (specs
   live flat in `e2e/`, NOT in a tests/ subdir) using `test/expect` from
   `./harness/fixtures` (`authedPage`, `companyId`) — copy the shape of
   `e2e/_reference.spec.ts`.
   - TOAST-01: goto `/companies/${companyId}/settings/notifications`, click the
     first channel toggle, expect `[role="status"]` toast containing
     บันทึก; click it again (restore state), expect a second toast.
   - TOAST-02: `page.route('**/api/v1/**', route => route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'ทดสอบข้อผิดพลาด' }) }) : route.fallback())`
     then trigger any save on the same page; expect `[role="alert"]` toast with
     the Thai fallback text (`ทดสอบข้อผิดพลาด` passes through `apiErrorMessage`
     unchanged — verify against its logic and adjust the assertion if the
     mapper rewrites it).
   - Default locale is Thai; navigate by URL, never by nav labels.
6. Final sweep: run the `no-local-toast.spec.ts` lint spec; grep for remaining
   `setTimeout(() => setToast` drivers — must be zero.

Gate: same three commands. Report any file where you decided copy yourself so
the reviewer can check tone.

## Phase 5 — Themed dialogs replace window.prompt + missing confirms + PO settings dead buttons

Impact survey already done by the harness (2026-08-07). Facts you may rely on:
no e2e spec registers a `page.on('dialog')` handler and none clicks any
prompt-gated button; every affected API already accepts the reason/note param;
`PoApprovalRule.id` in contracts is a plain `string` and the backend
`validatePoApprovalPolicy` accepts ANY contiguous rule list whose last tier is
open-ended (`apps/api/src/modules/employee-access/domain/logic/business-policy.logic.ts:15`)
— do NOT touch contracts or backend.

### 5.1 New shared hook `useInputPrompt`

`apps/web/src/common/components/modal/use-input-prompt.tsx`, sibling of
`use-confirm.tsx` — copy its structure exactly (pending state, every exit path
settles, Modal size sm, Button footer). API:

```ts
type InputPromptRequest = {
  title?: ReactNode;          // default 'กรอกข้อมูล'
  message?: ReactNode;        // optional helper line above the field
  label: string;              // field label + aria-label
  placeholder?: string;
  confirmLabel?: string;      // default 'ยืนยัน'
  cancelLabel?: string;       // default 'ยกเลิก'
  variant?: 'danger' | 'primary';  // default 'danger' (these are mostly destructive reasons)
  required?: boolean;         // default true → confirm disabled until trim non-empty
  multiline?: boolean;        // default true (textarea rows=3); false → <input>
  inputMode?: 'text' | 'numeric';
  initialValue?: string;
};
useInputPrompt(): { promptInput: (req: InputPromptRequest) => Promise<string | null>; inputPromptDialog: ReactNode }
```

Resolve with the trimmed value on confirm, `null` on cancel/backdrop/Escape.
Use `mangmee-input` class for the field. Export from the modal barrel
`index.ts`. Add `use-input-prompt.spec.ts` (render via `renderToStaticMarkup`
following `Field.spec.ts` idiom: assert label, required-disables-confirm
initial state, danger button class) plus a logic-free settle test is NOT
required (hooks with timers/state are out of unit scope here).

### 5.2 Replace every live `window.prompt` (13 buttons / 14 prompts)

Grep `window.prompt` under `apps/web/src/features` — current sites:
CrmPages.tsx:223/:364/:375 (reuse the existing i18n keys
`customers.disqualify_reason_prompt` / `lost_reason_prompt` /
`won_reason_prompt` / `log_activity_prompt` as the dialog `label` via
`t(...)`); StatementImportPanel.tsx:142; BankingPages.tsx:288/:382-383/:388;
MatchingPanel.tsx:99; AccountsPayablePages.tsx:353/:356/:581;
LineOaSettingsPage.tsx:349; ProcurementPages.tsx:135/:247.

Conversion pattern — keep the exact control flow (`cancel/empty → abort, no
toast`), handlers become async where needed:

```ts
const reason = await promptInput({ title: 'ปฏิเสธใบขอซื้อ', label: 'เหตุผลปฏิเสธ' });
if (!reason) return;
action(pr.id, () => rejectPurchaseRequest(companyId, pr.id, reason), 'ปฏิเสธใบขอซื้อเรียบร้อยแล้ว');
```

Titles: short verb phrase from the button (ปฏิเสธบิล, ยกเลิกใบรับสินค้า,
เปิดรอบกระทบยอดใหม่, ข้ามรายการนี้, ปิดการใช้งานช่องทาง, …). Banking
approve-adjustment keeps two sequential prompts (`multiline: false`, labels
บัญชีเดบิต / บัญชีเครดิต, variant 'primary'); abort if either is empty.
Render `{inputPromptDialog}` once per page/panel that uses the hook. CRM keys:
also pass the English label when locale is en (the `t()` call already does).

### 5.3 Missing confirmations (useConfirm, existing hook)

- `ledger/LedgerReportsPage.tsx` ปิดงวด button → `if (!(await confirm({ title: 'ปิดงวดบัญชี', message: 'เมื่อปิดงวดแล้วจะไม่สามารถบันทึกหรือแก้ไขรายการในงวดนี้ได้ ยืนยันการปิดงวดใช่หรือไม่' })))` before the existing call.
- `tax/TaxCodeSettingsPage.tsx` Retire button → confirm danger: 'เลิกใช้งาน Tax Profile นี้ใช่หรือไม่'.
- `workflow/WorkflowPages.tsx` ยกเลิก task button → confirm danger: 'ยกเลิกงานนี้ใช่หรือไม่'.
- `accounting-documents/AccountingPages.tsx`: the reject and void actions
  currently send HARDCODED English reasons ('Rejected in accounting
  workspace', hardcoded void reason). Replace both with `useInputPrompt`
  (reject → label 'เหตุผลปฏิเสธ'; void → title 'ยกเลิกเอกสาร', label
  'เหตุผลยกเลิกเอกสาร') and pass the user's text to `rejectQuotation` /
  `voidDocument`. Approve keeps its optional note as-is (no dialog).

### 5.4 PoApprovalSettingsPage — wire the two dead buttons

`apps/web/src/features/employee-access/PoApprovalSettingsPage.tsx` +
`po-approval-settings.model.ts`. Constraints: contiguous tiers, last tier
open-ended, ≥1 rule (backend). Known pre-existing bugs to fix WHILE wiring
(all web-only):

1. The load merge `PO_APPROVAL_RULES[index]!` crashes when the server returns
   ≠3 rules. Replace the demo-index merge with metadata DERIVED from the rule
   data: `conditionLabel` from bounds (`ยอดไม่เกิน` when no minExclusive /
   `มากกว่า ฿X ถึง` / `มากกว่า ฿X` when open-ended), `inputValue` from
   maxInclusive, `badgeLabel` from approverRoleKeys (empty → 'Auto approve';
   1 role → the role; N roles → `คนใดคนหนึ่งใน N`), tones cycled from a small
   palette array by index. Extend the model with these pure helpers so they
   are testable; KEEP `PO_APPROVAL_RULES` as the fallback default and keep
   existing exported function signatures backward-compatible (add an optional
   `rules: PoApprovalRule[] = PO_APPROVAL_RULES` param) so
   `po-approval-settings.model.spec.ts` keeps passing — extend that spec for
   the new helpers (derive labels, split/remove re-stitching).
2. `setSaved(false)` after a successful load opens the page dirty. Load →
   `setSaved(true)`; any add/remove flips it false.
3. The ทดลองเงื่อนไข simulator evaluates the static demo rules, not the loaded
   policy — pass the live rules into `getPoApprovalDemo` via the new optional
   param.

Buttons:
- "+ เพิ่มขั้นอนุมัติ" → `promptInput({ title: 'เพิ่มขั้นอนุมัติ', label: 'วงเงินสูงสุดของขั้นใหม่ (บาท)', multiline: false, inputMode: 'numeric', variant: 'primary' })`,
  parse via existing `parseApprovalAmount`; reject (inline error) when the
  amount does not fall strictly inside the last open-ended tier
  (≤ previous tier's max). Split the open-ended tier: new tier
  `[prevMax+ε bound rules use minExclusive=prevMax, maxInclusive=amount]`
  inheriting the open-ended tier's approverRoleKeys; the open-ended tier
  becomes `minExclusive=amount`. Renumber steps. Mark dirty. No toast (local
  edit only; บันทึก persists and already has the ✓ swap + seam errors).
- "ลบขั้นอนุมัติ N" (per row) → `confirm` danger; on yes remove the tier and
  re-stitch contiguity: the NEXT tier inherits the removed tier's
  `minExclusive` (removing the last open-ended tier → the previous tier drops
  its `maxInclusive` and becomes open-ended). Block removing the only rule
  (disable the button when rules.length === 1). Renumber steps. Mark dirty.

Layout: keep the row/heading structure (sidebar-nav + responsive e2e visit
this page — no structural rewrites, just handlers + derived labels).

### 5.5 Out of scope for this phase

No optimistic-rollback work in notifications; no approver-picker for the
pencil affordance; no backend/contract edits; do not touch e2e specs.

Gate: the standard three commands. Also run
`node --import tsx --test src/features/employee-access/po-approval-settings.model.spec.ts`
from `apps/web` explicitly and report its counts. Deviations section required.

## Phase 6 — Sidebar active-state fix + stale e2e spec refresh

Owner decision 2026-08-07: `/settings/line-oa` lives under the พนักงาน/สิทธิ์
(roles) parent — it ALREADY does (`web-core-workspace.logic.ts` roles block,
children `['roles.permissions','roles.individual','employees','poapproval','discount','lineoa']`);
do not move any menu entry. The real defect, diagnosed from Playwright traces:
the settings submenu's "ภาพรวมการตั้งค่า" child (href = the `/settings` index)
prefix-matches EVERY `/settings/*` child route owned by another parent, so two
rows light at once (`/settings/line-oa` → roles' lineoa child + ภาพรวม;
`/settings/permissions` → roles.permissions + ภาพรวม). The longest-match guard
in `isActiveNavSubItem` only inspects same-parent siblings.

### 6.1 Cross-parent longest match (the app fix)

`apps/web/src/common/components/app-shell/app-sidebar.logic.ts` —
`isActiveNavSubItem(pathname, activeKey, sub, candidates)`: keep the
`sub.key === activeKey` clause; for the path clause, suppress when ANY
candidate (not just same-parent siblings) has a strictly longer href that
matches the pathname. In `AppSidebar.tsx`, build the candidate list once per
render — every sub-item across ALL nav items (`navItems.flatMap(n => n.subItems ?? [])`)
— and pass it at both call sites (`:151` and inside
`shouldSubmenuOpenForRoute`). Do NOT change `isActiveItem` (its
child-owns-route suppression at `:143` already keeps parents dark).
Expected behavior after fix: `/settings` → only ภาพรวมการตั้งค่า lit;
`/settings/line-oa` → only the roles lineoa child; `/settings/permissions` →
only บทบาทและสิทธิ์; every NAV-03 route → exactly one row.
Update `AppSidebar.spec.ts` with cross-parent cases (line-oa, permissions,
`/settings` exact) alongside the existing sibling case.

### 6.2 Dead config tidy

`settings-menu.logic.ts` `SETTINGS_SIDEBAR_KEYS` still lists `'security'` but
no `SETTINGS_MENU_ITEMS` entry with that key exists (the account-security
screen was parked 2026-08-05, commit 28117ca9) — remove the dead key. Adjust
`settings-menu.logic.spec.ts` only if it asserts that list.

### 6.3 Stale e2e specs → current intended behavior (edit e2e/ THIS phase)

1. `e2e/settings.spec.ts` SET-01: the hub now has `<h1>ตั้งค่า</h1>` plus the
   `<h2>การตั้งค่าขั้นสูง</h2>` section (settings consolidation) — the loose
   regex heading locator hits both (strict-mode violation). Use
   `getByRole('heading', { name: 'ตั้งค่า', exact: true })` and additionally
   assert `getByRole('heading', { name: 'การตั้งค่าขั้นสูง' })` is visible.
2. SET-03A: the LIFF link assertion assumes `LINE_LIFF_ID` is configured; the
   local API intentionally falls back to
   `<apiBase>/auth/line/link-page/employee?token=…`
   (`apps/api/.../employee-access.logic.ts:131`). Accept both shapes:
   `getByRole('link', { name: /liff\.line\.me|\/auth\/line\/link-page\// })`.
3. SET-07: `/settings/security` intentionally redirects to the dashboard
   (parked feature, commit 28117ca9). Rewrite the test to assert the redirect
   (`await expect(authedPage).toHaveURL(/\/dashboard/)`) and rename its title
   to say the screen is parked; keep the SET-07 id.
4. `e2e/sidebar-nav.spec.ts` NAV-02: `/settings` is now a submenu whose index
   is the ภาพรวมการตั้งค่า child; the parent row stays dark by design. Expect
   `top` empty and `sub` = exactly one entry containing ภาพรวมการตั้งค่า.
   NAV-01 and NAV-03 must pass UNCHANGED after 6.1 — do not edit them.

### 6.4 Out of scope

No menu reordering, no changes to WORKSPACE_MODULES, no other e2e files, no
`window.confirm` work. E2E must not be RUN in your sandbox (author only).

Gate: the standard three commands (typecheck / full unit suite ≥753 pass 0
fail / IS_WEBPACK_TEST=1 build). Deviations section required.

## Dispute protocol

If a phase instruction contradicts what you find in the code (line drift,
already-fixed site, signature conflict), do the smallest correct adaptation,
note it in your final report under "Deviations", and continue. Only stop if
the contradiction makes the phase TypeScript-unbuildable.
