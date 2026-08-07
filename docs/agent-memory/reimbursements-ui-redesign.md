# Agent Memory: reimbursements-ui-redesign

Status: implemented and verified — pending a visual click-through by the user
Owner: main thread (design + verification), Codex (implementation)
Scope: `apps/web` only — `การเบิกจ่ายและอนุมัติ` page (`ReimbursementsHubPage` and its four
queues, detail drawer, and modals). Visual/UX only. No API, no Prisma, no `packages/contracts`.

## Problem

`apps/web/src/features/reimbursements/ReimbursementsPages.tsx` predates the มั่งมี design system.
Every other workspace page (expenses, CRM, roles) renders through `MangmeePage` / `MangmeeCard` /
`mangmee-*` classes; this one is hand-rolled Tailwind. The flow itself is correct and user-tested —
only the presentation is off-system.

Audit of what is off-system or off-principle:

| # | Issue | Where |
|---|---|---|
| 1 | Bare `<h1>` + English subtitle in a `p-6` div instead of `MangmeePage` (eyebrow/title/description) | L131–135 |
| 2 | Underline tab bar unique to this page; system pattern is `mangmee-segmented` + `mangmee-tab` | L136–143 |
| 3 | No overview at all — the user lands straight on a raw table with no sense of what is waiting on them | all four tabs |
| 4 | Raw `<table>` with hand-rolled headers, `rounded border` (not `rounded-2xl`, no shadow), not inside a card; `.mangmee-table` + `MangmeeCard` exist | L345, L599, L657 |
| 5 | Bespoke `STATUS_BADGE_COLORS` (`bg-yellow-100`…) instead of `MangmeeBadge` tones | model L37, page L47 |
| 6 | Hand-rolled buttons (`rounded bg-green-600 px-3 py-2`) — wrong radius, height and border vs `mangmee-btn-*` | L29–31 |
| 7 | `window.prompt()` for the rejection reason — browser-native, pop-up-blockable, no validation feedback | L550, L619 |
| 8 | Create form is a `bg-gray-50` block with an 8-column table of raw inputs incl. a file input per row — cramped, unreadable below ~1200px | L283–341 |
| 9 | Detail drawer is a flat 12-row `<dl>`: the claim total has the same visual weight as `ซ้ำ: NO_MATCH`; actions sit mid-scroll | L425–438, L545 |
| 10 | Raw enums leak to the user: `receiptRequirementStatus`, `duplicateStatus`, approval-step `status` | L435, L437, L559 |
| 11 | `กำลังโหลด...` plain text; one-line gray empty states — `LoadingState` / `EmptyState` exist | L344, L351, L598 |
| 12 | No filter or search on any queue | all three queues |

## Decisions

- **D1 — Tabs stay on-page**, restyled to `mangmee-segmented`. Rejected moving them into the sidebar
  sub-menu (as expenses did) because it needs four new routes plus `?tab=` / `?focus=` deep-link
  redirects, and the user's hard constraint is not to disturb a flow they have already tested.
  *(User decision, 2026-07-28.)*
- **D2 — Reuse `ExpensesUi.tsx` primitives rather than adding a `ReimbursementsUi.tsx`.** The feature
  already imports from `../expenses/*` (`removeLightBackground`, `getAttachmentDownloadUrl`,
  `resolveUploadUrl`), so this is an established seam and guarantees pixel-identical KPI cards,
  banners and buttons. Only `StatusBadge` stays local — it must read `REQUEST_STATUS_LABELS`.
- **D3 — All four requested UX fixes are in scope** (user decision, 2026-07-28): reject dialog
  replacing `window.prompt`, per-queue KPI cards, status chips + search, two-column create form with a
  sticky total card.
- **D4 — KPI figures are computed client-side** from data each queue already loads. No new API call,
  no new endpoint, no change to any request.
- **D5 — i18n is explicitly out of scope.** This feature is 100% hardcoded Thai today and the redesign
  keeps it that way. Routing it through `workspace-dictionary` is a separate, larger task; doing it
  here would balloon the diff and add regression risk to a tested flow. Recorded as a follow-up.
- **D6 — Money formatting.** Table cells keep today's `formatMoney(x) {currency}` untouched. Only the
  new KPI cards use `baht0()` (`฿12,400`), which is safe because the create form hard-locks currency
  to THB.

## Non-negotiable invariants (the flow the user tested)

Every one of these must survive unchanged; they are restated as constraints in the handoff:

- Tab visibility gating (`visibleHubTabs`), `parseHubTab`, the `?tab=` initial-tab-only rule, and the
  `?focus=<id>` deep link that opens the drawer.
- The drawer's Escape handler firing only when it is the topmost layer, and the print/signature/payment
  dialogs being **siblings** of the drawer, not children.
- `drawerAction`'s refresh-both-drawer-and-queue behaviour, and `refreshKey` propagation.
- Every API call, payload shape, permission gate, `approvalSnapshotHash` / `claimSignatureAckHash`
  passing, and the `canApprove` / `canFinanceApprove` / `canPay` / `isDraft` context conditions.
- The create form's partial-failure path (draft created but attachment upload failed).
- `validateRequestForm` / `validatePaymentForm` call sites and their messages.
- Rejection still requires a non-empty trimmed reason before `rejectReimbursement` is called.

## Artifacts

- Decision record: this file
- Implementation spec: `docs/agent-memory/reimbursements-ui-redesign.handoff.md`
- Codex report (expected): `docs/agent-memory/reimbursements-ui-redesign.results.md`

## Verification

Planned (recorded with real output in the results file):
`corepack pnpm --filter @watchdog-bms/web typecheck | lint | test`, plus new unit tests for the status
tone map and the queue-summary helper.

## Open questions

None blocking.

## Next

1. Codex implements against the handoff.
2. Main thread reviews the diff against the invariants above and re-runs verification.

## Follow-ups (not this task)

- Route this feature's Thai copy through `workspace-dictionary` (th + en), as expenses now does.
- Consider the sidebar sub-menu treatment (D1) once the deep-link redirects can be tested.
