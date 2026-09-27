# แผน: น้องมั่งมี ที่ปรึกษารายจ่าย

สเปก: [mangmee-ai-expense-advisor-spec-th.md](../specs/mangmee-ai-expense-advisor-spec-th.md) · บันทึกงาน: [mangmee-ai-expense-advisor-2026-09-27.md](../agent-memory/mangmee-ai-expense-advisor-2026-09-27.md)
Branch หลัก: `claude/mangmee-ai-advisor-20260927` (แตกจาก d78114f5) · worktree `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-ai-advisor-20260927`

## วิธีทำงาน

- **ผู้คุม (Claude, main thread):** เขียน brief ให้แต่ละงาน ตรวจ diff ทุกชิ้น (bug, gap, impact, กติกา §11) ตัดสินใจเรื่องออกแบบ รันการประเมินกับโมเดลจริง push และ merge และสื่อสารกับ owner
- **ผู้ทำ:** subagent โมเดลต่ำกว่า งานซับซ้อนใช้ `sonnet` งานกลไกหรือเขียนข้อมูลใช้ `haiku` หนึ่งงานต่อหนึ่ง worktree ห้ามสอง agent แก้ไฟล์เดียวกันพร้อมกัน
- **รับงานทุกชิ้น:**
  - typecheck ของ package ที่แตะ ด้วยสคริปต์ของ package (API ต้องใช้ heap flag)
  - spec ที่เกี่ยวข้องผ่าน
  - spec ใหม่ลงทะเบียนใน catalog แล้ว
  - ไม่แตะ `package.json` และไม่เพิ่ม flag หรือ env
  - ถ้าแตะไฟล์ที่ถูก pin ต้อง sync pin
- **งานหนัก:** typecheck ทั้งแอปและชุดทดสอบใหญ่ต้องถือ lock `/tmp/mangmee-heavy.lock` แบบ mkdir แล้วปล่อยในคำสั่งเดียวกัน
- **ก่อน push งาน LINE-AI:** รัน `node scripts/run-line-ai-whole-chain-acceptance.mjs`

## ช่องทางงาน

| Track | งาน | Worktree / branch | ทำพร้อมกับ |
|---|---|---|---|
| A | แก้แกน: gateway, API ส่วน LINE, contracts ส่วน line-ai | worktree หลัก | B, C |
| B | ชุดทดสอบ: ข้อมูลตั้งต้น, ชุดคำถาม, ตัวตรวจ, ตัวรัน | `claude/mangmee-ai-advisor-eval` | A, C |
| C | เครื่องมือ API: แยกยอดตามร้าน, จับคู่ชื่อหมวดและร้าน | `claude/mangmee-ai-advisor-tools` | A, B |

B และ C merge กลับเข้า branch หลักเมื่อผ่านการตรวจ

## ลำดับงาน

### P0 เตรียม (ผู้คุม)
- worktree หลักและติดตั้งเสร็จแล้ว
- ใช้ Postgres :15439 และ Redis :16389 ของรอบก่อนต่อ ส่วน gateway ของรอบก่อนให้หยุดแล้วเปิดใหม่จาก worktree นี้
- ปรับตัวรัน 4 ข้อของ Codex ให้ชี้ worktree นี้ แล้วรันยืนยันว่าระบบทดสอบใช้ได้ ใช้เป็นจุดเทียบเริ่มต้น

### P1 แก้บั๊กจากรีวิว (Track A, sonnet หนึ่งตัว ทำตามลำดับ)
1. R-U1 ตัวอ่าน "เฉพาะ…" ทั้งใน gateway และ API พร้อมตารางทดสอบจริงและเท็จ
2. R-U2 ลดข้อความสำเร็จรูป "ไม่รองรับ" ให้เหลือเฉพาะเกณฑ์ที่ทำไม่ได้จริง
3. R-L2/R-L3 ทำให้การถอยของระบบจบแบบ `unsupported` และ API ปิดงานเป็น `completed` แก้ assertion ใน `prepared-simple-read-security.spec.ts` ที่ล็อก `needs_user` ไว้
4. R-L6 ใส่รูปแบบ `taskRef` และ ref ที่คัดลอกได้ในคำสั่งแบบย่อ ให้การลองซ้ำบอกช่องที่ผิด ให้ตัวอ่านคืนเหตุผล และห้ามผูกคำถามอ่านใหม่กับงานค้าง
5. R-A1 ให้ formatter บอกตัวกรองที่ใช้ และห้ามแสดงยอดร่างเป็นศูนย์เมื่อกรองออก แก้ `prepared-simple-read-formatter.spec.ts:170`
6. §8 ปรับข้อความตอนทำไม่ได้ และบันทึกรหัสจริงกับเหตุผลที่ทางลัดถอย
7. ลงทะเบียน `line-intake-compact-decision.spec.ts` และ `read-tool-input.spec.ts` ในชุด reliability-gateway-v2 ของ catalog

รับงาน: spec ที่แก้และเพิ่มผ่าน, typecheck gateway และ API ผ่าน, ผู้คุมตรวจ diff แล้ว

### P2 ทางลัดไม่ตันและกว้างขึ้น (Track A, sonnet)
1. R-L1 แยกการตรวจก่อนเรียกเครื่องมือของ orchestrator ออกมาเป็นฟังก์ชันร่วม แล้วให้ intake route เรียกใช้ก่อนเสนอแผน simple
2. R-L4 เพิ่ม formatter และ family:
   - `expense.list_recent::list`
   - `expense.get_breakdown::list` (หมวด สาขา และร้าน เมื่อ Track C เสร็จ)
   - `reimbursement.list_pending_approvals::list`
   - `reimbursement.get_summary::single_metric`
3. ตั้งค่าเริ่มต้นของ family ในโค้ด แล้วอัปเดตค่าใน Kamal ของ UAT และ production ให้ตรงกัน ถ้าไฟล์ถูก pin ต้อง sync pin
4. R-L5 ตรวจว่าทางปกติเรียก `list_recent` สองช่วงได้ ถ้าไม่ได้ให้แก้

รับงาน: spec ของ formatter แต่ละ family, spec ที่ยืนยันว่าแผนที่ไม่ผ่านการตรวจจะไม่ถูกล็อกเป็น simple, และ typecheck ผ่าน

### P3 ความจำบทสนทนา (Track A, sonnet พร้อม brief ละเอียด; ผู้คุมตรวจทุกบรรทัด)
1. R-M1 เก็บ input ที่ใช้จริงและ `shownItems` ลง `LineReadEvidence.inputJson` ของเครื่องมืออ่านรายจ่ายและใบเบิก
2. R-M2 เพิ่ม `recentReads` ใน contract และใน `loadConversationContext`
3. R-M3 และ R-M4 ให้ router แสดงความจำพร้อมกติกาการต่อบริบท
4. R-M5 ให้ตัวตรวจยอมรับค่าที่สืบมาจาก `recentReads` และ id จาก `shownItems`
5. R-M6 และ R-M7 มีเทสต์ยืนยันว่าไม่ใช้ตัวเลขเก่า และแชตกลุ่มไม่มีความจำ

รับงาน:
- spec ครอบคลุมกรณีสืบช่วงและตัวกรอง เอาตัวกรองออก แยกกลุ่ม อ้างลำดับ ค่าในข้อความปัจจุบันชนะ เปลี่ยนเรื่อง หมดเวลา 15 นาที สิทธิ์เปลี่ยน และ id ที่ไม่อยู่ใน `shownItems`
- typecheck ผ่าน

### P4 เครื่องมือ (Track C, sonnet)
1. `expense.get_breakdown` เพิ่ม `byVendor` (10 ร้านแรกเรียงยอด พร้อม id และชื่อ) โดยใช้การ groupBy แบบตรวจสิทธิ์เดิม
2. `categoryName` และ `vendorName` ใน `list_recent` และ `get_breakdown` ให้ API จับคู่ชื่อแบบเดียวกับสาขา ถ้าคลุมเครือให้คืนตัวเลือก ถ้าไม่พบให้คืนรายการที่มี
3. อัปเดต schema ใน contracts และตัว sanitizer ฝั่ง gateway ให้รับฟิลด์ใหม่ ชื่อต้องเป็นข้อความที่อยู่ในข้อความลูกค้าหรือใน `recentReads`

รับงาน: spec ของ API สำหรับแต่ละกรณี (ตรงตัว คลุมเครือ ไม่พบ และสิทธิ์ `read_own`) และ typecheck ผ่าน

### P5 ชุดทดสอบ (Track B)
1. ข้อมูลตั้งต้นตาม §10 ใช้ sonnet โดยต่อยอดจาก snapshot แบบ NAT และคำนวณสิทธิ์จาก preset จริง
2. รูปแบบชุดคำถาม ตัวตรวจ (เทียบ tool และ input แบบ canonical, oracle ที่รันเครื่องมือเฉลย, ตรวจข้อความ, วัดเวลาและค่าใช้จ่าย) และตัวรันกับรายงาน markdown ใช้ sonnet
3. ชุดจูนอย่างน้อย 200 ข้อ ใช้ sonnet ที่เห็นสเปก §3 และ §4
4. ชุดเก็บไว้ทดสอบอย่างน้อย 60 ข้อ ใช้ sonnet อีกตัวที่ไม่เห็นชุดจูน ผู้คุมเก็บแยกไว้ ใช้เฉพาะตอนวัดผลรอบสุดท้าย
5. ถ้ารันตามลำดับช้าเกินไป ค่อยเพิ่มการรันขนานหลายชุด แต่ละชุดใช้ฐานข้อมูล ดัชนี Redis และพอร์ตแยกกัน

รับงาน: รันข้อมูลตั้งต้นกับ oracle ได้โดยไม่เรียกโมเดล (preflight) และตัวตรวจมีเทสต์ของตัวเอง

### P6 วัดผลและปรับ (ผู้คุม วนรอบ)
1. build แล้วเปิด gateway จาก worktree หลัก
2. รันชุดจูนกับโมเดลจริง
3. จัดกลุ่มข้อที่ไม่ผ่านตามสาเหตุ
4. แจกงานแก้เป็นชิ้นเล็ก
5. รันซ้ำเฉพาะกลุ่มที่เกี่ยวข้อง แล้วรันเต็มเมื่อแก้ครบรอบ

หยุดเมื่อผ่าน A1–A8 จากนั้นรันชุดเก็บไว้ทดสอบหนึ่งรอบ ถ้าไม่ผ่านให้แก้แบบทั่วไป ห้ามแก้ให้ตรงข้อสอบ แล้วรันทั้งสองชุดใหม่

### P7 ความเร็ว (sonnet + ผู้คุม)
- วัดเวลาแต่ละขั้นจากผล P6
- ตัดข้อความที่ router ต้องเขียนออก เมื่อยืนยันแล้วว่าไม่มีส่วนใดใช้
- เติมค่า `lane`, `fallbackReason` และ `costSatang` ใน `turn_summary`
- วัดซ้ำ

### P8 ปิดงาน (ผู้คุม)
1. อัปเดตสเปก แผน และบันทึกงาน ใส่ผลวัดจริงและรายการที่ยังไม่ผ่าน (ถ้ามี)
2. ตรวจ `git diff --check`, สถานะ pin, spec กำพร้า และรัน whole-chain acceptance
3. เปิด PR เข้า develop แล้ว admin merge จากนั้นเปิด PR เข้า main จาก branch ที่แตกจาก main และ cherry-pick งานชุดเดียวกัน แล้ว admin merge
4. หยุด gateway ของการทดสอบ และหยุด container Postgres และ Redis ของรอบนี้
5. รายงาน owner เป็นภาษาไทยธรรมดา

## ค่าใช้จ่ายและเวลาโดยประมาณ

- การรันเต็มหนึ่งรอบประมาณ 260 ข้อ ข้อละประมาณ 1–3 การเรียกโมเดล ใช้ประมาณ 100–250 บาท และประมาณ 45–60 นาทีถ้ารันตามลำดับ
- วางไว้ไม่เกิน 6 รอบเต็ม ส่วนรอบย่อยรันเฉพาะกลุ่ม

## ความเสี่ยง

- **ไฟล์ใหญ่ที่หลายงานแตะ:** `process-line-webhook.use-case.ts` (~7,400 บรรทัด), `orchestrator.agent.ts` และ `intent-router.agent.ts` ให้ Track A ทำทีละชิ้นเท่านั้น
- **ตัวแปรในการทดสอบ:** ผลของโมเดลแต่ละรอบต่างกันได้ ข้อที่ผ่านบ้างไม่ผ่านบ้างให้รันซ้ำสองครั้งก่อนตัดสิน
- **ขอบเขตงานบวม:** ถ้าเจอเรื่องนอก §3 ให้จดไว้เป็นงานถัดไป ไม่ขยายรอบนี้
