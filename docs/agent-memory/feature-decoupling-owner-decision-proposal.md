# Agent Memory: Feature Decoupling Owner Decision Proposal

Status: OWNER DECISIONS INCORPORATED IN CONFIRMED v5.1 + POST-REVIEW AMENDMENT (2026-07-31). The human-safe amendment below is now propagated into the Feature and Thai Tax Specs/Plans. Runtime is unchanged; implementation starts at F0 and every Thai-specialist route remains CLOSED until its own evidence passes.
Owner: Product owner
Scope: Decisions needed to make features independently sellable/togglable, require no customer-operated migration or re-entry on later enable, and keep enable/disable behavior friendly and financially safe.

## Decision principles

1. **No user migration** means no CSV import, re-keying old documents, or record-by-record cleanup by the customer. Additive schema migrations, internal normalization, and background projections are allowed when deploy-owned, idempotent, resumable, and invisible to the customer.
2. **Capture once, derive later.** Passive inbound capture and required system projections continue while a feature is off. Interactive creation of a new root document remains gated by the owning feature.
3. **Preserve and pause, never delete or reset.** Turning a feature off keeps source data, configuration, evidence, and completed legal artifacts.
4. **No stale replay.** Re-enabling a feature must not automatically send old outbound work, re-run skipped workflows, re-file tax, or double-post accounting.
5. **Dependencies must be real and visible.** Use static dependencies only where the child cannot function independently. Composite actions use per-action AND gates.
6. **The system chooses safe defaults.** Ask the customer only when the system cannot safely infer external filing/accounting history, legally required missing evidence, a nonzero VAT-credit scope-transition outcome, or physical stock truth.

## Owner-adopted UX and rollout closure (2026-07-31)

The owner asked the design to optimize for independent on/off control, no customer migration/re-keying and the friendliest safe journey. The adopted closure is:

1. Operational launch routes are hidden deploy controls, not packages or customer settings. The customer turns on one sellable feature once; the UI reports **พร้อมใช้ / กำลังเตรียมข้อมูลเบื้องหลัง / ต้องตรวจบางรายการ** and never exposes gate keys or generations.
2. One business issue appears once in global **งานที่ต้องทำให้จบ**, under Finance as **งานบัญชีและภาษีที่ต้องดำเนินการ**, and from its source page when permitted. The same card survives SYSTEM→EXTERNAL fallback and asks only for genuinely missing facts.
3. `cap.wht50bis` has independent routes `SYSTEM_INITIAL_ISSUE`, `SYSTEM_CONTENT_CORRECTION` and `SYSTEM_REPLACEMENT_COPY`. Each starts CLOSED, has its own EXTERNAL fallback and may open/close without affecting a sibling. Every SYSTEM PDF pins a reproducible render manifest.
4. Filed/external WHT correction is manual-first: immutable diff → exact classifier → prefilled packet/checklist → one stable-revision approval → external filing → receipt/evidence → `RECORDED_EXTERNAL`. PND3/53 negative additional is offered only when the current channel snapshot supports it; refund/ค.10 remains separate. Automation is optional later per exact form/route/channel.
5. VAT filing-scope change with zero credit is automatic. Nonzero is external-first through one stable work item and immutable preparation revisions: Finance prepares once, OWNER/ACCOUNTANT approves that exact snapshot, and the user never chooses a route or re-enters evidence. External handling has a monotonic `NOT_STARTED → IN_PROGRESS → COMPLETED` work-item high-water mark. Final CAS is deterministic: exact validated OPEN route + both states `NOT_STARTED` creates INTERNAL; both `COMPLETED` + valid evidence creates EXTERNAL; every other state preserves the same card without mutation. Exactly one mutually exclusive ORIGINAL result is allowed.
6. In-product VAT credit offset stays `[LATER]` with no v5.1 mutation. The smallest future v6 slice is PP30 current payable principal only, atomically consuming credit+payable with Dr 2137/Cr 1156, no Bank evidence and full reversal/replacement correction.
7. New companies/new purchases use the decoupled catalog immediately. Existing effective access is grandfathered without charge or customer action until the next confirmed renewal; a renewal preview and explicit atomic command are required before any reduction.

Implementation order is F0 route inventory/matrices → common friendly fallbacks/global hub → WHT initial SYSTEM issue → manual-first correction → WHT SYSTEM content correction → SYSTEM `ใบแทน` → validated internal VAT transition kinds → automated filing correction last. This order limits blast radius; it does not make later routes dependencies of earlier ones.

## Adopted owner decisions (rationale)

### O1 — Entitlement lifecycle is `ON | DRAINING | OFF`

- A disable request immediately stops new root documents, new automation, and outbound delivery.
- Existing financial/legal work allowed by `RUNOFF_MATRIX` remains reachable from one global **งานที่ต้องทำให้จบ** surface.
- When no supported runoff work remains, the feature becomes `OFF` automatically.
- Unsupported or unsafe runoff remains a preflight blocker.
- Record every entitlement-set command atomically with whole-command idempotency/CAS; epoch increments on every real non-ON→ON transition, including DRAINING resume. Record every sellable-feature `DEFAULT` row or exact operational `(gateKey,routeKey)` OPEN/CLOSED transition in an append-only, command-idempotent log with that row's own generation.
- Executable work/attempts carry an availability vector of every required entitlement epoch plus exact `(gateKey,routeKey,generation)`. A claim shares the enable/disable/route-close lock protocol; external dispatch has a durable provider-idempotent boundary and crash-after-send becomes poll/manual `UNKNOWN_EXTERNAL_OUTCOME`, never blind retry. Re-enable/reopen never revives old work or borrows a sibling route. Exact pre-disable legal artifacts retain only provenance-linked correction/credit/void/replacement authority after OFF, not ordinary creation.

Risk/control:

- A user may believe the feature is still active during runoff. UI must say **หยุดงานใหม่แล้ว — เหลืองานเดิม N รายการ**, not “enabled.”
- LINE/customer outbound has no runoff exception: it stops immediately.
- Financial runoff may create only child records required to settle a pre-cutoff root document.

### O2 — Refine P-0 ownership and dependency semantics

Replace the broad “source-data writes never entitlement-gated” wording with:

> Passive capture and required system projections are not entitlement-gated. Interactive root mutations are gated by the owning feature. Derived products are recomputed from captured sources when their owning feature is enabled.

Adopted static dependencies:

- `expense_auto_post => double_entry_ledger` only.
- Structural child dependencies remain where the child has no standalone journey, for example supplier payment/AP aging requiring the vendor-bill surface. Partner UI applies prerequisites in one reviewed change and shows commercial impact before confirmation.

Adopted dependency/action removals and narrowing:

- No global dependency between `thai_tax` and `double_entry_ledger`.
- Remove `reimbursement => expenses`. Reimbursement owns its workflow and may create hidden `ExpenseRecord` system projections.
  - When `expenses` is off, reimbursement approval/finance review confirms the claim-born projection through a system-mediated, audited path; users do not need the Expenses surface.
  - If `expenses` is enabled later, those records become visible with reimbursement provenance.
  - Existing `MaterializeClaimExpensesService` is the implementation seam.
- `IMPORT_SERVICE/PP36` requires `thai_tax` only when the user creates that transaction type; it does not make all Procurement depend on Tax.
- CRM/LINE/AI, Workflow/Notification, and Inventory/Product Catalog use per-action requirements instead of global dependencies.

### O3 — Enable-later is automatic preparation, not migration

- The single **เปิดใช้งานและเตรียมข้อมูล** action authorizes the default safe open-period scope; run a readiness scan and build derived projections in the background without a second migration confirmation.
- Backfill is batched, idempotent, resumable, and limited to eligible records.
- Never ask the customer to re-enter a value already present in a source document, evidence file, company profile, or counterparty snapshot.
- UI states are:
  - **พร้อมใช้**
  - **กำลังเตรียมข้อมูลเบื้องหลัง**
  - **ต้องตรวจบางรายการ**
- Use the source transaction date for effective rules, not feature activation or posting date.
- Closed accounting/tax periods are never silently rewritten.

Defaults:

- Tax: infer the next in-product filing period per form/scope. Output/WHT in earlier externally handled periods stays `EXTERNAL/HISTORICAL`; older input VAT is separately classified as already claimed, eligible delayed carry-in, or review from evidence—never blanket-excluded.
- Ledger: automatically post complete, eligible sources in open periods. For closed/external periods, offer a current-period opening/adjustment preview.
- Inventory: recommend **trust captured history** when readiness is clean; request an opening stock count only when history and physical truth may differ.

### O4 — D6 Tax and Ledger are fully separable

- Enabling `thai_tax` without Ledger must not require chart/account setup.
- Tax amounts and tax component snapshots are immutable once final.
- At journal generation, resolve accounts again when assignments are empty, partial, or stale.
- Expected account roles are validated per component.
- Posting resolution must persist immutable provenance: `accountRole`, account ID, rule ID/version, effective source date, and resolution reason/version.
- Reconciliation reads the resolution actually posted, not a mutable source assignment.
- General standard-chart suggestions remain review-required. The sole zero-form exception is the verified, version/checksum-bound VAT pending/refund/net-settlement-payable control-role binding in Spec CC4.
- Custom charts show unresolved ordinary roles in one setup surface; for the VAT control exception the system reuses an explicit role or creates a dedicated role-tagged account, never guesses by name. Locked charts keep capture pending and create one task.

### O5 — Correct D7 VAT classification

Do **not** classify VAT as `NON_CLAIMABLE` merely because `thai_tax` is disabled. Entitlement state is not a legal tax-credit determination.

Adopted neutral source state:

```text
CLAIMABLE
PARTIALLY_RECOVERABLE
NON_RECOVERABLE_CONFIRMED
EXTERNAL_OR_UNRESOLVED
NOT_APPLICABLE
```

When `thai_tax` is off:

- Preserve net amount, commercial VAT amount, included/excluded mode, invoice date, supplier/tax-invoice evidence, and original calculation inputs.
- Use `EXTERNAL_OR_UNRESOLVED`, not `NON_CLAIMABLE`, unless another fact has actually confirmed non-recoverability.
- Do not create an in-product filing event.

Ledger decision after Thai-chart research:

- Reuse existing semantic role `INPUT_VAT_PENDING`; do not introduce `VAT_PENDING_EXTERNAL`.
- Standard chart positions are deliberately separate: **1154-00 ภาษีซื้อ** and **1156-00 ลูกหนี้กรมสรรพากร** are ASSET/DEBIT under TRADE_AND_OTHER_CURRENT_RECEIVABLES / **ลูกหนี้การค้าและลูกหนี้หมุนเวียนอื่น**; **1155-00 ภาษีซื้อ-ยังไม่ถึงกำหนด** is ASSET/DEBIT under OTHER_CURRENT_ASSETS / **สินทรัพย์หมุนเวียนอื่น**; **2135-00 ภาษีขาย** and **2137-00 เจ้าหนี้กรมสรรพากร** are LIABILITY/CREDIT under TRADE_AND_OTHER_CURRENT_PAYABLES / **เจ้าหนี้การค้าและเจ้าหนี้หมุนเวียนอื่น**. 2135 remains gross output VAT and is never the net ภ.พ.30 payable.
- Runtime uses semantic bindings only when Ledger must post, so custom codes may differ: claimable/pending/refund/gross-output/net-payable roles correspond to standard 1154/1155/1156/2135/2137 and must use five distinct accounts across binding history. Applicable reviewed FINAL rules resolve first; only then may a valid explicit binding beat a system binding. Every candidate must be same-company, active, posting, non-controlled, type/side/presentation compatible, source-date effective and unambiguous.
- Claimable/recoverable-partial resolution and ภ.พ.30 filing create tax facts/reports even with Ledger off; nonrecoverable amounts create no active contribution. TaxPeriod is only the calendar container. A whole immutable partition generation owns disjoint child scopes, frozen event assignments and independent lifecycle/report/filing/settlement state.
- Cutover is per company/form/scope by last externally handled filing period, with a prefilled form default and only needed overrides. Output/WHT handled history stays sticky; older input VAT resolves external-claimed versus eligible carry-in versus review from return evidence, and corrections follow the original scope/cutover lineage. The first in-product VAT period requires evidence-backed or explicit-zero opening available/refund-reserved buckets—never silent zero or G/L inference.
- Available and refund-reserved VAT credit remain separate in one PP30 regime/scope/currency position with complete origin/reservation allocations. Settlement uses available carry automatically and maximally before any payment, then may reserve only the resulting available balance for refund—there is no user choice that creates avoidable cash payment. Settlement never reapplies a separate refund outcome. Raw rejection/withdrawal changes no bucket; only evidenced cash receipt, continued carry right, disallowance or expiry applies the exact reservation and correct 1156 treatment. A policy change with zero credit is automatic; nonzero credit has one stable work item whose immutable matrix/evidence revisions survive Finance→OWNER/ACCOUNTANT handoff. Final CAS writes either a matrix-hashed origin+successor-CAS external result with immutable origin-linked disposition children, or exact origin-consumption/equal-sum internal destination legs after exact-route validation—never both or one after the other. A refunded external-transition child records tax truth first and uses the same cash-evidence link. A nonzero opening 1156 projection precedes use.
- PP30 payable/payment is versioned and Tax truth is independent of cash reconciliation: zero remaining principal plus immutable remittance evidence reaches Tax PAID even if Bank/Ledger is off. One outcome holds principal plus separate surcharge/penalty/interest components so one combined withdrawal is selected once; 2137 clears only principal and reviewed expense roles take the charges. Correction/reversal keeps exact 2137/1156/charge lineage. Refund and PP30/PP36/PND payment targets all persist a canonical hash; a shared single-use `TaxCashEvidenceLink` validates a complete Bank match or exact posted cash line, while old evidence references alone never post cash. Versioned `TaxLedgerProjection` heads give close/backfill a concrete effective-period/dependency/status contract and Ledger close never waits for a Tax projection merely because Tax is off.
- Standard/custom setup is zero-form: the separately versioned exact `TH_SME_COA_V1` control manifest binds all five verified 1154/1155/1156/2135/2137 G/L roles without activating a Tax Code/profile. Deploy-owned `ChartMutationPolicy` classifies exact/system, writable custom, external lock or unresolved from existing evidence. A customized-standard account is reused only by provenance + full fingerprint; otherwise independently reuse/provision every missing Thai role, never by name. 1154/1155/2135 start at the earliest relevant authorized open source; 1156/2137 start at settlement recognition. Locked/unresolved roles are deduped internally but appear as one consolidated prefilled chart exception/approval only when Ledger needs them.
- Because both existing company VAT booleans default false, add a deploy-owned `CompanyVatRegistrationState(version=0)` plus effective-dated tri-state facts and additive status/effective-date/version response. Every fact write locks/increments the state so UNKNOWN has a real expected-absence CAS token. Correctness and new UI always read the fact at source date; only dated authoritative true can seed REGISTERED, false/undated/absent values remain hints, and conflicts create one task. The required legacy wire tuple `(vatRegistered, vatEffectiveDate)` remains non-authoritative compatibility evidence: an exact GET→PUT echo is a no-op, a changed boolean or date needs the prefilled adapter + expected-version CAS or an upgrade error, and neither overrides an applicable fact. New responses show UNKNOWN truthfully. Ask once only when resolving/filing.
- Enabling Tax scans unresolved records into one prefilled queue. No journal or historical filing is silently rewritten.

### O6 — 50 ทวิ belongs to the payment source; correction never overwrites history

- A durable actually settled supplier/expense payment event qualifies for a print-ready 50 ทวิ only when withholding is positive, WHT lines sum exactly and stored statutory facts are complete/unambiguous. Zero/no-WHT is NOT_APPLICABLE; invalid/incomplete facts go to one source/global-hub prefilled review under `wht.certificate.prepare`, even with Tax off, without reserving a number or re-entry.
- Identity is `sourcePaymentType + sourcePaymentId + payee`, with multiple lines by income category/rate. Partial payment uses the amount actually withheld in that event. `taxPeriodId`/`taxEventIds` are optional provenance.
- No request/number/PDF exists before a qualifying SETTLED event. Issue uses source authorization, tenant/branch scope, outbox, immutable snapshot/PDF/hash/audit. Every handoff/issue/link/correction/cancel/copy action has one append-only command record. Opening a correction case is itself company-global command-idempotent under expected active certificate/revision, creates its first revision atomically and permits only one nonterminal case per active certificate. Correction compares expected active certificate/revision plus source-payment revision/WHT hash; financial/payee/form changes require an audited source correction and lock old/new identities. A stale command creates nothing. Never reuse a number, edit or hard-delete an issued artifact.
- Existing certificates are linked before historical issuance; ambiguous cumulative payments remain prefilled exceptions and never become fabricated payment events. One active DRAFT/ISSUED certificate is allowed per source identity; historical revisions remain.
- If certificate content is wrong, atomically VOID the old certificate with supersession links, keep its PDF/hash, issue a new number, and deliver cancellation notice + corrected certificate. This new-number rule is a product/audit policy. `ใบแทน` is a separate immutable copy for loss/damage, generated from the retained counterpart under the same identity/number/statutory-content hash, visibly marked “ใบแทน” and storing issuer certification actor/time/signature snapshot; reuse a valid stored signer and ask once only if that evidence is missing.
- If the certificate is correct but the return/attachment is wrong, do not reissue it. Before payment, detach/cancel the return and rebuild; reconcile the old pay-in slip. After filed/paid, create a correction case:
  - unchanged income/tax but other data wrong → ป.ป.01;
  - wrong form/taxpayer class, unchanged amount → ป.ป.02/tax review;
  - understated amount → positive additional ภ.ง.ด.3/53 for the original payment month;
  - overstated amount → reviewed negative adjustment/additional route plus guided ค.10/refund task;
  - period/payee/mixed ambiguity → `TAX_REVIEW_REQUIRED`.
- Store original/new filing and receipt references, pay-in-slip reconciliation, artifacts, reason/approval, RD/refund outcomes, delivery/recipient-use status, immutable events and whether funds came from the payee or payer. Approve once only after reconciliation is stable; a late slip or material route change supersedes the old packet/approval and needs one approval for the new immutable revision. Filed/external completion is manual-first and ends as evidence-backed `RECORDED_EXTERNAL` unless a separately verified response proves RD acceptance. A combined case closes only after every required certificate, return and refund branch completes. Never auto-file, close a live branch, or auto-create ค.10 before claimant rights/current RD capability are confirmed.
- Payment settlement never waits for Tax or a SYSTEM route. A CLOSED/missing `SYSTEM_INITIAL_ISSUE` creates one durable external handoff; a CLOSED/missing `SYSTEM_CONTENT_CORRECTION` accepts a corrected EXTERNAL new-number artifact; a CLOSED/missing `SYSTEM_REPLACEMENT_COPY` uses the external certified-copy handoff. Certificate-only work remains available under `wht.certificate.correct`. A number-only DRAFT at exact-route close is cancelled with number consumed; reopen never auto-issues. These actions also remain available for the exact legal artifact after its source feature is OFF. Tax permissions govern return/refund branches, not certificate repair.

### O7 — Approve D9 system compensation with locked-period rules

- A source void requires the source permission, not a human `journal.entry.reverse` permission.
- The system creates an exact, net-zero, document-scoped reversal with tenant/branch scope, original-journal linkage, reason, and CRITICAL audit.
- It continues to work when Ledger is disabled because it is source lifecycle compensation, not interactive ledger value.
- Open period: reverse automatically.
- Closed period: never reopen or backdate silently; create a current-period correction preview/task.
- Filed tax state: create the appropriate correction task instead of changing a filed state.

### O8 — Per-action outbound, notification, and workflow gates

Required gates:

- Customer outbound: owning feature AND `line_oa`.
- AI customer reply/autonomous booking: add `ai_line_assistant` and any owning CRM subfeature.
- Staff dashboard/LINE notification: `dashboard_notifications` AND trigger-owning feature.
- Staff LINE through the shared WatchDog OA does not require company `line_oa`.
- Workflow execution: `workflow_automation` AND template `requiredFeatureKeys`.
- Workflow `SEND_NOTIFICATION`: additionally requires `dashboard_notifications`.
- Unknown workflow/source ownership fails closed.
- Inbound capture, security/cleanup, retention purge, and customer self-service remain entitlement-independent.

Queue behavior:

- Due reminder/retry: terminal `SUPPRESSED_FEATURE_DISABLED`; no replay.
- Campaign definition/content: `PAUSED_FEATURE_DISABLED`; explicit user Resume creates new deliveries under the current epoch.
- AI/autonomy work: terminal staff handoff.
- Workflow event: retain evidence but mark action `SKIPPED_FEATURE_DISABLED`; manual replay may be offered, never automatic.
- Every external send/final mutation re-checks entitlement immediately before execution.

Fallback message default:

- At most once per open conversation after AI value is disabled while `line_oa` remains on.
- Reset only after human reply or conversation resolution; never send a fallback when `line_oa` itself is off.

### O9 — PDPA is an always-on platform guardrail

- PDPA/privacy controls are not a sellable entitlement and do not depend on CRM, LINE, AI, or employee feature state.
- Use new `company.policy.read` / `company.policy.manage` permissions rather than `company.setup.*` or `crm.channel.*`.
- No consent popup is required for ordinary operational CRM or employee system use when another documented lawful basis applies.
- The system derives purpose/basis codes from actions; users do not classify every contact manually.
- Auto-generate a versioned privacy notice and Thai-SME retention preset from company profile/features; editing is available under Advanced and does not block activation.
- Retention/deletion, DSAR, tenant isolation, security, audit/export logs, breach records, and processing terms remain always on.
- Existing contacts may continue operational flows. Missing consent evidence must not be reinterpreted as consent for mass marketing.
- Campaign preflight excludes contacts without a verified marketing basis/status and provides an easy opt-out.
- Do not add health/biometric fields or AI inference of sensitive traits merely because free-text CRM could contain such information.

### O10 — Legacy normalization is automatic

- Before removing fail-open/inheritance, compute the currently effective customer-visible state for every company.
- Materialize explicit rows for every feature/subfeature with `grantOrigin=LEGACY` where applicable.
- Preserve existing customer-visible access to avoid disappearing menus.
- Side-effect-only automation such as auto-post remains enabled only with explicit evidence that it was actually active; do not infer it from a UI fail-open path.
- Normalize one company per transaction with dry-run diff, audit, and rollback evidence.
- If any company fails normalization, keep the legacy resolver for that company; never switch halfway.
- Remove API and web inheritance/fail-open semantics together after all companies pass.
- New features default OFF unless a package explicitly grants them.
- Adopted commercial policy: preserve grandfathered effective access at no added charge or customer action until the next confirmed contract/package renewal. Show one partner impact preview first and apply an accepted change only through the normal explicit atomic entitlement command; a date, missing renewal data or unconfirmed choice never removes access.

### O11 — Cross-feature views remain useful but truthful

- CRM report aggregates may remain visible as CRM-owned computed value only when clearly labeled; source drill-down/actions require the source entitlement and user permission.
- Bank matching may consume captured source facts, but dead links are removed and counterparty/detail redaction follows source permission.
- Existing issued public/legal share links remain reachable unless explicitly revoked; disabling blocks new issuance/sharing.
- No report, notification, AI response, or workflow should link to a surface the user cannot open.

### O12 — Launch and rollback are per sellable-feature `DEFAULT` row or exact operational route row

Do not open the global standalone-combinations launch flag at current Plan Phase 4.

FIN/CRM/INV/WF/RPT remain implementation workstreams only. Use separate launch readiness for every sellable top-level key:

- financial keys such as Tax, Ledger, Sales, Expenses, Reimbursement, Procurement and Banking each exit independently;
- CRM, LINE OA and AI Assistant each exit independently, while composite sends require all participating keys;
- Inventory and Product Catalog exit independently;
- Workflow and Notifications exit independently;
- Reports has its own exit.

`employee_access` and `company_settings` are always-on platform baselines. Hidden non-sellable route catalogs are:

- `cap.wht50bis/{SYSTEM_INITIAL_ISSUE|SYSTEM_CONTENT_CORRECTION|SYSTEM_REPLACEMENT_COPY}`;
- `cap.thai_tax.external_filing_correction/<formType:correctionRoute:channelVersion>`;
- `cap.thai_tax.vat_scope_credit_transfer/<transitionKind>`;
- `[LATER] cap.thai_tax.vat_credit_in_product_offset` with no OPEN route in v5.1.

Manual source payment/fact review/certificate correction, the matching external certificate/copy link, Tax preparation/reporting, manual-first append-only filing evidence and external-first VAT-transition outcomes stay usable while specialized rows are closed. All known offset facts remain in one prefilled no-mutation task, so the user neither re-enters data nor risks double settlement. Missing routes fail closed and one OPEN sibling grants nothing to another.

Gate rollout is expand/shadow first: materialize the complete explicit `(gateKey,routeKey)` catalog, seed proven live ordinary paths OPEN and every specialist route CLOSED, reconcile pre-existing NULL-stamped legal/outbound work to handoff/terminal, then atomically enable fail-closed enforcement. A route close shares the execution-claim lock protocol and only already-dispatched external I/O may finish once; reopening never revives it or changes sibling state.

A sellable-feature `DEFAULT` row or exact operational `(gateKey,routeKey)` row may open as soon as only its relevant:

1. integrity and dependency guards,
2. cutover/backfill/detection,
3. truthful UX,
4. PDPA relocation where applicable,
5. shadow evidence and outbound enforcement,
6. integration and enable-disable-enable cycle tests

are complete. Rollback closes only the affected sellable-feature `DEFAULT` row or exact operational route row unless evidence proves a shared-foundation integrity breach.

## Impact and risk controls

| Impact/risk | Required control |
|---|---|
| Feature disabled mid-customer conversation | Immediate bot stop, one-cadence fallback when LINE remains on, staff handoff report |
| Canary gate closes with a legal/outbound job queued, then reopens | Append-only gate generation; fresh entitlement+gate vector; terminal suppression/handoff; explicit current-generation Resume/Reissue |
| Historical tax is duplicated after enable | One-click cutover; `EXTERNAL/HISTORICAL` state; no silent filing |
| VAT meaning changes because a feature is off | Neutral `EXTERNAL_OR_UNRESOLVED` state; preserve commercial VAT; review on enable |
| VAT remains in 1155 indefinitely, lands in the wrong custom account, or net ภ.พ.30 posts to gross 2135 | Zero-form exact-standard five-role manifest; custom no-name resolver/provisioning; distinct 2137 settlement role; revision-idempotent settlement, aging/period-close review and source-provenance reclass |
| Branch policy overlaps scopes, double-counts an event, strands existing PP30 credit or applies internal after external | Canonical whole disjoint partition + frozen assignment; zero-credit automatic; one stable nonzero work item with immutable Finance preparation and exactly one terminal result: conserved external evidence or strict equal-sum internal CAS before external handling |
| Per-branch cutover duplicates external history or drops delayed input VAT/opening credit | Filing-period cutover per canonical scope; sticky disposition/provenance; delayed input claim review; evidence-backed/explicit-zero opening available+reserved buckets and ordered 1156 opening projection |
| Pending VAT refund is subtracted twice, silently reused, or wrongly returned after rejection | Versioned PP30 scope position + maximal carry use + full origin/reservation allocations; settlement excludes outcome terms; raw rejection/withdrawal changes no bucket; only evidenced receipt/offset/return/disallow/expiry applies exact 1156 treatment |
| VAT credit is applied to an existing in-product payable non-atomically and one side is consumed twice | `[LATER] cap.thai_tax.vat_credit_in_product_offset` stays CLOSED throughout v5.1; retain one prefilled no-mutation task and require a separately confirmed PP30-only v6 mutation spec/plan |
| Ledger backfill uses the wrong account rule | Source-date resolver plus immutable posting-resolution provenance |
| Closed periods are rewritten | Current-period correction preview/task only |
| Reimbursement works but hidden expenses strand accounting | System-confirm claim projections from reimbursement control; provenance and period-close tests |
| 50ทวิ/return correction destroys evidence, duplicates a case or diverges from payment | One nonterminal command-idempotent case per active certificate; immutable old/new artifacts; expected payment revision/WHT hash; old+new identity locks; separate ORIGINAL/ใบแทน with issuer certification snapshot; source correction for financial changes; separate branch approvals/original-month routing |
| System 50ทวิ gate blocks payment or later duplicates an external certificate | Payment always settles; source-visible fact review/correction and one handoff; partial-DRAFT close rule; shared SYSTEM/EXTERNAL identity+number locks; no auto-issue |
| Manual filing status attaches to the wrong export, time, or races | Artifact-only packages + append-only scope/revision submission head with submitted/status-effective/recorded times, allowed transitions and expected-active CAS; no export required |
| PP30 payment is duplicated, standalone Tax cannot reach PAID, or a correction falsifies cash/charges | Tax PAID depends on full immutable remittance fact, not Bank/Ledger; one hashed outcome stores principal+charge components; single-use cash link, versioned projection, exact 2137/1156/expense reversal lineage |
| Bank↔Tax adapters create a module cycle | Contracts-owned Tax target reader + Bank-owned confirmed-match evidence reader, composed outside repositories/mutation services; no `forwardRef` |
| Legacy users lose access | Full dry-run normalization and transactional materialization before removing old semantics |
| Bank/CRM aggregate leaks detail | Source-permission redaction, labeled aggregates, gated drill-downs |
| Captured-while-off personal data is retained indefinitely | Always-on retention preset, purge, DSAR, and offboarding/churn deletion |

## Unavoidable customer prompts

These are not migration forms. Ask only once and prefill the recommended answer:

1. Tax context, shown only when needed: one prefilled scope matrix for externally handled periods, delayed-input provenance, opening available/refund-reserved VAT credit (including explicit zero), and VAT-registration status/effective date only where evidence cannot infer them.
2. At ภ.พ.30 review/filing/outcome only, confirm one prefilled partition, nonzero transition reconciliation, refund-disposition review, or bank/cash account only when evidence cannot determine it. External-transition defaults conserve equal successor openings; a raw refund rejection/withdrawal changes no credit until its legal disposition is evidenced. Never feature-enable/per-record prompts.
3. Is genuinely missing legally required source evidence available (for example tax ID or payee information)?
4. When inventory history is unreliable, should the company trust history or establish an opening balance by stock count?

Everything else should be background automation or a prefilled exception queue.

## Spec/Plan amendments (completed in confirmed v5.1)

- Refine P-0 wording to distinguish passive capture/system projection from interactive root mutation.
- Update dependency matrix: remove `reimbursement => expenses`; keep `expense_auto_post => double_entry_ledger`; add only true structural child dependencies.
- Add D6 posting-resolution provenance and source-date semantics.
- Replace D7 `NON_CLAIMABLE because thai_tax off` with the neutral VAT state and defined ledger behavior.
- Define multi-line payment-owned 50 ทวิ shape and correction lifecycle.
- Extend D10 with `DRAINING`, immutable epochs, runoff hub, pause/suppress/no-replay, and locked-period behavior.
- Update D4 notification row to require `dashboard_notifications` AND trigger-owning feature.
- Add per-template `requiredFeatureKeys` and queued-work terminal states.
- Expand D11 from inherited-key materialization to tested effective-state normalization.
- Replace the Phase 4 global/workstream launch opening with readiness per sellable-feature `DEFAULT` row or exact operational route row after truthful UX and enforcement.
- Fence every launch row with an append-only command transition + its own generation in the final availability vector, so close→reopen cannot replay queued legal/outbound work or borrow an OPEN sibling.
- Add canonical whole filing partitions, disjoint assignments, independent scope lifecycle, append-only submission truth, PP30 credit/allocation and payable/payment positions, plus internal/external nonzero-transition routes.
- Change launch identity to hidden `(gateKey,routeKey)`, split WHT SYSTEM work into three independently fenced rows and require render-manifest evidence.
- Make filed/external WHT correction manual-first, nonzero VAT scope transition external-first and defer in-product offset to a future PP30-only v6 contract.
- Adopt the global/Finance work-card contract and grandfather existing effective access through confirmed renewal.
- Add contracts typecheck, Prisma validation/migration-drift review, and feature-cycle integration evidence to verification.

All items above are recorded in confirmed Spec/Plan v5.1; implementation evidence begins at F0 rather than reopening these owner decisions.

## Official research notes

Current channel snapshot was rechecked on 2026-07-31:

- RD e-Filing/RD Prep portal: https://efiling.rd.go.th/rd-cms/
- RD generic API catalog: https://efiling.rd.go.th/rd-cms/api
- RD WHT correction/form references: https://www.rd.go.th/62367.html and https://www.rd.go.th/29519.html

The current portal announcement states that, from **24 July 2569**, a human-operated negative-additional route is available for PND1/2/3/53 and requires downloading/installing the new RD Prep. It does not by itself establish claimant/refund rights or an Open API contract. The generic API catalog also does not establish an automatable PND3/53 negative-correction contract. This is why the owner-adopted baseline is manual-first and future automation is independently gated by exact `(formType,correctionRoute,channelVersion)` evidence.

- PDPA covers identifying personal data generally; health is only one sensitive-data category. Employee contract necessity is a lawful basis only for processing necessary to that contract, not a blanket waiver:
  - https://law.prd.go.th/th/file/get/file/20231122b19b536a4647f29a6d99e228909779b4120136.PDF
- Consent guidance supports specific, separate, freely given, and withdrawable consent rather than forced consent for ordinary required work:
  - https://www.mdes.go.th/uploads/tinymce/source/%E0%B8%AA%E0%B8%84%E0%B8%AA/%E0%B9%81%E0%B8%99%E0%B8%A7%E0%B8%97%E0%B8%B2%E0%B8%87%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%94%E0%B8%B3%E0%B9%80%E0%B8%99%E0%B8%B4%E0%B8%99%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%83%E0%B8%99%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%82%E0%B8%AD%E0%B8%84%E0%B8%A7%E0%B8%B2%E0%B8%A1%E0%B8%A2%E0%B8%B4%E0%B8%99%E0%B8%A2%E0%B8%AD%E0%B8%A1%E0%B8%AF.pdf
- VAT creditability/non-recoverability follows tax facts, not product entitlement:
  - https://www.rd.go.th/5206.html
  - https://www.rd.go.th/3417.html
- Revenue Department materials distinguish carrying excess VAT forward from requesting a cash refund, and warn that using excess tax credit beyond the available amount can create unpaid-tax consequences. This supports a tax-side available/reserved credit chain rather than treating the 1156 G/L balance as authority:
  - https://www.rd.go.th/fileadmin/user_upload/lorkhor/newspr/2025/vat_refund.pdf
  - https://www.rd.go.th/38572.html
- Revenue Department rulings show why a rejected/unsuccessful refund request cannot automatically restore carry credit: prohibited input VAT may be neither credited nor refunded, a non-registered filer has no credit right, and some refund claims expire. Therefore a raw rejection/withdrawal stays in review until evidence classifies `RETURN_TO_AVAILABLE | DISALLOWED | EXPIRED`:
  - https://www.rd.go.th/41080.html
  - https://www.rd.go.th/42995.html
  - https://www.rd.go.th/28780.html
- Revenue Department material also shows carried excess VAT being deducted in following periods and recognizes evidence-backed set-off of a VAT refund against tax debt. This supports maximal available-credit use plus a distinct reviewed non-cash `OFFSET_APPLIED` outcome. For v5.1, automatic mutation is deliberately limited to a proven `EXTERNAL_UNMODELED` liability; a matching in-product payable is kept as a prefilled no-mutation candidate under `[LATER] cap.thai_tax.vat_credit_in_product_offset`. It cannot open in v5.1; a separate confirmed v6 spec/plan begins PP30 current principal only and must define the complete atomic/replay/correction contract:
  - https://www.rd.go.th/38572.html
  - https://www.rd.go.th/30726.html
- DBD places “ภาษีซื้อที่ยังไม่ถึงกำหนดชำระ” under other current assets; TFAC cost principles support returning unrecoverable tax to the related inventory/asset cost rather than one blanket expense:
  - https://www.dbd.go.th/storage/law/0fafe207-f3e1-4173-bca7-47c32219a932.pdf
  - https://www.tfac.or.th/upload/9414/r3GgTz0gN0.pdf
- DBD separates pending input VAT under **สินทรัพย์หมุนเวียนอื่น**, VAT refund receivable under **ลูกหนี้การค้าและลูกหนี้หมุนเวียนอื่น**, and Revenue Department payable under **เจ้าหนี้การค้าและเจ้าหนี้หมุนเวียนอื่น**; these are the presentations for 1155, 1156 and 2137 respectively:
  - https://www.dbd.go.th/storage/law/8574da80-7092-440d-8b88-9eb385eb443b.pdf
- Section 50 bis and the prescribed form support issuing 50 ทวิ from the withholding/payment fact without an internal tax-period prerequisite:
  - https://www.rd.go.th/3171.html
  - https://www.rd.go.th/fileadmin/tax_pdf/withhold/approve_wh3.pdf
- Announcement 146 amending Announcement 62 and an RD ruling require ordinary `ใบแทน` to be copied/printed from the retained counterpart, marked “ใบแทน” at the top and signed/certified by the issuer:
  - https://www.rd.go.th/28601.html
  - https://www.rd.go.th/49019.html
- Official correction/refund materials support separating certificate correction from return correction and routing external work by error type:
  - https://www.rd.go.th/42525.html
  - https://www.rd.go.th/fileadmin/tax_pdf/request/pp0153_130753.pdf
  - https://www.rd.go.th/fileadmin/tax_pdf/request/pp0253_130753.pdf
  - https://www.rd.go.th/fileadmin/tax_pdf/withhold/270360_WHT3.pdf
  - https://www.rd.go.th/fileadmin/tax_pdf/withhold/WHT53_041060.pdf
  - https://www.rd.go.th/fileadmin/tax_pdf/others/K10_061260.pdf
  - https://www.rd.go.th/30748.html
  - https://efiling.rd.go.th/rd-cms/ask?question=00015382234
- Common software practice also locks a certificate once it is included in a return, requires unlink/cancel before pre-filing correction, and separates data/form/amount errors:
  - https://www.peakaccount.com/peak-manual/peak-tax/tax-form-edit/edit-wht-certificate-after-creating-tax-return-peak-tax
  - https://flowaccount.com/blog/correct-mistakes-tax-deduction-wht/

The 1155 account reuse, immutable-artifact/new-number policy, manual-first guided correction case and external-first nonzero transition are product defaults. Exact statutory PDF/render manifest, surcharge calculation and each current filing/transition channel remain per-route specialist/runtime validations. These notes are design inputs, not transaction-specific tax advice.

## Post-review owner amendment — human-safe rollout (2026-07-31)

This amendment records the owner's direction after reviewing the v5.1 journey as a system architect, Thai accountant and real non-technical user aged 40+. It narrows implementation choices. The normative contracts are now carried by the Feature and Thai Tax Specs/Plans; this memory retains the rationale and deferred-decision triggers.

### Adopted product and UX direction

1. **Launch gates are internal-only and evidence-backed.** A customer, partner or ordinary support user never sees or changes `(gateKey,routeKey)`. An exact row may open only from a versioned evidence bundle naming the guarded mutation, fixtures/tests, rule or channel version, reviewer, checked/expiry dates, operational thresholds, fallback and rollback owner. Demand, an owner click or an OPEN sibling is not evidence.
2. **`ActionableWorkCard` is a minimal user-facing read model, not workflow truth.** Keep one stable `businessIssueKey` across source/global entry points and SYSTEM→EXTERNAL fallback. Derive only a small human state such as `NEEDS_ACTION | WAITING_ON_OTHER | VERIFYING | DONE`, title, prepared facts, genuinely missing facts, due/urgency, permitted primary action, assignee and history link from the owning domain. Domain aggregates remain authoritative; the card never owns filing, certificate, payment, VAT-credit or correction transitions and must not become a generic workflow engine.
3. **Accountant handoff uses an invited scoped user only.** Default from the configured tax reviewer when valid, let an authorized user assign the exact card to an invited ACCOUNTANT with company/branch/document scope, and re-check permission on every read/download/action. Notify only actionable assignees and escalate safely if the assignee is removed. Do not create anonymous/public tax links or place attachments in LINE; LINE may send a permission-checked deep link to the authenticated card. A bounded packet download remains available to an authorized user when external filing is required.
4. **Recovery is part of the contract.** A stale CAS refreshes current facts on the same card, explains what changed and preserves non-conflicting draft text/staged evidence; a failed upload/network request keeps a resumable draft and the same command identity. `UNKNOWN_EXTERNAL_OUTCOME` disables duplicate submission and says **กำลังตรวจสอบผลกับระบบภายนอก — กรุณาอย่ากดซ้ำ** until provider polling or one prefilled manual reconciliation resolves it. A permission change identifies the role that can continue and offers assignment; a route change preserves evidence and only changes the friendly next action.
5. **Role-adaptive, plain Thai and accessible by default.** OWNER sees outcome, exact amount when proven, deadline, responsible person and one primary action; Finance/ACCOUNTANT may expand dense reconciliation/audit detail. Hide checksums, route names and internal enums under reviewer detail. The exact-card journey must work from a LINE deep link on mobile and meet WCAG 2.2 AA basics: readable Thai type, 200% zoom, keyboard/focus/error summary, non-colour-only status, sufficient contrast and 44px touch targets. Notifications go to the assignee, use due/overdue urgency plus a digest for non-urgent work, deep-link to the exact card and stop after acknowledgement/assignment/completion.
6. **Usability evidence is a launch input.** Before the first affected GA, run two iterative rounds of five representative users, including 40+ owners/finance staff with low technical confidence and working accountants. Test finding an urgent card, answering VAT registration with ภ.พ.20/“ไม่แน่ใจ”, assigning an accountant, completing a 50 ทวิ/correction packet handoff and recovering from stale/network/unknown outcome. A critical launch fails if a user believes WatchDog filed when it only recorded evidence, causes a duplicate action, cannot identify the deadline/next actor, or loses entered evidence.

### Thai accounting and document safeguards

- **Delayed input VAT uses two distinct routes.** The ordinary later-month credit route is limited to the statutory necessary-cause window—no more than six months counted from the month following the tax-invoice month—and requires the prescribed “ถือเป็นภาษีซื้อในเดือน...” evidence. After that window, do not carry the invoice into a current ภ.พ.30 automatically. Up to the applicable three-year limit, retain it as specialist review for the original tax month's additional return/cash-refund route with exact evidence and current channel validation; it is not an automatic credit, carry-forward or guaranteed refund. Beyond the applicable deadline, keep evidence and route to reviewed nonrecoverable/expired treatment rather than silently using it. Sources: https://www.rd.go.th/3386.html, https://www.rd.go.th/5207.html and https://www.rd.go.th/publish/seminar/seminar_31052560.pdf.
- **Internal approval, external receipt and RD outcome are separate facts.** Approving a correction packet authorizes the human next step only. A receipt/reference proves only the recorded external event and remains `RECORDED_EXTERNAL`; it is not `RD_ACCEPTED_VERIFIED`. Verified acceptance, rejection, needs-information or refund outcomes require their own authoritative evidence and successor state, and a receipt that differs from an approved packet/version returns to the same review card without closing the case.
- **Correction packets pin the local channel version.** A filed/external revision retains its immutable diff, packet/hash, exact form/route, RD Prep or other human-channel version, checklist and internal approval. A local application/template/channel change creates a successor revision/packet and one new approval; it never edits or silently reuses the old download. An OPEN automation route does not retro-submit a local/manual packet.
- **A replacement 50 ทวิ is not a correction.** `ใบแทน` preserves the certificate identity, number and statutory-content hash, is generated/copied only from retained counterpart evidence, is visibly marked “ใบแทน” and stores issuer certification/signature evidence. Missing SYSTEM evidence uses the scoped external replacement-copy handoff; changed content requires the separate new-number correction path.
- **Penalty and employee-receipt defaults stay conservative.** Show surcharge/penalty/interest separately from principal and label an amount **ประมาณการ** only when a current verified rule and reproducible inputs support it; the RD receipt/outcome remains final and a warning must not auto-post a charge. An employee-named receipt or reimbursement source does not by itself prove VAT nonrecoverability: default to `EXTERNAL_OR_UNRESOLVED`, prefill only evidence-backed recommendations, and gross up/reclassify only after the required company/tax-invoice facts or reviewed nonrecoverable decision.

### F0 derived evidence required before implementation exits

- Generate ERD/state/sequence diagrams from the approved matrices and contracts; diagrams explain but never override the normative text.
- Maintain a bilingual glossary mapping internal terms to permitted Thai customer copy, plus an invariant → named-test map for every final mutation and fallback.
- Produce a health/runbook per sellable feature and exact route: open/close owner, queue/runoff treatment, `UNKNOWN_EXTERNAL_OUTCOME`, manual fallback, alert threshold, rollback and explicit Resume/Reissue.
- Record representative load evidence for entitlement/gate claim latency and contention, global-card aggregation/dedup, batch WHT work, notifications and large-company report/card volumes. Optimize only when an agreed threshold fails; correctness locks and final guards are not weakened for throughput.

### No current owner choice; deferred decisions have explicit triggers

The owner does **not** need to choose a route per transaction, approve customer migration/mapping, decide whether a receipt means RD acceptance, or expose a public accountant link. Specialists and engineering may complete F0 evidence under the rules above without reopening those choices.

Deferred decisions are:

- a persistent generic work/task engine only if the minimal derived card plus scoped assignment cannot support measured journeys without duplicating domain truth;
- any external/public accountant portal only after invited-account completion is measurably inadequate and a separate identity, consent, expiry, revocation and download-audit security spec is approved;
- automatic post-six-month input-VAT handling only after a Thai specialist validates the exact original-period additional/refund route, evidence and current local channel version;
- a penalty calculator only after versioned rules and accountant golden cases reproduce current RD outcomes;
- automated correction submission only for an exact provider/RD contract whose request, response, failure and acceptance semantics pass the internal evidence gate;
- the PP30 in-product credit offset only under the already recorded v6 trigger; and
- performance-specific caching/batching only when F0/load telemetry misses an agreed SLO without weakening final guards.

## Remaining specialist and production gates (no open owner choice)

- **RESOLVED:** standard VAT uses verified pending 1155, refund receivable 1156 and distinct net settlement payable 2137; gross 2135 remains output VAT. Custom charts validate/reuse explicit roles or system-create each missing Thai role-tagged account without customer migration/name guessing.
- **RESOLVED:** reimbursement invokes shared full-confirm orchestration at finance review or final approval when no finance review exists.
- **VALIDATION GATE — WHT routes:** open `SYSTEM_INITIAL_ISSUE`, `SYSTEM_CONTENT_CORRECTION` and `SYSTEM_REPLACEMENT_COPY` independently only after that route's statutory fixtures, render-manifest reproduction, idempotency/race and fallback tests pass.
- **VALIDATION GATE — filing correction routes:** each exact `(formType,correctionRoute,channelVersion)` automation row remains CLOSED until current provider/RD request/response and failure semantics are proven. Manual packet + `RECORDED_EXTERNAL` is sufficient product behavior meanwhile.
- **VALIDATION GATE — VAT transition routes:** each exact `transitionKind` internal transfer remains CLOSED until Thai specialist conservation/accounting fixtures pass. External-first reconciliation remains available.
- **SAFE DEFERRED [LATER]:** `cap.thai_tax.vat_credit_in_product_offset` remains CLOSED throughout v5.1. The prefilled candidate mutates nothing; a separately confirmed PP30-only v6 mutation spec/plan plus Thai-tax validation is required before any OPEN path.
- **RESOLVED:** grandfather existing normalized effective access through the next confirmed renewal; preview and explicit command are required for an accepted package change.
- **RECORDED IN THE v5.1 AMENDMENT:** `ActionableWorkCard`/existing-workflow reuse, scoped accountant assignment, recovery/accessibility/notification/usability, delayed-input-VAT routes, WHT authority outcomes and F0 evidence are now explicit in both applicable Specs/Plans. Their implementation, specialist validation and launch evidence remain pending; documentation does not open a route.

## Artifacts

- Audit: `docs/agent-memory/feature-decoupling-impact-audit.md`
- Current normative baseline: `docs/specs/feature-entitlement-decoupling-spec.md` (CONFIRMED v5.1 product/UX)
- Current implementation plan: `docs/plans/feature-entitlement-decoupling-plan.md` (v5.1; begins at F0)
- Reconciled chart boundary: `docs/specs/chart-of-accounts-master-data-bootstrap-spec.md` §10.2.1

## Verification

- Core and post-review owner decisions are incorporated into the v5.1 Specs/Plans and reconciled with the verified repo seams plus the official Thai sources rechecked on 2026-07-31. Cross-document verification is recorded in `feature-decoupling-impact-audit.md`; implementation and specialist evidence remain pending.
- Final cross-document verification is recorded in `feature-decoupling-impact-audit.md`; documentation-only change, so runtime behavior and runtime tests are unchanged.

## Next

1. Begin Plan F0 traceability, exhaustive `(gateKey,routeKey)` matrices, derived architecture/test views, existing-`WorkflowTask` reuse survey, control-plane runbooks and capacity evidence; do not reopen the closed owner decisions.
2. Keep every specialist route row CLOSED until its own validation evidence passes. Continue the matching manual/external fallback without migration or re-entry.
3. Keep the LATER offset route CLOSED until a separately confirmed PP30-only v6 spec/plan exists.
