# F0 Inventory — API HTTP Surface (lane S2)

generated 2026-07-31 | git HEAD `ba91c102c49ab7964697a540a2f63d42a497aa6a` | branch `develop` | lane S2 (API route surface inventory)

Scope: every HTTP route handler in `apps/api` (all `@Controller` classes, including app-level/webhook/internal-worker/dev routes). Mechanical inventory only — no design, no code changes.
Machine-readable twin: `scratchpad/f0/s2-api.json` (same rows, same columns + `featureDetail` per-permission derivation).

## 1. Method

- **Enumeration**: all 543 `@Get/@Post/@Put/@Patch/@Delete` decorators under `apps/api/src` (excluding `*.spec.ts`) parsed from the 81 files containing `@Controller(`; count cross-checked against `grep -rnE "@(Get|Post|Put|Patch|Delete|All|Head)\("` = 543. Five single-line handlers in `crm-campaign.controller.ts:11-15` were transcribed by hand.
- **Paths**: `app.setGlobalPrefix('v1')` (`main.ts:95`), excluding `local-storage/(.*)` (`main.ts:96`) — those two rows keep an unprefixed path.
- **Guards**: `DenyByDefaultGuard` (`common/security/deny-by-default.guard.ts:17-49`) requires `@Public()` or non-empty `@RequirePermissions(...)` metadata; **0 handlers have neither**, so there is no unguarded-by-omission route.
- **featureKey derivation** mirrors `filterPermissionsByEntitlement` (`modules/employee-access/domain/logic/feature-gate.logic.ts:75-88`) in its exact order: (1) `FEATURE_CATALOG` submenu rule (renders as `parent+submenu`), (2) `PREFIX_FEATURE_RULES` (`:39-50`), (3) ungated capability pack → not strippable, (4) gated pack `featureEntitlementKey`, (5) otherwise kept. `UNMAPPED` = no feature key owns the permission; `NONE` = no permission guard at all. Multi-permission handlers list every owner joined by `&` (the guard is `hasAll`, so **any** owner being OFF closes the route).
- **mutationClass rule** (applied in this order): `SYSTEM` = prefix `internal/*`, `health`, `local-storage`, `test`, or `POST /v1/auth/dev/token`; `READ` = GET, plus POSTs that only preview/validate/query without changing business state; `FINAL_MUTATION` = posting/approval-to-terminal state, external send (LINE message, campaign, email, credential/QR issue), or revocation/erasure; `ROOT_MUTATION` = everything else (create/update/draft/config/state-flag, incl. submit-for-approval, assign, archive, upload completion, snapshot/report generation). Keyword hits that contradicted this rule were overridden per row — every override is recorded in the row `Notes`.
- **entitlementEnforcement**: `PERMISSION_STRIP` = the request context is built by `ResolveRequestContextUseCase → PermissionResolverService → PrismaPermissionResolverRepository` which applies the chokepoint at `modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:73`, and at least one required permission is strippable. `EXPLICIT_GUARD` = an additional in-code feature check (cited per row). `NONE` = the chokepoint cannot fire: `@Public` route (no permission resolution) or the guard permission is UNMAPPED/ungated so it is never stripped.

## 2. Summary counts

Total endpoints: **543** across 22 modules / 91 controller classes.

| mutationClass | count | | entitlementEnforcement | count |
| --- | ---: | --- | --- | ---: |
| READ | 214 | | PERMISSION_STRIP | 455 |
| ROOT_MUTATION | 180 | | EXPLICIT_GUARD | 5 |
| FINAL_MUTATION | 115 | | NONE (chokepoint bypassed) | 83 |
| SYSTEM | 34 | | | |

twoStep (preview→apply) endpoints: **14** (7 pairs). BLOCKED rows: **6**.

### 2.1 The NONE set (endpoints the entitlement chokepoint cannot reach)

83 total = 48 `@Public` (webhook / LIFF / auth / internal-worker / dev) + 35 permission-guarded but entitlement-blind (guard permission is UNMAPPED/ungated).

| # | Method + path | why NONE |
| ---: | --- | --- |
| 1 | `POST /v1/internal/ai/draft-requests/drain` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 2 | `POST /v1/internal/ai/draft-requests/generate` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 3 | `GET /v1/audit/logs` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 4 | `GET /v1/auth/login-channels` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 5 | `POST /v1/auth/password/login` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 6 | `POST /v1/auth/password/reset-request` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 7 | `POST /v1/auth/dev/token` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 8 | `POST /v1/auth/line/exchange` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 9 | `GET /v1/auth/line/link-page` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 10 | `GET /v1/auth/line/link-page.js` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 11 | `GET /v1/auth/[line/link-page/employee, line/employee-link-page]` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 12 | `POST /v1/auth/line/employee-link` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 13 | `GET /v1/auth/account/security` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 14 | `POST /v1/auth/account/email/resend` | mutationClass override: sends a verification email (external) |
| 15 | `POST /v1/auth/account/email/verify` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 16 | `POST /v1/auth/session/refresh` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 17 | `POST /v1/auth/logout` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 18 | `POST /v1/auth/sessions/revoke-others` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 19 | `GET /v1/auth/me` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 20 | `GET /v1/auth/me/companies` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 21 | `POST /v1/internal/crm/trust-score-scan` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 22 | `POST /v1/crm-customer/pdpa/consent-withdraw` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 23 | `POST /v1/crm-customer/pdpa/data-export` | mutationClass override: returns customer-visible export; no state change |
| 24 | `POST /v1/crm-customer/pdpa/erasure-request` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 25 | `POST /v1/crm-customer/pdpa/erasure-status` | mutationClass override: status read |
| 26 | `POST /v1/internal/crm/campaign-delivery-scan` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 27 | `POST /v1/internal/crm/sla-breach-scan` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 28 | `POST /v1/internal/crm/new-conversation-scan` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 29 | `POST /v1/internal/crm/inbox-retry-scan` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 30 | `POST /v1/internal/crm/autonomy-retry-scan` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 31 | `POST /v1/internal/crm/booking-reminder-scan` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 32 | `POST /v1/internal/crm/booking-proposal-sweep` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 33 | `POST /v1/internal/crm/pdpa-purge` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 34 | `POST /v1/internal/crm/pdpa-erasure-process` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 35 | `POST /v1/internal/crm/pdpa-post-restore-re-erasure` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 36 | `POST /v1/crm/line/webhook/:webhookKey` | mutationClass override: autonomous AI replies to the end customer over LINE (externally visible) |
| 37 | `POST /v1/auth/line/customer-register` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 38 | `GET /v1/auth/line/customer-register-page` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 39 | `POST /v1/internal/notifications/delivery-sweep` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 40 | `POST /v1/internal/notifications/snapshot-sweep` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 41 | `POST /v1/internal/notifications/stock-low-sweep` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 42 | `POST /v1/internal/notifications/daily-owner-summary-sweep` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 43 | `POST /v1/internal/companies/:companyId/dashboard/snapshots/generate` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 44 | `POST /v1/internal/companies/:companyId/notifications/scan/stock-low` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 45 | `POST /v1/internal/companies/:companyId/notifications/daily-owner-summary` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 46 | `POST /v1/internal/companies/:companyId/notification-deliveries/:deliveryId/process` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 47 | `POST /v1/companies/:companyId/attachments/upload-intent` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 48 | `POST /v1/companies/:companyId/attachments/:attachmentId/complete` | mutationClass override: upload completion, not a business finalization |
| 49 | `GET /v1/companies/:companyId/attachments/:attachmentId/download-url` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 50 | `POST /v1/companies/:companyId/attachments/:attachmentId/links` | mutationClass override: attachment link row; keyword "link" false positive |
| 51 | `DELETE /v1/companies/:companyId/attachments/:attachmentId` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 52 | `GET /v1/companies/:companyId/document-sequences` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 53 | `PUT /v1/companies/:companyId/document-sequences/:documentType` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 54 | `PUT /local-storage/upload/:token` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 55 | `GET /local-storage/download/:token` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 56 | `GET /v1/companies/:companyId/expense-settings/substitute-receipt` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 57 | `PATCH /v1/companies/:companyId/expense-settings/substitute-receipt` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 58 | `GET /v1/internal/health/readiness` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 59 | `GET /v1/health` | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| 60 | `GET /v1/test/protected` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 61 | `POST /v1/internal/ai/line-ledger/drain` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 62 | `POST /v1/system/company-onboardings` | mutationClass override: provisions tenant + issues one-time credential |
| 63 | `GET /v1/system/company-onboardings/:id` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 64 | `POST /v1/system/company-onboardings/:id/regenerate-temporary-password` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 65 | `POST /v1/system/company-onboardings/:id/reissue-owner-line-link` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 66 | `GET /v1/system/partners` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 67 | `GET /v1/system/partners/:partnerCompanyId` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 68 | `PATCH /v1/system/partners/:partnerCompanyId` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 69 | `POST /v1/system/partners/:partnerCompanyId/lifecycle` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 70 | `GET /v1/system/partners/:partnerCompanyId/members` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 71 | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/line-unlink` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 72 | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/password/reset` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 73 | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/password/reveal` | mutationClass override: audited sensitive read; no state change |
| 74 | `PUT /v1/system/partners/:partnerCompanyId/features` | mutationClass override: ENTITLEMENT CONTROL-PLANE writer; guard set-partner-features.use-case.ts:52-75 |
| 75 | `PUT /v1/system/partners/:partnerCompanyId/ai-model` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 76 | `GET /v1/system/partners/:partnerCompanyId/ai-usage` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 77 | `GET /v1/system/ai-budget` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 78 | `PUT /v1/system/ai-budget` | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| 79 | `PUT /v1/system/line/shared-credentials/:credentialKind` | mutationClass override: platform LINE credential replacement |
| 80 | `POST /v1/internal/workflow/events/ingest` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 81 | `POST /v1/internal/workflow/outbox/drain` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 82 | `POST /v1/internal/workflow/scan` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| 83 | `POST /v1/internal/workflow/action-runs/retry` | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |

### 2.2 EXPLICIT_GUARD set

| Method + path | guard evidence |
| --- | --- |
| `POST /v1/line/webhook` | ai_line_assistant gate: process-line-webhook.use-case.ts:409-412, called at :596 and :1200; permissions also re-resolved through the chokepoint at :615 |
| `POST /v1/webhooks/line` | same ProcessLineWebhookUseCase as POST /v1/line/webhook (line-webhook.controller.ts:44) => same ai_line_assistant gate at process-line-webhook.use-case.ts:409-412 |
| `POST /v1/internal/ledger/expense-auto-post/drain` | company selection filters double_entry_ledger + expense_auto_post (expense-auto-post.use-case.ts:89-96); worker token otherwise |
| `GET /v1/companies/:companyId/posting/expense-backfill-preview` | expense-backfill.use-case.ts:89-110 requires double_entry_ledger + expense_auto_post (throws expense_auto_post_not_enabled); PERMISSION_STRIP also applies |
| `POST /v1/companies/:companyId/posting/expense-backfill` | expense-backfill.use-case.ts:89-110 requires double_entry_ledger + expense_auto_post; PERMISSION_STRIP also applies |

### 2.3 BLOCKED rows

| Method + path | what is missing |
| --- | --- |
| `GET /v1/companies/:companyId/expense-settings/substitute-receipt` | BLOCKED: Expenses feature screen (ใบรับรองแทนใบเสร็จ policy) guarded by company.setup.manage, which pack.company.settings.manage leaves UNGATED (capability-pack.registry.ts:43-61) => survives expenses=OFF. Missing: owner decision on which feature key owns expense-settings. |
| `PATCH /v1/companies/:companyId/expense-settings/substitute-receipt` | BLOCKED: same as the GET — company.setup.manage is ungated, so this write survives expenses=OFF. Missing: feature owner for expense-settings. |
| `GET /v1/test/protected` | BLOCKED: requires permission health.read, which does not exist in permission-registry.ts (336 keys) => no role can hold it and no feature owns it. Missing: delete the route or register the permission. |
| `GET /v1/companies/:companyId/tax/code-definitions` | BLOCKED: Thai-tax surface guarded by company.branch.read (always-on company_settings submenu) => survives thai_tax=OFF. Missing: correct tax.* permission or explicit owner decision. |
| `POST /v1/companies/:companyId/tax/resolve-preview` | BLOCKED: Thai-tax resolve preview guarded by company.branch.read => survives thai_tax=OFF. Missing: correct tax.* permission or explicit owner decision. |
| `POST /v1/companies/:companyId/tax/trade-evidence` | BLOCKED: Thai-tax trade-evidence create guarded by company.branch.read => survives thai_tax=OFF. Missing: correct tax.* permission or explicit owner decision. |

### 2.4 twoStep pairs

| Method + path | note |
| --- | --- |
| `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/preview` | twoStep: pairs with .../statement-imports/commit (statement.controller.ts:63-93) |
| `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/commit` | twoStep: client re-posts previewed rows; no server-side preview token |
| `POST /v1/companies/:companyId/crm/customers/merge/preview` | twoStep: pairs with POST crm/customers/merge (crm-customer.controller.ts:77-88) |
| `POST /v1/companies/:companyId/crm/customers/merge` | twoStep: same MergeCrmCustomersInput as the preview; no preview token |
| `GET /v1/companies/:companyId/chart-of-accounts/templates/:templateKey/preview` | twoStep: pairs with POST .../apply (ApplyChartTemplateDto.expectedPreviewChecksum, ledger.dtos.ts:55-60) |
| `POST /v1/companies/:companyId/chart-of-accounts/templates/:templateKey/apply` | twoStep: requires expectedTemplateChecksum + expectedPreviewChecksum from the preview (ledger.dtos.ts:55-60) |
| `GET /v1/companies/:companyId/posting/expense-backfill-preview` | twoStep: canonical seam: pairs with POST posting/expense-backfill {confirmed:true} (ledger.controller.ts:176-192) |
| `POST /v1/companies/:companyId/posting/expense-backfill` | twoStep: body {confirmed:boolean} (ledger.controller.ts:189) — stateless confirmation, CC3 replaces it |
| `POST /v1/companies/:companyId/tax/code-profiles/:profileId/import-preview` | twoStep: pairs with .../import-apply (transaction-tax.controller.ts:111-122) |
| `POST /v1/companies/:companyId/tax/code-profiles/:profileId/import-apply` | twoStep: apply half of the preview/apply pair |
| `POST /v1/companies/:companyId/tax/legacy-remediation/preview` | twoStep: pairs with .../legacy-remediation/apply (transaction-tax.controller.ts:165-176) |
| `POST /v1/companies/:companyId/tax/legacy-remediation/apply` | twoStep: apply half of the preview/apply pair |
| `POST /v1/companies/:companyId/crm/campaigns/:id/preview` | twoStep: pairs with POST crm/campaigns/:id/send (crm-campaign.controller.ts:13-14) |
| `POST /v1/companies/:companyId/crm/campaigns/:id/send` | twoStep: send half of the preview/send pair |

## 3. Per-module endpoint tables

Columns: handler · method+path · permission keys (guard evidence `file:line`) · featureKey · mutationClass · entitlementEnforcement · twoStep · status · notes. Handler evidence line = the handler signature line in the controller file named in the sub-heading.

### accounting-documents (18)

**`accounting-documents/presentation/http/accounting-document.controller.ts`** — class `AccountingDocumentController` @22

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:39 | `GET /v1/companies/:companyId/accounting/documents` | accounting.document.read (guard L37) | sales_documents | READ | PERMISSION_STRIP |  | OK |  |
| getOne:65 | `GET /v1/companies/:companyId/accounting/documents/:documentId` | accounting.document.read (guard L63) | sales_documents | READ | PERMISSION_STRIP |  | OK |  |
| getPostingSource:72 | `GET /v1/companies/:companyId/accounting/documents/:documentId/posting-source` | accounting.document.read (guard L70) | sales_documents | READ | PERMISSION_STRIP |  | OK |  |
| create:79 | `POST /v1/companies/:companyId/accounting/documents` | accounting.document.create (guard L77) | sales_documents | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| issue:87 | `POST /v1/companies/:companyId/accounting/documents/:documentId/issue` | accounting.document.issue (guard L84) | sales_documents | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| void:95 | `POST /v1/companies/:companyId/accounting/documents/:documentId/void` | accounting.document.void (guard L92) | sales_documents | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| submitApprovalAction:103 | `POST /v1/companies/:companyId/accounting/documents/:documentId/submit-approval` | accounting.quotation.submit_approval (guard L100) | sales_documents | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: submit-for-approval transition, not terminal |
| approve:111 | `POST /v1/companies/:companyId/accounting/documents/:documentId/approve` | accounting.quotation.approve (guard L108) | sales_documents | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| reject:119 | `POST /v1/companies/:companyId/accounting/documents/:documentId/reject` | accounting.quotation.approve (guard L116) | sales_documents | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| convert:127 | `POST /v1/companies/:companyId/accounting/documents/:documentId/convert` | accounting.document.create (guard L124) | sales_documents | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: creates downstream draft (accounting.document.create) |

**`accounting-documents/presentation/http/accounting-payment.controller.ts`** — class `AccountingPaymentController` @16

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:27 | `GET /v1/companies/:companyId/accounting/payments` | accounting.payment.read (guard L25) | sales_documents | READ | PERMISSION_STRIP |  | OK |  |
| getOne:49 | `GET /v1/companies/:companyId/accounting/payments/:paymentId` | accounting.payment.read (guard L47) | sales_documents | READ | PERMISSION_STRIP |  | OK |  |
| create:56 | `POST /v1/companies/:companyId/accounting/payments` | accounting.payment.create (guard L54) | sales_documents | FINAL_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: records a received payment (financial fact) |
| void:64 | `POST /v1/companies/:companyId/accounting/payments/:paymentId/void` | accounting.payment.void (guard L61) | sales_documents | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`accounting-documents/presentation/http/counterparty.controller.ts`** — class `CounterpartyController` @35

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listCounterparties:46 | `GET /v1/companies/:companyId/accounting/counterparties` | accounting.counterparty.read (guard L44) | sales_documents | READ | PERMISSION_STRIP |  | OK |  |
| getCounterparty:57 | `GET /v1/companies/:companyId/accounting/counterparties/:counterpartyId` | accounting.counterparty.read (guard L55) | sales_documents | READ | PERMISSION_STRIP |  | OK |  |
| createCounterparty:67 | `POST /v1/companies/:companyId/accounting/counterparties` | accounting.counterparty.manage (guard L65) | sales_documents | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| updateCounterparty:77 | `PATCH /v1/companies/:companyId/accounting/counterparties/:counterpartyId` | accounting.counterparty.manage (guard L75) | sales_documents | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

### ai-draft (10)

**`ai-draft/presentation/http/ai-draft-internal.controller.ts`** — class `AiDraftInternalController` @14

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| drainQueued:21 | `POST /v1/internal/ai/draft-requests/drain` | — (@Public L12) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| generateOne:27 | `POST /v1/internal/ai/draft-requests/generate` | — (@Public L12) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |

**`ai-draft/presentation/http/ai-suggestion.controller.ts`** — class `AiSuggestionController` @29

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| request:43 | `POST /v1/companies/:companyId/ai/suggestions/requests` | ai.suggestion.request (guard L40) | ai_line_assistant | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| listSuggestions:50 | `GET /v1/companies/:companyId/ai/suggestions` | ai.suggestion.read_own (guard L48) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK |  |
| getDetail:72 | `GET /v1/companies/:companyId/ai/suggestions/:id` | ai.suggestion.read_own (guard L70) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK |  |
| validateAction:80 | `POST /v1/companies/:companyId/ai/suggestions/:id/actions/:actionId/validate` | ai.draft.review (guard L77) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK |  |
| createDraft:88 | `POST /v1/companies/:companyId/ai/suggestions/:id/actions/:actionId/create-source-draft` | ai.draft.create_source_draft (guard L85) | ai_line_assistant | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| reviewSuggestion:101 | `POST /v1/companies/:companyId/ai/suggestions/:id/reviews` | ai.suggestion.review (guard L98) | ai_line_assistant | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`ai-draft/presentation/http/ai-template.controller.ts`** — class `AiTemplateController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listTemplates:19 | `GET /v1/companies/:companyId/ai/suggestion-templates` | ai.suggestion.read_own (guard L17) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK |  |
| provider:26 | `GET /v1/companies/:companyId/ai/provider-status` | ai.suggestion.read_own (guard L24) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK |  |

### audit (1)

**`audit/presentation/audit.controller.ts`** — class `AuditController` @27

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| getLogs:40 | `GET /v1/audit/logs` | audit.log.read (guard L31) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| audit.log.read sits in pack.audit.read with NO featureEntitlementKey (capability-pack.registry.ts:82-86) => never stripped; audit spans all features |

### auth (24)

**`auth/presentation/auth.controller.ts`** — class `AuthController` @130

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| loginChannels:159 | `GET /v1/auth/login-channels` | — (@Public L156) | NONE | READ | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| passwordLoginWithCredentials:171 | `POST /v1/auth/password/login` | — (@Public L163) | NONE | ROOT_MUTATION | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| requestPasswordResetNotice:210 | `POST /v1/auth/password/reset-request` | — (@Public L203) | NONE | FINAL_MUTATION | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| devToken:228 | `POST /v1/auth/dev/token` | — (@Public L221) | NONE | SYSTEM | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| lineExchange:271 | `POST /v1/auth/line/exchange` | — (@Public L265) | NONE | FINAL_MUTATION | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| lineLinkPage:285 | `GET /v1/auth/line/link-page` | — (@Public L278) | NONE | READ | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| lineLinkPageScript:322 | `GET /v1/auth/line/link-page.js` | — (@Public L316) | NONE | READ | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| lineLink:357 | `POST /v1/auth/line/link` | account.identity.link (guard L352) | company_settings+company_settings.security | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| employeeLineLinkPage:376 | `GET /v1/auth/[line/link-page/employee, line/employee-link-page]` | — (@Public L368) | NONE | READ | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| employeeLineLink:416 | `POST /v1/auth/line/employee-link` | — (@Public L409) | NONE | FINAL_MUTATION | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| lineUnlink:430 | `POST /v1/auth/line/unlink` | account.identity.unlink (guard L426) | company_settings+company_settings.security | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| changeCurrentPassword:440 | `POST /v1/auth/password/change` | account.password.change (guard L436) | company_settings+company_settings.security | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| accountSecurityState:451 | `GET /v1/auth/account/security` | account.session.read (guard L448) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| setAiAssistantPreference:463 | `POST /v1/auth/account/ai-assistant` | account.password.change (guard L459) | company_settings+company_settings.security | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| requestAccountEmailChange:476 | `POST /v1/auth/account/email` | account.password.change (guard L472) | company_settings+company_settings.security | FINAL_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: sends a verification email (external) |
| resendAccountEmailVerification:494 | `POST /v1/auth/account/email/resend` | account.session.read (guard L491) | UNMAPPED | FINAL_MUTATION | NONE |  | OK | mutationClass override: sends a verification email (external) \| guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| verifyAccountEmail:508 | `POST /v1/auth/account/email/verify` | — (@Public L502) | NONE | FINAL_MUTATION | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| refresh:523 | `POST /v1/auth/session/refresh` | — (@Public L516) | NONE | ROOT_MUTATION | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| logoutSession:532 | `POST /v1/auth/logout` | account.session.read (guard L529) | UNMAPPED | ROOT_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| revokeOtherActiveSessions:543 | `POST /v1/auth/sessions/revoke-others` | account.session.read (guard L540) | UNMAPPED | FINAL_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| me:557 | `GET /v1/auth/me` | account.session.read (guard L554) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| myCompanies:584 | `GET /v1/auth/me/companies` | account.session.read (guard L581) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |

**`auth/presentation/line-webhook.controller.ts`** — class `LineWebhookController` @22

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lineWebhook:36 | `POST /v1/line/webhook` | — (@Public L30) | NONE | FINAL_MUTATION | EXPLICIT_GUARD |  | OK | mutationClass override: AI fan-out replies over LINE (externally visible) and can create expense drafts \| ai_line_assistant gate: process-line-webhook.use-case.ts:409-412, called at :596 and :1200; permissions also re-resolved through the chokepoint at :615 |
| legacyLineWebhook:44 | `POST /v1/webhooks/line` | — (@Public L40) | NONE | FINAL_MUTATION | EXPLICIT_GUARD |  | OK | mutationClass override: legacy alias of POST /v1/line/webhook \| same use case as POST /v1/line/webhook (line-webhook.controller.ts:44) |

### banking (29)

**`banking/presentation/http/adjustment.controller.ts`** — class `AdjustmentController` @18

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:31 | `GET /v1/companies/:companyId/banking/adjustments` | bank.adjustment.read (guard L29) | bank_reconciliation+bank_reconciliation.adjustments & bank_reconciliation | READ | PERMISSION_STRIP |  | OK |  |
| getOne:38 | `GET /v1/companies/:companyId/banking/adjustments/:id` | bank.adjustment.read (guard L36) | bank_reconciliation+bank_reconciliation.adjustments & bank_reconciliation | READ | PERMISSION_STRIP |  | OK |  |
| create:45 | `POST /v1/companies/:companyId/banking/adjustments` | bank.adjustment.create (guard L43) | bank_reconciliation+bank_reconciliation.adjustments & bank_reconciliation | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| submit:53 | `POST /v1/companies/:companyId/banking/adjustments/:id/submit` | bank.adjustment.create (guard L50) | bank_reconciliation+bank_reconciliation.adjustments & bank_reconciliation | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: submit-for-approval transition |
| approve:61 | `POST /v1/companies/:companyId/banking/adjustments/:id/approve` | bank.adjustment.approve (guard L58) | bank_reconciliation+bank_reconciliation.adjustments & bank_reconciliation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| void:73 | `POST /v1/companies/:companyId/banking/adjustments/:id/void` | bank.adjustment.void (guard L70) | bank_reconciliation+bank_reconciliation.adjustments & bank_reconciliation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`banking/presentation/http/bank-account.controller.ts`** — class `BankAccountController` @17

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:29 | `GET /v1/companies/:companyId/banking/bank-accounts` | bank.account.read (guard L27) | bank_reconciliation+bank_reconciliation.accounts & bank_reconciliation | READ | PERMISSION_STRIP |  | OK |  |
| getOne:36 | `GET /v1/companies/:companyId/banking/bank-accounts/:bankAccountId` | bank.account.read (guard L34) | bank_reconciliation+bank_reconciliation.accounts & bank_reconciliation | READ | PERMISSION_STRIP |  | OK |  |
| create:43 | `POST /v1/companies/:companyId/banking/bank-accounts` | bank.account.manage (guard L41) | bank_reconciliation+bank_reconciliation.accounts & bank_reconciliation | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| update:50 | `PATCH /v1/companies/:companyId/banking/bank-accounts/:bankAccountId` | bank.account.manage (guard L48) | bank_reconciliation+bank_reconciliation.accounts & bank_reconciliation | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| deactivate:58 | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/deactivate` | bank.account.manage (guard L55) | bank_reconciliation+bank_reconciliation.accounts & bank_reconciliation | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: account status flag, reversible |

**`banking/presentation/http/matching.controller.ts`** — class `MatchingController` @16

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listCandidates:28 | `GET /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/match-candidates` | bank.match.read (guard L26) | bank_reconciliation+bank_reconciliation.matching & bank_reconciliation | READ | PERMISSION_STRIP |  | OK |  |
| confirm:35 | `POST /v1/companies/:companyId/banking/statement-lines/:statementLineId/matches` | bank.match.confirm (guard L33) | bank_reconciliation+bank_reconciliation.matching & bank_reconciliation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| reject:47 | `POST /v1/companies/:companyId/banking/matches/:matchId/reject` | bank.match.confirm (guard L44) | bank_reconciliation+bank_reconciliation.matching & bank_reconciliation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| void:59 | `POST /v1/companies/:companyId/banking/matches/:matchId/void` | bank.match.unmatch (guard L56) | bank_reconciliation+bank_reconciliation.matching & bank_reconciliation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| ignore:67 | `POST /v1/companies/:companyId/banking/statement-lines/:statementLineId/ignore` | bank.match.override (guard L64) | bank_reconciliation+bank_reconciliation.matching & bank_reconciliation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`banking/presentation/http/reconciliation.controller.ts`** — class `ReconciliationController` @18

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:31 | `GET /v1/companies/:companyId/banking/reconciliations` | bank.reconciliation.read (guard L29) | bank_reconciliation+bank_reconciliation.reconciliations & bank_reconciliation | READ | PERMISSION_STRIP |  | OK |  |
| create:38 | `POST /v1/companies/:companyId/banking/reconciliations` | bank.reconciliation.create (guard L36) | bank_reconciliation+bank_reconciliation.reconciliations & bank_reconciliation | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| getOne:45 | `GET /v1/companies/:companyId/banking/reconciliations/:sessionId` | bank.reconciliation.read (guard L43) | bank_reconciliation+bank_reconciliation.reconciliations & bank_reconciliation | READ | PERMISSION_STRIP |  | OK |  |
| complete:53 | `POST /v1/companies/:companyId/banking/reconciliations/:sessionId/complete` | bank.reconciliation.complete (guard L50) | bank_reconciliation+bank_reconciliation.reconciliations & bank_reconciliation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| reopen:65 | `POST /v1/companies/:companyId/banking/reconciliations/:sessionId/reopen` | bank.reconciliation.reopen (guard L62) | bank_reconciliation+bank_reconciliation.reconciliations & bank_reconciliation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| cashPosition:76 | `GET /v1/companies/:companyId/banking/cash-position` | bank.cash.read (guard L74) | bank_reconciliation+bank_reconciliation.cash & bank_reconciliation | READ | PERMISSION_STRIP |  | OK |  |

**`banking/presentation/http/statement.controller.ts`** — class `StatementController` @19

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| extract:34 | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/extract` | bank.statement.import (guard L31) | bank_reconciliation+bank_reconciliation.import & bank_reconciliation | READ | PERMISSION_STRIP |  | OK | mutationClass override: AI extraction returns rows; audit only, no business record (statement-import.use-case.ts:81) |
| listLines:45 | `GET /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-lines` | bank.statement.read (guard L43) | bank_reconciliation+bank_reconciliation.import & bank_reconciliation | READ | PERMISSION_STRIP |  | OK |  |
| listImports:56 | `GET /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports` | bank.statement.read (guard L54) | bank_reconciliation+bank_reconciliation.import & bank_reconciliation | READ | PERMISSION_STRIP |  | OK |  |
| preview:67 | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/preview` | bank.statement.import (guard L64) | bank_reconciliation+bank_reconciliation.import & bank_reconciliation | READ | PERMISSION_STRIP | yes | OK | twoStep: pairs with .../statement-imports/commit (statement.controller.ts:63-93) |
| commit:78 | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/commit` | bank.statement.import (guard L76) | bank_reconciliation+bank_reconciliation.import & bank_reconciliation | FINAL_MUTATION | PERMISSION_STRIP | yes | OK | twoStep: client re-posts previewed rows; no server-side preview token |
| createManualLine:100 | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-lines` | bank.statement.manual_line (guard L98) | bank_reconciliation | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| void:112 | `POST /v1/companies/:companyId/banking/statement-imports/:importId/void` | bank.statement.void (guard L109) | bank_reconciliation+bank_reconciliation.import & bank_reconciliation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

### crm (53)

**`crm/presentation/http/crm-ai.controller.ts`** — class `CrmAiController` @16

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dashboard:28 | `GET /v1/companies/:companyId/crm/dashboard/summary` | crm.report.read (guard L26) | crm+crm.overview & crm | READ | PERMISSION_STRIP |  | OK |  |
| priorities:35 | `GET /v1/companies/:companyId/crm/ai/follow-up-priorities` | crm.ai.read (guard L33) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE by design: crm.ai.* follows ai_line_assistant, not crm (feature-gate.logic.ts:27-30,46) |
| customer:42 | `GET /v1/companies/:companyId/crm/ai/customers/:customerId/summary` | crm.ai.read (guard L40) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE by design: crm.ai.* follows ai_line_assistant (feature-gate.logic.ts:46) |
| opportunity:49 | `GET /v1/companies/:companyId/crm/ai/opportunities/:opportunityId/summary` | crm.ai.read (guard L47) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE by design: crm.ai.* follows ai_line_assistant (feature-gate.logic.ts:46) |
| pipeline:56 | `GET /v1/companies/:companyId/crm/ai/pipeline-summary` | crm.ai.read (guard L54) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE by design: crm.ai.* follows ai_line_assistant (feature-gate.logic.ts:46) |

**`crm/presentation/http/crm-booking.controller.ts`** — class `CrmBookingController` @18

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| settings:32 | `GET /v1/companies/:companyId/crm/bookings/settings` | crm.booking.read (guard L30) | crm+crm.bookings & crm | READ | PERMISSION_STRIP |  | OK |  |
| updateSettingsValue:39 | `PATCH /v1/companies/:companyId/crm/bookings/settings` | crm.booking.update (guard L37) | crm+crm.bookings & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| list:46 | `GET /v1/companies/:companyId/crm/bookings` | crm.booking.read (guard L44) | crm+crm.bookings & crm | READ | PERMISSION_STRIP |  | OK |  |
| availability:53 | `GET /v1/companies/:companyId/crm/bookings/availability` | crm.booking.read (guard L51) | crm+crm.bookings & crm | READ | PERMISSION_STRIP |  | OK |  |
| byCustomer:67 | `GET /v1/companies/:companyId/crm/bookings/by-customer/:customerId` | crm.booking.read (guard L65) | crm+crm.bookings & crm | READ | PERMISSION_STRIP |  | OK |  |
| create:74 | `POST /v1/companies/:companyId/crm/bookings` | crm.booking.create (guard L72) | crm+crm.bookings & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| update:81 | `PATCH /v1/companies/:companyId/crm/bookings/:bookingId` | crm.booking.update (guard L79) | crm+crm.bookings & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| cancel:88 | `POST /v1/companies/:companyId/crm/bookings/:bookingId/cancel` | crm.booking.cancel (guard L86) | crm+crm.bookings & crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`crm/presentation/http/crm-customer.controller.ts`** — class `CrmCustomerController` @36

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:55 | `GET /v1/companies/:companyId/crm/customers` | crm.customer.read (guard L53) | crm+crm.customers & crm | READ | PERMISSION_STRIP |  | OK |  |
| create:73 | `POST /v1/companies/:companyId/crm/customers` | crm.customer.create (guard L71) | crm+crm.customers & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| previewCustomerMerge:80 | `POST /v1/companies/:companyId/crm/customers/merge/preview` | crm.customer.merge (guard L78) | crm+crm.customers & crm | READ | PERMISSION_STRIP | yes | OK | twoStep: pairs with POST crm/customers/merge (crm-customer.controller.ts:77-88) |
| mergeCustomer:87 | `POST /v1/companies/:companyId/crm/customers/merge` | crm.customer.merge (guard L85) | crm+crm.customers & crm | FINAL_MUTATION | PERMISSION_STRIP | yes | OK | twoStep: same MergeCrmCustomersInput as the preview; no preview token |
| get:94 | `GET /v1/companies/:companyId/crm/customers/:customerId` | crm.customer.read (guard L92) | crm+crm.customers & crm | READ | PERMISSION_STRIP |  | OK |  |
| update:101 | `PATCH /v1/companies/:companyId/crm/customers/:customerId` | crm.customer.update (guard L99) | crm+crm.customers & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| linkCustomerLineIdentity:108 | `POST /v1/companies/:companyId/crm/customers/:customerId/line-identities/:identityId/link` | crm.customer.merge (guard L106) | crm+crm.customers & crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| archive:120 | `POST /v1/companies/:companyId/crm/customers/:customerId/archive` | crm.customer.archive (guard L118) | crm+crm.customers & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: archive = internal state flag |
| assign:127 | `POST /v1/companies/:companyId/crm/customers/:customerId/assign` | crm.customer.assign (guard L125) | crm+crm.customers & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: ownership assignment, reversible |
| contacts:134 | `GET /v1/companies/:companyId/crm/customers/:customerId/contacts` | crm.contact.read (guard L132) | crm+crm.customers & crm | READ | PERMISSION_STRIP |  | OK |  |
| addContact:141 | `POST /v1/companies/:companyId/crm/customers/:customerId/contacts` | crm.contact.manage (guard L139) | crm+crm.customers & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| editContact:148 | `PATCH /v1/companies/:companyId/crm/contacts/:contactId` | crm.contact.manage (guard L146) | crm+crm.customers & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`crm/presentation/http/crm-follow-up.controller.ts`** — class `CrmFollowUpController` @26

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:39 | `GET /v1/companies/:companyId/crm/follow-ups` | crm.follow_up.read (guard L37) | crm+crm.followups & crm | READ | PERMISSION_STRIP |  | OK |  |
| create:57 | `POST /v1/companies/:companyId/crm/follow-ups` | crm.follow_up.create (guard L55) | crm+crm.followups & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| update:64 | `PATCH /v1/companies/:companyId/crm/follow-ups/:followUpId` | crm.follow_up.update (guard L62) | crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| complete:72 | `POST /v1/companies/:companyId/crm/follow-ups/:followUpId/complete` | crm.follow_up.complete (guard L69) | crm+crm.followups & crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| snooze:80 | `POST /v1/companies/:companyId/crm/follow-ups/:followUpId/snooze` | crm.follow_up.update (guard L77) | crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| cancel:88 | `POST /v1/companies/:companyId/crm/follow-ups/:followUpId/cancel` | crm.follow_up.update (guard L85) | crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`crm/presentation/http/crm-lead.controller.ts`** — class `CrmLeadController` @28

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:42 | `GET /v1/companies/:companyId/crm/leads` | crm.lead.read (guard L40) | crm+crm.leads & crm | READ | PERMISSION_STRIP |  | OK |  |
| create:59 | `POST /v1/companies/:companyId/crm/leads` | crm.lead.create (guard L57) | crm+crm.leads & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| get:66 | `GET /v1/companies/:companyId/crm/leads/:leadId` | crm.lead.read (guard L64) | crm+crm.leads & crm | READ | PERMISSION_STRIP |  | OK |  |
| update:73 | `PATCH /v1/companies/:companyId/crm/leads/:leadId` | crm.lead.update (guard L71) | crm+crm.leads & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| assign:81 | `POST /v1/companies/:companyId/crm/leads/:leadId/assign` | crm.lead.assign (guard L78) | crm+crm.leads & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: ownership assignment, reversible |
| convert:89 | `POST /v1/companies/:companyId/crm/leads/:leadId/convert` | crm.lead.convert (guard L86) | crm+crm.leads & crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| disqualify:97 | `POST /v1/companies/:companyId/crm/leads/:leadId/disqualify` | crm.lead.disqualify (guard L94) | crm+crm.leads & crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`crm/presentation/http/crm-opportunity.controller.ts`** — class `CrmOpportunityController` @41

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| stages:65 | `GET /v1/companies/:companyId/crm/pipeline/stages` | crm.opportunity.read (guard L63) | crm+crm.pipeline & crm | READ | PERMISSION_STRIP |  | OK |  |
| configureStages:72 | `PUT /v1/companies/:companyId/crm/pipeline/stages` | crm.pipeline.configure (guard L70) | crm+crm.pipeline & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| activities:81 | `GET /v1/companies/:companyId/crm/activities` | crm.activity.read (guard L79) | crm+crm.pipeline & crm | READ | PERMISSION_STRIP |  | OK |  |
| addActivity:97 | `POST /v1/companies/:companyId/crm/activities` | crm.activity.create (guard L95) | crm+crm.pipeline & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| pipelineBoard:106 | `GET /v1/companies/:companyId/crm/opportunities/board` | crm.opportunity.read (guard L104) | crm+crm.pipeline & crm | READ | PERMISSION_STRIP |  | OK |  |
| list:113 | `GET /v1/companies/:companyId/crm/opportunities` | crm.opportunity.read (guard L111) | crm+crm.pipeline & crm | READ | PERMISSION_STRIP |  | OK |  |
| create:131 | `POST /v1/companies/:companyId/crm/opportunities` | crm.opportunity.create (guard L129) | crm+crm.pipeline & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| get:138 | `GET /v1/companies/:companyId/crm/opportunities/:opportunityId` | crm.opportunity.read (guard L136) | crm+crm.pipeline & crm | READ | PERMISSION_STRIP |  | OK |  |
| update:145 | `PATCH /v1/companies/:companyId/crm/opportunities/:opportunityId` | crm.opportunity.update (guard L143) | crm+crm.pipeline & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| move:153 | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/stage` | crm.opportunity.stage_move (guard L150) | crm+crm.pipeline & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| closeOpportunity:161 | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/close` | crm.opportunity.close (guard L158) | crm+crm.pipeline & crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| reopenOpportunity:169 | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/reopen` | crm.opportunity.reopen (guard L166) | crm+crm.pipeline & crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| quotations:178 | `GET /v1/companies/:companyId/crm/opportunities/:opportunityId/quotations` | crm.opportunity.read (guard L176) | crm+crm.pipeline & crm | READ | PERMISSION_STRIP |  | OK |  |
| createQuotationDraft:185 | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/quotation-drafts` | crm.quotation.link (guard L183) | crm+crm.pipeline & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| refresh:193 | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/quotations/:linkId/refresh` | crm.opportunity.read (guard L190) | crm+crm.pipeline & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: refreshes link status from accounting |

### crm-inbox (65)

**`crm-inbox/presentation/http/crm-ai-assist.controller.ts`** — class `CrmAiAssistController` @17

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| trust:29 | `GET /v1/companies/:companyId/crm/conversations/:conversationId/ai/trust` | crm.ai.assist (guard L27) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK |  |
| summarize:37 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/ai/summary` | crm.ai.assist (guard L35) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK |  |
| draft:45 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/ai/reply-draft` | crm.ai.assist (guard L43) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK |  |
| analyze:53 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/ai/insights` | crm.ai.assist (guard L51) | ai_line_assistant | READ | PERMISSION_STRIP |  | OK |  |
| recordFeedback:61 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/ai/feedback` | crm.ai.assist (guard L59) | ai_line_assistant | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`crm-inbox/presentation/http/crm-ai-assist.controller.ts`** — class `CrmCustomerProfileAssistController` @68

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| extract:75 | `POST /v1/companies/:companyId/crm/customers/ai-profile-extract` | crm.customer.create, crm.ai.assist (guard L73) | crm+crm.customers & crm & ai_line_assistant | READ | PERMISSION_STRIP |  | OK |  |

**`crm-inbox/presentation/http/crm-ai-internal.controller.ts`** — class `CrmAiInternalController` @12

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| trustScoreScan:16 | `POST /v1/internal/crm/trust-score-scan` | — (@Public L10) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |

**`crm-inbox/presentation/http/crm-conversation-actions.controller.ts`** — class `CrmConversationActionsController` @25

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| createDeal:34 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/create-deal` | crm.opportunity.create (guard L32) | crm+crm.pipeline & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| createTask:41 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/create-task` | crm.follow_up.create (guard L39) | crm+crm.followups & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| createQuotation:48 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/create-quotation` | crm.quotation.link (guard L46) | crm+crm.pipeline & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| flagPaymentProof:55 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/messages/:messageId/flag-payment-proof` | crm.inbox.reply (guard L53) | crm+crm.inbox & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: internal finance-queue flag |

**`crm-inbox/presentation/http/crm-conversation-actions.controller.ts`** — class `CrmPaymentProofQueueController` @63

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:69 | `GET /v1/companies/:companyId/crm/payment-proofs` | accounting.document.read (guard L67) | sales_documents | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE: CRM inbox surface guarded by accounting.document.read => owned by sales_documents, dies with sales_documents=OFF |
| content:76 | `GET /v1/companies/:companyId/crm/payment-proofs/:conversationId/messages/:messageId/content` | accounting.document.read (guard L74) | sales_documents | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE: CRM inbox surface guarded by accounting.document.read => owned by sales_documents |

**`crm-inbox/presentation/http/crm-conversation-actions.controller.ts`** — class `CrmDailyBriefController` @95

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| get:102 | `GET /v1/companies/:companyId/crm/daily-brief` | crm.inbox.read (guard L99) | crm+crm.inbox & crm | READ | PERMISSION_STRIP |  | OK |  |

**`crm-inbox/presentation/http/crm-conversation.controller.ts`** — class `CrmConversationController` @32

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:49 | `GET /v1/companies/:companyId/crm/conversations` | crm.inbox.read (guard L47) | crm+crm.inbox & crm | READ | PERMISSION_STRIP |  | OK |  |
| get:76 | `GET /v1/companies/:companyId/crm/conversations/:conversationId` | crm.inbox.read (guard L74) | crm+crm.inbox & crm | READ | PERMISSION_STRIP |  | OK |  |
| content:85 | `GET /v1/companies/:companyId/crm/conversations/:conversationId/messages/:messageId/content` | crm.inbox.read (guard L83) | crm+crm.inbox & crm | READ | PERMISSION_STRIP |  | OK |  |
| send:103 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/messages` | crm.inbox.reply (guard L101) | crm+crm.inbox & crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: sends a LINE message to the customer (externally visible) |
| note:116 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/notes` | crm.inbox.note (guard L114) | crm+crm.inbox & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| status:127 | `PUT /v1/companies/:companyId/crm/conversations/:conversationId/status` | crm.inbox.resolve (guard L125) | crm+crm.inbox & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| priority:138 | `PUT /v1/companies/:companyId/crm/conversations/:conversationId/priority` | crm.inbox.resolve (guard L136) | crm+crm.inbox & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| autoReply:149 | `PUT /v1/companies/:companyId/crm/conversations/:conversationId/auto-reply` | crm.inbox.reply (guard L147) | crm+crm.inbox & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| tags:160 | `PUT /v1/companies/:companyId/crm/conversations/:conversationId/tags` | crm.inbox.resolve (guard L158) | crm+crm.inbox & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| assign:173 | `PUT /v1/companies/:companyId/crm/conversations/:conversationId/assign` | crm.inbox.read (guard L171) | crm+crm.inbox & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: ownership assignment, reversible |
| read:184 | `POST /v1/companies/:companyId/crm/conversations/:conversationId/read` | crm.inbox.read (guard L182) | crm+crm.inbox & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`crm-inbox/presentation/http/crm-customer-360.controller.ts`** — class `CrmCustomer360Controller` @14

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| summary360:24 | `GET /v1/companies/:companyId/crm/customers/:customerId/summary360` | crm.customer.read (guard L22) | crm+crm.customers & crm | READ | PERMISSION_STRIP |  | OK |  |
| timeline:31 | `GET /v1/companies/:companyId/crm/customers/:customerId/timeline` | crm.customer.read (guard L29) | crm+crm.customers & crm | READ | PERMISSION_STRIP |  | OK |  |
| erase:43 | `POST /v1/companies/:companyId/crm/customers/:customerId/erase` | crm.customer.erase (guard L41) | crm+crm.customers & crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`crm-inbox/presentation/http/crm-customer-pdpa.controller.ts`** — class `CrmCustomerPdpaController` @43

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| consentWithdraw:61 | `POST /v1/crm-customer/pdpa/consent-withdraw` | — (@Public L53) | NONE | FINAL_MUTATION | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| dataExport:75 | `POST /v1/crm-customer/pdpa/data-export` | — (@Public L67) | NONE | READ | NONE |  | OK | mutationClass override: returns customer-visible export; no state change \| @Public route: no permission resolution, so the entitlement chokepoint never runs |
| erasureRequest:100 | `POST /v1/crm-customer/pdpa/erasure-request` | — (@Public L92) | NONE | FINAL_MUTATION | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| erasureStatus:112 | `POST /v1/crm-customer/pdpa/erasure-status` | — (@Public L106) | NONE | READ | NONE |  | OK | mutationClass override: status read \| @Public route: no permission resolution, so the entitlement chokepoint never runs |

**`crm-inbox/presentation/http/crm-inbox-policy.controller.ts`** — class `CrmInboxPolicyController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| get:19 | `GET /v1/companies/:companyId/crm/inbox-policy` | crm.inbox.policy_manage (guard L17) | crm | READ | PERMISSION_STRIP |  | OK |  |
| update:26 | `PUT /v1/companies/:companyId/crm/inbox-policy` | crm.inbox.policy_manage (guard L24) | crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`crm-inbox/presentation/http/crm-internal.controller.ts`** — class `CrmInternalController` @19

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| campaignDelivery:33 | `POST /v1/internal/crm/campaign-delivery-scan` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| slaBreachScan:39 | `POST /v1/internal/crm/sla-breach-scan` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| newConversationScan:45 | `POST /v1/internal/crm/new-conversation-scan` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| inboxRetryScan:51 | `POST /v1/internal/crm/inbox-retry-scan` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| autonomyRetryScan:57 | `POST /v1/internal/crm/autonomy-retry-scan` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| bookingReminderScan:63 | `POST /v1/internal/crm/booking-reminder-scan` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| bookingProposalSweep:69 | `POST /v1/internal/crm/booking-proposal-sweep` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| pdpaPurge:75 | `POST /v1/internal/crm/pdpa-purge` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| pdpaErasureProcess:81 | `POST /v1/internal/crm/pdpa-erasure-process` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| pdpaPostRestoreReErasure:87 | `POST /v1/internal/crm/pdpa-post-restore-re-erasure` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |

**`crm-inbox/presentation/http/crm-line-webhook.controller.ts`** — class `CrmLineWebhookController` @20

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| receive:36 | `POST /v1/crm/line/webhook/:webhookKey` | — (@Public L29) | NONE | FINAL_MUTATION | NONE |  | OK | mutationClass override: autonomous AI replies to the end customer over LINE (externally visible) \| DANGEROUS: no crm/line_oa entitlement check anywhere on this path (crm-line-webhook.controller.ts:36-88); only signature + channel.status DISABLED |

**`crm-inbox/presentation/http/crm-reports.controller.ts`** — class `CrmReportsController` @12

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| summary:19 | `GET /v1/companies/:companyId/crm/reports/summary` | crm.report.read (guard L16) | crm+crm.overview & crm | READ | PERMISSION_STRIP |  | OK |  |

**`crm-inbox/presentation/http/crm-template.controller.ts`** — class `CrmTemplateController` @16

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:28 | `GET /v1/companies/:companyId/crm/templates` | crm.template.read (guard L26) | crm | READ | PERMISSION_STRIP |  | OK |  |
| approveAi:36 | `POST /v1/companies/:companyId/crm/templates/:templateId/approve-ai` | crm.template.manage (guard L33) | crm | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| create:43 | `POST /v1/companies/:companyId/crm/templates` | crm.template.manage (guard L41) | crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| update:51 | `POST /v1/companies/:companyId/crm/templates/:templateId` | crm.template.manage (guard L48) | crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| archive:63 | `POST /v1/companies/:companyId/crm/templates/:templateId/archive` | crm.template.manage (guard L60) | crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: archive = internal state flag |

**`crm-inbox/presentation/http/customer-line-register.controller.ts`** — class `CustomerLineRegisterController` @30

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| customerRegister:47 | `POST /v1/auth/line/customer-register` | — (@Public L39) | NONE | FINAL_MUTATION | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| customerRegisterPage:66 | `GET /v1/auth/line/customer-register-page` | — (@Public L59) | NONE | READ | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |

**`crm-inbox/presentation/http/messaging-channel.controller.ts`** — class `MessagingChannelController` @24

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:38 | `GET /v1/companies/:companyId/crm/channels` | crm.channel.read (guard L36) | line_oa | READ | PERMISSION_STRIP |  | OK |  |
| connect:45 | `POST /v1/companies/:companyId/crm/channels` | crm.channel.manage (guard L43) | line_oa | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| updateSettings:52 | `PATCH /v1/companies/:companyId/crm/channels/:channelId/settings` | crm.channel.manage (guard L50) | line_oa | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| test:63 | `POST /v1/companies/:companyId/crm/channels/:channelId/test` | crm.channel.manage (guard L61) | line_oa | READ | PERMISSION_STRIP |  | OK |  |
| rotate:70 | `POST /v1/companies/:companyId/crm/channels/:channelId/rotate` | crm.channel.manage (guard L68) | line_oa | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| disable:81 | `POST /v1/companies/:companyId/crm/channels/:channelId/disable` | crm.channel.manage (guard L79) | line_oa | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| reveal:92 | `POST /v1/companies/:companyId/crm/channels/:channelId/reveal` | crm.channel.manage (guard L90) | line_oa | READ | PERMISSION_STRIP |  | OK | mutationClass override: audited sensitive read; no state change |

**`crm-inbox/presentation/http/crm-campaign.controller.ts`** — class `CrmCampaignController` @9

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:11 | `GET /v1/companies/:companyId/crm/campaigns` | crm.campaign.read (guard L11) | crm | READ | PERMISSION_STRIP |  | OK |  |
| create:12 | `POST /v1/companies/:companyId/crm/campaigns/drafts` | crm.campaign.manage (guard L12) | crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| preview:13 | `POST /v1/companies/:companyId/crm/campaigns/:id/preview` | crm.campaign.manage (guard L13) | crm | READ | PERMISSION_STRIP | yes | OK | twoStep: pairs with POST crm/campaigns/:id/send (crm-campaign.controller.ts:13-14) |
| send:14 | `POST /v1/companies/:companyId/crm/campaigns/:id/send` | crm.campaign.send (guard L14) | crm | FINAL_MUTATION | PERMISSION_STRIP | yes | OK | twoStep: send half of the preview/send pair |
| generate:15 | `POST /v1/companies/:companyId/crm/campaigns/generate` | crm.campaign.manage, crm.ai.assist (guard L15) | crm & ai_line_assistant | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: AI drafts broadcast content; no send |

### dashboard-notifications (22)

**`dashboard-notifications/presentation/http/dashboard.controller.ts`** — class `DashboardController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| getDashboard:15 | `GET /v1/companies/:companyId/dashboard` | dashboard.read (guard L14) | dashboard_notifications | READ | PERMISSION_STRIP |  | OK |  |
| getLatestSnapshot:26 | `GET /v1/companies/:companyId/dashboard/snapshots/latest` | dashboard.read (guard L25) | dashboard_notifications | READ | PERMISSION_STRIP |  | OK |  |
| generateSnapshotManual:37 | `POST /v1/companies/:companyId/dashboard/snapshots/generate` | dashboard.snapshot.generate (guard L36) | dashboard_notifications | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: snapshot record, recomputable |

**`dashboard-notifications/presentation/http/internal.controller.ts`** — class `InternalNotificationSweepController` @26

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| deliverySweep:35 | `POST /v1/internal/notifications/delivery-sweep` | — (@Public L24) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| generateSnapshots:41 | `POST /v1/internal/notifications/snapshot-sweep` | — (@Public L24) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| scanStockLow:47 | `POST /v1/internal/notifications/stock-low-sweep` | — (@Public L24) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| createDailySummaries:53 | `POST /v1/internal/notifications/daily-owner-summary-sweep` | — (@Public L24) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |

**`dashboard-notifications/presentation/http/internal.controller.ts`** — class `InternalNotificationController` @70

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| handleGenerateSnapshot:85 | `POST /v1/internal/companies/:companyId/dashboard/snapshots/generate` | — (@Public L68) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| stockLow:96 | `POST /v1/internal/companies/:companyId/notifications/scan/stock-low` | — (@Public L68) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| dailySummary:106 | `POST /v1/internal/companies/:companyId/notifications/daily-owner-summary` | — (@Public L68) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| delivery:118 | `POST /v1/internal/companies/:companyId/notification-deliveries/:deliveryId/process` | — (@Public L68) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |

**`dashboard-notifications/presentation/http/notification.controller.ts`** — class `NotificationController` @22

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:33 | `GET /v1/companies/:companyId/notifications` | notification.read (guard L32) | dashboard_notifications | READ | PERMISSION_STRIP |  | OK |  |
| unreadCount:47 | `GET /v1/companies/:companyId/notifications/unread-count` | notification.read (guard L46) | dashboard_notifications | READ | PERMISSION_STRIP |  | OK |  |
| markOneRead:54 | `POST /v1/companies/:companyId/notifications/:notificationId/read` | notification.read (guard L53) | dashboard_notifications | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| markAll:61 | `POST /v1/companies/:companyId/notifications/read-all` | notification.read (guard L60) | dashboard_notifications | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| dismiss:68 | `POST /v1/companies/:companyId/notifications/:notificationId/dismiss` | notification.read (guard L67) | dashboard_notifications | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`dashboard-notifications/presentation/http/notification.controller.ts`** — class `NotificationPreferenceController` @75

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| get:80 | `GET /v1/companies/:companyId/notification-preferences` | notification.preference.manage (guard L79) | dashboard_notifications+dashboard_notifications.preferences & dashboard_notifications | READ | PERMISSION_STRIP |  | OK |  |
| update:87 | `PUT /v1/companies/:companyId/notification-preferences` | notification.preference.manage (guard L86) | dashboard_notifications+dashboard_notifications.preferences & dashboard_notifications | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`dashboard-notifications/presentation/http/notification.controller.ts`** — class `NotificationRuleController` @94

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:99 | `GET /v1/companies/:companyId/notification-rules` | notification.rule.manage (guard L98) | dashboard_notifications+dashboard_notifications.rules & dashboard_notifications | READ | PERMISSION_STRIP |  | OK |  |
| update:106 | `PUT /v1/companies/:companyId/notification-rules/:ruleId` | notification.rule.manage (guard L105) | dashboard_notifications+dashboard_notifications.rules & dashboard_notifications | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`dashboard-notifications/presentation/http/notification.controller.ts`** — class `NotificationDeliveryController` @113

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:118 | `GET /v1/companies/:companyId/notification-deliveries` | notification.delivery.read (guard L117) | dashboard_notifications | READ | PERMISSION_STRIP |  | OK |  |
| retry:125 | `POST /v1/companies/:companyId/notification-deliveries/:deliveryId/retry` | notification.delivery.retry (guard L124) | dashboard_notifications | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

### data-model-core (12)

**`data-model-core/presentation/http/attachment.controller.ts`** — class `AttachmentController` @14

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| uploadIntent:25 | `POST /v1/companies/:companyId/attachments/upload-intent` | attachment.create (guard L24) | UNMAPPED | ROOT_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| complete:32 | `POST /v1/companies/:companyId/attachments/:attachmentId/complete` | attachment.create (guard L31) | UNMAPPED | ROOT_MUTATION | NONE |  | OK | mutationClass override: upload completion, not a business finalization \| guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| downloadUrl:44 | `GET /v1/companies/:companyId/attachments/:attachmentId/download-url` | attachment.read (guard L43) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| link:55 | `POST /v1/companies/:companyId/attachments/:attachmentId/links` | attachment.create (guard L54) | UNMAPPED | ROOT_MUTATION | NONE |  | OK | mutationClass override: attachment link row; keyword "link" false positive \| guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| remove:67 | `DELETE /v1/companies/:companyId/attachments/:attachmentId` | attachment.delete (guard L66) | UNMAPPED | ROOT_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |

**`data-model-core/presentation/http/branch.controller.ts`** — class `BranchController` @12

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:21 | `GET /v1/companies/:companyId/branches` | company.branch.read (guard L20) | company_settings+company_settings.branches | READ | PERMISSION_STRIP |  | OK |  |
| create:33 | `POST /v1/companies/:companyId/branches` | company.branch.manage (guard L32) | company_settings+company_settings.branches | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| update:40 | `PATCH /v1/companies/:companyId/branches/:branchId` | company.branch.manage (guard L39) | company_settings+company_settings.branches | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`data-model-core/presentation/http/document-sequence.controller.ts`** — class `DocumentSequenceController` @11

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:19 | `GET /v1/companies/:companyId/document-sequences` | document.sequence.read (guard L18) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |
| upsert:31 | `PUT /v1/companies/:companyId/document-sequences/:documentType` | document.sequence.manage (guard L30) | UNMAPPED | ROOT_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) |

**`data-model-core/presentation/http/local-storage.controller.ts`** — class `LocalStorageController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| upload:18 | `PUT /local-storage/upload/:token` | — (@Public L8) | NONE | SYSTEM | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |
| download:31 | `GET /local-storage/download/:token` | — (@Public L8) | NONE | SYSTEM | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |

### employee-access (30)

**`employee-access/presentation/http/access-catalog.controller.ts`** — class `AccessCatalogController` @14

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| addresses:26 | `GET /v1/companies/:companyId/settings/address-master` | access.employee.read (guard L24) | employee_access+employee_access.employees | READ | PERMISSION_STRIP |  | OK |  |
| packs:33 | `GET /v1/companies/:companyId/settings/capability-packs` | access.capability_pack.read (guard L31) | employee_access+employee_access.roles | READ | PERMISSION_STRIP |  | OK | reads entitlements for lock display (list-capability-packs.use-case.ts:12-16) |
| templates:40 | `GET /v1/companies/:companyId/settings/role-templates` | access.role_template.read (guard L38) | employee_access+employee_access.roles | READ | PERMISSION_STRIP |  | OK |  |
| matrix:47 | `GET /v1/companies/:companyId/settings/effective-access` | access.effective.read (guard L45) | employee_access+employee_access.overview | READ | PERMISSION_STRIP |  | OK |  |
| member:54 | `GET /v1/companies/:companyId/settings/effective-access/:membershipId` | access.effective.read (guard L52) | employee_access+employee_access.overview | READ | PERMISSION_STRIP |  | OK |  |
| accessMatrix:61 | `GET /v1/companies/:companyId/settings/access/matrix` | access.role.read (guard L59) | employee_access+employee_access.roles | READ | PERMISSION_STRIP |  | OK | entitlement-filtered projection (get-access-matrix.use-case.ts:18-24) |

**`employee-access/presentation/http/business-policy.controller.ts`** — class `BusinessPolicyController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| getDiscount:16 | `GET /v1/companies/:companyId/settings/discount-policy` | crm.customer.read (guard L14) | crm+crm.customers & crm | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE: company settings surface guarded by crm.customer.read => owned by crm |
| saveDiscount:21 | `PUT /v1/companies/:companyId/settings/discount-policy` | crm.customer.update (guard L19) | crm+crm.customers & crm | ROOT_MUTATION | PERMISSION_STRIP |  | OK | CROSS-FEATURE: company settings surface guarded by crm.customer.update => owned by crm |
| getPoApproval:28 | `GET /v1/companies/:companyId/settings/po-approval` | procurement.purchase_order.read (guard L26) | procurement+procurement.purchase_orders & procurement | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE: company settings surface guarded by procurement.purchase_order.read => owned by procurement |
| savePoApproval:33 | `PUT /v1/companies/:companyId/settings/po-approval` | procurement.purchase_order.manage (guard L31) | procurement+procurement.purchase_orders & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK | CROSS-FEATURE: company settings surface guarded by procurement.purchase_order.manage => owned by procurement |
| getRetention:39 | `GET /v1/companies/:companyId/settings/retention-policy` | crm.channel.read (guard L38) | line_oa | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE: PDPA retention policy guarded by crm.channel.read => owned by line_oa |
| saveRetention:43 | `PUT /v1/companies/:companyId/settings/retention-policy` | crm.channel.manage (guard L42) | line_oa | ROOT_MUTATION | PERMISSION_STRIP |  | OK | CROSS-FEATURE: PDPA retention policy guarded by crm.channel.manage => owned by line_oa |
| getConsent:47 | `GET /v1/companies/:companyId/settings/consent-policy` | crm.channel.read (guard L46) | line_oa | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE: PDPA consent policy guarded by crm.channel.read => owned by line_oa |
| saveConsent:51 | `PUT /v1/companies/:companyId/settings/consent-policy` | crm.channel.manage (guard L50) | line_oa | ROOT_MUTATION | PERMISSION_STRIP |  | OK | CROSS-FEATURE: PDPA consent policy guarded by crm.channel.manage => owned by line_oa |

**`employee-access/presentation/http/employee.controller.ts`** — class `EmployeeController` @20

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:35 | `GET /v1/companies/:companyId/settings/employees` | access.employee.read (guard L33) | employee_access+employee_access.employees | READ | PERMISSION_STRIP |  | OK |  |
| get:42 | `GET /v1/companies/:companyId/settings/employees/:employeeId` | access.employee.read (guard L40) | employee_access+employee_access.employees | READ | PERMISSION_STRIP |  | OK |  |
| create:49 | `POST /v1/companies/:companyId/settings/employees` | access.employee.create (guard L47) | employee_access+employee_access.employees | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| complete:64 | `POST /v1/companies/:companyId/settings/employees/:employeeId/complete` | access.employee.create (guard L62) | employee_access+employee_access.employees | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| update:76 | `PATCH /v1/companies/:companyId/settings/employees/:employeeId` | access.employee.update (guard L74) | employee_access+employee_access.employees | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| disable:91 | `POST /v1/companies/:companyId/settings/employees/:employeeId/disable` | access.employee.disable (guard L89) | employee_access+employee_access.employees | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| regenerate:106 | `POST /v1/companies/:companyId/settings/employees/:employeeId/credentials/regenerate` | access.employee.credential.issue (guard L104) | employee_access+employee_access.employees | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| issueLineLink:118 | `POST /v1/companies/:companyId/settings/employees/:employeeId/line-link-token` | access.employee.line_link.issue (guard L116) | employee_access+employee_access.employees | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| revokeLineLink:131 | `POST /v1/companies/:companyId/settings/employees/:employeeId/line-link-token/revoke` | access.employee.line_link.revoke (guard L129) | employee_access+employee_access.employees | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`employee-access/presentation/http/permission.controller.ts`** — class `PermissionController` @8

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:14 | `GET /v1/companies/:companyId/settings/permissions` | access.permission.read (guard L12) | employee_access+employee_access.roles | READ | PERMISSION_STRIP |  | OK |  |

**`employee-access/presentation/http/role.controller.ts`** — class `RoleController` @16

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:29 | `GET /v1/companies/:companyId/settings/roles` | access.role.read (guard L27) | employee_access+employee_access.roles | READ | PERMISSION_STRIP |  | OK | entitlement-filtered permission counts (list-roles.use-case.ts:19-27) |
| get:36 | `GET /v1/companies/:companyId/settings/roles/:roleId` | access.role.read (guard L34) | employee_access+employee_access.roles | READ | PERMISSION_STRIP |  | OK |  |
| preview:43 | `POST /v1/companies/:companyId/settings/roles/preview` | access.role.read (guard L41) | employee_access+employee_access.roles | READ | PERMISSION_STRIP |  | OK | entitlement-aware preview (preview-role.use-case.ts:18-23) |
| create:55 | `POST /v1/companies/:companyId/settings/roles` | access.role.manage (guard L53) | employee_access+employee_access.roles | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| update:69 | `PATCH /v1/companies/:companyId/settings/roles/:roleId` | access.role.manage (guard L67) | employee_access+employee_access.roles | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| disable:84 | `POST /v1/companies/:companyId/settings/roles/:roleId/disable` | access.role.manage (guard L82) | employee_access+employee_access.roles | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: role config, reversible |

### expenses (46)

**`expenses/presentation/http/expense.controller.ts`** — class `ExpenseController` @71

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listExpenses:106 | `GET /v1/companies/:companyId/expenses` | expense.read_own (guard L105) | expenses+expenses.list & expenses | READ | PERMISSION_STRIP |  | OK |  |
| getSharedEvidence:148 | `GET /v1/companies/:companyId/expenses/shared-evidence` | expense.evidence.read (guard L147) | expenses+expenses.evidence & expenses | READ | PERMISSION_STRIP |  | OK |  |
| createAccountantPackage:169 | `POST /v1/companies/:companyId/expenses/accountant-package` | expense.export (guard L168) | expenses+expenses.evidence & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK | expense.export is in pack.expense.view/finance => owned by expenses |
| createDraft:175 | `POST /v1/companies/:companyId/expenses` | expense.create (guard L174) | expenses+expenses.manual & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| initReceiptUpload:181 | `POST /v1/companies/:companyId/expenses/receipt-uploads` | expense.receipt.upload (guard L180) | expenses+expenses.upload & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| removeExpense:191 | `DELETE /v1/companies/:companyId/expenses/:expenseId` | expense.update (guard L190) | expenses+expenses.manual & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| getExpense:197 | `GET /v1/companies/:companyId/expenses/:expenseId` | expense.read_own (guard L196) | expenses+expenses.list & expenses | READ | PERMISSION_STRIP |  | OK |  |
| prepareSubstitute:203 | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt` | expense.review (guard L202) | expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| listSubstitutePayers:209 | `GET /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/payers` | expense.review (guard L208) | expenses | READ | PERMISSION_STRIP |  | OK |  |
| listSubstituteHistory:215 | `GET /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/history` | expense.review (guard L214) | expenses | READ | PERMISSION_STRIP |  | OK |  |
| certifySubstitute:221 | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/certify` | expense.read_own (guard L220) | expenses+expenses.list & expenses | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| previewSubstitute:232 | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/preview` | expense.read_own (guard L231) | expenses+expenses.list & expenses | READ | PERMISSION_STRIP |  | OK |  |
| initSubstituteSignature:243 | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/signature-upload-intent` | expense.read_own (guard L242) | expenses+expenses.list & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: upload intent |
| completeSubstituteSignature:254 | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/signature-uploads/:attachmentId/complete` | expense.read_own (guard L253) | expenses+expenses.list & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: upload completion |
| approveSubstitute:266 | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/approve` | expense.confirm (guard L265) | expenses | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| supersedeSubstitute:277 | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/supersede` | expense.review (guard L276) | expenses | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| requestReceiptExtraction:288 | `POST /v1/companies/:companyId/expenses/:expenseId/extraction-request` | expense.read_own (guard L287) | expenses+expenses.list & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| fillSignature:294 | `POST /v1/companies/:companyId/expenses/:expenseId/signature-fill` | expense.review (guard L293) | expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: fills signature fields on draft evidence |
| updateDraft:300 | `PATCH /v1/companies/:companyId/expenses/:expenseId` | expense.update (guard L299) | expenses+expenses.manual & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| updateReviewFields:306 | `PATCH /v1/companies/:companyId/expenses/:expenseId/review-fields` | expense.review (guard L305) | expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| overrideNonExpenseClassification:312 | `POST /v1/companies/:companyId/expenses/:expenseId/non-expense-classification-override` | expense.review (guard L311) | expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: review-field override on draft |
| completeReceiptUpload:328 | `POST /v1/companies/:companyId/expenses/:expenseId/receipt-uploads/:attachmentId/complete` | expense.receipt.upload (guard L327) | expenses+expenses.upload & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: upload completion |
| markReady:339 | `POST /v1/companies/:companyId/expenses/:expenseId/mark-ready` | expense.update (guard L338) | expenses+expenses.manual & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| markReadyAsReviewer:345 | `POST /v1/companies/:companyId/expenses/:expenseId/reviewer-mark-ready` | expense.review (guard L344) | expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| confirmExpense:351 | `POST /v1/companies/:companyId/expenses/:expenseId/confirm` | expense.confirm (guard L350) | expenses | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| rejectExpense:357 | `POST /v1/companies/:companyId/expenses/:expenseId/reject` | expense.reject (guard L356) | expenses | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| voidExpense:363 | `POST /v1/companies/:companyId/expenses/:expenseId/void` | expense.void (guard L362) | expenses | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| recordPayment:369 | `POST /v1/companies/:companyId/expenses/:expenseId/payment` | expense.payment.record (guard L368) | expenses | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| duplicateCheck:379 | `POST /v1/companies/:companyId/expenses/:expenseId/duplicate-check` | expense.review (guard L378) | expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: persists duplicate candidates + duplicateStatus (expense-upload.use-case.ts:224-241) — NOT a pure preview |
| dismissDuplicate:385 | `POST /v1/companies/:companyId/expenses/:expenseId/duplicates/:candidateId/dismiss` | expense.duplicate.resolve (guard L384) | expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| confirmDuplicate:391 | `POST /v1/companies/:companyId/expenses/:expenseId/duplicates/:candidateId/confirm` | expense.duplicate.resolve (guard L390) | expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: duplicate-resolution decision, internal |
| getSourcePosting:397 | `GET /v1/companies/:companyId/expenses/:expenseId/source-posting-input` | expense.read (guard L396) | expenses+expenses.list & expenses | READ | PERMISSION_STRIP |  | OK |  |

**`expenses/presentation/http/expense.controller.ts`** — class `ExpenseCategoryController` @403

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listCategories:413 | `GET /v1/companies/:companyId/expense-categories` | expense.read_own (guard L412) | expenses+expenses.list & expenses | READ | PERMISSION_STRIP |  | OK |  |
| listAllCategories:420 | `GET /v1/companies/:companyId/expense-categories/manage` | expense.category.manage (guard L419) | expenses+expenses.categories & expenses | READ | PERMISSION_STRIP |  | OK |  |
| createCategory:426 | `POST /v1/companies/:companyId/expense-categories` | expense.category.manage (guard L425) | expenses+expenses.categories & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| updateCategory:432 | `PATCH /v1/companies/:companyId/expense-categories/:categoryId` | expense.category.manage (guard L431) | expenses+expenses.categories & expenses | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`expenses/presentation/http/expense.controller.ts`** — class `ExpenseSettingsController` @438

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| getPolicy:446 | `GET /v1/companies/:companyId/expense-settings/substitute-receipt` | company.setup.manage (guard L445) | UNMAPPED | READ | NONE |  | BLOCKED | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| BLOCKED: Expenses feature screen (ใบรับรองแทนใบเสร็จ policy) guarded by company.setup.manage, which pack.company.settings.manage leaves UNGATED (capability-pack.registry.ts:43-61) => survives expenses=OFF. Missing: owner decision on which feature key owns expense-settings. |
| getRuntimePolicy:452 | `GET /v1/companies/:companyId/expense-settings/substitute-receipt/runtime` | expense.review (guard L451) | expenses | READ | PERMISSION_STRIP |  | OK |  |
| updatePolicy:458 | `PATCH /v1/companies/:companyId/expense-settings/substitute-receipt` | company.setup.manage (guard L457) | UNMAPPED | ROOT_MUTATION | NONE |  | BLOCKED | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| BLOCKED: same as the GET — company.setup.manage is ungated, so this write survives expenses=OFF. Missing: feature owner for expense-settings. |

**`expenses/presentation/http/expense.controller.ts`** — class `ExpenseSignatureController` @464

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:477 | `GET /v1/companies/:companyId/expense-signatures` | expense.signature.manage (guard L476) | expenses+expenses.substitute_receipt | READ | PERMISSION_STRIP |  | OK |  |
| initSignatureUpload:483 | `POST /v1/companies/:companyId/expense-signatures/uploads` | expense.signature.manage (guard L482) | expenses+expenses.substitute_receipt | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: upload intent |
| createSignature:489 | `POST /v1/companies/:companyId/expense-signatures` | expense.signature.manage (guard L488) | expenses+expenses.substitute_receipt | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: creates signature asset draft |
| approveSignature:495 | `POST /v1/companies/:companyId/expense-signatures/:signatureId/approve` | expense.signature.approve (guard L494) | expenses+expenses.substitute_receipt | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| rejectSignature:501 | `POST /v1/companies/:companyId/expense-signatures/:signatureId/reject` | expense.signature.approve (guard L500) | expenses+expenses.substitute_receipt | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| archiveSignature:507 | `POST /v1/companies/:companyId/expense-signatures/:signatureId/archive` | expense.signature.manage (guard L506) | expenses+expenses.substitute_receipt | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: archive = internal state flag |
| setDerivedAsset:514 | `POST /v1/companies/:companyId/expense-signatures/:signatureId/derived` | expense.signature.manage (guard L513) | expenses+expenses.substitute_receipt | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: stores derived asset |

### health (3)

**`health/presentation/http/health-internal.controller.ts`** — class `HealthInternalController` @14

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| readiness:18 | `GET /v1/internal/health/readiness` | — (@Public L12) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |

**`health/presentation/http/health.controller.ts`** — class `HealthController` @9

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| getHealth:14 | `GET /v1/health` | — (@Public L7) | NONE | SYSTEM | NONE |  | OK | @Public route: no permission resolution, so the entitlement chokepoint never runs |

**`health/presentation/http/protected-test.controller.ts`** — class `ProtectedTestController` @7

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| protectedRoute:10 | `GET /v1/test/protected` | health.read (guard L9) | UNMAPPED | SYSTEM | NONE |  | BLOCKED | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| BLOCKED: requires permission health.read, which does not exist in permission-registry.ts (336 keys) => no role can hold it and no feature owns it. Missing: delete the route or register the permission. |

### inventory (29)

**`inventory/presentation/http/inventory-location.controller.ts`** — class `InventoryLocationController` @18

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:31 | `GET /v1/companies/:companyId/inventory/locations` | inventory.location.read (guard L30) | inventory+inventory.locations & inventory | READ | PERMISSION_STRIP |  | OK |  |
| create:45 | `POST /v1/companies/:companyId/inventory/locations` | inventory.location.manage (guard L44) | inventory+inventory.locations & inventory | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| balances:52 | `GET /v1/companies/:companyId/inventory/locations/:locationId/balances` | inventory.report.read (guard L51) | inventory+inventory.stock_report & inventory | READ | PERMISSION_STRIP |  | OK |  |
| locationQr:59 | `POST /v1/companies/:companyId/inventory/locations/:locationId/internal-qr` | inventory.label.manage (guard L58) | inventory | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| archive:66 | `POST /v1/companies/:companyId/inventory/locations/:locationId/archive` | inventory.location.manage (guard L65) | inventory+inventory.locations & inventory | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: archive = internal state flag |
| getOne:73 | `GET /v1/companies/:companyId/inventory/locations/:locationId` | inventory.location.read (guard L72) | inventory+inventory.locations & inventory | READ | PERMISSION_STRIP |  | OK |  |
| update:80 | `PATCH /v1/companies/:companyId/inventory/locations/:locationId` | inventory.location.manage (guard L79) | inventory+inventory.locations & inventory | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`inventory/presentation/http/inventory-movement.controller.ts`** — class `InventoryMovementController` @13

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:25 | `GET /v1/companies/:companyId/inventory/movements` | inventory.movement.read (guard L24) | inventory+inventory.movements & inventory | READ | PERMISSION_STRIP |  | OK |  |
| receive:41 | `POST /v1/companies/:companyId/inventory/movements/receive` | inventory.movement.create (guard L40) | inventory | FINAL_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: immutable stock movement |
| issue:48 | `POST /v1/companies/:companyId/inventory/movements/issue` | inventory.movement.create (guard L47) | inventory | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| transfer:55 | `POST /v1/companies/:companyId/inventory/movements/transfer` | inventory.movement.create (guard L54) | inventory | FINAL_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: immutable stock movement |
| count:62 | `POST /v1/companies/:companyId/inventory/movements/count` | inventory.stock_count.create (guard L61) | inventory | FINAL_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: immutable stock movement |
| adjust:69 | `POST /v1/companies/:companyId/inventory/movements/adjust` | inventory.movement.adjust (guard L68) | inventory | FINAL_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: immutable stock movement |
| balance:77 | `GET /v1/companies/:companyId/inventory/balances` | inventory.report.read (guard L76) | inventory+inventory.stock_report & inventory | READ | PERMISSION_STRIP |  | OK |  |
| stockReport:84 | `GET /v1/companies/:companyId/inventory/reports/stock` | inventory.report.read (guard L83) | inventory+inventory.stock_report & inventory | READ | PERMISSION_STRIP |  | OK |  |

**`inventory/presentation/http/inventory-product.controller.ts`** — class `InventoryProductController` @15

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:30 | `GET /v1/companies/:companyId/inventory/products` | inventory.product.read (guard L29) | product_catalog | READ | PERMISSION_STRIP |  | OK |  |
| create:44 | `POST /v1/companies/:companyId/inventory/products` | inventory.product.manage (guard L43) | product_catalog | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| movements:51 | `GET /v1/companies/:companyId/inventory/products/:productId/movements` | inventory.movement.read (guard L50) | inventory+inventory.movements & inventory | READ | PERMISSION_STRIP |  | OK |  |
| balances:64 | `GET /v1/companies/:companyId/inventory/products/:productId/balances` | inventory.report.read (guard L63) | inventory+inventory.stock_report & inventory | READ | PERMISSION_STRIP |  | OK |  |
| barcode:71 | `POST /v1/companies/:companyId/inventory/products/:productId/barcodes` | inventory.label.manage (guard L70) | inventory | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| productQr:78 | `POST /v1/companies/:companyId/inventory/products/:productId/internal-qr` | inventory.label.manage (guard L77) | inventory | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| archive:85 | `POST /v1/companies/:companyId/inventory/products/:productId/archive` | inventory.product.manage (guard L84) | product_catalog | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: archive = internal state flag |
| getOne:92 | `GET /v1/companies/:companyId/inventory/products/:productId` | inventory.product.read (guard L91) | product_catalog | READ | PERMISSION_STRIP |  | OK |  |
| update:99 | `PATCH /v1/companies/:companyId/inventory/products/:productId` | inventory.product.manage (guard L98) | product_catalog | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`inventory/presentation/http/inventory-qr.controller.ts`** — class `InventoryQrController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:20 | `GET /v1/companies/:companyId/inventory/labels` | inventory.label.manage (guard L19) | inventory | READ | PERMISSION_STRIP |  | OK |  |
| generate:32 | `POST /v1/companies/:companyId/inventory/labels/generate` | inventory.label.manage (guard L31) | inventory | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: label records |
| resolve:39 | `GET /v1/companies/:companyId/inventory/labels/resolve` | inventory.product.read (guard L38) | product_catalog | READ | PERMISSION_STRIP |  | OK |  |
| scan:46 | `POST /v1/companies/:companyId/inventory/labels/scan` | inventory.product.read (guard L45) | product_catalog | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| markAsPrinted:53 | `POST /v1/companies/:companyId/inventory/labels/:labelId/printed` | inventory.label.manage (guard L52) | inventory | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

### ledger (27)

**`ledger/presentation/http/expense-auto-post-internal.controller.ts`** — class `ExpenseAutoPostInternalController` @8

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| execute:12 | `POST /v1/internal/ledger/expense-auto-post/drain` | — (@Public L6) | NONE | SYSTEM | EXPLICIT_GUARD |  | OK | company selection filters double_entry_ledger + expense_auto_post (expense-auto-post.use-case.ts:89-96); worker token otherwise |

**`ledger/presentation/http/ledger.controller.ts`** — class `LedgerController` @36

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listAccountsHandler:68 | `GET /v1/companies/:companyId/chart-of-accounts` | ledger.account.read (guard L66) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| listChartTemplatesHandler:75 | `GET /v1/companies/:companyId/chart-of-accounts/templates` | ledger.account.read (guard L73) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| previewChartTemplateHandler:82 | `GET /v1/companies/:companyId/chart-of-accounts/templates/:templateKey/preview` | ledger.account.read (guard L80) | double_entry_ledger | READ | PERMISSION_STRIP | yes | OK | twoStep: pairs with POST .../apply (ApplyChartTemplateDto.expectedPreviewChecksum, ledger.dtos.ts:55-60) \| thai_tax entitlement influences preview output (chart-template-query.service.ts:374) |
| applyChartTemplateHandler:93 | `POST /v1/companies/:companyId/chart-of-accounts/templates/:templateKey/apply` | ledger.account.manage (guard L90) | double_entry_ledger | FINAL_MUTATION | PERMISSION_STRIP | yes | OK | twoStep: requires expectedTemplateChecksum + expectedPreviewChecksum from the preview (ledger.dtos.ts:55-60) |
| chartReadinessHandler:104 | `GET /v1/companies/:companyId/chart-of-accounts/readiness` | ledger.account.read (guard L102) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK | thai_tax entitlement influences readiness output (chart-template-query.service.ts:374) |
| getAccountHandler:111 | `GET /v1/companies/:companyId/chart-of-accounts/:accountId` | ledger.account.read (guard L109) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| createAccountHandler:118 | `POST /v1/companies/:companyId/chart-of-accounts` | ledger.account.manage (guard L116) | double_entry_ledger | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| updateAccountHandler:125 | `PATCH /v1/companies/:companyId/chart-of-accounts/:accountId` | ledger.account.manage (guard L123) | double_entry_ledger | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| listJournalsHandler:134 | `GET /v1/companies/:companyId/journal-entries` | ledger.journal.read (guard L132) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| getJournalHandler:141 | `GET /v1/companies/:companyId/journal-entries/:journalId` | ledger.journal.read (guard L139) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| createManualHandler:148 | `POST /v1/companies/:companyId/journal-entries/manual` | journal.entry.create (guard L146) | double_entry_ledger | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| postJournalHandler:156 | `POST /v1/companies/:companyId/journal-entries/:journalId/post` | journal.entry.post (guard L153) | double_entry_ledger | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| reverseJournalHandler:164 | `POST /v1/companies/:companyId/journal-entries/:journalId/reverse` | journal.entry.reverse (guard L161) | double_entry_ledger | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| generateJournalHandler:172 | `POST /v1/companies/:companyId/posting/generate` | journal.entry.create, journal.entry.post (guard L169) | double_entry_ledger | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| previewExpenseBackfillHandler:179 | `GET /v1/companies/:companyId/posting/expense-backfill-preview` | expense.read, journal.entry.create, journal.entry.post (guard L177) | expenses+expenses.list & expenses & double_entry_ledger | READ | EXPLICIT_GUARD | yes | OK | twoStep: canonical seam: pairs with POST posting/expense-backfill {confirmed:true} (ledger.controller.ts:176-192) \| expense-backfill.use-case.ts:89-110 requires double_entry_ledger + expense_auto_post (throws expense_auto_post_not_enabled); PERMISSION_STRIP also applies |
| runExpenseBackfillHandler:187 | `POST /v1/companies/:companyId/posting/expense-backfill` | expense.read, journal.entry.create, journal.entry.post (guard L184) | expenses+expenses.list & expenses & double_entry_ledger | FINAL_MUTATION | EXPLICIT_GUARD | yes | OK | twoStep: body {confirmed:boolean} (ledger.controller.ts:189) — stateless confirmation, CC3 replaces it \| expense-backfill.use-case.ts:89-110 requires double_entry_ledger + expense_auto_post; PERMISSION_STRIP also applies |
| listPeriodsHandler:199 | `GET /v1/companies/:companyId/periods` | ledger.period.read (guard L197) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| ensurePeriodHandler:207 | `POST /v1/companies/:companyId/periods/ensure/:periodKey` | ledger.period.read (guard L204) | double_entry_ledger | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| closeChecksHandler:215 | `POST /v1/companies/:companyId/periods/:periodId/close-checks` | ledger.period.read (guard L212) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| closePeriodHandler:223 | `POST /v1/companies/:companyId/periods/:periodId/close` | ledger.period.close (guard L220) | double_entry_ledger | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| unclosePeriodHandler:231 | `POST /v1/companies/:companyId/periods/:periodId/unclose` | ledger.period.unclose (guard L228) | double_entry_ledger | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| glHandler:240 | `GET /v1/companies/:companyId/reports/general-ledger` | ledger.report.read (guard L238) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| tbHandler:247 | `GET /v1/companies/:companyId/reports/trial-balance` | ledger.report.read (guard L245) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| pnlHandler:254 | `GET /v1/companies/:companyId/reports/profit-and-loss` | ledger.report.read (guard L252) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| bsHandler:261 | `GET /v1/companies/:companyId/reports/balance-sheet` | ledger.report.read (guard L259) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK |  |
| exportHandler:269 | `POST /v1/companies/:companyId/reports/:reportType/export` | ledger.export (guard L266) | double_entry_ledger | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: ledger export (stub) |

### line-ai (2)

**`line-ai/presentation/http/internal-tools.controller.ts`** — class `InternalToolsController` @93

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| invoke:218 | `POST /v1/internal/ai/tools/invoke` | — (@Public L214) | NONE | SYSTEM | PERMISSION_STRIP |  | OK | @Public + internal secret + actor delegation, but permissions are re-resolved via PermissionResolverService (internal-tools.controller.ts:255) => chokepoint applies |

**`line-ai/presentation/http/line-ai-ledger-internal.controller.ts`** — class `LineAiLedgerInternalController` @13

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| drainLedger:17 | `POST /v1/internal/ai/line-ledger/drain` | — (@Public L11) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |

### procurement (50)

**`procurement/presentation/http/goods-receipt.controller.ts`** — class `GoodsReceiptController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:21 | `GET /v1/companies/:companyId/procurement/goods-receipts` | procurement.goods_receipt.read (guard L20) | procurement+procurement.goods_receipts & procurement | READ | PERMISSION_STRIP |  | OK |  |
| create:28 | `POST /v1/companies/:companyId/procurement/goods-receipts` | procurement.goods_receipt.create (guard L27) | procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| get:35 | `GET /v1/companies/:companyId/procurement/goods-receipts/:id` | procurement.goods_receipt.read (guard L34) | procurement+procurement.goods_receipts & procurement | READ | PERMISSION_STRIP |  | OK |  |
| post:42 | `POST /v1/companies/:companyId/procurement/goods-receipts/:id/post` | procurement.goods_receipt.post (guard L41) | procurement+procurement.goods_receipts & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| void:49 | `POST /v1/companies/:companyId/procurement/goods-receipts/:id/void` | procurement.goods_receipt.void (guard L48) | procurement+procurement.goods_receipts & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`procurement/presentation/http/pp36-input-claim.controller.ts`** — class `Pp36InputClaimController` @11

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| execute:18 | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:vendorBillId/lines/:lineId/pp36-input-claim` | tax.review_issue.resolve (guard L16) | thai_tax | FINAL_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: releases PP36 input VAT after RD receipt (tax-legal) \| CROSS-FEATURE: procurement path, thai_tax guard (tax.review_issue.resolve) => dies with thai_tax=OFF even though the AP line lives in procurement |

**`procurement/presentation/http/purchase-order.controller.ts`** — class `PurchaseOrderController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:24 | `GET /v1/companies/:companyId/procurement/purchase-orders` | procurement.purchase_order.read (guard L23) | procurement+procurement.purchase_orders & procurement | READ | PERMISSION_STRIP |  | OK |  |
| create:31 | `POST /v1/companies/:companyId/procurement/purchase-orders` | procurement.purchase_order.create (guard L30) | procurement+procurement.purchase_orders & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| get:38 | `GET /v1/companies/:companyId/procurement/purchase-orders/:id` | procurement.purchase_order.read (guard L37) | procurement+procurement.purchase_orders & procurement | READ | PERMISSION_STRIP |  | OK |  |
| approve:45 | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/approve` | procurement.purchase_order.approve (guard L44) | procurement+procurement.purchase_orders & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| issue:52 | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/issue` | procurement.purchase_order.issue (guard L51) | procurement+procurement.purchase_orders & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| reject:59 | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/reject` | procurement.purchase_order.approve (guard L58) | procurement+procurement.purchase_orders & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| cancel:66 | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/cancel` | procurement.purchase_order.manage (guard L65) | procurement+procurement.purchase_orders & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| close:73 | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/close` | procurement.purchase_order.manage (guard L72) | procurement+procurement.purchase_orders & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`procurement/presentation/http/purchase-request.controller.ts`** — class `PurchaseRequestController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:23 | `GET /v1/companies/:companyId/procurement/purchase-requests` | procurement.purchase_request.read (guard L22) | procurement+procurement.purchase_requests & procurement | READ | PERMISSION_STRIP |  | OK |  |
| create:30 | `POST /v1/companies/:companyId/procurement/purchase-requests` | procurement.purchase_request.create (guard L29) | procurement+procurement.purchase_requests & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| get:37 | `GET /v1/companies/:companyId/procurement/purchase-requests/:id` | procurement.purchase_request.read (guard L36) | procurement+procurement.purchase_requests & procurement | READ | PERMISSION_STRIP |  | OK |  |
| submit:44 | `POST /v1/companies/:companyId/procurement/purchase-requests/:id/submit` | procurement.purchase_request.create (guard L43) | procurement+procurement.purchase_requests & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: submit-for-approval transition |
| approve:51 | `POST /v1/companies/:companyId/procurement/purchase-requests/:id/approve` | procurement.purchase_request.approve (guard L50) | procurement+procurement.purchase_requests & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| reject:58 | `POST /v1/companies/:companyId/procurement/purchase-requests/:id/reject` | procurement.purchase_request.approve (guard L57) | procurement+procurement.purchase_requests & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| cancel:65 | `POST /v1/companies/:companyId/procurement/purchase-requests/:id/cancel` | procurement.purchase_request.create (guard L64) | procurement+procurement.purchase_requests & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`procurement/presentation/http/supplier-payment.controller.ts`** — class `SupplierPaymentController` @11

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:25 | `GET /v1/companies/:companyId/accounts-payable/payments` | procurement.supplier_payment.read (guard L24) | procurement+procurement.supplier_payments & procurement | READ | PERMISSION_STRIP |  | OK |  |
| create:32 | `POST /v1/companies/:companyId/accounts-payable/payments` | procurement.supplier_payment.create, procurement.supplier_payment.release (guard L31) | procurement+procurement.supplier_payments & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| get:39 | `GET /v1/companies/:companyId/accounts-payable/payments/:id` | procurement.supplier_payment.read (guard L38) | procurement+procurement.supplier_payments & procurement | READ | PERMISSION_STRIP |  | OK |  |
| postingSource:46 | `GET /v1/companies/:companyId/accounts-payable/payments/:id/posting-source` | procurement.supplier_payment.read (guard L45) | procurement+procurement.supplier_payments & procurement | READ | PERMISSION_STRIP |  | OK |  |
| pp36PostingSource:53 | `GET /v1/companies/:companyId/accounts-payable/payments/:id/pp36-posting-source` | procurement.supplier_payment.read (guard L52) | procurement+procurement.supplier_payments & procurement | READ | PERMISSION_STRIP |  | OK |  |
| void:60 | `POST /v1/companies/:companyId/accounts-payable/payments/:id/void` | procurement.supplier_payment.void (guard L59) | procurement+procurement.supplier_payments & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| aging:67 | `GET /v1/companies/:companyId/accounts-payable/aging` | procurement.ap.report (guard L66) | procurement+procurement.ap_aging & procurement | READ | PERMISSION_STRIP |  | OK |  |
| statement:74 | `GET /v1/companies/:companyId/accounts-payable/suppliers/:supplierId/statement` | procurement.ap.report (guard L73) | procurement+procurement.ap_aging & procurement | READ | PERMISSION_STRIP |  | OK |  |

**`procurement/presentation/http/supplier.controller.ts`** — class `SupplierController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:22 | `GET /v1/companies/:companyId/procurement/suppliers` | procurement.supplier.read (guard L21) | procurement+procurement.suppliers & procurement | READ | PERMISSION_STRIP |  | OK |  |
| create:29 | `POST /v1/companies/:companyId/procurement/suppliers` | procurement.supplier.manage (guard L28) | procurement+procurement.suppliers & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| get:36 | `GET /v1/companies/:companyId/procurement/suppliers/:supplierId` | procurement.supplier.read (guard L35) | procurement+procurement.suppliers & procurement | READ | PERMISSION_STRIP |  | OK |  |
| update:43 | `PATCH /v1/companies/:companyId/procurement/suppliers/:supplierId` | procurement.supplier.manage (guard L42) | procurement+procurement.suppliers & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| getBankAccounts:50 | `GET /v1/companies/:companyId/procurement/suppliers/:supplierId/bank-accounts` | procurement.supplier.bank.read (guard L49) | procurement+procurement.suppliers & procurement | READ | PERMISSION_STRIP |  | OK |  |
| createBankAccount:57 | `POST /v1/companies/:companyId/procurement/suppliers/:supplierId/bank-accounts` | procurement.supplier.bank.manage (guard L56) | procurement+procurement.suppliers & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`procurement/presentation/http/vendor-bill.controller.ts`** — class `VendorBillController` @11

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:32 | `GET /v1/companies/:companyId/accounts-payable/vendor-bills` | procurement.vendor_bill.read (guard L31) | procurement+procurement.vendor_bills & procurement | READ | PERMISSION_STRIP |  | OK |  |
| getPolicy:40 | `GET /v1/companies/:companyId/accounts-payable/vendor-bills/approval-policy` | procurement.approval_policy.read (guard L39) | procurement+procurement.vendor_bills | READ | PERMISSION_STRIP |  | OK |  |
| updatePolicy:47 | `PUT /v1/companies/:companyId/accounts-payable/vendor-bills/approval-policy` | procurement.approval_policy.manage (guard L46) | procurement+procurement.vendor_bills | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| getPp36PostingSource:54 | `GET /v1/companies/:companyId/accounts-payable/vendor-bills/:id/pp36-posting-source` | procurement.vendor_bill.read (guard L53) | procurement+procurement.vendor_bills & procurement | READ | PERMISSION_STRIP |  | OK |  |
| create:61 | `POST /v1/companies/:companyId/accounts-payable/vendor-bills` | procurement.vendor_bill.create (guard L60) | procurement+procurement.vendor_bills & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| get:68 | `GET /v1/companies/:companyId/accounts-payable/vendor-bills/:id` | procurement.vendor_bill.read (guard L67) | procurement+procurement.vendor_bills & procurement | READ | PERMISSION_STRIP |  | OK |  |
| updateEvidence:75 | `PATCH /v1/companies/:companyId/accounts-payable/vendor-bills/:id/tax-evidence` | procurement.vendor_bill.create (guard L74) | procurement+procurement.vendor_bills & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| reviewEvidence:82 | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/tax-evidence/review` | procurement.vendor_bill.approve (guard L81) | procurement+procurement.vendor_bills & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| getPostingSource:89 | `GET /v1/companies/:companyId/accounts-payable/vendor-bills/:id/posting-source` | procurement.vendor_bill.read (guard L88) | procurement+procurement.vendor_bills & procurement | READ | PERMISSION_STRIP |  | OK |  |
| match:96 | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/match` | procurement.vendor_bill.match (guard L95) | procurement+procurement.vendor_bills & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| overrideMatchRoute:103 | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/match/override` | procurement.vendor_bill.match.override (guard L102) | procurement+procurement.vendor_bills & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| submit:110 | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/submit` | procurement.vendor_bill.create (guard L109) | procurement+procurement.vendor_bills & procurement | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: submit-for-approval transition |
| approve:117 | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/approve` | procurement.vendor_bill.approve (guard L116) | procurement+procurement.vendor_bills & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| reject:124 | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/reject` | procurement.vendor_bill.approve (guard L123) | procurement+procurement.vendor_bills & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| void:131 | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/void` | procurement.vendor_bill.void (guard L130) | procurement+procurement.vendor_bills & procurement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

### reimbursements (23)

**`reimbursements/presentation/http/reimbursement-policy.controller.ts`** — class `ReimbursementPolicyController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| get:19 | `GET /v1/companies/:companyId/reimbursement-policy` | reimbursement.policy.read (guard L17) | reimbursement | READ | PERMISSION_STRIP |  | OK |  |
| update:26 | `PUT /v1/companies/:companyId/reimbursement-policy` | reimbursement.policy.manage (guard L24) | reimbursement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |

**`reimbursements/presentation/http/reimbursement.controller.ts`** — class `ReimbursementController` @53

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listApprovalQueue:98 | `GET /v1/companies/:companyId/reimbursements/approval-queue` | reimbursement.approve (guard L96) | reimbursement | READ | PERMISSION_STRIP |  | OK |  |
| listFinanceQueue:105 | `GET /v1/companies/:companyId/reimbursements/finance-queue` | reimbursement.finance_review (guard L103) | reimbursement | READ | PERMISSION_STRIP |  | OK |  |
| listUnpostedPayments:112 | `GET /v1/companies/:companyId/reimbursements/posting/pending` | reimbursement.finance_review (guard L110) | reimbursement | READ | PERMISSION_STRIP |  | OK |  |
| summary:119 | `GET /v1/companies/:companyId/reimbursements/summary` | reimbursement.read_own (guard L117) | reimbursement | READ | PERMISSION_STRIP |  | OK |  |
| list:128 | `GET /v1/companies/:companyId/reimbursements` | reimbursement.read_own (guard L126) | reimbursement | READ | PERMISSION_STRIP |  | OK |  |
| create:148 | `POST /v1/companies/:companyId/reimbursements` | reimbursement.create (guard L146) | reimbursement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| get:155 | `GET /v1/companies/:companyId/reimbursements/:requestId` | reimbursement.read_own (guard L153) | reimbursement | READ | PERMISSION_STRIP |  | OK |  |
| update:162 | `PATCH /v1/companies/:companyId/reimbursements/:requestId` | reimbursement.update_own_draft (guard L160) | reimbursement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| submitRequest:170 | `POST /v1/companies/:companyId/reimbursements/:requestId/submit` | reimbursement.submit (guard L167) | reimbursement | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: submit-for-approval transition |
| cancelRequest:178 | `POST /v1/companies/:companyId/reimbursements/:requestId/cancel` | reimbursement.cancel_own (guard L175) | reimbursement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| approveRequest:188 | `POST /v1/companies/:companyId/reimbursements/:requestId/approve` | reimbursement.approve (guard L185) | reimbursement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| rejectRequest:196 | `POST /v1/companies/:companyId/reimbursements/:requestId/reject` | reimbursement.reject (guard L193) | reimbursement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| reviewRequest:206 | `POST /v1/companies/:companyId/reimbursements/:requestId/finance-review` | reimbursement.finance_review (guard L203) | reimbursement | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| createPayment:213 | `POST /v1/companies/:companyId/reimbursements/:requestId/payments` | reimbursement.payment.record (guard L211) | reimbursement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| voidRequestPayment:221 | `POST /v1/companies/:companyId/reimbursements/:requestId/payments/:paymentId/void` | reimbursement.payment.void (guard L218) | reimbursement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| export:233 | `GET /v1/companies/:companyId/reimbursements/:requestId/export` | reimbursement.export (guard L231) | reimbursement | READ | PERMISSION_STRIP |  | OK |  |
| previewClaimForm:243 | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/preview` | reimbursement.read_own (guard L240) | reimbursement | READ | PERMISSION_STRIP |  | OK |  |
| initClaimSignature:255 | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/signature-upload-intent` | reimbursement.read_own (guard L253) | reimbursement | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: upload intent |
| completeClaimSignature:262 | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/signature-uploads/:attachmentId/complete` | reimbursement.read_own (guard L260) | reimbursement | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: upload completion |
| signClaimForm:275 | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/signatures` | reimbursement.read_own (guard L272) | reimbursement | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| linkSignedCopy:283 | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/signed-copies` | reimbursement.read_own (guard L280) | reimbursement | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: attaches scan of signed form |

### reports (11)

**`reports/presentation/http/report.controller.ts`** — class `ReportController` @23

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| catalogHandler:41 | `GET /v1/companies/:companyId/reports/catalog` | report.catalog.read (guard L39) | reports | READ | PERMISSION_STRIP |  | OK |  |
| queryHandler:49 | `POST /v1/companies/:companyId/reports/query` | report.catalog.read, report.dataset.read, report.query.run (guard L46) | reports | READ | PERMISSION_STRIP |  | OK |  |
| runHandler:56 | `GET /v1/companies/:companyId/reports/runs/:runId` | report.catalog.read, report.dataset.read, report.query.run (guard L54) | reports | READ | PERMISSION_STRIP |  | OK |  |
| drilldownHandler:64 | `POST /v1/companies/:companyId/reports/drilldown` | report.catalog.read, report.dataset.read, report.query.run (guard L61) | reports | READ | PERMISSION_STRIP |  | OK |  |
| viewsHandler:71 | `GET /v1/companies/:companyId/reports/views` | report.view.read (guard L69) | reports | READ | PERMISSION_STRIP |  | OK |  |
| createViewHandler:78 | `POST /v1/companies/:companyId/reports/views` | report.view.create (guard L76) | reports | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| updateViewHandler:85 | `PATCH /v1/companies/:companyId/reports/views/:viewId` | report.view.update_own (guard L83) | reports | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| archiveViewHandler:93 | `POST /v1/companies/:companyId/reports/views/:viewId/archive` | report.view.update_own (guard L90) | reports | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: archive = internal state flag |
| exportsHandler:100 | `GET /v1/companies/:companyId/reports/exports` | report.export.read_own (guard L98) | reports | READ | PERMISSION_STRIP |  | OK |  |
| exportHandler:107 | `POST /v1/companies/:companyId/reports/exports` | report.export (guard L105) | reports | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: creates export job |
| downloadHandler:114 | `GET /v1/companies/:companyId/reports/exports/:exportId/download` | report.export.read_own (guard L112) | reports | READ | PERMISSION_STRIP |  | OK |  |

### system-onboarding (4)

**`system-onboarding/presentation/http/system-onboarding.controller.ts`** — class `SystemOnboardingController` @37

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| create:51 | `POST /v1/system/company-onboardings` | system.company_onboarding.create (guard L47) | UNMAPPED | FINAL_MUTATION | NONE |  | OK | mutationClass override: provisions tenant + issues one-time credential \| guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| getById:76 | `GET /v1/system/company-onboardings/:id` | system.company_onboarding.read (guard L72) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| regenerateTempPassword:86 | `POST /v1/system/company-onboardings/:id/regenerate-temporary-password` | system.company_onboarding.regenerate_temporary_password (guard L82) | UNMAPPED | FINAL_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| reissueOwnerLineLinkQr:101 | `POST /v1/system/company-onboardings/:id/reissue-owner-line-link` | system.company_onboarding.regenerate_temporary_password (guard L97) | UNMAPPED | FINAL_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |

### system-partner-management (14)

**`system-partner-management/presentation/http/partner.controller.ts`** — class `PartnerController` @60

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| list:79 | `GET /v1/system/partners` | system.partner_dashboard.read (guard L76) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| detail:100 | `GET /v1/system/partners/:partnerCompanyId` | system.partner_dashboard.read (guard L96) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| update:109 | `PATCH /v1/system/partners/:partnerCompanyId` | system.partner_company.update (guard L105) | UNMAPPED | ROOT_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| transitionLifecycle:129 | `POST /v1/system/partners/:partnerCompanyId/lifecycle` | system.partner_company.lifecycle.manage (guard L124) | UNMAPPED | FINAL_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| members:148 | `GET /v1/system/partners/:partnerCompanyId/members` | system.partner_member.read (guard L144) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| unlinkLine:158 | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/line-unlink` | system.partner_member.manage (guard L154) | UNMAPPED | FINAL_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| resetPassword:177 | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/password/reset` | system.partner_member.manage (guard L173) | UNMAPPED | FINAL_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| revealPassword:196 | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/password/reveal` | system.partner_member.manage (guard L192) | UNMAPPED | READ | NONE |  | OK | mutationClass override: audited sensitive read; no state change \| guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| setFeatureEntitlements:214 | `PUT /v1/system/partners/:partnerCompanyId/features` | system.partner_feature.manage (guard L210) | UNMAPPED | ROOT_MUTATION | NONE |  | OK | mutationClass override: ENTITLEMENT CONTROL-PLANE writer; guard set-partner-features.use-case.ts:52-75 \| guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| setAiModelConfig:232 | `PUT /v1/system/partners/:partnerCompanyId/ai-model` | system.partner_ai_model.manage (guard L228) | UNMAPPED | ROOT_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| aiUsage:250 | `GET /v1/system/partners/:partnerCompanyId/ai-usage` | system.partner_dashboard.read (guard L247) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |

**`system-partner-management/presentation/http/system-ai-budget.controller.ts`** — class `SystemAiBudgetController` @21

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| get:31 | `GET /v1/system/ai-budget` | system.partner_ai_model.manage (guard L28) | UNMAPPED | READ | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |
| set:40 | `PUT /v1/system/ai-budget` | system.partner_ai_model.manage (guard L36) | UNMAPPED | ROOT_MUTATION | NONE |  | OK | guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |

**`system-partner-management/presentation/http/system-line.controller.ts`** — class `SystemLineController` @18

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| setSharedCredential:25 | `PUT /v1/system/line/shared-credentials/:credentialKind` | system.shared_line_credential.manage (guard L22) | UNMAPPED | FINAL_MUTATION | NONE |  | OK | mutationClass override: platform LINE credential replacement \| guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| platform control-plane (system admin), not a tenant SKU surface |

### tax (42)

**`tax/presentation/http/tax.controller.ts`** — class `TaxController` @19

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| getProfile:47 | `GET /v1/companies/:companyId/tax/profile` | tax.profile.read (guard L45) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| listPeriods:57 | `GET /v1/companies/:companyId/tax/periods` | tax.period.read (guard L55) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| sync:67 | `POST /v1/companies/:companyId/tax/sync` | tax.event.sync (guard L65) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: materializes source tax events, recomputable |
| listEvents:77 | `GET /v1/companies/:companyId/tax/periods/:periodId/events` | tax.event.read (guard L75) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| generateVatReport:87 | `POST /v1/companies/:companyId/tax/periods/:periodId/vat-report` | tax.report.recompute (guard L85) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: recomputable snapshot |
| generateWhtReport:97 | `POST /v1/companies/:companyId/tax/periods/:periodId/wht-report` | tax.report.recompute (guard L95) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: recomputable snapshot |
| listReviewIssues:106 | `GET /v1/companies/:companyId/tax/periods/:periodId/review-issues` | tax.review_issue.read (guard L104) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| resolveIssue:113 | `PATCH /v1/companies/:companyId/tax/review-issues/:issueId/resolve` | tax.review_issue.resolve (guard L111) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: internal review decision |
| markFiled:131 | `PATCH /v1/companies/:companyId/tax/periods/:periodId/mark-filed` | tax.filing.mark_filed (guard L129) | thai_tax | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| markPaid:163 | `PATCH /v1/companies/:companyId/tax/periods/:periodId/mark-paid` | tax.filing.mark_paid (guard L161) | thai_tax | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| generateExportPackage:177 | `POST /v1/companies/:companyId/tax/periods/:periodId/filing-packages` | tax.report.export (guard L175) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: export artifact |
| issueWhtCertificate:187 | `POST /v1/companies/:companyId/tax/wht-certificates` | tax.certificate.issue (guard L185) | thai_tax | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| citCalendar:196 | `GET /v1/companies/:companyId/tax/cit-calendar` | tax.period.read (guard L194) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| listWhtCategories:205 | `GET /v1/companies/:companyId/tax/wht-categories` | tax.config.read (guard L203) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |

**`tax/presentation/http/transaction-tax.controller.ts`** — class `TransactionTaxController` @26

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listProfiles:48 | `GET /v1/companies/:companyId/tax/code-profiles` | tax.profile.read (guard L46) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| listProfileTemplates:55 | `GET /v1/companies/:companyId/tax/code-profile-templates` | tax.profile.read (guard L54) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| createProfileFromTemplate:62 | `POST /v1/companies/:companyId/tax/code-profile-templates/:templateKey` | tax.profile.manage, tax.config.manage (guard L61) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| createProfile:74 | `POST /v1/companies/:companyId/tax/code-profiles` | tax.profile.manage (guard L73) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| updateProfile:81 | `PATCH /v1/companies/:companyId/tax/code-profiles/:profileId` | tax.profile.manage (guard L80) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| getProfileReadiness:88 | `GET /v1/companies/:companyId/tax/code-profiles/:profileId/readiness` | tax.profile.read, tax.config.read (guard L87) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| activateProfile:96 | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/activate` | tax.profile.manage (guard L95) | thai_tax | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| retireProfile:104 | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/retire` | tax.profile.manage (guard L103) | thai_tax | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| previewProfileImport:112 | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/import-preview` | tax.config.manage (guard L111) | thai_tax | READ | PERMISSION_STRIP | yes | OK | twoStep: pairs with .../import-apply (transaction-tax.controller.ts:111-122) |
| applyProfileImport:120 | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/import-apply` | tax.config.manage (guard L119) | thai_tax | FINAL_MUTATION | PERMISSION_STRIP | yes | OK | twoStep: apply half of the preview/apply pair |
| listDefinitions:127 | `GET /v1/companies/:companyId/tax/code-definitions` | company.branch.read (guard L126) | company_settings+company_settings.branches | READ | PERMISSION_STRIP |  | BLOCKED | BLOCKED: Thai-tax surface guarded by company.branch.read (always-on company_settings submenu) => survives thai_tax=OFF. Missing: correct tax.* permission or explicit owner decision. |
| upsertDefinition:143 | `POST /v1/companies/:companyId/tax/code-definitions` | tax.config.manage (guard L142) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| updateDefinition:150 | `PATCH /v1/companies/:companyId/tax/code-definitions/:taxCodeId` | tax.config.manage (guard L149) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| resolvePreview:158 | `POST /v1/companies/:companyId/tax/resolve-preview` | company.branch.read (guard L157) | company_settings+company_settings.branches | READ | PERMISSION_STRIP |  | BLOCKED | BLOCKED: Thai-tax resolve preview guarded by company.branch.read => survives thai_tax=OFF. Missing: correct tax.* permission or explicit owner decision. |
| previewLegacyRemediation:166 | `POST /v1/companies/:companyId/tax/legacy-remediation/preview` | tax.config.manage, tax.review_issue.resolve (guard L165) | thai_tax | READ | PERMISSION_STRIP | yes | OK | twoStep: pairs with .../legacy-remediation/apply (transaction-tax.controller.ts:165-176) |
| applyLegacyRemediation:174 | `POST /v1/companies/:companyId/tax/legacy-remediation/apply` | tax.config.manage, tax.review_issue.resolve (guard L173) | thai_tax | FINAL_MUTATION | PERMISSION_STRIP | yes | OK | twoStep: apply half of the preview/apply pair |
| listAccountRules:181 | `GET /v1/companies/:companyId/tax/account-determination` | ledger.posting-rule.read (guard L180) | double_entry_ledger | READ | PERMISSION_STRIP |  | OK | CROSS-FEATURE: tax surface guarded by ledger.posting-rule.read => owned by double_entry_ledger, survives thai_tax=OFF |
| upsertAccountRule:196 | `PUT /v1/companies/:companyId/tax/account-determination` | tax.config.manage, ledger.posting-rule.manage (guard L195) | thai_tax & double_entry_ledger | ROOT_MUTATION | PERMISSION_STRIP |  | OK | CROSS-FEATURE: requires tax.config.manage AND ledger.posting-rule.manage => needs BOTH thai_tax and double_entry_ledger |
| listReportRules:203 | `GET /v1/companies/:companyId/tax/report-mappings` | tax.config.read (guard L202) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| upsertReportRule:210 | `PUT /v1/companies/:companyId/tax/report-mappings` | tax.config.manage (guard L209) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| listEvidence:217 | `GET /v1/companies/:companyId/tax/trade-evidence` | tax.config.read (guard L216) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| createEvidence:232 | `POST /v1/companies/:companyId/tax/trade-evidence` | company.branch.read (guard L231) | company_settings+company_settings.branches | ROOT_MUTATION | PERMISSION_STRIP |  | BLOCKED | BLOCKED: Thai-tax trade-evidence create guarded by company.branch.read => survives thai_tax=OFF. Missing: correct tax.* permission or explicit owner decision. |
| verifyEvidence:240 | `POST /v1/companies/:companyId/tax/trade-evidence/:evidenceId/verify` | tax.config.manage (guard L239) | thai_tax | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| generateReconciliation:247 | `POST /v1/companies/:companyId/tax/reconciliations` | tax.report.recompute (guard L246) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: reconciliation run record |
| listReconciliations:254 | `GET /v1/companies/:companyId/tax/reconciliations` | tax.report.read (guard L253) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| getReconciliation:269 | `GET /v1/companies/:companyId/tax/reconciliations/:runId` | tax.report.read (guard L268) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |
| reviewReconciliation:277 | `POST /v1/companies/:companyId/tax/reconciliations/:runId/review` | tax.review_issue.resolve (guard L276) | thai_tax | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| pp30Boxes:285 | `GET /v1/companies/:companyId/tax/reports/pp30-boxes` | tax.report.read (guard L284) | thai_tax | READ | PERMISSION_STRIP |  | OK |  |

### workflow (28)

**`workflow/presentation/http/workflow-dead-letter.controller.ts`** — class `WorkflowDeadLetterController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listDeadLetters:20 | `GET /v1/companies/:companyId/workflow/dead-letters` | workflow.dead_letter.read (guard L18) | workflow_automation+workflow_automation.dead_letters & workflow_automation | READ | PERMISSION_STRIP |  | OK |  |
| replay:39 | `POST /v1/companies/:companyId/workflow/dead-letters/:deadLetterId/replay` | workflow.dead_letter.replay (guard L36) | workflow_automation+workflow_automation.dead_letters & workflow_automation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| ignore:47 | `POST /v1/companies/:companyId/workflow/dead-letters/:deadLetterId/ignore` | workflow.dead_letter.replay (guard L44) | workflow_automation+workflow_automation.dead_letters & workflow_automation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`workflow/presentation/http/workflow-internal.controller.ts`** — class `WorkflowInternalController` @19

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ingest:29 | `POST /v1/internal/workflow/events/ingest` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| drain:40 | `POST /v1/internal/workflow/outbox/drain` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| scan:46 | `POST /v1/internal/workflow/scan` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |
| retry:52 | `POST /v1/internal/workflow/action-runs/retry` | — (@Public L17) | NONE | SYSTEM | NONE |  | OK | worker token only (assertWorkerToken); no entitlement check — bypasses the chokepoint |

**`workflow/presentation/http/workflow-rule.controller.ts`** — class `WorkflowRuleController` @25

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listRules:39 | `GET /v1/companies/:companyId/workflow/rules` | workflow.rule.read (guard L37) | workflow_automation+workflow_automation.rules & workflow_automation | READ | PERMISSION_STRIP |  | OK |  |
| createRule:60 | `POST /v1/companies/:companyId/workflow/rules` | workflow.rule.manage (guard L58) | workflow_automation+workflow_automation.rules & workflow_automation | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| getOne:67 | `GET /v1/companies/:companyId/workflow/rules/:ruleId` | workflow.rule.read (guard L65) | workflow_automation+workflow_automation.rules & workflow_automation | READ | PERMISSION_STRIP |  | OK |  |
| updateRule:74 | `PATCH /v1/companies/:companyId/workflow/rules/:ruleId` | workflow.rule.manage (guard L72) | workflow_automation+workflow_automation.rules & workflow_automation | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| enable:82 | `POST /v1/companies/:companyId/workflow/rules/:ruleId/enable` | workflow.rule.enable (guard L79) | workflow_automation+workflow_automation.rules & workflow_automation | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: automation config, reversible |
| disable:90 | `POST /v1/companies/:companyId/workflow/rules/:ruleId/disable` | workflow.rule.manage (guard L87) | workflow_automation+workflow_automation.rules & workflow_automation | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: automation config, reversible |
| test:98 | `POST /v1/companies/:companyId/workflow/rules/:ruleId/test` | workflow.rule.manage (guard L95) | workflow_automation+workflow_automation.rules & workflow_automation | READ | PERMISSION_STRIP |  | OK |  |

**`workflow/presentation/http/workflow-run.controller.ts`** — class `WorkflowRunController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listRuns:21 | `GET /v1/companies/:companyId/workflow/runs` | workflow.run.read (guard L19) | workflow_automation+workflow_automation.runs & workflow_automation | READ | PERMISSION_STRIP |  | OK |  |
| getRun:42 | `GET /v1/companies/:companyId/workflow/runs/:runId` | workflow.run.read (guard L40) | workflow_automation+workflow_automation.runs & workflow_automation | READ | PERMISSION_STRIP |  | OK |  |
| explainRun:49 | `GET /v1/companies/:companyId/workflow/explanations/:runId` | workflow.run.read (guard L47) | workflow_automation+workflow_automation.runs & workflow_automation | READ | PERMISSION_STRIP |  | OK |  |
| replayActionRun:57 | `POST /v1/companies/:companyId/workflow/action-runs/:actionRunId/replay` | workflow.run.replay (guard L54) | workflow_automation+workflow_automation.runs & workflow_automation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`workflow/presentation/http/workflow-task.controller.ts`** — class `WorkflowTaskController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listTasks:21 | `GET /v1/companies/:companyId/workflow/tasks` | workflow.task.read (guard L19) | workflow_automation+workflow_automation.tasks & workflow_automation | READ | PERMISSION_STRIP |  | OK |  |
| snooze:42 | `POST /v1/companies/:companyId/workflow/tasks/:taskId/snooze` | workflow.task.work (guard L39) | workflow_automation+workflow_automation.tasks & workflow_automation | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| complete:50 | `POST /v1/companies/:companyId/workflow/tasks/:taskId/complete` | workflow.task.work (guard L47) | workflow_automation+workflow_automation.tasks & workflow_automation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |
| cancel:58 | `POST /v1/companies/:companyId/workflow/tasks/:taskId/cancel` | workflow.task.work (guard L55) | workflow_automation+workflow_automation.tasks & workflow_automation | FINAL_MUTATION | PERMISSION_STRIP |  | OK |  |

**`workflow/presentation/http/workflow-template.controller.ts`** — class `WorkflowTemplateController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listTemplates:19 | `GET /v1/companies/:companyId/workflow/templates` | workflow.template.read (guard L17) | workflow_automation+workflow_automation.templates & workflow_automation | READ | PERMISSION_STRIP |  | OK |  |
| enable:27 | `POST /v1/companies/:companyId/workflow/templates/:templateKey/enable` | workflow.rule.manage, workflow.rule.enable (guard L24) | workflow_automation+workflow_automation.rules & workflow_automation | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: creates rule from template |

**`workflow/presentation/http/workflow-webhook.controller.ts`** — class `WorkflowWebhookController` @10

| handler:line | method + path | permissions (evidence) | featureKey | mutationClass | enforcement | 2-step | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| listEndpoints:20 | `GET /v1/companies/:companyId/workflow/webhooks` | workflow.webhook.manage (guard L18) | workflow_automation+workflow_automation.webhooks & workflow_automation | READ | PERMISSION_STRIP |  | OK |  |
| createEndpoint:27 | `POST /v1/companies/:companyId/workflow/webhooks` | workflow.webhook.manage (guard L25) | workflow_automation+workflow_automation.webhooks & workflow_automation | ROOT_MUTATION | PERMISSION_STRIP |  | OK |  |
| enable:35 | `POST /v1/companies/:companyId/workflow/webhooks/:endpointId/enable` | workflow.webhook.manage (guard L32) | workflow_automation+workflow_automation.webhooks & workflow_automation | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: endpoint config, reversible |
| disable:43 | `POST /v1/companies/:companyId/workflow/webhooks/:endpointId/disable` | workflow.webhook.manage (guard L40) | workflow_automation+workflow_automation.webhooks & workflow_automation | ROOT_MUTATION | PERMISSION_STRIP |  | OK | mutationClass override: endpoint config, reversible |

