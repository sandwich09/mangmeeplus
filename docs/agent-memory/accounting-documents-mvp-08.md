# Agent Memory: accounting-documents-mvp-08

Status: Complete on 2026-06-25
Owner: Codex
Scope: Master Implementation Checklist item 08. Accounting Documents MVP business closure and recheck of prior item gate evidence.
Role gate status:
- BA: Finance/sales need web-owned quotation, invoice/billing note, receipt/tax invoice, payment, and correction workflows. Target users are Sales, Finance, Accountant, and Owner. Journey is draft document -> quotation approval where applicable -> issue -> convert/record payment -> tax invoice or credit/debit correction -> ledger-ready source. Rules/exceptions: web is the only mutation surface; LINE/AI remain non-mutating; issued records are locked and corrected via void/credit/debit notes; overpayment creates unapplied credit. Acceptance: finance can manage documents from web and finalized records expose tax/audit/ledger posting inputs.
- SA: Implementation extends existing contracts, Prisma accounting models, document sequence, audit, outbox, permission registry, API module, and web workspace. Contracts now carry source document links for linked tax invoices and credit/debit notes. Data model impact is additive to existing item 08 fields; no new migration was needed. Permissions remain server-side through existing accounting permission keys and request context. State transitions use existing draft/approval/issued/voided logic; scope excludes GL journals, tax filing, OCR, bank reconciliation, procurement/AP, and LINE/AI mutation.
- DEV: Ponytail full read. Smallest correct diff reused existing accounting use cases and endpoints instead of adding new modules. Touched files: `apps/api/src/modules/accounting-documents/domain/models/accounting.model.ts`, `apps/api/src/modules/accounting-documents/infrastructure/prisma-accounting.repository.ts`, `apps/api/src/modules/accounting-documents/presentation/http/accounting-document.controller.ts`, `apps/web/src/features/accounting-documents/AccountingPages.tsx`, `apps/web/src/features/accounting-documents/accounting-documents.api.ts`, `apps/web/src/features/accounting-documents/accounting-documents.model.ts`, `packages/design-tokens/generated/web/theme.css`, `docs/plans/master-implementation-checklist.md`, `docs/agent-memory/accounting-documents-mvp-08.md`. Focused checks passed after dependency install, Prisma client generation, and design token regeneration.
- Integration: Backend-to-frontend contract verified by web typecheck against API client/model changes. UI journey now exposes document list/detail, create draft, quotation submit/approve/reject, issue, convert to invoice/billing note, record received payment, create linked tax invoice, create credit/debit note, void, counterparty create/list, payment list, loading/empty/error states, and server-error surfacing. Browser/E2E path was not run because no existing browser automation command for accounting exists; web typecheck and API tests were run instead.
Decisions:
- Keep item 08 as source documents only; no ledger journal generation.
- Use existing generic document create/issue/void endpoints for tax invoice and credit/debit notes, carrying source document ids instead of adding a parallel correction module.
- Treat root `pnpm typecheck` failure as environment/tooling, not item 08 failure: Turbo cannot locate the pnpm binary when launched through Corepack in this shell.
Open questions:
- None blocking item 08 closure. Later item 10 should consume `posting-source`; later item 11 can add tax report adapters.
Artifacts:
- Accounting API source-link fields and repository persistence.
- Accounting web workspace with lifecycle and payment/correction actions.
- Master Implementation Checklist item 08 ticked.
Verification:
- `corepack pnpm install`: pass.
- `corepack pnpm --filter @watchdog-bms/contracts typecheck`: pass.
- `corepack pnpm --filter @watchdog-bms/api test`: pass, 249 tests.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: pass, with existing Next.js workspace-root warning about `C:\Users\Sand\package-lock.json`.
- `corepack pnpm --filter @watchdog-bms/api prisma:validate`: pass.
- `corepack pnpm --filter @watchdog-bms/api exec prisma generate`: pass.
- `corepack pnpm --filter @watchdog-bms/api typecheck`: pass after Prisma generation.
- `corepack pnpm --filter @watchdog-bms/config typecheck`: pass.
- `corepack pnpm --filter @watchdog-bms/ai-gateway typecheck`: pass.
- `corepack pnpm --filter @watchdog-bms/workers typecheck`: pass.
- `corepack pnpm --filter @watchdog-bms/design-tokens exec node scripts/build-tokens.mjs`: pass.
- `corepack pnpm --filter @watchdog-bms/design-tokens typecheck`: pass after token regeneration.
- `corepack pnpm --filter @watchdog-bms/web test`: pass with 0 tests discovered.
- `corepack pnpm agent:gates -- docs/agent-memory/platform-foundation-01.md docs/plans/platform-foundation-local-prod-lean-plan.md docs/agent-memory/auth-rbac-audit-02.md docs/plans/auth-rbac-audit-plan.md docs/agent-memory/web-core-workspace-03.md docs/plans/web-core-workspace-plan.md docs/agent-memory/data-model-core-04.md docs/plans/data-model-core-plan.md docs/agent-memory/inventory-mvp-05.md docs/plans/inventory-mvp-plan.md docs/agent-memory/dashboard-notification-06.md docs/plans/dashboard-notification-plan.md docs/agent-memory/line-ai-read-only-assistant-07.md docs/plans/line-ai-read-only-assistant-plan.md`: partial. Item 01-03 memories/plans passed and item 04-07 memories passed; item 04-07 older plan docs lack the newer required gate-section headings.
- `corepack pnpm typecheck`: failed because Turbo could not find package manager binary under Corepack.
Next:
- Continue with checklist item 09. Expense and Receipt Upload.
