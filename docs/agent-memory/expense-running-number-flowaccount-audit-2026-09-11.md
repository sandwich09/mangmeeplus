# Agent Memory: Expense running number implementation

Status: IMPLEMENTED; local verification complete 2026-09-11. Merge to develop/main explicitly authorized via [main PR #538](https://github.com/MangmeeDev/mangmeeplus/pull/538) and [develop PR #539](https://github.com/MangmeeDev/mangmeeplus/pull/539); GitHub records the current merge state. No deployment. Draft issuance defaults OFF pending compatibility activation.
Owner: Codex with thawatchai
Scope: EXP first manual/date-reviewed draft save, preserved numbering, atomic/retry safety, legacy snapshots, linked SRC/RB, PDF identity and related UI gaps.

Decisions:
- Latest user explicitly authorized commit/push into develop and main after completion; earlier admin merge permission also persists. This supersedes historical wait/no-merge instructions for this implementation. Deployment and feature-flag activation are not requested.
- v1 uses document date, keeps assigned numbers after date changes, never automatically returns/decrements/reuses deleted numbers; no manual renumber.
- Raw upload/LINE capture remains unnumbered until explicit user date review. Legacy dependencies/signed facts are not silently backfilled or rewritten.
- Isolated worktree `/tmp/mangmee-expense-running-number-20260911`, branch `codex/expense-running-number-20260911`, base `8f988a16`. Unrelated dirty shared checkout and package.json files untouched.
- Reuse canonical allocator/fingerprint and existing source/permission/tax/period guards. Nullable key/hash migration only. Serializable confirm/void with bounded P2034 retry; no external side effects in retry callbacks.
- Keep draft flag OFF by default; old overwrite-on-confirm runtime is not a valid rollback target after issuing a draft EXP.

Open questions / release boundaries:
- No implementation-blocking product question in v1. Target-environment cohorts A–H, live LINE/OCR, old browser/jobs, real ledger worker plus partial multi-projection cancellation, production-size allocator performance and older-user usability still need release acceptance.
- No-account paper reimbursement remains explicitly unsupported; UI tells users before proceeding. Pending manual save command is kept only in the open form, not across refresh/tab closure.

Artifacts:
- `docs/specs/expense-running-number-flowaccount-spec-th.md`
- `docs/plans/expense-running-number-implementation-2026-09-11-th.md`
- `docs/qa/evidence/expense-running-number-implementation-2026-09-11/README.md` with exact evidence, reproduction and limitations.

Verification:
- 149 focused logic/use-case/repository mock tests passed, no skipped/failed tests.
- 70 real PG tests passed: 13 new numbering/atomic/concurrency tests, 31 SRC edit, 7 funding, 16 RB race/source and 3 existing migration compatibility.
- Browser/API accepted flows: 2 cancelled SRC, 2 editable SRC, 6 existing reimbursements, 1 linked reverse journey and 2 save/date-review tests. Reruns overlap and are not added. Retained mixed-run logs clearly identify historical failures and subsequent correction.
- Legacy high-water proof: imported EXP ending 00100 without registry remains unchanged and next is 00101; monthless custom templates unique across periods.
- Two-month claim projection failure on second allocation rolls back all rows/numbers/counters. Concurrent retry creates one projection/EXP per line.
- Posted journal void uses real seeded PG journal, balanced reversal and one JV/audit/event; closed period and outbox failure fully roll back. No live ledger worker claim.
- Local migration clone: 13 tables equal, 0 backfilled rows; real paper PDF has both SRC/EXP, mobile 390/desktop 1440/200% text screenshots inspected.
- API/web typechecks and API build passed. Final diff review and evidence checksum scan recorded in report/manifest.

Next:
- Task-owned local API 3011/web 3012 stopped, generated next-env restored; cloned DBs/evidence retained. Complete the authorized integration through the linked PRs after CI; preserve the reviewed feature commit as an ancestor of both remote branches. Deployment/activation requires the mandatory runbooks and pending release acceptance.

### UI follow-up: explicit EXP table column, 2026-09-11

- User requested implementation after agreeing to a first “เลขรายจ่าย (EXP)” column.
- Added a dedicated full-number column before vendor/category, Thai/English labels and explicit unnumbered text. Smaller than 1280px uses cards with the number above the vendor; long numbers wrap without truncation.
- Scoped to list presentation, dictionary and documentation. Browser geometry/read-only review passed at 1440/1280/1024/768/390px, no overflow and 0 expense mutations; web typecheck passed. Evidence: `docs/qa/evidence/expense-number-column-2026-09-11/README.md`. No financial mutation or numbering rule change. Local servers stopped and generated next-env restored.

### UI follow-up: responsive KPI amounts, 2026-09-11

- User reported clipped KPI amounts and explicitly authorized commit/push develop + main.
- Shared StatCard now scales amount by available width, stacks icon on narrow cards and wraps very long numbers without truncation. Five-column expense grid begins at 1536px.
- Web typecheck passed; 24 real-API browser page/viewport observations plus 2 DOM-only long-amount cases passed, zero clipped values and zero business mutations. Evidence: `docs/qa/evidence/expense-kpi-responsive-2026-09-11/README.md`.
- Read the deployment freeze protocol before branch integration. The queued Readiness run `31611733340` is historical (2026-08-12, no jobs); newer Readiness `34447655824` and Production `34448486175` completed successfully on 2026-09-10. No current release run was found. No release workflow dispatched or cloud service changed.

### PR integration follow-up: Thai error coverage

- First PR CI runs: main `34574478497`, develop `34574481829`. Independently reproduced the existing error-translation coverage test: three new expense codes were missing from the web dictionary (17/18 checks passed). Added actionable Thai messages for deleted draft replay, changed draft command and number ownership conflict. Kept backend guards unchanged.
- Reran `pnpm --filter @watchdog-bms/web exec tsx --test src/common/api/api-error-coverage.spec.ts src/features/expenses/substitute-receipt-preview.spec.ts`: 18 passed, zero failed/skipped. Log retained locally at `/tmp/expense-number-error-coverage-pass.log`. CI on the subsequent PR heads is authoritative for full-suite acceptance.
- Full `pnpm test` exposed remaining legacy fixtures: create mocks did not invoke the new transaction callback, confirm constructor arity was still seven, and display assertions expected the old date/reference labels. Updated those fixtures without weakening the amount/launch-gate assertions; paper tests now require both EXP and SRC references.
- Final local `pnpm test` passed across all workspace packages, including 1,690 web tests, 1,103 AI Gateway, 246 contracts, 142 config, 43 workers and the API suite (dot reporter does not print a test count). Counts overlap focused suites and must not be added to earlier totals. Log: `/tmp/expense-number-final-workspace-tests-pass.log`. No external/live channel acceptance is implied.
- Develop merge resolves only historical conflicts; application and test trees match the verified feature branch. Preserve develop's two unrelated historical substitute receipt memory documents.

### Current develop integration, 2026-09-11

- Main PR #538 merged as `e5baef9bf5d5f6937adcb564372e6719a19d210c` after exact-head CI `34575426975` passed. Feature head `ef0bedeba7e316f4aef3446dcde84d9c9f3abb67` is retained in history. Develop candidate `868ceff28c8eb0ad7aee89709b9e9e06972077ea` also passed CI `34575442526`.
- While waiting, PR #537 advanced develop to `97ae64527d8abeb1f7730a6065ef3ccc4e0f6bb7`, adding the current evidence-review contract. Integrated that target in `1ab6e107`, preserving both idempotency exclusions and nullable category input, and combining reviewed fixtures with the four-argument atomic confirmation constructor.
- Integration exposed a real gap: source-backed claim projections failed expense evidence review after finance approval. The exact internal company/request/line/branch authority now uses the approved claim evidence for projections. Normal expense confirmation still requires current evidence review; missing-receipt policy, source validation inside the transaction, VAT, period and payment guards remain intact. Added rejection assertions for wrong authority and normal unreviewed confirmation to the existing real PG flow; no guard bypass through client input.
- Refreshed only the numbering PG fixture with an actual linked receipt and current evidence fingerprint. Rebuilt contracts after checkout; an initial stale-dist export failure and default-heap tsc OOM were local setup issues, resolved by rebuilding contracts and using the documented 10 GB typecheck heap.
- Combined source validation: full `pnpm test` passed; API/web tsc passed; API build passed; 70 real PG tests passed with zero skips; two real API/browser save/date-review E2Es passed. Logs `/tmp/expense-number-develop-{final-tests,final-pg,final-api-types,combined-web-types,combined-build,combined-browser}.log`. Counts overlap earlier evidence, not additional independent cases.
- Complete PR #539 and synchronize the same verified integration into main; no deployment, flag activation or customer gate change.

## Historical investigation and progress log (superseded by current state above)

Status: Proof investigation completed 2026-09-11; spec recorded, WAITING FOR IMPLEMENTATION. New EXP policy, migration and full browser/ledger acceptance are not implemented or proven.
Owner: Codex with thawatchai
Scope: Proposed EXP number on first saved draft using reviewed expense/document date; deletion, correction, OCR, UX, accountant, older general users, and full E2E feasibility.

Decisions:
- User asked to discuss before implementation and now requests surrounding bug/gap/impact audit. Earlier admin merge authorization concerns prior work, not authorization to implement this feature now.
- FlowAccount official expense guide bases number on selected document date; custom number guide skips deleted codes and describes manual edit/history. Deletion documentation has contradictory expense restrictions; do not claim live FlowAccount parity was verified.
- Recommend issuing at first explicit saved draft after document-date review; raw upload capture remains recoverable without EXP, payment date optional for draft; no auto renumber on date changes, no auto reuse on deletion. These are recommendations awaiting specification, not changes applied.
- Manual renumber/deleted-code reuse remains a scope decision because retained DocumentNumber uniqueness currently rejects reuse and paper/signed/export references need explicit protection.
- Root checkout has extensive unrelated changes. Three audit/plan/memory documents now maintained by this audit. No code, package/config, business records, merge, or deploy modified.
- User explicitly added migration and reverse E2E across linked expense/substitute/reimbursement. Added eight legacy cohorts, compatibility cutover/rollback and L01–L16; no migration executed.
- Latest baseline includes reimbursement source-consistency changes absent from root: original source via linkedExpenseId/snapshot is distinct from claim-born projection via company/request/line tuple. Preserve both identities and historical source semantics during migration.
- Existing source snapshot v1 has no internal EXP but includes SRC/version/checksums; blindly adding fields to retained snapshots breaks hash/strict comparisons. Draft state alone does not authorize backfill on a source with signed/active claim dependencies.

Open questions:
- Whether every DB DRAFT including upload intent must have EXP, or only the first explicitly saved/date-reviewed draft (recommended).
- Whether manual renumber/reuse is in v1; exact permissions and immutable-reference boundary if included.
- Legacy null number treatment and rollout compatibility. Preserve existing assigned numbers; no silent backfill.
- Dependency-sensitive unnumbered drafts, submitted snapshot version compatibility, retention/history around reimbursement reopen, and paper/no-account beneficiary scope require explicit rules. Do not weaken source locks or invent a generic return-to-draft path from approved/paid states.

Artifacts:
- `docs/research/expense-running-number-flowaccount-impact-audit-2026-09-11-th.md`: 16 findings, persona impacts, recommended flow and 18 acceptance groups.
- `docs/plans/expense-running-number-migration-linked-e2e-draft-2026-09-11-th.md`: eight migration cohorts, cutover/rollback invariants, sixteen linked reverse-flow cases and baseline source anchors.
- `/tmp/expense-number-linked-audit-tests.log`: 146 passing baseline reimbursement tests.
- Proposed interactive UI example requested by user: `/Users/thawatchai/.codex/visualizations/2026/09/10/01a08b4d-f38d-7971-9bac-7b5418ef94fe/expense-number-ui-example.html`. Synthetic data; expense list/detail, date edit retaining EXP, linked SRC/RB navigation and locked source, legacy null EXP. All interactions local to the example; no product/API changes. Host design options allow larger text and stacked references.
- `/tmp/expense-number-audit-baseline-tests.log`
- `/tmp/expense-number-audit-ui.cjs`, `/tmp/expense-number-audit-ui.log`, `/tmp/expense-number-audit-{manual,upload,list}-{1440,390}.png`
- `/tmp/expense-number-audit-render.ts`, `/tmp/expense-number-audit-paper-with-exp.svg`

Verification:
- Baseline commit `a3bfed76309a207d242b9aa27bc6b11b4f9077e4`, worktree `/tmp/mangmee-substitute-editable-navigation-20260910`: sequence logic, sequence repository mock, atomic expense confirmation mock tests — 48 passed, 0 failed, 0 skipped. Not real DB concurrency.
- Browser local manual/upload/list × desktop 1440 and mobile 390: 6 rendered successfully, no horizontal overflow, no business-write requests. Local web/API checkout `/private/tmp/mangmee-substitute-step3-edit-20260910` has additional local changes; not a Production test. No submit/payment/delete/signature action taken.
- Reproduced real rendering gap with synthetic snapshot: paper-form SVG includes SRC when expenseNumber is null, loses SRC entirely when EXP exists. Paper PDF path omits footer identity too. New EXP-on-draft must address this.
- Local existing screenshot example read-only: DRAFT expense has null EXP despite linked SRC. New behavior remains absent.
- New-flow E2E, manual reuse, real DB race/failure injection, 200% accessibility and target-user usability tests not run because no new implementation exists. Existing opt-in S3/live signing E2Es are baseline coverage, not acceptance evidence for new numbering.
- Follow-up five-file baseline on a3bfed76: reimbursement logic/hash, materialize mapper, request/reopen/cancel use cases, payout mirror and void-payment reversal — 146 passed, 0 failed/skipped. Pure/use-case/repository mocks; not real DB migration or L01–L16 E2E. Read existing CC2 exact-link backfill and source snapshot nullable migration; neither rerun nor edited.

Next:
- Wait for explicit instruction to implement the recorded spec. Start from its B01–B08 findings and acceptance matrix; do not interpret earlier admin merge permission as authorization for this EXP feature.


## Proof follow-up requested by user

- User: “พิสูจน์ให้ได้แล้วลง spec รอแก้”. Authorized local verification and recording a spec; product fixes remain pending.
- Created isolated local DB `expense_number_proof_20260911` from `reimbursement_source_review`, temporary API 3011/web 3012 and Redis DB14. Existing review DB/servers and cloud/customer gates were not changed. Synthetic source/file fixtures only; no EXP migration/backfill.
- Applied two missing existing baseline substitute migrations to the clone, then real PG suites passed: expense edit 31 + funding 7 + reimbursement source/race 16 + existing migration compatibility 3 = 57. The adjacent 6 sequence branch tests are logic/mock, not real DB.
- Actual API source-backed RB `RB-202609-00003` traversed reject/reopen/finance NEEDS_INFO/resubmit/approve/pay/retry/void. Retry void returned 422 `Payment is already voided`; GET recovery then cancel succeeded. Final DB: source NEEDS_REVIEW/EXP null/paid 0; projection EXP-202609-00001 VOIDED/paid 0; one VOIDED reimbursement payment; zero source/projection ExpensePayment. Source date was Aug 22, proving current confirmation-month numbering mismatch with target policy.
- This API journey did not run a ledger worker to posted; no actual posted-journal reversal or closed-period proof. Several initial source states in PG integration were seeded directly and confirm test uses an allocator mock; do not claim full SRC→ledger browser E2E.
- Browser baseline 2 pass / 8 fail: three stale policy-body tests, two new-expense launch/build prerequisite failures, cancelled view/date picker loading/selector failures. Linked browser attempt also stalled after API reopen. Do not label those unresolved environment/harness symptoms confirmed product bugs or claim browser acceptance.
- Recovery probe initially asserted lines on mutation summary; cancellation had already succeeded. Corrected only the investigation probe to GET detail and confirmed final state; strict void retry failure is retained.
- Paper SVG failure reproduced again. Hash probe using actual fixture snapshot demonstrated that adding EXP to retained source JSON changes approval digest. DB read-only probe preserved stored snapshots.
- New spec: `docs/specs/expense-running-number-flowaccount-spec-th.md`.
- New proof report: `docs/research/expense-running-number-proof-2026-09-11-th.md`.
- Durable evidence/probe sources: `docs/qa/evidence/expense-running-number-2026-09-11/` with hashes and reproduction notes. Credentials and raw session traces are excluded. Raw traces/clone remain local for diagnosis.
- Recorded conservative v1 scope: issue EXP on explicit date-reviewed draft save; preserve assigned EXP; no automatic/manual number reuse; legacy frozen/dependent snapshots retained; no-account paper beneficiary remains explicitly unsupported pending policy decision.
- The older “not run” statements above record the earlier read-only audit phase. The new proof report supersedes them for the tests actually run in this follow-up; EXP feature acceptance itself remains pending.

Verification/cleanup completion:
- Relative spec/report/evidence links and 16 evidence SHA-256 entries verified; scoped whitespace check passed. No embedded bearer tokens/presigned credentials found in the evidence pack.
- Stopped only proof API 3011/web 3012, restored the exact saved next-env.d.ts, and removed task-owned temporary app/E2E probes after verifying they match the retained docs copies. Local clone/artifacts remain for reproduction. No product files committed, no merge, no deploy.

## Implementation authorized, 2026-09-11

Status: IN PROGRESS. Latest user explicitly requests specification corrections followed by actual implementation. This supersedes the earlier wait instruction.
Owner: current Codex task.
Scope: EXP draft issuance/immutability, retry and concurrency safety, linked SRC/RB compatibility, identified PDF/void/UI gaps and real local verification.
Decisions: isolated branch `codex/expense-running-number-20260911`, worktree `/tmp/mangmee-expense-running-number-20260911` from origin/main `8f988a16`; leave dirty shared checkout untouched. No package.json changes or deployment.
Artifacts: concrete specification section 10 and `docs/plans/expense-running-number-implementation-2026-09-11-th.md`.
Implementation: additive nullable identity migration, atomic allocator integration in expense create/review/confirm and RB projection; stable web save key; retained legacy collision checks; both SRC/EXP on new paper renders; idempotent payout void. Verification and UI follow-up in progress.
Verification: fresh offline locked install and Prisma generate passed. Applied additive migrations to new local clone `expense_number_impl_20260911`; no original review DB changes. Web typecheck passed. API initial tsc hit heap limit, rerun with enlarged heap pending.
Next: focused real PG races/failure injection; repair stale test harnesses, run local API/browser/PDF and migration compatibility checks; record remaining limits precisely.

### Implementation verification progress

- New real PG suite: 12 tests covers concurrent draft saves/branches/months, payload and branch replay ownership, number/line/audit rollback, staging/flag-off compatibility, changed date retaining number, same-expense confirm retry, legacy outbox failure and period rejection, absent registry/counter collision, monthless custom template, deleted number retirement, retained SRC snapshot, posted payout void/closed-period/failure injection.
- Full integration run: 69 passing real PG tests (12 new + 31 source edit + 7 funding + 16 RB race + 3 old migration compatibility); final repeat after retaining Serializable pending. Focused logic/use-case suite 149 passed; final confirmation subset after atomic audit 78 passed; Serializable/void subset 47 passed. Counts overlap, do not add repeated suites.
- Preserved original Serializable isolation for confirm/void with bounded P2034-only transaction retry. Confirmation audit and payout reversal number/audit/outbox now join their business transaction.
- Browser harness hostname fixed using `next dev --webpack --hostname 127.0.0.1`, no product Next config workaround. Cancelled/view-only DIGITAL and PAPER 2 passed at desktop/mobile. Real editable source/certificate DIGITAL and PAPER 2 passed with both EXP/SRC retained. Existing reimbursement 6 passed after fixing DTO, required branch and approver-role test fixtures.
- Actual linked API + browser 1 passed: source → RB reject/reopen/edit → approve → finance NEEDS_INFO/edit → resubmit → approve/materialize → pay/retry → void/retry → cancel; projection EXP matches August source date, original source stays unpaid and unchanged.
- Found an actual LINE deep-link gap: API detail tool emitted `/reimbursements/:id`, web had only hub drawer. Added redirect route to existing `?focus=:id` detail; tested its edit/reopen path.
- New browser save suite 2 passed: simulate lost network response AFTER successful real API save, edit typed text, retry same payload/key, recover same expense/EXP, then check desktop/mobile/200% root text; staged upload vendor save stays unnumbered, explicit reviewed date issues August EXP, July correction keeps it. This exercises review APIs, not a live OCR provider.
- Actual form.pdf downloaded after paper edits, rendered using Poppler and visually inspected: SRC-202608-00006 and EXP-202608-00007 present without overlap; only new render changed, old files untouched.
- Migration rehearsed in second local clone restored from the pre-change dump: 13 financial/reference tables byte-equivalent after excluding two added null columns; 0 backfilled rows. Includes 37 expenses, 33 SRC and 2 RB. Some cohorts (posted journals/RB payments) empty there; real seeded PG reversal tests cover them independently.
- Current logs `/tmp/expense-number-impl-*`; durable evidence being assembled in `docs/qa/evidence/expense-running-number-implementation-2026-09-11`. Raw auth traces excluded.
- Next: final type/build checks, rerun small live linked confirmation after final backend build, package sanitized evidence and plan, scoped commit. No cloud environment, live customer gate, merge or deployment changes.
