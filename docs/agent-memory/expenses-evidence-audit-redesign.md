# Agent Memory: expenses-evidence-audit-redesign

Status: VERIFIED (harness) — 2026-07-26. All checklist items accepted; manual browser walk pending a running stack.
Owner: Claude (harness) → Codex (implementation)
Scope: apps/web only — `EvidencePanel`/`FolderBtn` in ExpensesWorkspacePanels.tsx + new evidence-audit.logic.ts(+spec). No API/contract changes; all anomaly signals computed from existing SharedEvidenceRow/Folder fields.
Decisions:
- Design method: dataviz skill (status colors reserved + icon/label never color-alone; emphasis on problem rows only; filters one labeled row above content; refetch keeps frame at reduced opacity). No charts — data's job is headline counts + scannable table.
- Anomaly model: warn flags (NO_FILE, TAX_NEEDS_REVIEW, NOT_TAX_EVIDENCE, NO_VENDOR) drive row state 'attention'; info flags (SUPPORTING_ONLY, NO_CATEGORY, LEGACY_NO_NUMBER) tooltip-only to avoid alarm fatigue.
- amber reserved for attention in this panel → มูลค่ารวม tile retoned indigo; attention KPI tile is clickable and toggles a client-side "เฉพาะรายการที่ต้องตรวจ" filter.
- Export UX: gradient action-card removed from KPI row; single primary "ส่งออกชุดเอกสารให้บัญชี" button right of the filter row; JSON manifest button relocated into the result banner with explanation (it already required packageResult).
- Folder sidebar uses formatThaiMonth + ⚠ when evidenceCount < expenseCount (fields previously fetched but unused).
- Thai literals kept (file's established style, no dictionary keys). Sanitization N/A (no free-text inputs).
- Working tree carries two prior verified uncommitted tasks (stepper-ux, ux-hardening) — Codex must not disturb.
Open questions: none blocking. (Server-side anomaly filter/pagination deliberately out of scope.)
Artifacts:
- docs/plans/expenses-evidence-audit-redesign-plan.md (EN plan + ASCII layout + flag table + acceptance checklist)
- docs/prompts/expenses-evidence-audit-redesign-codex-handoff.md (Codex prompt)
- ../Doc/expenses-evidence-audit-redesign-summary-th.md (Thai summary, outside repo)
Verification (planned protocol, harness re-runs independently):
- contracts build → web test (baseline 338/0 + new evidence-audit.logic.spec.ts) → typecheck → build
- full-diff review vs checklist; scope guard (only EvidencePanel/FolderBtn + new logic file + docs; no new deps)
- manual walk when stack up: attention tile toggle, badges/tooltips, folder ⚠, export relocation, keep-frame reload
Next: run Codex with the handoff prompt; on return, execute verification protocol and update Status (VERIFIED/REJECTED + evidence).

Implementation:
- A: Added `deriveEvidenceRowFlags`, `evidenceRowState`, `summarizeEvidenceRows`, and the shared tax-evidence tone map with node:test coverage for clean, warning, informational, combined, and summary cases.
- B1: KPI row now contains document, indigo total-value, and clickable amber attention tiles; the attention tile and checkbox share one client-side filter state.
- B2: Filters have explicit labels in one toolbar; the unchanged full-column export action moved right, and JSON manifest download moved into the result banner with expiry copy.
- B3: Folder rows use Thai month labels, counts, and an icon-plus-tooltip warning when evidence files are incomplete.
- B4: Rows show icon-plus-label audit state, warning-row emphasis, tax-evidence tone/reason tooltip, missing-file/vendor states, trailing affordance, and footer attention count.
- B5/B6: Refetch preserves the existing body at reduced opacity; first load retains the original loading line; HowItWorks copy now describes the audit flow.

Verification:
- `corepack pnpm --filter @watchdog-bms/contracts build` → exit 0.
- Targeted `evidence-audit.logic.spec.ts` → 5 tests, pass 5 / fail 0.
- `corepack pnpm --filter @watchdog-bms/web test` → 343 tests, 90 suites, pass 343 / fail 0 (baseline 338 + 5).
- `corepack pnpm --filter @watchdog-bms/web typecheck` → exit 0.
- `corepack pnpm --filter @watchdog-bms/web build` → exit 0; compiled in 3.4s and generated all routes. Existing `next.config.mjs` eslint-option warning remains non-blocking.

Deviations:
- None from the implementation plan.
- Manual browser walk was not run because the local Docker stack is stopped; harness should verify the pressed KPI tile, folder warning tooltip, row tooltips, refetch opacity, and downloads when the stack is available.

Harness re-verification (independent, 2026-07-26):
- Scope guard: git status/diff --stat — only ExpensesWorkspacePanels.tsx grew (90→197 changed lines) + new evidence-audit.logic.ts/.spec.ts; every other file's diff stat byte-identical to the previously verified state; hunk headers confirm Category/Signature panel hunks unchanged from the ux-hardening review — this task touched only EvidencePanel/FolderBtn + one import line. No new deps.
- Re-ran: contracts build (0), web test 343/343 pass 90 suites (baseline 338 + 5 new evidence-audit tests), typecheck clean, build OK.
- Diff review vs checklist: A flag table implemented verbatim incl. whitespace-vendor case, info flags don't flip state (tested) ✓; B1 three tiles, มูลค่ารวม retoned indigo, attention tile = <button aria-pressed> with ring pressed state, gradient export card gone ✓; B2 labeled toolbar in card, checkbox + tile share one attentionOnly state, export button ml-auto (payload untouched), JSON manifest relocated to result banner with expiry copy ✓; B3 formatThaiMonth + count + ⚠ (title) when evidenceCount < expenseCount ✓; B4 status badge col with flag tooltip, warn rows border-l-4 amber + bg-warning-50/40, tax badge tone+reason title, ไม่มีไฟล์ danger badge, ผู้ขาย ไม่ระบุ warning ink, trailing ›, footer attention count, colSpan 8→10, empty-state copy differs for filtered view ✓; B5 keep-frame opacity-50 + pointer-events-none, first load keeps text ✓; B6 HowItWorks updated ✓. Status never color-alone ✓. Row-click/keyboard + export/manifest behavior unchanged ✓.
- Minor accepted (non-blocking): <div>-content inside the attention-tile <button> is technically loose HTML but standard React practice and renders fine; attention summary is computed from the current server slice (pagination out of scope, unchanged from before).
Next: when the stack is up — manual walk: attention tile toggle + checkbox sync, badge tooltips, folder ⚠, keep-frame reload, Excel/JSON downloads.
