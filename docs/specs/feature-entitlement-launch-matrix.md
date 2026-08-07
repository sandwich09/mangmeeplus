# FEATURE_LAUNCH_MATRIX — feature-entitlement decoupling (F0)

> Generated 2026-07-31 (F0.B).
> Inventory HEAD `ba91c102` (lane S1-S5 capture) · repo HEAD at assembly `42be7299` (adds only the S1-S5 inventory docs).
> Method: assembled from f0 lane JSONs by deterministic join + conservative §6.3 overlay. No row was decided by hand; every
> policy value is produced by the published rule table below. Unresolved rows are explicit `BLOCKED` with an evidence owner
> and keep their route CLOSED (Spec §6.3 line 326, Plan F0 line 29).
> Machine-readable siblings: `runoff-matrix.json`, `launch-matrix.json` (F0 scratch, regenerate with `assemble.mjs`/`emit.mjs`).

> **OWNER DECISION 2026-08-04 — THE `Close preflight` COLUMN NO LONGER GATES A DISABLE.** "ควรปิดได้และหยุดทำงาน แต่ถ้ามีข้อมูลเดิมค้างก็แค่ปิดไว้ไม่บล็อค": post-onboarding DISABLE of any sellable family is ALLOWED with FREEZE-IN-PLACE semantics, so every `BLOCKED — N of M runoff rows unresolved` cell in §2 (and the "blocker for **every** disable" note under it) is superseded as an ADMISSION rule and stands only as the F0 surface-coverage survey. `runoffPreflight`, `IN_SCOPE_FAMILIES` and the `feature_disable_pending_runoff` 422 are deleted; the only remaining disable refusals are the platform invariants (`employee_access`, `company_settings`, including their submenus) and the dependency cascade. See `feature-entitlement-decoupling-spec.md` §1 and `feature-entitlement-runoff-matrix.md`. This column is the runoff/disable plane ONLY — the `FeatureLaunchGate` OPEN/CLOSED plane below is untouched and the three WHT specialist routes stay CLOSED.

Normative parent: `docs/specs/feature-entitlement-decoupling-spec.md` §6.1 (lines 266-275), §6.2 and AC29 (line 452).
`gateKey` and `routeKey` are separate validated fields; the `gateKey/routeKey` spelling below is documentation shorthand
only (spec:275). Operational route rows are internal deploy controls, never SKUs or customer settings (plan:29).

## 1. Seed-state summary

| | Rows |
|---|---|
| Sellable feature `DEFAULT` rows — routeClass `ORDINARY`, seeded **OPEN** | 16 |
| Hidden operational route rows — routeClass `SPECIALIST_LEGAL`, seeded **CLOSED** | 6 |
| of those, exact WHT SYSTEM routes | 3 |
| of those, gate namespaces whose route catalog is not yet enumerable | 2 |
| of those, permanently CLOSED in v5.1 (`[LATER]`) | 1 |
| Rows with status **BLOCKED** (catalog not enumerable) | 2 |
| **Total** | **22** |

The 16 sellable `DEFAULT` rows are the 18 top-level feature keys minus the two platform invariants `employee_access` and
`company_settings`, which are ON for active companies and outside commercial toggles (spec:261-262). They seed OPEN because
each is proven live today and F2 grandfathers existing effective access without charge or customer action (spec:236, plan:230).

## 2. Sellable feature DEFAULT rows (ORDINARY, seeded OPEN)

| gateKey | routeKey | Class | Seed | Specialist approval | Close preflight | Friendly fallback | Status |
|---|---|---|---|---|---|---|---|
| `inventory` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 5 of 25 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดระบบสต๊อก | RESOLVED |
| `product_catalog` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 12 of 12 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดระบบสินค้า/บริการ | RESOLVED |
| `sales_documents` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 4 of 31 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดระบบเอกสารขาย | RESOLVED |
| `expenses` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 4 of 53 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดระบบค่าใช้จ่าย | RESOLVED |
| `reimbursement` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 4 of 29 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดระบบเบิกคืนเงิน | RESOLVED |
| `double_entry_ledger` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 4 of 33 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดระบบบัญชีคู่ | RESOLVED |
| `expense_auto_post` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 3 of 3 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดการลงบัญชีอัตโนมัติ | RESOLVED |
| `thai_tax` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 10 of 50 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดระบบภาษี | RESOLVED |
| `procurement` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 7 of 60 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดระบบจัดซื้อ | RESOLVED |
| `bank_reconciliation` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 5 of 34 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดระบบกระทบยอดธนาคาร | RESOLVED |
| `crm` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 11 of 113 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดระบบลูกค้า | RESOLVED |
| `dashboard_notifications` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 1 of 33 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เปิดการแจ้งเตือน | RESOLVED |
| `ai_line_assistant` | `DEFAULT` | ORDINARY | **OPEN** | no | CLEAR | ยังไม่ได้เปิดผู้ช่วย AI | RESOLVED |
| `line_oa` | `DEFAULT` | ORDINARY | **OPEN** | no | BLOCKED — 2 of 11 runoff rows unresolved (spec:326: anything not explicitly covered is a disable-preflight blocker) | ยังไม่ได้เชื่อมต่อ LINE | RESOLVED |
| `reports` | `DEFAULT` | ORDINARY | **OPEN** | no | CLEAR | ยังไม่ได้เปิดรายงาน | RESOLVED |
| `workflow_automation` | `DEFAULT` | ORDINARY | **OPEN** | no | CLEAR | ยังไม่ได้เปิดระบบอัตโนมัติ | RESOLVED |

A further **102 BLOCKED runoff rows are not attributable to any feature** (AI_GATEWAY_PLANE 24, NONE 22, UNMAPPED 37, UNRESOLVED 17, UNGATED 1, PLATFORM_CONTROL_PLANE 1).
Those rows carry no owning feature today, so they are a preflight blocker for **every** disable rather than for one row. The AI
gateway plane bucket is why `ai_line_assistant`/DEFAULT shows a CLEAR per-feature preflight while AI disable is still not provably
safe: its gateway routes declare no feature ownership at all (spec:333, AC22).

### 2.1 Per-row detail

**`inventory` / `DEFAULT`** — validation evidence: AC19, AC21, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=inventory, routeKey=DEFAULT, generation) stamped on every inventory root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: block new manual stock roots; only stock compensation required by a snapshotted source document continues (§6.3 r8)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`product_catalog` / `DEFAULT`** — validation evidence: AC18, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=product_catalog, routeKey=DEFAULT, generation) stamped on every product_catalog root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: no §6.3 family row exists for product_catalog — close behaviour undefined (see BLOCKED register)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`sales_documents` / `DEFAULT`** — validation evidence: AC20, AC23, AC26, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=sales_documents, routeKey=DEFAULT, generation) stamped on every sales_documents root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: block new sales roots; receive/void payment, required receipt/credit/void child and correction continue (§6.3 r3)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`expenses` / `DEFAULT`** — validation evidence: AC1, AC5, AC12, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=expenses, routeKey=DEFAULT, generation) stamped on every expenses root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: block new expense roots; approve/reject, duplicate resolve, confirm/void and required settlement/compensation continue (§6.3 r4)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`reimbursement` / `DEFAULT`** — validation evidence: AC12, AC25-FIN, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=reimbursement, routeKey=DEFAULT, generation) stamped on every reimbursement root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: block new claims; approve/reject, finance review, payout/void and projection compensation continue (§6.3 r5)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`double_entry_ledger` / `DEFAULT`** — validation evidence: AC3, AC4, AC6, AC7, AC16, AC23, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=double_entry_ledger, routeKey=DEFAULT, generation) stamped on every double_entry_ledger root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: block new manual roots; required posting/reversal and draft-return completion continue (§6.3 r7)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`expense_auto_post` / `DEFAULT`** — validation evidence: AC3, AC15, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=expense_auto_post, routeKey=DEFAULT, generation) stamped on every expense_auto_post root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: no §6.3 row covers automatic posting drain; dependency on double_entry_ledger is imperative-only (S1 anomaly A1)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`thai_tax` / `DEFAULT`** — validation evidence: AC2, AC5, AC7, AC8, AC9, AC10, AC11, AC28, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=thai_tax, routeKey=DEFAULT, generation) stamped on every thai_tax root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: block new manual tax roots; required posting/reversal, draft-return completion and filing/correction task within cutover/period rules continue (§6.3 r7); retained-artifact WHT/VAT compensation stays reachable (§6.2 lines 295-306)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`procurement` / `DEFAULT`** — validation evidence: AC5, AC23, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=procurement, routeKey=DEFAULT, generation) stamped on every procurement root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: block new procurement roots; required GR/bill/payment/void child explicitly linked to the snapshotted root continues (§6.3 r6)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`bank_reconciliation` / `DEFAULT`** — validation evidence: AC7, AC25-FIN, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=bank_reconciliation, routeKey=DEFAULT, generation) stamped on every bank_reconciliation root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: block new imports; finish/undo matching for snapshotted statement lines continues (§6.3 r9)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`crm` / `DEFAULT`** — validation evidence: AC13, AC14, AC18, AC20, AC22, AC25-CRM, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=crm, routeKey=DEFAULT, generation) stamped on every crm root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: stop/suppress customer outbound immediately; staff view/handoff only, inbound capture continues (§6.3 r1, §6.2 line 281)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`dashboard_notifications` / `DEFAULT`** — validation evidence: AC21, AC25-WF, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=dashboard_notifications, routeKey=DEFAULT, generation) stamped on every dashboard_notifications root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: skip/suppress delivery immediately; evidence view only, never replayed automatically (§6.3 r2)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`ai_line_assistant` / `DEFAULT`** — validation evidence: AC13, AC22, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=ai_line_assistant, routeKey=DEFAULT, generation) stamped on every ai_line_assistant root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: stop AI/autonomy immediately and hand off to staff; expense upload path keeps working (§6.3 r1, AC13)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`line_oa` / `DEFAULT`** — validation evidence: AC13, AC25-CRM, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=line_oa, routeKey=DEFAULT, generation) stamped on every line_oa root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: stop every company-OA customer outbound immediately; shared-OA staff notification is unaffected (§6.3 r1, §6.2 line 286)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`reports` / `DEFAULT`** — validation evidence: AC26, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=reports, routeKey=DEFAULT, generation) stamped on every reports root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: stop new report execution/export; already generated immutable artifacts stay readable under retention policy (§6.3 r10)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

**`workflow_automation` / `DEFAULT`** — validation evidence: AC21, AC27 + plan:218 enable→disable→enable e2e per sellable feature on a migrated e2e DB; plan:215-221 api/contracts/ai-gateway/workers/web test+typecheck+build; plan:227 HARD GATES (matrices approved, Foundation exit green, feature survey/shadow/privacy evidence reviewed)
- Work vector: (gateKey=workflow_automation, routeKey=DEFAULT, generation) stamped on every workflow_automation root/final mutation, queued async item and outbound dispatch token (spec:36, spec:307 fresh availability-vector guard)
- Close behaviour: skip/suppress workflow execution immediately; skipped evidence retained, never replayed automatically (§6.3 r2)
- Resume/Reissue: RESUME mints a current-generation vector for blocked roots; queued external sends require explicit REISSUE and never auto-replay (spec:307, spec:36)
- Evidence: spec:243-262 (feature map); seeded OPEN because the feature is proven live today and F2 grandfathers existing effective access (spec:236, plan:230)

## 3. Hidden operational route rows (all seeded CLOSED)

| gateKey | routeKey | Class | Seed | Specialist approval | Status | Evidence owner |
|---|---|---|---|---|---|---|
| `cap.wht50bis` | `SYSTEM_INITIAL_ISSUE` | SPECIALIST_LEGAL | **CLOSED** | yes (per exact row) | RESOLVED | — |
| `cap.wht50bis` | `SYSTEM_CONTENT_CORRECTION` | SPECIALIST_LEGAL | **CLOSED** | yes (per exact row) | RESOLVED | — |
| `cap.wht50bis` | `SYSTEM_REPLACEMENT_COPY` | SPECIALIST_LEGAL | **CLOSED** | yes (per exact row) | RESOLVED | — |
| `cap.thai_tax.external_filing_correction` | `<formType:correctionRoute:channelVersion> (namespace — catalog not enumerable)` | SPECIALIST_LEGAL | **CLOSED** | yes (per exact row) | **BLOCKED** | FIN |
| `cap.thai_tax.vat_scope_credit_transfer` | `<transitionKind> (namespace — catalog not enumerable)` | SPECIALIST_LEGAL | **CLOSED** | yes (per exact row) | **BLOCKED** | FIN |
| `[LATER] cap.thai_tax.vat_credit_in_product_offset` | `DEFAULT` | SPECIALIST_LEGAL | **CLOSED** | yes (per exact row) | RESOLVED | — |

No specialist/legal row is ever seeded anything but CLOSED. A failed or unreviewed row stays CLOSED without holding a
sibling, and its manual/prefilled fallback remains usable (plan:227, spec:273).

### 3.1 Per-row detail

#### `cap.wht50bis` / `SYSTEM_INITIAL_ISSUE`

- Seed state: **CLOSED** · route class SPECIALIST_LEGAL · specialist approval required: yes · status: RESOLVED
- Validation evidence required before OPEN: AC9 (no request/number/PDF before a qualifying positive-WHT SETTLED event; CLOSED path settles payment + exactly one durable handoff) + statutory render fixture + Thai-tax specialist sign-off for this exact row (plan:227, plan:239); internal-only control-plane OPEN with environment, immutable build/release id, expected generation, release-owner approval, exact matrix evidence reference/hash and specialist approval (spec:452 AC29, plan:38)
- Work vector: (gateKey=cap.wht50bis, routeKey=SYSTEM_INITIAL_ISSUE, generation) stamped on the certificate command/artifact and its dispatch token; system initial 50 ทวิ number/PDF/delivery for a payment-owning source feature (spec:294)
- Close behaviour (fallback that stays live): payment still settles; create EXTERNAL_CERTIFICATE_REQUIRED handoff without blocking payment (spec:293)
- Friendly fallback: ระบบจะออกหนังสือรับรองหัก ณ ที่จ่ายให้ภายนอก แล้วแนบเข้ามาได้
- Resume/Reissue: REISSUE only — an explicit current-generation Reissue mints a new vector; opening the route never converts or replays an existing EXTERNAL artifact (spec:36, plan:228)
- Evidence: spec:268 (fixed catalog of the three WHT SYSTEM routes); plan:227 (required rollout order: fallbacks E2E → initial issue → content correction → replacement copy)

#### `cap.wht50bis` / `SYSTEM_CONTENT_CORRECTION`

- Seed state: **CLOSED** · route class SPECIALIST_LEGAL · specialist approval required: yes · status: RESOLVED
- Validation evidence required before OPEN: AC11 (SYSTEM correction under expected-active CAS; notice + corrected delivery) + statutory render fixture + specialist sign-off for this exact row; internal-only control-plane OPEN with environment, immutable build/release id, expected generation, release-owner approval, exact matrix evidence reference/hash and specialist approval (spec:452 AC29, plan:38)
- Work vector: (gateKey=cap.wht50bis, routeKey=SYSTEM_CONTENT_CORRECTION, generation) stamped on the certificate command/artifact and its dispatch token; SYSTEM new-number/PDF for corrected 50 ทวิ content (spec:298)
- Close behaviour (fallback that stays live): accept an immutable corrected EXTERNAL artifact with a registered new number; cancellation without a replacement PDF needs no SYSTEM route (spec:298)
- Friendly fallback: ระบบจะออกหนังสือรับรองหัก ณ ที่จ่ายให้ภายนอก แล้วแนบเข้ามาได้
- Resume/Reissue: REISSUE only — an explicit current-generation Reissue mints a new vector; opening the route never converts or replays an existing EXTERNAL artifact (spec:36, plan:228)
- Evidence: spec:268 (fixed catalog of the three WHT SYSTEM routes); plan:227 (required rollout order: fallbacks E2E → initial issue → content correction → replacement copy)

#### `cap.wht50bis` / `SYSTEM_REPLACEMENT_COPY`

- Seed state: **CLOSED** · route class SPECIALIST_LEGAL · specialist approval required: yes · status: RESOLVED
- Validation evidence required before OPEN: AC9/AC11 (`ใบแทน` keeps identity/number/statutory-content hash; one statutory golden fixture) + specialist sign-off for this exact row; internal-only control-plane OPEN with environment, immutable build/release id, expected generation, release-owner approval, exact matrix evidence reference/hash and specialist approval (spec:452 AC29, plan:38)
- Work vector: (gateKey=cap.wht50bis, routeKey=SYSTEM_REPLACEMENT_COPY, generation) stamped on the certificate command/artifact and its dispatch token; SYSTEM same-content ใบแทน copy artifact (spec:299)
- Close behaviour (fallback that stays live): produce/replay the external replacement-copy handoff/link with the same statutory hash and no re-key (spec:299, AC9)
- Friendly fallback: ระบบจะออกหนังสือรับรองหัก ณ ที่จ่ายให้ภายนอก แล้วแนบเข้ามาได้
- Resume/Reissue: REISSUE only — an explicit current-generation Reissue mints a new vector; opening the route never converts or replays an existing EXTERNAL artifact (spec:36, plan:228)
- Evidence: spec:268 (fixed catalog of the three WHT SYSTEM routes); plan:227 (required rollout order: fallbacks E2E → initial issue → content correction → replacement copy)

#### `cap.thai_tax.external_filing_correction` / `<formType:correctionRoute:channelVersion> (namespace — catalog not enumerable)`

- Seed state: **CLOSED** · route class SPECIALIST_LEGAL · specialist approval required: yes · status: **BLOCKED**
- Validation evidence required before OPEN: AC10 + AC10 authority closure (exact-revision, route-policy-allowed append-only WhtCorrectionAuthorityOutcome with terminalEffect=COMPLETE_RETURN_BRANCH; DATABASE_UPDATE_VERIFIED for ป.ป.01/ป.ป.02, EFILING_ACCEPTED_VERIFIED for negative additional) + per-tuple Thai-tax specialist approval (plan:227, plan:239) — and, before any of that, an enumerable tuple catalog
- Work vector: (gateKey=cap.thai_tax.external_filing_correction, routeKey=<formType:correctionRoute:channelVersion>, generation) stamped on the correction revision, packet hash and submission/dispatch token (tax-spec:1886)
- Close behaviour (fallback that stays live): preserve/download the reviewed packet and use the evidence-backed manual external task; manual RECORDED_EXTERNAL succeeds with “ระบบไม่ได้ยื่นหรือยืนยันการรับแบบ”; a closed/unknown tuple reuses the same prepared packet and denies any system RD-acceptance claim (spec:302, tax-spec:1203, tax-spec:2228)
- Friendly fallback: ระบบเตรียมเอกสารให้ครบ แล้วยื่นกับสรรพากรเองได้เลย
- Resume/Reissue: REISSUE only; a route opening later never resubmits or reclassifies an existing manual record (tax-spec:1203)
- **BLOCKED (catalog)** — evidence owner **FIN**: BLOCKED-catalog: the exact tuple set the classifier emits is not enumerable from the spec. `formType` and a route enum exist, but (a) the spec names two different route enums and does not say which one keys the tuple, and (b) `channelVersion` is data-driven (a versioned local-office / e-Filing channel decision carried on TaxRuleSource), so no static catalog exists. Nothing in packages/contracts or apps/api implements any of these fields yet (grep: 0 hits).
- Partial known catalog (verbatim from the tax spec; nothing below is invented, and no tuple is treated as OPEN-able):
  - `formType`: `PND3`, `PND53` — tax-spec:1224 (WhtCertificate.formType), tax-spec:1665, tax-spec:1680
  - `routeKind (WhtCorrectionAuthorityOutcome)`: `PP01_AREA_REQUEST`, `PP02_AREA_REQUEST`, `EFILING_ADDITIONAL_NEGATIVE` — tax-spec:1497
  - `returnCorrectionType (classifier output)`: `DATA_PP01`, `FORM_PP02_REVIEW`, `ADDITIONAL_POSITIVE`, `ADDITIONAL_NEGATIVE`, `OVERSTATED_REFUND_REVIEW`, `TAX_REVIEW_REQUIRED` — tax-spec:1418; only DATA_PP01, FORM_PP02_REVIEW and ADDITIONAL_NEGATIVE have an authority-outcome completion path (tax-spec:1518)
  - `channelVersion`: *(no enumerable values in the spec)* — tax-spec:260, tax-spec:1524 — pinned per ACTIVE TaxRuleSource (validationDecision=VERIFIED, sourceStatus=ACTIVE, validUntil); versioned separately from form eligibility (tax-spec:1526). Not a static enum.
  - `partialTupleGrid`: `PND3:PP01_AREA_REQUEST:<channelVersion>`, `PND3:PP02_AREA_REQUEST:<channelVersion>`, `PND3:EFILING_ADDITIONAL_NEGATIVE:<channelVersion>`, `PND53:PP01_AREA_REQUEST:<channelVersion>`, `PND53:PP02_AREA_REQUEST:<channelVersion>`, `PND53:EFILING_ADDITIONAL_NEGATIVE:<channelVersion>`
- Evidence: spec:269, spec:302; tax-spec:9, tax-spec:260, tax-spec:1203, tax-spec:1418, tax-spec:1497, tax-spec:1886, tax-spec:2228

#### `cap.thai_tax.vat_scope_credit_transfer` / `<transitionKind> (namespace — catalog not enumerable)`

- Seed state: **CLOSED** · route class SPECIALIST_LEGAL · specialist approval required: yes · status: **BLOCKED**
- Validation evidence required before OPEN: AC7 (per-scope credit CAS; disjoint canonical partition generations; conservation matrix) + one nonzero transition kind validated by the Thai-tax specialist (plan:239) — and, before any of that, a canonical transitionKind enum
- Work vector: (gateKey=cap.thai_tax.vat_scope_credit_transfer, routeKey=<transitionKind>, generation) persisted on VatCreditScopeTransfer.routeKey + routeGeneration + availabilityDecisionRef (tax-spec:770-772)
- Close behaviour (fallback that stays live): evidence-backed external outcome remains available whether the row is OPEN, CLOSED or missing; nonzero credit becomes TAX_REVIEW_REQUIRED in one prefilled task and finalizes as RECORDED_EXTERNAL; never claims RD acceptance (spec:303, tax-spec:715, tax-spec:879)
- Friendly fallback: ยอดภาษีคงเหลือจะยกไปตามที่บัญชีตกลงกับสรรพากร
- Resume/Reissue: REISSUE only; opening a route later never converts or replays an existing external result and result-specific corrections never switch its kind (tax-spec:717)
- **BLOCKED (catalog)** — evidence owner **FIN**: BLOCKED-catalog: no canonical `transitionKind` enum exists in the tax spec or in code (grep over packages/ and apps/: 0 hits). Only the scope kinds and the branch-filing policies that produce them are enumerated; the spec never states whether a transitionKind is an ordered (fromScopeKind → toScopeKind) pair, a policy-change kind, or a named subset.
- Partial known catalog (verbatim from the tax spec; nothing below is invented, and no tuple is treated as OPEN-able):
  - `scopeKind`: `HEAD_OFFICE`, `CONSOLIDATED`, `BRANCH`, `CONFIGURED_GROUP` — tax-spec:380, tax-spec:1633
  - `branchFilingPolicy`: `HEAD_OFFICE_ONLY`, `ALL_BRANCHES`, `PER_BRANCH`, `SELECTED_BRANCHES`, `MAIN_ONLY (deprecated)`, `CONFIGURED (deprecated)` — tax-spec:229, normalized to scopeKind at tax-spec:413-416
  - `namedTransitionsInSpec`: `consolidated → per-branch`, `branch move`, `branch-set change`, `policy change after filing` — tax-spec:419 (test list) — named as test cases, never as canonical transitionKind identifiers
- Evidence: spec:270, spec:303; tax-spec:715, tax-spec:717, tax-spec:723, tax-spec:736, tax-spec:770-772, tax-spec:879, tax-spec:1907

#### `[LATER] cap.thai_tax.vat_credit_in_product_offset` / `DEFAULT`

- Seed state: **CLOSED** · route class SPECIALIST_LEGAL · specialist approval required: yes · status: RESOLVED
- Validation evidence required before OPEN: NONE — there is no OPEN path in v5.1. Opening requires a separately confirmed v6 PP30-only mutation spec/plan; specialist review alone cannot open it (plan:227, spec:304).
- Work vector: none in v5.1 — the candidate is retained in one prefilled no-mutation task and stamps no work vector (spec:304, AC7)
- Close behaviour (fallback that stays live): retain all evidence in one prefilled no-mutation task; allow only the proven EXTERNAL_UNMODELED route; both current heads stay unchanged (spec:304, tax-spec:879, tax-spec:2236)
- Friendly fallback: เก็บเรื่องนี้ไว้ให้บัญชีตรวจก่อน ยังไม่ตัดยอดอัตโนมัติ
- Resume/Reissue: NONE in v5.1
- Evidence: spec:271, spec:304, spec:424 (AC7: no OPEN acceptance path in v5.1); plan:227

## 4. Rollout order (plan §8.3, line 227)

1. **F0** — these two matrices approved (this file + `feature-entitlement-runoff-matrix.md`).
2. All CLOSED fallbacks / global-hub paths E2E: initial EXTERNAL, corrected EXTERNAL, EXTERNAL `ใบแทน`, manual filed-correction packet, external VAT transition.
3. `cap.wht50bis/SYSTEM_INITIAL_ISSUE`.
4. `cap.wht50bis/SYSTEM_CONTENT_CORRECTION`.
5. `cap.wht50bis/SYSTEM_REPLACEMENT_COPY`.
6. Validated `cap.thai_tax.vat_scope_credit_transfer/<transitionKind>` rows.
7. `cap.thai_tax.external_filing_correction/<formType:correctionRoute:channelVersion>` automation **last**.

`[LATER] cap.thai_tax.vat_credit_in_product_offset` cannot open under this plan even after specialist review; it requires a
separately confirmed v6 PP30-only mutation spec/plan (plan:227). Promotion is environment/build scoped only — development/test →
staging → production, with no tenant cohort, percentage flag or per-customer route override (plan:228, AC29). Every OPEN records
environment, immutable build/release id, expected generation and release-owner approval; specialist/legal rows additionally record
the exact current matrix evidence reference/hash and specialist approval (plan:38, spec:452). An authorized on-call may emergency
CLOSE one exact row with incident/audit; reopen follows the full fresh OPEN path (plan:38, plan:228).

A whole feature closes only when its own `DEFAULT` row or a proven shared feature invariant fails; a route-specific breach
increments only that route's generation (plan:228). Note that every sellable `DEFAULT` row currently carries a **BLOCKED disable
preflight** from the runoff matrix — OPEN is safe today, but *closing* a feature is gated on its BLOCKED runoff rows (spec:326).

## 5. AC crosswalk (Spec §10 → matrix rows)

Row-key patterns, not exhaustive row lists, per the §10 preamble (spec:416). `RM:` = RUNOFF_MATRIX row selector, `LM:` = this file.

| AC | Owner | Affected matrix rows |
|---|---|---|
| AC1 | FIN | LM: `expenses`/DEFAULT, `ai_line_assistant`/DEFAULT, `thai_tax`/DEFAULT, `double_entry_ledger`/DEFAULT · RM: featureKey=expenses AND surfaceKind=API (upload/OCR/confirm), AI_TOOL expenses.* |
| AC2 | FIN | LM: `thai_tax`/DEFAULT, `double_entry_ledger`/DEFAULT · RM: featureKey=thai_tax (all classes) + featureKey=double_entry_ledger ROOT/FINAL |
| AC3 | FIN | LM: `double_entry_ledger`/DEFAULT, `expense_auto_post`/DEFAULT · RM: featureKey=expense_auto_post (all rows, currently BLOCKED), double_entry_ledger FINAL post/reverse |
| AC4 | FIN | LM: `double_entry_ledger`/DEFAULT · RM: featureKey=double_entry_ledger surfaceKind=API ROOT_MUTATION |
| AC5 | FIN | LM: `expenses`, `procurement`, `thai_tax`/DEFAULT · RM: featureKey∈{expenses,procurement} FINAL_MUTATION |
| AC6 | FIN | LM: `double_entry_ledger`/DEFAULT · RM: featureKey=double_entry_ledger (chart/account-role surfaces) |
| AC7 | FIN | LM: `thai_tax`/DEFAULT, `bank_reconciliation`/DEFAULT, `cap.thai_tax.vat_scope_credit_transfer`/*, `[LATER] cap.thai_tax.vat_credit_in_product_offset` · RM: featureKey=thai_tax FINAL_MUTATION + featureKey=bank_reconciliation FINAL_MUTATION |
| AC8 | FIN | RM: rows whose permissionKeys include `company.vat_registration.*` (ALLOWED_WHILE_OFF) · LM: `company_settings` is a platform invariant, so no DEFAULT row exists |
| AC9 | FIN | LM: `cap.wht50bis`/SYSTEM_INITIAL_ISSUE, /SYSTEM_REPLACEMENT_COPY · RM: featureKey=thai_tax WHT surfaces + rows whose permissionKeys include `wht.certificate.read` |
| AC10 (+authority closure) | FIN | LM: `cap.thai_tax.external_filing_correction` namespace row (**BLOCKED-catalog**) · RM: featureKey=thai_tax FINAL_MUTATION filing/correction surfaces |
| AC11 | FIN | LM: `cap.wht50bis`/SYSTEM_CONTENT_CORRECTION, /SYSTEM_REPLACEMENT_COPY · RM: featureKey=thai_tax certificate correction/void rows |
| AC12 | FIN | LM: `reimbursement`/DEFAULT (and its independence from `expenses`/DEFAULT) · RM: featureKey=reimbursement (all classes) |
| AC13 | CRM | LM: `ai_line_assistant`/DEFAULT, `line_oa`/DEFAULT, `expenses`/DEFAULT · RM: featureKey∈{ai_line_assistant,line_oa} all classes + ASYNC LINE/webhook rows |
| AC14 | CRM | LM: `crm`/DEFAULT · RM: featureKey=crm READ (ALLOWED_WHILE_OFF) + crm ROOT_MUTATION |
| AC15 | FOUNDATION | LM: every `DEFAULT` row (dependency + platform invariants) · RM: featureKey∈{employee_access,company_settings} PLATFORM_EXEMPT rows |
| AC16 | FIN | LM: `double_entry_ledger`/DEFAULT · RM: featureKey=double_entry_ledger FINAL_MUTATION reverse/post rows |
| AC17 | FOUNDATION | LM: all rows (OPEN/CLOSED transitions) · RM: all rows with resumePath∈{RESUME,REISSUE} |
| AC18 | CRM | LM: `crm`/DEFAULT, `product_catalog`/DEFAULT · RM: featureKey=crm bookings rows + featureKey=product_catalog (currently all BLOCKED) |
| AC19 | INV | LM: `inventory`/DEFAULT · RM: featureKey=inventory (all classes) |
| AC20 | FIN | LM: `sales_documents`/DEFAULT, `crm`/DEFAULT · RM: featureKey=sales_documents payment-proof rows + featureKey=crm inbound-capture READ rows |
| AC21 | WF | LM: `workflow_automation`/DEFAULT, `dashboard_notifications`/DEFAULT · RM: surfaceKind=ASYNC with policy SKIP_SUPPRESS + featureKey∈{workflow_automation,dashboard_notifications} |
| AC22 | CRM | LM: `ai_line_assistant`/DEFAULT · RM: surfaceKind=AI_TOOL (all 59 tools + 25 gateway-plane rows, of which the plane rows are **BLOCKED**) |
| AC23 | FIN | LM: `sales_documents`, `procurement`, `double_entry_ledger`, `thai_tax`/DEFAULT · RM: FINAL_MUTATION rows in those features |
| AC24 | FOUNDATION | LM: all 16 `DEFAULT` rows (grandfathered seed) · RM: none directly |
| AC25-PLATFORM | PLATFORM | RM: featureKey∈{employee_access,company_settings,NONE(auth/health)} PLATFORM_EXEMPT rows + the PDPA/self-service rows (currently **BLOCKED**) |
| AC25-CRM | CRM | LM: `crm`/DEFAULT, `line_oa`/DEFAULT · RM: ASYNC campaign rows (currently **BLOCKED**) |
| AC25-FIN | FIN | LM: `bank_reconciliation`/DEFAULT, `thai_tax`/DEFAULT · RM: featureKey=bank_reconciliation READ (redaction) + thai_tax work-card rows |
| AC25-WF | WF | LM: `dashboard_notifications`/DEFAULT · RM: featureKey=dashboard_notifications WEB rows |
| AC25-all | all | RM: every row with a non-null friendlyFallback |
| AC26 | RPT | LM: `reports`/DEFAULT · RM: featureKey=reports (all classes; READ = VISIBLE_SNAPSHOT_ONLY, FINAL = BLOCKED) |
| AC27 | FOUNDATION | LM: every `DEFAULT` row (each feature journey cycle is that feature's own launch gate) · RM: all rows |
| AC28 | FIN | LM: `thai_tax`/DEFAULT · RM: featureKey=thai_tax VAT-claim resolution rows |
| AC29 | FOUNDATION | LM: every `SPECIALIST_LEGAL` row + the control-plane requirements in §4 · RM: the whole matrix is the approved artifact this AC requires |
| AC30 | PLATFORM/UX | LM: `workflow_automation`/DEFAULT (WorkflowTask reuse) · RM: featureKey=workflow_automation tasks rows; survey in `docs/agent-memory/f0-workflowtask-reuse-survey.md` |
| AC31 | PLATFORM/UX | LM: `thai_tax`/DEFAULT + every `SPECIALIST_LEGAL` fallback row (no “filed/accepted” misunderstanding) · RM: rows with policy BLOCKED or STOP_IMMEDIATELY that surface a Thai fallback |

## 6. Open catalog gaps

| Gate namespace | What is missing | Owner | Consequence |
|---|---|---|---|
| `cap.thai_tax.external_filing_correction` | the exact `(formType, correctionRoute, channelVersion)` tuple set the classifier emits; the spec names two candidate route enums and `channelVersion` is data-driven | FIN | namespace seeded CLOSED as **BLOCKED-catalog**; no tuple row may be materialised or opened until the catalog is confirmed (plan:36 requires materialising/validating 100% of the explicit route catalog before the enforcement flip) |
| `cap.thai_tax.vat_scope_credit_transfer` | a canonical `transitionKind` enum — none exists in the tax spec or in code | FIN | namespace seeded CLOSED as **BLOCKED-catalog**; external-first remains the only path, which the spec already guarantees works whether the row is OPEN, CLOSED or missing (tax-spec:715) |
