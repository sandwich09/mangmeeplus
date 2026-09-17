# Agent Memory: system UX audit for SME owners

Status: scoped UX corrections implemented locally; focused tests and representative desktop/mobile browser review complete. Local stack remains running for owner review. Full route/state/device acceptance and research with customers are not complete. Owner reauthorized CI and admin merge into develop/main on 2026-09-17; deployment remains outside this delivery.
Owner: Codex under the owner's request to review the whole Mangmee theme, cleanliness, action order and ease of use for older SME owners and nontechnical administrators.
Scope: mangmeeplus shared UI, company workspace, billing, authentication, admin, LINE entry/cards/rich-menu; mangmee_web source and published marketing page. Preserve the earlier local billing batch and merge hold.
Decisions: prioritize task clarity, error prevention, readable Thai, visible outcomes and safe recovery. Do not infer inability from age40+; evaluate low familiarity, interruptions, small-screen use and reduced visual contrast. Do not hide cancellation, bypass permissions, or weaken financial confirmations to simplify UI.
Open questions: no question required for this review. Actual brand-logo standard across marketing/workspace/LINE should be confirmed against the current brand assets before replacing any artwork. Suggested implementation priorities remain proposals.
Artifacts: [audit report](../research/mangmee-system-ux-audit-2026-09-16-th.md); [source inventory](../evidence/mangmee-ux-audit-2026-09-16/source-inventory.json). Worktree mangmeeplus-uat-release, same codex/uat-billing-native-20260916 branch; base2221b24d, serving UAT7ccff811. Sibling mangmee_web dirty files preserved.
Verification:
- Source inventory158page.tsx routes,51system routes,141feature TSX files; counts do not imply158screens visually tested. Review current P24/theme/mobile specs and shared tokens/button primitives.
- Native Chrome Developer: dashboard, expense pending list, receipt review, upload, billing, reimbursement list, company settings, AI suggestions, email access; published official marketing hero/pricing. Desktop1512×745 and selected company screens390×844. No financial, document or configuration mutation performed in this audit.
- Billing paid status begins at y941 on390px mobile; two verified-email panels precede it. Receipt review sticky primary/cancel/delete buttons span y684–832; first input y819, so the first fold emphasizes controls over review data. Scrolling remains available; do not label it an unreachable-field defect.
- Dashboard active filter15px white on#16a34a has computed contrast3.2957336053:1. Below normal-text WCAG4.5:1. Gradient endpoints alone do not prove every gradient label fails.
- Existing theme helpers/interactive-accent tests8/8PASS via `pnpm --filter @watchdog-bms/web exec tsx --test src/common/components/mangmee/mangmee-design.spec.ts src/common/components/mangmee/mangmee-interactive-theme.spec.ts`; no CI dispatch.
- Admin review uses current source and prior same-release local configuration screenshot, not a fresh logged-in admin session. LINE review uses the shipped asset/manifest and handler/card source, not current native-device rendering.
- Published official marketing still advertises Pro trial100receipts/5branches/10employees. Current local sibling template has an explicit15receipt trial block; published content is stale. No marketing deployment performed.
- Initial screenshot immediately after viewport change was a transient resize state; fresh AX/DOM confirmed390px layout and no document horizontal overflow. It is not counted as a layout defect. Temporary viewport override reset afterward.
Next: fold prioritized UI changes into the next owner-directed batch; update the existing P24/billing/LINE specs and plans before broad implementation. Preserve source-state, entitlements, permissions, idempotency, mutation confirmations and accessible cancellation. Keep no-merge/no-extra-CI/no-deploy hold. Do not claim all flows or human usability passed from this audit.

## Owner-authorized local implementation

Status: in progress after “แก้และ run local ดูหน่อย ฉํนจะตรววจ”. Scope and acceptance appended to system UI alignment spec/plan. Reuse existing components; local fixture data only. No merge/push/CI/deploy.

Local implementation finding: fresh TEST billing settings produced concurrent GET 409/P2002 from Prisma's empty-update upsert. Fix the shared settings initializer with conflict-safe insert plus read, retaining existing policy/gates/version; add real PostgreSQL concurrent-first-read coverage. Admin default landing moves to partners across web/API, preserving explicit next links.

## Local review handoff

- Customer: http://127.0.0.1:3000/login, seeded Owner account. Admin: http://localhost:3000/login, seeded ux.admin account. Different hostnames keep their browser sessions separate. Synthetic local credentials are in the ignored runtime setup, not production credentials. Marketing preview: http://127.0.0.1:3003/.
- API3001, PostgreSQL15442 (mangmee-ux-pg-20260916), Redis16390 (mangmee-ux-redis-20260916), MinIO19000 (mangmee-ux-storage-20260916). Local database mangmee_ux, synthetic seed and test receipts. Standard219migrations applied. Existing other local containers untouched.
- Runtime: `.env.kamal/local-ux-20260916/run.py api` / `web`; explicitly isolated environment, no Stripe secret key or Postmark token. Billing TEST mode displays configuration/trial rights but paid sales remain CLOSED. Mail local-console only. Marketing contact/signup external destinations are unchanged and were not submitted.
- Implemented: billing status first, verified email disclosure, clear primary return, quote scroll/focus; single receipt next action with recoverable secondary-action menu; dark green primary contrast; optional profile lower/collapsed; receipt queue first and CRM summary disclosure; compact reimbursement counts and secondary policy link; AI guidance disclosure; grouped responsive admin navigation and safe default landing at partners; technical workflow JSON disclosure; admin reauth beside final actions and visible error/result focus; local marketing CTA motion/seat copy/tax coming-soon clarification.
- Backend gap fixed: shared billing settings first-read initialization raced (native concurrent GET409/P2002). Real PostgreSQL regression failed before the fix and passed afterward; conflict-safe create keeps operator versions/gates unchanged.
- Verification: web/API typecheck PASS; focused web99 and session27, API53 including real concurrent settings test PASS; theme8 final recheck PASS (overlaps original99). Browser E2E6 PASS: profile390/1280, invalid draft cancel/back on390, attached/reviewed expense submit + source status, AI empty state, reimbursement list. No paid CI.
- Test-fixture issues resolved: isolated seed needs standard launch-gate bootstrap and MinIO; old EXP-04B omitted the now-required document evidence review. Updated that journey to attach/review a generated receipt and click “บันทึกการตรวจ”; backend validation was retained. That case requires S3_E2E=1; it passed locally without skips.
- Native Chrome: billing390px current rights top236px (audit previously941px), email settings collapsed, primary44px and white/#15803d contrast5.016:1, no horizontal overflow; billing return remounts sidebar/workspace. Receipt mobile shows only next/more in the sticky footer and secondary cancel/delete open above it. Admin390px menu collapsed and form has no early password prompt; draft save works, incomplete-provider preview gives an explicit error and retains fields. Marketing renders trial15 and no CTA animation. Temporary viewport overrides reset.
- Limits: no new live payment/email test, no full admin provider approval exercise in disconnected local setup, no new LINE rich-menu artwork or native LINE-device testing, no new logo/font system. Existing LINE bindings and artwork preserved; these are not claimed completed by the local web review.
Next: owner reviews the running local pages; collect adjustments before merge.

## Directory review follow-up

Status: implementing `/system/partners` only after owner feedback. Separate company/person views, colocate controls/results, Thai copy and server-side company search. Preserve metadata permissions, existing user lookup boundaries and URL return context. Asked whether shared admin sidebar belongs in this batch; directory work proceeds independently. No merge/push/CI/deploy. Stop after local handoff for owner review before another page.

Owner confirmed shared admin sidebar in this batch. Replace the horizontal menu with a persistent desktop sidebar, short topbar with environment badge, and a collapsible mobile menu. Keep permission filtering, support counts and logout behavior; remove duplicate global onboarding entry (company-page action remains). Other page content remains outside scope.


## Directory + sidebar local handoff

Status: implemented and verified locally, awaiting owner review of this page before further UI work.
Scope: directory company/person views, scoped search/status/results, Thai labels, compact company table, mobile user membership cards, shared sidebar/topbar. Company name/registered-name/full-ID search uses existing metadata endpoint before pagination. User status is applied before existing 20-result cap, with cap/search semantics disclosed. API permissions unchanged; no schema/dependency edits.
Decisions: URL search state retains both views and company page on return. Same-page search changes use synchronous native history integration; testing found asynchronous router replacement could overwrite text typed immediately after clearing, now fixed. Responses from obsolete reads are ignored. Environment badge uses DEPLOY_ENVIRONMENT, not APP_ENV=production (shared by UAT).
Verification: web/API typecheck PASS; API build PASS; API 37 tests and web 23 support/lookup checks PASS. E2E four distinct cases PASS: SYS-01 list, SYS-01A real DB 21-company pagination/search/registered-name/status/empty/clear/detail-back, SYS-01B mobile menu/Escape/user filtering/view state/503 retry, SYS-05 owner forbidden. SYS-01B rerun PASS after mobile membership cards; API validation two-test check rerun PASS after invalid query/large-page guards. Fixture companies removed in test cleanup. No full-console regression claim.
Native Chrome: desktop 1512px company directory and 390px company/user result layout inspected. Sidebar mobile collapsed, clear labels, no page overflow in E2E. Temporary viewport reset and http://localhost:3000/system/partners left open.
Runtime: API local3001 rebuilt/restarted from same isolated env; web local3000 remains live. Payments/emails remain disconnected from external providers. No merge, push, CI or deployment.
Next: wait for owner feedback on this directory and shared menu; do not begin another page.

Owner follow-up: search toolbar jumped when the conditional clear link appeared. Both company/user toolbars now always render a stable outlined “ล้างตัวกรอง” button; existing reset behavior is retained. No backend change or new test suite. Native company input before/after clear: x313, y334, width713.914px, height44px unchanged. Local hot reload; no CI/merge/deploy.


## Billing directory follow-up

Status: implementing owner-approved six-point payment-page UX review. Scope/spec/plan recorded in system UI alignment docs. Optional authorized count/page contract, same-scope results, navigation grouping, plain language, fixed clear button and error-only useful support details. Preserve company/issue mutations, cursor consumers and no-merge/no-CI/no-deploy hold.

## Billing directory local handoff

Status: implemented and locally verified; awaiting owner review of this page.
Scope: billing landing navigation/company directory and optional count/page overview read. Existing financial mutations and cursor clients preserved.
Decisions: owner clarified that Mangmee is the admin; removed all self-email contact destinations from this shared page. On read failure show retry and only an actual request reference for internal checks. Search, persistent clear, counts and results share one panel. Three main destinations (companies, cases, settlement checks), advanced investigation disclosure, secondary settings. Desktop table and mobile cards separate payment/access states, show trial only once and use actual term end dates.
Contract/security: optional page1..1,000,000 and fixed25/page; reject mixed cursor/page. Count and records use the same authorized company/search predicate. Legacy cursor clients do not add a count. No schema or payment-policy change.
Verification: contracts/API build, web/API typecheck PASS; pagination unit3 PASS. New e2e/billing-admin-directory.spec.ts:2 distinct cases PASS. Desktop uses26 isolated fixtures to check full-search counts, next/previous, detail/back context, no-result/clear, stable control geometry. Mobile uses its own trial fixture, checks menu/Escape, no overflow, correct trial copy, no mailto, actual503 request reference, retained draft/retry and queue navigation. Initial own-fixture rerun assumed trimmed draft; corrected assertion to require preservation of the typed draft, then mobile rerun PASS. Exact created fixtures cleaned in finally. Updated affected older smoke selectors; full payment-provider smoke scripts were not rerun for this read-only UX scope.
Native: Chrome1512px table and390px cards/tool disclosure inspected; reset viewport. Local http://localhost:3000/system/billing left open. API3001 rebuilt/restarted with the same isolated environment; web3000 remains running.
Limits: this is not whole-console or live-provider E2E acceptance. No new external payment/mail, cloud changes, CI, merge, push or deployment.
Next: owner reviews this page before another page is changed.

## Billing issue queue follow-up

Status: in progress after owner authorized the queue theme/UX correction.
Scope: `/system/billing/issues` list and shared billing navigation terminology. Reuse ThemedSelect and existing authorized cursor API. Detail financial actions, provider batch behavior and policy remain unchanged. Preserve no-CI/no-merge/no-deploy hold.
Next: implement list surface and targeted local browser verification, then owner review.

## Billing issue queue local handoff

Status: implemented and verified; awaiting owner review at http://localhost:3000/system/billing/issues.
Changes: queue heading/shared tab “ปัญหาการชำระเงิน” with payment/access explanation; secondary menu “ตรวจสอบกับ Stripe” distinguishes batch reconciliation after confirmation and received-status history. New BillingIssueDirectory uses existing ThemedSelect and a single themed panel for filters, always-present clear, secondary reload, count for this page, readable problem rows, loading/error/empty/disabled states and cursor paging. Each row has one details link; company, problem, owner/status and follow-up are separate. Shared company-list reload wording is also “โหลดรายการใหม่”.
Flow: filter/clear synchronously reset cursor via existing Next native-history integration; generation guards prevent obsolete reads. Detail/back keeps queue/cursor. Transient read errors keep navigation available;401/403 removes privileged navigation and stale results. Reload only reads stored data; provider/business commands unchanged. API/schema/policy unchanged this follow-up.
Verification: web/API typecheck PASS; e2e/billing-admin-directory.spec.ts3/3 PASS. New queue case uses27 isolated real DB issues (assigned/unassigned,26 overdue and1 future), exercises filters, page2, details and return/reload, clear, mobile dropdown and overflow, simulated503 actual reference/retry and403 stale-data/privilege removal. Asserts zero billing mutation requests. Existing two directory cases passed with updated navigation copy. Older case/SLA/batch smoke selectors updated for ThemedSelect/new navigation; full mutation scripts not rerun.
Native Chrome1512/390: empty state, themed dropdown and populated3-issue layout inspected. All temporary test/visual records removed; viewport reset and queue left open. Local API/web remain running. No provider payments/mail, CI, merge, push or deploy.
Next: owner reviews this page before another page is changed.

## Issue resolution walkthrough review (owner question)

Status: read-only code review completed; no new implementation authorized by this question. Owner asks how an operator proceeds from an issue to resolution. The list UX checks above do not prove every repair/closure flow.
Findings: issue detail supports a required note then taking ownership, status/follow-up changes, source links for some kinds and support-outcome records. These update work tracking; support records do not mutate payment/access or close cases. Paid-application issues currently require navigating back to the company then selecting the original invoice under apply-invoices; PAID_NOT_APPLIED/PAID_HELD do not have a direct issue-to-invoice action. Generic REFUND_FAILED also lacks a direct repair destination; CONTROL_OPERATION_REVIEW refund issues do link to the original refund command.
Potential closure bug from code review: reconciler creates PAID_NOT_APPLIED for invoice-apply failures, but successful invoice application resolves PAID_HELD only; RETRY_APPLY resolves its CONTROL_OPERATION_REVIEW identity rather than the original PAID_NOT_APPLIED identity. No PAID_NOT_APPLIED resolver was found in billing production source. Do not claim end-to-end issue closure complete; needs targeted regression and authoritative invoice/reference mapping before fixing. REFUND_FAILED similarly has detection without a specific closure path found; requires business/evidence review, not a blanket mark-resolved button.
Next proposed scope: guided issue detail by kind with clear action/return/result states; evidence-backed closure tests. Await owner's next scope instruction. No merge/CI/deploy.


## Actionable issue detail (owner: แก้เลย)

Status: in progress.
Scope: issue detail guidance + existing repair flow integration; root fix for verified invoice applied but PAID_NOT_APPLIED remaining open.
Decisions: preserve confirmation, audit, permissions and financial/access guards; optional tracking; exact company/account/mode original-source binding; proof-based closure, including already-applied retries and repeat purchases. No schema or provider policy changes.
Open questions: none for this scope. Refund/business review remains within existing workflows; no automatic financial decision.
Verification: pending focused local checks; provider isolation retained.
Next: implement and verify, then stop for owner review. No CI, push, merge or deploy.


## Actionable issue detail local handoff

Status: implemented and locally verified; awaiting owner review.
Scope: issue detail navigation/guidance, inline exact-invoice repair, optional tracking, and audited resolution of stale paid-application issues.
Changes: visible sequence “สิ่งที่ต้องแก้ → ดำเนินการ → ตรวจผลหลังดำเนินการ”; one primary action per repair step. Existing repair preview/confirm/hash/version/idempotency retained. Assignment can record a generated reason; taking ownership preserves saved priority/follow-up and clears a self-backup. Notes and contact records remain secondary and cannot grant rights. Source mapping is detail-only under the same authorized company/account/mode. Refunds lead to the original request when available and require financial read. Other kinds use existing source tools; no automatic financial decision.
Root fix: subscription/repeat/upgrade apply and original-invoice retry use one audited exact-reference resolver. Require APPLIED/appliedAt/evidenceHash/paid status/positive exact paid total. Already-applied invoices may be checked only while their application issue remains open; clean applied invoices stay final. Worker observes already-applied proof without Stripe calls or regrant. Failed/held/incomplete evidence and unrelated issues remain open.
Verification: contracts build, API build/typecheck, web typecheck and git diff --check PASS. billing-issue-resolution.pg.spec.ts5 subtests (6 TAP including parent) PASS. Existing directory/queue E2E3 distinct cases PASS; new issue detail E2E PASS on final code, exercising real auth/API/DB plus the actual compiled worker scoped to fixture company. Tests simulate historical provider proof, source outage and failed reconciliation. Two initial browser assertions selected the wrong semantic elements (duplicate status text and heading overridden by role=status); corrected selectors, final PASS. Test fixture JSON input type corrected; final typecheck PASS. No full native provider or whole-console regression claim. Older affected case/SLA smoke selectors updated but their full mutation harness not rerun.
Native:1512px desktop and390px mobile issue/repair/tracking inspected. Mobile document/viewport both390px. Temporary viewport reset. Chrome tab325831783 is left at http://localhost:3000/system/billing/issues/23f77a1a-b0fb-4aeb-bc4f-aa7851044f43 and marked deliverable. Local review fixture company local-ux-issue-review-20260916 is intentionally retained, labelled as synthetic; manifest/creation script in ignored .env.kamal/local-ux-20260916/issue-review.json and issue-review.cjs. Its invoice is HELD for visual review, with no real payment or provider call. Automated test fixtures cleaned.
Runtime: local API3001 rebuilt/restarted, exec session44505; web3000 remains running. Local DB mangmee_ux and fake account only; no Stripe/Postmark secret and no worker token added.
Next: owner reviews this detail before another page. No CI, push, merge, deploy or external payment/mail.


## Owner follow-up: detail drafts, theme and sequence

Status: implemented and locally verified; ready for owner review on the same page.
Scope: BillingAdminPage, BillingSupportOutcomesPanel, BillingIssueResolutionPanel and shared BillingOperationPanel; local regression and affected legacy smoke selectors only. No API business logic/schema/policy change in this follow-up.
Root cause: tracking save/contact callbacks incremented the page reload; its loading guard unmounted every detail child and native disclosure. Contact router replacement also dropped queue/cursor. Successful PATCH returns a partial issue projection, requiring a merge to retain exact original-source links.
Changes: scoped background issue/permission reads, monotonic versions and generation guards; update acknowledged fields and rebase unchanged fields while retaining drafts edited before/during a read. Save clears only its acknowledged note; taking ownership retains an unsent note. Transient failures preserve data; revoked access clears privileged detail and invalidates pending replies. Contact history uses same-page history state, preserving queue/cursor and draft panels. Contact controls use ThemedSelect/mangmee-input. Cancelled contact preview can be recreated unchanged with a fresh idempotency key. Team search/assignment is collapsed under เปลี่ยนผู้รับผิดชอบ; existing real permission-scoped delegation remains available.
Sequence: all three steps use the same white surface/dividers. Exact-invoice step3 read is disabled until a server-observed submitted repair exists; preview, cancel and support records do not unlock it. Existing submitted history for that invoice is recovered after returning. Source/operation reloads retain drafts; operation success is still distinct from audited issue closure. Other issue kinds continue linking to their existing tools.
Verification: web/API typechecks and git diff --check PASS. Entire local billing-admin-directory E2E4/4 PASS; final detail rerun PASS after rebasing untouched fields and adding 403/history recovery. Actual auth/API/PG and scoped compiled worker, synthetic previously-paid evidence, no provider calls. Coverage includes contact preview/submit/cancel/unchanged re-preview, tracking after contact version increment, team-search draft retention, exact DOM-node preservation across actions, source reload retaining repair reason, simulated503 detail/command recovery, preserved filter/cursor, confirmation ordering, prior-command recovery,403 clearing/retry, observed exact-invoice closure and no regrant. Initial rerun failed on a test selector matching Next's hidden route announcer; scoped to main, final pass. Older smoke selectors updated but full provider/legacy mutation suite not rerun.
Native review: retained fixture inspected in Chrome at1512px and390px, including themed contact dropdown and team disclosure; document and viewport both390px. No native fixture mutation performed in this follow-up. Existing review fixture/state retained. Local servers remain running.
Artifacts: docs/evidence/mangmee-ux-audit-2026-09-16/billing-issue-state-preservation.json.
Open questions: none for this page.
Next: owner review before another page. No CI, push, merge or deploy.


## Owner correction: one clear sequential repair journey

Status: implemented and locally verified; awaiting same-page owner review.
Scope: embedded original-invoice repair UX only, plus internal-reference explanation. No API/schema/provider or payment policy change. Other BillingOperationPanel callers retain their standalone controls and permission gates.
Changes: removed the reveal-only button, nested standalone heading/border, repeated instruction text and visible duplicate command history. Main journey: one ตรวจสอบรายการนี้ button → source-bound preview with ยืนยันแก้ไขรายการนี้ / ยกเลิกการตรวจครั้งนี้ → actual issue result. Future result action is hidden before submitted command evidence. Terminal command observations trigger an in-place issue read automatically; only actual RESOLVED renders completion. Preset editable reason is inside บันทึกเหตุผล; append sourceIssueId to the audited reason internally with matching input length bound. No UUID in main text/input. History/reference labels explain their purpose, use state/date links and omit the currently rendered command. One อัปเดตข้อมูล read refreshes source/command data inside the collapsed history, with a visible retry only when an error occurs. Cancellation returns to the same editable draft; historical cancelled commands remain available. No loss of other drafts or queue context.
Verification: final local billing-admin-directory E2E4/4 PASS (13.2s), including real HTTP/PG preview/cancel/re-preview/confirm, exact invoice/source issue audit binding, one initial visible action, two preview choices, no main UUID or duplicate current history, automatic actual issue closure, no regrant, retained cross-panel drafts/context,503/403 recovery and prior-command history. Web typecheck and diff check PASS. Provider proof remains synthetic; no external payment/email. Standalone provider-specific mutation suite not rerun.
Native: desktop1512 and mobile390 initial/preview states inspected. Buttons do not overlap; mobile document width390 equals viewport390. Created local PREVIEW records for visual inspection, never submitted a final repair. The mobile preview was cancelled through UI; the earlier desktop preview remains non-executable until explicit confirmation and expires normally (HMR reset its selection). Audit/history retained. Reopened the fixture's initial journey and restored viewport for owner review.
Artifacts: docs/evidence/mangmee-ux-audit-2026-09-16/billing-issue-sequential-actions.json.
Next: owner review before another page. No CI, push, merge or deploy.


## Owner correction: history destination

Status: implemented and locally verified; ready for owner review.
Scope: standalone billing operation detail opened from issue history; preserve embedded flow and all financial controls.
Decisions: one task/status/facts/next-action layout; raw audit data collapsed; safe explicit issue/queue/cursor navigation context; no new API/schema/policy.
Open questions: none.
Changes: operation detail uses a single white themed card with task/status explanation, separate Thai date fields, explicit next action, and collapsed original audit reason/internal references. No self-link or nested generic repair panel. History sends explicit issue/queue/cursor context; server route validates UUIDs and allowed filters and treats them as navigation only. Batch/direct links retained. Shared API/mutation/polling controller retained; detail read refresh shows loading, disables actions until current data is loaded, preserves old data on transient failure and clears details on401/403/404. Original allowedActions and preview/hash/version/idempotency preserved. Embedded panel remains otherwise unchanged.
Verification: local billing-admin-directory5/5 PASS (17.0s), final web typecheck and git diff --check PASS. New real HTTP/PG case traverses preview history → detail → explicit submit → queued cancel → issue → cancelled history; validates no main UUID, folded audit data, preserved queue/cursor, no issue closure or new receipt grants, and no mutation on mere navigation. Simulated status variants include succeeded/blocked/unknown/failed/running/readonly preview;503 retains data/disables mutations,403 clears/retry recovers. Invalid/repeated navigation inputs rejected; direct source and batch links checked. Existing four local cases remain passing. Synthetic payment proof only. Existing pg client.query deprecation warning observed; suite passed. No external Stripe/Postmark, CI, push, merge or deployment.
Native: Chrome1512/390 visual review of retained cancelled operation2fed4c9d-9abc-406e-ab6c-60dc53101673; mobile document/viewport390. Viewport restored; current detail left at top and marked deliverable. Native checks were read-only. Local web/API remain running.
Artifacts: docs/evidence/mangmee-ux-audit-2026-09-16/billing-operation-history-detail.json.
Limits: no full console/provider mutation-suite rerun; non-invoice delivery/provider/import presentation reuses existing contracts but not live provider execution.
Next: owner reviews this page before another page. No CI, push, merge or deploy.


## Billing menu operator UX (expanded by owner)

Status: implemented and locally verified; ready for owner review.
Scope: company billing landing plus all37 /system/billing routes theme/UX audit. User explicitly expanded beyond one page.
Decisions: overview first with actual package/access/receipts and direct issue links; URL-backed invoices/history/manage sections. Draft inputs survive section changes/company reads. Financial pagination stays in payments; timeline lazy-loads only when selected. Technical IDs/export/reconciliation folded; plan tooling asks which task before showing a form. No automatic mutation on navigation. Existing preview/confirmation/hash/version/idempotency/audit/permission contracts retained. Shared invoice page has separate admin advice and customer contact behavior.
Findings fixed: competing default repair forms and long history; raw references in primary view; black currentColor borders; OS selects/unlabelled custom selectors; custom controls not respecting a disabled policy fieldset; admin self-email loops; accidental impression that paid/apply/access are one state. Source NONE/null plan does not imply unlimited receipt quota.
Open questions: none for UI scope.
Verification: Playwright billing-admin-directory + billing-admin-menu-ux10/10 PASS42.2s. Existing5 regression tests pass; new5 cover real company pagination25+1/history25/drafts/URL/403recovery, plan task switching, invoice admin documents/refund disclosure, settings capability locks, and all37 mobile route smoke paths. Web typecheck and diff check PASS. Native Chrome1512/390 company overview/manage/history and desktop settings visually inspected, viewport restored. Final copy directs to overview rather than “below” because the issue panel is hidden in other views.
Artifacts: docs/evidence/mangmee-ux-audit-2026-09-16/billing-menu-operator-ux.json; e2e/billing-admin-menu-ux.spec.ts.
Limits:37route smoke includes missing detail IDs for recovery; not every populated financial mutation/state was executed. Plan/invoice variants are UI contract fixtures. No new live provider payment/refund/email or full customer shared-invoice E2E. Existing PG test warning did not fail tests. No API/schema/policy change this turn; no package.json/dependency edits; no CI, push, merge, deployment or cloud action.
Next: user reviews local company page /system/billing/companies/local-ux-issue-review-20260916; local web/API remain running. Preserve earlier uncommitted work and do not merge until user says so.

## Five billing destinations: owner rejected task clarity

Status: in progress.
Scope: five supplied screenshots (settlement, documents/error, apply-invoice, plan unavailable, settings).
Decisions: task-first layout, secondary refresh/back, named factual fields, actionable errors, existing themed date reused; settings topic selection and stage separation. Previous37-route smoke is insufficient evidence of comprehensibility. Preserve financial/security guards and local-only scope.
Open questions: none.
Next: implement then verify populated/error journeys; no CI/push/merge/deploy.

### Five billing destinations — implementation and local verification complete

Status: Ready for owner UX review on local; no merge/deploy authorized for this pass.
Decisions:
- Settlement uses yesterday / previous 7 complete Bangkok calendar days, with a themed Thai date plus explicit HH:mm for custom ranges. Preserves exclusive end, 31-day limit, one-minute lag, existing idempotency and run controls.
- Documents prioritize invoice/receipt opening. Refund history and new refund requests are secondary. Read failures distinguish source binding, denied, missing, pending and connection failures; no guessed permission advice. The existing synthetic retained invoice is intentionally unbound to a Stripe customer; the screen reports this honestly.
- Paid invoice repair separates payment evidence from activation state and gives one next action; refresh preserves its local draft. Existing preview/submit/source-hash guards remain.
- Plan changes show the company state and one task. A missing active paid plan directs the admin to company payments. Refresh is within its data card. Date/time entries use the same Bangkok helper.
- Settings show current values, then one editing topic. Fields remain mounted across topic switches. Invalid hidden fields reopen their topic. Preview replaces the editor; password confirmation precedes enabled submit/approve. Emergency closure is separately disclosed. Draft cancellation remains available. Existing policy/gate permission boundaries and request shapes remain.
Artifacts: BillingDateTimeField.tsx, billing-date-time.ts, five destination components, BillingOfferTermsEditor.tsx, e2e/billing-admin-menu-ux.spec.ts; evidence `docs/evidence/mangmee-ux-audit-2026-09-16/five-billing-destinations.json`.
Verification:
- Full local Playwright directory + menu UX run: 14 passed, 1 failed on test label / heading accessibility (no provider mutation).
- After fixes: settings stage/draft validation + settlement default/range/idempotency tests: 2 passed, 4.4 seconds.
- After final layout adjustment: plan task and paid invoice repair draft/recovery tests: 2 passed, 5.5 seconds.
- 15 unique checks now pass, including one 37-route mobile navigation/layout smoke. Populated states use local isolated DB or explicitly mocked API responses as recorded in tests.
- Web typecheck passed after final code; git diff --check passed.
- Native Chrome: settings current values/topic, settlement presets/custom Thai calendar, invoice binding error, original-invoice repair facts/action, blocked plan recovery. Mobile settings checked, viewport reset; localhost settings marked deliverable.
Limits: No actual Stripe payment/refund, Postmark mail, UAT or production configuration changed. Mocked settings preview did not save/publish a real policy. No CI/push/merge/deploy. Preserve the retained owner's local review fixture and earlier uncommitted work.
Next: Owner reviews the local UX. Further changes stay local until explicitly authorized otherwise.

### Settlement result follow-up — in progress
Owner cannot understand the blocked run detail. Local runtime wrapper confirms `BILLING_MODE=test`, Stripe secret absent, worker token absent (booleans only inspected). StripeClient rejects missing configuration before any network request, but settlement stores the broad SETTLEMENT_SOURCE_REVIEW code; do not call that proof of mismatched money. Scope is result presentation and action hierarchy, preserving server permissions/version checks and the user's run/input. No provider credentials, run state or cloud changed. Primary fix: unknown totals are not zero; one next action, explicit secondary resume/cancel, references folded. Relevant spec/plan appended above.

### Settlement result follow-up — complete locally, awaiting owner review

Status: Implemented and verified on 2026-09-17 (Bangkok).
Decisions: hide monetary totals until at least one row is checked or the run completes; confirmed empty results may show zero; partial totals remain explicitly incomplete. Show outcome and one next step first. Source review directs to connection checks; retries require acknowledgement and cancellation has a separate confirmation. Retained SOURCE_REVIEW after resume remains visible until a successful run clears it. Tracking and technical references are secondary, avoiding the issue-to-run navigation loop as a primary action.
Verification: Two new Playwright result/command tests passed (4.2s and 1.5s). Existing settlement form regression initially failed because actual time crossed Bangkok midnight and the one-minute source delay correctly blocked the selected interval. Fixed the test clock, preserving the production guard; rerun passed (1.6s, 2.9s total). Final web typecheck passed. Native Chrome inspected the actual result page and next-action layout; original custom-date form untouched. Diff whitespace check passed. Evidence: `docs/evidence/mangmee-ux-audit-2026-09-16/settlement-result-clarity.json`.
Limits: Result-state/action tests mock run/provider responses; they do not prove live financial reconciliation. No API/service/schema change, credentials added, provider requests, original run mutation, CI, push, merge or deploy in this correction. Local Stripe configuration is still absent.
Next: Owner reviews http://localhost:3000/system/billing/settlements/4f9f876d-7859-4506-a527-eb10f8eb258f. Local services remain running. Keep earlier dirty work and the owner's local fixtures/drafts.

### Email, LINE and company detail organization — complete locally

Status: Implemented and verified on 2026-09-17; awaiting owner UX review.
Owner: primary agent.
Scope: email status/retention, shared LINE settings and the long company detail screen supplied by the owner. Local presentation and draft handling only; existing API/security/audit/final-mutation contracts retained.
Decisions: email summary and history first, filters/clear/refresh together, secondary connection and retention disclosures. Seven-day summary remains distinct from history pagination; missing configuration is not reported as zero. History refresh no longer remounts the retention editor. LINE shows readable configuration, token validation and inbound signed data as separate facts; key replacement is folded and still requires review/password/acknowledgement. No real credentials entered. Company detail has five URL-backed sections (overview, members, package/features, AI/quota, contact/history); visited sections remain mounted to preserve drafts, support context defaults to contact, browser back/forward works. Feature categories shorten the editor; readonly users can search while mutation locks remain. Member actions, model changes, adjustment history and internal references are secondary disclosures.
Open questions: none for this UX scope.
Artifacts: SystemEmailDeliveryPage.tsx, EmailHistoryPolicyPanel.tsx, SharedLineSettingsPage.tsx, PartnerDetailPage.tsx, e2e/system-settings-ux.spec.ts; updated SYS-02/SYS-04 in e2e/system-admin.spec.ts. Spec/plan updated. Evidence: `docs/evidence/mangmee-ux-audit-2026-09-16/email-line-company-ux.json`.
Verification: final focused local Playwright run 5/5 PASS (12.1s). Web typecheck and git diff --check PASS. Tests cover filters/pagination, draft preservation across refresh/navigation, support query context, denied/missing configuration, preview separation, mobile 390px overflow and absence of unexpected writes. SYS-04 verifies existing off/on/off feature confirmation using an isolated local company fixture. Initial company test exposed a readonly search lock; corrected and final rerun passed. Native Chrome desktop visually inspected all three pages; company overview, email and LINE tabs marked deliverable.
Limits: email/LINE provider states use mocked API responses, not live provider E2E; company navigation uses real local reads and feature mutation uses a disposable local fixture. No original company mutation, message/email, provider inspection, credential update, package.json/dependency change, cloud action, CI, push, merge or deployment.
Next: Owner reviews http://localhost:3000/system/partners/seed-local-company?view=overview and the open email/LINE tabs. Local web/API remain running. Preserve all earlier dirty work and owner drafts; no merge until explicitly authorized again.

### Local review company feature switches — repaired

Status: Local data repair completed and verified on 2026-09-17; ready for owner review.
Scope: `seed-local-company` in local `mangmee_ux` on loopback port15442 only. No application guard or API changed.
Cause: seed company had zero feature entitlement rows, no entitlement set and no normalization marker. Legacy read fallback displayed features as enabled; both UI and server correctly refused editing until normalization. Previous isolated SYS-04 proof did not establish readiness of the retained owner review company.
Decisions: reuse `normalizeCompanyEntitlements`, first dry-run then bind apply to reviewed hash `7dac52259cd8b375ee52791101f86cbda068cf368370d29d7c30673403ea89fd`. All60 writes preserve their effective before/after values (59 enabled, automatic posting remains off); no dependency exceptions, orphan deletions or access expansion. Existing normalizer writes set version, transitions, audit and completed marker atomically. Do not fake a COMPLETED marker or disable the safety gate. Other companies untouched.
Verification: scoped `verifyCompanyNormalizations` total1, incomplete0, drift0, provenance gaps0; repeat apply returns ALREADY_COMPLETED with zero writes. Native Chrome reloaded agent review tab, confirmed controls enabled, toggled a draft and restored it without saving. Retained seed feature values unchanged. Focused SYS-04 local E2E off/on/off confirmed and persisted on an isolated fixture: 1/1 PASS (5.1s). No code/typecheck required for this data-only repair.
Artifacts: `docs/evidence/mangmee-ux-audit-2026-09-16/local-company-entitlement-repair.json`; ignored local runner and before-state artifact under `.env.kamal/local-ux-20260916/`.
Next: Owner can use the package/features tab after refreshing any older open tab. Future local review setup must check actual company's editable readiness, not only isolated fixtures. No CI, push, merge, deploy, cloud or real provider action.

### Dashboard overview correction — ready for review

Status: Completed locally on2026-09-17.
Scope/decision: owner asked to remove the standalone pending-receipt banner and return the incomplete-shop reminder to the top. Removed the banner and its derived variable in DashboardPages.tsx; moved the existing permission-gated ProfileCompletenessCard immediately after the heading/period controls. Existing overview widgets, links, snooze and disclosure behavior retained. No API/data/policy change.
Verification: existing e2e/profile-completeness-card.spec.ts tests at390/1280 passed2/2 (5.9s), web typecheck and git diff --check passed. Inspected1280px test screenshot with reminder above overview. Native Chrome dashboard has no standalone review banner; its profile reminder is currently snoozed by the user and that preference was not reset. Local dashboard left open. Spec/plan updated.
Next: owner reviews local dashboard. No CI, push, merge, deploy or provider request.

## AI contextual navigation — owner approved 2026-09-17

Status: implemented and locally verified; waiting for owner review.
Scope: hide AI suggestions primary navigation and move its admin switch to existing background-work section. Existing deep-linked reviews stay accessible with original permissions. No provider, entitlement, quota, migration or final-mutation changes.
Decisions: shared contextual binding metadata; unchanged starter 17 keys. Seven capabilities now presented as six navigation entries (notification in header) plus background AI. Preserve local user drafts and preference snooze. No CI/push/merge/deploy.
Verification: contracts build and web typecheck PASS; web logic118/118, API binding8/8, AI browser2/2 (no skips), git diff --check PASS. Evidence: docs/evidence/mangmee-ux-audit-2026-09-16/ai-contextual-navigation.json. Native admin background switch is enabled with zero pending changes. Owner browser session changed to system-admin, so native dashboard denies access; isolated browser tests verify customer navigation without changing native login. No provider calls or whole-AI-flow completion claim.
Next: owner review of local UI; no further scope or merge authorized. Admin company package page is left open because native browser is signed in as system-admin.

## Expense export layout — 2026-09-17

Status: completed locally; verification recorded in the final follow-up below.
Scope: replace inline details with stable button and existing themed Modal; retain export format and request semantics. Show export errors/warnings inside the dialog. No package/quota/API/provider change.
Verification: pending focused local layout/error/filter-retention browser checks at desktop/mobile and web typecheck.
Next: local handoff; no CI, push, merge or deploy.

## Receipt, signature, reimbursement and profile follow-ups — 2026-09-17
Status: completed locally; verification recorded below.
Scope: keep receipt date empty unless AI/user supplied; stable export dialog; responsive signature steps; reimbursement title/action above tabs; separate shop/account settings with focused email/login editing.
Plan: reuse existing date status/resolution and confirmation guard, shared theme components; retain drafts when switching sections; preserve permission/OTP/idempotency checks. No migration, provider calls, CI, merge or deploy.
Verification: export dialog layout/focus/format/error checks pass at 1280 and 390px (2); existing export filter retention checks pass (4). Remaining checks pending.

Owner follow-up: remove the receipt-date control from upload completely. Keep optional note; AI reads document date, user supplies/corrects it in review. The no-date intake/unknown-date guard remains required.

Owner follow-up: upload instructions should have no connecting arrows, matching the shared numbered instructions. Reuse HowItWorks.

### Branch and account theme follow-up — 2026-09-17
Status: completed locally; verification recorded below.
Scope: owner screenshots of branches and account settings. Use shared page/card/badge/button theme, flatten account cards, align actions and facts, consistent disclosure controls. Branch editing should stay focused and mobile readable. Keep existing permission, validation and auth contracts; no account changes or real branch writes for visual checks.
Verification: focused browser checks and web typecheck pending.


## Final local follow-up: receipts, account theme and billing navigation — 2026-09-17

Status: Implemented and locally verified; ready for owner review.
Owner: primary agent.
Scope: finish the owner's receipt upload, export, signature, reimbursement header, branch, shop/account and sidebar corrections. Preserve earlier dirty work and local fixtures.
Decisions:
- Receipt upload has no date control or fabricated current date. AI or review user supplies it. Existing required storage placeholder is explicitly marked unverified/missing atomically; UI hides it and confirmation remains guarded. Explicit user date resolution survives later OCR/summary updates. No schema migration.
- Upload/signature instructions use shared numbered responsive cards without arrows. Export uses the existing Modal; error, format and focus remain in the dialog without moving the expense list. Reimbursement heading/create action is separated from tabs.
- Shop/account sections preserve mounted drafts. Account email/login editor is focused, cards flattened and theme aligned. OTP is described as a one-time six-digit code sent by email on each login; login marketing about free signup removed, signup policy unchanged. Phone accepts digits up to 10, tax ID digits up to 13, including formatted paste; existing save validators still enforce completeness/checksum.
- Branches use shared page/card/table/badges, labelled mobile cards and a focused create/edit Modal. Errors preserve draft; last-active-branch recovery and existing permissions remain. No real branch writes in visual tests.
- Billing is one OWNER-only child under ตั้งค่าบริษัท, using normal navigation styling instead of the separate bordered footer button. OWNER retains this entry even without any feature-backed settings items. Existing billing recovery routes and server ownership guards remain unchanged; no entitlement expansion.
Verification:
- API targeted receipt/OCR files: 194 passed initially; two further extraction tests added, extraction file 45 passed (196 distinct tests across the four targeted files). LINE upload 2 passed. API typecheck passed with 8 GB heap after a 4 GB OOM; API build passed and local runtime restarted successfully.
- Web selected workspace/profile/branch unit tests: 177 passed (/tmp/mangmee-settings-final-unit.log).
- Export layout/error/focus tests 2 and prior filter-retention checks 4 passed. Receipt date UI/API and signature desktop/mobile 4 passed (/tmp/mangmee-date-final.log); own temporary receipt drafts cleaned by guarded test cleanup. Reimbursement desktop/mobile checks passed in the earlier 8-test follow-up.
- Branch, profile and billing navigation focused browser checks 5 passed (/tmp/mangmee-settings-final-browser.log). Last branch/profile/upload round 5 passed (/tmp/mangmee-ui-last-verification.log). Profile screenshots refreshed at scroll top after interaction to avoid fixed-header screenshot artifacts.
- Final web typecheck and git diff --check passed. Screenshots in docs/evidence/mangmee-ux-audit-2026-09-16 (profile-focus, branches, branch-editor, receipt-upload-steps, signature-steps, reimbursement-header).
Limits: Local actual reads plus intercepted mutation/provider states; not a full provider E2E claim. No actual email OTP, LINE, Stripe or Postmark call. Native browser session changed while reviewing; no forced login/logout. Final native dashboard shows package link grouped correctly under settings. No package.json/dependency edits, CI, push, merge, cloud changes or deployment. Services remain running.
Next: owner local UX review; preserve existing data/drafts and do not merge or deploy without renewed authorization.

## LINE login visibility follow-up — 2026-09-17

Status: Implemented and locally verified.
Owner: primary agent.
Scope: owner asked why LINE login disappeared on the local login page.
Cause: live local availability endpoints returned false. The isolated local runner has LINE_WEB_LOGIN_ENABLED=false and no LINE Login channel ID/secret (presence only inspected, no secrets output). LoginPage previously hid the entire LINE section whenever availability was false or unreadable. This was environment configuration, not removal of the OAuth flow.
Decisions: keep the LINE entry visible, disabled until readiness is confirmed; distinguish loading, configured unavailable, and failed check. Explain unavailable and offer retry on failed reads without resetting password/identifier drafts. Keep QR entry gated on confirmed availability and desktop. BFF returns 503 for upstream error/malformed response instead of misreporting a deliberate disabled state; bounded timeouts. The OAuth start/callback, flags, credentials, identity/link/nonce/PKCE/session guards remain unchanged. Do not enable a non-working provider in local or infer UAT/production state.
Artifacts: LoginPage.tsx, line-login/availability/route.ts, LoginPage.spec.ts, line-login-availability-route.spec.ts, e2e/login.spec.ts; login-line-unavailable-1280/390 screenshots in evidence folder.
Verification: 3 focused web unit checks passed (/tmp/mangmee-line-login-unit.log). Browser desktop1280/mobile390 tests 2 passed (2.3s, /tmp/mangmee-line-login-browser.log): loading/unavailable/error/retry, unchanged unsaved input, responsive QR and next-path preservation up to an intercepted OAuth boundary. Initial selector exposed decorative L in button accessible name; aria-hidden added, final passed. Web typecheck and diff check passed. No LINE provider request or native account change. Native /login recovered an existing owner session and redirected to dashboard, so logged-out visual verification uses isolated Playwright contexts rather than signing the user out.
Open questions: none for visibility. Real local LINE login still requires valid provider configuration; not enabled by this UI fix.
Next: owner reviews local screen. No CI/push/merge/deploy or cloud/provider action.

## Customer billing journey/theme correction — 2026-09-17
Status: completed and verified locally; ready for owner review.
Scope: customer package overview, company picker and invoice-document return journey. Owner reports inconsistent theme, no exit from picker and unexplained กลับไปใช้งาน/ตรวจสอบสถานะ actions.
Findings: POST refresh only schedules existing billing-account reconciliation; no account returns queued=false. Trial/no-payment users have nothing to reconcile. Server layout bypasses business shell for billing, but a cached client layout retains it on soft navigation, causing two appearances for the same route.
Plan: shared lightweight branded billing frame with explicit destinations; client pathname boundary keeps the normal shell for ACTIVE companies and excludes business-shell queries for expired/held/error recovery, including cached layouts. Active-shell overview has no redundant back-dashboard action. Picker carries a validated originating company ID and resolves it against fresh owner membership for its return link; direct entry has a home exit. Theme current package facts/history/email controls. Show payment recheck only when there is payment/subscription evidence and state exactly what queued means; trial overview has no financial recheck CTA. Preserve owner/recovery/security/quote/consent/provider guards and all existing mutations. No cloud/provider calls or real payment.
Acceptance: same theme after sidebar entry/reload/picker return, no redundant overview back/company-switch CTA when the header/sidebar already provides navigation; named back links on standalone recovery/picker/documents, no POST refresh merely navigating or for trial, clear queued/error behavior, mobile no overflow, expired/denied owners retain recovery without business-shell reads. Focused local tests and typecheck; no CI/push/merge/deploy.

Owner corrections during implementation: the existing header company switcher is the single company switch control; remove overview picker CTA. Preserve billing destination on owner company switch, but retain expired renewal and non-owner dashboard guards. Flatten the account-email UI into one themed card with a single email/status row; show verification instructions/help only while needed. Keep company document recipient distinct because its mutation is separate from account email. Package changes already exist behind server new_sales/plan_changes actions; do not enable flags or change eligibility. Replace ambiguous sales-closed copy and avoid implying an expiry date exists when the API has none.


### Customer billing final evidence — 2026-09-17
- ACTIVE companies keep the shared workspace header/sidebar on direct and client entry. Expired/held/denied recovery mounts only safe billing content, with explicit exits. Existing server account/company/legal gates remain intact.
- Overview uses shared page/cards/badges/buttons. Removed redundant back-dashboard and company-picker actions; owner company switch from billing preserves the billing destination, discarding prior company invoice/query identifiers. Expired targets retain renewal routing; non-owner targets retain dashboard routing.
- Verified account email renders once in one card, with one change action. Verification guidance and help appear only when needed. Failed editor requests preserve unsaved inputs. Company recipient stays a separate section because changing account email does not automatically change recipient; existing preview/submit/OTP/idempotency boundaries are unchanged.
- Backend already supports upgrades through purchase quotes and scheduled downgrades through plan_changes. Current local companies report COMPANY_SALES_CLOSED. No policy/gate was enabled; copy now explicitly says the company cannot buy/change packages on the web. Missing plan/date data is labelled as missing rather than implying an expiry date.
- Payment recheck appears only with payment/subscription evidence; it schedules reconciliation, not payment confirmation. Read-only update remains distinct. Trial overview has no recheck. Document pages return to payment history; standalone picker resolves return company against fresh owner memberships.
Verification: customer-billing-ux 5/5 PASS (15.7s, /tmp/mangmee-customer-billing-browser.log): desktop1280/mobile390 navigation, header company switching, email draft/error preservation and distinct recipient, mocked queued/failed refresh and document return, expired-shell suppression and rejected unowned return ID. Refreshed two navigation screenshots after waiting for data hydration: 2/2 PASS (10s, /tmp/mangmee-customer-billing-visual.log). Workspace/session-gate existing unit suite108/108 PASS (/tmp/mangmee-customer-billing-unit.log); web typecheck PASS (/tmp/mangmee-customer-billing-types.log); git diff --check PASS. Native retained owner tab visually verified and left on billing. Mobile390 overview inspected. Evidence billing-overview-1280/390.png and billing-picker-1280/390.png copied to task evidence folder.
Limits: reads against isolated local fixtures plus intercepted OTP/provider/error operations. No actual email/provider/payment mutation; not a live Stripe E2E claim. Existing API smoke text selectors updated for final wording but complete payment smoke scripts were not rerun. No dependency/package.json, CI, push, merge, cloud or deployment changes. Local services remain running.
Next: owner local review. Do not enable sales or deploy without a separate authorized task.

## Account email duplication and OTP flow — 2026-09-17
Status: completed locally; final evidence below.
Scope: remove personal account-email editor from billing, fix account change-email request validation/progression and password visibility, clarify login OTP action wording.
Findings: same verified email returns unchanged READY state without sending; UI failed to explain this, leaving repeatable request. Server still requires current password or fresh session-bound LINE proof for a different address. Password input sat outside the request form. Existing server challenge/cooldown/idempotency mechanisms remain authoritative.
Decisions: retain one shared account editor in account settings; billing reads verified-email state without editing and invalidates quotes on changes/failure. A thin authenticated account-email recovery page reuses that editor for expired companies, since business profile reads are term-gated (optional-email billing spec §5.2). No company permission or API security bypass. Only conditional verification links; no always-visible duplicate billing editor. Request requires a new address and password (or fresh LINE reauth); show OTP entry after challenge creation, prevent concurrent/repeated sends, respect server retryAt, expose password eye and reauth recovery for expired proof. Login entry says เข้าสู่ระบบด้วยรหัส OTP, next page explicitly sends to email.
Acceptance: same verified email/blank required password send no request; eye accessible; successful request transitions to 6-digit confirmation with countdown, retry/error preserve drafts, confirmation updates email; no actual mail/provider calls in verification. Billing retains recipient controls and fails closed for email reads; active and expired verification destinations work.
Verification: pending focused browser, existing QA and typecheck. No package.json/dependencies, cloud, CI, push, merge or deployment.

### Local full package journey preview requested during OTP work
Owner clarified: wants every step visible to iterate UX, including choosing packages and the purchase flow. Build an explicitly labelled local-only preview using the existing billing components and in-memory fixtures. Gate the preview route server-side to development + APP_ENV local + existing owner session; no mutation calls, provider navigation, credentials/card entry, feature-gate changes or database writes. Cover monthly/annual selection, review/consent, capacity selection, a clearly simulated provider handoff, pending/success/failure/expired/upgrade states, renewal controls and document handoff. The Stripe-hosted screen is represented by an explicitly labelled simulator, not claimed to be the live provider UI. Provide scenario navigation and reset for review. Reuse contract billingOffer presets; mark prices/data as samples. Main production page gains no sales authority or provider bypass; adapters supplied only from the dev route.


### Account OTP and full package preview: final local evidence — 2026-09-17
Status: implemented and verified locally; native owner preview tab left open for UX review.
Owner: primary agent, worktree mangmeeplus-uat-release (codex/uat-billing-native-20260916).
Scope/decisions:
- Supersedes the earlier billing-email editor behavior: personal email can only be edited in account settings or the authenticated recovery account page. Billing reads readiness and retains the distinct company document-recipient operation. Email changes/read failures invalidate quote and consent. ACTIVE links go to profile#account; expired owners use /account/email and return to the same company/interval without business data queries.
- Account-email request requires a different/new email and current password when required, or existing fresh LINE reauthentication. Same already-verified email explains why no request is sent. Password eye is labelled and keyboard accessible. Challenge creation advances to a focused six-digit OTP entry and server retry countdown. Request in-flight/cooldown guards prevent duplicate sends; expired reauthentication can recover at resend. Errors retain drafts; successful confirmation closes the editor. No backend reauthentication or OTP security rule changed.
- Login entry now says เข้าสู่ระบบด้วยรหัส OTP with an email/six-digit explanation. Email entry says ส่งรหัส OTP ไปที่อีเมล.
- Local owner route /companies/[companyId]/billing/preview reuses BillingPage, capacity, renewal and document-history UI with complete in-memory API adapters. Server rejects outside development + APP_ENV=local and requires OWNER. The real billing overview links to it only under that local gate.
- Preview covers monthly/yearly plans, capacity selection, quote/consent, explicitly simulated Stripe handoff, pending/activation/success/failure/held/expired results, upgrades and scheduled downgrades, renewal cancellation/resume, history and document/portal handoff. Scenario/reset controls clear simulated data; displayed annual dates use the selected period. Preview collection links stay in preview. Provider screens/documents are explicitly illustrative; no real card form, financial event or lasting preview ID.
- Fixed quote-heading scroll offset to respect the actual workspace header height, including mobile. Native desktop and saved mobile evidence visually checked in the existing theme.
Verification:
- Existing profile QA, login and middleware unit checks: 42 passed, 0 failed (/tmp/mangmee-account-otp-unit-final.log).
- Account OTP desktop1280/mobile390, error/rate-limit and resend reauthentication checks plus LOGIN-01: 5 passed (/tmp/mangmee-account-otp-browser-final.log). Mail/auth mutation responses intercepted; no credentials or actual account email changed. Existing LINE visibility tests also passed at both widths during this turn.
- Command: python3 .env.kamal/local-ux-20260916/run.py pnpm exec playwright test e2e/billing-preview.spec.ts e2e/customer-billing-ux.spec.ts --project=chromium --workers=1. All 7 passed (/tmp/mangmee-billing-final-regression.log), including read-only account email/recipient failure guard, recovery destination and workspace/picker/document navigation.
- Preview checks assert zero billing mutation requests and zero Stripe requests across plan selection, review, capacity, simulated checkout/outcomes, receipt/history, renewal stop and scheduled downgrade; no horizontal overflow at 1280/390. Final 2 preview tests passed after adding quote heading visibility assertions and refreshing screenshots (/tmp/mangmee-billing-preview-browser-final.log).
- Web typecheck: python3 .env.kamal/local-ux-20260916/run.py pnpm --filter @watchdog-bms/web exec tsc --noEmit passed (/tmp/mangmee-billing-preview-types-final.log). git diff --check passed.
Artifacts: apps/web/src/features/billing/BillingPreviewPage.tsx, billing-preview.fixture.ts, local preview route, account recovery route, e2e/account-email-otp-ux.spec.ts, e2e/billing-preview.spec.ts and existing billing regression updates. Screenshots billing-preview-plans-1280/390.png and billing-preview-review-1280/390.png in this task's evidence folder.
Limits: This is local UX preview, not a live Stripe/payment/email delivery E2E claim. The customer purchase gate remains unchanged; no provider call, company package/data change, package.json/dependency edit, CI, push, merge, cloud or deployment action. Original checkout untouched; existing dirty work preserved; local services remain running.
Next: owner reviews every local preview step and provides UX corrections. UAT/Production are unchanged.

## Billing hierarchy and theme follow-up — 2026-09-17
Status: implemented; final integration verification and CI delivery in progress.
Scope: owner requests a sequential, themed package journey with minimal, non-duplicated content, based on the full preview screenshot.
Plan: reuse profile-style section navigation for package / renewal and payment / history; default to a compact current-plan summary with explicit choose/change action. Show plan choice, optional capacity, then quote/consent one step at a time. Put document actions on the existing document page; keep recipient and card settings under payment. Remove redundant confirmed-payment rechecks/resume, repeated success/reference/date text and expanded completed-operation detail. Renewal confirmation hides competing actions and keeps financial effects/consent visible. Compact the local preview toolbar while retaining explicit simulated-data notice. Compute annual savings from same-catalog monthly/yearly prices, never assume a fixed discount or change prices.
Boundaries: UI only, preserve API quotes, catalog expiry, OTP readiness, policy/permissions, idempotency, recovery/deep links, retained pending drafts and all server mutation guards. No package.json/dependency changes, billing gate changes, real purchase/mail, CI/push/merge/deploy.
Acceptance: paid overview has no purchase form/renewal form/history buttons piled together; each section is reachable and has a return; quote/capacity are sequential; successful state does not invite another payment; pending/failed state can recover; hash document return selects history; mobile390 no overflow, keyboard controls/visible focus retained. Verify existing billing browser suite + expanded preview checks and web typecheck, then save overview/choice/review/renewal screenshots.


### Delivery authorization and final hierarchy checks — 2026-09-17
Owner explicitly instructed: finish, wait for CI, then admin merge into develop and main. This supersedes all earlier local-only/no-CI/no-merge holds for the accumulated task. No deployment requested. Read the deployment protocol to check branch/release boundaries; do not dispatch deploy workflows.

Implementation: three themed sections (package, renewal/payment, history); compact paid summary; choose → optional capacity → review/consent → existing checkout. Preserve drafts while switching sections. Successful payment has no resume or recheck action; pending/failed recovery remains. History has one document entry and returns to its section. Renewal confirmations hide competing actions, completed commands collapse audit detail, scheduled downgrade target/date/amount remain visible. Annual savings derive from current catalog; no price change. Local preview keeps its explicit simulation notice and returns from portal/documents to the correct section.
Verification so far: initial combined browser run 5/7 passed, two failures referenced the renamed receipt button; corrected selector and preview rerun 2/2 passed. Native desktop and saved mobile390 overview visually reviewed. Web/API typechecks passed before final loading-indicator changes. Broad unit run exposed 31 missing pending accessibility indicators plus three stale source assertions; corrected scoped controls/assertions, retained permission/content checks. Original local-env CSP failure came from passing MinIO configuration into generic units; rerun uses the standard unit environment. Real HTTP/PG/browser smoke uses separate watchdog_postmark_ci on local port15442 with provider simulations and isolated Next build output. Fresh adjustment fixture now creates its own three permissions instead of depending on a previous suite's seed. Older smoke journeys updated to navigate the new sections and purpose-specific recovery page; financial/authority assertions retained. Final results and CI/merge identifiers to follow.

### Pre-CI verification complete — 2026-09-17
- Full workspace typecheck passed. Standard workspace units passed except the API registration guard initially found two unregistered new pagination specs; registered them as an explicit CI step without modifying package.json. Focused pagination/registration checks: 8 passed. API unit rerun passed (exit 0). Other workspace packages and all 1,739 web units passed in the broad run.
- Account OTP, customer billing and preview browser suite: 10/11 passed initially; the recovery test repeatedly fetched live local state through a route handler and timed out on navigation. Capture its read-only overview once before applying the expired fixture; recovery rerun passed. All 11 scenarios now passed. Final preview rerun: 2/2 passed, desktop1280/mobile390 screenshots refreshed.
- Real Nest HTTP + PostgreSQL + Chromium smoke passed 27 cases covering tenant/expired recovery, quote/consent/checkout, original-invoice apply retry, missing evidence and capacity repair, refund/credit-note pagination, privilege separation, provider failure/retry, document return, and preserved paid term/grants. Providers simulated, no actual payment/mail. Logs: /tmp/mangmee-merge-adjustments4.log. Earlier smoke failures were old UI selectors and an incomplete isolated permission fixture; all corrected without removing financial/authority assertions.
- New PG issue-resolution and concurrent-settings tests passed 7 cases against the explicitly isolated local watchdog_postmark_ci database; wired both into the existing CI PostgreSQL stage.
- Action-loading audit: 527 covered, zero gaps. Security audit passed its high-severity gate (0 high/critical; 13 moderate, 1 low reported). git diff --check passed. No package.json/dependency edits.
- Deployment remains out of scope. Next: commit this accumulated owner-authorized batch, automatic PR CI, admin merge develop then fast-forward the exact merge to main after success; record run/PR/SHAs.

CI delivery: PR #597 (https://github.com/MangmeeDev/mangmeeplus/pull/597), source 630b6cae00b7eda17a3feb2dc01c07db95940231, automatic CI run 35144924997. No manual/repeated dispatch. Awaiting terminal result before admin merge.

CI 35144924997 failed at Resolve Source before test fan-out: maintenance enforcement pins still referenced the old login landing/session gate and company/system layout bytes. Ran the repository pin synchronizer, reviewed only the four expected source digests plus validator workflow digest, and --check passed all 48 exact files. Full production-image-security contract suite passed, including 26 migration-authority tests; it uses local/fake cloud boundaries and did not deploy. Commit the regenerated pins and allow automatic CI for the new head; no duplicate workflow dispatch.

### CI integration follow-up — 2026-09-17
CI 35145336149 at source 6025f3efc81eeb2dd045969a47a0b40cbe4bb073 passed source/security/config/migration, workspace typechecks/units and PostgreSQL stages, then failed LINE AI whole-chain acceptance (1 stale billing settings mock among 1,399 API behavior tests). The concurrent-settings fix reads findUnique; updated the old upsert mock accordingly. Full local LINE AI whole-chain rerun passed (/tmp/mangmee-merge-line-chain.log). No duplicate workflow dispatch.

Preflight the remaining real HTTP/PG/Chromium CI paths before pushing again. Adapt smoke navigation to the themed sections, accessible selects/calendar, preserved drafts and operation detail pages; keep source, financial, permission, idempotency and audit assertions. Configuration tests capture actual created record IDs and perform password confirmation through the UI. Portal navigation uses the existing sidebar and preserves the late-response navigation guard.

Production UX corrections exposed by integration: failed/expired checkout returns now identify that selected attempt without displaying an older successful payment as its outcome; direct support-outcome and automatic-scan-schedule links expand their selected detail; resolved issues retain a permission-checked link to the original source for read-only follow-up. No financial policy, price, customer gate, deployment, dependency or package.json change.

Verification so far: final customer/preview desktop-mobile suite 7/7 passed; web typecheck passed; API typecheck passed with an 8-GB local Node heap (the first default-heap attempt exhausted memory, not a TS error). Support outcomes 6, provider discovery 7, invoice scans 8, scheduled discovery 9, invoice import 9, support SLA 8, scheduled policy 12 and email-access 5 cases passed; final exact totals and remaining reruns are recorded below before the next CI push. Maintenance pins remain current across all 48 files. Local smoke database is watchdog_postmark_ci on port15442; provider transports are simulated and no real payment or message is sent.

Final preflight: all remaining suites passed. Sales/cohort plus full payment/renewal/admin setup: 75 cases (/tmp/mangmee-merge-cohort5.log). Readiness and card portal: 19 cases (/tmp/mangmee-merge-readiness3.log), including client-side departure through the existing settings sidebar while a portal response is pending; late response does not redirect. Other focused suites above remain passed. Final API typecheck, maintenance-pin check (48 files) and diff check passed. Smoke navigation changes keep financial, permission, audit and race assertions. Restored generated next-env.d.ts; no package.json/dependency changes. Next: push integration fixes, await automatic exact-head PR CI, then authorized admin merge to develop and fast-forward that same merge to main; CI/merge evidence will be attached to PR #597 and the handoff.

CI 35150740282 at b617fd6b813b41fe865cc643fc76cf0d32aaeaeb passed all source/security/config/migration, workspace types/units, LINE whole-chain, PostgreSQL, full billing HTTP, signup/recovery browser and optional LINE contact-email stages. It failed shared LINE credential browser navigation: the smoke still expected the old heading and permanently expanded form. Updated only two smoke scripts to the current LINE settings wording/disclosures and company member navigation/actions. Local real HTTP/PG/Chromium publication passed 8 cases (/tmp/mangmee-merge-line-credentials.log); real admin/LIFF linking and unlinking passed 7 (/tmp/mangmee-merge-line-binding2.log); API typecheck and diff check passed. All security, current-role/password, concurrent rotation, replay, secret handling and unchanged money/quota assertions retained. No product-code changes in this follow-up. Automatic CI of the new head is still required before the authorized merge.


### Isolated browser compilation follow-up — 2026-09-17
CI 35155305593 source 45fc3cf45b7a40616c6d7be47cddae7ef18f67ed: attempt 1 hit a page-level Next 404 on the unchanged original-invoice repair detail. Current-head local rerun passed 16 cases, so only failed jobs were retried on the same run. Attempt 2 passed that recovery stage, LINE publication/binding, support and provider/invoice discovery/import, then timed out entering customer billing from the company picker. No screenshots were uploaded by that job, so the second browser page state was unavailable.

The shared smoke harness reused the same Next compilation directory across servers with different API origins. Give each server its own PID/port-scoped dist directory, remove only that owned directory after stopping its process, and include current path/headings in failure logs. This removes shared build state; exact CI success is still required to validate the intermittent route failures. No product, timeout, assertion, financial or permission change.

Cold-compilation verification with the same inherited CI flags: payment/renewal/admin/cohort 75 cases; SLA 8 (16.2s), scheduled policy 12 (66.9s), readiness/card portal 19 (77.1s). Logs /tmp/mangmee-merge-{cohort,sla,scheduled-policy,readiness}-cold.log. The 75-case suite also covers original-invoice repair and company-picker navigation. API typecheck passed; 48 maintenance pins current; diff check passed. All providers simulated and the isolated local watchdog_postmark_ci database was used. Generated Next typings restored. Next: automatic exact-head CI, then admin merge PR #597 to develop and fast-forward the same merge commit to main; no deploy.


CI 35163724194 at 177377bbf0b0a822c6e6e0388808081b117e3d13 passed all preceding stages and all four cold-browser suites (75 + 8 + 12 + 19 = 114 cases). The last successful suite printed at 00:44:17.362Z; the combined step began at 00:37:16.908Z and GitHub terminated cleanup at 00:44:18.099Z for exceeding its seven-minute limit. This confirms both previously failing browser routes now pass in CI. Increase only this four-suite step budget from seven to ten minutes to include cold compilation and cleanup; retain every assertion and individual Playwright timeout. No retry loop, skipped test or product change. Verify workflow pins and diff, then automatic CI at the new source is still mandatory before admin merge.
