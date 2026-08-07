# Global Toast Feedback System — Plan

Status: APPROVED FOR IMPLEMENTATION (Codex executor)
Date: 2026-08-07
Branch: `20260804` (tree `WatchDog-BMS`)
Owner: Claude (harness engineer) + Codex CLI (executor)
Thai summary: `Doc/global-toast-feedback-summary-th.md`
Task memory: `docs/agent-memory/global-toast-feedback.md`

## 1. Problem

A full-system audit (2026-08-07, all 24 feature modules) found **~287 user-facing
mutation actions; ~182 (~63%) give no success feedback at all** — the dominant
"success signal" is a silent list refetch or a modal closing. Error feedback is
near-universal but inconsistent (4 duplicated local toast components, ~15 local
`ErrorBanner` re-declarations, 11 call sites that swallow errors entirely so a
failed write looks identical to a successful one).

Product requirement (owner, 2026-08-07): every action button (save / cancel /
delete / submit / approve / …) must show a toast on completion —
**success = pastel green, warning = pastel yellow, error = pastel red** —
consistently, system-wide.

### Audit snapshot (mounted routes only)

| Module group | Mutations | No success feedback |
|---|---|---|
| Finance (expenses, reimbursements, AP, accounting-documents, tax-setup, tax, banking, ledger) | ~146 | ~93 (64%) |
| Ops (inventory, procurement, reports, workflow) | 28 | 22 (79%) |
| CRM (crm, crm-inbox, ai-suggestions, dashboard-notifications) | 65 | 46 (71%) |
| Auth/settings/system (auth, employee-access, branch-settings, system-onboarding, system-partners, …) | 48 | 21 (44%) |

Worst offenders: `accounting-documents` (13/13 silent), `dashboard-notifications`
(6 sites swallow errors while optimistic UI claims success), `AccountingPages.tsx`
approve/reject/void with hardcoded English reasons and zero feedback.

Existing toast implementations (all feature-local, to be replaced):
- `ActionToast` — `apps/web/src/features/expenses/ExpensesPages.tsx:83` (tones success|warning, `aria-live="polite"`, bottom-center, `z-[100000]`, 4 s). The best one; used by exactly 1 file / 2 actions.
- `Toast` — byte-identical copies in `system-partners/SharedLineSettingsPage.tsx:24`, `PlatformAiBudgetPage.tsx:13`, `PartnerDetailPage.tsx:129` (raw `green-*`/`red-*` classes = token-illegal, `z-50` = renders **under** modals, no aria-live, timer never cleared).

## 2. Design

### 2.1 Placement & files (all new code in `apps/web/src/common/`)

```
apps/web/src/common/feedback/toast-bus.ts          # framework-free pub/sub (no React)
apps/web/src/common/components/toast/
  toast.model.ts        # ToastTone, ToastItem, options
  toast.logic.ts        # pure queue reducer + timer plan (injectable clock) — unit-testable
  Toast.tsx             # presentational pill (one toast)
  ToastProvider.tsx     # 'use client'; context + portal + bus subscription
  use-toast.ts          # useToast() hook
  toast.logic.spec.ts   # queue/cap/dedup/duration specs
  toast-render.spec.ts  # renderToStaticMarkup: tone classes + aria contract
  index.ts              # barrel
```

Mount: `apps/web/app/layout.tsx` — root layout stays a server component; wrap
`{children}` with `<ToastProvider>` (a client component with a children slot).
Root mount is required because `/system/*`, `/login`, and the workspace tree are
separate layout branches; 3 of the 4 legacy toasts live under `/system/*`.

### 2.2 Visual spec (matches existing `ActionToast` idiom + registered tokens only)

Container: `fixed inset-x-0 bottom-6 z-[100000] flex flex-col items-center gap-2 px-4 pointer-events-none`
(bottom-center like `ActionToast`; `z-[100000]` sits above `Modal`'s `z-[99999]` —
the legacy `z-50` toasts render under modals, which this fixes).

Pill: `pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-lg`

| Tone | Classes (registered shades only — see constraint) | Icon | Auto-dismiss |
|---|---|---|---|
| success | `border-brand-100 bg-success-50 text-success-700` | ✓ | 4 s |
| warning | `border-warning-100 bg-warning-50 text-warning-700` | ⚠ | 4 s |
| error | `border-error-500/20 bg-error-50 text-error-700` | ✕ | 6 s |

Values: `success-50 #ecfdf3` (pastel green), `warning-50 #fffaeb` (pastel yellow),
`error-50 #fef3f2` (pastel red) — from `packages/design-tokens/generated/web/theme.css`.

Constraint: `@theme` in `apps/web/app/globals.css` registers **only**
`success-50/500/600/700`, `warning-50/100/500/600/700`, `error-50/500/700`.
There is **no `success-100` / `error-100`** — an unregistered shade silently
generates nothing. Success border therefore uses `brand-100` (`#dcfce7`, same
green family — the proven `ActionToast` workaround) and error border uses the
Tailwind v4 opacity modifier `error-500/20`. Verify the `/20` modifier renders
in the build; fallback is inline `style={{ borderColor: 'color-mix(in srgb, var(--color-error-500) 20%, transparent)' }}`.

Behavior:
- Stack max **3** visible (oldest dropped), newest at bottom.
- Every toast dismissible by click + explicit ✕ button (`aria-label="ปิดการแจ้งเตือน"`).
- Dedup: identical `tone+message` arriving within 1 s collapses into one (guards double-fire from seam + caller).
- Timers keyed by toast id — must NOT restart on parent re-render (known bug in `ActionToast`'s `[toast, onDone]` dep array).
- a11y: success/warning → `role="status"` (implicit polite); error → `role="alert"`.
- Motion: enter/exit transition gated behind `@media (prefers-reduced-motion: no-preference)` (follow the `login-floaty` precedent in `globals.css`).
- SSR: portal to `document.body` with `typeof document === 'undefined'` guard (follow `Modal.tsx:99`).

### 2.3 API

```ts
const toast = useToast();
toast.success('บันทึกข้อมูลเรียบร้อยแล้ว');
toast.warning('ไม่มีข้อมูลในช่วงเวลาที่เลือก');
toast.error(err);       // unknown → apiErrorMessage(err); string passes through
```

`useToast()` throws outside the provider (follow `SidebarContext.tsx:21` idiom).
`toast.error` maps via the existing `apiErrorMessage` in
`apps/web/src/common/api/api-error-message.ts:256` (never returns empty; Thai).

### 2.4 Automatic error toasts at the fetch seam (100% error coverage)

`authedApiFetch` (`apps/web/src/common/api/authed-fetch.ts:122`) is the single
mutation seam for every module. On `!res.ok` **and** method is
POST/PUT/PATCH/DELETE **and** running in the browser, it emits the built error
through `toast-bus` **before throwing**. The provider subscribes and shows a
red toast with `apiErrorMessage(error)`.

- Opt-out per call: `authedApiFetch(path, { …init, suppressErrorToast: true })` —
  extend the init type as `RequestInit & { suppressErrorToast?: boolean }`
  (strip the flag before `fetch`). Needed for flows with their own full error UX
  (e.g. duplicate-customer 409 flows that open a resolution panel).
- GET errors do NOT toast (pages own their load-error states).
- The bus lives in `common/feedback/` (no React import) so the api layer never
  imports from `components/`.
- Consequence: the 11 swallowed-error sites (`NotificationPages.tsx:49,54,59,270`,
  `NotificationBell.tsx:55,61`, `InboxPrototypePage.tsx:302,358`,
  `AddEmployeePrototypePage.tsx:475`, `DiscountPolicyPage.tsx:122`,
  `PoApprovalSettingsPage.tsx:128`) surface errors with zero per-site changes.
- Rule for call sites from now on: **do not call `toast.error` for API errors** —
  the seam already did. Keep inline `ErrorBanner`s where they exist (persistent
  detail near the form); add `toast.success` / `toast.warning` only.

### 2.5 Success/warning wiring rules (per call site)

1. Server mutation succeeded → `toast.success(<copy>)`. Copy = formal Thai,
   verb-first, pattern `<กริยา><กรรม>เรียบร้อยแล้ว` derived from the button's
   own label (e.g. บันทึกข้อมูลเรียบร้อยแล้ว, ลบรายการเรียบร้อยแล้ว,
   ส่งขออนุมัติเรียบร้อยแล้ว, อนุมัติรายการเรียบร้อยแล้ว). No emoji, no casual
   particles. `/system/*` pages that are English today keep English copy
   ("Saved successfully." style).
2. Completed with caveats / nothing to do → `toast.warning`
   (e.g. 0-row export, stock-count no-op, draft saved but attachment failed,
   duplicate suspected).
3. Pure client-side actions (closing a modal, clearing a form, tab switch,
   copy-to-clipboard with an inline "คัดลอกแล้ว" swap) do NOT toast.
4. Redirect-as-success flows (create→detail redirect, login, change-password)
   keep the redirect; no toast across a full page load. Do not build a
   sessionStorage handoff.
5. Auto-save-on-blur/change sites keep their existing banners; no success toast
   per keystroke (noise). Errors covered by the seam.
6. Where a success InfoBanner exists purely as "done" text with no extra info
   and is set by a shared helper (e.g. expenses `run(fn, doneText)`), switch the
   helper to `toast.success(doneText)`. Banners that carry follow-up detail
   (counts, temp passwords, next steps) stay as panels/banners — add no toast.
7. Helpers with no success branch (`doAction`/`action(id, fn)` copies in
   ExpenseReviewPage:147, banking:76, reimbursements:496/:1148, AP:282,
   procurement ×3, workflow) gain an optional `successMessage` param; call
   sites pass copy.

### 2.6 Legacy toast migration (Phase 1)

- `ExpenseReviewPage` drops `ActionToast`/`ToastState` imports → `useToast`.
  Delete `ActionToast` + `ToastState` from `ExpensesPages.tsx` (only importer).
- 3 × system-partners pages: delete local `Toast` + `showToast` driver.
  `PartnerDetailPage` keeps its `showToast(message, variant)` prop-drilling
  signature but the top-level implementation becomes an adapter over `useToast`
  (smallest diff; 6 sub-sections untouched).
- Add a source-lint spec (idiom: `mangmee-interactive-theme.spec.ts:17`) that
  walks `apps/web/src/features/**/*.tsx` and fails on `function Toast(` /
  `function ActionToast(` so local toasts can never come back.

### 2.7 Known bugs fixed alongside (feedback-adjacent, small diffs)

- `InventoryPages.tsx:328` — whole-page error takeover on save failure discards
  the form; becomes inline banner + keep form rendered.
- `InventoryPages.tsx:310/:436/:602` — `event.currentTarget.reset()` after
  `await` (null under React 19); capture the form element before awaiting.
- `InventoryPages.tsx:298/:320` — stale success message never cleared.
- `InventoryPages.tsx:54` local `errorMessage` → shared `apiErrorMessage`
  (fixes English leaking into Thai screens).
- `ReportsWorkspacePage.tsx:71-79` — `URL.revokeObjectURL` fires synchronously
  after `click()`, can abort the CSV download; defer revoke.
- `AccountsPayablePages.tsx:87/:167` — tone-less shared `<p>` renders success
  and errors identically; success moves to toast, `<p>` stays error-only.

### 2.8 Follow-up scope (Phase 5, added 2026-08-07 on owner request)

Now IN scope as Phase 5 (see handoff §5.1–5.4): shared `useInputPrompt` dialog
replacing all 13 live `window.prompt` buttons; missing confirms (ledger
ปิดงวด, tax retire, workflow cancel-task, accounting-documents reject/void —
the latter two also stop sending hardcoded English reasons); PoApproval
settings dead add/remove-step buttons wired with derived row metadata (also
fixes the ≠3-rules crash, dirty-tracking, and the simulator evaluating demo
rules instead of the live policy).

Impact survey (harness, pre-implementation): no e2e `page.on('dialog')`
handlers exist and no spec clicks a prompt-gated button; sidebar-nav +
responsive e2e only visit `/settings/po-approval` (layout preserved); all
affected APIs already accept the reason/note; contracts/backend accept
variable PO rule counts — no contract/backend change.

Still out of scope:
- Optimistic-UI rollback in dashboard-notifications.
- Approver-picker for the PO page's decorative pencil affordance.
- Dead modules (BroadcastPage, InboxPage, EmployeeAccessWorkspacePage,
  platform-foundation, account-security route) — not wired, not migrated.
- Login/forgot-password/change-password inline banners (already correct,
  redirect flows).

## 3. Testing

- Unit (Codex, per phase; host re-runs as the authoritative gate):
  `toast.logic.spec.ts` (add/cap/dedup/durations, injectable clock),
  `toast-render.spec.ts` (tone classes incl. pastel bgs, `role`/`aria` contract,
  ✕ button) via `renderToStaticMarkup` — **`.spec.ts` only; the test glob does
  not match `.spec.tsx`**. Seam spec extends `authed-fetch.spec.ts` scripted
  `fetchImpl`: POST 500 → bus emits; GET 500 → no emit; `suppressErrorToast` →
  no emit; emits before throw.
- Source-lint spec (2.6) keeps the system closed.
- Baseline: **740 tests / 740 pass** on branch `20260804` (after
  `corepack pnpm --filter @watchdog-bms/contracts build` — dist was stale on
  2026-08-07 and `web-core-workspace.spec.ts:522` failed until rebuilt; that
  fix is a build step, not a code change).
- E2E (host only — Codex sandbox cannot reach postgres): new
  `e2e/tests/toast-feedback.spec.ts` — (1) real success path: toggle a
  notification channel preference twice on `/settings/notifications`, expect a
  green toast each time; (2) error path: `page.route` intercept `POST
  /api/v1/**` → 500 `{ message: 'ทดสอบข้อผิดพลาด' }`, click a save button,
  expect a red `role="alert"` toast. Codex authors the spec in Phase 4;
  the host runs it.

## 4. Rollout phases (Codex; each phase TypeScript-atomic, gates in handoff)

1. **Foundation** — toast system + root mount + seam hook + legacy migration + specs.
2. **Finance rollout** — expenses, reimbursements, accounts-payable,
   accounting-documents, accounting-tax-setup, tax, banking, ledger (+ 2.7 AP/reports fixes).
3. **Ops + CRM rollout** — inventory (+ 2.7 fixes), procurement, reports,
   workflow, crm, crm-inbox, ai-suggestions, dashboard-notifications.
4. **Auth/settings/system rollout** — branch-settings, employee-access,
   system-onboarding, system-partners remainder, LINE-OA settings + e2e spec authoring
   + final lint sweep.

Execution details, per-phase file lists, copy rules, environment quirks, and
gates: `docs/plans/global-toast-feedback-codex-handoff.md`.
