# Agent Memory: e-tax-invoice-email-intake

Status: DRAFT — blocked on: BL2 (OCR unit recovery on early exits) review before P2.4; P1 scanner fix can ship first. Review rounds 1–4 + the focused check applied 2026-10-24 (BL1 closed; BL2 redesigned as v2, unreviewed — spec §19). Docs only (spec revision 6 + plan), no code, not deployed. Baseline main 6c54ba208 (worktree `expense-specs-20261023`, branch `claude/expense-specs-20261023`).

Owner: Expense lane (backlog #12 of `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`)

Scope:
- P1 **B1 security fix, ships alone**: bounded PDF scanner for all 6 callers — a bounded lexical tokenizer (strings, comments, NUL whitespace, `/Length` checked both ways) replaces the regex stream strip; refuse obfuscated names (`#xx` of letters/digits, any case); the existing `<script`/`<svg`/`javascript:`/`vbscript:`/`data:text/html` check stays and also runs on decoded string values; expand `/ObjStm` only with `zlib.inflateSync({ maxOutputLength })` under byte/count/depth/time caps; uninspectable = refused; no pdf-lib/pdfjs in the scanner
- P2 B2/B3 (PDF/A-3 + e-Tax XML under the `'receipt'` policy: receipts, capture groups, LINE receipts, email), verification at completion for every receipt PDF (one row per checksum + verifier + trust-store version, updated in place after `recheckAfter`), e-Tax XML read in the existing runner (0 AI calls, classification from TypeCode), B4 + B6 (observation + job state + outbox in one transaction), B7 (OCR admission recovery — blocker BL2)
- P3–P5 per-shop receiving address via Postmark inbound (Pro+ plan) → existing upload pipeline with resumable `ingestStep`; READ_QUEUED as one fenced transaction; atomic idempotent auto-intake slots; message status derived from its files, per-file byte purge; holds with a one-message human-acceptance override; trusted/blocked senders; Time Stamp pairing bound to issuer+document; one-person notifications re-checked with the shared expense-read predicate (delivery, list, unread count) and held mail in "ยังรออยู่"; LINE follow-up worded by the recipient's real actions; help pack v7 kept separate from v6
- P6 export column (contract registry), executive counters (test home = owner decision MC12), seed, journey, runbook, ROPA

Decisions:
- B1 first and independent; receipt-authenticity spec (C2PA) builds on the same `inspectAttachmentContent` and rebases on P1
- Scanner does not use pdf-lib (1.17.1 decodes only uppercase `#XX`; `DecodeStream` has no output cap) and does not use the regex strip `/>>\s*stream\b[\s\S]*?endstream/g` (a literal `(>> stream)` hides later dictionaries); it tokenizes per ISO 32000-1 §7.2–7.3; the active-URI check (`attachment.logic.ts:214`) is kept and applied to decoded strings (M-14 corpus row "javascript: URI in a pdf" keeps its message)
- **No issuer-authorization claim (F1/BL1)**: MR384 clause 12 limits electronic tax invoices to operators "on the Director-General's list"; we do not check that list (non-goal). `etaxEligible` means file properties only: VERIFIED + XMP `pdfaid:part=3` + exactly one ETDA XML (unique Filespec/stream identity) via `Catalog/AF` with `AFRelationship` = `Alternative` + eligible TypeCode + seller tax ID (or ETDA-TSA document timestamp). Wording "รูปแบบ e-Tax"; fact renamed `electronicOriginal` → `verifiedElectronicFile`; S17 "แนบไฟล์อิเล็กทรอนิกส์ที่ลงนามถูกต้องแล้ว"; no "ตัวจริง" anywhere; input-VAT right stays a human decision
- Verification rows: unique `[companyId, checksumSha256, verifierVersion, trustStoreVersion]`; first write `INSERT … ON CONFLICT DO NOTHING`; after `recheckAfter` passes, **update the same row in place** (CAS on `checkedAt`) + audit when status/eligibility changes; history = rows of older verifier/trust-store versions (P56/F4)
- Signer KeyUsage/EKU and TSA EKU (`id-kp-timeStamping`, critical) are checked; EKU allow-list lives in the trust manifest (confirm with real certs, MC14)
- Never use CMS `signingTime`; trusted time = verified RFC 3161 genTime; chain not established = `UNAVAILABLE` (not FAILED); wording says "could not verify"
- Full ByteRange validation; previous revision via trailer `/Prev`
- XML mapping (checked against the ETDA Rec.3 appendix example: line nets 52,350 + 10,700 = `LineTotalAmount` 63,050; header allowance 500; `AllowanceTotalAmount` 3,000 = 1,500 + 1,000 + 500; `TaxBasisTotalAmount` 62,550): percent → fraction; `subtotalAmount = LineTotalAmount`; `discountAmount` = header `SpecifiedTradeAllowanceCharge[ChargeIndicator=false]` sum (not `AllowanceTotalAmount`); header charges from `[ChargeIndicator=true]`; lines carry `unitPrice` only without a line allowance/charge
- Classification (F5): `readEtaxXml` returns `{ fields, classification }` built from TypeCode (388/T02–T04 → TAX_INVOICE, T05/T06 → ABBREVIATED_TAX_INVOICE, T01 → RECEIPT PAID, 380 → SUPPLIER_INVOICE_OR_BILL, 80/81/T07 → not applied); the runner passes `sourceDocumentType`/`ocrDocumentType` like the AI path (`runner :577-578`, `receipt-ocr-apply.service.ts:1017`)
- Wording: "รูปแบบ e-Tax" only when the read file is `etaxEligible && VERIFIED` at render time; otherwise neutral "ข้อมูล XML ในไฟล์"; stored texts always neutral
- Email ingest: LINE-order reservation, CAS `ingestStep`; READ_QUEUED = one fenced transaction + requestId `email-intake:<fileId>` + partial unique index — one read job and one OCR admission per file
- OCR admission recovery (B7/F2/BL2 v2 — existing bug on every lane): (1) `finish()` recovers the job's event by its unique key inside its transaction for **every** outcome, including early exits (`attempts_exhausted`, `ownerStillValid` → CANCELLED at runner :212, `source_changed`, unreadable file, PAUSED); (2) release/settle run inside the same `$transaction` as the fenced terminal write + outbox (tx variants `releaseCompanyOcrAdmissionTx`/`settleCompanyOcrAdmissionTx`, still fenced on event id) — a lost fence rolls back and compensates nothing, so a stale runner cannot refund an event the new owner uses; (3) on `duplicate` without an id, recover or re-admit once and persist fenced before the first provider call; a failed persist stops without compensating
- Auto-intake slots (F8): `autoSlotReservedAt` under `email-intake-auto:<addressId>:<intakeDay>` lock, idempotent, max 50; human-accepted files use no slot
- Message state (F7): derived from files in the same tx; per-file `dataPurgeAfter`; a message row (headers) is deleted only when no file is tied to an expense
- Duplicates (F6): the existing expense id/link is shown only to viewers who pass `canReadExpense`; otherwise S11t3
- Human acceptance (`acceptedByUserId`, `acceptedAt`) overrides hold reasons for that message once; never overrides security checks; `trustSender=false` keeps the sender untrusted
- Caps before storage under lock order company → address/day (200 msgs + 200 MiB per address/day, 20 msgs per untrusted sender/day, 500 MiB held bytes per company)
- Notifications reuse the read predicate extracted from `expense-draft.use-case.ts:225-241` for delivery, bell list and unread count; `expense.email_held` (ACTION, `inbound_email_message`) is registered in waiting-notification + document-notification-state so held mail shows in "ยังรออยู่" and leaves it on accept/discard (title S20r)
- LINE notice to members: S21b only with `expense.confirm`, S21c with `expense.update`, S21d otherwise
- Help card: new guide file + `V7_PRODUCT_HELP_CARDS`; v6 unchanged; card `requiredPermissions: ['attachment.create']` AND `permissionAnyOf` [upload, line_upload, email_intake.manage]; guide also states the provider retention (S27)
- Export (F10): `electronic_evidence_status` registered in `ACCOUNTANT_INDEX_COLUMNS` (full set only) with a Thai label; five values, none says "ตัวจริง"; placement in the cleanup workbook = MC15
- Retention wording (F11): "ลบภายใน 30 วัน" applies to our held copy only; Postmark's copy is disclosed separately (S27, ROPA)
- Whole-chain: scenario `email-document-line-follow-up` needs runnable evidence and its id appended to `EXPECTED_IDS`
- Postmark: inbound needs Pro+; Pro $16.50/10K, $1.30/1K overage (pricing page read 2026-10-24; plan-change article published 2025-08-06, updated 2026-03-26 — no effective date stated); Retention add-on is account-wide, published example on a 10K plan: 7 days = $45, 45 days = $0 (the page shows "Last updated" 2025-12-08); Raw Source keeps attachment bytes; Postmark-level blocking is per server → never used for one shop's blocks
- Tests: PG invariants in `company-tax-identity-migration.pg.spec.ts` (listed). Executive counter cases have **no compliant listed home** — the owner's rule covers new test cases, not only new files (P49) — so MC12 is an owner decision: (ก, recommended) allow the cases in the existing executive PG specs as an exception, or (ข) split executive counters out (then email receipts are not counted and confirmed email expenses count as "เว็บ")
- Kept: `OriginalRecipient` routing, `DKIM_VALID_AU`, no new `ExpenseRecord` columns, permission `expense.email_intake.manage`, no auto-reply, no email body stored, `expense.list_recent` unchanged, B5 not fixed

Unreviewed fixes from round 4 — BLOCKERS (spec §19):
- BL1 (F1, HIGH) — **CLOSED 2026-10-24 by the focused check** (labels/facts/exports describe file properties; issuer entitlement stays a human decision). Scenario: a seller not on the MR384 clause-12 list sends a correctly signed PDF/A-3 + ETDA XML + TypeCode 388 and got "e-Tax" + "ตัวจริง". Fix: wording/fact/export limited to checked file properties (above). Gate: a focused check reads MR384 clauses 12–19 and greps the three files for any remaining issuer/"ตัวจริง" claim; confirms auto-intake without the list check is acceptable. Blocks P2.5, P5.2, P6.1
- BL2 (F2, HIGH) — **OPEN, the named blocker before P2.4**. Scenarios: (a) crash after OCR admission before the first persist → resumed run gets `duplicate` with no event id → no release/settle; (b) focused check: admission → crash → primary file replaced → resumed job exits CANCELLED at `ownerStillValid` before recovering → unit leaks; (c) focused check: worker B recovers A's event and reads successfully, A loses its fence but releases the shared event first (release sits before `updateJobFenced`, runner :644-658) → B's read is free. Fix v2: decision above (recover on every exit; compensate only inside the fenced terminal transaction). Gate: a reviewer walks every exit of `execute()` and every two-runner interleaving on one requestId and confirms exactly one release or settle per admitted requestId, compensation only when the lease holder's terminal write commits, and no lock-order deadlock (`partner-ocr-config` → `ocr-quota`). Blocks P2.4 (AI path) and P3.3

Open questions (owner, with recommendation — spec §17):
- Q1 hold first non-e-Tax mail from a new sender then remember (rec.) · Q2 XML reads not counted in receipt quota (rec.) · Q3 keep Postmark default 45-day retention at launch, disclose it (S27, ROPA); revisit 7 days (~$45/month on a 10K plan) after MC3/MC4 (rec.) · Q4 all tiers (rec.) · Q5 `bill.mangmeeplus.com` (rec.) · Q6 creator as default handler (rec.) · Q7 30 days per file for our held copy (rec.) · Q8 accept Postmark inbound cost on Pro+ under the caps (rec.) · MC12 executive test home (ก) exception (rec.) or (ข) split out

Must close before coding (spec §18): MC1 real e-Tax files · MC2 `OriginalRecipient` envelope semantics · MC3 account plan + actual retention price · MC4 inbound volume · MC5 ETDA TSA identity · MC6 NRCA PEM fingerprints · MC7 scanner false-refusal corpus (incl. tokenizer, wrong-`/Length` files and every M-14 row) + `maxOutputLength` behaviour (gates P1 release) · MC8 dependency versions · MC9 owner approval of help pack v7 · MC10 ingress forwards Authorization · MC11 ROPA/processor appendix · MC12 executive test home — **owner decision** · MC13 LINE redelivery after DONE reaching `queueExpenseRead` · MC14 Thai CA document-signing EKU/KeyUsage · MC15 export column placement with the accountant-export-cleanup spec

Artifacts:
- `docs/specs/e-tax-invoice-email-intake-spec.md` (revision 5, §19 blockers)
- `docs/plans/e-tax-invoice-email-intake-plan.md`
- this file
- Review input: Codex reviews round 1 (F1–F32), round 2 (P1–P32 + F1–F17), round 3 (P1–P49 + F1–F13), round 4 (P1–P62 + F1–F12), scratch, not in git

Verification:
- Docs only; no tests/builds/servers run (no node_modules) — not run
- Code facts verified by reading files at baseline; external rules marked V/R/U in spec §5
- Verified in round 4: MR384 clauses 12–19 (Royal Gazette 2022-07-20, local copy of the rd.go.th PDF, sha256 5eaf5ffc…); `expense-capture-read-runner.service.ts:259-261, :478-488, :577-578, :644-656`; `company-ocr-governance.ts:247` and release/settle fencing on event id; `attachment.logic.ts:203-222`; M-14 corpus row :51; `receipt-ocr-apply.service.ts:1017`; `expense-document.logic.ts:367-395`; `waiting-notification.ts`, `document-notification-state.ts:16-60`, `prisma-notification.repository.ts:141`; `packages/contracts/src/expenses.ts:1731, :1802, :1877`; `executive-report-build.use-case.ts:105, :373, :401-404`; no executive spec in `apps/api/package.json`
- Unverified: real e-Tax files trigger B2; ETDA stamp structure/TSA; ETDA incremental update; `OriginalRecipient` semantics; zlib behaviour when the cap is exceeded; Thai CA EKUs; PDF reader repair of wrong `/Length`; whether the RD issuer list is machine-readable

Next:
- Review of BL2 v2 (spec §19) before P2.4, then clear the status line
- Start P1 (one lane) now; release after MC7
- Owner answers Q1–Q8 and MC12; controller closes MC1–MC6, MC8, MC13–MC15; ops MC2/MC10 with cloud approval

## Review 2026-10-24 (round 1: Codex F1–F32 → where applied)

| F | Sev | Fix | Where |
|---|---|---|---|
| F1 | HIGH | `etaxEligible` separated from signature validity | spec P1/P2, §6.6, §9.4, §10.2, A3b |
| F2 | HIGH | no `signingTime` | spec R19, §9.4, A4b |
| F3 | HIGH | full ByteRange rules | spec §9.4, §14 |
| F4 | HIGH | B1 current security bug; separate first step | spec §1.3, §10.5, §13 B1, A0; plan P1 |
| F5 | HIGH | pairing bound to issuer+document | spec §9.3, A5b |
| F6 | HIGH | resumable `ingestStep` | spec P7, §7.5, A13b |
| F7 | HIGH | B4 atomic `finish()` | spec §7.4, §13 B4, A25 |
| F8 | HIGH | `targetBranchId` persisted in accept tx | spec §7.3, A16 |
| F9 | HIGH | parser wrapper with fixed diagnostics | spec §7.2 |
| F10 | HIGH | caps before storage | spec §7.2, A12b |
| F11 | HIGH | access re-check at delivery and bell read | spec §8, A22b |
| F12 | HIGH | `infra/postmark/config.py`/tests/preflight | spec §7.6; plan 3.1 |
| F13–F15 | MED | Postmark Raw Source / account-wide retention / inbound volume | spec R15b–d |
| F16–F17 | MED | `/Prev` boundary; 48 h product decision | spec R20, R8b, §9.3 |
| F18–F21 | MED | eligibility perms; provenance reset; source-aware text; manifest+observation | spec §4, §7.4, §6.7 |
| F22–F25 | MED | receipt policy; one notification identity; member-held to member; tab gate | spec §10.5, §11, §8 |
| F26 | MED | descoped `expense.list_recent` | spec §3 |
| F27–F29 | MED | executive counters; help pack v7; listed PG spec | spec §11, §14 |
| F30–F32 | LOW | Prisma preview note; citation; branch default | spec §6.2, §1.3, §1.5 |

## Round 2 (2026-10-24)

Second review: 21/32 resolved, 11 partly, 17 new (3 HIGH). Applied:

| Item | Sev | Fix | Where |
|---|---|---|---|
| F1 (pdf-lib uppercase-only `#XX`) | HIGH | scanner refuses obfuscated names itself (any case) before any structural reading; no pdf-lib in scanner | spec R24, §10.5 step 1, §13 B1, A0; plan 1.1 |
| F2 / P4 (unbounded decode, null = pass) | HIGH | bounded `zlib` ObjStm expansion (8 MiB/stream, 32 MiB total, 2,000 ObjStm, depth 64, 2 s); uninspectable = refused (P8); S18b/S18Lb | spec R23, P8, §10.5, A0b; plan 1.1–1.2 |
| F3 / P6 (READ_QUEUED recovery) | HIGH | `readJobId` stored with READ_QUEUED; recovery uses `findAnyJobForAttachment` (any status); existing LINE path → MC13 | spec §6.4, §7.5, A13b; plan 3.3 |
| P1 / F4 (PDF/A-3 profile) | MED | eligibility requires `pdfaid:part=3` + `/AF` attachment profile; full PDF/A validation non-goal | spec §3, §9.4, A3c |
| F5 (cert purpose) | MED | signer KeyUsage/EKU + TSA EKU checks; `CERT_PURPOSE_INVALID` | spec R22, §9.4, S13e, A3d; MC14 |
| F6 (subtotal/allowances) | MED | `subtotalAmount = LineTotalAmount`; header vs line allowances; charges (allowance source corrected in round 3) | spec §6.7 |
| F7 (rate units) | MED | percent → fraction | spec R3b, §6.7 |
| F8 / P11 (notification predicate) | MED | reuse read predicate from `expense-draft.use-case.ts:225-241` | spec §8; plan 5.1 |
| F9 / P28 (v7 vs v6) | MED | new guide file + `V7_PRODUCT_HELP_CARDS`; v6 untouched | spec §11; plan 5.3 |
| F10 / P10 (company byte cap) | MED | company lock before address/day lock | spec §7.2; plan 3.2 |
| F11 (capture-group completion) | MED | `'receipt'` policy at `expense-capture-group.use-case.ts:527` | spec §10.5, A18b; plan 2.1 |
| F12 (supporting files) | MED | verification at completion for every receipt PDF | spec §7.4; plan 2.4 |
| F13 (observation swallowed) | MED | new B6; observation inside `finish()` tx | spec §1.4, §13 B6, A25; plan 2.4 |
| F14 / P14 / P15 (pricing) | MED | current Postmark pricing; Pro+ required | spec R15c–d, Q3, Q8, MC3 |
| F15 (provider blocking scope) | MED | never translate one shop's block into a Postmark rule; note: Postmark says blocked messages do **not** count toward usage (verified), so the coordinator summary "still counts" was not adopted (coordinator confirmed in round 3) | spec R15e, §3, §16 |
| F16 (chain wording) | MED | `CHAIN_NOT_ESTABLISHED` = UNAVAILABLE; S13g "could not verify" | spec §9.4, §10.2–10.3, A4c |
| F17 (executive test file) | LOW | no listed executive spec → MC12 (home chosen in round 3) | spec §14, §18 |
| P24 / P25 (LINE-only members) | MED | tab gate includes `canForwardEmail`; S20c via LINE handoff link | spec §8, S20c, A10b; plan 4.1 |
| P31 (stale :427) | LOW | cite §12 G3 without line number | spec §1.3 |

## Round 3 (2026-10-24)

Third review: 41/49 resolved, 8 partly (P1, P4, P6, P14, P35, P36, P38, P49), 13 new (2 HIGH). Applied:

| Item | Sev | Fix | Where |
|---|---|---|---|
| F1 / P4 (regex stream strip retained) | HIGH | bounded lexical tokenizer replaces `attachment.logic.ts:203` regex: literal strings (nesting, escapes), comments, NUL whitespace, depth cap, `/Length` direct/indirect, wrong `/Length` inspected both ways, unbalanced = refused; tokenizer reused on expanded ObjStm | spec §1.3, §10.5 step 0, §12 G13, §13 B1, §14, A0c, §16; plan 1.1, decision 1 |
| F2 / P6 / P35 (overlapping workers) | HIGH | READ_QUEUED = one transaction: `FOR UPDATE` file row, fenced lease, `findAnyJobForAttachment(tx)`, `createReadJob(tx)` with requestId `email-intake:<fileId>` (not `queueExpenseRead`'s `randomUUID()`), store `readJobId`, commit, kick; partial unique index on `ExpenseCaptureReadJob` as second guard | spec §1.4, §6 bullet, §7.5, §11, §14, A13c; plan 3.1, 3.3, decision 6 |
| F3 (acceptance vs `trustSender=false`) | MED | durable one-message override (`acceptedByUserId`, `acceptedAt`) with a per-hold-reason table; security checks never overridden; acting user re-checked | spec §6.4, §7.3, §9.2, §14, A16b; plan 4.2, decision 19 |
| F4 / P38 (`AllowanceTotalAmount`) | MED | discount = header `SpecifiedTradeAllowanceCharge[ChargeIndicator=false]` sum; ETDA example 63,050 − 500 = 62,550 in tests and acceptance; memory decision corrected | spec R3c, §6.7, §14, A3; plan 2.3, decision 10 |
| F5 / P1 / P36 (`AFRelationship`) | MED | `Alternative` only for the XML representation (ETDA Rec.11 §5.2.1(4.1)) | spec R6, §9.4, §14, A3c; plan 2.3, decision 22 |
| F6 (double counting Names + AF) | MED | count unique Filespec / embedded-stream identities; orphan embedded stream refused | spec §9.4, §10.5 B2, §14; plan 2.1, 2.3 |
| F7 (verification cache) | MED | `trustStoreVersion` in the unique key, `recheckAfter`, usable-row rule, recompute → new row | spec §6.6, §7.4, §14, A26; plan 2.2, 2.4, decision 21 |
| F8 (e-Tax wording on unverified XML) | MED | S14/S14b/S25 only when eligible + VERIFIED at render; neutral S14n/S14bn/S25n otherwise; stored texts neutral | spec §6.7, §10.2, §10.3, §14, A3c; plan 2.4, 2.5, 5.2, decision 20 |
| F9 (S21b confirm wording) | MED | S21b/S21c/S21d by `expense.confirm` / `expense.update` / neither, same rule as `line-expense-action.service.ts:1009-1012` | spec §10.2, §10.3, §14, A27; plan 5.2, decision 23 |
| F10 (help-card permission model) | MED | single S24 card: `requiredPermissions: ['attachment.create']` AND `permissionAnyOf` of three; LINE-only forwarders included | spec §10.3, §11, §14; plan 5.3 |
| F11 (unread count) | MED | `GetUnreadCountUseCase` uses the same guard; failing recipients system-dismissed | spec §8, §11, §14, A28; plan 5.1 |
| F12 (catalog fixed ids) | MED | append id to `EXPECTED_IDS`; evidence must be a test run by `LINE_AI_WHOLE_CHAIN_SUITES`; mutation assertion matches the :70 pattern | spec §11, §14; plan 5.3 |
| F13 (pricing date) | LOW | article publication 2025-08-06 vs update 2026-03-26; no effective date asserted | spec R15d; this file |
| P14 (retention price) | MED | published example on a 10K plan: 7 days $45, 45 days $0; Q3 recommendation changed to keep 45 days at launch with disclosure; MC3 keeps the account quote | spec R15c, Q3, MC3 |
| P49 (executive test home) | LOW | chosen: existing `executive-report-build.pg.spec.ts` / `executive-report-read.pg.spec.ts`; not added to the whole-chain PG suite because its runner only sets `AI_BUDGET_RESERVATION_TEST_DATABASE_URL` (silent skip) | spec §14, §18 MC12; plan 0.6, 6.1, decision 16 |

## Round 4 (2026-10-24)

Fourth (last full) review: 60/62 resolved, P49 unresolved, P56 partly, 12 new (2 HIGH). Applied; the two HIGH fixes are unreviewed → blockers BL1/BL2 (spec §19):

| Item | Sev | Fix | Where |
|---|---|---|---|
| F1 (issuer list, MR384 cl.12) | HIGH → BL1 | primary source re-read (cl. 12–19); no issuer/"ตัวจริง" claim; "รูปแบบ e-Tax" wording; fact renamed `verifiedElectronicFile`; S17 rewritten; export values neutral | spec intro, §2, §3, R1, R12, §5 P2, §9.4, §10.2–10.3, §11, §12 G15, §16, A29, §19; plan 2.4, 2.5, decision 3 |
| F2 (OCR admission recovery) | HIGH → BL2 | new existing bug B7; recover event id by unique key on `duplicate`, persist fenced before provider, four runner cases | spec §5 P9, §7.4 3b, §11, §13 B7, §14, A30, §19; plan 2.4, decision 24 |
| P49 (executive test home) | — | not compliant: the rule covers new test cases; MC12 is now an owner decision (ก exception, recommended / ข split out); round-3 "chosen" note superseded | spec §14, §18 MC12; plan 0.6, 6.1, decision 16 |
| P56 / F4 (verification key vs new row) | MED | one row per key: insert `ON CONFLICT DO NOTHING`, update in place (CAS `checkedAt`) after `recheckAfter`, audit on change | spec §6.6, §14; plan 2.2, 2.4, decision 21 |
| F3 (active URI check) | MED | keep `javascript:`/`vbscript:`/`data:text/html`/`<script`/`<svg` check, also on decoded strings; M-14 rows unchanged | spec §10.5 2b, §14, A31; plan 1.1, MC7, decision 25 |
| F5 (sourceDocumentType) | MED | XML returns classification; runner passes `sourceDocumentType`/`ocrDocumentType` + observation classification | spec §6.7, §7.4, §9.4, §14, A32; plan 2.3, 2.4 |
| F6 (duplicate access) | MED | existing expense id/link only for `canReadExpense`; S11t3 otherwise | spec §7.1, §7.5, §10.2–10.3, §14, A33; plan 3.3, decision 28 |
| F7 (message state, per-file expiry) | MED | message status derived from files; `dataPurgeAfter` per file; message headers kept while a file is tied to an expense | spec §6.3–6.4, §7.5 step 5, §9.2, §17 Q7, A34; plan 3.1, 3.3, decision 26 |
| F8 (auto slots) | MED | `autoSlotReservedAt` under an address/day lock, idempotent; concurrency test | spec §6.4, §7.5, §9.2 rule 4, §14, A35; plan 3.3, decision 27 |
| F9 (waiting notices) | MED | `expense.email_held` registered in waiting-notification + document-notification-state; S20r finished title | spec §10.2–10.3, §11, §14, A36; plan 5.1 |
| F10 (export registry) | MED | `electronic_evidence_status` in `ACCOUNTANT_INDEX_COLUMNS` (full only) + Thai label + five values; MC15 coordination | spec §11, §14, A37, MC15; plan 6.1 |
| F11 (30-day promise) | MED | S12 limited to our held copy; S27 provider retention in guide + ROPA | spec §10.2–10.3, §16, Q7; plan 4.3, 5.3, decision 29 |
| F12 (retention page date) | LOW | cite the page's "Last updated" 2025-12-08 only | spec R15c; this file |

## Focused check (2026-10-24, after round 4)

| Item | Result | Fix | Where |
|---|---|---|---|
| BL1 (F1) | CLOSED | — | spec §19 |
| BL2 (F2) | STILL OPEN → v2 | recover the event on every exit inside `finish()`; release/settle inside the fenced terminal transaction; failed persist stops without compensating; test cases (e) early-exit CANCELLED and (f) stale-runner interleaving + PG case | spec §7.4 3b, §11, §13 B7, §14, A30, §19; plan 2.4, decision 24 |
