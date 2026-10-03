# Agent Memory: English left on signed-in pages

Status: lane 3b complete; batch A follow-up items 1–6 and round 2 (R1–R8, additions A and B; sections at the end) complete on `claude/batch-a-roles-notices-20261003`, not pushed; browser, real PostgreSQL and a release-sync run remain with the controller
Owner: lane 3b; batch A follow-up by the controller's subagent
Scope: Report catalogue, report column labels and CSV headings, assistant-facing report source labels, report view defaults/values, workflow automation text, notification rule text, add-employee wizard, dashboard stock card. No package.json, migration, Prisma schema, `apps/api/src/modules/line-ai`, `apps/ai-gateway`, or pinned user-guide content changes.
Decisions: Reuse the Thai report catalogue for API source-reference labels; CSV headings reuse report result column definitions. Map rule names to trigger-based Thai labels and map system workflow template copy from the template catalogue, including stale stored template summaries. Preserve company-entered saved-view/rule/template names and custom text. Keep the English dictionary block unchanged. Format system dates/times/numbers with the shared Thai helpers/locale. Use native time controls for quiet-hours inputs so the page does not print API-format time examples. Remove report IDs/source keys from the workspace and replace workflow rule-test JSON output with a Thai, side-effect-accurate summary.
Open questions: (1) `docs/specs/employee-access-role-management-spec.md` says DOB-derived passwords do not force a first-login change, while `create-employee.use-case.ts` sets `mustChangePassword: true` and the wizard says the employee must change it; which rule controls? [Closed 2026-10-03 by batch A item 5: the code controls; the spec was corrected.] (2) Should old system-seeded workflow rule names be displayed from the Thai template catalogue, or should every stored name remain untouched because it may be company-custom? [Closed 2026-10-03 by batch A item 3: the release sync renames rules still carrying a former default; other names stay.] (3) Report rows can still contain generated metric keys, severity/freshness enums, and source IDs; should these become Thai display values, remain as business/export values, or be omitted? [Closed 2026-10-03 by batch A item 2: Thai words from one API map at the page and CSV; ids replaced by numbers and names.] The Reports workspace localizes the `periodKey` display, while CSV still carries its source value. (4) Should raw condition/action/sample JSON and webhook event-key/endpoint fields remain available in the explicitly technical workflow editor, or should shop users get a Thai form? (5) The pinned report guide still contains English report names and column labels; it was intentionally not changed under the lane restriction. [Closed 2026-10-03 by batch A item 1, below.] The birth-date field continues to show its editable day/month/year form after input; no input-format behavior was changed.
Artifacts: `apps/api/src/modules/reports/domain/report-catalog.ts`, `apps/api/src/modules/reports/application/report-source-adapters.ts`, report UI logic/page/spec; workflow catalogue/mapper/explanations and page/spec; notification model/use cases/page/logic/spec; employee wizard/dictionary/spec; dashboard stock provider/page/logic/spec; E2E selector updates in `e2e/reports.spec.ts` and `e2e/_reference.spec.ts`, plus `e2e/TEST-CASES.md`; four corresponding specs; this note.
Verification: Red then green: report API labels (old code 15 pass/1 fail; final 16/16), workflow API text (old code 26 pass/1 fail; final 29/29), notification API names (10/1; 11/11), stock reorder label (6/1; 7/7), employee wording including removal of “OA” (10/1; 11/11), dashboard metric/channel formatting (4/1; 6/6), notification page wording (3/1; 4/4); added quiet-hours control check (4/1; 5/5), report view/value/enum text (old period value 11/1 and ungrouped numeric string 11/1; final 12/12), workflow page text (old label fallback failed; 13/13). The assistant-facing report source label regression was separately red at 15/1 on `General Ledger ${periodKey}` and green at 16/16. API typecheck passed (exit 0); web typecheck passed after final UI changes (exit 0); `git diff --check` passed (exit 0). Browser/E2E and real-PostgreSQL specs were not run because this lane forbids browsers and has no database.
Next: (batch A) see "Batch A verification and next" at the end. (lane 3b) Controller runs the changed report E2E selectors in a browser, the real-PostgreSQL specs, and reviews the listed product questions and narrow-layout risks. No package script or dependency changes were made.

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

### Item 2: machine values in report rows and CSV (open question 3)

Decision (controller): rows and CSV a person reads show Thai words from one map at the API source; internal ids
are not shown. Where rows go: `RunReportQueryUseCase` serves the page (POST query), the CSV export, and the
assistant's `reports.get_monthly_report_summary`, which keys on `row.source === 'crm_open_pipeline'`, builds fact
ids from `row.source`/`row.section` and checks `row.currency` as an ISO code. Runs keep no rows. So the words are
applied where a person reads, not in the adapters:

- `reports/domain/report-row-text.logic.ts`: `REPORT_VALUE_TEXT` (report → column → words) and
  `reportResultForPeople` (rows, ใช่/ไม่ใช่ for yes/no, chart labels). Reused contract labels: ledger account
  class (trial balance class, P&L and balance-sheet sections), expense status, source document type, tax
  evidence status, expense payment status (+ OVERDUE for receivables). Applied in `ReportController.queryHandler`
  and before `buildReportCsv` in `CreateReportExportUseCase`.
- Adapters: no id fallback for document, movement or expense numbers (null → "-" on the page, empty in the CSV);
  a customer without a name shows ไม่ระบุชื่อลูกค้า (was "Unknown customer"); the three stock reports show product and
  storage-location names (`StockBalance`/`StockMovement` gain optional names, filled by the balance query and
  the movement list); the accountant-evidence category is the company's expense category name (was
  `taxCategory`/`accountHintKey` codes), the same thing the expenses accountant index prints under the same heading.
- Web: the yes/no branch in `reportValueText` was a now-unreachable second copy of ใช่/ไม่ใช่ and is removed.
- Every value found (red run, identity transform): ASSET/REVENUE/…; REVENUE/COST/EXPENSE/TAX_EXPENSE; OVERDUE, THB,
  Unknown customer, the document id; issued_invoices, crm_open_pipeline; the five pipeline metric keys; product,
  location and movement ids; COUNT_ADJUSTMENT_OUT, OUT; READY_FOR_CONFIRMATION; ABBREVIATED_TAX_INVOICE,
  CONFIRMED, NON_CLAIMABLE, SUPPORTING_ONLY, SERVICE_FEE, the expense id; WHT, PND53, NEEDS_REVIEW, CUSTOMS,
  CUSTOMS_SUPPORT, AMENDED; the eight workflow metric keys, info/warning/critical; stale; the ten AI metric keys;
  and `true` in the CSV.
- Tests: `report-source-adapters.spec.ts` runs all 18 reports with sources that return their real machine values
  and rejects any English letter (except the kept names and ISO timestamps) in page cells, chart labels and CSV,
  and checks the adapter rows the assistant reads are unchanged: red 18 / 16 → green 34 / 0. Yes/no mutation:
  without the branch the CSV shows `true` (red). `report.use-cases.spec.ts`: page answer and CSV file in Thai,
  use-case result untouched: red 33 / 2 → green 35 / 0. Web `reports-ui.logic.spec.ts` 12 / 0.
- Limits: an archived expense category prints no name (`listCategoryCandidates` is active-only); words that
  exist only in web files (movement types from the dictionary, AI suggestion statuses, notification severity,
  freshness) are copied, matching letter for letter, because the API cannot import web code.

### Item 6: left as they are (controller decision)

The automation page's advanced JSON editor for conditions, actions and the test sample; the connections
form's address, secret and event fields (technical inputs); and text a company stored (saved-view names,
custom rule names, task text, dead-letter notes, connection names). Not changed.

### Noticed in batch A, not changed

- Report page money cells always end in “บาท” (lane 3b), so a USD row in อายุหนี้ลูกหนี้การค้า, สรุปยอดขาย,
  สรุปค่าใช้จ่าย or สถานะเงินสด reads “… บาท” beside “USD”; charts likewise. Needs the row's currency as the unit.
- Balance-sheet rows now say ส่วนของผู้ถือหุ้น (the shared ledger label) while the catalogue description
  says ส่วนของเจ้าของ: one word should be chosen for both (a product wording call).
- Report warnings: `crm_scope_forbidden` says “CRM”; `crm_pipeline_currency_unavailable` and
  `mixed_currency_total_unavailable` have no words and fall to “…ตรวจสอบขอบเขตข้อมูลและสิทธิ์ของคุณ”, which is
  untrue for a currency gap.
- CSV: dates are UTC ISO timestamps; the file name is the report code (`financial.general_ledger-….csv`).
  Chart series labels in the adapters are English (not shown on the page). Dashboard-health rows drop the
  metric unit. Totals (e.g. net profit) are not shown on the page.
- Stock-balance filters “สินค้า” and “ที่เก็บสินค้า” are free-text boxes that expect internal ids. The
  inventory pages print raw ids (`InventoryPages.tsx` balance list and movement table); the balance and
  movement queries now carry names they could use. The assistant's inventory tools label sources by product id.
- Workflow action runner English: notification title fallback “… — WatchDog Workflow”, fallback task
  “[Review needed] …” with an English description (every run of an enabled “ขอให้ AI ช่วยร่างข้อมูล” rule, whose
  default requester is empty), audit note “Workflow rule … fired.”.
- Tax pages: period badges print raw status codes, form labels carry “(VAT)/(WHT …)/(CIT …)”, the pinned tax
  guide's status table starts with `NEEDS_REVIEW`; accounts-payable shows `PP36_RECEIPT`/`PAYMENT_EVIDENCE`.
- Words copied from web-only files into the API map (movement types, AI suggestion statuses, notification
  severity, freshness): moving those labels to contracts would make them one source.

### Batch A verification and next

Commits: `f4359f9d5` (item 1), `64c93e00a` (item 4), `55a616b6c` (item 5), `dc0a226de` (item 3), `bbaa239ec`
(item 2), `82faad193` (W00 manifest). Under `/tmp/mangmee-heavy.lock`, no `S3_*` variables: API typecheck
rc 0; web typecheck rc 0 (`next-env.d.ts` unchanged); whole web suite rc 0, 2696 tests in 560 suites,
2696 / 0 / 0; whole-chain acceptance rc 0, 8 suites, 3694 / 0 / 0 (after the manifest regeneration; before
it, parity failed on exactly `report-source-adapters.ts` and `ReportsWorkspacePage.tsx`). Focused, final:
workflow template auto-enable 34 / 0, workflow template use case 5 / 0, report adapters 34 / 0, report use
cases 35 / 0, report CSV 2 / 0, inventory stock movement 40 / 0, assistant report tool 5 / 0; web guide
30 / 0, workflow logic 15 / 0, reports UI 12 / 0; approved-knowledge 9 / 0. `git diff --check` rc 0.
Not run: browser, real PostgreSQL (the inventory name lookups and the movement `include` are typechecked
only), and the release sync against a database.
Next: controller reviews, runs the report e2e and a browser pass (reports, automation, connections tab),
and deploys the assistant with the web (the reports pin moved). The rule renames happen at the next
release's template sync.

## Batch A round 2 (2026-10-03, coordinator; closes batch A)

### R2: one word for equity (and for income tax)

`LEDGER_ACCOUNT_CLASS_LABELS` (contracts): EQUITY ส่วนของผู้ถือหุ้น → ส่วนของเจ้าของ, and TAX_EXPENSE
ภาษีเงินได้นิติบุคคล → ภาษีเงินได้, both true for a sole proprietor, a partnership and a company. TAX_EXPENSE had
to be chosen too: the chart-of-accounts page kept its own copy that already said ภาษีเงินได้, and one list
needs one word. Where the shared label now shows: report rows and CSV (trial-balance class, P&L and
balance-sheet sections, their chart labels); the balance-sheet catalogue description (built from the labels);
the chart-of-accounts settings page (class filter and column; its own copy deleted); the ledger reports
page's statements card (รายได้, ต้นทุน, ค่าใช้จ่าย, หนี้สิน, ส่วนของเจ้าของ were inline words); the assistant's
ledger report fact (สินทรัพย์, หนี้สิน, ส่วนของเจ้าของ). The API's DTO validation uses only the keys. Not changed:
the SME chart-of-accounts template's account names ภาษีเงินได้นิติบุคคล (6000-00) and ภาษีเงินได้นิติบุคคลค้างจ่าย
(2132-05), which are company data seeded into charts, and the CIT tax-type words (correct for CIT). Spec:
`double-entry-ledger-closing-spec.md` §11.2. Tests: report adapters red 34 / 1 → 35 / 0; web ledger red 9 / 2 →
11 / 0; assistant business-read semantics red 192 / 1 → 193 / 0.

### R7: one source for the words the report rows share with pages

Moved into contracts, with the words the pages showed: `STOCK_MOVEMENT_TYPE_LABELS` (inventory; the Thai
dictionary entries `inventory.movement.*` now point at it), `AI_SUGGESTION_STATUS_LABELS`,
`AI_RISK_LEVEL_LABELS`, `AI_SUGGESTION_NEEDS_DATA_LABEL` (the AI suggestion page's copies deleted),
`NOTIFICATION_SEVERITY_LABELS` (severityLabel), `REPORT_FRESHNESS_LABELS` and `REPORT_CURRENCY_WORDS`
(reports page), `WORKFLOW_TAB_LABELS` and the rule, run, task and dead-letter status lists (automation page),
`ACCOUNTING_DOCUMENT_TYPE_LABELS`, `ACCOUNTING_DOCUMENT_STATUS_LABELS`, `ACCOUNTING_PAYMENT_STATUS_LABELS`
(accounting document pages). The web modules keep their export names, pointing at the same objects. The
report map builds every shared word from them; only words no page shows stay in it (severity ปกติ and
ควรตรวจสอบ, dashboard freshness partial/unavailable, movement direction, tax, input-VAT and CRM metric words).
Words that changed on report rows as a result: receivables payment status now matches the accounting pages
(OVERDUE เกินกำหนด, VOIDED ยกเลิกแล้ว); AI metrics read คำแนะนำจาก AI สถานะ<status word> and
คำแนะนำจาก AI ที่ต้องการข้อมูล (the page's word). Tests: new web `common/i18n/one-source-words.spec.ts` red
0 / 4 → green 4 / 0 (identity and word checks per page); API adapters “report words come from the shared
lists” red 35 / 2 → green 37 / 0.

### R1: money says บาท only for baht

`reportMoneyUnit(row)` (web): the row's currency word from the API (บาท for THB, another currency's code), no
unit when the source does not know the currency (the open-opportunity row of สรุปยอดขาย), and บาท for reports
without a currency column (ledger, tax, payables: the company's base currency, which is only ever read and
defaults to THB; payables aging is THB by construction). Table cells and chart points use it; chart point i is
row i of the same page. The accountant evidence report gained a สกุลเงิน column, since an expense can be in a
foreign currency. Spec: reports-bi-spec.md formatting rule. Tests: web reports-ui red 12 / 2 → 14 / 0 (a USD
row reads “12.34 USD”); API adapters “accountant evidence currency” red 37 / 1 → 38 / 0.

### R3: report warnings

`crm_scope_forbidden`: “สรุปนี้ไม่รวม CRM เพราะ…” → “สรุปนี้ไม่รวมโอกาสการขาย เพราะคุณไม่มีสิทธิ์ดูส่วนนั้น”.
`crm_pipeline_currency_unavailable` (fell to the generic scope/permission sentence): “มูลค่าโอกาสการขายรวมทุกรายการ
โดยไม่แยกสกุลเงิน จึงไม่แสดงหน่วยเงินของยอดนี้”. Fact: opportunities record a currency, but the open-pipeline total adds
every `amountEstimate` whatever its currency, and since R1 that row shows no unit.
`mixed_currency_total_unavailable` (same fallback): “ใบแจ้งหนี้มีมากกว่าหนึ่งสกุลเงิน จึงไม่รวมยอดค้างชำระเป็นยอดเดียว
และไม่ได้เทียบกับยอดคุมบัญชี”. Fact: the receivables total is null and the ledger-control comparison is skipped.
A web test reads all 14 warning codes from the API sources and requires words of their own: red 14 / 2 → 16 / 0.

### R4: a rule's fallback words

`workflow-action-runner.use-case.ts`, behaviour unchanged (same task, same result `{ fallback: true }`):
- Notice without a title of its own: “<rule> — WatchDog Workflow” → “แจ้งเตือนจากกฎอัตโนมัติ: <rule>” (the automation
  tab word from contracts).
- Fallback task title “[Review needed] <rule>” → “ต้องดำเนินการเอง: <rule>”; the English description (action type and
  config reason) → per case: report-export draft “ระบบยังเตรียมไฟล์ส่งออกรายงานให้อัตโนมัติไม่ได้ จึงสร้างงานนี้ไว้ให้ส่งออกเอง
  จากหน้ารายงาน”; AI draft without requester or template “กฎนี้ตั้งค่าการขอให้ AI ช่วยร่างไม่ครบ (ยังไม่ได้ระบุผู้ขอหรือแบบร่าง)
  ระบบจึงสร้างงานนี้ไว้ให้ดำเนินการเอง”. The audit note is unchanged.
- The AI-draft template (`ai_draft_requested`, “ขอให้ AI ช่วยร่างข้อมูล”): its one action requests a draft for
  `requesterUserId`, which defaults to '' and can only be set by typing a user id into the advanced JSON editor;
  `requestAiDraft` treats '' as missing and creates the fallback task instead, once per action run, so no draft
  is ever requested. Its trigger is the event `ai.draft_requested`, and nothing in the API emits that event (the
  AI draft module appends no outbox events), so an enabled rule does not run by itself today; the task appears
  only when one of its action runs is replayed by hand. Smallest correct fix, for the owner: mark the template
  UNAVAILABLE in the catalogue with a true Thai reason (the release sync writes the status; enabling an unavailable
  template is already refused at `workflow-template.use-case.ts:220`; existing rules never fire). Making it work
  instead needs three things: emit `ai.draft_requested` from the draft flow, let the owner pick the requester in
  the enable dialog, and keep the rule's own draft requests from triggering it again (the default 3600 s cooldown
  would be the only brake).
- Test: `workflow-action-runner.use-case.spec.ts` (registered) red 88 / 3 → 91 / 0. Spec: workflow UI rules.

### Addition A: role words in automation templates and the notification rule name

Template texts now take role names from `THAI_SYSTEM_ROLE_NAMES` and say whom the template really notifies
or assigns (its `recipientRoles`, `lastResortRecipientRoles`, `assigneeRole`): สรุปประจำวัน (name and text) →
เจ้าของกิจการและผู้ดูแลบริษัท (was เจ้าของร้าน / ผู้ดูแล); low stock → แจ้งฝ่ายคลังสินค้าและเจ้าของกิจการ และสร้างงานให้
ฝ่ายคลังสินค้า; stockout risk and sales below target no longer claim a task they do not create (the latter named
หัวหน้าทีม, it notifies เจ้าของกิจการและผู้จัดการ); approval reminder and the two finance-review notices name
เจ้าของกิจการ; tax due soon names ฝ่ายบัญชีและเจ้าของกิจการ, task to ฝ่ายบัญชี; follow-up due names ฝ่ายขายและผู้จัดการ,
task to ฝ่ายขาย (was ผู้ดูแลฝ่ายขาย); the connection template no longer says ผู้ดูแล. The same check found four more
in the class, fixed: vendor bill pending (also notifies ฝ่ายบัญชี; “ผู้ขายส่ง” → “มีใบวางบิลส่งขออนุมัติ”), overdue
invoice (notifies only ฝ่ายการเงิน, no task), opportunity stuck (หัวหน้าฝ่ายขาย → ผู้จัดการ, its real recipient and
assignee), correction requester (the sender is ผู้ตรวจสอบด้านการเงิน, who may be the owner, not ฝ่ายการเงิน). The
notification rule name `daily_owner_summary` (notification.model.ts) → สรุปประจำวันสำหรับเจ้าของกิจการและผู้ดูแลบริษัท,
the people DailyOwnerSummary sends to. Former names for the rename sync stay English only (the lane 3b Thai
names never shipped). Tests: workflow template spec red 34 / 2 (also against the old catalogue) → 36 / 0;
notification DTO spec red 10 / 1 → 11 / 0.

### Addition B: a notification rule with no channel

The rules page read “ช่องทาง:  · พักการแจ้งเตือน … นาที” for a rule listing no channel. `notificationRuleDetailText`
leaves the channel part out in that case (“พักการแจ้งเตือน 60 นาที”) instead of saying no channel was chosen,
because delivery does not read the rule's `channelPolicyJson` at all: it follows each person's channel
preferences (`enabledChannelsJson`). The same fact means even a listed channel (“ช่องทาง: LINE”) describes a stored
setting with no effect; reported for the owner, not changed. Tests: web notification logic red 6 / 2 → 8 / 0;
lane 3b's page assertion moved to the helper (page spec 5 / 0).

### R5: CSV dates and file name

`buildReportCsv` writes `date` columns as the company day (`civilDate`, Asia/Bangkok; a `YYYY-MM-DD` value stays)
and `datetime` columns as `YYYY-MM-DD HH:mm` in Asia/Bangkok, so 2026-09-02T03:05Z reads 2026-09-02 10:05; the page
still gets ISO values because its own Thai formatter reads them. `reportCsvFileName`: the Thai title and the
company day, any character outside Thai, ASCII letters, digits, `_` and `-` becomes `-` (so
สรุปคำแนะนำจาก-AI-2026-10-03.csv; was financial.general_ledger-2026-10-03.csv). Also replaced a literal BOM
character inside a round-1 test string with `﻿`. Tests: CSV logic red 2 / 2 → 4 / 0; export file name red
35 / 1 → 36 / 0.

### R6: archived expense categories keep their names

The accountant evidence report looked names up with `listCategoryCandidates` (active categories only), so an
expense filed under an archived category showed none. New `ListExpensesUseCase.listCategoryNames(companyId, ids)`
→ `PrismaExpenseRepository.listCategoryNames`: the names of exactly the categories the rows use, any status,
this company's or the shared ones. Test: adapters red 38 / 1 → 39 / 0. The Prisma query itself is typechecked,
not run against a database here.

### R8: guide and catalogue sentences true to the code

Facts checked in code: the catalogue returns all 18 reports to anyone with `report.catalog.read`; those the
user cannot run carry status FORBIDDEN, shown as “ไม่มีสิทธิ์” with the run button disabled. Runs store no rows,
and the history list is not clickable. Every run computes afresh; only ภาพรวมการทำงาน reads the dashboard's stored
snapshot (refreshed by the 15-minute sweep or on demand). “รีเฟรช” reloads the lists, not a result. A saved view is
named automatically (title + date); clicking it restores report, filters and format without running. The export card
is “ไฟล์รายงานที่ส่งออก”: own files, or everyone's with export-manage rights; files expire after 7 days; it does not
show who exported. Reports ignore the top-bar branch choice (other pages use it). Ledger reports sum only the
selected period's posted lines: `GetGeneralLedgerUseCase` sets `openingBalance: '0.0000'`, `getAccountBalances`
groups lines of the one period, and nothing posts opening or closing balances. The receivables report lists
invoices, with no aging buckets.

Changed: all 18 catalogue descriptions now say what the rows hold (shared words for ledger classes, invoice,
issued, movement types, automation names, the needs-data word), and the guide's report table copies them word for
word (API test reads the guide file). Ledger “ยอดคงเหลือ” columns (general ledger, trial balance; catalogue measures
and adapter columns) → “ยอดสุทธิในงวด”; guide example heading follows. Guide sentences rewritten: the overview note
(all reports listed, “ไม่มีสิทธิ์”), the left column and export item (“ไฟล์รายงานที่ส่งออก”, 7 days, own vs all),
catalogue summary and card note, the freshness row, a new note that ledger reports are per period, saved views,
run history (no stored results), the CSV item (5,000 rows, Thai-titled file, Thailand time), the export note, the
history permission row (ดูประวัติการเรียกรายงาน / ดูประวัติรายงาน), the FAQ question on “ไม่มีสิทธิ์”, the branch
FAQ (“ทุกสาขา (รวม)”), the stale-data FAQ, and the run summary (ตัวกรอง, not only งวด). Pin `reports` `2b48f07e…` →
`a26bbd51335bb620c4ef3511760ee89c14754b12189881416ca0cfca9fd5abe4`. Card `report.access` was untrue (only
permitted reports shown, roles see different lists, “ผู้ดูแล”); body now: everyone who can open the menu sees all
reports, those without rights are marked “ไม่มีสิทธิ์”, rights are checked again on export, ask เจ้าของกิจการ (one
list) for more. Tests: API adapters red 39 / 3 → 42 / 0; web guide red 30 / 2 → 32 / 0; approved-knowledge red
8 / 1 → 9 / 0.

### Round 2 verification and next

Commits: `358ea7642` (R2), `563bc18bf` (R7), `e734304e2` (R1), `70a319401` (R3), `0db16fb04` (R4), `4a2fa61e5` (A),
`f3efac17a` (B), `f6bac833b` (R5), `a48b6b943` (R6), `578fe9bb3` (R8), `2786e94d3` (W00 manifest).
Checks: contracts build rc 0; contracts specs rc 0, 344 / 0 / 0; API typecheck rc 0; web typecheck rc 0 (next-env
unchanged); whole web suite rc 0, 2710 tests in 565 suites, 2710 / 0 / 0; whole-chain rc 0, 8 suites, 3694 / 0 / 0 (after the manifest regeneration; parity named
exactly report-source-adapters.ts and ReportsWorkspacePage.tsx). Focused API: adapters 42/0, use cases 36/0, CSV 4/0,
action runner 91/0, template auto-enable 36/0, template use case 5/0, notification DTOs 11/0, assistant report tool
5/0, manifest 4/0; assistant: approved-knowledge 9/0, business-read semantics 193/0. git diff --check rc 0.
Not run: browser, real PostgreSQL (category-name and inventory queries typechecked only), release sync on a database.
Next: controller review; browser pass on reports (money units, warnings, guide), automation (fallback tasks, template
texts), notification rules; deploy the assistant with the web (pin moved, card body changed).
