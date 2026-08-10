# MangmeePlus v1 — Data Retention and Deletion Register

Status: **DRAFT — do not publish exact promises or mark release evidence VERIFIED until live settings, deletion tests and legal/accounting approval are attached**<br>
Assessment date: 2026-08-10<br>
Owners: Privacy / Legal; Accounting / Tax; Platform Security; Product

This register separates current code/config facts from a legally approved retention schedule. A default field or deploy script is not proof that every live copy, backup or provider follows the same period.

## Status vocabulary

- **[VERIFIED CODE]**: source/config currently says this; live read-back or end-to-end behavior may still be missing.
- **[VERIFIED LIVE]**: dated, signed/read-only export proves the setting in the relevant production account.
- **[DECIDE]**: management/privacy/accounting/counsel must select and justify the rule.
- **[TEST]**: deletion or expiry must be demonstrated end to end.
- **[OBTAIN VENDOR]**: obtain provider contract/account evidence.

## Core rules

1. Define a trigger, period, end action and exceptions for every copy—not just “keep X days.”
2. A service cancellation is not automatically a PDPA erasure request.
3. For a valid request, access/copy and erasure timelines must not be collapsed into one number: access/copy is handled within the applicable 30-day rule; eligible deletion/destruction/anonymisation is without delay and no later than 90 days under the applicable erasure rule, subject to lawful exceptions.
4. Do not use a blanket “soft delete 30 days so the user can change their mind” to delay a valid erasure request. A temporary restriction used to verify authority/impact is not completed deletion.
5. A database flag is not physical deletion. Include objects and versions, indexes, caches, queues, exports, logs, AI records, vendor copies and restored backups.
6. Juristic-person tax facts can still identify a natural-person vendor, employee, payer, signer or home address.

## Working schedule

| ID | Data/copy | Trigger | Current code/live fact | Proposed/required rule | End action | Exceptions/evidence still required | State |
|---|---|---|---|---|---|---|---|
| RET-01 | Access JWT | Issue/refresh | Access-token validity is **15 minutes** in the current technical contract | Keep only for configured validity; do not use as archive | Token expires/denies | Live auth config and expiry test | [VERIFIED CODE]/[OBTAIN]/[TEST] |
| RET-02 | Refresh/account session rows | Issue/last activity | Refresh/session validity is **7 days**; expired database rows do not yet have a proven purge | Use configured validity, immediate revocation on security/closure events, and a scheduled purge for expired rows | Expire/revoke, then delete obsolete row | Live task/config, logout/revocation and expired-row purge evidence | [VERIFIED CODE]/[OBTAIN]/[TEST] |
| RET-03 | Employee profile/membership/access | Account/membership active; employment/tenant instruction ends | Disable paths exist, but the employee-status use case does not delete profile/identity fields or prove session revocation; it does delete associated AI history | Customer defines employment/workspace retention; revoke access/session immediately when no longer authorized; retain only justified legal/security evidence | Revoke, delete or minimize profile/link; preserve justified audit evidence | Customer employee notice/DPA, identity ciphertext/hash copies, external identities, sessions, legal holds, cross-company account behavior | [DECIDE]/[TEST] |
| RET-04 | Expense, reimbursement, receipt and accounting/tax evidence | Relevant transaction/accounting period/contract termination | Business-policy default includes seven years for accounting slips, but applicability/jobs are not universal proof | Accounting/tax counsel and customer controller approve exact category/trigger; separate records legally required from transient intake copies | Delete/destroy or irreversibly anonymize after period/hold; maintain audit of action | Accounting Act/Revenue Code triggers, possible orders/claims, customer instruction, final-object lifecycle | [DECIDE]/[TEST] |
| RET-05 | LINE raw webhook recovery payload | Event received/turn reaches terminal state | Cleared on terminal handling; an orphan older than **1 hour** is parked/cleared by the minute worker, subject to worker health | Preserve bounded recovery only; alert on worker failure/backlog | Worker clears payload | Live worker health/backlog and failure-recovery test | [VERIFIED CODE]/[OBTAIN]/[TEST] |
| RET-05A | LINE webhook event metadata | Event received | Default purge window is **90 days**, in batches of 500 by the minute worker; it currently shares the AI retention knob | Split/approve the purpose-specific control if 90 days is retained; do not imply it is LINE provider retention | Batch hard delete eligible metadata | Live env, worker health, exception/legal-hold analysis | [VERIFIED CODE]/[OBTAIN]/[TEST] |
| RET-05B | LINE Redis conversation ledger | Message stored | Full message text uses TTL **86,400 seconds (1 day)** and max 200 entries per chat; Redis snapshots may retain a copy within the backup window | Keep the one-day operational ledger only if needed; include snapshot/recovery behavior | Redis expiry plus snapshot lifecycle | Live Redis config, encrypted snapshot and restore/expiry evidence | [VERIFIED CODE]/[OBTAIN]/[TEST] |
| RET-05C | LINE pending-media clarification | Pending item created | Logical TTL is **30 minutes**, but no proven cleanup was found; rows may remain `PENDING` and attachment may already be under `evidence/` | Add/verify expiry cleanup and separate abandoned transient media from canonical accounting evidence | Mark expired and physically delete eligible transient object versions | Worker/job, object mapping and expired-case drill | [VERIFIED CODE GAP]/[TEST] |
| RET-05D | Other LINE source media/canonical receipt | Receipt/turn received or case resolved | `chatMediaDays` default 180 exists, but does not prove deletion of receipt evidence in S3 or LINE provider copies | Set the shortest period for redundant/transient copies; canonical accounting evidence follows RET-04 | Delete redundant database/object versions and propagate where supported | LINE retention/deletion, CDN/cache, canonical-vs-transient mapping | [OBTAIN VENDOR]/[DECIDE]/[TEST] |
| RET-06 | MangmeePlus `AiTurn`/conversation/tool history | Turn completed | `AI_DATA_RETENTION_DAYS` default **90 days**; daily purge hard-deletes eligible `AiTurn`/`AiConversation`, and employee disable removes that user's/company's AI history | Keep 90 days only after purpose/need approval; store less where possible | Hard-delete eligible AI history; retain minimized audit only if justified | Live env, purge report, legal hold, provider copies, restored backup behavior | [VERIFIED CODE]/[OBTAIN]/[TEST] |
| RET-07 | Structured receipt OCR/extraction/verification fields stored with Expense | Expense created/confirmed | These fields follow the Expense record and are **not** deleted by the 90-day AI purge | Follow RET-04 and distinguish structured business evidence from transient model context | Delete with eligible Expense or approved accounting expiry | Expense purge does not exist generally; legal hold and receipt accuracy/audit purpose | [VERIFIED CODE]/[DECIDE]/[TEST] |
| RET-07A | Typhoon OCR/AWS model provider request/output copies | Provider receives request | No local constant proves provider retention/training/backup | Use only after binding/applicable evidence states retention, training/use, abuse review, backup and deletion; choose account setting/DPA accordingly | Provider deletion/expiry per approved terms and request propagation | Typhoon DPA/account; AWS/Bedrock terms; any OpenAI account setting | [OBTAIN VENDOR]/[DECIDE] |
| RET-08 | Production CloudWatch application log groups | Log event | Deploy policy pins production to **14 days**; cloud runbook records live 14-day read-back as of 2026-08-09 | Keep 14 days for these application log groups unless a separately approved change updates code/runbook/live state together | AWS expiry | This is not automatically traffic data, DB audit, support evidence or vendor telemetry | [VERIFIED CODE]/[VERIFY RELEASE LIVE] |
| RET-09 | Computer traffic data where the Computer Crime Act applies | Entry into computer system | CloudWatch 14 days alone cannot be assumed sufficient or insufficient until fields/system/provider classification is mapped | If MangmeePlus is the relevant service provider and the record is statutory traffic data, preserve at least 90 days; an official may order longer in a special case up to two years under the law. Counsel must map exact fields/location. | Secure expiry after required period/order and holds | Legal classification, responsible system, completeness, access and integrity evidence | [DECIDE]/[OBTAIN]/[TEST] |
| RET-10 | Database audit/change/approval records | Business/security event | Audit models/events exist; no single approved universal period found | Set per purpose: transaction evidence follows RET-04; security/authorization and claims follow risk/limitation analysis; minimize personal fields | Delete/minimize/anonymize after reason ends | Query/inventory, immutability, legal hold and rights response | [DECIDE]/[TEST] |
| RET-11 | S3 final `evidence/` receipt objects and noncurrent versions | Upload/version/replacement | No lifecycle covers final `evidence/`; current attachment/expense deletion is a database soft-delete and does not prove S3 object/version deletion | Canonical evidence follows RET-04; redundant/failed/pending copies get short lifecycle; delete every eligible version on approved erasure/expiry | Delete exact object versions and verify metadata/list result | Object inventory, lifecycle export, delete-version permission and drill | [VERIFIED CODE GAP]/[TEST] |
| RET-12 | Pending uploads | Upload initiated/abandoned | Object-storage lifecycle records a one-day current pending object plus one additional day for noncurrent version for the configured prefix | Preserve the short lifecycle if live and correctly scoped | Lifecycle expiry/delete versions | Live bucket/lifecycle export and failed-upload test | [VERIFIED CODE]/[OBTAIN]/[TEST] |
| RET-13 | Generated report exports | Export generated | Object lifecycle records seven days plus one day for noncurrent version for configured export prefix | Seven days unless business/legal need proves another period | Lifecycle expiry/delete versions | Live lifecycle/export path and download-expiry test | [VERIFIED CODE]/[OBTAIN]/[TEST] |
| RET-14 | RDS backups/PITR and Redis snapshots | Backup/snapshot created | Current infrastructure baseline records a **35-day** backup/snapshot window, but manual snapshots/copies and deletion replay are not closed in legal evidence | Approve exact live window; isolate deleted data from ordinary use; maintain tombstone/replay so deletion applies after restore; document exceptional restores | Automatic expiry; deletion replay after restore; restricted exceptional access | Live RDS/Redis export, manual snapshots, cross-region copies, restore/deletion drill | [VERIFIED DESIGN]/[OBTAIN]/[DECIDE]/[TEST] |
| RET-15 | Redis/queues/caches/retries | Job/cache created/completed/failed | Queue caps/defaults exist, but each personal-data payload/TTL and retry copy needs mapping | Avoid raw document/message payloads where IDs suffice; set bounded TTL/count; purge on completion/expiry/request where feasible | TTL/count removal; targeted purge | Live Redis topology/settings, queue payload inventory and purge test | [OBTAIN]/[TEST] |
| RET-16 | DSAR/deletion case and identity/authority evidence | Request received/case closed | Manual route and evidence requirements exist; approved period not selected | Keep minimum case decision/proof for compliance and claims; redact/delete identity copies sooner where possible; counsel sets exact period | Restrict, minimize, then delete after approved period/hold | Limitation periods, regulator/audit needs, secure case storage | [DECIDE] |
| RET-17 | Legal acceptance/version/hash evidence | User accepts/acknowledges | Append-only legal acceptance evidence is implemented | Keep while contract/compliance/claim proof is required; exact period counsel-approved; do not overwrite old releases | Restrict; delete/minimize only after legal reason ends | Contract limitation, disputes, audit, user-account deletion interaction | [DECIDE] |
| RET-18 | Support email/tickets and attachments | Ticket received/closed | Mailbox exists by management statement; full case/retention evidence pending | Separate ordinary support from security/DSAR/legal cases; apply shortest approved period and delete unnecessary attachments | Delete/minimize after case plus approved period | Mail provider retention, backup/export and legal holds | [OBTAIN]/[DECIDE]/[TEST] |
| RET-19 | Vendor telemetry/support/backup copies | Provider event/data received | Not established by local code | Record exact provider/account/plan terms and countries; no “same as our local retention” assumption | Provider expiry/deletion/termination process | AWS, LINE, Typhoon, Cloudflare, GitHub and any enabled OpenAI evidence | [OBTAIN VENDOR]/[DECIDE] |
| RET-20 | GitHub deployment artifacts/logs | Workflow run/artifact created | Production workflows use **7-day** artifact retention; production personal data is not intended in CI/CD | Preserve seven days for release evidence where appropriate; prohibit production personal-data fixtures/logs and use the separate immutable compliance bundle for legal evidence | GitHub expiry/delete according to account policy | Organization/settings export, Actions/apps inventory, accidental-data scan | [VERIFIED CODE]/[OBTAIN]/[TEST] |

## Deletion workflow that must be implemented and tested

1. **Receive and case:** record received-at, scope and contact; do not ask for secrets or unnecessary sensitive data.
2. **Verify:** confirm identity and, for a whole workspace, current director signing conditions or a valid power of attorney. Corporate stamp only when the company's signing condition requires/uses it.
3. **Classify roles:** identify MangmeePlus-controlled data versus customer-controlled workspace data and obtain the customer controller's lawful instruction where required.
4. **Map copies:** database rows/tombstones; attachment objects and every version; search/index/analytics; LINE/pending media; AI turns/provider requests; queues/cache/retries; logs; exports; backups; downstream recipients.
5. **Apply holds/exceptions:** record the law, claim or exact reason, minimum fields and end/review date; restriction is not a permanent substitute for a deletion decision.
6. **Restrict during verification where necessary:** temporarily suspend access/processing to prevent harm. Do not state that deletion is complete.
7. **Execute:** delete/destroy or irreversibly anonymize eligible copies; preserve only approved exceptions; notify processors/recipients where required and feasible.
8. **Backups:** isolate from ordinary use and ensure the deletion instruction/tombstone is replayed after any restore until backup expiry.
9. **Verify:** query every mapped system/provider; record object version IDs/status and aggregate evidence without copying raw personal data into git.
10. **Notify:** state what was deleted, what remains, why, until when, and complaint/escalation route. Do not say “completed” while an undisclosed copy remains pending.

## Whole-workspace authority rule — proposed for counsel approval

A whole-workspace deletion request must be in writing and signed by director(s) according to the current DBD certificate's signing conditions, or by a lawfully authorized representative. Require a corporate stamp only where the juristic person's signing condition or actual corporate practice requires it. An administrator account alone is not sufficient evidence to destroy the entire tenant. Before irreversible action, confirm export/termination instructions, disputes, other data subjects, legal retention and whether the same human account belongs to other companies.

## Deletion drill evidence form

| Field | Required entry |
|---|---|
| Drill ID/environment/build/date | |
| Test subject/workspace and synthetic-data confirmation | |
| Approved requester/authority evidence ID | |
| Systems/copies enumerated before action | |
| Database result | |
| S3 object keys and version results | |
| LINE/Typhoon/AWS AI/vendor propagation result | |
| Queue/cache/search/export/log result | |
| Backup restore/replay result | |
| Holds/exceptions and end date | |
| Completion notification evidence | |
| Technical reviewer/signature/date | |
| Privacy/legal reviewer/signature/date | |

## Approval

| Role | Name | Decision | Signature/date | Evidence reference |
|---|---|---|---|---|
| Platform Security | | ☐ live facts accurate ☐ changes required | | |
| Product/Operations | | ☐ workflow operable ☐ changes required | | |
| Accounting/Tax adviser | | ☐ periods/triggers approved ☐ conditional ☐ rejected | | |
| Privacy/Thai counsel | | ☐ approved ☐ conditional ☐ rejected | | |
| Accountable executive | | ☐ policy approved ☐ rejected | | |
