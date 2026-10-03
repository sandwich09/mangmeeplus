# Agent Memory: English left on signed-in pages

Status: implementation complete; browser verification remains with the controller
Owner: lane 3b
Scope: Report catalogue, report column labels and CSV headings, assistant-facing report source labels, report view defaults/values, workflow automation text, notification rule text, add-employee wizard, dashboard stock card. No package.json, migration, Prisma schema, `apps/api/src/modules/line-ai`, `apps/ai-gateway`, or pinned user-guide content changes.
Decisions: Reuse the Thai report catalogue for API source-reference labels; CSV headings reuse report result column definitions. Map rule names to trigger-based Thai labels and map system workflow template copy from the template catalogue, including stale stored template summaries. Preserve company-entered saved-view/rule/template names and custom text. Keep the English dictionary block unchanged. Format system dates/times/numbers with the shared Thai helpers/locale. Use native time controls for quiet-hours inputs so the page does not print API-format time examples. Remove report IDs/source keys from the workspace and replace workflow rule-test JSON output with a Thai, side-effect-accurate summary.
Open questions: (1) `docs/specs/employee-access-role-management-spec.md` says DOB-derived passwords do not force a first-login change, while `create-employee.use-case.ts` sets `mustChangePassword: true` and the wizard says the employee must change it; which rule controls? [Closed 2026-10-03 by batch A item 5: the code controls; the spec was corrected.] (2) Should old system-seeded workflow rule names be displayed from the Thai template catalogue, or should every stored name remain untouched because it may be company-custom? [Closed 2026-10-03 by batch A item 3: the release sync renames rules still carrying a former default; other names stay.] (3) Report rows can still contain generated metric keys, severity/freshness enums, and source IDs; should these become Thai display values, remain as business/export values, or be omitted? The Reports workspace localizes the `periodKey` display, while CSV still carries its source value. (4) Should raw condition/action/sample JSON and webhook event-key/endpoint fields remain available in the explicitly technical workflow editor, or should shop users get a Thai form? (5) The pinned report guide still contains English report names and column labels; it was intentionally not changed under the lane restriction. [Closed 2026-10-03 by batch A item 1, below.] The birth-date field continues to show its editable day/month/year form after input; no input-format behavior was changed.
Artifacts: `apps/api/src/modules/reports/domain/report-catalog.ts`, `apps/api/src/modules/reports/application/report-source-adapters.ts`, report UI logic/page/spec; workflow catalogue/mapper/explanations and page/spec; notification model/use cases/page/logic/spec; employee wizard/dictionary/spec; dashboard stock provider/page/logic/spec; E2E selector updates in `e2e/reports.spec.ts` and `e2e/_reference.spec.ts`, plus `e2e/TEST-CASES.md`; four corresponding specs; this note.
Verification: Red then green: report API labels (old code 15 pass/1 fail; final 16/16), workflow API text (old code 26 pass/1 fail; final 29/29), notification API names (10/1; 11/11), stock reorder label (6/1; 7/7), employee wording including removal of “OA” (10/1; 11/11), dashboard metric/channel formatting (4/1; 6/6), notification page wording (3/1; 4/4); added quiet-hours control check (4/1; 5/5), report view/value/enum text (old period value 11/1 and ungrouped numeric string 11/1; final 12/12), workflow page text (old label fallback failed; 13/13). The assistant-facing report source label regression was separately red at 15/1 on `General Ledger ${periodKey}` and green at 16/16. API typecheck passed (exit 0); web typecheck passed after final UI changes (exit 0); `git diff --check` passed (exit 0). Browser/E2E and real-PostgreSQL specs were not run because this lane forbids browsers and has no database.
Next: Controller runs the changed report E2E selectors in a browser, the real-PostgreSQL specs, and reviews the listed product questions and narrow-layout risks. No package script or dependency changes were made.

## Batch A follow-up (2026-10-03, branch `claude/batch-a-roles-notices-20261003`)

Controller brief: finish this sweep. One commit per item; the guide/pin detail is also in
`docs/agent-memory/standard-role-names-one-list-2026-10-02.md` (last section).

### Item 1: the reports guide (open question 5)

The guide's catalogue table names the 18 reports by their catalogue titles, its example headings are the
adapter's column labels, “Period” became “งวด” or the date range, and the run-id row went with the card
lane 3b removed. A web test reads `report-catalog.ts`, `report-source-adapters.ts` and the page's result
cards from disk so the copies cannot drift, and rejects English letters except the kept names. Pin
`reports` → `2b48f07e…`; card `report.access` still true. Guide spec red 26 / 4 → green 30 / 0;
approved-knowledge red 8 / 1 → green 9 / 0.

Noticed, unchanged (pre-existing, not caused by lane 3b): the guide says the run history reopens a past
result without running it again, but runs keep no rows and the history items are not clickable; the
freshness row says results may come from data kept from an earlier run, but every run computes afresh and
only ภาพรวมการทำงาน can be stale (its dashboard snapshot). Some “ใช้ดูอะไร” descriptions are loose
(บัญชีแยกประเภท “ทุกบรรทัด” while rows are per account; สถานะเงินสด “เงินสดและเงินฝาก” while rows are bank
reconciliation per account; ภาพรวมการทำงาน “สุขภาพการทำงานของระบบ” while rows are dashboard business
signals). Catalogue descriptions: อายุหนี้ลูกหนี้การค้า says “แยกตามช่วงเวลาค้างชำระ” but its rows are
invoices with due dates (only the payable report has buckets); งบกำไรขาดทุน mentions กำไรสุทธิ, which is in
`totals` and not shown on the page.

### Item 4: two automation-page wordings

- Template dialog, cooldown field: “พักการแจ้งเตือน (วินาที)” → “เว้นระยะก่อนทำงานซ้ำ (วินาที)”. Fact:
  `WorkflowRunnerUseCase` returns SKIPPED (`isRuleInCooldown`) before any action when the rule ran fewer than
  N seconds ago (N ≤ 0 means no wait), so tasks and notices are held back alike. The notification-rules
  page's “พักการแจ้งเตือน … นาที” is right for notices and is kept.
- Connections tab warning: “การเชื่อมต่อระบบภายนอกปิดไว้เสมอ ต้องเปิดใช้งานเอง…” → “การเชื่อมต่อระบบภายนอกที่เพิ่มใหม่จะ
  ปิดใช้งานไว้ก่อนเสมอ ต้องกดเปิดใช้งานเองหลังตรวจสอบที่อยู่เว็บไซต์และรายการเหตุการณ์ที่อนุญาตแล้ว”. Fact:
  `createWebhookEndpoint` always stores DISABLED; only the enable action (which needs at least one event)
  switches it on. The words are the form's own field names and the badge's ปิดใช้งาน.
- Spec: `docs/specs/workflow-automation-spec.md` UI rules. Test: `workflow.logic.spec.ts` (page source), red
  13 / 2 → green 15 / 0.

### Item 5: the birthdate password spec (open question 1)

The code wins, as the controller decided. `create-employee.use-case.ts` creates the credential with
`mustChangePassword: true` and `expiresAt: null` (both the new-user and the resumed-draft paths), and has
since the 2026-08-07 import; the wizard says “ระบบจะให้พนักงานตั้งรหัสผ่านใหม่เมื่อเข้าใช้งานครั้งแรก”. The
spec's §13 said the change was not forced, reasoned the no-expiry rule from that, and dropped “requires
change” from the acceptance criterion. All three lines now state the code: forced change at the first
password sign-in, no 72-hour expiry, criterion keeps “stored only as a hash” and “requires change”; an
employee added from an existing account keeps their password. Docs only; no test (no behaviour changed).

### Item 3: rule names from old template defaults (open question 2)

- How names work: a rule copies its template's name at creation (auto-enable: the template row's name; the
  enable dialog: pre-filled with it, editable) and keeps it. The update API accepts `name`, but the web has
  no rename control after creation. The release sync (`prisma/sync-workflow-templates.ts`, run in every
  release task) upserts template rows from the catalogue (so template names are Thai since lane 3b) and
  re-pins the content of rules it created, explicitly never the name.
- Telling a default from a chosen name: git history of `workflow-template-catalog.ts` (31 commits since the
  2026-08-07 import) shows each template shipped exactly one English name before its Thai one (one template
  was born Thai). A rule whose name is exactly that English name was never named by its company.
- Change: `WORKFLOW_TEMPLATE_FORMER_NAMES` (catalogue, 25 entries, checked equal to the history) and
  `renameDefaultNamedTemplateRulesForCompany`, called per active company by the release sync after the
  resync. Any status, any creator; name only, so `updatedBy` (the resync's edit test) is untouched and no
  version is written. Because the stored name changes, the rule list, run history, the assistant's workflow
  labels and the title of later tasks that fall back to the rule name are all Thai. Descriptions copied from
  templates are not shown anywhere, so they are left.
- Limits: a company that typed exactly the old English default is treated as default; a company that is not
  ACTIVE is renamed at the first release after it is active again (the sync loops ACTIVE companies only).
- Test: `workflow-template-auto-enable.spec.ts` (registered), red 30 / 4 (function, map and sync call
  missing) → green 34 / 0; `workflow-template.use-case.spec.ts` 5 / 0.
- Noticed, unchanged: `workflow-action-runner.use-case.ts` writes English when a rule has no title of its
  own: notification title `${ruleName} — WatchDog Workflow` (only deprecated/unavailable templates or custom
  rules reach it), the fallback task `[Review needed] ${ruleName}` with an English description (reached by
  every run of an enabled “ขอให้ AI ช่วยร่างข้อมูล” rule, whose default `requesterUserId` is ''), and the
  audit note `Workflow rule "…" fired.`.
