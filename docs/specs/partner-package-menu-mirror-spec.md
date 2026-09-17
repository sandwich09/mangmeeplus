# Spec: แพ็กเกจการใช้งาน = กระจกของเมนูบริษัท (Partner Package ↔ Menu Mirror)

Status: SPEC — approved by product owner 2026-07-29
Owner: Claude (harness engineer) → Codex (implementation)
Screen: `/system/partners/[companyId]` → section `แพ็กเกจการใช้งาน`
Supersedes the module-shaped section shipped by `docs/plans/feature-entitlement-submenu-plan.md`

## 1. Product goal

System Admin ขายฟีเจอร์เป็นรายเมนูให้แต่ละบริษัท หน้าจอที่ใช้ตั้งค่าจึงต้อง **หน้าตาเหมือนแถบเมนูที่บริษัทเห็นจริง** และสิ่งที่กดต้องเป็นสิ่งเดียวกับที่ลูกค้าได้/ไม่ได้ ไม่ใช่ชื่อโมดูลภายในที่ต้องแปลในหัวก่อน

ผู้ใช้: System Admin (ฝ่ายขาย/ซัพพอร์ตแพลตฟอร์ม)

Journey: เปิดบริษัท → เลือกแพ็กเกจสำเร็จรูป → ปรับรายเมนู → ดูแผงพรีวิวว่าแถบเมนูของลูกค้าจะเหลืออะไร → ตรวจสรุปการเปลี่ยนแปลง → บันทึกครั้งเดียว

## 2. ปัญหาที่แก้ (ยืนยันจากโค้ดจริง)

| # | ปัญหา | หลักฐาน |
|---|---|---|
| P1 | หน้าจอแอดมินจัดเป็น "โมดูล" 15 ตัว แต่ลูกค้าเห็น "เมนู" 20+ รายการ ชื่อคนละชุด (`จัดซื้อ/เจ้าหนี้` ↔ `จัดซื้อ` + `เจ้าหนี้การค้า`) | `FEATURE_CATALOG` vs `WORKSPACE_MODULES` |
| P2 | **การเบิกจ่าย** ขายแยกไม่ได้ — ติดมากับ `expenses` หรือ `procurement` | `PREFIX_FEATURE_RULES` `reimbursement.` → `['expenses','procurement']` |
| P3 | **สินค้าและบริการ** ขายแยกไม่ได้ — ติดมากับ `inventory` หรือ `crm` | prefix `inventory.product.` → `['inventory','crm']` |
| P4 | **เชื่อมต่อ LINE OA** ถูกคุมด้วยสวิตช์ CRM ทั้งที่เป็นช่องทาง/AI | prefix `crm.` ครอบ `crm.channel.*` |
| P5 | **แดชบอร์ด** ปิดไม่ได้เลย (`requiredAnyPermissions: []`) และ **การแจ้งเตือน** ปิดไม่ได้จริง เพราะ `dashboard.read`/`notification.read` อยู่ใน `pack.core.basics` ที่ไม่มี `featureEntitlementKey` | `web-core-workspace.constants.ts:10`, `capability-pack.registry.ts:28-31` |
| P6 | `crm.overview` ป้าย "ภาพรวม" route `/crm?tab=overview` แต่สวิตช์นี้ไปคุมเมนู **รายงาน CRM** (`/crm-reports`) และยังพ่วง `crm.ai.read` ที่ควรตามสวิตช์ AI | catalog vs `crmreport` module |
| P7 | ไม่มีเทสต์ใดผูก "สวิตช์ที่แอดมินกด" กับ "เมนูที่บริษัทเห็น" — เพี้ยนได้เงียบ ๆ ทุกครั้งที่ใครแก้ nav gate | — |
| P8 | บันทึกทีละสวิตช์ ทำให้ตั้งค่าบริษัทใหม่ต้องกด 20+ ครั้ง และไม่มีทางรู้ผลรวมก่อนกด | `FeatureEntitlementsSection.requestToggle` |

## 3. กติกาผลิตภัณฑ์ (product rules)

1. **หน่วยที่ขาย = เมนูในแถบข้างของบริษัท** ทุกเมนูที่ผู้ใช้เห็นต้องมีสวิตช์เดียวที่คุมมันตรง ๆ (ยกเว้นเมนูที่ประกาศว่าเป็น foundation)
2. **หน้าจอแอดมินเรียงและตั้งชื่อเหมือนแถบเมนูจริง** กลุ่ม/ลำดับ/ป้ายไทย/ไอคอน มาจากแหล่งเดียวกับที่บริษัทเรนเดอร์
3. **พรีวิวสด** ต้องบอกได้ก่อนบันทึกว่า "แถบเมนูของลูกค้าจะเหลืออะไร" โดยคิดจากสถานะที่ยังไม่บันทึก
4. **ปิด = หายทั้งเมนูและ API** ยังบังคับที่จุดเดียวเดิม (`filterPermissionsByEntitlement` ตอน resolve permission) ไม่เพิ่มการซ่อนเฉพาะ nav
5. **แพ็กเกจสำเร็จรูป** (เริ่มต้น / มาตรฐาน / ครบวงจร) กดครั้งเดียวเซ็ตทั้งชุด แล้วปรับรายเมนูต่อได้
6. **บันทึกรวมครั้งเดียว** มีสรุป diff ก่อนบันทึก แยกชัดว่าอะไร "จะหายไป" (อันตราย) กับ "จะเพิ่มเข้ามา"
7. **ห้ามเปลี่ยนสิ่งที่ลูกค้าเดิมเห็นอยู่** การเพิ่มสวิตช์ใหม่ต้องสืบทอดค่าจากกติกาเดิมแบบตรง ๆ (§6) ไม่มี migration ของ Prisma
8. `expense_auto_post` และ `ai_line_assistant` เป็นการทำงานเบื้องหลัง แยกจากกระจกเมนู ตามมติเจ้าของ 2026-09-17: ซ่อนทางเข้า `ai-suggestions` จากเมนูหลักและพรีวิวเมนูด้วย `navigation: contextual` แต่คง route สำหรับตรวจคำแนะนำตามสิทธิ์เดิม ไม่ใช่การปิด entitlement หรือ API; การปิดสวิตช์ AI จริงยังใช้ gate เดิม ส่วน expense auto-post คง guard COA readiness
9. บริษัท DISABLED/ARCHIVED (`fieldsLocked`) ล็อกทุกสวิตช์เหมือนเดิม

## 4. สวิตช์ใหม่ 3 ตัว + การบังคับใช้ที่หายไป 1 จุด

| key ใหม่ | ป้าย | คุมเมนู | prefix rule ที่เปลี่ยน |
|---|---|---|---|
| `reimbursement` | การเบิกจ่าย | `reimbursements` | `reimbursement.` → `['reimbursement']` (เดิม `['expenses','procurement']`) |
| `product_catalog` | สินค้าและบริการ | `crmsettings` | `inventory.product.` → `['product_catalog']` (เดิม `['inventory','crm']`) |
| `line_oa` | เชื่อมต่อ LINE OA | `lineoa` | เพิ่ม `crm.channel.` → `['line_oa']` **ก่อน** กฎ `crm.` (first match wins) |

`dashboard_notifications` มีอยู่แล้วแต่ไม่เคยบังคับใช้ — เพิ่ม prefix rules `dashboard.` และ `notification.` → `['dashboard_notifications']` (prefix ถูกเช็คก่อน pack ที่ไม่ถูก gate จึงชนะ `pack.core.basics` ได้) และเปลี่ยน nav gate ของเมนูแดชบอร์ดเป็น `['dashboard.read']`

### กับดักที่ต้องกัน (ห้ามข้าม)

- **T1 — STAFF เดิมไม่มี `dashboard.read` และ company-scoped custom roles บางบทบาทอาจไม่มี key นี้** ถ้าเปลี่ยน nav gate เฉย ๆ บทบาทเหล่านั้นจะเสียแดชบอร์ดทันที → ต้องเพิ่ม `dashboard.read` ใน STAFF bundle และเพิ่ม universal (`anchor: null`) `COMPANY_ROLE_BACKFILLS` เพื่อเป็น regression guard ให้ custom roles (สอดคล้องกับ `pack.core.basics` ที่ประกาศว่า "ทุกคนได้รับอัตโนมัติ") แล้วรัน permission sync ตอน deploy ซึ่งจะ re-sync system roles และ backfill custom roles แบบ additive โดยไม่ revoke
- **T2 — บริษัทเดิมที่มีแถว `dashboard_notifications = false`** จะเสียแดชบอร์ด+แจ้งเตือนทันทีที่ prefix rule ใหม่มีผล ทั้งที่ไม่เคยมีใคร "ตัดสินใจไม่ซื้อ" เพราะสวิตช์นี้ไม่เคยทำงาน → ต้องมีสคริปต์ backfill ตั้งแถวนั้นเป็น `true` และเพิ่ม `dashboard_notifications` ใน `DEFAULT_ENABLED_FEATURE_KEYS`
- **T3 — บริษัทใหม่** onboarding เขียนแถวชัดเจนทุก key และ `false` ชนะ → ต้องเพิ่ม `reimbursement`, `product_catalog`, `line_oa`, `dashboard_notifications` ใน `DEFAULT_ENABLED_FEATURE_KEYS` มิฉะนั้นบริษัทใหม่จะไม่มีเมนูเหล่านี้ทั้งที่วันนี้มี

## 5. ตารางผูกเมนู ↔ สวิตช์ (source of truth ใหม่)

`packages/contracts/src/menu-entitlements.ts`

```ts
export type MenuEntitlementBinding = {
  navKey: string;                   // === WorkspaceModule.key
  labelTh: string;                  // === ป้ายในแถบเมนูจริง (workspace-dictionary)
  group: 'main'|'operate'|'finance'|'growth'|'admin';   // === WorkspaceModule.navGroup
  iconKey: string;                  // === WorkspaceModule.iconKey
  parentFeatureKey: string | null;  // parent สำหรับ ownership/submenu; ไม่ใช่ตัวชี้ว่าเป็น foundation
  entitlementKeys: string[];        // key ที่การ์ดเขียนเวลา toggle; ว่าง = foundation ปิดไม่ได้
  gatePermissions: string[];        // คัดลอกจาก WorkspaceModule.requiredAnyPermissions ตรง ๆ
  navigation?: 'contextual';        // ไม่แสดงในเมนูหลัก; route ยังตรวจสิทธิ์เดิม
  status: 'ready' | 'planned';
};
```

### 5.1 กติกาความเป็นเจ้าของ (ownership) — เพิ่มหลังพบข้อขัดแย้ง 2026-07-29

เมนูจะ "ปิดแล้วหายจริง" ได้ ต่อเมื่อ **ทุก** permission ใน `gatePermissions` เป็นของ entitlement ที่การ์ดนั้นคุม (gate เป็น OR — เหลือรอดตัวเดียวเมนูก็ยังอยู่) ตอนตรวจพบว่ามี 4 เมนูที่ไม่เข้าเงื่อนไข จึงตัดสินดังนี้:

นิยาม foundation ดูจาก `entitlementKeys.length === 0` เท่านั้น; `parentFeatureKey` อาจมีค่าเพื่อผูก submenu ได้ และไม่ได้ทำให้การ์ด foundation มีสวิตช์แม่

| เมนู | ปัญหา | ทางออก |
|---|---|---|
| `reports` รายงานการเงิน | gate มี `ledger.report.read` / `ledger.period.read` ซึ่งเป็นของ `double_entry_ledger` | **แคบ nav gate เหลือ `['report.catalog.read']`** — ตรวจแล้วทุก role bundle ที่ถือ `ledger.report.read` ถือ `report.catalog.read` ด้วยเสมอ (ผ่านชุด `REPORT_BI_*_GRANTS`) จึงไม่มีบทบาทใดเสียเมนู |
| `accounting` บัญชี (planned) | gate มี `ledger.report.read` ปนกับคีย์ `accounting.*` | **แคบ nav gate เหลือ `['accounting.document.read','accounting.invoice.read']`** ตามแบบแผนเดิมของ repo ที่ระบุว่า nav gate ควรมีเฉพาะคีย์ของฟีเจอร์ตัวเอง |
| `settings` ตั้งค่าบริษัท | `company.settings.view` ไม่ผูกกับ pack ใด และ `company.setup.manage` ตั้งใจไม่ถูก gate (มีเทสต์เดิมยืนยัน) | **ประกาศเป็นเมนูพื้นฐาน ปิดไม่ได้** ด้วย `entitlementKeys: []`; ใช้ `parentFeatureKey: 'company_settings'` เพื่อแสดงสวิตช์ลูก สาขา / ความปลอดภัยบัญชี โดยตัวการ์ดยังไม่มีสวิตช์และแสดงป้าย "พื้นฐาน — ปิดไม่ได้"; เมื่อเปิดลูก ระบบเปิด parent ด้วยเพื่อกู้สถานะเดิมที่มี `company_settings=false` |
| `discount` นโยบายส่วนลด (planned) | `company.setup.read` ตั้งใจไม่ถูก gate และไม่มีเมนูลูก | **ประกาศเป็นเมนูพื้นฐาน ปิดไม่ได้** ด้วย `parentFeatureKey: null`, `entitlementKeys: []` |

ห้ามแก้ปัญหานี้ด้วยการขยายการ gate คีย์ foundation หรือย้าย chokepoint — เมนูพื้นฐานปิดไม่ได้เป็นคำตอบที่ซื่อตรงกว่าการทำสวิตช์ที่กดแล้วไม่เกิดอะไร

| navKey | ป้าย | กลุ่ม | parent | entitlementKeys |
|---|---|---|---|---|
| `dashboard` | แดชบอร์ด | main | `dashboard_notifications` | `[dashboard_notifications]` |
| `inbox` | กล่องข้อความ | operate | `crm` | `[crm.inbox]` |
| `customers` | ลูกค้า | operate | `crm` | `[crm.customers]` |
| `booking` | การจองออนไลน์ | operate | `crm` | `[crm.bookings]` |
| `crmreport` | รายงาน CRM | operate | `crm` | `[crm.overview]` |
| `crmsettings` | สินค้าและบริการ | operate | `product_catalog` | `[product_catalog]` |
| `salesdoc` | เอกสารขายและรับชำระ | operate | `sales_documents` | `[sales_documents]` |
| `sales` (planned) | การขาย | operate | `sales_documents` | `[sales_documents]` |
| `inventory` | คลังสินค้า | operate | `inventory` | `[inventory]` |
| `procurement` | จัดซื้อ | operate | `procurement` | `[procurement.suppliers, procurement.purchase_requests, procurement.purchase_orders, procurement.goods_receipts]` |
| `workflow` | เวิร์กโฟลว์ | operate | `workflow_automation` | `[workflow_automation]` |
| `ai-suggestions` (contextual; ไม่ใช่เมนูหลัก) | ผู้ช่วย AI ทาง LINE — สวิตช์เบื้องหลัง | operate | `ai_line_assistant` | `[ai_line_assistant]` |
| `expenses` | ค่าใช้จ่ายและใบเสร็จ | finance | `expenses` | `[expenses]` |
| `reimbursements` | การเบิกจ่าย | finance | `reimbursement` | `[reimbursement]` |
| `journal` | สมุดรายวัน | finance | `double_entry_ledger` | `[double_entry_ledger]` |
| `accounting` (planned) | บัญชี | finance | `sales_documents` | `[sales_documents]` |
| `tax` | ภาษี | finance | `thai_tax` | `[thai_tax]` |
| `accounts-payable` | เจ้าหนี้การค้า | finance | `procurement` | `[procurement.vendor_bills, procurement.supplier_payments, procurement.ap_aging]` |
| `banking` | บัญชีธนาคาร | finance | `bank_reconciliation` | `[bank_reconciliation]` |
| `reports` | รายงานการเงิน | finance | `reports` | `[reports]` |
| `closing` (planned) | ปิดงวด | finance | `double_entry_ledger` | `[double_entry_ledger]` |
| `crm` | ลูกค้า (CRM) | growth | `crm` | `[crm]` |
| `roles` | พนักงานและสิทธิ์ | admin | `employee_access` | `[employee_access]` |
| `settings` | ตั้งค่าบริษัท | admin | `company_settings` | `[]` (พื้นฐาน) |
| `notifications` | การแจ้งเตือน | admin | `dashboard_notifications` | `[dashboard_notifications]` |
| `lineoa` | เชื่อมต่อ LINE OA | admin | `line_oa` | `[line_oa]` |
| `poapproval` (planned) | อนุมัติคำสั่งซื้อ | admin | `procurement` | `[procurement.purchase_orders]` |
| `discount` (planned) | นโยบายส่วนลด | admin | `null` | `[]` (พื้นฐาน) |

หมายเหตุ: การ์ดที่ใช้ parent เดียวกัน (`procurement` 2 ใบ, `crm` 5 ใบ, `dashboard_notifications` 2 ใบ) ตั้งใจให้เป็นเช่นนั้น — กติกาการเขียนอยู่ใน §7

### ปรับ catalog เดิม 1 จุด (P6)

`crm.overview` → `labelTh: 'รายงาน CRM'`, `route: '/crm-reports'`, `permissionKeys: ['crm.report.read']` (ตัด `crm.ai.read` ออก ให้ตกไปตามกฎ prefix `crm.ai.` → AI) **ห้ามเปลี่ยน key** เพราะมีแถวในฐานข้อมูลแล้ว

## 6. กติกาการสืบทอดค่า (ห้ามมีใครเสียเมนู)

`loadEntitledFeatureKeys` และหน้าจอแอดมินต้องใช้กติกาเดียวกัน:

```ts
export const LEGACY_FEATURE_INHERITANCE: Record<string, string[]> = {
  reimbursement:   ['expenses', 'procurement'],  // เดิมเปิดถ้าอย่างใดอย่างหนึ่งเปิด
  product_catalog: ['inventory', 'crm'],
  line_oa:         ['crm'],
};
```

- บริษัทที่ **ไม่มีแถว** ของ key ใหม่ → ถือว่าเปิด เมื่อ key ต้นทางอย่างน้อยหนึ่งตัวเปิด
- มีแถวชัดเจนเมื่อไร แถวชนะเสมอ
- กติกาลูกเมนูเดิมไม่เปลี่ยน: ลูกไม่มีแถว = สืบทอดจากแม่, `false` ชัดเจนเท่านั้นที่ปิด, แม่ปิด = ลูกปิดทั้งหมด

## 7. กติกาการเขียนค่าเมื่อกดสวิตช์การ์ด (pure function, ต้องมีเทสต์)

```
toggleMenu(state, binding, next) -> changes: Array<{featureKey, enabled}>
  next === true :  set parentFeatureKey = true
                   set ทุกตัวใน entitlementKeys = true
  next === false:  ถ้า entitlementKeys === [parentFeatureKey] → set parent = false
                   มิฉะนั้น set ทุกตัวใน entitlementKeys = false (ไม่แตะ parent)
```

- **สถานะการ์ด** = `parent เปิด && entitlementKeys อย่างน้อยหนึ่งตัวมีผลเป็นเปิด`
- **พรีวิวเมนู** ใช้สถานะการ์ดตัวเดียวกัน — เมนูจะแสดงก็ต่อเมื่อการ์ดเปิด
- ปิดการ์ด `จัดซื้อ` ไม่ทำให้ `เจ้าหนี้การค้า` หาย และกลับกัน เพราะเขียนคนละชุดลูก

## 8. แพ็กเกจสำเร็จรูป

`packages/contracts` — `FEATURE_PACKAGE_PRESETS`

| preset | ประกอบด้วย |
|---|---|
| `starter` เริ่มต้น | `dashboard_notifications`, `expenses`, `expenses.list`, `expenses.upload`, `expenses.manual`, `expenses.categories`, `expenses.evidence`, `expenses.signatures`, `reimbursement`, `ai_line_assistant`, `employee_access`, `employee_access.employees`, `employee_access.roles`, `employee_access.overview`, `company_settings`, `company_settings.branches`, `company_settings.security` — คง 7 ความสามารถ: 6 ทางเข้าการใช้งาน (แดชบอร์ด, ค่าใช้จ่ายและใบเสร็จ, การเบิกจ่าย, พนักงานและสิทธิ์, ตั้งค่าบริษัท, การแจ้งเตือนที่ส่วนหัว) และผู้ช่วย AI เบื้องหลัง ไม่เพิ่มเมนูใหม่ทดแทน |
| `standard` มาตรฐาน | ทุก key ของ starter + `crm`, `crm.inbox`, `crm.customers`, `product_catalog`, `line_oa`, `sales_documents`, `thai_tax`, `double_entry_ledger`, `reports`, `crm.overview`, `crm.leads`, `crm.pipeline`, `crm.followups`, `crm.bookings`, `inventory` |
| `full` ครบวงจร | ทุก key **ยกเว้น** `expense_auto_post` (ต้องผ่าน COA readiness ก่อน จึงเปิดเองเท่านั้น) |

กด preset = เตรียมค่าลงสถานะที่ยังไม่บันทึก (ไม่ยิง API ทันที) แล้วผู้ใช้ปรับต่อได้

คำตัดสินเจ้าของ 2026-09-11: “เริ่มต้น” หมายถึง preset เดิมนี้เสมอ (มติ 2026-09-17 ปรับการแสดงผลเป็น 6 ทางเข้าและ AI เบื้องหลัง โดยคง keys เดิม) แยกจากแพ็กเกจราคา บริษัทใหม่ที่ไม่ได้ระบุ preset ใช้ starter; การเปลี่ยนราคา/อายุไม่เปลี่ยนสิทธิ์ และบริษัทเดิมเก็บสิทธิ์เดิมไว้ ดู [Starter QA fixes](starter-web-qa-fixes-spec.md)

Preset เป็น data contract แบบ explicit: `applyPreset` เขียนแถวให้ทุก entitlement key และเขียน key ที่ไม่อยู่ใน preset เป็น `false` จึงต้องระบุ child key ทุกตัวที่ตั้งใจเปิด ห้ามพึ่ง inheritance

API regression guard สร้างแถวแบบเดียวกับ `applyPreset`, derive entitled set ด้วยกติกาเดียวกับ `loadEntitledFeatureKeys` (parent เปิดและ child ไม่ได้ถูกปิดชัดเจน) แล้วตรวจทุก binding ของทุก preset ว่า `card-enabled === menu-visible` โดย foundation คือ `entitlementKeys.length === 0`, การ์ดทั่วไปคือ parent เปิดและมี entitlement key อย่างน้อยหนึ่งตัวเปิด, และ menu-visible คือ `filterPermissionsByEntitlement(gatePermissions, entitled).length > 0`

## 9. UI

```
┌─ แพ็กเกจการใช้งาน ─────── [เริ่มต้น][มาตรฐาน][ครบวงจร] · เปิด 14/26 เมนู ──┐
│ [ ค้นหาเมนู… ]                                    │  เมนูที่บริษัทจะเห็น    │
│ ── ลูกค้าและการขาย ──────── [เปิดทั้งกลุ่ม/ปิด]   │  ┌──────────────────┐ │
│  💬 กล่องข้อความ            /inbox        [●]     │  │ 🏠 แดชบอร์ด       │ │
│  👥 ลูกค้า                  /customers    [●]     │  │ ลูกค้าและการขาย   │ │
│  📅 การจองออนไลน์           /bookings     [○]     │  │ 💬 กล่องข้อความ   │ │
│  📊 รายงาน CRM              /crm-reports  [●]     │  │ 👥 ลูกค้า         │ │
│  🏷 สินค้าและบริการ         /settings/... [●]     │  │ 📊 รายงาน CRM     │ │
│ ── การเงินและบัญชี ──────────────────────────     │  │ การเงินและบัญชี   │ │
│  🧾 ค่าใช้จ่ายและใบเสร็จ    /expenses     [●]     │  │ 🧾 ค่าใช้จ่ายฯ    │ │
│     ▾ เมนูย่อย 5/6                                │  │ 💵 การเบิกจ่าย    │ │
│  💵 การเบิกจ่าย             /reimburse…   [●]     │  └──────────────────┘ │
│ ── การทำงานเบื้องหลัง (ไม่ใช่เมนู) ──────────     │  ☐ แสดงเมนูที่ปิดด้วย  │
│  ⚡ ผู้ช่วย AI ทาง LINE                 [●]     │                        │
│  ⚡ ลงบัญชีค่าใช้จ่ายอัตโนมัติ            [○]     │                        │
└── มีการเปลี่ยนแปลง 3 รายการ  [คืนค่า] [ตรวจสอบและบันทึก] ────────────────┘
```

- ป้าย/ไอคอน/ลำดับกลุ่ม มาจาก binding + `workspace-dictionary` + `WORKSPACE_ICON_NODES` ตัวเดียวกับแถบเมนูจริง
- ใต้การ์ดแสดง route จริงเป็น mono และ key ภายในเป็นตัวเล็กสีจาง (ไว้ซัพพอร์ต)
- การ์ดที่มีลูก (expenses, procurement, banking, workflow, crm, inventory, …) กดขยายดู/สลับลูกได้เหมือนเดิม
- การ์ด `planned` แสดงป้าย "เร็วๆ นี้" และตั้งค่าล่วงหน้าได้
- พรีวิวเป็นแผงสติกกี้ฝั่งขวา (บนจอแคบไปอยู่ด้านบนแบบพับได้) บอกกำกับว่า "สำหรับผู้ใช้ที่มีสิทธิ์ครบ — พนักงานจะเห็นน้อยกว่านี้ตามบทบาท"
- แถบล่างสติกกี้: จำนวนที่เปลี่ยน + คืนค่า + ตรวจสอบและบันทึก → โมดัลสรุป diff แยก "จะหายไป" (แดง) / "จะเพิ่ม" (เขียว) แล้วยิง PUT ครั้งเดียว
- ใช้ระบบดีไซน์ Mangmee เดิม (`mangmee-card`, `mangmee-badge`, `mangmee-icon-frame`, tone) ไม่เพิ่ม dependency

## 10. Acceptance criteria

- AC1 ทุก `WORKSPACE_MODULES` มี binding ครบ (เทสต์บังคับ) และ `gatePermissions` ตรงกับ `requiredAnyPermissions` ทุกตัว
- AC2 สำหรับ binding ที่มี `entitlementKeys` ไม่ว่าง: ปิดเฉพาะ key ชุดนั้นแล้ว permission **ทุกตัว** ใน `gatePermissions` ถูก strip → เมนูหายจริง และเปิดคืนแล้วรอดอย่างน้อยหนึ่งตัว → เมนูกลับมา (เทสต์ฝั่ง API)
- AC2b สำหรับ binding พื้นฐาน (`entitlementKeys` ว่าง): ต่อให้ปิด entitlement ทุกตัวในระบบ ต้องยังมี permission ใน `gatePermissions` รอดอย่างน้อยหนึ่งตัว — ยืนยันว่าเมนูพื้นฐานไม่มีทางถูกปิดโดยบังเอิญ
- AC3 บริษัทเดิม (`expenses: true`, ไม่มีแถวลูก, ไม่มีแถว key ใหม่) ได้ permission ชุดเดิมเป๊ะเมื่อเทียบกับก่อนแก้ ยกเว้นผลของ backfill T2
- AC4 การเบิกจ่าย / สินค้าและบริการ / LINE OA / แดชบอร์ด+แจ้งเตือน ปิดแยกได้จริงทีละตัว
- AC5 กด preset แล้วสถานะทุก key ตรงตาม §8 และยังไม่บันทึกจนกว่าจะกดยืนยัน
- AC6 บันทึกครั้งเดียวส่งเฉพาะ key ที่เปลี่ยน และ audit `system.partner_feature.update` มี `changedKeys` ครบ
- AC7 ไม่มี Prisma migration, ไม่มี permission key ใหม่ (มีแต่การเพิ่ม `dashboard.read` เข้า STAFF bundle และ additive backfill สำหรับ company-scoped custom roles)

## 11. Out of scope

per-role menu override (G15), การกำหนดราคา/บิลลิ่ง, เมนู LIFF/LINE, การ gate แท็บภาษี VAT/WHT/CIT (ไม่มี key รายชนิด), เปลี่ยน chokepoint การบังคับสิทธิ์
