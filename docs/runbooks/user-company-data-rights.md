# MangmeePlus — User and Company Data Rights Runbook

Status: INTERIM MANUAL CONTROL — durable case orchestration is implemented; destructive execution, trusted evidence resolution, backup replay and external approvals remain release blockers
Design of record from 2026-09-15: [P31 spec](../specs/mangmee-company-data-lifecycle-deletion-spec-th.md) / [P31 plan](../plans/mangmee-company-data-lifecycle-deletion-plan-th.md) — not yet implemented, except single-admin mode for a case (P31 spec §8.7, 2026-10-02; see §2 and §2.1). Every procedure below still applies as written: the case system records steps, it erases nothing.
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

**Single-admin mode (Owner decision 2026-10-02; P31 spec §8.7).** This project runs with exactly one System Admin, so the rule above cannot be met by staffing. Five steps are refused to the person who took the step before: approving a case you opened, executing a case you approved, starting verification of a case you executed, recording the independent verification of it, and closing it. `data-rights.service.ts` refuses them, and the database refuses them again through triggers (SQLSTATE 55000). The refusal was not the safe failure it looked like: it stopped every case, including a lawful PDPA erasure request whose 90-day clock was already running.

While the platform has exactly one active System Admin, that admin may take each of those five steps as an explicit single-admin step. Each one needs a written reason, and the system stores a marker with the step, the reason, and an audit entry of its own (`system.data_rights.single_admin_step`, CRITICAL). The database accepts a same-person step only when the marker and reason are on the row; anything else is refused as before. Nothing a second person would have looked at is skipped: identity and company authority must be verified, all 12 category decisions recorded with current retention dates, and the required evidence attached, before the step is accepted.

"Active" means the person can sign in: an admin account whose sign-in has been disabled is not counted. The account retired in the System Admin cutover of 2026-09-07 is such an account; it keeps its protected role, but nobody can sign in to it, so it is not a second person.

As soon as a second active System Admin exists, the separation rules apply again in full and the single-admin path is refused, even with a reason. The second person then takes the step. Creating a second admin account for the same human is explicitly forbidden — it writes false dual-control evidence into a compliance record. The record must say one person did it, because that is what happened.

This ships with migration `20261002120000_data_rights_single_admin_mode` through the normal release path. On an environment that does not have that release yet, a case opened by the only admin still cannot be approved, and the smallest staffing that can finish a case is two real people: one opens the case and executes, the other approves, verifies and closes.

### 2.1 One System Admin: taking a real request through

A completed case is a record, not an erasure. No step of the case system reads, changes, exports or deletes the requester's data: "start execution", "start verification" and "close the case" only change the case status, stamp who did it and when, and add a line to the case history. The real work is the manual procedure in §7, and its results go into the case as evidence references.

1. **Open the case** at `/system/data-rights` (§3): reference, type, channel, target and the response deadline.
2. **Verify identity**, and for a company workspace **verify company authority**, each with its evidence reference (§5).
3. **Start the retention review** and record a decision for each of the 12 data categories (§6).
4. **Approve the plan.** Because you opened the case, the page shows "ทำขั้นตอนนี้ด้วยตนเอง" with a reason field. Write why you are acting alone (at least 20 characters, for example that there is one System Admin and the request has a statutory deadline), then press "อนุมัติแผนด้วยตนเอง" and confirm. Approval confirms the plan; it deletes nothing.
5. **Start execution** the same way ("เริ่มช่วงดำเนินการด้วยตนเอง"). This only opens the evidence phase. Do the actual work by hand as §7 describes, and record each result as an evidence reference with its SHA-256.
6. **Start verification** once the required evidence is complete ("เริ่มตรวจยืนยันด้วยตนเอง"). Check the real evidence, not the case status.
7. **Record the independent-verification evidence** (reference, SHA-256 and the reason field in the same form).
8. **Close the case** ("สรุปผลและปิดเคสด้วยตนเอง"): the outcome is derived from the decisions; write the summary and the reason. The button stays off until the reason is written.
9. **Write the completion letter** (§9). State which steps one person took and why; the case page lists them with their reasons under "ขั้นตอนที่ทำโดยผู้ดูแลระบบคนเดียวในเคสนี้". Never write that the system deleted the data.

Notes:

- A reason cannot be changed afterwards, and it is kept with the case permanently. Do not put the requester's personal data in it.
- If a second System Admin is appointed while a case is open, every remaining step that follows a step you took must be taken by them. A step already recorded as single-admin stays recorded that way.
- If the page refuses with "ต้องให้ผู้ดูแลระบบอีกคนเป็นผู้ทำ", a second System Admin now exists. Reload the page; it will say which step the other admin has to take.
- The page shows the reason field only when the server reports one active System Admin. The server counts again when you press the button.

## 3. Intake and case record

1. Accept a clear request received through any monitored channel; recommend `contact@mangmeeplus.com` for traceability but do not reject a request solely because it came elsewhere.
2. Create a restricted case record with a unique case ID, received time, channel, requester, requested right, companies/data subjects involved, controller/processor role, deadline, owner, and status.
3. Acknowledge receipt without exposing whether an account exists to an unverified requester.
4. Never request a password, OTP, recovery secret, or full identity-document copy by ordinary email.
5. If the old registered email is inaccessible, select proportionate alternative evidence based on risk. Mask and delete unnecessary verification material after the verification purpose ends.

The restricted System Admin surface is `/system/data-rights` and the API is `/v1/system/data-rights/cases`, guarded by the CRITICAL `system.data_rights.manage` permission. It records identity/authority checks, 12 category decisions, phase-bound evidence references, the actor of each step (two people, or one System Admin's explicit single-admin steps with their reasons — §2), blocked remediation links and an append-only action trail. It deliberately exposes no hard-delete endpoint.

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

When one System Admin took steps alone (§2.1), there was no independent verifier: the letter and the case summary must say that one person approved, executed, verified and closed the case, and give the recorded reasons. The system does not write this letter; copy the steps and reasons from the case page.

## 10. Deadlines and escalation

- Track every request from receipt, not from the date convenient to the operator.
- Handle section 30 access/copy requests without delay and within 30 days under the current Act.
- Target eligible erasure requests for completion within 30 days; the applicable 2024 erasure rule requires action without delay and no later than 90 days.
- Workspace offboarding follows the confirmed contract/DPA schedule; embedded natural-person rights retain their statutory deadlines.
- Escalate immediately for identity conflict, disputed company authority, legal hold, suspected fraud, security breach, missed deadline, processor failure, or inability to delete object versions/backups.

## 11. Production gates

This manual runbook and the case UI are not evidence that destructive controls are operational. Current code already provides the restricted case system, immutable target scope, HMAC-pseudonymised requester contact, phase/decision matrix, overlap locks, append-only evidence/action records, independent approval/execution/verification actors for every case type (or, while there is one System Admin, explicit single-admin steps that are recorded as such — §2), `BLOCKED` remediation and read-only exact S3 version/Object Lock inventory. Before production reliance on a completion claim:

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
