# MangmeePlus v1 — RoPA and Data-Flow Register

Status: **DRAFT — technical review, production evidence, lawful-basis decision and Thai counsel approval required**<br>
Assessment date: 2026-08-10<br>
Scope owner: Privacy / Legal<br>
Technical evidence owner: Platform Security / Product<br>
Entity: บริษัท มั่งมียั่งยืน จำกัด, registration 0105569135722

This register covers the declared first production scope only: employee access, expense/receipt and reimbursement processing, LINE receipt-image intake and read-only questions about company bills/receipt counts/reimbursement totals, OCR/AI assistance, and security/legal-request operations. Customer CRM and marketing are out of scope until separately enabled and reviewed.

This is a working RoPA, not proof that the live environment or legal basis has been approved. Export the final data into GPPC Plus, attach its report, and preserve both versions and hashes.

## Status vocabulary

- **[VERIFIED CODE]**: re-checkable technical behavior in the named source; not proof of live state or legal sufficiency.
- **[OBTAIN]**: obtain a live export, contract, account setting, or operational record.
- **[DECIDE]**: controller/privacy/counsel decision required.
- **[TEST]**: demonstrate behavior in UAT/production-safe evidence without copying raw personal data into git.

## Role rule

- MangmeePlus is normally **controller** for platform account, authentication, service security, support, billing relationship, legal acceptance, and its own compliance evidence.
- A customer company is normally **controller** for employee, receipt, reimbursement, accounting and other workspace content that it determines to place in the service; MangmeePlus is normally its **processor** for hosting, OCR/AI and support on that content.
- The same record can contain both roles. For example, a receipt is tenant-controlled content while MangmeePlus-generated security events are processed for MangmeePlus's own security purpose.
- Counsel must approve the role allocation per purpose. A label in code or a contract heading is not the final legal decision.

## R-01 — Platform accounts, employee access and tenant membership

| Field | Working record |
|---|---|
| Data subjects | Account users, customer-company owners/admins, employees/members, invited users, system operators |
| Data/categories | Name, email, phone where supplied, date of birth/address where configured, identity type and last-four/reference/protected identity fields, user/membership/company/branch IDs, role/permission, account status, password hash, session/device/IP/security events, LINE-account link where used |
| Sources | Data subject; customer owner/admin; authentication and security systems; LINE link flow |
| Purposes | Create/authenticate accounts; grant/revoke least-privilege access; support; prevent fraud/unauthorized access; maintain tenant isolation; evidence legal acceptance |
| Preliminary legal role/basis | MangmeePlus controller for account/auth/security/support: contract/pre-contract, legitimate interests balanced against rights, and legal obligation where applicable **[DECIDE]**. Customer controller and MangmeePlus processor for customer-determined employee profile/access content **[DECIDE]**. Do not use consent as a default employment/access basis. |
| Operations | Collect, verify, encrypt/hash, store, retrieve, update, link to tenant/LINE identity, log access, suspend/revoke, export or delete/restrict on valid instruction/request |
| Recipients/processors | AWS core infrastructure; Cloudflare where request traffic passes it; LINE for linked identity/channel; support/legal advisers when necessary; GitHub only for engineering metadata and never production secrets/content by design **[OBTAIN LIVE]** |
| Countries/transfers | AWS primary deployment targets ap-southeast-1 but support/global services and LINE/Cloudflare/GitHub countries require evidence; do not infer all countries from region configuration **[OBTAIN]/[DECIDE]** |
| Retention/deletion | Session/token periods follow technical config; employee/customer content follows controller instruction and approved retention schedule; security/legal evidence follows its own schedule. Exact production values and deletion propagation **[OBTAIN]/[TEST]** |
| Security | Tenant/company scope, RBAC/ABAC, password hashing, session controls, encryption in transit/at rest, audit events, secret isolation **[VERIFY LIVE]** |
| Rights/intake | `contact@mangmeeplus.com`; customer-routed request for tenant-controlled employee content; MangmeePlus handles own account/security data. Case/SLA evidence **[OBTAIN]** |
| Technical evidence | `apps/api/prisma/schema.prisma` employee-access/auth/membership models; `packages/contracts/src/employee-access.ts`; auth and legal-acceptance modules **[VERIFIED CODE]** |

## R-02 — Expense, receipt, reimbursement and accounting evidence

| Field | Working record |
|---|---|
| Data subjects | Employees/claimants/approvers/payers; natural-person vendors and sole proprietors; customer/supplier contact people; signers or people appearing in documents/images |
| Data/categories | Receipt/image/PDF and attachments; vendor name/entity/tax ID/branch/document number; dates, items, amounts, VAT/WHT; payment method and bank-account reference; claimant/approver/payment identities; notes/reasons/status; signature/evidence; source-channel identifiers; audit history |
| Sources | Employee/authorized user via web or LINE; customer master data; receipt/document itself; OCR/AI result; approver/reviewer actions |
| Purposes | Capture and review evidence; reimburse employees; prevent duplicate/fraud; support accounting/tax records and audit; generate permitted reports/evidence |
| Preliminary legal role/basis | Customer controller and MangmeePlus processor for workspace records; customer decides contract/legal-obligation/legitimate-interest bases and employee notice **[DECIDE]**. MangmeePlus controller only for its own security/compliance purpose. |
| Operations | Upload/store; malware/content checks where configured; OCR/extract; review/correct; calculate; approve/reject; link payment/reimbursement; export; retain/restrict/delete under policy |
| Recipients/processors | AWS S3/RDS/runtime/logs; Typhoon OCR; AWS Bedrock/AgentCore if used for document verification or answers; LINE for intake; authorized customer users; auditors/advisers/public authorities when lawfully required |
| Countries/transfers | Exact AWS/Typhoon/LINE/AI routing, storage, backup and support countries **[OBTAIN]/[DECIDE]** |
| Retention/deletion | Accounting/tax evidence period selected by customer policy and law; source/transient media and AI records follow separate approved periods; legal holds and exact physical object/version deletion required **[DECIDE]/[TEST]** |
| Security | Presigned bounded uploads; attachment metadata/checksum/version; tenant permissions; reviewer/approval separation; audit events; encryption and backup **[VERIFY LIVE]** |
| Rights/intake | Customer receives requests for employee/vendor content; MangmeePlus assists search/export/correction/restriction/deletion under documented instruction. Preserve records that law requires and explain exceptions. |
| Technical evidence | `apps/api/prisma/schema.prisma` `ExpenseRecord`, attachment, reimbursement and receipt-extraction models; `packages/contracts/src/expenses.ts`; expense upload/OCR/reimbursement modules **[VERIFIED CODE]** |

## R-03 — LINE identity, messages and receipt-image intake

| Field | Working record |
|---|---|
| Data subjects | Employee LINE users, customer-company admins, people whose data appears in messages, images or receipts |
| Data/categories | LINE user/chat/message/event identifiers; display/profile data where retrieved; company link/context; message text; images/PDF/media metadata; timestamps/delivery/retry status; pending-media and clarification context; response text |
| Sources | LINE Messaging API/webhook/media endpoints; customer linkage process; employee messages and attachments |
| Purposes | Authenticate/link employee to permitted company context; receive receipt evidence; clarify incomplete submissions; answer permission-scoped read-only questions; send operational response/notification; security and replay prevention |
| Preliminary legal role/basis | Customer controller and MangmeePlus processor for employee/workspace content; MangmeePlus controller for webhook security/replay/abuse evidence **[DECIDE]**. Customer must notify employees and restrict business purpose. |
| Operations | Receive/verify webhook; hash/store identifiers and event status; download media; stage pending context; route to receipt/OCR or read-only query; reply; retry/deduplicate; purge under approved schedule |
| Recipients/processors | LINE; AWS core/runtime/storage/logs; Typhoon OCR; AWS Bedrock/AgentCore; authorized company users |
| Countries/transfers | LINE CDN/message/profile/media/log/support countries and onward recipients; AI/vendor routes **[OBTAIN]/[DECIDE]** |
| Retention/deletion | Business-policy `chatMediaDays` default exists but enforcement and applicability to every LINE copy/provider are not proven; pending-media, webhook logs, final receipt objects and vendor copies must be separate rows in the retention register **[OBTAIN]/[TEST]** |
| Security | Webhook signature verification; event deduplication/replay controls; tenant link and permission checks; bounded media handling; secret isolation; audit **[VERIFY LIVE]** |
| Rights/intake | Customer normally decides requests relating to employee/workspace messages; disconnecting LINE or leaving a company does not by itself erase accounting evidence. MangmeePlus handles platform/security records it controls. |
| Technical evidence | `LineChannelBinding`, `LineWebhookEventLog`, `LineCompanyContext`, `LineIntakePendingMedia`; LINE webhook and `line-ai` modules **[VERIFIED CODE]** |

## R-04 — OCR, AI assistance and permission-scoped business answers

| Field | Working record |
|---|---|
| Data subjects | Employees/users; natural persons appearing in receipts/files; vendors/claimants/approvers referenced in permitted company data |
| Data/categories | Prompt/instruction; receipt image/PDF; extracted text/fields; bounded conversation context; permission-scoped tool results; company/user/request IDs; model/provider/profile/region lineage; output; confidence/review status; usage/error metadata |
| Sources | R-02/R-03 records; authorized user question; ERP permission-checked APIs/tools; configured model providers |
| Purposes | Extract receipt fields; classify/verify document; ask clarification; produce read-only answer about bills, receipt counts and reimbursement totals; operational safety/budget/audit |
| Preliminary legal role/basis | Follows the underlying customer instruction/purpose for tenant content; separate legitimate-interest/legal analysis for MangmeePlus security/usage logs **[DECIDE]**. AI gateway must not use direct repositories to bypass tenant permissions. |
| Operations | Minimize/select context; transmit to provider; infer/extract; validate/ground output; human review before final accounting/payment/tax action; store lineage/turn records; purge under approved schedule |
| Recipients/processors | Typhoon OCR; AWS Bedrock/underlying model provider and AgentCore; OpenAI only if live-enabled; AWS core logs/storage; authorized company user |
| Countries/transfers | Bedrock global inference profile may route beyond the configured AWS region; exact countries, model-provider role/support and Typhoon/OpenAI countries require binding evidence **[OBTAIN]/[DECIDE]** |
| Retention/deletion | MangmeePlus `AI_DATA_RETENTION_DAYS` default is 90 and a purge path is documented, but provider training/abuse logs/backups/deletion and live config require evidence. Do not claim zero retention solely from local config. |
| Security | Provider allowlist/approval references; least-privilege tools; tenant/actor delegation; prompt and output limits; grounding; human review; audit lineage; encryption **[VERIFY LIVE]** |
| Rights/intake | Route content requests to customer controller; MangmeePlus must assist and handle its own model/usage records. Explain provider propagation/limits. |
| Technical evidence | `AiTurn`; config `AI_DATA_RETENTION_DAYS`; AI gateway, Bedrock, AgentCore, Typhoon receipt-OCR and permission-tool modules **[VERIFIED CODE]** |

## R-05 — Security, audit, availability and support

| Field | Working record |
|---|---|
| Data subjects | Users/admins/support contacts; employees involved in events; potentially other people included in request/error metadata |
| Data/categories | User/company/role/permission IDs; IP/device/user agent; route/action/target; timestamps/request IDs; authentication, authorization, changes, errors, performance and incident events; support email/messages/attachments; limited message previews only where deliberately allowed |
| Sources | Application/API/gateway/workers; Cloudflare/AWS; user/support contact; security controls |
| Purposes | Authenticate/authorize; prevent/detect/investigate abuse; maintain availability; troubleshoot; evidence changes/approvals; respond to incidents, rights and legal claims |
| Preliminary legal role/basis | MangmeePlus controller: legitimate interests with balancing/minimization and legal obligation where applicable **[DECIDE]** |
| Operations | Generate, pseudonymize/hash where designed, store, search, alert, investigate, restrict/export/delete, preserve legal hold when justified |
| Recipients/processors | AWS CloudWatch/RDS/S3/SNS and support surfaces; Cloudflare; GitHub Actions for deployment metadata; authorized security/support staff and advisers |
| Countries/transfers | Exact telemetry/support/onward countries **[OBTAIN]/[DECIDE]** |
| Retention/deletion | Production CloudWatch policy is 14 days; this is not automatically the period for traffic data, database audit records, support records, security cases, S3 session logs, backups or vendor telemetry. Complete the retention register and prove live state. |
| Security | Least privilege, encryption, private networking, log redaction/minimization, alerting, immutable/high-value evidence, access reviews **[VERIFY LIVE]** |
| Rights/intake | Explain security/legal-claim exceptions; provide access/copy where required without disclosing others' data, secrets or controls that would create risk. |
| Technical evidence | `infra/prod-ecs-express/deploy.sh` pins production CloudWatch retention at 14 days; cloud operations runbook; audit/logging/security modules **[VERIFIED CODE]** |

## R-06 — Legal acceptance, privacy requests and compliance evidence

| Field | Working record |
|---|---|
| Data subjects | Users accepting documents; requesters/authorized representatives; company directors/signers; reviewers, DPO/privacy contacts and counsel |
| Data/categories | Legal document type/version/URL/SHA-256; statement and locale; acceptance/acknowledgement timestamp; user/company/membership/capacity/role/session/request evidence; DSAR scope, identity/authority evidence, decisions, correspondence and completion proof; reviewer/signature/evidence IDs |
| Sources | Authenticated user; requester; company/customer; DBD; privacy/legal reviewer; system-generated artifact/hash evidence |
| Purposes | Form/evidence contract and notice delivery; prove authority and compliance; receive/resolve rights requests; defend or exercise legal claims; support audit/release gate |
| Preliminary legal role/basis | MangmeePlus controller: contract/pre-contract, legal obligation and legitimate interests in reliable evidence **[DECIDE]**. Privacy acknowledgement is not consent. |
| Operations | Display immutable documents; record append-only acceptance evidence; receive/verify/case-manage request; search/export/correct/restrict/delete; record outcome; hash/version/store approval bundle |
| Recipients/processors | Authorized internal operators; customer controller where request concerns tenant content; Thai counsel/auditor; regulators/courts when lawfully required; private evidence storage/AWS |
| Countries/transfers | Evidence storage/support location and counsel/vendor access **[OBTAIN]/[DECIDE]** |
| Retention/deletion | Exact period for contract/acceptance, DSAR and counsel evidence requires approved legal-claims/obligation schedule; minimize identity documents and restrict access. Do not erase proof needed to demonstrate a valid deletion decision without analysis. |
| Security | Immutable version/hash, restricted evidence storage, MFA, dual review, audit, redaction, least privilege; no raw signed evidence in public git |
| Rights/intake | Monitored `contact@mangmeeplus.com`, case ID, identity/authority verification, 30-day access/copy and 90-day valid-erasure controls as applicable, complaint route |
| Technical evidence | Legal-acceptance contracts/service/UI; legal release artifacts; evidence manifest and release-bundle runbook **[VERIFIED CODE]** |

## Production evidence and approvals required before FINAL

1. Signed live data-flow/account/provider export showing which features and providers are enabled.
2. Customer-controller role and lawful-basis memorandum plus employee notice and customer DPA.
3. Final data fields per activity, including unstructured text/images and individuals not represented by a person table.
4. Executed/applicable vendor terms, DPA, countries, subprocessors, retention/deletion and account settings.
5. Approved retention/deletion register and UAT deletion drill covering database, object versions, queues/caches, provider propagation and backup restore/replay.
6. DPO assessment and Thai counsel's role, lawful-basis, transfer and notice decisions.
7. GPPC Plus export/review record with version, date, reviewer and SHA-256.

## Approval

| Role | Name | Decision | Signature/date | Evidence reference |
|---|---|---|---|---|
| Technical data-flow owner | | ☐ accurate ☐ changes required | | |
| Customer/product owner | | ☐ scope approved ☐ changes required | | |
| Privacy/legal reviewer | | ☐ approved ☐ conditional ☐ rejected | | |
| Accountable executive | | ☐ risk accepted ☐ rejected | | |
