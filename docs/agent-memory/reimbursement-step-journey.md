# Agent Memory: reimbursement-step-journey

Status: DESIGN APPROVED 2026-09-19 — spec + plan + 9 mockup artboards; owner confirmed D1–D5 and A1, A2, A4; READY for Phase 1 on owner's go; NO code changed
Owner: Fable session 2026-09-19 (design); implementer TBD
Scope: Make the reimbursement journey step-based on one page per claim (like the substitute-receipt wizard), requester + approver only by default, solo-owner friendly. No state-machine, status, permission-key, or table changes.
Decisions:
- Owner 2026-09-19 (verbatim intent): approver can pay directly (D1); keep finance review as a switch but default OFF (D2); claim form signatures = 2 (requester, approver) (D3); PERSONAL_ADVANCE substitute receipts must be able to create a claim (D4); LINE stays read-only with a link to act on web (D5).
- A1 (migration flips existing stored policies' financeReviewRequired to false) and A2 (approver roles also get payment.void) CONFIRMED by owner 2026-09-19. A3 approverMode default stays MANAGER (OWNER fallback already covers solo owners).
- A4 (CONFIRMED by owner 2026-09-19; from owner question "อัปโหลดแบบกระดาษที่มีลายเซ็นแล้ว ระบบยอมรับว่าผ่านไหม"): TODAY the signed-copy upload (LinkSignedClaimFormCopyUseCase, purpose reimbursement.claim_form.signed) is archive-only — no status change, signature slots stay ยังไม่ลงนาม, no ink verification, allowed once the claim has a requestNo for requester / finance_review / payment.record holders. PROPOSAL: uploading a complete paper-signed copy with one declaration marks the document step done, slots show ลงนามบนกระดาษ, detail gains documentSignedVia DIGITAL|PAPER|BOTH, checksum in audit, no second reviewer (unlike the substitute receipt PAPER route), printed form never draws fake signatures.
- Steps are a projection of existing statuses: 1 รายการที่จ่ายไป (DRAFT) → 2 อนุมัติ (PENDING_APPROVAL/APPROVED) → [3 ตรวจการเงิน only when the claim's snapshot has financeReviewRequired] → 4 จ่ายเงินคืน (READY_FOR_PAYMENT) → 5 เอกสาร (PAID). Computed client-side from currentDesk()/timeline; numbering re-counts per claim.
- Permission change: ADMIN + MANAGER + pack.reimbursement.approve gain reimbursement.payment.record and reimbursement.payment.void; supersedes team decision 2026-07-28 "paying stays FINANCE-only". duplicate.resolve / finance_review not widened.
- Claim form: 2 signature blocks + a text line for the repayment facts; same person signs once → both REQUESTER and APPROVER rows (web calls sign per eligible role, no endpoint change); legacy claims with FINANCE_REVIEW/PAYER signature rows keep the 4-block layout.
- Substitute → claim: the source picker already accepts PERSONAL_ADVANCE ISSUED certificates with a linked payer (reimbursement-source.ts); the work is only the entry button on the wizard done step + hub row and `?expenseId=` preselection on the create page.
- Links: every per-claim deep link → /companies/:id/reimbursements/:requestId (the route exists today as a redirect into the hub drawer); hub `?focus=` redirects to the journey page; event actor is excluded from that event's notification recipients (kills self-notifications for solo owners).
Open questions:
- None. All decisions and assumptions confirmed.
Artifacts:
- docs/specs/reimbursement-step-journey-spec-th.md
- docs/plans/reimbursement-step-journey-plan-th.md
- Mockup canvas (Design artifact, 9 artboards): https://claude.ai/artifact/LwzxaVUEkTZ4fev47YmJrM
- Evidence gathered from: reimbursement.logic.ts (transitions, SELF_APPROVAL_EXEMPT_ROLES, currentDesk), reimbursement.constants.ts defaults, permission-registry.ts (ADMIN 541+, MANAGER 644+, FINANCE 766+), capability-pack.registry.ts (pack.reimbursement.*), claim-form.logic.ts (4 blocks at 155-158), reimbursement-source.ts (PERSONAL_ADVANCE eligibility), workflow-template-catalog.ts (reimbursementHubLink), workflow-action-runner.use-case.ts (sourceWebPath), SubstituteReceiptWizardPage.tsx 2436/2637-2659, ThemedSteps.tsx
Verification:
- None run (design only). Plan lists the commands per phase.
Next:
- On owner's go: Phase 1 (schema default flip + migration, constants, permission registry + pack, permission-matrix.md, policy UI copy), then Phase 2 (journey page). Phase 3 carries the 2-signer form + paper route (A4). Use a fresh branch per parallel-sessions memory; run the plan's verification commands per phase.
