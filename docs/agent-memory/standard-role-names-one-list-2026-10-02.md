# Agent Memory: standard role names, one list (2026-10-02)

Status: reimbursement guide closed 2026-10-03 on `claude/batch-a-roles-notices-20261003` (closing section at the end); before that, controller follow-up 2 complete; all nine remaining platform-role help sentences and the custom-role settings claim corrected. Four new guide tests and one changed test have red/green evidence; guide specs 20/20, approved-knowledge specs 9/9. Uncommitted lane 3a.
Owner: Codex lane 3a; controller owns commit, full verification, PostgreSQL and browser checks.
Scope: one Thai label for all 15 standard role keys; company-named copies keep their names; employees-and-rights, claims, guides, API role descriptions and fallback notices. Controller follow-up authorizes three assistant source hashes only; no help-card body edit. No package manifest, schema, migration, public, sales-console or platform-admin edits. The reimbursement guide and its pin are owned by another lane.
Decisions: the approved labels move from the employee picker to `packages/contracts/src/employee-access.ts`, because API role descriptions and the approval-backlog note also name standard roles. Consumers interpolate the shared labels. The English dictionary keeps its current English labels. Company-copy recognition is reused, including the sidebar and claim policy.
Open questions: reimbursement guide/pin: both pending lists closed 2026-10-03 (see "Reimbursement guide closed" at the end); the meaning points noticed there are for the owner. At the time of follow-up 2 the existing pending sentences were unchanged, with five additional platform-role help sentences listed below. No SYSTEM_ADMIN text remains in the four edited guides. Default employee delegation limits, the lack of a per-user permission editor, and an existing spec/code discrepancy are recorded in follow-up 2. Sales-console aliases, company-owned descriptions and protected-role visibility remain out of scope.
Artifacts: inventory, changes and wording table to be recorded below; preceding investigation: `ui-wording-roles-sla-signature-2026-10-02.md` section 1.
Verification: initial red/green evidence below: 428 focused tests passed (16 files), no failures/skips; contracts build twice rc 0; locked API typecheck rc 0; locked web typecheck rc 0 after correcting two integration errors. Follow-up red/green: guide specs rc 1 (13 pass/3 fail) then rc 0 (16 pass/0 fail); approved-knowledge rc 1 (8 pass/1 fail, source hash mismatch) then rc 0 (9 pass/0 fail), no skips. Final diff/integrity checks recorded in the follow-up section. Network, servers, Docker, browser and real PostgreSQL are unavailable by lane rules. Follow-up 2: guide specs rc 1 (15 pass/5 fail, twice) then rc 0 (20 pass/0 fail); approved-knowledge rc 1 (8 pass/1 fail) then rc 0 (9 pass/0 fail), no skips. Initial typechecks are historical evidence; not rerun in this follow-up.
Next: reimbursement guide/pin integrated 2026-10-03 (closing section at the end); controller runs full suites, real PostgreSQL and browser checks, then reviews and pushes. Deploy the assistant with the web because this lane now changes three hashes in apps/ai-gateway; deployment not attempted here.

## Product and implementation evidence

The approved names are the former picker names, unchanged, in `THAI_SYSTEM_ROLE_NAMES` in contracts.
The Thai dictionary derives its role entries from that object. The English dictionary retains every
existing label and adds the two sales roles' stored English names, so both dictionaries cover all 15 keys.
The role page imports the picker's `roleDisplayName` instead of maintaining a second normalizer;
claim-policy options use the same rule, including the summary and the cannot-pay warning.

The sidebar had ignored a company's name for any standard key, and the switcher had no stored names
at all. The sidebar now recognizes the stored name; `/auth/me/companies` adds a membership-specific
`roleNames` map from the same filtered active role rows, and the switcher uses it. Permissions,
company filters, grantability and plan state calculations are untouched. Employee role references
omit `isSystem`, so an absent flag now checks the stored English name rather than silently treating
all such references as standard. Bare stored names such as “System Admin” also translate. The role
builder initializes its name through the shared rule, covering its legacy caller too; the matrix's
now redundant name conversion was deleted.

No role key, stored name, grant, schema, migration, package manifest, switch, bank number, public
page, sales-console source, platform-admin source or reimbursement-guide source was edited. The
initial pass did not edit assistant source; the controller follow-up changes its three authorized
guide hashes only. No git mutation, network, Docker, browser or server command was run.

## Original name sources and other discovery

| Original source | Original lines | Disposition |
| --- | --- | --- |
| `apps/web/src/common/i18n/workspace-dictionary.ts` Thai `role.*` | 39–51 | Literal list deleted; generated from contracts. Existing English entries at 1704–1716 retained. |
| `apps/web/src/features/employee-access/role-picker.logic.ts` `THAI_SYSTEM_ROLE_NAMES` | 3–9 | Moved unchanged to contracts; no local alias/list remains. |
| Same file, `STANDARD_ROLE_NAMES` / `hasStandardRoleName` | 16–29 | The only copy-recognition rule; English names extended to all 15 standard keys. |
| `apps/web/src/features/employee-access/EmployeeAccessPages.tsx` `ROLE_NAME_TO_KEY` / `roleDisplayName` | 102–130 | Normalization moved into picker helper; page imports/re-exports the shared function. |
| `apps/web/src/common/components/app-shell/AppSidebar.tsx` `roleLabelKey` / footer | 83–98, 157–160 | Role-key list deleted; shared rule also preserves company-named standard copies. |
| `apps/web/src/features/web-core-workspace/WorkspaceScope.tsx` switcher | 325 | Shared rule plus the membership's stored names. |
| `apps/web/src/features/reimbursements/ReimbursementsPages.tsx` `APPROVER_ROLE_LABELS`, `STANDARD_ROLE_NAMES`, `approverRoleName` | 61–74 | Both lists deleted; shared display rule with `isSystem: false`. |
| `apps/api/src/modules/auth/permission-registry.ts` `SYSTEM_ROLES` | 1067–1085 | Descriptions that name standard roles interpolate the shared names. Stored English names stay stored English. Sales descriptions excluded. |
| `apps/api/src/modules/employee-access/application/dto/employee-access.mapper.ts` | 116–128 | Existing former-English-description fallback reads current `SYSTEM_ROLES`; company-written descriptions stay as stored. |
| `apps/api/src/modules/employee-access/domain/registries/role-template.registry.ts` | 32, 38, 44, 50, 56, 64, 70, 76, 82, 90, 96, 102, 108, 116, 122, 128, 134, 142, 148, 154, 160 | All 21 example names inspected and left: their own names, expressly out of scope. |
| `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts` | entire registry | Inspected names/descriptions: these describe capabilities, not translations of standard role keys; no second standard-role list. |
| `apps/web/src/features/sales-console/sales-console.logic.ts` `SALES_ROLE_LABELS` | 102–105 | Separate aliases “หัวหน้าทีมขาย” / “เซลล์” left under explicit sales-console exclusion. Consumers: `SalesTeamPage.tsx:233,347`. |
| `apps/web/src/features/system-partners/UserLookupSection.tsx` | 10, 123, 146 | Already consumes `roleKeyDisplayName`; no local list or edit. This platform screen inherits shared standard labels only. |
| `apps/api/src/modules/auth/presentation/auth.controller.ts` | 1024, 1044; company list below | Stored names are data, not another Thai list. The switcher now gets these data per membership too. |
| `apps/api/src/modules/employee-access/application/use-cases/get-access-matrix.use-case.ts` | 33 | Stored `roleLabel` is returned as data; role-page labels use the shared display rule. |
| `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-policy.use-case.ts` | 107–110, 369 | Returns stored role names as data; client translates standard names, keeps company names. |
| `packages/contracts/src/expenses.ts` | 450 | Status “รอเจ้าของกิจการอนุมัติ” already uses the chosen name; this is an expense status, not a role-key-to-name list. |
| `packages/contracts/src/reimbursements.ts`, web `CLAIM_SIGNATURE_ROLE_LABELS`, API claim forms | signature/desk definitions | Document signer/desk roles are not standard system roles; their labels remain governed by claim facts. No standard-role name translation in notices/exports/printed forms beyond the sources identified here. |

## Current source and consumer inventory (file and line)

These are every shared-name/display-rule use in the scoped production sources. Repeated calls are
listed, not copied lists of labels. Line numbers refer to this lane's final working files.

- `packages/contracts/src/employee-access.ts`: 188.
- `apps/api/src/modules/auth/permission-registry.ts`: 3, 1072, 1073, 1074, 1075, 1076, 1077, 1078, 1079, 1080, 1081.
- `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-summary.use-case.ts`: 3, 98.
- `apps/web/src/common/api/api-error-message.ts`: 1, 602, 709, 755, 1169.
- `apps/web/src/common/components/app-shell/AppSidebar.tsx`: 145.
- `apps/web/src/common/i18n/workspace-dictionary.ts`: 1, 4, 5.
- `apps/web/src/features/employee-access/AddEmployeePrototypePage.tsx`: 220.
- `apps/web/src/features/employee-access/DiscountPolicyPage.tsx`: 2, 175.
- `apps/web/src/features/employee-access/EmployeeAccessPages.tsx`: 282, 399, 519, 618, 819, 881, 1183.
- `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`: 2, 118, 119, 269, 339, 640, 648, 706, 817, 894.
- `apps/web/src/features/employee-access/PermissionMatrixPrototypePage.tsx`: 302, 352.
- `apps/web/src/features/employee-access/discount-policy.model.ts`: 1, 28, 29.
- `apps/web/src/features/employee-access/role-picker.logic.ts`: 3, 5, 30, 45, 46.
- `apps/web/src/features/reimbursements/ReimbursementPayout.tsx`: 2, 297.
- `apps/web/src/features/reimbursements/ReimbursementPayoutAccountPage.tsx`: 2, 28.
- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx`: 63, 1013, 1054.
- `apps/web/src/features/reimbursements/reimbursements.model.ts`: 2, 9.
- `apps/web/src/features/system-partners/UserLookupSection.tsx`: 123, 146.
- `apps/web/src/features/user-guide/expenses-guide.content.ts`: 1, 47, 48, 66, 67, 92, 93, 94, 95, 96, 98, 272, 302, 360, 362, 363, 364, 365, 366.
- `apps/web/src/features/user-guide/reports-guide.content.ts`: 1, 182, 183, 184.
- `apps/web/src/features/user-guide/substitute-receipt-guide.content.ts`: 1, 59, 252, 289, 298, 338, 340, 341.
- `apps/web/src/features/user-guide/tax-guide.content.ts`: 1, 170, 171, 172, 173.
- `apps/web/src/features/web-core-workspace/WorkspaceScope.tsx`: 325.

## Open points: reimbursement guide (do not edit in this lane) — CLOSED 2026-10-03, see "Reimbursement guide closed" at the end

Another lane owns `apps/web/src/features/user-guide/reimbursement-guide.content.ts`. These exact
sentences need the central names; keep their facts/conditional finance-review wording. Its pin in
`apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts` must move with the guide, per
`docs/agent-memory/reimbursement-payout-round-wording.md`. No guide or pin was changed here.

- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:104`: ['ตั้งค่านโยบาย', 'เจ้าของกิจการ และแอดมิน', 'เลือกผู้อนุมัติ เกณฑ์ยอด ใบเสร็จ รายการซ้ำ และเวลาที่ใช้ตัดสิน'],
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:328`: detail: 'เจ้าของกิจการและแอดมินตั้งให้พนักงานได้ทุกคน ผู้จัดการและฝ่ายบุคคลตั้งให้ได้เฉพาะพนักงานในสาขาที่ตนดูแล โดยใช้กล่อง “บัญชีรับเงินคืน” ในหน้าแก้ไขข้อมูลพนักงาน บัญชีของเจ้าของกิจการ เจ้าของกิจการตั้งเองเท่านั้น',
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:458`: detail: 'เจ้าของกิจการ แอดมิน และผู้จัดการ อนุมัติคำขอของตัวเองได้ ระบบบันทึกไว้ว่าอนุมัติรายการของตนเอง บทบาทอื่นทำได้เมื่อเจ้าของกิจการเปิด “ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้” คำขอที่ขอรับโอนและอนุมัติเอง ระบบจะบันทึกว่า “ผู้เบิกยืนยันบัญชีของตนเอง” ถ้าคนที่บันทึกจ่ายเป็นคนอื่น คนนั้นจะเป็นผู้ตรวจบัญชี',
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:931`: ['ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้', 'ให้ผู้อนุมัติอนุมัติคำขอที่ตัวเองสร้างได้ เจ้าของกิจการ แอดมิน และผู้จัดการ ทำได้อยู่แล้วโดยไม่ต้องเปิด', 'เปิดเมื่อผู้อนุมัติเป็นบทบาทอื่น และไม่มีคนอื่นอนุมัติแทน'],
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:971`: ['อนุมัติ ปฏิเสธ บันทึกจ่าย และยกเลิกการจ่าย', 'อนุมัติการเบิก', 'เจ้าของกิจการ แอดมิน ผู้จัดการ'],
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:973`: ['ตรวจการเงิน บันทึกจ่าย ยกเลิกการจ่าย และปลดรายการซ้ำ', 'ตรวจ/จ่ายการเบิก', 'เจ้าของกิจการ การเงิน'],
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:974`: ['เปิดแท็บตั้งค่านโยบาย และแก้นโยบายของทั้งบริษัท', 'ตั้งนโยบายการเบิก', 'เจ้าของกิจการ แอดมิน'],
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:975`: ['ตั้งบัญชีรับเงินคืนให้พนักงาน', 'สิทธิ์แก้ไขข้อมูลพนักงาน', 'เจ้าของกิจการ แอดมิน และผู้จัดการกับฝ่ายบุคคลในสาขาที่ตนดูแล'],
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:983`: detail: 'เจ้าของกิจการ แอดมิน และผู้จัดการ ทำได้อยู่แล้ว บทบาทที่บริษัทสร้างเองหรือเคยแก้ไข ซึ่งอนุมัติได้ ระบบเติมสิทธิ์บันทึกจ่ายและยกเลิกการจ่ายให้ 1 ครั้ง',
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:1031`: answer: 'เจ้าของกิจการ แอดมิน และผู้จัดการ อนุมัติคำขอของตัวเองได้ บทบาทอื่นจะเห็นข้อความว่าคำขอนี้เป็นของคุณเอง และบริษัทยังไม่เปิด “ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้” ให้ผู้อนุมัติท่านอื่นตัดสินแทน หรือขอให้เจ้าของกิจการเปิดในหน้าตั้งค่านโยบาย แล้วเปิดคำขอกลับเป็นร่างและส่งอนุมัติใหม่',

## Every remaining old-name occurrence in production sources

Search: `เจ้าของร้าน|แอดมิน|อ่านอย่างเดียว`, excluding test files. Each remaining matching line is
listed below with why it was left. These include historical comments and example names, not only
rendered words. This search does not reinterpret “บัญชี” (account), “การเงิน” (a menu/step), “คลังสินค้า”
(a branch type), or “ผู้ตรวจสอบ” (a document reviewer) as a standard role without a role-key context.

- `apps/web/src/common/api/api-error-message.ts:823`: partner_owner_name_unavailable: 'ไม่พบเจ้าของร้านที่แก้ชื่อได้ในบริษัทนี้ กรุณาโหลดข้อมูลใหม่', — platform partner/customer message, not an employee/claim standard-role label.
- `apps/web/src/common/api/api-error-message.ts:876`: // เซลล์ or เจ้าของร้าน — has anything to fix, so each sentence says what to expect instead. — comment/historical wording, not rendered.
- `apps/web/src/common/i18n/workspace-dictionary.ts:326`: 'auth.login.contact_owner': 'ติดต่อเจ้าของร้าน', — read-only state or customer-person wording outside the specified prose scope; no role-key label.
- `apps/web/src/common/i18n/workspace-dictionary.ts:851`: 'expenses.read_only': 'อ่านอย่างเดียว', — read-only state or customer-person wording outside the specified prose scope; no role-key label.
- `apps/web/src/common/i18n/workspace-dictionary.ts:921`: 'expenses.buyer_match_ask_owner': 'ให้เจ้าของร้านตั้งค่าที่หน้า ข้อมูลร้าน', — read-only state or customer-person wording outside the specified prose scope; no role-key label.
- `apps/web/src/common/i18n/workspace-dictionary.ts:1232`: 'expenses.manual_read_only': 'อ่านอย่างเดียว: บัญชีนี้ไม่มีสิทธิ์สร้างรายการค่าใช้จ่าย', — read-only state or customer-person wording outside the specified prose scope; no role-key label.
- `apps/web/src/features/billing/billing-error-text.ts:33`: if (status === 403) return 'บัญชีนี้ยังไม่มีสิทธิ์จัดการแพ็กเกจของร้านนี้ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจดำเนินการ'; — read-only state or customer-person wording outside the specified prose scope; no role-key label.
- `apps/web/src/features/billing/billing-preview.fixture.ts:163`: retainedMembers: ['เจ้าของร้าน', ...capacity.memberships.slice(1).map(() => 'พนักงานตัวอย่าง')], suspendedMembers: ['พนักงานที่ไม่เลือก'], defaults: [] } } : {}), — read-only state or customer-person wording outside the specified prose scope; no role-key label.
- `apps/web/src/features/billing/billing-preview.fixture.ts:171`: memberships: Array.from({ length: offer.employeeLimit + 1 }, (_, i) => ({ id: i ? \`member-${i}\` : 'owner', name: i ? \`พนักงานตัวอย่าง ${i}\` : 'เจ้าของร้าน', owner: !i, requi… — read-only state or customer-person wording outside the specified prose scope; no role-key label.
- `apps/web/src/features/billing/billing-preview.fixture.ts:187`: suspendedBranches: ['สาขาที่ไม่เลือก'], retainedMembers: target.capacity.memberships.map(member => member.id === 'owner' ? 'เจ้าของร้าน' : \`พนักงานตัวอย่าง ${member.id.split('-… — read-only state or customer-person wording outside the specified prose scope; no role-key label.
- `apps/web/src/features/billing-admin/BillingPlanAdjustmentsPage.tsx:86`: <p>ใช้งานอยู่ {data.activeBranches} สาขา · {data.activeMembers} ผู้ใช้ รวมเจ้าของร้าน</p> — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/company-profile/CompanyProfilePage.tsx:374`: ? 'บัญชีของคุณดูข้อมูลนี้ได้อย่างเดียว ถ้าต้องการแก้ไข ให้เจ้าของร้านเป็นคนแก้นะคะ' — company-profile advice outside the specified prose menus; no standard role-key label.
- `apps/web/src/features/company-profile/CompanyProfilePage.tsx:375`: : 'บัญชีของคุณเห็นข้อมูลนี้ได้บางส่วน ถ้าต้องการดูหรือแก้ไขทั้งหมด ให้เจ้าของร้านเป็นคนทำนะคะ'} — company-profile advice outside the specified prose menus; no standard role-key label.
- `apps/web/src/features/company-profile/CompanyProfilePage.tsx:461`: : 'บัญชีของคุณดูได้อย่างเดียว ให้เจ้าของร้านหรือผู้ทำบัญชีเป็นคนตอบนะคะ'} — company-profile advice outside the specified prose menus; no standard role-key label.
- `apps/web/src/features/expenses/ExpensesPages.tsx:525`: : <span className="inline-flex min-h-11 items-center">แจ้งเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจให้เปลี่ยนแพ็กเกจ</span>} — package purchase/renewal advice outside employees-and-rights/claims; no standard role-key label.
- `apps/web/src/features/external-signup/SignupPage.tsx:262`: ชื่อจริงของเจ้าของร้าน ใช้แสดงในระบบ ไม่ใช่ชื่อสำหรับเข้าสู่ระบบ — public signup/login/LIFF customer-person wording, explicitly excluded.
- `apps/web/src/features/external-signup/SignupWelcomePage.tsx:64`: last_active_owner: 'ร้านนี้จะไม่เหลือเจ้าของร้าน', — public signup/login/LIFF customer-person wording, explicitly excluded.
- `apps/web/src/features/plan-term/plan-term.logic.ts:62`: staff: 'ร้านนี้ยังไม่มีแพ็กเกจ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจเพื่อเริ่มใช้งาน', — package purchase/renewal advice outside employees-and-rights/claims; no standard role-key label.
- `apps/web/src/features/plan-term/plan-term.logic.ts:68`: staff: 'แพ็กเกจของร้านหมดอายุแล้ว ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจเพื่อใช้งานต่อ', — package purchase/renewal advice outside employees-and-rights/claims; no standard role-key label.
- `apps/web/src/features/sales-console/SalesDealFormPage.tsx:161`: approve: { title: 'อนุมัติดีลนี้', confirm: 'อนุมัติ', hint: 'เมื่ออนุมัติแล้ว ระบบจะแจ้งเจ้าของร้านทาง LINE และข้อเสนอจะใช้ได้ 3 วัน', required: false }, — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/sales-console/SalesDealFormPage.tsx:310`: setNotice(decision === 'approve' ? 'อนุมัติแล้ว ระบบแจ้งเจ้าของร้านทาง LINE ให้เปิดหน้าแพ็กเกจ' — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/sales-console/SalesDealFormPage.tsx:312`: : decision === 'end' ? 'ตั้งวันจบดีลแล้ว ระบบแจ้งเจ้าของร้านล่วงหน้า 14 วัน' : 'ยกเลิกดีลแล้ว'); — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/sales-console/sales-console.logic.ts:475`: // the shop, so it needs doing — เจ้าของร้าน gets the same notice in their own console and on LINE. — comment/historical wording, not rendered.
- `apps/web/src/features/sales-console/sales-console.logic.ts:664`: self_referral: 'ผู้แนะนำและเจ้าของร้านเป็นคนเดียวกัน', — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-onboarding/SystemOnboardingNewPage.tsx:296`: <li>สแกน QR เชื่อม LINE ด้านบนด้วยบัญชี LINE ของเจ้าของร้าน แล้วเข้าใช้งานผ่านปุ่มในแชทได้เลย</li> — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-onboarding/SystemOnboardingNewPage.tsx:486`: ไม่ออกชื่อผู้ใช้และรหัสผ่านชั่วคราว ส่งมอบด้วย QR เชื่อม LINE ของเจ้าของร้านอย่างเดียว (อายุ 72 ชั่วโมง) — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx:532`: showToast('บันทึกชื่อแล้ว ให้เจ้าของร้านรีเฟรชหน้าเพื่อเห็นชื่อใหม่', 'success'); — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx:2931`: <p className="mt-2">ใช้อยู่ {counts.branches} สาขา · {counts.members} ผู้ใช้ รวมเจ้าของร้าน</p><p className="mt-1 text-gray-600">ข้อมูลและผู้ใช้เดิมยังอยู่ หากเกินจำนวนใหม่จะเพิ… — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx:2985`: บริษัทนี้ถูกปิดโดยแอดมิน การต่ออายุจะไม่เปิดใช้งานอัตโนมัติ — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx:3071`: ? \`ส่งข้อความนี้เข้าไลน์ของเจ้าของร้านและผู้ที่เปิดคำขอ ใช่หรือไม่\n\n${message}\` — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx:3072`: : \`ส่งข้อความนี้เข้าไลน์ของเจ้าของร้าน ใช่หรือไม่\n\n${message}\`, — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx:3082`: showToast('ยังไม่ได้ส่ง เพราะเจ้าของร้านยังไม่ได้ผูก LINE', 'error'); — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx:3118`: ? 'ส่งถึงเจ้าของร้านที่ผูก LINE ไว้ และผู้ที่เปิดคำขอนี้ ' — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx:3119`: : 'ส่งถึงเจ้าของร้านที่ผูก LINE ไว้ '} — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/system-partners/SharedLineSettingsPage.tsx:32`: <details className="border-t border-gray-100 pt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">ข้อมูลบัญชีและประวัติการตั้งค่า</summary><dl className… — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:104`: ['ตั้งค่านโยบาย', 'เจ้าของกิจการ และแอดมิน', 'เลือกผู้อนุมัติ เกณฑ์ยอด ใบเสร็จ รายการซ้ำ และเวลาที่ใช้ตัดสิน'], — guide owned by another lane; exact required sentences above.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:328`: detail: 'เจ้าของกิจการและแอดมินตั้งให้พนักงานได้ทุกคน ผู้จัดการและฝ่ายบุคคลตั้งให้ได้เฉพาะพนักงานในสาขาที่ตนดูแล โดยใช้กล่อง “บัญชีรับเงินคืน” ในหน้าแก้ไขข้อมูลพนักงาน บัญชีของเ… — guide owned by another lane; exact required sentences above.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:458`: detail: 'เจ้าของกิจการ แอดมิน และผู้จัดการ อนุมัติคำขอของตัวเองได้ ระบบบันทึกไว้ว่าอนุมัติรายการของตนเอง บทบาทอื่นทำได้เมื่อเจ้าของกิจการเปิด “ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเอ… — guide owned by another lane; exact required sentences above.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:931`: ['ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้', 'ให้ผู้อนุมัติอนุมัติคำขอที่ตัวเองสร้างได้ เจ้าของกิจการ แอดมิน และผู้จัดการ ทำได้อยู่แล้วโดยไม่ต้องเปิด', 'เปิดเมื่อผู้อนุมัติเป็นบทบ… — guide owned by another lane; exact required sentences above.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:971`: ['อนุมัติ ปฏิเสธ บันทึกจ่าย และยกเลิกการจ่าย', 'อนุมัติการเบิก', 'เจ้าของกิจการ แอดมิน ผู้จัดการ'], — guide owned by another lane; exact required sentences above.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:974`: ['เปิดแท็บตั้งค่านโยบาย และแก้นโยบายของทั้งบริษัท', 'ตั้งนโยบายการเบิก', 'เจ้าของกิจการ แอดมิน'], — guide owned by another lane; exact required sentences above.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:975`: ['ตั้งบัญชีรับเงินคืนให้พนักงาน', 'สิทธิ์แก้ไขข้อมูลพนักงาน', 'เจ้าของกิจการ แอดมิน และผู้จัดการกับฝ่ายบุคคลในสาขาที่ตนดูแล'], — guide owned by another lane; exact required sentences above.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:983`: detail: 'เจ้าของกิจการ แอดมิน และผู้จัดการ ทำได้อยู่แล้ว บทบาทที่บริษัทสร้างเองหรือเคยแก้ไข ซึ่งอนุมัติได้ ระบบเติมสิทธิ์บันทึกจ่ายและยกเลิกการจ่ายให้ 1 ครั้ง', — guide owned by another lane; exact required sentences above.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:1031`: answer: 'เจ้าของกิจการ แอดมิน และผู้จัดการ อนุมัติคำขอของตัวเองได้ บทบาทอื่นจะเห็นข้อความว่าคำขอนี้เป็นของคุณเอง และบริษัทยังไม่เปิด “ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้” ให้… — guide owned by another lane; exact required sentences above.
- `apps/api/src/common/security/liff-page.security.ts:152`: <p class="note">ส่วนลดนี้เป็นของบัญชี LINE นี้ ใช้ได้เมื่อคุณเป็นเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจของร้าน ถ้าจะใช้กับร้านที่คุณทำงานอยู่ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดกา… — public signup/login/LIFF customer-person wording, explicitly excluded.
- `apps/api/src/common/security/liff-page.security.ts:203`: no_membership: 'บัญชี LINE นี้ยังไม่ได้อยู่ในร้านไหนค่ะ ให้เจ้าของร้านส่งลิงก์เชิญให้อีกครั้งนะคะ' — public signup/login/LIFF customer-person wording, explicitly excluded.
- `apps/api/src/common/security/liff-page.security.ts:234`: const EMAIL_RULE_TH = 'ใส่อีเมลเจ้าของร้านให้ถูกต้อง เช่น shop@example.com ยาวไม่เกิน 254 ตัวอักษร'; — public signup/login/LIFF customer-person wording, explicitly excluded.
- `apps/api/src/common/security/liff-page.security.ts:248`: line_signup_email_required: { tone: 'warning', text: 'ยังไม่ได้ใส่อีเมลเจ้าของร้าน', advice: EMAIL_RULE_TH, field: 'contact-email' }, — public signup/login/LIFF customer-person wording, explicitly excluded.
- `apps/api/src/common/security/liff-page.security.ts:249`: line_signup_email_invalid: { tone: 'warning', text: 'อีเมลเจ้าของร้านยังไม่ถูกต้อง', advice: EMAIL_RULE_TH, field: 'contact-email' }, — public signup/login/LIFF customer-person wording, explicitly excluded.
- `apps/api/src/common/security/liff-page.security.ts:807`: : shop + ' ' + LOCK_SENTENCE_TH[key] + ' ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจก่อน แล้วเข้าใช้งานได้เลยค่ะ'; — public signup/login/LIFF customer-person wording, explicitly excluded.
- `apps/api/src/common/security/liff-page.security.ts:1059`: throw refusal({ tone: 'warning', text: 'อีเมลเจ้าของร้านยังไม่ถูกต้อง', advice: EMAIL_RULE_TH }); — public signup/login/LIFF customer-person wording, explicitly excluded.
- `apps/api/src/modules/access-control/domain/logic/plan-manager.logic.ts:10`: export const ASK_PLAN_MANAGER_TH = 'หากต้องการใช้ต่อ แจ้งเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ'; — package-purchase/receipt-quota/assistant advice; checkout/assistant scope excluded.
- `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts:267`: description: 'ดูและส่งออกค่าใช้จ่ายทั้งบริษัท (อ่านอย่างเดียว)', — read-only state or customer-person wording outside the specified prose scope; no role-key label.
- `apps/api/src/modules/employee-access/domain/registries/role-template.registry.ts:32`: nameTh: 'อ่านอย่างเดียว/ผู้ตรวจสอบ', nameEn: 'Read-only / Auditor', — example role name, explicitly excluded.
- `apps/api/src/modules/employee-access/domain/registries/role-template.registry.ts:33`: description: 'เห็นข้อมูลทุกส่วนแบบอ่านอย่างเดียวสำหรับตรวจสอบ', — example role name, explicitly excluded.
- `apps/api/src/modules/external-signup/application/submit-line-signup.use-case.ts:540`: ownerDisplayName: verified.displayName ?? 'เจ้าของร้าน', — public signup/login/LIFF customer-person wording, explicitly excluded.
- `apps/api/src/modules/line-ai/application/use-cases/erp-package-tools.use-case.ts:170`: usersNote: 'จำนวนผู้ใช้รวมเจ้าของร้าน', — assistant/LINE-AI source, explicitly excluded.
- `apps/api/src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.ts:534`: disclaimer: 'เป็นผลกระทบยอดล่าสุดแบบอ่านอย่างเดียว AI ไม่สร้างรอบใหม่ ไม่แก้ issue และไม่ยื่นแบบ', — assistant/LINE-AI source, explicitly excluded.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:268`: const EMPLOYEE_DOOR_REPLY = '👋 ยินดีต้อนรับค่ะ ถ้าคุณเป็นพนักงาน ให้เจ้าของร้านเปิดเมนู "พนักงาน" ในเว็บแอป ' — assistant/LINE-AI source, explicitly excluded.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:358`: const PACKAGE_CHANGE_NOT_OWNER_REPLY = '📦 การเปลี่ยนแพ็กเกจต้องให้เจ้าของร้านเป็นคนขอนะคะ รบกวนแจ้งเจ้าของร้านให้พิมพ์ ' — assistant/LINE-AI source, explicitly excluded.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:473`: export const PACKAGE_REQUIRED_MEMBER_REPLY = 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ค่ะ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจก่อน แล้วน้องมั่งมีจะกลับมาช่วยได้เต็มท… — assistant/LINE-AI source, explicitly excluded.
- `apps/api/src/modules/line-ai/domain/logic/line-event-discount.logic.ts:71`: export const EVENT_DISCOUNT_MEMBER_REPLY = 'ส่วนลดจากงานใช้ตอนซื้อแพ็กเกจของร้าน เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจสอบถามในแชทนี้ได้เลยค่ะ'; — assistant/LINE-AI source, explicitly excluded.
- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:350`: ? [{ type: 'text', text: 'เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเป็นคนเลือกแพ็กเกจให้ร้านนะคะ', size: 'sm', color: '#667085', wrap: true }] — assistant/LINE-AI source, explicitly excluded.
- `apps/api/src/modules/system-partner-management/application/use-cases/get-partner-timeline.use-case.ts:94`: label: signup ? sourceLabel(signup.source) : 'แอดมินเปิดร้านให้', — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/api/src/modules/system-partner-management/application/use-cases/get-partner-timeline.use-case.ts:101`: label: signup.autoApproved ? 'อนุมัติอัตโนมัติ' : 'แอดมินอนุมัติ', — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/api/src/modules/system-partner-management/application/use-cases/get-partner-timeline.use-case.ts:212`: OPEN: 'รอแอดมิน', — platform-admin/sales-console customer-person wording, explicitly excluded.
- `apps/api/src/scripts/billing-receipt-adjustments-smoke.ts:110`: await page.getByRole('textbox',{name:'เหตุผลที่ปรับใบเสร็จ',exact:true}).fill('เพิ่มจากหน้าเว็บให้เจ้าของร้าน'); — smoke fixture/assertion for excluded billing/admin workflow.
- `apps/api/src/scripts/billing-receipt-adjustments-smoke.ts:117`: assert.equal(await page.getByRole('textbox',{name:'เหตุผลที่ปรับใบเสร็จ',exact:true}).inputValue(),'เพิ่มจากหน้าเว็บให้เจ้าของร้าน'); — smoke fixture/assertion for excluded billing/admin workflow.
- `apps/api/src/scripts/billing-receipt-adjustments-smoke.ts:143`: await other.getByText('เหตุผล: เพิ่มจากหน้าเว็บให้เจ้าของร้าน',{exact:true}).waitFor();await other.reload({waitUntil:'domcontentloaded'}); — smoke fixture/assertion for excluded billing/admin workflow.
- `apps/api/src/scripts/line-runtime-credentials-smoke.ts:127`: await page.getByRole('region',{name:'สถานะ LINE ปัจจุบัน'}).getByText('บันทึกจากหน้าแอดมิน · รุ่น 2',{exact:true}).waitFor(); — smoke fixture/assertion for excluded billing/admin workflow.
- `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:51`: { id: 'kuan-10', category: 'กวน', text: 'อะไรเอ่ย มาถึงหน้าร้านก่อนเจ้าของร้านทุกวันเลย? ...แสงแดดค่ะ 😄' }, — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:54`: { id: 'series-01', category: 'ซีรีส์', text: 'เป็นเจ้าของร้านนี่เหมือนนางเอกซีรีส์เลยนะคะ โดนมรสุมทุก EP แต่ตอนจบต้องแฮปปี้ค่ะ สู้ ๆ นะคะ 💚' }, — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:61`: { id: 'wai-01', category: 'วาย', text: 'ยอดขายกับกำไรนี่คู่จิ้นชัด ๆ ค่ะ ห่างกันทีไรแฟน ๆ (เจ้าของร้าน) ใจพังทุกที 555' }, — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:64`: { id: 'wai-04', category: 'วาย', text: 'ร้านกับเจ้าของร้านนี่คู่หลักของเรื่องเลยนะคะ งอนกันบ้าง แต่สุดท้ายก็ไปด้วยกันตลอดค่ะ 💚' }, — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:70`: { id: 'yut-03', category: 'ยุทธภพ', text: 'เจ้าของร้านคือเจ้าสำนักตัวจริงค่ะ ทีมงานคือศิษย์พี่ศิษย์น้อง ส่วนน้องมั่งมีขอเป็นเด็กถือกระบี่ตามหลังนะคะ 😄' }, — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:75`: { id: 'idol-01', category: 'ไอดอล', text: 'วันนี้เหนื่อยไหมคะ อย่าลืมว่าเจ้าของร้านคือ center ของร้านนี้เลยนะ แฟนคลับ (น้องมั่งมี) เป็นกำลังใจให้ค่ะ 💚' }, — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:76`: { id: 'idol-02', category: 'ไอดอล', text: 'วันนี้ขอโบกแท่งไฟให้เจ้าของร้านหนึ่งรอบค่ะ ทำงานมาทั้งวัน สมควรได้เสียงเชียร์นะคะ 😄' }, — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:79`: { id: 'idol-05', category: 'ไอดอล', text: 'ถ้ามีเวทีประกาศรางวัล "คนขยันแห่งปี" น้องมั่งมีขอโหวตให้เจ้าของร้านค่ะ 555' }, — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/domain/logic/business-read-result-semantics.ts:200`: : 'เรื่องแพ็กเกจและเครดิตของร้าน ถามเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ'; — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/domain/logic/business-read-result-semantics.ts:219`: const WHERE_OR_HOW = '(?:บนเว็บ\|ทางเว็บ\|ผ่านเว็บ\|หน้าเว็บ\|เว็บไซต์\|หน้าแพ็?[กค]เกจ\|ติดต่อ(?:เจ้าหน้าที่\|ทีมงาน\|แอดมิน))'; — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts:219`: *  never said "ไม่มีสิทธิ์"/"อ่านอย่างเดียว" — the words customers and the eval look for — so it read as — assistant/LINE-AI source, explicitly excluded.
- `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts:226`: : 'บัญชีของคุณเป็นสิทธิ์แบบอ่านอย่างเดียวค่ะ จึงยังไม่มีสิทธิ์บันทึกหรือส่งใบเสร็จเข้าระบบ ถ้าต้องการบันทึก ให้ผู้ดูแลบริษัทเพิ่มสิทธิ์ให้ก่อนนะคะ'; — assistant/LINE-AI source, explicitly excluded.

## Specs, QA and browser-assertion discovery

- `company-role-override-spec.md` R11 records names, system/copy/custom semantics, membership names,
  permissions unchanged and integration evidence; the role-picker spec links this rule.
- The claim payout spec's role labels now say ผู้ดูแลบริษัท / ฝ่ายการเงิน / ฝ่ายบัญชี and the full
  read-only auditor name. `finance-accounting-gaps-spec.md:135` uses ฝ่ายบัญชี / ฝ่ายการเงิน.
- `docs/qa/tennis-shop-e2e-test-cases-2026-07-29.md:55` already names COMPANY_VIEW เจ้าของบริษัท;
  left unchanged. Its user display names and narrative occupations at 54–62 are fixture data,
  not role labels; left unchanged. Broader signup/billing/platform specs are excluded customer-person
  language. The earlier wording memory's old labels are historical and now link the settled rule.
- E2E files changed: **none**. Existing `e2e/settings.spec.ts:89–92,298,305–325` already expects
  ฝ่ายบัญชี / ฝ่ายการเงิน. `settings.spec.ts:504` tests a read-only banner, not an auditor role label.
- Other search hits left: `e2e/sales-console.spec.ts:140` (excluded sales notice),
  `line-signup-contact-email.spec.ts:27,117` and `system-admin.spec.ts:303` (person names),
  `billing-preview.spec.ts:161,324` (checkout fixture person),
  `plan-term-billing-readiness.spec.ts:350` (package/renewal advice),
  `accounts-payable.spec.ts:279` and `expenses.spec.ts:904` (generic permission-message assertions
  outside the changed roles; baseline already uses “กรุณาติดต่อผู้ดูแลสิทธิ์ของบริษัท” for an uncoded 403,
  so these old owner assertions may be stale; not checked in a browser).
- A company's previously stored Thai descriptions remain company-owned data. In particular exact
  prior ADMIN/AUDITOR descriptions can retain “ผู้ดูแลงานในบริษัท” / “ผู้ตรวจสอบ”; their automatic
  normalization is not a product rule supplied by this brief. The existing former-English-description
  fallback remains and its registered specs pass. System descriptions update through the existing
  release `sync-permissions` procedure; no database was touched here.
- Whether shops should see SYSTEM_ADMIN/COMPANY_VIEW, grants and the 21 examples' own names remain
  out of scope. No hiding or reassignment was implemented.
- The approval-backlog spec is unregistered in the API test script. Discovery run only; no final edit
  remains there. The new recovery-note regression is in registered `reimbursement-approval.use-case.spec.ts`.


## Original guide question (settled in controller follow-up below)

`expenses-guide.content.ts:96` and `substitute-receipt-guide.content.ts:59,289,338,341` say that
“ผู้ดูแลระบบ” can manage company/receipt settings or work on expenses. `ROLE_GRANTS.SYSTEM_ADMIN`
contains platform permissions, not `company.setup.manage` or business expense rights. Question:
**Should these guides name ADMIN (ผู้ดูแลบริษัท), or describe the required permission without a
role name?** The initial pass left those phrases literal. The controller's 2026-10-03 instruction
settles this by checking ADMIN's grants; the follow-up evidence below supersedes this question.

## Verification commands and actual results

Every command below used the node tsx loader, not the socket-opening tsx CLI. Red means the old
production code/line was still present or temporarily put back, then restored. No API spec file
was created. All final API regressions are in files listed by the package test script.

| Exact command | Red before fix | Final green |
| --- | --- | --- |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/features/employee-access/role-picker.logic.spec.ts` | rc 1; 20 pass / 1 fail / 0 skip (21 tests) | rc 0; 21 pass / 0 fail / 0 skip (21 tests) |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/common/components/app-shell/AppSidebar.spec.ts` | rc 1; 10 pass / 2 fail / 0 skip (12 tests) | rc 0; 12 pass / 0 fail / 0 skip (12 tests) |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/features/employee-access/IndividualPermissionsPrototypePage.spec.ts` | rc 1; 8 pass / 2 fail / 0 skip (10 tests) | rc 0; 10 pass / 0 fail / 0 skip (10 tests) |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/features/reimbursements/ReimbursementPages.plain-thai.qa.spec.ts` | rc 1; 54 pass / 2 fail / 0 skip (56 tests) | rc 0; 55 pass / 0 fail / 0 skip (55 tests) |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/features/reimbursements/ReimbursementPayout.qa.spec.ts` | rc 1; 32 pass / 1 fail / 0 skip (33 tests) | rc 0; 33 pass / 0 fail / 0 skip (33 tests) |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/features/employee-access/discount-policy.model.spec.ts` | rc 1; 5 pass / 1 fail / 0 skip (6 tests) | rc 0; 6 pass / 0 fail / 0 skip (6 tests) |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/features/user-guide/user-guide.content.spec.ts` | rc 1; 12 pass / 1 fail / 0 skip (13 tests) | rc 0; 13 pass / 0 fail / 0 skip (13 tests) |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/common/api/api-error-message.spec.ts` | rc 1; 48 pass / 1 fail / 0 skip (49 tests) | rc 0; 49 pass / 0 fail / 0 skip (49 tests) |
| `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/auth/permission-registry.spec.ts` | rc 1; 44 pass / 1 fail / 0 skip (45 tests) | rc 0; 45 pass / 0 fail / 0 skip (45 tests) |
| `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts` | rc 1; 91 pass / 1 fail / 0 skip (92 tests) | rc 0; 92 pass / 0 fail / 0 skip (92 tests) |
| `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/auth/presentation/auth.controller.spec.ts` | rc 1; 20 pass / 1 fail / 0 skip (21 tests) | rc 0; 21 pass / 0 fail / 0 skip (21 tests) |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/common/i18n/workspace-i18n.spec.ts` | unchanged tests | rc 0; 11 pass / 0 fail / 0 skip (11 tests) |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/features/employee-access/access-overview.model.spec.ts` | unchanged tests | rc 0; 8 pass / 0 fail / 0 skip (8 tests) |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/features/reimbursements/reimbursements-preview.spec.ts` | unchanged tests | rc 0; 8 pass / 0 fail / 0 skip (8 tests) |
| `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/employee-access/application/use-cases/role-management.use-case.spec.ts` | unchanged tests | rc 0; 38 pass / 0 fail / 0 skip (38 tests) |
| `pnpm --filter @watchdog-bms/contracts exec node --import tsx --test --test-reporter=spec src/employee-access.spec.ts` | unchanged tests | rc 0; 6 pass / 0 fail / 0 skip (6 tests) |

Additional explicit old-line checks, using the same spec commands:

- Missing isSystem must keep a company name: rc 1; 20 pass / 1 fail / 0 skip (21 tests).
- Bare stored System Admin name must translate: rc 1; 20 pass / 1 fail / 0 skip (21 tests).
- Switcher must preserve company-named copies: rc 1; 54 pass / 1 fail / 0 skip (55 tests).
- Read-only payout account caption must use ADMIN's standard name: rc 1; 32 pass / 1 fail / 0 skip (33 tests).
- RoleBuilder must open with the displayed name: rc 1; 54 pass / 1 fail / 0 skip (55 tests).
- Role page must delegate its editor initialization: rc 1; 9 pass / 1 fail / 0 skip (10 tests).

- Discovery only: `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/reimbursements/application/use-cases/reimbursement-approval-backlog.use-case.spec.ts`: rc 1, 9 pass / 1 fail / 0 skip with a temporary new OWNER-text assertion; that assertion was removed and added to the registered approval spec instead. No final diff in the unregistered file.
- Intermediate green attempt: claim plain-Thai spec rc 1 (54 pass / 1 fail of 55), because a one-company fixture hides the switcher; fixture corrected to two companies. Payout spec rc 1 (32 pass / 1 fail of 33), because an old source-text assertion still expected แอดมิน; changed to render and assert the real read-only caption, proved red on the old line, then green.
- `pnpm --filter @watchdog-bms/contracts build`: twice, rc 0 each; no test counts.
- `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh pnpm --filter @watchdog-bms/api typecheck`: rc 0; no test counts.
- The same wrapper with `pnpm --filter @watchdog-bms/web typecheck`: first rc 2 (array.map supplied its numeric index as the new locale argument; two generated Thai sales-role keys lacked English entries), corrected; second rc 0. Existing English names untouched; the two sales names added in English. No test counts.
- `git diff --check`: rc 0, no whitespace errors. Final repetition after updating this note also rc 0.
- Final focused totals: 428 pass / 0 fail / 0 skip across 16 distinct spec files. Full suites, real PostgreSQL, browser, live deployments and LINE-AI acceptance: not checked, unavailable or reserved for controller per lane rules.

### Individual red/green regressions

1. Picker all-role dictionary parity, stored names, company copies, absent flags and bare stored names: old OWNER เจ้าของร้าน; old missing-flag company name overwritten; old bare System Admin exposed; final passes all 15 keys.
2. Sidebar all-role rendering: old OWNER label mismatch; final all 15 Thai labels and no stored English label.
3. Sidebar company copies/custom roles: old ADMIN ignored the company's name; final preserves it and existing English locale labels.
4. Role/employee page display/editor source contract: old local rule/export and raw builder name; final shared rule and builder display name.
5. Employees-and-rights prose: old เจ้าของร้าน/แอดมิน; final OWNER/ADMIN names from contracts and website caption.
6. Claim existing one-name regression: old แอดมิน and inconsistent errors; final shared ADMIN name and no retired admin alias.
7. Cross-surface rendered claim-policy regression: old role-page OWNER mismatch; old switcher drops a custom ADMIN name; old editor exposes Owner; final all 15 keys agree on role-page helper, picker, editor, switcher and policy labels/warnings, preserving company names.
8. Payout account route empty state: old “…หรือแอดมิน”; final “…หรือผู้ดูแลบริษัท”.
9. Read-only payout caption: old “…หรือแอดมิน…”; final rendered “…หรือผู้ดูแลบริษัท…”.
10. Discount override options: old เจ้าของร้านเท่านั้น / เจ้าของและผู้จัดการ; final standard OWNER/MANAGER names.
11. Guides: old bare การเงิน and unqualified ผู้ตรวจสอบ in role tables; final finance/auditor labels and distinct ฝ่ายบัญชีและฝ่ายการเงิน.
12. Employee/claim error translations: old เจ้าของร้าน/แอดมิน; final standard OWNER/ADMIN in all four asserted refusals.
13. API role descriptions: old ผู้ดูแลงานในบริษัท and ผู้ตรวจสอบ; final ผู้ดูแลบริษัท and ผู้ตรวจสอบ (ดูอย่างเดียว).
14. Auth company list names: old name not selected and no roleNames result; final distinct stored name per membership, keys preserved.
15. Registered missing-approver note: old เจ้าของร้าน; final เจ้าของกิจการ.

## Controller checks (not run here)

- Full API/web/contracts verification, using the controller's normal registered commands; whole-package checks use the supplied lock wrapper. Run the web suite with no `S3_*` variables.
- `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/employee-access/create-employee-username.pg.spec.ts` with the real test database. No PostgreSQL was available; this lane did not claim skipped specs as passed.
- `pnpm exec playwright test e2e/settings.spec.ts e2e/responsive.spec.ts e2e/sidebar-nav.spec.ts e2e/reimbursements.spec.ts` on the controller's seeded stack. Browser, servers and network are prohibited in this lane.
- Integrate the other lane's reimbursement guide/pin; this lane's three guide pins and ADMIN guide decision are resolved below. Review company-owned legacy descriptions and excluded aliases; no live release was attempted.

## Words changed (rendered output)

Unchanged Thai names still come from the one list; converting an unchanged sentence to interpolation
does not change its rendered words. The existing English dictionary labels remain; new English entries
for the two sales keys are “Mangmee Sales Lead” and “Mangmee Sales”.

| Where / cases | Old | New |
| --- | --- | --- |
| Standard OWNER role page/footer | เจ้าของร้าน | เจ้าของกิจการ |
| Standard ADMIN role page/footer/claim policy | แอดมิน | ผู้ดูแลบริษัท |
| Standard INVENTORY role page/footer/claim policy | คลังสินค้า | ฝ่ายคลังสินค้า |
| Standard FINANCE role page/footer/claim policy | การเงิน | ฝ่ายการเงิน |
| Standard ACCOUNTANT role page/footer/claim policy | บัญชี | ฝ่ายบัญชี |
| Standard MARKETING role page/footer/claim policy | การตลาด | ฝ่ายการตลาด |
| Standard AUDITOR_READONLY role page/footer; claim policy | ผู้ตรวจสอบ (อ่านอย่างเดียว); ผู้ตรวจสอบ | ผู้ตรวจสอบ (ดูอย่างเดียว) |
| Standard SYSTEM_ADMIN, MANAGER, HR, SALES, STAFF, COMPANY_VIEW | ผู้ดูแลระบบ; ผู้จัดการ; ฝ่ายบุคคล; ฝ่ายขาย; พนักงาน; เจ้าของบริษัท | Same words, one source |
| Sales keys in Thai dictionary/footer | No dictionary entry; footer could show stored English | หัวหน้าทีมขายมั่งมี; เซลล์มั่งมี |
| Company-named copy in sidebar/switcher | Standard label or key | Company's stored name |
| Role-builder field on an unnamed company copy | Stored English name | Corresponding standard Thai name |
| Employee branch caption | เจ้าของร้านกำหนดสาขาที่พนักงานคนนี้เข้าถึง · เวลาเขาล็อกอินจะเห็นเฉพาะสาขาที่ได้รับมอบหมาย (อย่างน้อย 1 สาขา) | เจ้าของกิจการกำหนดสาขาที่พนักงานคนนี้เข้าถึง · เวลาเขาล็อกอินจะเห็นเฉพาะสาขาที่ได้รับมอบหมาย (อย่างน้อย 1 สาขา) |
| Both employee branch pickers, viewer limited to assigned branches | กำหนดได้เฉพาะสาขาที่บัญชีของคุณเข้าถึง หากต้องการเปลี่ยนขอบเขตนอกเหนือจากนี้ กรุณาติดต่อเจ้าของร้าน | กำหนดได้เฉพาะสาขาที่บัญชีของคุณเข้าถึง หากต้องการเปลี่ยนขอบเขตนอกเหนือจากนี้ กรุณาติดต่อเจ้าของกิจการ |
| Employee login-credential caption | ใช้เข้าหน้าเว็บแอดมิน มั่งมี | ใช้เข้าเว็บไซต์มั่งมี |
| Discount override OWNER option | เจ้าของร้านเท่านั้น | เจ้าของกิจการเท่านั้น |
| Discount override MANAGER option | เจ้าของและผู้จัดการ | เจ้าของกิจการและผู้จัดการ |
| Discount automatic-offer help | เมื่อเปิด ระบบจะเสนอส่วนลดให้ลูกค้าเครดิตดี/ประจำ ตามค่ากลางด้านล่างโดยไม่ต้องให้แอดมินกดเอง | เมื่อเปิด ระบบจะเสนอส่วนลดให้ลูกค้าเครดิตดี/ประจำ ตามค่ากลางด้านล่างโดยไม่ต้องให้ผู้ดูแลบริษัทกดเอง |
| Read-only payout account editor | บัญชีนี้ตั้งหรือแก้ได้โดยเจ้าของบัญชี เจ้าของกิจการ หรือแอดมิน ส่วนผู้จัดการและฝ่ายบุคคลตั้งให้ได้เฉพาะพนักงานในสาขาที่ตนดูแล | บัญชีนี้ตั้งหรือแก้ได้โดยเจ้าของบัญชี เจ้าของกิจการ หรือผู้ดูแลบริษัท ส่วนผู้จัดการและฝ่ายบุคคลตั้งให้ได้เฉพาะพนักงานในสาขาที่ตนดูแล |
| Payout-account page without reimbursement.create | บัญชีนี้ยังไม่มีสิทธิ์สร้างคำขอเบิก กรุณาติดต่อเจ้าของกิจการหรือแอดมิน | บัญชีนี้ยังไม่มีสิทธิ์สร้างคำขอเบิก กรุณาติดต่อเจ้าของกิจการหรือผู้ดูแลบริษัท |
| Claim create/hub unavailable | ขณะนี้ไม่สามารถสร้างคำขอใหม่ได้ กรุณาติดต่อเจ้าของกิจการหรือแอดมินเพื่อตรวจสอบการเปิดใช้งานการเบิกจ่ายและสิทธิ์บัญชี · ยังดูประวัติเดิมได้ตามสิทธิ์ | ขณะนี้ไม่สามารถสร้างคำขอใหม่ได้ กรุณาติดต่อเจ้าของกิจการหรือผู้ดูแลบริษัทเพื่อตรวจสอบการเปิดใช้งานการเบิกจ่ายและสิทธิ์บัญชี · ยังดูประวัติเดิมได้ตามสิทธิ์ |
| payout_account_edit_denied | คุณตั้งบัญชีรับเงินคืนของคนนี้ไม่ได้ ให้เจ้าของบัญชีตั้งเอง หรือให้เจ้าของกิจการหรือแอดมินตั้งให้ | คุณตั้งบัญชีรับเงินคืนของคนนี้ไม่ได้ ให้เจ้าของบัญชีตั้งเอง หรือให้เจ้าของกิจการหรือผู้ดูแลบริษัทตั้งให้ |
| reimbursement_policy_inactive, API translation and claim model use one sentence | บริษัทปิดรับใบเบิกใหม่ชั่วคราว กรุณาติดต่อเจ้าของกิจการหรือแอดมิน | บริษัทปิดรับใบเบิกใหม่ชั่วคราว กรุณาติดต่อเจ้าของกิจการหรือผู้ดูแลบริษัท |
| company_access_unavailable | คุณไม่มีสิทธิ์เข้าใช้บริษัทนี้แล้ว กรุณาติดต่อเจ้าของร้าน | คุณไม่มีสิทธิ์เข้าใช้บริษัทนี้แล้ว กรุณาติดต่อเจ้าของกิจการ |
| Employee branch-scope refusal | เปลี่ยนสาขาของพนักงานคนนี้ไม่ได้ เพราะพนักงานอยู่ในสาขาที่บัญชีของคุณเข้าไม่ถึง หรือสาขาที่เลือกอยู่นอกสาขาของคุณ กรุณาติดต่อเจ้าของร้าน | เปลี่ยนสาขาของพนักงานคนนี้ไม่ได้ เพราะพนักงานอยู่ในสาขาที่บัญชีของคุณเข้าไม่ถึง หรือสาขาที่เลือกอยู่นอกสาขาของคุณ กรุณาติดต่อเจ้าของกิจการ |
| ADMIN standard description | สำหรับผู้ดูแลงานในบริษัท: ตั้งค่าบริษัท สาขา พนักงาน และงานประจำวันของร้าน | สำหรับผู้ดูแลบริษัท: ตั้งค่าบริษัท สาขา พนักงาน และงานประจำวันของร้าน |
| AUDITOR standard description | สำหรับผู้ตรวจสอบ: ดูข้อมูลของบริษัทเพื่อตรวจสอบโดยไม่แก้ไข | สำหรับผู้ตรวจสอบ (ดูอย่างเดียว): ดูข้อมูลของบริษัทเพื่อตรวจสอบโดยไม่แก้ไข |
| API backlog, no active approver | ผู้ที่ถูกกำหนดให้อนุมัติไม่อยู่หรือไม่ได้ดูแลสาขานี้แล้ว เจ้าของร้านหรือผู้มีบทบาทอนุมัติเดิมอนุมัติแทนได้บนเว็บ | ผู้ที่ถูกกำหนดให้อนุมัติไม่อยู่หรือไม่ได้ดูแลสาขานี้แล้ว เจ้าของกิจการหรือผู้มีบทบาทอนุมัติเดิมอนุมัติแทนได้บนเว็บ |
| Expense guide audience | ฝ่ายบัญชีและการเงิน | ฝ่ายบัญชีและฝ่ายการเงิน |
| Expense/report guide role table, company expense/report read | ฝ่ายบัญชี, การเงิน, ผู้จัดการ, เจ้าของกิจการ | ฝ่ายบัญชี, ฝ่ายการเงิน, ผู้จัดการ, เจ้าของกิจการ |
| Expense guide role table, manual entry | ฝ่ายบัญชี, การเงิน | ฝ่ายบัญชี, ฝ่ายการเงิน |
| Report guide role table, saved reports | ฝ่ายบัญชี, ผู้ตรวจสอบ | ฝ่ายบัญชี, ผู้ตรวจสอบ (ดูอย่างเดียว) |
| Tax guide role table, read periods | ฝ่ายบัญชี, การเงิน, เจ้าของกิจการ | ฝ่ายบัญชี, ฝ่ายการเงิน, เจ้าของกิจการ |
| Substitute guide role table, prepare evidence | เจ้าของกิจการ, ผู้ดูแลระบบ, ผู้จัดการ, ฝ่ายบัญชีและการเงิน | เจ้าของกิจการ, ผู้ดูแลระบบ, ผู้จัดการ, ฝ่ายบัญชีและฝ่ายการเงิน |

## Controller follow-up 1 (2026-10-03; accepted changes, request-permission analysis superseded below)

### Scope and permission evidence

The controller authorized only the three guide source hashes in `apps/ai-gateway` and the
permission-backed ADMIN wording in the four shop guides. Six occurrences change. Tax was checked
and has no follow-up edit. No grant, card body, reimbursement guide, reimbursement hash, or
reimbursement pending-sentence block changed. The existing pending-sentence block is preserved
byte-for-byte (SHA-256 `5f6459ff6894fecbfe1dd7409aadd2edbd98081dd82e756bb943788b5da69ade`).

`apps/api/src/modules/auth/permission-registry.ts:619–729` gives ADMIN `company.setup.manage`
(line 630), `expense.review` (line 673), and `REPORT_BI_ADMIN_GRANTS` (line 728). The latter includes
`report.snapshot.read` and `report.audit.read` through the lists at lines 479–499. The explicit
comment at 635–639 excludes `access.role.manage`, `admin.role.manage` and
`access.role_template.manage`. ADMIN has no `tax.report.read`, `tax.review_issue.read` or
`tax.report.export`. SYSTEM_ADMIN (lines 533–570) has platform rights, not those business rights.
The permission to perform an export is different from the permission to grant another person
export access: ADMIN holds `report.export`, but not `access.role.manage`.

| Guide and line | Business operation | Checked ADMIN permission | Follow-up |
| --- | --- | --- | --- |
| `expenses-guide.content.ts:96` | Configure substitute receipts | `company.setup.manage` held | Shared ADMIN name |
| `substitute-receipt-guide.content.ts:59` | Open settings | `company.setup.manage` held | Shared ADMIN name |
| `substitute-receipt-guide.content.ts:289` | Settings section title | `company.setup.manage` held | Shared ADMIN name |
| `substitute-receipt-guide.content.ts:338` | Prepare document/evidence | `expense.review` held | Shared ADMIN name |
| `substitute-receipt-guide.content.ts:341` | Change settings | `company.setup.manage` held | Shared ADMIN name |
| `reports-guide.content.ts:114` | Identify/investigate a report run | `report.snapshot.read`, `report.audit.read` held | Shared ADMIN name |

At follow-up 1 the following nine occurrences of “ผู้ดูแลระบบ” were left **as then instructed**.
Follow-up 2 below corrects the request-permission analysis and all nine sentences. Their existing advice is not endorsed as correct;
SYSTEM_ADMIN has no shop business right either. No replacement role or support rule was invented.
All paths are under `apps/web/src/features/user-guide/`.

| File and line | Existing words/context | Permission checked and why left |
| --- | --- | --- |
| `expenses-guide.content.ts:352` | ใช้ตารางนี้อ้างอิงเมื่อต้องแจ้งผู้ดูแลระบบขอเปิดสิทธิ์เพิ่ม | Grant additional rights: `access.role.manage` absent |
| `expenses-guide.content.ts:383` | บัญชีของคุณยังไม่มีสิทธิ์ใช้เมนูนั้น ให้ติดต่อผู้ดูแลระบบ โดยอ้างอิงตารางในหัวข้อ “สิทธิ์ที่ต้องมี” | Request additional menu access: `access.role.manage` absent |
| `substitute-receipt-guide.content.ts:329` | ใช้ตารางนี้อ้างอิงเมื่อต้องแจ้งผู้ดูแลระบบขอเปิดสิทธิ์เพิ่ม | Grant additional rights: `access.role.manage` absent |
| `reports-guide.content.ts:174` | ใช้ตารางนี้อ้างอิงเมื่อต้องแจ้งผู้ดูแลระบบขอเปิดสิทธิ์เพิ่ม | Grant additional rights: `access.role.manage` absent |
| `reports-guide.content.ts:201` | บัญชีของคุณไม่มีสิทธิ์เรียกดูรายงานนั้น หรือบริษัทยังไม่ได้เปิดใช้งานรายงานกลุ่มนั้น ให้ติดต่อผู้ดูแลระบบ โดยอ้างอิงตารางในหัวข้อ “สิทธิ์ที่ต้องมี” | Request missing report rights: `access.role.manage` absent. ADMIN's catalog/BI rights do not permit granting access; the alternative feature-disabled cause does not resolve that case |
| `reports-guide.content.ts:217` | บัญชีไม่มีสิทธิ์ส่งออกข้อมูล ให้ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ส่งออกข้อมูลรายงาน | Grant export rights: `access.role.manage` absent; `report.export` itself is held |
| `tax-guide.content.ts:97` | สำหรับให้ผู้ทำบัญชีหรือผู้ดูแลระบบตรวจเชิงลึก | Tax data/review/export: `tax.report.read`, `tax.review_issue.read`, `tax.report.export` absent |
| `tax-guide.content.ts:162` | ใช้ตารางนี้อ้างอิงเมื่อต้องแจ้งผู้ดูแลระบบขอเปิดสิทธิ์เพิ่ม | Grant additional rights: `access.role.manage` absent |
| `tax-guide.content.ts:210` | บัญชีไม่มีสิทธิ์ส่งออกรายงานภาษี ให้ติดต่อผู้ดูแลระบบ โดยอ้างอิงตารางในหัวข้อ “สิทธิ์ที่ต้องมี” | `tax.report.export` and `access.role.manage` absent |

### Source pins and every citing card

Procedure read: `docs/plans/manual-expense-web-entry-flag-plan-th.md` §4, “ไฟล์คู่มือ” row
(line 179), and the guide/pin/card-review evidence in
`docs/agent-memory/reimbursement-payout-round-wording.md` (lines 86, 151, 160).

| Source | Previous pinned SHA-256 | New SHA-256 |
| --- | --- | --- |
| expenses | `73f50c3324ed2051b4881206cd68b1beb2542b21fcd67875eb68f07d92d42982` | `3dae240bb591415f7898b577cf884c1ca79c0c29cc2bc320dac1f013ee0a98b0` |
| substitute-receipts | `a444dd458af1b3ec395175b720a08fd58e3de0ec913b46cb985d262565b1c705` | `49696a01fe4091098b0e149e7b8a54dedcad1b54396952da2cb267c36b0977c8` |
| reports | `8bf9239b344d299117b3e228ce9aec503809758458f14cec8c316b1143b40baa` | `dc763f507f0e77f4464ecabe0bb45ca1afc7efc0f8a902d5c48fc218ce2618ad` |

The `reimbursements` source line remains unchanged. Card and pack hashes are already derived by
`knowledgeCardHash` / `knowledgePackHash`; no second stored hash needs editing. **This lane now
changes `apps/ai-gateway` (three hashes), so deploy the assistant with the web.** Deployment,
browser behavior, the next review's card wording, and live assistant output are **not checked**:
no deployment, server, network or browser is allowed here.

All ten cards citing the three files were read in `approved-product-help.ts`. No body explicitly
names a standard role with a conflicting standard-role label. Generic occupations and
responsibilities are not silently assigned to a role key. Bodies remain byte-for-byte unchanged.

| Card id | Source | Body review |
| --- | --- | --- |
| `expense.start` | expenses | No standard role named |
| `expense.status` | expenses | No standard role named |
| `expense.find` | expenses | No standard role named |
| `expense.draft` | expenses | No standard role named |
| `expense.vat-display` | expenses | No standard role named |
| `expense.export` | expenses | “นักบัญชี” is an occupation/recipient, without a standard key. If the next review intends ACCOUNTANT, the list's name is “ฝ่ายบัญชี”; that intent is not checked/defined in the card |
| `substitute.meaning` | substitute-receipts | No standard role named |
| `substitute.evidence` | substitute-receipts | No standard role named |
| `substitute.review-sign` | substitute-receipts | “ผู้ลงนาม” and “ผู้อนุมัติ” name workflow responsibilities, without standard keys |
| `report.access` | reports | “ผู้ดูแล” has no defined standard key. If the next review intends ADMIN, the list's name is “ผู้ดูแลบริษัท”; if it means OWNER, “เจ้าของกิจการ”. ADMIN cannot grant permissions. No mapping inferred |

### Words changed in this follow-up

| Where | Old text | New text | When shown |
| --- | --- | --- | --- |
| Expense submenu table and substitute settings permission row | เจ้าของกิจการ, ผู้ดูแลระบบ | เจ้าของกิจการ, ผู้ดูแลบริษัท | Respective guide section opened, regardless of shortcut availability |
| Substitute settings entry instructions | ไปที่ ค่าใช้จ่ายและใบเสร็จ แล้วเลือก ตั้งค่าใบรับรองแทนใบเสร็จ เปิดได้เฉพาะเจ้าของกิจการและผู้ดูแลระบบ | ไปที่ ค่าใช้จ่ายและใบเสร็จ แล้วเลือก ตั้งค่าใบรับรองแทนใบเสร็จ เปิดได้เฉพาะเจ้าของกิจการและผู้ดูแลบริษัท | Overview section opened |
| Substitute settings section title | ตั้งค่า (สำหรับเจ้าของกิจการและผู้ดูแลระบบ) | ตั้งค่า (สำหรับเจ้าของกิจการและผู้ดูแลบริษัท) | Section heading, including collapsed state |
| Substitute preparation permission row | เจ้าของกิจการ, ผู้ดูแลระบบ, ผู้จัดการ, ฝ่ายบัญชีและฝ่ายการเงิน | เจ้าของกิจการ, ผู้ดูแลบริษัท, ผู้จัดการ, ฝ่ายบัญชีและฝ่ายการเงิน | Permissions section opened |
| Report-run identifier explanation | รหัสประจำการเรียกรายงานครั้งนั้น หากผลลัพธ์ผิดปกติ ให้แจ้งรหัสนี้กับผู้ดูแลระบบ เพื่อให้ตามหาได้ว่าเป็นการเรียกครั้งใด | รหัสประจำการเรียกรายงานครั้งนั้น หากผลลัพธ์ผิดปกติ ให้แจ้งรหัสนี้กับผู้ดูแลบริษัท เพื่อให้ตามหาได้ว่าเป็นการเรียกครั้งใด | Run section opened |

Pre-existing point noticed but not changed: the substitute settings instructions say
“เปิดได้เฉพาะ” OWNER/ADMIN even though the guide already gates its shortcut by
`company.setup.manage`, including a custom role holding that permission. This follow-up changes
standard names, as instructed; it does not redesign that existing exclusivity claim. The existing
shortcut spec still passes. The controller can decide the separate wording fix.

### Follow-up test evidence and next state

| Exact command | Red before production fix | Green after fix |
| --- | --- | --- |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/user-guide/user-guide.content.spec.ts` | rc 1; 13 pass, 3 fail, 0 skip. All three new tests fail: ADMIN expense settings; ADMIN substitute setup/preparation; ADMIN report-run investigation | rc 0; 16 pass, 0 fail, 0 skip. All three new tests pass |
| `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/agents/approved-knowledge.spec.ts` | rc 1; 8 pass, 1 fail, 0 skip. Existing exact-source test rejects old expenses pin (`73f50c…`), actual edited source `6a0f70…` before this follow-up's wording changes | rc 0; 9 pass, 0 fail, 0 skip. Node-loader form works; no spec edit or fallback |

Follow-up artifacts: three guide files, their existing spec, the three approved-help source hash
lines, `docs/specs/company-role-override-spec.md` R11 permission-backed guide/deployment rule,
and this note. No new e2e file or e2e assertion change in this follow-up. No API or contracts
production change, so no contracts rebuild is required here. Full suites/typechecks/browser/real
PostgreSQL are not repeated: focused wording/hash checks are sufficient for this follow-up;
the controller runs full integration verification. Reimbursement pending sentences remain for
the next lane after merge, with the old list preserved exactly.

Final follow-up checks: `git diff --check` rc 0, no whitespace errors. An inline `python3` stdlib
integrity check rc 0, eight assertions passed: three exact source pins; reimbursement pin
unchanged; complete card definitions/bodies unchanged against HEAD; frozen reimbursement
pending-sentence block unchanged; reimbursement guide has no diff; assistant diff consists of
exactly three changed lines. No sandbox refusal or loader error occurred. No follow-up e2e file
was changed. Typechecks, full suites and live deployment are not checked in this follow-up for
the reasons above; the initial typecheck results are historical evidence, not new runs.

## Controller follow-up 2: finish shop-guide permission help (2026-10-03)

### Actual acts and authorization

The previous interpretation of a general request for extra rights as `access.role.manage` was
too broad. These are distinct acts, checked in the existing code:

- **Give an employee a role:** PATCH employee checks `access.employee.update` at
  `employee.controller.ts:78`. `update-employee.use-case.ts:48–90` checks protected/self targets,
  exactly one role, HR's current-target boundary and `roleGrantViolation`. New employee assignment
  similarly uses `access.employee.create`. No production permission code changed here.
- **Set an individual's permissions:** the current page does not have that write operation.
  `IndividualPermissionsPrototypePage.tsx:704–721,765–790` shows rights derived from the role and
  a link to edit role permissions. `UpdateEmployeeInput`/DTO do not accept per-user permission
  keys. The existing role PATCH checks `access.role.manage` (`role.controller.ts:71`) and
  granter restrictions. `docs/specs/employee-single-role-spec.md` explicitly says no per-user
  permission editor. No separate individual-permission endpoint or permission was invented.
- **Hold an export/read right:** check the actual report/tax permission, not an assignment
  permission. `tax.controller.ts:211,282` checks tax review read/export;
  `report.use-cases.ts` checks export and the dataset's source permissions. A general report
  exporter must also hold access to that report's source data.
- **Open a company feature:** `evaluateEntitledFeatureKeys` reads stored company feature rows;
  missing/disabled features suppress employee permissions (`feature-gate.logic.ts`). Reports
  have company entitlement guards, source-permission status, and an UNAVAILABLE status when the
  source query adapter is absent. Changing an employee role cannot enable a company feature or
  make an absent adapter work. Package management uses `company.plan.manage` (default OWNER);
  operator feature changes use `system.partner_feature.manage` (`partner.controller.ts:505`).
  The guide sends an unopened-menu case to OWNER to check the package or contact the team, and
  does not assert that every unavailable menu means an unpurchased package. It follows the
  neighbouring error distinction “ยังไม่ได้เปิดฟีเจอร์นี้” versus temporary unavailability.

An actual node-loader diagnostic loaded `ROLE_GRANTS` and called `roleGrantViolation` for each
built-in company candidate role (raw grants; an ordinary employee other than the requester).
It exited 0 with these results:

| Default requester | Holds `access.employee.update` | Built-in roles grantable under the actual function |
| --- | --- | --- |
| OWNER / เจ้าของกิจการ | Yes | ADMIN, MANAGER, HR, SALES, INVENTORY, FINANCE, ACCOUNTANT, MARKETING, STAFF, AUDITOR_READONLY |
| ADMIN / ผู้ดูแลบริษัท | Yes | ADMIN, MARKETING, STAFF |
| MANAGER / ผู้จัดการ | Yes | MANAGER |
| HR / ฝ่ายบุคคล | Yes | MANAGER, SALES, INVENTORY, MARKETING, STAFF, only unchanged built-ins; cannot change an employee currently holding another or a custom role |

`HR_ASSIGNABLE_ROLE_KEYS` in contracts is exactly MANAGER/SALES/INVENTORY/MARKETING/STAFF.
Non-owner assignment requires a raw-permission subset except HR's explicit delegation.
FINANCE/ACCOUNTANT additionally require `access.role.financial.assign` (default OWNER only).
Protected OWNER/SYSTEM_ADMIN/COMPANY_VIEW and shop-ineligible platform roles remain unassignable.
Custom roles are checked against the same subset/owner-gated rules; company names do not widen
rights. OWNER is therefore the short, always valid named recipient for the guides' generic
additional-right requests. This does not claim other people-managers cannot perform limited
assignments. Extra role permissions use `access.role.manage`, held by default OWNER only.

| Held right(s) from `ROLE_GRANTS` | Default holders |
| --- | --- |
| `report.export` | OWNER, ADMIN, FINANCE, ACCOUNTANT, AUDITOR_READONLY; source permissions still required |
| `tax.report.export` | OWNER, FINANCE, ACCOUNTANT, AUDITOR_READONLY |
| `tax.report.read` + `tax.review_issue.read` + `tax.report.export` for the raw review export | OWNER, FINANCE, ACCOUNTANT, AUDITOR_READONLY; MANAGER reads/reviews but does not export |
| `company.setup.manage` | OWNER, ADMIN; a custom role holding the key is valid too |
| `company.plan.manage` | OWNER; a company may delegate through an owner-authorized custom role |

### Words and acts changed

Row numbers below are the controller's pre-follow-up coordinates. Names are read from the one
contracts list. The four identical summaries and the two menu answers share one text each in
`user-guide.model.ts`; the two tax paragraphs share one exporter name string in the tax guide.
No SYSTEM_ADMIN wording is allowed in these four guides; no exception list is needed.

| Row | Old sentence | New sentence | Act, permission and checked roles |
| --- | --- | --- | --- |
| Expenses:352, Substitute receipt:329, Reports:174, Tax:162 | ใช้ตารางนี้อ้างอิงเมื่อต้องแจ้งผู้ดูแลระบบขอเปิดสิทธิ์เพิ่ม | ใช้ตารางนี้บอกเจ้าของกิจการว่าต้องการสิทธิ์ใดเพิ่ม | Request employee access: `access.employee.update` + grant rule, or role rights via `access.role.manage`; OWNER always covers these guide rights; ADMIN/MANAGER/HR have limits |
| Expenses:383 | บัญชีของคุณยังไม่มีสิทธิ์ใช้เมนูนั้น ให้ติดต่อผู้ดูแลระบบ โดยอ้างอิงตารางในหัวข้อ “สิทธิ์ที่ต้องมี” | ถ้าเมนูเปิดใช้แล้วแต่คุณไม่มีสิทธิ์ ให้แจ้งเจ้าของกิจการตามตารางสิทธิ์ ถ้าเมนูยังไม่ได้เปิดใช้ ให้เจ้าของกิจการตรวจแพ็กเกจหรือติดต่อทีมงาน | Employee access versus company availability; OWNER for role assignment and package management; operator/team for feature availability |
| Reports:201 | บัญชีของคุณไม่มีสิทธิ์เรียกดูรายงานนั้น หรือบริษัทยังไม่ได้เปิดใช้งานรายงานกลุ่มนั้น ให้ติดต่อผู้ดูแลระบบ โดยอ้างอิงตารางในหัวข้อ “สิทธิ์ที่ต้องมี” | ถ้าเมนูเปิดใช้แล้วแต่คุณไม่มีสิทธิ์ ให้แจ้งเจ้าของกิจการตามตารางสิทธิ์ ถ้าเมนูยังไม่ได้เปิดใช้ ให้เจ้าของกิจการตรวจแพ็กเกจหรือติดต่อทีมงาน | Same distinction; report catalog/source permission, company entitlement and adapter availability are separate states |
| Reports:217 | บัญชีไม่มีสิทธิ์ส่งออกข้อมูล ให้ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ส่งออกข้อมูลรายงาน | ถ้าคุณไม่มีสิทธิ์ส่งออกข้อมูล ให้เจ้าของกิจการ หรือผู้ดูแลบริษัท หรือฝ่ายการเงิน หรือฝ่ายบัญชี หรือผู้ตรวจสอบ (ดูอย่างเดียว)ที่มีสิทธิ์ดูข้อมูลของรายงานนั้นส่งออกให้ | Ask a holder to export: `report.export` + source access; OWNER/ADMIN/FINANCE/ACCOUNTANT/AUDITOR_READONLY |
| Tax:97 | Export REVIEW_JSON เป็นไฟล์ข้อมูลดิบพร้อมผลการตรวจ สำหรับให้ผู้ทำบัญชีหรือผู้ดูแลระบบตรวจเชิงลึก ไม่เหมาะกับการเปิดอ่านทั่วไป · Export CSV และ Export XLSX สำหรับส่งสำนักงานบัญชี · Export PDF สำหรับพิมพ์เก็บเข้าแฟ้ม | Export REVIEW_JSON เป็นไฟล์ข้อมูลดิบพร้อมผลการตรวจ สำหรับให้เจ้าของกิจการ หรือฝ่ายการเงิน หรือฝ่ายบัญชี หรือผู้ตรวจสอบ (ดูอย่างเดียว)ตรวจเชิงลึก ไม่เหมาะกับการเปิดอ่านทั่วไป · Export CSV และ Export XLSX สำหรับส่งสำนักงานบัญชี · Export PDF สำหรับพิมพ์เก็บเข้าแฟ้ม | Hold tax export/read/review rights: OWNER/FINANCE/ACCOUNTANT/AUDITOR_READONLY |
| Tax:210 | บัญชีไม่มีสิทธิ์ส่งออกรายงานภาษี ให้ติดต่อผู้ดูแลระบบ โดยอ้างอิงตารางในหัวข้อ “สิทธิ์ที่ต้องมี” | ถ้าคุณไม่มีสิทธิ์ส่งออกรายงานภาษี ให้เจ้าของกิจการ หรือฝ่ายการเงิน หรือฝ่ายบัญชี หรือผู้ตรวจสอบ (ดูอย่างเดียว)ส่งออกให้ | Ask a tax exporter: `tax.report.export`; OWNER/FINANCE/ACCOUNTANT/AUDITOR_READONLY |
| Substitute receipt:59 | ไปที่ ค่าใช้จ่ายและใบเสร็จ แล้วเลือก ตั้งค่าใบรับรองแทนใบเสร็จ เปิดได้เฉพาะเจ้าของกิจการและผู้ดูแลบริษัท | ไปที่ ค่าใช้จ่ายและใบเสร็จ แล้วเลือก ตั้งค่าใบรับรองแทนใบเสร็จ เปิดได้เฉพาะผู้ที่มีสิทธิ์ตั้งค่าบริษัท เช่น เจ้าของกิจการและผู้ดูแลบริษัท | `company.setup.manage`; built-ins OWNER/ADMIN are examples; custom holders can open it |

### Pins and ten-card re-review

Only the three existing source hash lines move again. `reimbursements` and every card body stay
unchanged. The assistant still must be deployed with the web; no live deployment is attempted.

| Source | Follow-up 1 pin | Follow-up 2 pin |
| --- | --- | --- |
| expenses | `3dae240bb591415f7898b577cf884c1ca79c0c29cc2bc320dac1f013ee0a98b0` | `f3c0df5ef8679e1281d4333e21277187f373fbdd477081f7eb4f374045717fd5` |
| substitute-receipts | `49696a01fe4091098b0e149e7b8a54dedcad1b54396952da2cb267c36b0977c8` | `54b29bc6bd4c7bbacf0de8e1278ed8b4065da95f739e1f8a0cdd7df36f9e3ce6` |
| reports | `dc763f507f0e77f4464ecabe0bb45ca1afc7efc0f8a902d5c48fc218ce2618ad` | `1fad122c4ef5fb475b02cd07e12513e0d6a90c2b97fc3760739094f530dd17fc` |

| Card id | Citation | Re-review against this follow-up |
| --- | --- | --- |
| expense.start | expenses#overview | Capturing a draft, not rights guidance; body facts unaffected |
| expense.status | expenses#overview | Document/payment distinction unchanged |
| expense.find | expenses#list | Search/filter guidance unchanged |
| expense.draft | expenses#overview | Draft/confirmation distinction unchanged |
| expense.vat-display | expenses#list | VAT found in documents distinction unchanged |
| expense.export | expenses#overview | Export according to held rights remains correct; “นักบัญชี” remains a generic recipient for the next pack review |
| substitute.meaning | substitute-receipts#overview | Receipt-substitute definition unchanged; changed settings-entry instructions no longer exclude custom permission holders; body has no exclusive-role claim |
| substitute.evidence | substitute-receipts#evidence | Evidence distinction unchanged |
| substitute.review-sign | substitute-receipts#sign | Signature steps/permission requirement unchanged |
| report.access | reports#overview | Held report/source rights and export check unchanged; generic “ผู้ดูแล” remains unkeyed for the next pack review, as accepted in follow-up 1 |

### Verification and remaining boundaries

- `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/user-guide/user-guide.content.spec.ts`: red rc 1, 15 pass/5 fail/0 skip (twice, the second after extending the existing sentence collector to titles, eyebrows and link labels). Four new guide tests reject SYSTEM_ADMIN and check the actual request/menu/export advice; the changed substitute-settings test rejects the old exclusive-role claim. Green rc 0, 20 pass/0 fail/0 skip.
- `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/agents/approved-knowledge.spec.ts`: red rc 1, 8 pass/1 fail/0 skip, old expenses pin `3dae24…` versus edited source `f3c0df…`; green rc 0, 9 pass/0 fail/0 skip after moving all three pins.
- Diagnostic command `pnpm --filter @watchdog-bms/api exec node --import tsx -` with the inline `ROLE_GRANTS`/`roleGrantViolation` inspection above: rc 0. This was a read-only code inspection, not an API test or a PostgreSQL run.
- No API/contracts production edit, new dependency, new API spec, package manifest edit, schema/migration, e2e edit or server/network/browser command. Existing English button/format names in tax prose are unchanged; translating those is outside this role-name lane.
- Typechecks/full suites/browser/live behavior are **not checked in follow-up 2**: focused wording/hash checks suffice here; the controller owns full integration and live checks.
- Existing discrepancy noticed but not changed: role-picker spec R1 says assigning people-manager roles additionally requires `access.role.manage`, but the actual shared `roleGrantViolation` and update employee path allow ADMIN to assign the built-in ADMIN through the raw-subset rule. The read-only diagnostic confirms this. The guide uses OWNER for generic requests, so it does not depend on resolving that separate rule discrepancy.

## Open points: reimbursement guide — additional pending sentences — CLOSED 2026-10-03, see the next section

The original pending-sentence block above remains byte-for-byte unchanged. These five additional
occurrences belong to the next lane; `reimbursement-guide.content.ts` itself and its pin are
untouched. Reuse the shared request/menu wording where it fits the row's real state.

| File and line | Old words/sentence | Needed words/next-lane direction |
| --- | --- | --- |
| `apps/web/src/features/user-guide/reimbursement-guide.content.ts:86` | แสดงว่าบัญชีของคุณยังไม่มีสิทธิ์ใช้งาน ให้แจ้งผู้ดูแลระบบ โดยบอกสิ่งที่ต้องการทำตามตารางในหัวข้อสิทธิ์ที่ต้องมี | Replace ผู้ดูแลระบบ with เจ้าของกิจการ for the employee-right request; keep package/unavailable causes separate if this section covers them |
| `apps/web/src/features/user-guide/reimbursement-guide.content.ts:111` | แท็บและปุ่มที่คุณไม่มีสิทธิ์ใช้จะไม่แสดงตั้งแต่แรก ผู้เบิก ผู้อนุมัติ และฝ่ายการเงินจึงเห็นงานไม่เหมือนกัน แม้เปิดลิงก์ของหน้านั้นโดยตรง ระบบก็ไม่ให้เข้า ถ้าไม่พบแท็บหรือปุ่มที่ต้องใช้ ให้แจ้งผู้ดูแลระบบตรวจสิทธิ์ของคุณ ไม่ต้องสร้างคำขอใหม่ เพราะคำขอใหม่ไม่ได้ทำให้เห็นแท็บเพิ่ม | ผู้ดูแลระบบ → เจ้าของกิจการ; retain the workflow/rights facts |
| `apps/web/src/features/user-guide/reimbursement-guide.content.ts:962` | ใช้ตารางนี้อ้างอิงเมื่อต้องแจ้งผู้ดูแลระบบขอเปิดสิทธิ์เพิ่ม | ใช้ตารางนี้บอกเจ้าของกิจการว่าต้องการสิทธิ์ใดเพิ่ม; reuse GUIDE_PERMISSION_REQUEST |
| `apps/web/src/features/user-guide/reimbursement-guide.content.ts:999` | แจ้งผู้ดูแลระบบว่าต้องการทำสิ่งใด โดยอ้างข้อในคอลัมน์กลางของตารางนี้ ผู้ดูแลจะเลือกข้อนั้นให้บทบาทของคุณที่เมนูพนักงานและสิทธิ์ | Name เจ้าของกิจการ; describe assigning a permitted role or editing its rights, without implying a per-user permission editor; role edits affect everyone sharing it |
| `apps/web/src/features/user-guide/reimbursement-guide.content.ts:1099` | ข้อความคือ “บัญชีนี้ยังไม่มีสิทธิ์ใช้งานหน้าการเบิกจ่าย” ให้ติดต่อผู้ดูแลระบบ โดยอ้างตารางในหัวข้อสิทธิ์ที่ต้องมี | ผู้ดูแลระบบ → เจ้าของกิจการ; retain the exact existing screen quote |

Final follow-up 2 checks: `git diff --check` rc 0, no whitespace errors; inline `python3`
integrity inspection rc 0, eight checks passed (three current source pins, reimbursement pin,
card definitions/bodies, original pending-sentence block, reimbursement guide, and exactly
three assistant hash-line changes). A production-source search over all `*guide.content.ts`
files finds “ผู้ดูแลระบบ” only in the untouched reimbursement guide, at the five pending rows
listed above. Node-loader commands worked; no sandbox refusal. No browser, real PostgreSQL,
full suite, typecheck, or live deployment was run in this follow-up.

## Reimbursement guide closed (2026-10-03, branch `claude/batch-a-roles-notices-20261003`)

Both pending lists above are closed in `apps/web/src/features/user-guide/reimbursement-guide.content.ts`.
Names are read from `THAI_SYSTEM_ROLE_NAMES`; the permissions summary reuses `GUIDE_PERMISSION_REQUEST`.
Already-correct literal names in untouched sentences stay as written (several “ฝ่ายการเงิน” there mean
the people of the finance-review step, which includes ฝ่ายบัญชี, not the FINANCE key alone). An
old/new render of every guide sentence: 686 sentences, exactly 17 changed (rows below), all other
sentences and every “ ” screen quote byte-identical.

Rule used for the five requests: each sends the reader to someone to get a right from the claim
table. Giving it means changing the employee's one role (`access.employee.update` +
`roleGrantViolation`: OWNER may assign every assignable role; ADMIN/MANAGER only roles inside their
own permissions; HR only MANAGER/SALES/INVENTORY/MARKETING/STAFF on a holder of one of those;
FINANCE/ACCOUNTANT also need `access.role.financial.assign`, OWNER only) or adding the item to the
role (`access.role.manage`, OWNER only; editing a standard role forks it and moves every holder in
the company, so it affects everyone in that role). Only OWNER can do it for every row, so OWNER is
named alone, as in the other guides. No per-user permission editor exists or is implied.

| Line (by text) | Old | New | Act → permission checked → standard roles |
| --- | --- | --- | --- |
| quick-start note “หากไม่พบเมนูการเบิกจ่าย” | แสดงว่าบัญชีของคุณยังไม่มีสิทธิ์ใช้งาน ให้แจ้งผู้ดูแลระบบ โดยบอกสิ่งที่ต้องการทำตามตารางในหัวข้อสิทธิ์ที่ต้องมี | แสดงว่าบัญชีของคุณยังไม่มีสิทธิ์ใช้งาน ให้แจ้งเจ้าของกิจการ โดยบอกสิ่งที่ต้องการทำตามตารางในหัวข้อสิทธิ์ที่ต้องมี | Give claim rights (rule above) → OWNER. A company with claims off also goes to OWNER (`company.plan.manage`); table row 1 already says rights come when the company turns claims on |
| tabs note “คุณจะเห็นเฉพาะงานที่เป็นหน้าที่ของคุณ” | …ถ้าไม่พบแท็บหรือปุ่มที่ต้องใช้ ให้แจ้งผู้ดูแลระบบตรวจสิทธิ์ของคุณ… | …ถ้าไม่พบแท็บหรือปุ่มที่ต้องใช้ ให้แจ้งเจ้าของกิจการตรวจสิทธิ์ของคุณ… | Check and give the missing right: read `access.employee.read`; give per rule above → OWNER |
| permissions summary | ใช้ตารางนี้อ้างอิงเมื่อต้องแจ้งผู้ดูแลระบบขอเปิดสิทธิ์เพิ่ม | ใช้ตารางนี้บอกเจ้าของกิจการว่าต้องการสิทธิ์ใดเพิ่ม (`GUIDE_PERMISSION_REQUEST`) | Give any right in the table → OWNER |
| permissions note “วิธีขอสิทธิ์เพิ่ม” | แจ้งผู้ดูแลระบบว่าต้องการทำสิ่งใด โดยอ้างข้อในคอลัมน์กลางของตารางนี้ ผู้ดูแลจะเลือกข้อนั้นให้บทบาทของคุณที่เมนูพนักงานและสิทธิ์ | แจ้งเจ้าของกิจการว่าต้องการทำสิ่งใด โดยอ้างข้อในคอลัมน์กลางของตารางนี้ เจ้าของกิจการให้สิทธิ์ได้ที่เมนูพนักงานและสิทธิ์ โดยเปลี่ยนบทบาทของคุณเป็นบทบาทที่มีข้อนั้น หรือเลือกข้อนั้นให้บทบาทของคุณ ซึ่งมีผลกับทุกคนในบทบาทเดียวกัน | Assign a role holding the item (`access.employee.update` + `roleGrantViolation`) or add it to the role (`access.role.manage`) → OWNER |
| FAQ “เปิดหน้าการเบิกจ่ายแล้วระบบแจ้งว่าไม่มีสิทธิ์” | ข้อความคือ “บัญชีนี้ยังไม่มีสิทธิ์ใช้งานหน้าการเบิกจ่าย” ให้ติดต่อผู้ดูแลระบบ โดยอ้างตารางในหัวข้อสิทธิ์ที่ต้องมี | ข้อความคือ “บัญชีนี้ยังไม่มีสิทธิ์ใช้งานหน้าการเบิกจ่าย” ให้ติดต่อเจ้าของกิจการ โดยอ้างตารางในหัวข้อสิทธิ์ที่ต้องมี | Same as the menu note → OWNER; screen quote kept |
| tabs table, ตั้งค่านโยบาย | เจ้าของกิจการ และแอดมิน | เจ้าของกิจการ และผู้ดูแลบริษัท | Hold `reimbursement.policy.manage` → OWNER, ADMIN |
| payout item “ใครตั้งบัญชีประจำให้คุณได้อีก” | เจ้าของกิจการและแอดมินตั้งให้… | เจ้าของกิจการและผู้ดูแลบริษัทตั้งให้… (rest unchanged) | `access.employee.update` + system OWNER/ADMIN for everyone; MANAGER/HR branch-scoped (`payoutAccountEditRefusal`) |
| approve note “อนุมัติคำขอของตัวเอง”; policy row “ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้”; FAQ “อนุมัติคำขอของตัวเองไม่ได้” | เจ้าของกิจการ แอดมิน และผู้จัดการ… | เจ้าของกิจการ ผู้ดูแลบริษัท และผู้จัดการ… (rest unchanged) | Self-approval without the switch: `SELF_APPROVAL_EXEMPT_ROLES` → OWNER, ADMIN, MANAGER |
| permissions table, อนุมัติการเบิก | เจ้าของกิจการ แอดมิน ผู้จัดการ | เจ้าของกิจการ ผู้ดูแลบริษัท ผู้จัดการ | `reimbursement.approve` → OWNER, ADMIN, MANAGER |
| permissions table, ตรวจสอบการเบิก | เจ้าของกิจการ บัญชี | เจ้าของกิจการ ฝ่ายบัญชี | `reimbursement.finance_review` without payment → ACCOUNTANT (OWNER holds all) |
| permissions table, ตรวจ/จ่ายการเบิก | เจ้าของกิจการ การเงิน | เจ้าของกิจการ ฝ่ายการเงิน | `finance_review` + `payment.record/void` + `duplicate.resolve` → OWNER, FINANCE |
| permissions table, ตั้งนโยบายการเบิก | เจ้าของกิจการ แอดมิน | เจ้าของกิจการ ผู้ดูแลบริษัท | `reimbursement.policy.manage` → OWNER, ADMIN |
| permissions table, สิทธิ์แก้ไขข้อมูลพนักงาน | เจ้าของกิจการ แอดมิน และผู้จัดการกับฝ่ายบุคคลในสาขาที่ตนดูแล | เจ้าของกิจการ ผู้ดูแลบริษัท และผู้จัดการกับฝ่ายบุคคลในสาขาที่ตนดูแล | `access.employee.update` → OWNER, ADMIN, MANAGER, HR |
| permissions item “บทบาทที่อนุมัติได้ บันทึกจ่ายและยกเลิกการจ่ายได้ด้วย” | เจ้าของกิจการ แอดมิน และผู้จัดการ ทำได้อยู่แล้ว… | เจ้าของกิจการ ผู้ดูแลบริษัท และผู้จัดการ ทำได้อยู่แล้ว… | `approve` + `payment.record/void` → OWNER, ADMIN, MANAGER |
| notify row “คำขอถูกระงับการจ่ายที่ขั้นตรวจการเงิน” (other reviewers) | …และเจ้าของไม่ได้เป็นคนที่ระงับหรือผู้เบิก | …และเจ้าของกิจการไม่ได้เป็นคนที่ระงับหรือผู้เบิก | Not in either list: a bare “เจ้าของ” for OWNER, one name per thing |

Pin: `reimbursements` in `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts`
`57b21660eee36ef639fb071bdf7ab3da1a606c12ba3cad6cf755ce5dfccab30f` →
`8bee70d8c61b19aa39091a0b0427314a9bb01035919c645c92fd6accd77362ca`; no other assistant line changed.
Deploy the assistant with the web. Card bodies unchanged:

- `reimbursement.meaning` (quick-start): still true. It names no role or rights step; the quick-start
  facts it rests on (the purpose, คำขอเบิก vs ใบเบิกค่าใช้จ่าย, a draft or print is not approval or
  payment) are unchanged.
- `reimbursement.roles` (tabs): still true. Tabs follow role and rights; requester, approver and
  finance see different work; a new claim does not fix access. “ให้ผู้ดูแลตรวจสิทธิ์ของคุณก่อน” uses the
  generic, unkeyed “ผู้ดูแล” (same as `report.access`), not the platform role; checking an employee's
  rights is something the owner (and the company admin, `access.employee.read`/`access.effective.read`)
  can do, and it says “first”, not who grants. The guide it cites now names เจ้าของกิจการ; the next
  pack review may align the card's word to it.

Verification (node loader; one commit, not pushed):

- `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec src/features/user-guide/user-guide.content.spec.ts`:
  red rc 1, 21 pass / 2 fail / 0 skip of 23 (the two new tests fail on “แอดมิน” in the approve row
  and on “ผู้ดูแลระบบ” in the missing-menu note); green rc 0, 23 / 0 / 0.
- `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/agents/approved-knowledge.spec.ts`:
  red rc 1, 8 / 1 / 0 (pin `57b2…` vs file `8bee…`); green rc 0, 9 / 0 / 0.
- Under `/tmp/mangmee-heavy.lock` (taken 06:50:53, released 06:51:39), no `S3_*` variables:
  `pnpm --filter @watchdog-bms/web exec node --import tsx --test 'src/**/*.spec.ts'` rc 0, 2677 tests
  in 552 suites, 2677 pass / 0 fail / 0 cancelled / 0 skipped; `pnpm --filter @watchdog-bms/web typecheck` rc 0.
- `git diff --check` rc 0. No e2e or other spec asserts the old guide words. Browser, PostgreSQL and
  live assistant output not checked.

Noticed, not changed (meaning outside this lane, for the owner): ADMIN also holds
`reimbursement.policy.manage` and the policy write checks nothing more, yet the tabs note says
“งานตรวจการเงินมีต่อเมื่อเจ้าของกิจการเปิด “ตรวจการเงินก่อนจ่าย””, the finance section summary says
“มีเมื่อเจ้าของกิจการเปิด “ตรวจการเงินก่อนจ่าย” เท่านั้น”, the approve note says “บทบาทอื่นทำได้เมื่อ
เจ้าของกิจการเปิด “ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้””, and the policy section is titled
“(สำหรับเจ้าของกิจการ)” while the tabs table names both. The substitute-receipt guide still has two bare
“เจ้าของ” back-references (settings note and the default signing mode row).
