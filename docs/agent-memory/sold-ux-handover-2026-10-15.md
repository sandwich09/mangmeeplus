# Agent Memory: sold UX — payment preparation / voucher round (2026-10-15)

Status: built and on the local trial; branch `claude/sold-ux-program-20261013`, not pushed, not deployed.
Owner: the shop owner (live UI session); controller Claude; implementation Codex lanes Q and T.
Scope: create/edit voucher form, payee picker, account field and reveal right, supporting files, signatures and layout of the voucher PDF, hiding unpayable bills in preparation.
Decisions (owner, 2026-10-15):
- One `ส่งอนุมัติ` button; the dialog's confirm label is always `ส่งอนุมัติ` (the radio says who).
- Other-name bills come through a dialog; pressing its add button is the confirmation (sentence in the footer).
- Whoever may edit a DRAFT voucher may reveal its full account number (audited); prefilled accounts from a voucher the preparer can read too. Spec items 9 and §data updated.
- Signatures: each person's saved signature, only at their own press, snapshotted; payee signature column only for cash/card/other.
- Pay button without ฿ or amount.
- PDF: header with fact box, grey payee box, banded table, totals box, signatures anchored low; no footer on one page, `หน้า x/y` only on several pages; the hash is stored, not printed (spec item 15 updated).
- A bill that cannot be paid is never listed in preparation (payees count only payable bills; a reopened draft drops unpayable saved lines and says which).
Open questions: optional "Payment Voucher" subtitle (offered); push/PR/release.
Verification: web expenses + common specs green; API expenses specs green; real-database specs green after the signature migration; journeys 67/68 in the full run (one load timeout) then the voucher journeys 4/4 on each later change; PDF round tested document-only at the owner's word (44 PDF tests).
Next: wait for the owner's review of the PDF on the trial.
