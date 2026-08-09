# MangmeePlus — User and Company Data Rights Runbook

Status: INTERIM MANUAL CONTROL — durable case orchestration is implemented; destructive execution, trusted evidence resolution, backup replay and external approvals remain release blockers
Effective draft: 2026-08-09
Public notices: `/privacy`, `/data-deletion`

## 1. Purpose and non-negotiable rule

This runbook governs access, correction, restriction, objection, portability, erasure, membership removal, and company-workspace offboarding requests that are not already completed by the CRM end-customer workflow.

Do not tell a requester that deletion is complete merely because a row is hidden, a membership is disabled, or a database record is soft-deleted. Completion evidence must address live databases, object versions, queues/caches, relevant processors, retained/legal-hold data, and backup handling for the confirmed scope.

## 2. Required roles

- **Privacy coordinator:** receives/routes requests, owns the case timeline and response.
- **Identity verifier:** verifies the requester without collecting excessive identity data.
- **Tenant authority verifier:** confirms owner/legal-representative authority for a company instruction.
- **Service operator:** executes and evidences account, database, object-storage, queue/cache, and processor actions.
- **Legal/accounting reviewer:** records statutory retention, litigation hold, fraud/security, and refusal/partial-completion grounds.
- **Security incident owner:** joins immediately if the request reveals unauthorized access or a personal-data breach.

One person may hold several roles in a small team, but the executor must not approve their own evidence for a full-company irreversible deletion.

## 3. Intake and case record

1. Accept a clear request received through any monitored channel; recommend `contact@mangmeeplus.com` for traceability but do not reject a request solely because it came elsewhere.
2. Create a restricted case record with a unique case ID, received time, channel, requester, requested right, companies/data subjects involved, controller/processor role, deadline, owner, and status.
3. Acknowledge receipt without exposing whether an account exists to an unverified requester.
4. Never request a password, OTP, recovery secret, or full identity-document copy by ordinary email.
5. If the old registered email is inaccessible, select proportionate alternative evidence based on risk. Mask and delete unnecessary verification material after the verification purpose ends.

The restricted System Admin surface is `/system/data-rights` and the API is `/v1/system/data-rights/cases`, guarded by the CRITICAL `system.data_rights.manage` permission. It records identity/authority checks, 12 category decisions, phase-bound evidence references, dual-control actors, blocked remediation links and an append-only action trail. It deliberately exposes no hard-delete endpoint.

## 4. Classify before acting

| Request | Decision owner | Effect |
|---|---|---|
| Delete a MangmeePlus user account | MangmeePlus as controller | Revoke the user's global account after resolving memberships and lawful retention; does not delete tenant documents |
| Leave one company | Authorized tenant administrator/instruction | Remove that membership and access only; global account and other companies remain |
| Delete a company workspace | Owner/legal representative + MangmeePlus under contract/DPA | Offboard tenant data and memberships; never delete other users' global accounts |
| Tenant customer/employee/counterparty data | Tenant as controller | Route to tenant; MangmeePlus assists on a verified lawful instruction |
| MangmeePlus security/support/billing data | MangmeePlus as controller | Decide the right and exceptions directly |

A company or other juristic person is not itself a PDPA data subject. Separate contractual workspace offboarding from section 33 requests concerning natural-person data inside the workspace.

## 5. Verify scope and authority

- Confirm the requester controls the relevant account or is an authorized representative.
- For a company-wide instruction, verify current legal authority, conflicts among owners, and whether another company administrator must be notified.
- Identify every company membership before deleting a global user account. Do not destroy another tenant's evidence or access model without its instruction/legal basis.
- Confirm whether the requester also wants an export. Export and erasure are separate instructions.
- Freeze only the minimum processing needed to prevent conflicting writes while an irreversible operation runs.

## 6. Data map and retention decision

For the confirmed identity/company, inventory at least:

- global user, credentials, sessions/tokens, verification/reset records, LINE/device connections;
- memberships, roles, branch/approval assignments and invitations;
- CRM profiles, messages/media, consent, bookings/orders and profiling outputs;
- employee/contact/counterparty records;
- accounting, tax, bank, expense, sales/procurement and signed evidence;
- attachments, blobs, current/non-current object versions and generated exports;
- AI/OCR turns, drafts, prompts/previews, hashes and lineage;
- audit, security, support, billing, logs, queues/caches and backups;
- copies held by subprocessors within the instruction scope.

The legal/accounting reviewer must record per category: delete, anonymise, restrict, return, or retain; legal basis; retention trigger/end date; access restriction; and eventual deletion owner. Accounting/tax/legal-claim exceptions must not be used to retain unrelated profile or marketing data.

## 7. Execution controls

The case state `EXECUTING` is an operator control point, not an execution engine. A `run://`, `evidence://`, `approval://` or `case://` reference plus SHA-256 is still a manually supplied attestation until it is resolved against a trusted evidence store and its bytes, provenance and signer are verified. Do not treat a case status alone as proof that physical deletion occurred.

### User account

- Revoke active sessions, credentials, reset/verification tokens and personal channel/device links.
- Resolve each membership as instructed by the relevant tenant; preserve company documents and transaction integrity.
- Delete or irreversibly anonymise profile/contact fields that have no continuing basis.
- Minimise retained audit/security/billing identifiers and restrict them to the recorded purpose.

### Company workspace

- Stop new writes and revoke memberships/access for that workspace after the approved cutover.
- Deliver the confirmed export before destructive work when requested and legally permitted.
- Apply the approved decision to tenant tables, files, blobs and every object version; a database soft-delete alone is not completion.
- Remove or invalidate tenant data in queues, caches, pending jobs and generated temporary files.
- Send verified instructions to relevant processors and record their response where required by contract/law.
- Do not delete each member's global MangmeePlus account; those users exercise that right themselves.

### Existing CRM erasure workflow

- Use the durable CRM case/worker path for an eligible end-customer request.
- Verify finance/tax exceptions and pseudonymisation/redaction results.
- Preserve the audited case outcome without retaining unnecessary raw identity/provider identifiers.

## 8. Backups and restoration

If record-level deletion from a backup is not immediately possible:

1. record the backup sets and overwrite/destruction date in the case;
2. prevent use/disclosure of the deleted data outside a controlled disaster recovery event;
3. create a durable deletion manifest/tombstone outside the affected backup;
4. after any restore, replay the manifest before returning restored personal data to normal use;
5. record the replay result and exceptions.

Until these controls are implemented and tested, do not issue an unqualified statement that all backup copies were deleted.

## 9. Verification and completion letter

The verifier checks the approved scope independently and records:

- no live account/session/access remains where deletion was approved;
- expected database PII is gone or irreversibly anonymised;
- current and non-current object versions are deleted or have a documented lawful retention lock;
- processor actions and unresolved exceptions;
- backup lifecycle/replay treatment;
- retained categories, legal basis, restricted users and deletion/end date;
- export delivery and requester confirmation where applicable.

The completion letter states what was completed, what was partially completed, what remains and why, retention end/lifecycle where known, complaint/escalation channel, and case ID. Never use “ลบถาวรทั้งหมด” unless the evidence supports that exact scope.

## 10. Deadlines and escalation

- Track every request from receipt, not from the date convenient to the operator.
- Handle section 30 access/copy requests without delay and within 30 days under the current Act.
- Target eligible erasure requests for completion within 30 days; the applicable 2024 erasure rule requires action without delay and no later than 90 days.
- Workspace offboarding follows the confirmed contract/DPA schedule; embedded natural-person rights retain their statutory deadlines.
- Escalate immediately for identity conflict, disputed company authority, legal hold, suspected fraud, security breach, missed deadline, processor failure, or inability to delete object versions/backups.

## 11. Production gates

This manual runbook and the case UI are not evidence that destructive controls are operational. Current code already provides the restricted case system, immutable target scope, HMAC-pseudonymised requester contact, phase/decision matrix, overlap locks, append-only evidence/action records, independent approval/execution/verification actors for every case type, `BLOCKED` remediation and read-only exact S3 version/Object Lock inventory. Before production reliance on a completion claim:

Legal/privacy release evidence is provisioned separately from user-deletion evidence. Follow
[`legal-release-evidence-bundle.md`](./legal-release-evidence-bundle.md) for the dedicated
compliance-bucket, exact-version, digest and GitHub OIDC setup; the current BLOCKED manifest must
continue to stop deployment until every real review is complete.

- assign named on-call owners and rehearse the restricted case system;
- connect evidence references to a trusted store and verify bytes, hashes, provenance, signer and approved case scope server-side;
- implement/test physical S3 object-version deletion in a narrowly authorised worker and legal-hold handling; the application task role must not receive bucket-wide `s3:DeleteObjectVersion`;
- implement/test the backup deletion manifest and post-restore replay;
- verify processor/DPA deletion procedures and cross-border safeguards;
- rehearse one account, one membership, one company, and one tenant-customer case end to end;
- obtain privacy/security/accounting/legal sign-off on the evidence and response templates.
