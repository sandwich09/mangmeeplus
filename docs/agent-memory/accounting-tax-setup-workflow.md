# Agent Memory: Accounting and Thai Tax Setup Workflow

Status: IMPLEMENTED AND AUTOMATED CHECKS PASS; signed-in browser UAT pending
Owner: Codex
Scope: Settings navigation reachability and a multi-route accounting/Thai-tax setup workflow covering
prerequisites, chart, profile, mappings, activation, and return to a blocked expense.

Decisions:

- Keep Ledger/Tax domain separation and fail-closed activation.
- Make Settings an expandable sidebar parent with permission-correct children.
- Replace three equal-weight technical setup cards with one guided workflow entry; retain existing pages
  as advanced maintenance.
- Render one workflow step per route with one primary CTA; do not add a wizard-state table.
- Derive progress from chart/profile/rule state and require explicit choice when multiple drafts exist.
- Add a read-only per-profile readiness endpoint that reuses activation validation.
- Add a review-gated WatchDog domestic-expense preset (`V7`, `ND`) for non-SAP companies; creation is
  `DRAFT`/`REVIEW_REQUIRED` and accountable review remains mandatory before activation.
- Suggestions may use only the exact reviewed chart mapping manifest and remain review-required.
- Do not auto-enable entitlements, auto-activate profiles, guess accounts, or alter issued history.

Open questions:

- Production tax reviewer confirmation of `V7` claimability/evidence posture and visible Thai labels.
- Production effective-date guidance for pre-existing open documents.
- Signed-in desktop/mobile UAT with a zero-account legacy company and a newly onboarded company.

Artifacts:

- `docs/specs/accounting-tax-setup-workflow-spec.md`
- `docs/plans/accounting-tax-setup-workflow-plan.md`
- `docs/agent-memory/accounting-tax-setup-workflow.md`
- `apps/web/src/features/accounting-tax-setup/`
- `apps/web/app/(workspace)/companies/[companyId]/settings/accounting-tax-setup/`
- `apps/api/src/modules/tax/application/use-cases/transaction-tax-config.use-case.ts`
- `apps/api/src/modules/tax/domain/tax-code-template.catalog.ts`

Verification:

- `corepack pnpm --filter @watchdog-bms/contracts build` — PASS.
- Focused API catalog/readiness/controller/chart/menu suites — PASS, 26 tests.
- `corepack pnpm --filter @watchdog-bms/api test:item11b-tax` — PASS, 271 tests.
- `corepack pnpm --filter @watchdog-bms/api typecheck` — PASS.
- Focused web workflow/navigation/sidebar suites — PASS, 58 tests.
- `corepack pnpm --filter @watchdog-bms/web test` — PASS.
- `corepack pnpm --filter @watchdog-bms/web typecheck` — PASS.
- `git diff --check` — PASS before final documentation update; rerun at handoff.
- Reviewed tenant scoping, permission parity, activation/readiness parity, same-company return target,
  chart checksum guards, advanced-route compatibility, immutable issued snapshots, and lack of data
  migrations/new dependencies.

Next:

- Run the signed-in browser/UAT journey recorded in spec scenario 20 in a deployed/local environment
  with representative company data.
- Obtain production accounting sign-off before activating the baseline for a real company.

## 2026-08-05 — เมนูและขั้นตอนภาษีสำหรับบริษัทที่ไม่จด VAT

- **gate ของเมนูแคบลง**: ถอด `company.settings.view` ออกจาก `requiredAnyPermissions` ของการ์ด "ตั้งค่าบัญชีและภาษี" (`settings-menu.logic.ts`) — permission นั้นเป็นของ `COMPANY_VIEW` ซึ่งรันวิซาร์ดไม่ได้สักขั้น ผลคือ COMPANY_VIEW เท่านั้นที่หลุด · OWNER (ได้ทุก key), ADMIN (`company.setup.manage`), ACCOUNTANT/FINANCE/MANAGER/AUDITOR (`ledger.account.*` / `tax.*`) ยังเข้าได้เหมือนเดิม ตรวจ role grants ก่อนแก้แล้ว
- **ไม่ยุบขั้นตอน** (owner เลือกแบบที่ 2): บริษัทที่ตอบว่า `NOT_REGISTERED` เห็นข้อความบอกว่าขั้นผังบัญชียังจำเป็น ส่วนขั้น Tax Profile/ผูกรายงานยังไม่จำเป็น — ทุกขั้นยังกดเข้าได้ เพราะสถานะ VAT เปลี่ยนได้ และการซ่อนขั้นทำให้คนที่เพิ่งจด VAT หาทางกลับไม่เจอ
- อ่านสถานะจาก `GET /vat-registration` ตรงๆ ไม่ใช่ capture-policy ของ expenses เพราะคนละ permission family (ผู้ตั้งค่าภาษีอาจไม่มีสิทธิ์ expense) · **`UNKNOWN` ไม่ขึ้นข้อความ** เพราะยังไม่มีใครตอบ การบอกว่า "ไม่จำเป็น" จากคำถามที่ยังไม่ได้ตอบคือการเดา · ไม่มีสิทธิ์อ่าน → 403 → ไม่ขึ้นข้อความ = หน้าจอเดิมทุกอย่าง
- **วิซาร์ดนี้ยังจำเป็น**: 5 ขั้น มีแค่ 2 ขั้นที่เป็นเรื่องภาษี ขั้นผังบัญชีทุกบริษัทที่ใช้ ledger ต้องใช้ และฟีเจอร์ "หมวดหมู่ → Tax Code" ก็ไม่มีอะไรให้เลือกถ้าไม่มี Tax Profile จากที่นี่

- **ถอดตัวเลือก "บัญชีไทยมาตรฐาน / SAP ERP" ออกจากวิซาร์ด** (2026-08-05): มันเป็น dropdown ที่กดได้จริงบนหน้าที่ prerequisite ทุกข้อยังขึ้น "ยังเปิดให้ใช้ไม่ได้" และเป็นคำถามที่เจ้าของร้าน SME ตอบไม่ได้ · วิซาร์ดติดตั้งชุด WATCHDOG อย่างเดียวแล้ว · **ไม่เสียความสามารถ SAP** เพราะมีบ้าน 3 ทางบนหน้า Tax Code: รายการ built-in templates (ไม่กรอง), import CSV/JSON canonical, และสร้าง profile เองพร้อมเลือก sourceSystem — ทั้งหมด gate ด้วย `tax.config.manage` ซึ่งเหมาะกับคนที่รู้ว่ากำลังทำอะไร
- ถอด `mode` ออกทั้งสาย (state, ทั้ง 2 dropdown, Stepper prop, href param, Route searchParam) ไม่ทิ้ง plumbing ครึ่งๆ ไว้ — บทเรียนจาก G7
- **การ์ดตามสถานะ entitlement เองแล้ว** (2026-08-05): ถอด `company.setup.manage` ออกจาก gate ทั้งการ์ดและ route guard · เป็นคีย์ **always-on** (ไม่มี `featureEntitlementKey`) จึงเป็นคีย์เดียวที่รอดเมื่อบริษัทไม่มีทั้ง `double_entry_ledger` และ `thai_tax` → การ์ดยังโชว์วิซาร์ดที่ทุกขั้นขึ้น "ยังเปิดให้ใช้ไม่ได้" · วิซาร์ดไม่ได้ใช้คีย์นี้ที่ไหนเลย
  **ไม่ต้องเพิ่มกลไกใหม่** — `filterPermissionsByEntitlement` ตัด `tax.*`/`ledger.*` ของ feature ที่ปิดอยู่แล้วแบบ role-agnostic (ตัด OWNER ด้วย) เหลือแค่ให้ gate มีเฉพาะคีย์ที่ถูก gate จริง
  **impact**: ADMIN หายไป (มี `setup.manage` แต่ไม่มี ledger/tax เลย รันไม่ได้สักขั้น) · OWNER เห็นเมื่อเปิด feature หายเมื่อปิดทั้งสอง · ACCOUNTANT/FINANCE/MANAGER/AUDITOR ไม่กระทบ
  หมายเหตุ: route `/settings/substitute-receipt` ก็ gate ด้วย `company.setup.manage` แต่**ตรงกับ API ของมันเป๊ะ** (`expense.controller.ts:456`) จึงไม่ใช่ leak แบบเดียวกัน ไม่แตะ
