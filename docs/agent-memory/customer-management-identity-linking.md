# Agent Memory: Customer Management and Identity Linking

Status: CUSTOMER-MANAGEMENT SLICE IMPLEMENTED AND VERIFIED LOCALLY — production directory, identity linking/merge, role projection, PDPA/race hardening, durable delivery, fresh migration, builds, and browser smoke pass. Broad checklist items 15 and 15A remain unchecked because their wider import/campaign/service-job/live-launch scope is not closed by this slice.

Owner: Product owner; item 15 CRM implementer; item 15A CRM Inbox/LINE implementer.

Scope:

- Make `/companies/:companyId/customers` the sole production Customer Directory across manual, walk-in, phone, web, LINE, import, and AI-assisted-preview intake.
- Keep `CrmCustomer.id` scoped by `companyId` as canonical identity.
- Add production create/edit/archive/assign, duplicate-candidate/reuse, masked LINE identity, and Owner/Admin identity re-point/full soft merge behavior.
- Separate acquisition `originSource` from `createdByType`/`createdByUserId`.
- Enforce least-privilege customer row scope and server-side field projection for every role before list/detail/search/duplicate/AI serialization.
- Keep AI parse/preview-only and route all writes through permission-checked CRM APIs.

Decisions:

- Canonical route: `/companies/:companyId/customers`. Customer 360 remains detail/history. Any `/crm` customer tab links to the canonical route and does not own separate CRUD state.
- First-pass editable fields: `displayName` required; `primaryPhone`, `tier`, and `notes` optional. `originSource` is create-only in staff UI.
- Staff-safe origins: `MANUAL`, `WALK_IN`, `PHONE`, `WEB`, `OTHER`. Trusted system adapters alone assign `LINE`, `FACEBOOK`, `MARKETPLACE`, `REFERRAL`, `IMPORT`, or future provider origins. `AI` is never an origin.
- `createdByType`: `USER`, `SYSTEM`, or `AI_ASSISTED`, always alongside the real `createdByUserId`/system actor and audit. `AI_ASSISTED` does not grant authority.
- Internal `CrmCustomer.id`, normalized values, verified LINE identity, and raw `providerUserId` are read-only/system-owned.
- Exact verified `(channelId, providerUserId)` deterministically reuses its existing same-company customer before any AI call. New identity + provisional LINE customer creation must be transaction/race safe and leave no orphan on concurrent first contact.
- Legacy orphan/cross-company identity repair creates one deterministic provisional LINE customer per invalid identity and re-points that identity's conversations before validating the composite same-company FK; migration never guesses by name.
- Prisma 7 wraps this migration in a transaction and rejects concurrent index creation. Production rollout therefore requires a short CRM write window; regular tracked indexes use a 5-second fail-fast `lock_timeout`, composite FKs use `NOT VALID`/`VALIDATE`, and any historical tenant/coherence mismatch aborts before data mutation for manual remediation.
- Exact normalized phone is a duplicate candidate requiring explicit human reuse/link-or-continue confirmation. Name-only similarity is warning-only and never auto-links or auto-merges.
- Create and identity-changing update both run duplicate checks. Exact tax/external-id conflicts may block under existing policy; no path silently merges.
- Identity re-point is a high-risk partial merge: Owner/Admin with `crm.customer.merge` only. `crm.customer.update` and inbox scope never authorize re-binding. Re-point identity + its conversations and audit previous/target ids; remaining records on the prior customer stay visible for full merge review.
- Full merge: Owner/Admin with `crm.customer.merge` by default; preview + primary/secondary + reason. One transaction re-points channel identities, conversations, bookings, contacts, opportunities, activities, follow-ups, quotation links, and lead `convertedCustomerId`. Secondary becomes `MERGED` with `mergedIntoCustomerId`; same-pair retry returns stored state; no hard delete or issued-accounting-snapshot rewrite.
- AI intake: `POST /companies/:companyId/crm/customers/ai-profile-extract` requires `crm.ai.assist` + `crm.customer.create`; body `{text,locale?}` returns bounded editable `displayName`/`primaryPhone`/`primaryEmail`/`notes` suggestion with `ok|uncertain|unavailable`. Staff confirms create/reuse through the normal form. Internal gateway route is `POST /internal/ai/crm-customer-profile-extract`; the dedicated agent has an empty tool allowlist and no save/update/re-point/merge/repository path.
- UI states required: read permission denial; loading skeleton; empty state with permission-aware CTA; load error + retry; form validation; duplicate candidate choice; save/link/merge pending with double-submit prevention; mutation error + retry; success refresh without stale rows.
- Customer field projection is server-enforced, not client hiding: Owner/Admin receive the operational projection for all company customers; Sales receives it for own/assigned customers; Manager receives it only for explicitly assigned customers even when team ABAC exists elsewhere; Auditor receives the full authorized read projection for all company customers without mutations.
- Finance/Accountant receive only customer `id`, `code`, `displayName`, `legalName`, `customerType`, `status`, `branchId`, `accountingCounterpartyId`, `primaryPhone`, `primaryEmail`, `taxId`, `createdAt`, `updatedAt`, plus contact `id`, `customerId`, `name`, `role`, `phone`, `email`, `preferredChannel`, `isPrimary`, `status`. Customer/contact notes, consent evidence, owner, origin/actor provenance, tier/engagement/LTV/follow-up fields, social ids, and every LINE aggregate/identity field are excluded.
- Marketing receives only a purpose-scoped `customerRef` that is not raw `CrmCustomer.id`, plus `status`, `consentStatus`, `originSource`, `tier`, and permitted segment ids. Names, codes, phone/email/tax/address, contact-person records, notes, owner/accounting links, social ids, and every LINE aggregate/identity field are excluded.
- Projection is a discriminated `{projection, customer}` server DTO and mixed roles resolve entitlement per row. Sales+Finance therefore receives operational fields only on assigned rows and accounting/contact fields elsewhere; a broad low-field role can never upgrade another role's fields. Marketing uses a stored random reference and cannot resolve the canonical-id detail/search routes when it is the only row entitlement.
- Raw provider user ids, normalized matching keys, internal lock/storage fields, and Prisma rows remain system-only for every role, including Owner/Admin/Auditor. Duplicate candidates outside row scope use the redacted candidate shape without confirming hidden record details.
- PDPA erasure is an atomic anonymize-not-hard-delete boundary: set `personalDataErasedAt`, scrub the canonical row and all merged aliases/direct PII copies, rotate marketing references, preserve finance-linked legal artifacts, and persist CRITICAL audit evidence in the same transaction. Background profile/media/AI/trust work and inbound/outbound writes must atomically reject tombstoned customers; no automatic reactivation/new customer occurs without an explicit re-consent flow.

Open questions:

- No product-policy question remains for the first pass. Exact DTO/route names may follow the smallest existing code pattern, but they must preserve the decisions above.
- No implementation blocker remains for the customer-management slice. Production rollout still needs the normal deployment window, secret cutover, migration apply, and post-deploy smoke; that is an operations action rather than an unresolved product decision.

Artifacts:

- `docs/specs/crm-sales-spec.md`
- `docs/specs/crm-line-oa-customer-os-spec.md`
- `docs/specs/permission-matrix.md`
- `docs/plans/crm-sales-mvp-plan.md`
- `docs/plans/crm-line-oa-customer-os-plan.md`
- `docs/plans/master-implementation-checklist.md`
- `docs/plans/implementation-roadmap.md`
- `docs/agent-memory/customer-management-identity-linking.md`

Verification:

- Security re-audit after the final tree freeze: P0 = 0, P1 = 0. Focused customer/inbox/booking/repository/daily-brief/delivery suites passed, including role projections, tenant/branch/owner ABAC, exact-state/assignee races, consent/erasure egress fences, merge/link locks, reply age/overlap, notification claim/CAS, and booking-reminder lease/backoff.
- Full package tests on the frozen tree: `pnpm --filter @watchdog-bms/api test`, `.../web test`, `.../ai-gateway test`, `.../config test`, and `.../contracts test` — PASS, exit 0 for every package.
- Typecheck/build: API, Web, AI Gateway, Config, and Contracts — PASS. Web production build compiled and generated `/companies/[companyId]/customers` plus Customer 360 routes successfully.
- Prisma: `prisma validate` and `prisma generate` — PASS. A new disposable PostgreSQL database applied all 53 migrations from empty and seeded successfully; integrity check returned `53|20|13` (finished migrations | validated customer-lineage composite FKs | expected customer/reminder indexes).
- Deployment scripts: `bash -n infra/prod-ecs-express/deploy.sh` and `bash -n infra/prod-app-runner/deploy-api.sh` — PASS. Dedicated current/previous PDPA pseudonymization keys are wired in ECS, App Runner, local compose, and Playwright.
- Browser smoke against the freshly migrated disposable database — PASS: authenticated Customer Directory loaded 14 seeded customers; AI profile extraction returned an uncertain preview without saving; a Walk-in customer was created then edited; the same normalized phone opened an explicit duplicate dialog and “use existing” reused the canonical record; a seeded LINE customer exposed only masked `••••r-k4`, linked to Customer 360, and produced no browser console warning/error. API evidence included 201 create, 200 patch, duplicate-candidate reads, and 200 Customer 360 summary.
- `git diff --check` — PASS before docs closeout; rerun after final docs/commit staging.

Next:

- Review/stage only this customer/CRM security closure and commit without pulling unrelated AI-permission work from the shared tree.
- At production cutover: preserve the old credential-derived pseudonym root in `PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS`, deploy a distinct current `PDPA_PSEUDONYMIZATION_KEY`, apply migrations during a short CRM write window, then smoke create/edit/LINE reuse/Customer 360 and worker delivery health.
- Keep broad items 15 and 15A unchecked until their remaining non-customer-management gates are independently verified; do not reopen this completed slice for unrelated campaign/import/service-job/live-AI work.
