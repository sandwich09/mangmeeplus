# Agent Memory: Company Plan Management Delegation

Status: Implemented and verified on a clean main-based worktree; owner handles deployment.
Owner: Codex
Scope: เพิ่ม permission กลางสำหรับ OWNER มอบสิทธิ์จัดการแพ็กเกจให้ custom role; ตรวจ purchase/recovery flows และ E2E ที่เกี่ยวข้อง

Decisions:
- ไม่เพิ่ม system roles ตามชื่อตำแหน่ง CEO/CTO/CBO; บริษัทใช้ชื่อ role เองได้
- ใช้ `company.plan.manage` กับ `pack.company.plan.manage`; OWNER ได้ permission โดยอัตโนมัติ
- ให้ OWNER จริงเป็นผู้มอบ permission นี้ แม้ผู้ใช้คนอื่นจะได้รับ permission ผ่าน custom role
- Billing/package-change authorization ตรวจ active membership, active role และ permission; คง OWNER-only เฉพาะ ownership/legal boundaries
- การตั้งค่าบริษัทใช้ permission เฉพาะหน้าที่มีอยู่ และ recovery ต้องตรงกับ permission ของแต่ละ route
- ฟอร์ม VAT ใช้ UUID เป็น `commandId` เพื่อไม่ให้ company ID ยาวทำให้คำสั่งเกินขีดจำกัด 64 ตัวอักษรของ API
- ปรับคำในหน้าสร้างบทบาทให้เป็นการกระทำที่เข้าใจได้โดยไม่รู้ศัพท์ระบบ เช่น “ดูบัญชีและรายการธนาคาร”; อธิบายตัวอย่างหน้าที่ให้เห็นก่อนเลือก และเปลี่ยน “ไปป์ไลน์” เป็น “ขั้นตอนการขาย”

Open questions: ไม่มี

Artifacts:
- `docs/specs/company-plan-management-delegation-spec-th.md`
- `docs/plans/company-plan-management-delegation-plan-th.md`
- `e2e/plan-term-billing-readiness.spec.ts` (BR17: grant, custom employee, expiry, profile/VAT, unauthorized staff)

Verification:
- API and Web typecheck passed on the main-based worktree.
- Focused API and Web tests passed; BR17 browser E2E passed against an isolated local PostgreSQL database on port 15432.
- No `package.json` changes; `git diff --check` passed.

Next: merge the scoped implementation into main and develop; owner handles deployment.
