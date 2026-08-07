# Customer Profile Modal — SME UX Implementation Plan

Status: Completed 2026-07-19

Authority: `docs/specs/customer-profile-modal-sme-ux-spec.md`, existing customer-management identity/permission contracts.

## Plan

1. Inspect screenshot, live DOM, current modal handlers, APIs, permissions, and merge/archive safeguards.
2. Keep API contracts and mutations unchanged; improve the modal using existing links, dialogs, and button styles.
3. Replace system terminology with direct Thai labels and explain LINE status versus verification.
4. Promote the most common next action, provide a full-history fallback, and separate maintenance/destructive actions.
5. Rebuild the Docker web image and verify the authenticated modal and each non-destructive navigation/dialog entry in browser.
6. Record exact evidence and remaining limitations in task memory.

## Scope boundaries

- No new backend endpoint, database field, dependency, AI agent, or automatic customer mutation.
- No redesign of the directory table, edit form, merge transaction, or archive policy.
- “Smart” means context-aware action priority and plain-language guidance, not speculative AI automation.

## Verification

- `git diff --check` — PASS.
- Docker web production build/restart — PASS; Next.js compiled and generated the Customer Directory and Customer 360 routes.
- Authenticated browser DOM/visual smoke at `/companies/seed-local-company/customers` — PASS with seeded owner and customer `CRM-K4`.
- Modal labels, translated LINE state, verification distinction, one-primary-action rule, edit dialog, duplicate dialog, and archive confirmation — PASS. Archive confirm remained disabled without a reason; no destructive mutation was submitted.
- `ดูประวัติลูกค้าทั้งหมด` navigated to Customer 360 and `เปิดแชท LINE` navigated to the seeded conversation — PASS.
