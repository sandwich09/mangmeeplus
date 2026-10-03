# Agent Memory: roles-company-view-2026-10-04

Status: Original diff accepted by controller. OWNER wording follow-up complete; focused red/green tests, locked typechecks and final whole-web suite passed. Changes remain uncommitted for controller review.
Owner: Codex implementation lane; controller owns commit, database and browser verification.
Scope: Company-scoped COMPANY_VIEW visibility, its shared Thai label, readable employee names/role chips, and sold-surface OWNER wording.
Decisions:
- Reuse the existing role queries with one company-scoped membership predicate for list, detail and preview; the matrix and employee pickers/filters already consume the list.
- Membership existence, regardless of status, controls visibility in shops and the platform company. Do not change grants, assignments, routing, platform-role keys or stored names.
- Use the contracts name ผู้ดูภาพรวมบริษัท; preserve the stored English-name alias for existing memberships. English locale uses Company viewer.
- Put role chips below the employee identity and wrap full text. No tooltip-only disclosure or new dependency.
Open questions: None.
Follow-up decisions:
- Keep the accepted diff intact. Use `THAI_SYSTEM_ROLE_NAMES.OWNER` for confirmed owner-role references in web/account/signup/package/LINE guidance.
- Package-change denial already checks `company.plan.manage`, so its owner-only sentence must also name permitted package managers; no authorization change.
- Permission-change guidance must not direct employees solely to platform SYSTEM_ADMIN or ordinary ADMIN; name OWNER or a person with role-management permission.
- Leave unsold accounting setup, internal operator/sales pages and their error codes, preview-only synthetic personal names, joke-bank physical shop owners, bank-account/data holders, and generic guidance to an authorized administrator unchanged.
Artifacts:
- `apps/api/src/modules/employee-access/application/company-role-read-where.ts`: shared scope and membership predicate; list/detail/preview use it without another query.
- Existing API role-management spec: query-aware fixtures exercise list, detail, matrix and preview for absent/foreign/own ACTIVE/own DISABLED memberships in a shop and the platform company. Existing membership/grant rows are unchanged and the held role is still unassignable.
- `packages/contracts/src/employee-access.ts`: single Thai name source. Web English dictionary updated; stored `Company owner` alias retained intentionally in role-picker logic and fixture inputs.
- `IndividualPermissionsPrototypePage.tsx`: the active `/settings/access-overview` employee row uses two grid rows so the full role chip cannot squeeze the employee name; both labels wrap.
- Specs: `docs/specs/company-role-override-spec.md` R12 and name table; `docs/specs/employee-access-role-management-spec.md` employee readability and visibility rules.
Verification:
- API command: `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/employee-access/application/use-cases/role-management.use-case.spec.ts`.
  - Before production edits: exit 1, 40 pass / 4 fail; list/detail/matrix/preview each exposed an unheld role.
  - Added missing/foreign-id preview regression with the new not-found guard removed: exit 1, 43 pass / 2 fail (both preview tests). Guard restored.
  - First complete-fix run: exit 1, 44 pass / 1 fail; the test incorrectly expected core `dashboard.read` to be removed by an empty preview. Corrected the fixture to use non-core `crm.customer.read`, without changing production grant logic.
  - Final focused run: exit 0, 45 pass / 0 fail.
- Contracts: `pnpm --filter @watchdog-bms/contracts exec node --import tsx --test src/employee-access.spec.ts`: before name change exit 1, 6 pass / 1 fail; after exit 0, 7 pass / 0 fail.
- Contracts: `pnpm --filter @watchdog-bms/contracts build`: exit 0.
- Web: `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/employee-access/role-picker.logic.spec.ts`: before edits exit 1, 20 pass / 2 fail; after exit 0, 22 pass / 0 fail. Covers stored-name references with/without `isSystem`, bare keys and names, and English locale.
- Web: `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/employee-access/IndividualPermissionsPrototypePage.spec.ts`: before layout edit exit 1, 11 pass / 1 fail; after exit 0, 12 pass / 0 fail. Source/layout guard only; not a browser measurement.
- Grepped API, ai-gateway, web, contracts and e2e specs/tests for `เจ้าของบริษัท|Company owner`. Updated both stale Thai assertions. Remaining English matches are stored-data fixture inputs or historical comments, not expected display labels. No e2e match; unrelated documentation uses of company ownership remain unchanged.
- Every other matching web spec was run with `pnpm --filter @watchdog-bms/web exec node --import tsx --test <path>`:
  - `src/common/components/app-shell/AppSidebar.spec.ts`: exit 0, 15 pass / 0 fail.
  - `src/features/reimbursements/ReimbursementPages.plain-thai.qa.spec.ts`: exit 0, 55 pass / 0 fail.
  - `src/features/web-core-workspace/web-core-workspace.spec.ts`: exit 0, 87 pass / 0 fail.
- Locked checks used `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh`:
  - `pnpm --filter @watchdog-bms/api typecheck`: first exit 2 (new helper imported Prisma from `@prisma/client`); corrected to the existing generated-client path. Final rerun exit 0, no diagnostics.
  - `pnpm --filter @watchdog-bms/web typecheck`: exit 0, route generation and TypeScript passed.
  - `pnpm --filter @watchdog-bms/web exec node --import tsx --test "src/**/*.spec.ts"`: exit 0, 2792 pass / 0 fail / 0 skipped (571 suites). The Python `os.execv` launcher removed every environment key starting with `S3_` before executing the wrapper; no environment/config file was edited.
- `git diff --check`: exit 0.
- Not checked: real PostgreSQL query execution, rendered layout, focus/tap and screen-reader output, browser loading/error/permission paths. No database, browser or server is permitted in this lane. API fixture tests do not claim database coverage.
Next:
- Leave all changes uncommitted for the controller; no package manifest, schema, migration, platform-role list or role grants changed.
- Controller: run full API verification and existing employee-access PostgreSQL specs with an explicit local database; verify the membership predicate against real PostgreSQL.
- Controller browser cases at 390 and 1280 px:
  - `/companies/<companyId>/settings/permissions` (`/settings/roles` redirects here): OWNER of a shop without a COMPANY_VIEW holder sees none; OWNER of the seeded demo company sees ผู้ดูภาพรวมบริษัท. Platform-company operator sees it only with a holder in that company. Check matrix, employee role filters, create/edit selectors and denied by-id reads together.
  - `/companies/<companyId>/settings/access-overview`: OWNER/HR with employee-read access; long Thai custom role, an unbroken long role/name, short standard role, disabled/draft employee and a legacy multi-role employee. Full employee and role names should wrap with no horizontal overflow; keyboard selection and tap should keep the full text available.
  - Existing demo `qa.company` membership: sign-in/company routing and overview access remain unchanged; role page remains denied because it lacks manage permission. Sidebar/switcher show the new shared Thai name. English locale shows Company viewer.
- Browser baseline command: `pnpm exec playwright test e2e/settings.spec.ts` (requires controller's local services and accounts); add the above manual scenarios because the existing file does not cover every new layout/visibility case.


## OWNER wording follow-up (2026-10-04)

Artifacts:
- 21 production files use the existing contracts OWNER name in sold guidance. No new role-name list or dependency; the corrected-email error reuses the existing signup guidance sentence.
- Existing listed API and gateway specs plus the web sold-wording spec scan all changed production files. Existing behavioral expectations and one browser expectation use the rendered Thai name.
- Updated the role-naming rule and five quoted customer sentences in the advisor and event-discount specs.
- Regenerated W00 after its drift check: only the two changed tracked source hashes (`erp-package-tools.use-case.ts`, `process-line-webhook.use-case.ts`) and generation/revision metadata changed.

Words (unchanged surrounding text is elided with …; the new owner name always comes from `THAI_SYSTEM_ROLE_NAMES.OWNER` in production):

| Where | Old | New | Case |
| --- | --- | --- | --- |
| Web `app/billing/companies/page.tsx` | กรุณาติดต่อเจ้าของบริษัทหรือทีมมั่งมีเพื่อตรวจสอบสิทธิ์ | กรุณาติดต่อเจ้าของกิจการหรือทีมมั่งมีเพื่อตรวจสอบสิทธิ์ | Company-list request forbidden |
| Web dictionary `auth.login.contact_owner` | ติดต่อเจ้าของร้าน | ติดต่อเจ้าของกิจการ | Login, no account |
| Web dictionary `expenses.buyer_match_ask_owner` | ให้เจ้าของร้านตั้งค่าที่หน้า ข้อมูลร้าน | ให้เจ้าของกิจการตั้งค่าที่หน้า ข้อมูลร้าน | Buyer comparison needs company address |
| Web `plan-term.logic.ts` | ร้านนี้ยังไม่มีแพ็กเกจ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจเพื่อเริ่มใช้งาน | ร้านนี้ยังไม่มีแพ็กเกจ ให้เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจเพื่อเริ่มใช้งาน | Staff, no package |
| Web `plan-term.logic.ts` | แพ็กเกจของร้านหมดอายุแล้ว ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจเพื่อใช้งานต่อ | แพ็กเกจของร้านหมดอายุแล้ว ให้เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจเพื่อใช้งานต่อ | Staff, expired package |
| Web `billing-error-text.ts` | บัญชีนี้ยังไม่มีสิทธิ์จัดการแพ็กเกจของร้านนี้ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจดำเนินการ | บัญชีนี้ยังไม่มีสิทธิ์จัดการแพ็กเกจของร้านนี้ ให้เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจดำเนินการ | Billing forbidden |
| Web `BillingPage.tsx` | …ผู้ใช้ รวมเจ้าของ | …ผู้ใช้ รวมเจ้าของกิจการ | Offer confirmation capacity |
| Web `BillingCapacityPicker.tsx` | เลือก … / … รวมเจ้าของ | เลือก … / … รวมเจ้าของกิจการ | Capacity member count |
| Web `BillingCapacityPicker.tsx` | ต้องคงสำนักงานใหญ่และเจ้าของ เลือกไม่เกินจำนวนที่แพ็กเกจรองรับ และกำหนดสาขาที่มีสิทธิ์ให้ผู้ใช้ทุกคน | ต้องคงสำนักงานใหญ่และเจ้าของกิจการ เลือกไม่เกินจำนวนที่แพ็กเกจรองรับ และกำหนดสาขาที่มีสิทธิ์ให้ผู้ใช้ทุกคน | Invalid capacity selection |
| Web `CompanyProfilePage.tsx` | บัญชีของคุณดูข้อมูลนี้ได้อย่างเดียว ถ้าต้องการแก้ไข ให้เจ้าของร้านเป็นคนแก้นะคะ | บัญชีของคุณดูข้อมูลนี้ได้อย่างเดียว ถ้าต้องการแก้ไข ให้เจ้าของกิจการเป็นคนแก้นะคะ | Full read-only profile |
| Web `CompanyProfilePage.tsx` | บัญชีของคุณเห็นข้อมูลนี้ได้บางส่วน ถ้าต้องการดูหรือแก้ไขทั้งหมด ให้เจ้าของร้านเป็นคนทำนะคะ | บัญชีของคุณเห็นข้อมูลนี้ได้บางส่วน ถ้าต้องการดูหรือแก้ไขทั้งหมด ให้เจ้าของกิจการเป็นคนทำนะคะ | Partial profile access |
| Web `CompanyProfilePage.tsx` | บัญชีของคุณดูได้อย่างเดียว ให้เจ้าของร้านหรือผู้ทำบัญชีเป็นคนตอบนะคะ | บัญชีของคุณดูได้อย่างเดียว ให้เจ้าของกิจการหรือผู้ทำบัญชีเป็นคนตอบนะคะ | VAT answer read-only |
| Web `SignupPage.tsx` | ชื่อจริงของเจ้าของร้าน ใช้แสดงในระบบ ไม่ใช่ชื่อสำหรับเข้าสู่ระบบ | ชื่อจริงของเจ้าของกิจการ ใช้แสดงในระบบ ไม่ใช่ชื่อสำหรับเข้าสู่ระบบ | Signup name help |
| Web `SignupWelcomePage.tsx` | ร้านนี้จะไม่เหลือเจ้าของร้าน | ร้านนี้จะไม่เหลือเจ้าของกิจการ | Account merge would remove last owner |
| Web `ExpensesPages.tsx` | แจ้งเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจให้เปลี่ยนแพ็กเกจ | แจ้งเจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจให้เปลี่ยนแพ็กเกจ | Staff receipt allowance exhausted |
| Web `AddEmployeePrototypePage.tsx` | บทบาทระดับนี้ต้องให้เจ้าของหรือผู้ดูแลสิทธิ์เป็นผู้เปลี่ยน | บทบาทระดับนี้ต้องให้เจ้าของกิจการหรือผู้ดูแลสิทธิ์เป็นผู้เปลี่ยน | Protected-role edit |
| Web `AddEmployeePrototypePage.tsx` | …(เช่น เจ้าของอีกบริษัท)… | …(เช่น เจ้าของกิจการอีกบริษัท)… | Existing-account confirmation example |
| API `liff-page.security.ts` | ส่วนลดนี้เป็นของบัญชี LINE นี้ ใช้ได้เมื่อคุณเป็นเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจของร้าน ถ้าจะใช้กับร้านที่คุณทำงานอยู่ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจสแกนรับเอง | ส่วนลดนี้เป็นของบัญชี LINE นี้ ใช้ได้เมื่อคุณเป็นเจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจของร้าน ถ้าจะใช้กับร้านที่คุณทำงานอยู่ ให้เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจสแกนรับเอง | Event discount LIFF notice |
| API `liff-page.security.ts` | บัญชี LINE นี้ยังไม่ได้อยู่ในร้านไหนค่ะ ให้เจ้าของร้านส่งลิงก์เชิญให้อีกครั้งนะคะ | บัญชี LINE นี้ยังไม่ได้อยู่ในร้านไหนค่ะ ให้เจ้าของกิจการส่งลิงก์เชิญให้อีกครั้งนะคะ | No company membership |
| API `liff-page.security.ts` | ใส่อีเมลเจ้าของร้านให้ถูกต้อง เช่น shop@example.com ยาวไม่เกิน 254 ตัวอักษร | ใส่อีเมลเจ้าของกิจการให้ถูกต้อง เช่น shop@example.com ยาวไม่เกิน 254 ตัวอักษร | Signup email rule |
| API `liff-page.security.ts` | ยังไม่ได้ใส่อีเมลเจ้าของร้าน | ยังไม่ได้ใส่อีเมลเจ้าของกิจการ | Missing signup email |
| API `liff-page.security.ts` | อีเมลเจ้าของร้านยังไม่ถูกต้อง | อีเมลเจ้าของกิจการยังไม่ถูกต้อง | Invalid signup/corrected email, one shared sentence |
| API `liff-page.security.ts` | …ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจก่อน แล้วเข้าใช้งานได้เลยค่ะ | …ให้เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจก่อน แล้วเข้าใช้งานได้เลยค่ะ | Staff opening a locked shop |
| API `plan-manager.logic.ts` | หากต้องการใช้ต่อ แจ้งเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ | หากต้องการใช้ต่อ แจ้งเจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ | Quota guidance to non-manager |
| API `submit-line-signup.use-case.ts` | เจ้าของร้าน | เจ้าของกิจการ | Fallback only when verified LINE display name is missing; existing personal names unchanged |
| API `line-event-discount.logic.ts` | ส่วนลดจากงานใช้ตอนซื้อแพ็กเกจของร้าน เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจสอบถามในแชทนี้ได้เลยค่ะ | ส่วนลดจากงานใช้ตอนซื้อแพ็กเกจของร้าน เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจสอบถามในแชทนี้ได้เลยค่ะ | Employee asks about event discount |
| API `line-staff-menu.logic.ts` | เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเป็นคนเลือกแพ็กเกจให้ร้านนะคะ | เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจเป็นคนเลือกแพ็กเกจให้ร้านนะคะ | Employee promotion card |
| API `line-ai-formatter.logic.ts` | หากต้องการสิทธิ์เพิ่มเติม กรุณาติดต่อผู้ดูแลระบบนะคะ | หากต้องการสิทธิ์เพิ่มเติม กรุณาติดต่อเจ้าของกิจการหรือผู้มีสิทธิ์จัดการบทบาทนะคะ | Assistant permission refusal |
| API `erp-package-tools.use-case.ts` | จำนวนผู้ใช้รวมเจ้าของร้าน | จำนวนผู้ใช้รวมเจ้าของกิจการ | Package catalog capacity note |
| API `process-line-webhook.use-case.ts` | …ถ้าคุณเป็นพนักงาน ให้เจ้าของร้านเปิดเมนู "พนักงาน" ในเว็บแอป… | …ถ้าคุณเป็นพนักงาน ให้เจ้าของกิจการเปิดเมนู "พนักงาน" ในเว็บแอป… | Employee LINE-link instructions |
| API `process-line-webhook.use-case.ts` | 📦 การเปลี่ยนแพ็กเกจต้องให้เจ้าของร้านเป็นคนขอนะคะ รบกวนแจ้งเจ้าของร้านให้พิมพ์ "ขอเปลี่ยนแพ็กเกจ" ในแชทนี้ได้เลยค่ะ | 📦 หากต้องการเปลี่ยนแพ็กเกจ รบกวนแจ้งเจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจให้พิมพ์ "ขอเปลี่ยนแพ็กเกจ" ในแชทนี้ได้เลยค่ะ | Package-change command denied; existing rule also permits package managers |
| API `process-line-webhook.use-case.ts` | ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ค่ะ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจก่อน แล้วน้องมั่งมีจะกลับมาช่วยได้เต็มที่นะคะ | ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ค่ะ ให้เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจก่อน แล้วน้องมั่งมีจะกลับมาช่วยได้เต็มที่นะคะ | Member asks assistant without active package |
| Gateway `business-read-result-semantics.ts` | เรื่องแพ็กเกจและเครดิตของร้าน ถามเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ | เรื่องแพ็กเกจและเครดิตของร้าน ถามเจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ | Package/credit query denied |
| Gateway `line-ai-scope-policy.logic.ts` | …ถ้าต้องการบันทึก ให้ผู้ดูแลบริษัทเพิ่มสิทธิ์ให้ก่อนนะคะ | …ถ้าต้องการบันทึก ให้เจ้าของกิจการหรือผู้มีสิทธิ์จัดการบทบาทเพิ่มสิทธิ์ให้ก่อนนะคะ | Read-only caller tries receipt capture |

Verification:
- Commands in the table expand as follows (paths are relative to the package):
  - W: `pnpm --filter @watchdog-bms/web exec node --import tsx --test <path>`.
  - A: `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec <path>`.
  - G: `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test <path>`.
- Each red run below exited 1 against old production wording; each green exited 0. Counts are file totals, pass/fail. No skipped tests.

| Command and path | Red pass/fail | Green pass/fail |
| --- | --- | --- |
| W `src/common/i18n/sold-features-wording.spec.ts` | 9/10 for first ten changed files; later 19/1 for employee form before its edit | 20/0 |
| W `src/features/plan-term/plan-term.logic.spec.ts` | 18/1 | 19/0 |
| W `src/features/expenses/ExpensesPages.qa.spec.ts` | 13/1 | 14/0 |
| A `src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts` | 68/9 (eight file scans and existing promotion assertion) | 77/0 |
| A `src/modules/external-signup/application/submit-line-signup.use-case.spec.ts` | 47/1 | 48/0 |
| A `src/modules/auth/line-liff-signup.spec.ts` | 80/3 | 83/0 |
| A `src/common/security/liff-event-discount-page.spec.ts` | 17/1 | 18/0 |
| A `src/modules/line-ai/line-first-signup-webhook.spec.ts` | 104/4 | 108/0 |
| A `src/modules/line-ai/application/use-cases/process-line-general-v2.spec.ts` | 40/1 | 41/0 |
| A `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` | 397/8 | 405/0 |
| G `src/modules/line-ai/agents/business-read-result-semantics.spec.ts` | 193/2 | 195/0 |
| G `src/modules/line-ai/domain/logic/business-read-result-semantics.spec.ts` | 46/1 | 47/0 |
| G `src/modules/line-ai/agents/semantic-turn-v2-terminal-outcomes.spec.ts` | 48/2 | 50/0 |
| G `src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.spec.ts` | 87/1 | 88/0 |

- Scope-policy's old assertion was found in the final grep and first failed on new wording (87/1). Updated that assertion, manually restored the old production sentence for the red run above, then restored the fix for green.
- Re-ran A `src/modules/auth/line-liff-signup.spec.ts` after sharing the invalid-email sentence: exit 0, 83/0.
- Additional old-word matches in existing specs were run; all exit 0:
  - A `src/modules/reimbursements/domain/logic/claim-form.logic.spec.ts`: 48/0.
  - A `src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts`: 92/0.
  - A `src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts`: 207/0.
  - A `src/modules/workflow/application/use-cases/workflow-template-auto-enable.spec.ts`: 36/0.
- A `src/modules/line-ai/line-ai-capability-manifest.spec.ts`: initial exit 1, 3/1 (expected source hash drift). Re-run prefixed `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1`: exit 0, 4/0. Reviewed generated diff as described above.
- Through the heavy wrapper specified above: API typecheck exit 0, web typecheck exit 0, AI gateway typecheck exit 0; no TypeScript diagnostics. Initial complete web suite exit 0, 2802/0, 0 skipped, 571 suites, with all S3_* environment entries removed. After the final employee-form edit: web typecheck exit 0; whole web suite exit 0, 2803/0, 0 skipped, 571 suites, again through the wrapper with all S3_* entries removed.
- Grepped every API, gateway, web and e2e spec/test for each old sentence and the old role words. Updated all stale sold expectations. Employee-form old sentences had no matching spec/e2e expectations. Remaining matches are forbidden-word scan inputs, unchanged internal surfaces, or personal-name fixtures. Grepped normative specs too and updated all five matching quoted customer sentences.

Open questions: None requiring a product decision.
Intentionally unchanged:
- `AccountingTaxSetupPage.tsx` and other unsold modules; report-access examples in `approved-product-help.ts` describe an unsold reports feature.
- Internal operator/sales/billing-admin pages and their errors (`CONTROL_OFFER_CAPACITY_INVALID`, `partner_owner_name_unavailable`); these are not shop-user surfaces.
- Actual/persisted personal names, including preview-only synthetic names (billing preview is restricted to local development and OWNER). No data rewrite.
- Joke-bank shop owners, legal ownership, sole-proprietor wording, bank-account holders, data subjects and job-title choices: these do not name the OWNER role.
- Generic permission-administrator guidance (including employee self-edit and sidebar LINE relinking), genuine platform-support instructions and already-canonical Thai role names. No permissions or customer routing changed.
- Existing English assistant wording remains English; only Thai role references changed.

Next:
- Controller: leave accepted original browser/real-PostgreSQL handoff above in scope.
- Browser wording checks at 390 and 1280 px: staff with no/expired package on workspace and billing; OWNER and read-only staff on company profile; login and signup; employee protected-role edit and existing-account confirmation; expense receipt limit; capacity selection and offer confirmation. Expect the canonical owner name and no new overflow.
- LINE/LIFF checks: employee invitation, missing/invalid signup email, missing membership, locked-shop staff, event discount, denied package/credit query, denied package-change command, denied permission/read-only receipt capture. Compare OWNER, employee, and a custom role with package-management permission; package-manager access is unchanged.
- Controller browser commands: `pnpm exec playwright test e2e/plan-term-billing-readiness.spec.ts` and `pnpm exec playwright test e2e/line-signup-contact-email.spec.ts` with local services/accounts. Browser expectation updated but not run here (no browser/server allowed).
- Not checked: real PostgreSQL matching specs with unchanged old-word personal-name fixtures: external-signup `line-signup-duplicate-email.pg.spec.ts`, system-partner-management `manual-expense-web-entry.pg.spec.ts`, sales-console `sales-console.pg.spec.ts`, and reimbursements `prisma-reimbursement.repository.draft-submit-race.spec.ts` (database-backed despite its filename). Controller owns database runs.
- `git diff --check`: exit 0 after all code/spec/doc edits; own temporary evidence files removed after recording results here.
- Not checked: full API/LINE whole-chain scripts that use the sandbox-incompatible tsx CLI; focused node-loader specs were run instead. No sandbox-refused command was retried.

## Browser check (controller's Claude lane, 2026-10-04, head 04c752eba → 9c3e7130c)

Local throwaway stack (own PostgreSQL/Redis/MinIO, fresh migrate + seed, web without `S3_*`), 390 and 1280 px.
- COMPANY_VIEW: the seed gives both demo companies a holder, so a shop with only its owner was added for the check.
  There: role list, by-id read (404), preview (404), access matrix, role filter and add-employee page show no
  ผู้ดูภาพรวมบริษัท; the demo company shows it (role list, filter, qa.company's sidebar). qa.company signs in to the
  dashboard and is refused the roles page in place. Noticed, not changed: PATCH and disable of the hidden id answer
  403 ("managed by MangmeePlus" / "Protected system roles") instead of 404; assigning it answers 403.
- Long role names: employee rows keep the full name and wrap the chips (no cut, no sideways scroll); standard chips
  keep their size, font and padding (develop vs branch measured), now under the name. Enter on a focused row and a
  tap both open the employee. Defect found and fixed (34b88cea3): the panel's role picker cut a long name (current
  value and options); they wrap now, the list opens below the value, a short name still looks the same.
- Owner word: every listed web and LIFF sentence reads เจ้าของกิจการ (billing company-list refusal, staff banners,
  billing refusal, read-only profile full/partial and VAT, receipt limit, HR protected-role edit, offer confirmation,
  capacity picker, LIFF start/no shop, signup e-mail errors, locked-shop staff, event discount).
- E2E (fresh stack per file): plan-term-billing-readiness 33/33 (handoff env), line-signup-contact-email 7/7,
  settings 21/21, _roles-reference 8/8, employee-job-title 2/2, cross-cutting 5/5 + 1 fixme after 9c3e7130c
  (XC-03 was stale on develop too: denied pages are refused in place since 0e1a81d8b; plus a legal-page race).
- Checks after the fixes: web typecheck exit 0, whole web suite exit 0 (2905/2905, no `S3_*`), `git diff --check` exit 0.
