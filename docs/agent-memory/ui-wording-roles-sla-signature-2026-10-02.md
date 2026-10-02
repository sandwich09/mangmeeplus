# Agent Memory: role page layout and wording, "SLA", saved-signature name (2026-10-02)

Status: done on `claude/ui-wording-roles-dashboard-20261002` (worktree `/private/tmp/mangmee-ui-wording-20261002`, from `origin/develop` 603f461dd). Not pushed, no PR. Nothing deployed.
Owner: wording lane (web, API strings, two browser tests, one spec table). No `package.json`, no migration, no feature switch. Nothing under the claim screens, their API module, their notice templates or `packages/contracts/src/reimbursements.ts`.
Scope: three defects the owner approved on 2026-10-02 ("แก้ตามแนะนำได้เลย"), outside the claim screens. Standard: what a shop employee reads on a phone is plain Thai and true.

## 1. Role page (menu พนักงานและสิทธิ์)

Live routes: `/settings/permissions` (`PermissionMatrixPrototypePage` + `RoleBuilder`), `/settings/access-overview`, `/settings/employees`. `EmployeeAccessWorkspacePage` (EmployeesView, RolesView, MatrixView) is not routed. `/settings/permissions` needs `access.role.manage`, so a read-only viewer never opens it.

- Layout: the rights of a role were a table with an 820 px minimum inside a sideways scroller. Below `sm` they are one stacked row per menu, grouped like the per-employee summary; from `sm` up the table fits. No sideways scroller is left at 390, 768 or 1280 px.
- Role names: each page keeps the Thai names it already printed. Two lists exist and were NOT unified: the dictionary's `role.*` (role page, sidebar footer) and `THAI_SYSTEM_ROLE_NAMES` in `role-picker.logic.ts` (employee pages, company switcher). `COMPANY_VIEW` is "เจ้าของบริษัท" on both (the label recorded in `docs/qa/tennis-shop-e2e-test-cases-2026-07-29.md`).
- A standard role is stored as "Accountant". Editing one gives the company its own copy with that name. Rule now, on every page of the menu: a copy still carrying the stored English name reads as the standard role; a copy the company named reads by that name. The editor opens with the name shown, so a new copy stores the Thai name.
- Role descriptions: Thai at the source (`SYSTEM_ROLES`), synced into the system rows at release. Copies made before keep the English text they stored; `toRoleSummary` reads such a copy as the standard description of today (`FORMER_STANDARD_DESCRIPTIONS`, marked `ponytail:`).
- Choices and example roles (`capability-pack.registry.ts`, `role-template.registry.ts`): "audit", "dead letter", "webhook", "AR/AP", "CRM" and the loan words no other screen uses are gone. `workflow_automation` is on for every shop from onboarding, so a shop role can hold the dead-letter and webhook rights: they are said by what they do. Kept: LINE, QR, AI, PDF, VAT.
- "Draft" on the employee list is "แบบร่าง". The editor no longer prints "สิทธิ์เดิมที่ตั้งไว้" once per kept right.

## 2. "SLA"

Late is "เกินกำหนด". Changed: dashboard card "รอตอบเกินกำหนด" (web dictionary + the API's copy of the label), the notice "ลูกค้ารอตอบเกินกำหนด: <ลูกค้า>", LINE OA settings "กำหนดเวลาตอบลูกค้า", inbox tile "กำหนดตอบ", automation trigger "ตรวจงานที่เกินกำหนด", the unrouted module mock.
Left: report name "Workflow SLA" (report catalogue and its guide row are English throughout), the two claim-notice templates in `workflow-template-catalog.ts` (the claim lane's), identifiers and comments. No platform-admin screen prints the word.

## 3. Saved signature

`signature-asset.use-case.ts` makes the default name once, at creation, and stores it: `<ชื่อ> <วันที่>`. The date is now `formatThaiExportDate` ("2 ต.ค. 2569"). Stored names are not touched.

## 4. "เกิน 30 นาที" (second round, a finding of the pass above)

The inbox (chip, button) and the CRM report (a card and the pill under the average reply time) named 30 minutes. The time a shop allows is its own setting, "กำหนดเวลาตอบลูกค้า": 1 to 1440 minutes, counted inside business hours when that box is ticked (no saved setting = 30 minutes inside 09:00-18:00). Only `crm.inbox.policy_manage` reads it, so neither page holds the number.

- The figure is right and was not touched. A chat is given its deadline once, when it starts or restarts (`resolveConversation` -> `computeFirstResponseDueAt`, from the setting of that moment), and every count compares that stored time with now (`overdueWhere` in `prisma-crm-inbox.repository.ts`: inbox chip, CRM report card, the scan behind the dashboard card and the notice). Nothing counts with a fixed 30. On a local stack, changing the setting to 1 and to 1440 minutes left the late count as it was: the setting reaches new chats only, as its page says.
- Texts now, with no number: chip "⏱ รอตอบเกินกำหนด", button "ดู N แชทด่วนที่รอตอบเกินกำหนด", report card "ลูกค้ารอตอบเกินกำหนด", pill "ไม่ควรเกินกำหนดเวลาตอบ" (with "ลูกค้า" the pill wrapped at 1280 px, by 2 px). The English side of the same four keys carries no number either. The live inbox words its chip and button itself (`inbox-prototype.model.ts`, `InboxPrototypePage.tsx`); the dictionary keys serve the unrouted `InboxPage.tsx`.
- Also reworded, though no route shows them: two lines of the module mock and one sample summary in `mangmee-crm-data.ts`.
- Left: comments in the API and contracts that still call the chip "เกิน 30 นาที"; the mock's "รออนุมัติ ... เกิน 30 นาที" (approvals, not replies); the unused `CRM_OVERDUE_MIN = 30`.
- Noticed, not changed (figures and colours, not wording): the average reply time counts clock time from the start of a chat, closed hours included, while the deadline counts business hours, so the two are not the same measure for a chat that arrives after closing; the countdown on a chat turns amber at 15 minutes left whatever the setting; a chat counts as late only while it waits for its FIRST reply.

Decisions: recorded above. No role-name unification, no hiding of `SYSTEM_ADMIN` / `COMPANY_VIEW` from a shop's role list (the API lists them; only the sales roles are platform-only).
Open questions (owner):
- One Thai name per standard role across the app? Today: role page "บัญชี / แอดมิน / เจ้าของร้าน", employee pages "ฝ่ายบัญชี / ผู้ดูแลบริษัท / เจ้าของกิจการ", claim policy "บัญชี / แอดมิน / เจ้าของกิจการ".
- Should a shop be listed "ผู้ดูแลระบบ" and "เจ้าของบริษัท" at all? Both are roles it can neither edit nor give.
- Six example roles are never offered: the builder drops an example that names the automatic claim choice (`pack.reimbursement.self`).
- English left on other pages: reports (names, columns), automation page ("Trigger:", "Source:", template names), add-employee wizard ("Username", "DDMMYYYY", "Draft"), dashboard stock card ("Reorder Point", a machine timestamp), a saved report view's default name (ISO date).
Artifacts: commits 9df57ddfd (layout), 792fe1bee (role names, editor, Draft), 4a9ef1b65 + 1dcaa96e8 + 2e317e6e4 (role descriptions), e75e953e0 (choices and example roles), 4dd7a0a67 (SLA), daeaf9419 (signature name), and the commits of this file. Screens, page text and measurements at 390 / 768 / 1280 px: session scratchpad `uiword/shots/` (`before-*` and `final*`), notes `uiword/NOTES.md`.
Verification (2026-10-02, branch head): web `typecheck` rc 0; whole web suite 2602 of 2602; API `typecheck` rc 0; the touched API specs 183 of 183 and the 98 registered specs around them 1751 of 1751; `git diff --check` clean. Browser, on a freshly seeded local stack: `e2e/responsive.spec.ts` (mobile, the new role-page test and the invariants of the touched pages) 12 of 12, `e2e/settings.spec.ts` SET-04/04A/05/08/09 5 of 5, `e2e/daily-brief.spec.ts` 1 of 1. Each new or changed test was run against the old source and failed there. Run the web suite without a local stack's `S3_*` variables in the shell: `proxy.spec.ts` reads them. Not run: the full API script, contracts tests (untouched), the LINE-AI whole-chain acceptance (no file its manifest hashes changed).
Next: owner review, then PR to `develop`. Release runs `sync-permissions`, which writes the Thai descriptions into the system role rows.
