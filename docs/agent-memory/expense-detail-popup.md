# Agent Memory: expense detail → popup dialog with accountant checklist

Status: Implemented + adversarially reviewed + verified end to end (2026-07-26). Uncommitted; applied to all three worktrees.

Owner: Expenses web UX.

Scope: `/companies/:id/expenses` list tab. Clicking a row now opens `ExpenseDetailModal` (popup) instead of rendering a right-hand panel; the list table is full width.

Design (per owner direction: single page inside the popup, no tabs, small screens must work):
- Modal `size="xl"` (≈1180px, capped `max-h-[calc(100dvh-2rem)]`), sticky header (number + vendor + status badges) and sticky footer (status-dependent actions, logic moved verbatim from the old panel).
- lg+: two panes — left inline document viewer (img/pdf iframe from lazy signed URLs, prev/next, ↻ reload, เปิดเต็มจอ), right a single scrollable column. <lg: viewer pane hidden (`hidden lg:flex`), compact attachment rows shown instead (`lg:hidden`).
- Right column: sticky chip nav (ตรวจความครบถ้วน · ยอดเงิน · ผู้ขายและรายการ · หลักฐานภาษีและเอกสาร · การชำระเงิน) scrolling to sections with `scroll-mt-24`.
- NEW `deriveExpenseAuditChecks()` in `expenses.model.ts` — accountant checklist (สรุปการตรวจ): 13-digit vendor tax id (digits-only compare, dashed ids pass), vendor name, doc number, doc date, VAT-vs-7% (info not warn when off — backend derives VAT from configured tax-code rates, so non-7% is a legitimate rate), tax evidence usability, duplicate flag. Spec: `expenses-audit.logic.spec.ts` (10 tests).
- Wording: "ฐานภาษี (ยอดก่อน VAT)", WHT-aware "ยอดที่ต้องชำระจริง (หลังหัก ณ ที่จ่าย)".
- `Modal.tsx`: `size 'xl'`, ReactNode title (div not h2), `bodyClassName`, per-instance `useId()` title id (two modals can coexist: detail + preview sibling — Esc closes only the focused preview), dialog is flex-col with scrollable body so short viewports never clip header/footer.

Process notes (harness-engineer run):
- Implementation delegated to a subagent from a written spec; then adversarial review by a second subagent; 10 findings, all fixed. HIGH: the subagent rewrote `ExpensesHubPage` from a stale buffer, dropping the `visibleTabs` permission gating and re-enabling the out-of-MVP1 `signatures` tab — restored verbatim from HEAD. Lesson: after any agent edit to a large file, diff the WHOLE file against HEAD, not just the feature region.
- e2e EXP-04 assertion updated for the renamed money-row label (`e2e/expenses.spec.ts`).
- Verification harness (Playwright vs dev web :3211 + local API :3011): 28 checks desktop/mobile + 3 short-viewport checks — all pass; screenshots reviewed by eye. Harness scripts in the session scratchpad (`verify-popup.mjs`, `verify-short-viewport.mjs`).
- Local verify stack recipe is in the user-level memory `local-dev-stack` (prisma regenerate gotcha, CORS for dev port, python env wrapper).

Verification:
- `apps/web` tsc --noEmit clean in 20260725 and WatchDog-BMS trees; audit spec 10/10 + existing model spec pass.
- Seeded an attachment onto EXP-LOCAL-0002 via upload-intent → PUT (minio) → receipt-uploads complete to prove the inline viewer with real signed URLs.

Next: none required. Optional later: English strings for the Thai-only checklist labels; virtualized viewer for expenses with many attachments (not needed at current volumes).
