# MangmeePlus — Privacy, Terms, and Data Deletion

Status: V2 WEB UPDATE IMPLEMENTED AND VERIFIED; OPERATIONAL CONTROLS AND THAI COUNSEL SIGN-OFF REMAIN REQUIRED BEFORE PRODUCTION RELEASE
Date: 2026-08-09
Owner request: replace the mixed SudoChatBot/WatchDog legal copy with a complete, readable Thai Privacy Notice, Terms of Use, and User Data Deletion notice that reflects MangmeePlus code and current Thai law.
Memory: [[agent-memory/mangmeeplus-privacy-terms-data-deletion|MangmeePlus Legal Notices Memory]]

## 2026-08-15 acceptance identity correction

Owner clarified that a deployment must not ask a user to accept again when the substantive legal
document content has not changed. The current implementation violates that rule because its
`scopeRef` includes internal document versions and URLs, `statementVersion`, and the generated
checkbox-template fingerprint in addition to the immutable artifact hashes.

The durable acceptance identity is therefore **user + exact current Terms/Privacy artifact SHA-256
pair**. Internal release numbering, display labels, artifact URLs, checkbox wording, statement
version, company/role context, application commit, and redeployment remain evidence or stale-form
controls but are not re-acceptance triggers. The API must recognize any coherent append-only pair
for the user whose two artifact hashes equal the current pair, including evidence written by the
legacy broader `scopeRef`; no database rewrite or backfill is allowed.

A materially changed Terms or Privacy text must still be published as a new immutable artifact,
which changes at least one hash and requires acceptance again. While Data Deletion remains a live
procedure rather than a separately frozen acceptance artifact, a material procedure change that
requires renewed acknowledgment must be carried by a new immutable Terms or Privacy release.
Changing only UI wording or presentation must not simulate a legal content release.

Acceptance criteria:

- redeploying the same artifact hash pair keeps existing users accepted;
- changing internal version, URL, statement version, or checkbox template alone keeps existing
  users accepted while stale in-flight submissions still reload;
- changing either current artifact hash requires a new coherent acceptance pair;
- incomplete, cross-batch, mutable-URL, wrong-user, or hash-inconsistent evidence still fails closed;
- existing append-only evidence is neither updated nor deleted.

## 2026-08-10 v2 amendment

Owner requested that the reviewed launch-scope wording be applied to the web. This amendment supersedes the feature-neutral v1 publication boundary below without changing any v1 artifact. The latest public Privacy, Terms, and Data Deletion routes may now name employee accounts/access, expenses/receipts/reimbursements, employee LINE receipt-image intake and read-only bill questions, OCR/AI assistance, and security/legal evidence. CRM customer and marketing functions remain expressly out of scope.

The implementation must create a new append-only `/legal/releases/v2/` Terms/Privacy pair, update the current legal contract to their exact byte hashes, and rely on the existing user-plus-release acceptance scope to require acknowledgment again. No API, database, migration, third checkbox, or Data Deletion acceptance document is added. `LEGAL_ACCEPTANCE_STATEMENT_VERSION` stays `v1` because the checkbox/capacity statements are unchanged.

Public copy must distinguish access/copy within 30 days from eligible erasure without delay and no later than 90 days; use written DBD signing authority or lawful power of attorney for a whole-workspace request; and state that receipt of a request, account closure, or a database status change is not proof of complete deletion. It must not promise generic hard deletion, physical deletion of every S3 object version, post-restore deletion replay, provider-side deletion, a fixed 30-day recovery buffer, universal one/two-year logs, or 15/30-day payment grace. Provider names/countries and DPO status remain unpublished until their signed evidence is complete.

The checked-in legal evidence manifest moves to release version `v2` but remains `BLOCKED`; v1 approvals, if any, cannot be reused as v2 counsel approval. Production deployment remains fail-closed until the exact v2 URLs/hashes and external evidence are reviewed.

Implementation result: the current contract now points to immutable v2 Terms and Privacy artifacts, existing acceptance logic requires the exact v2 pair without a schema or API change, the latest public Data Deletion route carries the same launch scope and DSAR deadlines, and focused contract/Web/API plus legal-release-gate checks pass. No production deployment was performed.

## 1. Problem and boundary

The prior public notice covered mostly LINE and AI, named the wrong product, and made promises that the application did not implement. The pasted deletion copy also mixed a service-cancellation recovery policy with a PDPA erasure request. This pass makes the public notices internally consistent and grounded in the current repository.

Legal copy cannot by itself close an operational gap. The notices therefore do not claim that a self-service user/company erasure workflow, complete processor agreements, direct Revenue Department filing, automatic slip authenticity verification, or instant physical object deletion exists when the code does not support it.

## 2. Settled product facts

Owner update 2026-08-10: the first public legal release must describe only the functions
actually exposed in v1. The public copy is deliberately feature-neutral: it refers to functions
shown as enabled for the user's account and does not name CRM, LINE, OTP, AI/OCR, accounting,
tax, marketing, filing, or specialist reports. Repository capabilities and future roadmap are not
public v1 promises. Every authenticated web user confirms the current Terms
and acknowledges the current Privacy Notice once per user account. Company, membership, roles and
capacity remain immutable evidence snapshots from that first confirmation, but changing any of
those facts does not trigger another clickwrap. A new immutable Terms or Privacy release does.

- Product: MangmeePlus / มั่งมี, operated by บริษัท มั่งมียั่งยืน จำกัด, registration 0105569135722.
- The notice names only account/access, company/workspace, user-submitted content, usage/security, legal-acceptance, and support data categories needed across the functions actually enabled in v1.
- For service account/security/support data, MangmeePlus acts as controller. For content a tenant places in its workspace, the tenant is normally controller and MangmeePlus processes on the tenant's instructions.
- There is not yet a generic account/company deletion workflow, so the public deletion page describes a verified manual request channel rather than a non-existent self-service button.
- Feature-specific policy constants and capabilities may remain implemented elsewhere in the repository, but they are not imported into or described by the v1 public legal copy.
- Normal attachment deletion is presently a database soft-delete; physical storage/version deletion needs an operational implementation before promising immediate destruction.

## 3. Notice structure

### Privacy Notice

The notice covers the controller/processor split; neutral data categories; sources; purposes and lawful bases; recipients and processors; international transfers; essential cookies/storage; retention criteria; security and breach response; sensitive/minor data; rights, identity checks, tenant routing, complaints, and updates. It does not enumerate deferred features.

### Terms of Use

The terms cover B2B authority, once-per-release acceptance, accounts and permissions, truthful v1 boundaries, business data and IP, acceptable use, plans/fees, confidentiality/security, availability, termination/export/deletion, balanced liability, Thai law, disputes, changes, and contact.

### Data Deletion

The page separates deletion of a user's account from deletion of tenant-controlled workspace content and deletion of an entire workspace by an owner/authorized representative. It explains identity and authority verification, deletion/anonymisation/restriction, generic lawful retention, backups, confirmation, and complaint rights without naming deferred modules or record types.

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

The public notice uses category, purpose, contract state, risk, legal obligation, claims, and tenant instruction as retention criteria rather than publishing periods from deferred modules. It states that an eligible erasure request covers backups within the same 90-day ceiling unless a lawful retention ground applies. Production remains blocked until Operations can prove object-version, provider, backup, and restoration handling end to end; the notice is not evidence that those controls already exist.

## 6. Required production follow-ups

These are not solved by copy and must remain visible release blockers:

1. Verify the registered address against the latest DBD certificate and approve `contact@mangmeeplus.com` as the monitored privacy channel.
2. Complete and sign [`docs/security-evidence/dpo-necessity-assessment.md`](../security-evidence/dpo-necessity-assessment.md), including defensible production subject counts, the 100,000-person rule and all other large-scale factors, section 26/core-activity analysis, and controller/processor role separation; publish a DPO contact only if actually appointed.
3. Obtain/review the current AWS, Typhoon, LINE, Cloudflare, GitHub, and any optional AI-provider contracts, processor terms, data locations, training/use and retention terms, and sections 28–29 transfer mechanism. Close every `[DECIDE]`/`[OBTAIN]` item in [`docs/security-evidence/processor-cross-border-register.md`](../security-evidence/processor-cross-border-register.md), including tenant-configured webhook recipients and the non-code vendor ledger.
4. Build a generic account/company DSAR and deletion case workflow: identity/authority checks, export, legal hold, soft/physical object deletion including versions, audit evidence, SLA monitoring, backup tombstone/replay, and completion notice.
5. Consolidate retention configuration and jobs into one approved register. Verify live database/object/log/backup settings before publishing exact periods beyond those already enforced.
6. Either restore a functioning self-service AI objection/opt-out route or keep the notice on the monitored manual channel. Do not advertise the currently parked Security page.
7. The authenticated clickwrap preserves the current Terms acceptance and Privacy acknowledgment as separate append-only actions, including immutable versioned artifact URL, exact served-byte SHA-256, exact statement, server time, user, initial company/membership/capacity/role snapshot, session, and request evidence. Its required/not-required scope is **user + exact released document pair**, not company, membership, or role. Keep the API/LINE gate, stale-challenge protection, mandatory unchecked controls, and artifact byte-hash checks covered by regression tests. While the product remains pre-launch, the first Thai release is `/legal/releases/v1/`; after launch, any legal-content change must create `v2` (then `v3`, etc.) and a new hash rather than overwrite an accepted release.
8. Obtain Thai privacy, technology-contract, accounting, and tax counsel sign-off on the final production facts. Re-check law and regulator guidance at release and on 14 September 2026.

Legal-acceptance rollout is ordered, not a single mixed-version switch: apply the additive migration first; deploy, drain, and health-check all API and employee-LINE processing replicas with the new guard; then deploy the Web gate. An old API replica can still accept direct Bearer or LINE business traffic, while a new replica started before the table exists would fail its guard query. Production orchestration must prove 100% backend convergence before the release is treated as enforced.

Interim operator guidance is recorded in `docs/runbooks/user-company-data-rights.md`. It is a manual-control design, not proof that generic erasure, physical object-version deletion, or backup replay has been implemented.

## 7. Verification gates

- Web typecheck and focused legal-content tests.
- Public route response for `/privacy`, `/terms`, and `/data-deletion` without authentication.
- Thai/mobile/desktop visual inspection, keyboard navigation, link and email validation.
- Source scan for stale product names, the declared employee/receipt/LINE/OCR/AI scope, explicit CRM exclusion, and absence of named unverified providers or universal deletion claims.
- Contract/API regression coverage proving the three public marketing opt-out commands cannot be replaced by tenant policy.
- Legal-acceptance regression coverage for password-first ordering, initial company evidence context, unchecked mandatory controls, stale version/challenge, API and employee-LINE blocking, idempotent evidence, one acceptance across company/role changes, re-acceptance on a new document release, and safe return URLs.
- Docker Web rebuild from the final source with no data-volume reset.
