# Agent Memory: expenses-ux-hardening

Status: VERIFIED (harness) — 2026-07-29. All 8 workstreams accepted; UAT HEIC decoder follow-up verified with the reported file.
Owner: Claude (harness) → Codex (implementation)
Scope: apps/web only. 8 workstreams W1–W8 per docs/plans/expenses-ux-hardening-plan.md. No backend/contracts changes; one lazy HEIC decoder dependency.
Decisions:
- Only real auto-save found in the feature is category rename on blur (ExpensesWorkspacePanels.tsx ~L112) → W1 converts to explicit บันทึก/ยกเลิก; activate toggle + archive-confirm stay as-is (not forms).
- W3/W5 popups use shared Modal (apps/web/src/common/components/modal), replacing always-visible side cards.
- W4 sanitize policy: strip `\` + control chars on change; forbid `< > { } | ^ \`` at submit with Thai message; helper at common/forms/sanitize.ts. Normal Thai punctuation must pass.
- W6: HEIC decode tries native first (createImageBitmap; Safari), then falls back to `heic-to/csp` via lazy dynamic import. UAT follow-up replaced `heic2any` 0.0.4 because it rejected the reported 12 MP HEIC (`ERR_LIBHEIF format not supported`); `heic-to` 1.5.2 converted the same file to a 1.38 MB JPEG in about 1.5 seconds. Images > 2MB are canvas-resized to ≤2MB JPEG (max edge 2560, quality 0.92→0.5); PDF >4MB warn-not-block; drop path gets the same validation as picker. Server MIME whitelist stays untouched — client always sends jpeg/png/pdf.
- W7: one auto-retry on transient extraction failure only (never not_configured/unsupported/not_expense_document).
- W8: dictionary-only change — expenses.reject th → "ยกเลิกรายการ", en → "Cancel item"; reject_reason updated; SignaturePanel's hardcoded ปฏิเสธ intentionally NOT renamed (different meaning); accepted wording proximity with void_reason.
- Working tree has uncommitted expense-detail-stepper-ux work on fix/permissions-system — Codex must not disturb it; symbol-anchored edits only.
Open questions: none blocking. (If Chrome-desktop HEIC support matters later, revisit heic2any as an explicit dependency decision.)
Artifacts:
- docs/plans/expenses-ux-hardening-plan.md (EN plan, source of truth, incl. acceptance checklist + verification protocol)
- docs/prompts/expenses-ux-hardening-codex-handoff.md (Codex prompt: constraints, order, definition-of-done evidence)
- ../Doc/expenses-ux-hardening-summary-th.md (Thai summary, outside repo)
Verification (planned protocol, harness re-runs independently):
- contracts build → web test (baseline 325/0, must include new sanitize.spec.ts + expense-upload.logic.spec.ts) → typecheck → build
- full-diff review vs checklist; scope guard (apps/web + docs only, no package.json/lockfile diff)
- e2e EXP-01..09 + grep e2e for "ปฏิเสธ" text assertions; manual walk: >2MB upload resize, `\`/forbidden chars, both popups, ยกเลิกรายการ button
Next: run Codex with the handoff prompt; on return, execute verification protocol and update Status here (IMPLEMENTED/REJECTED + evidence).

Implementation:
- W1: category rename now persists only from บันทึก/Enter; blur does nothing and ยกเลิก exits edit mode.
- W2: manual entry uses dictionary-backed tabs/copy, labeled sections, computed total, and the unchanged draft payload flow.
- W3/W5: category creation and signature upload moved from side cards into the shared Modal; success closes/resets and errors remain visible in the modal.
- W4: `stripDisallowed`/`findForbiddenChars` added with tests and wired to the scoped expense text inputs.
- W6/W7: picker and drop share file classification/preparation; images are native-decoded/resized to JPEG ≤2MB, PDF >4MB warns, HEIC failure is actionable, and extraction retries once only for throw/failed.
- W8: expense reject UI copy changed to cancel-item copy in th/en; signature rejection copy remains unchanged.

Verification:
- `corepack pnpm --filter @watchdog-bms/contracts build` → exit 0.
- `corepack pnpm --filter @watchdog-bms/web test` → 338 tests, 88 suites, pass 338 / fail 0.
- `corepack pnpm --filter @watchdog-bms/web typecheck` → exit 0.
- `corepack pnpm --filter @watchdog-bms/web build` → exit 0; production routes generated. The sandboxed first attempt stalled in Turbopack and was interrupted; the identical command outside the sandbox completed in 3.5s.
- `rg` found no expense e2e/spec assertion for the old ปฏิเสธ button copy; remaining expense occurrence is intentionally the signature approval flow.

Deviations:
- No quality/downscale helper was factored out solely for testing; classification and sanitization pure logic are covered directly, while canvas decode/encode remains the minimum browser implementation.
- E2E was not run because the requested verification set was test/typecheck/build and the Docker stack is stopped; the existing EXP stepper spec was not changed by this implementation.

Harness re-verification (independent, 2026-07-26):
- Scope guard: `git status`/`diff --stat` — only apps/web + docs + e2e touched; zero diff in apps/api, ai-gateway, contracts, package.json, lockfile. e2e/expenses.spec.ts + expenses.model.ts + docs/specs diffs are the pre-existing stepper work only.
- Re-ran: contracts build (exit 0), web test 338/338 pass 88 suites (baseline 325 + 13 new incl. sanitize.spec 4 + classifyUploadFile 9), typecheck clean, production build OK.
- Full-diff review vs acceptance checklist: W1 rename saves only via บันทึก/Enter (blur removed, cancel button, disabled-when-unchanged) ✓; W2 manual panel 3 labeled sections + computed ยอดรวม + tab_manual keys th/en, payload unchanged except description.trim() ✓; W3 category Modal (sm) with 3 fields, error stays in modal, side card removed ✓; W4 stripDisallowed on change + findForbiddenChars at submit wired to every free-text input incl. reject/void textarea, review edit fields, substitute reasons, signer position, signature label/reject reason ✓; W5 signature Modal keeps canvas ref + derived-asset flow, closes on success ✓; W6 accept attr + drop path both classified, prepareReceiptFile transcodes HEIC (even ≤2MB) and resizes >2MB to JPEG ≤2MB (2560 edge, q0.92→0.5, ×0.8 downscale loop), prepared name/type/size sent to initReceiptUpload AND completeReceiptUpload, PDF>4MB warns via InfoBanner, upload button disabled while preparing ✓; W7 retry once on throw/failed only (not_configured/unsupported/not_expense_document excluded), upload survives extraction failure ✓; W8 expenses.reject → ยกเลิกรายการ/Cancel item + reject_reason updated, SignaturePanel ปฏิเสธ untouched, no e2e text assertion on old copy (grep) ✓.
- Codex deviations reviewed and accepted: no separate quality-step helper (canvas part inherently browser-bound; classification is unit-tested); e2e not run (stack down).
UAT HEIC follow-up (2026-07-29):
- Reproduced with `/Users/spare058/Downloads/IMG_8759.HEIC` (HEIF/HEVC, 4032×3024, 1.1 MB): the old browser fallback failed with `ERR_LIBHEIF format not supported`.
- Replaced `heic2any` 0.0.4 with lazy-loaded `heic-to/csp` 1.5.2; no API, upload, or extraction contract changed.
- Browser benchmark using the production import and the reported file: conversion succeeded in 1,495 ms; JPEG output 1,445,138 bytes.
- `pnpm --filter @watchdog-bms/web test` → 550/550 pass.
- `pnpm --filter @watchdog-bms/web typecheck` → exit 0.
- `pnpm --filter @watchdog-bms/web build` → exit 0 (compiled in 9.3s). The first sandboxed build stalled in Turbopack and was interrupted; the same command outside the sandbox succeeded.
Next: deploy to UAT and repeat the expense upload with `IMG_8759.HEIC`; run the remaining EXP-01..09/manual regression walk when the authenticated stack is available.

## 2026-08-18 — LINE-saved iPhone photo reported as JPG

Reported flow: iPhone HEIC → send through LINE → save as `.jpg` on desktop → web receipt upload
accepts the selection, but completion reports a file-type mismatch.

Evidence and decision:
- The copy maps to the shared upload MIME/signature rejection path. The supplied attachment arrived
  at Codex as a complete JFIF JPEG and passes `inspectAttachmentBytes('image/jpeg', bytes)`, so that
  transported copy cannot reproduce the original desktop file metadata/container mismatch.
- The deterministic gap was still present: `prepareReceiptFile` passed every declared JPEG/PNG under
  6 MB through without inspecting bytes, while the backend correctly verifies the real container.
- The client now detects complete JPEG, PNG, and HEIC/HEIF containers before pass-through. A real
  JPEG/PNG keeps its original bytes and OCR quality; HEIC bytes hidden behind `.jpg` metadata use the
  existing `heic-to` fallback and become a real JPEG; malformed or other decodable mismatches are
  safely re-encoded instead of reaching backend signature rejection.

Verification:
- Focused `expense-upload.logic.spec.ts`: 15/15 pass, including renamed HEIC and truncated JPEG.
- `pnpm --filter @watchdog-bms/web typecheck`: pass.
- The supplied 103,973-byte JPEG is detected as JPEG and remains byte-for-byte unchanged.
