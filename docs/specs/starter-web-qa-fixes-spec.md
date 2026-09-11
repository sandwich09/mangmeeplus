# Starter web QA fixes — owner decisions 2026-09-11

Status: Implemented and verified locally. External AI/OCR/LINE/mail checks remain blocked by sandbox prerequisites. See [regression evidence](../qa/starter-fixes-regression-2026-09-11.md).
Baseline: main 07824efc9dd6c53c926b7f275a16581f97b8266e.
Evidence: [local QA report](../qa/main-starter-web-qa-2026-09-11.md).

## Product rules

1. Starter always means the existing 7-menu feature preset, independent of purchase/commercial term. New admin onboarding starts with this feature set. Changing or renewing a commercial tier does not silently replace feature entitlements. Existing company entitlements are preserved; no automatic narrowing/backfill.
2. Admin can customize configuration and entitlements within existing validation/authorization rules. Changes show explicit previous → proposed values, including additions/removals, before saving. Keep existing per-company override support.
3. Starter AI exposes only declared capabilities using currently permitted sources. It can guide users through enabled work, but cannot recommend inaccessible actions, expose inaccessible data, or bypass source permissions. Permission checks apply at template discovery and request/execution, including stale UI/direct requests. Provider unavailable remains explicit; no simulated successful generation.
4. Expense summaries count one underlying cost once across personal-advance source and reimbursement projection. Preserve separate immutable evidence/accounting identities. Source UI shows the linked reimbursement and its current progress; consumed source is not an impossible pending expense-confirm task. Rejected/cancelled claims, payment reversals, voided projections, filtering and company/branch scopes must not lose costs or duplicate them.
5. Evidence view and exports follow validated reimbursement source references, expose consistent requester/payer/funding/document provenance, and recheck tenant/branch/file access. Do not fabricate legacy links or transfer attachment ownership. Canceled/replaced certificate files remain auditable history and are clearly distinguished from current evidence, including pre-issued canceled scans.
6. Notifications whose source condition ended resolve as work items; preserve notification history and independent per-recipient read/dismiss state. Reopened work must be actionable again without duplicate delivery.
7. Quota errors explain the existing limit; no quota increase or owner-seat policy change. Role editor accurately displays partial existing permissions without increasing/removing grants implicitly. Remove duplicate admin headings/keys and align help with current UI/entitlements.
8. External/no-account payee reimbursement is out of scope by owner decision: handle it outside the system and retain only facts the existing certificate flow supports. Do not invent an account/identity link or add a new repayment workflow.

## Impact and acceptance

- F01/F02/F03: new onboarding starter, commercial changes independent, customized and legacy entitlements unchanged; before/after visible; branch/member limits retain enforcement and useful errors.
- F05/F09/F11: 125 source + 125 projection is 125 total; source progress follows claim; confirm/export lists stay valid; payments/reversals and ledger identities unchanged. Current and canceled paper files distinguishable. Linked evidence remains permission checked and failed/legacy links never silently pass as complete.
- F06/F07/F08: partial role visibility preserves exact grants; completed/reopened work notifications reflect state with history intact; help matches implemented behavior.
- F10: nav and template availability reflect entitlements and source permissions for OWNER/STAFF/custom roles; unauthorized direct/stale requests denied; permitted usage guidance available without exposing unavailable modules.
- Focused checks exercise adjacent callers, boundary states and regression cases; run browser admin/user journeys and inspect exports after fixes. External AI/OCR/LINE validation remains blocked by recorded local prerequisites.

## Architecture constraints

Reuse existing contracts, repository source mappings, permission checks, notification lifecycle and confirmation UI. No new dependency, package.json edit, destructive migration, automatic legacy entitlement rewrite, cloud action or external delivery. AI Gateway stays separate from ERP; no direct database access from the model.
