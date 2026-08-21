# Plan: LINE Rich Menu V2 Ver1

Status: Repository implementation complete; LINE Console rollout and device UAT pending
Owner: thawatchai
Date: 2026-08-21
Specs:

- [[specs/line-rich-menu-v2-spec|LINE Rich Menu V2 Spec]]
- [[specs/line-rich-menu-v2-image-spec|LINE Rich Menu V2 Visual Asset Spec]]

## Goal

Ship the smallest backend and asset change needed for the six-action `line-rich-menu-v2-ver1` profile without weakening the existing LINE signature, idempotency, identity, company, entitlement, permission, scope, audit, or final-mutation boundaries.

## Architecture fit

- Keep deterministic cards and command parsing in `line-staff-menu.logic.ts`.
- Keep webhook ordering, identity/company resolution, permissions, audit, and delivery in `process-line-webhook.use-case.ts`.
- Reuse `FEATURE_CATALOG`, `loadEntitledFeatureKeys`, the existing receipt prompt, expense-summary semantic query, company-context storage, and LINE reply adapter.
- Do not add a dependency, database table, AI prompt, or new final-mutation path.
- Keep LINE console provisioning manual for this release; commit the production bitmap and exact coordinate/action manifest for repeatable setup.

## Implementation

### 1. Production asset and manifest

- Add the opaque `2500 x 1686` PNG below LINE's 1 MB limit.
- Remove the drawn bottom menu strip while preserving the approved Ver1 composition.
- Add a versioned six-area manifest with exact action payloads and the image SHA-256.
- Validate image header, file size, checksum, area coverage, overlap, and action mapping with one Node test.

### 2. Deterministic cards

- Add the public contact Flex card with exact email, phone, telephone URI, and official-site button.
- Add the company-entitlement service card using only enabled sellable top-level `FEATURE_CATALOG` entries; preserve legacy `null` fail-open behavior.
- Add the compact current-company card containing only company name, display name, and resolved role labels.
- Keep owner switching on immutable company IDs and show owner-company choices only to owners.

### 3. Webhook routing and gates

- Handle `ติดต่อเรา` immediately after the webhook event claim, before identity and AI opt-out gates; it remains behind the verified controller and idempotency claim.
- Handle `บริการของเรา` after linked identity, selected company, legal acceptance, permissions, and entitlement resolution but before the AI feature/provider path.
- Handle `ถ่ายใบเสร็จ` before the AI feature/provider path, but send the capture prompt only when both `expenses.upload` and a canonical receipt-capture permission pass.
- Leave `ดูค่าใช้จ่ายเดือนนี้` on the existing scoped semantic read path.
- Leave `คุยกับน้องมั่งมี` as LINE's client-side `openKeyboard` postback; no server turn occurs on the tap.
- Leave `เริ่มต้นใช้งานฟรี` as a public HTTPS URI action with no tenant/user query data.

### 4. Company context

- `/companies` returns the current-company card to every linked active user.
- When the current membership is owner, append the active owner-company switcher; non-owners receive no switcher.
- Preserve current owner-only multi-company policy and re-check active owner membership on every switch.
- Keep current-company selection first and paginate the picker without silently dropping reachable company names.

### 5. Verification

- Pure logic tests: command mapping, exact contact values/actions, service entitlement combinations, current-company card fields, owner picker ordering/pagination, and receipt permission/feature combinations.
- Webhook tests: public contact before identity/opt-out/model, service and receipt before AI provider, linked/non-owner/owner company card behavior, stale/forbidden switch, and deterministic delivery failures.
- Regression: existing LINE staff-menu, webhook, adapter, classifier, entitlement, and type checks.
- Asset test: exact dimensions, opaque PNG, `< 1 MB`, checksum, six non-overlapping areas covering the canvas, exact actions.

## Release boundary

- This PR does not deploy or change the live LINE OA. The owner uploads the committed bitmap and configures the committed manifest in LINE Console.
- Before any UAT/Production deployment, follow [[runbooks/uat-production-v2-deployment|UAT/Production V2 deployment protocol]].
- Keep the current live rich menu available as the rollback target until Ver1 passes real LINE iOS/Android smoke checks.

Operator steps and the exact six-area mapping are recorded in [[runbooks/line-rich-menu-v2-console-setup|LINE Rich Menu V2 Console Setup]]. Uploading the bitmap may happen before deploy, but making it the default must wait until the backend containing these handlers is deployed.

## Done when

- Focused and regression checks pass.
- Docs and agent memory contain the implementation evidence.
- The PR contains only LINE Rich Menu V2 files and does not include unrelated dirty reimbursement work.
