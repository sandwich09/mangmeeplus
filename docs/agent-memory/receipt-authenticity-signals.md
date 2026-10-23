# Agent Memory: receipt-authenticity-signals

Status: READY (docs-first) — reviewed 4 rounds 2026-10-24, no HIGH open; see ต้องปิดก่อนเขียนโค้ด (spec §18, MC1–MC13). Round 4 (the last review) confirmed the round-2/3 HIGH fixes (C2PA assertion parsing and action-template semantics) and raised only MEDIUM/LOW items, all applied. Docs only, no code. Owner answers Q1–Q3 pending — none blocks Phase D, 1, 2a or 2b.
Owner: Expense/Reimbursement lane
Scope: backlog #8 (`docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`) — "ข้อสังเกตเอกสาร": warn-only signals that a receipt or transfer slip may be AI-generated or edited, shown to people with decision authority (expense reviewers/confirmers, claim approvers by current permission or frozen assignment, finance/payers, full readers) on web and on the LINE approve/confirm card. Not shown to uploaders who lack decision authority; an uploader who also holds decision authority (solo owner, accountant filing own claim) sees and may record checks, and the history marks them "(ผู้ส่งเอกสาร)". Never blocking, tenant-only, zero new AI cost, no outside service. Baseline main 6c54ba208.

Decisions:
- No AI judge, no pixel forensics: AIForge-Doc GPT-4o AUC 0.509 (Feb 2026, arXiv 2602.20569) and AIForge-Doc v2 with GPT-Image-2 forgeries — humans 0.501, TruFor 0.599, DocTamper 0.585, the model judging its own forgeries 0.532 (never above 0.59), versus 0.962/0.852 on conventional tampering (Apr 2026, arXiv 2604.25213); DOCFORGE-BENCH. Arithmetic is the dominant AI-receipt cue (GPT4o-Receipt) and the API already computes `ITEMS_DID_NOT_RECONCILE`.
- Codes v1 (spec §6.3): FILE_SAYS_AI STRONG — only from parsed C2PA (active manifest, all `c2pa.actions(.v2)` instances, the EFFECTIVE `digitalSourceType` of each recorded action per §18.15.6.1: `"*"` template, then same-name templates in order, then the action's own value wins; templates never create actions; related[] actions per §18.15.8 inherit the parent's effective values and override with their own, bounded recursion; value = IPTC URI, or `c2pa.ai-disclosure` with `modelType`; C2PA 2.4 §18.15/§18.28 read 2026-10-24: ai-disclosure only describes AI use) or XMP `Iptc4xmpExt:DigitalSourceType` value equality; never a byte search, so captions/custom metadata quoting the URI never fire. FILE_NAMES_TOOL — EXIF Software/ProcessingSoftware, XMP CreatorTool/softwareAgent, PNG Software, PNG generator keys only when the content has the tool's structure (WebUI infotext fields / ComfyUI JSON), PDF producer/creator; MEDIUM for AI tools, WEAK for editors. FIGURES_DONT_ADD_UP and SELLER_TAX_ID_INVALID MEDIUM, tied to the actually-read, non-stale file. Phase 4 SLIP_QR_INVALID / SLIP_REF_REUSED (OCR-independent; REUSED counts any ACTIVE evidence file with the byte-exact same key, regardless of the other record's closed state) and SLIP_REF_MISMATCH (read file + proven banks only; compare after removing whitespace/zero-width only), all STRONG. `slipRefKey` keeps transRef byte-exact (no case folding — SCB examples are mixed-case and no equivalence is documented).
- File facts on `AttachmentObject.fileSignalsJson`, written only by `CompleteAttachmentUploadUseCase`. Eligible files: expenses = the `loadExpenseEvidenceSources` list (covers pinned projection evidence); claims = the pinned `sourceExpenseSnapshot.attachments` with matching checksum (never live linked-expense evidence). One claim rule: group C and SLIP_REF_MISMATCH only while `expense.updatedAt == snapshot.expenseUpdatedAt` AND the live non-stale read file is in the snapshot with matching checksum; otherwise none of them (incl. SELLER_TAX_ID_INVALID). SLIP_REF_MISMATCH compares the OCR output bound to the read file (`recognizedFields.documentNumber`, `classification.documentKind`), never user-editable fields; UI says "ที่อ่านได้" only for OCR output and "ที่บันทึก" for recorded values. Exclusions only by server-written relations; caller-settable `metadataJson` never exempts anything. Read file respects `sourceStale` — no group C after a replaced primary until re-read.
- Reviews in `DocumentAuthenticityReview` keyed (company, target, attachment, code, factsHash). Review transaction first takes `lockFundingEvidence` on the file, every company file with the same `slipRefKey`, and their expenses (the same lock attachment soft-delete takes), then locks the target row (`SELECT … FOR UPDATE`, plus linked expense rows when live facts are used, in the existing lock order); re-reads target status/revision and the file's ACTIVE/eligible state after the locks; never touches `updatedAt`. Idempotent semantics: open → write; already reviewed with the same factsHash → success, no write; anything else → 422, nothing written.
- One closed-target policy: expense REJECTED/VOIDED, claim REJECTED/CANCELLED/VOIDED.
- Claim authority reuses `approvalDecisionActions` (POST guarded like approve).
- Card in every expense layout incl. source-only; shows every open signal; expense page hides its duplicate tax-ID audit row when the card shows it.
- LINE: the notice lives in `authenticityNotice` on the stored action and is stripped from the `expense.action.preview` tool result, so it never reaches the gateway composer.
- Web re-encodes JPEG/PNG > 6 MB, HEIC/HEIF, GIF and mismatched files — no metadata signals for those uploads (G13).
- Parser synchronous and bounded (best-effort, measure event-loop delay); jsQR in a terminable worker. Only new dependency: `jsqr` 1.4.0 (Phase 4). CBOR reader written in-house, decodes all major types incl. bool/null/undefined/half-single-double floats/tags, with depth/size bounds.
- PDF metadata is read only after `PDFDocument.load(bytes, { updateMetadata: false })` (pdf-lib's default overwrites Producer).
- LINE photo OCR summaries must store `extractionAttachmentId` (plan D-P1) before Phase 2; no fallback to the primary file. Dialog: refusal 404 `authenticity_attachment_not_on_target` with reload; the typed note survives a reload; buttons back-out first, act last (on top when stacked).
- Originals are not guaranteed to exist (Accounting Act §15 lost-document duty): hints offer "original OR issuer copy"; lost originals → existing substitute-receipt flow (help text only). The tax-ID checksum helper is already used on expense web, counterparty web fields and the LINE counterparty card — but never reaches claim approvers.
- No bank/aggregator API. SCB's found endpoint states it supports slip verification of QR 30 payments with partner credentials; whether it or any other bank's API can serve our claims is unverified. OpenAI offers a public Verify tool (research preview) for its own images; we deliberately call no outside service.
- Help text: first freeze v6 as the approved fallback (the selector currently falls back to v4), then a DRAFT successor through owner review (Phase H). No record-specific observation ever reaches น้องมั่งมี.
- Entitlement: starter keys `expenses.evidence` + `reimbursement` → all four sold tiers; no switch. W00 regenerate required. Whole-chain: add the approval preview spec to `reliability-api-v2`, no new scenario row.

Open questions:
- Q1 (owner): tell the uploader? Recommended: no in v1.
- Q2 (owner): buy a paid slip-verification service? Recommended: not now; revisit above ~20 slip signals/month.
- Q3 (owner): put signals/review in the accountant export? Recommended: no.
- Must close before coding (spec §18): MC1 LINE card source (stored entry vs gateway payload); MC2 claim↔expense lock order (incl. `lockFundingEvidence` first); MC3 c2patool fixtures incl. ai-disclosure/brob/templates; MC4 WebUI infotext format from source; MC5 bank printed-ref fixtures; MC6 QR after LINE compression; MC7 internal completion callers pass the uploader ctx; MC8 `snapshot.totals.grandTotalAmount` across snapshot versions; MC9 whether C2PA mandates definite-length CBOR; MC10 every read path stores `classification.documentKind` + `recognizedFields.documentNumber`.
- MC11 every evidence-link write holds `lockFundingEvidence`; MC12 whether same-name templates apply to related actions (v1: no); MC13 every LINE_UPLOAD summary write stores `extractionAttachmentId` after D-P1.

Artifacts:
- docs/specs/receipt-authenticity-signals-spec.md
- docs/plans/receipt-authenticity-signals-plan.md
- Bugs (spec §13): B1 doc-number duplicate rule ignores vendor + "X/Y" collision (Medium); B2 near-duplicate scan newest 200 rows not 180 days (Medium); B3 items chip stale after total fixed (Low); B4 attachment completion lacks uploader/branch check (Medium, security — fix first); B5 LINE claim-file/document-QA retries re-complete an ACTIVE attachment (Medium); B6 signature images accepted as direct claim evidence, later strand approval (Medium); B7 PDF read path drops reconciliation status, so arithmetic warnings never show for PDFs (Medium); B8 `DeleteAttachmentUseCase` loads by company only and reaches `markDeleted` with no branch-scope check, `delete-attachment.use-case.ts:28, 69` (Medium, security — own early commit, shippable alone; coordinator verified).
- Gaps (spec §12): G1 LINE metadata; G2 pHash collisions; G3 `/EmbeddedFile` refusal; G4 e-Tax NOT_CHECKED/UNAVAILABLE; G5 RD lookup; G6 VAT arithmetic; G7 watermarks; G8 juristic TIN formula source; G9 bank ref equality; G10 direct claim files not OCR'd; G11 no list marker; G12 no C2PA validation/remote manifests; G13 web re-encoding; G14 caller-settable `metadataJson` in download/delete gates (separate security review); G15 manual or stale-read expenses have no group C; G16 claims whose source expense changed after pinning have no group C or SLIP_REF_MISMATCH at all (snapshot keeps no read provenance).

Review 2026-10-24 (round 1, independent review "unsafe to build"; coordinator re-verified citations):
- F1 accepted — spec §1.3, §5.5 (server relations only), test §14.1; plan decision 3, step 2a.3.
- F2 accepted — review table + factsHash per target, spec §5.4.10, §6.1, §6.4, §9; plan 2a.1, decision 4.
- F3 accepted — submitted signals must be open (now with idempotent repeat, round 2), spec §7.3; plan 2a.5.
- F4 accepted — web re-encode paths and coverage table, spec §1.1, G13, journey step 5.
- F5 accepted — `approvalDecisionActions` for view/record, spec §7.3, §8; plan 2b.
- F6 accepted — card shows all groups where acknowledgement happens, spec §10.2; plan 3W.2.
- F7 accepted — real IFD0 parsing, free text ignored, spec §6.2, §10.6.
- F8 accepted — C2PA 2.4, spec §5.2, §6.2.
- F9 accepted — APP11 reassembly + bounded Brotli, real fixtures, spec §6.2, §14.1; plan 0.4.
- F10 accepted — ComfyUI/A1111 → FILE_NAMES_TOOL, spec §6.2.
- F11 accepted — review-evidence purposes included, generated artifacts excluded by relation, spec §5.5.
- F12 accepted — QR checks independent of OCR, spec §6.3.
- F13 accepted — same-target comparison, spec §6.3, §7.2.
- F14 accepted — D-B2 + stated limitation, spec §13; plan D-B2.
- F15 accepted — B4, plan D-B4 first.
- F16 accepted — B5, plan D-B5.
- F17 accepted — best-effort parser, terminable QR worker, spec §6.2; plan 0.3, 4.3.
- F18 accepted — v6 is the approved pack, spec §11.7; plan H.
- F19 partially accepted — no claim either way about a developer API (OpenAI page returns 403; coordinator found only the public Verify research-preview tool). Spec §3 and this memory say: OpenAI offers a public Verify tool (research preview) for its own images; we deliberately call no outside service.
- F20 accepted — other banks unverified, spec §5.3.
- F21 accepted — single closed-target policy, spec §9.
- F22 accepted — 1280 px everywhere.
- F23 accepted — general help vs record-specific, spec §15.10.
- F24 accepted — rd.go.th/30302, spec §5.1.
- F25 accepted — C2PA Feb 2024 vs SynthID 19 May 2026, spec §5.2.
- F26 accepted — NOT_CHECKED or UNAVAILABLE, spec §1.2.
- F27 accepted — pairing condition exact, spec §1.2.
- F28 accepted — uploader-with-authority exception in Scope.

Round 2 (2026-10-24) — 24/28 resolved, 4 partly, 13 new (1 HIGH); coordinator verified every new citation:
- P2 resolved — row lock before read, revision/status re-read after lock, no `updatedAt` change, pg tests review-vs-close and review-vs-edit; spec §7.3 steps 1–4, §14.2, §15.5; plan 2a.5, 2b.3, 2b.5.
- P11 resolved — expense eligibility from `loadExpenseEvidenceSources`; spec §5.5; plan 2a.3.
- P19 resolved — wording above and spec §3 identical; no API claim.
- P20 resolved — SCB sentence limited to what the page states; other banks unverified; spec §5.3, Decisions.
- R2-F1 (HIGH) resolved — JUMBF/CBOR assertion parsing, active manifest only, `digitalSourceType` property and `c2pa.ai-disclosure`/`modelType`; XMP value equality; negative fixtures (custom caption quoting the URI, XMP description, ingredient-only); spec §5.2, §6.2, §10.6, §14.1, §15.5b; plan 0.4, 1.2, 1.5, decision 7.
- R2-F2 resolved — `authenticityNotice` separate from `details`, stripped from tool result; gateway mixed-request test; spec §10.5, §11.6, §14.1, §15.15; plan 3L.1, 3L.3; MC1 for the card path.
- R2-F3 resolved — see P2.
- R2-F4 resolved — claims from the pinned snapshot with checksum match; live facts only at the pinned revision; spec §5.5, §7.2, §10.6, §15.5a, G16; plan 2b.1; MC8.
- R2-F5 resolved — B6 (Medium) + fix; signature files no longer silently hidden; spec §5.5, §13; plan D-B6.
- R2-F6 resolved — read file respects `sourceStale`/`extractionAttachmentId`, no fallback to primary; spec §5.5, §10.6, G15.
- R2-F7 resolved — B7 (Medium) + fix in the fenced write; spec §1.2, §11.2, §13; plan D-B7.
- R2-F8 resolved — explicit idempotent semantics, both concurrent identical requests succeed with one row set; spec §7.3 step 6, §14.2.
- R2-F9 resolved — card in source-only layout + journey step 7; spec §10.2, §15.16; plan 3W.2.
- R2-F10 resolved — freeze v6 as fallback before a DRAFT successor; spec §11.7, §14.3; plan H.0.
- R2-F11 resolved — PNG keys need content structure; `parameters="exposure 1/50"` negative; spec §5.2, §6.2; MC4.
- R2-F12 resolved — AIForge-Doc v2 / GPT-Image-2 cited beside the GPT-4o result; spec §3, plan decision 2, Decisions above.
- R2-F13 resolved — ComfyUI metadata only when enabled; spec §5.2, §6.2.

Round 3 (2026-10-24) — 38/41 resolved, P2/P31/P32 partly, 8 new (1 HIGH):
- P2 / P31 / R3-F3 addressed — review takes `lockFundingEvidence` (same lock as soft delete, `prisma-attachment.repository.ts:261, 285`) before the target-row lock and re-reads the file state; pg test review-vs-soft-delete; spec §7.3 steps 0–2, §14.2, §15.14c; plan 2a.5, 2b.3, 2b.5, decision 4.
- P32 / R3-F4 addressed — one claim rule (pinned revision + read file in snapshot), otherwise no group C/mismatch incl. tax-ID; G16 and the test expectation corrected; spec §5.5, §12, §14.1; plan 2b.1.
- R3-F1 (HIGH) addressed, awaiting round-4 confirmation — effective `digitalSourceType` per recorded action per §18.15.6.1 (wildcard, same-name templates in order, action overlay wins, templates never create actions); negative fixtures (capture action + AI wildcard template; AI template without a matching action); spec §6.2, §15.14a; plan 0.4, 1.2, 1.5, decision 7.
- R3-F2 recorded — B8 delete-attachment branch-scope bug (Medium, security), spec §13, §16; plan D-B8 first, single commit; test in registered `delete-attachment.use-case.spec.ts`.
- R3-F5 addressed — SLIP_REF_MISMATCH compares OCR output bound to the read file; "ที่อ่านได้" vs "ที่บันทึก" wording; spec §6.3, §10.4, §10.6, §15.14b; MC10.
- R3-F6 addressed — CBOR decoder handles bool/null/undefined/floats/tags; MC9 for indefinite-length; spec §6.2; plan 1.2.
- R3-F7 addressed — checksum helper also used in counterparty web/LINE; spec §1.2.
- R3-F8 addressed — retention duty does not guarantee originals (Accounting Act §15); hints offer alternatives; spec §5.1.

Round 4 (2026-10-24, the last review) — all 49 earlier items resolved, no HIGH; 7 MEDIUM/LOW applied:
- R4-F1 (MEDIUM) — LINE photo OCR summary lacks `extractionAttachmentId` (`process-line-webhook.use-case.ts:10599-10612`); new prerequisite plan step D-P1 + registered test; spec §5.5, §11.6, G15; MC13.
- R4-F2 (MEDIUM) — SLIP_REF_REUSED dependency race: same-key files of other graphs added to the `lockFundingEvidence` set before the row lock; REUSED no longer depends on the other record's closed state; pg test A-review vs B-delete; spec §6.3, §7.3 step 0, §14.2; plan 2a.5, 2b.3, 2b.5; MC11 for link writers.
- R4-F3 (MEDIUM, unverifiable) — transRef case/punctuation equivalence unproven; `slipRefKey` byte-exact, mismatch compares after whitespace removal only; marked unverified; spec §6.2, §6.3; MC5.
- R4-F4 (MEDIUM) — related[] actions (C2PA 2.4 §18.15.8) inherit and override, bounded; fixtures; spec §6.2; plan 1.2; MC12 for templates on related.
- R4-F5 (MEDIUM) — pdf-lib `updateMetadata: false` required; producer-only fixture; spec §6.2; plan 1.2.
- R4-F6 (LOW) — 404 refusal in the dialog with reload and preserved note; spec §10.3; plan 3W.1.
- R4-F7 (LOW) — button order per `thai-ux-standard.md:67`; spec §10.1, §10.3; plan 3W.1.

Verification:
- Docs only. No tests, builds, servers or cloud calls (worktree has no node_modules) — not run.
- Round 2 code facts read in worktree (tree == main 6c54ba208): line-expense-action.service.ts:1089-1096, semantic-turn-v2.ts:1140-1151, reimbursement-evidence.service.ts:30-48, prisma-attachment.repository.ts:85-97, signature-asset.use-case.ts:195-205, expense-upload.use-case.ts:380-394, expense-extraction.use-case.ts:115-119, receipt-ocr-apply.service.ts:1295-1302, reimbursements.ts:595-620, ReimbursementDetailSections.tsx:825-840, reimbursement-source.ts:40-63, approved-product-help.ts:108-120.
- Round 3 code facts read: prisma-attachment.repository.ts:250-290 (soft delete under `lockFundingEvidence`), substitute-funding.guard.ts:7-21 (lock expansion/order), delete-attachment.use-case.ts:14-30, 66-70, line-counterparty.service.ts:155-162.
- Round 4 code facts read: process-line-webhook.use-case.ts:10590-10612 (LINE summary write); docs/guidelines/thai-ux-standard.md:67 (button order).
- External: C2PA 2.4 §18.15 (incl. §18.15.6.1 templates, §18.15.8 related actions, §18.15.12 CDDL types) and §18.28 fetched 2026-10-24. Read only via search results: OpenAI pages (403), SCB developer docs (DNS), Bangkok Bank (timeout).

Next:
- Independent re-review of the three files.
- Close MC items in their lanes, then implement in plan order: D-B8 (alone) → D-B4 + D-P1 → 1 → 2a → 2b → 3 (W/L/J) → 4; D-B1/B2/B3/B5/B6/B7 independent (B5 before 4, B7 before expecting PDF arithmetic); H.0 any time, H.1–H.3 after owner approval. Each lane ≤ 5 items, typecheck + focused registered specs, screens at 390/1280/~1,556 px.
- After Phase 3 is live 30 days: report per-code counts and metadata-present ratio by channel to the owner in plain Thai.
