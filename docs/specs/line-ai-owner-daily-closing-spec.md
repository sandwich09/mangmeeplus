# Feature: LINE AI Owner Daily Closing

## 1. Status

- Roadmap/checklist item: Active Cross-Cutting Production Gate — LINE AI Owner Daily Closing and Thai Business Vocabulary
- Owner: Product owner
- Date: 2026-08-17
- Status: Conditional named-pilot release approved; not general/capacity Production-ready

## 2. Goal

เมื่อผู้ประกอบการถามค่าใช้จ่ายรายวันหรือสิ่งที่ต้องจัดการก่อนปิดร้าน LINE AI ต้องคืนข้อมูลที่นำไปตรวจงานต่อได้จาก permission-checked ERP source: วันนี้เกิดอะไรขึ้น จ่ายแล้ว/ค้างเท่าไร อะไรถึงกำหนดวันนี้ อะไรรอตรวจ และอะไรมีหลักฐานหรือ duplicate blocker โดยไม่เดาข้อมูลที่ไม่อยู่ในระบบและไม่ทำ final mutation ใน LINE

## 3. Source Docs

- Feedback: [[../product/line-ai-owner-daily-closing-feedback-th|LINE AI สรุปค่าใช้จ่ายก่อนปิดร้าน]]
- Related specs: [[line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant]], [[line-ai-assistant-ux-spec|LINE AI Assistant UX]], [[expense-receipt-upload-spec|Expense Receipt Upload]], [[permission-matrix|Permission Matrix]], [[line-ai-production-parity-and-receipt-continuity-remediation-spec|Production Parity and Receipt Continuity]]
- Related plan: [[../plans/line-ai-owner-daily-closing-plan|LINE AI Owner Daily Closing Plan]]
- Architecture: AI Gateway calls governed ERP tools; it does not query expense repositories directly

## 4. Non-goals

- Payment, approval, confirmation, accounting posting or substitute-receipt issuance from LINE
- Inferring documents that never entered the system without an expected-document source of truth
- Combining amounts across currencies
- Replacing LINE OA verification with application code
- Building a keyword router that bypasses the existing semantic intake router
- Changing the 20-second timeout without hosted p95/p99 evidence

## 5. Users and Vocabulary

- Primary user: `ผปก` / `ผปก.` = ผู้ประกอบการ with effective owner/manager permission
- Business subjects: `คชจ` / `คชจ.` = ค่าใช้จ่าย; `ลค` / `ลค.` = ลูกค้า
- The glossary is bounded routing context, not authorization, evidence, numeric input or mutation authority
- Preserve the original user message for audit/trace; never rewrite stored text to expanded terms
- If an abbreviation has more than one credible business meaning in context, ask one bounded clarification

## 6. Main Journey

1. User asks `สรุปคชจ วันนี้`, `ผปก ต้องดูบิลอะไรตอนปิดร้าน`, or a semantically equivalent question.
2. Router selects `expense.get_daily_closing` using the full message, bounded glossary, tool catalog and conversation context.
3. API re-resolves current membership, company, branch scope, role, permission and entitlement.
4. API returns a bounded, internally consistent daily-closing snapshot.
5. LINE replies in this order: scope/date → occurred today → payment/outstanding → due end-of-day → review/blockers → honest unknowns → web actions.
6. User may ask a side question; the system answers it independently, then resumes an unambiguous pending media/substitute workflow within the existing 15-turn/15-minute context.

## 7. Tool Contract

Tool name: `expense.get_daily_closing`

### Input

```ts
{
  date?: 'YYYY-MM-DD';
  branchId?: string;
  detailLimit?: number; // server clamps to 1..10
}
```

- Missing date defaults to current date in company timezone; first release uses the existing `Asia/Bangkok` business-time contract.
- Branch override is accepted only when within the caller's effective scope.
- Required permission uses the existing expense read policy (`expense.read` or existing permitted own/related read variants); the API is authoritative.

### Output

```ts
type MoneyGroup = { currency: string; count: number; total: string };
type BoundedItems<T> = { total: number; shown: number; remaining: number; items: T[] };

type ExpenseDailyClosing = {
  date: string;
  timezone: string;
  scope: { kind: 'all_branches' | 'restricted_branches' | 'selected_branch'; branchId?: string };
  occurredToday: {
    totals: MoneyGroup[];
    paid: MoneyGroup[];
    outstanding: MoneyGroup[];
    items: BoundedItems<DailyClosingItem>;
  };
  submittedToday: { count: number };
  dueEndOfDay: { totals: MoneyGroup[]; items: BoundedItems<DailyClosingItem> };
  overdue: { totals: MoneyGroup[]; items: BoundedItems<DailyClosingItem> };
  unscheduledOutstanding: { totals: MoneyGroup[]; items: BoundedItems<DailyClosingItem> };
  pendingReview: { count: number; items: BoundedItems<DailyClosingItem> };
  evidenceBlockers: { count: number; items: BoundedItems<DailyClosingItem> };
  duplicateRisks: { count: number; items: BoundedItems<DailyClosingItem> };
  excluded: { rejected: number; voided: number };
  observability: { queryDurationMs: number; queryCount: number; truncated: boolean };
  limitations: { neverSubmittedDocumentsObservable: false };
  webUrl: string;
};
```

`DailyClosingItem` contains only permission-visible fields needed for action: opaque expense id, expense number, vendor/payee display value when present, category display value when present, expense date, due date, currency, total, paid amount, outstanding amount, expense status, payment status, evidence/duplicate flags and a scoped web detail URL. It must not expose raw attachment keys, OCR text, PII beyond the existing permitted expense response, or unrelated company data.

## 8. Deterministic Bucket Rules

All time boundaries use `[startOfDay, nextStartOfDay)` in the declared timezone.

- `occurredToday`: active expense whose `expenseDate` is in the requested day
- `submittedToday`: expense whose `uploadedAt` is in the requested day; this is not merged with occurred today
- active expense excludes `REJECTED` and `VOIDED`
- `paid`: stored paid amount from `PAID` and `PARTIALLY_PAID` records when amount > 0; `outstanding` uses stored outstanding amount and includes `UNPAID`/`PARTIALLY_PAID` only when amount > 0
- `dueEndOfDay`: active outstanding expense with due date equal to requested date
- `overdue`: active outstanding expense with due date before requested date
- `unscheduledOutstanding`: active outstanding expense with no due date; it must not be described as “ต้องจ่ายวันนี้”
- `pendingReview`: `EXTRACTING`, `NEEDS_REVIEW`, `READY_FOR_CONFIRMATION`, or other existing non-final review status explicitly mapped by domain contract
- `evidenceBlockers`: observable source-state blocker such as no primary attachment and no accepted missing-receipt reason, or evidence status that requires review; never claim that an unseen external bill is missing
- `duplicateRisks`: existing possible/confirmed duplicate state; never invent similarity from display text
- every money aggregation groups by ISO currency; no grand total across currencies and no hard-coded `บาท`
- count, totals and details must come from one logical snapshot; detail truncation always declares total/shown/remaining

## 9. Response Contract

Thai response must remain factual and concise enough for LINE:

1. `สรุปปิดร้านวันที่ …` plus company/branch scope understandable to the caller
2. `ค่าใช้จ่ายที่เกิดวันนี้` with count/totals by currency and bounded item lines
3. `จ่ายแล้ว / ยังค้าง` by currency
4. `ถึงกำหนดวันนี้` separated from `เกินกำหนด` and `ยังไม่มีกำหนดจ่าย`
5. `รอตรวจ` / `หลักฐานต้องตาม` / `เสี่ยงซ้ำ`
6. limitation: ระบบไม่สามารถรู้บิลที่ไม่เคยส่งเข้าระบบได้
7. read-only web actions such as ดูรายการค้างจ่าย, ตรวจเอกสาร, ดูรายการทั้งหมด

The composer may improve phrasing but must preserve values, currencies, bucket names, counts, scope and limitations from tool data. Deterministic fallback must support the entire contract.

## 10. Media and Conversation Continuity

- A single handwritten cash bill may proceed only under the current deterministic capture eligibility; ambiguous dates/fields remain review-required.
- A ledger, phone screenshot or note containing multiple rows/totals must not become one expense automatically. Reply with a bounded choice: `สรุปหลายรายการ` / `เอกสารค่าใช้จ่ายรายการเดียว` / `ภาพประกอบ`.
- If user chooses multiple entries, first release stores no expense until a supported multi-entry contract exists; provide a web/review handoff and preserve the source attachment.
- User may answer missing fields through text across multiple messages. Only validated safe draft fields are consumed; one answer does not clear unrelated unknown fields.
- A side question is answered independently, then a unique pending workflow receives a deterministic resume capsule. Multiple pending workflows require selection.
- Exactly 15 turns/15 minutes of prompt context; typed business draft lifetime remains source-owned and is not extended by chat history.

## 11. Security, Audit and Observability

- API re-authorizes every tool invocation; current company/branch/own/related scope is applied at query time
- No cross-tenant cache; cache key, if later introduced, includes user, company, branch scope, permission revision, date and currency semantics
- Emit bounded tool duration, query count, returned/detail count, truncation and normalized outcome; never log raw LINE id, OCR text or media
- Avoid unbounded history scans and model/tool fan-out. One daily-closing tool call is the expected happy path.
- Release candidate must record identical ECS source/image/contract and AgentCore artifact/version/qualifier from UAT through Production

## 12. LINE OA Named Pilot Policy

- The owner accepts the unverified-account banner temporarily only for `Mangmee Plus Owner Pilot – 2026-08-16`.
- Real pilot identities are enumerated in protected release evidence, never in git.
- This exception does not waive signature verification, account linking, tenant/permission checks, immutable candidate gates or visible refusal behavior.
- Customer-wide `OPEN` remains prohibited until OA verification policy is accepted for that audience. The named pilot may be the only customer-acceptance subject for this release.

### Conditional hosted-concurrency deferment — owner directive 2026-08-17

- Approval reference: `OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONCURRENCY-DEFERRED`.
- The owner explicitly defers only the hosted concurrency p95/p99 run until after conditional
  named-pilot `OPEN`. This records `DEFERRED`, never `PASS`; it does not authorize a general-capacity
  or customer-wide Production-ready claim.
- The 20-second timeout remains unchanged. The measured local worst case remains `19,778 ms`, so the
  conditional release carries a known tail-latency/timeout risk.
- Immutable hosted candidate identity, role/tenant security, real pilot smoke, persisted-state and
  accepted-inbound reconciliation, forced failure and paired rollback remain pre-`OPEN` gates.
- After `OPEN`, run the deferred hosted concurrency evidence against the same release. Any unexplained
  timeout, duplicate mutation, permission leak or unreconciled terminal outcome immediately closes the
  customer gate and invokes the paired rollback path.

## 13. Acceptance Criteria

- [x] `ผปก`, `คชจ`, `ลค` route semantically in Thai regression and real-provider tests without keyword bypass.
- [ ] Same question under owner/manager/accounting/staff and cross-company attack cases returns only authorized scope.
- [x] Daily closing separates expense date, upload date, due today, overdue and missing due date.
- [x] Rejected/voided records never enter active counts/totals/details.
- [x] Partial payments use outstanding amount; multi-currency is never summed or labeled as THB implicitly.
- [x] Details are bounded and disclose truncation.
- [x] Unknown never-submitted documents are disclosed as unobservable, not reported as zero.
- [x] Handwritten multi-entry media never creates one automatic expense.
- [x] Partial text answers and intervening questions preserve/resume the correct pending workflow within 15 turns.
- [x] Focused unit/integration/security tests and a real local configured-provider conversation pass.
- [ ] Persisted-state reconciliation, forced failure/rollback and exact hosted candidate identity pass before conditional `OPEN`.
- [ ] Hosted UAT concurrency p95/p99 is deferred under
      `OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONCURRENCY-DEFERRED`; it remains open after the conditional
      release and must not be reported as `PASS`.
- [ ] Signed UAT, READY and Production run ids plus named-pilot customer `OPEN` acceptance are recorded.

## 14. Open Questions

- A future expected-document/checklist module is required before the system can truthfully report bills that were never submitted.
- Customer-wide OA readiness after the named pilot remains an operational owner decision separate from this implementation.
