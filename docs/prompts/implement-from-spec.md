# Implement From Spec Prompt

Use this prompt when asking Auggie to implement after a spec and plan are ready.

```text
อ่าน docs/plans/master-implementation-checklist.md, docs/specs/<feature>.md, docs/plans/<feature>-plan.md, docs/specs/platform-environment-config-spec.md, docs/plans/platform-environment-setup-plan.md, และ docs/guidelines/security-implementation-guideline.md ก่อน

งานของคุณ:
1. ยืนยันว่า feature นี้ตรงกับลำดับใน master checklist หรือถูก owner สั่ง reorder แล้ว
2. ตรวจ codebase ปัจจุบันว่า plan นี้เข้ากับ architecture/convention ของ repo ไหม
3. ถ้ามีจุดไม่ตรง ให้สรุป adjustment ก่อน
4. implement เฉพาะ Phase 1 เท่านั้น
5. เพิ่ม/แก้ test ที่จำเป็น
6. run test ที่เกี่ยวข้อง
7. ยืนยันว่า security checklist ที่เกี่ยวข้องไม่หลุด
8. อัปเดต docs/agent-memory/<task>.md เมื่อการทำงานข้ามหลาย turn/module หรือมีทั้ง docs และ code
9. สรุป product/architecture/implementation/integration evidence, ไฟล์ที่แก้, เหตุผล, และผล test

ห้าม implement เกิน scope
ถ้าพบ requirement ไม่ชัด ให้ถามก่อน
```

## Checklist Before Implementation

- [ ] Feature spec exists in `docs/specs/`.
- [ ] Implementation plan exists in `docs/plans/`.
- [ ] Feature order matches `docs/plans/master-implementation-checklist.md` or owner-approved reorder is recorded.
- [ ] Platform environment setup gate is satisfied or explicitly out of scope.
- [ ] Phase 1 scope is small enough to review.
- [ ] Data model changes are explicit.
- [ ] Permission rules are explicit.
- [ ] Product, architecture, implementation, and integration evidence exists in plan, task memory, or handoff.
- [ ] Relevant security checklist items are explicit.
- [ ] Test expectations are explicit.
- [ ] Open questions are resolved or accepted as follow-up.

## Expected Auggie Output

Auggie should summarize:

- Architecture fit or required adjustments
- Product, architecture, implementation, and integration evidence
- Files changed
- Why each change was made
- Relevant security checklist items satisfied
- Tests added or updated
- Test command and result
- Follow-up work not implemented
