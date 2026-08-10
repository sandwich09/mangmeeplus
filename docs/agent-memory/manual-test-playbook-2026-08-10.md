# Agent Memory: manual-test-playbook (human bug-hunt guide)

Status: DONE — deliverable created, not committed
Owner: thawatchai (requested Thai step-by-step playbook to hunt human-side bugs this release)
Scope: docs only — new file `docs/qa/manual-test-playbook-2026-08.html` (282 KB, self-contained, Thai)
Decisions:
- Content sourced from code analysis of branch `develop` (9 parallel read-only explorations: admin onboarding/feature toggles, dashboard+notifications, expenses, substitute receipts, reimbursements, employee access, settings, LINE, remaining release flows), not from specs — spec-only features are explicitly flagged as "not implemented".
- Format: single offline HTML with sticky TOC, 262 localStorage-persisted checkboxes, 5 inline SVG diagrams (system map, expense/reimbursement/substitute-receipt state machines, cross-flow map), step tables with "expected result" column, per-flow bug-hunt checklists, 4 E2E scenario scripts, and §13 splitting known/intentional behavior vs suspected real bugs.
Suspected real bugs listed in §13.2 (worth verifying before filing): substitute-receipt supersede leaves expense PAID; reimbursement REJECTED is a dead end while in-app guide claims resubmission; PO-approval policy not enforced at approval time; discount policy has no consumer; Thai-only role names slug to key `ROLE` breaking reimbursement routing; dashboard inventory card prints raw ISO timestamp; notification rule toggle swallows errors.
Artifacts:
- docs/qa/manual-test-playbook-2026-08.html (deliverable)
- build parts in session scratchpad playbook/part01-12.html (ephemeral)
Verification: tag-balance script (all balanced: 14 sections / 57 tables / 5 svg), rendered in browser pane — TOC progress counters + checkbox JS working, SVGs render at full size (verified via DOM since the preview pane doesn't repaint static-file scroll).
Next: user plays through the checklist; findings can be triaged against §13.1 (known) vs §13.2 (suspects). Regenerate by editing the HTML directly (no build step).

## Bug-fix round 2026-08-10 (same session, owner-directed scope)

Status: DONE — code fixed, all suites green, playbook §13 updated with a fix banner. Not committed.
Owner decisions recorded: self-approval role exemption (OWNER/ADMIN/MANAGER) is intended in every
workflow incl. substitute receipts (OWNER_SELF mode only; DESIGNATED stays strict); reimbursement
disable = runoff (block new claims only, in-flight approve/reject/finance/payout/duplicate-resolve
continue); owner LINE QR TTL = 72h per spec. Out of scope stays unfixed: PO-approval enforcement,
discount policy consumer, dashboard ISO timestamp, Thai-only role key `ROLE`, catalog archive button,
quiet-hours validation, branch phone/email blanking.

Changes (10 items):
1. `prisma-expense.repository.ts` supersedeSubstituteEvidence: voids issue-created RECORDED/pending
   payments + resets expense to UNPAID (paid 0, outstanding=netPayable, method/paidAt null). Spec added.
2. Reimbursement REJECTED→DRAFT: `reopenRejectedRequest` (repo CAS, keeps requestNo; submit idempotency
   `reimb-submit:{id}` reuses the number), `ReopenRejectedReimbursementUseCase`, `POST :id/reopen`
   (perm update_own_draft; owner-or-finance), web button "แก้ไขและยื่นใหม่" + `canReopen` gate + Thai
   labels (`reimbursement_changed` in both error maps — api-error-coverage enforces the global one).
3. Runoff: `RETAINED_REIMBURSEMENT_PERMISSIONS` in feature-gate.logic (read/read_own/read_related/
   approve/reject/finance_review/payment.record/payment.void/duplicate.resolve survive disable);
   menu-entitlement-binding.spec got a RUNOFF_NAV_KEYS carve-out.
4. Substitute self-approval: `selfApprovalPermitted()` in substitute-receipt.use-case (imports
   SELF_APPROVAL_EXEMPT_ROLES from procurement.logic) at approve gate, allowSelfApproval repo flag and
   assertSignatureActor; web renamed isOwner→canSelfApprove chain + `hasSelfApprovalExemptRole`
   helper in substitute-receipt-wizard.model (4 route pages compute from session.roles).
5. OWNER_LINE_LINK_TOKEN_TTL_MS 24h→72h + copy + 3 specs (employee-access.logic, regenerate, reissue,
   create-company-onboarding).
6. LINE plain-text fallback: Sources:/Open: → แหล่งข้อมูล:/เปิดดู: (formatLineReply).
7. Branch HO-archive 422 now carries code `branch_head_office_required` + Thai in api-error-message.ts.
8. Notifications web: toggleRule surfaces toast.error; `/notifications/rules` route rule requires
   notification.rule.manage; shared `internalNotificationHref()` used by bell + centre.
9. Wizard approver position change resets certifiedPreviewed (mirrors payer).
10. Substitute guide FAQ: doc number = SRC-YYYYMM-##### monthly company running number.

Verification: apps/api `pnpm test` exit 0; apps/web `pnpm test` 895/895; `tsc --noEmit` clean in both.
Pre-existing unrelated local failure seen once: web legal-content.spec ENOENT on untracked
`apps/web/public/legal/releases/v2/` (user's in-progress legal-review work) — passed on the final full run.
