# Agent Memory: seed-claim-approval-2026-10-04

Status: seed fix committed on `claude/seed-claim-approval-20261004` (from develop f1d500a8a), not pushed.
Owner: Claude lane (owner report on release candidate main b721e1b4d: "ทำเบิกจ่าย เซ็นผู้เบิกแล้ว ไปต่อผู้อนุมัติ ยังไง").
Scope: `apps/api/prisma/seed.ts` only (the sample claim RB-LOCAL-0001). Product wording found on the way is listed below for a Codex lane, not changed.

Decisions:
- Cause: the seed wrote RB-LOCAL-0001 as PENDING_APPROVAL without what submit writes (no `currentApprovalStepId`, no route or
  `assignedApproverUserIdsJson`, no policy snapshot, hash `seed-rb-approval`). No current step = nobody eligible: approve answered
  403 `not_eligible_approver` to Local Owner, qa.owner and qa.manager; withdraw answered 409 `reimbursement_changed`
  ("คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง"); the page still read "รอ Local Owner อนุมัติ" and
  "ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน ...". Not a state the real flow produces.
- Fix: the sample is a never-sent draft of Local Owner (no number, no step). A faithful pending claim is not seedable: the
  default policy requires a receipt and the seed writes no files. Existing claims are left alone (`update: {}` on the claim and
  its line), so re-seeding never undoes what someone did with the sample; only the old stuck state (PENDING_APPROVAL with no
  current step) is turned into the same draft, and its seeded step and signatures are removed.
- Real routing in the demo company (policy MANAGER, self-approval off): every claim, the owner's own included, goes to the
  MANAGER holders (ศิริพร ผู้จัดการสาขา, ไนซ์); the frozen assignment denies the owner. The owner approves only where OWNER is a
  policy role or no MANAGER holder exists (Bloom Beauty Clinic: owner fallback).

Open questions (product wording, for a Codex lane; not changed here):
- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx:1074` policy hint "เมื่อเปิด ผู้อนุมัติที่ได้รับมอบหมายสามารถอนุมัติใบเบิกที่ตัวเองสร้างได้":
  OWNER/ADMIN/MANAGER approve their own claim with the switch off (role exemption, audit `selfApproval.via: role_exemption`), and
  those are the three roles the picker offers. The user guide (`reimbursement-guide.content.ts:939`) says it correctly.
- `ReimbursementDetailSections.tsx:893` "ผู้เบิกและผู้อนุมัติเป็นบุคคลเดียวกัน อนุมัติรายการของตนเองตามนโยบายบริษัท" also shows when
  the company switch is off and the role exemption allowed it.
- `reimbursements.model.ts:235-240` one sign button reads "ลงนามใหม่" while the ผู้อนุมัติ block is unsigned (requester who signed
  before approving their own claim); the step card says "คุณยังไม่ได้ลงนาม กดลงนามในใบเบิก". As specified in
  `docs/specs/reimbursement-step-journey-spec-th.md:280`; an owner decision on the words.
- Minor: approval-steps row "ขั้นที่ 1 รอตัดสิน —" for a role-routed step (`ReimbursementDetailSections.tsx:971`); pay-step note
  "บันทึกจ่ายเต็มจำนวน ระบุวิธีจ่าย วันที่ และเลขอ้างอิง" omits the transfer slip (`reimbursements.logic.ts:1311`); hub row
  "ตรวจบัญชีและส่งอนุมัติ" on a draft with no receiving method (`reimbursement-payout.logic.ts:411`).

Artifacts: lane scratch `stalee2e/rb-shots/` (screenshots 390/1280, `*-facts.json`), logs `seedfix-verify.log`, probes `p-rb-*.spec.ts`.

Verification (own throwaway stack, fictional data):
- Old seed + owner signs the sample: PENDING_APPROVAL, no current step, 1 seeded step, 1 signature; approve 403 x3, withdraw 409.
- Fixed seed over that database: DRAFT, no number, 0 steps, 0 signatures; again: unchanged (same updatedAt).
- Sample through the real flow (receipt + cash, send, sign, qa.manager approves, owner pays): RB-202610-00001 PAID; fixed seed again:
  claim, step, signature and payment untouched.
- Fresh database from the fixed seed: DRAFT; e2e `responsive.spec.ts -g "/reimbursements — INV-7"` 2 passed 2 skipped (by design) rc 0,
  `evidence.spec.ts -g "/reimbursements — INV-11 every card"` 2 passed rc 0; real flow to PAID passes. `git diff --check` rc 0.

Next: push and PR when the controller decides; the owner's own database gets the fix on its next seed run.
