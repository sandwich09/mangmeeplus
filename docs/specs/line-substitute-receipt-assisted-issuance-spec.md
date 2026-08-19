# LINE Substitute-Receipt Assisted Issuance Spec

## 1. Status

v0.2, 2026-08-18. **Owner-decided, not implemented.** All open questions from v0.1 were answered the same day and folded into §4 (D1-D9). No blocking question remains; the implementation plan is the next artifact.

Owner: thawatchai. Trigger: UAT screenshot 2026-08-18 — the user typed `สร้างใบทดแทนใบเสร็จ ค่าวินมอไซต์จากที่ทำงานไปพบลูกค้า 50 บาท` and received a dead-end reply with a non-clickable relative link.

Linked plan: to be written after owner sign-off.

Memory: [[agent-memory/line-substitute-receipt-assisted-issuance|task memory]]

## 2. Goal

Let a staff member produce a complete, legally usable `ใบรับรองแทนใบเสร็จรับเงิน` for a small
out-of-pocket expense from LINE alone, with exactly one web visit at the moment of signing and
approval — and get the finished document back in the chat.

Today the same request dead-ends: the flow requires a pre-existing expense, silently drops everything
the user typed, and points at a link that LINE cannot open.

## 3. Source Docs

- Governing product boundary: [[specs/line-ai-production-parity-and-receipt-continuity-remediation-spec|LINE AI Production Parity and Receipt Continuity Remediation Spec]] §R-08/R-09 — **this spec amends R-08; see R7**
- [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]] — owns LINE reply/card presentation
- [[specs/expense-receipt-upload-spec|Expense and Receipt Upload Spec]] — owns the expense draft → confirm journey
- [[specs/line-ai-capture-correction-spec|LINE AI Capture Correction Spec]] — owns text/media capture and correction targeting

External practice references read on 2026-08-18 (see §5.B).

## 4. Owner Decisions (2026-08-18)

| ID | Decision (owner's words condensed) |
| --- | --- |
| D1 | LINE carries the work to the point where **no signature is needed yet**. The document is produced, the user can download it, sign by hand and upload it back — or upload a signature image instead. |
| D2 | Do **both** signature routes; the reusable signature image is the primary route, paper is the fallback. |
| D3 | The finished document is delivered by **link on our own domain** (`/d/{token}` → 302 → presigned), pointing at a **temp copy in a separate path**, auto-deleted after **3 days**. Raw S3 URLs are not sent to the chat. |
| D4 | The confirm/approve button in LINE **opens one web page and finishes there**. Approval does not happen in chat. |
| D5 | Default cash-evidence policy becomes `ALLOW_SUPPORTING_EVIDENCE_ONLY`, and a receipt-less expense is allowed with **no attachment at all — with no amount ceiling**. The controls that remain are stated business purpose, payer identity, two signatures and full audit. |
| D6 | Only `ใบรับรองแทนใบเสร็จรับเงิน` is built in this phase. When the situation actually calls for `ใบสำคัญรับเงิน`, the assistant explains the difference and stops — it does not fake it. |
| D7 | The delivery link expires after a **fixed 3 days**, not configurable. An expired link is not extended; the user asks for a new one. |
| D8 | Certification and approval stay **two explicit steps**, even when `OWNER_SELF` makes them the same person. One page, two acknowledgements — not one combined click. |
| D9 | A returned signed form is matched by **chat context plus one confirming question**, not by OCR or QR. The document number is printed large on the form so the user can verify it by eye. |

## 5. Source Facts

### A. Verified in code on 2026-08-18

| Fact | Evidence | Consequence |
| --- | --- | --- |
| `isSubstituteReceiptConversationText` intercepts the turn before the intake router runs | `process-line-webhook.use-case.ts:1316` vs router at `:1370` | A message that is *both* a new expense and a substitute request never reaches text capture. This is the dead-end's root cause |
| With no target expense the branch returns hard-coded copy and exits before `formatResult` | `line-substitute-receipt-continuation.use-case.ts:399-407` | Everything the user typed (amount, purpose) is discarded; no state is saved; no blockers or next question are shown |
| Targets come only from this user's LINE captures in this chat within 24 h | `process-line-webhook.use-case.ts:1262`, `:2657`, window `:161` | A first-time request always has zero candidates |
| That branch returns before `preflight`, so no permission is checked | `line-substitute-receipt-continuation.use-case.ts:399` | A user without `expense.review` is sent to a page they cannot use |
| The continuation use case has no `webBaseUrl`; every link it emits is relative | `:307`, `:341`, `:427` | LINE renders them as plain text. Every other LINE reply uses `absoluteWebLink` (`process-line-webhook.use-case.ts:295`) |
| Text-only expense capture already exists and works | `EXPENSE_DOCUMENT_CAPTURE` → `CaptureLineExpenseNoteUseCase`, `process-line-webhook.use-case.ts:1383-1462` | "ค่าวินมอไซต์ 50 บาท" is capturable today; only the guard order blocks it |
| `assertWeb(ctx)` rejects `authProvider: 'line'` on prepare, preview, certify, approve and artifact download | `substitute-receipt.use-case.ts:63-65` | The web-only boundary is enforced in code, not just in the spec |
| Prepare requires at least one supporting attachment, unconditionally | `substitute-receipt.use-case.ts` — `if (!supportingIds.length) throw` | A cash วิน ride with nothing to photograph cannot be recorded |
| Cash with no payment evidence is rejected unless policy is `ALLOW_SUPPORTING_EVIDENCE_ONLY`; the code default is `REQUIRE_SEPARATE_PAYMENT_EVIDENCE` | prepare + approve; `schema.prisma:2524`; enum `:2069-2072` | With defaults, the most common real case needs **two** files |
| The document number is reserved at prepare, inside the transaction | `prisma-expense.repository.ts:1088`, `:1195-1209` | A `PREPARED` record already has a printable identity — a form can be produced before any signature |
| Signature images are looked up by `metadataJson = { generatedFor: 'substitute_receipt_signature', evidenceId, role }` | `prisma-expense.repository.ts:1048-1065` | **A signature cannot be reused.** Every receipt requires a fresh upload from payer and approver |
| A company signature library already exists (create/approve/reject/archive/fill/derive) and LINE can already feed it | `signature-asset.use-case.ts:17-243`; `SIGNATURE_UPLOAD_TICKET` at `process-line-webhook.use-case.ts:2125-2160` | The reusable-signature route is mostly built; it is simply not wired into certification |
| Certify and approve embed the signature into a rendered SVG and checksum it; PDF is derived on demand from that SVG | `substitute-receipt.use-case.ts:600-810`, `:513-560` | The authoritative artifact stays immutable; an unsigned printable form and a wet-signed scan can be added without touching that chain |
| PDF download requires status `ISSUED`/`SUPERSEDED` and an artifact attachment | `substitute-receipt.use-case.ts:520-524` | There is no way to hand the user anything before issuance |
| The renderer already stamps derived PDFs (`VOID`, `SUPERSEDED`) | `renderSubstituteReceiptPdf(svg, documentNumber, { stateStamp })` | An `UNSIGNED` watermark is a parameter, not a new renderer |
| LINE cards support header/body/sources/uri-buttons only; no status badge | `line-business-card.logic.ts:44-83` | Badges require a small renderer extension |
| Card links must be same-origin **and** under `/companies/{companyId}/` | `safeTenantLink`, `line-business-card.logic.ts:17-29` | A presigned S3 URL in a reply is silently dropped |
| Quick replies already support `camera` / `cameraRoll` actions | `line-reply.adapter.ts:9-15` | "ถ่ายสลิป" / "ถ่ายลายเซ็น" can be one tap |
| Attaching a file to an **existing** expense with purpose `expense.payment.evidence` is supported at API level | `expense-upload.use-case.ts:114-136` | Only the LINE-side intent is missing; every photo is currently read as a new expense |
| Signed GET URLs are available from the storage port | `attachment-storage.port.ts:129`, `s3-storage.adapter.ts:93-110` | The delivery link in D3 needs no new storage capability |

### B. External practice, read 2026-08-18

- `ใบรับรองแทนใบเสร็จรับเงิน` is the correct document when the payee cannot or will not issue or sign
  anything — motorcycle taxi, taxi, fresh market — or when the document received is materially
  incomplete. **The company's own employee certifies it; the payee does not sign and no ID copy is
  required.**
- `ใบสำคัญรับเงิน` is the different document for when the payee *is* present and willing to sign; it
  normally carries a copy of the payee's ID card and is stronger evidence.
- Minimum content: payment date; payee name/address/ID; what the money was for; amount; **signature of
  the paying employee and of the approver**.
- Supporting evidence (transfer slip, photo, cheque copy, contract) is attached **when it exists**. It
  is not a precondition of the document itself.
- The document is internal evidence, never a tax invoice; input VAT is not claimable from it.

Sources: [flowaccount — เอกสารประกอบค่าใช้จ่ายกรณีหลักฐานไม่เพียงพอ](https://flowaccount.com/blog/document-support-expense-line-item/) ·
[prosoftwinspeed — ใบสำคัญรับเงิน vs ใบรับรองแทนใบเสร็จรับเงิน](https://www.prosoftwinspeed.com/Article/Detail/148925/) ·
[กรมสรรพากร — คู่มือการจัดทำเอกสารประกอบการลงบัญชี](https://www.rd.go.th/fileadmin/download/15277290359.pdf) ·
[LINE Developers — Send messages](https://developers.line.biz/en/docs/messaging-api/sending-messages/) (no file message type)

**The gap this spec closes:** the product currently demands more evidence than the law does, and
delivers less document than the user needs.

## 6. Non-goals

- `ใบสำคัญรับเงิน`, `ใบสำคัญจ่าย` or any new document type. D6 — detect and explain only.
- Signing or approving inside the chat. The approve button opens the web (D4).
- Making the wet-signed scan the authoritative artifact. The system-rendered snapshot stays authoritative (R11).
- Input-VAT treatment. Unchanged: internal evidence, `SUPPORTING_ONLY` / `NON_CLAIMABLE`.
- Bulk creation, recurring expenses, or per-trip mileage schemes.
- OCR of the returned signed form beyond matching its printed document number.

## 7. Business Rules

**R1 — One message may be both a capture and a substitute request.**
When the text matches the substitute vocabulary **and** carries an expense fact (amount plus
purpose/category), the turn first creates the expense draft through the existing capture path, then
immediately opens the substitute continuation on that draft. Both outcomes are reported in one reply.
If capture is not possible (no amount, or no capture permission), the turn falls back to target
selection — never to the current dead-end copy.

**R2 — Nothing the user typed is discarded.**
Every reply on this journey, including target-selection and blocked states, is produced by the shared
formatter and states: what is recorded, what is still missing, and exactly one next question.
`TARGET_REQUIRED` no longer returns hand-written copy.

**R3 — Every link is absolute, permission-checked and inside the tenant path.**
The continuation receives `webBaseUrl` and emits absolute URLs. A link is offered only after the
permission needed to use it has been checked. A user without `expense.review` gets the reason, not a
link.

**R4 — Preflight is one list, always complete.**
Blockers are reported together, never one at a time, with the conversational ones marked. This
already holds in `preflight`; R2 extends it to the states that bypass it today.

**R5 — Evidence is required only when evidence exists.** *(D5)*
Prepare accepts zero attachments. There is no amount ceiling and no per-payer monthly cap: a
`ใบรับรองแทนใบเสร็จรับเงิน` is valid without any attachment under Thai practice, and the product must
not be stricter than the rule it implements.

What still gates a no-attachment document: `businessPurpose` and a place/route detail are mandatory;
the payer must resolve to an active in-scope member; both signatures are still required; and the
prepare is audited with `evidenceCount: 0` so an auditor can list every self-certified document
without evidence in one query. When the user does have a slip or photo, the assistant always asks for
it — silence is a fallback, not the happy path.

The `if (!supportingIds.length) throw` guard in `PrepareSubstituteReceiptUseCase` is removed, and the
cash payment-evidence guard follows R6.

**R6 — Cash defaults change.**
The code default and the schema default for `cashEvidencePolicy` become
`ALLOW_SUPPORTING_EVIDENCE_ONLY`. Existing policy rows are not migrated; a company that deliberately
chose `REQUIRE_SEPARATE_PAYMENT_EVIDENCE` keeps it.

**R7 — LINE may prepare; LINE may not sign, approve or issue.** *(amends R-08)*
`PrepareSubstituteReceiptUseCase` accepts `authProvider: 'line'` when the caller holds
`expense.review`, the branch is in scope, and the payer resolves to the current active LINE-linked
member. Preview, certify, approve and artifact download keep `assertWeb`. Every LINE-sourced prepare
is audited with `source: 'LINE'`.
Rationale: preparing writes staged facts and reserves a document number; it embeds no signature and
grants no approval. Without it the user must visit the web twice on the paper route.

**R8 — An unsigned document is never called an issued document.**
Before signatures exist, the artifact offered is `แบบฟอร์มรอลงนาม`: the preview snapshot rendered to
PDF with an `UNSIGNED` watermark and the line `เอกสารนี้ยังไม่สมบูรณ์จนกว่าจะมีลายเซ็นผู้จ่ายและผู้อนุมัติ`.
It is never stored as the evidence artifact and never described with `ออกเอกสารแล้ว`.

**R9 — A signature image is uploaded once and reused.**
A personal signature asset, `ACTIVE` and owned by the user, satisfies certification and approval for
any evidence in that company. The per-evidence lookup remains valid for backward compatibility.
LINE's existing signature-upload route feeds the same library.

**R10 — The paper route is a first-class alternative.**
The user may take the `แบบฟอร์มรอลงนาม`, sign it by hand, and send a photo back through LINE. The
photo is linked to the evidence as the wet-signed original.

**R11 — On the paper route the scan carries the signatures, so the scan is inside the document.**
A system-rendered artifact would show empty signature boxes, because on this route the ink exists only
on paper. The issued artifact for `signatureMode: 'PAPER'` is therefore a PDF of **the scan first,
followed by a system attestation page** carrying the snapshot values, the payer/approver identities
and timestamps recorded in the system, the snapshot checksum and the scan checksum.

The immutable snapshot remains the structured source of truth and is still checksummed; the scan is
stored as an `ACTIVE` attachment with its own checksum and is never editable afterwards. Content
correctness of a hand-signed sheet is the approver's responsibility, exactly as on paper.

**R12 — Someone accountable closes the loop, in two steps.** *(D8)*
Certification by the payer and approval by the holder of `expense.confirm` remain two distinct
acknowledgements with two distinct audit rows, including when `OWNER_SELF` makes them the same person.
They may live on one page as two sequential steps; they may not collapse into one click. Uploading a
photo never issues a document by itself.

**R13 — The assistant asks before producing the document.**
Once the preflight is clean the assistant asks one question — `ให้ออกเอกสารเลยไหมคะ` — offering:
ออกเอกสาร (ใช้ลายเซ็นที่บันทึกไว้) · ขอฟอร์มไปเซ็นเอง · แก้ข้อมูลก่อน. It does not produce anything unasked.

**R14 — Incoming media is classified against the open work, never guessed.**
See §11.

**R15 — Wrong-document detection.** *(D6)*
When the user's words indicate the payee could sign — `ผู้รับเงินเซ็นให้ได้`, `ให้เขาเซ็นแล้ว`,
`มีสำเนาบัตรของผู้รับเงิน` — the assistant states that `ใบสำคัญรับเงิน` is the fitting document, explains
the difference in one short paragraph, says the system does not produce it yet, and asks whether to
continue with `ใบรับรองแทนใบเสร็จรับเงิน` anyway. It never silently substitutes one for the other.

**R16 — The delivery link is a credential.**
See §12. A link is per-recipient, time-boxed, revocable and audited.

## 8. Business Journeys

### Journey A — primary: text → document, reusable signature

1. `สร้างใบทดแทนใบเสร็จ ค่าวินมอไซต์จากที่ทำงานไปพบลูกค้า 50 บาท`
2. System captures the expense draft (R1), opens the continuation, replies with a card: badge
   `ยังขาดข้อมูล`, what was recorded (50.00 THB, ค่าเดินทาง, วันนี้), the full blocker list, one question.
3. User answers the remaining questions in chat, one per turn.
4. Preflight clean → badge `ข้อมูลครบ` + R13's question.
5. `ออกเอกสาร` → no `ACTIVE` signature in the library → assistant asks for one, with a `cameraRoll`
   quick reply and a one-line how-to (`เซ็นบนกระดาษขาว ถ่ายให้เห็นเต็มลายเซ็น`).
6. User sends the photo → stored as a reusable personal signature (R9). **Asked once, never again.**
7. Card: badge `รอยืนยัน`, button `ยืนยันและออกเอกสาร` → one web page, prefilled, with two sequential
   steps: the payer certifies, then the approver approves (D8 — two acknowledgements even when
   `OWNER_SELF` makes them one person).
8. On `ISSUED` the system pushes a card into LINE: badge `ออกเอกสารแล้ว`, document number, amount, and
   button `ดาวน์โหลดเอกสาร (ลิงก์หมดอายุใน 3 วัน)`.

### Journey B — fallback: paper signature

4'. At R13 the user picks `ขอฟอร์มไปเซ็นเอง`.
5'. System prepares (R7) — the document number is reserved here — renders the `แบบฟอร์มรอลงนาม` with
    both signature boxes blank, the `UNSIGNED` watermark and the document number printed large (R8),
    and delivers it by §12 link.
6'. User prints, signs both boxes by hand, photographs the sheet, sends it back in the same chat.
7'. Media classifier (§11) sees a form awaiting a scan, asks the D9 confirming question, and on `ใช่`
    links the photo with `signatureMode: 'PAPER'`, then shows badge `รอยืนยัน` + the same web button.
8'. Same as A.7-A.8, and the downloadable document is the R11 two-part PDF: the scan, then the system
    attestation page.

### Journey C — evidence arrives as a photo

At any point while a continuation is open, the user may send a slip or photo. §11 decides whether it
is supporting evidence, payment evidence, a signature, a returned signed form, or a different expense
altogether, and asks one question when it cannot tell. Accepted files are attached to the expense
under the matching purpose and echoed in the next card.

### Exception paths

- No capture permission → explain, offer the web path, no link the user cannot open (R3).
- Ineligible expense (valid receipt exists, wrong source type) → say why; link to the expense, not to
  the substitute wizard.
- Expense changed on the web mid-conversation → existing `STALE` handling; nothing is overwritten.
- Approver policy not ready → blocker names the settings page; nothing is prepared.

## 9. Boundary and Ownership

- **LINE owns**: collecting facts, receiving evidence and signature images, preparing (R7), requesting
  delivery links, and presenting status.
- **Web owns**: preview, certify, approve, issue, artifact download, superseding, policy settings.
- **API owns**: preflight truth, thresholds, document numbering, artifact rendering and checksums,
  delivery-token lifecycle, audit.
- **AI Gateway owns**: intent and media classification, and the wording of the card — never the
  eligibility verdict.
- **Out of boundary**: any tax filing, VAT claim, or posting behaviour.

## 10. Data Model Changes

**`ExpenseSubstituteReceiptPolicy`** — one change only:
- `cashEvidencePolicy` default changes to `ALLOW_SUPPORTING_EVIDENCE_ONLY` (R6; new rows only)

No threshold columns are added. D5 removed the ceiling, so R5 needs no configuration.

**`ExpenseSubstituteReceiptEvidence`** — add:
- `signatureMode` enum `DIGITAL | PAPER`, default `DIGITAL`
- `wetSignedScanAttachmentId` nullable — set only when `signatureMode = PAPER`
- `wetSignedScanChecksumSha256` nullable
- `preparedFromChannel` enum `WEB | LINE`, default `WEB` (R7 audit trail)

**`DocumentDeliveryLink`** — new:
`id`, `companyId`, `recipientUserId`, `evidenceId`, `kind` (`ISSUED_PDF | UNSIGNED_FORM_PDF`),
`tokenHashSha256` (unique), `tempBucket`, `tempObjectKey`, `expiresAt`, `revokedAt?`, `openCount`,
`lastOpenedAt?`, `createdByUserId`, `createdAt`. The token itself is never stored.

**Personal signature reuse (R9)** — no new table. A repository lookup resolves an `ACTIVE`
signature asset owned by the user, and certify/approve accept it in place of the per-evidence
attachment.

## 11. AI Context Rules for Incoming Media (R14)

When an image arrives and this user has an open substitute continuation in this chat, the classifier
chooses exactly one of:

| Class | Deterministic signal | Action |
| --- | --- | --- |
| Returned signed form | A form was requested for an open evidence in this chat and is still awaiting its scan; the photo shows a printed sheet with ink signatures | Ask the D9 confirming question naming the document number and amount, then link as wet-signed scan, `signatureMode: PAPER` |
| Signature | Ink strokes on a blank/near-blank background, or caption says ลายเซ็น | Store as reusable personal signature (R9) |
| Payment evidence | Transfer slip / bank app screenshot / cheque, or caption says สลิป, โอน, จ่ายแล้ว | Attach with `expense.payment.evidence` |
| Supporting evidence | Any other photo offered as proof of the expense | Attach with `expense.receipt.supporting` |
| A different expense | A readable receipt/invoice whose amount does not match the open evidence | Existing capture path; **do not** attach to the open work |

If two classes are plausible, the assistant asks one numbered question and keeps the bytes pending —
the existing pending-media mechanism. It never guesses, and it never silently attaches a file to a
document that is about to be certified.

**Matching a returned form (D9).** No OCR and no QR. The system already knows which evidence is
awaiting a paper scan in this chat, so it names it back and asks for a yes:

> ได้รับฟอร์มที่เซ็นแล้วค่ะ — ใบนี้คือ **SUB-202608-00007** ค่าเดินทางไปพบลูกค้า 50 บาท ใช่ไหมคะ
> `[ ใช่ ]` `[ ไม่ใช่ ใบอื่น ]`

The document number is printed large on the form so the answer takes one glance. `ไม่ใช่` lists the
other forms awaiting scans. If none are awaiting a scan, the photo is not treated as a returned form
at all. A QR code may be added later purely as an optimisation; nothing in the flow depends on it.

The caption is authoritative over the picture when the two disagree, because the caption is the
user's stated intent.

## 12. Delivery Link Design (D3, R16)

1. On issuance (or on form request), the API **copies** the rendered PDF to a delivery prefix.
   The source artifact is never moved, renamed or deleted.
2. Object key is opaque: `line-delivery/{32-byte base64url random}.pdf`. **No company id, expense id,
   document number, user id or date appears in the key**, so knowing one key reveals nothing about
   another.
3. That prefix carries its own 3-day lifecycle expiration, and the download role must not hold
   `s3:ListBucket` on it. A separate bucket is preferred over a separate prefix where operationally
   cheap.
4. The chat receives `{webBaseUrl}/d/{token}` — a public, session-less page that resolves the token
   hash, checks `expiresAt`/`revokedAt`, increments `openCount`, writes an audit row, and 302s to a
   short-lived presigned URL.
5. `safeTenantLink` gains exactly one additional allowance: an exact-shape `/d/{token}` path on the
   configured web origin. It is placed in the public route tree, not under `/companies/...`, so that
   a page which must stay unauthenticated cannot drift into the authenticated shell.
6. Revocation deletes the temp object; the presigned URL dies with it. A presigned URL cannot be
   recalled on its own, which is precisely why the token indirection exists.
7. **The 3-day window is fixed, not company-configurable (D7).** An expired link is never extended.
   The expiry page and the LINE card both offer `ขอลิงก์ใหม่`, which copies the artifact to a fresh
   opaque key and issues a new token; the old temp object is already gone. Re-issuing while a link is
   still live creates a second valid token — both stay valid until they expire or are revoked. The
   card states `ลิงก์นี้เปิดได้ถึง {date} แล้วจะหมดอายุ ขอใหม่ได้ตลอด`.
8. PDPA: the document carries payee name and amount. Links are per-recipient and are never posted to a
   group chat.

## 13. LINE Presentation

Card gains an optional badge row rendered above the body:

| Badge | When |
| --- | --- |
| 🟡 `ยังขาดข้อมูล n อย่าง` | Conversational blockers remain |
| 🟠 `รอไฟล์หลักฐาน` | Only file blockers remain |
| 🟢 `ข้อมูลครบ` | Preflight clean, not yet prepared |
| 🖊️ `รอลงนาม` | Prepared, awaiting signature |
| 🔵 `รอยืนยัน` | Signature present, awaiting web confirmation |
| ✅ `ออกเอกสารแล้ว` | `ISSUED` |
| 🔒 `ไม่มีสิทธิ์` / ⛔ `ทำไม่ได้` | Forbidden / ineligible |

Body order is fixed: what is recorded → what is missing → the boundary line
(`LINE ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร` while true) → the VAT caveat → one next question.
At most two buttons; the primary is always the single action that moves the work forward.

## 14. Permission and Audit

| Action | Permission | Audit | Risk |
| --- | --- | --- | --- |
| Capture draft from text | `expense.create` / `expense.receipt.*` | existing | LOW |
| Attach evidence from LINE | `expense.receipt.upload` | `attachment.upload` + `source: LINE` | MEDIUM |
| Store reusable signature | `expense.signature.manage` | existing `expense.signature.create` | HIGH |
| Prepare from LINE (R7) | `expense.review` | `expense.substitute_receipt.prepare` + `preparedFromChannel: LINE` | HIGH |
| Certify / approve | `expense.review` / `expense.confirm`, web only | existing | HIGH / CRITICAL |
| Create delivery link | issued evidence readable by the recipient | new `document.delivery.link.create` | MEDIUM |
| Open delivery link | token only | new `document.delivery.link.open` with token id + IP | MEDIUM |
| Revoke delivery link | `expense.review` | new `document.delivery.link.revoke` | LOW |

## 15. Edge Cases

- Two open substitute continuations in the same chat → existing numbered target selection; R2 formatting.
- The user answers a question with a question → existing side-answer handling; the work is not lost.
- A signature image that is illegible or is not a signature → reject with a reason; never store silently.
- The user answers `ไม่ใช่ ใบอื่น` to the D9 question → list the other forms awaiting scans; if there are none, treat the photo as ordinary supporting evidence and say so.
- A photo of a signed form arrives when nothing is awaiting a scan → not a returned form; classify normally per §11.
- The expense is edited on the web after prepare → existing `assertPreparedExpenseUnchanged` conflict; the card explains and offers supersede.
- The delivery link is opened after expiry → a plain page saying the link expired, with a `ขอลิงก์ใหม่` button; no document data on that page.
- The user forwards the link to someone else → treated as intended by the token holder; the audit row records every open.

## 16. Acceptance Criteria

- [ ] `สร้างใบทดแทนใบเสร็จ ค่าวินมอไซต์จากที่ทำงานไปพบลูกค้า 50 บาท` from a first-time user creates a draft, opens a continuation, and returns a card listing recorded values, all blockers and one question.
- [ ] No reply on this journey contains a relative link, and no link is offered without the permission to use it.
- [ ] A cash expense with zero attachments reaches `ISSUED` under default policy, at any amount, and the prepare audit row records `evidenceCount: 0`.
- [ ] A second substitute receipt by the same user requires **no** signature upload.
- [ ] Certification and approval produce two separate audit rows even under `OWNER_SELF`.
- [ ] The `แบบฟอร์มรอลงนาม` PDF is watermarked, prints the document number large, and is never described as issued.
- [ ] A photo of that signed form sent back in chat triggers the D9 confirming question, links only after `ใช่`, and cannot issue the document by itself.
- [ ] The paper-route download is the scan followed by the system attestation page, with both checksums present.
- [ ] An expired delivery link shows no document data and offers `ขอลิงก์ใหม่`, which produces a new token and a new opaque key.
- [ ] A slip sent mid-conversation attaches to the open expense instead of creating a new one.
- [ ] A user stating the payee signed receives the `ใบสำคัญรับเงิน` explanation and a choice.
- [ ] The delivery link resolves once for the recipient, is audited, expires at 3 days, dies on revoke, and its object key leaks nothing.
- [ ] Certify, approve and artifact download still refuse `authProvider: 'line'`.

## 17. Test Cases

- **Unit** — guard ordering in R1; R5 zero-attachment prepare at a large amount; badge selection per state; token hashing/expiry/revocation; delivery key contains no identifiers; D9 matching when zero, one and several forms await scans.
- **Integration** — full Journey A and Journey B against a seeded company; prepare-from-LINE audit fields; reuse of one signature across two evidences; stale-expense conflict after prepare.
- **Permission** — prepare from LINE without `expense.review`; approve from LINE (must refuse); delivery link opened by an expired token.
- **UI** — the deep-linked web page opens prefilled and completes certification and approval without further navigation.
- **Edge** — ambiguous media asks exactly one question and keeps the bytes; wrong document number on a returned form.

## 18. Rollout

1. Non-behavioural fixes first: absolute links, permission check, R2 formatter reuse. Shippable alone.
2. R1 guard order + R5/R6 policy defaults. This alone makes the screenshot's request work end to end on the web.
3. R9 signature reuse — the largest single reduction in user effort.
4. R7 prepare-from-LINE, R8 form, R10/R11 paper route.
5. §12 delivery links and §13 badges.

Each step is independently releasable and independently reversible.

## 19. Open Questions

All four questions raised in v0.1 were answered by the owner on 2026-08-18 and are recorded as D5,
D7, D8 and D9. No blocking questions remain; the plan can be written.

Deliberately left for implementation to settle:

- Whether the delivery temp copy lives in a separate bucket or a separate prefix — an operational
  call, with a separate bucket preferred (§12.3).
- The exact wording of the R15 `ใบสำคัญรับเงิน` explanation, to be reviewed with the owner against a
  real conversation rather than in the abstract.
