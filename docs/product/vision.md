# Product Vision

## Product Name

WatchDog-BMS

## One-line Description

An SME Business OS where web is the full data and operations workspace, while LINE is the AI assistant channel for asking about system data, receiving summaries, and getting alerts.

## Mission

Help SME owners and teams record, view, and manage business data in one trusted web system, while using LINE AI to quickly understand what needs attention today.

## Target Users

- SME business owner
- Shop manager
- Sales team
- Inventory or warehouse staff
- Accountant or finance staff
- Admin or operations staff
- Manager or approver
- Marketing operator

## Core Problem

Many SMEs operate through spreadsheets, chat apps, POS exports, marketplace dashboards, manual stock counts, and disconnected accounting records. This causes delayed decisions, stock errors, missed follow-ups, weak KPI visibility, missed tax deadlines, unclear reimbursements, and difficulty delegating work.

## Product Promise

WatchDog-BMS should act like a loyal business watchdog:

- Always watching key business signals: sales, cash, receivables, inventory, tax, expenses, CRM, and approvals
- Alerting when something needs attention
- Helping users ask questions and understand business status quickly from LINE
- Reducing manual follow-up and repetitive checking
- Supporting decision-making with clear data and AI explanations

## Product Principles

1. Web = full Business OS for data entry, data viewing, setup, accounting, tax, inventory, CRM, approvals, and reporting.
2. LINE = AI Business Assistant for asking questions, checking system data, receiving summaries, and getting alerts.
3. LIFF = lightweight bridge for LINE Login, account linking, alert deep links, and handoff to web detail when needed.
4. Next.js web admin, NestJS backend, LINE OA/LIFF, and separate AI Gateway are the default MVP stack.
5. Business workflow before technical complexity.
6. Accounting, tax, and inventory must be trustworthy and auditable.
7. AI must be separated through an AI Gateway, not embedded directly into ERP core.
8. AI should explain, suggest, and draft; irreversible actions require user approval.
9. Every important change should have traceability.

## MVP Outcome

The first useful version should allow an SME to:

- Manage products and stock
- Record sales, quotes, invoices, receipts, expenses, reimbursement evidence, and approvals
- Capture expense evidence from LINE/web, decide tax-evidence readiness, fill required document signatures, and share accountant-ready evidence/export packages through the web app
- View and manage full business data from web
- Track customers and follow-ups
- Ask LINE AI about system data and receive concise summaries
- Receive business alerts in LINE with links back to web details
- See Thai tax reminders and summaries
- Generate FlowAccount-style business document flows
- Ask AI CFO, Sales, Inventory, Tax, CRM, and Marketing agents about system data

## Long-term Direction

Become a practical ERP/CRM/Inventory/Accounting/Tax operating layer for SMEs, with web as the full source-of-truth workspace and LINE as the low-friction AI assistant that turns trusted business data into answers, summaries, alerts, and safe handoffs back to web workflows.
