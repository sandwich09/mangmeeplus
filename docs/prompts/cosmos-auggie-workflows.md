# Cosmos and Auggie Workflow Prompts

## Current Workflow Prompt

Use this when starting a documentation session.

```text
ตอนนี้ฉันใช้ Cosmos ผ่าน Auggie Daemon บนเครื่อง local

เป้าหมาย:
ช่วยสร้างเอกสาร Markdown สำหรับโปรเจกต์นี้ เพื่อใช้กับ Obsidian และใช้เป็น source of truth ก่อน implement code

ให้สร้างโครงสร้าง docs/ ดังนี้:
- docs/product/
- docs/specs/
- docs/plans/
- docs/adr/
- docs/research/
- docs/prompts/

งานแรก:
ช่วยสร้างเอกสารเริ่มต้นสำหรับโปรเจกต์ SME Business OS / ERP / CRM / Inventory / Accounting / AI Assistant

ยังไม่ต้องแก้ code
ให้สร้างเฉพาะ Markdown docs ก่อน
```

## Feature Spec Prompt

Use this when creating a detailed feature spec.

```text
ช่วยสร้าง feature spec เป็น Markdown ใน docs/specs/

Feature:
<ใส่ชื่อ feature>

บริบท:
โปรเจกต์นี้เป็น SME Business OS ที่ web เป็น full workspace สำหรับเก็บ/ดู/จัดการข้อมูล และ LINE เป็น AI assistant สำหรับถามข้อมูล สรุป และแจ้งเตือน

เอกสารต้องมี:
1. Goal
2. Non-goals
3. User roles
4. Business workflow
5. Business rules
6. Data model draft
7. API behavior
8. UI behavior
9. Edge cases
10. Acceptance criteria
11. Test cases
12. Open questions

ยังไม่ต้อง implement code
```

## Implement From Spec Prompt

Use this after both spec and plan exist.

```text
อ่าน docs/specs/<feature>.md และ docs/plans/<feature>-plan.md ก่อน

งานของคุณ:
1. ตรวจ codebase ปัจจุบันว่า plan นี้เข้ากับ architecture/convention ของ repo ไหม
2. ถ้ามีจุดไม่ตรง ให้สรุป adjustment ก่อน
3. implement เฉพาะ Phase 1 เท่านั้น
4. เพิ่ม/แก้ test ที่จำเป็น
5. run test ที่เกี่ยวข้อง
6. สรุปไฟล์ที่แก้ เหตุผล และผล test

ห้าม implement เกิน scope
ถ้าพบ requirement ไม่ชัด ให้ถามก่อน
```

## Scope Control Prompt

```text
ทำเฉพาะงานที่ระบุใน spec/plan นี้เท่านั้น
ถ้าพบงานที่ควรทำเพิ่ม ให้สรุปเป็น follow-up แต่อย่า implement เอง
```
