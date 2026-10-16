# Fix-up 15: help that starts work in chat

Owner: 2026-10-16. Scope: H1–H3, starting with the STAFF/Starter reimbursement journey in `.live/J7/` (local evidence only).

Acceptance:
- An action how-to selects a server-owned chat entry from the capability registry. Reply with one short Thai sentence and primary quick reply “ให้น้องทำให้”; the message starts the existing action flow. An explicit request with facts proceeds directly. Approved explanatory help remains available; guide links are secondary. No keyword routing or model-authored action labels. Recheck action permissions/entitlement at rendering and use-case execution. Denial names the responsible permission holder.
- Reimbursement options use buttons: at most four eligible bills plus “รายการใหม่”; otherwise receipt upload or “ไม่มีใบเสร็จ”. Keep the user's grounded description, amount and date through continuations; ask only missing details. Company categories are offered as buttons, suggestion first. Existing claim evidence, source, branch, payout and approval rules remain authoritative.
- Finish on the existing draft confirmation card. Only its verified confirm saves; then offer “ส่งอนุมัติ”, which opens the existing round-3 submission preview. No substitute-receipt signing/certification/approval/preview in LINE.
- Never refer to an absent list or ask for numbered choices. Respect LINE's 13-quick-reply limit.

Architecture: additive action-selection metadata travels on the existing model-metered intake/turn path; fixed registry entries cannot mutate. API-owned choices are revalidated before delivery. Reuse LineReimbursementDraftService, its proposal/provenance adapter and the existing reimbursement use-cases. No schema migration, dependencies, feature flags, budget-contract or final-mutation policy changes.

Plan: inspect callers/contracts; add registry bridge and button collection; register regressions in existing spec files; build contracts; typecheck API/gateway; run complete declared suites, importing API specs, real-module DI and table-driven delivery-plan checks; record evidence and leave the diff uncommitted.
