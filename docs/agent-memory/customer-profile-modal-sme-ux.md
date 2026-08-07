# Agent Memory: Customer Profile Modal SME UX

Status: Completed and verified locally 2026-07-19
Owner: Product owner / Codex
Scope: Define and simplify every action in the Customer Directory profile modal for Thai SME users; update code and verify in Docker/browser.
Decisions:
- Preserve all existing backend contracts, RBAC, audit, archive, identity-link, and merge-preview safeguards.
- Make `เปิดแชท LINE` the primary action when a conversation exists; otherwise make full customer history the primary fallback.
- Replace unexplained system terms with direct Thai language and clearly separate common work from record maintenance.
- Do not add AI automation; context-aware hierarchy and guidance provide the requested smart behavior with lower risk.
Open questions: None for this scoped modal improvement.
Artifacts:
- `docs/specs/customer-profile-modal-sme-ux-spec.md`
- `docs/plans/customer-profile-modal-sme-ux-plan.md`
- `apps/web/src/features/crm/CustomersPrototypePage.tsx`
Verification:
- `git diff --check` — PASS.
- Docker production web build — PASS; Next.js compiled successfully and generated `/companies/[companyId]/customers`, Customer 360, Inbox, and related routes.
- Authenticated browser DOM + visual smoke — PASS for seeded customer `CRM-K4`.
- Verified plain-Thai identity/status labels, amber unverified-LINE treatment, internal-note label, maintenance action grouping, and exactly one primary action.
- Verified edit dialog, duplicate-review dialog, and archive confirmation entry/cancel paths. Archive confirm was disabled until a reason; no destructive action was submitted.
- Verified full-history destination `/crm/customers/seed-crm-customer-k4` and conversation destination `/inbox?conversation=seed-crm-conversation-c4`.
Next: Product owner may visually accept the open local page; no backend, migration, or API follow-up is required for this scoped UX change.
