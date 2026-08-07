# Agent Memory: Generic upload errors

Status: Completed
Owner: Codex
Scope: Prevent raw storage, MIME, and file-signature errors from appearing on web upload surfaces for expenses, reimbursements, tax evidence, accounts payable, bank statements, and CRM broadcast images.
Decisions:
- Keep actionable client-side format validation, such as supported extensions and size limits.
- Translate upload MIME/type failures to `ไฟล์ที่อัปโหลดไม่ตรงกับประเภทไฟล์ที่ระบุ กรุณาตรวจสอบและอัปโหลดไฟล์ที่ถูกต้อง`.
- Translate all other technical upload failures to `ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง`.
- Apply the copy at the shared upload boundary so raw API/storage details do not reach feature error banners.
Open questions: None.
Artifacts:
- `apps/web/src/common/files/upload-file.logic.ts`
- Web upload clients for expenses, reimbursements, tax evidence, banking, and CRM broadcast images.
Verification:
- Focused upload tests: 10/10 passed.
- Full web unit suite: 550/550 passed.
- Web typecheck passed.
- `git diff --check` passed.
Next: Commit/push when requested, then deploy to UAT and retry the mismatched-file case.
