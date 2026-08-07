# WatchDog-BMS Docs

This folder is designed to be opened as an Obsidian vault and used as the source of truth before implementation.

## Folder Structure

- `product/` — product vision, business model, positioning, customer segments
- `specs/` — feature specs and business requirements
- `plans/` — implementation plans, milestones, phased delivery
- `adr/` — architecture decision records
- `guidelines/` — implementation rules for frontend, backend, LINE channel, and security
- `research/` — market, domain, accounting, inventory, CRM, AI notes
- `prompts/` — reusable Cosmos/Auggie prompts

## Current Product Direction

WatchDog-BMS is an SME Business OS for Thai SMEs: web is the full business operating system, while LINE is the first daily AI Business Assistant channel for owners and staff.

The intended product combines:

- Next.js web admin for data entry, data viewing, accounting, tax, BI, setup, approvals, reports, inventory, CRM, and complex workflows
- LINE Official Account, Messaging API, LIFF, and LINE Login for AI chat, summaries, alerts, account linking, and deep links back to web
- NestJS backend for ERP source-of-truth APIs, permissions, audit logs, and workflow automation
- Inventory, product tracking, CRM, sales documents, expenses, reimbursement, accounting, and Thai tax support
- AI Gateway separated from ERP core, with Sales, Inventory, Tax, CRM, CFO, and Marketing agents
- AWS-first, Docker-container deploy path. Solo-dev MVP uses the local/prod lean path first; staging is deferred until release risk or team size justifies it.

## Working Rule

Before implementation:

1. Open `plans/master-implementation-checklist.md` and confirm the feature order.
2. Create or update a spec in `docs/specs/`.
3. Create or update an implementation plan in `docs/plans/`.
4. Ask Auggie to inspect the codebase and implement only the agreed phase.
5. Add or update tests for code changes.
6. Record important architecture choices in `docs/adr/`.

## Recommended Obsidian Usage

Open this `docs/` folder directly as an Obsidian vault.

Start from `Home.md`:

- Home: `Home.md`
- Product vision: `product/vision.md`
- Business use cases: `product/business-use-cases.md`
- Master implementation checklist: `plans/master-implementation-checklist.md`
- Implementation roadmap: `plans/implementation-roadmap.md`
- Platform foundation plan: `plans/platform-foundation-phase-1-plan.md`
- Platform foundation local/prod lean spec: `specs/platform-foundation-local-prod-lean-spec.md`
- Platform foundation local/prod lean plan: `plans/platform-foundation-local-prod-lean-plan.md`
- Platform environment setup plan: `plans/platform-environment-setup-plan.md`
- Inventory MVP plan: `plans/inventory-mvp-plan.md`
- LINE AI read-only assistant spec: `specs/line-ai-read-only-assistant-spec.md`
- LINE AI read-only assistant plan: `plans/line-ai-read-only-assistant-plan.md`
- LINE AI business query coverage spec: `specs/line-ai-business-query-coverage-spec.md`
- LINE AI business query coverage plan: `plans/line-ai-business-query-coverage-plan.md`
- LINE AI channel/auth spec: `specs/line-ai-channel-auth-spec.md`
- Web frontend code style guideline: `guidelines/web-frontend-code-style.md`
- Backend hexagonal code style guideline: `guidelines/backend-hexagonal-code-style.md`
- Security implementation guideline: `guidelines/security-implementation-guideline.md`
- System overview spec: `specs/sme-business-os-overview.md`
- LINE AI assistant UX spec: `specs/line-ai-assistant-ux-spec.md`
- Enterprise architecture spec: `specs/enterprise-architecture-spec.md`
- Authentication, authorization, and RBAC spec: `specs/auth-authorization-rbac-spec.md`
- Platform environment and runtime config spec: `specs/platform-environment-config-spec.md`
- Platform foundation local/prod lean spec: `specs/platform-foundation-local-prod-lean-spec.md`
- Permission matrix: `specs/permission-matrix.md`
- CRM and sales spec: `specs/crm-sales-spec.md`
- Dashboard and notification spec: `specs/dashboard-notification-spec.md`
- Workflow automation spec: `specs/workflow-automation-spec.md`
- AI Gateway spec: `specs/ai-gateway-agents-spec.md`
- AI runtime production integration spec: `specs/ai-runtime-production-integration-spec.md`
- AI runtime production integration plan: `plans/ai-runtime-production-integration-plan.md`
- AI Draft and Suggestion Layer spec: `specs/ai-draft-suggestion-layer-spec.md`
- AI Draft and Suggestion Layer plan: `plans/ai-draft-suggestion-layer-plan.md`
- Thai tax 2026 spec: `specs/tax-thailand-2026-spec.md`
- Thai tax verified baseline: `specs/tax-2026-verified-rules.md`
- Accounting documents spec: `specs/accounting-documents-spec.md`
- Double-entry ledger and period closing spec: `specs/double-entry-ledger-closing-spec.md`
- Double-entry ledger and period closing plan: `plans/double-entry-ledger-closing-plan.md`
- Accounting product benchmark: `specs/accounting-product-benchmark.md`
- Chart of accounts CSV analysis: `research/chart-of-accounts-csv-analysis.md`
- Requirements coverage matrix: `specs/requirements-coverage.md`
- AWS-first hosting ADR: `adr/0005-aws-first-hosting-and-deployment-strategy.md`
- Phase 1 stack ADR: `adr/0006-phase-1-platform-stack-defaults.md`
- LINE AI access ADR: `adr/0008-line-ai-access-and-auth.md`
- Cosmos prompts: `prompts/cosmos-auggie-workflows.md`

## Obsidian Vault Setup

This folder includes a lightweight Obsidian setup:

- `.obsidian/app.json` — basic vault behavior
- `.obsidian/core-plugins.json` — enables core plugins such as backlinks, graph, search, and templates
- `.obsidian/templates.json` — configures `_templates/` as the template folder
- `_templates/` — reusable ADR, feature spec, and implementation plan templates
- `_attachments/` — suggested folder for images and attachments

To open manually:

1. Open Obsidian.
2. Choose `Open folder as vault`.
3. Select this repository's `docs/` folder.
4. Open `Home.md`.
