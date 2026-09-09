# Agent Memory: Substitute receipt company payer

Status: Implemented, scoped back to substitute receipts only, locally verified; awaiting user review. No deploy.
Owner: /root
Scope: ใบรับรองแทนใบเสร็จรับเงิน บริษัทจ่ายเต็ม / พนักงานหนึ่งคนจ่ายเต็ม ชื่อจดทะเบียน ตำแหน่งผู้ลงนาม snapshot/version/correction และผลต่อยอดบริษัท

Decisions:
- Latest user correction: “ให้ทำใบทดแทน ทำไมไปใบเบิกด้วย ?”. Removed all reimbursement module/page/API/schema changes and receipt-to-claim creation links. Do not resume those changes without a new request. Existing read-only live-claim checks protect receipt mutation only.
- COMPANY uses existing full-payment behavior once; already full creates none; partial refuses. PERSONAL creates supporting evidence without company payment; reimbursement is a separate out-of-scope process.
- Explicit fundingSource/full acknowledgement on new drafts; legacy nullable source never inferred. Preserve signed bytes/hash.
- Use saved registeredName, fallback to display name visibly; no hardcoded customer name. Signer remains a person with own-profile/common/custom position.
- Certify persists validated snapshot and rechecks source state in transaction. Document-only correction preserves financial facts, payment/JV and original artifact; supports cancel/restart/retry.
- Ponytail full from repo `.agents/skills/ponytail/SKILL.md`; legacy AGENTS path absent. No subagents, dependencies, package.json changes, cloud reads, release dispatch, commit or push.
- Baseline HEAD e4d0fcf5; unrelated dirty docs retained.

Open questions:
- None required for local review. Actual live screenshot root cause remains unverified; local legal-name/snapshot fix does not claim live diagnosis.
- Reimbursement/CC2 findings in the earlier research are deferred, not implemented or validated by this work.

Artifacts:
- Spec: docs/specs/substitute-receipt-company-payer-spec.md (current AC01–16).
- Plan: docs/plans/substitute-receipt-company-payer-plan.md (implementation and evidence).
- Research audit and six-perspective review dated 2026-09-09 retained as historical findings with scope amendment.
- Code: expenses API/contracts/Prisma and expenses web only. Additive migrations 20260909180000_substitute_receipt_funding_source and 20260909190000_substitute_document_correction.

Verification:
- API focused suites 367/367, no skips, including existing payment/atomic-confirm and new real-PG receipt funding/correction tests. Log /tmp/substitute-only-final-api-tests.log.
- Web focused suites 57/57, no skips. Log /tmp/substitute-only-web-tests.log.
- API/web typechecks, API build, Prisma generate and fresh migrations/seed passed. Logs /tmp/substitute-{api,web}-typecheck.log, /tmp/substitute-api-build.log, /tmp/substitute-only-{prisma,migrations,seed}.log.
- Public API issuance: company 100 creates one payment; personal 100 leaves company paidAmount 0/no payment. Correction creates new version without monetary changes. Logs /tmp/substitute-only-api-smoke.log and /tmp/substitute-only-correction.log.
- Browser CUA: receipt hub shows both sources; custom position and unsigned preview work; Escape closes modal; changed position invalidates previous preview readiness. Native PDF iframe times out in in-app browser; downloaded actual PDFs both render with Poppler and visually pass.
- Scoped git diff --check passed; reimbursement paths, shared branch field, next-env and package.json diff are empty.
- Full browser E2E, live environment and tax filing acceptance not run. No claim that local checks cover those.

Local review:
- URL http://127.0.0.1:3000/companies/seed-local-company/expenses/substitute-receipts
- Web 3000 and API 3001 running. Runner /tmp/substitute-local-run.py has explicit local-only env; database substitute_receipt_only_review at 127.0.0.1:15432, seeded from scratch. Earlier substitute_receipt_review DB is retired and not connected to the running API.
- Login Dev sign-in (local seed OWNER), or Owner / Owner@12345. Fake company/legal name and artificial test signature only.
- Company expense cmtu684xh000cn2k1hoao7q51, issued correction cmtu68fd9001tn2k17je6b7e5 (SRC-202609-00003).
- Personal expense cmtu6855k0012n2k1a956teok, issued original cmtu685790017n2k1dvw6190k (SRC-202609-00002), unsigned correction cmtu6b0z8002ln2k1zad8uh5w for position review.
- Service restart: python3 /tmp/substitute-local-run.py api; web: python3 /tmp/substitute-local-run.py web. API must be rebuilt before restart if API source changes.

Next:
- User reviews substitute receipt local. Keep services running and open receipt hub, not reimbursement.
- Apply review feedback within this scope. Do not deploy until asked and deployment runbook followed.

## Local review fix: “ไปกรอกตำแหน่ง” (2026-09-09)

- User reproduced a dead jump button. Root cause: wizard retained an input ref after the position field became a combobox; the referenced input only mounted for “ระบุเอง”. Before fix, clicking left document.activeElement on the jump button.
- Changed only SubstituteSignerPositionField and its wizard ref contract: a focus handle resolves the current custom input or combobox within the field, scrolls it to the viewport center, then focuses without a second scroll. Both wizard signer call sites use the same handle; shared ThemedSelect is unchanged.
- Verified through CUA on the existing local unsigned correction: default selection focuses role=combobox; Enter opens its menu; “ระบุเอง” with blank text focuses INPUT. Both focus targets are at y=381–425 inside viewport height 806. No signature or document mutation submitted.
- `pnpm exec tsc --noEmit` from apps/web passed; log /tmp/substitute-position-focus-typecheck.log. Scoped diff whitespace check passed. Existing 424-suite evidence above belongs to the previous delivery, not rerun for this focus-only patch.
- Repeatable browser check on the unsigned local draft: leave position blank → click “ไปกรอกตำแหน่ง” → verify activeElement role combobox and visible bounding rect → Enter → choose “ระบุเอง” → click jump again → verify activeElement is the custom-position input and is visible. Local app hot reload serves the fix; no deploy.

## Local review fix: canvas jumps into a long line (2026-09-09)

- Reproduced user screenshot using a short horizontal CUA drag: at the first point, SignaturePad reported unconfirmed strokes, making savedSignatureUsed false. SignatureFields removed the saved signature panel above the canvas during the drag; canvas top moved approximately 149 px and the same screen coordinate became a long downward line. This is a layout bug, not a position-field focus bug.
- Small fix in SignatureFields (shared by certify/approve): track whether its existing replacement details is open; hide saved signature summary when opening the editor, before pointer-down. Clearing/drawing while open no longer toggles that panel. No change to signature storage, issuance, source selection or shared canvas coordinate math.
- Browser verified: first horizontal stroke stays horizontal with canvas top 175.289 px and scrollY 1308 unchanged; prepare drawing locally and add a second stroke stays stable; clear then draw again stays stable (top 150.789 px before/after). Unconfirmed drawings still block signing; clearing preserves existing library fallback.
- Existing earlier personal correction was observed ISSUED on reload; did not modify its artifact. Prepared a separate local-only 1-baht draft for UI testing: expense/evidence recorded in /tmp/substitute-signature-pad-fixture.json, evidence cmtu7127f003yn2k1qytd2jap. Did not certify, approve or upload the test strokes.
- Focused signature-pad/wizard model tests 25/25 passed, zero skips: `pnpm exec tsx --test src/features/expenses/signature-pad.model.spec.ts src/features/expenses/substitute-receipt-wizard.model.spec.ts` from apps/web. Log /tmp/substitute-signature-jump-tests.log.
- Web `pnpm exec tsc --noEmit` passed; log /tmp/substitute-signature-jump-typecheck.log. Scoped diff check passed. No deploy.
- Regression browser steps: open replacement editor with a saved signature → drag horizontally → compare canvas bounding rect and screenshot → use drawing (local preparation only) → drag again → clear → drag again. This reproduces the original visual failure and verifies actual layout; model tests alone do not cover layout.

## Local UX review: document review last (2026-09-09)

- User proposed moving “ตรวจสอบเอกสารฉบับเต็ม” to the end because reviewing is required before continuing. Assessment: correct; previous approval UI put preview before position although changing position invalidates the preview, forcing users to backtrack.
- Reordered both wizard certify/approve and the existing embedded expense-review UI: position → prepare signature → document review → acknowledgement/final action. Renumbered sections and readiness/blocker lists consistently. Review button uses the primary style until reviewed. Thai/English readiness help follows the same order.
- Gate behavior unchanged: document media must load successfully, position/signature/acknowledgement must be ready, stale preview callbacks and changed position still invalidate review; existing backend version/checksum requirements remain. Opening a document is not proof that a person read it; human acknowledgement remains required in the wizard.
- Browser check on local-only draft cmtu7127f003yn2k1qytd2jap: position selected + library signature + acknowledgement but no preview → signEnabled=false; successful preview load → true; position changed → false. No final sign/approve action submitted.
- Focused wizard-model + preview tests 33/33, no skips; /tmp/substitute-review-last-tests.log. Web typecheck passed; /tmp/substitute-review-last-typecheck.log. Scoped diff check passed. Approval/embedded order checked in code; this follow-up browser check covers the payer wizard, not a new full-system E2E claim.
- Spec updated before UI edit; no API/schema or reimbursement changes and no deployment. Local dev serves the revised flow.

## Global number-control follow-up (2026-09-09)

User requested native number arrows removed throughout the app. Implemented and verified through shared globals.css, including the substitute wizard and manual expense page; see [[agent-memory/web-number-input-spinners]]. Fresh local Turbopack cache was required to serve the CSS. No receipt or reimbursement workflow changes in that follow-up. Latest web log /tmp/substitute-spinner-local-web.log.


## Local review: payment certifier identity and change path (2026-09-09)

- User asked how to change the payment certifier shown as Local Owner. Root causes: the wizard defaulted both initial state and member-list fallback to the creator/first member; the existing cancellation/revision route was hidden under version history.
- Fresh drafts now require an explicit certifier selection; eligible saved/LINE choices survive. “ผู้รับรองการจ่าย” is consistent across wizard controls, accessibility labels, readiness, waiting and hub status. Help distinguishes company payment handler from the employee who personally advanced the full sum; the creator can prepare for someone else.
- Before signing, current certifier and a change action are visible. For ordinary PREPARED/PAYER_CERTIFIED evidence on a mutable expense, expense.review users can open the existing version history and focus the cancellation reason. Clicking the shortcut itself performs no mutation. Issued evidence and document-only corrections do not expose this identity-change shortcut. Existing API permissions, member/branch scope, version checks and certifier-owned signatures remain enforced.
- After cancellation, revised drafting retains the evidence facts rather than replacing them with expense defaults, clears certifier selection and full-payment acknowledgement, and focuses the details step. The previous version remains SUPERSEDED with its reason.
- New server snapshots capture optional payer.roleLabel = ผู้รับรองการจ่าย; SVG/printable output use that value. Old snapshots without the field retain their exact old label. Hash includes the captured label, so old previews must be re-reviewed after this local API update. Existing issued artifacts remain unchanged.
- Browser CUA: fresh fixture starts with blank certifier; shortcut opens history and focuses the textarea; blank reason blocks cancellation; cancel → revised draft preserves payee/reason/purpose/funding/payment facts and requires certifier selection; selected seed-qa-user-staff while logged in as seed-local-owner; prepare creates v2 and shows waiting for that employee. Screenshot reviewed. No certify/approve/payment actions performed. Original user review drafts left untouched.
- Local-only fixture: expense cmtu85wue007un2k1qr1k1c7z, old evidence cmtu87ryx0003a5k153yhsbh4 (SRC-202609-00007, SUPERSEDED), new evidence cmtu89cq60009a5k13yhk5wwz (v2, PREPARED). Metadata /tmp/substitute-certifier-ui-fixture.json.
- API smoke /tmp/substitute-certifier-api-smoke.log confirms creator seed-local-owner, certifier seed-qa-user-staff, retained facts, paidAmount=0/payment count=0, and HTTP 403 when creator requests the certifier preview. Earlier own-certifier preview contains the new label; /tmp/substitute-certifier-preview.svg.
- API focused command: pnpm exec tsx --test src/modules/expenses/domain/logic/substitute-receipt.logic.spec.ts src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts src/modules/expenses/application/use-cases/substitute-receipt-payer-access.use-case.spec.ts (apps/api): 58/58, zero skips; /tmp/substitute-certifier-api-tests.log. Renderer checks new role label affects the snapshot hash while legacy rendering remains unchanged.
- Web focused command: pnpm exec tsx --test src/features/expenses/substitute-receipt-wizard.model.spec.ts src/features/expenses/substitute-receipt-preview.spec.ts (apps/web): 33/33, zero skips; /tmp/substitute-certifier-web-tests.log. Web pnpm exec tsc --noEmit passed; /tmp/substitute-certifier-web-typecheck.log.
- API bare tsc first exhausted default 4 GB heap (log /tmp/substitute-certifier-api-typecheck.log); reran the existing pnpm run typecheck script with its configured 8 GB heap successfully (/tmp/substitute-certifier-api-typecheck-8gb.log). API build passed (/tmp/substitute-certifier-api-build.log). Scoped git diff --check passed.
- Local API rebuilt/restarted with the same local-only runner/database; current session 91885, log /tmp/substitute-certifier-local-api.log, port 3001. Web remains running on port 3000. No schema/dependency/deploy changes.
