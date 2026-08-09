# MangmeePlus — Privacy, Terms, and Data Deletion

Status: IMPLEMENTED IN WEB COPY; OPERATIONAL CONTROLS AND THAI COUNSEL SIGN-OFF REMAIN REQUIRED BEFORE PRODUCTION REPRESENTATION
Date: 2026-08-09
Owner request: replace the mixed SudoChatBot/WatchDog legal copy with a complete, readable Thai Privacy Notice, Terms of Use, and User Data Deletion notice that reflects MangmeePlus code and current Thai law.
Memory: [[agent-memory/mangmeeplus-privacy-terms-data-deletion|MangmeePlus Legal Notices Memory]]

## 1. Problem and boundary

The prior public notice covered mostly LINE and AI, named the wrong product, and made promises that the application did not implement. The pasted deletion copy also mixed a service-cancellation recovery policy with a PDPA erasure request. This pass makes the public notices internally consistent and grounded in the current repository.

Legal copy cannot by itself close an operational gap. The notices therefore do not claim that a self-service user/company erasure workflow, complete processor agreements, direct Revenue Department filing, automatic slip authenticity verification, or instant physical object deletion exists when the code does not support it.

## 2. Settled product facts

- Product: MangmeePlus / มั่งมี, operated by บริษัท มั่งมียั่งยืน จำกัด, registration 0105569135722.
- Current sign-in is username/password. LINE account linking exists; LINE login is deferred. Google/Facebook login does not exist.
- The platform prepares quotes, invoices, receipts/tax invoices, accounting records, tax reports, and exports. It does not currently submit tax returns directly to the Revenue Department.
- OCR/AI can read, classify, summarize, and propose drafts. A human remains responsible for reviewing facts, accounting/tax treatment, signatures, approvals, payments, and filing.
- For service account/security/support data, MangmeePlus acts as controller. For tenant CRM/customer/employee/accounting content, the tenant is normally controller and MangmeePlus processes on the tenant's instructions.
- There is a CRM end-customer rights workflow. There is not yet a generic account/company deletion workflow, so the public deletion page describes a verified manual request channel rather than a non-existent self-service button.
- The public LINE marketing opt-out commands `ยกเลิกข่าวสาร`, `หยุดโปร`, and `STOP` are shared contract constants and are non-removable. A tenant may add aliases, but policy validation and legacy-policy reads restore the three public commands.
- Normal attachment deletion is presently a database soft-delete; physical storage/version deletion needs an operational implementation before promising immediate destruction.

## 3. Notice structure

### Privacy Notice

The notice covers the controller/processor split; data subjects and data categories; sources; purposes and lawful bases; required information and consequences; AI/OCR/profiling and human review; recipients and subprocessors; international transfers; essential cookies/storage; retention; security and breach response; sensitive/minor data; rights, identity checks, tenant-customer routing, complaints, and updates.

### Terms of Use

The terms cover B2B authority, accounts and permissions, truthful feature boundaries, business data and IP, AI/human review, accounting/tax responsibility, acceptable use, plans/fees, third parties, confidentiality/security, availability, termination/export/deletion, balanced liability, Thai law, disputes, changes, and contact.

### Data Deletion

The page separates four requests: delete the user's platform account; leave one company without deleting company records; delete a whole company workspace by an owner/authorized representative; and a CRM end-customer request addressed first to the tenant controller. It explains export, identity and authority verification, deletion/anonymisation/restriction, legal retention, backups, confirmation, and complaint rights.

Service cancellation is expressly distinct from a valid PDPA erasure request. The unsupported 45-day paid recovery and one-year automatic deletion claims are not published.

## 4. Thai-law baseline used

- PDPA sections 19, 23–26 and 30–40: transparent notice, lawful bases, sensitive data, rights, erasure exceptions, security, breach response, and processor duties.
- The 2024 erasure/anonymisation rule: act without delay and no later than 90 days for a valid erasure request; inaccessible/restricted backup handling until deletion or overwrite.
- Accounting Act 2000 section 14: accounting records/supporting documents are generally retained at least five years from the relevant closing/delivery event, with a possible order up to seven years.
- Revenue Code section 87/3: VAT records and supporting documents have their own five-year trigger and possible extension, including special cessation rules.
- PDPA sections 28–29 subordinate rules: adequacy, BCR, appropriate safeguards and enforceable rights/remedies for cross-border transfers.
- Electronic Transactions Act: electronic records/signatures and reproducible retention evidence.

The new 2026 access/copy subordinate rule published 16 July 2026 is scheduled to take effect 14 September 2026. Operations must re-check and update the workflow on its effective date; it is not described as already effective in the 9 August notice.

## 5. Retention presentation

The public notice uses category and purpose rather than pretending all data has one lifetime. Implemented/default periods may be disclosed where stable (for example AI turn data 90 days and service-policy categories), while accounting/tax content remains subject to document type, statutory trigger, legal hold, disputes, and tenant instruction. Backups are isolated and erasure is replayed after restoration where deletion cannot occur immediately.

## 6. Required production follow-ups

These are not solved by copy and must remain visible release blockers:

1. Verify the registered address against the latest DBD certificate and approve `contact@mangmeeplus.com` as the monitored privacy channel.
2. Complete and sign [`docs/security-evidence/dpo-necessity-assessment.md`](../security-evidence/dpo-necessity-assessment.md), including defensible production subject counts, the 100,000-person rule and all other large-scale factors, section 26/core-activity analysis, and controller/processor role separation; publish a DPO contact only if actually appointed.
3. Obtain/review the current AWS, Typhoon, LINE, Cloudflare, GitHub, and any optional AI-provider contracts, processor terms, data locations, training/use and retention terms, and sections 28–29 transfer mechanism. Close every `[DECIDE]`/`[OBTAIN]` item in [`docs/security-evidence/processor-cross-border-register.md`](../security-evidence/processor-cross-border-register.md), including tenant-configured webhook recipients and the non-code vendor ledger.
4. Build a generic account/company DSAR and deletion case workflow: identity/authority checks, export, legal hold, soft/physical object deletion including versions, audit evidence, SLA monitoring, backup tombstone/replay, and completion notice.
5. Consolidate retention configuration and jobs into one approved register. Verify live database/object/log/backup settings before publishing exact periods beyond those already enforced.
6. Either restore a functioning self-service AI objection/opt-out route or keep the notice on the monitored manual channel. Do not advertise the currently parked Security page.
7. The authenticated company-scoped clickwrap preserves the current Terms acceptance and Privacy acknowledgment as separate append-only actions, including immutable versioned artifact URL, exact served-byte SHA-256, exact statement, server time, user, membership, capacity, role, session, and request evidence. Keep the API/LINE gate, stale-challenge protection, mandatory unchecked controls, and artifact byte-hash checks covered by regression tests. The current Thai artifacts live under `/legal/releases/2026-08-09.2/`; prior releases stay append-only, and every future legal change must create a new versioned path and hash rather than overwrite existing files.
8. Obtain Thai privacy, technology-contract, accounting, and tax counsel sign-off on the final production facts. Re-check law and regulator guidance at release and on 14 September 2026.

Legal-acceptance rollout is ordered, not a single mixed-version switch: apply the additive migration first; deploy, drain, and health-check all API and employee-LINE processing replicas with the new guard; then deploy the Web gate. An old API replica can still accept direct Bearer or LINE business traffic, while a new replica started before the table exists would fail its guard query. Production orchestration must prove 100% backend convergence before the release is treated as enforced.

Interim operator guidance is recorded in `docs/runbooks/user-company-data-rights.md`. It is a manual-control design, not proof that generic erasure, physical object-version deletion, or backup replay has been implemented.

## 7. Verification gates

- Web typecheck and focused legal-content tests.
- Public route response for `/privacy`, `/terms`, and `/data-deletion` without authentication.
- Thai/mobile/desktop visual inspection, keyboard navigation, link and email validation.
- Source scan for stale WatchDog/SudoChatBot wording and unsupported Google/Facebook, instant filing, slip-authenticity, 45-day, and one-year claims in public legal surfaces.
- Contract/API regression coverage proving the three public marketing opt-out commands cannot be replaced by tenant policy.
- Legal-acceptance regression coverage for password-first ordering, company context, unchecked mandatory controls, stale version/challenge, API and employee-LINE blocking, idempotent evidence, role/capacity changes, and safe return URLs.
- Docker Web rebuild from the final source with no data-volume reset.
