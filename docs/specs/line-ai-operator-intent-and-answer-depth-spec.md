# Feature: LINE AI Operator Intent and Answer Depth

## 1. Status

- Owner: Product owner
- Date: 2026-08-19
- Status: Core intent-depth and capability-availability honesty implemented and verified locally.
  Real-provider language evaluation still requires a network-enabled terminal; no UAT or Production
  deployment is part of this task.
- Incident driver: a Production turn asking `ช่วยคำนวณยอดค่าใช้จ่ายเดือนนี้ให้หน่อย`
  invoked `expense.get_daily_closing`, returned a full daily-close card, and linked to the generic
  expense list.

## 2. Goal

ผู้ประกอบการที่เก่งงานของตัวเองแต่ไม่ใช้ศัพท์ระบบต้องถามภาษาธรรมชาติ คำย่อ ภาษาพูด หรือข้อความ
พิมพ์ผิดได้ แล้วได้รับคำตอบที่ตรงกับการตัดสินใจที่กำลังจะทำ:

- ถามยอดรวม ให้ตอบยอดรวมก่อน
- ถามสิ่งที่ต้องทำ ให้ตอบรายการเร่งด่วน
- ขอภาพรวมก่อนปิดร้าน จึงค่อยตอบ daily-closing ครบชุด
- ปุ่มต้องบอกตรงกับหน้าที่จะเปิดจริง

ระบบต้องรับความซับซ้อนแทนผู้ใช้ ไม่บังคับให้ผู้ใช้เรียนรู้ชื่อโมดูล สถานะ หรือชื่อรายงาน

## 3. Related Sources

- [[line-ai-owner-daily-closing-spec|LINE AI Owner Daily Closing]]
- [[line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant]]
- [[line-ai-assistant-ux-spec|LINE AI Assistant UX]]
- [[feature-disabled-error-honesty-spec|Feature-Disabled Error Honesty]]
- [[../plans/line-ai-operator-intent-and-answer-depth-plan|Implementation plan]]

## 4. Users

Primary user is an owner/operator who:

- knows suppliers, customers, stock, cash rhythm, and what is abnormal in the business;
- may be uncomfortable with dashboards, accounting vocabulary, or exact system status names;
- writes short Thai, colloquial Thai, abbreviations (`คชจ.`, `ผปก.`), missing spaces, repeated
  characters, or common mobile-keyboard mistakes;
- expects the assistant to understand the business question without pretending that missing system
  data exists.

Low-tech is not low-skill. The assistant must preserve the user's business judgment and reduce
system vocabulary, not talk down to the user.

## 5. Non-goals

- A keyword router that bypasses the semantic Intent Router
- A new dashboard or a dedicated daily-closing web page in this bugfix
- Final payment, approval, posting, or other mutation from LINE
- Guessing unseen bills, cash balances, targets, or comparisons that the source does not provide
- Changing permissions, tenant scope, provider, or AgentCore deployment architecture
- Activating a company feature, changing a package, or deploying to UAT/Production as part of the
  implementation task

## 6. Operator Question Model

The router must semantically distinguish these dimensions. They describe product behavior; they do
not require a new wire schema in this patch.

| Dimension | Values/examples |
|---|---|
| subject | expense, sale, stock, customer, cash/ledger, work/notification |
| goal | total, list, compare, exception, next action, daily close |
| time scope | today, current month, explicit date/range, unspecified |
| business scope | all permitted branches, one permitted branch |
| answer depth | brief, operational, detailed |

Examples:

| User message | Goal | Time | Depth | Expected tool |
|---|---|---|---|---|
| `เดือนนี้ใช้ไปเท่าไหร่` | total | current month | brief | `expense.list_recent` |
| `มีค่าใช้จ่ายอะไรบ้างเดือนนี้` | list | current month | detailed | `expense.list_recent` |
| `วันนี้ต้องจ่ายอะไร` | next action | today | operational | `expense.get_daily_closing` |
| `สรุปก่อนปิดร้านหน่อย` | daily close | today | operational | `expense.get_daily_closing` |
| `เดือนนี้ใช้ไปเท่าไหร่ แล้ววันนี้ต้องจ่ายอะไร` | total + next action | month + today | brief + operational | both tools |

## 6.1 Outcome Before Module Name

The router must first identify what the operator wants to know. A word such as `สินค้า` is evidence,
not an automatic inventory route.

| Operator message | Business outcome | Required capability | Must not become |
|---|---|---|---|
| `มีน้ำมันพืชยี่ห้อ A ไหม` | find a catalog item | product/catalog | generic no-data before availability is known |
| `ของอะไรใกล้หมด` | inspect stock risk | inventory | a sales recommendation |
| `ช่วงนี้ควรขายอะไรดี` | unsupported product decision advice | none in the current catalog | inventory search or aggregate sales summary |
| `บิลนี้จ่ายค่าสินค้าอะไร` | read line items from one expense/accounting document | expense/document detail | inventory merely because the sentence contains `สินค้า` |

`ช่วงนี้ควรขายอะไรดี` cannot be answered reliably by either aggregate sales receipts or a product
search. The current system has no grounded product-level demand, margin, sales-mix, and stock
recommendation capability. It must decline rather than substitute a nearby tool or invent advice.

## 6.2 Availability and Failure Semantics

These states are different customer truths and must remain different end to end:

| Outcome | Authoritative evidence | Customer meaning | Forbidden wording |
|---|---|---|---|
| `feature_disabled` | the tool fails effective permissions but passes after restoring only server-resolved `entitlementDeniedPermissions`, the exact server-resolved feature set does not entitle the tool, or the API returns `FEATURE_NOT_ENABLED` | the company has not enabled the needed capability | `ไม่มีสิทธิ์`, `ไม่พบข้อมูล`, `ระบบล่ม` |
| `forbidden` | the tool still fails after entitlement-stripped permissions are restored | this member does not have access | `ฟีเจอร์ยังไม่ได้เปิด` |
| `unsupported_module` | no current tool can answer the requested outcome reliably | MangmeePlus cannot currently answer this question | pretending a nearby report answers it |
| `tool_unavailable` | provider/source/adaptor is temporarily unavailable or the backend tool is not wired | the capability cannot be used through this channel now | implying the company did not buy/enable it |
| `no_data` | an authorized tool ran successfully and returned an explicit empty shape | no matching records exist in the connected system scope | `ฟีเจอร์ปิด`, `ไม่มีสิทธิ์` |
| `missing_context` | the capability is available but its canonical record/date/branch input is missing or ambiguous | one concrete user answer is needed | guessing a record from wording alone |

Safety and mutation policy run first. After that, resolution order is: semantic outcome -> supported
capability -> company feature -> member permission -> missing canonical input -> tool execution ->
explicit data state. A feature-disabled or forbidden tool is never invoked merely to learn which
sentence to display.

The API tool boundary remains authoritative. If an entitlement changes after planning but before
execution, `FEATURE_NOT_ENABLED` must still produce the same `feature_disabled` answer.

## 6.3 User-Facing Copy

Copy uses business language, not feature keys or module names.

| Situation | Required Thai response shape |
|---|---|
| Product catalog feature off | `ตอนนี้ร้านยังไม่ได้เปิดใช้ระบบสินค้าและบริการ จึงยังค้นหาหรือเปิดดูข้อมูลสินค้าจาก LINE ไม่ได้ค่ะ` |
| Inventory feature off | `ตอนนี้ร้านยังไม่ได้เปิดใช้ระบบคลังสินค้า จึงยังดูยอดคงเหลือ ของใกล้หมด หรือการเคลื่อนไหวสต็อกจาก LINE ไม่ได้ค่ะ` |
| Expense/document feature off | `ตอนนี้ร้านยังไม่ได้เปิดใช้ระบบค่าใช้จ่ายและเอกสาร จึงยังเปิดดูรายละเอียดบิลจาก LINE ไม่ได้ค่ะ` |
| Unsupported product recommendation | `ตอนนี้น้องมั่งมียังแนะนำสินค้าที่ควรขายอย่างน่าเชื่อถือไม่ได้ เพราะระบบยังไม่มีข้อมูลยอดขาย กำไร และสต็อกรายสินค้าครบ จึงไม่ขอเดาค่ะ` |
| Bill reference missing | `หมายถึงบิลใบไหนคะ ส่งรูปบิล เลขที่บิล หรือเลือกรายการล่าสุดมาได้เลยค่ะ` |
| Bill has readable lines | answer item descriptions first, then bounded quantity/amount from the selected bill |
| Bill has no readable lines | `บิลนี้ไม่มีรายละเอียดรายการสินค้าที่อ่านยืนยันได้ค่ะ` and never infer from vendor/category alone |

A feature-disabled answer is text-only unless a destination that the current member can actually
open is verified. It must not link to a hidden inventory/expense page. A future `ดูวิธีเปิดใช้`
button is allowed only after its destination and permission behavior have a renderer/integration
test.

## 6.4 Bill Reference and Attachment Rules

- A canonical recent expense/document in the same bounded LINE conversation may satisfy `บิลนี้`.
- More than one eligible recent bill -> show a bounded numbered choice and ask one question.
- No eligible recent bill and no attachment/reference -> ask which bill; do not call
  `expense.get_detail` or `accounting.get_document_detail` with a guessed id.
- An already stored expense uses `expense.get_detail`; an issued accounting document uses
  `accounting.get_document_detail`. Both already expose bounded `lines`.
- A newly attached expense document keeps the existing reviewable-draft safety boundary. If the
  caption explicitly asks what was purchased, the reply must lead with grounded OCR line items and
  then state that a reviewable draft was created. It must not silently answer only with a generic
  capture receipt.
- Inventory availability is irrelevant to reading lines from a bill. Expense/accounting-document
  availability and permission remain authoritative.

## 6.5 Complete Capability-Family Matrix

The customer label is the only label allowed in reply copy. Feature keys below are internal test and
authorization evidence and must never be shown to the user.

| Operator topic and examples | Current authoritative family | Customer label / unavailable behavior | Cross-routing guard |
|---|---|---|---|
| company and branch: `ตอนนี้อยู่บริษัทไหน`, `มีกี่สาขา` | core; no feature gate | no feature-disabled copy; use permission, missing context, empty, or unavailable truth | never infer a company or branch from chat text |
| business health and alerts: `วันนี้มีอะไรต้องดู`, `มีแจ้งเตือนอะไร` | `dashboard_notifications` | `ระบบภาพรวมและการแจ้งเตือน` | not a full financial, tax, or workflow report |
| product search/detail: `มีสินค้า A ไหม`, `ราคาขายเท่าไหร่` | `product_catalog` | `ระบบสินค้าและบริการ` | product existence/details are not stock balance |
| stock: `เหลือกี่ชิ้น`, `อะไรใกล้หมด`, `รับเข้าออกเท่าไหร่` | `inventory` | `ระบบคลังสินค้า` | inventory OFF must not block product search when `product_catalog` is ON |
| expenses and supplier bills: `เดือนนี้จ่ายอะไร`, `บิลร้านนี้ซื้ออะไร` | `expenses` | `ระบบค่าใช้จ่ายและใบเสร็จ` | supplier/outgoing bill is not a customer sales document |
| sales, customer invoices/receipts, receivables: `ยอดขาย`, `ลูกหนี้`, `ใบแจ้งหนี้นี้มีอะไร` | `sales_documents` | `ระบบเอกสารขายและรับชำระ` | customer/incoming document is not an expense merely because it says `บิล` |
| customers, pipeline, recorded follow-up tasks: `ลูกค้าใหม่กี่คน`, `ดีลค้าง`, `ต้องตามงานอะไร` | `crm` | `ระบบลูกค้าและการขาย` | listing recorded follow-ups is different from AI deciding whom to contact |
| bookings: `วันนี้มีจองกี่คิว`, `ใครจองพรุ่งนี้` | `crm.bookings` | `ระบบการจอง` | booking is not a generic customer search |
| customer inbox: `แชทไหนยังไม่ได้ตอบ`, `สรุปแชทลูกค้านี้` | `crm.inbox` | `ระบบกล่องข้อความลูกค้า` | conversation is not a booking or customer profile |
| purchasing, suppliers, purchase orders, AP: `ค้างเจ้าหนี้เท่าไหร่`, `PO นี้ซื้ออะไร` | `procurement` | `ระบบจัดซื้อและเจ้าหนี้` | purchase order is not an expense receipt or stock receipt |
| ledger, period and financial reports: `งวดปิดหรือยัง`, `ภาพรวมการเงิน`, `กำไรตามบัญชี` | `double_entry_ledger` | `ระบบบัญชีและรายงานการเงิน` | ledger is not live bank balance and sales receipts are not profit |
| Thai tax: `VAT เดือนนี้`, `ภาษีอะไรใกล้ถึงกำหนด`, `เอกสารภาษีขาดอะไร` | `thai_tax` | `ระบบภาษี` | never substitute ledger/accounting totals for a tax result |
| assigned work and automation health: `มีงานอะไรต้องทำ`, `กฎไหนล้ม` | `workflow_automation` | `ระบบงานอัตโนมัติและงานที่ได้รับมอบหมาย` | workflow task is not a general alert |
| packaged monthly reports: `รายงานเดือนนี้ว่าอย่างไร` | `reports` | `ระบบรายงาน` | choose dashboard, ledger, CRM, or reports from the requested outcome, not the word `รายงาน` alone |
| employee directory/access: `มีพนักงานกี่คน`, `ข้อมูลคุณเอ` | core; no feature gate | no feature-disabled copy | employee profile is not HR leave data |
| reimbursements: `มีเบิกรออนุมัติกี่รายการ`, `รายการเบิกนี้เท่าไหร่` | core/no feature gate by current owner decision | no feature-disabled copy | keep own/related/approve permission scopes distinct |
| bank balances/reconciliation | `bank_reconciliation`, but router tool is build-disabled today | `ส่วนบัญชีธนาคารยังไม่พร้อมใช้งานผ่าน LINE ค่ะ` | never say company feature off and never substitute ledger balance |
| leave summary | build-disabled today; no entitlement gate in the registry | `ส่วนข้อมูลการลายังไม่พร้อมใช้งานผ่าน LINE ค่ะ` | never substitute employee count/detail |
| AI-recommended sales follow-ups | `crm`, but recommendation tool is build-disabled today | `ส่วนคำแนะนำการติดตามลูกค้ายังไม่พร้อมใช้งานผ่าน LINE ค่ะ` | recorded follow-up tasks may still be listed when CRM is available |
| receipt evidence capture tool | business-router tool is build-disabled; image/file intake is a separate implemented route | with attachment, follow the expense intake/capture result; without one, ask the user to attach a bill | do not treat the disabled business tool as proof that receipt intake is unavailable |

The registry currently has 60 tools: 55 admitted by the business router and five build-disabled
tools (`crm.suggest_sales_followups`, `accounting.capture_receipt_evidence`, both bank reads, and
`hr.get_leave_summary`). Build-disabled is checked before company entitlement wording, so it never
claims that the company failed to enable something MangmeePlus cannot yet serve through LINE.

## 7. Intent and Tool Authority

### 7.1 Router

The semantic Intent Router remains the planner. For every routable business intent it chooses the
smallest sufficient `requiredTools` list.

- Month/range expense total or list -> `expense.list_recent`
- Explicit operational daily close, due-today, or before-closing checklist ->
  `expense.get_daily_closing`
- A multi-request turn may include both tools as separate intents

The catalog must describe `expense.list_recent` as a summary-capable period tool, not only a detail
list. The daily-closing description must state that it is a one-day operational checklist and is not
a replacement for week/month/range totals.

### 7.2 Executor

The tool loop is an executor, not a second planner. Tools exposed to either native or JSON model loop
must equal:

```text
intent.requiredTools
intersection specialist allowlist
intersection enabled tools
intersection subject compatibility
intersection effective permission
```

The executor must never broaden an expense plan to every expense tool. If a model requests a nearby
but unplanned tool, it receives a tool-not-available result and no ERP call occurs.

### 7.3 Fallback

If the model loop is unavailable or makes no valid call, deterministic dispatch executes the same
planned tools. It must not silently substitute a nearby tool.

### 7.4 Server-Derived Availability

`LineUserContext` carries the optional server-derived entitlement-denial map and exact entitled
feature keys from the existing permission resolver. Exact feature keys cover cross-feature tools
whose shared permission alone cannot prove entitlement. Both fields are internal authorization
context, never accepted from LINE text and never placed in a model prompt.

One shared plan-normalization step runs before native, JSON-model, and deterministic dispatch:

1. Existing effective permissions and exact feature entitlement pass -> keep the planned tool.
2. Effective permissions fail, but pass after restoring only entitlement-denied permission keys ->
   remove the affected intent/tool and add `feature_disabled`.
3. Permissions still fail -> remove the affected intent/tool and add `forbidden`.
4. Effective permission passes but exact feature entitlement fails -> remove the tool and add
   `feature_disabled`.
5. No executable intent remains -> `UNROUTABLE`; some remain -> `PARTIAL`.

This normalization is presentation guidance, not authority. Actor delegation and the API's live
permission/feature checks stay unchanged and fail closed.

## 8. Answer Contract

Default LINE answer order:

1. Direct answer/headline
2. Bounded context: count, period, or permitted scope
3. At most one useful exception or comparison when source data supports it
4. One truthful next action
5. Source/as-of metadata already provided by the card

### 8.1 Monthly Expense Total

For a total question, the first visible line is the period total. Daily-close buckets such as due
today, overdue, evidence blockers, or duplicate risk must not appear unless the user asked for them.

### 8.2 Daily Closing

Only an explicit daily operational request gets the complete daily-closing sections defined by the
existing daily-closing spec.

### 8.3 Honest Empty State

Say `ยังไม่มีรายการค่าใช้จ่ายในระบบสำหรับช่วงนี้` rather than claiming the business had no
expenses outside the system.

## 9. Web Action Contract

The current daily-closing source points to `/companies/{companyId}/expenses`, which is the generic
expense list. Until a dedicated closing page exists, the button label must be `ดูรายการค่าใช้จ่าย`
and must not imply that it opens a dated closing report.

A future dedicated page is separate scope and may use:

```text
/companies/{companyId}/expenses/daily-closing?date=YYYY-MM-DD
```

only after the page and permission-checked read API exist.

## 10. Security and Boundaries

- Existing API-side tenant, membership, branch, own/related, entitlement, and permission checks remain
  authoritative on every tool call.
- The new executor restriction may reduce the offered tool set; it must never expand authority.
- Multi-intent turns preserve independent subject/tool/permission checks.
- No prompt or corpus text grants permission or changes company scope.
- No raw user message, LINE id, credential, or provider key is written to test reports.

## 11. Observability

Local evaluation reports, per case:

- case id and category
- expected and planned tools
- invoked tools for full-orchestrator samples
- forbidden-tool violations
- duration and pass/fail reason

Production prompt logging remains disabled. A future additive trace may persist planned tools beside
invoked tools, but that is not required for this minimal fix.

For this extension, the existing turn evidence must also record the terminal outcome
(`feature_disabled`, `forbidden`, `unsupported_module`, `tool_unavailable`, or successful read) and
the bounded planned/invoked tool names. It must not persist the entitlement-denial map, raw feature
keys in customer copy, raw LINE id, or message text.

## 12. Local Language Evaluation

Implementation must include at least 100 locally invoked owner/operator questions. The checked-in
corpus contains 220 intent-depth cases plus 216 availability/failure cases across current business
families (436 full-flow local invocations total).

Minimum coverage:

- plain monthly expense totals/lists
- explicit daily-close and due-today questions
- mixed monthly + daily multi-intent questions
- colloquial Thai and short commands
- abbreviations such as `คชจ`, `คชจ.`, `ผปก.`
- missing spaces, repeated characters, common transposition/misspelling, and mobile typing noise
- English/Thai mixed wording used by Thai operators
- nearby negative cases from sales, stock, customer, and general accounting
- owner questions about profit/assets, receivables, payables, tax deadlines, alerts, branches, and
  reimbursement approvals
- cross-topic turns such as sales + low stock, profit + receivables, and payables + tax

The real-provider local eval invokes the semantic router for every corpus row with fixed, read-only
fixtures. A smaller full-orchestrator subset verifies that the executor cannot call an unplanned
tool. Unit tests remain deterministic and must deliberately make the model request a forbidden nearby
tool.

### 12.1 Availability-Honesty Corpus Extension

Add at least **128 unique operator questions** to the checked-in corpus and invoke them through the
real local orchestration path. Reuse the existing runner and add server-derived access fixtures; do
not create a second evaluation framework.

| Category | Minimum unique questions |
|---|---:|
| product catalog availability and product-detail routing | 8 |
| inventory balance/low-stock/movement availability | 8 |
| expenses, receipt intake, and bill line/reference handling | 12 |
| sales documents, customer receipts, and receivables | 8 |
| CRM customer, pipeline, and recorded follow-up tasks | 8 |
| CRM bookings and inbox conversations | 6 |
| procurement, suppliers, purchase orders, and AP | 8 |
| ledger financial summary, report, and period status | 8 |
| Thai tax obligations, VAT/WHT, missing documents, and reconciliation | 8 |
| dashboard health and notifications | 6 |
| workflow tasks, failures, and rule health | 6 |
| packaged monthly reports | 6 |
| core company/branch/employee and reimbursement permission cases | 8 |
| build-disabled bank, leave, CRM suggestion, and receipt-tool cases | 8 |
| unsupported advice/general-knowledge substitutions | 8 |
| mixed and contrast cases: feature off, forbidden, empty, missing input, source failure | 12 |

At least 40 rows must contain colloquial Thai, abbreviations, missing spaces, repeated characters,
common mobile typos, or Thai/English mixing. Each row declares expected semantic subject, planned
tools, terminal outcome, forbidden tools, required text fragments, and forbidden text fragments.

Fixture replay must pass all rows. Before UAT, at least 100 of these exact unique messages must also
be invoked through the configured real semantic provider from a network-enabled local terminal.
Provider routing is evidence only for semantic selection; feature/permission outcomes remain
deterministic server-derived assertions.

## 13. Acceptance Criteria

- [x] Exact incident text invokes only `expense.list_recent` in deterministic and fixture-replay coverage.
- [x] 220 checked-in operator-language cases exist and are locally invoked through the full
  orchestration code path.
- [ ] Real-provider semantic routing passes at least 100 cases; the local sandbox cannot reach the
  Bedrock/STS endpoint, and the runner fails fast as `PROVIDER_UNAVAILABLE`.
- [x] Monthly expense variants never invoke `expense.get_daily_closing` in local replay.
- [x] Sales, inventory, customer, finance, receivable, payable, tax, alert, company, and
  reimbursement variants invoke only their planned tools in local replay.
- [x] Explicit daily-close variants invoke `expense.get_daily_closing` in local replay.
- [x] Mixed month + daily requests use both tools and no unrelated third tool in local replay.
- [x] A native/JSON loop request outside `requiredTools` cannot reach the ERP client.
- [x] Monthly answers do not contain daily-close sections.
- [x] Daily-close button says `ดูรายการค่าใช้จ่าย` while it targets the generic expense page.
- [x] Existing permission, multi-intent, coverage, fallback, and source-honesty tests remain green.
- [x] Focused typecheck/tests and `git diff --check` pass.
- [x] A company-disabled inventory/product request returns `feature_disabled` on local,
  native/model-loop and deterministic fallback paths; it never says permission, no data, or
  temporary source failure. AgentCore payload parsing is implemented/typechecked, but its HTTP spec
  cannot bind a local port in this sandbox (`listen EPERM`).
- [x] With `product_catalog=ON` and `inventory=OFF`, product search/detail still succeeds while stock
  balance, low-stock, and movement requests return the inventory-specific feature-disabled copy.
- [x] A genuine missing role permission still returns `forbidden`, including when an unrelated
  company feature is disabled.
- [x] Static build-unavailable tools say unavailable through LINE and never claim that the company
  did not enable the feature.
- [x] Core/no-feature-gate company, branch, employee, and reimbursement reads never emit
  `feature_disabled`; they preserve permission, empty-data, missing-input, and source-failure truth.
- [x] `ขายอะไรดี` and typo/abbreviation variants call no inventory or aggregate-sales tool and use
  the grounded unsupported-advice copy.
- [x] `บิลนี้จ่ายค่าสินค้าอะไร` routes to expense/document semantics, never inventory. It either
  returns grounded lines, asks for one bill reference, or reports the relevant expense/document
  feature state.
- [x] A feature-disabled answer contains no business-data source reference and no link to a hidden
  feature page.
- [ ] 216 new unique availability questions pass full local fixture replay; at least
  100 pass real-provider semantic invocation before UAT. Every §6.5 family has both a positive or
  supported-shape case and its applicable disabled/forbidden/unavailable contrast. The local half is
  complete; the real-provider half remains blocked by network access.
- [ ] Evidence records exact source commit, corpus hash, command, counts, duration, and zero forbidden
  tool calls; failures include case ids without credentials or raw LINE identities.
- [ ] No UAT or Production action occurs without the mandatory deployment protocol and new immutable
  UAT evidence.

## 14. Baseline Evidence — 2026-08-19

This is pre-fix evidence, not completion evidence:

- API authoritative feature/permission suite: 33/33 passed. It proves a disabled feature returns
  `unsupported_module + FEATURE_NOT_ENABLED`, while a real permission gap remains
  `ERP_PERMISSION_DENIED`.
- AI Gateway deterministic turn + response-composer suites: 59/59 passed. They prove the legacy
  deterministic path has feature-off copy, but do not cover the orchestrated inventory path.
- Existing real-local-code fixture replay: 220/220 passed in 146 ms. It proves the current operator
  corpus executes, but has no tenant feature-off scenarios yet.
- Registry inventory executed locally: 60 tools total, 55 router-enabled, five build-disabled, and
  eight with no company feature gate. It proves the matrix above covers every current tool family.
- Direct local characterization of `InventoryAgent` with a real `FEATURE_NOT_ENABLED` tool result
  returned:

```json
{"status":"FAILED","summary":"ไม่สามารถดึงข้อมูลสต็อกได้ในขณะนี้","toolCalls":[{"name":"inventory.search_products","status":"unsupported_module","errorCode":"FEATURE_NOT_ENABLED"}]}
```

That last result is the reproduced defect this extension must turn into a truthful feature-disabled
answer. Exact commands and results are recorded in the linked task memory.

## 15. Post-Fix Local Evidence — 2026-08-19

- Full real-code orchestration replay with fixed read-only routing/ERP fixtures: 436/436 passed in
  104 ms. This includes 216 availability/failure cases, 83 noisy-language cases, and zero forbidden
  tool invocations. Corpus SHA-256:
  `c0b4ab4dcac776c4e43c8ef03aa2e91e9b7a1b9fdbe41c576643a27f18d51842`.
- Focused AI Gateway routing, executor, composition, availability, and deterministic-turn suites:
  146/146 passed.
- Focused API webhook, ledger replay, receipt follow-up, delegation, and authoritative tool-boundary
  suites: 137/137 passed.
- Corpus integrity: 2/2 passed. Contracts, AI Gateway, and API typechecks passed; `git diff --check`
  passed.
- AgentCore runtime HTTP spec cannot execute in this managed sandbox because binding `0.0.0.0`
  returns `EPERM`; the parser and wire changes compile, and the failed run is recorded rather than
  counted as a pass.
- Real-provider semantic invocation remains pending from a network-enabled terminal and is mandatory
  before UAT. No UAT or Production action was performed.
