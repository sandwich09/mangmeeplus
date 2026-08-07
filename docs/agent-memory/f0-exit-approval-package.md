# F0 Exit — Owner Approval Package (feature-entitlement decoupling)

Generated 2026-07-31 · repo HEAD after F0.C commit · historical approval-request snapshot. A0–A5 were later adopted; use the 2026-08-03 A5/readiness correction below for current execution authority. `develop` is UAT application source; `main` is production application source/neutral-controller home. UAT success never clones or deploys production automatically.

## สิ่งที่ F0 ผลิต (6 commits บน develop)

| ชิ้น | Commit | เนื้อหา |
|---|---|---|
| F0.A | `42be7299` | Inventory 5 lanes: 543 API endpoints, 63 async surfaces, 59 AI tools, 324 permissions, WorkflowTask survey — ทุกแถวมี file:line |
| F0.D | `6c08744e` | `docs/runbooks/feature-launch-control.md` — health-view contract + runbook R1-R8 + 18 TBD-F1 + 11 OPEN |
| F0.F | `5c7b99d4` | Cohorts C0-C6 + baseline B1-B8 (SQL replay ของ evaluator) + fixture recipes R0-R8 |
| F0.B | `8f369e49` | **RUNOFF_MATRIX 743 rows** (562 RESOLVED / 181 BLOCKED) + **FEATURE_LAUNCH_MATRIX 22 rows** (16 OPEN / 6 CLOSED) + AC crosswalk |
| F0.E | `671e1a24` | Capacity: non-atomic claim double-claims 99.5-100% @N≥2; atomic = 0 และเร็วกว่า 4.9×; claim cost O(backlog); lock ceiling ~80/s |
| F0.C | (this commit) | `docs/specs/feature-entitlement-derived-views.md` — ERD 21 entities, 7 state machines, glossary 68 คำ, invariant→test 162 ids, discrepancies D-1..D-10 |

ทุก lane ผ่านการตรวจอิสระโดย session หลัก (นับซ้ำจาก JSON, spot-check กับโค้ด/spec) ก่อน commit

## คำตัดสินที่ต้องการจาก owner (ตอบเป็นข้อได้เลย)

**A0 — อนุมัติ matrices เป็น F0 baseline (คำถามหลักของ AC29).** BLOCKED 181 แถว = route CLOSED + disable ของ feature นั้นถูก preflight-block จนกว่า family deep pass จะแก้ราย row — เป็น conservative ตามที่ plan ตั้งใจ ไม่มีการเดา
→ ข้อเสนอ: อนุมัติ

**A1 — Spec §6.3 ขาด family row 2 ตัว: `product_catalog`, `expense_auto_post`** (ช่องว่างของ spec จริง ไม่ใช่ inventory) + wording fixes จาก D-1 (enum WorkflowTask มี `CANCELED`), D-5 (แยกข้อความ fallback "ยังไม่ได้เปิดฟีเจอร์" ≠ "ซื้อแล้วแต่ใช้ชั่วคราวไม่ได้" ตาม spec:65), D-6 (นิยาม gateKey canonical ไม่มี prefix `[LATER] `)
→ ข้อเสนอ: ให้ session หลักร่าง spec amendment สั้นๆ ให้ approve ก่อนเริ่ม F1

**A2 — เลือก enum ที่เป็น key ของ correction tuple**: tax spec มี 2 ชุดแข่งกัน (`routeKind` 3 ค่า :1497 vs `returnCorrectionType` 6 ค่า :1418) และ `channelVersion` เป็น data-driven
→ ข้อเสนอ: ยังไม่ต้องเลือกวันนี้ — route ทั้ง namespace CLOSED อยู่แล้ว; มอบ FIN + ผู้เชี่ยวชาญภาษีเสนอกลับตอน family deep pass (ไม่บล็อค F1)

**A3 — `transitionKind` canonical enum ยังไม่มีนิยามที่ไหนเลย** → เหมือน A2: CLOSED อยู่แล้ว, FIN+specialist นิยามก่อน validate route แรก (ไม่บล็อค F1)

**A4 — มอบเจ้าของให้ BLOCKED 102 แถวใน bucket ไร้เจ้าของ** (unmapped permissions 37, AI gateway plane 24, NONE 22, UNRESOLVED 17 — แถวพวกนี้บล็อคการปิด "ทุก" feature จนกว่าจะ ruled)
→ ข้อเสนอ: unmapped/`admin.*`/`bi.*`/`system.*`/attachment/audit/document/outbox → PLATFORM; AI gateway plane → CRM; ค่อย ruling รายตัวใน F1 shadow

**A5 — historical label corrected and current boundary locked:** the original request incorrectly grouped all three jobs as read-only and pointed the capacity rerun to F0.E §7. Current execution authority is split:

- **`A5-RO`** — UAT-only direct execution as dedicated PostgreSQL role `watchdog_a5_ro`, no ECS task role, role-default plus transaction/session read-only, and `SELECT` on exactly `_prisma_migrations`, `Company`, `CompanyFeatureEntitlement`, `CompanyEntitlementNormalization`, `EntitlementTransition`, `AuditLog`, `CompanyOnboardingRun`, `FeatureLaunchGate`, `FeatureLaunchGateTransition`, `FeatureLaunchObservationBucket`, `ExecutionAttempt`, `RunoffSnapshot`, and `WorkflowTask`. It has no DML, database/schema `CREATE`, executable application `SECURITY DEFINER`, ownership, membership or inherited privilege. A5 emits only tenant-anonymous aggregates bound to exact serving/source full SHA, `queryCatalogHash` and deterministic `evidenceHash`. F2 PLAN and VERIFY use the same path. Only F2 APPLY may use the writer secret/durable wrapper and must re-plan under company lock/hash/version CAS. Production needs separate provisioning and review.
- **`A5-CAPACITY-MUTATING`** — the representative capacity/concurrency rerun in F0.E **§8**. It creates/claims/leases/updates/cleans fixture rows and therefore needs a separate explicit owner approval for exact isolated UAT scope, bounds, stop conditions and cleanup. It gates a future bounded batch and promotion/GA, not the current per-company state-only F2 APPLY.

Current readiness is intentionally split:

- `f2PrecheckReady` = exact serving/source SHA + true A5-RO + clean reviewed PLAN; authorizes only F2 APPLY.
- `enforcementReady(feature/route)` = normalized fixed point + applicable matrix + shadow/`would_block` + runoff + live UAT + capacity; authorizes only that exact feature/route.
- `promotionReady` = enforcement evidence + journeys/rollback/security/accessibility/usability + separate production read-only preflight; authorizes only an explicit production decision.

Shadow/capacity gaps are advisory for current per-company F2 and do not block APPLY, but they block enforcement/promotion. Every WHT route remains CLOSED. `JournalEntry.sourceType='expense.record'` is not auto-post provenance because manual/backfill and auto-post share it; preserve `expense_auto_post` ON only from an explicit enabled entitlement or separately reviewed worker-specific provenance. None of these internal steps requires customer migration, historical re-entry or a new form.

Live UAT note 2026-08-03: deploy run `30774515157` stopped safely because ECS reported `SUCCESSFUL` before the previous active configuration finished draining. Reconciliation left failed-confirmed, health/M-01 were not accepted, no route opened and production was untouched. It is not acceptance evidence; a bounded waiter fix and new full-SHA UAT deploy are required.

## สิ่งที่ไม่ต้องตัดสินใจ (บันทึกไว้เฉยๆ)

- D-2, D-3, D-4, D-7, D-9, D-10: ความคลาดเคลื่อน wording/รายละเอียดที่ F1 implement ตาม spec ตัวจริงได้ โดย derived-views ชี้ไว้แล้ว
- D-8: ฟีเจอร์ 16 ตัว "เปิดได้แต่ยังปิดไม่ปลอดภัย" — สถานะเดียวกับวันนี้อยู่แล้ว (ยังไม่มี preflight); จะดีขึ้นเรื่อยๆ เมื่อ family pass แก้ BLOCKED
- ความเสี่ยง F1 ที่พบจาก F0 และถูกจองเป็นงาน F1 แล้ว: atomic claim ก่อน batch ใดๆ, PROCESSING reclaim, always-on ต้อง reject explicit false, junk-row lockout detector, E2E fixture แบบมี entitlement rows, APP_ENV/UAT แยกไม่ออกต้องมี env source ใหม่ก่อน environment-CAS

## เมื่ออนุมัติแล้ว

F1 เริ่มทันที (Opus lanes): additive contracts + `CompanyEntitlementSet.setVersion` + `FeatureLaunchGate`/transitions + availability vectors + `ExecutionAttempt`/lease + `feature_not_enabled` error contract + partner save invariants — ตามลำดับ plan §3 F1 โดย migration additive-only + preflight ทุกตัว
