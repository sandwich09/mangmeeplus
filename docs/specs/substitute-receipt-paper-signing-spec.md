# ใบรับรองแทนใบเสร็จ: เลือกลงนามออนไลน์หรือกระดาษ

สถานะ: implement และทดสอบ local แล้ว 2026-09-09; รอผู้ใช้ตรวจ ไม่ได้ deploy

## เป้าหมายและขอบเขต

ต่อยอด [[specs/substitute-receipt-company-payer-spec]] ผู้ใช้กรอกข้อเท็จจริงรายจ่ายและหลักฐานร่วมกันก่อนเลือกวิธีลงนาม รองรับบริษัทจ่ายเต็มหรือพนักงานสำรองเงินส่วนตัวจ่ายเต็มเท่านั้น ไม่มีใบเบิก/จ่ายคืนใหม่ ไม่มีจ่ายผสม และไม่มี deploy

## Journey และ acceptance

1. ข้อมูลรายจ่าย ผู้รับเงิน เหตุผล วัตถุประสงค์ เงินที่ใช้ชำระ วิธี/วันที่จ่าย และหลักฐาน → เลือกวิธีลงนาม โดยไม่บังคับบัญชีผู้รับรองในขั้นข้อมูลร่วม
2. DIGITAL: เลือกสมาชิกผู้รับรอง ตรวจและลงนามด้วยบัญชีตนเอง ผู้อนุมัติตามนโยบายเดิม
3. PAPER: ไม่ต้องระบุบัญชีผู้ลงนาม แบบฟอร์มคงชื่อจดทะเบียนบริษัท เลขภาษี เลขที่เอกสาร ข้อเท็จจริงรายจ่ายครบ เว้นข้าพเจ้า/ตำแหน่ง รวมลายเซ็น ชื่อ ตำแหน่ง วันที่ทั้งผู้รับรองและผู้อนุมัติ ให้เขียนและเซ็นจริง ไม่ฝังลายเซ็นประจำตัว ไม่พิมพ์บรรทัด “เลขที่ … · version …” ใต้หัวเรื่อง ข้อความสีแดง หรือฟุตเตอร์ทั้งข้อความท้ายเอกสารและ ID/SHA256/Page บนแบบฟอร์มกระดาษ ตามผู้ใช้ขอปรับ 2026-09-09; version และ hash ยังเก็บในระบบ
4. ดาวน์โหลดแล้วสถานะรอฉบับลงนาม ข้อเท็จจริง/ชื่อบริษัทในแบบฟอร์มถูกเก็บเป็น snapshot คงที่ การแก้ไขต้องยกเลิกเวอร์ชันและจัดทำใหม่ พิมพ์ซ้ำได้เวอร์ชันเดิม
5. ผู้จัดทำที่มี expense.review อัปโหลดฉบับครบทั้งสองลายเซ็น JPEG/PNG/PDF (ขนาดไม่เกิน 10 MB, PDF ต้นฉบับไม่เกิน 5 หน้า; หน้าบันทึกของระบบอยู่ภายใต้เพดาน renderer เดิม 6 หน้า) พร้อมกรอกชื่อ วันที่ และตำแหน่ง (ถ้ามี) ตามกระดาษ และยืนยันว่าเลขที่และข้อมูลตรงกับแบบฟอร์มนี้ โดยไม่แสดงเวอร์ชันในข้อความยืนยัน แต่ยังตรวจ evidence/version ในระบบ กรอกครบก่อนยื่น ไฟล์อัปโหลดและสถานะรอตรวจไม่ทำให้จ่าย/ออกเอกสาร
6. ผู้ตรวจรับที่มี expense.confirm และเป็นผู้อนุมัติที่บริษัทอนุญาต เปิดตรวจไฟล์จริงพร้อมข้อมูลที่ถอดจากกระดาษทุกหน้าและกดยืนยันอ่านครบก่อน (การปิดหน้าต่างอย่างเดียวไม่นับ) ยืนยันข้อมูลตรง/ลายเซ็นครบ/อำนาจผู้อนุมัติ/เก็บกระดาษจริง แล้วรับเอกสารโดยไม่เซ็นดิจิทัลแทนบุคคลบนกระดาษ
7. รองรับผู้ลงนามไม่มีบัญชี ซึ่งยังต้องเกี่ยวข้องและมีอำนาจจริง ผู้จัดทำ ผู้อัปโหลด ผู้ลงนามบนกระดาษ ผู้ตรวจรับ แยกตัวตน การลงนามสองตำแหน่งโดยคนเดียวต้องระบุชัดและผ่านนโยบาย OWNER_SELF พร้อมผู้ตรวจรับที่มีสิทธิ์ยกเว้นเดิม; DESIGNATED_APPROVERS ห้าม
8. ไฟล์ฉบับสมบูรณ์ = ภาพ/สแกนจริงพร้อมหน้าบันทึกการตรวจของระบบ ไม่วาดลายเซ็นจำลอง เก็บแฮชและประวัติ ไม่แก้ไฟล์ที่ออกแล้ว ฉบับเก่าคงเดิม
9. Retry/double click และการแข่งขันกับ cancel/source change ต้องไม่ออกซ้ำหรือสร้าง payment ซ้ำ บริษัทบันทึกจ่ายได้ครั้งเดียวที่รับเอกสารสุดท้าย พนักงานสำรองจ่ายไม่สร้างการคืนเงิน
10. แก้ถ้อยคำใหม่ใน UI เป็น “ใช้เงินของใครชำระรายการนี้?” ตัวเลือกชื่อจดทะเบียนบริษัท / เงินส่วนตัวของพนักงาน บนเอกสารใหม่ “ชำระด้วยเงินของ[ชื่อจดทะเบียนบริษัท]เต็มจำนวน” หรือ “พนักงานสำรองจ่ายด้วยเงินส่วนตัวเต็มจำนวน” เป็นข้อความเสริม ไม่ใช่ชื่อช่องบังคับตามกฎหมาย ต้องไม่เปลี่ยนภาพย้อนหลังของ snapshot เก่า

## Architecture / contracts / permissions

- ใช้ signatureMode DIGITAL/PAPER เดิม; PAPER ใหม่ไม่มี payerUserId (nullable จริง ไม่ปลอมเป็นบัญชีผู้จัดทำ) แยกจาก legacy LINE PAPER ที่ยังมี payerUserId
- เพิ่ม frozen paperFormSnapshotJson, paperSubmissionJson (ผู้ลงนามตามกระดาษและตัวตน/เวลาผู้อัปโหลด), paperReviewedByUserId; ใช้ PREPARED + มี/ไม่มี submission แสดงสถานะย่อยรออัปโหลด/รอตรวจ โดย ISSUED เดิมหมายถึงรับฉบับสมบูรณ์
- Upload intent ผูก company/branch/evidence/uploader ตรวจ MIME/ขนาด/bytes/composable pages/checksum และ ACTIVE ownership ก่อนผูก attachment ภายใต้ version/source/attachment locks
- การตรวจใช้ checksum ของ frozen facts + submission + scan และ expectedEvidenceUpdatedAt การรับเอกสารใช้ transaction issue เดิมเพื่อคง funding/idempotency/source/payment guards เส้น DIGITAL ไม่ลดข้อกำหนด
- เปลี่ยนวิธีก่อน prepare ได้; หลังเตรียมเลขที่ใช้ cancel/revision เดิม ไม่เปิดสองวิธีที่ใช้หลักฐานคนละชุดพร้อมกัน
- ภาษี: ไม่รับรองว่าลายเซ็นอย่างเดียวหักรายจ่ายได้; ไม่ให้เครดิต VAT จากใบนี้ เก็บหลักฐานพิสูจน์ผู้รับเงินจริงและต้นฉบับกระดาษตามข้อเสนอที่ผู้ใช้ยืนยัน

## แหล่งอ้างอิงที่ตรวจระหว่างคุย

- https://www.rd.go.th/827.html (มาตรา 65 ตรีและหลักฐานผู้รับเงิน)
- https://www.rd.go.th/5206.html (ภาษีซื้อตามมาตรา 82/5)
- https://www.rd.go.th/fileadmin/download/drugstore_manual1.pdf หน้าเอกสาร 38 / PDF 41 (ตัวอย่างใบรับรอง ชื่อกิจการและผู้รับรอง)
- ETDA พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ มาตรา 10–12/1: ความครบถ้วน การเก็บรักษาและแปลงเอกสาร

## Verification required

API/real PG: digital requires own account; paper no fake account; scoped upload; no side effects before acceptance; wrong/stale/hash/source/permission rejection; retries/races; company/personal final money effects. Web: shared data before choice, paper blanks/no signature library, upload/review/wait states, creator vs signer separation. Render actual multi-page PDFs and browser local review. Update this status only with evidence.

## Integration evidence และข้อจำกัดที่ตั้งใจ

- หลักฐานทดสอบและ local fixtures: [[agent-memory/substitute-receipt-paper-signing-2026-09-09]].
- แบบฟอร์มและไฟล์ที่ออกยึด snapshot/ไฟล์ต้นฉบับ ไม่ดึงชื่อโปรไฟล์ปัจจุบันไปแทนชื่อบนกระดาษ บันทึกการตรวจรับแยกจากการลงนามจริง
- ตัวอ่านใช้ภาพทุกหน้าที่ render จาก PDF จริงด้วย pdfjs-dist ที่มีอยู่แล้ว ไม่พึ่ง native PDF iframe; ดาวน์โหลด PDF ได้ทั้งก่อนและหลังรับเอกสาร การเปิดฉบับที่ออกแล้วใช้ permission/branch checks และ audit การอ่านเดิม
- ตรวจแบบฟอร์มและการอัปโหลดไม่ได้พิสูจน์ว่าบุคคลนั้นเซ็นจริง ผู้ตรวจรับต้องเทียบไฟล์กับชื่อ/ตำแหน่ง/วันที่ และตรวจอำนาจผู้อนุมัติเอง ต้นฉบับกระดาษยังต้องเก็บไว้
- การรับใบรับรองไม่สร้างสิทธิภาษีซื้อ และการสำรองเงินส่วนตัวไม่สร้างรายการคืนเงินอัตโนมัติ

## Authorized follow-up: optional signer positions and acceptance presentation (2026-09-09)

- Position is optional for both payment certifier and approver across DIGITAL, legacy PAPER, new PAPER, expense review, preview, submission, certification and approval. Names, real signing dates, signatures, acknowledgements and approval authority remain mandatory. Position is descriptive, never a permission or role grant.
- Omitted/blank positions normalize to an empty string in existing stored signer fields; validate type and 120-character maximum when supplied. No schema migration; keep signed-state non-null checks. Changing a supplied position still invalidates review and requires signing the changed facts.
- PDFs omit the position phrase/separator when absent; paper blanks label position “ถ้ามี”. Never rewrite already-issued artifacts.
- New paper acceptance pages show document number without version, uploader display name, and “ผู้ตรวจรับ”; omit account IDs and visible SHA-256 rows. Keep version, actor IDs, hashes and verification internally. Capture uploader name server-side at submission; older submissions resolve a tenant-scoped member name when available, otherwise show “-”, never an account ID.
- Paper reviewers use the existing substitute-receipt approval policy and expense.confirm permission at Settings → ใบรับรองแทนใบเสร็จรับเงิน. DESIGNATED_APPROVERS restricts to selected eligible members; no independent reviewer authority or new role.
- Acceptance: blank positions complete both signing routes; malformed/overlong values reject; required identity/signature/date/preview and authorization checks still reject invalid submissions; company/personal money effects unchanged.

## Review readiness feedback (2026-09-10)

- Display explicit ordered instructions before paper acceptance: open every page, explicitly confirm reading inside the preview, then complete three acceptance declarations. Closing the preview alone must not count as review.
- While declarations are disabled, show the missing prerequisite next to them. After reading confirmation, show readiness and the remaining declaration count. The preview footer shows pages successfully opened / total and the next required action.
- Preserve existing version/hash/permission checks and do not automatically accept on load, close, or page navigation.

## Paper PDF footer correction (2026-09-10)

User reports remaining footers in step 3 after the blank form cleanup. Remove the tax-note footer from newly rendered paper acceptance attestations and stop the paper PDF compositor from adding ID/Page footers for the new accountless PAPER flow, including preview and derived downloads. Keep legacy LINE/digital defaults and VOID/SUPERSEDED state stamps. Uploaded scans and already-issued stored SVG originals remain unchanged; content already printed in a scan is not erased. For existing accountless PAPER records, remove only the exact former static system-footer element from the derived attestation copy so reopening/downloading also reflects the requested presentation without rewriting stored artifacts.

## Online signing footer correction (2026-09-10)

User confirms footer removal also applies to online signing. Supersede the digital-default exception above: new digital preview/certified/issued SVGs omit the grey tax-note footer; issued PDF preview/download omits ID/SHA256/Page overlays. Existing issued online documents strip only the exact former static system-footer element from their derived printout, retaining original stored SVGs, signatures and hashes. Reuse the existing footer-removal helper. Keep state stamps, signer facts, permissions, source checks and payment behavior. Payment vouchers and legacy scanned-paper compositor defaults are outside this correction. Verify new SVGs, old issued PDF downloads, state stamps and the user's SRC-202609-00026 locally.

## Expense review entry consolidation (2026-09-10)

Expense review must use the same canonical substitute receipt journey as the hub. Remove the legacy embedded preparation/signing/approval/cancellation forms. Reuse the selected expense and existing prefill for a new certificate; resume an existing PREPARED/PAYER_CERTIFIED document by evidence ID; open the issued document by ID; preserve cancelled history and only offer new preparation under the existing expense/permission/classification rules. Display funding source, payment certifier (or paper waiting state) and actionable document status without visible version/account identifiers. Merely entering the journey must not create a second expense, issue/sign/cancel a document, or record a payment. The canonical wizard remains responsible for DIGITAL/PAPER choice, source-state locks, review and signature acknowledgements, optional positions and financial effects.
