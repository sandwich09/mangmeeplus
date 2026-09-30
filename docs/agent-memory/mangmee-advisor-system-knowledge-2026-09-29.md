# Agent Memory: mangmee-advisor-system-knowledge

Status: R1 in progress (started 2026-09-30). Spec and plan refreshed against develop `05f7f675` on `claude/advisor-system-knowledge-plan-20260929` (docs PR #908). No R1 code yet.
Owner: Thawatchai.
Scope: R1 slices S0 (measure the G set, fix only failures), S2a (package and receipt quota), S1 (substitute receipts to sign, plus my pending work), S3 (reimbursement backlog) and S8 (deterministic LINE card buttons and links). Spec `docs/specs/mangmee-advisor-system-knowledge-2026-09-29-th.md`, plan `docs/plans/mangmee-advisor-system-knowledge-plan-2026-09-29-th.md`.
Decisions (Owner, 2026-09-29 and 2026-09-30; spec section numbers in brackets):
- Sales and stock modules are unfinished: keep the fixed "not in your package" reply, never upsell them (2.2).
- No feature switches or env flags; new tools are always on once merged (2.8).
- General business knowledge is always answered; non-business questions get a short answer plus one shop line (already live since #910).
- LINE may give receipt reads left, AI credit left, the package end date and the next credit top-up date; never prices (10.1).
- Package and credit figures only for holders of the package-manage permission (owner included); everyone else gets the standard "ask the owner" reply (10.2).
- Package and credit questions spend AI credit like any turn; no free path (10.3).
- Never name or recommend another package or an upgrade; say "likely enough" or "short by about N" from this cycle's rate (10.4, 4b).
- "No phone" counts every member (ACTIVE and INVITED, owner included); answers may give counts, who has a phone with the number, and who has none (10.5).
- Employee name, phone and email are answered to holders of the employee-read permission in 1:1 chat; group chats read no shop data; ID-card numbers never; counterparty tax IDs and phones unchanged for now (10.6).
- Employee and counterparty lists follow web visibility, limited to the branches the asker is responsible for (10.7).
- Claims several people can approve form a separate shared pile counted for no one; confirmed knowing role routing puts all such claims there (10.9).
- Backlog visibility follows web permissions; regular staff see only where their own claims wait (10.10).
- "วันนี้มีอะไรต้องทำ" (Q1) stays on the single-tool daily-closing fast path; the signature and approval queues join "มีอะไรค้างที่ฉันต้องทำ" (Q2) only (4.2).
- Purchase buttons only for purchase-right holders; others get a short "tell the owner" sentence. The public-policy FAQ card gets a contact-staff button instead of the package link. Both fixes plus the employee-list link ship with R1 as S8 (2.2, 11.17).
- S2b (AI credit balance) ships with add-on credit sales; E9 is not pulled forward. Manager buttons go to the package page until then.
- Work and test release by release ("รันทดสอบก่อนดีกว่า ทำเป็นชุดๆ"); R1 real-model budget is capped at 800 THB for S0, S2a, S1 and S3; S8 needs none (10.11).
- Not decided yet: 10.8 (anomaly thresholds) and 10.12 (who reviews new guide cards), to be asked before R3/R4.
Open questions: none yet.
Artifacts: none yet.
Verification: none yet.
Next: implement R1 (S0, S2a, S1, S3, S8) per plan section 3; run each slice's real-model set within the 800 THB R1 cap and track spend after each slice.
