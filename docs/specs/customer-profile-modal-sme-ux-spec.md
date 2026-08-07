# Customer Profile Modal — SME UX Specification

Status: Implementing 2026-07-19

## Product goal

Help an SME owner or staff member understand one customer and take the next common action in seconds, without needing to understand CRM terminology. Preserve permission, audit, merge-preview, and archive safeguards from the canonical customer-management specification.

## Primary users and jobs

- Owner/Admin: review identity, edit, resolve duplicates, or archive a customer safely.
- Manager/Sales: identify the customer, see the assigned owner and next appointment, continue the conversation, and update allowed fields.
- Read-only roles: understand the customer without seeing mutation controls.

## Information hierarchy

1. Identity: name, status, customer number, phone, source, owner, consent, tier, last activity.
2. Relationship context: LINE account and verification state, internal note, next appointment.
3. Next action: continue the LINE conversation when available; otherwise open the full customer history.
4. Record maintenance: edit, resolve duplicates, archive. Destructive actions remain visually separated.

## Button contract

| Control | User-facing label | Behavior | Visibility / safety |
|---|---|---|---|
| Close icon | `ปิด` | Close modal without changing data. Escape and backdrop retain the same behavior. | Always available; accessible name required. |
| Retry | `ลองใหม่` | Reload detail, bookings, and latest conversation after a read failure. | Error state only; must not mutate. |
| Primary conversation | `เปิดแชท LINE` | Open the most recent conversation for this customer in Inbox. | Only when a conversation exists. Primary green action because replying is the highest-frequency SME job. |
| Full history | `ดูประวัติลูกค้าทั้งหมด` | Open Customer 360 with deals, tasks, bookings, finance, and activity history. | Always available; secondary when chat exists, primary fallback when no chat exists. |
| Edit | `แก้ไขข้อมูล` | Open the existing edit form for permitted customer fields and assignment. | Only with update or assign permission and after detail loads. |
| Duplicate resolution | `ตรวจสอบข้อมูลซ้ำ` | Search another record, optionally re-point only LINE identity, preview full-merge impact, and confirm a soft merge with reason. | Owner/Admin with merge permission; active customer only. Never auto-merge. |
| Archive | `เก็บเข้าคลัง` | Open confirmation requiring a reason; preserve history and require explicit override for open work. | Archive permission only; visually isolated as a destructive maintenance action. |
| Archive cancel/confirm | `ยกเลิก` / `ยืนยันเก็บเข้าคลัง` | Cancel safely or archive once validation passes. | Confirm disabled until reason exists and while saving. |
| Merge search/select | `เลือก` / `เลือกใหม่` | Select or replace the suspected duplicate. | No mutation. |
| LINE-only link | `ย้าย LINE มาที่ข้อมูลหลัก` | Re-point only the selected LINE identity and its conversations after reason entry. | High-risk permission and audit boundary remain server-enforced. |
| Merge preview/confirm | `ตรวจสอบผลกระทบ` / `ยืนยันรวมข้อมูล` | Show affected record counts/conflicts, then soft-merge only when safe. | Preview required before confirm; confirm disabled on conflicts or while saving. |

## Language and status rules

- Avoid unexplained English product terms in the primary action surface.
- Translate `ACTIVE`, `UNFOLLOWED`, and `BLOCKED` into plain Thai.
- Distinguish channel state from identity verification. `ใช้งานอยู่` does not imply `ยืนยันตัวตนแล้ว`.
- Label notes as `บันทึกภายใน` so staff know the customer does not see them.
- Use `รหัสลูกค้า` instead of `Customer ID` and `LINE ที่เชื่อมไว้` instead of `LINE identity`.
- State what a risky action does before the user enters its flow; do not rely on color alone.

## Acceptance criteria

- A Thai-speaking SME user can identify the primary action without knowing “Customer 360”.
- At most one primary-green action is shown in the modal.
- Common actions and record-maintenance actions are visibly separated.
- Every existing permission and mutation safeguard remains unchanged.
- The modal remains usable on narrow screens and all controls retain accessible names.
- Docker web build passes and an authenticated browser smoke verifies labels, ordering, links, and modal transitions.
