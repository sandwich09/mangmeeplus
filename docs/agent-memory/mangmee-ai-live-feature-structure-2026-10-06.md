# Agent Memory: Mangmee AI live feature structure

Status: Read-only Production verification complete.
Owner: thawatchai / Codex
Scope: User asked for AI structure, then restricted it to features actually enabled now. Supersedes the first workspace-only architecture summary for current enablement.

Decisions:
- Read cloud operations runbook before live inspection. Used existing non-root `mangmee-kamal-production`, enrolled SSM/SSH transport and strict host keys.
- At 2026-10-06 11:17 Bangkok, both API replicas and AI Gateway run `bdb65d8e8f6153b83d83783c930e96e3a38c2a7b` in live serving mode. AgentCore `kamal_production_b` v24 is READY on the same source. Public customer gate is OPEN.
- Parsed the deployed API config inside both existing containers without starting the app or calling models. Effective flags match: reliability v2, delivery v2, document Q&A, reimbursement DRAFT writing, approved knowledge, response preferences, expense draft conversation/edit and CRM auto-reply are enabled. Reimbursement write quiesce is false. Empty rollout lists add no restriction, per pinned source.
- AI draft provider resolves to gateway. Gateway chat/document model defaults are Bedrock Claude Sonnet 4.6. Per-company approved model policy may still apply.
- Current AgentCore source always enables native tool loop, coverage critic and approved prepared families; old copied flag values must not be treated as effective switches.
- Public lookup is disabled; final AI business mutation is disabled. Neither belongs in the enabled-feature summary.
- Feature enablement is platform-level. Company entitlements, permissions, source state, budgets, and CRM channel/conversation opt-in remain required. No customer usage or every-journey success is claimed.
- Latest local release receipt `20261005T180652Z-3f9b6aa1` remains `AWAITING_BROWSER_ACCEPTANCE`. This readback does not complete, retry or accept that release.

Open questions: None for the requested platform-level feature structure. Per-company availability and end-to-end acceptance were not requested or tested.

Artifacts:
- [Sanitized readback](../evidence/mangmee-ai-live-feature-structure-2026-10-06.json).
- Private transport evidence: `.env.kamal/production/ai-feature-readback-20261006/`.
- Pinned source: `packages/config/src/index.ts`, Gateway/API config services, LINE orchestration and capability manifest, CRM inbound use case, AI draft provider factory at `bdb65d8e`.

Verification:
- STS expected account and assumed-role identity; read-only running-container configuration and deployed config parsing.
- API replicas match; API/Gateway/AgentCore source matches; AgentCore endpoint READY; public gate OPEN.
- All 5 owned SSM sessions terminated; no service, IAM, gate, deployment, customer-data or model invocation changes.
- No application tests: documentation/read-only inventory task. JSON evidence assertions for parity and cleanup pass.

Next: Deliver the feature-only structure; use fresh readback for future enablement claims.

## Correction: scope is packages currently sold

User clarified that the requested structure must follow currently sold packages, not globally enabled
runtime capabilities. The previous feature summary was too broad for this commercial scope.

- Fresh public Production `GET /api/v1/billing/catalog` at 2026-10-06 11:22:54 Bangkok returns LIVE,
  all eight monthly/yearly offers AVAILABLE, catalog revision
  `5d54c59a6a24003aa8e8c5652e29d9ecdec880ae85701bb0621325c7db194ddf`.
- STARTER249, BASIC499 and PRO999 have identical feature-key sets. ENTERPRISE1999 adds only
  `wht_pnd53` and `wht_50bis`; it does not add `thai_tax` or another AI module.
- All four include `ai_line_assistant`, expenses and its upload/evidence/category/signature
  capabilities, reimbursement, dashboard notifications, employee access and company settings.
- No sold offer includes CRM, sales documents, inventory, double-entry ledger, banking, full tax,
  reports or workflow automation feature keys. Those must not appear as included package AI
  capabilities merely because their runtime/controller exists or an administrator has enabled them.
- Scope the answer to LINE conversation/help/preferences, expense/receipt/document Q&A and OCR,
  expense/reimbursement draft assistance and permitted summaries of these modules. Same AI
  feature scope across tiers; monthly receipt allowances are30/50/100/500, branch limits1/2/5/10,
  employee limits2/5/10/30. Annual receipt allowances360/600/1200/6000 are paid-period allowances.
- Do not market the catalog's200000satang operational AI cap as included purchased chat credits.
- [Fresh public catalog](../evidence/mangmee-ai-sale-catalog-2026-10-06.json). Compared every offer's
  feature keys and the exact deployed-source tool entitlement mapping. No runtime/data changes.

Next: Use the package-scoped structure in the user response; earlier platform-wide list is superseded
for what customers receive when buying these packages.

## Package-scoped architecture follow-up

User next requested architecture for that same sold-package scope. Reused this session's live
readback/catalog and inspected pinned deployed source `bdb65d8e`, not the older dirty checkout.
No new cloud operation or model invocation.

- LINE is the conversational entry; Web provides upload, review and business workflows. Do not
  draw a general Web AI chat as a verified deployed feature.
- API owns identity/company/package/permission admission, quota/budget, durable conversation and
  delivery state, attachment ownership and explicit draft confirmation.
- Gateway handles semantic intake and document/OCR/Q&A provider calls. LINE conversation
  orchestration runs via the selected AgentCore runtime and calls permission-checked API tools.
- Relevant tool families: expense reads/draft previews, reimbursement reads/draft previews,
  company/employee/branch context, dashboard notifications and billing package usage/catalog.
- Prepared simple reads use verified formatters; multi-step requests use bounded native tool
  orchestration, coverage critic and response composition. These are shared execution paths,
  not package-specific AI services.
- PostgreSQL holds business/durable conversation/job/audit state, Redis supports buffering,
  queue/ledger coordination, and attachment storage holds document bytes. API document-Q&A worker
  materializes checked pages and calls Gateway; background worker service drives drain/recovery.
- Both model defaults are Bedrock Sonnet4.6 from live readback; no OpenAI fallback deployment is
  claimed. Model output does not grant package/permission access or final business approval.

Verification: pinned-source orchestrator, turn use case, Gateway HTTP routes, API LINE module,
document-Q&A worker/service and worker registration read; explanation only, no application changes.
