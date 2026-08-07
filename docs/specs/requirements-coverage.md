# Requirements Coverage Matrix

## 1. Goal

Track whether the docs cover the original product request: "ERP / Business OS for SME, built by one person, with web for full data/workflows and LINE for daily AI-assisted questions, summaries, and alerts."

Current channel decision: web is the full source-of-truth workspace. LINE Official Account, Messaging API, LIFF, and LINE Login provide AI chat, summaries, alerts, account linking, and web deep links. No native app is in scope.

Status legend:

- Covered: enough product direction to create implementation plan.
- Partial: direction exists, but more detail or validation is needed.
- Open: needs user/business/accountant/platform decision.

## 2. Core Product Coverage

| requirement | status | source docs | notes |
|---|---|---|---|
| SME Business OS / ERP-lite | Covered | `sme-business-os-overview.md`, `enterprise-architecture-spec.md` | Web is full Business OS; LINE is AI assistant and alert channel. |
| Built by one person / practical phasing | Covered | `../plans/implementation-roadmap.md`, `enterprise-architecture-spec.md` | Modular monolith first, phased delivery. |
| LINE AI assistant | Covered | `line-ai-read-only-assistant-spec.md`, `line-ai-channel-auth-spec.md`, `line-ai-assistant-ux-spec.md`, `dashboard-notification-spec.md` | LINE OA, Messaging API, LIFF, and LINE Login provide AI chat, summaries, alerts, account linking, and web deep links. |
| Next.js web admin | Covered | `sme-business-os-overview.md`, `enterprise-architecture-spec.md` | Web-first finance/tax/BI. |
| NestJS backend | Covered | `sme-business-os-overview.md`, `enterprise-architecture-spec.md` | ERP core source-of-truth API. |
| Separate AI Gateway | Covered | `ai-gateway-agents-spec.md`, `enterprise-architecture-spec.md`, `permission-matrix.md` | AI does not live inside ERP core. |

## 3. Module Coverage

| module | status | source docs | gap / next step |
|---|---|---|---|
| Tax | Partial | `tax-thailand-2026-spec.md`, `tax-2026-verified-rules.md` | Company is VAT-registered from day one; accountant/RD verification required before implementation. |
| Reimbursement / expense approval | Covered | `reimbursement-approval-spec.md`, `workflow-automation-spec.md`, `line-ai-channel-auth-spec.md` | Approval required from 1 THB by default; LINE sends alerts and status summaries, web handles action. |
| Inventory / stock tracking | Covered | `inventory-mvp-spec.md`, `line-ai-assistant-ux-spec.md` | Internal QR is default MVP; web handles stock actions, LINE answers stock questions and alerts. |
| Product tracking | Covered | `inventory-mvp-spec.md` | Tracking depth beyond stock movement can be refined in implementation plan. |
| Accounting | Covered | `accounting-documents-spec.md`, `double-entry-ledger-closing-spec.md`, `accounting-product-benchmark.md`, `line-ai-channel-auth-spec.md` | Web document workflow plus promoted double-entry ledger for GL/TB/P&L/BS/close; LINE answers summaries, reminders, and exception questions. |
| Employee access / role management | Covered | `employee-access-role-management-spec.md`, `permission-matrix.md`, `auth-authorization-rbac-spec.md`, `line-ai-channel-auth-spec.md` | Owner/admin creates named employee users, temporary passwords, roles, and LINE link QR packages; payroll/HR details stay in item 20. |
| CRM | Covered | `crm-sales-spec.md` | Need primary contact channels. |
| Notifications | Covered | `dashboard-notification-spec.md`, `workflow-automation-spec.md`, `line-ai-channel-auth-spec.md` | LINE delivery and web notification center first; native push is out of scope. |
| Sales dashboard | Covered | `dashboard-notification-spec.md` | Need exact target logic. |
| AI Suggestion | Covered | `ai-gateway-agents-spec.md`, `dashboard-notification-spec.md`, `workflow-automation-spec.md` | AI suggestions are draft/approval-gated. |
| AI Marketing | Covered | `ai-marketing-platforms-spec.md`, `accounting-product-benchmark.md` | Marketplace integrations are later; draft/content planning can remain independent. |
| Workflow automation | Covered | `workflow-automation-spec.md` | Need default enabled templates. |

## 4. LINE AI Assistant Coverage

| user group | LINE requirement | status | source docs |
|---|---|---|---|
| Owner | sales today/month, top products, receivables, low stock, tax, reimbursement, AI summary | Covered | `line-ai-read-only-assistant-spec.md`, `line-ai-assistant-ux-spec.md`, `dashboard-notification-spec.md`, `line-ai-channel-auth-spec.md` |
| Sales | follow-up alerts, pipeline summary, customer status questions | Covered | `line-ai-assistant-ux-spec.md`, `crm-sales-spec.md`, `line-ai-channel-auth-spec.md` |
| Warehouse | low-stock alerts, stockout risk, stock summary questions | Covered | `line-ai-assistant-ux-spec.md`, `inventory-mvp-spec.md`, `line-ai-channel-auth-spec.md` |
| Manager | approval queue alerts and SLA-risk summaries | Partial | `line-ai-assistant-ux-spec.md`, `reimbursement-approval-spec.md`, `workflow-automation-spec.md` | Approval action happens in web. |
| Finance/accountant | tax, expense, receivable, payable, and close-period summaries | Covered | `line-ai-assistant-ux-spec.md`, `accounting-documents-spec.md`, `tax-thailand-2026-spec.md` |
| Employee users | LINE account linking and role-scoped AI answers | Covered | `employee-access-role-management-spec.md`, `line-ai-channel-auth-spec.md`, `permission-matrix.md` |

## 5. Web-Only / Web-First Coverage

| web feature | status | source docs | notes |
|---|---|---|---|
| General Ledger | Covered | `double-entry-ledger-closing-spec.md`, `accounting-documents-spec.md`, `accounting-product-benchmark.md` | Promoted to item 10; derives from posted journal lines. |
| Trial Balance | Covered | `double-entry-ledger-closing-spec.md`, `permission-matrix.md` | Promoted to item 10; must balance debit and credit totals. |
| Journal Entry | Covered | `double-entry-ledger-closing-spec.md`, `accounting-documents-spec.md`, `permission-matrix.md` | Generated locked journals plus controlled manual/reversal entries. |
| Period closing | Covered | `double-entry-ledger-closing-spec.md`, `enterprise-architecture-spec.md` | Promoted to item 10; close checks block mutation and posting in closed period. |
| VAT report | Covered | `tax-thailand-2026-spec.md`, `tax-2026-verified-rules.md` |
| WHT report | Covered | `tax-thailand-2026-spec.md`, `tax-2026-verified-rules.md` |
| CIT calendar/report prep | Partial | `tax-thailand-2026-spec.md`, `tax-2026-verified-rules.md` | Calculation detail later; calendar first. |
| P&L / Balance Sheet | Covered | `double-entry-ledger-closing-spec.md`, `accounting-documents-spec.md`, `dashboard-notification-spec.md` | Formal statements derive from account classes/report groups and posted journal lines. |
| Forecast / advanced BI | Partial | `dashboard-notification-spec.md` | Advanced BI builder is non-goal for MVP. |
| Employee and role settings | Covered | `employee-access-role-management-spec.md`, `employee-access-role-management-plan.md`, `permission-matrix.md` | Settings > Employees and Settings > Roles are web-owned; LINE/AI cannot mutate users or permissions. |

## 6. AI Coverage

| agent | status | source docs | notes |
|---|---|---|---|
| AI CFO | Covered | `ai-gateway-agents-spec.md`, `dashboard-notification-spec.md` | Sales/profit/cash/receivable summaries. |
| AI Inventory | Covered | `ai-gateway-agents-spec.md`, `inventory-mvp-spec.md` | Low stock, anomalies, reorder suggestions. |
| AI Sales | Covered | `ai-gateway-agents-spec.md`, `crm-sales-spec.md` | Follow-up priority and pipeline. |
| AI CRM | Covered | `ai-gateway-agents-spec.md`, `crm-sales-spec.md` | Customer history and follow-up. |
| AI Tax | Partial | `ai-gateway-agents-spec.md`, `tax-thailand-2026-spec.md`, `tax-2026-verified-rules.md` | Must cite config/source and warn when accountant confirmation needed. |
| AI Marketing | Covered | `ai-marketing-platforms-spec.md` | Shopee, TikTok, Facebook drafts. |

## 7. User Decisions Recorded

- Company is VAT-registered from day one.
- Marketplace/platform integrations are later.
- Payroll is later, not MVP.
- Web is the full workspace for data entry, viewing, actions, approvals, reports, and setup.
- LINE Official Account, LIFF, and LINE Login are MVP assistant/access channels.
- LINE delivery and web notification center are the MVP notification surfaces.
- LINE answers data questions and sends alerts, but final business actions happen in web.
- Owner/admin creates named employee access in web; employees link LINE after verified account-link flow and inherit current role permissions.
- Accounting uses web document workflow plus promoted double-entry ledger. Finalized documents become ledger-ready sources; item 10 generates locked balanced journal entries before Thai Tax MVP.
- Approval required from 1 THB for every request by default; thresholds remain configurable.
- Accounting/tax priority moves up before inventory, CRM, and later marketplace work.
- Internal QR is the default MVP label standard; GS1 Digital Link QR is later-compatible mode.

## 8. Remaining Decisions to Ask User

Medium priority:

1. Should bank reconciliation be MVP?
2. Does sales need visit scheduling/map route?
3. Does business use deposits, partial payment, or partial delivery often?
4. Which export format do the accountant or accounting office expect?
5. Is external accountant an invited user role from MVP?
6. Which LINE invite/linking flow should be first: admin invite link, phone/email match, or manual admin approval?

## 9. Approval Threshold Definition

Approval threshold means a rule that decides when a record needs manager/owner approval before it becomes final.

Project default:

- Every approval request requires approval from 1 THB.
- Every discount request requires approval by default.
- Every purchase order request requires approval from 1 THB.
- Tax-sensitive expense always requires finance review.

Keep this configurable so the business can later change thresholds without code changes.

## 10. Accounting Scope Decision Recorded

Document workflow means users start from business documents: quotation, invoice, receipt, tax invoice, expense, payment, and WHT certificate. It is easier for SME users and matches FlowAccount-style workflow.

Double-entry means every finalized accounting-relevant transaction posts debit/credit journal lines into a ledger. It is required for General Ledger, Trial Balance, P&L, Balance Sheet, accountant exports, and period close.

Selected path:

1. Start with document workflow as the user-facing experience.
2. Make finalized documents ledger-ready from item 08 and item 09.
3. Add double-entry ledger as item 10 before Thai Tax MVP.
4. Generate locked balanced journal entries from finalized documents.
5. Use ledger entries for GL, Trial Balance, P&L, Balance Sheet, close, and financial report exports.
6. Let LINE AI summarize accounting/tax status from permission-checked source and ledger report APIs only.

## 11. Next Recommended Docs

- `../plans/platform-foundation-phase-1-plan.md`
- `../specs/double-entry-ledger-closing-spec.md`
- `../plans/double-entry-ledger-closing-plan.md`
- `../specs/line-ai-read-only-assistant-spec.md`
- `../plans/line-ai-read-only-assistant-plan.md`
- Planned: docs/plans/accounting-tax-implementation-plan.md
- Planned: docs/plans/ai-gateway-mvp-plan.md
- Planned: docs/plans/crm-sales-mvp-plan.md
