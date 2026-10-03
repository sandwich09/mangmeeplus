# Agent Memory: sold-features-fixes-2026-10-04

## Status
Implementation and sandbox verification complete; ready for controller review. Changes remain uncommitted.

## Owner
Codex implementation lane; controller owns commits, PostgreSQL and browser verification.

## Scope
Read-only expense facts; narrow company tax signature read; package-aware role menus/descriptions and platform-role visibility; sold notification routes; honest retained report history; expense selectors/read notices; duplicate claim warning; forbidden pages inside workspace shell.

## Decisions
- Ponytail full; existing entitlement evaluator, permission guard, dictionary, matrix and shell patterns. No dependencies, package manifests, migrations, feature switches or cloud work.
- Signature settings will read only signature fields using the existing signature management permission; full tax profile remains tax-only. This page is specific to 50 ทวิ, not PND53.
- Role matrix hides unsold menus, following existing package/menu filtering.
- Reports keep the existing retained-artifact path; no assertion that a shop previously bought reports, no creation/export action in history-only mode.
- Notification preset currently omits preferences/rules subfeatures. Explicitly disabled subfeatures remain disabled; preset correction does not rewrite stored customer entitlements.

## Open questions
- Browser and real PostgreSQL not checked: prohibited/unavailable in this lane.
- Existing paid snapshots with explicit false notification subfeatures are not rewritten. Controller must distinguish preset omissions from intentional overrides before reapplying corrected entitlements; no migration/data change is included.
- Saved STAFF screenshot shows one visible receipt warning; the HTML also repeats it as the disabled button title. Fixed that duplication through aria-describedby, and suppressed identical submit errors. Live reproduction not checked.

## Artifacts
Code covers all five brief items. The role matrix hides unsold menus (existing package-menu binding pattern), rather than displaying empty/disabled unsold boxes. Signature settings are specific to 50 ทวิ and use the existing signature-management grant; PND53 and full tax gates remain separate.

Changed paths:
- `apps/api/src/modules/auth/auth.guard.spec.ts`
- `apps/api/src/modules/employee-access/application/dto/employee-access.mapper.ts`
- `apps/api/src/modules/employee-access/application/use-cases/get-access-matrix.use-case.spec.ts`
- `apps/api/src/modules/employee-access/application/use-cases/get-access-matrix.use-case.ts`
- `apps/api/src/modules/employee-access/application/use-cases/get-role.use-case.ts`
- `apps/api/src/modules/employee-access/application/use-cases/list-roles.use-case.ts`
- `apps/api/src/modules/employee-access/application/use-cases/role-management.use-case.spec.ts`
- `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts`
- `apps/api/src/modules/tax/presentation/http/tax.controller.ts`
- `apps/web/src/common/components/field/ThemedSelect.tsx`
- `apps/web/src/common/i18n/workspace-dictionary.ts`
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`
- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `apps/web/src/features/expenses/ExpensesUi.tsx`
- `apps/web/src/features/expenses/expense-capture-status.logic.ts`
- `apps/web/src/features/expenses/expense-review-validation.ts`
- `apps/web/src/features/reimbursements/ReimbursementJourneyPage.tsx`
- `apps/web/src/features/reports/ReportsWorkspacePage.tsx`
- `apps/web/src/features/tax/TaxSignatureSettingsPage.tsx`
- `apps/web/src/features/tax/tax.api.ts`
- `apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx`
- `apps/web/src/features/web-core-workspace/route-permissions.ts`
- `docs/specs/dashboard-notification-spec.md`
- `docs/specs/employee-access-role-management-spec.md`
- `docs/specs/expense-receipt-upload-spec.md`
- `docs/specs/reimbursement-step-journey-spec-th.md`
- `docs/specs/reports-bi-spec.md`
- `docs/specs/web-core-workspace-spec.md`
- `docs/specs/wht-certificate-system-issuance-spec.md`
- `packages/contracts/src/feature-entitlements.spec.ts`
- `packages/contracts/src/menu-entitlements.ts`
- `apps/web/src/features/web-core-workspace/sold-features-regressions.spec.ts`
- This memory file.

No package manifest, Prisma schema, migration, paid-invoice.ts, billing-schedule.ts, cloud environment, server, network, browser, git index, commit or branch was changed.

## Verification
All new/changed behavioral tests have red and green evidence. A controlled replay restored HEAD production files (not test changes), exposed the existing private FieldIssueNote solely to render its old logic, rebuilt contracts, ran the tests, then restored the fixes and rebuilt contracts. No git mutation command was used.

Command prefixes:
- A: `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec`
- W: `pnpm --filter @watchdog-bms/web exec node --import tsx --test`
- C: `pnpm --filter @watchdog-bms/contracts exec node --import tsx --test`
- H: `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh`

| Command | Red (old behavior) | Final green |
| --- | --- | --- |
| C `src/feature-entitlements.spec.ts` | exit 1: 25 pass, 1 fail | exit 0: 26 pass, 0 fail |
| A `src/modules/auth/auth.guard.spec.ts src/modules/employee-access/application/use-cases/get-access-matrix.use-case.spec.ts src/modules/employee-access/application/use-cases/role-management.use-case.spec.ts` | exit 1: 81 pass, 11 fail | exit 0: 92 pass, 0 fail |
| W `src/features/web-core-workspace/sold-features-regressions.spec.ts` | exit 1: 0 pass, 8 fail (initial 8 tests) | exit 0: 9 pass, 0 fail |
| W `--test-name-pattern='never describes loading' src/features/web-core-workspace/sold-features-regressions.spec.ts` | exit 1: 0 pass, 1 fail before the last empty-state fix | included in final 9 pass |
| A above plus `src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts` | n/a | exit 0: 135 pass, 0 fail |
| W regression file plus `src/features/expenses/{expense-review-validation.spec.ts,expense-capture-status.logic.spec.ts,ExpenseReviewPage.qa.spec.ts,ExpensesPages.qa.spec.ts}` and `src/features/reports/reports-ui.logic.spec.ts src/features/dashboard-notifications/NotificationPages.spec.ts` (explicit paths, not literal brace syntax) | n/a | exit 0: 128 pass, 0 fail before last added regression |
| `pnpm --filter @watchdog-bms/contracts build` | exit 0 for old-code replay | exit 0 after restoration |
| H `pnpm --filter @watchdog-bms/api typecheck` | n/a | exit 0; no diagnostics |
| H `pnpm --filter @watchdog-bms/web typecheck` | n/a | exit 0; no diagnostics (also rerun after final edit) |
| H `pnpm --filter @watchdog-bms/web exec node --import tsx --test 'src/**/*.spec.ts'` | n/a | exit 0: 2789 pass, 0 fail, 0 skip (earlier run 2788/0 before the final added regression) |
| `git diff --check` | n/a | exit 0 |

No S3_* variables were present in the environment for either whole-web run. All added API tests were verified to be in files listed by apps/api/package.json's test script.

Initial implementation iterations: API 87 pass/5 fail before fixes; intermediate runs 79/13 and 91/1 caught implementation/test-fixture mismatches; repaired to 92/0 before the controlled old-code replay. First contracts command's surrounding shell returned 0 because it ended with tail, but pnpm's output explicitly reported exit 1; the later controlled replay recorded the actual exit 1 directly. No intermediate failed run is represented as passing.

Old-wording scan: `rg -l -F -f .sold-old-words.txt apps/api apps/ai-gateway apps/web e2e --glob '*spec*' --glob '*test*'`, exit 0, one match: `e2e/expenses.spec.ts` (unchanged editor wording in a comment at line 187). No unit-spec stale expectation found. This E2E is for the controller, not run here.

Red API cases (each green after restoration):
1. ENTERPRISE signature manager allowed / STARTER and non-manager refused / full tax profile remains closed.
2. Signature-only select, tenant match and missing-profile defaults.
3. Disabled menus absent from the matrix (updated existing case).
4. STARTER matrix has only purchased menus, even with zero role grants.
5–8. Owner/admin/manager assignability lists omit SYSTEM_ADMIN (four updated cases).
9. By-id platform role visibility includes SYSTEM_ADMIN refusal (updated case).
10. SYSTEM_ADMIN and historical copies absent from shop list, available in platform tenant.
11. Standard role descriptions do not promise unsold work.

Red web cases (each green after restoration): read-only extraction hints; all validation facts/editor wording; unfinished-read reason order/no tick; wrapping selectors; narrow signature endpoint/error/padding; denied URL shell and route permission rules; truthful retained report history/no export; one receipt-policy warning; loading/failed history is not an empty result.

Red contracts case: every paid tier contains preferences and rules subfeatures.

Raw local test logs are ignored `.sold-*.log` files; these counts are recorded here so the diff carries the evidence.


### Wording inventory

Read-only field variants below; editable text is unchanged. Parameters are interpolated values, not printed code tokens.

| Locale / field | Old reader text | New reader text | Case |
| --- | --- | --- | --- |
| th / `expenses.v_wht_base` | กรอกฐานหักเป็นจำนวนบาทตั้งแต่ 0 และทศนิยมไม่เกิน 2 ตำแหน่ง | ฐานหัก ณ ที่จ่ายไม่ถูกต้อง | Field cannot be edited and issue applies |
| th / `expenses.ai_field_missing` | AI อ่านไม่ได้ — กรุณากรอกเอง | อ่านข้อมูลช่องนี้ไม่ได้ | Field cannot be edited and issue applies |
| th / `expenses.v_vendor_required` | กรุณากรอกชื่อผู้ขาย | ยังไม่มีชื่อผู้ขาย | Field cannot be edited and issue applies |
| th / `expenses.v_vendor_address_too_long` | ที่อยู่ยาวเกิน 500 ตัวอักษร ตัดให้สั้นลง | ที่อยู่ยาวเกิน 500 ตัวอักษร | Field cannot be edited and issue applies |
| th / `expenses.v_vendor_address_tax_invoice` | ใบกำกับเต็มรูปควรมีที่อยู่ผู้ขาย เติมจากใบหรือปล่อยไว้ก็ได้ | ใบกำกับภาษีเต็มรูปนี้ยังไม่มีที่อยู่ผู้ขาย | Field cannot be edited and issue applies |
| th / `expenses.v_date_required` | กรุณาระบุวันที่ในใบเสร็จ | ยังไม่มีวันที่ในใบเสร็จที่ใช้ได้ | Field cannot be edited and issue applies |
| th / `expenses.v_date_very_old` | วันที่เก่ากว่า 5 ปี — ตรวจสอบว่าพิมพ์ถูกต้อง | วันที่เก่ากว่า 5 ปี | Field cannot be edited and issue applies |
| th / `expenses.v_description_required` | กรุณากรอกรายละเอียดรายการ | ยังไม่มีรายละเอียดรายการ | Field cannot be edited and issue applies |
| th / `expenses.v_number_invalid` | กรุณากรอกเป็นตัวเลข | ยังไม่มีตัวเลขที่ใช้ได้ | Field cannot be edited and issue applies |
| th / `expenses.v_number_format` | กรอกเป็นตัวเลขธรรมดา ห้ามมีศูนย์นำหน้า (เช่น 400 หรือ 0.40 ไม่ใช่ 0400) ทศนิยมไม่เกิน 4 ตำแหน่ง | รูปแบบตัวเลขไม่ถูกต้อง อาจมีศูนย์นำหน้าหรือทศนิยมเกิน 4 ตำแหน่ง | Field cannot be edited and issue applies |
| th / `expenses.v_rate_range` | กรอกเป็นทศนิยม 0 ถึง 1 (0.07 = 7%) | อัตราต้องอยู่ระหว่าง 0 ถึง 1 | Field cannot be edited and issue applies |
| th / `expenses.v_vat_rate_required` | เอกสารนี้ระบุว่ามี VAT — กรุณาเลือกอัตรา หรือกรอกยอด VAT ตามใบเสร็จ | ยังไม่มีอัตราหรือยอดภาษีมูลค่าเพิ่มที่ใช้คำนวณได้ | Field cannot be edited and issue applies |
| th / `expenses.v_vat_treatment_zero` | ประเภท VAT นี้ต้องใช้อัตรา 0% เท่านั้น | ภาษีมูลค่าเพิ่มประเภทนี้ต้องใช้อัตรา 0% เท่านั้น | Field cannot be edited and issue applies |
| th / `expenses.v_wht_unit` | กรุณาเลือกหน่วยเป็นเปอร์เซ็นต์หรือบาท | ยังไม่มีหน่วยหัก ณ ที่จ่ายที่ใช้ได้ | Field cannot be edited and issue applies |
| th / `expenses.v_wht_percent` | กรอกเปอร์เซ็นต์ 0 ถึง 100 ทศนิยมไม่เกิน 2 ตำแหน่ง (3 = 3%) | เปอร์เซ็นต์หัก ณ ที่จ่ายต้องอยู่ระหว่าง 0 ถึง 100 และมีทศนิยมไม่เกิน 2 ตำแหน่ง | Field cannot be edited and issue applies |
| th / `expenses.v_wht_amount` | กรอกยอดบาทไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง | ยอดหัก ณ ที่จ่ายต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง | Field cannot be edited and issue applies |
| th / `expenses.v_total_mismatch` | ยอดรวมที่คำนวณได้ {computed} ไม่ตรงกับที่ AI อ่านได้ {ai} | ยอดรวมที่คำนวณได้ {computed} ไม่ตรงกับที่ระบบอ่านได้ {ai} | Field cannot be edited and issue applies |
| th / `expenses.v_total_zero` | ยอดรวมต้องมากกว่า 0 — กรุณากรอกราคาจากใบเสร็จอย่างน้อย 1 รายการ | ยอดรวมเป็น 0 | Field cannot be edited and issue applies |
| th / `expenses.v_payee_kind_required` | กรุณาเลือกประเภทผู้รับเงิน (หัก ณ ที่จ่าย) เพื่อออก ภ.ง.ด.3 หรือ ภ.ง.ด.53 ให้ถูกต้อง | ยังไม่มีประเภทผู้รับเงินสำหรับหัก ณ ที่จ่าย | Field cannot be edited and issue applies |
| th / `expenses.v_wht_category_required` | กรุณาเลือกประเภทเงินได้ (หัก ณ ที่จ่าย) ก่อนยืนยันเอกสาร | ยังไม่มีประเภทเงินได้สำหรับหัก ณ ที่จ่าย | Field cannot be edited and issue applies |
| th / `expenses.v_charge_quantity_one` | ค่าใช้จ่ายเพิ่มเป็นยอดเดียว กรอกจำนวนเงินในช่องราคาและใช้จำนวน 1 | ค่าใช้จ่ายเพิ่มต้องมีจำนวน 1 และแสดงยอดเงินในช่องราคา | Field cannot be edited and issue applies |
| en / `expenses.v_wht_base` | Enter a non-negative withholding base in baht with at most two decimal places | The withholding tax base is invalid | Field cannot be edited and issue applies |
| en / `expenses.ai_field_missing` | AI could not read this — please fill it in. | This field could not be read | Field cannot be edited and issue applies |
| en / `expenses.v_vendor_required` | Vendor name is required | The vendor name is missing | Field cannot be edited and issue applies |
| en / `expenses.v_vendor_address_too_long` | Longer than 500 characters — shorten it | The address exceeds 500 characters | Field cannot be edited and issue applies |
| en / `expenses.v_vendor_address_tax_invoice` | A full tax invoice should carry the seller address — copy it from the document, or leave it empty | This full tax invoice has no vendor address | Field cannot be edited and issue applies |
| en / `expenses.v_date_required` | Receipt date is required | A valid receipt date is missing | Field cannot be edited and issue applies |
| en / `expenses.v_date_very_old` | More than 5 years old — check for a typo | The date is more than five years old | Field cannot be edited and issue applies |
| en / `expenses.v_description_required` | Line description is required | The item description is missing | Field cannot be edited and issue applies |
| en / `expenses.v_number_invalid` | Enter a number | A valid number is missing | Field cannot be edited and issue applies |
| en / `expenses.v_number_format` | Use a plain number with no leading zero (400 or 0.40, not 0400) and at most four decimals | Invalid number format: leading zeros or more than four decimal places | Field cannot be edited and issue applies |
| en / `expenses.v_rate_range` | Enter a decimal from 0 to 1 (0.07 = 7%) | The rate must be between 0 and 1 | Field cannot be edited and issue applies |
| en / `expenses.v_vat_rate_required` | This document says VAT applies — choose a rate, or enter the printed VAT amount | A usable VAT rate or amount is missing | Field cannot be edited and issue applies |
| en / `expenses.v_vat_treatment_zero` | This VAT treatment requires a 0% rate | This VAT treatment requires a zero rate | Field cannot be edited and issue applies |
| en / `expenses.v_wht_unit` | Select percent or baht | A valid withholding tax unit is missing | Field cannot be edited and issue applies |
| en / `expenses.v_wht_percent` | Enter a percentage from 0 to 100 with at most 2 decimal places (3 = 3%) | The withholding percentage must be between 0 and 100 with at most two decimal places | Field cannot be edited and issue applies |
| en / `expenses.v_wht_amount` | Enter a non-negative baht amount with at most 2 decimal places | The withheld amount must be nonnegative with at most two decimal places | Field cannot be edited and issue applies |
| en / `expenses.v_total_mismatch` | Computed total {computed} does not match the AI total {ai} | The calculated total {computed} differs from the read total {ai} | Field cannot be edited and issue applies |
| en / `expenses.v_total_zero` | Total must be greater than 0 — enter the receipt price for at least one item | The total is zero | Field cannot be edited and issue applies |
| en / `expenses.v_payee_kind_required` | Select the payee taxpayer class (WHT) so the right form (PND3 / PND53) is used | The withholding payee type is missing | Field cannot be edited and issue applies |
| en / `expenses.v_wht_category_required` | Select the income category (WHT) before confirming | The withholding income category is missing | Field cannot be edited and issue applies |
| en / `expenses.v_charge_quantity_one` | An additional charge is one amount: put it in the price box and keep quantity 1 | An additional charge requires quantity 1 and its amount in the price field | Field cannot be edited and issue applies |

| Surface | Old | New | Case |
| --- | --- | --- | --- |
| Standard role description | Static role description (e.g. สำหรับฝ่ายบัญชี: ลงบัญชี ปิดงวด ทำภาษี และกระทบยอดธนาคาร) | เมนูที่บทบาทนี้มีสิทธิ์ใช้: {granted menu labels} | Configured package; standard description; visible granted menus |
| Standard role description fallback | Static role description | สิทธิ์ของบทบาทขึ้นอยู่กับเมนูที่บริษัทเปิดใช้ | No projected granted menu label |
| Report history description | ไฟล์รายงานที่สร้างไว้ก่อนปิดฟีเจอร์ ดาวน์โหลดได้เท่าที่คุณมีสิทธิ์ | แสดงเฉพาะประวัติและไฟล์รายงานที่คุณมีสิทธิ์ดู | Reports disabled; retained read allowed |
| Report files empty state | ยังไม่มีการส่งออกล่าสุด | ยังไม่มีไฟล์รายงานที่คุณดูได้ | Successful empty read only |
| Denied workspace route | กำลังพาไปหน้าที่ใช้ได้… / ยังไม่มีหน้าที่คุณเปิดได้ในบริษัทนี้ and its standalone guidance | Existing ForbiddenState: ไม่มีสิทธิ์เข้าถึง / คุณไม่มีสิทธิ์เข้าถึงหน้านี้ / แจ้งเจ้าของกิจการหรือผู้มีสิทธิ์จัดการบทบาทให้ตรวจสิทธิ์ของคุณ | Denied route in normal shell |
| Denied route return | none | กลับไปหน้าที่ใช้ได้ | A reachable fallback exists |
| Signature read failure | Error alongside default controls | Existing ErrorState: เกิดข้อผิดพลาด / ลองอีกครั้ง plus original error detail | Signature GET failed |
| Partial/paused read | help followed by parenthesized reason, preceded by tick in InfoBanner | reason — existing saved-file/help message, without tick | Read has reason; no tick on informational notices |
| Claim receipt warning | Same sentence in banner, button title, possibly same submit error | Existing sentence once; button references it | Submit blocked by receipt readiness |
| History actions | บันทึกมุมมอง / ส่งออก CSV, disabled | Hidden | History-only or loading |

## Next
Controller review/commit and environment verification only:
- Run full API `pnpm --filter @watchdog-bms/api test`, plus the PostgreSQL jobs already specified by `.github/workflows/ci.yml` against a real test database. No new PG test was added.
- Run `pnpm e2e e2e/expenses.spec.ts e2e/reimbursements.spec.ts e2e/settings.spec.ts e2e/dashboard.spec.ts e2e/notifications.spec.ts` against the configured browser stack.
- STARTER owner, 390 and 1280: apply corrected preset in test setup; notification preferences/rules at both URL families; role matrix contains purchased menus only and no platform roles; accountant description matches package; unsold tax/CRM/inventory/tax-code URLs show forbidden in shell; report history with no artifacts has no export/save action. Also test existing accessible retained export and read failure.
- Upload-only role: read-only expense with failed/partial/paused read, missing vendor/date/lines/amount/WHT facts; no action prompts, reason first, no tick. Compare editor prompts on the same expense. Check full dropdown labels at 1280 and phone wrapping.
- STAFF: own draft receipt policy warning once, including disabled button accessibility and an identical prior submit error; unrelated errors remain. /settings/profile retains header/navigation and an explicit link to a reachable page.
- ENTERPRISE owner, 390: signature GET/PATCH succeed without thai_tax, blank/default and existing signature modes load, failed GET has retry and no editable/save controls, padding visible. Confirm STARTER and a non-manager remain refused and the full Tax workspace stays closed. PND53 continues through its existing narrow routes.

## Controller note (2026-10-04)

The starter-preset change (adding `dashboard_notifications.preferences` and `dashboard_notifications.rules` to every paid tier) was HELD BACK by the controller: it changes what the packages grant and leaves existing paid shops without it, so it goes to the owner first. Without it, a STARTER user who types those addresses gets the shell's no-access state (no silent bounce).

Owner decision, 2026-10-04: "ยังไม่ต้องทำอะไรกับเรื่องนี้ ใช้แค่กระดิ่งกับการแจ้งเตือนทุกอย่างแบบเดิมไปก่อน" — the starter preset stays without the notification settings subfeatures; the held-back change is dropped. A STARTER user typing those addresses gets the shell's no-access state.
