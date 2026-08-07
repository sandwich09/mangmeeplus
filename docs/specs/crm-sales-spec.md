# CRM and Sales Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 15.

Active implementer target: Sonnet 4.6 or later.

Linked plan: [[plans/crm-sales-mvp-plan|CRM Sales MVP Plan]]

## 2. Goal

Implement the first web-owned CRM and sales workflow for SME teams:

- Customer and contact master records.
- One canonical web Customer Directory at `/companies/:companyId/customers` for customer search, create, edit, archive, assignment, identity review, and duplicate resolution.
- Lead intake, assignment, qualification, and conversion.
- Opportunity pipeline with configurable stages and canonical reporting groups.
- Follow-up tasks and append-only sales activity timeline.
- Quotation draft linkage to the Accounting Documents module from item 08.
- Permission-scoped dashboard, notification, LINE AI, and AI Gateway read surfaces.

Web/API is the source of truth for CRM mutations. Deterministic company-OA ingestion may create or reuse a customer under item 15A. AI may parse customer text into a permission-scoped preview, but it never saves, links, or merges a customer directly.

## 3. Non-goals

- Full call-center suite, dialer, telephony recording, or omnichannel inbox.
- Complex territory management, commission engine, sales forecast quotas, or incentive payout.
- Marketing campaign execution. Item 19 owns AI marketing and platforms.
- Marketplace order import automation. Item 20 owns marketplace import.
- Procurement, supplier, AP, payroll, fixed assets, manufacturing, or bank workflows.
- Autonomous AI sales outreach, AI customer contact, AI quotation issue, or AI record mutation.
- Replacing Accounting Documents item 08. CRM may create/link quotation drafts, but item 08 owns official quotation numbers, issue workflow, approval, tax/accounting snapshots, and conversion to invoice/billing note.
- Rewriting issued accounting document snapshots when CRM customer data changes or merges.

## 4. User Roles

- Owner: sees company pipeline, top customers, sales activity, overdue follow-ups, and AI Sales/CRM suggestions.
- Admin: manages CRM settings, import/export, customer merge, pipeline stages, segments, and assignments.
- Sales manager: assigns leads/customers, reviews team pipeline, moves team opportunities, and monitors follow-up SLA; Customer Directory rows remain explicit-assignment-only.
- Sales: manages own/assigned leads, customers, contacts, opportunities, activities, follow-ups, and quotation links through the operational customer projection.
- Finance: reads only the accounting/contact customer projection and quotation/invoice/payment status where accounting permissions allow; no customer/contact notes or LINE identity fields.
- Accountant: reads only the accounting/contact customer projection and CRM-to-accounting source links; no customer/contact notes or LINE identity fields.
- Marketing: reads a purpose-scoped pseudonymous segmentation/consent/origin/tier projection without customer PII, contact-person records, or channel identity.
- Auditor readonly: reads all company CRM records through the full authorized read projection without mutation; raw provider ids and system-only storage fields remain hidden.
- AI assistant user: asks AI Sales/CRM for follow-up priorities, customer context, and pipeline summaries within same permission boundary as web.

## 5. Boundary and Ownership

- CRM module owns `Customer`, `ContactPerson`, `Lead`, `Opportunity`, `Activity`, `FollowUpTask`, `CustomerSegment`, duplicate candidates, and merge records.
- Accounting Documents item 08 owns `AccountingCounterparty`, quotation drafts, issued quotations, invoices, billing notes, receipts, tax invoices, payments, credit notes, debit notes, and immutable issued snapshots.
- CRM customer may link to an accounting counterparty through `accountingCounterpartyId`. If item 08 already has counterparties, CRM links/extends them instead of creating a duplicate master.
- CRM customer edits never rewrite issued accounting document snapshots. Historical quote/invoice evidence remains stable.
- CRM quotation link stores references to accounting document ids and status summaries only. Quotation totals, issue status, approval status, and document number come from accounting APIs/read models.
- Dashboard/notification module owns final delivery of alerts. CRM provides source events/read providers for follow-up due, overdue follow-up, stuck opportunity, and pipeline summary.
- AI Gateway owns no CRM persistence and must call permission-checked API/tools only.

## 6. Current Repository Baseline

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with shared feature-folder conventions evolving through prior roadmap items.
- `packages/contracts`: shared contract package exists but may still be thin.
- `packages/config`: shared config package exists but may still be thin.

Before implementation, inspect latest code again. Items 01 through 14 may add Prisma, auth context, request context, tenant/branch primitives, audit log, outbox, document sequences, accounting document APIs, dashboard providers, notification delivery, LINE binding, worker queues, web route shell, API client helpers, and AI tool registration. Extend those primitives. Do not create duplicates.

## 7. References

- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]]
- Implementation plan: [[plans/crm-sales-mvp-plan|CRM Sales MVP Plan]]
- Accounting quotation/document flow: [[specs/accounting-documents-spec|Accounting Documents Spec]]
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Shared data primitives: [[specs/data-model-core-spec|Data Model Core Spec]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Web shell: [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- Dashboard/notification hooks: [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
- LINE read-only behavior: [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- AI agents: [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- Workflow automation future hooks: [[specs/workflow-automation-spec|Workflow Automation Spec]]

## 8. Core Workflows

### 8.1 Customer and Contact Management

1. User opens the canonical `/customers` directory and creates or edits a customer through the existing permission-checked CRM APIs. The old `/crm` customer tab must link to `/customers`, not host a second CRUD surface.
2. Create requires `displayName`; first-pass editable fields are `displayName`, optional `primaryPhone`, `tier`, and `notes`. `originSource` is selected only on create from the staff-safe values `MANUAL`, `WALK_IN`, `PHONE`, `WEB`, or `OTHER`.
3. API normalizes phone, email, tax id, external ids, and display name, then performs duplicate checks on both create and identity-changing update.
4. An exact verified LINE identity reuses its existing same-company `CrmCustomer.id`. An exact normalized phone match is a duplicate candidate that requires a human choice to reuse/link or continue; a name-only match is advisory and must never auto-link or auto-merge.
5. LINE identity is displayed read-only from `CrmChannelIdentity`. Staff never types or edits raw `providerUserId` or chooses `LINE`/`AI` as a manual origin.
6. LINE identity re-point is a high-risk partial merge. Only Owner/Admin with `crm.customer.merge` may explicitly link an identity/conversation to another active same-company customer; ordinary customer-update permission is insufficient.
7. Full merge also requires `crm.customer.merge`, preview, primary/secondary selection, and reason. It re-points channel identities, conversations, bookings, contacts, opportunities, activities, follow-ups, quotation links, and lead `convertedCustomerId` references in one audited transaction; the secondary becomes `MERGED` with `mergedIntoCustomerId` and is never hard-deleted.
8. User stores other customer profile, consent, segment, owner, and contact-person data on the existing detail/Customer 360 surfaces as permissions allow.
9. API audits create/update/link/assign/archive/merge and emits bounded outbox events where current outbox exists.
10. Customer detail shows timeline, open follow-ups, opportunities, quotation links, booking history, LINE-link status, and permitted accounting status.

### 8.2 Lead Intake and Qualification

1. Lead is created manually in MVP. Source enums allow later CSV, LINE, Facebook, marketplace, web form, and referral intake.
2. Lead starts in `NEW` or `CONTACTED` with assigned owner or unassigned queue.
3. Sales user logs activity and next follow-up.
4. Qualified lead converts to customer and opportunity through one idempotent use case.
5. Disqualified lead requires reason and keeps audit trail.

### 8.3 Opportunity Pipeline

1. Sales creates opportunity from customer or converted lead.
2. Opportunity starts in first active pipeline stage.
3. User moves opportunity through configured stages.
4. Stage moves create append-only activity entries.
5. Terminal `WON` and `LOST` require explicit close action.
6. `LOST` requires reason. `WON` should link a quotation or record a manual win reason when no quotation exists.
7. Reopening terminal opportunity requires manager/admin permission and audit reason.

### 8.4 Follow-Up and Activity

1. User creates follow-up task with owner, due date, channel, priority, and optional opportunity.
2. Task status moves through open, done, snoozed, or canceled.
3. Completing a follow-up can log activity outcome and next follow-up in same API transaction.
4. Overdue follow-up contributes to dashboard/notification provider and AI priority ranking.
5. Activity entries are append-only. Corrections create new activity entries or mark corrected-by relation where current audit primitives support it.

### 8.5 Quotation Draft Link

1. Sales opens opportunity and requests quotation draft.
2. API verifies CRM permission, accounting quotation permission, customer/counterparty link, stage/status, and idempotency key.
3. If opportunity already has an active quotation draft/link, API returns the existing link.
4. API creates a new draft only when no active draft exists, or when prior link is `VOIDED`/`REJECTED`, or when user explicitly creates a revision/new quote with reason.
5. API calls Accounting Documents item 08 application/API boundary to create a quotation draft.
6. CRM stores `CrmQuotationLink` with accounting document id, source opportunity id, creator, and snapshot summary.
7. Quotation editing, approval, issue, official number allocation, and conversion remain in accounting document workflow.
8. CRM displays quote status from accounting read API and deep-links to accounting quotation page.

### 8.6 Duplicate Merge

1. API surfaces duplicate candidates from normalized phone, email, tax id, external id, and fuzzy normalized name.
2. Admin previews merge, including channel identities, conversations, bookings, contacts, opportunities, activities, follow-ups, quotation links, lead `convertedCustomerId`, and accounting-counterparty conflicts. Segment repoint is future-only because no current segment-membership table exists.
3. Admin commits merge into primary customer. Secondary customer becomes `MERGED` or archived alias, not hard-deleted.
4. Issued accounting document snapshots remain unchanged.
5. Merge reversal is allowed only before configured close/lock policy and when current records still satisfy invariants.

### 8.7 LINE and AI Read Flow

1. User asks AI Sales/CRM for follow-up priorities, customer summary, opportunity status, or pipeline summary.
2. AI Gateway calls permission-checked CRM read APIs/tools.
3. API enforces company, branch/team, ownership, role permissions, and record policy.
4. Response includes concise answer, source refs, and web deep links.
5. If user lacks permission or module is not enabled, AI refuses clearly and avoids leaking record existence where needed.

## 9. Core Business Rules

- Tenant boundary is always `companyId`.
- Server-side permission and ABAC checks are mandatory. Web checks are UX only.
- Default Sales visibility is own/assigned leads, customers, opportunities, tasks, and activities.
- Manager customer visibility is explicit-assignment-only. Team scope may apply to other CRM records under their own policy but never widens Customer Directory access.
- Owner/Admin can see and manage all company CRM records.
- Sales receives the operational customer projection for own/assigned rows. Finance/Accountant receive only the accounting/contact projection; Marketing receives only the pseudonymous projection; Auditor receives the full authorized read projection for all company rows.
- Customer code must be unique per company when provided. System may auto-generate if document sequence/customer sequence exists.
- Primary phone/email/tax id normalization must be deterministic and stored separately from display fields.
- `CrmCustomer.id` is the sole canonical same-company customer identity. Display name, phone, LINE display name, and booking `customerName` are mutable/display values, never identity keys.
- `originSource` records acquisition channel and is distinct from `createdByType`/`createdByUserId`, which record how and by whom the write occurred. `AI` is never an origin source.
- Staff create may set only `MANUAL`, `WALK_IN`, `PHONE`, `WEB`, or `OTHER`. `LINE`, `FACEBOOK`, `MARKETPLACE`, `REFERRAL`, and `IMPORT` are assigned only by their verified/bounded server adapters.
- `createdByType` records `USER`, `SYSTEM`, or `AI_ASSISTED`; `AI_ASSISTED` still requires a real permission-checked API actor and explicit human confirmation.
- Exact `(channelId, providerUserId)` is deterministic identity reuse. Exact normalized phone is a candidate that requires human confirmation. Name similarity is warning-only and never auto-links or auto-merges.
- Create and identity-changing update both return duplicate candidates. Exact tax id or external id conflict with an active customer blocks; phone/name candidates never silently merge.
- LINE identity re-point and full merge both require `crm.customer.merge` and are Owner/Admin-only by default. `crm.customer.update` and inbox scope never authorize identity re-binding.
- Link and merge reject cross-company, inactive/archived/merged targets and must be transactionally audited. Merge never mutates issued accounting document snapshots.
- No CRM user flow hard-deletes customers, leads, opportunities, activities, tasks, quotation links, imports, or merge records.
- Customer archive is blocked when active opportunities or open follow-ups exist unless admin override with reason exists.
- Lead conversion is idempotent. Retrying same conversion key must not create duplicate customer/opportunity.
- Opportunity amount estimate must use decimal-safe money handling. Do not calculate money with JavaScript floating-point math.
- Pipeline stages are company-configurable, but each stage maps to canonical reporting group.
- `WON` and `LOST` are terminal groups. Reopen requires reason and dedicated permission.
- `LOST` requires reason.
- Follow-up task requires owner, due date, channel, and status.
- Activity log is append-only.
- Quotation draft creation requires both CRM permission and accounting quotation create permission.
- Opportunity has one active quotation draft/link by default. Multiple quotation links require prior link `VOIDED`/`REJECTED` or explicit revision/new quote reason.
- Quotation issue/approval/void follows Accounting Documents item 08 rules. Sales cannot self-approve quotation issue through CRM.
- CRM merge never mutates issued document snapshots.
- Contact consent must be tracked. If consent is revoked, AI/LINE must not suggest outbound outreach except compliance-safe internal follow-up.
- Export actions require dedicated permission, audit trail, and CSV injection protection.
- Customer CSV import preview must validate before commit and report duplicate/conflict rows. Lead CSV import is not required in first pass.
- LINE and AI are read-only in item 15. They do not create, update, assign, merge, convert, close, or quote on behalf of users.
- AI-assisted customer intake is parse/preview only: require `crm.ai.assist` and `crm.customer.create`, fill the normal customer form, show duplicate candidates, then require staff confirmation through the normal create API. AI has no direct persistence, link, merge, or raw-ID edit path.
- AI answers about CRM, customer, finance, tax, stock, or audit-like data require source refs.

## 10. Statuses and Enumerations

Customer statuses:

```text
ACTIVE
INACTIVE
ARCHIVED
MERGED
```

Customer types:

```text
PERSON
ORGANIZATION
UNKNOWN
```

Customer origin sources:

```text
MANUAL
WALK_IN
LINE
PHONE
WEB
FACEBOOK
MARKETPLACE
REFERRAL
IMPORT
OTHER
```

Customer `createdByType`:

```text
USER
SYSTEM
AI_ASSISTED
```

`originSource` answers where the customer came from. `createdByType` answers how the CRM write was initiated. `AI_ASSISTED` is provenance only and never appears in `originSource`.

Lead statuses:

```text
NEW
CONTACTED
QUALIFIED
CONVERTED
DISQUALIFIED
ARCHIVED
```

Lead sources:

```text
MANUAL
CSV_IMPORT
LINE
FACEBOOK
MARKETPLACE
WEB_FORM
REFERRAL
OTHER
```

Opportunity statuses:

```text
OPEN
WON
LOST
ARCHIVED
```

Canonical pipeline groups:

```text
NEW_LEAD
CONTACTED
QUALIFIED
QUOTATION
NEGOTIATION
WON
LOST
```

Default stage names:

```text
New lead
Contacted
Qualified
Quotation sent
Negotiation
Won
Lost
```

Activity types:

```text
CALL
CHAT
EMAIL
VISIT
MEETING
NOTE
QUOTE_DRAFT_CREATED
QUOTE_SENT
STAGE_CHANGED
TASK_CREATED
TASK_COMPLETED
CUSTOMER_UPDATED
OTHER
```

Activity outcomes:

```text
POSITIVE
NEUTRAL
NEGATIVE
NO_RESPONSE
NEEDS_FOLLOW_UP
COMPLETED
OTHER
```

Follow-up statuses:

```text
OPEN
DONE
SNOOZED
CANCELED
OVERDUE
```

Follow-up priorities:

```text
LOW
NORMAL
HIGH
URGENT
```

Contact channels:

```text
PHONE
LINE
EMAIL
FACEBOOK
MARKETPLACE_CHAT
VISIT
OTHER
```

Consent statuses:

```text
UNKNOWN
GRANTED
REVOKED
NOT_REQUIRED
```

Quotation link statuses mirror Accounting Documents where possible:

```text
DRAFT
PENDING_APPROVAL
APPROVED
REJECTED
ISSUED
VOIDED
CONVERTED
UNKNOWN
```

## 11. Data Model Draft

Use repo conventions and current Prisma naming when implementation starts. The shape below is the required business contract, not exact ORM syntax.

### CrmCustomer

```text
CrmCustomer
- id
- companyId
- branchId nullable
- accountingCounterpartyId nullable
- code nullable
- displayName
- displayNameNormalized
- legalName nullable
- customerType: PERSON, ORGANIZATION, UNKNOWN
- status: ACTIVE, INACTIVE, ARCHIVED, MERGED
- ownerUserId nullable
- ownerTeamId nullable
- primaryPhone nullable
- primaryPhoneNormalized nullable
- primaryEmail nullable
- primaryEmailNormalized nullable
- lineUserId nullable            // legacy compatibility/display cache only; never identity authority
- facebookId nullable
- taxId nullable
- taxIdNormalized nullable
- billingAddressJson nullable
- shippingAddressJson nullable
- defaultAddressJson nullable
- consentStatus
- consentUpdatedAt nullable
- consentNote nullable
- originSource: MANUAL, WALK_IN, LINE, PHONE, WEB, FACEBOOK, MARKETPLACE, REFERRAL, IMPORT, OTHER
- createdByType: USER, SYSTEM, AI_ASSISTED
- notes nullable
- lastActivityAt nullable
- lastContactedAt nullable
- nextFollowUpAt nullable
- duplicateKeyHash nullable
- mergedIntoCustomerId nullable
- archivedAt nullable
- archivedByUserId nullable
- archiveReason nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,code when code exists
- unique companyId,taxIdNormalized when active and tax id exists where supported
- index companyId,status
- index companyId,ownerUserId,status
- index companyId,primaryPhoneNormalized
- index companyId,primaryEmailNormalized
- index companyId,accountingCounterpartyId
```

### CrmContactPerson

```text
CrmContactPerson
- id
- companyId
- customerId
- name
- role nullable
- phone nullable
- phoneNormalized nullable
- email nullable
- emailNormalized nullable
- lineUserId nullable
- preferredChannel nullable
- consentStatus
- isPrimary
- note nullable
- status: ACTIVE, INACTIVE, ARCHIVED
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- index companyId,customerId,status
```

### CrmLead

```text
CrmLead
- id
- companyId
- branchId nullable
- source
- sourceRefType nullable
- sourceRefId nullable
- rawName nullable
- rawPhone nullable
- rawPhoneNormalized nullable
- rawEmail nullable
- rawEmailNormalized nullable
- rawPayloadJson nullable
- status
- assignedToUserId nullable
- assignedTeamId nullable
- convertedCustomerId nullable
- convertedOpportunityId nullable
- disqualifiedReason nullable
- disqualifiedAt nullable
- convertedAt nullable
- createdByUserId nullable
- updatedByUserId nullable
- createdAt
- updatedAt
- index companyId,status
- index companyId,assignedToUserId,status
- index companyId,source,sourceRefId
```

### CrmPipelineStage

```text
CrmPipelineStage
- id
- companyId
- name
- canonicalGroup
- sortOrder
- probabilityDefault nullable
- isTerminalWon
- isTerminalLost
- isActive
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,name when active
- index companyId,sortOrder
```

### CrmOpportunity

```text
CrmOpportunity
- id
- companyId
- branchId nullable
- customerId
- leadId nullable
- ownerUserId
- ownerTeamId nullable
- title
- stageId
- canonicalStageGroup
- status: OPEN, WON, LOST, ARCHIVED
- amountEstimate
- currency
- probability nullable
- expectedCloseDate nullable
- closedAt nullable
- closedByUserId nullable
- closeReason nullable
- lostReason nullable
- lastActivityAt nullable
- nextFollowUpAt nullable
- quotationSummaryJson nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- index companyId,status
- index companyId,customerId
- index companyId,ownerUserId,status
- index companyId,stageId,status
- index companyId,expectedCloseDate
```

### CrmActivity

```text
CrmActivity
- id
- companyId
- customerId nullable
- leadId nullable
- opportunityId nullable
- followUpTaskId nullable
- actorUserId
- type
- channel nullable
- outcome nullable
- note
- occurredAt
- metadataJson nullable
- correctedByActivityId nullable
- createdAt
- index companyId,customerId,occurredAt
- index companyId,opportunityId,occurredAt
- index companyId,actorUserId,occurredAt
```

### CrmFollowUpTask

```text
CrmFollowUpTask
- id
- companyId
- customerId nullable
- leadId nullable
- opportunityId nullable
- ownerUserId
- ownerTeamId nullable
- title
- dueAt
- timezone
- priority
- channel
- status
- completedAt nullable
- completedByUserId nullable
- snoozedUntil nullable
- canceledAt nullable
- canceledByUserId nullable
- cancelReason nullable
- nextActivityId nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- index companyId,status,dueAt
- index companyId,ownerUserId,status,dueAt
- index companyId,customerId,status
- index companyId,opportunityId,status
```

### CrmQuotationLink

```text
CrmQuotationLink
- id
- companyId
- customerId
- opportunityId
- accountingDocumentId
- accountingDocumentType
- accountingDocumentNumber nullable
- status
- grandTotalAmount nullable
- currency
- createdByUserId
- createdAt
- updatedAt
- unique companyId,opportunityId,accountingDocumentId
- index companyId,customerId
- index companyId,opportunityId
- index companyId,accountingDocumentId
```

### CrmCustomerSegment

```text
CrmCustomerSegment
- id
- companyId
- name
- description nullable
- ruleJson nullable
- status: ACTIVE, ARCHIVED
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,name when active
```

### CrmCustomerSegmentMember

```text
CrmCustomerSegmentMember
- id
- companyId
- customerId
- segmentId
- source: MANUAL, RULE, IMPORT
- createdByUserId nullable
- createdAt
- unique companyId,customerId,segmentId
```

### CrmDuplicateCandidate

```text
CrmDuplicateCandidate
- id
- companyId
- primaryCustomerId nullable
- candidateCustomerId nullable
- leadId nullable
- matchType
- confidence
- matchedFieldsJson
- status: OPEN, IGNORED, MERGED, RESOLVED
- resolvedByUserId nullable
- resolvedAt nullable
- resolutionNote nullable
- createdAt
- updatedAt
- index companyId,status
```

### CrmCustomerMerge

```text
CrmCustomerMerge
- id
- companyId
- primaryCustomerId
- mergedCustomerId
- reason
- mergeSnapshotJson
- reversedAt nullable
- reversedByUserId nullable
- reverseReason nullable
- createdByUserId
- createdAt
- index companyId,primaryCustomerId
- index companyId,mergedCustomerId
```

### CrmImportJob

```text
CrmImportJob
- id
- companyId
- importType: CUSTOMER, LEAD
- fileAttachmentId nullable
- status: PREVIEWED, COMMITTED, FAILED, CANCELED
- rowCount
- validRowCount
- invalidRowCount
- duplicateRowCount
- mappingJson
- resultJson nullable
- createdByUserId
- committedByUserId nullable
- committedAt nullable
- createdAt
- updatedAt
- index companyId,status
```

## 12. Shared Contracts

Shared contract package should expose DTOs/enums for:

- Customer list/detail/search.
- Customer create/update/archive/assign.
- Customer duplicate preview, LINE-identity re-point, and merge preview/commit.
- Contact person create/update/archive.
- Lead create/update/assign/convert/disqualify.
- Pipeline stage list/update.
- Opportunity list/detail/board/create/update/stage move/close/reopen.
- Activity append/list.
- Follow-up task create/update/complete/snooze/cancel/list.
- Duplicate preview/resolve/merge.
- Import preview/commit result.
- Quotation link create/status.
- Sales dashboard summary.
- AI read tools: follow-up priorities, customer summary, pipeline summary, opportunity summary.

DTOs must not expose raw storage keys, internal lock fields, full hidden finance details, Prisma row names, or unredacted import payloads to unauthorized callers.

## 13. Permission Contract

Permission keys:

```text
crm.customer.read
crm.customer.create
crm.customer.update
crm.customer.archive
crm.customer.assign
crm.customer.merge
crm.customer.import
crm.customer.export
crm.contact.read
crm.contact.manage
crm.lead.read
crm.lead.create
crm.lead.update
crm.lead.assign
crm.lead.convert
crm.lead.disqualify
crm.opportunity.read
crm.opportunity.create
crm.opportunity.update
crm.opportunity.stage_move
crm.opportunity.close
crm.opportunity.reopen
crm.activity.read
crm.activity.create
crm.follow_up.read
crm.follow_up.create
crm.follow_up.update
crm.follow_up.complete
crm.pipeline.configure
crm.segment.read
crm.segment.manage
crm.quotation.link
crm.report.read
crm.ai.read
```

Default grants:

```text
OWNER: all CRM permissions
ADMIN: all CRM permissions
MANAGER: crm.customer.read assigned-only, crm.customer.assign for already-assigned customers, crm.contact.read on assigned customers, crm.lead.read, crm.lead.create, crm.lead.update where team, crm.lead.assign where team, crm.lead.convert where team, crm.lead.disqualify where team, crm.opportunity.read, crm.opportunity.create, crm.opportunity.update where team, crm.opportunity.stage_move where team, crm.opportunity.close where team, crm.opportunity.reopen where team, crm.activity.read, crm.activity.create, crm.follow_up.read, crm.follow_up.create, crm.follow_up.update where team, crm.follow_up.complete where team, crm.segment.read, crm.quotation.link where accounting permissions allow, crm.report.read, crm.ai.read
SALES: crm.customer.read own/assigned, crm.customer.create, crm.customer.update own/assigned, crm.contact.read own/assigned, crm.contact.manage own/assigned, crm.lead.read own/assigned, crm.lead.create, crm.lead.update own/assigned, crm.lead.convert own/assigned, crm.lead.disqualify own/assigned, crm.opportunity.read own/assigned, crm.opportunity.create own/assigned, crm.opportunity.update own/assigned, crm.opportunity.stage_move own/assigned, crm.opportunity.close own/assigned, crm.activity.read own/assigned, crm.activity.create own/assigned, crm.follow_up.read own/assigned, crm.follow_up.create own/assigned, crm.follow_up.update own/assigned, crm.follow_up.complete own/assigned, crm.segment.read, crm.quotation.link own/assigned where accounting permissions allow, crm.ai.read own/assigned
FINANCE: crm.customer.read accounting/contact projection, crm.contact.read accounting-contact projection, crm.opportunity.read where accounting link allows, crm.activity.read limited, crm.follow_up.read limited, crm.quotation.link read/status only through accounting permissions, crm.report.read finance-safe
ACCOUNTANT: crm.customer.read accounting/contact projection, crm.contact.read accounting-contact projection, crm.opportunity.read, crm.activity.read limited, crm.quotation.link read/status only, crm.report.read
MARKETING: crm.customer.read pseudonymous projection, no crm.contact.read by default, crm.segment.read, crm.segment.manage where campaign policy allows, crm.report.read marketing-safe, crm.ai.read marketing-safe
AUDITOR_READONLY: crm.customer.read, crm.contact.read, crm.lead.read, crm.opportunity.read, crm.activity.read, crm.follow_up.read, crm.segment.read, crm.report.read, crm.customer.export
INVENTORY, STAFF: no CRM permissions by default
```

### 13.1 Customer Row and Field Projection

`crm.customer.read` is necessary but not sufficient for unrestricted fields. The API must select or redact to this exact projection before list/detail/search/duplicate/AI serialization:

| Caller | Row scope | Allowed projection |
|---|---|---|
| OWNER, ADMIN | All company customers | Operational projection: all permission-authorized customer list/detail fields, notes, consent evidence, contacts, and masked LINE identities. |
| SALES | Own/assigned customers only | Same operational projection for an allowed row; mutation actions remain separately permission-gated. |
| MANAGER | Explicitly assigned customers only | Same operational projection for an assigned row; team membership alone grants no customer row. |
| AUDITOR_READONLY | All company customers | Full authorized read projection, including notes, consent evidence, contacts, and masked LINE identities; no mutations. |
| FINANCE, ACCOUNTANT | All company customers when `crm.customer.read` is granted | Customer allowlist: `id`, `code`, `displayName`, `legalName`, `customerType`, `status`, `branchId`, `accountingCounterpartyId`, `primaryPhone`, `primaryEmail`, `taxId`, `createdAt`, `updatedAt`. Contact allowlist: `id`, `customerId`, `name`, `role`, `phone`, `email`, `preferredChannel`, `isPrimary`, `status`. Exclude customer/contact notes, consent evidence, owner, origin/actor provenance, tier/engagement/LTV/follow-up fields, social ids, and every LINE aggregate/identity field. |
| MARKETING | Company customers when `crm.customer.read` is granted | Purpose-scoped `customerRef` (not raw `CrmCustomer.id`), `status`, `consentStatus`, `originSource`, `tier`, and permitted segment ids only. Exclude names, codes, phone/email/tax/address, contact-person records, notes, owner/accounting links, social ids, and every LINE aggregate/identity field. |

Mixed roles are evaluated per row, never by combining the broad row scope from one role with the richer fields from another. For example, Sales+Finance receives the operational projection on explicitly assigned rows and the accounting/contact projection on other company rows. List items use a discriminated `{projection, customer}` contract so a client cannot type a limited record as the operational DTO. Marketing list records use the stored random `customerRef`; the canonical-id detail route is denied when Marketing is the only entitlement for that row.

Raw provider user ids, normalized matching keys, internal lock/storage fields, and Prisma rows are never exposed to any role, including Owner/Admin/Auditor. Duplicate candidates outside the caller's row scope must use the redacted candidate shape and must not confirm hidden record details.

Migration rollout: Prisma 7 executes the additive identity migration transactionally, so the tracked indexes cannot use `CREATE INDEX CONCURRENTLY`. Production deploys must reserve a short CRM write window; the migration uses a 5-second `lock_timeout` to fail fast instead of queueing behind live writes, while composite foreign keys use `NOT VALID` then `VALIDATE` and fail closed on historical tenant/coherence violations.

Sensitive permissions:

```text
crm.customer.assign
crm.customer.merge
crm.customer.import
crm.customer.export
crm.opportunity.reopen
crm.pipeline.configure
crm.segment.manage
crm.quotation.link
```

Quotation draft creation also requires Accounting Documents permission:

```text
accounting.quotation.create
```

Quotation issue, approval, void, and conversion use Accounting Documents permissions only.

## 14. API Behavior

Use exact route prefix from current API conventions. Routes below are contract-level names.

### Customer APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| List customers | `GET /crm/customers` | `crm.customer.read` | Supports search, owner, status, segment, nextFollowUp, pagination; applies role row scope and field projection before serialization. |
| Create customer | `POST /crm/customers` | `crm.customer.create` | Normalizes fields and returns duplicate candidates; staff-safe `originSource` only. |
| Read customer | `GET /crm/customers/:id` | `crm.customer.read` | Returns a discriminated operational or accounting/contact detail projection; a row outside caller scope is not disclosed, and Marketing-only access cannot resolve a canonical id. |
| Update customer | `PATCH /crm/customers/:id` | `crm.customer.update` | Re-runs duplicate checks when name/phone/identity fields change; optimistic version check where supported. |
| Archive customer | `POST /crm/customers/:id/archive` | `crm.customer.archive` | Requires reason and blocks active work unless override allowed. |
| Assign customer | `POST /crm/customers/:id/assign` | `crm.customer.assign` | Audited. |
| Re-point LINE identity | `POST /crm/customers/:id/line-identities/:identityId/link` | `crm.customer.merge` | Owner/Admin only; requires `expectedCurrentCustomerId` + reason, same-company target, no raw provider id. |
| AI profile preview | `POST /crm/customers/ai-profile-extract` | `crm.customer.create` + `crm.ai.assist` | Body `{text,locale?}`; returns bounded editable `displayName`/`primaryPhone`/`primaryEmail`/`notes` suggestion with `ok|uncertain|unavailable`; never persists. |
| Export customers | `POST /crm/customers/export` | `crm.customer.export` | Audited; CSV injection-safe. |

### Contact APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| List contacts | `GET /crm/customers/:customerId/contacts` | `crm.contact.read` | Scoped by customer access. |
| Create contact | `POST /crm/customers/:customerId/contacts` | `crm.contact.manage` | Normalizes contact fields. |
| Update contact | `PATCH /crm/contacts/:id` | `crm.contact.manage` | Consent changes audited. |
| Archive contact | `POST /crm/contacts/:id/archive` | `crm.contact.manage` | No hard delete. |

### Lead APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| List leads | `GET /crm/leads` | `crm.lead.read` | Supports status, source, assignee, search. |
| Create lead | `POST /crm/leads` | `crm.lead.create` | Manual first; source enum supports future integrations. |
| Update lead | `PATCH /crm/leads/:id` | `crm.lead.update` | Blocks updates after conversion unless admin repair route exists. |
| Assign lead | `POST /crm/leads/:id/assign` | `crm.lead.assign` | Audited. |
| Convert lead | `POST /crm/leads/:id/convert` | `crm.lead.convert` | Idempotent; creates/links customer and opportunity. |
| Disqualify lead | `POST /crm/leads/:id/disqualify` | `crm.lead.disqualify` | Requires reason. |

### Opportunity APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| List opportunities | `GET /crm/opportunities` | `crm.opportunity.read` | Table/list filters. |
| Pipeline board | `GET /crm/opportunities/board` | `crm.opportunity.read` | Grouped by active stages. |
| Create opportunity | `POST /crm/opportunities` | `crm.opportunity.create` | Requires customer and owner. |
| Read opportunity | `GET /crm/opportunities/:id` | `crm.opportunity.read` | Includes permitted quote status and timeline summary. |
| Update opportunity | `PATCH /crm/opportunities/:id` | `crm.opportunity.update` | Blocks terminal mutation except close/reopen flows. |
| Move stage | `POST /crm/opportunities/:id/stage` | `crm.opportunity.stage_move` | Adds activity entry. |
| Close won/lost | `POST /crm/opportunities/:id/close` | `crm.opportunity.close` | Lost requires reason; won should link quote or manual reason. |
| Reopen | `POST /crm/opportunities/:id/reopen` | `crm.opportunity.reopen` | Requires reason and audit. |

### Activity and Follow-Up APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| List activities | `GET /crm/activities` | `crm.activity.read` | Filters by customer, opportunity, actor, date. |
| Append activity | `POST /crm/activities` | `crm.activity.create` | Append-only. |
| List follow-ups | `GET /crm/follow-ups` | `crm.follow_up.read` | Supports due today, overdue, owner, customer. |
| Create follow-up | `POST /crm/follow-ups` | `crm.follow_up.create` | Requires dueAt, owner, channel. |
| Update follow-up | `PATCH /crm/follow-ups/:id` | `crm.follow_up.update` | Open/snooze/cancel fields only. |
| Complete follow-up | `POST /crm/follow-ups/:id/complete` | `crm.follow_up.complete` | Can append activity and next task. |
| Snooze follow-up | `POST /crm/follow-ups/:id/snooze` | `crm.follow_up.update` | Requires new due/snooze timestamp. |
| Cancel follow-up | `POST /crm/follow-ups/:id/cancel` | `crm.follow_up.update` | Requires reason. |

### Pipeline, Segment, Import, and Merge APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| List stages | `GET /crm/pipeline/stages` | `crm.opportunity.read` | Includes canonical group mapping. |
| Update stages | `PUT /crm/pipeline/stages` | `crm.pipeline.configure` | Validates terminal groups and sort order. |
| List segments | `GET /crm/segments` | `crm.segment.read` | Segment search. |
| Manage segment | `POST/PATCH /crm/segments` | `crm.segment.manage` | Manual MVP; ruleJson stored for later automation. |
| Import preview | `POST /crm/imports/preview` | `crm.customer.import` | Customer CSV first; validates mapping and duplicates. Lead CSV import is deferred/backlog. |
| Import commit | `POST /crm/imports/:id/commit` | `crm.customer.import` | Idempotent customer import commit. |
| Duplicate list | `GET /crm/duplicates` | `crm.customer.merge` | Open candidates. |
| Merge preview | `POST /crm/customers/merge/preview` | `crm.customer.merge` | Owner/Admin only by default; shows each channel-identity/conversation/booking/contact/opportunity/activity/follow-up/quotation/converted-lead reference impacted. |
| Merge commit | `POST /crm/customers/merge` | `crm.customer.merge` | Requires primary, secondary, and reason; audited soft merge in one transaction and retry-safe from stored merge state. |

### Quotation Link APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| Create quote draft | `POST /crm/opportunities/:id/quotation-drafts` | `crm.quotation.link` + `accounting.quotation.create` | Calls accounting boundary; idempotent. |
| List quote links | `GET /crm/opportunities/:id/quotations` | `crm.opportunity.read` + accounting read permission | Returns status summaries. |
| Refresh quote link | `POST /crm/quotation-links/:id/refresh` | `crm.opportunity.read` + accounting read permission | Pulls current accounting status if no event sync exists. |

### Read-Only AI/LINE APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| Follow-up priorities | `GET /crm/ai/follow-up-priorities` | `crm.ai.read` | Read-only; source refs required. |
| Customer summary | `GET /crm/ai/customers/:id/summary` | `crm.ai.read` | Redacts unauthorized fields. |
| Opportunity summary | `GET /crm/ai/opportunities/:id/summary` | `crm.ai.read` | Includes quote status where allowed. |
| Pipeline summary | `GET /crm/ai/pipeline-summary` | `crm.ai.read` | Scope by user/team permission. |

## 15. UI Behavior

### Web

Web route names should follow current web shell conventions. Expected first CRM workspace:

- CRM overview: pipeline value/count, follow-ups due, overdue tasks, active leads, stuck opportunities, top customers where data exists.
- Customers: `/companies/:companyId/customers` is the only customer directory/CRUD surface. It provides searchable rows, permission-gated create/edit/archive/assign, source and LINE-link status, duplicate candidate/reuse flow, and Owner/Admin merge preview/commit. Any legacy `/crm` customer tab links here.
- Customer form: first pass edits `displayName` (required), optional `primaryPhone`, `tier`, and `notes`; create also selects a staff-safe origin. Internal `customerId`, normalized values, verified LINE identity, `createdByType`, and `createdByUserId` are read-only/system-owned.
- Customer UI states: loading skeleton, empty state with permission-aware CTA, permission-denied state, load/save/link/merge error with retry, submitting/saving state that prevents duplicate submits, duplicate-candidate choice, and success refresh without stale rows.
- Customer detail: profile, contacts, segments, consent, open follow-ups, opportunities, quotation links, activity timeline, permitted accounting status.
- Leads: inbox/table, assignment, conversion, disqualification, duplicate warning.
- Pipeline: board view by stage plus table fallback; drag/drop only if accessible and stable, otherwise move-stage action.
- Opportunity detail: stage, owner, amount estimate, expected close, activities, follow-ups, quotation draft link, close/reopen actions.
- Follow-ups: agenda list for today/overdue/upcoming, complete/snooze/cancel actions, bulk view for managers.
- CRM settings: pipeline stages, segment definitions, import mapping where permission allows.
- Merge workflow: admin duplicate queue, preview impacted records, commit with reason, audit result.

Do not build a marketing landing page. CRM route should open usable workspace directly.

### LINE

LINE supports:

- "Who should I follow up today?"
- "Summarize customer X."
- "What deals are overdue/stuck?"
- "Show my pipeline today."
- Follow-up due/overdue alerts with web deep links.

LINE does not support:

- Creating/editing customers, leads, opportunities, tasks, segments, or activities.
- Assigning records.
- Merging customers.
- Creating quotation drafts.
- Approving, issuing, voiding, or converting quotations.
- Exporting customer data.

### AI Gateway

AI Sales/CRM can:

- Rank follow-ups by due date, priority, stale activity, opportunity amount, and stage risk.
- Summarize customer history from CRM activities and permitted accounting status.
- Suggest next best action as draft advice only.
- Explain stuck pipeline and overdue tasks with source refs.
- Identify inactive high-value customers where revenue data is permission-available.

AI Sales/CRM cannot:

- Mutate CRM or accounting records.
- Contact customers externally.
- Reassign ownership.
- Override discount, quotation, approval, consent, or permission policy.
- Reveal finance-only detail without accounting permission.

## 16. Audit and Outbox

Audit these actions when audit primitive exists:

- Customer create/update/archive/assign/import/export.
- Contact consent update.
- Lead assign/convert/disqualify.
- Opportunity stage move/close/reopen.
- Follow-up create/update/complete/snooze/cancel.
- Customer merge preview/commit/reverse.
- Customer identity re-point, including actor, prior/target customer ids, channel/identity id, affected conversation count, and reason.
- Pipeline stage configuration.
- Segment create/update/archive.
- Quotation draft link creation.
- AI/LINE access to sensitive customer summary where existing audit policy requires read audit.

Outbox events where outbox exists:

```text
crm.customer.created
crm.customer.updated
crm.customer.assigned
crm.customer.archived
crm.customer.merged
crm.lead.created
crm.lead.assigned
crm.lead.converted
crm.lead.disqualified
crm.opportunity.created
crm.opportunity.stage_changed
crm.opportunity.won
crm.opportunity.lost
crm.opportunity.reopened
crm.opportunity.quotation_linked
crm.activity.created
crm.follow_up.created
crm.follow_up.updated
crm.follow_up.completed
crm.follow_up.overdue
crm.pipeline.stage_configured
crm.segment.updated
crm.import.committed
```

Payloads must be bounded and must not include raw import files, private notes beyond need, or unauthorized finance fields.

## 17. Dashboard and Notification Hooks

CRM should expose source providers/events for:

- Follow-ups due today.
- Overdue follow-ups.
- Stuck opportunities with no activity after configurable days.
- Pipeline value/count by canonical stage.
- New leads by source.
- Conversion count/rate by stage.
- Activity count by sales user/team.

Default notification rule hooks:

- `follow_up_due`: due today or overdue; recipients are task owner and manager where ABAC allows.
- `opportunity_stuck`: no activity for configured days and opportunity still open; recipients are owner and manager.
- `lead_unassigned`: new lead unassigned for configured hours; recipients are manager/admin.

If dashboard/notification module is not implemented when item 15 starts, add CRM read providers/adapters and leave delivery disabled behind existing future-hook pattern.

## 18. Edge Cases

- User searches a customer they cannot access: return permission-safe empty/not found behavior according to current API convention.
- Duplicate exact tax id with active customer: warn or block according to policy; never silently merge.
- Existing exact verified LINE identity: return/reuse its current same-company customer; never create a second customer.
- Exact normalized phone match: return candidate(s) and require explicit human reuse/link-or-continue choice.
- Name-only match: may warn, but never auto-link or auto-merge.
- LINE identity re-point targets another company or inactive/archived/merged customer: reject before mutation.
- Merge is retried for the same primary/secondary after the secondary is already `MERGED`: return the prior merge result without re-pointing twice.
- Merge includes issued accounting history: preserve document snapshots and stable accounting references; block on unresolved counterparty conflict rather than guessing.
- Lead conversion retried after timeout: same idempotency key returns existing converted customer/opportunity.
- Lead conversion finds duplicate customer: user must choose link existing or create new with duplicate warning.
- Opportunity moved directly to `LOST`: require lost reason.
- Opportunity `WON` without quotation: require manual win reason.
- Stage config has no `WON` or `LOST`: reject.
- Stage config tries to delete stage with open opportunities: block or require migration target.
- Follow-up due timezone crosses midnight: use company/user timezone and store timestamps consistently.
- Complete follow-up on archived customer: block unless admin repair path exists.
- Merge customers across companies: reject.
- Merge secondary customer linked to issued accounting documents: allow CRM alias merge but never mutate issued document snapshots.
- Quotation draft created in accounting but CRM link write fails: retry with idempotency key or recovery job/link repair.
- Existing active quotation link present: return existing link. New quote requires prior link `VOIDED`/`REJECTED` or explicit revision/new quote reason.
- Contact consent revoked: suppress AI outreach suggestions and mark contact unavailable for outbound prompts.
- CSV import contains formula-like values: escape on export and sanitize preview.
- AI asks for finance-only fields without permission: refuse with safe explanation and no leaked values.

## 19. Acceptance Criteria

- [ ] Sales user can create and manage assigned customers, contacts, leads, opportunities, follow-ups, and activities in web.
- [ ] `/companies/:companyId/customers` is the sole production customer directory; legacy CRM navigation links there instead of exposing a second CRUD implementation.
- [ ] Create/edit form provides name, optional phone, tier, notes, create-only staff-safe origin, and permission-correct actions with loading/empty/error/saving/retry states.
- [ ] Exact verified LINE identity deterministically reuses one same-company `CrmCustomer.id`; raw LINE/user ids are read-only and cannot be entered or reassigned directly by clients.
- [ ] Create and identity-changing update show normalized-phone duplicate candidates for human confirmation; name-only matches never auto-link or auto-merge.
- [ ] LINE identity re-point and full merge both require Owner/Admin `crm.customer.merge`; `crm.customer.update` or inbox access alone cannot re-bind identity.
- [ ] Full merge atomically re-points channel identities, conversations, bookings, contacts, opportunities, activities, follow-ups, quotation links, and lead `convertedCustomerId`, then marks the secondary `MERGED` without hard delete.
- [ ] `originSource` remains separate from `createdByType`/`createdByUserId`; AI parse/preview never persists until a permitted staff user confirms the normal API mutation.
- [ ] `POST /crm/customers/ai-profile-extract` requires both permissions, returns only bounded editable suggestions with uncertainty/provider-down states, performs no mutation, and exposes no tools from the AI Gateway agent.
- [ ] Sales user sees own/assigned CRM records only unless granted broader permission.
- [ ] Customer list/detail/search applies the exact role projection: operational Owner/Admin/Sales, assigned-only Manager, full-read Auditor, accounting/contact-limited Finance/Accountant without notes/LINE identity, and pseudonymous Marketing without PII/contact/identity.
- [ ] Manager can see team pipeline, overdue follow-ups, stuck opportunities, and lead assignment queue.
- [ ] Admin can configure pipeline stages, import customers, review duplicates, and merge customers with audit trail.
- [ ] Lead conversion creates or links customer and opportunity idempotently.
- [ ] Opportunity pipeline supports default stages, stage movement, won/lost close, lost reason, and reopen audit.
- [ ] Follow-up due/overdue data feeds dashboard/notification provider or disabled future hook.
- [ ] Customer activity timeline is append-only and auditable.
- [ ] Quotation draft link creates Accounting Documents item 08 quotation draft without issuing it.
- [ ] Quotation official number, approval, issue, void, and conversion remain owned by Accounting Documents.
- [ ] CRM customer updates/merge do not mutate issued accounting document snapshots.
- [ ] LINE and AI answer follow-up priority, customer summary, and pipeline questions with source refs and web deep links.
- [ ] LINE and AI cannot mutate CRM/accounting records.
- [ ] Finance-only/accounting details are redacted unless accounting permissions allow them.
- [ ] Permission, tenant, ownership/team ABAC, audit, outbox, import/export, and idempotency tests pass where current test setup supports them.

## 20. Test Cases

- Unit: phone/email/tax id normalization is deterministic.
- Unit: origin source validation rejects `LINE`/`AI` from staff create and keeps `createdByType`/`createdByUserId` separate.
- Unit: exact channel identity reuses existing customer; normalized phone returns a candidate; name-only match never auto-merges.
- Unit: duplicate scoring ranks exact tax id/external id higher than fuzzy name.
- Unit: pipeline stage config rejects missing terminal won/lost groups.
- Unit: opportunity close lost without reason fails.
- Unit: follow-up completion can append activity and next task in one domain operation.
- Unit: AI priority ranking orders overdue/high-priority/high-value/stale opportunities predictably.
- Integration: create customer with duplicate warning.
- Integration: update phone re-runs duplicate detection and requires explicit candidate handling.
- Integration: LINE identity re-point requires `crm.customer.merge`, rejects update-only/Sales callers and cross-company targets, and audits the partial merge.
- Integration: Owner/Admin merge re-points all actual customer-reference relations transactionally, preserves issued accounting snapshots, marks secondary `MERGED`, and is idempotent.
- Integration: lead convert idempotency prevents duplicate customer/opportunity.
- Integration: customer archive blocks active opportunity/open follow-up.
- Integration: customer merge preserves issued accounting document snapshot references.
- Integration: quotation draft link calls accounting boundary and stores CRM link.
- Integration: quote link retry returns existing linked draft on same idempotency key.
- Integration: stage move appends activity and emits outbox.
- API permission: Sales cannot read unassigned customer/opportunity.
- API permission: Manager cannot read an unassigned customer even when team ABAC grants access to that customer's leads/opportunities.
- API projection: Finance/Accountant responses contain only the accounting/contact allowlists and omit notes, consent evidence, operational scoring, social ids, and every LINE aggregate/identity field.
- API projection: Marketing responses contain only purpose-scoped customer reference, status, consent, origin, tier, and permitted segment ids; no canonical customer id, PII, contact record, notes, accounting link, social id, or LINE identity is present.
- API projection: Auditor can read all company customer fields allowed by public DTOs but cannot mutate and never receives raw provider ids/system storage fields.
- API permission: Manager can read team pipeline but cannot merge customer without permission.
- API permission: Finance reads customer/accounting status only where accounting permissions allow.
- API permission: AI read endpoint returns same scope as web user.
- API security: LINE/AI mutation attempts return web-link guidance/refusal.
- Import: invalid rows show preview errors and commit only valid mapped rows according to policy.
- Export: CSV formula-like values are escaped.
- UI: CRM navigation opens workspace, not landing page.
- UI: pipeline board/table can move opportunity and handles permission-disabled actions.
- UI: customer detail shows timeline, follow-ups, opportunities, and quote links without overlapping text on mobile/desktop.
- UI: duplicate merge preview requires reason and shows impacted records.
- UI: `/customers` create/edit/link/merge actions render permission, loading, empty, validation, duplicate, saving, failure/retry, and success-refresh states.
- AI: intake requires `crm.ai.assist` + `crm.customer.create`, returns a preview only, and exposes no save/link/merge tool.
- AI: profile-extract agent has an empty tool allowlist, validates bounded structured output, and returns `uncertain`/`unavailable` without blanking the customer form.
- AI: follow-up priority answer includes source refs and refuses restricted customer.
- Notification: follow-up due event contains task owner, dueAt, deep link, and no raw private notes.

## 21. Implementation Notes

- Prefer API module path `apps/api/src/modules/crm`.
- Prefer web feature path `apps/web/src/features/crm`.
- Prefer shared contracts in `packages/contracts/src/crm` or current package convention.
- Suggested API module folders:

```text
apps/api/src/modules/crm/
- crm.module.ts
- domain/models
- domain/logic
- application/ports
- application/use-cases
- infrastructure/persistence
- infrastructure/accounting
- infrastructure/notifications
- presentation/http
```

- Controllers stay thin and call use cases only.
- Prisma usage stays inside infrastructure repositories/queries/mappers.
- Do not use Prisma generated types as domain models.
- Reuse existing request context, tenant/company resolver, permission decorators, audit/outbox, document sequence, notification, and API client helpers.
- Add CRM seed/default stage creation per company. If company lifecycle hook exists, create stages on company creation; otherwise lazy-create on first CRM settings read with audit-safe system actor.
- Use transaction boundaries for lead conversion, follow-up completion with activity, customer merge, import commit, and quotation link creation.
- Use idempotency keys for lead conversion, import commit, follow-up completion with next task, and quotation draft link.
- Use current test commands discovered in Phase 0. Record any skipped tests with concrete reasons.

## 22. Resolved Defaults

- Default currency for opportunity estimate: `THB`.
- Default customer owner: creating user unless assignment is provided.
- Canonical customer management surface: `/companies/:companyId/customers`; do not maintain a second customer CRUD under `/crm`.
- Canonical identity: `CrmCustomer.id` within `companyId`; `CrmChannelIdentity(channelId,providerUserId)` is the verified LINE mapping and is never manually typed.
- Default customer origin: `MANUAL` for staff form create. Staff may choose `WALK_IN`, `PHONE`, `WEB`, or `OTHER`; only trusted adapters assign `LINE`, `FACEBOOK`, `MARKETPLACE`, `REFERRAL`, `IMPORT`, or future provider origins.
- Default `createdByType`: `USER`, `SYSTEM`, or `AI_ASSISTED`; AI-assisted writes still execute as an identified user/system actor through the same permission-checked API after human confirmation.
- Unassigned lead queue is allowed.
- Customer CSV import preview/commit is in MVP. Lead CSV import and automated marketplace/LINE/Facebook ingestion are deferred.
- Duplicate exact tax id/external id is high confidence; exact phone/email is medium/high; fuzzy name is warning only.
- Default close policy: `LOST` requires reason; `WON` should link quotation or manual reason.
- Default quote behavior: CRM creates or reuses one active accounting quotation draft per opportunity. Issue/approval happens in accounting. New quote requires prior link `VOIDED`/`REJECTED` or explicit revision/new quote reason.
- Default import behavior: customer CSV import first. Lead CSV import is optional/backlog; manual lead creation is enough for MVP.
- Default LINE/AI behavior: read-only answers with source refs and web deep links.
- Default merge behavior: soft merge with alias/merged status; no hard delete.
- Default match behavior: exact verified LINE identity reuses automatically; exact normalized phone is a human-confirmed candidate; name-only similarity is warning-only.

## 23. Backlog After MVP

- Full omnichannel inbox and message sync.
- Marketplace order/customer import automation.
- LINE/Facebook lead capture automation.
- Advanced territory assignment and routing.
- Quote template builder beyond Accounting Documents existing templates.
- Sales forecast quotas, commission, and incentive reports.
- Visit scheduling, maps, route planning, and field sales check-in.
- Campaign execution and attribution.
- Customer portal.
- Public CRM API/webhooks for external systems.
- AI-generated outbound messages with approval workflow.

## 24. Owner Update 2026-07-12 — Production Customer Management and Identity Linking

This update is the canonical clarification for customer management and supersedes older wording where it implies multiple customer CRUD pages, manually editable LINE ids, AI as an acquisition source, or name-based automatic identity matching.

- `/companies/:companyId/customers` is the sole production Customer Directory and mutation surface. Customer 360 remains the detail/history surface.
- `CrmCustomer.id` scoped by `companyId` is canonical. `CrmChannelIdentity` is the verified channel mapping; `CrmCustomer.lineUserId` is legacy compatibility only and must not drive matching or be editable in the production form.
- Acquisition origin and mutation actor are separate. AI may parse text into a preview but never directly creates, edits, links, or merges; deterministic LINE webhook/LIFF ingestion is a system adapter, not an AI mutation.
- Exact preview contract: `POST /companies/:companyId/crm/customers/ai-profile-extract` requires `crm.customer.create` + `crm.ai.assist`; `{text,locale?}` returns bounded editable name/phone/email/notes suggestion with `ok|uncertain|unavailable`. The dedicated gateway profile-extract agent has zero tools and cannot persist.
- Exact LINE identity reuses deterministically. Normalized phone produces a human-confirmed candidate. Name-only matching never auto-links or auto-merges.
- LINE identity re-point is a high-risk partial merge and requires Owner/Admin `crm.customer.merge`, the same permission family as full merge. Customer update/inbox permissions never authorize re-binding.
- Implementation verification 2026-07-12: the customer-management slice is accepted locally. Create/edit/archive/assign, duplicate confirmation, typed `originSource`/`createdByType`, masked identity re-point, full soft merge, same-company lineage constraints, race-safe LINE ingestion, no-tools AI preview, role projections, PDPA/egress fencing, and durable reply/notification/reminder delivery passed focused and full package tests, typechecks/builds, all 53 migrations from an empty PostgreSQL database, and authenticated browser smoke. Exact evidence is recorded in [[agent-memory/customer-management-identity-linking]]. Broad checklist item 15 remains unchecked only for its wider CRM import/export and end-to-end workflow gates.
